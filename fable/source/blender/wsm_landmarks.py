# Landmark buildings of Weston-super-Mare, modelled on their real OpenStreetMap footprints and Environment Agency
# LIDAR heights (wsm_landmarks.json, written by tools/osm/bake_wsm.py) and on reference photographs of the buildings:
# the Town Hall (Bath stone, arched ground floor, clock tower), the Grand Atlantic Hotel (Bath stone with steep slate
# mansards, dormers and conical turrets), the Winter Gardens (neo-Georgian pavilion with tall arched windows and a
# columned entrance), the Art Deco cinema (cream faience with a fin tower) and the Tropicana (white Art Deco walls).
# Frame (as for the props): origin = footprint centroid on the ground, X = towards the street front, Y up, metres.
import json
import math
import os

import bmesh
from mathutils import Vector

from db5_lib import Part, material

HERE = os.path.dirname(os.path.abspath(__file__))
TAU = math.tau

material('bath_stone', 2, 0, (0.64, 0.57, 0.44), ((0.64, 0.57, 0.44), 0.0, 0.8))
material('stone_dark', 2, 0, (0.50, 0.45, 0.36), ((0.50, 0.45, 0.36), 0.0, 0.85))
material('render', 2, 0, (0.86, 0.83, 0.74), ((0.86, 0.83, 0.74), 0.0, 0.75))
material('render_white', 2, 0, (0.92, 0.92, 0.90), ((0.92, 0.92, 0.90), 0.0, 0.7))
material('faience', 2, 0, (0.88, 0.84, 0.70), ((0.88, 0.84, 0.70), 0.0, 0.35))
material('faience_green', 2, 0, (0.10, 0.30, 0.24), ((0.10, 0.30, 0.24), 0.0, 0.35))
material('lead', 2, 0, (0.30, 0.31, 0.33), ((0.30, 0.31, 0.33), 0.2, 0.6))
material('window', 7, 0, (0.20, 0.23, 0.27), ((0.12, 0.14, 0.17), 1.0, 0.08))
material('clock', 2, 0, (0.92, 0.92, 0.88), ((0.92, 0.92, 0.88), 0.0, 0.4))


def load():
    with open(os.path.join(HERE, 'wsm_landmarks.json')) as f:
        return {L['name']: L for L in json.load(f)['landmarks']}


def fix(p, fs):
    bmesh.ops.recalc_face_normals(p.bm, faces=[f for f in fs if f.is_valid])


def edges(poly):
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dz)
        if ln < 1e-6:
            continue
        nx, nz = dz / ln, -dx / ln                      # outward for this winding (checked against the centroid)
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if nx * mx + nz * mz < 0 and abs(mx) + abs(mz) > 1e-3:
            pass
        yield a, b, ln, (nx, nz)


def winding_sign(poly):
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return 1.0 if s > 0 else -1.0


def outward(poly):
    """Outward normals per edge, whatever the winding."""
    sg = winding_sign(poly)
    out = []
    for a, b, ln, (nx, nz) in edges(poly):
        out.append((a, b, ln, (nx * sg, nz * sg)))
    return out


def offset_poly(poly, d):
    """Miter offset (d > 0 outwards)."""
    sg = winding_sign(poly)
    n = len(poly)
    res = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        def nrm(a, b):
            dx, dz = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dz) or 1.0
            return (dz / ln * sg, -dx / ln * sg)
        n1, n2 = nrm(p0, p1), nrm(p1, p2)
        bx, bz = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, bz) or 1.0
        bx, bz = bx / bl, bz / bl
        cosh = max(bx * n1[0] + bz * n1[1], 0.35)
        res.append((p1[0] + bx * d / cosh, p1[1] + bz * d / cosh))
    return res


def face(p, pts, normal_hint):
    """n-gon from 3D points, oriented to normal_hint."""
    vs = [p.bm.verts.new(p.xf @ Vector(q)) for q in pts]
    try:
        f = p.bm.faces.new(vs)
    except ValueError:
        return None
    f.material_index = p.mi
    f.normal_update()
    if f.normal.dot(Vector(normal_hint)) < 0:
        f.normal_flip()
    return f


def walls(p, poly, y0, y1):
    for a, b, ln, (nx, nz) in outward(poly):
        face(p, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], (nx, 0, nz))


def cap(p, poly, y, up=True):
    face(p, [(x, y, z) for x, z in poly], (0, 1 if up else -1, 0))


def band(p, poly, y, h, depth):
    """String course / cornice: a projecting strip round the building."""
    op = offset_poly(poly, depth)
    walls(p, op, y, y + h)
    n = len(poly)
    for i in range(n):
        a, b, oa, ob = poly[i], poly[(i + 1) % n], op[i], op[(i + 1) % n]
        face(p, [(a[0], y + h, a[1]), (b[0], y + h, b[1]), (ob[0], y + h, ob[1]), (oa[0], y + h, oa[1])], (0, 1, 0))
        face(p, [(a[0], y, a[1]), (oa[0], y, oa[1]), (ob[0], y, ob[1]), (b[0], y, b[1])], (0, -1, 0))


def window(p, c, n, w, h, arch=False, frame='bath_stone', sill=True):
    """Window on a wall: dark glass a little proud of the wall, a stone surround, a sill; optional round head."""
    nx, nz = n
    tx, tz = -nz, nx
    cx, cy, cz = c
    glass = []
    k = 6 if arch else 0
    pts = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h)]
    for j in range(k + 1):
        t = j / max(k, 1) * math.pi
        pts.append((math.cos(t) * w / 2, h + math.sin(t) * w / 2)) if arch else None
    if not arch:
        pts.append((-w / 2, h))
    else:
        pts = pts[:3] + pts[3:]
    p.mat('window')
    q = [(cx + tx * u + nx * 0.03, cy + v, cz + tz * u + nz * 0.03) for u, v in pts]
    face(p, q, (nx, 0, nz))
    p.mat(frame)
    fw = 0.12
    top = h + (w / 2 if arch else 0)
    for u0, u1, v0, v1 in ((-w / 2 - fw, -w / 2, -fw, top), (w / 2, w / 2 + fw, -fw, top), (-w / 2 - fw, w / 2 + fw, top, top + fw)):
        uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
        p.box((cx + tx * uc + nx * 0.05, cy + vc, cz + tz * uc + nz * 0.05), (abs(tx) * (u1 - u0) + abs(nx) * 0.10 + 0.001,
               v1 - v0, abs(tz) * (u1 - u0) + abs(nz) * 0.10 + 0.001))
    if sill:
        p.box((cx + nx * 0.08, cy - 0.06, cz + nz * 0.08), (abs(tx) * (w + 0.3) + abs(nx) * 0.16 + 0.001, 0.08, abs(tz) * (w + 0.3) + abs(nz) * 0.16 + 0.001))


def windows_along(p, poly, floors, pitch, w, h, arch_floor=-1, front_only=False, min_len=2.5, frame='bath_stone', skip=None):
    for a, b, ln, n in outward(poly):
        if ln < min_len or (front_only and n[0] < 0.6):
            continue
        cnt = max(int(ln / pitch), 1)
        for i in range(cnt):
            t = (i + 0.5) / cnt
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            if skip and skip(x, z, n):
                continue
            for fi, y in enumerate(floors):
                window(p, (x, y, z), n, w, h, arch=(fi == arch_floor), frame=frame)


def front_edge(poly):
    """The longest edge facing +X (the street front)."""
    best = None
    for a, b, ln, n in outward(poly):
        if n[0] > 0.6 and (best is None or ln > best[2]):
            best = (a, b, ln, n)
    return best


def turret(p, x, z, r, y0, y1, spire, mat='bath_stone', roof='lead'):
    p.mat(mat)
    _, fs = p.lathe([(y0, r), (y1, r), (y1 + 0.3, r + 0.15), (y1 + 0.6, r + 0.15)], seg=16, axis='y', origin=(x, 0, z))
    fix(p, fs)
    p.mat(roof)
    _, fs = p.lathe([(y1 + 0.6, r + 0.2), (y1 + 0.6 + spire * 0.8, r * 0.25), (y1 + 0.6 + spire, 0.0)], seg=16, axis='y', origin=(x, 0, z))
    fix(p, fs)
    p.cyl((x, y1 + 0.6 + spire, z), (x, y1 + 1.6 + spire, z), 0.05, 0.01, seg=6)


# ------------------------------------------------------------------------------------------- landmarks
def town_hall(L):
    """Bath-stone Victorian town hall: arched ground floor, string courses, a balustraded parapet, a central gable on
    the front and a clock tower with corner pinnacles and a pyramid cap."""
    poly = L['footprint_xz']
    H = L['eaves_m']
    p = Part('town_hall').mat('bath_stone')
    walls(p, poly, 0.0, H - 1.0)
    band(p, poly, 0.0, 0.6, 0.25)
    band(p, poly, 5.0, 0.35, 0.12)
    band(p, poly, 10.2, 0.3, 0.10)
    band(p, poly, H - 1.6, 0.6, 0.35)
    p.mat('stone_dark')
    walls(p, offset_poly(poly, -0.05), H - 1.0, H)                         # parapet
    cap(p, offset_poly(poly, -0.05), H)
    p.mat('lead')
    cap(p, offset_poly(poly, -0.6), H - 0.4)
    windows_along(p, poly, [1.3, 6.2, 11.0], 3.4, 1.4, 2.4, arch_floor=0)
    fe = front_edge(poly)
    if fe:
        a, b, ln, n = fe
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        tx, tz = -n[1], n[0]
        # central gable over the entrance
        p.mat('bath_stone')
        w = min(ln * 0.35, 14.0)
        gx, gz = mx + n[0] * 0.4, mz + n[1] * 0.4
        face(p, [(gx - tx * w / 2, H, gz - tz * w / 2), (gx + tx * w / 2, H, gz + tz * w / 2), (gx, H + w * 0.35, gz)], (n[0], 0, n[1]))
        p.box((gx - n[0] * 0.2, H / 2, gz - n[1] * 0.2), (abs(tx) * w + abs(n[0]) * 1.2 + 0.01, H, abs(tz) * w + abs(n[1]) * 1.2 + 0.01))
        # clock tower towards one end of the front
        cx, cz = mx + tx * ln * 0.30 - n[0] * 3.5, mz + tz * ln * 0.30 - n[1] * 3.5
        s, th = 6.4, H + 14.5
        p.mat('bath_stone')
        p.box((cx, th / 2, cz), (s, th, s))
        for y in (H + 0.2, th - 4.5):
            p.box((cx, y, cz), (s + 0.4, 0.4, s + 0.4))
        p.mat('clock')
        for k in range(4):
            ang = k * math.pi / 2
            ux, uz = math.cos(ang), math.sin(ang)
            fc = (cx + ux * (s / 2 + 0.06), th - 2.4, cz + uz * (s / 2 + 0.06))
            _, fs = p.lathe([(-0.01, 1.2), (0.0, 1.2), (0.01, 0.0)], seg=24, axis='x', origin=(0, 0, 0)) if False else (None, [])
            p.cyl((fc[0] - ux * 0.03, fc[1], fc[2] - uz * 0.03), (fc[0] + ux * 0.03, fc[1], fc[2] + uz * 0.03), 1.25, seg=24)
            p.mat('black')
            p.box((fc[0] + ux * 0.05, fc[1] + 0.4, fc[2] + uz * 0.05), (abs(uz) * 0.08 + abs(ux) * 0.02, 0.8, abs(ux) * 0.08 + abs(uz) * 0.02))
            p.box((fc[0] + ux * 0.05 + uz * 0.3, fc[1], fc[2] + uz * 0.05 + ux * 0.3), (abs(uz) * 0.6 + abs(ux) * 0.02, 0.08, abs(ux) * 0.6 + abs(uz) * 0.02))
            p.mat('clock')
        p.mat('window')
        for k in range(4):
            ang = k * math.pi / 2
            ux, uz = math.cos(ang), math.sin(ang)
            for dy in (H + 2.0, H + 5.5):
                window(p, (cx + ux * (s / 2), dy, cz + uz * (s / 2)), (ux, uz), 1.0, 2.2, arch=True)
        p.mat('lead')
        _, fs = p.lathe([(th, s * 0.72), (th + 5.5, 0.15), (th + 5.8, 0.0)], seg=4, axis='y', origin=(cx, 0, cz))
        fix(p, fs)
        p.mat('bath_stone')
        for sx in (-1, 1):
            for sz in (-1, 1):
                turret(p, cx + sx * (s / 2 - 0.3), cz + sz * (s / 2 - 0.3), 0.35, th - 0.6, th + 0.4, 2.2, mat='bath_stone', roof='bath_stone')
    return [p]


def grand_atlantic(L):
    """Grand Atlantic Hotel: Bath-stone walls with bays, steep slate mansards with dormers, conical corner turrets."""
    poly = L['footprint_xz']
    H = L['eaves_m']
    wall_h = H - 5.0
    p = Part('grand_atlantic').mat('bath_stone')
    walls(p, poly, 0.0, wall_h)
    band(p, poly, 0.0, 0.5, 0.2)
    band(p, poly, 3.8, 0.3, 0.12)
    band(p, poly, wall_h - 0.5, 0.5, 0.35)
    windows_along(p, poly, [1.2, 4.7, 7.9, 11.1], 3.2, 1.3, 2.2, arch_floor=0)
    # bays on the front: three storeys, canted
    fe = front_edge(poly)
    if fe:
        a, b, ln, n = fe
        tx, tz = -n[1], n[0]
        nb = max(int(ln / 9.0), 1)
        for i in range(nb):
            t = (i + 0.5) / nb
            x, z = a[0] + (b[0] - a[0]) * t + n[0] * 0.9, a[1] + (b[1] - a[1]) * t + n[1] * 0.9
            p.mat('bath_stone')
            p.box((x, 6.0, z), (abs(tx) * 3.6 + abs(n[0]) * 1.8 + 0.01, 12.0, abs(tz) * 3.6 + abs(n[1]) * 1.8 + 0.01))
            for y in (1.2, 4.7, 7.9):
                window(p, (x + n[0] * 0.9, y, z + n[1] * 0.9), n, 1.6, 2.2)
            p.mat('slate')
            p.box((x, 12.3, z), (abs(tx) * 3.9 + abs(n[0]) * 2.1 + 0.01, 0.6, abs(tz) * 3.9 + abs(n[1]) * 2.1 + 0.01))
    # mansard
    p.mat('slate')
    inner = offset_poly(poly, -1.8)
    n = len(poly)
    for i in range(n):
        a0, b0, a1, b1 = poly[i], poly[(i + 1) % n], inner[i], inner[(i + 1) % n]
        dx, dz = b0[0] - a0[0], b0[1] - a0[1]
        ln = math.hypot(dx, dz) or 1.0
        sg = winding_sign(poly)
        nn = (dz / ln * sg, -dx / ln * sg)
        face(p, [(a0[0], wall_h, a0[1]), (b0[0], wall_h, b0[1]), (b1[0], H, b1[1]), (a1[0], H, a1[1])], (nn[0], 0.5, nn[1]))
    cap(p, inner, H)
    # dormers on the mansard
    for a, b, ln, nn in outward(poly):
        if ln < 4.0:
            continue
        cnt = max(int(ln / 4.2), 1)
        for i in range(cnt):
            t = (i + 0.5) / cnt
            x, z = a[0] + (b[0] - a[0]) * t - nn[0] * 0.7, a[1] + (b[1] - a[1]) * t - nn[1] * 0.7
            p.mat('bath_stone')
            p.box((x, wall_h + 1.6, z), (abs(nn[1]) * 1.6 + abs(nn[0]) * 1.2 + 0.01, 2.2, abs(nn[0]) * 1.6 + abs(nn[1]) * 1.2 + 0.01))
            window(p, (x + nn[0] * 0.6, wall_h + 0.8, z + nn[1] * 0.6), nn, 0.9, 1.4, sill=False)
            p.mat('slate')
            tx, tz = -nn[1], nn[0]
            fx, fz = x + nn[0] * 0.62, z + nn[1] * 0.62
            face(p, [(fx - tx * 0.95, wall_h + 2.7, fz - tz * 0.95), (fx + tx * 0.95, wall_h + 2.7, fz + tz * 0.95), (fx, wall_h + 3.5, fz)], (nn[0], 0, nn[1]))
    # turrets at the four extreme corners of the footprint
    xs = sorted(poly, key=lambda q: q[0] + q[1])
    ys = sorted(poly, key=lambda q: q[0] - q[1])
    for q in (xs[0], xs[-1], ys[0], ys[-1]):
        turret(p, q[0], q[1], 2.0, 0.0, H, 6.0, roof='slate')
        p.mat('window')
        for k in range(4):
            ang = k * math.pi / 2 + 0.4
            for y in (4.7, 7.9, 11.1, 14.3):
                window(p, (q[0] + math.cos(ang) * 2.0, y, q[1] + math.sin(ang) * 2.0), (math.cos(ang), math.sin(ang)), 0.8, 1.9)
    return [p]


def winter_gardens(L):
    """Winter Gardens pavilion: long, low, cream-rendered neo-Georgian hall with tall round-arched windows, a
    balustraded parapet, and a columned entrance portico with a pediment on its street front."""
    poly = L['footprint_xz']
    H = L['eaves_m']
    p = Part('winter_gardens').mat('render')
    walls(p, poly, 0.0, H - 1.0)
    band(p, poly, 0.0, 0.5, 0.18)
    band(p, poly, H - 1.6, 0.5, 0.3)
    p.mat('render_white')
    walls(p, offset_poly(poly, -0.05), H - 1.0, H)
    cap(p, offset_poly(poly, -0.05), H)
    p.mat('lead')
    cap(p, offset_poly(poly, -0.5), H - 0.3)
    windows_along(p, poly, [0.9], 3.6, 1.8, 3.6, arch_floor=0, frame='render_white')
    fe = front_edge(poly)
    if fe:
        a, b, ln, n = fe
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        tx, tz = -n[1], n[0]
        w = min(ln * 0.3, 16.0)
        p.mat('render_white')
        for k in range(6):                                                   # portico columns
            u = -w / 2 + w * k / 5
            x, z = mx + tx * u + n[0] * 3.2, mz + tz * u + n[1] * 3.2
            _, fs = p.lathe([(0.0, 0.42), (0.5, 0.42), (0.6, 0.34), (H - 2.0, 0.30), (H - 1.8, 0.40), (H - 1.6, 0.40)], seg=14, axis='y', origin=(x, 0, z))
            fix(p, fs)
        cx, cz = mx + n[0] * 1.8, mz + n[1] * 1.8
        p.box((cx, H - 1.0, cz), (abs(tx) * (w + 1.2) + abs(n[0]) * 3.8 + 0.01, 1.2, abs(tz) * (w + 1.2) + abs(n[1]) * 3.8 + 0.01))
        face(p, [(cx + n[0] * 1.9 - tx * (w / 2 + 0.6), H - 0.4, cz + n[1] * 1.9 - tz * (w / 2 + 0.6)),
                 (cx + n[0] * 1.9 + tx * (w / 2 + 0.6), H - 0.4, cz + n[1] * 1.9 + tz * (w / 2 + 0.6)),
                 (cx + n[0] * 1.9, H + 2.6, cz + n[1] * 1.9)], (n[0], 0, n[1]))
        p.mat('lead')
        for s in (-1, 1):
            face(p, [(cx + n[0] * 1.9 + s * tx * (w / 2 + 0.6), H - 0.4, cz + n[1] * 1.9 + s * tz * (w / 2 + 0.6)),
                     (cx - n[0] * 1.9 + s * tx * (w / 2 + 0.6), H - 0.4, cz - n[1] * 1.9 + s * tz * (w / 2 + 0.6)),
                     (cx - n[0] * 1.9, H + 2.6, cz - n[1] * 1.9), (cx + n[0] * 1.9, H + 2.6, cz + n[1] * 1.9)], (s * tx, 1, s * tz))
    return [p]


def cinema(L):
    """Art Deco cinema: cream faience walls banded in green, a canopy over the entrance, a fin tower at the front and
    the gabled auditorium roof behind (no lettering)."""
    poly = L['footprint_xz']
    H = L['eaves_m']
    p = Part('cinema').mat('faience')
    walls(p, poly, 0.0, H)
    p.mat('faience_green')
    band(p, poly, 3.2, 0.25, 0.06)
    band(p, poly, H - 1.2, 0.35, 0.10)
    p.mat('faience')
    band(p, poly, H - 0.3, 0.3, 0.2)
    p.mat('lead')
    cap(p, poly, H)
    fe = front_edge(poly)
    if fe:
        a, b, ln, n = fe
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        tx, tz = -n[1], n[0]
        p.mat('faience')
        p.box((mx + n[0] * 2.2, 3.9, mz + n[1] * 2.2), (abs(tx) * ln * 0.8 + abs(n[0]) * 4.4 + 0.01, 0.35, abs(tz) * ln * 0.8 + abs(n[1]) * 4.4 + 0.01))
        p.mat('window')
        for k in range(5):
            u = -ln * 0.3 + ln * 0.6 * k / 4
            window(p, (mx + tx * u, 0.2, mz + tz * u), n, 1.8, 2.6, sill=False, frame='faience')
        for k in range(7):
            u = -ln * 0.36 + ln * 0.72 * k / 6
            window(p, (mx + tx * u, 5.2, mz + tz * u), n, 0.9, 2.4, frame='faience')
        fx, fz = mx + tx * ln * 0.42, mz + tz * ln * 0.42
        p.mat('faience')
        p.box((fx, (H + 9.0) / 2, fz), (3.4, H + 9.0, 3.4))
        p.mat('faience_green')
        for k in range(4):
            p.box((fx + n[0] * 1.75, H + 1.0 + k * 1.8, fz + n[1] * 1.75), (abs(tx) * 2.6 + abs(n[0]) * 0.12 + 0.01, 0.5, abs(tz) * 2.6 + abs(n[1]) * 0.12 + 0.01))
        p.mat('faience')
        p.box((fx + n[0] * 2.1, H + 4.8, fz + n[1] * 2.1), (abs(tx) * 0.5 + abs(n[0]) * 1.0 + 0.01, H + 8.5, abs(tz) * 0.5 + abs(n[1]) * 1.0 + 0.01))
    # auditorium roof: a low gable behind the front block
    rise = L.get('ridge_rise_m') or 6.0
    xs = [q[0] for q in poly]
    zs = [q[1] for q in poly]
    x0, x1, z0, z1 = min(xs) + 2, max(xs) - 9, min(zs) + 1.5, max(zs) - 1.5
    if x1 - x0 > 6:
        p.mat('slate')
        zm = (z0 + z1) / 2
        face(p, [(x0, H, z0), (x1, H, z0), (x1, H + rise, zm), (x0, H + rise, zm)], (0, 1, -1))
        face(p, [(x1, H, z1), (x0, H, z1), (x0, H + rise, zm), (x1, H + rise, zm)], (0, 1, 1))
        p.mat('faience')
        face(p, [(x0, H, z0), (x0, H + rise, zm), (x0, H, z1)], (-1, 0, 0))
        face(p, [(x1, H, z1), (x1, H + rise, zm), (x1, H, z0)], (1, 0, 0))
    return [p]


def tropicana(L):
    """Tropicana: white Art Deco walls with horizontal bands, porthole windows and a flat roof."""
    poly = L['footprint_xz']
    H = L['eaves_m']
    p = Part('tropicana').mat('render_white')
    walls(p, poly, 0.0, H)
    p.mat('faience_green')
    band(p, poly, H - 0.9, 0.25, 0.08)
    band(p, poly, 2.6, 0.15, 0.05)
    p.mat('render_white')
    band(p, poly, H - 0.2, 0.25, 0.25)
    p.mat('lead')
    cap(p, poly, H)
    for a, b, ln, n in outward(poly):
        if ln < 6:
            continue
        cnt = int(ln / 6)
        for i in range(cnt):
            t = (i + 0.5) / cnt
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            p.mat('window')
            p.cyl((x + n[0] * 0.01, 4.3, z + n[1] * 0.01), (x + n[0] * 0.05, 4.3, z + n[1] * 0.05), 0.55, seg=16)
    return [p]


BUILDERS = dict(town_hall=town_hall, grand_atlantic_hotel=grand_atlantic, winter_gardens=winter_gardens, odeon=cinema, tropicana=tropicana)


def landmarks():
    """[(name, parts, info)] for every landmark that has a builder and a footprint."""
    out = []
    data = load()
    for name, fn in BUILDERS.items():
        L = data.get(name)
        if not L or len(L.get('footprint_xz', [])) < 3:
            continue
        parts = fn(L)
        xs = [q[0] for q in L['footprint_xz']]
        zs = [q[1] for q in L['footprint_xz']]
        out.append((name, parts, dict(kind='landmark', size=[round(max(xs) - min(xs), 2), round(L['eaves_m'] + 15, 2), round(max(zs) - min(zs), 2)])))
    return out
