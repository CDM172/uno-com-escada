# Exterior detail of the V8 Vantage: alloy wheels, bumpers, the blanked grille with its two driving lamps, round
# headlamps, air dam (intakes, indicators, plate), side strakes, mirrors, handles, wipers, tail lamps, rear plate,
# exhausts and wheel wells. Positions come from the scale drawing (see v8_shape.py).
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
import db5_parts as D
import v8_fields as F
import v8_shape as S
from db5_lib import Part

# The DB5 helpers (face/flank points, bumper paths, blades, lamps, decals) look the body up through these module
# globals: point them at the V8.
D.S, D.F = S, F
from db5_parts import blade, bumper_path, decal, double_side, face_pt, fix, flank_pt, lamp, rot_x, rot_y, rot_z, top_pt, tr  # noqa: E402

TAU = math.tau
# atlas regions (u0, v0, u1, v1), same layout as the DB5's; the game paints them per car
AT = dict(plate_f=(0.0, 0.0, 0.5, 0.11), plate_r=(0.0, 0.125, 0.5, 0.235), plate_x=(0.0, 0.25, 0.5, 0.36),
          dials=(0.0, 0.40, 0.80, 0.62), hud=(0.52, 0.0, 0.76, 0.18), panel=(0.78, 0.0, 1.0, 0.33),
          badge=(0.52, 0.20, 0.76, 0.27), script=(0.52, 0.29, 0.76, 0.36), radio=(0.0, 0.64, 0.40, 0.74), clock=(0.82, 0.40, 0.98, 0.56))
D.AT.update(AT)


def face_dir(p, faces, d):
    """Make an open surface face direction d."""
    p.bm.normal_update()
    fs = [f for f in faces if f.is_valid]
    if sum(f.normal.dot(Vector(d)) for f in fs) < 0:
        bmesh.ops.reverse_faces(p.bm, faces=fs)


# ---------------------------------------------------------------------------------- wheel
def build_wheel(fast=False):
    """15 x 8J five-spoke alloy on a 255/60 VR15 tyre. Local frame: axle along Z, outer face at +Z."""
    w = Part('wheel', target='wheel')
    R = S.WHEEL_R
    seg = 48 if fast else 80
    w.mat('tire')
    g, rb = 0.007, 0.2035
    prof = [(-0.098, rb - 0.004), (-0.112, rb + 0.010), (-0.124, 0.236), (-0.1285, 0.272), (-0.126, 0.304), (-0.117, 0.328), (-0.104, 0.343),
            (-0.094, R), (-0.066, R), (-0.064, R - g), (-0.056, R - g), (-0.054, R), (-0.024, R), (-0.022, R - g), (-0.014, R - g), (-0.012, R),
            (0.012, R), (0.014, R - g), (0.022, R - g), (0.024, R), (0.054, R), (0.056, R - g), (0.064, R - g), (0.066, R), (0.094, R),
            (0.104, 0.343), (0.117, 0.328), (0.126, 0.304), (0.1285, 0.272), (0.124, 0.236), (0.112, rb + 0.010), (0.098, rb - 0.004)]
    _, fs = w.lathe(prof, seg=seg, axis='z')
    fix(w, fs)
    # rim: polished outer lip, barrel, dished face down to the spoke plane
    w.mat('alloy')
    rim = [(0.098, rb - 0.004), (0.104, rb + 0.005), (0.109, rb + 0.001), (0.107, 0.196), (0.096, 0.190), (0.080, 0.187), (0.070, 0.186),
           (-0.090, 0.186), (-0.100, 0.192), (-0.104, rb), (-0.098, rb - 0.004)]
    _, fs = w.lathe(rim, seg=seg, axis='z')
    fix(w, fs)
    double_side(w, fs)
    _, fs = w.lathe([(0.070, 0.186), (0.060, 0.178), (0.052, 0.170), (0.050, 0.166)], seg=seg, axis='z')
    fix(w, fs)
    double_side(w, fs)
    # five flat spokes, slightly wider at the rim, and the hub boss
    for k in range(5):
        a = k / 5 * TAU + TAU / 4
        w.push(rot_z(a))
        _, fs = w.grid(lambda u, v: (0.062 + 0.110 * v, (u - 0.5) * (0.044 + 0.020 * v), 0.058 - 0.006 * v), 4, 4)
        face_dir(w, fs, (0, 0, 1))
        for s in (-1, 1):                                          # side walls of the spoke
            _, fs = w.grid(lambda u, v: (0.062 + 0.110 * v, s * 0.5 * (0.044 + 0.020 * v), 0.058 - 0.006 * v - 0.016 * u), 2, 4)
            face_dir(w, fs, (0, s, 0))
        w.pop()
    hub = [(0.030, 0.0), (0.030, 0.070), (0.050, 0.076), (0.060, 0.072), (0.064, 0.060), (0.066, 0.040)]
    _, fs = w.lathe(hub, seg=40, axis='z')
    fix(w, fs)
    w.mat('chrome')
    _, fs = w.lathe([(0.066, 0.040), (0.072, 0.036), (0.077, 0.024), (0.079, 0.0)], seg=32, axis='z')
    fix(w, fs)
    for k in range(5):                                              # wheel nuts between the spokes
        a = (k + 0.5) / 5 * TAU + TAU / 4
        c = (math.cos(a) * 0.057, math.sin(a) * 0.057)
        w.cyl((c[0], c[1], 0.060), (c[0], c[1], 0.073), 0.009, seg=6)
    # dark recess behind the spokes, brake disc and caliper
    w.mat('black')
    _, fs = w.lathe([(0.020, 0.168), (0.016, 0.120), (0.012, 0.075)], seg=40, axis='z')
    face_dir(w, fs, (0, 0, 1))
    w.mat('steel')
    w.cyl((0, 0, -0.030), (0, 0, -0.008), 0.140, seg=36)
    w.mat('black')
    w.box((0.0, 0.142, -0.020), (0.12, 0.07, 0.06), bevel=0.012)
    blur = Part('wheelblur', target='wheelblur').mat('wheelblur')
    blur.grid(lambda u, v: (math.cos(u * TAU) * (0.075 + v * 0.10), math.sin(u * TAU) * (0.075 + v * 0.10), 0.060 - v * 0.010), 40, 3)
    return [w, blur]


# ---------------------------------------------------------------------------------- exterior
FB = dict(y=0.490, h=0.050, d=0.028)      # front bumper blade: centre height, height, depth
RB = dict(y=0.519, h=0.058, d=0.030)      # rear


def fx(z, y):
    return S.surf_x(z, y, True)


def rx(z, y):
    return S.surf_x(z, y, False)


def build_exterior(fast=False):
    ext = Part('ext', mirror=True)
    out = [ext]
    nb = 28 if fast else 52

    # ---- bumpers: slim chrome blades with a black rubber insert, wrapping round to the wheel arches
    for front, Bd, a1, gap in ((True, FB, 0.86, 0.006), (False, RB, 0.98, 0.010)):
        ext.mat('chrome')
        path, o = bumper_path(Bd['y'], Bd['y'], front, a1, nb, gap)
        blade(ext, path, o, Bd['h'], Bd['d'], taper=0.05)
        ext.mat('rubber')
        blade(ext, [p + q * (Bd['d'] - 0.006) for p, q in zip(path, o)], o, 0.020, 0.009, taper=0.05)

    # ---- grille: mesh panel set back in the mouth, black walls, and the two Cibie driving lamps
    ext.mat('mesh')
    _, fs = ext.grid(lambda u, v: (fx(u * 0.505, 0.60) - 0.048, 0.506 + v * 0.210, u * 0.505), 12, 4)
    face_dir(ext, fs, (1, 0, 0))
    # crosshatch mesh in front of the backing (the drawing shows a fine square mesh across the whole mouth)
    ext.mat('black')
    for k in range(9):
        y = 0.522 + k * 0.022
        zm = 0.497
        pth = [(fx(z, y) - 0.036, y, z) for z in np.linspace(0.0, zm, 10)]
        ext.sweep(pth, [(-0.0022, -0.0022), (0.0022, -0.0022), (0.0022, 0.0022), (-0.0022, 0.0022)], up=(1, 0, 0))
    for k in range(23):
        z = 0.011 + k * 0.0215
        y1 = 0.700 + 0.012 * (1 - float(S.sm(0.30, 0.50, z)))
        pth = [(fx(z, y) - 0.034, y, z) for y in np.linspace(0.515, y1, 6)]
        ext.sweep(pth, [(-0.0018, -0.0018), (0.0018, -0.0018), (0.0018, 0.0018), (-0.0018, 0.0018)], up=(1, 0, 0))
    ring = []
    for t in np.linspace(0, 1, 40):                                   # outline of the mouth (right half, centre to centre)
        if t < 0.25:
            z, y = t / 0.25 * 0.50, 0.515
        elif t < 0.5:
            z, y = 0.50, 0.515 + (t - 0.25) / 0.25 * 0.18
        else:
            z, y = 0.50 * (1 - (t - 0.5) / 0.5), 0.695 + 0.014 * (1 - float(S.sm(0.30, 0.50, 0.50 * (1 - (t - 0.5) / 0.5))))
        ring.append((z, y))
    vs0 = [ext.bm.verts.new((fx(z, y) - 0.015, y, z)) for z, y in ring]
    vs1 = [ext.bm.verts.new((fx(z, y) - 0.050, y, z)) for z, y in ring]
    fw = [ext.bm.faces.new([vs0[i], vs0[i + 1], vs1[i + 1], vs1[i]]) for i in range(len(ring) - 1)]
    ext._finish(vs0 + vs1)
    face_dir(ext, fw, (0, -1, 0))
    double_side(ext, fw)
    # (the two driving lamps are the 'foglamp' gadget part, see v8_interior.build_gadgets); their missile tubes:
    x = fx(F.DRIVE_Z, F.DRIVE_Y) - 0.030
    ext.mat('black')
    ext.cyl((x - 0.52, F.DRIVE_Y, F.DRIVE_Z), (x - 0.09, F.DRIVE_Y, F.DRIVE_Z), 0.046, seg=16)

    # ---- headlamps: round 7 in units in the nose, in black tunnels behind the bezel openings
    c, n = face_pt(F.HEAD_Z, F.HEAD_Y, True)
    ext.mat('black')
    ext.cyl(c - n * 0.075, c - n * 0.004, F.HEAD_R + 0.002, seg=32, cap0=True, cap1=False)
    q = Vector((1, 0, 0)).rotation_difference(n).to_matrix().to_4x4()
    ext.push(Matrix.Translation(c - n * 0.016) @ q)
    r = F.HEAD_R - 0.006
    ext.mat('chrome')
    _, fs = ext.lathe([(-0.010, r + 0.008), (0.006, r + 0.008), (0.012, r + 0.003), (0.012, r - 0.002), (0.006, r - 0.006)], seg=40, axis='x')
    fix(ext, fs)
    ext.mat('reflector')
    _, fs = ext.lathe([(-0.055, 0.0), (-0.050, 0.030), (-0.035, 0.058), (-0.012, 0.075), (0.006, r - 0.006)], seg=32, axis='x')
    fix(ext, fs)
    bmesh.ops.reverse_faces(ext.bm, faces=[f for f in fs if f.is_valid])
    ext.mat('lens_clear')
    _, fs = ext.lathe([(0.006, r - 0.005), (0.016, r * 0.80), (0.022, r * 0.45), (0.024, 0.0)], seg=32, axis='x')
    fix(ext, fs)
    ext.pop()

    # ---- air dam: intake recesses, indicators, front plate
    ext.mat('mesh')
    _, fs = ext.grid(lambda u, v: (fx(0.372 + 0.194 * u, 0.378) - 0.040, 0.328 + 0.100 * v, 0.372 + 0.194 * u), 4, 2)
    face_dir(ext, fs, (1, 0, 0))
    c, n = face_pt(0.690, 0.400, True)
    q = Vector((1, 0, 0)).rotation_difference(n).to_matrix().to_4x4()
    ext.push(Matrix.Translation(c) @ q)
    ext.mat('chrome')
    ext.box((0.002, 0, 0), (0.008, 0.044, 0.150), bevel=0.003)
    ext.mat('lens_amber')
    ext.box((0.006, 0, 0), (0.006, 0.034, 0.138), bevel=0.003)
    ext.pop()
    c, n = flank_pt(1.985, 0.735)                                    # side repeaters on the front wings
    ext.mat('lens_amber')
    ext.box((c.x, c.y, c.z + 0.002), (0.046, 0.013, 0.006), bevel=0.002)

    # ---- tail lamps: four segments in each recess (indicator, tail/stop, tail, reversing), chrome dividers
    segs = ((0.655, 0.733, 'lens_amber'), (0.575, 0.655, 'lens_red'), (0.500, 0.575, 'lens_red'), (0.425, 0.500, 'lens_white'))
    for z0, z1, m in segs:
        ext.mat(m)
        _, fs = ext.grid(lambda u, v: (rx(z0 + (z1 - z0) * u, F.TAIL_Y0 + 0.004 + (F.TAIL_Y1 - F.TAIL_Y0 - 0.008) * v) + 0.006,
                                       F.TAIL_Y0 + 0.004 + (F.TAIL_Y1 - F.TAIL_Y0 - 0.008) * v, z0 + (z1 - z0) * u), 3, 2)
        face_dir(ext, fs, (-1, 0, 0))
        ext.mat('chrome')
        xm = rx(z0, 0.625)
        ext.box((xm - 0.004, 0.625, z0), (0.010, 0.094, 0.006))
    # reversing / fog lamps beside the rear plate
    for z in (0.382,):
        c = Vector((rx(z, 0.405) - 0.004, 0.405, z))
        ext.mat('chrome')
        ext.box(c, (0.012, 0.064, 0.128), bevel=0.003)
        ext.mat('lens_white')
        ext.box(c - Vector((0.004, 0, 0)), (0.008, 0.054, 0.118), bevel=0.003)

    # ---- side strakes: dark box behind the slot, chrome bar across it
    ext.mat('black')
    zc = S.side_z(0.74, 0.72)
    ext.box((0.74, 0.719, zc - 0.045), (0.48, 0.08, 0.02))
    ext.mat('chrome')
    pth = [Vector((x, 0.715, S.side_z(x, 0.715) + 0.003)) for x in np.linspace(0.50, 0.99, 14)]
    _, fs = ext.sweep(pth, [(-0.004, -0.003), (0.004, -0.003), (0.003, 0.003), (-0.003, 0.003)], up=(0, 0, 1))
    fix(ext, fs)

    # ---- door handles: chrome pull set into the door below the waist
    c, n = flank_pt(-0.733, 0.803)
    ext.mat('black')
    ext.box((-0.733, 0.803, c.z - 0.004), (0.180, 0.030, 0.012), bevel=0.004)
    ext.mat('chrome')
    ext.box((-0.733, 0.806, c.z + 0.003), (0.168, 0.016, 0.010), bevel=0.004)
    ext.cyl((-0.830, 0.796, c.z - 0.003), (-0.830, 0.796, c.z + 0.006), 0.009, seg=12)

    # ---- door mirrors: black heads on stalks at the front of the door glass
    mx = 0.180
    base = Vector((mx, B_Y(), S.side_z(mx, B_Y() - 0.01) - 0.02))
    head = Vector((0.150, 1.000, 0.930))
    ext.mat('black')
    _, fs = ext.sweep([base, (base + head) / 2 + Vector((0, 0.012, 0)), head - Vector((0, 0, 0.03))],
                      [(-0.010, -0.006), (0.010, -0.006), (0.008, 0.006), (-0.008, 0.006)], up=(0, 1, 0))
    fix(ext, fs)
    ext.box(head, (0.060, 0.070, 0.115), bevel=0.018, seg=3)
    ext.mat('mirror')
    ext.box(head - Vector((0.031, 0, 0)), (0.002, 0.056, 0.098))

    # ---- wheel wells: dark liners so the arches do not look into the body
    ext.mat('under')
    for ax, ra in ((S.AXF, F.ARCH_RF), (S.AXR, F.ARCH_RR)):
        ext.grid(lambda u, v: (ax + math.cos(math.pi * (1.16 * u - 0.08)) * (ra + 0.01), S.ARCH_Y + math.sin(math.pi * (1.16 * u - 0.08)) * (ra + 0.005),
                               0.52 + (S.side_z(ax, 0.72) - 0.55) * v), 24, 1)
        ext.grid(lambda u, v: (ax - ra - 0.05 + (2 * ra + 0.1) * u, 0.24 + (min(0.86, S.top_y(ax - ra - 0.05 + (2 * ra + 0.1) * u, 0.52) - 0.04) - 0.24) * v, 0.52), 10, 1)

    # ---- asymmetric: front and rear plates, wipers, boot script, exhausts and silencer
    asym = Part('ext_asym')
    asym.mat('decal_plate')
    y0, y1 = 0.318, 0.429
    xp = max(fx(z, y) for z in (0.0, 0.13, 0.26) for y in (y0, y1)) + 0.012     # a flat plate stands proud of the curved face
    asym.mat('black')
    asym.box((xp - 0.006, (y0 + y1) / 2, 0.0), (0.010, y1 - y0 + 0.012, 0.536))
    asym.mat('decal_plate')
    decal(asym, 'plate_f', (xp, y0, -0.26), (xp, y0, 0.26), (xp, y1, 0.26), (xp, y1, -0.26))
    # (the rear plate is the 'plateR' gadget part: it flips down to uncover the rocket)
    asym.mat('decal_badge')
    sxp = lambda z, y: rx(z, y) - 0.003
    decal(asym, 'script', (sxp(-0.10, 0.700), 0.700, -0.10), (sxp(-0.30, 0.700), 0.700, -0.30), (sxp(-0.30, 0.730), 0.730, -0.30), (sxp(-0.10, 0.730), 0.730, -0.10))

    def ws_pt(z, s, lift=0.012):
        az = abs(z)
        xb, xh = 0.570 - 0.195 * (az / 0.767) ** 2.0, -0.100 + 0.010 * (az / 0.716) ** 2
        yb, yh = 0.952 - 0.034 * (az / 0.767) ** 2, 1.306 - 0.026 * (az / 0.716) ** 2
        ln = math.hypot(xb - xh, yh - yb)
        x = xb - (s / ln) * (xb - xh)
        return Vector((x, float(S.windscreen(x, np.array([az]))[0]) + lift, z))
    for z0, z1 in ((0.36, -0.12), (-0.20, -0.66)):                 # parked pointing to the car's left
        piv = ws_pt(z0, -0.040, 0.0)
        piv.y = S.top_y(piv.x, z0) + 0.004
        asym.mat('black')
        asym.cyl(piv - Vector((0, 0.01, 0)), piv + Vector((0, 0.014, 0)), 0.011, seg=10)
        mid = ws_pt((z0 + z1) / 2, 0.050, 0.020)
        _, fs = asym.sweep([piv + Vector((0, 0.016, 0)), (piv + mid) / 2 + Vector((0, 0.014, 0)), mid], [(-0.005, -0.002), (0.005, -0.002), (0.005, 0.002), (-0.005, 0.002)])
        fix(asym, fs)
        asym.mat('rubber')
        _, fs = asym.sweep([ws_pt(z0 + (z1 - z0) * (0.08 + 0.92 * k / 7), 0.042 + 0.020 * k / 7) for k in range(8)], [(-0.005, -0.006), (0.005, -0.006), (0.002, 0.007), (-0.002, 0.007)])
        fix(asym, fs)
    for z in (0.507, -0.507):                                        # one big oval tailpipe each side, silencer box between
        asym.mat('chrome')
        _, fs = asym.lathe([(0.20, 0.040), (0.0, 0.040), (-0.005, 0.043), (0.0, 0.035), (0.10, 0.035)], seg=20, axis='x', origin=(-2.395, 0.324, z))
        fix(asym, fs)
        asym.mat('black')
        asym.cyl((-2.30, 0.324, z), (-2.12, 0.30, z * 0.8), 0.03, seg=10)
    asym.box((-2.12, 0.262, 0.0), (0.20, 0.12, 0.88), bevel=0.04)
    out.append(asym)
    return out


def B_Y():
    return S.BELT + 0.012
