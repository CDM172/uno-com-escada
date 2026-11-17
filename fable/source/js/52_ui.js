// Interface do jogo aberto por uma pessoa (GAME.ui): tela de início, pausa, benchmark, volta roteirizada para assistir,
// poses, teclas de ferramenta e leitura do controle. Nas ferramentas de trabalho/ (captura, poses, teste, medição) nada
// disto é ligado: sem menu, sem painel, sem som.
const ST = { INICIO: 0, JOGO: 1, PAUSA: 2, BENCH: 3, FITA: 4, RESULT: 5, POSE: 6 };
const UI = { st: ST.INICIO, back: ST.JOGO, el: null, tag: null, res: null, b0: null, b1: null, cars: null, gfx: null, bench: null, benchN: 0, padPrev: 0, padN: 0, pose: -1, stats: false, warm: false };
// the best lap is kept per car (the Aston Martins and the Uno are not in the same league)
const BEST_KEY = CARSEL + (MAPSEL === 'wsm' ? '-wsm' : '') + '-melhor';   // (and per map)
const $ = id => document.getElementById(id);
function uiInit() {
  UI.el = $('ui'); UI.tag = $('tag'); UI.res = $('res'); UI.b0 = $('b0'); UI.b1 = $('b1'); UI.cars = $('cars'); UI.gfx = $('gfx');
  hudInit(); uiWarmup();
  try { const b = +localStorage.getItem(BEST_KEY); if (b > 20 && b < 600) LAP[2] = b; } catch (e) { /* sem armazenamento local: a melhor volta vale só nesta sessão */ }
  // Start screen: the car that is loaded goes in the subtitle and is marked in the chooser; picking the other one reloads
  // the page with ?car=... (the other parameters of the address are kept). The gadget keys are listed with the Aston Martins.
  $('sub').textContent = (BC ? BC.name : 'Fiat Uno Mille EP · 1996 · with a ladder') + (TOWN.on ? ' · Weston-super-Mare' : ' · Serra da Mata circuit');
  // Map chooser: the same, with ?map=... (Weston-super-Mare is built from OpenStreetMap: its credits go under the buttons)
  UI.maps = $('maps');
  for (const b of document.querySelectorAll('#maps .car')) {
    const m = b.dataset.map, sel = m === MAPSEL; b.classList.toggle('sel', sel); b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    b.onclick = () => { if (sel) return; const q = new URLSearchParams(location.search); q.set('map', m); location.search = q.toString(); };
  }
  if (TOWN.on) { const c = $('credit'); c.textContent = WSM_META.credits.join(' · '); c.style.display = 'block'; document.title = document.title.replace('Serra da Mata circuit', 'Weston-super-Mare'); }
  for (const b of document.querySelectorAll('#cars .car')) {
    const c = b.dataset.car, sel = c === CARSEL; b.classList.toggle('sel', sel); b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (c === 'v8' && !BC_V8.meta) b.style.display = 'none';   // (a build without the V8's mesh)
    b.onclick = () => { if (sel) return; const q = new URLSearchParams(location.search); q.set('car', c); location.search = q.toString(); };
  }
  // Graphics chooser (start screen and pause menu): picking the other mode reloads the page with ?gfx=..., which is saved.
  const gfxNow = GFX === 'fast' ? 'fast' : 'full';
  for (const b of document.querySelectorAll('#gfx .car')) {
    const g = b.dataset.gfx, sel = g === gfxNow; b.classList.toggle('sel', sel); b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    b.onclick = () => { if (sel) return; const q = new URLSearchParams(location.search); q.set('gfx', g); location.search = q.toString(); };
  }
  // Handling chooser, under the graphics: Easy (driving aids, the default) or Realistic. It applies at once and is saved
  // (40_assist.js); the autopilot, the demo lap and the benchmark always drive without the aids.
  UI.hand = $('hand');
  const handMark = () => { for (const b of document.querySelectorAll('#hand .car')) { const sel = (b.dataset.hand === 'easy') === HAND.easy; b.classList.toggle('sel', sel); b.setAttribute('aria-pressed', sel ? 'true' : 'false'); } };
  for (const b of document.querySelectorAll('#hand .car')) b.onclick = () => { handSet(b.dataset.hand === 'easy'); handMark(); };
  handMark();
  if (GAD.on) { $(CARSEL === 'v8' ? 'gcolv8' : 'gcol').style.display = ''; $('pk').textContent = '1 to ' + POSES.length; }
  UI.b0.onclick = () => { if (UI.st === ST.INICIO) { sndStart(); uiSet(ST.JOGO); } else uiResume(); };
  UI.b1.onclick = () => benchStart();
  addEventListener('keydown', uiKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && (UI.st === ST.JOGO || UI.st === ST.FITA || UI.st === ST.BENCH)) uiPause(); });
  addEventListener('gamepadconnected', padCount); addEventListener('gamepaddisconnected', padCount);
  const h = $('hint'); if (h) h.style.display = 'none';
  uiSet(ST.INICIO);
}
// troca de estado: mostra/esconde menu, painel e etiqueta, pausa/retoma o som
function uiSet(st) {
  const menu = st === ST.INICIO || st === ST.PAUSA || st === ST.RESULT;
  UI.st = st; UI.el.style.display = menu ? 'flex' : 'none'; UI.el.className = st === ST.INICIO ? 'ini' : '';
  UI.b0.textContent = st === ST.INICIO ? 'Start' : st === ST.RESULT ? 'Back to driving' : 'Resume';
  UI.b1.style.display = st === ST.INICIO ? 'none' : ''; UI.b1.textContent = st === ST.RESULT ? 'Run the benchmark again' : 'Benchmark';
  UI.res.style.display = st === ST.RESULT ? 'block' : 'none'; UI.cars.style.display = st === ST.INICIO ? 'flex' : 'none';
  if (UI.maps) UI.maps.style.display = UI.cars.style.display;
  if (UI.gfx) UI.gfx.style.display = st === ST.INICIO || st === ST.PAUSA ? 'flex' : 'none';
  UI.tag.textContent = st === ST.BENCH ? 'Benchmark: 60 s demo lap · Esc cancels' : st === ST.FITA ? 'Demo lap · R takes the wheel · Esc menu' : st === ST.POSE ? 'Pose ' + (UI.pose + 1) + ' · ' + (POSES[UI.pose].label || POSES[UI.pose].nome) + ' · 1 to ' + POSES.length + ' switch · Esc back to driving' : '';
  UI.tag.style.display = UI.tag.textContent ? 'block' : 'none';
  hudShow(st === ST.JOGO || st === ST.FITA || (st === ST.PAUSA && UI.back !== ST.BENCH));
  sndRun(st === ST.JOGO || st === ST.FITA || st === ST.BENCH);
  if (menu) UI.b0.focus(); else UI.b0.blur();
  _lastT = 0;
}
function uiPause() { if (UI.st === ST.BENCH) benchStop(); UI.back = UI.st === ST.FITA ? ST.FITA : ST.JOGO; uiSet(ST.PAUSA); }
function uiResume() {
  if (UI.st === ST.RESULT || UI.st === ST.POSE) uiDrive(); else if (UI.st === ST.PAUSA) uiSet(UI.back);
}
// volta ao volante: carro no grid, câmeras e simulação soltas
function uiDrive() { GS.frozen = false; GS.freeCam = false; GS.replayOn = false; gameRestart(); uiSet(ST.JOGO); }
function uiReplay() { if (!GS.replayLen) return; GS.frozen = false; GS.freeCam = false; GS.replayOn = true; gameRestart(); uiSet(ST.FITA); }
function uiPose(i) { if (UI.st === ST.BENCH) benchStop(); UI.pose = i; poseApply(i); GS.replayOn = false; uiSet(ST.POSE); }
function uiKey(e) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const c = e.code, st = UI.st;
  if (c === 'KeyM') { sndMute(!SND.mute); return; }
  if (c === 'KeyH') { UI.stats = !UI.stats; hudStats(UI.stats); if (st !== ST.BENCH) perfAttach(UI.stats, 12); return; }
  if (st === ST.INICIO) return;                                   // na tela de início só o botão começa o jogo (e o som)
  if (c === 'Escape') { if (st === ST.JOGO || st === ST.FITA || st === ST.BENCH) uiPause(); else uiResume(); e.preventDefault(); }
  else if (c === 'KeyB') benchStart();
  else if (c === 'KeyF') uiReplay();
  else if (c === 'KeyR' && st === ST.FITA) uiDrive();
  else if (c.length === 6 && c.startsWith('Digit') && c[5] >= '1' && +c[5] <= POSES.length) uiPose(+c[5] - 1);
}
// ---- benchmark: a volta roteirizada de 60 s em tempo real, sem painel, medindo tempo de quadro e (se houver) tempo de GPU
function benchStart() {
  if (!GS.replayLen || UI.st === ST.INICIO) return;
  GS.frozen = false; GS.freeCam = false; GS.replayOn = true; gameRestart(); UI.bench = null; UI.benchN++; UI.res.innerHTML = '<h2>Benchmark · calculating…</h2>';
  perfAttach(true, 1); perfStart(); uiSet(ST.BENCH);
}
function benchStop() { PERF.rec = false; perfAttach(UI.stats, 12); GS.replayOn = false; }
function benchEnd() {
  const id = UI.benchN; PERF.rec = false; uiSet(ST.RESULT);
  setTimeout(() => {   // espera as últimas leituras de tempo de GPU chegarem
    if (id !== UI.benchN || UI.st !== ST.RESULT) return;
    const r = perfReport(), stat = a => { a = a.slice(5).filter(x => x > 0).sort((p, q) => p - q); const n = a.length; return n ? { n, media: a.reduce((p, q) => p + q, 0) / n, p99: a[Math.min(n - 1, Math.round(0.99 * (n - 1)))], max: a[n - 1], acima: a.filter(x => Math.round(x * 10) > 167).length } : null; };   // acima: quadros que passaram de 16,7 ms (na resolução de 0,1 ms do relógio)
    const q = stat(r.raf), g = PERF.qs ? stat(r.gpu) : null, f = x => x.toFixed(2);
    benchStop(); gameRestart();
    UI.bench = { quadros: r.n, quadro_ms: q, gpu_ms: g, fps: q ? 1000 / q.media : 0, acima_16_7: q ? q.acima : 0, gpu_acima_16_7: g ? g.acima : null, tick: 3600, resolucao: G.W + '×' + G.H };
    const row = (n, s) => '<tr><th>' + n + '</th>' + (s ? '<td>' + f(s.media) + '</td><td>' + f(s.p99) + '</td><td>' + f(s.max) + '</td>' : '<td colspan=3>not available in this browser</td>') + '</tr>';
    UI.res.innerHTML = '<h2>Benchmark · 60 s demo lap · ' + G.W + '×' + G.H + '</h2><table><tr><th></th><th>average (ms)</th><th>99th percentile (ms)</th><th>maximum (ms)</th></tr>' + row('Frame time', q) + row('GPU time', g) + '</table>' +
      '<p>' + (q ? q.acima + ' of ' + q.n + ' frames took longer than 16.7 ms' + (g ? ' · ' + g.acima + ' took more than 16.7 ms of GPU time' : '') + ' · ' + f(1000 / q.media) + ' frames per second' : '') + '</p>';
  }, 400);
}
// ---- controle (Gamepad API, layout padrão). Só é consultado enquanto houver um controle ligado.
function padCount() { let n = 0; const l = navigator.getGamepads ? navigator.getGamepads() : []; for (let i = 0; i < l.length; i++) if (l[i] && l[i].connected) n++; UI.padN = n; if (!n) { GS.padKeys = 0; UI.padPrev = 0; } }
// A API devolve um retrato novo dos controles a cada consulta (vetor e números criados pelo navegador): fica isolado aqui.
const PADR = new Float64Array(3), PADB = new Int32Array(1);
function apiGamepad() {
  const l = navigator.getGamepads(); let p = null;
  for (let i = 0; i < l.length; i++) { const g = l[i]; if (g && g.connected && (!p || (g.mapping === 'standard' && p.mapping !== 'standard'))) p = g; }
  if (!p) { PADB[0] = -1; return; }
  const b = p.buttons, n = b.length; let m = 0; for (let i = 0; i < n && i < 16; i++) if (b[i].pressed) m |= 1 << i;
  PADB[0] = m; PADR[0] = n > 7 ? b[7].value : 0; PADR[1] = n > 6 ? b[6].value : 0; PADR[2] = p.axes.length ? p.axes[0] : 0;
}
// traduz a leitura do controle (PADB, PADR) para as mesmas teclas do jogo + valores analógicos (PADV)
function padPoll() { apiGamepad(); padApply(); }
function padApply() {
  const m = PADB[0]; if (m < 0) { GS.padKeys = 0; return; }
  let k = K_PAD | K_PADS, x = PADR[2]; const rt = PADR[0], lt = PADR[1], ax = x < 0 ? -x : x;
  PADV[0] = rt < 0.04 ? 0 : rt; PADV[1] = lt < 0.04 ? 0 : lt;
  if (ax < 0.12) x = 0; else { const u = (ax - 0.12) / 0.88; x = (x < 0 ? -1 : 1) * u * (0.45 + 0.55 * u); }   // zona morta + curva suave no centro
  PADV[2] = x;
  if (rt > 0.06) k |= K_W; if (lt > 0.06) k |= K_S;
  if (m & 1) k |= K_SPACE; if (m & 8) k |= K_C; if (m & 4) k |= K_R; if (m & 32) k |= K_V;
  // Aston Martin gadgets: B guns, LB smoke screen, Back rams, L3 horn, R3 ejector seat, d-pad up shield, down oil, left plates,
  // right slashers (DB5); the same buttons work the V8's lasers, booster, skis, horn, self-destruct, missiles and spikes
  if (GAD.on && (m & 0xFD12)) k |= ((m & 2) ? K_GGUN : 0) | ((m & 16) ? K_GSMOKE : 0) | ((m & 256) ? K_GRAM : 0) | ((m & 1024) ? K_GHORN : 0) | ((m & 2048) ? K_GEJECT : 0) | ((m & 4096) ? K_GSHIELD : 0) | ((m & 8192) ? K_GOIL : 0) | ((m & 16384) ? K_GPLATE : 0) | ((m & 32768) ? K_GSLASH : 0);
  GS.padKeys = k;
  const edge = m & ~UI.padPrev; UI.padPrev = m;
  if (edge & 516) padMenu(edge);
}
// botões de menu do controle, na borda: Start abre/fecha o menu; X assume o volante durante a volta roteirizada
function padMenu(edge) {
  if (UI.warm) return;
  if (edge & 512) { if (UI.st === ST.JOGO || UI.st === ST.FITA || UI.st === ST.BENCH) uiPause(); else if (UI.st !== ST.INICIO) uiResume(); }
  else if (UI.st === ST.FITA) uiDrive();
}
// Aquece o JIT das funções novas que rodam uma vez por quadro (controle, painel, estatísticas): são baratas, e sem isto o V8
// levaria dezenas de segundos de jogo para otimizá-las — rodando até lá no interpretador, que aloca a cada conta.
// (A parte do som que lê a simulação, sndControl, é aquecida junto com a física em gameWarmup.)
function uiWarmup() {
  const H = HUD, g = H.g, t = H.t, s = H.s, sc = document.createElement('canvas'); sc.width = sc.height = 4; const x = sc.getContext('2d'), V = H.V, rt3 = RT[3];
  const po = PERF.on; UI.warm = true; H.g = H.t = H.s = x; PERF.on = true;
  for (let i = 0; i < 6000; i++) {
    PADB[0] = i % 97 === 0 ? -1 : (i * 7919) & 0xffff; PADR[0] = (i % 50) / 49; PADR[1] = (i % 31) / 60; PADR[2] = Math.sin(i * 0.7); padApply();
    if (i % 2) continue;
    V[0] = (i * 7) % 2100; V[1] = (i * 13) % 7400; V[2] = i % 6; V[3] = (i * 331) % 70000; V[4] = i % 5 ? (i * 17) % 9000 : -1; V[5] = i % 3 ? (i * 19) % 9000 : -1; hudDraw(); hudRead();
    RT[3] = 300 + i % 300; PERF.live[0] = i % 4 ? i % 40 : 0; hudStatsFrame();
  }
  H.g = g; H.t = t; H.s = s; H.K.fill(-9); H.acc.fill(0); RT[3] = rt3; PERF.live[0] = 0; GS.padKeys = 0; UI.padPrev = 0; PADB[0] = -1; PERF.on = po; UI.warm = false;
}
// chamado no começo de cada quadro; devolve true quando o jogo está parado num menu (não simula nem renderiza)
function uiFrame() {
  if (UI.padN) padPoll();
  const st = UI.st;
  return st === ST.INICIO || st === ST.PAUSA || st === ST.RESULT || st === ST.POSE;
}
// chamado depois de simular e renderizar o quadro
function uiAfter() {
  const st = UI.st;
  if (st === ST.BENCH) { if (GS.tick60 >= 3600) benchEnd(); }
  else {
    if (st === ST.FITA && GS.tick60 >= GS.replayLen) { GS.replayOn = false; uiSet(ST.JOGO); }
    if (HUD.vis) hudFrame();
    if (GS.lapNew) { GS.lapNew = false; try { localStorage.setItem(BEST_KEY, LAP[2].toFixed(3)); } catch (e) { /* idem */ } }
  }
  if (HUD.stats) hudStatsFrame();
  sndFrame();
}
