// Weston-super-Mare: roads, pavements, buildings, piers and the circuit's dressing (34_wsm_world.js). Material by id:
//  1 road (uv = along, across; a = class, b = markings: 1 centre line, 2 lane lines, 4 double yellow lines, 8 white edge
//    lines, 16 woodland lane (leaf litter, mossy edges), 32 steps (on 4: footway), 64 block paving; c = half width dm;
//    colour r = markings on, away from junctions)   2 pavement slabs   3 kerb stone / skirt   4 footway   5 gravel track
//  6 pier deck (planks)   7 circuit kerb (red and white)   8 start line (chequers)
//  10 wall (uv = along the wall, height above the base; a = style, b = storey height dm + 64 x wall material
//     (0 render, 1 brick, 2 stone, 3 cladding); c = wall length m; colour = wall colour, a = per-building hash;
//     vertex weight = eave height / 64)   11 pitched roof (uv = along the ridge, down the slope; a = 0 slate, 1 clay tile)
//  12 flat roof   13 painted metal (a = roughness)   14 banner (atlas)   15 stone/concrete
#include mesh_vert
#include palette
@group(3) @binding(0) var tAtlas: texture_2d<f32>;
fn tDist(wp: vec3f) -> f32 {
#ifdef PASS_CUBE
  return distance(wp, P.camPos.xyz);
#else
  return distance(wp, F.camPos.xyz);
#endif
}
fn aaL(x: f32, w: f32, aa: f32) -> f32 { return 1.0 - smoothstep(w - aa, w + aa, abs(x)); }
// normal of a vertical face perturbed along the face (gu) and upwards (gv)
fn wallBump(N: vec3f, gu: f32, gv: f32) -> vec3f { let t = normalize(vec3f(-N.z, 0.0, N.x) + vec3f(1e-5, 0.0, 0.0)); return normalize(N + t * gu + vec3f(0.0, gv, 0.0)); }

// ---------------------------------------------------------------- ground level
fn tarmac(in: V2F, N: vec3f, dist: f32) -> Surface {
  var s = surfDefault(N);
  let xz = in.wpos.xz; let near = 1.0 - smoothstep(10.0, 70.0, dist); let near2 = 1.0 - smoothstep(3.0, 20.0, dist);
  let n1 = textureSample(tNoise, sLin, xz * 0.031);
  let n2 = textureSample(tNoise, sLin, vec2f(xz.x * 0.8 - xz.y * 0.6, xz.x * 0.6 + xz.y * 0.8) * 0.29);
  let n3 = textureSample(tNoise, sLin, xz * 1.37 + 0.3);
  let n4 = textureSample(tNoise, sLin, vec2f(xz.x * 0.6 + xz.y * 0.8, -xz.x * 0.8 + xz.y * 0.6) * 4.3);
  // British tarmac: mid grey, with patches of newer, darker resurfacing and pale worn stretches
  var a = vec3f(0.092, 0.09, 0.087) * (0.78 + 0.44 * n1.r) * (0.84 + 0.3 * n2.r);
  let patchM = smoothstep(0.6, 0.66, n1.g * 0.7 + n2.b * 0.4);
  a = mix(a, vec3f(0.052, 0.052, 0.054), patchM * 0.8);
  a *= 1.0 + (n3.r - 0.5) * 0.12 + (n4.g - 0.5) * 0.08 * near2;   // (fbm channels: the cellular one read as cobbles)
  s.albedo = a; s.rough = 0.86 - 0.08 * patchM;
  let g = (n3.rg - 0.5) * 0.1 * near + (n4.rg - 0.5) * 0.2 * near2;
  s.normal = bumpXZ(N, g);
  return s;
}
fn roadSurf(in: V2F, N: vec3f) -> Surface {
  let dist = tDist(in.wpos);
  var s = tarmac(in, N, dist);
  let u = in.uv.x; let d = in.uv.y; let hw = matC(in.mat) * 25.5; let fl = (in.mat >> 16u) & 255u;
  let aa = max(fwidth(d), 0.002) * 1.2; let aaU = max(fwidth(u), 0.002) * 1.2;
  let on = in.col.r;
  let chip = 0.75 + 0.25 * smoothstep(0.3, 0.6, textureSample(tNoise, sLin, in.wpos.xz * 2.1).b);
  var m = 0.0; var y = 0.0;
  if ((fl & 1u) != 0u) { m = max(m, aaL(d, 0.06, aa) * step(fract(u / 9.0), 0.36)); }     // centre line: 3 m dashes, 6 m gaps
  if ((fl & 2u) != 0u) {                                                                     // lane lines of a two-lane one-way road
    m = max(m, aaL(d, 0.05, aa) * step(fract(u / 6.0), 0.33));
  }
  if ((fl & 4u) != 0u) {                                                                     // double yellow lines along both kerbs
    let e = hw - abs(d);
    y = max(aaL(e - 0.32, 0.04, aa), aaL(e - 0.47, 0.04, aa));
  }
  if ((fl & 8u) != 0u) { m = max(m, aaL(hw - abs(d) - 0.28, 0.05, aa)); }                    // solid white edge lines
  m *= select(on, 1.0, (fl & 8u) != 0u) * chip; y *= chip;
  if ((fl & 16u) != 0u) {
    // a lane through the woods: old patched tarmac, crumbling and mossy at the edges, fallen leaves gathered on both sides
    let xz = in.wpos.xz; let e = hw - abs(d);
    let ln = textureSample(tNoise, sLin, xz * 0.9 + 0.3); let lf = textureSample(tNoise, sLin, xz * 3.7 + 0.71);
    let edgeW = 1.0 - smoothstep(0.0, 0.55 + 0.4 * ln.r, e);
    s.albedo = mix(s.albedo, vec3f(0.06, 0.07, 0.035) * (0.7 + 0.6 * ln.g), edgeW * 0.75);              // moss and earth
    let leaves = smoothstep(0.62, 0.74, lf.b) * (0.06 + 0.94 * (1.0 - smoothstep(0.35, 1.3, e)));
    let lc = mix(vec3f(0.22, 0.12, 0.04), vec3f(0.3, 0.2, 0.06), lf.r) * (0.7 + 0.5 * lf.g);
    s.albedo = mix(s.albedo, lc, leaves * 0.85); s.rough = mix(s.rough, 0.92, max(leaves, edgeW));
    s.albedo *= 0.88 + 0.12 * ln.r;                                                                  // damp under the canopy
  }
  if ((fl & 64u) != 0u) {
    // block paving (drives, car park aisles, setts): 200 x 100 mm red-brown blocks in stretcher bond, sanded joints
    let bp = in.wpos.xz * vec2f(5.0, 10.0); let row = floor(bp.y); let bu = bp.x + 0.5 * (row % 2.0);
    let fu = abs(fract(bu) - 0.5); let fv = abs(fract(bp.y) - 0.5);
    let blk = 1.0 - smoothstep(0.40, 0.47, max(fu, fv));
    let hb = hash21(vec2f(floor(bu), row));
    s.albedo = mix(vec3f(0.17, 0.15, 0.12), mix(vec3f(0.3, 0.15, 0.1), vec3f(0.24, 0.2, 0.17), step(0.82, hb)) * (0.78 + 0.4 * hb), blk);
    s.rough = 0.82;
  }
  s.albedo = mix(s.albedo, vec3f(0.62, 0.62, 0.6), m);
  s.albedo = mix(s.albedo, vec3f(0.6, 0.42, 0.04), y);
  s.rough = mix(s.rough, 0.55, max(m, y));
  // gutter: a darker, smoother strip along the kerb where water and grit collect
  let gut = 1.0 - smoothstep(0.0, 0.45, hw - abs(d));
  s.albedo *= 1.0 - 0.25 * gut * (1.0 - y); s.rough = mix(s.rough, 0.72, gut * 0.5);
  s.ao = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.25, hw - abs(d)));
  return s;
}
fn paveSurf(in: V2F, N: vec3f, slab: f32) -> Surface {
  var s = surfDefault(N);
  let xz = in.wpos.xz; let dist = tDist(in.wpos); let near = 1.0 - smoothstep(4.0, 40.0, dist);
  let u = in.uv.x; let d = in.uv.y;
  let n1 = textureSample(tNoise, sLin, xz * 0.21); let n2 = textureSample(tNoise, sLin, xz * 1.9 + 0.4);
  // concrete slabs 0.6 x 0.9 m (or tarmac footway), laid along the street
  let g = vec2f(u / 0.9, d / slab); let cell = floor(g); let f = abs(fract(g) - 0.5);
  let jw = max(fwidth(g.x), fwidth(g.y)) * 1.2 + 0.012;
  let joint = (1.0 - smoothstep(0.5 - jw * 2.0, 0.5 - jw * 0.5, max(f.x * 0.9 / 0.9, f.y))) * near;
  let tone = 0.86 + 0.24 * hash21(cell + 0.37);
  var a = vec3f(0.3, 0.29, 0.27) * tone * (0.82 + 0.3 * n1.r) * (0.92 + 0.12 * n2.r);
  a = mix(a, a * 0.55, smoothstep(0.62, 0.8, n1.b * 0.6 + n2.g * 0.4) * 0.6);      // stains, chewing gum, damp
  s.albedo = mix(a, a * 0.45, max(1.0 - smoothstep(0.42, 0.5, max(f.x, f.y)), 0.0) * near * 0.5);
  s.rough = 0.8; s.ao = 1.0 - 0.25 * joint;
  s.normal = bumpXZ(N, (n2.rg - 0.5) * 0.3 * near);
  return s;
}
fn kerbStone(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let n = textureSample(tNoise, sLin, in.wpos.xz * 1.3 + in.wpos.yy * 0.7);
  let blk = floor(in.uv.x / 0.915);
  s.albedo = vec3f(0.26, 0.255, 0.25) * (0.8 + 0.3 * n.r) * (0.9 + 0.2 * hash11(blk));
  let j = smoothstep(0.43, 0.455, abs(fract(in.uv.x / 0.915) - 0.5) * 0.915 / 0.915 * 0.915);
  s.albedo *= 1.0 - 0.35 * j; s.rough = 0.75;
  return s;
}
fn gravel(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let xz = in.wpos.xz; let n1 = textureSample(tNoise, sLin, xz * 0.4); let n2 = textureSample(tNoise, sLin, xz * 3.7);
  s.albedo = vec3f(0.24, 0.2, 0.15) * (0.7 + 0.5 * n2.b) * (0.8 + 0.4 * n1.r);
  s.rough = 0.93; s.normal = bumpXZ(N, (n2.rg - 0.5) * 0.5);
  return s;
}
fn deckSurf(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let u = in.uv.x; let d = in.uv.y; let dist = tDist(in.wpos);
  let pl = floor(u / 0.16); let f = fract(u / 0.16); let h = hash11(pl * 1.7);
  let gap = (1.0 - smoothstep(0.0, 0.08 + fwidth(u) * 6.0, min(f, 1.0 - f))) * (1.0 - smoothstep(10.0, 60.0, dist));
  let grain = textureSample(tNoise, sLin, vec2f(u * 6.0, d * 0.35 + h * 3.0));
  s.albedo = vec3f(0.2, 0.15, 0.1) * (0.7 + 0.45 * h) * (0.8 + 0.35 * grain.r) * (1.0 - 0.6 * gap);
  if (!(N.y > 0.5)) { s.albedo = vec3f(0.13, 0.1, 0.08) * (0.8 + 0.3 * grain.r); }
  s.rough = 0.85; s.ao = 1.0 - 0.5 * gap;
  return s;
}
fn circuitKerb(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let u = in.uv.x; let aaU = max(fwidth(u), 0.002);
  let red = smoothstep(0.5 - aaU, 0.5 + aaU, abs(fract(u / 2.0) - 0.5) * 2.0);
  let n = textureSample(tNoise, sLin, in.wpos.xz * 0.9);
  s.albedo = mix(vec3f(0.55, 0.55, 0.52), vec3f(0.33, 0.012, 0.01), red) * (0.82 + 0.25 * n.r);
  s.rough = 0.7;
  return s;
}
fn startLine(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let g = floor(vec2f(in.uv.x + 0.6, in.uv.y + 20.0) / 0.4);
  let c = (i32(g.x) + i32(g.y)) & 1;
  let n = textureSample(tNoise, sLin, in.wpos.xz * 1.7);
  s.albedo = select(vec3f(0.62, 0.62, 0.6), vec3f(0.03), c == 1) * (0.85 + 0.2 * n.r);
  s.rough = 0.6;
  return s;
}

// ---------------------------------------------------------------- buildings
fn wallSurf(in: V2F, N0: vec3f) -> Surface {
  let N = N0;
  var s = surfDefault(N);
  let u = in.uv.x; let v = in.uv.y; let wp = in.wpos; let dist = tDist(wp);
  let near = 1.0 - smoothstep(6.0, 60.0, dist); let mid = 1.0 - smoothstep(40.0, 260.0, dist);
  let style = (in.mat >> 8u) & 255u; let mb = (in.mat >> 16u) & 255u;
  let sh = max(f32(mb & 63u) * 0.1, 2.4); let wmat = mb >> 6u;
  let L = f32((in.mat >> 24u) & 255u); let eave = in.ext.w * 64.0; let bh = in.col.a;
  let pu = vec2f(u, v);
  let n1 = textureSample(tNoise, sLin, vec2f(u * 0.11 + bh * 7.0, v * 0.13));
  let n2 = textureSample(tNoise, sLin, vec2f(u * 0.9, v * 0.9) + bh * 3.0);
  var a = in.col.rgb; var rough = 0.85; var gu = 0.0; var gv = 0.0; var ao = 1.0;
  // ---- wall material
  if (wmat == 1u) {                     // brick: stretcher bond, 225 x 75 mm, recessed mortar
    let row = floor(v / 0.075); let bu = (u / 0.225) + 0.5 * (row % 2.0);
    let bi = vec2f(floor(bu), row); let hb = hash21(bi + bh * 31.0);
    let fu = abs(fract(bu) - 0.5) * 0.225; let fv = abs(fract(v / 0.075) - 0.5) * 0.075;
    let mw = 0.008 + max(fwidth(u), fwidth(v)) * 0.5;
    let mort = (1.0 - smoothstep(0.1125 - mw * 1.4, 0.1125 - mw * 0.4, fu) * smoothstep(0.0375 - mw * 1.4, 0.0375 - mw * 0.4, fv)) * mid;
    a = a * (0.8 + 0.4 * hb) * (0.85 + 0.3 * n1.r);
    a = mix(a, vec3f(0.33, 0.31, 0.28), mort * 0.75);
    ao *= 1.0 - 0.25 * mort; rough = 0.88;
    gu = (n2.r - 0.5) * 0.12 * near; gv = (n2.g - 0.5) * 0.12 * near;
  } else if (wmat == 2u) {              // coursed stone (grey Weston limestone), pale dressed quoins
    let row = floor(v / 0.32); let bu = u / (0.55 + 0.25 * hash11(row + bh * 13.0)) + hash11(row * 3.1 + bh) ;
    let bi = vec2f(floor(bu), row); let hb = hash21(bi + bh * 17.0);
    let fu = abs(fract(bu) - 0.5); let fv = abs(fract(v / 0.32) - 0.5);
    let jw = 0.03 + max(fwidth(bu), fwidth(v / 0.32)) * 0.7;
    let joint = (1.0 - smoothstep(0.5 - jw * 1.5, 0.5 - jw * 0.5, max(fu, fv))) * mid;
    a = a * (0.75 + 0.45 * hb) * (0.85 + 0.3 * n1.r);
    a = mix(a, a * 0.55, joint * 0.7); ao *= 1.0 - 0.3 * joint; rough = 0.9;
    let quoin = (1.0 - step(0.45, min(u, L - u))) * step(0.5, fract(v / 0.64));
    a = mix(a, vec3f(0.42, 0.38, 0.3) * (0.85 + 0.2 * n2.r), quoin * 0.8);
    gu = (n2.r - 0.5) * 0.3 * near; gv = (n2.g - 0.5) * 0.3 * near;
  } else if (wmat == 3u) {              // profiled metal cladding (industrial, garages)
    let rib = abs(fract(u / 0.25) - 0.5);
    a = a * (0.85 + 0.2 * n1.r); rough = 0.55; gu = (rib - 0.25) * 2.0 * mid; s.metal = 0.15;
  } else {                              // painted render, with weathering under the sills and the eaves
    a = a * (0.9 + 0.14 * n1.r) * (0.96 + 0.06 * n2.r); rough = 0.82;
    gu = (n2.r - 0.5) * 0.05 * near; gv = (n2.g - 0.5) * 0.05 * near;
  }
  // grime: streaks down from the eaves and a damp band at the foot of the wall
  let streak = textureSample(tNoise, sLin, vec2f(u * 0.7 + bh * 5.0, v * 0.04)).g;
  a *= 1.0 - 0.18 * smoothstep(0.45, 0.8, streak) * smoothstep(eave - 3.0, eave, v);
  a *= 1.0 - 0.3 * (1.0 - smoothstep(0.3, 1.0, v));
  // ---- openings
  var sp = 2.4; var ww = 1.05; var wh = 1.55; var frame = vec3f(0.72, 0.71, 0.66); var glazing = 1u;
  if (style == 0u) { sp = 2.9; ww = 1.2; wh = 1.25; if (bh > 0.5) { frame = vec3f(0.6, 0.6, 0.58); } }     // house (later houses, casements)
  else if (style == 1u) { sp = 2.3; ww = 1.0; wh = 1.65; }                                                  // Victorian terrace: tall sashes
  else if (style == 2u) { sp = 3.1; ww = 1.5; wh = 1.4; frame = vec3f(0.55, 0.56, 0.57); }                // flats
  else if (style == 3u || style == 10u) { sp = 2.6; ww = 1.15; wh = 1.6; }                                  // shops / hotels above
  else if (style == 4u) { sp = 3.6; ww = 0.85; wh = 3.4; frame = vec3f(0.2, 0.2, 0.2); glazing = 2u; }      // church: lancets
  else if (style == 5u || style == 7u) { glazing = 0u; }                                                    // industrial, garage
  else if (style == 6u) { sp = 3.0; ww = 1.7; wh = 1.5; frame = vec3f(0.3, 0.32, 0.34); }                 // civic
  else if (style == 8u || style == 12u) { glazing = 0u; frame = vec3f(0.86, 0.86, 0.84); }                 // pier pavilion, glazed walkway: bands
  else if (style == 9u) { glazing = 0u; }                                                                   // ruins
  let fl0 = 0.6;
  let kf = floor((v - fl0) / sh); let fv = v - fl0 - kf * sh;
  let n = floor((L - 0.7) / sp); let off = (L - n * sp) * 0.5; let cu = (u - off) / sp; let ci = floor(cu);
  let wu = (fract(cu) - 0.5) * sp;
  var win = 0.0; var glass = 0.0; var shop = 0.0;
  let aa = max(max(fwidth(u), fwidth(v)), 0.004);
  let shopFront = (style == 3u || style == 10u) && kf < 0.5 && v > 0.0;
  if (glazing != 0u && n >= 1.0 && ci >= 0.0 && ci < n && kf >= 0.0) {
    let sill = select(0.95, 1.6, style == 4u);
    let top = sill + wh;
    if (v < eave - 0.25 && fl0 + kf * sh + top < eave - 0.2 && !shopFront && (style != 4u || kf < 0.5)) {
      let ex = ww * 0.5 - abs(wu); let ey = min(fv - sill, top - fv);
      var inside = min(ex, ey);
      if (style == 4u) { let r = ww * 0.5; let cy = top - r; inside = select(min(ex, fv - sill), r - length(vec2f(wu, fv - cy)), fv > cy); }
      let w0 = smoothstep(-aa, aa, inside);
      let fr = 0.065;
      let gl = smoothstep(-aa, aa, inside - fr);
      // sash/glazing bars: a horizontal bar in the middle (and a vertical one on the terraces' big sashes)
      var bars = aaL(fv - (sill + wh * 0.52), 0.025, aa);
      if (style == 1u || style == 3u || style == 10u) { bars = max(bars, aaL(wu, 0.02, aa) * step(sill + wh * 0.52, fv)); }
      if (style == 4u) { bars = max(aaL(fract(fv / 0.45) * 0.45 - 0.225, 0.012, aa), aaL(wu, 0.012, aa)); }
      win = w0; glass = gl * (1.0 - bars);
    }
  }
  if (shopFront) {
    // ground floor shop: wide glazing, stall riser, and a painted fascia above
    let ex = min(u - 0.35, L - 0.35 - u);
    if (ex > 0.0 && L > 2.5) {
      let gl = smoothstep(-aa, aa, min(ex, min(v - 0.95, 3.1 - v)));
      let mull = aaL(fract(u / 2.4) * 2.4 - 1.2, 0.04, aa);
      let fas = smoothstep(-aa, aa, min(v - 3.3, 3.95 - v)) * smoothstep(-aa, aa, ex);
      let hc = hash11(floor(bh * 255.0) + 3.0);
      let fcol = select(select(select(vec3f(0.03, 0.12, 0.07), vec3f(0.05, 0.06, 0.16), hc > 0.25), vec3f(0.22, 0.02, 0.02), hc > 0.55), vec3f(0.6, 0.55, 0.42), hc > 0.8);
      a = mix(a, fcol, fas); rough = mix(rough, 0.45, fas);
      shop = gl; glass = max(glass, gl * (1.0 - mull)); win = max(win, gl);
    }
  }
  // the Grand Pier: long bands of blue-green glazing with white mullions (pavilion: every storey; walkway: one band)
  if ((style == 8u || style == 12u) && L > 1.5) {
    let lo = select(0.55, 0.85, style == 12u); let hi = select(3.3, 2.75, style == 12u);
    let ex = min(u - 0.45, L - 0.45 - u);
    if (ex > 0.0 && v < eave - 0.3) {
      let bm = smoothstep(-aa, aa, min(ex, min(fv - lo, hi - fv))) * step(0.0, kf);
      let mull = aaL(fract(u / select(1.6, 1.3, style == 12u)) - 0.5, 0.03, aa * 2.0);
      win = bm; glass = bm * (1.0 - mull);
      let rail = aaL(fv - (lo + 0.95), 0.03, aa) * step(0.5, kf) * bm;          // balcony rails on the upper floors
      glass *= 1.0 - rail;
    }
  }
  // door: the first opening of the ground floor of houses and terraces (walls of a front's length)
  if ((style == 0u || style == 1u) && kf < 0.5 && ci == 0.0 && L > 3.8 && L < 13.0 && n >= 1.0) {
    let ex = 0.47 - abs(wu); let ey = min(fv + fl0, 2.15 - fv);
    if (fv < 2.3) {
      let dm = smoothstep(-aa, aa, min(ex, ey));
      let hd = hash11(floor(bh * 255.0) + 11.0);
      let dcol = select(select(select(vec3f(0.02, 0.05, 0.12), vec3f(0.12, 0.02, 0.02), hd > 0.3), vec3f(0.02, 0.07, 0.03), hd > 0.55), vec3f(0.55, 0.55, 0.53), hd > 0.8);
      let panel = aaL(fv - 1.2, 0.02, aa) + aaL(wu, 0.015, aa);
      a = mix(a, mix(frame, dcol * (1.0 - 0.3 * panel), smoothstep(-aa, aa, min(ex, ey) - 0.06)), dm);
      win = win * (1.0 - dm); glass = glass * (1.0 - dm); rough = mix(rough, 0.4, dm); ao *= 1.0 - 0.15 * dm;
    }
  }
  if (style == 7u && L > 2.2 && L < 7.0) {   // garage door
    let ex = min(u - 0.25, L - 0.25 - u); let gd = smoothstep(-aa, aa, min(ex, 2.05 - v)) * step(0.0, v);
    let rib = aaL(fract(v / 0.14) * 0.14 - 0.07, 0.01, aa);
    a = mix(a, vec3f(0.5, 0.5, 0.48) * (1.0 - 0.2 * rib), gd); rough = mix(rough, 0.45, gd);
  }
  // window: frame and reveal, then the glass (dark, reflective; a few with curtains or blinds drawn)
  if (win > 0.0) {
    a = mix(a, frame, win); rough = mix(rough, 0.5, win); ao *= 1.0 - 0.25 * win * (1.0 - glass);
    if (glass > 0.0) {
      let hw2 = hash21(vec2f(ci + bh * 97.0, kf + floor(u / 50.0)));
      var gcol = vec3f(0.035, 0.045, 0.055) * (0.7 + 0.6 * hw2);
      if (style == 8u || style == 12u) { gcol = vec3f(0.03, 0.07, 0.068) * (0.8 + 0.4 * hw2); }
      let curtain = step(0.62, hw2) * step(fv, 0.95 + wh * (0.25 + 0.6 * fract(hw2 * 7.1)) + 0.95) * (1.0 - shop);
      gcol = mix(gcol, vec3f(0.32, 0.29, 0.24) * (0.6 + 0.6 * fract(hw2 * 13.7)), curtain * 0.7);
      if (shop > 0.0) { gcol = mix(gcol, vec3f(0.12, 0.1, 0.08) * (0.6 + 0.8 * n2.r), 0.35); }
      a = mix(a, gcol, glass);
      rough = mix(rough, 0.06, glass * (1.0 - curtain * 0.8)); s.metal = mix(s.metal, 0.55, glass * (1.0 - curtain * 0.8)); s.coat = glass * (1.0 - curtain);
      gu = mix(gu, (hw2 - 0.5) * 0.04, glass); gv = mix(gv, 0.0, glass);
    }
  }
  // corner shading (ambient occlusion where two walls meet) and the ground contact
  ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.5, min(u, L - u))) * mid;
  s.albedo = a; s.rough = rough; s.ao = ao;
  s.normal = wallBump(N, gu, gv);
  return s;
}
fn roofSurf(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let u = in.uv.x; let v = in.uv.y; let dist = tDist(in.wpos); let mid = 1.0 - smoothstep(30.0, 220.0, dist);
  let tile = matA(in.mat) > 0.002; let bh = in.col.a;
  let n1 = textureSample(tNoise, sLin, in.wpos.xz * 0.23 + bh * 5.0);
  let crs = select(0.23, 0.26, tile); let row = floor(v / crs); let su = u / select(0.3, 0.28, tile) + 0.5 * (row % 2.0);
  let hb = hash21(vec2f(floor(su), row) + bh * 41.0);
  let fv = fract(v / crs); let fu = abs(fract(su) - 0.5);
  var a = in.col.rgb * (0.82 + 0.3 * hb) * (0.85 + 0.3 * n1.r);
  let lip = (1.0 - smoothstep(0.0, 0.18 + fwidth(v / crs) * 2.0, 1.0 - fv)) * mid;     // shadow under each course
  a *= 1.0 - 0.45 * lip;
  let gap = (1.0 - smoothstep(0.0, 0.06 + fwidth(su) * 2.0, 0.5 - fu)) * mid * select(0.6, 0.3, tile);
  a *= 1.0 - gap;
  // moss and lichen in patches, more on the tiles
  let moss = smoothstep(0.6, 0.85, n1.g * 0.7 + textureSample(tNoise, sLin, in.wpos.xz * 1.1).b * 0.4);
  a = mix(a, vec3f(0.08, 0.09, 0.04) * (0.7 + 0.6 * n1.r), moss * select(0.25, 0.5, tile));
  s.albedo = a; s.rough = select(0.62, 0.78, tile) + 0.15 * moss; s.ao = 1.0 - 0.35 * lip;
  let t = normalize(cross(N, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-5, 0.0, 0.0)); let b = normalize(cross(t, N));
  s.normal = normalize(N + b * (fv - 0.5) * 0.35 * mid + t * select(0.0, (fu - 0.25) * 0.5, tile) * mid);
  return s;
}
fn flatRoof(in: V2F, N: vec3f) -> Surface {
  var s = surfDefault(N);
  let xz = in.wpos.xz; let n1 = textureSample(tNoise, sLin, xz * 0.17); let n2 = textureSample(tNoise, sLin, xz * 2.3);
  s.albedo = in.col.rgb * (0.75 + 0.45 * n1.r) * (0.85 + 0.25 * n2.b);
  s.albedo = mix(s.albedo, s.albedo * 0.6, smoothstep(0.6, 0.8, n1.g) * 0.6);     // puddle marks
  s.rough = 0.85; s.normal = bumpXZ(N, (n2.rg - 0.5) * 0.2);
  return s;
}
fn surf(in: V2F, ff: bool) -> Surface {
  var N = normalize(in.nrm); if (!ff) { N = -N; }
  let id = matId(in.mat);
  if (id == 1u) { return roadSurf(in, N); }
  if (id == 2u) { return paveSurf(in, N, 0.6); }
  if (id == 3u) { return kerbStone(in, N); }
  if (id == 4u) {
    var s = paveSurf(in, N, 0.45); s.albedo *= vec3f(1.08, 1.04, 0.98);
    if ((((in.mat >> 16u) & 255u) & 32u) != 0u) {     // stone steps (Monk's Steps): worn limestone treads, shadowed risers
      let t = fract(in.uv.x / 0.42); let n = textureSample(tNoise, sLin, in.wpos.xz * 1.3).r;
      s.albedo = vec3f(0.36, 0.35, 0.31) * (0.75 + 0.5 * n) * (1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.14, t))); s.rough = 0.9;
    }
    return s;
  }
  if (id == 5u) { return gravel(in, N); }
  if (id == 6u) { return deckSurf(in, N); }
  if (id == 7u) { return circuitKerb(in, N); }
  if (id == 8u) { return startLine(in, N); }
  if (id == 10u) { return wallSurf(in, N); }
  if (id == 11u) { return roofSurf(in, N); }
  if (id == 12u) { return flatRoof(in, N); }
  var s = surfDefault(N);
  let n = textureSample(tNoise, sLin, in.wpos.xz * 0.7 + in.wpos.yy * 0.5);
  if (id == 13u) { s.albedo = in.col.rgb * (0.9 + 0.15 * n.r); s.rough = 0.25 + matA(in.mat) * 0.7; s.metal = 0.25; }
  else if (id == 14u) {
    let t = textureSampleBias(tAtlas, sLin, in.uv, -0.5);
    s.albedo = t.rgb; s.rough = 0.55;
  }
  else { s.albedo = in.col.rgb * (0.8 + 0.3 * n.r); s.rough = 0.85; }
  return s;
}
