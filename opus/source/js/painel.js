// ---------------------------------------------------------------------------
// painel.js — game dashboard on a 2D canvas over the picture: speedometer,
// tachometer, gear, lap timer, best lap and performance stats.
// Only exists in the game opened by a person. Per-frame drawing with no allocation:
// pre-drawn backgrounds and glyphs, only integers in the canvas calls.
// ---------------------------------------------------------------------------
'use strict';

const HUD = (() => {
  const H = {};
  const FF = '"Helvetica Neue", Helvetica, Arial, sans-serif', GL = '0123456789:.-RN,';
  const A0 = 135 * PI / 180, SW = 270 * PI / 180;
  let cvP, cvT, cvS, gP, gT, gS, bgP, bgT, bgS, fB, fM, fS, u = 1, made = false;
  const L = new Int32Array(12).fill(-1);       // last values drawn
  const D = new Int32Array(8);                 // centres and radii of the dials (px)
  const mk = (id) => { const c = document.createElement('canvas'); c.className = 'hud'; c.id = id; c.style.display = 'none'; document.body.appendChild(c); return c; };
  // tiled font: one cell per glyph of GL
  function font(px) {
    const cw = Math.ceil(px * 0.66), ch = Math.ceil(px * 1.2), cv = document.createElement('canvas');
    cv.width = cw * GL.length; cv.height = ch;
    const g = cv.getContext('2d'); g.font = `600 ${px}px ${FF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    for (let i = 0; i < GL.length; i++) g.fillText(GL[i], i * cw + cw / 2, ch / 2 + px * 0.04);
    return { cv, cw, ch, ad: Math.round(px * 0.58), ap: Math.round(px * 0.3) };
  }
  // draws glyph i with its corner at (x, y) and returns the new x (integers)
  function gl(g, f, i, x, y) {
    const a = (i >= 10 && i <= 12) || i === 15 ? f.ap : f.ad;
    g.drawImage(f.cv, i * f.cw, 0, f.cw, f.ch, x - ((f.cw - a) >> 1), y, f.cw, f.ch);
    return x + a;
  }
  // integer right-aligned at x
  function num(g, f, v, x, y) {
    do { x -= f.ad; gl(g, f, v % 10, x, y); v = (v / 10) | 0; } while (v > 0);
  }
  // time in hundredths (integer) as m:ss.cc; negative = no time
  function time(g, f, c, x, y) {
    if (c < 0) { x = gl(g, f, 12, x, y); x = gl(g, f, 10, x, y); x = gl(g, f, 12, x, y); x = gl(g, f, 12, x, y); x = gl(g, f, 11, x, y); x = gl(g, f, 12, x, y); gl(g, f, 12, x, y); return; }
    const m = (c / 6000) | 0, s = ((c - m * 6000) / 100) | 0, h = c % 100;
    if (m > 9) x = gl(g, f, ((m / 10) | 0) % 10, x, y);
    x = gl(g, f, m % 10, x, y); x = gl(g, f, 10, x, y); x = gl(g, f, (s / 10) | 0, x, y); x = gl(g, f, s % 10, x, y);
    x = gl(g, f, 11, x, y); x = gl(g, f, (h / 10) | 0, x, y); gl(g, f, h % 10, x, y);
  }
  function dial(g, cx, cy, r, max, major, minor, div, red, label) {
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = 'rgba(9,10,12,.62)'; g.fill();
    g.lineWidth = 1.5 * u; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
    if (red) { g.beginPath(); g.arc(cx, cy, r - 5 * u, A0 + SW * red / max, A0 + SW); g.lineWidth = 5 * u; g.strokeStyle = '#e03a1e'; g.stroke(); }
    g.font = `600 ${Math.round(r * 0.17)}px ${FF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= max + 1e-6; v += minor) {
      const a = A0 + SW * v / max, mj = Math.abs(v / major - Math.round(v / major)) < 1e-6, c = Math.cos(a), s = Math.sin(a);
      g.beginPath(); g.moveTo(cx + c * (r - 2 * u), cy + s * (r - 2 * u)); g.lineTo(cx + c * (r - (mj ? 13 : 7) * u), cy + s * (r - (mj ? 13 : 7) * u));
      g.lineWidth = (mj ? 2.2 : 1.2) * u; g.strokeStyle = mj ? '#fff' : 'rgba(255,255,255,.6)'; g.stroke();
      if (mj) { g.fillStyle = red && v >= red ? '#ff6a4a' : '#f2f2f2'; g.fillText(String(Math.round(v / div)), cx + c * (r - 26 * u), cy + s * (r - 26 * u)); }
    }
    g.font = `500 ${Math.round(r * 0.125)}px ${FF}`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(label, cx, cy - r * 0.36);
  }
  function plate(g, x, y, w, h) { g.fillStyle = 'rgba(9,10,12,.55)'; g.beginPath(); g.roundRect(x, y, w, h, 8 * u); g.fill(); }
  function size(c, w, h) { c.width = Math.round(w * u); c.height = Math.round(h * u); c.style.width = c.width / devicePixelRatio + 'px'; c.style.height = c.height / devicePixelRatio + 'px'; return c.getContext('2d'); }
  const bg = (c) => { const b = document.createElement('canvas'); b.width = c.width; b.height = c.height; return b; };

  H.resize = () => {
    if (!made) { cvP = mk('hp'); cvT = mk('ht'); cvS = mk('hs'); made = true; }
    u = clamp(Math.min(innerWidth / 1280, innerHeight / 720), 0.6, 2) * devicePixelRatio;   // 1 unit = 1 px in a 720p frame
    fB = font(Math.round(34 * u)); fM = font(Math.round(26 * u)); fS = font(Math.round(15 * u));
    // ---- dashboard: tachometer (left) and speedometer (right)
    gP = size(cvP, 420, 208);
    bgP = bg(cvP); let g = bgP.getContext('2d');
    dial(g, 104 * u, 110 * u, 88 * u, 7000, 1000, 500, 1000, 6300, 'rpm ×1000');
    dial(g, 312 * u, 104 * u, 100 * u, 200, 20, 10, 1, 0, 'km/h');
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(84 * u, 142 * u, 40 * u, 44 * u, 6 * u); g.fill();
    // ---- lap timer
    gT = size(cvT, 250, 112);
    bgT = bg(cvT); g = bgT.getContext('2d');
    plate(g, 0, 0, cvT.width, cvT.height);
    g.font = `600 ${Math.round(11 * u)}px ${FF}`; g.fillStyle = 'rgba(255,255,255,.72)'; g.textBaseline = 'middle';
    g.fillText('LAP', 14 * u, 30 * u); g.fillText('LAST', 14 * u, 68 * u); g.fillText('BEST', 14 * u, 92 * u);
    // ---- stats
    gS = size(cvS, 170, 86);
    bgS = bg(cvS); g = bgS.getContext('2d');
    plate(g, 0, 0, cvS.width, cvS.height);
    g.font = `600 ${Math.round(11 * u)}px ${FF}`; g.fillStyle = 'rgba(255,255,255,.72)'; g.textBaseline = 'middle';
    g.fillText('FRAMES/S', 12 * u, 20 * u); g.fillText('FRAME  ms', 12 * u, 44 * u); g.fillText('GPU  ms', 12 * u, 68 * u);
    D[0] = 104 * u; D[1] = 110 * u; D[2] = 88 * u; D[3] = 312 * u; D[4] = 104 * u; D[5] = 100 * u;
    L.fill(-1);
  };
  H.show = (panel, stats) => { if (!made) return; cvP.style.display = cvT.style.display = panel ? 'block' : 'none'; cvS.style.display = stats ? 'block' : 'none'; };

  function needle(g, cx, cy, r, f) {      // all integer; f in 1/4096 of full scale
    const a = A0 + SW * (f > 4180 ? 4180 : f) / 4096, c = Math.cos(a), s = Math.sin(a);
    g.beginPath(); g.moveTo((cx - c * r * 0.16) | 0, (cy - s * r * 0.16) | 0); g.lineTo((cx + c * r * 0.86) | 0, (cy + s * r * 0.86) | 0); g.stroke();
    g.beginPath(); g.arc(cx | 0, cy | 0, (r * 0.085) | 0, 0, 7); g.fill();
  }
  // LT: [current lap (s), last (s), best (s)] (−1 = no time); reads the car and the sound revs straight from the arrays
  H.draw = (car, LT) => {
    const kmh = Math.abs(car.u) * 3.6, rpm = SND.M[0], gear = car.reverse ? 13 : car.gear;
    const k10 = (kmh * 4) | 0, r10 = (rpm / 12) | 0;
    if (k10 !== L[0] || r10 !== L[1] || gear !== L[2]) {
      L[0] = k10; L[1] = r10; L[2] = gear;
      const g = gP, w = cvP.width, h = cvP.height;
      g.clearRect(0, 0, w, h); g.drawImage(bgP, 0, 0);
      num(g, fB, (kmh + 0.5) | 0, (312 * u + fB.ad * 1.5) | 0, (136 * u) | 0);
      gl(g, fB, gear, (104 * u - fB.ad / 2) | 0, (143 * u) | 0);
      g.strokeStyle = '#ff6a1f'; g.fillStyle = '#1b1c1f'; g.lineWidth = (3 * u) | 0; g.lineCap = 'round';
      needle(g, D[0], D[1], D[2], (rpm / 7000 * 4096) | 0);
      needle(g, D[3], D[4], D[5], (kmh / 200 * 4096) | 0);
    }
    const c0 = LT[0] < 0 ? -1 : (LT[0] * 100) | 0, c1 = LT[1] < 0 ? -1 : (LT[1] * 100 + 0.5) | 0, c2 = LT[2] < 0 ? -1 : (LT[2] * 100 + 0.5) | 0;
    if (c0 !== L[3] || c1 !== L[4] || c2 !== L[5]) {
      L[3] = c0; L[4] = c1; L[5] = c2;
      const g = gT;
      g.clearRect(0, 0, cvT.width, cvT.height); g.drawImage(bgT, 0, 0);
      time(g, fB, c0, (72 * u) | 0, (10 * u) | 0);
      time(g, fS, c1, (84 * u) | 0, (59 * u) | 0); time(g, fS, c2, (84 * u) | 0, (83 * u) | 0);
    }
  };
  // ST: [frames/s, ms per frame, GPU ms (−1 = unavailable)], updated 2×/s
  H.stats = (ST) => {
    const a = (ST[0] + 0.5) | 0, b = (ST[1] * 10 + 0.5) | 0, c = ST[2] < 0 ? -1 : (ST[2] * 10 + 0.5) | 0;
    if (a === L[6] && b === L[7] && c === L[8]) return;
    L[6] = a; L[7] = b; L[8] = c;
    const g = gS, x = (158 * u) | 0;
    g.clearRect(0, 0, cvS.width, cvS.height); g.drawImage(bgS, 0, 0);
    num(g, fS, a, x, (11 * u) | 0);
    dec(g, b, x, (35 * u) | 0);
    if (c < 0) gl(g, fS, 12, x - fS.ad, (59 * u) | 0); else dec(g, c, x, (59 * u) | 0);
  };
  function dec(g, v, x, y) {      // tenths, with a decimal point
    x -= fS.ad; gl(g, fS, v % 10, x, y); x -= fS.ap; gl(g, fS, 11, x, y); num(g, fS, (v / 10) | 0, x, y);
  }
  return H;
})();
