"""Terrain of the Weston-super-Mare map, bake side (imported by bake_wsm.py).

Spill levels (the tide): the lowest sea level at which each 2 m node connects to the open sea over the ground (a priority
flood from the open sea at the region's edge), so that land below the sea stays dry behind a dune ridge or a sea wall
(Sand Bay's fields at 5.5 m OD behind dunes of 9.5-12 m; Weston town centre behind its sea wall) exactly as it does. A
culvert or a sluice the DTM cannot see does not let the sea in.

2 m detail patches: the 6 m near grid (3 x 3 samples per cell and a light blur) rounds off whatever is narrower than about
20 m: dune crests (up to 2 m low on Sand Bay's dunes), the banks of the Toll Road's cutting, Kewstoke's lanes and the
hillside under Monk's Steps, the rhynes of the fields. Over those places the bake adds patches of 2 m residuals (EA 1 m
DTM, bilinear at the 2 m nodes, minus the game's own Catmull-Rom of the 6 m grid), in tiles of 32 x 32 nodes (64 m). The
game's heightfield is a 2 m grid already (townHeightsBuild), so it adds them node for node. Each patch fades in over its
outer 24 m, so its edge leaves no step.
"""
import math, os, pickle
import numpy as np

DETAIL_RES, DETAIL_TS, DETAIL_Q = 2.0, 32, 0.1     # node spacing (m), tile size (nodes), residual quantum (m, int8)
DETAIL_KNEE, DETAIL_Q2 = 80, 0.3                   # int8 codes beyond +-80 step by 0.3 m (quarry faces: up to +-22 m)


def detail_encode(r):
    """residuals (m) -> int8 codes: DETAIL_Q steps up to the knee, DETAIL_Q2 steps beyond it"""
    a = np.abs(r); k = DETAIL_KNEE * DETAIL_Q
    c = np.where(a <= k + DETAIL_Q / 2, np.round(a / DETAIL_Q), DETAIL_KNEE + np.round((a - k) / DETAIL_Q2))
    return (np.sign(r) * np.minimum(c, 127)).astype(np.int8)


def detail_decode(c):
    c = np.asarray(c, np.float64); a = np.abs(c)
    return np.sign(c) * np.where(a <= DETAIL_KNEE, a * DETAIL_Q, DETAIL_KNEE * DETAIL_Q + (a - DETAIL_KNEE) * DETAIL_Q2)
DETAIL_FADE = 12                                   # nodes (24 m): the residuals fade in from a patch's edge

# Patches (local frame: x east, z south, metres): boxes x0, z0, x1, z1 and the residual that earns a tile its place (0:
# every tile in the box; else a tile goes in where the 95th percentile of its |residual| or its maximum (over 2 x thr +
# 0.3) says the 6 m grid misses something: the rough hillsides keep only what shows)
DETAIL_BOXES = {
    'kewstoke': ((1300.0, -2200.0, 2420.0, -1440.0), 0.0),     # Kewstoke village, St Paul's church, Monk's Steps, Monks Hill
    'sandbay': ((1040.0, -4620.0, 2620.0, -1940.0), 0.0),      # Sand Bay: beach, dune ridge, the caravan parks and the fields
    'seafront': ((-400.0, -250.0, 250.0, 2500.0), 0.0),        # Weston: the sea wall, the promenade and its steps, Marine Parade
    'knightstone': ((-650.0, -560.0, -40.0, -140.0), 0.0),     # Knightstone, the Marine Lake and its causeway, Glentworth Bay
    'uphill': ((-900.0, 2350.0, 900.0, 3300.0), 0.0),          # Uphill: the beach, the River Axe and the pill, the old quarry
    'sandpoint': ((-200.0, -5100.0, 2900.0, -4380.0), 0.2),    # Sand Point and Middle Hope
    'worlebury': ((-1100.0, -1700.0, 2900.0, -500.0), 0.2),    # Worlebury Hill: the woods, the hill fort, Birnbeck
}
DETAIL_TOLL_RADIUS = 90.0                          # the Toll Road along Worlebury Hill: a corridor either side of it (every tile)


# Tide levels at Weston-super-Mare (m above Ordnance Datum Newlyn). Chart datum there lies about 5.85 m below OD: between
# Hinkley Point (-5.90 m) and Newport (-5.81 m) in the NTSLF table of datum differences (ntslf.org/node/36; Avonmouth is
# -6.50 m). The Admiralty's predictions for Weston-super-Mare (EasyTide port 0527) give spring high waters of about 12.0 m
# and spring low waters of about 1.3 m above chart datum (November 2026). Mean high water springs on the Sand Bay and
# Woodspring Bay frontage is 6.19 m OD and the highest astronomical tide 7.56 m OD (Environment Agency coastal flood
# boundary levels quoted in North Somerset Council's flood evidence, CD6.3, 2023); the 1981 surge reached 8.10 m OD.
TIDES = {'low': -4.6, 'mid': 1.2, 'high': 6.2}     # spring low water (MLWS), the game's mid tide, spring high water (MHWS)
SPILL_CAP = 9.0                                    # spill levels are exact below this (m); higher ground is dry at any tide
SPILL_Q = 0.1                                      # stored spill levels: (level + 10) / SPILL_Q in a byte


def spill_levels(H, seeds, cap=SPILL_CAP, q=0.01, log=print):
    """Priority flood: F[j, i] = the lowest water level at which the node connects to a seed (the open sea) through nodes
    (4-neighbours) no higher than that level; NaN where it never does below the cap. H: 2-D heights (NaN = no data =
    the open sea, as the survey stops at the water), seeds: boolean mask. Bucket queue on levels quantised to q."""
    import array, time
    t0 = time.time(); h, w = H.shape; W = w + 2
    WALL = 1 << 30
    L0 = int(math.floor(-12.0 / q)); top = int(math.ceil(cap / q))
    Hp = np.full((h + 2, W), WALL, np.int64)
    Hc = np.where(np.isfinite(H), H, -12.0)
    Hq = np.round(Hc / q).astype(np.int64); Hq = np.maximum(Hq, L0); Hq[Hc >= cap] = WALL
    Hp[1:-1, 1:-1] = Hq
    Hs = array.array('q'); Hs.frombytes(np.ascontiguousarray(Hp, '<i8').tobytes()); N = len(Hs); del Hp, Hc, Hq
    F = array.array('q'); F.frombytes(np.full(N, WALL, '<i8').tobytes())
    done = bytearray(N)
    for k in range(W): done[k] = 1; done[N - 1 - k] = 1
    for j in range(h + 2): done[j * W] = 1; done[j * W + W - 1] = 1
    nb = top - L0 + 1; buckets = [[] for _ in range(nb)]
    sj, si = np.nonzero(seeds)
    for j, i in zip(sj.tolist(), si.tolist()):
        n = (j + 1) * W + i + 1; hv = Hs[n]
        if hv >= WALL or done[n]: continue
        done[n] = 1; F[n] = hv; buckets[hv - L0].append(n)
    off = (1, -1, W, -W)
    for b in range(nb):
        st = buckets[b]; lv = b + L0
        while st:
            c = st.pop()
            for d in off:
                m = c + d
                if done[m]: continue
                done[m] = 1; hm = Hs[m]
                if hm >= WALL: continue
                if hm <= lv: F[m] = lv; st.append(m)
                else: F[m] = hm; buckets[hm - L0].append(m)
        buckets[b] = None
    Fa = np.frombuffer(F, np.int64).reshape(h + 2, W)[1:-1, 1:-1].astype(np.float64)
    out = np.where(Fa >= WALL, np.nan, Fa * q)
    log(f'spill levels: {np.isfinite(out).sum()} of {out.size} nodes reach the sea below {cap:.1f} m ({time.time() - t0:.0f} s)')
    return out


def spill_bytes(F, H):
    """per node: 0 where the node meets the sea at its own height (the game then uses its own height), 255 where it never
    does below the cap, else the spill level as (F + 10) / SPILL_Q (a dune-locked or walled-in hollow: constant over it)"""
    B = np.full(F.shape, 255, np.uint8)
    ok = np.isfinite(F)
    lvl = np.clip(np.round((F + 10.0) / SPILL_Q), 1, 254)
    hollow = ok & (F - np.where(np.isfinite(H), H, -12.0) > 0.05)
    B[ok & ~hollow] = 0; B[hollow] = lvl[hollow].astype(np.uint8)
    return B


def water_level(lidar, ring, H2, B, TOWN, mid, inside):
    """A lake's level: the survey sees the water's surface, so the DTM inside the polygon (30th percentile, 2 m grid 1 m
    in from the shore). A water the sea reaches at mid tide (a tidal river, a pool on the beach) has no level of its own:
    -3276.8 (the game leaves it to the tide). None where the survey has nothing."""
    xs = [p[0] for p in ring]; zs = [p[1] for p in ring]
    pts = [(x, z) for z in np.arange(min(zs) + 1, max(zs), 2.0) for x in np.arange(min(xs) + 1, max(xs), 2.0) if inside(ring, x, z)]
    if len(pts) < 4: pts = [(sum(xs) / len(xs), sum(zs) / len(zs))]
    X = np.array([p[0] for p in pts]); Z = np.array([p[1] for p in pts])
    E, N = lidar.en(X, Z); d = lidar.sample('dtm', E, N); d = d[np.isfinite(d)]
    h, w = B.shape; i = np.clip(np.round((X - TOWN[0]) / DETAIL_RES).astype(int), 0, w - 1); j = np.clip(np.round((Z - TOWN[1]) / DETAIL_RES).astype(int), 0, h - 1)
    b = B[j, i]; f = np.where(b == 0, H2[j, i], np.where(b == 255, 99.0, b * SPILL_Q - 10.0))
    if (f < mid).any(): return -3276.8
    return float(np.percentile(d, 30)) if d.size else None


def grid_nodes(TOWN, res=DETAIL_RES):
    w = int(round((TOWN[2] - TOWN[0]) / res)) + 1; h = int(round((TOWN[3] - TOWN[1]) / res)) + 1
    return w, h


def catrom_up(N, nres, res, w, h):
    """the game's townHeightsBuild: separable Catmull-Rom from the near grid (spacing nres) to nodes at res (w x h)"""
    nh, nw = N.shape; nr = nres / res
    def wts(n_out, n_in):
        f = np.arange(n_out) / nr; i0 = np.floor(f).astype(np.int64); u = f - i0
        c = [((-0.5 * u + 1) * u - 0.5) * u, (1.5 * u - 2.5) * u * u + 1, ((-1.5 * u + 2) * u + 0.5) * u, (0.5 * u - 0.5) * u * u]
        idx = [np.maximum(0, i0 - 1), np.minimum(n_in - 1, i0), np.minimum(n_in - 1, i0 + 1), np.minimum(n_in - 1, i0 + 2)]
        return c, idx
    cu, iu = wts(w, nw); cv, iv = wts(h, nh)
    tmp = sum(N[:, iu[k]].astype(np.float64) * cu[k][None, :] for k in range(4))
    return sum(tmp[iv[k], :] * cv[k][:, None] for k in range(4))


def dtm_bilinear(lidar, X, Z):
    """the 1 m DTM, bilinear at local points (NaN where a neighbouring pixel has no survey)"""
    E, N = lidar.en(X, Z); E = np.asarray(E, float); N = np.asarray(N, float)
    fi = E - 0.5; fj = N + 0.5                          # pixel centres at (e + 0.5, n - 0.5)
    e0 = np.floor(fi); n0 = np.floor(fj); u = fi - e0; v = fj - n0
    a = lidar.sample('dtm', e0 + 0.5, n0 - 0.5); b = lidar.sample('dtm', e0 + 1.5, n0 - 0.5)
    c = lidar.sample('dtm', e0 + 0.5, n0 + 0.5); d = lidar.sample('dtm', e0 + 1.5, n0 + 0.5)
    # (n0 - 0.5 is the row below the point, n0 + 0.5 the row above: v measures from the lower one)
    return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v).astype(np.float32)


def box_blur(M, r):
    """mean over a (2r+1)^2 window (edges clamped), by cumulative sums"""
    def blur1(A, axis):
        n = A.shape[axis]; P = np.concatenate([np.repeat(np.take(A, [0], axis), r + 1, axis), A, np.repeat(np.take(A, [n - 1], axis), r, axis)], axis)
        C = np.cumsum(P, axis, dtype=np.float64)
        return (np.take(C, np.arange(2 * r + 1, n + 2 * r + 1), axis) - np.take(C, np.arange(0, n), axis)) / (2 * r + 1)
    return blur1(blur1(M.astype(np.float64), 0), 1)


def detail_candidates(TOWN, toll_lines, w, h):
    """tiles that may get detail, with the residual that earns each its place (inf: none)"""
    ts = DETAIL_TS; tw = (w + ts - 1) // ts; th = (h + ts - 1) // ts
    thr = np.full((th, tw), np.inf)
    tx0 = TOWN[0] + np.arange(tw) * ts * DETAIL_RES; tz0 = TOWN[1] + np.arange(th) * ts * DETAIL_RES; L = ts * DETAIL_RES
    for (x0, z0, x1, z1), t in DETAIL_BOXES.values():
        m = (tz0[:, None] + L > z0) & (tz0[:, None] < z1) & (tx0[None, :] + L > x0) & (tx0[None, :] < x1)
        thr[m] = np.minimum(thr[m], t)
    # Toll Road: tiles whose centre lies within the radius (+ half a tile) of the road
    cx = tx0 + L / 2; cz = tz0 + L / 2; CX, CZ = np.meshgrid(cx, cz); best = np.full(CX.shape, 1e9)
    for pts in toll_lines:
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            ex, ez = bx - ax, bz - az; l2 = ex * ex + ez * ez + 1e-9
            t = np.clip(((CX - ax) * ex + (CZ - az) * ez) / l2, 0, 1)
            best = np.minimum(best, np.hypot(CX - ax - ex * t, CZ - az - ez * t))
    thr[best < DETAIL_TOLL_RADIUS + L * 0.5] = 0.0
    return thr


def bake_detail(TOWN, Hn, nres, nq, lidar, toll_lines, log):
    """2 m residual tiles: returns (tile index pairs (tj, ti) u16, residuals int8 (n, ts, ts), the 2 m base)"""
    w, h = grid_nodes(TOWN); ts = DETAIL_TS
    thr = detail_candidates(TOWN, toll_lines, w, h)
    # the game's own base: the 6 m grid as decoded (quantised), Catmull-Rom to 2 m
    base = catrom_up(np.round(Hn / nq) * nq, nres, DETAIL_RES, w, h)
    # pass 1: the residuals of the candidate tiles, and which of them earn their place
    res, sel = {}, np.zeros(thr.shape, bool)
    for tj, ti in zip(*np.nonzero(np.isfinite(thr))):
        j0, i0 = tj * ts, ti * ts; j1, i1 = min(h, j0 + ts), min(w, i0 + ts)
        xs = TOWN[0] + np.arange(i0, i1) * DETAIL_RES; zs = TOWN[1] + np.arange(j0, j1) * DETAIL_RES
        X, Z = np.meshgrid(xs, zs); D = dtm_bilinear(lidar, X, Z)
        r = np.where(np.isfinite(D), D - base[j0:j1, i0:i1], 0.0); a = np.abs(r)
        t = thr[tj, ti]
        if t > 0 and np.percentile(a, 95) <= t and a.max() <= 2 * t + 0.3: continue
        res[(tj, ti)] = (r.astype(np.float32), D); sel[tj, ti] = True
    # fade: 0 at the edge of the patches, 1 from DETAIL_FADE nodes inside (a box blur of the mask, rescaled)
    M = np.repeat(np.repeat(sel, ts, 0), ts, 1)[:h, :w]
    fade = np.clip((box_blur(M, DETAIL_FADE) - 0.5) * 2.0, 0, 1); fade = fade * fade * (3 - 2 * fade)
    tiles, data, err_b, err_a = [], [], [], []
    for (tj, ti), (r, D) in sorted(res.items()):
        j0, i0 = tj * ts, ti * ts; j1, i1 = min(h, j0 + ts), min(w, i0 + ts)
        q = detail_encode(r * fade[j0:j1, i0:i1])
        if not q.any(): continue
        full = np.zeros((ts, ts), np.int8); full[:j1 - j0, :i1 - i0] = q
        tiles.append((tj, ti)); data.append(full)
        ok = np.isfinite(D) & (fade[j0:j1, i0:i1] > 0.999)
        err_b.append(np.abs(base[j0:j1, i0:i1] - D)[ok]); err_a.append(np.abs(base[j0:j1, i0:i1] + detail_decode(q) - D)[ok])
    eb = np.concatenate(err_b) if err_b else np.zeros(1); ea = np.concatenate(err_a) if err_a else np.zeros(1)
    log(f'terrain detail: {len(tiles)} tiles of {ts} x {ts} nodes at {DETAIL_RES:.0f} m ({len(tiles) * (ts * DETAIL_RES) ** 2 / 1e6:.2f} km2, '
        f'of {int(np.isfinite(thr).sum())} candidates); |6 m grid - DTM| at the nodes p50 {np.percentile(eb, 50):.2f} p95 {np.percentile(eb, 95):.2f} '
        f'max {eb.max():.2f} m -> with the detail p50 {np.percentile(ea, 50):.2f} p95 {np.percentile(ea, 95):.2f} max {ea.max():.2f} m')
    ij = np.asarray(tiles, '<u2').reshape(-1, 2) if tiles else np.zeros((0, 2), '<u2')
    return ij, (np.stack(data) if data else np.zeros((0, ts, ts), np.int8)), base


def with_detail(base, ij, dtl):
    """the game's 2 m heightfield before its roads: the Catmull-Rom base plus the detail tiles"""
    D = base.copy(); h, w = D.shape; ts = DETAIL_TS
    for (tj, ti), r in zip(ij.tolist(), dtl):
        j0, i0 = tj * ts, ti * ts; j1, i1 = min(h, j0 + ts), min(w, i0 + ts); D[j0:j1, i0:i1] += detail_decode(r[:j1 - j0, :i1 - i0])
    return D


def bake_spill(D, log):
    """spill bytes of the 2 m heightfield D (see spill_bytes): seeds are the nodes on the region's edge below 0 m OD (the
    Bristol Channel to the west and north, the mouth of the River Axe to the south); the levels inland of the region's
    eastern edge are taken as defended (they are: sea banks and sluices on Woodspring Bay and the River Banwell)"""
    seeds = np.zeros(D.shape, bool)
    for sl in (np.s_[0, :], np.s_[-1, :], np.s_[:, 0], np.s_[:, -1]): seeds[sl] = D[sl] < 0.0
    F = spill_levels(D, seeds, log=log)
    for name, t in TIDES.items():
        wet = np.isfinite(F) & (F < t)
        log(f'  tide {name} {t:+.1f} m OD: sea over {wet.sum() * 4e-6:.2f} km2 of the region; {((D < t) & ~wet).sum() * 4e-6:.2f} km2 below it stay dry')
    return spill_bytes(F, D)


# ---------------------------------------------------------------- rhynes, ditches and streams
# The drainage of the levels (Sand Bay's fields, the moors behind Weston, Uphill): OSM waterway lines, culverts left out
# (no water shows there). Type codes for the game: 1 river or canal, 2 stream, 3 rhyne, drain or ditch; widths (m) where
# OSM gives none. The water lies in the channel the 2 m terrain shows; the game puts it just above the ground otherwise.
WATERWAY = {'river': 1, 'canal': 1, 'stream': 2, 'drain': 3, 'ditch': 3}
WATERWAY_WIDTH = {'river': 8.0, 'canal': 6.0, 'stream': 2.5, 'drain': 2.6, 'ditch': 1.8}


def read_waters(pbf, box, proj, unproj, cache=None):
    """{'waterways': [(osm id, tags, local points)] near the region, 'coastline': [(osm id, local points)] within box
    (x0, z0, x1, z1: the far grid)}, cached in a pickle (one pass of the extract)"""
    if cache and os.path.exists(cache):
        with open(cache, 'rb') as f: return pickle.load(f)
    import osmium
    W, S = unproj(box[0], box[3]); E, N = unproj(box[2], box[1])
    ww, coast = [], []
    for o in osmium.FileProcessor(pbf).with_locations():
        if not o.is_way(): continue
        t = o.tags; w = t.get('waterway'); c = t.get('natural') == 'coastline'
        if not c and (w not in WATERWAY or t.get('tunnel') in ('culvert', 'yes', 'flooded') or t.get('location') == 'underground'): continue
        try: lls = [(n.location.lon, n.location.lat) for n in o.nodes]
        except osmium.InvalidLocationError: continue
        if not any(W <= lo <= E and S <= la <= N for lo, la in lls): continue
        pts = [proj(lo, la) for lo, la in lls]
        if c: coast.append((o.id, pts))
        else: ww.append((o.id, dict(t), pts))
    ww.sort(key=lambda w_: w_[0]); coast.sort(key=lambda c_: c_[0])
    out = {'waterways': ww, 'coastline': coast}
    if cache:
        with open(cache, 'wb') as f: pickle.dump(out, f)
    return out


def coast_raster(coast, fx0, fz0, res, fw, fh):
    """the OSM coastline (mean high water) on the far grid's nodes: 1 where it passes (an 8-connected line, which a
    4-connected flood cannot cross). The game floods the far grid up to the tide's level behind it near the English
    coast (the Somerset Levels lie behind sea banks and dunes the 100 m grid cannot see)."""
    R = np.zeros((fh, fw), np.uint8)
    for oid, pts in coast:
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            n = max(1, int(math.ceil(math.hypot(bx - ax, bz - az) / (res * 0.45))))
            for k in range(n + 1):
                x = ax + (bx - ax) * k / n; z = az + (bz - az) * k / n
                i = int(round((x - fx0) / res)); j = int(round((z - fz0) / res))
                if 0 <= i < fw and 0 <= j < fh: R[j, i] = 1
    return R


def waterway_lines(ways, clip, simplify, dedupe):
    """(polylines, info [(type, width dm)]) of the waterways inside the region"""
    lines, info = [], []
    for oid, t, pts in ways:
        ww = t.get('waterway'); wd = WATERWAY_WIDTH[ww]
        try:
            v = float(t.get('width', '').split()[0].replace(',', '.'))
            if 0.5 <= v <= 40: wd = v
        except (ValueError, IndexError):
            pass
        for part in clip(pts, -20):
            part = dedupe(simplify(part, 0.3), 0.2)
            if len(part) >= 2: lines.append(part); info.append((WATERWAY[ww], min(255, int(round(wd * 10)))))
    return lines, info
