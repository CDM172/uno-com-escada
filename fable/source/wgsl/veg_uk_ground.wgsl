// Ground of the ?scene=uktrees gallery (33_veg_e_uk.js): mown lawn, the wood's floor of leaf litter and moss east of
// x = UKG_X + 50, a patch of dune sand under the marram. Test scene only.
#include palette
#include mesh_vert
fn surf(in: V2F, ff: bool) -> Surface {
  var s = surfDefault(vec3f(0.0, 1.0, 0.0));
  let p = in.wpos.xz - vec2f(UKG_X, UKG_Z);
  let n1 = textureSample(tNoise, sLin, in.wpos.xz * 0.013).r; let n2 = textureSample(tNoise, sLin, in.wpos.xz * 0.11).g; let n3 = textureSample(tNoise, sLin, in.wpos.xz * 0.9).b;
  // lawn: mowing stripes, clover-dark and sun-bleached patches
  var lawn = COL_GRASS * vec3f(1.05, 1.0, 1.1) * (0.78 + 0.4 * n1) * (0.85 + 0.3 * n2) * (0.88 + 0.24 * n3);
  lawn *= 0.94 + 0.08 * step(0.5, fract(p.y / 7.0));
  lawn = mix(lawn, lawn * vec3f(1.35, 1.15, 0.75), smoothstep(0.62, 0.8, n1) * 0.5);
  // wood floor: leaf litter, bare earth, moss
  let wf = smoothstep(48.0, 56.0, p.x) * (1.0 - smoothstep(128.0, 136.0, p.x)) * (1.0 - smoothstep(74.0, 82.0, abs(p.y)));
  var litter = mix(vec3f(0.09, 0.06, 0.035), vec3f(0.05, 0.04, 0.028), n2) * (0.75 + 0.5 * n3);
  litter = mix(litter, vec3f(0.035, 0.06, 0.018), smoothstep(0.55, 0.75, n1) * 0.7);
  // dune sand under the marram
  let sd = 1.0 - smoothstep(6.0, 8.5, length(p - vec2f(-100.0, 5.0)));
  let sand = vec3f(0.42, 0.36, 0.25) * (0.85 + 0.25 * n3);
  s.albedo = mix(mix(lawn, litter, wf), sand, sd);
  let g = vec2f(n2 - 0.5, n3 - 0.5);
  s.normal = bumpXZ(s.normal, g * mix(0.25, 0.5, wf));
  s.rough = 0.92;
  return s;
}
