# Measured outlines of the V8 Vantage, as signed fields (negative = inside): wheel arches, glass, nose openings,
# vents and the panel shut lines. Shared by the body builder and the detail parts.
# All outlines were read off the scale drawing (see v8_shape.py) and converted to metres.
import math

import numpy as np

import db5_lib as L
import v8_shape as S
from db5_lib import rrect

B = S.BELT


def csmax(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return max(a, b) + h * h * k * 0.25


def fsm(a, b, x):
    return float(S.sm(a, b, x))


# --- wheel arches (side view): circles about points just above the hubs, front a little larger (flared lips)
ARCH_RF, ARCH_RR = 0.392, 0.372


def f_arch(p):
    fr = math.hypot(p.x - S.AXF, p.y - S.ARCH_Y) - ARCH_RF
    rr = math.hypot(p.x - S.AXR, p.y - S.ARCH_Y) - ARCH_RR
    return min(fr, rr)


def f_well(p):
    """Belly cut-outs under the wheels."""
    return min(max(abs(p.x - S.AXF) - 0.41, 0.52 - abs(p.z)), max(abs(p.x - S.AXR) - 0.39, 0.52 - abs(p.z)))


# --- side glass: one outline (A pillar, door glass, quarter light), split by the front frame bar and the B post
SIDE_WIN = L.RasterField([(0.212, 0.922), (0.150, 0.975), (0.060, 1.054), (-0.040, 1.142), (-0.140, 1.230), (-0.300, 1.232),
                          (-0.500, 1.228), (-0.700, 1.216), (-0.845, 1.202), (-0.905, 1.183), (-1.000, 1.165), (-1.100, 1.137),
                          (-1.175, 1.110), (-1.215, 1.093), (-1.240, 1.070), (-1.238, 1.020), (-1.226, 0.968), (-1.200, 0.950),
                          (-1.000, 0.938), (-0.860, 0.930), (-0.500, 0.924), (-0.150, 0.922)], r=0.022)


def f_side(p):
    return SIDE_WIN(p.x, p.y)


def f_bar(p):
    """Front frame bar of the door glass (leans back with the A pillar)."""
    return abs(p.x - (-0.125 - 0.152 * (p.y - 0.922))) - 0.022


def f_bpost(p):
    return abs(p.x - (-0.826 - 0.176 * (p.y - 0.93))) - 0.030


# --- windscreen: outline in the screen's own coordinates (distance up the glass, lateral position)
def ws_coords(p):
    az = abs(p.z)
    xb, yb = 0.570 - 0.195 * (az / 0.767) ** 2.0, 0.952 - 0.034 * (az / 0.767) ** 2
    xh, yh = -0.100 + 0.010 * (az / 0.716) ** 2, 1.306 - 0.026 * (az / 0.716) ** 2
    t = (xb - p.x) / (xb - xh)
    return t, math.hypot(xb - xh, yh - yb)


def f_windscreen(p):
    if p.x < -0.25 or p.x > 0.62 or p.y < 0.88:
        return 1.0
    t, ln = ws_coords(p)
    s = t * ln
    return csmax(csmax(0.030 - s, s - (ln - 0.026), 0.05), abs(p.z) - (0.728 - 0.050 * t), 0.06)


# --- rear window: flat-sided pane on the fastback (plan outline)
def f_backlight(p):
    if p.x > -1.0 or p.x < -1.9 or p.y < 0.95:
        return 1.0
    az = abs(p.z)
    return csmax(csmax(az - 0.596, p.x + 1.172, 0.08), -1.738 - p.x, 0.08)


# --- nose: grille mouth (with the two driving lamps in it) and the outer headlamp bezels (front view)
HEAD_Z, HEAD_Y, HEAD_R = 0.669, 0.610, 0.097
DRIVE_Z, DRIVE_Y, DRIVE_R = 0.282, 0.607, 0.080


def f_grille(p):
    if p.x < 1.95:
        return 1.0
    z, y = abs(p.z), p.y
    top_y = 0.695 + 0.014 * (1 - fsm(0.30, 0.50, z))
    return csmax(csmax(z - 0.505, 0.513 - y, 0.06), y - top_y, 0.05)


def f_head(p):
    if p.x < 1.95:
        return 1.0
    return math.hypot(abs(p.z) - HEAD_Z, p.y - HEAD_Y) - HEAD_R


def f_intake(p):
    """The two air intakes in the front air dam."""
    if p.x < 1.95:
        return 1.0
    return rrect(abs(p.z) - 0.468, p.y - 0.378, 0.098, 0.052, 0.018)


# --- side strake behind each front wheel: a slanted slot with a chrome spear running forward from it
def f_vent(p):
    if abs(p.z) < 0.6 or not (0.45 < p.x < 1.0):
        return 1.0
    u = p.x - 0.74 - 0.55 * (p.y - 0.72)       # slanted ends
    return rrect(u, p.y - 0.719, 0.196, 0.034, 0.010)


# --- tail lamp recesses (rear view): wide rectangles either side of the boot lid
TAIL_Z0, TAIL_Z1, TAIL_Y0, TAIL_Y1 = 0.425, 0.715, 0.575, 0.674


def f_tail(p):
    if p.x > -2.1:
        return 1.0
    return rrect(abs(p.z) - (TAIL_Z0 + TAIL_Z1) / 2, p.y - (TAIL_Y0 + TAIL_Y1) / 2, (TAIL_Z1 - TAIL_Z0) / 2, (TAIL_Y1 - TAIL_Y0) / 2, 0.012)


# --- shut lines (signed distance, negative inside the panel)
DOOR = L.RasterField([(0.368, 0.93), (0.368, 0.338), (-0.800, 0.338), (-0.849, 0.38), (-0.849, 0.93)], r=0.02)
BONNET_X0, BONNET_X1, BONNET_HW = 0.631, 1.878, 0.665


def f_bonnet(p):
    return rrect(p.x - (BONNET_X0 + BONNET_X1) / 2, abs(p.z), (BONNET_X1 - BONNET_X0) / 2, BONNET_HW, 0.06)


def seam(p, n):
    x, y, z = p.x, p.y, abs(p.z)
    d = 1.0
    if abs(n.z) > 0.35 and y < B + 0.04 and -0.95 < x < 0.45:          # door
        d = min(d, DOOR(x, y))
    if n.y > 0.3 and x > 0.5:                                           # bonnet
        d = min(d, f_bonnet(p))
    if x < -1.6 and (n.y > 0.3 or n.x < -0.3) and z < 0.68:             # boot lid, wrapping down the tail panel
        d = min(d, csmax(csmax(z - 0.606, x + 1.752, 0.06), 0.682 - y, 0.04))
    return d
