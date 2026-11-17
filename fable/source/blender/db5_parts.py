# Exterior detail of the DB5: wheels, bumpers and over-riders, grille, headlamps in their nacelles, side and
# tail lamps, wing vents, mirrors, wipers, handles, badges, exhausts, wheel wells. Positions come from the
# scale drawings and the reference photographs (see db5_shape.py).
import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import db5_fields as F
import db5_lib as L
import db5_shape as S
from db5_lib import Part

TAU = math.tau

# atlas regions (u0, v0, u1, v1) — must match the canvas drawn by the game
AT = dict(
    plate0=(0.0, 0.0, 0.5, 0.11), plate1=(0.0, 0.125, 0.5, 0.235), plate2=(0.0, 0.25, 0.5, 0.36),
    dials=(0.0, 0.40, 0.80, 0.62), radar=(0.52, 0.0, 0.76, 0.18), panel=(0.78, 0.0, 1.0, 0.33),
    wings=(0.52, 0.20, 0.76, 0.27), script=(0.52, 0.29, 0.76, 0.36), radio=(0.0, 0.64, 0.40, 0.74), clock=(0.82, 0.40, 0.98, 0.56),
)


def decal(p, name, a, b, c, d):
    """Quad a-b-c-d (counter-clockwise seen from outside); a = bottom-left of the image."""
    u0, v0, u1, v1 = AT[name]
    return p.quad(a, b, c, d, uv=[(u0, v1), (u1, v1), (u1, v0), (u0, v0)])


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


def face_pt(z, y, front):
    """Point on the nose/tail face and its outward normal."""
    e = 0.012
    x0 = S.surf_x(z, y, front)
    dz = (S.surf_x(z + e, y, front) - S.surf_x(z - e, y, front)) / (2 * e)
    dy = (S.surf_x(z, y + e, front) - S.surf_x(z, y - e, front)) / (2 * e)
    s = 1 if front else -1
    return Vector((x0, y, z)), Vector((s, -dy * s, -dz * s)).normalized()


def flank_pt(x, y):
    e = 0.012
    z0 = S.side_z(x, y)
    dx = (S.side_z(x + e, y) - S.side_z(x - e, y)) / (2 * e)
    dy = (S.side_z(x, y + e) - S.side_z(x, y - e)) / (2 * e)
    return Vector((x, y, z0)), Vector((-dx, -dy, 1.0)).normalized()


def top_pt(x, z):
    return Vector((x, S.top_y(x, z), z))


# ---------------------------------------------------------------------------------- wheel
def build_wheel(fast=False):
    """72-spoke wire wheel with its tyre. Local frame: axle along Z, outer face at +Z."""
    w = Part('wheel', target='wheel')
    R = S.WHEEL_R
    seg = 40 if fast else 72
    # 6.70 x 15 cross-ply: tall, rounded shoulders, four circumferential grooves
    w.mat('tire')
    g = 0.0065
    prof = [(-0.069, 0.196), (-0.079, 0.206), (-0.0845, 0.236), (-0.0850, 0.272), (-0.080, 0.302), (-0.069, 0.324), (-0.055, 0.334),
            (-0.049, R), (-0.034, R), (-0.032, R - g), (-0.027, R - g), (-0.025, R), (-0.0105, R), (-0.0085, R - g), (-0.0035, R - g), (-0.0015, R),
            (0.0015, R), (0.0035, R - g), (0.0085, R - g), (0.0105, R), (0.025, R), (0.027, R - g), (0.032, R - g), (0.034, R), (0.049, R),
            (0.055, 0.334), (0.069, 0.324), (0.080, 0.302), (0.0850, 0.272), (0.0845, 0.236), (0.079, 0.206), (0.069, 0.196)]
    _, fs = w.lathe(prof, seg=seg, axis='z')
    fix(w, fs)
    # rim: rolled edges and the deep polished well
    w.mat('chrome')
    rim = [(0.069, 0.196), (0.075, 0.203), (0.0785, 0.200), (0.0765, 0.193), (0.062, 0.189), (0.046, 0.177), (0.012, 0.171), (-0.012, 0.171),
           (-0.046, 0.177), (-0.062, 0.189), (-0.0765, 0.193), (-0.0785, 0.200), (-0.075, 0.203), (-0.069, 0.196)]
    _, fs = w.lathe(rim, seg=seg, axis='z')
    fix(w, fs)
    double_side(w, fs)
    # hub shell
    hub = [(-0.064, 0.0), (-0.064, 0.052), (-0.036, 0.058), (-0.032, 0.070), (-0.026, 0.070), (-0.022, 0.054), (0.030, 0.043), (0.046, 0.050),
           (0.052, 0.050), (0.056, 0.040), (0.060, 0.0)]
    _, fs = w.lathe(hub, seg=28, axis='z')
    fix(w, fs)
    # knock-off spinner: domed nut with three ears
    _, fs = w.lathe([(0.056, 0.040), (0.062, 0.041), (0.070, 0.036), (0.084, 0.026), (0.093, 0.013), (0.096, 0.0)], seg=24, axis='z')
    fix(w, fs)
    for k in range(3):
        w.push(rot_z(k * TAU / 3 + 0.4))
        _, fs = w.sweep([(0.030, 0.0, 0.068), (0.052, 0.0, 0.072), (0.072, 0.004, 0.071), (0.086, 0.010, 0.068)],
                        [(-0.010, -0.005), (0.010, -0.005), (0.007, 0.005), (-0.007, 0.005)], up=(0, 0, 1))
        fix(w, fs)
        w.pop()
    # 72 spokes: outer row from the hub nose to the rim edge, inner row from the hub flange to the well, cross laced
    w.mat('spoke')
    n = 18 if fast else 36
    for row, (rh, zh, rr, zr, lace) in enumerate([(0.047, 0.048, 0.180, 0.030, 0.50), (0.066, -0.028, 0.172, -0.006, 0.36)]):
        for k in range(n):
            a = k / n * TAU + row * 0.5 * TAU / n
            a2 = a + (1 if k % 2 else -1) * lace
            w.cyl((math.cos(a) * rh, math.sin(a) * rh, zh), (math.cos(a2) * rr, math.sin(a2) * rr, zr), 0.0023, seg=5, cap0=False, cap1=False)
    # brake disc, caliper and back plate behind the spokes
    w.mat('steel')
    w.cyl((0, 0, -0.050), (0, 0, -0.038), 0.146, seg=36)
    w.mat('black')
    w.cyl((0, 0, -0.085), (0, 0, -0.052), 0.118, seg=24)
    w.box((0.0, 0.150, -0.044), (0.11, 0.07, 0.05), bevel=0.012)
    # translucent "spinning spokes" disc, drawn only when the wheel turns fast
    blur = Part('wheelblur', target='wheelblur').mat('wheelblur')
    blur.grid(lambda u, v: (math.cos(u * TAU) * (0.05 + v * 0.127), math.sin(u * TAU) * (0.05 + v * 0.127), 0.046 - v * 0.022), 40, 3)
    return [w, blur]


# ---------------------------------------------------------------------------------- bumpers
def blade(p, path, out, hgt, dep, taper=0.07):
    """Chrome bumper blade along `path` (points on its back face) bulging towards `out`; the last `taper` metres
    close into a rounded tip."""
    n = len(path)
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + (path[i] - path[i - 1]).length)
    h = hgt / 2
    prof = [(0.0, -h), (0.50 * dep, -0.93 * h), (0.86 * dep, -0.62 * h), (dep, -0.15 * h), (dep, 0.15 * h), (0.86 * dep, 0.62 * h), (0.50 * dep, 0.93 * h), (0.0, h)]
    rings = []
    for i in range(n):
        k = 1.0
        d = s[-1] - s[i]
        if d < taper:
            k = max(math.sqrt(max(1 - (1 - d / taper) ** 2, 0.0)), 0.02)
        rings.append([p.bm.verts.new(path[i] + out[i] * (a * k) + Vector((0, b * k, 0))) for a, b in prof])
    m = len(prof)
    for i in range(n - 1):
        for j in range(m):
            j2 = (j + 1) % m
            p.bm.faces.new([rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]])
    flat = [v for r in rings for v in r]
    vs, fs = p._finish(flat)
    fix(p, fs)
    return vs, fs


def bumper_path(y_body, y_blade, front, a1, n, gap):
    """Path that follows the plan outline of the nose/tail at height y_body, pushed out by `gap`."""
    cx = 1.0 if front else -1.2
    a0 = 0.0 if front else math.pi
    pts = S.outline(y_body, cx, a0, a0 + (a1 if front else -a1), n)
    path, out = [], []
    for i in range(n):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        t = Vector((b[0] - a[0], 0, b[2] - a[2])).normalized()
        o = Vector((t.z, 0, -t.x))
        if o.dot(Vector((pts[i][0] - cx, 0, pts[i][2]))) < 0:
            o = -o
        out.append(o)
        path.append(Vector((pts[i][0], y_blade, pts[i][2])) + o * gap)
    path[0].z = 0.0
    out[0] = Vector((1 if front else -1, 0, 0))
    return path, out


def overrider(p, x, y, z, hh, front):
    """Tall tapered over-rider standing in front of the blade."""
    sgn = 1 if front else -1
    p.mat('chrome')

    def fn(u, v):
        t = v * 2 - 1                                   # -1 bottom .. 1 top
        k = max(1 - abs(t) ** 2.6, 0.0) ** 0.5
        wz = 0.031 * k * (1 - 0.25 * max(t, 0))
        wx = 0.050 * k * (1 - 0.35 * max(t, 0))
        a = u * TAU
        return (x + sgn * (0.012 + wx * (0.55 + 0.45 * math.cos(a))) - sgn * 0.02 * max(t, 0) ** 2, y + t * hh, z + wz * math.sin(a))
    _, fs = p.grid(fn, 16, 14)
    fix(p, fs)


def lamp(p, c, n, r, lens_mat, ring_mat='chrome', depth=0.02, bulge=0.012, seg=24, ring=1.16):
    """Round lamp at c facing direction n: chrome bezel + domed lens."""
    n = Vector(n).normalized()
    q = Vector((1, 0, 0)).rotation_difference(n).to_matrix().to_4x4()
    p.push(Matrix.Translation(c) @ q)
    p.mat(ring_mat)
    _, fs = p.lathe([(-depth, r * ring), (0.004, r * ring), (0.010, r * (ring - 0.06)), (0.010, r * 1.0), (0.002, r * 0.98)], seg=seg, axis='x')
    fix(p, fs)
    p.mat(lens_mat)
    _, fs = p.lathe([(0.003, r * 0.99), (0.003 + bulge * 0.55, r * 0.8), (0.003 + bulge * 0.9, r * 0.45), (0.003 + bulge, 0.0)], seg=seg, axis='x')
    fix(p, fs)
    p.pop()


# ---------------------------------------------------------------------------------- exterior
HL = dict(x=1.822, y=0.682, z=0.650, r=0.087)        # headlamp unit (lens plane, centre, lens radius)
SIDELAMP = dict(z=0.655, y=0.503)
TAILZ = 0.649
ORZ, ORZR = 0.470, 0.385                             # over-riders: lateral position, front / rear
F_BUMP = dict(y=0.386, h=0.088, d=0.034)             # front blade: centre height, height, depth
R_BUMP = dict(y=0.421, h=0.078, d=0.034)


def build_exterior(fast=False):
    ext = Part('ext', mirror=True)
    ramF = Part('ramF', mirror=True, target='ramF')
    ramR = Part('ramR', mirror=True, target='ramR')
    out = [ext, ramF, ramR]
    nb = 26 if fast else 48

    # ---- bumpers: chrome blades that wrap round to bullet tips near the wheel arches, with tall over-riders
    ext.mat('chrome')
    path, o = bumper_path(0.47, F_BUMP['y'], True, 0.915, nb, 0.016)
    blade(ext, path, o, F_BUMP['h'], F_BUMP['d'])
    path, o = bumper_path(0.52, R_BUMP['y'], False, 0.86, nb, 0.022)
    blade(ext, path, o, R_BUMP['h'], R_BUMP['d'])
    xf = S.surf_x(ORZ, 0.47, True) + 0.016 + F_BUMP['d'] * 0.6
    overrider(ramF, xf, 0.455, ORZ, 0.097, True)
    xr = S.surf_x(ORZR, 0.52, False) - 0.022 - R_BUMP['d'] * 0.6
    overrider(ramR, xr, 0.487, ORZR, 0.107, False)
    for part, x, y, sgn, oz in ((ramF, xf, 0.44, 1, ORZ), (ramR, xr, 0.455, -1, ORZR)):
        part.mat('chrome_satin')                                   # telescopic ram, inside the body until deployed
        part.cyl((x - sgn * 0.34, y, oz), (x + sgn * 0.01, y, oz), 0.017, seg=10)
    # red reflectors near the ends of the rear blade
    c = Vector(S.outline(0.52, -1.2, math.pi - 0.50, math.pi - 0.50, 1)[0])
    ext.push(tr(c.x - 0.045, R_BUMP['y'], c.z + 0.035) @ rot_y(math.radians(-128)))
    lamp(ext, (0, 0, 0), (1, 0, 0), 0.017, 'lens_red', depth=0.004, bulge=0.005, seg=12)
    ext.pop()

    # ---- grille: 12 fine horizontal slats, uprights, dark radiator behind
    def gz(y):                                           # half width of the mouth at height y
        lo, hi = 0.0, 0.52
        for _ in range(22):
            m = (lo + hi) / 2
            if F.f_grille(Vector((1.9, y, m))) < -0.006:
                lo = m
            else:
                hi = m
        return lo

    def gx(z, y):
        return S.surf_x(z, y, True) - 0.026

    ext.mat('black')
    ext.grid(lambda u, v: (S.surf_x(u * 0.50, 0.52, True) - 0.085, 0.455 + v * (min(0.66, S.top_y(S.surf_x(u * 0.50, 0.52, True) - 0.085, u * 0.50) - 0.03) - 0.455), u * 0.50), 8, 4, flip=True)
    ext.mat('chrome')
    ns = 13
    for k in range(ns):
        y = 0.478 + k * (0.186 / (ns - 1))
        zm = gz(y)
        if zm < 0.02:
            continue
        pth = [(gx(z, y), y, z) for z in np.linspace(0.0, zm, 9)]
        ext.sweep(pth, [(-0.0015, -0.006), (0.0015, -0.006), (0.0015, 0.008), (-0.0015, 0.008)], up=(1, 0, 0))
    for z in (0.0, 0.118, 0.236, 0.354, 0.455):
        ys = [y for y in np.linspace(0.482, 0.675, 14) if F.f_grille(Vector((1.9, y, z))) < -0.004]
        if len(ys) < 2:
            continue
        ext.sweep([(gx(z, y) - 0.010, y, z) for y in ys], [(-0.0015, -0.003), (0.0015, -0.003), (0.0015, 0.003), (-0.0015, 0.003)], up=(1, 0, 0))

    # ---- headlamps: painted tunnel from the cowl rim back to the lamp, chrome-rimmed 7 in unit
    cy, cz = HL['y'], HL['z']
    nphi = 24 if fast else 40
    ring0, ring1 = [], []
    for k in range(nphi):
        a = k / nphi * TAU
        dz, dy = math.cos(a), math.sin(a)
        lo, hi = 0.0, 0.22
        for _ in range(24):                               # march outwards in the cowl plane until the skin is met
            m = (lo + hi) / 2
            z, y = cz + dz * m, cy + dy * m
            x = S.COWL['x0'] - (y - S.COWL['y0']) / S.COWL['slope']
            if S.COWL['zin'] + 0.006 < abs(z) < 0.80 and S.inside_nocowl(x, y - 0.003, z):
                lo = m
            else:
                hi = m
        z, y = cz + dz * lo, cy + dy * lo
        ring0.append(Vector((S.COWL['x0'] - (y - S.COWL['y0']) / S.COWL['slope'] - 0.004, y - 0.004, z)))
        ring1.append(Vector((HL['x'] - 0.004, HL['y'] + dy * (HL['r'] + 0.014), HL['z'] + dz * (HL['r'] + 0.014))))
    # Perspex cover (gently domed) and its chrome rim, built on the aperture outline
    nrm = Vector((S.COWL['slope'], 1.0, 0.0)).normalized()
    cen0 = Vector((S.COWL['x0'] - (cy - S.COWL['y0']) / S.COWL['slope'], cy, cz))
    rim_pts = [q + Vector((0.004, 0.004, 0)) for q in ring0]
    cover = Part('lampglass', mirror=True, target='glass').mat('glass_lamp')
    nr = 6
    rows = [[cover.bm.verts.new(cen0 + (rim_pts[k] - cen0) * (j / nr) + nrm * 0.016 * (1 - (j / nr) ** 2)) for k in range(nphi)] for j in range(1, nr + 1)]
    vc0 = cover.bm.verts.new(cen0 + nrm * 0.016)
    cf = []
    for k in range(nphi):
        k2 = (k + 1) % nphi
        cf.append(cover.bm.faces.new([vc0, rows[0][k], rows[0][k2]]))
        for j in range(nr - 1):
            cf.append(cover.bm.faces.new([rows[j][k], rows[j + 1][k], rows[j + 1][k2], rows[j][k2]]))
    cover._finish([vc0] + [v for r in rows for v in r])
    cover.bm.normal_update()
    bmesh.ops.reverse_faces(cover.bm, faces=[f for f in cf if f.normal.dot(nrm) < 0])
    out.append(cover)
    ext.mat('chrome')
    _, fs = ext.sweep([q + nrm * 0.002 for q in rim_pts], [(-0.009, -0.003), (-0.006, 0.005), (0.0, 0.0075), (0.006, 0.005), (0.009, -0.003)], closed=True, up=tuple(nrm))
    fix(ext, fs)
    ext.mat('paint')
    vr0 = [ext.bm.verts.new(q) for q in ring0]
    vr1 = [ext.bm.verts.new(q) for q in ring1]
    vc = ext.bm.verts.new((HL['x'] - 0.004, HL['y'], HL['z']))
    tf = []
    for k in range(nphi):
        k2 = (k + 1) % nphi
        tf.append(ext.bm.faces.new([vr0[k], vr0[k2], vr1[k2], vr1[k]]))
        tf.append(ext.bm.faces.new([vr1[k], vr1[k2], vc]))
    ext._finish(vr0 + vr1 + [vc])
    fix(ext, tf)                                          # consistent winding, then make the tunnel look inwards
    ext.bm.normal_update()
    cen = Vector((HL['x'] + 0.05, HL['y'], HL['z']))
    if sum(f.normal.dot(cen - f.calc_center_median()) for f in tf) < 0:
        bmesh.ops.reverse_faces(ext.bm, faces=tf)
    ext.push(tr(HL['x'], HL['y'], HL['z']))
    r = HL['r']
    ext.mat('chrome')
    _, fs = ext.lathe([(-0.004, r + 0.016), (0.012, r + 0.016), (0.020, r + 0.010), (0.020, r + 0.001), (0.012, r - 0.002)], seg=32, axis='x')
    fix(ext, fs)
    ext.mat('reflector')
    _, fs = ext.lathe([(-0.060, 0.0), (-0.056, 0.030), (-0.040, 0.058), (-0.018, 0.076), (0.010, r - 0.003)], seg=28, axis='x')
    fix(ext, fs)
    bmesh.ops.reverse_faces(ext.bm, faces=[f for f in fs if f.is_valid])
    ext.mat('lens_clear')
    _, fs = ext.lathe([(0.012, r - 0.002), (0.022, r * 0.80), (0.029, r * 0.45), (0.031, 0.0)], seg=28, axis='x')
    fix(ext, fs)
    ext.pop()

    # ---- front side/indicator lamps on chrome pods (the machine guns hide behind them), plus the guns
    c, n = face_pt(SIDELAMP['z'], SIDELAMP['y'], True)
    gunlamp = Part('gunlamp', mirror=True, target='gunlamp')
    gunlamp.pivot = (c.x - 0.006, c.y - 0.040, 0.0)
    lamp(gunlamp, c - n * 0.010, n, 0.031, 'lens_white', depth=0.004, bulge=0.014, ring=1.22)
    gunlamp.mat('chrome')
    q = Vector((1, 0, 0)).rotation_difference(n).to_matrix().to_4x4()
    gunlamp.push(Matrix.Translation(c - n * 0.010) @ q)
    _, fs = gunlamp.lathe([(-0.030, 0.012), (-0.018, 0.030), (-0.004, 0.038), (0.004, 0.038)], seg=20, axis='x')
    fix(gunlamp, fs)
    gunlamp.pop()
    guns = Part('guns', mirror=True, target='guns')
    gy, gzz = SIDELAMP['y'], SIDELAMP['z']
    guns.mat('gunmetal')
    guns.cyl((c.x - 0.40, gy, gzz), (c.x - 0.045, gy, gzz), 0.0125, seg=12)                       # barrel
    guns.cyl((c.x - 0.36, gy, gzz), (c.x - 0.22, gy, gzz), 0.022, seg=12)                         # receiver jacket
    for k in range(6):                                                                            # cooling fins
        guns.cyl((c.x - 0.125 + k * 0.012, gy, gzz), (c.x - 0.120 + k * 0.012, gy, gzz), 0.0165, seg=10)
    guns.cyl((c.x - 0.060, gy, gzz), (c.x - 0.045, gy, gzz), 0.0155, seg=12)                      # flash hider
    guns.mat('black')
    guns.cyl((c.x - 0.0452, gy, gzz), (c.x - 0.0448, gy, gzz), 0.008, seg=10)
    guns.mat('muzzle')
    guns.grid(lambda u, v: (c.x - 0.035 + 0.17 * v, gy + math.cos(u * TAU) * 0.052 * math.sin(v * math.pi) ** 0.6,
                            gzz + math.sin(u * TAU) * 0.052 * math.sin(v * math.pi) ** 0.6), 8, 4)
    out += [gunlamp, guns]

    # ---- tail lamps: chrome plinth on the end of each fin carrying three round units
    pts = [face_pt(TAILZ, y, False) for y in (0.560, 0.61, 0.67, 0.73, 0.785, 0.812)]
    ext.mat('chrome')
    _, fs = ext.sweep([c + n * 0.003 for c, n in pts], [(-0.050, -0.010), (-0.043, 0.008), (0.043, 0.008), (0.050, -0.010)], up=(1, 0, 0))
    fix(ext, fs)
    for y, m, r, bulge in ((0.772, 'lens_amber', 0.039, 0.034), (0.688, 'lens_red', 0.039, 0.016), (0.606, 'lens_white', 0.037, 0.013)):
        c, n = face_pt(TAILZ, y, False)
        lamp(ext, c + n * 0.011, n, r, m, depth=0.010, bulge=bulge, ring=1.13)

    # ---- wing vents: dark box behind the slot, chrome strake across it
    vx, vy = 0.616, 0.685
    c, n = flank_pt(vx, vy)
    ext.mat('black')
    ext.box((vx, vy, c.z - 0.050), (0.36, 0.11, 0.02))
    ext.box((vx, vy + 0.05, c.z - 0.025), (0.36, 0.012, 0.05))
    ext.box((vx, vy - 0.05, c.z - 0.025), (0.36, 0.012, 0.05))
    ext.mat('chrome')
    pth = [Vector((x, 0.684, S.side_z(x, 0.684) + 0.003)) for x in np.linspace(0.385, 0.800, 12)]
    spear = [math.sin(min(k / 3.0, 1.0) * math.pi / 2) * (1.0 - 0.45 * max(k - 7, 0) / 4.0) for k in range(12)]
    rings = [[ext.bm.verts.new(pt + Vector((0, a * 0.0095 * sc, b * 0.008 * sc))) for a, b in ((-1, 0), (-0.6, 0.8), (0.6, 0.8), (1, 0), (0.6, -0.4), (-0.6, -0.4))]
             for pt, sc in zip(pth, spear)]
    for i in range(len(rings) - 1):
        for j in range(6):
            ext.bm.faces.new([rings[i][j], rings[i][(j + 1) % 6], rings[i + 1][(j + 1) % 6], rings[i + 1][j]])
    _, fs = ext._finish([v for r in rings for v in r])
    fix(ext, fs)

    # ---- door handles: slim chrome grip with its push button, just under the waist near the rear shut line
    c, n = flank_pt(-0.700, 0.805)
    ext.mat('chrome')
    ext.box((-0.700, 0.805, c.z + 0.004), (0.175, 0.020, 0.010), bevel=0.004)
    _, fs = ext.sweep([(-0.775, 0.806, c.z + 0.008), (-0.745, 0.807, c.z + 0.026), (-0.660, 0.807, c.z + 0.027), (-0.625, 0.806, c.z + 0.010)],
                      [(-0.008, -0.004), (0.008, -0.004), (0.006, 0.004), (-0.006, 0.004)], up=(0, 1, 0))
    fix(ext, fs)
    ext.cyl((-0.805, 0.800, c.z - 0.004), (-0.805, 0.800, c.z + 0.007), 0.011, seg=12)

    # ---- wing mirrors: chrome bullets on short stalks on top of the front wings
    mx, mz = 0.585, 0.672
    my = S.top_y(mx, mz)
    ext.mat('chrome')
    ext.cyl((mx, my - 0.005, mz), (mx, my + 0.004, mz), 0.019, seg=14)
    _, fs = ext.sweep([(mx, my, mz), (mx + 0.004, my + 0.040, mz + 0.002), (mx - 0.004, my + 0.068, mz + 0.004)],
                      [(-0.007, -0.005), (0.007, -0.005), (0.007, 0.005), (-0.007, 0.005)], up=(0, 0, 1))
    fix(ext, fs)
    ext.push(tr(mx - 0.045, my + 0.094, mz + 0.004) @ rot_z(-0.06))
    _, fs = ext.lathe([(-0.004, 0.0), (-0.003, 0.043), (0.006, 0.047), (0.045, 0.043), (0.085, 0.030), (0.112, 0.012), (0.120, 0.0)], seg=24, axis='x')
    fix(ext, fs)
    ext.mat('mirror')
    ext.cyl((-0.0052, 0, 0), (-0.0042, 0, 0), 0.040, seg=24)
    ext.pop()

    # ---- wheel wells: dark liners so the arches do not look into the cabin
    ext.mat('under')
    for ax in (S.AXF, S.AXR):
        ext.grid(lambda u, v: (ax + math.cos(math.pi * (1.16 * u - 0.08)) * 0.405, 0.337 + math.sin(math.pi * (1.16 * u - 0.08)) * (0.395 if ax > 0 else 0.36),
                               0.44 + (S.side_z(ax, 0.72) - 0.47) * v), 24, 1)
        ext.grid(lambda u, v: (ax - 0.46 + 0.92 * u, 0.22 + (min(0.80, S.top_y(ax - 0.46 + 0.92 * u, 0.44) - 0.05) - 0.22) * v, 0.44), 10, 1)

    # ---- asymmetric: wipers, badges, boot handle / plate lamp, exhausts
    asym = Part('ext_asym')

    def ws_pt(z, s, lift=0.012):
        az = abs(z)
        xb, xh = 0.42 - 0.24 * (az / 0.68) ** 2.2, 0.129 - 0.125 * (az / 0.60) ** 2
        ln = math.hypot(xb - xh, 0.304)
        x = xb - (s / ln) * (xb - xh)
        return Vector((x, float(S.windscreen(x, np.array([az]))[0]) + lift, z))
    for z0, z1 in ((0.30, -0.10), (-0.17, -0.57)):                 # parked pointing to the car's left
        piv = ws_pt(z0, -0.035, 0.0)
        piv.y = S.top_y(piv.x, z0) + 0.004
        asym.mat('chrome')
        asym.cyl(piv - Vector((0, 0.01, 0)), piv + Vector((0, 0.012, 0)), 0.010, seg=10)
        mid = ws_pt((z0 + z1) / 2, 0.050, 0.020)
        _, fs = asym.sweep([piv + Vector((0, 0.014, 0)), (piv + mid) / 2 + Vector((0, 0.012, 0)), mid], [(-0.0045, -0.002), (0.0045, -0.002), (0.0045, 0.002), (-0.0045, 0.002)])
        fix(asym, fs)
        asym.mat('rubber')
        _, fs = asym.sweep([ws_pt(z0 + (z1 - z0) * (0.10 + 0.90 * k / 7), 0.040 + 0.020 * k / 7) for k in range(8)], [(-0.005, -0.006), (0.005, -0.006), (0.002, 0.007), (-0.002, 0.007)])
        fix(asym, fs)
    # winged badge on the nose, DB5 script on the boot
    asym.mat('decal_badge')
    bx = 1.842
    up = Vector((0, 0.003, 0))
    decal(asym, 'wings', top_pt(bx + 0.020, 0.064) + up, top_pt(bx + 0.020, -0.064) + up, top_pt(bx - 0.018, -0.064) + up, top_pt(bx - 0.018, 0.064) + up)
    sx = lambda z, y: S.surf_x(z, y, False) - 0.003
    decal(asym, 'script', (sx(0.345, 0.598), 0.598, 0.345), (sx(0.455, 0.598), 0.598, 0.455), (sx(0.455, 0.632), 0.632, 0.455), (sx(0.345, 0.632), 0.632, 0.345))
    # chrome housing above the rear plate: number-plate lamps and the boot handle
    xt = S.surf_x(0.0, 0.69, False)
    asym.mat('chrome')
    asym.box((xt - 0.016, 0.690, 0.0), (0.044, 0.036, 0.36), bevel=0.014, seg=3)
    asym.box((xt - 0.030, 0.672, 0.0), (0.020, 0.016, 0.12), bevel=0.006)
    # twin tailpipes under the left of the rear bumper
    for z in (-0.335, -0.395):
        _, fs = asym.lathe([(0.34, 0.021), (0.0, 0.021), (-0.004, 0.0235), (0.0, 0.0185), (0.14, 0.0185)], seg=16, axis='x', origin=(-2.455, 0.285, z))
        fix(asym, fs)
    asym.mat('black')
    asym.box((-1.95, 0.262, -0.365), (0.50, 0.10, 0.20), bevel=0.04)
    out.append(asym)
    return out
