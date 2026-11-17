# Aston Martin DB5 — Blender source

The DB5 is modelled in Blender by script (no hand-made `.blend` file) and exported into
`../js/29_db5_data.js`, which the normal game build (`node fable/source/build.mjs`) bundles into `index.html`.

```bash
# rebuild the mesh used by the game (Blender 4.x, headless)
blender -b -P fable/source/blender/db5_build.py -- --export fable/source/js/29_db5_data.js
# preview renders (Cycles, CPU)
blender -b -P fable/source/blender/db5_build.py -- --render /tmp/db5 --views f34,r34,side
```

| File | What it holds |
|---|---|
| `db5_shape.py` | The body surface, fitted to measured curves (see *Sources*) |
| `db5_build.py` | Entry point: body cut-outs (glass, arches, lamps, grille), materials, render, export |
| `db5_parts.py` | Wheels, bumpers, grille, lamps, vents, mirrors, wipers, exhausts, underbody |
| `db5_interior.py` | Cabin (right-hand drive) and the moving gadget parts |
| `db5_lib.py` | Small modelling toolkit on top of `bmesh`, and the exporter |

All geometry is authored in the game's car frame: origin on the ground under the middle of the wheelbase,
**X forward, Y up, Z to the right**, metres.

## Sources

- FIA/RAC homologation form no. 186 (Aston Martin DB5, 1963): dimensions, wheels and tyres, gearbox, engine.
- Scale drawings from getoutlines.com (CC BY 4.0), used for measuring the profile, plan and window outlines.
- Owner-supplied reference photographs (exterior and cabin).

## Export format (`29_db5_data.js`)

`DB5_B64` is base64 of a zlib stream; `DB5_META` describes it:

```js
DB5_META = {
  scale: 8000,                       // positions are int16 = metres * scale
  targets: { plateF: { pivot: [x, y, z] }, ... },   // pivots of the moving parts that need one
  chunks: [ { t, m, id, a, c, nv, ni, uv, i32 }, ... ]
}
```

Chunks follow each other in the binary in the order listed, each padded to 4 bytes after the position and index arrays:

1. `int16[nv*3]` positions (then padding to a multiple of 4 bytes)
2. `int8[nv*4]` normals (x, y, z scaled by 127; the 4th byte is unused)
3. `float32[nv*2]` texture coordinates — only when `uv` is 1
4. `uint16[ni]` (or `uint32[ni]` when `i32` is 1) triangle indices, counter-clockwise seen from outside (then padding)

Per chunk: `t` target (which object the triangles belong to), `m` 1 = also add the mirror image in Z,
`id`/`a` material id and variant for `wgsl/mat_car.wgsl`, `c` vertex colour (linear RGB).

Targets: `body`, `glass` (transparent pass), `wheel` and `wheelblur` (wheel frame: axle along Z, outer face +Z),
`steer` (steering-wheel frame: X along the column towards the driver), `driver`, `head`, `seat` (ejector seat),
`roofpanel`, `plateF`, `plateR`, `guns`, `muzzle`, `gunlamp`, `shield`, `slasher` (wheel frame), `ramF`, `ramR`.
