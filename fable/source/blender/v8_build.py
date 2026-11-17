# Builds the Aston Martin V8 Vantage (1987) in Blender (headless) and exports it for the game.
#   blender -b -P v8_build.py -- [--render DIR] [--export FILE.js] [--fast]
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
import v8_shape as S
import v8_parts as X
import v8_interior as I
from db5_lib import Part, cut_field, extrude_rim, material, move_faces, rrect

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d=None: ARGS[ARGS.index(k) + 1] if k in ARGS else d
FAST = '--fast' in ARGS

# ------------------------------------------------------------------ materials
# (game material id, variant) + preview look for the Blender renders
PAINT = (0.060, 0.068, 0.070)      # Cumberland Grey: dark grey-green metallic
material('paint', 20, 0, (1, 1, 1), (PAINT, 0.9, 0.25, dict(coat=1.0)))
material('paint_in', 20, 1, (1, 1, 1), ((0.05, 0.05, 0.05), 0.2, 0.7))        # panel edges / inner lips
material('chrome', 7, 0, (0.95, 0.95, 0.96), ((0.9, 0.9, 0.92), 1.0, 0.06))
material('chrome_satin', 7, 1, (0.8, 0.8, 0.82), ((0.8, 0.8, 0.82), 1.0, 0.25))
material('rubber', 3, 0, (0.02, 0.02, 0.02), ((0.02, 0.02, 0.02), 0.0, 0.8))
material('under', 13, 0, (0.006, 0.006, 0.007), ((0.01, 0.01, 0.01), 0.0, 1.0))
material('black', 2, 0, (0.02, 0.02, 0.021), ((0.02, 0.02, 0.02), 0.0, 0.6))
material('tire', 21, 0, (0.02, 0.02, 0.021), ((0.012, 0.012, 0.012), 0.0, 0.75))
material('spoke', 7, 2, (0.85, 0.85, 0.87), ((0.85, 0.85, 0.87), 1.0, 0.15))
material('wheelblur', 27, 0, (0.7, 0.7, 0.72), ((0.7, 0.7, 0.72), 1.0, 0.3), target='skip')
material('reflector', 23, 0, (0.9, 0.9, 0.92), ((0.95, 0.95, 0.95), 1.0, 0.28))
material('lens_clear', 22, 0, (0.9, 0.9, 0.88), ((0.9, 0.9, 0.88), 0.0, 0.05, dict(glass=1)))
material('lens_amber', 22, 2, (0.75, 0.33, 0.03), ((0.8, 0.3, 0.02), 0.0, 0.15))
material('lens_red', 22, 1, (0.6, 0.02, 0.015), ((0.5, 0.01, 0.01), 0.0, 0.15))
material('lens_reflex', 22, 3, (0.45, 0.02, 0.015), ((0.35, 0.01, 0.01), 0.0, 0.3))
material('lens_white', 22, 4, (0.85, 0.85, 0.82), ((0.85, 0.85, 0.82), 0.0, 0.15))
material('mirror', 7, 0, (0.62, 0.64, 0.67), ((0.9, 0.9, 0.9), 1.0, 0.02))
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
material('horn', 25, 6, (0.02, 0.07, 0.30), ((0.02, 0.07, 0.30), 0.0, 0.2, dict(coat=1.0)))
material('dash', 26, 0, (0.02, 0.02, 0.021), ((0.02, 0.02, 0.021), 0.0, 0.35))
material('wood', 26, 1, (0.42, 0.22, 0.09), ((0.42, 0.22, 0.09), 0.0, 0.25, dict(coat=1.0)))
material('alloy', 7, 1, (0.8, 0.8, 0.82), ((0.8, 0.8, 0.82), 1.0, 0.3))
material('steel', 6, 0, (0.42, 0.42, 0.44), ((0.42, 0.42, 0.44), 1.0, 0.35))
material('armour', 6, 0, (0.25, 0.26, 0.27), ((0.25, 0.26, 0.27), 0.9, 0.45))
material('decal_plate', 12, 0, (1, 1, 1), ((0.02, 0.02, 0.02), 0.0, 0.5))
material('decal_badge', 12, 1, (1, 1, 1), ((0.8, 0.8, 0.8), 1.0, 0.2))
material('decal_dials', 12, 2, (1, 1, 1), ((0.03, 0.03, 0.03), 0.0, 0.3))
material('decal_radar', 12, 3, (1, 1, 1), ((0.1, 0.3, 0.1), 0.0, 0.3, dict(emit=1.0)))
material('decal_panel', 12, 4, (1, 1, 1), ((0.05, 0.05, 0.05), 0.0, 0.4))
material('glass', 0, 0, (0.86, 0.92, 0.90), ((0.9, 0.95, 0.93), 0.0, 0.0, dict(glass=1)), target='glass')
material('glass_lamp', 2, 0, (0.95, 0.96, 0.96), ((1, 1, 1), 0.0, 0.0, dict(glass=1)), target='glass')

from v8_fields import *       # measured outlines: windows, arches, nose openings, shut lines
material('mesh', 2, 1, (0.03, 0.03, 0.032), ((0.03, 0.03, 0.032), 0.6, 0.45))


def build_body():
    nu, nv = (120, 80) if FAST else (230, 110)
    P, xs = S.body_grid(nu, nv)
    body = Part('body', mirror=True).mat('paint')
    glass = Part('glass', mirror=True, target='glass').mat('glass')
    trim = Part('trim', mirror=True)
    bm = body.bm
    vs = [[bm.verts.new(P[i, j]) for j in range(nv)] for i in range(nu)]
    PI = L.MATS['paint']['index']
    for i in range(nu - 1):
        for j in range(nv - 1):
            q = [vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]]
            if len(set(tuple(round(c, 6) for c in v.co) for v in q)) < 3:
                continue
            f = bm.faces.new(q)
            f.smooth = True
            f.material_index = PI
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces if f.calc_center_median().z > 0.6) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.normal_update()

    cen = lambda f: f.calc_center_median()
    side = lambda f: f.normal.z > 0.3
    # --- belly: unpainted underside between the valances; open wheel wells
    ins, _ = cut_field(bm, [f for f in bm.faces if f.normal.y < -0.5 and cen(f).y < 0.5], f_well)
    bmesh.ops.delete(bm, geom=ins, context='FACES')
    for f in bm.faces:
        c = cen(f)
        if f.normal.y < -0.5 and c.y < float(S.Y_BOT(c.x)) + 0.02 and -1.72 < c.x < 1.60:
            f.material_index = L.MATS['under']['index']
    # --- wheel arches
    ins, _ = cut_field(bm, [f for f in bm.faces if side(f) and cen(f).y < 0.80 and f.material_index == PI], f_arch)
    bmesh.ops.delete(bm, geom=ins, context='FACES')

    def window(field, sel, rings, glass_mat='glass', sink=0.004):
        """Cut an opening: concentric trim rings [(width, material, lift)], then the pane, which moves to the glass part."""
        faces = [f for f in bm.faces if sel(f)]
        off = sum(r[0] for r in rings)
        for wdt, mat, lift in rings:
            ring, _ = cut_field(bm, faces, lambda p: field(p) - off)
            off -= wdt
            faces, ring = cut_field(bm, ring, lambda p: field(p) - off)
            trim.mat(mat)
            move_faces(bm, [f for f in ring if f.is_valid], trim, lift)
        if not rings:
            faces, _ = cut_field(bm, faces, field)
        if glass_mat:
            glass.mat(glass_mat)
            move_faces(bm, [f for f in faces if f.is_valid], glass, -sink)
        else:
            bmesh.ops.delete(bm, geom=[f for f in faces if f.is_valid], context='FACES')

    paint = lambda f: f.material_index == PI
    # --- side glass with bright frames, the front frame bar and the B post; windscreen and rear window in chrome + rubber
    window(lambda p: max(f_side(p), -f_bar(p), -f_bpost(p)), lambda f: paint(f) and side(f) and cen(f).y > B - 0.02 and -1.3 < cen(f).x < 0.3,
           [(0.012, 'chrome', 0.004)])
    window(f_windscreen, lambda f: paint(f) and f.normal.x > 0.25 and cen(f).y > 0.9 and -0.25 < cen(f).x < 0.62,
           [(0.010, 'chrome', 0.004), (0.010, 'rubber', 0.002)])
    window(f_backlight, lambda f: paint(f) and f.normal.y > 0.2 and cen(f).y > 0.95 and -1.9 < cen(f).x < -1.0,
           [(0.010, 'chrome', 0.004), (0.010, 'rubber', 0.002)])
    # --- nose: grille mouth and headlamp bezels (openings; lamps, mesh and rims are built in v8_parts); air-dam intakes
    nose = lambda f: paint(f) and cen(f).x > 1.95 and f.normal.x > 0.3
    window(f_grille, nose, [(0.008, 'rubber', 0.002)], glass_mat=None)
    window(f_head, nose, [], glass_mat=None)
    window(f_intake, nose, [(0.006, 'rubber', 0.002)], glass_mat=None)
    # --- tail lamp recesses
    window(f_tail, lambda f: paint(f) and cen(f).x < -2.1 and f.normal.x < -0.3, [(0.006, 'chrome', 0.002)], glass_mat=None)
    # --- side strakes
    window(f_vent, lambda f: paint(f) and side(f) and 0.4 < cen(f).x < 1.05, [(0.007, 'chrome', 0.003)], glass_mat=None)
    # --- power bulge: its blanked-off mouth, black sill finishers
    bm.normal_update()
    for fc in bm.faces:
        c = cen(fc)
        if fc.material_index != PI:
            continue
        if fc.normal.x > 0.45 and abs(c.z) < float(S.BULGE_W(S.BULGE_X)) + 0.01 and S.BULGE_X - 0.03 < c.x < S.BULGE_X + 0.02 and c.y > 0.82:
            fc.material_index = L.MATS['black']['index']
        if fc.normal.z > 0.2 and c.y < 0.268 and -0.93 < c.x < 0.91:
            fc.material_index = L.MATS['rubber']['index']
    # --- shut lines: signed distance to the nearest panel gap goes in uv.x (drawn by the paint shader)
    for part in (body,):
        part.bm.normal_update()
        uvl = part.uv
        for fc in part.bm.faces:
            if fc.material_index != PI:
                continue
            for lp in fc.loops:
                lp[uvl].uv = (seam(lp.vert.co, lp.vert.normal), 1.0)
    # --- panel thickness on every open edge except the centre plane
    edges = [e for e in bm.edges if len(e.link_faces) == 1 and not all(abs(v.co.z) < 1e-4 for v in e.verts)]
    extrude_rim(bm, edges, 0.022, L.MATS['paint_in']['index'])
    return [body, glass, trim]


# ------------------------------------------------------------------ scene / render
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(opt('--samples', 24 if FAST else 64))
    try:
        sc.cycles.use_denoising = bool(bpy.app.build_options.openimagedenoise)
    except Exception:
        sc.cycles.use_denoising = False
    w, h = (opt('--res') or '960x540').split('x')
    sc.render.resolution_x, sc.render.resolution_y = int(w), int(h)
    sc.render.film_transparent = '--transparent' in ARGS
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    sc.view_settings.exposure = float(opt('--exposure', -3.0))
    wd = bpy.data.worlds.new('w')
    sc.world = wd
    wd.use_nodes = True
    nt = wd.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(float(opt('--sun-el', 42)))
    sky.sun_rotation = math.radians(float(opt('--sun-az', 215)))
    sky.ozone_density = 2.0
    nt.nodes['Background'].inputs['Strength'].default_value = 0.25
    nt.links.new(sky.outputs[0], nt.nodes['Background'].inputs[0])
    bpy.ops.mesh.primitive_plane_add(size=120)
    g = bpy.context.object
    g.is_shadow_catcher = '--transparent' in ARGS
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.32, 0.33, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.55
    g.data.materials.append(m)
    if '--studio' in ARGS:
        # photographic studio: dark surround, long softboxes overhead and at the sides (their reflections show the form)
        nt.nodes['Background'].inputs['Strength'].default_value = 0.0
        nt.links.remove(nt.nodes['Background'].inputs[0].links[0])
        nt.nodes['Background'].inputs[0].default_value = (0.02, 0.02, 0.022, 1)
        nt.nodes['Background'].inputs['Strength'].default_value = 1.0
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.20, 0.20, 0.205, 1)
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.32

        def box(name, loc, rot, sx, sy, strength):
            ld = bpy.data.lights.new(name, 'AREA')
            ld.shape = 'RECTANGLE'
            ld.size, ld.size_y = sx, sy
            ld.energy = strength
            ob = bpy.data.objects.new(name, ld)
            ob.location = loc
            ob.rotation_euler = rot
            sc.collection.objects.link(ob)
        box('top', (-0.2, 0.0, 4.2), (0, 0, 0), 9.0, 2.2, 1100)
        box('topL', (-0.2, 3.4, 3.4), (math.radians(-38), 0, 0), 9.0, 1.4, 620)
        box('topR', (-0.2, -3.4, 3.4), (math.radians(38), 0, 0), 9.0, 1.4, 620)
        box('front', (6.5, 0.0, 2.2), (0, math.radians(62), 0), 2.0, 6.0, 300)
        box('rear', (-7.0, 0.0, 2.2), (0, math.radians(-62), 0), 2.0, 6.0, 300)
        sc.view_settings.exposure = float(opt('--exposure', 0.4))


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
        if '--ortho' in ARGS and name in ('side', 'front', 'rear', 'top'):
            # orthographic, at the scale of the reference drawing (2.5613 mm per pixel), for overlays
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = sc.render.resolution_x * 2.610 / 1019.0
        else:
            cam.data.type = 'PERSP'
        cam.data.clip_start = 0.02
        sc.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)


VIEWS = {
    'f34': ((5.6, 1.5, 3.9), (-0.1, 0.60, 0), 50),
    'r34': ((-5.6, 1.35, 3.3), (-0.3, 0.62, 0), 50),
    'side': ((-0.1, 0.66, 14.0), (-0.1, 0.66, 0), 85),
    'front': ((11.0, 0.66, 0.0), (0, 0.66, 0), 85),
    'rear': ((-11.0, 0.66, 0.0), (0, 0.66, 0), 85),
    'top': ((-0.1, 14.0, 0.01), (-0.1, 0, 0), 85),
    'high': ((4.9, 3.2, 2.9), (0.2, 0.5, 0), 50),
    'low': ((4.6, 0.75, 4.6), (0.0, 0.62, 0), 55),
    'rlow': ((-5.9, 0.95, 2.8), (-0.4, 0.6, 0), 55),
    'cabin': ((-0.60, 1.12, 0.36), (1.5, 0.82, 0.25), 16),
    'dash': ((-0.72, 1.04, -0.05), (0.25, 0.80, 0.12), 20),
    'wheel': ((2.1, 0.5, 2.4), (1.30, 0.35, 0.75), 60),
    'icon': ((5.9, 1.7, 4.4), (-0.15, 0.55, 0.0), 50),
    'nose': ((3.8, 0.85, 1.45), (1.95, 0.60, 0.25), 60),
    'tail': ((-4.2, 0.95, 1.5), (-2.25, 0.62, 0.2), 60),
}


def main():
    setup_scene()
    stage = opt('--stage', 'all')
    parts = build_body()
    if stage != 'body':
        parts += X.build_exterior(FAST)
    if stage == 'all':
        parts += I.build_interior(FAST) + I.build_gadgets(FAST)
    wheel, blur = X.build_wheel(FAST)
    by = {p.name: p for p in parts}
    ex = opt('--export')
    if ex:
        car = dict(wheelbase=round(S.AXF - S.AXR, 4), wheelR=S.WHEEL_R,
                   hubs=[[S.AXF, S.WHEEL_R, -S.HUB_ZF], [S.AXF, S.WHEEL_R, S.HUB_ZF], [S.AXR, S.WHEEL_R, -S.HUB_ZR], [S.AXR, S.WHEEL_R, S.HUB_ZR]],
                   steer=dict(pos=list(I.STEER_POS), tilt=I.STEER_TILT), eye=list(I.EYE), bonnetCam=[0.66, 1.08, 0.0],
                   half=dict(w=0.905, front=2.212, rear=2.392), paint=list(PAINT))
        L.export(parts + [wheel, blur], ex, car, prefix='V8', title='Aston Martin V8 Vantage', script='v8_build.py')
    out = opt('--render')
    if out:
        hide = (opt('--hide') or 'missile,laser,ski,spikes,rocket,flame,hud,wheelblur').split(',')
        for p in parts:
            if p.target in hide or p.name in hide:
                continue
            if p.target == 'steer':
                ob = L.to_object(p)
                ob.matrix_world = L.G2B @ Matrix.Translation(I.STEER_POS) @ Matrix.Rotation(math.radians(I.STEER_TILT), 4, 'Z')
                continue
            L.to_object(p)
        for i, (ax, sz) in enumerate(((S.AXF, 1), (S.AXF, -1), (S.AXR, 1), (S.AXR, -1))):
            ob = L.to_object(wheel, 'wheel%d' % i)
            hz = S.HUB_ZF if ax > 0 else S.HUB_ZR
            ob.matrix_world = L.G2B @ Matrix.Translation((ax, S.WHEEL_R, sz * hz)) @ (Matrix.Identity(4) if sz > 0 else Matrix.Rotation(math.pi, 4, 'Y'))
        names = (opt('--views') or 'f34,r34,side').split(',')
        render([(n, *VIEWS[n]) for n in names], out)


main()
