# Exterior detail of the DB5: wheels, bumpers, grille, lamps, vents, mirrors, wipers, exhausts, underbody.
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
import db5_shape as S
from db5_lib import Part, material

TAU = math.tau


def fix(p, faces):
    bmesh.ops.recalc_face_normals(p.bm, faces=[f for f in faces if f.is_valid])


def double_side(p, faces):
    """Thin open shells seen from both sides: add a reversed copy."""
    d = bmesh.ops.duplicate(p.bm, geom=[f for f in faces if f.is_valid])
    nf = [g for g in d['geom'] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(p.bm, faces=nf)
    return nf


def rot_x(a):
    return Matrix.Rotation(a, 4, 'X')


def rot_y(a):
    return Matrix.Rotation(a, 4, 'Y')


def rot_z(a):
    return Matrix.Rotation(a, 4, 'Z')


def tr(x, y, z):
    return Matrix.Translation((x, y, z))


# ---------------------------------------------------------------------------------- wheel
def build_wheel(fast=False):
    """Wire wheel, local frame: axle along Z, outer face at +Z."""
    w = Part('wheel', target='wheel')
    R = S.WHEEL_R
    seg = 40 if fast else 72
    w.mat('tire')
    prof = [(-0.070, 0.193), (-0.080, 0.205), (-0.0845, 0.240), (-0.0840, 0.275), (-0.078, 0.305), (-0.066, 0.327), (-0.050, 0.3365),
            (-0.047, R), (-0.031, R), (-0.029, R - 0.006), (-0.025, R - 0.006), (-0.023, R), (-0.004, R), (-0.002, R - 0.006), (0.002, R - 0.006), (0.004, R),
            (0.023, R), (0.025, R - 0.006), (0.029, R - 0.006), (0.031, R), (0.047, R),
            (0.050, 0.3365), (0.066, 0.327), (0.078, 0.305), (0.0840, 0.275), (0.0845, 0.240), (0.080, 0.205), (0.070, 0.193)]
    _, fs = w.lathe(prof, seg=seg, axis='z')
    fix(w, fs)
    # rim: polished well + rolled edges
    w.mat('chrome')
    rim = [(0.070, 0.193), (0.076, 0.199), (0.079, 0.196), (0.076, 0.190), (0.060, 0.186), (0.045, 0.176), (0.0, 0.172), (-0.045, 0.176), (-0.060, 0.186), (-0.076, 0.190), (-0.079, 0.196), (-0.076, 0.199), (-0.070, 0.193)]
    _, fs = w.lathe(rim, seg=seg, axis='z')
    fix(w, fs)
    double_side(w, fs)
    # hub shell and knock-off spinner
    hub = [(-0.060, 0.0), (-0.060, 0.050), (-0.030, 0.056), (-0.026, 0.066), (-0.020, 0.066), (-0.016, 0.050), (0.040, 0.040), (0.052, 0.047), (0.058, 0.047), (0.062, 0.036), (0.070, 0.034), (0.086, 0.026), (0.094, 0.012), (0.096, 0.0)]
    _, fs = w.lathe(hub, seg=28, axis='z')
    fix(w, fs)
    for k in range(2):
        w.push(rot_z(k * math.pi + 0.5))
        w.box((0.062, 0.0, 0.078), (0.075, 0.020, 0.012), bevel=0.005, seg=2)
        w.pop()
    # 72 spokes in two rows, laced tangentially
    w.mat('spoke')
    n = 18 if fast else 36
    for row, (rh, zh, zr, lace) in enumerate([(0.045, 0.050, 0.012, 0.42), (0.062, -0.024, -0.012, 0.30)]):
        for k in range(n):
            a = k / n * TAU + row * 0.5 * TAU / n
            s = 1 if k % 2 else -1
            a2 = a + s * lace
            w.cyl((math.cos(a) * rh, math.sin(a) * rh, zh), (math.cos(a2) * 0.176, math.sin(a2) * 0.176, zr), 0.0024, seg=5, cap0=False, cap1=False)
    # brake drum and back plate
    w.mat('black')
    w.cyl((0, 0, -0.075), (0, 0, -0.025), 0.150, seg=28)
    # translucent "spinning spokes" disc, drawn only when the wheel turns fast
    blur = Part('wheelblur', target='wheelblur').mat('wheelblur')
    blur.grid(lambda u, v: (math.cos(u * TAU) * (0.05 + v * 0.125), math.sin(u * TAU) * (0.05 + v * 0.125), 0.045 - v * 0.035), 40, 3)
    return [w, blur]


# ---------------------------------------------------------------------------------- body helpers
def bumper(p, y, front, a1, n=40, off=0.024, hgt=0.088, dep=0.036):
    cx = 0.9 if front else -1.0
    a0 = 0.0 if front else math.pi
    pts = S.outline(y, cx, a0, a0 + (a1 if front else -a1), n)
    # push out along the plan normal
    path = []
    for i, q in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = Vector((b[0] - a[0], 0, b[2] - a[2])).normalized()
        nrm = Vector((t.z, 0, -t.x)) * (1 if front else -1)
        if nrm.x * (1 if front else -1) < 0 and i < 3:
            nrm = -nrm
        path.append(Vector(q) + nrm * off)
    path[0].z = -0.001
    h, d = hgt / 2, dep
    prof = [(-0.012, -h), (d * 0.55, -h * 0.94), (d * 0.9, -h * 0.6), (d, 0.0), (d * 0.9, h * 0.6), (d * 0.55, h * 0.94), (-0.012, h)]
    sgn = 1 if front else -1
    prof = [(-a * sgn, b) for a, b in prof]
    _, fs = p.sweep(path, prof, caps=True)
    fix(p, fs)
    return path


def lamp(p, c, n, r, lens_mat, ring_mat='chrome', depth=0.02, bulge=0.012, seg=24):
    """Round lamp at c facing direction n: chrome bezel + domed lens."""
    n = Vector(n).normalized()
    q = Vector((1, 0, 0)).rotation_difference(n).to_matrix().to_4x4()
    p.push(Matrix.Translation(c) @ q)
    p.mat(ring_mat)
    _, fs = p.lathe([(-depth, r * 1.16), (0.004, r * 1.16), (0.010, r * 1.10), (0.010, r * 1.0), (0.002, r * 0.98)], seg=seg, axis='x')
    fix(p, fs)
    p.mat(lens_mat)
    _, fs = p.lathe([(0.003, r * 0.99), (0.003 + bulge * 0.55, r * 0.8), (0.003 + bulge * 0.9, r * 0.45), (0.003 + bulge, 0.0)], seg=seg, axis='x')
    fix(p, fs)
    p.pop()


def nrm_at(z, y, front):
    e = 0.01
    x0 = S.surf_x(z, y, front)
    dz = (S.surf_x(z + e, y, front) - S.surf_x(z - e, y, front)) / (2 * e)
    dy = (S.surf_x(z, y + e, front) - S.surf_x(z, y - e, front)) / (2 * e)
    s = 1 if front else -1
    return Vector((x0, y, z)), Vector((s, -dy * s, -dz * s)).normalized()


def build_exterior(fast=False):
    ext = Part('ext', mirror=True)
    ramF = Part('ramF', mirror=True, target='ramF')
    ramR = Part('ramR', mirror=True, target='ramR')
    out = [ext, ramF, ramR]

    # ---- bumpers: slim chrome blades that wrap round to the wheel arches, with over-riders
    ext.mat('chrome')
    bumper(ext, 0.430, True, 1.02, n=28 if fast else 56)
    bumper(ext, 0.455, False, 0.80, n=28 if fast else 56)
    for part, front, y in ((ramF, True, 0.418), (ramR, False, 0.455)):
        x = S.surf_x(0.33, y, front) + (0.075 if front else -0.075)
        part.mat('chrome')
        part.box((x, y + 0.030, 0.33), (0.055, 0.200, 0.058), bevel=0.026, seg=4)
        part.mat('black')
        part.box((x + (0.029 if front else -0.029), y + 0.012, 0.33), (0.012, 0.10, 0.026), bevel=0.005)
        part.mat('chrome_satin')                                   # telescopic arm, hidden inside the body until deployed
        part.cyl((x - (0.36 if front else -0.36), y, 0.33), (x, y, 0.33), 0.016, seg=10)

    # ---- grille: chrome surround comes from the body cut; here the slats and the dark box behind
    gx = S.surf_x(0.0, 0.55, True)
    ext.mat('black')
    ext.grid(lambda u, v: (gx - 0.10 - 0.05 * u * u, 0.43 + v * 0.26, u * 0.42), 6, 4, flip=True)
    ext.mat('chrome_satin')
    nb = 14
    for k in range(nb):
        y = 0.462 + k * (0.186 / (nb - 1))
        zmax = 0.395 - 0.06 * abs((k - 5.0) / 6.0) ** 2 if k < 11 else (0.37 if k == 11 else (0.33 if k == 12 else 0.20))
        path = [(S.surf_x(z, min(y, 0.60), True) - 0.035 - 0.02 * (z / 0.37) ** 2, y, z) for z in np.linspace(0, zmax, 7)]
        ext.sweep(path, [(-0.002, -0.0035), (0.012, -0.002), (0.012, 0.002), (-0.002, 0.0035)], up=(0, 1, 0))
    for z in (0.0, 0.11, 0.22, 0.33):
        x = S.surf_x(z, 0.55, True) - 0.03 - 0.02 * (z / 0.37) ** 2
        ext.box((x, 0.548, z), (0.005, 0.17 if z < 0.3 else 0.13, 0.005))

    # ---- headlamps behind the Perspex cowls: chrome bowl, lens ring, bulb shield
    hz, hy = 0.640, 0.672
    hx = S.surf_x(hz, hy, True) - 0.115
    ext.push(tr(hx, hy, hz) @ rot_z(0.10))
    ext.mat('reflector')
    _, fs = ext.lathe([(0.0, 0.0), (0.004, 0.030), (0.018, 0.056), (0.040, 0.074), (0.060, 0.082)], seg=28, axis='x')
    fix(ext, fs)
    bmesh.ops.reverse_faces(ext.bm, faces=[f for f in fs if f.is_valid])
    ext.mat('chrome')
    _, fs = ext.lathe([(0.052, 0.082), (0.066, 0.090), (0.072, 0.088), (0.070, 0.080), (0.060, 0.080)], seg=28, axis='x')
    fix(ext, fs)
    ext.mat('lens_clear')
    _, fs = ext.lathe([(0.062, 0.080), (0.070, 0.060), (0.075, 0.030), (0.076, 0.0)], seg=28, axis='x')
    fix(ext, fs)
    ext.pop()
    # ---- front side/indicator lamps (the machine guns hide behind them) and their animated twins
    c, n = nrm_at(0.600, 0.505, True)
    gunlamp = Part('gunlamp', mirror=True, target='gunlamp')
    lamp(gunlamp, c - n * 0.004, n, 0.036, 'lens_amber')
    guns = Part('guns', mirror=True, target='guns')
    guns.mat('gunmetal')
    gx0 = c.x - 0.34
    guns.cyl((gx0, 0.505, 0.600), (c.x - 0.03, 0.505, 0.600), 0.0135, seg=12)
    guns.cyl((gx0 + 0.05, 0.505, 0.600), (gx0 + 0.20, 0.505, 0.600), 0.021, seg=12)
    for k in range(5):
        guns.cyl((c.x - 0.10 + k * 0.012, 0.505, 0.600), (c.x - 0.094 + k * 0.012, 0.505, 0.600), 0.0165, seg=10)
    guns.mat('black')
    guns.cyl((c.x - 0.031, 0.505, 0.600), (c.x - 0.0295, 0.505, 0.600), 0.008, seg=10)
    guns.mat('muzzle')
    guns.grid(lambda u, v: (c.x - 0.02 + 0.16 * v, 0.505 + math.cos(u * TAU) * 0.05 * math.sin(v * math.pi) ** 0.6, 0.600 + math.sin(u * TAU) * 0.05 * math.sin(v * math.pi) ** 0.6), 8, 4)
    out += [gunlamp, guns]

    # ---- tail lamps: chrome plinth on the end of each fin with three round units (indicator, stop/tail, reverse)
    tz = 0.655
    pts = [nrm_at(tz, y, False) for y in (0.555, 0.60, 0.66, 0.72, 0.775, 0.815)]
    ext.mat('chrome')
    ext.sweep([c + n * 0.004 for c, n in pts], [(-0.052, -0.012), (-0.040, 0.010), (0.040, 0.010), (0.052, -0.012)], up=(1, 0, 0))
    for y, m, r, bulge in ((0.770, 'lens_amber', 0.040, 0.030), (0.680, 'lens_red', 0.040, 0.016), (0.592, 'lens_white', 0.040, 0.012)):
        c, n = nrm_at(tz, y, False)
        lamp(ext, c + n * 0.012, n, r, m, depth=0.012, bulge=bulge)
    # small red reflectors on the bumper ends, and the number-plate lamp housing with the boot handle
    c, n = nrm_at(0.70, 0.455, False)
    lamp(ext, c + n * 0.062, n, 0.017, 'lens_red', depth=0.008, bulge=0.006, seg=12)

    # ---- wing vents: recessed box, chrome strake and three louvres
    vx, vy = 0.675, 0.665
    vz = float(S.wall(vx, vy))
    ext.mat('black')
    ext.box((vx, vy, vz - 0.05), (0.26, 0.10, 0.03))
    ext.mat('chrome')
    ext.box((vx - 0.03, vy, vz - 0.002), (0.27, 0.014, 0.014), bevel=0.004)
    ext.mat('chrome_satin')
    for k in (-1, 1):
        ext.box((vx, vy + k * 0.02, vz - 0.022), (0.22, 0.004, 0.02))

    # ---- door handle, lock, quarter-light catch
    hz2 = float(S.wall(-0.33, 0.845))
    ext.mat('chrome')
    ext.box((-0.33, 0.845, hz2 + 0.012), (0.115, 0.020, 0.018), bevel=0.007, seg=3)
    ext.cyl((-0.37, 0.845, hz2 - 0.01), (-0.37, 0.845, hz2 + 0.006), 0.012, seg=12)
    ext.cyl((-0.245, 0.845, hz2 - 0.005), (-0.245, 0.845, hz2 + 0.004), 0.011, seg=12)

    # ---- wing mirrors: round chrome heads on stalks, on the front wings
    mx, my = 0.80, float(S.top(0.80, 0.60)) - 0.02
    ext.mat('chrome')
    ext.cyl((mx, my, 0.60), (mx - 0.010, my + 0.050, 0.612), 0.008, seg=8)
    ext.push(tr(mx - 0.035, my + 0.085, 0.615) @ rot_z(-0.04))
    _, fs = ext.lathe([(-0.004, 0.0), (-0.003, 0.046), (0.006, 0.049), (0.040, 0.044), (0.075, 0.030), (0.100, 0.012), (0.108, 0.0)], seg=22, axis='x')
    fix(ext, fs)
    ext.mat('mirror')
    ext.cyl((-0.0055, 0, 0), (-0.0045, 0, 0), 0.043, seg=22)
    ext.pop()

    # ---- exhausts: twin chrome tailpipes under the rear valance
    ext.mat('chrome')
    for dz in (0.0, 0.055):
        z = 0.40 + dz
        _, fs = ext.lathe([(0.30, 0.019), (0.0, 0.019), (-0.004, 0.0215), (0.0, 0.017), (0.12, 0.017)], seg=14, axis='x', origin=(-2.46, 0.275, z))
        fix(ext, fs)
    ext.mat('black')
    ext.box((-1.95, 0.26, 0.43), (0.5, 0.11, 0.2), bevel=0.04)

    # ---- underbody: floor, wheel wells, valances closed off
    ext.mat('under')
    ext.quad((1.95, 0.225, 0), (-2.25, 0.225, 0), (-2.25, 0.225, 0.74), (1.95, 0.225, 0.74))
    for ax in (S.AXF, S.AXR):
        R0 = S.ARCH_R + 0.012
        zo = float(S.wall(ax, 0.6)) - 0.02
        ext.grid(lambda u, v: (ax + math.cos(math.pi * (1.06 * u - 0.03)) * R0, S.ARCH_Y + math.sin(math.pi * (1.06 * u - 0.03)) * R0, 0.36 + (zo - 0.36) * v), 22, 1)
        ext.quad((ax - 0.42, 0.22, 0.36), (ax + 0.42, 0.22, 0.36), (ax + 0.42, 0.80, 0.36), (ax - 0.42, 0.80, 0.36))

    # ---- asymmetric bits: wipers, boot handle, aerial
    asym = Part('ext_asym')
    asym.mat('chrome_satin')
    for z0, z1 in ((0.36, -0.16), (-0.22, -0.60)):
        def wp(z, lift):
            x = 0.57 + 0.12 * (abs(z) / 0.6) ** 2 - lift
            return Vector((x, float(S.top(x, abs(z))) + 0.012, z))
        a = wp(z0, -0.035)
        m = wp((z0 + z1) / 2, 0.01)
        asym.cyl(a, a + Vector((0, 0.012, 0)), 0.012, seg=10)
        asym.sweep([a + Vector((0, 0.012, 0)), (a + m) / 2 + Vector((0, 0.016, 0)), m + Vector((0, 0.008, 0))], [(-0.005, -0.002), (0.005, -0.002), (0.005, 0.002), (-0.005, 0.002)])
        asym.mat('rubber')
        asym.sweep([wp(z0 + (z1 - z0) * (0.12 + 0.88 * k / 6), 0.0 + 0.03 * k / 6) for k in range(7)], [(-0.006, -0.006), (0.006, -0.006), (0.003, 0.006), (-0.003, 0.006)])
        asym.mat('chrome_satin')
    c, n = nrm_at(0.0, 0.735, False)
    asym.mat('chrome')
    asym.box((c.x - 0.016, 0.735, 0.0), (0.050, 0.030, 0.30), bevel=0.012, seg=3)
    out.append(asym)
    return out
