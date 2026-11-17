// Aston Martin DB5 (1964): the table the shared loader of the cars modelled in Blender (30_car_g_bcar.js) needs to build it
// from 29_db5_data.js — which object each target of the export belongs to, how the decal atlas is painted, where the
// pivots of the gadget parts are and how those parts move (their positions come from the gadget logic: GAD.v, 41_gadgets.js).
// Nothing here knows the shape of the car: sizes come from DB5_META.car when the export has it, pivots from
// DB5_META.targets, and the points where effects are born from the bounds of the meshes.

// Travel of the gadget parts (metres, radians). Pivots come from DB5_META.targets; the plane of the shield from its mesh.
const DB5G = { lampFold: 1.62, gunSlide: 0.16, shieldLift: 0.46, slashOut: 0.14, ramOut: 0.22 };
// ---- decal atlas: regions (u0, v0, u1, v1; v down). Mirrors AT in source/blender/db5_interior.py — keep the two in step.
const DB5_AT = {
  plate0: [0, 0, 0.5, 0.11], plate1: [0, 0.125, 0.5, 0.235], plate2: [0, 0.25, 0.5, 0.36],
  dials: [0, 0.40, 0.80, 0.62], radar: [0.52, 0, 0.76, 0.18], panel: [0.78, 0, 1.0, 0.33],
  wings: [0.52, 0.20, 0.76, 0.27], script: [0.52, 0.29, 0.76, 0.36], radio: [0, 0.64, 0.40, 0.74], clock: [0.82, 0.40, 0.98, 0.56],
};
const DB5_PLATES = ['BMT 216A', '4711-EA-62', 'LU 6789'];   // UK, France, Switzerland
// Where the shader finds the moving parts of the atlas, in the painters' own units (fractions of the region): the two big
// dials [centre x, centre y, radius / height] and the radar screen. The needles are drawn by the shader (see bcarPlace()).
const DB5_DIAL = { speedo: [0.335, 0.5, 0.43], tacho: [0.665, 0.5, 0.43], a0: 135, sweep: 270, mph: 180, rpm: 7000, radar: [0.5, 0.5, 0.41] };
// Painters, one per region, drawing in a w × h box whose proportions are those of the decal on the car (so circles stay
// round whatever the shape of the region in the atlas). A region without a painter is left empty.
const DB5_PAINT = {
  plate(g, w, h, key) {
    // black pressed plate, raised silver-white characters and rim
    g.fillStyle = '#08080a'; g.fillRect(0, 0, w, h);
    g.lineWidth = h * 0.035; g.strokeStyle = '#b9bdc2'; g.beginPath(); g.roundRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1, h * 0.09); g.stroke();
    const txt = DB5_PLATES[+key.slice(5)] || '', px = h * 0.74, e = h * 0.022;
    bcText(g, txt, w / 2 + e, h * 0.53 + e, px, w * 0.86, '700 ', '#3a3d41');   // shadow under the raised characters
    bcText(g, txt, w / 2 - e * 0.6, h * 0.53 - e * 0.6, px, w * 0.86, '700 ', '#ffffff');
    bcText(g, txt, w / 2, h * 0.53, px, w * 0.86, '700 ', '#dfe2e5');
  },
  dials(g, w, h) {
    // instrument panel: speedometer and rev counter with chrome bezels, five small instruments, warning lamps
    g.fillStyle = '#070708'; g.fillRect(0, 0, w, h);
    const D = DB5_DIAL, R = D.speedo[2] * h;
    bcDial(g, D.speedo[0] * w, D.speedo[1] * h, R, 0, D.mph, 20, 10, 'MPH');
    bcDial(g, D.tacho[0] * w, D.tacho[1] * h, R, 0, D.rpm, 1000, 500, 'RPM x 1000', { div: 1000, red: 6000, num: 0.2 });
    const r = h * 0.2, xl = D.speedo[0] * w - R - r * 1.25, xr = D.tacho[0] * w + R + r * 1.25, o = { a0: 215, sweep: 110, plain: true };
    bcDial(g, xl, h * 0.27, r, 0, 4, 2, 1, 'FUEL', Object.assign({ needle: 2.7 }, o));
    bcDial(g, xl, h * 0.73, r, 0, 4, 2, 1, 'OIL', Object.assign({ needle: 2.2 }, o));
    bcDial(g, xr, h * 0.27, r, 0, 4, 2, 1, 'WATER', Object.assign({ needle: 1.9 }, o));
    bcDial(g, xr, h * 0.73, r, 0, 4, 2, 1, 'OIL °C', Object.assign({ needle: 1.6 }, o));
    bcDial(g, w / 2, h * 0.3, Math.min(r * 0.85, (D.tacho[0] - D.speedo[0]) * w / 2 - R - 2), -2, 2, 2, 1, 'AMPS', Object.assign({ needle: 0.3 }, o));
    const lamps = ['#d8351c', '#2fae4a', '#e0a020'];
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w / 2 + (i - 1) * h * 0.075, h * 0.72, h * 0.022, 0, TAU); g.fillStyle = lamps[i]; g.fill(); g.lineWidth = h * 0.008; g.strokeStyle = '#9aa0a8'; g.stroke(); }
  },
  radar(g, w, h) {
    // homing tracker: round green screen in a square chrome bezel — range rings, a few roads and the blip
    g.fillStyle = '#060607'; g.fillRect(0, 0, w, h);
    const D = DB5_DIAL.radar, cx = D[0] * w, cy = D[1] * h, r = D[2] * h, b = r * 1.16;
    g.fillStyle = bcChrome(g, cx - b, cy - b, cx + b, cy + b); g.beginPath(); g.roundRect(cx - b, cy - b, b * 2, b * 2, r * 0.16); g.fill();
    g.fillStyle = '#0b0c0d'; g.beginPath(); g.roundRect(cx - b * 0.93, cy - b * 0.93, b * 1.86, b * 1.86, r * 0.12); g.fill();
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, '#1d7a34'); gr.addColorStop(0.75, '#0f4a20'); gr.addColorStop(1, '#062410');
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = gr; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
    g.strokeStyle = '#7dffa0'; g.lineWidth = r * 0.018;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(cx, cy, r * k / 3.2, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
    g.strokeStyle = '#b9ffc8'; g.lineWidth = r * 0.035; g.lineJoin = 'round';   // roads
    g.beginPath(); g.moveTo(cx - r, cy + r * 0.55); g.lineTo(cx - r * 0.3, cy + r * 0.3); g.lineTo(cx + r * 0.1, cy - r * 0.2); g.lineTo(cx + r * 0.2, cy - r); g.stroke();
    g.beginPath(); g.moveTo(cx + r * 0.1, cy - r * 0.2); g.lineTo(cx + r * 0.6, cy - r * 0.05); g.lineTo(cx + r, cy + r * 0.3); g.stroke();
    const bx = cx + r * 0.42, by = cy - r * 0.1, bl = g.createRadialGradient(bx, by, 0, bx, by, r * 0.16); bl.addColorStop(0, '#ffffff'); bl.addColorStop(0.35, '#d8ffe0'); bl.addColorStop(1, 'rgba(125,255,160,0)');
    g.fillStyle = bl; g.beginPath(); g.arc(bx, by, r * 0.16, 0, TAU); g.fill();
    g.restore();
    g.lineWidth = r * 0.04; g.strokeStyle = '#2b2e31'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    for (const s of [-1, 1]) {   // a knob at each side of the screen, where the panel is wide enough
      const kx = cx + s * (b + (w / 2 - b) / 2), kr = Math.min(r * 0.22, (w / 2 - b) * 0.36); if (kr < 2) continue;
      g.beginPath(); g.arc(kx, cy + r * 0.45, kr, 0, TAU); g.fillStyle = bcChrome(g, kx - kr, cy, kx + kr, cy + r); g.fill();
      g.beginPath(); g.arc(kx, cy + r * 0.45, kr * 0.55, 0, TAU); g.fillStyle = '#15171a'; g.fill();
    }
  },
  panel(g, w, h) {
    // gadget switches in the armrest: rows of toggles and push buttons with tiny labels, red and amber lamps
    g.fillStyle = '#0a0a0b'; g.fillRect(0, 0, w, h);
    g.lineWidth = Math.max(1, w * 0.012); g.strokeStyle = '#8a9098'; g.strokeRect(w * 0.03, w * 0.03, w - w * 0.06, h - w * 0.06);
    const names = ['GUNS', 'SMOKE', 'OIL', 'SHIELD', 'RAMS', 'PLATES', 'SLASH', 'LAMPS', 'EJECT'], cols = 3, rows = 3, cw = w / cols, ch = h / rows, r = Math.min(cw, ch) * 0.2;
    for (let i = 0; i < names.length; i++) {
      const cx = (i % cols + 0.5) * cw, cy = (Math.floor(i / cols) + 0.4) * ch, push = i % 4 === 2 || i === 8;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = bcChrome(g, cx - r, cy - r, cx + r, cy + r); g.fill();
      if (push) { g.beginPath(); g.arc(cx, cy, r * 0.68, 0, TAU); g.fillStyle = i === 8 ? '#c5281a' : '#1a1b1d'; g.fill(); }
      else { g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fillStyle = '#2a2c2f'; g.fill(); g.lineCap = 'round'; g.lineWidth = r * 0.42; g.strokeStyle = '#d9dde1'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.25, cy - r * 0.95); g.stroke(); g.lineCap = 'butt'; }
      g.beginPath(); g.arc(cx + cw * 0.3, cy - ch * 0.22, r * 0.2, 0, TAU); g.fillStyle = i % 2 ? '#e0a020' : '#d8351c'; g.fill();
      bcText(g, names[i], cx, cy + r + ch * 0.13, ch * 0.12, cw * 0.86, '700 ', '#e8eaea');
    }
  },
  wings(g, w, h) {
    // winged badge, chrome on transparent: two feathered wings and the name bar across the middle
    const cx = w / 2, cy = h * 0.5, ch = bcChrome(g, 0, 0, 0, h);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + s * w * 0.1, cy - h * 0.24); g.bezierCurveTo(cx + s * w * 0.3, cy - h * 0.46, cx + s * w * 0.42, cy - h * 0.42, cx + s * w * 0.49, cy - h * 0.3);
      g.bezierCurveTo(cx + s * w * 0.44, cy + h * 0.12, cx + s * w * 0.3, cy + h * 0.34, cx + s * w * 0.1, cy + h * 0.3); g.closePath(); g.fillStyle = ch; g.fill();
      g.strokeStyle = '#5c626a'; g.lineWidth = Math.max(1, h * 0.03);
      for (let k = 1; k < 5; k++) { const t = k / 5; g.beginPath(); g.moveTo(cx + s * w * 0.12, cy - h * 0.2 + t * h * 0.46); g.quadraticCurveTo(cx + s * w * 0.3, cy - h * 0.34 + t * h * 0.56, cx + s * w * (0.47 - t * 0.12), cy - h * 0.26 + t * h * 0.42); g.stroke(); }
    }
    g.fillStyle = ch; g.fillRect(cx - w * 0.2, cy - h * 0.3, w * 0.4, h * 0.6);
    g.fillStyle = '#0c2a1c'; g.fillRect(cx - w * 0.185, cy - h * 0.22, w * 0.37, h * 0.44);
    bcText(g, 'ASTON MARTIN', cx, cy, h * 0.26, w * 0.34, '700 ', '#eef0f2');
  },
  script(g, w, h) {
    // "DB5" in chrome letters on transparent
    g.font = 'italic 700 ' + Math.round(h * 0.86) + 'px Georgia,"Times New Roman",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText('DB5').width, k = Math.min(1, w * 0.92 / tw);
    g.save(); g.translate(w / 2, h * 0.54); g.scale(k, 1);
    g.lineJoin = 'round'; g.lineWidth = h * 0.09; g.strokeStyle = '#6a7078'; g.strokeText('DB5', 0, 0);
    g.fillStyle = bcChrome(g, 0, -h * 0.45, 0, h * 0.45); g.fillText('DB5', 0, 0); g.restore();
  },
  radio(g, w, h) {
    // 1960s car radio: chrome bezel, tuning scale with its pointer, a knob at each end, five push buttons
    g.fillStyle = bcChrome(g, 0, 0, 0, h); g.beginPath(); g.roundRect(0, 0, w, h, h * 0.12); g.fill();
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.roundRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.08); g.fill();
    const kr = h * 0.3, x0 = h * 0.5 + kr, x1 = w - h * 0.5 - kr;
    for (const x of [h * 0.5, w - h * 0.5]) {
      g.beginPath(); g.arc(x, h / 2, kr, 0, TAU); g.fillStyle = bcChrome(g, x - kr, h / 2 - kr, x + kr, h / 2 + kr); g.fill();
      g.beginPath(); g.arc(x, h / 2, kr * 0.62, 0, TAU); g.fillStyle = '#1b1c1e'; g.fill();
      g.lineWidth = Math.max(1, h * 0.03); g.strokeStyle = '#d0d4d8'; g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + kr * 0.4, h / 2 - kr * 0.45); g.stroke();
    }
    g.fillStyle = '#e8dfc0'; g.fillRect(x0, h * 0.18, x1 - x0, h * 0.3);
    g.fillStyle = '#1c1a14'; const marks = ['55', '65', '80', '100', '130', '160'];
    for (let i = 0; i < marks.length; i++) bcText(g, marks[i], x0 + (i + 0.5) * (x1 - x0) / marks.length, h * 0.3, h * 0.15, 0, '700 ');
    for (let i = 0; i <= 24; i++) g.fillRect(x0 + i * (x1 - x0) / 24 - 0.5, h * 0.4, 1, i % 4 ? h * 0.04 : h * 0.08);
    g.fillStyle = '#c5281a'; g.fillRect(x0 + (x1 - x0) * 0.62, h * 0.18, Math.max(1.5, h * 0.03), h * 0.3);
    const bw = (x1 - x0) / 5;
    for (let i = 0; i < 5; i++) { g.fillStyle = '#d9d2bb'; g.beginPath(); g.roundRect(x0 + i * bw + bw * 0.08, h * 0.58, bw * 0.84, h * 0.26, h * 0.04); g.fill(); g.fillStyle = '#8f8a78'; g.fillRect(x0 + i * bw + bw * 0.08, h * 0.79, bw * 0.84, h * 0.05); }
  },
  clock(g, w, h) {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.47;
    bcDial(g, cx, cy, r, 0, 12, 3, 1, '', { a0: -90, sweep: 360, plain: true });
    g.fillStyle = '#eef0f0'; const n = ['12', '3', '6', '9'];
    for (let i = 0; i < 4; i++) bcText(g, n[i], cx + Math.sin(i * PI / 2) * r * 0.52, cy - Math.cos(i * PI / 2) * r * 0.52, r * 0.24, 0, '600 ');
    g.lineCap = 'round'; g.strokeStyle = '#f2f3f3';
    g.lineWidth = r * 0.07; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - r * 0.36, cy - r * 0.22); g.stroke();      // 10:10
    g.lineWidth = r * 0.045; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.56, cy - r * 0.34); g.stroke();
    g.lineCap = 'butt'; g.beginPath(); g.arc(cx, cy, r * 0.07, 0, TAU); g.fillStyle = '#c9cdd1'; g.fill();
  },
};
const BC_DB5 = {
  id: 'db5', name: 'Aston Martin DB5 · 1964',
  meta: typeof DB5_META !== 'undefined' ? DB5_META : null, b64: typeof DB5_B64 !== 'undefined' ? DB5_B64 : null,
  // geometry when the export has no DB5_META.car (the values of the first export)
  geom: {
    wheelbase: 2.489, wheelR: 0.338, hubs: [[1.2445, 0.338, -0.689], [1.2445, 0.338, 0.689], [-1.2445, 0.338, -0.6795], [-1.2445, 0.338, 0.6795]],
    // steering-wheel frame (right-hand drive): centre of the wheel and tilt of the column, as in the Blender preview
    // (db5_build.py, main(): translation, then a rotation of `tilt` degrees about Z)
    steerPos: [0.19, 0.815, 0.345], steerTilt: 160,
    eye: [-0.42, 1.14, 0.345],            // the driver's eyes (cockpit camera)
    bonnetCam: [0.62, 1.12, 0],           // above the scuttle
    half: { w: 0.84, front: 1.96, rear: 2.36 },   // body from the middle of the wheelbase, without the bumpers
    bumper: 0.09,                         // how far the bumpers stand out at each end
  },
  // shader defines: the DB5's materials (#ifdef DB5) and its paint, Silver Birch
  defs: { DB5: '', PAINT_ALB: 'vec3f(0.33, 0.335, 0.33)', PAINT_MET: '0.8' },
  AT: DB5_AT, PAINT: DB5_PAINT, DIAL: DB5_DIAL, cutout: ['wings', 'script'],
  // Which object each target of the export belongs to and in which passes it is drawn (1 main, 2 shadow). Targets the game
  // does not know are attached to the body; "<target>_glass" is the transparent part of <target>.
  targets: {
    body: ['body', 3], driver: ['body', 3], wheel: ['wheel', 3], wheelblur: ['wheel', 1], steer: ['steer', 3],
    plateF: ['plateF', 3], plateR: ['plateR', 3], guns: ['guns', 3], muzzle: ['guns', 1], gunlamp: ['gunlamp', 3], shield: ['shield', 3],
    slasher: ['slasher', 3], seat: ['seat', 3], roofpanel: ['roofpanel', 3], ramF: ['ramF', 3], ramR: ['ramR', 3], head: ['head', 3],
  },
  // object slots of the moving parts, in this order: name and count, or the wheels the part turns with
  slots: [['plateF', 1], ['plateR', 1], ['guns', 1], ['gunlamp', 1], ['shield', 1], ['slasher', [2, 3]], ['seat', 1], ['roofpanel', 1], ['ramF', 1], ['ramR', 1], ['head', 1]],
  pivots: db5Pivots, params: db5Params, parts: db5Parts,
  viewCam: [4.4, 1.5, -3.7, 0.15, 0.6, 0, 0.5],   // car viewer (?scene=car)
  ej: { live: false, t0: 0, B: m4(), hide: new Uint8Array(2) },   // ejector seat in flight: body matrix at the launch
};
// Pivots, directions and effect points, from DB5_META.targets and the bounds of the meshes (nothing is assumed about where
// the parts are on the car, only about how they move).
function db5Pivots(buf) {
  const M = BC_DB5.meta, T = M.targets || {}, bb = BCD.bb, P = BCD.piv, B = n => bb[n] || bb.body || [-2.4, 2.1, 0.2, 1.3, -0.84, 0.84, 0, 0.84], mid = (b, i) => (b[i] + b[i + 1]) / 2;
  const piv = (n, o) => { const p = T[n] && T[n].pivot, b = B(n); P[o] = p ? p[0] : mid(b, 0); P[o + 1] = p ? p[1] : mid(b, 2); };
  piv('plateF', 0); piv('plateR', 2); piv('gunlamp', 4);
  // the shield slides in its own plane: longest direction of the plate in side view (principal axis of its vertices)
  P[6] = 0.2; P[7] = 0.98;
  { let n = 0, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0, off = 0; const sc = 1 / M.scale;
    for (const ch of M.chunks) {
      if (ch.t === 'shield') { const pos = new Int16Array(buf, off, ch.nv * 3); for (let i = 0; i < ch.nv; i++) { const x = pos[i * 3] * sc, y = pos[i * 3 + 1] * sc; n++; sx += x; sy += y; xx += x * x; xy += x * y; yy += y * y; } }
      off = (off + ch.nv * 6 + 3) & ~3; off += ch.nv * 4 + (ch.uv ? ch.nv * 8 : 0); off = (off + ch.ni * (ch.i32 ? 4 : 2) + 3) & ~3;
    }
    if (n > 2) { const a = xx / n - sx * sx / n / n, b = xy / n - sx * sy / n / n, c = yy / n - sy * sy / n / n, th = 0.5 * Math.atan2(2 * b, a - c); let dx = Math.cos(th), dy = Math.sin(th); if (dy < 0) { dx = -dx; dy = -dy; } P[6] = dx; P[7] = dy; }
  }
  // centres about which the ejected seat and roof panel tumble
  { const s = B('seat'), r = B('roofpanel'); P[8] = mid(s, 0); P[9] = mid(s, 2); P[10] = mid(s, 4); P[11] = mid(r, 0); P[12] = mid(r, 2); P[13] = mid(r, 4); }
  // where the effects of the gadgets are born (GPT of 41_gadgets.js)
  const g = B('guns'), body = B('body'), s = B('seat'), r = B('roofpanel'), gz = (g[6] + g[7]) / 2, gy = mid(g, 2), tail = body[0];
  GPT.set([g[1] + DB5G.gunSlide + 0.02, gy, -gz, g[1] + DB5G.gunSlide + 0.02, gy, gz,
    tail - 0.04, 0.28, -0.43, tail - 0.04, 0.28, 0.43, tail + 0.03, 0.33, 0,
    mid(s, 0), s[2] + 0.12, mid(s, 4), mid(r, 0), mid(r, 2), mid(r, 4)]);
}

// fixed parameters of the body for the shaders: the radar screen in the atlas
function db5Params() {
  const bp = objParams(CAR.slotBody), rd = DB5_AT.radar, D = DB5_DIAL.radar, asp = BCD.aspect.radar || (rd[2] - rd[0]) / (rd[3] - rd[1]);
  bp[4] = rd[0] + (rd[2] - rd[0]) * D[0]; bp[5] = rd[1] + (rd[3] - rd[1]) * D[1]; bp[7] = (rd[3] - rd[1]) * D[2]; bp[6] = bp[7] * (rd[2] - rd[0]) / ((rd[3] - rd[1]) * asp);
}
// The gadget parts. Positions are interpolated between the last two physics steps like the car itself (GS.alpha).
function db5Parts(body) {
  const C = CAR, S = C.S, L = C._l, q = BCQ, P = BCD.piv, v = GAD.v, pv = GAD.pv, al = GS.alpha, ej = BC_DB5.ej;
  // revolving number plates: both drums turn a third of a turn per plate, easing in and out
  let x = pv[GV_PLATE] + (v[GV_PLATE] - pv[GV_PLATE]) * al; { const i = Math.floor(x), f = x - i; x = i + f * f * (3 - 2 * f); }
  q[0] = -x * (TAU / 3); q[1] = P[0]; q[2] = P[1]; bcRotZQ(L); bcPut(S.plateF[0], body, L);
  q[1] = P[2]; q[2] = P[3]; bcRotZQ(L); bcPut(S.plateR[0], body, L);
  // machine guns: the indicator lamps fold down and forwards about their hinge, then the barrels slide out
  x = pv[GV_LAMP] + (v[GV_LAMP] - pv[GV_LAMP]) * al; x = x * x * (3 - 2 * x);
  q[0] = -x * DB5G.lampFold; q[1] = P[4]; q[2] = P[5]; bcRotZQ(L); bcPut(S.gunlamp[0], body, L);
  x = pv[GV_GUN] + (v[GV_GUN] - pv[GV_GUN]) * al; x = x * x * (3 - 2 * x);
  q[0] = x * DB5G.gunSlide; q[1] = 0; q[2] = 0; bcMoveQ(L); bcPut(S.guns[0], body, L);
  { const p = objParams(S.guns[0]); p[0] = v[GV_FLASHL]; p[1] = v[GV_FLASHR]; p[2] = v[GV_SEED]; }
  // bullet shield: up out of the boot lid, in its own plane
  x = pv[GV_SHIELD] + (v[GV_SHIELD] - pv[GV_SHIELD]) * al; x = x * x * (3 - 2 * x) * DB5G.shieldLift;
  q[0] = P[6] * x; q[1] = P[7] * x; q[2] = 0; bcMoveQ(L); bcPut(S.shield[0], body, L);
  // bumper rams: over-riders out on their telescopic arms
  x = pv[GV_RAM] + (v[GV_RAM] - pv[GV_RAM]) * al; x = x * x * (3 - 2 * x) * DB5G.ramOut;
  q[0] = x; q[1] = 0; q[2] = 0; bcMoveQ(L); bcPut(S.ramF[0], body, L);
  q[0] = -x; bcMoveQ(L); bcPut(S.ramR[0], body, L);
  // tyre slashers: out of the spinners of the rear wheels, turning with them; inside the hub (hidden) when retracted
  x = pv[GV_SLASH] + (v[GV_SLASH] - pv[GV_SLASH]) * al;
  if (x <= 0) { bcHide(S.slasher[0]); bcHide(S.slasher[1]); }
  else {
    const k = 0.25 + 0.75 * x * x; L.fill(0); L[0] = k; L[5] = k; L[10] = 1; L[15] = 1; L[14] = -(1 - x) * DB5G.slashOut;   // the blades open out as the shaft extends
    bcPut(S.slasher[0], objModel(C.slotWheel[2]), L); bcPut(S.slasher[1], objModel(C.slotWheel[3]), L);
  }
  // ejector seat: seat and roof panel fly on their own in the world from the moment of firing until they are back in place
  const te = v[GV_EJECT] > 0 ? pv[GV_EJECT] + (v[GV_EJECT] - pv[GV_EJECT]) * al : 0;
  if (te <= 0) {
    // in place: they are the body (coming back from the flight, they have no motion of their own for this frame)
    const back = ej.live; ej.live = false;
    for (let part = 0; part < 2; part++) {
      const s = part ? S.roofpanel[0] : S.seat[0], m = objModel(s), p = objPrev(s);
      if (back || m[15] === 0) p.set(objPrev(C.slotBody)); else p.set(m);
      m.set(body);
    }
  } else {
    if (!ej.live) { ej.live = true; ej.t0 = te; ej.B.set(body); ej.hide[0] = ej.hide[1] = 0; }
    const B0 = ej.B, tt = te - ej.t0;
    for (let part = 0; part < 2; part++) {
      const s = part ? S.roofpanel[0] : S.seat[0], o = 8 + part * 3;
      EJQ[0] = tt; gadEjectD(part);
      if (ej.hide[part] || EJQ[2] < -(part ? EJ.roofFloor : EJ.seatFloor)) { ej.hide[part] = 1; bcHide(s); continue; }   // gone into the ground
      q[0] = tt * (part ? EJ.roofSpin : EJ.seatSpin); q[1] = P[o]; q[2] = P[o + 1]; bcRotZQ(L);
      const m = objModel(s); objPrev(s).set(m); m4mul(m, B0, L); m[12] += EJQ[1]; m[13] += EJQ[2]; m[14] += EJQ[3];
    }
  }
}
