// British vegetation — the layer of single leaves (near only): one quad per leaf, its outline and veins worked out in the
// shader from (u along the leaf, v across), so the edge stays sharp at any magnification. A copy of veg_leaf.wgsl (the
// Serra's, unchanged) with the British leaf shapes, per-type gloss / translucency / silvery undersides, a 1.2 m offset
// range (cordyline swords and marram blades are long) and the instance's horizontal stretch.
#include veg_uk_common
struct VIn { @location(0) pos: vec3f, @location(1) off: vec4f, @location(2) nrm: vec4f, @location(3) uvx: vec4u, @location(4) col: vec4f, @location(5) i0: vec4f, @location(6) i1: vec4f }
const UK_LOFF = 1.2;   // (UK_LEAF_OFF in 33_veg_e_uk.js)
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let base = in.i0.xyz; let s = in.i0.w; let c = in.i1.x; let sn = in.i1.y;
  let kh = max(length(vec2f(c, sn)), 1e-4); let cn = c / kh; let snn = sn / kh;
  let zoom = vegZoom();
  let lb = (in.pos - in.off.xyz * UK_LOFF) * s;
  let relb = vec3f(lb.x * c - lb.z * sn, lb.y, lb.x * sn + lb.z * c);
  let dl = distance(base + relb, F.camPos.xyz) * zoom;
  let rk = mix(1.6, 0.6, f32(in.uvx.z) / 255.0);
  let k = 1.0 - smoothstep(VEG_L0 * rk, VEG_L1 * rk, dl);
  let lp = (in.pos - in.off.xyz * (UK_LOFF * (1.0 - k))) * s;
  let rel = vec3f(lp.x * c - lp.z * sn, lp.y, lp.x * sn + lp.z * c);
  let ln = vec3f(in.nrm.x / kh, in.nrm.y, in.nrm.z / kh); o.nrm = vec3f(ln.x * cn - ln.z * snn, ln.y, ln.x * snn + ln.z * cn);
  let fl = in.nrm.w; let ph = f32(in.uvx.z) / 255.0; let t = F.wind.w;
  let fk = VEG_UKV[ukArch(in.i1.w)].z;
  var wp = base + rel + vegWindK(base, rel, in.off.w, fl, ph, t, fk);
  var pp = base + rel + vegWindK(base, rel, in.off.w, fl, ph, t - F.misc.x, fk);
  if (k <= 0.0) { wp = base; pp = base; }
  o.wpos = wp; o.pwpos = pp;
  o.uv = vec2f(f32(in.uvx.x) / 255.0, f32(in.uvx.y) / 127.5 - 1.0);
  o.mat = 2u | (u32(in.col.a * 255.0 + 0.5) << 8u);
  o.col = vec4f(in.col.rgb * 2.0 * vegTintA(in.i1.z, in.i1.w), f32(in.uvx.w) / 255.0);
  o.ext = vec4f(k, in.i1.z, rel.y, dl);
  return o;
}
// leaf types (UKL in 33_veg_e_uk.js): 0 elliptic | 1 oval, wavy (beech) | 2 lanceolate (ash leaflet, sea buckthorn)
// 3 lobed (oak) | 4 palmate (sycamore, plane) | 5 heart (lime) | 6 triangular, toothed (birch) | 7 spiny (holly)
// 8 needle tuft (pines) | 9 sword / blade (cordyline, marram) | 10 obovate (horse chestnut leaflet) | 11 ivy
// 12 deeply lobed small (hawthorn) | 13 toothed ovate (bramble) | 14 leathery, silver-felted below (holm oak)
// 15 narrow linear, silvery (sea buckthorn)
// per type: (gloss, translucency, silvery underside, vein strength)
const UK_LT = array<vec4f, 16>(
  vec4f(0.3, 0.8, 0.0, 1.0), vec4f(0.5, 1.0, 0.0, 1.0), vec4f(0.15, 1.0, 0.0, 0.8), vec4f(0.2, 0.95, 0.0, 1.0),
  vec4f(0.15, 1.1, 0.0, 1.2), vec4f(0.15, 1.1, 0.0, 1.0), vec4f(0.25, 1.15, 0.0, 0.7), vec4f(1.0, 0.35, 0.0, 0.6),
  vec4f(0.3, 0.45, 0.0, 0.0), vec4f(0.35, 0.8, 0.0, 0.3), vec4f(0.15, 1.05, 0.0, 1.2), vec4f(0.85, 0.5, 0.0, 1.0),
  vec4f(0.2, 0.9, 0.0, 0.7), vec4f(0.2, 0.8, 0.0, 1.0), vec4f(0.6, 0.4, 0.45, 0.5), vec4f(0.1, 0.5, 0.5, 0.2));
fn ukTeeth(u: f32, n: f32, a: f32) -> f32 { return 1.0 - a * abs(fract(u * n) - 0.5) * 2.0; }
// half width of the leaf at u (0 base, 1 tip), normalised: |v| < half = inside. v is needed by the needle tuft.
fn leafHalf(u: f32, v: f32, t: u32) -> f32 {
  let uu = clamp(u, 0.0, 1.0);
  if (t == 1u) { return pow(sin(3.14159 * pow(uu, 0.62)), 0.6) * (1.0 + 0.05 * sin(uu * 44.0)); }
  if (t == 2u) { return pow(sin(3.14159 * pow(uu, 0.8)), 0.85) * ukTeeth(uu, 18.0, 0.06); }
  if (t == 3u) {
    let b = pow(sin(3.14159 * pow(uu, 0.72)), 0.7);
    let lob = 0.6 + 0.4 * pow(abs(sin(uu * 3.14159 * 4.5 + 0.35)), 0.55);
    return b * lob * mix(0.7, 1.0, smoothstep(0.02, 0.12, uu));
  }
  if (t == 4u) {
    let b = pow(sin(3.14159 * pow(uu, 0.78)), 0.45);
    let notch = 1.0 - 0.5 * exp(-pow((uu - 0.4) / 0.055, 2.0)) - 0.42 * exp(-pow((uu - 0.7) / 0.05, 2.0));
    return b * notch * ukTeeth(uu, 22.0, 0.07) * smoothstep(0.0, 0.06, uu);
  }
  if (t == 5u) {
    let b = pow(sin(3.14159 * (0.14 + 0.86 * pow(uu, 0.85))), 0.55);
    return b * (1.0 - 0.4 * smoothstep(0.75, 1.0, uu)) * ukTeeth(uu, 26.0, 0.05) * smoothstep(0.0, 0.05, uu);
  }
  if (t == 6u) {
    let b = select((1.0 - uu) / 0.68, pow(uu / 0.32, 0.5), uu < 0.32);
    return pow(sat(b), 1.05) * ukTeeth(uu, 16.0, 0.12) * ukTeeth(uu, 32.0, 0.05);
  }
  if (t == 7u) {
    let b = pow(sin(3.14159 * pow(uu, 0.7)), 0.7);
    let f = fract(uu * 4.2 + 0.1);
    return b * (0.72 + 0.28 * pow(f, 3.0));
  }
  if (t == 8u) {
    // fascicle: needles from the base fanning forwards, and the shoot they grow on
    var m = 0.0;
    for (var i = 0; i < 7; i++) {
      let a = (f32(i) / 6.0 - 0.5) * 1.7;
      let w = 0.075 * (1.0 - uu * 0.7);
      m = max(m, 1.0 - abs(v - a * uu) / w);
    }
    m = max(m, select(-1.0, 1.0 - abs(v) / 0.11, uu < 0.18));
    return abs(v) + m * 0.075 * select(-1.0, 1.0, uu < 0.98);
  }
  if (t == 9u) { return pow(sat((1.0 - uu) / 0.2), 0.8) * smoothstep(0.0, 0.05, uu); }
  if (t == 10u) { return pow(sin(3.14159 * pow(uu, 1.45)), 0.7) * ukTeeth(uu, 24.0, 0.05) * smoothstep(0.0, 0.08, uu); }
  if (t == 11u) {
    let b = pow(sin(3.14159 * pow(uu, 0.7)), 0.4);
    let notch = 1.0 - 0.45 * exp(-pow((uu - 0.38) / 0.07, 2.0)) - 0.3 * exp(-pow((uu - 0.66) / 0.06, 2.0));
    return b * notch * smoothstep(0.0, 0.06, uu);
  }
  if (t == 12u) {
    let b = pow(sin(3.14159 * pow(uu, 0.85)), 0.6) * smoothstep(0.0, 0.25, uu);
    return b * (0.3 + 0.7 * pow(abs(sin(uu * 3.14159 * 3.2 + 0.2)), 0.5)) * ukTeeth(uu, 30.0, 0.08);
  }
  if (t == 13u) { return pow(sin(3.14159 * pow(uu, 0.72)), 0.7) * ukTeeth(uu, 28.0, 0.09); }
  if (t == 14u) { return pow(sin(3.14159 * pow(uu, 0.7)), 0.72) * ukTeeth(uu, 12.0, 0.05); }
  if (t == 15u) { return pow(sin(3.14159 * pow(uu, 0.85)), 0.6); }
  return pow(sin(3.14159 * pow(uu, 0.68)), 0.75);
}
fn surfAlpha(in: V2F) -> f32 { return select(0.0, 1.0, leafHalf(in.uv.x, in.uv.y, (in.mat >> 8u) & 255u) > abs(in.uv.y)); }
fn surf(in: V2F, ff: bool) -> Surface {
  let u = in.uv.x; let v = in.uv.y; let ty = min((in.mat >> 8u) & 255u, 15u);
  let w = leafHalf(u, v, ty);
  let ed = (w - abs(v)) / max(fwidth(v) + fwidth(w), 1e-4);
  if (ed + 0.5 <= vegNoise(in.pos.xy + 7.0)) { discard; }
  let dcam = distance(in.wpos, F.camPos.xyz);
  if (dcam < 3.2 && vegNoise(in.pos.xy) >= sat((dcam - 1.0) / 2.2)) { discard; }
  let LT = UK_LT[ty];
  var s = surfDefault(normalize(in.nrm));
  let Vd = normalize(F.camPos.xyz - in.wpos); let nvd = dot(s.normal, Vd);
  if (nvd < 0.0) { s.normal = normalize(s.normal - Vd * (nvd * 1.7)); }
  let ao = in.col.a; let near = sat(1.0 - in.ext.w / 16.0);
  let mid = (1.0 - smoothstep(0.035, 0.08 + fwidth(v) * 1.5, abs(v))) * 0.55 * select(1.0, 0.0, ty == 8u);
  let vp = abs(fract(u * 7.0 - abs(v) * 1.7) - 0.5);
  let veins = (1.0 - smoothstep(0.04, 0.1 + fwidth(u) * 9.0, vp)) * 0.22 * near * smoothstep(0.06, 0.2, abs(v)) * LT.w;
  var alb = vec3f(0.062, 0.076, 0.029) * in.col.rgb * (0.78 + 0.34 * u) * (0.9 + 0.16 * sat(abs(v) / max(w, 0.05)));
  alb = mix(alb, alb * vec3f(1.55, 1.5, 1.25) + 0.004, max(mid, veins));
  if (ty == 8u || ty == 9u) { alb *= 0.9 + 0.2 * smoothstep(0.0, 1.0, u); }   // needles and blades: paler towards the tip
  // gloss: glossy leaves get smooth and a sharper highlight on most leaves; translucency from the type
  s.rough = mix(mix(0.92, 0.6, LT.x), 0.66 - LT.x * 0.3, step(0.78 - LT.x * 0.5, fract(in.col.a * 37.3 + in.ext.y * 11.1))); s.ao = max(ao, 0.5);
  s.sss = (0.3 + 0.12 * sat(-nvd * 2.0)) * (0.12 + 0.88 * ao * ao) * LT.y;
  let back = smoothstep(0.15, 0.8, dot(-Vd, F.sunDir.xyz)) * ao * ao * LT.y;
  alb = mix(alb, alb * vec3f(1.16, 1.12, 0.78), back * 0.6);
  s.emissive = 0.05 * smoothstep(0.35, 0.9, dot(-Vd, F.sunDir.xyz)) * ao * ao * ao * smoothstep(1.5, 5.0, in.ext.z) * LT.y;
  if (!ff) { alb = mix(alb * vec3f(1.06, 1.08, 0.95) + 0.002, vec3f(dot(alb, vec3f(0.33)) * 1.6 + 0.012), LT.z); s.rough = 0.92; }
  s.albedo = alb * (0.7 + 0.3 * ao);
  return s;
}
