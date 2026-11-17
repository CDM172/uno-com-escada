# Interior of the DB5 (right-hand drive) and the film gadgets that need their own moving parts.
# Layout from the measured body (windscreen base x = 0.42, door from x = 0.35 to -0.84, B post at -0.83,
# rear window base at -1.70, interior width 1.30 m at the wheel) and the reference cabin photographs.
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_fields as F
import db5_lib as L
import db5_shape as S
from db5_lib import Part
from db5_parts import AT, decal, double_side, fix, rot_x, rot_y, rot_z, tr

TAU = math.tau
DRV_Z = 0.345                         # driver sits on the right
FLOOR = 0.270
STEER_POS = (-0.02, 0.800, DRV_Z)     # steering-wheel hub (exported for the game)
STEER_TILT = 160.0                    # degrees about Z: the column axis points back and up towards the driver
EYE = (-0.52, 1.105, DRV_Z)           # driver's eye point (cockpit camera)
SEAT_X = -0.37                        # centre of the front seat cushions
DASH_X = 0.200                        # face of the dashboard


def seat(p, z, w=0.50):
    """Front bucket seat: pleated centre panels inside plain bolsters, on chrome runners."""
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
    seatp = Part('seat', target='seat')
    driver = Part('driver', target='driver')
    steer = Part('steer', target='steer')
    headp = Part('head', target='head')
    out = [sym, asym, seatp, driver, steer, headp]

    def card_z(x, y):
        return min(S.side_z(x, y) - 0.055, 0.662)

    # ---- floor, toe board, sills, tunnel (half; mirrored)
    sym.mat('carpet')
    sym.quad((0.95, FLOOR, 0), (-0.86, FLOOR, 0), (-0.86, FLOOR, 0.67), (0.95, FLOOR, 0.67))
    sym.quad((0.95, FLOOR, 0), (0.95, FLOOR, 0.67), (0.78, 0.80, 0.67), (0.78, 0.80, 0))               # toe board up to the scuttle
    sym.quad((-0.86, FLOOR, 0.67), (-0.86, FLOOR, 0), (-0.92, 0.42, 0), (-0.92, 0.42, 0.44))            # step up to the rear seat pan
    sym.quad((-0.92, 0.42, 0), (-1.50, 0.42, 0), (-1.50, 0.42, 0.44), (-0.92, 0.42, 0.44))              # rear seat pan
    sym.box((0.05, FLOOR + 0.03, 0.655), (1.82, 0.07, 0.05), bevel=0.015)                               # sill
    sym.box((0.20, FLOOR + 0.095, 0.0), (1.55, 0.19, 0.20), bevel=0.045, seg=3)                         # transmission tunnel (mirrored half)
    sym.box((-0.75, FLOOR + 0.06, 0.0), (0.40, 0.12, 0.16), bevel=0.04)
    # rear wheel-arch boxes inside the cabin
    sym.grid(lambda u, v: (-0.84 - 0.70 * u, 0.42 + 0.30 * math.sin(math.pi * min(max(u * 1.05, 0.0), 1.0)) ** 0.6 * 1.0, 0.44 + 0.22 * v), 12, 1, flip=True)
    sym.grid(lambda u, v: (-0.84 - 0.70 * u, 0.42 + v * 0.30 * math.sin(math.pi * min(max(u * 1.05, 0.0), 1.0)) ** 0.6, 0.44), 12, 2)

    # ---- door cards, kick panels and rear quarter trim: follow the body side
    sym.mat('leather_trim')
    sym.grid(lambda u, v: (0.95 - 1.80 * u, FLOOR + 0.04 + (S.BELT - 0.012 - FLOOR - 0.04) * v,
                           card_z(0.95 - 1.80 * u, FLOOR + 0.04 + (S.BELT - 0.012 - FLOOR - 0.04) * v)), 30, 6, flip=True)
    sym.grid(lambda u, v: (-0.85 - 0.55 * u, 0.70 + (S.BELT - 0.03 - 0.70) * v, min(S.side_z(-0.85 - 0.55 * u, 0.80) - 0.08, 0.650, float(S.Z_FOOT(-0.85 - 0.55 * u)) - 0.03) - 0.06 * u * u), 10, 2, flip=True)
    # waist rail under the glass
    sym.grid(lambda u, v: (0.33 - 1.80 * u, S.BELT - 0.012 + 0.010 * v, card_z(0.33 - 1.80 * u, S.BELT - 0.02) + (float(S.Z_FOOT(0.33 - 1.80 * u)) - 0.012 - card_z(0.33 - 1.80 * u, S.BELT - 0.02)) * v), 24, 1, flip=True)
    # pleated lower door panel, armrest/door pull, window winder, interior handle, map pocket
    dz = card_z(-0.20, 0.55)
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
        x = 0.045 - 1.185 * u
        z = (0.575 - 0.10 * max(0.0, 1 - u * 6) ** 2) * v
        return (x, float(S.h_up(x, np.array([z]))[0]) - 0.028 - 0.018 * (1 - abs(2 * u - 1) ** 6), z)
    sym.grid(head, 26, 10, flip=True)
    sym.mat('leather_trim')
    sym.box((-0.035, 1.228, 0.29), (0.12, 0.014, 0.34), bevel=0.006)

    # ---- rear seats: two shaped squabs and backs, parcel shelf under the rear window
    sym.mat('leather_trim')
    sym.box((-1.10, 0.48, 0.225), (0.42, 0.13, 0.43), bevel=0.05, seg=3)
    sym.push(tr(-1.325, 0.50, 0.225) @ rot_z(0.46))
    sym.box((0, 0.23, 0), (0.11, 0.50, 0.43), bevel=0.05, seg=3)
    sym.mat('leather')
    sym.box((0.052, 0.24, 0), (0.026, 0.40, 0.30), bevel=0.01)
    sym.pop()
    sym.mat('leather')
    sym.box((-1.09, 0.542, 0.225), (0.34, 0.026, 0.30), bevel=0.01)
    sym.mat('carpet')
    sym.quad((-1.45, 0.930, 0), (-1.45, 0.930, 0.50), (-1.72, 0.885, 0.40), (-1.72, 0.955, 0))

    # ---- dashboard: padded top roll, fascia with the glovebox, binnacle, centre console
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (0.415 - 0.24 * (abs(-0.66 + 1.32 * u) / 0.68) ** 2.2 + 0.005 - (0.235 - 0.24 * (abs(-0.66 + 1.32 * u) / 0.68) ** 2.2 + 0.03) * v,
                            0.955 - 0.072 * (abs(-0.66 + 1.32 * u) / 0.68) ** 2 - 0.022 * v - 0.03 * v * v, -0.66 + 1.32 * u), 28, 6, flip=True)   # dash top from the screen
    _, fs = asym.sweep([(DASH_X + 0.03 - 2.2 * max(abs(z) - 0.42, 0.0) ** 2, 0.885 - 0.05 * max(abs(z) - 0.42, 0.0), z) for z in np.linspace(-0.63, 0.63, 25)],
                       [(0.030 * math.cos(a), 0.030 * math.sin(a)) for a in np.linspace(0, TAU, 13)[:-1]], up=(0, 1, 0))      # crash roll, following the screen
    fix(asym, fs)
    asym.mat('dash')
    asym.box((DASH_X + 0.045, 0.790, 0.0), (0.05, 0.150, 1.28), bevel=0.012)                             # fascia panel
    # binnacle ahead of the driver: hooded oval pod with seven dials
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (DASH_X + 0.03 - 0.085 * v, 0.815 + math.sin(u * TAU) * (0.088 + 0.006 * v), DRV_Z + math.cos(u * TAU) * (0.235 + 0.006 * v)), 28, 2, flip=True)
    asym.mat('decal_dials')
    xq = DASH_X - 0.030
    decal(asym, 'dials', (xq, 0.745, DRV_Z - 0.225), (xq, 0.745, DRV_Z + 0.225), (xq, 0.885, DRV_Z + 0.225), (xq, 0.885, DRV_Z - 0.225))
    # glovebox with its bright edge, mirrored shape on the passenger side
    asym.mat('chrome')
    asym.grid(lambda u, v: (DASH_X + 0.018, 0.805 + math.sin(u * TAU) * (0.066 + 0.006 * v), -0.385 + math.cos(u * TAU) * (0.215 + 0.006 * v)), 24, 1, flip=True)
    asym.mat('dash')
    asym.grid(lambda u, v: (DASH_X + 0.016, 0.805 + math.sin(u * TAU) * 0.066 * v, -0.385 + math.cos(u * TAU) * 0.215 * v), 24, 2, flip=True)
    asym.mat('chrome')
    asym.cyl((DASH_X + 0.016, 0.805, -0.385), (DASH_X + 0.006, 0.805, -0.385), 0.012, seg=12)
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
    asym.mat('decal_radar')
    decal(asym, 'radar', (-0.031, -0.105, -0.085), (-0.031, -0.105, 0.085), (-0.031, 0.045, 0.085), (-0.031, 0.045, -0.085))
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
    asym.box((0.125, 1.205, 0.0), (0.020, 0.060, 0.21), bevel=0.010)
    asym.cyl((0.135, 1.225, 0.0), (0.145, 1.262, 0.0), 0.006, seg=6)
    asym.mat('mirror')
    asym.quad((0.1145, 1.180, -0.097), (0.1145, 1.180, 0.097), (0.1145, 1.230, 0.097), (0.1145, 1.230, -0.097))
    asym.mat('chrome_satin')
    for dz, w, yy in ((0.115, 0.045, 0.40), (0.0, 0.055, 0.42), (-0.115, 0.055, 0.42)):               # throttle, brake, clutch
        asym.box((0.86, yy, DRV_Z + dz), (0.012, 0.075, w), bevel=0.004)
        asym.cyl((0.86, yy, DRV_Z + dz), (0.93, yy + 0.16, DRV_Z + dz), 0.006, seg=6)
    # gear lever with its gaiter and flip-top knob; fly-off handbrake by the driver
    asym.mat('chrome')
    asym.cyl((0.13, FLOOR + 0.19, 0.0), (0.085, 0.655, 0.01), 0.0065, seg=8)
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (0.13 - 0.01 * v + math.cos(u * TAU) * 0.052 * (1 - v * 0.78), FLOOR + 0.19 + 0.10 * v, math.sin(u * TAU) * 0.052 * (1 - v * 0.78)), 12, 3, flip=True)
    asym.mat('black')
    asym.sphere((0.083, 0.672, 0.011), 0.025, seg=14, rings=8)
    asym.mat('lens_red')                                                                              # the red button under the flip-top
    asym.cyl((0.083, 0.694, 0.011), (0.083, 0.701, 0.011), 0.010, seg=10)
    asym.mat('chrome')
    asym.cyl((-0.20, FLOOR + 0.10, 0.125), (0.02, 0.50, 0.130), 0.008, seg=8)
    asym.mat('black')
    asym.cyl((0.02, 0.50, 0.130), (0.07, 0.585, 0.131), 0.012, seg=8)
    # centre armrest with the gadget switch panel under its open lid
    asym.mat('leather_trim')
    asym.box((-0.40, FLOOR + 0.225, 0.0), (0.36, 0.07, 0.17), bevel=0.022)
    asym.push(tr(-0.58, FLOOR + 0.262, 0.0) @ rot_z(1.92))
    asym.box((0.18, 0.0, 0.0), (0.36, 0.022, 0.17), bevel=0.009)                                       # lid, flipped open
    asym.pop()
    asym.mat('decal_panel')
    yp = FLOOR + 0.2615
    decal(asym, 'panel', (-0.565, yp, -0.075), (-0.565, yp, 0.075), (-0.235, yp, 0.075), (-0.235, yp, -0.075))

    # ---- seats: driver's is fixed, the passenger's is the ejector seat (its own part)
    seat(asym, DRV_Z)
    seat(seatp, -DRV_Z)

    # ---- driver: suited figure, hands on the wheel at ten to two
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
    d.box(sh + Vector((0.075, -0.06, 0)), (0.05, 0.19, 0.10), bevel=0.02)
    d.mat('black')
    d.box(sh + Vector((0.098, -0.07, 0)), (0.012, 0.16, 0.034), bevel=0.004)                           # tie
    headp.mat('skin')
    hc = Vector(EYE) + Vector((-0.045, -0.005, 0))
    headp.cyl(hc + Vector((-0.02, -0.14, 0)), hc + Vector((-0.005, -0.07, 0)), 0.050, seg=12)
    headp.sphere(hc, 0.097, seg=18, rings=12, scale=(1.0, 1.16, 0.86))
    headp.mat('hair')
    headp.sphere(hc + Vector((-0.016, 0.022, 0)), 0.100, seg=18, rings=12, scale=(1.0, 1.08, 0.88))

    # ---- steering wheel (local frame: X along the column towards the driver, rim in the YZ plane)
    st = steer
    R = 0.205
    st.mat('wood')
    ring = [(0.0, math.cos(a) * R, math.sin(a) * R) for a in np.linspace(0, TAU, 57)[:-1]]
    _, fs = st.tube(ring, 0.0125, seg=10, closed=True, up=(1, 0, 0))
    fix(st, fs)
    st.mat('chrome')
    for k in range(16):                                                                               # rim rivets
        a = k / 16 * TAU
        st.cyl((0.011, math.cos(a) * R, math.sin(a) * R), (0.014, math.cos(a) * R, math.sin(a) * R), 0.004, seg=6)
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
    st.mat('horn')
    _, fs = st.lathe([(-0.008, 0.034), (-0.003, 0.026), (-0.001, 0.0)], seg=20, axis='x')
    fix(st, fs)
    return out


def build_gadgets(fast=False):
    out = []
    # ---- revolving number plates: three-sided drums (front: on the bumper centre; rear: let into the boot lid)
    hw, hh, ap = 0.262, 0.057, 0.034
    xf = S.surf_x(0.0, 0.47, True) + 0.016 + 0.034 + 0.012
    xr = S.surf_x(0.0, 0.61, False) + 0.020
    for name, front, piv in (('plateF', True, (xf, 0.362, 0.0)), ('plateR', False, (xr, 0.610, 0.0))):
        p = Part(name, target=name)
        p.pivot = piv
        for k in range(3):
            p.push(tr(*piv) @ rot_z(k * TAU / 3) @ (Matrix.Identity(4) if front else rot_y(math.pi)))
            p.mat('black')
            p.box((ap - 0.004, 0, 0), (0.008, hh * 2 + 0.006, hw * 2 + 0.006))
            p.mat('decal_plate')
            xx = ap + 0.0008
            decal(p, 'plate%d' % k, (xx, -hh, hw), (xx, -hh, -hw), (xx, hh, -hw), (xx, hh, hw))
            p.pop()
        p.mat('chrome')
        for sg in (-1, 1):                                                   # end caps
            p.cyl((piv[0], piv[1], sg * (hw + 0.004)), (piv[0], piv[1], sg * (hw + 0.012)), 0.062, seg=3)
        out.append(p)
    # fixed bright surround of the rear plate
    fr = Part('plate_frame')
    fr.mat('chrome')
    xt = S.surf_x(0.0, 0.61, False) - 0.004
    for y, hgt in ((0.610 + hh + 0.010, 0.012), (0.610 - hh - 0.010, 0.012)):
        fr.box((xt, y, 0.0), (0.012, hgt, hw * 2 + 0.05), bevel=0.003)
    for sg in (-1, 1):
        fr.box((xt, 0.610, sg * (hw + 0.019)), (0.012, hh * 2 + 0.03, 0.012), bevel=0.003)
    out.append(fr)
    # ---- rear bullet-proof screen: steel plate that rises out of the boot lid just behind the back window
    sh = Part('shield', target='shield')
    sh.mat('armour')
    sh.pivot = (-1.80, 1.00, 0.0)
    sh.push(tr(-1.845, 0.620, 0.0) @ rot_z(-0.22))
    sh.box((0, 0.0, 0), (0.014, 0.52, 0.90), bevel=0.004)
    sh.pop()
    out.append(sh)
    # ---- tyre slashers: three-bladed cutters that telescope out of the rear wheel spinners (wheel frame, axle = Z)
    sl = Part('slasher', target='slasher')
    sl.mat('chrome')
    sl.cyl((0, 0, -0.06), (0, 0, 0.16), 0.013, seg=10)
    _, fs = sl.lathe([(0.16, 0.019), (0.19, 0.015), (0.235, 0.0)], seg=10, axis='z')
    fix(sl, fs)
    for k in range(3):
        sl.push(rot_z(k * TAU / 3))
        _, fs = sl.sweep([(0.0, 0.0, 0.165), (0.045, 0.012, 0.160), (0.085, 0.035, 0.150), (0.118, 0.066, 0.135)], [(-0.012, 0.0), (0.0, 0.0025), (0.012, 0.0), (0.0, -0.0025)], up=(0, 0, 1))
        fix(sl, fs)
        sl.pop()
    out.append(sl)
    return out
