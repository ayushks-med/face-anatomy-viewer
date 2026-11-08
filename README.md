# Head & Face Anatomy Viewer

An interactive 3D viewer for the human head and face that runs in the browser (Three.js + Vite).

- **Layers:** skin, muscles, skull and cartilage, teeth, eyes, nerves, blood vessels, glands and soft tissue, brain. Each layer has a show/hide toggle and an opacity slider.
- **Peel back:** one slider fades skin → muscle → bone. Click the *Skin / Muscle / Bone* labels to jump straight to a stage.
- **Hover** highlights a structure and shows its name. **Click** opens a side panel with its name and description, plus **Hide**, **Isolate** and **Focus** buttons.
- **Search** box finds a structure by name. Choosing a result turns its layer on, peels down to it and flies the camera there.
- **Reset view**, soft studio lighting and a neutral background.
- There are 907 separately named structures. Models come from [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on BodyParts3D, under CC BY-SA 4.0. See [models/SOURCES.md](models/SOURCES.md).

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build: `npm run build` writes a static site to `dist/`. Preview it with `npm run preview`, or serve `dist/` from any static host.

**Controls**
- Left-drag: rotate
- Right-drag or Shift + drag: pan
- Scroll: zoom (towards the cursor)
- `Esc`: deselect or exit isolate
- `H`: hide the selected part

## Project layout

```
models/                     ← Vite publicDir: everything here is served at the site root
  models.json               ← the config: layers, files, colours, peel order, sources
  head/*.glb                ← one GLB per layer, one named mesh per structure
  parts/head.generated.json ← names + descriptions written by the build script (don't edit)
  parts/head.json           ← your edits; overrides the generated file field by field
  SOURCES.md                ← origin, author and licence of every model
src/
  main.js                   ← loads config + parts files, starts the viewer
  viewer.js                 ← scene, lighting, loading, layer/peel state, picking, camera
  ui.js                     ← layer panel, peel slider, info panel, search
  style.css
tools/
  build_head_zanatomy.py    ← Blender script: Z-Anatomy .blend → head/*.glb + parts JSON
  optimize-models.mjs       ← meshopt-compresses GLBs in place
```

## Editing names and descriptions

Open `models/parts/head.json` and add or change entries keyed by part id:

```json
{
  "zygomaticus_major_muscle_left": {
    "name": "Zygomaticus major (left)",
    "description": "Pulls the corner of the mouth up and back: the smiling muscle."
  }
}
```

To find a part's id, click the part, then run `viewer.selected.userData.partId` in the browser console. Or search `head.generated.json`. Ids are the original atlas name in snake case, with `_left` or `_right` at the end. Reload the page to see your edits.

Don't edit `head.generated.json`: the build script rewrites it, while `head.json` is never touched.

## Adding a new model (e.g. the full body later)

The viewer shows exactly what `models/models.json` lists. To add something:

1. **Drop the GLB(s) into `models/`**, e.g. `models/body/muscles.glb`.
2. **List them in `models/models.json`**, either by adding the files to an existing layer:
   ```json
   { "id": "muscles", "files": ["head/muscles.glb", "body/muscles.glb"], ... }
   ```
   or by adding a new layer:
   ```json
   {
     "id": "organs",
     "label": "Thoracic & abdominal organs",
     "files": ["body/organs.glb"],
     "color": "#c78a7a",
     "roughness": 0.5,
     "visible": true,
     "peelDepth": 1,
     "colorRules": [{ "match": "liver", "color": "#8a3b32" }]
   }
   ```
3. **Optional: add names and descriptions.** Create `models/parts/body.json` and add it to `"partsFiles"`.
4. If the new source isn't Z-Anatomy, add it under `"sources"` and set `"source": "<key>"` on its parts entries. That makes the info panel credit it. Then record it in `models/SOURCES.md`.

**What a GLB needs:**
- One mesh per anatomical structure. The mesh/node name is the part id, so use names with no spaces or dots, e.g. `left_biceps_brachii`. Three.js mangles names containing those characters.
- Optionally, a glTF `extras.label` on each node with a readable name. Without it, the id is shown until you add a name in a parts file.
- Materials are ignored: colour comes from the layer's `color` and `colorRules`.
- Positions are in **metres, Y-up**. Every Z-Anatomy/BodyParts3D export shares one body coordinate frame (feet near y = 0, top of the head at y ≈ 1.7), so full-body files line up with the head automatically. Models from other sources must be scaled and moved into that frame before export.
- The camera frames whatever is visible on load, so a full body just works.

### Full body from Z-Anatomy (the easy path)

`tools/build_head_zanatomy.py` already contains the whole pipeline, and only its selection limits make it head-only. To build the full body:

1. Download the atlas from https://github.com/Z-Anatomy/Models-of-human-anatomy (`Z-Anatomy.zip`, ~87 MB) and unzip it. Install [Blender](https://www.blender.org/) 4.2+.
2. Copy the script, e.g. to `tools/build_body_zanatomy.py`, and change:
   - `Z_CENTRE_MIN = 1.48` and `Z_CUT = 1.45` → `-1` (keep everything, no clipping);
   - the output folder `head` → `body`, and the parts filename `head.generated.json` → `body.generated.json`;
   - review `EXCLUDE`. Z-Anatomy also bundles a CC BY-NC kidney model; leave it out if you need a commercial-friendly licence.
3. Run it, then compress the output:
   ```bash
   blender -b /path/to/Z-Anatomy/Startup.blend --python tools/build_body_zanatomy.py -- models
   npm run optimize -- models/body
   ```
4. Add `body/*.glb` to the layers in `models.json`, and add `parts/body.generated.json` to `partsFiles`.

The full body is roughly 4,500 meshes. If loading gets slow, split layers into regions and load them lazily (see `Viewer.load`).

### Rebuilding the head models

```bash
ZANATOMY_BLEND=/path/to/Z-Anatomy/Startup.blend npm run build:models
```

This rewrites `models/head/*.glb` and `models/parts/head.generated.json`. Part ids are stable, so your `head.json` edits keep working. Blender opens the .blend with embedded scripts disabled; the build only reads geometry.

## models.json reference

| Key | Meaning |
|---|---|
| `title` | Page/panel title |
| `partsFiles` | JSON files of `{ id: { name, description, descriptionSource, source } }`, merged in order (later wins) |
| `sources` | `{ key: { label, licence, url } }` shown in the info panel and footer |
| `peel` | Layer ids faded by the peel slider, outermost first |
| `peelLabels` | Labels under the slider (`peel.length + 1` entries) |
| `layers[].id / label / files` | Layer identity and the GLBs it loads |
| `layers[].color / roughness / sheen / doubleSided` | Material look |
| `layers[].visible / opacity` | Initial state |
| `layers[].peelDepth` | How far to peel when a part of this layer is picked from search |
| `layers[].colorRules` | `[{ match: "regex", color, opacity }]`, matched against part names |

## Licences

- **Models** (`models/head/*.glb`): CC BY-SA 4.0, derived from Z-Anatomy and BodyParts3D (© The Database Center for Life Science). If you redistribute them or derivatives, credit both and keep the same licence.
- **Descriptions** marked `wikipedia`: CC BY-SA 3.0, from Wikipedia.
- **Viewer code** (`src/`, `tools/`): yours to licence as you choose.

Full details are in [models/SOURCES.md](models/SOURCES.md).
