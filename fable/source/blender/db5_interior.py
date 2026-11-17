# Interior of the DB5 (right-hand drive) and the film gadgets that need their own moving parts.
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
import db5_shape as S
from db5_lib import Part
from db5_parts import double_side, fix, rot_x, rot_y, rot_z, tr

TAU = math.tau
DRV_Z = 0.345           # driver sits on the right
FLOOR = 0.265

# atlas regions (u0, v0, u1, v1) — must match the canvas drawn by the game (db5Atlas)
AT = dict(
    plate0=(0.0, 0.0, 0.5, 0.11), plate1=(0.0, 0.125, 0.5, 0.235), plate2=(0.0, 0.25, 0.5, 0.36),
    dials=(0.0, 0.40, 0.80, 0.62), radar=(0.52, 0.0, 0.76, 0.18), panel=(0.78, 0.0, 1.0, 0.33),
    wings=(0.52, 0.20, 0.76, 0.27), script=(0.52, 0.29, 0.76, 0.36), radio=(0.0, 0.64, 0.40, 0.74), clock=(0.82, 0.40, 0.98, 0.56),
)


def decal(p, name, a, b, c, d):
    """Quad a-b-c-d (counter-clockwise seen from outside); a = bottom-left of the image."""
    u0, v0, u1, v1 = AT[name]
    return p.quad(a, b, c, d, uv=[(u0, v1), (u1, v1), (u1, v0), (u0, v0)])


def seat(p, z, x=-0.30, w=0.50):
    p.mat('leather')
    p.box((x, FLOOR + 0.135, z), (0.50, 0.13, w), bevel=0.05, seg=3)                     # cushion
    p.push(tr(x - 0.27, FLOOR + 0.17, z) @ rot_z(0.36))
    p.box((0.0, 0.30, 0.0), (0.13, 0.62, w), bevel=0.055, seg=3)                          # backrest
    p.pop()
    p.mat('leather_trim')
    for s in (-1, 1):                                                                     # side bolsters
        p.box((x + 0.01, FLOOR + 0.165, z + s * (w / 2 - 0.035)), (0.46, 0.10, 0.07), bevel=0.03, seg=2)
    p.mat('chrome_satin')
    p.box((x + 0.02, FLOOR + 0.035, z), (0.42, 0.03, w - 0.1))                            # runners


def build_interior(fast=False):
    sym = Part('int_sym', mirror=True)
    asym = Part('int')
    seatp = Part('seat', target='seat')
    driver = Part('driver', target='driver')
    steer = Part('steer', target='steer')
    out = [sym, asym, seatp, driver, steer]

    # ---- floor, sills, bulkheads (half; mirrored)
    sym.mat('carpet')
    sym.quad((0.95, FLOOR, 0), (-1.05, FLOOR, 0), (-1.05, FLOOR, 0.70), (0.95, FLOOR, 0.70))
    sym.quad((0.95, FLOOR, 0), (0.95, FLOOR, 0.70), (0.80, 0.90, 0.70), (0.80, 0.90, 0))            # toe board / bulkhead
    sym.quad((-1.05, FLOOR, 0.70), (-1.05, FLOOR, 0), (-1.25, 0.62, 0), (-1.25, 0.62, 0.62))        # rear seat pan riser
    sym.box((0.0, FLOOR + 0.04, 0.665), (1.9, 0.09, 0.07), bevel=0.02)                              # sill
    sym.box((0.05, FLOOR + 0.085, 0.0), (1.9, 0.17, 0.19), bevel=0.04, seg=2)                       # transmission tunnel (half is enough: mirrored)
    # ---- door cards and rear quarter trim: follow the body side, set in from the skin
    sym.mat('leather_trim')

    def card(u, v):
        x = 0.62 - 1.95 * u
        y = FLOOR + 0.03 + (S.BELT - 0.01 - FLOOR - 0.03) * v
        return (x, y, float(S.wall(x, y)) - 0.055 - 0.20 * float(S.sm(-0.85, -1.33, x)) * (1 - v * 0.3))
    sym.grid(card, 26, 6)
    sym.mat('leather')
    sym.box((0.02, 0.60, float(S.wall(0.0, 0.6)) - 0.085), (0.62, 0.20, 0.035), bevel=0.015)      # pleated door panel
    sym.mat('chrome')
    sym.cyl((0.30, 0.66, float(S.wall(0.3, 0.66)) - 0.075), (0.30, 0.66, float(S.wall(0.3, 0.66)) - 0.105), 0.016, seg=12)   # window winder boss
    sym.box((0.27, 0.635, float(S.wall(0.3, 0.66)) - 0.112), (0.075, 0.016, 0.010), bevel=0.004)
    sym.box((-0.05, 0.745, float(S.wall(0.0, 0.74)) - 0.095), (0.26, 0.022, 0.03), bevel=0.01)     # door pull / armrest rail
    sym.mat('leather_trim')
    sym.box((-0.05, 0.705, float(S.wall(0.0, 0.70)) - 0.105), (0.30, 0.05, 0.06), bevel=0.02)
    # waist rail under the glass
    sym.grid(lambda u, v: (0.62 - 1.95 * u, S.BELT - 0.012 + 0.012 * v, float(S.z_glass(0.62 - 1.95 * u)) - 0.012 - 0.05 * (1 - v) - 0.16 * float(S.sm(-0.85, -1.33, 0.62 - 1.95 * u)) * (1 - v)), 26, 1)

    # ---- headlining (cream wool cloth) and the pillars' inner faces
    sym.mat('headlining')

    def head(u, v):
        x = 0.16 - 1.50 * u
        z = 0.59 * v
        return (x, float(S.green(x, z)) - 0.030 - 0.02 * (1 - abs(2 * u - 1) ** 4), z)
    hv, hf = sym.grid(head, 24, 10, flip=True)

    # ---- rear seats: two shaped squabs and a common backrest, parcel shelf
    sym.mat('leather')
    sym.box((-0.98, FLOOR + 0.20, 0.30), (0.42, 0.13, 0.50), bevel=0.05, seg=3)
    sym.push(tr(-1.22, FLOOR + 0.25, 0.30) @ rot_z(0.42))
    sym.box((0, 0.24, 0), (0.11, 0.50, 0.52), bevel=0.05, seg=3)
    sym.pop()
    sym.mat('carpet')
    sym.quad((-1.33, 0.845, 0), (-1.33, 0.845, 0.55), (-1.72, 0.855, 0.50), (-1.72, 0.855, 0))     # parcel shelf

    # ---- dashboard
    asym.mat('leather_trim')
    asym.box((0.555, 0.862, 0.0), (0.33, 0.075, 1.30), bevel=0.032, seg=3)                          # padded top roll
    asym.mat('dash')
    asym.box((0.455, 0.765, 0.0), (0.06, 0.16, 1.28), bevel=0.012)                                  # fascia panel
    asym.box((0.47, 0.60, 0.0), (0.10, 0.19, 0.20), bevel=0.02)                                     # centre console down to the tunnel
    # instrument binnacle ahead of the driver: hooded oval pod with seven dials
    asym.mat('leather_trim')
    asym.box((0.455, 0.830, DRV_Z), (0.14, 0.155, 0.47), bevel=0.05, seg=3)
    asym.mat('decal_dials')
    xq = 0.383
    decal(asym, 'dials', (xq, 0.765, DRV_Z + 0.215), (xq, 0.765, DRV_Z - 0.215), (xq, 0.883, DRV_Z - 0.215), (xq, 0.883, DRV_Z + 0.215))
    # centre: radio, clock, switches; the radar tracker hides behind the radio speaker grille
    decal(asym, 'radio', (0.4235, 0.715, 0.095), (0.4235, 0.715, -0.095), (0.4235, 0.762, -0.095), (0.4235, 0.762, 0.095))
    decal(asym, 'clock', (0.4235, 0.775, -0.26), (0.4235, 0.775, -0.33), (0.4235, 0.845, -0.33), (0.4235, 0.845, -0.26))
    asym.mat('decal_radar')
    decal(asym, 'radar', (0.4230, 0.770, 0.085), (0.4230, 0.770, -0.085), (0.4230, 0.845, -0.085), (0.4230, 0.845, 0.085))
    asym.mat('chrome')
    for k in range(6):                                                                              # toggle switches
        zs = -0.075 + k * 0.03
        asym.cyl((0.424, 0.695, zs), (0.405, 0.690, zs), 0.004, seg=6)
    asym.mat('dash')
    asym.box((0.44, 0.76, -0.38), (0.035, 0.11, 0.36), bevel=0.01)                                  # glovebox lid
    asym.mat('chrome')
    asym.cyl((0.421, 0.79, -0.38), (0.414, 0.79, -0.38), 0.011, seg=10)
    # steering column, mirror, gear lever, handbrake, pedals
    asym.mat('dash')
    asym.cyl((0.50, 0.70, DRV_Z), (0.22, 0.80, DRV_Z), 0.022, seg=12)
    asym.mat('chrome')
    asym.cyl((0.26, 0.775, DRV_Z + 0.02), (0.25, 0.80, DRV_Z + 0.13), 0.005, seg=6)                 # indicator stalk
    asym.mat('black')
    asym.box((0.30, 1.215, 0.0), (0.03, 0.055, 0.22), bevel=0.012)
    asym.mat('mirror')
    asym.quad((0.284, 1.193, -0.10), (0.284, 1.193, 0.10), (0.284, 1.237, 0.10), (0.284, 1.237, -0.10))
    asym.mat('chrome')
    asym.cyl((0.31, 1.24, 0), (0.33, 1.275, 0), 0.006, seg=6)
    asym.cyl((0.16, FLOOR + 0.17, 0.0), (0.10, 0.60, 0.02), 0.007, seg=8)                           # gear lever
    asym.mat('leather_trim')
    asym.grid(lambda u, v: (0.16 + math.cos(u * TAU) * 0.05 * (1 - v * 0.75), FLOOR + 0.17 + 0.09 * v, math.sin(u * TAU) * 0.05 * (1 - v * 0.75)), 10, 3, flip=True)   # gaiter
    asym.mat('black')
    asym.sphere((0.098, 0.615, 0.021), 0.024, seg=14, rings=8)
    asym.mat('lens_red')                                                                            # the red button under the flip-top
    asym.cyl((0.098, 0.636, 0.021), (0.098, 0.644, 0.021), 0.009, seg=10)
    asym.mat('chrome')
    asym.cyl((-0.05, FLOOR + 0.17, 0.13), (0.14, 0.52, 0.14), 0.008, seg=8)                         # fly-off handbrake
    asym.mat('black')
    asym.cyl((0.14, 0.52, 0.14), (0.19, 0.58, 0.14), 0.012, seg=8)
    asym.mat('chrome_satin')
    for dz, w in ((0.14, 0.05), (0.02, 0.05), (-0.11, 0.07)):                                       # pedals
        asym.box((0.80, FLOOR + 0.13, DRV_Z + dz), (0.012, 0.07 if w < 0.06 else 0.05, w), bevel=0.004)
    # centre armrest with the gadget switch panel under its lid
    asym.mat('leather_trim')
    asym.box((-0.30, FLOOR + 0.20, 0.0), (0.34, 0.08, 0.15), bevel=0.025)
    asym.push(tr(-0.47, FLOOR + 0.245, 0.0) @ rot_z(-1.25))
    asym.box((0.17, 0.0, 0.0), (0.34, 0.025, 0.15), bevel=0.01)                                     # lid, flipped open
    asym.pop()
    asym.mat('decal_panel')
    decal(asym, 'panel', (-0.455, FLOOR + 0.2415, 0.065), (-0.15, FLOOR + 0.2415, 0.065), (-0.15, FLOOR + 0.2415, -0.065), (-0.455, FLOOR + 0.2415, -0.065))

    # ---- seats: driver's is fixed, the passenger's is the ejector seat (its own part)
    seat(asym, DRV_Z)
    seat(seatp, -DRV_Z)

    # ---- driver: dinner-jacket figure, hands on the wheel
    d = driver
    zd = DRV_Z
    d.mat('suit')
    d.push(tr(-0.50, FLOOR + 0.27, zd) @ rot_z(0.30))
    d.box((0.07, 0.27, 0), (0.21, 0.56, 0.40), bevel=0.085, seg=3)
    d.box((0.07, 0.50, 0), (0.18, 0.11, 0.47), bevel=0.05, seg=3)
    d.pop()
    d.box((-0.22, FLOOR + 0.265, zd), (0.50, 0.13, 0.36), bevel=0.06, seg=3)
    for sg in (-1, 1):
        d.tube([(-0.51, 0.99, zd + sg * 0.215), (-0.22, 0.84, zd + sg * 0.235), (0.085, 0.865, zd + sg * 0.19)], 0.043, seg=8)
        d.tube([(0.0, FLOOR + 0.30, zd + sg * 0.10), (0.38, FLOOR + 0.22, zd + sg * 0.10), (0.74, FLOOR + 0.10, zd + sg * 0.09)], 0.055, seg=8)
    d.mat('shirt')
    d.box((-0.435, 0.95, zd), (0.05, 0.20, 0.10), bevel=0.02)
    d.mat('skin')
    for sg in (-1, 1):
        d.sphere((0.10, 0.868, zd + sg * 0.188), 0.045, seg=10, rings=6, scale=(1.1, 0.8, 0.8))
    d.cyl((-0.515, 1.02, zd), (-0.50, 1.09, zd), 0.052, seg=12)
    d.sphere((-0.495, 1.155, zd), 0.098, seg=18, rings=12, scale=(1.0, 1.16, 0.86))
    d.mat('hair')
    d.sphere((-0.512, 1.178, zd), 0.101, seg=18, rings=12, scale=(1.0, 1.08, 0.88))

    # ---- steering wheel (local frame: X along the column towards the driver, rim in the YZ plane)
    st = steer
    R = 0.205
    st.mat('wood')
    ring = [(0.0, math.cos(a) * R, math.sin(a) * R) for a in np.linspace(0, TAU, 49)[:-1]]
    st.tube(ring, 0.0125, seg=10, closed=True, up=(1, 0, 0))
    st.mat('alloy')
    for a in (0.0, math.pi / 2, math.pi):                 # spokes at 3, 6 and 9 o'clock, slotted
        st.push(rot_x(a))
        st.box((-0.016, 0.0, 0.115), (0.004, 0.040, 0.165))
        st.mat('black')
        for k in range(3):
            st.box((-0.0135, 0.0, 0.070 + k * 0.045), (0.0012, 0.012, 0.030))
        st.mat('alloy')
        st.pop()
    st.mat('black')
    st.lathe([(-0.060, 0.030), (-0.022, 0.036), (-0.006, 0.034), (0.004, 0.026), (0.006, 0.0)], seg=20, axis='x')
    st.mat('chrome')
    st.lathe([(0.004, 0.027), (0.0075, 0.020), (0.0085, 0.0)], seg=16, axis='x')
    return out


def build_gadgets(fast=False):
    out = []
    # ---- revolving number plates: three-sided drums (front and rear)
    for name, front in (('plateF', True), ('plateR', False)):
        p = Part(name, target=name)
        y = 0.335 if front else 0.615
        x = S.surf_x(0.0, y, front) + (0.050 if front else 0.012)
        p.pivot = (x - (0.036 if front else -0.036), y, 0.0)
        hw, hh, ap = 0.262, 0.057, 0.036
        for k in range(3):
            p.push(tr(*p.pivot) @ rot_z(k * TAU / 3) @ (Matrix.Identity(4) if front else rot_y(math.pi)))
            p.mat('black')
            p.box((ap - 0.004, 0, 0), (0.008, hh * 2 + 0.008, hw * 2 + 0.008))
            p.mat('decal_plate')
            L_ = ap + 0.0008
            if front:
                decal(p, 'plate%d' % k, (L_, -hh, hw), (L_, -hh, -hw), (L_, hh, -hw), (L_, hh, hw))
            else:
                decal(p, 'plate%d' % k, (L_, -hh, hw), (L_, -hh, -hw), (L_, hh, -hw), (L_, hh, hw))
            p.pop()
        out.append(p)
    # ---- rear bullet-proof screen: steel plate that rises out of the boot lid behind the back window
    sh = Part('shield', target='shield')
    sh.mat('armour')
    sh.pivot = (-1.70, 0.86, 0.0)
    sh.push(tr(-1.70, 0.62, 0.0) @ rot_z(-0.20))
    sh.box((0, 0.0, 0), (0.014, 0.50, 1.02), bevel=0.004)
    sh.pop()
    out.append(sh)
    # ---- tyre slashers: three-bladed cutters that telescope out of the rear wheel spinners (wheel frame, axle = Z)
    sl = Part('slasher', target='slasher')
    sl.mat('chrome')
    sl.cyl((0, 0, -0.10), (0, 0, 0.12), 0.014, seg=10)
    sl.lathe([(0.12, 0.020), (0.15, 0.016), (0.20, 0.0)], seg=10, axis='z')
    for k in range(3):
        sl.push(rot_z(k * TAU / 3))
        sl.sweep([(0.0, 0.0, 0.13), (0.045, 0.012, 0.125), (0.085, 0.035, 0.115), (0.115, 0.065, 0.10)], [(-0.012, 0.0), (0.0, 0.0025), (0.012, 0.0), (0.0, -0.0025)], up=(0, 0, 1))
        sl.pop()
    out.append(sl)
    return out
