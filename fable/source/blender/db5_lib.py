# Small modelling toolkit on top of Blender's bmesh, working in the game's car frame
# (X forward, Y up, Z right; metres). Used by db5_build.py.
import math
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# game (x, y, z) -> Blender (x, -z, y): a pure rotation, so winding is preserved
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# name -> dict(id, a, col, target, preview=(rgb, metallic, roughness[, extra]))
MATS = {}
MAT_ORDER = []


def material(name, mid, a, col, preview, target='body'):
    MATS[name] = dict(id=mid, a=a, col=col, target=target, preview=preview, index=len(MAT_ORDER))
    MAT_ORDER.append(name)


class Part:
    """A bmesh plus a current material and transform stack."""

    def __init__(self, name, mirror=False, target='body'):
        self.name, self.mirror, self.target = name, mirror, target
        self.pivot = None
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('uv')
        self.mi = 0
        self.xf = Matrix.Identity(4)
        self.stack = []

    def mat(self, name):
        self.mi = MATS[name]['index']
        return self

    def push(self, m):
        self.stack.append(self.xf)
        self.xf = self.xf @ m
        return self

    def pop(self):
        self.xf = self.stack.pop()
        return self

    def _finish(self, geom, smooth=True):
        verts = [g for g in geom if isinstance(g, bmesh.types.BMVert)]
        faces = set()
        for v in verts:
            v.co = self.xf @ v.co
            faces.update(v.link_faces)
        flip = self.xf.determinant() < 0
        for f in faces:
            f.material_index = self.mi
            f.smooth = smooth
            if flip:
                f.normal_flip()
        return verts, list(faces)

    # ---- primitives -------------------------------------------------------------------------
    def box(self, c, size, bevel=0.0, seg=2, smooth=True):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = r['verts']
        for v in verts:
            v.co = Vector((c[0] + v.co.x * size[0], c[1] + v.co.y * size[1], c[2] + v.co.z * size[2]))
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            b = bmesh.ops.bevel(self.bm, geom=edges, offset=min(bevel, min(size) * 0.49), segments=seg, profile=0.5, affect='EDGES')
            verts = list({v for f in b['faces'] for v in f.verts} | {v for v in verts if v.is_valid})
            # include untouched original faces
            vs = set(verts)
            for v in list(vs):
                for f in v.link_faces:
                    vs.update(f.verts)
            verts = list(vs)
        return self._finish(verts, smooth)

    def cyl(self, p0, p1, r0, r1=None, seg=16, cap0=True, cap1=True, smooth=True):
        """Cylinder/cone from p0 (radius r0) to p1 (radius r1)."""
        r1 = r0 if r1 is None else r1
        p0, p1 = Vector(p0), Vector(p1)
        ax = p1 - p0
        L = ax.length
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r0, radius2=max(r1, 1e-5), depth=L)
        verts = r['verts']
        q = Vector((0, 0, 1)).rotation_difference(ax.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((p0 + p1) / 2) @ q
        for v in verts:
            v.co = m @ v.co
        faces = list({f for v in verts for f in v.link_faces})
        for f in faces:
            if len(f.verts) > 4:       # caps
                cz = (m.inverted() @ f.calc_center_median()).z
                if (cz < 0 and not cap0) or (cz > 0 and not cap1):
                    bmesh.ops.delete(self.bm, geom=[f], context='FACES_ONLY')
                else:
                    f.smooth = False
        verts = [v for v in verts if v.is_valid]
        vs, fs = self._finish(verts, smooth)
        for f in fs:
            if len(f.verts) > 4:
                f.smooth = False
        return vs, fs

    def sphere(self, c, r, seg=16, rings=10, scale=(1, 1, 1)):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r)
        for v in res['verts']:
            v.co = Vector((c[0] + v.co.x * scale[0], c[1] + v.co.z * scale[1], c[2] + v.co.y * scale[2]))
        vs, fs = self._finish(res['verts'])
        for f in fs:               # axis swap mirrored the winding
            f.normal_flip()
        return vs, fs

    def grid(self, fn, nu, nv, flip=False, smooth=True, uvfn=None):
        """Parametric quad patch: fn(u, v) -> (x, y, z), u, v in [0, 1]."""
        vs = [[self.bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        faces = []
        for i in range(nu):
            for j in range(nv):
                q = [vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]]
                if flip:
                    q.reverse()
                f = self.bm.faces.new(q)
                faces.append(f)
                if uvfn:
                    for l in f.loops:
                        l[self.uv].uv = uvfn(l.vert.co)
        flat = [v for row in vs for v in row]
        self._finish(flat, smooth)
        return flat, faces

    def lathe(self, prof, seg=32, axis='x', origin=(0, 0, 0), smooth=True, flip=False):
        """Revolve profile [(a, r), ...] around an axis through origin; a runs along the axis."""
        def pt(a, r, t):
            c, s = math.cos(t) * r, math.sin(t) * r
            if axis == 'x':
                return (origin[0] + a, origin[1] + c, origin[2] + s)
            if axis == 'z':
                return (origin[0] + c, origin[1] + s, origin[2] + a)
            return (origin[0] + s, origin[1] + a, origin[2] + c)
        n = len(prof)
        rows = []
        for a, r in prof:
            if r < 1e-6:
                rows.append([self.bm.verts.new(pt(a, 0, 0))])
            else:
                rows.append([self.bm.verts.new(pt(a, r, k / seg * math.tau)) for k in range(seg)])
        for j in range(n - 1):
            A, B = rows[j], rows[j + 1]
            for k in range(seg):
                k2 = (k + 1) % seg
                a0, a1 = A[k % len(A)], A[k2 % len(A)]
                b0, b1 = B[k % len(B)], B[k2 % len(B)]
                q = [a0, b0, b1, a1]
                q = [v for i, v in enumerate(q) if v not in q[:i]]
                if len(q) < 3:
                    continue
                if flip:
                    q.reverse()
                try:
                    self.bm.faces.new(q)
                except ValueError:
                    pass
        flat = [v for row in rows for v in row]
        return self._finish(flat, smooth)

    def sweep(self, path, prof, closed=False, up=(0, 1, 0), smooth=True, caps=True):
        """Sweep closed 2D profile [(side, up), ...] along 3D path."""
        path = [Vector(p) for p in path]
        n, m = len(path), len(prof)
        upv = Vector(up)
        rings = []
        for i in range(n):
            a = path[(i - 1) % n] if closed else path[max(0, i - 1)]
            b = path[(i + 1) % n] if closed else path[min(n - 1, i + 1)]
            t = (b - a).normalized()
            s = t.cross(upv)
            if s.length < 1e-6:
                s = t.cross(Vector((1, 0, 0)))
            s.normalize()
            u = s.cross(t)
            rings.append([self.bm.verts.new(path[i] + s * p[0] + u * p[1]) for p in prof])
        cnt = n if closed else n - 1
        for i in range(cnt):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(m):
                k2 = (k + 1) % m
                self.bm.faces.new([A[k], A[k2], B[k2], B[k]])
        if caps and not closed and m >= 3:
            self.bm.faces.new(rings[0][::-1]).smooth = False
            self.bm.faces.new(rings[-1]).smooth = False
        flat = [v for r in rings for v in r]
        vs, fs = self._finish(flat, smooth)
        return vs, fs

    def tube(self, path, r, seg=8, closed=False, up=(0, 1, 0)):
        prof = [(math.cos(k / seg * math.tau) * r, math.sin(k / seg * math.tau) * r) for k in range(seg)]
        return self.sweep(path, prof, closed=closed, up=up)

    def quad(self, a, b, c, d, uv=None, smooth=False):
        vs = [self.bm.verts.new(p) for p in (a, b, c, d)]
        f = self.bm.faces.new(vs)
        if uv:
            for l, t in zip(f.loops, uv):
                l[self.uv].uv = t
        self._finish(vs, smooth)
        return f


class RasterField:
    """Signed distance (negative inside) to a 2D outline given as a polygon, with its corners rounded by radius r.

    The polygon is rasterised, opened with a disc of radius r (which rounds convex corners) and turned into a
    distance field with an exact Euclidean transform; queries interpolate bilinearly.
    """

    def __init__(self, poly, r=0.0, h=0.002, pad=0.15):
        from scipy import ndimage
        poly = np.asarray(poly, dtype=float)
        self.h = h
        self.u0, self.v0 = poly[:, 0].min() - pad, poly[:, 1].min() - pad
        nu = int((poly[:, 0].max() + pad - self.u0) / h) + 2
        nv = int((poly[:, 1].max() + pad - self.v0) / h) + 2
        U, V = np.meshgrid(self.u0 + np.arange(nu) * h, self.v0 + np.arange(nv) * h, indexing='ij')
        ins = np.zeros(U.shape, dtype=bool)
        n = len(poly)
        for i in range(n):
            (ua, va), (ub, vb) = poly[i], poly[(i + 1) % n]
            if va == vb:
                continue
            cond = (va > V) != (vb > V)
            xi = ua + (ub - ua) * (V - va) / (vb - va)
            ins ^= cond & (U < xi)
        if r > 0:
            core = ndimage.distance_transform_edt(ins) * h > r
            ins = ndimage.distance_transform_edt(~core) * h <= r
        self.sd = (ndimage.distance_transform_edt(~ins) - ndimage.distance_transform_edt(ins)) * h
        self.nu, self.nv = nu, nv

    def __call__(self, u, v):
        fu, fv = (u - self.u0) / self.h, (v - self.v0) / self.h
        if fu < 0 or fv < 0 or fu >= self.nu - 1 or fv >= self.nv - 1:
            return 1.0
        i, j = int(fu), int(fv)
        a, b = fu - i, fv - j
        g = self.sd
        return (g[i, j] * (1 - a) + g[i + 1, j] * a) * (1 - b) + (g[i, j + 1] * (1 - a) + g[i + 1, j + 1] * a) * b


def rrect(a, b, ha, hb, r):
    qa, qb = abs(a) - ha + r, abs(b) - hb + r
    return math.hypot(max(qa, 0), max(qb, 0)) + min(max(qa, qb), 0) - r


def cut_field(bm, faces, f, eps=1e-5):
    """Split `faces` along the zero level of f(Vector) and return (inside, outside) face lists (inside: f < 0)."""
    faces = [fc for fc in faces if fc.is_valid]
    val = {}
    for fc in faces:
        for v in fc.verts:
            if v not in val:
                val[v] = f(v.co)
    zero = {v for v, x in val.items() if abs(x) <= eps}
    edges = {e for fc in faces for e in fc.edges}
    for e in edges:
        a, b = e.verts
        if a in zero or b in zero:
            continue
        fa, fb = val[a], val[b]
        if (fa < 0) == (fb < 0):
            continue
        ta, tb, t = 0.0, 1.0, fa / (fa - fb)
        pa, pb = a.co.copy(), b.co.copy()
        for _ in range(8):
            ft = f(pa.lerp(pb, t))
            if abs(ft) < 1e-6:
                break
            if (ft < 0) == (fa < 0):
                ta, fa = t, ft
            else:
                tb, fb = t, ft
            t = ta + (tb - ta) * fa / (fa - fb)
        t = min(max(t, 0.02), 0.98)
        _, nv = bmesh.utils.edge_split(e, a, t)
        val[nv] = 0.0
        zero.add(nv)
    out = []
    for fc in faces:
        zs = [v for v in fc.verts if v in zero]
        if len(zs) == 2 and not any(zs[1] in e.verts for e in zs[0].link_edges):
            try:
                nf, _ = bmesh.utils.face_split(fc, zs[0], zs[1])
                if nf:
                    out.append(nf)
            except Exception:
                pass
        out.append(fc)
    inside, outside = [], []
    for fc in out:
        (inside if f(fc.calc_center_median()) < 0 else outside).append(fc)
    return inside, outside


def move_faces(src_bm, faces, dst, offset=0.0):
    """Copy faces into Part dst (optionally displaced along vertex normals) and delete them from src."""
    src_bm.normal_update()
    vm = {}
    for fc in faces:
        vs = []
        for v in fc.verts:
            if v not in vm:
                vm[v] = dst.bm.verts.new(v.co + v.normal * offset)
            vs.append(vm[v])
        nf = dst.bm.faces.new(vs)
        nf.material_index = dst.mi
        nf.smooth = True
    bmesh.ops.delete(src_bm, geom=faces, context='FACES')


def extrude_rim(bm, edges, depth, mat_index=None):
    """Extrude open edges inward (against vertex normals) to give panels a visible thickness."""
    bm.normal_update()
    edges = [e for e in edges if e.is_valid]
    nrm = {v: v.normal.copy() for e in edges for v in e.verts}
    r = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new_v = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
    new_f = [g for g in r['geom'] if isinstance(g, bmesh.types.BMFace)]
    # new verts are created in the order of the originals
    old = list({v: None for e in edges for v in e.verts}.keys())
    for nv in new_v:
        src = min((e.other_vert(nv) for e in nv.link_edges if e.other_vert(nv) in nrm), key=lambda o: (o.co - nv.co).length, default=None)
        if src is not None:
            nv.co = nv.co - nrm[src] * depth
    for fc in new_f:
        fc.smooth = False
        if mat_index is not None:
            fc.material_index = mat_index
    return new_f


def to_object(part, name=None):
    me = bpy.data.meshes.new(name or part.name)
    bm = part.bm
    if part.mirror:
        bm = part.bm.copy()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        d = bmesh.ops.duplicate(bm, geom=geom)
        nv = [g for g in d['geom'] if isinstance(g, bmesh.types.BMVert)]
        nf = [g for g in d['geom'] if isinstance(g, bmesh.types.BMFace)]
        for v in nv:
            v.co.z = -v.co.z
        for fc in nf:
            fc.normal_flip()
    bm.to_mesh(me)
    for n in MAT_ORDER:
        me.materials.append(preview_material(n))
    me.use_auto_smooth = True
    me.auto_smooth_angle = math.radians(38)
    ob = bpy.data.objects.new(me.name, me)
    ob.matrix_world = G2B
    bpy.context.scene.collection.objects.link(ob)
    return ob


_pm = {}


def preview_material(name):
    if name in _pm:
        return _pm[name]
    d = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    rgb, metal, rough = d['preview'][:3]
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    ex = d['preview'][3] if len(d['preview']) > 3 else {}
    if ex.get('coat'):
        b.inputs['Coat Weight'].default_value = ex['coat']
        b.inputs['Coat Roughness'].default_value = 0.05
    if ex.get('glass'):
        # thin sheet glass for the previews: see-through without refraction, with a Fresnel reflection on top
        nt = m.node_tree
        out = nt.nodes['Material Output']
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr.inputs['Color'].default_value = (*rgb, 1)
        gl = nt.nodes.new('ShaderNodeBsdfGlossy')
        gl.inputs['Roughness'].default_value = 0.0
        fr = nt.nodes.new('ShaderNodeFresnel')
        fr.inputs['IOR'].default_value = 1.5
        mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(fr.outputs[0], mx.inputs[0])
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(gl.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs['Surface'])
    if ex.get('emit'):
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = ex['emit']
    _pm[name] = m
    return m


def split_asym(bm, faces, static_part, moving_part, mat_index):
    """Take faces out of a mirrored half: keep them as a fixed piece on the right and as a moving piece on the left."""
    for part, sgn in ((static_part, 1), (moving_part, -1)):
        vm = {}
        for fc in faces:
            vs = []
            for v in fc.verts:
                if v not in vm:
                    vm[v] = part.bm.verts.new((v.co.x, v.co.y, v.co.z * sgn))
                vs.append(vm[v])
            if sgn < 0:
                vs.reverse()
            nf = part.bm.faces.new(vs)
            nf.material_index = mat_index
            nf.smooth = True
    bmesh.ops.delete(bm, geom=faces, context='FACES')


def export_blob(parts, car=None, scale=8000.0):
    """Pack parts into (meta, zlib bytes): the chunk layout shared by every Blender-made model in the game.
    Positions are int16 * scale (8000 per metre for the cars: +-4.1 m; buildings pass a smaller scale)."""
    import struct, zlib
    SCALE = float(scale)
    blob = bytearray()
    chunks, targets = [], {}

    def pad():
        while len(blob) % 4:
            blob.append(0)
    for part in parts:
        bm = part.bm.copy()
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new('x')
        bm.to_mesh(me)
        bm.free()
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(38)
        for p in me.polygons:
            p.use_smooth = True
        me.calc_normals_split()
        nl = len(me.loops)
        if nl == 0:
            continue
        vi = np.zeros(nl, dtype=np.int32)
        me.loops.foreach_get('vertex_index', vi)
        nr = np.zeros(nl * 3, dtype=np.float32)
        me.loops.foreach_get('normal', nr)
        nr = nr.reshape(-1, 3)
        co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        uv = np.zeros(nl * 2, dtype=np.float32)
        me.uv_layers[0].data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        mi = np.zeros(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get('material_index', mi)
        if part.pivot:
            targets[part.target] = dict(pivot=[round(float(c), 5) for c in part.pivot])
        for m in sorted(set(mi.tolist())):
            name = MAT_ORDER[m]
            d = MATS[name]
            target = part.target
            if d['target'] == 'glass':
                target = 'glass' if part.target in ('body', 'glass') else part.target + '_glass'
            elif d['target'] == 'skip':
                target = name
            has_uv = d['id'] in (12, 20)
            seam_uv = d['id'] == 20
            vmap, pos, nrm, uvs, idx = {}, [], [], [], []
            for pi in np.nonzero(mi == m)[0]:
                for li in range(pi * 3, pi * 3 + 3):
                    n = nr[li]
                    u0, u1 = float(uv[li, 0]), float(uv[li, 1])
                    if seam_uv:
                        u0, u1 = (u0 if u1 > 0.5 else 1.0), 0.0
                    q = (int(vi[li]), int(round(n[0] * 127)), int(round(n[1] * 127)), int(round(n[2] * 127)), round(u0, 4) if has_uv else 0, round(u1, 4) if has_uv else 0)
                    k = vmap.get(q)
                    if k is None:
                        k = vmap[q] = len(pos)
                        pos.append(co[q[0]])
                        nrm.append(q[1:4])
                        uvs.append(q[4:6])
                    idx.append(k)
            nv, ni = len(pos), len(idx)
            pa = np.array(pos)
            na = np.array(nrm, dtype=np.float64)
            if part.mirror:
                on = np.abs(pa[:, 2]) < 2e-4
                na[on, 2] = 0.0
                ln = np.linalg.norm(na[on], axis=1)
                na[on] = na[on] / np.maximum(ln, 1e-6)[:, None] * 127.0
            p16 = np.clip(np.round(pa * SCALE), -32767, 32767).astype('<i2')
            n8 = np.zeros((nv, 4), dtype=np.int8)
            n8[:, :3] = np.clip(np.round(na), -127, 127).astype(np.int8)
            blob.extend(p16.tobytes()); pad()
            blob.extend(n8.tobytes())
            if has_uv:
                blob.extend(np.array(uvs, dtype='<f4').tobytes())
            i32 = nv > 65535
            blob.extend(np.array(idx, dtype='<u4' if i32 else '<u2').tobytes()); pad()
            chunks.append(dict(t=target, m=1 if part.mirror else 0, id=d['id'], a=d['a'], c=[round(c, 4) for c in d['col']], nv=nv, ni=ni, uv=1 if has_uv else 0, i32=1 if i32 else 0))
        bpy.data.meshes.remove(me)
    meta = dict(scale=SCALE, car=car or {}, targets=targets, chunks=chunks)
    z = zlib.compress(bytes(blob), 9)
    return meta, z, len(blob)


def export(parts, path, car=None, prefix='DB5', title='Aston Martin DB5', script='db5_build.py'):
    """Write the car as a compact binary (zlib + base64) wrapped in a JS file for the game build."""
    import base64, json
    meta, z, raw = export_blob(parts, car)
    chunks = meta['chunks']
    with open(path, 'w') as f:
        f.write('// ' + title + ' mesh, generated by source/blender/' + script + ' (Blender). Do not edit by hand.\n')
        f.write('const ' + prefix + '_META = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
        f.write('const ' + prefix + '_B64 = "' + base64.b64encode(z).decode() + '";\n')
    tv = sum(c['nv'] for c in chunks)
    tt = sum(c['ni'] for c in chunks) // 3
    print('export: %d chunks, %d verts, %d tris, raw %.0f KB, packed %.0f KB' % (len(chunks), tv, tt, raw / 1024, len(z) * 4 / 3 / 1024))
