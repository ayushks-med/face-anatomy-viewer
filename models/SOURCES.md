# Model sources and licences

Every file in `models/` and where it came from. Only sources with a clear licence that allows reuse are included.

## Used

### Z-Anatomy: all files in `head/*.glb`

| | |
|---|---|
| Origin | https://github.com/Z-Anatomy/Models-of-human-anatomy (file `Z-Anatomy.zip` → `Z-Anatomy/Startup.blend`, dated 2023-05-02 inside the zip; downloaded 2026-11-08) |
| Authors | Gauthier Kervyn (design, 3D, anatomy), Marcin Zielinski (Blender add-on), Lluis Vinent (app), based on Kousaku Okubo's BodyParts3D |
| Licence | **CC BY-SA 4.0**: https://creativecommons.org/licenses/by-sa/4.0/ |
| Required attribution | "Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0" and "BodyParts3D - The Database Center for Life Science" (see below) |

| File | Contents | Meshes |
|---|---|---|
| `head/skin.glb` | Surface regions of head, face, ears and upper neck (one mesh per region) | 92 |
| `head/muscles.glb` | Facial-expression, masticatory, extra-ocular, tongue, palate, suboccipital and upper neck muscles | 128 |
| `head/skull.glb` | Cranial and facial bones, nasal and laryngeal cartilages, hyoid, C1–C5 vertebrae and discs, TMJ and neck ligaments | 67 |
| `head/teeth.glb` | 28 permanent teeth (third molars not modelled in source) | 28 |
| `head/eyes.glb` | Eyeball layers (sclera, cornea, iris, lens, retina, vitreous...), eyelid tarsi, lacrimal apparatus | 35 |
| `head/nerves.glb` | Cranial nerves I–VII, IX, XII and trigeminal divisions/branches. Each nerve's finer branches are part of its parent mesh | 44 |
| `head/vessels.glb` | Arteries, veins and dural venous sinuses of the head | 203 |
| `head/glands.glb` | Salivary glands, tongue, palate, pharynx, auditory tube, lymph nodes, pituitary, pineal, thyroid | 52 |
| `head/brain.glb` | Gyri, sulci, deep nuclei, brainstem and cranial-nerve nuclei, cerebellum (decimated to 40%) | 258 |

**Derived work, ShareAlike applies.** The GLBs were produced by `tools/build_head_zanatomy.py`, which:
- keeps only structures centred above z = 1.48 m;
- clips geometry at z = 1.45 m (upper neck);
- applies the atlas's modifiers;
- turns curves (nerves and vessels) into 8-sided tubes;
- disables the skin "solidify" thickness;
- decimates the brain;
- compresses with meshopt.

These modified models are therefore also licensed **CC BY-SA 4.0**.

**Excluded on purpose:** the inner ear and ossicles (cochlea, vestibule, semicircular canals, malleus, incus, stapes, tympanic membrane, cochlear and vestibular nerves). Z-Anatomy says it adapted these from "Anatomy of the Inner Ear, University of Dundee School of Medicine, **CC BY-NC-SA 4.0**", a non-commercial licence. Z-Anatomy also lists a CC BY-NC kidney model, which is outside the head and not used.

### BodyParts3D: upstream of Z-Anatomy

| | |
|---|---|
| Origin | https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html |
| Author | The Database Center for Life Science (DBCLS), Japan; original model by Kousaku Okubo |
| Licence | **CC BY 4.0** per the licence page updated 2025-02-27 (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Older releases, the headers inside the 4.0 OBJ files, and Z-Anatomy's attribution all say CC BY-SA 2.1 Japan |
| Required attribution | "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International" |

BodyParts3D release 4.0 OBJ archives (`partof_BP3D_4.0_obj_99.zip`, `isa_BP3D_4.0_obj_99.zip`) were downloaded and reviewed. They were **not used directly**, because they lack the muscles of facial expression and mastication: no orbicularis oculi/oris, zygomaticus, frontalis, masseter or temporalis. Z-Anatomy already contains the BodyParts3D geometry and fills those gaps in the same coordinate frame. They are listed here because the Z-Anatomy meshes are derived from them.

### Descriptions: `parts/head.generated.json`

| | |
|---|---|
| Origin | Wikipedia article lead paragraphs, embedded as text blocks in the Z-Anatomy .blend |
| Licence | **CC BY-SA 3.0** (Wikipedia). Each entry is marked `"descriptionSource": "wikipedia"` |

`parts/head.json` holds hand-written descriptions for the 166 parts that had none (91 distinct structures), marked `"descriptionSource": "hand-written"`.

## Evaluated, not used

| Source | Why not |
|---|---|
| NIH 3D (3d.nih.gov), e.g. CC BY CT-derived skulls (3DPX-002448) | Skull only, no muscles, nerves or vessels. It's a separate scan in its own scale and position, so it wouldn't line up with the other layers. |
| Sketchfab "Half of a head, with and w/o skin" (Maastricht/Aachen, via anatomytool.org) | CC BY-NC-SA (non-commercial) |
| Sketchfab "visible interactive human exploding skull" | CC BY-NC-ND |
| Sketchfab "Head anatomy for artist" and other head-muscle models | No clear reusable licence shown, and downloads need an account |
| Commercial head models (CGTrader, RenderHub) | Paid or restricted licences |

## Not found

Nothing requested is missing. Limitations of the source:
- The teeth are permanent teeth without third molars (wisdom teeth).
- Facial nerve branches (temporal, zygomatic, buccal, marginal mandibular, cervical) and the fine trigeminal skin branches (supra-orbital, infra-orbital...) are not separate objects. They are part of their parent nerve's mesh, so you can only select the whole nerve.
