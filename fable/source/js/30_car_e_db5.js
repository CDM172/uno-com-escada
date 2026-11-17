// Aston Martin DB5 (1964): loads the mesh exported from Blender (29_db5_data.js), paints its decal atlas and takes over
// the CAR contract of 30_car_d_main.js when it is the selected car (CARSEL, see 01_gpu.js). The moving gadget parts get
// their own object slots; their positions come from the gadget logic (GAD.v, 41_gadgets.js).
// Nothing here knows the shape of the car: sizes come from DB5_META.car when the export has it, pivots from
// DB5_META.targets, and the points where effects are born from the bounds of the meshes.

// ---- geometry of the car (DB5_META.car of the export; the values of the first export when it is missing)
const DB5C = (() => {
  const c = DB5_META.car || {}, h = c.half || { w: 0.84, front: 1.96, rear: 2.36 }, st = c.steer || {};
  return {
    wheelbase: c.wheelbase || 2.489, wheelR: c.wheelR || 0.338,
    hubs: c.hubs || [[1.2445, 0.338, -0.689], [1.2445, 0.338, 0.689], [-1.2445, 0.338, -0.6795], [-1.2445, 0.338, 0.6795]],
    // steering-wheel frame (right-hand drive): centre of the wheel and tilt of the column, as in the Blender preview
    // (db5_build.py, main(): translation, then a rotation of `tilt` degrees about Z)
    steerPos: st.pos || [0.19, 0.815, 0.345], steerTilt: st.tilt === undefined ? 160 : st.tilt,
    eye: c.eye || [-0.42, 1.14, 0.345],                // the driver's eyes (cockpit camera)
    bonnetCam: c.bonnetCam || [0.62, 1.12, 0],         // above the scuttle
    halfW: h.w, front: h.front, rear: h.rear,          // body from the middle of the wheelbase, without the bumpers
    bumper: 0.09,                                      // how far the bumpers stand out at each end
  };
})();
// Travel of the gadget parts (metres, radians). Pivots come from DB5_META.targets; the plane of the shield from its mesh.
const DB5G = { lampFold: 1.62, gunSlide: 0.16, shieldLift: 0.46, slashOut: 0.14, ramOut: 0.22 };
// shaders: DB5 variants of the materials (#ifdef DB5) and the footprint of this car for the ambient occlusion on the road
if (CARSEL === 'db5') {
  const f = v => v.toFixed(4), fr = DB5C.front + DB5C.bumper, re = DB5C.rear + DB5C.bumper;
  Object.assign(SH_DEFS, { DB5: '', CAR_AO_CX: f((fr - re) / 2), CAR_AO_HL: f((fr + re) / 2 - 0.08), CAR_AO_HW: f(DB5C.halfW - 0.07), CAR_AO_AX: f(DB5C.wheelbase / 2), CAR_AO_TZ: f((Math.abs(DB5C.hubs[0][2]) + Math.abs(DB5C.hubs[2][2])) / 2 - 0.02) });
}

// ---- decal atlas: regions (u0, v0, u1, v1; v down). Mirrors AT in source/blender/db5_interior.py — keep the two in step.
const DB5_AT = {
  plate0: [0, 0, 0.5, 0.11], plate1: [0, 0.125, 0.5, 0.235], plate2: [0, 0.25, 0.5, 0.36],
  dials: [0, 0.40, 0.80, 0.62], radar: [0.52, 0, 0.76, 0.18], panel: [0.78, 0, 1.0, 0.33],
  wings: [0.52, 0.20, 0.76, 0.27], script: [0.52, 0.29, 0.76, 0.36], radio: [0, 0.64, 0.40, 0.74], clock: [0.82, 0.40, 0.98, 0.56],
};
const DB5_PLATES = ['BMT 216A', '4711-EA-62', 'LU 6789'];   // UK, France, Switzerland
// Where the shader finds the moving parts of the atlas, in the painters' own units (fractions of the region): the two big
// dials [centre x, centre y, radius / height] and the radar screen. The needles are drawn by the shader (see place()).
const DB5_DIAL = { speedo: [0.335, 0.5, 0.43], tacho: [0.665, 0.5, 0.43], a0: 135, sweep: 270, mph: 180, rpm: 7000, radar: [0.5, 0.5, 0.41] };
const _sans = '"Helvetica Neue",Helvetica,Arial,sans-serif';
function db5Chrome(g, x0, y0, x1, y1) { const c = g.createLinearGradient(x0, y0, x1, y1); c.addColorStop(0, '#f6f8fa'); c.addColorStop(0.45, '#aab0b8'); c.addColorStop(0.55, '#8a9098'); c.addColorStop(1, '#e4e8ec'); return c; }
// text centred on (cx, cy), squeezed sideways when it is wider than maxW
function db5Text(g, txt, cx, cy, px, maxW, font, style) {
  g.font = (font || '700 ') + px + 'px ' + _sans; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(txt).width, k = maxW && w > maxW ? maxW / w : 1;
  g.save(); g.translate(cx, cy); g.scale(k, 1); if (style) g.fillStyle = style; g.fillText(txt, 0, 0); g.restore();
}
// a round instrument: chrome bezel, black face, scale from v0 to v1 with numbers every `step` and ticks every `minor`
function db5Dial(g, cx, cy, r, v0, v1, step, minor, label, opts) {
  opts = opts || {}; const a0 = (opts.a0 === undefined ? DB5_DIAL.a0 : opts.a0) * PI / 180, sw = (opts.sweep === undefined ? DB5_DIAL.sweep : opts.sweep) * PI / 180;
  const ang = v => a0 + sw * (v - v0) / (v1 - v0);
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = db5Chrome(g, cx - r, cy - r, cx + r, cy + r); g.fill();
  g.beginPath(); g.arc(cx, cy, r * 0.9, 0, TAU); g.fillStyle = '#060607'; g.fill();
  if (opts.red !== undefined) { g.beginPath(); g.arc(cx, cy, r * 0.8, ang(opts.red), ang(v1)); g.lineWidth = r * 0.07; g.strokeStyle = '#d2311c'; g.stroke(); }
  g.strokeStyle = '#eef0f0'; g.fillStyle = '#eef0f0';
  const n = Math.round((v1 - v0) / minor), every = Math.round(step / minor);
  for (let k = 0; k <= n; k++) {
    const v = v0 + k * minor, major = k % every === 0, a = ang(v), co = Math.cos(a), si = Math.sin(a);
    g.beginPath(); g.moveTo(cx + co * r * 0.84, cy + si * r * 0.84); g.lineTo(cx + co * r * (major ? 0.72 : 0.78), cy + si * r * (major ? 0.72 : 0.78)); g.lineWidth = r * (major ? 0.035 : 0.018); g.stroke();
    if (major && !opts.plain) db5Text(g, String(opts.div ? v / opts.div : v), cx + co * r * 0.56, cy + si * r * 0.56, r * (opts.num || 0.17), 0, '600 ');
  }
  if (label) db5Text(g, label, cx, cy + r * (opts.plain ? 0.42 : 0.3), r * (opts.plain ? 0.2 : 0.11), r * 1.1, '600 ', '#cfd2d2');
  if (opts.needle !== undefined) {   // the small instruments have a fixed needle; the two big ones are moved by the shader
    const a = ang(opts.needle); g.beginPath(); g.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12); g.lineTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74); g.lineWidth = r * 0.06; g.lineCap = 'round'; g.strokeStyle = '#ff5a1e'; g.stroke(); g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, cy, r * 0.13, 0, TAU); g.fillStyle = '#101112'; g.fill();
  }
}
// Painters, one per region, drawing in a w × h box whose proportions are those of the decal on the car (so circles stay
// round whatever the shape of the region in the atlas). A region without a painter is left empty.
const DB5_PAINT = {
  plate(g, w, h, key) {
    // black pressed plate, raised silver-white characters and rim
    g.fillStyle = '#08080a'; g.fillRect(0, 0, w, h);
    g.lineWidth = h * 0.035; g.strokeStyle = '#b9bdc2'; g.beginPath(); g.roundRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1, h * 0.09); g.stroke();
    const txt = DB5_PLATES[+key.slice(5)] || '', px = h * 0.74, e = h * 0.022;
    db5Text(g, txt, w / 2 + e, h * 0.53 + e, px, w * 0.86, '700 ', '#3a3d41');   // shadow under the raised characters
    db5Text(g, txt, w / 2 - e * 0.6, h * 0.53 - e * 0.6, px, w * 0.86, '700 ', '#ffffff');
    db5Text(g, txt, w / 2, h * 0.53, px, w * 0.86, '700 ', '#dfe2e5');
  },
  dials(g, w, h) {
    // instrument panel: speedometer and rev counter with chrome bezels, five small instruments, warning lamps
    g.fillStyle = '#070708'; g.fillRect(0, 0, w, h);
    const D = DB5_DIAL, R = D.speedo[2] * h;
    db5Dial(g, D.speedo[0] * w, D.speedo[1] * h, R, 0, D.mph, 20, 10, 'MPH');
    db5Dial(g, D.tacho[0] * w, D.tacho[1] * h, R, 0, D.rpm, 1000, 500, 'RPM x 1000', { div: 1000, red: 6000, num: 0.2 });
    const r = h * 0.2, xl = D.speedo[0] * w - R - r * 1.25, xr = D.tacho[0] * w + R + r * 1.25, o = { a0: 215, sweep: 110, plain: true };
    db5Dial(g, xl, h * 0.27, r, 0, 4, 2, 1, 'FUEL', Object.assign({ needle: 2.7 }, o));
    db5Dial(g, xl, h * 0.73, r, 0, 4, 2, 1, 'OIL', Object.assign({ needle: 2.2 }, o));
    db5Dial(g, xr, h * 0.27, r, 0, 4, 2, 1, 'WATER', Object.assign({ needle: 1.9 }, o));
    db5Dial(g, xr, h * 0.73, r, 0, 4, 2, 1, 'OIL °C', Object.assign({ needle: 1.6 }, o));
    db5Dial(g, w / 2, h * 0.3, Math.min(r * 0.85, (D.tacho[0] - D.speedo[0]) * w / 2 - R - 2), -2, 2, 2, 1, 'AMPS', Object.assign({ needle: 0.3 }, o));
    const lamps = ['#d8351c', '#2fae4a', '#e0a020'];
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w / 2 + (i - 1) * h * 0.075, h * 0.72, h * 0.022, 0, TAU); g.fillStyle = lamps[i]; g.fill(); g.lineWidth = h * 0.008; g.strokeStyle = '#9aa0a8'; g.stroke(); }
  },
  radar(g, w, h) {
    // homing tracker: round green screen in a square chrome bezel — range rings, a few roads and the blip
    g.fillStyle = '#060607'; g.fillRect(0, 0, w, h);
    const D = DB5_DIAL.radar, cx = D[0] * w, cy = D[1] * h, r = D[2] * h, b = r * 1.16;
    g.fillStyle = db5Chrome(g, cx - b, cy - b, cx + b, cy + b); g.beginPath(); g.roundRect(cx - b, cy - b, b * 2, b * 2, r * 0.16); g.fill();
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
      g.beginPath(); g.arc(kx, cy + r * 0.45, kr, 0, TAU); g.fillStyle = db5Chrome(g, kx - kr, cy, kx + kr, cy + r); g.fill();
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
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = db5Chrome(g, cx - r, cy - r, cx + r, cy + r); g.fill();
      if (push) { g.beginPath(); g.arc(cx, cy, r * 0.68, 0, TAU); g.fillStyle = i === 8 ? '#c5281a' : '#1a1b1d'; g.fill(); }
      else { g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fillStyle = '#2a2c2f'; g.fill(); g.lineCap = 'round'; g.lineWidth = r * 0.42; g.strokeStyle = '#d9dde1'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.25, cy - r * 0.95); g.stroke(); g.lineCap = 'butt'; }
      g.beginPath(); g.arc(cx + cw * 0.3, cy - ch * 0.22, r * 0.2, 0, TAU); g.fillStyle = i % 2 ? '#e0a020' : '#d8351c'; g.fill();
      db5Text(g, names[i], cx, cy + r + ch * 0.13, ch * 0.12, cw * 0.86, '700 ', '#e8eaea');
    }
  },
  wings(g, w, h) {
    // winged badge, chrome on transparent: two feathered wings and the name bar across the middle
    const cx = w / 2, cy = h * 0.5, ch = db5Chrome(g, 0, 0, 0, h);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + s * w * 0.1, cy - h * 0.24); g.bezierCurveTo(cx + s * w * 0.3, cy - h * 0.46, cx + s * w * 0.42, cy - h * 0.42, cx + s * w * 0.49, cy - h * 0.3);
      g.bezierCurveTo(cx + s * w * 0.44, cy + h * 0.12, cx + s * w * 0.3, cy + h * 0.34, cx + s * w * 0.1, cy + h * 0.3); g.closePath(); g.fillStyle = ch; g.fill();
      g.strokeStyle = '#5c626a'; g.lineWidth = Math.max(1, h * 0.03);
      for (let k = 1; k < 5; k++) { const t = k / 5; g.beginPath(); g.moveTo(cx + s * w * 0.12, cy - h * 0.2 + t * h * 0.46); g.quadraticCurveTo(cx + s * w * 0.3, cy - h * 0.34 + t * h * 0.56, cx + s * w * (0.47 - t * 0.12), cy - h * 0.26 + t * h * 0.42); g.stroke(); }
    }
    g.fillStyle = ch; g.fillRect(cx - w * 0.2, cy - h * 0.3, w * 0.4, h * 0.6);
    g.fillStyle = '#0c2a1c'; g.fillRect(cx - w * 0.185, cy - h * 0.22, w * 0.37, h * 0.44);
    db5Text(g, 'ASTON MARTIN', cx, cy, h * 0.26, w * 0.34, '700 ', '#eef0f2');
  },
  script(g, w, h) {
    // "DB5" in chrome letters on transparent
    g.font = 'italic 700 ' + Math.round(h * 0.86) + 'px Georgia,"Times New Roman",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText('DB5').width, k = Math.min(1, w * 0.92 / tw);
    g.save(); g.translate(w / 2, h * 0.54); g.scale(k, 1);
    g.lineJoin = 'round'; g.lineWidth = h * 0.09; g.strokeStyle = '#6a7078'; g.strokeText('DB5', 0, 0);
    g.fillStyle = db5Chrome(g, 0, -h * 0.45, 0, h * 0.45); g.fillText('DB5', 0, 0); g.restore();
  },
  radio(g, w, h) {
    // 1960s car radio: chrome bezel, tuning scale with its pointer, a knob at each end, five push buttons
    g.fillStyle = db5Chrome(g, 0, 0, 0, h); g.beginPath(); g.roundRect(0, 0, w, h, h * 0.12); g.fill();
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.roundRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.08); g.fill();
    const kr = h * 0.3, x0 = h * 0.5 + kr, x1 = w - h * 0.5 - kr;
    for (const x of [h * 0.5, w - h * 0.5]) {
      g.beginPath(); g.arc(x, h / 2, kr, 0, TAU); g.fillStyle = db5Chrome(g, x - kr, h / 2 - kr, x + kr, h / 2 + kr); g.fill();
      g.beginPath(); g.arc(x, h / 2, kr * 0.62, 0, TAU); g.fillStyle = '#1b1c1e'; g.fill();
      g.lineWidth = Math.max(1, h * 0.03); g.strokeStyle = '#d0d4d8'; g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + kr * 0.4, h / 2 - kr * 0.45); g.stroke();
    }
    g.fillStyle = '#e8dfc0'; g.fillRect(x0, h * 0.18, x1 - x0, h * 0.3);
    g.fillStyle = '#1c1a14'; const marks = ['55', '65', '80', '100', '130', '160'];
    for (let i = 0; i < marks.length; i++) db5Text(g, marks[i], x0 + (i + 0.5) * (x1 - x0) / marks.length, h * 0.3, h * 0.15, 0, '700 ');
    for (let i = 0; i <= 24; i++) g.fillRect(x0 + i * (x1 - x0) / 24 - 0.5, h * 0.4, 1, i % 4 ? h * 0.04 : h * 0.08);
    g.fillStyle = '#c5281a'; g.fillRect(x0 + (x1 - x0) * 0.62, h * 0.18, Math.max(1.5, h * 0.03), h * 0.3);
    const bw = (x1 - x0) / 5;
    for (let i = 0; i < 5; i++) { g.fillStyle = '#d9d2bb'; g.beginPath(); g.roundRect(x0 + i * bw + bw * 0.08, h * 0.58, bw * 0.84, h * 0.26, h * 0.04); g.fill(); g.fillStyle = '#8f8a78'; g.fillRect(x0 + i * bw + bw * 0.08, h * 0.79, bw * 0.84, h * 0.05); }
  },
  clock(g, w, h) {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.47;
    db5Dial(g, cx, cy, r, 0, 12, 3, 1, '', { a0: -90, sweep: 360, plain: true });
    g.fillStyle = '#eef0f0'; const n = ['12', '3', '6', '9'];
    for (let i = 0; i < 4; i++) db5Text(g, n[i], cx + Math.sin(i * PI / 2) * r * 0.52, cy - Math.cos(i * PI / 2) * r * 0.52, r * 0.24, 0, '600 ');
    g.lineCap = 'round'; g.strokeStyle = '#f2f3f3';
    g.lineWidth = r * 0.07; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - r * 0.36, cy - r * 0.22); g.stroke();      // 10:10
    g.lineWidth = r * 0.045; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.56, cy - r * 0.34); g.stroke();
    g.lineCap = 'butt'; g.beginPath(); g.arc(cx, cy, r * 0.07, 0, TAU); g.fillStyle = '#c9cdd1'; g.fill();
  },
};
// Paints the atlas. aspect[name] = width / height of the decal on the car (measured from the mesh), when it is known.
function db5Atlas(aspect) {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  for (const k in DB5_AT) {
    const r = DB5_AT[k], paint = DB5_PAINT[k] || DB5_PAINT[k.replace(/\d+$/, '')]; if (!paint) continue;
    const x = r[0] * S, y = r[1] * S, w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S, lw = h * (aspect[k] || w / h);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); g.scale(w / lw, 1); paint(g, lw, h, k); g.restore();
  }
  const im = g.getImageData(0, 0, S, S), d = im.data;
  // cut-out badges: the transparent texels take the colour of the chrome, so that filtering leaves no dark fringe
  for (const k of ['wings', 'script']) {
    const r = DB5_AT[k]; if (!r) continue;
    for (let y = Math.floor(r[1] * S); y < Math.ceil(r[3] * S); y++) for (let x = Math.floor(r[0] * S); x < Math.ceil(r[2] * S); x++) { const o = (y * S + x) * 4; if (d[o + 3] === 0) { d[o] = 176; d[o + 1] = 182; d[o + 2] = 190; } }
  }
  const tex = mkTex(S, S, 'rgba8unorm-srgb', TU.RT | TU.TB | TU.CD, { mipLevelCount: 8 });
  G.dev.queue.writeTexture({ texture: tex }, d, { bytesPerRow: S * 4 }, [S, S]);
  genMips(tex, 'rgba8unorm-srgb');
  return tex;
}

// ---- loader ----
// Which object each target of the export belongs to and in which passes it is drawn (1 main, 2 shadow). Targets the game
// does not know are attached to the body; "<target>_glass" is the transparent part of <target>.
const DB5_TARGETS = {
  body: ['body', 3], driver: ['body', 3], wheel: ['wheel', 3], wheelblur: ['wheel', 1], steer: ['steer', 3],
  plateF: ['plateF', 3], plateR: ['plateR', 3], guns: ['guns', 3], muzzle: ['guns', 1], gunlamp: ['gunlamp', 3], shield: ['shield', 3],
  slasher: ['slasher', 3], seat: ['seat', 3], roofpanel: ['roofpanel', 3], ramF: ['ramF', 3], ramR: ['ramR', 3], head: ['head', 3],
};
const DB5 = {
  groups: null,                      // decoded meshes: { key: { mb, slot name, flags, glass } }
  bb: {},                            // bounds per target: [x0, x1, y0, y1, z0, z1, |z| min, |z| max]
  aspect: {},                        // width / height on the car of the decal of each atlas region
  piv: new Float32Array(24),         // pivots and directions for place(): see db5Pivots()
  tris: 0, dialK: 1,                 // dialK: sideways squeeze of the dials region in the atlas (1 = none)
  ejLive: false, ejT0: 0, ejB: m4(), ejHide: new Uint8Array(2),   // ejector seat in flight: body matrix at the launch
};
// base64 → zlib stream → bytes
async function db5Inflate(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
}
// Walks DB5_META.chunks and feeds one MeshBuilder per object and kind of pass (format: source/blender/README.md).
// A material id the shader has no case for is drawn as plain vertex colour (the default of wgsl/mat_car.wgsl).
function db5Decode(buf) {
  const sc = 1 / DB5_META.scale, groups = DB5.groups = {}, bb = DB5.bb, at = DB5_AT, reg = {};
  let off = 0; DB5.tris = 0;
  for (const ch of DB5_META.chunks) {
    const nv = ch.nv, ni = ch.ni;
    const pos = new Int16Array(buf, off, nv * 3); off = (off + nv * 6 + 3) & ~3;
    const nrm = new Int8Array(buf, off, nv * 4); off += nv * 4;
    let uv = null; if (ch.uv) { uv = new Float32Array(buf, off, nv * 2); off += nv * 8; }
    const idx = ch.i32 ? new Uint32Array(buf, off, ni) : new Uint16Array(buf, off, ni); off = (off + ni * (ch.i32 ? 4 : 2) + 3) & ~3;
    let name = ch.t, glass = false;
    if (name === 'glass') { name = 'body'; glass = true; } else if (name.endsWith('_glass')) { name = name.slice(0, -6); glass = true; }
    const tg = DB5_TARGETS[name] || DB5_TARGETS.body, key = tg[0] + (glass ? '|g' : '|' + tg[1]);
    const gr = groups[key] || (groups[key] = { mb: new MeshBuilder(1 << 12), slot: tg[0], flags: tg[1], glass });
    const mb = gr.mb, v0 = mb.nv, i0 = mb.ni, c = ch.c || [1, 1, 1];
    mb.mat(ch.id, ch.a || 0).color(c[0], c[1], c[2]);
    const b = bb[ch.t] || (bb[ch.t] = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9, 1e9, -1e9]);
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3] * sc, y = pos[i * 3 + 1] * sc, z = pos[i * 3 + 2] * sc, az = Math.abs(z);
      mb.v(x, y, z, nrm[i * 4], nrm[i * 4 + 1], nrm[i * 4 + 2], uv ? uv[i * 2] : 1, uv ? uv[i * 2 + 1] : 0);
      if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x; if (y < b[2]) b[2] = y; if (y > b[3]) b[3] = y;
      if (z < b[4]) b[4] = z; if (z > b[5]) b[5] = z; if (ch.m && -z < b[4]) b[4] = -z; if (ch.m && -z > b[5]) b[5] = -z; if (az < b[6]) b[6] = az; if (az > b[7]) b[7] = az;
    }
    for (let i = 0; i < ni; i += 3) mb.tri(v0 + idx[i], v0 + idx[i + 1], v0 + idx[i + 2]);
    DB5.tris += ni / 3 * (ch.m ? 2 : 1);
    // decals: size on the car of what each atlas region is mapped to (for the proportions of the painters)
    if (ch.id === 12 && uv) for (const k in at) {
      const r = at[k], e = 2e-3, a = reg[k] || (reg[k] = { n: [0, 0, 0, 0], p: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] });
      for (let i = 0; i < nv; i++) {
        const u = uv[i * 2], v = uv[i * 2 + 1]; if (u < r[0] - e || u > r[2] + e || v < r[1] - e || v > r[3] + e) continue;
        const q = (Math.abs(u - r[2]) < e ? 1 : Math.abs(u - r[0]) < e ? 0 : -1), w = (Math.abs(v - r[3]) < e ? 1 : Math.abs(v - r[1]) < e ? 0 : -1); if (q < 0 || w < 0) continue;
        const o = q + w * 2; a.n[o]++; for (let j = 0; j < 3; j++) a.p[o][j] += pos[i * 3 + j] * sc;
      }
    }
    if (ch.m) mb.mirror(v0, i0, 2);
  }
  for (const k in reg) {
    const a = reg[k]; if (!(a.n[0] && a.n[1] && a.n[2])) continue;
    const P = o => a.p[o].map(x => x / a.n[o]), p0 = P(0), pu = P(1), pv = P(2), w = Math.hypot(pu[0] - p0[0], pu[1] - p0[1], pu[2] - p0[2]), h = Math.hypot(pv[0] - p0[0], pv[1] - p0[1], pv[2] - p0[2]);
    if (w > 1e-4 && h > 1e-4) DB5.aspect[k] = w / h;
  }
  db5Pivots(buf);
}
// Pivots, directions and effect points, from DB5_META.targets and the bounds of the meshes (nothing is assumed about where
// the parts are on the car, only about how they move).
function db5Pivots(buf) {
  const T = DB5_META.targets || {}, bb = DB5.bb, P = DB5.piv, B = n => bb[n] || bb.body || [-2.4, 2.1, 0.2, 1.3, -0.84, 0.84, 0, 0.84], mid = (b, i) => (b[i] + b[i + 1]) / 2;
  const piv = (n, o) => { const p = T[n] && T[n].pivot, b = B(n); P[o] = p ? p[0] : mid(b, 0); P[o + 1] = p ? p[1] : mid(b, 2); };
  piv('plateF', 0); piv('plateR', 2); piv('gunlamp', 4);
  // the shield slides in its own plane: longest direction of the plate in side view (principal axis of its vertices)
  P[6] = 0.2; P[7] = 0.98;
  { let n = 0, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0, off = 0; const sc = 1 / DB5_META.scale;
    for (const ch of DB5_META.chunks) {
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

// ---- matrices of the moving parts (no numbers through arguments: the register DBQ) ----
const DBQ = new Float64Array(4);
// rotation of DBQ[0] radians about the Z axis through the point (DBQ[1], DBQ[2])
function db5RotZQ(o) {
  const a = DBQ[0], px = DBQ[1], py = DBQ[2], c = Math.cos(a), s = Math.sin(a);
  o.fill(0); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; o[10] = 1; o[15] = 1; o[12] = px - c * px + s * py; o[13] = py - s * px - c * py;
}
// translation by (DBQ[0], DBQ[1], DBQ[2])
function db5MoveQ(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; o[12] = DBQ[0]; o[13] = DBQ[1]; o[14] = DBQ[2]; }
// model matrix of slot s = parent × local, keeping the previous one for the motion vectors (a part that was hidden has none)
function db5Put(s, parent, local) {
  const m = objModel(s), p = objPrev(s);
  if (m[15] === 0) { m4mul(m, parent, local); p.set(m); } else { p.set(m); m4mul(m, parent, local); }
}
function db5Hide(s) { objModel(s).fill(0); objPrev(s).fill(0); }
// The contract with the game (see CAR in 30_car_d_main.js), DB5 version
const DB5CAR = {
  wheelbase: DB5C.wheelbase, trackF: Math.abs(DB5C.hubs[0][2]) + Math.abs(DB5C.hubs[1][2]), trackR: Math.abs(DB5C.hubs[2][2]) + Math.abs(DB5C.hubs[3][2]), wheelR: DB5C.wheelR, hubs: DB5C.hubs,
  slotPlateF: 0, slotPlateR: 0, slotGuns: 0, slotGunLamp: 0, slotShield: 0, slotSlash: [0, 0], slotSeat: 0, slotRoof: 0, slotRamF: 0, slotRamR: 0, slotHead: 0,
  _l: m4(),
  // decoding the mesh takes a stream: done before build() (BUILD callback of 30_car_d_main.js)
  async load() { db5Decode(await db5Inflate(DB5_B64)); },
  slots() {
    const C = CAR, S = {};
    C.slotBody = S.body = objSlot(); for (let i = 0; i < 4; i++) C.slotWheel[i] = objSlot(); C.slotSteer = S.steer = objSlot();
    C.slotPlateF = S.plateF = objSlot(); C.slotPlateR = S.plateR = objSlot(); C.slotGuns = S.guns = objSlot(); C.slotGunLamp = S.gunlamp = objSlot();
    C.slotShield = S.shield = objSlot(); C.slotSlash[0] = objSlot(); C.slotSlash[1] = objSlot(); C.slotSeat = S.seat = objSlot(); C.slotRoof = S.roofpanel = objSlot();
    C.slotRamF = S.ramF = objSlot(); C.slotRamR = S.ramR = objSlot(); C.slotHead = S.head = objSlot();
    for (let i = 0; i < 4; i++) objParams(C.slotWheel[i])[1] = C.wheelR;   // the tyre material wants the outer radius
    m4translate(C._t, DB5C.steerPos[0], DB5C.steerPos[1], DB5C.steerPos[2]); m4rotZ(C._t2, DB5C.steerTilt * PI / 180); m4mul(C.steerMat, C._t, C._t2);
    // fixed parameters of the body for the shaders: where the tail lamps begin, the radar screen in the atlas
    const bp = objParams(C.slotBody), b = DB5.bb.body, rd = DB5_AT.radar, D = DB5_DIAL.radar, asp = DB5.aspect.radar || (rd[2] - rd[0]) / (rd[3] - rd[1]);
    bp[3] = b ? b[0] + 0.3 : -2.1;
    bp[4] = rd[0] + (rd[2] - rd[0]) * D[0]; bp[5] = rd[1] + (rd[3] - rd[1]) * D[1]; bp[7] = (rd[3] - rd[1]) * D[2]; bp[6] = bp[7] * (rd[2] - rd[0]) / ((rd[3] - rd[1]) * asp);
    { const r = DB5_AT.dials, wh = (r[2] - r[0]) / (r[3] - r[1]); DB5.dialK = wh / (DB5.aspect.dials || wh); }
    return S;
  },
  build() {
    const C = CAR, fam = C.fam = mkFamily('car', { src: 'mat_car', noCube: true }), S = C.slots();
    const set = C.set = new MeshSet(fam), glass = C.glass = new GlassSet();
    for (const k in DB5.groups) {
      const gr = DB5.groups[k], mesh = gr.mb.upload(), slots = gr.slot === 'wheel' ? C.slotWheel : gr.slot === 'slasher' ? C.slotSlash : [S[gr.slot]];
      for (const s of slots) { if (gr.glass) glass.add_(mesh, s); else set.add(mesh, s, gr.flags); }
    }
    C.tris = DB5.tris; DB5.groups = null;
    const tex = db5Atlas(DB5.aspect);
    R.drawables.push({ draw(pass, ctx) {
      if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
      if (!C.atlasBG) { if (!fam.bgl3) return; C.atlasBG = G.dev.createBindGroup({ layout: fam.bgl3, entries: [{ binding: 0, resource: tex.createView() }] }); }
      pass.setBindGroup(3, C.atlasBG); set.draw(pass, ctx);
    } });
    R.transparents.push(glass);
    m4ident(C._t); C.place(C._t, C._z4, C._z4); C.place(C._t, C._z4, C._z4);
  },
  // Writes the matrices of every slot (keeping the previous ones for the motion vectors). Nothing is allocated.
  // CAR.inp[0] = angle of the front wheels, CAR.inp[1] = angle of the steering wheel; the gadget parts follow GAD.v.
  place(body, spin, susp) {
    const C = CAR, steer = C.inp[0], steerWheelAngle = C.inp[1], t = C._t2, t2 = C._t3;
    objPrev(C.slotBody).set(objModel(C.slotBody)); objModel(C.slotBody).set(body);
    for (let i = 0; i < 4; i++) {
      const s = C.slotWheel[i], h = C.hubs[i], left = (i & 1) === 0;
      objPrev(s).set(objModel(s));
      // wheel: T(hub + suspension) · Ry(steering [+π on the left]) · Rz(spin)
      const a = -(i < 2 ? steer : 0) + (left ? PI : 0), c = Math.cos(a), sn = Math.sin(a);
      const g = left ? spin[i] : -spin[i], cg = Math.cos(g), sg = Math.sin(g);
      t[0] = c * cg; t[1] = sg; t[2] = -sn * cg; t[3] = 0;
      t[4] = -c * sg; t[5] = cg; t[6] = sn * sg; t[7] = 0;
      t[8] = sn; t[9] = 0; t[10] = c; t[11] = 0;
      t[12] = h[0]; t[13] = h[1] + susp[i]; t[14] = h[2]; t[15] = 1;
      m4mul(objModel(s), body, t);
    }
    objPrev(C.slotSteer).set(objModel(C.slotSteer));
    const ca = Math.cos(-steerWheelAngle), sa = Math.sin(-steerWheelAngle); t2.fill(0); t2[0] = 1; t2[5] = ca; t2[6] = sa; t2[9] = -sa; t2[10] = ca; t2[15] = 1;
    m4mul(t, C.steerMat, t2); m4mul(objModel(C.slotSteer), body, t);
    db5Parts(body);
  },
};
// The gadget parts. Positions are interpolated between the last two physics steps like the car itself (GS.alpha).
function db5Parts(body) {
  const C = CAR, L = C._l, q = DBQ, P = DB5.piv, v = GAD.v, pv = GAD.pv, al = GS.alpha;
  // revolving number plates: both drums turn a third of a turn per plate, easing in and out
  let x = pv[GV_PLATE] + (v[GV_PLATE] - pv[GV_PLATE]) * al; { const i = Math.floor(x), f = x - i; x = i + f * f * (3 - 2 * f); }
  q[0] = -x * (TAU / 3); q[1] = P[0]; q[2] = P[1]; db5RotZQ(L); db5Put(C.slotPlateF, body, L);
  q[1] = P[2]; q[2] = P[3]; db5RotZQ(L); db5Put(C.slotPlateR, body, L);
  // machine guns: the indicator lamps fold down and forwards about their hinge, then the barrels slide out
  x = pv[GV_LAMP] + (v[GV_LAMP] - pv[GV_LAMP]) * al; x = x * x * (3 - 2 * x);
  q[0] = -x * DB5G.lampFold; q[1] = P[4]; q[2] = P[5]; db5RotZQ(L); db5Put(C.slotGunLamp, body, L);
  x = pv[GV_GUN] + (v[GV_GUN] - pv[GV_GUN]) * al; x = x * x * (3 - 2 * x);
  q[0] = x * DB5G.gunSlide; q[1] = 0; q[2] = 0; db5MoveQ(L); db5Put(C.slotGuns, body, L);
  { const p = objParams(C.slotGuns); p[0] = v[GV_FLASHL]; p[1] = v[GV_FLASHR]; p[2] = v[GV_SEED]; }
  // bullet shield: up out of the boot lid, in its own plane
  x = pv[GV_SHIELD] + (v[GV_SHIELD] - pv[GV_SHIELD]) * al; x = x * x * (3 - 2 * x) * DB5G.shieldLift;
  q[0] = P[6] * x; q[1] = P[7] * x; q[2] = 0; db5MoveQ(L); db5Put(C.slotShield, body, L);
  // bumper rams: over-riders out on their telescopic arms
  x = pv[GV_RAM] + (v[GV_RAM] - pv[GV_RAM]) * al; x = x * x * (3 - 2 * x) * DB5G.ramOut;
  q[0] = x; q[1] = 0; q[2] = 0; db5MoveQ(L); db5Put(C.slotRamF, body, L);
  q[0] = -x; db5MoveQ(L); db5Put(C.slotRamR, body, L);
  // tyre slashers: out of the spinners of the rear wheels, turning with them; inside the hub (hidden) when retracted
  x = pv[GV_SLASH] + (v[GV_SLASH] - pv[GV_SLASH]) * al;
  if (x <= 0) { db5Hide(C.slotSlash[0]); db5Hide(C.slotSlash[1]); }
  else {
    const k = 0.25 + 0.75 * x * x; L.fill(0); L[0] = k; L[5] = k; L[10] = 1; L[15] = 1; L[14] = -(1 - x) * DB5G.slashOut;   // the blades open out as the shaft extends
    db5Put(C.slotSlash[0], objModel(C.slotWheel[2]), L); db5Put(C.slotSlash[1], objModel(C.slotWheel[3]), L);
  }
  // ejector seat: seat and roof panel fly on their own in the world from the moment of firing until they are back in place
  const te = v[GV_EJECT] > 0 ? pv[GV_EJECT] + (v[GV_EJECT] - pv[GV_EJECT]) * al : 0;
  if (te <= 0) {
    // in place: they are the body (coming back from the flight, they have no motion of their own for this frame)
    const back = DB5.ejLive; DB5.ejLive = false;
    for (let part = 0; part < 2; part++) {
      const s = part ? C.slotRoof : C.slotSeat, m = objModel(s), p = objPrev(s);
      if (back || m[15] === 0) p.set(objPrev(C.slotBody)); else p.set(m);
      m.set(body);
    }
  } else {
    if (!DB5.ejLive) { DB5.ejLive = true; DB5.ejT0 = te; DB5.ejB.set(body); DB5.ejHide[0] = DB5.ejHide[1] = 0; }
    const B0 = DB5.ejB, tt = te - DB5.ejT0;
    for (let part = 0; part < 2; part++) {
      const s = part ? C.slotRoof : C.slotSeat, o = 8 + part * 3;
      EJQ[0] = tt; gadEjectD(part);
      if (DB5.ejHide[part] || EJQ[2] < -(part ? EJ.roofFloor : EJ.seatFloor)) { DB5.ejHide[part] = 1; db5Hide(s); continue; }   // gone into the ground
      q[0] = tt * (part ? EJ.roofSpin : EJ.seatSpin); q[1] = P[o]; q[2] = P[o + 1]; db5RotZQ(L);
      const m = objModel(s); objPrev(s).set(m); m4mul(m, B0, L); m[12] += EJQ[1]; m[13] += EJQ[2]; m[14] += EJQ[3];
    }
  }
  // the driver's head is in the way of the cockpit camera
  if (GS.cam === 3 && !GS.freeCam) db5Hide(C.slotHead); else { L.fill(0); L[0] = L[5] = L[10] = L[15] = 1; db5Put(C.slotHead, body, L); }
  // needles of the two big dials: pivot and tip of each in atlas coordinates, for the shader (speed in mph, engine revs)
  {
    const p = objParams(C.slotBody), D = DB5_DIAL, r = DB5_AT.dials, du = r[2] - r[0], dv = r[3] - r[1];
    let f = GS.speed * 2.23694 / D.mph; if (f > 1.04) f = 1.04;
    let a = (D.a0 + D.sweep * f) * 0.017453292519943295, len = D.speedo[2] * 0.8 * dv;
    p[8] = r[0] + du * D.speedo[0]; p[9] = r[1] + dv * D.speedo[1]; p[10] = p[8] + Math.cos(a) * len * DB5.dialK; p[11] = p[9] + Math.sin(a) * len;
    f = VEH.rpm / D.rpm; if (f > 1.04) f = 1.04;
    a = (D.a0 + D.sweep * f) * 0.017453292519943295; len = D.tacho[2] * 0.8 * dv;
    p[12] = r[0] + du * D.tacho[0]; p[13] = r[1] + dv * D.tacho[1]; p[14] = p[12] + Math.cos(a) * len * DB5.dialK; p[15] = p[13] + Math.sin(a) * len;
  }
}
// The DB5 takes the place of the Uno in the contract the game uses
if (CARSEL === 'db5') Object.assign(CAR, DB5CAR);
// Isolated viewer (?scene=car) with the DB5: the gadget keys work (smoke and oil included), and W / S roll the car slowly
// forwards / backwards along the test floor, so that what it leaves behind can be seen.
function db5ViewTick() {
  const dt = RT[2], V = VEH, C = CAR; let n = (dt * 120 + 0.5) | 0; if (n < 1) n = 1; else if (n > 8) n = 8;
  V.vx = (GS.held & K_W) ? 7 : (GS.held & K_S) ? -4 : GS.viewRoll;
  for (let i = 0; i < n; i++) { V.x += V.vx * PHYS_DT; for (let k = 0; k < 4; k++) GS.spin[k] += V.vx / C.wheelR * PHYS_DT; gadStep(GS.held); }
  RT[1] = dt; RT[0] += dt; GS.alpha = 1; GS.speed = V.vx < 0 ? -V.vx : V.vx;
  m4translate(C._t, V.x, 0, V.z); C.inp[0] = 0; C.inp[1] = 0; C.place(C._t, GS.spin, C._z4);
  objParams(C.slotBody)[2] = GAD.v[GV_LIGHT];
  for (let i = 0; i < 4; i++) objParams(C.slotWheel[i])[0] = GS.speed / C.wheelR;
  fxFrame();
}
