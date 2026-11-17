// Aston Martin V8 Vantage (1987, the winterised hardtop): gadget logic. One call of gadStepV8(keys) per physics step; the
// shared state, the contract with the sound code (GAD.snd) and the DB5's gadgets are in 41_gadgets.js. Nothing here
// allocates. The keys are the bits of 41_gadgets.js, from the same keys and pad buttons as the DB5's:
//   G (K_GGUN, held)       hubcap lasers: the emitters telescope out of the front hubs and fire sideways while held
//   K (K_GSHIELD)          a missile from behind a fog lamp: its cover swings away, left and right take turns, two per load,
//                          then 10 s to reload; they fly straight ahead and explode on the ground, a barrier or at the end
//                          of their range
//   T (K_GSLASH)           spiked tyres (toggle): more grip on grass, gravel and oil, a little less on asphalt
//   U (K_GRAM)             outrigger skis (toggle): less body roll and lateral load transfer, more grip off the asphalt, drag
//   J (K_GSMOKE)           rocket booster: the rear number plate flips down, 3 s of thrust, then 15 s to recharge
//   E (K_GEJECT, held 2 s) self-destruct: an explosion, and the car comes back on the track
//   Q (K_GHORN, held)      horn            L (K_GLAMP)  headlamps
// GAD.v of the V8 (positions after the current physics step, 0..1 unless said; GAD.pv: after the previous one)
const V8_COVL = 0, V8_COVR = 1,   // fog-lamp covers swung away (left, right)
  V8_LASER = 2,         // laser emitters telescoped out of the front hubs
  V8_BEAM = 3,          // the beams are on (0 or 1)
  V8_SPIKE = 4,         // studs out of the tyre treads
  V8_SKI = 5,           // outrigger skis out
  // 6 = GV_LIGHT: headlamps, as with the DB5 (45_game.js reads it)
  V8_PLATE = 7,         // rear number plate flipped down
  V8_NOZZLE = 8,        // booster nozzle out behind the plate
  V8_BURN = 9,          // booster thrust and flame
  V8_DESTRUCT = 10,     // self-destruct countdown (share of the 2 s the key has been held)
  V8_BEAML = 11, V8_BEAMR = 12,   // length of each laser beam (m)
  V8_HUD = 13,          // head-up display (fades in and out)
  V8_CHARGE = 14,       // booster charge (1 = ready)
  V8_RELOAD = 15,       // missile reload (1 = loaded)
  V8_MSLL = 16, V8_MSLR = 17;   // missile slid forwards in its tube, ready to go (left, right)
// GAD.st of the V8 (0 is GI_PREV: the keys of the previous step)
const V8I_SIDE = 1,     // side the next missile leaves from (0 left, 1 right)
  V8I_CLOSEL = 2, V8I_CLOSER = 3,   // steps until the cover of that side closes again after a launch
  V8I_RELOAD = 4,       // steps of reload left
  V8I_LASERT = 5,       // steps the emitters stay out after the key is released
  V8I_SPIKE = 6, V8I_SKI = 7, V8I_LIGHT = 8,   // toggles
  V8I_ROCKET = 9,       // booster: 0 at rest, 1 plate and nozzle going out, 2 burning, 3 going back in
  V8I_BURNT = 10,       // steps of burn left
  V8I_DESTRUCT = 11,    // steps the self-destruct key has been held
  V8I_HIDDEN = 12,      // steps left before the blown-up car is back on the track
  V8I_HUD = 13,         // steps the head-up display stays up after the last use of a weapon
  V8I_FIRED = 14;       // missiles fired from this load
// GAD.act of the V8 (status line of the HUD, 51_painel.js; the order of the labels follows these bits)
const V8A_LASER = 1, V8A_FIRE = 2, V8A_MISSILE = 4, V8A_RELOAD = 8, V8A_SPIKE = 16, V8A_SKI = 32, V8A_ROCKET = 64,
  V8A_RECHARGE = 128, V8A_DESTRUCT = 256, V8A_LIGHT = 512, V8A_HORN = 1024;
// Mechanisms: seconds from one end stop to the other (index = V8_*), as a step per physics tick
const V8RATE = new Float64Array([0.22, 0.22, 0.3, 0, 0.5, 0.7, 0.12, 0.3, 0.2, 0.15, 0, 0, 0, 0.25, 0, 0, 0.2, 0.2, 0, 0, 0, 0, 0, 0]).map(t => t > 0 ? PHYS_DT / t : 0);
const V8T = {
  laserHold: 120,       // the emitters go back in 1 s after the key is released
  coverOpen: 96,        // a cover stays open 0.8 s after its missile left
  reload: 1200,         // 10 s to reload both missiles
  burn: 360,            // 3 s of booster thrust ...
  recharge: 1 / 1800,   // ... then 15 s to recharge (charge per step)
  destruct: 240,        // hold E for 2 s
  hidden: 180,          // the car is gone for 1.5 s
  hud: 720,             // the head-up display stays up 6 s after a weapon was used
  thrust: 10500,        // booster thrust (N): about 0.55 g on this 1.9 t car
  skiDrag: 0.5 * 1.2 * 0.3,   // ½ρ·area of the skis out (m²: 0.3)
  misV0: 18, misAcc: 85, misVmax: 170, misRange: 400, misRangeView: 60, misTmax: 6,   // missile: launch speed over the car's (m/s), acceleration, top speed, range (m)
  beamMax: 40, beamView: 30,  // longest laser beam (m), and in the car viewer
};
// Missiles: GAD.mis[side * 16 + ...]
const MS_STATE = 0,     // 0 in its bay, 1 the cover is opening, 2 flying, 3 gone (bay empty until the reload)
  MS_DIST = 1, MS_PDIST = 2,   // distance flown after the current and the previous step (m)
  MS_P0 = 3,            // world position of its centre at the launch (3)
  MS_DIR = 6,           // direction of flight (3), the car's forward axis at the launch
  MS_YAW = 9, MS_PITCH = 10,   // heading and pitch of the car at the launch (for the model: 30_car_f_v8.js)
  MS_V0 = 11, MS_T = 12, MS_HINT = 13;   // launch speed, time in flight, track sample near it (search hint)
const MQ = new Float64Array(12);   // register of the missile ground query

function v8Reset() {
  const v = GAD.v, st = GAD.st; v[V8_CHARGE] = 1; v[V8_RELOAD] = 1; GAD.pv[V8_CHARGE] = 1; GAD.pv[V8_RELOAD] = 1;
  v[V8_BEAML] = v[V8_BEAMR] = V8T.beamMax; st[V8I_SIDE] = 0;
  GAD.rate = V8RATE;
}
// Ground under the point (MQ[0], MQ[1]), with the track sample MQ[9] as search hint: MQ[8] = height of the road or the
// terrain, MQ[7] = how far the point is beyond the barrier on its side (> 0: it hit it), MQ[9] = the new hint.
function v8GroundQ() {
  const q = MQ;
  trackLocateQ(q[9] | 0, q); if (q[3] > 90 || q[3] < -90) trackLocateQ(-1, q);
  const i0 = q[4] | 0, f = q[5], d = q[3], ad = d < 0 ? -d : d, i1 = (i0 + 1) % TRK.N, lim = TRK.hw + APRON, bar = d < 0 ? TRK.barL : TRK.barR;
  q[9] = i0; q[7] = ad - (bar[i0] + (bar[i1] - bar[i0]) * f - 0.25);
  if (ad <= lim) q[8] = TRK.y[i0] + (TRK.y[i1] - TRK.y[i0]) * f - d * (TRK.bank[i0] + (TRK.bank[i1] - TRK.bank[i0]) * f);
  else { hfAtQ(q); q[8] = q[6]; }
}
// a missile leaves the bay on side s: from the centre of the missile, along the car's forward axis
function v8Launch(s) {
  const V = VEH, M = GAD.mis, o = s * 16, P = VP, c = Math.cos(V.yaw), sn = Math.sin(V.yaw), cp = Math.cos(V.gPitch), sp = Math.sin(V.gPitch), ox = -(P.L / 2 - P.a), g = s * 3;
  const lx = GPT[g] + V8G.misSlide, ly = GPT[g + 1], lz = GPT[g + 2];   // (from where it slid to)
  // car frame at the launch (heading and slope of the road): X = (c·cp, sp, s·cp), Y = (-c·sp, cp, -s·sp), Z = (-s, 0, c)
  M[o + MS_P0] = V.x + c * ox + c * cp * lx - c * sp * ly - sn * lz;
  M[o + MS_P0 + 1] = V.y + sp * lx + cp * ly;
  M[o + MS_P0 + 2] = V.z + sn * ox + sn * cp * lx - sn * sp * ly + c * lz;
  M[o + MS_DIR] = c * cp; M[o + MS_DIR + 1] = sp; M[o + MS_DIR + 2] = sn * cp;
  M[o + MS_YAW] = V.yaw; M[o + MS_PITCH] = V.gPitch; M[o + MS_V0] = (V.vx > 0 ? V.vx : 0) + V8T.misV0;
  M[o + MS_T] = 0; M[o + MS_DIST] = 0; M[o + MS_PDIST] = 0; M[o + MS_HINT] = V.hint; M[o + MS_STATE] = 2; GAD.v[V8_MSLL + s] = 0; GAD.pv[V8_MSLL + s] = 0;
  GAD.snd[1]++; GAD.st[V8I_CLOSEL + s] = V8T.coverOpen; GAD.st[V8I_SIDE] = 1 - s;
  if (++GAD.st[V8I_FIRED] >= 2) { GAD.st[V8I_FIRED] = 0; GAD.st[V8I_RELOAD] = V8T.reload; }
  // a puff of smoke out of the bay
  const e = FXQ, K = 1 / 65536;
  for (let k = 0; k < 6; k++) {
    e[0] = M[o + MS_P0] + (fxRnd() * K - 0.5) * 0.2; e[1] = M[o + MS_P0 + 1] + (fxRnd() * K - 0.5) * 0.1; e[2] = M[o + MS_P0 + 2] + (fxRnd() * K - 0.5) * 0.2;
    e[3] = V.vx * c * 0.7 + (fxRnd() * K - 0.5) * 3; e[4] = 0.3 + (fxRnd() * K) * 0.8; e[5] = V.vx * sn * 0.7 + (fxRnd() * K - 0.5) * 3;
    e[6] = 1 + (fxRnd() * K) * 0.8; e[7] = 0.16 + (fxRnd() * K) * 0.1; e[8] = 10; fxEmitQ();
  }
}
// the missiles in flight: straight ahead, faster and faster; smoke trail; explosion on whatever they meet
function v8Missiles() {
  const M = GAD.mis, e = FXQ, K = 1 / 65536, dt = PHYS_DT, world = GAME.mode !== 'car', range = world ? V8T.misRange : V8T.misRangeView;
  for (let s = 0; s < 2; s++) {
    const o = s * 16; if (M[o + MS_STATE] !== 2) continue;
    const t = M[o + MS_T] + dt; M[o + MS_T] = t;
    let sp = M[o + MS_V0] + V8T.misAcc * t; if (sp > V8T.misVmax) sp = V8T.misVmax;
    const dist = M[o + MS_DIST] + sp * dt; M[o + MS_DIST] = dist;
    const dx = M[o + MS_DIR], dy = M[o + MS_DIR + 1], dz = M[o + MS_DIR + 2];
    const x = M[o + MS_P0] + dx * dist, y = M[o + MS_P0 + 1] + dy * dist, z = M[o + MS_P0 + 2] + dz * dist;
    // smoke trail and the flame of the motor, behind the missile
    e[0] = x - dx * 0.35; e[1] = y - dy * 0.35; e[2] = z - dz * 0.35; e[3] = -dx * 20; e[4] = -dy * 20; e[5] = -dz * 20;
    e[6] = 0.06 + (fxRnd() * K) * 0.04; e[7] = 0.1; e[8] = 9; fxEmitQ();
    if ((fxRnd() & 1) === 0) {
      e[0] = x - dx * 0.5 + (fxRnd() * K - 0.5) * 0.1; e[1] = y - dy * 0.5 + (fxRnd() * K - 0.5) * 0.1; e[2] = z - dz * 0.5 + (fxRnd() * K - 0.5) * 0.1;
      e[3] = (fxRnd() * K - 0.5) * 0.8; e[4] = 0.2 + (fxRnd() * K) * 0.4; e[5] = (fxRnd() * K - 0.5) * 0.8;
      e[6] = 1.4 + (fxRnd() * K) * 0.8; e[7] = 0.13 + (fxRnd() * K) * 0.06; e[8] = 10; fxEmitQ();
    }
    // what it meets: the ground (the road or the terrain), a barrier (the track's walls and buildings stand behind them)
    let hit = dist > range || t > V8T.misTmax;
    if (world) { MQ[0] = x; MQ[1] = z; MQ[9] = M[o + MS_HINT]; v8GroundQ(); M[o + MS_HINT] = MQ[9]; if (y < MQ[8] + 0.03 || MQ[7] > 0) hit = true; }
    else if (y < 0.03) hit = true;
    if (hit) { const b = BOOMQ; b[0] = x; b[1] = y > (world ? MQ[8] : 0) ? y : (world ? MQ[8] : 0) + 0.05; b[2] = z; b[3] = 1; fxBoom(); GAD.snd[3]++; M[o + MS_STATE] = 3; }
  }
}
// laser beams: from each front hub sideways, as far as the barrier on that side (sparks where they hit)
function v8Beams() {
  const V = VEH, v = GAD.v, e = FXQ, K = 1 / 65536, c = Math.cos(V.yaw), sn = Math.sin(V.yaw);
  for (let s = 0; s < 2; s++) {
    let len = GAME.mode === 'car' ? V8T.beamView : V8T.beamMax;
    gadPoint(4 + s);
    const hx = e[0], hy = e[1], hz = e[2], bx = s ? -sn : sn, bz = s ? c : -c;   // beam direction: the car's left or right
    if (GAME.mode !== 'car' && V.hint >= 0) {
      const i = V.hint, tx = TRK.tx[i], tz = TRK.tz[i], k = bx * -tz + bz * tx, dh = V.d + (hx - V.x) * -tz + (hz - V.z) * tx;
      if (k > 0.15) len = (TRK.barR[i] - 0.25 - dh) / k; else if (k < -0.15) len = (TRK.barL[i] - 0.25 + dh) / -k;
      if (len < 0.3) len = 0.3; else if (len > V8T.beamMax) len = V8T.beamMax;
    }
    v[V8_BEAML + s] = len;
    if (len < V8T.beamMax && GAME.mode !== 'car' && (fxRnd() & 3) === 0) {   // sparks off the barrier
      const px = hx + bx * len, py = hy, pz = hz + bz * len;
      for (let k = 0; k < 2; k++) {
        e[0] = px; e[1] = py; e[2] = pz;
        e[3] = -bx * (1 + (fxRnd() * K) * 3) + (fxRnd() * K - 0.5) * 5; e[4] = 1 + (fxRnd() * K) * 4; e[5] = -bz * (1 + (fxRnd() * K) * 3) + (fxRnd() * K - 0.5) * 5;
        e[6] = 0.25 + (fxRnd() * K) * 0.35; e[7] = 0.035; e[8] = 8; fxEmitQ();
      }
    }
  }
}
// the self-destruct goes off: the car is blown up and everything on it goes back to rest
function v8Destruct() {
  const v = GAD.v, st = GAD.st, b = BOOMQ, V = VEH;
  gadPoint(3); b[0] = FXQ[0]; b[1] = FXQ[1]; b[2] = FXQ[2]; b[3] = 2.2; fxBoom(); GAD.snd[3]++;
  const light = v[GV_LIGHT], charge = v[V8_CHARGE], reload = v[V8_RELOAD];
  v.fill(0); v[GV_LIGHT] = light; v[V8_CHARGE] = charge; v[V8_RELOAD] = reload; v[V8_BEAML] = v[V8_BEAMR] = V8T.beamMax;
  st[V8I_LASERT] = 0; st[V8I_SPIKE] = 0; st[V8I_SKI] = 0; st[V8I_ROCKET] = 0; st[V8I_BURNT] = 0; st[V8I_DESTRUCT] = 0; st[V8I_HUD] = 0;
  st[V8I_CLOSEL] = 0; st[V8I_CLOSER] = 0;
  for (let s = 0; s < 2; s++) if (GAD.mis[s * 16 + MS_STATE] === 1) GAD.mis[s * 16 + MS_STATE] = 0;   // (a missile half out goes back in its tube)
  st[V8I_HIDDEN] = V8T.hidden; GAD.hidden = 1; V.vx = 0; V.vy = 0; V.r = 0;
}
// back on the track after the self-destruct (in the car viewer: back at the middle of the floor)
function v8Respawn() {
  GAD.hidden = 0;
  if (GAME.mode === 'car') { VEH.x = 0; VEH.vx = 0; return; }
  const V = VEH; vehicleReset(V.s, clamp(V.d, -2, 2), 0); GS.cut = true; GS.chaseInit = false;
}
// one physics step of the V8's gadgets; keys = key mask of this step (the gadget bits K_G*)
function gadStepV8(keys) {
  const v = GAD.v, st = GAD.st, M = GAD.mis, e = FXQ, V = VEH, K = 1 / 65536;
  GAD.pv.set(v); M[MS_PDIST] = M[MS_DIST]; M[16 + MS_PDIST] = M[16 + MS_DIST];
  const edge = keys & ~st[GI_PREV]; st[GI_PREV] = keys;
  let snd = 0, moving = 0, act = 0;
  if (st[V8I_HIDDEN] > 0) {
    // blown up: nothing works, the wreck does not move, until the car is put back on the track
    V.vx = 0; V.vy = 0; V.r = 0; act |= V8A_DESTRUCT;
    if (--st[V8I_HIDDEN] === 0) v8Respawn();
    v8Missiles(); GAD.thrust = 0; GAD.forceOn = false; GAD.gripOn = false; GAD.latK = 1; GAD.rollKf = 1; GAD.dragA = 0;
    GAD.snd[0] = 0; GAD.act = act; return;
  }
  // --- missiles: K opens the cover of the next loaded bay; once it is out of the way the missile slides forwards and goes
  if (edge & K_GSHIELD) {
    st[V8I_HUD] = V8T.hud;
    let s = st[V8I_SIDE]; if (M[s * 16 + MS_STATE] !== 0) s = 1 - s;
    if (M[s * 16 + MS_STATE] === 0 && M[(1 - s) * 16 + MS_STATE] !== 1) M[s * 16 + MS_STATE] = 1;
  }
  for (let s = 0; s < 2; s++) {
    const o = s * 16, c = V8I_CLOSEL + s; if (st[c] > 0) st[c]--;
    moving |= gadSlide(V8_COVL + s, M[o + MS_STATE] === 1 || st[c] > 0);
    if (M[o + MS_STATE] === 1 && v[V8_COVL + s] >= 1) { if (v[V8_MSLL + s] < 1) moving |= gadSlide(V8_MSLL + s, true); else v8Launch(s); }
    if (M[o + MS_STATE] === 1 || M[o + MS_STATE] === 2) act |= V8A_MISSILE;
  }
  v8Missiles();
  if (st[V8I_RELOAD] > 0) {
    act |= V8A_RELOAD; v[V8_RELOAD] = 1 - st[V8I_RELOAD] / V8T.reload;
    if (--st[V8I_RELOAD] === 0) { for (let s = 0; s < 2; s++) if (M[s * 16 + MS_STATE] === 3) M[s * 16 + MS_STATE] = 0; v[V8_RELOAD] = 1; GAD.snd[2]++; }
  }
  // --- lasers: the emitters telescope out, the beams are on while the key is held and the emitters are all the way out
  const fire = (keys & K_GGUN) !== 0;
  if (fire) { st[V8I_LASERT] = V8T.laserHold; st[V8I_HUD] = V8T.hud; } else if (st[V8I_LASERT] > 0) st[V8I_LASERT]--;
  moving |= gadSlide(V8_LASER, fire || st[V8I_LASERT] > 0);
  if (v[V8_LASER] > 0) act |= V8A_LASER;
  if (fire && v[V8_LASER] >= 1) { v[V8_BEAM] = 1; snd |= 1; act |= V8A_FIRE; v8Beams(); } else v[V8_BEAM] = 0;
  // --- toggles: spiked tyres, skis, headlamps
  if (edge & K_GSLASH) st[V8I_SPIKE] ^= 1;
  if (edge & K_GRAM) st[V8I_SKI] ^= 1;
  if (edge & K_GLAMP) st[V8I_LIGHT] ^= 1;
  moving |= gadSlide(V8_SPIKE, st[V8I_SPIKE] === 1) | gadSlide(V8_SKI, st[V8I_SKI] === 1);
  { const x = v[GV_LIGHT], d = V8RATE[GV_LIGHT]; v[GV_LIGHT] = st[V8I_LIGHT] === 1 ? (x + d > 1 ? 1 : x + d) : (x - d < 0 ? 0 : x - d); }
  if (v[V8_SPIKE] > 0) act |= V8A_SPIKE;
  if (v[V8_SKI] > 0) act |= V8A_SKI;
  if (st[V8I_LIGHT] === 1) act |= V8A_LIGHT;
  // --- rocket booster: plate down, nozzle out, 3 s of thrust, back in; then it recharges for 15 s
  if ((edge & K_GSMOKE) && st[V8I_ROCKET] === 0 && v[V8_CHARGE] >= 1) st[V8I_ROCKET] = 1;
  const ph = st[V8I_ROCKET];
  if (ph === 1) {
    if (v[V8_PLATE] < 1) moving |= gadSlide(V8_PLATE, true); else if (v[V8_NOZZLE] < 1) moving |= gadSlide(V8_NOZZLE, true);
    else { st[V8I_ROCKET] = 2; st[V8I_BURNT] = V8T.burn; v[V8_CHARGE] = 0; }
  } else if (ph === 2) { if (--st[V8I_BURNT] <= 0) st[V8I_ROCKET] = 3; }
  else if (ph === 3) {
    if (v[V8_NOZZLE] > 0) moving |= gadSlide(V8_NOZZLE, false); else if (v[V8_PLATE] > 0) moving |= gadSlide(V8_PLATE, false); else st[V8I_ROCKET] = 0;
  }
  { const x = v[V8_BURN], d = V8RATE[V8_BURN]; v[V8_BURN] = st[V8I_ROCKET] === 2 ? (x + d > 1 ? 1 : x + d) : (x - d < 0 ? 0 : x - d); }
  if (st[V8I_ROCKET] !== 2 && v[V8_CHARGE] < 1) { const c = v[V8_CHARGE] + V8T.recharge; v[V8_CHARGE] = c > 1 ? 1 : c; }
  const burn = v[V8_BURN];
  if (burn > 0) {
    snd |= 2; act |= V8A_ROCKET;
    // flame out of the nozzle and smoke behind it
    const c = Math.cos(V.yaw), sn = Math.sin(V.yaw);
    for (let k = 0; k < 2; k++) {
      gadPoint(2); e[0] += (fxRnd() * K - 0.5) * 0.06; e[1] += (fxRnd() * K - 0.5) * 0.06; e[2] += (fxRnd() * K - 0.5) * 0.06;
      e[3] -= c * (22 + (fxRnd() * K) * 10) * burn; e[4] = (fxRnd() * K - 0.5) * 2; e[5] -= sn * (22 + (fxRnd() * K) * 10) * burn;
      e[6] = 0.07 + (fxRnd() * K) * 0.06; e[7] = 0.13 + 0.1 * burn; e[8] = 9; fxEmitQ();
    }
    gadPoint(2); e[0] -= c * 0.4; e[2] -= sn * 0.4;
    e[3] = e[3] * 0.25 - c * 5 + (fxRnd() * K - 0.5) * 2; e[4] = 0.4 + (fxRnd() * K) * 0.8; e[5] = e[5] * 0.25 - sn * 5 + (fxRnd() * K - 0.5) * 2;
    e[6] = 1.6 + (fxRnd() * K) * 1.2; e[7] = 0.22 + (fxRnd() * K) * 0.12; e[8] = 10; fxEmitQ();
  } else if (v[V8_CHARGE] < 1) act |= V8A_RECHARGE;
  // --- self-destruct: E held for 2 s
  if (keys & K_GEJECT) { act |= V8A_DESTRUCT; if (++st[V8I_DESTRUCT] >= V8T.destruct) { v8Destruct(); GAD.snd[0] = 0; GAD.act = act; return; } }
  else st[V8I_DESTRUCT] = 0;
  v[V8_DESTRUCT] = st[V8I_DESTRUCT] / V8T.destruct;
  // --- head-up display: up while a weapon is in use and for 6 s after
  const armed = st[V8I_HUD] > 0 || v[V8_BEAM] > 0 || (act & (V8A_MISSILE | V8A_RELOAD | V8A_DESTRUCT)) !== 0;
  if (st[V8I_HUD] > 0) st[V8I_HUD]--;
  { const x = v[V8_HUD], d = V8RATE[V8_HUD]; v[V8_HUD] = armed ? (x + d > 1 ? 1 : x + d) : (x - d < 0 ? 0 : x - d); }
  if (keys & K_GHORN) { snd |= 16; act |= V8A_HORN; }
  // what the physics takes from all this (40_vehicle.js)
  const ski = v[V8_SKI];
  GAD.thrust = V8T.thrust * burn; GAD.dragA = V8T.skiDrag * ski; GAD.forceOn = burn > 0 || ski > 0;
  GAD.latK = 1 - 0.4 * ski; GAD.rollKf = 1 - 0.6 * ski; GAD.gripOn = v[V8_SPIKE] > 0 || ski > 0;
  GAD.snd[0] = snd | (moving ? 8 : 0); GAD.act = act;
}
// grip of tyre i: studs bite into grass, gravel and oil (and lose a little on asphalt); the skis steady the car off the road
function v8Grip(i) {
  const z = VEH.wzone[i], sp = GAD.v[V8_SPIKE], sk = GAD.v[V8_SKI];
  return z === ZONE.GRASS || z === ZONE.GRAVEL || z === ZONE.ROUGH ? 1 + 0.55 * sp + 0.12 * sk : 1 - 0.04 * sp;
}
// the V8's mechanisms move at their own rates, and its booster starts charged and its bays loaded (also in the car viewer,
// where nothing restarts the game)
if (GAD.car === 'v8') v8Reset();
