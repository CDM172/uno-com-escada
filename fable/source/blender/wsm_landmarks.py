# Landmark buildings of Weston-super-Mare for the map, modelled on their OpenStreetMap footprints (wsm_landmarks.json,
# written by tools/osm/bake_wsm.py), their Environment Agency LIDAR heights (DSM - DTM: the height of every roof, the
# clock tower, the turrets) and reference photographs:
#   town_hall             Bath stone, 1897 east front: a gabled central pavilion over a porch of three arches, a
#                         rusticated clock tower with a lantern, balustraded wings with arched windows
#   grand_atlantic_hotel  Bath stone, four storeys and a slate mansard with dormers, two round turrets with conical
#                         spires at the front corners, a central pavilion with a tall pyramid roof, iron balconies
#   winter_gardens        1927 pavilion in cream render: a bowed centre of tall arched windows under a low dome and
#                         lantern, wings with engaged columns facing the sea
#   odeon                 1935 Art Deco cinema: cream faience with green bands, a fin tower at the corner, the tall
#                         auditorium box behind (no lettering)
#   tropicana             white Art Deco lido buildings round the pool, with a blue band and porthole windows
# Frame: origin = footprint centroid on the ground (the lowest ground at the footprint), X = the map's street front,
# Z = X turned 90 deg clockwise seen from above, Y up, metres.
import json
import math
import os

import bmesh
from mathutils import Matrix, Vector

from db5_lib import Part, material

HERE = os.path.dirname(os.path.abspath(__file__))

material('bath_stone', 2, 0, (0.60, 0.53, 0.40), ((0.60, 0.53, 0.40), 0.0, 0.8))
material('bath_dark', 2, 0, (0.47, 0.42, 0.32), ((0.47, 0.42, 0.32), 0.0, 0.85))
material('render', 2, 0, (0.84, 0.82, 0.75), ((0.84, 0.82, 0.75), 0.0, 0.75))
material('render_white', 2, 0, (0.90, 0.90, 0.88), ((0.90, 0.90, 0.88), 0.0, 0.7))
material('faience', 2, 0, (0.86, 0.82, 0.68), ((0.86, 0.82, 0.68), 0.0, 0.35))
material('faience_green', 2, 0, (0.12, 0.32, 0.26), ((0.12, 0.32, 0.26), 0.0, 0.35))
material('lead', 2, 0, (0.27, 0.28, 0.30), ((0.27, 0.28, 0.30), 0.2, 0.6))
material('window', 7, 0, (0.15, 0.17, 0.20), ((0.10, 0.12, 0.15), 1.0, 0.08))
material('frame_white', 2, 0, (0.88, 0.88, 0.86), ((0.88, 0.88, 0.86), 0.0, 0.5))
material('door', 2, 0, (0.32, 0.07, 0.05), ((0.32, 0.07, 0.05), 0.0, 0.4))
material('dark', 2, 0, (0.05, 0.05, 0.055), ((0.05, 0.05, 0.055), 0.0, 0.8))
material('clock', 2, 0, (0.92, 0.92, 0.88), ((0.92, 0.92, 0.88), 0.0, 0.4))
material('copper', 2, 0, (0.32, 0.52, 0.45), ((0.32, 0.52, 0.45), 0.3, 0.5))
material('blue', 2, 0, (0.10, 0.30, 0.55), ((0.10, 0.30, 0.55), 0.0, 0.4))
material('brick_chimney', 2, 0, (0.45, 0.30, 0.22), ((0.45, 0.30, 0.22), 0.0, 0.85))


def load():
    with open(os.path.join(HERE, 'wsm_landmarks.json')) as f:
        return {L['name']: L for L in json.load(f)['landmarks']}


# ------------------------------------------------------------------------------------------------ geometry helpers
def area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def ccw(poly):
    return poly if area(poly) > 0 else poly[::-1]


def clip_rect(poly, x0, x1, z0, z1):
    """Sutherland-Hodgman: the footprint inside an axis-aligned rectangle"""
    def clip(pts, inside, cut):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(cut(a, b))
                out.append(b)
            elif ia:
                out.append(cut(a, b))
        return out

    def cx(v):
        return lambda a, b: (v, a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]))

    def cz(v):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]), v)
    pts = list(poly)
    for inside, cut in ((lambda p: p[0] >= x0, cx(x0)), (lambda p: p[0] <= x1, cx(x1)), (lambda p: p[1] >= z0, cz(z0)), (lambda p: p[1] <= z1, cz(z1))):
        if not pts:
            break
        pts = clip(pts, inside, cut)
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.02:
            out.append(p)
    if len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 0.02:
        out.pop()
    return out if len(out) >= 3 and abs(area(out)) > 1.0 else []


def seg_dist(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / max(ax * ax + az * az, 1e-9)))
    return math.hypot(p[0] - a[0] - ax * t, p[1] - a[1] - az * t)


def on_outline(a, b, outline, tol=0.25):
    m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    n = len(outline)
    return any(seg_dist(m, outline[i], outline[(i + 1) % n]) < tol for i in range(n))


def edges(poly):
    """(a, b, length, outward normal) for a CCW polygon"""
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz)
        if L > 1e-3:
            yield a, b, L, (dz / L, -dx / L)


def offset(poly, d):
    """miter offset of a CCW polygon (d > 0 outwards)"""
    n = len(poly)
    res = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]

        def nrm(a, b):
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1.0
            return dz / L, -dx / L
        n1, n2 = nrm(p0, p1), nrm(p1, p2)
        bx, bz = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, bz)
        if bl < 1e-6:
            bx, bz, bl = n1[0], n1[1], 1.0
        bx, bz = bx / bl, bz / bl
        c = max(bx * n1[0] + bz * n1[1], 0.4)
        res.append((p1[0] + bx * d / c, p1[1] + bz * d / c))
    return res


def lframe(mx, mz, n, y=0.0):
    """wall frame: local x = outward normal, y = up, z = along the wall (the viewer's left)"""
    nx, nz = n
    return Matrix(((nx, 0.0, -nz, mx), (0.0, 1.0, 0.0, y), (nz, 0.0, nx, mz), (0.0, 0.0, 0.0, 1.0)))


def face(p, pts, hint):
    vs = [p.bm.verts.new(p.xf @ Vector(q)) for q in pts]
    try:
        f = p.bm.faces.new(vs)
    except ValueError:
        return None
    f.material_index = p.mi
    f.smooth = False
    f.normal_update()
    if f.normal.dot(p.xf.to_3x3() @ Vector(hint)) < 0:
        f.normal_flip()
    return f


def lbox(p, x0, x1, y0, y1, z0, z1):
    p.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)))


def fix(p, fs):
    bmesh.ops.recalc_face_normals(p.bm, faces=[f for f in fs if f.is_valid])


def walls(p, poly, y0, y1):
    for a, b, L, n in edges(poly):
        face(p, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], (n[0], 0, n[1]))


def cap(p, poly, y, up=True):
    face(p, [(x, y, z) for x, z in poly], (0, 1 if up else -1, 0))


def ring_cap(p, outer, inner, y):
    n = len(outer)
    for i in range(n):
        a, b, c, d = outer[i], outer[(i + 1) % n], inner[(i + 1) % n], inner[i]
        face(p, [(a[0], y, a[1]), (b[0], y, b[1]), (c[0], y, c[1]), (d[0], y, d[1])], (0, 1, 0))


def band(p, poly, y, h, d):
    """projecting course round a block"""
    op = offset(poly, d)
    walls(p, op, y, y + h)
    ring_cap(p, op, poly, y + h)
    n = len(poly)
    for i in range(n):
        a, b, c, e = poly[i], poly[(i + 1) % n], op[(i + 1) % n], op[i]
        face(p, [(a[0], y, a[1]), (e[0], y, e[1]), (c[0], y, c[1]), (b[0], y, b[1])], (0, -1, 0))


def cornice(p, poly, y, k=1.0):
    band(p, poly, y, 0.18 * k, 0.10 * k)
    band(p, poly, y + 0.18 * k, 0.22 * k, 0.28 * k)
    band(p, poly, y + 0.40 * k, 0.16 * k, 0.42 * k)


def parapet(p, poly, y, h, t=0.3, top='bath_stone'):
    inner = offset(poly, -t)
    walls(p, poly, y, y + h)
    for a, b, L, n in edges(inner):
        face(p, [(a[0], y, a[1]), (a[0], y + h, a[1]), (b[0], y + h, b[1]), (b[0], y, b[1])], (-n[0], 0, -n[1]))
    p.mat(top)
    ring_cap(p, offset(poly, 0.06), offset(poly, -t - 0.06), y + h)


def gable_roof(p, x0, x1, z0, z1, y, rise, along='x', mat='slate', ends='bath_stone', hip=False):
    """pitched roof over a rectangle, ridge along x or z; gable (or hipped) ends"""
    p.mat(mat)
    if along == 'x':
        zm = (z0 + z1) / 2
        hx = min(rise, (x1 - x0) / 2) if hip else 0.0
        face(p, [(x0, y, z0), (x1, y, z0), (x1 - hx, y + rise, zm), (x0 + hx, y + rise, zm)], (0, 1, -1))
        face(p, [(x1, y, z1), (x0, y, z1), (x0 + hx, y + rise, zm), (x1 - hx, y + rise, zm)], (0, 1, 1))
        if not hip:
            p.mat(ends)
        face(p, [(x0, y, z0), (x0 + hx, y + rise, zm), (x0, y, z1)], (-1, 0.3 if hip else 0, 0))
        face(p, [(x1, y, z1), (x1 - hx, y + rise, zm), (x1, y, z0)], (1, 0.3 if hip else 0, 0))
    else:
        xm = (x0 + x1) / 2
        hz = min(rise, (z1 - z0) / 2) if hip else 0.0
        face(p, [(x0, y, z1), (x0, y, z0), (xm, y + rise, z0 + hz), (xm, y + rise, z1 - hz)], (-1, 1, 0))
        face(p, [(x1, y, z0), (x1, y, z1), (xm, y + rise, z1 - hz), (xm, y + rise, z0 + hz)], (1, 1, 0))
        if not hip:
            p.mat(ends)
        face(p, [(x0, y, z0), (x1, y, z0), (xm, y + rise, z0 + hz)], (0, 0.3 if hip else 0, -1))
        face(p, [(x1, y, z1), (x0, y, z1), (xm, y + rise, z1 - hz)], (0, 0.3 if hip else 0, 1))


# -------------------------------------------------------------------------------------- façade parts (wall frame)
def arc_ring(p, zc, yc, r0, r1, x0, x1, k=8):
    """semicircular arch ring (voussoirs) on a wall, springing at yc, centre zc"""
    for i in range(k):
        t0, t1 = math.pi * i / k, math.pi * (i + 1) / k
        c0, s0, c1, s1 = math.cos(t0), math.sin(t0), math.cos(t1), math.sin(t1)
        face(p, [(x1, yc + r0 * s0, zc + r0 * c0), (x1, yc + r1 * s0, zc + r1 * c0), (x1, yc + r1 * s1, zc + r1 * c1), (x1, yc + r0 * s1, zc + r0 * c1)], (1, 0, 0))
        face(p, [(x0, yc + r1 * s0, zc + r1 * c0), (x1, yc + r1 * s0, zc + r1 * c0), (x1, yc + r1 * s1, zc + r1 * c1), (x0, yc + r1 * s1, zc + r1 * c1)], (0, (s0 + s1), (c0 + c1)))
        face(p, [(x0, yc + r0 * s1, zc + r0 * c1), (x1, yc + r0 * s1, zc + r0 * c1), (x1, yc + r0 * s0, zc + r0 * c0), (x0, yc + r0 * s0, zc + r0 * c0)], (0, -(s0 + s1), -(c0 + c1)))


def window(p, z, y, w, h, arch=False, frame='bath_stone', depth=0.16, fw=0.16, sill=True, bars=True, bar='frame_white', key=False, glass='window'):
    """a window on the wall plane x = 0: glass, a stone surround (jambs, lintel or arch ring), a sill, glazing bars"""
    r = w / 2
    p.mat(glass)
    pts = [(0.02, y, z - r), (0.02, y, z + r), (0.02, y + h, z + r)]
    if arch:
        k = 8
        pts += [(0.02, y + h + r * math.sin(math.pi * i / k), z + r * math.cos(math.pi * i / k)) for i in range(1, k)]
    pts.append((0.02, y + h, z - r))
    face(p, pts, (1, 0, 0))
    p.mat(frame)
    lbox(p, 0.0, depth, y, y + h, z - r - fw, z - r)
    lbox(p, 0.0, depth, y, y + h, z + r, z + r + fw)
    if arch:
        arc_ring(p, z, y + h, r, r + fw, 0.0, depth, 8)
        if key:
            lbox(p, 0.0, depth + 0.04, y + h + r - 0.05, y + h + r + fw + 0.12, z - 0.16, z + 0.16)
    else:
        lbox(p, 0.0, depth, y + h, y + h + fw * 1.4, z - r - fw - 0.06, z + r + fw + 0.06)
    if sill:
        lbox(p, 0.0, depth + 0.07, y - 0.12, y, z - r - fw - 0.08, z + r + fw + 0.08)
    if bars and w > 0.7:
        p.mat(bar)
        lbox(p, 0.02, 0.06, y, y + h, z - 0.03, z + 0.03)
        lbox(p, 0.02, 0.07, y + h * 0.52 - 0.035, y + h * 0.52 + 0.035, z - r, z + r)
        if arch:
            lbox(p, 0.02, 0.06, y + h - 0.03, y + h + 0.03, z - r, z + r)


def door(p, z, y, w, h, arch=False, frame='bath_stone'):
    window(p, z, y, w, h, arch=arch, frame=frame, depth=0.22, fw=0.2, sill=False, bars=False, key=arch, glass='door')


def column(p, x, z, y0, y1, r, mat='bath_stone'):
    p.mat(mat)
    prof = [(y0, r * 1.35), (y0 + 0.22, r * 1.35), (y0 + 0.24, r * 1.12), (y0 + 0.36, r), (y1 - 0.42, r * 0.9),
            (y1 - 0.36, r * 1.15), (y1 - 0.2, r * 1.25), (y1 - 0.2, r * 1.45), (y1, r * 1.45)]
    _, fs = p.lathe(prof, seg=12, axis='y', origin=(x, 0.0, z))
    fix(p, fs)


def balustrade(p, z0, z1, y, h=0.85, x0=-0.32, x1=0.04, mat='bath_stone', die=3.0):
    p.mat(mat)
    lbox(p, x0, x1, y, y + 0.14, z0, z1)
    lbox(p, x0 - 0.04, x1 + 0.04, y + h - 0.14, y + h, z0, z1)
    n = max(int((z1 - z0) / 0.32), 1)
    for i in range(n):
        zc = z0 + (i + 0.5) * (z1 - z0) / n
        lbox(p, x0 + 0.08, x1 - 0.06, y + 0.14, y + h - 0.14, zc - 0.07, zc + 0.07)
    nd = max(int((z1 - z0) / die), 1)
    for i in range(nd + 1):
        zc = z0 + i * (z1 - z0) / nd
        lbox(p, x0 - 0.02, x1 + 0.02, y, y + h + 0.06, max(z0, zc - 0.22), min(z1, zc + 0.22))


def finial(p, x, z, y, h=1.6, mat='bath_stone'):
    p.mat(mat)
    lbox(p, x - 0.32, x + 0.32, y, y + 0.5, z - 0.32, z + 0.32)
    _, fs = p.lathe([(y + 0.5, 0.26), (y + 0.5 + h * 0.6, 0.12), (y + 0.5 + h * 0.6, 0.18), (y + 0.5 + h * 0.75, 0.2), (y + 0.5 + h, 0.0)], seg=8, axis='y', origin=(x, 0.0, z))
    fix(p, fs)


def fenestrate(p, poly, outline, floors, pitch, min_len=2.6, reserve=None, end_margin=0.9):
    """windows on every outside wall of a block: floors = [(sill height, width, height, arch, frame), ...]"""
    for a, b, L, n in edges(poly):
        if L < min_len or not on_outline(a, b, outline):
            continue
        cnt = max(int((L - 2 * end_margin) / pitch), 1)
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        p.push(lframe(mx, mz, n))
        for i in range(cnt):
            zl = -L / 2 + end_margin + (i + 0.5) * (L - 2 * end_margin) / cnt
            wx, wz = mx + (-n[1]) * zl, mz + n[0] * zl
            if reserve and any(math.hypot(wx - rx, wz - rz) < rr for rx, rz, rr in reserve):
                continue
            for (ys, w, h, arch, frame) in floors:
                window(p, zl, ys, w, h, arch=arch, frame=frame, key=arch)
        p.pop()


def block(p, poly, outline, y0, h, wall, floors=None, pitch=3.4, par=0.0, cor=True, reserve=None, roof_mat='lead'):
    """a footprint block: walls, a plinth, a cornice, a parapet or bare top, a flat roof, windows on its outside walls"""
    p.mat(wall)
    walls(p, poly, y0, h)
    band(p, poly, y0, 0.55 - y0, 0.12)
    if cor:
        p.mat(wall)
        cornice(p, poly, h - 0.6, 1.0)
    if par > 0:
        p.mat(wall)
        parapet(p, poly, h, par, top=wall)
        p.mat(roof_mat)
        cap(p, offset(poly, -0.3), h + 0.05)
    else:
        p.mat(roof_mat)
        cap(p, poly, h)
    if floors:
        fenestrate(p, poly, outline, floors, pitch, reserve=reserve)


# ------------------------------------------------------------------------------------------------- the landmarks
def town_hall(L):
    out = ccw([tuple(q) for q in L['footprint_xz']])
    p = Part('town_hall')
    # the clock tower, the gabled pavilion and its porch stand on the east front (local -Z), as the LIDAR and the
    # photograph show; the block to the south (+X) is the taller main hall with a pitched roof
    T = (-37.0, -35.0)
    reserve = [(T[0], T[1] - 3.0, 3.6), (-24.0, -39.5, 5.2)]
    gf = [(1.0, 1.3, 2.1, True, 'bath_stone'), (5.5, 1.2, 2.2, True, 'bath_stone')]
    for rx, kind in (((-48.0, -28.6), 'wing'), ((-19.4, -11.0), 'wing'), ((-28.6, -19.4), 'pav')):
        poly = clip_rect(out, rx[0], rx[1], -41.0, -11.0)
        if not poly:
            continue
        poly = ccw(poly)
        if kind == 'wing':
            block(p, poly, out, -0.6, 9.0, 'bath_stone', gf, pitch=3.3, reserve=reserve)
            p.mat('bath_dark')
            band(p, poly, 4.6, 0.3, 0.14)
            gable_roof(p, rx[0] + 0.3, rx[1] - 0.3, -39.6, -11.5, 9.0, 3.6, along='x', hip=True)
        else:
            block(p, poly, out, -0.6, 11.0, 'bath_stone', None, cor=False)
            gable_roof(p, rx[0], rx[1], -39.6, -28.0, 11.0, 3.6, along='z', ends='bath_stone')
    # balustrades along the wing fronts (the -Z edges of the outline)
    for a, b, Lg, n in edges(out):
        if n[1] < -0.9 and Lg > 3.0 and not (-28.7 < (a[0] + b[0]) / 2 < -19.3):
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            p.push(lframe(mx, mz, n))
            balustrade(p, -Lg / 2, Lg / 2, 9.0)
            p.pop()
    # the central pavilion: four tall arched windows, the gable with its raking cornice, finials and a figure on the apex
    p.push(lframe(-24.0, -39.4, (0.0, -1.0)))
    for k in range(4):
        window(p, -2.7 + 1.8 * k, 5.2, 1.05, 2.6, arch=True, key=True)
    p.mat('bath_stone')
    face(p, [(0.0, 11.0, -4.6), (0.0, 11.0, 4.6), (0.0, 14.6, 0.0)], (1, 0, 0))
    for s in (-1, 1):
        p.push(Matrix.Translation((0.25, 12.8, 2.3 * s)) @ Matrix.Rotation(s * math.atan2(3.6, 4.6), 4, 'X'))
        lbox(p, -0.25, 0.25, -0.18, 0.18, -2.95, 2.95)
        p.pop()
        lbox(p, -0.5, 0.5, 9.0, 12.2, 4.6 * s - 0.5, 4.6 * s + 0.5)
        finial(p, 0.0, 4.6 * s, 12.2, 1.8)
    p.mat('bath_dark')
    lbox(p, -0.2, 0.25, 11.0, 11.35, -4.9, 4.9)
    _, fs = p.lathe([(14.6, 0.32), (15.2, 0.3), (15.5, 0.22), (16.4, 0.18), (16.7, 0.12), (16.9, 0.0)], seg=8, axis='y', origin=(0.0, 0.0, 0.0))
    fix(p, fs)
    # the porch: an arcade of three arches with a parapet; the pavilion wall behind it has the doors
    p.mat('bath_stone')
    D = 4.9
    for k in range(3):
        door(p, -3.05 + 3.05 * k, 0.0, 1.6, 2.6, arch=True)
    p.mat('bath_stone')
    for zc in (-4.6, -1.53, 1.53, 4.6):
        lbox(p, D - 0.7, D, 0.0, 3.6, zc - 0.4, zc + 0.4)
        column(p, D + 0.12, zc, 0.0, 3.5, 0.2)
    p.mat('bath_stone')
    for k in range(3):
        zc = -3.05 + 3.05 * k
        arc_ring(p, zc, 3.6, 1.13, 1.45, D - 0.7, D, 8)
        lbox(p, D - 0.7, D, 3.6, 6.2, zc - 1.53, zc - 1.13)
        lbox(p, D - 0.7, D, 3.6, 6.2, zc + 1.13, zc + 1.53)
        lbox(p, D - 0.7, D, 3.6 + 1.13 + 0.32, 6.2, zc - 1.13, zc + 1.13)
    for s in (-1, 1):
        lbox(p, 0.0, D, 0.0, 6.2, 4.6 * s - 0.4, 4.6 * s + 0.4)
    p.mat('bath_dark')
    lbox(p, -0.1, D + 0.2, 6.2, 6.6, -5.1, 5.1)
    p.mat('bath_stone')
    lbox(p, 0.0, D, 6.6, 7.4, -5.0, 5.0)
    lbox(p, D - 0.3, D + 0.05, 7.4, 8.3, -2.2, 2.2)
    p.mat('lead')
    lbox(p, 0.0, D - 0.4, 6.0, 6.1, -4.2, 4.2)
    p.pop()
    # the clock tower: rusticated shaft, clock stage, cornice, an octagonal lantern with a dome
    tx, tz = T
    s, top = 5.2, 21.5
    p.mat('bath_stone')
    lbox(p, tx - s / 2, tx + s / 2, 0.0, top, tz - s / 2, tz + s / 2)
    p.mat('bath_dark')
    for y in [9.6 + 0.55 * i for i in range(10)]:
        lbox(p, tx - s / 2 - 0.03, tx + s / 2 + 0.03, y, y + 0.06, tz - s / 2 - 0.03, tz + s / 2 + 0.03)
    for y, d in ((15.6, 0.25), (20.6, 0.4)):
        lbox(p, tx - s / 2 - d, tx + s / 2 + d, y, y + 0.45, tz - s / 2 - d, tz + s / 2 + d)
    for k in range(4):
        ang = k * math.pi / 2
        n = (math.cos(ang), math.sin(ang))
        p.push(lframe(tx + n[0] * s / 2, tz + n[1] * s / 2, n))
        window(p, 0.0, 11.0, 0.9, 2.4, arch=True, key=True)
        p.mat('bath_stone')
        p.cyl((-0.02, 18.0, 0.0), (0.08, 18.0, 0.0), 1.5, seg=24)
        p.mat('clock')
        p.cyl((0.0, 18.0, 0.0), (0.12, 18.0, 0.0), 1.3, seg=24)
        p.mat('dark')
        lbox(p, 0.12, 0.16, 18.0, 18.85, -0.04, 0.04)
        lbox(p, 0.12, 0.16, 17.96, 18.04, -0.04, 0.6)
        p.mat('bath_stone')
        face(p, [(0.05, 19.6, -1.9), (0.05, 19.6, 1.9), (0.05, 20.6, 0.0)], (1, 0, 0))
        p.pop()
    for sx in (-1, 1):
        for sz in (-1, 1):
            finial(p, tx + sx * (s / 2 - 0.1), tz + sz * (s / 2 - 0.1), top, 1.4)
    p.mat('bath_stone')
    _, fs = p.lathe([(top, 1.9), (top + 2.2, 1.9), (top + 2.2, 2.15), (top + 2.45, 2.15)], seg=8, axis='y', origin=(tx, 0.0, tz))
    fix(p, fs)
    p.mat('lead')
    _, fs = p.lathe([(top + 2.45, 2.1), (top + 3.4, 1.7), (top + 4.1, 0.9), (top + 4.4, 0.35), (top + 4.6, 0.3), (top + 5.4, 0.0)], seg=12, axis='y', origin=(tx, 0.0, tz))
    fix(p, fs)
    p.mat('dark')
    for k in range(8):
        ang = (k + 0.5) * math.tau / 8
        n = (math.cos(ang), math.sin(ang))
        p.push(lframe(tx + n[0] * 1.92, tz + n[1] * 1.92, n))
        face(p, [(0.0, top + 0.4, -0.35), (0.0, top + 0.4, 0.35), (0.0, top + 1.6, 0.35), (0.0, top + 1.9, 0.0), (0.0, top + 1.6, -0.35)], (1, 0, 0))
        p.pop()
    # the rest: the block behind (8 m), the south front block (12.8 m) and the main hall (14.5 m, hipped roof to 18 m)
    for rect, h, roof in (((-48.0, -11.0, -11.0, -2.0), 8.0, None), ((-11.0, -0.8, -41.0, 1.0), 12.8, None), ((-0.8, 40.0, -25.0, 60.0), 14.5, 'hall')):
        poly = clip_rect(out, *rect)
        if not poly:
            continue
        poly = ccw(poly)
        fl = [(1.1, 1.3, 2.2, False, 'bath_stone'), (5.2, 1.2, 2.2, False, 'bath_stone')] + ([(9.2, 1.1, 1.9, False, 'bath_stone')] if h > 12 else [])
        block(p, poly, out, -0.6, h, 'bath_stone', fl, pitch=3.3, par=0.9 if roof is None else 0.0)
        if roof == 'hall':
            xs = [q[0] for q in poly]
            zs = [q[1] for q in poly]
            gable_roof(p, min(xs) + 0.4, max(xs) - 0.4, min(zs) + 0.4, max(zs) - 0.4, h, 3.5, along='z', hip=True)
    return [p]


def grand_atlantic(L):
    out = ccw([tuple(q) for q in L['footprint_xz']])
    p = Part('grand_atlantic_hotel')
    TUR = [(22.6, -19.8), (22.6, 23.0)]
    wall_h, top = 15.6, 20.6
    floors = [(1.0, 1.5, 2.4, False, 'bath_stone'), (4.9, 1.2, 2.0, False, 'bath_stone'), (8.3, 1.2, 2.0, False, 'bath_stone'), (11.7, 1.15, 1.9, False, 'bath_stone')]
    reserve = [(x, z, 2.9) for x, z in TUR]
    poly = ccw(clip_rect(out, 9.0, 30.0, -32.0, 32.0))
    block(p, poly, out, -0.6, wall_h, 'bath_stone', floors, pitch=3.0, reserve=reserve)
    p.mat('bath_dark')
    band(p, poly, 4.4, 0.3, 0.14)
    # mansard: steep slate slopes from the cornice to an inset flat top, dormers all round
    inner = offset(poly, -1.6)
    p.mat('slate')
    n = len(poly)
    for i in range(n):
        a, b, c, d = poly[i], poly[(i + 1) % n], inner[(i + 1) % n], inner[i]
        dx, dz = b[0] - a[0], b[1] - a[1]
        Lg = math.hypot(dx, dz) or 1.0
        face(p, [(a[0], wall_h, a[1]), (b[0], wall_h, b[1]), (c[0], top, c[1]), (d[0], top, d[1])], (dz / Lg, 0.4, -dx / Lg))
    p.mat('lead')
    cap(p, inner, top)
    for a, b, Lg, nn in edges(poly):
        if Lg < 3.5 or not on_outline(a, b, out):
            continue
        cnt = max(int(Lg / 3.0), 1)
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        p.push(lframe(mx, mz, nn))
        for i in range(cnt):
            zl = -Lg / 2 + (i + 0.5) * Lg / cnt
            wx, wz = mx - nn[1] * zl, mz + nn[0] * zl
            if any(math.hypot(wx - x, wz - z) < 3.2 for x, z in TUR):
                continue
            p.mat('bath_stone')
            lbox(p, -0.9, -0.2, wall_h, wall_h + 2.5, zl - 0.85, zl + 0.85)
            p.push(Matrix.Translation((-0.2, 0.0, 0.0)))
            window(p, zl, wall_h + 0.5, 0.9, 1.5, sill=False, depth=0.1, fw=0.1)
            p.mat('slate')
            face(p, [(0.0, wall_h + 2.5, zl - 1.05), (0.0, wall_h + 2.5, zl + 1.05), (-0.7, wall_h + 3.5, zl)], (1, 0.3, 0))
            face(p, [(0.0, wall_h + 2.5, zl + 1.05), (-1.2, wall_h + 2.5, zl + 1.05), (-1.2, wall_h + 3.5, zl), (-0.7, wall_h + 3.5, zl)], (0, 1, 1))
            face(p, [(-1.2, wall_h + 2.5, zl - 1.05), (0.0, wall_h + 2.5, zl - 1.05), (-0.7, wall_h + 3.5, zl), (-1.2, wall_h + 3.5, zl)], (0, 1, -1))
            p.pop()
        if nn[0] > 0.8:                       # iron balconies on the first floor of the front
            for i in range(cnt):
                zl = -Lg / 2 + (i + 0.5) * Lg / cnt
                wx, wz = mx - nn[1] * zl, mz + nn[0] * zl
                if any(math.hypot(wx - x, wz - z) < 3.2 for x, z in TUR):
                    continue
                p.mat('bath_stone')
                lbox(p, 0.0, 0.7, 4.55, 4.75, zl - 1.1, zl + 1.1)
                p.mat('frame_white')
                lbox(p, 0.62, 0.7, 5.5, 5.56, zl - 1.1, zl + 1.1)
                for j in range(9):
                    zz = zl - 1.05 + j * 2.1 / 8
                    lbox(p, 0.63, 0.68, 4.75, 5.5, zz - 0.02, zz + 0.02)
        p.pop()
    for z in (-14.0, -4.0, 9.0, 17.0):                      # chimney stacks
        p.mat('brick_chimney')
        lbox(p, 14.0, 16.4, top, top + 2.2, z - 0.5, z + 0.5)
        p.mat('bath_stone')
        lbox(p, 13.9, 16.5, top + 2.2, top + 2.4, z - 0.6, z + 0.6)
        p.mat('brick_chimney')
        for k in range(4):
            p.cyl((14.4 + 0.5 * k, top + 2.4, z), (14.4 + 0.5 * k, top + 2.9, z), 0.13, seg=8)
    # central pavilion: a tall pyramid roof with a flagpole over the projecting centre
    p.mat('slate')
    _, fs = p.lathe([(wall_h, 6.2), (wall_h + 6.5, 1.0), (wall_h + 7.6, 0.0)], seg=4, axis='y', origin=(21.0, 0.0, 0.0))
    fix(p, fs)
    p.mat('iron')
    p.cyl((21.0, wall_h + 7.4, 0.0), (21.0, wall_h + 11.0, 0.0), 0.05, 0.03, seg=6)
    for x, z in TUR:                                        # round turrets with conical spires
        p.mat('bath_stone')
        _, fs = p.lathe([(-0.6, 2.3), (wall_h + 1.6, 2.3), (wall_h + 1.9, 2.5), (wall_h + 2.2, 2.5)], seg=16, axis='y', origin=(x, 0.0, z))
        fix(p, fs)
        p.mat('slate')
        _, fs = p.lathe([(wall_h + 2.2, 2.65), (wall_h + 4.0, 1.6), (wall_h + 11.5, 0.0)], seg=16, axis='y', origin=(x, 0.0, z))
        fix(p, fs)
        p.mat('iron')
        p.cyl((x, wall_h + 11.3, z), (x, wall_h + 12.6, z), 0.05, 0.02, seg=6)
        for k in range(5):
            ang = (k - 2) * 0.62
            nn = (math.cos(ang), math.sin(ang))
            p.push(lframe(x + nn[0] * 2.3, z + nn[1] * 2.3, nn))
            for ys in (1.0, 4.9, 8.3, 11.7, wall_h + 0.2):
                window(p, 0.0, ys, 0.85, 1.9, frame='bath_stone', depth=0.1, fw=0.12)
            p.pop()
    # the wings behind: low (5.5 m), with a taller back range (16.5 m) and a stair tower (21.5 m)
    for rect, h in (((-40.0, 9.0, -32.0, 32.0), 5.5), ((0.0, 9.0, 11.0, 25.0), 16.5), ((4.0, 9.0, 4.0, 10.5), 21.5)):
        poly = clip_rect(out, *rect)
        if not poly:
            continue
        poly = ccw(poly)
        fl = [(1.0, 1.3, 2.0, False, 'bath_stone')] + [(1.0 + 3.4 * k, 1.2, 1.9, False, 'bath_stone') for k in range(1, int(h / 3.6))]
        block(p, poly, out, -0.6, h, 'bath_stone', fl, pitch=3.2, par=0.8)
    return [p]


def winter_gardens(L):
    out = ccw([tuple(q) for q in L['footprint_xz']])
    p = Part('winter_gardens')
    # wings: render, engaged columns and windows on the sea side (+Z, west), a blocking course
    for rect in ((-60.0, -14.0, -30.0, 30.0), (21.0, 60.0, -30.0, 30.0)):
        poly = clip_rect(out, *rect)
        if not poly:
            continue
        poly = ccw(poly)
        block(p, poly, out, -0.6, 7.0, 'render', [(0.6, 1.5, 3.0, False, 'render_white')], pitch=3.4, par=0.8)
        p.mat('render_white')
        band(p, poly, 5.0, 0.25, 0.1)
        for a, b, Lg, n in edges(poly):
            if n[1] > 0.5 and Lg > 8 and on_outline(a, b, out):
                mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                p.push(lframe(mx, mz, n))
                cnt = int(Lg / 3.4)
                for i in range(cnt + 1):
                    zc = -Lg / 2 + 0.9 + i * (Lg - 1.8) / max(cnt, 1)
                    column(p, 0.28, zc, 0.0, 6.2, 0.26, mat='render_white')
                p.mat('render_white')
                lbox(p, 0.0, 0.62, 6.2, 6.95, -Lg / 2, Lg / 2)
                p.pop()
    # the bowed centre: tall arched windows between pilasters, cornice and parapet, the low dome and lantern
    poly = ccw(clip_rect(out, -14.0, 21.0, -30.0, 30.0))
    p.mat('render')
    walls(p, poly, -0.6, 9.2)
    p.mat('render_white')
    band(p, poly, -0.6, 1.0, 0.12)
    cornice(p, poly, 7.6, 1.1)
    parapet(p, poly, 8.25, 0.95, top='render_white')
    p.mat('lead')
    cap(p, offset(poly, -0.3), 8.5)
    for a, b, Lg, n in edges(poly):
        if not on_outline(a, b, out) or Lg < 1.5:
            continue
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        p.push(lframe(mx, mz, n))
        cnt = max(int(Lg / 3.0), 1)
        for i in range(cnt):
            zc = -Lg / 2 + (i + 0.5) * Lg / cnt
            window(p, zc, 0.9, min(1.9, Lg / cnt - 0.7), 3.3, arch=True, frame='render_white', key=True)
        p.mat('render_white')
        for i in range(cnt + 1):
            zc = -Lg / 2 + i * Lg / cnt
            lbox(p, 0.0, 0.16, 0.4, 7.6, zc - 0.25, zc + 0.25)
        p.pop()
    cx, cz = 3.5, 0.0
    p.mat('copper')
    _, fs = p.lathe([(8.5, 1.0), (9.6, 0.97), (10.6, 0.86), (11.4, 0.66), (11.9, 0.4), (12.15, 0.0)], seg=24, axis='y', origin=(0.0, 0.0, 0.0))
    for v in {v for f in fs if f.is_valid for v in f.verts}:
        v.co.x = cx + v.co.x * 12.0
        v.co.z = cz + v.co.z * 9.5
    fix(p, fs)
    p.mat('render_white')
    _, fs = p.lathe([(11.9, 1.5), (13.3, 1.5), (13.3, 1.7), (13.5, 1.7)], seg=8, axis='y', origin=(cx, 0.0, cz))
    fix(p, fs)
    p.mat('copper')
    _, fs = p.lathe([(13.5, 1.6), (14.1, 1.1), (14.5, 0.3), (15.3, 0.0)], seg=8, axis='y', origin=(cx, 0.0, cz))
    fix(p, fs)
    p.mat('dark')
    for k in range(8):
        ang = (k + 0.5) * math.tau / 8
        n = (math.cos(ang), math.sin(ang))
        p.push(lframe(cx + n[0] * 1.52, cz + n[1] * 1.52, n))
        face(p, [(0.0, 12.2, -0.3), (0.0, 12.2, 0.3), (0.0, 13.0, 0.3), (0.0, 13.0, -0.3)], (1, 0, 0))
        p.pop()
    return [p]


def cinema(L):
    out = ccw([tuple(q) for q in L['footprint_xz']])
    p = Part('odeon')
    for rect, h in (((-40.0, 40.0, -40.0, 40.0), 11.0), ((-16.0, 11.0, -21.0, 18.0), 17.5)):
        poly = clip_rect(out, *rect)
        if not poly:
            continue
        poly = ccw(poly)
        p.mat('faience')
        walls(p, poly, -0.6, h)
        p.mat('faience_green')
        band(p, poly, 3.6, 0.3, 0.08)
        band(p, poly, h - 1.4, 0.35, 0.1)
        p.mat('faience')
        band(p, poly, h - 0.3, 0.3, 0.22)
        p.mat('lead')
        cap(p, poly, h)
    a, b, Lg, n = max(((a, b, Lg, n) for a, b, Lg, n in edges(out) if n[0] > 0.8), key=lambda e: e[2])
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    p.push(lframe(mx, mz, n))
    p.mat('faience')
    lbox(p, 0.0, 2.6, 3.9, 4.25, -Lg * 0.42, Lg * 0.42)
    p.mat('faience_green')
    lbox(p, 2.55, 2.65, 3.9, 4.25, -Lg * 0.42, Lg * 0.42)
    for k in range(6):
        window(p, -Lg * 0.3 + Lg * 0.6 * k / 5, 0.0, 1.6, 2.7, sill=False, bars=False, frame='faience')
    for k in range(7):
        window(p, -Lg * 0.36 + Lg * 0.72 * k / 6, 5.0, 0.8, 3.4, frame='faience', bars=False)
    p.pop()
    fx, fz = b[0] - n[0] * 2.0, b[1] - n[1] * 2.0           # the fin tower at the corner
    p.mat('faience')
    lbox(p, fx - 2.0, fx + 2.0, -0.6, 20.0, fz - 2.0, fz + 2.0)
    p.mat('faience_green')
    for k in range(5):
        y = 12.0 + k * 1.6
        lbox(p, fx - 2.05, fx + 2.05, y, y + 0.45, fz - 2.05, fz + 2.05)
    p.mat('faience')
    lbox(p, fx + 1.6, fx + 3.0, 6.0, 23.5, fz - 0.3, fz + 0.3)
    return [p]


def tropicana(L):
    out = ccw([tuple(q) for q in L['footprint_xz']])
    p = Part('tropicana')
    for rect, h in (((10.0, 40.0, -90.0, 50.0), 6.9), ((-70.0, 10.0, -10.0, 40.0), 4.8)):
        poly = clip_rect(out, *rect)
        if not poly:
            continue
        poly = ccw(poly)
        p.mat('render_white')
        walls(p, poly, -0.6, h)
        p.mat('blue')
        band(p, poly, h - 0.9, 0.35, 0.06)
        band(p, poly, 2.7, 0.12, 0.04)
        p.mat('render_white')
        band(p, poly, h - 0.25, 0.25, 0.3)
        p.mat('lead')
        cap(p, poly, h)
        yp = 4.3 if h > 6 else 3.6
        for a, b, Lg, n in edges(poly):
            if Lg < 6 or not on_outline(a, b, out):
                continue
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            p.push(lframe(mx, mz, n))
            cnt = int(Lg / 5.0)
            for i in range(cnt):
                zc = -Lg / 2 + (i + 0.5) * Lg / cnt
                p.mat('render_white')
                p.cyl((0.0, yp, zc), (0.12, yp, zc), 0.72, seg=16)
                p.mat('window')
                p.cyl((0.1, yp, zc), (0.14, yp, zc), 0.55, seg=16)
                window(p, zc, 0.0, 1.4, 2.2, sill=False, bars=False, frame='render_white', glass='door' if i % 4 == 1 else 'window')
            p.pop()
    a, b, Lg, n = max(((a, b, Lg, n) for a, b, Lg, n in edges(out) if n[0] > 0.8), key=lambda e: e[2])
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    p.push(lframe(mx, mz, n))
    p.mat('render_white')
    lbox(p, 0.0, 3.0, 3.2, 3.5, -6.0, 6.0)
    p.mat('blue')
    lbox(p, 2.95, 3.05, 3.2, 3.5, -6.0, 6.0)
    p.mat('render_white')
    lbox(p, 0.0, 0.6, 6.9, 9.5, -4.0, 4.0)
    p.mat('iron')
    for zc in (-5.0, 5.0):
        p.cyl((0.3, 6.9, zc), (0.3, 12.5, zc), 0.05, 0.03, seg=6)
    p.pop()
    return [p]


BUILDERS = [('town_hall', town_hall), ('grand_atlantic_hotel', grand_atlantic), ('winter_gardens', winter_gardens), ('odeon', cinema), ('tropicana', tropicana)]


def landmarks():
    """[(name, parts, info)] for the landmarks with a builder and a footprint"""
    import traceback
    data = load()
    out = []
    for name, fn in BUILDERS:
        L = data.get(name)
        if not L or len(L.get('footprint_xz', [])) < 3:
            continue
        try:
            parts = fn(L)
        except Exception:
            traceback.print_exc()
            continue
        xs = [q[0] for q in L['footprint_xz']]
        zs = [q[1] for q in L['footprint_xz']]
        out.append((name, parts, dict(kind='landmark', size=[round(max(xs) - min(xs), 2), 30.0, round(max(zs) - min(zs), 2)])))
    return out
