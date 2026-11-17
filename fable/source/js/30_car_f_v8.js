// Aston Martin V8 Vantage (1987), the winterised hardtop: the table the shared loader of the cars modelled in Blender
// (30_car_g_bcar.js) needs to build it from 29_v8_data.js — which object each target of the export belongs to, how the
// decal atlas is painted, where the pivots of the gadget parts are and how those parts move (their positions come from
// the gadget logic: GAD.v and GAD.mis, 41_gadgets_v8.js). Sizes come from V8_META.car, pivots from V8_META.targets, and
// what neither gives from the bounds of the meshes.
// Without the mesh (no 29_v8_data.js in this build) the V8 cannot be chosen: the DB5 stands in, and the start screen
// does not offer it.
if (CARSEL === 'v8' && typeof V8_META === 'undefined') CARSEL = 'db5';

// Travel of the gadget parts (metres, radians): rear plate flips down 95°, fog-lamp covers tip forwards 100°, missiles slide
// 0.25 m forwards before they go, lasers telescope 8 cm out of the hubs, skis 35 cm out and 3 cm down, booster nozzle 6 cm
// back; studs are modelled out (scale 1) and hide at a radial scale of 0.955
const V8G = { plateFlip: 1.658, coverSwing: 1.745, misSlide: 0.25, laserOut: 0.08, skiOut: 0.35, skiDrop: 0.03, nozzleOut: 0.06, spikeIn: 0.955, spikeOut: 0.012 };
// ---- decal atlas: regions (u0, v0, u1, v1; v down). Mirrors AT in source/blender/v8_parts.py — keep the two in step.
const V8_AT = {
  plate_f: [0, 0, 0.5, 0.11], plate_r: [0, 0.125, 0.5, 0.235], plate_x: [0, 0.25, 0.5, 0.36],   // number plates: front (white), rear (yellow), spare
  dials: [0, 0.40, 0.80, 0.62], hud: [0.52, 0, 0.76, 0.18], panel: [0.78, 0, 1.0, 0.33],      // instruments, head-up display, gadget switches
  badge: [0.52, 0.20, 0.76, 0.27], script: [0.52, 0.29, 0.76, 0.36],                         // (badge unused), "V8" lettering
  radio: [0, 0.64, 0.40, 0.74], clock: [0.82, 0.40, 0.98, 0.56],
};
const V8_PLATE_TEXT = 'B549 WUU';
// the two big dials (fractions of the region: centre x, centre y, radius / height); their needles are drawn by the shader
const V8_DIAL = { speedo: [0.335, 0.5, 0.43], tacho: [0.665, 0.5, 0.43], a0: 135, sweep: 270, mph: 170, rpm: 8000 };
// Head-up display, in fractions of its region (s across, t down) — wgsl/glow.wgsl fills the boxes and bars with the same
// numbers: reticle [centre s, t, radius in t], missile bays left and right, reload bar, laser box, booster bar [s0, t0, s1, t1]
const V8_HUDL = { ret: [0.5, 0.4, 0.2], mslL: [0.07, 0.72, 0.155, 0.86], mslR: [0.185, 0.72, 0.27, 0.86], reload: [0.07, 0.9, 0.27, 0.95], laser: [0.73, 0.72, 0.93, 0.86], boost: [0.37, 0.8, 0.63, 0.88] };
const V8_PAINT = {
  plate_f(g, w, h, key) {
    // British reflective plates of the 1980s: white at the front, yellow at the back, black characters
    g.fillStyle = key === 'plate_r' ? '#f0bf16' : '#f2f1ea'; g.fillRect(0, 0, w, h);
    g.lineWidth = h * 0.03; g.strokeStyle = '#1b1b1b'; g.beginPath(); g.roundRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1, h * 0.07); g.stroke();
    bcText(g, V8_PLATE_TEXT, w / 2, h * 0.54, h * 0.7, w * 0.84, '700 ', '#141414');
  },
  plate_r(g, w, h, key) { V8_PAINT.plate_f(g, w, h, key); },
  dials(g, w, h) {
    // a 1980s British GT binnacle: speedometer and rev counter, oil pressure, water temperature, fuel, oil temperature
    g.fillStyle = '#070708'; g.fillRect(0, 0, w, h);
    const D = V8_DIAL, R = D.speedo[2] * h;
    bcDial(g, D.speedo[0] * w, D.speedo[1] * h, R, 0, D.mph, 20, 10, 'MPH');
    bcDial(g, D.tacho[0] * w, D.tacho[1] * h, R, 0, D.rpm, 1000, 500, 'RPM x 1000', { div: 1000, red: 6500, num: 0.2 });
    const r = h * 0.2, xl = D.speedo[0] * w - R - r * 1.25, xr = D.tacho[0] * w + R + r * 1.25, o = { a0: 215, sweep: 110, plain: true };
    bcDial(g, xl, h * 0.27, r, 0, 4, 2, 1, 'OIL', Object.assign({ needle: 2.6 }, o));
    bcDial(g, xl, h * 0.73, r, 0, 4, 2, 1, 'WATER', Object.assign({ needle: 1.9 }, o));
    bcDial(g, xr, h * 0.27, r, 0, 4, 2, 1, 'FUEL', Object.assign({ needle: 3.1 }, o));
    bcDial(g, xr, h * 0.73, r, 0, 4, 2, 1, 'OIL °C', Object.assign({ needle: 1.7 }, o));
    const lamps = ['#d8351c', '#2fae4a', '#e0a020', '#2a6fe0'];
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(w / 2 + (i - 1.5) * h * 0.07, h * 0.72, h * 0.02, 0, TAU); g.fillStyle = lamps[i]; g.fill(); g.lineWidth = h * 0.008; g.strokeStyle = '#9aa0a8'; g.stroke(); }
  },
  hud(g, w, h) {
    // head-up display, as masks: red = always shown, green = the self-destruct warning (the shader lights them in green
    // and fills the boxes and bars itself)
    const L = V8_HUDL, red = 'rgb(255,0,0)';
    g.clearRect(0, 0, w, h); g.strokeStyle = red; g.fillStyle = red; g.lineWidth = h * 0.012; g.lineCap = 'round';
    const cx = L.ret[0] * w, cy = L.ret[1] * h, r = L.ret[2] * h;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.12, 0, TAU); g.fill();
    for (let k = 0; k < 4; k++) { const a = k * PI / 2, c = Math.cos(a), s = Math.sin(a); g.beginPath(); g.moveTo(cx + c * r * 0.55, cy + s * r * 0.55); g.lineTo(cx + c * r * 1.35, cy + s * r * 1.35); g.stroke(); }
    for (let k = 0; k < 36; k++) { const a = k * TAU / 36, c = Math.cos(a), s = Math.sin(a), l = k % 9 === 0 ? 0.0 : k % 3 === 0 ? 0.88 : 0.93; if (l) { g.beginPath(); g.moveTo(cx + c * r * l, cy + s * r * l); g.lineTo(cx + c * r, cy + s * r); g.stroke(); } }
    const bx = r * 1.9, by = r * 1.35, bl = r * 0.4;   // corner brackets
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * bx, cy + sy * (by - bl)); g.lineTo(cx + sx * bx, cy + sy * by); g.lineTo(cx + sx * (bx - bl), cy + sy * by); g.stroke(); }
    const box = b => g.strokeRect(b[0] * w, b[1] * h, (b[2] - b[0]) * w, (b[3] - b[1]) * h);
    g.lineWidth = h * 0.008; box(L.mslL); box(L.mslR); box(L.reload); box(L.laser); box(L.boost);
    const lab = (t, b) => bcText(g, t, (b[0] + b[2]) / 2 * w, b[1] * h - h * 0.05, h * 0.065, (b[2] - b[0] + 0.1) * w, '700 ', red);
    lab('MISSILES', [L.mslL[0], L.mslL[1], L.mslR[2]]); lab('LASER', L.laser); lab('BOOST', L.boost);
    bcText(g, 'RANGE', L.ret[0] * w + r * 2.35, cy - r * 1.2, h * 0.05, 0, '700 ', red);   // range scale beside the reticle
    for (let k = 0; k <= 8; k++) { const y = cy - r * 1.05 + k * r * 2.1 / 8, x = L.ret[0] * w + r * 2.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (k % 4 ? r * 0.12 : r * 0.26), y); g.stroke(); }
    bcText(g, 'SELF-DESTRUCT', w / 2, h * 0.1, h * 0.085, w * 0.6, '700 ', 'rgb(0,255,0)');
  },
  script(g, w, h) {
    // "V8" in plain chrome letters on transparent
    g.font = '700 ' + Math.round(h * 0.82) + 'px ' + _sans; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText('V8').width, k = Math.min(1, w * 0.94 / tw);
    g.save(); g.translate(w / 2, h * 0.54); g.scale(k, 1);
    g.lineJoin = 'round'; g.lineWidth = h * 0.08; g.strokeStyle = '#6a7078'; g.strokeText('V8', 0, 0);
    g.fillStyle = bcChrome(g, 0, -h * 0.4, 0, h * 0.4); g.fillText('V8', 0, 0); g.restore();
  },
  panel(g, w, h) {
    // the gadget switches on the console: a row of guarded toggles and push buttons with their lamps
    g.fillStyle = '#0a0a0b'; g.fillRect(0, 0, w, h);
    g.lineWidth = Math.max(1, w * 0.012); g.strokeStyle = '#8a9098'; g.strokeRect(w * 0.03, w * 0.03, w - w * 0.06, h - w * 0.06);
    const names = ['LASER', 'MISSILE', 'ARM', 'SPIKES', 'SKIS', 'LAMPS', 'BOOST', 'HORN', 'DESTRUCT'], cols = 3, rows = 3, cw = w / cols, ch = h / rows, r = Math.min(cw, ch) * 0.2;
    for (let i = 0; i < names.length; i++) {
      const cx = (i % cols + 0.5) * cw, cy = (Math.floor(i / cols) + 0.4) * ch, push = i === 1 || i === 6 || i === 8;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = bcChrome(g, cx - r, cy - r, cx + r, cy + r); g.fill();
      if (push) { g.beginPath(); g.arc(cx, cy, r * 0.68, 0, TAU); g.fillStyle = i === 8 ? '#c5281a' : '#1a1b1d'; g.fill(); }
      else { g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fillStyle = '#2a2c2f'; g.fill(); g.lineCap = 'round'; g.lineWidth = r * 0.42; g.strokeStyle = '#d9dde1'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.25, cy - r * 0.95); g.stroke(); g.lineCap = 'butt'; }
      g.beginPath(); g.arc(cx + cw * 0.3, cy - ch * 0.22, r * 0.2, 0, TAU); g.fillStyle = i % 2 ? '#e0a020' : '#d8351c'; g.fill();
      bcText(g, names[i], cx, cy + r + ch * 0.13, ch * 0.12, cw * 0.86, '700 ', '#e8eaea');
    }
  },
  radio(g, w, h) {
    // 1980s radio-cassette: black face, green display, cassette door, push buttons and two knobs
    g.fillStyle = '#0d0e10'; g.beginPath(); g.roundRect(0, 0, w, h, h * 0.08); g.fill();
    const kr = h * 0.28;
    for (const x of [h * 0.45, w - h * 0.45]) { g.beginPath(); g.arc(x, h / 2, kr, 0, TAU); g.fillStyle = '#2a2c30'; g.fill(); g.lineWidth = Math.max(1, h * 0.03); g.strokeStyle = '#8c9096'; g.stroke(); }
    const x0 = h * 0.9, x1 = w - h * 0.9;
    g.fillStyle = '#071a0c'; g.fillRect(x0, h * 0.14, (x1 - x0) * 0.42, h * 0.36);
    bcText(g, '98.6', x0 + (x1 - x0) * 0.21, h * 0.33, h * 0.26, (x1 - x0) * 0.38, '700 ', '#5dff8a');
    g.fillStyle = '#1c1e22'; g.fillRect(x0 + (x1 - x0) * 0.48, h * 0.16, (x1 - x0) * 0.52, h * 0.3);
    g.fillStyle = '#3a3d42'; g.fillRect(x0 + (x1 - x0) * 0.5, h * 0.28, (x1 - x0) * 0.48, h * 0.05);
    const bw = (x1 - x0) / 6;
    for (let i = 0; i < 6; i++) { g.fillStyle = '#2c2f34'; g.beginPath(); g.roundRect(x0 + i * bw + bw * 0.1, h * 0.6, bw * 0.8, h * 0.26, h * 0.04); g.fill(); bcText(g, String(i + 1), x0 + (i + 0.5) * bw, h * 0.73, h * 0.14, 0, '700 ', '#c8ccd2'); }
  },
  clock(g, w, h) { DB5_PAINT.clock(g, w, h); },
};
const BC_V8 = {
  id: 'v8', name: 'Aston Martin V8 Vantage · 1987',
  meta: typeof V8_META !== 'undefined' ? V8_META : null, b64: typeof V8_B64 !== 'undefined' ? V8_B64 : null,
  // geometry when the export has no V8_META.car (the values of the first export): wheelbase 2.61 m, track 1.5 m, 255/60 VR15
  // tyres, 4.67 × 1.83 m
  geom: {
    wheelbase: 2.61, wheelR: 0.352, hubs: [[1.305, 0.352, -0.75], [1.305, 0.352, 0.75], [-1.305, 0.352, -0.75], [-1.305, 0.352, 0.75]],
    steerPos: [-0.1, 0.83, 0.37], steerTilt: 158, eye: [-0.62, 1.12, 0.37], bonnetCam: [0.66, 1.08, 0],
    half: { w: 0.905, front: 2.212, rear: 2.392 }, bumper: 0.09,
  },
  // shader defines: the V8's materials (#ifdef V8) and its paint, Cumberland Grey metallic (V8_META.car.paint replaces it)
  defs: { V8: '', RADIAL: '', PAINT_ALB: typeof V8_META !== 'undefined' && V8_META.car && V8_META.car.paint ? 'vec3f(' + V8_META.car.paint.map(x => +x).join(', ') + ')' : 'vec3f(0.06, 0.068, 0.07)', PAINT_MET: '0.75' },
  AT: V8_AT, PAINT: V8_PAINT, DIAL: V8_DIAL, cutout: ['badge', 'script'],
  // which object each target of the export belongs to and in which passes it is drawn (1 main, 2 shadow), with options:
  // glass (transparent), glow (light in the transparent pass, with that material id), split (mirrored, the halves move apart)
  targets: {
    body: ['body', 3], driver: ['body', 3], lampglass: ['body', 3, { glass: 1 }], wheel: ['wheel', 3], wheelblur: ['wheel', 1], steer: ['steer', 3], head: ['head', 3],
    foglamp: ['foglamp', 3, { split: 1 }], missile: ['missile', 3, { split: 1 }], laser: ['laser', 3], ski: ['ski', 3, { split: 1 }],
    spikes: ['spikes', 3], plateR: ['plateR', 3], rocket: ['rocket', 3], muzzle: ['rocket', 1], hud: ['hud', 1, { glow: 30 }],   // (muzzle: the booster's flame)
  },
  // object slots of the moving parts: name and count (left, right for the split ones), or the wheels the part turns with
  slots: [['plateR', 1], ['foglamp', 2], ['missile', 2], ['laser', [0, 1]], ['beam', [0, 1]], ['spikes', [0, 1, 2, 3]], ['ski', 2], ['rocket', 1], ['hud', 1], ['head', 1]],
  pivots: v8Pivots, params: v8Params, parts: v8Parts, extra: v8Extra,
  viewCam: [4.8, 1.5, -4.0, 0.1, 0.6, 0, 0.5],   // car viewer (?scene=car)
};
// Pivots and effect points, from V8_META.targets and the bounds of the meshes. BCD.piv:
//   0, 1 hinge of the rear plate (x, y)   2, 3 hinge of the fog-lamp covers   4, 5, 6 centre of the right missile (x, y, z)
//   7, 8, 9 exit of the booster nozzle   10 lasers: 1 modelled inside the hub (they move out), -1 modelled out
//   11 tip of the lasers when out (z, wheel frame)   12 skis: 1 modelled stowed, -1 modelled out
//   13, 14 radial scale of the studs retracted, out   15, 16 which way the plate and the covers turn
function v8Pivots() {
  const T = BC_V8.meta.targets || {}, bb = BCD.bb, P = BCD.piv, body = bb.body || [-2.42, 2.26, 0.2, 1.33, -0.915, 0.915, 0, 0.915];
  const B = n => bb[n] || null, mid = (b, i) => (b[i] + b[i + 1]) / 2, pv = n => T[n] && T[n].pivot;
  // rear plate: hinged at its bottom edge, flips down and back (a hinge above its middle would swing the bottom back)
  let b = B('plateR'), p = pv('plateR');
  P[0] = p ? p[0] : b ? mid(b, 0) : body[0] + 0.05; P[1] = p ? p[1] : b ? b[2] : 0.5; P[15] = b && P[1] > mid(b, 2) ? -1 : 1;
  // fog-lamp covers: the far edge swings forwards (down and forwards with a hinge below, up and forwards with one above)
  b = B('foglamp'); p = pv('foglamp');
  P[2] = p ? p[0] : b ? mid(b, 0) : body[1] - 0.1; P[3] = p ? p[1] : b ? b[2] : 0.35; P[16] = b && P[3] > mid(b, 2) ? 1 : -1;
  // missiles: centre
  b = B('missile'); p = pv('missile');
  P[4] = p ? p[0] : b ? mid(b, 0) : body[1] - 0.45; P[5] = p ? p[1] : b ? mid(b, 2) : 0.4;
  P[6] = p && Math.abs(p[2]) > 0.05 ? Math.abs(p[2]) : b ? (b[6] + b[7]) / 2 : 0.55;
  // booster nozzle: its exit
  b = B('rocket'); p = pv('rocket');
  P[7] = p ? p[0] : b ? b[0] : body[0] + 0.05; P[8] = p ? p[1] : b ? mid(b, 2) : 0.5; P[9] = p ? p[2] : b ? mid(b, 4) : 0;
  // lasers (wheel frame): modelled out of the hub or tucked into it
  const w = B('wheel'), l = B('laser');
  P[10] = l && w && l[5] > w[5] + 0.02 ? -1 : 1;
  P[11] = (l ? l[5] : w ? w[5] : 0.1) + (P[10] > 0 ? V8G.laserOut : 0);
  // skis: modelled stowed under the sills or out
  const s = B('ski'); P[12] = s && s[7] > BCG.halfW + 0.02 ? -1 : 1;
  // studs (wheel frame): radial scale that hides them in the tread, and that shows them (1 when they are modelled out)
  const k = B('spikes'), rm = k ? Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2]), Math.abs(k[3])) : BCG.wheelR;
  P[14] = rm > BCG.wheelR + 0.005 ? 1 : (BCG.wheelR + V8G.spikeOut) / rm; P[13] = P[14] * V8G.spikeIn;
  // where the effects of the gadgets are born (GPT of 41_gadgets.js): 0, 1 missiles left and right, 2 booster nozzle,
  // 3 middle of the car (self-destruct), 4, 5 tips of the lasers on the left and right front hubs
  const h = BCG.hubs;
  GPT.set([P[4], P[5], -P[6], P[4], P[5], P[6], P[7], P[8], P[9], mid(body, 0), mid(body, 2), 0,
    h[0][0], h[0][1], h[0][2] - P[11], h[1][0], h[1][1], h[1][2] + P[11]]);
}
// fixed parameters for the shaders: where the head-up display is in the atlas
function v8Params() { const p = objParams(CAR.S.hud[0]), r = V8_AT.hud; p[4] = r[0]; p[5] = r[1]; p[6] = r[2]; p[7] = r[3]; }
// meshes the game makes itself: the laser beam (a cylinder one metre long along +Z, stretched to the beam's length), and a
// head-up display in front of the driver's eyes when the export has none
function v8Extra() {
  const out = [], mb = new MeshBuilder(64), n = 12, r = 0.03;
  mb.mat(29, 0).color(1, 0.1, 0.05);
  for (let i = 0; i <= n; i++) { const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a); mb.v(c * r, s * r, 0, c, s, 0, i / n, 0); mb.v(c * r, s * r, 1, c, s, 0, i / n, 1); }
  for (let i = 0; i < n; i++) { const a = i * 2; mb.quadI(a, a + 2, a + 3, a + 1); }
  out.push({ mb, slot: 'beam', flags: 1, glass: false, glow: true, side: -1 });
  if (!BCD.bb.hud) {
    const e = BCG.eye, t = V8_AT.hud, x = e[0] + 0.55, y = e[1] - 0.09, z = e[2], hw = 0.13, hh = 0.075, m = new MeshBuilder(16);
    m.mat(30, 0).color(1, 1, 1);
    m.quad(x, y - hh, z - hw, x, y - hh, z + hw, x, y + hh, z + hw, x, y + hh, z - hw, t[0], t[3], t[2], t[1]);
    out.push({ mb: m, slot: 'hud', flags: 1, glass: false, glow: true, side: -1 });
    BCD.aspect.hud = hw / hh;
  }
  return out;
}
// The gadget parts. Positions are interpolated between the last two physics steps like the car itself (GS.alpha).
function v8Parts(body) {
  const C = CAR, S = C.S, L = C._l, q = BCQ, P = BCD.piv, v = GAD.v, pv = GAD.pv, al = GS.alpha, M = GAD.mis;
  // rear number plate: flips down about its bottom edge
  let x = pv[V8_PLATE] + (v[V8_PLATE] - pv[V8_PLATE]) * al; x = x * x * (3 - 2 * x);
  q[0] = P[15] * x * V8G.plateFlip; q[1] = P[0]; q[2] = P[1]; bcRotZQ(L); bcPut(S.plateR[0], body, L);
  // booster nozzle: out behind the plate
  x = pv[V8_NOZZLE] + (v[V8_NOZZLE] - pv[V8_NOZZLE]) * al; x = x * x * (3 - 2 * x);
  q[0] = -x * V8G.nozzleOut; q[1] = 0; q[2] = 0; bcMoveQ(L); bcPut(S.rocket[0], body, L);
  { const p = objParams(S.rocket[0]), b = pv[V8_BURN] + (v[V8_BURN] - pv[V8_BURN]) * al; p[0] = b; p[1] = b; p[2] = (RT[0] * 23.17) % 1; }   // its flame (material 28)
  // outrigger skis: out of the sills, to each side
  x = pv[V8_SKI] + (v[V8_SKI] - pv[V8_SKI]) * al; x = x * x * (3 - 2 * x);
  const ks = P[12] > 0 ? x * V8G.skiOut : -(1 - x) * V8G.skiOut;
  q[0] = 0; q[1] = -x * V8G.skiDrop; q[2] = -ks; bcMoveQ(L); bcPut(S.ski[0], body, L);
  q[2] = ks; bcMoveQ(L); bcPut(S.ski[1], body, L);
  // fog-lamp covers, and the missiles behind them
  for (let s = 0; s < 2; s++) {
    x = pv[V8_COVL + s] + (v[V8_COVL + s] - pv[V8_COVL + s]) * al; x = x * x * (3 - 2 * x);
    q[0] = P[16] * x * V8G.coverSwing; q[1] = P[2]; q[2] = P[3]; bcRotZQ(L); bcPut(S.foglamp[s], body, L);
    const o = s * 16, st = M[o + MS_STATE], ms = S.missile[s];
    if (st === 3) { bcHide(ms); continue; }
    if (st < 2) {   // in its tube; slides forwards once the cover is out of the way
      const sl = pv[V8_MSLL + s] + (v[V8_MSLL + s] - pv[V8_MSLL + s]) * al; q[0] = sl * sl * (3 - 2 * sl) * V8G.misSlide; q[1] = 0; q[2] = 0; bcMoveQ(L); bcPut(ms, body, L);
      objParams(ms)[0] = 0; continue;
    }
    { const p = objParams(ms); p[0] = 1; p[3] = 9; }   // the red tip glows in flight (material 22/1)
    // in flight: from where it left, along the car's forward axis at the launch, turning slowly about its own axis
    const d = M[o + MS_PDIST] + (M[o + MS_DIST] - M[o + MS_PDIST]) * al, yaw = M[o + MS_YAW], pit = M[o + MS_PITCH];
    const c = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), ra = d * 0.08, cr = Math.cos(ra), sr = Math.sin(ra);
    const Xx = c * cp, Xy = sp, Xz = sn * cp, Yx = -c * sp, Yy = cp, Yz = -sn * sp, Zx = -sn, Zz = c;
    const Ux = Yx * cr + Zx * sr, Uy = Yy * cr, Uz = Yz * cr + Zz * sr, Wx = Zx * cr - Yx * sr, Wy = -Yy * sr, Wz = Zz * cr - Yz * sr;
    const cx = P[4], cy = P[5], cz = s ? P[6] : -P[6];
    const px = M[o + MS_P0] + M[o + MS_DIR] * d, py = M[o + MS_P0 + 1] + M[o + MS_DIR + 1] * d, pz = M[o + MS_P0 + 2] + M[o + MS_DIR + 2] * d;
    const m = objModel(ms); objPrev(ms).set(m);
    m[0] = Xx; m[1] = Xy; m[2] = Xz; m[3] = 0; m[4] = Ux; m[5] = Uy; m[6] = Uz; m[7] = 0; m[8] = Wx; m[9] = Wy; m[10] = Wz; m[11] = 0;
    m[12] = px - (Xx * cx + Ux * cy + Wx * cz); m[13] = py - (Xy * cx + Uy * cy + Wy * cz); m[14] = pz - (Xz * cx + Uz * cy + Wz * cz); m[15] = 1;
  }
  // lasers: the emitters telescope out of the front hubs; the beams are stretched to their length
  x = pv[V8_LASER] + (v[V8_LASER] - pv[V8_LASER]) * al; x = x * x * (3 - 2 * x);
  for (let i = 0; i < 2; i++) {
    const ls = S.laser[i], bs = S.beam[i];
    if (x <= 0) bcHide(ls);
    else { q[0] = 0; q[1] = 0; q[2] = P[10] > 0 ? x * V8G.laserOut : -(1 - x) * V8G.laserOut; bcMoveQ(L); bcPut(ls, objModel(C.slotWheel[S.laser.wheels[i]]), L); }
    { const p = objParams(ls); p[0] = v[V8_BEAM]; p[3] = 9; }   // the red lens at the tip glows while it fires (material 22/1)
    if (v[V8_BEAM] <= 0) { bcHide(bs); continue; }
    L.fill(0); L[0] = 1; L[5] = 1; L[10] = v[V8_BEAML + i]; L[14] = P[11]; L[15] = 1;   // T(0, 0, tip) · S(1, 1, length)
    bcPut(bs, objModel(C.slotWheel[S.beam.wheels[i]]), L); objParams(bs)[0] = 1;
  }
  // spiked tyres: the studs come out of the treads, turning with the wheels
  x = pv[V8_SPIKE] + (v[V8_SPIKE] - pv[V8_SPIKE]) * al;
  for (let i = 0; i < 4; i++) {
    const ss = S.spikes[i];
    if (x <= 0) { bcHide(ss); continue; }
    const k = P[13] + (P[14] - P[13]) * x * x * (3 - 2 * x); L.fill(0); L[0] = k; L[5] = k; L[10] = 1; L[15] = 1;
    bcPut(ss, objModel(C.slotWheel[S.spikes.wheels[i]]), L);
  }
  // head-up display: in the cockpit view, while a weapon is in use (O.p0, O.p2: what it shows — wgsl/glow.wgsl)
  const hs = S.hud[0], fade = pv[V8_HUD] + (v[V8_HUD] - pv[V8_HUD]) * al;
  if (fade <= 0 || GS.cam !== 3 || GS.freeCam) bcHide(hs);
  else {
    L.fill(0); L[0] = L[5] = L[10] = L[15] = 1; bcPut(hs, body, L);
    const p = objParams(hs); p[0] = M[MS_STATE] === 0 ? 1 : 0; p[1] = M[16 + MS_STATE] === 0 ? 1 : 0; p[2] = v[V8_RELOAD]; p[3] = v[V8_CHARGE];
    p[8] = fade; p[9] = v[V8_DESTRUCT]; p[10] = v[V8_BEAM];
  }
}
