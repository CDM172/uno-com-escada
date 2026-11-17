// Oil slick laid by the DB5: a decal over the G-buffer that darkens the road, makes it smooth and gives it a film that
// mirrors the scene (the same film as the wet patches: the lighting pass traces a screen-space reflection on it).
#include common
#include gbuf
struct SIn { @location(0) pos: vec3f, @location(1) au: vec2f }
struct SOut { @builtin(position) pos: vec4f, @location(0) au: vec2f, @location(1) wp: vec3f }
@vertex fn vs(in: SIn) -> SOut { var o: SOut; o.pos = P.viewProj * vec4f(in.pos, 1.0); o.au = in.au; o.wp = in.pos; return o; }
struct DOut { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f }
@fragment fn fs(in: SOut) -> DOut {
  // au.x = how much oil along the ribbon (0 at its ends), au.y = -1..1 across it
  let u = abs(in.au.y);
  let n = textureSample(tNoise, sLin, in.wp.xz * 0.83).r; let n2 = textureSample(tNoise, sLin, in.wp.xz * 3.9).g;
  // ragged edges: towards the sides the film breaks up into blots
  let k = sat(in.au.x) * (1.0 - smoothstep(0.35, 1.0, u + (n - 0.5) * 1.1 + (n2 - 0.5) * 0.35));
  let al = smoothstep(0.18, 0.5, k);
  var o: DOut;
  o.a = vec4f(vec3f(0.006, 0.005, 0.004), al * 0.92);   // albedo (blended)
  o.b = vec4f(0.0, 0.0, 0.06, al);                      // roughness in .z (only that channel is written)
  o.c = vec4f(0.0, 0.0, 0.0, al);                       // water film in .a (only that channel is written)
  return o;
}
