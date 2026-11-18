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
const TZ = { NONE: 0, ROAD: 1, PAVE: 2, HARD: 3, GRASS: 4, SAND: 5, MUD: 6, WOOD: 7, WATER: 8, KERB: 9, PATH: 10, TRACK: 11, GARDEN: 12, FIELD: 13, BLD: 14, OUT: 15, WALL: 16, DUNE: 17 };
const TZZ = new Uint8Array([2, 0, 6, 6, 2, 3, 4, 4, 4, 1, 6, 3, 2, 2, 6, 4, 6, 3]);
// (height of the drawn surface above the heightfield: the road ribbon 6 cm, the pavement slabs 19 cm, paths 5 cm; the car
// drives on what is drawn, and the values blend between 1 m cells so a kerb is a short ramp, never a step to snag on)
const TZH = new Float64Array([0, 0.06, 0.19, 0, 0, 0, 0, 0, 0, 0.08, 0.05, 0.05, 0, 0, 0, 0, 0, 0]);
// land cover classes of the bake (tools/osm/bake_wsm.py, LC) → surface code
// (land cover class of the bake -> raster code: ... 13 pitch, 14 dune, 15 allotment, 16 golf bunker)
const TOWN_LC = [TZ.NONE, TZ.GARDEN, TZ.GRASS, TZ.FIELD, TZ.WOOD, TZ.WOOD, TZ.SAND, TZ.MUD, TZ.WATER, TZ.HARD, TZ.NONE, TZ.GRASS, TZ.GRASS, TZ.GRASS, TZ.DUNE, TZ.FIELD, TZ.SAND];
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
  T.rh = A.rh || null;                   // road heights at the vertices (LIDAR DTM, dm; -32768: none)
  // per building (bake, LIDAR): the edge facing the street (255: none); chimney stacks and dormers, by building
  T.bfront = A.bfront || null;
  T.lmk = A.lmk || null;                 // landmark buildings: [index lo, index hi, code] (WSM_LANDMARKS in 34_wsm_world.js)
  T.chim = A.chxz ? { xz: A.chxz, b: A.chb, h: A.chh, n: A.chb.length } : null;
  // street furniture from OSM (x, z cm; code, sub-code: see FURN in the bake) and boundaries (walls, fences, hedges:
  // polylines + code, height dm, material)
  T.furn = A.fnxz ? { xz: A.fnxz, c: A.fnc, n: A.fnc.length / 2 } : null;
  T.bnd = A.wn ? Object.assign(townPolys(A.wn, A.w0, A.wxz, q), { info: A.winfo }) : null;
  T.dorm = A.dmxz ? { xz: A.dmxz, b: A.dmb, h: A.dmh, n: A.dmb.length } : null;
  if (A.ltn) {                           // LIDAR tree crowns: x, z, height
    const P = townPolys(A.ltn, A.lt0, A.ltd, q), n = P.off[P.n], L = T.ltrees = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { L[i * 3] = P.p[i * 2]; L[i * 3 + 1] = P.p[i * 2 + 1]; L[i * 3 + 2] = A.lth[i] * 0.25; }
  }
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
// ---------------------------------------------------------------- the carriageways' surface
// Every drivable road (classes 1-9, not bridges) gets a smooth height profile along its centre line, sampled every 2 m:
// the LIDAR ground heights at its vertices (medians of 3 x 3 m), with spikes removed (a 7-sample median) and smoothed
// (Gaussian, sigma 8 m on streets, 5 m on service roads and lanes). At each junction (road ends that meet, or a road
// ending on another) all the roads take the same height, the mean of theirs, and each profile is corrected towards it
// linearly between junctions. The heightfield then takes the road's height across its whole width and its pavements
// (level across, no cross-slope), the corridors of roads that overlap at a junction blend by inverse distance (no seams),
// and the ground beside them returns to the natural slope over a few metres (cut and fill).
const _med7 = new Float32Array(7);
function townRoadSurface(D, w, h, res) {
  const T = TOWN, R = T.rd, ri = T.rinfo, RH = T.rh, n = R.n, STEP = 2;
  const prof = new Array(n).fill(null);     // per road: {x, z, s, h} at STEP spacing
  const natural = (x, z) => { const fi = (x - T.x0) / res, fj = (z - T.z0) / res, i = Math.max(0, Math.min(w - 2, fi | 0)), j = Math.max(0, Math.min(h - 2, fj | 0)), u = fi - i, v = fj - j, k = j * w + i; return (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + w] * (1 - u) + D[k + w + 1] * u) * v; };
  for (let r = 0; r < n; r++) {
    const cls = ri[r * 4]; if (cls > 9 || (ri[r * 4 + 2] & 1)) continue;
    const k0 = R.off[r], k1 = R.off[r + 1]; if (k1 - k0 < 2) continue;
    let L = 0; for (let k = k0; k < k1 - 1; k++) L += Math.hypot(R.p[k * 2 + 2] - R.p[k * 2], R.p[k * 2 + 3] - R.p[k * 2 + 1]);
    const m = Math.max(2, Math.ceil(L / STEP) + 1), X = new Float32Array(m), Z = new Float32Array(m), S = new Float32Array(m), H = new Float32Array(m);
    let k = k0, acc = 0, segL = Math.hypot(R.p[k * 2 + 2] - R.p[k * 2], R.p[k * 2 + 3] - R.p[k * 2 + 1]);
    for (let q = 0; q < m; q++) {
      const sq = Math.min(L, q * L / (m - 1));
      while (k < k1 - 2 && acc + segL < sq) { acc += segL; k++; segL = Math.hypot(R.p[k * 2 + 2] - R.p[k * 2], R.p[k * 2 + 3] - R.p[k * 2 + 1]); }
      const f = segL > 1e-6 ? Math.max(0, Math.min(1, (sq - acc) / segL)) : 0;
      X[q] = R.p[k * 2] + (R.p[k * 2 + 2] - R.p[k * 2]) * f; Z[q] = R.p[k * 2 + 1] + (R.p[k * 2 + 3] - R.p[k * 2 + 1]) * f; S[q] = sq;
      const ha = RH[k], hb = RH[k + 1];
      H[q] = ha !== -32768 && hb !== -32768 ? (ha + (hb - ha) * f) * 0.1 : natural(X[q], Z[q]);
    }
    // spikes out (a 7-sample median), then a Gaussian along the road
    const M = new Float32Array(m);
    for (let q = 0; q < m; q++) {
      for (let e = 0; e < 7; e++) { const v = H[Math.max(0, Math.min(m - 1, q + e - 3))]; let k = e; while (k > 0 && _med7[k - 1] > v) { _med7[k] = _med7[k - 1]; k--; } _med7[k] = v; }
      M[q] = _med7[3];
    }
    const sg = (cls <= 6 ? 8 : 5) / STEP, rad = Math.ceil(sg * 2.5);
    for (let q = 0; q < m; q++) { let sw = 0, sh = 0; for (let e = -rad; e <= rad; e++) { const g = Math.exp(-e * e / (2 * sg * sg)), qq = Math.max(0, Math.min(m - 1, q + e)); sw += g; sh += M[qq] * g; } H[q] = sh / sw; }
    prof[r] = { x: X, z: Z, s: S, h: H, L, cls, pins: [] };
  }
  // junctions: road ends meeting (within 1.2 m), and road ends on another road's centre line (T-junctions)
  const G = new Map(), cell = 24, key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);   // segments, by 24 m cells
  for (let r = 0; r < n; r++) { const P = prof[r]; if (!P) continue; for (let q = 0; q < P.x.length - 1; q++) { const kk = key(P.x[q], P.z[q]); let l = G.get(kk); if (!l) G.set(kk, l = []); l.push(r, q); } }
  const nodes = [], NG = new Map(), nkey = (x, z) => Math.round(x / 2) + ',' + Math.round(z / 2);   // nodes: {x, z, m: [r, q, f]...}
  for (let r = 0; r < n; r++) {
    const P = prof[r]; if (!P) continue;
    for (const q of [0, P.x.length - 1]) {
      const x = P.x[q], z = P.z[q]; let node = null;
      for (let dz = -1; dz <= 1 && !node; dz++) for (let dx = -1; dx <= 1 && !node; dx++) {
        const l = NG.get((Math.round(x / 2) + dx) + ',' + (Math.round(z / 2) + dz)); if (!l) continue;
        for (const nd of l) if (Math.abs(nd.x - x) < 1.2 && Math.abs(nd.z - z) < 1.2) { node = nd; break; }
      }
      if (!node) { node = { x, z, m: [] }; nodes.push(node); const kk = nkey(x, z); let l = NG.get(kk); if (!l) NG.set(kk, l = []); l.push(node); }
      node.m.push(r, q, 0);
    }
  }
  // a road that ends on another one's centre line (a T-junction whose shared vertex the other road no longer keeps)
  for (const nd of nodes) {
    if (nd.m.length !== 3) continue;
    const r0 = nd.m[0]; let best = 1e9, br = -1, bq = 0, bf = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = G.get((Math.floor(nd.x / cell) + dx) + ',' + (Math.floor(nd.z / cell) + dz)); if (!l) continue;
      for (let e = 0; e < l.length; e += 2) {
        const r = l[e], q = l[e + 1]; if (r === r0) continue; const P = prof[r];
        const ax = P.x[q], az = P.z[q], bx = P.x[q + 1], bz = P.z[q + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez + 1e-9;
        const f = Math.max(0, Math.min(1, ((nd.x - ax) * ex + (nd.z - az) * ez) / l2)), d = Math.hypot(nd.x - ax - ex * f, nd.z - az - ez * f);
        if (d < Math.max(1.5, ri[r * 4 + 1] * 0.05 + 0.5) && d < best) { best = d; br = r; bq = q; bf = f; }
      }
    }
    if (br >= 0) nd.m.push(br, bq, bf);
  }
  // node heights: the mean of the members' heights there; each member pinned to it
  const hAt = (P, q, f) => P.h[q] + (P.h[Math.min(P.h.length - 1, q + 1)] - P.h[q]) * f;
  for (const nd of nodes) {
    if (nd.m.length < 6) continue;   // (a dead end: free)
    let sh = 0, c = 0; for (let e = 0; e < nd.m.length; e += 3) { sh += hAt(prof[nd.m[e]], nd.m[e + 1], nd.m[e + 2]); c++; }
    nd.y = sh / c;
    for (let e = 0; e < nd.m.length; e += 3) { const P = prof[nd.m[e]], q = nd.m[e + 1], f = nd.m[e + 2]; P.pins.push(P.s[q] + (P.s[Math.min(P.s.length - 1, q + 1)] - P.s[q]) * f, nd.y - hAt(P, q, f)); }
  }
  // corrections: linear between pins along each road, fading out over 40 m beyond the outermost ones
  for (let r = 0; r < n; r++) {
    const P = prof[r]; if (!P || !P.pins.length) continue;
    const pins = []; for (let e = 0; e < P.pins.length; e += 2) pins.push([P.pins[e], P.pins[e + 1]]); pins.sort((a, b) => a[0] - b[0]);
    for (let q = 0; q < P.h.length; q++) {
      const s = P.s[q]; let dh;
      if (s <= pins[0][0]) dh = pins[0][1] * Math.max(0, 1 - (pins[0][0] - s) / 40);
      else if (s >= pins[pins.length - 1][0]) { const p = pins[pins.length - 1]; dh = p[1] * Math.max(0, 1 - (s - p[0]) / 40); }
      else { let e = 0; while (e < pins.length - 2 && pins[e + 1][0] < s) e++; const a = pins[e], b = pins[e + 1], f = (s - a[0]) / Math.max(1e-6, b[0] - a[0]); dh = a[1] + (b[1] - a[1]) * f; }
      P.h[q] += dh;
    }
  }
  // The heightfield, rank by rank (main roads first): each road takes its height across its carriageway and pavements
  // (level across), the ground beside it returns to the natural slope (cut and fill). A lesser road that runs into the
  // carriageway of a more important one is first re-pinned where it meets that carriageway's edge, to the height
  // already laid there (a side street joins a main road at the main road's own level, with no step); inside it, the more
  // important road keeps its surface. Roads of the same rank that overlap blend by inverse distance.
  const rank = c => c <= 3 ? 0 : c === 4 ? 1 : c <= 6 ? 2 : c === 7 ? 3 : c === 8 ? 4 : 5;
  const wsum = new Float32Array(w * h), hsum = new Float32Array(w * h), blend = new Float32Array(w * h), owner = new Uint8Array(w * h).fill(255), surf = new Float32Array(w * h);
  const cellOf = (x, z) => { const i = Math.round((x - T.x0) / res), j = Math.round((z - T.z0) / res); return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i; };
  const correct = (P, pins) => {   // piecewise-linear corrections between pins, fading out over 40 m beyond the outermost
    pins.sort((a, b) => a[0] - b[0]);
    for (let q = 0; q < P.h.length; q++) {
      const s0 = P.s[q]; let dh;
      if (s0 <= pins[0][0]) dh = pins[0][1] * Math.max(0, 1 - (pins[0][0] - s0) / 40);
      else if (s0 >= pins[pins.length - 1][0]) { const p = pins[pins.length - 1]; dh = p[1] * Math.max(0, 1 - (s0 - p[0]) / 40); }
      else { let e = 0; while (e < pins.length - 2 && pins[e + 1][0] < s0) e++; const pa = pins[e], pb = pins[e + 1], f = (s0 - pa[0]) / Math.max(1e-6, pb[0] - pa[0]); dh = pa[1] + (pb[1] - pa[1]) * f; }
      P.h[q] += dh;
    }
  };
  for (let rk = 0; rk <= 5; rk++) {
    // (1) re-pin where this rank's roads meet the carriageways already laid
    if (rk > 0) for (let r = 0; r < n; r++) {
      const P = prof[r]; if (!P || rank(P.cls) !== rk) continue;
      const m = P.x.length, pins = []; let prevIn = -1;
      for (let q = 0; q < m; q++) {
        const o = cellOf(P.x[q], P.z[q]), inside = o >= 0 && owner[o] < rk ? 1 : 0;
        if (prevIn >= 0 && inside !== prevIn) {
          const qo = inside ? q - 1 : q, qi = inside ? q : q - 1, oi = cellOf(P.x[qi], P.z[qi]);
          if (oi >= 0) pins.push([P.s[qo], surf[oi] - P.h[qo]]);
        }
        prevIn = inside;
      }
      if (pins.length) correct(P, pins);
    }
    // (2) lay this rank's roads outside the carriageways already laid
    for (let r = 0; r < n; r++) {
      const P = prof[r]; if (!P || rank(P.cls) !== rk) continue;
      const cls = P.cls, core = ri[r * 4 + 1] * 0.05 + 0.7 + ((ri[r * 4 + 2] & 32) ? 0 : ROAD_PAVE[cls] || 0), fall = cls <= 7 ? 3.5 : 2.5, rad = core + fall;
      for (let q = 0; q < P.x.length - 1; q++) {
        const ax = P.x[q], az = P.z[q], bx = P.x[q + 1], bz = P.z[q + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez + 1e-9;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad - T.x0) / res)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + rad - T.x0) / res));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - rad - T.z0) / res)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + rad - T.z0) / res));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const o = j * w + i; if (owner[o] < rk) continue;
          const px = T.x0 + i * res, pz = T.z0 + j * res; let t = ((px - ax) * ex + (pz - az) * ez) / l2;
          if ((t < -0.5 && q > 0) || (t > 1.5 && q < P.x.length - 2)) continue;   // (neighbouring segments overlap at bends)
          const tc = t < 0 ? 0 : t > 1 ? 1 : t, d = Math.hypot(px - ax - ex * tc, pz - az - ez * tc); if (d >= rad) continue;
          let wg = d <= core ? 1 : 1 - (d - core) / fall; wg = wg * wg * (3 - 2 * wg);
          const hr = P.h[q] + (P.h[q + 1] - P.h[q]) * tc, wi = wg / (0.5 + d * d);
          wsum[o] += wi; hsum[o] += wi * hr; if (wg > blend[o]) blend[o] = wg;
          if (wg >= 1 && owner[o] === 255) owner[o] = 254;   // (this rank's carriageway: committed below)
        }
      }
    }
    // (3) commit this rank's carriageways
    for (let o = 0; o < w * h; o++) if (owner[o] === 254) { owner[o] = rk; surf[o] = hsum[o] / wsum[o]; }
  }
  for (let o = 0; o < w * h; o++) if (blend[o] > 0) D[o] += ((owner[o] < 255 ? surf[o] : hsum[o] / wsum[o]) - D[o]) * blend[o];
  // junctions where a lesser road meets a more important one: [minor road, its end (0 first / 1 last), the major road's
  // half width] (for the give-way lines)
  const J = T.junc = [];
  for (const nd of nodes) {
    if (nd.m.length < 6) continue;
    let rmin = 9, hwMaj = 0; for (let e = 0; e < nd.m.length; e += 3) { const rk = rank(prof[nd.m[e]].cls); if (rk < rmin) rmin = rk; }
    for (let e = 0; e < nd.m.length; e += 3) { const r = nd.m[e]; if (rank(prof[r].cls) === rmin) hwMaj = Math.max(hwMaj, ri[r * 4 + 1] * 0.05); }
    for (let e = 0; e < nd.m.length; e += 3) {
      const r = nd.m[e], q = nd.m[e + 1], P = prof[r]; if (rank(P.cls) <= rmin || P.cls > 8) continue;
      if (q !== 0 && q !== P.x.length - 1) continue;
      J.push(r, q === 0 ? 0 : 1, hwMaj);
    }
  }
  T.rprof = prof; T.roadNodes = nodes.length;
}
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
  // roads on their own surface: smooth profiles, level across, one height at each junction (townRoadSurface)
  if (T.rh) townRoadSurface(D, w, h, res);
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
  townAiRoom();
}
// The autopilot's room on each side of the circuit, kept a metre inside the carriageway as drawn (the 1 m raster), so its
// wheels stay off the kerbs (the baked room came from a coarser road mask)
function townAiRoom() {
  const T = TOWN, N = TRK.N, o = new Float64Array(5), L = TRK.aiL, Rr = TRK.aiR, e2 = new Float32Array(N * 2);
  const road = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; if (i < 0 || j < 0 || i >= T.zw || j >= T.zh) return false; const c = T.zone[j * T.zw + i]; return c === TZ.ROAD || c === TZ.KERB; };
  for (let i = 0; i < N; i++) {
    trackPos(i * TRK.ds, 0, o); const x = o[0], z = o[2], nx = -o[4], nz = o[3];
    for (let sd = 0; sd < 2; sd++) { const sg = sd ? 1 : -1; let e = 0; while (e < 15 && road(x + nx * e * sg, z + nz * e * sg)) e += 0.1; e2[i * 2 + sd] = e; }
  }
  for (let i = 0; i < N; i++) {
    let mL = 1e9, mR = 1e9; for (let q = -6; q <= 6; q++) { const k = ((i + q) % N + N) % N; mL = Math.min(mL, e2[k * 2]); mR = Math.min(mR, e2[k * 2 + 1]); }
    L[i] = Math.max(0.3, Math.min(L[i], mL - 1.05)); Rr[i] = Math.max(0.3, Math.min(Rr[i], mR - 1.05));
  }
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
  // unmapped ground under the LIDAR's tree crowns is woodland floor (scrub under the small ones): Weston Woods below the
  // Toll Road
  if (T.ltrees) {
    const L = T.ltrees;
    for (let q = 0; q < L.length; q += 3) {
      const rr = Math.min(6, Math.max(2.5, L[q + 2] * 0.4)), ci = (L[q] - T.x0) | 0, cj = (L[q + 1] - T.z0) | 0, n = Math.ceil(rr);
      for (let j = Math.max(0, cj - n); j <= Math.min(zh - 1, cj + n); j++) for (let i = Math.max(0, ci - n); i <= Math.min(zw - 1, ci + n); i++)
        if ((i - ci) * (i - ci) + (j - cj) * (j - cj) <= rr * rr && Z[j * zw + i] === TZ.NONE) Z[j * zw + i] = TZ.WOOD;
    }
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
  townSeaWalls(); { const W = T.walls, ov = new Uint8Array(18).fill(1); ov[TZ.WATER] = 0; ov[TZ.OUT] = 0; for (let i = 0; i < W.length; i += 6) townCapsule(W[i], W[i + 1], W[i + 2], W[i + 3], 0.7, TZ.WALL, ov); }
  // roads: pavements, then carriageways over them (junctions), paths and tracks only over soft ground
  const R = T.rd, ri = T.rinfo, soft = new Uint8Array(18), all = new Uint8Array(18).fill(1), pv = new Uint8Array(18);
  for (const c of [TZ.NONE, TZ.GRASS, TZ.GARDEN, TZ.FIELD, TZ.WOOD, TZ.MUD, TZ.SAND, TZ.HARD, TZ.DUNE]) soft[c] = 1;
  for (const c of [TZ.NONE, TZ.GRASS, TZ.GARDEN, TZ.FIELD, TZ.WOOD, TZ.HARD, TZ.PATH, TZ.TRACK]) pv[c] = 1;
  all[TZ.WATER] = 0; all[TZ.OUT] = 0;
  for (let pass = 0; pass < 3; pass++) for (let q = 0; q < R.n; q++) {
    const cls = ri[q * 4], wd = ri[q * 4 + 1] * 0.1; if (cls === 12) continue;
    let rad, val, over;
    if (pass === 0) { if (!ROAD_PAVE[cls] || (ri[q * 4 + 2] & 32)) continue; rad = wd / 2 + ROAD_PAVE[cls]; val = TZ.PAVE; over = pv; }
    else if (pass === 1) { if (cls < 10) continue; rad = wd / 2; val = cls === 10 ? TZ.PATH : TZ.TRACK; over = soft; }
    else { if (cls > 9) continue; rad = wd / 2; val = cls === 9 ? TZ.HARD : TZ.ROAD; over = all; }
    for (let k = R.off[q]; k < R.off[q + 1] - 1; k++) townCapsule(R.p[k * 2], R.p[k * 2 + 1], R.p[k * 2 + 2], R.p[k * 2 + 3], rad, val, over);
  }
  // circuit kerbs
  const N = TRK.N, kb = T.kerb, ov = new Uint8Array(18); ov[TZ.ROAD] = 1; ov[TZ.PAVE] = 1; ov[TZ.KERB] = 1;
  for (let i = 0; i < N; i++) {
    const sd = kb[i * 2]; if (!sd) continue; const e = kb[i * 2 + 1], nx = -TRK.tz[i] * sd, nz = TRK.tx[i] * sd;
    townCapsule(TRK.x[i] + nx * (e - 0.45), TRK.z[i] + nz * (e - 0.45), TRK.x[(i + 1) % N] + nx * (e - 0.45), TRK.z[(i + 1) % N] + nz * (e - 0.45), 0.5, TZ.KERB, ov);
  }
  townTollFurniture(); townBoundaries(); townCapsBuild(); {
    const B = T.tollRails, W = T.tollWalls, ov = new Uint8Array(18).fill(1); ov[TZ.WATER] = 0; ov[TZ.OUT] = 0; ov[TZ.ROAD] = 0;
    for (let i = 0; i < B.length; i += 5) townCapsule(B[i], B[i + 1], B[i + 2], B[i + 3], 0.35, TZ.WALL, ov);
    for (let i = 0; i < W.length; i += 6) townCapsule(W[i], W[i + 1], W[i + 2], W[i + 3], 0.3, TZ.WALL, ov);
  }
  // out of bounds: a 12 m band at the edge of the region
  for (let j = 0; j < zh; j++) for (let i = 0; i < zw; i++) if (i < 12 || j < 12 || i >= zw - 12 || j >= zh - 12) Z[j * zw + i] = TZ.OUT;
}
// The sea wall: along the edges of the beach polygons, wherever the ground just inland stands a metre or more above the
// sand just seaward, a grey stone wall from the sand to a parapet 0.9 m above the promenade (solid; gaps at the slipways).
function townSeaWalls() {
  const T = TOWN, A = T.ad, ai = T.ainfo, W = T.walls, Z = T.zone, natural = new Uint8Array(18); let r = 0; W.length = 0;
  for (const c of [TZ.DUNE, TZ.GRASS, TZ.WOOD, TZ.FIELD, TZ.GARDEN]) natural[c] = 1;
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
          if (mz < -2000) continue;      // north of Worlebury Hill (Sand Bay, Sand Point, Middle Hope) the shore is natural
          const hb = hfAt(mx + ix * 5, mz + iz * 5), hl = Math.max(hfAt(mx - ix * 4, mz - iz * 4), hfAt(mx - ix * 7, mz - iz * 7));
          if (hl - hb < 1.0) continue;
          // a promenade stands behind a sea wall; dunes, grass and woods slope down to the beach (Sand Bay, Uphill)
          const zc = Z[Math.min(T.zh - 1, Math.max(0, (mz - iz * 6 - T.z0) | 0)) * T.zw + Math.min(T.zw - 1, Math.max(0, (mx - ix * 6 - T.x0) | 0))];
          if (natural[zc]) continue;
          W.push(x0, z0, x1, z1, Math.min(hb, hfAt(mx, mz)) - 0.6, hl + 0.9);
        }
      }
    }
    r += nr;
  }
}
// Along the Toll Road (flag 128), every 4 m on each side: the natural slope 4 m out against the road's own height.
// tollWalls: [ax, az, bx, bz, foot, top] (stone, uphill); tollRails: [ax, az, bx, bz, y] (steel barrier, drop side).
function townTollFurniture() {
  const T = TOWN, R = T.rd, ri = T.rinfo; T.tollWalls = []; T.tollRails = [];
  for (let r = 0; r < R.n; r++) {
    if (!(ri[r * 4 + 2] & 128)) continue;
    const hw = ri[r * 4 + 1] * 0.05;
    for (const sd of [-1, 1]) {
      // 4 m steps along this side: x0, z0, x1, z1, the normal, the road's height and the natural ground 4 m beyond the edge
      const S = [];
      for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
        const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        const m = Math.ceil(L / 4), nx = -(bz - az) / L * sd, nz = (bx - ax) / L * sd;
        for (let q = 0; q < m; q++) {
          const x0 = ax + (bx - ax) * q / m, z0 = az + (bz - az) * q / m, x1 = ax + (bx - ax) * (q + 1) / m, z1 = az + (bz - az) * (q + 1) / m, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          S.push(x0, z0, x1, z1, nx, nz, hfAt(mx, mz), townH(mx + nx * (hw + 4), mz + nz * (hw + 4)));
        }
      }
      const n = S.length / 8, cut = j => S[j * 8 + 7] - S[j * 8 + 6];
      // runs: started where test() holds, grown while keep() holds, kept when at least 3 steps (12 m) long
      const runs = (test, keep, emit) => {
        for (let i = 0; i < n;) {
          if (!test(i)) { i++; continue; }
          let a = i, b = i; while (a > 0 && keep(a - 1)) a--; while (b < n - 1 && keep(b + 1)) b++;
          if (b - a >= 2) for (let j = a; j <= b; j++) emit(j);
          i = b + 1;
        }
      };
      // the photographs show mostly steep banks of ivy and bramble on the uphill side, old stone revetments only where
      // the road is cut deepest; steel barriers where the ground falls away towards Sand Bay
      runs(j => cut(j) > 3.0, j => cut(j) > 2.3, j => { const o = hw + 0.6, k = j * 8, yr = S[k + 6]; T.tollWalls.push(S[k] + S[k + 4] * o, S[k + 1] + S[k + 5] * o, S[k + 2] + S[k + 4] * o, S[k + 3] + S[k + 5] * o, yr - 0.4, yr + Math.min(2.2, cut(j) - 0.6)); });
      runs(j => -cut(j) > 3.0, j => -cut(j) > 2.0, j => { const o = hw + 0.45, k = j * 8; T.tollRails.push(S[k] + S[k + 4] * o, S[k + 1] + S[k + 5] * o, S[k + 2] + S[k + 4] * o, S[k + 3] + S[k + 5] * o, S[k + 6]); });
    }
  }
}
// grid of building indices (16 m cells) for the collisions
function townBuildingGrid() {
  const T = TOWN, c = T.bcell, gw = T.bgw = Math.ceil((T.x1 - T.x0) / c), gh = T.bgh = Math.ceil((T.z1 - T.z0) / c), bb = T.bbox, n = T.bd.n;
  const cnt = new Int32Array(gw * gh + 1);
  const each = (b, f) => { const i0 = Math.max(0, Math.floor((bb[b * 4] - T.x0) / c)), i1 = Math.min(gw - 1, Math.floor((bb[b * 4 + 2] - T.x0) / c)), j0 = Math.max(0, Math.floor((bb[b * 4 + 1] - T.z0) / c)), j1 = Math.min(gh - 1, Math.floor((bb[b * 4 + 3] - T.z0) / c)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * gw + i); };
  // a building a drivable road runs through for 3 m or more is a passage (an archway, a covered yard, or a mapping slip):
  // it stays drawn but the cars pass
  const pass = T.bpass = new Uint8Array(n), hit = new Uint16Array(n), tg = new Map();
  for (let b = 0; b < n; b++) each(b, k => { let l = tg.get(k); if (!l) tg.set(k, l = []); l.push(b); });
  const R = T.rd, ri = T.rinfo, Pp = T.bd.p, off = T.bd.off;
  for (let r = 0; r < R.n; r++) {
    if (ri[r * 4] > 9 || (ri[r * 4 + 2] & 1)) continue;
    for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az), m = Math.ceil(L);
      for (let q = 0; q < m; q++) {
        const x = ax + (bx - ax) * (q + 0.5) / m, z = az + (bz - az) * (q + 0.5) / m, l = tg.get(Math.floor((z - T.z0) / c) * gw + Math.floor((x - T.x0) / c)); if (!l) continue;
        for (const b of l) {
          if (x < bb[b * 4] || x > bb[b * 4 + 2] || z < bb[b * 4 + 1] || z > bb[b * 4 + 3]) continue;
          let inside = false; for (let i = off[b], j = off[b + 1] - 1; i < off[b + 1]; j = i++) { const zi = Pp[i * 2 + 1], zj = Pp[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (Pp[j * 2] - Pp[i * 2]) * (z - zi) / (zj - zi) + Pp[i * 2]) inside = !inside; }
          if (inside && ++hit[b] >= 3) pass[b] = 1;
        }
      }
    }
  }
  let np = 0; for (let b = 0; b < n; b++) np += pass[b]; T.nPass = np;
  const solid = b => T.binfo[b * 8] !== 8 && T.binfo[b * 8] !== 11 && !pass[b];   // (the pier pavilion stands on the deck above the beach; shelters are open)
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
    d[j * w + i] = c === TZ.WATER || c === TZ.OUT ? 1e9 : 0;   // (walls and barriers: exact capsules, townCapsQ)
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

// Boundaries as straight segments [ax, az, bx, bz, code, height (0 = default), look (0 stone, 2 brick, 3 render)]:
// OSM's walls (1), fences (2), hedges (3), retaining walls (4), railings (5) and crash barriers (6), then the defaults OSM
// leaves out: a low wall (or hedge) across each house's street front at the back of the pavement, with a gap for its
// path; and along the village and country lanes (Kewstoke, Sand Bay, the lanes beyond the town) where there is no
// pavement, grey stone walls or hedgerows on both sides, broken at junctions, drives and gateways.
function townBoundaries() {
  const T = TOWN, Z = T.zone, zw = T.zw, out = T.bsegs = [], R = T.rd, ri = T.rinfo;
  const zoneAt = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= zw || j >= T.zh ? TZ.OUT : Z[j * zw + i]; };
  const B = T.bnd;
  if (B) for (let w = 0; w < B.n; w++) {
    const code = B.info[w * 3] === 7 ? 2 : B.info[w * 3], hgt = B.info[w * 3 + 1] * 0.1, matl = B.info[w * 3 + 2];
    for (let k = B.off[w]; k < B.off[w + 1] - 1; k++) {   // (in pieces of 3 m or less: one that crosses a road is dropped there)
      const ax = B.p[k * 2], az = B.p[k * 2 + 1], bx = B.p[k * 2 + 2], bz = B.p[k * 2 + 3], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
      for (let q = 0; q < m; q++) out.push(ax + (bx - ax) * q / m, az + (bz - az) * q / m, ax + (bx - ax) * (q + 1) / m, az + (bz - az) * (q + 1) / m, code, hgt, matl === 2 ? 2 : 0);
    }
  }
  // front-garden walls
  const BD = T.bd, bi = T.binfo, bfr = T.bfront; let nw = 0;
  if (bfr) for (let b = 0; b < BD.n; b++) {
    const kind = bi[b * 8]; if (kind !== 0 && kind !== 1 && kind !== 10) continue;
    const e = bfr[b]; if (e === 255) continue;
    const k0 = BD.off[b], n = BD.off[b + 1] - k0; if (e >= n) continue;
    const ax = BD.p[(k0 + e) * 2], az = BD.p[(k0 + e) * 2 + 1], bx = BD.p[(k0 + (e + 1) % n) * 2], bz = BD.p[(k0 + (e + 1) % n) * 2 + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 3 || L > 30) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let d = 1; for (; d < 12; d += 0.5) { const zc = zoneAt(mx + nx * d, mz + nz * d); if (zc === TZ.PAVE || zc === TZ.ROAD || zc === TZ.BLD) break; }
    if (d < 1.8 || d >= 12 || zoneAt(mx + nx * d, mz + nz * d) === TZ.BLD) continue;
    const off = d - 0.3, look = bi[b * 8 + 6] >> 4, h = bi[b * 8 + 4], stone = look === 4 || look === 3 || (h & 3) === 0, hedge = !stone && (bi[b * 8 + 5] & 3) === 1;
    const tx = (bx - ax) / L, tz = (bz - az) / L, g0 = L / 2 - 0.55, p0x = ax + nx * off, p0z = az + nz * off, p1x = bx + nx * off, p1z = bz + nz * off;
    const code = hedge ? 3 : 1, hg = hedge ? 1.1 : 0.85, lk = stone ? 0 : 2;
    out.push(p0x, p0z, p0x + tx * g0, p0z + tz * g0, code, hg, lk, p1x - tx * g0, p1z - tz * g0, p1x, p1z, code, hg, lk); nw++;
    // the front garden itself: paved (flags, gravel, a parking space) in half the town's terraces, a lawn elsewhere
    const central = Math.hypot((mx - 250) / 1300, (mz + 150) / 1000) < 1;
    if ((kind === 1 || central) && ((bi[b * 8 + 4] >> 2) & 1)) {
      const x0 = Math.floor(Math.min(ax, bx, p0x, p1x) - T.x0), x1 = Math.ceil(Math.max(ax, bx, p0x, p1x) - T.x0), z0 = Math.floor(Math.min(az, bz, p0z, p1z) - T.z0), z1 = Math.ceil(Math.max(az, bz, p0z, p1z) - T.z0);
      for (let j = Math.max(0, z0); j <= Math.min(T.zh - 1, z1); j++) for (let i = Math.max(0, x0); i <= Math.min(zw - 1, x1); i++) {
        const px = T.x0 + i + 0.5, pz = T.z0 + j + 0.5, u = (px - ax) * tx + (pz - az) * tz, v = (px - ax) * nx + (pz - az) * nz;
        if (u > 0.2 && u < L - 0.2 && v > 0.1 && v < off - 0.2) { const o = j * zw + i; if (Z[o] === TZ.GARDEN || Z[o] === TZ.NONE || Z[o] === TZ.GRASS) Z[o] = TZ.HARD; }
      }
    }
  }
  // village and country lanes
  let nv = 0;
  const village = (x, z) => (x > 1300 && x < 2500 && z > -2300 && z < -1450) || z < -2300;
  for (let r = 0; r < R.n; r++) {
    const cls = ri[r * 4], fl = ri[r * 4 + 2]; if (cls < 4 || cls > 8 || (fl & 129)) continue;
    const hw = ri[r * 4 + 1] * 0.05;
    for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 2) continue;
      if (!village((ax + bx) / 2, (az + bz) / 2)) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx, m = Math.ceil(L / 4);
      const old = Math.hypot((ax + bx) / 2 - 1778, (az + bz) / 2 + 1891) < 420;   // (the old village round St Paul's: tall stone walls)
      for (const sd of [-1, 1]) {
        const style = hash2(r * 3 + (sd > 0 ? 1 : 0), 41) < (old ? 0.88 : 0.55) ? 1 : 3;
        for (let q = 0; q < m; q++) {
          const f0 = q / m, f1 = (q + 1) / m, o = hw + 0.5, x0 = ax + (bx - ax) * f0 + nx * sd * o, z0 = az + (bz - az) * f0 + nz * sd * o, x1 = ax + (bx - ax) * f1 + nx * sd * o, z1 = az + (bz - az) * f1 + nz * sd * o;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, zc = zoneAt(mx, mz); if (zc !== TZ.GARDEN && zc !== TZ.FIELD && zc !== TZ.NONE && zc !== TZ.GRASS && zc !== TZ.WOOD) continue;
          const zo = zoneAt(mx + nx * sd * 1.5, mz + nz * sd * 1.5); if (zo === TZ.ROAD || zo === TZ.PATH || zo === TZ.TRACK || zo === TZ.BLD) continue;   // (a junction, a drive, a path)
          if (hash2(r * 131 + k * 7 + q, sd + 5) < 0.06) continue;                                                                                // (a gateway)
          out.push(x0, z0, x1, z1, style, style === 1 ? (old ? 1.45 + 0.5 * hash2(r, 3 + sd) : 1.1 + 0.3 * hash2(r, 3)) : 1.6, 0); nv++;
        }
      }
    }
  }
  T.nGardenWalls = nw; T.nLaneWalls = nv;
}
// Walls and barriers the cars can hit, as capsules [ax, az, bx, bz, radius]: the Toll Road's steel barriers (on their
// line) and retaining walls, the sea wall (its face to the beach). Gridded by 16 m cells; queried exactly (the 2 m
// distance field would blur a 30 cm wall into the lane next to it).
function townCapsBuild() {
  const T = TOWN, c = 16, gw = Math.ceil((T.x1 - T.x0) / c), gh = Math.ceil((T.z1 - T.z0) / c), C = [];
  const B = T.tollRails || [], Wt = T.tollWalls || [], Ws = T.walls || [];
  for (let i = 0; i < B.length; i += 5) C.push(B[i], B[i + 1], B[i + 2], B[i + 3], 0.15);
  for (let i = 0; i < Wt.length; i += 6) C.push(Wt[i], Wt[i + 1], Wt[i + 2], Wt[i + 3], 0.3);
  for (let i = 0; i < Ws.length; i += 6) C.push(Ws[i], Ws[i + 1], Ws[i + 2], Ws[i + 3], 0.45);
  const BS = T.bsegs || [], Z = T.zone;   // walls, fences and hedges, except where one would cross a road or a pavement
  const nearRoad = (x, z) => { for (let dz = -0.8; dz <= 0.8; dz += 0.8) for (let dx = -0.8; dx <= 0.8; dx += 0.8) { const i = (x + dx - T.x0) | 0, j = (z + dz - T.z0) | 0; if (i < 0 || j < 0 || i >= T.zw || j >= T.zh) continue; const c = Z[j * T.zw + i]; if (c === TZ.ROAD || c === TZ.PAVE || c === TZ.KERB) return true; } return false; };
  for (let i = 0; i < BS.length; i += 7) {
    const code = BS[i + 4]; if (code === 6 || code === 5) continue;
    if (nearRoad(BS[i], BS[i + 1]) || nearRoad(BS[i + 2], BS[i + 3]) || nearRoad((BS[i] + BS[i + 2]) / 2, (BS[i + 1] + BS[i + 3]) / 2)) continue;   // (never in a road's way)
    C.push(BS[i], BS[i + 1], BS[i + 2], BS[i + 3], code === 3 ? 0.45 : 0.2);
  }
  const n = C.length / 5, cnt = new Int32Array(gw * gh + 1), cells = [];
  for (let q = 0; q < n; q++) {
    const r = C[q * 5 + 4] + 0.1, i0 = Math.max(0, Math.floor((Math.min(C[q * 5], C[q * 5 + 2]) - r - T.x0) / c)), i1 = Math.min(gw - 1, Math.floor((Math.max(C[q * 5], C[q * 5 + 2]) + r - T.x0) / c));
    const j0 = Math.max(0, Math.floor((Math.min(C[q * 5 + 1], C[q * 5 + 3]) - r - T.z0) / c)), j1 = Math.min(gh - 1, Math.floor((Math.max(C[q * 5 + 1], C[q * 5 + 3]) + r - T.z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { cells.push(j * gw + i, q); cnt[j * gw + i + 1]++; }
  }
  for (let k = 0; k < gw * gh; k++) cnt[k + 1] += cnt[k];
  const it = new Int32Array(cnt[gw * gh]), fill = cnt.slice(); for (let e = 0; e < cells.length; e += 2) it[fill[cells[e]]++] = cells[e + 1];
  T.caps = new Float32Array(C); T.capStart = cnt; T.capItems = it; T.capW = gw; T.capH = gh;
}
function townOnRoad(x, z) {
  const T = TOWN, i = (x - T.x0) | 0, j = (z - T.z0) | 0;
  return i >= 0 && j >= 0 && i < T.zw && j < T.zh && T.zone[j * T.zw + i] === TZ.ROAD;
}
function townCapsQ(x, z) {
  const T = TOWN; CQ[2] = 0; if (!T.caps) return false;
  const gi = ((x - T.x0) / 16) | 0, gj = ((z - T.z0) / 16) | 0; if (gi < 0 || gj < 0 || gi >= T.capW || gj >= T.capH) return false;
  const k = gj * T.capW + gi, st = T.capStart, it = T.capItems, C = T.caps; let found = false;
  for (let m = st[k]; m < st[k + 1]; m++) {
    const q = it[m] * 5, ax = C[q], az = C[q + 1], ex = C[q + 2] - ax, ez = C[q + 3] - az, r = C[q + 4];
    let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez + 1e-9); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - ex * t, dz = z - az - ez * t, d = Math.sqrt(dx * dx + dz * dz);
    if (d < r && r - d > CQ[2]) { CQ[0] = d > 1e-6 ? dx / d : 1; CQ[1] = d > 1e-6 ? dz / d : 0; CQ[2] = r - d + 0.02; found = true; }   // (pushed away from the wall's axis)
  }
  return found;
}

// ---------- physics (no allocation: registers and typed arrays only) ----------
// ground under q = _gq (q[0] = x, q[1] = z): q[8] = height, returns the game zone. wi < 0: the car's centre, which also
// finds the car on the circuit (V.s, V.d); far from the circuit (a side street) s stays where the car left it.
function townGroundQ(wi) {
  const q = _gq, T = TOWN, x = q[0], z = q[1];
  if (wi < 0) townLocate();
  let c = TZ.OUT, off = 0;
  if (x >= T.x0 && z >= T.z0) {
    const fx = x - T.x0, fz = z - T.z0, i = fx | 0, j = fz | 0, zw = T.zw;
    if (i < zw && j < T.zh) {
      // the surface's height above the heightfield, blended between the 1 m cells (a kerb is a short ramp, never a step)
      const Z = T.zone; c = Z[j * zw + i];
      const gx = fx - 0.5, gz = fz - 0.5, i0 = Math.floor(gx), j0 = Math.floor(gz);
      if (i0 >= 0 && j0 >= 0 && i0 < zw - 1 && j0 < T.zh - 1) {
        const u = gx - i0, v = gz - j0, o = j0 * zw + i0;
        off = (TZH[Z[o]] * (1 - u) + TZH[Z[o + 1]] * u) * (1 - v) + (TZH[Z[o + zw]] * (1 - u) + TZH[Z[o + zw + 1]] * u) * v;
      } else off = TZH[c];
    }
  }
  hfAtQ(q); q[8] = q[6] + off;
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
    // (a building never blocks the carriageway: where a mapped footprint pokes into a road, the road wins)
    if ((townOnRoad(px, pz) || !townBuildingQ(px, pz)) && !townBlockedQ(px, pz) && !townCapsQ(px, pz)) continue;
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
        if (lx > P.front || lx < -P.rear || lz > P.halfW || lz < -P.halfW || townOnRoad(Pp[i * 2], Pp[i * 2 + 1])) continue;
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
