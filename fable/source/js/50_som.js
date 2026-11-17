// Som: tudo sintetizado na hora, sem amostra gravada. O núcleo (sndCore) é JavaScript puro e determinístico: o mesmo
// código roda dentro de um AudioWorklet (jogo em tempo real) e fora do tempo real (trilha do vídeo e testes), sempre a
// partir de 16 controles inteiros tirados da simulação (sndControl). Nenhuma alocação por bloco de áudio nem por quadro.
//
// Controls (integers; in the game they travel as k-rate AudioParams, one number per audio block):
//  0 bits: 1 = game running (0 = paused: the output fades out and the state freezes), 2 = mute,
//          4/8 = camera (0 chase, 1 bonnet, 2 trackside TV, 3 cockpit — DB5 only), 16 = the car is the Aston Martin DB5 (0 = Fiat Uno)
//  1 engine speed (rpm)   2 throttle ×1000   3 gear (0 = reverse)   4 car speed (cm/s)
//  5/6 tyre slip left/right ×1000   7 wheels on grass/gravel ×1000   8 wheels on the kerb ×1000
//  9 distance from the listener to the car (dm)   10 Doppler factor ×10000   11 listener speed (cm/s)
//  12 grandstand proximity ×1000   13 grandstand side ×1000 (-1000 left .. 1000 right)   14 crash counter
//  15 DB5 gadgets (always 0 with the Uno):
//       bits 0-4   flags, held while the gadget works: 1 machine guns, 2 smoke screen, 4 oil spray, 8 a mechanism is
//                  moving (servo motor), 16 horn
//       bits 5-9   ejector-seat counter, modulo 32: every step fires one bang + roof panel + whoosh
//       bits 10-15 end-stop counter, modulo 64: every step fires one metallic clunk
//     The counters are latched without firing on the first block and on the first block after a pause or a mute; a
//     jump of more than 3 (seat) or 7 (end stops) is taken as a discontinuity and fires nothing.
// Layers (mix[i]): 0 engine (DB5: with starter, gear whine and overrun pops), 1 tyres (squeal), 2 wind, 3 road (surface,
// kerb, gravel, crash), 4 ambience (forest, birds), 5 crowd, 6 DB5 gadgets.
// Levels: VOL is the master volume, applied at the output, after the limiter (timbre and dynamics do not change with
// it); AMB is the extra gain of the ambience layers (forest, birds and crowd) relative to the rest. Both cars share them.
//
// The two cars: with bit 16 of control 0 clear, the synthesiser is the Fiat Uno's and its output is, sample for sample,
// what it was before the DB5 existed — every DB5 addition below sits behind that bit. With the bit set, the engine is
// engDB5() (straight six), the tyres, wind and road reuse the Uno's layers with other constants, the cockpit camera
// filters the car as heard from inside the cabin, and gadDB5() adds the gadget sounds to the car bus, so they get the
// same distance, Doppler and camera treatment as the car they are bolted to.
function sndCore(sr) {
  const VOL = 0.4, AMB = 0.5;
  const NC = 32, PI = Math.PI, NPH = 40, PH0 = 128, ctl = new Float32Array(16), st = new Float64Array(PH0 + NPH * 22), F = new Float64Array(288), Z = new Float64Array(192);
  const RS = new Int32Array(4), BI = new Int32Array(6), PHN = new Int32Array(NPH), mix = new Float32Array(7).fill(1);
  const mk = () => new Float32Array(NC);
  const wA = mk(), wB = mk(), ex = mk(), ni = mk(), tk = mk(), eg = mk(), cb = mk(), sL = mk(), sR = mk(), t1 = mk(), t2 = mk(), oL = mk(), oR = mk();
  const L2 = mk(), R2 = mk(), L4 = mk(), R4 = mk(), L5 = mk(), R5 = mk();   // barramentos estéreo: vento, ambiente, público
  const CG = new Float64Array([1, 0.8, 0.92, 0.74]);  // cilindros desiguais: dão as meias-ordens (o "ronco" de quatro cilindros)
  // ganhos dos ressonadores do motor por câmera: [direto, 105, 235, 470, 980, 2100 Hz, admissão, tuchos]
  // (a quarta linha, câmera 3, só existe para o Uno nunca ler fora da tabela: repete a do capô)
  const VG = new Float64Array([0.45, 1.0, 0.85, 0.6, 0.46, 0.26, 0.34, 0.06, 0.4, 0.55, 0.7, 0.85, 0.7, 0.42, 0.7, 0.3, 0.45, 0.8, 0.8, 0.7, 0.55, 0.32, 0.4, 0.1, 0.4, 0.55, 0.7, 0.85, 0.7, 0.42, 0.7, 0.3]);
  const kc = t => 1 - Math.exp(-NC / (sr * t)), K8 = kc(0.008), K20 = kc(0.02), K50 = kc(0.05), K200 = kc(0.2), K30 = kc(0.03);
  const fset = (k, hz, Q, g) => { F[3 * k] = 2 * Math.sin(PI * Math.min(hz, sr * 0.16) / sr); F[3 * k + 1] = 1 / Q; F[3 * k + 2] = g; };
  // filtros fixos
  fset(0, 22, 0.7, 1); fset(1, 105, 2.2, 1); fset(2, 235, 3, 1); fset(3, 470, 3.5, 1); fset(4, 980, 3, 1); fset(5, 2100, 2.5, 1); fset(6, 1400, 1.1, 1); fset(7, 3400, 0.8, 1);
  fset(8, 1900, 1.4, 1); fset(9, 1900, 1.4, 1);      // raspado do pneu E/D
  fset(10, 300, 0.7, 1); fset(11, 300, 0.7, 1);       // vento E/D (frequência varia)
  fset(12, 200, 0.7, 1);                              // rodagem (varia)
  fset(13, 650, 0.8, 1); fset(14, 2600, 1.6, 1);      // grama/brita: corpo e estalos
  fset(15, 82, 5, 1); fset(16, 310, 2.2, 1);          // zebra
  fset(17, 190, 1.2, 1); fset(18, 1300, 1.5, 1);      // batida
  fset(19, 3100, 0.6, 1); fset(20, 3600, 0.6, 1);     // folhagem E/D
  fset(21, 5200, 22, 1); fset(22, 6300, 26, 1);       // cigarras
  fset(23, 540, 2.4, 1); fset(24, 1150, 3, 0.8); fset(25, 2500, 3, 0.35); fset(26, 600, 2.4, 1); fset(27, 1250, 3, 0.8); fset(28, 2700, 3, 0.35);   // público E/D (formantes de voz)
  fset(29, 1750, 1.1, 1);                             // palmas
  fset(30, 8000, 0.7, 1); fset(31, 8000, 0.7, 1);     // absorção do ar com a distância (varia)
  fset(32, 90, 3, 1);                                 // tranco da troca de marcha
  fset(33, 20, 0.7, 1);                               // tira o nível contínuo que a saturação do motor cria
  // índices do estado
  const MG = 0, RP = 1, LD = 2, FP = 3, AMP = 4, CYL = 5, GP = 6, SHT = 7, DG = 8, DP = 9, SPD = 10, SQ = 11, SQP = 13, SQJ = 15, LSP = 17, GUST = 18, LOO = 19, KRB = 20, KPH = 21,
    CRW = 22, CPN = 23, HIT = 24, HITE = 25, CLK = 26, TM = 27, CRE = 28, VGS = 32, NEXT = 40, BV = 44, FOL = 41, SQA = 100, SQW = 102;
  // ==== Aston Martin DB5: buffers, tables, filters and state. Nothing below is read or written by the Uno's sound.
  const xS = mk(), xI = mk(), xN = mk(), xB = mk(), xH = mk(), xP = mk(), eS = mk(), gL = mk(), gR = mk(), wC = mk(), t3 = mk(), t4 = mk(), u1 = mk(), u2 = mk(), u3 = mk(), u4 = mk(), u5 = mk(), u6 = mk();
  const D = new Float64Array(80), GI = new Int32Array(16), EN = Math.ceil(sr * 0.2) + NC, ED = Math.round(sr * 0.163), EB = new Float32Array(EN);   // EB: echo line of the guns
  // Straight six, firing order 1-5-3-6-2-4, one firing every 120° of crank. Gains per firing, in that order: BG narrow exhaust
  // pulse, BB low-order body of the exhaust wave, IG induction pulse (three carburettors, two cylinders each). Even firings
  // go down the front three-branch manifold (cylinders 1-2-3) and its pipe, odd ones down the rear one (4-5-6): each pipe
  // carries a 1.5-order train, half a period out of step with the other. The two pipes run side by side to the left rear
  // and are nearly alike, so in their sum the half orders all but cancel: an even-firing six is smooth, and what is heard
  // is the 3rd-order firing line and its multiples, with only a trace of the 1.5-order line under it (BH).
  const BG = new Float64Array([1, 0.8, 0.96, 0.83, 0.98, 0.78]), BB = new Float64Array([1, 0.86, 0.97, 0.88, 0.98, 0.84]), IG = new Float64Array([1, 0.74, 0.86, 0.78, 0.95, 0.9]), BH = 0.5;
  // whine of the ZF five-speed box by gear (0 = reverse, 4 = direct drive): mesh order per engine revolution, level
  const WGO = new Float64Array([17.3, 8.4, 12.7, 15.6, 23, 19.8]), WGA = new Float64Array([2.2, 1, 0.9, 0.8, 0.3, 0.7]);
  // engine gains per camera (rows: chase, bonnet, TV, cockpit): [0 exhaust pulses direct, 1-6 exhaust resonances at
  // 72/128/235/410/760/1350 Hz, 7 rasp, 8 induction tone, 9 induction air, 10 valve gear, 11 gearbox and axle whine,
  // 12 stereo spread of the twin pipes, 13 gear lever and starter, 14 low-order body]
  const NV = 15, DV = new Float64Array([
    0.4, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 2.5, 0.2, 0.12, 0.04, 0.3, 0.14, 0.5, 0.25,
    0.25, 0.4, 0.45, 0.5, 0.5, 0.5, 0.45, 1.0, 1.0, 0.8, 0.35, 0.55, 0.05, 0.8, 0.16,
    0.4, 0.7, 0.85, 0.9, 0.9, 1.0, 1.1, 2.5, 0.3, 0.16, 0.05, 0.22, 0, 0.4, 0.22,
    0.2, 0.65, 0.55, 0.5, 0.4, 0.35, 0.25, 0.6, 0.85, 0.4, 0.08, 1.0, 0.06, 1.0, 0.19]);
  const GE = 0.19;                                     // engine level (the Uno's is 0.4), set so the DB5 is no louder than the Uno
  const dcy = t => Math.exp(-1 / (sr * t)), K60 = kc(0.06), K130 = kc(0.13), K220 = kc(0.22), K280 = kc(0.28), K300 = kc(0.3);
  fset(34, 1250, 1.2, 1); fset(35, 1250, 1.2, 1);     // tyre scrub L/R (cross-ply: lower than the Uno's)
  fset(36, 22, 0.7, 1);                               // engine: takes the DC out of the pulse train
  fset(37, 72, 2.4, 1); fset(38, 128, 2.6, 1); fset(39, 235, 3, 1); fset(40, 410, 3, 1); fset(41, 760, 2.8, 1); fset(42, 1350, 2.4, 1);   // exhaust resonances
  fset(43, 2600, 1.3, 1);                             // rasp
  fset(44, 300, 0.8, 1);                              // difference between the two pipes (stereo)
  fset(45, 285, 3.2, 1); fset(46, 700, 2.6, 1);       // induction tone: resonances of the intake tracts
  fset(47, 600, 0.8, 1); fset(48, 2300, 0.9, 1);      // induction air: roar and hiss of the three SUs
  fset(49, 3200, 0.8, 1);                             // valve gear
  fset(50, 85, 3, 1); fset(51, 1300, 5, 1);           // gear change: thump and lever clack
  fset(52, 20, 0.7, 1);                               // DC left by the saturation
  fset(53, 1150, 1.8, 1);                             // starter motor
  fset(54, 62, 3.2, 1); fset(55, 100, 0.8, 1);         // cabin boom (cockpit camera): a resonance and a broad lift of the lows
  fset(56, 3800, 0.8, 1); fset(57, 4300, 0.8, 1);     // wind hiss around the window frames L/R (cockpit camera)
  fset(58, 1700, 0.9, 1); fset(59, 100, 2.4, 1); fset(60, 900, 0.9, 1); fset(61, 2300, 5, 1); fset(62, 3650, 7, 1);   // guns: crack, thump, bark, clatter of the action
  fset(63, 850, 0.7, 1); fset(64, 1000, 0.7, 1); fset(65, 2000, 0.7, 1);    // guns: reverberant tail L/R, echo
  fset(66, 2000, 0.9, 1); fset(67, 4200, 0.8, 1); fset(68, 360, 0.8, 1);    // smoke screen: hiss (moves with the pressure), air, whoosh
  fset(69, 520, 1.1, 1); fset(70, 1300, 1.5, 1); fset(71, 180, 2, 1);       // oil spray: body, spray, glug
  fset(72, 1750, 4.5, 1);                                                   // servo: gear train of the little motor
  fset(73, 128, 3, 1); fset(74, 640, 10, 1); fset(75, 1530, 14, 1); fset(76, 2780, 17, 1);     // end-stop clunk: thud and metal
  fset(77, 1400, 0.8, 1); fset(78, 70, 2, 1); fset(79, 310, 1.3, 1); fset(80, 3000, 0.9, 1);   // ejector seat: crack, thump, body, pneumatic hiss
  fset(81, 1150, 11, 1); fset(82, 2080, 14, 1); fset(83, 3350, 16, 1);      // ejector seat: roof panel (move as it tears)
  fset(84, 800, 1.4, 1); fset(85, 900, 1.4, 1);                             // ejector seat: whoosh L/R (moves)
  fset(86, 1900, 1.5, 1); fset(87, 3150, 2, 1); fset(88, 150, 0.7, 1);      // horn: resonances of the trumpets, DC
  fset(89, 520, 0.8, 1);                              // engine: breath of the exhaust (idle and overrun)
  // state: D (numbers) and GI (integers)
  const XFP = 0, XAM = 1, XAI = 2, XSG = 3, XPW = 4, XPC = 5, XAB = 6, XOV = 7, XOS = 8, XHU = 9, XWA = 10, XW1 = 11, XW2 = 12, XW3 = 13, XST = 14, XFL = 15, XSR = 16, XSA = 17, XSP = 18,
    XCB = 19, XSL = 20, XAH = 21, XVS = 24, GPH = 40, GEC = 41, GET = 42, GEK = 43, GTS = 44, GTL = 45, GAC = 46, GJT = 47, GAM = 48, QSE = 50, QSG = 51, QOE = 52, QOS = 53, QOT = 54, QOC = 55,
    QVE = 56, QVP = 57, QVW = 58, QCE = 59, QCT = 60, QCA = 61, QJT = 62, QJW = 63, QJB = 64, QJ2 = 65, QHE = 66, QH1 = 67, QH2 = 68, QJK = 69,
    ICY = 0, IST = 1, ILA = 2, IEJ = 3, IES = 4, IJQ = 5, ISQ = 6, IJA = 7, ISD = 8, ION = 9, IEW = 10, IBS = 11;
  // decays per sample and times in samples of the gadget voices
  const PCD = dcy(0.011), GDC = dcy(0.0011), GDT = dcy(0.004), GDK = dcy(0.0016), GDL = dcy(0.2), GC1 = Math.round(0.013 * sr), GC2 = Math.round(0.029 * sr), GAH = 1.4 * sr,
    OSK = 1 - dcy(0.004), CDC = dcy(0.0012), JDB = dcy(0.007), JD2 = dcy(0.014), JC1 = Math.round(0.19 * sr), JC2 = Math.round(0.33 * sr);
  // estado inicial (também usado para zerar o sintetizador depois do aquecimento)
  function reset() {
    st.fill(0, 0, PH0); Z.fill(0); BI.fill(0); ctl.fill(0); RS[0] = 0x2F6E2B1; RS[1] = 0x1B873593; st[RP] = 900; st[DG] = 1; st[DP] = 1; st[GP] = 1; st[NEXT] = sr * 0.7; for (let k = 0; k < 8; k++) st[VGS + k] = VG[k];
    D.fill(0); GI.fill(0); EB.fill(0); RS[2] = 0x5DEECE6; RS[3] = 0x2545F49; D[XSL] = 0.04; D[GPH] = 1; for (let k = 0; k < NV; k++) D[XVS + k] = DV[k];
  }
  reset();
  function noise(o) { let x = RS[0]; for (let i = 0; i < NC; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o[i] = x * 4.656612873e-10; } RS[0] = x; }
  // the gadgets' own noise and random numbers (RS[2], RS[3]): a gadget at work does not disturb the sequences of the rest
  function noise2(o) { let x = RS[2]; for (let i = 0; i < NC; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o[i] = x * 4.656612873e-10; } RS[2] = x; }
  function rndG() { let x = RS[3]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; RS[3] = x; return (x >>> 8) & 0xffff; }
  function rnd16() { let x = RS[1]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; RS[1] = x; return (x >>> 8) & 0xffff; }
  // filtro de estado variável em bloco. modo 0 passa-baixa, 1 passa-banda (pico unitário), 2 passa-alta; acc soma em y
  function svf(x, y, m, k, mode, acc) {
    const f = F[3 * k], q = F[3 * k + 1], g = F[3 * k + 2]; let lo = Z[2 * k], bd = Z[2 * k + 1];
    for (let i = 0; i < m; i++) {
      lo += f * bd + 1e-18; const hi = x[i] - lo - q * bd; bd += f * hi;
      const o = (mode === 0 ? lo : mode === 1 ? bd * q : hi) * g;
      if (acc) y[i] += o; else y[i] = o;
    }
    Z[2 * k] = lo; Z[2 * k + 1] = bd;
  }
  // Pássaros: 40 frases calculadas uma vez — até 4 notas de [duração, f0, f1, pausa, vibrato] + volume e posição no estéreo:
  // assobios que deslizam, o bem-te-vi de três notas, trinados. Três vozes sorteiam frases. O disparo de uma nota é código
  // raro (nunca chega a ser otimizado), por isso só usa inteiros e cópias dentro do vetor de estado: assim não aloca nada.
  {
    let q = 20261116; const r = () => (q = (q * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let p = 0; p < NPH; p++) {
      const o = PH0 + p * 22, ty = p % 5 === 0 ? 1 : p % 5 === 1 ? 2 : 0, base = 2300 + 2400 * r(), tr = 0.95 + 0.1 * r(); st[o] = 0.009 + 0.03 * r(); st[o + 1] = r();
      const N = [[0.11, 2350 * tr, 2550 * tr, 0.035, 0], [0.09, 3050 * tr, 2900 * tr, 0.035, 0], [0.27, 2750 * tr, 2050 * tr, 0.035, 0]];
      PHN[p] = ty === 1 ? 3 : ty === 2 ? 1 : 1 + Math.floor(r() * 4);
      for (let k = 0; k < PHN[p]; k++) {
        const f0 = base * (0.92 + 0.16 * r()), n = ty === 1 ? N[k] : ty === 2 ? [0.3 + 0.35 * r(), 3200 + 1700 * r(), 0, 0.3, 380] : [0.07 + 0.14 * r(), f0, f0 * (0.72 + 0.5 * r()), 0.05 + 0.12 * r(), 0];
        if (ty === 2) n[2] = n[1] * 0.96; st.set([n[0] * sr, n[1], n[2], n[3] * sr, n[4]], o + 2 + k * 5);
      }
    }
  }
  // voz v (10 números em st a partir de BV + 10 v): [0] tempo na nota, [1..5] a nota, [6] fase, [8] volume, [9] posição
  function birdNote(v) { const b = BV + v * 10, p = BI[v * 2 + 1]; st.copyWithin(b + 1, p, p + 5); st[b] = 0; BI[v * 2 + 1] = p + 5; }
  function birdStart() {
    for (let v = 0; v < 3; v++) {
      if (BI[v * 2] > 0) continue;
      const p = rnd16() % NPH, o = PH0 + p * 22, b = BV + v * 10; BI[v * 2] = PHN[p]; BI[v * 2 + 1] = o + 2; st.copyWithin(b + 8, o, o + 2); birdNote(v); return;
    }
  }
  // ---- DB5 engine: 3,995 cm³ twin-cam straight six, three SU HD8 carburettors, two three-branch manifolds into twin pipes.
  // Writes the engine bus eg (mono) and eS (what differs between the two pipes: added to one side, subtracted from the other).
  // Every firing (rpm / 20 per second) gives: a narrow exhaust pulse of fixed duration, as in the Uno, that rings the fixed
  // resonances of the exhaust (the pulse gets shorter, and the upper resonances open up, with load: brighter as it gets
  // louder — brassy, not buzzy); one cycle of a smooth wave, the low orders of the long blow-down, which carries the
  // 3rd-order firing line (the trace of the 1.5-order line is added after the saturation); a soft induction pulse and the air noise it
  // draws through the carburettors (the roar on wide throttle); two ticks of the valve gear. Above 3,300 rpm a
  // noise-broken copy of the pulses feeds a band at 2.6 kHz and the saturation is driven harder: the rasp. At idle the
  // firings are uneven and some are weak; on the overrun at high revs they turn irregular (burble) and now and then one
  // goes off in the pipe (pop). Gearbox and axle whine are added clean, after the saturation.
  function engDB5(m, view) {
    const dp = st[DP], dg = st[DG], thr = ctl[2] * 0.001, spd = st[SPD], fp0 = D[XFP];
    let rp = st[RP], ld = st[LD], sph = GI[IST], crk = 0, asc = 1;
    for (let k = 0; k < NV; k++) D[XVS + k] += (DV[view * NV + k] - D[XVS + k]) * K20;
    // starter: if the synthesiser starts running with the car at rest and the engine idling, the starter motor cranks for
    // 0.46 s, then the engine catches and flares; touching the throttle or moving off cuts the cranking short. (In the game
    // the first blocks may come before the first controls: the engine waits, silent, for a speed that is not zero.)
    if (sph === 0) {
      if (ctl[1] === 0) { eg.fill(0); eS.fill(0); return; }
      sph = ctl[4] < 50 && ctl[1] < 1500 && thr < 0.1 ? 1 : 3; GI[IST] = sph; if (sph === 1) { st[CLK] = 0.7; D[XSA] = 1; }
    }
    if (sph === 1) {
      const t = D[XST] += m;
      if (t > 0.46 * sr || thr > 0.1 || ctl[4] > 50) { sph = 2; GI[IST] = 2; D[XFL] = 1; D[XSR] = 210; }
      else { crk = 1; rp = 195; ld = 0; const q = t / (0.46 * sr); asc = 0.5 + (q > 0.6 ? (q - 0.6) * 3 : 0); }
    }
    if (sph === 2) {
      const f = D[XFL] *= 1 - K280; rp = D[XSR] += (rp + 900 * f - D[XSR]) * K60; if (ld < 0.85 * f) ld = 0.85 * f;
      if (f < 0.02) GI[IST] = 3;
    }
    // operating point: idle (uneven, hunting), overrun (fast and slow), rasp
    const idl = rp < 1900 ? (rp > 750 ? (1900 - rp) / 1150 : 1) : 0, hn = D[XHU] += (rnd16() / 32768 - 1 - D[XHU]) * 0.004;
    const ov = D[XOV] += ((ld < 0.1 ? 1 - ld * 10 : 0) * (rp > 2400 ? (rp < 4400 ? (rp - 2400) / 2000 : 1) : 0) - D[XOV]) * K50, ovs = D[XOS] += (ov - D[XOS]) * K300;
    let rs = rp > 3300 ? (rp < 5700 ? (rp - 3300) / 2400 : 1) : 0; rs = rs * rs * (3 - 2 * rs) * (0.3 + 0.7 * ld);
    const fc = rp * (1 + 1.2 * idl * hn) / 20 * dp / sr, ifc = 1 / fc; let tp = (0.0044 - 0.0034 * ld) * (1 - 0.3 * rs) * sr; if (tp > 0.68 * ifc) tp = 0.68 * ifc;
    const itp = 1 / tp, itk = 1 / (0.0006 * sr), jit = 0.05 + 0.4 * idl * (1 - ld) + 0.5 * ov, misT = (0.07 * idl * (1 - ld) + 0.4 * ov) * 65536, popT = 65536 - ovs * ov * rp * 0.13,
      rg = 0.9 * rs + 0.12 * ld, nI = 0.1 + 0.2 * ld, nz = 0.9 * idl * (1 - ld) + 0.45 * ov + 0.05;
    let fp = fp0, amp = D[XAM], ab = D[XAB], ah = D[XAH], ai = D[XAI], sg = D[XSG], pw = D[XPW], pc = D[XPC], cyl = GI[ICY];
    for (let i = 0; i < m; i++) {
      fp += fc;
      if (fp >= 1) {
        fp -= 1; cyl = cyl === 5 ? 0 : cyl + 1;
        const r1 = rnd16(), r2 = rnd16(), j = (1 + jit * (r1 / 32768 - 1)) * asc;
        amp = BG[cyl] * j; ab = BB[cyl] * j; ai = IG[cyl] * (0.5 + 0.5 * j); sg = cyl & 1 ? -1 : 1; ah = BH * j * sg; pw = cyl & 1 ? 0.8 : 1;
        if (r2 < misT) { amp *= 0.25; ab *= 0.4; } else if (r2 >= popT) { amp = 5 + (r1 & 255) * 0.016; ab = amp * 0.3; pw = 2.3; pc = 1; }   // weak firing; pop
      }
      let u = fp * ifc * itp * pw, p = 0; if (u < 1) { const v = 1 - u; p = u * u * v * v * v * 28.9 * amp; }
      const n = wB[i], w = 4 * fp * (1 - fp), w3 = w * w * w, q = w3 * w3 * ai;
      ex[i] = p; xS[i] = p * sg; t3[i] = p * n * nz; xI[i] = q; ni[i] = wA[i] * (nI + q); xN[i] = p * (0.5 + n) * rg + n * pc; xP[i] = pc; pc *= PCD;
      xB[i] = (fp < 0.5 ? fp * (0.5 - fp) : (fp - 0.5) * (fp - 1)) * 16 * ab; xH[i] = w * ah;
      u = (fp < 0.5 ? fp : fp - 0.5) * ifc * itk; tk[i] = u < 1 ? n * (1 - u) : 0;
    }
    D[XFP] = fp; D[XAM] = amp; D[XAB] = ab; D[XAH] = ah; D[XAI] = ai; D[XSG] = sg; D[XPW] = pw; D[XPC] = pc < 1e-6 ? 0 : pc; GI[ICY] = cyl;
    svf(ex, t1, m, 36, 2, 0);
    const g0 = D[XVS], gb = D[XVS + 14] * (1 + 0.45 * idl), br = 0.3 + 0.7 * ld;
    for (let i = 0; i < m; i++) eg[i] = t1[i] * g0 + xB[i] * gb;
    for (let k = 0; k < 6; k++) { F[3 * k + 113] = D[XVS + 1 + k] * (k < 3 ? 1 : k === 3 ? 0.55 + 0.45 * ld : k === 4 ? br : br * (0.55 + 0.45 * rp / 6000)); svf(t1, eg, m, 37 + k, 1, 1); }
    F[131] = D[XVS + 7]; svf(xN, eg, m, 43, 1, 1);                                              // rasp, and the crackle after a pop
    F[269] = g0 * 3; svf(t3, eg, m, 89, 1, 1);                                                  // breath: every pulse carries some flow noise when the throttle is shut
    const ig = D[XVS + 8] * (0.03 + ld * (0.17 + 0.8 * ld)), ia = D[XVS + 9] * (0.05 + ld * (0.2 + 0.75 * ld));
    F[137] = ig; F[140] = ig * 0.75; svf(xI, eg, m, 45, 1, 1); svf(xI, eg, m, 46, 1, 1);        // induction tone
    F[143] = ia * 0.7; F[146] = ia * 0.35; svf(ni, eg, m, 47, 1, 1); svf(ni, eg, m, 48, 1, 1);  // induction roar and hiss
    F[149] = D[XVS + 10] * (0.45 + rp / 6000); svf(tk, eg, m, 49, 2, 1);                        // valve gear
    // gear change: thump of the driveline and clack of the lever (the torque interruption itself is in the load, see chunk)
    let clk = st[CLK]; if (clk > 1e-4) { for (let i = 0; i < m; i++) { t2[i] = wB[i] * clk * clk; clk *= 0.9992; } st[CLK] = clk * (clk < 0.02 ? 0 : 1); F[152] = 1.5; svf(t2, eg, m, 50, 1, 1); F[155] = D[XVS + 13] * 0.5; svf(t2, eg, m, 51, 1, 1); }
    // saturation: more harmonics with load, harder edge with the rasp; the level follows throttle and revs
    const drv = 1.3 + 2.3 * ld + 1.5 * rs, lv = (0.26 + 0.74 * Math.pow(ld, 0.8)) * (0.42 + 0.58 * rp / 6000) * (1 + 1.2 * idl * (1 - ld)) * dg * GE, ev = lv / (drv / (1 + drv * 0.5)), bs = 0.12 * rs, hg = D[XVS + 14] * lv * 0.7 * (1 - 0.8 * idl);
    for (let i = 0; i < m; i++) { const x = (eg[i] + bs) * drv; eg[i] = x / (1 + (x < 0 ? -x : x) * 0.5) * ev * (1 + 1.5 * xP[i]) + xH[i] * hg; }   // (a pop is as loud as a firing on full throttle, whatever the throttle)
    svf(eg, eg, m, 52, 2, 0);
    F[134] = D[XVS + 12] * lv * 1.6; svf(xS, eS, m, 44, 1, 0);
    // gearbox whine (mesh of the gear in use and of the constant-mesh pair, both with the engine) and axle whine (with the road speed)
    const g5 = ctl[3] < 0 ? 0 : ctl[3] > 5 ? 5 : ctl[3] | 0, wa0 = D[XWA], wa1 = wa0 + (D[XVS + 11] * (0.25 + 0.55 * ld + 0.5 * ov) * (spd < 6 ? spd / 6 : 1) * WGA[g5] * dg * 0.02 - wa0) * K20;
    D[XWA] = wa1;
    if (wa1 > 1e-5) {
      const f1 = rp * WGO[g5] * dp / (60 * sr), f2 = rp * 23 * dp / (60 * sr), f3 = spd * 23.3 * dp / sr, a2 = g5 === 4 ? 0 : 0.45, da = (wa1 - wa0) / m;
      let p1 = D[XW1], p2 = D[XW2], p3 = D[XW3];
      for (let i = 0; i < m; i++) {
        p1 += f1; if (p1 >= 1) p1 -= 1; p2 += f2; if (p2 >= 1) p2 -= 1; p3 += f3; if (p3 >= 1) p3 -= 1;
        eg[i] += (Math.sin(6.283185307 * p1) + a2 * Math.sin(6.283185307 * p2) + 0.5 * Math.sin(6.283185307 * p3)) * (wa0 + da * (i + 1));
      }
      D[XW1] = p1; D[XW2] = p2; D[XW3] = p3;
    }
    // starter motor: whirr of the pinion on the ring gear, slowed by each compression while cranking; spins down once the engine runs
    let sa = D[XSA];
    if (sa > 1e-4) {
      if (!crk) { sa *= 1 - K50; D[XSA] = sa < 1e-4 ? 0 : sa; }
      const fb = 380 * (crk ? 1 : 0.3 + 0.7 * sa) * dp / sr, ga = sa * D[XVS + 13] * dg * 0.07;
      let p = D[XSP], q = fp0;
      for (let i = 0; i < m; i++) {
        q += fc; if (q >= 1) q -= 1; const b = 4 * q * (1 - q), w = crk ? 0.86 + 0.14 * b : 1;
        p += fb * w; if (p >= 1) p -= 1; let u = p * 3.2, a = 0; if (u < 1) { const v = 1 - u; a = u * u * v * v * v * 28.9; }
        t2[i] = (a - 0.15 + wA[i] * 0.12) * (crk ? 1.45 - 0.9 * b : 1);
      }
      D[XSP] = p; F[161] = ga * 2; svf(t2, eg, m, 53, 1, 1); for (let i = 0; i < m; i++) eg[i] += t2[i] * ga * 0.5;
    }
  }
  // ---- DB5 gadgets (control 15) → stereo bus gL/gR, which chunk adds to the car bus; GI[ION] tells it whether there is
  // anything there. A voice that is silent costs nothing: each is skipped until its flag or its counter wakes it, and again
  // once its tail has died away (GI[IBS] keeps the bits of those still sounding). Their noise (wC) and their random numbers
  // come from generators of their own, so the car and the ambience are the same samples whether or not a gadget works.
  function gadDB5(m, view) {
    const g15 = ctl[15] | 0, fl = g15 & 31, ej = (g15 >> 5) & 31, es = (g15 >> 10) & 63, dp = st[DP];
    if (GI[ILA] === 0) { GI[IEJ] = ej; GI[IES] = es; GI[ILA] = 1; }
    let d = (ej - GI[IEJ]) & 31; if (d !== 0) { GI[IEJ] = ej; if (d < 4) GI[IJQ] += d; }
    d = (es - GI[IES]) & 63; if (d !== 0) { GI[IES] = es; if (d < 8) GI[ISQ] += d; }
    if ((fl | GI[IJQ] | GI[ISQ] | GI[IBS]) === 0) { GI[ION] = 0; return; }
    GI[ION] = 1; gL.fill(0); gR.fill(0); noise2(wC);
    let busy = 0;
    // -- machine guns: two guns firing in turn, left one first, 20 reports a second between them (10 each: the rate of the
    // muzzle flashes in 41_gadgets.js, here with a little jitter). A report is a crack (a millisecond of noise above
    // 1.7 kHz), the bark of the blast (4 ms of noise around 900 Hz), a low thump and, 13 and 29 ms later, the clatter of
    // the action; every report also feeds an echo (163 ms) and a diffuse tail, which is what is left when the firing stops.
    // The phase of the firing keeps running when the flag clears: a flag that flickers cannot fire faster than the guns do.
    let gac = D[GAC];
    if ((fl & 1) !== 0 || gac > 0) {
      const on = fl & 1, fr = 20 * (1 + 0.03 * D[GJT]) / sr;
      let gph = D[GPH], ec = D[GEC], et = D[GET], ek = D[GEK], ts = D[GTS], tl = D[GTL], am = D[GAM], sd = GI[ISD], ew = GI[IEW];
      for (let i = 0; i < m; i++) {
        gph += fr;
        if (gph >= 1) {
          if (on) {
            gph -= 1; if (gph >= 1) gph = 0;
            const r = rndG(); sd ^= 1; am = 0.84 + (r & 255) * 0.00125; ec = am; et = am; ek = 0; ts = 0; tl += (1 - tl) * 0.4; D[GJT] = (r >> 8) / 128 - 1; gac = GAH;
          } else { gph = 1; sd = 0; }   // at rest: ready to fire at once, left gun first (as the muzzle flashes do)
        }
        ts++; if (ts === GC1) ek = 0.9 * am; else if (ts === GC2) ek = 0.6 * am;
        const n = wC[i];
        u1[i] = n * ec; u2[i] = et; u3[i] = n * ek; u4[i] = wA[i] * tl; u5[i] = wB[i] * tl;
        ec *= GDC; et *= GDT; ek *= GDK; tl *= GDL;
      }
      D[GPH] = gph; D[GEC] = ec < 1e-9 ? 0 : ec; D[GET] = et < 1e-9 ? 0 : et; D[GEK] = ek < 1e-9 ? 0 : ek; D[GTS] = ts; D[GTL] = tl < 1e-6 ? 0 : tl; D[GAM] = am; GI[ISD] = sd;
      F[176] = 0.36; svf(u1, u6, m, 58, 2, 0);                                             // crack
      for (let i = 0; i < m; i++) u1[i] = (wC[i] + 0.5) * u2[i];
      F[179] = 0.6; svf(u2, u6, m, 59, 1, 1); F[182] = 0.65; svf(u1, u6, m, 60, 1, 1);      // thump, bark
      F[185] = 1.5; svf(u3, u6, m, 61, 1, 1); F[188] = 1.2; svf(u3, u6, m, 62, 1, 1);     // clatter
      for (let i = 0; i < m; i++) { let r = ew - ED; if (r < 0) r += EN; const y = EB[r]; EB[ew] = u6[i] + y * 0.3; if (++ew === EN) ew = 0; u1[i] = y; }
      GI[IEW] = ew; F[197] = 0.4; svf(u1, u1, m, 65, 0, 0);                              // echo
      F[191] = 0.4; svf(u4, u4, m, 63, 1, 0); F[194] = 0.4; svf(u5, u5, m, 64, 1, 0);     // tail
      const pn = view === 2 ? 0 : sd ? -0.28 : 0.28;
      for (let i = 0; i < m; i++) { const x = u6[i], e = u1[i]; gL[i] += x * (1 - pn) + e + u4[i]; gR[i] += x * (1 + pn) + e + u5[i]; }
      gac -= m; D[GAC] = gac; if (gac > 0) busy |= 1;
    }
    // -- smoke screen: pressurised hiss whose band opens as the pressure builds, with a low whoosh that wanders; soft start, long tail
    let e0 = D[QSE], tg = (fl >> 1) & 1;
    if (tg !== 0 || e0 > 1e-3) {
      let e1 = e0 + (tg - e0) * (tg > e0 ? K130 : K300); if (tg === 0 && e1 < 1e-3) e1 = 0;
      D[QSE] = e1;
      const gu = D[QSG] += (rndG() / 65536 - D[QSG]) * 0.012, de = (e1 - e0) / m;
      F[198] = 2 * Math.sin(PI * (950 + 1500 * e1) / sr); F[200] = 0.09 + 0.08 * gu; svf(wC, u1, m, 66, 1, 0);
      F[203] = 0.012 + 0.012 * e1; svf(wC, u1, m, 67, 2, 1); F[206] = 0.07 + 0.16 * gu; svf(wA, u1, m, 68, 1, 1);
      for (let i = 0; i < m; i++) { const e = e0 + de * (i + 1), y = u1[i] * e * (0.25 + 0.75 * e); gL[i] += y; gR[i] += y; }
      busy |= 2;
    }
    // -- oil spray: lower band, chopped by an irregular sputter (a new random level every 14 to 44 ms), with the glug of the sputter itself
    e0 = D[QOE]; tg = (fl >> 2) & 1;
    if (tg !== 0 || e0 > 1e-3) {
      let e1 = e0 + (tg - e0) * (tg > e0 ? K50 : K200); if (tg === 0 && e1 < 1e-3) e1 = 0;
      D[QOE] = e1;
      const de = (e1 - e0) / m; let sp = D[QOS], sq = D[QOT], cn = D[QOC];
      for (let i = 0; i < m; i++) {
        if (--cn <= 0) { const r = rndG(), q = (r >> 8) / 256; cn = (0.014 + 0.03 * (r & 255) / 256) * sr; sq = 0.1 + 0.9 * q * q; }
        sp += (sq - sp) * OSK; const e = (e0 + de * (i + 1)) * sp;
        u1[i] = wC[i] * e; u2[i] = e;
      }
      D[QOS] = sp; D[QOT] = sq; D[QOC] = cn;
      F[209] = 0.72; svf(u1, u3, m, 69, 1, 0); F[212] = 0.4; svf(u1, u3, m, 70, 1, 1); F[215] = 1.05; svf(u2, u3, m, 71, 1, 1);
      for (let i = 0; i < m; i++) { gL[i] += u3[i]; gR[i] += u3[i]; }
      busy |= 4;
    }
    // -- servo: small electric motor (pulse train that spins up and down with the mechanism) heard through its gear train
    e0 = D[QVE]; tg = (fl >> 3) & 1;
    if (tg !== 0 || e0 > 1e-3) {
      let e1 = e0 + (tg - e0) * (tg > e0 ? K50 : K60); if (tg === 0 && e1 < 1e-3) e1 = 0;
      D[QVE] = e1;
      const wob = D[QVW] += (rndG() / 32768 - 1 - D[QVW]) * 0.02, f = (150 + 450 * e1) * (1 + 0.04 * wob) * dp / sr, de = (e1 - e0) / m; let p = D[QVP];
      for (let i = 0; i < m; i++) {
        p += f; if (p >= 1) p -= 1; let u = p * 6.25, a = 0; if (u < 1) { const v = 1 - u; a = u * u * v * v * v * 28.9; }
        u1[i] = (a - 0.077 + wC[i] * 0.08) * (e0 + de * (i + 1));
      }
      D[QVP] = p; F[218] = 0.6; svf(u1, u2, m, 72, 1, 0);
      for (let i = 0; i < m; i++) { const y = (u2[i] + u1[i] * 0.1) * 0.5; gL[i] += y; gR[i] += y; }
      busy |= 8;
    }
    // -- end stop: one clunk per count — a short blow that rings a thud and three metal resonances
    let ct = D[QCT], ca = D[QCA]; if (ct > 0) D[QCT] = ct -= m;
    if (GI[ISQ] > 0 && ct <= 0) { GI[ISQ]--; D[QCE] = 1; D[QCT] = 0.075 * sr; ca = 0.1 * sr; }
    if (ca > 0) {
      let ce = D[QCE];
      for (let i = 0; i < m; i++) { u1[i] = (wC[i] * 0.6 + 0.8) * ce; ce *= CDC; }
      D[QCE] = ce < 1e-9 ? 0 : ce;
      F[221] = 2.6; svf(u1, u2, m, 73, 1, 0); F[224] = 2.4; svf(u1, u2, m, 74, 1, 1); F[227] = 2; svf(u1, u2, m, 75, 1, 1); F[230] = 1.5; svf(u1, u2, m, 76, 1, 1);
      for (let i = 0; i < m; i++) { gL[i] += u2[i]; gR[i] += u2[i]; }
      D[QCA] = ca - m; busy |= 32;
    }
    if (GI[ISQ] > 0) busy |= 32;
    // -- ejector seat: one firing per count. Bang (crack, thump, body) and the hiss of the charge; from 14 ms the roof panel
    // tears off (crackle of clicks and noise ringing metal resonances that rise as it goes, two clanks as it tumbles away);
    // the whoosh of the seat leaving rises for 0.3 s and fades over the next second and a half
    let jw = D[QJW]; if (jw > 0) D[QJW] = jw -= m;
    if (GI[IJQ] > 0 && jw <= 0) { GI[IJQ]--; D[QJT] = 0; D[QJB] = 1; D[QJ2] = 1; D[QJK] = 0; GI[IJA] = 1; D[QJW] = 0.25 * sr; }
    if (GI[IJA] !== 0) {
      const t0 = D[QJT], te = (t0 + m) / sr; let eb = D[QJB], e2 = D[QJ2], ck = D[QJK];
      const eh = Math.exp(-te / 0.1) * (1 - Math.exp(-te / 0.003)), er = te < 0.014 ? 0 : te < 0.03 ? (te - 0.014) / 0.016 : Math.exp(-(te - 0.03) / 0.1),
        aw = te < 0.3 ? Math.pow(te / 0.3, 1.6) : Math.exp(-(te - 0.3) / 0.45), fw = te < 0.3 ? 330 + 1900 * te / 0.3 : 780 + 1450 * Math.exp(-(te - 0.3) / 0.55), dn = 1 - 0.06 * er;
      if (JC1 >= t0 && JC1 < t0 + m) ck = 1; else if (JC2 >= t0 && JC2 < t0 + m) ck = 0.8;
      for (let i = 0; i < m; i++) { const n = wC[i]; u1[i] = n * eb; u2[i] = e2; u3[i] = (n > dn ? 2.5 : 0) + n * er * 0.25 + (n * 0.2 + 1) * ck * 9; eb *= JDB; e2 *= JD2; ck *= CDC; }
      D[QJB] = eb < 1e-9 ? 0 : eb; D[QJ2] = e2 < 1e-9 ? 0 : e2; D[QJK] = ck < 1e-9 ? 0 : ck; D[QJT] = t0 + m;
      F[233] = 0.38; svf(u1, u4, m, 77, 2, 0); F[236] = 0.85; svf(u2, u4, m, 78, 1, 1);
      for (let i = 0; i < m; i++) u1[i] = u1[i] * 0.6 + u2[i];
      F[239] = 0.42; svf(u1, u4, m, 79, 1, 1); F[242] = 0.2 * eh; svf(wC, u4, m, 80, 1, 1);
      const rf = 1 + 0.3 * (1 - er);
      F[243] = 2 * Math.sin(PI * 1150 * rf / sr); F[246] = 2 * Math.sin(PI * 2080 * rf / sr); F[249] = 2 * Math.sin(PI * 3350 * rf / sr);
      F[245] = 0.5; svf(u3, u4, m, 81, 1, 1); F[248] = 0.4; svf(u3, u4, m, 82, 1, 1); F[251] = 0.3; svf(u3, u4, m, 83, 1, 1);
      F[252] = 2 * Math.sin(PI * fw / sr); F[255] = 2 * Math.sin(PI * fw * 1.15 / sr); F[254] = F[257] = 0.45 * aw;
      svf(wC, u5, m, 84, 1, 0); svf(wA, u6, m, 85, 1, 0);
      for (let i = 0; i < m; i++) { const x = u4[i]; gL[i] += x + u5[i]; gR[i] += x + u6[i]; }
      if (te > 2.3) GI[IJA] = 0;
      busy |= 16;
    }
    if (GI[IJQ] > 0) busy |= 16;
    // -- horn: a pair of windtone horns, 408 and 511 Hz (a major third), each a train of narrow pulses (harmonics up to 4 kHz)
    // through the resonances of the trumpets; quick attack, with the pitch settling as the diaphragms get going, quick release
    e0 = D[QHE]; tg = (fl >> 4) & 1;
    if (tg !== 0 || e0 > 1e-3) {
      let e1 = e0 + (tg - e0) * (tg > e0 ? K8 : K20); if (tg === 0 && e1 < 1e-3) e1 = 0;
      D[QHE] = e1;
      const bl = (0.955 + 0.045 * e1) * dp / sr, f1 = 408 * bl, f2 = 511 * bl, de = (e1 - e0) / m; let p1 = D[QH1], p2 = D[QH2];
      for (let i = 0; i < m; i++) {
        p1 += f1; if (p1 >= 1) p1 -= 1; p2 += f2; if (p2 >= 1) p2 -= 1;
        let u = p1 * 4.5, a = 0; if (u < 1) { const v = 1 - u; a = u * u * v * v * v * 28.9; }
        u = p2 * 4.5; if (u < 1) { const v = 1 - u; a += u * u * v * v * v * 26; }
        u1[i] = a * (e0 + de * (i + 1));
      }
      D[QH1] = p1; D[QH2] = p2; svf(u1, u1, m, 88, 2, 0);
      for (let i = 0; i < m; i++) u2[i] = u1[i] * 0.6;
      F[260] = 0.6; svf(u1, u2, m, 86, 1, 1); F[263] = 0.3; svf(u1, u2, m, 87, 1, 1);
      for (let i = 0; i < m; i++) { const y = u2[i] * 0.3; gL[i] += y; gR[i] += y; }
      busy |= 64;
    }
    GI[IBS] = busy;
  }
  function chunk(m) {
    const fl = ctl[0] | 0, view = (fl >> 2) & 3, on = (fl & 3) === 1 ? 1 : 0, mg0 = st[MG], db5 = (fl >> 4) & 1;
    if (!on && mg0 < 2e-4) { st[MG] = 0; oL.fill(0); oR.fill(0); GI[ILA] = 0; return; }   // pausa ou mudo: saída exatamente zero, estado congelado (GI[ILA] = 0: the gadget counters will be latched again, without firing)
    const mg1 = mg0 + (on - mg0) * K8 * 1.6; st[MG] = mg1;
    noise(wA); noise(wB);
    // ---- controles suavizados
    const gear = ctl[3] | 0;
    if (gear !== st[GP]) { if (gear > 0 && st[GP] > 0) { st[SHT] = (db5 ? 0.27 : 0.21) * sr; D[XSL] = gear < st[GP] ? 0.4 : 0.04; } st[CLK] = 1; st[GP] = gear; }   // (DB5: a slower change by hand; D[XSL] is the throttle during it — lifted going up, blipped going down to match the revs)
    const sht = st[SHT]; if (sht > 0) st[SHT] = sht - m;
    const rp = st[RP] += ((ctl[1] < 600 ? 600 : ctl[1]) - st[RP]) * (sht > 0 ? K50 : K20 * 1.3);
    const ld = st[LD] += ((sht > 0 ? (db5 ? D[XSL] : 0.04) : ctl[2] * 0.001) - st[LD]) * (sht > 0 ? K8 * 2 : K20);
    const dp = st[DP] += (ctl[10] * 1e-4 - st[DP]) * K50, dist = ctl[9] * 0.1;
    const dg = st[DG] += (Math.pow(9 / (9 + (dist > 7 ? dist - 7 : 0)), 0.85) - st[DG]) * K20;
    const spd = st[SPD] += (ctl[4] * 0.01 - st[SPD]) * K20, lsp = st[LSP] += (ctl[11] * 0.01 - st[LSP]) * K50;
    for (let k = 0; k < 8; k++) st[VGS + k] += (VG[view * 8 + k] - st[VGS + k]) * K20;
    if (db5) engDB5(m, view);
    else {   // (the Uno's engine, as it always was: its lines are left as they were, indentation included)
    // ---- motor: um pulso de pressão por explosão (4 por ciclo de 2 voltas), largura em tempo fixo → formantes fixos
    const fc = rp / 30 * dp / sr, ifc = 1 / fc; let tp = (0.0035 - 0.0027 * ld) * sr; if (tp > 0.85 * ifc) tp = 0.85 * ifc;
    const itp = 1 / tp, itk = 1 / (0.0007 * sr), idle = rp < 2500 ? (2500 - rp) / 1600 : 0, jit = 0.07 + (0.22 * (1 - ld) + 0.1) * idle + 0.1 * (1 - ld);
    let fp = st[FP], amp = st[AMP], cyl = st[CYL] | 0;
    for (let i = 0; i < m; i++) {
      fp += fc; if (fp >= 1) { fp -= 1; cyl = (cyl + 1) & 3; amp = CG[cyl] * (1 + jit * (rnd16() / 32768 - 1)); }
      const tn = fp * ifc; let u = tn * itp, p = 0; if (u < 1) { const v = 1 - u; p = u * u * v * v * v * 28.9; }
      ex[i] = amp * p; ni[i] = wA[i] * (0.25 + p) * amp;
      u = tn * itk; tk[i] = u < 1 ? wB[i] * (1 - u) : 0;
    }
    st[FP] = fp; st[AMP] = amp; st[CYL] = cyl;
    svf(ex, t1, m, 0, 2, 0);                                              // tira o nível contínuo do trem de pulsos
    for (let i = 0; i < m; i++) eg[i] = t1[i] * st[VGS];
    for (let k = 1; k <= 5; k++) { F[3 * k + 2] = st[VGS + k] * (k === 5 ? 0.3 + 0.7 * ld : 1); svf(t1, eg, m, k, 1, 1); }
    F[20] = st[VGS + 6] * ld * (0.25 + 0.75 * ld) * 0.5; svf(ni, eg, m, 6, 1, 1);    // ruído de admissão: só com o pé embaixo
    F[23] = st[VGS + 7] * (0.5 + rp / 6500); svf(tk, eg, m, 7, 2, 1);               // tuchos e válvulas
    // tranco e estalo da troca de marcha
    let clk = st[CLK]; if (clk > 1e-4) { for (let i = 0; i < m; i++) { t2[i] = wB[i] * clk * clk; clk *= 0.9992; } st[CLK] = clk * (clk < 0.02 ? 0 : 1); F[98] = 1.6; svf(t2, eg, m, 32, 1, 1); }
    const drv = 1.4 + 2.6 * ld, ev = (0.3 + 0.7 * Math.pow(ld, 0.8)) * (0.45 + 0.55 * rp / 6500) * dg * 0.4 / (drv / (1 + drv * 0.5));
    for (let i = 0; i < m; i++) { const x = eg[i] * drv; eg[i] = x / (1 + (x < 0 ? -x : x) * 0.5) * ev; }   // saturação: mais harmônicos com carga
    svf(eg, eg, m, 33, 2, 0);
    }
    // ---- pneus: canto (tom instável perto de 1 kHz com harmônicos) + raspado, por lado, na proporção do escorregamento
    // (DB5, tall cross-ply tyres: they start to howl at less slip, lower in pitch, and take longer to stop)
    const tqF = db5 ? 455 : 720, tqA = db5 ? 215 : 380, tqE = db5 ? 1.05 : 1.45, tqG = db5 ? 0.25 : 0.3, tqS = db5 ? 0.7 : 0.8, tqN = db5 ? 0.5 : 0.55, tqK = db5 ? K220 : K30, tqB = db5 ? 34 : 8;
    for (let s = 0; s < 2; s++) {
      let tgt = ctl[5 + s] * 0.001; if (db5) { tgt *= 1.6; if (tgt > 1) tgt = 1; }
      const a = st[SQ + s] += (tgt - st[SQ + s]) * (tgt > st[SQ + s] ? K20 : tqK), o = s ? sR : sL, w = s ? wB : wA;
      if (a < 0.004) { st[SQ + s] = tgt > 0 ? a : 0; o.fill(0); continue; }                                 // agarrou: some de vez
      const j = (st[SQJ + s] += ((rnd16() / 32768 - 1) * 0.08 - st[SQJ + s]) * 0.18) + (st[SQW + s] += ((rnd16() / 32768 - 1) * 2.2 - st[SQW + s]) * 0.004), env = st[SQA + s] += ((rnd16() / 65536) - st[SQA + s]) * 0.05;
      const f = (tqF + tqA * a) * (0.86 + 0.22 * (spd < 35 ? spd / 35 : 1)) * (s ? 1.07 : 1) * (1 + j) * dp / sr, g = Math.pow(a, tqE) * (0.45 + 1.1 * env) * tqG * dg, gs = Math.pow(a, tqS) * tqN * dg;
      let ph = st[SQP + s];
      for (let i = 0; i < m; i++) { ph += f; if (ph >= 1) ph -= 1; const q = Math.sin(6.283185307 * ph); t1[i] = (q + 0.4 * (1 - 2 * q * q) + 0.1 * (3 * q - 4 * q * q * q)) * g; t2[i] = w[i] * gs; }
      st[SQP + s] = ph; svf(t2, t1, m, tqB + s, 1, 1); o.set(t1);
    }
    // ---- barramento do carro visto do ouvinte: absorção do ar com a distância
    const air = 15000 / (1 + dist * 0.02); F[90] = F[93] = 2 * Math.sin(PI * (air < sr * 0.16 ? air : sr * 0.16) / sr);
    // (DB5, cockpit camera: the car is heard through the cabin — the same filter comes down to 1.5 kHz; cab = how far inside, 0..1)
    const cab = db5 ? D[XCB] += ((view === 3 ? 1 : 0) - D[XCB]) * K50 : 0;
    if (cab > 0.002) { const a0 = air < sr * 0.16 ? air : sr * 0.16; F[90] = F[93] = 2 * Math.sin(PI * a0 * Math.pow(1500 / a0, cab) / sr); }
    // ---- vento (velocidade do ouvinte) e rodagem (velocidade do carro)
    const gust = st[GUST] += ((rnd16() / 65536) - st[GUST]) * 0.004, wv = lsp / 42, wg = wv * wv * (0.7 + 0.6 * gust) * (view === 1 ? 0.85 : 0.6), wf = 2 * Math.sin(PI * (260 + 21 * lsp) / sr);
    F[30] = F[33] = wf; F[32] = F[35] = db5 ? wg * 1.25 / (1 + 0.15 * wv * wv) * (1 - 0.45 * cab) : wg;   // (DB5: a little more wind roar, less of it inside the cabin)
    svf(wA, L2, m, 10, 1, 0); svf(wB, R2, m, 11, 1, 0);
    if (cab > 0.002) { F[170] = F[173] = cab * wv * wv * (0.5 + gust) * 0.14; svf(wB, L2, m, 56, 1, 1); svf(wA, R2, m, 57, 1, 1); }   // (DB5 cockpit: wind hiss around the window frames)
    const rv = spd / 40; F[36] = 2 * Math.sin(PI * (130 + 9 * spd) / sr); F[38] = Math.pow(rv, 1.3) * 0.5 * dg;
    for (let i = 0; i < m; i++) t1[i] = wA[i] - wB[i]; svf(t1, cb, m, 12, 0, 0);
    const loo = st[LOO] += (ctl[7] * 0.001 - st[LOO]) * K50;
    if (loo > 0.003) { F[41] = loo * 0.5 * dg; svf(wB, cb, m, 13, 1, 1); const dn = 0.004 + 0.02 * loo; for (let i = 0; i < m; i++) t2[i] = (wA[i] > 1 - dn ? 1 : 0) * loo * 3; F[44] = dg; svf(t2, cb, m, 14, 1, 1); }
    const krb = st[KRB] += (ctl[8] * 0.001 - st[KRB]) * K20;
    if (krb > 0.003 || Z[30] > 1e-5 || Z[30] < -1e-5) {
      let kp = st[KPH]; const kf = spd / 0.6 / sr; for (let i = 0; i < m; i++) { kp += kf; if (kp >= 1) { kp -= 1; t2[i] = krb * 7; } else t2[i] = 0; } st[KPH] = kp;
      F[47] = dg; F[50] = dg * 0.5; svf(t2, cb, m, 15, 1, 1); svf(t2, cb, m, 16, 1, 1);
    }
    const hits = ctl[14] | 0; if (hits !== st[HIT]) { st[HIT] = hits; if (st[HITE] < 0.05) st[HITE] = 1; }
    let he = st[HITE]; if (he > 1e-4) { for (let i = 0; i < m; i++) { t2[i] = wA[i] * he * he; he *= 0.9984; } st[HITE] = he < 0.01 ? 0 : he; F[53] = 2.2 * dg; F[56] = 0.7 * dg; svf(t2, cb, m, 17, 0, 1); svf(t2, cb, m, 18, 1, 1); }
    // ---- ambiente: folhagem, cigarras e pássaros (independem do carro)
    const fol = st[FOL] += ((rnd16() / 65536) - st[FOL]) * 0.0015, fg = 0.024 * (0.5 + fol), tm = st[TM] += m, ts = tm / sr;
    F[59] = fg; F[62] = fg; svf(wA, L4, m, 19, 1, 0); svf(wB, R4, m, 20, 1, 0);
    const c1 = Math.sin(ts * 0.48), c2 = Math.sin(ts * 0.37 + 2), a1 = c1 > 0 ? c1 * c1 * 0.07 : 0, a2 = c2 > 0 ? c2 * c2 * 0.055 : 0;
    if (a1 > 1e-5) { for (let i = 0; i < m; i++) { const q = Math.sin(ts * 327 + i * 327 / sr); t1[i] = wA[i] * q * q * a1; } svf(t1, t2, m, 21, 1, 0); for (let i = 0; i < m; i++) { L4[i] += t2[i] * 0.8; R4[i] += t2[i] * 0.3; } }
    if (a2 > 1e-5) { for (let i = 0; i < m; i++) { const q = Math.sin(ts * 270 + i * 270 / sr); t1[i] = wB[i] * q * q * a2; } svf(t1, t2, m, 22, 1, 0); for (let i = 0; i < m; i++) { L4[i] += t2[i] * 0.25; R4[i] += t2[i] * 0.8; } }
    if ((st[NEXT] -= m) <= 0) { st[NEXT] = (0.35 + 2.4 * (rnd16() / 65536)) * sr; birdStart(); }
    for (let v = 0; v < 3; v++) {
      if (BI[v * 2] <= 0) continue;
      const b = BV + v * 10, dur = st[b + 1], f0 = st[b + 2], df = st[b + 3] - f0, vd = st[b + 5], a = st[b + 8], pan = st[b + 9], idur = 1 / dur; let t = st[b], ph = st[b + 6];
      if (t < 0) { t += m; st[b] = t; if (t >= 0) birdNote(v); continue; }                // pausa entre notas
      for (let i = 0; i < m && t < dur; i++, t++) {
        const u = t * idur, e = u < 0.2 ? u * 5 : (1 - u) * 1.25, f = f0 + df * u + (vd ? vd * Math.sin(t * 190 / sr) : 0);
        ph += f / sr; if (ph >= 1) ph -= 1; const q = Math.sin(6.283185307 * ph), y = (q + 0.2 * (1 - 2 * q * q)) * e * e * a * (vd ? 0.6 + 0.4 * Math.sin(t * 190 / sr) : 1);
        L4[i] += y * (1 - pan); R4[i] += y * pan;
      }
      st[b + 6] = ph;
      if (t >= dur) { if (--BI[v * 2] > 0) st[b] = -st[b + 4]; } else st[b] = t;
    }
    // ---- público: murmúrio (ruído em formantes de voz, em ondas lentas) e palmas, só perto da arquibancada
    const crw = st[CRW] += (ctl[12] * 0.001 - st[CRW]) * K200;
    if (crw > 0.004) {
      const cp = st[CPN] += (ctl[13] * 0.001 - st[CPN]) * K200, sw = st[CRE] += ((rnd16() / 65536) - st[CRE]) * 0.003, cg = crw * (0.45 + 1.1 * sw) * (1 + 0.5 * (spd < 40 ? spd / 40 : 1)) * 0.75, gl = cg * (1 - 0.6 * cp) * 0.5, gr = cg * (1 + 0.6 * cp) * 0.5;
      svf(wB, t1, m, 23, 1, 0); svf(wB, t1, m, 24, 1, 1); svf(wB, t1, m, 25, 1, 1); svf(wA, t2, m, 26, 1, 0); svf(wA, t2, m, 27, 1, 1); svf(wA, t2, m, 28, 1, 1);
      for (let i = 0; i < m; i++) { L5[i] = t1[i] * gl; R5[i] = t2[i] * gr; }
      const dn = 0.0035 * (0.4 + sw); for (let i = 0; i < m; i++) t1[i] = wA[i] < -1 + dn ? 9 * (0.3 + wB[i] * wB[i]) : 0;
      svf(t1, t2, m, 29, 1, 0); for (let i = 0; i < m; i++) { L5[i] += t2[i] * gl; R5[i] += t2[i] * gr; }
    } else { L5.fill(0); R5.fill(0); }
    // ---- mistura, absorção do ar no barramento do carro, limitador suave
    const m0 = mix[0], m1 = mix[1], m2 = mix[2], m3 = mix[3], near = view === 1 && !db5 ? 1.25 : 1;
    let m4 = mix[4] * AMB, m5 = mix[5] * AMB;
    for (let i = 0; i < m; i++) { const e = eg[i] * m0 * near, c = cb[i] * m3; t1[i] = e + c + (sL[i] * 0.85 + sR[i] * 0.4) * m1; t2[i] = e + c + (sL[i] * 0.4 + sR[i] * 0.85) * m1; }
    if (db5) {
      // DB5: what differs between the two pipes gives the exhaust a little width, the gadgets join the car bus (same distance, air and cabin
      // treatment as the car) and, in the cockpit, the cabin booms and the world outside is heard through the glass
      for (let i = 0; i < m; i++) { const s = eS[i] * m0; t1[i] += s; t2[i] -= s; }
      gadDB5(m, view);
      if (GI[ION] !== 0) { const gg = mix[6] * dg; for (let i = 0; i < m; i++) { t1[i] += gL[i] * gg; t2[i] += gR[i] * gg; } }
      if (cab > 0.002) {
        for (let i = 0; i < m; i++) t3[i] = t1[i] + t2[i];
        F[164] = 0.14 * cab; svf(t3, t4, m, 54, 1, 0); F[167] = 0.2 * cab; svf(t3, t4, m, 55, 1, 1);
        for (let i = 0; i < m; i++) { t1[i] += t4[i]; t2[i] += t4[i]; }
        m4 *= 1 - 0.5 * cab; m5 *= 1 - 0.5 * cab;
      }
    }
    svf(t1, t1, m, 30, 0, 0); svf(t2, t2, m, 31, 0, 0);
    const dm = (mg1 - mg0) / m;
    for (let i = 0; i < m; i++) {
      const g = mg0 + dm * (i + 1); let l = (t1[i] + L2[i] * m2 + L4[i] * m4 + L5[i] * m5) * g, r = (t2[i] + R2[i] * m2 + R4[i] * m4 + R5[i] * m5) * g;
      let a = l < 0 ? -l : l; if (a > 0.55) { a = 0.55 + (a - 0.55) / (1 + (a - 0.55) / 0.42); l = l < 0 ? -a : a; }
      a = r < 0 ? -r : r; if (a > 0.55) { a = 0.55 + (a - 0.55) / (1 + (a - 0.55) / 0.42); r = r < 0 ? -a : a; }
      oL[i] = l * VOL; oR[i] = r * VOL;
    }
  }
  // escreve n amostras em L e R a partir de off
  function render(L, R, off, n) {
    for (let o = 0; o < n; o += NC) { const m = n - o < NC ? n - o : NC; chunk(m); for (let i = 0; i < m; i++) { L[off + o + i] = oL[i]; R[off + o + i] = oR[i]; } }
  }
  return { ctl, mix, render, reset };
}
// ==== tempo real e fora do tempo real: ligação do sintetizador com o jogo
// (car: bit 16 of control 0 — the DB5; gad: the gadget counters as last read from GAD.snd [0, 1] and as sent in control 15 [2, 3])
const SND = { ctx: null, node: null, P: null, ok: false, run: false, mute: false, sc: new Int32Array(16), last: new Int32Array(16), stand: new Float64Array(4), rec: null, recN: 0, pcm: null, an: null, anBuf: null, car: CARSEL === 'db5' ? 16 : 0, gad: new Int32Array(4) };
function sndInit() {
  const p = new Float64Array(5), S = TRK.stand, d = (S.d0 + S.d1) / 2;
  trackPos(TRK.L + S.s0, d, p); SND.stand[0] = p[0]; SND.stand[1] = p[2]; trackPos(S.s1, d, p); SND.stand[2] = p[0]; SND.stand[3] = p[2];
}
// Lê a simulação e a câmera e preenche os 16 controles inteiros (SND.sc). É a única entrada do sintetizador.
function sndControl() {
  const V = VEH, c = SND.sc, cam = R.cam, cp = cam.pos, view = GS.cam, sp = GS.speed;
  let sl = 0, sr = 0, loose = 0, kerb = 0;
  for (let i = 0; i < 4; i++) {
    const z = V.wzone[i], s = V.slip[i];
    if (z === ZONE.GRASS || z === ZONE.GRAVEL || z === ZONE.ROUGH) loose += 0.25;
    else { if (z === ZONE.KERB) kerb += 0.25; if (s > 0.03) { if (i & 1) { if (s > sr) sr = s; } else if (s > sl) sl = s; } }   // pneu só canta em piso duro
  }
  const kv = sp < 12 ? sp / 12 : 1, dx = GS.cx - cp[0], dy = GS.cy + 0.6 - cp[1], dz = GS.cz - cp[2], dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let dop = 1, lsp = sp;
  if (view === 2) {   // câmera de TV parada: Doppler pela velocidade de aproximação do carro; o ouvinte não tem vento próprio
    const cy = Math.cos(V.yaw), sy = Math.sin(V.yaw), vr = -((V.vx * cy - V.vy * sy) * dx + (V.vx * sy + V.vy * cy) * dz) / (dist > 1 ? dist : 1);
    dop = 343 / (343 - vr); lsp = 0;
  }
  // público: distância do ouvinte ao eixo da arquibancada e de que lado ela fica
  const A = SND.stand, bx = A[2] - A[0], bz = A[3] - A[1]; let t = ((cp[0] - A[0]) * bx + (cp[2] - A[1]) * bz) / (bx * bx + bz * bz); t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = A[0] + bx * t - cp[0], pz = A[1] + bz * t - cp[2], pd = Math.sqrt(px * px + pz * pz) + 0.01, fw = cam.fwd, fl = Math.sqrt(fw[0] * fw[0] + fw[2] * fw[2]) + 1e-6;
  c[0] = (SND.run ? 1 : 0) | (SND.mute ? 2 : 0) | (view << 2) | SND.car;
  c[1] = V.rpm; c[2] = V.ctl[0] * 1000; c[3] = V.gear; c[4] = sp * 100; c[5] = sl * 1000; c[6] = sr * 1000; c[7] = loose * kv * 1000; c[8] = kerb * kv * 1000;
  c[9] = dist * 10; c[10] = dop * 10000; c[11] = lsp * 100; c[12] = 1000 / (1 + pd * pd / 2025); c[13] = (px * -fw[2] + pz * fw[0]) / (pd * fl) * 1000; c[14] = V.hits & 1023;
  // DB5 gadgets → control 15 (layout at the top of the file): the flags of this tick and the two event counters. The
  // counters are re-counted here from GAD.snd, forward steps only, so that zeroing GAD.snd (a restart) never fires a sound.
  if (SND.car) {
    const g = GAD.snd, q = SND.gad; let d = g[1] - q[0]; q[0] = g[1]; if (d > 0) q[2] = (q[2] + (d > 3 ? 3 : d)) & 31;
    d = g[2] - q[1]; q[1] = g[2]; if (d > 0) q[3] = (q[3] + (d > 7 ? 7 : d)) & 63;
    c[15] = (g[0] & 31) | (q[2] << 5) | (q[3] << 10);
  }
}
// Warm-up of the synthesiser inside the worklet (called by the processor's constructor; pasted into the worklet module, so it
// must stay self-contained): runs seconds of audio with controls that visit every branch, then resets the state. V8
// optimises the synthesiser before the first real block, instead of spending the first second in the interpreter,
// allocating, and does not have to throw the optimised code away the first time a rare branch is taken in the middle of
// the game. The Uno's pattern is the one it always had. The DB5 adds, on top of it: the four cameras, every gadget flag and
// both event counters; the car at rest for the starter (after a few blocks with no engine speed yet, as the game's first
// blocks may be), twice, with a reset in between (V8 only starts to
// record type feedback after a function's first few calls, so what runs only on the very first blocks has to run again);
// the first 900 blocks with no gadget at all, which is how the game spends most of its time; overruns at high revs for
// the burble and, at the end, a long one for the pops; a mute and a pause; a stretch with the car near, flat out, guns and
// horn going, to reach the limiter.
function sndWarm(s, db5) {
  const a = new Float32Array(128), b = new Float32Array(128), c = s.ctl, n = db5 ? 3600 : 1600;
  for (let i = 0; i < n; i++) {
    if (db5 && i === 250) s.reset();
    c[0] = 1 | (i >> 8) % 3 << 2; c[1] = 900 + i * 37 % 5600; c[2] = i * 13 % 1001; c[3] = (i >> 6) % 6; c[4] = i * 29 % 5000; c[5] = i & 256 ? i * 7 % 1000 : 0; c[6] = i & 512 ? i * 11 % 1000 : 0; c[7] = i & 128 ? 500 : 0; c[8] = i & 64 ? 500 : 0;
    c[9] = i * 3 % 900; c[10] = 9000 + i * 17 % 2000; c[11] = i * 29 % 5000; c[12] = i * 5 % 1000; c[13] = i * 19 % 2000 - 1000; c[14] = i >> 5;
    if (db5) {
      c[0] = 17 | (i >> 7 & 3) << 2; c[15] = i < 900 ? 0 : (i >> 3 & 31) | (i >> 10 & 31) << 5 | (i >> 5 & 63) << 10;
      if (i < 500) { c[1] = i % 250 < 6 ? 0 : 750; c[2] = 0; c[4] = 0; } else if ((i & 511) > 320) { c[1] = 5600 - (i & 127) * 8; c[2] = 0; }
      if (i >= 1500 && i < 1540) c[0] |= 2; else if (i >= 1600 && i < 1640) c[0] &= ~1; else if (i >= 1700 && i < 1900) { c[1] = 5500; c[2] = 1000; c[9] = 55; c[15] |= 17; }
      if (i >= 3000) { c[1] = 5300; c[2] = 0; c[3] = 3; }
    }
    s.render(a, b, 0, 128);
  }
  s.reset();
}
// O contexto de áudio só pode nascer num gesto do usuário: é chamado no clique de "Começar".
function sndStart() {
  if (SND.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const ctx = SND.ctx = new AC({ latencyHint: 'interactive' });
  const fallback = () => {   // navegador sem AudioWorklet: mesmo sintetizador num ScriptProcessor
    const s = sndCore(ctx.sampleRate), n = SND.node = ctx.createScriptProcessor(1024, 0, 2);
    n.onaudioprocess = e => { const b = e.outputBuffer; for (let k = 0; k < 16; k++) s.ctl[k] = SND.sc[k]; s.render(b.getChannelData(0), b.getChannelData(1), 0, b.length); };
    n.connect(ctx.destination); SND.ok = true;
  };
  if (!ctx.audioWorklet) { fallback(); return; }
  // (o construtor do processador roda sndWarm — segundos de áudio com controles variados — e zera o estado: o V8 otimiza o
  // sintetizador antes do primeiro bloco de verdade, em vez de passar o primeiro segundo no interpretador, alocando)
  const code = 'const mk=' + sndCore.toString() + ',wu=' + sndWarm.toString() + ',N=[];for(let i=0;i<16;i++)N.push("p"+i);registerProcessor("uno",class extends AudioWorkletProcessor{static get parameterDescriptors(){return N.map(n=>({name:n,defaultValue:0,automationRate:"k-rate"}))}constructor(){super();wu(this.s=mk(sampleRate),' + (SND.car ? 1 : 0) + ')}process(i,o,p){const s=this.s,c=s.ctl,q=o[0];for(let k=0;k<16;k++)c[k]=p[N[k]][0];s.render(q[0],q[1],0,q[0].length);return true}})';
  // O módulo vai por URL data: — aberto como arquivo (file://) a página tem origem opaca e o Chrome recusa módulo por URL blob:.
  // Se o navegador recusar data:, tenta blob:; se não houver worklet de jeito nenhum, cai no ScriptProcessor.
  const mod = u => ctx.audioWorklet.addModule(u);
  mod('data:application/javascript;charset=utf-8,' + encodeURIComponent(code)).catch(() => mod(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))).then(() => {
    const n = SND.node = new AudioWorkletNode(ctx, 'uno', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    SND.P = []; for (let i = 0; i < 16; i++) SND.P.push(n.parameters.get('p' + i));
    n.connect(ctx.destination); SND.last.fill(-1); SND.ok = true; sndFlags();
  }).catch(e => { console.warn('AudioWorklet indisponível (' + e.message + '): som pelo ScriptProcessor'); SND.P = null; fallback(); });
}
// envia os controles deste quadro ao sintetizador: só números inteiros pequenos em AudioParams (nada é alocado)
function sndFrame() {
  if (!SND.ok) return; sndControl();
  const P = SND.P; if (!P) return; const c = SND.sc, l = SND.last;
  for (let i = 0; i < 16; i++) { const v = c[i]; if (v !== l[i]) { l[i] = v; P[i].value = v; } }
}
function sndFlags() { const c = SND.sc; c[0] = (SND.run ? 1 : 0) | (SND.mute ? 2 : 0) | (c[0] & 12) | SND.car; if (SND.P) { SND.P[0].value = c[0]; SND.last[0] = c[0]; } }
// pausa (menu) e retomada: o sintetizador some em poucos milissegundos e o contexto de áudio é suspenso em seguida
function sndRun(on) {
  SND.run = on; if (!SND.ctx) return; sndFlags();
  if (on) SND.ctx.resume(); else setTimeout(() => { if (!SND.run && SND.ctx.state === 'running') SND.ctx.suspend(); }, 150);
}
function sndMute(m) { SND.mute = m; sndFlags(); }
// gravação dos controles a cada quadro de 1/60 s (captura): a trilha do vídeo sai da mesma simulação que os quadros
function sndRecTick() { const r = SND.rec; if (SND.recN * 16 >= r.length) return; const was = SND.run; SND.run = true; sndControl(); SND.run = was; r.set(SND.sc, SND.recN++ * 16); }
// Síntese fora do tempo real dos controles gravados → PCM estéreo de 16 bits a 48 kHz (800 amostras por quadro de 1/60 s).
// mix: bits das camadas (63 = todas); mudoDe / pausaDe: quadro a partir do qual liga o mudo / a pausa (-1 = nunca).
// (DB5: the gadgets are layer 6, bit 64. They also play with 63, which meant "everything" before they existed; to leave
// them out, pass a mask that is not 63 and has bit 64 clear, e.g. 31.)
function sndOffline(mix, mudoDe, pausaDe) {
  const n = SND.recN, S = sndCore(48000), L = new Float32Array(n * 800), Rr = new Float32Array(n * 800), pcm = SND.pcm = new Int16Array(n * 1600), rec = SND.rec;
  for (let i = 0; i < 6; i++) S.mix[i] = (mix >> i) & 1;
  S.mix[6] = (mix & 127) === 63 ? 1 : (mix >> 6) & 1;
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 16; k++) S.ctl[k] = rec[f * 16 + k];
    if (mudoDe >= 0 && f >= mudoDe) S.ctl[0] = rec[f * 16] | 2; if (pausaDe >= 0 && f >= pausaDe) S.ctl[0] = rec[f * 16] & ~1;
    S.render(L, Rr, f * 800, 800);
  }
  let pk = 0; for (let i = 0; i < n * 800; i++) { const a = Math.abs(L[i]), b = Math.abs(Rr[i]); if (a > pk) pk = a; if (b > pk) pk = b; pcm[i * 2] = Math.round(L[i] * 32767); pcm[i * 2 + 1] = Math.round(Rr[i] * 32767); }
  return { quadros: n, amostras: n * 800, taxa: 48000, pico: pk };
}
