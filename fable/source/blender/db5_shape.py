# Aston Martin DB5 (1964) — body surface as analytic functions, sampled into a quad grid.
# Car frame (same as the game): origin on the ground under the middle of the wheelbase,
# X forward, Y up, Z to the right. Units: metres. Only the right half (z >= 0) is generated.
import numpy as np

AXF, AXR = 1.2445, -1.2445        # axles (wheelbase 2.489 m, FIA form 186)
WHEEL_R = 0.338                    # 6.70-15 cross-ply tyre on a 15" wire wheel
HUB_Z = 0.684                      # half track
ARCH_R, ARCH_Y = 0.385, 0.338
BELT = 0.890                       # waist line (bottom of the side glass)
COT_TH = 4.2                      # side-glass tumblehome: dy/dz


def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def w_plan(x):
    """Half width of the body in plan view (at its widest height)."""
    return 0.838 - 0.075 * sm(0.5, 2.05, x) ** 1.6 - 0.115 * sm(-0.9, -2.45, x) ** 1.7


def wall(x, y):
    """Half width of the body side as a function of height: barrel-shaped flank."""
    d = y - 0.60
    return w_plan(x) - np.where(d < 0, 0.038 * (d / 0.40) ** 2, 0.070 * np.abs(d / 0.30) ** 2.2)


def y_bottom(x):
    return 0.205 + 0.045 * sm(1.55, 1.95, x) + 0.155 * sm(-1.70, -2.25, x)


def deck_c(x):
    """Centre-line profile of the body without the cabin: nose, bonnet, scuttle, boot, tail."""
    front = 0.912 - 0.075 * (x - 0.62) - 0.030 * np.clip((x - 0.62) / 1.35, 0, None) ** 2
    rear = 0.912 - 0.135 * np.clip((-1.15 - x) / 1.2, 0, None) ** 1.3
    y = np.where(x > 0.62, front, rear)
    fascia = 0.735 - 9.0 * (x - 2.045)
    tail = 0.775 + 7.0 * (x + 2.415)
    y = smin(y, fascia, 0.11)
    y = smin(y, tail, 0.10)
    return y


def deck(x, z):
    zz = np.abs(z) / w_plan(x)
    xe = x + 0.15 * sm(1.25, 1.85, x) * zz ** 2.8 - 0.13 * sm(-1.85, -2.30, x) * zz ** 3.0
    drop = 0.050
    y = deck_c(xe) - drop * zz ** 3.0
    # wing crests: a shallow valley between bonnet/boot and the wings; small fins at the tail
    crest = np.exp(-((zz - 0.80) / 0.16) ** 2)
    fin = np.exp(-((zz - 0.86) / 0.11) ** 2)
    y = y + crest * (0.030 + 0.035 * sm(1.0, 1.6, x)) * sm(0.55, 1.0, x) * sm(2.02, 1.86, x) + fin * 0.075 * sm(-1.1, -2.2, x)
    # bonnet power bulge with its forward-facing air intake
    y = y + 0.034 * sm(0.80, 1.52, xe) * sm(1.585, 1.565, xe) * (1 - sm(0.135, 0.20, np.abs(z)))
    return y


def roof_c(x):
    wind = 0.912 + 0.76 * (0.60 - x)
    rf = 1.320 - 0.07 * ((x + 0.30) / 0.55) ** 2
    t = np.clip((-0.30 - x) / 1.0, 0, None)
    rb = 1.320 - 0.30 * t ** 2.1
    return smin(wind, np.where(x > -0.30, rf, rb), 0.10)


def z_glass(x):
    """Half width of the cabin at the waist line."""
    return wall(x, BELT) - 0.016 - 0.25 * sm(-0.45, -1.75, x) ** 1.4 - 0.045 * sm(0.15, 0.7, x)


def green(x, z):
    zz = np.abs(z) / 0.60
    xe = x + 0.12 * zz ** 2 * sm(-0.25, 0.4, x) - 0.15 * zz ** 2 * sm(-0.55, -1.2, x)
    top = roof_c(xe) - 0.060 * zz ** 2.4
    side = BELT + (z_glass(x) - np.abs(z)) * COT_TH
    return smin(top, side, 0.055)


def top(x, z):
    return smax(deck(x, z), green(x, z), 0.028)


def roof_edge_y(x):
    """Height where the side glass meets the roof (used for the window outlines)."""
    z = np.linspace(0.3, 0.8, 120)
    zz = z / 0.60
    xe = x + 0.12 * zz ** 2 * sm(-0.25, 0.4, x) - 0.15 * zz ** 2 * sm(-0.55, -1.2, x)
    t = roof_c(xe) - 0.070 * zz ** 2.2
    s = BELT + (z_glass(x) - z) * COT_TH
    i = int(np.argmin(np.abs(t - s)))
    return float(t[i])


def warp(P):
    """Tuck the lower nose and the lower tail under (the height-field profile cannot overhang)."""
    x, y = P[..., 0], P[..., 1]
    P = P.copy()
    z = np.abs(P[..., 2])
    lean = 0.42 * np.clip(y - 0.56, 0, None) * sm(0.40, 0.58, z) * sm(1.55, 1.92, x)      # headlamp cowls lean back
    P[..., 0] = x - lean - 0.04 * sm(1.70, 2.0, x) * sm(0.44, 0.24, y) ** 1.4 + 0.20 * sm(-2.0, -2.32, x) * sm(0.60, 0.32, y) ** 1.3
    return P


def _smooth(p, r):
    """Moving average along arclength with per-point radius r (rounds corners into fillets)."""
    n = len(p)
    d = np.linalg.norm(np.diff(p, axis=0), axis=1)
    step = d.mean()
    pad = int(np.ceil(r.max() / step)) + 2
    # mirror across the centre plane at the end (z -> -z); extend the start straight
    head = p[0] + (p[0] - p[1:pad + 1][::-1])
    tail = p[-pad - 1:-1][::-1] * np.array([-1.0, 1.0])
    q = np.vstack([head, p, tail])
    c = np.vstack([np.zeros((1, 2)), np.cumsum(q, axis=0)])
    w = np.maximum(1, np.round(r / step).astype(int))
    i = np.arange(n) + pad
    return (c[i + w + 1] - c[i - w]) / (2 * w + 1)[:, None]


def section(x, n, dense=700):
    """Half cross-section at station x as n points (z, y), from the bottom edge up and over to the centre line."""
    yb = float(y_bottom(x))
    if top(x, 0.0) <= yb + 0.004:
        return None
    ys = np.linspace(yb, 1.05, 500)
    zs = wall(x, ys)
    tw = top(x, zs)
    above = ys >= tw
    if above[0]:
        zl = np.linspace(0, float(wall(x, yb)), 800)
        tl = top(x, zl)
        k = int(np.argmax(tl < yb)) if (tl < yb).any() else len(zl) - 1
        z0 = zl[max(k - 1, 0)]
        zt = np.linspace(z0, 0, dense)
        pts = np.stack([zt, top(x, zt)], axis=1)
        pts[0, 1] = max(pts[0, 1], yb)
    else:
        k = int(np.argmax(above))
        yw = ys[:k]
        zt = np.linspace(float(wall(x, ys[k])), 0, dense)
        pts = np.vstack([np.stack([wall(x, yw), yw], axis=1), np.stack([zt, top(x, zt)], axis=1)])
    # resample uniformly by arclength
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    su = np.linspace(0, s[-1], dense)
    p = np.stack([np.interp(su, s, pts[:, 0]), np.interp(su, s, pts[:, 1])], axis=1)
    # corner radii: generous on wings and roof, tight where the glass meets the waist
    zq = float(z_glass(x)) - 0.04
    gh = float(sm(0.03, 0.14, green(x, zq) - deck(x, zq)))
    r_low = 0.058 + (0.011 - 0.058) * gh
    r = r_low + (0.050 - r_low) * sm(BELT + 0.05, BELT + 0.16, p[:, 1]) * gh
    r = np.minimum(r, 0.02 + 0.9 * su)          # keep the bottom edge where it is
    for _ in range(2):
        p = _smooth(p, r * 0.7)
    p[-1, 0] = 0.0
    d = np.linalg.norm(np.diff(p, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    su = np.linspace(0, s[-1], n)
    return np.stack([np.interp(su, s, p[:, 0]), np.interp(su, s, p[:, 1])], axis=1)


def stations(nu):
    xs = np.linspace(2.14, -2.52, 4000)
    ok = top(xs, 0.0) > y_bottom(xs) + 0.006
    xs = xs[ok]
    yc = top(xs, 0.0)
    s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xs), np.diff(yc)))])
    return np.interp(np.linspace(0, s[-1], nu), s, xs)


def body_grid(nu=190, nv=84):
    """Returns P[nu, nv, 3] (game coordinates) of the right half of the body skin."""
    xs = stations(nu)
    P = np.zeros((nu, nv, 3))
    for i, x in enumerate(xs):
        sec = section(float(x), nv)
        P[i, :, 0] = x
        P[i, :, 1] = sec[:, 1]
        P[i, :, 2] = sec[:, 0]
    return warp(P), xs


def inside(x, y, z):
    """Is the point (unwarped frame) inside the body volume?"""
    return (abs(z) < wall(x, y)) and (y < top(x, abs(z)))


def outline(y, cx, a0, a1, n):
    """Plan-view outline of the body at height y: rays from (cx, 0) at angles a0..a1 (0 = straight ahead)."""
    out = []
    for a in np.linspace(a0, a1, n):
        dx, dz = np.cos(a), np.sin(a)
        lo, hi = 0.0, 2.0
        for _ in range(40):
            m = (lo + hi) / 2
            if inside(cx + dx * m, y, dz * m):
                lo = m
            else:
                hi = m
        out.append(warp(np.array([cx + dx * lo, y, dz * lo])))
    return np.array(out)


def surf_x(z, y, front=True):
    """x of the body surface at (z, y) on the nose (front) or the tail."""
    lo, hi = (0.8, 2.3) if front else (-0.8, -2.7)
    for _ in range(44):
        m = (lo + hi) / 2
        if inside(m, y, z):
            lo = m
        else:
            hi = m
    return float(warp(np.array([lo, y, z]))[0])
