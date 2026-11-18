// Weston-super-Mare ground. Land cover from the world map (townMapBuild in 11_worldmap.js): R grass, G sand, B mud (and the
// sea bed), A wild ground (0.5 rough grass and fields, 1 woodland floor); the rest is hard standing (yards, paving).
// Beyond the town the cover follows the height: mud flats along the coast, a patchwork of fields inland.
#include mesh_vert
#include palette
fn gDist(wp: vec3f) -> f32 {
#ifdef PASS_CUBE
  return distance(wp, P.camPos.xyz);
#else
  return distance(wp, F.camPos.xyz);
#endif
}
fn surf(in: V2F, ff: bool) -> Surface {
  let Ng = normalize(in.nrm);
  var s = surfDefault(Ng);
  let wp = in.wpos; let xz = wp.xz; let dist = gDist(wp);
  let near = 1.0 - smoothstep(10.0, 90.0, dist); let near2 = 1.0 - smoothstep(3.0, 25.0, dist);
  let nA = textureSample(tNoise, sLin, xz * 0.0119);
  let nB = textureSample(tNoise, sLin, vec2f(xz.x * 0.8 - xz.y * 0.6, xz.x * 0.6 + xz.y * 0.8) * 0.071);
  let nC = textureSample(tNoise, sLin, xz * 0.53 + nA.rg * 0.2);
  let nD = textureSample(tNoise, sLin, vec2f(xz.x * 0.6 + xz.y * 0.8, -xz.x * 0.8 + xz.y * 0.6) * 3.9);
  var z = wmZone(xz);
  let hs = wp.y - SEA_LVL;   // (above the sea at this tide; SEA_MID: the mid tide, HW_LVL: spring high water)
  if (!wmIn(xz)) {
    // out of the town: below about 5 m it is the intertidal mud (and the sea bed), above it fields
    let coast = 1.0 - smoothstep(3.5, 6.0, wp.y - SEA_MID + (nA.r - 0.5) * 3.0);
    z = vec4f(0.85 * (1.0 - coast), 0.0, coast, 0.5 * (1.0 - coast));
  }
  let gr = z.r; let sa = z.g; let mu = z.b; let wild = z.a;
  let forest = smoothstep(0.62, 0.95, wild); let rough = smoothstep(0.15, 0.5, wild) * (1.0 - forest);
  let hard = sat(1.0 - gr - sa - mu - forest);
  // ---- grass: lawns (mown stripes in the parks), rough grass and fields (each field its own green)
  let cell = textureSample(tNoise, sLin, xz / 230.0).b;
  var g = mix(vec3f(0.07, 0.13, 0.035), vec3f(0.12, 0.17, 0.05), nC.r) * (0.8 + 0.4 * nB.r);
  let mow = step(0.5, fract((xz.x * 0.6 + xz.y * 0.8) / 7.0)) * (1.0 - rough) * near;
  g *= 0.94 + 0.12 * mow;
  let fieldC = mix(vec3f(0.13, 0.15, 0.05), vec3f(0.09, 0.14, 0.04), cell) * (0.85 + 0.3 * nA.g);
  g = mix(g, mix(fieldC, vec3f(0.17, 0.16, 0.07), smoothstep(0.55, 0.8, nB.g) * 0.5), rough);
  g *= 0.82 + 0.36 * nD.b * near2 + 0.18 * (1.0 - near2);
  // hedgerows between the fields (out of town): darker bands along the edges of the cells
  let fcell = textureSample(tNoise, sLin, xz / 310.0 + 0.5).b;
  let hedge = (1.0 - smoothstep(0.02, 0.06, abs(fcell - 0.5) - 0.0)) * rough * select(0.0, 1.0, !wmIn(xz));
  g = mix(g, vec3f(0.035, 0.06, 0.02), hedge * 0.8);
  // ---- woodland floor
  // (brown leaf litter with patches of ivy: under the beeches of Weston Woods there is little grass)
  let ivy = smoothstep(0.45, 0.75, nB.g);
  let lit = mix(mix(vec3f(0.062, 0.042, 0.024), vec3f(0.045, 0.034, 0.02), nC.g), vec3f(0.026, 0.045, 0.018), ivy * 0.8) * (0.7 + 0.5 * nD.r);
  // ---- sand: dry and pale at the top of the beach, darker and wet towards the water
  // (soaked just above the water's edge, damp down from the last high water's line, dry above it: at low tide the whole
  // beach the sea has left is dark, at high tide only the strip above the water)
  let wetS = max(1.0 - smoothstep(0.1, 1.8, hs + (nB.r - 0.5) * 1.2), 0.8 * (1.0 - smoothstep(HW_LVL - 2.2, HW_LVL + 0.2, wp.y + (nB.r - 0.5) * 1.5)));
  var sd = mix(vec3f(0.46, 0.36, 0.22), vec3f(0.22, 0.17, 0.11), wetS) * (0.88 + 0.2 * nC.r) * (0.94 + 0.12 * nD.b * near2);
  let ripple = sin(dot(xz, vec2f(0.6, 0.8)) * 7.0 + nB.r * 20.0 + nC.g * 6.0) * wetS * near * 0.35;
  // ---- mud flats: grey-brown silt, shining where the tide has just gone out, with channels
  let wetM = max(1.0 - smoothstep(0.0, 3.5, hs + (nA.g - 0.5) * 2.0), 0.85 * (1.0 - smoothstep(HW_LVL - 1.5, HW_LVL + 0.3, wp.y + (nA.g - 0.5) * 1.5)));
  var md = mix(vec3f(0.15, 0.13, 0.1), vec3f(0.075, 0.068, 0.055), wetM) * (0.85 + 0.3 * nB.b) * (0.9 + 0.2 * nC.r);
  // ---- hard standing (yards, paving, car parks)
  var hd = vec3f(0.17, 0.165, 0.155) * (0.75 + 0.4 * nB.r) * (0.85 + 0.3 * nC.r);   // (fbm: the cellular channel read as dots)
  hd = mix(hd, vec3f(0.08, 0.08, 0.085), smoothstep(0.5, 0.7, nA.b) * 0.6);
  let wsum = gr + sa + mu + forest + hard + 1e-4;
  var alb = (g * gr + sd * sa + md * mu + lit * forest + hd * hard) / wsum;
  s.albedo = alb;
  s.rough = (0.9 * gr + mix(0.85, 0.45, wetS) * sa + mix(0.75, 0.2, wetM) * mu + 0.9 * forest + 0.82 * hard) / wsum;
  s.wet = (wetM * 0.65 * mu + wetS * 0.45 * sa) / wsum;
  s.sss = 0.15 * gr / wsum;
  var grad = (nC.rg - 0.5) * 0.9 * near + (nD.rg - 0.5) * 1.4 * near2;
  grad = grad * (1.0 - 0.6 * (sa + mu) / wsum) + vec2f(ripple * 0.12, 0.0);
  s.normal = bumpXZ(Ng, grad);
  s.ao = 0.8 + 0.2 * nC.r;
  return s;
}
