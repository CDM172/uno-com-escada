#!/usr/bin/env python3
"""Measures the real road edges of the Weston-super-Mare map (Weston, Kewstoke, Sand Bay) from the Environment Agency
1 m LIDAR (DTM + last-return DSM) and OpenStreetMap: kerb lines, carriageway widths, open edges (walls, banks, verges,
drops), kerb heights, pavements and their back edges, junction corner radii and roundabout islands. The result is data for
the map baker (tools/osm/bake_wsm.py): kerb lines per OSM way, keyed by way id.

How it measures (per drivable way, clipped to the survey region)
  * Transects across the way every 1 m along it (samples every 0.25 m, out to +-12..22 m by class), bilinear in the DTM
    and DSM. Local frame <-> British National Grid by cubic polynomials fitted once with pyproj (< 1 mm).
  * DSM - DTM between 0.35 and 3 m marks cars, walls, hedges, fences (the DTM is interpolated under them): those samples
    are left out; tree canopy (> 3 m) is kept (the DTM sees the ground under trees). OSM buildings are left out too.
  * Window medians of the transects (+-5 m along, every 2 m), each transect levelled on the centreline.
  * Kerbs: a model fit on every candidate face position (both sides): road cross-fall + step + pavement slope, convolved
    with the step response of the LIDAR sampling chain (1 m pixels = footprint means, random street orientation and
    pixel phase, bilinear at 0.25 m, median across transects; computed by simulation, table STEP_RESP below). The simulation
    reproduces the measured mean kerb profile of Weston's streets closely; with it the gutter minimum is 0.75 - 1.0 m
    inside the real kerb face and the fitted face position is unbiased. K (the fitted step) is the kerb height.
  * Other edges: departures from the road surface (a line fitted to the 2 m inside): banks / walls rising (S), drops (D),
    slope breaks of unkerbed lanes (O); the first persistent wall, hedge, fence (OSM barrier, or a narrow DSM band present
    in >= 70 % of the window) or building (H, W, V) bounds the search.
  * Per side a Viterbi track through the candidates (continuity, innermost edge preferred, gaps allowed), a second pass
    re-centred on the measured carriageway, then outlier rejection (running median), gap filling, 5 m output stations.
  * Pavement: from a kerb outward to the first building, wall/fence/hedge (OSM or DSM), level step (> 12 cm: gardens,
    banks), missing data or the class maximum. OSM sidewalk=* overrides; verge = OSM grass strip right behind the kerb.
  * Junctions (nodes where 3+ drivable way arms meet): every corner between adjacent arms gets the fillet that joins the
    two arms' kerb lines; its radius is fitted to the LIDAR (mean kerb step along the arc, best of 1.5 - 25 m) when a
    kerb is seen, else a class default (flagged). Roundabouts: ring centre, ring radius and central island radius (ring
    radius - the measured inner kerb offset); mini-roundabouts and crossing islands from OSM nodes.

Output (gzipped JSON, --out, default tools/osm/road_survey.json.gz):
  {"format": "road_survey", "version": 1, "created": ..., "region": [x0, z0, x1, z1],
   "frame": {...}, "sign": "...", "codes": {...}, "stats": {...},
   "ways": {"<osm way id>": [part, ...]},      # one part per run of the way inside the survey region (usually one)
   "junctions": [...], "roundabouts": [...], "mini_roundabouts": [...], "crossing_islands": [...]}
  Frame: the bake's local frame, metres, origin ORIGIN_LAT/ORIGIN_LON (Grand Pier entrance), x east, z SOUTH.
  part (all arrays have one value per station; stations every 5 m of chainage, plus the part's end):
    s        chainage (m) along the OSM way from its first node (unsimplified OSM geometry)
    x, z     centreline point (m, local frame);  hd  heading of the way at the station, degrees, atan2(dz, dx)
             (direction of travel = OSM node order). Right-hand normal n = (-sin hd, cos hd) (x east, z south: on a
             north-up map, the right side when driving along the way), the game's normal (-tz, tx).
    kl, kr   signed lateral offsets (m) of the left / right carriageway edge along n: point = (x, z) + k * n.
             kl is normally negative (left of the centreline), kr positive. Carriageway width = kr - kl, centre shift
             (kl + kr) / 2 (> 0: the carriageway lies right of the OSM line).
    ql, qr   confidence 0..1 of each edge value
    el, er   edge type per station (one character each):
             K raised kerb (step >= 5 cm)   k low kerb / lip (2.5 - 5 cm)   S step or bank up (> 25 cm: walls, sea wall,
             hedge banks)   D drop-off (> 25 cm down)   O open edge (slope break, no kerb: lanes, verges)
             H building front   W OSM wall / fence / hedge   V wall / hedge / fence seen in the DSM (the road runs up to it)
             u unknown (no measurement on this way: class default)
    cl, cr   source per station: L LIDAR measured   I interpolated between LIDAR values (gap <= 40 m)
             M median of the way's LIDAR values (long gap)   D class default (nothing measured)
    hl, hr   kerb height (m) where the edge is a kerb (K/k) and measured, else null (the fitted step, +-2 windows median)
    pl, pr   pavement width (m) from the kerb face outward, 0 = no pavement
    bl, br   pavement back edge: H building  W OSM wall/fence/hedge  V DSM wall/hedge/fence/parked row  T level step
             (garden wall base, bank)  N no data  E class maximum reached (open: square, car park, wide pavement)  - none
    psl, psr pavement source per station: L LIDAR  O OSM tag (sidewalk=*: no -> 0, yes -> default width when not seen)
    vl, vr   grass verge (m) between the kerb and the footway (OSM grass area right behind the kerb), 0 = none seen
    wmed     median carriageway width of the part (m);  hw, name: OSM tags;  in_town: inside bake_wsm.TOWN
  junction: {"node": osm node id, "x", "z", "arms": [{"way", "dir" (+1 the way leaves the node in node order, -1 it
             arrives), "hd" (heading of the arm away from the node, deg), "hw"}...] clockwise on the map,
             "corners": [{"arms": [i, j], "r": radius m, "src": "lidar"|"default", "score": kerb step (m) along the
             fitted arc, "p0": [x, z], "p1": [x, z] tangent points on arm i's / arm j's kerb line, "c": [x, z] arc centre,
             "kind": "K" kerb | "O" open}...], "mini_roundabout": bool, "signals": bool, "give_way": bool}
  roundabout: {"ways": [...], "x", "z" (centre), "r_ring" (mean radius of the OSM ring = middle of the circulatory
             carriageway), "r_island" (central island kerb radius), "src", "kind": "roundabout"|"circular"}
  mini_roundabout / crossing_islands: OSM nodes {"node", "x", "z", ...}
Load:   import gzip, json; S = json.load(gzip.open('tools/osm/road_survey.json.gz', 'rt')); S['ways']['<id>'][0]['kr']

Command (repository root; same inputs as bake_wsm.py):
  python3 tools/osm/road_survey.py --osm-pickle /path/osm.pkl --lidar-cache /path/wsm-lidar [--lidar-cache more]
          [--fetch] [--region town|kewstoke|x0,z0,x1,z1] [--out tools/osm/road_survey.json.gz]
  (--pbf somerset-latest.osm.pbf instead of --osm-pickle reads the extract with bake_wsm.read_osm.)
Needs numpy, pillow, pyproj (pyproj only for the frame fit). Data: OSM (c) OpenStreetMap contributors, ODbL 1.0;
EA LIDAR Composite DTM/DSM 1 m, Open Government Licence v3.0.
"""
import argparse, collections, gzip, json, math, os, pickle, sys, time, warnings

import numpy as np
from PIL import Image, ImageDraw
from numpy.lib.stride_tricks import sliding_window_view as _swv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import bake_wsm as BW                                   # the bake's frame and OSM reader (read only)
    ORIGIN_LAT, ORIGIN_LON, M_LAT, M_LON, TOWN = BW.ORIGIN_LAT, BW.ORIGIN_LON, BW.M_LAT, BW.M_LON, BW.TOWN
except Exception:                                           # (osmium missing: the same constants)
    BW = None
    ORIGIN_LAT, ORIGIN_LON = 51.3486, -2.9822
    _phi = math.radians(ORIGIN_LAT)
    M_LAT = 111132.954 - 559.822 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)
    M_LON = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)
    TOWN = (-1400.0, -5100.0, 2900.0, 3300.0)

REGIONS = {'town': (TOWN[0], TOWN[1], TOWN[2], TOWN[3]),
           'kewstoke': (300.0, -5150.0, 3700.0, -1250.0)}       # Kewstoke, Sand Bay, Worlebury, the Toll Road, Collum Lane

DRIVE = ('motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
         'tertiary_link', 'unclassified', 'residential', 'living_street', 'road', 'service')
YMAX = {'motorway': 22, 'trunk': 22, 'primary': 20, 'secondary': 18, 'tertiary': 16, 'unclassified': 15, 'residential': 15,
        'living_street': 12, 'road': 15, 'service': 12}
DEF_HALF = {'motorway': 5.5, 'trunk': 4.5, 'primary': 4.0, 'secondary': 3.7, 'tertiary': 3.4, 'unclassified': 2.9, 'residential': 3.0,
            'living_street': 2.6, 'road': 3.0, 'service': 1.8}
DEF_PAVE = {'motorway': 0.0, 'trunk': 2.5, 'primary': 2.4, 'secondary': 2.2, 'tertiary': 2.0, 'unclassified': 1.8, 'residential': 1.8,
            'living_street': 1.5, 'road': 1.8, 'service': 0.0}
MAX_PAVE = {'trunk': 6.0, 'primary': 7.0, 'secondary': 7.0, 'tertiary': 6.0, 'unclassified': 5.0, 'residential': 5.0, 'living_street': 4.0,
            'road': 5.0, 'service': 3.0, 'motorway': 3.0}
RANK = {'motorway': 1, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5, 'residential': 6, 'living_street': 7,
        'road': 6, 'service': 8}
OBJ_LO, OBJ_HI = 0.35, 3.0          # DSM - DTM band of cars, walls, hedges, fences, low vegetation (the DTM is interpolated there)
DY = 0.25                            # transect sample spacing (m)
WIN, STEP, OUT_STEP = 5.0, 2.0, 5.0  # window half length, window spacing, output station spacing (m)

# step response of the LIDAR sampling chain on u = -2..2 m at 0.05 (see the docstring)
STEP_RESP = np.array([
    0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0003, 0.0012, 0.0022, 0.0034, 0.0047, 0.0063, 0.0082,
    0.0108, 0.0142, 0.0181, 0.0231, 0.0289, 0.0359, 0.0440, 0.0531, 0.0639, 0.0766, 0.0900, 0.1047, 0.1215, 0.1395,
    0.1592, 0.1811, 0.2042, 0.2287, 0.2546, 0.2824, 0.3112, 0.3404, 0.3706, 0.4021, 0.4341, 0.4669, 0.5000, 0.5331,
    0.5659, 0.5979, 0.6294, 0.6596, 0.6888, 0.7176, 0.7454, 0.7713, 0.7958, 0.8189, 0.8408, 0.8605, 0.8785, 0.8953,
    0.9100, 0.9234, 0.9361, 0.9469, 0.9560, 0.9641, 0.9711, 0.9769, 0.9819, 0.9858, 0.9892, 0.9918, 0.9937, 0.9953,
    0.9966, 0.9978, 0.9988, 0.9997, 1.0000, 1.0000, 1.0000, 1.0000, 1.0000, 1.0000, 1.0000])
_SU = np.linspace(-2.0, 2.0, len(STEP_RESP))


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def nanmed(a, axis):
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return np.nanmedian(a, axis)


def hwb(hw):
    return hw.replace('_link', '') if hw else hw


def in_town(x, z):
    return TOWN[0] <= x <= TOWN[2] and TOWN[1] <= z <= TOWN[3]


# ---------------------------------------------------------------- frame and LIDAR
class Frame:
    """local (x east, z south) <-> British National Grid: cubic polynomials fitted once with pyproj (< 1 mm here)"""
    def __init__(self, box=(-2400.0, -6000.0, 4400.0, 4300.0)):
        import pyproj
        tr = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)
        gx, gz = np.meshgrid(np.linspace(box[0], box[2], 47), np.linspace(box[1], box[3], 47))
        gx = gx.ravel(); gz = gz.ravel()
        e, n = tr.transform(ORIGIN_LON + gx / M_LON, ORIGIN_LAT - gz / M_LAT); e = np.asarray(e); n = np.asarray(n)
        self.e0, self.n0 = float(e.mean()), float(n.mean())
        A = self._t(gx / 4000.0, gz / 4000.0)
        self.ce = np.linalg.lstsq(A, e - self.e0, rcond=None)[0]; self.cn = np.linalg.lstsq(A, n - self.n0, rcond=None)[0]
        B = self._t((e - self.e0) / 4000.0, (n - self.n0) / 4000.0)
        self.cx = np.linalg.lstsq(B, gx, rcond=None)[0]; self.cz = np.linalg.lstsq(B, gz, rcond=None)[0]

    @staticmethod
    def _t(u, v):
        return np.stack([u ** i * v ** j for i in range(4) for j in range(4 - i)], -1)

    def en(self, x, z):
        A = self._t(np.asarray(x, float) / 4000.0, np.asarray(z, float) / 4000.0)
        return A @ self.ce + self.e0, A @ self.cn + self.n0

    def xz(self, E, N):
        B = self._t((np.asarray(E, float) - self.e0) / 4000.0, (np.asarray(N, float) - self.n0) / 4000.0)
        return B @ self.cx, B @ self.cz


class Mosaic:
    """1 m DTM and DSM tiles (EPSG:27700, 1 km) in one array each, NaN where there is no survey"""
    def __init__(self, dirs, box, frame, fetch=False):
        E, N = frame.en([box[0], box[2], box[0], box[2]], [box[1], box[1], box[3], box[3]])
        self.te0, self.te1 = int((min(E) - 50) // 1000), int((max(E) + 50) // 1000)
        self.tn0, self.tn1 = int((min(N) - 50) // 1000), int((max(N) + 50) // 1000)
        self.E0, self.N1 = self.te0 * 1000, (self.tn1 + 1) * 1000
        Wd, Ht = (self.te1 - self.te0 + 1) * 1000, (self.tn1 - self.tn0 + 1) * 1000
        self.a, self.missing = {}, []
        fetcher = BW.Lidar(dirs[0], True) if (fetch and BW is not None) else None
        for kind in ('dtm', 'dsm'):
            A = np.full((Ht, Wd), np.nan, np.float32)
            for te in range(self.te0, self.te1 + 1):
                for tn in range(self.tn0, self.tn1 + 1):
                    t = None
                    for d in dirs:
                        f = os.path.join(d, f'{kind}_{te}_{tn}.tif')
                        if os.path.exists(f):
                            t = np.asarray(Image.open(f), dtype=np.float32).copy(); break
                    if t is None and fetcher is not None:
                        f = os.path.join(dirs[0], f'{kind}_{te}_{tn}.tif')
                        if os.path.exists(f + '.none'): os.remove(f + '.none')      # retry tiles a failed fetch marked as sea
                        t = fetcher.tile(kind, te, tn)
                    if t is None:
                        self.missing.append(f'{kind}_{te}_{tn}'); continue
                    t = t.copy(); t[~np.isfinite(t) | (t < -60) | (t > 600)] = np.nan
                    r0 = self.N1 - (tn + 1) * 1000; c0 = te * 1000 - self.E0
                    A[r0:r0 + 1000, c0:c0 + 1000] = t
            self.a[kind] = A

    def bil(self, kind, E, N):
        A = self.a[kind]
        fx = np.asarray(E, float) - self.E0 - 0.5; fy = self.N1 - np.asarray(N, float) - 0.5
        i = np.floor(fx).astype(np.int64); j = np.floor(fy).astype(np.int64)
        u = (fx - i).astype(np.float32); v = (fy - j).astype(np.float32)
        H, W = A.shape
        ok = (i >= 0) & (j >= 0) & (i < W - 1) & (j < H - 1)
        i = np.where(ok, i, 0); j = np.where(ok, j, 0)
        r = A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v
        return np.where(ok, r, np.nan).astype(np.float32)


class Lidar:
    def __init__(self, dirs, box, fetch=False):
        self.frame = Frame()
        self.mo = Mosaic(dirs, box, self.frame, fetch)

    def sample(self, kind, x, z):
        E, N = self.frame.en(x, z)
        return self.mo.bil(kind, E, N)


# ---------------------------------------------------------------- OSM rasters (0.5 m bit flags)
BLD, WALL, FENCE, HEDGE, GRASS = 1, 2, 4, 8, 16
GRASS_TAGS = {('landuse', 'grass'), ('landuse', 'village_green'), ('natural', 'grassland'), ('landuse', 'meadow'), ('leisure', 'park'),
              ('landuse', 'recreation_ground'), ('leisure', 'garden'), ('landuse', 'flowerbed'), ('natural', 'scrub'), ('landuse', 'cemetery'),
              ('leisure', 'common'), ('landuse', 'farmland'), ('natural', 'wood'), ('landuse', 'forest'), ('natural', 'heath')}
BAR_BIT = {'wall': WALL, 'retaining_wall': WALL, 'city_wall': WALL, 'fence': FENCE, 'railing': FENCE, 'handrail': FENCE, 'guard_rail': FENCE,
           'yes': FENCE, 'wire_fence': FENCE, 'chain': FENCE, 'gate': FENCE, 'hedge': HEDGE, 'hedge_bank': HEDGE}


class Masks:
    RES = 0.5

    def __init__(self, box, buildings, bars, areas):
        self.x0, self.z0 = box[0] - 50.0, box[1] - 50.0
        self.W = int((box[2] - box[0] + 100.0) / self.RES); self.H = int((box[3] - box[1] + 100.0) / self.RES)
        self.m = np.zeros((self.H, self.W), np.uint8)
        T = lambda pts: [((x - self.x0) / self.RES, (z - self.z0) / self.RES) for x, z in pts]

        def layer(fn, bit):
            im = Image.new('L', (self.W, self.H), 0); fn(ImageDraw.Draw(im))
            a = np.asarray(im); self.m[a > 0] |= bit

        def polys(d, items):
            for polys_ in items:
                for ring, inners in polys_:
                    if len(ring) >= 3: d.polygon(T(ring), fill=255)
                for ring, inners in polys_:
                    for inn in inners:
                        if len(inn) >= 3: d.polygon(T(inn), fill=0)
        layer(lambda d: polys(d, [p for _, _, p in buildings]), BLD)
        for bit in (WALL, FENCE, HEDGE):
            def br(d, bit=bit):
                for oid, t, pts in bars:
                    if BAR_BIT.get(t.get('barrier')) == bit and len(pts) >= 2: d.line(T(pts), fill=255, width=2)
            layer(br, bit)
        layer(lambda d: polys(d, [p for oid, cls, t, p in areas if any((k, t.get(k)) in GRASS_TAGS for k in ('landuse', 'natural', 'leisure'))]), GRASS)

    def look(self, X, Z):
        i = np.floor((np.asarray(X) - self.x0) / self.RES).astype(np.int64); j = np.floor((np.asarray(Z) - self.z0) / self.RES).astype(np.int64)
        ok = (i >= 0) & (j >= 0) & (i < self.W) & (j < self.H)
        out = np.zeros(np.shape(X), np.uint8); out[ok] = self.m[j[ok], i[ok]]
        return out


# ---------------------------------------------------------------- kerb model (vectorised)
def _step(u): return np.interp(u, _SU, STEP_RESP, left=0.0, right=1.0)


def _ramp_in(u):
    """(u [u<0]) convolved with the sampling kernel"""
    g = 1.0 - STEP_RESP; h = _SU[1] - _SU[0]
    I = np.concatenate([np.cumsum((g[1:] + g[:-1])[::-1] * 0.5 * h)[::-1], [0.0]])
    u = np.asarray(u, float)
    return np.where(u < _SU[0], u - _SU[0] - I[0], np.interp(u, _SU, -I, right=0.0))


def _ramp_out(u):
    g = STEP_RESP; h = _SU[1] - _SU[0]
    I = np.concatenate([[0.0], np.cumsum((g[1:] + g[:-1]) * 0.5 * h)])
    u = np.asarray(u, float)
    return np.where(u > _SU[-1], u - _SU[-1] + I[-1], np.interp(u, _SU, I, left=0.0))


HALFN = 9                     # fit window +-9 samples (+-2.25 m)
PHASES = (0.0, 0.125)
_BASIS = {}
for _ph in PHASES:
    _u = np.arange(-HALFN, HALFN + 1) * DY - _ph
    _BASIS[_ph] = (np.stack([np.ones_like(_u), _ramp_in(_u), _ramp_out(_u), _step(_u)], 1), _u)


def scan_profiles(M):
    """kerb model at every face position of every profile (outward = increasing index). returns per phase:
    (coef (n, nf, 4: a, c inner slope, p outer slope, K step), rms, count)"""
    w = np.isfinite(M).astype(np.float64); m = np.where(w > 0, M, 0.0).astype(np.float64)
    Wv = _swv(w, 2 * HALFN + 1, axis=1); Mv = _swv(m, 2 * HALFN + 1, axis=1)
    WM = Wv * Mv; out = {}
    for ph in PHASES:
        A, u = _BASIS[ph]
        AA = np.einsum('nfj,jp,jq->nfpq', Wv, A, A, optimize=True)
        Am = np.einsum('nfj,jp->nfp', WM, A, optimize=True)
        mm = (WM * Mv).sum(2)
        cnt = Wv.sum(2); nin = (Wv * (u < -0.4)).sum(2); nout = (Wv * (u > 0.4)).sum(2)
        ok = (cnt >= 10) & (nin >= 4) & (nout >= 4)
        coef = np.linalg.solve(AA + np.eye(4) * 1e-6, Am[..., None])[..., 0]
        rss = mm - 2 * (coef * Am).sum(-1) + np.einsum('nfp,nfpq,nfq->nf', coef, AA, coef, optimize=True)
        rms = np.sqrt(np.maximum(rss, 0) / np.maximum(cnt, 1))
        coef[~ok] = np.nan; rms[~ok] = np.nan
        out[ph] = (coef, rms, cnt)
    return out


# ---------------------------------------------------------------- geometry helpers
def way_len(p):
    P = np.asarray(p, float)
    return float(np.hypot(*(P[1:] - P[:-1]).T).sum()) if len(P) > 1 else 0.0


def clip_parts(pts, box):
    """runs of the polyline inside box, each with the chainage of its first point (m from the way's first node)"""
    out, cur, s, s0 = [], [], 0.0, 0.0
    for i, p in enumerate(pts):
        if i: s += math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
        if box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]:
            if not cur: s0 = s
            cur.append(p)
        else:
            if len(cur) >= 2: out.append((s0, cur))
            cur = []
    if len(cur) >= 2: out.append((s0, cur))
    return out


def resample(pts, step=1.0, chord=2.5):
    P = np.asarray(pts, float); seg = np.hypot(*(P[1:] - P[:-1]).T)
    P = P[np.concatenate([[True], seg > 1e-6])]; seg = np.hypot(*(P[1:] - P[:-1]).T)
    s = np.concatenate([[0], np.cumsum(seg)]); L = float(s[-1])
    n = max(2, int(L / step) + 1); ss = np.linspace(0, L, n)
    x = np.interp(ss, s, P[:, 0]); z = np.interp(ss, s, P[:, 1])
    a0 = np.clip(ss - chord, 0, L); a1 = np.clip(ss + chord, 0, L)
    d = np.stack([np.interp(a1, s, P[:, 0]) - np.interp(a0, s, P[:, 0]), np.interp(a1, s, P[:, 1]) - np.interp(a0, s, P[:, 1])], 1)
    d /= np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]
    return ss, x, z, d, L


def _runmed(v, k):
    out = np.full(len(v), np.nan)
    for i in range(len(v)):
        w = v[max(0, i - k):i + k + 1]; w = w[np.isfinite(w)]
        if len(w): out[i] = np.median(w)
    return out


# ---------------------------------------------------------------- per part survey
def flip(arr, offs, sg):
    return (arr, offs) if sg > 0 else (arr[..., ::-1], -offs[::-1])


class SegIndex:
    """grid index of drivable way segments (for parallel neighbours: dual carriageways, service roads alongside)"""
    def __init__(self, roads, cell=50.0):
        self.cell = cell; self.g = collections.defaultdict(list); segs = []
        for wid, t, p, ids in roads:
            if t.get('highway') not in DRIVE or t.get('area') == 'yes': continue
            for i in range(len(p) - 1):
                segs.append((p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], wid, ids[i], ids[i + 1]))
        self.S = np.array([s_[:4] for s_ in segs], float); self.W = np.array([s_[4] for s_ in segs], np.int64)
        self.N = np.array([s_[5:] for s_ in segs], np.int64)
        for k, (ax, az, bx, bz) in enumerate(self.S):
            for i in range(int(min(ax, bx) // cell), int(max(ax, bx) // cell) + 1):
                for j in range(int(min(az, bz) // cell), int(max(az, bz) // cell) + 1):
                    self.g[(i, j)].append(k)

    def near(self, x0, z0, x1, z1):
        c = self.cell; ks = set()
        for i in range(int(x0 // c), int(x1 // c) + 1):
            for j in range(int(z0 // c), int(z1 // c) + 1):
                ks.update(self.g.get((i, j), ()))
        return np.array(sorted(ks), np.int64)


def neighbour_limits(cx, cz, dx, dz, wid, nodes, segidx, Y):
    """per station: lateral distance to the nearest other drivable way that runs roughly parallel (< 35 deg) on the left
    and on the right (inf if none within Y). Ways sharing a node with this way are ignored within 30 m of that node."""
    n = len(cx); outL = np.full(n, np.inf); outR = np.full(n, np.inf)
    ks = segidx.near(cx.min() - Y, cz.min() - Y, cx.max() + Y, cz.max() + Y)
    if len(ks) == 0: return outL, outR
    ks = ks[segidx.W[ks] != wid]
    if len(ks) == 0: return outL, outR
    S = segidx.S[ks]; ax, az, bx, bz = S.T
    ex, ez = bx - ax, bz - az; el = np.hypot(ex, ez); ok = el > 0.1
    S, ks, ax, az, ex, ez, el = S[ok], ks[ok], ax[ok], az[ok], ex[ok], ez[ok], el[ok]
    nx, nz = -dz, dx                                       # right normals of the stations
    # c + t n = a + u e  ->  t n - u e = a - c
    det = nx[:, None] * (-ez[None, :]) - nz[:, None] * (-ex[None, :])
    rx = ax[None, :] - cx[:, None]; rz = az[None, :] - cz[:, None]
    with np.errstate(all='ignore'):
        t = (rx * (-ez[None, :]) - rz * (-ex[None, :])) / det
        u = (nx[:, None] * rz - nz[:, None] * rx) / det
    cosang = np.abs(dx[:, None] * ex[None, :] + dz[:, None] * ez[None, :]) / el[None, :]
    good = np.isfinite(t) & (u >= 0) & (u <= 1) & (cosang >= math.cos(math.radians(35))) & (np.abs(t) <= Y)
    # ignore ways connected to this one near the station (slip roads, forks, the far side of a junction)
    shared = segidx.N[ks]
    conn = np.isin(shared, list(nodes)).any(1) if nodes else np.zeros(len(ks), bool)
    if conn.any():
        node_xy = nodes                                    # dict id -> (x, z)
        for col in np.nonzero(conn)[0]:
            for nd in shared[col]:
                if nd in node_xy:
                    qx, qz = node_xy[nd]
                    good[np.hypot(cx - qx, cz - qz) < 30.0, col] = False
    tt = np.where(good, t, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        outR = np.nanmin(np.where(tt > 0, tt, np.nan), 1); outL = np.nanmin(np.where(tt < 0, -tt, np.nan), 1)
    return np.where(np.isfinite(outL), outL, np.inf), np.where(np.isfinite(outR), outR, np.inf)


class Part:
    def __init__(self, wid, tags, s0, pts, lidar, masks):
        self.wid, self.tags, self.s0, self.pts = wid, tags, s0, pts
        self.hw = hwb(tags.get('highway')); Y = YMAX.get(self.hw, 15)
        ss, x, z, d, L = resample(pts, 1.0)
        offs = np.arange(-Y, Y + 1e-6, DY)
        nx, nz = -d[:, 1], d[:, 0]
        X = x[:, None] + nx[:, None] * offs; Z = z[:, None] + nz[:, None] * offs
        dt = lidar.sample('dtm', X, Z); h = lidar.sample('dsm', X, Z) - dt
        fl = masks.look(X, Z)
        self.ss, self.x, self.z, self.d, self.L, self.offs, self.Y = ss, x, z, d, L, offs, Y
        self.ok = self._windows(dt, h, fl)
        self.nbr = (np.full(len(self.cen), np.inf), np.full(len(self.cen), np.inf)) if self.ok else None

    def set_neighbours(self, nodes, segidx):
        cx = np.interp(self.cen, self.ss, self.x); cz = np.interp(self.cen, self.ss, self.z)
        dx = np.interp(self.cen, self.ss, self.d[:, 0]); dz = np.interp(self.cen, self.ss, self.d[:, 1]); dn = np.hypot(dx, dz)
        self.nbr = neighbour_limits(cx, cz, dx / dn, dz / dn, self.wid, nodes, segidx, self.Y)

    def _windows(self, dt, h, fl):
        ss, offs = self.ss, self.offs
        obj = (h > OBJ_LO) & (h < OBJ_HI); bld = (fl & BLD) > 0; bar = (fl & (WALL | FENCE | HEDGE)) > 0; grs = (fl & GRASS) > 0
        clean = np.isfinite(dt) & ~obj & ~bld
        c0 = nanmed(np.where(clean & (np.abs(offs) <= 1.0), dt, np.nan), 1); good = np.isfinite(c0)
        if good.sum() < 2:
            c0 = nanmed(dt, 1); good = np.isfinite(c0)
            if good.sum() < 2: return False
        c0 = np.interp(ss, ss[good], c0[good])
        A = dt - c0[:, None]
        L = self.L
        cen = np.arange(min(1.0, L / 2), L - min(1.0, L / 2) + 1e-6, STEP) if L > 4 else np.array([L / 2])
        n, ny = len(cen), len(offs)
        f = {k: np.zeros((n, ny), np.float32) for k in ('med', 'raw', 'obj', 'bld', 'bar', 'grs', 'nan')}
        Ar = np.where(np.isfinite(dt) & ~bld, A, np.nan)
        f['cnt'] = np.zeros((n, ny), np.int16)
        Ac = np.where(clean, A, np.nan)
        for k, c in enumerate(cen):
            i0 = np.searchsorted(ss, c - WIN); i1 = np.searchsorted(ss, c + WIN, 'right')
            if i1 <= i0: i0, i1 = max(0, i0 - 1), min(len(ss), i0 + 1)
            B = Ac[i0:i1]
            f['med'][k] = nanmed(B, 0); f['cnt'][k] = np.isfinite(B).sum(0); f['raw'][k] = nanmed(Ar[i0:i1], 0)
            f['obj'][k] = obj[i0:i1].mean(0); f['bld'][k] = bld[i0:i1].mean(0); f['bar'][k] = bar[i0:i1].mean(0)
            f['grs'][k] = grs[i0:i1].mean(0); f['nan'][k] = (~np.isfinite(dt[i0:i1])).mean(0)
        # buildings within the transect on each side over +-25 m: none on a lane outside the village = no pavement there
        bl_side = np.stack([bld[:, offs < 0].any(1), bld[:, offs > 0].any(1)], 1).astype(float)
        self.bnear = np.zeros((n, 2), bool)
        for k, c in enumerate(cen):
            i0 = np.searchsorted(ss, c - 25.0); i1 = np.searchsorted(ss, c + 25.0, 'right')
            self.bnear[k] = bl_side[i0:max(i1, i0 + 1)].any(0)
        self.cen, self.win = cen, f
        return True

    # ---- candidates on one side
    def side_scan(self, sg):
        M, o = flip(self.win['med'], self.offs, sg)
        res = scan_profiles(M.astype(np.float64))
        parts = []
        for ph in PHASES:
            coef, rms, cnt = res[ph]
            fp = o[0] + (np.arange(M.shape[1] - 2 * HALFN) + HALFN) * DY + ph
            parts.append((fp, coef[..., 3], coef[..., 1], coef[..., 2], rms, cnt))
        fp = np.concatenate([p[0] for p in parts]); order = np.argsort(fp)
        return fp[order], [np.concatenate([p[i] for p in parts], 1)[:, order] for i in range(1, 6)], o

    def candidates(self, sg, inner):
        """per window: candidate edges (outward coordinate y >= inner[k])"""
        fp, (K, c, p, rms, cnt), o = self.side_scan(sg)
        n = len(self.cen); outer0 = self.Y - 2.5
        nb = self.nbr[0] if sg < 0 else self.nbr[1]
        # another carriageway alongside (dual carriageway, service road): the edge lies before its centreline
        nbl = np.where(np.isfinite(nb), np.maximum(nb - 2.2, nb * 0.5), np.inf)
        lims, outer = [], np.minimum(np.full(n, outer0), nbl)
        for k in range(n):
            bld, _ = flip(self.win['bld'][k], self.offs, sg); bar, _ = flip(self.win['bar'][k], self.offs, sg)
            obj, _ = flip(self.win['obj'][k], self.offs, sg)
            lim, lc = hard_limit(o, bld, bar, obj, inner[k])
            if lim is not None:
                # a hedge or a bush seen in the DSM overhangs the edge: look up to 1 m under it (the raw DTM sees the bank)
                outer[k] = min(outer[k], lim + (1.0 if lc == 'V' else 0.2))
            lims.append((lim, lc))
        med, _ = flip(self.win['med'], self.offs, sg); raw, _ = flip(self.win['raw'], self.offs, sg)
        prof_d = np.where(np.isfinite(raw), raw, med)          # banks under hedges and bracken; the DTM under parked cars is flat road
        dy, dt_, dd, ds_ = departures(prof_d, o, np.minimum(inner, 0.25), inner, outer)
        out = []
        for k in range(n):
            cl = window_candidates(k, fp, K, c, p, rms, cnt, med[k], o, inner[k], outer[k], (dy[k], dt_[k], dd[k], ds_[k]))
            big = [q['y'] for q in cl if q['t'] in 'SD' and abs(q['K']) >= 0.5]
            if big: cl = [q for q in cl if q['y'] <= min(big) + 0.3]           # nothing drivable beyond a wall or a drop
            lim, lc = lims[k]
            yb = None if lim is None else lim - (0.0 if lc == 'V' else 0.3)
            if yb is not None and yb >= inner[k] and yb <= outer[k] + 0.3:
                cl.append(dict(y=yb, t='B', K=0.0, c=0.0, p=0.0, T=0.0, lim=lc)); cl.sort(key=lambda q: q['y'])
            elif np.isfinite(nbl[k]) and nbl[k] >= inner[k] and nbl[k] < outer0 and not any(q['y'] <= nbl[k] + 0.1 for q in cl):
                cl.append(dict(y=float(nbl[k]), t='B', K=0.0, c=0.0, p=0.0, T=0.0, lim='N')); cl.sort(key=lambda q: q['y'])
            out.append(cl)
        return out, lims

    def track(self):
        y0 = DEF_HALF.get(self.hw, 3.0)
        inner1 = 0.6 if self.hw in ('service', 'unclassified', 'living_street') else 0.8
        res = {}
        for sg, key in ((-1, 'l'), (1, 'r')):
            cands, lims = self.candidates(sg, np.full(len(self.cen), inner1))
            res[key] = viterbi(cands, y0)
        # second pass: re-centred on the measured carriageway (narrow lanes, OSM lines off centre)
        yl = np.array([c['y'] if c else np.nan for c in res['l']]); yr = np.array([c['y'] if c else np.nan for c in res['r']])
        both = np.isfinite(yl) & np.isfinite(yr)
        if both.sum() >= 3:
            cmid = np.full(len(self.cen), np.nan); cmid[both] = (yr[both] - yl[both]) / 2.0
            cm = _runmed(cmid, 12); g = np.isfinite(cm)
            cm = np.interp(self.cen, self.cen[g], cm[g])
            if np.nanmax(np.abs(cm)) > 0.35:
                half_in = 0.9
                for sg, key in ((-1, 'l'), (1, 'r')):
                    inner = np.maximum(sg * cm + half_in, -2.0)          # outward coordinate of centre +- 0.9 m
                    cands, lims = self.candidates(sg, inner)
                    res[key] = viterbi(cands, y0 + sg * np.nanmedian(cm))
        self.tr = res

    # ---- output
    def side_values(self, key, sg):
        tr = self.tr[key]; n = len(tr); cen = self.cen
        y = np.array([c['y'] if c else np.nan for c in tr])
        sm = _runmed(y, 3); y[np.isfinite(y) & (np.abs(y - sm) > 0.6)] = np.nan
        conf = np.zeros(n); src = np.array(['L'] * n, dtype='<U1'); typ = np.array(['u'] * n, dtype='<U1'); K = np.full(n, np.nan)
        for k in range(n):
            if not np.isfinite(y[k]): continue
            c = tr[k]; t = c['t']
            if t == 'K': typ[k] = 'K' if c['K'] >= 0.05 else 'k'; conf[k] = float(np.clip(c['T'] / 40.0, 0.35, 1.0)); K[k] = c['K']
            elif t == 'B': typ[k] = c.get('lim', 'V'); conf[k] = 0.55 if typ[k] != 'N' else 0.3
            elif t in 'SD': typ[k] = t; conf[k] = 0.8
            else: typ[k] = 'O'; conf[k] = float(np.clip(0.3 + abs(c['K']) * 2, 0.3, 0.7))
        meas = np.isfinite(y)
        if meas.sum() >= 2:
            yi = np.interp(cen, cen[meas], y[meas]); idx = np.nonzero(meas)[0]
            for k in np.nonzero(~meas)[0]:
                a = idx[idx < k]; b = idx[idx > k]
                near = a[-1] if len(a) and (not len(b) or k - a[-1] <= b[0] - k) else b[0]
                typ[k] = typ[near]
                if len(a) and len(b) and cen[b[0]] - cen[a[-1]] <= 40:
                    y[k] = yi[k]; src[k] = 'I'; conf[k] = 0.3
                elif meas.mean() >= 0.3:
                    y[k] = np.median(y[meas]); src[k] = 'M'; conf[k] = 0.2
                else:
                    y[k] = yi[k] if (len(a) and len(b)) else y[near]; src[k] = 'M'; conf[k] = 0.15
        elif meas.sum() == 1:
            typ[:] = typ[meas][0]; y[~meas] = y[meas][0]; src[~meas] = 'M'; conf[~meas] = 0.15
        else:
            y[:] = DEF_HALF.get(self.hw, 3.0); src[:] = 'D'; conf[:] = 0.1
        return y, typ, _runmed(np.where(np.isin(typ, ['K', 'k']), K, np.nan), 2), conf, src

    def pavements(self, sg, y, typ):
        maxw = MAX_PAVE.get(self.hw, 5.0)
        n = len(y); pw = np.full(n, np.nan); bc = np.array(['-'] * n, dtype='<U1'); vw = np.zeros(n); ps = np.array(['L'] * n, dtype='<U1')
        rural = self.hw in ('unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'service', 'road')
        for k in range(n):
            if typ[k] not in ('K', 'k'): continue
            if rural and not self.bnear[k, 0 if sg < 0 else 1]: continue      # (lanes between fields: verges, no pavement)
            if typ[k] == 'k' and rural: continue
            prof, o = flip(self.win['med'][k], self.offs, sg)
            g = {nm: flip(self.win[nm][k], self.offs, sg)[0] for nm in ('bld', 'bar', 'obj', 'grs', 'nan')}
            pw[k], bc[k] = pavement_scan(prof, o, y[k], g, maxw)
            if bc[k] in 'EN' and pw[k] > DEF_PAVE.get(self.hw, 1.8):
                pw[k] = DEF_PAVE.get(self.hw, 1.8); ps[k] = 'D'           # (no back edge seen: front gardens, squares, car parks)
            j0 = np.searchsorted(o, y[k] + 0.2); j1 = np.searchsorted(o, y[k] + pw[k])
            gg = g['grs'][j0:j1] >= 0.5
            if len(gg) >= 3 and gg[:3].all():
                v = 0
                while v < len(gg) and gg[v]: v += 1
                vw[k] = v * DY
        pw = _runmed(pw, 2)
        return np.where(np.isfinite(pw), pw, 0.0), bc, vw, ps

    def record(self):
        swL, swR = osm_sidewalk(self.tags)
        so = np.arange(0.0, self.L + 1e-6, OUT_STEP)
        if so[-1] < self.L - 1.0: so = np.append(so, self.L)
        cen = self.cen
        ki = np.clip(np.searchsorted(cen, so), 0, len(cen) - 1); k0 = np.clip(ki - 1, 0, len(cen) - 1)
        ki = np.where(np.abs(cen[k0] - so) < np.abs(cen[ki] - so), k0, ki)
        xs = np.interp(so, self.ss, self.x); zs = np.interp(so, self.ss, self.z)
        hd = np.degrees(np.arctan2(np.interp(so, self.ss, self.d[:, 1]), np.interp(so, self.ss, self.d[:, 0])))
        rec = {'hw': self.tags.get('highway'), 'name': self.tags.get('name'), 'in_town': bool(in_town(*self.pts[len(self.pts) // 2])),
               's': r2(so + self.s0, 0.1), 'x': r2(xs, 0.01), 'z': r2(zs, 0.01), 'hd': r2(hd, 0.1)}
        self.side = {}
        for key, sg, swt in (('l', -1, swL), ('r', 1, swR)):
            y, typ, Kh, conf, src = self.side_values(key, sg)
            pw, bc, vw, ps = self.pavements(sg, y, typ)
            self.side[key] = (y, typ, conf, src, pw)
            y, typ, Kh, conf, src, pw, bc, vw, ps = (a[ki] for a in (y, typ, Kh, conf, src, pw, bc, vw, ps))
            pw = pw.copy(); bc = bc.copy(); ps = ps.copy()
            if swt is False:
                pw[:] = 0.0; bc[:] = '-'; ps[:] = 'O'
            elif swt is True or swt == 'sep':
                miss = pw < 0.5; pw[miss] = DEF_PAVE.get(self.hw, 1.8) if swt is True else pw[miss]; ps[miss] = 'O'
            rec['k' + key] = r2(sg * y); rec['q' + key] = r2(conf, 0.01); rec['e' + key] = ''.join(typ); rec['c' + key] = ''.join(src)
            rec['h' + key] = r2(Kh, 0.01); rec['p' + key] = r2(pw); rec['b' + key] = ''.join(bc); rec['ps' + key] = ''.join(ps)
            rec['v' + key] = r2(vw)
        wv = np.array(rec['kr'], float) - np.array(rec['kl'], float)
        rec['wmed'] = round(float(np.median(wv)), 2)
        return rec

    def kerb_at(self, s_local, side_key):
        """offset (signed y) and edge type of one side at a chainage within this part (for junction corners)"""
        y, typ, conf, src, pw = self.side[side_key]
        k = int(np.clip(np.searchsorted(self.cen, s_local), 0, len(self.cen) - 1))
        sg = -1 if side_key == 'l' else 1
        return sg * y[k], typ[k], conf[k], src[k]


def hard_limit(o, bld, bar, obj, inner):
    for j in np.nonzero(o >= inner)[0]:
        if bld[j] >= 0.5: return o[j], 'H'
        if bar[j] >= 0.45: return o[j], 'W'
        if obj[j] >= 0.7:
            jj, w = j, 0
            while jj < len(o) and obj[jj] >= 0.6: w += 1; jj += 1
            if w * DY <= 1.25: return o[j], 'V'
    return None, None


def window_candidates(k, fp, K, c, p, rms, cnt, prof, o, inner, outer, dep=None):
    cl = []
    Kk, ck, pk, rk, nk = K[k], c[k], p[k], rms[k], cnt[k]
    T = Kk / np.maximum(rk, 0.002) * np.sqrt(np.maximum(nk, 1)) / 4.0
    ok = np.isfinite(T) & (fp >= inner) & (fp <= outer)
    n = len(T); fin = np.isfinite(prof)

    def lev(a, b):
        sel = fin & (o >= a) & (o <= b)
        return np.median(prof[sel]) if sel.sum() >= 2 else np.nan
    for i in np.nonzero(ok)[0]:
        l = T[i - 1] if i > 0 and np.isfinite(T[i - 1]) else -1e9; r = T[i + 1] if i + 1 < n and np.isfinite(T[i + 1]) else -1e9
        if T[i] >= l and T[i] >= r and 0.025 <= Kk[i] <= 0.32 and abs(pk[i]) < 0.25 and abs(ck[i]) < 0.25 and T[i] >= 4.0:
            dl = lev(fp[i] + 0.6, fp[i] + 1.4) - lev(fp[i] - 1.4, fp[i] - 0.6)
            if np.isfinite(dl) and 0.015 <= dl <= 0.4:
                cl.append(dict(y=float(fp[i]), t='K', K=float(Kk[i]), c=float(ck[i]), p=float(pk[i]), T=float(T[i])))
    if dep is not None and np.isfinite(dep[0]):
        y, t, dv, sl = dep
        cl.append(dict(y=float(y), t=t, K=float(dv), c=float(sl), p=0.0, T=min(abs(dv), 1.0) * 60.0))
    cl.sort(key=lambda q: q['y'])
    if len(cl) > 10:
        keep = sorted(range(len(cl)), key=lambda i: -cl[i]['T'])[:10]; cl = [cl[i] for i in sorted(keep)]
    return cl


def departures(P, o, start, inner, outer):
    """first departure from the road surface per profile (rows of P, outward along o): a line fitted to the 2 m inside
    (9 samples), median deviations of the samples 0-0.75 m, 0.75-1.5 m and 1.5-2.5 m beyond. Departures of 25 cm and
    more count from 'start' (near the centreline), smaller ones (slope breaks) from 'inner'.
    returns per row: (outward position or NaN, type, deviation, slope)"""
    n, ny = P.shape
    fin = np.isfinite(P); Pz = np.where(fin, P, 0.0)
    pad = 8
    Wp = np.concatenate([np.zeros((n, pad)), fin.astype(float)], 1); Zp = np.concatenate([np.zeros((n, pad)), Pz], 1)
    Wv = _swv(Wp, 9, axis=1)[:, :ny]; Zv = _swv(Zp, 9, axis=1)[:, :ny]          # window ending at sample j
    u = (np.arange(9) - 8) * DY
    sw = Wv.sum(2); su = (Wv * u).sum(2); suu = (Wv * u * u).sum(2); sz = (Wv * Zv).sum(2); suz = (Wv * u * Zv).sum(2)
    den = sw * suu - su * su
    with np.errstate(all='ignore'):
        sl = np.where(den > 1e-9, (sw * suz - su * sz) / den, np.nan); b0 = (sz - sl * su) / np.maximum(sw, 1)
    # forward residuals m = 1..10 samples beyond j
    Pf = np.concatenate([np.where(fin, P, np.nan), np.full((n, 10), np.nan)], 1)
    Fv = _swv(Pf[:, 1:], 10, axis=1)[:, :ny]
    m = np.arange(1, 11) * DY
    R = Fv - (b0[..., None] + sl[..., None] * m)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        d1 = np.nanmedian(R[..., 0:3], 2); d2 = np.nanmedian(R[..., 3:6], 2); d3 = np.nanmedian(R[..., 6:10], 2)
    d3v = np.where(np.isfinite(d3), d3, d2)
    ok = (sw >= 6) & (np.abs(sl) <= 0.15) & np.isfinite(d1) & np.isfinite(d2) & fin
    ok &= (np.abs(d1) < 0.03) & (np.abs(d2) >= 0.07) & (np.abs(d3v) >= np.abs(d2) - 0.02) & (np.sign(d2) == np.sign(d3v))
    big = np.abs(d3v) >= 0.25
    oo = o[None, :]
    ok &= (oo <= outer[:, None]) & (((oo >= start[:, None]) & big) | (oo >= inner[:, None]))
    out_y = np.full(n, np.nan); out_t = np.array([''] * n, dtype='<U1'); out_d = np.full(n, np.nan); out_s = np.full(n, np.nan)
    has = ok.any(1); j = np.argmax(ok, 1)
    for k in np.nonzero(has)[0]:
        jj = j[k]; dv = d3v[k, jj]
        out_y[k] = o[jj] + 0.4; out_d[k] = dv; out_s[k] = sl[k, jj]
        out_t[k] = 'S' if (d2[k, jj] > 0 and abs(dv) >= 0.25) else 'D' if (d2[k, jj] < 0 and abs(dv) >= 0.25) else 'O'
    return out_y, out_t, out_d, out_s


def emission(c, n_inner):
    t = c['t']
    if t == 'K': s = math.sqrt(min(c['T'], 80.0)) + (1.0 if 0.05 <= c['K'] <= 0.22 else (-1.0 if c['K'] < 0.035 else 0.0))
    elif t == 'S': s = 4.5 + min(c['K'], 1.0)
    elif t == 'D': s = 4.0
    elif t == 'O': s = 2.2 + min(abs(c['K']), 0.25) * 8
    else: s = 3.2
    return s - 1.5 * n_inner


def viterbi(cands, y0, null_e=2.6, jump=7.0, sig=0.3, nullsw=2.0, prior_sd=3.5):
    n = len(cands)
    if n == 0: return []
    E, Ys = [], []
    for cl in cands:
        e = []
        for j, c in enumerate(cl):
            inner = sum(1 for c2 in cl[:j] if c2['y'] < c['y'] - 0.6 and ((c2['t'] == 'K' and c2['T'] >= 12 and c2['K'] >= 0.05) or c2['t'] in 'SD'))
            e.append(emission(c, inner) - 0.5 * ((c['y'] - y0) / prior_sd) ** 2)
        E.append(np.array(e + [null_e])); Ys.append(np.array([c['y'] for c in cl] + [np.nan]))
    score = E[0].copy(); back = []
    for k in range(1, n):
        yp, yc = Ys[k - 1], Ys[k]
        tr = -np.minimum(0.5 * ((yc[:, None] - yp[None, :]) / sig) ** 2, jump)
        pn = np.isnan(yp)[None, :]; cn = np.isnan(yc)[:, None]
        tr = np.where(pn & cn, 0.0, np.where(pn | cn, -nullsw, tr))
        t = score[None, :] + tr; b = np.argmax(t, 1)
        score = t[np.arange(len(yc)), b] + E[k]; back.append(b)
    j = int(np.argmax(score)); path = [j]
    for k in range(n - 2, -1, -1):
        j = int(back[k][j]); path.append(j)
    path = path[::-1]
    return [None if np.isnan(Ys[k][j]) else cands[k][j] for k, j in enumerate(path)]


def pavement_scan(prof, o, yk, g, maxw):
    """from a kerb face at outward yk: (pavement width, back edge code)"""
    j0 = np.searchsorted(o, yk + 0.35); base = None
    for j in range(j0, len(o)):
        u = o[j] - yk
        if u > maxw: return maxw, 'E'
        if g['bld'][j] >= 0.5: return u, 'H'
        if g['bar'][j] >= 0.45: return u, 'W'
        if g['obj'][j] >= 0.6: return u, 'V'
        if g['nan'][j] > 0.5: return u, 'N'
        v = prof[j]
        if not np.isfinite(v): continue
        if base is None: base, jb = v, j; continue
        if abs(v - base) > 0.12 + 0.03 * (o[j] - o[jb]): return max(u - 0.4, 0.0), 'T'
    return min(maxw, o[-1] - yk), 'E'


def osm_sidewalk(tags):
    """True / False / 'sep' / None (not tagged) for the left and right side"""
    sw = tags.get('sidewalk', tags.get('sidewalk:both'))
    L = R = None
    if sw in ('no', 'none'): L = R = False
    elif sw == 'both': L = R = True
    elif sw == 'left': L, R = True, False
    elif sw == 'right': L, R = False, True
    elif sw == 'separate': L = R = 'sep'
    for k, side in (('sidewalk:left', 'L'), ('sidewalk:right', 'R')):
        v = tags.get(k)
        if v is None: continue
        val = False if v in ('no', 'none') else 'sep' if v == 'separate' else True
        if side == 'L': L = val
        else: R = val
    return L, R


def r2(v, q=0.05):
    return [None if (a is None or not np.isfinite(a)) else round(round(float(a) / q) * q, 2) for a in v]


# ---------------------------------------------------------------- selection
def select_ways(roads, box):
    sel = []
    for wid, t, p, ids in roads:
        hw = t.get('highway')
        if hw not in DRIVE or t.get('area') == 'yes' or t.get('tunnel') in ('yes', 'building_passage', 'culvert'):
            continue
        if hw == 'service':
            L = way_len(p)
            if t.get('service') in (None, 'alley'):
                if L < 15: continue
            elif L < 40: continue
        for s0, part in clip_parts(p, box):
            sel.append((wid, t, s0, part))
    return sel


# ---------------------------------------------------------------- junctions and roundabouts
def arm_heading(pts, i, dirn, dist=8.0):
    """heading (rad) of the way leaving node index i in direction dirn (+1 / -1), over ~dist m"""
    P = np.asarray(pts, float); acc = 0.0; j = i
    while 0 <= j + dirn < len(P) and acc < dist:
        acc += math.hypot(*(P[j + dirn] - P[j])); j += dirn
    if j == i: return None
    v = P[j] - P[i]
    return math.atan2(v[1], v[0])


def junctions(roads, parts_by_way, lidar, furn, box):
    """corner fillets at the nodes where 3+ drivable arms meet"""
    use = collections.defaultdict(list)            # node -> [(way, index)]
    info = {}
    for wid, t, p, ids in roads:
        if wid not in parts_by_way: continue
        info[wid] = (t, p, ids)
        for i, nd in enumerate(ids):
            use[nd].append((wid, i))
    fnode = collections.defaultdict(set)
    for fid, x, z, code, sub, tags in furn:
        hwv = tags.get('highway')
        if hwv in ('mini_roundabout', 'traffic_signals', 'give_way', 'stop'): fnode[fid].add(hwv)
    out = []
    for nd, lst in use.items():
        arms = []
        for wid, i in lst:
            t, p, ids = info[wid]
            for dirn in (1, -1):
                if 0 <= i + dirn < len(ids):
                    a = arm_heading(p, i, dirn)
                    if a is not None: arms.append(dict(way=wid, i=i, dir=dirn, a=a, hw=t.get('highway')))
        if len(arms) < 3: continue
        for a in arms: a['dnext'] = arm_free_length(a, info, use)
        t, p, ids = info[lst[0][0]]; x, z = p[lst[0][1]]
        if not (box[0] <= x <= box[2] and box[1] <= z <= box[3]): continue
        if any(info[w][0].get('junction') in ('roundabout', 'circular') for w, _ in lst) and len(arms) <= 4:
            pass                                       # (ring entries: corners are still useful)
        arms.sort(key=lambda a: a['a'])               # clockwise on the map (x east, z south)
        J = {'node': nd, 'x': round(x, 2), 'z': round(z, 2),
             'arms': [{'way': a['way'], 'dir': a['dir'], 'hd': round(math.degrees(a['a']), 1), 'hw': a['hw']} for a in arms],
             'mini_roundabout': 'mini_roundabout' in fnode.get(nd, ()), 'signals': 'traffic_signals' in fnode.get(nd, ()),
             'give_way': bool(fnode.get(nd, set()) & {'give_way', 'stop'}), 'corners': []}
        for ia in range(len(arms)):
            ib = (ia + 1) % len(arms)
            A, B = arms[ia], arms[ib]
            ang = (B['a'] - A['a']) % (2 * math.pi)
            if ang < math.radians(20) or ang > math.radians(160): continue      # no kerb corner between (nearly) straight arms
            ca = corner_fit(A, B, ang, info, parts_by_way, lidar, (x, z))
            if ca: ca['arms'] = [ia, ib]; J['corners'].append(ca)
        out.append(J)
    return out


def arm_free_length(arm, info, use):
    """distance along the arm's way from the junction node to the next junction node (3+ arms) or the way's end"""
    t, p, ids = info[arm['way']]
    j, acc = arm['i'], 0.0
    while 0 <= j + arm['dir'] < len(ids):
        acc += math.hypot(p[j + arm['dir']][0] - p[j][0], p[j + arm['dir']][1] - p[j][1]); j += arm['dir']
        n_arms = sum(2 if 0 < i2 < len(info[w2][2]) - 1 else 1 for w2, i2 in use.get(ids[j], ()))
        if n_arms >= 3: return acc
    return acc


def arm_kerb(arm, side_out, info, parts_by_way, node_xy, dist=14.0):
    """kerb line of an arm on its outbound side_out ('r' = clockwise side when leaving the node, 'l'): (point, unit dir, type)"""
    t, p, ids = info[arm['way']]
    dist = float(np.clip(0.6 * arm.get('dnext', dist), 3.0, dist))
    P = np.asarray(p, float); seg = np.hypot(*(P[1:] - P[:-1]).T); S = np.concatenate([[0], np.cumsum(seg)])
    s_node = S[arm['i']]; s_q = s_node + arm['dir'] * dist
    s_q = float(np.clip(s_q, 0, S[-1]))
    # which part holds it
    for prt in parts_by_way.get(arm['way'], []):
        sl = s_q - prt.s0
        if -1 <= sl <= prt.L + 1:
            way_side = side_out if arm['dir'] > 0 else ('l' if side_out == 'r' else 'r')
            y, typ, conf, src = prt.kerb_at(sl, way_side)
            # offset along the outbound right normal
            yo = y if arm['dir'] > 0 else -y
            px = np.interp(s_q, S, P[:, 0]); pz = np.interp(s_q, S, P[:, 1])
            a = arm['a']; dx, dz = math.cos(a), math.sin(a); nx, nz = -dz, dx
            return np.array([px + nx * yo, pz + nz * yo]), np.array([dx, dz]), typ, conf, abs(yo)
    return None


def corner_fit(A, B, ang, info, parts_by_way, lidar, node_xy):
    ka = arm_kerb(A, 'r', info, parts_by_way, node_xy); kb = arm_kerb(B, 'l', info, parts_by_way, node_xy)
    if ka is None or kb is None: return None
    pa, da, ta, qa, ha = ka; pb, db, tb, qb, hb = kb
    # intersection of the two kerb lines (pa + u da, pb + v db), both running back toward the junction (u, v < 0)
    M = np.array([[da[0], -db[0]], [da[1], -db[1]]])
    if abs(np.linalg.det(M)) < 1e-3: return None
    u, v = np.linalg.solve(M, pb - pa)
    P = pa + u * da
    phi = math.pi - ang if ang <= math.pi else None       # interior angle of the corner between the outbound directions
    th = (math.atan2(db[1], db[0]) - math.atan2(da[1], da[0])) % (2 * math.pi)
    if th <= 0.05 or th >= math.pi - 0.05: return None
    # fillet tangent to both lines: distance from P along each outbound direction t = R / tan(th / 2)
    kerbed = ta in ('K', 'k') and tb in ('K', 'k')
    tan_h = math.tan(th / 2)
    tmax = min(20.0, 0.8 * min(A.get('dnext', 30.0), B.get('dnext', 30.0)) + 0.5 * min(ha, hb))
    Rs = np.arange(1.5, 25.01, 0.5); Rs = Rs[Rs / tan_h <= tmax]
    if len(Rs) == 0: Rs = np.array([max(0.5, tmax * tan_h)])
    bis = (da + db); bis /= max(np.linalg.norm(bis), 1e-9)
    scores = []
    for R in Rs:
        tt = R / tan_h
        C = P + bis * (R / math.sin(th / 2))
        p0 = P + da * tt; p1 = P + db * tt
        a0 = math.atan2(p0[1] - C[1], p0[0] - C[0]); a1 = math.atan2(p1[1] - C[1], p1[0] - C[0])
        d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        aa = a0 + np.linspace(0.1, 0.9, 9) * d
        ex, ez = np.cos(aa), np.sin(aa)                   # unit vectors from the centre (outward = away from the road? no: toward the road)
        # the arc's centre lies on the pavement side; the road is outside the circle
        xi = C[0] + ex * (R + 0.7); zi = C[1] + ez * (R + 0.7)        # road side
        xo = C[0] + ex * (R - 0.7); zo = C[1] + ez * (R - 0.7)        # pavement side
        if R - 0.7 <= 0.2: scores.append(np.nan); continue
        zr = lidar.sample('dtm', xi, zi); zp = lidar.sample('dtm', xo, zo)
        dsr = lidar.sample('dsm', xi, zi) - zr; dsp = lidar.sample('dsm', xo, zo) - zp
        ok = np.isfinite(zr) & np.isfinite(zp) & (np.abs(dsr) < 0.35) & (np.abs(dsp) < 0.35)
        scores.append(float(np.median((zp - zr)[ok])) if ok.sum() >= 5 else np.nan)
    sc = np.array(scores)
    rank = min(RANK.get(hwb(A['hw']), 6), RANK.get(hwb(B['hw']), 6))
    Rdef = 4.0 if rank >= 8 else 6.0 if rank >= 6 else 9.0 if rank >= 4 else 12.0
    Rdef = float(min(Rdef, max(1.0, min(12.0, tmax) * tan_h)))
    src, R, score = 'default', Rdef, None
    if np.isfinite(sc).sum() >= 5 and kerbed:
        i = int(np.nanargmax(sc))
        if sc[i] >= 0.05 and sc[i] - np.nanmin(sc) >= 0.03:
            R, score, src = float(Rs[i]), float(sc[i]), 'lidar'
    tt = R / tan_h
    C = P + bis * (R / math.sin(th / 2)); p0 = P + da * tt; p1 = P + db * tt
    return {'r': round(R, 1), 'src': src, 'score': None if score is None else round(score, 3), 'kind': 'K' if kerbed else 'O',
            'p0': [round(float(p0[0]), 2), round(float(p0[1]), 2)], 'p1': [round(float(p1[0]), 2), round(float(p1[1]), 2)],
            'c': [round(float(C[0]), 2), round(float(C[1]), 2)]}


def roundabouts(roads, parts_by_way, box):
    rings = collections.defaultdict(list)
    ways = {wid: (t, p, ids) for wid, t, p, ids in roads if t.get('junction') in ('roundabout', 'circular') and wid in parts_by_way}
    # group ring ways that share nodes
    parent = {w: w for w in ways}
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    node_w = collections.defaultdict(list)
    for w, (t, p, ids) in ways.items():
        for nd in ids: node_w[nd].append(w)
    for nd, ws in node_w.items():
        for w in ws[1:]: parent[find(w)] = find(ws[0])
    for w in ways: rings[find(w)].append(w)
    out = []
    for root, ws in rings.items():
        pts = np.array([q for w in ws for q in ways[w][1]], float)
        c = pts.mean(0)
        if not (box[0] <= c[0] <= box[2] and box[1] <= c[1] <= box[3]): continue
        r = np.hypot(*(pts - c).T)
        rr = float(np.median(r))
        if rr > 80: continue
        # inner kerb: UK roundabouts run clockwise: the island is on the right of the ring ways (node order = traffic)
        inner = []
        for w in ws:
            for prt in parts_by_way.get(w, []):
                y, typ, conf, src, pw = prt.side['r']
                m = (src == 'L') & np.isin(typ, ['K', 'k', 'S', 'O'])
                if m.sum(): inner.extend(list(y[m]))
        isl = rr - float(np.median(inner)) if len(inner) >= 3 else max(rr - DEF_HALF.get(hwb(ways[ws[0]][0].get('highway')), 3.5), 0.0)
        out.append({'ways': sorted(ws), 'x': round(float(c[0]), 2), 'z': round(float(c[1]), 2), 'r_ring': round(rr, 2),
                    'r_island': round(max(isl, 0.0), 2), 'src': 'lidar' if len(inner) >= 3 else 'default',
                    'kind': ways[ws[0]][0].get('junction')})
    return out


# ---------------------------------------------------------------- main
def run(roads, areas, buildings, furn, bars, lidar_dirs, box, fetch=False, only=None):
    t0 = time.time()
    lidar = Lidar(lidar_dirs, (box[0] - 60, box[1] - 60, box[2] + 60, box[3] + 60), fetch)
    if lidar.mo.missing: log('missing LIDAR tiles:', ' '.join(lidar.mo.missing))
    masks = Masks(box, buildings, bars, areas)
    sel = select_ways(roads, box)
    if only: sel = [s for s in sel if s[0] in only]
    log(f'{len(sel)} parts, {sum(way_len(p) for _, _, _, p in sel) / 1000:.1f} km')
    segidx = SegIndex(roads)
    node_xy = {}
    for wid, t, p, ids in roads:
        if t.get('highway') in DRIVE:
            for nd, q in zip(ids, p): node_xy[nd] = q
    way_nodes = {wid: ids for wid, t, p, ids in roads}
    parts_by_way, recs = collections.defaultdict(list), {}
    for n, (wid, t, s0, pts) in enumerate(sel):
        if way_len(pts) < 6: continue
        prt = Part(wid, t, s0, pts, lidar, masks)
        if not prt.ok: continue
        prt.set_neighbours({nd: node_xy[nd] for nd in way_nodes[wid] if nd in node_xy}, segidx)
        prt.track()
        recs.setdefault(str(wid), []).append(prt.record())
        prt.win = None                                   # (memory)
        parts_by_way[wid].append(prt)
        if n % 200 == 0: log(f'  {n}/{len(sel)}  {time.time() - t0:.0f} s')
    J = junctions(roads, parts_by_way, lidar, furn, box)
    RB = roundabouts(roads, parts_by_way, box)
    minis = [{'node': f[0], 'x': round(f[1], 2), 'z': round(f[2], 2)} for f in furn if f[5].get('highway') == 'mini_roundabout'
             and box[0] <= f[1] <= box[2] and box[1] <= f[2] <= box[3]]
    isl = [{'node': f[0], 'x': round(f[1], 2), 'z': round(f[2], 2), 'crossing': f[5].get('crossing')} for f in furn
           if f[5].get('crossing:island') == 'yes' and box[0] <= f[1] <= box[2] and box[1] <= f[2] <= box[3]]
    return recs, J, RB, minis, isl


def stats(recs):
    by = collections.defaultdict(list); cov = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    for wid, parts in recs.items():
        for r in parts:
            w = np.array(r['kr'], float) - np.array(r['kl'], float)
            hw = hwb(r['hw']); by[hw].extend(list(w))
            for key in 'lr':
                c = r['c' + key]; e = r['e' + key]
                cov[hw][0] += OUT_STEP * len(c)
                cov[hw][1] += OUT_STEP * sum(1 for a in c if a == 'L')
                cov[hw][2] += OUT_STEP * sum(1 for a, b in zip(c, e) if a == 'L' and b in 'Kk')
    out = {}
    for hw, v in by.items():
        v = np.array(v)
        out[hw] = {'n': int(len(v)), 'width_p10_p50_p90': [round(float(q), 2) for q in np.percentile(v, [10, 50, 90])],
                   'edge_length_km': round(cov[hw][0] / 1000, 2), 'lidar_share': round(cov[hw][1] / max(cov[hw][0], 1), 3),
                   'kerb_share': round(cov[hw][2] / max(cov[hw][0], 1), 3)}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--osm-pickle', help='cache of bake_wsm.read_osm (roads, areas, buildings, trees, tree_rows, piers, furn, bars)')
    ap.add_argument('--pbf', help='OSM extract (read with bake_wsm.read_osm) if no --osm-pickle')
    ap.add_argument('--lidar-cache', action='append', required=True, help='directory of dtm_E_N.tif / dsm_E_N.tif tiles (repeatable)')
    ap.add_argument('--fetch', action='store_true', help='download missing LIDAR tiles (EA WCS) into the first cache')
    ap.add_argument('--region', default='town', help='town | kewstoke | x0,z0,x1,z1 (local metres)')
    ap.add_argument('--only', help='comma separated way ids (debugging)')
    ap.add_argument('--merge', help='an earlier output to keep ways from (ways outside this run stay as they were)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'road_survey.json.gz'))
    a = ap.parse_args()
    if a.osm_pickle and os.path.exists(a.osm_pickle):
        with open(a.osm_pickle, 'rb') as f: roads, areas, buildings, trees, tree_rows, piers, furn, bars = pickle.load(f)
    elif a.pbf and BW is not None:
        roads, areas, buildings, trees, tree_rows, piers, furn, bars = BW.read_osm(a.pbf)
    else:
        sys.exit('need --osm-pickle or --pbf (with bake_wsm / osmium importable)')
    box = REGIONS[a.region] if a.region in REGIONS else tuple(float(v) for v in a.region.split(','))
    only = set(int(v) for v in a.only.split(',')) if a.only else None
    recs, J, RB, minis, isl = run(roads, areas, buildings, furn, bars, a.lidar_cache, box, a.fetch, only)
    doc = {'format': 'road_survey', 'version': 1, 'created': time.strftime('%Y-%m-%d %H:%M'), 'region': list(box),
           'frame': {'origin_lat': ORIGIN_LAT, 'origin_lon': ORIGIN_LON, 'x': 'east (m)', 'z': 'south (m)', 'town': list(TOWN)},
           'sign': 'offsets along the right-hand normal n = (-sin hd, cos hd) of the way direction (OSM node order): y > 0 right, y < 0 left',
           'codes': {'edge': {'K': 'raised kerb >= 5 cm', 'k': 'low kerb 2.5-5 cm', 'S': 'step / bank / wall up > 25 cm', 'D': 'drop-off > 25 cm',
                              'O': 'open edge (slope break, no kerb)', 'H': 'building front', 'W': 'OSM wall/fence/hedge',
                              'V': 'wall/hedge/fence seen in the DSM', 'u': 'unknown (default)'},
                     'source': {'L': 'LIDAR', 'I': 'interpolated (gap <= 40 m)', 'M': 'way median (long gap)', 'D': 'class default'},
                     'back': {'H': 'building', 'W': 'OSM wall/fence/hedge', 'V': 'DSM object (wall, hedge, fence, parked row)', 'T': 'level step',
                              'N': 'no data', 'E': 'class maximum (open area)', '-': 'none'},
                     'pave_source': {'L': 'LIDAR', 'O': 'OSM sidewalk tag'}},
           'ways': recs, 'junctions': J, 'roundabouts': RB, 'mini_roundabouts': minis, 'crossing_islands': isl}
    if a.merge and os.path.exists(a.merge):
        old = json.load(gzip.open(a.merge, 'rt'))
        for wid, v in old['ways'].items():
            if wid not in recs: recs[wid] = v
        nodes = {j['node'] for j in J}
        J.extend(j for j in old.get('junctions', []) if j['node'] not in nodes)
        rbw = {tuple(r['ways']) for r in RB}
        RB.extend(r for r in old.get('roundabouts', []) if tuple(r['ways']) not in rbw)
        mn = {m['node'] for m in minis}; minis.extend(m for m in old.get('mini_roundabouts', []) if m['node'] not in mn)
        ii = {m['node'] for m in isl}; isl.extend(m for m in old.get('crossing_islands', []) if m['node'] not in ii)
        x0 = min(box[0], old['region'][0]); z0 = min(box[1], old['region'][1]); x1 = max(box[2], old['region'][2]); z1 = max(box[3], old['region'][3])
        doc['region'] = [x0, z0, x1, z1]
    doc['stats'] = stats(recs)
    with gzip.open(a.out, 'wt', compresslevel=9) as f:
        json.dump(doc, f, separators=(',', ':'))
    log(f'wrote {a.out}: {len(recs)} ways, {len(J)} junctions, {len(RB)} roundabouts, {os.path.getsize(a.out) / 1e6:.2f} MB')
    for hw, s in sorted(doc['stats'].items(), key=lambda kv: RANK.get(kv[0], 9)):
        log(f'  {hw:14s} {s}')


if __name__ == '__main__':
    main()
