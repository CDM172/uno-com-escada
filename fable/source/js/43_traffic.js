// Weston-super-Mare traffic (?map=wsm): cars parked along the residential streets and a dozen and a half driving on the
// main roads, all of them garage cars (28_oxa_data.js) in random colours, all solid. Nothing of it touches the circuit:
// no car parks within reach of the racing line, and the moving ones turn round before they reach a road the circuit
// uses or crosses, so the autopilot's laps (demo lap, benchmark) meet nobody. The Serra da Mata map has none of this.
//   roads    the town's road polylines (TOWN.rd: class, width, flags) — read only. Moving traffic: classes 1 to 5 (trunk to
//            unclassified), in the left lane (the UK drives on the left). Parking: classes 6 and 7 (residential, living
//            street), both sides on roads 7.6 m wide or more, one side on narrower ones, never in a junction's mouth,
//            against a building or on water.
//   parked   static geometry, batched by 128 m cells (slot 0, culled by distance), and boxes in a 16 m grid for collisions
//   moving   one object slot each (the 64-slot budget: TRAF_N of them, after the player's car), one model each from a pool of
//            decoded garage cars (white paint: the colour is the slot's parameter, wgsl/mat_car.wgsl with TRAFFIC). They
//            follow their lane, slow for bends, stop behind the player's car or another car, turn at junctions, turn
//            round where the road ends or meets the circuit, and are moved somewhere behind the player's car when they get far.
// Physics runs in gameStep (trafficStep, 120 Hz, deterministic: its own random numbers, reset by gameRestart); the player
// collides with both kinds in vehicleCollide (trafficCollide). No allocation in the game loop.
const TRAF_N = 16;                     // moving cars
const TRAF_PARK = GFX === 'fast' ? 150 : 300;   // most parked cars (fewer in fast graphics)
const TRAF = {
  on: TOWN.on, ready: false,
  // roads: per polyline q of TOWN.rd: kind (0 none, 1 traffic, 2 parking), lane offset (m, left of the direction of travel)
  kind: null, lane: null, segOk: null,   // segOk: per vertex k (segment k..k+1): 1 if moving cars may drive on it
  segLen: null, segTx: null, segTz: null,
  ends: null,                            // per polyline, per end (0 first vertex, 1 last): list of [road, vertex, dir] to turn into
  // parked cars: x, z, yaw, half length, half width, y, model, paint index
  pk: null, pkN: 0, pgrid: null, pgw: 0, pgh: 0, pcell: 16,
  // moving cars (index i): road, segment, distance along it, direction (±1), speed, held (s), lane offset now, model,
  // paint, slot; pose (x, z, y, yaw, pitch) now and before (rendering interpolates)
  r: new Int32Array(TRAF_N), k: new Int32Array(TRAF_N), u: new Float64Array(TRAF_N), dir: new Int32Array(TRAF_N),
  v: new Float64Array(TRAF_N), hold: new Float64Array(TRAF_N), off: new Float64Array(TRAF_N), turn: new Float64Array(TRAF_N * 4),
  model: new Int32Array(TRAF_N), paint: new Float32Array(TRAF_N * 3), slot: new Int32Array(TRAF_N).fill(-1),
  pose: new Float64Array(TRAF_N * 6), ppose: new Float64Array(TRAF_N * 6),
  dim: new Float32Array(TRAF_N * 4),     // half length, half width, wheelbase, tail-lamp x (of the model)
  pool: [], poolDim: null,               // decoded models of the moving cars: {i (OXA index), body, glass, dims}
  items: [], gitems: [],                 // their MeshSet / GlassSet items (one per car: model swaps change vb/ib)
  fam: null, set: null, glass: null,
  seed: 1, rng: 1, stepN: 0, pick: null, bg: null, stats: null,
};
const TQ = new Float64Array(16);         // register of the traffic code
// colours of the town's cars (linear RGB): white, silver, greys, black, blues, reds, greens, beige
const TRAF_PAINT = [[0.8, 0.8, 0.78], [0.55, 0.56, 0.57], [0.25, 0.26, 0.27], [0.05, 0.05, 0.055], [0.02, 0.06, 0.22], [0.12, 0.2, 0.36],
  [0.45, 0.03, 0.025], [0.2, 0.012, 0.01], [0.03, 0.12, 0.05], [0.5, 0.44, 0.33], [0.62, 0.62, 0.63], [0.08, 0.1, 0.12], [0.75, 0.75, 0.73], [0.04, 0.035, 0.03]];
function trafRnd() { let x = TRAF.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; TRAF.rng = x >>> 0; return TRAF.rng / 4294967296; }

// ---------- setup (loading time) ----------
// distance from (x, z) to the circuit's centre line (exact within 120 m, a lower bound beyond)
function trafCircDist(x, z) {
  const far = trackFarDist(x, z); if (far > 120) return far;
  const gx = Math.floor((x - TRK.gridX0) / TRK.gridCell), gz = Math.floor((z - TRK.gridZ0) / TRK.gridCell);
  const lst = (gx >= 0 && gz >= 0 && gx < TRK.gridW && gz < TRK.gridH) ? TRK.cellList[gz * TRK.gridW + gx] : null;
  if (!lst) return far;
  let bd = 1e18; for (let q = 0; q < lst.length; q++) { const i = lst[q], dx = TRK.x[i] - x, dz = TRK.z[i] - z, d2 = dx * dx + dz * dz; if (d2 < bd) bd = d2; }
  return Math.sqrt(bd);
}
// The road network: which polylines carry traffic or parked cars, where moving cars may drive, how the ends connect
function trafficRoads() {
  const T = TOWN, R = T.rd, ri = T.rinfo, n = R.n, P = R.p, nv = R.off[n];
  const kind = TRAF.kind = new Uint8Array(n), lane = TRAF.lane = new Float32Array(n), ok = TRAF.segOk = new Uint8Array(nv);
  const sl = TRAF.segLen = new Float32Array(nv), stx = TRAF.segTx = new Float32Array(nv), stz = TRAF.segTz = new Float32Array(nv);
  for (let q = 0; q < n; q++) {
    const cls = ri[q * 4], w = ri[q * 4 + 1] * 0.1, flags = ri[q * 4 + 2];
    kind[q] = cls >= 1 && cls <= 5 && w >= 5.5 ? 1 : (cls === 6 || cls === 7) && w >= 4.8 ? 2 : 0;
    lane[q] = flags & 2 ? 0 : Math.min(2.0, Math.max(1.1, w / 4));   // (one-way: the middle of the road)
    for (let k = R.off[q]; k < R.off[q + 1] - 1; k++) {
      const ax = P[k * 2], az = P[k * 2 + 1], bx = P[k * 2 + 2], bz = P[k * 2 + 3], L = Math.hypot(bx - ax, bz - az);
      sl[k] = L; stx[k] = L > 1e-6 ? (bx - ax) / L : 1; stz[k] = L > 1e-6 ? (bz - az) / L : 0;
      if (kind[q] !== 1) continue;
      // a segment moving cars may use: not within reach of the circuit (it uses or crosses this road there)
      let near = 1e9; for (let s = 0; s <= 4; s++) { const d = trafCircDist(ax + (bx - ax) * s / 4, az + (bz - az) * s / 4); if (d < near) near = d; }
      ok[k] = near > 22 ? 1 : 0;
    }
  }
  // ends: other traffic roads with a vertex within 3 m of this road's end vertex (their ends, or a vertex inside them)
  const cell = 24, g = new Map(), key = (x, z) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
  for (let q = 0; q < n; q++) if (kind[q] === 1) for (let k = R.off[q]; k < R.off[q + 1]; k++) { const kk = key(P[k * 2], P[k * 2 + 1]); let a = g.get(kk); if (!a) g.set(kk, a = []); a.push(q, k); }
  const ends = TRAF.ends = new Array(n * 2).fill(null);
  for (let q = 0; q < n; q++) {
    if (kind[q] !== 1) continue;
    for (let e = 0; e < 2; e++) {
      const k = e ? R.off[q + 1] - 1 : R.off[q], x = P[k * 2], z = P[k * 2 + 1], out = [];
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a = g.get((cx + dx) * 100003 + cz + dz); if (!a) continue;
        for (let m = 0; m < a.length; m += 2) {
          const q2 = a[m], k2 = a[m + 1]; if (q2 === q) continue;
          if (Math.hypot(P[k2 * 2] - x, P[k2 * 2 + 1] - z) > 3) continue;
          if (k2 < R.off[q2 + 1] - 1 && ok[k2]) out.push(q2, k2, 1);                  // along it from there
          if (k2 > R.off[q2] && ok[k2 - 1] && !(TOWN.rinfo[q2 * 4 + 2] & 2)) out.push(q2, k2, -1);   // against it (not on a one-way road)
        }
      }
      ends[q * 2 + e] = out.length ? Int32Array.from(out) : null;
    }
  }
}
// Parking spots along the residential streets, within 400 m of the circuit (where they are seen); boxes and grid
function trafficParking() {
  const T = TOWN, R = T.rd, ri = T.rinfo, P = R.p, kind = TRAF.kind, pk = [], CL = OXA_CARS.length;
  // a grid of road segments, to keep junction mouths clear
  const cell = 20, sg = new Map(), key = (x, z) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
  for (let q = 0; q < R.n; q++) {
    const cls = ri[q * 4]; if (cls < 1 || cls > 9) continue;
    for (let k = R.off[q]; k < R.off[q + 1] - 1; k++) {
      const mx = (P[k * 2] + P[k * 2 + 2]) / 2, mz = (P[k * 2 + 1] + P[k * 2 + 3]) / 2, kk = key(mx, mz); let a = sg.get(kk); if (!a) sg.set(kk, a = []); a.push(q, k);
    }
  }
  const nearOther = (x, z, q, pad) => {   // a point within (half width of another road + pad) of its centre line
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const a = sg.get((cx + dx) * 100003 + cz + dz); if (!a) continue;
      for (let m = 0; m < a.length; m += 2) {
        const q2 = a[m]; if (q2 === q) continue; const k = a[m + 1];
        const ax = P[k * 2], az = P[k * 2 + 1], ex = P[k * 2 + 2] - ax, ez = P[k * 2 + 3] - az; let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez + 1e-9); t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(ax + ex * t - x, az + ez * t - z) < ri[q2 * 4 + 1] * 0.05 + pad) return true;
      }
    }
    return false;
  };
  // the models parked: mostly cars, some vans, a few small trucks
  const cars = [], vans = []; for (let i = 0; i < CL; i++) { const c = OXA_CARS[i].meta.car; if (c.category === 'car') cars.push(i); else if (c.mass < 3000) vans.push(i); }
  TRAF.rng = 0x9e3779b9;
  for (let q = 0; q < R.n; q++) {
    if (kind[q] !== 2 || (ri[q * 4 + 2] & 1)) continue;
    const w = ri[q * 4 + 1] * 0.1, both = w >= 7.6;
    for (let side = 0; side < (both ? 2 : 1); side++) {
      const sg2 = side ? 1 : -1;   // -1: the left of the polyline (the near side for its direction), 1: the right
      let gapLeft = trafRnd() * 12;
      for (let k = R.off[q]; k < R.off[q + 1] - 1; k++) {
        const L = TRAF.segLen[k], tx = TRAF.segTx[k], tz = TRAF.segTz[k]; let s = gapLeft;
        while (s < L - 2.6) {
          const m = trafRnd() < 0.86 || !vans.length ? cars[(trafRnd() * cars.length) | 0] : vans[(trafRnd() * vans.length) | 0], c = OXA_CARS[m].meta.car;
          const hl = c.size[0] / 2, hw = (c.size[2] - 0.18) / 2;
          if (s + 2 * hl > L) break;
          const along = s + hl, off = w / 2 - hw - 0.15, nx = -tz * sg2, nz = tx * sg2;   // (right of the polyline: (-tz, tx))
          const x = P[k * 2] + tx * along + nx * off, z = P[k * 2 + 1] + tz * along + nz * off;
          let good = off > hw + 0.9 && trafCircDist(x, z) > 26 && trafCircDist(x, z) < 400;
          if (good) {   // the four corners and the middle: on the road, clear of buildings and of other roads
            for (let cI = 0; cI < 5 && good; cI++) {
              const lx = cI === 4 ? 0 : (cI & 1 ? hl : -hl), lz = cI === 4 ? 0 : (cI & 2 ? hw : -hw), px = x + tx * lx + nx * lz * sg2, pz = z + tz * lx + nz * lz * sg2;
              if (townBuildingQ(px, pz) || townBlockedQ(px, pz)) good = false;
              else if (nearOther(px, pz, q, 3.5)) good = false;
            }
            if (good) { const zi = (x - T.x0) | 0, zj = (z - T.z0) | 0; if (zi < 0 || zj < 0 || zi >= T.zw || zj >= T.zh || T.zone[zj * T.zw + zi] !== TZ.ROAD) good = false; }
          }
          if (good) {
            // facing the way the traffic on that side goes (the left of the polyline: along it)
            const yaw = Math.atan2(tz, tx) + (sg2 > 0 ? PI : 0), y = hfAt(x, z);
            pk.push(x, z, yaw, hl, hw, y, m, trafRnd() < 0.25 ? -1 : (trafRnd() * TRAF_PAINT.length) | 0);
            s += 2 * hl + 0.8 + trafRnd() * (trafRnd() < 0.3 ? 14 : 3);
          } else s += 2.5;
        }
        gapLeft = Math.max(0, s - L);
      }
    }
  }
  // at most TRAF_PARK of them, the ones nearest the circuit (the ones seen from it)
  let N = pk.length / 8;
  if (N > TRAF_PARK) {
    const ord = []; for (let i = 0; i < N; i++) ord.push([trafCircDist(pk[i * 8], pk[i * 8 + 1]), i]); ord.sort((a, b) => a[0] - b[0]);
    const keep = []; for (let j = 0; j < TRAF_PARK; j++) { const i = ord[j][1]; for (let q = 0; q < 8; q++) keep.push(pk[i * 8 + q]); }
    pk.length = 0; for (const v of keep) pk.push(v); N = TRAF_PARK;
  }
  TRAF.pkN = N; const A = TRAF.pk = Float32Array.from(pk);
  // collision grid
  const c = TRAF.pcell, gw = TRAF.pgw = Math.ceil((T.x1 - T.x0) / c), gh = TRAF.pgh = Math.ceil((T.z1 - T.z0) / c), cnt = new Int32Array(gw * gh + 1);
  const cellOf = i => { const gi = Math.min(gw - 1, Math.max(0, ((A[i * 8] - T.x0) / c) | 0)), gj = Math.min(gh - 1, Math.max(0, ((A[i * 8 + 1] - T.z0) / c) | 0)); return gj * gw + gi; };
  for (let i = 0; i < N; i++) cnt[cellOf(i) + 1]++;
  for (let i = 0; i < gw * gh; i++) cnt[i + 1] += cnt[i];
  const items = new Int32Array(N), fill = cnt.slice(0, gw * gh);
  for (let i = 0; i < N; i++) items[fill[cellOf(i)]++] = i;
  TRAF.pgrid = { start: cnt, items };
}
// CPU part of the setup (also the Node tests): roads, parking, the models of the moving cars (cars mostly, two vans)
function trafficPrepare() {
  trafficRoads(); trafficParking();
  const pick = TRAF.pick = [], cars = [], vans = []; for (let i = 0; i < OXA_CARS.length; i++) { const c = OXA_CARS[i].meta.car; if (c.category === 'car') cars.push(i); else if (c.mass < 3000) vans.push(i); }
  TRAF.rng = 0x1234567;
  while (pick.length < 9) { const m = cars[(trafRnd() * cars.length) | 0]; if (pick.indexOf(m) < 0) pick.push(m); }
  for (let k = 0; k < 2 && vans.length; k++) { const m = vans[(trafRnd() * vans.length) | 0]; if (pick.indexOf(m) < 0) pick.push(m); }
  const dim = TRAF.poolDim = new Float32Array(pick.length * 4);
  for (let p = 0; p < pick.length; p++) {
    const k = OXA_CARS[pick[p]].meta.car; TRAF.pool.push({ i: pick[p], body: null, glass: null });
    dim[p * 4] = k.size[0] / 2; dim[p * 4 + 1] = (k.size[2] - 0.18) / 2; dim[p * 4 + 2] = k.wheelbase; dim[p * 4 + 3] = -k.size[0] / 2 + 0.3;
  }
  TRAF.ready = true;
}

// ---------- the moving cars ----------
// picks a garage car for moving car i (from the pool) and a colour
function trafChoose(i) {
  const n = TRAF.pool.length; TRAF.model[i] = n ? (trafRnd() * n) | 0 : 0;
  const p = TRAF_PAINT[(trafRnd() * TRAF_PAINT.length) | 0]; TRAF.paint[i * 3] = p[0]; TRAF.paint[i * 3 + 1] = p[1]; TRAF.paint[i * 3 + 2] = p[2];
  const d = TRAF.poolDim, m = TRAF.model[i] * 4; for (let q = 0; q < 4; q++) TRAF.dim[i * 4 + q] = d ? d[m + q] : [2.3, 0.9, 2.7, -2.0][q];
}
// puts moving car i on a traffic segment between rMin and rMax metres from (cx, cz), clear of the others; false: no place
function trafPlace(i, cx, cz, rMin, rMax, tries) {
  const RD = TOWN.rd, P = RD.p, nv = RD.off[RD.n], ok = TRAF.segOk;
  for (let t = 0; t < tries; t++) {
    const k = (trafRnd() * (nv - 1)) | 0; if (!ok[k]) continue;
    // which polyline: the last start at or before k
    let lo = 0, hi = RD.n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (RD.off[mid] <= k) lo = mid; else hi = mid - 1; }
    const q = lo; if (TRAF.kind[q] !== 1 || k >= RD.off[q + 1] - 1) continue;
    const u = trafRnd() * TRAF.segLen[k], x = P[k * 2] + TRAF.segTx[k] * u, z = P[k * 2 + 1] + TRAF.segTz[k] * u, d = Math.hypot(x - cx, z - cz);
    if (d < rMin || d > rMax) continue;
    if (TQ[12] && (x - cx) * Math.cos(VEH.yaw) + (z - cz) * Math.sin(VEH.yaw) > d * 0.2) continue;   // (moving one on: not ahead of the player's car, where the camera looks; not the camera itself, so that the laps repeat)
    let clear = true; for (let j = 0; j < TRAF_N && clear; j++) if (j !== i && TRAF.slot[j] !== -2) { const o = j * 6; if (Math.hypot(TRAF.pose[o] - x, TRAF.pose[o + 1] - z) < 12) clear = false; }
    if (!clear) continue;
    const oneway = (TOWN.rinfo[q * 4 + 2] & 2) !== 0;
    TRAF.r[i] = q; TRAF.k[i] = k; TRAF.u[i] = u; TRAF.dir[i] = oneway || trafRnd() < 0.5 ? 1 : -1; TRAF.v[i] = 6 + trafRnd() * 4; TRAF.hold[i] = 0;
    TRAF.off[i] = TRAF.lane[q]; TRAF.turn[i * 4] = 0;
    trafChoose(i); trafPose(i); TRAF.ppose.set(TRAF.pose.subarray(i * 6, i * 6 + 6), i * 6);
    return true;
  }
  return false;
}
// position of moving car i from its road state: TQ[0..1] = point on the lane, TQ[2..3] = direction of travel
function trafLanePoint(i) {
  const P = TOWN.rd.p, k = TRAF.k[i], u = TRAF.u[i], d = TRAF.dir[i], tx = TRAF.segTx[k], tz = TRAF.segTz[k], o = TRAF.off[i];
  const hx = tx * d, hz = tz * d;                 // heading
  TQ[0] = P[k * 2] + tx * u + hz * o; TQ[1] = P[k * 2 + 1] + tz * u - hx * o;   // left of the heading: (hz, -hx)
  TQ[2] = hx; TQ[3] = hz;
}
// pose of moving car i (x, z, y, yaw, pitch, speed): on its lane, or on its U-turn arc
function trafPose(i) {
  const o = i * 6, t = TRAF.turn, ti = i * 4, D = TRAF.dim, wb = D[i * 4 + 2];
  let x, z, hx, hz;
  if (t[ti] > 0) {   // U-turn: half a circle to the right about (t1, t2), from heading angle t3; t0 = how far round (0..π)
    const a = t[ti + 3] + t[ti], rr = TRAF.off[i] > 0.5 ? TRAF.off[i] : 2.2;
    x = t[ti + 1] + Math.sin(a) * rr; z = t[ti + 2] - Math.cos(a) * rr; hx = Math.cos(a); hz = Math.sin(a);
  } else { trafLanePoint(i); x = TQ[0]; z = TQ[1]; hx = TQ[2]; hz = TQ[3]; }
  const P = TRAF.pose, yf = hfAt(x + hx * wb / 2, z + hz * wb / 2), yr = hfAt(x - hx * wb / 2, z - hz * wb / 2);
  P[o] = x; P[o + 1] = z; P[o + 2] = (yf + yr) / 2; P[o + 3] = Math.atan2(hz, hx); P[o + 4] = Math.atan2(yf - yr, wb); P[o + 5] = TRAF.v[i];
}
// the car moves to the next segment along its direction; at the end of its road it turns into another one or turns round
function trafAdvance(i) {
  const R = TOWN.rd, q = TRAF.r[i], d = TRAF.dir[i];
  while (true) {
    const k = TRAF.k[i], L = TRAF.segLen[k];
    if (d > 0 && TRAF.u[i] <= L) return; if (d < 0 && TRAF.u[i] >= 0) return;
    const nk = k + d;
    if (nk >= R.off[q] && nk < R.off[q + 1] - 1 && TRAF.segOk[nk]) {   // the next segment of the same road
      const extra = d > 0 ? TRAF.u[i] - L : -TRAF.u[i]; TRAF.k[i] = nk; TRAF.u[i] = d > 0 ? extra : TRAF.segLen[nk] - extra; continue;
    }
    // end of the road (or the circuit ahead): another road from this end, else turn round
    const atEnd = d > 0 ? (nk >= R.off[q + 1] - 1) : (nk < R.off[q]), e = TRAF.ends[q * 2 + (d > 0 ? 1 : 0)];
    if (atEnd && e && e.length) {
      // prefer going on more or less straight
      const hx = TRAF.segTx[k] * d, hz = TRAF.segTz[k] * d; let best = -1, bs = -1e9;
      for (let m = 0; m < e.length; m += 3) {
        const k2 = e[m + 1], d2 = e[m + 2], s2 = d2 > 0 ? k2 : k2 - 1, dot = (TRAF.segTx[s2] * hx + TRAF.segTz[s2] * hz) * d2;
        const score = dot + trafRnd() * 1.2 - (dot < -0.5 ? 3 : 0); if (score > bs) { bs = score; best = m; }
      }
      const q2 = e[best], k2 = e[best + 1], d2 = e[best + 2], s2 = d2 > 0 ? k2 : k2 - 1;
      TRAF.r[i] = q2; TRAF.dir[i] = d2; TRAF.k[i] = s2; TRAF.u[i] = d2 > 0 ? 0 : TRAF.segLen[s2]; TRAF.off[i] = TRAF.lane[q2];
      return;
    }
    // turn round: half a circle to the right, across the road into the other lane (the UK drives on the left); the centre
    // is a lane offset to the right of the car, so the arc ends on the other lane, facing back
    TRAF.u[i] = d > 0 ? L : 0; trafLanePoint(i);
    const t = TRAF.turn, ti = i * 4, rr = TRAF.off[i] > 0.5 ? TRAF.off[i] : 2.2;
    t[ti] = 1e-6; t[ti + 1] = TQ[0] - TQ[3] * rr; t[ti + 2] = TQ[1] + TQ[2] * rr; t[ti + 3] = Math.atan2(TQ[3], TQ[2]);
    TRAF.dir[i] = -d; return;
  }
}
// one physics step of the moving cars
function trafficStep() {
  if (!TRAF.ready) return;
  const dt = PHYS_DT, V = VEH, vc = Math.cos(V.yaw), vs = Math.sin(V.yaw), pose = TRAF.pose, D = TRAF.dim;
  TRAF.stepN++;
  for (let i = 0; i < TRAF_N; i++) {
    if (TRAF.slot[i] === -2) continue;
    const o = i * 6, x = pose[o], z = pose[o + 1], hx = Math.cos(pose[o + 3]), hz = Math.sin(pose[o + 3]), hl = D[i * 4];
    // far from the player: somewhere else, out of sight (behind the camera when there is one)
    const dpx = x - V.x, dpz = z - V.z;
    if (dpx * dpx + dpz * dpz > 330 * 330 && (TRAF.stepN + i * 7) % 60 === 0) { TQ[12] = 1; trafPlace(i, V.x, V.z, 140, 300, 60); TQ[12] = 0; continue; }
    // target speed: the road's, slower in bends, held after a knock
    const q = TRAF.r[i], cls = TOWN.rinfo[q * 4];
    let vt = cls <= 2 ? 15 : cls <= 4 ? 13 : 10.5;
    if (TRAF.turn[i * 4] > 0) vt = 3.2;
    else {   // bend ahead: the next segment's heading
      const k = TRAF.k[i], d = TRAF.dir[i], nk = k + d, R = TOWN.rd;
      if (nk >= R.off[q] && nk < R.off[q + 1] - 1) {
        const dot = TRAF.segTx[k] * TRAF.segTx[nk] + TRAF.segTz[k] * TRAF.segTz[nk], left = d > 0 ? TRAF.segLen[k] - TRAF.u[i] : TRAF.u[i];
        if (dot < 0.9 && left < 30) { const vb = 4 + 8 * Math.max(0, dot); if (vb < vt) vt = vb; }
      } else { const left = d > 0 ? TRAF.segLen[k] - TRAF.u[i] : TRAF.u[i]; if (left < 25) vt = Math.min(vt, 4 + left * 0.3); }
    }
    if (TRAF.hold[i] > 0) { TRAF.hold[i] -= dt; vt = 0; }
    // the player's car ahead in the lane (or crossing it): stop short of it
    {
      const fwd = -(dpx * hx + dpz * hz), lz = dpx * hz - dpz * hx, side = lz < 0 ? -lz : lz;   // the player's car from this one: ahead, to the side
      // (in the lane ahead, or anywhere just ahead: the road may bend towards it)
      if (fwd > 0 && ((fwd < 32 && side < 2.6 + VP.halfW) || (fwd < 16 && side < 5))) { const vb = Math.max(0, (fwd - hl - VP.front - 2.5) * 0.7); if (vb < vt) vt = vb; }
    }
    // another moving car ahead, going the same way
    for (let j = 0; j < TRAF_N; j++) {
      if (j === i || TRAF.slot[j] === -2) continue; const oj = j * 6, ex = pose[oj] - x, ez = pose[oj + 1] - z, f = ex * hx + ez * hz;
      if (f <= 0 || f > 28) continue; const s = ex * hz - ez * hx; if ((s < 0 ? -s : s) > 2.2) continue;
      const vb = Math.max(0, (f - hl - D[j * 4] - 2.5) * 0.7); if (vb < vt) vt = vb;
    }
    // speed: gentle, as town traffic is
    const v = TRAF.v[i]; TRAF.v[i] = v < vt ? Math.min(vt, v + 2.2 * dt) : Math.max(vt, v - 6 * dt);
    // move
    const t = TRAF.turn, ti = i * 4;
    if (t[ti] > 0) { const rr = TRAF.off[i] > 0.5 ? TRAF.off[i] : 2.2; t[ti] += TRAF.v[i] * dt / rr; if (t[ti] >= PI) { t[ti] = 0; TRAF.off[i] = TRAF.lane[TRAF.r[i]]; } }
    else { TRAF.u[i] += TRAF.v[i] * dt * TRAF.dir[i]; trafAdvance(i); }
    TRAF.ppose.set(pose.subarray(o, o + 6), o);   // (the pose before this step: rendering interpolates)
    trafPose(i);
  }
}
// restart: the same places every time (the scripted laps are repeatable)
function trafficReset() {
  if (!TRAF.ready) return;
  TRAF.rng = 0x2545f491; TRAF.stepN = 0;
  const V = VEH;
  for (let i = 0; i < TRAF_N; i++) { TRAF.pose[i * 6] = 1e9; TRAF.pose[i * 6 + 1] = 1e9; }   // (nobody placed yet: the places do not depend on the last run)
  for (let i = 0; i < TRAF_N; i++) if (!trafPlace(i, V.x, V.z, 40 + i * 12, 320, 400)) trafPlace(i, V.x, V.z, 0, 1e9, 4000);
}

// ---------- collisions with the player's car ----------
// is (px, pz) inside the box (x, z, yaw, hl, hw)? TQ[8..10] = way out (normal x, z) and depth
function trafBoxQ(px, pz, x, z, yaw, hl, hw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = px - x, dz = pz - z, lx = dx * c + dz * s, lz = -dx * s + dz * c;
  if (lx > hl || lx < -hl || lz > hw || lz < -hw) return false;
  const ex = hl - (lx < 0 ? -lx : lx), ez = hw - (lz < 0 ? -lz : lz);
  if (ex < ez) { const sg = lx > 0 ? 1 : -1; TQ[8] = c * sg; TQ[9] = s * sg; TQ[10] = ex; }
  else { const sg = lz > 0 ? 1 : -1; TQ[8] = -s * sg; TQ[9] = c * sg; TQ[10] = ez; }
  return true;
}
// one box against the player's car: its corners and flanks inside the box, and the box's corners inside the car
function trafHit(x, z, yaw, hl, hw) {
  const V = VEH, P = VP; let hit = false;
  for (let k = 0; k < 8; k++) {
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    const lx = k < 2 ? P.front : k < 4 ? -P.rear : k < 6 ? P.front * 0.35 : -P.rear * 0.35, lz = (k & 1) ? P.halfW : -P.halfW;
    const px = V.x + c * lx - s * lz, pz = V.z + s * lx + c * lz;
    if (!trafBoxQ(px, pz, x, z, yaw, hl, hw)) continue;
    townImpact(TQ[8], TQ[9], TQ[10] + 0.02, c * lx - s * lz, s * lx + c * lz); hit = true;
  }
  const c = Math.cos(yaw), s = Math.sin(yaw), vc = Math.cos(V.yaw), vs = Math.sin(V.yaw);
  for (let k = 0; k < 4; k++) {
    const lx = k & 1 ? hl : -hl, lz = k & 2 ? hw : -hw, px = x + c * lx - s * lz, pz = z + s * lx + c * lz;
    const dx = px - V.x, dz = pz - V.z, ax = dx * vc + dz * vs, az = -dx * vs + dz * vc;
    if (ax > P.front || ax < -P.rear || az > P.halfW || az < -P.halfW) continue;
    const pzs = P.halfW - (az < 0 ? -az : az), pxs = ax > 0 ? P.front - ax : ax + P.rear;
    let nx, nz, d;
    if (pzs < pxs) { const sg = az > 0 ? -1 : 1; nx = -vs * sg; nz = vc * sg; d = pzs; } else { const sg = ax > 0 ? -1 : 1; nx = vc * sg; nz = vs * sg; d = pxs; }
    townImpact(nx, nz, d + 0.02, dx, dz); hit = true;
  }
  return hit;
}
function trafficCollide() {
  if (!TRAF.ready) return;
  const V = VEH, T = TOWN, A = TRAF.pk, c = TRAF.pcell, G = TRAF.pgrid, rad = 8;
  if (V.x > T.x0 + rad && V.z > T.z0 + rad) {
    const gi0 = ((V.x - rad - T.x0) / c) | 0, gi1 = ((V.x + rad - T.x0) / c) | 0, gj0 = ((V.z - rad - T.z0) / c) | 0, gj1 = ((V.z + rad - T.z0) / c) | 0;
    for (let gj = gj0; gj <= gj1; gj++) for (let gi = gi0; gi <= gi1; gi++) {
      if (gi >= TRAF.pgw || gj >= TRAF.pgh) continue; const cell = gj * TRAF.pgw + gi;
      for (let m = G.start[cell]; m < G.start[cell + 1]; m++) {
        const p = G.items[m] * 8, dx = A[p] - V.x, dz = A[p + 1] - V.z; if (dx * dx + dz * dz > 64) continue;
        trafHit(A[p], A[p + 1], A[p + 2], A[p + 3], A[p + 4]);
      }
    }
  }
  const pose = TRAF.pose, D = TRAF.dim;
  for (let i = 0; i < TRAF_N; i++) {
    if (TRAF.slot[i] === -2) continue; const o = i * 6, dx = pose[o] - V.x, dz = pose[o + 1] - V.z; if (dx * dx + dz * dz > 81) continue;
    if (trafHit(pose[o], pose[o + 1], pose[o + 3], D[i * 4], D[i * 4 + 1])) { TRAF.v[i] = 0; TRAF.hold[i] = 3; }
  }
}

// ---------- drawing ----------
// matrices of the moving cars' slots (each frame, interpolated between the last two physics steps)
function trafficPose() {
  if (!TRAF.ready || !TRAF.set) return;
  const al = GS.alpha, P = TRAF.pose, Q = TRAF.ppose;
  for (let i = 0; i < TRAF_N; i++) {
    const s = TRAF.slot[i]; if (s < 0) continue;
    const o = i * 6; let dy = P[o + 3] - Q[o + 3]; if (dy > PI) dy -= TAU; else if (dy < -PI) dy += TAU;
    const x = Q[o] + (P[o] - Q[o]) * al, z = Q[o + 1] + (P[o + 1] - Q[o + 1]) * al, y = Q[o + 2] + (P[o + 2] - Q[o + 2]) * al, yaw = Q[o + 3] + dy * al, pt = Q[o + 4] + (P[o + 4] - Q[o + 4]) * al;
    const m = objModel(s), c = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(pt), sp = Math.sin(pt);
    objPrev(s).set(m);
    // X = heading pitched up the slope, Y = up, Z = right
    m[0] = c * cp; m[1] = sp; m[2] = sn * cp; m[3] = 0;
    m[4] = -c * sp; m[5] = cp; m[6] = -sn * sp; m[7] = 0;
    m[8] = -sn; m[9] = 0; m[10] = c; m[11] = 0;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    const p = objParams(s); p[0] = TRAF.v[i] < 0.5 || TRAF.hold[i] > 0 || (P[o + 5] < Q[o + 5] - 0.01) ? 1 : 0; p[1] = 0; p[2] = 0; p[3] = TRAF.dim[i * 4 + 3];
    p[4] = TRAF.paint[i * 3]; p[5] = TRAF.paint[i * 3 + 1]; p[6] = TRAF.paint[i * 3 + 2]; p[7] = 1;
    // the model of this car (it changes when the car is moved elsewhere)
    const pm = TRAF.pool[TRAF.model[i]], it = TRAF.items[i], gt = TRAF.gitems[i];
    if (it.vb !== pm.body.vb) { it.vb = pm.body.vb; it.ib = pm.body.ib; it.count = pm.body.count; it.cx = pm.body.bounds.c[0]; it.cy = pm.body.bounds.c[1]; it.cz = pm.body.bounds.c[2]; it.r = pm.body.bounds.r; gt.vb = pm.glass.vb; gt.ib = pm.glass.ib; gt.count = pm.glass.count; objPrev(s).set(m); }
  }
}
// builds the GPU side: the material family (the car shader with the garage cars' materials and TRAFFIC), the parked cars
// batched by cell, the pool of models for the moving cars and their slots
async function trafficBuild() {
  trafficPrepare();
  const t0 = performance.now(), fam = TRAF.fam = mkFamily('traffic', { src: 'mat_car', noCube: true, defs: { BCAR: '', OXA: '', RADIAL: '', TRAFFIC: '', PAINT_ALB: 'select(in.col.rgb, O.p1.xyz, O.p1.w > 0.5)', PAINT_MET: '0.55' } });
  const set = TRAF.set = new MeshSet(fam), glass = TRAF.glass = new GlassSet();
  // decode every model once (raw chunks are re-read for each parked car through its own transform)
  const A = TRAF.pk, N = TRAF.pkN, used = new Map();
  for (let i = 0; i < N; i++) { const m = A[i * 8 + 6]; used.set(m, (used.get(m) || 0) + 1); }
  // parked cars, batched by 128 m cells
  const cells = new Map(), C = 128;
  for (let i = 0; i < N; i++) { const kk = Math.floor(A[i * 8] / C) * 100003 + Math.floor(A[i * 8 + 1] / C); let a = cells.get(kk); if (!a) cells.set(kk, a = []); a.push(i); }
  const models = new Map();
  for (const m of used.keys()) models.set(m, await oxaChunks(m));
  let tris = 0;
  for (const list of cells.values()) {
    const mb = new MeshBuilder(1 << 16), gl = new MeshBuilder(1 << 12), t = m4();
    for (const i of list) {
      const o = i * 8, x = A[o], z = A[o + 1], yaw = A[o + 2], y = A[o + 5], pi = A[o + 7], md = models.get(A[o + 6]);
      const paint = pi < 0 ? OXA_CARS[A[o + 6]].meta.car.paint : TRAF_PAINT[pi], c = Math.cos(yaw), s = Math.sin(yaw);
      t.fill(0); t[0] = c; t[2] = s; t[5] = 1; t[8] = -s; t[10] = c; t[12] = x; t[13] = y; t[14] = z; t[15] = 1;
      mb.push(t); gl.push(t); oxaEmit(mb, gl, md, paint, true); mb.pop(); gl.pop();
    }
    const mesh = mb.upload(); set.add(mesh, 0, 3, 180); tris += mesh.count / 3;
    if (gl.ni) glass.add_(gl.upload(), 0);
  }
  // the moving cars: the pool of models (white), with their own slots
  const pick = TRAF.pick;
  for (let p = 0; p < pick.length; p++) {
    const m = pick[p], md = await oxaChunks(m), mb = new MeshBuilder(1 << 14), gl = new MeshBuilder(1 << 10);
    oxaEmit(mb, gl, md, null, false);
    TRAF.pool[p].body = mb.upload(); TRAF.pool[p].glass = gl.upload();
  }
  const free = 64 - R.objCount;
  for (let i = 0; i < TRAF_N; i++) {
    if (i >= free - 1) { TRAF.slot[i] = -2; continue; }   // (no slot left: fewer moving cars)
    const s = TRAF.slot[i] = objSlot(), pm = TRAF.pool[i % TRAF.pool.length];
    TRAF.items[i] = set.add(pm.body, s, 3, 260); glass.add_(pm.glass, s); TRAF.gitems[i] = glass.items[glass.items.length - 1];
  }
  R.drawables.push({ draw(pass, ctx) {
    if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
    if (!TRAF.bg) { if (!fam.bgl3) return; const tex = mkTex(4, 4, 'rgba8unorm-srgb', TU.TB | TU.CD); G.dev.queue.writeTexture({ texture: tex }, new Uint8Array(64).fill(255), { bytesPerRow: 16 }, [4, 4]); TRAF.bg = G.dev.createBindGroup({ layout: fam.bgl3, entries: [{ binding: 0, resource: tex.createView() }] }); }
    pass.setBindGroup(3, TRAF.bg); set.draw(pass, ctx);
  } });
  R.transparents.push(glass);
  if (typeof window !== 'undefined' && window.__cap) window.__cap.traffic = TRAF;   // (for the capture scripts)
  TRAF.stats = { parked: N, cells: cells.size, tris: Math.round(tris), models: used.size, pool: pick.length, slots: TRAF.slot.filter(s => s >= 0).length, ms: Math.round(performance.now() - t0) };
}
if (TRAF.on) queueMicrotask(() => BUILD.push(async () => { if (GAME.mode !== 'test' && GAME.mode !== 'car') await trafficBuild(); }));
