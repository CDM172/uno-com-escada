#!/usr/bin/env node
// Test bench for the game's sound synthesiser (fable/source/js/50_som.js). No browser: sndCore is plain JavaScript, so
// this script cuts it out of the source file, feeds it synthetic control streams (one set of 16 integers per 1/60 s frame,
// as the game records them) and measures what comes out. The glue around the synthesiser (sndControl, the worklet
// module built by sndStart, sndOffline) is run in a sandbox against a mock of the game. Three cars: the Fiat Uno, the
// Aston Martin DB5 (straight six) and the Aston Martin V8 Vantage (cross-plane V8).
//
//   node tools/snd_test.js [--src FILE] [--ref FILE|git-rev] [--ref-db5 FILE|git-rev] [--wav DIR] [--only name,...] [--quiet]
//
//   --src      the sound source under test (default fable/source/js/50_som.js)
//   --ref      the reference for "the Uno must not change": a file, or a git revision of the source (default ac7d06c, the
//              last commit in which the Uno was the only car)
//   --ref-db5  the reference for "the DB5 must not change" (default f183d38, the commit that brought the DB5, before the V8)
//   --wav      directory for audition files (16-bit stereo WAV, 48 kHz): drives from the four cameras, drive-bys and every
//              gadget of the DB5 and the V8 (the V8's are named v8_*); nothing is written without it
//   --only  run just the named tests (the names are the "== name" headings of the report)
//
// Every test prints its measurements; a failed check is marked FAIL and the process exits with status 1.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..'), SRC = path.resolve(arg('src', path.join(ROOT, 'fable/source/js/50_som.js')));
const REF = arg('ref', 'ac7d06c'), REF_DB5 = arg('ref-db5', 'f183d38'), WAV = arg('wav', null), ONLY = arg('only', null), QUIET = process.argv.includes('--quiet');
const SR = 48000, FR = 800;                       // sample rate and samples per 1/60 s frame, as in sndOffline

// ---------------------------------------------------------------------------------------------------------- loading
function readRef(ref) {
  if (fs.existsSync(ref)) return fs.readFileSync(ref, 'utf8');
  return cp.execFileSync('git', ['show', ref + ':fable/source/js/50_som.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
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
const srcNew = fs.readFileSync(SRC, 'utf8'), srcRef = readRef(REF), srcDb5 = readRef(REF_DB5);
// patch: [[text, replacement], ...] applied to the source of sndCore (used to count rare events; every text must be found)
const mkCore = (src, patch) => { let t = fnText(src, 'sndCore'); for (const [a, b] of patch || []) { if (!t.includes(a)) throw new Error('patch text not found: ' + a); t = t.split(a).join(b); } return new Function(t + '\nreturn sndCore;')(); };
const coreNew = mkCore(srcNew), coreRef = mkCore(srcRef), coreDb5 = mkCore(srcDb5);
const warmNew = new Function(fnText(srcNew, 'sndWarm') + '\nreturn sndWarm;')();

// ---------------------------------------------------------------------------------------------------------- controls
// One frame of controls from a description in physical units (see the layout at the top of 50_som.js).
function frame(rec, f, o) {
  const c = rec.subarray(f * 16, f * 16 + 16);
  c[0] = (o.run === 0 ? 0 : 1) | (o.mute ? 2 : 0) | ((o.cam || 0) << 2) | (o.db5 ? 16 : 0) | (o.v8 ? 32 : 0);
  c[1] = o.rpm === undefined ? 900 : o.rpm; c[2] = (o.thr || 0) * 1000; c[3] = o.gear === undefined ? 1 : o.gear; c[4] = (o.speed || 0) * 100;
  c[5] = (o.slipL || 0) * 1000; c[6] = (o.slipR || 0) * 1000; c[7] = (o.loose || 0) * 1000; c[8] = (o.kerb || 0) * 1000;
  c[9] = (o.dist === undefined ? 5.5 : o.dist) * 10; c[10] = (o.dop || 1) * 10000; c[11] = (o.lsp === undefined ? (o.speed || 0) : o.lsp) * 100;
  c[12] = (o.crowd || 0) * 1000; c[13] = (o.side || 0) * 1000; c[14] = o.hits || 0;
  c[15] = (o.gad || 0) | ((o.ej || 0) & 31) << 5 | ((o.es || 0) & 63) << 10 | ((o.ex || 0) & 31) << 16;   // ej: DB5 seat / V8 missile; ex: V8 explosions
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
  v8: { gears: [2.90, 1.78, 1.22, 1.00, 0.845], final: 3.54, R: 0.335, idle: 780, shift: 6200, acc: [7.6, 5.4, 3.8, 2.8, 1.9], db5: 0, v8: 1 },
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
    const o = Object.assign({ db5: C.db5, v8: C.v8, rpm, thr, gear: g, speed: v }, extra ? extra(t, f, { rpm, gear: g, speed: v, thr }) : null);
    frame(rec, f, o); log.rpm[f] = rpm; log.gear[f] = g; log.speed[f] = v; log.thr[f] = thr;
    v += ((thr * C.acc[g - 1] * (rpm < C.shift + 200 ? 1 : 0)) - (th < 0 ? -th * 9 : 0) - 0.25 - 0.0009 * v * v) / 60; if (v < 0) v = 0;
  }
  return { rec, log, n };
}
// pseudo-random but plausible game: every control wanders; cameras, gears, crashes, mute and pause all happen
// (db5: 1 for the DB5, 2 for the V8; gadgets: the flags and counters of that car wander too)
function wander(n, seed, db5, gadgets, noStops) {
  let q = seed >>> 0; const r = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  let rpm = 900, thr = 0, gear = 1, speed = 0, cam = 0, hits = 0, mute = 0, run = 1, sl = 0, sr = 0, loose = 0, kerb = 0, dist = 5.5, dop = 1, crowd = 0, side = 0, gad = 0, ej = 0, es = 0, ex = 0;
  return stream(n, () => {
    if (r() < 0.03) thr = r() < 0.3 ? 0 : r(); if (r() < 0.01) gear = Math.floor(r() * 6); if (r() < 0.006) cam = Math.floor(r() * (db5 ? 4 : 3));
    rpm += ((thr > 0.1 ? 6700 : 900) - rpm) * 0.01 * (0.5 + r()); speed += ((thr > 0.1 ? 55 : 0) - speed) * 0.004;
    if (r() < 0.004) hits++; if (r() < 0.02) sl = r() < 0.5 ? 0 : r(); if (r() < 0.02) sr = r() < 0.5 ? 0 : r(); if (r() < 0.01) loose = r() < 0.6 ? 0 : r(); if (r() < 0.01) kerb = r() < 0.6 ? 0 : r();
    if (r() < 0.01) dist = cam === 2 ? 3 + r() * 250 : 5.5; dop = cam === 2 ? 0.9 + r() * 0.2 : 1; if (r() < 0.01) { crowd = r(); side = r() * 2 - 1; }
    if (r() < 0.002) mute ^= 1; if (r() < 0.002) run ^= 1; if (noStops) { mute = 0; run = 1; }
    if (gadgets) { if (r() < 0.02) gad = Math.floor(r() * 32); if (r() < 0.004) ej++; if (r() < 0.01) es++; if (db5 === 2 && r() < 0.003) ex++; }
    return { run, mute, cam, db5: db5 === 1, v8: db5 === 2, rpm, thr, gear, speed, slipL: sl, slipR: sr, loose, kerb, dist, dop, lsp: cam === 2 ? 0 : speed, crowd, side, hits: hits & 1023, gad, ej, es, ex };
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
// the same for the V8 Vantage
const COUNTERS_V8 = [['if (r3 >= kT) {', 'if (r3 >= kT) { globalThis.__v8pops++;'], ['else { crk = 1; rp = 190;', 'else { globalThis.__crank++; crk = 1; rp = 190;'], ['if (f < 0.02) YI[ZST] = 3;', 'globalThis.__flare++; if (f < 0.02) YI[ZST] = 3;'],
  ['if (r2 < misT) a *= 0.3;', 'if (r2 < misT) { a *= 0.3; globalThis.__miss++; }'], ['let bk = (ld - ls - 0.04) * 2.5; bk = bk < 0 ? 0 : bk > 1 ? 1 : bk;', 'let bk = (ld - ls - 0.04) * 2.5; bk = bk < 0 ? 0 : bk > 1 ? 1 : bk; if (bk > 0.5) globalThis.__bark++;'],
  ['Y[QL1] = p1; Y[QL2] = p2;', 'Y[QL1] = p1; Y[QL2] = p2; globalThis.__laser++;'], ['Y[QRT] = th < 1e-6 ? 0 : th;', 'Y[QRT] = th < 1e-6 ? 0 : th; globalThis.__rocket++;'], ['Y[QVP8] = p;', 'Y[QVP8] = p; globalThis.__servo++;'], ['Y[QH18] = p1;', 'Y[QH18] = p1; globalThis.__horn++;'],
  ['YI[ZMQ]--;', 'YI[ZMQ]--; globalThis.__missiles++;'], ['YI[ZXQ]--;', 'YI[ZXQ]--; globalThis.__booms++;'], ['YI[ZSQ]--;', 'YI[ZSQ]--; globalThis.__clunks++;'], ['if (te > 3) YI[ZMA] = 0;', 'if (te > 3) { YI[ZMA] = 0; globalThis.__missileEnd++; }'], ['if (te > 3.2) YI[ZXA] = 0;', 'if (te > 3.2) { YI[ZXA] = 0; globalThis.__boomEnd++; }'],
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

test('db5-identical', () => {
  say('DB5: the output of the new synthesiser against the DB5 before the V8 (' + (fs.existsSync(REF_DB5) ? REF_DB5 : 'git ' + REF_DB5) + '), bit for bit');
  let total = 0, diff = 0; const cmp = (a, b, what) => { const d = sameBits(a.L, b.L) + sameBits(a.R, b.R); total += a.n * 2; diff += d; check(d === 0, what, a.n * 2 + ' samples, ' + d + ' differ, hash ' + hash(b)); };
  // the DB5 pattern of the worklet's warm-up, as the reference ran it (recorded from its own sndWarm), through both synthesisers
  { const warmRef = new Function(fnText(srcDb5, 'sndWarm') + '\nreturn sndWarm;')(), blocks = [], spy = { ctl: new Float32Array(16), render() { blocks.push(Float32Array.from(this.ctl)); }, reset() { } }; warmRef(spy, 1);
    const run = core => { const S = core(SR), n = blocks.length * 128, o = { L: new Float32Array(n), R: new Float32Array(n), n }; for (let b = 0; b < blocks.length; b++) { S.ctl.set(blocks[b]); if (b === 250) S.reset(); S.render(o.L, o.R, b * 128, 128); } return o; };
    cmp(run(coreDb5), run(coreNew), 'the DB5 warm-up pattern (' + blocks.length + ' blocks of 128, with the reset at block 250)'); }
  for (const [seed, blk, sr] of [[21, 800, SR], [22, 128, SR], [23, 37, SR], [24, 735, 44100], [25, 128, 96000]]) {
    const rec = wander(60 * 30, seed, 1, 1); cmp(render(coreDb5, rec, 127, { block: blk, sr }), render(coreNew, rec, 127, { block: blk, sr }), 'wandering controls with gadgets, mute and pause, seed ' + seed + ', blocks of ' + blk + ', ' + sr + ' Hz (30 s)');
  }
  const gfn = (t) => ({ gad: (t > 4 && t < 6 ? 1 : 0) | (t > 7 && t < 10 ? 2 : 0) | (t > 11 && t < 13 ? 4 : 0) | (t > 14 && t < 15.2 ? 8 : 0) | (t > 16.5 && t < 17.5 ? 16 : 0), es: t > 15.2 ? 1 : 0, ej: t > 19 ? 1 : 0 });
  for (const [name, cam, dist] of [['chase', 0, 5.5], ['bonnet', 1, 1.5], ['TV', 2, 40], ['cockpit', 3, 0.6]]) {
    const d = drive('db5', 23, t => t < 1.5 ? 0 : t < 18 ? 1 : t < 20 ? 0 : -0.6, (t, f, s) => Object.assign({ cam, dist, lsp: cam === 2 ? 0 : s.speed, slipL: t > 19 && t < 21 ? 0.4 : 0, kerb: t > 9 && t < 10 ? 0.5 : 0 }, gfn(t)));
    cmp(render(coreDb5, d.rec, 127), render(coreNew, d.rec, 127), 'a run with every gadget, ' + name + ' camera (23 s)');
    if (cam === 0) for (let l = 0; l < 7; l++) cmp(render(coreDb5, d.rec, 1 << l), render(coreNew, d.rec, 1 << l), 'the same, layer ' + l + ' alone');
  }
  // bits 16-20 of control 15 (the V8's explosion counter) must not reach the DB5
  { const rec = wander(60 * 15, 26, 1, 1), g = rec.slice(); for (let f = 0; f < g.length / 16; f++) g[f * 16 + 15] |= ((f >> 4) & 31) << 16;
    cmp(render(coreDb5, rec, 127), render(coreNew, g, 127), 'control 15 with the V8\'s explosion bits set, DB5 selected (15 s)'); }
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
  for (const car of [0, 1, 2]) {
    const nm = ['Uno', 'DB5', 'V8'][car], rec = wander(60 * 12, 77, car, car), A = coreNew(SR), fresh = render(coreNew, rec, 127), warm = (warmNew(A, car), render(coreNew, rec, 127, { core: A }));
    check(sameBits(fresh.L, warm.L) + sameBits(fresh.R, warm.R) === 0, nm + ': after the warm-up and reset() the output is that of a new synthesiser, bit for bit', fresh.n * 2 + ' samples');
    const again = render(coreNew, rec, 127); check(sameBits(fresh.L, again.L) === 0, nm + ': deterministic (two fresh runs agree)', 'hash ' + hash(again));
  }
  { const core = mkCore(srcNew, COUNTERS_V8), G = globalThis;
    Object.assign(G, { __v8pops: 0, __crank: 0, __flare: 0, __miss: 0, __bark: 0, __laser: 0, __rocket: 0, __servo: 0, __horn: 0, __missiles: 0, __booms: 0, __clunks: 0, __missileEnd: 0, __boomEnd: 0, __lim: 0, __frozen: 0 }); warmNew(core(SR), 2);
    say('  the V8 warm-up went through: ' + G.__crank + ' chunks of cranking, ' + G.__flare + ' of flare, ' + G.__miss + ' weak firings, ' + G.__bark + ' chunks of bark, ' + G.__v8pops + ' pops, ' + G.__laser + ' / ' + G.__rocket + ' / ' + G.__servo + ' / ' + G.__horn + ' chunks of lasers / rocket / servo / horn, ' + G.__missiles + ' missiles (' + G.__missileEnd + ' to the end), ' + G.__booms + ' explosions (' + G.__boomEnd + ' to the end), ' + G.__clunks + ' clunks, ' + G.__lim + ' samples in the limiter, ' + G.__frozen + ' frozen chunks');
    check(G.__crank > 400 && G.__flare > 400 && G.__miss > 20 && G.__bark > 50 && G.__v8pops >= 3 && G.__laser > 50 && G.__rocket > 50 && G.__servo > 50 && G.__horn > 50 && G.__missiles >= 2 && G.__missileEnd >= 1 && G.__booms >= 2 && G.__boomEnd >= 1 && G.__clunks > 10 && G.__lim > 100 && G.__frozen > 20, 'the V8 warm-up reaches the rare branches (starter, weak firings, bark, crackle, every gadget, a whole missile and explosion, limiter, mute and pause)'); }
  // what the DB5 warm-up visits
  const core = mkCore(srcNew, COUNTERS), G = globalThis;
  Object.assign(G, { __pops: 0, __seats: 0, __clunks: 0, __shots: 0, __miss: 0, __crank: 0, __flare: 0, __seatEnd: 0, __lim: 0, __frozen: 0 }); warmNew(core(SR), 1);
  say('  the DB5 warm-up went through: ' + G.__crank + ' chunks of cranking, ' + G.__flare + ' of flare, ' + G.__miss + ' weak firings, ' + G.__pops + ' pops, ' + G.__shots + ' gun reports, ' + G.__clunks + ' clunks, ' + G.__seats + ' seat firings (' + G.__seatEnd + ' played to the end), ' + G.__lim + ' samples in the limiter, ' + G.__frozen + ' frozen chunks (mute, pause)');
  check(G.__crank > 400 && G.__flare > 400 && G.__miss > 20 && G.__pops >= 3 && G.__shots > 20 && G.__clunks > 10 && G.__seats >= 2 && G.__seatEnd >= 1 && G.__lim > 100 && G.__frozen > 20, 'the DB5 warm-up reaches the rare branches (starter, weak firings, pops, guns, clunks, a whole seat firing, limiter, mute and pause)');
});

// ========================================================================================================== V8 Vantage
// (the V8's idle lope and hunting switched off where sharp spectral lines are wanted)
const V8_STEADY = [['(1 + 0.025 * lo + 0.6 * idl * hn)', '1']];
const coreV8s = mkCore(srcNew, V8_STEADY), coreDb5s = mkCore(srcNew, [['(1 + 1.2 * idl * hn)', '1']]);
// level (dB) of each order in list against the reference order, on x from t0 (2.7 s spectrum)
function orderTable(x, t0, rpm, list, refOrder) { const N = 131072, mg = spec(x, sec(t0), N), ref = line(mg, N, refOrder * rpm / 60, 0.006); return list.map(o => dB(line(mg, N, o * rpm / 60, 0.006) / ref)); }
// burble ratio (dB): energy on the lines of the 720° cycle that are not firing harmonics, against the energy on the firing
// harmonics, f0..f1 Hz. A perfectly even engine has none; perRev = firings per revolution (V8 4, DB5 3)
function burbleRatio(x, t0, rpm, perRev, f0, f1) {
  const N = 131072, mg = spec(x, sec(t0), N), fcyc = rpm / 120, k = fcyc * N / SR; let sub = 0, fir = 0;
  for (let h = 1; h * fcyc < f1; h++) { if (h * fcyc < f0) continue; const c = Math.round(h * k); let e = 0; for (let q = c - 1; q <= c + 1; q++) e += mg[q] * mg[q]; if (h % (2 * perRev) === 0) fir += e; else sub += e; }
  return 10 * Math.log10(sub / fir);
}
// slot pattern: energy in each 1/slots of the 720° cycle, averaged over n cycles from t0 and aligned on the firings
// (the steepest rise of the folded envelope); returns the averaged pattern and its spread (standard deviation / mean)
function slotPattern(x, t0, rpm, slots, n) {
  const T = 120 / rpm / slots * SR, s00 = sec(t0), fold = new Float64Array(Math.round(T));
  for (let c = 0; c < n * slots; c++) for (let i = 0; i < fold.length; i++) fold[i] += Math.abs(x[Math.round(s00 + c * T) + i]);
  let bi = 0, bd = -1; for (let i = 0; i < fold.length; i++) { const d = fold[(i + 8) % fold.length] - fold[i]; if (d > bd) { bd = d; bi = i; } }
  const s0 = s00 + bi - Math.round(0.05 * T), acc = new Float64Array(slots);
  for (let c = 0; c < n; c++) for (let k = 0; k < slots; k++) acc[k] += rms(x, Math.round(s0 + (c * slots + k) * T), Math.round(s0 + (c * slots + k + 0.5) * T)) / n;
  return { pat: Array.from(acc), spread: spread(Array.from(acc)) };
}
const V8 = (o) => Object.assign({ v8: 1, rpm: 780, thr: 0, gear: 1, speed: 0 }, o);

test('v8-firing', () => {
  say('V8 Vantage: firing order and the order spectrum of a cross-plane V8 (engine layer, chase camera)');
  // the firing order, from the raw pulse train of each bank (variation, jitter, weak firings and crackle switched off)
  const raw = b => mkCore(srcNew, V8_STEADY.concat([['(1 + jit * (r1 / 32768 - 1))', '1'], ['if (r2 < misT) a *= 0.3;', ''], ['if (r3 >= kT) {', 'if (false) {'], ['(1 + (YC[j] - 1) * ci)', '1'],
    ['for (let i = 0; i < m; i++) { YDL[dw] = pL[i]; const r = pR[i], l = YDL[(dw - YD) & (YDN - 1)]; dw = (dw + 1) & (YDN - 1); eg[i] = (r + l) * 0.5; eS[i] = (l - r) * 0.5 * wd; }', 'for (let i = 0; i < m; i++) { eg[i] = ' + b + '[i]; eS[i] = 0; }'], ['const lk = dg * GY,', 'const lk = 0,'], ['YWA[g5] * dg * 0.02', 'YWA[g5] * dg * 0']]));
  const rpm = 1200, slot = 60 / rpm / 4, pulses = [];
  for (const [b, nm] of [['yR', 'R'], ['yL', 'L']]) {
    // onsets: the first sample over 2 % of the largest pulse after a quiet stretch (the pulse width depends on the gap, by design, so peaks would move)
    const x = mono(render(raw(b), steady(3, V8({ rpm, thr: 0.3, gear: 2, speed: 12 })), 1)), mx = pk(x, sec(1), sec(3)); let quiet = 0;
    for (let i = sec(1); i < sec(3); i++) { const v = Math.abs(x[i]); if (v < 0.005 * mx) quiet++; else { if (v > 0.02 * mx && quiet > 0.15 * slot * SR) pulses.push({ t: i / SR, b: nm }); quiet = 0; } }
  }
  pulses.sort((p, q) => p.t - q.t);
  const seq = pulses.slice(0, 16).map(p => p.b).join(''), gaps = pulses.slice(1, 17).map((p, i) => (p.t - pulses[i].t) / slot);
  const bankGaps = nm => { const a = pulses.filter(p => p.b === nm).slice(0, 9); return a.slice(1).map((p, i) => Math.round((p.t - a[i].t) / slot)); };
  say('  firings in time order: ' + seq + '; spacing in 90° steps: ' + gaps.slice(0, 8).map(f2).join(' ') + '; right bank gaps (×90°): ' + bankGaps('R').join(' ') + ', left: ' + bankGaps('L').join(' '));
  const rot = (s, t) => (t + t).includes(s);
  check(rot(seq.slice(0, 8), 'RLRRLRLL') && seq.slice(0, 8) === seq.slice(8, 16), 'banks fire in the order of 1-5-4-2-6-3-7-8 (cylinders 1-4 right, 5-8 left): R L R R L R L L', seq.slice(0, 8));
  check(gaps.every(g => Math.abs(g - 1) < 0.01), 'one firing every 90° of crank (pulse onsets)', 'spacing ' + f3(Math.min(...gaps)) + ' .. ' + f3(Math.max(...gaps)) + ' × 90°');
  check(rot(bankGaps('R').slice(0, 4).join(''), '2123') && rot(bankGaps('L').slice(0, 4).join(''), '2123'), 'each bank fires unevenly, at gaps of 180, 90, 180, 270° (the cross-plane crank)');
  // strongest line = the firing line, rpm / 15, everywhere
  const rows = [];
  for (const thr of [1, 0.3]) for (const r of [780, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500]) {
    const o = render(coreV8s, steady(4.6, V8({ rpm: r, thr, gear: 3, speed: r > 1000 ? 25 : 0 })), 1), m = mono(o), N = 65536, p = peak(spec(m, sec(3.2), N), N, 30, 2500), ff = 4 * r / 60;
    rows.push({ r, thr, ff, f: p.f, rms: rms(m, sec(3.2)) });
  }
  check(rows.every(x => Math.abs(x.f / x.ff - 1) < 0.015), 'the strongest line (30-2,500 Hz) is the firing line, 4 × rpm / 60, from 780 to 6,500 rpm at full and light throttle', 'worst error ' + f2(Math.max(...rows.map(x => Math.abs(x.f / x.ff - 1))) * 100) + ' %; 52 Hz at idle, 433 Hz at 6,500 rpm');
  // the order spectrum: integer orders (the beat once and twice a revolution) and odd half orders, mono and each channel
  const ords = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4.5, 5, 6, 8];
  say('  orders (dB re the 4th):      ' + ords.map(o => String(o).padStart(6)).join('') + '   burble ratio (30-1,000 Hz)');
  const tab = {};
  for (const [nm, r, thr] of [['idle', 780, 0], ['part', 2500, 0.3], ['full-mid', 3500, 1], ['full-high', 5500, 1], ['overrun', 4000, 0]]) {
    const o = render(coreV8s, steady(8, V8({ rpm: r, thr, gear: 3, speed: r > 1000 ? 25 : 0 })), 1), m = mono(o);
    for (const [ch, x] of [['mono', m], ['left', o.L], ['right', o.R]]) { const t = orderTable(x, 4, r, ords, 4), b = burbleRatio(x, 4, r, 4, 30, 1000); tab[nm + ch] = { t, b }; if (ch !== 'right') say('  ' + (nm + ' ' + r + ' rpm, ' + ch).padEnd(28) + t.map(v => f1(v).padStart(6)).join('') + '   ' + f1(b).padStart(6) + ' dB'); }
  }
  const d5 = {};
  for (const [nm, r, thr] of [['idle', 750, 0], ['part', 2500, 0.3], ['full-mid', 3500, 1], ['full-high', 5500, 1]]) { const o = render(coreDb5s, steady(8, { db5: 1, rpm: r, thr, gear: 3, speed: r > 1000 ? 25 : 0 }), 1); d5[nm] = burbleRatio(mono(o), 4, r, 3, 30, 1000); }
  say('  DB5 (straight six), burble ratio in mono: idle ' + f1(d5.idle) + ', part throttle ' + f1(d5.part) + ', full throttle ' + f1(d5['full-mid']) + ' / ' + f1(d5['full-high']) + ' dB');
  const i2 = ords.indexOf(2), i6 = ords.indexOf(6), half = [0.5, 1.5, 2.5, 3.5, 4.5].map(o => ords.indexOf(o));
  check(['idle', 'part'].every(k => tab[k + 'mono'].t[i2] > -14 && tab[k + 'mono'].t[i2] < -4), 'the beat twice a revolution (2nd order) stands 4-14 dB under the firing line at idle and part throttle, in mono', 'idle ' + f1(tab.idlemono.t[i2]) + ', part ' + f1(tab.partmono.t[i2]) + ' dB');
  check(['full-mid', 'full-high'].every(k => tab[k + 'mono'].t[i2] < tab.partmono.t[i2] + 1 && tab[k + 'mono'].t[i2] > -20), 'and a little further down at full throttle (the burble turns to a roar)', f1(tab['full-midmono'].t[i2]) + ' / ' + f1(tab['full-highmono'].t[i2]) + ' dB');
  check(['idle', 'part', 'full-mid'].every(k => Math.max(...half.map(q => Math.max(tab[k + 'left'].t[q], tab[k + 'right'].t[q]))) > -16), 'odd half orders (the two banks heard apart): within 16 dB of the firing line in each channel at idle, part and full throttle', ['idle', 'part', 'full-mid'].map(k => f1(Math.max(...half.map(q => Math.max(tab[k + 'left'].t[q], tab[k + 'right'].t[q]))))).join(' / ') + ' dB');
  check(['idle', 'part', 'full-mid', 'full-high'].every(k => tab[k + 'mono'].b > d5[k] + 5), 'far more burble than the DB5\'s smooth six, everywhere (burble ratio, mono)', ['idle', 'part', 'full-mid', 'full-high'].map(k => '+' + f1(tab[k + 'mono'].b - d5[k])).join(' / ') + ' dB');
  check(tab.idlemono.b > tab['full-highmono'].b, 'most of it at idle, least flat out', f1(tab.idlemono.b) + ' against ' + f1(tab['full-highmono'].b) + ' dB');
});

test('v8-character', () => {
  say('V8 Vantage: idle, starter, timbre, bark, induction');
  // idle: 52 Hz, the lope (speed and strength surge about once a second), the uneven beat
  const o = render(coreNew, steady(14, V8({})), 1), m = mono(o), fr = [], lv = [];
  for (let t = 3; t < 13.5; t += 0.1) { fr.push(peak(spec(m, sec(t), 8192), 8192, 40, 65).f); lv.push(rms(m, sec(t), sec(t + 0.1))); }
  const mf = fr.reduce((a, b) => a + b) / fr.length, sf = Math.sqrt(fr.reduce((a, b) => a + (b - mf) ** 2, 0) / fr.length);
  const ps = slotPattern(mono(render(coreV8s, steady(14, V8({})), 1)), 4, 780, 8, 60), pd = slotPattern(mono(render(coreDb5s, steady(14, { db5: 1, rpm: 750 }), 1)), 4, 750, 6, 60);
  say('  firing line at idle ' + f1(mf) + ' Hz (± ' + f2(sf) + ' Hz as it lopes; 780 rpm = 52 Hz); level in 0.1 s windows ' + f4(Math.min(...lv)) + ' .. ' + f4(Math.max(...lv)) + ' (spread ' + f1(spread(lv) * 100) + ' %)');
  say('  idle pattern over the 720° cycle (energy per firing, mono, averaged over 60 cycles): V8 ' + ps.pat.map(v => Math.round(v / Math.max(...ps.pat) * 100)).join(' ') + ' (spread ' + f1(ps.spread * 100) + ' %); DB5 ' + pd.pat.map(v => Math.round(v / Math.max(...pd.pat) * 100)).join(' ') + ' (' + f1(pd.spread * 100) + ' %)');
  check(Math.abs(mf / 52 - 1) < 0.03 && sf > 0.4 && sf < 2.5, 'idles at 780 rpm (52 Hz firing line), loping', f1(mf) + ' ± ' + f2(sf) + ' Hz');
  check(spread(lv) > 0.08, 'the level surges with the lope', f1(spread(lv) * 100) + ' %');
  check(ps.spread > 0.2 && ps.spread > 2 * pd.spread, 'lumpy: an uneven pattern of firings that repeats every cycle, far more than the DB5\'s', f1(ps.spread * 100) + ' % against ' + f1(pd.spread * 100) + ' %');
  // starter
  const s = mono(render(coreNew, steady(4, V8({})), 1)), N = 8192, a = spec(s, sec(0.1), N), b = spec(s, sec(2.5), N);
  const st = x => Math.hypot(band(x, N, 280, 345), band(x, N, 560, 690), band(x, N, 840, 1040)), e = []; for (let t = 0.05; t < 0.65; t += 0.008) e.push(rms(s, sec(t), sec(t + 0.008)));
  const ev = Float64Array.from(e.map(v => v - e.reduce((p, q) => p + q) / e.length)), em = new Float64Array(64); for (let i = 0; i < ev.length; i++) em[i] = ev[i]; const re = Float64Array.from(em), im = new Float64Array(64); fft(re, im);
  let bk = 1, bm = 0; for (let k = 1; k < 32; k++) { const mg = Math.hypot(re[k], im[k]); if (mg > bm) { bm = mg; bk = k; } }
  const crankHz = bk / (64 * 0.008), fl = rms(s, sec(0.75), sec(1.05)), cr = rms(s, sec(0.1), sec(0.6)), id = rms(s, sec(3), sec(4));
  say('  starter: pinion bands (330 Hz and two harmonics) ' + f4(st(a)) + ' while cranking, ' + f4(st(b)) + ' at idle; rhythm of the cranking ' + f1(crankHz) + ' Hz (a compression every 90° at 190 rpm: 12.7 Hz); rms cranking ' + f4(cr) + ', catching ' + f4(fl) + ', idling ' + f4(id));
  check(st(a) > 0.003 && st(a) > 4 * st(b), 'the starter whirrs while cranking, and is gone once the engine idles');
  check(Math.abs(crankHz - 12.7) < 2.5, 'the cranking has the rhythm of eight cylinders\' compressions', f1(crankHz) + ' Hz');
  check(fl > 1.5 * cr && fl > 1.3 * id, 'the engine catches with a roar: the loudest moment of the start', f4(fl));
  wav('v8_start_idle_blips.wav', render(coreNew, stream(60 * 9, (f, t) => V8({ cam: 0, rpm: t > 4 && t < 4.9 ? 780 + 3400 * Math.sin((t - 4) / 0.9 * Math.PI) : t > 6 && t < 6.7 ? 780 + 2400 * Math.sin((t - 6) / 0.7 * Math.PI) : 780, thr: (t > 4 && t < 4.35) || (t > 6 && t < 6.25) ? 1 : 0 })), 127));
  wav('v8_idle_bonnet.wav', render(coreNew, steady(6, V8({ cam: 1, dist: 1.5 })), 127));
  wav('db5_idle_bonnet.wav', render(coreNew, steady(6, { db5: 1, cam: 1, dist: 1.5, rpm: 750 }), 127));
  // timbre against throttle and revs
  const rows = [];
  for (const r of [1500, 2500, 3500, 4500, 5500, 6200]) for (const thr of [0, 0.3, 1]) {
    const x = mono(render(coreNew, steady(3.2, V8({ rpm: r, thr, gear: 3, speed: 25 })), 1)), mg = spec(x, sec(2.2), 32768);
    rows.push({ r, thr, rms: rms(x, sec(2.2)), cen: centroid(mg, 32768, 20, 8000), edge: band(mg, 32768, 1500, 5000) / rms(x, sec(2.2)) });
  }
  const at = (r, t) => rows.find(q => q.r === r && q.thr === t);
  say('   rpm   rms closed / light / full    centroid Hz closed / light / full    edge share (1.5-5 kHz) at full throttle');
  for (const r of [1500, 2500, 3500, 4500, 5500, 6200]) say('  ' + String(r).padStart(4) + '   ' + [0, 0.3, 1].map(t => f4(at(r, t).rms)).join(' / ') + '        ' + [0, 0.3, 1].map(t => f1(at(r, t).cen).padStart(6)).join(' / ') + '             ' + f3(at(r, 1).edge));
  check([1500, 2500, 3500, 4500, 5500].every(r => at(r, 1).rms > at(r, 0.3).rms && at(r, 0.3).rms > at(r, 0).rms * 1.2), 'level follows the throttle', 'at 3,500 rpm ' + f1(dB(at(3500, 1).rms / at(3500, 0).rms)) + ' dB from closed to full');
  check([2500, 3500, 4500, 5500].every(r => at(r, 1).cen > at(r, 0.3).cen * 1.12), 'and so does the brightness', 'centroid at 3,500 rpm ' + f1(at(3500, 0.3).cen) + ' → ' + f1(at(3500, 1).cen) + ' Hz');
  check(at(6200, 1).edge > 1.5 * at(3500, 1).edge && at(6200, 1).rms > at(2500, 1).rms, 'harder edge and more level towards the redline', 'edge share ' + f3(at(3500, 1).edge) + ' → ' + f3(at(6200, 1).edge));
  // bark: the throttle snapped open at 3,000 rpm
  const bkr = stream(60 * 4, (f, t) => V8({ rpm: 3000, thr: t < 2 ? 0 : 1, gear: 3, speed: 25 })), xb = mono(render(coreNew, bkr, 1)), on = rms(xb, sec(2.03), sec(2.18)), stdy = rms(xb, sec(3), sec(3.8));
  const eb = band(spec(xb, sec(2.02), 8192), 8192, 1500, 5000), es = band(spec(xb, sec(3), 8192), 8192, 1500, 5000);
  say('  bark: in the 150 ms after the throttle snaps open the level is ' + f1(dB(on / stdy)) + ' dB above steady full throttle, the 1.5-5 kHz edge ' + f1(dB(eb / es)) + ' dB above');
  check(on > stdy * 1.12 && eb > es * 1.2, 'snapping the throttle open barks (a moment louder and harder than the steady pull)');
  // induction: the four Webers, loudest under the bonnet, an uneven honk at full throttle
  const ind = mkCore(srcNew, [['const lk = dg * GY, ig = ', 'const lk = dg * GY, ig = 0 * ']]), shr = cam => { const rec = steady(3.2, V8({ cam, dist: cam === 1 ? 1.5 : 5.5, rpm: 3000, thr: 1, gear: 3, speed: 25 })), x = mono(render(coreNew, rec, 1)), y = mono(render(ind, rec, 1)); for (let i = 0; i < x.length; i++) y[i] = x[i] - y[i]; return rms(y, sec(2.2)) / rms(x, sec(2.2)); };
  const sb = shr(1), sc = shr(0);
  say('  induction tone (trumpets and air box) share of the engine at full throttle, 3,000 rpm: bonnet ' + f2(sb) + ', chase ' + f2(sc));
  check(sb > 0.3 && sb > 2 * sc, 'the Webers honk loudest under the bonnet');
});

test('v8-run', () => {
  say('V8 Vantage: full-throttle run from rest through the gears, lift-off, braking with down-changes (chase camera)');
  const thr = t => t < 1.5 ? 0 : t < 17 ? 1 : t < 20 ? 0 : t < 23 ? -0.9 : 0.3, d = drive('v8', 26, thr), o = render(coreNew, d.rec, 1), m = mono(o), N = 8192;
  let n = 0, okc = 0, worst = 0;
  for (let t = 3; t < 16.5; t += 0.25) {
    const f = Math.round(t * 60); if (d.log.gear[f - 12] !== d.log.gear[f + 12] || Math.abs(d.log.rpm[f + 5] - d.log.rpm[f - 5]) > 250) continue;
    const p = peak(spec(m, sec(t) - N / 2, N), N, 30, 2500), ff = 4 * d.log.rpm[f] / 60, e = Math.abs(p.f / ff - 1); n++; if (e < 0.04) okc++; if (e > worst) worst = e;
  }
  check(okc === n && n > 25, 'the spectral peak follows 4 × rpm / 60 through the run', okc + ' of ' + n + ' windows within 4 %, worst ' + f1(worst * 100) + ' %');
  const up = [], dn = []; for (let f = 1; f < d.n; f++) { if (d.log.gear[f] > d.log.gear[f - 1]) up.push(f); else if (d.log.gear[f] < d.log.gear[f - 1]) dn.push(f); }
  const dips = up.map(f => { const t = f / 60, before = rms(m, sec(t - 0.25), sec(t - 0.05)); let mn = 1; for (let k = 0; k < 15; k++) mn = Math.min(mn, rms(m, sec(t + k * 0.02), sec(t + k * 0.02 + 0.04))); return dB(mn / before); });
  const blips = dn.map(f => { const t = f / 60; return dB(rms(m, sec(t + 0.05), sec(t + 0.28)) / rms(m, sec(t - 0.35), sec(t - 0.05))); });
  say('  up-changes at ' + up.map(f => f1(f / 60) + ' s').join(', ') + ': the level dips ' + dips.map(f1).join(', ') + ' dB; down-changes under braking at ' + dn.map(f => f1(f / 60) + ' s').join(', ') + ': the blip lifts the level ' + blips.map(f1).join(', ') + ' dB');
  check(up.length >= 3 && dips.every(x => x < -6), 'every up-change is heard as a torque interruption (dip of more than 6 dB)');
  check(dn.length >= 1 && blips.every(x => x > 2), 'every down-change under braking has its throttle blip');
  let quiet = 0, mn = 1; for (let t = 0; t < 25.9; t += 0.05) { const r = rms(m, sec(t), sec(t + 0.05)); if (r < 0.0015) quiet++; if (r < mn) mn = r; }
  check(quiet === 0, 'never silent (50 ms windows)', 'quietest window rms ' + f4(mn));
  const b = bad(o); check(b.nan === 0 && b.pk < 0.39, 'no NaN, no clipping', 'peak ' + f3(b.pk));
  wav('v8_run_chase.wav', render(coreNew, d.rec, 127));
  wav('v8_run_bonnet.wav', render(coreNew, drive('v8', 26, thr, () => ({ cam: 1, dist: 1.5 })).rec, 127));
  wav('v8_run_cockpit.wav', render(coreNew, drive('v8', 26, thr, () => ({ cam: 3, dist: 0.6 })).rec, 127));
  const lap = t => { const u = t % 14; return t < 1.2 ? 0 : u < 7.5 ? 1 : u < 8.3 ? 0 : u < 10.3 ? -0.8 : u < 11 ? 0.3 : 1; };
  wav('v8_lap_like_chase.wav', render(coreNew, drive('v8', 40, lap, (t) => ({ slipL: (t % 14) > 10.3 && (t % 14) < 11.6 ? 0.45 : 0, slipR: (t % 14) > 10.5 && (t % 14) < 11.4 ? 0.3 : 0 })).rec, 127));
  // the same lap for the three cars, one after the other: an A/B/C comparison
  { const parts = ['uno', 'db5', 'v8'].map(c => render(coreNew, drive(c, 14, lap).rec, 127)), n = parts.reduce((a, p) => a + p.n, 0), all = { L: new Float32Array(n), R: new Float32Array(n), n }; let o2 = 0; for (const p of parts) { all.L.set(p.L, o2); all.R.set(p.R, o2); o2 += p.n; } wav('compare_uno_db5_v8_lap.wav', all); }
});

test('v8-overrun', () => {
  say('V8 Vantage: overrun burble and crackle (engine layer)');
  const core = mkCore(srcNew, COUNTERS_V8), G = globalThis;
  const pops = (pre, r0) => { const rec = stream(60 * 10, (f, t) => V8({ rpm: t < 4 ? r0 : Math.max(1500, r0 - (t - 4) * 450), thr: t < 4 ? pre : 0, gear: 3, speed: 30 })), S = core(SR), L = new Float32Array(800), R = new Float32Array(800), per = new Array(10).fill(0);
    G.__v8pops = 0; for (let f = 0; f < rec.length / 16; f++) { for (let q = 0; q < 16; q++) S.ctl[q] = rec[f * 16 + q]; const n0 = G.__v8pops; S.render(L, R, 0, 800); per[Math.floor(f / 60)] += G.__v8pops - n0; } return per; };
  const a = pops(1, 5000), b = pops(0.25, 5000), c = pops(1, 3200);
  say('  pops per second, 4 s at 5,000 rpm flat out then lifting (revs falling 450 rpm/s): ' + a.join(' ') + '; after a gentle cruise: ' + b.join(' ') + '; flat out at 3,200 rpm, then lifting: ' + c.join(' '));
  check(a[4] >= 8 && a[4] <= 40 && a[4] > a[5] && a[5] > a[7] && a.slice(0, 4).reduce((p, q) => p + q) <= 4, 'a crackle of pops right after the lift from a flat-out pull, thinning out over two seconds', a[4] + ', ' + a[5] + ', ' + a[6] + ' pops in the first three seconds');
  check(b.slice(4).reduce((p, q) => p + q) < a.slice(4).reduce((p, q) => p + q) / 2 && c[4] < a[4] / 2, 'far fewer after a gentle cruise or from low revs (no fuel on the manifold walls)');
  const rec = stream(60 * 10, (f, t) => V8({ rpm: t < 4 ? 5000 : Math.max(1500, 5000 - (t - 4) * 450), thr: t < 4 ? 1 : 0, gear: 3, speed: 30 })), m = mono(render(coreNew, rec, 1));
  const hp = m.map((v, i) => i ? v - m[i - 1] : 0), ons = onsets(m, sec(4.1), sec(6), 0.4, 0.02, 2);
  say('  sharp onsets in the first two seconds of the overrun: ' + ons.length + '; loudest crack ' + f3(pk(hp, sec(4), sec(6))) + ' (differenced signal) against ' + f3(pk(hp, sec(2), sec(4))) + ' under full throttle');
  check(ons.length >= 8 && pk(hp, sec(4), sec(6)) > pk(hp, sec(2), sec(4)), 'the pops are crisp: sharper than anything under full throttle');
  const sp = (x, t0, t1, r) => { const T = 2 * SR / (r / 15), q = []; for (let s0 = sec(t0); s0 + T < sec(t1); s0 += T) q.push(pk(x, Math.round(s0), Math.round(s0 + T))); return spread(q); };
  const st = mono(render(coreNew, steady(5, V8({ rpm: 4000, thr: 0.4, gear: 3, speed: 30 })), 1)), ov = mono(render(mkCore(srcNew, [['if (r3 >= kT) {', 'if (false) {']]), steady(5, V8({ rpm: 4000, thr: 0, gear: 3, speed: 30 })), 1));
  check(sp(ov, 2, 5, 4000) > 1.5 * sp(st, 2, 5, 4000), 'burble: the firings are far more uneven on the overrun than under power (crackle switched off for this)', f1(sp(ov, 2, 5, 4000) * 100) + ' % against ' + f1(sp(st, 2, 5, 4000) * 100) + ' %');
  wav('v8_overrun_crackle.wav', render(coreNew, stream(60 * 12, (f, t) => V8({ rpm: t < 1 ? 780 + t * 2000 : t < 5 ? Math.min(5600, 2800 + (t - 1) * 900) : Math.max(900, 5600 - (t - 5) * 600), thr: t > 0.7 && t < 5 ? 1 : 0, gear: t < 5 ? 2 : 3, speed: 20 + t })), 127));
});

test('v8-cameras', () => {
  say('V8 Vantage from the four cameras: 3,500 rpm, full throttle, 3rd gear, 40 m/s');
  const N = 32768, rows = {}, fw = 3500 / 60 * 13.1;
  const without = { induction: mkCore(srcNew, [['const lk = dg * GY, ig = ', 'const lk = dg * GY, ig = 0 * '], ['F[332] = ia * 0.7; F[335] = ia * 0.35;', 'F[332] = 0; F[335] = 0;']]), whine: mkCore(srcNew, [['YWA[g5] * dg * 0.02', 'YWA[g5] * dg * 0']]) };
  for (const [name, cam, dist] of [['chase', 0, 5.5], ['bonnet', 1, 1.5], ['tv', 2, 30], ['cockpit', 3, 0.6]]) {
    const rec = steady(3.2, V8({ cam, dist, rpm: 3500, thr: 1, gear: 3, speed: 40, lsp: cam === 2 ? 0 : 40 })), e = render(coreNew, rec, 1), wd = render(coreNew, rec, 4), m = mono(e), mg = spec(m, sec(2.2), N), mw = spec(mono(wd), sec(2.2), N), r = rms(m, sec(2.2)), sh = {};
    for (const k in without) { const q = mono(render(without[k], rec, 1)); for (let i = 0; i < q.length; i++) q[i] = m[i] - q[i]; sh[k] = rms(q, sec(2.2)) / r; }
    rows[name] = { rms: r, lo: band(mg, N, 30, 200), mid: band(mg, N, 200, 1200), hi: band(mg, N, 2000, 7000), cen: centroid(mg, N, 20, 10000), wh: line(mg, N, fw, 0.02), sh, wind: rms(mono(wd), sec(2.2)), whiss: band(mw, N, 3000, 7000), wroar: band(mw, N, 100, 2000), side: rms(e.L.map((v, i) => v - e.R[i]), sec(2.2)) / (r * 2) };
  }
  say('  camera   engine rms  30-200 Hz  0.2-1.2 kHz  2-7 kHz  centroid Hz | shares: induction  whine | wind rms  wind 3-7 / 0.1-2 kHz  (L-R) / (L+R)');
  for (const k in rows) { const r = rows[k]; say('  ' + k.padEnd(8) + '  ' + f4(r.rms) + '     ' + f4(r.lo) + '     ' + f4(r.mid) + '    ' + f4(r.hi) + '    ' + f1(r.cen).padStart(7) + '   |          ' + f2(r.sh.induction) + '     ' + f3(r.sh.whine) + '  |  ' + f4(r.wind) + '         ' + f3(r.whiss / (r.wroar + 1e-12)) + '            ' + f3(r.side)); }
  const c = rows.cockpit, h = rows.chase, b = rows.bonnet, tv = rows.tv;
  check(b.sh.induction > 2 * h.sh.induction, 'bonnet: the induction forward', f2(b.sh.induction) + ' against ' + f2(h.sh.induction));
  check(c.hi / c.rms < 0.5 * h.hi / h.rms && c.lo / c.mid > 1.3 * h.lo / h.mid && c.cen < h.cen, 'cockpit: lower-passed and boomier, the darkest', 'centroid ' + f1(c.cen) + ' against ' + f1(h.cen) + ' Hz behind');
  check(c.sh.whine > 1.5 * h.sh.whine && c.whiss / c.wroar > 1.3 * h.whiss / h.wroar, 'cockpit: more gearbox whine, wind hiss around the frame');
  check(tv.rms < h.rms && tv.side < 0.01 && h.side > 0.04, 'TV: further away and mono; chase: the two pipes heard apart', '(L-R) / (L+R) ' + f3(h.side) + ' chase, ' + f3(tv.side) + ' TV');
  const lv = [h.rms, b.rms, c.rms]; check(Math.max(...lv) < 1.4 * Math.min(...lv), 'about as loud from the three cameras on the car', lv.map(f4).join(' / '));
  // a drive-by for listening: approaches from 160 m at 50 m/s, passes 9 m from the camera, lifts as it goes by
  const pass = stream(60 * 9, (f, t) => { const x = -160 + 50 * t, d = Math.hypot(x, 9), vr = -50 * x / d; return V8({ cam: 2, dist: d, dop: 343 / (343 - vr), lsp: 0, rpm: t < 3.6 ? 5200 + 80 * t : Math.max(3800, 5500 - (t - 3.6) * 400), thr: t < 3.6 ? 1 : 0, gear: 4, speed: 50 }); });
  const o = render(coreNew, pass, 127), bb = bad(o); check(bb.nan === 0 && bb.pk < 0.39, 'drive-by: no NaN, no clipping', 'peak ' + f3(bb.pk));
  wav('v8_driveby_tv.wav', o);
});

test('v8-tyres-loudness', () => {
  say('V8 Vantage: tyres (255/60 VR15) and loudness against the Uno and the DB5');
  const N = 16384, sq = (car, slip) => { const x = mono(render(coreNew, steady(2.5, { db5: car === 'db5', v8: car === 'v8', rpm: 3000, thr: 0.3, gear: 3, speed: 30, slipL: slip, slipR: slip }), 2)); return { rms: rms(x, sec(1)), f: peak(spec(x, sec(1), N), N, 200, 1600).f }; };
  const rows = []; for (const s of [0.1, 0.4, 0.7]) rows.push({ s, v: sq('v8', s), u: sq('uno', s), d: sq('db5', s) });
  for (const r of rows) say('  slip ' + f1(r.s) + ': squeal rms / pitch — V8 ' + f4(r.v.rms) + ' / ' + f1(r.v.f) + ' Hz, Uno ' + f4(r.u.rms) + ' / ' + f1(r.u.f) + ' Hz, DB5 ' + f4(r.d.rms) + ' / ' + f1(r.d.f) + ' Hz');
  check(rows.every(r => r.v.f < r.u.f && r.v.f > r.d.f), 'the radials squeal lower than the Uno\'s, higher than the DB5\'s cross-plies');
  const road = car => rms(mono(render(coreNew, steady(4, { db5: car === 'db5', v8: car === 'v8', rpm: 3000, thr: 0.3, gear: 4, speed: 40 }), 8)), sec(1));
  check(road('v8') > road('uno') * 1.15, 'wide tyres: more road roar than the others', '+' + f1(dB(road('v8') / road('uno'))) + ' dB at 40 m/s');
  // loudness over the same road speeds (the Uno's run)
  const thr = t => t < 1.5 ? 0 : t < 20 ? 1 : t < 23 ? 0 : t < 25 ? -1 : 0.5, du = drive('uno', 30, thr), res = {};
  for (const car of ['uno', 'db5', 'v8']) { const d = car === 'uno' ? du : drive(car, 30, thr, null, du.log), o = render(coreNew, d.rec, 127), e = mono(render(coreNew, d.rec, 1)); res[car] = { rms: rms(mono(o), sec(1.5)), pk: bad(o).pk, full: rms(e, sec(8), sec(20)) }; }
  say('  mix rms over the run: Uno ' + f4(res.uno.rms) + ', DB5 ' + f4(res.db5.rms) + ', V8 ' + f4(res.v8.rms) + ' (' + f2(dB(res.v8.rms / res.uno.rms)) + ' dB re the Uno); engine at full throttle ' + f4(res.uno.full) + ' / ' + f4(res.db5.full) + ' / ' + f4(res.v8.full) + '; peaks ' + f3(res.uno.pk) + ' / ' + f3(res.db5.pk) + ' / ' + f3(res.v8.pk));
  check(res.v8.rms < res.uno.rms * 1.122 && res.v8.full < res.uno.full * 1.122, 'the V8 is no more than 1 dB louder than the Uno, over the run and flat out', f2(dB(res.v8.rms / res.uno.rms)) + ' / ' + f2(dB(res.v8.full / res.uno.full)) + ' dB');
  check(res.v8.pk < 0.39, 'peaks under the limiter ceiling', f3(res.v8.pk));
});

// ---- V8 gadgets: the gadget layer alone (bit 64), car idling at rest
const v8g = (secs, fn, o) => stream(Math.round(secs * 60), (f, t) => Object.assign(V8({}), o, fn(t, f)));
test('v8-gadgets', () => {
  say('V8 Vantage gadgets (gadget layer alone unless said otherwise)');
  // lasers
  { const o = render(coreNew, v8g(4, t => ({ gad: t >= 1 && t < 2.5 ? 1 : 0 })), GAD_ONLY), m = mono(o), N = 16384, mg = spec(m, sec(1.5), N), pl = { f: centroid(spec(o.L, sec(1.5), N), N, 1900, 2600) }, pr = { f: centroid(spec(o.R, sec(1.5), N), N, 1900, 2600) }, z = { f: centroid(spec(m, sec(1.002), 1024), 1024, 1900, 4600) };
    say('  lasers: whine (centre of its FM sidebands) ' + f1(pl.f) + ' Hz left, ' + f1(pr.f) + ' Hz right; zap: ' + f1(z.f) + ' Hz in the first 20 ms; 100 Hz buzz line ' + f4(line(mg, N, 100, 0.02)) + ' and its band (1-3 kHz) ' + f4(band(mg, N, 1000, 3000)) + '; rms ' + f4(rms(m, sec(1.2), sec(2.5))) + '; silent from ' + f2(lastSound(o)) + ' s');
    check(quietIn(o, 0, 0.999) && rms(m, sec(1.2), sec(2.5)) > 0.004, 'lasers: nothing before the flag, a continuous sound while it is set');
    check(Math.abs(pl.f - 2200) < 120 && Math.abs(pr.f / pl.f - 1.027) < 0.012 && z.f > pl.f * 1.15, 'lasers: two wavering whines near 2.2 kHz, one in each wheel, that zap in from above');
    check(lastSound(o) > 2.5 && lastSound(o) < 2.8, 'lasers: cut out within a tenth of a second or so', f2(lastSound(o)) + ' s'); wav('v8_gadget_lasers.wav', render(coreNew, v8g(4, t => ({ gad: (t >= 1 && t < 2.5) || (t >= 2.9 && t < 3.1) ? 1 : 0 })), 127)); }
  // rocket
  { const o = render(coreNew, v8g(6, t => ({ gad: t >= 1 && t < 4 ? 2 : 0 })), GAD_ONLY), m = mono(o), N = 32768, mg = spec(m, sec(2), N), lo = band(mg, N, 30, 600), hi = band(mg, N, 2000, 8000), ons = onsets(m, sec(2), sec(3.9), 0.25, 0.004, 0.5);
    say('  rocket: rms at +0.05 / 0.1 / 0.2 / 1 s ' + [0.05, 0.1, 0.2, 1].map(d => f4(rms(m, sec(1 + d), sec(1.05 + d)))).join(' ') + '; after the flag clears +0.1 / 0.3 s ' + f4(rms(m, sec(4.1), sec(4.15))) + ' / ' + f4(rms(m, sec(4.3), sec(4.35))) + '; below 600 Hz ' + f4(lo) + ', above 2 kHz ' + f4(hi) + '; crackle onsets ' + f1(ons.length / 1.9) + ' a second; peak ' + f3(pk(m)) + '; silent from ' + f2(lastSound(o)) + ' s');
    check(quietIn(o, 0, 0.999) && rms(m, sec(2), sec(4)) > 0.02, 'rocket: nothing before the flag, a big roar while it burns');
    check(lo > 2 * hi && ons.length / 1.9 > 30, 'rocket: a deep roar with crackle');
    check(rms(m, sec(1.02), sec(1.06)) > 0.2 * rms(m, sec(2), sec(3)) && rms(m, sec(1.02), sec(1.06)) < 1.5 * rms(m, sec(2), sec(3)) && lastSound(o) > 4.2 && lastSound(o) < 5.5, 'rocket: lights at once with a thump and dies away in a fraction of a second', f2(lastSound(o)) + ' s'); wav('v8_gadget_rocket.wav', render(coreNew, v8g(6, t => ({ gad: t >= 1 && t < 4 ? 2 : 0 })), 127)); }
  // servo and clunks
  { const o = render(coreNew, v8g(4, t => ({ gad: t >= 1 && t < 2 ? 8 : 0, es: t >= 2 ? 1 : 0 })), GAD_ONLY), m = mono(o);
    check(quietIn(o, 0, 0.999) && rms(m, sec(1.3), sec(1.95)) > 0.005 && pk(m, sec(2), sec(2.06)) > 2.5 * pk(m, sec(1.3), sec(1.95)), 'servo whirrs while a mechanism moves, and the end stop clunks', 'motor rms ' + f4(rms(m, sec(1.3), sec(1.95))) + ', clunk peak ' + f3(pk(m, sec(2), sec(2.06))));
    wav('v8_gadget_servo_clunk.wav', render(coreNew, v8g(6, t => ({ gad: (t >= 1 && t < 2) || (t >= 3 && t < 4.2) ? 8 : 0, es: t >= 4.2 ? 2 : t >= 2 ? 1 : 0 })), 127)); }
  // horn
  { const o = render(coreNew, v8g(3, t => ({ gad: t >= 1 && t < 2 ? 16 : 0 })), GAD_ONLY), m = mono(o), N = 32768, mg = spec(m, sec(1.3), N), a = peak(mg, N, 300, 370), b = peak(mg, N, 380, 460), h = []; for (let k = 2; k <= 8; k++) h.push(dB(line(mg, N, 335 * k, 0.012) / a.a));
    say('  horn: notes ' + f1(a.f) + ' and ' + f1(b.f) + ' Hz, interval ' + f3(b.f / a.f) + '; harmonics 2-8 of the low note ' + h.map(f1).join(' ') + ' dB; silent from ' + f2(lastSound(o)) + ' s');
    check(Math.abs(a.f - 335) < 5 && Math.abs(b.f - 420) < 6 && b.f / a.f > 1.23 && b.f / a.f < 1.27, 'horn: two notes a major third apart, 335 and 420 Hz (the DB5\'s are 408 and 511)');
    check(h.filter(x => x > -20).length >= 5 && lastSound(o) > 2 && lastSound(o) < 2.3, 'horn: brassy, quick on and off'); wav('v8_gadget_horn.wav', render(coreNew, v8g(4, t => ({ gad: (t >= 1 && t < 2) || (t >= 2.4 && t < 2.6) || (t >= 2.8 && t < 3.0) ? 16 : 0 })), 127)); }
  // missile
  { const o = render(coreNew, v8g(6, t => ({ ej: t >= 1 ? 1 : 0 })), GAD_ONLY), m = mono(o), N = 4096, c = t => centroid(spec(m, sec(t), N), N, 100, 8000), e = t => rms(m, sec(t), sec(t + 0.05));
    const mot = t => peak(spec(m, sec(t), N), N, 300, 2000).f;
    const cw = t => centroid(spec(m, sec(t), 2048), 2048, 100, 8000);
    say('  missile: centroid of the whoosh at +0.01 / 0.06 / 0.12 s ' + [1.01, 1.06, 1.12].map(t => f1(cw(t))).join(' / ') + ' Hz; motor band at +0.3 / 0.6 / 1.2 s ' + [1.3, 1.6, 2.2].map(t => f1(mot(t))).join(' / ') + ' Hz; rms at +0.3 / 1 / 2 / 2.6 s ' + [1.3, 2, 3, 3.6].map(t => f4(e(t))).join(' ') + '; silent from ' + f2(lastSound(o)) + ' s');
    check(quietIn(o, 0, 0.999) && cw(1.12) > cw(1.01) * 1.4 && cw(1.06) > cw(1.01), 'missile: the ignition whoosh rises');
    check(mot(1.3) > mot(2.2) * 1.15 && e(1.3) > 3 * e(3) && e(3) > e(3.6), 'missile: then the motor goes away — its note falls (Doppler), its level fades');
    check(lastSound(o) > 3.7 && lastSound(o) < 4.2, 'missile: then silence', f2(lastSound(o)) + ' s');
    const cnt = fn => { const q = render(coreNew, v8g(10, fn), GAD_ONLY); return onsets(mono(q), 0, q.n, 0.5, 0.25, 8).length; };
    const c1 = cnt(t => ({ ej: t < 1 ? 0 : t < 5 ? 1 : 2 })), c2 = cnt(t => ({ ej: 7 })), c3 = cnt(t => ({ ej: t < 1 ? 2 : 20 })), c4 = cnt(t => ({ ej: t < 1 ? 0 : 1, mute: t > 0.5 && t < 2 ? 1 : 0 }));
    check(c1 === 2 && c2 === 0 && c3 === 0 && c4 === 0, 'missile counter: one launch per step; latched at the start, a jump or a count during mute fires nothing', c1 + ' / ' + c2 + ' / ' + c3 + ' / ' + c4);
    wav('v8_gadget_missile.wav', render(coreNew, v8g(6, t => ({ ej: t >= 1 ? 1 : 0 })), 127)); }
  // explosion
  { const o = render(coreNew, v8g(6, t => ({ ex: t >= 1 ? 1 : 0 })), GAD_ONLY), m = mono(o), N = 16384, mg = spec(m, sec(1), N), lo = band(mg, N, 25, 120), hi = band(mg, N, 400, 6000), dbr = onsets(m, sec(1.45), sec(3.1), 0.15, 0.02, 1.5);
    say('  explosion: below 120 Hz ' + f4(lo) + ', 0.4-6 kHz ' + f4(hi) + ' over the first 0.34 s; rms at +0.05 / 0.3 / 0.8 / 1.5 / 2.5 s ' + [1.05, 1.3, 1.8, 2.5, 3.5].map(t => f4(rms(m, sec(t), sec(t + 0.1)))).join(' ') + '; debris impacts heard after the echo ' + dbr.length + ' (' + dbr.filter(t => t < 2).length + ' in 0.45-1 s, ' + dbr.filter(t => t >= 2.2).length + ' after 1.2 s); peak ' + f3(pk(m)) + '; silent from ' + f2(lastSound(o)) + ' s');
    check(quietIn(o, 0, 0.999) && lo > 2 * hi && pk(m) > 0.1, 'explosion: a deep boom');
    check(dbr.length >= 5 && dbr.filter(t => t < 2).length > dbr.filter(t => t >= 2.2).length, 'explosion: debris raining down, thinning out', dbr.length + ' impacts after the echo');
    check(lastSound(o) > 3.5 && lastSound(o) < 4.4, 'explosion: then silence', f2(lastSound(o)) + ' s');
    const cnt = fn => { const q = render(coreNew, v8g(12, fn), GAD_ONLY); return onsets(mono(q), 0, q.n, 0.5, 0.4, 20).length; };
    const c1 = cnt(t => ({ ex: t < 1 ? 0 : t < 5 ? 1 : t < 9 ? 2 : 3 })), c2 = cnt(t => ({ ex: 5 })), c3 = cnt(t => ({ ex: t < 1 ? 1 : 9 })), c4 = cnt(t => ({ ex: t < 1 ? 31 : 0 })), c5 = cnt(t => ({ ex: t < 1 ? 0 : 1, run: t > 0.5 && t < 2 ? 0 : 1 }));
    check(c1 === 3 && c2 === 0 && c3 === 0 && c4 === 1 && c5 === 0, 'explosion counter (bits 16-20 of control 15): one per step, across the wrap too; latched at the start, a jump or a count during a pause fires nothing', [c1, c2, c3, c4, c5].join(' / '));
    wav('v8_gadget_explosion.wav', render(coreNew, v8g(6, t => ({ ex: t >= 1 ? 1 : 0 })), 127)); }
  // everything, on a drive, from the four cameras
  const gfn = (t) => ({ gad: (t > 4 && t < 6 ? 1 : 0) | (t > 7 && t < 9.5 ? 2 : 0) | (t > 11 && t < 12.2 ? 8 : 0) | (t > 13.5 && t < 14.5 ? 16 : 0), es: t > 12.2 ? 1 : 0, ej: t > 15.5 ? 1 : 0, ex: t > 17.5 ? 1 : 0 });
  for (const [name, cam, dist] of [['chase', 0, 5.5], ['bonnet', 1, 1.5], ['tv', 2, 40], ['cockpit', 3, 0.6]]) {
    const d = drive('v8', 22, t => t < 1.5 ? 0 : t < 16 ? 1 : 0.2, (t, f, s) => Object.assign({ cam, dist, lsp: cam === 2 ? 0 : s.speed }, gfn(t)));
    const o = render(coreNew, d.rec, 127), b = bad(o); check(b.nan === 0 && b.pk < 0.39, name + ': every gadget on a drive, no NaN, no clipping', 'peak ' + f3(b.pk) + ', rms ' + f4(rms(mono(o))));
    if (name === 'chase') wav('v8_drive_all_gadgets_chase.wav', o); if (name === 'cockpit') wav('v8_drive_all_gadgets_cockpit.wav', o);
  }
  for (const [seed, sr, blk] of [[31, SR, 800], [32, 44100, 37], [33, 96000, 128]]) { const o = render(coreNew, wander(60 * 60, seed, 2, 1), 127, { sr, block: blk }), b = bad(o); check(b.nan === 0 && b.pk < 0.39, 'V8, wandering controls and gadgets, seed ' + seed + ', ' + sr + ' Hz in blocks of ' + blk + ' (60 s): no NaN, no clipping', 'peak ' + f3(b.pk)); }
  { const mk = g => stream(60 * 12, (f, t) => V8({ rpm: 2500 + 2000 * Math.sin(t), thr: t % 3 < 2 ? 1 : 0, gear: 3, speed: 30, crowd: 0.6, gad: g ? (f >> 5) & 31 : 0, ej: g ? Math.floor(t / 4) : 0, es: g ? Math.floor(t) : 0, ex: g ? Math.floor(t / 5) : 0 }));
    const a = render(coreNew, mk(0), 63), b = render(coreNew, mk(1), 63); check(sameBits(a.L, b.L) + sameBits(a.R, b.R) === 0, 'the other layers are the same samples with and without the V8\'s gadgets working'); }
  wav('v8_gadgets_layer_only.wav', render(coreNew, v8g(22, t => gfn(t + 3)), 64));
  // mute and pause with the V8
  { const o = render(coreNew, stream(60 * 4, (f, t) => V8({ rpm: 4200, thr: 1, gear: 3, speed: 35, gad: 3, mute: t >= 1 && t < 2 ? 1 : 0, run: t >= 3 ? 0 : 1 })), 127);
    let z1 = sec(1); while (o.L[z1] !== 0 || o.R[z1] !== 0) z1++; let z2 = sec(3); while (o.L[z2] !== 0 || o.R[z2] !== 0) z2++;
    check(zeroIn(o, z1 / SR, 2) && zeroIn(o, z2 / SR, 4) && z1 - sec(1) < sec(0.06) && z2 - sec(3) < sec(0.06) && rms(o.L, sec(2.1), sec(2.9)) > 0.02, 'V8: mute and pause give exact zeros within 50 ms, and the sound comes back'); }
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
  const U0 = mk(srcRef, 'uno'), U1 = mk(srcNew, 'uno'), D1 = mk(srcNew, 'db5'), D0 = mk(srcDb5, 'db5'), V1 = mk(srcNew, 'v8');
  let q = 12345; const r = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296), set = (s, k) => {
    const V = s.VEH, G = s.GS; V.rpm = 900 + k.a * 5800; V.gear = Math.floor(k.b * 6); V.ctl[0] = k.c; V.vx = k.d * 50; V.vy = k.e * 4 - 2; V.yaw = k.f * 6; V.hits = Math.floor(k.g * 3000); G.speed = Math.hypot(V.vx, V.vy); G.cam = k.cam; G.cx = k.a * 100; G.cz = k.b * 60;
    for (let i = 0; i < 4; i++) { V.wzone[i] = Math.floor(k.z[i] * 6); V.slip[i] = k.s[i]; } s.R.cam.pos.set([k.c * 80, 2 + k.d * 6, k.e * 70]); s.X.SND.run = k.run; s.X.SND.mute = k.mute; };
  let dif = 0, dif5 = 0, n = 0, bit16 = 0, bit32 = 0, c15 = 0;
  for (let i = 0; i < 4000; i++) {
    const k = { a: r(), b: r(), c: r(), d: r(), e: r(), f: r(), g: r(), cam: Math.floor(r() * 3), z: [r(), r(), r(), r()], s: [r(), r(), r(), r()], run: r() < 0.9, mute: r() < 0.1 };
    set(U0, k); set(U1, k); set(D1, k); set(D0, k); set(V1, k); U1.GAD.snd[0] = 31; U1.GAD.snd[1] = i; U1.GAD.snd[2] = i * 2; U1.GAD.snd[3] = i;   // the Uno must ignore GAD.snd
    for (const S of [D0, D1, V1]) { S.GAD.snd[0] = (i * 7) & 31; S.GAD.snd[1] = i >> 3; S.GAD.snd[2] = i >> 2; S.GAD.snd[3] = i >> 4; }
    U0.X.sndControl(); U1.X.sndControl(); D1.X.sndControl(); D0.X.sndControl(); V1.X.sndControl(); n++;
    for (let j = 0; j < 16; j++) { if (U0.X.SND.sc[j] !== U1.X.SND.sc[j]) dif++; if (j && j < 15 && (D1.X.SND.sc[j] !== U1.X.SND.sc[j] || V1.X.SND.sc[j] !== U1.X.SND.sc[j])) dif++; if (D0.X.SND.sc[j] !== D1.X.SND.sc[j]) dif5++; }
    if ((D1.X.SND.sc[0] & ~16) !== U1.X.SND.sc[0] || !(D1.X.SND.sc[0] & 16)) bit16++; if ((V1.X.SND.sc[0] & ~32) !== U1.X.SND.sc[0] || !(V1.X.SND.sc[0] & 32)) bit32++; if (U1.X.SND.sc[15] !== 0) c15++;
  }
  check(dif === 0 && c15 === 0, 'Uno: sndControl gives the 16 controls of the reference over ' + n + ' random game states (GAD.snd ignored); DB5 and V8: controls 1-14 are the same', dif + ' differences');
  check(dif5 === 0, 'DB5: sndControl gives the 16 controls of the DB5 reference, gadget counters included', dif5 + ' differences');
  check(bit16 === 0 && bit32 === 0, 'control 0 is the Uno\'s plus bit 16 for the DB5, plus bit 32 for the V8');
  // cockpit camera and gadget word
  const G = D1.GAD.snd, S = D1.X.SND, w = () => { D1.X.sndControl(); return S.sc[15]; }; D1.GS.cam = 3; D1.X.sndControl();
  check(((S.sc[0] >> 2) & 3) === 3 && (S.sc[0] & 16) === 16 && S.sc[11] === S.sc[4] && S.sc[10] === 10000, 'DB5: the cockpit camera travels as camera 3, with the car\'s own wind and no Doppler', 'control 0 = ' + S.sc[0]);
  G.fill(0); S.gad.fill(0); const seq = [];
  G[0] = 1 | 4 | 16; seq.push(w()); G[1] = 1; seq.push(w()); G[1] = 2; G[2] = 3; seq.push(w()); G[0] = 0; G[1] = 0; G[2] = 0; seq.push(w()); G[1] = 1; seq.push(w()); G[2] = 100; seq.push(w()); seq.push(w());
  const dec = v => (v & 31) + '/' + ((v >> 5) & 31) + '/' + ((v >> 10) & 63);
  check(seq.map(dec).join(' ') === '21/0/0 21/1/0 21/2/3 0/2/3 0/3/3 0/3/10 0/3/10', 'DB5: control 15 = flags / seat count / end-stop count; zeroing GAD.snd adds nothing, a jump is capped', seq.map(dec).join(' '));
  { const G8 = V1.GAD.snd, S8 = V1.X.SND, w8 = () => { V1.X.sndControl(); return S8.sc[15]; }; G8.fill(0); S8.gad.fill(0); const sq = [];
    G8[0] = 1 | 2 | 16; sq.push(w8()); G8[1] = 1; G8[3] = 1; sq.push(w8()); G8[3] = 2; G8[2] = 5; sq.push(w8()); G8.fill(0); sq.push(w8()); G8[3] = 1; sq.push(w8()); G8[3] = 40; sq.push(w8()); sq.push(w8());
    const d8 = v => (v & 31) + '/' + ((v >> 5) & 31) + '/' + ((v >> 10) & 63) + '/' + ((v >> 16) & 31);
    check(sq.map(d8).join(' ') === '19/0/0/0 19/1/0/1 19/1/5/2 0/1/5/2 0/1/5/3 0/1/5/6 0/1/5/6', 'V8: control 15 = flags / missiles / end stops / explosions (bits 16-20); zeroing GAD.snd adds nothing, a jump is capped', sq.map(d8).join(' '));
    V1.GS.cam = 3; V1.X.sndControl(); check(((S8.sc[0] >> 2) & 3) === 3 && (S8.sc[0] & 48) === 32, 'V8: the cockpit camera travels as camera 3, the car as bit 32', 'control 0 = ' + S8.sc[0]); }
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
  { const p5 = off(D0, lap, 63, 300, 420).pcm.slice(), p6 = off(D1, lap, 63, 300, 420).pcm.slice(); let d6 = 0; for (let i = 0; i < p5.length; i++) if (p5[i] !== p6[i]) d6++; check(d6 === 0, 'DB5: sndOffline gives the DB5 reference PCM', p5.length + ' values'); }
  { const vg = v8g(4, t => ({ gad: t > 1 && t < 2 ? 2 : 0 })), v63 = off(V1, vg, 63, -1, -1).pcm.slice(), v31 = off(V1, vg, 31, -1, -1).pcm.slice(); check(pkI(v63) > pkI(v31) + 2000, 'V8: sndOffline plays the gadgets with mask 63 and leaves them out with 31', pkI(v63) + ' / ' + pkI(v31)); }
  // the worklet module
  const mods = {}; for (const [k, s] of [['ref', U0], ['uno', U1], ['db5', D1], ['db5ref', D0], ['v8', V1]]) { s.X.sndStart(); mods[k] = decodeURIComponent(s.mods[0].slice(s.mods[0].indexOf(',') + 1)); }
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
  const Wd0 = worklet(mods.db5ref), c0 = run(Wd0.inst, dr, 3750); check(sameBits(c.L, c0.L) + sameBits(c.R, c0.R) === 0, 'DB5: the worklet processor gives the output of the DB5 reference processor, bit for bit', c.n * 2 + ' samples');
  check(mods.v8.includes('wu(this.s=mk(sampleRate),2)'), 'the V8 worklet module warms up the V8');
  const t3 = Date.now(), Wv = worklet(mods.v8); say('  constructing the V8 processor (warm-up included): ' + (Date.now() - t3) + ' ms');
  const vr = wander(60 * 10, 7, 2, 1), cv = run(Wv.inst, vr, 3750), S3 = coreNew(SR), L3 = new Float32Array(3750 * 128), R3 = new Float32Array(3750 * 128);
  for (let bl = 0; bl < 3750; bl++) { const f = Math.min(vr.length / 16 - 1, Math.floor(bl * 128 / FR)); for (let k = 0; k < 16; k++) S3.ctl[k] = vr[f * 16 + k]; S3.render(L3, R3, bl * 128, 128); }
  check(sameBits(cv.L, L3) + sameBits(cv.R, R3) === 0, 'V8: the worklet processor gives what the offline synthesiser gives for the same controls', cv.n * 2 + ' samples, hash ' + hash(cv));
});

// ---- cost: time and allocation per block, deoptimisations after the warm-up
// integer-only driver (a float read here would itself allocate before it is optimised), filling the 16 controls for block i
function driveBlock(c, i, db5, gad) {
  c[0] = 1 | (db5 === 2 ? 32 : db5 ? 16 : 0) | ((i >> 11) % (db5 ? 4 : 3)) << 2; c[1] = 900 + (i * 7) % 5000; c[2] = (i >> 9) & 1 ? 1000 : (i >> 7) & 1 ? 300 : 0; c[3] = 1 + (i >> 10) % 5; const v = 1000 + (i * 3) % 4000; c[4] = v; c[5] = (i >> 8) & 1 ? 400 : 0; c[6] = (i >> 9) & 1 ? 700 : 0; c[7] = (i >> 12) & 1 ? 500 : 0; c[8] = (i >> 11) & 1 ? 500 : 0;
  c[9] = 55; c[10] = 10000; c[11] = v; c[12] = 600; c[13] = 300; c[14] = i >> 9; c[15] = gad ? ((i >> 6) & 31) | ((i >> 10) & 31) << 5 | ((i >> 7) & 63) << 10 | (db5 === 2 ? ((i >> 11) & 31) << 16 : 0) : 0;
}
function runBlocks(S, L, R, i0, n, db5, gad) { const c = S.ctl; for (let i = i0; i < i0 + n; i++) { driveBlock(c, i, db5, gad); S.render(L, R, 0, 128); } }
// child process: one configuration, measured as the worklet would run it (its own V8, the real warm-up); prints one JSON line
function costChild(cfg) {
  const db5 = cfg & 4 ? 2 : cfg & 1, gad = (cfg >> 1) & 1, S = coreNew(SR), L = new Float32Array(128), R = new Float32Array(128); warmNew(S, db5); runBlocks(S, L, R, 0, 6000, db5, gad);
  const heap = [], ms = [];
  for (let k = 0; k < 7; k++) { const h0 = process.memoryUsage().heapUsed, t0 = process.hrtime.bigint(); runBlocks(S, L, R, 6000 + k * 8192, 8192, db5, gad); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); heap.push((process.memoryUsage().heapUsed - h0) / 8192); }
  heap.sort((a, b) => a - b); ms.sort((a, b) => a - b); console.log('@@' + JSON.stringify({ us: ms[3] / 8192 * 1000, heap: heap[3], hmax: heap[6] }));
}
test('cost', () => {
  say('Cost and allocation, after the warm-up, in blocks of 128 as in the worklet (a block lasts 2,667 µs); one child process per case, so each has a V8 of its own');
  const res = [];
  for (const [name, cfg] of [['Uno', 0], ['DB5, no gadgets', 1], ['DB5, gadgets working', 3], ['V8, no gadgets', 4], ['V8, gadgets working', 6]]) {
    const out = cp.execFileSync(process.execPath, [__filename, '--src', SRC, '--ref', REF, '--cost-child', String(cfg)], { encoding: 'utf8' }), r = JSON.parse(out.slice(out.indexOf('@@') + 2)); r.name = name; res.push(r);
    say('  ' + name.padEnd(21) + ': ' + f1(r.us) + ' µs per block = ' + f2(r.us / 2666.7 * 100) + ' % of real time; heap growth per block (median of 7 runs of 8,192 blocks) ' + f2(r.heap) + ' bytes, largest ' + f2(r.hmax));
  }
  check(res[2].us < 267 && res[4].us < 267, 'DB5 and V8 with every gadget working cost under 10 % of real time on this machine (about 3 % when the machine is idle)', f2(res[2].us / 26.667) + ' % / ' + f2(res[4].us / 26.667) + ' %');
  check(res.every(r => Math.abs(r.heap) < 1 && r.hmax < 2), 'no allocation per block: the heap does not grow while rendering, in any of the seven runs', res.map(r => f2(r.heap) + ' (largest ' + f2(r.hmax) + ')').join(' / ') + ' bytes per block');
});
// child process for the test below: warm up as the worklet does, then render a long varied stream in blocks of 128.
// which: 0 Uno, 1 DB5, 2 the reference Uno (with the warm-up it had)
function deoptChild(which) {
  const db5 = which === 1 ? 1 : which === 3 ? 2 : 0, S = (which === 2 ? coreRef : coreNew)(SR), L = new Float32Array(128), R = new Float32Array(128);
  if (which === 2) { oldWarm(S, L, R); S.reset(); } else warmNew(S, db5);
  console.log('@@WARM');
  for (let b = 0; b < 5; b++) { S.ctl.fill(0); S.ctl[0] = 1 | (db5 === 2 ? 32 : db5 ? 16 : 0); S.render(L, R, 0, 128); }   // as in the game: the first blocks come before the first controls
  const play = (rec) => { const n = Math.floor(rec.length / 16 * FR / 128), c = S.ctl; for (let b = 0; b < n; b++) { const f = Math.floor(b * 128 / FR) * 16; for (let k = 0; k < 16; k++) c[k] = rec[f + k]; S.render(L, R, 0, 128); } };
  const gfn = (t) => db5 ? ({ cam: Math.floor(t / 7) % 4, gad: (t % 9 > 4 && t % 9 < 5.5 ? 1 : 0) | (t % 13 > 7 && t % 13 < 10 ? 2 : 0) | (t % 17 > 11 && t % 17 < 13 ? 4 : 0) | (t % 5 > 4 ? 8 : 0) | (t % 11 > 10 ? 16 : 0), es: Math.floor(t / 5) * 2, ej: Math.floor(t / 23), ex: Math.floor(t / 19) }) : ({ cam: Math.floor(t / 7) % 3 });   // (end stops two at a time: two clunks queued)
  const lap = t => { const u = t % 14; return t < 1.2 ? 0 : u < 7.5 ? 1 : u < 8.3 ? 0 : u < 10.3 ? -0.8 : u < 11 ? 0.3 : 1; };
  play(drive(db5 === 2 ? 'v8' : db5 ? 'db5' : 'uno', 90, lap, (t, f, s) => Object.assign({ slipL: (t % 14) > 10.3 && (t % 14) < 11.6 ? 0.45 : 0, slipR: (t % 14) > 10.5 && (t % 14) < 11.4 ? 0.3 : 0, kerb: t % 19 > 18 ? 0.5 : 0, loose: t % 31 > 29 ? 0.5 : 0, hits: Math.floor(t / 37), crowd: t % 40 < 6 ? 0.7 : 0, lsp: s.speed }, gfn(t))).rec);
  play(wander(60 * 90, 4242, db5, db5));
  console.log('@@END');
}
test('deopt', () => {
  say('Deoptimisations of the synthesiser after the warm-up (child process with --trace-deopt: warm-up as in the worklet, then a 90 s lap-like drive — with every gadget for the DB5 — and 90 s of wandering controls, mute and pause included)');
  const names = /<JSFunction (chunk|engDB5|gadDB5|engV8|gadV8|svf|noise|noise2|rnd16|rndG|render|birdNote|birdStart|reset)\b/, cnt = {};
  for (const [which, name] of [[2, 'reference Uno'], [0, 'Uno'], [1, 'DB5'], [3, 'V8']]) {
    const out = cp.execFileSync(process.execPath, ['--trace-deopt', __filename, '--src', SRC, '--ref', REF, '--deopt-child', String(which)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const a = out.indexOf('@@WARM'), b = out.indexOf('@@END'); if (a < 0 || b < 0) throw new Error('child failed: ' + out.slice(-400));
    const hits = out.slice(a, b).split('\n').filter(l => l.includes('bailout') && names.test(l)), during = out.slice(0, a).split('\n').filter(l => l.includes('bailout') && names.test(l));
    cnt[which] = hits.length; say('  ' + name + ': ' + during.length + ' during the warm-up, ' + hits.length + ' after it');
    for (const l of hits.slice(0, 8)) say('    ' + l.replace(/0x[0-9a-f]+/g, '').replace(/\s+/g, ' ').replace(/, FP to SP.*$/, '').slice(0, 200));
  }
  check(cnt[1] === 0 && cnt[3] === 0, 'DB5 and V8: no deoptimisation of the synthesiser once the warm-up is over', cnt[1] + ' / ' + cnt[3]);
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
