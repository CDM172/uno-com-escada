// Física do veículo (sem biblioteca): modelo plano de 4 rodas com transferência de carga, elipse de atrito,
// tração dianteira, câmbio automático, freio de mão, relevo/inclinação da pista e colisão com barreiras.
// Passo fixo de 1/120 s. Nenhuma alocação durante a simulação.
// Three cars share this model: the Fiat Uno (front-wheel drive), the Aston Martin DB5 and the Aston Martin V8 Vantage
// (rear-wheel drive). Everything that differs between them is a field of VP; the Uno's fields hold the numbers the code
// used to have inline, so its arithmetic (and therefore its recorded lap) is bit for bit what it was. The gadgets of the
// Aston Martins act through GAD (41_gadgets.js), whose values are neutral (factors of exactly 1, nothing switched on)
// for the other cars.
const PHYS_DT = 1 / 120;
const K_W = 1, K_S = 2, K_A = 4, K_D = 8, K_SPACE = 16, K_C = 32, K_R = 64, K_V = 128, K_PAD = 256, K_PADS = 512;
// Entrada analógica do controle: VIN[0] acelerador 0..1, VIN[1] freio 0..1 (valem quando as teclas trazem K_PAD), VIN[2] direção -1..1 (K_PADS).
// As teclas gravadas da volta roteirizada nunca trazem esses bits: a via digital fica exatamente como era.
const VIN = new Float64Array(3);
const VP = CARSEL === 'v8' ? {
  // Aston Martin V8 Vantage (1987): about 1,800 kg at the kerb plus the driver, 51 % on the front wheels, wheelbase 2.61 m,
  // track 1.5 m, 5,340 cc four-cam V8 on four Weber 48 IDF (about 400 bhp at 6,000 rpm, 540 N·m at 5,000, red line
  // 6,500), ZF five-speed gearbox 2.90/1.78/1.22/1.00/0.845, final drive 3.54, rear-wheel drive (de Dion axle, limited-slip
  // differential), 255/60 VR15 radial tyres, ventilated discs all round; about 270 km/h, 0-100 km/h in about 5.4 s.
  // (wheelbase, tracks, tyre radius and the size of the body come with the model: BCG, from V8_META.car)
  m: 1875, Izz: 3200, L: BCG.wheelbase, a: BCG.wheelbase * 0.49, b: BCG.wheelbase * 0.51, tw: (Math.abs(BCG.hubs[0][2]) + Math.abs(BCG.hubs[1][2]) + Math.abs(BCG.hubs[2][2]) + Math.abs(BCG.hubs[3][2])) / 2, h: 0.5, R: BCG.wheelR,
  mu: 1.15, B: 8.8, C: 1.45,
  gears: [2.90, 1.78, 1.22, 1.0, 0.845], final: 3.54, rev: 2.63, eff: 0.78,
  cdA: 0.82, crr: 0.015, brakeF: 0.66, halfW: BCG.halfW, front: BCG.front + BCG.bumper, rear: BCG.rear + BCG.bumper,
  rwd: true, eng: 2, steerLat: 9.6, steerMax: 0.6, steerRatio: 15, catchK: 0.9, catchAt: 0.12,
  shiftUp: 6300, shiftDn: 5100, rpmIdle: 800, rpmMax: 6700, rpmCut: 6500, launch0: 1000, launchK: 2600, engBrake: 0.05,
  brakeG: 1.05, spinLat: 0.55, rollF: 0.56, rollR: 0.44,
  kR: 66, cR: 8, rollK: 0.0062, rollMax: 0.075, diveK: 0.004, squatK: 0.0036, pitchMax: 0.038,
} : CARSEL === 'db5' ? {
  // Aston Martin DB5, from the FIA homologation form no. 186: 1,465 kg plus driver, weight split about 50/50, wheelbase
  // 2.489 m, track 1.378/1.359 m, straight six of 3,995 cc (282 bhp at 5,500 rpm), ZF five-speed gearbox, final drive 3.77,
  // rear-wheel drive, 6.70-15 cross-ply tyres (far less grip than the Uno's modern rubber, and a gentler break-away),
  // disc brakes, 3.2 turns of the steering wheel from lock to lock, soft springs.
  // (wheelbase, tracks, tyre radius and the size of the body come with the model: BCG, from DB5_META.car)
  m: 1540, Izz: 2450, L: BCG.wheelbase, a: BCG.wheelbase / 2, b: BCG.wheelbase / 2, tw: (Math.abs(BCG.hubs[0][2]) + Math.abs(BCG.hubs[1][2]) + Math.abs(BCG.hubs[2][2]) + Math.abs(BCG.hubs[3][2])) / 2, h: 0.52, R: BCG.wheelR,
  mu: 1.06, B: 7.5, C: 1.4,
  gears: [2.73, 1.76, 1.23, 1.0, 0.83], final: 3.77, rev: 3.31, eff: 0.82,
  cdA: 1.0, crr: 0.017, brakeF: 0.72, halfW: BCG.halfW, front: BCG.front + BCG.bumper, rear: BCG.rear + BCG.bumper,
  rwd: true, eng: 1, steerLat: 8.6, steerMax: 0.62, steerRatio: 16, catchK: 1, catchAt: 0.14,
  shiftUp: 5800, shiftDn: 4900, rpmIdle: 750, rpmMax: 6100, rpmCut: 6000, launch0: 900, launchK: 1700, engBrake: 0.06,
  brakeG: 0.9, spinLat: 0.58, rollF: 0.54, rollR: 0.46,
  kR: 52, cR: 6.6, rollK: 0.0086, rollMax: 0.1, diveK: 0.0052, squatK: 0.0046, pitchMax: 0.048,
} : {
  m: 900, Izz: 1250, L: 2.362, a: 0.96, b: 1.402, tw: 1.33, h: 0.5, R: 0.281,
  mu: 1.42, B: 9.5, C: 1.42,
  gears: [3.91, 2.16, 1.48, 1.12, 0.9], final: 4.07, rev: 3.9, eff: 0.9,
  cdA: 0.62, crr: 0.014, brakeF: 0.64, halfW: 0.78, front: 1.92, rear: 1.72,
  // rwd: which axle is driven; eng: torque curve (0 Uno, 1 DB5, 2 V8); steerLat: lateral acceleration (m/s²) the full lock is sized for at speed; steerMax: lock (rad);
  // steerRatio: steering-wheel angle / road-wheel angle; catchK/catchAt: opposite lock the steering takes by itself when the
  // tail slides (share of the slip angle of the rear axle beyond catchAt rad; 0 = none);
  // shiftUp/shiftDn: automatic gearbox (rpm); rpmCut: ignition cut;
  // launch0/launchK: slipping clutch when pulling away; engBrake: engine braking; brakeG: brake demand at full pedal (g);
  // spinLat: side grip left on a spinning driven tyre; rollF/rollR: share of the lateral load transfer on each axle;
  // kR/cR, rollK..pitchMax: body on its springs (stiffness, damping, roll per m/s², dive, squat, limits in rad)
  rwd: false, eng: 0, steerLat: 11.5, steerMax: 0.6, steerRatio: 14, catchK: 0, catchAt: 0,
  shiftUp: 6250, shiftDn: 5350, rpmIdle: 900, rpmMax: 6700, rpmCut: 6500, launch0: 1100, launchK: 1900, engBrake: 0.012,
  brakeG: 1.25, spinLat: 0.42, rollF: 0.56, rollR: 0.44,
  kR: 78, cR: 9.5, rollK: 0.0058, rollMax: 0.062, diveK: 0.0034, squatK: 0.003, pitchMax: 0.03,
};
const VEH = {
  x: 0, z: 0, yaw: 0, vx: 0, vy: 0, r: 0,                  // posição do CG no plano, direção, velocidades no corpo (frente, direita), guinada
  steer: 0, rpm: 900, gear: 1, throttle: 0, brake: 0, hand: 0,
  ax: 0, ay: 0,                                              // acelerações filtradas (corpo)
  roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0,
  y: 0, gPitch: 0, gRoll: 0,                                 // altura e inclinação do chão sob o carro (filtradas)
  spin: new Float32Array(4), omega: new Float32Array(4), susp: new Float32Array(4),
  slip: new Float32Array(4),                                 // intensidade de derrapagem por roda 0..1 (fumaça/marcas)
  wx: new Float32Array(4), wy: new Float32Array(4), wz: new Float32Array(4), wzone: new Uint8Array(4), whint: new Int32Array(4).fill(-1),
  fz: new Float32Array(4), hint: -1, s: 0, d: 0, zone: 0, lapS: 0, lastS: 0, laps: 0, maxOff: 0, offCount: 0, hits: 0, time: 0, steps: 0,
  ctl: new Float32Array(2),                                  // saída para o som: acelerador e freio efetivos do último passo
  // estado anterior (para interpolar a renderização)
  px: 0, pz: 0, pyaw: 0, py: 0, proll: 0, ppitch: 0, pheave: 0, pgPitch: 0, pgRoll: 0, psteer: 0, pspin: new Float32Array(4), psusp: new Float32Array(4),
};
const _vl = new Float64Array(4), _vp = new Float64Array(5);
// posições locais das rodas (x frente, z direita): FL, FR, RL, RR
const WLX = [VP.a, VP.a, -VP.b, -VP.b], WLZ = [-VP.tw / 2, VP.tw / 2, -VP.tw / 2, VP.tw / 2];

function engineTorque(rpm) { // curva de torque (N·m): um Mille bem mais disposto que o de fábrica
  const x = rpm / 1000;
  // V8: 540 N·m at 5,000 rpm, 480 N·m (404 bhp) at 6,000 rpm, falling away above that
  if (VP.eng === 2) { const d = x - 5; return Math.max(0, 540 - (d < 0 ? 13.5 : 60) * d * d - Math.max(0, x - 6) * 80); }
  // DB5: 390 N·m at 3,850 rpm, 365 N·m (282 bhp) at 5,500 rpm, falling away quickly above that
  if (VP.rwd) { const d = x - 3.85; return Math.max(0, 390 - (d < 0 ? 13.5 : 9.15) * d * d - Math.max(0, x - 5.5) * 70); }
  const t = 180 + 118 * Math.sin(clamp((x - 0.6) / 5.4, 0, 1) * PI) - Math.max(0, x - 6.0) * 110;
  return Math.max(0, t);
}
// consulta do chão sem números por argumento/retorno: entrada _gq[0]=x, _gq[1]=z; saída _gq[8]=altura; devolve a zona (inteiro).
// wi = índice da roda (dica de busca em VEH.whint) ou -1 para o CG.
const _gq = new Float64Array(12);
function groundQ(wi) {
  if (TOWN.on) return townGroundQ(wi);   // Weston-super-Mare: the town's surface map (13_wsm_town.js)
  const q = _gq, V = VEH;
  trackLocateQ(wi >= 0 ? V.whint[wi] : V.hint, q);
  if (q[3] > 90 || q[3] < -90) trackLocateQ(-1, q);
  const i0 = q[4] | 0, f = q[5], d = q[3], ad = d < 0 ? -d : d, i1 = (i0 + 1) % TRK.N;
  if (wi >= 0) V.whint[wi] = i0; else { V.hint = i0; V.s = q[2]; V.d = d; }
  const zone = zoneAtQ(q), lim = TRK.hw + APRON;
  const ty = TRK.y[i0] + (TRK.y[i1] - TRK.y[i0]) * f - (d < -lim ? -lim : d > lim ? lim : d) * (TRK.bank[i0] + (TRK.bank[i1] - TRK.bank[i0]) * f);
  let y = ty;
  if (ad <= lim - 0.4) {
    if (zone === ZONE.KERB) { const kx = ad - TRK.hw; if (kx > 0 && kx < KERB_W) y += 0.012 + 0.045 * Math.sin(Math.min(1, kx / (KERB_W * 0.82)) * PI * 0.5) * (kx > KERB_W * 0.82 ? (KERB_W - kx) / (KERB_W * 0.18) : 1) + 0.012 * Math.sin(q[2] * 5.2); }
  } else {
    hfAtQ(q); let e = (ad - (lim - 0.4)) / 1.2; e = e < 0 ? 0 : e > 1 ? 1 : e; y = ty + (q[6] - ty) * e;
    if (zone === ZONE.GRAVEL) y -= 0.03;
  }
  q[8] = y; return zone;
}
// versão de conveniência (geração/testes)
function groundAt(x, z, wi) { _gq[0] = x; _gq[1] = z; _vl[3] = groundQ(wi); return _gq[8]; }
const ZMU = [1.0, 0.96, 0.56, 0.5, 0.5, 0.95, 0.95], ZDRAG = [0, 0.005, 0.07, 0.24, 0.12, 0, 0];

function vehicleReset(s, d, heading) {
  const V = VEH; trackPos(s, d, _vp);
  V.x = _vp[0]; V.z = _vp[2]; V.yaw = Math.atan2(_vp[4], _vp[3]) + (heading || 0);
  V.vx = V.vy = V.r = 0; V.steer = 0; V.rpm = VP.rpmIdle; V.gear = 1; V.ax = V.ay = 0; V.roll = V.rollV = V.pitch = V.pitchV = V.heave = V.heaveV = 0;
  V.hint = -1; V.whint.fill(-1); V.omega.fill(0); V.slip.fill(0);
  _gq[0] = V.x; _gq[1] = V.z; groundQ(-1); V.y = _gq[8]; V.gPitch = 0; V.gRoll = 0; V.lastS = V.s;
  for (let k = 0; k < 6; k++) vehicleGround(1);
  vehicleSavePrev();
}
function vehicleSavePrev() {
  const V = VEH; V.px = V.x; V.pz = V.z; V.pyaw = V.yaw; V.py = V.y; V.proll = V.roll; V.ppitch = V.pitch; V.pheave = V.heave; V.pgPitch = V.gPitch; V.pgRoll = V.gRoll; V.psteer = V.steer;
  V.pspin.set(V.spin); V.psusp.set(V.susp);
}
// amostra o chão nas 4 rodas; atualiza altura/inclinação do corpo (filtradas com fator k)
function vehicleGround(k) {
  const V = VEH, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  for (let i = 0; i < 4; i++) {
    const wx = V.x + c * WLX[i] - s * WLZ[i], wz = V.z + s * WLX[i] + c * WLZ[i];
    V.wx[i] = wx; V.wz[i] = wz; _gq[0] = wx; _gq[1] = wz; V.wzone[i] = groundQ(i); V.wy[i] = _gq[8];
  }
  const yF = (V.wy[0] + V.wy[1]) / 2, yR = (V.wy[2] + V.wy[3]) / 2, yL = (V.wy[0] + V.wy[2]) / 2, yRt = (V.wy[1] + V.wy[3]) / 2;
  const gy = (yF * VP.b + yR * VP.a) / VP.L, gp = Math.atan2(yF - yR, VP.L), gr = Math.atan2(yRt - yL, VP.tw);
  V.y += (gy - V.y) * k; V.gPitch += (gp - V.gPitch) * k; V.gRoll += (gr - V.gRoll) * k;
  _gq[0] = V.x; _gq[1] = V.z; V.zone = groundQ(-1);
}
function vehicleStep(keys) {
  const V = VEH, P = VP, dt = PHYS_DT, g = 9.81;
  vehicleSavePrev();
  // (as teclas também passam por VIN: assim thr, brk e sIn são sempre números de ponto flutuante lidos de um vetor tipado, e o
  // compilador intermediário do V8 não precisa pôr em caixa a mistura de inteiro com fração — os valores são os mesmos 0 e 1)
  if (!(keys & K_PAD)) { VIN[0] = (keys & K_W) ? 1 : 0; VIN[1] = (keys & K_S) ? 1 : 0; }
  const thr = VIN[0], brk = VIN[1], hand = (keys & K_SPACE) ? 1 : 0;
  const speed = Math.sqrt(V.vx * V.vx + V.vy * V.vy);
  // --- direção digital suavizada, com batente dependente da velocidade
  if (!(keys & K_PADS)) VIN[2] = ((keys & K_D) ? 1 : 0) - ((keys & K_A) ? 1 : 0);
  const sIn = VIN[2];
  const sMax = Math.min(P.steerMax, Math.max(0.05, Math.atan(P.L * P.steerLat / Math.max(speed * speed, 1)) * 1.25));
  // teclado: direção digital suavizada; analógico do controle: o volante segue a alavanca quase direto
  let sTgt = sIn * sMax, sRate = ((keys & K_PADS) ? 2.4 + 5 * sMax : sIn !== 0 && Math.sign(sTgt - V.steer) === sIn ? 1.15 + 1.2 * sMax : 2.6 * Math.max(0.25, sMax)) * dt;
  if (P.catchK > 0 && V.vx > 4) {
    // DB5: when the tail steps out, the front wheels turn into the slide by themselves, as a steering wheel does when the
    // driver lets it run through the hands (the speed-dependent lock above would leave no opposite lock to catch it with)
    const br = Math.atan2(V.vy - V.r * P.b, V.vx), ex = br > P.catchAt ? br - P.catchAt : br < -P.catchAt ? br + P.catchAt : 0;
    if (ex !== 0) { sTgt += ex * P.catchK; if (sTgt > P.steerMax) sTgt = P.steerMax; else if (sTgt < -P.steerMax) sTgt = -P.steerMax; if (sRate < 3 * dt) sRate = 3 * dt; }
  }
  V.steer += Math.min(sRate, Math.max(-sRate, sTgt - V.steer));
  // --- marcha, motor, ré
  let reverse = false, throttle = thr, brake = brk;
  if (V.gear === 0) { // ré engatada
    reverse = true; throttle = brk; brake = thr;
    if (thr && V.vx > -0.5) { V.gear = 1; reverse = false; throttle = thr; brake = brk; }
  } else if (brk && !thr && V.vx < 0.6) { V.gear = 0; reverse = true; throttle = brk; brake = 0; }
  const rwd = P.rwd, wheelSpd = rwd ? (V.omega[2] + V.omega[3]) * 0.5 : (V.omega[0] + V.omega[1]) * 0.5;   // speed of the driven axle
  let ratio = reverse ? -P.rev * P.final : P.gears[V.gear - 1] * P.final;
  let rpm = Math.abs(wheelSpd * ratio) * 9.5493;
  if (!reverse && !(rwd && hand)) {   // (rear-wheel drive: the handbrake locks the driven wheels; the gearbox holds its gear meanwhile)
    if (rpm > P.shiftUp && V.gear < 5) { V.gear++; }
    else if (V.gear > 1 && Math.abs(wheelSpd * P.gears[V.gear - 2] * P.final) * 9.5493 < P.shiftDn) V.gear--;
    ratio = P.gears[V.gear - 1] * P.final; rpm = Math.abs(wheelSpd * ratio) * 9.5493;
  }
  const rpmE = Math.min(P.rpmMax, Math.max(P.rpmIdle, Math.max(rpm, P.launch0 + throttle * P.launchK * Math.min(1, Math.max(0, 1 - speed / 6)))));   // embreagem patinando na saída
  V.rpm += (rpmE - V.rpm) * 0.25;
  let eT;
  if (P.eng === 2) { const ex = rpmE / 1000, ed = ex - 5; eT = 540 - (ed < 0 ? 13.5 : 60) * ed * ed - (ex > 6 ? (ex - 6) * 80 : 0); }   // = engineTorque(rpmE) of the V8, inlined
  else if (rwd) { const ex = rpmE / 1000, ed = ex - 3.85; eT = 390 - (ed < 0 ? 13.5 : 9.15) * ed * ed - (ex > 5.5 ? (ex - 5.5) * 70 : 0); }   // = engineTorque(rpmE) of the DB5, inlined
  else { const ex = rpmE / 1000, ek = (ex - 0.6) / 5.4; eT = 180 + 118 * Math.sin((ek < 0 ? 0 : ek > 1 ? 1 : ek) * PI) - (ex > 6 ? (ex - 6) * 110 : 0); }   // = engineTorque(rpmE), embutido
  let Tdrive = throttle * (eT > 0 ? eT : 0) * ratio * P.eff;                  // torque total nas rodas motrizes
  if (rpm > P.rpmCut) Tdrive = 0;
  if (reverse && V.vx < -11) Tdrive = 0;
  Tdrive -= (1 - throttle) * P.engBrake * rpmE * Math.sign(wheelSpd) * Math.abs(ratio) * 0.1;   // freio-motor
  // --- carga vertical por roda
  const W = P.m * g, dFx = P.m * V.ax * P.h / P.L, dFy = P.m * V.ay * P.h / P.tw * GAD.latK;   // (latK: V8 skis out)
  const cosg = Math.cos(V.gPitch);
  V.fz[0] = Math.max(60, (W * P.b / P.L * cosg - dFx) * 0.5 + dFy * P.rollF); V.fz[1] = Math.max(60, (W * P.b / P.L * cosg - dFx) * 0.5 - dFy * P.rollF);
  V.fz[2] = Math.max(60, (W * P.a / P.L * cosg + dFx) * 0.5 + dFy * P.rollR); V.fz[3] = Math.max(60, (W * P.a / P.L * cosg + dFx) * 0.5 - dFy * P.rollR);
  // --- forças dos pneus
  let Fx = 0, Fy = 0, Mz = 0; const cs = Math.cos(V.steer), sn = Math.sin(V.steer);
  const lw0 = Math.min(1, Math.max(0, (speed - 0.4) / 1.8));
  const lowW = (lw0 * lw0 * (3 - 2 * lw0));
  for (let i = 0; i < 4; i++) {
    const front = i < 2, driven = front !== rwd, zone = V.wzone[i];
    let mu = P.mu * ZMU[zone]; if (GAD.gripOn) mu *= gadGrip(i);   // (oil slick laid by the DB5, spiked tyres and skis of the V8: see 41_gadgets.js)
    const cap = mu * V.fz[i];
    // velocidade do ponto de contato no referencial do corpo
    const vxw = V.vx - V.r * WLZ[i], vyw = V.vy + V.r * WLX[i];
    // no referencial da roda
    const vl = front ? vxw * cs + vyw * sn : vxw, vt = front ? -vxw * sn + vyw * cs : vyw;
    // longitudinal: demanda de tração/freio limitada pelo atrito
    let fxd = 0, locked = false, spinning = false;
    if (driven) fxd += Tdrive * 0.5 / P.R;
    const bdem = brake * P.m * g * P.brakeG * (front ? P.brakeF : 1 - P.brakeF) * 0.5;
    const dirL = Math.abs(vl) > 0.25 ? Math.sign(vl) : (Math.abs(fxd) > 1 ? 0 : Math.sign(vl) * Math.abs(vl) / 0.25);
    fxd -= bdem * dirL;
    if (!front && hand) { fxd = -cap * 0.92 * dirL; locked = Math.abs(vl) > 0.3; }
    fxd -= (P.crr + ZDRAG[zone]) * V.fz[i] * dirL;
    let fx = fxd, latCap;
    if (locked) { latCap = cap * 0.34; }
    else if (Math.abs(fxd) > cap * 0.985) {
      if (driven && Math.abs(Tdrive) * 0.5 / P.R > bdem && throttle) { fx = Math.sign(fxd) * cap * 0.9; spinning = true; latCap = cap * P.spinLat; }   // patina
      else { fx = Math.sign(fxd) * cap * 0.97; latCap = cap * 0.243; }                                                             // ABS
    } else latCap = Math.sqrt(cap * cap - fx * fx);
    // lateral: Pacejka simplificado; em baixa velocidade mistura com amortecimento viscoso (estável parado)
    const alpha = Math.atan2(vt, Math.max(Math.abs(vl), 1.2));
    let fy = -cap * Math.sin(P.C * Math.atan(P.B * alpha));
    fy = fy * lowW + (1 - lowW) * (-vt * P.m * 0.25 / 0.07);
    fy = Math.min(latCap, Math.max(-latCap, fy));
    // derrapagem para efeitos
    const sl = Math.max(spinning ? 0.55 + 0.45 * Math.min(1, Math.max(0, 1 - Math.abs(vl) / 14)) : 0, locked ? Math.min(1, Math.max(0, Math.abs(vl) / 4)) : 0, Math.min(1, Math.max(0, (Math.abs(alpha) - 0.13) / 0.16)) * Math.min(1, Math.max(0, speed / 6)), (brake && Math.abs(fxd) > cap * 0.985) ? 0.35 * Math.min(1, Math.max(0, speed / 8)) : 0);
    V.slip[i] += (((zone === ZONE.ASPHALT || zone === ZONE.KERB || zone === ZONE.PIT) ? sl : sl * 0.6 + Math.min(1, Math.max(0, speed / 10)) * 0.5) - V.slip[i]) * 0.3;
    // rotação visual da roda
    let wT = vl / P.R;
    if (spinning) wT = Math.max(wT, Math.min(rpmE / 9.5493 / Math.abs(ratio), wT + 34)) * Math.sign(ratio);
    if (locked) wT = 0;
    V.omega[i] += (wT - V.omega[i]) * (locked ? 0.5 : 0.35);
    V.spin[i] += V.omega[i] * dt;
    // para o referencial do corpo
    const fbx = front ? fx * cs - fy * sn : fx, fby = front ? fx * sn + fy * cs : fy;
    Fx += fbx; Fy += fby; Mz += WLX[i] * fby - WLZ[i] * fbx;
  }
  // arrasto, gravidade nas rampas
  Fx -= 0.5 * 1.2 * P.cdA * V.vx * Math.abs(V.vx);
  if (GAD.forceOn) Fx += GAD.thrust - GAD.dragA * V.vx * Math.abs(V.vx);   // V8: rocket booster, drag of the skis
  Fx -= P.m * g * Math.sin(V.gPitch); Fy -= P.m * g * Math.sin(V.gRoll);
  // integra (referencial do corpo girante)
  const axb = Fx / P.m, ayb = Fy / P.m;
  V.vx += (axb + V.r * V.vy) * dt; V.vy += (ayb - V.r * V.vx) * dt; V.r += Mz / P.Izz * dt;
  if (speed < 0.25 && !throttle && Math.abs(Tdrive) < 30) { V.vx *= 0.9; V.vy *= 0.8; V.r *= 0.8; }
  V.ax += (axb - V.ax) * 0.18; V.ay += (ayb - V.ay) * 0.18;
  const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  V.x += (V.vx * c - V.vy * s) * dt; V.z += (V.vx * s + V.vy * c) * dt; V.yaw += V.r * dt;
  // chão e colisão
  vehicleGround(0.35);
  vehicleCollide();
  // movimento da carroceria sobre a suspensão: rolagem nas curvas, mergulho na freada, agachamento na arrancada
  const kR = P.kR, cR = P.cR; const rollT = Math.min(P.rollMax, Math.max(-P.rollMax, V.ay * P.rollK * GAD.rollKf)), pitchT = Math.min(P.pitchMax, Math.max(-P.pitchMax, -V.ax * (V.ax < 0 ? P.diveK : P.squatK)));
  V.rollV += ((rollT - V.roll) * kR - V.rollV * cR) * dt; V.roll += V.rollV * dt;
  V.pitchV += ((pitchT - V.pitch) * kR * 1.15 - V.pitchV * cR) * dt; V.pitch += V.pitchV * dt;
  // vibração nas zebras / fora da pista
  let rough = 0; for (let i = 0; i < 4; i++) rough += V.wzone[i] === ZONE.KERB ? 0.5 : (V.wzone[i] === ZONE.GRAVEL || V.wzone[i] === ZONE.ROUGH || V.wzone[i] === ZONE.GRASS) ? 1 : 0;
  const hT = rough > 0 ? Math.sin(V.time * 61) * 0.004 * rough * Math.min(1, Math.max(0, speed / 8)) : 0;
  V.heaveV += ((hT - V.heave) * 220 - V.heaveV * 14) * dt; V.heave += V.heaveV * dt;
  // estatísticas da volta
  V.ctl[0] = throttle; V.ctl[1] = brake;
  V.time += dt; V.steps++;
  let ds = V.s - V.lastS; if (ds < -TRK.L / 2) { ds += TRK.L; V.laps++; } else if (ds > TRK.L / 2) { ds -= TRK.L; V.laps--; }
  V.lapS += ds; V.lastS = V.s;
  let off = 0; for (let i = 0; i < 4; i++) if (V.wzone[i] !== ZONE.ASPHALT && V.wzone[i] !== ZONE.KERB && V.wzone[i] !== ZONE.PIT) off++;
  if (off > 0) V.offCount++;
}
// colisão com as barreiras laterais: testa os 4 cantos, empurra de volta e reflete a velocidade
function vehicleCollide() {
  if (TOWN.on) { townCollide(); return; }   // Weston-super-Mare: buildings, the sea and the edge of the map
  const V = VEH, P = VP, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
  for (let k = 0; k < 4; k++) {
    const lx = k < 2 ? P.front : -P.rear, lz = (k & 1) ? P.halfW : -P.halfW;
    const cx = V.x + c * lx - s * lz, cz = V.z + s * lx + c * lz;
    _gq[0] = cx; _gq[1] = cz; trackLocateQ(V.hint, _gq);
    const d = _gq[3], i0 = _gq[4] | 0, f = _gq[5], i1 = (i0 + 1) % TRK.N, bar = d < 0 ? TRK.barL : TRK.barR, lim = bar[i0] + (bar[i1] - bar[i0]) * f - 0.25, pen = (d < 0 ? -d : d) - lim;
    if (pen > 0 && pen < 6) {
      // normal da barreira (aponta para a pista) = -sinal(d) * normal lateral da pista
      const tx = TRK.tx[i0] + (TRK.tx[i1] - TRK.tx[i0]) * f, tz = TRK.tz[i0] + (TRK.tz[i1] - TRK.tz[i0]) * f, sg = d < 0 ? 1 : -1, nx = -tz * sg, nz = tx * sg;
      V.x += nx * pen; V.z += nz * pen;
      // velocidade do mundo
      let wvx = V.vx * c - V.vy * s, wvz = V.vx * s + V.vy * c; const vn = wvx * nx + wvz * nz;
      if (vn < 0) {
        wvx -= nx * vn * 1.25; wvz -= nz * vn * 1.25; const tgx = -nz, tgz = nx, vt = wvx * tgx + wvz * tgz; wvx -= tgx * vt * 0.12; wvz -= tgz * vt * 0.12;
        V.vx = wvx * c + wvz * s; V.vy = -wvx * s + wvz * c;
        // torque de guinada pelo impacto no canto
        const rx = c * lx - s * lz, rz = s * lx + c * lz; V.r += (rx * nz - rz * nx) * (-vn) * 0.35; V.r *= 0.85; V.hits++;
      }
    }
  }
}
