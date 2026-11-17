# Converts the openx-assets vehicles (vevalabs/openx-assets, glTF release bundle) into the game's compact mesh format.
#   blender -b -P oxa_build.py -- --src DIR_WITH_vehicles/ --out ../js/28_oxa_data.js [--only name,name] [--tris 6000]
# Each car: body (paint, trim, lamps, plates, mirrors), glass, one wheel (wheel frame: axle Z, outer face +Z) and the
# metadata the game needs (axles, track, wheel radius, mass, size, paint colour, credits). Licences: the models are
# MPL-2.0 AND CC-BY-4.0 (see the credits written into the data file).
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda k, d=None: ARGS[ARGS.index(k) + 1] if k in ARGS else d
SRC = opt('--src')
OUT = opt('--out')
ONLY = set((opt('--only') or '').split(',')) - {''}
TRIS = int(opt('--tris', 6000))          # target for the whole body (wheels are reduced separately)

# glTF (Blender) frame: X forward, Y left, Z up  ->  game frame: X forward, Y up, Z right
B2G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def classify(mat_name, base):
    """(material id, variant, colour, target) for the game, from the asset's semantic material names."""
    n = (mat_name or '').lower()
    r, g, b = base
    if 'glass' in n and 'mirror' not in n:
        return 0, 0, (0.86, 0.92, 0.90), 'glass'
    if n == 'body' or n.startswith('body') or 'paint' in n:
        return 20, 0, (1.0, 1.0, 1.0), 'body'
    if 'chrome' in n or 'mirror' in n:
        return 7, 0, (0.92, 0.92, 0.94), 'body'
    if 'rim' in n or 'alloy' in n or 'wheel' in n:
        return 7, 1, (0.80, 0.80, 0.82), 'body'
    if 'tire' in n or 'tyre' in n or 'rubber' in n:
        return 21, 0, (0.02, 0.02, 0.021), 'body'
    if 'lens_red' in n or 'lamp_red' in n:
        return 22, 1, (0.6, 0.02, 0.015), 'body'
    if 'reflector_red' in n:
        return 22, 3, (0.45, 0.02, 0.015), 'body'
    if 'amber' in n or 'orange' in n:
        return 22, 2, (0.75, 0.33, 0.03), 'body'
    if 'lens' in n or 'lamp' in n or 'light' in n:
        return 22, 0, (0.9, 0.9, 0.88), 'body'
    if 'reflector' in n:
        return 23, 0, (0.9, 0.9, 0.92), 'body'
    if 'license' in n or 'plate' in n:
        return 2, 0, (max(r, 0.02), max(g, 0.02), max(b, 0.02)), 'body'
    if 'interior' in n or 'seat' in n or 'dash' in n or 'leather' in n:
        return 26, 0, (max(r, 0.02), max(g, 0.02), max(b, 0.02)), 'body'
    return 2, 0, (max(r, 0.015), max(g, 0.015), max(b, 0.015)), 'body'


def base_colour(m):
    try:
        if m.use_nodes:
            for nd in m.node_tree.nodes:
                if nd.type == 'BSDF_PRINCIPLED':
                    c = nd.inputs['Base Color'].default_value
                    return (c[0], c[1], c[2])
        c = m.diffuse_color
        return (c[0], c[1], c[2])
    except Exception:
        return (0.3, 0.3, 0.3)


def ancestors(o):
    while o is not None:
        yield o.name
        o = o.parent


def mesh_data(o, M):
    """World-space (game frame) triangles of object o: arrays of positions, loop normals, material slot per triangle."""
    dg = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    me.calc_loop_triangles()
    try:
        me.calc_normals_split()
    except Exception:
        pass
    co = np.array([M @ (oe.matrix_world @ v.co) for v in me.vertices], dtype=np.float64).reshape(-1, 3)
    rot = (M @ oe.matrix_world).to_3x3().inverted().transposed()
    tris, nrm, mats = [], [], []
    for t in me.loop_triangles:
        tris.append(t.vertices[:])
        nrm.append([tuple((rot @ Vector(me.loops[li].normal)).normalized()) for li in t.loops])
        mats.append(t.material_index)
    slots = [(s.material.name if s.material else '', base_colour(s.material) if s.material else (0.3, 0.3, 0.3)) for s in o.material_slots]
    oe.to_mesh_clear()
    return co, np.array(tris, dtype=np.int64).reshape(-1, 3), np.array(nrm, dtype=np.float64).reshape(-1, 3, 3), np.array(mats, dtype=np.int64), slots


def decimate(o, ratio):
    if ratio >= 0.999:
        return
    md = o.modifiers.new('dec', 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = max(ratio, 0.05)
    md.use_collapse_triangulate = True


def convert(path, xoma):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meta = json.load(open(xoma))['metadata']
    vcd = meta.get('vehicleClassData', {})
    ax = vcd.get('axles', {})
    fa, ra = ax.get('frontAxle', {}), ax.get('rearAxle', {})
    # centre the car on the middle of the wheelbase, on the ground (the game's car frame)
    xm = (fa.get('positionX', 1.3) + ra.get('positionX', -1.3)) / 2
    M = B2G @ Matrix.Translation((-xm, 0, 0))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    wheels = [o for o in meshes if any(a.startswith('Grp_Wheel') or a.startswith('Wheel_') for a in ancestors(o))]
    inner = [o for o in meshes if any(a.startswith('Grp_Interior') for a in ancestors(o))]
    body = [o for o in meshes if o not in wheels]
    # decimate the body to the target size (interior gets a harder cut)
    nb = sum(len(o.data.polygons) for o in body) or 1
    for o in body:
        decimate(o, (TRIS / nb) * (0.5 if o in inner else 1.0))
    # one wheel: the front right one (game z > 0, outer face +Z)
    wsel = None
    for o in wheels:
        c = M @ o.matrix_world.translation
        if c.x > 0 and c.z > 0 and (wsel is None or len(o.data.polygons) > len(wsel.data.polygons)):
            wsel = o
    wsel = wsel or (wheels[0] if wheels else None)
    parts = []
    for o in body:
        parts.append(('body', mesh_data(o, M)))
    hub = None
    if wsel is not None:
        decimate(wsel, 900 / max(len(wsel.data.polygons), 1))
        co, tr, nr, mi, slots = mesh_data(wsel, M)
        hub = co.mean(axis=0)
        lo, hi = co.min(axis=0), co.max(axis=0)
        hub = (lo + hi) / 2
        co = co - hub
        if co[:, 2].mean() < 0:                 # outer face must be +Z
            co[:, 2] *= -1
            nr[:, :, 2] *= -1
            tr = tr[:, ::-1]
            nr = nr[:, ::-1]
        parts.append(('wheel', (co, tr, nr, mi, slots)))
    wr = fa.get('wheelDiameter', 0.62) / 2
    car = dict(
        name=meta.get('name', os.path.basename(path)), id=os.path.basename(path)[:-4],
        category=vcd.get('vehicleCategory', 'car'), mass=vcd.get('mass', 1400),
        size=[round(2 * meta['boundingBox']['x'][1], 3), round(meta['boundingBox']['z'][1], 3), round(2 * meta['boundingBox']['y'][1], 3)],
        wheelbase=round(fa.get('positionX', 1.3) - ra.get('positionX', -1.3), 4), wheelR=round(wr, 4),
        hubs=[[round(fa.get('positionX', 1.3) - xm, 4), round(fa.get('positionZ', wr), 4), round(s * fa.get('trackWidth', 1.5) / 2, 4)] for s in (-1, 1)] +
             [[round(ra.get('positionX', -1.3) - xm, 4), round(ra.get('positionZ', wr), 4), round(s * ra.get('trackWidth', 1.5) / 2, 4)] for s in (-1, 1)],
        maxSteer=fa.get('maxSteering', 0.6), perf=vcd.get('performance', {}),
        credits=meta.get('copyrights', []), license=meta.get('license', 'MPL-2.0 AND CC-BY-4.0'))
    # paint colour from the asset's own body material
    for o in body:
        for s in o.material_slots:
            if s.material and s.material.name.lower().startswith('body') and 'glass' not in s.material.name.lower():
                car['paint'] = [round(c, 4) for c in base_colour(s.material)]
                break
        if 'paint' in car:
            break
    car.setdefault('paint', [0.4, 0.4, 0.42])
    return car, parts


def pack(car, parts):
    """Chunks in the DB5/V8 binary layout (positions int16 * 8000, normals int8, indices u16/u32), one blob per car."""
    import zlib
    SCALE = 8000.0
    blob = bytearray()
    chunks = []

    def pad():
        while len(blob) % 4:
            blob.append(0)
    groups = {}
    for target, (co, tr, nr, mi, slots) in parts:
        for m in sorted(set(mi.tolist())):
            name, col = slots[m] if m < len(slots) else ('', (0.3, 0.3, 0.3))
            mid, a, c, tgt = classify(name, col)
            t = target if tgt != 'glass' else ('glass' if target == 'body' else target + '_glass')
            key = (t, mid, a, tuple(round(x, 3) for x in c))
            g = groups.setdefault(key, ([], [], []))
            sel = np.nonzero(mi == m)[0]
            g[0].append(co)
            g[1].append(tr[sel])
            g[2].append(nr[sel])
    for (t, mid, a, c), (cos, trs, nrs) in groups.items():
        vmap, pos, nrm, idx = {}, [], [], []
        for co, tr, nr in zip(cos, trs, nrs):
            base = {}
            for ti in range(len(tr)):
                for k in range(3):
                    vi = int(tr[ti, k])
                    n = nr[ti, k]
                    q = (id(co), vi, int(round(n[0] * 127)), int(round(n[1] * 127)), int(round(n[2] * 127)))
                    j = vmap.get(q)
                    if j is None:
                        j = vmap[q] = len(pos)
                        pos.append(co[vi])
                        nrm.append(q[2:])
                    idx.append(j)
        if not idx:
            continue
        nv, ni = len(pos), len(idx)
        p16 = np.clip(np.round(np.array(pos) * SCALE), -32767, 32767).astype('<i2')
        n8 = np.zeros((nv, 4), dtype=np.int8)
        n8[:, :3] = np.clip(np.array(nrm), -127, 127).astype(np.int8)
        blob.extend(p16.tobytes()); pad()
        blob.extend(n8.tobytes())
        i32 = nv > 65535
        blob.extend(np.array(idx, dtype='<u4' if i32 else '<u2').tobytes()); pad()
        chunks.append(dict(t=t, m=0, id=mid, a=a, c=[round(x, 4) for x in c], nv=nv, ni=ni, uv=0, i32=1 if i32 else 0))
    z = zlib.compress(bytes(blob), 9)
    return dict(scale=SCALE, car=car, targets={}, chunks=chunks), z


def main():
    import base64
    vdir = os.path.join(SRC, 'vehicles') if os.path.isdir(os.path.join(SRC, 'vehicles')) else SRC
    names = sorted(d for d in os.listdir(vdir) if os.path.isfile(os.path.join(vdir, d, d + '.glb')))
    if ONLY:
        names = [n for n in names if n in ONLY]
    cars, total = [], 0
    for n in names:
        car, parts = convert(os.path.join(vdir, n, n + '.glb'), os.path.join(vdir, n, n + '.xoma'))
        meta, z = pack(car, parts)
        tt = sum(c['ni'] for c in meta['chunks']) // 3
        b64 = base64.b64encode(z).decode()
        total += len(b64)
        print('car %-30s %6d tris %5.0f KB' % (n, tt, len(b64) / 1024))
        cars.append((meta, b64))
    with open(OUT, 'w') as f:
        f.write('// openx-assets vehicles (https://github.com/vevalabs/openx-assets), converted by source/blender/oxa_build.py.\n')
        f.write('// Licence of this file: MPL-2.0 AND CC-BY-4.0, like the models it is made from. Do not edit by hand.\n')
        f.write('// Model credits: (c) Dogan Ulus <dogan.ulus@bogazici.edu.tr> and the Sketchfab authors listed in each car\'s meta.car.credits.\n')
        f.write('const OXA_CARS = [\n')
        for meta, b64 in cars:
            f.write('{meta:' + json.dumps(meta, separators=(',', ':')) + ',b64:"' + b64 + '"},\n')
        f.write('];\n')
    print('oxa: %d cars, %.0f KB' % (len(cars), total / 1024))


main()
