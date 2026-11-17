// Weston-super-Mare (?map=wsm): the town's meshes, built once at start-up from the decoded map (13_wsm_town.js): terrain,
// roads with their kerbs and pavements, the buildings (extruded footprints with pitched or flat roofs; the windows are
// drawn by the shader), the sea and the Marine Lake, the Grand Pier and Birnbeck Pier, and the circuit's start gantry,
// line and kerbs. All static, in 256 m tiles for the culling. Also the TV camera positions and the clearer seaside air.
if (TOWN.on) SH_DEFS.WSM = '';
const TOWNW = { ground: null, town: null, water: null, decks: [], stats: {} };
const TOWN_TILE = 256;

// quad a-b-c-d (vertex indices) facing (nx, ny, nz): the winding is chosen from the actual positions
function townQuad(mb, a, b, c, d, nx, ny, nz) {
  const f = mb.f32, ax = f[a * 9], ay = f[a * 9 + 1], az = f[a * 9 + 2];
  const ex = f[b * 9] - ax, ey = f[b * 9 + 1] - ay, ez = f[b * 9 + 2] - az, gx = f[d * 9] - ax, gy = f[d * 9 + 1] - ay, gz = f[d * 9 + 2] - az;
  const cx = ey * gz - ez * gy, cy = ez * gx - ex * gz, cz = ex * gy - ey * gx;
  if (cx * nx + cy * ny + cz * nz < 0) mb.quadI(a, d, c, b); else mb.quadI(a, b, c, d);
}
function townTri(mb, a, b, c, nx, ny, nz) {
  const f = mb.f32, ax = f[a * 9], ay = f[a * 9 + 1], az = f[a * 9 + 2];
  const ex = f[b * 9] - ax, ey = f[b * 9 + 1] - ay, ez = f[b * 9 + 2] - az, gx = f[c * 9] - ax, gy = f[c * 9 + 1] - ay, gz = f[c * 9 + 2] - az;
  const cx = ey * gz - ez * gy, cy = ez * gx - ex * gz, cz = ex * gy - ey * gx;
  if (cx * nx + cy * ny + cz * nz < 0) mb.tri(a, c, b); else mb.tri(a, b, c);
}
// terrain normal from the height field
function townNormal(x, z, out) { const l = hfAt(x - 1, z), r = hfAt(x + 1, z), u = hfAt(x, z - 1), d = hfAt(x, z + 1); out[0] = l - r; out[1] = 2; out[2] = u - d; return out; }
// ear clipping of a polygon given in (u, v) with positive signed area; pushes index triples (into the arrays) to out
function townEarClip(us, vs, n, out) {
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 4 * n + 20) {
    const m = idx.length; let best = -1, bestC = 1e18, done = false;
    for (let i = 0; i < m; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      const cr = (us[b] - us[a]) * (vs[c] - vs[a]) - (vs[b] - vs[a]) * (us[c] - us[a]);
      if (Math.abs(cr) < bestC) { bestC = Math.abs(cr); best = i; }
      if (cr <= 1e-7) continue;
      let ok = true;
      for (let j = 0; j < m && ok; j++) {
        const p = idx[j]; if (p === a || p === b || p === c) continue;
        const px = us[p], pv = vs[p];
        const d1 = (us[b] - us[a]) * (pv - vs[a]) - (vs[b] - vs[a]) * (px - us[a]), d2 = (us[c] - us[b]) * (pv - vs[b]) - (vs[c] - vs[b]) * (px - us[b]), d3 = (us[a] - us[c]) * (pv - vs[c]) - (vs[a] - vs[c]) * (px - us[c]);
        if (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) ok = false;
      }
      if (!ok) continue;
      out.push(a, b, c); idx.splice(i, 1); done = true; break;
    }
    if (!done) idx.splice(best, 1);   // degenerate remains: drop the flattest vertex
  }
  if (idx.length === 3) { const [a, b, c] = idx; if ((us[b] - us[a]) * (vs[c] - vs[a]) - (vs[b] - vs[a]) * (us[c] - us[a]) > 1e-7) out.push(a, b, c); }
}
// Sutherland-Hodgman: keeps the part of the polygon (us, vs) with a*u + b*v <= c
function townClip(us, vs, a, b, c) {
  const n = us.length, ou = [], ov = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, si = a * us[i] + b * vs[i] - c, sj = a * us[j] + b * vs[j] - c;
    if (si <= 0) { ou.push(us[i]); ov.push(vs[i]); }
    if ((si <= 0) !== (sj <= 0)) { const t = si / (si - sj); ou.push(us[i] + (us[j] - us[i]) * t); ov.push(vs[i] + (vs[j] - vs[i]) * t); }
  }
  return [ou, ov];
}

// ---------------------------------------------------------------- terrain
function townTerrainBuild(rs) {
  const T = TOWN, NQ = 16, ROOT = 32768, cx = Math.round((T.x0 + T.x1) / 32) * 16, cz = Math.round((T.z0 + T.z1) / 32) * 16;
  const rx0 = cx - ROOT / 2, rz0 = cz - ROOT / 2;
  // roads and pavements push the ground below them down (the ribbons lie on top): mask on the 2 m grid, widened by 4 m
  const w = HF.w, h = HF.h, Z = T.zone, zw = T.zw, push = new Uint8Array(w * h), tmp = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let p = 0;
    for (let q = 0; q < 4 && !p; q++) { const zi = Math.min(zw - 1, i * 2 - 1 + (q & 1)), zj = Math.min(T.zh - 1, j * 2 - 1 + (q >> 1)); if (zi < 0 || zj < 0) continue; const c = Z[zj * zw + zi]; if (c === TZ.ROAD || c === TZ.PAVE || c === TZ.KERB || c === TZ.PATH || c === TZ.TRACK) p = 1; }
    push[j * w + i] = p;
  }
  for (let it = 0; it < 2; it++) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; tmp[k] = push[k] | (i > 0 ? push[k - 1] : 0) | (i < w - 1 ? push[k + 1] : 0); }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; push[k] = tmp[k] | (j > 0 ? tmp[k - w] : 0) | (j < h - 1 ? tmp[k + w] : 0); }
  }
  const hx1 = HF.x0 + (w - 1) * HF.res, hz1 = HF.z0 + (h - 1) * HF.res;
  const H = (px, pz) => {
    if (px >= HF.x0 && pz >= HF.z0 && px <= hx1 && pz <= hz1) {
      const fi = (px - HF.x0) * HF.ir, fj = (pz - HF.z0) * HF.ir;
      if (Number.isInteger(fi) && Number.isInteger(fj)) { const k = fj * w + fi; return HF.d[k] - (push[k] ? 0.3 : 0); }
      return hfAt(px, pz);
    }
    return townH(px, pz);
  };
  // 128 m cells that hold roads or pavements (their ground must be fine enough to stay under the ribbons)
  const rc = 128, rgw = Math.ceil((T.x1 - T.x0) / rc), rgh = Math.ceil((T.z1 - T.z0) / rc), roadCell = new Uint8Array(rgw * rgh);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (push[j * w + i]) roadCell[Math.min(rgh - 1, (j * HF.res / rc) | 0) * rgw + Math.min(rgw - 1, (i * HF.res / rc) | 0)] = 1;
  const hasRoads = (x, z, size) => {
    const i0 = Math.max(0, Math.floor((x - T.x0) / rc)), i1 = Math.min(rgw - 1, Math.floor((x + size - 1 - T.x0) / rc)), j0 = Math.max(0, Math.floor((z - T.z0) / rc)), j1 = Math.min(rgh - 1, Math.floor((z + size - 1 - T.z0) / rc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (roadCell[j * rgw + i]) return true;
    return false;
  };
  // 64 m cells within 40 m of the Toll Road
  const tollCell = new Set(), RD = T.rd, ri = T.rinfo;
  for (let r = 0; r < RD.n; r++) if (ri[r * 4 + 2] & 128) for (let k = RD.off[r]; k < RD.off[r + 1]; k++) {
    const x = RD.p[k * 2], z = RD.p[k * 2 + 1];
    for (let dz = -40; dz <= 40; dz += 20) for (let dx = -40; dx <= 40; dx += 20) tollCell.add(Math.floor((x + dx) / 64) + ',' + Math.floor((z + dz) / 64));
  }
  const nearToll = (x, z, size) => { for (let zz = z; zz < z + size; zz += 64) for (let xx = x; xx < x + size; xx += 64) if (tollCell.has(Math.floor(xx / 64) + ',' + Math.floor(zz / 64))) return true; return false; };
  const boxD = (x, z, size) => { const dx = Math.max(T.x0 - (x + size), x - T.x1, 0), dz = Math.max(T.z0 - (z + size), z - T.z1, 0); return Math.hypot(dx, dz); };
  const cache = new Map();
  const split = (x, z, size) => {
    if (size > 4096) return true; if (size <= 64) return false;
    const key = x + ',' + z + ',' + size; let v = cache.get(key);
    if (v === undefined) {
      const d = boxD(x, z, size);
      if (d <= 0) v = size > 256 || (size > 128 && hasRoads(x, z, size)) || (size > 64 && nearToll(x, z, size));
      else v = d < size * 1.0;
      cache.set(key, v);
    }
    return v;
  };
  const leaves = [];
  const rec = (x, z, size) => { if (split(x, z, size)) { const s2 = size / 2; rec(x, z, s2); rec(x + s2, z, s2); rec(x, z + s2, s2); rec(x + s2, z + s2, s2); } else leaves.push(x, z, size); };
  rec(rx0, rz0, ROOT);
  const sizeAt = (px, pz) => {
    if (px < rx0 || pz < rz0 || px >= rx0 + ROOT || pz >= rz0 + ROOT) return 0;
    let x = rx0, z = rz0, size = ROOT;
    while (split(x, z, size)) { const s2 = size / 2; if (px >= x + s2) x += s2; if (pz >= z + s2) z += s2; size = s2; }
    return size;
  };
  const mb = new MeshBuilder(1 << 20), W = NQ + 3, hg = new Float32Array(W * W);
  const nL = leaves.length / 3, order = [];
  for (let i = 0; i < nL; i++) order.push(i);
  const bucketOf = i => { const s = leaves[i * 3 + 2], b = s >= 512 ? s : 512; return b + ':' + Math.floor(leaves[i * 3] / b) + ':' + Math.floor(leaves[i * 3 + 1] / b); };
  const bk = order.map(bucketOf); order.sort((a, b) => bk[a] < bk[b] ? -1 : bk[a] > bk[b] ? 1 : 0);
  let cur = null, i0 = 0;
  for (const li of order) {
    if (bk[li] !== cur) { if (cur !== null) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 900); } cur = bk[li]; i0 = mb.ni; }
    const x = leaves[li * 3], z = leaves[li * 3 + 1], size = leaves[li * 3 + 2], st = size / NQ;
    for (let j = -1; j <= NQ + 1; j++) for (let i = -1; i <= NQ + 1; i++) hg[(j + 1) * W + i + 1] = H(x + i * st, z + j * st);
    let hmax = -1e9; for (let k = 0; k < W * W; k++) if (hg[k] > hmax) hmax = hg[k];
    if (hmax < T.sea - 0.6) continue;   // all under the sea (the water hides it)
    const nb = [sizeAt(x - 1, z + size / 2), sizeAt(x + size + 1, z + size / 2), sizeAt(x + size / 2, z - 1), sizeAt(x + size / 2, z + size + 1)];
    const snap = (i, j, alongX, ns) => {
      const cst = ns / NQ, t = alongX ? x + i * st : z + j * st, t0 = Math.floor((t - (alongX ? rx0 : rz0)) / cst) * cst + (alongX ? rx0 : rz0); if (Math.abs(t0 - t) < 1e-6) return;
      const a = alongX ? H(t0, z + j * st) : H(x + i * st, t0), b = alongX ? H(t0 + cst, z + j * st) : H(x + i * st, t0 + cst);
      hg[(j + 1) * W + i + 1] = a + (b - a) * (t - t0) / cst;
    };
    for (let q = 1; q < NQ; q++) {
      if (nb[0] > size) snap(0, q, false, nb[0]); if (nb[1] > size) snap(NQ, q, false, nb[1]);
      if (nb[2] > size) snap(q, 0, true, nb[2]); if (nb[3] > size) snap(q, NQ, true, nb[3]);
    }
    const base = mb.nv;
    for (let j = 0; j <= NQ; j++) for (let i = 0; i <= NQ; i++) {
      const k = (j + 1) * W + i + 1, px = x + i * st, pz = z + j * st;
      mb.v(px, hg[k], pz, hg[k - 1] - hg[k + 1], 2 * st, hg[k - W] - hg[k + W], px, pz);
    }
    for (let j = 0; j < NQ; j++) for (let i = 0; i < NQ; i++) {
      const a = base + j * (NQ + 1) + i, b = a + 1, c = a + NQ + 2, d = a + NQ + 1;
      if ((i + j) & 1) { mb.tri(a, d, c); mb.tri(a, c, b); } else { mb.tri(a, d, b); mb.tri(b, d, c); }
    }
  }
  rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 900);
  TOWNW.stats.terrain = mb.ni / 3;
  rs.upload(mb);
}

// ---------------------------------------------------------------- roads
// segment grid of the carriageways (32 m cells) for "is this point inside another road?" (markings stop at junctions)
function townRoadGrid() {
  const T = TOWN, R = T.rd, ri = T.rinfo, c = 32, gw = Math.ceil((T.x1 - T.x0) / c), gh = Math.ceil((T.z1 - T.z0) / c), cells = new Array(gw * gh);
  for (let r = 0; r < R.n; r++) {
    if (ri[r * 4] > 9) continue; const rad = ri[r * 4 + 1] * 0.05 + 1;
    for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad - T.x0) / c)), i1 = Math.min(gw - 1, Math.floor((Math.max(ax, bx) + rad - T.x0) / c));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - rad - T.z0) / c)), j1 = Math.min(gh - 1, Math.floor((Math.max(az, bz) + rad - T.z0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (cells[j * gw + i] || (cells[j * gw + i] = [])).push(r, k);
    }
  }
  return { c, gw, gh, cells };
}
function townInOtherRoad(G, x, z, self) {
  const T = TOWN, R = T.rd, ri = T.rinfo, i = Math.floor((x - T.x0) / G.c), j = Math.floor((z - T.z0) / G.c);
  if (i < 0 || j < 0 || i >= G.gw || j >= G.gh) return false;
  const l = G.cells[j * G.gw + i]; if (!l) return false;
  for (let q = 0; q < l.length; q += 2) {
    const r = l[q]; if (r === self) continue; const k = l[q + 1], rad = ri[r * 4 + 1] * 0.05 + 1.2;
    const ax = R.p[k * 2], az = R.p[k * 2 + 1], ex = R.p[k * 2 + 2] - ax, ez = R.p[k * 2 + 3] - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez + 1e-9), 0, 1), dx = x - ax - ex * t, dz = z - az - ez * t;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}
const _rp = { x: new Float64Array(4096), z: new Float64Array(4096), s: new Float64Array(4096), nx: new Float64Array(4096), nz: new Float64Array(4096), m: new Float64Array(4096), ok: new Uint8Array(4096), jn: new Float64Array(4096) };
const _tn = new Float64Array(3);
function townRoad(mb, r, G) {
  const T = TOWN, R = T.rd, ri = T.rinfo, cls = ri[r * 4], wd = ri[r * 4 + 1] * 0.1, fl = ri[r * 4 + 2], lanes = ri[r * 4 + 3];
  if (cls === 12) return;
  const P = _rp, k0 = R.off[r], k1 = R.off[r + 1]; let n = 0;
  // densify (6 m) so the ribbon follows the ground
  for (let k = k0; k < k1; k++) {
    const x = R.p[k * 2], z = R.p[k * 2 + 1];
    if (k > k0) {
      const px = P.x[n - 1], pz = P.z[n - 1], L = Math.hypot(x - px, z - pz), m = Math.ceil(L / 6);
      for (let q = 1; q < m && n < 4000; q++) { P.x[n] = px + (x - px) * q / m; P.z[n] = pz + (z - pz) * q / m; n++; }
    }
    if (n < 4000) { P.x[n] = x; P.z[n] = z; n++; }
  }
  if (n < 2) return;
  P.s[0] = 0; for (let i = 1; i < n; i++) P.s[i] = P.s[i - 1] + Math.hypot(P.x[i] - P.x[i - 1], P.z[i] - P.z[i - 1]);
  // right-hand normals with mitred joints
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let t1x = P.x[i] - P.x[a], t1z = P.z[i] - P.z[a], t2x = P.x[b] - P.x[i], t2z = P.z[b] - P.z[i];
    let l1 = Math.hypot(t1x, t1z), l2 = Math.hypot(t2x, t2z); if (l1 < 1e-6) { t1x = t2x; t1z = t2z; l1 = l2; } if (l2 < 1e-6) { t2x = t1x; t2z = t1z; l2 = l1; }
    t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
    let tx = t1x + t2x, tz = t1z + t2z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const cosH = Math.max(0.5, tx * t2x + tz * t2z);
    P.nx[i] = -tz / cosH; P.nz[i] = tx / cosH; P.m[i] = 1 / cosH;
  }
  const hw = wd / 2, liftR = 0.06;
  // markings: off within junctions
  for (let i = 0; i < n; i++) P.jn[i] = (cls <= 9 && townInOtherRoad(G, P.x[i], P.z[i], r)) ? 0 : 1;
  for (let i = 0; i < n; i++) if (!P.jn[i]) { if (i > 0) P.jn[i - 1] = Math.min(P.jn[i - 1], 0.5); }
  // carriageway (or path): three columns across
  let mat = 1, fla = 0;
  if (cls === 9) mat = 2; else if (cls === 10) mat = 4; else if (cls === 11) mat = 5;
  if (cls <= 8) {
    const oneway = (fl & 2) !== 0;
    if (cls <= 6 && !oneway && wd >= 5.5 && lanes !== 1 && !(fl & 4)) fla |= 1;   // (lane_markings=no: none)
    if (oneway && lanes === 2) fla |= 2;
    const dc = Math.hypot((P.x[0] - 250) / 1.0, (P.z[0] - 250) / 1.3);
    if (cls >= 2 && cls <= 6 && wd >= 5 && dc < 1100 && !(fl & 4)) fla |= 4;
    if (fl & 64) fla |= 8;              // white edge lines (the Toll Road)
    if (fl & 128) fla |= 16;            // a lane through the woods: leaf litter, worn edges
  }
  if (cls === 10 && (fl & 16)) fla |= 32;  // steps
  const lift = cls <= 9 ? liftR : 0.05;
  const base = mb.nv;
  for (let i = 0; i < n; i++) {
    mb.mat(mat, cls, fla, Math.min(255, Math.round(hw * 10))).color(P.jn[i], 0, 0, 1);
    for (let c = -1; c <= 1; c++) {
      const x = P.x[i] + P.nx[i] * hw * c, z = P.z[i] + P.nz[i] * hw * c; townNormal(x, z, _tn);
      mb.v(x, hfAt(x, z) + lift, z, _tn[0], _tn[1], _tn[2], P.s[i], hw * c);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < 2; c++) {
    const a = base + i * 3 + c; townQuad(mb, a, a + 3, a + 4, a + 1, 0, 1, 0);
  }
  // pavements: kerb face, slabs, back edge, on both sides, where the raster says the pavement is there (not inside
  // another road at a junction, not on the beach, not inside a building)
  const pw = ROAD_PAVE[cls]; if (!pw || (fl & 32)) return;   // (sidewalk=no: none)
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const dm = side * (hw + pw * 0.5), x = P.x[i] + P.nx[i] * dm, z = P.z[i] + P.nz[i] * dm;
      let ok = 0;
      if (x > T.x0 && z > T.z0 && x < T.x1 && z < T.z1) { const c = T.zone[((z - T.z0) | 0) * T.zw + ((x - T.x0) | 0)]; ok = c === TZ.PAVE ? 1 : 0; }
      P.ok[i] = ok;
    }
    const v0 = mb.nv;
    for (let i = 0; i < n; i++) {
      const ex = P.x[i] + P.nx[i] * side * hw, ez = P.z[i] + P.nz[i] * side * hw, ox = P.x[i] + P.nx[i] * side * (hw + pw), oz = P.z[i] + P.nz[i] * side * (hw + pw);
      const ye = hfAt(ex, ez), yo = hfAt(ox, oz), nx = -P.nx[i] * side, nz = -P.nz[i] * side;
      mb.mat(3).color(1, 1, 1, 1);
      mb.v(ex, ye + liftR - 0.02, ez, nx, 0, nz, P.s[i], 0); mb.v(ex, ye + 0.19, ez, nx, 0, nz, P.s[i], 0.15);
      townNormal(ex, ez, _tn); mb.mat(2).color(1, 1, 1, 1);
      mb.v(ex, ye + 0.19, ez, _tn[0], _tn[1], _tn[2], P.s[i], 0); mb.v(ox, yo + 0.19, oz, _tn[0], _tn[1], _tn[2], P.s[i], pw);
      mb.mat(3).color(1, 1, 1, 1);
      mb.v(ox, yo + 0.19, oz, -nx, 0, -nz, P.s[i], 0.15); mb.v(ox, yo - 0.35, oz, -nx, 0, -nz, P.s[i], -0.4);
    }
    for (let i = 0; i < n - 1; i++) {
      if (!P.ok[i] || !P.ok[i + 1]) continue;
      const a = v0 + i * 6, b = a + 6, nx = P.nx[i] * side, nz = P.nz[i] * side;
      townQuad(mb, a, b, b + 1, a + 1, -nx, 0, -nz);
      townQuad(mb, a + 2, b + 2, b + 3, a + 3, 0, 1, 0);
      townQuad(mb, a + 4, b + 4, b + 5, a + 5, nx, 0, nz);
    }
    // the open ends of a pavement run get an end face (no hole into the ground)
    for (let i = 0; i < n; i++) {
      const pv = i > 0 && P.ok[i - 1], nx2 = i < n - 1 && P.ok[i + 1];
      if (!P.ok[i] || (pv && nx2) || (!pv && !nx2)) continue;
      const a = v0 + i * 6, fx = pv ? P.nz[i] : -P.nz[i], fz = pv ? -P.nx[i] : P.nx[i];   // the face looks out of the run
      townQuad(mb, a, a + 1, a + 4, a + 5, fx, 0, fz);
    }
  }
}

// ---------------------------------------------------------------- buildings
// palette (linear albedo)
const TB_WALL = {
  render: [[0.62, 0.58, 0.48], [0.7, 0.69, 0.65], [0.66, 0.6, 0.42], [0.5, 0.56, 0.6], [0.64, 0.52, 0.48], [0.52, 0.58, 0.5], [0.6, 0.6, 0.57]],
  dash: [[0.42, 0.41, 0.38], [0.48, 0.45, 0.39], [0.38, 0.37, 0.35]],
  brick: [[0.33, 0.12, 0.07], [0.27, 0.14, 0.09], [0.45, 0.33, 0.21], [0.25, 0.09, 0.06], [0.36, 0.17, 0.1]],
  stone: [[0.34, 0.33, 0.31], [0.3, 0.29, 0.27], [0.52, 0.45, 0.33]],
  clad: [[0.3, 0.33, 0.36], [0.17, 0.24, 0.3], [0.24, 0.29, 0.22], [0.42, 0.42, 0.4]],
};
const TB_ROOF = { slate: [[0.06, 0.066, 0.078], [0.045, 0.05, 0.058], [0.07, 0.07, 0.075]], tile: [[0.3, 0.12, 0.07], [0.2, 0.11, 0.08], [0.24, 0.15, 0.1], [0.14, 0.14, 0.14]], flat: [[0.12, 0.12, 0.12], [0.2, 0.2, 0.19], [0.09, 0.09, 0.1]] };
const _bu = [], _bv = [], _bt = [];
function townBuilding(mb, b) {
  const T = TOWN, B = T.bd, bi = T.binfo, k0 = B.off[b], n = B.off[b + 1] - k0; if (n < 3) return;
  const kind = bi[b * 8], hgt = bi[b * 8 + 1] * 0.25; let roof = bi[b * 8 + 2]; const ridge = bi[b * 8 + 3] / 256 * PI;
  const h0 = bi[b * 8 + 4] / 255, h1 = bi[b * 8 + 5] / 255, lu = bi[b * 8 + 6] & 15, look = bi[b * 8 + 6] >> 4;   // look: landmark (bake)
  const p = B.p; let gmin = 1e9, gmax = -1e9, cx = 0, cz = 0;
  for (let k = k0; k < k0 + n; k++) { const g = hfAt(p[k * 2], p[k * 2 + 1]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); cx += p[k * 2]; cz += p[k * 2 + 1]; }
  cx /= n; cz /= n;
  let base = gmin - 0.5, eaveY = gmax + hgt;
  let onDeck = false;
  for (const d of TOWNW.decks) if (cx > d.x0 && cx < d.x1 && cz > d.z0 && cz < d.z1 && townInRing(d.ring, cx, cz)) { base = d.y - 0.3; eaveY = d.y + hgt; onDeck = true; }   // on a pier deck
  if (kind === 11 && !onDeck) {   // shelter: a roof on posts (bus shelters; the one on the Grand Pier is its glazed walkway)
    const us = [], vs = []; for (let k = k0; k < k0 + n; k++) { us.push(p[k * 2]); vs.push(p[k * 2 + 1]); }
    const tris = []; townEarClip(us, vs, n, tris);
    mb.mat(13, 120).color(0.62, 0.64, 0.62, 1);
    for (const [y, ny] of [[eaveY, 1], [eaveY - 0.25, -1]]) { const v0 = mb.nv; for (let i = 0; i < n; i++) mb.v(us[i], y, vs[i], 0, ny, 0, 0, 0); for (let q = 0; q < tris.length; q += 3) townTri(mb, v0 + tris[q], v0 + tris[q + 1], v0 + tris[q + 2], 0, ny, 0); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, L = Math.hypot(us[j] - us[i], vs[j] - vs[i]), np = Math.max(1, Math.round(L / 4));
      for (let q = 0; q < np; q++) { const f = q / np; mb.cyl(us[i] + (us[j] - us[i]) * f, base, vs[i] + (vs[j] - vs[i]) * f, 0.07, eaveY - 0.2, 0.07, 6, false, false); }
    }
    return;
  }
  // ---- look: walls, roof and window style from the kind of building, the district and a per-building hash
  const centre = Math.hypot((cx - 250) / 1300, (cz + 50) / 1100) < 1, seafront = cx < 230 && cz > -420 && cz < 1700 && cx > -150;
  const pick = (a, h) => a[Math.min(a.length - 1, Math.floor(h * a.length))];
  let wall, wmat, rcol, rtile = 0, style = kind, storey = 3.0;
  const hh = (h0 * 7.31 + h1) % 1;
  if (kind === 5) { wall = pick(TB_WALL.clad, h0); wmat = 3; }
  else if (kind === 4 || kind === 9) { wall = pick(TB_WALL.stone, h0 * 0.66); wmat = 2; storey = 4.5; }
  else if (kind === 8) { wall = [0.74, 0.74, 0.72]; wmat = 0; storey = 4.2; }
  else if (kind === 11) { wall = [0.74, 0.74, 0.72]; wmat = 0; storey = 3.0; style = 12; }
  else if (kind === 7) { wall = h0 < 0.6 ? pick(TB_WALL.brick, h1) : pick(TB_WALL.render, h1); wmat = h0 < 0.6 ? 1 : 0; }
  else if (seafront && (kind === 0 || kind === 1 || kind === 2 || kind === 3 || kind === 10)) {
    if (h0 < 0.72) { wall = pick(TB_WALL.render, h1); wmat = 0; } else if (h0 < 0.88) { wall = pick(TB_WALL.stone, h1); wmat = 2; } else { wall = pick(TB_WALL.brick, h1); wmat = 1; }
    if (kind === 0) style = 1; storey = 3.2;
  } else if (centre && kind !== 6) {
    if (h0 < 0.4) { wall = pick(TB_WALL.render, h1); wmat = 0; } else if (h0 < 0.72) { wall = pick(TB_WALL.stone, h1); wmat = 2; } else { wall = pick(TB_WALL.brick, h1); wmat = 1; }
    if (kind === 0) style = 1; storey = 3.1;
  } else if (kind === 6) { if (h0 < 0.6) { wall = pick(TB_WALL.brick, h1); wmat = 1; } else { wall = pick(TB_WALL.dash, h1); wmat = 0; } }
  else {
    if (h0 < 0.55) { wall = pick(TB_WALL.brick, h1); wmat = 1; } else if (h0 < 0.85) { wall = pick(TB_WALL.dash, h1); wmat = 0; } else { wall = pick(TB_WALL.render, h1); wmat = 0; }
    storey = 2.75;
  }
  // landmarks: the seafront hotels in white or cream render, the Winter Gardens in red brick, Knightstone in Bath stone,
  // the churches in grey stone
  if (look === 1) { wall = pick([[0.72, 0.71, 0.67], [0.68, 0.64, 0.54], [0.7, 0.68, 0.6]], h1); wmat = 0; }
  else if (look === 2) { wall = [0.36, 0.14, 0.08]; wmat = 1; storey = 4.0; }
  else if (look === 3) { wall = [0.56, 0.47, 0.33]; wmat = 2; }
  else if (look === 4) { wall = pick([[0.34, 0.33, 0.31], [0.3, 0.29, 0.27]], h1); wmat = 2; }
  if (kind === 8 || kind === 11) rcol = [0.62, 0.63, 0.62];
  else if (roof === 0 || roof === 3) rcol = pick(TB_ROOF.flat, hh);
  else if (centre || seafront || kind === 4) { if (hh < 0.75) rcol = pick(TB_ROOF.slate, hh / 0.75); else { rcol = pick(TB_ROOF.tile, (hh - 0.75) * 4); rtile = 1; } }
  else { if (hh < 0.3) rcol = pick(TB_ROOF.slate, hh / 0.3); else { rcol = pick(TB_ROOF.tile, (hh - 0.3) / 0.7); rtile = 1; } }
  // ---- ridge frame and roof function
  const cr = Math.cos(ridge), sr = Math.sin(ridge);
  const us = _bu, vs = _bv; us.length = vs.length = n;
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < n; i++) { const x = p[(k0 + i) * 2], z = p[(k0 + i) * 2 + 1], u = x * cr + z * sr, v = -x * sr + z * cr; us[i] = u; vs[i] = v; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
  const lr = bi[b * 8 + 7] < 255 ? bi[b * 8 + 7] * 0.1 : -1;   // roof rise measured by the LIDAR (DSM - DTM), if any
  if ((roof === 1 || roof === 2) && hv > (lr >= 0 ? 15 : 9.5) && kind !== 4) roof = 0;
  if (kind === 9) roof = 3;
  if (kind === 8 || kind === 11) roof = 0;   // (the pavilion's curved roof is drawn below)
  const pitch = kind === 4 ? 1.0 : kind <= 1 || kind === 10 ? 0.75 : 0.6;
  const rise = roof === 1 || roof === 2 ? (lr > 0.4 ? Math.min(lr, hv * 1.3) : Math.min(hv * pitch, Math.max(2.2, hgt * 0.55), 7.5)) : 0, kk = hv > 0.01 ? rise / hv : 0;
  const hip = roof === 2;
  const fRoof = (u, v) => {
    if (!rise) return 0;
    let f = kk * (hv - Math.abs(v - vc)); if (hip) f = Math.min(f, kk * (hu - Math.abs(u - uc)));
    return f < 0 ? 0 : f;
  };
  const toX = (u, v) => u * cr - v * sr, toZ = (u, v) => u * sr + v * cr;
  // ---- walls (split where the roof creases cross them, so the top follows the roof exactly)
  const top = eaveY + (roof === 0 && kind !== 7 ? 0.35 : 0), eave = eaveY - base;
  const wt = (wmat << 6) | Math.min(63, Math.round(storey * 10)), bh = (h0 + h1 * 0.37) % 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ua = us[i], va = vs[i], ub = us[j], vb = vs[j], du = ub - ua, dv = vb - va;
    const ax = p[(k0 + i) * 2], az = p[(k0 + i) * 2 + 1], bx = p[(k0 + j) * 2], bz = p[(k0 + j) * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    const ts = _bt; ts.length = 0; ts.push(0, 1);
    if (kind === 8 && T.pav) { const m = Math.ceil(L / 2.5); for (let q = 1; q < m; q++) ts.push(q / m); }
    else if (rise) {
      const lines = hip ? [[0, 1, vc], [1, 0, uc], [1, -1, uc - vc + hu - hv], [1, -1, uc - vc - hu + hv], [1, 1, uc + vc + hu - hv], [1, 1, uc + vc - hu + hv]] : [[0, 1, vc]];
      for (const l of lines) { const den = l[0] * du + l[1] * dv; if (Math.abs(den) < 1e-9) continue; const t = (l[2] - l[0] * ua - l[1] * va) / den; if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
      ts.sort((a, b) => a - b);
    }
    mb.mat(10, style, wt, Math.min(255, Math.round(L))).color(wall[0], wall[1], wall[2], bh).weight(Math.min(1, eave / 64));
    for (let q = 0; q < ts.length - 1; q++) {
      const t0 = ts[q], t1 = ts[q + 1];
      let y0 = (roof === 0 || roof === 3 ? top : eaveY + fRoof(ua + du * t0, va + dv * t0)), y1 = (roof === 0 || roof === 3 ? top : eaveY + fRoof(ua + du * t1, va + dv * t1));
      if (kind === 8 && T.pav) { y0 = base + 0.3 + townPavH(ax + (bx - ax) * t0, az + (bz - az) * t0); y1 = base + 0.3 + townPavH(ax + (bx - ax) * t1, az + (bz - az) * t1); }
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const a = mb.v(x0, base, z0, nx, 0, nz, L * t0, 0), bb = mb.v(x1, base, z1, nx, 0, nz, L * t1, 0), c = mb.v(x1, y1, z1, nx, 0, nz, L * t1, y1 - base), d = mb.v(x0, y0, z0, nx, 0, nz, L * t0, y0 - base);
      townQuad(mb, a, bb, c, d, nx, 0, nz);
    }
  }
  mb.weight(0);
  // the Grand Pier's pavilion (2010): a long white hall under a curved roof, four slim round towers with grey-green domes
  if (kind === 8 && T.pav) {
    const P = T.pav, ca = Math.cos(P.ang), sa = Math.sin(P.ang), gu = P.gu, gv = P.gv, dy = base + 0.3, ring = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { ring[i * 2] = p[(k0 + i) * 2]; ring[i * 2 + 1] = p[(k0 + i) * 2 + 1]; }
    const X = (i, j) => { const u = P.u0 + (P.u1 - P.u0) * i / (gu - 1), v = P.v0 + (P.v1 - P.v0) * j / (gv - 1); return [u * ca - v * sa, u * sa + v * ca]; };
    const Hg = (i, j) => P.grid[Math.min(gv - 1, Math.max(0, j)) * gu + Math.min(gu - 1, Math.max(0, i))] * 0.1;
    mb.mat(13, 90).color(0.7, 0.71, 0.7, 1);
    const prof = TOWNW.pavProf, jlo = TOWNW.pavJ0, jhi = TOWNW.pavJ1;
    for (let i = 0; i < gu - 1; i++) {
      if (!(prof[i] > 2.5 && prof[i + 1] > 2.5)) continue;
      const j0 = Math.max(jlo[i], jlo[i + 1]), j1 = Math.min(jhi[i], jhi[i + 1]); if (j1 <= j0) continue;
      const cam = (j, i2) => prof[i2] + 0.9 * (1 - Math.pow((j - (j0 + j1) / 2) / ((j1 - j0) / 2 + 0.5), 2));   // camber across the hall
      const m = 6, vv = [];
      for (let q = 0; q <= m; q++) { const j = j0 + (j1 - j0) * q / m; for (const i2 of [i, i + 1]) { const [x, z] = X(i2, j); vv.push(mb.v(x, dy + cam(j, i2), z, 0, 1, 0, i2, j)); } }
      for (let q = 0; q < m; q++) { const a = vv[q * 2], b = vv[q * 2 + 1], c = vv[q * 2 + 3], d = vv[q * 2 + 2]; townQuad(mb, a, b, c, d, 0, 1, 0); }
    }
    townPavTowers(mb, base, eaveY, u0, u1, v0, v1, toX, toZ);
    return;
  }
  if (kind === 8) {
    const ry = 3.2, nseg = 14, ov = 0.8;
    mb.mat(11, 2).color(0.66, 0.68, 0.68, bh);
    for (let q = 0; q < nseg; q++) {
      const va = v0 - ov + (hv * 2 + ov * 2) * q / nseg, vb = v0 - ov + (hv * 2 + ov * 2) * (q + 1) / nseg;
      const ya = eaveY + ry * (1 - Math.pow((va - vc) / (hv + ov), 2)), yb = eaveY + ry * (1 - Math.pow((vb - vc) / (hv + ov), 2));
      const gy = (ya - yb) / (vb - va), nl = 1 / Math.hypot(gy, 1), nxq = -(-sr) * gy * nl, nzq = -(cr) * gy * nl;
      const p0 = mb.v(toX(u0 - ov, va), ya, toZ(u0 - ov, va), -nxq, nl, -nzq, u0, va), p1 = mb.v(toX(u1 + ov, va), ya, toZ(u1 + ov, va), -nxq, nl, -nzq, u1, va);
      const p2 = mb.v(toX(u1 + ov, vb), yb, toZ(u1 + ov, vb), -nxq, nl, -nzq, u1, vb), p3 = mb.v(toX(u0 - ov, vb), yb, toZ(u0 - ov, vb), -nxq, nl, -nzq, u0, vb);
      townQuad(mb, p0, p1, p2, p3, -nxq, nl, -nzq); townQuad(mb, p0, p3, p2, p1, nxq, -nl, nzq);
    }
    // the gable ends of the vault
    mb.mat(10, 8, (0 << 6) | 42, Math.min(255, Math.round(hv * 2))).color(0.74, 0.74, 0.72, bh).weight(Math.min(1, (eaveY + ry - base) / 64));
    for (const ue of [u0, u1]) {
      const sg = ue === u0 ? -1 : 1, enx = cr * sg, enz = sr * sg, c0 = mb.v(toX(ue, vc), eaveY, toZ(ue, vc), enx, 0, enz, hv, eaveY - base);
      for (let q = 0; q < nseg; q++) {
        const va = v0 + hv * 2 * q / nseg, vb = v0 + hv * 2 * (q + 1) / nseg;
        const pa = mb.v(toX(ue, va), eaveY + ry * (1 - Math.pow((va - vc) / (hv + ov), 2)), toZ(ue, va), enx, 0, enz, va - v0, eaveY - base), pb = mb.v(toX(ue, vb), eaveY + ry * (1 - Math.pow((vb - vc) / (hv + ov), 2)), toZ(ue, vb), enx, 0, enz, vb - v0, eaveY - base);
        townTri(mb, c0, pa, pb, enx, 0, enz);
      }
    }
    mb.weight(0);
    townPavTowers(mb, base, eaveY, u0, u1, v0, v1, toX, toZ);
  }
  // ---- roof
  const tris = [];
  if (roof === 3) return;
  if (!rise) {
    townEarClip(us, vs, n, tris);
    mb.mat(12).color(rcol[0], rcol[1], rcol[2], bh);
    const v0i = mb.nv; for (let i = 0; i < n; i++) mb.v(toX(us[i], vs[i]), top, toZ(us[i], vs[i]), 0, 1, 0, us[i], vs[i]);
    for (let q = 0; q < tris.length; q += 3) townTri(mb, v0i + tris[q], v0i + tris[q + 1], v0i + tris[q + 2], 0, 1, 0);
    return;
  }
  // regions of the roof planes: [half-planes a*u + b*v <= c ...], plane gradient (df/du, df/dv)
  const dHU = hu - hv;
  const regions = hip ? [
    [[[0, -1, -vc], [1, -1, uc - vc + dHU], [-1, -1, -uc - vc + dHU]], [0, -kk]],
    [[[0, 1, vc], [1, 1, uc + vc + dHU], [-1, 1, -uc + vc + dHU]], [0, kk]],
    [[[-1, 0, -uc], [-1, 1, -uc + vc - dHU], [-1, -1, -uc - vc - dHU]], [-kk, 0]],
    [[[1, 0, uc], [1, 1, uc + vc - dHU], [1, -1, uc - vc - dHU]], [kk, 0]],
  ] : [[[[0, -1, -vc]], [0, -kk]], [[[0, 1, vc]], [0, kk]]];
  mb.mat(11, rtile).color(rcol[0], rcol[1], rcol[2], bh);
  for (const [hs, g] of regions) {
    let cu = us.slice(0, n), cv = vs.slice(0, n);
    for (const h of hs) { [cu, cv] = townClip(cu, cv, h[0], h[1], h[2]); if (cu.length < 3) break; }
    if (cu.length < 3) continue;
    // plane normal in world: f(u, v) gradient (g[0], g[1]) → dx, dz
    const fx = g[0] * cr - g[1] * sr, fz = g[0] * sr + g[1] * cr; let nx = -fx, ny = 1, nz = -fz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    // slope coordinate for the courses of slates: distance down from the ridge
    const v0i = mb.nv, m = cu.length;
    for (let i = 0; i < m; i++) {
      const u = cu[i], v = cv[i], f = fRoof(u, v), sl = (rise - f) / Math.max(0.2, Math.sqrt(kk * kk)) * Math.sqrt(1 + kk * kk);
      mb.v(toX(u, v), eaveY + f + 0.02, toZ(u, v), nx, ny, nz, g[0] !== 0 ? v : u, sl);
    }
    tris.length = 0; townEarClip(cu, cv, m, tris);
    for (let q = 0; q < tris.length; q += 3) townTri(mb, v0i + tris[q], v0i + tris[q + 1], v0i + tris[q + 2], nx, ny, nz);
  }
}
// the pavilion's slim round towers with grey-green domes: where the LIDAR saw them, else at the corners of the hall
function townPavTowers(mb, base, eaveY, u0, u1, v0, v1, toX, toZ) {
  const TW = TOWN.towers, tw = [];
  if (TW && TW.length >= 8 && TW[2] > 0) for (let q = 0; q < TW.length; q += 4) if (TW[q + 2] > 120) tw.push([TW[q] * 0.01, TW[q + 1] * 0.01, TW[q + 3] * 0.1 + TW[q + 2] * 0.1]);
  if (tw.length === 3) {   // the towers stand at the corners of a rectangle: the missing one is opposite the right-angle corner
    let best = 0, bd = 1e9;
    for (let k = 0; k < 3; k++) { const a = tw[k], b = tw[(k + 1) % 3], c = tw[(k + 2) % 3], d = Math.abs((b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1])); if (d < bd) { bd = d; best = k; } }
    const a = tw[best], b = tw[(best + 1) % 3], c = tw[(best + 2) % 3];
    tw.push([b[0] + c[0] - a[0], b[1] + c[1] - a[1], Math.max(b[2], c[2])]);
  }
  if (tw.length < 4) { tw.length = 0; for (const [cu, cv] of [[u0 + 1.5, v0 + 1.5], [u1 - 1.5, v0 + 1.5], [u0 + 1.5, v1 - 1.5], [u1 - 1.5, v1 - 1.5]]) tw.push([toX(cu, cv), toZ(cu, cv), eaveY + 9]); }
  for (const [x, z, top] of tw) {
    const rt = 2.3, ycap = top - 3.2;
    mb.mat(15).color(0.78, 0.78, 0.76, 1); mb.cyl(x, base, z, rt, ycap, rt, 18, false, false);
    mb.mat(13, 60).color(0.9, 0.9, 0.88, 1); mb.cyl(x, ycap, z, rt + 0.35, ycap + 0.35, rt + 0.35, 18, true, true);
    mb.mat(15).color(0.6, 0.66, 0.64, 1); mb.cyl(x, ycap + 0.35, z, rt * 0.8, ycap + 1.1, rt * 0.8, 14, false, false);
    mb.mat(13, 70).color(0.22, 0.3, 0.28, 1);
    const prof = []; for (let q = 0; q <= 8; q++) { const a = q / 8 * PI / 2; prof.push([ycap + 1.1 + Math.sin(a) * 2.0, rt * 0.95 * Math.cos(a) + 0.02]); }
    mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotZ(m4(), PI / 2))); mb.lathe(prof, 16); mb.pop();
    mb.cyl(x, ycap + 3.0, z, 0.08, top + 0.6, 0.02, 6, false, false);
  }
}
// The pavilion's roof from the DSM grid: for each step along the pier, the median height of the hall across it (the
// towers and the noise drop out), smoothed, and the extent of the hall across. Heights are above the deck.
function townPavProfile() {
  const P = TOWN.pav, gu = P.gu, gv = P.gv, G = P.grid, prof = new Float32Array(gu), j0 = new Float32Array(gu), j1 = new Float32Array(gu), tmp = [];
  for (let i = 0; i < gu; i++) {
    tmp.length = 0; let lo = -1, hi = -1;
    for (let j = 0; j < gv; j++) { const h = G[j * gu + i] * 0.1; if (h > 2.5) { tmp.push(h); if (lo < 0) lo = j; hi = j; } }
    tmp.sort((a, b) => a - b); prof[i] = tmp.length >= 3 ? tmp[tmp.length >> 1] : 0; j0[i] = lo; j1[i] = hi;
  }
  const sm = prof.slice(); for (let i = 1; i < gu - 1; i++) if (prof[i - 1] > 2.5 && prof[i] > 2.5 && prof[i + 1] > 2.5) sm[i] = (prof[i - 1] + 2 * prof[i] + prof[i + 1]) / 4;
  TOWNW.pavProf = sm; TOWNW.pavJ0 = j0; TOWNW.pavJ1 = j1;
}
// the pavilion's roof height above its deck at (x, z) (the profile), a parapet where the deck is open
function townPavH(x, z) {
  const P = TOWN.pav, ca = Math.cos(P.ang), sa = Math.sin(P.ang), u = x * ca + z * sa, v = -x * sa + z * ca;
  const fi = clamp((u - P.u0) / (P.u1 - P.u0) * (P.gu - 1), 0, P.gu - 1.001), fj = (v - P.v0) / (P.v1 - P.v0) * (P.gv - 1);
  const i = fi | 0, a = fi - i, pr = TOWNW.pavProf, h = pr[i] * (1 - a) + pr[i + 1] * a;
  if (h < 2.5 || fj < Math.min(TOWNW.pavJ0[i], TOWNW.pavJ0[i + 1]) - 0.6 || fj > Math.max(TOWNW.pavJ1[i], TOWNW.pavJ1[i + 1]) + 0.6) return 1.1;   // open deck: a parapet
  return h;
}
function townInRing(ring, x, z) {
  let inside = false; const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const zi = ring[i * 2 + 1], zj = ring[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (ring[j * 2] - ring[i * 2]) * (z - zi) / (zj - zi) + ring[i * 2]) inside = !inside; }
  return inside;
}

// ---------------------------------------------------------------- piers
function townPiersBuild(mb, rs) {
  const T = TOWN, A = T.ad, ai = T.ainfo; let r = 0;
  const post = (x, y0, z, y1, rad, seg) => mb.cyl(x, y0, z, rad, y1, rad, seg, false, false);
  // decks given as areas (the Grand Pier, the SeaQuarium): a slab at the height of the promenade, on cast-iron piles
  for (let i = 0; i < ai.length / 2; i++) {
    const c = ai[i * 2], nr = ai[i * 2 + 1];
    if (c === 10) {
      const k0 = A.off[r], k1 = A.off[r + 1], n = k1 - k0, ring = new Float32Array(n * 2);
      let sx = -1e9, sz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < n; k++) { const x = A.p[(k0 + k) * 2], z = A.p[(k0 + k) * 2 + 1]; ring[k * 2] = x; ring[k * 2 + 1] = z; if (x > sx) { sx = x; sz = z; } x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const y = T.alvl[i] > 0 ? T.alvl[i] * 0.1 : hfAt(sx + 4, sz) + 0.6; TOWNW.decks.push({ ring, y, x0, z0, x1, z1 });   // (LIDAR DSM)
      const i0 = mb.ni, us = [], vs = []; let ar = 0;
      for (let k = 0; k < n; k++) { us.push(ring[k * 2]); vs.push(ring[k * 2 + 1]); const j = (k + 1) % n; ar += ring[k * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[k * 2 + 1]; }
      if (ar < 0) { us.reverse(); vs.reverse(); }
      const tris = []; townEarClip(us, vs, n, tris);
      mb.mat(6).color(1, 1, 1, 1);
      const tv = mb.nv; for (let k = 0; k < n; k++) mb.v(us[k], y, vs[k], 0, 1, 0, us[k], vs[k]);
      for (let q = 0; q < tris.length; q += 3) townTri(mb, tv + tris[q], tv + tris[q + 1], tv + tris[q + 2], 0, 1, 0);
      mb.mat(13, 150).color(0.07, 0.075, 0.08, 1);
      const bv = mb.nv; for (let k = 0; k < n; k++) mb.v(us[k], y - 0.9, vs[k], 0, -1, 0, 0, 0);
      for (let q = 0; q < tris.length; q += 3) townTri(mb, bv + tris[q], bv + tris[q + 1], bv + tris[q + 2], 0, -1, 0);
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, ex = us[j] - us[k], ez = vs[j] - vs[k], L = Math.hypot(ex, ez); if (L < 0.05) continue;
        const nx = ez / L, nz = -ex / L;
        mb.mat(13, 120).color(0.6, 0.6, 0.58, 1);
        const a = mb.v(us[k], y - 0.9, vs[k], nx, 0, nz, 0, 0), b = mb.v(us[j], y - 0.9, vs[j], nx, 0, nz, L, 0), cc = mb.v(us[j], y, vs[j], nx, 0, nz, L, 1), d = mb.v(us[k], y, vs[k], nx, 0, nz, 0, 1);
        townQuad(mb, a, b, cc, d, nx, 0, nz);
        // railing: posts every 2.4 m and a top rail
        mb.mat(13, 90).color(0.68, 0.68, 0.66, 1);
        const np = Math.max(1, Math.round(L / 2.4));
        for (let q = 0; q < np; q++) { const f = q / np; post(us[k] + ex * f - nx * 0.15, y, vs[k] + ez * f - nz * 0.15, y + 1.05, 0.035, 5); }
        mb.tube([[us[k] - nx * 0.15, y + 1.05, vs[k] - nz * 0.15], [us[j] - nx * 0.15, y + 1.05, vs[j] - nz * 0.15]], 0.04, 5);
      }
      // trestles: rows of dark cast-iron legs across the deck every 6 m, a girder on top and cross-bracing between the legs
      for (let px = Math.ceil(x0 / 6) * 6; px < x1; px += 6) {
        if (px > sx - 5) continue;
        const legs = [];
        for (let pz = Math.ceil(z0 / 3.4) * 3.4; pz < z1; pz += 3.4) if (townInRing(ring, px, pz)) legs.push(pz);
        if (!legs.length) continue;
        mb.mat(13, 170).color(0.055, 0.04, 0.032, 1);
        for (const pz of legs) post(px, hfAt(px, pz) - 1.5, pz, y - 0.85, 0.16, 7);
        const za = legs[0] - 0.3, zb = legs[legs.length - 1] + 0.3;
        mb.push(m4translate(m4(), px, 0, 0)); mb.box(0, y - 1.15, (za + zb) / 2, 0.35, 0.6, zb - za); mb.pop();
        for (let q = 0; q + 1 < legs.length; q++) {
          const g0 = hfAt(px, legs[q]), g1 = hfAt(px, legs[q + 1]), lo = Math.max(g0, g1) + 0.6, hi = y - 1.4; if (hi - lo < 1) continue;
          mb.tube([[px, lo, legs[q]], [px, hi, legs[q + 1]]], 0.05, 4); mb.tube([[px, hi, legs[q]], [px, lo, legs[q + 1]]], 0.05, 4);
        }
      }
      if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 500); }
    }
    r += nr;
  }
  // piers given as lines (Birnbeck Pier and its jetty): a deck ribbon on lattice legs
  const RD = T.rd, ri = T.rinfo;
  for (let q = 0; q < RD.n; q++) {
    if (ri[q * 4] !== 12) continue;
    const k0 = RD.off[q], k1 = RD.off[q + 1] - 1, wd = ri[q * 4 + 1] * 0.1, hw = wd / 2;
    const ya = hfAt(RD.p[k0 * 2], RD.p[k0 * 2 + 1]), yb = hfAt(RD.p[k1 * 2], RD.p[k1 * 2 + 1]), y = Math.max(ya, yb, TOWN.sea + 7) + 0.8;
    const i0 = mb.ni;
    for (let k = k0; k < k1; k++) {
      const ax = RD.p[k * 2], az = RD.p[k * 2 + 1], bx = RD.p[k * 2 + 2], bz = RD.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      mb.mat(6).color(1, 1, 1, 1);
      const a = mb.v(ax - nx * hw, y, az - nz * hw, 0, 1, 0, 0, -hw), b = mb.v(bx - nx * hw, y, bz - nz * hw, 0, 1, 0, L, -hw), c = mb.v(bx + nx * hw, y, bz + nz * hw, 0, 1, 0, L, hw), d = mb.v(ax + nx * hw, y, az + nz * hw, 0, 1, 0, 0, hw);
      townQuad(mb, a, b, c, d, 0, 1, 0);
      mb.mat(13, 150).color(0.07, 0.075, 0.08, 1);
      for (const sd of [-1, 1]) {
        const e = mb.v(ax + nx * hw * sd, y, az + nz * hw * sd, nx * sd, 0, nz * sd, 0, 0), f = mb.v(bx + nx * hw * sd, y, bz + nz * hw * sd, nx * sd, 0, nz * sd, L, 0), g = mb.v(bx + nx * hw * sd, y - 0.8, bz + nz * hw * sd, nx * sd, 0, nz * sd, L, 1), h = mb.v(ax + nx * hw * sd, y - 0.8, az + nz * hw * sd, nx * sd, 0, nz * sd, 0, 1);
        townQuad(mb, e, f, g, h, nx * sd, 0, nz * sd);
      }
      const bt = [mb.v(ax - nx * hw, y - 0.8, az - nz * hw, 0, -1, 0, 0, 0), mb.v(bx - nx * hw, y - 0.8, bz - nz * hw, 0, -1, 0, 0, 0), mb.v(bx + nx * hw, y - 0.8, bz + nz * hw, 0, -1, 0, 0, 0), mb.v(ax + nx * hw, y - 0.8, az + nz * hw, 0, -1, 0, 0, 0)];
      townQuad(mb, bt[0], bt[1], bt[2], bt[3], 0, -1, 0);
      // legs every 9 m (pairs), diagonal braces between them, and the railings
      const nl = Math.max(1, Math.round(L / 9));
      for (let m = 0; m <= nl; m++) {
        const f = m / nl, px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
        for (const sd of [-1, 1]) {
          const lx = px + nx * hw * 0.8 * sd, lz = pz + nz * hw * 0.8 * sd, g = hfAt(lx, lz);
          if (g < y - 1.2) { mb.mat(13, 160).color(0.06, 0.06, 0.065, 1); post(lx, g - 1, lz, y - 0.75, 0.18, 6); }
        }
        const g0 = hfAt(px, pz);
        if (g0 < y - 3) { mb.mat(13, 160).color(0.06, 0.06, 0.065, 1); mb.tube([[px + nx * hw * 0.8, g0 + 0.5, pz + nz * hw * 0.8], [px - nx * hw * 0.8, y - 1.2, pz - nz * hw * 0.8]], 0.07, 4); mb.tube([[px - nx * hw * 0.8, g0 + 0.5, pz - nz * hw * 0.8], [px + nx * hw * 0.8, y - 1.2, pz + nz * hw * 0.8]], 0.07, 4); }
      }
      mb.mat(13, 90).color(0.62, 0.62, 0.6, 1);
      for (const sd of [-1, 1]) {
        mb.tube([[ax + nx * (hw - 0.1) * sd, y + 1.0, az + nz * (hw - 0.1) * sd], [bx + nx * (hw - 0.1) * sd, y + 1.0, bz + nz * (hw - 0.1) * sd]], 0.04, 5);
        const np = Math.max(1, Math.round(L / 2.5)); for (let m = 0; m < np; m++) { const f = m / np; post(ax + (bx - ax) * f + nx * (hw - 0.1) * sd, y, az + (bz - az) * f + nz * (hw - 0.1) * sd, y + 1.0, 0.03, 4); }
      }
    }
    if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 500); }
  }
}

// ---------------------------------------------------------------- church towers and spires (where the DSM rises well above the roof)
// stone walls round a convex outline P (x, z pairs) from y0 to y1: u runs along each face, v up from v0 (the wall shader's
// courses and openings: style 4 puts a lancet in the lowest storey, 9 none); cap: a flat top
function townStoneWalls(mb, P, y0, y1, style, v0, cap) {
  const n = P.length / 2; let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += P[k * 2] / n; cz += P[k * 2 + 1] / n; }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, ax = P[k * 2], az = P[k * 2 + 1], bx = P[k1 * 2], bz = P[k1 * 2 + 1], L = Math.hypot(bx - ax, bz - az);
    let nx = (ax + bx) / 2 - cx, nz = (az + bz) / 2 - cz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    mb.mat(10, style, (2 << 6) | 45, Math.min(255, Math.round(L))).weight((v0 + y1 - y0) / 64);
    const a = mb.v(ax, y0, az, nx, 0, nz, 0, v0), b = mb.v(bx, y0, bz, nx, 0, nz, L, v0), c = mb.v(bx, y1, bz, nx, 0, nz, L, v0 + y1 - y0), d = mb.v(ax, y1, az, nx, 0, nz, 0, v0 + y1 - y0);
    townQuad(mb, a, b, c, d, nx, 0, nz);
  }
  mb.weight(0);
  if (cap) {
    mb.mat(15); const c0 = mb.v(cx, y1, cz, 0, 1, 0, 0, 0);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; townTri(mb, c0, mb.v(P[k * 2], y1, P[k * 2 + 1], 0, 1, 0, 0, 0), mb.v(P[k1 * 2], y1, P[k1 * 2 + 1], 0, 1, 0, 0, 0), 0, 1, 0); }
  }
}
// an oriented box of stone: centre (cx, cz), half sizes hu along (ca, sa) and hv across
function townStoneBox(mb, cx, cz, hu, hv, ca, sa, y0, y1, style, v0, cap) {
  const P = [];
  for (const [u, w] of [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]]) P.push(cx + u * ca - w * sa, cz + u * sa + w * ca);
  townStoneWalls(mb, P, y0, y1, style, v0, cap);
}
// Church towers from the LIDAR: Somerset towers in grey limestone, in two stages with a string course between them,
// diagonal buttresses at the corners of the lower stage, a lancet (west window, belfry openings) in each stage, a
// battlemented parapet with corner pinnacles and a stair turret; a broach spire on the tall ones.
function townSpiresBuild(mb, rs) {
  const S = TOWN.spires; if (!S || S.length < 4 || !S[2]) return;
  const i0 = mb.ni;
  for (let i = 0; i < S.length; i += 4) {
    const x = S[i] * 0.01, z = S[i + 1] * 0.01, g = hfAt(x, z), top = g + S[i + 2] * 0.1, hgt = top - g; if (hgt < 10) continue;
    const w = (S[i + 3] & 0xffff) * 0.1 || 5.2, ang = (S[i + 3] >>> 16) * PI / 180, ca = Math.cos(ang), sa = Math.sin(ang), hw = w / 2;
    const spire = hgt > 26, tt = spire ? Math.max(g + 10, top - Math.min(22, hgt * 0.45)) : top - 1.7;   // (the LIDAR's top: a pinnacle or the spire's tip)
    const h1 = g + (tt - g) * 0.55, pb = tt - 1.05, rnd = mkRng(i + 7);
    mb.color(0.36, 0.35, 0.32, rnd());
    const W = (u, v) => [x + u * ca - v * sa, z + u * sa + v * ca];
    // plinth, lower stage, string course, belfry stage
    townStoneBox(mb, x, z, hw + 0.12, hw + 0.12, ca, sa, g - 0.6, g + 0.7, 9, 0, true);
    townStoneBox(mb, x, z, hw, hw, ca, sa, g + 0.7, h1, 4, 0.7, false);
    mb.color(0.4, 0.39, 0.35, 1); townStoneBox(mb, x, z, hw + 0.1, hw + 0.1, ca, sa, h1, h1 + 0.24, 9, 0, true);
    mb.color(0.35, 0.34, 0.31, rnd()); townStoneBox(mb, x, z, hw - 0.15, hw - 0.15, ca, sa, h1 + 0.24, pb, 4, 0, true);
    // diagonal buttresses at the four corners of the lower stage (stepping in once)
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [bx, bz] = W(du * (hw + 0.35), dv * (hw + 0.35)), da = ang + Math.atan2(dv, du), c2 = Math.cos(da), s2 = Math.sin(da), hb = h1 - g;
      mb.color(0.35, 0.34, 0.31, rnd());
      townStoneBox(mb, bx, bz, 0.62, 0.36, c2, s2, g - 0.5, g + hb * 0.5, 9, 0, true);
      townStoneBox(mb, bx - c2 * 0.2, bz - s2 * 0.2, 0.42, 0.33, c2, s2, g + hb * 0.5, g + hb * 0.92, 9, hb * 0.5, true);
    }
    if (spire) {   // a slate-grey stone spire with a weathervane rod
      mb.color(0.38, 0.37, 0.34, 1); townStoneBox(mb, x, z, hw - 0.05, hw - 0.05, ca, sa, pb, tt, 9, 0, true);
      mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotY(m4(), -ang + PI / 4)));
      mb.mat(15).color(0.3, 0.3, 0.3, 1); mb.cyl(0, tt, 0, (hw - 0.2) * Math.SQRT2, top, 0.05, 4, true, false);
      mb.pop();
      mb.mat(13, 60).color(0.25, 0.22, 0.1, 1); mb.cyl(x, top, z, 0.04, top + 1.6, 0.04, 4, false, false);
      continue;
    }
    // battlemented parapet, corbelled out a little: a solid band and merlons
    mb.color(0.38, 0.37, 0.34, 1); townStoneBox(mb, x, z, hw - 0.05, hw - 0.05, ca, sa, pb, pb + 0.55, 9, 0, true);
    const nm = Math.max(2, Math.round((w - 1.2) / 1.3));
    for (const [du, dv, ou, ov] of [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]]) for (let m = 0; m < nm; m++) {
      const t = (m + 0.5) / nm * (w - 1.3) - (w - 1.3) / 2, [mx, mz] = W(du * (hw - 0.2) + ou * t, dv * (hw - 0.2) + ov * t);
      townStoneBox(mb, mx, mz, 0.3, 0.3, ca, sa, pb + 0.55, tt, 9, 0, true);
    }
    // pinnacles at the corners (the stair turret's corner carries its own), on square shafts
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [px, pz] = W(du * (hw - 0.3), dv * (hw - 0.3)), tur = du > 0 && dv < 0;
      if (tur) continue;
      townStoneBox(mb, px, pz, 0.3, 0.3, ca, sa, pb, tt + 0.7, 9, 0, true);
      mb.push(m4mul(m4(), m4translate(m4(), px, 0, pz), m4rotY(m4(), -ang + PI / 4)));
      mb.mat(15).color(0.37, 0.36, 0.33, 1); mb.cyl(0, tt + 0.7, 0, 0.42, Math.max(tt + 1.9, top), 0.03, 4, true, false);
      mb.pop();
    }
    // the stair turret: an octagon clasping one corner, up past the parapet, with a little spirelet
    const [qx, qz] = W(hw - 0.1, -(hw - 0.1)), O = [];
    for (let k = 0; k < 8; k++) { const t = ang + (k + 0.5) * PI / 4; O.push(qx + Math.cos(t) * 1.0, qz + Math.sin(t) * 1.0); }
    mb.color(0.35, 0.34, 0.31, rnd()); townStoneWalls(mb, O, g + 0.7, tt + 0.9, 9, 0.7, false);
    mb.push(m4mul(m4(), m4translate(m4(), qx, 0, qz), m4rotY(m4(), -ang - PI / 8)));
    mb.mat(15).color(0.37, 0.36, 0.33, 1); mb.cyl(0, tt + 0.9, 0, 1.06, Math.max(tt + 3.2, top + 0.6), 0.04, 8, true, false);
    mb.pop();
  }
  if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 600); }
}

// ---------------------------------------------------------------- the sea wall (TOWN.walls, from townSeaWalls)
// grey coursed stone from the sand to a coping 0.9 m above the promenade
function townSeaWallBuild(mb, rs) {
  const W = TOWN.walls, i0 = mb.ni;
  for (let i = 0; i < W.length; i += 6) {
    const ax = W[i], az = W[i + 1], bx = W[i + 2], bz = W[i + 3], foot = W[i + 4], top = W[i + 5], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -tz, nz = tx; if (hfAt(mx + nx * 4, mz + nz * 4) > hfAt(mx - nx * 4, mz - nz * 4)) { nx = -nx; nz = -nz; }   // n: towards the beach
    const th = 0.55, bxo = -nx * th, bzo = -nz * th, back = Math.min(hfAt(mx - nx * 1.5, mz - nz * 1.5), top - 0.9) - 0.3;
    const u0 = ax * tx + az * tz, u1 = u0 + L;
    mb.mat(10, 9, (2 << 6) | 30, 255).color(0.31, 0.3, 0.28, 0.5).weight(0);
    let a = mb.v(ax, foot, az, nx, 0, nz, u0, 0), b = mb.v(bx, foot, bz, nx, 0, nz, u1, 0), c = mb.v(bx, top - 0.12, bz, nx, 0, nz, u1, top - 0.12 - foot), d = mb.v(ax, top - 0.12, az, nx, 0, nz, u0, top - 0.12 - foot);
    townQuad(mb, a, b, c, d, nx, 0, nz);
    a = mb.v(ax + bxo, back, az + bzo, -nx, 0, -nz, u0, 0); b = mb.v(bx + bxo, back, bz + bzo, -nx, 0, -nz, u1, 0); c = mb.v(bx + bxo, top - 0.12, bz + bzo, -nx, 0, -nz, u1, top - 0.12 - back); d = mb.v(ax + bxo, top - 0.12, az + bzo, -nx, 0, -nz, u0, top - 0.12 - back);
    townQuad(mb, a, b, c, d, -nx, 0, -nz);
    // coping: a pale dressed stone cap, a little proud of the wall
    mb.mat(15).color(0.42, 0.4, 0.36, 1);
    const ox = nx * 0.08, oz = nz * 0.08;
    a = mb.v(ax + ox, top, az + oz, 0, 1, 0, 0, 0); b = mb.v(bx + ox, top, bz + oz, 0, 1, 0, 0, 0); c = mb.v(bx + bxo - ox, top, bz + bzo - oz, 0, 1, 0, 0, 0); d = mb.v(ax + bxo - ox, top, az + bzo - oz, 0, 1, 0, 0, 0);
    townQuad(mb, a, b, c, d, 0, 1, 0);
    a = mb.v(ax + ox, top - 0.14, az + oz, nx, 0, nz, 0, 0); b = mb.v(bx + ox, top - 0.14, bz + oz, nx, 0, nz, 0, 0); c = mb.v(bx + ox, top, bz + oz, nx, 0, nz, 0, 0); d = mb.v(ax + ox, top, az + oz, nx, 0, nz, 0, 0);
    townQuad(mb, a, b, c, d, nx, 0, nz);
  }
  if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 400); }
}

// ---------------------------------------------------------------- the Toll Road: retaining walls, crash barriers, marker posts, 25 mph
function townTollBuild(mb, rs) {
  const T = TOWN, i0 = mb.ni, W = T.tollWalls || [], B = T.tollRails || [];
  // old stone retaining walls where the road is cut into the hill
  for (let i = 0; i < W.length; i += 6) {
    const ax = W[i], az = W[i + 1], bx = W[i + 2], bz = W[i + 3], foot = W[i + 4], top = W[i + 5], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -tz, nz = tx; if (hfAt(mx + nx * 3, mz + nz * 3) > hfAt(mx - nx * 3, mz - nz * 3)) { nx = -nx; nz = -nz; }   // n: towards the road
    const u0 = ax * tx + az * tz;
    mb.mat(10, 9, (2 << 6) | 30, 255).color(0.27, 0.27, 0.24, 0.6).weight(0);
    const a = mb.v(ax, foot, az, nx, 0, nz, u0, 0), b = mb.v(bx, foot, bz, nx, 0, nz, u0 + L, 0), c = mb.v(bx, top, bz, nx, 0, nz, u0 + L, top - foot), d = mb.v(ax, top, az, nx, 0, nz, u0, top - foot);
    townQuad(mb, a, b, c, d, nx, 0, nz);
    mb.mat(15).color(0.3, 0.31, 0.26, 1);
    const e = mb.v(ax, top, az, 0, 1, 0, 0, 0), f = mb.v(bx, top, bz, 0, 1, 0, 0, 0), g = mb.v(bx - nx * 0.5, top, bz - nz * 0.5, 0, 1, 0, 0, 0), hh = mb.v(ax - nx * 0.5, top, az - nz * 0.5, 0, 1, 0, 0, 0);
    townQuad(mb, e, f, g, hh, 0, 1, 0);
  }
  // galvanised W-beam crash barriers on posts where the ground drops away towards Sand Bay
  for (let i = 0; i < B.length; i += 5) {
    const ax = B[i], az = B[i + 1], bx = B[i + 2], bz = B[i + 3], y = B[i + 4], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, ang = Math.atan2(tz, tx);
    mb.mat(13, 100).color(0.5, 0.52, 0.53, 1);
    mb.push(m4mul(m4(), m4translate(m4(), (ax + bx) / 2, 0, (az + bz) / 2), m4rotY(m4(), -ang))); mb.box(0, y + 0.55, 0, L + 0.05, 0.32, 0.08); mb.pop();
    mb.mat(13, 150).color(0.32, 0.33, 0.33, 1); mb.box(ax, y + 0.35, az, 0.1, 0.8, 0.1);
  }
  // black-and-white marker posts every 40 m on both sides, and the 25 mph limit signs at both ends
  const R = T.rd, ri = T.rinfo;
  for (let r = 0; r < R.n; r++) {
    if (!(ri[r * 4 + 2] & 128)) continue;
    const hw = ri[r * 4 + 1] * 0.05, k0 = R.off[r], k1 = R.off[r + 1]; let acc = 0;
    for (let k = k0; k < k1 - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let s = 40 - acc; s < L; s += 40) {
        for (const sd of [-1, 1]) {
          const x = ax + (bx - ax) * s / L + nx * sd * (hw + 0.7), z = az + (bz - az) * s / L + nz * sd * (hw + 0.7), y = hfAt(x, z);
          if (townBuildingQ(x, z)) continue;
          mb.mat(15).color(0.75, 0.75, 0.72, 1); mb.box(x, y + 0.5, z, 0.11, 1.0, 0.11);
          mb.mat(13, 120).color(0.03, 0.03, 0.03, 1); mb.box(x, y + 0.86, z, 0.115, 0.18, 0.115);
        }
      }
      acc = (acc + L) % 40;
    }
    for (const [k, kn] of [[k0, k0 + 1], [k1 - 1, k1 - 2]]) {     // 25 mph roundels, facing the traffic coming in
      const x0 = R.p[k * 2], z0 = R.p[k * 2 + 1], dx = R.p[kn * 2] - x0, dz = R.p[kn * 2 + 1] - z0, L = Math.hypot(dx, dz) || 1, tx = dx / L, tz = dz / L;
      for (const sd of [-1, 1]) {
        const x = x0 + tx * 6 - tz * sd * (hw + 0.9), z = z0 + tz * 6 + tx * sd * (hw + 0.9), y = hfAt(x, z);
        mb.mat(13, 100).color(0.5, 0.5, 0.5, 1); mb.cyl(x, y, z, 0.04, y + 2.4, 0.04, 6, false, true);
        mb.mat(14).color(1, 1, 1, 1);
        const r2 = 0.38, cy = y + 2.0, fx = -tx, fz = -tz, rx = -fz, rz = fx;   // face towards the cars entering (looking along +t)
        const ua = (128 - 85.5) / 2048, ub = (128 + 85.5) / 2048;   // (-r is the driver's right: the right-hand edge of the roundel)
        const a = mb.v(x - rx * r2 + fx * 0.03, cy - r2, z - rz * r2 + fz * 0.03, fx, 0, fz, ub, 1.0), b = mb.v(x + rx * r2 + fx * 0.03, cy - r2, z + rz * r2 + fz * 0.03, fx, 0, fz, ua, 1.0);
        const c = mb.v(x + rx * r2 + fx * 0.03, cy + r2, z + rz * r2 + fz * 0.03, fx, 0, fz, ua, 0.75), d = mb.v(x - rx * r2 + fx * 0.03, cy + r2, z - rz * r2 + fz * 0.03, fx, 0, fz, ub, 0.75);
        townQuad(mb, a, b, c, d, fx, 0, fz);
      }
    }
  }
  if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 300); }
}

// ---------------------------------------------------------------- the circuit: start line, kerbs, gantry
function townAtlas() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 683; const g = cv.getContext('2d');
  g.fillStyle = '#0d2747'; g.fillRect(0, 0, 2048, 256); g.fillStyle = '#e6b422'; g.fillRect(0, 0, 2048, 14); g.fillRect(0, 242, 2048, 14);
  const t1 = 'WESTON-SUPER-MARE', h1 = 120; strokeText(g, t1, (2048 - textW(t1, h1)) / 2, 66, h1, '#f4f1e6', 1.8, 0.08);
  g.fillStyle = '#f2efe6'; g.fillRect(0, 256, 2048, 256); g.fillStyle = '#b3160f'; g.fillRect(0, 256, 2048, 12); g.fillRect(0, 500, 2048, 12);
  const t2 = 'SEAFRONT GRAND PRIX', h2 = 104; strokeText(g, t2, (2048 - textW(t2, h2)) / 2, 330, h2, '#16181c', 1.8, 0.08);
  // a 25 mph limit roundel (the Toll Road's unusual limit) in the bottom strip, u 0..1/8, v 3/4..1
  g.fillStyle = '#ffffff'; g.fillRect(0, 512, 256, 171); g.beginPath(); g.arc(128, 597, 80, 0, TAU); g.fillStyle = '#c8102e'; g.fill();
  g.beginPath(); g.arc(128, 597, 62, 0, TAU); g.fillStyle = '#ffffff'; g.fill(); strokeText(g, '25', 128 - textW('25', 70) / 2, 562, 70, '#111111', 1.9, 0);
  const tex = mkTex(2048, 683, 'rgba8unorm-srgb', TU.RT | TU.TB | TU.CD, { mipLevelCount: 12 });
  G.dev.queue.copyExternalImageToTexture({ source: cv }, { texture: tex }, [2048, 683]);
  genMips(tex, 'rgba8unorm-srgb');
  return tex;
}
function townCircuitBuild(mb, rs) {
  const T = TOWN, N = TRK.N, ds = TRK.ds, o = new Float64Array(5), ed = T.cedge, kb = T.kerb;
  const i0 = mb.ni;
  const at = (s, d, lift) => { trackPos(s, d, o); return mb.v(o[0], hfAt(o[0], o[2]) + lift, o[2], 0, 1, 0, s, d); };
  // start/finish line: chequers across the road
  const eL = Math.min(7, ed[0] * 0.1), eR = Math.min(7, ed[1] * 0.1);
  mb.mat(8).color(1, 1, 1, 1);
  for (let k = 0; k < 8; k++) {
    const d0 = -eL + (eL + eR) * k / 8, d1 = -eL + (eL + eR) * (k + 1) / 8;
    const a = at(-0.6, d0, 0.085), b = at(0.6, d0, 0.085), c = at(0.6, d1, 0.085), d = at(-0.6, d1, 0.085);
    townQuad(mb, a, b, c, d, 0, 1, 0);
  }
  // kerbs: red and white strips inside the road edge on the inside of the corners
  mb.mat(7).color(1, 1, 1, 1);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, sd = kb[i * 2]; if (!sd || kb[j * 2] !== sd) continue;
    const e0 = kb[i * 2 + 1], e1 = kb[j * 2 + 1], s0 = i * ds, s1 = (i + 1) * ds;
    const a = at(s0, sd * (e0 - 0.95), 0.085), b = at(s1, sd * (e1 - 0.95), 0.085), c = at(s1, sd * e1, 0.085), d = at(s0, sd * e0, 0.085);
    townQuad(mb, a, b, c, d, 0, 1, 0);
  }
  // gantry over the start line: two posts, a box truss and the banners (both faces)
  trackPos(0, 0, o); const tx = o[3], tz = o[4], nx = -tz, nz = tx, y0 = hfAt(o[0], o[2]);
  const pL = eL + 0.9, pR = eR + 0.9, yb = y0 + 6.2;
  const box = (d, y, w, h, l) => {   // box centred at (s = 0, d) along the road normal: w across, l along, h tall
    mb.push(m4basis(m4(), tx, 0, tz, 0, 1, 0, nx, 0, nz, o[0] + nx * d, y, o[2] + nz * d)); mb.box(0, 0, 0, l, h, w); mb.pop();
  };
  mb.mat(13, 100).color(0.12, 0.14, 0.17, 1);
  for (const d of [-pL, pR]) { trackPos(0, d, o); const g = hfAt(o[0], o[2]); trackPos(0, 0, o); box(d, (g + yb + 0.7) / 2, 0.45, yb + 0.7 - g, 0.45); }
  trackPos(0, 0, o);
  box((pR - pL) / 2, yb + 0.55, pL + pR + 0.45, 0.3, 0.6); box((pR - pL) / 2, yb - 1.55, pL + pR + 0.45, 0.2, 0.5);
  mb.mat(14).color(1, 1, 1, 1);
  const bw = pL + pR - 0.6, by0 = yb - 1.45, by1 = yb + 0.4;
  for (const f of [-1, 1]) {
    const sx = o[0] + tx * 0.08 * f, sz = o[2] + tz * 0.08 * f, d0 = -pL + 0.3, d1 = d0 + bw, v0 = f < 0 ? 0 : 256 / 683, vh = 256 / 683;
    const a = mb.v(sx + nx * d0, by0, sz + nz * d0, tx * f, 0, tz * f, f < 0 ? 0 : 1, v0 + vh), b = mb.v(sx + nx * d1, by0, sz + nz * d1, tx * f, 0, tz * f, f < 0 ? 1 : 0, v0 + vh);
    const c = mb.v(sx + nx * d1, by1, sz + nz * d1, tx * f, 0, tz * f, f < 0 ? 1 : 0, v0), d = mb.v(sx + nx * d0, by1, sz + nz * d0, tx * f, 0, tz * f, f < 0 ? 0 : 1, v0);
    townQuad(mb, a, b, c, d, tx * f, 0, tz * f);
  }
  rs.addRange(mb, i0, mb.ni, 7);
}

// ---------------------------------------------------------------- water
function townWaterBuild(rs) {
  const T = TOWN, mb = new MeshBuilder(1 << 16), sea = T.sea, st = 25;
  // the sea: a grid where the ground can be under water (depth as colour), big quads beyond, out to the horizon
  const gx0 = T.x0 - 1200, gz0 = T.z0 - 800, gx1 = T.x1, gz1 = T.z1 + 800, nx = Math.round((gx1 - gx0) / st), nz = Math.round((gz1 - gz0) / st);
  const i0 = mb.ni, vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), dep = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = gx0 + i * st, z = gz0 + j * st; dep[j * (nx + 1) + i] = sea - (x > T.x0 && z > T.z0 && x < T.x1 && z < T.z1 ? hfAt(x, z) : townH(x, z)); }
  const V = (i, j) => { const k = j * (nx + 1) + i; if (vid[k] < 0) { mb.color(sat(dep[k] / 7), 0, 0, 1); vid[k] = mb.v(gx0 + i * st, sea, gz0 + j * st, 0, 1, 0, 0, 0); } return vid[k]; };
  mb.mat(1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * (nx + 1) + i, m = Math.max(dep[k], dep[k + 1], dep[k + nx + 1], dep[k + nx + 2]);
    if (m < -1.5) continue;
    townQuad(mb, V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1), 0, 1, 0);
  }
  rs.addRange(mb, i0, mb.ni, 7);
  // outer sea (west, north and south of the grid): the coarse terrain hides it where there is land
  const R0 = 26000, i1 = mb.ni;
  const big = (x0, z0, x1, z1) => { mb.color(1, 0, 0, 1); const a = mb.v(x0, sea, z0, 0, 1, 0, 0, 0), b = mb.v(x1, sea, z0, 0, 1, 0, 0, 0), c = mb.v(x1, sea, z1, 0, 1, 0, 0, 0), d = mb.v(x0, sea, z1, 0, 1, 0, 0, 0); townQuad(mb, a, b, c, d, 0, 1, 0); };
  const cx = (gx0 + gx1) / 2, cz = (gz0 + gz1) / 2;
  big(cx - R0, cz - R0, gx0, cz + R0); big(gx1, cz - R0, cx + R0, cz + R0); big(gx0, cz - R0, gx1, gz0); big(gx0, gz1, gx1, cz + R0);
  rs.addRange(mb, i1, mb.ni, 3);
  // lakes and ponds (the Marine Lake): flat at their own level
  const A = T.ad, ai = T.ainfo; let r = 0;
  for (let q = 0; q < ai.length / 2; q++) {
    const c = ai[q * 2], nr = ai[q * 2 + 1];
    if (c === 8) {
      const lvl = T.alvl[q] * 0.1, k0 = A.off[r], n = A.off[r + 1] - k0, us = [], vs = []; let ar = 0;
      for (let k = 0; k < n; k++) { us.push(A.p[(k0 + k) * 2]); vs.push(A.p[(k0 + k) * 2 + 1]); }
      for (let k = 0; k < n; k++) { const j = (k + 1) % n; ar += us[k] * vs[j] - us[j] * vs[k]; }
      if (ar < 0) { us.reverse(); vs.reverse(); }
      if (Math.abs(ar) > 40 && lvl > sea + 0.3) {
        const tris = [], i2 = mb.ni; townEarClip(us, vs, n, tris); mb.color(0.5, 1, 0, 1);
        const v0 = mb.nv; for (let k = 0; k < n; k++) mb.v(us[k], lvl, vs[k], 0, 1, 0, 0, 0);
        for (let k = 0; k < tris.length; k += 3) townTri(mb, v0 + tris[k], v0 + tris[k + 1], v0 + tris[k + 2], 0, 1, 0);
        rs.addRange(mb, i2, mb.ni, 7);
      }
    }
    r += nr;
  }
  rs.upload(mb);
}

// ---------------------------------------------------------------- TV cameras
function townTvCams() {
  const T = TOWN, o = new Float64Array(5), list = WORLD.tvCams; list.length = 0;
  const free = (x, z) => !townBuildingQ(x, z) && !townBlockedQ(x, z);
  const add = (s, side) => {
    const i = ((Math.round(s / TRK.ds) % TRK.N) + TRK.N) % TRK.N, e = Math.min(9, T.cedge[i * 2 + (side > 0 ? 1 : 0)] * 0.1);
    for (let d = e + 3; d > 1; d -= 0.5) { trackPos(s, side * d, o); if (free(o[0], o[2])) { list.push({ x: o[0], y: hfAt(o[0], o[2]) + 6.5, z: o[2], s, side }); return; } }
  };
  add(0, -1);
  for (const c of TRK.corners) add(c.s0 - 30, c.k > 0 ? -1 : 1);
  list.sort((a, b) => a.s - b.s);
}

// ---------------------------------------------------------------- trees (called by vegPlace, 33_veg_c_sys.js)
// The OpenStreetMap trees and tree rows; the woods (Worlebury Hill) filled; trees and shrubs scattered in the gardens,
// parks and fields; a few palms (cabbage palms) on the seafront lawns. Archetypes: 0 large, 1 medium, 2 tall, 3 palm,
// 4 small tree, 5 big shrub.
function townVegPlace(push) {
  const T = TOWN, rnd = mkRng(5153), Z = T.zone, zw = T.zw, zh = T.zh;
  const zoneAt = (x, z) => { if (x < T.x0 || z < T.z0) return TZ.OUT; const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i >= zw || j >= zh ? TZ.OUT : Z[j * zw + i]; };
  const hard = new Uint8Array(18); for (const c of [TZ.BLD, TZ.ROAD, TZ.WATER, TZ.OUT, TZ.KERB, TZ.PAVE, TZ.SAND, TZ.MUD, TZ.WALL]) hard[c] = 1;
  const clear = (x, z, r) => !hard[zoneAt(x, z)] && !hard[zoneAt(x + r, z)] && !hard[zoneAt(x - r, z)] && !hard[zoneAt(x, z + r)] && !hard[zoneAt(x, z - r)];
  const tree = (x, z, s, arch) => push(x, hfAt(x, z) - 0.25, z, s, rnd() * TAU, rnd(), arch);
  // LIDAR tree crowns (peaks of DSM - DTM): every tree where it really stands, at its height. A crown over a road or a
  // roof belongs to a trunk beside it (the Toll Road's tunnel of trees): look round for free ground within 5 m.
  if (T.ltrees) {
    const L = T.ltrees, dims = VEG.dims, onTop = new Uint8Array(18); for (const c of [TZ.ROAD, TZ.KERB, TZ.BLD, TZ.WALL]) onTop[c] = 1;
    for (let i = 0; i < L.length; i += 3) {
      let x = L[i], z = L[i + 1]; const h = L[i + 2]; let c = zoneAt(x, z);
      if (c === TZ.WATER || c === TZ.OUT || c === TZ.SAND || c === TZ.MUD) continue;
      if (onTop[c]) {
        let found = false;
        for (let rr = 1.5; rr <= 5 && !found; rr += 1) for (let a = 0; a < 8 && !found; a++) { const xx = x + Math.cos(a * PI / 4 + i) * rr, zz = z + Math.sin(a * PI / 4 + i) * rr, cc = zoneAt(xx, zz); if (!onTop[cc] && cc !== TZ.WATER && cc !== TZ.OUT) { x = xx; z = zz; found = true; } }
        if (!found) continue;
      }
      const hr = hash2(i, 77);
      const arch = h > 15 ? (hr < 0.5 ? 0 : 2) : h > 9 ? (hr < 0.65 ? 1 : 0) : h > 5.5 ? (hr < 0.6 ? 4 : 1) : 5;
      tree(x, z, clamp(h / (dims[arch * 4 + 1] || 12), 0.35, 1.7), arch);
    }
    // the Toll Road's verges: ivy, bramble and holly scrub up to the edge lines, ferns in the shade (the photographs)
    const RD = T.rd, ri = T.rinfo;
    for (let r = 0; r < RD.n; r++) {
      if (!(ri[r * 4 + 2] & 128)) continue;
      const hw = ri[r * 4 + 1] * 0.05;
      for (let k = RD.off[r]; k < RD.off[r + 1] - 1; k++) {
        const ax = RD.p[k * 2], az = RD.p[k * 2 + 1], bx = RD.p[k * 2 + 2], bz = RD.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let s = rnd() * 1.4; s < L; s += 1.4) for (let sd = -1; sd <= 1; sd += 2) {
          const o = hw + 1.0 + rnd() * rnd() * 5, x = ax + (bx - ax) * s / L + nx * sd * o, z = az + (bz - az) * s / L + nz * sd * o, c = zoneAt(x, z), r1 = rnd(), r2 = rnd();
          if (c === TZ.ROAD || c === TZ.WALL || c === TZ.BLD || c === TZ.WATER || c === TZ.OUT || c === TZ.KERB || r1 > 0.8) continue;
          push(x, hfAt(x, z) - 0.1, z, lerp(0.55, 1.1, r2), rnd() * TAU, rnd(), r1 < 0.4 ? 5 : r1 < 0.65 ? 6 : 7);
        }
      }
    }
  }
  // OSM trees: street trees and the rows along the Boulevard and the parks (they stand on pavements: only buildings and
  // carriageways keep them away). Without the LIDAR crowns only.
  if (!T.ltrees) for (let i = 0; i < T.trees.length; i += 2) {
    const x = T.trees[i], z = T.trees[i + 1], c = zoneAt(x, z); if (c === TZ.BLD || c === TZ.ROAD || c === TZ.WATER || c === TZ.OUT) continue;
    const r = rnd(); tree(x, z, lerp(0.62, 0.92, rnd()), r < 0.55 ? 1 : r < 0.8 ? 0 : 4);
  }
  // woods, gardens, parks and fields
  const g = 6.0;
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += g) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += g) {
    const x = x0 + rnd() * g, z = z0 + rnd() * g, r1 = rnd(), r2 = rnd(), r3 = rnd(), c = zoneAt(x, z);
    let p = 0;
    if (c === TZ.WOOD) p = 0.8; else if (c === TZ.GARDEN) p = 0.075; else if (c === TZ.GRASS) p = 0.035; else if (c === TZ.FIELD) p = 0.012; else if (c === TZ.NONE) p = 0.04; else if (c === TZ.TRACK || c === TZ.PATH) p = 0.02;
    if (T.ltrees) p = 0;                // (the LIDAR has them all)
    if (r1 > p || !clear(x, z, c === TZ.WOOD ? 1.2 : 2.6)) continue;
    let arch;
    if (c === TZ.WOOD) arch = r2 < 0.34 ? 0 : r2 < 0.7 ? 1 : r2 < 0.85 ? 2 : 4;
    else arch = r2 < 0.22 ? 0 : r2 < 0.55 ? 1 : r2 < 0.65 ? 2 : 4;
    tree(x, z, lerp(0.6, 1.15, r3 * r3 * (3 - 2 * r3)) * (c === TZ.WOOD ? 1.05 : 0.9), arch);
  }
  // shrubs: hedges and bushes in gardens, the edges of the woods, the parks
  const gb = 3.6;
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += gb) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += gb) {
    const x = x0 + rnd() * gb, z = z0 + rnd() * gb, r1 = rnd(), r2 = rnd(), c = zoneAt(x, z);
    const p = c === TZ.WOOD ? 0.16 : c === TZ.GARDEN ? 0.05 : c === TZ.GRASS ? 0.02 : c === TZ.NONE ? 0.06 : c === TZ.FIELD ? 0.01 : c === TZ.DUNE ? 0.03 : 0;
    if (r1 > p || !clear(x, z, 1.4)) continue;
    push(x, hfAt(x, z) - 0.12, z, lerp(0.45, 1.05, r2), rnd() * TAU, rnd(), 5);
  }
  // marram grass on Sand Bay's dunes (tussocks: the near-only clump archetype)
  const gm = 1.7;
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += gm) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += gm) {
    const x = x0 + rnd() * gm, z = z0 + rnd() * gm, r1 = rnd(), r2 = rnd();
    if (zoneAt(x, z) !== TZ.DUNE || r1 > 0.55) continue;
    push(x, hfAt(x, z) - 0.05, z, lerp(0.7, 1.25, r2), rnd() * TAU, rnd(), 8);
  }
  // cabbage palms on the seafront lawns near the pier
  const o = new Float64Array(5);
  for (let s = -520; s < 260; s += 26) {
    const i = (((Math.round(s / TRK.ds)) % TRK.N) + TRK.N) % TRK.N, e = Math.min(9, T.cedge[i * 2] * 0.1);
    for (let d = e + 6; d < e + 16; d += 2.5) { trackPos(s, -d, o); const c = zoneAt(o[0], o[2]); if ((c === TZ.GRASS || c === TZ.HARD || c === TZ.NONE) && clear(o[0], o[2], 1.0)) { tree(o[0], o[2], lerp(0.55, 0.75, rnd()), 3); break; } }
  }
}

// ---------------------------------------------------------------- all together
function townWorldBuild() {
  const T = TOWN, defs = { SEA_LVL: T.sea.toFixed(3) };
  const famG = mkFamily('townGround', { src: 'mat_town_ground', defs, shadowBias: 4, shadowSlope: 3 });
  const famT = mkFamily('town', { src: 'mat_town', defs, shadowBias: 3, shadowSlope: 2.5 });
  const famW = mkFamily('townWater', { src: 'mat_water', defs, noShadow: true });
  const atlas = townAtlas();
  TOWNW.ground = new RangeSet(famG); TOWNW.water = new RangeSet(famW);
  TOWNW.town = new RangeSet(famT, G.dev.createBindGroup({ layout: famT.bgl3, entries: [{ binding: 0, resource: atlas.createView() }] }));
  townTerrainBuild(TOWNW.ground);
  // piers first (the pier pavilion stands on its deck), then the town tile by tile
  const mb = new MeshBuilder(1 << 20), rs = TOWNW.town;
  townPiersBuild(mb, rs);
  if (T.pav) townPavProfile();
  const TS = TOWN_TILE, tw = Math.ceil((T.x1 - T.x0) / TS), th = Math.ceil((T.z1 - T.z0) / TS), tiles = [];
  for (let k = 0; k < tw * th; k++) tiles.push([[], []]);
  const tileOf = (x, z) => clamp(Math.floor((x - T.x0) / TS), 0, tw - 1) + clamp(Math.floor((z - T.z0) / TS), 0, th - 1) * tw;
  const RD = T.rd; for (let r = 0; r < RD.n; r++) { const k = (RD.off[r] + RD.off[r + 1]) >> 1; tiles[tileOf(RD.p[k * 2], RD.p[k * 2 + 1])][0].push(r); }
  const bb = T.bbox; for (let b = 0; b < T.bd.n; b++) tiles[tileOf((bb[b * 4] + bb[b * 4 + 2]) / 2, (bb[b * 4 + 1] + bb[b * 4 + 3]) / 2)][1].push(b);
  const Gr = townRoadGrid();
  for (let k = 0; k < tiles.length; k++) {
    const i0 = mb.ni;
    for (const r of tiles[k][0]) townRoad(mb, r, Gr);
    for (const b of tiles[k][1]) townBuilding(mb, b);
    if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 420); }
  }
  townSeaWallBuild(mb, rs);
  townTollBuild(mb, rs);
  townSpiresBuild(mb, rs);
  townCircuitBuild(mb, rs);
  TOWNW.stats.town = mb.ni / 3; TOWNW.stats.ranges = rs.r.length;
  rs.upload(mb);
  townWaterBuild(TOWNW.water);
  R.drawables.push(TOWNW.ground, TOWNW.town, TOWNW.water);
  townTvCams();
  R.fog[0] = 0.00012;                    // clearer seaside air than the hills of the Serra: Brean Down, the Holms, Wales
  if (GAME.mode === 'world') {
    const o = new Float64Array(5), q = new Float64Array(5);
    GAME.init = () => { trackPos(-30, -1.5, o); trackPos(40, 0, q); setCamera(o[0], o[1] + 1.6, o[2], q[0], q[1] + 0.8, q[2], 1.0); R.cube.pos.set([q[0], q[1] + 1.2, q[2]]); };
    window.__cap.trackCam = (s, d, h, s2, d2, h2, fov) => { trackPos(s, d, o); trackPos(s2, d2, q); const py = Math.max(o[1], hfAt(o[0], o[2])) + h; setCamera(o[0], py, o[2], q[0], q[1] + h2, q[2], fov || 1.0); R.cube.pos.set([q[0], q[1] + 1.2, q[2]]); return [o[0], py, o[2]]; };
  }
  // capture helpers: camera at heights above the ground (h, th) of its own point and of its target
  window.__cap.town = { stats: TOWNW.stats, TOWN, TOWNW, hf: hfAt, camH: (x, z, h, tx, tz, th, fov) => window.__cap.cam(x, hfAt(x, z) + h, z, tx, hfAt(tx, tz) + th, tz, fov || 0.9) };
}
if (TOWN.on && WORLD.active) queueMicrotask(() => BUILD.push(async () => { townWorldBuild(); }));
