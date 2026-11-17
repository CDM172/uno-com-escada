// Efeitos: marcas de pneu (decalque em anel de quads) e fumaça/poeira (partículas em CPU, instanciadas). Tudo pré-alocado.
// (The DB5 adds its gadget effects to the same system: more particles for the smoke screen, particle kinds 3 to 5 and a
// second decal ring for the oil it lays on the road. With the Uno none of that exists and everything is as it was.)
const SK_N = 4096, PT_N = CARSEL === 'db5' ? 1800 : 900, OIL_N = CARSEL === 'db5' ? 1024 : 0;
const FX = {
  sk: new Float32Array(SK_N * 6 * 5), skHead: 0, skLo: 1e9, skHi: -1, skBuf: null, skPipe: null,
  last: new Float32Array(4 * 8), active: new Uint8Array(4),
  p: new Float32Array(PT_N * 12), pAlive: 0, pNext: 0, inst: new Float32Array(PT_N * 12), pBuf: null, pFam: null, pBG: null, seed: new Uint32Array([7]),
  oil: new Float32Array(OIL_N * 6 * 5), oilHead: 0, oilLo: 1e9, oilHi: -1, oilBuf: null, oilPipe: null, oilLast: new Float32Array(8), oilOn: 0, oilPrev: -1,
};
// Particle kinds 3 and up (gadgets): colour (linear rgb), opacity, growth of the size over the life, 1 = glows by itself
//   3 white smoke (smoke screen, rocket of the ejector seat, gun smoke) | 4 oil spray | 5 tracer
const FXK = new Float32Array([
  0.8, 0.81, 0.83, 0.92, 5.2, 0,
  0.012, 0.01, 0.008, 0.8, 2.2, 0,
  14, 7.5, 1.6, 1, 0, 1,
]);
function fxInit() {
  FX.skBuf = mkBuf(FX.sk.byteLength, BU.V);
  const code = wgslPP('skid', SH_DEFS), mod = mkShader('skid', SH_DEFS), bgls = reflectBGLs(code); bgls[0] = R.bgl0;
  const none = { format: 'rgba16float', writeMask: 0 };
  R.pending.push(G.dev.createRenderPipelineAsync({
    layout: G.dev.createPipelineLayout({ bindGroupLayouts: [bgls[0], bgls[1]] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }] }] },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm-srgb', blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }, none, { format: 'rgba8unorm', writeMask: 0 }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal', depthBias: 6, depthBiasSlopeScale: 2 },
  }).then(p => { FX.skPipe = p; }));
  R.decals.push({ draw(pass) { if (!FX.skPipe) return; pass.setPipeline(FX.skPipe); pass.setVertexBuffer(0, FX.skBuf); pass.draw(SK_N * 6); } });
  if (OIL_N) fxOilInit(bgls);
  FX.pBuf = mkBuf(FX.inst.byteLength, BU.V);
  FX.pFam = mkFwdFamily('particles', {
    src: 'particles', cull: 'none',
    buffers: [{ arrayStride: 48, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }],
    blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
  });
  R.transparents.push({ draw(pass) { if (!FX.pFam.pipe || !FX.pAlive) return; if (!FX.pBG) FX.pBG = fwdBindGroup(FX.pFam); pass.setPipeline(FX.pFam.pipe); pass.setBindGroup(3, FX.pBG); pass.setVertexBuffer(0, FX.pBuf); pass.draw(6, FX.pAlive); } });
}
function fxReset() { FX.sk.fill(0); FX.skLo = 0; FX.skHi = SK_N * 30; FX.skHead = 0; FX.active.fill(0); FX.p.fill(0); FX.pAlive = 0; FX.pNext = 0; FX.seed[0] = 7; }
// ---- gadget effects (DB5) ----
// Spawns one particle from the register FXQ = [x, y, z, vx, vy, vz, life (s), size (m), kind]: no numbers go through arguments.
const FXQ = new Float64Array(9);
function fxEmitQ() {
  const q = FX.pNext * 12, p = FX.p, e = FXQ, K = 1 / 65536; FX.pNext = (FX.pNext + 1) % PT_N;
  p[q] = e[0]; p[q + 1] = e[1]; p[q + 2] = e[2]; p[q + 3] = e[3]; p[q + 4] = e[4]; p[q + 5] = e[5];
  p[q + 6] = 0; p[q + 7] = e[6]; p[q + 8] = e[7]; p[q + 9] = (fxRnd() * K) * 6.28; p[q + 10] = e[8]; p[q + 11] = (fxRnd() * K);
}
// Oil slick: a ribbon of quads on the road, kept in a ring like the tyre marks and drawn as a decal that darkens the
// albedo, makes the surface smooth and adds a film that mirrors the scene (wgsl/oil.wgsl).
const OIL_HW = 0.62;   // half width of the ribbon (m)
function fxOilInit(bgls) {
  FX.oilBuf = mkBuf(FX.oil.byteLength, BU.V);
  const mod = mkShader('oil', SH_DEFS), mix = { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, keep = { srcFactor: 'zero', dstFactor: 'one' };
  R.pending.push(G.dev.createRenderPipelineAsync({
    layout: G.dev.createPipelineLayout({ bindGroupLayouts: [bgls[0], bgls[1]] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }] }] },
    // albedo: blended, occlusion kept | normal kept, only the roughness (blue) is blended | only the water film (alpha) is raised
    fragment: { module: mod, entryPoint: 'fs', targets: [
      { format: 'rgba8unorm-srgb', blend: { color: mix, alpha: keep } },
      { format: 'rgba16float', blend: { color: mix, alpha: keep }, writeMask: 4 },
      { format: 'rgba8unorm', blend: { color: keep, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }, writeMask: 8 }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal', depthBias: 6, depthBiasSlopeScale: 2 },
  }).then(p => { FX.oilPipe = p; }));
  R.decals.push({ draw(pass) { if (!FX.oilPipe) return; pass.setPipeline(FX.oilPipe); pass.setVertexBuffer(0, FX.oilBuf); pass.draw(OIL_N * 6); } });
}
function fxOilReset() { FX.oil.fill(0); FX.oilLo = 0; FX.oilHi = OIL_N * 30; FX.oilHead = 0; FX.oilOn = 0; FX.oilPrev = -1; }
// One physics step of oil spraying. on = 1: the register FXQ holds the middle of the ribbon [x, y, z] under the nozzle, the
// direction across it [x, z] in FXQ[3] and FXQ[5] and its cross slope in FXQ[4]; a new quad is added once the car has moved
// far enough. on = 0: the spray stopped — the last quad fades out instead of ending in a straight cut.
function fxOilLay(on) {
  const L = FX.oilLast, S = FX.oil, e = FXQ;
  if (!on) {
    if (FX.oilOn && FX.oilPrev >= 0) { const b = FX.oilPrev; S[b + 13] = 0; S[b + 23] = 0; S[b + 28] = 0; if (b < FX.oilLo) FX.oilLo = b; if (b + 30 > FX.oilHi) FX.oilHi = b + 30; }
    FX.oilOn = 0; FX.oilPrev = -1; return;
  }
  const x = e[0], y = e[1], z = e[2], nx = e[3] * OIL_HW, ny = e[4] * OIL_HW, nz = e[5] * OIL_HW;
  if (!FX.oilOn) { FX.oilOn = 1; FX.oilPrev = -1; L[0] = x; L[1] = y; L[2] = z; L[3] = nx; L[4] = ny; L[5] = nz; L[6] = 0; return; }
  const dx = x - L[0], dz = z - L[2], d2 = dx * dx + dz * dz;
  if (d2 > 16) { L[0] = x; L[1] = y; L[2] = z; L[3] = nx; L[4] = ny; L[5] = nz; L[6] = 0; FX.oilPrev = -1; return; }   // the car was put back on the track: a new ribbon starts
  if (d2 < 0.09) return;
  const b = FX.oilHead * 30, pa = L[6]; FX.oilHead = (FX.oilHead + 1) % OIL_N;
  const ax = L[0] - L[3], ay = L[1] - L[4], az = L[2] - L[5], bx = L[0] + L[3], by = L[1] + L[4], bz = L[2] + L[5];
  S[b] = ax; S[b + 1] = ay; S[b + 2] = az; S[b + 3] = pa; S[b + 4] = -1;
  S[b + 5] = bx; S[b + 6] = by; S[b + 7] = bz; S[b + 8] = pa; S[b + 9] = 1;
  S[b + 10] = x + nx; S[b + 11] = y + ny; S[b + 12] = z + nz; S[b + 13] = 1; S[b + 14] = 1;
  S[b + 15] = ax; S[b + 16] = ay; S[b + 17] = az; S[b + 18] = pa; S[b + 19] = -1;
  S[b + 20] = x + nx; S[b + 21] = y + ny; S[b + 22] = z + nz; S[b + 23] = 1; S[b + 24] = 1;
  S[b + 25] = x - nx; S[b + 26] = y - ny; S[b + 27] = z - nz; S[b + 28] = 1; S[b + 29] = -1;
  if (b < FX.oilLo) FX.oilLo = b; if (b + 30 > FX.oilHi) FX.oilHi = b + 30;
  L[0] = x; L[1] = y; L[2] = z; L[3] = nx; L[4] = ny; L[5] = nz; L[6] = 1; FX.oilPrev = b;
}
// inteiro pseudoaleatório 0..65535 (inteiros pequenos não vão para a heap)
function fxRnd() { const s = FX.seed; let x = s[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s[0] = x; return (s[0] >>> 8) & 0xffff; }
// por passo de física: estende as marcas e emite partículas nas rodas que derrapam
function fxStep() {
  const V = VEH, L = FX.last;
  for (let i = 0; i < 4; i++) {
    const sl = V.slip[i], zone = V.wzone[i], hard = zone === ZONE.ASPHALT || zone === ZONE.KERB || zone === ZONE.PIT;
    const x = V.wx[i], y = V.wy[i] + 0.012, z = V.wz[i], o = i * 8;
    if ((zone === ZONE.ASPHALT || zone === ZONE.PIT) && sl > 0.5) {
      if (!FX.active[i]) { FX.active[i] = 1; L[o] = x; L[o + 1] = y; L[o + 2] = z; L[o + 6] = 0; L[o + 7] = 0; }
      else {
        const dx = x - L[o], dz = z - L[o + 2], d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.14) {
          const nx = -dz / d * 0.082, nz = dx / d * 0.082, a = Math.min(1, (sl - 0.5) * 2.4) * 0.8;
          const hadPrev = L[o + 7] > 0, pnx = hadPrev ? L[o + 3] : nx, pnz = hadPrev ? L[o + 4] : nz, pa = L[o + 6];
          const b = FX.skHead * 30; FX.skHead = (FX.skHead + 1) % SK_N;
          const S = FX.sk, ax = L[o] - pnx, az = L[o + 2] - pnz, bx = L[o] + pnx, bz = L[o + 2] + pnz, py = L[o + 1];
          S[b] = ax; S[b + 1] = py; S[b + 2] = az; S[b + 3] = pa; S[b + 4] = -1;
          S[b + 5] = bx; S[b + 6] = py; S[b + 7] = bz; S[b + 8] = pa; S[b + 9] = 1;
          S[b + 10] = x + nx; S[b + 11] = y; S[b + 12] = z + nz; S[b + 13] = a; S[b + 14] = 1;
          S[b + 15] = ax; S[b + 16] = py; S[b + 17] = az; S[b + 18] = pa; S[b + 19] = -1;
          S[b + 20] = x + nx; S[b + 21] = y; S[b + 22] = z + nz; S[b + 23] = a; S[b + 24] = 1;
          S[b + 25] = x - nx; S[b + 26] = y; S[b + 27] = z - nz; S[b + 28] = a; S[b + 29] = -1;
          if (b < FX.skLo) FX.skLo = b; if (b + 30 > FX.skHi) FX.skHi = b + 30;
          L[o] = x; L[o + 1] = y; L[o + 2] = z; L[o + 3] = nx; L[o + 4] = nz; L[o + 6] = a; L[o + 7] = 1;
        }
      }
    } else FX.active[i] = 0;
    // partículas
    const speed = Math.sqrt(V.vx * V.vx + V.vy * V.vy);
    const rate = hard ? (sl > 0.62 ? (sl - 0.62) * 1.0 * Math.min(1, speed * 0.1) : 0) : Math.min(1, speed / 14) * 0.3;
    for (let rep = 0; rep < 2; rep++) if (rate > 0 && fxRnd() < rate * (rep ? 0.6 : 1) * 65536) {
      const q = FX.pNext * 12, p = FX.p, K = 1 / 65536; FX.pNext = (FX.pNext + 1) % PT_N;
      const c = Math.cos(V.yaw), s = Math.sin(V.yaw), wvx = V.vx * c - V.vy * s, wvz = V.vx * s + V.vy * c;
      p[q] = x + ((fxRnd() * K) - 0.5) * 0.25; p[q + 1] = y + 0.08; p[q + 2] = z + ((fxRnd() * K) - 0.5) * 0.25;
      p[q + 3] = wvx * 0.18 + ((fxRnd() * K) - 0.5) * 1.1; p[q + 4] = 0.5 + (fxRnd() * K) * 0.7; p[q + 5] = wvz * 0.18 + ((fxRnd() * K) - 0.5) * 1.1;
      p[q + 6] = 0; p[q + 7] = hard ? 0.8 + (fxRnd() * K) * 0.9 : 0.8 + (fxRnd() * K) * 0.7; p[q + 8] = 0.16 + (fxRnd() * K) * 0.14; p[q + 9] = (fxRnd() * K) * 6.28; p[q + 10] = hard ? 0 : (zone === ZONE.GRAVEL ? 1 : 2); p[q + 11] = (fxRnd() * K);
    }
  }
}
// por quadro: integra as partículas e envia os buffers alterados
function fxFrame() {
  const dt = RT[1];
  if (FX.skHi > FX.skLo) { G.dev.queue.writeBuffer(FX.skBuf, FX.skLo * 4, FX.sk, FX.skLo, FX.skHi - FX.skLo); FX.skLo = 1e9; FX.skHi = -1; }
  if (FX.oilHi > FX.oilLo) { G.dev.queue.writeBuffer(FX.oilBuf, FX.oilLo * 4, FX.oil, FX.oilLo, FX.oilHi - FX.oilLo); FX.oilLo = 1e9; FX.oilHi = -1; }
  const p = FX.p, o = FX.inst; let n = 0;
  for (let i = 0; i < PT_N; i++) {
    const q = i * 12, life = p[q + 7]; if (life <= 0) continue;
    const age = p[q + 6] + dt; if (age >= life) { p[q + 7] = 0; continue; }
    p[q + 6] = age; const k = Math.exp(-dt * 1.6);
    p[q + 3] = p[q + 3] * k + R.wind[0] * 0.6 * dt; p[q + 5] = p[q + 5] * k + R.wind[1] * 0.6 * dt; p[q + 4] = p[q + 4] * Math.exp(-dt * 0.9) + 0.25 * dt;
    p[q] += p[q + 3] * dt; p[q + 1] += p[q + 4] * dt; p[q + 2] += p[q + 5] * dt;
    const t = age / life, kind = p[q + 10], w = n * 12;
    if (kind >= 3) {   // gadget particles (DB5): look taken from the table FXK
      const T = FXK, kk = (kind - 3) * 6, em = T[kk + 5];
      o[w] = p[q]; o[w + 1] = p[q + 1] + p[q + 8] * 0.5; o[w + 2] = p[q + 2]; o[w + 3] = p[q + 8] * (1 + Math.sqrt(t) * T[kk + 4]);
      o[w + 4] = T[kk]; o[w + 5] = T[kk + 1]; o[w + 6] = T[kk + 2];
      o[w + 7] = em > 0 ? 1 - t * t : Math.min(1, t * 30) * Math.pow(1 - t, 1.25) * T[kk + 3] / (1 + t * 0.9);
      o[w + 8] = p[q + 9] + t * 0.8; o[w + 9] = p[q + 11]; o[w + 10] = em; n++; continue;
    }
    o[w] = p[q]; o[w + 1] = p[q + 1] + p[q + 8] * 0.5; o[w + 2] = p[q + 2]; o[w + 3] = p[q + 8] * (1 + Math.sqrt(t) * (kind === 0 ? 3.4 : 3.2));
    const a = Math.min(1, t * 45) * Math.pow(1 - t, 1.6) * (kind === 0 ? 0.5 : 0.42) / (1 + t * 2.2);
    if (kind === 0) { o[w + 4] = 0.5; o[w + 5] = 0.52; o[w + 6] = 0.55; } else if (kind === 1) { o[w + 4] = 0.55; o[w + 5] = 0.48; o[w + 6] = 0.38; } else { o[w + 4] = 0.5; o[w + 5] = 0.44; o[w + 6] = 0.33; }
    o[w + 7] = a; o[w + 8] = p[q + 9] + t * 0.8; o[w + 9] = p[q + 11]; o[w + 10] = 0; n++;
  }
  FX.pAlive = n;
  if (n) G.dev.queue.writeBuffer(FX.pBuf, 0, o, 0, n * 12);
}
BUILD.push(async () => { if ((GAME.mode !== 'test' && GAME.mode !== 'car') || (GAME.mode === 'car' && GAD.on)) fxInit(); });   // (the DB5 viewer shows its gadgets: smoke, oil)
