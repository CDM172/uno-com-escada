# Interior of the V8 Vantage (right-hand drive, 2+2) and the gadget hardware that needs its own moving parts.
# Layout from the measured body (windscreen base x = 0.38-0.57, door from x = 0.37 to -0.85, B post at -0.85,
# rear window base at -1.74, interior width ~1.5 m): walnut fascia with a black instrument binnacle, centre
# console, leather sports seats, two rear seats.
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
import v8_fields as F
import v8_shape as S
from db5_lib import Part
from v8_parts import AT, decal, double_side, face_dir, fix, fx, rot_x, rot_y, rot_z, rx, tr
import v8_parts as X

TAU = math.tau
DRV_Z = 0.370                         # driver sits on the right
FLOOR = 0.275
STEER_POS = (-0.10, 0.830, DRV_Z)     # steering-wheel hub (exported for the game)
STEER_TILT = 158.0                    # degrees about Z: the column axis points back and up towards the driver
EYE = (-0.62, 1.120, DRV_Z)           # driver's eye point (cockpit camera)
SEAT_X = -0.47                        # centre of the front seat cushions
DASH_X = 0.150                        # face of the dashboard


def seat(p, z, w=0.52):
    """Front sports seat: fluted centre panels inside deep bolsters, on runners."""
    x = SEAT_X
    yc = FLOOR + 0.135
    p.mat('leather_trim')
    p.box((x, yc, z), (0.52, 0.13, w), bevel=0.05, seg=3)                               # cushion
    p.push(tr(x - 0.265, yc + 0.035, z) @ rot_z(0.38))
    p.box((0.0, 0.29, 0.0), (0.12, 0.60, w), bevel=0.055, seg=3)                         # backrest
    p.mat('leather')
    p.box((0.058, 0.30, 0.0), (0.028, 0.50, w - 0.16), bevel=0.012)                      # pleated back panel
    p.pop()
    p.mat('leather')
    p.box((x + 0.01, yc + 0.062, z), (0.42, 0.028, w - 0.16), bevel=0.012)               # pleated cushion panel
    p.mat('chrome_satin')
    for s in (-1, 1):
        p.box((x + 0.02, FLOOR + 0.03, z + s * (w / 2 - 0.07)), (0.50, 0.025, 0.03))    # runners


def build_interior(fast=False):
    sym = Part('int_sym', mirror=True)
    asym = Part('int')
    driver = Part('driver', target='driver')
    steer = Part('steer', target='steer')
    headp = Part('head', target='head')
    out = [sym, asym, driver, steer, headp]

    def card_z(x, y):
        return min(S.side_z(x, y) - 0.060, 0.80)

    # ---- floor, toe board, sills, tunnel (half; mirrored)
    sym.mat('carpet')
    sym.quad((0.95, FLOOR, 0), (-0.92, FLOOR, 0), (-0.92, FLOOR, 0.80), (0.95, FLOOR, 0.80))
    sym.quad((0.95, FLOOR, 0), (0.95, FLOOR, 0.80), (0.70, 0.82, 0.80), (0.70, 0.82, 0))               # toe board up to the scuttle
    sym.quad((-0.92, FLOOR, 0.80), (-0.92, FLOOR, 0), (-0.98, 0.40, 0), (-0.98, 0.40, 0.52))            # step up to the rear seat pan
    sym.quad((-0.98, 0.40, 0), (-1.58, 0.40, 0), (-1.58, 0.40, 0.52), (-0.98, 0.40, 0.52))              # rear seat pan
    sym.box((-0.05, FLOOR + 0.03, 0.79), (1.95, 0.07, 0.05), bevel=0.015)                               # sill
    sym.box((0.18, FLOOR + 0.11, 0.0), (1.60, 0.22, 0.22), bevel=0.05, seg=3)                           # transmission tunnel (mirrored half)
    sym.box((-0.82, FLOOR + 0.07, 0.0), (0.44, 0.14, 0.18), bevel=0.04)
    # rear wheel-arch boxes inside the cabin
    sym.grid(lambda u, v: (-0.93 - 0.74 * u, 0.40 + 0.30 * math.sin(math.pi * min(max(u * 1.05, 0.0), 1.0)) ** 0.6 * 1.0, 0.52 + 0.24 * v), 12, 1, flip=True)
    sym.grid(lambda u, v: (-0.93 - 0.74 * u, 0.40 + v * 0.30 * math.sin(math.pi * min(max(u * 1.05, 0.0), 1.0)) ** 0.6, 0.52), 12, 2)

    # ---- door cards, kick panels and rear quarter trim: follow the body side
    sym.mat('leather_trim')
    sym.grid(lambda u, v: (0.95 - 1.87 * u, FLOOR + 0.04 + (S.BELT - 0.012 - FLOOR - 0.04) * v,
                           card_z(0.95 - 1.87 * u, FLOOR + 0.04 + (S.BELT - 0.012 - FLOOR - 0.04) * v)), 30, 6, flip=True)
    sym.grid(lambda u, v: (-0.92 - 0.65 * u, 0.62 + (S.BELT - 0.03 - 0.62) * v, min(S.side_z(-0.92 - 0.65 * u, 0.80) - 0.09, 0.78, float(S.Z_FOOT(-0.92 - 0.65 * u)) - 0.03) - 0.06 * u * u), 10, 2, flip=True)
    # waist rail under the glass
    sym.grid(lambda u, v: (0.30 - 1.85 * u, S.BELT - 0.012 + 0.010 * v, card_z(0.30 - 1.85 * u, S.BELT - 0.02) + (float(S.Z_FOOT(0.30 - 1.85 * u)) - 0.012 - card_z(0.30 - 1.85 * u, S.BELT - 0.02)) * v), 24, 1, flip=True)
    # pleated lower door panel, armrest/door pull, window winder, interior handle, map pocket
    dz = card_z(-0.25, 0.55)
    sym.mat('leather')
    sym.box((-0.22, 0.50, dz - 0.012), (0.80, 0.24, 0.024), bevel=0.01)
    sym.mat('leather_trim')
    sym.box((-0.30, 0.685, dz - 0.035), (0.44, 0.055, 0.07), bevel=0.022, seg=2)
    sym.mat('chrome')
    sym.cyl((0.05, 0.60, dz - 0.004), (0.05, 0.60, dz - 0.030), 0.017, seg=12)
    sym.box((0.02, 0.578, dz - 0.036), (0.085, 0.016, 0.010), bevel=0.004)
    sym.cyl((0.10, 0.76, dz - 0.004), (0.10, 0.76, dz - 0.024), 0.013, seg=10)
    sym.box((0.065, 0.76, dz - 0.030), (0.09, 0.014, 0.010), bevel=0.004)

    # ---- headlining (pale wool cloth), following the roof skin, and the sun visors
    sym.mat('headlining')

    def head(u, v):
        x = -0.12 - 1.10 * u
        z = (0.66 - 0.06 * max(0.0, 1 - u * 6) ** 2) * v
        return (x, float(S.h_up(x, np.array([z]))[0]) - 0.026 - 0.016 * (1 - abs(2 * u - 1) ** 6), z)
    sym.grid(head, 26, 10, flip=True)
    sym.mat('leather_trim')
    sym.box((-0.16, 1.262, 0.31), (0.12, 0.014, 0.36), bevel=0.006)

    # ---- rear seats: two shaped squabs and backs, parcel shelf under the rear window
    sym.mat('leather_trim')
    sym.box((-1.18, 0.46, 0.27), (0.44, 0.13, 0.44), bevel=0.05, seg=3)
    sym.push(tr(-1.42, 0.48, 0.27) @ rot_z(0.50))
    sym.box((0, 0.24, 0), (0.11, 0.52, 0.44), bevel=0.05, seg=3)
    sym.mat('leather')
    sym.box((0.052, 0.25, 0), (0.026, 0.42, 0.30), bevel=0.01)
    sym.pop()
    sym.mat('leather')
    sym.box((-1.17, 0.522, 0.27), (0.34, 0.026, 0.30), bevel=0.01)
    sym.mat('carpet')
    sym.quad((-1.62, 0.96, 0), (-1.62, 0.96, 0.58), (-1.76, 0.94, 0.55), (-1.76, 1.00, 0))

    # ---- dashboard: padded top roll, fascia with the glovebox, binnacle, centre console
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (0.555 - 0.195 * (abs(-0.74 + 1.48 * u) / 0.767) ** 2.0 - 0.02 - (0.385 - 0.195 * (abs(-0.74 + 1.48 * u) / 0.767) ** 2.0 + 0.0) * v,
                            0.940 - 0.034 * (abs(-0.74 + 1.48 * u) / 0.767) ** 2 - 0.035 * v - 0.02 * v * v, -0.74 + 1.48 * u), 28, 6, flip=True)   # dash top from the screen
    _, fs = asym.sweep([(DASH_X + 0.03 - 1.2 * max(abs(z) - 0.50, 0.0) ** 2, 0.885 - 0.05 * max(abs(z) - 0.50, 0.0), z) for z in np.linspace(-0.72, 0.72, 27)],
                       [(0.030 * math.cos(a), 0.030 * math.sin(a)) for a in np.linspace(0, TAU, 13)[:-1]], up=(0, 1, 0))      # crash roll, following the screen
    fix(asym, fs)
    asym.mat('wood')
    asym.box((DASH_X + 0.045, 0.790, 0.0), (0.05, 0.150, 1.44), bevel=0.012)                             # walnut fascia
    # binnacle ahead of the driver: hooded oval pod with seven dials
    asym.mat('dash')
    asym.box((DASH_X - 0.005, 0.818, DRV_Z), (0.075, 0.170, 0.50), bevel=0.02, seg=3)                  # instrument binnacle
    asym.box((DASH_X - 0.045, 0.902, DRV_Z), (0.11, 0.018, 0.52), bevel=0.008)                          # its hood
    asym.mat('decal_dials')
    xq = DASH_X - 0.0435
    decal(asym, 'dials', (xq, 0.748, DRV_Z - 0.235), (xq, 0.748, DRV_Z + 0.235), (xq, 0.888, DRV_Z + 0.235), (xq, 0.888, DRV_Z - 0.235))
    # glovebox with its bright edge, mirrored shape on the passenger side
    asym.mat('chrome')
    asym.grid(lambda u, v: (DASH_X + 0.018, 0.805 + math.sin(u * TAU) * (0.066 + 0.006 * v), -0.40 + math.cos(u * TAU) * (0.215 + 0.006 * v)), 24, 1, flip=True)
    asym.mat('dash')
    asym.grid(lambda u, v: (DASH_X + 0.016, 0.805 + math.sin(u * TAU) * 0.066 * v, -0.40 + math.cos(u * TAU) * 0.215 * v), 24, 2, flip=True)
    asym.mat('chrome')
    asym.cyl((DASH_X + 0.016, 0.805, -0.40), (DASH_X + 0.006, 0.805, -0.40), 0.012, seg=12)
    # centre of the fascia: clock, switches, radio; console below with the radar tracker
    xf = DASH_X + 0.0185
    decal(asym, 'clock', (xf, 0.812, -0.036), (xf, 0.812, 0.036), (xf, 0.884, 0.036), (xf, 0.884, -0.036))
    decal(asym, 'radio', (xf, 0.722, -0.100), (xf, 0.722, 0.100), (xf, 0.772, 0.100), (xf, 0.772, -0.100))
    asym.mat('chrome')
    for z in (-0.085, -0.060, 0.060, 0.085):
        asym.cyl((xf, 0.845, z), (xf - 0.022, 0.840, z), 0.0045, seg=6)
    asym.mat('dash')
    asym.push(tr(DASH_X + 0.02, 0.60, 0.0) @ rot_z(-0.16))
    asym.box((0.0, 0.0, 0.0), (0.06, 0.30, 0.25), bevel=0.012)
    asym.mat('decal_panel')
    decal(asym, 'panel', (-0.031, -0.105, -0.085), (-0.031, -0.105, 0.085), (-0.031, 0.045, 0.085), (-0.031, 0.045, -0.085))
    asym.mat('chrome')
    asym.box((-0.031, 0.095, 0.0), (0.006, 0.050, 0.18), bevel=0.002)                                   # heater slide panel
    asym.pop()
    # steering column and stalk, rear-view mirror, pedals
    hub = Vector(STEER_POS)
    asym.mat('dash')
    asym.cyl((DASH_X + 0.06, 0.725, DRV_Z), hub + Vector((0.035, -0.012, 0)), 0.021, seg=12)
    asym.mat('chrome')
    asym.cyl(hub + Vector((0.07, -0.02, 0.02)), hub + Vector((0.06, 0.0, 0.14)), 0.0045, seg=6)
    asym.mat('black')
    asym.sphere(hub + Vector((0.06, 0.0, 0.145)), 0.009, seg=8, rings=6)
    asym.mat('chrome')
    asym.box((-0.02, 1.215, 0.0), (0.020, 0.060, 0.21), bevel=0.010)
    asym.cyl((-0.01, 1.235, 0.0), (0.0, 1.285, 0.0), 0.006, seg=6)
    asym.mat('mirror')
    asym.quad((-0.0305, 1.190, -0.097), (-0.0305, 1.190, 0.097), (-0.0305, 1.240, 0.097), (-0.0305, 1.240, -0.097))
    asym.mat('chrome_satin')
    for dz, w, yy in ((0.115, 0.045, 0.40), (0.0, 0.055, 0.42), (-0.115, 0.055, 0.42)):               # throttle, brake, clutch
        asym.box((0.80, yy, DRV_Z + dz), (0.012, 0.075, w), bevel=0.004)
        asym.cyl((0.80, yy, DRV_Z + dz), (0.87, yy + 0.16, DRV_Z + dz), 0.006, seg=6)
    # gear lever with its gaiter and flip-top knob; fly-off handbrake by the driver
    asym.mat('chrome')
    asym.cyl((0.02, FLOOR + 0.21, 0.0), (-0.025, 0.675, 0.01), 0.0065, seg=8)
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (0.02 - 0.01 * v + math.cos(u * TAU) * 0.055 * (1 - v * 0.78), FLOOR + 0.21 + 0.10 * v, math.sin(u * TAU) * 0.055 * (1 - v * 0.78)), 12, 3, flip=True)
    asym.mat('black')
    asym.sphere((-0.027, 0.692, 0.011), 0.026, seg=14, rings=8)
    asym.mat('chrome')
    asym.cyl((-0.30, FLOOR + 0.10, 0.145), (-0.08, 0.50, 0.150), 0.008, seg=8)
    asym.mat('black')
    asym.cyl((-0.08, 0.50, 0.150), (-0.03, 0.585, 0.151), 0.012, seg=8)
    # centre armrest with the gadget switch panel under its open lid
    asym.mat('leather_trim')
    asym.box((-0.50, FLOOR + 0.245, 0.0), (0.36, 0.07, 0.17), bevel=0.022)
    asym.push(tr(-0.68, FLOOR + 0.282, 0.0) @ rot_z(1.92))
    asym.box((0.18, 0.0, 0.0), (0.36, 0.022, 0.17), bevel=0.009)                                       # lid, flipped open
    asym.pop()
    asym.mat('decal_panel')
    yp = FLOOR + 0.2815
    decal(asym, 'panel', (-0.665, yp, -0.075), (-0.665, yp, 0.075), (-0.335, yp, 0.075), (-0.335, yp, -0.075))

    # ---- front seats
    seat(asym, DRV_Z)
    seat(asym, -DRV_Z)

    # ---- driver: generic figure in a dark jacket and roll-neck, hands on the wheel at ten to two
    d = driver
    zd = DRV_Z
    hip = Vector((SEAT_X - 0.17, FLOOR + 0.215, zd))
    d.mat('suit')
    d.push(tr(*hip) @ rot_z(0.36))
    d.box((0.055, 0.27, 0), (0.20, 0.54, 0.38), bevel=0.085, seg=3)                                    # torso
    d.box((0.055, 0.50, 0), (0.17, 0.10, 0.45), bevel=0.045, seg=3)                                    # shoulders
    d.pop()
    d.box((SEAT_X + 0.06, FLOOR + 0.235, zd), (0.48, 0.125, 0.36), bevel=0.06, seg=3)                 # lap
    sh = hip + Vector((-0.175, 0.47, 0))
    for sg in (-1, 1):
        hand = hub + Vector((-0.006, 0.150, sg * 0.150))
        _, fs = d.tube([sh + Vector((0.02, -0.01, sg * 0.215)), sh + Vector((0.27, -0.16, sg * 0.235)), hand + Vector((-0.07, -0.03, sg * 0.02))], 0.043, seg=8)
        fix(d, fs)
        _, fs = d.tube([(SEAT_X + 0.24, FLOOR + 0.25, zd + sg * 0.10), (0.40, FLOOR + 0.27, zd + sg * 0.105), (0.80, FLOOR + 0.10, zd + sg * 0.10)], 0.055, seg=8)
        fix(d, fs)
        d.mat('shirt')
        d.cyl(hand + Vector((-0.085, -0.036, sg * 0.022)), hand + Vector((-0.060, -0.026, sg * 0.016)), 0.036, seg=10)   # cuff
        d.mat('skin')
        d.sphere(hand + Vector((-0.025, -0.008, sg * 0.006)), 0.043, seg=10, rings=6, scale=(1.15, 0.8, 0.8))
        d.mat('suit')
    d.mat('shirt')
    d.cyl(sh + Vector((0.03, -0.02, 0)), sh + Vector((0.03, 0.06, 0)), 0.060, seg=12)                   # roll-neck collar
    headp.mat('skin')
    hc = Vector(EYE) + Vector((-0.045, -0.005, 0))
    headp.cyl(hc + Vector((-0.02, -0.14, 0)), hc + Vector((-0.005, -0.07, 0)), 0.050, seg=12)
    headp.sphere(hc, 0.097, seg=18, rings=12, scale=(1.0, 1.16, 0.86))
    headp.mat('hair')
    headp.sphere(hc + Vector((-0.016, 0.022, 0)), 0.100, seg=18, rings=12, scale=(1.0, 1.08, 0.88))

    # ---- steering wheel (local frame: X along the column towards the driver, rim in the YZ plane)
    st = steer
    R = 0.195
    st.mat('leather')
    ring = [(0.0, math.cos(a) * R, math.sin(a) * R) for a in np.linspace(0, TAU, 57)[:-1]]
    _, fs = st.tube(ring, 0.0125, seg=10, closed=True, up=(1, 0, 0))
    fix(st, fs)
    for k in range(3):                                # three spokes, 120 degrees apart, one pointing down
        st.push(rot_x(k * TAU / 3 + math.pi))
        st.mat('alloy')
        _, fs = st.sweep([(-0.040, 0.030, 0.0), (-0.030, 0.090, 0.0), (-0.012, 0.150, 0.0), (-0.002, 0.196, 0.0)],
                         [(-0.021, -0.002), (0.021, -0.002), (0.021, 0.002), (-0.021, 0.002)], up=(1, 0, 0))
        fix(st, fs)
        st.pop()
    st.mat('black')
    _, fs = st.lathe([(-0.075, 0.026), (-0.045, 0.040), (-0.030, 0.046), (-0.016, 0.040), (-0.010, 0.030), (-0.008, 0.0)], seg=22, axis='x')
    fix(st, fs)
    st.mat('chrome')
    _, fs = st.lathe([(-0.030, 0.047), (-0.020, 0.050), (-0.010, 0.046), (-0.006, 0.036)], seg=22, axis='x')
    fix(st, fs)
    st.mat('black')
    _, fs = st.lathe([(-0.008, 0.034), (-0.003, 0.026), (-0.001, 0.0)], seg=20, axis='x')
    fix(st, fs)
    return out


def build_gadgets(fast=False):
    """Moving parts of the gadgets (the game animates them; see 41_gadgets.js):
    foglamp  the two driving lamps in the grille, hinged at their bottom edge: they tip forward to open the missile tubes
    missile  one in a tube behind each driving lamp (pivot: its centre)
    laser    emitter in each front hub, telescopes out along the axle (wheel frame: axle = Z, outer face +Z)
    ski      outrigger ski stowed under each sill, slides out sideways
    spikes   studs round the tyre tread (wheel frame): deployed position; the game scales X/Y to hide them in the tread
    plateR   rear number plate on its hinge (bottom edge): it flips down to uncover the rocket
    rocket   booster nozzle behind the plate (pivot: nozzle exit); flame: its exhaust flame (shown while it burns)
    hud      head-up display on the inside of the windscreen in front of the driver"""
    out = []
    z, y, r = F.DRIVE_Z, F.DRIVE_Y, F.DRIVE_R
    x = fx(z, y) - 0.030
    fog = Part('foglamp', mirror=True, target='foglamp')
    fog.pivot = (x - 0.01, y - r - 0.012, 0.0)
    fog.mat('black')
    fog.cyl((x - 0.09, y, z), (x - 0.01, y, z), r * 1.08, seg=24)
    X.lamp(fog, (x, y, z), (1, 0, 0), r, 'lens_clear', depth=0.02, bulge=0.016, seg=32, ring=1.10)
    out.append(fog)
    mis = Part('missile', mirror=True, target='missile')
    xm = x - 0.32
    mis.pivot = (xm, y, 0.0)
    mis.mat('steel')
    mis.cyl((xm - 0.17, y, z), (xm + 0.12, y, z), 0.032, seg=16)
    _, fs = mis.lathe([(0.12, 0.032), (0.16, 0.026), (0.19, 0.014), (0.205, 0.0)], seg=16, axis='x', origin=(xm, y, z))
    fix(mis, fs)
    mis.mat('lens_red')
    _, fs = mis.lathe([(0.19, 0.0141), (0.205, 0.0)], seg=16, axis='x', origin=(xm, y, z))
    fix(mis, fs)
    mis.mat('black')
    for k in range(4):                                               # tail fins
        a = k / 4 * TAU + TAU / 8
        mis.box((xm - 0.14, y + math.sin(a) * 0.040, z + math.cos(a) * 0.040), (0.07, 0.004 + 0.022 * abs(math.sin(a)), 0.004 + 0.022 * abs(math.cos(a))))
    out.append(mis)
    las = Part('laser', target='laser')
    las.mat('chrome_satin')
    las.cyl((0, 0, 0.010), (0, 0, 0.072), 0.022, seg=16)
    las.mat('black')
    las.cyl((0, 0, 0.072), (0, 0, 0.078), 0.016, seg=16)
    las.mat('lens_red')
    las.cyl((0, 0, 0.078), (0, 0, 0.0795), 0.011, seg=16)
    out.append(las)
    ski = Part('ski', mirror=True, target='ski')
    ski.pivot = (0.0, 0.215, 0.55)
    ski.mat('alloy')
    ski.box((0.0, 0.205, 0.66), (1.00, 0.018, 0.13), bevel=0.006)
    _, fs = ski.sweep([(0.50, 0.205, 0.66), (0.56, 0.215, 0.66), (0.60, 0.245, 0.66)], [(-0.065, -0.009), (0.065, -0.009), (0.065, 0.009), (-0.065, 0.009)], up=(0, 1, 0))
    fix(ski, fs)
    ski.mat('steel')
    for xa in (-0.32, 0.32):                                          # telescopic arms
        ski.box((xa, 0.225, 0.58), (0.05, 0.03, 0.16), bevel=0.006)
    out.append(ski)
    sp = Part('spikes', target='spikes')
    sp.mat('steel')
    Rw = S.WHEEL_R
    n = 20 if fast else 30
    for k in range(n):
        a = k / n * TAU
        for zz in (-0.075, -0.025, 0.025, 0.075):
            aa = a + (zz * 2.0)
            c0 = (math.cos(aa) * (Rw - 0.010), math.sin(aa) * (Rw - 0.010), zz)
            c1 = (math.cos(aa) * (Rw + 0.014), math.sin(aa) * (Rw + 0.014), zz)
            sp.cyl(c0, c1, 0.006, 0.0015, seg=5)
    out.append(sp)
    # rear plate on its hinge (taken from the static plate of the exterior) and the rocket behind it
    pl = Part('plateR', target='plateR')
    y0, y1 = 0.352, 0.463
    pl.pivot = (rx(0.0, y0) - 0.006, y0, 0.0)
    pl.mat('decal_plate')
    decal(pl, 'plate_r', (rx(0.26, y0) - 0.012, y0, 0.26), (rx(-0.26, y0) - 0.012, y0, -0.26), (rx(-0.26, y1) - 0.012, y1, -0.26), (rx(0.26, y1) - 0.012, y1, 0.26))
    pl.mat('black')
    pl.box((rx(0.0, 0.41) - 0.004, 0.408, 0.0), (0.010, 0.128, 0.548))
    out.append(pl)
    rk = Part('rocket', target='rocket')
    xe = rx(0.0, 0.41) + 0.05
    rk.pivot = (xe, 0.41, 0.0)
    rk.mat('steel')
    _, fs = rk.lathe([(0.30, 0.045), (0.10, 0.050), (0.04, 0.058), (0.0, 0.066), (0.004, 0.058), (0.04, 0.046)], seg=24, axis='x', origin=(xe, 0.41, 0.0))
    fix(rk, fs)
    rk.mat('black')
    rk.cyl((xe + 0.03, 0.41, 0.0), (xe + 0.031, 0.41, 0.0), 0.048, seg=24)
    out.append(rk)
    fl = Part('flame', target='flame')
    fl.mat('muzzle')
    fl.grid(lambda u, v: (xe - 0.55 * v, 0.41 + math.cos(u * TAU) * 0.060 * math.sin(min(v * 1.6, 1.0) * math.pi / 2) * (1 - 0.7 * v),
                          math.sin(u * TAU) * 0.060 * math.sin(min(v * 1.6, 1.0) * math.pi / 2) * (1 - 0.7 * v)), 10, 6)
    out.append(fl)
    hud = Part('hud', target='hud')
    hud.mat('decal_radar')
    s0, s1 = 0.10, 0.30                                               # up the glass from its base
    zz0, zz1 = DRV_Z - 0.17, DRV_Z + 0.17

    def wsp(zz, ss):
        az = abs(zz)
        xb, xh = 0.570 - 0.195 * (az / 0.767) ** 2.0, -0.100 + 0.010 * (az / 0.716) ** 2
        yb, yh = 0.952 - 0.034 * (az / 0.767) ** 2, 1.306 - 0.026 * (az / 0.716) ** 2
        ln = math.hypot(xb - xh, yh - yb)
        xx = xb - (ss / ln) * (xb - xh)
        return (xx - 0.010, float(S.windscreen(xx, np.array([az]))[0]) - 0.012, zz)
    decal(hud, 'hud', wsp(zz1, s0), wsp(zz0, s0), wsp(zz0, s1), wsp(zz1, s1))
    out.append(hud)
    return out
