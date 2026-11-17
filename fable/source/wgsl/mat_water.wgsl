// Sea and lakes: an opaque surface with a film of water (the lighting adds the screen-space reflection), small waves that
// move with the time, the colour of the silty Bristol Channel deepening offshore, and a line of foam at the water's edge.
// colour of the vertex: r = depth 0 (shore) .. 1 (deep), g = 1 on lakes (calmer)
#include mesh_vert
fn wDist(wp: vec3f) -> f32 {
#ifdef PASS_CUBE
  return distance(wp, P.camPos.xyz);
#else
  return distance(wp, F.camPos.xyz);
#endif
}
fn surf(in: V2F, ff: bool) -> Surface {
  var s = surfDefault(vec3f(0.0, 1.0, 0.0));
  let xz = in.wpos.xz; let t = F.wind.w; let dist = wDist(in.wpos);
  let lake = in.col.g;
  // depth (m): from the town's height map where there is one (the coast is drawn at 2 m), else from the vertex
  var dm = in.col.r * 7.0; if (wmIn(xz) && lake < 0.5) { dm = SEA_LVL - wmHeight(xz); }
  let depth = sat(dm / 7.0);
  let fade = 1.0 - smoothstep(60.0, 900.0, dist);
  let w1 = textureSample(tNoise, sLin, xz * 0.043 + vec2f(t * 0.011, t * 0.007));
  let w2 = textureSample(tNoise, sLin, vec2f(xz.x * 0.8 - xz.y * 0.6, xz.x * 0.6 + xz.y * 0.8) * 0.17 - vec2f(t * 0.019, -t * 0.013));
  let w3 = textureSample(tNoise, sLin, xz * 0.61 + vec2f(-t * 0.05, t * 0.031));
  let amp = mix(1.0, 0.35, lake);
  let grad = ((w1.rg - 0.5) * 0.28 + (w2.rg - 0.5) * 0.22 * fade + (w3.rg - 0.5) * 0.14 * (1.0 - smoothstep(10.0, 120.0, dist))) * amp;
  s.normal = bumpXZ(vec3f(0.0, 1.0, 0.0), grad);
  // silty brown-grey near the shore, greener grey offshore
  var c = mix(vec3f(0.095, 0.082, 0.06), vec3f(0.03, 0.04, 0.038), smoothstep(0.0, 0.5, depth));
  c = mix(c, vec3f(0.03, 0.045, 0.05), lake * 0.6);
  c *= 0.9 + 0.2 * w2.b;
  // foam: a broken white line where the water is shallowest
  let foam = (1.0 - smoothstep(0.0, 0.07, dm + (w3.b - 0.5) * 0.05)) * smoothstep(0.4, 0.7, w2.b + w3.r * 0.4) * (1.0 - lake);
  c = mix(c, vec3f(0.55, 0.55, 0.52), foam);
  s.albedo = c; s.rough = mix(0.035, 0.6, foam); s.wet = 1.0 - foam; s.ao = 1.0;
  return s;
}
