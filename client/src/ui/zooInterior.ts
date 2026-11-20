/**
 * Zoo-Tycoon-style interior of one habitat: its own small Three.js scene and renderer.
 * Items sit on an 8×8 grid; animals wander; clicks pick animals, items or grid spots.
 */
import * as THREE from "three";
import { StyleFx } from "../render/styleFx.ts";
import {
  ITEM_GRID,
  growthScale,
  speciesInfo,
  type Animal,
  type CareAct,
  type CityState,
  type Habitat,
  type HabitatItem,
  type ItemKind,
} from "../../../shared/src/index.ts";
import { animalGeometry, coatTint, itemGeometry, patternColor } from "../render/zooModels.ts";
import { wanderPose, type Pose } from "../render/zooMotion.ts";
import { blobShadowMaterial, buildInteriorDecor, setWindTime, type DecorType, type InteriorDecor } from "../render/zooDecor.ts";
import { gfxProfile, loadGfxPreset } from "../render/quality.ts";

export const SPOT = 2.2;
const HALF = (ITEM_GRID * SPOT) / 2;
const OUTSIDE: Record<string, number> = { savanne: 0x8fa85e, wald: 0x5f8a4a, wasser: 0x7aa85c, polar: 0xb8c8b4, wiese: 0x86b45e };

export type InteriorTool = ItemKind | "remove" | null;

export interface InteriorHooks {
  pickAnimal: (id: number) => void;
  pickSpot: (x: number, y: number) => void;
  pickItem: (id: number) => void;
}

interface AnimalView {
  group: THREE.Group;
  body: THREE.Mesh;
  pattern: THREE.Mesh;
  boost: number;
  react: { kind: CareAct; until: number; start: number } | null;
}

interface Burst {
  sprite: THREE.Sprite;
  born: number;
  vx: number;
  vz: number;
}

const GLYPH: Record<CareAct, { text: string; color: string }> = {
  pet: { text: "♥", color: "#ff5f8f" },
  play: { text: "★", color: "#ffd04a" },
  feed: { text: "♥", color: "#ff9a3c" },
  vet: { text: "✚", color: "#5fd08a" },
};

function glyphTexture(kind: CareAct): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 52px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(60,30,20,0.55)";
  ctx.strokeText(GLYPH[kind].text, 32, 35);
  ctx.fillStyle = GLYPH[kind].color;
  ctx.fillText(GLYPH[kind].text, 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class InteriorScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly fx: StyleFx;
  private readonly sun: THREE.DirectionalLight;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 });
  private readonly ground: THREE.Mesh;
  private readonly outer: THREE.Mesh;
  private readonly low: boolean;
  private dressing: InteriorDecor | null = null;
  private readonly blob = blobShadowMaterial();
  private readonly grid: THREE.LineSegments;
  private readonly ghost: THREE.Mesh;
  private readonly decor = new THREE.Group();
  private readonly items = new Map<number, { mesh: THREE.Mesh; fill: number }>();
  private readonly animals = new Map<number, AnimalView>();
  private readonly bursts: Burst[] = [];
  private readonly textures = new Map<CareAct, THREE.CanvasTexture>();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private habitatType = "";
  private tool: InteriorTool = null;
  private time = 0;
  private tick = 0;
  private azimuth = 0.35;
  private distance = 21;
  private readonly focus = new THREE.Vector3(0, 0, 0.6);
  private inset = { right: 0, bottom: 0 };
  private width = 1;
  private height = 1;
  private drag: { x: number; az: number; moved: boolean } | null = null;
  readonly poses = new Map<number, Pose & { boost: number }>();
  private animalsNow: Animal[] = [];
  selected = -1;

  constructor(readonly canvas: HTMLCanvasElement, private readonly hooks: InteriorHooks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.fx = new StyleFx(this.renderer);
    this.low = gfxProfile(loadGfxPreset(), window.devicePixelRatio || 1).level === "low";
    if (!this.low) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    // Warm late-morning light like the concept art: golden sun, soft sky fill.
    this.scene.background = new THREE.Color(0xcfe3ea);
    this.scene.fog = new THREE.Fog(0xd8e6e2, 42, 95);
    const hemi = new THREE.HemisphereLight(0xfff1da, 0x6e6044, 1.45);
    const sun = new THREE.DirectionalLight(0xffe2b4, 2.5);
    this.sun = sun;
    sun.position.set(11, 19, 8);
    if (!this.low) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1536, 1536);
      const r = HALF + 2.5;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 4, far: 50 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 4;
    }
    this.scene.add(hemi, sun);
    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a9c5e, roughness: 1 }));
    this.outer.position.y = -0.05;
    this.outer.receiveShadow = true;
    this.scene.add(this.outer);
    this.ground = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 1, 0.3, HALF * 2 + 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    this.ground.position.y = -0.15;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    const lines: number[] = [];
    for (let i = 0; i <= ITEM_GRID; i += 1) {
      const t = -HALF + i * SPOT;
      lines.push(t, 0.02, -HALF, t, 0.02, HALF, -HALF, 0.02, t, HALF, 0.02, t);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
    this.grid.visible = false;
    this.scene.add(this.grid, this.decor);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(SPOT * 0.92, 0.08, SPOT * 0.92), new THREE.MeshBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    canvas.addEventListener("pointerdown", (event) => {
      this.drag = { x: event.clientX, az: this.azimuth, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.drag) {
        const dx = event.clientX - this.drag.x;
        if (Math.abs(dx) > 6) this.drag.moved = true;
        if (this.drag.moved) this.azimuth = this.drag.az - dx * 0.006;
      }
      this.hover(event);
    });
    canvas.addEventListener("pointerup", (event) => {
      const moved = this.drag?.moved ?? false;
      this.drag = null;
      if (!moved) this.click(event);
    });
    canvas.addEventListener("pointerleave", () => (this.ghost.visible = false));
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = Math.max(12, Math.min(34, this.distance + event.deltaY * 0.02));
    }, { passive: false });
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    // Portrait screens: wider lens so the whole habitat fits.
    this.camera.fov = this.camera.aspect < 0.8 ? 64 : 42;
    this.applyInset();
  }

  /** Keep the habitat centred in the part of the screen not covered by panels. */
  setInset(right: number, bottom: number): void {
    if (Math.abs(right - this.inset.right) < 2 && Math.abs(bottom - this.inset.bottom) < 2) return;
    this.inset = { right, bottom };
    this.applyInset();
  }

  private applyInset(): void {
    const { right, bottom } = this.inset;
    if (right > 0 || bottom > 0) this.camera.setViewOffset(this.width, this.height, right / 2, bottom / 2, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  setTool(tool: InteriorTool): void {
    this.tool = tool;
    this.grid.visible = tool !== null;
    if (!tool) this.ghost.visible = false;
  }

  /** Rebuild items/animals from state (cheap; called on every state publish). */
  setHabitat(city: CityState, habitat: Habitat, animals: Animal[]): void {
    this.tick = city.tick;
    if (habitat.type !== this.habitatType) this.buildDecor(habitat.type);
    this.syncItems(habitat.items);
    this.animalsNow = animals;
    const alive = new Set(animals.map((animal) => animal.id));
    for (const [id, view] of this.animals) {
      if (alive.has(id)) continue;
      this.scene.remove(view.group);
      this.animals.delete(id);
    }
    for (const animal of animals) {
      let view = this.animals.get(animal.id);
      if (!view) {
        const geo = animalGeometry(animal.species, 2);
        const bodyMat = this.material.clone();
        const patternMat = this.material.clone();
        const body = new THREE.Mesh(geo.body, bodyMat);
        const pattern = new THREE.Mesh(geo.pattern, patternMat);
        body.userData.animal = animal.id;
        pattern.userData.animal = animal.id;
        const group = new THREE.Group();
        body.castShadow = pattern.castShadow = !this.low;
        const [w, h, l] = geo.model.lod;
        const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.blob);
        blob.scale.set(w * 1.5 + 0.2, 1, l * 1.25 + 0.2);
        blob.position.y = 0.03;
        blob.renderOrder = 1;
        blob.raycast = () => undefined;
        group.add(body, pattern, blob);
        // Interior close-up: small animals are drawn bigger so they read and click well.
        const boost = Math.max(1.15, Math.min(3, 1.9 / Math.max(h, l * 0.6)));
        view = { group, body, pattern, boost, react: null };
        this.animals.set(animal.id, view);
        this.scene.add(group);
      }
      const info = speciesInfo(animal.species);
      const geo = animalGeometry(animal.species);
      (view.body.material as THREE.MeshStandardMaterial).color.copy(coatTint(animal.genes.hue));
      // Pattern overlay uses white vertex colors × the blended accent.
      (view.pattern.material as THREE.MeshStandardMaterial).color.copy(patternColor(info?.color ?? 0xffffff, geo.model, animal.genes.hue, animal.genes.pattern));
      const sick = animal.health < 40;
      (view.body.material as THREE.MeshStandardMaterial).emissive.setHex(this.selected === animal.id ? 0x332810 : sick ? 0x1a0a0a : 0x000000);
    }
  }

  /** Visible reaction: hearts/stars and a little animation. */
  react(id: number, kind: CareAct): void {
    const view = this.animals.get(id);
    if (!view) return;
    view.react = { kind, start: this.time, until: this.time + 1.4 };
    let texture = this.textures.get(kind);
    if (!texture) {
      texture = glyphTexture(kind);
      this.textures.set(kind, texture);
    }
    for (let i = 0; i < 6; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      const pose = this.poses.get(id);
      const top = animalGeometry(this.animalsNow.find((a) => a.id === id)?.species ?? "goat").model.lod[1] * (pose?.boost ?? 1);
      sprite.position.set((pose?.x ?? 0) + (Math.random() - 0.5) * 0.8, top + 0.3 + (pose?.y ?? 0) + Math.random() * 0.5, (pose?.z ?? 0) + (Math.random() - 0.5) * 0.8);
      sprite.scale.setScalar(0.9 + Math.random() * 0.4);
      this.scene.add(sprite);
      this.bursts.push({ sprite, born: this.time + i * 0.08, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8 });
    }
  }

  private buildDecor(type: string): void {
    this.habitatType = type;
    this.decor.clear();
    this.dressing?.dispose();
    const pool = type === "wasser" || type === "polar" ? { x: HALF - SPOT * 1.8, z: -HALF + SPOT * 1.3, w: SPOT * 3.6, d: SPOT * 2.6 } : null;
    const edge = HALF + 0.5;
    this.dressing = buildInteriorDecor(type as DecorType, { half: HALF, edge, step: (edge * 2) / (ITEM_GRID * 2), pool, low: this.low });
    this.decor.add(this.dressing.group);
    const groundMat = this.ground.material as THREE.MeshStandardMaterial;
    groundMat.map = this.dressing.groundMap;
    groundMat.color.setHex(0xffffff);
    groundMat.needsUpdate = true;
    (this.outer.material as THREE.MeshStandardMaterial).color.setHex(OUTSIDE[type] ?? 0x7a9c5e);
    // Scenery outside the fence so the space reads as part of a zoo.
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7), new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 1 }));
    trunk.position.y = 1.1;
    const conifer = type === "wald" || type === "polar";
    const crownMat = new THREE.MeshStandardMaterial({ color: type === "polar" ? 0x5a8a6a : 0x6e9a50, roughness: 0.9, flatShading: true });
    tree.add(trunk);
    if (conifer) {
      for (const [y, r, h] of [[2.3, 1.5, 2.0], [3.3, 1.15, 1.7], [4.2, 0.75, 1.3]]) {
        const tier = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), crownMat);
        tier.position.y = y;
        tree.add(tier);
      }
    } else {
      for (const [x, y, z, r] of [[0, 3.0, 0, 1.4], [0.8, 2.6, 0.3, 1.0], [-0.7, 2.7, -0.2, 1.05]]) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), crownMat);
        blob.position.set(x, y, z);
        tree.add(blob);
      }
    }
    tree.traverse((object) => (object.castShadow = true));
    for (const [x, z, s] of [[-HALF - 4, -HALF + 2, 1], [-HALF - 5, HALF - 4, 1.2], [HALF + 5, HALF - 2, 0.9], [-4, -HALF - 5, 1.1], [6, -HALF - 6, 1.3], [HALF + 6, -3, 1]]) {
      const copy = tree.clone();
      copy.position.set(x, 0, z);
      copy.scale.setScalar(s);
      this.decor.add(copy);
    }
  }

  private syncItems(items: HabitatItem[]): void {
    const alive = new Set(items.map((item) => item.id));
    for (const [id, entry] of this.items) {
      if (alive.has(id)) continue;
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      this.items.delete(id);
    }
    for (const item of items) {
      const fill = item.fill === undefined ? 100 : Math.round(item.fill / 20) * 20;
      const entry = this.items.get(item.id);
      if (entry && entry.fill === fill) continue;
      if (entry) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
      }
      const mesh = new THREE.Mesh(itemGeometry(item.kind, fill), this.material);
      const at = spotCenter(item.x, item.y);
      mesh.position.set(at.x, 0, at.z);
      mesh.scale.setScalar(item.kind === "shelter" ? 1.35 : item.kind === "rock" ? 1.4 : 1.25);
      mesh.userData.item = item.id;
      mesh.castShadow = !this.low;
      mesh.receiveShadow = true;
      this.items.set(item.id, { mesh, fill });
      this.scene.add(mesh);
    }
  }

  frame(dt: number): void {
    this.time += dt;
    setWindTime(this.time);
    // Follow the selected animal (Zoo-Tycoon style); stay there after deselecting.
    const chosen = this.selected >= 0 ? this.poses.get(this.selected) : undefined;
    if (chosen) {
      const k = Math.min(1, dt * 2.5);
      this.focus.x += (chosen.x * 0.8 - this.focus.x) * k;
      this.focus.z += (chosen.z * 0.8 + 0.6 - this.focus.z) * k;
    }
    const target = this.focus;
    // Portrait (mobile): step back and look more from above so the whole habitat fits.
    const portrait = this.camera.aspect < 0.8;
    const d = this.distance * (portrait ? 1.55 : 1);
    const lift = portrait ? 0.86 : 0.66;
    const ring = portrait ? 0.62 : 0.78;
    this.camera.position.set(target.x + Math.sin(this.azimuth) * d * ring, d * lift, target.z + Math.cos(this.azimuth) * d * ring);
    this.camera.lookAt(target);
    const local = new Map<number, Pose>();
    const ordered = [...this.animalsNow].sort((a, b) => Number(a.mother !== undefined) - Number(b.mother !== undefined) || a.id - b.id);
    for (const animal of ordered) {
      const view = this.animals.get(animal.id);
      if (!view) continue;
      const scale = growthScale(animal, this.tick) * view.boost;
      const young = growthScale(animal, this.tick) < animal.genes.size * 0.95;
      const mother = young && animal.mother !== undefined ? local.get(animal.mother) : undefined;
      const geo = animalGeometry(animal.species);
      const radius = HALF - 0.6 - (geo.model.lod[2] * scale) / 2;
      const raw = wanderPose(animal, this.time * 2, Math.max(1, radius), scale, mother);
      local.set(animal.id, raw);
      let y = raw.y;
      let spin = 0;
      let squash = 1;
      const react = view.react;
      if (react && this.time < react.until) {
        const k = (this.time - react.start) / (react.until - react.start);
        if (react.kind === "play") {
          y += Math.sin(k * Math.PI * 2) ** 2 * 0.9;
          spin = k * Math.PI * 2;
        } else if (react.kind === "pet") squash = 1 + Math.sin(k * Math.PI * 6) * 0.06;
        else if (react.kind === "feed") view.group.rotation.x = Math.sin(k * Math.PI * 4) * 0.12;
      } else if (react) {
        view.react = null;
        view.group.rotation.x = 0;
      }
      // Selected animals stand still so they are easy to click and inspect.
      const pose = this.selected === animal.id ? (this.poses.get(animal.id) ?? raw) : raw;
      view.group.position.set(pose.x, y, pose.z);
      view.group.rotation.y = pose.heading + spin;
      view.group.rotation.z = pose.roll;
      view.group.scale.set(scale, scale * squash, scale);
      this.poses.set(animal.id, { ...pose, y, boost: scale });
    }
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      const age = this.time - burst.born;
      if (age < 0) {
        burst.sprite.visible = false;
        continue;
      }
      burst.sprite.visible = true;
      burst.sprite.position.y += dt * 1.6;
      burst.sprite.position.x += burst.vx * dt;
      burst.sprite.position.z += burst.vz * dt;
      (burst.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - age / 1.3);
      if (age > 1.3) {
        this.scene.remove(burst.sprite);
        (burst.sprite.material as THREE.SpriteMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
    if (!this.fx.render(this.scene, this.camera, { focus: this.focus, sun: this.sun, hazeRange: [1.2, 3.5], hazeAmount: 0.3 })) this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px) of a world point, for name tags and tests. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z > -1 && v.z < 1 };
  }

  spotScreen(x: number, y: number): { x: number; y: number } {
    const at = spotCenter(x, y);
    return this.project(at.x, 0, at.z);
  }

  private pointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private spotAt(event: PointerEvent): { x: number; y: number } | null {
    this.pointer(event);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const x = Math.floor((hit.x + HALF) / SPOT);
    const y = Math.floor((hit.z + HALF) / SPOT);
    if (x < 0 || y < 0 || x >= ITEM_GRID || y >= ITEM_GRID) return null;
    return { x, y };
  }

  private hover(event: PointerEvent): void {
    if (!this.tool || this.tool === "remove") {
      this.ghost.visible = false;
      return;
    }
    const spot = this.spotAt(event);
    this.ghost.visible = spot !== null;
    if (spot) {
      const at = spotCenter(spot.x, spot.y);
      this.ghost.position.set(at.x, 0.05, at.z);
    }
  }

  private click(event: PointerEvent): void {
    this.pointer(event);
    if (this.tool === "remove") {
      const hits = this.ray.intersectObjects([...this.items.values()].map((entry) => entry.mesh), false);
      if (hits[0]) this.hooks.pickItem(Number(hits[0].object.userData.item));
      return;
    }
    if (this.tool) {
      const spot = this.spotAt(event);
      if (spot) this.hooks.pickSpot(spot.x, spot.y);
      return;
    }
    const targets: THREE.Object3D[] = [];
    for (const view of this.animals.values()) targets.push(view.body, view.pattern);
    const hits = this.ray.intersectObjects(targets, false);
    if (hits[0]) {
      this.hooks.pickAnimal(Number(hits[0].object.userData.animal));
      return;
    }
    // Generous fallback for small animals: nearest animal to the ground point.
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3), hit)) return;
    let best = -1;
    let bestDist = 1.6;
    for (const [id, pose] of this.poses) {
      const d = Math.hypot(pose.x - hit.x, pose.z - hit.z);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    if (best >= 0) this.hooks.pickAnimal(best);
  }

  dispose(): void {
    this.fx.dispose();
    this.dressing?.dispose();
    for (const entry of this.items.values()) entry.mesh.geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function spotCenter(x: number, y: number): { x: number; z: number } {
  return { x: -HALF + (x + 0.5) * SPOT, z: -HALF + (y + 0.5) * SPOT };
}
