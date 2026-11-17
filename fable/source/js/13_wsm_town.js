// Weston-super-Mare (?map=wsm): the baked OpenStreetMap town (12_wsm_data.js) turned into the circuit (TRK), the terrain
// heights (HF), the surface map the physics reads and the solid buildings. CPU only: the meshes are in 34_wsm_world.js.
// Map data © OpenStreetMap contributors (ODbL); terrain from AWS Terrain Tiles (WSM_META.credits).
// Local frame of the data: metres, origin at the entrance of the Grand Pier, X east, Z south (the game's convention).
const TOWN = {
  on: MAPSEL === 'wsm',
  A: null,                               // typed arrays of the data, by name (WSM_META.arrays)
  x0: 0, z0: 0, x1: 0, z1: 0, sea: 1.2, // town region (m) and sea level (m above datum)
  near: null, nw: 0, nh: 0, nres: 6, nx0: 0, nz0: 0,      // fine terrain grid
  far: null, fw: 0, fh: 0, fres: 100, fx0: 0, fz0: 0,     // coarse terrain grid (hills, coast, Wales)
  rd: null, rinfo: null,                 // road polylines {n, off, p} + 4 bytes each: class, width (dm), flags, lanes
  bd: null, binfo: null, bbox: null,     // building footprints + 8 bytes each: kind, height (m/4), roof, ridge, hash, hash, land use, 0
  ad: null, ainfo: null, alvl: null,     // land cover rings; polygons: class, ring count; water level (dm)
  trees: null,                           // OSM trees (x, z)
  zone: null, zw: 0, zh: 0,              // 1 m surface raster (TZ codes) over the town region
  sdf: null,                             // 2 m: depth (m/4) into water or out of bounds (same grid as HF)
  bcell: 16, bgw: 0, bgh: 0, bstart: null, bitems: null,  // building grid for the collisions
  cedge: null, croom: null,              // circuit: distance to the road edge and room for the autopilot (left, right)
  towers: null,                          // the Grand Pier pavilion's corner towers from the LIDAR: x, z (cm), top above the deck, deck (dm)
  walls: [],                             // the sea wall: [ax, az, bx, bz, foot, top] along the landward edge of the beach
  kerb: null,                            // circuit kerbs: per sample, side (-1 left, 1 right, 0 none) and inner distance
};
// surface codes of the 1 m raster; TZZ = game zone (ZONE), TZH = height above the terrain for the physics (kerb stones)
const TZ = { NONE: 0, ROAD: 1, PAVE: 2, HARD: 3, GRASS: 4, SAND: 5, MUD: 6, WOOD: 7, WATER: 8, KERB: 9, PATH: 10, TRACK: 11, GARDEN: 12, FIELD: 13, BLD: 14, OUT: 15, WALL: 16 };
const TZZ = new Uint8Array([2, 0, 6, 6, 2, 3, 4, 4, 4, 1, 6, 3, 2, 2, 6, 4, 6]);
const TZH = new Float64Array([0, 0, 0.12, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0]);
// land cover classes of the bake (tools/osm/bake_wsm.py, LC) → surface code
const TOWN_LC = [TZ.NONE, TZ.GARDEN, TZ.GRASS, TZ.FIELD, TZ.WOOD, TZ.WOOD, TZ.SAND, TZ.MUD, TZ.WATER, TZ.HARD, TZ.NONE, TZ.GRASS, TZ.GRASS, TZ.GRASS];
const ROAD_PAVE = [0, 3.0, 2.8, 2.6, 2.6, 2.2, 2.0, 1.6, 0, 0, 0, 0, 0];   // pavement width by road class (m)

// base64 → zlib → bytes
async function townInflate(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
}
// polylines: counts, absolute first points, deltas (int16 in 1/8 m) → {n, off (vertex index per polyline), p (x, z)}
function townPolys(cnt, st, d, q) {
  const n = cnt.length; let nv = 0; for (let i = 0; i < n; i++) nv += cnt[i];
  const off = new Int32Array(n + 1), p = new Float32Array(nv * 2); let k = 0, di = 0;
  for (let i = 0; i < n; i++) {
    off[i] = k; let X = st[i * 2], Z = st[i * 2 + 1]; p[k * 2] = X * q; p[k * 2 + 1] = Z * q; k++;
    for (let j = 1; j < cnt[i]; j++) { X += d[di++]; Z += d[di++]; p[k * 2] = X * q; p[k * 2 + 1] = Z * q; k++; }
  }
  off[n] = k; return { n, off, p };
}
// terrain grid stored as residuals of a planar predictor (left + up - up-left), in units of q
function townGrid(R, w, h, q) {
  const Q = new Int32Array(w * h), H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, p = j === 0 ? (i ? Q[k - 1] : 0) : i === 0 ? Q[k - w] : Q[k - 1] + Q[k - w] - Q[k - w - 1];
    Q[k] = R[k] + p; H[k] = Q[k] * q;
  }
  return H;
}
async function townLoad() {
  const M = WSM_META, buf = await townInflate(WSM_B64), A = TOWN.A = {};
  const TA = { i16: Int16Array, u16: Uint16Array, u8: Uint8Array, i32: Int32Array, f32: Float32Array, i8: Int8Array };
  for (const k in M.arrays) { const a = M.arrays[k]; A[k] = new TA[a[0]](buf, a[1], a[2]); }
  const T = TOWN; [T.x0, T.z0, T.x1, T.z1] = M.town; T.sea = M.sea;
  const n = M.near, f = M.far;
  T.nw = n.w; T.nh = n.h; T.nres = n.res; T.nx0 = n.x0; T.nz0 = n.z0; T.near = townGrid(A.near, n.w, n.h, n.q);
  T.fw = f.w; T.fh = f.h; T.fres = f.res; T.fx0 = f.x0; T.fz0 = f.z0; T.far = townGrid(A.far, f.w, f.h, f.q);
  const q = M.q;
  T.rd = townPolys(A.rn, A.r0, A.rxz, q); T.rinfo = A.rinfo;
  T.bd = townPolys(A.bn, A.b0, A.bxz, q); T.binfo = A.binfo;
  T.ad = townPolys(A.an, A.a0, A.axz, q); T.ainfo = A.ainfo; T.alvl = A.alvl;
  T.trees = new Float32Array(A.t0.length); for (let i = 0; i < A.t0.length; i++) T.trees[i] = A.t0[i] * q;
  T.cedge = A.cedge; T.croom = A.croom; T.towers = A.towers || null; T.spires = A.spires || null;
  T.pav = M.pavilion && A.pavroof ? Object.assign({ grid: A.pavroof }, M.pavilion) : null;   // the pavilion's roof heights (DSM)
  // building bounding boxes
  const B = T.bd, bb = T.bbox = new Float32Array(B.n * 4);
  for (let i = 0; i < B.n; i++) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let k = B.off[i]; k < B.off[i + 1]; k++) { const x = B.p[k * 2], z = B.p[k * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    bb[i * 4] = x0; bb[i * 4 + 1] = z0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = z1;
  }
}

// ---------- terrain heights ----------
// fine grid: Catmull-Rom; coarse grid: bilinear; the last 150 m inside the town region blend from one to the other
function townNearH(x, z) {
  const T = TOWN, fx = (x - T.nx0) / T.nres, fz = (z - T.nz0) / T.nres, w = T.nw, h = T.nh, H = T.near;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const cu0 = ((-0.5 * u + 1) * u - 0.5) * u, cu1 = (1.5 * u - 2.5) * u * u + 1, cu2 = ((-1.5 * u + 2) * u + 0.5) * u, cu3 = (0.5 * u - 0.5) * u * u;
  const cv0 = ((-0.5 * v + 1) * v - 0.5) * v, cv1 = (1.5 * v - 2.5) * v * v + 1, cv2 = ((-1.5 * v + 2) * v + 0.5) * v, cv3 = (0.5 * v - 0.5) * v * v;
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const jj = Math.min(h - 1, Math.max(0, j - 1 + b)) * w, cv = b === 0 ? cv0 : b === 1 ? cv1 : b === 2 ? cv2 : cv3;
    const i0 = Math.min(w - 1, Math.max(0, i - 1)), i1 = Math.min(w - 1, Math.max(0, i)), i2 = Math.min(w - 1, Math.max(0, i + 1)), i3 = Math.min(w - 1, Math.max(0, i + 2));
    s += cv * (H[jj + i0] * cu0 + H[jj + i1] * cu1 + H[jj + i2] * cu2 + H[jj + i3] * cu3);
  }
  return s;
}
function townFarH(x, z) {
  const T = TOWN, fx = clamp((x - T.fx0) / T.fres, 0, T.fw - 1.001), fz = clamp((z - T.fz0) / T.fres, 0, T.fh - 1.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, w = T.fw, H = T.far, k = j * w + i;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + w] * (1 - u) + H[k + w + 1] * u) * v;
}
// natural terrain at any point (the town's roads lie on it: the source is a bare-earth LIDAR model)
function townH(x, z) {
  const T = TOWN, e = Math.min(x - T.x0, T.x1 - x, z - T.z0, T.z1 - z);
  if (e <= 0) return townFarH(x, z);
  const n = townNearH(x, z); if (e >= 150) return n;
  const w = smooth(0, 150, e); return townFarH(x, z) * (1 - w) + n * w;
}
// terrainH() of 10_track.js for this map (outside the height field)
function townTerrainH(x, z) { return townH(x, z); }

// ---------- circuit ----------
function townTrackBuild() {
  const T = TOWN, A = T.A, M = WSM_META, N = M.circuit.n, c = A.cxz;
  const X = new Float32Array(N), Z = new Float32Array(N);
  for (let i = 0; i < N; i++) { X[i] = c[i * 2] * 0.01; Z[i] = c[i * 2 + 1] * 0.01; }
  let L = 0; for (let i = 0; i < N; i++) { const j = (i + 1) % N; L += Math.hypot(X[j] - X[i], Z[j] - Z[i]); }
  const ds = L / N, F = () => new Float32Array(N);
  TRK.N = N; TRK.L = L; TRK.ds = ds; TRK.x = X; TRK.z = Z;
  const TX = TRK.tx = F(), TZ_ = TRK.tz = F(), K = TRK.k = F(), Y = TRK.y = F(); TRK.bank = F(); TRK.slope = F();
  for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N, tx = X[b] - X[a], tz = Z[b] - Z[a], l = Math.hypot(tx, tz); TX[i] = tx / l; TZ_[i] = tz / l; }
  for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; K[i] = (TX[a] * TZ_[b] - TZ_[a] * TX[b]) / (2 * ds); }
  // heights: the terrain under the centre line, lightly smoothed (no kerb steps from the junction boxes)
  const y0 = F(); for (let i = 0; i < N; i++) y0[i] = townH(X[i], Z[i]);
  for (let i = 0; i < N; i++) { let s = 0, w = 0; for (let q = -6; q <= 6; q++) { const g = Math.exp(-q * q / 18); s += y0[(i + q + N) % N] * g; w += g; } Y[i] = s / w; }
  for (let i = 0; i < N; i++) TRK.slope[i] = (Y[(i + 1) % N] - Y[(i - 1 + N) % N]) / (2 * ds);
  // a street circuit: no kerbs, gravel or barriers of the circuit's own (the town's buildings are the walls)
  TRK.kerbL = F(); TRK.kerbR = F(); TRK.gravL = F(); TRK.gravR = F(); TRK.tyreL = F(); TRK.tyreR = F();
  TRK.barL = F().fill(60); TRK.barR = F().fill(60);
  // half width: the narrower side of the road around the line (for code that wants one number), and the autopilot's room
  const ed = T.cedge, rm = T.croom, aiL = TRK.aiL = F(), aiR = TRK.aiR = F();
  for (let i = 0; i < N; i++) { aiL[i] = rm[i * 2] * 0.1; aiR[i] = rm[i * 2 + 1] * 0.1; }
  TRK.hw = 3.5;
  // corners (for the TV cameras): curvature peaks
  const kb = F(); for (let i = 0; i < N; i++) { let s = 0; for (let q = -8; q <= 8; q++) s += K[(i + q + N) % N]; kb[i] = s / 17; }
  TRK.segs = []; TRK.corners = [];
  for (let i = 0; i < N; i++) {
    const a = Math.abs(kb[i]); if (a < 1 / 40) continue; let peak = true;
    for (let q = -25; q <= 25 && peak; q++) if (q && Math.abs(kb[(i + q + N) % N]) > a) peak = false;
    if (peak) { const s = i * ds; TRK.corners.push({ type: 'A', s0: s - 10, s1: s + 10, k: kb[i], R: 1 / a, ang: kb[i] > 0 ? 90 : -90, name: '' }); }
  }
  TRK.segs = TRK.corners.slice();
  // kerbs on the inside of the corners, where the road has a real edge there (not the mouth of a side street)
  const kerb = T.kerb = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const k = kb[i]; if (Math.abs(k) < 1 / 70) continue;
    const sd = k > 0 ? 1 : 0, e = ed[i * 2 + sd] * 0.1; if (e > 7.5 || e < 2.2) continue;
    kerb[i * 2] = k > 0 ? 1 : -1; kerb[i * 2 + 1] = e;
  }
  // start: on Royal Parade, by the pier, in the left lane
  TRK.startS = -14; TRK.startD = -1.6;
  TRK.shadowR = Math.max(T.x1 - T.x0, T.z1 - T.z0) / 2 + 150; TRK.shadowC = [(T.x0 + T.x1) / 2, (T.z0 + T.z1) / 2];
  trackGridBuild();
}

// ---------- height field, surface raster, collisions ----------
function townHeightsBuild() {
  const T = TOWN, res = 2, w = Math.round((T.x1 - T.x0) / res) + 1, h = Math.round((T.z1 - T.z0) / res) + 1;
  HF.x0 = T.x0; HF.z0 = T.z0; HF.w = w; HF.h = h; HF.ir = 1 / res; HF.res = res;
  const D = HF.d = new Float32Array(w * h);
  // fine grid → 2 m by separable Catmull-Rom (the 2 m nodes fall on thirds of the 6 m grid)
  const nr = T.nres / res, nw = T.nw, nh = T.nh, N = T.near, tmp = new Float32Array(w * nh);
  const cr = (u, k) => k === 0 ? ((-0.5 * u + 1) * u - 0.5) * u : k === 1 ? (1.5 * u - 2.5) * u * u + 1 : k === 2 ? ((-1.5 * u + 2) * u + 0.5) * u : (0.5 * u - 0.5) * u * u;
  for (let i = 0; i < w; i++) {
    const f = i / nr, i0 = Math.floor(f), u = f - i0, c0 = cr(u, 0), c1 = cr(u, 1), c2 = cr(u, 2), c3 = cr(u, 3);
    const a = Math.max(0, i0 - 1), b = Math.min(nw - 1, i0), c = Math.min(nw - 1, i0 + 1), d = Math.min(nw - 1, i0 + 2);
    for (let j = 0; j < nh; j++) { const r = j * nw; tmp[j * w + i] = N[r + a] * c0 + N[r + b] * c1 + N[r + c] * c2 + N[r + d] * c3; }
  }
  for (let j = 0; j < h; j++) {
    const f = j / nr, j0 = Math.floor(f), v = f - j0, c0 = cr(v, 0), c1 = cr(v, 1), c2 = cr(v, 2), c3 = cr(v, 3);
    const a = Math.max(0, j0 - 1) * w, b = Math.min(nh - 1, j0) * w, c = Math.min(nh - 1, j0 + 1) * w, d = Math.min(nh - 1, j0 + 2) * w;
    for (let i = 0; i < w; i++) D[j * w + i] = tmp[a + i] * c0 + tmp[b + i] * c1 + tmp[c + i] * c2 + tmp[d + i] * c3;
  }
  // the outer band blends into the coarse grid (as townH does)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = T.x0 + i * res, z = T.z0 + j * res, e = Math.min(x - T.x0, T.x1 - x, z - T.z0, T.z1 - z);
    if (e < 150) { const s = smooth(0, 150, e); D[j * w + i] = townFarH(x, z) * (1 - s) + D[j * w + i] * s; }
  }
  // bridges: straight decks between the heights at their ends (the terrain model has no bridges)
  const R = T.rd, ri = T.rinfo;
  for (let r = 0; r < R.n; r++) {
    if (!(ri[r * 4 + 2] & 1) || ri[r * 4] > 9) continue;
    const k0 = R.off[r], k1 = R.off[r + 1] - 1; let len = 0;
    for (let k = k0; k < k1; k++) len += Math.hypot(R.p[k * 2 + 2] - R.p[k * 2], R.p[k * 2 + 3] - R.p[k * 2 + 1]);
    if (len < 12) continue;
    const ha = hfAt(R.p[k0 * 2], R.p[k0 * 2 + 1]), hb = hfAt(R.p[k1 * 2], R.p[k1 * 2 + 1]), rad = ri[r * 4 + 1] * 0.05 + 2.5; let s = 0;
    for (let k = k0; k < k1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], sl = Math.hypot(bx - ax, bz - az);
      const x0 = Math.floor((Math.min(ax, bx) - rad - T.x0) / res), x1 = Math.ceil((Math.max(ax, bx) + rad - T.x0) / res);
      const z0 = Math.floor((Math.min(az, bz) - rad - T.z0) / res), z1 = Math.ceil((Math.max(az, bz) + rad - T.z0) / res);
      for (let j = Math.max(0, z0); j <= Math.min(h - 1, z1); j++) for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) {
        const px = T.x0 + i * res, pz = T.z0 + j * res, ex = bx - ax, ez = bz - az, t = clamp(((px - ax) * ex + (pz - az) * ez) / (sl * sl + 1e-9), 0, 1);
        if (Math.hypot(px - ax - ex * t, pz - az - ez * t) > rad) continue;
        const f = (s + t * sl) / len; D[j * w + i] = ha + (hb - ha) * f + 0.4 * Math.sin(f * PI);
      }
      s += sl;
    }
  }
  townRasterBuild();
  townBuildingGrid();
  townSdfBuild();
}
// scanline fill (even-odd, with holes) of rings [k0, k1) of a polygon set into the 1 m raster
const _xs = new Float64Array(4096);
function townFill(P, r0, r1, val, keep) {
  const T = TOWN, Z = T.zone, zw = T.zw, zh = T.zh, p = P.p, off = P.off;
  let z0 = 1e9, z1 = -1e9;
  for (let k = off[r0]; k < off[r1]; k++) { const z = p[k * 2 + 1]; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const j0 = Math.max(0, Math.floor(z0 - T.z0)), j1 = Math.min(zh - 1, Math.ceil(z1 - T.z0));
  for (let j = j0; j <= j1; j++) {
    const zc = T.z0 + j + 0.5; let n = 0;
    for (let r = r0; r < r1; r++) {
      const a = off[r], b = off[r + 1];
      for (let k = a; k < b; k++) {
        const k2 = k + 1 < b ? k + 1 : a, az = p[k * 2 + 1], bz = p[k2 * 2 + 1];
        if ((az <= zc) === (bz <= zc)) continue;
        const ax = p[k * 2], bx = p[k2 * 2]; if (n < 4096) _xs[n++] = ax + (zc - az) / (bz - az) * (bx - ax);
      }
    }
    if (n < 2) continue;
    const xs = _xs.subarray(0, n).sort();
    for (let q = 0; q + 1 < n; q += 2) {
      const i0 = Math.max(0, Math.ceil(xs[q] - T.x0 - 0.5)), i1 = Math.min(zw - 1, Math.floor(xs[q + 1] - T.x0 - 0.5));
      for (let i = i0, o = j * zw + i0; i <= i1; i++, o++) if (!keep || !keep[Z[o]]) Z[o] = val;
    }
  }
}
// thick segment (capsule of radius rad) into the 1 m raster; only over codes for which over[code] is set
function townCapsule(ax, az, bx, bz, rad, val, over) {
  const T = TOWN, Z = T.zone, zw = T.zw, zh = T.zh, ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez + 1e-9, r2 = rad * rad;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad - T.x0)), i1 = Math.min(zw - 1, Math.ceil(Math.max(ax, bx) + rad - T.x0));
  const j0 = Math.max(0, Math.floor(Math.min(az, bz) - rad - T.z0)), j1 = Math.min(zh - 1, Math.ceil(Math.max(az, bz) + rad - T.z0));
  for (let j = j0; j <= j1; j++) {
    const pz = T.z0 + j + 0.5;
    for (let i = i0; i <= i1; i++) {
      const px = T.x0 + i + 0.5; let t = ((px - ax) * ex + (pz - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ax - ex * t, dz = pz - az - ez * t; if (dx * dx + dz * dz > r2) continue;
      const o = j * zw + i; if (over[Z[o]]) Z[o] = val;
    }
  }
}
function townRasterBuild() {
  const T = TOWN, zw = T.zw = Math.round(T.x1 - T.x0), zh = T.zh = Math.round(T.z1 - T.z0), Z = T.zone = new Uint8Array(zw * zh);
  // land cover, in the bake's painter's order
  const A = T.ad, ai = T.ainfo; let r = 0;
  for (let i = 0; i < ai.length / 2; i++) {
    const c = ai[i * 2], nr = ai[i * 2 + 1];
    if (TOWN_LC[c] !== TZ.NONE) townFill(A, r, r + nr, TOWN_LC[c], null);
    r += nr;
  }
  // sea: below mid tide on the shore side (mud flats, beach and unmapped ground)
  const D = HF.d, hw = HF.w;
  for (let j = 0; j < zh; j++) for (let i = 0; i < zw; i++) {
    const o = j * zw + i, c = Z[o]; if (c !== TZ.NONE && c !== TZ.MUD && c !== TZ.SAND) continue;
    const fi = (i + 0.5) / HF.res, fj = (j + 0.5) / HF.res, ii = Math.min(hw - 2, fi | 0), jj = Math.min(HF.h - 2, fj | 0), u = fi - ii, v = fj - jj, k = jj * hw + ii;
    const y = (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + hw] * (1 - u) + D[k + hw + 1] * u) * v;
    if (y < T.sea) Z[o] = TZ.WATER;
  }
  // buildings
  const B = T.bd; for (let b = 0; b < B.n; b++) if (T.binfo[b * 8] !== 8 && T.binfo[b * 8] !== 11) townFill(B, b, b + 1, TZ.BLD, null);
  // the sea wall (roads crossing it, the slipways, open it again below)
  townSeaWalls(); { const W = T.walls, ov = new Uint8Array(17).fill(1); ov[TZ.WATER] = 0; ov[TZ.OUT] = 0; for (let i = 0; i < W.length; i += 6) townCapsule(W[i], W[i + 1], W[i + 2], W[i + 3], 0.7, TZ.WALL, ov); }
  // roads: pavements, then carriageways over them (junctions), paths and tracks only over soft ground
  const R = T.rd, ri = T.rinfo, soft = new Uint8Array(17), all = new Uint8Array(17).fill(1), pv = new Uint8Array(17);
  for (const c of [TZ.NONE, TZ.GRASS, TZ.GARDEN, TZ.FIELD, TZ.WOOD, TZ.MUD, TZ.SAND, TZ.HARD]) soft[c] = 1;
  for (const c of [TZ.NONE, TZ.GRASS, TZ.GARDEN, TZ.FIELD, TZ.WOOD, TZ.HARD, TZ.PATH, TZ.TRACK]) pv[c] = 1;
  all[TZ.WATER] = 0; all[TZ.OUT] = 0;
  for (let pass = 0; pass < 3; pass++) for (let q = 0; q < R.n; q++) {
    const cls = ri[q * 4], wd = ri[q * 4 + 1] * 0.1; if (cls === 12) continue;
    let rad, val, over;
    if (pass === 0) { if (!ROAD_PAVE[cls]) continue; rad = wd / 2 + ROAD_PAVE[cls]; val = TZ.PAVE; over = pv; }
    else if (pass === 1) { if (cls < 10) continue; rad = wd / 2; val = cls === 10 ? TZ.PATH : TZ.TRACK; over = soft; }
    else { if (cls > 9) continue; rad = wd / 2; val = cls === 9 ? TZ.HARD : TZ.ROAD; over = all; }
    for (let k = R.off[q]; k < R.off[q + 1] - 1; k++) townCapsule(R.p[k * 2], R.p[k * 2 + 1], R.p[k * 2 + 2], R.p[k * 2 + 3], rad, val, over);
  }
  // circuit kerbs
  const N = TRK.N, kb = T.kerb, ov = new Uint8Array(17); ov[TZ.ROAD] = 1; ov[TZ.PAVE] = 1; ov[TZ.KERB] = 1;
  for (let i = 0; i < N; i++) {
    const sd = kb[i * 2]; if (!sd) continue; const e = kb[i * 2 + 1], nx = -TRK.tz[i] * sd, nz = TRK.tx[i] * sd;
    townCapsule(TRK.x[i] + nx * (e - 0.45), TRK.z[i] + nz * (e - 0.45), TRK.x[(i + 1) % N] + nx * (e - 0.45), TRK.z[(i + 1) % N] + nz * (e - 0.45), 0.5, TZ.KERB, ov);
  }
  // out of bounds: a 12 m band at the edge of the region
  for (let j = 0; j < zh; j++) for (let i = 0; i < zw; i++) if (i < 12 || j < 12 || i >= zw - 12 || j >= zh - 12) Z[j * zw + i] = TZ.OUT;
}
// The sea wall: along the edges of the beach polygons, wherever the ground just inland stands a metre or more above the
// sand just seaward, a grey stone wall from the sand to a parapet 0.9 m above the promenade (solid; gaps at the slipways).
function townSeaWalls() {
  const T = TOWN, A = T.ad, ai = T.ainfo, W = T.walls; let r = 0; W.length = 0;
  for (let q = 0; q < ai.length / 2; q++) {
    const c = ai[q * 2], nr = ai[q * 2 + 1];
    if (c === 6) for (let rr = r; rr < r + nr; rr++) {
      const k0 = A.off[rr], k1 = A.off[rr + 1], n = k1 - k0; let ar = 0;
      for (let k = 0; k < n; k++) { const j = k0 + (k + 1) % n; ar += A.p[(k0 + k) * 2] * A.p[j * 2 + 1] - A.p[j * 2] * A.p[(k0 + k) * 2 + 1]; }
      const sg = ar > 0 ? 1 : -1;      // inward normal = sg * (-ez, ex)
      for (let k = 0; k < n; k++) {
        const ax = A.p[(k0 + k) * 2], az = A.p[(k0 + k) * 2 + 1], j = k0 + (k + 1) % n, bx = A.p[j * 2], bz = A.p[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue; const m = Math.ceil(L / 4);
        const ix = -(bz - az) / L * sg, iz = (bx - ax) / L * sg;
        for (let s = 0; s < m; s++) {
          const x0 = ax + (bx - ax) * s / m, z0 = az + (bz - az) * s / m, x1 = ax + (bx - ax) * (s + 1) / m, z1 = az + (bz - az) * (s + 1) / m, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          if (mx < T.x0 + 20 || mz < T.z0 + 20 || mx > T.x1 - 20 || mz > T.z1 - 20) continue;
          const hb = hfAt(mx + ix * 5, mz + iz * 5), hl = Math.max(hfAt(mx - ix * 4, mz - iz * 4), hfAt(mx - ix * 7, mz - iz * 7));
          if (hl - hb < 1.0) continue;
          W.push(x0, z0, x1, z1, Math.min(hb, hfAt(mx, mz)) - 0.6, hl + 0.9);
        }
      }
    }
    r += nr;
  }
}
// grid of building indices (16 m cells) for the collisions
function townBuildingGrid() {
  const T = TOWN, c = T.bcell, gw = T.bgw = Math.ceil((T.x1 - T.x0) / c), gh = T.bgh = Math.ceil((T.z1 - T.z0) / c), bb = T.bbox, n = T.bd.n;
  const cnt = new Int32Array(gw * gh + 1);
  const each = (b, f) => { const i0 = Math.max(0, Math.floor((bb[b * 4] - T.x0) / c)), i1 = Math.min(gw - 1, Math.floor((bb[b * 4 + 2] - T.x0) / c)), j0 = Math.max(0, Math.floor((bb[b * 4 + 1] - T.z0) / c)), j1 = Math.min(gh - 1, Math.floor((bb[b * 4 + 3] - T.z0) / c)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * gw + i); };
  const solid = b => T.binfo[b * 8] !== 8 && T.binfo[b * 8] !== 11;   // (the pier pavilion stands on the deck above the beach; shelters are open)
  for (let b = 0; b < n; b++) if (solid(b)) each(b, k => cnt[k + 1]++);
  for (let k = 0; k < gw * gh; k++) cnt[k + 1] += cnt[k];
  const items = T.bitems = new Int32Array(cnt[gw * gh]), fill = cnt.slice(); T.bstart = cnt;
  for (let b = 0; b < n; b++) if (solid(b)) each(b, k => { items[fill[k]++] = b; });
}
// depth into water / out of bounds on the 2 m grid (chamfer distance from the free cells), in quarter metres
function townSdfBuild() {
  const T = TOWN, w = HF.w, h = HF.h, Z = T.zone, zw = T.zw, zh = T.zh, d = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const zi = Math.min(zw - 1, i * 2), zj = Math.min(zh - 1, j * 2), c = Z[zj * zw + zi];
    d[j * w + i] = c === TZ.WATER || c === TZ.OUT || c === TZ.WALL ? 1e9 : 0;
  }
  const a = 2, b = 2 * Math.SQRT2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; if (!d[k]) continue; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a); if (j > 0) { v = Math.min(v, d[k - w] + a); if (i > 0) v = Math.min(v, d[k - w - 1] + b); if (i < w - 1) v = Math.min(v, d[k - w + 1] + b); }
    d[k] = v;
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i; if (!d[k]) continue; let v = d[k];
    if (i < w - 1) v = Math.min(v, d[k + 1] + a); if (j < h - 1) { v = Math.min(v, d[k + w] + a); if (i < w - 1) v = Math.min(v, d[k + w + 1] + b); if (i > 0) v = Math.min(v, d[k + w - 1] + b); }
    d[k] = v;
  }
  const s = T.sdf = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) s[k] = Math.min(255, Math.round(d[k] * 4));
}

// ---------- physics (no allocation: registers and typed arrays only) ----------
// ground under q = _gq (q[0] = x, q[1] = z): q[8] = height, returns the game zone. wi < 0: the car's centre, which also
// finds the car on the circuit (V.s, V.d); far from the circuit (a side street) s stays where the car left it.
function townGroundQ(wi) {
  const q = _gq, T = TOWN, x = q[0], z = q[1];
  if (wi < 0) townLocate();
  let c = TZ.OUT;
  if (x >= T.x0 && z >= T.z0) { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; if (i < T.zw && j < T.zh) c = T.zone[j * T.zw + i]; }
  hfAtQ(q); q[8] = q[6] + TZH[c];
  return TZZ[c];
}
function townLocate() {
  const q = _gq, V = VEH;
  if (V.hint >= 0) { trackLocateQ(V.hint, q); if (q[3] < 35 && q[3] > -35) { V.hint = q[4] | 0; V.s = q[2]; V.d = q[3]; return; } }
  if (trackFarDist(q[0], q[1]) < 35) { trackLocateQ(-1, q); if (q[3] < 35 && q[3] > -35) { V.hint = q[4] | 0; V.s = q[2]; V.d = q[3]; return; } }
  V.hint = -1;
}
// CQ: [push x, push z, depth] of the last contact
const CQ = new Float64Array(4);
// is the point (x, z) inside a building? if so, CQ = the shortest way out (push direction and depth)
function townBuildingQ(x, z) {
  const T = TOWN, c = T.bcell; CQ[2] = 0;
  if (x < T.x0 || z < T.z0) return false;
  const gi = ((x - T.x0) / c) | 0, gj = ((z - T.z0) / c) | 0; if (gi >= T.bgw || gj >= T.bgh) return false;
  const k = gj * T.bgw + gi, st = T.bstart, it = T.bitems, bb = T.bbox, P = T.bd.p, off = T.bd.off;
  for (let m = st[k]; m < st[k + 1]; m++) {
    const b = it[m]; if (x < bb[b * 4] || x > bb[b * 4 + 2] || z < bb[b * 4 + 1] || z > bb[b * 4 + 3]) continue;
    const a0 = off[b], a1 = off[b + 1]; let inside = false;
    for (let i = a0, j = a1 - 1; i < a1; j = i++) {
      const zi = P[i * 2 + 1], zj = P[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (P[j * 2] - P[i * 2]) * (z - zi) / (zj - zi) + P[i * 2]) inside = !inside;
    }
    if (!inside) continue;
    let best = 1e9, px = 0, pz = 0;
    for (let i = a0, j = a1 - 1; i < a1; j = i++) {
      const ax = P[j * 2], az = P[j * 2 + 1], ex = P[i * 2] - ax, ez = P[i * 2 + 1] - az; let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez + 1e-9);
      t = t < 0 ? 0 : t > 1 ? 1 : t; const dx = ax + ex * t - x, dz = az + ez * t - z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; px = dx; pz = dz; }
    }
    const d = Math.sqrt(best) + 1e-6; CQ[0] = px / d; CQ[1] = pz / d; CQ[2] = d + 0.02; return true;
  }
  return false;
}
// depth into water / out of bounds (bilinear on the 2 m grid); CQ = the way out
function townBlockedQ(x, z) {
  const fx = (x - HF.x0) * HF.ir, fz = (z - HF.z0) * HF.ir; CQ[2] = 0;
  if (fx < 1 || fz < 1 || fx >= HF.w - 2 || fz >= HF.h - 2) return false;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, w = HF.w, S = TOWN.sdf, k = j * w + i;
  const d = ((S[k] * (1 - u) + S[k + 1] * u) * (1 - v) + (S[k + w] * (1 - u) + S[k + w + 1] * u) * v) * 0.25;
  if (d < 0.05) return false;
  let gx = (S[k + 1] - S[k - 1]) + (S[k + w + 1] - S[k + w - 1]), gz = (S[k + w] - S[k - w]) + (S[k + w + 1] - S[k - w + 1]);
  const l = Math.sqrt(gx * gx + gz * gz); if (l < 1e-6) { gx = 1; gz = 0; } else { gx /= l; gz /= l; }
  CQ[0] = -gx; CQ[1] = -gz; CQ[2] = d + 0.05; return true;
}
// the car against the town: its corners and flanks against buildings, water and the edge of the map, and the corners of
// the buildings against its sides. Pushes it out and takes the speed into the wall away (with a little friction).
function townCollide() {
  const V = VEH, P = VP, T = TOWN;
  for (let k = 0; k < 8; k++) {
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    const lx = k < 2 ? P.front : k < 4 ? -P.rear : k < 6 ? P.front * 0.35 : -P.rear * 0.35, lz = (k & 1) ? P.halfW : -P.halfW;
    const px = V.x + c * lx - s * lz, pz = V.z + s * lx + c * lz;
    if (!townBuildingQ(px, pz) && !townBlockedQ(px, pz)) continue;
    townImpact(CQ[0], CQ[1], CQ[2], c * lx - s * lz, s * lx + c * lz);
  }
  // building corners inside the car's box
  const c = Math.cos(V.yaw), s = Math.sin(V.yaw), rad = Math.max(P.front, P.rear) + 0.3;
  if (V.x < T.x0 + rad || V.z < T.z0 + rad) return;
  const cs = T.bcell, gi0 = ((V.x - rad - T.x0) / cs) | 0, gi1 = ((V.x + rad - T.x0) / cs) | 0, gj0 = ((V.z - rad - T.z0) / cs) | 0, gj1 = ((V.z + rad - T.z0) / cs) | 0;
  const st = T.bstart, it = T.bitems, bb = T.bbox, Pp = T.bd.p, off = T.bd.off;
  for (let gj = gj0; gj <= gj1; gj++) for (let gi = gi0; gi <= gi1; gi++) {
    if (gi >= T.bgw || gj >= T.bgh) continue; const kc = gj * T.bgw + gi;
    for (let m = st[kc]; m < st[kc + 1]; m++) {
      const b = it[m]; if (V.x + rad < bb[b * 4] || V.x - rad > bb[b * 4 + 2] || V.z + rad < bb[b * 4 + 1] || V.z - rad > bb[b * 4 + 3]) continue;
      for (let i = off[b]; i < off[b + 1]; i++) {
        const dx = Pp[i * 2] - V.x, dz = Pp[i * 2 + 1] - V.z, lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (lx > P.front || lx < -P.rear || lz > P.halfW || lz < -P.halfW) continue;
        // shortest way out of the box for this corner: through a side or the front/back
        const pzs = P.halfW - Math.abs(lz), pxs = lx > 0 ? P.front - lx : lx + P.rear;
        let nx, nz, d;
        if (pzs < pxs) { const sg = lz > 0 ? -1 : 1; nx = -s * sg; nz = c * sg; d = pzs; } else { const sg = lx > 0 ? -1 : 1; nx = c * sg; nz = s * sg; d = pxs; }
        townImpact(nx, nz, d + 0.02, dx, dz);
      }
    }
  }
}
// moves the car by depth d along (nx, nz) and applies the impact at the contact point r (relative to the centre)
function townImpact(nx, nz, d, rx, rz) {
  const V = VEH, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  if (d > 1.5) d = 1.5;
  V.x += nx * d; V.z += nz * d;
  let wvx = V.vx * c - V.vy * s, wvz = V.vx * s + V.vy * c; const vn = wvx * nx + wvz * nz;
  if (vn < 0) {
    const tgx = -nz, tgz = nx, vt = wvx * tgx + wvz * tgz;
    wvx -= nx * vn * 1.15; wvz -= nz * vn * 1.15;                       // no bounce to speak of: the wall takes the speed
    const fr = Math.min(0.45, 0.08 - vn * 0.04); wvx -= tgx * vt * fr; wvz -= tgz * vt * fr;   // scraping along it costs speed too
    V.vx = wvx * c + wvz * s; V.vy = -wvx * s + wvz * c;
    V.r += (rx * nz - rz * nx) * (-vn) * 0.25; V.r *= 0.8; V.hits++;
  }
}
