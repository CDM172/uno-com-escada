// British trees, hedges and garden planting — Weston-super-Mare (?map=wsm), Kewstoke and Sand Bay, and the gallery
// ?scene=uktrees. Gated on those two: the Serra da Mata keeps its own species (33_veg_b_trees.js), atlas and shaders.
//
// Same instancing, LOD and impostor system as the Serra (33_veg_c_sys.js): in British mode it builds the archetypes,
// the leaf atlas and the shader tables of this file instead (veg_uk_tree / veg_uk_leaf / veg_uk_imp.wgsl).
//
// ---------------------------------------------------------------------------------------------------------------- API
// For townVegPlace(push) (34_wsm_world.js) or any planting code that runs inside vegPlace. All functions return the
// number of instances they planted. Coordinates are world metres (X east, Z south), y = the ground under the plant.
//
//   ukTreeSpecies(ctx, h, r, seed) → species id (a key of UKS, which is also the archetype index)
//       ctx  one of UKC.WOOD, STREET, GARDEN, PARK, SEAFRONT, DUNE, BACKDUNE, SCRUB, FIELDEDGE, VILLAGE, HOLIDAY
//            (or the same names as lower-case strings: 'wood', 'fieldedge', ...)
//       h    crown height above the ground (m, e.g. a LIDAR crown: DSM - DTM); 0 = unknown
//       r    crown radius (m); 0 = unknown. With it the crown shape helps: narrow → pines, birch, ash; wide → oak,
//            sycamore, holm oak, horse chestnut; the woodland forms of oak and sycamore when the crown is drawn up
//       seed any number (0..1 from a generator, or an integer such as the crown's index)
//   ukPlant(x, y, z, sp, h, r, rot, seed)
//       plants species sp scaled so its top is at y + h and (if r > 0) its crown as wide as r (the model is stretched
//       horizontally by 0.75..1.35 to match, then scaled); h = 0: the species' own size ± 15 %. rot = yaw (rad; wind-
//       sculpted hawthorns ignore it and lean north-east, away from the prevailing south-westerly).
//   ukShrub(x, y, z, ctx, size, seed)        a shrub for the context: garden (escallonia, laurel, hydrangea-like mounds,
//       young cordylines, holly), wood (holly, bramble, hawthorn), seafront, dune/backdune (sea buckthorn, bramble,
//       blackthorn), scrub and field edge (bramble, blackthorn, hawthorn). size = height (m), 0 = natural.
//   ukGround(x, y, z, kind, size, seed)      near-only ground plants: kind = 'ivy' (ivy carpet), 'fern' (male fern),
//       'bramble', 'marram' (pale dune grass tussock), 'grass' (rough verge grass). size = scale (0 = 1 ± 20 %).
//   ukHedge(pts, kind, opt)                  a continuous hedge along a polyline pts = [x0, z0, x1, z1, ...]:
//       kind = UKS.HEDGE_PRIVET (front gardens), HEDGE_BEECH, HEDGE_HAWTHORN (field hedgerow: wide, ragged, with bramble,
//       blackthorn and hedgerow oaks and ashes), HEDGE_ESCALLONIA (seaside gardens, holiday parks), HEDGE_LEYLAND.
//       opt = { h: height (m), yAt: (x, z) => ground height (default hfAt), gaps: [[s0, s1], ...] along the line (m)
//       left open (gateways, drives), trees: hedgerow trees per 100 m (default 2.5 for HEDGE_HAWTHORN, else 0), seed,
//       closed: true for a loop }.
//   ukWoodFloor(x, y, z, seed, light)        the floor of a wood at one point: ivy carpet, ferns (more where light > 0.5),
//       bramble at the edges (light ~ 1), holly seedlings. Call it on a ~3 m grid inside woods.
//   ukDunes(x, y, z, back, seed)             Sand Bay's dunes on a ~1.3 m grid: pale marram (fore dune, back = 0) thinning
//       into rough grass, bramble and sea buckthorn scrub on the back dunes (back = 1).
//   ukBoundaryHedges(segs)                   British hedges along the town's boundary segments (TOWN.bsegs, code 3):
//       hawthorn hedgerows on the lanes, privet / escallonia / beech / Leyland in front gardens. Meant to replace the
//       green boxes the town builds for code 3 (34_wsm_world.js, boundary()).
//   ukWoodEdges()                            the woods' floor (ukWoodFloor) up to 40 m from their roads, tracks and paths;
//       run by ukEnd when the town code called no ukWoodFloor itself (?nofloor: off).
//   ukZoneHedges(fieldsOnly)                 hedges laid from the town's zone raster: front gardens along pavements, and
//       field edges. vegPlace calls it (through ukEnd) after townVegPlace when the town code planted no hedge itself:
//       only the field edges away from roads while the town builds its own boundaries (TOWN.bsegs); ?nohedge: none.
//
// How the map worker can choose: the zone raster gives the context (TZ.WOOD → wood; pavements and roads → street;
// TZ.GARDEN → garden, or village north of Worlebury Hill (Kewstoke), holiday next to Sand Bay's dunes; TZ.GRASS → park,
// or seafront within ~60 m of the beach; TZ.FIELD → fieldedge; TZ.DUNE → dune / backdune), the LIDAR crown gives h
// (and r if the bake measures it): ukZoneCtx(x, z) does exactly this and can be used as it is. The push handed to
// townVegPlace keeps working: in British mode its archetype numbers 0..8 are read as the old roles (0 large, 1 medium,
// 2 tall, 3 palm, 4 small tree, 5 big shrub, 6 bush, 7 fern, 8 grass clump) and turned into British species by the
// same rules (ukLegacyPush). Typical use for a LIDAR crown:
//     const ctx = ukZoneCtx(x, z), sp = ukTreeSpecies(ctx, h, r, i);  ukPlant(x, hfAt(x, z), z, sp, h, r, rnd() * TAU, i);
// and for an OSM hedge (barrier=hedge) or a field boundary:  ukHedge(pts, UKS.HEDGE_HAWTHORN, { h: 2.2, gaps });
// Costs: 28 archetypes with impostors (256² x 8 azimuths, 2 arrays) + 5 near-only; the leaf atlas is 4096 x 2048 like the
// Serra's; big trees 4-6.5 k triangles (Serra 4.5 k) and 5-25 k single leaves; hedge modules ~200 triangles + 1-2 k leaves.
// ---------------------------------------------------------------------------------------------------------------------
const VEG_UK = TOWN.on || Q.get('scene') === 'uktrees';
// archetypes (= species ids). Those below UK_NT have impostors; the rest are near-only ground plants.
const UKS = {
  OAK: 0, OAK_W: 1, BEECH: 2, ASH: 3, SYCAMORE: 4, SYCAMORE_W: 5, HCHESTNUT: 6, HOLMOAK: 7, SCOTSPINE: 8, MONTPINE: 9,
  BIRCH: 10, PLANE: 11, LIME: 12, HAWTHORN: 13, HAWTHORN_WIND: 14, BLACKTHORN: 15, HOLLY: 16, CORDYLINE: 17,
  SEABUCKTHORN: 18, SHRUB: 19, LAUREL: 20, HYDRANGEA: 21, LEYLAND: 22,
  HEDGE_PRIVET: 23, HEDGE_BEECH: 24, HEDGE_HAWTHORN: 25, HEDGE_ESCALLONIA: 26, HEDGE_LEYLAND: 27,
  BRAMBLE: 28, FERN: 29, IVY: 30, MARRAM: 31, GRASS: 32,
};
const UK_NT = 28, UK_NA = 33;
const UKC = { WOOD: 'wood', STREET: 'street', GARDEN: 'garden', PARK: 'park', SEAFRONT: 'seafront', DUNE: 'dune', BACKDUNE: 'backdune', SCRUB: 'scrub', FIELDEDGE: 'fieldedge', VILLAGE: 'village', HOLIDAY: 'holiday' };
const UK_LEAF_OFF = 1.2;   // range of the leaf corner offsets (m), as UK_LOFF in veg_uk_leaf.wgsl
// leaf shapes of the near layer (veg_uk_leaf.wgsl)
const UKL = { ELL: 0, BEECH: 1, LANCE: 2, OAK: 3, PALM: 4, HEART: 5, BIRCH: 6, HOLLY: 7, NEEDLE: 8, SWORD: 9, OBOV: 10, IVY: 11, HAWTH: 12, BRAMBLE: 13, HOLM: 14, BUCK: 15 };
// bark types (veg_uk_tree.wgsl, UK_BK)
const UKB = { OAK: 0, BEECH: 1, ASH: 2, SYCAMORE: 3, HCHESTNUT: 4, SCOTS: 5, MONTEREY: 6, BIRCH: 7, PLANE: 8, LIME: 9, HOLM: 10, CORDYLINE: 11, HOLLY: 12, HAWTHORN: 13, BLACKTHORN: 14, SHRUB: 15 };
// atlas tiles (8 x 4 tiles of 512²)
const UKT = {
  OAK: 0, BEECH: 1, ASH: 2, SYCAMORE: 3, HCHESTNUT: 4, HOLM: 5, SCOTS: 6, MONTEREY: 7, BIRCH: 8, PLANE: 9, LIME: 10,
  HAWTHORN: 11, BLACKTHORN: 12, HOLLY: 13, SWORD: 14, BUCKTHORN: 15, PRIVET: 16, F_PRIVET: 17, BRAMBLE: 18, IVY: 19,
  FERN: 20, MARRAM: 21, LAUREL: 22, ESCALLONIA: 23, F_BEECH: 24, F_HEDGEROW: 25, GRASS: 26, LEYLAND: 27, HYDRANGEA: 28,
  F_ESCALLONIA: 29, F_LEYLAND: 30, DEADLEAF: 31,
};
const UK_TW = 8, UK_TH = 4, UK_TS = 512;
const ukTileUV = t => [(t % UK_TW) / UK_TW, Math.floor(t / UK_TW) / UK_TH, 1 / UK_TW, 1 / UK_TH];
// shared state of a planting run (set by ukBegin from vegPlace)
const UKV = { push: null, n: 0, stats: { trees: 0, shrubs: 0, ground: 0, hedge: 0, hedgeM: 0, floor: 0 }, time: {}, tris: null, leaves: null };

// ------------------------------------------------------------------------------------------------ leaf layer buffer
// Same vertex layout as VegLeafBuf (veg_leaf / veg_uk_leaf), corner offsets over a 1.2 m range.
class UKLeafBuf extends VegLeafBuf {
  add(b, ax, sd, nl, L, hw, sway, ph, ao, tint, type) {
    if (this.n >= this.cap) { this.cap *= 2; this._mk(); }
    for (let k = 0; k < 4; k++) {
      const u = k >> 1, v = (k & 1) * 2 - 1, i = this.n * 4 + k, ox = ax[0] * L * u + sd[0] * hw * v, oy = ax[1] * L * u + sd[1] * hw * v, oz = ax[2] * L * u + sd[2] * hw * v;
      this.f32[i * 8] = b[0] + ox; this.f32[i * 8 + 1] = b[1] + oy; this.f32[i * 8 + 2] = b[2] + oz;
      const c = x => Math.round(clamp(x / UK_LEAF_OFF, -1, 1) * 32767);
      this.i16[i * 16 + 6] = c(ox); this.i16[i * 16 + 7] = c(oy); this.i16[i * 16 + 8] = c(oz); this.i16[i * 16 + 9] = Math.round(clamp(sway, 0, 1) * 32767);
      const nx = nl[0] + sd[0] * v * 0.32, ny = nl[1] + sd[1] * v * 0.32, nz = nl[2] + sd[2] * v * 0.32, l = Math.hypot(nx, ny, nz) || 1;
      this.i8[i * 32 + 20] = Math.round(nx / l * 127); this.i8[i * 32 + 21] = Math.round(ny / l * 127); this.i8[i * 32 + 22] = Math.round(nz / l * 127); this.i8[i * 32 + 23] = Math.round((0.35 + 0.65 * u) * 127);
      this.u8[i * 32 + 24] = u * 255; this.u8[i * 32 + 25] = (v + 1) * 127.5; this.u8[i * 32 + 26] = ph; this.u8[i * 32 + 27] = Math.round(sat(ao) * 255);
      this.u8[i * 32 + 28] = Math.round(sat(tint[0] * 0.5) * 255); this.u8[i * 32 + 29] = Math.round(sat(tint[1] * 0.5) * 255); this.u8[i * 32 + 30] = Math.round(sat(tint[2] * 0.5) * 255); this.u8[i * 32 + 31] = type;
    }
    this.n++;
  }
}

// ------------------------------------------------------------------------------------------------------ leaf atlas
// Painted with canvas 2D paths in 512² tiles, each from the base (bottom centre: the end of the card at the branch) up.
// The leaves are drawn at a little over life size relative to a card of ~0.8-1.2 m.
function ukAtlasBuild() {
  const TS = UK_TS, W = TS * UK_TW, H = TS * UK_TH, t0 = performance.now();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rnd = mkRng(4417), rr = (a, b) => a + (b - a) * rnd();
  const hsl = (h, s, l, a) => `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a === undefined ? 1 : a})`;
  // half width (0..1) of each leaf outline at t (0 base, 1 tip): the same shapes as the near layer
  const teeth = (t, n, a) => 1 - a * Math.abs(fract(t * n) - 0.5) * 2;
  const SH = {
    ell: t => Math.pow(Math.sin(PI * Math.pow(t, 0.68)), 0.75),
    beech: t => Math.pow(Math.sin(PI * Math.pow(t, 0.62)), 0.6) * (1 + 0.05 * Math.sin(t * 44)),
    lance: t => Math.pow(Math.sin(PI * Math.pow(t, 0.8)), 0.85) * teeth(t, 18, 0.06),
    oak: t => Math.pow(Math.sin(PI * Math.pow(t, 0.72)), 0.7) * (0.45 + 0.55 * Math.pow(Math.abs(Math.sin(t * PI * 4.5 + 0.35)), 0.5)) * lerp(0.7, 1, smooth(0.02, 0.12, t)),
    palm: t => Math.pow(Math.sin(PI * Math.pow(t, 0.78)), 0.45) * (1 - 0.5 * Math.exp(-Math.pow((t - 0.4) / 0.055, 2)) - 0.42 * Math.exp(-Math.pow((t - 0.7) / 0.05, 2))) * teeth(t, 22, 0.07) * smooth(0, 0.06, t),
    heart: t => Math.pow(Math.sin(PI * (0.14 + 0.86 * Math.pow(t, 0.85))), 0.55) * (1 - 0.4 * smooth(0.75, 1, t)) * teeth(t, 26, 0.05) * smooth(0, 0.05, t),
    birch: t => Math.pow(sat(t < 0.32 ? Math.pow(t / 0.32, 0.5) : (1 - t) / 0.68), 1.05) * teeth(t, 16, 0.12) * teeth(t, 32, 0.05),
    holly: t => Math.pow(Math.sin(PI * Math.pow(t, 0.7)), 0.7) * (0.72 + 0.28 * Math.pow(fract(t * 4.2 + 0.1), 3)),
    sword: t => Math.pow(sat((1 - t) / 0.2), 0.8) * smooth(0, 0.05, t),
    obov: t => Math.pow(Math.sin(PI * Math.pow(t, 1.45)), 0.7) * teeth(t, 24, 0.05) * smooth(0, 0.08, t),
    ivy: t => Math.pow(Math.sin(PI * Math.pow(t, 0.7)), 0.4) * (1 - 0.45 * Math.exp(-Math.pow((t - 0.38) / 0.07, 2)) - 0.3 * Math.exp(-Math.pow((t - 0.66) / 0.06, 2))) * smooth(0, 0.06, t),
    hawth: t => Math.pow(Math.sin(PI * Math.pow(t, 0.85)), 0.6) * smooth(0, 0.25, t) * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(t * PI * 3.2 + 0.2)), 0.5)) * teeth(t, 30, 0.08),
    bramble: t => Math.pow(Math.sin(PI * Math.pow(t, 0.72)), 0.7) * teeth(t, 28, 0.09),
    holm: t => Math.pow(Math.sin(PI * Math.pow(t, 0.7)), 0.72) * teeth(t, 12, 0.05),
    buck: t => Math.pow(Math.sin(PI * Math.pow(t, 0.85)), 0.6),
  };
  const N_OUT = 12;
  // one leaf along +x from (x, y): length len, half width wid; c = [h, s, l]; sh = outline. Flat fills (no gradient,
  // no clip: the atlas has tens of thousands of leaves): the body, the lit half, a gloss spot, midrib and veins.
  const leaf = (x, y, ang, len, wid, c, sh, glossy) => {
    const f = SH[sh] || SH.ell, ca = Math.cos(ang), sa = Math.sin(ang), NO = wid < 4 ? 7 : N_OUT;
    const P = (u, v) => [x + ca * u - sa * v, y + sa * u + ca * v];
    g.fillStyle = hsl(c[0], c[1], c[2]); g.beginPath(); g.moveTo(x, y);
    for (let i = 1; i <= NO; i++) { const t = i / NO, q = P(len * t, -wid * f(t)); g.lineTo(q[0], q[1]); }
    for (let i = NO - 1; i > 0; i--) { const t = i / NO, q = P(len * t, wid * f(t)); g.lineTo(q[0], q[1]); }
    g.closePath(); g.fill();
    if (wid < 2.2) return;
    if (wid > 4) { g.strokeStyle = hsl(c[0] + 6, c[1] + 6, Math.max(3, c[2] - 12), 0.45); g.lineWidth = 0.9; g.stroke(); }   // a dark rim: overlapping leaves stay apart
    // lit half (from the base along one edge to the tip and back down the midrib), slightly lighter
    g.fillStyle = hsl(c[0] + 5, c[1] + 4, c[2] + 6, 0.5); g.beginPath(); g.moveTo(x, y);
    for (let i = 1; i <= NO; i++) { const t = i / NO, q = P(len * t, -wid * f(t) * 0.96); g.lineTo(q[0], q[1]); }
    g.closePath(); g.fill();
    if (glossy && wid > 3) { const q = P(len * 0.42, -wid * 0.3); g.fillStyle = hsl(c[0] - 10, c[1] - 18, c[2] + 28, 0.3 * glossy); g.beginPath(); g.ellipse(q[0], q[1], len * 0.18, wid * 0.16, ang, 0, TAU); g.fill(); }
    g.strokeStyle = hsl(c[0] + 10, c[1] - 8, c[2] + 15, 0.7); g.lineWidth = Math.max(0.7, wid * 0.08);
    const e = P(len * 0.96, 0); g.beginPath(); g.moveTo(x, y); g.lineTo(e[0], e[1]);
    if (wid > 4) for (let i = 1; i < 6; i++) { const t = i / 6.5, a = P(len * t, 0), b = P(len * (t + 0.12), -wid * 0.8 * f(t + 0.06)), d = P(len * (t + 0.12), wid * 0.8 * f(t + 0.06)); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); }
    g.stroke();
  };
  const stem = (x0, y0, x1, y1, w, c) => { g.strokeStyle = hsl(c[0], c[1], c[2]); g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const tt = UKV.time.tiles = [];
  const tile = (i, fn) => { const t = performance.now(); g.save(); g.beginPath(); g.rect((i % UK_TW) * TS + 2, Math.floor(i / UK_TW) * TS + 2, TS - 4, TS - 4); g.clip(); g.translate((i % UK_TW) * TS, Math.floor(i / UK_TW) * TS); fn(); g.restore(); tt[i] = Math.round(performance.now() - t); };
  const jit = (c, dh, ds, dl) => [c[0] + rr(-dh, dh), c[1] + rr(-ds, ds), c[2] + rr(-dl, dl)];
  // a recursive shoot with leaves. P: { step, stemW, stemC, branchP, depth, leafL, leafW, sh, col, perNode, leafP, ang: [a0, a1],
  //   droop, opp (opposite pairs), compound: 'pinnate' | 'palmate' (n leaflets), gloss, curl, tip }
  const shoot = (x, y, ang, len, depth, P) => {
    const n = Math.max(2, Math.round(len / P.step)); let px = x, py = y, a = ang;
    for (let i = 1; i <= n; i++) {
      a += rr(-0.12, 0.12) * (P.wig || 1) + (P.droop || 0) * Math.cos(a) * 0.07 + (P.curl || 0);
      const nx = px + Math.cos(a) * len / n, ny = py + Math.sin(a) * len / n;
      stem(px, py, nx, ny, Math.max(0.8, P.stemW * (depth + 0.6) * (1 - i / n * 0.6)), P.stemC || [30, 25, 18]);
      px = nx; py = ny;
      const side = i % 2 ? 1 : -1, t = i / n;
      if (depth > 0 && i > 1 && i < n && rnd() < P.branchP) shoot(px, py, a + side * rr(0.5, 1.0), len * rr(0.35, 0.55) * (1 - t * 0.45), depth - 1, P);
      if (i < 2 && depth === P.depth) continue;
      for (let q = 0; q < P.perNode; q++) {
        if (rnd() > P.leafP) continue;
        const s2 = P.opp ? (q % 2 ? -1 : 1) : (q % 2 ? -side : side), dk = rnd() < 0.3 ? -9 : 0;
        const la = a + s2 * rr(P.ang[0], P.ang[1]) + (P.droop || 0) * 0.45 * Math.cos(a);
        const c = jit(P.col, 7, 6, 4); c[2] += dk;
        leafOrCompound(px, py, la, P.leafL * rr(0.72, 1.18), P, c);
      }
    }
    if (P.tip !== false) leafOrCompound(px, py, a + rr(-0.2, 0.2), P.leafL * 1.05, P, jit(P.col, 6, 4, 3));
  };
  const leafOrCompound = (x, y, a, L, P, c) => {
    if (P.compound === 'pinnate') {        // ash: a rachis with opposite leaflets and an end one
      const n = P.nLeaflets || 9, ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
      stem(x, y, ex, ey, 1.2, [80, 25, 30]);
      for (let k = 1; k <= (n - 1) / 2; k++) {
        const t = 0.18 + 0.78 * k / ((n - 1) / 2 + 0.3), qx = x + (ex - x) * t, qy = y + (ey - y) * t, ll = P.leafL * 0.34 * rr(0.85, 1.1);
        leaf(qx, qy, a + 1.05, ll, ll * P.leafW, jit(c, 3, 3, 3), P.sh, P.gloss); leaf(qx, qy, a - 1.05, ll, ll * P.leafW, jit(c, 3, 3, 3), P.sh, P.gloss);
      }
      leaf(ex, ey, a, P.leafL * 0.36, P.leafL * 0.36 * P.leafW, c, P.sh, P.gloss);
    } else if (P.compound === 'palmate') { // horse chestnut: 5-7 leaflets fanning from the end of a long stalk
      const n = P.nLeaflets || 7, pl = L * 0.45, ex = x + Math.cos(a) * pl, ey = y + Math.sin(a) * pl;
      stem(x, y, ex, ey, 1.6, [60, 25, 30]);
      for (let k = 0; k < n; k++) { const u = k / (n - 1) - 0.5, ll = L * 0.75 * (1 - Math.abs(u) * 0.55) * rr(0.9, 1.1); leaf(ex, ey, a + u * 2.6, ll, ll * P.leafW, jit(c, 3, 3, 3), P.sh, P.gloss); }
    } else if (P.compound === 'trifol') {  // bramble: three to five leaflets
      const pl = L * 0.3, ex = x + Math.cos(a) * pl, ey = y + Math.sin(a) * pl;
      stem(x, y, ex, ey, 1.3, [340, 30, 26]);
      for (let k = 0; k < 3; k++) { const u = k - 1, ll = L * 0.6 * (u ? 0.85 : 1); leaf(ex, ey, a + u * 1.1, ll, ll * P.leafW, jit(c, 3, 3, 3), P.sh, P.gloss); }
    } else if (P.compound === 'needles') { // pine shoot tip: a brush of needles pointing forwards
      const n = P.nNeedles || 18;
      for (let k = 0; k < n; k++) {
        const t = rnd() * 0.85, qx = x + Math.cos(a) * L * 0.35 * t, qy = y + Math.sin(a) * L * 0.35 * t, sd = k % 2 ? 1 : -1;
        const na = a + sd * rr(0.25, 0.75) * (1 - t * 0.4), nl = L * rr(0.55, 0.85), cc = jit(c, 4, 4, 5);
        g.strokeStyle = hsl(cc[0], cc[1], cc[2]); g.lineWidth = P.needleW || 1.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(qx, qy); g.quadraticCurveTo(qx + Math.cos(na) * nl * 0.5, qy + Math.sin(na) * nl * 0.5 + rr(-2, 2), qx + Math.cos(na) * nl, qy + Math.sin(na) * nl); g.stroke();
      }
    } else leaf(x, y, a, L, L * P.leafW, c, P.sh, P.gloss);
  };
  // a fan of shoots from the base in three layers (dark, full back → light, sparse front): depth and a full outline
  const fan = (P, nTw, spread, lenMin, lenMax, y0) => {
    for (let layer = 0; layer < 3; layer++) {
      const Q = Object.assign({}, P, { col: [P.col[0] + [5, 0, -4][layer], P.col[1] + [-8, 0, 4][layer], P.col[2] + [-10, -2, 5][layer]], leafP: P.leafP * [0.95, 0.85, 0.7][layer] });
      for (let k = 0; k < nTw; k++) {
        const u = (k + rr(0.1, 0.9)) / nTw - 0.5, a = -PI / 2 + u * spread;
        shoot(256 + u * 70 + rr(-10, 10), y0 || 502, a, rr(lenMin * (layer === 2 ? 0.55 : 0.8), lenMax) * (1 - 0.42 * Math.abs(u) * 2), P.depth, Q);
      }
    }
  };
  // an opaque mat of leaves over the whole tile (the clipped face of a hedge): a dark base, then leaves at random
  const mat = (P, n, dark, gaps) => {
    // the dark depth of the hedge fills an irregular blob inset from the tile's edge; leaves overlap its rim, so the
    // tile's border is ragged leaves over transparency (the face cards overlap and merge without seams)
    g.fillStyle = hsl(dark[0], dark[1], dark[2]); g.beginPath();
    for (let k = 0; k <= 48; k++) { const a = k / 48 * TAU, r = 190 + 30 * Math.sin(a * 5 + 1.3) * Math.cos(a * 3) + rr(-8, 8); const x = 256 + Math.cos(a) * r * 1.12, y = 256 + Math.sin(a) * r * 1.12; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill();
    for (let k = 0; k < n; k++) {
      const a = rr(0, TAU), rd = Math.sqrt(rnd()) * 250, x = 256 + Math.cos(a) * rd, y = 256 + Math.sin(a) * rd, t = k / n, c = jit(P.col, 6, 6, 5); c[2] += (t - 0.6) * 14;
      if (P.twigs && rnd() < 0.04) stem(x, y, x + rr(-30, 30), y + rr(-30, 30), 1.4, P.stemC || [25, 20, 16]);
      leafOrCompound(x, y, rr(0, TAU), P.leafL * rr(0.75, 1.2), P, c);
    }
    if (gaps) {   // holes through a hedgerow: where light shows through the twigs
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < gaps; k++) { g.fillStyle = 'rgba(0,0,0,0.9)'; g.beginPath(); g.ellipse(rr(0, TS), rr(0, TS), rr(6, 20), rr(4, 12), rr(0, PI), 0, TAU); g.fill(); }
      g.globalCompositeOperation = 'source-over';
    }
  };
  // blades rooted along the whole width (grass strip): any window of the tile is a clump
  const blades = (n, hMin, hMax, w0, w1, col, dry, dryCol, bend) => {
    for (let k = 0; k < n; k++) {
      const x0 = rr(10, 502), L = rr(hMin, hMax), w = rr(w0, w1), a = -PI / 2 + rr(-0.35, 0.35) * (1 - L / 520), bd = rr(-bend, bend);
      const x1 = x0 + Math.cos(a) * L * 0.55, y1 = 508 + Math.sin(a) * L * 0.55, x2 = x0 + Math.cos(a) * L + bd, y2 = 508 + Math.sin(a) * L + Math.abs(bd) * 0.45;
      const isDry = rnd() < dry, c = isDry ? jit(dryCol, 5, 5, 6) : jit(col, 6, 6, 5);
      const gr = g.createLinearGradient(x0, 508, x2, y2); gr.addColorStop(0, hsl(c[0] + 10, c[1] - 4, c[2] - 12)); gr.addColorStop(0.6, hsl(c[0], c[1], c[2])); gr.addColorStop(1, hsl(c[0] - 6, c[1] - 6, c[2] + (isDry ? 14 : 8)));
      g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w / 2, 508); g.quadraticCurveTo(x1 - w * 0.4, y1, x2, y2); g.quadraticCurveTo(x1 + w * 0.4, y1, x0 + w / 2, 508); g.fill();
    }
  };
  const BARK = [28, 18, 22];
  // --- broadleaves ---
  // oak: clusters of lobed leaves crowded at the ends of zigzag shoots; deep, slightly yellowish dark green
  tile(UKT.OAK, () => fan({ depth: 2, step: 16, stemW: 1.5, stemC: BARK, branchP: 0.55, leafL: 32, leafW: 0.34, sh: 'oak', col: [90, 34, 22], perNode: 2, leafP: 0.72, ang: [0.5, 1.1], wig: 1.6 }, 7, 2.5, 320, 450));
  // beech: flat sprays, two ranks of glossy oval leaves along fine zigzag twigs; a fresher green
  tile(UKT.BEECH, () => {
    for (let layer = 0; layer < 3; layer++) for (let k = 0; k < 7; k++) {
      const u = (k + rr(0.1, 0.9)) / 7 - 0.5, a = -PI / 2 + u * 2.4, c = [84 + [4, 0, -3][layer], 44 + [-8, 0, 3][layer], 27 + [-9, -1, 5][layer]];
      shoot(256 + u * 60, 502, a, rr(330, 440) * (1 - Math.abs(u) * 0.7), 1, { depth: 1, step: 11, stemW: 1.1, stemC: [25, 20, 20], branchP: 0.7, leafL: 24, leafW: 0.5, sh: 'beech', col: c, perNode: 1, leafP: 0.95, ang: [1.0, 1.35], wig: 1.4, gloss: 0.6 });
    }
  });
  // ash: pinnate leaves on stout grey shoots, leaflets narrow and light green: airy, the sky shows through
  tile(UKT.ASH, () => fan({ depth: 1, step: 34, stemW: 2.2, stemC: [40, 6, 40], branchP: 0.5, leafL: 150, leafW: 0.27, sh: 'lance', col: [86, 36, 26], perNode: 2, leafP: 0.85, ang: [0.6, 1.0], opp: true, compound: 'pinnate', nLeaflets: 11 }, 5, 2.2, 300, 440));
  // sycamore: big five-lobed leaves on long red stalks, dark green and heavy
  tile(UKT.SYCAMORE, () => fan({ depth: 1, step: 30, stemW: 2, stemC: [20, 25, 28], branchP: 0.5, leafL: 72, leafW: 0.5, sh: 'palm', col: [96, 34, 19], perNode: 2, leafP: 0.9, ang: [0.6, 1.1], opp: true }, 6, 2.5, 330, 460));
  // horse chestnut: palmate leaves of seven obovate leaflets, the odd one browned by the leaf miner
  tile(UKT.HCHESTNUT, () => {
    fan({ depth: 1, step: 42, stemW: 2.4, stemC: [25, 30, 26], branchP: 0.45, leafL: 120, leafW: 0.34, sh: 'obov', col: [94, 40, 21], perNode: 2, leafP: 0.9, ang: [0.6, 1.2], opp: true, compound: 'palmate', nLeaflets: 7 }, 5, 2.4, 320, 450);
    for (let k = 0; k < 14; k++) { g.fillStyle = hsl(32 + rr(-6, 6), 45, 30 + rr(-4, 6), 0.55); g.beginPath(); g.ellipse(rr(60, 450), rr(60, 450), rr(6, 16), rr(4, 10), rr(0, PI), 0, TAU); g.fill(); }
  });
  // holm oak: small leathery leaves, very dark above and grey-felted below, densely set
  tile(UKT.HOLM, () => fan({ depth: 1, step: 9, stemW: 1.1, stemC: [30, 10, 22], branchP: 0.55, leafL: 24, leafW: 0.4, sh: 'holm', col: [105, 22, 15], perNode: 2, leafP: 0.85, ang: [0.6, 1.2], gloss: 0.5, droop: 0.6 }, 7, 2.6, 330, 460));
  // Scots pine: tufts of short twisted blue-green needles on orange shoots, in clumps
  tile(UKT.SCOTS, () => fan({ depth: 2, step: 20, stemW: 1.6, stemC: [22, 45, 32], branchP: 0.5, leafL: 46, leafW: 0.1, sh: 'ell', col: [150, 20, 25], perNode: 2, leafP: 0.9, ang: [0.3, 0.8], compound: 'needles', nNeedles: 16, needleW: 1.7 }, 6, 2.4, 300, 440));
  // Monterey pine: long bright green needles in dense brushes
  tile(UKT.MONTEREY, () => fan({ depth: 1, step: 26, stemW: 2.2, stemC: [25, 25, 20], branchP: 0.6, leafL: 95, leafW: 0.1, sh: 'ell', col: [105, 42, 25], perNode: 2, leafP: 0.95, ang: [0.2, 0.6], compound: 'needles', nNeedles: 22, needleW: 1.5 }, 6, 2.5, 320, 460));
  // silver birch: fine shoots that arch over and hang, small toothed triangular leaves, light yellowish green
  tile(UKT.BIRCH, () => {
    for (let layer = 0; layer < 3; layer++) for (let k = 0; k < 7; k++) {
      const u = (k + rr(0.1, 0.9)) / 7 - 0.5;
      shoot(256 + u * 90, 502, -PI / 2 + u * 0.8, rr(380, 470), 1, { depth: 1, step: 13, stemW: 0.9, stemC: [15, 35, 18], branchP: 0.45, leafL: 17, leafW: 0.42, sh: 'birch', col: [76 + [4, 0, -3][layer], 46, 32 + [-9, -1, 5][layer]], perNode: 1, leafP: 0.9, ang: [0.5, 1.2], curl: u * 0.012, droop: 1.6 });
    }
  });
  // London plane: big maple-like leaves, bright green, and the seed balls hanging on their stalks
  tile(UKT.PLANE, () => {
    fan({ depth: 1, step: 36, stemW: 2.1, stemC: [35, 20, 30], branchP: 0.5, leafL: 92, leafW: 0.55, sh: 'palm', col: [84, 40, 27], perNode: 1, leafP: 0.95, ang: [0.6, 1.2] }, 6, 2.5, 330, 460);
    for (let k = 0; k < 6; k++) { const x = rr(80, 430), y = rr(80, 380); stem(x, y, x + rr(-6, 6), y + 30, 1, [30, 25, 25]); g.fillStyle = hsl(40, 30, 28); g.beginPath(); g.arc(x, y + 34, 7, 0, TAU); g.fill(); }
  });
  // lime: heart-shaped leaves, regular and dense, mid green
  tile(UKT.LIME, () => fan({ depth: 2, step: 15, stemW: 1.3, stemC: [10, 35, 25], branchP: 0.55, leafL: 40, leafW: 0.5, sh: 'heart', col: [88, 42, 26], perNode: 1, leafP: 0.95, ang: [0.8, 1.3], wig: 1.3, droop: 0.4 }, 7, 2.5, 330, 460));
  // hawthorn: dense, twiggy, small deeply lobed leaves; a few green-red haws
  tile(UKT.HAWTHORN, () => {
    fan({ depth: 1, step: 9, stemW: 1.2, stemC: [25, 15, 22], branchP: 0.7, leafL: 21, leafW: 0.45, sh: 'hawth', col: [98, 40, 22], perNode: 2, leafP: 0.75, ang: [0.6, 1.3], wig: 2 }, 7, 2.6, 300, 450);
    for (let k = 0; k < 9; k++) { const x = rr(70, 440), y = rr(70, 400); for (let q = 0; q < 6; q++) { g.fillStyle = hsl(rr(0, 12), 60, rr(28, 38)); g.beginPath(); g.arc(x + rr(-9, 9), y + rr(-7, 7), 3.2, 0, TAU); g.fill(); } }
  });
  // blackthorn: a thicket of black spiny twigs with tiny dark leaves, a few bloomed sloes
  tile(UKT.BLACKTHORN, () => {
    fan({ depth: 1, step: 8, stemW: 1.3, stemC: [20, 10, 10], branchP: 0.8, leafL: 15, leafW: 0.45, sh: 'ell', col: [104, 30, 18], perNode: 2, leafP: 0.65, ang: [0.6, 1.2], wig: 2.2 }, 8, 2.6, 300, 450);
    for (let k = 0; k < 16; k++) { g.fillStyle = hsl(235, 25, rr(20, 30)); g.beginPath(); g.arc(rr(60, 450), rr(60, 450), 4, 0, TAU); g.fill(); }
  });
  // holly: spiny, very dark and glossy
  tile(UKT.HOLLY, () => fan({ depth: 1, step: 11, stemW: 1.4, stemC: [95, 25, 25], branchP: 0.5, leafL: 36, leafW: 0.45, sh: 'holly', col: [110, 42, 13], perNode: 2, leafP: 0.85, ang: [0.6, 1.2], gloss: 1 }, 7, 2.6, 320, 460));
  // cordyline: four sword leaves side by side, full length (each card or strip uses one column of 128 px)
  tile(UKT.SWORD, () => {
    for (let k = 0; k < 4; k++) {
      const cx = 64 + k * 128, dead = k === 3, c = dead ? [38, 20, 42] : [78 + k * 4, 42 - k * 3, 32 + k * 2], w = 26;
      g.beginPath(); g.moveTo(cx - w * 0.55, 512);
      for (let i = 0; i <= 40; i++) { const t = i / 40, hw = w * (t < 0.06 ? 0.55 + t * 7 : 1) * Math.pow(sat((1 - t) / 0.25), 0.6) * 0.5 * 1.8; g.lineTo(cx - hw + Math.sin(t * 3) * 3, 512 - t * 506); }
      for (let i = 40; i >= 0; i--) { const t = i / 40, hw = w * (t < 0.06 ? 0.55 + t * 7 : 1) * Math.pow(sat((1 - t) / 0.25), 0.6) * 0.5 * 1.8; g.lineTo(cx + hw + Math.sin(t * 3) * 3, 512 - t * 506); }
      g.closePath();
      const gr = g.createLinearGradient(cx - w, 0, cx + w, 0); gr.addColorStop(0, hsl(c[0], c[1], c[2] - 6)); gr.addColorStop(0.5, hsl(c[0] - 4, c[1] + 4, c[2] + 6)); gr.addColorStop(1, hsl(c[0], c[1], c[2] - 3));
      g.fillStyle = gr; g.fill();
      g.strokeStyle = hsl(c[0] + 8, c[1] - 10, c[2] + 14, 0.5); g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, 512); g.lineTo(cx + Math.sin(3) * 3, 20); g.stroke();
      if (dead) { g.strokeStyle = hsl(30, 25, 25, 0.5); for (let q = 0; q < 12; q++) { g.beginPath(); const y = rr(30, 500); g.moveTo(cx - 10, y); g.lineTo(cx + 10, y + rr(-5, 5)); g.stroke(); } }
    }
  });
  // sea buckthorn: narrow silvery leaves, thorny shoots and orange berries crowding the older wood
  tile(UKT.BUCKTHORN, () => {
    fan({ depth: 1, step: 9, stemW: 1.3, stemC: [30, 15, 30], branchP: 0.6, leafL: 36, leafW: 0.13, sh: 'buck', col: [85, 13, 44], perNode: 2, leafP: 0.85, ang: [0.35, 0.8] }, 7, 2.5, 320, 450);
    for (let k = 0; k < 10; k++) { const x = rr(80, 430), y = rr(120, 470); for (let q = 0; q < 14; q++) { g.fillStyle = hsl(28 + rr(-4, 4), 85, rr(42, 52)); g.beginPath(); g.arc(x + rr(-4, 4), y - q * 5, 3.4, 0, TAU); g.fill(); } }
  });
  // privet: small glossy oval leaves in opposite pairs
  tile(UKT.PRIVET, () => fan({ depth: 1, step: 9, stemW: 1.1, stemC: [35, 15, 25], branchP: 0.6, leafL: 22, leafW: 0.45, sh: 'ell', col: [95, 42, 23], perNode: 2, leafP: 0.95, ang: [0.7, 1.2], opp: true, gloss: 0.7 }, 7, 2.6, 300, 450));
  // clipped faces: privet, beech, escallonia, Leyland cypress; a hedgerow face with holes
  tile(UKT.F_PRIVET, () => mat({ leafL: 22, leafW: 0.45, sh: 'ell', col: [95, 44, 24], gloss: 0.7, twigs: true }, 2600, [100, 40, 8]));
  tile(UKT.F_BEECH, () => mat({ leafL: 26, leafW: 0.5, sh: 'beech', col: [90, 37, 22], gloss: 0.4, twigs: true }, 2000, [92, 35, 8]));
  tile(UKT.F_ESCALLONIA, () => { mat({ leafL: 18, leafW: 0.42, sh: 'ell', col: [110, 40, 18], gloss: 0.9 }, 2900, [110, 40, 6]); for (let k = 0; k < 40; k++) { const x = rr(0, 512), y = rr(0, 512); for (let q = 0; q < 7; q++) { g.fillStyle = hsl(335 + rr(-8, 8), 55, rr(48, 62)); g.beginPath(); g.arc(x + rr(-7, 7), y + rr(-7, 7), 3, 0, TAU); g.fill(); } } });
  tile(UKT.F_LEYLAND, () => {
    g.fillStyle = hsl(120, 35, 7); g.fillRect(0, 0, TS, TS);
    for (let k = 0; k < 700; k++) { const x = rr(-20, 532), y = rr(-20, 532), a = rr(0, TAU), c = jit([115, 35, 18], 5, 5, 5); shoot(x, y, a, rr(30, 60), 1, { depth: 1, step: 6, stemW: 2.6, stemC: c, branchP: 0.7, leafL: 4, leafW: 0.5, sh: 'ell', col: c, perNode: 1, leafP: 0.4, ang: [0.6, 1], tip: false }); }
  });
  tile(UKT.F_HEDGEROW, () => {
    mat({ leafL: 19, leafW: 0.45, sh: 'hawth', col: [98, 40, 22], twigs: true, stemC: [25, 15, 18] }, 1700, [95, 35, 8], 70);
    for (let k = 0; k < 60; k++) { const x = rr(0, 512), y = rr(0, 512); leafOrCompound(x, y, rr(0, TAU), rr(40, 55), { compound: 'trifol', leafW: 0.5, sh: 'bramble' }, jit([100, 35, 19], 5, 5, 4)); }
  });
  // --- shrubs and ground ---
  tile(UKT.BRAMBLE, () => {
    for (let k = 0; k < 9; k++) {   // arching canes
      const x0 = rr(80, 430); let px = x0, py = 505, a = -PI / 2 + rr(-0.5, 0.5);
      for (let i = 0; i < 26; i++) { const nx = px + Math.cos(a) * 18, ny = py + Math.sin(a) * 18; stem(px, py, nx, ny, 3 - i * 0.08, [340, 30, 24]); px = nx; py = ny; a += (x0 < 256 ? 1 : -1) * 0.07; if (i % 3 === 1) leafOrCompound(px, py, a + (i % 2 ? 1 : -1) * 1.1, rr(70, 90), { compound: 'trifol', leafW: 0.5, sh: 'bramble' }, jit([100, 35, 19], 6, 5, 4)); }
    }
    fan({ depth: 1, step: 26, stemW: 1.8, stemC: [340, 30, 24], branchP: 0.4, leafL: 80, leafW: 0.5, sh: 'bramble', col: [100, 35, 20], perNode: 1, leafP: 0.9, ang: [0.6, 1.2], compound: 'trifol' }, 4, 2.6, 200, 380);
    for (let k = 0; k < 22; k++) { const x = rr(60, 450), y = rr(60, 450); for (let q = 0; q < 8; q++) { g.fillStyle = q < 5 ? hsl(300, 30, 9) : hsl(355, 60, 30); g.beginPath(); g.arc(x + rr(-4, 4), y + rr(-4, 4), 2.6, 0, TAU); g.fill(); } }
  });
  tile(UKT.IVY, () => {
    for (let k = 0; k < 16; k++) { const x0 = rr(30, 480); shoot(x0, 505, -PI / 2 + rr(-0.9, 0.9), rr(250, 480), 1, { depth: 1, step: 22, stemW: 1.4, stemC: [30, 25, 22], branchP: 0.35, leafL: 44, leafW: 0.62, sh: 'ivy', col: [108, 34, 14], perNode: 1, leafP: 0.95, ang: [0.7, 1.5], gloss: 1, wig: 1.6 }); }
  });
  tile(UKT.FERN, () => {
    const n = 30; let px = 256, py = 506;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = 256 + Math.sin(t * 2.2) * 10, y = 506 - t * 494;
      if (i) stem(px, py, x, y, 3 * (1 - t) + 1, [80, 30, 22]); px = x; py = y;
      if (i < 2) continue;
      const L = 175 * Math.pow(Math.sin(Math.min(1, 0.1 + t * 0.95) * PI), 0.7) * (1 - t * 0.45) * rr(0.9, 1.05);
      for (let s = -1; s <= 1; s += 2) {
        const a = -PI / 2 + s * (1.35 - t * 0.3), m = Math.max(4, Math.round(L / 10));
        for (let q = 1; q <= m; q++) { const u = q / m, qx = x + Math.cos(a) * L * u, qy = y + Math.sin(a) * L * u, l2 = 15 * (1 - u * 0.7) + 3; leaf(qx, qy, a + 1.2, l2, l2 * 0.36, jit([92, 45, 27], 5, 4, 4), 'ell'); leaf(qx, qy, a - 1.2, l2, l2 * 0.36, jit([92, 45, 27], 5, 4, 4), 'ell'); }
        stem(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 1.3, [85, 30, 22]);
      }
    }
  });
  // marram: rolled, wiry, grey-green blades bleached to straw at the tips (a pale tussock, never a dark clump)
  tile(UKT.MARRAM, () => {
    blades(170, 70, 200, 2.5, 4.5, [72, 22, 46], 0.35, [48, 30, 62], 30);
    blades(150, 180, 360, 2.2, 4, [70, 20, 50], 0.4, [46, 32, 66], 70);
    blades(60, 320, 490, 2, 3.5, [68, 18, 54], 0.5, [45, 30, 70], 100);
    for (let k = 0; k < 8; k++) { const x = rr(60, 450), y = rr(40, 120); g.strokeStyle = hsl(45, 25, 55); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 140); g.lineTo(x + rr(-6, 6), y); g.stroke(); g.fillStyle = hsl(44, 28, 58); g.beginPath(); g.ellipse(x, y + 20, 4, 24, 0, 0, TAU); g.fill(); }
  });
  tile(UKT.GRASS, () => {
    blades(160, 60, 190, 3.5, 6, [85, 38, 24], 0.12, [52, 34, 40], 25);
    blades(110, 160, 330, 3.5, 6, [82, 36, 28], 0.2, [50, 34, 46], 60);
    blades(40, 300, 470, 2.5, 4.5, [78, 32, 32], 0.3, [48, 32, 52], 90);
    for (let k = 0; k < 10; k++) { const x = rr(50, 460), y = rr(40, 140); g.strokeStyle = hsl(50, 30, 40); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y + 200); g.lineTo(x, y); g.stroke(); for (let q = 0; q < 8; q++) { g.fillStyle = hsl(50 + rr(-8, 8), 32, 40 + rr(-4, 6)); g.beginPath(); g.ellipse(x + rr(-6, 6), y + q * 6, 2, 5, rr(-0.6, 0.6), 0, TAU); g.fill(); } }
  });
  tile(UKT.LAUREL, () => fan({ depth: 1, step: 30, stemW: 2, stemC: [90, 25, 25], branchP: 0.5, leafL: 95, leafW: 0.36, sh: 'ell', col: [110, 40, 17], perNode: 2, leafP: 0.9, ang: [0.5, 1.1], gloss: 1 }, 6, 2.6, 300, 450));
  tile(UKT.ESCALLONIA, () => {
    fan({ depth: 1, step: 8, stemW: 1.1, stemC: [20, 25, 22], branchP: 0.65, leafL: 18, leafW: 0.42, sh: 'ell', col: [110, 40, 18], perNode: 2, leafP: 0.9, ang: [0.6, 1.2], gloss: 0.9, droop: 0.4 }, 6, 2.6, 300, 450);
    for (let k = 0; k < 22; k++) { const x = rr(60, 450), y = rr(40, 420); for (let q = 0; q < 8; q++) { g.fillStyle = hsl(335 + rr(-8, 8), 55, rr(48, 62)); g.beginPath(); g.arc(x + rr(-8, 8), y + rr(-8, 8), 3.2, 0, TAU); g.fill(); } }
  });
  tile(UKT.LEYLAND, () => {
    for (let k = 0; k < 12; k++) { const u = (k + rr(0.1, 0.9)) / 12 - 0.5; shoot(256 + u * 80, 505, -PI / 2 + u * 2.2, rr(320, 460) * (1 - Math.abs(u) * 0.6), 2, { depth: 2, step: 7, stemW: 2.4, stemC: [115, 35, 17], branchP: 0.75, leafL: 5, leafW: 0.5, sh: 'ell', col: [115, 36, 19], perNode: 1, leafP: 0.3, ang: [0.6, 1], tip: false }); }
  });
  tile(UKT.HYDRANGEA, () => {
    fan({ depth: 1, step: 30, stemW: 2, stemC: [40, 20, 30], branchP: 0.45, leafL: 75, leafW: 0.5, sh: 'ell', col: [100, 40, 24], perNode: 2, leafP: 0.85, ang: [0.6, 1.2], opp: true }, 6, 2.6, 260, 420);
    for (let k = 0; k < 11; k++) {
      const x = rr(70, 440), y = rr(60, 330), blue = k % 3 !== 0, R0 = rr(26, 40);
      for (let q = 0; q < 70; q++) { const a = rr(0, TAU), r = R0 * Math.sqrt(rnd()); g.fillStyle = blue ? hsl(225 + rr(-15, 15), 45, rr(52, 68)) : hsl(330 + rr(-10, 10), 50, rr(58, 70)); g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, 4.2, 0, TAU); g.fill(); }
    }
  });
  // dead leaves and twigs (the floor of the wood under the ivy)
  tile(UKT.DEADLEAF, () => {
    g.fillStyle = hsl(28, 30, 12); g.fillRect(0, 0, TS, TS);
    for (let k = 0; k < 2400; k++) leaf(rr(-10, 522), rr(-10, 522), rr(0, TAU), rr(16, 30), rr(6, 11), jit([30, 38, 22], 10, 10, 8), rnd() < 0.5 ? 'oak' : 'beech');
  });
  const t1 = performance.now(), tex = ukAtlasFinish(g, W, H); UKV.time.atlasPaint = t1 - t0; UKV.time.atlasMips = performance.now() - t1;
  return tex;
}
// pixels → linear premultiplied colour, colour bled into the transparent areas, mips that keep the alpha coverage, a
// smoothed alpha at level 0 (as vegAtlasBuild in 33_veg_a_atlas.js)
function ukAtlasFinish(g, W, H) {
  const img = g.getImageData(0, 0, W, H).data, cur = new Float32Array(W * H * 4);
  const s2l = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; s2l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const l2s = v => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  for (let i = 0; i < W * H; i++) { const a = img[i * 4 + 3] / 255; cur[i * 4] = s2l[img[i * 4]] * a; cur[i * 4 + 1] = s2l[img[i * 4 + 1]] * a; cur[i * 4 + 2] = s2l[img[i * 4 + 2]] * a; cur[i * 4 + 3] = a; }
  const levels = Math.log2(UK_TS) + 1 - 2;
  const tex = G.dev.createTexture({ size: [W, H], format: 'rgba8unorm-srgb', usage: TU.TB | TU.CD, mipLevelCount: levels });
  const coverage = (buf, w, h, scale) => { let c = 0; for (let i = 0; i < w * h; i++) if (buf[i * 4 + 3] * scale >= 0.5) c++; return c / (w * h); };
  const cov0 = coverage(cur, W, H, 1);
  const pyr = [{ d: cur, w: W, h: H }];
  while (pyr[pyr.length - 1].h > 1) {
    const s0 = pyr[pyr.length - 1], nw = s0.w >> 1, nh = s0.h >> 1, nx = new Float32Array(nw * nh * 4), c0 = s0.d, w0 = s0.w;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const o = (y * nw + x) * 4, a = (y * 2 * w0 + x * 2) * 4, b = a + 4, c = a + w0 * 4, d = c + 4;
      for (let k = 0; k < 4; k++) nx[o + k] = (c0[a + k] + c0[b + k] + c0[c + k] + c0[d + k]) * 0.25;
    }
    pyr.push({ d: nx, w: nw, h: nh });
  }
  const fillc = new Array(pyr.length);
  for (let m = pyr.length - 1; m >= 0; m--) {
    const s0 = pyr[m], n = s0.w * s0.h, f = new Float32Array(n * 3), up = m < pyr.length - 1 ? fillc[m + 1] : null, uw = up ? pyr[m + 1].w : 0, uh = up ? pyr[m + 1].h : 0;
    for (let y = 0; y < s0.h; y++) for (let x = 0; x < s0.w; x++) {
      const i = y * s0.w + x, a = s0.d[i * 4 + 3];
      let r = 0.05, g2 = 0.09, b = 0.03;
      if (up) { const q = (Math.min(uh - 1, y >> 1) * uw + Math.min(uw - 1, x >> 1)) * 3; r = up[q]; g2 = up[q + 1]; b = up[q + 2]; }
      if (a > 1e-3) { const k = Math.min(1, a * 4); r = r + (Math.min(1, s0.d[i * 4] / a) - r) * k; g2 = g2 + (Math.min(1, s0.d[i * 4 + 1] / a) - g2) * k; b = b + (Math.min(1, s0.d[i * 4 + 2] / a) - b) * k; }
      f[i * 3] = r; f[i * 3 + 1] = g2; f[i * 3 + 2] = b;
    }
    fillc[m] = f;
  }
  const a0 = new Float32Array(W * H), a1 = new Float32Array(W * H), KB = [0.0625, 0.25, 0.375, 0.25, 0.0625];
  for (let i = 0; i < W * H; i++) a0[i] = cur[i * 4 + 3];
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -2; k <= 2; k++) { const xx = x + k < 0 ? 0 : x + k >= W ? W - 1 : x + k; v += a0[y * W + xx] * KB[k + 2]; } a1[y * W + x] = v; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -2; k <= 2; k++) { const yy = y + k < 0 ? 0 : y + k >= H ? H - 1 : y + k; v += a1[yy * W + x] * KB[k + 2]; } a0[y * W + x] = v; }
  }
  for (let m = 0; m < levels; m++) {
    const s0 = pyr[m], w = s0.w, h = s0.h, c0 = s0.d, f = fillc[m]; let scale = 1;
    if (m > 0) { let lo = 0.5, hi = 6; for (let it = 0; it < 12; it++) { scale = (lo + hi) / 2; if (coverage(c0, w, h, scale) < cov0) lo = scale; else hi = scale; } }
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { out[i * 4] = l2s(f[i * 3]); out[i * 4 + 1] = l2s(f[i * 3 + 1]); out[i * 4 + 2] = l2s(f[i * 3 + 2]); out[i * 4 + 3] = Math.round(255 * Math.min(1, (m === 0 ? a0[i] : c0[i * 4 + 3]) * scale)); }
    G.dev.queue.writeTexture({ texture: tex, mipLevel: m }, out, { bytesPerRow: w * 4 }, [w, h]);
  }
  return tex;
}

// ---------------------------------------------------------------------------------------------------- tree builder
// A crown envelope (the species' outline, with lumps), a trunk (or several stems), limbs that grow out to the envelope,
// branches along them, and clumps of foliage cards at the branch ends near the envelope's surface (leaves grow where the
// light is). Every card gets a ring of single leaves for the near layer. P (all lengths in metres):
//   H height; cb crown base (fraction of H); cr crown radius; shape 'ovoid' | 'dome' | 'round' | 'column' | 'cone' |
//   'flat' (Scots pine) | 'umbrella' | 'lean' (wind-cut: low and swept to +x); lumps / lumpA the envelope's lumps;
//   r0 trunk radius at the foot; flare; lean; wob; leader (how far up the trunk runs, fraction of H); bark (UKB);
//   bc bark colour, bcTop (colour up the stem, with the bark variant: Scots pine's orange); nStem stems from the ground;
//   stemEl stem elevation (deg); nB limbs; el [elevation at the crown base, at the top] (deg); bCurve upward bend;
//   bSin tortuosity; whorl limbs per whorl (pines); nSub branches per limb; subLen; subEl; droop (hanging branch ends);
//   tiles atlas tiles; card size; aspect; cpc cards per clump; clumpR; leaf: { t UKL, L, asp, n per card, droop,
//   comp 'pinnate' | 'palmate' | 'needles' } (leaflets are single leaves of the near layer too); flutter.
function ukTree(P, seed, ai) {
  const mb = new MeshBuilder(8192), LB = new UKLeafBuf(); mb.leaves = LB;
  const rnd = mkRng(seed), rr = (a, b) => a + (b - a) * rnd(), rl = mkRng(seed * 7 + 3), rq = (a, b) => a + (b - a) * rl();
  const H = P.H, y0 = P.cb * H, CR = P.cr, la = P.leanAz !== undefined ? P.leanAz : rr(0, TAU), up = [0, 1, 0];
  // crown axis follows the lean of the trunk; the 'lean' shape sweeps the crown to +x (prevailing wind from -x)
  const lx = Math.cos(la) * P.lean * H, lz = Math.sin(la) * P.lean * H;
  const axis = y => { const t = sat(y / H); return [lx * t * t, lz * t * t]; };
  const lumps = [], lA = P.lumpA || 0.18; for (let k = 0; k < (P.lumps || 7); k++) lumps.push([rr(0, TAU), rr(0.1, 0.95), rr(0.3, 1) * lA * 1.6, rr(0.45, 0.85)]);
  const prof = t => {
    switch (P.shape) {
      case 'dome': return t < 0.3 ? lerp(0.62, 1, Math.sqrt(t / 0.3)) : Math.pow(sat(1 - Math.pow((t - 0.3) / 0.7, 2)), 0.5);
      case 'round': return Math.pow(Math.sin(PI * lerp(0.08, 1, t)), 0.55);
      case 'column': return t < 0.75 ? lerp(0.7, 1, sat(t / 0.35)) : Math.pow(sat(1 - Math.pow((t - 0.75) / 0.25, 2)), 0.6);
      case 'cone': return Math.pow(1 - t, 0.85) * lerp(0.8, 1, sat(t * 5)) + 0.04;
      case 'flat': return t < 0.65 ? lerp(0.45, 1, Math.pow(t / 0.65, 0.7)) : Math.pow(sat(1 - Math.pow((t - 0.65) / 0.35, 2)), 0.35);
      case 'umbrella': return t < 0.55 ? lerp(0.55, 1, Math.pow(t / 0.55, 0.6)) : Math.pow(sat(1 - Math.pow((t - 0.55) / 0.45, 2)), 0.45);
      case 'lean': return Math.pow(Math.sin(PI * lerp(0.05, 1, t)), 0.5);
      default: return Math.pow(Math.sin(PI * lerp(0.04, 1, Math.pow(t, 0.75))), 0.62);   // ovoid
    }
  };
  // envelope radius at height y and azimuth az (+ the wind-cut swept side: 'lean' shifts the crown to +x)
  const envR = (y, az) => {
    const t = (y - y0) / (H - y0); if (t < 0 || t > 1) return 0;
    let k = 1 - lA * 0.75; for (const L of lumps) { let da = Math.abs(az - L[0]); da = Math.min(da, TAU - da); const dt = t - L[1]; k += L[2] * Math.exp(-(da * da) / (L[3] * L[3]) - dt * dt * 12); }
    if (P.shape === 'lean') k *= 1 + 0.8 * Math.cos(az) - 0.25 * t;   // leeward side long, windward side clipped
    return CR * prof(t) * Math.max(0.35, k);
  };
  const rel = p => { const a = axis(p[1]); return [p[0] - a[0], p[2] - a[1]]; };
  const inside = p => { const q = rel(p), r = Math.hypot(q[0], q[1]); return r < envR(p[1], Math.atan2(q[1], q[0])); };
  // depth of a point in the crown: 0 on the axis → 1 on the envelope; and the outward normal of the envelope there
  const depthIn = p => { const q = rel(p), r = Math.hypot(q[0], q[1]), R = envR(p[1], Math.atan2(q[1], q[0])) || 0.01; return r / R; };
  const outN = p => { const q = rel(p), r = Math.hypot(q[0], q[1]) || 1e-3, t = sat((p[1] - y0) / (H - y0)); return _vn([q[0] / r, (t - 0.45) * 1.6 + (P.shape === 'flat' || P.shape === 'umbrella' ? 0.6 : 0), q[1] / r]); };
  const rayLen = (p, d, max) => { let t = 0.3; while (t < max) { if (!inside([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t])) break; t += 0.25; } return t; };
  const bc = P.bc, bct = P.bcTop || bc;
  // --- trunk(s) ---
  const nT = P.trunkSeg || 10, stems = [], nStem = P.nStem || 1, top = H * (P.leader || 0.6);
  const tR = (t, r0) => r0 * (1 + (P.flare === undefined ? 0.35 : P.flare) * Math.exp(-t * top / (r0 * 1.8))) * Math.pow(Math.max(0.03, 1 - t * 0.82), 0.85) + 0.02;
  for (let si = 0; si < nStem; si++) {
    const az = si * 2.39996 + rr(-0.4, 0.4) + la, el = nStem > 1 ? (P.stemEl || 70) * PI / 180 + rr(-0.12, 0.12) : PI / 2, r0 = P.r0 * (nStem > 1 ? rr(0.7, 1.1) : 1);
    const len = top / Math.sin(el) * (nStem > 1 ? rr(0.75, 1) : 1), pts = [];
    for (let i = 0; i <= nT; i++) {
      const t = i / nT, h = len * t;
      pts.push([Math.cos(az) * Math.cos(el) * h + (nStem === 1 ? lx * t * t * (top / H) * (top / H) : 0) + Math.sin(t * 4.3 + seed + si) * P.wob * t, Math.sin(el) * h, Math.sin(az) * Math.cos(el) * h + (nStem === 1 ? lz * t * t * (top / H) * (top / H) : 0) + Math.cos(t * 3.7 + seed * 1.3 + si) * P.wob * t]);
    }
    // the trunk's colour and bark variant change up the stem (Scots pine's orange; birch's black, fissured foot)
    const vr = i => P.bark === UKB.SCOTS ? smooth(0.3, 0.6, pts[i][1] / H) : P.bark === UKB.BIRCH ? 1 - smooth(0.4, 3.5, pts[i][1]) : 0;
    ukTube(mb, pts, i => tR(i / nT, r0), P.trunkRad || 9, 0, 0.12, P.bark, 0, ai, i => { const k = vr(i); return [lerp(bc[0], bct[0], k), lerp(bc[1], bct[1], k), lerp(bc[2], bct[2], k)]; }, i => Math.round(vr(i) * 255));
    stems.push({ pts, r0, len });
    // ivy climbing the trunk: single leaves on the bark up to ~10 m. Every tree of the species carries them; the leaf
    // shader keeps them only on the trees whose seed gives them ivy, up to that tree's ivy height (as the bark's ivy)
    const nIvy = si === 0 ? (P.ivy || 0) : 0;
    for (let e = 0; e < nIvy; e++) {
      const hy = Math.min(top * 0.95, 10.5) * Math.pow(rl(), 1.35), t = hy / (len * Math.sin(el) || 1), i0 = Math.min(nT - 1, Math.floor(t * nT)), fu = t * nT - i0;
      const c = [lerp(pts[i0][0], pts[i0 + 1][0], fu), lerp(pts[i0][1], pts[i0 + 1][1], fu), lerp(pts[i0][2], pts[i0 + 1][2], fu)], a = rq(0, TAU), rad = tR(t, r0) + rq(0.015, 0.07);
      const out = [Math.cos(a), 0, Math.sin(a)], b = [c[0] + out[0] * rad, c[1], c[2] + out[2] * rad];
      let ax = _vn([out[0] * 0.35 + rq(-0.6, 0.6), rq(-0.2, 1), out[2] * 0.35 + rq(-0.6, 0.6)]), nl = _vn([out[0] + rq(-0.4, 0.4), rq(-0.2, 0.5), out[2] + rq(-0.4, 0.4)]);
      const sd = _vn(_vx(ax, nl)); nl = _vx(sd, ax); const ll = rq(0.05, 0.085);
      LB.add(b, ax, sd, nl, ll, ll * 0.48, 0.05, Math.floor(rl() * 255), rq(0.45, 0.8), [rq(0.5, 0.62), rq(0.62, 0.74), rq(0.52, 0.62)], UKL.IVY);
    }
  }
  const stemAt = (s, t) => { const f = sat(t) * nT, i = Math.min(nT - 1, Math.floor(f)), u = f - i, p = s.pts; return [lerp(p[i][0], p[i + 1][0], u), lerp(p[i][1], p[i + 1][1], u), lerp(p[i][2], p[i + 1][2], u)]; };
  // --- foliage clumps ---
  const C = { tint: [1, 1, 1] };
  let BT = [1, 1, 1];
  const newBT = () => { const y = rnd(); BT = y < 0.15 ? [1.1, 1.06, 0.88] : y > 0.87 ? [0.86, 0.9, 0.9] : [rr(0.95, 1.05), rr(0.96, 1.04), rr(0.9, 1.0)]; };
  const Lf = P.leaf || {};
  // card centres in a hash grid: the fill pass closes the crown's surface where the branch ends left it open
  const gS = P.card * 0.9, grid = new Map(), gk = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  const addPt = p => { const k = gk(Math.floor(p[0] / gS), Math.floor(p[1] / gS), Math.floor(p[2] / gS)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(p); };
  const nearPt = (p, r) => {
    const ci = Math.floor(p[0] / gS), cj = Math.floor(p[1] / gS), ck = Math.floor(p[2] / gS);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const a = grid.get(gk(ci + i, cj + j, ck + k)); if (a) for (const q of a) if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < r) return true; }
    return false;
  };
  const clump = (c, d, n, w, sz) => {
    for (let q = 0; q < n; q++) {
      const sp = P.spread || 0.9, cr = (P.clumpR || 0.5) * sz;
      const o = [c[0] + rr(-cr, cr), c[1] + rr(-cr, cr) * 0.7, c[2] + rr(-cr, cr)]; addPt(o);
      const on = outN(o), hang = P.hang || 0;
      // the card's plane lies roughly along the crown's surface (its face turned outwards, where the crown is seen
      // from), along the branch, tipped up and out by a random angle; birch's hang down
      let td = [d[0] + rr(-sp, sp), d[1] + rr(-sp * 0.5, sp) + 0.25 - hang * 1.6, d[2] + rr(-sp, sp)];
      if (P.flatCards) { on[0] *= 0.35; on[2] *= 0.35; on[1] = 1; const l = Math.hypot(on[0], on[1], on[2]); on[0] /= l; on[1] /= l; on[2] /= l; }
      const dn = td[0] * on[0] + td[1] * on[1] + td[2] * on[2], tilt = rr(0.15, 0.75);
      let dir = _vn([td[0] - on[0] * dn + on[0] * tilt, td[1] - on[1] * dn + on[1] * tilt, td[2] - on[2] * dn + on[2] * tilt]);
      const roll = rr(-0.45, 0.45), sx = _vn(_vx(dir, on));
      let side = _vn([sx[0] + on[0] * roll, sx[1] + on[1] * roll, sx[2] + on[2] * roll]);
      const L = sz * rr(0.75, 1.25), cj = rr(0.94, 1.06); C.tint = [BT[0] * cj, BT[1] * cj, BT[2] * rr(0.95, 1.04)];
      const cb = [o[0] - dir[0] * L * 0.15, o[1] - dir[1] * L * 0.15, o[2] - dir[2] * L * 0.15];
      const tl = P.tiles[Math.floor(rnd() * P.tiles.length)];
      ukCard(mb, cb, dir, side, L, L * (P.aspect || 0.95), tl, depthIn, outN, H, C, w, rnd, q % 3 === 0 ? (P.droop || 0) : (P.droop || 0) * 0.3, q % 3 === 0 ? 2 : 1, ai);
      // single leaves round the card, more towards its end and the outside of the crown
      const cn = _vn(_vx(side, dir)), nL = Lf.n || 0, Wd = L * (P.aspect || 0.95);
      for (let e = 0; e < nL; e++) {
        const t = rq(0.12, 1.06), lt = rq(-0.55, 0.55), no = rq(-0.22, 0.22) * L;
        const lb = [cb[0] + dir[0] * L * t + side[0] * Wd * lt + cn[0] * no, cb[1] + dir[1] * L * t + side[1] * Wd * lt + cn[1] * no, cb[2] + dir[2] * L * t + side[2] * Wd * lt + cn[2] * no];
        const dd = depthIn(lb), ao = (0.3 + 0.7 * Math.pow(sat(dd), 1.7)) * (0.72 + 0.28 * sat(lb[1] / H));
        if (ao < 0.42 && rl() < 0.75) continue;
        const out = outN(lb);
        let ax = _vn([dir[0] * 0.45 + out[0] * 0.55 + rq(-0.7, 0.7), dir[1] * 0.3 + out[1] * 0.3 + rq(-0.55, 0.45) - (Lf.droop || 0.25), dir[2] * 0.45 + out[2] * 0.55 + rq(-0.7, 0.7)]);
        let nl = _vn([out[0] * 0.5 + rq(-0.5, 0.5), 0.8 + out[1] * 0.3 + rq(-0.3, 0.3), out[2] * 0.5 + rq(-0.5, 0.5)]);
        const sd = _vn(_vx(ax, nl)); nl = _vx(sd, ax);
        const ll = Lf.L * rq(0.75, 1.22), lj = rq(0.92, 1.08), tn = [C.tint[0] * lj * Lf.col[0], C.tint[1] * lj * Lf.col[1], C.tint[2] * rq(0.93, 1.06) * Lf.col[2]];
        ukLeaf(LB, lb, ax, sd, nl, ll, Lf, Math.min(1, w + 0.1), Math.floor(rl() * 255), ao, tn, rq);
      }
    }
  };
  // --- limbs and branches ---
  const nB = P.nB, ends = [];
  for (let k = 0; k < nB; k++) {
    const s = stems[k % nStem], u = (k + rr(0.15, 0.85)) / nB;
    let t, az;
    if (P.whorl) { const nw = Math.ceil(nB / P.whorl), wi = Math.floor(k / P.whorl); t = lerp(Math.max(0.05, (y0 - 0.5) / top), 0.97, (wi + rr(0, 0.25)) / nw); az = (k % P.whorl) * TAU / P.whorl + wi * 1.1 + rr(-0.35, 0.35); }
    else { t = lerp(Math.max(0.04, (y0 - 0.6) / top), 0.98, Math.pow(u, P.bPow || 0.85)); az = k * 2.39996 + rr(-0.3, 0.3); }
    const p0 = stemAt(s, t), hu = sat((p0[1] - y0) / (H - y0 + 1e-3));
    const el = (lerp(P.el[0], P.el[1], Math.max(u, hu)) + rr(-8, 8)) * PI / 180;
    let d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    if (P.shape === 'lean') d = _vn([d[0] + 0.6, d[1] - 0.15, d[2] * 0.8]);
    const L = Math.max(0.6, rayLen(p0, d, CR * 2.4 + H) * rr(0.78, 0.97) * (P.limbK || 1));
    const nS = 5, pts = [p0], dirs = [d]; let p = p0;
    for (let j = 0; j < nS; j++) {
      p = [p[0] + d[0] * L / nS, p[1] + d[1] * L / nS, p[2] + d[2] * L / nS]; pts.push(p);
      const bend = (P.bCurve || 0) * 0.2 + (P.sag ? -P.sag * (j < 2 ? 0.25 : -0.3) : 0);
      d = _vn([d[0] + rr(-0.12, 0.12) * (P.bSin || 1), d[1] + bend + rr(-0.08, 0.08) * (P.bSin || 1), d[2] + rr(-0.12, 0.12) * (P.bSin || 1)]); dirs.push(d);
    }
    const ts = stems.indexOf(s), r0 = Math.min(tR(t, s.r0) * (P.limbR || 0.62), 0.025 + L * 0.024);
    ukTube(mb, pts, i => lerp(r0, 0.03, Math.pow(i / nS, 0.8)), P.brRad || 6, 0.12, 0.9, P.bark, k + ts, ai, () => bct, () => P.bark === UKB.SCOTS ? 255 : 0);
    newBT(); clump(p, d, P.cpc + 2, 0.9, P.card);
    ends.push(p);
    for (let sb = 0; sb < P.nSub; sb++) {
      const f = 0.25 + 0.7 * (sb + rr(0.1, 0.9)) / P.nSub, fi = f * nS, i0 = Math.min(nS - 1, Math.floor(fi)), fu = fi - i0;
      const o = [lerp(pts[i0][0], pts[i0 + 1][0], fu), lerp(pts[i0][1], pts[i0 + 1][1], fu), lerp(pts[i0][2], pts[i0 + 1][2], fu)], bd = dirs[i0];
      const perp = _vn(_vx(bd, up)), sg = sb % 2 ? 1 : -1;
      let sd = _vn([bd[0] * 0.5 + perp[0] * sg * rr(0.6, 1.0), bd[1] * 0.5 + rr(-0.15, 0.5) + (P.subEl || 0), bd[2] * 0.5 + perp[2] * sg * rr(0.6, 1.0)]);
      const sl = Math.max(0.4, Math.min(rayLen(o, sd, CR * 2) * rr(0.75, 1.0), L * (P.subLen || 0.5) * (1.1 - f * 0.4)));
      const e1 = [o[0] + sd[0] * sl * 0.5, o[1] + sd[1] * sl * 0.5, o[2] + sd[2] * sl * 0.5];
      sd = _vn([sd[0], sd[1] + (P.bCurve || 0) * 0.2 - (P.droop || 0) * 0.5, sd[2]]);
      const e2 = [e1[0] + sd[0] * sl * 0.5, e1[1] + sd[1] * sl * 0.5, e1[2] + sd[2] * sl * 0.5];
      const rs = lerp(r0, 0.03, f) * 0.55;
      ukTube(mb, [o, e1, e2], i => lerp(rs, 0.015, i / 2), 4, 0.12 + 0.78 * f, 1, P.bark, sb, ai, () => bct, () => P.bark === UKB.SCOTS ? 255 : 0);
      clump(e2, sd, P.cpc, 0.95, P.card * 0.92);
      if (P.midCards) clump(e1, sd, P.midCards, 0.8, P.card * 0.8);
      ends.push(e2);
    }
  }
  // fill: stratified points over the envelope (more where it is wide); wherever no card is near, a clump on a short twig
  // (a crown seen from outside is a closed surface; P.gap > 1 leaves the airy species - ash, birch, pines - open)
  const want = P.fill || 0, gap = gS * (P.gap || 1); let added = 0;
  for (let k = 1; k < want * 14 && added < want; k++) {
    const t = halton(k, 2), az = halton(k, 3) * TAU + seed, y = lerp(y0, H, 0.02 + 0.96 * t), R0 = envR(y, az);
    if (R0 < 0.25 || rnd() > R0 / CR + 0.15) continue;
    const R = R0 * rr(0.8, 0.96), a = axis(y), p = [a[0] + Math.cos(az) * R, y, a[1] + Math.sin(az) * R];
    if (nearPt(p, gap)) continue;
    // holes: patches of the shell left open (sky through the crown, the outline broken into masses)
    if (P.holes && vnoise(az * 1.6 + seed, t * 4.2 - seed * 0.3) < P.holes) continue;
    const on = outN(p), tl = Math.min(1.4, R * 0.3), tb = [p[0] - on[0] * tl, p[1] - on[1] * tl * 0.5 - 0.15, p[2] - on[2] * tl];
    ukTube(mb, [tb, [lerp(tb[0], p[0], 0.5), lerp(tb[1], p[1], 0.5) + 0.06, lerp(tb[2], p[2], 0.5)], p], i => lerp(0.035, 0.012, i / 2), 3, 0.5, 0.9, P.bark, k, ai, () => bct, () => P.bark === UKB.SCOTS ? 255 : 0);
    newBT(); clump(p, on, 2 + (k & 1), 0.85, P.card); added++;
  }
  // (diagnostic: share of the envelope's surface with a card within reach)
  let cov = 0; for (let k = 1; k <= 400; k++) { const t = halton(k, 2), az = halton(k, 3) * TAU, y = lerp(y0, H, 0.02 + 0.96 * t), R = envR(y, az) * 0.88, a = axis(y); if (nearPt([a[0] + Math.cos(az) * R, y, a[1] + Math.sin(az) * R], gS * 1.2)) cov++; }
  mb.shell = cov / 400; mb.fillN = added;
  return mb;
}
// tube along points; rad(i) radius at point i; sway weights w0 → w1; colour per point; bark variant per point
function ukTube(mb, pts, rad, seg, w0, w1, barkType, ph, ai, colAt, varAt) {
  const n = pts.length, base = mb.nv; let len = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], t = _vn([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const ref = Math.abs(t[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0], s = _vn(_vx(t, ref)), u = _vx(s, t), r = rad(i), p = pts[i];
    if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
    const c = colAt(i); mb.color(c[0], c[1], c[2], i === 0 ? 0.75 : 0.9);
    mb.weight(w0 + (w1 - w0) * i / (n - 1)); mb.mat(0, ai, barkType, varAt(i));
    const lob = barkType === UKB.OAK || barkType === UKB.HAWTHORN ? 0.07 : barkType === UKB.BEECH || barkType === UKB.HOLLY ? 0.025 : 0.04, phs = (ph || 0) * 1.7;
    for (let k = 0; k <= seg; k++) {
      const an = k / seg * TAU, cc = Math.cos(an), sn = Math.sin(an), nx = s[0] * cc + u[0] * sn, ny = s[1] * cc + u[1] * sn, nz = s[2] * cc + u[2] * sn;
      const rk = r * (1 + lob * (Math.sin(an * 3 + phs + len * 0.35) + 0.6 * Math.sin(an * 5 + 1.3 - len * 0.22 + phs)));
      mb.v(p[0] + nx * rk, p[1] + ny * rk, p[2] + nz * rk, nx, ny, nz, k / seg * Math.max(1, Math.round(r * 6)), len);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) { const a = base + i * (seg + 1) + k; mb.quadI(a, a + seg + 1, a + seg + 2, a + 1); }
}
// foliage card with 1-2 segments; AO and normal from the crown envelope (depth → 0 inside, 1 on the surface)
function ukCard(mb, b, dir, side, L, Wd, tile, depthIn, outN, H, C, w, rnd, droop, segs, ai) {
  const uv = ukTileUV(tile), nrm = _vn(_vx(side, dir)), ph = Math.floor(rnd() * 255), base = mb.nv;
  for (let j = 0; j <= segs; j++) {
    const t = j / segs, dr = -(droop || 0) * t * t * L;
    const cx = b[0] + dir[0] * L * t, cy = b[1] + dir[1] * L * t + dr, cz = b[2] + dir[2] * L * t;
    for (let k = -1; k <= 1; k += 2) {
      const p = [cx + side[0] * Wd * 0.5 * k, cy + side[1] * Wd * 0.5 * k, cz + side[2] * Wd * 0.5 * k];
      const d = depthIn(p), on = outN(p), ao = (0.3 + 0.7 * Math.pow(sat(d), 1.7)) * (0.72 + 0.28 * sat(p[1] / H)), kc = 0.6 + 0.4 * ao;
      mb.color(C.tint[0] * kc, C.tint[1] * kc, C.tint[2] * kc, ao);
      mb.weight(Math.min(1, w + 0.2 * t)); mb.mat(1, ph, ai, Math.round(lerp(50, 255, t)));
      const fs = (nrm[0] * on[0] + nrm[1] * on[1] + nrm[2] * on[2]) < 0 ? -0.2 : 0.2;
      mb.v(p[0], p[1], p[2], on[0] * (0.4 + 0.6 * d) + nrm[0] * fs, on[1] * (0.4 + 0.6 * d) + 0.35 + nrm[1] * fs, on[2] * (0.4 + 0.6 * d) + nrm[2] * fs, uv[0] + (k > 0 ? uv[2] : 0), uv[1] + uv[3] * (1 - t));
    }
  }
  for (let j = 0; j < segs; j++) { const a = base + j * 2; mb.quadI(a, a + 1, a + 3, a + 2); }
}
// one leaf of the near layer, or a compound leaf (ash: pinnate; horse chestnut: palmate; pines: a tuft of needles)
function ukLeaf(LB, b, ax, sd, nl, L, Lf, sway, ph, ao, tn, rq) {
  const asp = Lf.asp || 0.42;
  if (Lf.comp === 'pinnate') {
    const n = 4; LB.add(b, ax, sd, nl, L * 0.32, L * 0.32 * asp * 0.5, sway, ph, ao, tn, Lf.t);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 0.6), p = [b[0] - ax[0] * L * t, b[1] - ax[1] * L * t, b[2] - ax[2] * L * t];
      for (let s = -1; s <= 1; s += 2) { const a2 = _vn([ax[0] * 0.45 + sd[0] * s, ax[1] * 0.45 + sd[1] * s, ax[2] * 0.45 + sd[2] * s]), s2 = _vn(_vx(a2, nl)); LB.add(p, a2, s2, nl, L * 0.3, L * 0.3 * asp * 0.5, sway, (ph + i * 37) & 255, ao, tn, Lf.t); }
    }
  } else if (Lf.comp === 'palmate') {
    for (let i = 0; i < 7; i++) { const u = i / 6 - 0.5, a2 = _vn([ax[0] * Math.cos(u * 2.6) + sd[0] * Math.sin(u * 2.6), ax[1] * Math.cos(u * 2.6) + sd[1] * Math.sin(u * 2.6), ax[2] * Math.cos(u * 2.6) + sd[2] * Math.sin(u * 2.6)]), s2 = _vn(_vx(a2, nl)), ll = L * (1 - Math.abs(u) * 0.55); LB.add(b, a2, s2, nl, ll, ll * asp * 0.5, sway, (ph + i * 29) & 255, ao, tn, Lf.t); }
  } else if (Lf.comp === 'needles') {
    for (let i = 0; i < 3; i++) { const a2 = _vn([ax[0] + rq(-0.5, 0.5), ax[1] + rq(-0.4, 0.4), ax[2] + rq(-0.5, 0.5)]), s2 = _vn(_vx(a2, nl)); LB.add(b, a2, s2, nl, L, L * asp * 0.5, sway, (ph + i * 53) & 255, ao, tn, Lf.t); }
  } else LB.add(b, ax, sd, nl, L, L * asp * 0.5, sway, ph, ao, tn, Lf.t);
}
// cordyline (cabbage palm): a corky trunk that forks into 2-4 arms, each ending in a ball of sword leaves (single strips
// of geometry from the SWORD tile) with a skirt of dead ones hanging under it
function ukCordyline(seed, ai) {
  const mb = new MeshBuilder(4096), rnd = mkRng(seed), rr = (a, b) => a + (b - a) * rnd(), bc = [0.2, 0.17, 0.13];
  const H0 = rr(1.3, 1.8), la = rr(0, TAU), tp = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; tp.push([Math.cos(la) * 0.25 * t * t, H0 * t, Math.sin(la) * 0.25 * t * t]); }
  ukTube(mb, tp, i => 0.16 * (1 + 0.4 * Math.exp(-i * 1.2)) - 0.03 * i / 6, 8, 0, 0.15, UKB.CORDYLINE, 0, ai, () => bc, () => 0);
  const heads = [], nA = 3;
  for (let a = 0; a < nA; a++) {
    const az = la + a * TAU / nA + rr(-0.4, 0.4), el = rr(0.9, 1.2), L = rr(1.3, 2.2) * (a ? 1 : 1.25);
    const d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], p0 = tp[6], pts = [p0];
    for (let j = 1; j <= 4; j++) { const t = j / 4; pts.push([p0[0] + d[0] * L * t, p0[1] + d[1] * L * t + 0.2 * t, p0[2] + d[2] * L * t]); }
    ukTube(mb, pts, i => lerp(0.12, 0.085, i / 4), 6, 0.15, 0.4, UKB.CORDYLINE, a + 1, ai, () => bc, () => 0);
    heads.push(pts[4]);
  }
  const uvS = ukTileUV(UKT.SWORD);
  for (let h = 0; h < heads.length; h++) {
    const c = heads[h], nL = 170;
    for (let k = 0; k < nL + 34; k++) {
      const dead = k >= nL, u = dead ? rr(0.75, 1) : k / nL, az = k * 2.39996 + rr(-0.2, 0.2);
      // living leaves: erect at the top, spreading round, arching down below; the dead ones hang against the arm
      const el = dead ? rr(-1.45, -1.15) : lerp(1.35, -0.6, Math.pow(u, 0.9)) + rr(-0.15, 0.15), L = dead ? rr(0.6, 0.9) : rr(0.7, 1.0), Wd = 0.042;
      let d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], p = [c[0] + d[0] * 0.06, c[1] - (dead ? 0.15 : 0), c[2] + d[2] * 0.06];
      const col = dead ? 3 : (k % 3), u0 = uvS[0] + uvS[2] * (col + 0.1) / 4, u1 = uvS[0] + uvS[2] * (col + 0.9) / 4, base = mb.nv, ph = Math.floor(rnd() * 255), nS = 3;
      const tint = dead ? [0.75, 0.72, 0.7] : [rr(0.92, 1.08), rr(0.95, 1.05), rr(0.85, 1)];
      for (let j = 0; j <= nS; j++) {
        const t = j / nS, side = _vn(_vx(d, [0, 1, 0])), n = _vn(_vx(side, d)), ao = dead ? 0.45 : lerp(0.5, 1, t) * (0.75 + 0.25 * sat(el + 0.5));
        for (let q = -1; q <= 1; q += 2) {
          mb.color(tint[0] * (0.7 + 0.3 * ao), tint[1] * (0.7 + 0.3 * ao), tint[2] * (0.7 + 0.3 * ao), ao); mb.weight(0.4 + 0.6 * t); mb.mat(1, ph, ai, Math.round(lerp(40, 255, t)));
          mb.v(p[0] + side[0] * Wd * q, p[1] + side[1] * Wd * q, p[2] + side[2] * Wd * q, n[0] * 0.6 + side[0] * q * 0.3, Math.abs(n[1]) * 0.6 + 0.4, n[2] * 0.6 + side[2] * q * 0.3, q < 0 ? u0 : u1, uvS[1] + uvS[3] * (1 - t * 0.98));
        }
        p = [p[0] + d[0] * L / nS, p[1] + d[1] * L / nS, p[2] + d[2] * L / nS]; d = _vn([d[0], d[1] - (dead ? 0 : 0.18 + 0.1 * j * (1 - sat(el))), d[2]]);
      }
      for (let j = 0; j < nS; j++) { const a = base + j * 2; mb.quadI(a, a + 1, a + 3, a + 2); }
    }
  }
  return mb;
}
// hedge module: a clipped (or, for hedgerows, a rough) block L long (local x), Wd deep, Hh high; it is planted end to end
// along a polyline. Faces of the opaque leaf mat (F_* tile) made of slightly bulging cards, sprigs breaking the outline,
// a few stems at the foot, and single leaves over the faces for the near layer.
function ukHedgeMod(P, seed, ai) {
  const mb = new MeshBuilder(4096), LB = new UKLeafBuf(); mb.leaves = LB;
  const rnd = mkRng(seed), rr = (a, b) => a + (b - a) * rnd(), L = P.L, Wd = P.W, Hh = P.H, rough = P.rough || 0;
  const uvF = ukTileUV(P.face), C = { tint: [1, 1, 1] }, Lf = P.leaf;
  // the shape of the cross-section: clipped → straight sides, a slight batter, a flat top with rounded edges; hedgerow →
  // wide, domed, lumpy
  const halfW = y => { const t = sat(y / Hh); return rough ? Wd * 0.5 * (1.05 - 0.35 * t * t) : Wd * 0.5 * (1.0 - 0.1 * t); };
  const bulgeAt = (u, v, f) => (rough ? 0.18 : 0.05) * Math.sin(u * 5.1 + seed + f) * Math.cos(v * 4.3 + f * 1.7) + (rough ? 0.08 : 0.02) * Math.sin(u * 13.7 - v * 9.1 + f);
  const face = (pts, nrm, du, dv, nu, nv, f) => {   // overlapping cards over a face: pts(u, v) → position, nrm(u, v) → normal
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const base = mb.nv, ph = Math.floor(rnd() * 255), tj = rr(0.97, 1.03), cu = (i + 0.5 + rr(-0.15, 0.15)) / nu, cv = (j + 0.5 + rr(-0.15, 0.15)) / nv;
      const ang = rr(0, TAU), ca = Math.cos(ang), sa = Math.sin(ang), hu = 0.78 / nu, hv = 0.78 / nv, tr = 0.48 / (Math.abs(ca) + Math.abs(sa));   // (the turned square stays inside its tile)
      for (let q = 0; q < 4; q++) {
        const qu = (q & 1) * 2 - 1, qv = (q >> 1) * 2 - 1, u = cu + qu * hu, v = sat(cv + qv * hv), p = pts(u, v), n = nrm(u, v), bulge = bulgeAt(u, v, f) + 0.012 * (q & 1);
        const ao = lerp(0.55, 1, sat(p[1] / Hh)) * (rough ? rr(0.85, 1) : 1);
        mb.color(tj * (0.75 + 0.25 * ao), tj * (0.75 + 0.25 * ao), tj * (0.75 + 0.25 * ao), ao); mb.weight(0.08 + 0.12 * sat(p[1] / Hh)); mb.mat(1, ph, ai, 90);
        const tu = 0.5 + tr * (qu * ca - qv * sa), tv = 0.5 + tr * (qu * sa + qv * ca);
        mb.v(p[0] + n[0] * bulge, p[1] + n[1] * bulge, p[2] + n[2] * bulge, n[0], n[1] + 0.15, n[2], uvF[0] + uvF[2] * tu, uvF[1] + uvF[3] * tv);
      }
      mb.quadI(base, base + 1, base + 3, base + 2);
    }
  };
  const nu = Math.max(2, Math.round(L / 0.45)), nvS = Math.max(2, Math.round(Hh / 0.45)), nw = Math.max(1, Math.round(Wd / 0.45));
  for (const s of [1, -1]) face((u, v) => { const y = v * Hh * 0.97; return [(u - 0.5) * L * 1.04, y, s * halfW(y)]; }, () => [0, rough ? 0.25 : 0.06, s], 0, 0, nu, nvS, s);
  face((u, v) => { const z = (v - 0.5) * 2 * halfW(Hh) * 0.98, dome = rough ? 0.3 * (1 - Math.pow(v * 2 - 1, 2)) : 0.05 * (1 - Math.pow(v * 2 - 1, 4)) + 0.04 * Math.sin(u * 4.4 + seed); return [(u - 0.5) * L * 1.04, Hh + dome, z]; }, (u, v) => _vn([0, 1, (v - 0.5) * (rough ? 1.2 : 0.4)]), 0, 0, nu, nw, 3);
  for (const s of [1, -1]) face((u, v) => [s * L * 0.5, v * Hh * 0.95, (u - 0.5) * 2 * halfW(v * Hh) * 0.95], () => [s, 0.1, 0], 0, 0, nw, nvS, 5 + s);
  // sprigs: shoots growing out of the faces since the last clipping (hedgerows: long and many)
  const tiles = P.sprig, nSp = Math.round(L * Hh * (rough ? 7 : 3.2));
  for (let k = 0; k < nSp; k++) {
    const side = rnd(), x = rr(-0.5, 0.5) * L;
    let b, out;
    if (side < 0.3) { const z = rr(-1, 1) * halfW(Hh); b = [x, Hh + (rough ? 0.2 : 0.02), z]; out = _vn([rr(-0.4, 0.4), 1, z / Math.max(0.1, halfW(Hh)) * 0.5]); }
    else { const s = side < 0.65 ? 1 : -1, y = rr(0.1, 0.98) * Hh; b = [x, y, s * (halfW(y) + (rough ? 0.1 : 0.01))]; out = _vn([rr(-0.5, 0.5), rr(-0.1, 0.6), s]); }
    const sz = (P.sprigL || 0.35) * rr(0.7, 1.3), dir = _vn([out[0] + rr(-0.5, 0.5), out[1] + rr(-0.2, 0.5), out[2] + rr(-0.5, 0.5)]), sd = _vn(_vx(dir, _vn([rr(-0.8, 0.8), rr(0.2, 1), rr(-0.8, 0.8)])));
    C.tint = [rr(0.92, 1.08), rr(0.94, 1.06), rr(0.9, 1.04)];
    ukCard(mb, [b[0] - dir[0] * sz * 0.35, b[1] - dir[1] * sz * 0.35, b[2] - dir[2] * sz * 0.35], dir, sd, sz, sz * 0.9, tiles[Math.floor(rnd() * tiles.length)], () => 0.95, () => out, Hh, C, 0.5, rnd, 0.1, 1, ai);
  }
  // stems at the foot (old clipped privet shows its bare trunks under the face)
  for (let k = 0; k < Math.round(L * 2.5); k++) {
    const x = rr(-0.45, 0.45) * L, z = rr(-0.3, 0.3) * Wd, h = rr(0.3, 0.6) * Hh, pts = [[x, -0.05, z], [x + rr(-0.1, 0.1), h * 0.5, z + rr(-0.1, 0.1)], [x + rr(-0.15, 0.15), h, z + rr(-0.15, 0.15)]];
    ukTube(mb, pts, i => lerp(0.035, 0.015, i / 2), 4, 0, 0.1, UKB.SHRUB, k, ai, () => [0.13, 0.11, 0.09], () => 0);
  }
  // single leaves over the faces (they stand off the face a little: a clipped hedge is a fuzz of leaves, not a wall)
  const nL = Math.round((2 * L * Hh + L * Wd) * (P.leafDens || 260));
  for (let e = 0; e < nL; e++) {
    const r = rnd(), x = rr(-0.5, 0.5) * L;
    let b, n;
    if (r < 0.25) { const z = rr(-1, 1) * halfW(Hh); b = [x, Hh + rr(0, 0.06) + (rough ? 0.2 * (1 - Math.pow(z / halfW(Hh), 2)) : 0), z]; n = [rr(-0.3, 0.3), 1, z / halfW(Hh) * 0.4]; }
    else { const s = r < 0.625 ? 1 : -1, y = Math.pow(rnd(), 0.8) * Hh; b = [x, y, s * (halfW(y) + rr(-0.02, 0.07))]; n = [rr(-0.4, 0.4), rr(0, 0.5), s]; }
    n = _vn(n);
    let ax = _vn([n[0] * 0.6 + rr(-0.8, 0.8), n[1] * 0.4 + rr(-0.5, 0.5), n[2] * 0.6 + rr(-0.8, 0.8)]);
    let nl = _vn([n[0] + rr(-0.4, 0.4), n[1] + 0.6 + rr(-0.3, 0.3), n[2] + rr(-0.4, 0.4)]); const sd = _vn(_vx(ax, nl)); nl = _vx(sd, ax);
    const ao = lerp(0.6, 1, sat(b[1] / Hh)), tn = [Lf.col[0] * rr(0.9, 1.1), Lf.col[1] * rr(0.92, 1.08), Lf.col[2] * rr(0.9, 1.1)];
    ukLeaf(LB, b, ax, sd, nl, Lf.L * rr(0.8, 1.2), Lf, 0.25, Math.floor(rnd() * 255), ao, tn, rr);
  }
  return mb;
}
// ground plants (near only): bramble mound, male fern, ivy carpet, marram tussock, rough grass
function ukGroundGen(kind, seed, ai) {
  const mb = new MeshBuilder(1024), rnd = mkRng(seed), rr = (a, b) => a + (b - a) * rnd(), LB = new UKLeafBuf(); mb.leaves = LB;
  const K = { bramble: [UKT.BRAMBLE, 16, 1.1, 1.0, 0.75], fern: [UKT.FERN, 11, 0.5, 0.95, 0.45], ivy: [UKT.IVY, 14, 0.25, 1.15, 0.9], marram: [UKT.MARRAM, 13, 0.55, 0.85, 0.7], grass: [UKT.GRASS, 12, 0.45, 0.8, 0.7] }[kind];
  const C = { tint: [1, 1, 1] }, Hh = K[2] + 0.6, dIn = p => sat(0.55 + 0.45 * p[1] / Hh), outN = p => _vn([p[0], 0.8, p[2]]);
  for (let k = 0; k < K[1]; k++) {
    const az = k * 2.39996 + rr(-0.3, 0.3);
    let el, L, Wd, off, y = 0.02, droop, tile = K[0];
    if (kind === 'bramble') { el = rr(0.3, 1.2); L = rr(1.0, 1.6); Wd = L * 0.95; off = rr(0, 0.6); y = rr(0.05, 0.5); droop = 0.25; if (k % 4 === 0) tile = UKT.IVY; }
    else if (kind === 'fern') { el = rr(0.8, 1.3); L = rr(0.75, 1.15); Wd = L * 0.45; off = 0.05; droop = 0.28; }   // a shuttlecock of fronds ~0.8 m high
    else if (kind === 'ivy') { el = rr(0.05, 0.4); L = rr(0.7, 1.2); Wd = L * 1.1; off = rr(0.2, 1.3); droop = 0.05; if (k % 5 === 0) tile = UKT.DEADLEAF; }
    else { el = rr(1.05, 1.45); L = rr(0.55, 1.15) * (kind === 'marram' ? 1.1 : 1); Wd = rr(0.7, 1.1); off = 0.05; droop = 0.3; }
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], side = _vn(_vx(dir, [0, 1, 0]));
    const tk = K[3]; C.tint = [rr(0.88, 1.1) * tk, rr(0.92, 1.06) * tk, rr(0.85, 1) * tk];
    ukCard(mb, [Math.cos(az) * off, y, Math.sin(az) * off], dir, side, L, Wd, tile, dIn, outN, Hh, C, 0.35, rnd, droop, 3, ai);
  }
  // a few single leaves on the bramble and ivy (the rest of these plants is fine at the distance they show up)
  if (kind === 'bramble' || kind === 'ivy') {
    const Lf = kind === 'ivy' ? { t: UKL.IVY, L: 0.075, asp: 0.95, col: [0.62, 0.72, 0.6] } : { t: UKL.BRAMBLE, L: 0.09, asp: 0.55, col: [0.75, 0.82, 0.62] };
    for (let e = 0; e < (kind === 'ivy' ? 260 : 220); e++) {
      const a = rr(0, TAU), r = Math.sqrt(rnd()) * (kind === 'ivy' ? 1.3 : 0.9), b = [Math.cos(a) * r, kind === 'ivy' ? rr(0.02, 0.12) : rr(0.15, 1.0) * (1 - r * 0.5), Math.sin(a) * r];
      let ax = _vn([rr(-1, 1), rr(-0.2, 0.3), rr(-1, 1)]), nl = _vn([rr(-0.3, 0.3), 1, rr(-0.3, 0.3)]); const sd = _vn(_vx(ax, nl)); nl = _vx(sd, ax);
      ukLeaf(LB, b, ax, sd, nl, Lf.L * rr(0.8, 1.25), Lf, 0.3, Math.floor(rnd() * 255), rr(0.6, 1), [Lf.col[0] * rr(0.9, 1.1), Lf.col[1] * rr(0.9, 1.1), Lf.col[2]], rr);
    }
  }
  return mb;
}

// -------------------------------------------------------------------------------------------------------- species
// One entry per archetype (index = UKS id). P: builder parameters (see ukTree); sp: leaf colour multiplier (VEG_SP);
// v: (per-tree tint variation, share of trees starting to turn, leaf flutter, 0 tree | 1 sword leaves | 2 clipped hedge);
// m: (leaf gloss, translucency, silvery undersides, share of trees with ivy up the trunk); h: [typical heights (m)];
// a: [crown radius / height range] for ukTreeSpecies; sink: how far the foot goes into the ground (m).
const UKBC = { oak: [0.16, 0.145, 0.125], beech: [0.27, 0.28, 0.29], ash: [0.3, 0.3, 0.27], syc: [0.25, 0.23, 0.2], hc: [0.25, 0.2, 0.165], holm: [0.12, 0.11, 0.1], scots: [0.18, 0.15, 0.13], scotsTop: [0.52, 0.27, 0.14], mont: [0.14, 0.12, 0.105], birch: [0.66, 0.64, 0.6], plane: [0.42, 0.4, 0.31], lime: [0.22, 0.2, 0.18], hawth: [0.2, 0.18, 0.15], black: [0.085, 0.075, 0.07], holly: [0.4, 0.4, 0.37], shrub: [0.22, 0.18, 0.14] };
const UK_ARCH = [
  { k: 'OAK', gen: 'tree', h: [10, 24], a: [0.38, 0.7], P: { ivy: 300, holes: 0.2, H: 18, cb: 0.22, cr: 9.5, shape: 'dome', lumps: 9, lumpA: 0.32, r0: 0.56, flare: 0.45, lean: 0.02, wob: 0.45, leader: 0.45, bark: UKB.OAK, bc: UKBC.oak, nB: 12, el: [12, 60], bCurve: 0.5, bSin: 2.2, nSub: 6, subLen: 0.55, limbR: 0.72, tiles: [UKT.OAK], card: 1.4, cpc: 5, clumpR: 0.6, fill: 130, leaf: { t: UKL.OAK, L: 0.15, asp: 0.55, n: 10, droop: 0.2, col: [0.92, 0.95, 0.85] } }, sp: [0.95, 0.97, 0.9], v: [0.8, 0.03, 1, 0], m: [0.2, 0.95, 0, 0.3] },
  { k: 'OAK_W', gen: 'tree', h: [14, 28], a: [0.2, 0.4], P: { ivy: 350, holes: 0.18, H: 22, cb: 0.45, cr: 6.5, shape: 'ovoid', lumps: 8, lumpA: 0.26, r0: 0.42, flare: 0.4, lean: 0.03, wob: 0.4, leader: 0.68, bark: UKB.OAK, bc: UKBC.oak, nB: 11, el: [22, 68], bCurve: 0.6, bSin: 2.0, nSub: 5, subLen: 0.55, limbR: 0.65, tiles: [UKT.OAK], card: 1.3, cpc: 5, clumpR: 0.6, fill: 90, leaf: { t: UKL.OAK, L: 0.15, asp: 0.55, n: 9, droop: 0.2, col: [0.92, 0.95, 0.85] } }, sp: [0.95, 0.97, 0.9], v: [0.8, 0.03, 1, 0], m: [0.2, 0.95, 0, 0.45] },
  { k: 'BEECH', gen: 'tree', h: [14, 32], a: [0.22, 0.5], P: { ivy: 250, holes: 0.12, H: 25, cb: 0.3, cr: 9, shape: 'ovoid', lumps: 6, lumpA: 0.2, r0: 0.44, flare: 0.55, lean: 0.015, wob: 0.2, leader: 0.75, bark: UKB.BEECH, bc: UKBC.beech, nB: 13, el: [18, 64], bCurve: 0.9, bSin: 0.8, nSub: 6, subLen: 0.5, tiles: [UKT.BEECH], card: 1.3, cpc: 5, clumpR: 0.55, droop: 0.15, fill: 105, leaf: { t: UKL.BEECH, L: 0.11, asp: 0.6, n: 10, droop: 0.15, col: [0.95, 1.0, 0.8] } }, sp: [0.9, 0.95, 0.88], v: [0.6, 0.02, 1, 0], m: [0.5, 1.0, 0, 0.25] },
  { k: 'ASH', gen: 'tree', h: [12, 30], a: [0.2, 0.42], P: { ivy: 320, holes: 0.36, gap: 1.3, H: 23, cb: 0.38, cr: 8, shape: 'ovoid', lumps: 7, lumpA: 0.3, r0: 0.38, flare: 0.35, lean: 0.03, wob: 0.3, leader: 0.7, bark: UKB.ASH, bc: UKBC.ash, nB: 12, el: [34, 76], bCurve: 1.4, bSin: 1.0, nSub: 4, subLen: 0.5, subEl: 0.2, tiles: [UKT.ASH], card: 1.3, aspect: 0.9, cpc: 4, clumpR: 0.7, fill: 60, leaf: { t: UKL.LANCE, L: 0.26, asp: 0.32, n: 2, comp: 'pinnate', droop: 0.3, col: [1.0, 1.05, 0.82] } }, sp: [0.97, 1.0, 0.88], v: [0.7, 0.04, 1.2, 0], m: [0.15, 1.05, 0, 0.35] },
  { k: 'SYCAMORE', gen: 'tree', h: [8, 24], a: [0.36, 0.65], P: { ivy: 280, holes: 0.1, H: 18, cb: 0.22, cr: 8.5, shape: 'dome', lumps: 7, lumpA: 0.15, r0: 0.5, flare: 0.4, lean: 0.02, wob: 0.3, leader: 0.5, bark: UKB.SYCAMORE, bc: UKBC.syc, nB: 12, el: [22, 64], bCurve: 0.8, bSin: 1.1, nSub: 6, subLen: 0.55, tiles: [UKT.SYCAMORE], card: 1.4, cpc: 6, clumpR: 0.55, fill: 115, leaf: { t: UKL.PALM, L: 0.18, asp: 1.0, n: 9, droop: 0.4, col: [0.85, 0.9, 0.78] } }, sp: [0.92, 0.95, 0.88], v: [0.7, 0.03, 1, 0], m: [0.15, 1.05, 0, 0.3] },
  { k: 'SYCAMORE_W', gen: 'tree', h: [12, 28], a: [0.2, 0.4], P: { ivy: 350, holes: 0.12, H: 21, cb: 0.42, cr: 6.5, shape: 'ovoid', lumps: 7, lumpA: 0.15, r0: 0.4, flare: 0.35, lean: 0.03, wob: 0.3, leader: 0.7, bark: UKB.SYCAMORE, bc: UKBC.syc, nB: 11, el: [28, 70], bCurve: 0.8, bSin: 1.1, nSub: 5, subLen: 0.55, tiles: [UKT.SYCAMORE], card: 1.35, cpc: 6, clumpR: 0.55, fill: 90, leaf: { t: UKL.PALM, L: 0.18, asp: 1.0, n: 8, droop: 0.4, col: [0.85, 0.9, 0.78] } }, sp: [0.92, 0.95, 0.88], v: [0.7, 0.03, 1, 0], m: [0.15, 1.05, 0, 0.45] },
  { k: 'HCHESTNUT', gen: 'tree', h: [10, 26], a: [0.36, 0.6], P: { holes: 0.08, H: 20, cb: 0.18, cr: 9, shape: 'dome', lumps: 6, lumpA: 0.12, r0: 0.55, flare: 0.4, lean: 0.015, wob: 0.3, leader: 0.5, bark: UKB.HCHESTNUT, bc: UKBC.hc, nB: 13, el: [8, 58], bCurve: 1.1, sag: 0.9, bSin: 0.9, nSub: 6, subLen: 0.5, tiles: [UKT.HCHESTNUT], card: 1.5, cpc: 6, clumpR: 0.55, droop: 0.35, fill: 115, leaf: { t: UKL.OBOV, L: 0.17, asp: 0.4, n: 3, comp: 'palmate', droop: 0.5, col: [0.86, 0.92, 0.75] } }, sp: [0.95, 0.97, 0.88], v: [0.6, 0.22, 0.8, 0], m: [0.15, 1.0, 0, 0.1] },
  { k: 'HOLMOAK', gen: 'tree', h: [6, 22], a: [0.35, 0.65], P: { ivy: 180, holes: 0.06, H: 15, cb: 0.12, cr: 7.5, shape: 'round', lumps: 8, lumpA: 0.2, r0: 0.48, flare: 0.4, lean: 0.03, wob: 0.4, leader: 0.45, bark: UKB.HOLM, bc: UKBC.holm, nB: 12, el: [8, 58], bCurve: 0.4, sag: 0.5, bSin: 1.4, nSub: 7, subLen: 0.55, tiles: [UKT.HOLM], card: 1.1, cpc: 7, clumpR: 0.5, droop: 0.3, fill: 90, leaf: { t: UKL.HOLM, L: 0.07, asp: 0.45, n: 12, droop: 0.3, col: [0.62, 0.7, 0.62] } }, sp: [0.85, 0.9, 0.88], v: [0.5, 0, 0.5, 0], m: [0.6, 0.45, 0.25, 0.2] },
  { k: 'SCOTSPINE', gen: 'tree', h: [10, 28], a: [0.15, 0.36], P: { flatCards: 1, holes: 0.45, gap: 1.2, H: 21, cb: 0.62, cr: 7, shape: 'flat', lumps: 9, lumpA: 0.4, r0: 0.36, flare: 0.25, lean: 0.025, wob: 0.5, leader: 0.92, bark: UKB.SCOTS, bc: UKBC.scots, bcTop: UKBC.scotsTop, nB: 15, whorl: 3, el: [0, 26], bCurve: 1.0, bSin: 1.4, nSub: 3, subLen: 0.45, tiles: [UKT.SCOTS], card: 1.05, cpc: 8, clumpR: 0.75, fill: 40, leaf: { t: UKL.NEEDLE, L: 0.085, asp: 0.55, n: 5, comp: 'needles', droop: 0.1, col: [0.78, 0.92, 1.1] } }, sp: [0.9, 0.98, 1.05], v: [0.5, 0, 0.3, 0], m: [0.3, 0.5, 0, 0.1] },
  { k: 'MONTPINE', gen: 'tree', h: [10, 30], a: [0.3, 0.6], P: { holes: 0.2, H: 22, cb: 0.3, cr: 9, shape: 'umbrella', lumps: 9, lumpA: 0.3, r0: 0.6, flare: 0.4, lean: 0.03, wob: 0.5, leader: 0.65, bark: UKB.MONTEREY, bc: UKBC.mont, nB: 14, whorl: 4, el: [14, 54], bCurve: 0.8, bSin: 1.2, nSub: 5, subLen: 0.5, tiles: [UKT.MONTEREY], card: 1.4, cpc: 7, clumpR: 0.5, fill: 110, leaf: { t: UKL.NEEDLE, L: 0.14, asp: 0.6, n: 5, comp: 'needles', droop: 0.15, col: [0.95, 1.05, 0.75] } }, sp: [0.95, 1.0, 0.85], v: [0.5, 0, 0.3, 0], m: [0.35, 0.5, 0, 0.1] },
  { k: 'BIRCH', gen: 'tree', h: [6, 22], a: [0.15, 0.35], P: { holes: 0.32, gap: 1.0, H: 17, cb: 0.25, cr: 4.5, shape: 'ovoid', lumps: 6, lumpA: 0.25, r0: 0.2, flare: 0.3, lean: 0.03, wob: 0.3, leader: 0.9, bark: UKB.BIRCH, bc: UKBC.birch, nB: 18, el: [38, 70], bCurve: 0.6, bSin: 0.9, nSub: 4, subLen: 0.5, droop: 0.9, hang: 0.5, tiles: [UKT.BIRCH], card: 0.9, cpc: 4, clumpR: 0.6, fill: 60, flutter: 2, leaf: { t: UKL.BIRCH, L: 0.065, asp: 0.8, n: 12, droop: 0.6, col: [1.08, 1.1, 0.78] } }, sp: [1.04, 1.05, 0.88], v: [0.6, 0.06, 2.0, 0], m: [0.25, 1.15, 0, 0.05] },
  { k: 'PLANE', gen: 'tree', h: [10, 32], a: [0.3, 0.55], P: { holes: 0.2, H: 25, cb: 0.3, cr: 10, shape: 'dome', lumps: 10, lumpA: 0.32, r0: 0.55, flare: 0.35, lean: 0.02, wob: 0.5, leader: 0.55, bark: UKB.PLANE, bc: UKBC.plane, nB: 12, el: [24, 64], bCurve: 0.6, bSin: 1.6, nSub: 6, subLen: 0.55, tiles: [UKT.PLANE], card: 1.5, cpc: 5, clumpR: 0.6, fill: 140, leaf: { t: UKL.PALM, L: 0.22, asp: 1.0, n: 8, droop: 0.4, col: [0.98, 1.02, 0.8] } }, sp: [1.0, 1.02, 0.9], v: [0.6, 0.05, 1, 0], m: [0.15, 1.05, 0, 0.0] },
  { k: 'LIME', gen: 'tree', h: [8, 28], a: [0.2, 0.42], P: { ivy: 120, holes: 0.1, H: 22, cb: 0.25, cr: 6, shape: 'column', lumps: 5, lumpA: 0.12, r0: 0.42, flare: 0.45, lean: 0.015, wob: 0.25, leader: 0.85, bark: UKB.LIME, bc: UKBC.lime, nB: 15, el: [28, 70], bCurve: 0.7, sag: 0.3, bSin: 1.0, nSub: 5, subLen: 0.5, tiles: [UKT.LIME], card: 1.2, cpc: 6, clumpR: 0.5, fill: 95, leaf: { t: UKL.HEART, L: 0.1, asp: 0.85, n: 10, droop: 0.3, col: [0.95, 1.0, 0.78] } }, sp: [0.98, 1.0, 0.88], v: [0.6, 0.04, 1.1, 0], m: [0.15, 1.1, 0, 0.05] },
  { k: 'HAWTHORN', gen: 'tree', h: [3, 9], a: [0.35, 0.8], P: { ivy: 90, H: 6.5, cb: 0.25, cr: 3.2, shape: 'round', lumps: 8, lumpA: 0.25, r0: 0.14, flare: 0.3, lean: 0.04, wob: 0.3, nStem: 2, stemEl: 76, leader: 0.5, bark: UKB.HAWTHORN, bc: UKBC.hawth, nB: 10, el: [14, 60], bCurve: 0.5, bSin: 2.0, nSub: 5, subLen: 0.55, tiles: [UKT.HAWTHORN], card: 0.9, cpc: 6, clumpR: 0.5, fill: 30, leaf: { t: UKL.HAWTH, L: 0.055, asp: 0.8, n: 12, col: [0.85, 0.92, 0.72] } }, sp: [0.92, 0.96, 0.85], v: [0.6, 0.05, 1, 0], m: [0.3, 0.9, 0, 0.1] },
  { k: 'HAWTHORN_WIND', gen: 'tree', h: [2, 6], a: [0.5, 1.2], P: { H: 3.8, cb: 0.18, cr: 3.2, shape: 'lean', leanAz: 0, lumps: 8, lumpA: 0.18, r0: 0.13, flare: 0.3, lean: 0.3, wob: 0.25, leader: 0.55, bark: UKB.HAWTHORN, bc: UKBC.hawth, nB: 11, el: [6, 40], bCurve: 0.1, bSin: 1.8, nSub: 5, subLen: 0.55, tiles: [UKT.HAWTHORN], card: 0.85, cpc: 6, clumpR: 0.45, fill: 34, leaf: { t: UKL.HAWTH, L: 0.045, asp: 0.8, n: 12, col: [0.82, 0.9, 0.7] } }, sp: [0.9, 0.94, 0.82], v: [0.5, 0.08, 0.6, 0], m: [0.3, 0.85, 0, 0] },
  { k: 'BLACKTHORN', gen: 'tree', h: [1.5, 4.5], a: [0.5, 1.4], P: { H: 3.2, cb: 0.1, cr: 2.6, shape: 'round', lumps: 9, lumpA: 0.3, r0: 0.06, flare: 0.2, lean: 0.02, wob: 0.15, nStem: 7, stemEl: 70, leader: 0.7, bark: UKB.BLACKTHORN, bc: UKBC.black, nB: 14, el: [20, 70], bCurve: 0.3, bSin: 2.5, nSub: 3, subLen: 0.6, tiles: [UKT.BLACKTHORN], card: 0.8, cpc: 6, clumpR: 0.5, fill: 26, leaf: { t: UKL.ELL, L: 0.035, asp: 0.5, n: 12, col: [0.7, 0.78, 0.62] } }, sp: [0.88, 0.92, 0.85], v: [0.5, 0.03, 0.8, 0], m: [0.3, 0.8, 0, 0] },
  { k: 'HOLLY', gen: 'tree', h: [1.5, 12], a: [0.2, 0.5], P: { H: 7, cb: 0.08, cr: 2.4, shape: 'cone', lumps: 6, lumpA: 0.15, r0: 0.15, flare: 0.3, lean: 0.02, wob: 0.2, leader: 0.9, bark: UKB.HOLLY, bc: UKBC.holly, nB: 16, el: [24, 56], bCurve: 0.5, bSin: 1.0, nSub: 4, subLen: 0.5, tiles: [UKT.HOLLY], card: 0.85, cpc: 6, clumpR: 0.45, fill: 36, leaf: { t: UKL.HOLLY, L: 0.08, asp: 0.55, n: 10, col: [0.62, 0.72, 0.62] } }, sp: [0.85, 0.9, 0.88], v: [0.4, 0, 0.4, 0], m: [1.0, 0.35, 0, 0] },
  { k: 'CORDYLINE', gen: 'cordyline', h: [2, 9], a: [0.2, 0.6], P: { H: 5.5, cr: 1.6 }, sp: [1.0, 1.0, 0.92], v: [0.5, 0, 0.8, 1], m: [0.35, 0.8, 0, 0] },
  { k: 'SEABUCKTHORN', gen: 'tree', h: [1, 4.5], a: [0.4, 1.2], P: { H: 2.6, cb: 0.1, cr: 1.8, shape: 'round', lumps: 8, lumpA: 0.25, r0: 0.05, flare: 0.2, lean: 0.02, wob: 0.1, nStem: 6, stemEl: 65, leader: 0.7, bark: UKB.SHRUB, bc: UKBC.shrub, nB: 12, el: [24, 70], bCurve: 0.5, bSin: 1.5, nSub: 3, subLen: 0.6, tiles: [UKT.BUCKTHORN], card: 0.8, cpc: 6, clumpR: 0.5, fill: 22, leaf: { t: UKL.BUCK, L: 0.06, asp: 0.22, n: 12, col: [1.2, 1.0, 1.9] } }, sp: [1.0, 1.0, 1.0], v: [0.4, 0, 0.8, 0], m: [0.1, 0.5, 0.6, 0] },
  { k: 'SHRUB', gen: 'tree', h: [0.6, 3.5], a: [0.4, 1.2], P: { H: 2.2, cb: 0.04, cr: 1.5, shape: 'round', lumps: 7, lumpA: 0.18, r0: 0.05, flare: 0.2, lean: 0.01, wob: 0.1, nStem: 6, stemEl: 60, leader: 0.7, bark: UKB.SHRUB, bc: UKBC.shrub, nB: 12, el: [20, 70], bCurve: 0.5, bSin: 1.3, nSub: 3, subLen: 0.6, tiles: [UKT.ESCALLONIA], card: 0.8, cpc: 6, clumpR: 0.45, fill: 26, leaf: { t: UKL.ELL, L: 0.035, asp: 0.5, n: 12, col: [0.7, 0.8, 0.65] } }, sp: [0.9, 0.95, 0.88], v: [0.5, 0, 0.6, 0], m: [0.9, 0.6, 0, 0] },
  { k: 'LAUREL', gen: 'tree', h: [1, 5], a: [0.4, 1.0], P: { H: 3.4, cb: 0.04, cr: 2.2, shape: 'round', lumps: 7, lumpA: 0.18, r0: 0.07, flare: 0.2, lean: 0.01, wob: 0.15, nStem: 5, stemEl: 62, leader: 0.7, bark: UKB.SHRUB, bc: UKBC.shrub, nB: 12, el: [16, 66], bCurve: 0.5, bSin: 1.2, nSub: 3, subLen: 0.6, tiles: [UKT.LAUREL], card: 1.0, cpc: 6, clumpR: 0.5, fill: 26, leaf: { t: UKL.ELL, L: 0.15, asp: 0.38, n: 7, col: [0.62, 0.75, 0.6] } }, sp: [0.88, 0.94, 0.9], v: [0.4, 0, 0.5, 0], m: [1.0, 0.5, 0, 0] },
  { k: 'HYDRANGEA', gen: 'tree', h: [0.5, 2.2], a: [0.5, 1.4], P: { H: 1.5, cb: 0.02, cr: 1.2, shape: 'round', lumps: 6, lumpA: 0.15, r0: 0.035, flare: 0.1, lean: 0.01, wob: 0.05, nStem: 8, stemEl: 60, leader: 0.7, bark: UKB.SHRUB, bc: UKBC.shrub, nB: 10, el: [20, 70], bCurve: 0.4, bSin: 1.0, nSub: 2, subLen: 0.6, tiles: [UKT.HYDRANGEA], card: 0.75, cpc: 6, clumpR: 0.45, fill: 20, leaf: { t: UKL.ELL, L: 0.12, asp: 0.6, n: 5, col: [0.82, 0.9, 0.72] } }, sp: [0.95, 0.98, 0.95], v: [0.4, 0, 0.6, 0], m: [0.2, 0.9, 0, 0] },
  { k: 'LEYLAND', gen: 'tree', h: [4, 20], a: [0.12, 0.35], P: { H: 12, cb: 0.03, cr: 2.6, shape: 'cone', lumps: 5, lumpA: 0.1, r0: 0.24, flare: 0.3, lean: 0.01, wob: 0.1, leader: 0.95, bark: UKB.SHRUB, bc: [0.2, 0.13, 0.1], nB: 24, el: [32, 62], bCurve: 0.5, bSin: 0.6, nSub: 4, subLen: 0.5, tiles: [UKT.LEYLAND], card: 0.95, cpc: 6, clumpR: 0.45, fill: 60, leaf: { t: UKL.ELL, L: 0.05, asp: 0.6, n: 6, col: [0.62, 0.74, 0.62] } }, sp: [0.86, 0.92, 0.88], v: [0.35, 0, 0.3, 0], m: [0.2, 0.4, 0, 0] },
  { k: 'HEDGE_PRIVET', gen: 'hedge', h: [0.8, 2.6], a: [0, 9], P: { L: 1.6, W: 0.75, H: 1.7, face: UKT.F_PRIVET, sprig: [UKT.PRIVET], sprigL: 0.3, leafDens: 240, leaf: { t: UKL.ELL, L: 0.04, asp: 0.5, col: [0.62, 0.86, 0.5] } }, sp: [0.95, 0.98, 0.9], v: [0.35, 0, 0.3, 2], m: [0.7, 0.45, 0, 0], sink: 0.05 },
  { k: 'HEDGE_BEECH', gen: 'hedge', h: [1, 3], a: [0, 9], P: { L: 1.6, W: 0.8, H: 1.9, face: UKT.F_BEECH, sprig: [UKT.BEECH], sprigL: 0.4, leafDens: 160, leaf: { t: UKL.BEECH, L: 0.075, asp: 0.6, col: [0.78, 0.92, 0.6] } }, sp: [1.0, 1.0, 0.9], v: [0.35, 0.08, 0.5, 2], m: [0.4, 0.6, 0, 0], sink: 0.05 },
  { k: 'HEDGE_HAWTHORN', gen: 'hedge', h: [1.4, 3.5], a: [0, 9], P: { L: 2.2, W: 2.0, H: 2.4, rough: 1, face: UKT.F_HEDGEROW, sprig: [UKT.HAWTHORN, UKT.BLACKTHORN, UKT.BRAMBLE, UKT.HAWTHORN], sprigL: 0.75, leafDens: 110, leaf: { t: UKL.HAWTH, L: 0.05, asp: 0.8, col: [0.7, 0.85, 0.55] } }, sp: [0.92, 0.96, 0.86], v: [0.45, 0.04, 0.7, 2], m: [0.3, 0.8, 0, 0], sink: 0.1 },
  { k: 'HEDGE_ESCALLONIA', gen: 'hedge', h: [0.8, 2.4], a: [0, 9], P: { L: 1.6, W: 0.9, H: 1.6, face: UKT.F_ESCALLONIA, sprig: [UKT.ESCALLONIA], sprigL: 0.35, leafDens: 220, leaf: { t: UKL.ELL, L: 0.035, asp: 0.5, col: [0.55, 0.75, 0.5] } }, sp: [0.9, 0.95, 0.88], v: [0.35, 0, 0.4, 2], m: [0.9, 0.45, 0, 0], sink: 0.05 },
  { k: 'HEDGE_LEYLAND', gen: 'hedge', h: [1.5, 5], a: [0, 9], P: { L: 1.8, W: 1.0, H: 2.6, face: UKT.F_LEYLAND, sprig: [UKT.LEYLAND], sprigL: 0.45, leafDens: 60, leaf: { t: UKL.ELL, L: 0.05, asp: 0.6, col: [0.62, 0.74, 0.62] } }, sp: [0.86, 0.92, 0.88], v: [0.3, 0, 0.2, 2], m: [0.2, 0.35, 0, 0], sink: 0.05 },
  { k: 'BRAMBLE', gen: 'ground', kind: 'bramble', h: [0.5, 2], a: [0, 9], sp: [0.92, 0.95, 0.88], v: [0.5, 0, 0.7, 0], m: [0.3, 0.85, 0, 0], sink: 0.05 },
  { k: 'FERN', gen: 'ground', kind: 'fern', h: [0.3, 1.5], a: [0, 9], sp: [1.0, 1.02, 0.85], v: [0.5, 0.05, 1, 0], m: [0.1, 1.0, 0, 0], sink: 0.03 },
  { k: 'IVY', gen: 'ground', kind: 'ivy', h: [0.1, 0.6], a: [0, 9], sp: [0.85, 0.9, 0.88], v: [0.4, 0, 0.4, 0], m: [0.9, 0.5, 0, 0], sink: 0.02 },
  { k: 'MARRAM', gen: 'ground', kind: 'marram', h: [0.4, 1.4], a: [0, 9], sp: [1.0, 1.0, 1.0], v: [0.4, 0, 1.2, 0], m: [0.2, 0.7, 0, 0], sink: 0.03 },
  { k: 'GRASS', gen: 'ground', kind: 'grass', h: [0.3, 1.2], a: [0, 9], sp: [1.0, 1.0, 0.95], v: [0.5, 0, 1.2, 0], m: [0.15, 0.9, 0, 0], sink: 0.02 },
];
// builds the British archetypes (meshes + leaf layers), the shader tables and the size info the planting API uses
function ukArchetypes() {
  const t0 = performance.now(); VEG_NT = UK_NT; VEG_NA = UK_NA;
  VEG.dims = new Float32Array(UK_NA * 4);
  const out = [], H = UKV.H = new Float32Array(UK_NA), Rr = UKV.R = new Float32Array(UK_NA);
  for (let i = 0; i < UK_NA; i++) {
    const A = UK_ARCH[i], seed = 101 + i * 37;
    if (A.k !== Object.keys(UKS)[i]) throw new Error('UK_ARCH out of order at ' + i);
    const mb = A.gen === 'tree' ? ukTree(A.P, seed, i) : A.gen === 'cordyline' ? ukCordyline(seed, i) : A.gen === 'hedge' ? ukHedgeMod(A.P, seed, i) : ukGroundGen(A.kind, seed, i);
    const b = mb.bounds(); H[i] = b.max[1]; Rr[i] = A.P && A.P.cr ? A.P.cr : Math.max(b.max[0], -b.min[0], b.max[2], -b.min[2]);
    out.push(mb);
  }
  const f3 = v => `vec3f(${v.map(x => x.toFixed(3)).join(', ')})`, f4 = v => `vec4f(${v.map(x => x.toFixed(3)).join(', ')})`;
  WGSL.veg_uk_tables = `const VEG_NT = ${UK_NT}.0;\nconst VEG_NA_UK = ${UK_NA}u;\n` +
    `const VEG_SP = array<vec3f, ${UK_NA}>(${UK_ARCH.map(a => f3(a.sp)).join(', ')});\n` +
    `const VEG_H = array<f32, ${UK_NA}>(${Array.from(H).map(x => (x * 1.03).toFixed(2)).join(', ')});\n` +
    `const VEG_UKV = array<vec4f, ${UK_NA}>(${UK_ARCH.map(a => f4([a.v[0], a.v[1], (a.P && a.P.flutter) || a.v[2], a.v[3]])).join(', ')});\n` +
    `const VEG_UKM = array<vec4f, ${UK_NA}>(${UK_ARCH.map(a => f4(a.m)).join(', ')});\n`;
  UKV.time.meshes = performance.now() - t0; UKV.tris = out.map(m => m.ni / 3); UKV.leaves = out.map(m => m.leaves ? m.leaves.n : 0);
  return out;
}

// --------------------------------------------------------------------------------------------------- planting API
// Mix rules (relative weights; the crown height and shape then weigh each species by how well it fits). From the
// Geograph references: Weston Woods / Worlebury Hill and Kewstoke's hill: beech, oak, ash and sycamore with holm oak
// and pines, holly and hawthorn below; streets and parks: plane, lime, sycamore, horse chestnut; the seafront:
// cordylines, Monterey and Scots pines, holm oaks; Sand Bay: sea buckthorn, blackthorn and wind-cut hawthorn on the back
// dunes; Kewstoke's lanes: hedgerow oaks and ashes over hawthorn hedges.
const UK_MIX = {
  wood: [[UKS.BEECH, 22], [UKS.SYCAMORE_W, 18], [UKS.ASH, 18], [UKS.OAK_W, 13], [UKS.HOLMOAK, 9], [UKS.SYCAMORE, 3], [UKS.OAK, 3], [UKS.SCOTSPINE, 4], [UKS.MONTPINE, 3], [UKS.BIRCH, 2], [UKS.LIME, 1], [UKS.HOLLY, 9], [UKS.HAWTHORN, 6]],
  street: [[UKS.PLANE, 30], [UKS.LIME, 27], [UKS.SYCAMORE, 14], [UKS.HCHESTNUT, 9], [UKS.BIRCH, 7], [UKS.OAK, 4], [UKS.HOLMOAK, 4], [UKS.HAWTHORN, 5]],
  park: [[UKS.HCHESTNUT, 17], [UKS.LIME, 14], [UKS.PLANE, 13], [UKS.OAK, 13], [UKS.SYCAMORE, 11], [UKS.HOLMOAK, 10], [UKS.BEECH, 6], [UKS.MONTPINE, 4], [UKS.SCOTSPINE, 3], [UKS.BIRCH, 6], [UKS.ASH, 3], [UKS.HOLLY, 3]],
  garden: [[UKS.BIRCH, 15], [UKS.CORDYLINE, 13], [UKS.HOLLY, 10], [UKS.SYCAMORE, 9], [UKS.LEYLAND, 11], [UKS.HAWTHORN, 7], [UKS.HOLMOAK, 6], [UKS.MONTPINE, 5], [UKS.OAK, 4], [UKS.ASH, 5], [UKS.LIME, 3], [UKS.SCOTSPINE, 3], [UKS.BEECH, 3]],
  village: [[UKS.ASH, 15], [UKS.SYCAMORE, 15], [UKS.OAK, 11], [UKS.BEECH, 7], [UKS.HOLMOAK, 7], [UKS.BIRCH, 9], [UKS.HOLLY, 8], [UKS.CORDYLINE, 7], [UKS.LEYLAND, 8], [UKS.MONTPINE, 5], [UKS.HAWTHORN, 6], [UKS.LIME, 2]],
  holiday: [[UKS.CORDYLINE, 20], [UKS.LEYLAND, 18], [UKS.HOLMOAK, 12], [UKS.MONTPINE, 12], [UKS.SYCAMORE, 10], [UKS.HAWTHORN_WIND, 10], [UKS.BIRCH, 8], [UKS.SEABUCKTHORN, 10]],
  seafront: [[UKS.CORDYLINE, 48], [UKS.MONTPINE, 16], [UKS.HOLMOAK, 16], [UKS.SCOTSPINE, 6], [UKS.SYCAMORE, 6], [UKS.HAWTHORN_WIND, 8]],
  dune: [[UKS.SEABUCKTHORN, 50], [UKS.HAWTHORN_WIND, 30], [UKS.BLACKTHORN, 20]],
  backdune: [[UKS.SEABUCKTHORN, 38], [UKS.HAWTHORN_WIND, 32], [UKS.BLACKTHORN, 22], [UKS.HOLMOAK, 4], [UKS.MONTPINE, 4]],
  scrub: [[UKS.HAWTHORN, 36], [UKS.BLACKTHORN, 30], [UKS.HAWTHORN_WIND, 6], [UKS.HOLLY, 8], [UKS.SYCAMORE, 8], [UKS.ASH, 7], [UKS.OAK, 5]],
  fieldedge: [[UKS.OAK, 36], [UKS.ASH, 32], [UKS.SYCAMORE, 14], [UKS.HAWTHORN, 10], [UKS.HOLLY, 3], [UKS.BEECH, 3], [UKS.BLACKTHORN, 2]],
};
const UK_SHRUBS = {
  garden: [[UKS.SHRUB, 28], [UKS.LAUREL, 17], [UKS.HYDRANGEA, 20], [UKS.HOLLY, 6], [UKS.CORDYLINE, 8], [UKS.LEYLAND, 6], [UKS.HAWTHORN, 3]],
  village: [[UKS.SHRUB, 24], [UKS.LAUREL, 18], [UKS.HYDRANGEA, 18], [UKS.HOLLY, 14], [UKS.HAWTHORN, 10], [UKS.LEYLAND, 8], [UKS.CORDYLINE, 4]],
  holiday: [[UKS.SHRUB, 36], [UKS.HYDRANGEA, 10], [UKS.CORDYLINE, 16], [UKS.LAUREL, 8], [UKS.SEABUCKTHORN, 12], [UKS.LEYLAND, 12], [UKS.HAWTHORN_WIND, 6]],
  park: [[UKS.SHRUB, 30], [UKS.LAUREL, 28], [UKS.HOLLY, 18], [UKS.HYDRANGEA, 12], [UKS.HAWTHORN, 12]],
  street: [[UKS.SHRUB, 46], [UKS.LAUREL, 30], [UKS.HYDRANGEA, 16], [UKS.HOLLY, 8]],
  seafront: [[UKS.SHRUB, 48], [UKS.CORDYLINE, 24], [UKS.HYDRANGEA, 10], [UKS.SEABUCKTHORN, 10], [UKS.HAWTHORN_WIND, 8]],
  wood: [[UKS.HOLLY, 38], [UKS.BRAMBLE, 40], [UKS.HAWTHORN, 14], [UKS.LAUREL, 8]],
  dune: [[UKS.SEABUCKTHORN, 55], [UKS.BRAMBLE, 25], [UKS.BLACKTHORN, 20]],
  backdune: [[UKS.SEABUCKTHORN, 48], [UKS.BRAMBLE, 24], [UKS.BLACKTHORN, 16], [UKS.HAWTHORN_WIND, 12]],
  scrub: [[UKS.BRAMBLE, 38], [UKS.BLACKTHORN, 32], [UKS.HAWTHORN, 30]],
  fieldedge: [[UKS.BRAMBLE, 42], [UKS.BLACKTHORN, 30], [UKS.HAWTHORN, 28]],
};
const _ukW = new Float64Array(32);
// any number → [0, 1)
const ukSeed = s => (s >= 0 && s < 1) ? s : hash2(Math.floor(s * 7.31) | 0, Math.floor(s * 0.137 + 9) | 0);
function ukPick(list, h, r, u) {
  let tot = 0;
  for (let i = 0; i < list.length; i++) {
    const A = UK_ARCH[list[i][0]]; let f = list[i][1];
    if (h > 0) { const hi = A.h[1], lo = A.h[0]; f *= h > hi ? Math.exp(-Math.pow((h - hi) / (0.2 * hi + 1), 2)) : h < lo ? 0.25 + 0.75 * h / lo : 1; }
    if (h > 0 && r > 0) { const a = r / h, d = a < A.a[0] ? A.a[0] - a : a > A.a[1] ? a - A.a[1] : 0; f *= Math.exp(-(d * d) / 0.012); }
    _ukW[i] = f; tot += f;
  }
  if (tot <= 1e-9) return list[0][0];
  let x = u * tot; for (let i = 0; i < list.length; i++) { x -= _ukW[i]; if (x <= 0) return list[i][0]; }
  return list[list.length - 1][0];
}
function ukTreeSpecies(ctx, h, r, seed) { return ukPick(UK_MIX[ctx] || UK_MIX.park, h || 0, r || 0, ukSeed(seed)); }
function ukPlant(x, y, z, sp, h, r, rot, seed) {
  const A = UK_ARCH[sp]; if (!A || !UKV.push) return 0;
  const u = ukSeed(seed), H = UKV.H[sp], R = UKV.R[sp];
  let s = h > 0 ? h / H : lerp(0.85, 1.15, u); s = clamp(s, 0.12, 2.4);
  const k = r > 0 && A.gen !== 'hedge' ? clamp(r / (R * s), 0.75, 1.35) : lerp(0.93, 1.07, fract(u * 7.3));
  if (sp === UKS.HAWTHORN_WIND) rot = -PI / 4 + (fract(u * 13.7) - 0.5) * 0.7;   // swept north-east by the south-westerlies
  UKV.push(x, y - (A.sink === undefined ? 0.25 : A.sink) * Math.min(1, s), z, s, rot === undefined ? u * TAU : rot, fract(u * 3.1 + 0.27), sp, k);
  if (sp < UK_NT && A.gen !== 'hedge') UKV.stats.trees++; else UKV.stats.ground++;
  return 1;
}
function ukShrub(x, y, z, ctx, size, seed) {
  const u = ukSeed(seed), sp = ukPick(UK_SHRUBS[ctx] || UK_SHRUBS.garden, size || 0, 0, u), A = UK_ARCH[sp];
  const h = size > 0 ? size : lerp(A.h[0], Math.min(A.h[1], A.gen === 'ground' ? A.h[1] : 4), 0.35 + 0.5 * fract(u * 5.3));
  UKV.stats.shrubs++;
  return ukPlant(x, y, z, sp, A.gen === 'ground' ? UKV.H[sp] * (size > 0 ? size / UKV.H[sp] : lerp(0.8, 1.2, fract(u * 3.7))) : h, 0, u * TAU, fract(u * 9.1));
}
const UK_GROUND = { ivy: UKS.IVY, fern: UKS.FERN, bramble: UKS.BRAMBLE, marram: UKS.MARRAM, grass: UKS.GRASS };
function ukGround(x, y, z, kind, size, seed) {
  const sp = UK_GROUND[kind]; if (sp === undefined) return 0; const u = ukSeed(seed);
  return ukPlant(x, y, z, sp, UKV.H[sp] * (size > 0 ? size : lerp(0.8, 1.2, fract(u * 3.7))), 0, u * TAU, fract(u * 5.9));
}
// the floor of a wood: ivy carpet in the shade, male ferns, bramble where light comes in, holly seedlings
function ukWoodFloor(x, y, z, seed, light) {
  const u = ukSeed(seed), l = light === undefined ? 0.3 : sat(light), r = fract(u * 11.3); UKV.stats.floor++;
  if (r < 0.42 - 0.2 * l) return ukGround(x, y, z, 'ivy', lerp(0.8, 1.3, fract(u * 5.1)), u);
  if (r < 0.62) return ukGround(x, y, z, 'fern', lerp(0.7, 1.25, fract(u * 4.3)), u);
  if (r < 0.62 + 0.25 * l) return ukGround(x, y, z, 'bramble', lerp(0.6, 1.15, fract(u * 6.7)), u);
  if (r < 0.7 + 0.25 * l) return ukPlant(x, y, z, UKS.HOLLY, lerp(0.6, 1.8, fract(u * 3.3)), 0, u * TAU, fract(u * 7.7));
  return 0;
}
// Sand Bay's dunes: marram on the fore dune thinning into rough grass behind; bramble and sea buckthorn scrub on the
// back dunes (back 0 → 1)
function ukDunes(x, y, z, back, seed) {
  const u = ukSeed(seed), b = sat(back), r = fract(u * 13.1);
  if (r < 0.7 * (1 - 0.55 * b)) return ukGround(x, y, z, 'marram', lerp(0.75, 1.3, fract(u * 3.9)), u);
  if (r < 0.7 * (1 - 0.55 * b) + 0.25 * b) return ukGround(x, y, z, 'grass', lerp(0.7, 1.1, fract(u * 4.9)), u);
  if (b > 0.4 && r > 0.965 - 0.05 * b) return ukShrub(x, y, z, 'backdune', 0, fract(u * 7.3));
  return 0;
}
// hedges: modules end to end along the polyline (alternately turned round, so no two neighbours repeat)
function ukHedge(pts, kind, opt) {
  opt = opt || {}; const A = UK_ARCH[kind]; if (!A || A.gen !== 'hedge' || !UKV.push) return 0;
  const yAt = opt.yAt || hfAt, rnd = mkRng(((opt.seed || 0) * 977 + pts.length * 13 + (pts[0] * 7 | 0)) >>> 0), P = A.P;
  const s0 = clamp((opt.h || P.H) / P.H, 0.4, 2.2), step = P.L * s0 * 0.93, gaps = opt.gaps || [];
  const trees = opt.trees === undefined ? (kind === UKS.HEDGE_HAWTHORN ? 2.5 : 0) : opt.trees;
  let next = 100 / Math.max(1e-6, trees) * lerp(0.3, 1, rnd()), carry = step * 0.5, along = 0, n = 0;
  const np = pts.length / 2, segs = opt.closed ? np : np - 1;
  for (let i = 0; i < segs; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], j = (i + 1) % np, bx = pts[j * 2], bz = pts[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L, rot = Math.atan2(dz, dx);
    let t = carry;
    for (; t < L; t += step) {
      const d = along + t; let open = false; for (const g of gaps) if (d > g[0] && d < g[1]) { open = true; break; }
      if (open) continue;
      const x = ax + dx * t, z = az + dz * t, s = s0 * lerp(0.95, 1.05, rnd());
      UKV.push(x, yAt(x, z) - (A.sink || 0.05), z, s, rot + (rnd() < 0.5 ? PI : 0) + (rnd() - 0.5) * 0.06, rnd(), kind, 1);
      n++;
      if (trees > 0 && d > next) {   // a hedgerow oak or ash standing out of the hedge
        next = d + 100 / trees * lerp(0.5, 1.5, rnd());
        const h = lerp(11, 19, rnd()), sp = ukTreeSpecies(UKC.FIELDEDGE, h, 0, rnd());
        if (sp !== UKS.HAWTHORN && sp !== UKS.BLACKTHORN) n += ukPlant(x, yAt(x, z), z, sp, h, 0, rnd() * TAU, rnd());
      }
    }
    carry = t - L; along += L;
  }
  UKV.stats.hedge += n; UKV.stats.hedgeM += along;
  return n;
}
function ukBegin(push) { UKV.push = push; UKV.stats.trees = UKV.stats.shrubs = UKV.stats.ground = UKV.stats.hedge = UKV.stats.hedgeM = UKV.stats.floor = 0; UKV.t0 = performance.now(); if (window.__cap) window.__cap.ukv = UKV; }

// ------------------------------------------------------------------------- the old archetype roles on the town map
// townVegPlace pushes archetypes 0..8 of the Serra's set; here they become British species chosen from the zone under
// the plant and where it is: north of Worlebury Hill (z < -2000: Kewstoke, Sand Bay) gardens are 'village' (or
// 'holiday' near the dunes); within ~60 m of the beach the town's lawns are 'seafront'.
const UK_LEG_H = [20.5, 12.6, 27.9, 11.7, 8.5, 3.7, 1.8, 0.5, 1.2];   // the Serra archetypes' heights (VEG_H)
function ukZoneCtx(x, z) {
  if (!TOWN.on || !TOWN.zone) return UKC.PARK;
  const T = TOWN, zw = T.zw, zh = T.zh, Z = T.zone;
  const at = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= zw || j >= zh ? TZ.OUT : Z[j * zw + i]; };
  const near = (code, r) => { for (let a = 0; a < 8; a++) if (at(x + Math.cos(a * PI / 4) * r, z + Math.sin(a * PI / 4) * r) === code) return true; return false; };
  const c = at(x, z), north = z < -2000;
  switch (c) {
    case TZ.WOOD: return UKC.WOOD;
    case TZ.DUNE: return near(TZ.SAND, 25) ? UKC.DUNE : UKC.BACKDUNE;
    case TZ.FIELD: return UKC.FIELDEDGE;
    case TZ.GARDEN: return north ? (near(TZ.DUNE, 120) || near(TZ.SAND, 160) ? UKC.HOLIDAY : UKC.VILLAGE) : (near(TZ.SAND, 45) ? UKC.SEAFRONT : UKC.GARDEN);
    case TZ.PAVE: case TZ.ROAD: case TZ.KERB: case TZ.HARD: return near(TZ.SAND, 50) ? UKC.SEAFRONT : UKC.STREET;
    default: return near(TZ.SAND, 30) || near(TZ.SAND, 60) ? (north ? UKC.BACKDUNE : UKC.SEAFRONT) : north ? UKC.SCRUB : UKC.PARK;
  }
}
function ukLegacyPush(x, y, z, s, rot, seed, role) {
  if (role >= 9) return;
  const ctx = ukZoneCtx(x, z), u = ukSeed(seed);
  if (role === 0 || role === 1 || role === 2 || role === 4) {
    const h = s * (VEG.dims[role * 4 + 1] || UK_LEG_H[role]);   // (townVegPlace scales the LIDAR crowns by these heights)
    ukPlant(x, y + 0.25, z, ukTreeSpecies(ctx, h, 0, u), h, 0, rot, u);
  } else if (role === 3) ukPlant(x, y + 0.25, z, UKS.CORDYLINE, lerp(3.5, 6.5, u), 0, rot, u);
  else if (role === 5) {
    // a LIDAR crown under 5.5 m arrives clamped to the smallest scale (0.35): a small tree or a big shrub, 3-5.5 m
    if (s <= 0.351) { const h = lerp(3, 5.5, fract(u * 3.3)); ukPlant(x, y + 0.25, z, ukTreeSpecies(ctx === UKC.STREET ? UKC.GARDEN : ctx, h, 0, u), h, 0, rot, u); }
    else ukShrub(x, y + 0.12, z, ctx === UKC.STREET ? UKC.GARDEN : ctx, s * UK_LEG_H[5] * 0.8, u);
  }
  else if (role === 6) { if (ctx === UKC.WOOD && fract(u * 5.3) < 0.4) ukPlant(x, y + 0.1, z, UKS.HOLLY, lerp(1.2, 3.5, fract(u * 2.9)), 0, rot, u); else ukGround(x, y + 0.1, z, 'bramble', s, u); }
  else if (role === 7) { ukGround(x, y + 0.1, z, 'fern', s * 1.1, u); if (ctx === UKC.WOOD && fract(u * 7.1) < 0.6) ukGround(x + 1.2, y + 0.1, z + 0.7, 'ivy', 1, fract(u * 3.3)); }
  else if (role === 8) ukGround(x, y + 0.05, z, ctx === UKC.DUNE || ctx === UKC.BACKDUNE ? 'marram' : 'grass', s * 0.9, u);
}

// ------------------------------------------------------------------------------------------- gallery ?scene=uktrees
// A lawn with a row of each tree species, a row of the small trees and shrubs, the hedges (privet with a gateway, beech,
// escallonia, Leyland cypress, and a hawthorn field hedgerow with its hedgerow trees), patches of the ground plants, and
// a short stretch of wood edge planted with the 'wood' mix rules. The sun is in the west (-x): the camera looks east.
const UKG = { x: 0, z: 0, big: [UKS.OAK, UKS.OAK_W, UKS.BEECH, UKS.ASH, UKS.SYCAMORE, UKS.SYCAMORE_W, UKS.HCHESTNUT, UKS.HOLMOAK, UKS.PLANE, UKS.LIME, UKS.SCOTSPINE, UKS.MONTPINE, UKS.BIRCH],
  small: [UKS.HAWTHORN, UKS.HAWTHORN_WIND, UKS.BLACKTHORN, UKS.HOLLY, UKS.CORDYLINE, UKS.SEABUCKTHORN, UKS.SHRUB, UKS.LAUREL, UKS.HYDRANGEA, UKS.LEYLAND], DB: 28, DS: 12, woodN: 0 };
const ukgBigZ = i => (i - (UKG.big.length - 1) / 2) * UKG.DB, ukgSmallZ = i => (i - (UKG.small.length - 1) / 2) * UKG.DS;
function ukGalleryPlace(V, half) {
  UKG.x = TRK.bx1 + 1500; UKG.z = TRK.cz; V.x0 = UKG.x - half; V.z0 = UKG.z - half;
  const X = UKG.x, Z = UKG.z, y0 = () => 0, rnd = mkRng(2718);
  UKG.big.forEach((sp, i) => ukPlant(X, 0, Z + ukgBigZ(i), sp, UKV.H[sp], 0, 0.3 + i, 0.37 + i * 0.011));
  UKG.small.forEach((sp, i) => ukPlant(X - 45, 0, Z + ukgSmallZ(i), sp, UKV.H[sp], 0, 0.7 + i, 0.41 + i * 0.013));
  const hx = X - 75;
  ukHedge([hx, Z - 60, hx, Z - 30], UKS.HEDGE_PRIVET, { h: 1.6, gaps: [[14, 17.5]], yAt: y0, seed: 1 });
  ukHedge([hx, Z - 24, hx, Z - 10], UKS.HEDGE_BEECH, { h: 1.8, yAt: y0, seed: 2 });
  ukHedge([hx, Z - 4, hx, Z + 8], UKS.HEDGE_ESCALLONIA, { h: 1.5, yAt: y0, seed: 3 });
  ukHedge([hx, Z + 14, hx, Z + 26], UKS.HEDGE_LEYLAND, { h: 2.4, yAt: y0, seed: 4 });
  ukHedge([hx, Z + 34, hx - 2, Z + 60, hx + 1, Z + 92], UKS.HEDGE_HAWTHORN, { h: 2.4, trees: 4, yAt: y0, seed: 5 });
  ukHedge([hx - 4, Z - 60, hx - 14, Z - 60], UKS.HEDGE_PRIVET, { h: 0.9, yAt: y0, seed: 6 });   // a low front-garden hedge round a corner
  const bs = []; for (let k = 0; k < 6; k++) bs.push(hx - 16, Z - 52 + k * 3, hx - 16, Z - 49 + k * 3, 3, 1.2, 0);   // (a boundary as the town hands it over)
  ukBoundaryHedges(bs);
  const patch = (kind, zc, n, r) => { for (let k = 0; k < n; k++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r; ukGround(X - 100 + Math.cos(a) * d, 0, Z + zc + Math.sin(a) * d, kind, 0, rnd()); } };
  patch('bramble', -40, 5, 2.5); patch('fern', -25, 9, 2.5); patch('ivy', -10, 9, 3); patch('grass', 20, 18, 3);
  for (let k = 0; k < 70; k++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 6; ukDunes(X - 100 + Math.cos(a) * d, 0, Z + 5 + Math.sin(a) * d, sat(d / 6 - 0.3), rnd()); }
  // the wood edge: LIDAR-like crowns (taller deeper in), the understorey, the floor
  const w0 = X + 55; let nw = 0;
  for (let gz = -70; gz < 70; gz += 7.5) for (let gx = 0; gx < 70; gx += 7.5) {
    const x = w0 + gx + rnd() * 6, z = Z + gz + rnd() * 6, h = lerp(13, 25, sat(gx / 50)) * lerp(0.8, 1.1, rnd()), r = h * lerp(0.22, 0.45, rnd());
    nw += ukPlant(x, 0, z, ukTreeSpecies(UKC.WOOD, h, r, rnd()), h, r, rnd() * TAU, rnd());
  }
  for (let gz = -70; gz < 70; gz += 9) for (let gx = 3; gx < 70; gx += 9) if (rnd() < 0.4) { const h = lerp(2.5, 7, rnd()); nw += ukPlant(w0 + gx + rnd() * 6, 0, Z + gz + rnd() * 6, ukTreeSpecies(UKC.WOOD, h, h * 0.4, rnd()), h, 0, rnd() * TAU, rnd()); }
  for (let gz = -70; gz < 70; gz += 2.6) for (let gx = -3; gx < 70; gx += 2.6) nw += ukWoodFloor(w0 + gx + rnd() * 2.4, 0, Z + gz + rnd() * 2.4, rnd(), gx < 4 ? 0.9 : 0.3);
  UKG.woodN = nw;
}
// the lawn: mown grass, a strip of sand under the marram, the brown floor of the wood
function ukGalleryGround() {
  const fam = mkFamily('ukGround', { src: 'veg_uk_ground', defs: { UKG_X: UKG.x.toFixed(2), UKG_Z: UKG.z.toFixed(2) } }), set = new MeshSet(fam);
  const mb = new MeshBuilder(1 << 14), S = 1400, N = 56, X = UKG.x, Z = UKG.z; mb.mat(0).color(0.2, 0.3, 0.1);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) mb.v(X - S / 2 + i * S / N, 0, Z - S / 2 + j * S / N, 0, 1, 0, i, j);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; mb.quadI(a, a + N + 1, a + N + 2, a + 1); }
  set.add(mb.upload(), 0, 5); R.drawables.push(set);
}
if (Q.get('scene') === 'uktrees') queueMicrotask(() => BUILD.push(async () => {
  ukGalleryGround();
  R.fog[0] = 0.00012;   // the clear air of the town map
  const cam = (ex, ey, ez, tx, ty, tz, fov) => { window.__cap.cam(ex, ey, ez, tx, ty, tz, fov || 0.9); R.cube.pos.set([tx, Math.max(1.5, ty * 0.3), tz]); return [ex, ey, ez]; };
  const X = () => UKG.x, Z = () => UKG.z;
  const gi = GAME.init; GAME.init = () => { if (gi) gi(); GS.freeCam = true; cam(X() - 190, 26, Z() - 30, X() + 10, 7, Z() + 10, 0.9); };
  // camera presets for the captures: overview, a section of the big row (k = 0, 1, 2), one tree, its leaves, its bark,
  // the small trees, the hedges, the wood edge and its floor
  window.__cap.uk = {
    UKS, UKV, UKG, stats: () => ({ n: VEG.n, nTrees: VEG.nTrees, wood: UKG.woodN, plant: UKV.stats, veg: Object.assign({}, VEG.stats) }),
    overview: () => cam(X() - 190, 26, Z() - 30, X() + 10, 7, Z() + 10, 0.9),
    row: k => { const zc = Z() + ukgBigZ(Math.min(UKG.big.length - 1, k * 4 + 1.5)); return cam(X() - 105, 8, zc, X(), 9, zc, 0.85); },
    tree: i => { const sp = UKG.big[i], H = UKV.H[sp], z = Z() + ukgBigZ(i), d = H * 1.45 + 6; return cam(X() - d, 1.7 + H * 0.12, z - d * 0.12, X(), H * 0.48, z, 0.85); },
    leaves: i => { const sp = UKG.big[i], H = UKV.H[sp], R = VEG.dims[sp * 4] / 1.03, A = UK_ARCH[sp].P, z = Z() + ukgBigZ(i), y = Math.max(2.5, A.cb * H + (H - A.cb * H) * 0.35); return cam(X() - R - 6, y - 0.5, z - 2.5, X() - R * 0.6, y + 0.8, z, 0.6); },
    bark: i => { const z = Z() + ukgBigZ(i); return cam(X() - 2.2, 1.35, z - 0.9, X(), 1.7, z, 0.8); },
    small: i => { if (i === undefined) return cam(X() - 64, 3.0, Z() - 36, X() - 45, 2.0, Z() + 4, 1.0); const sp = UKG.small[i], H = UKV.H[sp], z = Z() + ukgSmallZ(i); return cam(X() - 45 - H * 1.4 - 3, 1.6 + H * 0.15, z - 2, X() - 45, H * 0.5, z, 0.85); },
    hedges: () => cam(X() - 93, 1.75, Z() - 74, X() - 75, 1.1, Z() - 20, 0.85),
    hedge: k => { const zs = [-52, -17, 2, 20, 50][k || 0]; return cam(X() - 79.2, 1.55, Z() + zs - 2.6, X() - 75.2, 1.0, Z() + zs + 0.8, 0.8); },
    hedgerow: () => cam(X() - 98, 2.0, Z() + 30, X() - 75, 2.5, Z() + 70, 0.85),
    ground: () => cam(X() - 109, 1.6, Z() - 50, X() - 100, 0.2, Z() - 25, 0.95),
    dunes: () => cam(X() - 110, 1.4, Z() - 4, X() - 100, 0.4, Z() + 6, 0.9),
    wood: () => cam(X() + 30, 2.2, Z() - 22, X() + 75, 7, Z() + 6, 0.95),
    inside: () => cam(X() + 78, 1.7, Z() - 30, X() + 92, 5, Z() + 10, 1.0),
    // debugging: 'leaves' draws only the single leaves (no cards, trunks or impostors), 'cards' only the meshes, 'all'
    only: m => { const V = VEG; if (!V._pipes) V._pipes = [V.famTree.pipe[0], V.famLeaf.pipe[0], V.famImp.pipe[0]]; V.famTree.pipe[0] = m === 'leaves' ? null : V._pipes[0]; V.famLeaf.pipe[0] = m === 'cards' ? null : V._pipes[1]; V.famImp.pipe[0] = m === 'all' ? V._pipes[2] : null; return m; },
  };
}));

// ---------------------------------------------------------------------- hedges from the town's zone raster (fallback)
// When the town's planting plants no hedge of its own (no ukHedge call), ukEnd lays them from the 1 m zone raster:
// along front gardens (garden cells next to the pavement or the road), and round the fields beside lanes, tracks and
// gardens (hawthorn hedgerows with their oaks and ashes). Each ~22 m plot of frontage gets one kind or none (walls,
// fences, open drives), so a street reads house by house. Modules are laid 1.5 m apart along the edge, turned to it.
// fieldsOnly: only the field boundaries away from roads (field to garden, grass or wood): when the town builds its own
// front-garden and lane boundaries (TOWN.bsegs), those are its job (see ukBoundaryHedges).
function ukZoneHedges(fieldsOnly) {
  const T = TOWN; if (!T.on || !T.zone) return 0;
  const Z = T.zone, zw = T.zw, zh = T.zh, st = 2, gs = 1.4, near = new Map(), gk = (i, j) => i * 65536 + j;
  const front = new Uint8Array(18), lane = new Uint8Array(18);
  if (!fieldsOnly) for (const c of [TZ.PAVE, TZ.ROAD, TZ.KERB]) front[c] = 1;
  for (const c of fieldsOnly ? [TZ.GARDEN, TZ.GRASS, TZ.WOOD] : [TZ.ROAD, TZ.KERB, TZ.PAVE, TZ.TRACK, TZ.PATH, TZ.GARDEN, TZ.GRASS]) lane[c] = 1;
  const at = (i, j) => i < 0 || j < 0 || i >= zw || j >= zh ? TZ.OUT : Z[j * zw + i];
  let n = 0; const rot = new Float64Array(1);
  for (let j = 2; j < zh - 2; j += st) for (let i = 2; i < zw - 2; i += st) {
    const c = Z[j * zw + i]; if ((c !== TZ.GARDEN || fieldsOnly) && c !== TZ.FIELD) continue;
    const isEdge = c === TZ.GARDEN ? front : lane;
    if (!isEdge[Z[j * zw + i + 2]] && !isEdge[Z[j * zw + i - 2]] && !isEdge[Z[(j + 2) * zw + i]] && !isEdge[Z[(j - 2) * zw + i]]) continue;   // (inside the plot)
    let ex = 0, ez = 0, cnt = 0;   // the outward direction: sum over the 5x5 ring of the neighbours across the edge
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { if (!di && !dj) continue; if (isEdge[at(i + di, j + dj)]) { ex += di; ez += dj; cnt++; } }
    if (!cnt || cnt > 14) continue;
    const L = Math.hypot(ex, ez); if (L < 0.5) continue;
    const nx = ex / L, nz = ez / L, x = T.x0 + i + 0.5 - nx * 0.1, z = T.z0 + j + 0.5 - nz * 0.1;
    // one decision per plot of frontage (22 m) or per field side (60 m)
    const plot = c === TZ.GARDEN ? 22 : 60, ph = hash2(Math.floor(x / plot) + 4099, Math.floor(z / plot) + 7919), north = z < -2000;
    let kind = -1, h = 1.4;
    if (c === TZ.FIELD) { if (ph < 0.82) { kind = UKS.HEDGE_HAWTHORN; h = lerp(1.8, 2.8, hash2(i >> 3, j >> 3)); } }
    else if (north) kind = ph < 0.26 ? UKS.HEDGE_ESCALLONIA : ph < 0.46 ? UKS.HEDGE_LEYLAND : ph < 0.62 ? UKS.HEDGE_PRIVET : ph < 0.72 ? UKS.HEDGE_HAWTHORN : -1;
    else kind = ph < 0.3 ? UKS.HEDGE_PRIVET : ph < 0.4 ? UKS.HEDGE_ESCALLONIA : ph < 0.47 ? UKS.HEDGE_BEECH : ph < 0.53 ? UKS.HEDGE_LEYLAND : -1;
    if (kind < 0) continue;
    if (c === TZ.GARDEN) h = kind === UKS.HEDGE_LEYLAND ? lerp(1.8, 2.8, fract(ph * 7.1)) : lerp(0.9, 1.6, fract(ph * 5.3));
    // spacing: no module within ~1.4 m (a coarse grid of accepted positions)
    const gi = Math.floor(x / gs), gj = Math.floor(z / gs); let close = false;
    for (let a = -1; a <= 1 && !close; a++) for (let b = -1; b <= 1 && !close; b++) { const q = near.get(gk(gi + a + 32768, gj + b + 32768)); if (q !== undefined && Math.hypot(q[0] - x, q[1] - z) < gs * (kind === UKS.HEDGE_HAWTHORN ? 1.45 : 1.05)) close = true; }
    if (close) continue;
    near.set(gk(gi + 32768, gj + 32768), [x, z]);
    const A = UK_ARCH[kind], s = h / A.P.H, w = A.P.W * s * 0.5;
    rot[0] = Math.atan2(nx, -nz);   // along the edge
    UKV.push(x - nx * w, hfAt(x - nx * w, z - nz * w) - 0.05, z - nz * w, s * lerp(0.95, 1.05, hash2(i, j)), rot[0] + (hash2(j, i) < 0.5 ? PI : 0), hash2(i + 7, j + 3), kind, 1);
    n++;
    if (kind === UKS.HEDGE_HAWTHORN && hash2(i * 3 + 1, j * 5 + 2) < 0.012) { const ht = lerp(11, 19, hash2(i, j + 9)); n += ukPlant(x - nx * w, hfAt(x, z), z - nz * w, ukTreeSpecies(UKC.FIELDEDGE, ht, 0, hash2(i + 5, j)), ht, 0, hash2(j, i + 1) * TAU, hash2(i + 2, j + 2)); }
  }
  UKV.stats.hedge += n;
  return n;
}
// British hedges for the town's boundary segments: TOWN.bsegs = [x0, z0, x1, z1, code, height, look] x n, code 3 =
// hedge (13_wsm_town.js, townBoundaries). Joins the pieces into polylines and plants them with ukHedge: hawthorn
// hedgerows along the village and country lanes (north of Worlebury Hill, or beside fields), elsewhere the front
// gardens' privet, escallonia, beech or Leyland cypress, one kind per ~22 m of frontage. For the town code to call in
// place of its green boxes for code 3 (then nothing else plants hedges there).
function ukBoundaryHedges(segs) {
  segs = segs || TOWN.bsegs; if (!segs || !UKV.push) return 0;
  const T = TOWN, zoneAt = (x, z) => { if (!T.zone) return TZ.OUT; const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= T.zw || j >= T.zh ? TZ.OUT : T.zone[j * T.zw + i]; };
  let n = 0, line = null, h = 0, lx = 1e9, lz = 1e9;
  const flush = () => {
    if (!line) return; const mx = line[line.length >> 1 & ~1], mz = line[(line.length >> 1 & ~1) + 1], north = mz < -2000;
    let field = false; for (let a = 0; a < 4 && !field; a++) field = zoneAt(mx + Math.cos(a * PI / 2) * 3, mz + Math.sin(a * PI / 2) * 3) === TZ.FIELD;
    const ph = hash2(Math.floor(mx / 22) + 4099, Math.floor(mz / 22) + 7919);
    const kind = field || (north && h >= 1.5) ? UKS.HEDGE_HAWTHORN : north ? (ph < 0.4 ? UKS.HEDGE_ESCALLONIA : ph < 0.7 ? UKS.HEDGE_PRIVET : UKS.HEDGE_LEYLAND)
      : ph < 0.55 ? UKS.HEDGE_PRIVET : ph < 0.72 ? UKS.HEDGE_ESCALLONIA : ph < 0.86 ? UKS.HEDGE_BEECH : UKS.HEDGE_LEYLAND;
    n += ukHedge(line, kind, { h: kind === UKS.HEDGE_HAWTHORN ? Math.max(1.8, h + 0.3) : h, seed: ph * 1000, trees: kind === UKS.HEDGE_HAWTHORN ? 1.5 : 0 });
    line = null;
  };
  for (let q = 0; q + 6 < segs.length; q += 7) {
    if (segs[q + 4] !== 3) continue;
    const ax = segs[q], az = segs[q + 1], bx = segs[q + 2], bz = segs[q + 3], hg = segs[q + 5] || 1.5;
    if (line && Math.abs(ax - lx) < 0.05 && Math.abs(az - lz) < 0.05 && Math.abs(hg - h) < 0.05) line.push(bx, bz);
    else { flush(); line = [ax, az, bx, bz]; h = hg; }
    lx = bx; lz = bz;
  }
  flush();
  return n;
}
// the floor of the woods along their roads, tracks and paths (where it is seen from): ivy carpet, ferns, bramble where
// the light comes in at the edge, holly seedlings; ~3.2 m apart up to 40 m into the wood
function ukWoodEdges() {
  const T = TOWN; if (!T.on || !T.zone) return 0;
  const Z = T.zone, zw = T.zw, zh = T.zh, rnd = mkRng(6151), gw = 3.2, way = new Uint8Array(18); for (const c of [TZ.ROAD, TZ.PATH, TZ.TRACK, TZ.KERB]) way[c] = 1;
  const at = (x, z) => { const i = (x - T.x0) | 0, j = (z - T.z0) | 0; return i < 0 || j < 0 || i >= zw || j >= zh ? TZ.OUT : Z[j * zw + i]; };
  let n = 0;
  for (let z0 = T.z0 + 16; z0 < T.z1 - 16; z0 += gw) for (let x0 = T.x0 + 16; x0 < T.x1 - 16; x0 += gw) {
    if (at(x0, z0) !== TZ.WOOD) continue;
    let d = 99; for (const r of [6, 14, 26, 40]) { for (let a = 0; a < 8; a++) if (way[at(x0 + Math.cos(a * 0.785) * r, z0 + Math.sin(a * 0.785) * r)]) { d = r; break; } if (d < 99) break; }
    if (d > 40) continue;
    const x = x0 + rnd() * gw, z = z0 + rnd() * gw; if (at(x, z) !== TZ.WOOD) continue;
    n += ukWoodFloor(x, hfAt(x, z), z, rnd(), d <= 6 ? 0.9 : d <= 14 ? 0.55 : 0.3);
  }
  return n;
}
// end of the town's planting: hedges from the zone raster if the map code laid none (only the field boundaries when the
// town builds its own front-garden and lane boundaries), the woods' floor along their ways if it planted none;
// ?nohedge, ?nofloor turn them off
function ukEnd() {
  const t = performance.now();
  if (TOWN.on && !UKV.stats.hedge && !Q.has('nohedge')) ukZoneHedges(!!TOWN.bsegs);
  UKV.time.zoneHedges = performance.now() - t;
  if (TOWN.on && !UKV.stats.floor && !Q.has('nofloor')) UKV.stats.floorAuto = ukWoodEdges();
  UKV.time.place = performance.now() - UKV.t0;
}
