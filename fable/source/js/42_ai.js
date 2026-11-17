// Linha de corrida e piloto automático. O piloto só "aperta teclas" (mesma via de entrada do jogador);
// é usado fora de linha para gravar os comandos da volta roteirizada (ver trabalho/scripts/gravar_volta).
const AI = { line: null, vt: null, kline: null, enabled: false, script: null, pw: new Float64Array(2), still: 0 };
// What the autopilot plans for with each car: cornering and braking acceleration (m/s²) and top speed (m/s). The DB5 on its
// cross-ply tyres corners and stops far less hard than the Uno.
// (DB5 only — aTot: braking and cornering share one grip budget in the speed profile; margin, slide, brakeLat: see aiFeather)
// (V8 Vantage: radial tyres, more grip than the DB5's, and 400 bhp to feather on the way out of corners)
const AIP = CARSEL === 'v8' ? { aLat: 8.2, aBrk: 7.0, vMax: 70, over: 0.6, look0: 4.5, lookV: 0.3, aTot: 8.2, margin: 1.2, slide: 1.5, brakeLat: 0.3 }
  : CARSEL === 'db5' ? { aLat: 7.2, aBrk: 5.6, vMax: 62, over: 0.6, look0: 4.5, lookV: 0.3, aTot: 7.2, margin: 1.25, slide: 1.5, brakeLat: 0.3 } : CARSEL === 'oxa' ? OXA.aip : { aLat: 11.4, aBrk: 7.6, vMax: 62, over: 1.2, look0: 4.5, lookV: 0.3, aTot: 0 };
// Script of the Aston Martins' scripted lap (benchmark, demo lap, lap poses), by time: [from (s), to (s), keys pressed, keys
// released]. The autopilot drives; the script changes cameras as the Uno's recorded lap does and shows each gadget where it
// is seen best. (The V8 reads the gadget bits its own way: 41_gadgets_v8.js.)
const AI_DEMO_V8 = [
  [0.5, 0.6, K_GLAMP, 0],                                        // headlamps on
  [1.0, 1.1, K_GSMOKE, 0],                                       // rocket booster down the main straight (chase camera)
  [5.5, 5.6, K_GSHIELD, 0], [6.5, 6.6, K_GSHIELD, 0],            // the two missiles, towards the first corner
  [7.5, 10.0, K_GGUN, 0],                                        // hubcap lasers through the first corner
  [12.0, 12.05, K_C, 0],                                         // bonnet camera
  [17.0, 17.1, K_GSHIELD, 0],                                    // a missile (reloaded) into the esses
  [19.5, 19.55, K_C, 0],                                         // trackside TV cameras
  [20.0, 20.1, K_GSLASH | K_GRAM, 0],                            // spiked tyres and outrigger skis out for the hairpin ...
  [24.0, 24.1, K_GSHIELD, 0],                                    // (a missile into the hairpin's barrier)
  [28.5, 28.6, K_GSLASH | K_GRAM, 0],                            // ... and back in
  [30.5, 30.55, K_C, 0],                                         // cockpit
  [31.0, 33.2, K_GGUN, 0],                                       // lasers, with the head-up display
  [34.7, 34.8, K_GSHIELD, 0], [35.5, 35.6, K_GSHIELD, 0],        // missiles down the back straight (reloaded at 34.4 s)
  [41.0, 41.05, K_C, 0],                                         // chase camera
  [42.0, 42.1, K_GLAMP, 0],                                      // headlamps off
  [44.0, 45.0, K_GHORN, 0],                                      // horn
  [47.0, 47.05, K_C, 0],                                         // bonnet camera
  [50.0, 50.1, K_GSMOKE, 0], [50.0, 53.0, K_V, 0],               // booster (recharged) down the long straight, looking back at it
  [53.0, 53.05, K_C, 0],                                         // TV cameras
  [55.5, 57.6, K_GEJECT, 0],                                     // self-destruct, and back on the track
];
const AI_DEMO = CARSEL === 'v8' ? AI_DEMO_V8 : CARSEL !== 'db5' ? null : [
  [1.0, 1.1, K_GPLATE, 0], [2.6, 2.7, K_GPLATE, 0],              // chase camera: the number plates revolve (France, Switzerland)
  [4.5, 4.6, K_GSHIELD, 0], [6.5, 6.6, K_GRAM | K_GSLASH, 0],    // bullet shield up; bumper rams and tyre slashers out
  [10.0, 10.1, K_GSHIELD | K_GRAM | K_GSLASH, 0],                // ... and all back in
  [12.0, 12.05, K_C, 0],                                         // bonnet camera
  [14.0, 17.0, K_GGUN, 0],                                       // machine guns
  [19.0, 19.1, K_GLAMP, 0],                                      // headlamps on
  [19.5, 19.55, K_C, 0],                                         // trackside TV cameras
  [20.5, 20.6, K_GSMOKE, 0],                                     // smoke screen down to the hairpin (8 s)
  [28.4, 29.3, K_W, 0],                                          // a power slide out of the hairpin
  [30.5, 30.55, K_C, 0],                                         // cockpit
  [31.0, 31.1, K_GLAMP, 0],                                      // headlamps off
  [33.5, 36.0, K_GGUN, 0],                                       // guns again, seen from the driver's seat
  [41.0, 41.05, K_C, 0],                                         // chase camera
  [42.0, 42.1, K_GPLATE, 0],                                     // back to the British plate
  [47.0, 47.05, K_C, 0],                                         // bonnet camera
  [48.5, 51.0, K_V | K_GOIL, 0],                                 // looking back at the oil going down
  [53.0, 53.05, K_C, 0],                                         // TV cameras
  [56.0, 56.1, K_GEJECT, 0],                                     // ejector seat
];
function aiBuild() {
  const N = TRK.N, ds = TRK.ds, hw = TRK.hw, lim = hw - 2.0;
  const o = new Float64Array(N), px = new Float64Array(N), pz = new Float64Array(N);
  const upd = i => { px[i] = TRK.x[i] - TRK.tz[i] * o[i]; pz[i] = TRK.z[i] + TRK.tx[i] * o[i]; };
  for (let i = 0; i < N; i++) upd(i);
  // minimiza a curvatura (energia da 2ª diferença) por descida de gradiente, do grosso para o fino
  for (const k of [16, 8, 4]) {
    const M = Math.floor(N / k), id = new Int32Array(M), oo = new Float64Array(M), qx = new Float64Array(M), qz = new Float64Array(M), dx = new Float64Array(M), dz = new Float64Array(M);
    for (let j = 0; j < M; j++) { id[j] = Math.round(j * N / M) % N; oo[j] = o[id[j]]; }
    const iters = k === 16 ? 9000 : k === 8 ? 3000 : 800;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < M; j++) { const i = id[j]; qx[j] = TRK.x[i] - TRK.tz[i] * oo[j]; qz[j] = TRK.z[i] + TRK.tx[i] * oo[j]; }
      for (let j = 0; j < M; j++) { const a = (j - 1 + M) % M, b = (j + 1) % M; dx[j] = qx[a] - 2 * qx[j] + qx[b]; dz[j] = qz[a] - 2 * qz[j] + qz[b]; }
      for (let j = 0; j < M; j++) { const a = (j - 1 + M) % M, b = (j + 1) % M, i = id[j]; const gx = dx[a] - 2 * dx[j] + dx[b], gz = dz[a] - 2 * dz[j] + dz[b]; oo[j] = clamp(oo[j] - 0.05 * (gx * -TRK.tz[i] + gz * TRK.tx[i]), TRK.aiL ? -TRK.aiL[i] : -lim, TRK.aiR ? TRK.aiR[i] : lim); }   // (town map: room per side, TRK.aiL/aiR)
    }
    for (let i = 0; i < N; i++) { const u = i * M / N, j = Math.floor(u) % M, f = u - Math.floor(u); o[i] = oo[j] + (oo[(j + 1) % M] - oo[j]) * f; }
  }
  for (let i = 0; i < N; i++) upd(i);
  // suaviza e guarda
  const line = AI.line = new Float32Array(N), kl = AI.kline = new Float32Array(N), vt = AI.vt = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0, w = 0; for (let q = -6; q <= 6; q++) { const g = Math.exp(-q * q / 18); s += o[(i + q + N) % N] * g; w += g; } line[i] = s / w; }
  for (let i = 0; i < N; i++) { o[i] = line[i]; upd(i); }
  TRK.line = line;
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N; const x1 = px[i] - px[a], z1 = pz[i] - pz[a], x2 = px[b] - px[i], z2 = pz[b] - pz[i];
    const cr = x1 * z2 - z1 * x2, l1 = Math.hypot(x1, z1), l2 = Math.hypot(x2, z2), l3 = Math.hypot(px[b] - px[a], pz[b] - pz[a]);
    kl[i] = 2 * cr / (l1 * l2 * l3 + 1e-9);
  }
  // perfil de velocidade: limite lateral, depois passes de frenagem (trás) e aceleração (frente)
  const aLat = AIP.aLat, aBrk = AIP.aBrk, vMax = AIP.vMax;
  const km = new Float32Array(N), aTot = AIP.aTot;
  for (let i = 0; i < N; i++) { let k = 0; for (let q = -3; q <= 3; q++) k = Math.max(k, Math.abs(kl[(i + q + N) % N])); km[i] = k; vt[i] = Math.min(vMax, Math.sqrt(aLat / Math.max(k, 1e-4))); }
  for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) {
    const nx = (i + 1) % N; const g = -9.81 * TRK.slope[i];
    let aB = aBrk;
    if (aTot > 0) { const al = vt[nx] * vt[nx] * km[i]; aB = Math.min(aBrk, Math.sqrt(Math.max(1, aTot * aTot - al * al))); }   // DB5: what the cornering leaves for braking
    vt[i] = Math.min(vt[i], Math.sqrt(vt[nx] * vt[nx] + 2 * Math.max(2, aB + g) * ds));
  }
}
const _ai = new Float64Array(5);
// decide as teclas deste instante a partir do estado do veículo
function aiKeys(t) {
  const V = VEH, N = TRK.N, ds = TRK.ds; let keys = 0;
  const speed = Math.hypot(V.vx, V.vy), i0 = ((Math.floor(V.s / ds) % N) + N) % N;
  // ponto de mira na linha, à frente
  const Ld = AIP.look0 + speed * AIP.lookV, ia = (i0 + Math.round(Ld / ds)) % N;
  trackPos(ia * ds, AI.line[ia], _ai);
  const dx = _ai[0] - V.x, dz = _ai[2] - V.z, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c, eta = Math.atan2(lz, lx);
  let want = Math.atan(2 * VP.L * Math.sin(eta) / Math.hypot(lx, lz));
  want += clamp(-V.r * 0.0 + (Math.atan2(V.vy, Math.max(V.vx, 3))) * 0.6, -0.2, 0.2);   // contra-esterço se a traseira escapa
  const err = want - V.steer, db = 0.006;
  if (err > db) keys |= K_D; else if (err < -db) keys |= K_A;
  // velocidade alvo um pouco à frente (antecipa o freio)
  let vT = 1e9; for (let q = 0; q < 6; q++) vT = Math.min(vT, AI.vt[(i0 + q * 2) % N]);
  if (GAD.thrust > 0) {   // V8 booster burning: it brakes less hard against the thrust, so it looks further ahead for the next corner
    const aE = Math.max(1.5, AIP.aBrk - GAD.thrust / VP.m);
    for (let q = 1; q < 160; q++) { const v = AI.vt[(i0 + q) % N], w = Math.sqrt(v * v + 2 * aE * q * ds); if (w < vT) vT = w; }
  }
  const sc = AI.script;
  if (speed < vT - 0.3) keys |= K_W; else if (speed > vT + AIP.over) keys |= K_S;
  else if (speed < vT + 0.3 && (V.steps & 1)) keys |= K_W;
  if (VP.rwd || VP.awd) keys = aiFeather(keys);   // (garage cars with four-wheel drive feather too)
  // roteiro: eventos por tempo (freio de mão, trocas de câmera)
  if (sc) for (let i = 0; i < sc.length; i++) { const e = sc[i]; if (t >= e[0] && t < e[1]) { keys |= e[2]; if (e[3]) keys &= ~e[3]; } }
  return keys;
}
// Rear-wheel drive on cross-ply tyres (the DB5): the autopilot cannot simply floor the throttle or stand on the brake in a
// corner. A key is all or nothing, so it is pulsed: the share of the time it is held is what the tyres can take on top of the
// cornering they are doing at that moment (the same friction circle the physics uses).
function aiFeather(keys) {
  const V = VEH, P = VP, g = 9.81, a = AI.pw;
  const beta = Math.atan2(V.vy, V.vx > 3 ? V.vx : 3);
  const f = (V.ay < 0 ? -V.ay : V.ay) / (P.mu * g) * AIP.margin + (beta < 0 ? -beta : beta) * AIP.slide;   // share of the grip the cornering asks for (more once the tail is out)
  if (keys & K_W) {
    // side grip left at the rear with the throttle open: the drive force comes first, up to wheelspin
    const capR = P.mu * (P.m * g * P.a / P.L + P.m * (V.ax > 0 ? V.ax : 0) * P.h / P.L);
    const x = engineTorque(V.rpm) * P.gears[(V.gear > 0 ? V.gear : 1) - 1] * P.final * P.eff / P.R / capR, cOn = x < 0.985 ? Math.sqrt(1 - x * x) : P.spinLat;
    const duty = cOn >= f ? 1 : f >= 1 ? 0 : (1 - f) / (1 - cOn);
    a[0] += duty; if (a[0] >= 1) a[0] -= 1; else keys &= ~K_W;
  } else if (keys & K_S) {
    const duty = AIP.brakeLat >= f ? 1 : f >= 1 ? 0 : (1 - f) / (1 - AIP.brakeLat);
    a[1] += duty; if (a[1] >= 1) a[1] -= 1; else keys &= ~K_S;
  }
  // should it ever come to rest against a barrier, it asks to be put back on the track (the R key) and carries on
  if (V.vx * V.vx + V.vy * V.vy < 1 && V.time > 3) { if (++AI.still > 150) { AI.still = 0; keys |= K_R; } } else AI.still = 0;
  return keys;
}
