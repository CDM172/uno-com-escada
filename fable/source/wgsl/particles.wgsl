// Fumaça de pneu e poeira: cartões voltados para a câmera, iluminados por vértice, com borda suave contra a profundidade.
#include fwd_common
struct VIn {
  @builtin(vertex_index) vi: u32,
  @location(0) pos: vec4f,     // xyz centro, w tamanho
  @location(1) col: vec4f,     // rgb, alfa
  @location(2) misc: vec4f,    // rotação, semente, -, -
}
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let k = in.vi % 6u; let cx = select(-1.0, 1.0, k == 1u || k == 2u || k == 4u); let cy = select(-1.0, 1.0, k == 2u || k == 4u || k == 5u);
  let right = F.invView[0].xyz; let up = F.invView[1].xyz;
  let c = cos(in.misc.x); let s = sin(in.misc.x); let q = vec2f(cx * c - cy * s, cx * s + cy * c);
  o.wpos = in.pos.xyz + (right * q.x + up * q.y) * in.pos.w;
  o.pwpos = o.wpos; o.nrm = vec3f(0.0, 1.0, 0.0); o.uv = vec2f(cx, cy); o.mat = 0u;
  // luz no centro do cartão
  let lp = F.shadowVP[1] * vec4f(in.pos.xyz, 1.0); let suv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  // sombra suavizada (4 amostras espalhadas) para a nuvem não piscar ao cruzar a borda de uma sombra
  var sh = 1.0;
  if (suv.x > 0.02 && suv.y > 0.02 && suv.x < 0.98 && suv.y < 0.98) {
    sh = 0.0; let e = 14.0 / SHADOW_RES;
    sh += textureSampleCompareLevel(tShadow, sCmp, suv + vec2f(e, e), 1, lp.z - 0.002); sh += textureSampleCompareLevel(tShadow, sCmp, suv + vec2f(-e, e), 1, lp.z - 0.002);
    sh += textureSampleCompareLevel(tShadow, sCmp, suv + vec2f(e, -e), 1, lp.z - 0.002); sh += textureSampleCompareLevel(tShadow, sCmp, suv + vec2f(-e, -e), 1, lp.z - 0.002);
    sh *= 0.25;
  }
  let V = normalize(F.camPos.xyz - in.pos.xyz);
  let ph = 0.55 + 0.45 * pow(sat(dot(-V, F.sunDir.xyz) * 0.5 + 0.5), 3.0) * 2.2;
  let amb = max(F.sh[0].rgb + F.sh[1].rgb * 0.5, vec3f(0.0));
#ifdef BCAR
  // gadget particles that glow by themselves (tracers): misc.z = 1 → the colour is what they emit, whatever the light on them
#ifdef V8
  // (V8: misc.z = 2 is fire, which glows too)
  o.col = vec4f(in.col.rgb * mix(F.sunCol.rgb * (0.15 + 0.85 * sh) * ph / PI + amb * 1.2, vec3f(1.0), min(in.misc.z, 1.0)), in.col.a);
#else
  o.col = vec4f(in.col.rgb * mix(F.sunCol.rgb * (0.15 + 0.85 * sh) * ph / PI + amb * 1.2, vec3f(1.0), in.misc.z), in.col.a);
#endif
  o.ext = vec4f(in.misc.y, in.misc.z, 0.0, 0.0);
#else
  o.col = vec4f(in.col.rgb * (F.sunCol.rgb * (0.15 + 0.85 * sh) * ph / PI + amb * 1.2), in.col.a);
  o.ext = vec4f(in.misc.y, 0.0, 0.0, 0.0);
#endif
  return o;
}
fn shade(in: V2F, ff: bool) -> vec4f {
  let r = length(in.uv);
#ifdef BCAR
#ifdef V8
  if (in.ext.y > 1.5) {   // fire (explosions, rocket motors): a ragged ball that glows by itself; the CPU turns it from yellow to red
    let sf = vec2f(in.ext.x * 7.3, in.ext.x * 3.1);
    let nf = textureSampleLevel(tNoise, sLin, in.uv * 0.23 + sf, 0.0); let nf2 = textureSampleLevel(tNoise, sLin, in.uv * 0.61 - sf * 1.7, 0.0);
    let dens = smoothstep(1.0, 0.2, r) * sat(0.9 - r * 0.8 + (nf.r - 0.5) * 2.0 + (nf2.g - 0.5) * 1.2);
    let zs = F.camFwd.w / max(textureLoad(gD, vec2i(in.pos.xy), 0), 1e-6); let zf = F.camFwd.w / in.pos.z;
    let a = smoothstep(0.15, 0.7, dens) * in.col.a * smoothstep(0.0, 0.6, zs - zf) * smoothstep(0.3, 1.5, zf);
    return vec4f(in.col.rgb * a * (0.6 + 0.8 * nf2.r), a * 0.35);
  }
#endif
  if (in.ext.y > 0.5) {   // glowing dot (tracer): a soft additive blob, hidden by anything in front of it
    let g = sat(1.0 - r); let zn = F.camFwd.w / in.pos.z;
    return vec4f(in.col.rgb * (g * g * in.col.a * smoothstep(0.4, 2.5, zn)), 0.0);
  }
#endif
  // dois níveis de ruído deslocados pela semente: bordas rasgadas e miolo com relevo
  let sd = vec2f(in.ext.x * 7.3, in.ext.x * 3.1);
  let n = textureSampleLevel(tNoise, sLin, in.uv * 0.19 + sd, 1.0);
  let n2 = textureSampleLevel(tNoise, sLin, in.uv * 0.47 - sd * 1.7, 0.0);
  // novelos com borda desfiada: o ruído corrói a densidade (sem isto as partículas somadas viram um véu uniforme)
  let dens = smoothstep(1.0, 0.35, r) * sat(0.85 - r * 0.9 + (n.r - 0.5) * 2.3 + (n2.g - 0.5) * 1.1);
  var a = smoothstep(0.1, 0.62, dens) * in.col.a;
  // volume falso: normal de uma esfera amassada pelo ruído, iluminada pelo sol em espaço de câmera
  let nz = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
  let N = normalize(vec3f(in.uv + (n.rg - 0.5) * 0.9, nz + 0.35));
  let Lv = (F.view * vec4f(F.sunDir.xyz, 0.0)).xyz;
  let wrap = sat(dot(N, Lv) * 0.5 + 0.5);
  let lit = mix(0.3, 1.3, wrap * wrap) * (0.7 + 0.6 * n2.r) * mix(0.72, 1.0, sat(in.uv.y * 0.5 + 0.5));   // base da nuvem mais escura (auto-sombra)
  // borda suave contra a geometria e perto da lente
  let zs = F.camFwd.w / max(textureLoad(gD, vec2i(in.pos.xy), 0), 1e-6); let zf = F.camFwd.w / in.pos.z;
  a *= smoothstep(0.0, 1.1, zs - zf) * smoothstep(1.2, 7.0, zf);
  return vec4f(in.col.rgb * lit * a, a);
}
