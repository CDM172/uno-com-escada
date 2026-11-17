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
  const boxD = (x, z, size) => { const dx = Math.max(T.x0 - (x + size), x - T.x1, 0), dz = Math.max(T.z0 - (z + size), z - T.z1, 0); return Math.hypot(dx, dz); };
  const cache = new Map();
  const split = (x, z, size) => {
    if (size > 4096) return true; if (size <= 64) return false;
    const key = x + ',' + z + ',' + size; let v = cache.get(key);
    if (v === undefined) {
      const d = boxD(x, z, size);
      if (d <= 0) v = size > 128 || trackFarDist(x + size / 2, z + size / 2) < 140;
      else v = d < size * 1.4;
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
    if (cls <= 6 && !oneway && wd >= 5.5 && lanes !== 1) fla |= 1;
    if (oneway && lanes === 2) fla |= 2;
    const dc = Math.hypot((P.x[0] - 250) / 1.0, (P.z[0] - 250) / 1.3);
    if (cls >= 2 && cls <= 6 && wd >= 5 && dc < 1100) fla |= 4;
  }
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
  const pw = ROAD_PAVE[cls]; if (!pw) return;
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
  const h0 = bi[b * 8 + 4] / 255, h1 = bi[b * 8 + 5] / 255, lu = bi[b * 8 + 6];
  const p = B.p; let gmin = 1e9, gmax = -1e9, cx = 0, cz = 0;
  for (let k = k0; k < k0 + n; k++) { const g = hfAt(p[k * 2], p[k * 2 + 1]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); cx += p[k * 2]; cz += p[k * 2 + 1]; }
  cx /= n; cz /= n;
  let base = gmin - 0.5, eaveY = gmax + hgt;
  if (kind === 8) { let dy = 0; for (const d of TOWNW.decks) if (townInRing(d.ring, cx, cz)) dy = d.y; if (dy) { base = dy - 0.3; eaveY = dy + hgt; } }
  // ---- look: walls, roof and window style from the kind of building, the district and a per-building hash
  const centre = Math.hypot((cx - 250) / 1300, (cz + 50) / 1100) < 1, seafront = cx < 230 && cz > -420 && cz < 1700 && cx > -150;
  const pick = (a, h) => a[Math.min(a.length - 1, Math.floor(h * a.length))];
  let wall, wmat, rcol, rtile = 0, style = kind, storey = 3.0;
  const hh = (h0 * 7.31 + h1) % 1;
  if (kind === 5) { wall = pick(TB_WALL.clad, h0); wmat = 3; }
  else if (kind === 4 || kind === 9) { wall = pick(TB_WALL.stone, h0 * 0.66); wmat = 2; storey = 4.5; }
  else if (kind === 8) { wall = [0.72, 0.72, 0.7]; wmat = 0; storey = 4.0; }
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
  if (roof === 0 || roof === 3) rcol = pick(TB_ROOF.flat, hh);
  else if (centre || seafront || kind === 4) { if (hh < 0.75) rcol = pick(TB_ROOF.slate, hh / 0.75); else { rcol = pick(TB_ROOF.tile, (hh - 0.75) * 4); rtile = 1; } }
  else { if (hh < 0.3) rcol = pick(TB_ROOF.slate, hh / 0.3); else { rcol = pick(TB_ROOF.tile, (hh - 0.3) / 0.7); rtile = 1; } }
  // ---- ridge frame and roof function
  const cr = Math.cos(ridge), sr = Math.sin(ridge);
  const us = _bu, vs = _bv; us.length = vs.length = n;
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < n; i++) { const x = p[(k0 + i) * 2], z = p[(k0 + i) * 2 + 1], u = x * cr + z * sr, v = -x * sr + z * cr; us[i] = u; vs[i] = v; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
  if ((roof === 1 || roof === 2) && hv > 9.5 && kind !== 4) roof = 0;
  if (kind === 9) roof = 3;
  const pitch = kind === 4 ? 1.0 : kind <= 1 || kind === 10 ? 0.75 : 0.6;
  const rise = roof === 1 || roof === 2 ? Math.min(hv * pitch, Math.max(2.2, hgt * 0.55), 7.5) : 0, kk = hv > 0.01 ? rise / hv : 0;
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
    if (rise) {
      const lines = hip ? [[0, 1, vc], [1, 0, uc], [1, -1, uc - vc + hu - hv], [1, -1, uc - vc - hu + hv], [1, 1, uc + vc + hu - hv], [1, 1, uc + vc - hu + hv]] : [[0, 1, vc]];
      for (const l of lines) { const den = l[0] * du + l[1] * dv; if (Math.abs(den) < 1e-9) continue; const t = (l[2] - l[0] * ua - l[1] * va) / den; if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
      ts.sort((a, b) => a - b);
    }
    mb.mat(10, style, wt, Math.min(255, Math.round(L))).color(wall[0], wall[1], wall[2], bh).weight(Math.min(1, eave / 64));
    for (let q = 0; q < ts.length - 1; q++) {
      const t0 = ts[q], t1 = ts[q + 1];
      const y0 = (roof === 0 || roof === 3 ? top : eaveY + fRoof(ua + du * t0, va + dv * t0)), y1 = (roof === 0 || roof === 3 ? top : eaveY + fRoof(ua + du * t1, va + dv * t1));
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const a = mb.v(x0, base, z0, nx, 0, nz, L * t0, 0), bb = mb.v(x1, base, z1, nx, 0, nz, L * t1, 0), c = mb.v(x1, y1, z1, nx, 0, nz, L * t1, y1 - base), d = mb.v(x0, y0, z0, nx, 0, nz, L * t0, y0 - base);
      townQuad(mb, a, bb, c, d, nx, 0, nz);
    }
  }
  mb.weight(0);
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
      const y = hfAt(sx + 4, sz) + 0.6; TOWNW.decks.push({ ring, y });
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
      // piles: a grid inside the deck outline, down into the beach
      mb.mat(13, 160).color(0.05, 0.05, 0.055, 1);
      for (let px = Math.ceil(x0 / 7.5) * 7.5; px < x1; px += 7.5) for (let pz = Math.ceil(z0 / 4.5) * 4.5; pz < z1; pz += 4.5) {
        if (!townInRing(ring, px, pz) || px > sx - 6) continue;
        post(px, hfAt(px, pz) - 1.5, pz, y - 0.85, 0.22, 8);
      }
      if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 500); }
    }
    r += nr;
  }
  // piers given as lines (Birnbeck Pier and its jetty): a deck ribbon on lattice legs
  const R = T.rd, ri = T.rinfo;
  for (let q = 0; q < R.n; q++) {
    if (ri[q * 4] !== 12) continue;
    const k0 = R.off[q], k1 = R.off[q + 1] - 1, wd = ri[q * 4 + 1] * 0.1, hw = wd / 2;
    const ya = hfAt(R.p[k0 * 2], R.p[k0 * 2 + 1]), yb = hfAt(R.p[k1 * 2], R.p[k1 * 2 + 1]), y = Math.max(ya, yb, TOWN.sea + 7) + 0.8;
    const i0 = mb.ni;
    for (let k = k0; k < k1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
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

// ---------------------------------------------------------------- the circuit: start line, kerbs, gantry
function townAtlas() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 512; const g = cv.getContext('2d');
  g.fillStyle = '#0d2747'; g.fillRect(0, 0, 2048, 256); g.fillStyle = '#e6b422'; g.fillRect(0, 0, 2048, 14); g.fillRect(0, 242, 2048, 14);
  const t1 = 'WESTON-SUPER-MARE', h1 = 120; strokeText(g, t1, (2048 - textW(t1, h1)) / 2, 66, h1, '#f4f1e6', 1.8, 0.08);
  g.fillStyle = '#f2efe6'; g.fillRect(0, 256, 2048, 256); g.fillStyle = '#b3160f'; g.fillRect(0, 256, 2048, 12); g.fillRect(0, 500, 2048, 12);
  const t2 = 'SEAFRONT GRAND PRIX', h2 = 104; strokeText(g, t2, (2048 - textW(t2, h2)) / 2, 330, h2, '#16181c', 1.8, 0.08);
  const tex = mkTex(2048, 512, 'rgba8unorm-srgb', TU.RT | TU.TB | TU.CD, { mipLevelCount: 12 });
  G.dev.queue.copyExternalImageToTexture({ source: cv }, { texture: tex }, [2048, 512]);
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
    const sx = o[0] + tx * 0.08 * f, sz = o[2] + tz * 0.08 * f, d0 = -pL + 0.3, d1 = d0 + bw, v0 = f < 0 ? 0 : 0.5;
    const a = mb.v(sx + nx * d0, by0, sz + nz * d0, -tx * f, 0, -tz * f, f < 0 ? 0 : 1, v0 + 0.5), b = mb.v(sx + nx * d1, by0, sz + nz * d1, -tx * f, 0, -tz * f, f < 0 ? 1 : 0, v0 + 0.5);
    const c = mb.v(sx + nx * d1, by1, sz + nz * d1, -tx * f, 0, -tz * f, f < 0 ? 1 : 0, v0), d = mb.v(sx + nx * d0, by1, sz + nz * d0, -tx * f, 0, -tz * f, f < 0 ? 0 : 1, v0);
    townQuad(mb, a, b, c, d, -tx * f, 0, -tz * f);
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
  const hard = new Uint8Array(16); for (const c of [TZ.BLD, TZ.ROAD, TZ.WATER, TZ.OUT, TZ.KERB, TZ.PAVE, TZ.SAND, TZ.MUD]) hard[c] = 1;
  const clear = (x, z, r) => !hard[zoneAt(x, z)] && !hard[zoneAt(x + r, z)] && !hard[zoneAt(x - r, z)] && !hard[zoneAt(x, z + r)] && !hard[zoneAt(x, z - r)];
  const tree = (x, z, s, arch) => push(x, hfAt(x, z) - 0.25, z, s, rnd() * TAU, rnd(), arch);
  // OSM trees: street trees and the rows along the Boulevard and the parks (they stand on pavements: only buildings and
  // carriageways keep them away)
  for (let i = 0; i < T.trees.length; i += 2) {
    const x = T.trees[i], z = T.trees[i + 1], c = zoneAt(x, z); if (c === TZ.BLD || c === TZ.ROAD || c === TZ.WATER || c === TZ.OUT) continue;
    const r = rnd(); tree(x, z, lerp(0.62, 0.92, rnd()), r < 0.55 ? 1 : r < 0.8 ? 0 : 4);
  }
  // woods, gardens, parks and fields
  const g = 6.0;
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += g) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += g) {
    const x = x0 + rnd() * g, z = z0 + rnd() * g, r1 = rnd(), r2 = rnd(), r3 = rnd(), c = zoneAt(x, z);
    let p = 0;
    if (c === TZ.WOOD) p = 0.8; else if (c === TZ.GARDEN) p = 0.075; else if (c === TZ.GRASS) p = 0.035; else if (c === TZ.FIELD) p = 0.012; else if (c === TZ.NONE) p = 0.04; else if (c === TZ.TRACK || c === TZ.PATH) p = 0.02;
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
    const p = c === TZ.WOOD ? 0.16 : c === TZ.GARDEN ? 0.05 : c === TZ.GRASS ? 0.02 : c === TZ.NONE ? 0.06 : c === TZ.FIELD ? 0.01 : 0;
    if (r1 > p || !clear(x, z, 1.4)) continue;
    push(x, hfAt(x, z) - 0.12, z, lerp(0.45, 1.05, r2), rnd() * TAU, rnd(), 5);
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
  const TS = TOWN_TILE, tw = Math.ceil((T.x1 - T.x0) / TS), th = Math.ceil((T.z1 - T.z0) / TS), tiles = [];
  for (let k = 0; k < tw * th; k++) tiles.push([[], []]);
  const tileOf = (x, z) => clamp(Math.floor((x - T.x0) / TS), 0, tw - 1) + clamp(Math.floor((z - T.z0) / TS), 0, th - 1) * tw;
  const R = T.rd; for (let r = 0; r < R.n; r++) { const k = (R.off[r] + R.off[r + 1]) >> 1; tiles[tileOf(R.p[k * 2], R.p[k * 2 + 1])][0].push(r); }
  const bb = T.bbox; for (let b = 0; b < T.bd.n; b++) tiles[tileOf((bb[b * 4] + bb[b * 4 + 2]) / 2, (bb[b * 4 + 1] + bb[b * 4 + 3]) / 2)][1].push(b);
  const Gr = townRoadGrid();
  for (let k = 0; k < tiles.length; k++) {
    const i0 = mb.ni;
    for (const r of tiles[k][0]) townRoad(mb, r, Gr);
    for (const b of tiles[k][1]) townBuilding(mb, b);
    if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 420); }
  }
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
  window.__cap.town = { stats: TOWNW.stats, TOWN, TOWNW };
}
if (TOWN.on && WORLD.active) queueMicrotask(() => BUILD.push(async () => { townWorldBuild(); }));
