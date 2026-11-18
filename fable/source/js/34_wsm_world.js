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
  for (let it = 0; it < 1; it++) {   // (2 m around the ribbons: the ground the car drives on beside the road is the ground drawn)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; tmp[k] = push[k] | (i > 0 ? push[k - 1] : 0) | (i < w - 1 ? push[k + 1] : 0); }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; push[k] = tmp[k] | (j > 0 ? tmp[k - w] : 0) | (j < h - 1 ? tmp[k + w] : 0); }
  }
  const hx1 = HF.x0 + (w - 1) * HF.res, hz1 = HF.z0 + (h - 1) * HF.res;
  const H = (px, pz) => {
    if (px >= HF.x0 && pz >= HF.z0 && px <= hx1 && pz <= hz1) {
      const fi = (px - HF.x0) * HF.ir, fj = (pz - HF.z0) * HF.ir;
      if (Number.isInteger(fi) && Number.isInteger(fj)) { const k = fj * w + fi; return HF.d[k] - (push[k] ? 0.14 : 0); }
      return hfAt(px, pz);
    }
    return townH(px, pz);
  };
  // 64 m cells that hold roads or pavements (4 m ground: fine enough to stay just under the ribbons, so the verges the car
  // drives onto are where they are drawn)
  // (only where the 8 m ground of a 128 m leaf would stray more than 10 cm from the heightfield beside a road: banks and
  // cuttings on the hills; the flat town keeps its coarser ground)
  const rc = 64, rgw = Math.ceil((T.x1 - T.x0) / rc), rgh = Math.ceil((T.z1 - T.z0) / rc), roadCell = new Uint8Array(rgw * rgh), D = HF.d;
  for (let j = 0; j < h - 4; j++) for (let i = 0; i < w - 4; i++) {
    if (!push[j * w + i]) continue;
    const c = Math.min(rgh - 1, (j * HF.res / rc) | 0) * rgw + Math.min(rgw - 1, (i * HF.res / rc) | 0); if (roadCell[c]) continue;
    const i8 = i - (i & 3), j8 = j - (j & 3), u = (i & 3) / 4, v = (j & 3) / 4, k = j8 * w + i8;
    const b = (D[k] * (1 - u) + D[k + 4] * u) * (1 - v) + (D[k + 4 * w] * (1 - u) + D[k + 4 * w + 4] * u) * v;
    if (Math.abs(D[j * w + i] - b) > 0.1) roadCell[c] = 1;
  }
  const anyRoad = new Uint8Array(rgw * rgh);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (push[j * w + i]) anyRoad[Math.min(rgh - 1, (j * HF.res / rc) | 0) * rgw + Math.min(rgw - 1, (i * HF.res / rc) | 0)] = 1;
  const hasRoads0 = (x, z, size) => {
    const i0 = Math.max(0, Math.floor((x - T.x0) / rc)), i1 = Math.min(rgw - 1, Math.floor((x + size - 1 - T.x0) / rc)), j0 = Math.max(0, Math.floor((z - T.z0) / rc)), j1 = Math.min(rgh - 1, Math.floor((z + size - 1 - T.z0) / rc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (anyRoad[j * rgw + i]) return true;
    return false;
  };
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
  // The 2 m detail patches (townDetailAdd: Kewstoke, the Toll Road, Sand Bay): leaves down to 32 m (2 m quads) wherever a
  // leaf's own grid would stray more than DTOL (12 cm) from the heightfield at its 2 m nodes (dune crests, the banks of the cutting,
  // the rhynes); elsewhere in the patches the coarser leaves stay.
  const DTOL = 0.12, dT = T.dtlTile, dS = T.dtlSize, hv = new Float32Array((NQ + 1) * (NQ + 1));
  const inDetail = (x, z, size) => {
    if (!dT) return false;
    const i0 = Math.max(0, Math.floor((x - T.x0) / dS)), i1 = Math.min(T.dtlTw - 1, Math.floor((x + size - 0.01 - T.x0) / dS));
    const j0 = Math.max(0, Math.floor((z - T.z0) / dS)), j1 = Math.min(T.dtlTh - 1, Math.floor((z + size - 0.01 - T.z0) / dS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (dT[j * T.dtlTw + i]) return true;
    return false;
  };
  const leafErr = (x, z, size) => {
    const st = size / NQ, k = Math.round(st / HF.res), n = Math.round(size / HF.res); let e = 0;
    for (let j = 0; j <= NQ; j++) for (let i = 0; i <= NQ; i++) hv[j * (NQ + 1) + i] = H(x + i * st, z + j * st);
    for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) {
      const px = x + a * HF.res, pz = z + b * HF.res; if (px < HF.x0 || pz < HF.z0 || px > hx1 || pz > hz1) continue;
      const ia = Math.min(NQ - 1, Math.floor(a / k)), jb = Math.min(NQ - 1, Math.floor(b / k)), u = a / k - ia, v = b / k - jb, q = jb * (NQ + 1) + ia;
      const s = (hv[q] * (1 - u) + hv[q + 1] * u) * (1 - v) + (hv[q + NQ + 1] * (1 - u) + hv[q + NQ + 2] * u) * v, d = Math.abs(s - H(px, pz));
      if (d > e) { e = d; if (e > DTOL) return e; }
    }
    return e;
  };
  // Adaptive leaves (64 m leaves in the detail patches whose 4 m grid would stray more than DTOL): a restricted quadtree
  // triangulation of the leaf's 2 m nodes (longest-edge bisection with nested errors, after Lindstrom and Pascucci): a node is
  // used where the surface without it would stray more than DTOL from the heightfield, or where a finer node needs it. The
  // border keeps the 4 m vertices of a regular 64 m leaf (and snaps them to a coarser neighbour), so the leaves still meet.
  const RN = 32, RW = RN + 1, rh = new Float32Array(RW * RW), rE = new Float32Array(RW * RW), rV = new Int32Array(RW * RW);
  const rqtLeaf = (x, z, size, nb) => {
    const sp = size / RN, cst0 = size / NQ;
    for (let b = 0; b <= RN; b++) for (let a = 0; a <= RN; a++) rh[b * RW + a] = H(x + a * sp, z + b * sp);
    const snapB = (a, b, alongX, ns) => {   // (as snap() below: a border node onto a coarser neighbour's edge)
      const cst = ns / NQ, t = alongX ? x + a * sp : z + b * sp, t0 = Math.floor((t - (alongX ? rx0 : rz0)) / cst) * cst + (alongX ? rx0 : rz0); if (Math.abs(t0 - t) < 1e-6) return;
      const h0 = alongX ? H(t0, z + b * sp) : H(x + a * sp, t0), h1 = alongX ? H(t0 + cst, z + b * sp) : H(x + a * sp, t0 + cst);
      rh[b * RW + a] = h0 + (h1 - h0) * (t - t0) / cst;
    };
    for (let q = 1; q < RN; q++) {
      if (nb[0] > size) snapB(0, q, false, nb[0]); if (nb[1] > size) snapB(RN, q, false, nb[1]);
      if (nb[2] > size) snapB(q, 0, true, nb[2]); if (nb[3] > size) snapB(q, RN, true, nb[3]);
    }
    // nested errors, finest first: axis(s) nodes (mid-edges of 2s squares; children: the diag(s/2) nodes around them), then
    // diag(s) nodes (centres of 2s squares; children: the axis(s) nodes around them; their diagonal alternates)
    const bstep = Math.round(cst0 / sp);
    for (let s2 = 1; s2 <= RN / 2; s2 *= 2) {
      for (let b = 0; b <= RN; b += s2) for (let a = 0; a <= RN; a += s2) {
        const hx = a % (2 * s2) === s2 && b % (2 * s2) === 0, vz = a % (2 * s2) === 0 && b % (2 * s2) === s2; if (!hx && !vz) continue;
        const k = b * RW + a; let e = hx ? Math.abs(rh[k] - (rh[k - s2] + rh[k + s2]) / 2) : Math.abs(rh[k] - (rh[k - s2 * RW] + rh[k + s2 * RW]) / 2);
        if (s2 > 1) { const h2 = s2 / 2; for (const [da, db] of [[-h2, -h2], [h2, -h2], [-h2, h2], [h2, h2]]) { const ca = a + da, cb = b + db; if (ca >= 0 && cb >= 0 && ca <= RN && cb <= RN) e = Math.max(e, rE[cb * RW + ca]); } }
        if ((hx && (b === 0 || b === RN)) || (vz && (a === 0 || a === RN))) e = (hx ? a : b) % bstep === 0 ? 1e9 : 0;   // (the border: the 4 m nodes always, no others)
        rE[k] = e;
      }
      for (let b = s2; b < RN; b += 2 * s2) for (let a = s2; a < RN; a += 2 * s2) {
        const k = b * RW + a, even = (((a / (2 * s2)) | 0) + ((b / (2 * s2)) | 0)) % 2 === 0;
        const e = even ? Math.abs(rh[k] - (rh[k - s2 * RW - s2] + rh[k + s2 * RW + s2]) / 2) : Math.abs(rh[k] - (rh[k - s2 * RW + s2] + rh[k + s2 * RW - s2]) / 2);
        rE[k] = Math.max(e, rE[k - s2], rE[k + s2], rE[k - s2 * RW], rE[k + s2 * RW]);
      }
    }
    rV.fill(-1);
    const vtx = (a, b) => {
      const k = b * RW + a; if (rV[k] >= 0) return rV[k];
      const px = x + a * sp, pz = z + b * sp;
      return rV[k] = mb.v(px, rh[k], pz, H(px - sp, pz) - H(px + sp, pz), 2 * sp, H(px, pz - sp) - H(px, pz + sp), px, pz);
    };
    const tri = (ax, az, lx, lz, rx, rz) => {   // apex, left, right (nodes): split at the hypotenuse's middle where it is used
      if (((lx + rx) & 1) === 0 && ((lz + rz) & 1) === 0 && Math.abs(lx - rx) + Math.abs(lz - rz) >= 2) {
        const mx = (lx + rx) >> 1, mz = (lz + rz) >> 1;
        if (rE[mz * RW + mx] > DTOL) { tri(mx, mz, ax, az, lx, lz); tri(mx, mz, rx, rz, ax, az); return; }
      }
      townTri(mb, vtx(ax, az), vtx(lx, lz), vtx(rx, rz), 0, 1, 0);
    };
    tri(RN, 0, 0, 0, RN, RN); tri(0, RN, RN, RN, 0, 0);
    TOWNW.stats.rqtLeaves = (TOWNW.stats.rqtLeaves || 0) + 1;
  };
  const boxD = (x, z, size) => { const dx = Math.max(T.x0 - (x + size), x - T.x1, 0), dz = Math.max(T.z0 - (z + size), z - T.z1, 0); return Math.hypot(dx, dz); };
  const cache = new Map();
  const split = (x, z, size) => {
    if (size > 4096) return true; if (size <= 64) return false;
    const key = x + ',' + z + ',' + size; let v = cache.get(key);
    if (v === undefined) {
      const d = boxD(x, z, size);
      if (d <= 0) v = size > 256 || (size > 128 && hasRoads0(x, z, size)) || (size > 64 && (hasRoads(x, z, size) || nearToll(x, z, size))) || (inDetail(x, z, size) && leafErr(x, z, size) > DTOL);
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
    if (hmax < T.sea - 0.6) {           // all under the sea (the water hides it), unless some of it is dry land below the tide
      let all = true; for (let j = 0; j <= NQ && all; j += 2) for (let i = 0; i <= NQ && all; i += 2) all = townWetAt(x + i * st, z + j * st);
      if (all) continue;
    }
    const nb = [sizeAt(x - 1, z + size / 2), sizeAt(x + size + 1, z + size / 2), sizeAt(x + size / 2, z - 1), sizeAt(x + size / 2, z + size + 1)];
    if (size === 64 && inDetail(x, z, size) && leafErr(x, z, size) > DTOL) { rqtLeaf(x, z, size, nb); continue; }
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
// A flight of stone steps (Monk's Steps up through the woods from Kewstoke church, the town's steps): worn limestone
// treads and risers climbing the ground, a rise of about 0.16 m, longer goings where it eases (up to a 1.6 m landing);
// each tread level, just clear of the ground across its width, skirted down to the ground at its sides
const _stp = new Float64Array(8192);
function townSteps(mb, r) {
  const T = TOWN, R = T.rd, ri = T.rinfo, hw = Math.max(0.55, ri[r * 4 + 1] * 0.05), k0 = R.off[r], k1 = R.off[r + 1];
  // the centre line resampled every 0.1 m: x, z, ground (the highest across the width)
  const S = _stp; let n = 0;
  for (let k = k0; k < k1 - 1 && n < 2700; k++) {
    const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const m = Math.max(1, Math.ceil(L / 0.1)), nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
    for (let q = (n ? 1 : 0); q <= m && n < 2700; q++) { const x = ax + (bx - ax) * q / m, z = az + (bz - az) * q / m; S[n * 3] = x; S[n * 3 + 1] = z; S[n * 3 + 2] = Math.max(hfAt(x, z), hfAt(x + nx, z + nz), hfAt(x - nx, z - nz)); n++; }
  }
  if (n < 4) return;
  const up = S[(n - 1) * 3 + 2] >= S[2], at = i => up ? i : n - 1 - i;   // (always built climbing)
  let i0 = 0, y = S[at(0) * 3 + 2] + 0.03, hp = hash2(r, 77);
  const tread = (ia, ib, yt, ynext) => {
    const a = at(ia), b = at(ib), ax = S[a * 3], az = S[a * 3 + 1], bx = S[b * 3], bz = S[b * 3 + 1], L = Math.hypot(bx - ax, bz - az) || 1e-3;
    const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz * hw, nz = tx * hw, h = hash2(ia, r);
    mb.mat(15).color(0.33 + h * 0.05, 0.325 + h * 0.05, 0.3 + h * 0.04, 1);
    const A = mb.v(ax - nx, yt, az - nz, 0, 1, 0, 0, 0), B = mb.v(bx - nx, yt, bz - nz, 0, 1, 0, 0, 0), C = mb.v(bx + nx, yt, bz + nz, 0, 1, 0, 0, 0), D = mb.v(ax + nx, yt, az + nz, 0, 1, 0, 0, 0);
    townQuad(mb, A, B, C, D, 0, 1, 0);
    // the riser up to the next tread (facing down the flight), the skirts at both sides
    mb.color(0.27 + h * 0.04, 0.265 + h * 0.04, 0.245 + h * 0.03, 1);
    if (!ia) { const g0 = Math.min(hfAt(ax - nx, az - nz), hfAt(ax + nx, az + nz)) - 0.1, E = mb.v(ax - nx, g0, az - nz, -tx, 0, -tz, 0, 0), F = mb.v(ax + nx, g0, az + nz, -tx, 0, -tz, 0, 0), G = mb.v(ax + nx, yt, az + nz, -tx, 0, -tz, 0, 0), H = mb.v(ax - nx, yt, az - nz, -tx, 0, -tz, 0, 0); townQuad(mb, E, F, G, H, -tx, 0, -tz); }   // (the first riser, from the ground)
    if (ynext > yt + 0.01) { const E = mb.v(bx - nx, yt, bz - nz, -tx, 0, -tz, 0, 0), F = mb.v(bx + nx, yt, bz + nz, -tx, 0, -tz, 0, 0), G = mb.v(bx + nx, ynext, bz + nz, -tx, 0, -tz, 0, 0), H = mb.v(bx - nx, ynext, bz - nz, -tx, 0, -tz, 0, 0); townQuad(mb, E, F, G, H, -tx, 0, -tz); }
    for (const sd of [-1, 1]) {
      const px = sd * nx, pz = sd * nz, ga = hfAt(ax + px, az + pz) - 0.15, gb = hfAt(bx + px, bz + pz) - 0.15; if (ga > yt - 0.04 && gb > yt - 0.04) continue;
      const E = mb.v(ax + px, Math.min(ga, yt), az + pz, px, 0, pz, 0, 0), F = mb.v(bx + px, Math.min(gb, yt), bz + pz, px, 0, pz, 0, 0), G = mb.v(bx + px, Math.max(yt, ynext), bz + pz, px, 0, pz, 0, 0), H = mb.v(ax + px, yt, az + pz, px, 0, pz, 0, 0);
      townQuad(mb, E, F, G, H, px, 0, pz);
    }
  };
  const ST = [];   // [i0, i1, tread height]: level, clear of the ground, never lower than the one below
  for (let i = 1; i < n; i++) {
    const g = S[at(i) * 3 + 2], going = (i - i0) * 0.1;
    if ((g + 0.03 - y >= 0.15 + hp * 0.03 && going >= 0.28) || going >= 1.6 || i === n - 1) {
      let yt = y; for (let j = i0; j <= i; j++) yt = Math.max(yt, S[at(j) * 3 + 2] + 0.03);
      ST.push(i0, i, yt); y = yt + 0.005; i0 = i;
    }
  }
  for (let q = 0; q < ST.length; q += 3) tread(ST[q], ST[q + 1], ST[q + 2], q + 3 < ST.length ? ST[q + 5] : ST[q + 2]);
}
const _rp = { x: new Float64Array(4096), z: new Float64Array(4096), s: new Float64Array(4096), nx: new Float64Array(4096), nz: new Float64Array(4096), m: new Float64Array(4096), ok: new Uint8Array(4096), jn: new Float64Array(4096) };
const _tn = new Float64Array(3);
function townRoad(mb, r, G) {
  const T = TOWN, R = T.rd, ri = T.rinfo, cls = ri[r * 4], wd = ri[r * 4 + 1] * 0.1, fl = ri[r * 4 + 2], lanes = ri[r * 4 + 3] & 15;   // (the high bits: roundabout, no pavement left or right)
  if (cls === 12) return;
  if (cls === 10 && (fl & 16)) { townSteps(mb, r); return; }   // (a flight of steps: treads and risers)
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
    else if (cls >= 4 && P.x[0] > 1300 && P.z[0] < -1450) {   // (Kewstoke and Sand Bay: the lanes under Worlebury's trees too)
      let wd = 0, nn = 0;
      for (let i = 0; i < n; i += 2) for (const sd of [-1, 1]) { const x = P.x[i] + P.nx[i] * sd * (hw + 3), z = P.z[i] + P.nz[i] * sd * (hw + 3), ii = (x - T.x0) | 0, jj = (z - T.z0) | 0; nn++; if (ii >= 0 && jj >= 0 && ii < T.zw && jj < T.zh && T.zone[jj * T.zw + ii] === TZ.WOOD) wd++; }
      if (wd > nn * 0.55) fla |= 16;
    }
  }
  if (cls === 10 && (fl & 16)) fla |= 32;  // steps
  if (fl & 8) fla |= 64;                    // block paving (drives, car park aisles, setts)
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
const TB_KEW_RENDER = [[0.7, 0.69, 0.65], [0.68, 0.66, 0.6], [0.64, 0.6, 0.5], [0.72, 0.71, 0.68]];
const TB_KEW_PANTILE = [[0.33, 0.13, 0.065], [0.3, 0.15, 0.08], [0.26, 0.11, 0.07]];
const TB_KEW_CONCRETE = [[0.2, 0.11, 0.08], [0.14, 0.14, 0.14], [0.17, 0.1, 0.07], [0.11, 0.11, 0.115]];
const _bu = [], _bv = [], _bt = [];
function townBuilding(mb, b) {
  const T = TOWN, B = T.bd, bi = T.binfo, k0 = B.off[b], n = B.off[b + 1] - k0; if (n < 3) return;
  const lp = townLandmarkProp(b); if (lp >= 0) { const f = townLandmarkFrame(b); townPropPut(lp, f[0], f[2], f[1], f[3]); return; }   // (its own model)
  if (TOWNW.arch && archFromTown(b)) return;   // (the architecture kit, 35_wsm_arch.js, takes the building)
  const kind = bi[b * 8], hgt = bi[b * 8 + 1] * 0.25; let roof = bi[b * 8 + 2]; const ridge = bi[b * 8 + 3] / 256 * PI;
  if (roof === 4) roof = 2;   // (a half-hip, from the LIDAR: drawn as a hip here)
  const h0 = bi[b * 8 + 4] / 255, h1 = bi[b * 8 + 5] / 255, lu = bi[b * 8 + 6] & 15, look = bi[b * 8 + 6] >> 4;   // look: landmark (bake)
  const p = B.p; let gmin = 1e9, gmax = -1e9, cx = 0, cz = 0;
  for (let k = k0; k < k0 + n; k++) { const g = hfAt(p[k * 2], p[k * 2 + 1]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); cx += p[k * 2]; cz += p[k * 2 + 1]; }
  cx /= n; cz /= n;
  let base = gmin - 0.5, eaveY = gmax + hgt;
  let onDeck = false;
  for (const d of TOWNW.decks) if (cx > d.x0 && cx < d.x1 && cz > d.z0 && cz < d.z1 && townInRing(d.ring, cx, cz)) { base = d.y - 0.3; eaveY = d.y + hgt; onDeck = true; }   // on a pier deck
  if (kind === 11 && !onDeck && cx < 260 && cz > -900 && cz < 2900 && townProp('shelter') >= 0) {   // (a seafront shelter: the Blender model)
    const f = townLandmarkFrame(b); townPropPut(townProp('shelter'), f[0], f[2], f[1], f[3]); return;
  }
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
  const kew = cx > 1300 && cz < -1450, kewOld = kew && Math.hypot(cx - 1778, cz + 1891) < 330;   // (Kewstoke, Sand Bay; the old village)
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
  } else if (kew && kind !== 6) {
    // Kewstoke and Sand Bay: the village's old cottages in grey limestone rubble or whitewashed render; the bungalows and
    // post-war houses round it rendered, pebbledashed or (fewer) in brick
    if (kewOld) { if (h0 < 0.45) { wall = pick(TB_WALL.stone, h1 * 0.66); wmat = 2; } else if (h0 < 0.82) { wall = pick(TB_KEW_RENDER, h1); wmat = 0; } else if (h0 < 0.92) { wall = pick(TB_WALL.dash, h1); wmat = 0; } else { wall = pick(TB_WALL.brick, h1); wmat = 1; } storey = 2.6; }
    else { if (h0 < 0.38) { wall = pick(TB_KEW_RENDER, h1); wmat = 0; } else if (h0 < 0.68) { wall = pick(TB_WALL.dash, h1); wmat = 0; } else if (h0 < 0.9) { wall = pick(TB_WALL.brick, h1); wmat = 1; } else { wall = pick(TB_WALL.stone, h1 * 0.66); wmat = 2; } storey = 2.55; }
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
  else if (kewOld) { if (hh < 0.4) rcol = pick(TB_ROOF.slate, hh / 0.4); else { rcol = pick(TB_KEW_PANTILE, (hh - 0.4) / 0.6); rtile = 1; } }   // (slate, Somerset clay pantiles)
  else if (kew) { if (hh < 0.15) rcol = pick(TB_ROOF.slate, hh / 0.15); else { rcol = pick(TB_KEW_CONCRETE, (hh - 0.15) / 0.85); rtile = 1; } }   // (concrete interlocking tiles)
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
  if ((TOWN.chim || TOWN.dorm) && TOWNW.jobs) townJob(cx, cz, () => townRoofExtras(mb, b, gmax, eaveY, fRoof, cr, sr, vc, hv, rise, wall, wmat, rcol, rtile, bh));
}
// small details (chimneys, dormers, street furniture, boundaries, markings) are built in 128 m tiles drawn only near the
// camera (each tile a range with its own distance limit)
function townJob(x, z, f, dist) {   // (two distance classes per tile: the small things within 350 m, the tall ones within 600 m)
  const k = Math.floor(x / 128) + ',' + Math.floor(z / 128) + ',' + ((dist || 600) <= 350 ? 350 : 600); let l = TOWNW.jobs.get(k); if (!l) TOWNW.jobs.set(k, l = []); l.push(f);
}
function townJobsRun(mb, rs) {
  for (const [k, fs] of TOWNW.jobs) {
    const d = +k.split(',')[2], a = mb.ni;
    for (const f of fs) f();
    if (mb.ni > a) { rs.addRange(mb, a, mb.ni, 3, d); rs.addRange(mb, a, mb.ni, 4, Math.min(d, 150)); }
  }
  TOWNW.jobs.clear();
}
// The LIDAR's chimney stacks (brick or the house's own walls, with clay pots) and dormers (a box on the slope with a window
// in its face and a flat lead top) on a pitched roof; in the ridge frame (u along the ridge, v across), fRoof(u, v) is the
// roof's height above the eaves.
function townRoofExtras(mb, b, gmax, eaveY, fRoof, cr, sr, vc, hv, rise, wall, wmat, rcol, rtile, bh) {
  const T = TOWN, C = T.chim, D = T.dorm; if (!C && !D) return;
  if (!T.chimStart) {   // (first call: per-building index of the stacks and dormers)
    const n = T.bd.n, idx = (L) => { const st = new Int32Array(n + 1); if (L) { for (let i = 0; i < L.n; i++) st[L.b[i] + 1]++; for (let k = 0; k < n; k++) st[k + 1] += st[k]; } return st; };
    T.chimStart = idx(C); T.dormStart = idx(D);
  }
  const toU = (x, z) => x * cr + z * sr, toV = (x, z) => -x * sr + z * cr, toX = (u, v) => u * cr - v * sr, toZ = (u, v) => u * sr + v * cr;
  if (C) for (let i = T.chimStart[b]; i < T.chimStart[b + 1]; i++) {
    const x = C.xz[i * 2] * 0.01, z = C.xz[i * 2 + 1] * 0.01, top = Math.max(eaveY + 0.8, gmax + C.h[i * 2] * 0.1), wdt = Math.max(0.6, C.h[i * 2 + 1] * 0.1);
    const u = toU(x, z), v = toV(x, z), yr = eaveY + fRoof(u, v), y0 = yr - 0.3; if (top < yr + 0.5) continue;
    // the stack: across the ridge, brick unless the house is stone or rendered (then the stack is too), a cap course
    const brick = wmat === 1 || wmat === 3, col = brick ? [0.36, 0.17, 0.1] : wall;
    mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotY(m4(), -Math.atan2(sr, cr))));
    mb.mat(15).color(col[0], col[1], col[2], 1); mb.box(0, (y0 + top) / 2, 0, 0.62, top - y0, wdt);
    mb.color(col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1); mb.box(0, top - 0.06, 0, 0.72, 0.12, wdt + 0.1);
    const np = Math.max(1, Math.min(5, Math.round(wdt / 0.42)));
    mb.mat(15).color(0.5, 0.24, 0.13, 1);
    for (let q = 0; q < np; q++) { const pz = (q + 0.5) / np * wdt - wdt / 2; mb.cyl(0, top, pz, 0.1, top + 0.42, 0.085, 7, false, true); }
    mb.pop();
  }
  if (D && rise > 0.8) for (let i = T.dormStart[b]; i < T.dormStart[b + 1]; i++) {
    const x = D.xz[i * 2] * 0.01, z = D.xz[i * 2 + 1] * 0.01, wd = Math.max(1.2, D.h[i * 3] * 0.1), sd = D.h[i * 3 + 2] ? 1 : -1;
    const u = toU(x, z), v = toV(x, z), kk = rise / hv;
    // the face stands a little down the slope from the blob's middle; its top at the measured height (or 1.4 m up)
    const vf = vc + sd * Math.min(hv - 0.5, Math.abs(v - vc) + 0.5), yb = eaveY + fRoof(u, vf), yt = Math.min(eaveY + rise - 0.25, Math.max(yb + 1.1, gmax + D.h[i * 3 + 1] * 0.1));
    const vb = vc + sd * Math.max(0.2, hv - (yt - eaveY) / kk); if (Math.abs(vf - vc) <= Math.abs(vb - vc) + 0.3) continue;
    const ua = u - wd / 2, ub = u + wd / 2, nxf = -sr * sd, nzf = cr * sd;
    // face: the house's wall material with one window
    mb.mat(10, 0, (wmat << 6) | 13, Math.max(1, Math.round(wd))).color(wall[0], wall[1], wall[2], bh).weight((yt - yb + 0.6) / 64);
    let a = mb.v(toX(ua, vf), yb, toZ(ua, vf), nxf, 0, nzf, 0, 0.6), c2 = mb.v(toX(ub, vf), yb, toZ(ub, vf), nxf, 0, nzf, wd, 0.6), c3 = mb.v(toX(ub, vf), yt, toZ(ub, vf), nxf, 0, nzf, wd, 0.6 + yt - yb), c4 = mb.v(toX(ua, vf), yt, toZ(ua, vf), nxf, 0, nzf, 0, 0.6 + yt - yb);
    townQuad(mb, a, c2, c3, c4, nxf, 0, nzf); mb.weight(0);
    // cheeks (the triangles between the face, the top and the roof slope)
    mb.mat(15).color(wall[0] * 0.9, wall[1] * 0.9, wall[2] * 0.9, 1);
    for (const ue of [ua, ub]) {
      const sn = ue === ua ? -1 : 1, enx = cr * sn, enz = sr * sn;
      const p0 = mb.v(toX(ue, vf), yb, toZ(ue, vf), enx, 0, enz, 0, 0), p1 = mb.v(toX(ue, vf), yt, toZ(ue, vf), enx, 0, enz, 0, 0), p2 = mb.v(toX(ue, vb), yt, toZ(ue, vb), enx, 0, enz, 0, 0);
      townTri(mb, p0, p1, p2, enx, 0, enz);
    }
    // a flat lead top (slightly proud)
    mb.mat(12).color(0.22, 0.23, 0.24, bh);
    const e = 0.08, t0 = mb.v(toX(ua - e, vf + sd * e), yt + 0.04, toZ(ua - e, vf + sd * e), 0, 1, 0, 0, 0), t1 = mb.v(toX(ub + e, vf + sd * e), yt + 0.04, toZ(ub + e, vf + sd * e), 0, 1, 0, 0, 0);
    const t2 = mb.v(toX(ub + e, vb), yt + 0.04, toZ(ub + e, vb), 0, 1, 0, 0, 0), t3 = mb.v(toX(ua - e, vb), yt + 0.04, toZ(ua - e, vb), 0, 1, 0, 0, 0);
    townQuad(mb, t0, t1, t2, t3, 0, 1, 0);
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
    const ya = hfAt(RD.p[k0 * 2], RD.p[k0 * 2 + 1]), yb = hfAt(RD.p[k1 * 2], RD.p[k1 * 2 + 1]), y = Math.max(ya, yb, TOWN.seaMid + 7) + 0.8;   // (not the tide's level: the deck stays put)
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
    mb.mat(15).color(0.37, 0.36, 0.33, 1); mb.cyl(0, tt + 0.9, 0, 1.06, tt + 2.4, 0.04, 8, true, false);
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
    mb.mat(10, 9, (2 << 6) | 30, 255).color(0.19, 0.2, 0.16, 0.6).weight(0);
    const a = mb.v(ax, foot, az, nx, 0, nz, u0, 0), b = mb.v(bx, foot, bz, nx, 0, nz, u0 + L, 0), c = mb.v(bx, top, bz, nx, 0, nz, u0 + L, top - foot), d = mb.v(ax, top, az, nx, 0, nz, u0, top - foot);
    townQuad(mb, a, b, c, d, nx, 0, nz);
    mb.mat(15).color(0.16, 0.19, 0.11, 1);
    const e = mb.v(ax, top, az, 0, 1, 0, 0, 0), f = mb.v(bx, top, bz, 0, 1, 0, 0, 0), g = mb.v(bx - nx * 0.5, top, bz - nz * 0.5, 0, 1, 0, 0, 0), hh = mb.v(ax - nx * 0.5, top, az - nz * 0.5, 0, 1, 0, 0, 0);
    townQuad(mb, e, f, g, hh, 0, 1, 0);
  }
  // galvanised W-beam crash barriers on posts where the ground drops away towards Sand Bay
  for (let i = 0; i < B.length; i += 5) {
    const ax = B[i], az = B[i + 1], bx = B[i + 2], bz = B[i + 3], y = B[i + 4], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, ang = Math.atan2(tz, tx);
    // (the W profile: two ridges either side of a groove, on a spacer, on steel posts)
    mb.push(m4mul(m4(), m4translate(m4(), (ax + bx) / 2, 0, (az + bz) / 2), m4rotY(m4(), -ang)));
    mb.mat(15).color(0.15, 0.155, 0.16, 1); mb.box(0, y + 0.66, 0, L + 0.05, 0.13, 0.09); mb.box(0, y + 0.47, 0, L + 0.05, 0.13, 0.09);
    mb.color(0.09, 0.095, 0.1, 1); mb.box(0, y + 0.565, 0, L + 0.05, 0.08, 0.05);
    mb.pop();
    mb.color(0.17, 0.175, 0.18, 1); mb.box(ax, y + 0.36, az, 0.12, 0.82, 0.08);
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
  // the toll booth at the Kewstoke end (by the Kewstoke Toll Gate bus stop): a white timber hut on the hill side with
  // its window to the road and a felted roof, the barrier's red and white arm raised beside it
  for (let r = 0; r < R.n; r++) {
    if (!(ri[r * 4 + 2] & 128)) continue;
    const k0 = R.off[r], k1 = R.off[r + 1] - 1, d0 = Math.hypot(R.p[k0 * 2] - 1421, R.p[k0 * 2 + 1] + 1690), d1 = Math.hypot(R.p[k1 * 2] - 1421, R.p[k1 * 2 + 1] + 1690);
    if (Math.min(d0, d1) > 80) continue;
    const k = d0 < d1 ? k0 : k1, kn = d0 < d1 ? k0 + 1 : k1 - 1, hw = ri[r * 4 + 1] * 0.05, x0 = R.p[k * 2], z0 = R.p[k * 2 + 1];
    const dx = R.p[kn * 2] - x0, dz = R.p[kn * 2 + 1] - z0, L = Math.hypot(dx, dz) || 1, tx = dx / L, tz = dz / L, s = Math.min(16, L * 0.8), cx = x0 + tx * s, cz = z0 + tz * s;
    const sd = hfAt(cx - tz * 6, cz + tx * 6) > hfAt(cx + tz * 6, cz - tx * 6) ? 1 : -1, o = hw + 2.1, bx = cx - tz * sd * o, bz = cz + tx * sd * o, y = hfAt(bx, bz) + 0.05;
    mb.push(m4mul(m4(), m4translate(m4(), bx, 0, bz), m4rotY(m4(), -Math.atan2(tz, tx))));   // (local x along the road, +z its right)
    const rz = -sd;   // (towards the road, in the local frame)
    mb.mat(15).color(0.4, 0.4, 0.38, 1); mb.box(0, y + 0.1, 0, 3.1, 0.3, 2.5);
    mb.color(0.74, 0.73, 0.69, 1); mb.box(0, y + 1.45, 0, 2.6, 2.4, 2.0);
    mb.mat(13, 20).color(0.035, 0.045, 0.055, 1); mb.box(0, y + 1.6, rz * 1.005, 1.9, 1.0, 0.04); mb.box(1.305, y + 1.6, 0, 0.04, 0.8, 1.1);
    mb.mat(15).color(0.8, 0.8, 0.77, 1); mb.box(0, y + 1.08, rz * 1.06, 2.1, 0.06, 0.16);
    mb.color(0.1, 0.24, 0.14, 1); mb.box(-1.305, y + 1.25, 0, 0.05, 2.0, 0.85);
    mb.color(0.1, 0.1, 0.11, 1); mb.box(0, y + 2.74, 0, 3.3, 0.14, 2.7); mb.color(0.8, 0.8, 0.78, 1); mb.box(0, y + 2.62, 0, 3.34, 0.12, 2.74);
    mb.color(0.85, 0.84, 0.8, 1); mb.box(0, y + 2.3, rz * 1.04, 2.0, 0.34, 0.05);
    // the barrier: a post at the edge of the road, its arm standing up
    const px = 2.4, pz = rz * (o - hw - 0.5);
    mb.color(0.8, 0.8, 0.78, 1); mb.box(px, y + 0.5, pz, 0.3, 1.0, 0.3);
    for (let q = 0; q < 5; q++) { if (q & 1) mb.color(0.85, 0.85, 0.82, 1); else mb.color(0.62, 0.05, 0.04, 1); mb.box(px, y + 1.0 + q * 0.7 + 0.35, pz, 0.1, 0.7, 0.1); }
    mb.pop();
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
  // the sea at the tide's level: a grid where the ground can be under water (depth as colour), big quads beyond, out to
  // the horizon. The shader keeps only what the sea reaches at this tide (T.wet, T.wetFar: the land below the tide that it
  // cannot flow to stays dry), so the grid covers just the 25 m cells that hold some of it.
  const gx0 = T.x0 - 1200, gz0 = T.z0 - 800, gx1 = T.x1, gz1 = T.z1 + 800, nx = Math.round((gx1 - gx0) / st), nz = Math.round((gz1 - gz0) / st);
  const i0 = mb.ni, vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), dep = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = gx0 + i * st, z = gz0 + j * st; dep[j * (nx + 1) + i] = sea - (x > T.x0 && z > T.z0 && x < T.x1 && z < T.z1 ? hfAt(x, z) : townH(x, z)); }
  const any = new Uint8Array(nx * nz), any2 = new Uint8Array(nx * nz);
  for (let j = 0; j < HF.h; j++) for (let i = 0; i < HF.w; i++) if (T.wet[j * HF.w + i]) {
    const ci = Math.floor((HF.x0 + i * HF.res - gx0) / st), cj = Math.floor((HF.z0 + j * HF.res - gz0) / st); if (ci >= 0 && cj >= 0 && ci < nx && cj < nz) any[cj * nx + ci] = 1;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = gx0 + i * st, z = gz0 + j * st;
    if ((x + st <= HF.x0 || z + st <= HF.z0 || x >= HF.x0 + (HF.w - 1) * HF.res || z >= HF.z0 + (HF.h - 1) * HF.res) &&
      (townWetAt(x, z) || townWetAt(x + st, z) || townWetAt(x, z + st) || townWetAt(x + st, z + st) || townWetAt(x + st / 2, z + st / 2))) any[j * nx + i] = 1;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {   // (and the cells around them: a node on a cell's edge)
    let a = 0; for (let b = Math.max(0, j - 1); b <= Math.min(nz - 1, j + 1) && !a; b++) for (let c = Math.max(0, i - 1); c <= Math.min(nx - 1, i + 1) && !a; c++) a = any[b * nx + c];
    any2[j * nx + i] = a;
  }
  const V = (i, j) => { const k = j * (nx + 1) + i; if (vid[k] < 0) { mb.color(sat(dep[k] / 7), 0, 0, 1); vid[k] = mb.v(gx0 + i * st, sea, gz0 + j * st, 0, 1, 0, 0, 0); } return vid[k]; };
  mb.mat(1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!any2[j * nx + i]) continue;
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
      // (a lake keeps its own level unless the sea is over it at this tide: the Marine Lake under a high tide that tops its
      // causeway; tidal waters have no level of their own, -3276.8: the sea draws them)
      if (Math.abs(ar) > 40 && lvl > -3000 && (lvl > sea + 0.3 || !townWetAt(us.reduce((a, b) => a + b) / n, vs.reduce((a, b) => a + b) / n))) {
        const tris = [], i2 = mb.ni; townEarClip(us, vs, n, tris); mb.color(0.5, 1, 0, 1);
        const v0 = mb.nv; for (let k = 0; k < n; k++) mb.v(us[k], lvl, vs[k], 0, 1, 0, 0, 0);
        for (let k = 0; k < tris.length; k += 3) townTri(mb, v0 + tris[k], v0 + tris[k + 1], v0 + tris[k + 2], 0, 1, 0);
        rs.addRange(mb, i2, mb.ni, 7);
      }
    }
    r += nr;
  }
  // rhynes, ditches and streams (T.ww): a ribbon of still water along each, laid in the lowest ground within 3 m of the
  // mapped line (the channel the 2 m terrain shows in the detail patches; elsewhere the water lies just above the ground),
  // broken where a road, a path or a building crosses it (a culvert or a bridge)
  const WW = T.ww;
  if (WW) {
    const Z = T.zone, zw = T.zw, i3 = mb.ni, dry = new Uint8Array(18); let nq = 0;
    for (const c of [TZ.ROAD, TZ.PAVE, TZ.KERB, TZ.BLD, TZ.PATH, TZ.TRACK, TZ.HARD, TZ.WALL, TZ.WATER, TZ.OUT]) dry[c] = 1;
    const zoneAt = (x, z) => { const i = Math.floor(x - T.x0), j = Math.floor(z - T.z0); return i < 0 || j < 0 || i >= zw || j >= T.zh ? TZ.OUT : Z[j * zw + i]; };
    mb.color(0.1, 1, 0, 1);
    for (let r2 = 0; r2 < WW.n; r2++) {
      if (WW.info[r2 * 2] === 1) continue;   // (rivers: their water areas and the tide)
      const hw = Math.max(0.5, WW.info[r2 * 2 + 1] * 0.05 - 0.15), P = [];
      for (let k = WW.off[r2]; k < WW.off[r2 + 1] - 1; k++) {
        const ax = WW.p[k * 2], az = WW.p[k * 2 + 1], bx = WW.p[k * 2 + 2], bz = WW.p[k * 2 + 3], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
        for (let q = 0; q < m; q++) P.push(ax + (bx - ax) * q / m, az + (bz - az) * q / m);
      }
      const kl = WW.off[r2 + 1] - 1; P.push(WW.p[kl * 2], WW.p[kl * 2 + 1]);
      const n = P.length / 2, NX = new Float32Array(n), NZ = new Float32Array(n), O = new Float32Array(n), O2 = new Float32Array(n);
      for (let q = 0; q < n; q++) {
        const a = Math.max(0, q - 1), b = Math.min(n - 1, q + 1), tx = P[b * 2] - P[a * 2], tz = P[b * 2 + 1] - P[a * 2 + 1], l = Math.hypot(tx, tz) || 1;
        NX[q] = -tz / l; NZ[q] = tx / l;
        let best = hfAt(P[q * 2], P[q * 2 + 1]) - 0.15, bo = 0;   // (the mapped line, unless the ground 15 cm lower lies beside it)
        for (let d = -3; d <= 3; d += 0.5) { const y = hfAt(P[q * 2] + NX[q] * d, P[q * 2 + 1] + NZ[q] * d); if (y < best) { best = y; bo = d; } }
        O[q] = bo;
      }
      for (let q = 0; q < n; q++) { let s = 0, c = 0; for (let e = -2; e <= 2; e++) { const qq = q + e; if (qq >= 0 && qq < n) { s += O[qq]; c++; } } O2[q] = s / c; }
      let prev = null;
      for (let q = 0; q < n; q++) {
        const x = P[q * 2] + NX[q] * O2[q], z = P[q * 2 + 1] + NZ[q] * O2[q];
        if (dry[zoneAt(x, z)]) { prev = null; continue; }
        const y = hfAt(x, z) + 0.06;
        const L0 = mb.v(x + NX[q] * hw, y, z + NZ[q] * hw, 0, 1, 0, 0, 0), R0 = mb.v(x - NX[q] * hw, y, z - NZ[q] * hw, 0, 1, 0, 0, 0);
        if (prev) { townQuad(mb, prev[0], prev[1], R0, L0, 0, 1, 0); nq++; }
        prev = [L0, R0];
      }
    }
    if (mb.ni > i3) rs.addRange(mb, i3, mb.ni, 5, 1500);
    TOWNW.stats.ditches = nq;
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
  if (typeof VEG_UK !== 'undefined' && VEG_UK && typeof ukPlant === 'function') return townVegPlaceUK();
  return townVegPlaceOld(push);
}
// British planting (33_veg_e_uk.js): every LIDAR crown as the species its place and its size suggest (ukZoneCtx,
// ukTreeSpecies), the Toll Road's tunnel of canopy trees and its ivy, fern and bramble verges, the woodland floor of
// Weston Woods, Sand Bay's dunes (marram on the fore dune thinning into scrub), the hedges among the town's boundaries,
// and the cabbage palms of the seafront lawns.
function townVegPlaceUK() {
  const T = TOWN, rnd = mkRng(5153), Z = T.zone, zw = T.zw;
  const zoneAt = (x, z) => { if (x < T.x0 || z < T.z0) return TZ.OUT; const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i >= zw || j >= T.zh ? TZ.OUT : Z[j * zw + i]; };
  const L = T.ltrees; if (!L) return;
  const onTop = new Uint8Array(18); for (const c of [TZ.ROAD, TZ.KERB, TZ.BLD, TZ.WALL]) onTop[c] = 1;
  for (let i = 0; i < L.length; i += 3) {
    let x = L[i], z = L[i + 1]; const h = L[i + 2], c = zoneAt(x, z);
    if (c === TZ.WATER || c === TZ.OUT || c === TZ.SAND || c === TZ.MUD) continue;
    if (onTop[c]) {       // (a crown over a road or a roof: its trunk stands beside it)
      let found = false;
      for (let rr = 1.5; rr <= 5 && !found; rr += 1) for (let a = 0; a < 8 && !found; a++) { const xx = x + Math.cos(a * PI / 4 + i) * rr, zz = z + Math.sin(a * PI / 4 + i) * rr, cc = zoneAt(xx, zz); if (!onTop[cc] && cc !== TZ.WATER && cc !== TZ.OUT) { x = xx; z = zz; found = true; } }
      if (!found) continue;
    }
    const ctx = ukZoneCtx(x, z);
    if (h < 5) { ukShrub(x, hfAt(x, z), z, ctx === UKC.DUNE || ctx === UKC.BACKDUNE ? UKC.BACKDUNE : ctx, h, i); continue; }
    ukPlant(x, hfAt(x, z), z, ukTreeSpecies(ctx, h, 0, i), h, 0, rnd() * TAU, i);
  }
  // the Toll Road: canopy trees every 6-11 m on both sides, as tall as the crowns round them; ivy, fern and bramble verges
  const RD = T.rd, ri = T.rinfo;
  for (let r = 0; r < RD.n; r++) {
    if (!(ri[r * 4 + 2] & 128)) continue;
    const hw = ri[r * 4 + 1] * 0.05, k0 = RD.off[r], k1 = RD.off[r + 1];
    const ends = [RD.p[k0 * 2], RD.p[k0 * 2 + 1], RD.p[(k1 - 1) * 2], RD.p[(k1 - 1) * 2 + 1]], nearEnd = (x, z) => Math.hypot(ends[0] - x, ends[1] - z) < 16 || Math.hypot(ends[2] - x, ends[3] - z) < 16;
    for (let k = k0; k < k1 - 1; k++) {
      const ax = RD.p[k * 2], az = RD.p[k * 2 + 1], bx = RD.p[k * 2 + 2], bz = RD.p[k * 2 + 3], Ls = Math.hypot(bx - ax, bz - az); if (Ls < 0.1) continue;
      const nx = -(bz - az) / Ls, nz = (bx - ax) / Ls;
      for (let s = rnd() * 1.4; s < Ls; s += 1.4) for (let sd = -1; sd <= 1; sd += 2) {
        const o = hw + 1.0 + rnd() * rnd() * 5, x = ax + (bx - ax) * s / Ls + nx * sd * o, z = az + (bz - az) * s / Ls + nz * sd * o, c = zoneAt(x, z), r1 = rnd();
        if (c === TZ.ROAD || c === TZ.WALL || c === TZ.BLD || c === TZ.WATER || c === TZ.OUT || c === TZ.KERB || r1 > 0.8 || nearEnd(x, z)) continue;
        if (r1 < 0.3) ukShrub(x, hfAt(x, z), z, UKC.WOOD, 0, k * 31 + s); else ukGround(x, hfAt(x, z), z, r1 < 0.5 ? 'fern' : r1 < 0.65 ? 'bramble' : 'ivy', 0, k * 17 + s);
      }
      for (let s = rnd() * 8; s < Ls; s += 6 + rnd() * 5) for (let sd = -1; sd <= 1; sd += 2) {
        const o = hw + 2.5 + rnd() * 3.5, x = ax + (bx - ax) * s / Ls + nx * sd * o, z = az + (bz - az) * s / Ls + nz * sd * o, c = zoneAt(x, z);
        if (c !== TZ.WOOD && c !== TZ.NONE && c !== TZ.GRASS && c !== TZ.FIELD) continue;
        let hs = 0, hn = 0; for (let q = 0; q < L.length; q += 3) { const dx = L[q] - x, dz = L[q + 1] - z; if (dx * dx + dz * dz < 400 && L[q + 2] > 8) { hs += L[q + 2]; hn++; } }
        if (!hn) continue;
        const ht = clamp(hs / hn, 9, 24); ukPlant(x, hfAt(x, z), z, ukTreeSpecies(UKC.WOOD, ht, 0, k * 7 + s), ht, 0, rnd() * TAU, k * 7 + s);
      }
    }
  }
  // woodland floor (a 3 m grid in the woods: brighter at their edges), Sand Bay's dunes (1.3 m)
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += 3) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += 3) {
    const x = x0 + rnd() * 3, z = z0 + rnd() * 3; if (zoneAt(x, z) !== TZ.WOOD) continue;
    let edge = 0; for (let a = 0; a < 4; a++) if (zoneAt(x + Math.cos(a * PI / 2) * 8, z + Math.sin(a * PI / 2) * 8) !== TZ.WOOD) edge++;
    ukWoodFloor(x, hfAt(x, z), z, x0 * 7.1 + z0, edge / 4);
  }
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += 1.3) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += 1.3) {
    const x = x0 + rnd() * 1.3, z = z0 + rnd() * 1.3; if (zoneAt(x, z) !== TZ.DUNE) continue;
    let back = 1; for (let d = 4; d <= 24; d += 4) { let sea = false; for (let a = 0; a < 8 && !sea; a++) { const c = zoneAt(x + Math.cos(a * PI / 4) * d, z + Math.sin(a * PI / 4) * d); sea = c === TZ.SAND || c === TZ.WATER || c === TZ.MUD; } if (sea) { back = d / 28; break; } }
    ukDunes(x, hfAt(x, z), z, back, x0 * 3.3 + z0);
  }
  // hedges: the town's boundary hedges (front gardens, the lanes, OSM barrier=hedge)
  if (typeof ukBoundaryHedges === 'function') ukBoundaryHedges(T.bsegs);
  // cabbage palms on the seafront lawns near the pier
  const o = new Float64Array(5);
  for (let s = -520; s < 260; s += 26) {
    const i = (((Math.round(s / TRK.ds)) % TRK.N) + TRK.N) % TRK.N, e = Math.min(9, T.cedge[i * 2] * 0.1);
    for (let d = e + 6; d < e + 16; d += 2.5) { trackPos(s, -d, o); const c = zoneAt(o[0], o[2]); if ((c === TZ.GRASS || c === TZ.HARD || c === TZ.NONE)) { ukPlant(o[0], hfAt(o[0], o[2]), o[2], UKS.CORDYLINE, 3.5 + rnd() * 1.5, 0, rnd() * TAU, s); break; } }
  }
}
function townVegPlaceOld(push) {
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
    const RD = T.rd, ri = T.rinfo, ends = []; let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
    for (let r = 0; r < RD.n; r++) if (ri[r * 4 + 2] & 128) {
      const a = RD.off[r], b = RD.off[r + 1] - 1; ends.push(RD.p[a * 2], RD.p[a * 2 + 1], RD.p[b * 2], RD.p[b * 2 + 1]);
      for (let k = a; k <= b; k++) { bx0 = Math.min(bx0, RD.p[k * 2]); bx1 = Math.max(bx1, RD.p[k * 2]); bz0 = Math.min(bz0, RD.p[k * 2 + 1]); bz1 = Math.max(bz1, RD.p[k * 2 + 1]); }
    }
    const LT = [];   // the crowns around the Toll Road
    for (let q = 0; q < L.length; q += 3) if (L[q] > bx0 - 40 && L[q] < bx1 + 40 && L[q + 1] > bz0 - 40 && L[q + 1] < bz1 + 40) LT.push(L[q], L[q + 1], L[q + 2]);
    const nearEnd = (x, z) => { for (let q = 0; q < ends.length; q += 2) if (Math.hypot(ends[q] - x, ends[q + 1] - z) < 16) return true; return false; };
    for (let r = 0; r < RD.n; r++) {
      if (!(ri[r * 4 + 2] & 128)) continue;
      const hw = ri[r * 4 + 1] * 0.05;
      for (let k = RD.off[r]; k < RD.off[r + 1] - 1; k++) {
        const ax = RD.p[k * 2], az = RD.p[k * 2 + 1], bx = RD.p[k * 2 + 2], bz = RD.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let s = rnd() * 1.4; s < L; s += 1.4) for (let sd = -1; sd <= 1; sd += 2) {
          const o = hw + 1.0 + rnd() * rnd() * 5, x = ax + (bx - ax) * s / L + nx * sd * o, z = az + (bz - az) * s / L + nz * sd * o, c = zoneAt(x, z), r1 = rnd(), r2 = rnd();
          if (c === TZ.ROAD || c === TZ.WALL || c === TZ.BLD || c === TZ.WATER || c === TZ.OUT || c === TZ.KERB || r1 > 0.8 || nearEnd(x, z)) continue;
          push(x, hfAt(x, z) - 0.1, z, lerp(0.55, 1.1, r2), rnd() * TAU, rnd(), r1 < 0.4 ? 5 : r1 < 0.65 ? 6 : 7);
        }
        // canopy trees every 8 m or so on both sides, 2.5 to 6 m from the edge, as tall as the crowns the LIDAR found
        // around them: their crowns meet over the lane
        for (let s = rnd() * 8; s < L; s += 6 + rnd() * 5) for (let sd = -1; sd <= 1; sd += 2) {
          const o = hw + 2.5 + rnd() * 3.5, x = ax + (bx - ax) * s / L + nx * sd * o, z = az + (bz - az) * s / L + nz * sd * o, c = zoneAt(x, z);
          if (c !== TZ.WOOD && c !== TZ.NONE && c !== TZ.GRASS && c !== TZ.FIELD) continue;
          let hs = 0, hn = 0; for (let q = 0; q < LT.length; q += 3) { const dx = LT[q] - x, dz = LT[q + 1] - z; if (dx * dx + dz * dz < 400 && LT[q + 2] > 8) { hs += LT[q + 2]; hn++; } }
          if (!hn) continue;                                                   // (no trees there in the survey)
          const ht = clamp(hs / hn, 9, 24), arch = rnd() < 0.6 ? 0 : 2;
          tree(x, z, clamp(ht / (dims[arch * 4 + 1] || 12), 0.5, 1.6), arch);
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
  const gm = 1.3;
  for (let z0 = T.z0 + 14; z0 < T.z1 - 14; z0 += gm) for (let x0 = T.x0 + 14; x0 < T.x1 - 14; x0 += gm) {
    const x = x0 + rnd() * gm, z = z0 + rnd() * gm, r1 = rnd(), r2 = rnd();
    if (zoneAt(x, z) !== TZ.DUNE || r1 > 0.4) continue;
    push(x, hfAt(x, z) - 0.05, z, lerp(0.7, 1.25, r2), rnd() * TAU, rnd(), 8);
  }
  // cabbage palms on the seafront lawns near the pier
  const o = new Float64Array(5);
  for (let s = -520; s < 260; s += 26) {
    const i = (((Math.round(s / TRK.ds)) % TRK.N) + TRK.N) % TRK.N, e = Math.min(9, T.cedge[i * 2] * 0.1);
    for (let d = e + 6; d < e + 16; d += 2.5) { trackPos(s, -d, o); const c = zoneAt(o[0], o[2]); if ((c === TZ.GRASS || c === TZ.HARD || c === TZ.NONE) && clear(o[0], o[2], 1.0)) { tree(o[0], o[2], lerp(0.55, 0.75, rnd()), 3); break; } }
  }
}

// ---------------------------------------------------------------- props modelled in Blender (36_wsm_props.js, optional)
// WSM_PROPS = [{meta: {scale, targets, chunks, prop: {name, kind, size, anchor}}, b64}, ...] in the cars' chunk format
// (positions int16 / scale, normals int8, optional uvs, indices; materials are the car shader's). Origin on the ground at
// the foot of the prop (a landmark: its footprint's centroid), X the side that faces the road, Y up. The town asks for a
// prop by a placement kind (WSMP_KINDS: the names a prop may carry); where one is loaded it is instanced there (batched
// by 128 m cells, drawn within 350 m, landmarks at any distance) and the procedural placeholder is skipped.
const WSMP_KINDS = {
  lamp_victorian: ['lamp_victorian', 'seafront_lamp', 'victorian_lamp', 'lamp_standard_victorian', 'promenade_lamp'],
  lamp_modern: ['lamp_modern', 'street_light', 'street_lamp', 'lamp_column', 'streetlight'],
  bench: ['bench', 'seafront_bench', 'bench_cast_iron'], bin: ['bin', 'litter_bin', 'waste_basket', 'litter_bin_seafront'],
  bollard: ['bollard'], post_box: ['post_box', 'pillar_box'], phone: ['phone_kiosk', 'telephone_box', 'phone_box', 'k6', 'telephone_kiosk'],
  bus_shelter: ['bus_shelter'], bus_stop: ['bus_stop', 'bus_stop_pole', 'bus_stop_flag'], signal: ['traffic_signal', 'traffic_light', 'signal_pole', 'traffic_signals'],
  belisha: ['belisha_beacon', 'belisha', 'beacon'], signpost: ['signpost', 'fingerpost', 'guidepost'], railing: ['promenade_railing', 'railing', 'railing_section'],
  shelter: ['seafront_shelter', 'promenade_shelter'], balustrade: ['glass_balustrade'],
};
const WSMP = { idx: null, place: [], landmark: new Map() };
function townPropIndex() {
  if (WSMP.idx) return WSMP.idx; WSMP.idx = new Map();
  if (typeof WSM_PROPS === 'undefined' || !WSM_PROPS || !WSM_PROPS.length) return WSMP.idx;
  // (by name first, then by kind for the placements still without one: a bus shelter and the seafront shelter are both
  // kind "shelter")
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < WSM_PROPS.length; i++) {
    const p = (WSM_PROPS[i].meta && WSM_PROPS[i].meta.prop) || {}, nm = String(p.name || '').toLowerCase(), kd = String(p.kind || '').toLowerCase();
    if (kd === 'landmark' || kd.startsWith('landmark')) { if (!pass) WSMP.landmark.set(nm, i); continue; }
    for (const [k, names] of Object.entries(WSMP_KINDS)) if (!WSMP.idx.has(k) && names.includes(pass ? kd : nm)) WSMP.idx.set(k, i);
  }
  return WSMP.idx;
}
// a prop for a placement kind (index into WSM_PROPS) or -1; place(kind, x, y, z, facing angle (the X axis))
function townProp(kind) { const i = townPropIndex().get(kind); return i === undefined ? -1 : i; }
function townPropPut(i, x, y, z, yaw) { WSMP.place.push(i, x, y, z, yaw); }
async function townPropChunks(i) {
  const e = WSM_PROPS[i], M = e.meta, buf = await bcInflate(e.b64), out = { sc: 1 / M.scale, body: [], glass: [], anchor: (M.prop && M.prop.anchor) || [0, 0, 0], paint: (M.prop && M.prop.paint) || null }; let off = 0;
  for (const ch of M.chunks) {
    if (ch.mirror) continue;                     // (no mirrored chunks in the props)
    const nv = ch.nv, ni = ch.ni;
    const pos = new Int16Array(buf, off, nv * 3); off = (off + nv * 6 + 3) & ~3;
    const nrm = new Int8Array(buf, off, nv * 4); off += nv * 4;
    if (ch.uv) off += nv * 8;
    const idx = ch.i32 ? new Uint32Array(buf, off, ni) : new Uint16Array(buf, off, ni); off = (off + ni * (ch.i32 ? 4 : 2) + 3) & ~3;
    (ch.t === 'glass' ? out.glass : out.body).push([ch, pos, nrm, idx]);
  }
  return out;
}
function townPropEmit(mb, gl, md) {
  const sc = md.sc, an = md.anchor;
  const emit = (dst, [ch, pos, nrm, idx]) => {
    const c = ch.id === 20 && md.paint ? md.paint : ch.c || [1, 1, 1], v0 = dst.nv; dst.mat(ch.id, ch.a || 0); dst.color(c[0], c[1], c[2]);   // (20: the paint, e.g. the pillar box's red)
    for (let q = 0; q < ch.nv; q++) dst.v(pos[q * 3] * sc - an[0], pos[q * 3 + 1] * sc - an[1], pos[q * 3 + 2] * sc - an[2], nrm[q * 4], nrm[q * 4 + 1], nrm[q * 4 + 2], 1, 0);
    for (let q = 0; q < ch.ni; q += 3) dst.tri(v0 + idx[q], v0 + idx[q + 1], v0 + idx[q + 2]);
  };
  for (const c of md.body) emit(mb, c);
  for (const c of md.glass) emit(gl, c);
}
// landmarks: the OSM building b whose model is loaded (by its landmark name) is not drawn; the model stands at the
// footprint's centroid, facing the road (the building's street front)
const WSM_LANDMARKS = ['', 'odeon', 'winter_gardens', 'town_hall', 'knightstone_baths', 'knightstone_opera_house', 'tropicana', 'birnbeck_pier', 'birnbeck_lifeboat_station', 'grand_atlantic_hotel', 'royal_hotel', 'weston_museum', 'playhouse', 'grand_pier_pavilion'];
function townLandmarkProp(b) {
  const T = TOWN; if (!T.lmkOf) { T.lmkOf = new Map(); const L = T.lmk; if (L) for (let q = 0; q < L.length; q += 3) T.lmkOf.set(L[q] | (L[q + 1] << 8), L[q + 2]); }
  const code = T.lmkOf.get(b); if (!code) return -1; townPropIndex();
  const i = WSMP.landmark.get(WSM_LANDMARKS[code]); return i === undefined ? -1 : i;
}
function townLandmarkFrame(b) {   // [centroid x, z, ground y, facing angle]
  const T = TOWN, B = T.bd, k0 = B.off[b], n = B.off[b + 1] - k0; let cx = 0, cz = 0, ar = 0, gmin = 1e9;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, x0 = B.p[(k0 + i) * 2], z0 = B.p[(k0 + i) * 2 + 1], x1 = B.p[(k0 + j) * 2], z1 = B.p[(k0 + j) * 2 + 1], c = x0 * z1 - x1 * z0; ar += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; gmin = Math.min(gmin, hfAt(x0, z0)); }
  cx /= 3 * ar; cz /= 3 * ar;
  let yaw = 0; const e = T.bfront ? T.bfront[b] : 255;
  if (e !== 255 && e < n) { const ax = B.p[(k0 + e) * 2], az = B.p[(k0 + e) * 2 + 1], bx = B.p[(k0 + (e + 1) % n) * 2], bz = B.p[(k0 + (e + 1) % n) * 2 + 1], L = Math.hypot(bx - ax, bz - az) || 1; yaw = Math.atan2(-(bx - ax) / L, (bz - az) / L); }
  return [cx, cz, gmin, yaw];
}
async function townPropsBuild() {
  const P = WSMP.place; if (!P.length || typeof WSM_PROPS === 'undefined') return;
  const fam = WSMP.fam = mkFamily('wsmProps', { src: 'mat_car', noCube: true, defs: { BCAR: '', OXA: '', RADIAL: '', TRAFFIC: '', PAINT_ALB: 'in.col.rgb', PAINT_MET: '0.3' } });
  const set = WSMP.set = new MeshSet(fam), glass = WSMP.glass = new GlassSet(), models = new Map(), cells = new Map();
  for (let q = 0; q < P.length; q += 5) { const i = P[q], big = WSM_PROPS[i].meta.prop && String(WSM_PROPS[i].meta.prop.kind || '').startsWith('landmark'); const k = (big ? 'L' : '') + Math.floor(P[q + 1] / 128) + ',' + Math.floor(P[q + 3] / 128); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(q); if (!models.has(i)) models.set(i, await townPropChunks(i)); }
  let tris = 0; const t = m4();
  for (const [k, list] of cells) {
    const mb = new MeshBuilder(1 << 16), gl = new MeshBuilder(1 << 12);
    for (const q of list) { const md = models.get(P[q]), c = Math.cos(P[q + 4]), s = Math.sin(P[q + 4]); t.fill(0); t[0] = c; t[2] = s; t[5] = 1; t[8] = -s; t[10] = c; t[12] = P[q + 1]; t[13] = P[q + 2]; t[14] = P[q + 3]; t[15] = 1; mb.push(t); gl.push(t); townPropEmit(mb, gl, md); mb.pop(); gl.pop(); }
    if (!mb.ni) continue;
    const mesh = mb.upload(); set.add(mesh, 0, 3, k[0] === 'L' ? 3000 : 350); tris += mesh.count / 3; if (gl.ni) glass.add_(gl.upload(), 0);
  }
  R.drawables.push({ draw(pass, ctx) {
    if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
    if (!WSMP.bg) { if (!fam.bgl3) return; const tex = mkTex(4, 4, 'rgba8unorm-srgb', TU.TB | TU.CD); G.dev.queue.writeTexture({ texture: tex }, new Uint8Array(64).fill(255), { bytesPerRow: 16 }, [4, 4]); WSMP.bg = G.dev.createBindGroup({ layout: fam.bgl3, entries: [{ binding: 0, resource: tex.createView() }] }); }
    pass.setBindGroup(3, WSMP.bg); set.draw(pass, ctx);
  } });
  R.transparents.push(glass);
  TOWNW.stats.props = { models: models.size, placed: P.length / 5, tris: Math.round(tris) };
}

// ---------------------------------------------------------------- street furniture and boundaries
// OSM's street furniture where it is mapped (bus stops, crossings, benches, bins, bollards, post boxes, phone boxes,
// signals, gates, signposts...), and the defaults the map leaves out: street lamps along every lit street (ornate
// Victorian lamps and railings on the seafront), low front-garden walls along the terraces, stone walls and hedges along
// the village and country lanes (Kewstoke, Sand Bay). OSM walls, fences and hedges as drawn. Walls, fences and hedges
// also stop the cars (capsules), except where they would cross a carriageway.
const FN = { LAMP: 1, BENCH: 2, BIN: 3, BOLLARD: 4, BUS: 5, SIGNALS: 6, CROSSING: 7, POST: 8, PHONE: 9, GUIDE: 10, INFO: 11, GIVEWAY: 12, STOP: 13, GATE: 14, CYCLES: 15, MEMORIAL: 16, MINI: 17, RING: 18, CABINET: 21 };
function townFurnitureBuild(mb, rs) {
  const T = TOWN, R = T.rd, ri = T.rinfo, Z = T.zone, zw = T.zw, rnd = mkRng(9137), i0 = mb.ni;
  const zoneAt = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= zw || j >= T.zh ? TZ.OUT : Z[j * zw + i]; };
  const gy = (x, z) => hfAt(x, z) + TZH[zoneAt(x, z)];
  // nearest road segment (drivable) to a point: direction, distance, class, half width
  const SG = new Map(), sc = 24;
  for (let r = 0; r < R.n; r++) { if (ri[r * 4] > 9) continue; for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) { const kk = Math.floor(R.p[k * 2] / sc) + ',' + Math.floor(R.p[k * 2 + 1] / sc); let l = SG.get(kk); if (!l) SG.set(kk, l = []); l.push(r, k); } }
  const NR = new Float64Array(7);   // tx, tz, dist, side (+1: the point is on the road's right), class, half width, one-way
  const nearRoad = (x, z, rmax) => {
    let best = rmax;
    NR[2] = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = SG.get((Math.floor(x / sc) + dx) + ',' + (Math.floor(z / sc) + dz)); if (!l) continue;
      for (let e = 0; e < l.length; e += 2) {
        const r = l[e], k = l[e + 1], ax = R.p[k * 2], az = R.p[k * 2 + 1], ex = R.p[k * 2 + 2] - ax, ez = R.p[k * 2 + 3] - az, L2 = ex * ex + ez * ez + 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * t - x, pz = az + ez * t - z, d = Math.hypot(px, pz);
        if (d < best) { best = d; const L = Math.sqrt(L2); NR[0] = ex / L; NR[1] = ez / L; NR[2] = d; NR[3] = (ex * (z - az) - ez * (x - ax)) > 0 ? 1 : -1; NR[4] = ri[r * 4]; NR[5] = ri[r * 4 + 1] * 0.05; NR[6] = (ri[r * 4 + 2] & 2) ? 1 : 0; }
      }
    }
    return NR[2] < rmax;
  };
  const rot = (x, z, a) => mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotY(m4(), -a)));
  // (a Blender prop of that kind where one is loaded, facing yaw; else the placeholder below, as a job)
  const put = (kind, x, y, z, yaw, job, dist) => { const i = townProp(kind); if (i >= 0) townPropPut(i, x, y, z, yaw); else townJob(x, z, job, dist); };
  const faceYaw = () => Math.atan2(NR[3] * -NR[0], NR[3] * NR[1]);   // (the X axis towards the nearest road, after nearRoad)
  // ---- the pieces (in a local frame: x along, z across, y up from the ground at y0)
  const lampModern = (x, z, a, y0) => {          // 8 m galvanised column, a short arm and a flat LED lantern over the road
    rot(x, z, a); mb.mat(13, 120).color(0.46, 0.47, 0.47, 1); mb.cyl(0, y0, 0, 0.085, y0 + 8, 0.06, 6, false, true);
    mb.box(0.55, y0 + 7.95, 0, 1.1, 0.08, 0.08); mb.color(0.2, 0.21, 0.22, 1); mb.box(1.15, y0 + 7.9, 0, 0.62, 0.12, 0.26);
    mb.mat(15).color(0.95, 0.92, 0.8, 1); mb.box(1.15, y0 + 7.83, 0, 0.5, 0.02, 0.2); mb.pop();
  };
  const lampVictorian = (x, z, a, y0) => {       // the seafront's cast-iron lamps: fluted column, scrolled arms, two lanterns
    rot(x, z, a); mb.mat(13, 90).color(0.09, 0.16, 0.13, 1);
    mb.box(0, y0 + 0.35, 0, 0.42, 0.7, 0.42); mb.cyl(0, y0 + 0.7, 0, 0.16, y0 + 1.2, 0.12, 8, false, false); mb.cyl(0, y0 + 1.2, 0, 0.1, y0 + 4.2, 0.075, 8, false, false);
    mb.box(0, y0 + 4.25, 0, 0.24, 0.12, 0.24);
    for (const sd of [-1, 1]) {
      mb.box(sd * 0.35, y0 + 4.32, 0, 0.7, 0.07, 0.07); mb.box(sd * 0.55, y0 + 4.15, 0, 0.06, 0.35, 0.06);
      mb.mat(15).color(0.98, 0.93, 0.75, 1); mb.cyl(sd * 0.7, y0 + 3.85, 0, 0.13, y0 + 4.25, 0.17, 6, true, false);
      mb.mat(13, 90).color(0.09, 0.16, 0.13, 1); mb.cyl(sd * 0.7, y0 + 4.25, 0, 0.19, y0 + 4.45, 0.03, 6, true, false);
    }
    mb.cyl(0, y0 + 4.3, 0, 0.05, y0 + 4.75, 0.02, 4, false, false); mb.pop();
  };
  const bench = (x, z, a, y0, seaside) => {      // timber slats on cast-iron ends (the seafront's are green)
    rot(x, z, a);
    mb.mat(13, 100).color(seaside ? 0.08 : 0.06, seaside ? 0.17 : 0.06, seaside ? 0.13 : 0.06, 1);
    for (const sx of [-0.85, 0.85]) { mb.box(sx, y0 + 0.24, 0.05, 0.06, 0.48, 0.5); mb.box(sx, y0 + 0.62, -0.18, 0.06, 0.4, 0.06); }
    mb.mat(15).color(0.38, 0.27, 0.16, 1);
    for (const sz of [0.18, 0.02, -0.14]) mb.box(0, y0 + 0.46, sz, 1.9, 0.04, 0.13);
    for (const sy of [0.62, 0.78]) mb.box(0, y0 + sy, -0.21, 1.9, 0.11, 0.035);
    mb.pop();
  };
  const bin = (x, z, y0) => { mb.mat(13, 140).color(0.05, 0.06, 0.06, 1); mb.cyl(x, y0, z, 0.26, y0 + 0.85, 0.28, 8, false, true); mb.color(0.62, 0.55, 0.25, 1); mb.cyl(x, y0 + 0.72, z, 0.285, y0 + 0.78, 0.285, 8, false, false); };
  const bollard = (x, z, y0) => { mb.mat(13, 150).color(0.06, 0.06, 0.06, 1); mb.cyl(x, y0, z, 0.1, y0 + 0.95, 0.09, 6, false, true); mb.mat(15).color(0.85, 0.85, 0.82, 1); mb.cyl(x, y0 + 0.75, z, 0.095, y0 + 0.85, 0.093, 6, false, false); };
  const postBox = (x, z, y0) => {                // a red pillar box with its cap and black base
    mb.mat(13, 70).color(0.06, 0.06, 0.06, 1); mb.cyl(x, y0, z, 0.31, y0 + 0.12, 0.31, 10, false, false);
    mb.color(0.62, 0.03, 0.02, 1); mb.cyl(x, y0 + 0.12, z, 0.27, y0 + 1.4, 0.27, 10, false, false); mb.cyl(x, y0 + 1.4, z, 0.31, y0 + 1.48, 0.31, 10, true, true);
    mb.cyl(x, y0 + 1.48, z, 0.28, y0 + 1.62, 0.1, 10, false, true); mb.color(0.04, 0.04, 0.04, 1); mb.box(x, y0 + 1.15, z, 0.3, 0.05, 0.56);
  };
  const phoneBox = (x, z, a, y0) => {            // the red K6 kiosk: glazed sides, domed top, a white crown sign band
    rot(x, z, a); mb.mat(13, 60).color(0.62, 0.03, 0.02, 1); mb.box(0, y0 + 0.08, 0, 1.0, 0.16, 1.0);
    for (const [cx, cz] of [[-0.43, -0.43], [0.43, -0.43], [0.43, 0.43], [-0.43, 0.43]]) mb.box(cx, y0 + 1.3, cz, 0.14, 2.3, 0.14);
    mb.mat(13, 10).color(0.12, 0.16, 0.2, 1); for (const [cx, cz, sx, sz] of [[0, -0.45, 0.72, 0.04], [0, 0.45, 0.72, 0.04], [-0.45, 0, 0.04, 0.72], [0.45, 0, 0.04, 0.72]]) mb.box(cx, y0 + 1.25, cz, sx, 1.9, sz);
    mb.mat(15).color(0.9, 0.9, 0.86, 1); mb.box(0, y0 + 2.32, 0, 0.92, 0.16, 0.92);
    mb.mat(13, 60).color(0.62, 0.03, 0.02, 1); mb.box(0, y0 + 2.48, 0, 1.02, 0.16, 1.02); mb.cyl(0, y0 + 2.56, 0, 0.5, y0 + 2.75, 0.2, 8, false, true); mb.pop();
  };
  const busStop = (x, z, a, y0, shelter) => {    // a flag on a pole; a glazed shelter where OSM says so
    rot(x, z, a); mb.mat(13, 120).color(0.42, 0.43, 0.43, 1); mb.cyl(0, y0, 0, 0.045, y0 + 2.9, 0.045, 6, false, true);
    mb.mat(15).color(0.92, 0.92, 0.9, 1); mb.box(0, y0 + 2.55, 0.24, 0.03, 0.42, 0.42); mb.color(0.7, 0.05, 0.04, 1); mb.box(0.005, y0 + 2.62, 0.24, 0.035, 0.2, 0.2);
    mb.color(0.95, 0.85, 0.15, 1); mb.box(0, y0 + 1.6, 0.06, 0.05, 0.45, 0.3);
    if (shelter) {
      mb.mat(13, 100).color(0.3, 0.32, 0.33, 1);
      for (const [cx, cz] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 0.2], [1.5, 0.2]]) mb.box(cx, y0 + 1.2, cz, 0.08, 2.4, 0.08);
      mb.box(0, y0 + 2.45, -0.4, 3.2, 0.08, 1.6);
      mb.mat(13, 5).color(0.16, 0.2, 0.22, 1); mb.box(0, y0 + 1.25, -1.0, 2.9, 1.9, 0.02); mb.box(-1.5, y0 + 1.25, -0.4, 0.02, 1.9, 1.1); mb.box(1.5, y0 + 1.25, -0.4, 0.02, 1.9, 1.1);
      mb.mat(15).color(0.35, 0.25, 0.15, 1); mb.box(0, y0 + 0.48, -0.75, 2.4, 0.05, 0.3);
    }
    mb.pop();
  };
  const signalHead = (x, z, a, y0, h) => {       // a black pole and a three-aspect head facing the traffic (red lit)
    rot(x, z, a); mb.mat(13, 130).color(0.08, 0.08, 0.08, 1); mb.cyl(0, y0, 0, 0.065, y0 + h, 0.06, 6, false, true); mb.box(0, y0 + h - 0.35, 0.1, 0.3, 0.95, 0.24);
    mb.mat(15).color(1.0, 0.12, 0.05, 1); mb.box(0, y0 + h - 0.06, 0.23, 0.2, 0.2, 0.02); mb.color(0.35, 0.22, 0.05, 1); mb.box(0, y0 + h - 0.35, 0.23, 0.2, 0.2, 0.02); mb.color(0.05, 0.25, 0.12, 1); mb.box(0, y0 + h - 0.64, 0.23, 0.2, 0.2, 0.02);
    mb.pop();
  };
  const belisha = (x, z, y0) => {                // black and white striped pole, amber globe
    for (let q = 0; q < 6; q++) { mb.mat(13, 100).color(q & 1 ? 0.9 : 0.05, q & 1 ? 0.9 : 0.05, q & 1 ? 0.88 : 0.05, 1); mb.cyl(x, y0 + q * 0.4, z, 0.055, y0 + q * 0.4 + 0.4, 0.055, 6, false, q === 5); }
    mb.mat(15).color(1.0, 0.6, 0.08, 1); const g = y0 + 2.55, pr = []; for (let q = 0; q <= 6; q++) { const t = q / 6 * PI; pr.push([g - Math.cos(t) * 0.16, Math.sin(t) * 0.16 + 0.01]); }
    mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotZ(m4(), PI / 2))); mb.lathe(pr, 8); mb.pop();
  };
  const signPost = (x, z, a, y0, kind) => {      // give way (triangle) or stop (octagon) on a grey post, facing the traffic
    rot(x, z, a); mb.mat(13, 120).color(0.42, 0.43, 0.43, 1); mb.cyl(0, y0, 0, 0.04, y0 + 2.2, 0.04, 6, false, true);
    if (kind === 13) { mb.mat(15).color(0.75, 0.04, 0.03, 1); mb.push(m4mul(m4(), m4translate(m4(), 0, y0 + 1.95, 0.05), m4rotX(m4(), PI / 2))); mb.cyl(0, -0.015, 0, 0.36, 0.015, 0.36, 8, true, true); mb.pop(); }
    else { mb.mat(15).color(0.8, 0.05, 0.04, 1); const yb = y0 + 1.7, s3 = 0.42; const a1 = mb.v(-s3, yb + 0.6, 0.06, 0, 0, 1, 0, 0), a2 = mb.v(s3, yb + 0.6, 0.06, 0, 0, 1, 0, 0), a3 = mb.v(0, yb - 0.12, 0.06, 0, 0, 1, 0, 0); townTri(mb, a1, a2, a3, 0, 0, 1); mb.color(0.95, 0.95, 0.92, 1); const b1 = mb.v(-s3 * 0.7, yb + 0.5, 0.065, 0, 0, 1, 0, 0), b2 = mb.v(s3 * 0.7, yb + 0.5, 0.065, 0, 0, 1, 0, 0), b3 = mb.v(0, yb + 0.02, 0.065, 0, 0, 1, 0, 0); townTri(mb, b1, b2, b3, 0, 0, 1); }
    mb.pop();
  };
  const fieldGate = (x, z, a, y0, w) => {        // a five-bar gate between two posts
    rot(x, z, a); mb.mat(15).color(0.32, 0.26, 0.18, 1); mb.box(-w / 2 - 0.1, y0 + 0.65, 0, 0.18, 1.3, 0.18); mb.box(w / 2 + 0.1, y0 + 0.65, 0, 0.18, 1.3, 0.18);
    mb.mat(13, 110).color(0.52, 0.53, 0.52, 1); for (let q = 0; q < 5; q++) mb.box(0, y0 + 0.25 + q * 0.21, 0, w, 0.045, 0.045);
    mb.box(-w / 2 + 0.05, y0 + 0.66, 0, 0.06, 0.95, 0.05); mb.box(w / 2 - 0.05, y0 + 0.66, 0, 0.06, 0.95, 0.05);
    mb.push(m4mul(m4(), m4translate(m4(), 0, y0 + 0.66, 0), m4rotZ(m4(), Math.atan2(0.85, w)))); mb.box(0, 0, 0, Math.hypot(w, 0.85), 0.045, 0.04); mb.pop();
    mb.pop();
  };
  const guidepost = (x, z, a, y0) => { rot(x, z, a); mb.mat(15).color(0.9, 0.9, 0.88, 1); mb.box(0, y0 + 1.3, 0, 0.12, 2.6, 0.12); mb.box(0.45, y0 + 2.3, 0, 0.8, 0.16, 0.04); mb.box(-0.4, y0 + 2.05, 0, 0.7, 0.16, 0.04); mb.color(0.85, 0.15, 0.1, 1); mb.box(0, y0 + 2.65, 0, 0.16, 0.12, 0.16); mb.pop(); };
  const cycles = (x, z, a, y0) => { rot(x, z, a); mb.mat(13, 100).color(0.15, 0.15, 0.15, 1); for (let q = -1; q <= 1; q++) { mb.box(q * 0.9, y0 + 0.45, -0.35, 0.05, 0.9, 0.05); mb.box(q * 0.9, y0 + 0.45, 0.35, 0.05, 0.9, 0.05); mb.box(q * 0.9, y0 + 0.9, 0, 0.05, 0.05, 0.75); } mb.pop(); };
  const memorial = (x, z, y0) => { mb.mat(15).color(0.62, 0.6, 0.55, 1); mb.box(x, y0 + 0.3, z, 1.6, 0.6, 1.6); mb.box(x, y0 + 1.1, z, 0.9, 1.0, 0.9); mb.cyl(x, y0 + 1.6, z, 0.4, y0 + 4.2, 0.06, 4, false, false); };
  const cabinet = (x, z, a, y0) => { rot(x, z, a); mb.mat(13, 120).color(0.12, 0.2, 0.15, 1); mb.box(0, y0 + 0.6, 0, 1.1, 1.2, 0.45); mb.pop(); };
  const lifeRing = (x, z, a, y0) => { rot(x, z, a); mb.mat(15).color(0.3, 0.3, 0.3, 1); mb.box(0, y0 + 0.7, 0, 0.1, 1.4, 0.1); mb.color(0.95, 0.45, 0.05, 1); mb.box(0, y0 + 1.1, 0.08, 0.7, 0.7, 0.06); mb.pop(); };
  // a straight wall, fence, hedge or railing from (ax, az) to (bx, bz), on the ground
  const boundary = (ax, az, bx, bz, code, hgt, matl, look) => {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.3) return; const tx = (bx - ax) / L, tz = (bz - az) / L, a = Math.atan2(tz, tx);
    const dg = Math.abs(hfAt(ax, az) - hfAt(bx, bz)), m = Math.max(1, Math.ceil(L / (dg < 0.25 ? 9 : 3)));
    for (let q = 0; q < m; q++) {
      const f0 = q / m, f1 = (q + 1) / m, x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0, x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1, l = L / m;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, y = Math.min(hfAt(x0, z0), hfAt(x1, z1), hfAt(mx, mz));
      if ((code === 1 || code === 4) && look === 0) {   // grey limestone: coursed rubble faces (the wall shader), a coping
        const hv = hash2(Math.round(mx * 3), Math.round(mz * 3)), h = hgt || (code === 4 ? 1.2 : 1.5), nx = -tz, nz = tx, t2 = 0.16, yb = y - 0.25, yt = y + h;
        const u0 = ((x0 * tx + z0 * tz) % 200 + 200) % 200 + 20, kewOld = Math.hypot(mx - 1778, mz + 1891) < 420;   // (the old village: stones on edge)
        mb.mat(10, 9, (2 << 6) | 30, 255).color(0.3 + hv * 0.05, 0.295 + hv * 0.05, 0.27 + hv * 0.04, hv).weight(Math.min(1, (h + 0.25) / 64));
        for (const sd of [1, -1]) {
          const ox = nx * sd * t2, oz = nz * sd * t2;
          const A = mb.v(x0 + ox, yb, z0 + oz, nx * sd, 0, nz * sd, u0, 0), B = mb.v(x1 + ox, yb, z1 + oz, nx * sd, 0, nz * sd, u0 + l, 0);
          const C = mb.v(x1 + ox, yt, z1 + oz, nx * sd, 0, nz * sd, u0 + l, h + 0.25), D = mb.v(x0 + ox, yt, z0 + oz, nx * sd, 0, nz * sd, u0, h + 0.25);
          townQuad(mb, A, B, C, D, nx * sd, 0, nz * sd);
        }
        mb.weight(0);
        rot(mx, mz, a); mb.mat(15).color(0.27 + hv * 0.04, 0.265 + hv * 0.04, 0.24 + hv * 0.03, 1);
        if (kewOld && code === 1) {   // cock-and-hen: rough stones set on edge along the top, tall and short in turn
          const ns = Math.max(1, Math.round(l / 0.26)), p = l / ns;
          mb.box(0, yt + 0.02, 0, l + 0.02, 0.05, 0.36);
          for (let e = 0; e < ns; e++) { const hs = (e & 1 ? 0.17 : 0.27) + hash2(Math.round(mx * 7) + e, 3) * 0.06; mb.box(-l / 2 + (e + 0.5) * p, yt + 0.04 + hs / 2, 0, p * 0.62, hs, 0.33 + hash2(e, Math.round(mz)) * 0.05); }
        } else { mb.box(0, yt + 0.05, 0, l + 0.03, 0.1, 0.38); }
        mb.pop(); continue;
      }
      rot(mx, mz, a);
      if (code === 1 || code === 4) {          // wall: grey limestone rubble, red brick or render, with a coping
        const hv = hash2(Math.round(mx * 3), Math.round(mz * 3)) * 0.06, h = hgt || (code === 4 ? 1.2 : 1.5), c = look === 2 ? [0.3 + hv, 0.13 + hv * 0.4, 0.085] : look === 3 ? [0.46, 0.44, 0.39] : [0.22 + hv, 0.215 + hv, 0.19 + hv * 0.8];   // (weathered limestone, red brick, render)
        mb.mat(15).color(c[0], c[1], c[2], 1); mb.box(0, y + h / 2 - 0.1, 0, l + 0.02, h + 0.2, 0.32); mb.color(c[0] * 1.1, c[1] * 1.1, c[2] * 1.1, 1); mb.box(0, y + h + 0.03, 0, l + 0.04, 0.08, 0.38);
      } else if (code === 2) {                  // fence: close-boarded timber panels (or a chain-link look: metal)
        const h = hgt || 1.6;
        if (matl === 4) { mb.mat(13, 150).color(0.4, 0.42, 0.42, 1); mb.box(0, y + h / 2, 0, l, h, 0.02); }
        else { mb.mat(15).color(0.34, 0.26, 0.17, 1); mb.box(0, y + h / 2, 0, l, h, 0.05); mb.color(0.28, 0.21, 0.14, 1); mb.box(-l / 2, y + h / 2 + 0.05, 0, 0.1, h + 0.1, 0.1); }
      } else if (code === 3) {                  // hedge: a clipped green box with a ragged top (without the British planting kit)
        if (typeof ukBoundaryHedges === 'function' && typeof VEG_UK !== 'undefined' && VEG_UK && !Q.has('noveg')) { mb.pop(); continue; }
        const h = hgt || 1.5 + rnd() * 0.5; mb.mat(15).color(0.06 + rnd() * 0.03, 0.12 + rnd() * 0.04, 0.035, 1); mb.box(0, y + h / 2, 0, l + 0.2, h, 0.8 + rnd() * 0.3);
      } else if (code === 5 || code === 6) {    // railings (posts, two rails, bars) or a crash barrier
        const h = code === 6 ? 0.75 : (hgt || 1.05);
        mb.mat(13, 100).color(code === 6 ? 0.45 : 0.07, code === 6 ? 0.46 : 0.12, code === 6 ? 0.47 : 0.1, 1);
        mb.box(-l / 2, y + h / 2, 0, 0.06, h, 0.06); mb.box(0, y + h - 0.03, 0, l, 0.05, 0.05); mb.box(0, y + 0.15, 0, l, 0.04, 0.04);
        if (code === 5) for (let e = 0; e < Math.floor(l / 0.13); e++) mb.box(-l / 2 + (e + 0.5) * 0.13, y + h / 2, 0, 0.02, h - 0.1, 0.02);
      }
      mb.pop();
    }
  };
  // ---- OSM furniture
  const F = T.furn, lampsAt = [];
  let nf = 0;
  if (F) for (let i = 0; i < F.n; i++) {
    const x = F.xz[i * 2] * 0.01, z = F.xz[i * 2 + 1] * 0.01, c = F.c[i * 2], sub = F.c[i * 2 + 1], zc = zoneAt(x, z); if (zc === TZ.BLD || zc === TZ.OUT) continue;
    const on = nearRoad(x, z, 25); let a = on ? Math.atan2(NR[1], NR[0]) : 0;
    let px = x, pz = z;
    // (a point mapped on the carriageway itself is moved to the kerb: bus stops, signals, signs stand on the pavement)
    const toKerb = (extra) => { if (on && NR[2] < NR[5] + 0.4) { const sd = NR[3] || 1; px = x + (-NR[1]) * sd * (NR[5] + extra - NR[2]) * 1; pz = z + NR[0] * sd * (NR[5] + extra - NR[2]); } };
    const face = () => on ? Math.atan2(NR[1], NR[0]) + (NR[3] > 0 ? PI : 0) : 0;   // (turned towards the road)
    const J = (f, d) => townJob(px, pz, f, d || 300), fa = face(), gp = gy(px, pz), fy = on ? faceYaw() : 0;
    if (c === FN.LAMP) { toKerb(0.6); const X = px, Zz = pz, A = face() + PI / 2, Y = gy(px, pz); put('lamp_modern', X, Y, Zz, fy, () => lampModern(X, Zz, A, Y), 450); lampsAt.push(px, pz); }
    else if (c === FN.BENCH) { const sea = px < 230 && pz > -1000 && pz < 2700 && zoneAt(px - 12, pz) === TZ.SAND; put('bench', px, gp, pz, sea ? PI : fy, () => bench(px, pz, sea ? PI / 2 : fa, gp, sea)); }
    else if (c === FN.BIN) put('bin', px, gp, pz, fy, () => bin(px, pz, gp), 200);
    else if (c === FN.BOLLARD) put('bollard', px, gp, pz, fy, () => bollard(px, pz, gp), 200);
    else if (c === FN.BUS) { toKerb(0.5); const X = px, Zz = pz, A = face(), Y = gy(px, pz), sh = sub & 1, kd = sh && townProp('bus_shelter') >= 0 ? 'bus_shelter' : 'bus_stop'; put(kd, X, Y, Zz, fy, () => busStop(X, Zz, A, Y, sh), 350); }
    else if (c === FN.POST) { toKerb(0.6); const X = px, Zz = pz, Y = gy(px, pz); put('post_box', X, Y, Zz, fy, () => postBox(X, Zz, Y), 250); }
    else if (c === FN.PHONE) { toKerb(0.9); const X = px, Zz = pz, A = face(), Y = gy(px, pz); put('phone', X, Y, Zz, fy, () => phoneBox(X, Zz, A, Y), 300); }
    else if (c === FN.GUIDE || c === FN.INFO) { toKerb(0.6); const X = px, Zz = pz, Y = gy(px, pz); put('signpost', X, Y, Zz, fy, () => guidepost(X, Zz, a, Y), 250); }
    else if (c === FN.CYCLES) J(() => cycles(px, pz, a, gp), 200);
    else if (c === FN.MEMORIAL) J(() => memorial(px, pz, gp), 500);
    else if (c === FN.CABINET) { toKerb(0.5); const X = px, Zz = pz, A = face(), Y = gy(px, pz); townJob(X, Zz, () => cabinet(X, Zz, A, Y), 200); }
    else if (c === FN.RING) J(() => lifeRing(px, pz, a, gp), 200);
    else if (c === FN.GATE) { const Y = hfAt(px, pz); J(() => fieldGate(px, pz, a + PI / 2, Y, 3.4)); }
    else if ((c === FN.SIGNALS || c === FN.CROSSING || c === FN.GIVEWAY || c === FN.STOP) && on) {
      // on the road: a pole on each kerb, facing the traffic (signals, crossings), the give-way or stop sign on the near side
      const tx = NR[0], tz = NR[1], hw = NR[5], nx = -tz, nz = tx;
      // (each approach: the primary signal on the drivers' left at the stop line, its head (+X) facing them)
      if (c === FN.SIGNALS || (c === FN.CROSSING && sub === 2)) for (const sg of NR[6] ? [1] : [1, -1]) { const qx = x - sg * tx * 3.2 - sg * nx * (hw + 0.6), qz = z - sg * tz * 3.2 - sg * nz * (hw + 0.6), A = Math.atan2(-sg * tz, -sg * tx), Y = gy(qx, qz); put('signal', qx, Y, qz, A, () => signalHead(qx, qz, A - PI / 2, Y, 3.2), 400); }
      else if (c === FN.CROSSING && sub === 1) for (const sd of [-1, 1]) { const qx = x + nx * sd * (hw + 0.5), qz = z + nz * sd * (hw + 0.5), Y = gy(qx, qz); put('belisha', qx, Y, qz, Math.atan2(-nz * sd, -nx * sd), () => belisha(qx, qz, Y), 350); }
      else if (c === FN.GIVEWAY || c === FN.STOP) { const qx = x - nx * (hw + 0.7), qz = z - nz * (hw + 0.7), A = a + PI / 2, Y = gy(qx, qz); townJob(qx, qz, () => signPost(qx, qz, A, Y, c), 300); }
    }
    nf++;
  }
  // ---- boundaries: OSM's walls, fences and hedges, the front-garden walls and the village lanes' walls and hedges
  // (townBoundaries, 13_wsm_town.js: the same segments stop the cars)
  const BS = T.bsegs || []; let nb = BS.length / 7;
  for (let q = 0; q < BS.length; q += 7) {
    const mx = (BS[q] + BS[q + 2]) / 2, mz = (BS[q + 1] + BS[q + 3]) / 2; if (zoneAt(mx, mz) === TZ.ROAD || zoneAt(BS[q], BS[q + 1]) === TZ.ROAD || zoneAt(BS[q + 2], BS[q + 3]) === TZ.ROAD) continue;   // (never across a carriageway)
    const q0 = q; townJob(mx, mz, () => boundary(BS[q0], BS[q0 + 1], BS[q0 + 2], BS[q0 + 3], BS[q0 + 4], BS[q0 + 5], 0, BS[q0 + 6]), 320);
  }
  // ---- default street lamps: every 34 m along the lit streets of the towns (one side, both on main roads), at the back of
  // the kerb; none near a mapped lamp, none on the Toll Road and country lanes far from houses
  const lampNear = (x, z) => { for (let q = 0; q < lampsAt.length; q += 2) if (Math.abs(lampsAt[q] - x) < 14 && Math.abs(lampsAt[q + 1] - z) < 14) return true; return false; };
  const builtUp = (x, z) => { const gi = ((x - T.x0) / T.bcell) | 0, gj = ((z - T.z0) / T.bcell) | 0; let c = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = gi + di, j = gj + dj; if (i < 0 || j < 0 || i >= T.bgw || j >= T.bgh) continue; c += T.bstart[j * T.bgw + i + 1] - T.bstart[j * T.bgw + i]; } return c >= 3; };
  let nl = 0;
  const seafront = (x, z) => x < 260 && x > -320 && z > -900 && z < 2900;
  for (let r = 0; r < R.n; r++) {
    const cls = ri[r * 4], fl = ri[r * 4 + 2]; if (cls > 7 || (fl & 129)) continue;
    const hw = ri[r * 4 + 1] * 0.05, pave = (fl & 32) ? 0 : ROAD_PAVE[cls], both = cls <= 4 && hw >= 3.4;
    let acc = 17, side = 1;
    for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      for (; acc < L; acc += 34) {
        const cx = ax + tx * acc, cz = az + tz * acc; if (!builtUp(cx, cz)) continue;
        for (const sd of both ? [-1, 1] : [side]) {
          const o = hw + (pave ? Math.min(pave - 0.35, 0.6) : 0.9), x = cx + nx * sd * o, z = cz + nz * sd * o, zc = zoneAt(x, z);
          if (zc === TZ.ROAD || zc === TZ.BLD || zc === TZ.WATER || zc === TZ.OUT || lampNear(x, z)) continue;
          if (seafront(x, z)) continue;          // (the promenade has its own)
          const A = Math.atan2(tz, tx) + (sd > 0 ? -PI / 2 : PI / 2), Y = gy(x, z); put('lamp_modern', x, Y, z, Math.atan2(-nz * sd, -nx * sd), () => lampModern(x, z, A, Y), 450); lampsAt.push(x, z); nl++;
        }
        side = -side;
      }
      acc -= L;
    }
  }
  // ---- Sand Bay: the timber posts along the dune side of Beach Road and the lanes behind the dunes, every 1.8 m (they
  // keep the cars off the dunes), with a gap where a path goes through
  let npo = 0;
  for (let r = 0; r < R.n; r++) {
    const cls = ri[r * 4], fl = ri[r * 4 + 2]; if (cls < 4 || cls > 8 || (fl & 128)) continue;
    const hw = ri[r * 4 + 1] * 0.05; let acc = 0;
    for (let k = R.off[r]; k < R.off[r + 1] - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      if (Math.max(az, bz) > -2300) { acc = (acc + L) % 1.8; continue; }
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      for (let e = 1.8 - acc; e < L; e += 1.8) for (const sd of [-1, 1]) {
        const cx = ax + tx * e, cz = az + tz * e, x = cx + nx * sd * (hw + 0.8), z = cz + nz * sd * (hw + 0.8), zo = zoneAt(cx + nx * sd * (hw + 3), cz + nz * sd * (hw + 3)), zc = zoneAt(x, z);
        if ((zo !== TZ.DUNE && zo !== TZ.SAND) || zc === TZ.ROAD || zc === TZ.PAVE || zc === TZ.BLD || zc === TZ.PATH || zc === TZ.WATER) continue;
        const Y = hfAt(x, z), hh = hash2(Math.round(x * 5), Math.round(z * 5));
        townJob(x, z, () => { mb.mat(15).color(0.2 + hh * 0.06, 0.17 + hh * 0.05, 0.13 + hh * 0.03, 1); mb.box(x, Y + 0.3, z, 0.15, 1.2, 0.15); }, 250); npo++;
        if (npo % 26 === 13) {   // (a bench now and then behind the posts, looking out over the dunes to the sea)
          const bx = cx + nx * sd * (hw + 2.3), bz = cz + nz * sd * (hw + 2.3), zb = zoneAt(bx, bz);
          if (zb !== TZ.ROAD && zb !== TZ.BLD && zb !== TZ.WATER) { const by = hfAt(bx, bz), a2 = Math.atan2(tz, tx) + (sd > 0 ? PI : 0); put('bench', bx, by, bz, Math.atan2(nz * sd, nx * sd), () => bench(bx, bz, a2, by, true)); }
        }
      }
      acc = (acc + L) % 1.8;
    }
  }
  // ---- telegraph poles along the country lanes round Kewstoke and Sand Bay: creosoted poles every 45 m on one side,
  // a cross-arm with insulators, two sagging wires from pole to pole
  let ntp = 0;
  for (let r = 0; r < R.n; r++) {
    const cls = ri[r * 4], fl = ri[r * 4 + 2]; if (cls < 4 || cls > 8 || (fl & 129)) continue;
    const k0 = R.off[r], k1 = R.off[r + 1], mx0 = R.p[((k0 + k1) >> 1) * 2], mz0 = R.p[((k0 + k1) >> 1) * 2 + 1]; if (!(mx0 > 1300 && mz0 < -1450)) continue;
    const hw = ri[r * 4 + 1] * 0.05, sd = hash2(r, 91) < 0.5 ? -1 : 1, poles = []; let acc = 20;
    for (let k = k0; k < k1 - 1; k++) {
      const ax = R.p[k * 2], az = R.p[k * 2 + 1], bx = R.p[k * 2 + 2], bz = R.p[k * 2 + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      for (; acc < L; acc += 45) {
        const x = ax + tx * acc + nx * sd * (hw + 1.1), z = az + tz * acc + nz * sd * (hw + 1.1), zc = zoneAt(x, z);
        if (zc === TZ.ROAD || zc === TZ.PAVE || zc === TZ.BLD || zc === TZ.WATER || zc === TZ.PATH || zc === TZ.OUT || townBuildingQ(x, z)) { poles.push(null); continue; }
        poles.push([x, hfAt(x, z), z, Math.atan2(tz, tx)]);
      }
      acc -= L;
    }
    for (let i = 0; i < poles.length; i++) {
      const p = poles[i]; if (!p) continue; const q = i + 1 < poles.length ? poles[i + 1] : null; ntp++;
      townJob(p[0], p[2], () => {
        const [x, y, z, a] = p, ca = Math.cos(a), sa = Math.sin(a), top = y + 7.6;
        mb.mat(15).color(0.15, 0.115, 0.085, 1); mb.cyl(x, y - 0.3, z, 0.13, top + 0.3, 0.1, 6, false, true);
        rot(x, z, a + PI / 2); mb.box(0, top, 0, 1.3, 0.1, 0.1); mb.color(0.62, 0.6, 0.55, 1); mb.box(-0.5, top + 0.1, 0, 0.06, 0.12, 0.06); mb.box(0.5, top + 0.1, 0, 0.06, 0.12, 0.06); mb.pop();
        if (!q) return;
        const L = Math.hypot(q[0] - x, q[2] - z); if (L > 70 || L < 5) return;
        mb.mat(13, 60).color(0.04, 0.04, 0.04, 1);
        for (const o of [-0.5, 0.5]) {   // (the wires: two straight spans to a midpoint 0.5 m lower)
          const ox = -sa * o, oz = ca * o, qx = q[0] - Math.sin(q[3]) * o, qz = q[2] + Math.cos(q[3]) * o, y0 = top + 0.16, y1 = q[1] + 7.76, mxx = (x + ox + qx) / 2, mzz = (z + oz + qz) / 2, my = (y0 + y1) / 2 - 0.5;
          for (const [px, py, pz, ex, ey, ez] of [[x + ox, y0, z + oz, mxx, my, mzz], [mxx, my, mzz, qx, y1, qz]]) {
            const dx = ex - px, dy = ey - py, dz = ez - pz, h = Math.hypot(dx, dz) || 1e-3, l = Math.hypot(h, dy);
            mb.push(m4mul(m4(), m4mul(m4(), m4translate(m4(), (px + ex) / 2, (py + ey) / 2, (pz + ez) / 2), m4rotY(m4(), -Math.atan2(dz, dx))), m4rotZ(m4(), Math.atan2(dy, h))));
            mb.box(0, 0, 0, l, 0.022, 0.022); mb.pop();
          }
        }
      }, 450);
    }
  }
  // ---- the seafront: ornate lamps every 26 m and railings along the promenade's edge above the sea wall
  const SW = T.walls; let ns = 0;
  for (let i = 0; i < SW.length; i += 6) {
    const ax = SW[i], az = SW[i + 1], bx = SW[i + 2], bz = SW[i + 3], top = SW[i + 5], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -tz, nz = tx; if (hfAt(mx + nx * 4, mz + nz * 4) > hfAt(mx - nx * 4, mz - nz * 4)) { nx = -nx; nz = -nz; }   // n: towards the beach
    if (!seafront(mx, mz)) continue;
    const pr = Math.floor((ax * tx + az * tz) / 26), pr2 = Math.floor((bx * tx + bz * tz) / 26);
    if (pr !== pr2) { const x = mx - nx * 1.4, z = mz - nz * 1.4, zc = zoneAt(x, z); if (zc !== TZ.ROAD && zc !== TZ.BLD && !lampNear(x, z)) { const A = Math.atan2(tz, tx), Y = hfAt(x, z) + TZH[zc]; put('lamp_victorian', x, Y, z, Math.atan2(-nz, -nx), () => lampVictorian(x, z, A, Y), 500); lampsAt.push(x, z); ns++; } }
    if (townProp('railing') >= 0) {   // (the Blender railing sections, end to end along the coping, facing the promenade)
      const ri_ = townProp('railing'), sz = (WSM_PROPS[ri_].meta.prop && WSM_PROPS[ri_].meta.prop.size) || [0.2, 1.1, 2.5], seg = Math.max(0.5, sz[2] || 2.5), m = Math.max(1, Math.round(L / seg));
      for (let e = 0; e < m; e++) { const f = (e + 0.5) / m, x = ax + (bx - ax) * f - nx * 0.25, z = az + (bz - az) * f - nz * 0.25; townPropPut(ri_, x, top, z, Math.atan2(-nz, -nx)); }
      continue;
    }
    // railings on the coping (painted the seafront's green)
    townJob(mx, mz, () => { rot(mx, mz, Math.atan2(tz, tx)); const ox = -0.25;
      mb.mat(13, 100).color(0.07, 0.2, 0.17, 1); mb.box(0, top + 0.95, ox, L, 0.05, 0.05); mb.box(0, top + 0.5, ox, L, 0.04, 0.04); mb.box(-L / 2, top + 0.5, ox, 0.06, 1.0, 0.06);
      mb.pop(); }, 350);
  }
  if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 160); }
  TOWNW.stats.furniture = { osm: nf, boundarySegments: nb, lamps: nl, seafrontLamps: ns, gardenWalls: T.nGardenWalls || 0, laneWalls: T.nLaneWalls || 0, dunePosts: npo, telegraphPoles: ntp };
}

// ---------------------------------------------------------------- road markings laid on the carriageways
// Zebra crossings (stripes along the road, zigzags on both kerbs), stop lines before the traffic signals and signal
// crossings, give-way lines where a lesser road meets a more important one (double dashes across its left half), and
// tactile paving (red at the controlled crossings, buff at the others) on the pavements at every crossing.
function townMarkingsBuild(mb, rs) {
  const T = TOWN, R = T.rd, ri = T.rinfo, F = T.furn, i0 = mb.ni, lift = 0.075;
  const zoneAt = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= T.zw || j >= T.zh ? TZ.OUT : T.zone[j * T.zw + i]; };
  // a flat quad on the road surface: centre (cx, cz), axis (tx, tz), half sizes along and across
  const decal = (cx, cz, tx, tz, hl, hc, y) => {
    const nx = -tz, nz = tx, P = [[-hl, -hc], [hl, -hc], [hl, hc], [-hl, hc]].map(([a, c]) => { const x = cx + tx * a + nx * c, z = cz + tz * a + nz * c; return mb.v(x, (y === undefined ? hfAt(x, z) + TZH[TZ.ROAD] : y) + lift - 0.06, z, 0, 1, 0, 0, 0); });
    townQuad(mb, P[0], P[1], P[2], P[3], 0, 1, 0);
  };
  const white = () => mb.mat(15).color(0.66, 0.66, 0.63, 1);
  // nearest drivable road segment
  const NR = new Float64Array(5);
  const near = (x, z) => { let best = 12; NR[2] = 1e9; for (let r = 0; r < R.n; r++) { if (ri[r * 4] > 8) continue; const k0 = R.off[r], k1 = R.off[r + 1]; for (let k = k0; k < k1 - 1; k++) { const ax = R.p[k * 2], az = R.p[k * 2 + 1]; if (Math.abs(ax - x) > 80 || Math.abs(az - z) > 80) continue; const ex = R.p[k * 2 + 2] - ax, ez = R.p[k * 2 + 3] - az, L2 = ex * ex + ez * ez + 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), d = Math.hypot(ax + ex * t - x, az + ez * t - z); if (d < best) { best = d; const L = Math.sqrt(L2); NR[0] = ex / L; NR[1] = ez / L; NR[2] = d; NR[3] = ri[r * 4 + 1] * 0.05; NR[4] = r; } } } return NR[2] < 12; };
  let nz = 0, ns = 0, ng = 0;
  if (F) for (let i = 0; i < F.n; i++) {
    const c = F.c[i * 2], sub = F.c[i * 2 + 1]; if (c !== FN.CROSSING && c !== FN.SIGNALS) continue;
    const x = F.xz[i * 2] * 0.01, z = F.xz[i * 2 + 1] * 0.01; if (!near(x, z)) continue;
    const tx = NR[0], tz = NR[1], hw = NR[3], nx = -tz, nzz = tx, oneway = (ri[NR[4] * 4 + 2] & 2) !== 0;
    if (c === FN.CROSSING && sub === 1) {         // zebra
      white(); const m = Math.max(3, Math.floor(hw * 2 / 1.0));
      for (let q = 0; q < m; q++) { const o = -hw + 0.5 + q * (hw * 2 - 1) / Math.max(1, m - 1); decal(x + nx * o, z + nzz * o, tx, tz, 1.3, 0.25); }
      for (const sg of [-1, 1]) for (const sd of [-1, 1]) for (let q = 0; q < 8; q++) {   // zigzags along both kerbs, both sides of the crossing
        const a = sg * (2.2 + q * 1.0), b = sg * (2.2 + (q + 1) * 1.0), oa = sd * (hw - 0.35 - (q & 1) * 0.35), ob = sd * (hw - 0.35 - ((q + 1) & 1) * 0.35);
        const ax = x + tx * a + nx * oa, az = z + tz * a + nzz * oa, bx = x + tx * b + nx * ob, bz = z + tz * b + nzz * ob, L = Math.hypot(bx - ax, bz - az);
        decal((ax + bx) / 2, (az + bz) / 2, (bx - ax) / L, (bz - az) / L, L / 2 + 0.05, 0.05);
      }
      nz++;
    }
    if (c === FN.SIGNALS || (c === FN.CROSSING && sub === 2)) {   // stop lines on the approaches (the left half; all of it on a one-way road)
      white();
      for (const sg of oneway ? [1] : [-1, 1]) { const a = -sg * 3.0, c0 = oneway ? 0 : -sg * hw / 2; decal(x + tx * a + nx * c0, z + tz * a + nzz * c0, tx, tz, 0.15, oneway ? hw - 0.2 : hw / 2 - 0.1); }
      ns++;
    }
    if (c === FN.CROSSING) {                      // tactile paving on both pavements, at the kerb
      const red = sub === 1 || sub === 2; mb.mat(15).color(red ? 0.42 : 0.62, red ? 0.12 : 0.55, red ? 0.08 : 0.38, 1);
      for (const sd of [-1, 1]) { const o = sd * (hw + 0.65), px = x + nx * o, pz = z + nzz * o; if (zoneAt(px, pz) !== TZ.PAVE) continue; decal(px, pz, tx, tz, 1.2, 0.6, hfAt(px, pz) + TZH[TZ.PAVE] + 0.005); }
    }
  }
  // give-way lines at the junctions (from townRoadSurface)
  const J = T.junc || []; white();
  for (let e = 0; e < J.length; e += 3) {
    const r = J[e], end = J[e + 1], hwMaj = J[e + 2], P = T.rprof[r]; if (!P) continue;
    const m = P.x.length, qe = end ? m - 1 : 0, qi = end ? Math.max(0, m - 3) : Math.min(m - 1, 2);
    let tx = P.x[qe] - P.x[qi], tz = P.z[qe] - P.z[qi]; const L = Math.hypot(tx, tz); if (L < 0.5) continue; tx /= L; tz /= L;   // (towards the junction)
    const hw = ri[r * 4 + 1] * 0.05, oneway = (ri[r * 4 + 2] & 2) !== 0, nx = -tz, nzz = tx, d = hwMaj + 0.6;
    const cx = P.x[qe] - tx * d, cz = P.z[qe] - tz * d; if (zoneAt(cx, cz) !== TZ.ROAD) continue;
    // (UK: the approach lane is on the left of the direction of travel: -normal)
    const c0 = oneway ? 0 : -hw / 2, half = oneway ? hw - 0.25 : hw / 2 - 0.15, nd = Math.max(1, Math.floor(half * 2 / 0.9));
    for (const off of [0, 0.45]) for (let q = 0; q < nd; q++) { const o = c0 - half + (q + 0.5) * half * 2 / nd, px = cx + nx * o - tx * off, pz = cz + nzz * o - tz * off; decal(px, pz, nx, nzz, 0.3, 0.1); }
    ng++;
  }
  if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 1); rs.addRange(mb, i0, mb.ni, 4, 120); }
  TOWNW.stats.markings = { zebras: nz, stopLines: ns, giveWay: ng };
}

// ---------------------------------------------------------------- grounds: pitches and allotments
// Line markings on the playing fields (OSM leisure=pitch): a football pitch's lines and goals on the big ones, an outline
// and a centre line on the small courts; allotments as rows of dug beds and crops between grass paths, with sheds.
function townGroundsBuild(mb, rs) {
  const T = TOWN, A = T.ad, ai = T.ainfo; if (!A || !ai) return;
  const inRing = (k0, k1, x, z) => { let ins = false; for (let i = k0, j = k1 - 1; i < k1; j = i++) { const zi = A.p[i * 2 + 1], zj = A.p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (A.p[j * 2] - A.p[i * 2]) * (z - zi) / (zj - zi) + A.p[i * 2]) ins = !ins; } return ins; };
  const quad = (cx, cz, tx, tz, hl, hc, lift) => { const nx = -tz, nz = tx, P = [[-hl, -hc], [hl, -hc], [hl, hc], [-hl, hc]].map(([a, c]) => { const x = cx + tx * a + nx * c, z = cz + tz * a + nz * c; return mb.v(x, hfAt(x, z) + lift, z, 0, 1, 0, 0, 0); }); townQuad(mb, P[0], P[1], P[2], P[3], 0, 1, 0); };
  let r = 0, np = 0, na = 0, ng = 0;
  // churchyards and cemeteries (St Paul's at Kewstoke, St John's, Uphill, Worle, the town cemetery): rows of graves running
  // north and south, each headstone at the west end of its grave: weathered limestone, slate and granite slabs leaning a
  // little, crosses, kerbed graves with their chippings, Georgian chest tombs; none on the paths or against the church
  const zoneAt = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= T.zw || j >= T.zh ? TZ.OUT : T.zone[j * T.zw + i]; };
  const turf = (x, z) => { const c = zoneAt(x, z); return c === TZ.GRASS || c === TZ.NONE || c === TZ.GARDEN; };
  const M1 = m4(), M2 = m4(), M3 = m4(), M4 = m4();
  const STONE = [[0.4, 0.39, 0.36], [0.45, 0.43, 0.38], [0.33, 0.33, 0.32], [0.16, 0.17, 0.18], [0.29, 0.28, 0.28], [0.5, 0.49, 0.46]];
  const cemetery = (k0, k1) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, ar = 0;
    for (let i = k0, j = k1 - 1; i < k1; j = i++) { x0 = Math.min(x0, A.p[i * 2]); x1 = Math.max(x1, A.p[i * 2]); z0 = Math.min(z0, A.p[i * 2 + 1]); z1 = Math.max(z1, A.p[i * 2 + 1]); ar += A.p[j * 2] * A.p[i * 2 + 1] - A.p[i * 2] * A.p[j * 2 + 1]; }
    const keep = Math.min(1, 1500 / (Math.abs(ar) / 2 * 0.25 + 1));   // (the big town cemetery: its lawns sparser)
    for (let gx = Math.floor(x0 / 32) * 32; gx < x1; gx += 32) for (let gz = Math.floor(z0 / 32) * 32; gz < z1; gz += 32) {
      townJob(gx + 16, gz + 16, () => {
        for (let x = Math.max(gx, x0 + 0.8); x < Math.min(gx + 32, x1 - 1); x += 2.6) for (let z = Math.max(gz, z0 + 0.6); z < Math.min(gz + 32, z1 - 0.5); z += 1.35) {
          const h = hash2(Math.round(x * 10), Math.round(z * 10)); if (h > 0.8 * keep) continue;                   // (the gaps)
          const px = x + (hash2(Math.round(z * 7), 5) - 0.5) * 0.35, pz = z + (hash2(Math.round(x * 3), 11) - 0.5) * 0.2;
          if (!inRing(k0, k1, px, pz) || !inRing(k0, k1, px + 2, pz)) continue;
          if (!turf(px, pz) || !turf(px + 1.1, pz) || !turf(px + 2.1, pz) || !turf(px, pz - 0.6) || !turf(px, pz + 0.6) || !turf(px - 0.7, pz)) continue;
          const t = hash2(Math.round(px * 13), Math.round(pz * 3)), u = hash2(Math.round(pz * 17), Math.round(px * 5)), y = Math.min(hfAt(px, pz - 0.3), hfAt(px, pz + 0.3)) - 0.06;
          const col = STONE[Math.floor(u * STONE.length) % STONE.length], k = 0.82 + 0.3 * t;
          mb.push(m4mul(M4, m4mul(M3, m4translate(M1, px, y, pz), m4rotY(M2, (t - 0.5) * 0.12)), m4rotZ(m4(), (u - 0.5) * 0.2 * (u > 0.3 ? 1 : 0.2))));
          mb.mat(15).color(col[0] * k, col[1] * k, col[2] * k, 1);
          if (t < 0.12) {                                     // a chest tomb
            mb.box(1.1, 0.42, 0, 1.9, 0.84, 0.86); mb.color(col[0] * k * 1.1, col[1] * k * 1.1, col[2] * k * 1.1, 1); mb.box(1.1, 0.88, 0, 2.02, 0.09, 0.98);
          } else if (t < 0.24) {                              // a cross on a stepped base
            mb.box(0, 0.12, 0, 0.42, 0.24, 0.55); mb.box(0, 0.8, 0, 0.11, 1.12, 0.11); mb.box(0, 1.05, 0, 0.11, 0.11, 0.6);
          } else {                                            // a slab with a shouldered top
            const w = 0.48 + 0.34 * u, hg = 0.55 + 0.5 * t, th = 0.08 + 0.05 * u;
            mb.box(0, hg / 2, 0, th, hg, w); mb.box(0, hg + 0.05, 0, th, 0.1, w * 0.62);
            if (t > 0.7) {                                    // kerbed, with its chippings
              mb.box(1.1, 0.07, -0.42, 1.9, 0.14, 0.1); mb.box(1.1, 0.07, 0.42, 1.9, 0.14, 0.1); mb.box(2.05, 0.07, 0, 0.1, 0.14, 0.94);
              mb.color(0.5, 0.5, 0.48, 1); mb.box(1.1, 0.05, 0, 1.8, 0.1, 0.74);
            }
          }
          mb.pop(); ng++;
        }
      }, 300);
    }
  };
  for (let q = 0; q < ai.length / 2; q++) {
    const c = ai[q * 2], nr = ai[q * 2 + 1], k0 = A.off[r], k1 = A.off[r + 1]; r += nr;
    if (c === 12) { cemetery(k0, k1); continue; }
    if (c !== 13 && c !== 15) continue;
    // the polygon's axes (principal directions of its vertices) and extents
    let mx = 0, mz = 0; const n = k1 - k0; for (let k = k0; k < k1; k++) { mx += A.p[k * 2] / n; mz += A.p[k * 2 + 1] / n; }
    let sxx = 0, szz = 0, sxz = 0; for (let k = k0; k < k1; k++) { const dx = A.p[k * 2] - mx, dz = A.p[k * 2 + 1] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), tx = Math.cos(ang), tz = Math.sin(ang), nx = -tz, nz = tx;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (let k = k0; k < k1; k++) { const dx = A.p[k * 2] - mx, dz = A.p[k * 2 + 1] - mz, u = dx * tx + dz * tz, v = dx * nx + dz * nz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const cx = mx + tx * (u0 + u1) / 2 + nx * (v0 + v1) / 2, cz = mz + tz * (u0 + u1) / 2 + nz * (v0 + v1) / 2, L = (u1 - u0) - 2, Wd = (v1 - v0) - 2;
    if (L < 12 || Wd < 6) continue;
    const at = (u, v) => [cx + tx * u + nx * v, cz + tz * u + nz * v];
    if (c === 13) {
      townJob(cx, cz, () => {
        mb.mat(15).color(0.7, 0.72, 0.68, 1);
        const line = (ua, va, ub, vb) => { const [ax, az] = at(ua, va), [bx, bz] = at(ub, vb), l = Math.hypot(bx - ax, bz - az); if (l < 0.05) return; quad((ax + bx) / 2, (az + bz) / 2, (bx - ax) / l, (bz - az) / l, l / 2, 0.06, 0.03); };
        const hl = L / 2, hw = Wd / 2;
        line(-hl, -hw, hl, -hw); line(-hl, hw, hl, hw); line(-hl, -hw, -hl, hw); line(hl, -hw, hl, hw); line(0, -hw, 0, hw);
        if (L > 50 && Wd > 30) {                 // a football pitch: centre circle, penalty and goal areas, goals
          const sc = Math.min(1, Wd / 68), rc = 9.15 * sc;
          for (let e = 0; e < 24; e++) { const a0 = e / 24 * TAU, a1 = (e + 1) / 24 * TAU; line(Math.cos(a0) * rc, Math.sin(a0) * rc, Math.cos(a1) * rc, Math.sin(a1) * rc); }
          for (const sg of [-1, 1]) {
            const pd = 16.5 * sc, pw = Math.min(hw - 1, 20.15 * sc), gd = 5.5 * sc, gw = 9.15 * sc;
            line(sg * hl, -pw, sg * (hl - pd), -pw); line(sg * hl, pw, sg * (hl - pd), pw); line(sg * (hl - pd), -pw, sg * (hl - pd), pw);
            line(sg * hl, -gw, sg * (hl - gd), -gw); line(sg * hl, gw, sg * (hl - gd), gw); line(sg * (hl - gd), -gw, sg * (hl - gd), gw);
            const gwid = 3.66 * Math.min(1, sc * 1.2), [g1x, g1z] = at(sg * (hl + 0.1), -gwid), [g2x, g2z] = at(sg * (hl + 0.1), gwid), gy0 = hfAt(g1x, g1z), gy1 = hfAt(g2x, g2z);
            mb.mat(15).color(0.92, 0.92, 0.9, 1); mb.cyl(g1x, gy0, g1z, 0.06, gy0 + 2.44, 0.06, 6, false, true); mb.cyl(g2x, gy1, g2z, 0.06, gy1 + 2.44, 0.06, 6, false, true);
            mb.push(m4mul(m4(), m4translate(m4(), (g1x + g2x) / 2, 0, (g1z + g2z) / 2), m4rotY(m4(), -Math.atan2(g2z - g1z, g2x - g1x)))); mb.box(0, Math.max(gy0, gy1) + 2.44, 0, gwid * 2, 0.1, 0.1); mb.pop();
            mb.mat(15).color(0.7, 0.72, 0.68, 1);
          }
        }
      }, 400);
      np++;
    } else {
      // allotments: beds 1.3 m wide across the plot, every 2.2 m, clipped to the polygon; a shed every 30 m along one side
      townJob(cx, cz, () => {
        for (let v = -Wd / 2 + 1.2; v < Wd / 2 - 1; v += 2.2) for (let u = -L / 2 + 1; u < L / 2 - 1; u += 1.6) {
          const [x, z] = at(u, v); if (!inRing(k0, k1, x, z)) continue;
          const h = hash2(Math.round(u * 3), Math.round(v * 7)); if (h < 0.15) continue;   // (an empty plot)
          if (h < 0.55) mb.mat(15).color(0.16, 0.1, 0.06, 1); else mb.mat(15).color(0.1 + h * 0.04, 0.2 + h * 0.08, 0.06, 1);
          quad(x, z, tx, tz, 0.8, 0.65, h < 0.55 ? 0.02 : 0.08);
        }
        for (let u = -L / 2 + 6; u < L / 2 - 4; u += 30) { const [x, z] = at(u, Wd / 2 - 1.8); if (!inRing(k0, k1, x, z)) continue; const y = hfAt(x, z), h = hash2(Math.round(u), 9); mb.push(m4mul(m4(), m4translate(m4(), x, 0, z), m4rotY(m4(), -ang))); mb.mat(15).color(0.2 + h * 0.15, 0.24, 0.16, 1); mb.box(0, y + 1.0, 0, 2.2, 2.0, 1.6); mb.color(0.15, 0.15, 0.16, 1); mb.box(0, y + 2.05, 0, 2.5, 0.1, 1.9); mb.pop(); }
      }, 350);
      na++;
    }
  }
  TOWNW.stats.grounds = { pitches: np, allotments: na, get graves() { return ng; } };
}

// ---------------------------------------------------------------- all together
function townWorldBuild() {
  // (SEA_LVL: the tide's level; HW_LVL: spring high water, the top of the wet shore; FAR_*: the far grid of the sea's mask)
  const T = TOWN, defs = { SEA_LVL: T.sea.toFixed(3), SEA_MID: T.seaMid.toFixed(3), HW_LVL: Math.max(T.sea, T.tides.high).toFixed(3), FAR_X0: T.fx0.toFixed(3), FAR_Z0: T.fz0.toFixed(3), FAR_RES: T.fres.toFixed(3) };
  const famG = mkFamily('townGround', { src: 'mat_town_ground', defs, shadowBias: 4, shadowSlope: 3 });
  const famT = mkFamily('town', { src: 'mat_town', defs, shadowBias: 3, shadowSlope: 2.5 });
  const famW = mkFamily('townWater', { src: 'mat_water', defs, noShadow: true });
  const atlas = townAtlas();
  // the sea's masks at this tide (townWetBuild): the town's 2 m nodes and the far grid
  const wtx = mkTex(HF.w, HF.h, 'r8unorm', TU.TB | TU.CD), ftx = mkTex(T.fw, T.fh, 'r8unorm', TU.TB | TU.CD);
  G.dev.queue.writeTexture({ texture: wtx }, T.wet, { bytesPerRow: HF.w }, [HF.w, HF.h]);
  G.dev.queue.writeTexture({ texture: ftx }, T.wetFar, { bytesPerRow: T.fw }, [T.fw, T.fh]);
  TOWNW.ground = new RangeSet(famG);
  TOWNW.water = new RangeSet(famW, G.dev.createBindGroup({ layout: famW.bgl3, entries: [{ binding: 0, resource: wtx.createView() }, { binding: 1, resource: ftx.createView() }] }));
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
  const Gr = townRoadGrid(); TOWNW.jobs = new Map();
  // the architecture kit (35_wsm_arch.js): on unless ?arch=0 (the plain buildings)
  TOWNW.arch = typeof archFromTown === 'function' && Q.get('arch') !== '0';
  for (let k = 0; k < tiles.length; k++) {
    const i0 = mb.ni;
    for (const r of tiles[k][0]) townRoad(mb, r, Gr);
    for (const b of tiles[k][1]) townBuilding(mb, b);
    if (mb.ni > i0) { rs.addRange(mb, i0, mb.ni, 3); rs.addRange(mb, i0, mb.ni, 4, 420); }
  }
  townSeaWallBuild(mb, rs);
  townTollBuild(mb, rs);
  TOWNW.roadGrid = Gr; townFurnitureBuild(mb, rs); townMarkingsBuild(mb, rs); townGroundsBuild(mb, rs); townJobsRun(mb, rs);
  if (TOWNW.arch) TOWNW.stats.arch = archFinish();
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
  window.__cap.town = { stats: TOWNW.stats, TOWN, TOWNW, props: WSMP, hf: hfAt, camH: (x, z, h, tx, tz, th, fov) => window.__cap.cam(x, hfAt(x, z) + h, z, tx, hfAt(tx, tz) + th, tz, fov || 0.9) };
}
if (TOWN.on && WORLD.active) queueMicrotask(() => BUILD.push(async () => { townWorldBuild(); await townPropsBuild(); }));   // (the props once the town has placed them)
