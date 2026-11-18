// Architecture kit: detailed procedural buildings for Weston-super-Mare, Kewstoke and Sand Bay (?map=wsm), and its demo
// street (?scene=arch). Inert unless called: nothing here runs, builds or draws until archBuild() is called (or the demo
// street is asked for).
//
// ---- API (load time only; nothing per frame) ----------------------------------------------------------------------
//   archStyle(tags, area, height, x, z, ctx) -> style code (ARCH_S.*), ARCH_S.NONE = "not for the kit, draw it yourself"
//     tags:   {kind, look, lu, roof, rise, n} from the bake's binfo (kind 0..11, look 0..4, land use 0..3, roof 0..3, LIDAR
//             rise m), plus any OSM tags the bake may pass on later: building, shop, amenity, tourism, name, levels.
//     area:   footprint area (m²); height: eaves above the ground (m); x, z: centre of the footprint (game frame).
//     ctx:    optional {seaDist (m to the promenade), shopStreet (bool)}; without it the kit's own map of the districts
//             is used (seafront, town centre, Victorian/Edwardian streets, inter-war and post-war estates, Kewstoke,
//             Sand Bay and its holiday parks).
//   archBuild(fp, o) -> true when the kit takes the building (the caller then skips its own walls and roof for it)
//     fp:     footprint, flat [x0, z0, x1, z1, ...] in metres in the game frame (X east, Z south), any winding, without
//             a repeated closing point (an Array, Float32Array or Float64Array; copied).
//     o:      { y0:     lowest ground under the footprint (m, absolute)
//               eave:   eaves height (m, absolute; the top of the walls under a pitched roof, the roof of a flat one)
//               ridge:  ridge height (m, absolute; = eave for flat roofs; missing: from the style's pitch)
//               roof:   0 flat, 1 gabled, 2 hipped, 3 none (bake codes); missing: from the style
//               ridgeAng: direction of the ridge line in the XZ plane (radians, as binfo: angle of (cos, sin) in (x, z))
//               style:  archStyle() result (missing: archStyle from tags/area/height/position)
//               tags:   as for archStyle (used when style is missing, and for shop signs)
//               seed:   integer (the bake's per-building hash) for the per-building variation
//               front:  index i of the street-facing edge (from point i to point i+1), or -1
//               road:   [x, z] a point on the nearest street (used when front < 0: the edge facing it is the front)
//               gap:    distance (m) from the front wall to the back of the pavement: a front garden with its wall,
//                       railings or hedge is built when it is over 1 m (missing: none)
//               ground: optional (x, z) -> ground height, for doorsteps, floor levels and garden walls on slopes }
//   archFinish() -> stats: generates everything handed over (party walls and terrace rows are found between the
//     buildings first), uploads it and adds the drawables to R.drawables. Call once, after the last archBuild().
//   window.__cap.arch (when the kit is used): {stats, views (?scene=arch), view(name)} for the capture scripts.
//
// ---- what it builds -------------------------------------------------------------------------------------------------
//   shell (all distances, 128 m tiles): walls split into opening columns, pitched roofs with overhangs, fascias, soffits,
//     bargeboards, ridge and hip tiles, canted and square bays (gabled or hipped), chimney stacks on the party walls,
//     porches, shop fascias with their signs, awnings, balconies, dormers, conservatories, garden walls and hedges,
//     static caravans; the windows and doors are drawn by the shader (wgsl/mat_arch.wgsl): recessed by parallax, with
//     frames, sashes and glazing bars, reflecting glass, curtains, blinds and rooms behind them.
//   detail (instanced, within 160 m, 64 m cells): sills, heads, doorsteps, gutters and downpipes, chimney pots, gate piers,
//     railings, porch posts, aerials, caravan steps and verandas.
//   Each building's colours, materials and window programme live in one record (4 texels of a rgba32uint texture);
//   vertices carry the record index in their material bytes.
const ARCH_S = {
  NONE: 0, TERRACE: 1, VILLA: 2, HOTEL: 3, SHOP: 4, POSTWAR: 5, MODERN: 6, FLATS: 7, COMMERCIAL: 8, INDUSTRIAL: 9,
  BUNGALOW: 10, CHALET_BUNGALOW: 11, COTTAGE: 12, BARN: 13, CARAVAN: 14, CHALET: 15, PUB: 16, CAFE: 17, GARAGE: 18, DECO: 19,
};
const ARCH_SNAME = Object.keys(ARCH_S);
// wall materials (record), dressings, windows, doors, roof coverings: the shader reads the same numbers
const AW = { RENDER: 0, RUBBLE: 1, ASHLAR: 2, BRICK: 3, BUFF: 4, DASH: 5, BOARD: 6, METAL: 7, CARAVAN: 8, PANEL: 9, ROUGH: 10 };
const AD = { NONE: 0, BATH: 1, PAINTED: 2, BRICK: 3, CONCRETE: 4, DECO: 5, RUSTIC: 6 };
const AWIN = { SASH11: 0, SASH22: 1, SASH66: 2, EDW: 3, CASE: 4, UPVC: 5, MODERN: 6, RIBBON: 7, CRITTALL: 8, COTTAGE: 9, CARAVAN: 10, SHOP: 11 };
const ADOOR = { PANEL4: 0, PANEL6: 1, UPVC: 2, COMPOSITE: 3, LEDGED: 4, SHOP: 5, GARAGE: 6, ROLLER: 7, DOUBLE: 8, BARN: 9 };
const AROOF = { SLATE: 0, ROMAN: 1, PLAIN: 2, CONCRETE: 3, FELT: 4, METAL: 5, CARAVAN: 6, PANTILE: 7, GLASS: 8, LEAD: 9 };
// column programme (shell wall vertices, colour byte r): ground floor and upper floors, corners, bay faces, gables
const AC = { GWIN: 0, GDOOR: 1, GSHOP: 2, GNONE: 3, UWIN: 0, UNARROW: 4, UNONE: 8, UFRENCH: 12, QL: 16, QR: 32, BAY: 64, GABLE: 128 };
// material ids (mat_arch.wgsl)
const AM = {
  WALL: 40, ROOF: 41, RIDGE: 42, STONE: 43, PAINT: 44, GLASS: 45, SIGN: 46, AWNING: 47, HEDGE: 48, POT: 49, FLAT: 50, LEAD: 51,
  CARAVAN: 52, PAVING: 53, DARK: 54, METAL: 55,
  ROAD: 60, PAVE: 61, KERB: 62, GRASS: 63, SOIL: 64, TILES: 65, GRAVEL: 66, DECK: 67, LINE: 68,
};
// palettes (linear albedo)
const AP = {
  stone: [[0.3, 0.29, 0.27], [0.27, 0.27, 0.27], [0.33, 0.3, 0.26], [0.32, 0.28, 0.26], [0.26, 0.255, 0.24], [0.35, 0.33, 0.29]],   // grey Weston limestone rubble
  kew: [[0.3, 0.3, 0.29], [0.27, 0.27, 0.26], [0.33, 0.31, 0.28], [0.24, 0.24, 0.235]],                                          // Kewstoke's greyer, rougher limestone
  bath: [[0.6, 0.52, 0.37], [0.56, 0.49, 0.36], [0.64, 0.57, 0.42], [0.52, 0.46, 0.35]],                                        // Bath stone dressings
  bathPaint: [[0.74, 0.7, 0.58], [0.78, 0.77, 0.72], [0.72, 0.66, 0.5], [0.7, 0.68, 0.62]],                                     // painted dressings: cream, white
  render: [[0.78, 0.77, 0.73], [0.74, 0.7, 0.57], [0.76, 0.72, 0.62], [0.74, 0.67, 0.42], [0.56, 0.63, 0.68], [0.73, 0.61, 0.57], [0.6, 0.66, 0.56], [0.62, 0.62, 0.6], [0.66, 0.6, 0.5], [0.8, 0.79, 0.76]],
  seafront: [[0.8, 0.79, 0.75], [0.77, 0.73, 0.6], [0.79, 0.77, 0.7], [0.75, 0.7, 0.52], [0.78, 0.76, 0.72], [0.7, 0.74, 0.76]],
  brick: [[0.3, 0.11, 0.065], [0.25, 0.095, 0.06], [0.36, 0.16, 0.08], [0.22, 0.12, 0.08], [0.32, 0.17, 0.1], [0.28, 0.13, 0.08]],
  buff: [[0.48, 0.38, 0.24], [0.44, 0.36, 0.25], [0.52, 0.42, 0.28], [0.4, 0.31, 0.2]],
  dash: [[0.42, 0.4, 0.36], [0.46, 0.44, 0.4], [0.66, 0.65, 0.61], [0.62, 0.58, 0.5], [0.38, 0.37, 0.35]],
  board: [[0.78, 0.78, 0.76], [0.42, 0.47, 0.5], [0.3, 0.36, 0.34], [0.55, 0.53, 0.48], [0.16, 0.17, 0.18], [0.62, 0.66, 0.68]],
  clad: [[0.32, 0.34, 0.36], [0.16, 0.22, 0.3], [0.2, 0.27, 0.22], [0.5, 0.5, 0.48], [0.62, 0.62, 0.6], [0.1, 0.12, 0.14]],
  slate: [[0.052, 0.056, 0.066], [0.06, 0.058, 0.072], [0.045, 0.05, 0.058], [0.066, 0.068, 0.074]],
  roman: [[0.3, 0.12, 0.06], [0.26, 0.12, 0.07], [0.34, 0.15, 0.07], [0.22, 0.11, 0.07]],
  plain: [[0.26, 0.1, 0.055], [0.22, 0.09, 0.05], [0.3, 0.13, 0.07]],
  concrete: [[0.15, 0.09, 0.06], [0.12, 0.12, 0.12], [0.22, 0.1, 0.07], [0.17, 0.13, 0.1], [0.09, 0.09, 0.1]],
  felt: [[0.09, 0.09, 0.1], [0.14, 0.14, 0.14], [0.2, 0.2, 0.19]],
  trimWhite: [[0.8, 0.8, 0.78], [0.78, 0.78, 0.74], [0.74, 0.72, 0.64]],
  trimDark: [[0.02, 0.02, 0.022], [0.02, 0.055, 0.035], [0.08, 0.05, 0.03], [0.05, 0.055, 0.06], [0.2, 0.21, 0.22]],
  door: [[0.012, 0.012, 0.014], [0.012, 0.025, 0.08], [0.24, 0.018, 0.02], [0.012, 0.055, 0.028], [0.025, 0.07, 0.22], [0.55, 0.42, 0.05],
    [0.78, 0.78, 0.75], [0.18, 0.19, 0.2], [0.22, 0.28, 0.2], [0.11, 0.025, 0.05], [0.015, 0.13, 0.13], [0.18, 0.09, 0.035]],
  shopBg: [[0.02, 0.05, 0.12], [0.015, 0.06, 0.03], [0.25, 0.02, 0.02], [0.03, 0.03, 0.03], [0.75, 0.74, 0.7], [0.5, 0.36, 0.05], [0.1, 0.02, 0.12], [0.02, 0.15, 0.17], [0.6, 0.6, 0.58]],
  stripe: [[0.04, 0.12, 0.05], [0.03, 0.07, 0.2], [0.3, 0.03, 0.02], [0.15, 0.08, 0.03], [0.12, 0.12, 0.12], [0.02, 0.15, 0.17]],
  awning: [[0.25, 0.02, 0.02], [0.02, 0.06, 0.15], [0.02, 0.1, 0.04], [0.32, 0.2, 0.02], [0.05, 0.05, 0.05]],
};
const archPick = (a, h) => a[Math.min(a.length - 1, Math.floor(h * a.length))];
// generic sign words (drawn by the kit; no brands)
const ARCH_SIGNS = ['CAFE', 'BAKERY', 'CHEMIST', 'FISH & CHIPS', 'GIFTS', 'ARCADE', 'BOOKS', 'NEWSAGENT', 'BUTCHER', 'FLORIST', 'BARBER',
  'HAIR SALON', 'ESTATE AGENT', 'OPTICIAN', 'CHARITY SHOP', 'TAKEAWAY', 'PIZZA', 'DELI', 'HARDWARE', 'ANTIQUES', 'TOYS', 'SHOES', 'FASHION',
  'JEWELLER', 'PHONE REPAIRS', 'TEA ROOM', 'BISTRO', 'RESTAURANT', 'ICE CREAM', 'BEACH SHOP', 'AMUSEMENTS', 'ROCK & FUDGE', 'HOTEL', 'GUEST HOUSE',
  'VACANCIES', 'INN', 'BAR', 'BED & BREAKFAST', 'LAUNDERETTE', 'CONVENIENCE STORE', 'BUILDING SUPPLIES', 'TYRES', 'CARPETS', 'SURF SHOP', 'FUDGE', 'KEBAB', 'FURNITURE', 'BIKES'];
const ARCH_SIGN_IX = {}; ARCH_SIGNS.forEach((s, i) => { ARCH_SIGN_IX[s] = i; });
const ARCH_SHOP_TAG = { bakery: 'BAKERY', chemist: 'CHEMIST', pharmacy: 'CHEMIST', books: 'BOOKS', newsagent: 'NEWSAGENT', butcher: 'BUTCHER', florist: 'FLORIST',
  hairdresser: 'HAIR SALON', barber: 'BARBER', estate_agent: 'ESTATE AGENT', optician: 'OPTICIAN', charity: 'CHARITY SHOP', gift: 'GIFTS', toys: 'TOYS',
  shoes: 'SHOES', clothes: 'FASHION', jewelry: 'JEWELLER', mobile_phone: 'PHONE REPAIRS', hardware: 'HARDWARE', doityourself: 'HARDWARE', antiques: 'ANTIQUES',
  deli: 'DELI', convenience: 'CONVENIENCE STORE', laundry: 'LAUNDERETTE', tyres: 'TYRES', carpet: 'CARPETS', furniture: 'FURNITURE', bicycle: 'BIKES', confectionery: 'ROCK & FUDGE' };
const ARCH_AMENITY_TAG = { cafe: 'CAFE', restaurant: 'RESTAURANT', fast_food: 'TAKEAWAY', pub: 'INN', bar: 'BAR', ice_cream: 'ICE CREAM' };
const ARCH_SIGN_SEA = ['CAFE', 'GIFTS', 'ARCADE', 'FISH & CHIPS', 'ICE CREAM', 'ROCK & FUDGE', 'AMUSEMENTS', 'BEACH SHOP', 'TEA ROOM', 'FUDGE', 'SURF SHOP', 'BAR'];
const ARCH_SIGN_TOWN = ['BAKERY', 'CHEMIST', 'BOOKS', 'NEWSAGENT', 'BUTCHER', 'FLORIST', 'BARBER', 'HAIR SALON', 'ESTATE AGENT', 'OPTICIAN', 'CHARITY SHOP',
  'TAKEAWAY', 'PIZZA', 'DELI', 'HARDWARE', 'ANTIQUES', 'TOYS', 'SHOES', 'FASHION', 'JEWELLER', 'PHONE REPAIRS', 'CAFE', 'BISTRO', 'KEBAB', 'LAUNDERETTE', 'CONVENIENCE STORE', 'FISH & CHIPS', 'TEA ROOM'];

// ---------------------------------------------------------------- the districts (game frame: X east, Z south, origin
// at the entrance of the Grand Pier). Measured from the baked map: the landward edge of the beach, the shopping
// streets, the extent of the Victorian and Edwardian town, Kewstoke and Sand Bay.
const ARCH_PROM = [-1050, -760, -760, -640, -430, -450, -180, -350, -85, -250, -20, -150, -5, -50, 30, 50, 45, 150, 52, 450, 45, 650, 25, 800, 5, 950, -35, 1150, -60, 1400, -80, 1700, -90, 2050];
function archSeaDist(x, z) {
  const P = ARCH_PROM; let best = 1e9;
  for (let i = 0; i + 3 < P.length; i += 2) {
    const ax = P[i], az = P[i + 1], ex = P[i + 2] - ax, ez = P[i + 3] - az, t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}
// 'sandbay' | 'kewstoke' | 'seafront' | 'centre' | 'victorian' | 'interwar' | 'modern'
function archDistrict(x, z, ctx) {
  if (Math.hypot(x - 1764, z + 1891) < 430 && z > -2250) return 'kewstoke';
  if (z < -1950 && x > 1050) return 'sandbay';
  const sea = ctx && ctx.seaDist !== undefined ? ctx.seaDist : archSeaDist(x, z);
  if (sea < 125 && z > -900 && z < 1750) return 'seafront';
  if (x > 70 && x < 600 && z > -340 && z < 340) return 'centre';
  // the Victorian and Edwardian town: the hillside below Worlebury, the grid east of the centre to the railway, the
  // streets around Ellenborough Park, Clevedon Road, Walliscote Road and Moorland Road down to Uphill Road North
  if ((x > -1100 && x < 1150 && z > -1000 && z < 460) || (x > -50 && x < 760 && z >= 460 && z < 2150) || (x > 760 && x < 1000 && z >= 460 && z < 1150)) return 'victorian';
  if (x > 1900 || z > 2600 || (z < -1000 && x > 2300)) return 'modern';
  return 'interwar';
}
function archStyle(t, area, height, x, z, ctx) {
  t = t || {}; const kind = t.kind | 0, look = t.look | 0, lu = t.lu | 0, b = t.building || '';
  const rise = t.rise === undefined ? -1 : t.rise;
  if (kind === 4 || kind === 8 || kind === 9 || kind === 11 || look === 2 || look === 3) return ARCH_S.NONE;   // churches, the pier, ruins, shelters, landmarks
  if (look === 4 && kind !== 0 && kind !== 1) return ARCH_S.NONE;
  const dist = archDistrict(x, z, ctx);
  // static caravans: tagged, or as the bake finds them in the holiday parks (small white rectangles under a shallow roof)
  if (b === 'static_caravan' || (look === 1 && kind === 0 && area < 75 && height < 4.2 && (t.n === undefined || t.n === 4) && (rise < 0 || rise < 0.5))) return ARCH_S.CARAVAN;
  const am = t.amenity || '', tour = t.tourism || '';
  if (am === 'pub' || am === 'bar') return ARCH_S.PUB;
  if (am === 'cafe' || am === 'ice_cream' || am === 'restaurant' || am === 'fast_food') return dist === 'sandbay' || (area < 90 && height < 4.5) ? ARCH_S.CAFE : ARCH_S.SHOP;
  if (tour === 'hotel' || tour === 'guest_house' || kind === 10 || look === 1) return dist === 'sandbay' || dist === 'kewstoke' ? ARCH_S.PUB : ARCH_S.HOTEL;
  if (tour === 'chalet' || b === 'cabin') return ARCH_S.CHALET;
  if (kind === 7 || b === 'garage' || b === 'garages' || b === 'shed') return ARCH_S.GARAGE;
  if (kind === 5 || lu === 3 || b === 'industrial' || b === 'warehouse') return area < 120 && dist === 'kewstoke' ? ARCH_S.BARN : ARCH_S.INDUSTRIAL;
  if (b === 'barn' || b === 'farm_auxiliary' || b === 'stable') return ARCH_S.BARN;
  if (kind === 3 || b === 'retail' || b === 'commercial' || b === 'shop' || b === 'kiosk' || t.shop) {
    if (area > 900) return ARCH_S.COMMERCIAL;
    if (dist === 'sandbay' || (area < 60 && height < 4.5)) return ARCH_S.CAFE;
    return ARCH_S.SHOP;
  }
  if (kind === 6) return area > 600 || dist === 'modern' || dist === 'interwar' ? ARCH_S.COMMERCIAL : ARCH_S.VILLA;
  const low = height > 0 && height < 3.5;
  const chalet = low && rise > 3.2;
  if (kind === 2) {
    if ((dist === 'victorian' || dist === 'seafront' || dist === 'centre') && area < 420 && height < 13) return dist === 'seafront' ? ARCH_S.HOTEL : ARCH_S.VILLA;
    return ARCH_S.FLATS;
  }
  // houses and terraces
  if (b === 'bungalow' || (low && !chalet)) return dist === 'kewstoke' && look === 4 ? ARCH_S.COTTAGE : ARCH_S.BUNGALOW;
  if (chalet) return ARCH_S.CHALET_BUNGALOW;
  if (area > 700) return ARCH_S.FLATS;
  if (dist === 'kewstoke') return look === 4 ? ARCH_S.COTTAGE : (hash2(x | 0, z | 0) < 0.3 ? ARCH_S.COTTAGE : ARCH_S.POSTWAR);
  if (dist === 'sandbay') return height < 4.2 ? ARCH_S.BUNGALOW : hash2(x | 0, z | 0) < 0.35 ? ARCH_S.CHALET_BUNGALOW : ARCH_S.MODERN;
  if (dist === 'seafront') return height > 7.5 || area > 160 ? ARCH_S.HOTEL : ARCH_S.TERRACE;
  if (dist === 'centre') return lu === 2 || (ctx && ctx.shopStreet) ? ARCH_S.SHOP : ARCH_S.TERRACE;
  if (dist === 'victorian') return area > 150 || kind === 2 ? ARCH_S.VILLA : ARCH_S.TERRACE;
  if (dist === 'modern') return ARCH_S.MODERN;
  // inter-war and post-war belt: a few modernist (1930s) houses among the semis
  return hash2((x * 0.05) | 0, (z * 0.05) | 0) < 0.04 ? ARCH_S.DECO : ARCH_S.POSTWAR;
}

// ---------------------------------------------------------------- state
const ARCH = {
  on: false, reqs: [], stats: {}, fam: null, famP: null, shell: null, props: null, recTex: null, signTex: null,
  views: null, scene: GAME.mode === 'arch',
};
function archInit() { ARCH.on = true; }
function archBuild(fp, o) {
  o = o || {};
  const n = (fp.length / 2) | 0; if (n < 3) return false;
  const p = new Float64Array(n * 2); for (let i = 0; i < n * 2; i++) p[i] = fp[i];
  let a = 0, cx = 0, cz = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; cx += p[i * 2]; cz += p[i * 2 + 1]; }
  a /= 2; cx /= n; cz /= n;
  let front = o.front === undefined ? -1 : o.front;
  if (a < 0) {   // positive area in (x, z): the outward normal of edge a->b is (dz, -dx)
    for (let i = 0, j = n - 1; i < j; i++, j--) { const tx = p[i * 2], tz = p[i * 2 + 1]; p[i * 2] = p[j * 2]; p[i * 2 + 1] = p[j * 2 + 1]; p[j * 2] = tx; p[j * 2 + 1] = tz; }
    if (front >= 0) front = (2 * n - 2 - front) % n;   // edge i (i -> i+1) is now edge n-2-i
    a = -a;
  }
  if (a < 6 || n > 96) return false;
  const y0 = o.y0 === undefined ? 0 : o.y0, eave = o.eave === undefined ? y0 + 6 : o.eave;
  const style = o.style !== undefined ? o.style : archStyle(o.tags, a, eave - y0, cx, cz);
  if (!style) return false;
  ARCH.on = true;
  ARCH.reqs.push({ p, n, area: a, cx, cz, y0, eave, ridge: o.ridge, roof: o.roof, ridgeAng: o.ridgeAng, style, tags: o.tags || {}, seed: (o.seed === undefined ? hash2(cx * 7 | 0, cz * 7 | 0) * 4294967296 : o.seed) >>> 0,
    front, road: o.road || null, gap: o.gap === undefined ? 0 : o.gap, ground: o.ground || null, party: null, nb: null, group: -1, idx: ARCH.reqs.length });
  return true;
}

// ---------------------------------------------------------------- polygon helpers (u, v arrays)
function aArea(us, vs) { let a = 0; const n = us.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += us[i] * vs[j] - us[j] * vs[i]; } return a / 2; }
// keeps the part with a*u + b*v <= c (Sutherland-Hodgman)
function aClip(us, vs, a, b, c) {
  const n = us.length, ou = [], ov = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, si = a * us[i] + b * vs[i] - c, sj = a * us[j] + b * vs[j] - c;
    if (si <= 0) { ou.push(us[i]); ov.push(vs[i]); }
    if ((si <= 0) !== (sj <= 0)) { const t = si / (si - sj); ou.push(us[i] + (us[j] - us[i]) * t); ov.push(vs[i] + (vs[j] - vs[i]) * t); }
  }
  return [ou, ov];
}
// ear clipping of a polygon with positive area: index triples
function aEars(us, vs) {
  const n = us.length, idx = [], out = []; for (let i = 0; i < n; i++) idx.push(i);
  let guard = 0;
  while (idx.length > 3 && guard++ < 4 * n + 20) {
    const m = idx.length; let best = -1, bestC = 1e18, done = false;
    for (let i = 0; i < m; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      const cr = (us[b] - us[a]) * (vs[c] - vs[a]) - (vs[b] - vs[a]) * (us[c] - us[a]);
      if (Math.abs(cr) < bestC) { bestC = Math.abs(cr); best = i; }
      if (cr <= 1e-9) continue;
      let ok = true;
      for (let j = 0; j < m && ok; j++) {
        const q = idx[j]; if (q === a || q === b || q === c) continue;
        const px = us[q], pv = vs[q];
        const d1 = (us[b] - us[a]) * (pv - vs[a]) - (vs[b] - vs[a]) * (px - us[a]), d2 = (us[c] - us[b]) * (pv - vs[b]) - (vs[c] - vs[b]) * (px - us[b]), d3 = (us[a] - us[c]) * (pv - vs[c]) - (vs[a] - vs[c]) * (px - us[c]);
        if (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) ok = false;
      }
      if (!ok) continue;
      out.push(a, b, c); idx.splice(i, 1); done = true; break;
    }
    if (!done) idx.splice(best, 1);
  }
  if (idx.length === 3) { const [a, b, c] = idx; if ((us[b] - us[a]) * (vs[c] - vs[a]) - (vs[b] - vs[a]) * (us[c] - us[a]) > 1e-9) out.push(a, b, c); }
  return out;
}
// offset of a polygon with positive area, each edge by its own distance (mitred; the mitre is limited at sharp corners)
function aOffset(us, vs, ds) {
  const n = us.length, ou = new Array(n), ov = new Array(n);
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n, j = (i + 1) % n;
    let ax = us[i] - us[h], av = vs[i] - vs[h], la = Math.hypot(ax, av) || 1; ax /= la; av /= la;
    let bx = us[j] - us[i], bv = vs[j] - vs[i], lb = Math.hypot(bx, bv) || 1; bx /= lb; bv /= lb;
    const nax = av, nav = -ax, nbx = bv, nbv = -bx, da = ds[h], db = ds[i];   // outward normals (positive area)
    // intersection of the two offset lines
    const den = ax * bv - av * bx;
    if (Math.abs(den) < 1e-4) { const d = Math.max(da, db); ou[i] = us[i] + nbx * d; ov[i] = vs[i] + nbv * d; continue; }
    const px = us[i] + nax * da - (us[i] + nbx * db), pv = vs[i] + nav * da - (vs[i] + nbv * db);
    const t = (px * av - pv * ax) / den;   // along b from the b offset point
    let x = us[i] + nbx * db + bx * t, v = vs[i] + nbv * db + bv * t;
    const lim = 2.5 * Math.max(da, db, 0.05), dx = x - us[i], dv = v - vs[i], l = Math.hypot(dx, dv);
    if (l > lim) { x = us[i] + dx / l * lim; v = vs[i] + dv / l * lim; }
    ou[i] = x; ov[i] = v;
  }
  return [ou, ov];
}
function aConvex(us, vs) { const n = us.length; for (let i = 0; i < n; i++) { const h = (i + n - 1) % n, j = (i + 1) % n; if ((us[i] - us[h]) * (vs[j] - vs[i]) - (vs[i] - vs[h]) * (us[j] - us[i]) < -1e-6) return false; } return true; }

// ---------------------------------------------------------------- party walls and terrace rows
// An edge is a party wall where another building's edge runs back along it within 0.5 m; the overlapped fraction of its
// length is kept (party[i]) with the neighbour (nb[i]). Buildings joined by party walls form a row (group) that shares
// its materials, heights and bays, as a terrace does.
function archParty() {
  const Rq = ARCH.reqs, cell = 6, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const r of Rq) {
    r.party = new Float32Array(r.n); r.nb = new Int32Array(r.n).fill(-1);
    for (let i = 0; i < r.n; i++) {
      const j = (i + 1) % r.n, mx = (r.p[i * 2] + r.p[j * 2]) / 2, mz = (r.p[i * 2 + 1] + r.p[j * 2 + 1]) / 2, k = key(Math.floor(mx / cell), Math.floor(mz / cell));
      let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(r.idx, i);
    }
  }
  const par = new Int32Array(Rq.length); for (let i = 0; i < par.length; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (const r of Rq) for (let i = 0; i < r.n; i++) {
    const j = (i + 1) % r.n, ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[j * 2], bz = r.p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.4) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2, ci = Math.floor(mx / cell), cj = Math.floor(mz / cell);
    let best = 0, bn = -1;
    for (let gj = cj - 2; gj <= cj + 2; gj++) for (let gi = ci - 2; gi <= ci + 2; gi++) {
      const a = grid.get(key(gi, gj)); if (!a) continue;
      for (let q = 0; q < a.length; q += 2) {
        const o = Rq[a[q]]; if (o === r) continue;
        const e = a[q + 1], f = (e + 1) % o.n, ox = o.p[e * 2], oz = o.p[e * 2 + 1], px = o.p[f * 2], pz = o.p[f * 2 + 1], ol = Math.hypot(px - ox, pz - oz); if (ol < 0.4) continue;
        if (((px - ox) * dx + (pz - oz) * dz) / ol > -0.96) continue;                                  // runs back along this one
        if (Math.abs((ox - ax) * dz - (oz - az) * dx) > 0.5 || Math.abs((px - ax) * dz - (pz - az) * dx) > 0.5) continue;
        const t0 = (ox - ax) * dx + (oz - az) * dz, t1 = (px - ax) * dx + (pz - az) * dz;
        const ov = Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
        if (ov / L > best) { best = ov / L; bn = o.idx; }
      }
    }
    r.party[i] = Math.min(1, best); r.nb[i] = bn;
    if (best > 0.45 && bn >= 0) { const a = find(r.idx), b = find(bn); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
  }
  for (const r of Rq) r.group = find(r.idx);
}

// ---------------------------------------------------------------- records (4 texels of rgba32uint per building)
const aRGB = c => (Math.round(sat(c[0]) * 255) | (Math.round(sat(c[1]) * 255) << 8) | (Math.round(sat(c[2]) * 255) << 16)) >>> 0;
const aCm2 = (m, mx) => Math.max(0, Math.min(mx === undefined ? 255 : mx, Math.round(m * 50)));   // metres -> 2 cm units
function archRecord(st) {
  const R = AG.rec, k = AG.nrec++;
  if ((k + 1) * 16 > R.length) { const n = new Uint32Array(R.length * 2); n.set(R); AG.rec = n; }
  const o = k * 16, A = AG.rec;
  A[o] = aRGB(st.wallCol) | (st.wallMat << 24); A[o + 1] = aRGB(st.dressCol) | (st.dress << 24); A[o + 2] = aRGB(st.trimCol) | (st.win << 24);
  A[o + 3] = aRGB(st.doorCol) | (st.door << 24); A[o + 4] = aRGB(st.roofCol) | (st.roofCov << 24); A[o + 5] = aRGB(st.accentCol || st.trimCol) | ((st.flags & 255) << 24);
  A[o + 6] = Math.min(1023, Math.round(st.gH * 100)) | (Math.min(1023, Math.round(st.uH * 100)) << 10) | (Math.min(15, st.storeys) << 20) | (Math.min(63, Math.round(st.recess * 100)) << 24);
  A[o + 7] = aCm2(st.gWinH) | (aCm2(st.uWinH) << 8) | (aCm2(st.gSill) << 16) | (aCm2(st.uSill) << 24);
  A[o + 8] = st.hash >>> 0;
  A[o + 9] = (st.sign & 255) | ((st.signBg & 255) << 8) | ((st.signFg & 255) << 16) | ((st.signStyle & 255) << 24);
  A[o + 10] = aCm2(st.doorH) | (aCm2(st.doorW) << 8) | (aCm2(st.fanH) << 16) | (Math.min(255, Math.round(st.porchD * 100)) << 24);
  A[o + 11] = aCm2(st.shopTop || 0) | (aCm2(st.riser || 0) << 8) | ((st.glazing & 255) << 16) | ((st.interior & 255) << 24);
  A[o + 12] = aRGB(st.curtainA || [0.5, 0.4, 0.3]) | ((st.curtainMix & 255) << 24); A[o + 13] = aRGB(st.curtainB || [0.3, 0.3, 0.35]);
  A[o + 14] = 0; A[o + 15] = 0;
  return k;
}

// ---------------------------------------------------------------- the look of a building: materials, colours, window
// programme, bays and porches. g: generator seeded per row (shared along a terrace), h: per house.
function archLook(r) {
  const S = ARCH_S, s = r.style, grp = ARCH.reqs[r.group] || r, g = mkRng(grp.seed ^ 0x5bd1e995), h = mkRng(r.seed ^ 0x27d4eb2d), dist = archDistrict(r.cx, r.cz);
  const st = {
    style: s, dist, wallMat: AW.RENDER, wallCol: [0.7, 0.7, 0.68], dress: AD.NONE, dressCol: [0.7, 0.7, 0.68], trimCol: archPick(AP.trimWhite, h()), win: AWIN.UPVC,
    door: ADOOR.UPVC, doorCol: archPick(AP.door, h()), roofCov: AROOF.CONCRETE, roofCol: archPick(AP.concrete, g()), accentCol: null, flags: 0,
    gH: 3.0, uH: 2.8, storeys: 2, gWinH: 1.2, uWinH: 1.15, gSill: 0.85, uSill: 0.85, winW: 1.2, recess: 0.08, doorW: 0.95, doorH: 2.1, fanH: 0, porchD: 0.12,
    bay: 'none', bayW: 2.3, bayP: 0.6, porch: 'none', chimney: 'party', boundary: 'none', wallH: 0.8, hedge: false, rails: false, garage: false,
    pitch: 0.75, ovE: 0.3, ovV: 0.15, ridgeCol: null, fascia: archPick(AP.trimWhite, g()), gutter: [0.02, 0.02, 0.02], hash: r.seed, sign: 255, signBg: 0, signFg: 0, signStyle: 0,
    glazing: 0, interior: (h() * 255) | 0, curtainA: null, curtainB: null, curtainMix: (h() * 255) | 0, unitW: 5.2, mirror: 0, pots: 2, aerial: h() < 0.45, dish: h() < 0.12, alarm: h() < 0.3, bins: h() < 0.6,
    shopTop: 0, riser: 0, awning: false, balcony: false, dormers: false, conservatory: false, cottage: false,
  };
  const C = (a, rr) => archPick(a, rr());
  st.curtainA = archPick([[0.55, 0.45, 0.32], [0.45, 0.12, 0.1], [0.2, 0.25, 0.4], [0.6, 0.58, 0.5], [0.25, 0.35, 0.22], [0.4, 0.3, 0.38], [0.7, 0.66, 0.55]], h());
  st.curtainB = archPick([[0.75, 0.74, 0.7], [0.62, 0.55, 0.45], [0.3, 0.3, 0.32], [0.5, 0.42, 0.3]], h());
  const upvc = h() < 0.62;                                                       // windows replaced in uPVC (most houses)
  if (s === S.TERRACE || s === S.VILLA || s === S.SHOP || s === S.HOTEL) {
    // Victorian and Edwardian: grey Weston stone with Bath stone dressings, or render; slate or Bridgwater clay roofs
    const stone = s === S.HOTEL ? g() < 0.25 : s === S.SHOP ? g() < 0.45 : g() < (dist === 'seafront' ? 0.35 : 0.66);
    if (stone) {
      st.wallMat = AW.RUBBLE; st.wallCol = C(AP.stone, g); st.dress = AD.BATH; st.dressCol = g() < 0.55 ? C(AP.bathPaint, g) : C(AP.bath, g);
      st.flags |= 1 | 4;                                                          // quoins, plinth
    } else {
      st.wallMat = g() < 0.12 ? AW.ROUGH : AW.RENDER; st.wallCol = C(dist === 'seafront' || s === S.HOTEL ? AP.seafront : AP.render, g); st.dress = AD.PAINTED;
      if (g() < 0.5 && s !== S.HOTEL) st.wallCol = C(AP.render, h);              // each house of a rendered row painted by its owner
      st.dressCol = h() < 0.6 ? [0.8, 0.8, 0.77] : C(AP.bathPaint, h); st.flags |= 4 | (g() < 0.35 ? 1 : 0) | (g() < 0.4 ? 8 : 0);   // plinth, quoins, rusticated ground floor
    }
    if (g() < 0.5) st.flags |= 2;                                                // string course
    if (g() < 0.4) st.flags |= 16;                                               // eaves cornice / brackets
    const slate = g() < (s === S.HOTEL ? 0.85 : 0.62);
    st.roofCov = slate ? AROOF.SLATE : g() < 0.8 ? AROOF.ROMAN : AROOF.CONCRETE;
    st.roofCol = st.roofCov === AROOF.SLATE ? C(AP.slate, g) : st.roofCov === AROOF.ROMAN ? C(AP.roman, g) : C(AP.concrete, g);
    st.ridgeCol = st.roofCov === AROOF.SLATE ? (g() < 0.6 ? [0.24, 0.1, 0.06] : [0.1, 0.1, 0.11]) : [st.roofCol[0] * 0.85, st.roofCol[1] * 0.85, st.roofCol[2] * 0.85];
    st.win = upvc ? AWIN.UPVC : archPick([AWIN.SASH11, AWIN.SASH22, AWIN.SASH22, AWIN.EDW], g()); st.recess = upvc ? 0.1 : 0.13;
    st.trimCol = upvc ? [0.8, 0.8, 0.78] : C(AP.trimWhite, g);
    st.door = h() < 0.55 ? ADOOR.PANEL4 : h() < 0.6 ? ADOOR.UPVC : ADOOR.COMPOSITE; st.fanH = 0.42; st.doorW = 0.92; st.doorH = 2.55;
    st.porch = 'recess'; st.porchD = 0.75 + g() * 0.3;
    st.gH = 3.2 + g() * 0.25; st.uH = 2.95 + g() * 0.2; st.gWinH = 1.9 + g() * 0.2; st.uWinH = 1.65 + g() * 0.15; st.gSill = 0.62; st.uSill = 0.62; st.winW = 0.95 + g() * 0.15;
    st.pitch = 0.62 + g() * 0.25; st.ovE = 0.32; st.ovV = 0.18;
    const bt = g();
    st.bay = s === S.SHOP ? 'none' : bt < 0.4 ? 'c2g' : bt < 0.72 ? 'c2' : bt < 0.9 ? 'c1' : 's1';
    if (s === S.HOTEL) st.bay = g() < 0.6 ? 'c3' : 'c2';
    st.bayW = 2.25 + g() * 0.35; st.bayP = 0.55 + g() * 0.15;
    st.chimney = 'party'; st.pots = 2 + ((g() * 3) | 0);
    st.boundary = s === S.SHOP ? 'none' : 'wall'; st.wallH = 0.7 + g() * 0.3; st.rails = g() < 0.3; st.hedge = h() < 0.35;
    st.unitW = s === S.VILLA ? 9 : s === S.HOTEL ? 7.5 : s === S.SHOP ? 5.5 : 5.1;
    if (s === S.VILLA) { st.gH += 0.2; st.uH += 0.15; st.bayW += 0.3; st.porch = g() < 0.5 ? 'recess' : 'canopy'; st.dormers = g() < 0.3; }
    if (s === S.HOTEL) { st.balcony = g() < 0.65; st.porch = 'canopy'; st.flags |= 16; st.uH = 3.05; st.unitW = 7.0; st.boundary = g() < 0.5 ? 'wall' : 'none'; st.rails = true; }
    if (s === S.SHOP) {
      st.shopTop = 3.6 + g() * 0.4; st.gH = st.shopTop + 0.35; st.riser = 0.45 + g() * 0.2; st.glazing = (h() * 4) | 0; st.awning = h() < 0.35;
      const w = r.tags && (ARCH_SHOP_TAG[r.tags.shop] || ARCH_AMENITY_TAG[r.tags.amenity]);
      const list = dist === 'seafront' ? ARCH_SIGN_SEA : ARCH_SIGN_TOWN, wd = w || archPick(list, h());
      st.sign = ARCH_SIGN_IX[wd]; st.signBg = (h() * AP.shopBg.length) | 0; st.signFg = h() < 0.7 ? 0 : 1; st.signStyle = (h() * 4) | 0;
      st.interior = 128 | ((h() * 127) | 0); st.flags |= 64;                     // a lit shop interior
    }
  } else if (s === S.POSTWAR || s === S.DECO || s === S.MODERN || s === S.BUNGALOW || s === S.CHALET_BUNGALOW || s === S.CHALET) {
    const brick = s === S.MODERN ? g() < 0.8 : s === S.CHALET ? false : g() < 0.55;
    if (brick) { st.wallMat = g() < 0.7 ? AW.BRICK : AW.BUFF; st.wallCol = st.wallMat === AW.BRICK ? C(AP.brick, g) : C(AP.buff, g); st.dress = s === S.MODERN ? AD.BRICK : AD.CONCRETE; st.dressCol = [0.5, 0.49, 0.46]; }
    else { st.wallMat = g() < 0.6 ? AW.DASH : AW.RENDER; st.wallCol = C(st.wallMat === AW.DASH ? AP.dash : AP.render, g); if (h() < 0.4) st.wallCol = C(AP.dash, h); st.dress = AD.CONCRETE; st.dressCol = [0.5, 0.49, 0.46]; }
    st.roofCov = g() < 0.82 ? AROOF.CONCRETE : AROOF.ROMAN; st.roofCol = st.roofCov === AROOF.CONCRETE ? C(AP.concrete, g) : C(AP.roman, g);
    st.ridgeCol = [st.roofCol[0] * 0.9, st.roofCol[1] * 0.9, st.roofCol[2] * 0.9];
    st.win = AWIN.UPVC; st.trimCol = h() < 0.85 ? [0.8, 0.8, 0.78] : C(AP.trimDark, h); st.recess = 0.08;
    st.door = h() < 0.6 ? ADOOR.UPVC : ADOOR.COMPOSITE; st.doorW = 0.9; st.doorH = 2.05; st.fanH = 0;
    st.gH = 2.65; st.uH = 2.55; st.gWinH = 1.2; st.uWinH = 1.1; st.gSill = 0.9; st.uSill = 0.9; st.winW = 1.6;
    st.porch = g() < 0.55 ? 'box' : 'canopy'; st.porchD = 0.12; st.pitch = 0.62 + g() * 0.2; st.ovE = 0.28; st.ovV = 0.12;
    st.bay = g() < 0.25 ? 's1' : 'none'; st.bayW = 2.4; st.bayP = 0.55;
    st.chimney = s === S.MODERN ? 'none' : g() < 0.7 ? 'party' : 'mid'; st.pots = 1 + ((g() * 2) | 0);
    st.boundary = g() < 0.45 ? 'wall' : g() < 0.6 ? 'hedge' : 'none'; st.wallH = 0.55 + g() * 0.35; st.hedge = st.boundary === 'hedge';
    st.unitW = s === S.MODERN ? 6.5 : 7.4; st.garage = s === S.MODERN ? g() < 0.55 : false;
    if (s === S.DECO) { st.wallMat = AW.RENDER; st.wallCol = [0.8, 0.79, 0.75]; st.dress = AD.DECO; st.dressCol = [0.72, 0.72, 0.7]; st.win = upvc ? AWIN.UPVC : AWIN.CRITTALL; st.trimCol = upvc ? [0.8, 0.8, 0.78] : [0.06, 0.07, 0.06]; st.chimney = 'none'; st.bay = 'none'; st.porch = 'canopy'; }
    if (s === S.BUNGALOW || s === S.CHALET_BUNGALOW) {
      st.storeys = 1; st.gH = 2.6; st.chimney = g() < 0.45 ? 'mid' : 'none'; st.pitch = s === S.CHALET_BUNGALOW ? 1.0 : 0.6 + g() * 0.15; st.bay = g() < 0.45 ? 'c1' : 'none';
      st.dormers = s === S.CHALET_BUNGALOW; st.conservatory = g() < 0.35; st.unitW = 12; st.porch = g() < 0.5 ? 'box' : 'canopy';
      if (dist === 'sandbay' && g() < 0.4) { st.wallMat = AW.BOARD; st.wallCol = C(AP.board, g); }
    }
    if (s === S.CHALET) { st.storeys = 1; st.gH = 2.4; st.wallMat = AW.BOARD; st.wallCol = C(AP.board, g); st.roofCov = g() < 0.6 ? AROOF.FELT : AROOF.CONCRETE; st.roofCol = C(AP.felt, g); st.chimney = 'none'; st.porch = 'veranda'; st.boundary = 'none'; st.unitW = 6; st.pitch = 0.45; st.win = AWIN.CASE; st.trimCol = [0.8, 0.8, 0.78]; st.bins = false; st.aerial = false; }
    if (dist === 'sandbay' && s !== S.CHALET && g() < 0.3) { st.wallMat = AW.RENDER; st.wallCol = C(AP.seafront, g); }
  } else if (s === S.COTTAGE || s === S.BARN) {
    // Kewstoke: grey limestone rubble (some whitewashed or rendered), slate or clay tiles, small casements, stone garden walls
    st.wallMat = AW.RUBBLE; st.wallCol = C(AP.kew, g); st.dress = AD.RUSTIC; st.dressCol = [0.42, 0.4, 0.36];
    if (s === S.COTTAGE && g() < 0.28) { st.wallMat = AW.RENDER; st.wallCol = C([[0.82, 0.81, 0.78], [0.76, 0.73, 0.64], [0.78, 0.77, 0.72]], g); st.flags |= 128; }
    st.roofCov = g() < 0.5 ? AROOF.SLATE : g() < 0.75 ? AROOF.ROMAN : AROOF.PLAIN; st.roofCol = st.roofCov === AROOF.SLATE ? C(AP.slate, g) : st.roofCov === AROOF.ROMAN ? C(AP.roman, g) : C(AP.plain, g);
    st.ridgeCol = st.roofCov === AROOF.SLATE ? [0.22, 0.1, 0.06] : [st.roofCol[0] * 0.85, st.roofCol[1] * 0.85, st.roofCol[2] * 0.85];
    st.win = h() < 0.45 ? AWIN.COTTAGE : h() < 0.6 ? AWIN.CASE : AWIN.UPVC; st.trimCol = st.win === AWIN.UPVC ? [0.8, 0.8, 0.78] : h() < 0.6 ? [0.78, 0.78, 0.74] : C(AP.trimDark, h);
    st.door = h() < 0.6 ? ADOOR.LEDGED : ADOOR.PANEL4; st.doorW = 0.85; st.doorH = 1.95; st.fanH = 0; st.recess = 0.2;
    st.gH = 2.5; st.uH = 2.35; st.gWinH = 1.0; st.uWinH = 0.9; st.gSill = 0.85; st.uSill = 0.65; st.winW = 0.85;
    st.porch = g() < 0.55 ? 'gable' : 'canopy'; st.pitch = 0.85 + g() * 0.25; st.ovE = 0.2; st.ovV = 0.08;
    st.chimney = 'gable'; st.pots = 1 + ((g() * 2) | 0); st.boundary = 'wall'; st.wallH = 0.9 + g() * 0.4; st.hedge = h() < 0.3; st.unitW = 7; st.cottage = true; st.alarm = false;
    if (s === S.BARN) { st.storeys = 1; st.gH = 4.5; st.chimney = 'none'; st.porch = 'none'; st.door = ADOOR.BARN; st.boundary = 'none'; st.roofCov = g() < 0.5 ? AROOF.PANTILE : AROOF.METAL; st.roofCol = st.roofCov === AROOF.PANTILE ? C(AP.roman, g) : [0.18, 0.2, 0.18]; st.win = AWIN.CASE; st.unitW = 30; st.aerial = false; st.dish = false; st.bins = false; }
  } else if (s === S.PUB || s === S.CAFE) {
    st.wallMat = g() < 0.6 ? AW.RENDER : AW.RUBBLE; st.wallCol = st.wallMat === AW.RENDER ? C(AP.seafront, g) : C(AP.kew, g); st.dress = AD.PAINTED; st.dressCol = [0.8, 0.8, 0.77];
    st.roofCov = g() < 0.5 ? AROOF.SLATE : AROOF.CONCRETE; st.roofCol = st.roofCov === AROOF.SLATE ? C(AP.slate, g) : C(AP.concrete, g); st.ridgeCol = [0.2, 0.1, 0.06];
    st.win = h() < 0.6 ? AWIN.SASH22 : AWIN.UPVC; st.trimCol = [0.8, 0.8, 0.78]; st.recess = 0.1;
    st.door = ADOOR.DOUBLE; st.doorW = 1.6; st.doorH = 2.3; st.fanH = 0.3; st.porchD = 0.2;
    st.gH = 3.1; st.uH = 2.8; st.gWinH = 1.6; st.uWinH = 1.4; st.gSill = 0.8; st.uSill = 0.75; st.winW = 1.2;
    st.porch = 'canopy'; st.chimney = 'gable'; st.boundary = 'none'; st.unitW = 14; st.bay = g() < 0.5 ? 'c2' : 'none';
    const list = s === S.PUB ? ['INN', 'HOTEL', 'BAR', 'INN'] : ['CAFE', 'ICE CREAM', 'BEACH SHOP', 'TEA ROOM', 'CAFE'];
    st.sign = ARCH_SIGN_IX[(r.tags && ARCH_AMENITY_TAG[r.tags.amenity]) || archPick(list, h())]; st.signBg = (h() * AP.shopBg.length) | 0; st.signFg = 1; st.signStyle = 1;
    if (s === S.CAFE) { st.storeys = 1; st.gH = 3.2; st.shopTop = 2.7; st.riser = 0.5; st.awning = h() < 0.7; st.chimney = 'none'; st.flags |= 64; st.interior = 128 | ((h() * 127) | 0); st.wallMat = AW.RENDER; st.wallCol = C(AP.seafront, g); st.unitW = 6; st.door = ADOOR.SHOP; st.doorW = 1.0; st.fanH = 0; }
  } else if (s === S.FLATS || s === S.COMMERCIAL || s === S.INDUSTRIAL || s === S.GARAGE) {
    const m = g();
    if (s === S.FLATS) { st.wallMat = m < 0.4 ? AW.BUFF : m < 0.65 ? AW.BRICK : m < 0.9 ? AW.RENDER : AW.PANEL; st.wallCol = st.wallMat === AW.BUFF ? C(AP.buff, g) : st.wallMat === AW.BRICK ? C(AP.brick, g) : st.wallMat === AW.RENDER ? C(AP.render, g) : [0.5, 0.5, 0.48]; st.dress = AD.CONCRETE; st.dressCol = [0.55, 0.55, 0.52]; st.win = AWIN.UPVC; st.gH = 2.9; st.uH = 2.8; st.gWinH = 1.3; st.uWinH = 1.3; st.gSill = 0.85; st.uSill = 0.85; st.winW = 1.5; st.balcony = g() < 0.45; st.door = ADOOR.SHOP; st.doorW = 1.6; st.roofCov = AROOF.FELT; st.roofCol = C(AP.felt, g); st.chimney = 'none'; st.unitW = 3.0; }
    else if (s === S.COMMERCIAL) { st.wallMat = m < 0.35 ? AW.BRICK : m < 0.7 ? AW.METAL : AW.RENDER; st.wallCol = st.wallMat === AW.BRICK ? C(AP.brick, g) : st.wallMat === AW.METAL ? C(AP.clad, g) : C(AP.render, g); st.dress = AD.CONCRETE; st.dressCol = [0.5, 0.5, 0.48]; st.win = AWIN.RIBBON; st.trimCol = [0.12, 0.13, 0.14]; st.gH = 3.6; st.uH = 3.4; st.gWinH = 1.6; st.uWinH = 1.5; st.gSill = 0.9; st.uSill = 0.9; st.winW = 2.4; st.door = ADOOR.SHOP; st.doorW = 1.8; st.roofCov = AROOF.FELT; st.roofCol = C(AP.felt, g); st.chimney = 'none'; st.unitW = 4.0;
      st.sign = ARCH_SIGN_IX[archPick(['FURNITURE', 'CARPETS', 'BUILDING SUPPLIES', 'TYRES', 'BIKES', 'HARDWARE'], h())]; st.signBg = (h() * AP.shopBg.length) | 0; st.signFg = 0; st.signStyle = 2; }
    else if (s === S.INDUSTRIAL) { st.wallMat = AW.METAL; st.wallCol = C(AP.clad, g); st.dress = AD.NONE; st.win = AWIN.RIBBON; st.trimCol = [0.15, 0.16, 0.17]; st.gH = 6; st.uH = 4; st.gWinH = 0.9; st.gSill = 3.8; st.winW = 3; st.door = ADOOR.ROLLER; st.doorW = 4.2; st.doorH = 4.5; st.roofCov = AROOF.METAL; st.roofCol = C(AP.clad, g); st.chimney = 'none'; st.pitch = 0.12; st.unitW = 6; st.flags |= 4; }
    else { st.wallMat = m < 0.55 ? AW.BRICK : m < 0.8 ? AW.PANEL : AW.BOARD; st.wallCol = st.wallMat === AW.BRICK ? C(AP.brick, g) : st.wallMat === AW.PANEL ? [0.46, 0.45, 0.42] : C(AP.board, g); st.dress = AD.NONE; st.door = ADOOR.GARAGE; st.doorW = 2.3; st.doorH = 2.0; st.doorCol = C([[0.72, 0.72, 0.7], [0.1, 0.2, 0.12], [0.3, 0.05, 0.04], [0.2, 0.25, 0.32], [0.62, 0.6, 0.55]], h); st.gH = 2.5; st.roofCov = AROOF.FELT; st.roofCol = C(AP.felt, g); st.chimney = 'none'; st.unitW = 2.9; st.storeys = 1; st.win = AWIN.CASE; st.pitch = 0.5; }
    st.storeys = s === S.GARAGE ? 1 : 0; st.aerial = false; st.dish = s === S.FLATS && h() < 0.3; st.bins = false; st.alarm = false;
  } else if (s === S.CARAVAN) {
    st.wallMat = AW.CARAVAN; st.wallCol = C([[0.8, 0.8, 0.77], [0.76, 0.73, 0.62], [0.78, 0.76, 0.7], [0.7, 0.71, 0.7], [0.74, 0.7, 0.58]], h); st.dress = AD.NONE;
    st.accentCol = C(AP.stripe, h); st.win = AWIN.CARAVAN; st.trimCol = h() < 0.7 ? [0.82, 0.82, 0.8] : [0.35, 0.3, 0.24]; st.door = ADOOR.UPVC; st.doorW = 0.75; st.doorH = 1.85;
    st.roofCov = AROOF.CARAVAN; st.roofCol = h() < 0.6 ? [0.62, 0.62, 0.6] : [0.24, 0.22, 0.2]; st.gH = 2.2; st.storeys = 1; st.gWinH = 0.85; st.gSill = 0.85; st.winW = 1.0; st.recess = 0.03;
    st.flags = (h() * 4) | 0;                                                     // stripe layout
    st.apex = h() < 0.4; st.aerial = h() < 0.15; st.dish = h() < 0.2; st.bins = false; st.alarm = false; st.chimney = 'none';
  }
  if (st.storeys === 2 || st.storeys === 0) st.storeys = 0;                      // from the height (archHouse)
  return st;
}
