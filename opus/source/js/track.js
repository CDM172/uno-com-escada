// ---------------------------------------------------------------------------
// track.js — original circuit: closed spline, samples every ~1 m, zones
// Convention: u>0 = RIGHT side in the racing direction. right = (-tz, tx)
// ---------------------------------------------------------------------------
'use strict';

const TRACK = (() => {
  // control points (x, z, y=elevation). Racing direction follows the order.
  const C = [
    [-230, 0, 0.0], [-120, 0, 0.0], [0, 0, 0.0], [110, 0, 0.0],
    [158, -6, 0.1], [186, -30, 0.3], [188, -62, 0.6], [166, -86, 1.1], [128, -94, 2.0],
    [70, -98, 4.6], [10, -110, 8.0], [-38, -136, 10.4],
    [-82, -152, 11.6], [-126, -140, 11.6], [-168, -146, 10.8], [-206, -172, 9.4],
    [-246, -196, 7.8], [-290, -184, 6.4], [-312, -142, 4.9], [-312, -92, 3.4],
    [-302, -44, 1.8], [-276, -10, 0.5],
  ];
  const T = {};
  T.ctrl = C;

  function catmull(p0, p1, p2, p3, t, out) {
    // centripetal
    const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-4;
    const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-4;
    const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-4;
    for (let k = 0; k < 3; k++) {
      const m1 = (p2[k] - p1[k] + d12 * ((p1[k] - p0[k]) / d01 - (p2[k] - p0[k]) / (d01 + d12)));
      const m2 = (p2[k] - p1[k] + d12 * ((p3[k] - p2[k]) / d23 - (p3[k] - p1[k]) / (d12 + d23)));
      const a = 2 * (p1[k] - p2[k]) + m1 + m2, b = -3 * (p1[k] - p2[k]) - m1 - m1 - m2;
      out[k] = a * t * t * t + b * t * t + m1 * t + p1[k];
    }
  }

  // 1) dense sampling
  const dense = [];
  const nC = C.length, SUB = 80, tmp = [0, 0, 0];
  for (let i = 0; i < nC; i++) {
    const p0 = C[(i - 1 + nC) % nC], p1 = C[i], p2 = C[(i + 1) % nC], p3 = C[(i + 2) % nC];
    for (let j = 0; j < SUB; j++) { catmull(p0, p1, p2, p3, j / SUB, tmp); dense.push([tmp[0], tmp[1], tmp[2]]); }
  }
  // 2) arc length
  const nd = dense.length, cum = new Float64Array(nd + 1);
  for (let i = 0; i < nd; i++) { const a = dense[i], b = dense[(i + 1) % nd]; cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const L0 = cum[nd];
  const N = Math.round(L0 / 1.0);
  const px = new Float64Array(N), pz = new Float64Array(N), py = new Float64Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / N) * L0;
    while (cum[k + 1] < s) k++;
    const f = (s - cum[k]) / (cum[k + 1] - cum[k]);
    const a = dense[k], b = dense[(k + 1) % nd];
    px[i] = lerp(a[0], b[0], f); pz[i] = lerp(a[1], b[1], f); py[i] = lerp(a[2], b[2], f);
  }
  // 3) smoothing (continuous curvature) — light Laplacian
  const sx = new Float64Array(N), sz = new Float64Array(N);
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      sx[i] = px[i] * 0.5 + (px[a] + px[b]) * 0.25; sz[i] = pz[i] * 0.5 + (pz[a] + pz[b]) * 0.25;
    }
    px.set(sx); pz.set(sz);
  }
  // elevation: strong smoothing (wide Gaussian)
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; sx[i] = py[i] * 0.5 + (py[a] + py[b]) * 0.25; }
    py.set(sx);
  }
  // 4) resample again by exact length
  let L = 0; const cl = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) { const b = (i + 1) % N; cl[i + 1] = cl[i] + Math.hypot(px[b] - px[i], pz[b] - pz[i]); }
  L = cl[N];
  {
    const qx = new Float64Array(N), qz = new Float64Array(N), qy = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = (i / N) * L;
      while (cl[j + 1] < s) j++;
      const f = (s - cl[j]) / (cl[j + 1] - cl[j]); const b = (j + 1) % N;
      qx[i] = lerp(px[j], px[b], f); qz[i] = lerp(pz[j], pz[b], f); qy[i] = lerp(py[j], py[b], f);
    }
    px.set(qx); pz.set(qz); py.set(qy);
  }
  const ds = L / N;
  // 5) tangents, curvature, slope
  const tx = new Float64Array(N), tz = new Float64Array(N), curv = new Float64Array(N), slope = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz);
    tx[i] = dx / l; tz[i] = dz / l;
    slope[i] = (py[b] - py[a]) / (2 * ds);
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    // signed curvature: >0 = right-hand corner
    const cross = tx[a] * tz[b] - tz[a] * tx[b];
    curv[i] = Math.asin(clamp(cross, -1, 1)) / (4 * ds);
  }
  // smooth curvature
  { const c2 = new Float64Array(N); for (let it = 0; it < 6; it++) { for (let i = 0; i < N; i++) c2[i] = (curv[(i - 1 + N) % N] + 2 * curv[i] + curv[(i + 1) % N]) * 0.25; curv.set(c2); } }

  T.N = N; T.L = L; T.ds = ds;
  T.px = px; T.py = py; T.pz = pz; T.tx = tx; T.tz = tz; T.curv = curv; T.slope = slope;

  // start: line at x ≈ -40 on the main straight
  let iStart = 0, best = 1e9;
  for (let i = 0; i < N; i++) { const d = Math.hypot(px[i] + 40, pz[i]); if (d < best) { best = d; iStart = i; } }
  T.iStart = iStart; T.sStart = iStart * ds;

  // 6) width and zones -------------------------------------------------------
  const hw = new Float32Array(N);
  const kerbL = new Float32Array(N), kerbR = new Float32Array(N); // kerb width (0 = none)
  const gravL = new Float32Array(N), gravR = new Float32Array(N); // gravel width after the short grass
  const wallL = new Float32Array(N), wallR = new Float32Array(N); // distance from the centre to the barrier
  const tyreL = new Uint8Array(N), tyreR = new Uint8Array(N);     // tyre barrier in front of the guard rail
  const wallTypeL = new Uint8Array(N), wallTypeR = new Uint8Array(N); // 0 guard rail, 1 concrete wall
  const wetMask = new Float32Array(N);
  const absC = new Float64Array(N);
  for (let i = 0; i < N; i++) absC[i] = Math.abs(curv[i]);
  // curvature "ahead" (for gravel at the exit and at the apex)
  const wind = (arr, i, back, fwd, fn) => { let m = 0; for (let j = -back; j <= fwd; j++) { const v = fn(arr[(i + j + N) % N], j); if (v > m) m = v; } return m; };
  for (let i = 0; i < N; i++) {
    hw[i] = 6.0;
    const c = curv[i];
    // kerbs: inner side when |c| is high, outer on the exit
    const cin = wind(curv, i, 10, 10, (v) => Math.abs(v));
    const kerbW = cin > 1 / 160 ? 1.1 : 0;
    // sign of the dominant corner in the window
    let sgn = 0; for (let j = -12; j <= 12; j++) sgn += curv[(i + j + N) % N];
    if (kerbW > 0) {
      if (sgn > 0) { kerbR[i] = kerbW; } else { kerbL[i] = kerbW; }
      // outer on the exit
      const cOut = wind(curv, i, 30, 2, (v) => Math.abs(v));
      if (cOut > 1 / 70) { if (sgn > 0) kerbL[i] = 0.9; else kerbR[i] = 0.9; }
    }
    // gravel: outer side of the tightest corners, extended ahead
    const cg = wind(curv, i, 45, 10, (v) => Math.abs(v));
    let sg = 0; for (let j = -45; j <= 10; j++) sg += curv[(i + j + N) % N];
    if (cg > 1 / 90) { const w = clamp((cg * 90 - 1) * 14 + 10, 10, 24); if (sg > 0) gravL[i] = w; else gravR[i] = w; }
    // barriers
    const baseRun = 9;
    wallL[i] = hw[i] + baseRun + (gravL[i] > 0 ? gravL[i] + 3 : 0);
    wallR[i] = hw[i] + baseRun + (gravR[i] > 0 ? gravR[i] + 3 : 0);
    tyreL[i] = gravL[i] > 12 ? 1 : 0; tyreR[i] = gravR[i] > 12 ? 1 : 0;
  }
  // main straight: pit wall (left) and grandstand wall (right)
  for (let i = 0; i < N; i++) {
    if (pz[i] > -12 && pz[i] < 12 && px[i] > -225 && px[i] < 100 && Math.abs(tz[i]) < 0.15) {
      const fade = smoothstep(-225, -200, px[i]) * (1 - smoothstep(80, 100, px[i]));
      if (fade > 0.01) {
        wallL[i] = lerp(wallL[i], 9.5, fade); wallTypeL[i] = fade > 0.5 ? 1 : 0;
        wallR[i] = lerp(wallR[i], 10.5, fade); wallTypeR[i] = fade > 0.5 ? 1 : 0;
        hw[i] = lerp(6.0, 6.5, fade);
      }
    }
  }
  // smooths widths/walls so there are no steps
  const smoothArr = (a, it) => { const b = new Float32Array(N); for (let k2 = 0; k2 < it; k2++) { for (let i = 0; i < N; i++) b[i] = (a[(i - 1 + N) % N] + a[i] * 2 + a[(i + 1) % N]) * 0.25; a.set(b); } };
  smoothArr(wallL, 40); smoothArr(wallR, 40); smoothArr(hw, 20); smoothArr(gravL, 12); smoothArr(gravR, 12);
  // kerbs: removes short stretches and rounds start/end to 2 m modules
  for (const kb of [kerbL, kerbR]) {
    let i0 = -1;
    for (let i = 0; i <= N; i++) {
      const on = i < N && kb[i] > 0;
      if (on && i0 < 0) i0 = i;
      if (!on && i0 >= 0) { if (i - i0 < 12) for (let j = i0; j < i; j++) kb[j] = 0; i0 = -1; }
    }
  }
  // wet stretches (puddles) — a few regions along s
  const wetCenters = [0.18, 0.43, 0.64, 0.86, 0.985];
  for (let i = 0; i < N; i++) {
    let w = 0; const f = i / N;
    for (const c of wetCenters) { let d = Math.abs(f - c); d = Math.min(d, 1 - d) * L; w = Math.max(w, 1 - smoothstep(14, 40, d)); }
    wetMask[i] = w;
  }

  T.hw = hw; T.kerbL = kerbL; T.kerbR = kerbR; T.gravL = gravL; T.gravR = gravR;
  T.wallL = wallL; T.wallR = wallR; T.tyreL = tyreL; T.tyreR = tyreR; T.wallTypeL = wallTypeL; T.wallTypeR = wallTypeR;
  T.wet = wetMask;
  T.racing = new Float32Array(N); // racing line offset (filled in by ai.js)

  // ---------------- queries ----------------
  T.idx = (i) => ((i % N) + N) % N;
  // continuous sample: writes into out [x,y,z,tx,tz,hw]
  T.sampleS = (s, out) => {
    let f = s / ds; f = ((f % N) + N) % N;
    const i = Math.floor(f), j = (i + 1) % N, t = f - i;
    out[0] = lerp(px[i], px[j], t); out[1] = lerp(py[i], py[j], t); out[2] = lerp(pz[i], pz[j], t);
    let ax = lerp(tx[i], tx[j], t), az = lerp(tz[i], tz[j], t); const l = Math.hypot(ax, az); ax /= l; az /= l;
    out[3] = ax; out[4] = az; out[5] = lerp(hw[i], hw[j], t);
    return out;
  };
  T.lerpArr = (arr, s) => { let f = s / ds; f = ((f % N) + N) % N; const i = Math.floor(f), j = (i + 1) % N; return lerp(arr[i], arr[j], f - i); };
  // nearest point: returns in out [s, u, i]; local search from hint (or global if hint<0)
  T.project = (x, z, hint, out) => {
    let bi = 0, bd = 1e18;
    if (hint < 0) {
      for (let i = 0; i < N; i += 3) { const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      hint = bi;
    }
    bd = 1e18;
    for (let o = -24; o <= 24; o++) {
      const i = ((hint + o) % N + N) % N; const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    // refines by projecting onto the segment
    const dx = x - px[bi], dz = z - pz[bi];
    let along = dx * tx[bi] + dz * tz[bi];
    const u = -dx * tz[bi] + dz * tx[bi];
    along = clamp(along, -ds, ds);
    out[0] = ((bi * ds + along) % L + L) % L; out[1] = u; out[2] = bi;
    return out;
  };
  // height of the track surface (with slight crown and kerbs)
  T.surfaceY = (s, u) => {
    const y = T.lerpArr(py, s);
    const h = T.lerpArr(hw, s);
    const a = Math.abs(u) / h;
    let yy = y - 0.03 * a * a;
    // raised kerb
    const kw = u > 0 ? T.lerpArr(kerbR, s) : T.lerpArr(kerbL, s);
    if (kw > 0 && Math.abs(u) > h && Math.abs(u) < h + kw) {
      const t = (Math.abs(u) - h) / kw;
      yy += 0.035 * Math.sin(Math.min(t * 1.6, 1) * PI * 0.5);
    }
    return yy;
  };
  return T;
})();
