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
//               roof:   0 flat, 1 gabled, 2 hipped, 3 none, 4 half-hipped (the bake's codes: binfo byte 2; the half-hip
//                       as the LIDAR fit has it, ends hipped at twice the pitch from half the depth in); missing: style
//               ridgeAng: direction of the ridge line in the XZ plane (radians, as binfo byte 3: angle of (cos, sin) in
//                       (x, z)); the roof frame is u along it, v across (v = -x sin + z cos)
//               ridgeOff: optional offset of the ridge across (m, +v) from the middle of the footprint's box
//               style:  archStyle() result (missing: archStyle from tags/area/height/position)
//               tags:   as for archStyle (used when style is missing, and for shop signs)
//               seed:   integer (the bake's per-building hash) for the per-building variation
//               front:  index i of the street-facing edge (from point i to point i+1 of fp as given), or -1 (TOWN.bfront)
//               road:   [x, z] a point on the nearest street (used when front < 0: the edge facing it is the front)
//               gap:    distance (m) from the front wall to the back of the pavement: a front garden with its wall,
//                       railings or hedge is built when it is over 1 m (missing: none)
//               ground: optional (x, z) -> ground height, for doorsteps, floor levels and garden walls on slopes
//               chims:  chimney stacks seen by the LIDAR, flat [x, z, yTop (absolute), size (m), ...] (TOWN.chim)
//               dorms:  dormers seen by the LIDAR, flat [x, z, width, yTop (absolute), side (0: v below the ridge,
//                       1: above), ...] (TOWN.dorm)
//               surveyed: true when the roof was fitted to the LIDAR: then chims/dorms are the whole truth (none
//                       means none); otherwise the style places its own stacks and dormers }
//   archFromTown(b) -> archBuild for building b of the baked town (TOWN.bd, binfo, bfront, chim, dorm, hfAt): the
//     simplest hook for 34_wsm_world.js (call it first in townBuilding; when it returns true, return).
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
  ARCH.reqs.push({ p, n, area: a, cx, cz, y0, eave, ridge: o.ridge, roof: o.roof, ridgeAng: o.ridgeAng, ridgeOff: o.ridgeOff || 0, style, tags: o.tags || {}, seed: (o.seed === undefined ? hash2(cx * 7 | 0, cz * 7 | 0) * 4294967296 : o.seed) >>> 0,
    front, road: o.road || null, gap: o.gap === undefined ? 0 : o.gap, ground: o.ground || null, chims: o.chims || null, dorms: o.dorms || null, surveyed: !!o.surveyed,
    party: null, nb: null, group: -1, order: 0, idx: ARCH.reqs.length });
  return true;
}
// building b of the baked town (13_wsm_town.js): footprint, heights from the LIDAR fit, the street front, stacks, dormers
let _archTownIx = null;
function archFromTown(b) {
  const T = TOWN, B = T.bd, bi = T.binfo, k0 = B.off[b], n = B.off[b + 1] - k0; if (n < 3) return false;
  if (!_archTownIx) {   // first stack and dormer of each building (both lists are sorted by building)
    const mk = L => { const s = new Int32Array(B.n + 1).fill(-1); if (L) for (let i = L.n - 1; i >= 0; i--) s[L.b[i]] = i; return s; };
    _archTownIx = { ch: mk(T.chim), dm: mk(T.dorm) };
  }
  const kind = bi[b * 8], hgt = bi[b * 8 + 1] * 0.25, roof = bi[b * 8 + 2], ang = bi[b * 8 + 3] / 256 * PI, lu = bi[b * 8 + 6] & 15, look = bi[b * 8 + 6] >> 4;
  const rise = bi[b * 8 + 7] < 255 ? bi[b * 8 + 7] * 0.1 : -1, p = B.p, fp = new Float64Array(n * 2);
  let gmin = 1e9, gsum = 0, a = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { const x = p[(k0 + i) * 2], z = p[(k0 + i) * 2 + 1], g = hfAt(x, z); fp[i * 2] = x; fp[i * 2 + 1] = z; gmin = Math.min(gmin, g); gsum += g; cx += x; cz += z; }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1]; }
  cx /= n; cz /= n; a = Math.abs(a) / 2;
  const tags = { kind, look, lu, roof, rise, n }, style = archStyle(tags, a, hgt, cx, cz);
  if (!style) return false;
  const eave = gsum / n + hgt, o = { y0: gmin, eave, ridge: rise > 0 ? eave + rise : undefined, roof: roof === 3 ? 0 : roof, ridgeAng: ang, style, tags,
    seed: (bi[b * 8 + 4] | (bi[b * 8 + 5] << 8)) * 40503 + b, front: T.bfront && T.bfront[b] !== 255 ? T.bfront[b] : -1, ground: hfAt, surveyed: rise >= 0 };
  const C = T.chim, D = T.dorm, ix = _archTownIx;
  if (C && ix.ch[b] >= 0) { o.chims = []; for (let i = ix.ch[b]; i < C.n && C.b[i] === b; i++) { const x = C.xz[i * 2] * 0.01, z = C.xz[i * 2 + 1] * 0.01; o.chims.push(x, z, hfAt(x, z) + C.h[i * 2] * 0.1, C.h[i * 2 + 1] * 0.1); } }
  if (D && ix.dm[b] >= 0) { o.dorms = []; for (let i = ix.dm[b]; i < D.n && D.b[i] === b; i++) { const x = D.xz[i * 2] * 0.01, z = D.xz[i * 2 + 1] * 0.01; o.dorms.push(x, z, D.h[i * 3] * 0.1, hfAt(x, z) + D.h[i * 3 + 1] * 0.1, D.h[i * 3 + 2]); } }
  return archBuild(fp, o);
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

// ---------------------------------------------------------------- generation buffers
// AG.S: the shell (MeshBuilder, standard 36-byte vertex; mat = id + record index, colour bytes = column programme or
// colour); AG.P: the instanced detail (36 bytes: position, rotation quaternion, size, material + record, colour).
const AG = { S: null, P: null, rec: null, nrec: 0 };
const APR = { BOX: 0, WEDGE: 1, POT: 2, CYL: 3, DISH: 4, RAIL: 5, N: 6 };   // prototypes (RAIL: alpha-tested family)
const ACLS = { BIG: 0, SMALL: 1 };                                             // detail drawn within 200 m / 120 m
class ArchInst {
  constructor() { this.cap = 1 << 15; this.n = 0; this._mk(null); }
  _mk(old) {
    const b = new ArrayBuffer(this.cap * 36); if (old) new Uint8Array(b).set(new Uint8Array(old));
    this.buf = b; this.f32 = new Float32Array(b); this.i16 = new Int16Array(b); this.u16 = new Uint16Array(b); this.u32 = new Uint32Array(b); this.u8 = new Uint8Array(b);
    const k = new Uint32Array(this.cap); if (this.key) k.set(this.key); this.key = k;
  }
  // q: rotation (x, y, z, w); sizes in metres (0..32); col: [r, g, b] 0..1, a 0..1
  add(proto, cls, mat, rec, x, y, z, q, sx, sy, sz, col, a) {
    if (this.n >= this.cap) { this.cap *= 2; this._mk(this.buf); }
    const i = this.n++, f = i * 9, s = i * 18, b = i * 36;
    this.f32[f] = x; this.f32[f + 1] = y; this.f32[f + 2] = z;
    this.i16[s + 6] = Math.round(q[0] * 32767); this.i16[s + 7] = Math.round(q[1] * 32767); this.i16[s + 8] = Math.round(q[2] * 32767); this.i16[s + 9] = Math.round(q[3] * 32767);
    this.u16[s + 10] = Math.round(clamp(sx, 0, 32) / 32 * 65535); this.u16[s + 11] = Math.round(clamp(sy, 0, 32) / 32 * 65535); this.u16[s + 12] = Math.round(clamp(sz, 0, 32) / 32 * 65535); this.u16[s + 13] = 0;
    this.u32[f + 7] = (mat & 255) | ((rec & 0xffffff) << 8);
    this.u8[b + 32] = Math.round(sat(col[0]) * 255); this.u8[b + 33] = Math.round(sat(col[1]) * 255); this.u8[b + 34] = Math.round(sat(col[2]) * 255); this.u8[b + 35] = Math.round(sat(a === undefined ? 1 : a) * 255);
    const ci = clamp(Math.floor((x - ARCH.cx0) / 64), 0, 4095), cj = clamp(Math.floor((z - ARCH.cz0) / 64), 0, 4095);
    this.key[i] = (((cj * 4096 + ci) * 2 + cls) * 8 + proto) >>> 0;   // (sorted into cells: see archUpload)
    return i;
  }
}
// rotation of an orthonormal right-handed basis (columns X, Y, Z) as a quaternion
const _aq = new Float64Array(4);
function aQuat(xx, xy, xz, yx, yy, yz, zx, zy, zz) {
  const o = _aq, tr = xx + yy + zz;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; o[3] = 0.25 * s; o[0] = (yz - zy) / s; o[1] = (zx - xz) / s; o[2] = (xy - yx) / s; }
  else if (xx > yy && xx > zz) { const s = Math.sqrt(1 + xx - yy - zz) * 2; o[3] = (yz - zy) / s; o[0] = 0.25 * s; o[1] = (yx + xy) / s; o[2] = (zx + xz) / s; }
  else if (yy > zz) { const s = Math.sqrt(1 + yy - xx - zz) * 2; o[3] = (zx - xz) / s; o[0] = (yx + xy) / s; o[1] = 0.25 * s; o[2] = (zy + yz) / s; }
  else { const s = Math.sqrt(1 + zz - xx - yy) * 2; o[3] = (xy - yx) / s; o[0] = (zx + xz) / s; o[1] = (zy + yz) / s; o[2] = 0.25 * s; }
  return o;
}
// box/wedge/... with its X axis along (dx, dy, dz) (any direction), Y as close to up as possible: base centre (x, y, z)
function aPropAlong(proto, cls, mat, rec, x, y, z, dx, dy, dz, sx, sy, sz, col, a) {
  let l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
  // Y = up minus its X part; Z = X × Y
  let yx = -dx * dy, yy = 1 - dy * dy, yz = -dz * dy; l = Math.hypot(yx, yy, yz);
  if (l < 1e-4) { yx = 1; yy = 0; yz = 0; } else { yx /= l; yy /= l; yz /= l; }
  const zx = dy * yz - dz * yy, zy = dz * yx - dx * yz, zz = dx * yy - dy * yx;
  return AG.P.add(proto, cls, mat, rec, x, y, z, aQuat(dx, dy, dz, yx, yy, yz, zx, zy, zz), sx, sy, sz, col, a);
}
// horizontal box (yaw only) along the horizontal direction (dx, dz)
function aPropYaw(proto, cls, mat, rec, x, y, z, dx, dz, sx, sy, sz, col, a) { return aPropAlong(proto, cls, mat, rec, x, y, z, dx, 0, dz, sx, sy, sz, col, a); }

// ---------------------------------------------------------------- shell emitters
function aSetMat(mb, id, rec, c0, c1, c2, c3) { const m = mb.m, c = mb.c; m[0] = id; m[1] = rec & 255; m[2] = (rec >> 8) & 255; m[3] = (rec >> 16) & 255; c[0] = c0 & 255; c[1] = c1 & 255; c[2] = c2 & 255; c[3] = c3 & 255; }
// solid surfaces (stone, paint, stacks...): colour bytes = [surface code, r, g, b]
// (the same packing as the instances: colour in rgb, the surface code in alpha as code / 15)
function aSolid(mb, id, rec, code, col) { aSetMat(mb, id, rec, Math.round(sat(col[0]) * 255), Math.round(sat(col[1]) * 255), Math.round(sat(col[2]) * 255), code * 17); }
// quad a-b-c-d (vertex indices), winding chosen to face (nx, ny, nz)
function aQ(mb, a, b, c, d, nx, ny, nz) {
  const f = mb.f32, ax = f[a * 9], ay = f[a * 9 + 1], az = f[a * 9 + 2];
  const ex = f[b * 9] - ax, ey = f[b * 9 + 1] - ay, ez = f[b * 9 + 2] - az, gx = f[d * 9] - ax, gy = f[d * 9 + 1] - ay, gz = f[d * 9 + 2] - az;
  if ((ey * gz - ez * gy) * nx + (ez * gx - ex * gz) * ny + (ex * gy - ey * gx) * nz < 0) mb.quadI(a, d, c, b); else mb.quadI(a, b, c, d);
}
function aT(mb, a, b, c, nx, ny, nz) {
  const f = mb.f32, ax = f[a * 9], ay = f[a * 9 + 1], az = f[a * 9 + 2];
  const ex = f[b * 9] - ax, ey = f[b * 9 + 1] - ay, ez = f[b * 9 + 2] - az, gx = f[c * 9] - ax, gy = f[c * 9 + 1] - ay, gz = f[c * 9 + 2] - az;
  if ((ey * gz - ez * gy) * nx + (ez * gx - ex * gz) * ny + (ex * gy - ey * gx) * nz < 0) mb.tri(a, c, b); else mb.tri(a, b, c);
}
// a flat polygon (world x, y, z arrays) facing n; uv from fu(x, y, z) -> [u, v]
function aPoly(mb, xs, ys, zs, nx, ny, nz, fu) {
  const n = xs.length; if (n < 3) return;
  // project to the plane for the triangulation
  let tx = -nz, ty = 0, tz = nx; if (Math.abs(ny) > 0.7) { tx = 1; ty = 0; tz = 0; }
  let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const us = [], vs = []; for (let i = 0; i < n; i++) { us.push(xs[i] * tx + ys[i] * ty + zs[i] * tz); vs.push(xs[i] * bx + ys[i] * by + zs[i] * bz); }
  if (aArea(us, vs) < 0) { us.reverse(); vs.reverse(); xs = xs.slice().reverse(); ys = ys.slice().reverse(); zs = zs.slice().reverse(); }
  const tris = aEars(us, vs), v0 = mb.nv;
  for (let i = 0; i < n; i++) { const t = fu(xs[i], ys[i], zs[i]); mb.v(xs[i], ys[i], zs[i], nx, ny, nz, t[0], t[1]); }
  for (let q = 0; q < tris.length; q += 3) aT(mb, v0 + tris[q], v0 + tris[q + 1], v0 + tris[q + 2], nx, ny, nz);
}
// box in the shell: base centre, X along (dx, dz), sizes; faces: bit 1 top, 2 bottom, 4 +x end, 8 -x end, 16 outer (+n), 32 inner
function aBox(mb, x, y, z, dx, dz, sx, sy, sz, faces, uvs) {
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; const nx = dz, nz = -dx;   // n = outward (right of the X axis)
  const hx = sx / 2, hz = sz / 2, y1 = y + sy, P = (a, b, yy) => [x + dx * a + nx * b, yy, z + dz * a + nz * b];
  const sc = uvs || 1;
  const face = (p0, p1, p2, p3, fx, fy, fz, w, h) => { const a = mb.v(p0[0], p0[1], p0[2], fx, fy, fz, 0, 0), b = mb.v(p1[0], p1[1], p1[2], fx, fy, fz, w * sc, 0), c = mb.v(p2[0], p2[1], p2[2], fx, fy, fz, w * sc, h * sc), d = mb.v(p3[0], p3[1], p3[2], fx, fy, fz, 0, h * sc); aQ(mb, a, b, c, d, fx, fy, fz); };
  faces = faces === undefined ? 63 : faces;
  if (faces & 1) face(P(-hx, hz, y1), P(hx, hz, y1), P(hx, -hz, y1), P(-hx, -hz, y1), 0, 1, 0, sx, sz);
  if (faces & 2) face(P(-hx, -hz, y), P(hx, -hz, y), P(hx, hz, y), P(-hx, hz, y), 0, -1, 0, sx, sz);
  if (faces & 4) face(P(hx, hz, y), P(hx, -hz, y), P(hx, -hz, y1), P(hx, hz, y1), dx, 0, dz, sz, sy);
  if (faces & 8) face(P(-hx, -hz, y), P(-hx, hz, y), P(-hx, hz, y1), P(-hx, -hz, y1), -dx, 0, -dz, sz, sy);
  if (faces & 16) face(P(-hx, hz, y), P(hx, hz, y), P(hx, hz, y1), P(-hx, hz, y1), nx, 0, nz, sx, sy);
  if (faces & 32) face(P(hx, -hz, y), P(-hx, -hz, y), P(-hx, -hz, y1), P(hx, -hz, y1), -nx, 0, -nz, sx, sy);
}

// ---------------------------------------------------------------- the building frame: edges, front, heights, roof
// B.E[i]: edge i (point i -> i+1): a, b, length, direction d, outward normal n, party fraction, role F/B/S/P.
// Roof function: f(u, v) = min over planes k of kk * (c_k + a_k u + b_k v) (m above the eaves) in the ridge frame.
function archFrame(r, st) {
  const n = r.n, p = r.p, E = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6, dx = (bx - ax) / L, dz = (bz - az) / L;
    E.push({ i, ax, az, bx, bz, L, dx, dz, nx: dz, nz: -dx, party: r.party ? r.party[i] : 0, nb: r.nb ? r.nb[i] : -1, role: 'S', cols: null });
  }
  const B = { r, st, p, n, E, rec: 0, f: -1 };
  // the front: as given, else the edge facing the street, else the longest free edge
  let f = r.front >= 0 && r.front < n && E[r.front].party < 0.45 && E[r.front].L >= 1.2 ? r.front : -1;
  if (f < 0 && r.road) {
    let best = -1e9;
    for (const e of E) {
      if (e.party > 0.45 || e.L < 1.5) continue;
      const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2, tx = r.road[0] - mx, tz = r.road[1] - mz, d = Math.hypot(tx, tz) || 1;
      const sc = (tx * e.nx + tz * e.nz) / d * 10 - d * 0.1 + Math.min(e.L, 8) * 0.3; if (sc > best) { best = sc; f = e.i; }
    }
  }
  if (f < 0) { let best = 0; for (const e of E) if (e.party <= 0.45 && e.L > best + 0.3) { best = e.L; f = e.i; } }
  if (f < 0) f = 0;
  B.f = f; const F = E[f];
  for (const e of E) {
    const c = e.dx * F.dx + e.dz * F.dz, cn = e.nx * F.nx + e.nz * F.nz;
    e.role = e.party > 0.45 ? 'P' : e === F ? 'F' : cn > 0.7 ? 'f' : cn < -0.7 ? 'B' : 'S';
    e.par = c;
  }
  // heights: floor level at the front door, storeys fitted under the eaves
  const G = r.ground || (() => r.y0);
  B.G = G; B.base = r.y0 - 0.35;
  const fmx = (F.ax + F.bx) / 2 + F.nx * 1.2, fmz = (F.az + F.bz) / 2 + F.nz * 1.2, gF = G(fmx, fmz);
  const S = ARCH_S, s = st.style;
  const step = s === S.TERRACE || s === S.VILLA || s === S.HOTEL ? 0.3 + (st.hash % 7) * 0.035 : s === S.SHOP || s === S.CAFE || s === S.INDUSTRIAL || s === S.COMMERCIAL || s === S.GARAGE ? 0.05 : s === S.CARAVAN ? 0.55 : 0.15;
  B.gF = gF; B.yf = Math.max(r.y0 + 0.08, Math.min(gF + step, r.eave - 2.2));
  B.yE = r.eave;
  const tot = B.yE - B.yf;
  if (!st.storeys) {
    const per = s === S.TERRACE || s === S.VILLA || s === S.HOTEL || s === S.SHOP || s === S.PUB ? 3.0 : s === S.COTTAGE ? 2.45 : s === S.FLATS ? 2.85 : s === S.COMMERCIAL ? 3.5 : 2.6;
    st.storeys = clamp(Math.round((tot + 0.15) / per), 1, 12);
    if (s === S.INDUSTRIAL || s === S.BARN) st.storeys = 1;
  }
  // storey heights: the ground floor a little taller (much taller for shops), the eaves just above the top ceiling
  const k = st.storeys;
  if (k <= 1) { st.gH = Math.max(2.2, Math.min(tot, s === S.INDUSTRIAL ? tot : 4.2)); st.uH = st.gH; }
  else {
    const g0 = st.gH, u0 = st.uH, sc = clamp(tot / (g0 + (k - 1) * u0), 0.78, 1.25);
    st.gH = g0 * sc; st.uH = u0 * sc;
    if (s === S.SHOP) { st.gH = Math.max(st.gH, Math.min(st.shopTop + 0.3, tot - (k - 1) * 2.4)); st.uH = (tot - st.gH) / (k - 1); }
  }
  st.gWinH = Math.min(st.gWinH, st.gH - st.gSill - 0.3); st.uWinH = Math.min(st.uWinH, st.uH - st.uSill - 0.3);
  if (st.shopTop) st.shopTop = Math.min(st.shopTop, st.gH - 0.2);
  // roof frame
  let ang = r.ridgeAng;
  if (ang === undefined || ang === null) ang = Math.atan2(F.dz, F.dx) + (st.gableFront ? PI / 2 : 0);
  let bestD = 0.21, snap = null;   // snap the frame to the footprint's own edges (within 12 degrees)
  for (const e of E) { if (e.L < 2) continue; const a = Math.atan2(e.dz, e.dx), d = Math.abs(Math.sin(a - ang)); if (d < bestD && Math.cos(a - ang) * Math.cos(a - ang) > 0.5) { bestD = d; snap = a; } }
  if (snap !== null) ang = snap;
  const cr = Math.cos(ang), sr = Math.sin(ang), us = new Array(n), vs = new Array(n);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < n; i++) { const x = p[i * 2], z = p[i * 2 + 1], u = x * cr + z * sr, v = -x * sr + z * cr; us[i] = u; vs[i] = v; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  B.cr = cr; B.sr = sr; B.us = us; B.vs = vs; B.u0 = u0; B.u1 = u1; B.v0 = v0; B.v1 = v1;
  B.uc = (u0 + u1) / 2; B.hu = (u1 - u0) / 2;
  const off = clamp(r.ridgeOff || 0, -0.35 * (v1 - v0), 0.35 * (v1 - v0));
  B.vc = (v0 + v1) / 2 + off; B.hvA = B.vc - v0; B.hvB = v1 - B.vc; B.hv = Math.max(B.hvA, B.hvB);
  let roof = r.roof;
  if (roof === undefined || roof === null) roof = st.roofKind !== undefined ? st.roofKind : 1;
  if (roof === 3) roof = 0;
  if (roof && Math.min(B.hvA, B.hvB) < 0.8) roof = 0;
  B.roof = roof;
  let rise = r.ridge !== undefined && r.ridge !== null ? r.ridge - B.yE : -1;
  if (roof && !(rise > 0.3)) rise = Math.min(B.hv * st.pitch, 7.5);
  if (roof) rise = clamp(rise, 0.3, B.hv * 1.7);
  B.rise = roof ? rise : 0; B.kk = roof ? rise / B.hv : 0; B.yR = B.yE + B.rise;
  // planes: eaves either side of the ridge (an off-centre ridge: two pitches), hips at free ends (half-hip: steeper)
  const P = B.planes = [];
  if (roof) {
    const ka = B.rise / B.hvA, kb = B.rise / B.hvB;
    P.push([0, ka, ka * (B.hvA - B.vc)]);   // f = ka (v - v0): the slope rising from the v0 eaves
    P.push([0, -kb, kb * (B.hvB + B.vc)]);  // f = kb (v1 - v)
    if (roof === 2 || roof === 4) {
      const s2 = roof === 4 ? 2 : 1, kh = B.rise / B.hv * s2;
      // which ends are free (no party wall across them)
      let freeL = true, freeR = true;
      for (const e of E) if (e.role === 'P') { const c = e.nx * cr + e.nz * sr; if (c < -0.7) freeL = false; if (c > 0.7) freeR = false; }
      if (freeL) P.push([kh, 0, -kh * u0]);
      if (freeR) P.push([-kh, 0, kh * u1]);
    }
  }
  return B;
}
const aF = (B, u, v) => { const P = B.planes; if (!P.length) return 0; let f = 1e9; for (let k = 0; k < P.length; k++) { const q = P[k], t = q[2] + q[0] * u + q[1] * v; if (t < f) f = t; } return f; };
const aU = (B, x, z) => x * B.cr + z * B.sr, aV_ = (B, x, z) => -x * B.sr + z * B.cr;
const aX = (B, u, v) => u * B.cr - v * B.sr, aZ = (B, u, v) => u * B.sr + v * B.cr;
// roof height (absolute) at a world point
const aRoofY = (B, x, z) => B.yE + Math.max(0, aF(B, aU(B, x, z), aV_(B, x, z)));
// t in (0, 1) where the roof's creases cross the segment (ua, va) -> (ub, vb)
function aCreases(B, ua, va, ub, vb, out) {
  const P = B.planes, du = ub - ua, dv = vb - va;
  for (let k = 0; k < P.length; k++) for (let j = k + 1; j < P.length; j++) {
    const a = P[k][0] - P[j][0], b = P[k][1] - P[j][1], c = P[j][2] - P[k][2], den = a * du + b * dv;
    if (Math.abs(den) < 1e-9) continue; const t = (c - a * ua - b * va) / den; if (t > 1e-4 && t < 1 - 1e-4) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- façades: opening columns along each wall
// column: {a, b (m along the edge), c (centre of its openings), g (ground: AC.G*), up (upper: AC.U*), ow (opening width),
//          v (variant bits: 1-2 window size, 4 garage door, 8 french doors, 16 x n blank storeys from the ground),
//          q (corner quoins: AC.QL | AC.QR), bay (feature object), kind}
function archCol(a, b, c, g, up, ow, v) { return { a, b, c, g, up, ow, v: v || 0, q: 0, bay: null, kind: '' }; }
// a wall without openings, in pieces of at most 9 m (the quoin distance is kept in one byte of 4 cm)
function archBlank(cols, L) { const n = Math.max(1, Math.ceil(L / 9)), w = L / n; for (let k = 0; k < n; k++) cols.push(archCol(k * w, (k + 1) * w, (k + 0.5) * w, AC.GNONE, AC.UNONE, 0)); }
// elements of the front of one house unit (unit-local x, mirrored on alternate houses): {x, w, kind}
function archUnitElems(B, w, mir) {
  const st = B.st, S = ARCH_S, s = st.style, el = [], dw = st.doorW, ww = st.winW;
  const push = (x, kind, wd) => el.push({ x: mir ? w - x : x, kind, w: wd });
  if (s === S.SHOP || s === S.CAFE) {
    const nW = w > 7.5 ? 3 : w > 3.8 ? 2 : 1;
    for (let i = 0; i < nW; i++) push((i + 0.5) * w / nW, i === (mir ? 0 : nW - 1) ? 'shopdoor' : 'shop', w / nW);
  } else if (s === S.TERRACE || s === S.VILLA || s === S.HOTEL || s === S.PUB) {
    const bay = st.bay !== 'none' && w >= 4.3;
    if (s === S.TERRACE || w < 6.5) {
      if (bay) { const bw = Math.min(st.bayW, w - dw - 1.25); push(0.35 + bw / 2, 'bay', bw); push(w - 0.32 - Math.max(dw, 1.05) / 2, 'door', dw); }
      else { push(0.4 + ww / 2, 'win', ww); push(w - 0.35 - dw / 2, 'door', dw); if (w > 6) push((0.8 + ww + w - 0.7 - dw) / 2, 'win', ww * 0.8); }
    } else if (w < 9.5) {
      if (bay) { const bw = Math.min(st.bayW, w * 0.4); push(0.5 + bw / 2, 'bay', bw); push(0.5 + bw + 0.6 + dw / 2, 'door', dw); push((0.5 + bw + 1.1 + dw + w) / 2, 'win', ww); }
      else { const n = Math.max(2, Math.round(w / 2.4)); for (let i = 0; i < n; i++) push((i + 0.5) * w / n, i === (n >> 1) ? 'door' : 'win', i === (n >> 1) ? dw : ww); }
    } else {
      // double-fronted (villas, hotels, pubs): bays or windows either side of a central door
      const bw = Math.min(st.bayW, w * 0.28);
      if (bay) { push(0.6 + bw / 2, 'bay', bw); push(w - 0.6 - bw / 2, 'bay', bw); push(w / 2, 'door', dw); const sp = (w - 1.2 - 2 * bw - dw) / 2; if (sp > ww + 0.8) { push(0.6 + bw + sp / 2, 'win', ww); push(w - 0.6 - bw - sp / 2, 'win', ww); } }
      else { const n = Math.max(3, Math.round(w / 2.3)) | 1; for (let i = 0; i < n; i++) push((i + 0.5) * w / n, i === (n >> 1) ? 'door' : 'win', i === (n >> 1) ? dw : ww); }
    }
  } else if (s === S.COTTAGE || s === S.CHALET) {
    if (w < 4.6) { push(w * 0.32, 'win', ww); push(w * 0.76, 'door', dw); }
    else { const n = Math.max(3, Math.round(w / 2.2)); const di = (st.hash >> 3) % n; for (let i = 0; i < n; i++) push((i + 0.5) * w / n, i === di ? 'door' : 'win', i === di ? dw : ww); }
  } else if (s === S.BARN) {
    push(w * 0.5, 'barn', Math.min(3.6, w * 0.4)); if (w > 8) { push(w * 0.15, 'win', 0.7); push(w * 0.85, 'win', 0.7); }
  } else {
    // post-war, modern, deco, bungalows: a wide living-room window, the door (porch), a smaller window; integral garages
    if (st.garage && w > 5.8) { push(1.45, 'garage', 2.4); push(2.9 + 0.2 + dw / 2, 'door', dw); if (w - (3.3 + dw) > 1.6) push((3.3 + dw + w) / 2, 'win', Math.min(1.8, w - 4.0 - dw)); }
    else if (st.storeys <= 1 && w > 7) {
      const bay = st.bay !== 'none'; let x = 0.6;
      if (bay) { push(x + st.bayW / 2, 'bay', st.bayW); x += st.bayW + 0.5; } else { push(x + 0.9, 'win', 1.8); x += 2.3; }
      push(x + dw / 2 + 0.2, 'door', dw); x += dw + 0.9;
      while (x + 1.2 < w - 0.5) { const wd = Math.min(1.6, w - 0.5 - x - 0.1); push(x + wd / 2, 'win', wd); x += wd + 0.9; }
    } else {
      if (st.bay !== 'none' && w > 5.5) push(0.5 + st.bayW / 2, 'bay', st.bayW); else push(0.5 + 0.9, 'win', 1.8);
      push(w - 0.45 - dw / 2 - 0.25, 'door', dw);
      if (w > 7) push((2.3 + w - 0.9 - dw) / 2, 'win', 1.0);
    }
  }
  el.sort((p, q) => p.x - q.x);
  return el;
}
function archFacades(B) {
  const st = B.st, S = ARCH_S, s = st.style, E = B.E, F = E[B.f], r = B.r;
  const quo = (st.flags & 1) !== 0;
  for (const e of E) {
    const cols = e.cols = [];
    if (e.role === 'P' || e.L < 1.3) { archBlank(cols, e.L); continue; }
    if (e.role === 'F' && (s === S.FLATS || s === S.COMMERCIAL || s === S.INDUSTRIAL || s === S.GARAGE)) {
      // blocks: a regular grid; flats an entrance in the middle, commercial a shop front, sheds roller doors, garages a row
      const n = Math.max(1, Math.round(e.L / st.unitW)), w = e.L / n, mid = n >> 1;
      for (let k = 0; k < n; k++) {
        let c;
        if (s === S.GARAGE) c = archCol(k * w, (k + 1) * w, (k + 0.5) * w, AC.GDOOR, AC.UNONE, Math.min(st.doorW, w - 0.5), 4);
        else if (s === S.INDUSTRIAL) c = (k % 3 === 1 || n === 1) ? archCol(k * w, (k + 1) * w, (k + 0.5) * w, AC.GDOOR, AC.UNONE, Math.min(st.doorW, w - 0.8), 4) : archCol(k * w, (k + 1) * w, (k + 0.5) * w, k === 0 ? AC.GDOOR : AC.GWIN, AC.UNONE, k === 0 ? 0.95 : st.winW, 0);
        else if (s === S.COMMERCIAL) c = archCol(k * w, (k + 1) * w, (k + 0.5) * w, k < Math.max(1, n - 1) ? AC.GSHOP : AC.GSHOP, AC.UWIN, w * 0.8, k === mid ? 4 : 0);
        else c = archCol(k * w, (k + 1) * w, (k + 0.5) * w, k === mid ? AC.GDOOR : AC.GWIN, AC.UWIN, k === mid ? st.doorW : st.winW, 0);
        c.kind = c.g === AC.GDOOR ? 'door' : 'win'; c.unit = k; cols.push(c);
      }
      continue;
    }
    if (e.role === 'F') {
      const n = Math.max(1, Math.round(e.L / st.unitW)), w = e.L / n;
      const els = [];
      for (let k = 0; k < n; k++) for (const el of archUnitElems(B, w, ((r.order + k) & 1) === 1)) { el.x += k * w; el.unit = k; els.push(el); }
      // columns: boundaries halfway between the elements
      for (let i = 0; i < els.length; i++) {
        const el = els[i], a = i === 0 ? 0 : (els[i - 1].x + el.x) / 2, b = i === els.length - 1 ? e.L : (el.x + els[i + 1].x) / 2;
        let c;
        if (el.kind === 'door') c = archCol(a, b, el.x, AC.GDOOR, AC.UNARROW, el.w);
        else if (el.kind === 'garage') { c = archCol(a, b, el.x, AC.GDOOR, AC.UWIN, el.w, 4); }
        else if (el.kind === 'barn') { c = archCol(a, b, el.x, AC.GDOOR, AC.UNONE, el.w, 4); }
        else if (el.kind === 'shop' || el.kind === 'shopdoor') { c = archCol(a, b, el.x, AC.GSHOP, AC.UWIN, Math.min(st.winW, (b - a) * 0.6), el.kind === 'shopdoor' ? 4 : 0); }
        else if (el.kind === 'bay') {
          const two = st.bay === 'c2' || st.bay === 'c2g' || st.bay === 's2' || st.bay === 'c3', nb = st.bay === 'c3' ? Math.min(3, st.storeys) : two ? Math.min(2, st.storeys) : 1;
          c = archCol(a, b, el.x, AC.GWIN, AC.UWIN, st.winW, 16 * nb); c.bay = { w: el.w, storeys: nb, type: st.bay };
        }
        else c = archCol(a, b, el.x, AC.GWIN, AC.UWIN, el.w);
        c.kind = el.kind; c.unit = el.unit; cols.push(c);
      }
      if (s === S.CHALET_BUNGALOW || s === S.BARN) for (const c of cols) if (c.up === AC.UNARROW) c.up = AC.UNONE;
      continue;
    }
    // other walls: windows at a regular spacing; a back door; blank gable ends of terraces
    let sp = st.winW + 1.5, ow = st.winW * 0.85;
    if (s === S.SHOP) ow = st.winW * 0.8;
    if (s === S.FLATS || s === S.COMMERCIAL) { sp = st.unitW; ow = st.winW; }
    const nW = Math.floor((e.L - 0.5) / sp);
    const blank = (e.role === 'S' && (s === S.TERRACE || s === S.SHOP) && ((st.hash >> 5) % 3 !== 0)) || s === S.GARAGE || s === S.INDUSTRIAL || (e.role === 'S' && s === S.BARN);
    if (nW < 1 || blank) archBlank(cols, e.L);
    else {
      const w = e.L / nW;
      for (let i = 0; i < nW; i++) {
        const c = archCol(i * w, (i + 1) * w, (i + 0.5) * w, AC.GWIN, AC.UWIN, ow, ((st.hash >> (i + 2)) & 3) === 0 ? 1 : 0);
        if (e.role === 'B' && i === ((st.hash >> 9) % nW) && s !== S.FLATS && s !== S.COMMERCIAL) { c.g = AC.GDOOR; c.v |= (s === S.MODERN || s === S.POSTWAR || s === S.BUNGALOW) && ((st.hash >> 11) & 1) ? 8 : 0; c.ow = c.v & 8 ? 1.8 : 0.9; }
        if (e.role === 'S' && (s === S.TERRACE || s === S.VILLA) && nW > 1 && i > 0) { c.g = AC.GNONE; }
        cols.push(c);
      }
    }
  }
  // corner quoins where two free walls meet at an outside corner
  if (quo) for (let i = 0; i < B.n; i++) {
    const e = E[i], nx = E[(i + 1) % B.n], pv = E[(i + B.n - 1) % B.n];
    const outside = (a, b) => a.dx * b.dz - a.dz * b.dx > 0.25;   // left turn (positive area): convex corner
    if (e.role !== 'P' && e.cols.length) {
      if (pv.role !== 'P' && outside(pv, e)) { const c = e.cols[0]; c.q |= AC.QL; c.qd = c.c - 0; }
      if (nx.role !== 'P' && outside(e, nx)) { const c = e.cols[e.cols.length - 1]; c.q |= AC.QR; c.qdR = e.L - c.c; }
    }
  }
}

// ---------------------------------------------------------------- walls
// colour bytes of a wall column: r = programme (AC bits), g = quoin distance (4 cm), b = opening width (2 cm),
// a = variant bits (or, for AC.GABLE, the bottom of its single opening above the floor, 4 cm); weight = the top of
// any opening above the floor (cm / 32767); uv = (u from the column's centre, height above the floor level)
function aWallMat(B, R, qd, ow, A, maxTop) { aSetMat(AG.S, AM.WALL, B.rec, R, Math.min(255, Math.round(qd / 0.04)), Math.min(255, Math.round(ow / 0.02)), A); AG.S.w = Math.min(32767, Math.max(0, Math.round(maxTop * 100))) / 32767; }
// a vertical wall piece from (ax, az) to (bx, bz), outward normal (nx, nz), bottom y0, top from topY(x, z), local u uA..uB;
// split where the roof's creases cross it so the top follows the roof
const _ts = [];
function aWallPiece(B, ax, az, bx, bz, nx, nz, y0, topY, uA, uB) {
  const mb = AG.S, ts = _ts; ts.length = 0; ts.push(0, 1);
  if (B.planes.length && topY === B.roofTop) aCreases(B, aU(B, ax, az), aV_(B, ax, az), aU(B, bx, bz), aV_(B, bx, bz), ts);
  ts.sort((a, b) => a - b);
  const yf = B.yf;
  for (let q = 0; q < ts.length - 1; q++) {
    const t0 = ts[q], t1 = ts[q + 1]; if (t1 - t0 < 1e-5) continue;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
    const ya = topY(x0, z0), yb = topY(x1, z1), u0 = uA + (uB - uA) * t0, u1 = uA + (uB - uA) * t1;
    const a = mb.v(x0, y0, z0, nx, 0, nz, u0, y0 - yf), b = mb.v(x1, y0, z1, nx, 0, nz, u1, y0 - yf), c = mb.v(x1, yb, z1, nx, 0, nz, u1, yb - yf), d = mb.v(x0, ya, z0, nx, 0, nz, u0, ya - yf);
    aQ(mb, a, b, c, d, nx, 0, nz);
  }
}
function archWalls(B) {
  const st = B.st, yE = B.yE, flat = !B.planes.length;
  const ph = flat ? (st.parapet !== undefined ? st.parapet : 0) : 0;
  B.roofTop = flat ? ((x, z) => yE + ph) : ((x, z) => aRoofY(B, x, z));
  for (const e of B.E) {
    for (const c of e.cols) {
      const qd = c.q & AC.QL ? c.c - c.a : c.q & AC.QR ? c.b - c.c : 0;
      const top = yE - B.yf + (flat ? ph : 0);
      aWallMat(B, c.g | c.up | c.q, qd, c.ow, c.v, (c.maxTop !== undefined ? c.maxTop : top));
      const ax = e.ax + e.dx * c.a, az = e.az + e.dz * c.a, bx = e.ax + e.dx * c.b, bz = e.az + e.dz * c.b;
      aWallPiece(B, ax, az, bx, bz, e.nx, e.nz, B.base, B.roofTop, c.a - c.c, c.b - c.c);
    }
  }
  AG.S.w = 0;
}

// ---------------------------------------------------------------- roofs
function aRoofPolyEmit(B, us, vs, q, yAdd, cov) {
  const mb = AG.S, st = B.st, cr = B.cr, sr = B.sr;
  const gx = q[0] * cr - q[1] * sr, gz = q[0] * sr + q[1] * cr, g = Math.hypot(gx, gz) || 1e-6;
  let nx = -gx, ny = 1, nz = -gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
  const tris = aEars(us, vs); if (!tris.length) return;
  const v0 = mb.nv, k = Math.sqrt(1 + g * g) / g, top = B.rise;
  aSetMat(mb, AM.ROOF, B.rec, cov === undefined ? 255 : cov, 0, 0, 0);
  for (let i = 0; i < us.length; i++) {
    const x = aX(B, us[i], vs[i]), z = aZ(B, us[i], vs[i]), t = q[2] + q[0] * us[i] + q[1] * vs[i];
    mb.v(x, B.yE + t + yAdd, z, nx, ny, nz, (-gz * x + gx * z) / g, (top - t) * k);
  }
  for (let i = 0; i < tris.length; i += 3) aT(mb, v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2], nx, ny, nz);
}
function archRoof(B) {
  const st = B.st, E = B.E, P = B.planes, r = B.r;
  if (!P.length) { archFlatRoof(B); return; }
  const ds = E.map(e => e.role === 'P' ? 0 : (B.roof !== 1 || Math.abs(e.dx * B.cr + e.dz * B.sr) > 0.7) ? st.ovE : st.ovV);
  const [ou, ov] = aOffset(B.us, B.vs, ds);
  B.ou = ou; B.ov = ov; B.ds = ds;
  const regions = [];
  for (let k = 0; k < P.length; k++) {
    let cu = ou.slice(), cv = ov.slice();
    for (let j = 0; j < P.length && cu.length >= 3; j++) { if (j === k) continue; [cu, cv] = aClip(cu, cv, P[k][0] - P[j][0], P[k][1] - P[j][1], P[j][2] - P[k][2]); }
    if (cu.length < 3 || aArea(cu, cv) < 0.02) continue;
    aRoofPolyEmit(B, cu, cv, P[k], 0.02);
    regions.push([k, cu, cv]);
  }
  // ridge and hip tiles: the region edges that lie on a crease
  const rc = st.ridgeCol || st.roofCol;
  for (const [k, cu, cv] of regions) {
    const m = cu.length;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, ua = cu[i], va = cv[i], ub = cu[j], vb = cv[j];
      if (Math.hypot(ub - ua, vb - va) < 0.2) continue;
      const tk = q => (u, v) => q[2] + q[0] * u + q[1] * v;
      for (let o = k + 1; o < P.length; o++) {
        const fa = tk(P[k]), fb = tk(P[o]);
        if (Math.abs(fa(ua, va) - fb(ua, va)) > 1e-3 || Math.abs(fa(ub, vb) - fb(ub, vb)) > 1e-3) continue;
        const ya = B.yE + fa(ua, va), yb = B.yE + fa(ub, vb), xa = aX(B, ua, va), za = aZ(B, ua, va), xb = aX(B, ub, vb), zb = aZ(B, ub, vb);
        const sl = Math.max(Math.hypot(P[k][0], P[k][1]), Math.hypot(P[o][0], P[o][1]));
        aPropAlong(APR.WEDGE, ACLS.BIG, AM.RIDGE, B.rec, (xa + xb) / 2, (ya + yb) / 2 - sl * 0.17 + 0.02, (za + zb) / 2, xb - xa, yb - ya, zb - za, Math.hypot(xb - xa, yb - ya, zb - za) + 0.05, 0.24, 0.36, rc);
      }
    }
  }
  // the roof's edges: fascia and soffit (eaves) or bargeboard (verges), gutters, downpipes
  const n = B.n;
  for (let i = 0; i < n; i++) {
    const d = ds[i]; if (d <= 0.01) continue;
    const e = E[i], j = (i + 1) % n, ua = ou[i], va = ov[i], ub = ou[j], vb = ov[j], ts = [0, 1];
    aCreases(B, ua, va, ub, vb, ts); ts.sort((a, b) => a - b);
    const eave = Math.abs(e.dx * B.cr + e.dz * B.sr) > 0.7 || B.roof !== 1;
    for (let q = 0; q < ts.length - 1; q++) {
      const t0 = ts[q], t1 = ts[q + 1]; if (t1 - t0 < 1e-4) continue;
      const u0 = ua + (ub - ua) * t0, v0 = va + (vb - va) * t0, u1 = ua + (ub - ua) * t1, v1 = va + (vb - va) * t1;
      const x0 = aX(B, u0, v0), z0 = aZ(B, u0, v0), x1 = aX(B, u1, v1), z1 = aZ(B, u1, v1), y0 = B.yE + aF(B, u0, v0), y1 = B.yE + aF(B, u1, v1);
      const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0); if (L < 0.05) continue;
      // pieces outside the stretches taken by gabled bays (B.cuts: edge, s0, s1)
      const sA = (x0 - e.ax) * e.dx + (z0 - e.az) * e.dz, sB = (x1 - e.ax) * e.dx + (z1 - e.az) * e.dz;
      let pieces = [[0, 1]];
      if (B.cuts) for (const ct of B.cuts) {
        if (ct[0] !== i || Math.abs(sB - sA) < 1e-6) continue;
        const ta = (ct[1] - sA) / (sB - sA), tb = (ct[2] - sA) / (sB - sA), lo = Math.min(ta, tb), hi = Math.max(ta, tb), np = [];
        for (const [a, b] of pieces) { if (hi <= a || lo >= b) { np.push([a, b]); continue; } if (lo > a) np.push([a, lo]); if (hi < b) np.push([hi, b]); }
        pieces = np;
      }
      for (const [pa, pb] of pieces) {
        if (pb - pa < 0.02) continue;
        const X0 = x0 + (x1 - x0) * pa, Y0 = y0 + (y1 - y0) * pa, Z0 = z0 + (z1 - z0) * pa, X1 = x0 + (x1 - x0) * pb, Y1 = y0 + (y1 - y0) * pb, Z1 = z0 + (z1 - z0) * pb, LL = L * (pb - pa);
        const fh = eave ? 0.2 : 0.22, mx = (X0 + X1) / 2 - e.nx * d / 2, mz = (Z0 + Z1) / 2 - e.nz * d / 2;
        // the box hangs below the edge line: its local Y is the up direction made square to the slope
        const sl = (Y1 - Y0) / LL, cy = Math.sqrt(Math.max(0, 1 - sl * sl));
        aPropAlong(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, mx, (Y0 + Y1) / 2 - fh * cy + 0.015, mz, X1 - X0, Y1 - Y0, Z1 - Z0, LL + 0.03, fh, d + 0.02, st.fascia, eave ? 0.3 : 0.7);
        if (eave && Math.abs(Y1 - Y0) < 0.05 && st.style !== ARCH_S.CARAVAN) aPropAlong(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (X0 + X1) / 2 + e.nx * 0.05, (Y0 + Y1) / 2 - 0.13, (Z0 + Z1) / 2 + e.nz * 0.05, X1 - X0, 0, Z1 - Z0, LL, 0.1, 0.11, st.gutter, 0.2);
      }
      if (eave && Math.abs(y1 - y0) < 0.05 && st.style !== ARCH_S.CARAVAN && (e.role === 'F' || e.role === 'B') && e.L > 2.5 && q === (((st.hash >> 4) & 1) ? 0 : ts.length - 2)) {
        const tt = ((st.hash >> 4) & 1) ? 0.04 : 0.96, px = e.ax + (e.bx - e.ax) * tt + e.nx * 0.07, pz = e.az + (e.bz - e.az) * tt + e.nz * 0.07, gy = B.G(px, pz);
        aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, px, gy - 0.05, pz, e.dx, e.dz, 0.075, Math.max(0.3, (y0 + y1) / 2 - 0.12 - gy), 0.075, st.gutter, 0.2);
      }
    }
  }
}
function archFlatRoof(B) {
  const st = B.st, mb = AG.S, ph = st.parapet !== undefined ? st.parapet : 0, y = B.yE;
  const xs = [], ys = [], zs = []; for (let i = 0; i < B.n; i++) { xs.push(B.p[i * 2]); ys.push(y); zs.push(B.p[i * 2 + 1]); }
  aSetMat(mb, AM.FLAT, B.rec, 255, 0, 0, 0);
  aPoly(mb, xs, ys, zs, 0, 1, 0, (x, yy, z) => [x, z]);
  if (ph > 0.05) for (const e of B.E) {
    if (e.role === 'P') continue;
    // the inside face of the parapet and its coping
    aWallMat(B, AC.GNONE | AC.UNONE, 0, 0, 0, 0);
    aWallPiece(B, e.bx, e.bz, e.ax, e.az, -e.nx, -e.nz, y, () => y + ph, 0, e.L);
    aPropYaw(APR.BOX, ACLS.BIG, AM.STONE, B.rec, (e.ax + e.bx) / 2 - e.nx * 0.1, y + ph, (e.az + e.bz) / 2 - e.nz * 0.1, e.dx, e.dz, e.L + 0.1, 0.07, 0.34, st.copingCol || [0.42, 0.41, 0.39], 5 / 15);
  } else for (const e of B.E) {
    if (e.role === 'P') continue;   // a felt roof's dark fascia
    aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (e.ax + e.bx) / 2 + e.nx * 0.04, y - 0.16, (e.az + e.bz) / 2 + e.nz * 0.04, e.dx, e.dz, e.L + 0.1, 0.22, 0.1, st.fasciaFlat || [0.06, 0.06, 0.065], 0.4);
  }
  AG.S.w = 0;
}

// ---------------------------------------------------------------- chimney stacks (shell) and their pots (detail)
// surface codes of AM.STONE / AM.PAINT solids (colour alpha x 15): the shader reads the same numbers
const ASC = { ASHLAR: 0, SMOOTH: 1, BRICK: 2, RUBBLE: 3, RENDER: 4, CONCRETE: 5, TERRACOTTA: 6, LEAD: 7, TIMBER: 8, METAL: 9, GLASS: 10, TILES: 11, DECK: 12, SLAB: 13 };
function archStackLook(B) {
  const st = B.st, h = mkRng(st.hash ^ 0x3c6ef372);
  if (st.stack) return st.stack;
  let code = ASC.BRICK, col = archPick(AP.brick, h());
  if (st.wallMat === AW.RUBBLE && h() < 0.45) { code = ASC.RUBBLE; col = st.wallCol; }
  else if (st.wallMat === AW.RENDER || st.wallMat === AW.DASH || st.wallMat === AW.ROUGH) { if (h() < 0.55) { code = ASC.RENDER; col = st.wallCol; } }
  else if (st.wallMat === AW.BRICK || st.wallMat === AW.BUFF) { col = st.wallCol; }
  return st.stack = { code, col };
}
// a stack of plan size sx (along dir) x sz, base below the roof, top of the body; pots on it
function archStack(B, x, z, dx, dz, sx, sz, top, pots) {
  const mb = AG.S, lk = archStackLook(B), st = B.st;
  // the lowest point of the roof under the stack's corners
  let yb = 1e9; const nx = dz, nz = -dx;
  for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) yb = Math.min(yb, aRoofY(B, x + dx * sx * a + nx * sz * b, z + dz * sx * a + nz * sz * b));
  yb -= 0.25; if (top < yb + 0.7) top = yb + 0.7;
  aSolid(mb, AM.STONE, B.rec, lk.code, lk.col);
  aBox(mb, x, yb, z, dx, dz, sx, top - yb, sz, 1 | 4 | 8 | 16 | 32);
  aBox(mb, x, top - 0.32, z, dx, dz, sx + 0.12, 0.16, sz + 0.12, 63);   // oversailing course
  // pots: in a row along the stack, terracotta, buff or grey; one with a cowl now and then
  const h = mkRng((st.hash ^ Math.round(x * 13) ^ Math.round(z * 7)) >>> 0);
  const np = Math.max(1, Math.min(8, pots || Math.round(sx / 0.42)));
  for (let i = 0; i < np; i++) {
    const t = np === 1 ? 0 : (i / (np - 1) - 0.5) * (sx - 0.4), ph = 0.38 + h() * 0.38, pr = 0.24 + h() * 0.08;
    const col = h() < 0.6 ? [0.34 + h() * 0.06, 0.13 + h() * 0.04, 0.06] : h() < 0.6 ? [0.5, 0.42, 0.3] : [0.16, 0.15, 0.14];
    aPropYaw(APR.POT, ACLS.SMALL, AM.POT, B.rec, x + dx * t, top, z + dz * t, dx, dz, pr, ph, pr, col, h());
  }
  // a television aerial pointing at the Mendip transmitter (south-east of the town), on one stack of the house
  if (st.aerial && !B.aerialDone) {
    B.aerialDone = true;
    const ax = x - dx * (sx / 2 - 0.1), az = z - dz * (sx / 2 - 0.1), my = top + 1.6, tx = 0.6, tz = 0.8;
    aPropYaw(APR.BOX, ACLS.SMALL, AM.METAL, B.rec, ax, top - 0.6, az, dx, dz, 0.035, 2.3, 0.035, [0.45, 0.46, 0.47]);
    aPropYaw(APR.BOX, ACLS.SMALL, AM.METAL, B.rec, ax + tx * 0.35, my - 0.05, az + tz * 0.35, tx, tz, 1.1, 0.03, 0.03, [0.5, 0.5, 0.5]);
    for (let k = 0; k < 4; k++) aPropYaw(APR.BOX, ACLS.SMALL, AM.METAL, B.rec, ax + tx * (0.05 + k * 0.22), my - 0.05, az + tz * (0.05 + k * 0.22), -tz, tx, 0.36 - k * 0.04, 0.02, 0.02, [0.5, 0.5, 0.5]);
  }
}
function archChimneys(B) {
  const st = B.st, r = B.r, E = B.E;
  if (!B.planes.length && st.style !== ARCH_S.TERRACE && st.style !== ARCH_S.SHOP) return;
  const yR = B.yR;
  if (r.surveyed || (r.chims && r.chims.length)) {
    const C = r.chims || [];
    for (let i = 0; i + 3 < C.length; i += 4) {
      const x = C[i], z = C[i + 1], top = C[i + 2], size = clamp(C[i + 3], 0.6, 2.6);
      // along the party wall it stands on, else across the ridge on a gable wall, else along the ridge
      let dx = B.cr, dz = B.sr, best = 1.2;
      for (const e of E) {
        const t = clamp((x - e.ax) * e.dx + (z - e.az) * e.dz, 0, e.L), d = Math.hypot(e.ax + e.dx * t - x, e.az + e.dz * t - z);
        if (d < best) { best = d; dx = e.dx; dz = e.dz; }
      }
      const body = size > 1.05 ? top - 0.45 : top - 0.25;
      archStack(B, x, z, dx, dz, Math.max(0.55, size), size > 1.4 ? 0.75 : 0.6, Math.max(body, yR + 0.4), Math.round(size / 0.45));
    }
    return;
  }
  if (st.chimney === 'none') return;
  const sh = (st.hash >> 13) & 7, on = (e, t) => [e.ax + e.dx * t, e.az + e.dz * t];
  // where the ridge (v = vc) crosses an edge
  const ridgeT = e => { const ua = aU(B, e.ax, e.az), va = aV_(B, e.ax, e.az), ub = aU(B, e.bx, e.bz), vb = aV_(B, e.bx, e.bz); if (Math.abs(vb - va) < 1e-6) return -1; const t = (B.vc - va) / (vb - va); return t > 0.08 && t < 0.92 ? t : -1; };
  let placed = 0;
  if (st.chimney === 'party') {
    for (const e of E) {
      if (e.role !== 'P') continue;
      const nb = e.nb >= 0 ? ARCH.reqs[e.nb] : null;
      if (nb && nb.idx < r.idx && nb.style !== ARCH_S.NONE) continue;   // the neighbour builds the shared stack
      let t = ridgeT(e); if (t < 0) t = 0.5;
      const [x, z] = on(e, t * e.L);
      archStack(B, x, z, e.dx, e.dz, 1.05 + sh * 0.12, 0.62, yR + 0.75 + sh * 0.06, 2 * st.pots); placed++;
    }
  }
  if (st.chimney === 'gable' || (st.chimney === 'party' && !placed)) {
    for (const e of E) {
      if (e.role !== 'S' || e.L < 3) continue;
      const t = ridgeT(e); if (t < 0) continue;
      const [x, z] = on(e, t * e.L);
      archStack(B, x - e.nx * 0.32, z - e.nz * 0.32, e.dx, e.dz, 0.95, 0.62, yR + 0.8, st.pots); placed++;
      if (st.chimney === 'party' && placed) break;
    }
  }
  if (st.chimney === 'mid' || (!placed && st.chimney !== 'none' && B.planes.length)) {
    const u = B.uc + (sh - 3.5) * 0.12 * B.hu, x = aX(B, u, B.vc), z = aZ(B, u, B.vc);
    archStack(B, x, z, B.cr, B.sr, 0.75, 0.6, yR + 0.7, st.pots);
  }
}

// ---------------------------------------------------------------- small roofs over a convex outline (bays, porches)
// xs, zs: outline (world); free[i]: edge i rises from its line at slope k (an eave), else it is against a wall; y0: the
// eaves height; ov: overhang of the free edges. Each free edge's plane is f = k * (distance inward); the roof is their
// lower envelope (a hip roof against the wall).
function archHipRoof(B, xs, zs, free, y0, k, ov, cov, edgeProps) {
  const n = xs.length; let us = xs.slice(), vs = zs.slice(), fr = free.slice();
  if (aArea(us, vs) < 0) { us.reverse(); vs.reverse(); const f2 = []; for (let i = 0; i < n; i++) f2.push(fr[(2 * n - 2 - i) % n]); fr = f2; }
  const ds = fr.map(f => f ? ov : 0), [ou, ov2] = aOffset(us, vs, ds);
  // planes over the outward-offset edges: f = k * ((x - px) * -nx + (z - pz) * -nz)
  const P = [];
  for (let i = 0; i < n; i++) {
    if (!fr[i]) continue;
    const j = (i + 1) % n, ex = ou[j] - ou[i], ez = ov2[j] - ov2[i], L = Math.hypot(ex, ez) || 1, nx = ez / L, nz = -ex / L;
    P.push([-nx * k, -nz * k, k * (ou[i] * nx + ov2[i] * nz)]);
  }
  if (!P.length) return;
  const mb = AG.S;
  for (let a = 0; a < P.length; a++) {
    let cu = ou.slice(), cv = ov2.slice();
    for (let b = 0; b < P.length && cu.length >= 3; b++) { if (b === a) continue; [cu, cv] = aClip(cu, cv, P[a][0] - P[b][0], P[a][1] - P[b][1], P[b][2] - P[a][2]); }
    if (cu.length < 3 || aArea(cu, cv) < 0.005) continue;
    const q = P[a], g = Math.hypot(q[0], q[1]) || 1e-6; let nx = -q[0], ny = 1, nz = -q[1]; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const tris = aEars(cu, cv), v0 = mb.nv; aSetMat(mb, AM.ROOF, B.rec, cov === undefined ? 255 : cov, 0, 0, 0);
    let tmax = 0; for (let i = 0; i < cu.length; i++) tmax = Math.max(tmax, q[2] + q[0] * cu[i] + q[1] * cv[i]);
    for (let i = 0; i < cu.length; i++) { const t = q[2] + q[0] * cu[i] + q[1] * cv[i]; mb.v(cu[i], y0 + t, cv[i], nx, ny, nz, (-q[1] * cu[i] + q[0] * cv[i]) / g, (tmax - t) * Math.sqrt(1 + g * g) / g); }
    for (let i = 0; i < tris.length; i += 3) aT(mb, v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2], nx, ny, nz);
  }
  if (edgeProps) for (let i = 0; i < n; i++) {
    if (!fr[i]) continue;
    const j = (i + 1) % n, x0 = ou[i], z0 = ov2[i], x1 = ou[j], z1 = ov2[j], L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.1) continue;
    const nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
    edgeProps((x0 + x1) / 2 - nx * ov / 2, (z0 + z1) / 2 - nz * ov / 2, x1 - x0, z1 - z0, L, ov);
  }
}

// ---------------------------------------------------------------- bays: canted or square, one to three storeys, under a
// small hipped roof or carried up into a gable (the Weston favourite: a two-storey canted bay in Bath stone under a
// gable with a finial)
function archBays(B) {
  const st = B.st, mb = AG.S;
  for (const e of B.E) for (const c of e.cols) {
    if (!c.bay) continue;
    const W = Math.min(c.bay.w, c.b - c.a + 0.6), type = c.bay.type, canted = type[0] === 'c';
    let Pj = st.bayP; if (canted) Pj = Math.min(Pj, (W - 0.7) / 2); if (Pj < 0.3) continue;
    const s0 = c.c - W / 2, s1 = c.c + W / 2, W2 = (sx, d) => [e.ax + e.dx * sx + e.nx * d, e.az + e.dz * sx + e.nz * d];
    const pA = W2(s0, 0), pB = canted ? W2(s0 + Pj, Pj) : W2(s0, Pj), pC = canted ? W2(s1 - Pj, Pj) : W2(s1, Pj), pD = W2(s1, 0);
    const gable = type === 'c2g' || type === 's2g';
    const nb = c.bay.storeys, rb = Math.min(0.7, Pj * 0.95 + 0.1);
    let yT;
    if (gable) yT = B.yE - 0.32;
    else if (nb >= st.storeys) yT = B.yE - 0.06 - Math.min(rb, 0.4);
    else yT = B.yf + st.gH + (nb - 1) * st.uH - 0.04;
    yT = Math.min(yT, B.yE - 0.06);
    const stone = st.dress === AD.BATH, mull = stone ? 0.13 : 0.09;
    // the faces: one opening column each, between mullions
    const faces = [[pA, pB], [pB, pC], [pC, pD]];
    for (const [p, q] of faces) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.2) continue;
      const tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L;
      aWallMat(B, AC.BAY | AC.GWIN | AC.UWIN, L / 2, Math.max(0.3, L - 2 * mull), 0, yT - B.yf - 0.14);
      aWallPiece(B, p[0], p[1], q[0], q[1], tz, -tx, B.base, () => yT, -L / 2, L / 2);
    }
    AG.S.w = 0;
    const cornice = (mx, mz, dx, dz, L) => aPropYaw(APR.BOX, ACLS.BIG, AM.STONE, B.rec, mx, yT - 0.2, mz, dx, dz, L + 0.06, 0.22, 0.2, stone || st.dress === AD.PAINTED ? st.dressCol : st.fascia, (stone ? ASC.ASHLAR : ASC.SMOOTH) / 15);
    if (!gable) {
      for (const [p, q] of faces) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.2) continue; const tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L; cornice((p[0] + q[0]) / 2 + tz * 0.05, (p[1] + q[1]) / 2 - tx * 0.05, tx, tz, L); }
      // the bay's roof: lead or slate, hipped back to the wall
      const cov = (st.hash >> 7) % 5 < 2 ? AROOF.LEAD : 255;
      archHipRoof(B, [pA[0], pB[0], pC[0], pD[0]], [pA[1], pB[1], pC[1], pD[1]], [true, true, true, false], yT + 0.02, rb / (Pj + 0.12), 0.12, cov);
      continue;
    }
    // gabled: corbels where the canted bay squares out, the box up to the eaves, the gable wall and its roof
    const sq0 = W2(s0, Pj), sq1 = W2(s1, Pj), yC = yT, yE = B.yE;
    aSolid(mb, AM.STONE, B.rec, stone ? ASC.ASHLAR : ASC.SMOOTH, st.dress === AD.NONE ? st.wallCol : st.dressCol);
    if (canted) for (const [a, b, q] of [[pA, pB, sq0], [pD, pC, sq1]]) {
      const i0 = mb.v(a[0], yC, a[1], 0, -1, 0, 0, 0), i1 = mb.v(b[0], yC, b[1], 0, -1, 0, 1, 0), i2 = mb.v(q[0], yC, q[1], 0, -1, 0, 0, 1); aT(mb, i0, i1, i2, 0, -1, 0);
    }
    const kg = Math.max(B.kk * 1.12, 0.95), yA = yE + kg * W / 2;
    const ow = Math.min(0.8, W * 0.34), attic = yA - yE > 1.25;
    // gable front: two halves (the top follows the verges)
    const yLine = (x, z) => { const sx = (x - e.ax) * e.dx + (z - e.az) * e.dz; return yE + kg * Math.max(0, W / 2 - Math.abs(sx - c.c)); };
    aWallMat(B, AC.BAY | AC.GABLE | AC.GNONE | AC.UNONE, W / 2, ow, attic ? Math.round((yE + 0.12 - B.yf) / 0.04) : 255, yA - kg * ow / 2 - 0.22 - B.yf);
    const mid = W2(c.c, Pj);
    aWallPiece(B, sq0[0], sq0[1], mid[0], mid[1], e.nx, e.nz, yC, yLine, -W / 2, 0);
    aWallPiece(B, mid[0], mid[1], sq1[0], sq1[1], e.nx, e.nz, yC, yLine, 0, W / 2);
    // box sides between the corbel and the eaves
    aWallMat(B, AC.BAY | AC.GNONE | AC.UNONE, 0, 0, 0, 0);
    aWallPiece(B, pA[0], pA[1], sq0[0], sq0[1], -e.dx, -e.dz, yC, () => yE, 0, Pj);
    aWallPiece(B, sq1[0], sq1[1], pD[0], pD[1], e.dx, e.dz, yC, () => yE, 0, Pj);
    AG.S.w = 0;
    for (const [p, q] of faces) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.2) continue; const tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L; cornice((p[0] + q[0]) / 2 + tz * 0.05, (p[1] + q[1]) / 2 - tx * 0.05, tx, tz, L); }
    // the gable's roof: two planes from its ridge (along d) to its side eaves, back into the main roof along the valleys
    let lo = -B.hv * 2.2, hi = 0;   // depth where the main roof reaches the gable's ridge height
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2, p = W2(c.c, m); if (aRoofY(B, p[0], p[1]) > yA) lo = m; else hi = m; }
    const dR = (lo + hi) / 2, ovs = 0.16, ovf = 0.2, dF = Pj + ovf, kkF = Math.max(0.2, B.kk), dV = Math.min(st.ovE, kg * ovs / kkF);
    for (const sd of [-1, 1]) {
      const sL = c.c + sd * (W / 2 + ovs), q = [[sL, dF], [c.c, dF], [c.c, dR], [sL, dV]], xs = [], ys = [], zs = [];
      for (const [sx, d] of q) { const w = W2(sx, d); xs.push(w[0]); zs.push(w[1]); ys.push(yA - kg * Math.abs(sx - c.c) + 0.02); }
      // plane normal: rises towards the ridge (across s)
      const gx = -sd * e.dx * kg, gz = -sd * e.dz * kg; let nx = -gx, ny = 1, nz = -gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      aSetMat(mb, AM.ROOF, B.rec, 255, 0, 0, 0);
      const v0 = mb.nv; for (let i = 0; i < 4; i++) { const sx = q[i][0]; mb.v(xs[i], ys[i], zs[i], nx, ny, nz, q[i][1], Math.abs(sx - c.c) * Math.sqrt(1 + kg * kg)); }
      aQ(mb, v0, v0 + 1, v0 + 2, v0 + 3, nx, ny, nz);
      // bargeboard along the verge, fascia and gutter along the side eaves
      const fl = W2(sL, dF), ap = W2(c.c, dF), yL = yE - kg * ovs;
      const bx = ap[0] - fl[0], by = yA - yL, bz = ap[1] - fl[1], BL = Math.hypot(bx, by, bz), cy = Math.sqrt(1 - (by / BL) * (by / BL));
      aPropAlong(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (fl[0] + ap[0]) / 2 - e.nx * ovf / 2, (yL + yA) / 2 - 0.25 * cy + 0.02, (fl[1] + ap[1]) / 2 - e.nz * ovf / 2, bx, by, bz, BL + 0.04, 0.25, ovf + 0.04, st.fascia, 0.6);
      const ev0 = W2(sL, dF), ev1 = W2(sL, dV);
      aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (ev0[0] + ev1[0]) / 2 - sd * e.dx * ovs / 2, yL - 0.2, (ev0[1] + ev1[1]) / 2 - sd * e.dz * ovs / 2, e.nx, e.nz, dF - dV, 0.2, ovs + 0.02, st.fascia, 0.3);
      aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (ev0[0] + ev1[0]) / 2 + sd * e.dx * 0.05, yL - 0.13, (ev0[1] + ev1[1]) / 2 + sd * e.dz * 0.05, e.nx, e.nz, dF - dV, 0.1, 0.11, st.gutter, 0.2);
    }
    const r0 = W2(c.c, dF), r1 = W2(c.c, dR);
    aPropAlong(APR.WEDGE, ACLS.BIG, AM.RIDGE, B.rec, (r0[0] + r1[0]) / 2, yA - kg * 0.17 + 0.02, (r0[1] + r1[1]) / 2, r1[0] - r0[0], 0, r1[1] - r0[1], dF - dR + 0.05, 0.24, 0.36, st.ridgeCol || st.roofCol);
    aPropYaw(APR.BOX, ACLS.SMALL, AM.PAINT, B.rec, r0[0] - e.nx * 0.05, yA - 0.1, r0[1] - e.nz * 0.05, e.dx, e.dz, 0.09, 0.75, 0.09, st.fascia, 0.6);   // finial
    (B.cuts = B.cuts || []).push([e.i, s0 - ovs - 0.05, s1 + ovs + 0.05]);
  }
}

// ---------------------------------------------------------------- dormers (from the LIDAR, or the style's own)
function archDormers(B) {
  const st = B.st, r = B.r, mb = AG.S, P = B.planes; if (P.length < 2) return;
  const list = [];
  if (r.dorms && r.dorms.length) for (let i = 0; i + 4 < r.dorms.length; i += 5) list.push([r.dorms[i], r.dorms[i + 1], r.dorms[i + 2], r.dorms[i + 3], r.dorms[i + 4]]);
  else if (!r.surveyed && st.dormers) {
    // the style's own: one per house unit on the street side (and the back for chalet bungalows)
    const F = B.E[B.f], vF = aV_(B, (F.ax + F.bx) / 2 + F.nx, (F.az + F.bz) / 2 + F.nz), sideF = vF > B.vc ? 1 : 0, n = Math.max(1, Math.round(F.L / Math.max(5, st.unitW)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = F.ax + (F.bx - F.ax) * t - F.nx * 1.4, z = F.az + (F.bz - F.az) * t - F.nz * 1.4, wd = st.style === ARCH_S.CHALET_BUNGALOW ? Math.min(3.2, F.L / n - 1.2) : 1.6;
      list.push([x, z, wd, B.yE + Math.min(B.rise - 0.3, st.style === ARCH_S.CHALET_BUNGALOW ? 1.7 : 1.9), sideF]);
      if (st.style === ARCH_S.CHALET_BUNGALOW) list.push([x - F.nx * 2.4 * 0, z, wd, B.yE + Math.min(B.rise - 0.3, 1.7), 1 - sideF]);
    }
  }
  const gabled = st.style === ARCH_S.VILLA || st.style === ARCH_S.TERRACE || st.style === ARCH_S.HOTEL || st.style === ARCH_S.COTTAGE || st.style === ARCH_S.PUB;
  for (const [x, z, wd0, yTop0, side] of list) {
    const pl = side ? P[1] : P[0], k = Math.abs(pl[1]); if (k < 0.2) continue;
    const ud = aU(B, x, z), vcD = aV_(B, x, z), sg = side ? 1 : -1;   // the front of the dormer faces sg * v
    let vf = vcD + sg * 0.7; vf = side ? Math.min(vf, B.v1 - 0.35) : Math.max(vf, B.v0 + 0.35);
    const fAt = v => pl[2] + pl[1] * v, yfr = B.yE + fAt(vf);
    const wd = clamp(wd0, 1.0, Math.min(6, B.hu * 2 - 0.8)), yTop = clamp(yTop0, yfr + 0.9, B.yR - 0.12); if (yTop - yfr < 0.85) continue;
    const vAt = y => (y - B.yE - pl[2]) / pl[1];                      // where the main roof reaches height y
    const ua = ud - wd / 2, ub = ud + wd / 2, nX = -B.sr * sg, nZ = B.cr * sg;   // outward normal of the front (along v)
    const W = (u, v) => [aX(B, u, v), aZ(B, u, v)], kd = gabled ? 1.0 : 0, yW = gabled ? yTop - kd * wd / 2 : yTop;
    // front wall: one opening column (a window between the cheeks)
    const ow = gabled ? Math.min(0.9, wd - 0.5) : wd - 0.36, a = W(ua, vf), b = W(ub, vf), m = W(ud, vf);
    const top = gabled ? yW - 0.1 : yTop - 0.14, yLine = gabled ? ((xx, zz) => yW + kd * Math.max(0, wd / 2 - Math.abs(aU(B, xx, zz) - ud))) : (() => yTop);
    aWallMat(B, AC.BAY | AC.GABLE | AC.GNONE | AC.UNONE, wd / 2, ow, Math.max(0, Math.round((yfr + 0.14 - B.yf) / 0.04)), top - B.yf);
    const [p0, p1] = sg > 0 ? [b, a] : [a, b];
    if (gabled) { const [q0, q1] = sg > 0 ? [m, a] : [a, m], [q2, q3] = sg > 0 ? [b, m] : [m, b]; aWallPiece(B, q2[0], q2[1], q3[0], q3[1], nX, nZ, yfr - 0.1, yLine, sg > 0 ? -wd / 2 : 0, sg > 0 ? 0 : wd / 2); aWallPiece(B, q0[0], q0[1], q1[0], q1[1], nX, nZ, yfr - 0.1, yLine, sg > 0 ? 0 : -wd / 2, sg > 0 ? wd / 2 : 0); }
    else aWallPiece(B, p0[0], p0[1], p1[0], p1[1], nX, nZ, yfr - 0.1, yLine, -wd / 2 * (sg > 0 ? -1 : 1), wd / 2 * (sg > 0 ? -1 : 1));
    AG.S.w = 0;
    // cheeks: tile-hung triangles back to where the roof meets the dormer's eaves
    const vW = vAt(yW);
    aSetMat(mb, AM.ROOF, B.rec, 255, 0, 0, 0);
    for (const us of [ua, ub]) {
      const f0 = W(us, vf), f1 = W(us, vW), nx = us === ua ? -B.cr : B.cr, nz = us === ua ? -B.sr : B.sr;
      const i0 = mb.v(f0[0], yfr - 0.1, f0[1], nx, 0, nz, vf, 0), i1 = mb.v(f0[0], yW, f0[1], nx, 0, nz, vf, yW - yfr), i2 = mb.v(f1[0], yW, f1[1], nx, 0, nz, vW, yW - yfr);
      aT(mb, i0, i1, i2, nx, 0, nz);
    }
    if (!gabled) {
      // a flat (felt) top from the front back to the main roof, with a fascia
      const vb = vAt(yTop), c0 = W(ua - 0.08, vf + sg * 0.12), c1 = W(ub + 0.08, vf + sg * 0.12), c2 = W(ub + 0.08, vb), c3 = W(ua - 0.08, vb);
      aSetMat(mb, AM.FLAT, B.rec, 255, 0, 0, 0);
      const i0 = mb.v(c0[0], yTop + 0.04, c0[1], 0, 1, 0, 0, 0), i1 = mb.v(c1[0], yTop + 0.04, c1[1], 0, 1, 0, wd, 0), i2 = mb.v(c2[0], yTop + 0.04, c2[1], 0, 1, 0, wd, 1), i3 = mb.v(c3[0], yTop + 0.04, c3[1], 0, 1, 0, 0, 1);
      aQ(mb, i0, i1, i2, i3, 0, 1, 0);
      const fm = W(ud, vf + sg * 0.06);
      aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, fm[0], yTop - 0.16, fm[1], B.cr, B.sr, wd + 0.18, 0.21, 0.13, st.fascia, 0.4);
    } else {
      // a small gable roof: ridge along v from the front to the main roof
      const vR = vAt(yTop), ovs = 0.12, ovf = 0.15, vF = vf + sg * ovf, yL = yW - kd * ovs, vV = vAt(yL);
      for (const sd of [-1, 1]) {
        const uL = ud + sd * (wd / 2 + ovs), q = [[uL, vF], [ud, vF], [ud, vR], [uL, vV]];
        const gx = -sd * B.cr * kd, gz = -sd * B.sr * kd; let nx = -gx, ny = 1, nz = -gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        aSetMat(mb, AM.ROOF, B.rec, 255, 0, 0, 0);
        const v0 = mb.nv; for (const [u, v] of q) { const w = W(u, v); mb.v(w[0], yTop - kd * Math.abs(u - ud) + 0.02, w[1], nx, ny, nz, v, Math.abs(u - ud) * Math.SQRT2); }
        aQ(mb, v0, v0 + 1, v0 + 2, v0 + 3, nx, ny, nz);
        const fl = W(uL, vF), ap = W(ud, vF), bx = ap[0] - fl[0], by = yTop - yL, bz = ap[1] - fl[1], BL = Math.hypot(bx, by, bz);
        aPropAlong(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (fl[0] + ap[0]) / 2 - nX * ovf / 2, (yL + yTop) / 2 - 0.2 * 0.7, (fl[1] + ap[1]) / 2 - nZ * ovf / 2, bx, by, bz, BL + 0.03, 0.2, ovf + 0.03, st.fascia, 0.6);
      }
      const r0 = W(ud, vF), r1 = W(ud, vR);
      aPropAlong(APR.WEDGE, ACLS.BIG, AM.RIDGE, B.rec, (r0[0] + r1[0]) / 2, yTop - 0.15, (r0[1] + r1[1]) / 2, r1[0] - r0[0], 0, r1[1] - r0[1], Math.abs(vR - vF) + 0.05, 0.22, 0.3, st.ridgeCol || st.roofCol);
    }
    // its window sill
    aPropYaw(APR.BOX, ACLS.SMALL, AM.STONE, B.rec, m[0] + nX * 0.03, yfr + 0.08, m[1] + nZ * 0.03, B.cr, B.sr, ow + 0.06, 0.06, 0.06, [0.8, 0.8, 0.78], ASC.SMOOTH / 15);
  }
}

// ---------------------------------------------------------------- porches, canopies, verandas
function archPorches(B) {
  const st = B.st, mb = AG.S, F = B.E[B.f];
  for (const c of F.cols) {
    if (c.g !== AC.GDOOR || (c.v & 4)) continue;
    const W2 = (sx, d) => [F.ax + F.dx * sx + F.nx * d, F.az + F.dz * sx + F.nz * d];
    const dw = st.doorW, yf = B.yf, sF = c.c;
    if (st.porch === 'box') {
      // a projecting porch: brick (or the wall) below, glazed above, a little hipped roof
      const wp = Math.min(c.b - c.a + 0.2, dw + 1.0), dp = 1.15, yP = yf + 2.3, s0 = sF - wp / 2, s1 = sF + wp / 2;
      const a = W2(s0, 0), b = W2(s0, dp), cc = W2(s1, dp), d = W2(s1, 0);
      aWallMat(B, AC.GABLE | AC.GNONE | AC.UNONE, dp / 2, dp - 0.25, Math.round(0.95 / 0.04), 2.08);
      aWallPiece(B, a[0], a[1], b[0], b[1], -F.dx, -F.dz, B.base, () => yP, -dp / 2, dp / 2);
      aWallPiece(B, cc[0], cc[1], d[0], d[1], F.dx, F.dz, B.base, () => yP, -dp / 2, dp / 2);
      aWallMat(B, AC.GDOOR | AC.UNONE, wp / 2, dw, 0, 2.2);
      aWallPiece(B, b[0], b[1], cc[0], cc[1], F.nx, F.nz, B.base, () => yP, -wp / 2, wp / 2);
      AG.S.w = 0;
      archHipRoof(B, [a[0], b[0], cc[0], d[0]], [a[1], b[1], cc[1], d[1]], [false, true, true, true], yP + 0.02, 0.55, 0.1, 255, (mx, mz, dx, dz, L, ov) => aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, mx, yP - 0.16, mz, dx, dz, L + 0.04, 0.2, ov + 0.02, st.fascia, 0.3));
      c.porchBox = true;
    } else if (st.porch === 'gable') {
      // the cottage porch: two low stone walls, an open front under a little gable
      const wp = Math.min(1.7, c.b - c.a + 0.3), dp = 1.1, yP = yf + 2.05, s0 = sF - wp / 2, s1 = sF + wp / 2, kg = 1.0, yA = yP + kg * wp / 2;
      for (const [sx, sgn] of [[s0, -1], [s1, 1]]) {
        const p = W2(sx, 0), q = W2(sx, dp);
        aWallMat(B, AC.GNONE | AC.UNONE, 0, 0, 0, 0);
        aWallPiece(B, sgn < 0 ? p[0] : q[0], sgn < 0 ? p[1] : q[1], sgn < 0 ? q[0] : p[0], sgn < 0 ? q[1] : p[1], F.dx * sgn, F.dz * sgn, B.base, () => yP, 0, dp);
        const p2 = W2(sx - sgn * 0.22, dp), q2 = W2(sx - sgn * 0.22, 0);   // inner face
        aWallPiece(B, sgn < 0 ? p2[0] : q2[0], sgn < 0 ? p2[1] : q2[1], sgn < 0 ? q2[0] : p2[0], sgn < 0 ? q2[1] : p2[1], -F.dx * sgn, -F.dz * sgn, B.base, () => yP, 0, dp);
        aSolid(mb, AM.STONE, B.rec, ASC.RUBBLE, st.wallCol); aBox(mb, (p[0] + q[0]) / 2 - F.dx * sgn * 0.11, yP - 0.01, (p[1] + q[1]) / 2 - F.dz * sgn * 0.11, F.nx, F.nz, dp, 0.02, 0.22, 1);
      }
      // the gable over the opening, and the two roof planes back to the wall
      const g0 = W2(s0, dp), g1 = W2(s1, dp), gm = W2(sF, dp);
      aWallMat(B, AC.GNONE | AC.UNONE, 0, 0, 0, 0);
      const yLine = (x, z) => { const sx = (x - F.ax) * F.dx + (z - F.az) * F.dz; return yP + kg * Math.max(0, wp / 2 - Math.abs(sx - sF)); };
      aWallPiece(B, g0[0], g0[1], gm[0], gm[1], F.nx, F.nz, yP - 0.3, yLine, 0, 1); aWallPiece(B, gm[0], gm[1], g1[0], g1[1], F.nx, F.nz, yP - 0.3, yLine, 0, 1);
      AG.S.w = 0;
      for (const sd of [-1, 1]) {
        const sL = sF + sd * (wp / 2 + 0.12), q = [[sL, dp + 0.12], [sF, dp + 0.12], [sF, 0], [sL, 0]];
        const gx = -sd * F.dx * kg, gz = -sd * F.dz * kg; let nx = -gx, ny = 1, nz = -gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        aSetMat(mb, AM.ROOF, B.rec, 255, 0, 0, 0);
        const v0 = mb.nv; for (const [sx, d] of q) { const w = W2(sx, d); mb.v(w[0], yA - kg * Math.abs(sx - sF) + 0.02, w[1], nx, ny, nz, d, Math.abs(sx - sF) * Math.SQRT2); }
        aQ(mb, v0, v0 + 1, v0 + 2, v0 + 3, nx, ny, nz);
        const fl = W2(sL, dp + 0.12), ap = W2(sF, dp + 0.12), yL = yA - kg * (wp / 2 + 0.12);
        aPropAlong(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, (fl[0] + ap[0]) / 2 - F.nx * 0.06, (yL + yA) / 2 - 0.14, (fl[1] + ap[1]) / 2 - F.nz * 0.06, ap[0] - fl[0], yA - yL, ap[1] - fl[1], Math.hypot(ap[0] - fl[0], yA - yL, ap[1] - fl[1]), 0.2, 0.14, st.fascia, 0.6);
      }
      const r0 = W2(sF, dp + 0.12), r1 = W2(sF, 0);
      aPropAlong(APR.WEDGE, ACLS.BIG, AM.RIDGE, B.rec, (r0[0] + r1[0]) / 2, yA - 0.16, (r0[1] + r1[1]) / 2, r1[0] - r0[0], 0, r1[1] - r0[1], dp + 0.12, 0.2, 0.3, st.ridgeCol || st.roofCol);
    } else if (st.porch === 'canopy') {
      // a hood over the door on two brackets (a portico on posts for hotels and pubs)
      const big = st.style === ARCH_S.HOTEL || st.style === ARCH_S.PUB, w = big ? dw + 1.6 : dw + 0.7, dpth = big ? 1.5 : 0.7, y = yf + st.doorH + (big ? 0.35 : 0.12);
      const m = W2(sF, dpth / 2), col = st.dress === AD.BATH ? st.dressCol : st.style === ARCH_S.DECO ? st.dressCol : st.fascia;
      aPropYaw(APR.BOX, ACLS.BIG, AM.STONE, B.rec, m[0], y, m[1], F.dx, F.dz, w, big ? 0.28 : 0.1, dpth, col, ASC.SMOOTH / 15);
      aPropYaw(APR.WEDGE, ACLS.BIG, AM.LEAD, B.rec, m[0], y + (big ? 0.28 : 0.1), m[1], F.dx, F.dz, w - 0.02, big ? 0.3 : 0.16, dpth, [0.18, 0.19, 0.2]);
      for (const sd of [-1, 1]) {
        if (big) { const pp = W2(sF + sd * (w / 2 - 0.15), dpth - 0.15); aPropYaw(APR.CYL, ACLS.BIG, AM.PAINT, B.rec, pp[0], B.G(pp[0], pp[1]) - 0.05, pp[1], F.dx, F.dz, 0.2, y - B.G(pp[0], pp[1]) + 0.05, 0.2, [0.8, 0.8, 0.78], 0.5); }
        else { const pp = W2(sF + sd * (w / 2 - 0.08), 0.2); aPropYaw(APR.BOX, ACLS.SMALL, AM.STONE, B.rec, pp[0], y - 0.4, pp[1], F.dx, F.dz, 0.08, 0.4, 0.36, col, ASC.SMOOTH / 15); }
      }
    }
  }
  if (st.porch === 'veranda') {
    // chalets: a decked veranda under a lean-to the length of the front, on posts, with a rail
    const dp = 1.6, y0 = B.yf - 0.04, yH = Math.min(B.yE - 0.05, B.yf + 2.35), yL = yH - 0.42, mbx = AG.S;
    const a = [F.ax, F.az], b = [F.bx, F.bz], c2 = [F.bx + F.nx * dp, F.bz + F.nz * dp], d2 = [F.ax + F.nx * dp, F.az + F.nz * dp];
    aSolid(mbx, AM.PAVING, B.rec, ASC.DECK, [0.3, 0.22, 0.15]);
    aBox(mbx, (F.ax + F.bx) / 2 + F.nx * dp / 2, y0 - 0.25, (F.az + F.bz) / 2 + F.nz * dp / 2, F.dx, F.dz, F.L, 0.25, dp, 1 | 4 | 8 | 16);
    archHipRoof(B, [a[0], b[0], c2[0], d2[0]], [a[1], b[1], c2[1], d2[1]], [false, false, true, false], yL, (yH - yL) / dp, 0.15, AROOF.FELT);
    const np = Math.max(2, Math.round(F.L / 2.2));
    for (let i = 0; i < np; i++) {
      const t = 0.2 + (F.L - 0.4) * i / (np - 1), px = F.ax + F.dx * t + F.nx * (dp - 0.12), pz = F.az + F.dz * t + F.nz * (dp - 0.12);
      aPropYaw(APR.BOX, ACLS.BIG, AM.PAINT, B.rec, px, y0, pz, F.dx, F.dz, 0.1, yL - y0 + 0.05, 0.1, [0.8, 0.8, 0.78], 0.5);
    }
    const doorC = F.cols.find(c => c.g === AC.GDOOR), gs = doorC ? doorC.c : F.L / 2;
    for (const [s0, s1] of [[0.1, gs - 0.6], [gs + 0.6, F.L - 0.1]]) {
      if (s1 - s0 < 0.4) continue;
      const mx = F.ax + F.dx * (s0 + s1) / 2 + F.nx * (dp - 0.1), mz = F.az + F.dz * (s0 + s1) / 2 + F.nz * (dp - 0.1);
      aPropYaw(APR.RAIL, ACLS.BIG, AM.PAINT, B.rec, mx, y0, mz, F.dx, F.dz, s1 - s0, 0.9, 1, [0.78, 0.78, 0.75], 0.25);
    }
  }
}
