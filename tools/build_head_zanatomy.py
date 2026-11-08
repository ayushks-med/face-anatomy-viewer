"""
Build the head & face GLB layers from the Z-Anatomy Blender atlas.

Run headless (Blender >= 4.2):

  blender -b /path/to/Z-Anatomy/Startup.blend \
      --python tools/build_head_zanatomy.py -- models

Embedded scripts in the .blend are NOT executed (Blender's default for
files opened from the command line); this script only reads mesh data.

Output, inside the folder given after `--`:
  head/<layer>.glb          one file per layer, one named mesh per structure
  parts/head.generated.json part id -> name, layer, side, description

Coordinates are kept in the atlas' world frame (metres). The glTF exporter
converts Blender Z-up to glTF Y-up, so every model derived from Z-Anatomy or
BodyParts3D lines up automatically. That's what makes adding the rest of
the body later a matter of dropping in more GLBs.
"""
import bpy, bmesh, sys, os, re, json
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "models")

# --- selection ---------------------------------------------------------------
Z_CENTRE_MIN = 1.48   # keep objects whose bbox centre is above this (m)
Z_CUT = 1.45          # clip geometry below this plane (upper neck)

SKIP_SUFFIX = re.compile(r"\.(j|i|t|g|o\d?[lr]?|e\d?[lr]?)$")  # labels/insertions/groups
# Inner ear / ossicles come from a CC BY-NC-SA source inside Z-Anatomy -> excluded.
EXCLUDE = re.compile(
    r"^(cochlea|vestibule\b|malleus|incus|stapes|tympanic membrane|cochlear nerve|"
    r"vestibular nerve|vestibulocochlear nerve|.*semicircular)", re.I)
SKIN_EXCLUDE = re.compile(r"hairs? of|eyelashes", re.I)
TOOTH = re.compile(r"tooth|incisor|molar|canine|premolar", re.I)
EYE = re.compile(r"eyeball|cornea|sclera|retina|iris|lens|choroid(?! plexus)|ciliary body|vitreous|"
                 r"pupil|anterior chamber|posterior chamber|suspensory ligament of eyeball|"
                 r"lacrimal gland|tarsus|conjunctiva", re.I)
SKIP_MUSCLE = re.compile(r"fascia", re.I)


def system_of(o):
    for c in o.users_collection:
        m = re.match(r"^(\d):", c.name)
        if m:
            return int(m.group(1))
    return None


def layer_of(o):
    s, n = system_of(o), o.name
    if s == 9:
        return None if SKIN_EXCLUDE.search(n) else "skin"
    if s in (1, 3):
        return "teeth" if TOOTH.search(n) else "skull"
    if s == 4:
        if EYE.search(n) and "muscle" not in n.lower():
            return "eyes"
        return None if SKIP_MUSCLE.search(n) else "muscles"
    if s == 5:
        return "vessels"
    if s == 7:
        cols = {c.name for c in o.users_collection}
        if EYE.search(n) or cols & {"Eye*", "Lacrimal apparatus", "Lacrimal canliculus", "Lacrimal sac", "Nasolacrimal duct"}:
            return "eyes"
        if cols & {"Peripheral nervous system", "Cranial nerves", "Nerves"}:
            return "nerves"
        if "Sense organs" in cols:            # e.g. auditory tube
            return "glands"
        return "brain"
    if s in (6, 8):
        return "glands"
    return None


# --- helpers -----------------------------------------------------------------
def slug(name):
    s = name.strip().lower()
    s = re.sub(r"\.l$", "_left", s)
    s = re.sub(r"\.r$", "_right", s)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def side_of(name):
    return "left" if name.endswith(".l") else "right" if name.endswith(".r") else None


def base_name(name):
    return re.sub(r"\.(l|r)$", "", name).strip()


def display_name(name):
    b, side = base_name(name), side_of(name)
    b = b[0].upper() + b[1:] if b else b
    return f"{b} ({side})" if side else b


TEXTS = {t.name.lower(): t for t in bpy.data.texts}


def description_for(name):
    t = TEXTS.get(base_name(name).lower())
    if not t:
        return ""
    raw = t.as_string()
    body = raw.split("\n==")[0]                          # before first wiki section
    paras = [p.strip() for p in body.split("\n") if p.strip()]
    paras = [p for p in paras if not (p.isupper() and len(p) < 120)]   # drop title line
    text = " ".join(paras)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for s in sentences:
        if len(out) + len(s) > 340 and out:
            break
        out = (out + " " + s).strip()
    return out


def evaluated_world_mesh(o, depsgraph):
    """Return a new standalone mesh with modifiers/bevel applied, in world space."""
    ev = o.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=depsgraph)
    me.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        me.flip_normals()
    return me


def clip_below(me, z):
    bm = bmesh.new()
    bm.from_mesh(me)
    if min((v.co.z for v in bm.verts), default=z) < z:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    n = len(bm.faces)
    bm.free()
    return n


# --- collect -----------------------------------------------------------------
scene = bpy.context.scene
picked = []
for o in bpy.data.objects:
    if o.type not in ("MESH", "CURVE"):
        continue
    n = o.name
    if SKIP_SUFFIX.search(n) or n.startswith("(") or n.startswith("?") or EXCLUDE.search(n):
        continue
    if o.type == "MESH" and len(o.data.vertices) < 12:
        continue
    zs = [(o.matrix_world @ Vector(c)).z for c in o.bound_box]
    if (min(zs) + max(zs)) / 2 < Z_CENTRE_MIN:
        continue
    layer = layer_of(o)
    if layer:
        picked.append((o, layer))

print(f"[build] candidates: {len(picked)}")

# Make sure every picked object is evaluable (linked into the active scene, visible).
for o, layer in picked:
    if o.name not in scene.objects:
        scene.collection.objects.link(o)
    o.hide_viewport = False
    for m in o.modifiers:
        if m.type == "SOLIDIFY" and layer == "skin":
            m.show_viewport = False        # skin rendered double-sided instead
        if m.type == "SUBSURF":
            m.levels = min(m.levels, 1)
        if m.type == "DECIMATE":
            pass
    if layer == "brain" and o.type == "MESH":
        d = o.modifiers.new("build_decimate", "DECIMATE")
        d.ratio = 0.4
    if o.type == "CURVE":
        o.data.bevel_resolution = min(o.data.bevel_resolution, 1)   # 8-sided tubes
        o.data.resolution_u = min(o.data.resolution_u, 4)
        if o.data.bevel_depth == 0 and o.data.bevel_object is None:
            o.data.bevel_depth = 0.0005

bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()

# --- build output objects -----------------------------------------------------
out_scene = bpy.data.scenes.new("export")
layers = {}
parts = {}
used = set()
for o, layer in picked:
    try:
        me = evaluated_world_mesh(o, depsgraph)
    except Exception as e:  # noqa
        print(f"[build] skip {o.name}: {e}")
        continue
    if clip_below(me, Z_CUT) == 0:
        bpy.data.meshes.remove(me)
        continue
    me.materials.clear()
    me.shade_smooth()
    pid = slug(o.name)
    while pid in used:
        pid += "_x"
    used.add(pid)
    me.name = pid
    ob = bpy.data.objects.new(pid, me)
    ob["label"] = display_name(o.name)
    ob["layer"] = layer
    ob["source"] = "zanatomy"
    out_scene.collection.objects.link(ob)
    layers.setdefault(layer, []).append(ob)
    parts[pid] = {
        "name": display_name(o.name),
        "layer": layer,
        "side": side_of(o.name),
        "description": description_for(o.name),
        "descriptionSource": "wikipedia",
        "source": "zanatomy",
    }

# --- seamless skin: average normals where neighbouring patches share vertices --
from mathutils import kdtree
skin = layers.get("skin", [])
if skin:
    pts = [(ob, i, v.co.copy(), ob.data.vertex_normals[i].vector.copy())
           for ob in skin for i, v in enumerate(ob.data.vertices)]
    kd = kdtree.KDTree(len(pts))
    for k, p in enumerate(pts):
        kd.insert(p[2], k)
    kd.balance()
    per_obj = {ob.name: [None] * len(ob.data.vertices) for ob in skin}
    for ob, i, co, nrm in pts:
        acc = Vector()
        for _, k, _ in kd.find_range(co, 2e-4):
            acc += pts[k][3]
        per_obj[ob.name][i] = acc.normalized() if acc.length else nrm
    for ob in skin:
        ob.data.normals_split_custom_set_from_vertices(per_obj[ob.name])

# --- export -------------------------------------------------------------------
os.makedirs(os.path.join(OUT, "head"), exist_ok=True)
os.makedirs(os.path.join(OUT, "parts"), exist_ok=True)
win = bpy.context.window
for layer, objs in sorted(layers.items()):
    tmp = bpy.data.scenes.new(f"export_{layer}")
    for ob in objs:
        tmp.collection.objects.link(ob)
    with bpy.context.temp_override(scene=tmp, view_layer=tmp.view_layers[0]):
        path = os.path.join(OUT, "head", f"{layer}.glb")
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_active_scene=True,
            export_extras=True, export_materials="NONE", export_normals=True,
            export_texcoords=False, export_yup=True, export_apply=False,
        )
    print(f"[build] {layer}: {len(objs)} meshes -> {path} ({os.path.getsize(path)/1e6:.1f} MB)")

with open(os.path.join(OUT, "parts", "head.generated.json"), "w") as f:
    json.dump(dict(sorted(parts.items())), f, indent=1, ensure_ascii=False)
for p in parts.values():
    if not p["description"]:
        p["descriptionSource"] = None
missing = sum(1 for p in parts.values() if not p["description"])
print(f"[build] parts: {len(parts)} (no description: {missing})")
