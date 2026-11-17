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

Command (from the repository root):
  pip install osmium numpy pillow
  python3 tools/osm/bake_wsm.py --pbf somerset-latest.osm.pbf --dem-cache /tmp/wsm-dem --fetch \\
          --out fable/source/js/12_wsm_data.js [--preview /tmp/wsm.png]
  node fable/source/build.mjs            # rebuilds fable/index.html with the new data

Output: a JS file with WSM_META (JSON: layout, origin, credits) and WSM_B64 (base64 of a zlib stream holding typed
arrays: terrain grids, the circuit, roads, buildings, land cover, trees). Coordinates are metres in a local frame:
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
TOWN = (-1400.0, -1900.0, 2600.0, 3300.0)          # x0 z0 x1 z1: buildings, roads, land cover, fine terrain
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


def grid_heights(dem, x0, z0, res, w, h, zoom, blur):
    xs = x0 + np.arange(w) * res; zs = z0 + np.arange(h) * res
    XX, ZZ = np.meshgrid(xs, zs)
    H = np.zeros(XX.shape)
    for j0 in range(0, h, 256):                      # in strips (memory)
        H[j0:j0 + 256] = dem.sample(XX[j0:j0 + 256], ZZ[j0:j0 + 256], zoom)
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
LC = {'residential': 1, 'grass': 2, 'field': 3, 'wood': 4, 'scrub': 5, 'sand': 6, 'mud': 7, 'water': 8,
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
            if hw in DRIVE or hw in PAVED_PATH:
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


def bake_buildings(buildings, roadgrid, lu_lookup, log):
    out = []
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
        hc = crc(f'b{oid}')
        out.append((cx, cz, r, kind, h, roof, ridge, hc, lu))
    log(f'buildings: {len(out)}')
    return out


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
    """list of point lists -> (counts u16, first points int16 absolute, int16 deltas for the rest); long edges are
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
    assert b.min() >= -32768 and b.max() < 32768
    assert max(cnt) < 65536
    return np.asarray(cnt, '<u2'), b.astype('<i2'), a.astype('<i2')


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
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'fable', 'source', 'js', '12_wsm_data.js'))
    ap.add_argument('--preview')
    ap.add_argument('--osm-pickle', help='development: cache of the parsed extract (read if present, else written)')
    a = ap.parse_args()
    log = lambda s: print(s, flush=True)
    dem = Terrarium(a.dem_cache, a.fetch)

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
    Hn = grid_heights(dem, TOWN[0], TOWN[1], NEAR_RES, nw, nh, 15, True)
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
        if not cls: continue
        if t.get('highway') == 'steps' or t.get('area') == 'yes': continue
        w = road_width(t, cls)
        for part in clip_polyline(pts, 0):
            part = dedupe(dp_simplify(part, 0.15), 0.1)
            if len(part) < 2: continue
            flags = (1 if t.get('bridge') == 'yes' else 0) | (2 if t.get('oneway') in ('yes', '1', '-1') else 0)
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
    bl = bake_buildings(buildings, roadgrid, lu_lookup, log)
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
            if c == LC['water']:
                xs = np.array([p[0] for p in rings[0]]); zs = np.array([p[1] for p in rings[0]])
                # level: the terrain at the shore, lower quartile (the LIDAR sees the water surface)
                hs = dem.sample(xs, zs, 15)
                lvl = float(np.percentile(hs, 25)) - 0.4
            ac.append((c, rings, lvl))
    # painter's order: by class priority then id order (stable)
    ORDER = {1: 0, 3: 1, 2: 2, 12: 2, 13: 3, 11: 3, 5: 4, 4: 5, 9: 6, 7: 7, 6: 8, 10: 9, 8: 10}
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
    blob.add('rinfo', np.asarray([[r[1], min(255, int(round(r[2] * 10))), r[3], r[4]] for r in rd], 'u1').ravel())
    # buildings, in spatial order
    bl.sort(key=lambda b: (morton_key(b[0], b[1]), b[7]))
    cnt, st, d = enc_polys([b[2] for b in bl])
    blob.add('bn', cnt); blob.add('b0', st); blob.add('bxz', d)
    blob.add('binfo', np.asarray([[b[3], min(255, int(round(b[4] * 4))), b[5], int(round(b[6] / math.pi * 256)) % 256, b[7] & 255, (b[7] >> 8) & 255, {None: 0, 'residential': 1, 'retail': 2, 'industrial': 3}[b[8]], 0] for b in bl], 'u1').ravel())
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
        'credits': ['Map data © OpenStreetMap contributors (ODbL)',
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
    for cx, cz, r, kind, h, roof, ridge, hc, lu in bl:
        d.polygon([T(p) for p in r], fill=(int(60 + h * 3), 50, 50, 255))
    pts = [T(p) for p in Q]
    d.line(pts + pts[:1], fill=(255, 0, 0, 255), width=3)
    for x, z in tp:
        px, pz = T((x, z)); d.ellipse([px - 2, pz - 2, px + 2, pz + 2], fill=(0, 120, 0, 255))
    im.save(path)


if __name__ == '__main__':
    main()
