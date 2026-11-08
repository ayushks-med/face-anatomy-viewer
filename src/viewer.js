import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const HOVER = new THREE.Color('#4da3ff');
const SELECT = new THREE.Color('#ffb547');
const PICK_MIN_OPACITY = 0.3; // fainter layers are see-through for the mouse

/**
 * Scene + state. UI code talks to this through methods and the `on*` callbacks.
 * State model:
 *   layer.visible, layer.opacity     user controls
 *   peel (0..peel.length)            fades configured layers in order
 *   part.hidden, isolatedId          per-part overrides
 */
export class Viewer {
  constructor(container, config, parts) {
    this.config = config;
    this.partsInfo = parts;
    this.layers = new Map();      // id -> { def, visible, opacity, group, meshes: [] }
    this.meshes = new Map();      // part id -> mesh
    this.peel = 0;
    this.isolatedId = null;
    this.hovered = null;
    this.selected = null;
    this.onSelect = () => {};
    this.onHover = () => {};
    this.onChange = () => {};

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);
    this.container = container;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.005, 20);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;

    this.#setupLights();
    this.#setupPicking();
    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
    r.setAnimationLoop(() => this.#tick());
  }

  // ---------------------------------------------------------------- scene setup
  #setupLights() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.scene.add(new THREE.HemisphereLight('#f4f1ec', '#55524e', 0.9));
    const key = new THREE.DirectionalLight('#fff4e8', 1.5);
    key.position.set(1.2, 1.4, 2.0);
    const fill = new THREE.DirectionalLight('#e6eeff', 0.55);
    fill.position.set(-1.6, 0.4, 1.0);
    const rim = new THREE.DirectionalLight('#ffffff', 0.8);
    rim.position.set(0, 1.2, -2.0);
    // Lights follow the camera so the subject is always lit like a studio turntable.
    this.lightRig = new THREE.Group();
    this.lightRig.add(key, fill, rim);
    this.camera.add(this.lightRig);
    this.scene.add(this.camera);
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  #tick() {
    if (this.tween) this.#stepTween();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- loading
  async load(baseUrl, onProgress = () => {}) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // plain GLBs load too
    const defs = this.config.layers;
    const jobs = defs.flatMap((def) => def.files.map((file) => ({ def, file })));
    const progress = new Array(jobs.length).fill(0);
    const report = () => onProgress(progress.reduce((a, b) => a + b, 0) / jobs.length);

    defs.forEach((def, i) => {
      const group = new THREE.Group();
      group.name = def.id;
      this.scene.add(group);
      this.layers.set(def.id, {
        def,
        visible: def.visible !== false,
        opacity: def.opacity ?? 1,
        order: defs.length - i, // outer layers (listed first) draw last
        group,
        meshes: [],
      });
    });

    const results = await Promise.allSettled(
      jobs.map(({ def, file }, i) =>
        loader
          .loadAsync(baseUrl + file, (e) => {
            if (e.total) progress[i] = e.loaded / e.total;
            report();
          })
          .then((gltf) => {
            progress[i] = 1;
            report();
            this.#addGltf(def, gltf);
          })
      )
    );
    results.forEach((res, i) => {
      if (res.status === 'rejected') console.warn(`Failed to load ${jobs[i].file}`, res.reason);
    });
    this.failed = results.map((r, i) => (r.status === 'rejected' ? jobs[i].file : null)).filter(Boolean);

    this.#computeHome();
    this.resetView(false);
    this.applyState();
  }

  #addGltf(def, gltf) {
    const layer = this.layers.get(def.id);
    const base = new THREE.Color(def.color ?? '#cccccc');
    const rules = (def.colorRules ?? []).map((r) => ({
      re: new RegExp(r.match, 'i'),
      color: r.color ? new THREE.Color(r.color) : null,
      opacity: r.opacity,
    }));

    gltf.scene.updateMatrixWorld(true);
    const found = [];
    gltf.scene.traverse((o) => o.isMesh && found.push(o));
    for (const mesh of found) {
      // Node names are slug ids (safe from GLTFLoader's name sanitising);
      // the human-readable label travels in glTF extras -> userData.
      const id = mesh.name || mesh.uuid;
      const label = mesh.userData?.label ?? id;
      const info = this.partsInfo[id] ?? {};
      const name = info.name ?? label;
      const rule = rules.find((r) => r.re.test(name));

      const mat = new THREE.MeshPhysicalMaterial({
        color: rule?.color ?? base,
        roughness: def.roughness ?? 0.55,
        metalness: 0,
        sheen: def.sheen ?? 0,
        sheenColor: new THREE.Color('#ffe9e0'),
        side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        emissive: new THREE.Color(0x000000),
      });
      mesh.material = mat;
      mesh.geometry.computeBoundsTree();
      if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
      mesh.renderOrder = layer.order;
      mesh.userData.partId = id;
      mesh.userData.layerId = def.id;
      mesh.userData.name = name;
      mesh.userData.hidden = false;
      mesh.userData.baseOpacity = rule?.opacity ?? 1;

      // Flatten into the layer group in world space.
      mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      layer.group.add(mesh);
      layer.meshes.push(mesh);
      this.meshes.set(id, mesh);
    }
  }

  // ---------------------------------------------------------------- state
  peelFactor(layerId) {
    const i = this.config.peel?.indexOf(layerId) ?? -1;
    if (i < 0) return 1;
    return THREE.MathUtils.clamp(1 - (this.peel - i), 0, 1);
  }

  effectiveOpacity(mesh) {
    const layer = this.layers.get(mesh.userData.layerId);
    const base = mesh.userData.baseOpacity;
    if (this.isolatedId) return mesh.userData.partId === this.isolatedId ? Math.max(base, 0.6) : 0;
    if (!layer.visible || mesh.userData.hidden) return 0;
    return base * layer.opacity * this.peelFactor(layer.def.id);
  }

  applyState() {
    for (const layer of this.layers.values()) {
      for (const mesh of layer.meshes) {
        const a = this.effectiveOpacity(mesh);
        const m = mesh.material;
        mesh.visible = a > 0.01;
        const transparent = a < 0.999;
        if (m.transparent !== transparent) m.needsUpdate = true;
        m.transparent = transparent;
        m.opacity = a;
        m.depthWrite = a > 0.6;
      }
    }
    this.#refreshHighlight();
    this.onChange();
  }

  setLayerVisible(id, v) { this.layers.get(id).visible = v; this.applyState(); }
  setLayerOpacity(id, a) { this.layers.get(id).opacity = a; this.applyState(); }
  setPeel(v) { this.peel = v; this.applyState(); }

  hidePart(id) {
    const m = this.meshes.get(id);
    if (!m) return;
    m.userData.hidden = true;
    if (this.isolatedId === id) this.isolatedId = null;
    if (this.selected === m) this.select(null);
    this.applyState();
  }

  showAllParts() {
    for (const m of this.meshes.values()) m.userData.hidden = false;
    this.applyState();
  }

  hiddenCount() {
    let n = 0;
    for (const m of this.meshes.values()) if (m.userData.hidden) n++;
    return n;
  }

  isolate(id) {
    this.isolatedId = this.isolatedId === id ? null : id;
    this.applyState();
    if (this.isolatedId) this.focus(id);
  }

  select(mesh) {
    this.selected = mesh;
    this.#refreshHighlight();
    this.onSelect(mesh ? this.partDetails(mesh) : null);
  }

  selectById(id) {
    const m = this.meshes.get(id);
    if (!m) return;
    const layer = this.layers.get(m.userData.layerId);
    // Make sure what you picked from search is actually visible:
    // layer on, part unhidden, and peeled down far enough to uncover it.
    if (!layer.visible) layer.visible = true;
    m.userData.hidden = false;
    const depth = layer.def.peelDepth ?? this.config.peel?.indexOf(layer.def.id) ?? 0;
    if (depth > this.peel) this.peel = depth;
    this.applyState();
    this.select(m);
    this.focus(id);
  }

  partDetails(mesh) {
    const id = mesh.userData.partId;
    const info = this.partsInfo[id] ?? {};
    const layer = this.layers.get(mesh.userData.layerId);
    const source = this.config.sources?.[info.source];
    return {
      id,
      name: mesh.userData.name,
      description: info.description ?? '',
      descriptionSource: info.descriptionSource ?? null,
      layerId: layer.def.id,
      layerLabel: layer.def.label,
      color: '#' + mesh.material.color.getHexString(),
      source,
      isolated: this.isolatedId === id,
    };
  }

  searchParts(q, limit = 40) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const [id, m] of this.meshes) {
      const name = m.userData.name;
      if (name.toLowerCase().includes(q)) out.push({ id, name, layer: this.layers.get(m.userData.layerId).def.label });
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- highlight & picking
  #refreshHighlight() {
    for (const m of this.meshes.values()) {
      const e = m === this.selected ? SELECT : m === this.hovered ? HOVER : null;
      if (e) m.material.emissive.copy(e).multiplyScalar(m === this.selected ? 0.35 : 0.45);
      else m.material.emissive.setRGB(0, 0, 0);
    }
  }

  #setupPicking() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = true;
    const ndc = new THREE.Vector2();
    let pending = null;
    let down = null;

    const pick = (x, y) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const targets = [];
      for (const m of this.meshes.values()) if (m.visible && m.material.opacity >= PICK_MIN_OPACITY) targets.push(m);
      return ray.intersectObjects(targets, false)[0]?.object ?? null;
    };

    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return; // dragging: don't hover-pick
      pending = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerleave', () => {
      pending = null;
      this.#setHover(null);
    });
    // Throttle hover picking to once per frame.
    const loop = () => {
      if (pending) {
        const { x, y } = pending;
        pending = null;
        this.#setHover(pick(x, y), x, y);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this.select(pick(e.clientX, e.clientY));
    });
  }

  #setHover(mesh, x, y) {
    if (mesh !== this.hovered) {
      this.hovered = mesh;
      this.#refreshHighlight();
      this.renderer.domElement.style.cursor = mesh ? 'pointer' : '';
    }
    this.onHover(mesh ? mesh.userData.name : null, x, y);
  }

  // ---------------------------------------------------------------- camera
  #computeHome() {
    const box = new THREE.Box3();
    for (const layer of this.layers.values()) if (layer.visible) box.expandByObject(layer.group);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = sphere.radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;
    this.home = {
      target: sphere.center.clone(),
      position: sphere.center.clone().add(new THREE.Vector3(0.35, 0.12, 1).normalize().multiplyScalar(dist)),
    };
    this.controls.minDistance = sphere.radius * 0.05;
    this.controls.maxDistance = dist * 4;
  }

  resetView(animate = true) {
    this.flyTo(this.home.position, this.home.target, animate);
  }

  focus(id) {
    const m = this.meshes.get(id);
    if (!m) return;
    const sphere = new THREE.Box3().setFromObject(m).getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.015);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.6;
    this.flyTo(sphere.center.clone().add(dir.multiplyScalar(dist)), sphere.center, true);
  }

  flyTo(position, target, animate = true) {
    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = {
      t0: performance.now(), dur: 650,
      p0: this.camera.position.clone(), p1: position.clone(),
      c0: this.controls.target.clone(), c1: target.clone(),
    };
  }

  #stepTween() {
    const tw = this.tween;
    let t = Math.min((performance.now() - tw.t0) / tw.dur, 1);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.camera.position.lerpVectors(tw.p0, tw.p1, k);
    this.controls.target.lerpVectors(tw.c0, tw.c1, k);
    if (t === 1) this.tween = null;
  }
}
