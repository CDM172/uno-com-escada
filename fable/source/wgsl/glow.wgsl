// Light added to the picture in the transparent pass (additive, no depth written) by the Aston Martin V8's gadgets:
//   id 29: laser beam — a cylinder one metre long along +Z that the game stretches to the beam's length; O.p0.x = on
//   id 30: head-up display — the decal of the atlas region 'hud' inside the windscreen, as masks (red: always shown, green:
//          the self-destruct warning). O.p0 = (left bay loaded, right bay loaded, reload 0..1, booster charge 0..1),
//          O.p1 = the region in the atlas (u0, v0, u1, v1), O.p2 = (fade in/out, self-destruct countdown 0..1, lasers firing)
//          The boxes and bars are filled here, at the places V8_HUDL (30_car_f_v8.js) gives them — keep the two in step.
#include mesh_vert
@group(3) @binding(0) var tAtlas: texture_2d<f32>;
// coverage of the rectangle b (s0, t0, s1, t1) at the point p, antialiased with the width of a pixel w
fn hudRect(p: vec2f, b: vec4f, w: vec2f) -> f32 { let d = max(b.xy - p, p - b.zw); return sat(0.5 - d.x / w.x) * sat(0.5 - d.y / w.y); }
fn shade(in: V2F, ff: bool) -> vec4f {
  let id = matId(in.mat); let lp = in.ext.xyz;
  if (id == 29u) {
    if (O.p0.x <= 0.0) { discard; }
    // brightest along the middle of the beam as seen from the camera, fading along its last 10 %
    let N = normalize(in.nrm); let V = normalize(F.camPos.xyz - in.wpos); let nv = abs(dot(N, V));
    let core = pow(nv, 10.0) * 5.0 + pow(nv, 2.5) * 0.7;
    let flick = 0.88 + 0.12 * sin(F.camPos.w * 91.0 + lp.z * 37.0);
    let fade = 1.0 - smoothstep(0.9, 1.0, lp.z);
    return vec4f(vec3f(1.0, 0.07, 0.035) * core * flick * fade * O.p0.x * 7.0, 0.0);
  }
  // head-up display
  let t = textureSample(tAtlas, sLin, in.uv);
  let rg = O.p1; let st = (in.uv - rg.xy) / max(rg.zw - rg.xy, vec2f(1e-6)); let w = max(fwidth(st), vec2f(1e-5));
  var m = t.r;
  let blink = step(0.5, fract(F.camPos.w * 2.5));
  m = max(m, t.g * step(0.001, O.p2.y) * blink);                                                     // SELF-DESTRUCT
  m = max(m, hudRect(st, vec4f(0.075, 0.725, 0.15, 0.855), w) * O.p0.x);                             // missile bays
  m = max(m, hudRect(st, vec4f(0.19, 0.725, 0.265, 0.855), w) * O.p0.y);
  m = max(m, hudRect(st, vec4f(0.075, 0.905, 0.075 + 0.19 * O.p0.z, 0.945), w) * step(O.p0.z, 0.999));  // reload
  m = max(m, hudRect(st, vec4f(0.735, 0.725, 0.925, 0.855), w) * O.p2.z * (0.7 + 0.3 * blink));      // laser firing
  m = max(m, hudRect(st, vec4f(0.375, 0.805, 0.375 + 0.25 * O.p0.w, 0.875), w));                    // booster charge
  m = max(m, hudRect(st, vec4f(0.375, 0.885, 0.375 + 0.25 * O.p2.y, 0.9), w));                       // self-destruct countdown
  return vec4f(vec3f(0.25, 1.0, 0.38) * m * O.p2.x * 2.2, 0.0);
}
