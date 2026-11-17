// The cars modelled in Blender — the Aston Martin DB5 and the V8 Vantage — share this loader and this CAR contract. Each
// car is a table (BC_DB5 in 30_car_e_db5.js, BC_V8 in 30_car_f_v8.js) that says where its data are (DB5_META/DB5_B64 or
// V8_META/V8_B64, format in source/blender/README.md), which object each target of the export belongs to, how its decal
// atlas is painted, where the pivots of its moving parts are and how they move. Everything else is here: decoding the
// export, the object slots, the atlas texture, the matrices of the body, wheels and steering wheel, the car viewer.
// When one of them is the selected car (CARSEL, 01_gpu.js) it takes the place of the Uno in CAR (30_car_d_main.js).

const BC = CARSEL === 'v8' ? BC_V8 : CARSEL === 'db5' ? BC_DB5 : null;   // the selected car's table (null: the Uno)
// ---- geometry of the car: DB5_META.car / V8_META.car of the export, the table's values when the export has none
const BCG = BC ? (() => {
  const d = BC.geom, c = BC.meta.car || {}, h = c.half || d.half, st = c.steer || {};
  return {
    wheelbase: c.wheelbase || d.wheelbase, wheelR: c.wheelR || d.wheelR, hubs: c.hubs || d.hubs,
    steerPos: st.pos || d.steerPos, steerTilt: st.tilt === undefined ? d.steerTilt : st.tilt,   // steering-wheel frame (right-hand drive)
    eye: c.eye || d.eye, bonnetCam: c.bonnetCam || d.bonnetCam,     // the driver's eyes (cockpit camera), above the scuttle (bonnet camera)
    halfW: h.w, front: h.front, rear: h.rear,                       // body from the middle of the wheelbase, without the bumpers
    bumper: d.bumper,                                               // how far the bumpers stand out at each end
  };
})() : null;
// shaders: the materials of the Blender cars (#ifdef BCAR), the car's own variants and paint (BC.defs), and its footprint
// for the ambient occlusion on the road
if (BC) {
  const f = v => v.toFixed(4), fr = BCG.front + BCG.bumper, re = BCG.rear + BCG.bumper;
  Object.assign(SH_DEFS, { BCAR: '' }, BC.defs, { CAR_AO_CX: f((fr - re) / 2), CAR_AO_HL: f((fr + re) / 2 - 0.08), CAR_AO_HW: f(BCG.halfW - 0.07), CAR_AO_AX: f(BCG.wheelbase / 2), CAR_AO_TZ: f((Math.abs(BCG.hubs[0][2]) + Math.abs(BCG.hubs[2][2])) / 2 - 0.02) });
}

// ---- painting helpers for the atlases
const _sans = '"Helvetica Neue",Helvetica,Arial,sans-serif';
function bcChrome(g, x0, y0, x1, y1) { const c = g.createLinearGradient(x0, y0, x1, y1); c.addColorStop(0, '#f6f8fa'); c.addColorStop(0.45, '#aab0b8'); c.addColorStop(0.55, '#8a9098'); c.addColorStop(1, '#e4e8ec'); return c; }
// text centred on (cx, cy), squeezed sideways when it is wider than maxW
function bcText(g, txt, cx, cy, px, maxW, font, style) {
  g.font = (font || '700 ') + px + 'px ' + _sans; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(txt).width, k = maxW && w > maxW ? maxW / w : 1;
  g.save(); g.translate(cx, cy); g.scale(k, 1); if (style) g.fillStyle = style; g.fillText(txt, 0, 0); g.restore();
}
// a round instrument: chrome bezel, black face, scale from v0 to v1 with numbers every `step` and ticks every `minor`
// (opts: a0 / sweep of the scale in degrees, red: start of the red sector, div: number shown = value / div, num: size of the
// numbers, plain: no numbers, needle: a fixed needle at that value — the needles of the big dials are drawn by the shader)
function bcDial(g, cx, cy, r, v0, v1, step, minor, label, opts) {
  opts = opts || {}; const a0 = (opts.a0 === undefined ? 135 : opts.a0) * PI / 180, sw = (opts.sweep === undefined ? 270 : opts.sweep) * PI / 180;
  const ang = v => a0 + sw * (v - v0) / (v1 - v0);
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = bcChrome(g, cx - r, cy - r, cx + r, cy + r); g.fill();
  g.beginPath(); g.arc(cx, cy, r * 0.9, 0, TAU); g.fillStyle = '#060607'; g.fill();
  if (opts.red !== undefined) { g.beginPath(); g.arc(cx, cy, r * 0.8, ang(opts.red), ang(v1)); g.lineWidth = r * 0.07; g.strokeStyle = '#d2311c'; g.stroke(); }
  g.strokeStyle = '#eef0f0'; g.fillStyle = '#eef0f0';
  const n = Math.round((v1 - v0) / minor), every = Math.round(step / minor);
  for (let k = 0; k <= n; k++) {
    const v = v0 + k * minor, major = k % every === 0, a = ang(v), co = Math.cos(a), si = Math.sin(a);
    g.beginPath(); g.moveTo(cx + co * r * 0.84, cy + si * r * 0.84); g.lineTo(cx + co * r * (major ? 0.72 : 0.78), cy + si * r * (major ? 0.72 : 0.78)); g.lineWidth = r * (major ? 0.035 : 0.018); g.stroke();
    if (major && !opts.plain) bcText(g, String(opts.div ? v / opts.div : v), cx + co * r * 0.56, cy + si * r * 0.56, r * (opts.num || 0.17), 0, '600 ');
  }
  if (label) bcText(g, label, cx, cy + r * (opts.plain ? 0.42 : 0.3), r * (opts.plain ? 0.2 : 0.11), r * 1.1, '600 ', '#cfd2d2');
  if (opts.needle !== undefined) {
    const a = ang(opts.needle); g.beginPath(); g.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12); g.lineTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74); g.lineWidth = r * 0.06; g.lineCap = 'round'; g.strokeStyle = '#ff5a1e'; g.stroke(); g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, cy, r * 0.13, 0, TAU); g.fillStyle = '#101112'; g.fill();
  }
}
// Paints the car's atlas: each region of BC.AT by the painter of that name (or of the name without its number: plate0 →
// plate), in a box with the proportions of the decal on the car (BCD.aspect, measured from the mesh).
function bcarAtlas() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), aspect = BCD.aspect;
  for (const k in BC.AT) {
    const r = BC.AT[k], paint = BC.PAINT[k] || BC.PAINT[k.replace(/\d+$/, '')]; if (!paint) continue;
    const x = r[0] * S, y = r[1] * S, w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S, lw = h * (aspect[k] || w / h);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); g.scale(w / lw, 1); paint(g, lw, h, k); g.restore();
  }
  const im = g.getImageData(0, 0, S, S), d = im.data;
  // cut-out badges: the transparent texels take the colour of the chrome, so that filtering leaves no dark fringe
  for (const k of BC.cutout) {
    const r = BC.AT[k]; if (!r) continue;
    for (let y = Math.floor(r[1] * S); y < Math.ceil(r[3] * S); y++) for (let x = Math.floor(r[0] * S); x < Math.ceil(r[2] * S); x++) { const o = (y * S + x) * 4; if (d[o + 3] === 0) { d[o] = 176; d[o + 1] = 182; d[o + 2] = 190; } }
  }
  const tex = mkTex(S, S, 'rgba8unorm-srgb', TU.RT | TU.TB | TU.CD, { mipLevelCount: 8 });
  G.dev.queue.writeTexture({ texture: tex }, d, { bytesPerRow: S * 4 }, [S, S]);
  genMips(tex, 'rgba8unorm-srgb');
  return tex;
}

// ---- loader ----
const BCD = {
  groups: null,                      // decoded meshes: { key: { mb, slot (name), flags, glass, glow, side } }
  bb: {},                            // bounds per target: [x0, x1, y0, y1, z0, z1, |z| min, |z| max]
  aspect: {},                        // width / height on the car of the decal of each atlas region
  piv: new Float32Array(48),         // pivots and directions of the moving parts (the car table's pivots() fills it)
  tris: 0, dialK: 1,                 // dialK: sideways squeeze of the dials region in the atlas (1 = none)
  hidden: false,                     // the car was hidden on the last frame (V8 self-destruct)
};
// base64 → zlib stream → bytes
async function bcInflate(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
}
// Walks META.chunks and feeds one MeshBuilder per object, kind of pass and side (format: source/blender/README.md).
// A target the table does not know goes with the body; a material id the shader has no case for is drawn as plain vertex
// colour (the default of wgsl/mat_car.wgsl). Table options of a target: glass (transparent pass), glow (light added in
// the transparent pass, with that material id: wgsl/glow.wgsl), split (a mirrored part whose two halves move apart: the
// left half goes to the first slot of that name, the right half to the second).
function bcarDecode(buf) {
  const M = BC.meta, sc = 1 / M.scale, groups = BCD.groups = {}, bb = BCD.bb, at = BC.AT, reg = {};
  let off = 0; BCD.tris = 0;
  const group = (tg, kind, side, glass, glow) => {
    const key = tg[0] + '|' + kind + (side >= 0 ? '|' + side : '');
    return groups[key] || (groups[key] = { mb: new MeshBuilder(1 << 12), slot: tg[0], flags: tg[1], glass, glow, side });
  };
  for (const ch of M.chunks) {
    const nv = ch.nv, ni = ch.ni;
    const pos = new Int16Array(buf, off, nv * 3); off = (off + nv * 6 + 3) & ~3;
    const nrm = new Int8Array(buf, off, nv * 4); off += nv * 4;
    let uv = null; if (ch.uv) { uv = new Float32Array(buf, off, nv * 2); off += nv * 8; }
    const idx = ch.i32 ? new Uint32Array(buf, off, ni) : new Uint16Array(buf, off, ni); off = (off + ni * (ch.i32 ? 4 : 2) + 3) & ~3;
    let name = ch.t, glass = false;
    if (name === 'glass') { name = 'body'; glass = true; } else if (name.endsWith('_glass')) { name = name.slice(0, -6); glass = true; }
    const tg = BC.targets[name] || BC.targets.body, opt = tg[2] || {};
    if (opt.glass) glass = true;
    const glow = !glass && opt.glow ? opt.glow : 0, kind = glass ? 'g' : glow ? 'w' : '' + tg[1];
    let side = -1, side2 = -1;
    if (opt.split) { let zs = 0; for (let i = 0; i < nv; i++) zs += pos[i * 3 + 2]; side = zs >= 0 ? 1 : 0; if (ch.m) side2 = 1 - side; }
    const gr = group(tg, kind, side, glass, !!glow), mb = gr.mb, v0 = mb.nv, i0 = mb.ni, c = ch.c || [1, 1, 1];
    if (glow) mb.mat(glow, 0); else mb.mat(ch.id, ch.a || 0);
    mb.color(c[0], c[1], c[2]);
    const b = bb[ch.t] || (bb[ch.t] = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9, 1e9, -1e9]);
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3] * sc, y = pos[i * 3 + 1] * sc, z = pos[i * 3 + 2] * sc, az = Math.abs(z);
      mb.v(x, y, z, nrm[i * 4], nrm[i * 4 + 1], nrm[i * 4 + 2], uv ? uv[i * 2] : 1, uv ? uv[i * 2 + 1] : 0);
      if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x; if (y < b[2]) b[2] = y; if (y > b[3]) b[3] = y;
      if (z < b[4]) b[4] = z; if (z > b[5]) b[5] = z; if (ch.m && -z < b[4]) b[4] = -z; if (ch.m && -z > b[5]) b[5] = -z; if (az < b[6]) b[6] = az; if (az > b[7]) b[7] = az;
    }
    for (let i = 0; i < ni; i += 3) mb.tri(v0 + idx[i], v0 + idx[i + 1], v0 + idx[i + 2]);
    BCD.tris += ni / 3 * (ch.m ? 2 : 1);
    // decals: size on the car of what each atlas region is mapped to (for the proportions of the painters)
    if (ch.id === 12 && uv) for (const k in at) {
      const r = at[k], e = 2e-3, a = reg[k] || (reg[k] = { n: [0, 0, 0, 0], p: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] });
      for (let i = 0; i < nv; i++) {
        const u = uv[i * 2], v = uv[i * 2 + 1]; if (u < r[0] - e || u > r[2] + e || v < r[1] - e || v > r[3] + e) continue;
        const q = (Math.abs(u - r[2]) < e ? 1 : Math.abs(u - r[0]) < e ? 0 : -1), w = (Math.abs(v - r[3]) < e ? 1 : Math.abs(v - r[1]) < e ? 0 : -1); if (q < 0 || w < 0) continue;
        const o = q + w * 2; a.n[o]++; for (let j = 0; j < 3; j++) a.p[o][j] += pos[i * 3 + j] * sc;
      }
    }
    if (ch.m) {
      if (side2 < 0) mb.mirror(v0, i0, 2);
      else {   // split: the mirror image is the other side's part, in its own mesh
        const m2 = group(tg, kind, side2, glass, !!glow).mb, w0 = m2.nv;
        if (glow) m2.mat(glow, 0); else m2.mat(ch.id, ch.a || 0);
        m2.color(c[0], c[1], c[2]);
        for (let i = 0; i < nv; i++) m2.v(pos[i * 3] * sc, pos[i * 3 + 1] * sc, -pos[i * 3 + 2] * sc, nrm[i * 4], nrm[i * 4 + 1], -nrm[i * 4 + 2], uv ? uv[i * 2] : 1, uv ? uv[i * 2 + 1] : 0);
        for (let i = 0; i < ni; i += 3) m2.tri(w0 + idx[i], w0 + idx[i + 2], w0 + idx[i + 1]);
      }
    }
  }
  for (const k in reg) {
    const a = reg[k]; if (!(a.n[0] && a.n[1] && a.n[2])) continue;
    const P = o => a.p[o].map(x => x / a.n[o]), p0 = P(0), pu = P(1), pv = P(2), w = Math.hypot(pu[0] - p0[0], pu[1] - p0[1], pu[2] - p0[2]), h = Math.hypot(pv[0] - p0[0], pv[1] - p0[1], pv[2] - p0[2]);
    if (w > 1e-4 && h > 1e-4) BCD.aspect[k] = w / h;
  }
  BC.pivots(buf);
}

// ---- matrices of the moving parts (no numbers through arguments: the register BCQ) ----
const BCQ = new Float64Array(4);
// rotation of BCQ[0] radians about the Z axis through the point (BCQ[1], BCQ[2])
function bcRotZQ(o) {
  const a = BCQ[0], px = BCQ[1], py = BCQ[2], c = Math.cos(a), s = Math.sin(a);
  o.fill(0); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; o[10] = 1; o[15] = 1; o[12] = px - c * px + s * py; o[13] = py - s * px - c * py;
}
// translation by (BCQ[0], BCQ[1], BCQ[2])
function bcMoveQ(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; o[12] = BCQ[0]; o[13] = BCQ[1]; o[14] = BCQ[2]; }
// model matrix of slot s = parent × local, keeping the previous one for the motion vectors (a part that was hidden has none)
function bcPut(s, parent, local) {
  const m = objModel(s), p = objPrev(s);
  if (m[15] === 0) { m4mul(m, parent, local); p.set(m); } else { p.set(m); m4mul(m, parent, local); }
}
function bcHide(s) { objModel(s).fill(0); objPrev(s).fill(0); }

// Light added to the picture in the transparent pass (laser beams, head-up display: wgsl/glow.wgsl), with the atlas.
// A slot whose matrix is zero (hidden) is not drawn.
class GlowSet {
  constructor(tex) {
    this.fam = mkFwdFamily('glow', { src: 'glow', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } });
    this.tex = tex; this.bg = null; this.items = [];
  }
  add_(mesh, slot) { this.items.push({ vb: mesh.vb, ib: mesh.ib, count: mesh.count, slot }); }
  draw(pass) {
    const f = this.fam; if (!f.pipe) return;
    if (!this.bg) this.bg = G.dev.createBindGroup({ layout: f.bgls[3], entries: [{ binding: 0, resource: this.tex.createView() }] });
    let set = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]; if (objModel(it.slot)[15] === 0) continue;
      if (!set) { pass.setPipeline(f.pipe); pass.setBindGroup(3, this.bg); set = true; }
      R.dyn2[0] = it.slot * 256; pass.setBindGroup(2, R.objBG, R.dyn2, 0, 1); pass.setVertexBuffer(0, it.vb); pass.setIndexBuffer(it.ib, 'uint32'); pass.drawIndexed(it.count);
    }
  }
}
// The contract with the game (see CAR in 30_car_d_main.js), Blender cars' version
const BCAR = BC && {
  wheelbase: BCG.wheelbase, trackF: Math.abs(BCG.hubs[0][2]) + Math.abs(BCG.hubs[1][2]), trackR: Math.abs(BCG.hubs[2][2]) + Math.abs(BCG.hubs[3][2]), wheelR: BCG.wheelR, hubs: BCG.hubs,
  S: null,                           // slots of the parts by name: arrays (the slots of the parts that turn with wheels also have .wheels)
  wheelParts: null,                  // slots in the frame of a wheel (45_game.js gives them the wheel's motion vectors)
  slot0: 0, slotN: 0,                // the car's slots are slot0 .. slotN - 1
  glowSet: null, _l: m4(),
  // decoding the mesh takes a stream: done before build() (BUILD callback of 30_car_d_main.js)
  async load() { bcarDecode(await bcInflate(BC.b64)); },
  slots() {
    const C = CAR, S = C.S = {}, wp = [];
    C.slot0 = C.slotBody = objSlot(); for (let i = 0; i < 4; i++) C.slotWheel[i] = objSlot(); C.slotSteer = objSlot();
    S.body = [C.slotBody]; S.wheel = C.slotWheel; S.steer = [C.slotSteer];
    for (const [name, n] of BC.slots) {
      const a = S[name] = [];
      if (Array.isArray(n)) { for (let j = 0; j < n.length; j++) { a.push(objSlot()); wp.push(a[j]); } a.wheels = n; }
      else for (let j = 0; j < n; j++) a.push(objSlot());
    }
    C.slotN = R.objCount; C.wheelParts = new Int32Array(wp);
    for (let i = 0; i < 4; i++) objParams(C.slotWheel[i])[1] = C.wheelR;   // the tyre material wants the outer radius
    m4translate(C._t, BCG.steerPos[0], BCG.steerPos[1], BCG.steerPos[2]); m4rotZ(C._t2, BCG.steerTilt * PI / 180); m4mul(C.steerMat, C._t, C._t2);
    // fixed parameters of the body for the shaders: where the tail lamps begin, and the car's own (BC.params)
    const bp = objParams(C.slotBody), b = BCD.bb.body;
    bp[3] = b ? b[0] + 0.3 : -2.1;
    if (BC.params) BC.params();
    if (BC.DIAL) { const r = BC.AT.dials, wh = (r[2] - r[0]) / (r[3] - r[1]); BCD.dialK = wh / (BCD.aspect.dials || wh); }
    return S;
  },
  build() {
    const C = CAR, fam = C.fam = mkFamily('car', { src: 'mat_car', noCube: true }), S = C.slots();
    const set = C.set = new MeshSet(fam), glass = C.glass = new GlassSet(), glow = [];
    const add = gr => {
      const mesh = gr.mb.upload(), slots = gr.slot === 'wheel' ? C.slotWheel : !S[gr.slot] ? S.body : gr.side >= 0 ? [S[gr.slot][gr.side]] : S[gr.slot];
      for (const s of slots) { if (gr.glass) glass.add_(mesh, s); else if (gr.glow) glow.push(mesh, s); else set.add(mesh, s, gr.flags); }
    };
    for (const k in BCD.groups) add(BCD.groups[k]);
    if (BC.extra) for (const gr of BC.extra()) add(gr);   // meshes the game makes itself (V8: laser beams, ...)
    C.tris = BCD.tris; BCD.groups = null;
    const tex = bcarAtlas();
    R.drawables.push({ draw(pass, ctx) {
      if (ctx.kind === KIND.SHADOW && ctx.cascade === 3) return;
      if (!C.atlasBG) { if (!fam.bgl3) return; C.atlasBG = G.dev.createBindGroup({ layout: fam.bgl3, entries: [{ binding: 0, resource: tex.createView() }] }); }
      pass.setBindGroup(3, C.atlasBG); set.draw(pass, ctx);
    } });
    R.transparents.push(glass);
    if (glow.length) { const g = C.glowSet = new GlowSet(tex); for (let i = 0; i < glow.length; i += 2) g.add_(glow[i], glow[i + 1]); R.transparents.push(g); }
    m4ident(C._t); C.place(C._t, C._z4, C._z4); C.place(C._t, C._z4, C._z4);
  },
  // Writes the matrices of every slot (keeping the previous ones for the motion vectors). Nothing is allocated.
  // CAR.inp[0] = angle of the front wheels, CAR.inp[1] = angle of the steering wheel; the gadget parts follow GAD.v.
  place(body, spin, susp) {
    const C = CAR, steer = C.inp[0], steerWheelAngle = C.inp[1], t = C._t2, t2 = C._t3, L = C._l, S = C.S;
    objPrev(C.slotBody).set(objModel(C.slotBody)); objModel(C.slotBody).set(body);
    for (let i = 0; i < 4; i++) {
      const s = C.slotWheel[i], h = C.hubs[i], left = (i & 1) === 0;
      objPrev(s).set(objModel(s));
      // wheel: T(hub + suspension) · Ry(steering [+π on the left]) · Rz(spin)
      const a = -(i < 2 ? steer : 0) + (left ? PI : 0), c = Math.cos(a), sn = Math.sin(a);
      const g = left ? spin[i] : -spin[i], cg = Math.cos(g), sg = Math.sin(g);
      t[0] = c * cg; t[1] = sg; t[2] = -sn * cg; t[3] = 0;
      t[4] = -c * sg; t[5] = cg; t[6] = sn * sg; t[7] = 0;
      t[8] = sn; t[9] = 0; t[10] = c; t[11] = 0;
      t[12] = h[0]; t[13] = h[1] + susp[i]; t[14] = h[2]; t[15] = 1;
      m4mul(objModel(s), body, t);
    }
    objPrev(C.slotSteer).set(objModel(C.slotSteer));
    const ca = Math.cos(-steerWheelAngle), sa = Math.sin(-steerWheelAngle); t2.fill(0); t2[0] = 1; t2[5] = ca; t2[6] = sa; t2[9] = -sa; t2[10] = ca; t2[15] = 1;
    m4mul(t, C.steerMat, t2); m4mul(objModel(C.slotSteer), body, t);
    BC.parts(body);
    // the driver's head is in the way of the cockpit camera
    if (S.head) { if (GS.cam === 3 && !GS.freeCam) bcHide(S.head[0]); else { L.fill(0); L[0] = L[5] = L[10] = L[15] = 1; bcPut(S.head[0], body, L); } }
    // needles of the two big dials: pivot and tip of each in atlas coordinates, for the shader (speed in mph, engine revs)
    if (BC.DIAL) {
      const p = objParams(C.slotBody), D = BC.DIAL, r = BC.AT.dials, du = r[2] - r[0], dv = r[3] - r[1];
      let f = GS.speed * 2.23694 / D.mph; if (f > 1.04) f = 1.04;
      let a = (D.a0 + D.sweep * f) * 0.017453292519943295, len = D.speedo[2] * 0.8 * dv;
      p[8] = r[0] + du * D.speedo[0]; p[9] = r[1] + dv * D.speedo[1]; p[10] = p[8] + Math.cos(a) * len * BCD.dialK; p[11] = p[9] + Math.sin(a) * len;
      f = VEH.rpm / D.rpm; if (f > 1.04) f = 1.04;
      a = (D.a0 + D.sweep * f) * 0.017453292519943295; len = D.tacho[2] * 0.8 * dv;
      p[12] = r[0] + du * D.tacho[0]; p[13] = r[1] + dv * D.tacho[1]; p[14] = p[12] + Math.cos(a) * len * BCD.dialK; p[15] = p[13] + Math.sin(a) * len;
    }
    // blown up (V8 self-destruct): nothing of the car is drawn; when it comes back, nothing of it has moved
    if (GAD.hidden) { for (let s = C.slot0; s < C.slotN; s++) bcHide(s); BCD.hidden = true; }
    else if (BCD.hidden) { BCD.hidden = false; for (let s = C.slot0; s < C.slotN; s++) objPrev(s).set(objModel(s)); }
  },
};
// The selected Blender car takes the place of the Uno in the contract the game uses
if (BC) Object.assign(CAR, BCAR);
// Isolated viewer (?scene=car) with an Aston Martin: the gadget keys work (smoke, oil, fire...), and W / S roll the car
// slowly forwards / backwards along the test floor, so that what it leaves behind can be seen.
function bcarViewTick() {
  const dt = RT[2], V = VEH, C = CAR; let n = (dt * 120 + 0.5) | 0; if (n < 1) n = 1; else if (n > 8) n = 8;
  V.vx = (GS.held & K_W) ? 7 : (GS.held & K_S) ? -4 : GS.viewRoll;
  for (let i = 0; i < n; i++) { V.x += V.vx * PHYS_DT; for (let k = 0; k < 4; k++) GS.spin[k] += V.vx / C.wheelR * PHYS_DT; gadStep(GS.held); }
  RT[1] = dt; RT[0] += dt; GS.alpha = 1; GS.speed = V.vx < 0 ? -V.vx : V.vx;
  m4translate(C._t, V.x, 0, V.z); C.inp[0] = 0; C.inp[1] = 0; C.place(C._t, GS.spin, C._z4);
  objParams(C.slotBody)[2] = GAD.v[GV_LIGHT];
  for (let i = 0; i < 4; i++) objParams(C.slotWheel[i])[0] = GS.speed / C.wheelR;
  fxFrame();
}
