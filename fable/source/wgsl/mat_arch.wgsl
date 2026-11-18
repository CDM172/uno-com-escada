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
#include palette
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
// coursed rubble (Weston limestone): roughly squared stones of mixed sizes in uneven courses, small snecks between the
// bigger ones, recessed lime mortar
fn aRubble(c: vec3f, p0: vec2f, near: f32, mid: f32, seed: f32) -> AM {
  var m = amDef(c);
  let wob = (aNz(p0 * vec2f(0.9, 1.4) + seed).rg - 0.5) * vec2f(0.05, 0.035);   // irregular edges
  let p = p0 + wob;
  // courses of 0.42 m; along a course stones of 0.25-0.6 m, each one whole or split into two or three of uneven height
  let ch = 0.42; let row = floor(p.y / ch); let fy = fract(p.y / ch);
  let len = 0.3 + 0.22 * hash11(row * 1.37 + seed);
  let su = p.x / len + hash11(row * 3.1 + seed * 1.7); let si = floor(su); let fxr = fract(su);
  let hs = hash21(vec2f(si, row) + seed);
  // stones of uneven length: the joint inside the slot shifts per stone
  let cut = 0.5 + (hash21(vec2f(si + 7.0, row) + seed) - 0.5) * 0.5;
  let left = fxr < cut; let fx = select((fxr - cut) / (1.0 - cut), fxr / cut, left); let ln = len * select(1.0 - cut, cut, left);
  let sid = si * 2.0 + select(1.0, 0.0, left);
  let hs2 = hash21(vec2f(sid, row) + seed * 1.3);
  var ex = min(fx, 1.0 - fx) * ln; var ey = min(fy, 1.0 - fy) * ch; var id = vec2f(sid, row);
  if (hs2 < 0.42) { let k = 0.35 + 0.3 * hash11(sid + row * 5.0); let up = fy > k; let f2 = select(fy / k, (fy - k) / (1.0 - k), up); ey = min(f2, 1.0 - f2) * ch * select(k, 1.0 - k, up); id = vec2f(sid, row * 3.0 + select(0.0, 1.0, up) + 100.0); }
  else if (hs2 < 0.6) { let f3 = fract(fy * 3.0); ey = min(f3, 1.0 - f3) * ch / 3.0; id = vec2f(sid, row * 3.0 + floor(fy * 3.0) + 300.0); }
  let e = min(ex, ey);
  let jw = 0.012 + max(fwidth(p.x), fwidth(p.y)) * 0.5;
  let joint = (1.0 - smoothstep(jw * 0.5, jw * 1.6, e)) * mid;
  let h1 = hash21(id * 1.31 + seed); let h2 = hash21(id * 2.17 + 4.3);
  // each stone its own shade: grey, blue-grey, buff, a few rusty or pinkish
  var sc = c * (0.72 + 0.5 * h1);
  sc = mix(sc, sc * vec3f(1.14, 1.02, 0.84), step(0.74, h2) * 0.8);
  sc = mix(sc, sc * vec3f(0.86, 0.93, 1.06), step(h2, 0.22) * 0.6);
  let n = aNz(p0 * 1.7 + h1 * 3.0);
  sc *= 0.84 + 0.3 * n.r;
  let mort = c * vec3f(1.15, 1.12, 1.05) * (0.8 + 0.2 * n.g);
  m.a = mix(sc, mort, joint * 0.8);
  m.ao = 1.0 - 0.5 * joint;
  // rock-faced: each stone bulges, rough to the touch
  let pil = smoothstep(0.0, 0.05, e);
  let dn = aNz(p0 * 4.3 + h1 * 7.0).rg - 0.5;
  m.gu = (dn.x * 0.6 + (h1 - 0.5) * 0.3) * near * pil; m.gv = (dn.y * 0.6 + (h2 - 0.5) * 0.25) * near * pil + (1.0 - pil) * 0.3 * near;
  m.r = 0.92;
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

// ---------------------------------------------------------------- openings of a wall column (the JS side places the
// sills from the same rules: 35_wsm_arch.js archDetails)
// kind: 0 none, 1 window, 2 door, 3 shop window, 4 garage / roller / barn door, 5 french window, 6 single opening
// (gable, dormer, porch side, conservatory), 7 shop door
struct AOp { kind: u32, x0: f32, x1: f32, y0: f32, y1: f32, k: u32, sb: f32 }
fn aOpening(prog: u32, va: u32, ow: f32, hw: f32, u: f32, v: f32, top: f32, R: ARec) -> AOp {
  var o: AOp; o.kind = 0u; o.k = 0u; o.sb = 0.0; o.x0 = 0.0; o.x1 = 0.0; o.y0 = 0.0; o.y1 = 0.0;
  let uh = max(R.uH, 1.0);
  if ((prog & 128u) != 0u) {
    if (va == 255u || ow < 0.25) { return o; }
    o.y0 = f32(va) * 0.04; o.y1 = top; if (o.y1 - o.y0 < 0.4) { return o; }
    o.x0 = -ow * 0.5; o.x1 = ow * 0.5; o.kind = 6u;
    if (o.y0 >= R.gH) { o.k = 1u + u32(floor((o.y0 - R.gH) / uh)); o.sb = R.gH + f32(o.k - 1u) * uh; }
    return o;
  }
  var k = 0u; var sb = 0.0;
  if (v >= R.gH) { k = 1u + u32(floor((v - R.gH) / uh)); sb = R.gH + f32(k - 1u) * uh; }
  o.k = k; o.sb = sb;
  if (k < ((va >> 4u) & 3u)) { return o; }
  let g = prog & 3u; let up = prog & 12u;
  if (k == 0u) {
    if (g == 0u) {
      if (ow < 0.25) { return o; }
      o.x0 = -ow * 0.5; o.x1 = ow * 0.5; o.y0 = R.gSill; o.y1 = R.gSill + R.gWinH; o.kind = 1u;
      if ((va & 8u) != 0u) { o.y0 = 0.04; o.kind = 5u; }
    } else if (g == 1u) {
      if ((va & 4u) != 0u) { o.x0 = -ow * 0.5; o.x1 = ow * 0.5; o.y1 = min(max(R.doorH, 2.0), R.gH - 0.3); o.kind = 4u; }
      else if ((va & 8u) != 0u) { o.x0 = -ow * 0.5; o.x1 = ow * 0.5; o.y0 = 0.04; o.y1 = R.gSill + R.gWinH; o.kind = 5u; }
      else { o.x0 = -R.doorW * 0.5; o.x1 = R.doorW * 0.5; o.y1 = min(R.doorH, R.gH - 0.2); o.kind = 2u; }
    } else if (g == 2u) {
      o.x0 = -hw + 0.05; o.x1 = hw - 0.05; o.y0 = R.riser; o.y1 = R.shopTop - 0.06; o.kind = 3u;
      if ((va & 4u) != 0u) {   // the shop's door: at the inner end of the run, recessed
        let sd = select(-1.0, 1.0, (R.hash & 64u) != 0u);
        let dx0 = select(-hw + 0.12, hw - 1.12, sd > 0.0);
        if (u > dx0 && u < dx0 + 1.0) { o.x0 = dx0; o.x1 = dx0 + 1.0; o.y0 = 0.0; o.y1 = R.shopTop - 0.42; o.kind = 7u; }
      }
    }
    return o;
  }
  if (k >= R.storeys || up == 8u) { return o; }
  var w = ow; if (up == 4u) { w = min(ow, 0.75); }
  if (w < 0.25) { return o; }
  o.x0 = -w * 0.5; o.x1 = w * 0.5;
  if ((up == 12u && k == 1u) || (va & 8u) != 0u) { o.y0 = sb + 0.04; o.y1 = min(sb + R.uSill + R.uWinH, top - 0.25); o.kind = 5u; }
  else { o.y0 = sb + R.uSill; o.y1 = min(sb + R.uSill + R.uWinH, top - 0.25); o.kind = 1u; }
  if (o.y1 - o.y0 < 0.5) { o.kind = 0u; }
  if ((va & 3u) == 1u && o.kind == 1u) { o.y0 = o.y1 - (o.y1 - o.y0) * 0.55; o.x0 *= 0.7; o.x1 *= 0.7; }
  return o;
}

// ---------------------------------------------------------------- recess by parallax: where the view ray into the
// opening meets its back (glass, door) or a reveal. Vw: the view direction in wall space (along, up, out).
struct AHit { face: u32, uh: f32, vh: f32, z: f32 }
fn aParallax(u: f32, v: f32, x0: f32, x1: f32, y0: f32, y1: f32, d: f32, Vw: vec3f) -> AHit {
  var h: AHit; let vn = max(Vw.z, 0.04); let du = Vw.x / vn; let dv = Vw.y / vn;
  var z = d; var face = 0u;
  if (du > 1e-4) { let t = (u - x0) / du; if (t < z) { z = t; face = 1u; } }
  if (du < -1e-4) { let t = (u - x1) / du; if (t < z) { z = t; face = 2u; } }
  if (dv > 1e-4) { let t = (v - y0) / dv; if (t < z) { z = t; face = 3u; } }
  if (dv < -1e-4) { let t = (v - y1) / dv; if (t < z) { z = t; face = 4u; } }
  z = max(z, 0.0);
  h.face = face; h.z = z; h.uh = u - du * z; h.vh = v - dv * z;
  return h;
}
// sunlight reaching a point inside the recess (the façade's own shadow is the shadow map's)
fn aRecessSun(uh: f32, vh: f32, z: f32, x0: f32, x1: f32, y0: f32, y1: f32, Lw: vec3f) -> f32 {
  if (Lw.z <= 0.03) { return 1.0; }
  let s = z / Lw.z; let us = uh + Lw.x * s; let vs = vh + Lw.y * s;
  return smoothstep(-0.015, 0.015, min(min(us - x0, x1 - us), min(vs - y0, y1 - vs)));
}

// ---------------------------------------------------------------- behind the glass: a room (wall, floor, ceiling) and
// whatever hangs at the window: curtains drawn back or closed, net curtains, roller and venetian blinds
fn aRoom(u: f32, v: f32, x0: f32, x1: f32, fl: f32, ce: f32, z0: f32, Vw: vec3f, hs: f32, shop: bool) -> vec3f {
  let vn = max(Vw.z, 0.04); let du = Vw.x / vn; let dv = Vw.y / vn;
  let ux = u - du * z0; let vy = v - dv * z0;
  let xl = x0 - 1.3; let xr = x1 + 1.3; let D = select(3.6, 5.5, shop);
  var t = D; var f = 0u;
  if (du > 1e-4) { let tt = (ux - xl) / du; if (tt < t) { t = tt; f = 1u; } }
  if (du < -1e-4) { let tt = (ux - xr) / du; if (tt < t) { t = tt; f = 2u; } }
  if (dv > 1e-4) { let tt = (vy - fl) / dv; if (tt < t) { t = tt; f = 3u; } }
  if (dv < -1e-4) { let tt = (vy - ce) / dv; if (tt < t) { t = tt; f = 4u; } }
  t = max(t, 0.0);
  let hx = ux - du * t; let hy = vy - dv * t;
  let wc = mix(vec3f(0.62, 0.58, 0.5), vec3f(0.5, 0.55, 0.58), hash11(hs * 13.1)) * (0.7 + 0.5 * hash11(hs * 7.7));
  var c = wc;
  if (f == 3u) { c = mix(vec3f(0.22, 0.14, 0.08), vec3f(0.32, 0.28, 0.24), hash11(hs * 3.3)); }
  else if (f == 4u) { c = vec3f(0.75, 0.74, 0.7); }
  else if (f != 0u) { c = wc * 0.8; }
  if (f == 0u) {
    // furniture against the back wall, a picture, a lamp
    let low = step(hy - fl, 0.85) * step(0.15, fract(hx * 0.31 + hs));
    c = mix(c, mix(vec3f(0.12, 0.1, 0.09), vec3f(0.3, 0.15, 0.1), hash11(hs * 5.1)), low);
    let pic = step(abs(hx - (x0 + x1) * 0.5 + (hs - 0.5)), 0.35) * step(abs(hy - fl - 1.55), 0.25);
    c = mix(c, vec3f(0.15, 0.2, 0.25) * (0.6 + hash11(hs * 9.0)), pic * 0.8);
    if (shop) {   // shelves of goods
      let sh = fract((hy - fl) / 0.42); let col = hash33(vec3f(floor(hx * 9.0), floor((hy - fl) / 0.42), hs * 10.0));
      c = mix(mix(vec3f(0.45), col, 0.45) * (0.6 + 0.4 * step(0.25, sh)), vec3f(0.62), step(sh, 0.08)) * step(0.35, hy - fl);
    }
  }
  let k = exp(-t * select(0.32, 0.15, shop));
  return c * (0.25 + 0.75 * k) * select(0.1, 0.2, shop);
}
// curtain layer: x, y in the opening (0..w, 0..h); returns colour and coverage (a)
fn aCurtains(x: f32, y: f32, w: f32, h: f32, hs: f32, R: ARec) -> vec4f {
  let ty = u32(hs * 8.99); let h2 = hash11(hs * 31.7);
  let ca = mix(R.curtA, R.curtB, step(0.5, h2)) * (0.75 + 0.4 * hash11(hs * 5.3));
  let fold = 0.82 + 0.18 * sin(x * 38.0 + hs * 20.0);
  if (ty == 0u) { return vec4f(0.0); }
  if (ty == 1u || ty == 2u) {   // drawn back to the sides (a little more on one)
    let cw = w * select(0.16, 0.3, ty == 2u);
    let a = max(step(x, cw * (1.0 + 0.3 * h2)), step(w - cw * (1.3 - 0.3 * h2), x)) * step(y, h - 0.02);
    return vec4f(ca * fold, a);
  }
  if (ty == 3u) {   // nets across the lower part, curtains at the sides
    let side = max(step(x, w * 0.14), step(w * 0.86, x));
    if (side > 0.5) { return vec4f(ca * fold, 1.0); }
    let net = step(y, h * 0.62) * (0.55 + 0.25 * step(0.5, fract(x * 14.0 + y * 14.0)));
    return vec4f(vec3f(0.72, 0.71, 0.67), net);
  }
  if (ty == 4u) {   // roller blind part way down
    let b = h * (1.0 - (0.25 + 0.6 * h2));
    return vec4f(mix(vec3f(0.7, 0.66, 0.58), vec3f(0.35, 0.36, 0.38), step(0.6, hash11(hs * 2.1))), step(b, y));
  }
  if (ty == 5u) {   // venetian blind, slats
    let sl = fract(y / 0.035); let open = 0.3 + 0.5 * h2;
    return vec4f(vec3f(0.72, 0.71, 0.68) * (0.8 + 0.2 * sl), step(open, sl) * 0.95 + 0.05);
  }
  if (ty == 6u) { return vec4f(ca * fold, step(y, h - 0.02)); }   // closed
  if (ty == 7u) { return vec4f(vec3f(0.74, 0.73, 0.7) * (0.9 + 0.1 * fold), 0.62); }   // nets all over
  return vec4f(0.0);
}

// ---------------------------------------------------------------- joinery of a window (x, y in the opening, w x h):
// .x = frame and bars, .y = pane number (per-pane glass), .z = 1 where an opened sash leaves a gap
fn aWinFrame(t: u32, x: f32, y: f32, w: f32, h: f32, hs: f32, aa: f32) -> vec3f {
  let p = vec2f(x, y);
  var fw = 0.055; if (t == 5u) { fw = 0.068; } else if (t >= 6u && t <= 8u) { fw = 0.038; } else if (t == 10u) { fw = 0.06; }
  var f = 1.0 - aBox2(p, vec2f(fw), vec2f(w - fw, h - fw), aa);
  var pane = 0.0; var gap = 0.0;
  if (t <= 3u) {
    // sliding sashes: meeting rail, stiles, the lower sash's deep bottom rail, glazing bars; now and then raised
    let opn = select(0.0, (0.1 + 0.25 * hash11(hs * 3.1)) * h, hash11(hs * 17.3) < 0.12);
    let mr = h * 0.52 + opn;
    f = max(f, aL(y - mr, 0.026, aa));
    f = max(f, max(1.0 - step(fw + 0.042, x), step(w - fw - 0.042, x)));
    f = max(f, aL(y - (fw + 0.04 + opn), 0.04, aa));
    if (opn > 0.0 && y > fw && y < fw + opn) { gap = 1.0; }
    if (t == 1u) { f = max(f, aL(x - w * 0.5, 0.012, aa)); }
    if (t == 2u) { f = max(f, max(aL(x - w / 3.0, 0.01, aa), aL(x - w * 2.0 / 3.0, 0.01, aa))); f = max(f, max(aL(y - mr * 0.52, 0.01, aa), aL(y - (mr + (h - mr) * 0.5), 0.01, aa))); }
    if (t == 3u && y > mr) { f = max(f, max(aL(x - w / 3.0, 0.009, aa), aL(x - w * 2.0 / 3.0, 0.009, aa))); f = max(f, aL(y - (mr + (h - mr) * 0.6), 0.009, aa)); }
    pane = select(0.0, 1.0, y > mr);
  } else if (t == 4u || t == 9u) {
    // timber casements: lights of about half a metre, a transom with top lights; the cottages' small panes
    let nl = max(1.0, round((w - 2.0 * fw) / 0.52)); let lw = (w - 2.0 * fw) / nl; let lx = (x - fw) / lw;
    f = max(f, aL((fract(lx + 0.5) - 0.5) * lw, 0.026, aa) * step(0.5, lx) * step(lx, nl - 0.5));
    let tr = h * 0.72; f = max(f, aL(y - tr, 0.03, aa) * step(0.9, h));
    if (t == 9u) { f = max(f, aL((fract((x - fw) / 0.17) - 0.5) * 0.17, 0.006, aa)); f = max(f, aL((fract((y - fw) / 0.21) - 0.5) * 0.21, 0.006, aa)); }
    pane = floor(lx) + select(0.0, 10.0, y > tr);
  } else if (t == 5u) {
    // uPVC: chunky mullions and transom, an opener's double frame in some lights
    let nl = select(1.0, select(2.0, 3.0, w > 1.65), w > 0.85); let lw = w / nl; let lx = x / lw; let li = floor(lx);
    f = max(f, aL((fract(lx + 0.5) - 0.5) * lw, 0.034, aa) * step(0.5, lx) * step(lx, nl - 0.5));
    let tr = select(h * 2.0, h * 0.72, h > 1.05);
    f = max(f, aL(y - tr, 0.034, aa));
    if (hash11(hs * 5.7 + li * 1.3) < 0.55) {
      let y0 = select(fw, tr + 0.034, h > 1.05 && hash11(hs * 2.9 + li) < 0.5); let y1 = select(h - fw, tr - 0.034, h > 1.05 && y0 < tr);
      let x0 = li * lw + select(0.034, fw, li < 0.5); let x1 = (li + 1.0) * lw - select(0.034, fw, li > nl - 1.5);
      let inner = aBox2(p, vec2f(x0, y0), vec2f(x1, y1), aa) * (1.0 - aBox2(p, vec2f(x0 + 0.042, y0 + 0.042), vec2f(x1 - 0.042, y1 - 0.042), aa));
      f = max(f, inner);
    }
    pane = li + select(0.0, 10.0, y > tr);
  } else if (t == 6u) { f = max(f, aL(x - w * 0.68, 0.024, aa)); pane = step(w * 0.68, x); }
  else if (t == 7u) { f = max(f, aL((fract(x / 1.5 + 0.5) - 0.5) * 1.5, 0.024, aa)); pane = floor(x / 1.5); }
  else if (t == 8u) { f = max(f, aL((fract(y / 0.27 + 0.5) - 0.5) * 0.27, 0.008, aa)); f = max(f, aL((fract(x / 0.48 + 0.5) - 0.5) * 0.48, 0.01, aa)); pane = floor(x / 0.48) + floor(y / 0.27) * 7.0; }
  else if (t == 12u) {
    // leaded lights: a diamond lattice of lead cames in a stone frame
    let q = vec2f(x + y * 0.6, x - y * 0.6) / 0.16;
    f = max(f, max(aL(fract(q.x) - 0.5, 0.06, aa * 8.0), aL(fract(q.y) - 0.5, 0.06, aa * 8.0)));
    pane = floor(q.x) + floor(q.y) * 13.0;
  }
  else if (t == 10u) {
    // caravan: rounded corners, a top opener
    let r = 0.09; let q = abs(p - vec2f(w, h) * 0.5) - (vec2f(w, h) * 0.5 - vec2f(fw + r));
    let dd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
    f = max(smoothstep(-aa, aa, dd), aL(y - h * 0.66, 0.022, aa));
    pane = step(h * 0.66, y);
  }
  return vec3f(f, pane, gap);
}
// a door leaf (x, y in the leaf, w x h): colour weight of the frame/panel relief (.x = mould shadow, .y = glass, .z = metal)
fn aDoorLeaf(t: u32, x: f32, y: f32, w: f32, h: f32, aa: f32) -> vec3f {
  let p = vec2f(x, y); var mould = 0.0; var gl = 0.0; var met = 0.0;
  if (t == 0u || t == 1u) {
    // four (six) fielded panels: their sunk edges catch shadow
    let rows = select(2.0, 3.0, t == 1u); let mg = 0.11;
    for (var i = 0; i < 3; i++) {
      if (f32(i) >= rows) { break; }
      let yb = select(0.08 + f32(i) * 0.36, 0.08 + f32(i) * 0.3, t == 1u) * h; let yt = yb + select(select(0.34, 0.4, i == 1), 0.26, t == 1u) * h;
      for (var j = 0; j < 2; j++) {
        let xb = select(mg, w * 0.5 + 0.05, j == 1); let xt = select(w * 0.5 - 0.05, w - mg, j == 1);
        let pn = aBox2(p, vec2f(xb, yb), vec2f(xt, yt), aa); let inn = aBox2(p, vec2f(xb + 0.025, yb + 0.025), vec2f(xt - 0.025, yt - 0.025), aa);
        mould = max(mould, (pn - inn));
      }
    }
    met = aBox2(p, vec2f(w * 0.5 - 0.13, h * 0.47), vec2f(w * 0.5 + 0.13, h * 0.5), aa) + aBox2(p, vec2f(w - 0.16, h * 0.44), vec2f(w - 0.1, h * 0.47), aa);
  } else if (t == 2u) {
    gl = aBox2(p, vec2f(0.12, h * 0.45), vec2f(w - 0.12, h - 0.14), aa);
    mould = aBox2(p, vec2f(0.1, h * 0.43), vec2f(w - 0.1, h - 0.12), aa) - gl;
    met = aBox2(p, vec2f(w - 0.13, h * 0.42), vec2f(w - 0.09, h * 0.5), aa);
  } else if (t == 3u) {
    for (var i = 0; i < 3; i++) { gl = max(gl, aBox2(p, vec2f(w * 0.5 - 0.07, h * (0.45 + f32(i) * 0.16)), vec2f(w * 0.5 + 0.07, h * (0.45 + f32(i) * 0.16) + 0.12), aa)); }
    met = aBox2(p, vec2f(w - 0.12, h * 0.4), vec2f(w - 0.09, h * 0.6), aa);
  } else if (t == 4u || t == 9u) {
    mould = aL((fract(x / 0.12) - 0.5) * 0.12, 0.006, aa) * 0.7;
    mould = max(mould, max(aL(y - h * 0.15, 0.06, aa), max(aL(y - h * 0.5, 0.06, aa), aL(y - h * 0.85, 0.06, aa))));
    if (t == 9u) { mould = max(mould, aL((y - h * 0.15) - (x / w) * h * 0.7, 0.05, aa) * step(h * 0.15, y) * step(y, h * 0.85)); }
    met = aBox2(p, vec2f(w - 0.2, h * 0.48), vec2f(w - 0.06, h * 0.52), aa);
  } else if (t == 5u || t == 8u) {
    let lw = select(w, w * 0.5, t == 8u); let lx = x - floor(x / lw) * lw;
    gl = aBox2(vec2f(lx, y), vec2f(0.08, select(0.12, h * 0.4, t == 8u)), vec2f(lw - 0.08, h - 0.1), aa);
    mould = select(0.0, aL(x - w * 0.5, 0.02, aa), t == 8u);
    met = aBox2(vec2f(lx, y), vec2f(lw - 0.12, h * 0.45), vec2f(lw - 0.09, h * 0.55), aa);
  } else if (t == 6u) { mould = aL((fract(x / 0.11) - 0.5) * 0.11, 0.012, aa) * 0.8; }
  else if (t == 7u) { mould = aL((fract(y / 0.08) - 0.5) * 0.08, 0.008, aa); met = 1.0; }
  return vec3f(sat(mould), sat(gl), sat(met));
}

// ---------------------------------------------------------------- the wall
fn archWall(in: V2F, N: vec3f) -> Surface {
  let R = archRec(in.mat >> 8u);
  var s = surfDefault(N);
  let T = normalize(vec3f(-N.z, 0.0, N.x) + vec3f(1e-6, 0.0, 0.0));
  let u = in.uv.x; let v = in.uv.y;
  let cb = vec4u(round(in.col * 255.0));
  let prog = cb.x; let qd = f32(cb.y) * 0.04; let ow = f32(cb.z) * 0.02; let va = cb.w;
  let top = in.ext.w * 327.67;
  let wp = in.wpos; let dist = aDist(wp);
  let near = 1.0 - smoothstep(6.0, 70.0, dist); let mid = 1.0 - smoothstep(40.0, 320.0, dist);
  let aa = max(max(fwidth(u), fwidth(v)), 0.002) * 1.2;
  let tu = dot(wp.xz, T.xz); let pw = vec2f(tu, v);
  let bay = (prog & 64u) != 0u; let gable = (prog & 128u) != 0u;
  // per opening column: its centre in the world (the same for its storeys)
  let cpos = wp.xz - T.xz * u; let ch = hash21(floor(cpos * 2.0) + f32(R.hash & 4095u) * 0.013);
  var wm = R.wallMat; var wc = R.wall;
  if (bay) { if (R.dressT == 1u) { wm = 2u; wc = R.dress; } else if (R.dressT == 2u) { wm = 0u; wc = R.dress; } }
  var M = aWallMatl(wm, wc, R, pw, v, near, mid);
  if ((R.flags & 128u) != 0u && wm == 1u) { M.a = mix(M.a, vec3f(0.78, 0.77, 0.74) * (0.9 + 0.1 * M.ao), 0.75); }   // whitewashed rubble
  let dcol = R.dress; let dT = R.dressT;
  let o = aOpening(prog, va, ow, qd, u, v, top, R);
  let isShopCol = (prog & 3u) == 2u && o.k == 0u;
  // ---- dressings: plinth, string course, rustication, eaves cornice, quoins, surrounds of the opening
  var dw = 0.0; var dc = dcol; var dbump = 0.0;
  if ((R.flags & 4u) != 0u && v < 0.3 && !bay) {
    if (wm == 0u || wm == 10u) { dw = 1.0; dc = vec3f(0.05, 0.05, 0.055); } else if (wm == 1u) { dw = 0.85; dc = dcol * 0.82; } else { dw = 0.6; dc = M.a * 0.6; }
  }
  if ((R.flags & 2u) != 0u && !bay && R.storeys > 1u && abs(v - (R.gH - 0.05)) < 0.09) { dw = 1.0; dbump = (v - (R.gH - 0.05)) * 3.0; }
  if ((R.flags & 8u) != 0u && (wm == 0u || wm == 10u) && v < R.gH - 0.15 && v > 0.3) { let g = aL(fract(v / 0.33) - 0.5, 0.48, 0.004 + fwidth(v / 0.33)); M.a *= 1.0 - 0.35 * (1.0 - g) * mid; M.gv += (1.0 - g) * 0.4 * near; }
  if ((R.flags & 16u) != 0u && !bay && top > R.gH && v > top - 0.34 && v < top - 0.02) {
    dw = 1.0; let br = step(0.72, fract(tu / 0.55)) * step(v, top - 0.12); dc = mix(dcol, dcol * 0.35, br); dbump = (v - top + 0.2) * 2.0;
  }
  if ((prog & 48u) != 0u && wm != 2u && !bay) {
    let course = floor(v / 0.3); let lng = (course - 2.0 * floor(course * 0.5)) > 0.5;
    let qw = select(0.24, 0.42, lng);
    var dq = 9.0; if ((prog & 16u) != 0u) { dq = u + qd; } if ((prog & 32u) != 0u) { dq = min(dq, qd - u); }
    if (dq < qw) { dw = 1.0; dc = select(dcol * (0.92 + 0.1 * hash11(course)), dcol, wm == 0u); let jn = aL(fract(v / 0.3) - 0.5, 0.47, 0.01); dc *= 1.0 - 0.25 * (1.0 - jn) * mid; dbump = (fract(v / 0.3) - 0.5) * 0.6 * near; }
  }
  if (o.kind != 0u && o.kind != 3u && !bay) {
    let x0 = o.x0; let x1 = o.x1; let y0 = o.y0; let y1 = o.y1;
    if (dT == 1u || dT == 6u) {
      // Bath stone: long-and-short jambs, a head (keystone on the bigger houses), the sill's band
      let crs = floor((v - y0) / 0.3); let lng = (crs - 2.0 * floor(crs * 0.5)) > 0.5; let jw = select(0.13, 0.22, lng);
      let jamb = (step(x0 - jw, u) * step(u, x0) + step(x1, u) * step(u, x1 + jw)) * step(y0 - 0.02, v) * step(v, y1);
      let head = step(x0 - 0.17, u) * step(u, x1 + 0.17) * step(y1, v) * step(v, y1 + 0.24);
      let key = step(abs(u - (x0 + x1) * 0.5), 0.11) * step(y1 - 0.08, v) * step(v, y1 + 0.3) * step(0.5, hashU(R.hash, 3u));
      let sill = step(x0 - 0.07, u) * step(u, x1 + 0.07) * step(y0 - 0.085, v) * step(v, y0);
      let w = max(max(jamb, head), max(key, sill));
      if (dT == 6u) { let lint = step(x0 - 0.13, u) * step(u, x1 + 0.13) * step(y1, v) * step(v, y1 + 0.16); if (lint > 0.5) { dw = 1.0; dc = vec3f(0.08, 0.05, 0.03) * (0.8 + 0.4 * aNz(pw * vec2f(3.0, 0.4)).r); } }
      else if (w > 0.5) { dw = 1.0; dc = dcol * (0.94 + 0.08 * hash11(crs + floor(u * 3.0))); dbump = select(0.0, 0.25, head > 0.5) * near; }
    } else if (dT == 2u || dT == 5u) {
      let ring = aBox2(vec2f(u, v), vec2f(x0 - 0.11, y0 - 0.09), vec2f(x1 + 0.11, y1 + 0.16), aa) * (1.0 - aBox2(vec2f(u, v), vec2f(x0, y0), vec2f(x1, y1), aa));
      if (ring > 0.5) { dw = 1.0; dc = dcol; dbump = select(0.0, 0.3, v > y1) * near; }
      if (dT == 5u && abs(v - y1 - 0.05) < 0.05 && u > x0 - 0.45 && u < x1 + 0.45) { dw = 1.0; dc = dcol; }
    } else if (dT == 3u) {
      if (u > x0 - 0.1 && u < x1 + 0.1 && v > y1 && v < y1 + 0.225) { dw = 1.0; let bi = floor((u - x0) / 0.075); dc = M.a * (0.85 + 0.25 * hash11(bi + 3.0)); dc = mix(dc, vec3f(0.36, 0.34, 0.3), (1.0 - aL(fract((u - x0) / 0.075) - 0.5, 0.42, 0.02)) * mid * 0.8); }
      if (u > x0 - 0.05 && u < x1 + 0.05 && v > y0 - 0.08 && v < y0) { dw = 1.0; dc = M.a * 0.8; }
    } else if (dT == 4u) {
      if (u > x0 - 0.15 && u < x1 + 0.15 && v > y1 && v < y1 + 0.15) { dw = 1.0; dc = vec3f(0.42, 0.41, 0.38) * (0.9 + 0.2 * aNz(pw * 2.0).r); }
    }
  }
  if (dw > 0.0) { M.a = mix(M.a, dc, dw); M.r = mix(M.r, 0.75, dw); M.gv = mix(M.gv, dbump, dw); M.gu *= 1.0 - dw * 0.7; M.ao = mix(M.ao, 1.0, dw * 0.5); }
  // ---- weathering: streaks under the openings, damp and splash at the foot
  if (o.kind == 1u && u > o.x0 && u < o.x1 && v < o.y0 - 0.06 && v > o.y0 - 1.6) {
    let st = smoothstep(0.5, 0.9, aNz(vec2f(tu * 3.0, v * 0.15)).g) * (1.0 - (o.y0 - v) / 1.6);
    M.a *= 1.0 - 0.22 * st * mid;
  }
  M.a *= 1.0 - 0.22 * (1.0 - smoothstep(-0.2, 0.6, v)) * (0.6 + 0.4 * aNz(pw * 0.7).b);
  if ((wm == 0u || wm == 10u || wm == 5u) && N.z < -0.3) { M.a = mix(M.a, M.a * vec3f(0.72, 0.8, 0.62), (1.0 - smoothstep(0.0, 1.4, v)) * 0.5 * aNz(pw * 0.5).g); }   // green on the north side
  // corners where two walls meet, and the foot of the wall
  M.ao *= 1.0 - 0.25 * (1.0 - smoothstep(-0.1, 0.25, v));
  // ---- inside an opening: by parallax
  var inside = false;
  if (o.kind != 0u) {
    inside = u > o.x0 && u < o.x1 && v > o.y0 && v < o.y1;
    if (inside && o.kind == 2u && R.porchD > 0.4 && (dT == 1u || dT == 2u) && R.win != 12u) {   // a round-headed porch arch
      let r = (o.x1 - o.x0) * 0.5; let cy = o.y1 - r; inside = v < cy || length(vec2f(u - (o.x0 + o.x1) * 0.5, v - cy)) < r;
    }
    if (inside && R.win == 12u && (o.kind == 1u || o.kind == 2u)) {   // a pointed (lancet) head: two arcs from the springing
      let w = o.x1 - o.x0; let ys = o.y1 - w * 0.866;
      inside = v < ys || (length(vec2f(u - o.x0, v - ys)) < w && length(vec2f(u - o.x1, v - ys)) < w);
    }
  }
  if (isShopCol && !inside) {
    // around the shop window: the stall riser (panelled), the transom rail up to the fascia
    if (v < R.riser && v > -0.05) { let pc = SHOP_BG[R.signBg % 9u]; let pn = aBox2(vec2f(fract(tu / 1.1) * 1.1, v), vec2f(0.08, 0.08), vec2f(1.02, R.riser - 0.08), aa); M.a = mix(pc * 0.7, pc, pn); M.r = 0.45; M.gu = 0.0; M.gv = (1.0 - pn) * 0.3 * near; }
    else if (v >= o.y1 && v < R.shopTop + 0.02) { M.a = SHOP_BG[R.signBg % 9u] * 0.8; M.r = 0.45; M.gu = 0.0; M.gv = 0.0; }
    else if (u < o.x0 + 0.02 || u > o.x1 - 0.02) { M.a = SHOP_BG[R.signBg % 9u] * 0.9; M.r = 0.45; }
  }
  if (!inside) {
    s.albedo = M.a; s.rough = M.r; s.ao = M.ao; s.metal = M.metal; s.normal = aBump(N, T, M.gu, M.gv);
    return s;
  }
#ifdef PASS_CUBE
  // (the cube faces: plain dark openings)
  s.albedo = vec3f(0.04, 0.045, 0.05); s.rough = 0.1; s.coat = 0.5;
  return s;
#else
  let V = normalize(aCam() - wp); let Vw = vec3f(dot(V, T), V.y, dot(V, N));
  let L = F.sunDir.xyz; let Lw = vec3f(dot(L, T), L.y, dot(L, N)); let sunOn = sat(Lw.z * 4.0);
  var depth = R.recess;
  if (o.kind == 2u) { depth = max(R.porchD, 0.1); } else if (o.kind == 3u) { depth = 0.14; } else if (o.kind == 4u) { depth = 0.1; } else if (o.kind == 7u) { depth = 0.6; }
  if (dist > 140.0) { depth *= 0.5; }
  let h = aParallax(u, v, o.x0, o.x1, o.y0, o.y1, depth, Vw);
  let sun = mix(1.0, aRecessSun(h.uh, h.vh, h.z, o.x0, o.x1, o.y0, o.y1, Lw), sunOn);
  let shadeK = mix(0.3, 1.0, sun);
  if (h.face != 0u) {
    // a reveal: stone, render or brick as the wall; the sill's top; a porch's tiled dado, floor and ceiling
    var rn = T; if (h.face == 2u) { rn = -T; } else if (h.face == 3u) { rn = vec3f(0.0, 1.0, 0.0); } else if (h.face == 4u) { rn = vec3f(0.0, -1.0, 0.0); }
    var rc = select(R.wall, R.dress, dT == 1u || dT == 2u || bay);
    if (wm == 3u || wm == 4u) { rc = R.wall * 0.9; }
    let rp = select(vec2f(h.uh, h.z), vec2f(h.z, h.vh), h.face <= 2u);
    rc *= 0.88 + 0.2 * aNz(rp * 2.3 + vec2f(tu * 0.1, 0.0)).r;
    if (o.kind == 1u && h.face == 3u) { rc = select(vec3f(0.46, 0.45, 0.42), R.dress, dT == 1u || dT == 2u); }
    if ((o.kind == 2u || o.kind == 7u) && depth > 0.35) {
      if (h.face == 3u) {   // encaustic tiles: black, red and cream
        let tp = vec2f(h.uh, h.z) / 0.15; let ti = floor(tp); let ck = (i32(ti.x) + i32(ti.y)) & 1;
        rc = select(vec3f(0.28, 0.06, 0.04), vec3f(0.02, 0.02, 0.025), ck == 1); if (fract(hash21(ti) * 3.7) > 0.8) { rc = vec3f(0.62, 0.56, 0.42); }
      } else if (h.face == 4u) { rc = vec3f(0.74, 0.73, 0.69); }
      else { rc = select(vec3f(0.72, 0.68, 0.58), mix(vec3f(0.1, 0.25, 0.2), vec3f(0.5, 0.15, 0.1), hashU(R.hash, 5u)) * (0.8 + 0.4 * step(0.5, fract(h.z / 0.1))), h.vh < 1.05); }
    }
    s.albedo = rc * shadeK; s.normal = rn; s.rough = 0.75; s.ao = 0.7 - 0.25 * sat(h.z / max(depth, 0.05));
    return s;
  }
  let x = h.uh - o.x0; let y = h.vh - o.y0; let w = o.x1 - o.x0; let ht = o.y1 - o.y0;
  let aaw = aa * 1.2;
  // ---- doors (front doors, garage and barn doors)
  if (o.kind == 2u || o.kind == 4u) {
    var dt = R.doorT; var dcl = R.door;
    if (o.kind == 4u) { dt = select(6u, R.doorT, R.doorT >= 6u); dcl = select(R.trim, R.door, R.doorT >= 6u); if (R.doorT == 9u) { dcl = vec3f(0.14, 0.1, 0.06); } }
    let fr = 0.05; let fan = select(0.0, R.fanH, o.kind == 2u);
    let leafH = ht - fan;
    var a = R.trim; var rgh = 0.45; var gls = 0.0; var nrm = N;
    if (x > fr && x < w - fr && y < leafH - select(0.0, 0.03, fan > 0.0)) {
      let lf = aDoorLeaf(dt, x - fr, y, w - 2.0 * fr, leafH, aaw);
      a = dcl * (1.0 - 0.45 * lf.x); rgh = 0.35;
      if (lf.z > 0.5) { a = select(vec3f(0.45, 0.33, 0.12), vec3f(0.6, 0.6, 0.58), dt == 2u || dt == 3u || dt == 5u); rgh = 0.25; }
      gls = lf.y;
      if (dt >= 6u) { rgh = 0.5; }
    } else if (fan > 0.0 && y > leafH + 0.03 && x > fr && x < w - fr && y < ht - fr) {
      gls = 1.0 - max(aL(x - w * 0.5, 0.012, aaw), select(0.0, aL(x - w * 0.25, 0.01, aaw) + aL(x - w * 0.75, 0.01, aaw), w > 1.1));
    }
    if (gls > 0.0) {
      let hs = ch; let cur = aRoom(h.uh, h.vh, o.x0, o.x1, 0.0, R.gH, depth + 0.05, Vw, hs, false) * 0.6;
      a = mix(a, cur * select(1.0, 1.6, dt == 2u), gls); rgh = mix(rgh, 0.05, gls); s.coat = gls * 0.7;
    }
    s.albedo = a * shadeK; s.rough = rgh; s.normal = nrm; s.ao = 0.9;
    return s;
  }
  // ---- shop windows and shop doors
  if (o.kind == 3u || o.kind == 7u) {
    var mull = 0.0;
    let gsty = R.glazing & 3u;
    if (o.kind == 3u) {
      if (gsty == 1u) { mull = aL((fract(x / 1.3 + 0.5) - 0.5) * 1.3, 0.025, aaw); }
      if (gsty >= 2u) { mull = max(mull, aL(y - (ht - 0.45), 0.03, aaw)); if (y > ht - 0.45) { mull = max(mull, aL((fract(x / 0.55 + 0.5) - 0.5) * 0.55, 0.015, aaw)); } }
      if (gsty == 3u) { mull = max(mull, aL((fract(x / 0.75 + 0.5) - 0.5) * 0.75, 0.018, aaw)); }
      mull = max(mull, 1.0 - aBox2(vec2f(x, y), vec2f(0.035), vec2f(w - 0.035, ht - 0.035), aaw));
    } else {
      mull = 1.0 - aBox2(vec2f(x, y), vec2f(0.06), vec2f(w - 0.06, ht - 0.06), aaw);
      mull = max(mull, aL(y - 1.0, 0.03, aaw));
    }
    let fc = select(vec3f(0.1, 0.1, 0.11), SHOP_BG[R.signBg % 9u], (R.glazing & 4u) != 0u);
    // the display: lit goods behind the glass
    var ins = aRoom(h.uh, h.vh, o.x0 - 1.0, o.x1 + 1.0, -0.2 + select(R.riser, 0.0, o.kind == 7u), R.gH, depth + 0.03, Vw, ch, true);
    let disp = step(y, 0.5) * select(1.0, 0.0, o.kind == 7u);
    ins = mix(ins, mix(vec3f(0.3), hash33(vec3f(floor(h.uh * 6.0), ch, 1.0)), 0.4) * 0.16, disp * 0.7);
    s.albedo = mix(ins * 0.9, fc, mull) * mix(1.0, shadeK, mull);
    s.rough = mix(0.04, 0.4, mull); s.coat = (1.0 - mull) * 0.75; s.emissive = (1.0 - mull) * 0.012 * select(0.0, 1.0, (R.flags & 64u) != 0u);
    s.normal = N; s.ao = 1.0;
    return s;
  }
  // ---- windows: frame, sashes and bars; reflecting glass; curtains and the room behind
  let wt = R.win;
  let jf = aWinFrame(select(wt, 5u, o.kind == 5u && wt <= 3u), x, y, w, ht, ch, aaw);
  let frame = jf.x;
  let tc = R.trim * (0.92 + 0.08 * hash11(ch * 9.0));
  var glassC = vec3f(0.0);
  {
    let zc = depth + 0.06;
    let vn = max(Vw.z, 0.04); let cu = u - Vw.x / vn * zc - o.x0; let cv = v - Vw.y / vn * zc - o.y0;
    var fl = o.sb; var ce = o.sb + select(R.uH, R.gH, o.k == 0u) - 0.08;
    if (o.kind == 6u) { fl = o.y0 - 0.9; ce = o.y1 + 0.4; }
    let room = aRoom(u, v, o.x0, o.x1, fl, ce, zc + 0.05, Vw, ch, false);
    let cur = aCurtains(cu, cv, w, ht, select(ch, 0.05, R.win == 10u && ch < 0.3), R);
    glassC = mix(room, cur.rgb * 0.38, cur.a);
    if (jf.z > 0.5) { glassC = room * 0.7; }   // the gap under a raised sash
    if ((va & 3u) == 1u) { glassC = vec3f(0.5, 0.52, 0.52) * (0.85 + 0.15 * aNz(vec2f(x, y) * 9.0).r) * 0.5; }   // obscured glass
    if (wt == 12u) { glassC = vec3f(0.03, 0.035, 0.03) * (0.7 + 0.6 * hash11(jf.y * 0.37 + ch)); }                  // old leaded glass
  }
  let gl = (1.0 - frame);
  s.albedo = mix(glassC * 0.85, tc * shadeK, frame);
  s.rough = mix(0.035, 0.42, frame); s.coat = gl * select(0.75, 0.0, jf.z > 0.5); s.metal = 0.0;
  // old crown glass in the sashes: each pane tilted a little, rippling the reflections
  let tilt = (hash22(vec2f(ch * 31.0, jf.y)) - 0.5) * select(0.012, 0.035, R.win <= 3u);
  s.normal = normalize(N + (T * tilt.x + vec3f(0.0, tilt.y, 0.0)) * gl);
  s.ao = 1.0 - 0.2 * frame;
  return s;
#endif
}

// ---------------------------------------------------------------- roofs: Welsh slate, Bridgwater double Roman and plain
// clay tiles, concrete interlocking tiles, felt, profiled metal, caravan roofs, pantiles, lead
fn archRoof(in: V2F, N: vec3f) -> Surface {
  let R = archRec(in.mat >> 8u);
  var s = surfDefault(N);
  var cov = u32(round(in.col.r * 255.0)); if (cov == 255u) { cov = R.roofCov; }
  let u = in.uv.x; let v = in.uv.y; let dist = aDist(in.wpos);
  let mid = 1.0 - smoothstep(30.0, 280.0, dist); let near = 1.0 - smoothstep(5.0, 60.0, dist);
  let seed = f32(R.hash & 1023u) * 0.71;
  var g = vec3f(N.x * N.y, -1.0 + N.y * N.y, N.z * N.y); if (dot(g, g) < 1e-6) { g = vec3f(0.0, 0.0, -1.0); }
  let Bd = normalize(g); let Tr = normalize(cross(N, Bd));
  var a = R.roof; var rough = 0.7; var gu = 0.0; var gv = 0.0; var ao = 1.0; var metal = 0.0;
  let n1 = aNz(in.wpos.xz * 0.21 + seed); let n2 = aNz(in.wpos.xz * 1.3 + seed * 2.0);
  if (cov == 0u || cov == 1u || cov == 2u || cov == 3u || cov == 7u) {
    var gauge = 0.21; var tw = 0.28;
    if (cov == 1u) { gauge = 0.33; tw = 0.335; } else if (cov == 2u) { gauge = 0.1; tw = 0.165; } else if (cov == 3u) { gauge = 0.343; tw = 0.3; } else if (cov == 7u) { gauge = 0.29; tw = 0.25; }
    let row = floor(v / gauge); let fv = fract(v / gauge);
    let su = u / tw + select(0.5 * (row - 2.0 * floor(row * 0.5)), 0.0, cov == 1u || cov == 3u || cov == 7u); let ti = floor(su); let fu = fract(su);
    let ht = hash21(vec2f(ti, row) + seed);
    var tc = R.roof * (0.84 + 0.3 * ht) * (0.86 + 0.28 * n1.r);
    if (cov == 0u) { tc = mix(tc, tc * vec3f(1.18, 1.16, 1.24), step(0.93, ht)); }                                  // a few replaced slates
    if (cov == 1u || cov == 2u || cov == 7u) { tc = mix(tc, tc * vec3f(0.78, 0.85, 0.8), smoothstep(0.55, 0.9, n2.g) * 0.6); }
    // the lower edge of each course lies on the one below: a shadow under it, a lit lip
    let lip = (1.0 - smoothstep(0.0, 0.16 + fwidth(v / gauge) * 2.0, fv)) * mid;
    tc *= 1.0 - 0.5 * lip; ao = 1.0 - 0.4 * lip;
    if (cov == 0u || cov == 2u) {
      let jg = (1.0 - smoothstep(0.0, 0.05 + fwidth(su) * 2.0, min(fu, 1.0 - fu))) * mid; tc *= 1.0 - 0.45 * jg;
      gv = (fv - 0.5) * 0.3 * mid; gu = (ht - 0.5) * 0.12 * near;
    } else {
      // rolls across the tile: double Roman (a big roll and a small one), concrete (two low rolls), pantile (an S)
      var prof = 0.0;
      if (cov == 1u) { prof = cos(fu * 6.2832 * 2.0) * 0.5 + 0.5 * cos(fu * 6.2832); }
      else if (cov == 3u) { prof = cos(fu * 6.2832 * 2.0) * 0.6; }
      else { prof = sin(fu * 6.2832); }
      let dp = -sin(fu * 6.2832 * select(1.0, 2.0, cov != 7u)) * select(0.9, 0.7, cov == 3u);
      gu = dp * 0.55 * near + (ht - 0.5) * 0.06; gv = (fv - 0.5) * 0.25 * mid;
      tc *= 0.9 + 0.12 * prof * mid; ao *= 0.92 + 0.08 * prof;
    }
    // lichen and moss
    let lich = smoothstep(0.72, 0.9, aNz(in.wpos.xz * 2.7 + seed).b) * select(0.3, 0.75, cov != 0u);
    tc = mix(tc, vec3f(0.42, 0.42, 0.3), lich * 0.6);
    let moss = smoothstep(0.62, 0.85, n1.g * 0.6 + n2.b * 0.45);
    tc = mix(tc, vec3f(0.07, 0.085, 0.035) * (0.7 + 0.5 * n2.r), moss * select(0.25, 0.5, cov != 0u));
    a = tc; rough = select(0.78, 0.6, cov == 0u) + 0.12 * moss;
  } else if (cov == 4u) {
    a = R.roof * (0.75 + 0.45 * n1.r) * (0.85 + 0.25 * n2.b); a = mix(a, a * 0.6, smoothstep(0.6, 0.8, n1.g) * 0.5); rough = 0.88;
    gu = (n2.r - 0.5) * 0.2 * near; gv = (n2.g - 0.5) * 0.2 * near;
  } else if (cov == 5u) {
    let rib = fract(u / 0.2); a = R.roof * (0.86 + 0.14 * n1.r); a = mix(a, a * vec3f(0.6, 0.5, 0.42), smoothstep(0.65, 0.9, n2.g) * 0.4);
    gu = (smoothstep(0.0, 0.08, rib) * -1.0 + smoothstep(0.3, 0.38, rib)) * 0.8 * mid; rough = 0.5; metal = 0.3;
  } else if (cov == 6u) {
    let sm = aL(fract(u / 0.62) - 0.5, 0.48, 0.003 + fwidth(u / 0.62)); a = R.roof * (0.92 + 0.08 * n1.r) * (0.85 + 0.15 * sm);
    a = mix(a, a * vec3f(0.6, 0.66, 0.5), smoothstep(0.6, 0.9, n2.g) * 0.35); rough = 0.35; metal = 0.25;
  } else if (cov == 9u) {
    let roll = fract(u / 0.6); a = vec3f(0.19, 0.21, 0.22) * (0.85 + 0.2 * n1.r); gu = select(0.0, (roll - 0.97) * 12.0, roll > 0.94) * mid; rough = 0.65; metal = 0.2;
  } else if (cov == 8u) {
    a = vec3f(0.5, 0.54, 0.56); rough = 0.12; s.coat = 0.6;
  }
  s.albedo = a; s.rough = rough; s.ao = ao; s.metal = metal;
  s.normal = normalize(N + Tr * gu - Bd * gv);
  return s;
}
// ridge and hip tiles (detail): along the local x, 450 mm tiles bedded in mortar
fn archRidge(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let x = in.ext.x; let f = fract(x / 0.45); let ti = floor(x / 0.45);
  let n = aNz(in.wpos.xz * 1.7);
  s.albedo = in.col.rgb * (0.85 + 0.25 * hash11(ti * 7.1 + in.wpos.y)) * (0.88 + 0.2 * n.r);
  s.albedo *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.04, min(f, 1.0 - f)));
  s.rough = 0.7;
  return s;
}

// ---------------------------------------------------------------- solids, paint and the rest
fn aSolidUV(in: V2F) -> vec2f {
#ifdef ARCH_PROPS
  let ax = u32(in.ext.w + 0.5); let lp = in.ext.xyz;
  if (ax == 0u) { return vec2f(lp.z, lp.y); } if (ax == 1u) { return vec2f(lp.x, lp.z); } return vec2f(lp.x, lp.y);
#else
  return in.uv;
#endif
}
fn archSolid(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let code = u32(round(in.col.a * 15.0)); let c = in.col.rgb; let p = aSolidUV(in) + in.wpos.xz * 0.013;
  let dist = aDist(in.wpos); let near = 1.0 - smoothstep(4.0, 50.0, dist); let mid = 1.0 - smoothstep(30.0, 200.0, dist);
  var m = amDef(c);
  if (code == 0u) { m = aAshlar(c, p, near, mid, 3.0); }
  else if (code == 2u) { m = aBrick(c, p, near, mid, 5.0, 0.0); }
  else if (code == 3u) { m = aRubble(c, p, near, mid, 7.0); }
  else if (code == 4u) { m = aRender(c, p, near, 0.2); }
  else if (code == 5u) { let n = aNz(p * 2.3); m.a = c * (0.82 + 0.3 * n.r); m.r = 0.9; m.gu = (n.g - 0.5) * 0.3 * near; }
  else if (code == 6u) { let n = aNz(p * 1.3); m.a = c * (0.85 + 0.25 * n.r); m.r = 0.85; }
  else if (code == 8u) { let n = aNz(vec2f(p.x * 0.3, p.y * 6.0)); m.a = c * (0.75 + 0.4 * n.r); m.r = 0.75; }
  else { let n = aNz(p * 0.9); m.a = c * (0.92 + 0.1 * n.r); m.r = 0.55; }
  s.albedo = m.a; s.rough = m.r; s.ao = m.ao;
  let T = normalize(cross(N, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-5, 0.0, 0.0));
  s.normal = aBump(N, T, m.gu, m.gv);
  return s;
}
fn archPaint(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let p = aSolidUV(in) + in.wpos.xz * 0.05; let n = aNz(p * 0.7);
  s.albedo = in.col.rgb * (0.93 + 0.1 * n.r);
  s.albedo *= 1.0 - 0.15 * smoothstep(0.6, 0.9, aNz(p * 0.2 + 3.0).g);   // dirt
  s.rough = mix(0.75, 0.22, sat(in.col.a));
  return s;
}
fn archSign(in: V2F, N: vec3f) -> Surface {
  let R = archRec(in.mat >> 8u);
  var s = surfDefault(N);
  let W = in.col.r * 255.0 * 0.04; let H = in.col.g * 255.0 * 0.02;
  let bg = SHOP_BG[R.signBg % 9u];
  var fg = vec3f(0.82, 0.8, 0.72); if (R.signFg == 1u) { fg = vec3f(0.62, 0.45, 0.13); }
  if (lum(bg) > 0.4) { fg = select(vec3f(0.04, 0.05, 0.1), vec3f(0.3, 0.04, 0.03), R.signFg == 1u); }
  let rh = min((W - 0.25) / 16.0, H * 0.95); let rw = rh * 16.0;
  let au = 0.5 - (in.uv.x - W * 0.5) / rw; let av = 0.5 - (in.uv.y - H * 0.5) / rh;   // (u runs right to left seen from outside)
  var t = 0.0;
  if (au > 0.0 && au < 1.0 && av > 0.0 && av < 1.0 && R.sign < 255u) {
    t = textureSampleBias(tSign, sLin, vec2f(au, (f32(R.sign) + av) / ARCH_SIGN_ROWS), -0.5).a;
  }
  // a fine line inset round the board, a shadow under the letters
  let bx = min(min(in.uv.x, W - in.uv.x), min(in.uv.y, H - in.uv.y));
  let line = select(0.0, aL(bx - 0.06, 0.012, 0.004 + fwidth(in.uv.x)), R.signStyle == 1u || R.signStyle == 3u);
  var a = mix(bg, fg, line);
  if (R.signStyle == 2u && t < 0.5) { let t2 = textureSampleBias(tSign, sLin, vec2f(au + 0.002, (f32(R.sign) + av - 0.03) / ARCH_SIGN_ROWS), 0.5).a; a = mix(a, a * 0.4, t2 * 0.7); }
  a = mix(a, fg, sat(t * 1.4));
  let n = aNz(in.uv * 3.0);
  s.albedo = a * (0.94 + 0.08 * n.r); s.rough = mix(0.4, 0.3, t);
  return s;
}
fn archAwning(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let st = step(0.5, fract(in.uv.x / 0.5)); let n = aNz(in.uv * vec2f(0.5, 2.0));
  s.albedo = mix(vec3f(0.72, 0.7, 0.64), in.col.rgb, st) * (0.88 + 0.16 * n.r);
  s.albedo *= 1.0 - 0.2 * smoothstep(0.55, 0.85, aNz(in.uv * 0.3 + 5.0).g);
  s.rough = 0.85; s.sss = 0.15;
  return s;
}
fn archHedge(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let p = in.wpos; let k = in.col.r;
  let n1 = textureSample(tNoise3, sLin, p * 0.9 + k).r; let n2 = textureSample(tNoise3, sLin, p * 3.7).g; let n3 = aNz(p.xz * 6.0 + p.y * 3.0);
  s.albedo = mix(vec3f(0.03, 0.065, 0.02), vec3f(0.07, 0.11, 0.03), n1) * (0.6 + 0.8 * n2) * (0.85 + 0.3 * n3.b);
  if (N.y > 0.5) { s.albedo *= vec3f(1.15, 1.2, 1.0); }
  s.rough = 0.85; s.sss = 0.35; s.ao = 0.6 + 0.4 * n2;
  let T = normalize(cross(N, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-5, 0.0, 0.0));
  s.normal = aBump(N, T, (n2 - 0.5) * 1.6, (n3.r - 0.5) * 1.6);
  return s;
}
fn archPot(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let t = in.uv.y; let n = aNz(in.wpos.xz * 4.0 + in.ext.y);
  s.albedo = in.col.rgb * (0.85 + 0.2 * n.r) * (1.0 - 0.6 * smoothstep(0.6, 1.0, t) * in.col.a);   // soot towards the top
  if (N.y > 0.6 && t > 0.75) { s.albedo = vec3f(0.015); }   // the flue
  s.rough = 0.85;
  return s;
}
fn archPaving(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let code = u32(round(in.col.a * 15.0)); let p = aSolidUV(in); let n = aNz(in.wpos.xz * 0.9);
  if (code == 11u) {   // Victorian path tiles: black, red and cream in a pattern, a border
    let q = in.wpos.xz / 0.1; let ti = floor(q); let ck = (i32(ti.x) + i32(ti.y)) & 1;
    var c = select(vec3f(0.28, 0.06, 0.04), vec3f(0.62, 0.56, 0.42), ck == 1); if (hash21(ti) > 0.85) { c = vec3f(0.02); }
    let j = 1.0 - aL(fract(q.x) - 0.5, 0.45, 0.02) * aL(fract(q.y) - 0.5, 0.45, 0.02);
    s.albedo = mix(c, vec3f(0.2), j * 0.5) * (0.85 + 0.2 * n.r); s.rough = 0.5;
  } else if (code == 12u) {
    let b = fract(p.x / 0.14); s.albedo = in.col.rgb * (0.75 + 0.4 * hash11(floor(p.x / 0.14))) * (0.8 + 0.3 * n.r) * (1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.06, min(b, 1.0 - b)))); s.rough = 0.8;
  } else {
    let g = in.wpos.xz / 0.6; let f = abs(fract(g) - 0.5); let j = 1.0 - smoothstep(0.46, 0.49, max(f.x, f.y));
    s.albedo = in.col.rgb * (0.85 + 0.2 * hash21(floor(g))) * (0.85 + 0.25 * n.r) * (0.75 + 0.25 * j); s.rough = 0.82;
  }
  return s;
}
// the demo street's ground
fn archGround(in: V2F, N: vec3f, id: u32) -> Surface {
  var s = surfDefault(N);
  let xz = in.wpos.xz; let dist = aDist(in.wpos); let near = 1.0 - smoothstep(4.0, 40.0, dist);
  let n1 = aNz(xz * 0.05); let n2 = aNz(xz * 0.7); let n3 = aNz(xz * 4.1);
  if (id == 60u) {
    s.albedo = vec3f(0.07, 0.068, 0.066) * (0.8 + 0.4 * n1.r) * (0.85 + 0.3 * n2.r) * (0.9 + 0.2 * n3.g); s.rough = 0.88;
    s.normal = bumpXZ(N, (n3.rg - 0.5) * 0.25 * near);
  } else if (id == 61u) {
    let g = vec2f(in.uv.x / 0.9, in.uv.y / 0.6); let f = abs(fract(g) - 0.5); let j = 1.0 - smoothstep(0.46, 0.49, max(f.x, f.y));
    s.albedo = vec3f(0.29, 0.28, 0.26) * (0.86 + 0.24 * hash21(floor(g))) * (0.85 + 0.25 * n2.r) * (0.7 + 0.3 * j); s.rough = 0.8;
  } else if (id == 62u) {
    s.albedo = vec3f(0.27, 0.265, 0.26) * (0.8 + 0.3 * n2.r) * (0.75 + 0.25 * aL(fract(in.uv.x / 0.915) - 0.5, 0.48, 0.01)); s.rough = 0.75;
  } else if (id == 63u) {
    s.albedo = COL_GRASS * (0.75 + 0.5 * n2.r) * (0.85 + 0.3 * n3.g); s.rough = 0.9; s.sss = 0.1; s.normal = bumpXZ(N, (n3.rg - 0.5) * 0.5 * near);
  } else if (id == 64u) {
    s.albedo = mix(COL_DIRT * 0.8, vec3f(0.05, 0.09, 0.03), smoothstep(0.4, 0.7, n2.g)) * (0.8 + 0.4 * n3.r); s.rough = 0.95; s.normal = bumpXZ(N, (n3.rg - 0.5) * 0.6 * near);
  } else if (id == 66u) {
    s.albedo = vec3f(0.3, 0.27, 0.22) * (0.65 + 0.6 * n3.b) * (0.85 + 0.3 * n1.r); s.rough = 0.92; s.normal = bumpXZ(N, (n3.rg - 0.5) * 0.7 * near);
  } else if (id == 68u) {
    s.albedo = in.col.rgb * (0.85 + 0.15 * n3.r); s.rough = 0.6;
  }
  return s;
}
#ifdef ARCH_RAIL
// railings: cast iron with spearheads, pickets, glass panels, flats' bars, timber rails, ornate balconies
fn aRail(in: V2F) -> f32 {
  let code = u32(round(in.col.a * 15.0)); let x = in.ext.x; let y = in.ext.y;   // (metres along and up)
  let aa = max(fwidth(x), 0.002);
  var c = 0.0;
  if (code == 0u || code == 5u) {
    let bx = (fract(x / 0.11) - 0.5) * 0.11;
    let bar = aL(bx, 0.009, aa);
    c = max(c, bar * step(y, 0.84));
    c = max(c, aL(y - 0.78, 0.018, aa) + aL(y - 0.1, 0.016, aa));
    let tip = step(0.8, y) * step(abs(bx), (0.92 - y) * 0.16) * step(y, 0.92);
    c = max(c, tip);
    if (code == 5u) { let cy = y - 0.66; let r = length(vec2f((fract(x / 0.11 + 0.5) - 0.5) * 0.11, cy)); c = max(c, aL(r - 0.04, 0.006, aa) * step(abs(cy), 0.06)); }
  } else if (code == 1u) {
    let bx = (fract(x / 0.13) - 0.5) * 0.13; c = max(aL(bx, 0.037, aa) * step(y, 0.85 - abs(bx) * 2.0), aL(y - 0.25, 0.025, aa) + aL(y - 0.65, 0.025, aa));
  } else if (code == 2u) {
    let post = aL((fract(x / 1.2 + 0.5) - 0.5) * 1.2, 0.025, aa);
    let glass = step(0.06, y) * step(y, 0.92) * step(0.62, ign(in.pos.xy, F.misc.y));
    c = max(max(post, aL(y - 0.97, 0.03, aa)), glass);
  } else if (code == 3u) {
    c = max(aL((fract(x / 0.1) - 0.5) * 0.1, 0.01, aa), aL(y - 1.0, 0.03, aa) + aL(y - 0.06, 0.02, aa));
  } else {
    c = max(aL((fract(x / 1.0 + 0.5) - 0.5) * 1.0, 0.035, aa), aL(y - 0.82, 0.035, aa) + aL(y - 0.45, 0.025, aa) + aL(y - 0.1, 0.025, aa));
  }
  return sat(c);
}
fn surfAlpha(in: V2F) -> f32 { return aRail(in); }
#endif

fn surf(in: V2F, ff: bool) -> Surface {
  var N = normalize(in.nrm); if (!ff) { N = -N; }
  let id = matId(in.mat);
#ifdef ARCH_RAIL
  if (aRail(in) < 0.5) { discard; }
  var sr = surfDefault(N); sr.albedo = in.col.rgb; sr.rough = select(0.35, 0.6, u32(round(in.col.a * 15.0)) == 4u || u32(round(in.col.a * 15.0)) == 1u); sr.metal = select(0.0, 0.3, u32(round(in.col.a * 15.0)) == 0u);
  return sr;
#else
  if (id == 40u) { return archWall(in, N); }
  if (id == 41u) { return archRoof(in, N); }
  if (id == 42u) { return archRidge(in, N); }
  if (id == 43u) { return archSolid(in, N); }
  if (id == 44u) { return archPaint(in, N); }
  if (id == 46u) { return archSign(in, N); }
  if (id == 47u) { return archAwning(in, N); }
  if (id == 48u) { return archHedge(in, N); }
  if (id == 49u) { return archPot(in, N); }
  if (id == 53u) { return archPaving(in, N); }
  if (id >= 60u) { return archGround(in, N, id); }
  var s = surfDefault(N);
  if (id == 45u) { s.albedo = vec3f(0.35, 0.4, 0.42); s.rough = 0.08; s.coat = 0.8; }
  else if (id == 50u) { let R = archRec(in.mat >> 8u); let n = aNz(in.wpos.xz * 0.3); s.albedo = R.roof * (0.7 + 0.5 * n.r) * (0.85 + 0.3 * aNz(in.wpos.xz * 2.5).b); s.rough = 0.88; }
  else if (id == 51u) { s.albedo = vec3f(0.19, 0.21, 0.22) * (0.85 + 0.2 * aNz(in.wpos.xz).r); s.rough = 0.6; s.metal = 0.2; }
  else if (id == 54u) { s.albedo = vec3f(0.015); s.rough = 0.9; }
  else if (id == 55u) { s.albedo = in.col.rgb; s.rough = 0.35; s.metal = 0.7; }
  return s;
#endif
}
