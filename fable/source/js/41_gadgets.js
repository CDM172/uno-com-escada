// Aston Martin DB5 gadgets: shared state (the DB5 only; with the Uno everything here stays at rest).
// The sound code reads GAD.snd and nothing else:
//   GAD.snd[0]  bit flags, valid for the current tick: 1 machine guns firing, 2 smoke screen running, 4 oil spraying,
//               8 a mechanism is moving (servo), 16 horn held
//   GAD.snd[1]  ejector-seat counter: goes up by one every time the seat is fired
//   GAD.snd[2]  end-stop counter: goes up by one every time a mechanism reaches the end of its travel (clunk)
// (The two counters only ever go up while the game runs: they are zero when the game starts and a restart does not touch
//  them. GAD.snd[0] is rewritten by every physics step and cleared by a restart.)
//
// The rest of this file is the gadget logic: one call of gadStep(keys) per physics step (1/120 s) turns the gadget keys into
// mechanism positions (GAD.v, read by the car model in 30_car_e_db5.js), effects (particles, oil on the road: 44_fx.js),
// the flags above and a bit mask of what is active for the status line of the HUD (GAD.act). Nothing is allocated per step.

// Gadget keys: more bits of the same key mask the driving keys use (K_W ... K_PADS take bits 0 to 9, see 40_vehicle.js).
const K_GPLATE = 1 << 10, K_GGUN = 1 << 11, K_GSHIELD = 1 << 12, K_GSLASH = 1 << 13, K_GRAM = 1 << 14, K_GSMOKE = 1 << 15,
  K_GOIL = 1 << 16, K_GEJECT = 1 << 17, K_GHORN = 1 << 18, K_GLAMP = 1 << 19, K_GADGETS = 0xFFC00;
// GAD.v: positions of the mechanisms after the current physics step (GAD.pv: after the previous one, for interpolation)
const GV_PLATE = 0,    // number-plate drums: thirds of a turn (0 = UK plate, 1 = French, 2 = Swiss; fractions while revolving)
  GV_LAMP = 1,         // front indicator lamps folded down, 0..1
  GV_GUN = 2,          // machine-gun barrels slid out, 0..1
  GV_SHIELD = 3,       // rear bullet shield raised, 0..1
  GV_SLASH = 4,        // tyre slashers extended, 0..1
  GV_RAM = 5,          // bumper rams extended, 0..1
  GV_LIGHT = 6,        // headlamps, 0..1
  GV_FLASHL = 7, GV_FLASHR = 8,   // muzzle flash of the left / right gun, 0..1
  GV_SEED = 9,         // random number that changes with every shot (shape of the flash)
  GV_EJECT = 10;       // seconds since the ejector seat was fired (0 = seat and roof panel in place)
// GAD.st: integer state
const GI_PREV = 0, GI_PLATE = 1, GI_GUN = 2, GI_GUNOFF = 3, GI_SHOT = 4, GI_SHIELD = 5, GI_SLASH = 6, GI_RAM = 7, GI_SMOKE = 8,
  GI_EJECT = 9, GI_LIGHT = 10, GI_OIL = 11;
// GAD.act bits (what the status line of the HUD shows)
const GA_PLATE1 = 1, GA_PLATE2 = 2, GA_GUNS = 4, GA_FIRE = 8, GA_SHIELD = 16, GA_SLASH = 32, GA_RAM = 64, GA_SMOKE = 128,
  GA_OIL = 256, GA_EJECT = 512, GA_LIGHT = 1024, GA_HORN = 2048;
// Timing: seconds each mechanism takes from one end stop to the other (index = GV_*), turned into a step per physics tick
const GRATE = new Float64Array([0.55, 0.22, 0.28, 0.9, 0.5, 0.35, 0.12]).map(t => PHYS_DT / t);
const GUN_HOLD = 180,      // physics steps the guns stay out after the key is released (1.5 s)
  SHOT_STEPS = 12,         // physics steps between two shots of one gun: 10 shots a second from each, left and right alternating
  SMOKE_STEPS = 960,       // the smoke screen runs for 8 s
  EJECT_STEPS = 720;       // seat and roof panel are back in place 6 s after the seat was fired
// Oil on the road, for the physics: grip left on it, radius and spacing (m) of the patches the tyres are tested against
const OIL_GRIP = 0.3, OIL_R = 0.75, OIL_STEP = 0.6, OILP_N = 192;
// Ejector seat ballistics, in the frame of the car at the moment of firing: launch speeds (m/s), air drag (1/s), tumbling
// (rad/s) and how far below the launch point each part disappears (m)
const EJ = { seatUp: 11.5, seatBack: 1.2, seatDrag: 0.35, seatSpin: 2.6, seatFloor: 0.9, roofUp: 8.5, roofBack: 4.5, roofDrag: 1.3, roofSpin: 9.5, roofFloor: 1.5 };
const GAD = {
  snd: new Int32Array(4),
  on: CARSEL === 'db5',
  v: new Float32Array(16), pv: new Float32Array(16), st: new Int32Array(16), act: 0,
  oil: new Float32Array(OILP_N * 2), oilN: 0, oilHead: 0, oilLast: new Float64Array(2),   // ring of oil patches [x, z]
  ej: new Float64Array(8),     // launch of the ejector seat: point under the seat [x, y, z], car velocity [x, z], backwards [x, z] (world)
};
// Points of the car where effects are born (car frame, metres): x, y, z each
const GPT = new Float32Array([
  2.13, 0.505, -0.6,      // 0, 1: muzzles of the left and right gun (barrels out)
  2.13, 0.505, 0.6,
  -2.5, 0.28, -0.43,      // 2, 3: left and right pair of exhaust pipes (smoke screen)
  -2.5, 0.28, 0.43,
  -2.44, 0.33, 0,         // 4: oil nozzle under the tail
  -0.3, 0.42, -0.345,     // 5: under the passenger (ejector) seat
  -0.3, 1.3, -0.32,       // 6: middle of the roof panel
]);
// World position of point i of GPT → FXQ[0..2]; velocity of the car in the world → FXQ[3] (x) and FXQ[5] (z); FXQ[4] = 0.
// The body is taken as rigid on the road (heading and slope of the ground; the movement on the springs is ignored).
function gadPoint(i) {
  const V = VEH, P = VP, c = Math.cos(V.yaw), s = Math.sin(V.yaw), ox = -(P.L / 2 - P.a), e = FXQ, o = i * 3;
  const lx = GPT[o], ly = GPT[o + 1], lz = GPT[o + 2];
  e[0] = V.x + c * (ox + lx) - s * lz; e[1] = V.y + ly + lx * V.gPitch + lz * V.gRoll; e[2] = V.z + s * (ox + lx) + c * lz;
  e[3] = V.vx * c - V.vy * s; e[4] = 0; e[5] = V.vx * s + V.vy * c;
}
function gadReset() {
  GAD.v.fill(0); GAD.pv.fill(0); GAD.st.fill(0); GAD.act = 0; GAD.snd[0] = 0; GAD.oilN = 0; GAD.oilHead = 0;
  if (GAD.on && typeof fxOilReset === 'function') fxOilReset();
}
// moves v[i] towards 1 (out) or 0; returns 1 while it is moving and counts a clunk when it reaches the end stop
function gadSlide(i, out) {
  const v = GAD.v, x = v[i], d = GRATE[i];
  if (out) { if (x >= 1) return 0; if (x + d >= 1) { v[i] = 1; GAD.snd[2]++; return 0; } v[i] = x + d; return 1; }
  if (x <= 0) return 0; if (x - d <= 0) { v[i] = 0; GAD.snd[2]++; return 0; } v[i] = x - d; return 1;
}
// Where an ejected part is, EJQ[0] seconds after the launch: displacement from its launch point → EJQ[1..3] (world).
// part 0 = seat, 1 = roof panel. Uses the launch record GAD.ej (velocity of the car and its backwards direction).
const EJQ = new Float64Array(4);
function gadEjectD(part) {
  const t = EJQ[0], j = GAD.ej;
  if (part === 0) {
    const k = EJ.seatDrag, h = (1 - Math.exp(-k * t)) / k;
    EJQ[1] = (j[3] + j[5] * EJ.seatBack) * h; EJQ[2] = EJ.seatUp * t - 4.905 * t * t; EJQ[3] = (j[4] + j[6] * EJ.seatBack) * h;
  } else {
    const k = EJ.roofDrag, h = (1 - Math.exp(-k * t)) / k, vt = 9.81 / k;
    EJQ[1] = (j[3] + j[5] * EJ.roofBack) * h; EJQ[2] = (EJ.roofUp + vt) * h - vt * t; EJQ[3] = (j[4] + j[6] * EJ.roofBack) * h;
  }
}
// one physics step of the gadgets; keys = key mask of this step (the gadget bits K_G*)
function gadStep(keys) {
  const v = GAD.v, st = GAD.st, e = FXQ, V = VEH, K = 1 / 65536;
  GAD.pv.set(v);
  const edge = keys & ~st[GI_PREV]; st[GI_PREV] = keys;
  let snd = 0, moving = 0, act = 0;
  // --- revolving number plates: each press turns both drums a third of a turn
  if (edge & K_GPLATE) st[GI_PLATE]++;
  {
    const tgt = st[GI_PLATE], x = v[GV_PLATE];
    if (x < tgt) { const d = GRATE[GV_PLATE]; if (x + d >= tgt) { v[GV_PLATE] = tgt; GAD.snd[2]++; } else { v[GV_PLATE] = x + d; moving = 1; } }
    else if (tgt >= 3) { st[GI_PLATE] = tgt - 3; v[GV_PLATE] = x - 3; GAD.pv[GV_PLATE] = x - 3; }   // at rest after a full turn: the same position
    const shown = st[GI_PLATE] % 3; if (shown === 1) act |= GA_PLATE1; else if (shown === 2) act |= GA_PLATE2;
  }
  // --- machine guns: the lamps fold down, the barrels slide out, they fire while the key is held and go back 1.5 s after it is released
  {
    const held = (keys & K_GGUN) !== 0;
    if (held) { st[GI_GUN] = 1; st[GI_GUNOFF] = 0; }
    else if (st[GI_GUN] === 1 && ++st[GI_GUNOFF] > GUN_HOLD) st[GI_GUN] = 0;
    if (st[GI_GUN] === 1) { if (v[GV_LAMP] < 1) moving |= gadSlide(GV_LAMP, true); else moving |= gadSlide(GV_GUN, true); }
    else if (v[GV_GUN] > 0) moving |= gadSlide(GV_GUN, false); else moving |= gadSlide(GV_LAMP, false);
    if (v[GV_LAMP] > 0) act |= GA_GUNS;
    if (held && v[GV_GUN] >= 1) {
      snd |= 1; act |= GA_FIRE;
      const n = st[GI_SHOT]++, ph = n % SHOT_STEPS, ph2 = (n + (SHOT_STEPS >> 1)) % SHOT_STEPS;
      v[GV_FLASHL] = ph < 4 ? 1 - ph * 0.25 : 0; v[GV_FLASHR] = ph2 < 4 ? 1 - ph2 * 0.25 : 0;
      if (ph === 0 || ph2 === 0) {
        // a shot: new shape for the flash, three tracer dots in a row and a wisp of smoke
        const side = ph === 0 ? 0 : 1, c = Math.cos(V.yaw), s = Math.sin(V.yaw);
        v[GV_SEED] = fxRnd() * K;
        for (let k = 0; k < 3; k++) {
          gadPoint(side); const back = k * 0.9;
          e[0] -= c * back; e[2] -= s * back; e[3] += c * 150; e[4] = 150 * V.gPitch + (fxRnd() * K - 0.5) * 1.5; e[5] += s * 150;
          e[6] = 0.32; e[7] = 0.07; e[8] = 5; fxEmitQ();
        }
        gadPoint(side); e[3] = e[3] * 0.6 + (fxRnd() * K - 0.5); e[4] = 0.6; e[5] = e[5] * 0.6 + (fxRnd() * K - 0.5); e[6] = 0.5; e[7] = 0.09; e[8] = 3; fxEmitQ();
      }
    } else { st[GI_SHOT] = 0; v[GV_FLASHL] = 0; v[GV_FLASHR] = 0; }
  }
  // --- toggles: bullet shield, tyre slashers, bumper rams, headlamps
  if (edge & K_GSHIELD) st[GI_SHIELD] ^= 1;
  if (edge & K_GSLASH) st[GI_SLASH] ^= 1;
  if (edge & K_GRAM) st[GI_RAM] ^= 1;
  if (edge & K_GLAMP) st[GI_LIGHT] ^= 1;
  moving |= gadSlide(GV_SHIELD, st[GI_SHIELD] === 1) | gadSlide(GV_SLASH, st[GI_SLASH] === 1) | gadSlide(GV_RAM, st[GI_RAM] === 1);
  { const x = v[GV_LIGHT], d = GRATE[GV_LIGHT]; v[GV_LIGHT] = st[GI_LIGHT] === 1 ? (x + d > 1 ? 1 : x + d) : (x - d < 0 ? 0 : x - d); }   // (a lamp, not a mechanism: no servo, no clunk)
  if (v[GV_SHIELD] > 0) act |= GA_SHIELD;
  if (v[GV_SLASH] > 0) act |= GA_SLASH;
  if (v[GV_RAM] > 0) act |= GA_RAM;
  if (st[GI_LIGHT] === 1) act |= GA_LIGHT;
  // --- smoke screen: 8 s of dense white smoke from the exhausts; the key again stops it
  if (edge & K_GSMOKE) st[GI_SMOKE] = st[GI_SMOKE] > 0 ? 0 : SMOKE_STEPS;
  if (st[GI_SMOKE] > 0) {
    const n = st[GI_SMOKE]--; snd |= 2; act |= GA_SMOKE;
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    gadPoint(2 + (n & 1));
    e[0] += (fxRnd() * K - 0.5) * 0.2; e[1] += (fxRnd() * K) * 0.15; e[2] += (fxRnd() * K - 0.5) * 0.2;
    e[3] = e[3] * 0.22 - c * 2.2 + (fxRnd() * K - 0.5) * 1.6; e[4] = 0.25 + (fxRnd() * K) * 0.9; e[5] = e[5] * 0.22 - s * 2.2 + (fxRnd() * K - 0.5) * 1.6;
    e[6] = 2.8 + (fxRnd() * K) * 1.6; e[7] = 0.34 + (fxRnd() * K) * 0.22; e[8] = 3; fxEmitQ();
  }
  // --- oil: sprays while the key is held and leaves a slick on the road that tyres slide on (this car's too, next time round)
  if (keys & K_GOIL) {
    snd |= 4; act |= GA_OIL;
    const c = Math.cos(V.yaw), s = Math.sin(V.yaw);
    gadPoint(4);
    const x = e[0], z = e[2], L = GAD.oilLast, dx = x - L[0], dz = z - L[1];
    if (st[GI_OIL] === 0 || dx * dx + dz * dz > OIL_STEP * OIL_STEP) {
      const o = GAD.oilHead * 2; GAD.oil[o] = x; GAD.oil[o + 1] = z; GAD.oilHead = (GAD.oilHead + 1) % OILP_N; if (GAD.oilN < OILP_N) GAD.oilN++;
      L[0] = x; L[1] = z;
    }
    st[GI_OIL] = 1;
    // the ribbon on the road (44_fx.js): centre, direction across and cross slope, taken from the road under the rear wheels
    // and carried back to the tail (so it lies flat on banked corners and on gradients)
    const yl = V.wy[2] + (V.wy[2] - V.wy[0]) * 0.5, yr = V.wy[3] + (V.wy[3] - V.wy[1]) * 0.5;
    e[0] = x; e[1] = (yl + yr) * 0.5 + 0.012; e[2] = z; e[3] = -s; e[4] = (yr - yl) / VP.tw; e[5] = c; fxOilLay(1);
    // spray under the tail
    gadPoint(4);
    { const j = (fxRnd() * K - 0.5) * 0.5; e[0] -= s * j; e[2] += c * j; }
    e[3] = e[3] * 0.5 - c * 3 + (fxRnd() * K - 0.5) * 2.5; e[4] = -0.2 + (fxRnd() * K) * 0.8; e[5] = e[5] * 0.5 - s * 3 + (fxRnd() * K - 0.5) * 2.5;
    e[6] = 0.35 + (fxRnd() * K) * 0.25; e[7] = 0.1 + (fxRnd() * K) * 0.08; e[8] = 4; fxEmitQ();
  } else if (st[GI_OIL] === 1) { st[GI_OIL] = 0; fxOilLay(0); }
  // --- ejector seat: the car model flies the seat and the roof panel (30_car_e_db5.js); here the clock, the smoke and the sound
  if ((edge & K_GEJECT) && st[GI_EJECT] === 0) {
    const j = GAD.ej; st[GI_EJECT] = 1; GAD.snd[1]++;
    gadPoint(5); j[0] = e[0]; j[1] = e[1]; j[2] = e[2]; j[3] = e[3]; j[4] = e[5]; j[5] = -Math.cos(V.yaw); j[6] = -Math.sin(V.yaw);
  }
  if (st[GI_EJECT] > 0) {
    const n = st[GI_EJECT]++, t = n * PHYS_DT; v[GV_EJECT] = t; act |= GA_EJECT;
    if (n < 90) {
      // a puff where the roof panel was, then the rocket smoke under the seat as it climbs
      const j = GAD.ej;
      if (n < 8) gadPoint(6);
      else { EJQ[0] = t; gadEjectD(0); e[0] = j[0] + EJQ[1]; e[1] = j[1] + EJQ[2]; e[2] = j[2] + EJQ[3]; e[3] = j[3]; e[5] = j[4]; }
      e[0] += (fxRnd() * K - 0.5) * 0.3; e[2] += (fxRnd() * K - 0.5) * 0.3;
      e[3] = e[3] * 0.7 + (fxRnd() * K - 0.5) * 2; e[4] = n < 8 ? 2.5 : -2.5 + (fxRnd() * K) * 1.5; e[5] = e[5] * 0.7 + (fxRnd() * K - 0.5) * 2;
      e[6] = 0.7 + (fxRnd() * K) * 0.7; e[7] = 0.13 + (fxRnd() * K) * 0.1; e[8] = 3; fxEmitQ();
    }
    if (n >= EJECT_STEPS) { st[GI_EJECT] = 0; v[GV_EJECT] = 0; GAD.snd[2]++; }   // seat and panel are back in place
  }
  if (keys & K_GHORN) { snd |= 16; act |= GA_HORN; }
  GAD.snd[0] = snd | (moving ? 8 : 0); GAD.act = act;
}
// Grip multiplier of wheel i from the oil on the road (the physics only calls it while there is oil: GAD.oilN > 0)
function gadOilGrip(i) {
  const x = VEH.wx[i], z = VEH.wz[i], o = GAD.oil, n = GAD.oilN * 2, r2 = OIL_R * OIL_R;
  for (let k = 0; k < n; k += 2) { const dx = o[k] - x, dz = o[k + 1] - z; if (dx * dx + dz * dz < r2) return OIL_GRIP; }
  return 1;
}
