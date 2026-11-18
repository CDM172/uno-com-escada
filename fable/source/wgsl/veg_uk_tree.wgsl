// British vegetation — instanced tree / shrub / hedge meshes (near), switching to the impostor far away. A copy of
// veg_tree.wgsl (the Serra's, unchanged) with the British barks, per-species leaf gloss and translucency, trunk ivy and the
// horizontal stretch of the crown (the instance's rotation (cos, sin) has length k = crown-radius scale, see ukPlant).
#include veg_uk_common
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) uv: vec2f, @location(3) mat: vec4u, @location(4) col: vec4f, @location(5) i0: vec4f, @location(6) i1: vec4f }
@group(3) @binding(0) var tLeaf: texture_2d<f32>;
@group(3) @binding(1) var sLeaf: sampler;
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let base = in.i0.xyz; let s = in.i0.w; let c = in.i1.x; let sn = in.i1.y;
  let k = max(length(vec2f(c, sn)), 1e-4); let cn = c / k; let snn = sn / k;
  let lp = in.pos * s; let rel = vec3f(lp.x * c - lp.z * sn, lp.y, lp.x * sn + lp.z * c);
  let ln = vec3f(in.nrm.x / k, in.nrm.y, in.nrm.z / k); o.nrm = vec3f(ln.x * cn - ln.z * snn, ln.y, ln.x * snn + ln.z * cn);
  let ai = ukArch(in.i1.w); let pv = VEG_UKV[ai];
  let d = distance(base.xz, F.camPos.xz) * vegZoom();
  let under = in.i1.w >= VEG_NT;
  var fade = vegFade(d, in.i1.z, VEG_D0, VEG_D1);
  if (under) { fade = vegFade(d, in.i1.z, VEG_U0, VEG_U1); }
  let leafV = in.mat.x == 1u;
  let fl = select(0.0, f32(in.mat.w) / 255.0, leafV); let ph = f32(in.mat.y) / 255.0;   // (bark: mat.w is the bark variant)
  let t = F.wind.w;
  var wp = base + rel + vegWindK(base, rel, in.nrm.w, fl, ph, t, pv.z);
  var pp = base + rel + vegWindK(base, rel, in.nrm.w, fl, ph, t - F.misc.x, pv.z);
#ifdef PASS_SHADOW
  if ((!under && !vegShadowMesh(base, fade)) || fade >= 0.5 || vegShadowCull(base, VEG_H[ai] * s)) { wp = base; pp = base; }
#else
  if (fade >= 1.0) { wp = base; pp = base; }
#endif
  o.wpos = wp; o.pwpos = pp; o.uv = in.uv;
  o.mat = in.mat.x | (in.mat.y << 8u) | (in.mat.z << 16u) | (in.mat.w << 24u);
  let tint = vegTintA(in.i1.z, in.i1.w);
  // close up, the layer of single leaves covers the cards: they become the shaded inside of the crown (not for the
  // cordyline's sword leaves nor the face of a clipped hedge, which are the surface itself)
  let inner = select(1.0, mix(0.78, 1.0, smoothstep(VEG_L0 * 0.8, VEG_L1 * 1.5, d)), !under && pv.w < 0.5);
  o.col = vec4f(in.col.rgb * select(vec3f(1.0), tint * inner, leafV), in.col.a);
  o.ext = vec4f(fade, in.i1.z, rel.y, d);
  return o;
}
fn leafAlpha(uv: vec2f) -> f32 { return textureSample(tLeaf, sLeaf, uv).a; }
fn surfAlpha(in: V2F) -> f32 {
  if (matId(in.mat) != 1u) { return 1.0; }
  return leafAlpha(in.uv) * 0.84;
}
// bark patterns per type (see UK_BARK in 33_veg_e_uk.js): (u scale, v scale, relief depth, style)
// style 0 fissured plates | 1 smooth | 2 interlaced ridges (ash) | 3 flaking patches (plane, sycamore) | 4 rings (birch, cordyline)
const UK_BK = array<vec4f, 16>(
  vec4f(0.42, 0.13, 1.0, 0.0),  vec4f(0.3, 0.3, 0.12, 1.0),   vec4f(1.0, 0.42, 0.6, 2.0),   vec4f(0.5, 0.34, 0.38, 3.0),
  vec4f(0.55, 0.3, 0.5, 3.0),   vec4f(0.3, 0.17, 1.05, 0.0),  vec4f(0.45, 0.07, 1.1, 0.0),  vec4f(0.6, 0.6, 0.2, 4.0),
  vec4f(0.16, 0.11, 0.1, 3.0),  vec4f(0.9, 0.16, 0.5, 0.0),   vec4f(1.25, 0.95, 0.65, 0.0), vec4f(0.8, 2.6, 0.6, 4.0),
  vec4f(0.4, 0.4, 0.1, 1.0),    vec4f(0.8, 0.26, 0.65, 0.0),  vec4f(0.95, 0.5, 0.45, 0.0),  vec4f(0.6, 0.3, 0.25, 1.0));
fn surf(in: V2F, ff: bool) -> Surface {
  let nz = vegNoise(in.pos.xy);
  var keep = 1.0 - in.ext.x;
  let dcam = distance(in.wpos, F.camPos.xyz);
  // foliage very close to the lens fades out (a TV camera behind a bush); bark only right at the lens
  keep *= select(sat((dcam - 0.3) / 0.4), sat((dcam - 1.0) / 2.2), matId(in.mat) == 1u);
  var s = surfDefault(normalize(in.nrm));
  if (matId(in.mat) == 1u) {
    let ai = min((in.mat >> 16u) & 255u, VEG_NA_UK - 1u); let pm = VEG_UKM[ai]; let pv = VEG_UKV[ai];
    let t = textureSample(tLeaf, sLeaf, in.uv);
    keep *= vegCover(t.a, 0.5);
    // a card a few metres from the lens (its texture magnified too much) fades out and the single leaves stay; not the
    // face of a clipped hedge (it is the surface: behind it are only its stems)
    if (in.ext.w < VEG_D0 && pv.w < 1.5) { keep *= sat((dcam - 1.5) / 3.5); }
    if (keep <= nz) { discard; }
    let ao = in.col.a;
    var geo = normalize(cross(dpdx(in.wpos), dpdy(in.wpos))); if (dot(geo, s.normal) < 0.0) { geo = -geo; }
    let dn = textureSample(tNoise, sLin, in.uv * 3.0 + in.ext.y * 13.0).rg - 0.5;
    let lum0 = dot(t.rgb, vec3f(0.3, 0.6, 0.1));
    s.normal = normalize(mix(s.normal, geo, 0.2) + vec3f(dn.x, (lum0 - 0.25) * 0.5, dn.y) * 0.26);
    let Vd = normalize(F.camPos.xyz - in.wpos); let nvd = dot(s.normal, Vd);
    if (nvd < 0.0) { s.normal = normalize(s.normal - Vd * (nvd * 1.7)); }
    // the atlas tiles carry each species' own green; this keeps the Serra's overall leaf level (veg_tree.wgsl)
    var lc = t.rgb * in.col.rgb * vec3f(0.6, 0.62, 0.42);
    let cell = textureSample(tNoise, sLin, in.uv * 1.6 + in.ext.y * 7.0).b; let cell2 = textureSample(tNoise, sLin, in.uv * 0.55 + in.ext.y * 3.0).r;
    lc *= (0.76 + 0.46 * cell) * (0.8 + 0.4 * cell2);
    lc = mix(lc, lc * vec3f(1.16, 1.1, 0.78), smoothstep(0.62, 0.9, cell2) * ao * 0.35);
    s.albedo = lc * mix(0.62, 1.0, ao * ao);
    let nearK = smoothstep(VEG_L0 * 0.8, VEG_L1 * 1.5, in.ext.w);
    // translucency: thin deciduous leaves glow green-yellow against the sun; leathery evergreens (holm oak, holly) and
    // needles much less (VEG_UKM.y); a clipped hedge's face only at its fringes
    s.sss = (0.26 + 0.12 * sat(-nvd * 2.0)) * (0.12 + 0.88 * ao * ao) * mix(0.45, 1.0, nearK) * pm.y;
    let back = smoothstep(0.15, 0.8, dot(-Vd, F.sunDir.xyz)) * ao * ao * pm.y;
    s.albedo = mix(s.albedo, s.albedo * vec3f(1.24, 1.2, 0.7), back * 0.7);
    s.emissive = 0.05 * smoothstep(0.35, 0.9, dot(-Vd, F.sunDir.xyz)) * ao * ao * ao * smoothstep(1.5, 5.0, in.ext.z) * pm.y;
    // gloss: waxy evergreen leaves (holly, holm oak, laurel, ivy, privet) catch the sun, the rest is matt (VEG_UKM.x)
    s.rough = mix(0.95, mix(0.7, 0.42, pm.x), smoothstep(0.7 - pm.x * 0.35, 0.85, cell) * ao); s.ao = max(ao, 0.58) * mix(0.88, 1.0, nearK);
    // back of the leaf: lighter and matt; silver-felted undersides (holm oak, sea buckthorn: VEG_UKM.z)
    if (!ff) { s.albedo = mix(s.albedo * vec3f(1.06, 1.08, 0.94), vec3f(dot(s.albedo, vec3f(0.33)) * 1.4 + 0.01), pm.z * 0.5); s.rough = 0.98; }
  } else {
    if (keep <= nz) { discard; }
    let bt = min((in.mat >> 16u) & 255u, 15u); let N = s.normal;
    // variant up the stem (interpolated, unlike the flat mat bytes): Scots pine's orange upper bark comes in the vertex
    // colour; birch's black, fissured foot is the first ~2.5 m
    var vr = 0.0;
    if (bt == 5u) { vr = sat((in.col.r - in.col.b - 0.06) / 0.3); }
    if (bt == 7u) { vr = 1.0 - smoothstep(0.3, 1.9, in.ext.z + textureSample(tNoise, sLin, in.uv * vec2f(0.5, 0.2)).r * 0.8 - 0.4); }
    let B4 = UK_BK[bt]; let style = u32(B4.w);
    var sc = B4.xy; var depth = B4.z;
    if (bt == 5u) { sc = mix(sc, vec2f(0.9, 0.5), vr); depth = mix(depth, 0.32, vr); }   // Scots pine: thin papery flakes up the stem
    if (bt == 7u) { depth = mix(depth, 1.0, vr); sc = mix(sc, vec2f(0.5, 0.16), vr); }   // birch: rough black base
    var uvb = in.uv; if (bt == 4u) { uvb.x += uvb.y * 0.18; }                             // horse chestnut: the twist
    let wr = textureSample(tNoise, sLin, uvb * vec2f(0.21, 0.07)).rg;
    let q = uvb * sc + wr * 0.09; let e = 0.004;
    let q2 = uvb * sc * vec2f(3.1, 2.3) + wr.yx * 0.05;
    var h0 = 0.0; var hx = 0.0; var hy = 0.0;
    if (style == 2u) {
      // ash: furrows in an interlaced diamond net
      let a = q * vec2f(5.0, 1.0); let w2 = wr * 0.6;
      h0 = min(abs(fract(a.x + a.y * 3.0 + w2.x) - 0.5), abs(fract(a.x - a.y * 3.0 + w2.y) - 0.5)) * 2.0;
      hx = min(abs(fract(a.x + 5.0 * e + a.y * 3.0 + w2.x) - 0.5), abs(fract(a.x + 5.0 * e - a.y * 3.0 + w2.y) - 0.5)) * 2.0;
      hy = min(abs(fract(a.x + (a.y + e) * 3.0 + w2.x) - 0.5), abs(fract(a.x - (a.y + e) * 3.0 + w2.y) - 0.5)) * 2.0;
      h0 = smoothstep(0.05, 0.6, h0); hx = smoothstep(0.05, 0.6, hx); hy = smoothstep(0.05, 0.6, hy);
    } else if (style == 1u || style == 4u) {
      h0 = textureSample(tNoise, sLin, q).r * 0.6 + textureSample(tNoise, sLin, q2).g * 0.4;
      hx = textureSample(tNoise, sLin, q + vec2f(e, 0.0)).r * 0.6 + textureSample(tNoise, sLin, q2 + vec2f(e * 3.1, 0.0)).g * 0.4;
      hy = textureSample(tNoise, sLin, q + vec2f(0.0, e)).r * 0.6 + textureSample(tNoise, sLin, q2 + vec2f(0.0, e * 2.3)).g * 0.4;
    } else {
      // plates and fissures: a sharpened cellular profile (crisp dark cracks between raised plates) plus fine cracks
      let q3 = uvb * sc * vec2f(8.3, 6.1) + wr * 0.3;
      h0 = textureSample(tNoise, sLin, q).b * 0.7 + textureSample(tNoise, sLin, q2).b * 0.22 + textureSample(tNoise, sLin, q3).b * 0.08;
      hx = textureSample(tNoise, sLin, q + vec2f(e, 0.0)).b * 0.7 + textureSample(tNoise, sLin, q2 + vec2f(e * 3.1, 0.0)).b * 0.22 + textureSample(tNoise, sLin, q3 + vec2f(e * 8.3, 0.0)).b * 0.08;
      hy = textureSample(tNoise, sLin, q + vec2f(0.0, e)).b * 0.7 + textureSample(tNoise, sLin, q2 + vec2f(0.0, e * 2.3)).b * 0.22 + textureSample(tNoise, sLin, q3 + vec2f(0.0, e * 6.1)).b * 0.08;
      h0 = smoothstep(0.18, 0.75, h0); hx = smoothstep(0.18, 0.75, hx); hy = smoothstep(0.18, 0.75, hy);
    }
    let g = vec2f(hx - h0, hy - h0) / e * 0.034 * depth;
    let dp1 = dpdx(in.wpos); let dp2 = dpdy(in.wpos); let du1 = dpdx(q); let du2 = dpdy(q);
    let p2 = cross(dp2, N); let p1 = cross(N, dp1);
    let T = p2 * du1.x + p1 * du2.x; let Bv = p2 * du1.y + p1 * du2.y; let im = inverseSqrt(max(max(dot(T, T), dot(Bv, Bv)), 1e-12));
    let fd = sat(1.25 - in.ext.w / 70.0);
    s.normal = normalize(N - (T * g.x + Bv * g.y) * im * fd);
    let ridge = smoothstep(0.28, 0.72, h0);
    var k = mix(1.0, mix(0.3, select(1.3, 1.08, depth > 0.9), ridge), sat(0.35 + 0.65 * depth)) * (0.75 + 0.5 * wr.x);
    var col = in.col.rgb;
    let hue = textureSample(tNoise, sLin, uvb * vec2f(0.13, 0.031) + 0.7).g;
    if (style == 3u) {
      // flaking: patches of fresher bark (plane: cream and olive camouflage; sycamore: pinkish-orange scars)
      let f1 = textureSample(tNoise, sLin, uvb * sc * 2.2 + 0.31).r; let f2 = textureSample(tNoise, sLin, uvb * sc * 2.9 + vec2f(0.57, 0.13)).g;
      let e1 = smoothstep(0.52, 0.535, f1); let e2 = smoothstep(0.55, 0.565, f2);
      var pcol = mix(vec3f(1.6, 1.5, 1.1), vec3f(1.0, 1.06, 0.7), e2);   // plane: cream, olive-green, the old grey-brown
      if (bt != 8u) { pcol = vec3f(1.25, 1.02, 0.85); }
      col = mix(col, col * pcol, max(e1, e2 * 0.8) * select(0.45, 1.0, bt == 8u));
      k = mix(k, 1.0, 0.5);
    }
    if (style == 4u) {
      // horizontal lenticels (birch) / leaf-scar rings (cordyline)
      let ln = abs(fract(uvb.y * select(7.0, 26.0, bt == 11u) + wr.x * 3.0 + textureSample(tNoise, sLin, uvb * vec2f(0.9, 0.3)).g * 1.5) - 0.5);
      let dash = smoothstep(0.55, 0.62, textureSample(tNoise, sLin, uvb * vec2f(2.6, 1.3)).r);
      let lent = (1.0 - smoothstep(0.025, 0.07, ln)) * select(dash, 1.0, bt == 11u);
      k *= 1.0 - lent * select(0.75, 0.35, bt == 11u);
      if (bt == 7u) { k = mix(k, k * 0.16 * (0.5 + 0.9 * ridge), smoothstep(0.25, 0.6, vr * (0.7 + 0.6 * h0))); }   // the black, fissured base
    }
    if (bt == 1u || bt == 12u) { k *= 0.94 + 0.08 * sin(uvb.y * 31.0 + wr.y * 9.0); }   // beech/holly: faint wrinkles
    let vein = textureSample(tNoise, sLin, uvb * vec2f(1.9, 0.05)).g;
    let smoothBk = style == 1u || bt == 7u || bt == 8u;
    k *= mix(select(0.78, 0.94, smoothBk), select(1.1, 1.03, smoothBk), smoothstep(0.35, 0.62, vein)) * mix(0.55, 1.0, smoothstep(0.0, 1.8, in.ext.z));
    if (smoothBk) {
      // smooth bark: mottled with pale lichen and darker blotches instead of streaks (beech, holly, birch, plane)
      let mo = textureSample(tNoise, sLin, uvb * vec2f(0.9, 0.7) + 0.21).r; let mo2 = textureSample(tNoise, sLin, uvb * vec2f(2.7, 2.1) + 0.63).g;
      k *= mix(0.86, 1.14, smoothstep(0.4, 0.7, mo)) * mix(0.9, 1.06, mo2);
    }
    // green algae and lichen: the damp side of the stems in the woods (strongest on smooth barks), moss at the foot
    let smoothB = bt == 1u || bt == 7u || bt == 8u || bt == 12u;
    let moss = smoothstep(0.5, 0.76, wr.y + (1.0 - sat(in.ext.z * 0.4)) * 0.24 + sat(N.y) * 0.25 + sat(-N.x) * 0.1) * select(select(0.38, 0.14, bt == 5u || bt == 6u), 0.28, smoothB);
    var alb = col * mix(vec3f(1.08, 0.95, 0.85), vec3f(0.92, 0.98, 1.06), smoothstep(0.3, 0.7, hue)) * k * 0.56;
    alb = mix(alb, vec3f(0.07, 0.1, 0.03) * (0.6 + 0.8 * h0), moss);
    // ivy up the trunk on part of the trees (per tree, from its seed; the share per species is VEG_UKM.w): dark glossy
    // leaves in a ragged sleeve that thins out upwards (the Toll Road's trees in Weston Woods)
    let ai = min((in.mat >> 8u) & 255u, VEG_NA_UK - 1u);
    var rough = 0.88;
    if (fract(in.ext.y * 41.7 + 0.3) < VEG_UKM[ai].w) {
      let ivyH = mix(1.5, 10.0, fract(in.ext.y * 17.1));
      let il = textureSample(tNoise, sLin, uvb * vec2f(2.3, 1.5)).b; let ib = textureSample(tNoise, sLin, uvb * vec2f(0.35, 0.18) + 0.57).r;
      let m = smoothstep(0.42, 0.55, ib + 0.35 * (1.0 - smoothstep(ivyH * 0.5, ivyH, in.ext.z)));
      let lf = smoothstep(0.25, 0.45, il);
      let ivyM = m * (1.0 - smoothstep(ivyH * 0.85, ivyH * 1.15, in.ext.z)) * mix(0.6, 1.0, lf);
      alb = mix(alb, vec3f(0.028, 0.045, 0.016) * (0.6 + 0.8 * il), ivyM);
      rough = mix(rough, 0.5, ivyM * lf);
      s.normal = normalize(mix(s.normal, normalize(N + (vec3f(il, 0.5, ib) - 0.5) * 0.8), ivyM));
    }
    s.albedo = alb;
    s.rough = rough; s.ao = in.col.a * mix(1.0, 0.4 + 0.6 * ridge, sat(depth)) * mix(0.55, 1.0, smoothstep(0.0, 0.9, in.ext.z));
  }
  return s;
}
