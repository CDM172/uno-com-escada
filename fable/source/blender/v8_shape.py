# Aston Martin V8 Vantage (1977-89; the 1987 car of the film is a V8 with Vantage nose, power bulge and boot spoiler)
# — body surface, fitted to measured curves.
#
# Car frame (same as the game): origin on the ground under the middle of the wheelbase,
# X forward, Y up, Z to the right; metres. Only the right half (z >= 0) is generated.
#
# Where the numbers come from:
#  * Published specifications: wheelbase 2.610, tracks ~1.50, length ~4.67, width 1.83, height ~1.33,
#    255/60 VR15 tyres on 15 in alloy wheels.
#  * Scale drawing "1983 Aston Martin V8 Vantage" (getoutlines.com, CC BY 4.0), front/side/rear/top views,
#    scaled by the wheelbase and read pixel by pixel: roof and fastback line, power bulge, nose and tail,
#    sill and valances, wing crests, plan widths, glasshouse, arches, lamps, grille, bumpers.
#
# Construction (same machinery as db5_shape.py): every station is a closed half-section
#   belly -> flank -> shoulder (Bezier arcs up to the wing crest / waist) -> top (a height field from the crest
#   to the centre line), clipped by the nose and tail faces. The top is the wing/bonnet/deck surface with the
#   cabin + fastback volume blended on, plus the power bulge on the bonnet.
import numpy as np

AXF, AXR = 1.305, -1.305            # axles (wheelbase 2.610)
WHEEL_R = 0.352
HUB_ZF, HUB_ZR = 0.750, 0.750       # half tracks
HUB_Z = HUB_ZF
ARCH_Y = 0.368                      # arch centres sit a little above the hubs (as drawn)
BELT = 0.916                        # waist: bottom of the side glass
ROOF = 1.324
X_NOSE, X_TAIL = 2.188, -2.370      # body ends (without bumpers)


def sm(a, b, x):
    t = np.clip((np.asarray(x, dtype=float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    k = np.maximum(k, 1e-6)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


class Curve:
    """Feature line: shape-preserving cubic through measured knots, lightly smoothed (C2 in practice)."""

    def __init__(self, pts, sigma=0.03):
        pts = sorted(pts)
        xk = np.array([p[0] for p in pts], dtype=float)
        yk = np.array([p[1] for p in pts], dtype=float)
        pad = 0.4
        self.x = np.arange(xk[0] - pad, xk[-1] + pad, 0.002)
        y = self._pchip(xk, yk, np.clip(self.x, xk[0], xk[-1]))
        if sigma > 0:
            n = int(4 * sigma / 0.002)
            g = np.exp(-0.5 * (np.arange(-n, n + 1) * 0.002 / sigma) ** 2)
            g /= g.sum()
            y = np.convolve(np.pad(y, n, mode='edge'), g, mode='valid')
        self.y = y

    @staticmethod
    def _pchip(xk, yk, x):
        h = np.diff(xk)
        d = np.diff(yk) / h
        m = np.zeros_like(yk)
        for i in range(1, len(xk) - 1):
            if d[i - 1] * d[i] > 0:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        m[0], m[-1] = d[0], d[-1]
        i = np.clip(np.searchsorted(xk, x) - 1, 0, len(xk) - 2)
        t = (x - xk[i]) / h[i]
        h00 = (1 + 2 * t) * (1 - t) ** 2
        h10 = t * (1 - t) ** 2
        h01 = t * t * (3 - 2 * t)
        h11 = t * t * (t - 1)
        return h00 * yk[i] + h10 * h[i] * m[i] + h01 * yk[i + 1] + h11 * h[i] * m[i + 1]

    def __call__(self, x):
        return np.interp(x, self.x, self.y)


# ------------------------------------------------------------------------------ measured feature lines
# plan outline: half width at the widest height (arch flares included)
Z_MAX = Curve([(-2.37, 0.70), (-2.345, 0.76), (-2.30, 0.80), (-2.20, 0.828), (-2.0, 0.840), (-1.80, 0.858), (-1.70, 0.886),
               (-1.30, 0.898), (-1.0, 0.903), (-0.93, 0.893), (-0.5, 0.894), (0.0, 0.898), (0.5, 0.902), (0.84, 0.906),
               (0.92, 0.914), (1.2, 0.913), (1.5, 0.907), (1.76, 0.900), (1.9, 0.884), (2.0, 0.870), (2.1, 0.855), (2.2, 0.84)], sigma=0.02)
Y_MAXW = Curve([(-2.4, 0.60), (2.2, 0.60)], sigma=0.0)
# bottom edge of the body in side view: air dam, sill, rear valance
Y_BOT = Curve([(-2.40, 0.40), (-2.37, 0.375), (-2.33, 0.353), (-2.25, 0.329), (-2.10, 0.297), (-1.90, 0.252), (-1.70, 0.25),
               (-0.95, 0.24), (-0.86, 0.233), (0.86, 0.233), (1.0, 0.245), (1.65, 0.262), (1.80, 0.250), (2.0, 0.243),
               (2.12, 0.248), (2.17, 0.262), (2.20, 0.30)], sigma=0.012)
TUCK = Curve([(-2.4, 0.03), (-1.8, 0.035), (-0.9, 0.045), (0.9, 0.045), (1.8, 0.035), (2.2, 0.03)], sigma=0.05)
# wing crest / waist shoulder / rear haunch: height and lateral position
Y_CREST = Curve([(-2.40, 0.788), (-2.37, 0.790), (-2.33, 0.792), (-2.25, 0.805), (-2.10, 0.836), (-1.90, 0.867), (-1.60, 0.887),
                 (-1.30, 0.897), (-0.90, 0.902), (0.0, 0.902), (0.40, 0.900), (0.75, 0.894), (1.20, 0.872), (1.50, 0.852),
                 (1.70, 0.830), (1.85, 0.806), (2.00, 0.786), (2.15, 0.762), (2.22, 0.75)], sigma=0.03)
Z_CREST = Curve([(-2.40, 0.765), (-2.30, 0.780), (-2.0, 0.815), (-1.6, 0.850), (-0.9, 0.862), (0.4, 0.866), (1.2, 0.862),
                 (1.8, 0.850), (2.0, 0.835), (2.22, 0.80)], sigma=0.05)
# inboard of the crest: + falls to a valley (bonnet sides, boot), - rises (the shelf up to the side glass)
DIP = Curve([(-2.40, 0.012), (-1.6, 0.010), (-1.2, 0.0), (-0.9, -0.014), (0.30, -0.014), (0.70, 0.010), (0.9, 0.011), (1.6, 0.005),
             (2.22, 0.0)], sigma=0.08)
W_DIP = Curve([(-2.4, 0.10), (2.2, 0.10)], sigma=0.0)
# bonnet: centre-line height without the bulge, and half width of its crown
Y_BONNET = Curve([(0.40, 0.880), (0.60, 0.877), (1.00, 0.868), (1.40, 0.853), (1.79, 0.832), (1.90, 0.824), (2.00, 0.806),
                  (2.086, 0.785), (2.15, 0.765), (2.22, 0.750)], sigma=0.02)
Z_BONNET = Curve([(0.4, 0.62), (1.4, 0.60), (2.2, 0.55)], sigma=0.05)
# power bulge: top line and half width; its blanked-off mouth faces forward at BULGE_X
BULGE_Y = Curve([(0.45, 0.952), (0.62, 0.944), (0.75, 0.934), (1.00, 0.921), (1.30, 0.905), (1.50, 0.893), (1.70, 0.882),
                 (1.80, 0.876)], sigma=0.02)
BULGE_W = Curve([(0.45, 0.258), (1.0, 0.254), (1.8, 0.240)], sigma=0.03)
BULGE_X = 1.790
# cabin + fastback volume: foot line in plan, roof / fastback / boot centre line, side lean, crown, blends
Z_FOOT = Curve([(0.75, 0.775), (0.375, 0.767), (0.0, 0.757), (-0.9, 0.752), (-1.2, 0.740), (-1.5, 0.725), (-1.75, 0.710),
                (-2.0, 0.700), (-2.3, 0.690), (-2.42, 0.680)], sigma=0.02)
Y_TOP = Curve([(0.75, 0.90), (0.50, 0.99), (0.30, 1.09), (0.10, 1.20), (0.0, 1.26), (-0.07, 1.300), (-0.15, 1.312),
               (-0.30, 1.322), (-0.45, 1.324), (-0.60, 1.322), (-0.75, 1.312), (-0.90, 1.297), (-1.05, 1.268), (-1.20, 1.228),
               (-1.35, 1.180), (-1.50, 1.134), (-1.65, 1.086), (-1.80, 1.036), (-1.95, 0.976), (-2.05, 0.937), (-2.15, 0.898),
               (-2.22, 0.880), (-2.28, 0.879), (-2.33, 0.884), (-2.37, 0.887), (-2.42, 0.887)], sigma=0.02)
COT = Curve([(0.75, 3.7), (-0.9, 3.7), (-1.2, 3.4), (-1.6, 2.8), (-1.8, 2.2), (-2.0, 1.4), (-2.2, 0.9), (-2.42, 0.8)], sigma=0.05)
Z_ROOF = Curve([(0.75, 0.70), (-0.9, 0.70), (-1.4, 0.68), (-1.8, 0.66), (-2.42, 0.66)], sigma=0.05)
CROWN = Curve([(0.75, 0.032), (-0.9, 0.034), (-1.5, 0.040), (-2.0, 0.045), (-2.42, 0.040)], sigma=0.05)
K_ROOF = Curve([(0.75, 0.035), (-0.9, 0.040), (-1.5, 0.060), (-2.0, 0.080), (-2.42, 0.060)], sigma=0.05)
K_BASE = Curve([(0.75, 0.010), (-0.95, 0.010), (-1.3, 0.025), (-1.8, 0.040), (-2.42, 0.030)], sigma=0.05)

# nose and tail faces in plan (the bumper blades sit ~25 mm proud of them)
_FACE = Curve([(0.0, 2.188), (0.20, 2.176), (0.37, 2.150), (0.57, 2.122), (0.716, 2.096), (0.80, 2.070), (0.84, 2.045),
               (0.86, 2.020), (0.875, 1.980), (0.90, 1.90), (0.95, 1.75)], sigma=0.015)
_TAILF = Curve([(0.0, -2.368), (0.40, -2.364), (0.60, -2.355), (0.72, -2.342), (0.775, -2.325), (0.80, -2.300), (0.82, -2.260),
                (0.835, -2.200), (0.845, -2.120), (0.87, -1.95), (0.95, -1.70)], sigma=0.015)
NOSE_W, NOSE_Y0 = 0.035, 0.25       # the nose lip rolls over this distance down to the vertical face; face bottom height
TAIL_W, TAIL_Y0 = 0.030, 0.36
COWL = None


# ------------------------------------------------------------------------------ surfaces
def x_face(z):
    """Plan position of the nose face."""
    return _FACE(np.abs(z))


def x_tail(z):
    return _TAILF(np.abs(z))


def nose_roll(x, z):
    """Factor (1 -> 0) that rolls every height above the face bottom down into the nose face."""
    t = np.clip((x - (x_face(z) - NOSE_W)) / NOSE_W, 0, 1)
    return (1 - t ** 2.2) ** (1 / 2.2)


def tail_roll(x, z):
    t = np.clip(((x_tail(z) + TAIL_W) - x) / TAIL_W, 0, 1)
    return (1 - t ** 2.5) ** (1 / 2.5)


def end_roll(x, z, y):
    """Apply the nose/tail roll-over to heights y at lateral positions z of station x.
    Returns (y, keep): points with keep False lie beyond the face and are not part of the body."""
    keep = np.ones(np.shape(y), dtype=bool)
    if x > 1.70:
        r = nose_roll(x, z)
        y = np.where(y > NOSE_Y0, NOSE_Y0 + (y - NOSE_Y0) * r, y)
        keep &= r > 1e-4
    if x < -1.90:
        r = tail_roll(x, z)
        y = np.where(y > TAIL_Y0, TAIL_Y0 + (y - TAIL_Y0) * r, y)
        keep &= r > 1e-4
    return y, keep


def cowl_clip(x, z):
    """The V8 has no headlamp cowls: nothing is clipped."""
    return np.full(np.shape(z), 9.0)


def h_low(x, z):
    """Wing tops, bonnet and power bulge (front); waist shelf (cabin); haunches and boot (rear)."""
    az = np.abs(z)
    zc, yc = float(Z_CREST(x)), float(Y_CREST(x))
    dip, wd = float(DIP(x)), float(W_DIP(x))
    y = yc - dip * sm(0.0, wd, zc - az)
    if x > 0.30:
        yb, zb = float(Y_BONNET(x)), float(Z_BONNET(x))
        rise = (yb - (yc - dip)) * float(sm(0.30, 0.50, x))
        g = np.where(az < zb, 0.5 * (1 + np.cos(np.pi * np.clip(az / zb, 0, 1))), 0.0)
        y = y + rise * g
        if 0.35 < x < BULGE_X + 0.02:
            yt, bw = float(BULGE_Y(x)), float(BULGE_W(x))
            hb = np.maximum(yt - y, 0.0) * (1 - sm(bw - 0.045, bw + 0.004, az))
            y = y + hb * float(1 - sm(BULGE_X - 0.008, BULGE_X + 0.006, x))
    return y


def windscreen(x, z):
    """Curved screen as a height over (x, z): ruled between the base and header curves, slightly barrelled."""
    az = np.abs(z)
    xb = 0.570 - 0.195 * (az / 0.767) ** 2.0
    yb = 0.952 - 0.034 * (az / 0.767) ** 2
    xh = -0.100 + 0.010 * (az / 0.716) ** 2
    yh = 1.306 - 0.026 * (az / 0.716) ** 2
    t = (xb - x) / (xb - xh)
    tc = np.clip(t, 0, 1)
    return yb + t * (yh - yb) + 0.010 * 4 * tc * (1 - tc)


def h_up(x, z):
    """Cabin and fastback: side glass / sail planes leaning in, blended into the crowned roof and boot lid."""
    az = np.abs(z)
    zf = float(Z_FOOT(x))
    base = float(Y_CREST(x)) - float(DIP(x))
    side = base + (zf - az) * float(COT(x))
    roof = float(Y_TOP(x)) - float(CROWN(x)) * (az / float(Z_ROOF(x))) ** 2.1
    return smin(roof, side, float(K_ROOF(x)))


def top_raw(x, z):
    lo = h_low(x, z)
    if x > 0.75 or x < -2.42:
        return lo
    up = smin(h_up(x, z), windscreen(x, z), 0.03) if x > -0.25 else h_up(x, z)
    return smax(lo, up, float(K_BASE(x)))


def top(x, z):
    """Top surface height with the nose/tail roll-over applied (no fillets)."""
    z = np.asarray(z, dtype=float)
    return end_roll(x, z, top_raw(x, z))[0]


def _bezier(p0, c0, c1, p1, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c0 + 3 * (1 - t) * t ** 2 * c1 + t ** 3 * p1


def lower(x, n1=70, n2=110):
    """Flank and shoulder of station x: from the bottom edge up to the wing crest (z, y pairs)."""
    zm, ym = float(Z_MAX(x)), float(Y_MAXW(x))
    yb = float(Y_BOT(x))
    zc = min(float(Z_CREST(x)), zm - 0.035)
    yc = float(h_low(x, np.array([zc]))[0])
    ym = min(max(ym, yb + 0.05), yc - 0.06)
    p0 = np.array([zm - float(TUCK(x)), yb])
    m = np.array([zm, ym])
    c = np.array([zc, yc])
    ch = np.linalg.norm(m - p0)
    d0 = np.array([0.45, 0.89])
    flank = _bezier(p0, p0 + d0 * ch * 0.42, m - np.array([0, 1]) * ch * 0.46, m, n1)
    ky, kz = 0.66, 0.56
    sh = _bezier(m, m + np.array([0, ky * (yc - ym)]), c + np.array([kz * (zm - zc), 0]), c, n2)
    return flank, sh, zc


def _smooth(p, r):
    """Moving average along arclength with per-point radius r; closed at both ends by mirroring about z = 0."""
    n = len(p)
    d = np.linalg.norm(np.diff(p, axis=0), axis=1)
    step = max(d.mean(), 1e-6)
    pad = min(int(np.ceil(r.max() / step)) + 2, n - 2)
    if pad < 2:
        return p
    head = p[1:pad + 1][::-1] * np.array([-1.0, 1.0])
    tail = p[-pad - 1:-1][::-1] * np.array([-1.0, 1.0])
    q = np.vstack([head, p, tail])
    c = np.vstack([np.zeros((1, 2)), np.cumsum(q, axis=0)])
    w = np.clip(np.round(r / step).astype(int), 1, pad - 1)
    i = np.arange(n) + pad
    return (c[i + w + 1] - c[i - w]) / (2 * w + 1)[:, None]


def _resample(p, n, adaptive=False):
    d = np.linalg.norm(np.diff(p, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    keep = np.concatenate([[True], d > 1e-9])
    s, p = s[keep], p[keep]
    if adaptive and len(p) > 8:
        # more points where the section bends, fewer on flat stretches (belly, flank)
        t = np.gradient(p, s, axis=0)
        ang = np.unwrap(np.arctan2(t[:, 1], t[:, 0]))
        kap = np.abs(np.gradient(ang, s))
        kap = np.convolve(np.pad(kap, 12, mode='edge'), np.ones(25) / 25, mode='valid')
        w = 0.22 + np.clip(kap * 0.05, 0, 1.6)
        q = np.concatenate([[0], np.cumsum((w[1:] + w[:-1]) * 0.5 * np.diff(s))])
        su = np.interp(np.linspace(0, q[-1], n), q, s)
    else:
        su = np.linspace(0, s[-1], n)
    return np.stack([np.interp(su, s, p[:, 0]), np.interp(su, s, p[:, 1])], axis=1)


def section(x, n=None, dense=900, fillet=True, cowl=True):
    """Closed half-section at station x: from the centre of the belly round to the centre of the roof."""
    yb = float(Y_BOT(x))
    flank, sh, zc = lower(x)
    zt = np.linspace(zc, 0.0, 260)[1:]
    tp = np.stack([zt, top_raw(x, zt)], axis=1)
    up = np.vstack([flank, sh[1:], tp])
    # nose / tail roll-over, then the headlamp cowl plane
    up[:, 1], keep = end_roll(x, up[:, 0], up[:, 1])
    up = up[keep]
    if len(up) < 3:
        return None
    if up[-1, 0] > 0.02:
        return None
    before = up[:, 1].copy()
    if x > 1.55 and cowl:
        up[:, 1] = np.minimum(up[:, 1], cowl_clip(x, up[:, 0]))
    clipped = up[:, 1] < before - 1e-6
    ok = up[:, 1] > yb + 1e-4
    if not ok.any():
        return None
    k0 = int(np.argmax(ok))
    up, clipped = up[k0:], clipped[k0:]
    up[0, 1] = max(up[0, 1], yb)
    z0 = up[0, 0]
    belly = np.stack([np.linspace(0, z0, 40), np.full(40, yb)], axis=1)
    pts = np.vstack([belly[:-1], up])
    p = _resample(pts, dense)
    if fillet:
        # fillet radius: 9 mm everywhere, more round the bottom corner and where a clip surface cuts in
        su = np.linspace(0, 1, dense)
        ck = np.concatenate([np.zeros(39, bool), clipped])
        dd = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        sp = np.concatenate([[0], np.cumsum(dd)])
        cs = np.interp(su * sp[-1], sp, ck.astype(float))
        edge = np.convolve((np.abs(np.gradient(cs)) > 1e-4).astype(float), np.ones(31), mode='same') > 0
        r = np.full(dense, 0.012)
        r = np.where(np.abs(su * sp[-1] - sp[39]) < 0.05, 0.03, r)
        # the V8's shoulder: a soft radius where the flank Bezier meets the top surface at the crest
        zc_, yc_ = float(min(Z_CREST(x), Z_MAX(x) - 0.035)), float(h_low(x, np.array([min(Z_CREST(x), Z_MAX(x) - 0.035)]))[0])
        ic = int(np.argmin(np.hypot(pts[:, 0] - zc_, pts[:, 1] - yc_)))
        r = np.where(np.abs(su * sp[-1] - sp[ic]) < 0.10, np.maximum(r, 0.045), r)
        for _ in range(2):
            p = _smooth(p, r * 0.7)
        p[0, 0] = 0.0
        p[-1, 0] = 0.0
    # even spacing along the section: the V8's tight shoulder made curvature-weighted spacing jump between stations
    return _resample(p, n, adaptive=False) if n else p


def stations(nu):
    """Station positions, denser where the profile is steep or detailed (nose, tail, screen)."""
    xs = np.linspace(X_TAIL - 0.0005, X_NOSE - 0.0008, 6000)
    yc = np.array([float(top(x, np.array([0.0]))[0]) for x in xs])
    w = np.hypot(np.gradient(xs), np.gradient(yc))
    w = w * (1 + 1.5 * sm(1.95, 2.10, xs) + 1.0 * sm(-2.15, -2.3, xs) + 0.6 * sm(1.70, 1.80, xs) * sm(1.86, 1.80, xs)) + 0.0004
    s = np.cumsum(w)
    return np.interp(np.linspace(s[0], s[-1], nu), s, xs)


def body_grid(nu=230, nv=110):
    """P[nu, nv, 3]: right half of the skin, station by station from the tail to the nose."""
    xs = stations(nu)
    P = np.zeros((nu, nv, 3))
    for i, x in enumerate(xs):
        sec = section(float(x), nv)
        if sec is None:
            sec = np.stack([np.zeros(nv), np.full(nv, float(Y_BOT(x)))], axis=1)
        P[i, :, 0] = x
        P[i, :, 1] = sec[:, 1]
        P[i, :, 2] = np.maximum(sec[:, 0], 0.0)
    return P, xs


# ------------------------------------------------------------------------------ queries used by the detail parts
_SEC = {}


def _sec_k(k, cowl=True):
    key = (k, cowl)
    if key not in _SEC:
        _SEC[key] = section(k * 0.005, 400, cowl=cowl)
    return _SEC[key]


def sec_at(x, cowl=True):
    """Dense half-section at x, interpolated between stations cached every 5 mm (continuous in x)."""
    f = x / 0.005
    k = int(np.floor(f))
    a, b = _sec_k(k, cowl), _sec_k(k + 1, cowl)
    if a is None or b is None:
        return a if b is None else b
    t = f - k
    return a * (1 - t) + b * t


def _top_of(p, az, ybot):
    a, b = p[:-1], p[1:]
    m = ((a[:, 0] - az) * (b[:, 0] - az) <= 0) & (np.abs(a[:, 0] - b[:, 0]) > 1e-9)
    if not m.any():
        return float(p[:, 1].max()) if az < 1e-6 else ybot
    t = (az - a[m, 0]) / (b[m, 0] - a[m, 0])
    return float((a[m, 1] + t * (b[m, 1] - a[m, 1])).max())


def _side_of(p, y):
    a, b = p[:-1], p[1:]
    m = ((a[:, 1] - y) * (b[:, 1] - y) <= 0) & (np.abs(a[:, 1] - b[:, 1]) > 1e-9)
    if not m.any():
        return 0.0
    t = (y - a[m, 1]) / (b[m, 1] - a[m, 1])
    return float((a[m, 0] + t * (b[m, 0] - a[m, 0])).max())


def inside_nocowl(x, y, z):
    """Inside the body as it would be without the headlamp cowl planes (the uncut wing)."""
    if x >= X_NOSE or x <= X_TAIL:
        return False
    p = sec_at(x, cowl=False)
    if p is None or y < p[0, 1]:
        return False
    return abs(z) < _side_of(p, y) and y < _top_of(p, abs(z), float(Y_BOT(x)))


def top_y(x, z):
    """Height of the skin above lateral position z at station x."""
    p = sec_at(x)
    if p is None:
        return float(Y_BOT(x))
    az = abs(z)
    a, b = p[:-1], p[1:]
    m = ((a[:, 0] - az) * (b[:, 0] - az) <= 0) & (np.abs(a[:, 0] - b[:, 0]) > 1e-9)
    if not m.any():
        return float(p[:, 1].max()) if az < 1e-6 else float(Y_BOT(x))
    t = (az - a[m, 0]) / (b[m, 0] - a[m, 0])
    return float((a[m, 1] + t * (b[m, 1] - a[m, 1])).max())


def side_z(x, y):
    """Half width of the body at height y at station x."""
    p = sec_at(x)
    if p is None:
        return 0.0
    a, b = p[:-1], p[1:]
    m = ((a[:, 1] - y) * (b[:, 1] - y) <= 0) & (np.abs(a[:, 1] - b[:, 1]) > 1e-9)
    if not m.any():
        return 0.0
    t = (y - a[m, 1]) / (b[m, 1] - a[m, 1])
    return float((a[m, 0] + t * (b[m, 0] - a[m, 0])).max())


def inside(x, y, z):
    if x >= X_NOSE or x <= X_TAIL:
        return False
    p = sec_at(x)
    if p is None or y < p[0, 1]:
        return False
    return abs(z) < side_z(x, y) and y < top_y(x, z)


def surf_x(z, y, front=True):
    """x of the nose (front) or tail surface at lateral position z and height y."""
    lo, hi = (1.5, X_NOSE + 0.02) if front else (-1.8, X_TAIL - 0.02)
    for _ in range(26):
        m = (lo + hi) / 2
        if inside(m, y, z):
            lo = m
        else:
            hi = m
    return lo


def outline(y, cx, a0, a1, n):
    """Plan outline of the body at height y: rays from (cx, 0) at angles a0..a1 (0 = straight ahead)."""
    out = []
    for a in np.linspace(a0, a1, n):
        dx, dz = np.cos(a), np.sin(a)
        lo, hi = 0.0, 2.2
        for _ in range(28):
            m = (lo + hi) / 2
            if inside(cx + dx * m, y, dz * m):
                lo = m
            else:
                hi = m
        out.append((cx + dx * lo, y, dz * lo))
    return np.array(out)
