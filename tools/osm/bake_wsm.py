#!/usr/bin/env python3
"""Bakes the Weston-super-Mare map of the fable game (?map=wsm) into fable/source/js/12_wsm_data.js.

Inputs
  * An OpenStreetMap extract that covers Weston-super-Mare, e.g. the Geofabrik Somerset extract
    (http://download.geofabrik.de/europe/united-kingdom/england/somerset-latest.osm.pbf). Data © OpenStreetMap
    contributors, ODbL 1.0.
  * Terrain: AWS Terrain Tiles (Terrarium PNG, https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png),
    zoom 15 for the town and zoom 12 for the hills and coasts around it. For the UK these come from the Environment
    Agency LIDAR composite DTM, SRTM, EU-DEM and ETOPO1 (see tilezen/joerd docs/attribution.md). The tiles are cached in
    --dem-cache; --fetch downloads the missing ones (about 250 tiles, 12 MB).
  * Environment Agency LIDAR composite 1 m DTM and DSM (Open Government Licence v3.0), from the EA's WCS services in
    British National Grid, 1 km tiles cached in --lidar-cache (--fetch downloads them: about 90 tiles, 380 MB). The DTM
    gives the town's terrain; DSM - DTM inside each footprint gives the height of the eaves and of the ridge of every
    building, and the DSM the height of the pier decks. Also from the LIDAR: the Grand Pier pavilion's roof and towers,
    the church towers (top, width, centre), the height of the road at every vertex (DTM medians: the roads lie on ledges
    cut into the hills, the Toll Road above Sand Bay among them) and every tree crown taller than 4 m (local maxima of
    DSM - DTM away from buildings; the game plants its trees there, at their height). Needs pyproj (OSGB36: its default
    transformation lands within 0.5 m of the LIDAR grid here, measured on 350 footprints).

Command (from the repository root):
  pip install osmium numpy pillow pyproj
  python3 tools/osm/bake_wsm.py --pbf somerset-latest.osm.pbf --dem-cache /tmp/wsm-dem --lidar-cache /tmp/wsm-lidar \\
          --fetch --out fable/source/js/12_wsm_data.js [--preview /tmp/wsm.png]
  node fable/source/build.mjs            # rebuilds fable/index.html with the new data

Output: a JS file with WSM_META (JSON: layout, origin, credits) and WSM_B64 (base64 of a zlib stream holding typed
arrays: terrain grids, the circuit, roads, buildings, land cover, trees, LIDAR road heights and tree crowns). Coordinates are metres in a local frame:
origin at the Grand Pier entrance, X east, Z south (the game's convention), quantised to 1/8 m. The result is
deterministic for a given extract and tile set (no randomness, stable ordering, crc32 hashes for per-building variety).
"""
import argparse, base64, heapq, json, math, os, sys, zlib, urllib.request, collections

import numpy as np
from PIL import Image
import osmium

# ---------------------------------------------------------------- frame and extents
ORIGIN_LAT, ORIGIN_LON = 51.3486, -2.9822          # Grand Pier entrance on Royal Parade
_phi = math.radians(ORIGIN_LAT)
M_LAT = 111132.954 - 559.822 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)   # metres per degree
M_LON = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)
TOWN = (-1400.0, -5100.0, 2900.0, 3300.0)          # x0 z0 x1 z1: buildings, roads, land cover, fine terrain
                                                   # (from Uphill in the south to Sand Point, Sand Bay and Kewstoke)
NEAR_RES, NEAR_Q = 6.0, 0.1                        # fine terrain grid (m) and height quantum (m)
FAR_C, FAR_HALF, FAR_RES, FAR_Q = (600.0, 700.0), 20000.0, 100.0, 0.5   # coarse terrain: centre, half size, grid, quantum
QXY = 0.125                                        # coordinate quantum (m): int16 covers +-4096 m
SEA_LEVEL = 1.2                                    # mid tide (m above Ordnance Datum Newlyn)


def proj(lon, lat):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


def unproj(x, z):
    return (ORIGIN_LON + x / M_LON, ORIGIN_LAT - z / M_LAT)


def in_town(x, z, pad=0.0):
    return TOWN[0] - pad <= x <= TOWN[2] + pad and TOWN[1] - pad <= z <= TOWN[3] + pad


# ---------------------------------------------------------------- terrain tiles
def tile_xy(lon, lat, zoom):
    n = 2 ** zoom
    lr = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n


class Terrarium:
    def __init__(self, cache, fetch):
        self.cache, self.fetch, self.tiles = cache, fetch, {}

    def tile(self, z, x, y):
        k = (z, x, y)
        if k not in self.tiles:
            f = os.path.join(self.cache, f'{z}-{x}-{y}.png')
            if not os.path.exists(f):
                if not self.fetch:
                    sys.exit(f'missing terrain tile {f} (run with --fetch)')
                url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
                os.makedirs(self.cache, exist_ok=True)
                with urllib.request.urlopen(url, timeout=60) as r:
                    data = r.read()
                with open(f + '.part', 'wb') as o:
                    o.write(data)
                os.replace(f + '.part', f)
            a = np.asarray(Image.open(f).convert('RGB')).astype(np.float64)
            self.tiles[k] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        return self.tiles[k]

    def sample(self, xs, zs, zoom):
        """bilinear heights (m) at local points (numpy arrays)"""
        lon, lat = unproj(xs, zs)
        n = 2 ** zoom
        fx = (lon + 180) / 360 * n * 256 - 0.5
        lr = np.radians(lat)
        fy = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n * 256 - 0.5
        x0 = np.floor(fx).astype(np.int64); y0 = np.floor(fy).astype(np.int64); u = fx - x0; v = fy - y0

        def px(X, Y):
            r = np.zeros(X.shape)
            tx, ty = X // 256, Y // 256
            for a, b in sorted(set(zip(tx.ravel().tolist(), ty.ravel().tolist()))):
                m = (tx == a) & (ty == b)
                r[m] = self.tile(zoom, a, b)[Y[m] - b * 256, X[m] - a * 256]
            return r
        return (px(x0, y0) * (1 - u) * (1 - v) + px(x0 + 1, y0) * u * (1 - v) +
                px(x0, y0 + 1) * (1 - u) * v + px(x0 + 1, y0 + 1) * u * v)


class Lidar:
    """Environment Agency LIDAR composite 1 m DTM and DSM, 1 km tiles in British National Grid (cached GeoTIFFs)"""
    WCS = {'dtm': ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs',
                   '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'),
           'dsm': ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-last-return-dsm-1m/wcs',
                   '9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m')}

    def __init__(self, cache, fetch):
        import pyproj
        self.cache, self.fetch, self.tiles = cache, fetch, {}
        self.tr = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)
        os.makedirs(cache, exist_ok=True)

    def en(self, xs, zs):
        lon, lat = unproj(np.asarray(xs, float), np.asarray(zs, float))
        return self.tr.transform(lon, lat)

    def local(self, E, N):
        """British National Grid -> the local frame (x, z), by an affine map fitted once over the region"""
        if not hasattr(self, '_aff'):
            gx, gz = np.meshgrid(np.linspace(TOWN[0], TOWN[2], 9), np.linspace(TOWN[1], TOWN[3], 9))
            e, n = self.en(gx.ravel(), gz.ravel()); A = np.stack([np.asarray(e), np.asarray(n), np.ones(e.size)], 1)
            self._aff = (np.linalg.lstsq(A, gx.ravel(), rcond=None)[0], np.linalg.lstsq(A, gz.ravel(), rcond=None)[0])
        a, b = self._aff; E = np.asarray(E, float); N = np.asarray(N, float)
        return a[0] * E + a[1] * N + a[2], b[0] * E + b[1] * N + b[2]

    def tile(self, kind, te, tn):
        k = (kind, te, tn)
        if k in self.tiles:
            return self.tiles[k]
        f = os.path.join(self.cache, f'{kind}_{te}_{tn}.tif')
        if not os.path.exists(f) and not os.path.exists(f + '.none'):
            if not self.fetch:
                sys.exit(f'missing LIDAR tile {f} (run with --fetch)')
            url, cid = self.WCS[kind]
            q = (f'{url}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId={cid}&format=image/tiff'
                 f'&subset=E({te * 1000},{te * 1000 + 1000})&subset=N({tn * 1000},{tn * 1000 + 1000})')
            data = b''
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(q, timeout=120) as r:
                        data = r.read()
                    break
                except Exception:
                    data = b''
            if data[:4] in (b'II*\0', b'MM\0*'):
                with open(f + '.part', 'wb') as o:
                    o.write(data)
                os.replace(f + '.part', f)
            else:                                   # outside the survey (open sea): no tile
                open(f + '.none', 'w').close()
        a = None
        if os.path.exists(f):
            a = np.asarray(Image.open(f), dtype=np.float32).copy()
            a[~np.isfinite(a) | (a < -60) | (a > 600)] = np.nan
        self.tiles[k] = a
        return a

    def sample(self, kind, E, N):
        """nearest 1 m pixel at British National Grid points (NaN where there is no survey)"""
        E = np.asarray(E, float); N = np.asarray(N, float); out = np.full(E.shape, np.nan, np.float32)
        te = np.floor(E / 1000).astype(np.int64); tn = np.floor(N / 1000).astype(np.int64)
        for a, b in sorted(set(zip(te.ravel().tolist(), tn.ravel().tolist()))):
            m = (te == a) & (tn == b); t = self.tile(kind, a, b)
            if t is None:
                continue
            i = np.clip((E[m] - a * 1000).astype(np.int64), 0, 999); j = np.clip(((b + 1) * 1000 - N[m]).astype(np.int64), 0, 999)
            out[m] = t[j, i]
        return out

    def footprint(self, ring, erode=True, coords=False):
        """DSM and DTM samples (1 m) inside a local-frame polygon, eroded by a pixel when it is big enough"""
        from PIL import ImageDraw, ImageFilter
        E, N = self.en([p[0] for p in ring], [p[1] for p in ring])
        e0, n1 = math.floor(min(E)) - 1, math.ceil(max(N)) + 1; w = int(math.ceil(max(E)) + 1 - e0); h = int(n1 - math.floor(min(N)) + 1)
        if w * h > 400 * 400 or w < 1 or h < 1:
            return (None, None, None, None) if coords else (None, None)
        img = Image.new('L', (w, h), 0); ImageDraw.Draw(img).polygon([(e - e0, n1 - n) for e, n in zip(E, N)], fill=255)
        if erode and ring_area(ring) > 40:
            img = img.filter(ImageFilter.MinFilter(3))
        m = np.asarray(img) > 127
        jj, ii = np.nonzero(m)
        if len(ii) < 4:
            return (None, None, None, None) if coords else (None, None)
        pe = e0 + ii + 0.5; pn = n1 - jj - 0.5
        if coords: return self.sample('dsm', pe, pn), self.sample('dtm', pe, pn), pe, pn
        return self.sample('dsm', pe, pn), self.sample('dtm', pe, pn)


def grid_heights(dem, x0, z0, res, w, h, zoom, blur, lidar=None):
    xs = x0 + np.arange(w) * res; zs = z0 + np.arange(h) * res
    XX, ZZ = np.meshgrid(xs, zs)
    H = np.zeros(XX.shape)
    for j0 in range(0, h, 256):                      # in strips (memory)
        H[j0:j0 + 256] = dem.sample(XX[j0:j0 + 256], ZZ[j0:j0 + 256], zoom)
    if lidar is not None:                            # the 1 m DTM, averaged over each cell (3 x 3 samples); terrain tiles elsewhere
        for j0 in range(0, h, 128):
            X = XX[j0:j0 + 128]; Z = ZZ[j0:j0 + 128]; acc = np.zeros(X.shape); cnt = np.zeros(X.shape)
            for ox in (-res / 3, 0, res / 3):
                for oz in (-res / 3, 0, res / 3):
                    E, N = lidar.en(X + ox, Z + oz); v = lidar.sample('dtm', E, N)
                    ok = np.isfinite(v); acc[ok] += v[ok]; cnt[ok] += 1
            ok = cnt >= 5
            H[j0:j0 + 128][ok] = (acc[ok] / cnt[ok])
    if blur:                                         # light smoothing: the LIDAR's micro relief only costs bytes
        k = np.array([1, 4, 6, 4, 1], float); k /= k.sum()
        Hp = np.pad(H, ((0, 0), (2, 2)), mode='edge')
        H = sum(k[i] * Hp[:, i:i + w] for i in range(5))
        Hp = np.pad(H, ((2, 2), (0, 0)), mode='edge')
        H = sum(k[i] * Hp[i:i + h, :] for i in range(5))
    return H


def predict_encode(H, q):
    """int16 residuals of a planar predictor (left + up - upleft) on heights quantised to q"""
    Q = np.round(H / q).astype(np.int64)
    P = np.zeros_like(Q)
    P[1:, 1:] = Q[1:, :-1] + Q[:-1, 1:] - Q[:-1, :-1]
    P[0, 1:] = Q[0, :-1]
    P[1:, 0] = Q[:-1, 0]
    R = Q - P
    assert R.min() >= -32768 and R.max() < 32768
    return R.astype('<i2')


# ---------------------------------------------------------------- geometry helpers
def ring_area(r):
    a = 0.0
    for (x0, z0), (x1, z1) in zip(r, r[1:] + r[:1]):
        a += x0 * z1 - x1 * z0
    return a / 2


def dp_simplify(pts, tol):
    """Douglas-Peucker on an open polyline"""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]; bx, bz = pts[b]; dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            if L2 < 1e-12:
                d = math.hypot(px - ax, pz - az)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
                d = math.hypot(px - ax - dx * t, pz - az - dz * t)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(r, tol):
    """r: closed ring without the repeated last point"""
    if len(r) <= 4:
        return r
    # split at the vertex farthest from the first, simplify both halves
    far = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    a = dp_simplify(r[:far + 1], tol); b = dp_simplify(r[far:] + [r[0]], tol)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else r


def dedupe(pts, eps):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    return out


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def obb(r):
    """minimum-area oriented box: (angle of the long side, length, width)"""
    h = convex_hull(r)
    best = None
    for (x0, z0), (x1, z1) in zip(h, h[1:] + h[:1]):
        a = math.atan2(z1 - z0, x1 - x0); c, s = math.cos(a), math.sin(a)
        us = [x * c + z * s for x, z in h]; vs = [-x * s + z * c for x, z in h]
        L, W = max(us) - min(us), max(vs) - min(vs)
        if best is None or L * W < best[1] * best[2] - 1e-9:
            best = (a, L, W) if L >= W else (a + math.pi / 2, W, L)
    return best if best else (0.0, 1.0, 1.0)


def crc(s):
    return zlib.crc32(s.encode()) & 0xffffffff


def vnoise(x, z, seed):
    """smooth value noise for spatially coherent choices (deterministic)"""
    def h(i, j): return (zlib.crc32(f'{seed}:{i}:{j}'.encode()) & 0xffff) / 65535.0
    i, j = math.floor(x), math.floor(z); fx, fz = x - i, z - j
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a = h(i, j) + (h(i + 1, j) - h(i, j)) * fx
    b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * fx
    return a + (b - a) * fz


class SegGrid:
    """spatial hash of segments (for nearest-road and ray queries)"""
    def __init__(self, cell):
        self.cell, self.g = cell, collections.defaultdict(list)

    def add(self, ax, az, bx, bz, data):
        c = self.cell
        for i in range(int(math.floor(min(ax, bx) / c)), int(math.floor(max(ax, bx) / c)) + 1):
            for j in range(int(math.floor(min(az, bz) / c)), int(math.floor(max(az, bz) / c)) + 1):
                self.g[(i, j)].append((ax, az, bx, bz, data))

    def near(self, x, z, r):
        c = self.cell; seen = set()
        for i in range(int(math.floor((x - r) / c)), int(math.floor((x + r) / c)) + 1):
            for j in range(int(math.floor((z - r) / c)), int(math.floor((z + r) / c)) + 1):
                for s in self.g.get((i, j), ()):
                    if id(s) not in seen:
                        seen.add(id(s)); yield s


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    return math.hypot(px - ax - dx * t, pz - az - dz * t), t


# ---------------------------------------------------------------- OSM reading
DRIVE = {'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5, 'residential': 6,
         'living_street': 7, 'service': 8, 'trunk_link': 2, 'primary_link': 2, 'secondary_link': 3,
         'tertiary_link': 4, 'road': 6}
PAVED_PATH = {'pedestrian': 9, 'footway': 10, 'cycleway': 10, 'path': 11, 'track': 11, 'bridleway': 11}
# road classes: 1 trunk 2 primary 3 secondary 4 tertiary 5 unclassified 6 residential 7 living street 8 service
#               9 pedestrian street (paved, drivable) 10 footway/cycleway/promenade 11 path/track (gravel) 12 pier deck
DEF_WIDTH = {1: 9.0, 2: 8.0, 3: 7.4, 4: 7.0, 5: 6.4, 6: 6.0, 7: 5.2, 8: 3.6, 9: 7.0, 10: 2.6, 11: 2.4, 12: 6.0}

# land cover classes (painter's order: lower first)
LC = {'dune': 14, 'residential': 1, 'grass': 2, 'field': 3, 'wood': 4, 'scrub': 5, 'sand': 6, 'mud': 7, 'water': 8,
      'paved': 9, 'pier': 10, 'garden': 11, 'cemetery': 12, 'pitch': 13}


def landcover_class(t):
    g = t.get
    if g('man_made') == 'pier':
        return LC['pier']
    n, lu, le = g('natural'), g('landuse'), g('leisure')
    if n == 'water' or lu in ('reservoir', 'basin') or le == 'swimming_pool':
        return LC['water']
    if n in ('beach', 'sand') or (n == 'wetland' and g('wetland') == 'sand'):
        return LC['sand']
    if n in ('mud',) or (n == 'wetland' and (g('tidal') == 'yes' or g('wetland') in ('tidalflat', 'saltmarsh'))):
        return LC['mud']
    if n == 'wood' or lu == 'forest':
        return LC['wood']
    if n in ('scrub', 'heath', 'shrubbery') or lu == 'brownfield':
        return LC['scrub']
    if le in ('pitch', 'track') and g('surface') not in ('asphalt', 'concrete', 'paved'):
        return LC['pitch']
    if lu in ('cemetery', 'religious') or g('amenity') == 'grave_yard':
        return LC['cemetery']
    if le in ('garden',) or lu in ('flowerbed',):
        return LC['garden']
    if lu in ('grass', 'village_green', 'recreation_ground') or le in ('park', 'playground', 'golf_course', 'common', 'dog_park', 'miniature_golf') or n == 'grassland':
        return LC['grass']
    if lu in ('meadow', 'farmland', 'allotments', 'orchard', 'farmyard', 'animal_keeping', 'greenfield') :
        return LC['field']
    if g('tourism') in ('caravan_site', 'camp_site'):
        return LC['grass']
    if g('amenity') == 'parking' or g('area:highway') or (g('highway') in ('pedestrian',) and g('area') == 'yes') or g('place') == 'square' or lu in ('retail', 'commercial', 'industrial', 'construction', 'railway') or le in ('schoolyard', 'marina'):
        return LC['paved']
    if lu == 'residential':
        return LC['residential']
    return 0


DROP_BUILDINGS = {'shed', 'greenhouse', 'hut', 'roof', 'no', 'construction', 'static_caravan', 'carport', 'conservatory'}


def read_osm(pbf):
    roads, areas, buildings, trees, tree_rows, piers = [], [], [], [], [], []
    W, S = unproj(TOWN[0] - 600, TOWN[3] + 600); E, N = unproj(TOWN[2] + 600, TOWN[1] - 600)
    def inb(lon, lat): return W <= lon <= E and S <= lat <= N
    fp = osmium.FileProcessor(pbf).with_locations().with_areas()
    for o in fp:
        t = o.tags
        if len(t) == 0:
            continue
        if o.is_node():
            if t.get('natural') == 'tree':
                l = o.location
                x, z = proj(l.lon, l.lat)
                if in_town(x, z):
                    trees.append((o.id, x, z))
            continue
        if o.is_way():
            try:
                lls = [(n.location.lon, n.location.lat) for n in o.nodes]
                ids = [n.ref for n in o.nodes]
            except osmium.InvalidLocationError:
                continue
            if not any(inb(*ll) for ll in lls):
                continue
            pts = [proj(*ll) for ll in lls]
            hw = t.get('highway')
            if hw in DRIVE or hw in PAVED_PATH or hw == 'steps':
                if t.get('area') == 'yes' or t.get('tunnel') in ('yes', 'building_passage', 'culvert'):
                    continue
                roads.append((o.id, dict(t), pts, ids))
            elif t.get('man_made') == 'pier' and not o.is_closed():
                piers.append((o.id, dict(t), pts))
            elif t.get('natural') == 'tree_row':
                tree_rows.append((o.id, pts))
            continue
        if o.is_area():
            polys = []
            try:
                for outer in o.outer_rings():
                    ring = [proj(n.lon, n.lat) for n in outer]
                    inners = [[proj(n.lon, n.lat) for n in inner] for inner in o.inner_rings(outer)]
                    polys.append((ring, inners))
            except osmium.InvalidLocationError:
                continue
            if not polys:
                continue
            bx = [p[0] for r, _ in polys for p in r]; bz = [p[1] for r, _ in polys for p in r]
            if max(bx) < TOWN[0] - 50 or min(bx) > TOWN[2] + 50 or max(bz) < TOWN[1] - 50 or min(bz) > TOWN[3] + 50:
                continue
            oid = o.orig_id() * 2 + (0 if o.from_way() else 1)
            if 'building' in t and t.get('building') not in DROP_BUILDINGS:
                buildings.append((oid, dict(t), polys))
            elif t.get('building') is None:
                c = landcover_class(t)
                if c:
                    areas.append((oid, c, dict(t), polys))
    roads.sort(key=lambda r: r[0]); areas.sort(key=lambda a: a[0]); buildings.sort(key=lambda b: b[0])
    trees.sort(); tree_rows.sort(key=lambda r: r[0]); piers.sort(key=lambda r: r[0])
    return roads, areas, buildings, trees, tree_rows, piers


# ---------------------------------------------------------------- static caravans
def bake_caravans(areas, bl, lidar, lu_lookup, log):
    """The holiday parks of Sand Bay: OSM maps the caravan sites but not the caravans. The LIDAR sees them: rectangles
    6.5-13.5 m by 2.8-4.8 m standing 2-4.5 m above the ground (DSM - DTM), away from the mapped buildings. Each one found
    becomes a white building with a shallow roof, at its measured place, size, heading and height."""
    from PIL import ImageDraw, ImageFilter
    inv = __import__('pyproj').Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
    out = []; nsite = 0
    for oid, c, t, polys in areas:
        if t.get('tourism') != 'caravan_site': continue
        for ring, _ in polys:
            if not in_town(*ring[0]): continue
            E, N = lidar.en([p[0] for p in ring], [p[1] for p in ring])
            e0, n1 = math.floor(min(E)) - 2, math.ceil(max(N)) + 2; w = int(math.ceil(max(E)) + 2 - e0); h = int(n1 - math.floor(min(N)) + 2)
            if w * h > 1500 * 1500: continue
            nsite += 1
            ee, nn = np.meshgrid(e0 + np.arange(w) + 0.5, n1 - np.arange(h) - 0.5)
            chm = (lidar.sample('dsm', ee.ravel(), nn.ravel()) - lidar.sample('dtm', ee.ravel(), nn.ravel())).reshape(h, w)
            img = Image.new('L', (w, h), 0); ImageDraw.Draw(img).polygon([(e - e0, n1 - n) for e, n in zip(E, N)], fill=255)
            bimg = Image.new('L', (w, h), 0); bd = ImageDraw.Draw(bimg)
            for b in bl:
                if abs(b[0] - ring[0][0]) > 2500 or abs(b[1] - ring[0][1]) > 2500: continue
                BE, BN = lidar.en([p[0] for p in b[2]], [p[1] for p in b[2]])
                if max(BE) < e0 or min(BE) > e0 + w or max(BN) < n1 - h or min(BN) > n1: continue
                bd.polygon([(e - e0, n1 - n) for e, n in zip(BE, BN)], fill=255)
            near_b = np.asarray(bimg.filter(ImageFilter.MaxFilter(3))) > 0
            m = (np.asarray(img) > 127) & np.isfinite(chm) & (chm > 2.0) & (chm < 4.5) & ~near_b
            lab = np.zeros((h, w), np.int32); nl = 0
            for j0, i0 in zip(*np.nonzero(m)):
                if lab[j0, i0]: continue
                nl += 1; lab[j0, i0] = nl; st = [(j0, i0)]; cells = []
                while st:
                    a0, b0 = st.pop(); cells.append((a0, b0))
                    for a1, b1 in ((a0 + 1, b0), (a0 - 1, b0), (a0, b0 + 1), (a0, b0 - 1)):
                        if 0 <= a1 < h and 0 <= b1 < w and m[a1, b1] and not lab[a1, b1]:
                            lab[a1, b1] = nl; st.append((a1, b1))
                if not (14 <= len(cells) <= 75): continue
                cj = np.array([p[0] for p in cells], np.float64); ci = np.array([p[1] for p in cells], np.float64)
                lon, lat = inv.transform(e0 + ci + 0.5, n1 - cj - 0.5); x, z = proj(np.asarray(lon), np.asarray(lat))
                mx, mz = float(x.mean()), float(z.mean()); C = np.cov(np.vstack([x - mx, z - mz]))
                ev, evec = np.linalg.eigh(C); ux, uz = evec[0, 1], evec[1, 1]
                u = (x - mx) * ux + (z - mz) * uz; v = -(x - mx) * uz + (z - mz) * ux
                L = float(u.max() - u.min() + 1.0); W = float(v.max() - v.min() + 1.0)
                if not (6.5 <= L <= 13.5 and 2.8 <= W <= 4.8) or len(cells) < 0.7 * L * W: continue
                uc = float(u.max() + u.min()) / 2; vc = float(v.max() + v.min()) / 2
                cx, cz = mx + uc * ux - vc * uz, mz + uc * uz + vc * ux
                ring2 = [(cx + su * L / 2 * ux - sv * W / 2 * uz, cz + su * L / 2 * uz + sv * W / 2 * ux) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                if ring_area(ring2) < 0: ring2 = ring2[::-1]
                hc = crc(f'caravan{cx:.1f},{cz:.1f}')
                ht = float(min(3.6, max(2.4, np.percentile(chm[cj.astype(int), ci.astype(int)], 70) - 0.35)))
                ang = math.remainder(math.atan2(uz, ux), math.pi)
                if ang < 0: ang += math.pi
                out.append((cx, cz, ring2, 0, ht, 1, ang, hc, lu_lookup(cx, cz), 0.22, 1, [], [], 255))
    log(f'static caravans from the LIDAR: {len(out)} on {nsite} caravan sites')
    return out


# ---------------------------------------------------------------- roads
def road_class(t):
    hw = t.get('highway')
    if hw in DRIVE:
        return DRIVE[hw]
    return PAVED_PATH.get(hw, 0)


def road_width(t, cls):
    try:
        w = float(t.get('width', '').split()[0].replace(',', '.'))
        if 2 <= w <= 30:
            return w
    except (ValueError, IndexError):
        pass
    try:
        lanes = int(t.get('lanes', ''))
        if cls <= 7 and 1 <= lanes <= 6:
            return max(DEF_WIDTH[cls] * 0.6, lanes * 3.3 + (0.6 if lanes == 1 else 0.0))
    except ValueError:
        pass
    w = DEF_WIDTH[cls]
    if cls <= 6 and t.get('oneway') in ('yes', '-1', '1') and cls >= 4:
        w *= 0.75
    return w


def clip_polyline(pts, pad):
    """keeps the runs of a polyline inside the town (with pad): returns a list of polylines"""
    out, cur = [], []
    for p in pts:
        if in_town(p[0], p[1], pad):
            cur.append(p)
        else:
            if len(cur) >= 2: out.append(cur)
            cur = []
    if len(cur) >= 2: out.append(cur)
    return out


# ---------------------------------------------------------------- circuit
# Waypoints (local metres) at junctions. Clockwise, like the Serra da Mata circuit: Royal Parade north from the Grand
# Pier, right into Knightstone Road, South Parade, Waterloo Street and the Boulevard through the town centre, Alfred
# Street, Alexandra Parade, Locking Road and Station Road, south down Walliscote Road, west along Clevedon Road and back
# north on the seafront: Beach Road, Marine Parade, Royal Parade. Wide roads only (the autopilot drives it).
CIRCUIT_WP = [(25, 60), (-49, -233), (89, -225), (357, -178), (579, -194), (565, 183), (427, 335), (295, 918), (80, 883)]
CIRCUIT_START = (24.0, 88.0)          # start/finish line: Royal Parade at the entrance of the Grand Pier


def build_graph(roads):
    pos, adj = {}, collections.defaultdict(list)
    for oid, t, pts, ids in roads:
        cls = road_class(t)
        if not (1 <= cls <= 8) or cls == 8 and t.get('service') in ('parking_aisle', 'driveway', 'drive-through'):
            continue
        pen = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1.2, 6: 1.5, 7: 3, 8: 6}[cls]
        for i, p in zip(ids, pts):
            pos[i] = p
        for a, b, pa, pb in zip(ids, ids[1:], pts, pts[1:]):
            L = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
            adj[a].append((b, L * pen, oid)); adj[b].append((a, L * pen, oid))    # closed circuit: one-way streets ignored
    return pos, adj


def dijkstra(adj, s, t):
    dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t:
            break
        if d > dist[u]:
            continue
        for v, w, oid in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = (u, oid); heapq.heappush(pq, (nd, v))
    path, ways = [t], []
    while path[-1] != s:
        u, oid = prev[path[-1]]; ways.append(oid); path.append(u)
    return path[::-1], ways[::-1]


def resample_closed(P, step):
    P = np.asarray(P, float)
    seg = np.hypot(*(np.roll(P, -1, 0) - P).T)
    cum = np.concatenate([[0], np.cumsum(seg)]); L = cum[-1]; n = int(round(L / step))
    s = np.arange(n) * L / n
    idx = np.searchsorted(cum, s, side='right') - 1
    f = (s - cum[idx]) / np.maximum(seg[idx], 1e-9)
    Q = P[idx] + (np.roll(P, -1, 0)[idx] - P[idx]) * f[:, None]
    return Q, L


def gauss_closed(A, sigma):
    n = len(A); k = int(math.ceil(sigma * 3)); w = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2); w /= w.sum()
    out = np.zeros_like(A)
    for i, wi in enumerate(w):
        out += wi * np.roll(A, k - i, 0)
    return out


def build_circuit(roads, road_polys, bld_grid, log):
    pos, adj = build_graph(roads)
    wayinfo = {oid: t for oid, t, pts, ids in roads}
    def nearest(x, z): return min(pos, key=lambda i: (pos[i][0] - x) ** 2 + (pos[i][1] - z) ** 2)
    nodes = [nearest(x, z) for x, z in CIRCUIT_WP]
    path, ways = [], []
    for a, b in zip(nodes, nodes[1:] + nodes[:1]):
        p, w = dijkstra(adj, a, b); path += p[:-1]; ways += w
    raw = [pos[i] for i in path]
    # road width along the raw route (per raw vertex: the way leaving it)
    wids = [road_width(wayinfo[o], road_class(wayinfo[o])) for o in ways]
    seq = []
    for o in ways:
        nm = wayinfo[o].get('name', '?')
        if not seq or seq[-1] != nm: seq.append(nm)
    P, L = resample_closed(raw, 0.5)
    # width at each resampled point: from the raw segment it lies on
    rawP = np.asarray(raw); seg = np.hypot(*(np.roll(rawP, -1, 0) - rawP).T); cum = np.concatenate([[0], np.cumsum(seg)])
    sres = np.arange(len(P)) * L / len(P); si = np.searchsorted(cum, sres, side='right') - 1
    Wd = np.asarray(wids)[np.clip(si, 0, len(wids) - 1)]
    # smoothing: the street corners become curves the cars can follow (sigma 5 m), corners cut by about 1.5 m
    S = gauss_closed(P, 10.0)               # 10 samples = 5 m
    dev = np.hypot(*(S - P).T)
    # minimum width over a +-8 m window (junctions), as half width
    Wm = np.array([Wd[np.arange(i - 16, i + 17) % len(Wd)].min() for i in range(len(Wd))]) / 2
    Q, L2 = resample_closed(S, 1.0)
    n = len(Q)
    # back to 1 m samples: half width and deviation
    idx = (np.arange(n) * len(S) / n).astype(int)
    hw = Wm[idx]; dv = dev[idx]
    # rotate so that sample 0 is the start line
    k0 = int(np.argmin(np.hypot(Q[:, 0] - CIRCUIT_START[0], Q[:, 1] - CIRCUIT_START[1])))
    Q = np.roll(Q, -k0, 0); hw = np.roll(hw, -k0); dv = np.roll(dv, -k0)
    # direction: clockwise on the map (north along the seafront from the pier)
    t0 = Q[5] - Q[0]
    if t0[1] > 0:                          # heading south: reverse
        Q = np.concatenate([Q[:1], Q[1:][::-1]]); hw = np.concatenate([hw[:1], hw[1:][::-1]]); dv = np.concatenate([dv[:1], dv[1:][::-1]])
    # road surface around the circuit: carriageways (and pedestrian streets) rasterised at 0.5 m
    T = np.roll(Q, -1, 0) - np.roll(Q, 1, 0); T /= np.hypot(*T.T)[:, None]
    Nr = np.stack([-T[:, 1], T[:, 0]], 1)            # right-hand normal (X east, Z south)
    from PIL import ImageDraw
    MR = 0.5; mx0, mz0 = Q[:, 0].min() - 40, Q[:, 1].min() - 40; mw = int((Q[:, 0].max() + 40 - mx0) / MR); mh = int((Q[:, 1].max() + 40 - mz0) / MR)
    mask = Image.new('L', (mw, mh), 0); md = ImageDraw.Draw(mask)
    for part, cls, w in road_polys:
        if not (1 <= cls <= 9): continue
        pp = [((x - mx0) / MR, (z - mz0) / MR) for x, z in part]
        md.line(pp, fill=255, width=max(1, int(round(w / MR))))
        r = w / MR / 2
        for px, pz in pp: md.ellipse([px - r, pz - r, px + r, pz + r], fill=255)
    M = np.asarray(mask) > 0
    def on_road(x, z):
        i = int((x - mx0) / MR); j = int((z - mz0) / MR)
        return 0 <= i < mw and 0 <= j < mh and M[j, i]
    # distance to the edge of the road on each side, and room for the autopilot (never closer than 1.3 m to a building)
    edge = np.zeros((n, 2)); room = np.zeros((n, 2))
    for i in range(n):
        for sd, side in ((0, -1.0), (1, 1.0)):
            px, pz = Q[i]; dx, dz = Nr[i] * side
            t = 0.0
            while t < 14 and on_road(px + dx * t, pz + dz * t): t += 0.25
            edge[i, sd] = t
            lim = min(t, 7.0) - 1.35
            for ax, az, bx, bz, _ in bld_grid.near(px, pz, 12):
                ex, ez = bx - ax, bz - az; den = dx * ez - dz * ex
                if abs(den) < 1e-9: continue
                tt = ((ax - px) * ez - (az - pz) * ex) / den; uu = ((ax - px) * dz - (az - pz) * dx) / den
                if 0 <= uu <= 1 and 0 < tt < lim + 1.3:
                    lim = tt - 1.3
            room[i, sd] = max(0.3, lim)
    # the room changes gradually and errs on the safe side
    for sd in range(2):
        r = room[:, sd]; room[:, sd] = np.array([r[np.arange(i - 6, i + 7) % n].min() for i in range(n)])
    hd = np.unwrap(np.arctan2(T[:, 1], T[:, 0])); k = (np.roll(hd, -2) - np.roll(hd, 2)) / 4.0
    k[:2] = k[2]; k[-2:] = k[-3]
    log(f'circuit: {L:.0f} m raw, {n} m smoothed; max corner cut {dev.max():.2f} m; min radius {1 / max(np.abs(k).max(), 1e-6):.1f} m')
    for i in np.argsort(-np.abs(k))[:int(os.environ.get("WSM_TIGHT", "0"))]:
        log(f'  tight: s={i} r={1 / abs(k[i]):.1f} at {Q[i][0]:.0f},{Q[i][1]:.0f} room {room[i]}')
    log('circuit streets: ' + ' / '.join(seq))
    return Q, edge, room, ways, seq, L2


# ---------------------------------------------------------------- buildings
KIND = {'house': 0, 'terrace': 1, 'flats': 2, 'shop': 3, 'church': 4, 'industrial': 5, 'civic': 6, 'garage': 7,
        'pavilion': 8, 'ruins': 9, 'hotel': 10, 'shelter': 11}


def building_kind(t, area, lu):
    b = t.get('building')
    if t.get('name', '').startswith('Grand Pier'):
        return KIND['pavilion']
    if t.get('amenity') == 'shelter' or b in ('kiosk_roof', 'grandstand', 'bandstand'):
        return KIND['shelter']
    if b in ('ruins',) or t.get('ruins') == 'yes':
        return KIND['ruins']
    if b in ('terrace',):
        return KIND['terrace']
    if b in ('house', 'detached', 'semidetached_house', 'bungalow'):
        return KIND['house']
    if b in ('apartments', 'residential', 'dormitory'):
        return KIND['flats'] if area > 160 else KIND['house']
    if b in ('retail', 'commercial', 'shop', 'office', 'supermarket', 'kiosk'):
        return KIND['shop']
    if b in ('hotel',) or t.get('tourism') == 'hotel':
        return KIND['hotel']
    if b in ('church', 'chapel', 'cathedral') or t.get('amenity') == 'place_of_worship':
        return KIND['church']
    if b in ('industrial', 'warehouse', 'factory', 'service', 'storage_tank', 'farm_auxiliary', 'barn', 'transformer_tower'):
        return KIND['industrial']
    if b in ('garage', 'garages', 'parking'):
        return KIND['garage']
    if b in ('school', 'college', 'hospital', 'public', 'civic', 'university', 'train_station', 'sports_centre', 'government', 'fire_station', 'police'):
        return KIND['civic']
    # building=yes: by size and land use
    if area < 30:
        return KIND['garage']
    if lu in ('retail', 'commercial'):
        return KIND['shop']
    if lu == 'industrial':
        return KIND['industrial']
    if area > 450:
        return KIND['flats'] if lu == 'residential' else KIND['civic']
    return KIND['house']


def point_in_ring(ring, x, z):
    inside = False; n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]; x2, z2 = ring[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: inside = not inside
    return inside


# landmark looks (high nibble of the land-use byte): 1 white or cream render (the seafront hotels), 2 red brick with
# pale stone dressings (the Winter Gardens), 3 Bath stone (Knightstone, the Town Hall), 4 grey stone (churches)
def landmark_look(t):
    nm = t.get('name', '')
    if 'Winter Gardens' in nm: return 2
    if any(k in nm for k in ('Knightstone', 'Town Hall', 'Blakehay', 'Playhouse')): return 3
    if t.get('building') in ('church', 'chapel', 'cathedral') or t.get('amenity') == 'place_of_worship': return 4
    if t.get('tourism') == 'hotel' or 'Hotel' in nm or 'Tropicana' in nm: return 1
    return 0


# ---------------------------------------------------------------- roofs from the LIDAR
ROOF_FLAT, ROOF_GABLE, ROOF_HIP, ROOF_HALFHIP = 0, 1, 2, 4


def roof_fit(r, ang, lidar, ground=None):
    """Fits roof shapes to the LIDAR surface over a footprint (heights above the ground or the deck): a gable along
    either axis of the footprint's box, a hip, a half-hip (jerkinhead), or flat. Returns a dict: kind, ridge (axis
    angle), eaves and ridge heights, rms, plus chimney stacks (small blobs standing 0.7-3.5 m above the fitted roof)
    and dormers (wider blobs on the slopes), or None where the survey says too little."""
    fd, ft, fe, fn = lidar.footprint(r, coords=True)
    if fd is None: return None
    g = ft if ground is None else np.full(fd.shape, ground, np.float32)
    ok = np.isfinite(fd) & np.isfinite(g)
    if ok.sum() < 8: return None
    H = (fd - g)[ok]; X, Z = lidar.local(fe[ok], fn[ok]); gi = np.floor(fe[ok]).astype(np.int64); gj = np.floor(fn[ok]).astype(np.int64)
    p15, p95 = np.percentile(H, [15, 95])
    if p95 < 1.6: return None
    best = None
    for a in (ang, ang + math.pi / 2):
        ca, sa = math.cos(a), math.sin(a)
        ur = [x * ca + z * sa for x, z in r]; vr = [-x * sa + z * ca for x, z in r]
        u0, u1, v0, v1 = min(ur), max(ur), min(vr), max(vr); uc, vc, hu, hv = (u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2
        if hv < 1.4: continue
        U = X * ca + Z * sa - uc; V = -X * sa + Z * ca - vc
        cands = []
        for vr in np.linspace(-0.3 * hv, 0.3 * hv, 7):          # (the ridge a little off the box's middle: a back extension)
            cands.append((ROOF_GABLE, np.abs(V - vr)))
            if hu >= hv - 0.3:
                cands.append((ROOF_HIP, np.maximum(np.abs(V - vr), np.abs(U) - (hu - hv))))
                cands.append((ROOF_HALFHIP, np.maximum(np.abs(V - vr), 2.0 * (np.abs(U) - (hu - hv * 0.5)))))
        for kind, t in cands:
            A = np.stack([np.ones_like(t), -t], 1); keep = np.ones(t.size, bool)
            for _ in range(2):                   # (twice: the chimneys, aerials and overhanging trees drop out)
                sol = np.linalg.lstsq(A[keep], H[keep], rcond=None)[0]
                res = H - A @ sol; sd = max(0.15, float(np.sqrt(np.mean(res[keep] ** 2))))
                keep = np.abs(res) < 2.5 * sd
                if keep.sum() < 6: break
            R, k = float(sol[0]), float(sol[1]); rms = float(np.sqrt(np.mean(res[keep] ** 2))) if keep.sum() else 9
            pen = {ROOF_GABLE: 1.0, ROOF_HIP: 1.12, ROOF_HALFHIP: 1.2}[kind]   # (prefer the plainer roof unless clearly worse)
            if best is None or rms * pen < best['score']:
                best = dict(kind=kind, ridge=a, R=R, k=k, rms=rms, score=rms * pen, eaves=R - k * hv, hv=hv, hu=hu, uc=uc, vc=vc, ca=ca, sa=sa, res=res, U=U, V=V)
    flat_rms = float(np.std(H)) if H.size else 9
    if p95 - p15 < 0.9 and (best is None or best['rms'] > 0.5 * flat_rms):
        out = dict(kind=ROOF_FLAT, ridge=ang, eaves=float(max(2.4, np.percentile(H, 90))), top=float(np.percentile(H, 90)), rms=flat_rms, sure=True)
        res = H - out['eaves']; U = V = None
    elif best is None or best['k'] < 0.25 or best['k'] > 1.6 or best['rms'] > 0.6 * flat_rms:
        return dict(sure=False)                             # (a roof the simple shapes do not explain: keep the old guess)
    else:
        out = dict(kind=best['kind'], ridge=best['ridge'] % math.pi, eaves=float(max(2.4, best['eaves'])), top=float(best['R']), rms=best['rms'], sure=True)
        res = best['res']; U, V = best['U'], best['V']
    # blobs above the roof: chimney stacks (small) and dormers (on a slope, wider)
    chim, dorm = [], []
    cand = res > 0.5
    if cand.any():
        cells = {(int(gi[q]), int(gj[q])): q for q in np.nonzero(cand)[0]}
        seen = set()
        for c0 in list(cells):
            if c0 in seen: continue
            st = [c0]; comp = []; seen.add(c0)
            while st:
                c = st.pop(); comp.append(cells[c])
                for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (c[0] + d[0], c[1] + d[1])
                    if nb in cells and nb not in seen: seen.add(nb); st.append(nb)
            qs = np.array(comp); rmax = float(res[qs].max()); qm = qs[np.argmax(res[qs])]
            if 1 <= len(qs) <= 6 and 0.7 <= rmax <= 3.5 and H[qm] > out['eaves'] + 0.6:
                chim.append((float(X[qm]), float(Z[qm]), float(H[qm]), min(2.4, 0.6 + 0.35 * len(qs))))
            elif U is not None and 3 <= len(qs) <= 16 and 0.4 <= rmax <= 2.2 and np.abs(V[qs]).min() > 0.8:
                uw = float(U[qs].max() - U[qs].min() + 1.0); sd_ = 1 if float(V[qs].mean()) > 0 else -1
                dorm.append((float(X[qs].mean()), float(Z[qs].mean()), min(6.0, max(1.2, uw)), float(H[qs].max()), sd_))
    out['chim'] = chim; out['dorm'] = dorm
    return out


def front_edge(r, roadgrid):
    """index of the footprint edge that faces the nearest road (its outward normal towards it), or 255"""
    best, bi = 1e9, 255
    n = len(r)
    if n > 254: return 255
    for i in range(n):
        (ax, az), (bx, bz) = r[i], r[(i + 1) % n]
        L = math.hypot(bx - ax, bz - az)
        if L < 1.5: continue
        nx, nz = (bz - az) / L, -(bx - ax) / L           # (outward for the counter-clockwise rings in x, z)
        mx, mz = (ax + bx) / 2 + nx * 2.0, (az + bz) / 2 + nz * 2.0
        dmin = 1e9
        for sx, sz, ex, ez, _ in roadgrid.near(mx, mz, 30):
            d, _t = seg_dist(mx, mz, sx, sz, ex, ez)
            if d < dmin: dmin = d
        score = dmin - 0.15 * L
        if dmin < 40 and score < best: best, bi = score, i
    return bi


def bake_buildings(buildings, roadgrid, lu_lookup, log, lidar=None, decks=()):
    out = []; nl = 0; towers = []; spires = []; pav = None
    for oid, t, polys in buildings:
        ring = polys[0][0]
        if len(ring) > 1 and ring[0] == ring[-1]: ring = ring[:-1]
        ring = dedupe(ring, 0.05)
        if len(ring) < 3: continue
        area = ring_area(ring)
        if area < 0: ring = ring[::-1]; area = -area          # counter-clockwise in (x, z) = clockwise seen from above
        if area < 7: continue
        cx = sum(p[0] for p in ring) / len(ring); cz = sum(p[1] for p in ring) / len(ring)
        if not in_town(cx, cz, -30): continue
        r = simplify_ring(ring, 0.25)
        if len(r) < 3 or abs(ring_area(r)) < 0.5 * area: r = ring
        if len(r) > 120: r = simplify_ring(ring, 1.0)
        if len(r) > 250: continue
        lu = lu_lookup(cx, cz)
        kind = building_kind(t, area, lu)
        ang, L, Wd = obb(r)
        # height: tags, else defaults by kind, with spatially coherent variation (a terrace shares its height)
        h = None
        try: h = float(t.get('height', '').replace('m', '').strip())
        except ValueError: pass
        lv = None
        try: lv = float(t.get('building:levels', ''))
        except ValueError: pass
        nz = vnoise(cx / 70.0, cz / 70.0, 7)
        if h is None:
            if lv is not None:
                h = lv * 3.0 + (0.6 if lv <= 3 else 0.0)
            else:
                levels = {0: 2, 1: 2, 2: 4, 3: 3, 4: 0, 5: 0, 6: 3, 7: 0, 8: 0, 9: 0, 10: 4, 11: 1}[kind]
                if kind in (0, 1):                       # Victorian/Edwardian centre: taller houses (3 storeys)
                    central = math.hypot((cx - 250) / 1300, (cz + 150) / 1000) < 1.0
                    if central and nz > 0.45: levels = 3
                    if area < 45: levels = 2
                if kind == 2 and nz > 0.6: levels = 5
                if kind == 3 and nz < 0.35: levels = 2
                h = {4: 13.0, 5: 7.0 + 3 * nz, 7: 2.6, 8: 11.0, 9: 5.0, 11: 3.0}.get(kind, levels * 3.0 + 0.3)
                if kind == 6: h = 9.0 + 4 * nz if area > 800 else 7.0
        h = max(2.4, min(63.0, h))
        # LIDAR: DSM - ground inside the footprint gives the eaves (lower part of the roof) and the ridge (top), and tells
        # a pitched roof from a flat one; on a pier the ground is the deck, not the beach under it
        rise = None
        if lidar is not None:
            dsm, dtm = lidar.footprint(r)
            deck = next((dy for dr, dy in decks if point_in_ring(dr, cx, cz)), None)
            if dsm is not None:
                g = np.full(dsm.shape, deck, np.float32) if deck is not None else dtm
                v = (dsm - g)[np.isfinite(dsm) & np.isfinite(g)]
                if v.size >= 6 and np.percentile(v, 95) > 1.6:
                    p10, p15, p50, p90, p95 = np.percentile(v, [10, 15, 50, 90, 95])
                    if area < 150 and p95 > 2.2 * p50 + 3: p95 = p90 = p50 + 2.5      # a tree over a small building
                    p95 = min(p95, 70.0); spread = p95 - p15
                    if kind in (8, 11):
                        h = float(p50 if kind == 8 else max(2.6, p50))
                    elif spread < 0.9 or Wd > 22:                                     # flat roof
                        h = float(max(2.4, p90)); rise = 0.0
                    else:
                        h = float(max(2.4, p15 + 0.3)); rise = float(min(12.0, spread))
                    nl += 1
            if kind == 4 and dsm is not None and area > 60:          # a church tower or spire: the tallest point well above the roof
                E, N = lidar.en([p[0] for p in r], [p[1] for p in r])
                e0, n1 = math.floor(min(E)), math.ceil(max(N)); w = int(math.ceil(max(E)) - e0) + 1; hh = int(n1 - math.floor(min(N))) + 1
                ee, nn = np.meshgrid(e0 + np.arange(w) + 0.5, n1 - np.arange(hh) - 0.5)
                top = (lidar.sample('dsm', ee.ravel(), nn.ravel()) - lidar.sample('dtm', ee.ravel(), nn.ravel())).reshape(hh, w)
                if np.isfinite(top).any():
                    jj, ii = np.unravel_index(np.nanargmax(top), top.shape); tmax = float(top[jj, ii])
                    vv = top[np.isfinite(top)]
                    if tmax > np.percentile(vv, 90) + 5 and tmax < 75:
                        # the tower itself: the cells standing 3 m above the nave's roof, joined to the highest one and
                        # within 9 m of it; its centre and width in the frame of the church's long axis
                        hi = np.isfinite(top) & (top > np.percentile(vv, 90) + 3.0)
                        seen = {(jj, ii)}; stk = [(jj, ii)]
                        while stk:
                            a0, b0 = stk.pop()
                            for a1, b1 in ((a0 + 1, b0), (a0 - 1, b0), (a0, b0 + 1), (a0, b0 - 1)):
                                if 0 <= a1 < hh and 0 <= b1 < w and hi[a1, b1] and (a1, b1) not in seen and (a1 - jj) ** 2 + (b1 - ii) ** 2 < 81:
                                    seen.add((a1, b1)); stk.append((a1, b1))
                        tj = np.array([p[0] for p in seen], dtype=np.float64); ti = np.array([p[1] for p in seen], dtype=np.float64)
                        inv = __import__('pyproj').Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
                        lon, lat = inv.transform(e0 + ti + 0.5, n1 - tj - 0.5); tx, tz = proj(np.asarray(lon), np.asarray(lat))
                        tang = ang % math.pi; tca, tsa = math.cos(tang), math.sin(tang)
                        tu = tx * tca + tz * tsa; tv = -tx * tsa + tz * tca
                        tw = float(min(8.0, max(3.5, max(tu.max() - tu.min(), tv.max() - tv.min()) + 1.0)))
                        uc, vc = float(tu.max() + tu.min()) / 2, float(tv.max() + tv.min()) / 2
                        spires.append((uc * tca - vc * tsa, uc * tsa + vc * tca, tmax, tw, tang))
                        if rise is not None:
                            # the nave's eaves and ridge again, without the tower's cells (they were lifting the ridge)
                            tset = {(e0 + b0 + db, n1 - a0 - 1 + da) for a0, b0 in seen for da in range(-2, 3) for db in range(-2, 3)}
                            fd, ft, fe, fn = lidar.footprint(r, coords=True)
                            if fd is not None:
                                keep = np.array([(int(math.floor(a1)), int(math.floor(b1))) not in tset for a1, b1 in zip(fe, fn)])
                                v2 = (fd - ft)[keep & np.isfinite(fd) & np.isfinite(ft)]
                                if v2.size >= 6:
                                    q15, q90, q95 = np.percentile(v2, [15, 90, 95])
                                    if rise == 0: h = float(max(2.4, q90))
                                    elif q95 - q15 >= 0.9: h = float(max(2.4, q15 + 0.3)); rise = float(min(12.0, q95 - q15))
                        log(f'  church ({cx:.0f},{cz:.0f}): eaves {h:.1f} m, ridge +{(rise or 0):.1f} m, tower {tmax:.1f} m, {tw:.1f} m wide')
            if kind == 8 and dsm is not None and deck is not None:
                # the pavilion: its roof as a grid of heights above the deck (in the frame of its long axis), and the
                # four corner towers as the slender peaks that stand above the roof around them
                ang, L8, W8 = obb(r); ca, sa = math.cos(ang), math.sin(ang)
                us = [x * ca + z * sa for x, z in r]; vs = [-x * sa + z * ca for x, z in r]
                u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs); GU, GV = 32, 14
                gu = np.linspace(u0, u1, GU); gv = np.linspace(v0, v1, GV); UU, VV = np.meshgrid(gu, gv)
                acc = np.zeros(UU.shape)
                for ou in (-1.2, 0, 1.2):
                    for ovv in (-1.2, 0, 1.2):
                        X = (UU + ou) * ca - (VV + ovv) * sa; Z = (UU + ou) * sa + (VV + ovv) * ca; E, N = lidar.en(X, Z)
                        acc += np.nan_to_num(lidar.sample('dsm', E, N), nan=deck)
                grid = np.clip((acc / 9 - deck) * 10, 0, 255).astype(np.uint8)
                pav = dict(u0=u0, u1=u1, v0=v0, v1=v1, ang=ang, gu=GU, gv=GV, grid=grid)
                E, N = lidar.en([p[0] for p in r], [p[1] for p in r])
                e0, n1 = math.floor(min(E)), math.ceil(max(N)); w = int(math.ceil(max(E)) - e0) + 1; hh = int(n1 - math.floor(min(N))) + 1
                ee, nn = np.meshgrid(e0 + np.arange(w) + 0.5, n1 - np.arange(hh) - 0.5)
                top = np.nan_to_num(lidar.sample('dsm', ee.ravel(), nn.ravel()).reshape(hh, w), nan=-99)
                cand = []
                for jj in range(4, hh - 4):
                    for ii in range(4, w - 4):
                        v = top[jj, ii]
                        if v < deck + 8 or v < top[jj - 4:jj + 5, ii - 4:ii + 5].max(): continue
                        ring_ = np.concatenate([top[jj - 9:jj + 10:18, max(0, ii - 9):ii + 10].ravel(), top[max(0, jj - 9):jj + 10, ii - 9:ii + 10:18].ravel()])
                        ring_ = ring_[ring_ > -50]
                        if ring_.size and v - np.median(ring_) > 1.2: cand.append((v - np.median(ring_), v, jj, ii))
                inv = __import__('pyproj').Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
                for pk, v, jj, ii in sorted(cand, reverse=True):
                    lon, lat = inv.transform(e0 + ii + 0.5, n1 - jj - 0.5); x, z = proj(lon, lat)
                    if all(math.hypot(x - tx, z - tz) > 20 for tx, tz, _, _ in towers): towers.append((x, z, float(v - deck), deck))
                    if len(towers) == 4: break
                log(f'pavilion: deck {deck:.1f} m, roof up to {grid.max() / 10:.1f} m above it, towers ' + ', '.join(f'({x:.0f},{z:.0f}) {th:.1f} m' for x, z, th, _ in towers))
        # roof
        shape = t.get('roof:shape', '')
        if shape in ('flat',): roof = 0
        elif shape in ('gabled', 'gambrel', 'saltbox', 'mansard'): roof = 1
        elif shape in ('hipped', 'half-hipped', 'pyramidal', 'dome', 'round', 'skillion'): roof = 2
        else:
            if kind in (0, 1, 10) and Wd < 13: roof = 1 if (kind == 1 or crc(str(oid)) % 3) else 2
            elif kind == 7: roof = 0 if Wd > 5.5 or crc(str(oid)) % 2 else 1
            elif kind in (2, 3, 6) and Wd < 11: roof = 1
            elif kind == 4: roof = 1
            elif kind == 9: roof = 3
            elif kind == 8: roof = 1
            else: roof = 0
        # ridge: along the street for houses and terraces (a terrace roof runs along the row), else the long axis
        ridge = ang
        if roof in (1, 2) and kind in (0, 1, 2, 3, 10):
            best = None
            for ax, az, bx, bz, _ in roadgrid.near(cx, cz, 40):
                d, _t = seg_dist(cx, cz, ax, az, bx, bz)
                if best is None or d < best[0]: best = (d, math.atan2(bz - az, bx - ax))
            if best and best[0] < 40:
                ra = best[1]
                da = abs(math.remainder(ra - ang, math.pi))
                ridge = ang if da < math.pi / 4 else ang + math.pi / 2
                # a detached house much longer than wide keeps its long axis
                if kind == 0 and L > 1.6 * Wd: ridge = ang
        ridge = math.remainder(ridge, math.pi)
        if ridge < 0: ridge += math.pi
        if rise is not None:                       # the LIDAR decides flat or pitched
            if rise < 0.05 and roof in (1, 2) and kind not in (4, 8): roof = 0
            elif rise >= 1.2 and roof == 0 and Wd < 22: roof = 1
        # the roof's shape, axis and heights from the LIDAR surface (where the survey sees it and OSM does not say), its
        # chimney stacks and dormers, and the side facing the street
        rf = None
        if lidar is not None and kind in (0, 1, 2, 3, 5, 6, 7, 10) and area < 4000 and deck is None:
            rf = roof_fit(r, ang, lidar)
            if rf is not None and not rf.get('sure'): rf = None
            if rf is not None:
                if not shape:
                    roof = rf['kind']; ridge = rf['ridge']
                h = float(max(2.4, min(63.0, rf['eaves'])))
                rise = 0.0 if rf['kind'] == ROOF_FLAT else float(max(0.3, min(12.0, rf['top'] - rf['eaves'])))
                if roof in (1, 2, 4) and rise < 0.3: roof = 0
        fe = front_edge(r, roadgrid)
        hc = crc(f'b{oid}')
        look = landmark_look(t)
        if look == 0 and kind in (0, 1) and math.hypot(cx - 1764, cz + 1891) < 330 and hc % 3: look = 4    # Kewstoke's old stone cottages
        if 'New Inn' in t.get('name', ''): look = 4
        out.append((cx, cz, r, kind, h, roof, ridge, hc, lu, rise, look, rf['chim'] if rf else [], rf['dorm'] if rf else [], fe))
    rk = collections.Counter(b[5] for b in out)
    log(f'roofs: {rk.get(0, 0)} flat, {rk.get(1, 0)} gabled, {rk.get(2, 0)} hipped, {rk.get(4, 0)} half-hipped, {rk.get(3, 0)} ruins; '
        f'{sum(len(b[11]) for b in out)} chimney stacks, {sum(len(b[12]) for b in out)} dormers, {sum(1 for b in out if b[13] != 255)} street fronts')
    log(f'buildings: {len(out)}, {nl} with LIDAR heights, {len(spires)} church towers: ' + ', '.join(f'({x:.0f},{z:.0f}) {th:.1f} m, {tw:.1f} m wide' for x, z, th, tw, _ in spires))
    return out, towers, spires, pav


# ---------------------------------------------------------------- encoding
class Blob:
    def __init__(self):
        self.parts, self.size, self.index = [], 0, {}

    def add(self, name, arr):
        arr = np.ascontiguousarray(arr)
        pad = (-self.size) % 4
        if pad: self.parts.append(b'\0' * pad); self.size += pad
        dt = {np.dtype('<i2'): 'i16', np.dtype('<u2'): 'u16', np.dtype('u1'): 'u8', np.dtype('<i4'): 'i32', np.dtype('<f4'): 'f32', np.dtype('i1'): 'i8'}[arr.dtype]
        self.index[name] = [dt, self.size, int(arr.size)]
        b = arr.tobytes(); self.parts.append(b); self.size += len(b)

    def bytes(self):
        return b''.join(self.parts)


def q(v):
    return int(round(v / QXY))


def enc_polys(polys):
    """list of point lists -> (counts u16, first points int32 absolute, int16 deltas for the rest); long edges are
    split so that every delta fits in int16"""
    cnt, st, d = [], [], []
    for pts in polys:
        n = 0; px = pz = None
        for k, (x, z) in enumerate(pts):
            X, Z = q(x), q(z)
            if k == 0:
                st += [X, Z]; n = 1
            else:
                m = max(1, int(math.ceil(max(abs(X - px), abs(Z - pz)) / 30000)))
                for i in range(1, m + 1):
                    nx, nz = px + (X - px) * i // m, pz + (Z - pz) * i // m
                    d += [nx - (px + (X - px) * (i - 1) // m), nz - (pz + (Z - pz) * (i - 1) // m)]; n += 1
            px, pz = X, Z
        cnt.append(n)
    a = np.asarray(d, dtype=np.int64); b = np.asarray(st, dtype=np.int64)
    assert a.size == 0 or (a.min() >= -32768 and a.max() < 32768)
    assert max(cnt) < 65536
    return np.asarray(cnt, '<u2'), b.astype('<i4'), a.astype('<i2')


def morton_key(x, z, cell=64.0):
    i = int((x - TOWN[0]) / cell); j = int((z - TOWN[1]) / cell)
    k = 0
    for b in range(10):
        k |= ((i >> b) & 1) << (2 * b) | ((j >> b) & 1) << (2 * b + 1)
    return k


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--dem-cache', required=True)
    ap.add_argument('--lidar-cache', help='Environment Agency 1 m LIDAR tiles (DTM, DSM); without it the terrain tiles alone are used')
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'fable', 'source', 'js', '12_wsm_data.js'))
    ap.add_argument('--preview')
    ap.add_argument('--osm-pickle', help='development: cache of the parsed extract (read if present, else written)')
    a = ap.parse_args()
    log = lambda s: print(s, flush=True)
    dem = Terrarium(a.dem_cache, a.fetch)
    lidar = Lidar(a.lidar_cache, a.fetch) if a.lidar_cache else None

    log('reading OSM...')
    if a.osm_pickle and os.path.exists(a.osm_pickle):
        import pickle
        with open(a.osm_pickle, 'rb') as f: roads, areas, buildings, trees, tree_rows, piers = pickle.load(f)
    else:
        roads, areas, buildings, trees, tree_rows, piers = read_osm(a.pbf)
        if a.osm_pickle:
            import pickle
            with open(a.osm_pickle, 'wb') as f: pickle.dump((roads, areas, buildings, trees, tree_rows, piers), f)
    log(f'roads {len(roads)}, areas {len(areas)}, buildings {len(buildings)}, trees {len(trees)}, tree rows {len(tree_rows)}, piers {len(piers)}')

    # ---- terrain
    log('terrain...')
    nw = int(round((TOWN[2] - TOWN[0]) / NEAR_RES)) + 1; nh = int(round((TOWN[3] - TOWN[1]) / NEAR_RES)) + 1
    Hn = grid_heights(dem, TOWN[0], TOWN[1], NEAR_RES, nw, nh, 15, True, lidar)
    fx0, fz0 = FAR_C[0] - FAR_HALF, FAR_C[1] - FAR_HALF; fw = int(2 * FAR_HALF / FAR_RES) + 1
    Hf = grid_heights(dem, fx0, fz0, FAR_RES, fw, fw, 12, False)
    log(f'near {Hn.shape} {Hn.min():.1f}..{Hn.max():.1f} m, far {Hf.shape} {Hf.min():.1f}..{Hf.max():.1f} m')

    # ---- land-use lookup for buildings (coarse raster of landuse=* by polygon, 8 m)
    LUR = 8.0; lw = int((TOWN[2] - TOWN[0]) / LUR) + 1; lh = int((TOWN[3] - TOWN[1]) / LUR) + 1
    lu_img = Image.new('L', (lw, lh), 0); from PIL import ImageDraw; dr = ImageDraw.Draw(lu_img)
    LU_CODE = {'residential': 1, 'retail': 2, 'commercial': 2, 'industrial': 3}
    for oid, c, t, polys in areas:
        code = LU_CODE.get(t.get('landuse'))
        if code:
            for ring, inners in polys:
                dr.polygon([((x - TOWN[0]) / LUR, (z - TOWN[1]) / LUR) for x, z in ring], fill=code)
    lu_arr = np.asarray(lu_img)
    LU_NAME = {0: None, 1: 'residential', 2: 'retail', 3: 'industrial'}
    def lu_lookup(x, z):
        i = int((x - TOWN[0]) / LUR); j = int((z - TOWN[1]) / LUR)
        return LU_NAME[int(lu_arr[j, i])] if 0 <= i < lw and 0 <= j < lh else None

    # ---- roads: clip, classify; segment grid for ridge directions
    rd = []
    roadgrid = SegGrid(40.0)
    for oid, t, pts, ids in roads:
        cls = road_class(t)
        steps = t.get('highway') == 'steps'            # (Monk's Steps up from Kewstoke church: a footway of stone steps)
        if steps: cls = 10
        if not cls: continue
        if t.get('area') == 'yes': continue
        w = road_width(t, cls)
        if steps: w = min(w, 1.5)
        toll = 'Toll' in (t.get('alt_name', '') + t.get('old_name', '') + t.get('loc_name', '')) and t.get('highway') == 'tertiary'
        if toll: w = 5.0
        for part in clip_polyline(pts, 0):
            part = dedupe(dp_simplify(part, 0.15), 0.1)
            if len(part) < 2: continue
            flags = (1 if t.get('bridge') == 'yes' else 0) | (2 if t.get('oneway') in ('yes', '1', '-1') else 0)
            if t.get('lane_markings') == 'no': flags |= 4
            if t.get('sidewalk') in ('no', 'none') or t.get('footway') == 'none': flags |= 32
            if toll: flags |= 64 | 128 | 32 | 4
            if steps: flags |= 16
            lanes = 0
            try: lanes = min(6, int(t.get('lanes', '0')))
            except ValueError: pass
            if cls <= 7:
                for (ax, az), (bx, bz) in zip(part, part[1:]): roadgrid.add(ax, az, bx, bz, cls)
            rd.append((part, cls, w, flags, lanes))
    for oid, t, pts in piers:                       # pier decks (Birnbeck Pier and its jetty)
        for part in clip_polyline(pts, 0):
            if len(part) >= 2:
                w = 4.6 if 'Birnbeck' in t.get('name', '') else 3.0
                rd.append((part, 12, w, 1, 0))
    log(f'road polylines: {len(rd)}')

    # ---- buildings
    # pier decks: their height from the DSM (the most common level over the deck outline: the deck, not the pavilion)
    decks = []
    if lidar is not None:
        for oid, c, t, polys in areas:
            if c != LC['pier']: continue
            ring = [p for p in polys[0][0]]
            if len(ring) > 1 and ring[0] == ring[-1]: ring = ring[:-1]
            dsm, dtm = lidar.footprint(ring, erode=True)
            v = dsm[np.isfinite(dsm)] if dsm is not None else np.zeros(0)
            if v.size > 20: decks.append((ring, float(np.percentile(v, 35)))); log(f'pier deck {t.get("name", oid)}: {decks[-1][1]:.2f} m')
    bl, towers, spires, pav = bake_buildings(buildings, roadgrid, lu_lookup, log, lidar, decks)
    if lidar is not None: bl += bake_caravans(areas, bl, lidar, lu_lookup, log)
    bgrid = SegGrid(24.0)
    for cx, cz, r, *_ in bl:
        for (ax, az), (bx, bz) in zip(r, r[1:] + r[:1]): bgrid.add(ax, az, bx, bz, 0)

    # ---- circuit
    Q, cedge, room, cways, cseq, clen = build_circuit(roads, [(r[0], r[1], r[2]) for r in rd], bgrid, log)

    # ---- land cover polygons (simplified), water levels from the terrain
    ac = []
    for oid, c, t, polys in areas:
        for ring, inners in polys:
            rings = []
            for k, rr in enumerate([ring] + inners):
                if len(rr) > 1 and rr[0] == rr[-1]: rr = rr[:-1]
                rr = simplify_ring(dedupe(rr, 0.1), 0.6 if c in (LC['mud'], LC['sand'], LC['wood'], LC['field']) else 0.3)
                if len(rr) < 3: continue
                # clip huge polygons to the coarse area (the tidal flats run for kilometres): clamp coordinates
                rr = [(min(max(x, TOWN[0] - 400), TOWN[2] + 400), min(max(z, TOWN[1] - 400), TOWN[3] + 400)) for x, z in rr]
                if abs(ring_area(rr)) < (4 if c != LC['water'] else 20): continue
                rings.append(rr)
            if not rings: continue
            lvl = 0.0
            if c == LC['scrub'] and t.get('natural') in ('heath', 'dune', 'grassland') and lidar is not None:
                cxr = sum(p[0] for p in rings[0]) / len(rings[0]); czr = sum(p[1] for p in rings[0]) / len(rings[0])
                E, N = lidar.en([cxr], [czr]); hz = lidar.sample('dtm', E, N)[0]
                near_beach = any(c2 == LC['sand'] and any(math.hypot(px - cxr, pz - czr) < 400 for px, pz in pp2[0][0][::4]) for _, c2, t2, pp2 in areas)
                if (t.get('natural') == 'dune' or (near_beach and np.isfinite(hz) and hz < 12)): c = LC['dune']
            if c == LC['pier']:                    # deck height (the ring was simplified: match by a point inside)
                for dr, dy in decks:
                    if point_in_ring(dr, sum(p[0] for p in rings[0]) / len(rings[0]), sum(p[1] for p in rings[0]) / len(rings[0])): lvl = dy
            if c == LC['water']:
                xs = np.array([p[0] for p in rings[0]]); zs = np.array([p[1] for p in rings[0]])
                # level: the terrain at the shore, lower quartile (the LIDAR sees the water surface)
                hs = dem.sample(xs, zs, 15)
                lvl = float(np.percentile(hs, 25)) - 0.4
            ac.append((c, rings, lvl))
    # painter's order: by class priority then id order (stable)
    ORDER = {1: 0, 3: 1, 2: 2, 12: 2, 13: 3, 11: 3, 5: 4, 4: 5, 9: 6, 7: 7, 6: 8, 14: 8, 10: 9, 8: 10}
    ac.sort(key=lambda a: ORDER.get(a[0], 5))
    log(f'land cover rings: {sum(len(a[1]) for a in ac)} in {len(ac)} polygons')

    # ---- trees: nodes and tree rows (every 9 m)
    tp = [(x, z) for _, x, z in trees]
    for _, pts in tree_rows:
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            L = math.hypot(bx - ax, bz - az); n = max(1, int(L / 9.0))
            for k in range(n):
                f = (k + 0.5) / n; x, z = ax + (bx - ax) * f, az + (bz - az) * f
                if in_town(x, z): tp.append((x, z))
    tp.sort(key=lambda p: morton_key(p[0], p[1], 32))
    log(f'trees: {len(tp)}')

    # ---- road heights from the LIDAR DTM at every vertex (median of a 3 x 3 m patch; -32768 where there is no survey)
    rd.sort(key=lambda r: morton_key(*r[0][0]))
    rhs = []
    if lidar is not None:
        allx = np.array([p[0] for r in rd for p in r[0]]); allz = np.array([p[1] for r in rd for p in r[0]]); acc = []
        for ox in (-1, 0, 1):
            for oz in (-1, 0, 1):
                E, N = lidar.en(allx + ox, allz + oz); acc.append(lidar.sample('dtm', E, N))
        with np.errstate(all='ignore'), __import__('warnings').catch_warnings():
            __import__('warnings').simplefilter('ignore', RuntimeWarning)   # all-NaN columns: roads off the survey
            med = np.nanmedian(np.stack(acc), axis=0) if len(allx) else np.zeros(0)
        rhs = [-32768 if not np.isfinite(v) else int(round(v * 10)) for v in med]
    # ---- tree crowns from the LIDAR: peaks of DSM - DTM above 4 m, away from buildings (their footprints and 1.5 m around)
    lt = []
    if lidar is not None:
        from PIL import ImageDraw
        tiles = sorted({k[1:] for k in lidar.tiles if k[0] == 'dsm' and lidar.tiles[k] is not None} | {k[1:] for k in lidar.tiles if k[0] == 'dtm' and lidar.tiles[k] is not None})
        inv = __import__('pyproj').Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
        bE = [lidar.en([p[0] for p in b[2]], [p[1] for p in b[2]]) for b in bl]
        for te, tn in tiles:
            tS, tG = lidar.tile('dsm', te, tn), lidar.tile('dtm', te, tn)
            if tS is None or tG is None: continue
            chm = np.nan_to_num(tS - tG, nan=0.0)
            m = Image.new('L', (1000, 1000), 0); dr2 = ImageDraw.Draw(m)
            for E, N in bE:
                if max(E) < te * 1000 - 2 or min(E) > te * 1000 + 1002 or max(N) < tn * 1000 - 2 or min(N) > tn * 1000 + 1002: continue
                dr2.polygon([(e - te * 1000, (tn + 1) * 1000 - n) for e, n in zip(E, N)], fill=255, outline=255)
            from PIL import ImageFilter
            blk = np.asarray(m.filter(ImageFilter.MaxFilter(5))) > 0
            chm[blk] = 0
            pad = np.pad(chm, 3, constant_values=0); mx = np.zeros_like(chm)
            for dj in range(7):
                for di in range(7):
                    if (dj - 3) ** 2 + (di - 3) ** 2 <= 10: np.maximum(mx, pad[dj:dj + 1000, di:di + 1000], out=mx)
            pk = (chm >= mx) & (chm > 4.0) & (chm < 40)
            jj, ii = np.nonzero(pk)
            if not len(ii): continue
            lon, lat = inv.transform(te * 1000 + ii + 0.5, (tn + 1) * 1000 - jj - 0.5); x, z = proj(np.asarray(lon), np.asarray(lat))
            for xx, zz, hh in zip(x, z, chm[jj, ii]):
                if in_town(xx, zz, -14): lt.append((float(xx), float(zz), float(hh)))
        lt.sort(key=lambda p: (morton_key(p[0], p[1], 32), p[0], p[1]))
        log(f'LIDAR tree crowns: {len(lt)}')

    # ---- encode
    blob = Blob()
    blob.add('near', predict_encode(Hn, NEAR_Q))
    blob.add('far', predict_encode(Hf, FAR_Q))
    blob.add('cxz', np.round(Q * 100).astype('<i4').ravel())            # circuit centre line, cm
    blob.add('cedge', np.clip(np.round(cedge * 10), 0, 255).astype('u1').ravel())
    blob.add('croom', np.clip(np.round(room * 10), 0, 255).astype('u1').ravel())
    # roads, in spatial order
    rd.sort(key=lambda r: morton_key(*r[0][0]))
    cnt, st, d = enc_polys([r[0] for r in rd])
    blob.add('rn', cnt); blob.add('r0', st); blob.add('rxz', d)
    # rinfo: class, width (dm), flags (1 bridge, 2 one way, 4 no lane markings, 16 steps, 32 no pavements, 64 white edge
    # lines, 128 the Toll Road), lanes
    blob.add('rinfo', np.asarray([[r[1], min(255, int(round(r[2] * 10))), r[3], r[4]] for r in rd], 'u1').ravel())
    if rhs: blob.add('rh', np.asarray(rhs, '<i2'))
    if lt:     # LIDAR tree crowns: absolute start (int32, 1/8 m) per crown would be big: int16 deltas in sorted order
        # (a new run wherever the next crown is too far for an int16 delta: no in-between points, one height per crown)
        chunks = [[]]
        for x, z, h in lt:
            c = chunks[-1]
            if c and (len(c) >= 60000 or max(abs(x - c[-1][0]), abs(z - c[-1][1])) > 3700): chunks.append([]); c = chunks[-1]
            c.append((x, z))
        cnt2, st2, d2 = enc_polys(chunks); assert int(cnt2.astype(np.int64).sum()) == len(lt)
        blob.add('ltn', cnt2); blob.add('lt0', st2); blob.add('ltd', d2); blob.add('lth', np.asarray([min(255, int(round(h * 4))) for x, z, h in lt], 'u1'))
    # buildings, in spatial order
    bl.sort(key=lambda b: (morton_key(b[0], b[1]), b[7]))
    cnt, st, d = enc_polys([b[2] for b in bl])
    blob.add('bn', cnt); blob.add('b0', st); blob.add('bxz', d)
    blob.add('binfo', np.asarray([[b[3], min(255, int(round(b[4] * 4))), b[5], int(round(b[6] / math.pi * 256)) % 256, b[7] & 255, (b[7] >> 8) & 255, {None: 0, 'residential': 1, 'retail': 2, 'industrial': 3}[b[8]] | (b[10] << 4), 255 if b[9] is None else min(250, int(round(b[9] * 10)))] for b in bl], 'u1').ravel())
    # per building: the edge facing the street; chimney stacks (x, z cm; building; top dm; size dm); dormers (x, z cm;
    # building; width dm; top dm; side of the ridge)
    blob.add('bfront', np.asarray([b[13] for b in bl], 'u1'))
    ch = [(x, z, bi_, tp, sz) for bi_, b in enumerate(bl) for x, z, tp, sz in b[11]]
    if ch:
        blob.add('chxz', np.asarray([[int(round(x * 100)), int(round(z * 100))] for x, z, _, _, _ in ch], '<i4').ravel())
        blob.add('chb', np.asarray([c[2] for c in ch], '<u2')); blob.add('chh', np.asarray([[min(255, int(round(c[3] * 10))), min(255, int(round(c[4] * 10)))] for c in ch], 'u1').ravel())
    dm = [(x, z, bi_, wd, tp, sd) for bi_, b in enumerate(bl) for x, z, wd, tp, sd in b[12]]
    if dm:
        blob.add('dmxz', np.asarray([[int(round(x * 100)), int(round(z * 100))] for x, z, _, _, _, _ in dm], '<i4').ravel())
        blob.add('dmb', np.asarray([d[2] for d in dm], '<u2')); blob.add('dmh', np.asarray([[min(255, int(round(d[3] * 10))), min(255, int(round(d[4] * 10))), 1 if d[5] > 0 else 0] for d in dm], 'u1').ravel())
    if pav is not None: blob.add('pavroof', pav['grid'].ravel())
    # spires: x, z (cm), top above the ground (dm), tower width (dm) + 65536 x the church's axis (degrees)
    blob.add('spires', np.asarray([[int(round(x * 100)), int(round(z * 100)), int(round(th * 10)), int(round(tw * 10)) + 65536 * (int(round(math.degrees(an))) % 180)] for x, z, th, tw, an in spires] or [[0, 0, 0, 0]], '<i4').ravel())
    blob.add('towers', np.asarray([[int(round(x * 100)), int(round(z * 100)), int(round(th * 10)), int(round(dy * 10))] for x, z, th, dy in towers] or [[0, 0, 0, 0]], '<i4').ravel())
    # land cover
    allr = [r for c, rings, lvl in ac for r in rings]
    cnt, st, d = enc_polys(allr)
    blob.add('an', cnt); blob.add('a0', st); blob.add('axz', d)
    blob.add('ainfo', np.asarray([[c, len(rings)] for c, rings, lvl in ac], 'u1').ravel())
    blob.add('alvl', np.asarray([int(round(lvl * 10)) for c, rings, lvl in ac], '<i2'))
    cnt, st, d = enc_polys([[p] for p in tp])
    blob.add('t0', st)
    raw = blob.bytes()
    comp = zlib.compress(raw, 9)
    meta = {
        'v': 1, 'origin': [ORIGIN_LAT, ORIGIN_LON], 'q': QXY, 'town': list(TOWN), 'sea': SEA_LEVEL,
        'near': {'x0': TOWN[0], 'z0': TOWN[1], 'res': NEAR_RES, 'w': nw, 'h': nh, 'q': NEAR_Q},
        'far': {'x0': fx0, 'z0': fz0, 'res': FAR_RES, 'w': fw, 'h': fw, 'q': FAR_Q},
        'circuit': {'n': int(len(Q)), 'length': round(float(clen), 1), 'streets': cseq},
        'counts': {'roads': len(rd), 'buildings': len(bl), 'areas': len(ac), 'trees': len(tp)},
        'arrays': blob.index,
        'pavilion': None if pav is None else {k: (round(float(v), 3) if k != 'grid' else None) for k, v in pav.items() if k != 'grid'},
        'credits': ['Map data © OpenStreetMap contributors (ODbL)',
                    'Contains Environment Agency information © Environment Agency and/or database right (LIDAR composite DTM and DSM, Open Government Licence v3.0)',
                    'Terrain: AWS Terrain Tiles (Mapzen/Tilezen) — United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved; SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey; ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration; Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers'],
    }
    b64 = base64.b64encode(comp).decode()
    js = ('// Weston-super-Mare map data, generated by tools/osm/bake_wsm.py from OpenStreetMap and AWS Terrain Tiles. Do not edit by hand.\n'
          '// Map data © OpenStreetMap contributors (ODbL). Terrain: see WSM_META.credits.\n'
          f'const WSM_META = {json.dumps(meta, separators=(",", ":"))};\n'
          f'const WSM_B64 = "{b64}";\n')
    with open(a.out, 'w') as f:
        f.write(js)
    sizes = {k: v[2] * {'i16': 2, 'u16': 2, 'u8': 1, 'i32': 4, 'f32': 4, 'i8': 1}[v[0]] for k, v in blob.index.items()}
    log(f'raw {len(raw)} B, zlib {len(comp)} B, js {len(js)} B -> {a.out}')
    log('raw sizes: ' + ', '.join(f'{k} {v}' for k, v in sizes.items()))
    if a.preview:
        preview(a.preview, Hn, Q, rd, bl, ac, tp)


def preview(path, Hn, Q, rd, bl, ac, tp):
    from PIL import ImageDraw
    R = 2.0
    W = int((TOWN[2] - TOWN[0]) / R); H = int((TOWN[3] - TOWN[1]) / R)
    hn = np.asarray(Image.fromarray(Hn.astype(np.float32)).resize((W, H)))
    base = np.clip(110 + hn * 1.5, 0, 255)
    sea = hn < SEA_LEVEL
    rgb = np.stack([base, base, base], -1); rgb[sea] = [40, 70, 120]
    im = Image.fromarray(rgb.astype(np.uint8)); d = ImageDraw.Draw(im, 'RGBA')
    T = lambda p: ((p[0] - TOWN[0]) / R, (p[1] - TOWN[1]) / R)
    COL = {1: (200, 190, 170, 60), 2: (90, 170, 70, 150), 3: (160, 190, 90, 120), 4: (20, 90, 30, 180), 5: (80, 120, 60, 150), 6: (235, 215, 150, 200),
           7: (120, 105, 80, 170), 8: (50, 100, 220, 220), 9: (150, 150, 150, 120), 10: (120, 80, 60, 255), 11: (110, 190, 90, 150), 12: (110, 150, 100, 150), 13: (70, 160, 60, 160)}
    for c, rings, lvl in ac:
        d.polygon([T(p) for p in rings[0]], fill=COL.get(c, (255, 0, 255, 100)))
    for part, cls, w, fl, ln in rd:
        d.line([T(p) for p in part], fill=(250, 250, 250, 255) if cls <= 8 else (230, 200, 200, 255), width=max(1, int(w / R)))
    for cx, cz, r, kind, h, roof, ridge, hc, lu, *_ in bl:
        d.polygon([T(p) for p in r], fill=(int(60 + h * 3), 50, 50, 255))
    pts = [T(p) for p in Q]
    d.line(pts + pts[:1], fill=(255, 0, 0, 255), width=3)
    for x, z in tp:
        px, pz = T((x, z)); d.ellipse([px - 2, pz - 2, px + 2, pz + 2], fill=(0, 120, 0, 255))
    im.save(path)


if __name__ == '__main__':
    main()
