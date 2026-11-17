# Measured outlines of the DB5, as signed fields (negative = inside): wheel arches, glass, lamp apertures,
# grille mouth, vents and the panel shut lines. Shared by the body builder and the detail parts.
import math

import numpy as np

import db5_lib as L
import db5_shape as S
from db5_lib import rrect

# All outlines below were read off the scale drawings (see db5_shape.py) and converted to metres.
B = S.BELT


def csmax(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return max(a, b) + h * h * k * 0.25


def fsm(a, b, x):
    return float(S.sm(a, b, x))


# --- wheel arches (side view). Front: slightly flattened circle about the hub. Rear: flat-topped, swept back.
_RA = np.radians([-30, -11.4, -2.7, 8.5, 20.5, 33.4, 45.2, 55.2, 66, 72.5, 90, 113, 120.6, 130.7, 142.9, 155.8, 170, 182.4, 188.9, 215])
_RR = np.array([0.43, 0.403, 0.389, 0.374, 0.368, 0.367, 0.362, 0.358, 0.349, 0.344, 0.328, 0.356, 0.371, 0.388, 0.396, 0.402, 0.418, 0.437, 0.48, 0.60])


def f_arch(p):
    fr = (math.hypot((p.x - S.AXF) / 0.385, (p.y - 0.337) / 0.365) - 1.0) * 0.37
    dx, dy = p.x - S.AXR, p.y - 0.337
    th = math.atan2(dy, dx)
    if th < math.radians(-90):
        th += math.tau
    rr = math.hypot(dx, dy) - float(np.interp(th, _RA, _RR))
    return min(fr, rr)


def f_well(p):
    """Belly cut-outs under the wheels."""
    return min(max(abs(p.x - S.AXF) - 0.40, 0.44 - abs(p.z)), max(abs(p.x + 1.265) - 0.43, 0.44 - abs(p.z)))


# --- side glass: door glass + quarter light, one outline (inner glass edge), split by the B post
SIDE_WIN = L.RasterField([(0.060, 0.896), (-1.445, 0.896), (-1.485, 0.906), (-1.478, 0.918), (-1.421, 0.968), (-1.338, 1.023), (-1.243, 1.075),
                          (-1.116, 1.127), (-0.989, 1.161), (-0.894, 1.176), (-0.608, 1.176), (-0.290, 1.179), (-0.138, 1.186), (-0.081, 1.152)], r=0.028)


def f_side(p):
    return SIDE_WIN(p.x, p.y)


def f_bpost(p):
    return abs(p.x - (-0.808 - 0.153 * (p.y - 0.888))) - 0.019


# --- windscreen: outline in the screen's own coordinates (distance up the glass, lateral position)
def ws_coords(p):
    az = abs(p.z)
    xb, yb = 0.42 - 0.24 * (az / 0.68) ** 2.2, 0.970 - 0.072 * (az / 0.68) ** 2
    xh, yh = 0.129 - 0.125 * (az / 0.60) ** 2, 1.274 - 0.050 * (az / 0.60) ** 2
    t = (xb - p.x) / (xb - xh)
    return t, math.hypot(xb - xh, yh - yb)


def f_windscreen(p):
    if p.x < -0.2 or p.x > 0.55 or p.y < 0.88:
        return 1.0
    t, ln = ws_coords(p)
    s = t * ln
    return csmax(csmax(0.034 - s, s - (ln - 0.030), 0.05), abs(p.z) - (0.640 - 0.070 * t), 0.075)


# --- rear window (plan view outline on the fastback)
def f_backlight(p):
    if p.x > -1.0 or p.x < -1.85 or p.y < 0.95:
        return 1.0
    az = abs(p.z)
    hw = 0.425 + 0.050 * fsm(-1.16, -1.5, p.x)
    xt = -1.165 - 0.035 * (az / 0.42) ** 2
    xbm = -1.700 + 0.150 * (az / 0.47) ** 2.5
    return csmax(csmax(az - hw, p.x - xt, 0.07), xbm - p.x, 0.10)


# --- headlamp aperture: the part of each wing cut by the cowl plane
def f_aperture(p):
    az = abs(p.z)
    if p.x < 1.55 or az < 0.52:
        return 1.0
    return float(S.cowl_clip(p.x, np.array([az]))[0]) - p.y - 0.004


# --- grille mouth on the nose (front view): wide, with the raised centre section
def f_grille(p):
    if p.x < 1.80:
        return 1.0
    z, y = abs(p.z), p.y
    top_y = 0.578 + 0.097 * (1 - fsm(0.17, 0.47, z))          # smoothly humped top edge
    return csmax(csmax(z - 0.505, 0.462 - y, 0.075), y - top_y, 0.045)


# --- wing vent: a slot with round ends
def f_vent(p):
    if abs(p.z) < 0.5:
        return 1.0
    return rrect(p.x - 0.616, p.y - 0.685, 0.160, 0.043, 0.043)


def f_roofpanel(p):
    return rrect(p.x + 0.42, p.z - 0.315, 0.26, 0.20, 0.05)


# --- shut lines (signed distance, negative inside the panel)
_arc = [(0.248 + 0.10 * math.cos(a), 0.83 + 0.10 * math.sin(a)) for a in np.linspace(math.pi / 2, 0, 9)]
DOOR = L.RasterField([(-0.853, 0.93)] + _arc + [(0.348, 0.3186), (-0.716, 0.3186)], r=0.03)
_bh = [(0.522, 0.0), (0.522, 0.570), (0.589, 0.570), (0.855, 0.532), (0.973, 0.517), (1.151, 0.479), (1.298, 0.448), (1.476, 0.410), (1.594, 0.380),
       (1.668, 0.342), (1.712, 0.281), (1.757, 0.205), (1.771, 0.0)]
BONNET = L.RasterField(_bh + [(x, -z) for x, z in reversed(_bh[1:-1])], r=0.035)
_c, _s = math.cos(math.radians(-21)), math.sin(math.radians(-21))
FLAP = L.RasterField([(-1.59 + _c * u - _s * v, 0.965 + _s * u + _c * v) for u, v in ((-0.065, -0.047), (0.065, -0.047), (0.065, 0.047), (-0.065, 0.047))], r=0.018)


def seam(p, n):
    x, y, z = p.x, p.y, abs(p.z)
    d = 1.0
    if abs(n.z) > 0.35 and y < B + 0.04 and -0.95 < x < 0.45:          # door
        d = min(d, DOOR(x, y))
    if n.y > 0.3 and x > 0.45:                                          # bonnet
        d = min(d, BONNET(x, z))
    if x < -1.6 and (n.y > 0.3 or n.x < -0.3) and z < 0.66:             # boot lid, wrapping down the tail panel
        zl = 0.555 + 0.02 * fsm(-1.8, -2.3, x)
        d = min(d, csmax(csmax(z - zl, x + 1.745, 0.06), 0.495 - y, 0.045))
    if abs(n.z) > 0.25 and x < -1.35 and y > B + 0.02:                  # fuel filler flaps on the rear pillars
        d = min(d, FLAP(x, y))
    return d
