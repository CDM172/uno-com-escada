# Aston Martin DB5 (1963-65) — body surface, version 2: fitted to measured curves.
#
# Car frame (same as the game): origin on the ground under the middle of the wheelbase,
# X forward, Y up, Z to the right; metres. Only the right half (z >= 0) is generated.
#
# Where the numbers come from:
#  * FIA/RAC homologation form no. 186: wheelbase 2.489, tracks 1.378/1.359, length 4.572, width 1.676,
#    height 1.32, windscreen 1.35 wide at the base and 1.17 at the top, 6.70x15 tyres on 15 in wire wheels.
#  * Scale drawings (getoutlines.com, CC BY 4.0), read pixel by pixel: side view for the profile lines
#    (roof, fastback, bonnet, wing crest, waist, sill, valances, window outline, door cuts, wheel arches),
#    plan view for the widths (body outline, cabin "teardrop", bonnet, windscreen wrap), front/rear views
#    for the lateral position of lamps, grille and boot lid.
#  * Reference photographs for the cross-section character (rolled shoulders, wing crests and the valleys
#    that run down to the grille corners, headlamp nacelles, tail fins).
#
# Construction: every station (constant x) is a closed half-section made of
#   belly -> flank -> shoulder (parametric Bezier arcs up to the wing crest) -> top (a height field
#   y = top(x, z) from the crest to the centre line),
# clipped by the nose face, the tail face and the two headlamp cowl planes, with small fillets where
# surfaces meet. The top is the wing/bonnet/shelf surface with the cabin + fastback volume blended on.
import numpy as np

AXF, AXR = 1.2445, -1.2445          # axles
WHEEL_R = 0.338
HUB_ZF, HUB_ZR = 0.689, 0.6795      # half tracks, front / rear
HUB_Z = HUB_ZF
BELT = 0.884                        # waist line: bottom of the side glass
ROOF = 1.330
X_NOSE, X_TAIL = 1.935, -2.378      # body ends (without bumpers)


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
# plan outline: half width at the widest height
Z_MAX = Curve([(-2.45, 0.735), (-2.30, 0.765), (-2.204, 0.775), (-2.027, 0.783), (-1.658, 0.798), (-1.288, 0.821), (-0.90, 0.835),
               (-0.50, 0.838), (1.20, 0.838), (1.37, 0.836), (1.52, 0.824), (1.67, 0.814), (1.78, 0.805), (1.85, 0.797), (1.90, 0.785),
               (1.93, 0.765), (1.95, 0.74)], sigma=0.012)
# height of the widest point of the flank
Y_MAXW = Curve([(-2.4, 0.66), (-1.7, 0.66), (-0.9, 0.615), (0.35, 0.615), (0.9, 0.68), (1.6, 0.70), (1.95, 0.64)], sigma=0.08)
# bottom edge of the body in side view: sill, valances
Y_BOT = Curve([(-2.40, 0.50), (-2.375, 0.47), (-2.322, 0.368), (-2.195, 0.331), (-2.036, 0.297), (-1.878, 0.276), (-1.719, 0.263),
               (-1.60, 0.245), (-0.85, 0.2206), (0.86, 0.2206), (1.00, 0.228), (1.627, 0.270), (1.779, 0.319), (1.86, 0.365),
               (1.905, 0.40), (1.935, 0.45), (1.96, 0.47)], sigma=0.012)
TUCK = Curve([(-2.4, 0.13), (-2.0, 0.115), (-1.6, 0.075), (-0.85, 0.062), (0.86, 0.062), (1.5, 0.075), (1.8, 0.10), (1.95, 0.105)], sigma=0.06)
# wing crest / waist line / fin: height and lateral position
Y_CREST = Curve([(-2.42, 0.831), (-2.373, 0.833), (-2.20, 0.841), (-1.573, 0.864), (-1.20, 0.876), (-0.85, 0.883), (0.0, 0.885),
                 (0.35, 0.888), (0.44, 0.895), (0.66, 0.895), (0.98, 0.885), (1.30, 0.870), (1.55, 0.842), (1.615, 0.836),
                 (1.70, 0.826), (1.80, 0.812), (1.95, 0.790)], sigma=0.04)
Z_CREST = Curve([(-2.42, 0.665), (-2.0, 0.685), (-1.3, 0.705), (-0.9, 0.715), (0.30, 0.715), (0.60, 0.700), (1.0, 0.686), (1.5, 0.672),
                 (1.8, 0.660), (1.95, 0.650)], sigma=0.06)
# valley / shelf inboard of the crest: depth below the crest and width of the fall
DIP = Curve([(-2.42, 0.040), (-2.1, 0.040), (-1.7, 0.030), (-1.3, 0.018), (-1.1, 0.008), (-0.9, 0.0), (0.30, 0.0), (0.45, 0.012), (0.7, 0.022),
             (1.0, 0.028), (1.3, 0.034), (1.55, 0.045), (1.70, 0.075), (1.80, 0.100), (1.88, 0.130), (1.95, 0.14)], sigma=0.03)
W_DIP = Curve([(-2.42, 0.10), (-1.3, 0.09), (-0.9, 0.06), (0.3, 0.06), (0.45, 0.13), (1.0, 0.15), (1.5, 0.15), (1.8, 0.125), (1.95, 0.12)], sigma=0.05)
# bonnet: centre-line height (without the power bulge) and half width of its crown
Y_BONNET = Curve([(0.0, 0.972), (0.42, 0.970), (0.66, 0.961), (0.98, 0.942), (1.30, 0.897), (1.455, 0.875), (1.58, 0.855), (1.68, 0.833),
                  (1.74, 0.812), (1.805, 0.793), (1.87, 0.762), (1.894, 0.745), (1.95, 0.72)], sigma=0.03)
Z_BONNET = Curve([(0.0, 0.62), (0.45, 0.61), (1.0, 0.53), (1.5, 0.45), (1.75, 0.37), (1.95, 0.30)], sigma=0.06)
# cabin + fastback volume: foot line in plan (glass base, then the "teardrop" around the boot lid)
Z_FOOT = Curve([(0.9, 0.685), (0.22, 0.685), (-0.03, 0.683), (-0.60, 0.682), (-0.90, 0.672), (-1.0, 0.652), (-1.214, 0.616),
                (-1.436, 0.600), (-1.584, 0.593), (-1.731, 0.570), (-1.85, 0.547), (-1.953, 0.517), (-2.027, 0.486), (-2.10, 0.440),
                (-2.175, 0.372), (-2.22, 0.296), (-2.249, 0.20), (-2.262, 0.0)], sigma=0.012)
# roof / fastback centre line (ahead of the header it keeps falling: the windscreen surface clips it)
Y_TOP = Curve([(0.9, 0.90), (0.50, 1.05), (0.30, 1.170), (0.20, 1.232), (0.129, 1.276), (0.10, 1.290), (0.05, 1.310), (0.0, 1.322),
               (-0.10, 1.329), (-0.35, 1.330), (-0.60, 1.328), (-0.80, 1.315), (-1.00, 1.285), (-1.15, 1.250), (-1.25, 1.214),
               (-1.40, 1.156), (-1.55, 1.099), (-1.70, 1.042), (-1.85, 0.980), (-2.00, 0.915), (-2.10, 0.875), (-2.20, 0.842),
               (-2.262, 0.818), (-2.35, 0.79)], sigma=0.03)
COT = Curve([(0.9, 4.2), (-0.9, 4.2), (-1.2, 3.4), (-1.45, 2.3), (-1.7, 1.25), (-1.9, 0.70), (-2.05, 0.40), (-2.2, 0.25), (-2.35, 0.2)], sigma=0.06)
Z_ROOF = Curve([(0.9, 0.60), (0.05, 0.60), (-0.9, 0.593), (-1.2, 0.565), (-1.5, 0.51), (-1.8, 0.43), (-2.05, 0.31), (-2.2, 0.18), (-2.35, 0.1)], sigma=0.06)
CROWN = Curve([(0.9, 0.078), (-0.9, 0.080), (-1.5, 0.065), (-2.0, 0.035), (-2.35, 0.010)], sigma=0.08)
K_ROOF = Curve([(0.9, 0.10), (-0.9, 0.10), (-1.3, 0.11), (-1.7, 0.14), (-2.0, 0.18), (-2.35, 0.10)], sigma=0.08)
K_BASE = Curve([(0.9, 0.012), (-0.95, 0.012), (-1.3, 0.04), (-1.7, 0.09), (-2.1, 0.10), (-2.35, 0.05)], sigma=0.06)

SCOOP_X, SCOOP_H, SCOOP_Z = 1.60, 0.037, 0.198     # power bulge: opening position, height, half width
COWL = dict(x0=1.937, y0=0.560, slope=2.4, zin=0.552, zc=0.650)   # headlamp cowl plane


# ------------------------------------------------------------------------------ surfaces
def x_face(z):
    """Plan position of the nose face (lower, vertical part)."""
    q = np.clip(np.abs(z) / 0.83, 0, 0.999999)
    # flat across to the lamps, then tight corners (triangulated from the reference photographs)
    return 1.50 + 0.435 * (1 - q ** 9.0) ** (1 / 9.0)


def x_tail(z):
    q = np.clip(np.abs(z) / 0.79, 0, 0.999999)
    return -1.95 - 0.428 * (1 - q ** 7.0) ** (1 / 7.0)


NOSE_W, NOSE_Y0 = 0.067, 0.45      # the nose lip rolls over this distance down to the vertical face; face bottom height
TAIL_W, TAIL_Y0 = 0.032, 0.47


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
    if x > 1.55:
        r = nose_roll(x, z)
        y = np.where(y > NOSE_Y0, NOSE_Y0 + (y - NOSE_Y0) * r, y)
        keep &= r > 1e-4
    if x < -2.2:
        r = tail_roll(x, z)
        y = np.where(y > TAIL_Y0, TAIL_Y0 + (y - TAIL_Y0) * r, y)
        keep &= r > 1e-4
    return y, keep


def cowl_clip(x, z):
    """Oblique plane that cuts the front of each wing: the headlamp aperture lies in it."""
    az = np.abs(z)
    y = COWL['y0'] + (COWL['x0'] - x) * COWL['slope']
    return y + 7.0 * np.maximum(COWL['zin'] - az, 0.0) + 0.6 * np.maximum(az - 0.745, 0.0)


def h_low(x, z):
    """Wing top, valley and bonnet (front); waist ledge (cabin); fin and shelf (rear)."""
    az = np.abs(z)
    zc, yc = float(Z_CREST(x)), float(Y_CREST(x))
    dip, wd = float(DIP(x)), float(W_DIP(x))
    y = yc - dip * sm(0.0, wd, zc - az)
    if x > -0.2:
        yb, zb = float(Y_BONNET(x)), float(Z_BONNET(x))
        rise = (yb - (yc - dip)) * float(sm(-0.2, 0.25, x))
        g = np.where(az < zb, 0.5 * (1 + np.cos(np.pi * np.clip(az / zb, 0, 1))), 0.0)
        y = y + rise * g
        # power bulge with its forward-facing intake
        hb = SCOOP_H * float(sm(0.75, 1.45, x)) * float(sm(SCOOP_X + 0.007, SCOOP_X - 0.007, x))
        y = y + hb * (1 - sm(SCOOP_Z - 0.035, SCOOP_Z + 0.02, az))
    return y


def windscreen(x, z):
    """Curved screen as a height over (x, z): ruled between the base and header curves, slightly barrelled."""
    az = np.abs(z)
    xb = 0.42 - 0.24 * (az / 0.68) ** 2.2
    yb = 0.970 - 0.072 * (az / 0.68) ** 2
    xh = 0.129 - 0.125 * (az / 0.60) ** 2
    yh = 1.274 - 0.050 * (az / 0.60) ** 2
    t = (xb - x) / (xb - xh)
    tc = np.clip(t, 0, 1)
    return yb + t * (yh - yb) + 0.014 * 4 * tc * (1 - tc)


def h_up(x, z):
    """Cabin and fastback: side glass plane leaning in, blended into the crowned roof."""
    az = np.abs(z)
    zf = float(Z_FOOT(x))
    base = float(Y_CREST(x)) - float(DIP(x))
    side = base + (zf - az) * float(COT(x))
    roof = float(Y_TOP(x)) - float(CROWN(x)) * (az / float(Z_ROOF(x))) ** 2.1
    return smin(roof, side, float(K_ROOF(x)))


def top_raw(x, z):
    lo = h_low(x, z)
    if x > 0.95 or x < -2.30:
        return lo
    up = smin(h_up(x, z), windscreen(x, z), 0.03) if x > -0.3 else h_up(x, z)
    return smax(lo, up, float(K_BASE(x)))


def top(x, z):
    """Top surface height with the cowl planes and the nose/tail roll-over applied (no fillets)."""
    z = np.asarray(z, dtype=float)
    y = end_roll(x, z, top_raw(x, z))[0]
    if x > 1.55:
        y = np.minimum(y, cowl_clip(x, z))
    return y


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
    ky, kz = 0.54, 0.50
    sh = _bezier(m, m + np.array([0, ky * (yc - ym)]), c + np.array([kz * (zm - zc), 0]), c, n2)
    return flank, sh, zc


def _smooth(p, r):
    """Moving average along arclength with per-point radius r; closed at both ends by mirroring about z = 0."""
    n = len(p)
    d = np.linalg.norm(np.diff(p, axis=0), axis=1)
    step = max(d.mean(), 1e-6)
    pad = int(np.ceil(r.max() / step)) + 2
    head = p[1:pad + 1][::-1] * np.array([-1.0, 1.0])
    tail = p[-pad - 1:-1][::-1] * np.array([-1.0, 1.0])
    q = np.vstack([head, p, tail])
    c = np.vstack([np.zeros((1, 2)), np.cumsum(q, axis=0)])
    w = np.maximum(1, np.round(r / step).astype(int))
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
        for _ in range(2):
            p = _smooth(p, r * 0.7)
        p[0, 0] = 0.0
        p[-1, 0] = 0.0
    return _resample(p, n, adaptive=True) if n else p


def stations(nu):
    """Station positions, denser where the profile is steep or detailed (nose, tail, screen)."""
    xs = np.linspace(X_TAIL - 0.0005, X_NOSE - 0.0008, 6000)
    yc = np.array([float(top(x, np.array([0.0]))[0]) for x in xs])
    w = np.hypot(np.gradient(xs), np.gradient(yc))
    w = w * (1 + 1.5 * sm(1.55, 1.75, xs) + 1.0 * sm(-2.15, -2.3, xs)) + 0.0004
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
    lo, hi = (1.2, X_NOSE + 0.02) if front else (-1.6, X_TAIL - 0.02)
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
