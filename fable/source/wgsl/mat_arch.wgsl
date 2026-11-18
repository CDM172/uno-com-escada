// Architecture kit (35_wsm_arch.js): the buildings' shell, their instanced detail (ARCH_PROPS) and railings (ARCH_RAIL).
// Material by id; the building's colours, materials and window programme come from its record (4 texels of tRec):
//  40 wall (uv = u from the column's centre, height above the floor; colour bytes: r = programme, g = quoin distance /
//     shop half width (4 cm), b = opening width (2 cm), a = variant bits (gable columns: bottom of the opening, 4 cm);
//     vertex weight = top of the openings (cm / 32767))
//  41 roof covering (uv = along the eaves, down the slope from the top; colour r = covering, 255: the record's)
//  42 ridge and hip tiles  43 stone and other solids (colour rgb, alpha x 15 = surface code)  44 paint (alpha = gloss)
//  45 glazing  46 sign (uv in metres across the fascia)  47 awning  48 hedge  49 chimney pot  50 flat roof  51 lead
//  53 paving (code as 43)  54 dark  55 metal; 60.. the demo street's ground: 60 road, 61 pavement, 62 kerb, 63 grass,
//  64 soil, 65 tiles, 66 gravel, 67 decking, 68 painted line
#ifdef ARCH_PROPS
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) uv: vec2f, @location(3) mat: vec4u, @location(4) col: vec4f,
  @location(5) ip: vec3f, @location(6) iq: vec4f, @location(7) isz: vec4f, @location(8) im: u32, @location(9) ic: vec4f }
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let q = normalize(in.iq); let sc = max(in.isz.xyz * 32.0, vec3f(1e-4));
  let lp = in.pos * sc;
  let wp = in.ip + qrot(q, lp);
  o.wpos = wp; o.pwpos = wp;
  o.nrm = qrot(q, normalize(in.nrm.xyz / sc));
  o.uv = in.uv;
  o.mat = in.im;
  o.col = in.ic;
  // local metric position, and the face's axis (0 x, 1 y, 2 z) for the texture coordinates
  let an = abs(in.nrm.xyz); var ax = 2.0; if (an.x > an.y && an.x > an.z) { ax = 0.0; } else if (an.y > an.z) { ax = 1.0; }
  o.ext = vec4f(lp, ax);
  return o;
}
#else
#include mesh_vert
#endif
@group(3) @binding(0) var tRec: texture_2d<u32>;
@group(3) @binding(1) var tSign: texture_2d<f32>;

fn aDist(wp: vec3f) -> f32 {
#ifdef PASS_CUBE
  return distance(wp, P.camPos.xyz);
#else
  return distance(wp, F.camPos.xyz);
#endif
}
fn aCam() -> vec3f {
#ifdef PASS_CUBE
  return P.camPos.xyz;
#else
  return F.camPos.xyz;
#endif
}
fn aL(x: f32, w: f32, aa: f32) -> f32 { return 1.0 - smoothstep(w - aa, w + aa, abs(x)); }
fn aBox2(p: vec2f, a: vec2f, b: vec2f, aa: f32) -> f32 { let d = min(min(p.x - a.x, b.x - p.x), min(p.y - a.y, b.y - p.y)); return smoothstep(-aa, aa, d); }
fn aNz(p: vec2f) -> vec4f { return textureSample(tNoise, sLin, p); }
fn aH(p: vec2f) -> f32 { return hash21(p); }
fn aBump(N: vec3f, T: vec3f, gu: f32, gv: f32) -> vec3f { let B = normalize(cross(T, N)); return normalize(N + T * gu + B * gv); }

// ---------------------------------------------------------------- records
struct ARec {
  wall: vec3f, wallMat: u32, dress: vec3f, dressT: u32, trim: vec3f, win: u32, door: vec3f, doorT: u32,
  roof: vec3f, roofCov: u32, accent: vec3f, flags: u32,
  gH: f32, uH: f32, storeys: u32, recess: f32, gWinH: f32, uWinH: f32, gSill: f32, uSill: f32,
  hash: u32, sign: u32, signBg: u32, signFg: u32, signStyle: u32, doorH: f32, doorW: f32, fanH: f32, porchD: f32,
  shopTop: f32, riser: f32, glazing: u32, interior: u32, curtA: vec3f, curtMix: u32, curtB: vec3f,
}
fn aTex(i: u32, k: u32) -> vec4u { let t = i * 4u + k; return textureLoad(tRec, vec2i(i32(t & 1023u), i32(t >> 10u)), 0); }
fn aRGB(x: u32) -> vec3f { return vec3f(f32(x & 255u), f32((x >> 8u) & 255u), f32((x >> 16u) & 255u)) * (1.0 / 255.0); }
fn archRec(i: u32) -> ARec {
  let a = aTex(i, 0u); let b = aTex(i, 1u); let c = aTex(i, 2u); let d = aTex(i, 3u);
  var r: ARec;
  r.wall = aRGB(a.x); r.wallMat = a.x >> 24u; r.dress = aRGB(a.y); r.dressT = a.y >> 24u; r.trim = aRGB(a.z); r.win = a.z >> 24u; r.door = aRGB(a.w); r.doorT = a.w >> 24u;
  r.roof = aRGB(b.x); r.roofCov = b.x >> 24u; r.accent = aRGB(b.y); r.flags = b.y >> 24u;
  r.gH = f32(b.z & 1023u) * 0.01; r.uH = f32((b.z >> 10u) & 1023u) * 0.01; r.storeys = (b.z >> 20u) & 15u; r.recess = f32((b.z >> 24u) & 63u) * 0.01;
  r.gWinH = f32(b.w & 255u) * 0.02; r.uWinH = f32((b.w >> 8u) & 255u) * 0.02; r.gSill = f32((b.w >> 16u) & 255u) * 0.02; r.uSill = f32(b.w >> 24u) * 0.02;
  r.hash = c.x; r.sign = c.y & 255u; r.signBg = (c.y >> 8u) & 255u; r.signFg = (c.y >> 16u) & 255u; r.signStyle = c.y >> 24u;
  r.doorH = f32(c.z & 255u) * 0.02; r.doorW = f32((c.z >> 8u) & 255u) * 0.02; r.fanH = f32((c.z >> 16u) & 255u) * 0.02; r.porchD = f32(c.z >> 24u) * 0.01;
  r.shopTop = f32(c.w & 255u) * 0.02; r.riser = f32((c.w >> 8u) & 255u) * 0.02; r.glazing = (c.w >> 16u) & 255u; r.interior = c.w >> 24u;
  r.curtA = aRGB(d.x); r.curtMix = d.x >> 24u; r.curtB = aRGB(d.y);
  return r;
}
fn hashU(h: u32, k: u32) -> f32 { return hash11(f32((h >> (k & 15u)) & 65535u) * 0.137 + f32(k) * 7.31); }
const SHOP_BG = array<vec3f, 9>(vec3f(0.02, 0.05, 0.12), vec3f(0.015, 0.06, 0.03), vec3f(0.25, 0.02, 0.02), vec3f(0.03, 0.03, 0.03), vec3f(0.75, 0.74, 0.7),
  vec3f(0.5, 0.36, 0.05), vec3f(0.1, 0.02, 0.12), vec3f(0.02, 0.15, 0.17), vec3f(0.6, 0.6, 0.58));

// ---------------------------------------------------------------- wall materials. M: albedo, rough, normal bumps (gu, gv), ao
struct AM { a: vec3f, r: f32, gu: f32, gv: f32, ao: f32, metal: f32 }
fn amDef(c: vec3f) -> AM { var m: AM; m.a = c; m.r = 0.85; m.gu = 0.0; m.gv = 0.0; m.ao = 1.0; m.metal = 0.0; return m; }
// random rubble (Weston limestone): irregular stones, cellular in a space stretched along the wall; recessed lime mortar
fn aRubble(c: vec3f, p0: vec2f, near: f32, mid: f32, seed: f32) -> AM {
  var m = amDef(c);
  let p = vec2f(p0.x * 2.4, p0.y * 3.6);
  let ip = floor(p); let fp = fract(p);
  var d1 = 9.0; var d2 = 9.0; var id = vec2f(0.0);
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let g = vec2f(f32(i), f32(j)); let o = hash22(ip + g + seed) * vec2f(0.85, 0.7) + vec2f(0.075, 0.15);
    let r = g + o - fp; let d = dot(r * vec2f(1.0, 1.25), r * vec2f(1.0, 1.25));
    if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }
  } }
  let edge = sqrt(d2) - sqrt(d1);
  let jw = 0.09 + fwidth(p.x) * 0.9;
  let joint = (1.0 - smoothstep(jw * 0.6, jw * 1.6, edge)) * mid;
  let hs = hash21(id + seed * 3.1); let hs2 = hash21(id * 1.7 + 4.3);
  // each stone its own shade: grey, blue-grey, buff, a few rusty or pinkish
  var sc = c * (0.78 + 0.44 * hs);
  sc = mix(sc, sc * vec3f(1.12, 1.02, 0.86), step(0.72, hs2) * 0.8);
  sc = mix(sc, sc * vec3f(0.88, 0.94, 1.06), step(hs2, 0.25) * 0.6);
  let n = aNz(p0 * 1.3 + hs);
  sc *= 0.86 + 0.28 * n.r;
  let mort = vec3f(0.46, 0.44, 0.4) * (0.85 + 0.2 * n.g);
  m.a = mix(sc, mort, joint * 0.85);
  m.ao = 1.0 - 0.45 * joint;
  // pillowed faces, rough to the touch
  let pil = smoothstep(0.0, 0.25, edge);
  let dn = aNz(p0 * 3.7 + hs * 5.0).rg - 0.5;
  m.gu = (dn.x * 0.5 + (hs - 0.5) * 0.25) * near * pil; m.gv = (dn.y * 0.5 + (hs2 - 0.5) * 0.2) * near * pil;
  m.r = 0.9;
  return m;
}
// ashlar (Bath stone): long smooth blocks in courses, fine joints
fn aAshlar(c: vec3f, p: vec2f, near: f32, mid: f32, seed: f32) -> AM {
  var m = amDef(c);
  let row = floor(p.y / 0.3); let bl = 0.7 + 0.25 * hash11(row + seed);
  let bu = p.x / bl + hash11(row * 3.7 + seed) ; let bi = vec2f(floor(bu), row);
  let fu = abs(fract(bu) - 0.5) * bl; let fv = abs(fract(p.y / 0.3) - 0.5) * 0.3;
  let jw = 0.004 + max(fwidth(p.x), fwidth(p.y)) * 0.6;
  let joint = (1.0 - smoothstep(jw, jw * 2.5, min(bl * 0.5 - fu, 0.15 - fv))) * mid;
  let hb = hash21(bi + seed);
  let n = aNz(p * 0.6 + hb);
  m.a = c * (0.9 + 0.16 * hb) * (0.9 + 0.18 * n.r);
  m.a = mix(m.a, m.a * 0.72, joint * 0.6); m.ao = 1.0 - 0.25 * joint;
  m.gu = (n.g - 0.5) * 0.06 * near; m.gv = (n.b - 0.5) * 0.06 * near; m.r = 0.8;
  return m;
}
// brick: stretcher bond (Flemish when fl > 0.5), 215 x 65 mm with 10 mm joints
fn aBrick(c: vec3f, p: vec2f, near: f32, mid: f32, seed: f32, fl: f32) -> AM {
  var m = amDef(c);
  let row = floor(p.y / 0.075); let odd = row - 2.0 * floor(row * 0.5);
  var len = 0.225; var bu = p.x / len + 0.5 * odd;
  if (fl > 0.5) { bu = (p.x + odd * 0.056) / 0.3375 * 2.0; }
  let bi = vec2f(floor(bu), row); var hb = hash21(bi + seed * 7.0);
  var header = 0.0; if (fl > 0.5) { header = bi.x - 2.0 * floor(bi.x * 0.5); len = select(0.225, 0.1125, header > 0.5); }
  let fu = abs(fract(bu) - 0.5); let fv = abs(fract(p.y / 0.075) - 0.5) * 0.075;
  let mw = 0.006 + max(fwidth(p.x), fwidth(p.y)) * 0.5;
  let mort = (1.0 - smoothstep(0.5 - mw / 0.225 * 1.6, 0.5 - mw / 0.225 * 0.4, fu) * smoothstep(0.0375 - mw * 1.4, 0.0375 - mw * 0.4, fv)) * mid;
  let n = aNz(p * 0.4 + hb); let n2 = aNz(p * 3.1);
  var bc = c * (0.76 + 0.46 * hb) * (0.88 + 0.22 * n.r);
  bc = mix(bc, bc * vec3f(0.55, 0.5, 0.55), step(0.86, hb) * 0.7 + header * 0.25);   // burnt ends, darker headers
  m.a = mix(bc, vec3f(0.36, 0.34, 0.3) * (0.85 + 0.2 * n2.g), mort * 0.8);
  m.ao = 1.0 - 0.3 * mort; m.r = 0.88;
  m.gu = (n2.r - 0.5) * 0.14 * near; m.gv = (n2.g - 0.5) * 0.14 * near;
  return m;
}
fn aRender(c: vec3f, p: vec2f, near: f32, rough: f32) -> AM {
  var m = amDef(c);
  let n1 = aNz(p * 0.09); let n2 = aNz(p * 0.8); let n3 = aNz(p * 5.3);
  m.a = c * (0.93 + 0.1 * n1.r) * (0.97 + 0.05 * n2.g);
  m.r = mix(0.78, 0.92, rough);
  m.gu = (n3.r - 0.5) * mix(0.05, 0.3, rough) * near; m.gv = (n3.g - 0.5) * mix(0.05, 0.3, rough) * near;
  return m;
}
fn aDash(c: vec3f, p: vec2f, near: f32) -> AM {
  var m = amDef(c);
  let n1 = aNz(p * 0.13); let n2 = aNz(p * 7.0); let n3 = aNz(p * 13.0 + 0.5);
  m.a = c * (0.88 + 0.16 * n1.r) * (0.8 + 0.4 * n2.b);
  m.gu = (n2.r - 0.5) * 0.7 * near + (n3.r - 0.5) * 0.4 * near; m.gv = (n2.g - 0.5) * 0.7 * near + (n3.g - 0.5) * 0.4 * near;
  m.ao = 0.85 + 0.15 * n2.b; m.r = 0.93;
  return m;
}
fn aBoard(c: vec3f, p: vec2f, near: f32, mid: f32) -> AM {
  var m = amDef(c);
  let b = fract(p.y / 0.15); let bi = floor(p.y / 0.15);
  let n = aNz(vec2f(p.x * 0.2, bi * 0.37));
  let lap = (1.0 - smoothstep(0.0, 0.12 + fwidth(p.y / 0.15) * 2.0, b)) * mid;
  m.a = c * (0.9 + 0.12 * hash11(bi * 3.3)) * (0.92 + 0.12 * n.r) * (1.0 - 0.5 * lap);
  m.ao = 1.0 - 0.4 * lap; m.gv = (b - 0.5) * 0.35 * mid; m.r = 0.7;
  return m;
}
fn aClad(c: vec3f, p: vec2f, mid: f32) -> AM {
  var m = amDef(c);
  let rib = fract(p.x / 0.2); let n = aNz(p * 0.3);
  let pr = smoothstep(0.0, 0.08, rib) - smoothstep(0.32, 0.4, rib);   // trapezoid ribs
  m.a = c * (0.88 + 0.12 * n.r) * (0.9 + 0.1 * pr);
  m.gu = (smoothstep(0.0, 0.08, rib) * -1.0 + smoothstep(0.32, 0.4, rib)) * 0.8 * mid; m.r = 0.45; m.metal = 0.3;
  return m;
}
// static caravan siding: ribbed panels, the makers' band of colour, green grime from the corners and the skirt
fn aCaravan(c: vec3f, acc: vec3f, p: vec2f, v: f32, mid: f32, style: u32, seed: f32) -> AM {
  var m = amDef(c);
  let rib = fract(v / 0.1); let n = aNz(p * 0.25 + seed);
  m.a = c * (0.95 + 0.06 * n.r);
  m.gv = (smoothstep(0.0, 0.15, rib) - smoothstep(0.85, 1.0, rib)) * 0.25 * mid;
  var band = 0.0;
  if (style == 0u) { band = step(0.72, v) * step(v, 0.9); }
  else if (style == 1u) { band = step(0.8, v) * step(v, 0.86) + step(0.92, v) * step(v, 0.95); }
  else if (style == 2u) { band = step(v, 0.62); }
  else { band = step(1.86, v) * step(v, 2.02); }
  m.a = mix(m.a, acc * (0.9 + 0.1 * n.g), band);
  let grime = smoothstep(0.55, 0.85, aNz(vec2f(p.x * 0.6, v * 0.25) + seed).g) * (1.0 - smoothstep(0.0, 0.9, v));
  m.a = mix(m.a, m.a * vec3f(0.55, 0.62, 0.42), grime * 0.6);
  m.r = 0.42;
  return m;
}
fn aWallMatl(t: u32, c: vec3f, R: ARec, p: vec2f, v: f32, near: f32, mid: f32) -> AM {
  let seed = f32(R.hash & 1023u) * 0.37;
  if (t == 1u) { return aRubble(c, p, near, mid, seed); }
  if (t == 2u) { return aAshlar(c, p, near, mid, seed); }
  if (t == 3u || t == 4u) { return aBrick(c, p, near, mid, seed, select(0.0, 1.0, (R.hash & 3u) == 0u && R.dressT == 1u)); }
  if (t == 5u) { return aDash(c, p, near); }
  if (t == 6u) { return aBoard(c, p, near, mid); }
  if (t == 7u) { return aClad(c, p, mid); }
  if (t == 8u) { return aCaravan(c, R.accent, p, v, mid, R.flags & 3u, seed); }
  if (t == 9u) { var m = aRender(c, p, near, 0.3); let j = aL(fract(p.x / 1.2) - 0.5, 0.49, 0.004) ; m.a *= 1.0 - 0.0 * j; let g = max(1.0 - smoothstep(0.0, 0.012 + fwidth(p.x), abs(fract(p.x / 1.2 + 0.5) - 0.5) * 1.2), 1.0 - smoothstep(0.0, 0.012 + fwidth(p.y), abs(fract(p.y / 2.8 + 0.5) - 0.5) * 2.8)) * mid; m.a *= 1.0 - 0.4 * g; m.ao *= 1.0 - 0.3 * g; return m; }
  if (t == 10u) { return aRender(c, p, near, 1.0); }
  return aRender(c, p, near, 0.0);
}
