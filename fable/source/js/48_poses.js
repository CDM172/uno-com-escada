// Poses fixas para verificação visual (usadas só pelos scripts de captura via __cap.pose(i)).
// tipo 'carro': carro parado em (s, d, direção), câmera livre em coordenadas do carro [x frente, y cima, z direita].
// tipo 'volta': reproduz os comandos gravados até o instante t (s) e captura o quadro em movimento, com a câmera cam.
// (With the Aston Martins the lap poses are driven by the autopilot — their scripted lap — and tDB5 / tV8 is the instant at
//  which that car is at the same place and doing the same thing. label is the name shown on screen.)
const POSES = [
  { nome: 'carro-frente-34', label: 'Car, front three-quarter', tipo: 'carro', s: 160, d: -1.0, yaw: 3.75, olho: [4.9, 1.35, -3.3], alvo: [0.1, 0.72, 0], fov: 0.5 },
  { nome: 'carro-traseira-34', label: 'Car, rear three-quarter', tipo: 'carro', s: 160, d: -1.0, yaw: 0.61, olho: [-5.0, 1.75, 3.4], alvo: [-0.1, 0.8, 0], fov: 0.5 },
  { nome: 'carro-lateral-baixa', label: 'Car, low side view', tipo: 'carro', s: 160, d: -1.0, yaw: 2.1, olho: [0.9, 0.62, -5.2], alvo: [0.05, 0.8, 0], fov: 0.6 },
  { nome: 'perseguicao-curva', label: 'Chase camera in a corner', tipo: 'volta', t: 11.8, tDB5: 13.3, tV8: 11.3, cam: 0 },
  { nome: 'tv-grampo-derrapagem', label: 'TV camera, sliding at the hairpin', tipo: 'volta', t: 21.55, tDB5: 29.25, tV8: 22.7, cam: 2 },
  { nome: 'capo-reta-oposta', label: 'Bonnet camera on the back straight', tipo: 'volta', t: 30.4, tDB5: 36.4, tV8: 32.9, cam: 1 },
];
// the fourth camera, in the cockpit (Aston Martins only)
if (CARSEL === 'db5') POSES.push({ nome: 'cabine-db5', label: 'Cockpit, guns firing', tipo: 'volta', t: 34.6, cam: 3 });
if (CARSEL === 'v8') POSES.push({ nome: 'cabine-v8', label: 'Cockpit, lasers and head-up display', tipo: 'volta', t: 32.0, cam: 3 });
function poseApply(i) {
  const P = POSES[i];
  GS.fxOn = true;
  if (P.tipo === 'carro') {
    gameRestart(); vehicleReset(P.s, P.d, P.yaw); GS.frozen = true; GS.freeCam = true; GS.alpha = 1; gamePose();
    const B = GS.body, o = P.olho, a = P.alvo, q = CAMQ;
    q[0] = B[0] * o[0] + B[4] * o[1] + B[8] * o[2] + B[12]; q[1] = B[1] * o[0] + B[5] * o[1] + B[9] * o[2] + B[13]; q[2] = B[2] * o[0] + B[6] * o[1] + B[10] * o[2] + B[14];
    q[3] = B[0] * a[0] + B[4] * a[1] + B[8] * a[2] + B[12]; q[4] = B[1] * a[0] + B[5] * a[1] + B[9] * a[2] + B[13]; q[5] = B[2] * a[0] + B[6] * a[1] + B[10] * a[2] + B[14];
    q[6] = P.fov; q[7] = 0; setCameraQ(); GS.cut = true; R.casc.focusOn = false;
    RT[2] = 1 / 60; for (let k = 0; k < 60; k++) { gameTick(true); renderFrame(); }
  } else {
    GS.frozen = false; GS.freeCam = false; const was = GS.replayOn; GS.replayOn = true; gameRestart(); GS.cam = P.cam; GS.cut = true;
    const n = Math.round((CARSEL === 'db5' && P.tDB5 !== undefined ? P.tDB5 : CARSEL === 'v8' && P.tV8 !== undefined ? P.tV8 : P.t) * 60), warm = 45; RT[2] = 1 / 60;
    for (let k = 0; k < n; k++) { const camKeep = GS.cam; gameTick(true); GS.cam = P.cam; if (k >= n - warm) renderFrame(); }
    GS.replayOn = was;
  }
}
