# Builds the Aston Martin DB5 in Blender (headless) and exports it for the game.
#   blender -b -P db5_build.py -- [--render DIR] [--export FILE.js] [--fast]
# All geometry is authored in the game's car frame (X forward, Y up, Z right; metres).
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import db5_lib as L
import db5_shape as S
import db5_parts as X
import db5_interior as I
from db5_lib import Part, cut_field, extrude_rim, material, move_faces, rrect

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d=None: ARGS[ARGS.index(k) + 1] if k in ARGS else d
FAST = '--fast' in ARGS

# ------------------------------------------------------------------ materials
# (game material id, variant) + preview look for the Blender renders
SILVER = (0.52, 0.53, 0.54)
material('paint', 20, 0, (1, 1, 1), (SILVER, 0.9, 0.22, dict(coat=1.0)))
material('paint_in', 20, 1, (1, 1, 1), ((0.05, 0.05, 0.05), 0.2, 0.7))        # panel edges / inner lips
material('chrome', 7, 0, (0.95, 0.95, 0.96), ((0.9, 0.9, 0.92), 1.0, 0.06))
material('chrome_satin', 7, 1, (0.8, 0.8, 0.82), ((0.8, 0.8, 0.82), 1.0, 0.25))
material('rubber', 3, 0, (0.02, 0.02, 0.02), ((0.02, 0.02, 0.02), 0.0, 0.8))
material('under', 13, 0, (0.006, 0.006, 0.007), ((0.01, 0.01, 0.01), 0.0, 1.0))
material('black', 2, 0, (0.02, 0.02, 0.021), ((0.02, 0.02, 0.02), 0.0, 0.6))
material('tire', 21, 0, (0.02, 0.02, 0.021), ((0.025, 0.025, 0.025), 0.0, 0.85))
material('spoke', 7, 2, (0.85, 0.85, 0.87), ((0.85, 0.85, 0.87), 1.0, 0.15))
material('wheelblur', 27, 0, (0.7, 0.7, 0.72), ((0.7, 0.7, 0.72), 1.0, 0.3), target='skip')
material('reflector', 23, 0, (0.9, 0.9, 0.92), ((0.95, 0.95, 0.95), 1.0, 0.03))
material('lens_clear', 22, 0, (0.9, 0.9, 0.88), ((0.9, 0.9, 0.88), 0.0, 0.05, dict(glass=1)))
material('lens_amber', 22, 2, (0.75, 0.33, 0.03), ((0.8, 0.3, 0.02), 0.0, 0.15))
material('lens_red', 22, 1, (0.6, 0.02, 0.015), ((0.5, 0.01, 0.01), 0.0, 0.15))
material('lens_reflex', 22, 3, (0.45, 0.02, 0.015), ((0.35, 0.01, 0.01), 0.0, 0.3))
material('lens_white', 22, 4, (0.85, 0.85, 0.82), ((0.85, 0.85, 0.82), 0.0, 0.15))
material('mirror', 15, 0, (0.62, 0.64, 0.67), ((0.9, 0.9, 0.9), 1.0, 0.02))
material('gunmetal', 6, 1, (0.05, 0.05, 0.055), ((0.05, 0.05, 0.055), 0.9, 0.4))
material('muzzle', 28, 0, (1.0, 0.8, 0.4), ((1.0, 0.7, 0.3), 0.0, 0.5), target='skip')
material('leather', 24, 0, (0.022, 0.022, 0.024), ((0.02, 0.02, 0.022), 0.0, 0.45))
material('leather_trim', 24, 1, (0.022, 0.022, 0.024), ((0.022, 0.022, 0.024), 0.0, 0.5))
material('carpet', 25, 0, (0.03, 0.03, 0.032), ((0.03, 0.03, 0.032), 0.0, 1.0))
material('headlining', 25, 1, (0.55, 0.53, 0.47), ((0.55, 0.53, 0.47), 0.0, 1.0))
material('suit', 25, 2, (0.03, 0.03, 0.035), ((0.03, 0.03, 0.035), 0.0, 0.9))
material('shirt', 25, 3, (0.8, 0.8, 0.78), ((0.8, 0.8, 0.78), 0.0, 0.9))
material('skin', 25, 4, (0.62, 0.42, 0.32), ((0.62, 0.42, 0.32), 0.0, 0.6))
material('hair', 25, 5, (0.05, 0.035, 0.025), ((0.05, 0.035, 0.025), 0.0, 0.7))
material('dash', 26, 0, (0.02, 0.02, 0.021), ((0.02, 0.02, 0.021), 0.0, 0.35))
material('wood', 26, 1, (0.42, 0.22, 0.09), ((0.42, 0.22, 0.09), 0.0, 0.25, dict(coat=1.0)))
material('alloy', 7, 1, (0.8, 0.8, 0.82), ((0.8, 0.8, 0.82), 1.0, 0.3))
material('armour', 6, 0, (0.25, 0.26, 0.27), ((0.25, 0.26, 0.27), 0.9, 0.45))
material('decal_plate', 12, 0, (1, 1, 1), ((0.02, 0.02, 0.02), 0.0, 0.5))
material('decal_badge', 12, 1, (1, 1, 1), ((0.8, 0.8, 0.8), 1.0, 0.2))
material('decal_dials', 12, 2, (1, 1, 1), ((0.03, 0.03, 0.03), 0.0, 0.3))
material('decal_radar', 12, 3, (1, 1, 1), ((0.1, 0.3, 0.1), 0.0, 0.3, dict(emit=1.0)))
material('decal_panel', 12, 4, (1, 1, 1), ((0.05, 0.05, 0.05), 0.0, 0.4))
material('glass', 0, 0, (0.86, 0.92, 0.90), ((0.9, 0.95, 0.93), 0.0, 0.0, dict(glass=1)), target='glass')
material('glass_lamp', 1, 0, (0.95, 0.96, 0.96), ((1, 1, 1), 0.0, 0.0, dict(glass=1)), target='glass')

# ------------------------------------------------------------------ fields (negative = inside)
B = S.BELT


def csmax(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return max(a, b) + h * h * k * 0.25


_re = {}


def roof_edge(x):
    k = round(x, 3)
    if k not in _re:
        _re[k] = S.roof_edge_y(k)
    return _re[k]


def f_arch(p):
    fr = math.hypot(p.x - S.AXF, p.y - S.ARCH_Y) - S.ARCH_R
    # rear arch: wider and flatter on top
    rr = csmax(math.hypot((p.x - S.AXR) / 1.06, p.y - S.ARCH_Y + 0.02) - S.ARCH_R, p.y - (S.ARCH_Y + S.ARCH_R - 0.035), 0.12)
    return min(fr, rr)


# side glass: one opening from the A pillar to the tapering rear quarter, split by the B post
A0, A1 = (0.505, B), (0.03, 1.25)       # A-pillar line (side view)
_an = Vector((-(A1[1] - A0[1]), A1[0] - A0[0])).normalized()      # normal pointing down/back


def f_side(p):
    x, y = p.x, p.y
    bottom = (B + 0.016) - y
    topc = y - (float(S.roof_c(min(max(x, -1.3), 0.0) - 0.16 * float(S.sm(-0.55, -1.2, x)))) - 0.118)
    front = 0.060 - ((x - A0[0]) * _an.x + (y - A0[1]) * _an.y) * (1 if _an.y < 0 else -1)
    rear = (-1.22 + 0.80 * (y - B)) - x                         # C pillar leans forward with the fastback
    return csmax(csmax(bottom, topc, 0.04), csmax(front, rear, 0.05), 0.05)


def f_bpost(p):
    return abs(p.x + 0.455 + 0.05 * (p.y - B)) - 0.016


def edge_z(p):
    """Half width of the cabin skin at the height of p (where the side glass plane is)."""
    return float(S.z_glass(p.x)) - (p.y - B) / S.COT_TH


def f_windscreen(p):
    if p.x < -0.2 or p.y < B:
        return 1.0
    zz = abs(p.z) / 0.60
    xe = p.x + 0.12 * zz * zz * float(S.sm(-0.25, 0.4, p.x))
    return csmax(csmax(xe - 0.565, 0.075 - xe, 0.05), abs(p.z) - (edge_z(p) - 0.050), 0.07)


def f_backlight(p):
    if p.x > -0.5 or p.y < B:
        return 1.0
    zz = abs(p.z) / 0.60
    xe = p.x - 0.15 * zz * zz * float(S.sm(-0.55, -1.2, p.x))
    return csmax(csmax(xe + 0.86, -1.36 - xe, 0.06), abs(p.z) - (edge_z(p) - 0.075), 0.09)


HL = dict(z=0.640, y=0.668, rz=0.100, ry=0.118)


def f_headlamp(p):
    if p.x < 1.3:
        return 1.0
    return csmax((math.hypot((abs(p.z) - HL['z']) / HL['rz'], (p.y - HL['y']) / HL['ry']) - 1.0) * 0.09, 1.66 - p.x, 0.05)


def f_grille(p):
    if p.x < 1.6:
        return 1.0
    z, y = abs(p.z), p.y
    top_y = 0.612 + 0.034 * (1 - float(S.sm(0.06, 0.22, z)))      # the Aston "shoulders"
    return csmax(csmax(z - 0.400, 0.448 - y, 0.10), y - top_y, 0.05)


def f_vent(p):
    if abs(p.z) < 0.5:
        return 1.0
    return rrect(p.x - 0.675, p.y - 0.665, 0.120, 0.040, 0.038)


def f_roofpanel(p):
    return rrect(p.x + 0.30, p.z - 0.32, 0.27, 0.215, 0.05)


def seam(p, n):
    x, y, z = p.x, p.y, abs(p.z)
    d = 1.0
    if abs(n.z) > 0.45 and y < B + 0.05:                       # door
        d = min(d, rrect(x - 0.02, y - (0.228 + B) / 2, 0.485, (B - 0.228) / 2 + 0.004, 0.035))
    if n.y > 0.35 and x > 0.55:                                # bonnet (front hinged, reaches down to the grille)
        zb = 0.625 - 0.135 * float(S.sm(0.8, 1.9, x))
        d = min(d, csmax(csmax(z - zb, 0.685 - x, 0.05), x - (1.955 - 0.30 * (z / 0.6) ** 2), 0.08))
    if x < -1.45 and (n.y > 0.3 or n.x < -0.3):                # boot lid, wrapping down the tail
        d = min(d, csmax(csmax(z - 0.535, x + 1.60, 0.10), 0.545 - y, 0.06))
    if n.z > 0.2 and x < -1.2 and y > B + 0.02:                # fuel filler flaps on the rear pillars
        d = min(d, rrect(x + 1.435, y - (B + 0.115), 0.05, 0.045, 0.014))
    return d


def build_body():
    nu, nv = (120, 56) if FAST else (230, 100)
    P, xs = S.body_grid(nu, nv)
    body = Part('body', mirror=True).mat('paint')
    glass = Part('glass', mirror=True, target='glass').mat('glass')
    trim = Part('trim', mirror=True)
    bm = body.bm
    vs = [[bm.verts.new(P[i, j]) for j in range(nv)] for i in range(nu)]
    for i in range(nu - 1):
        for j in range(nv - 1):
            f = bm.faces.new([vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j]])
            f.smooth = True
            f.material_index = L.MATS['paint']['index']
    bm.normal_update()
    cz = sum(f.normal.z for f in bm.faces if f.calc_center_median().z > 0.6)
    if cz < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.normal_update()

    side = lambda fc: fc.normal.z > 0.35
    # --- wheel arches
    ins, _ = cut_field(bm, [f for f in bm.faces if side(f) and f.calc_center_median().y < 0.82], f_arch)
    bmesh.ops.delete(bm, geom=ins, context='FACES')

    def window(field, sel, frame=0.013, frame_mat='chrome', glass_mat='glass', lift=0.003, sink=0.004):
        """Cut an opening: a frame ring around it, the pane itself moved to the glass part."""
        ring, _ = cut_field(bm, [f for f in bm.faces if sel(f)], lambda p: field(p) - frame)
        pane, ring = cut_field(bm, ring, field)
        glass.mat(glass_mat)
        move_faces(bm, pane, glass, -sink)
        trim.mat(frame_mat)
        move_faces(bm, [f for f in ring if f.is_valid], trim, lift)

    # --- side glass (door + quarter light) with chrome frames and the B post
    window(lambda p: max(f_side(p), -f_bpost(p)), lambda f: side(f) and f.calc_center_median().y > B - 0.03)
    window(f_windscreen, lambda f: f.calc_center_median().x > -0.3 and f.calc_center_median().y > B - 0.02, frame=0.016)
    window(f_backlight, lambda f: f.calc_center_median().x < -0.5 and f.calc_center_median().y > B - 0.02, frame=0.016)
    # --- headlamp cowls (Perspex covers) and the grille mouth
    hl = [f for f in bm.faces if f.calc_center_median().x > 1.3 and f_headlamp(f.calc_center_median()) < 0.25]
    pan = Part('pan', mirror=True).mat('paint')            # dark tray under the cowl, behind the lamp
    bm.normal_update()
    vm = {}
    for fc in hl:
        q = []
        for v in fc.verts:
            if v not in vm:
                vm[v] = pan.bm.verts.new(v.co - v.normal * 0.075 - Vector((0.06, 0, 0)))
            q.append(vm[v])
        pan.bm.faces.new(q).material_index = pan.mi
    window(f_headlamp, lambda f: f.calc_center_median().x > 1.3, frame=0.012, glass_mat='glass_lamp', sink=0.0)
    ring, _ = cut_field(bm, [f for f in bm.faces if f.calc_center_median().x > 1.6], lambda p: f_grille(p) - 0.014)
    ins, ring = cut_field(bm, ring, f_grille)
    bmesh.ops.delete(bm, geom=ins, context='FACES')
    trim.mat('chrome')
    move_faces(bm, [f for f in ring if f.is_valid], trim, 0.004)
    ins, _ = cut_field(bm, [f for f in bm.faces if side(f)], f_vent)
    bmesh.ops.delete(bm, geom=ins, context='FACES')
    # --- bonnet scoop mouth
    bm.normal_update()
    for fc in bm.faces:
        c = fc.calc_center_median()
        if fc.normal.x > 0.45 and c.z < 0.21 and 1.45 < c.x < 1.66 and c.y > 0.74:
            fc.material_index = L.MATS['black']['index']
    # --- ejector-seat roof panel: fixed on the driver's side, a separate moving part over the passenger
    roofR = Part('roofR').mat('paint')
    roofpanel = Part('roofpanel', target='roofpanel')
    ins, _ = cut_field(bm, [f for f in bm.faces if f.calc_center_median().y > 1.12], f_roofpanel)
    L.split_asym(bm, ins, roofR, roofpanel, L.MATS['paint']['index'])
    # --- shut lines: signed distance to the nearest panel gap goes in uv.x (drawn by the paint shader)
    bm.normal_update()
    for part in (body, roofR, roofpanel):
        part.bm.normal_update()
        uvl = part.uv
        for fc in part.bm.faces:
            if fc.material_index != L.MATS['paint']['index']:
                continue
            for lp in fc.loops:
                lp[uvl].uv = (seam(lp.vert.co, lp.vert.normal), 0.0)
    # --- panel thickness on every open edge except the centre plane
    edges = [e for e in bm.edges if len(e.link_faces) == 1 and not all(abs(v.co.z) < 1e-4 for v in e.verts)]
    extrude_rim(bm, edges, 0.022, L.MATS['paint_in']['index'])
    return [body, glass, trim, pan, roofR, roofpanel]


# ------------------------------------------------------------------ scene / render
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24 if FAST else 64
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'Medium High Contrast'
    sc.view_settings.exposure = -2.3
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
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
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.08, 0.085, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    g.data.materials.append(m)


def render(views, outdir):
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for name, eye, tgt, lens in views:
        e, t = L.G2B @ Vector(eye), L.G2B @ Vector(tgt)
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        cam.data.clip_start = 0.02
        sc.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)


VIEWS = {
    'f34': ((4.3, 1.55, 3.0), (0.3, 0.6, 0), 45),
    'r34': ((-4.9, 1.25, 2.9), (-0.3, 0.65, 0), 45),
    'side': ((0.6, 0.75, 9.5), (-0.2, 0.62, 0), 70),
    'front': ((7.0, 0.75, 0.0), (0, 0.62, 0), 70),
    'rear': ((-7.0, 0.85, 0.0), (0, 0.62, 0), 70),
    'top': ((-0.2, 9.0, 0.01), (-0.2, 0, 0), 70),
    'cabin': ((-0.42, 1.13, 0.345), (1.5, 0.78, 0.2), 16),
    'dash': ((-0.25, 1.08, 0.05), (0.6, 0.86, 0.2), 24),
    'seats': ((0.35, 1.25, -0.05), (-0.6, 0.6, 0.1), 20),
    'wheel': ((1.9, 0.5, 2.2), (1.2, 0.34, 0.7), 60),
    'nose': ((3.2, 0.75, 1.3), (1.9, 0.58, 0.25), 60),
    'tail': ((-3.7, 0.9, 1.4), (-2.2, 0.62, 0.2), 60),
}


def main():
    setup_scene()
    parts = build_body() + X.build_exterior(FAST) + I.build_interior(FAST) + I.build_gadgets(FAST)
    wheel, blur = X.build_wheel(FAST)
    by = {p.name: p for p in parts}
    # the headlining over the passenger leaves with the roof panel
    sym = by['int_sym']
    ins, _ = cut_field(sym.bm, [f for f in sym.bm.faces if f.material_index == L.MATS['headlining']['index']], f_roofpanel)
    L.split_asym(sym.bm, ins, by['roofR'], by['roofpanel'], L.MATS['headlining']['index'])
    ex = opt('--export')
    if ex:
        L.export(parts + [wheel, blur], ex)
    out = opt('--render')
    if out:
        hide = (opt('--hide') or 'guns,shield,slasher').split(',')
        for p in parts:
            if p.target in hide or p.name in hide:
                continue
            if p.target == 'steer':
                ob = L.to_object(p)
                ob.matrix_world = L.G2B @ Matrix.Translation((0.19, 0.815, I.DRV_Z)) @ Matrix.Rotation(math.radians(160), 4, 'Z')
                continue
            L.to_object(p)
        for i, (ax, sz) in enumerate(((S.AXF, 1), (S.AXF, -1), (S.AXR, 1), (S.AXR, -1))):
            ob = L.to_object(wheel, 'wheel%d' % i)
            ob.matrix_world = L.G2B @ Matrix.Translation((ax, S.WHEEL_R, sz * S.HUB_Z)) @ (Matrix.Identity(4) if sz > 0 else Matrix.Rotation(math.pi, 4, 'Y'))
        names = (opt('--views') or 'f34,r34,side').split(',')
        render([(n, *VIEWS[n]) for n in names], out)


main()
