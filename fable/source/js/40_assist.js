// Driver assists: "Easy handling" (the default for people playing) and "Realistic handling" (none of them). ?handling=easy
// or ?handling=real chooses, the menu does the same, and the choice is remembered. The assists act only while a person
// drives (HAND.on, set by gameStep in 45_game.js): the autopilot, the scripted laps, the benchmark and the poses always
// drive the car as it is, so their laps do not change. With HAND.on false vehicleStep (40_vehicle.js) does exactly the
// arithmetic it always did. What Easy handling adds, for every car:
//   pedals    the throttle comes in over 0.3 s (0.45 s in first gear) instead of at once; the brake over 0.12 s
//   steering  the lock at speed is what the tyres can take, reached in 0.25 s from a key (no snap at 200 km/h)
//   catch     the front wheels turn into a slide by themselves (the DB5 and V8 always do a little; here every car does)
//   grip      8 % more grip in hand
//   traction  no more drive than the driven tyres can take with the cornering they are doing (no wheelspin)
//   ABS       hard braking keeps the wheels turning, and the car still steers
//   stability the brakes stop the car turning faster than the steering asks for, and turn its nose back towards where it
//             is going when it slides; in a spin they stop the rotation and scrub off speed (with less throttle meanwhile)
// Nothing here allocates; numbers go through the register ASQ.
const HAND = (() => {
  let h = Q.get('handling'); try { if (h) localStorage.setItem('handling', h); else h = localStorage.getItem('handling'); } catch (e) { }
  return { easy: h !== 'real', on: false, warm: false };   // warm: the JIT warm-up is running (it drives without assists)
})();
function handSet(easy) { HAND.easy = easy; try { localStorage.setItem('handling', easy ? 'easy' : 'real'); } catch (e) { } }
const ASSIST = {
  muK: 1.08,                // grip in hand
  catchK: 1.0, catchAt: 0.05,   // counter-steer: share of the rear axle's slip angle beyond catchAt (rad)
  lockK: 2.5, lockT: 0.25,   // steering: lock at speed (× the kinematic angle for the grip in hand: the tyres need slip), seconds to full lock from a key
  rampT: 0.3, tc: 1,        // seconds for the throttle to come in (× 1.5 in first gear); traction control on
  escK: 10, betaK: 7, escMax: 0.55,   // stability: gains on the excess yaw rate and on the body slip beyond 8° (1/s); most yaw moment (share of m·g·track)
  thr: 0, brk: 0, cut: 0,   // smoothed pedals; throttle taken away by the stability control
};
const ASQ = new Float64Array(4);
function assistReset() { ASSIST.thr = 0; ASSIST.brk = 0; ASSIST.cut = 0; }
// pedals (VIN: keys or pad) → ASQ[0] throttle, ASQ[1] brake
function assistPedals() {
  const A = ASSIST, dt = PHYS_DT, up = dt / (VEH.gear <= 1 ? A.rampT * 1.5 : A.rampT), dn = dt / 0.06, bu = dt / 0.12, bd = dt / 0.05;
  let d = VIN[0] - A.thr; A.thr += d > up ? up : d < -dn ? -dn : d;
  d = VIN[1] - A.brk; A.brk += d > bu ? bu : d < -bd ? -bd : d;
  ASQ[0] = A.thr * (1 - A.cut); ASQ[1] = A.brk;
}
// steering: ASQ[2] = speed in; out ASQ[2] = target angle of the front wheels, ASQ[3] = most change in this step
function assistSteer(keys) {
  const V = VEH, P = VP, sp = ASQ[2], sIn = VIN[2];
  const A = ASSIST; let m = Math.atan(P.L * 0.9 * P.mu * A.muK * 9.81 / Math.max(sp * sp, 1)) * A.lockK;
  if (m > P.steerMax) m = P.steerMax; else if (m < 0.012) m = 0.012;
  const tgt = sIn * m, toward = sIn !== 0 && (tgt - V.steer) * sIn > 0;
  // keyboard: full lock in 0.25 s, back to the middle in 0.15 s; pad: the stick, a little smoothed
  const rate = (keys & K_PADS) ? 1.5 + 4 * m : toward ? (m > 0.0125 ? m / A.lockT : 0.05) : (m > 0.015 ? m / 0.15 : 0.1);
  ASQ[2] = tgt; ASQ[3] = rate * PHYS_DT;
}
// traction control: ASQ[0] = drive torque at the wheels (> 0), limited to what the driven axle's weaker tyre can take
// (the share of grip the cornering leaves it, from the lateral acceleration)
function assistTraction() {
  const V = VEH, P = VP, i = P.rwd ? 2 : 0, mu = P.mu * ASSIST.muK;
  let cl = mu * ZMU[V.wzone[i]] * V.fz[i], cr = mu * ZMU[V.wzone[i + 1]] * V.fz[i + 1], cap = 2 * (cl < cr ? cl : cr), lat = P.m * Math.abs(V.ay) * (P.rwd ? P.a : P.b) / P.L;
  if (P.awd) {   // four-wheel drive (garage cars): the weakest of the four tyres, the whole car's cornering
    for (let k = 2; k < 4; k++) { const c = mu * ZMU[V.wzone[k]] * V.fz[k]; if (c < cl) cl = c; if (c < cr) cr = c; }
    cap = 4 * (cl < cr ? cl : cr); lat = P.m * Math.abs(V.ay);
  }
  const lon = cap * cap - lat * lat, lo = cap * cap * 0.05;
  const lim = Math.sqrt(lon > lo ? lon : lo) * 0.93 * P.R;
  if (ASQ[0] > lim && ASSIST.tc) ASQ[0] = lim;
}
// stability control and spin recovery: ASQ[0] = yaw moment, ASQ[1] = longitudinal force, ASQ[2] = lateral force (body
// frame), changed in place; hand: the handbrake is pulled (a handbrake turn is left alone until it is released)
function assistStability(hand) {
  const V = VEH, P = VP, A = ASSIST, g = 9.81, vx = V.vx, vy = V.vy, sp = Math.sqrt(vx * vx + vy * vy), r = V.r;
  let M = 0, cutT = 0;
  if (sp > 3) {
    if (vx > 1) {
      const rMax = P.mu * A.muK * g * 0.9 / vx, r0 = vx * Math.tan(V.steer) / P.L, rRef = r0 > rMax ? rMax : r0 < -rMax ? -rMax : r0;
      // slip angle of the rear axle: the tail stepping out (a tight turn at walking pace has none, however far the lock)
      const beta = Math.atan2(vy - r * P.b, vx), ab = beta < 0 ? -beta : beta;
      let ex = 0;
      if (!hand) {
        const e = r - rRef; ex = e > 0.05 ? e - 0.05 : e < -0.05 ? e + 0.05 : 0;
        if (ex * r < 0 && (r < 0 ? -r : r) < (rRef < 0 ? -rRef : rRef)) ex = 0;   // turning less than asked (understeer): left to the tyres
      }
      const bx = hand ? 0 : beta > 0.14 ? beta - 0.14 : beta < -0.14 ? beta + 0.14 : 0;
      M = (-ex * A.escK + bx * A.betaK) * P.Izz;
      if (ab > 0.6 && !hand) M -= r * P.Izz * 3;                            // a spin: stop the rotation
      cutT = (ex < 0 ? -ex : ex) * 3 + (bx < 0 ? -bx : bx) * 4;
      if (ab > 0.6 && !hand) { const f = P.m * g * 0.25; ASQ[1] -= f * vx / sp; ASQ[2] -= f * vy / sp; cutT = 1; }   // and scrub off speed
    } else if (!hand) {
      // sliding sideways or backwards: stop the rotation, brake the slide
      M = -r * P.Izz * 4; const f = P.m * g * 0.3; ASQ[1] -= f * vx / sp; ASQ[2] -= f * vy / sp; cutT = 1;
    }
    const mm = A.escMax * P.m * g * P.tw; if (M > mm) M = mm; else if (M < -mm) M = -mm;
    ASQ[0] += M;
    if (vx > 1) ASQ[1] -= (M < 0 ? -M : M) / P.tw * 0.6;                    // the brakes that make the moment cost some speed
  }
  if (cutT > 1) cutT = 1;
  A.cut += (cutT - A.cut) * (cutT > A.cut ? 0.5 : 0.08);
}
