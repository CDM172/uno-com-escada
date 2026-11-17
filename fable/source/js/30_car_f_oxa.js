// Garage cars: the 37 openx-assets vehicles (28_oxa_data.js, made by source/blender/oxa_build.py; models MPL-2.0 AND
// CC-BY-4.0, credits in each car's meta.car.credits). ?car=oxa:<id> drives one of them; the Weston-super-Mare traffic
// (43_traffic.js) parks and drives the others. Each car's data: the mesh in the Blender cars' format (no mirrored chunks,
// no UVs; targets body, glass and one front-right wheel in the wheel frame) and meta.car: name, category, mass, size
// [length, height, width], wheelbase, wheel radius, hubs (FL, FR, RL, RR), steering lock, perf {maxSpeed, maxAcceleration,
// maxDeceleration}, credits, licence, paint. Everything the game needs beyond that is worked out here, the same way for
// all of them: the driver's eyes, the engine, gearbox, grip and brakes (VP, 40_vehicle.js), what the autopilot plans for
// (AIP, 42_ai.js), the dials (51_painel.js) and which engine sound is nearest (50_som.js).

// Per car: the engine sound nearest to it (0 the Uno's four, 16 the DB5's straight six, 32 the V8; -1 electric), the kind of
// engine (p petrol, s sporty petrol, v big petrol V8/V12, d diesel, t truck diesel, e electric motors), the driven wheels
// (f front, r rear, a all four) and the number of forward gears.
const OXA_SPEC = {
  audi_q7_2015: [16, 'd', 'a', 8], audi_tt_2014_roadster: [0, 's', 'a', 6], bmw_x4_2014: [16, 'p', 'a', 8], dacia_duster_2010: [0, 'd', 'f', 6],
  fiat_ducato_2014: [0, 'd', 'f', 6], generic_compact_2007: [0, 'p', 'r', 5], generic_hatchback_2007: [0, 'p', 'f', 6], generic_hatchback_2011: [0, 'p', 'f', 5],
  generic_sedan_1990: [32, 'v', 'r', 4], generic_sedan_1991: [16, 's', 'r', 5], generic_sedan_1994: [0, 'p', 'f', 5], generic_sedan_1995: [32, 'v', 'r', 5],
  generic_sedan_1998: [16, 'p', 'f', 4], generic_sedan_1999: [16, 's', 'r', 6], generic_sedan_2003: [32, 'v', 'r', 6], generic_suv_1965: [0, 'p', 'a', 4],
  generic_van_1992: [0, 'd', 'r', 5], generic_wagon_1980: [0, 'p', 'r', 4], gmc_hummer_2021: [-1, 'e', 'a', 1], honda_prelude_1983: [0, 'p', 'f', 5],
  hyundai_ioniq_5_2022: [-1, 'e', 'a', 1], hyundai_tucson_2015: [0, 'd', 'f', 6], iveco_daily_1982: [0, 'd', 'r', 5], iveco_daily_2019: [0, 'd', 'r', 6],
  mazda_titan_1992: [0, 'd', 'r', 5], mercedes_g_class_2008: [32, 'v', 'a', 7], mercedes_sl65amg_2008_black: [32, 'v', 'r', 5], mercedes_sprinter_2006: [0, 'd', 'r', 5],
  mini_countryman_2017: [0, 'p', 'f', 6], mitsubishi_delica_1986: [0, 'd', 'r', 5], nissan_350z_2003: [16, 's', 'r', 6], nissan_skyline_gtr_1989: [16, 's', 'a', 5],
  shacman_x6000_2019: [16, 't', 'r', 8], tesla_model3_2017: [-1, 'e', 'a', 1], toyota_corolla_2014: [0, 'p', 'f', 6], volvo_ex30_2024: [-1, 'e', 'r', 1],
  volvo_v60_polestar_2013: [16, 's', 'a', 6],
};
// engine kinds: idle, rpm of peak torque, red line (rpm); torque at idle and at the red line as shares of the peak
const OXA_ENG = {
  p: [800, 4200, 6500, 0.62, 0.78], s: [900, 4800, 7200, 0.6, 0.82], v: [700, 3800, 6200, 0.7, 0.75],
  d: [750, 2000, 4500, 0.45, 0.55], t: [600, 1200, 2300, 0.5, 0.7], e: [1, 4500, 14000, 1, 1],
};
// driver's eye over the front axle: the forward-control vans and the truck
const OXA_CABOVER = /^(mitsubishi_delica|iveco_daily_1982|mazda_titan|shacman)/;

// the selected garage car (CARSEL 'oxa' and ?car=oxa:<id>, remembered like the others); an unknown one falls back to the DB5
const OXA = (() => {
  let c = Q.get('car'); if (!c) try { c = localStorage.getItem('car'); } catch (e) { }
  const id = c && c.slice(0, 4) === 'oxa:' ? c.slice(4) : '', n = typeof OXA_CARS === 'undefined' ? 0 : OXA_CARS.length;
  let i = -1; for (let k = 0; k < n; k++) if (OXA_CARS[k].meta.car.id === id) i = k;
  return { i, id, n, vp: null, aip: null, hud: null, snd: 0, ev: 0, credits: '' };
})();
if (CARSEL === 'oxa' && OXA.i < 0) CARSEL = 'db5';

// Physics of garage car k (meta.car): the same model as the other cars (40_vehicle.js), its numbers from the car's data.
// Engine power: enough to hold the top speed against drag and rolling resistance, or to reach 100 km/h in the time
// maxAcceleration gives (with launch, shifts and drag: 72 % of the ideal), whichever is more; a limiter holds maxSpeed.
// Grip and brakes from maxDeceleration, centre of mass at 36 % of the height, the gears spaced evenly from a first gear
// that runs out at about 27 % of the top speed to a top gear that reaches it at peak power.
function oxaVP(k, spec) {
  const [len, H, W] = k.size, L = k.wheelbase, cat = k.category, eng = OXA_ENG[spec[1]], ev = spec[1] === 'e', drv = spec[2], n = spec[3];
  const m = k.mass + 75, g = 9.81, vmax = k.perf.maxSpeed, R = k.wheelR, h = k.hubs;
  const tw = (Math.abs(h[0][2]) + Math.abs(h[1][2]) + Math.abs(h[2][2]) + Math.abs(h[3][2])) / 2;
  const truck = spec[1] === 't', van = cat !== 'car' && !truck, tall = H > 1.6;
  const Cd = truck ? 0.65 : van ? 0.38 : k.id.indexOf('_19') > 0 || k.id.indexOf('_1965') > 0 ? 0.4 : tall ? 0.36 : 0.31;
  const cdA = Cd * 0.82 * (W - 0.15) * (H - 0.1), crr = truck ? 0.007 : ev ? 0.011 : 0.013;
  const eff = ev ? 0.92 : drv === 'a' ? 0.82 : drv === 'r' ? 0.85 : 0.88;
  const pV = 0.5 * 1.2 * cdA * vmax * vmax * vmax + crr * m * g * vmax, t100 = 27.78 / k.perf.maxAcceleration, pA = m * 27.78 * 27.78 / (2 * 0.72 * t100);
  const power = Math.max(pV, pA) / eff;
  const [idle, rT, red, t0, tE] = eng, rMax = red + (ev ? 0 : 200);
  // torque curve (the same expressions as 40_vehicle.js), and the rpm of peak power
  const curve = r => ev ? (r < rT ? 1 : rT / r) : r < rT ? t0 + (1 - t0) * Math.sin(Math.max(0, (r - idle) / (rT - idle)) * PI / 2) : 1 - (1 - tE) * ((r - rT) / (rMax - rT)) ** 2;
  let best = 0, rP = rT; for (let r = idle; r <= red; r += 25) { const p = curve(r) * r; if (p > best) { best = p; rP = r; } }
  const tq = power / (best * PI / 30);
  // gears: overall ratios (final drive 1)
  const gTop = (rP * PI / 30) * R / vmax, v1 = clamp(vmax * 0.27, 10, 18), g1 = ev ? gTop : (red * PI / 30) * R / v1;
  const gears = []; for (let i = 0; i < n; i++) gears.push(n === 1 ? (red * PI / 30) * R / (vmax * 1.03) : g1 * Math.pow(gTop / g1, i / (n - 1)));
  const mu = clamp(k.perf.maxDeceleration / g * 1.05, 0.72, 1.3), fw = ev ? 0.5 : truck ? 0.6 : drv === 'f' ? 0.6 : spec[0] === 0 && drv === 'r' && len < 3 ? 0.42 : van ? 0.55 : 0.53;
  const shiftUp = ev ? 1e9 : Math.min(red - 100, rP * 1.04);
  return {
    m, Izz: m * (len * len + (W - 0.15) * (W - 0.15)) / 12 * 0.9, L, a: L * (1 - fw), b: L * fw, tw, h: H * 0.36, R,
    mu, B: truck ? 6.5 : van ? 8 : 9, C: truck ? 1.5 : 1.42,
    gears, final: 1, rev: ev ? gears[0] : g1 * 1.1, eff, cdA, crr, brakeF: clamp(0.58 + 0.75 * H * 0.36 / L, 0.66, 0.82),   // (more to the front the more the car pitches)
    halfW: (W - 0.18) / 2, front: len / 2, rear: len / 2,
    rwd: drv === 'r', awd: drv === 'a', eng: ev ? 4 : 3, steerLat: mu * g * 0.78, steerMax: k.maxSteer, steerRatio: truck ? 20 : van ? 17 : 15,
    catchK: drv === 'r' ? 0.6 : 0, catchAt: 0.12,
    shiftUp, shiftDn: ev ? 0 : shiftUp * 0.8, rpmIdle: idle, rpmMax: rMax, rpmCut: ev ? rMax : red, launch0: ev ? 0 : idle + 400, launchK: ev ? 0 : (rT - idle - 400) * 0.9,
    engBrake: ev ? 0.06 : clamp(0.012 + 0.04 * (tq - 150) / 400, 0.012, 0.08), brakeG: k.perf.maxDeceleration / g * 1.15, spinLat: 0.5, rollF: 0.55, rollR: 0.45,
    kR: truck ? 40 : van ? 50 : 66, cR: truck ? 6 : van ? 7 : 8.5, rollK: truck ? 0.012 : van ? 0.011 : tall ? 0.009 : 0.0065, rollMax: van || truck ? 0.1 : 0.08,
    diveK: van || truck ? 0.006 : 0.0045, squatK: van || truck ? 0.005 : 0.0038, pitchMax: van || truck ? 0.06 : 0.045,
    // the garage cars' own: torque curve (40_vehicle.js) and the top-speed limiter
    tq, rpmT: rT, tq0: t0, tqE: tE, vLim: vmax, power,
  };
}
if (CARSEL === 'oxa') {
  const k = OXA_CARS[OXA.i].meta.car, spec = OXA_SPEC[k.id] || [0, 'p', 'f', 5], P = OXA.vp = oxaVP(k, spec), g = 9.81;
  // the autopilot: cornering and braking it plans for, as the Aston Martins (one grip budget for both), and its top speed
  OXA.aip = { aLat: P.mu * g * 0.74, aBrk: Math.min(P.brakeG, P.mu) * g * 0.66, vMax: Math.min(P.vLim, 70), over: 0.8, look0: 4.5, lookV: 0.3, aTot: P.mu * g * 0.74, margin: 1.2, slide: 1.5, brakeLat: 0.3 };
  // dials: speedometer to the next 20 km/h above the top speed (at least 160), rev counter to the red line (or the motor's speed)
  const kmh = Math.max(160, Math.ceil(P.vLim * 3.6 / 20 + 0.5) * 20), red = P.rpmCut / 1000;
  OXA.hud = [kmh, P.eng === 4 ? Math.ceil(red / 2) * 2 : Math.ceil(red + 0.5), P.eng === 4 ? 0 : red, P.eng === 4 ? 'motor rpm × 1000' : 'rpm × 1000'];
  OXA.snd = spec[0] < 0 ? 0 : spec[0]; OXA.ev = spec[0] < 0 ? 1 : 0;
  OXA.credits = k.name + ': ' + k.credits.join(' · ') + ' · ' + k.license;
}

// torque curve of the selected garage car (N·m at rpm r): the expressions of vehicleStep (40_vehicle.js), for engineTorque()
function oxaTorque(r) {
  const P = VP;
  if (P.eng === 4) return r < P.rpmT ? P.tq : P.tq * P.rpmT / r;
  if (r < P.rpmT) return P.tq * (P.tq0 + (1 - P.tq0) * Math.sin((r > P.rpmIdle ? (r - P.rpmIdle) / (P.rpmT - P.rpmIdle) : 0) * 1.5707963267948966));
  const u = (r - P.rpmT) / (P.rpmMax - P.rpmT); return P.tq * (1 - (1 - P.tqE) * u * u);
}

// model year, from the id (audi_q7_2015 → 2015)
function oxaYear(id) { const m = id.match(/(19|20)\d\d/); return m ? m[0] : ''; }

// ---- the table of the selected garage car for the Blender cars' loader (30_car_g_bcar.js)
function oxaTable(e) {
  const k = e.meta.car, [len, H, W] = k.size, L = k.wheelbase, cab = OXA_CABOVER.test(k.id), van = k.category !== 'car';
  // left-hand drive: the driver sits on the left (z < 0), the eyes 80 % of the way up the car
  const ex = cab ? L * 0.5 + 0.05 : van ? L * 0.5 - 0.75 : L * 0.5 - 1.45, ey = H * 0.8, ez = -(W - 0.18) * 0.22;
  return {
    id: 'oxa:' + k.id, name: k.name + ' · ' + oxaYear(k.id), meta: e.meta, b64: e.b64, paint: k.paint,
    geom: {
      wheelbase: L, wheelR: k.wheelR, hubs: k.hubs, steerPos: [ex + 0.45, ey - 0.32, ez], steerTilt: van ? 145 : 160, eye: [ex, ey, ez],
      bonnetCam: [ex + (van ? 0.55 : 0.9), ey - 0.06, 0], half: { w: (W - 0.18) / 2, front: len / 2, rear: len / 2 }, bumper: 0,
    },
    // shaders: the Blender cars' materials with the garage cars' own (#ifdef OXA): paint from the vertex colour (the car's
    // colour, written in by the loader), radial tyres
    defs: { OXA: '', RADIAL: '', PAINT_ALB: 'in.col.rgb', PAINT_MET: '0.55' },
    AT: {}, PAINT: {}, DIAL: null, cutout: [],
    targets: { body: ['body', 3], wheel: ['wheel', 3] },
    slots: [],
    pivots() { SND.car = OXA.snd; SND.ev = OXA.ev; },   // (called once the mesh is decoded: the engine sound nearest to this car)
    params: null, parts() { },
    viewCam: [len * 0.95, Math.max(1.5, H * 0.85), -len * 0.8, 0.1, H * 0.42, 0, 0.5],
  };
}
const BC_OXA = CARSEL === 'oxa' ? oxaTable(OXA_CARS[OXA.i]) : null;

// ---- any garage car as plain meshes (the Weston-super-Mare traffic): body and the four wheels in the car's frame, the
// paint colour written into the vertex colours (paint = null: left white, for a colour per object slot); glass apart.
// Wheels: the one wheel of the data at the four hubs, turned round on the left. lowWheel: a plain 12-sided wheel instead
// (parked cars far away: a fifth of the triangles). Returns {mb, glass, tris}.
async function oxaMeshes(i, paint, lowWheel) {
  const e = OXA_CARS[i], M = e.meta, k = M.car, sc = 1 / M.scale, buf = await bcInflate(e.b64);
  const mb = new MeshBuilder(1 << 13), gl = new MeshBuilder(1 << 10), wheel = []; let off = 0;
  const emit = (dst, ch, pos, nrm, idx, c) => {
    const v0 = dst.nv; dst.mat(ch.id, ch.a || 0); dst.color(c[0], c[1], c[2]);
    for (let q = 0; q < ch.nv; q++) dst.v(pos[q * 3] * sc, pos[q * 3 + 1] * sc, pos[q * 3 + 2] * sc, nrm[q * 4], nrm[q * 4 + 1], nrm[q * 4 + 2], 1, 0);
    for (let q = 0; q < ch.ni; q += 3) dst.tri(v0 + idx[q], v0 + idx[q + 1], v0 + idx[q + 2]);
  };
  for (const ch of M.chunks) {
    const nv = ch.nv, ni = ch.ni;
    const pos = new Int16Array(buf, off, nv * 3); off = (off + nv * 6 + 3) & ~3;
    const nrm = new Int8Array(buf, off, nv * 4); off += nv * 4;
    if (ch.uv) off += nv * 8;
    const idx = ch.i32 ? new Uint32Array(buf, off, ni) : new Uint16Array(buf, off, ni); off = (off + ni * (ch.i32 ? 4 : 2) + 3) & ~3;
    const c = ch.id === 20 && paint ? paint : ch.c || [1, 1, 1];
    if (ch.t === 'wheel') { if (!lowWheel) wheel.push([ch, pos, nrm, idx, c]); }
    else emit(ch.t === 'glass' ? gl : mb, ch, pos, nrm, idx, c);
  }
  // the four wheels, baked in (the wheel frame: axle along Z, outer face +Z; on the left turned half round about Y)
  const t = m4();
  for (let w = 0; w < 4; w++) {
    const hb = k.hubs[w], left = (w & 1) === 0;
    t.fill(0); t[0] = left ? -1 : 1; t[5] = 1; t[10] = left ? -1 : 1; t[15] = 1; t[12] = hb[0]; t[13] = hb[1]; t[14] = hb[2];
    mb.push(t);
    if (lowWheel) oxaLowWheel(mb, k.wheelR);
    else for (const [ch, pos, nrm, idx, c] of wheel) emit(mb, ch, pos, nrm, idx, c);
    mb.pop();
  }
  return { mb, glass: gl, tris: (mb.ni + gl.ni) / 3 };
}
// a plain wheel in the wheel frame: 12-sided tyre (tread and both walls) and a silver disc on the outer face
function oxaLowWheel(mb, R) {
  const n = 12, w = Math.max(0.09, R * 0.33), r0 = R * 0.62;
  mb.mat(21, 0); mb.color(0.025, 0.025, 0.027);
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    mb.quad(R * c0, R * s0, -w, R * c1, R * s1, -w, R * c1, R * s1, w, R * c0, R * s0, w);                       // tread
    mb.quad(r0 * c0, r0 * s0, -w, r0 * c1, r0 * s1, -w, R * c1, R * s1, -w, R * c0, R * s0, -w);                // inner wall
    mb.quad(R * c0, R * s0, w, R * c1, R * s1, w, r0 * c1, r0 * s1, w, r0 * c0, r0 * s0, w);                    // outer wall
  }
  mb.mat(7, 1); mb.color(0.78, 0.78, 0.8);
  const c0 = mb.v(0, 0, w * 0.8, 0, 0, 1, 0, 0);
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
    const p = mb.v(r0 * Math.cos(a0), r0 * Math.sin(a0), w * 0.9, 0, 0, 1, 0, 0), q = mb.v(r0 * Math.cos(a1), r0 * Math.sin(a1), w * 0.9, 0, 0, 1, 0, 0);
    mb.tri(c0, p, q);
  }
}
