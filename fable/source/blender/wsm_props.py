# Street furniture for Weston-super-Mare, modelled from reference photographs of the town (Geograph, used only as
# references): the black Victorian lantern posts of the Marine Lake and the promenade, tall galvanised lighting
# columns, timber benches with cast-iron ends, litter bins, bollards, Belisha beacons, traffic signals, bus stops,
# a red pillar box and phone kiosk, promenade railings and glass balustrades, a bus shelter and a seafront shelter.
#   blender -b -P wsm_props.py -- --export ../js/36_wsm_props.js [--render DIR]
# Prop frame (same axes as the cars): origin on the ground at the foot of the prop, X = the side that faces the road,
# Y up, Z to the right; metres.
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
from db5_lib import Part, material

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d=None: ARGS[ARGS.index(k) + 1] if k in ARGS else d
TAU = math.tau

# (game material id, variant) as in mat_car.wgsl; preview = Blender look
material('iron', 6, 1, (0.035, 0.035, 0.04), ((0.035, 0.035, 0.04), 0.7, 0.45))        # black painted cast iron
material('steel', 6, 0, (0.58, 0.59, 0.61), ((0.58, 0.59, 0.61), 1.0, 0.35))           # galvanised steel
material('paint', 20, 0, (1, 1, 1), ((0.55, 0.02, 0.02), 0.0, 0.25, dict(coat=1.0)))   # glossy paint (meta.prop.paint)
material('black', 2, 0, (0.02, 0.02, 0.021), ((0.02, 0.02, 0.021), 0.0, 0.6))
material('white', 2, 0, (0.85, 0.85, 0.82), ((0.85, 0.85, 0.82), 0.0, 0.5))
material('yellow', 2, 0, (0.85, 0.62, 0.04), ((0.85, 0.62, 0.04), 0.0, 0.5))
material('red', 2, 0, (0.55, 0.03, 0.03), ((0.55, 0.03, 0.03), 0.0, 0.5))
material('gold', 7, 1, (0.78, 0.6, 0.25), ((0.78, 0.6, 0.25), 1.0, 0.3))
material('wood', 26, 1, (0.40, 0.26, 0.14), ((0.40, 0.26, 0.14), 0.0, 0.5))
material('slate', 2, 0, (0.16, 0.17, 0.19), ((0.16, 0.17, 0.19), 0.0, 0.7))
material('glass', 0, 0, (0.86, 0.92, 0.90), ((0.9, 0.95, 0.93), 0.0, 0.0, dict(glass=1)), target='glass')
material('glass_lamp', 2, 0, (0.95, 0.96, 0.96), ((1, 1, 1), 0.0, 0.0, dict(glass=1)), target='glass')
material('lens_white', 22, 4, (0.95, 0.93, 0.85), ((0.95, 0.93, 0.85), 0.0, 0.15, dict(emit=0.5)))
material('lens_red', 22, 1, (0.6, 0.02, 0.015), ((0.6, 0.02, 0.015), 0.0, 0.15))
material('lens_amber', 22, 2, (0.85, 0.42, 0.03), ((0.85, 0.42, 0.03), 0.0, 0.15, dict(emit=0.6)))
material('lens_green', 22, 0, (0.05, 0.55, 0.25), ((0.05, 0.55, 0.25), 0.0, 0.15))


def rot_y(a):
    return Matrix.Rotation(a, 4, 'Y')


def rot_z(a):
    return Matrix.Rotation(a, 4, 'Z')


def rot_x(a):
    return Matrix.Rotation(a, 4, 'X')


def tr(x, y, z):
    return Matrix.Translation((x, y, z))


def fix(p, fs):
    import bmesh
    bmesh.ops.recalc_face_normals(p.bm, faces=[f for f in fs if f.is_valid])


def up(p, prof, seg=16, x=0.0, z=0.0):
    """Upright lathe: prof = [(height, radius), ...]."""
    _, fs = p.lathe(prof, seg=seg, axis='y', origin=(x, 0, z))
    fix(p, fs)
    return fs


# ------------------------------------------------------------------------------------------- street lighting
def victorian_lamp():
    """Black cast-iron lantern post, as on the Marine Lake and Knightstone causeway: moulded base, fluted shaft,
    ladder bar, six-sided lantern with a crown and finial. About 4 m."""
    p = Part('lamp_v').mat('iron')
    up(p, [(0.0, 0.0), (0.0, 0.20), (0.05, 0.20), (0.08, 0.17), (0.12, 0.17), (0.16, 0.14), (0.46, 0.125), (0.50, 0.15),
           (0.56, 0.15), (0.60, 0.11), (0.66, 0.095)], seg=20)
    up(p, [(0.66, 0.092), (1.25, 0.082), (1.30, 0.10), (1.36, 0.10), (1.40, 0.078), (3.12, 0.062), (3.16, 0.085),
           (3.22, 0.085), (3.26, 0.06)], seg=16)
    for k in range(8):                                                    # flutes on the lower shaft
        a = k / 8 * TAU
        p.box((math.cos(a) * 0.084, 0.95, math.sin(a) * 0.084), (0.014, 0.56, 0.014), bevel=0.004)
    p.box((0.0, 3.18, 0.0), (0.05, 0.035, 0.56), bevel=0.012)            # ladder bar
    for s in (-1, 1):
        p.sphere((0.0, 3.18, s * 0.29), 0.032, seg=10, rings=6)
    # lantern
    y0, y1 = 3.30, 3.86
    up(p, [(3.24, 0.0), (3.24, 0.10), (3.30, 0.14)], seg=6)
    p.mat('glass_lamp')
    up(p, [(y0, 0.145), (y1, 0.215)], seg=6)
    p.mat('lens_white')
    p.sphere((0.0, 3.52, 0.0), 0.05, seg=10, rings=6)
    p.mat('iron')
    for k in range(6):                                                    # frame ribs at the corners
        a = (k + 0.5) / 6 * TAU
        c0 = Vector((math.cos(a) * 0.15, y0, math.sin(a) * 0.15))
        c1 = Vector((math.cos(a) * 0.222, y1, math.sin(a) * 0.222))
        _, fs = p.tube([c0, c1], 0.009, seg=5)
        fix(p, fs)
    up(p, [(y1 - 0.01, 0.235), (y1 + 0.03, 0.245), (y1 + 0.05, 0.20), (y1 + 0.16, 0.08), (y1 + 0.20, 0.04), (y1 + 0.24, 0.05),
           (y1 + 0.27, 0.0)], seg=12)
    p.cyl((0, y1 + 0.26, 0), (0, y1 + 0.40, 0), 0.012, 0.002, seg=6)       # finial spike
    return [p], dict(kind='lamp', size=[0.5, 4.3, 0.6])


def lighting_column():
    """Tall galvanised lighting column of the seafront road, with an outreach arm and a flat LED lantern. 8 m."""
    p = Part('lamp_c').mat('steel')
    up(p, [(0.0, 0.0), (0.0, 0.11), (0.65, 0.10), (0.68, 0.085), (8.0, 0.058), (8.03, 0.0)], seg=14)
    path = [(0.0, 7.85, 0.0), (0.25, 8.05, 0.0), (0.6, 8.15, 0.0), (1.05, 8.18, 0.0)]
    _, fs = p.tube(path, 0.035, seg=8, up=(0, 0, 1))
    fix(p, fs)
    p.box((1.30, 8.19, 0.0), (0.66, 0.075, 0.25), bevel=0.02, seg=2)
    p.mat('lens_white')
    p.box((1.32, 8.15, 0.0), (0.5, 0.006, 0.19))
    p.mat('black')
    p.box((0.105, 0.55, 0.0), (0.012, 0.32, 0.12))                         # access door
    return [p], dict(kind='lamp', size=[1.7, 8.3, 0.3])


# ------------------------------------------------------------------------------------------- seats, bins, bollards
def bench():
    """Promenade bench: five timber seat slats and three back slats on cast-iron ends with armrests. 1.8 m."""
    p = Part('bench').mat('iron')
    for s in (-1, 1):
        z = s * 0.80
        p.push(tr(0, 0, z))
        for pth in ([(0.20, 0.0, 0), (0.18, 0.25, 0), (0.17, 0.44, 0)],                  # front leg
                    [(-0.22, 0.0, 0), (-0.16, 0.25, 0), (-0.15, 0.44, 0), (-0.22, 0.65, 0), (-0.30, 0.88, 0)],  # rear leg/back
                    [(0.22, 0.44, 0), (0.0, 0.42, 0), (-0.17, 0.44, 0)],                # seat rail
                    [(0.25, 0.66, 0), (0.12, 0.67, 0), (-0.05, 0.64, 0), (-0.24, 0.70, 0)]):  # armrest
            _, fs = p.sweep(pth, [(-0.018, -0.022), (0.018, -0.022), (0.018, 0.022), (-0.018, 0.022)], up=(0, 0, 1))
            fix(p, fs)
        _, fs = p.tube([(0.17, 0.44, 0), (0.22, 0.55, 0), (0.25, 0.66, 0)], 0.018, seg=6)   # arm support
        fix(p, fs)
        p.sphere((0.27, 0.665, 0), 0.03, seg=8, rings=5)
        p.pop()
    p.mat('wood')
    for k in range(5):
        x = 0.19 - k * 0.085
        p.box((x, 0.455 - 0.01 * k, 0.0), (0.07, 0.03, 1.80), bevel=0.006)
    for k in range(3):
        y = 0.56 + k * 0.11
        x = -0.17 - (y - 0.5) * 0.36
        p.push(tr(x, y, 0.0) @ rot_z(-0.34))
        p.box((0.0, 0.0, 0.0), (0.03, 0.085, 1.80), bevel=0.006)
        p.pop()
    return [p], dict(kind='bench', size=[0.6, 0.9, 1.8])


def litter_bin():
    """Black cast-iron litter bin with a gilded band and a domed lid with its opening facing the road."""
    p = Part('bin').mat('iron')
    up(p, [(0.0, 0.0), (0.0, 0.23), (0.05, 0.23), (0.07, 0.21), (0.70, 0.235), (0.74, 0.25), (0.78, 0.25), (0.80, 0.24),
           (0.90, 0.20), (0.97, 0.12), (1.0, 0.05), (1.01, 0.0)], seg=18)
    p.mat('gold')
    up(p, [(0.62, 0.238), (0.66, 0.238)], seg=18)
    p.mat('black')
    p.box((0.20, 0.86, 0.0), (0.06, 0.10, 0.22), bevel=0.02)
    return [p], dict(kind='bin', size=[0.5, 1.0, 0.5])


def bollard():
    """Black cast-iron bollard with a white reflective band."""
    p = Part('bollard').mat('iron')
    up(p, [(0.0, 0.0), (0.0, 0.12), (0.05, 0.12), (0.08, 0.09), (0.70, 0.075), (0.80, 0.085), (0.84, 0.085), (0.90, 0.06),
           (0.95, 0.03), (0.97, 0.0)], seg=14)
    p.mat('lens_white')
    up(p, [(0.62, 0.0775), (0.69, 0.0765)], seg=14)
    return [p], dict(kind='bollard', size=[0.25, 1.0, 0.25])


# ------------------------------------------------------------------------------------------- road furniture
def belisha_beacon():
    """Zebra-crossing beacon: black and white banded pole with an amber globe on top."""
    p = Part('belisha')
    y = 0.0
    k = 0
    while y < 2.30:
        p.mat('black' if k % 2 == 0 else 'white')
        h = 0.30
        p.cyl((0, y, 0), (0, min(y + h, 2.30), 0), 0.05, seg=12, cap0=k == 0, cap1=y + h >= 2.30)
        y += h
        k += 1
    p.mat('black')
    p.cyl((0, 2.30, 0), (0, 2.38, 0), 0.06, seg=12)
    p.mat('lens_amber')
    p.sphere((0, 2.54, 0), 0.165, seg=16, rings=10)
    return [p], dict(kind='beacon', size=[0.35, 2.75, 0.35])


def traffic_signal():
    """Three-aspect traffic signal on a pole, facing +X, with a backboard and a push-button box."""
    p = Part('signal').mat('black')
    up(p, [(0.0, 0.0), (0.0, 0.07), (3.30, 0.06), (3.32, 0.0)], seg=12)
    p.box((0.0, 2.92, 0.0), (0.22, 0.92, 0.30), bevel=0.02)
    p.mat('white')
    p.box((-0.115, 2.92, 0.0), (0.012, 1.10, 0.48))                       # backboard border
    p.mat('black')
    p.box((-0.112, 2.92, 0.0), (0.014, 1.04, 0.42))
    for k, (m, y) in enumerate((('lens_red', 3.20), ('lens_amber', 2.92), ('lens_green', 2.64))):
        p.mat(m)
        _, fs = p.lathe([(0.110, 0.095), (0.118, 0.06), (0.121, 0.0)], seg=16, axis='x', origin=(0, y, 0))
        fix(p, fs)
        p.mat('black')
        _, fs = p.grid(lambda u, v, y=y: (0.11 + 0.14 * v, y + math.sin(u * math.pi) * 0.115, -math.cos(u * math.pi) * 0.115), 8, 1)
        fix(p, fs)
    p.mat('yellow')
    p.box((0.09, 1.10, 0.0), (0.10, 0.22, 0.14), bevel=0.015)              # push-button box
    p.mat('black')
    p.box((0.141, 1.12, 0.0), (0.006, 0.06, 0.06))
    return [p], dict(kind='signal', size=[0.5, 3.4, 0.5])


def bus_stop():
    """Bus-stop pole with its flag (a white plate with a black bus pictogram, as on Weston's stops) and a timetable case."""
    p = Part('busstop').mat('steel')
    up(p, [(0.0, 0.0), (0.0, 0.04), (2.85, 0.036), (2.87, 0.0)], seg=10)
    p.mat('white')
    p.box((0.0, 2.55, 0.25), (0.02, 0.46, 0.42), bevel=0.01)
    p.mat('black')
    for s in (-1, 1):
        p.box((s * 0.012, 2.60, 0.25), (0.002, 0.13, 0.26))                 # bus body
        p.box((s * 0.0125, 2.645, 0.25), (0.002, 0.03, 0.22))
        for zz in (0.17, 0.33):                                              # wheels
            p.cyl((s * 0.012, 2.525, zz), (s * 0.013, 2.525, zz), 0.025, seg=10)
        p.box((s * 0.012, 2.43, 0.25), (0.002, 0.03, 0.30))                  # a dark band under the pictogram
    p.mat('steel')
    p.box((0.0, 2.55, 0.25), (0.024, 0.47, 0.012))
    p.mat('black')
    p.box((0.05, 1.55, 0.0), (0.04, 0.55, 0.32), bevel=0.01)
    p.mat('white')
    p.box((0.072, 1.55, 0.0), (0.002, 0.48, 0.26))
    return [p], dict(kind='busstop', size=[0.2, 2.9, 0.7])


def bus_shelter():
    """Glazed steel bus shelter with a curved roof, rear and end panels and a perch seat. 3.2 x 1.4 m."""
    p = Part('shelter_b').mat('steel')
    W, D, H = 3.2, 1.4, 2.40
    for x in (-D / 2 + 0.05, D / 2 - 0.05):
        for z in (-W / 2, W / 2):
            p.box((x, H / 2, z), (0.07, H, 0.07), bevel=0.01)
    p.grid(lambda u, v: (-D / 2 - 0.08 + (D + 0.2) * u, H + 0.06 + 0.10 * math.sin(math.pi * u), -W / 2 - 0.1 + (W + 0.2) * v), 8, 2)
    p.grid(lambda u, v: (-D / 2 - 0.08 + (D + 0.2) * u, H + 0.05 + 0.10 * math.sin(math.pi * u), W / 2 + 0.1 - (W + 0.2) * v), 8, 2)
    p.box((-D / 2 + 0.05, 0.05, 0.0), (0.05, 0.05, W))
    p.box((-D / 2 + 0.05, H - 0.02, 0.0), (0.05, 0.05, W))
    p.box((-D / 2 + 0.25, 0.62, 0.0), (0.18, 0.04, W - 0.4), bevel=0.01)    # perch seat
    p.mat('glass')
    p.box((-D / 2 + 0.05, 1.15, 0.0), (0.012, 2.0, W - 0.1))
    for z in (-W / 2, W / 2):
        p.box((-0.05, 1.15, z), (D - 0.25, 2.0, 0.012))
    p.mat('black')
    p.box((-D / 2 + 0.06, 1.35, W / 2 - 0.55), (0.03, 1.6, 0.9))           # map/advert case
    p.mat('lens_white')
    p.box((-D / 2 + 0.08, 1.35, W / 2 - 0.55), (0.004, 1.5, 0.82))
    return [p], dict(kind='shelter', size=[1.6, 2.6, 3.4])


def pillar_box():
    """Red cylindrical pillar box on its black plinth, with posting slot and plate."""
    p = Part('pillar').mat('black')
    up(p, [(0.0, 0.0), (0.0, 0.30), (0.10, 0.30), (0.12, 0.28)], seg=20)
    p.mat('paint')
    up(p, [(0.12, 0.28), (1.30, 0.28), (1.34, 0.305), (1.40, 0.315), (1.44, 0.30), (1.52, 0.25), (1.58, 0.16), (1.62, 0.06), (1.64, 0.0)], seg=24)
    p.mat('black')
    p.box((0.275, 1.18, 0.0), (0.03, 0.035, 0.24), bevel=0.008)            # posting slot
    p.mat('white')
    p.box((0.281, 0.98, 0.0), (0.006, 0.12, 0.16))                         # collection plate
    return [p], dict(kind='postbox', size=[0.65, 1.65, 0.65], paint=[0.55, 0.02, 0.02])


def phone_kiosk():
    """Modern public phone booth: brushed steel frame, glass on three sides, a dark roof canopy and a phone unit."""
    p = Part('kiosk').mat('steel')
    W, D, H = 0.95, 0.85, 2.30
    for x in (-D / 2, D / 2):
        for z in (-W / 2, W / 2):
            p.box((x, H / 2, z), (0.06, H, 0.06), bevel=0.008)
    p.mat('black')
    p.box((0.0, H + 0.05, 0.0), (D + 0.10, 0.10, W + 0.10), bevel=0.015)
    p.mat('white')
    for s in (-1, 1):
        p.box((s * (D / 2 + 0.051), H + 0.05, 0.0), (0.004, 0.06, W - 0.1))   # lit header strip
    p.mat('glass')
    p.box((-D / 2, 1.25, 0.0), (0.012, 1.9, W - 0.06))
    for z in (-W / 2, W / 2):
        p.box((0.0, 1.25, z), (D - 0.06, 1.9, 0.012))
    p.mat('steel')
    p.box((-D / 2 + 0.06, 1.25, 0.0), (0.08, 0.55, 0.32), bevel=0.01)       # phone unit
    p.mat('black')
    p.box((-D / 2 + 0.102, 1.33, 0.0), (0.004, 0.16, 0.22))
    p.box((0.0, 0.05, 0.0), (D, 0.10, W), bevel=0.01)
    return [p], dict(kind='kiosk', size=[0.95, 2.4, 1.05])


# ------------------------------------------------------------------------------------------- railings and shelters
def railing():
    """2 m bay of the promenade railing: posts with rounded heads, a top rail and two lower rails."""
    p = Part('rail').mat('steel')
    for z in (-1.0, 1.0):
        up(p, [(0.0, 0.0), (0.0, 0.035), (1.02, 0.03), (1.06, 0.022), (1.08, 0.0)], seg=8, z=z)
    for y, r in ((1.00, 0.026), (0.64, 0.018), (0.30, 0.018)):
        _, fs = p.tube([(0.0, y, -1.0), (0.0, y, 1.0)], r, seg=8, up=(0, 1, 0))
        fix(p, fs)
    return [p], dict(kind='railing', size=[0.1, 1.1, 2.0])


def glass_balustrade():
    """2 m bay of the glass balustrade along the Marine Lake deck."""
    p = Part('balus').mat('steel')
    for z in (-1.0, 1.0):
        p.box((0.0, 0.52, z), (0.05, 1.04, 0.05), bevel=0.008)
    _, fs = p.tube([(0.0, 1.06, -1.0), (0.0, 1.06, 1.0)], 0.025, seg=10, up=(0, 1, 0))
    fix(p, fs)
    p.mat('glass')
    p.box((0.0, 0.56, 0.0), (0.014, 0.88, 1.9))
    return [p], dict(kind='railing', size=[0.1, 1.1, 2.0])


def seafront_shelter():
    """Open Victorian seafront shelter: four cast-iron columns with brackets, a slate hipped roof with a fretwork
    valance, and a back-to-back timber seat. 4 x 3 m."""
    p = Part('shelter_s').mat('iron')
    W, D, H = 4.0, 3.0, 2.55
    for x in (-D / 2 + 0.15, D / 2 - 0.15):
        for z in (-W / 2 + 0.15, W / 2 - 0.15):
            up(p, [(0.0, 0.0), (0.0, 0.11), (0.12, 0.10), (0.16, 0.06), (H - 0.12, 0.05), (H - 0.05, 0.09), (H, 0.10)], seg=12, x=x, z=z)
            for dx, dz in ((0, -math.copysign(1, z)), (-math.copysign(1, x), 0)):
                _, fs = p.tube([(x, H - 0.45, z), (x + dx * 0.25, H - 0.08, z + dz * 0.25)], 0.02, seg=6)
                fix(p, fs)
    p.box((0.0, H + 0.04, 0.0), (D + 0.2, 0.10, W + 0.2), bevel=0.02)
    p.mat('white')
    for s in (-1, 1):                                                       # valance boards
        p.box((s * (D / 2 + 0.11), H - 0.10, 0.0), (0.02, 0.18, W + 0.2))
        p.box((0.0, H - 0.10, s * (W / 2 + 0.11)), (D + 0.2, 0.18, 0.02))
    p.mat('slate')
    ridge = 0.95
    tris = [((-D / 2 - 0.15, H + 0.09, -W / 2 - 0.15), (D / 2 + 0.15, H + 0.09, -W / 2 - 0.15), (0.0, H + ridge, -W / 2 + D / 2 - 0.1)),
            ((D / 2 + 0.15, H + 0.09, W / 2 + 0.15), (-D / 2 - 0.15, H + 0.09, W / 2 + 0.15), (0.0, H + ridge, W / 2 - D / 2 + 0.1))]
    for a, b, c in tris:
        p.quad(a, b, c, c)
    for s in (-1, 1):
        a = (s * (D / 2 + 0.15), H + 0.09, -W / 2 - 0.15)
        b = (s * (D / 2 + 0.15), H + 0.09, W / 2 + 0.15)
        c = (0.0, H + ridge, W / 2 - D / 2 + 0.1)
        d = (0.0, H + ridge, -W / 2 + D / 2 - 0.1)
        if s > 0:
            p.quad(a, b, c, d)
        else:
            p.quad(b, a, d, c)
    p.mat('wood')
    for s in (-1, 1):
        for k in range(4):
            p.box((s * (0.22 + k * 0.10), 0.46, 0.0), (0.08, 0.035, W - 0.8), bevel=0.005)
        for k in range(3):
            p.box((s * 0.06, 0.62 + k * 0.13, 0.0), (0.035, 0.09, W - 0.8), bevel=0.005)
    p.mat('iron')
    for z in (-W / 2 + 0.5, W / 2 - 0.5):
        p.box((0.0, 0.42, z), (0.75, 0.05, 0.05))
        p.box((0.0, 0.62, z), (0.05, 0.42, 0.05))
    return [p], dict(kind='shelter', size=[3.3, 3.6, 4.3])


PROPS = [('lamp_victorian', victorian_lamp), ('lamp_column', lighting_column), ('bench', bench), ('bin', litter_bin),
         ('bollard', bollard), ('belisha', belisha_beacon), ('traffic_signal', traffic_signal), ('bus_stop', bus_stop),
         ('bus_shelter', bus_shelter), ('pillar_box', pillar_box), ('phone_kiosk', phone_kiosk), ('railing', railing),
         ('glass_balustrade', glass_balustrade), ('seafront_shelter', seafront_shelter)]


def export(path):
    import base64
    import json
    out, total = [], 0
    for name, fn in PROPS:
        parts, info = fn()
        meta, z, raw = L.export_blob(parts)
        meta.pop('car', None)
        meta['prop'] = dict(name=name, **info)
        meta['prop'].setdefault('paint', [0.5, 0.5, 0.5])
        b64 = base64.b64encode(z).decode()
        total += len(b64)
        tt = sum(c['ni'] for c in meta['chunks']) // 3
        print('prop %-18s %6d tris %5.1f KB' % (name, tt, len(b64) / 1024))
        out.append((meta, b64))
    with open(path, 'w') as f:
        f.write('// Weston-super-Mare street furniture, generated by source/blender/wsm_props.py (Blender). Do not edit by hand.\n')
        f.write('// Prop frame: origin on the ground at the foot, X faces the road, Y up, Z right; same chunk layout as the cars.\n')
        f.write('const WSM_PROPS = [\n')
        for meta, b64 in out:
            f.write('{meta:' + json.dumps(meta, separators=(',', ':')) + ',b64:"' + b64 + '"},\n')
        f.write('];\n')
    print('props: %d, %.1f KB' % (len(out), total / 1024))


def render(outdir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = int(opt('--samples', 32))
    try:
        sc.cycles.use_denoising = bool(bpy.app.build_options.openimagedenoise)
    except Exception:
        sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = 1600, 700
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.exposure = -1.2
    wd = bpy.data.worlds.new('w')
    sc.world = wd
    wd.use_nodes = True
    nt = wd.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(200)
    nt.nodes['Background'].inputs['Strength'].default_value = 0.25
    nt.links.new(sky.outputs[0], nt.nodes['Background'].inputs[0])
    bpy.ops.mesh.primitive_plane_add(size=80)
    g = bpy.context.object
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.35, 0.34, 1)
    g.data.materials.append(m)
    x = 0.0
    for name, fn in PROPS:
        parts, info = fn()
        w = max(info['size'][0], info['size'][2]) + 0.6
        for pt in parts:
            ob = L.to_object(pt, name + '_' + pt.name)
            ob.matrix_world = L.G2B @ Matrix.Translation((0.0, 0.0, x + w / 2)) @ rot_y(-0.5)
        x += w
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cx = x / 2
    for nm, eye, tgt, lens in (('props_a', (7.5, 2.2, cx * 0.5), (0.0, 1.3, cx * 0.5), 28), ('props_b', (7.5, 2.2, cx * 1.5), (0.0, 1.3, cx * 1.5), 28)):
        e, t = L.G2B @ Vector(eye), L.G2B @ Vector(tgt)
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        sc.render.filepath = os.path.join(outdir, nm + '.png')
        bpy.ops.render.render(write_still=True)


if opt('--export'):
    export(opt('--export'))
if opt('--render'):
    render(opt('--render'))
