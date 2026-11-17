#!/usr/bin/env node
// Test bench for the game's sound synthesiser (fable/source/js/50_som.js). No browser: sndCore is plain JavaScript, so
// this script cuts it out of the source file, feeds it synthetic control streams (one set of 16 integers per 1/60 s frame,
// as the game records them) and measures what comes out. The glue around the synthesiser (sndControl, the worklet
// module built by sndStart, sndOffline) is run in a sandbox against a mock of the game.
//
//   node tools/snd_test.js [--src FILE] [--ref FILE|git-rev] [--wav DIR] [--only name,name,...] [--quiet]
//
//   --src   the sound source under test (default fable/source/js/50_som.js)
//   --ref   the reference for "the Uno must not change": a file, or a git revision of the source (default ac7d06c, the last
//           commit in which the Uno was the only car)
//   --wav   directory for audition files (16-bit stereo WAV, 48 kHz): DB5 drives from the four cameras, a drive-by and
//           every gadget; nothing is written without it
//   --only  run just the named tests (the names are the "== name" headings of the report)
//
// Every test prints its measurements; a failed check is marked FAIL and the process exits with status 1.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..'), SRC = path.resolve(arg('src', path.join(ROOT, 'fable/source/js/50_som.js')));
const REF = arg('ref', 'ac7d06c'), WAV = arg('wav', null), ONLY = arg('only', null), QUIET = process.argv.includes('--quiet');
const SR = 48000, FR = 800;                       // sample rate and samples per 1/60 s frame, as in sndOffline

// ---------------------------------------------------------------------------------------------------------- loading
function readRef() {
  if (fs.existsSync(REF)) return fs.readFileSync(REF, 'utf8');
  return cp.execFileSync('git', ['show', REF + ':fable/source/js/50_som.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
}
// source text of a top-level function (brace matching that skips comments and strings)
function fnText(src, name) {
  const a = src.indexOf('function ' + name + '('); if (a < 0) return null;
  let i = src.indexOf('{', a), d = 0;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { for (i++; src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return src.slice(a, i + 1);
  }
  throw new Error('unbalanced function ' + name);
}
const srcNew = fs.readFileSync(SRC, 'utf8'), srcRef = readRef();
// patch: [[text, replacement], ...] applied to the source of sndCore (used to count rare events; every text must be found)
const mkCore = (src, patch) => { let t = fnText(src, 'sndCore'); for (const [a, b] of patch || []) { if (!t.includes(a)) throw new Error('patch text not found: ' + a); t = t.split(a).join(b); } return new Function(t + '\nreturn sndCore;')(); };
const coreNew = mkCore(srcNew), coreRef = mkCore(srcRef);
const warmNew = new Function(fnText(srcNew, 'sndWarm') + '\nreturn sndWarm;')();

// ---------------------------------------------------------------------------------------------------------- controls
// One frame of controls from a description in physical units (see the layout at the top of 50_som.js).
function frame(rec, f, o) {
  const c = rec.subarray(f * 16, f * 16 + 16);
  c[0] = (o.run === 0 ? 0 : 1) | (o.mute ? 2 : 0) | ((o.cam || 0) << 2) | (o.db5 ? 16 : 0);
  c[1] = o.rpm === undefined ? 900 : o.rpm; c[2] = (o.thr || 0) * 1000; c[3] = o.gear === undefined ? 1 : o.gear; c[4] = (o.speed || 0) * 100;
  c[5] = (o.slipL || 0) * 1000; c[6] = (o.slipR || 0) * 1000; c[7] = (o.loose || 0) * 1000; c[8] = (o.kerb || 0) * 1000;
  c[9] = (o.dist === undefined ? 5.5 : o.dist) * 10; c[10] = (o.dop || 1) * 10000; c[11] = (o.lsp === undefined ? (o.speed || 0) : o.lsp) * 100;
  c[12] = (o.crowd || 0) * 1000; c[13] = (o.side || 0) * 1000; c[14] = o.hits || 0;
  c[15] = (o.gad || 0) | ((o.ej || 0) & 31) << 5 | ((o.es || 0) & 63) << 10;
}
// stream of n frames; fn(f, t) returns the description of frame f (t in seconds)
function stream(n, fn) { const rec = new Int32Array(n * 16); for (let f = 0; f < n; f++) frame(rec, f, fn(f, f / 60)); return rec; }
const steady = (secs, o) => stream(Math.round(secs * 60), () => o);
// render like sndOffline: one frame of controls every 1/60 s; mixMask = bits of the layers; opt.block = samples per render() call
function render(core, rec, mixMask, opt) {
  opt = opt || {}; const sr = opt.sr || SR, fr = Math.round(sr / 60), n = rec.length / 16, S = opt.core || core(sr), L = new Float32Array(n * fr), R = new Float32Array(n * fr), blk = opt.block || fr;
  if (mixMask === undefined) mixMask = 127;
  for (let i = 0; i < S.mix.length; i++) S.mix[i] = (mixMask >> i) & 1;
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 16; k++) S.ctl[k] = rec[f * 16 + k];
    for (let o = 0; o < fr; o += blk) S.render(L, R, f * fr + o, Math.min(blk, fr - o));
  }
  return { L, R, n: n * fr, sr };
}
// a little car to make plausible runs: accelerates through the gears, changing up at `shift` rpm
const CARS = {
  db5: { gears: [2.73, 1.76, 1.23, 1.0, 0.834], final: 3.77, R: 0.34, idle: 750, shift: 5800, acc: [6.2, 4.3, 3.0, 2.1, 1.4], db5: 1 },
  uno: { gears: [3.91, 2.16, 1.48, 1.12, 0.9], final: 4.07, R: 0.281, idle: 900, shift: 6250, acc: [4.6, 3.0, 2.0, 1.4, 1.0], db5: 0 },
};
// thrFn(t) → throttle 0..1 (negative = brake); returns the stream and the per-frame rpm / gear / speed it went through.
// speedOf: a log from another run — the car then follows that speed trace (same road speed, its own gearing and revs).
function drive(car, secs, thrFn, extra, speedOf) {
  const C = CARS[car], n = Math.round(secs * 60), rec = new Int32Array(n * 16), log = { rpm: new Float64Array(n), gear: new Int32Array(n), speed: new Float64Array(n), thr: new Float64Array(n) };
  let v = 0, g = 1, rpm = C.idle;
  for (let f = 0; f < n; f++) {
    const t = f / 60, th = thrFn(t), thr = th > 0 ? th : 0, k = 60 / (2 * Math.PI * C.R) * C.final;
    if (speedOf) v = speedOf.speed[f];
    let wr = v * k * C.gears[g - 1];
    if (wr > C.shift && g < 5) { g++; wr = v * k * C.gears[g - 1]; } else if (g > 1 && v * k * C.gears[g - 2] < C.shift * 0.62) { g--; wr = v * k * C.gears[g - 1]; }
    const tgt = Math.max(C.idle, wr, (C.idle + 350 + thr * 1900) * Math.max(0, 1 - v / 6)); rpm += (tgt - rpm) * 0.4;
    const o = Object.assign({ db5: C.db5, rpm, thr, gear: g, speed: v }, extra ? extra(t, f, { rpm, gear: g, speed: v, thr }) : null);
    frame(rec, f, o); log.rpm[f] = rpm; log.gear[f] = g; log.speed[f] = v; log.thr[f] = thr;
    v += ((thr * C.acc[g - 1] * (rpm < C.shift + 200 ? 1 : 0)) - (th < 0 ? -th * 9 : 0) - 0.25 - 0.0009 * v * v) / 60; if (v < 0) v = 0;
  }
  return { rec, log, n };
}
// pseudo-random but plausible game: every control wanders; cameras, gears, crashes, mute and pause all happen
function wander(n, seed, db5, gadgets, noStops) {
  let q = seed >>> 0; const r = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  let rpm = 900, thr = 0, gear = 1, speed = 0, cam = 0, hits = 0, mute = 0, run = 1, sl = 0, sr = 0, loose = 0, kerb = 0, dist = 5.5, dop = 1, crowd = 0, side = 0, gad = 0, ej = 0, es = 0;
  return stream(n, () => {
    if (r() < 0.03) thr = r() < 0.3 ? 0 : r(); if (r() < 0.01) gear = Math.floor(r() * 6); if (r() < 0.006) cam = Math.floor(r() * (db5 ? 4 : 3));
    rpm += ((thr > 0.1 ? 6700 : 900) - rpm) * 0.01 * (0.5 + r()); speed += ((thr > 0.1 ? 55 : 0) - speed) * 0.004;
    if (r() < 0.004) hits++; if (r() < 0.02) sl = r() < 0.5 ? 0 : r(); if (r() < 0.02) sr = r() < 0.5 ? 0 : r(); if (r() < 0.01) loose = r() < 0.6 ? 0 : r(); if (r() < 0.01) kerb = r() < 0.6 ? 0 : r();
    if (r() < 0.01) dist = cam === 2 ? 3 + r() * 250 : 5.5; dop = cam === 2 ? 0.9 + r() * 0.2 : 1; if (r() < 0.01) { crowd = r(); side = r() * 2 - 1; }
    if (r() < 0.002) mute ^= 1; if (r() < 0.002) run ^= 1; if (noStops) { mute = 0; run = 1; }
    if (gadgets) { if (r() < 0.02) gad = Math.floor(r() * 32); if (r() < 0.004) ej++; if (r() < 0.01) es++; }
    return { run, mute, cam, db5, rpm, thr, gear, speed, slipL: sl, slipR: sr, loose, kerb, dist, dop, lsp: cam === 2 ? 0 : speed, crowd, side, hits: hits & 1023, gad, ej, es };
  });
}
// the control pattern of the worklet's warm-up as it was before the DB5 (1600 blocks of 128 samples)
function oldWarm(S, L, R) {
  const c = S.ctl;
  for (let i = 0; i < 1600; i++) {
    c[0] = 1 | (i >> 8) % 3 << 2; c[1] = 900 + i * 37 % 5600; c[2] = i * 13 % 1001; c[3] = (i >> 6) % 6; c[4] = i * 29 % 5000; c[5] = i & 256 ? i * 7 % 1000 : 0; c[6] = i & 512 ? i * 11 % 1000 : 0; c[7] = i & 128 ? 500 : 0; c[8] = i & 64 ? 500 : 0;
    c[9] = i * 3 % 900; c[10] = 9000 + i * 17 % 2000; c[11] = i * 29 % 5000; c[12] = i * 5 % 1000; c[13] = i * 19 % 2000 - 1000; c[14] = i >> 5; S.render(L, R, L.length > 128 ? i * 128 : 0, 128);
  }
}

// ---------------------------------------------------------------------------------------------------------- analysis
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// magnitude spectrum (Hann window; a steady sine of amplitude A shows a peak of height A); mag[k] is at k * sr / N Hz
function spec(x, start, N) {
  const re = new Float64Array(N), im = new Float64Array(N); let ws = 0;
  for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); ws += w; re[i] = (x[start + i] || 0) * w; }
  fft(re, im); const mag = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) * 2 / ws;
  return mag;
}
const mono = (o) => { const m = new Float32Array(o.n); for (let i = 0; i < o.n; i++) m[i] = (o.L[i] + o.R[i]) * 0.5; return m; };
function peak(mag, N, f0, f1, sr) {
  sr = sr || SR; let b = -1, a = 0; const k0 = Math.max(1, Math.round(f0 * N / sr)), k1 = Math.min(mag.length - 2, Math.round(f1 * N / sr));
  for (let k = k0; k <= k1; k++) if (mag[k] > a) { a = mag[k]; b = k; }
  if (b < 0) return { f: 0, a: 0 };
  const l = Math.log(mag[b - 1] + 1e-30), c = Math.log(mag[b] + 1e-30), r = Math.log(mag[b + 1] + 1e-30), d = (l - r) / (2 * (l - 2 * c + r) || 1);
  return { f: (b + (Math.abs(d) < 1 ? d : 0)) * sr / N, a };
}
const line = (mag, N, f, tol, sr) => peak(mag, N, f * (1 - tol), f * (1 + tol), sr).a;
function band(mag, N, f0, f1, sr) { sr = sr || SR; let s = 0; for (let k = Math.max(1, Math.round(f0 * N / sr)); k < Math.min(mag.length, Math.round(f1 * N / sr)); k++) s += mag[k] * mag[k]; return Math.sqrt(s * 0.5 / 1.5); }   // ≈ rms in the band (Hann: 1.5 bins of noise bandwidth)
function centroid(mag, N, f0, f1) { let s = 0, w = 0; for (let k = Math.round(f0 * N / SR); k < Math.round(f1 * N / SR); k++) { const p = mag[k] * mag[k]; s += p * k; w += p; } return w ? s / w * SR / N : 0; }
function rms(x, a, b) { a = a || 0; b = b === undefined ? x.length : b; let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
function pk(x, a, b) { a = a || 0; b = b === undefined ? x.length : b; let p = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > p) p = v; } return p; }
const sec = t => Math.round(t * SR);
const dB = v => 20 * Math.log10(v + 1e-30);
// pitch (Hz) of n samples from start, by autocorrelation, searched between fmin and fmax
function pitch(x, start, n, fmin, fmax) { let best = 0, bl = 0; for (let lag = Math.floor(SR / fmax); lag <= Math.ceil(SR / fmin); lag++) { let s = 0; for (let i = 0; i < n; i++) s += x[start + i] * x[start + i + lag]; if (s > best) { best = s; bl = lag; } } return bl ? SR / bl : 0; }
// spread (standard deviation / mean) of a list
const spread = a => { const mu = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - mu) * (q - mu), 0) / a.length) / mu; };
function bad(o) { let nan = 0, pkv = 0; for (const x of [o.L, o.R]) for (let i = 0; i < o.n; i++) { const v = x[i]; if (!(v === v) || v === Infinity || v === -Infinity) nan++; else if (Math.abs(v) > pkv) pkv = Math.abs(v); } return { nan, pk: pkv }; }
// onsets: times (s) at which the differenced, peak-followed signal jumps above thr × its maximum (re-arms below thr / 3, at least gap s apart)
function onsets(x, a, b, thr, gap, decayMs) {
  const dk = Math.exp(-1 / (SR * (decayMs || 3) * 0.001)), e = new Float32Array(b - a); let env = 0, mx = 0;
  for (let i = a + 1; i < b; i++) { const d = Math.abs(x[i] - x[i - 1]); env = d > env ? d : env * dk; e[i - a] = env; if (env > mx) mx = env; }
  const out = []; let armed = true, last = -1e9; if (mx < 1e-6) return out;   // nothing there but the filters' anti-denormal bias
  for (let i = 0; i < e.length; i++) { if (armed && e[i] > thr * mx && i - last > gap * SR) { out.push((a + i) / SR); armed = false; last = i; } else if (!armed && e[i] < thr * mx / 3) armed = true; }
  return out;
}
const sameBits = (a, b) => { if (a.length !== b.length) return -1; const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length); let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; return d; };
function hash(o) { let h = 2166136261; for (const x of [o.L, o.R]) { const u = new Uint32Array(x.buffer, x.byteOffset, x.length); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } } return (h >>> 0).toString(16).padStart(8, '0'); }
const wavs = [];
function wav(name, o) {
  if (!WAV) return; fs.mkdirSync(WAV, { recursive: true });
  const n = o.n, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(o.sr || SR, 24);
  b.writeUInt32LE((o.sr || SR) * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(o.L[i] * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(o.R[i] * 32767))), 46 + i * 4); }
  fs.writeFileSync(path.join(WAV, name), b); wavs.push(name + '  (' + (n / (o.sr || SR)).toFixed(1) + ' s)');
}
// Silence of a layer rendered alone: below 1e-9 (-180 dB). It is not exactly zero because the car bus goes through two
// filters that add 1e-18 per sample against denormals — as they always did; a voice that is still decaying is far above it.
const EPS = 1e-9;
const quietIn = (o, t0, t1) => pk(o.L, sec(t0), sec(t1)) < EPS && pk(o.R, sec(t0), sec(t1)) < EPS;
const zeroIn = (o, t0, t1) => pk(o.L, sec(t0), sec(t1)) === 0 && pk(o.R, sec(t0), sec(t1)) === 0;
// when the output falls silent for good, s (searching back from the end)
const lastSound = (o) => { let i = o.n - 1; while (i >= 0 && Math.abs(o.L[i]) < EPS && Math.abs(o.R[i]) < EPS) i--; return (i + 1) / SR; };

// ---------------------------------------------------------------------------------------------------------- report
let fails = 0, checks = 0; const failed = [];
const say = (...a) => { if (!QUIET) console.log(...a); };
function check(ok, what, detail) { checks++; if (!ok) { fails++; failed.push(what); } console.log((ok ? '  ok   ' : '  FAIL ') + what + (detail !== undefined ? '   [' + detail + ']' : '')); return ok; }
const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2), f3 = v => v.toFixed(3), f4 = v => v.toFixed(4);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// source patches that count rare events (see mkCore); the counters live in globalThis
const COUNTERS = [['pw = 2.3; pc = 1;', 'pw = 2.3; pc = 1; globalThis.__pops++;'], ['GI[IJQ]--;', 'GI[IJQ]--; globalThis.__seats++;'], ['GI[ISQ]--;', 'GI[ISQ]--; globalThis.__clunks++;'], ['sd ^= 1;', 'sd ^= 1; globalThis.__shots++;'],
  ['if (r2 < misT) {', 'if (r2 < misT) { globalThis.__miss++;'], ['else { crk = 1;', 'else { globalThis.__crank++; crk = 1;'], ['if (f < 0.02) GI[IST] = 3;', 'globalThis.__flare++; if (f < 0.02) GI[IST] = 3;'], ['if (te > 2.3) GI[IJA] = 0;', 'if (te > 2.3) { GI[IJA] = 0; globalThis.__seatEnd++; }'],
  ['a = r < 0 ? -r : r; if (a > 0.55) {', 'a = r < 0 ? -r : r; if (a > 0.55) { globalThis.__lim++;'], ['oL.fill(0); oR.fill(0); GI[ILA] = 0;', 'oL.fill(0); oR.fill(0); GI[ILA] = 0; globalThis.__frozen++;']];

// ========================================================================================================== tests
test('uno-identical', () => {
  say('Uno: the output of the new synthesiser against the reference (' + (fs.existsSync(REF) ? REF : 'git ' + REF) + '), bit for bit');
  let total = 0, diff = 0; const cmp = (a, b, what) => { const d = sameBits(a.L, b.L) + sameBits(a.R, b.R); total += a.n * 2; diff += d; check(d === 0, what, a.n * 2 + ' samples, ' + d + ' differ, hash ' + hash(b)); };
  // the old warm-up pattern, then again after reset()
  { const A = coreRef(SR), B = coreNew(SR), n = 1600 * 128, a = { L: new Float32Array(n), R: new Float32Array(n), n }, b = { L: new Float32Array(n), R: new Float32Array(n), n };
    oldWarm(A, a.L, a.R); oldWarm(B, b.L, b.R); cmp(a, b, 'warm-up pattern of the worklet (1600 blocks of 128)');
    A.reset(); B.reset(); oldWarm(A, a.L, a.R); oldWarm(B, b.L, b.R); cmp(a, b, 'the same after reset()'); }
  for (const [seed, blk, sr] of [[1, 800, SR], [2, 128, SR], [3, 1024, SR], [4, 37, SR], [5, 735, 44100]]) {
    const rec = wander(60 * 40, seed, 0, 0); cmp(render(coreRef, rec, 63, { block: blk, sr }), render(coreNew, rec, 127, { block: blk, sr }), 'wandering controls, seed ' + seed + ', blocks of ' + blk + ', ' + sr + ' Hz (40 s)');
  }
  { const d = drive('uno', 45, t => t < 1 ? 0 : t < 24 ? 1 : t < 28 ? 0 : t < 31 ? -1 : (Math.sin(t * 2) > 0 ? 1 : 0), (t, f) => ({ cam: (f / 400 | 0) % 3, slipL: t > 30 ? 0.5 + 0.5 * Math.sin(t) : 0, slipR: t > 33 ? 0.4 : 0, kerb: t > 35 && t < 37 ? 0.5 : 0, loose: t > 38 && t < 40 ? 0.75 : 0, crowd: t < 6 ? 0.8 : 0, hits: t > 41 ? 1 : 0 }));
    cmp(render(coreRef, d.rec, 63), render(coreNew, d.rec, 127), 'a run through the gears with braking, slip, kerbs, gravel, crowd and a crash (45 s)');
    for (let l = 0; l < 6; l++) cmp(render(coreRef, d.rec.subarray(0, 16 * 600), 1 << l), render(coreNew, d.rec.subarray(0, 16 * 600), 1 << l), 'layer ' + l + ' alone (10 s)');
    // gadget bits in control 15 must not reach the Uno
    const g = d.rec.slice(0, 16 * 900); for (let f = 0; f < 900; f++) g[f * 16 + 15] = (f * 7919) & 65535;
    cmp(render(coreRef, d.rec.subarray(0, 16 * 900), 63), render(coreNew, g, 127), 'control 15 full of gadget bits, Uno selected (15 s)'); }
  say('  total: ' + total + ' samples compared, ' + diff + ' different');
});

test('engine-order', () => {
  say('Engine alone (layer 0), chase camera, steady revs: strongest spectral line against the firing frequency');
  const N = 65536, rows = [];
  for (const [car, ord, lst] of [['db5', 3, [750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000]], ['uno', 2, [900, 1500, 2500, 3500, 4500, 5500, 6500]]]) for (const thr of [1, 0.3]) for (const rpm of lst) {
    const o = render(coreNew, steady(4.6, { db5: car === 'db5', rpm, thr, gear: 3, speed: 25 }), 1), m = mono(o), mg = spec(m, sec(3.2), N), p = peak(mg, N, 15, 3000), ff = ord * rpm / 60;
    const l15 = line(mg, N, ff / 2, 0.04), l3 = line(mg, N, ff, 0.04), l6 = line(mg, N, ff * 2, 0.04), mgL = spec(o.L, sec(3.2), N), pL = peak(mgL, N, 15, 3000);
    rows.push({ car, thr, rpm, ff, f: p.f, ordPk: p.f / (rpm / 60), half: dB(l15 / l3), dbl: dB(l6 / l3), rms: rms(m, sec(3.2)), pk: pk(m, sec(3.2)), fL: pL.f });
  }
  say('  car  thr   rpm  firing Hz  peak Hz  order  half-line dB  2x-line dB   rms     peak');
  for (const r of rows) say('  ' + r.car + '  ' + f1(r.thr) + '  ' + String(r.rpm).padStart(4) + '   ' + f1(r.ff).padStart(6) + '   ' + f1(r.f).padStart(6) + '  ' + f2(r.ordPk).padStart(5) + '    ' + f1(r.half).padStart(6) + '      ' + f1(r.dbl).padStart(6) + '   ' + f4(r.rms) + '  ' + f3(r.pk));
  const d = rows.filter(r => r.car === 'db5');
  check(d.every(r => Math.abs(r.f / r.ff - 1) < (r.rpm < 1100 ? 0.04 : 0.015)), 'DB5: the strongest line is the firing line, 3 × rpm / 60, at every speed and both throttle openings', 'worst error ' + f2(Math.max(...d.map(r => Math.abs(r.f / r.ff - 1))) * 100) + ' %');
  check(d.every(r => Math.abs(r.fL / r.ff - 1) < (r.rpm < 1100 ? 0.04 : 0.015)), 'DB5: the same in the left channel alone (the twin-pipe spread does not take over)');
  const hs = d.filter(r => r.rpm >= 1500).map(r => r.half);
  check(Math.max(...hs) < -11 && Math.min(...hs) > -32, 'DB5: a smooth six — the 1.5-order line (one pipe of the two) is only a trace under the firing line, from 1,500 rpm up', f1(Math.min(...hs)) + ' .. ' + f1(Math.max(...hs)) + ' dB');
  const u = rows.filter(r => r.car === 'uno');
  check(u.every(r => { const k = r.f / (r.rpm / 60); return Math.abs(k - Math.round(k * 2) / 2) < 0.04; }), 'Uno: the strongest line sits on the four-cylinder series (2 × rpm / 60 and its multiples)', 'orders ' + u.map(r => f2(r.ordPk)).join(' '));
  // the Uno's spectrum is the reference's spectrum
  const a = render(coreRef, steady(3, { rpm: 3500, thr: 1, gear: 3, speed: 25 }), 1), b = render(coreNew, steady(3, { rpm: 3500, thr: 1, gear: 3, speed: 25 }), 1);
  check(sameBits(a.L, b.L) === 0, 'Uno: steady 3,500 rpm is the reference, bit for bit');
});

test('engine-timbre', () => {
  say('DB5 engine: level and brightness against throttle and revs (chase camera, engine layer)');
  const N = 32768, rows = [];
  for (const rpm of [1500, 2500, 3500, 4500, 5500]) for (const thr of [0, 0.25, 0.5, 1]) {
    const m = mono(render(coreNew, steady(3.2, { db5: 1, rpm, thr, gear: 3, speed: 25 }), 1)), mg = spec(m, sec(2.2), N);
    rows.push({ rpm, thr, rms: rms(m, sec(2.2)), pk: pk(m, sec(2.2)), cen: centroid(mg, N, 20, 8000), hi: band(mg, N, 1800, 4500), lo: band(mg, N, 30, 400), mid: band(mg, N, 400, 1800) });
  }
  say('   rpm  thr    rms    peak   crest  centroid Hz  30-400 Hz  0.4-1.8 kHz  1.8-4.5 kHz (rasp)');
  for (const r of rows) say('  ' + String(r.rpm).padStart(4) + '  ' + f2(r.thr) + '  ' + f4(r.rms) + '  ' + f3(r.pk) + '   ' + f1(r.pk / r.rms) + '    ' + f1(r.cen).padStart(7) + '     ' + f4(r.lo) + '     ' + f4(r.mid) + '      ' + f4(r.hi));
  const at = (rpm, thr) => rows.find(r => r.rpm === rpm && r.thr === thr), all = [1500, 2500, 3500, 4500, 5500];
  check(all.every(r => at(r, 1).rms > at(r, 0.5).rms && at(r, 0.5).rms > at(r, 0.25).rms && at(r, 0.25).rms > at(r, 0).rms), 'level rises with throttle at every speed', 'full / closed at 3,500 rpm: ' + f1(dB(at(3500, 1).rms / at(3500, 0).rms)) + ' dB');
  check(all.every(r => at(r, 1).cen > at(r, 0.25).cen * 1.3 && at(r, 0.5).cen > at(r, 0.25).cen), 'timbre gets brighter with throttle (spectral centroid)', 'at 3,500 rpm: ' + [0, 0.25, 0.5, 1].map(t => f1(at(3500, t).cen)).join(' → ') + ' Hz');
  check(at(5500, 1).rms > at(1500, 1).rms * 1.3, 'level rises with revs', f1(dB(at(5500, 1).rms / at(1500, 1).rms)) + ' dB from 1,500 to 5,500 rpm, full throttle');
  const rr = r => at(r, 1).hi / at(r, 1).rms;
  check(rr(5500) > rr(4500) * 1.2 && rr(4500) > rr(3500) * 1.15 && rr(5500) > rr(2500) * 2.2, 'rasp (1.8-4.5 kHz share of the level) grows above 3,500 rpm', [1500, 2500, 3500, 4500, 5500].map(r => f3(rr(r))).join(' → '));
  check(all.every(r => at(r, 1).lo > at(r, 1).mid && at(r, 1).mid > at(r, 1).hi), 'deep before bright at every speed: most of the level below 400 Hz, least above 1.8 kHz');
  // against the Uno: deeper and smoother
  const mu = mono(render(coreNew, steady(3.2, { rpm: 3500, thr: 1, gear: 3, speed: 25 }), 1)), cu = centroid(spec(mu, sec(2.2), N), N, 20, 8000), cru = pk(mu, sec(2.2)) / rms(mu, sec(2.2));
  check(at(3500, 1).cen < cu * 0.92, 'deeper than the Uno at the same speed and throttle', 'centroid ' + f1(at(3500, 1).cen) + ' Hz against ' + f1(cu) + ' Hz');
  check(at(3500, 1).pk / at(3500, 1).rms < cru * 0.85, 'smoother than the Uno: lower crest factor (peak / rms), the sign of a wave rather than a string of spikes', f1(at(3500, 1).pk / at(3500, 1).rms) + ' against ' + f1(cru));
});

test('idle', () => {
  say('DB5 idling at 750 rpm (the stream starts with the starter motor: analysed from 3 s on)');
  const o = render(coreNew, steady(11, { db5: 1, rpm: 750, thr: 0, gear: 1, speed: 0 }), 1), m = mono(o), N = 65536, mg = spec(m, sec(3), N), p = peak(mg, N, 15, 400);
  // strength of each pair of firings (one from each pipe): peak of |x| in windows of two firing periods
  const T = 2 * SR / 37.5, pkv = []; for (let k = 0; k < 140; k++) pkv.push(pk(m, Math.round(sec(3) + k * T), Math.round(sec(3) + (k + 1) * T)));
  const u = mono(render(coreNew, steady(8, { rpm: 900, thr: 0, gear: 1, speed: 0 }), 1)), Tu = 2 * SR / 30, pku = []; for (let k = 0; k < 100; k++) pku.push(pk(u, Math.round(sec(3) + k * Tu), Math.round(sec(3) + (k + 1) * Tu)));
  say('  rms ' + f4(rms(m, sec(3))) + '   peak ' + f3(pk(m, sec(3))) + '   strongest line ' + f1(p.f) + ' Hz (firing 37.5 Hz)   spread of the firing strength ' + f1(spread(pkv) * 100) + ' %');
  say('  for comparison, the Uno idling at 900 rpm: rms ' + f4(rms(u, sec(3))) + ', peak ' + f3(pk(u, sec(3))) + ', spread ' + f1(spread(pku) * 100) + ' %');
  check(Math.abs(p.f / 37.5 - 1) < 0.04, 'idle fires at 37.5 Hz (3 × 750 / 60)', f1(p.f) + ' Hz');
  check(spread(pkv) > 0.12, 'lumpy: the firings are uneven', f1(spread(pkv) * 100) + ' %');
  check(rms(m, sec(3)) > 0.003 && rms(m, sec(3)) < rms(u, sec(3)) * 1.6, 'audible at idle, and within 4 dB of the Uno\'s idle', f1(dB(rms(m, sec(3)) / rms(u, sec(3)))) + ' dB');
});

test('starter', () => {
  say('DB5 starter: the synthesiser starts running with the car at rest');
  const o = render(coreNew, steady(3, { db5: 1, rpm: 750, thr: 0, gear: 1, speed: 0 }), 1), m = mono(o), N = 8192;
  const a = spec(m, sec(0.1), N), b = spec(m, sec(1.6), N), w = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5].map(t => f4(rms(m, sec(t), sec(t + 0.1))));
  // the pinion whirrs at 380 Hz and its harmonics, each pulled down as much as 14 % by every compression
  const st = s => Math.hypot(band(s, N, 315, 395), band(s, N, 640, 790), band(s, N, 960, 1180));
  const e = []; for (let t = 0.05; t < 0.44; t += 0.008) e.push(rms(m, sec(t), sec(t + 0.008)));
  say('  rms in 0.1 s windows from t = 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5 s: ' + w.join(' '));
  say('  while cranking: pinion bands (380 Hz and two harmonics) ' + f4(st(a)) + ' against ' + f4(st(b)) + ' once idling; level in 8 ms windows swings between ' + f4(Math.min(...e)) + ' and ' + f4(Math.max(...e)));
  check(st(a) > 0.003 && st(a) > 4 * st(b), 'the starter motor whirrs while cranking, and is gone once the engine idles');
  check(Math.max(...e) > 1.6 * Math.min(...e), 'the cranking has the rhythm of the compressions');
  const fl = rms(m, sec(0.5), sec(0.75)), cr = rms(m, sec(0.1), sec(0.4)), id = rms(m, sec(2), sec(3));
  check(fl > cr * 1.15 && fl > id * 1.8, 'the engine catches with a flare: the loudest moment of the start', 'rms ' + f4(cr) + ' cranking, ' + f4(fl) + ' catching, ' + f4(id) + ' idling');
  // no starter when the stream starts with the car moving
  const o2 = render(coreNew, steady(1, { db5: 1, rpm: 3000, thr: 0.5, gear: 2, speed: 20 }), 1), m2 = mono(o2), p2 = peak(spec(m2, sec(0.3), N), N, 30, 2000);
  check(Math.abs(p2.f / 150 - 1) < 0.03, 'no starter if the stream begins with the car under way', 'firing line at ' + f1(p2.f) + ' Hz from the first third of a second');
  // throttle during the cranking: the engine catches at once
  const o3 = render(coreNew, stream(120, (f, t) => ({ db5: 1, rpm: t < 0.2 ? 750 : 2500, thr: t < 0.2 ? 0 : 1, gear: 1, speed: 0 })), 1), m3 = mono(o3);
  check(rms(m3, sec(0.35), sec(0.5)) > 3 * rms(m3, sec(0.05), sec(0.2)), 'throttle during the cranking cuts it short', 'rms ' + f4(rms(m3, sec(0.05), sec(0.2))) + ' → ' + f4(rms(m3, sec(0.35), sec(0.5))));
  // blocks that come before the first controls (engine speed 0, as in the game's first moments): nothing, then the starter
  const o4 = render(coreNew, stream(120, (f) => f < 3 ? { db5: 1, rpm: 0, thr: 0, gear: 0, speed: 0, dist: 0, dop: 0.0001 } : { db5: 1, rpm: 750, thr: 0, gear: 1, speed: 0 }), 1), m4 = mono(o4);
  check(pk(m4, 0, sec(0.05)) < 1e-9 && st(spec(m4, sec(0.15), N)) > 0.003, 'the engine waits, silent, for the first controls, and then cranks', 'peak ' + pk(m4, 0, sec(0.05)).toExponential(1) + ' in the first 50 ms');
  // the Uno has none
  const a1 = render(coreRef, steady(1, { rpm: 900 }), 1), b1 = render(coreNew, steady(1, { rpm: 900 }), 1);
  check(sameBits(a1.L, b1.L) === 0, 'the Uno starts as before');
  wav('db5_start_idle_blip.wav', render(coreNew, stream(60 * 7, (f, t) => ({ db5: 1, cam: 1, dist: 1.5, rpm: t > 3.5 && t < 4.6 ? 750 + 3200 * Math.sin((t - 3.5) / 1.1 * Math.PI) : t > 5.2 && t < 6.2 ? 750 + 2200 * Math.sin((t - 5.2) * Math.PI) : 750, thr: (t > 3.5 && t < 4.0) || (t > 5.2 && t < 5.6) ? 1 : 0, gear: 1, speed: 0 })), 127));
});

test('run-gears', () => {
  say('DB5 full-throttle run from rest through the gears, then lift-off (chase camera)');
  const thr = t => t < 1.5 ? 0 : t < 22 ? 1 : 0, d = drive('db5', 30, thr), o = render(coreNew, d.rec, 1), m = mono(o), N = 8192;
  // spectral peak against 3 × rpm / 60 every quarter of a second while on full throttle
  let n = 0, okc = 0, worst = 0;
  for (let t = 3; t < 21.5; t += 0.25) {
    const f = Math.round(t * 60), r0 = d.log.rpm[f - 5], r1 = d.log.rpm[f + 5]; if (d.log.gear[f - 12] !== d.log.gear[f + 12] || Math.abs(r1 - r0) > 250) continue;   // away from the gear changes
    const p = peak(spec(m, sec(t) - N / 2, N), N, 25, 2500), ff = 3 * d.log.rpm[f] / 60, e = Math.abs(p.f / ff - 1); n++; if (e < 0.04) okc++; if (e > worst) worst = e;
  }
  check(okc === n && n > 30, 'the spectral peak follows 3 × rpm / 60 through the run', okc + ' of ' + n + ' windows within 4 %, worst ' + f1(worst * 100) + ' %');
  // gear changes: where, and how deep the level dips
  const ch = []; for (let f = 1; f < d.n; f++) if (d.log.gear[f] > d.log.gear[f - 1]) ch.push(f);
  const dips = ch.map(f => { const t = f / 60, before = rms(m, sec(t - 0.25), sec(t - 0.05)); let mn = 1; for (let k = 0; k < 14; k++) mn = Math.min(mn, rms(m, sec(t + k * 0.02), sec(t + k * 0.02 + 0.04))); return dB(mn / before); });
  say('  gear changes at ' + ch.map(f => f1(f / 60) + ' s (' + Math.round(d.log.rpm[f - 1]) + ' → ' + Math.round(d.log.rpm[f + 12]) + ' rpm)').join(', ') + '; the level dips by ' + dips.map(f1).join(', ') + ' dB during each');
  check(ch.length >= 3 && dips.every(x => x < -6), 'every gear change is heard as a torque interruption (level dips more than 6 dB)');
  // no silence anywhere
  let quiet = 0, mn = 1; for (let t = 0; t < 29.9; t += 0.05) { const r = rms(m, sec(t), sec(t + 0.05)); if (r < 0.0015) quiet++; if (r < mn) mn = r; }
  check(quiet === 0, 'never silent (50 ms windows)', 'quietest window rms ' + f4(mn));
  const pops = onsets(m, sec(22.1), sec(27), 0.45, 0.03, 4), on = rms(m, sec(21), sec(22)), off = rms(m, sec(22.5), sec(23.5));
  say('  lift-off at 22 s from ' + Math.round(d.log.rpm[1320]) + ' rpm: level ' + f4(on) + ' → ' + f4(off) + ' (' + f1(dB(off / on)) + ' dB); loudest onsets on the overrun at ' + (pops.map(f2).join(', ') || 'none') + ' s');
  check(off < on * 0.6, 'the level drops on the overrun');
  // gearbox whine: a line at the mesh order of the gear in use (cockpit camera, where it is loudest)
  const dc = drive('db5', 12, thr, () => ({ cam: 3, dist: 0.6 })), mc = mono(render(coreNew, dc.rec, 1)), m0 = mono(render(mkCore(srcNew, [['WGA[g5] * dg * 0.02', 'WGA[g5] * dg * 0']]), dc.rec, 1)); let wl = 0, wn = 0; const ords = [0, 8.4, 12.7, 15.6, 23, 19.8], gain = [];
  for (let t = 3; t < 11.5; t += 0.5) { const f = Math.round(t * 60), g = dc.log.gear[f]; if (dc.log.gear[f - 12] !== dc.log.gear[f + 12] || g === 4) continue; const fw = dc.log.rpm[f] / 60 * ords[g], a = line(spec(mc, sec(t) - N / 2, N), N, fw, 0.03), b = line(spec(m0, sec(t) - N / 2, N), N, fw, 0.03); gain.push(dB(a / b)); if (a > 1.7 * b) wl++; wn++; }
  check(wl === wn && wn >= 10, 'a gearbox whine follows the gear in use (line at its mesh order, against the same run with the whine switched off; cockpit camera)', wl + ' of ' + wn + ' windows, ' + f1(Math.min(...gain)) + ' to ' + f1(Math.max(...gain)) + ' dB above');
  const b = bad(o); check(b.nan === 0 && b.pk < 0.39, 'no NaN, no clipping', 'peak ' + f3(b.pk));
  wav('db5_run_chase.wav', render(coreNew, d.rec, 127));
  wav('db5_run_bonnet.wav', render(coreNew, drive('db5', 30, thr, () => ({ cam: 1, dist: 1.5 })).rec, 127));
  wav('db5_run_cockpit.wav', render(coreNew, drive('db5', 30, thr, () => ({ cam: 3, dist: 0.6 })).rec, 127));
  wav('uno_run_chase.wav', render(coreNew, drive('uno', 30, thr).rec, 127));
  // a lap-like drive with braking and down-changes, for listening
  const lap = t => { const u = t % 14; return t < 1.2 ? 0 : u < 7.5 ? 1 : u < 8.3 ? 0 : u < 10.3 ? -0.8 : u < 11 ? 0.3 : 1; };
  wav('db5_lap_like_chase.wav', render(coreNew, drive('db5', 40, lap, (t) => ({ slipL: (t % 14) > 10.3 && (t % 14) < 11.6 ? 0.45 : 0, slipR: (t % 14) > 10.5 && (t % 14) < 11.4 ? 0.3 : 0 })).rec, 127));
});

test('overrun', () => {
  say('DB5 overrun: throttle shut at 5,200 rpm, revs falling to 2,600 over 6 s (engine layer, chase camera)');
  const rec = stream(60 * 9, (f, t) => ({ db5: 1, rpm: t < 2 ? 5200 : Math.max(2600, 5200 - (t - 2) * 430), thr: t < 2 ? 1 : 0, gear: 3, speed: 30 }));
  const core = mkCore(srcNew, COUNTERS);
  globalThis.__pops = 0; const o = render(core, rec, 1), m = mono(o), ref = render(coreNew, rec, 1);
  check(sameBits(o.L, ref.L) === 0, 'the instrumented copy used for counting is the same synthesiser');
  const heard = onsets(m, sec(2.1), sec(8.5), 0.5, 0.03, 4);
  say('  pops fired by the synthesiser: ' + globalThis.__pops + '; onsets above half the loudest: ' + heard.length + ' (' + heard.map(f2).join(', ') + ' s); loudest ' + f3(pk(m, sec(2.1), sec(8.5))) + ' against ' + f3(pk(m, sec(1), sec(2))) + ' on full throttle before');
  check(globalThis.__pops >= 2 && globalThis.__pops <= 14, 'occasional pops on the overrun', globalThis.__pops + ' in 6.5 s');
  // burble: the firings are irregular (spread of the strength of pairs of firings) compared with part throttle at the same speed
  const sp = (x, t0, t1, rpm) => { const T = 2 * SR / (rpm / 20), a = []; for (let s = sec(t0); s + T < sec(t1); s += T) a.push(pk(x, Math.round(s), Math.round(s + T))); return spread(a); };
  const st = mono(render(coreNew, steady(5, { db5: 1, rpm: 4000, thr: 0.4, gear: 3, speed: 30 }), 1)), ov = mono(render(coreNew, steady(5, { db5: 1, rpm: 4000, thr: 0, gear: 3, speed: 30 }), 1));
  const s1 = sp(st, 2, 5, 4000), s2 = sp(ov, 2, 5, 4000);
  check(s2 > s1 * 3 && s2 > 0.15, 'burble: firing strength is far more uneven on the overrun than under power', f1(s2 * 100) + ' % against ' + f1(s1 * 100) + ' % at 4,000 rpm');
});

test('cameras', () => {
  say('DB5 from the four cameras: 3,500 rpm, full throttle, 3rd gear, 40 m/s. Shares = rms of what a source adds (the engine layer with it less the engine layer without it) over the rms of the engine layer');
  const N = 32768, rows = {}, fw = 3500 / 60 * 15.6;
  const without = { induction: mkCore(srcNew, [['F[137] = ig; F[140] = ig * 0.75;', 'F[137] = 0; F[140] = 0;'], ['F[143] = ia * 0.7; F[146] = ia * 0.35;', 'F[143] = 0; F[146] = 0;']]), valves: mkCore(srcNew, [['F[149] = D[XVS + 10] * (0.45 + rp / 6000);', 'F[149] = 0;']]), whine: mkCore(srcNew, [['WGA[g5] * dg * 0.02', 'WGA[g5] * dg * 0']]),
    exhaust: mkCore(srcNew, [['eg[i] = t1[i] * g0 + xB[i] * gb;', 'eg[i] = 0;'], ['svf(t1, eg, m, 37 + k, 1, 1); }', 'F[3 * k + 113] = 0; svf(t1, eg, m, 37 + k, 1, 1); }'], ['F[131] = D[XVS + 7];', 'F[131] = 0;'], ['+ xH[i] * hg; }', '; }']]) };
  for (const [name, cam, dist] of [['chase', 0, 5.5], ['bonnet', 1, 1.5], ['tv', 2, 30], ['cockpit', 3, 0.6]]) {
    const base = { db5: 1, cam, dist, rpm: 3500, thr: 1, gear: 3, speed: 40, lsp: cam === 2 ? 0 : 40 }, rec = steady(3.2, base);
    const e = render(coreNew, rec, 1), all = render(coreNew, rec, 15), wd = render(coreNew, rec, 4), m = mono(e), mg = spec(m, sec(2.2), N), mw = spec(mono(wd), sec(2.2), N), r = rms(m, sec(2.2)), sh = {};
    for (const k in without) { const o = mono(render(without[k], rec, 1)); for (let i = 0; i < o.length; i++) o[i] = m[i] - o[i]; sh[k] = rms(o, sec(2.2)) / r; }
    rows[name] = { rms: r, all: rms(mono(all), sec(2.2)), lo: band(mg, N, 30, 200), mid: band(mg, N, 200, 1200), hi: band(mg, N, 2000, 7000), cen: centroid(mg, N, 20, 10000), wh: line(mg, N, fw, 0.02), sh,
      wind: rms(mono(wd), sec(2.2)), whiss: band(mw, N, 3000, 7000), wroar: band(mw, N, 100, 2000), side: rms(e.L.map((v, i) => v - e.R[i]), sec(2.2)) / (r * 2) };
  }
  say('  camera   engine rms  car+wind rms  30-200 Hz  0.2-1.2 kHz  2-7 kHz  centroid Hz | shares: exhaust  induction  valve gear  whine | wind rms  wind 3-7 kHz / 0.1-2 kHz  (L-R) / (L+R)');
  for (const k in rows) { const r = rows[k]; say('  ' + k.padEnd(8) + '  ' + f4(r.rms) + '      ' + f4(r.all) + '     ' + f4(r.lo) + '     ' + f4(r.mid) + '    ' + f4(r.hi) + '    ' + f1(r.cen).padStart(7) + '   |          ' + f2(r.sh.exhaust) + '      ' + f2(r.sh.induction) + '       ' + f2(r.sh.valves) + '      ' + f2(r.sh.whine) + '  |  ' + f4(r.wind) + '          ' + f3(r.whiss / (r.wroar + 1e-12)) + '               ' + f3(r.side)); }
  const c = rows.cockpit, h = rows.chase, b = rows.bonnet, tv = rows.tv;
  check(h.sh.exhaust > 0.8 && h.sh.exhaust > 3 * h.sh.induction && h.sh.exhaust > b.sh.exhaust, 'chase: exhaust-dominated', 'exhaust share ' + f2(h.sh.exhaust) + ', induction ' + f2(h.sh.induction));
  check(b.sh.induction > 2 * h.sh.induction && b.sh.valves > 3 * h.sh.valves && b.sh.induction + b.sh.valves > 0.5, 'bonnet: induction and mechanical noise', 'induction share ' + f2(b.sh.induction) + ' (chase ' + f2(h.sh.induction) + '), valve gear ' + f2(b.sh.valves) + ' (chase ' + f2(h.sh.valves) + ')');
  check(c.hi / c.rms < 0.4 * h.hi / h.rms, 'cockpit: lower-passed (2-7 kHz share of the engine)', f3(c.hi / c.rms) + ' against ' + f3(h.hi / h.rms) + ' in the chase camera');
  check(c.lo / c.mid > 1.4 * h.lo / h.mid, 'cockpit: boomier (30-200 Hz against 0.2-1.2 kHz)', f2(c.lo / c.mid) + ' against ' + f2(h.lo / h.mid));
  check(c.sh.induction > 1.5 * h.sh.induction && c.sh.exhaust < h.sh.exhaust, 'cockpit: more induction, less exhaust', 'induction share ' + f2(c.sh.induction) + ' against ' + f2(h.sh.induction) + ', exhaust ' + f2(c.sh.exhaust) + ' against ' + f2(h.sh.exhaust));
  check(c.sh.whine > 2 * h.sh.whine && c.wh > 2 * h.wh, 'cockpit: more gearbox whine (line at the 3rd-gear mesh order, ' + f1(fw) + ' Hz)', 'share ' + f3(c.sh.whine) + ' against ' + f3(h.sh.whine) + ', line ' + f4(c.wh) + ' against ' + f4(h.wh));
  check(c.whiss / c.wroar > 1.5 * h.whiss / h.wroar && c.wroar < h.wroar, 'cockpit: wind hiss around the frame, less roar', 'hiss / roar ' + f3(c.whiss / c.wroar) + ' against ' + f3(h.whiss / h.wroar) + '; wind rms ' + f4(c.wind) + ' against ' + f4(h.wind));
  check(c.cen < h.cen && c.cen < b.cen && c.cen < tv.cen, 'cockpit: the darkest of the four (engine centroid)', f1(c.cen) + ' Hz');
  check(tv.rms < h.rms && tv.side < 0.01 && h.side > 0.01, 'TV: further away and mono; chase: the twin pipes give the exhaust a little width', '(L-R) / (L+R) ' + f3(h.side) + ' chase, ' + f3(tv.side) + ' TV');
  check(tv.wind < 1e-6, 'TV: no wind of its own');
  const lv = [h.rms, b.rms, c.rms]; check(Math.max(...lv) < 1.35 * Math.min(...lv), 'the engine is about as loud from the three cameras on the car', lv.map(f4).join(' / '));
});

test('doppler', () => {
  say('DB5 past a trackside camera: Doppler and distance');
  const N = 32768, at = (dop, dist) => { const m = mono(render(coreNew, steady(3.2, { db5: 1, cam: 2, dist, dop, lsp: 0, rpm: 4000, thr: 1, gear: 3, speed: 45 }), 1)); return { p: peak(spec(m, sec(2.2), N), N, 30, 2000), rms: rms(m, sec(2.2)) }; };
  const a = at(1.12, 30), b = at(0.89, 30), c = at(1, 30), far = at(1, 200);
  check(Math.abs(a.p.f / 224 - 1) < 0.015 && Math.abs(b.p.f / 178 - 1) < 0.015 && Math.abs(c.p.f / 200 - 1) < 0.015, 'the firing line moves with the Doppler factor', f1(a.p.f) + ' / ' + f1(c.p.f) + ' / ' + f1(b.p.f) + ' Hz for ×1.12 / ×1 / ×0.89 (4,000 rpm = 200 Hz)');
  check(far.rms < c.rms * 0.25, 'level falls with distance', f1(dB(far.rms / c.rms)) + ' dB from 30 m to 200 m');
  // the gadgets too: the horn's notes move with the Doppler factor
  const hn = (dop) => { const m = mono(render(coreNew, steady(2, { db5: 1, cam: 2, dist: 30, dop, lsp: 0, rpm: 750, thr: 0, gear: 1, speed: 0, gad: 16 }), 64)); return peak(spec(m, sec(0.8), N), N, 380, 480).f; };
  check(Math.abs(hn(1.1) / hn(1) - 1.1) < 0.01, 'the horn is shifted with the car', f1(hn(1)) + ' → ' + f1(hn(1.1)) + ' Hz for ×1.1');
  // a drive-by for listening: approaches from 160 m at 45 m/s, passes 9 m from the camera, guns for a moment, horn while leaving
  const pass = stream(60 * 9, (f, t) => { const x = -160 + 45 * t, d = Math.hypot(x, 9), vr = -45 * x / d; return { db5: 1, cam: 2, dist: d, dop: 343 / (343 - vr), lsp: 0, rpm: 4300 + 60 * t, thr: t < 7.5 ? 1 : 0, gear: 3, speed: 45, gad: (t > 2.2 && t < 3.2 ? 1 : 0) | (t > 4.4 && t < 5.4 ? 16 : 0) }; });
  const o = render(coreNew, pass, 127), bb = bad(o); check(bb.nan === 0 && bb.pk < 0.39, 'drive-by: no NaN, no clipping', 'peak ' + f3(bb.pk));
  wav('db5_driveby_tv.wav', o);
  wav('db5_driveby_tv_plain.wav', render(coreNew, stream(60 * 9, (f, t) => { const x = -160 + 45 * t, d = Math.hypot(x, 9), vr = -45 * x / d; return { db5: 1, cam: 2, dist: d, dop: 343 / (343 - vr), lsp: 0, rpm: 4300 + 60 * t, thr: 1, gear: 3, speed: 45 }; }), 127));
});

test('tyres-wind', () => {
  say('Tyres and wind, DB5 against Uno (their own layers alone)');
  const N = 16384, sq = (db5, slip) => { const m = mono(render(coreNew, steady(2.5, { db5, rpm: 3000, thr: 0.3, gear: 3, speed: 30, slipL: slip, slipR: slip }), 2)); return { rms: rms(m, sec(1)), f: peak(spec(m, sec(1), N), N, 200, 1600).f }; };
  const rows = []; for (const s of [0.05, 0.1, 0.2, 0.4, 0.7, 1]) rows.push({ s, d: sq(1, s), u: sq(0, s) });
  say('  slip   DB5 rms  DB5 pitch Hz   Uno rms  Uno pitch Hz');
  for (const r of rows) say('  ' + f2(r.s) + '   ' + f4(r.d.rms) + '     ' + f1(r.d.f).padStart(6) + '      ' + f4(r.u.rms) + '     ' + f1(r.u.f).padStart(6));
  check(rows.filter(r => r.s <= 0.4).every(r => r.d.rms > r.u.rms * 1.5), 'DB5 tyres squeal earlier (louder at small slip)', 'at slip 0.1: ' + f1(dB(rows[1].d.rms / rows[1].u.rms)) + ' dB above the Uno');
  check(rows.every(r => r.d.f < r.u.f * 0.8), 'and lower', f1(rows[4].d.f) + ' Hz against ' + f1(rows[4].u.f) + ' Hz at slip 0.7');
  check(rows[5].d.rms < rows[5].u.rms * 1.0, 'but no louder at full slip', f4(rows[5].d.rms) + ' against ' + f4(rows[5].u.rms));
  const tail = (db5) => { const o = render(coreNew, stream(60 * 4, (f, t) => ({ db5, rpm: 3000, thr: 0.3, gear: 3, speed: 30, slipL: t < 2 ? 0.8 : 0, slipR: t < 2 ? 0.8 : 0 })), 2), m = mono(o), on = rms(m, sec(1), sec(2)); let t = 2; while (t < 4 && rms(m, sec(t), sec(t + 0.02)) > on * 0.05) t += 0.01; return t - 2; };
  const td = tail(1), tu = tail(0);
  check(td > tu * 2.5, 'and longer (time for the squeal to fall 26 dB once the slip stops)', f2(td) + ' s against ' + f2(tu) + ' s');
  const wd = (db5, v) => rms(mono(render(coreNew, steady(4, { db5, rpm: 3000, thr: 0.3, gear: 4, speed: v }), 4)), sec(1));
  const w = [20, 30, 40, 50].map(v => ({ v, d: wd(1, v), u: wd(0, v) }));
  say('  wind rms at 20 / 30 / 40 / 50 m/s: DB5 ' + w.map(x => f4(x.d)).join(' ') + '   Uno ' + w.map(x => f4(x.u)).join(' '));
  check(w.every(x => x.d > x.u * 1.02 && x.d < x.u * 1.3), 'a little more wind roar in the DB5 at the same speed', w.map(x => '+' + f1(dB(x.d / x.u)) + ' dB').join(' '));
});

// ---- gadgets: the gadget layer alone (bit 64), car idling at rest unless said otherwise
const GAD_ONLY = 64;
const gadStream = (secs, fn, o) => stream(Math.round(secs * 60), (f, t) => Object.assign({ db5: 1, rpm: 750, thr: 0, gear: 1, speed: 0 }, o, fn(t, f)));

test('gad-guns', () => {
  say('Machine guns: flag from 1.0 s to 3.0 s (gadget layer alone)');
  const o = render(coreNew, gadStream(6, t => ({ gad: t >= 1 && t < 3 ? 1 : 0 })), GAD_ONLY), m = mono(o);
  const on = onsets(m, sec(0.9), sec(3.2), 0.3, 0.03, 2.5), gaps = on.slice(1).map((t, i) => t - on[i]), rate = (on.length - 1) / (on[on.length - 1] - on[0]);
  say('  reports: ' + on.length + ', first at ' + f3(on[0]) + ' s, last at ' + f3(on[on.length - 1]) + ' s, rate ' + f2(rate) + ' per second (' + f2(rate / 2) + ' per gun), spacing ' + f1(Math.min(...gaps) * 1000) + ' .. ' + f1(Math.max(...gaps) * 1000) + ' ms');
  say('  level: rms ' + f4(rms(m, sec(1), sec(3))) + ', peak ' + f3(pk(m, sec(1), sec(3))) + ' (L ' + f3(pk(o.L)) + ', R ' + f3(pk(o.R)) + '); rms at 0.1 / 0.3 / 0.6 / 1.0 s after the last report: ' + [0.1, 0.3, 0.6, 1.0].map(d => f4(rms(m, sec(3.05 + d), sec(3.1 + d)))).join(' ') + '; silent from ' + f2(lastSound(o)) + ' s');
  check(quietIn(o, 0, 0.999), 'nothing before the flag');
  check(on.length >= 38 && on.length <= 42 && rate > 19 && rate < 21, 'about 20 reports a second while the flag is set (9 to 10 from each gun)', on.length + ' reports in 2 s, ' + f2(rate) + ' per second');
  check(Math.abs(on[0] - 1) < 0.004, 'the first report comes at once', f1((on[0] - 1) * 1000) + ' ms after the flag');
  // the two guns alternate: successive reports lean to opposite sides
  const lean = on.map(t => { const a = sec(t), l = rms(o.L, a, a + 240), r = rms(o.R, a, a + 240); return (l - r) / (l + r); });
  let alt = 0; for (let i = 1; i < lean.length; i++) if (lean[i] * lean[i - 1] < 0) alt++;
  check(alt === lean.length - 1 && lean[0] > 0, 'two guns, firing in turn, the left one first (each report leans to the other side)', 'left/right balance of the first four: ' + lean.slice(0, 4).map(f2).join(' '));
  // each report: crack (first 2 ms, mostly above 2 kHz), thump (around 100 Hz, tens of ms), clatter of the action after 13 and 29 ms
  const hp = m.map((v, i) => i ? v - m[i - 1] : 0), s0 = sec(on[6]), crack = pk(hp, s0, s0 + 96), later = pk(hp, s0 + 240, s0 + 560), cl1 = pk(hp, s0 + sec(0.0128), s0 + sec(0.0165)), cl2 = pk(hp, s0 + sec(0.0288), s0 + sec(0.0325)), between = pk(hp, s0 + sec(0.02), s0 + sec(0.027));
  const th = spec(m, s0, 2048), lf = band(th, 2048, 60, 160), mf = band(th, 2048, 300, 600);
  say('  one report: crack (differenced signal) ' + f3(crack) + ' in its first 2 ms, ' + f3(later) + ' 5-12 ms later; clatter clicks ' + f3(cl1) + ' at +13 ms and ' + f3(cl2) + ' at +29 ms (' + f3(between) + ' between them); thump 60-160 Hz rms ' + f4(lf) + ', body 300-600 Hz rms ' + f4(mf) + ' over the next 43 ms');
  check(crack > 5 * later && crack > 0.05, 'a report starts with a sharp crack');
  check(lf > 0.008, 'and has a low thump');
  check(cl1 > 2 * between && cl2 > 1.5 * between, 'followed by the clatter of the action');
  check(rms(m, sec(3.15), sec(3.45)) > 0.002 && lastSound(o) > 3.5 && lastSound(o) < 4.6, 'a reverberant tail is left when the firing stops, and it ends', 'rms ' + f4(rms(m, sec(3.15), sec(3.45))) + ' in the first 0.3 s after, silent from ' + f2(lastSound(o)) + ' s');
  // a single frame of flag gives one report; a flag that flickers every frame cannot fire faster than the guns do
  const one = onsets(mono(render(coreNew, gadStream(2, (t, f) => ({ gad: f === 60 ? 1 : 0 })), GAD_ONLY)), 0, sec(1.15), 0.3, 0.03, 2.5), fl = onsets(mono(render(coreNew, gadStream(3, (t, f) => ({ gad: f >= 60 && f < 120 && (f & 1) ? 1 : 0 })), GAD_ONLY)), 0, sec(2.1), 0.3, 0.03, 2.5);
  check(one.length === 1, 'a flag set for a single frame gives one report', one.length); check(fl.length >= 9 && fl.length <= 21, 'a flag flickering every other frame for a second never fires faster than the guns do', fl.length + ' reports');
  wav('gadget_guns.wav', render(coreNew, gadStream(6, t => ({ gad: (t >= 1 && t < 3) || (t >= 3.9 && t < 4.2) ? 1 : 0 })), 127));
});

test('gad-smoke-oil', () => {
  say('Smoke screen (flag 2) from 1 s to 4 s; oil spray (flag 4) from 1 s to 4 s — each alone');
  const N = 32768, s = render(coreNew, gadStream(8, t => ({ gad: t >= 1 && t < 4 ? 2 : 0 })), GAD_ONLY), l = render(coreNew, gadStream(8, t => ({ gad: t >= 1 && t < 4 ? 4 : 0 })), GAD_ONLY), ms = mono(s), ml = mono(l);
  const cs = centroid(spec(ms, sec(2.5), N), N, 20, 12000), co = centroid(spec(ml, sec(2.5), N), N, 20, 12000);
  const env = (m, ts) => ts.map(t => f4(rms(m, sec(t), sec(t + 0.05)))).join(' ');
  say('  smoke: rms at 1.0 / 1.1 / 1.2 / 1.4 / 2.5 s: ' + env(ms, [1, 1.1, 1.2, 1.4, 2.5]) + '; after the flag clears, at 4.0 / 4.3 / 4.6 / 5.0 s: ' + env(ms, [4, 4.3, 4.6, 5]) + '; silent from ' + f2(lastSound(s)) + ' s; centroid ' + f1(cs) + ' Hz; peak ' + f3(pk(ms)));
  say('  oil:   rms at 1.0 / 1.1 / 1.2 / 1.4 / 2.5 s: ' + env(ml, [1, 1.1, 1.2, 1.4, 2.5]) + '; after the flag clears, at 4.0 / 4.2 / 4.4 / 4.8 s: ' + env(ml, [4, 4.2, 4.4, 4.8]) + '; silent from ' + f2(lastSound(l)) + ' s; centroid ' + f1(co) + ' Hz; peak ' + f3(pk(ml)));
  check(quietIn(s, 0, 0.999) && quietIn(l, 0, 0.999), 'nothing before the flags');
  check(rms(ms, sec(2), sec(4)) > 0.01 && rms(ml, sec(2), sec(4)) > 0.01, 'both sound while their flag is set', 'smoke rms ' + f4(rms(ms, sec(2), sec(4))) + ', oil rms ' + f4(rms(ml, sec(2), sec(4))));
  check(rms(ms, sec(1), sec(1.05)) < 0.25 * rms(ms, sec(2.5), sec(3.5)) && rms(ms, sec(4.3), sec(4.35)) > 0.05 * rms(ms, sec(2.5), sec(3.5)), 'smoke: soft start and a tail');
  check(lastSound(s) > 4.5 && lastSound(s) < 7 && lastSound(l) > 4.2 && lastSound(l) < 6, 'both fall silent once the tail is over', 'smoke ' + f2(lastSound(s)) + ' s, oil ' + f2(lastSound(l)) + ' s');
  check(co < cs * 0.6, 'the oil spray is lower than the smoke hiss', f1(co) + ' Hz against ' + f1(cs) + ' Hz');
  // sputter: the oil's level flutters, the smoke's does not
  const flut = (m) => { const a = []; for (let t = 2; t < 4; t += 0.01) a.push(rms(m, sec(t), sec(t + 0.01))); return spread(a); };
  check(flut(ml) > 2 * flut(ms) && flut(ml) > 0.3, 'the oil sputters (spread of the level in 10 ms windows)', f2(flut(ml)) + ' against ' + f2(flut(ms)) + ' for the smoke');
  wav('gadget_smoke.wav', render(coreNew, gadStream(8, t => ({ gad: t >= 1 && t < 4 ? 2 : 0 })), 127)); wav('gadget_oil.wav', render(coreNew, gadStream(7, t => ({ gad: t >= 1 && t < 4 ? 4 : 0 })), 127));
});

test('gad-servo', () => {
  say('Servo (flag 8) from 1 s to 2.5 s, and end-stop counts');
  const N = 16384, o = render(coreNew, gadStream(5, t => ({ gad: t >= 1 && t < 2.5 ? 8 : 0, es: t >= 2.5 ? 1 : 0 })), GAD_ONLY), m = mono(o), mg = spec(m, sec(1.5), N), p0 = peak(mg, N, 300, 900), wh = band(mg, N, 1100, 2600), fu = band(mg, N, 500, 700);
  const mgc = spec(m, sec(2.5) - 256, 4096), thud = band(mgc, 4096, 90, 180), metal = Math.hypot(line(mgc, 4096, 640, 0.04), line(mgc, 4096, 1530, 0.04), line(mgc, 4096, 2780, 0.04));
  const up = [0.01, 0.03, 0.06, 0.12].map(d => pitch(m, sec(1 + d) - 240, 480, 140, 700));
  say('  motor: rms ' + f4(rms(m, sec(1.3), sec(2.4))) + ', peak ' + f3(pk(m, sec(1.3), sec(2.4))) + ', pulse rate ' + f1(p0.f) + ' Hz (level ' + f4(fu) + '), gear-train band 1.1-2.6 kHz ' + f4(wh) + '; spin-up: pitch at +10 / +30 / +60 / +120 ms ' + up.map(f1).join(' / ') + ' Hz, rms ' + [0.01, 0.03, 0.06, 0.12].map(d => f4(rms(m, sec(1 + d), sec(1.01 + d)))).join(' '));
  say('  clunk at 2.5 s: peak ' + f3(pk(m, sec(2.5), sec(2.6))) + ', thud (90-180 Hz) ' + f4(thud) + ', metal lines near 640 / 1,530 / 2,780 Hz ' + f4(metal) + ' over its 85 ms; silent from ' + f2(lastSound(o)) + ' s');
  check(quietIn(o, 0, 0.999), 'nothing before the flag');
  check(rms(m, sec(1.3), sec(2.4)) > 0.006 && Math.abs(p0.f / 600 - 1) < 0.06 && wh > 0.5 * fu, 'the motor whirrs and whines while the flag is set', f1(p0.f) + ' Hz pulses');
  check(up[0] < up[1] && up[1] < up[2] && up[2] < up[3] && up[3] < p0.f * 1.02 && rms(m, sec(1.01), sec(1.02)) < 0.5 * rms(m, sec(1.3), sec(1.4)), 'it spins up: pitch and level rise over the first tenth of a second');
  check(pk(m, sec(2.5), sec(2.56)) > 2.5 * pk(m, sec(1.3), sec(2.4)) && thud > 0.004 && metal > 0.002, 'the end stop is a solid clunk (thud and metal) well above the motor', 'peak ' + f3(pk(m, sec(2.5), sec(2.56))) + ' against ' + f3(pk(m, sec(1.3), sec(2.4))));
  check(lastSound(o) > 2.55 && lastSound(o) < 3, 'then silence', f2(lastSound(o)) + ' s');
  // counts: one clunk each, also when two come in the same frame, at the wrap of the counter, and none for a discontinuity
  const cnt = (fn) => { const oo = render(coreNew, gadStream(6, fn), GAD_ONLY); return onsets(mono(oo), 0, oo.n, 0.3, 0.05, 6).length; };
  const c1 = cnt(t => ({ es: t < 1 ? 0 : t < 2 ? 1 : t < 3 ? 2 : 3 })), c2 = cnt(t => ({ es: t < 1 ? 7 : 9 })), c3 = cnt(t => ({ es: 60 + Math.min(8, Math.floor(t * 2)) })), c4 = cnt(t => ({ es: t < 1 ? 5 : 25 })), c5 = cnt(t => ({ es: 37 }));
  check(c1 === 3, 'three counts a second apart: three clunks', c1); check(c2 === 2, 'a count of two in one frame: two clunks, 75 ms apart', c2);
  check(c3 === 8, 'eight counts across the wrap of the counter (60 … 63, 0 … 4): eight clunks', c3); check(c4 === 0, 'a jump of 20: taken as a discontinuity, nothing', c4); check(c5 === 0, 'a counter that starts at 37: latched, nothing', c5);
  wav('gadget_servo_clunk.wav', render(coreNew, gadStream(6, t => ({ gad: (t >= 1 && t < 2.5) || (t >= 3.2 && t < 4.4) ? 8 : 0, es: t >= 4.4 ? 2 : t >= 2.5 ? 1 : 0 })), 127));
});

test('gad-seat', () => {
  say('Ejector seat: one count at 1.0 s (gadget layer alone)');
  const o = render(coreNew, gadStream(6, t => ({ ej: t >= 1 ? 1 : 0 })), GAD_ONLY), m = mono(o), N = 4096;
  const w = [1.0, 1.02, 1.05, 1.1, 1.2, 1.3, 1.5, 1.8, 2.2, 2.8, 3.2].map(t => f4(rms(m, sec(t), sec(t + 0.02))));
  say('  rms in 20 ms windows at 1.00 / 1.02 / 1.05 / 1.1 / 1.2 / 1.3 / 1.5 / 1.8 / 2.2 / 2.8 / 3.2 s: ' + w.join(' ') + '; peak ' + f3(pk(m)) + '; silent from ' + f2(lastSound(o)) + ' s');
  check(quietIn(o, 0, 0.999), 'nothing before the count');
  const mb = spec(m, sec(1) - 64, 2048);
  say('  bang: peak ' + f3(pk(m, sec(1), sec(1.01))) + ' in the first 10 ms; 40-150 Hz ' + f4(band(mb, 2048, 40, 150)) + ', 150-700 Hz ' + f4(band(mb, 2048, 150, 700)) + ', 1.5-7 kHz ' + f4(band(mb, 2048, 1500, 7000)) + ' over its first 40 ms');
  check(pk(m, sec(1), sec(1.01)) > 0.15 && rms(m, sec(1), sec(1.01)) > 3 * rms(m, sec(1.06), sec(1.07)) && band(mb, 2048, 1500, 7000) > 0.01 && band(mb, 2048, 40, 150) > 0.01, 'a sharp bang at the count: crack and thump', 'peak ' + f3(pk(m, sec(1), sec(1.01))));
  // roof panel: metal resonances ring between 20 and 300 ms (around 1.2, 2.1, 3.4 kHz and rising), with clanks at 190 and 330 ms
  const mg = spec(m, sec(1.03), N), metal = band(mg, N, 1000, 4500), below = band(mg, N, 150, 700);
  check(metal > 2 * below, 'the roof panel tears away: metal resonances (1-4.5 kHz) dominate from 30 ms', f4(metal) + ' against ' + f4(below) + ' in 150-700 Hz');
  const pw = t => pk(m, sec(t), sec(t + 0.006)), bg = Math.max(pw(1.165), pw(1.175), pw(1.21), pw(1.225), pw(1.26), pw(1.3), pw(1.31), pw(1.35), pw(1.365));
  check(pw(1.19) > 1.6 * bg && pw(1.33) > 1.3 * bg, 'and it clanks twice as it tumbles away, 190 and 330 ms after the bang', 'peaks ' + f3(pw(1.19)) + ' and ' + f3(pw(1.33)) + ' against ' + f3(bg) + ' at most around them');
  // whoosh: rises to about 1.3 s, then fades; its band climbs and falls back
  const e = t => rms(m, sec(t), sec(t + 0.05)), c = t => centroid(spec(m, sec(t), N), N, 100, 8000);
  check(e(1.26) > 1.3 * e(1.08) && e(1.26) > 2 * e(1.9) && e(1.9) > 2 * e(2.6), 'the whoosh rises, then fades', [1.08, 1.26, 1.9, 2.6].map(t => f4(e(t))).join(' → '));
  say('  whoosh centroid at 1.1 / 1.2 / 1.45 / 1.7 / 2.1 / 2.6 s: ' + [1.1, 1.2, 1.45, 1.7, 2.1, 2.6].map(t => f1(c(t))).join(' / ') + ' Hz');
  check(c(1.45) > c(2.1) && c(2.1) > c(2.6), 'and sinks in pitch as the seat leaves');
  check(lastSound(o) > 3 && lastSound(o) < 3.4, 'then silence', f2(lastSound(o)) + ' s');
  // counts
  const cnt = (fn) => { const oo = render(coreNew, gadStream(9, fn), GAD_ONLY); return onsets(mono(oo), 0, oo.n, 0.5, 0.15, 8).length; };
  const c1 = cnt(t => ({ ej: t < 1 ? 0 : t < 4 ? 1 : 2 })), c2 = cnt(t => ({ ej: t < 1 ? 31 : t < 4 ? 0 : 1 })), c3 = cnt(t => ({ ej: 9 })), c4 = cnt(t => ({ ej: t < 1 ? 3 : 14 })), c5 = cnt(t => ({ ej: t < 1 ? 0 : 1, mute: t > 0.5 && t < 2 ? 1 : 0 })), c6 = cnt(t => ({ ej: t < 1 ? 0 : 1, run: t > 0.5 && t < 2 ? 0 : 1 }));
  check(c1 === 2, 'two counts three seconds apart: two firings (bang onsets counted)', c1); check(c2 === 2, 'across the wrap of the counter (31, 0, 1): two firings', c2);
  check(c3 === 0, 'a counter that starts at 9: latched, nothing', c3); check(c4 === 0, 'a jump of 11: a discontinuity, nothing', c4); check(c5 === 0 && c6 === 0, 'a count that arrives while muted or paused is not played late', c5 + ', ' + c6);
  wav('gadget_ejector_seat.wav', render(coreNew, gadStream(5, t => ({ ej: t >= 1 ? 1 : 0 })), 127));
  wav('gadget_ejector_seat_cockpit.wav', render(coreNew, gadStream(5, t => ({ ej: t >= 1 ? 1 : 0, cam: 3, dist: 0.6 })), 127));
});

test('gad-horn', () => {
  say('Horn: flag 16 from 1.0 s to 2.2 s (gadget layer alone)');
  const N = 32768, o = render(coreNew, gadStream(4, t => ({ gad: t >= 1 && t < 2.2 ? 16 : 0 })), GAD_ONLY), m = mono(o), mg = spec(m, sec(1.3), N);
  const a = peak(mg, N, 380, 440), b = peak(mg, N, 480, 540), harm = [], harm2 = []; for (let k = 1; k <= 8; k++) { harm.push(dB(line(mg, N, 408 * k, 0.012) / a.a)); harm2.push(dB(line(mg, N, 511 * k, 0.012) / a.a)); }
  let t10 = 1, t90 = 1; const full = rms(m, sec(1.4), sec(2)); while (rms(m, sec(t10), sec(t10) + 96) < 0.1 * full) t10 += 0.001; t90 = t10; while (rms(m, sec(t90), sec(t90) + 96) < 0.9 * full) t90 += 0.001;
  let r = 2.2; while (rms(m, sec(r), sec(r) + 96) > 0.1 * full) r += 0.001;
  say('  notes: ' + f1(a.f) + ' Hz (level ' + f4(a.a) + ') and ' + f1(b.f) + ' Hz (level ' + f4(b.a) + '): interval ' + f3(b.f / a.f) + ' (a major third is 1.250 to 1.260)');
  say('  harmonics 1-8 of the low note: ' + harm.map(f1).join(' ') + ' dB; of the high note: ' + harm2.map(f1).join(' ') + ' dB (re the low fundamental)');
  say('  rms ' + f4(full) + ', peak ' + f3(pk(m)) + '; reaches 10 % at +' + f1((t10 - 1) * 1000) + ' ms and 90 % at +' + f1((t90 - 1) * 1000) + ' ms; falls to 10 % ' + f1((r - 2.2) * 1000) + ' ms after the flag clears; silent from ' + f2(lastSound(o)) + ' s');
  check(quietIn(o, 0, 0.999), 'nothing before the flag');
  check(Math.abs(a.f - 408) < 5 && Math.abs(b.f - 511) < 6 && b.f / a.f > 1.23 && b.f / a.f < 1.27, 'two notes about a major third apart, near 410 and 510 Hz');
  check(harm.slice(1, 8).filter(h => h > -20).length >= 6 && harm2.slice(1, 7).filter(h => h > -20).length >= 5, 'both rich in harmonics', 'within 20 dB of the fundamental: ' + harm.slice(1, 8).filter(h => h > -20).length + ' of harmonics 2-8 (low note), ' + harm2.slice(1, 7).filter(h => h > -20).length + ' of 2-7 (high note)');
  check(t90 - 1 < 0.04 && r - 2.2 < 0.08, 'quick attack and release');
  check(lastSound(o) > 2.2 && lastSound(o) < 2.5, 'then silence', f2(lastSound(o)) + ' s');
  wav('gadget_horn.wav', render(coreNew, gadStream(4.5, t => ({ gad: (t >= 1 && t < 2.2) || (t >= 2.6 && t < 2.8) || (t >= 3 && t < 3.2) ? 16 : 0 })), 127));
});

test('gad-all', () => {
  say('All gadgets with the car driving, from the four cameras (levels, NaN, clipping)');
  const gfn = (t) => ({ gad: (t > 4 && t < 6 ? 1 : 0) | (t > 7 && t < 10 ? 2 : 0) | (t > 11 && t < 13 ? 4 : 0) | (t > 14 && t < 15.2 ? 8 : 0) | (t > 16.5 && t < 17.5 ? 16 : 0), es: t > 15.2 ? 1 : 0, ej: t > 19 ? 1 : 0 });
  say('  camera     mix rms  mix peak | gadget layer alone, rms while working: guns   smoke    oil     servo   horn    seat (first 0.5 s)');
  for (const [name, cam, dist] of [['chase', 0, 5.5], ['bonnet', 1, 1.5], ['tv', 2, 40], ['cockpit', 3, 0.6]]) {
    const d = drive('db5', 23, t => t < 1.5 ? 0 : t < 18 ? 1 : 0.2, (t, f, s) => Object.assign({ cam, dist, lsp: cam === 2 ? 0 : s.speed }, gfn(t)));
    const o = render(coreNew, d.rec, 127), g = render(coreNew, d.rec, 64), b = bad(o), mg = mono(g);
    say('  ' + name.padEnd(8) + '   ' + f4(rms(mono(o))) + '   ' + f3(b.pk) + '   |                                        ' + [[4.2, 6], [8, 10], [11.3, 13], [14.3, 15.2], [16.7, 17.5], [19.02, 19.5]].map(([a, c]) => f4(rms(mg, sec(a), sec(c)))).join('  '));
    check(b.nan === 0 && b.pk < 0.39, name + ': no NaN, no clipping', 'peak ' + f3(b.pk));
    if (name === 'chase') wav('db5_drive_all_gadgets_chase.wav', o);
    if (name === 'cockpit') wav('db5_drive_all_gadgets_cockpit.wav', o);
  }
  // wandering controls with everything going on, mute and pause included
  for (const [seed, sr, blk] of [[11, SR, 800], [12, SR, 128], [13, 44100, 37], [14, 32000, 533], [15, 96000, 128]]) { const o = render(coreNew, wander(60 * 60, seed, 1, 1), 127, { sr, block: blk }), b = bad(o); check(b.nan === 0 && b.pk < 0.39, 'wandering controls and gadgets, seed ' + seed + ', ' + sr + ' Hz in blocks of ' + blk + ' (60 s): no NaN, no clipping', 'peak ' + f3(b.pk) + ', rms ' + f4(rms(mono(o)))); }
  // the other layers are the same samples whether or not a gadget works (the gadgets have noise and random numbers of their own)
  { const mk = g => stream(60 * 12, (f, t) => ({ db5: 1, rpm: 2500 + 2000 * Math.sin(t), thr: t % 3 < 2 ? 1 : 0, gear: 3, speed: 30, slipL: t > 5 && t < 7 ? 0.5 : 0, crowd: 0.6, gad: g ? (f >> 5) & 31 : 0, ej: g ? Math.floor(t / 4) : 0, es: g ? Math.floor(t) : 0 }));
    const a = render(coreNew, mk(0), 63), b = render(coreNew, mk(1), 63); check(sameBits(a.L, b.L) + sameBits(a.R, b.R) === 0, 'engine, tyres, wind, road, ambience and crowd are the same samples with and without gadgets working', a.n * 2 + ' samples'); }
  // the gadget layer does not exist for the Uno
  const u = render(coreNew, gadStream(3, t => ({ db5: 0, gad: 31, ej: Math.floor(t), es: Math.floor(t * 3) })), GAD_ONLY);
  check(quietIn(u, 0, 3), 'Uno selected: the gadget layer is silent whatever control 15 says');
  // all gadgets isolated, for listening
  wav('gadgets_layer_only.wav', render(coreNew, gadStream(18, t => gfn(t + 3.5)), 64));
});

test('mute-pause', () => {
  say('Mute and pause (DB5, everything on, guns firing)');
  const base = () => ({ db5: 1, rpm: 4200, thr: 1, gear: 3, speed: 35, gad: 1 | 2 | 16, crowd: 0.5 });
  const o = render(coreNew, stream(60 * 4, (f, t) => Object.assign(base(), { mute: t >= 1 && t < 2 ? 1 : 0, run: t >= 3 ? 0 : 1 })), 127);
  let z1 = sec(1); while (o.L[z1] !== 0 || o.R[z1] !== 0) z1++; let z2 = sec(3); while (o.L[z2] !== 0 || o.R[z2] !== 0) z2++;
  check(zeroIn(o, z1 / SR, 2) && z1 - sec(1) < sec(0.06), 'mute: exact zeros from ' + f1((z1 - sec(1)) / 48) + ' ms after the flag until it clears');
  check(zeroIn(o, z2 / SR, 4) && z2 - sec(3) < sec(0.06), 'pause: exact zeros from ' + f1((z2 - sec(3)) / 48) + ' ms after the flag');
  check(rms(o.L, sec(2.1), sec(2.9)) > 0.03, 'sound is back after the mute', 'rms ' + f4(rms(o.L, sec(2.1), sec(2.9))));
  // frozen state: after a pause the synthesiser carries on exactly where it stopped (compared with a run that was never paused,
  // shifted by the pause less the fade-out, during which the state still moved)
  const a = render(coreNew, stream(60 * 3, (f, t) => Object.assign(base(), { run: t >= 1 && t < 2 ? 0 : 1 })), 127), b = render(coreNew, stream(60 * 3, () => base()), 127);
  let za = sec(1); while (a.L[za] !== 0 || a.R[za] !== 0) za++; const fade = za - sec(1); let md = 0;
  for (let i = sec(0.3); i < sec(0.9); i++) md = Math.max(md, Math.abs(a.L[sec(2) + i] - b.L[sec(1) + fade + i]), Math.abs(a.R[sec(2) + i] - b.R[sec(1) + fade + i]));
  check(md < 1e-6, 'pause freezes the state: on resuming, the sound is what it would have been', 'largest difference ' + md.toExponential(1) + ' from 0.3 s after resuming (fade-out ' + fade + ' samples)');
  const u = render(coreNew, stream(60 * 2, (f, t) => ({ rpm: 4000, thr: 1, gear: 3, speed: 30, mute: t >= 1 ? 1 : 0 })), 127), r = render(coreRef, stream(60 * 2, (f, t) => ({ rpm: 4000, thr: 1, gear: 3, speed: 30, mute: t >= 1 ? 1 : 0 })), 63);
  check(sameBits(u.L, r.L) === 0 && zeroIn(u, 1.1, 2), 'Uno: mute as in the reference, exact zeros');
});

test('loudness', () => {
  say('Loudness, DB5 against Uno: the same road speeds (the Uno\'s run: rest, full throttle through the gears, lift-off, braking, part throttle), chase camera');
  const thr = t => t < 1.5 ? 0 : t < 20 ? 1 : t < 23 ? 0 : t < 25 ? -1 : 0.5, rows = {}, du = drive('uno', 30, thr), ex = (t) => ({ slipL: t > 23 && t < 25 ? 0.3 : 0, slipR: t > 23.4 && t < 24.6 ? 0.2 : 0 });
  const runs = { uno: drive('uno', 30, thr, ex), db5: drive('db5', 30, thr, ex, du.log) };
  for (const car of ['uno', 'db5']) {
    const d = runs[car], o = render(coreNew, d.rec, 127), m = mono(o), N = 32768; let knee = 0; for (let i = 0; i < o.n; i++) if (Math.abs(o.L[i]) > 0.22 || Math.abs(o.R[i]) > 0.22) knee++;
    let hi = 0, cnt = 0; for (let s = sec(2); s + N < o.n; s += N) { const mg = spec(m, s, N); hi += band(mg, N, 1000, 12000) ** 2; cnt++; }
    const lay = [0, 1, 2, 3].map(l => rms(mono(render(coreNew, d.rec, 1 << l)), sec(1.5)));
    rows[car] = { rms: rms(m, sec(1.5)), pk: bad(o).pk, lay, full: rms(mono(render(coreNew, d.rec, 1)), sec(8), sec(20)), fullmix: rms(m, sec(8), sec(20)), hi: Math.sqrt(hi / cnt), knee: knee / o.n, top: Math.max(...d.log.speed) };
  }
  say('  car   mix rms  mix peak  rms above 1 kHz  over the limiter knee | layers alone, rms: engine  tyres   wind    road  | 8-20 s (full throttle): engine rms  mix rms | top speed m/s');
  for (const k in rows) { const r = rows[k]; say('  ' + k + '   ' + f4(r.rms) + '   ' + f3(r.pk) + '       ' + f4(r.hi) + '            ' + f3(r.knee * 100) + ' %       |                    ' + r.lay.map(f4).join('  ') + ' |                         ' + f4(r.full) + '      ' + f4(r.fullmix) + '  |    ' + f1(r.top)); }
  const u = rows.uno, d = rows.db5;
  check(d.rms <= u.rms, 'the DB5 mix is no louder than the Uno mix over the run (rms)', f2(dB(d.rms / u.rms)) + ' dB');
  check(d.lay[0] <= u.lay[0] && d.full <= u.full, 'nor is its engine, over the run and on full throttle', f2(dB(d.lay[0] / u.lay[0])) + ' dB and ' + f2(dB(d.full / u.full)) + ' dB');
  check(d.hi <= u.hi, 'and it carries no more energy above 1 kHz', f2(dB(d.hi / u.hi)) + ' dB');
  check(d.pk <= u.pk && d.pk < 0.39, 'peak no higher', f3(d.pk) + ' against ' + f3(u.pk));
  // with the guns: how hard the limiter is pushed
  const g = drive('db5', 12, t => t < 1 ? 0 : 1, (t) => ({ gad: t > 5 && t < 9 ? 1 : 0 })), og = render(coreNew, g.rec, 127), mg = mono(og); let knee = 0; for (let i = sec(5); i < sec(9); i++) if (Math.abs(og.L[i]) > 0.22 || Math.abs(og.R[i]) > 0.22) knee++;
  say('  guns firing on full throttle: mix rms ' + f4(rms(mg, sec(5), sec(9))) + ' (without them: ' + f4(rms(mg, sec(9.6), sec(11.6))) + '), peak ' + f3(Math.max(pk(og.L, sec(5), sec(9)), pk(og.R, sec(5), sec(9)))) + ', ' + f2(knee / sec(4) * 100) + ' % of the samples over the limiter knee');
});

test('warm-reset', () => {
  say('Warm-up (sndWarm, as the worklet runs it) and reset()');
  for (const db5 of [0, 1]) {
    const rec = wander(60 * 12, 77, db5, db5), A = coreNew(SR), fresh = render(coreNew, rec, 127), warm = (warmNew(A, db5), render(coreNew, rec, 127, { core: A }));
    check(sameBits(fresh.L, warm.L) + sameBits(fresh.R, warm.R) === 0, (db5 ? 'DB5' : 'Uno') + ': after the warm-up and reset() the output is that of a new synthesiser, bit for bit', fresh.n * 2 + ' samples');
    const again = render(coreNew, rec, 127); check(sameBits(fresh.L, again.L) === 0, (db5 ? 'DB5' : 'Uno') + ': deterministic (two fresh runs agree)', 'hash ' + hash(again));
  }
  // what the DB5 warm-up visits
  const core = mkCore(srcNew, COUNTERS), G = globalThis;
  Object.assign(G, { __pops: 0, __seats: 0, __clunks: 0, __shots: 0, __miss: 0, __crank: 0, __flare: 0, __seatEnd: 0, __lim: 0, __frozen: 0 }); warmNew(core(SR), 1);
  say('  the DB5 warm-up went through: ' + G.__crank + ' chunks of cranking, ' + G.__flare + ' of flare, ' + G.__miss + ' weak firings, ' + G.__pops + ' pops, ' + G.__shots + ' gun reports, ' + G.__clunks + ' clunks, ' + G.__seats + ' seat firings (' + G.__seatEnd + ' played to the end), ' + G.__lim + ' samples in the limiter, ' + G.__frozen + ' frozen chunks (mute, pause)');
  check(G.__crank > 400 && G.__flare > 400 && G.__miss > 20 && G.__pops >= 3 && G.__shots > 20 && G.__clunks > 10 && G.__seats >= 2 && G.__seatEnd >= 1 && G.__lim > 100 && G.__frozen > 20, 'the DB5 warm-up reaches the rare branches (starter, weak firings, pops, guns, clunks, a whole seat firing, limiter, mute and pause)');
});

// ---- the glue around the synthesiser, run in a sandbox with a mock of the game: sndControl, sndStart (worklet module), sndOffline
function sandbox(src, car) {
  const sc = { CARSEL: car, GAD: { snd: new Int32Array(4) }, ZONE: { ASPHALT: 0, KERB: 1, GRASS: 2, GRAVEL: 3, ROUGH: 4, PIT: 5 },
    VEH: { wzone: new Uint8Array(4), slip: new Float32Array(4), yaw: 0.3, vx: 20, vy: 1, rpm: 3000, gear: 2, ctl: new Float32Array(2), hits: 0 }, GS: { cam: 0, speed: 20, cx: 10, cy: 0, cz: 5 },
    R: { cam: { pos: new Float32Array([4, 2, 3]), fwd: new Float32Array([0.8, -0.1, 0.6]) } }, TRK: { L: 1600, stand: { s0: 0, s1: 100, d0: 10, d1: 14 } }, trackPos: (s, d, p) => { p[0] = s; p[1] = 0; p[2] = d; return p; },
    console, setTimeout, Promise, encodeURIComponent, Math, Int32Array, Float32Array, Float64Array, Int16Array, Uint8Array, mods: [], URL: { createObjectURL: () => 'blob:x' }, Blob: function () { } };
  sc.window = { AudioContext: function () { this.sampleRate = SR; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: u => { sc.mods.push(u); return Promise.resolve(); } }; this.resume = () => { }; this.suspend = () => { }; } };
  sc.AudioWorkletNode = function () { const P = new Map(); for (let i = 0; i < 16; i++) P.set('p' + i, { value: 0 }); this.parameters = P; this.connect = () => { }; };
  vm.createContext(sc); vm.runInContext(src + '\n;this.X = { SND, sndInit, sndControl, sndStart, sndFrame, sndFlags, sndRun, sndMute, sndRecTick, sndOffline, sndCore };', sc);
  return sc;
}
// run the worklet module text with a mock of the worklet scope; returns the processor instance
function worklet(code) {
  const w = { sampleRate: SR, AudioWorkletProcessor: function () { }, Float32Array, Float64Array, Int32Array, Math, proc: null }; w.registerProcessor = (n, c) => { w.proc = c; w.name = n; };
  vm.createContext(w); vm.runInContext(code, w); return { inst: new w.proc(), name: w.name, desc: w.proc.parameterDescriptors };
}
test('glue', () => {
  say('sndControl, sndFlags, sndOffline and the worklet module, run against a mock of the game');
  const mk = (src, car) => { const s = sandbox(src, car); s.X.sndInit(); return s; };
  const U0 = mk(srcRef, 'uno'), U1 = mk(srcNew, 'uno'), D1 = mk(srcNew, 'db5');
  let q = 12345; const r = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296), set = (s, k) => {
    const V = s.VEH, G = s.GS; V.rpm = 900 + k.a * 5800; V.gear = Math.floor(k.b * 6); V.ctl[0] = k.c; V.vx = k.d * 50; V.vy = k.e * 4 - 2; V.yaw = k.f * 6; V.hits = Math.floor(k.g * 3000); G.speed = Math.hypot(V.vx, V.vy); G.cam = k.cam; G.cx = k.a * 100; G.cz = k.b * 60;
    for (let i = 0; i < 4; i++) { V.wzone[i] = Math.floor(k.z[i] * 6); V.slip[i] = k.s[i]; } s.R.cam.pos.set([k.c * 80, 2 + k.d * 6, k.e * 70]); s.X.SND.run = k.run; s.X.SND.mute = k.mute; };
  let dif = 0, n = 0, bit16 = 0, c15 = 0;
  for (let i = 0; i < 4000; i++) {
    const k = { a: r(), b: r(), c: r(), d: r(), e: r(), f: r(), g: r(), cam: Math.floor(r() * 3), z: [r(), r(), r(), r()], s: [r(), r(), r(), r()], run: r() < 0.9, mute: r() < 0.1 };
    set(U0, k); set(U1, k); set(D1, k); U1.GAD.snd[0] = 31; U1.GAD.snd[1] = i; U1.GAD.snd[2] = i * 2;   // the Uno must ignore GAD.snd
    U0.X.sndControl(); U1.X.sndControl(); D1.X.sndControl(); n++;
    for (let j = 0; j < 16; j++) { if (U0.X.SND.sc[j] !== U1.X.SND.sc[j]) dif++; if (j && j < 15 && D1.X.SND.sc[j] !== U1.X.SND.sc[j]) dif++; }
    if ((D1.X.SND.sc[0] & ~16) !== U1.X.SND.sc[0] || !(D1.X.SND.sc[0] & 16)) bit16++; if (U1.X.SND.sc[15] !== 0) c15++;
  }
  check(dif === 0 && c15 === 0, 'Uno: sndControl gives the 16 controls of the reference over ' + n + ' random game states (GAD.snd ignored); DB5: controls 1-14 are the same', dif + ' differences');
  check(bit16 === 0, 'DB5: control 0 is the Uno\'s plus bit 16');
  // cockpit camera and gadget word
  const G = D1.GAD.snd, S = D1.X.SND, w = () => { D1.X.sndControl(); return S.sc[15]; }; D1.GS.cam = 3; D1.X.sndControl();
  check(((S.sc[0] >> 2) & 3) === 3 && (S.sc[0] & 16) === 16 && S.sc[11] === S.sc[4] && S.sc[10] === 10000, 'DB5: the cockpit camera travels as camera 3, with the car\'s own wind and no Doppler', 'control 0 = ' + S.sc[0]);
  G.fill(0); S.gad.fill(0); const seq = [];
  G[0] = 1 | 4 | 16; seq.push(w()); G[1] = 1; seq.push(w()); G[1] = 2; G[2] = 3; seq.push(w()); G[0] = 0; G[1] = 0; G[2] = 0; seq.push(w()); G[1] = 1; seq.push(w()); G[2] = 100; seq.push(w()); seq.push(w());
  const dec = v => (v & 31) + '/' + ((v >> 5) & 31) + '/' + ((v >> 10) & 63);
  check(seq.map(dec).join(' ') === '21/0/0 21/1/0 21/2/3 0/2/3 0/3/3 0/3/10 0/3/10', 'DB5: control 15 = flags / seat count / end-stop count; zeroing GAD.snd adds nothing, a jump is capped', seq.map(dec).join(' '));
  // sndFlags keeps camera and car
  S.sc[0] = 1 | (3 << 2) | 16; S.run = false; S.mute = true; D1.X.sndFlags(); check(S.sc[0] === (2 | 12 | 16), 'sndFlags keeps the camera and the car bit', S.sc[0]);
  const Su = U1.X.SND; Su.sc[0] = 1 | (2 << 2); Su.run = true; Su.mute = false; U1.X.sndFlags(); U0.X.SND.sc[0] = 1 | (2 << 2); U0.X.SND.run = true; U0.X.SND.mute = false; U0.X.sndFlags(); check(Su.sc[0] === U0.X.SND.sc[0], 'Uno: sndFlags as in the reference');
  // sndOffline: Uno identical PCM; DB5 mask handling
  const lap = drive('uno', 8, t => t < 1 ? 0 : 1).rec, off = (s, rec, mix, mu, pa) => { s.X.SND.rec = rec; s.X.SND.recN = rec.length / 16; const info = s.X.sndOffline(mix, mu, pa); return { info, pcm: s.X.SND.pcm }; };
  const p0 = off(U0, lap, 63, 300, 420), p1 = off(U1, lap, 63, 300, 420); let pd = 0; for (let i = 0; i < p0.pcm.length; i++) if (p0.pcm[i] !== p1.pcm[i]) pd++;
  check(pd === 0 && p0.info.pico === p1.info.pico, 'Uno: sndOffline gives the reference PCM (with mute from frame 300 and pause from 420)', p0.pcm.length + ' values, peak ' + f4(p1.info.pico));
  const gl = gadStream(4, t => ({ gad: t > 1 && t < 2 ? 1 : 0 })), e63 = off(D1, gl, 63, -1, -1).pcm.slice(), e64 = off(D1, gl, 64, -1, -1).pcm.slice(), e31 = off(D1, gl, 31, -1, -1).pcm.slice(), e127 = off(D1, gl, 127, -1, -1).pcm.slice();
  const pkI = a => { let p = 0; for (let i = 96000; i < 192000; i++) p = Math.max(p, Math.abs(a[i])); return p; }; let same = 0; for (let i = 0; i < e63.length; i++) if (e63[i] !== e127[i]) same++;
  check(same === 0 && pkI(e64) > 3000 && pkI(e63) > pkI(e31) + 2000, 'DB5: sndOffline plays the gadgets with mask 63 (as with 127), alone with 64, and leaves them out with 31', '16-bit peak while firing: ' + pkI(e63) + ' / ' + pkI(e64) + ' / ' + pkI(e31));
  // the worklet module
  const mods = {}; for (const [k, s] of [['ref', U0], ['uno', U1], ['db5', D1]]) { s.X.sndStart(); mods[k] = decodeURIComponent(s.mods[0].slice(s.mods[0].indexOf(',') + 1)); }
  check(mods.uno.startsWith('const mk=function sndCore(sr)') && mods.db5.includes('wu(this.s=mk(sampleRate),1)') && mods.uno.includes('wu(this.s=mk(sampleRate),0)'), 'the worklet module carries the synthesiser, the warm-up and the car', (mods.db5.length / 1024).toFixed(1) + ' KiB (was ' + (mods.ref.length / 1024).toFixed(1) + ' KiB)');
  const t0 = Date.now(), W = { ref: worklet(mods.ref), uno: worklet(mods.uno) }, t1 = Date.now(), Wd = worklet(mods.db5), t2 = Date.now();
  say('  constructing the processor (warm-up included): Uno ' + ((t1 - t0) / 2).toFixed(0) + ' ms, DB5 ' + (t2 - t1) + ' ms');
  check(W.uno.desc.length === 16 && W.uno.desc.every((d, i) => d.name === 'p' + i && d.automationRate === 'k-rate'), 'sixteen k-rate parameters, p0 to p15');
  const run = (inst, rec, n) => { const L = new Float32Array(n * 128), R = new Float32Array(n * 128), p = {}; for (let k = 0; k < 16; k++) p['p' + k] = new Float32Array(1);
    for (let b = 0; b < n; b++) { const f = Math.min(rec.length / 16 - 1, Math.floor(b * 128 / FR)); for (let k = 0; k < 16; k++) p['p' + k][0] = rec[f * 16 + k]; const o = [[new Float32Array(128), new Float32Array(128)]]; if (inst.process([], o, p) !== true) throw new Error('process'); L.set(o[0][0], b * 128); R.set(o[0][1], b * 128); } return { L, R, n: n * 128 }; };
  const ur = wander(60 * 10, 5, 0, 0), a = run(W.ref.inst, ur, 3750), b = run(W.uno.inst, ur, 3750);
  check(W.uno.name === 'uno' && sameBits(a.L, b.L) + sameBits(a.R, b.R) === 0, 'Uno: the worklet processor (warm-up, reset, 3,750 blocks of 128) gives the reference output, bit for bit', a.n * 2 + ' samples, hash ' + hash(b));
  const dr = wander(60 * 10, 6, 1, 1), c = run(Wd.inst, dr, 3750), S2 = coreNew(SR), L = new Float32Array(3750 * 128), R2 = new Float32Array(3750 * 128);
  for (let bl = 0; bl < 3750; bl++) { const f = Math.min(dr.length / 16 - 1, Math.floor(bl * 128 / FR)); for (let k = 0; k < 16; k++) S2.ctl[k] = dr[f * 16 + k]; S2.render(L, R2, bl * 128, 128); }
  check(sameBits(c.L, L) + sameBits(c.R, R2) === 0, 'DB5: the worklet processor gives what the offline synthesiser gives for the same controls', c.n * 2 + ' samples, hash ' + hash(c));
});

// ---- cost: time and allocation per block, deoptimisations after the warm-up
// integer-only driver (a float read here would itself allocate before it is optimised), filling the 16 controls for block i
function driveBlock(c, i, db5, gad) {
  c[0] = 1 | (db5 ? 16 : 0) | ((i >> 11) % (db5 ? 4 : 3)) << 2; c[1] = 900 + (i * 7) % 5000; c[2] = (i >> 9) & 1 ? 1000 : (i >> 7) & 1 ? 300 : 0; c[3] = 1 + (i >> 10) % 5; const v = 1000 + (i * 3) % 4000; c[4] = v; c[5] = (i >> 8) & 1 ? 400 : 0; c[6] = (i >> 9) & 1 ? 700 : 0; c[7] = (i >> 12) & 1 ? 500 : 0; c[8] = (i >> 11) & 1 ? 500 : 0;
  c[9] = 55; c[10] = 10000; c[11] = v; c[12] = 600; c[13] = 300; c[14] = i >> 9; c[15] = gad ? ((i >> 6) & 31) | ((i >> 10) & 31) << 5 | ((i >> 7) & 63) << 10 : 0;
}
function runBlocks(S, L, R, i0, n, db5, gad) { const c = S.ctl; for (let i = i0; i < i0 + n; i++) { driveBlock(c, i, db5, gad); S.render(L, R, 0, 128); } }
// child process: one configuration, measured as the worklet would run it (its own V8, the real warm-up); prints one JSON line
function costChild(cfg) {
  const db5 = cfg & 1, gad = cfg >> 1, S = coreNew(SR), L = new Float32Array(128), R = new Float32Array(128); warmNew(S, db5); runBlocks(S, L, R, 0, 6000, db5, gad);
  const heap = [], ms = [];
  for (let k = 0; k < 7; k++) { const h0 = process.memoryUsage().heapUsed, t0 = process.hrtime.bigint(); runBlocks(S, L, R, 6000 + k * 8192, 8192, db5, gad); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); heap.push((process.memoryUsage().heapUsed - h0) / 8192); }
  heap.sort((a, b) => a - b); ms.sort((a, b) => a - b); console.log('@@' + JSON.stringify({ us: ms[3] / 8192 * 1000, heap: heap[3], hmax: heap[6] }));
}
test('cost', () => {
  say('Cost and allocation, after the warm-up, in blocks of 128 as in the worklet (a block lasts 2,667 µs); one child process per case, so each has a V8 of its own');
  const res = [];
  for (const [name, cfg] of [['Uno', 0], ['DB5, no gadgets', 1], ['DB5, gadgets working', 3]]) {
    const out = cp.execFileSync(process.execPath, [__filename, '--src', SRC, '--ref', REF, '--cost-child', String(cfg)], { encoding: 'utf8' }), r = JSON.parse(out.slice(out.indexOf('@@') + 2)); r.name = name; res.push(r);
    say('  ' + name.padEnd(21) + ': ' + f1(r.us) + ' µs per block = ' + f2(r.us / 2666.7 * 100) + ' % of real time; heap growth per block (median of 7 runs of 8,192 blocks) ' + f2(r.heap) + ' bytes, largest ' + f2(r.hmax));
  }
  check(res[2].us < 267, 'DB5 with every gadget working costs under 10 % of real time on this machine (about 3 % when the machine is idle)', f2(res[2].us / 26.667) + ' %');
  check(res.every(r => Math.abs(r.heap) < 1 && r.hmax < 2), 'no allocation per block: the heap does not grow while rendering, in any of the seven runs', res.map(r => f2(r.heap) + ' (largest ' + f2(r.hmax) + ')').join(' / ') + ' bytes per block');
});
// child process for the test below: warm up as the worklet does, then render a long varied stream in blocks of 128.
// which: 0 Uno, 1 DB5, 2 the reference Uno (with the warm-up it had)
function deoptChild(which) {
  const db5 = which === 1 ? 1 : 0, S = (which === 2 ? coreRef : coreNew)(SR), L = new Float32Array(128), R = new Float32Array(128);
  if (which === 2) { oldWarm(S, L, R); S.reset(); } else warmNew(S, db5);
  console.log('@@WARM');
  for (let b = 0; b < 5; b++) { S.ctl.fill(0); S.ctl[0] = 1 | (db5 ? 16 : 0); S.render(L, R, 0, 128); }   // as in the game: the first blocks come before the first controls
  const play = (rec) => { const n = Math.floor(rec.length / 16 * FR / 128), c = S.ctl; for (let b = 0; b < n; b++) { const f = Math.floor(b * 128 / FR) * 16; for (let k = 0; k < 16; k++) c[k] = rec[f + k]; S.render(L, R, 0, 128); } };
  const gfn = (t) => db5 ? ({ cam: Math.floor(t / 7) % 4, gad: (t % 9 > 4 && t % 9 < 5.5 ? 1 : 0) | (t % 13 > 7 && t % 13 < 10 ? 2 : 0) | (t % 17 > 11 && t % 17 < 13 ? 4 : 0) | (t % 5 > 4 ? 8 : 0) | (t % 11 > 10 ? 16 : 0), es: Math.floor(t / 5), ej: Math.floor(t / 23) }) : ({ cam: Math.floor(t / 7) % 3 });
  const lap = t => { const u = t % 14; return t < 1.2 ? 0 : u < 7.5 ? 1 : u < 8.3 ? 0 : u < 10.3 ? -0.8 : u < 11 ? 0.3 : 1; };
  play(drive(db5 ? 'db5' : 'uno', 90, lap, (t, f, s) => Object.assign({ slipL: (t % 14) > 10.3 && (t % 14) < 11.6 ? 0.45 : 0, slipR: (t % 14) > 10.5 && (t % 14) < 11.4 ? 0.3 : 0, kerb: t % 19 > 18 ? 0.5 : 0, loose: t % 31 > 29 ? 0.5 : 0, hits: Math.floor(t / 37), crowd: t % 40 < 6 ? 0.7 : 0, lsp: s.speed }, gfn(t))).rec);
  play(wander(60 * 90, 4242, db5, db5));
  console.log('@@END');
}
test('deopt', () => {
  say('Deoptimisations of the synthesiser after the warm-up (child process with --trace-deopt: warm-up as in the worklet, then a 90 s lap-like drive — with every gadget for the DB5 — and 90 s of wandering controls, mute and pause included)');
  const names = /<JSFunction (chunk|engDB5|gadDB5|svf|noise|noise2|rnd16|render|birdNote|birdStart|reset)\b/, cnt = {};
  for (const [which, name] of [[2, 'reference Uno'], [0, 'Uno'], [1, 'DB5']]) {
    const out = cp.execFileSync(process.execPath, ['--trace-deopt', __filename, '--src', SRC, '--ref', REF, '--deopt-child', String(which)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const a = out.indexOf('@@WARM'), b = out.indexOf('@@END'); if (a < 0 || b < 0) throw new Error('child failed: ' + out.slice(-400));
    const hits = out.slice(a, b).split('\n').filter(l => l.includes('bailout') && names.test(l)), during = out.slice(0, a).split('\n').filter(l => l.includes('bailout') && names.test(l));
    cnt[which] = hits.length; say('  ' + name + ': ' + during.length + ' during the warm-up, ' + hits.length + ' after it');
    for (const l of hits.slice(0, 8)) say('    ' + l.replace(/0x[0-9a-f]+/g, '').replace(/\s+/g, ' ').replace(/, FP to SP.*$/, '').slice(0, 200));
  }
  check(cnt[1] === 0, 'DB5: no deoptimisation of the synthesiser once the warm-up is over', cnt[1]);
  check(cnt[0] <= cnt[2], 'Uno: no more than with the reference synthesiser and the warm-up it always had (those it has come from the first mute or pause and the first sample to reach the limiter, which that warm-up never visits)', cnt[0] + ' against ' + cnt[2]);
});

// ---------------------------------------------------------------------------------------------------------- run
(function main() {
  if (process.argv.includes('--deopt-child')) { deoptChild(+arg('deopt-child', '1')); return; }
  if (process.argv.includes('--cost-child')) { costChild(+arg('cost-child', '0')); return; }
  const t0 = Date.now(), sel = ONLY ? ONLY.split(',') : null;
  console.log('sound test bench: ' + path.relative(ROOT, SRC) + ' against ' + (fs.existsSync(REF) ? REF : 'git ' + REF + ':fable/source/js/50_som.js') + (WAV ? ', WAV files to ' + WAV : ''));
  for (const [name, fn] of tests) {
    if (sel && !sel.includes(name)) continue;
    console.log('\n== ' + name); const t = Date.now();
    try { fn(); } catch (e) { fails++; failed.push(name + ' threw'); console.log('  FAIL ' + name + ' threw: ' + (e.stack || e)); }
    say('  (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)');
  }
  if (wavs.length) console.log('\nWAV files in ' + WAV + ':\n  ' + wavs.join('\n  '));
  console.log('\n' + checks + ' checks, ' + fails + ' failed' + (fails ? ': ' + failed.join('; ') : '') + '   (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(fails ? 1 : 0);
})();
