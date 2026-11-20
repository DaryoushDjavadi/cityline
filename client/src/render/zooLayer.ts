/**
 * Zoo animals, safari jeeps and fence visitors in the city view.
 * Everything is ONE BatchedMesh (one draw call): per species a body and a pattern-overlay
 * geometry, a block geometry for the far LOD, the jeep and visitor bodies/heads.
 * Instances are pooled per geometry; unused ones are hidden.
 */
import * as THREE from "three";
import {
  DIRS,
  SPECIES,
  cellCoords,
  cellToWorld,
  growthScale,
  habitatTypeOf,
  inBounds,
  cellIndex,
  isRoad,
  speciesInfo,
  type Animal,
  type CityState,
  type ZooState,
  TIERPARK_KIND,
} from "../../../shared/src/index.ts";
import { animalGeometry, buildJeepGeometry, coatTint, patternColor } from "./zooModels.ts";
import { buildPersonModels } from "./models.ts";
import { wanderPose, type Pose } from "./zooMotion.ts";
import { rng, setWindTime, swayMaterial, tuftGeometry, type DecorType } from "./zooDecor.ts";
import { gfxProfile, loadGfxPreset } from "./quality.ts";


const SPECIES_CAP = 32;
const LOD_CAP = 80;
const JEEP_CAP = 24;
const VISITOR_CAP = 120;
/** Beyond this camera distance animals are drawn as simple blocks. */
export const ZOO_LOD_DISTANCE = 120;
const INNER = 3.05;
const TRACK = 3.9;
const CLOTHES = [0x3d88c8, 0xe24a32, 0xf0b43c, 0x3d8a4a, 0xa85a8a, 0xf2efe8, 0x2a3e5c, 0xe98a5a];

export interface ZooSite {
  cell: number;
  type: string;
  x: number;
  y: number;
  z: number;
  animals: Animal[];
  /** Outward unit vectors toward neighbouring roads (visitor spots). */
  roads: { dx: number; dz: number }[];
  /** Tierpark gate in the city: only a queue of visitors, no animals or grass. */
  crowdOnly?: boolean;
  /** Park level: a keeper walks the habitat and refills the bowls. */
  keeper?: boolean;
}
export type Reaction = "pet" | "play" | "feed" | "vet";
type Site = ZooSite;

const GRASS_SITES = 48;
const OUTSIDE_GRASS: Record<DecorType, { colors: number[]; height: [number, number]; density: number }> = {
  savanne: { colors: [0xd8c070, 0xc8ac5c, 0xb8a050], height: [0.45, 0.75], density: 1 },
  wald: { colors: [0x4f8e3c, 0x5c9c44, 0x6aa84c], height: [0.35, 0.6], density: 0.8 },
  wasser: { colors: [0x6aa84a, 0x5c9c42, 0x78b454], height: [0.35, 0.6], density: 0.7 },
  polar: { colors: [0xc0b894, 0xd0c8a8], height: [0.25, 0.4], density: 0.25 },
  wiese: { colors: [0x6cb84a, 0x7cc858, 0x88cc60], height: [0.3, 0.5], density: 1 },
};

export class ZooLayer {
  private readonly batch: THREE.BatchedMesh;
  private readonly geo = new Map<string, number>();
  private readonly pools = new Map<number, number[]>();
  private readonly used = new Map<number, number>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private sites: Site[] = [];
  private visitors = 0;
  /** City view: people queue at the Tierpark gate. Park view: real visitors walk the paths instead. */
  private fenceCrowd = true;
  private tick = 0;
  private counts = { jeeps: 0, visitors: 0 };
  private readonly camera = new THREE.Vector3(0, 1e4, 0);
  /** Latest pose per animal id (world coordinates), for picking and tests. */
  readonly poses = new Map<number, { x: number; y: number; z: number; far: boolean; heading: number; height: number }>();
  /** Selected animal stands still (for petting) at the pose it had when picked. */
  private holdId = -1;
  private held: Pose | null = null;
  private readonly reactions = new Map<number, { kind: Reaction; start: number }>();
  private now = 0;

  /** Wind-swayed grass tufts inside every habitat (one instanced draw call). */
  private readonly grass: THREE.InstancedMesh;
  private grassKey = "";
  private readonly grassPer: number;

  constructor(scene: THREE.Scene, grassPer?: number) {
    this.grassPer = grassPer ?? (gfxProfile(loadGfxPreset(), window.devicePixelRatio || 1).level === "low" ? 28 : 90);
    this.grass = new THREE.InstancedMesh(tuftGeometry(6, 9), swayMaterial(0.8), GRASS_SITES * this.grassPer);
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    scene.add(this.grass);
    const block = new THREE.BoxGeometry(1, 1, 1);
    block.translate(0, 0.5, 0);
    block.deleteAttribute("uv");
    block.setAttribute("color", new THREE.BufferAttribute(new Float32Array(block.getAttribute("position").count * 3).fill(1), 3));
    const person = buildPersonModels().find((model) => model.key === "idle")!;
    const entries: [string, THREE.BufferGeometry][] = [["block", block], ["jeep", buildJeepGeometry()], ["visitorBody", person.body], ["visitorHead", person.head]];
    for (const species of SPECIES) {
      const geo = animalGeometry(species.id);
      entries.push([`${species.id}:body`, geo.body], [`${species.id}:pattern`, geo.pattern]);
    }
    let vertices = 0;
    let indices = 0;
    for (const [, geometry] of entries) {
      vertices += geometry.getAttribute("position").count;
      indices += geometry.getIndex()?.count ?? geometry.getAttribute("position").count;
    }
    const instances = SPECIES_CAP * 2 * 6 + LOD_CAP + JEEP_CAP + VISITOR_CAP * 2;
    this.batch = new THREE.BatchedMesh(instances, vertices, indices, this.material);
    this.batch.sortObjects = false;
    this.batch.perObjectFrustumCulled = true;
    this.batch.frustumCulled = false;
    this.batch.castShadow = false;
    this.batch.receiveShadow = false;
    this.batch.visible = false;
    for (const [key, geometry] of entries) this.geo.set(key, this.batch.addGeometry(geometry));
    scene.add(this.batch);
  }

  /** Next free instance of a geometry (pooled; grows on demand). */
  private take(key: string): number | null {
    const id = this.geo.get(key);
    if (id === undefined) return null;
    let pool = this.pools.get(id);
    if (!pool) {
      pool = [];
      this.pools.set(id, pool);
    }
    const n = this.used.get(id) ?? 0;
    if (n >= pool.length) {
      if (this.batch.instanceCount >= this.batch.maxInstanceCount) return null;
      pool.push(this.batch.addInstance(id));
    }
    this.used.set(id, n + 1);
    const instance = pool[n];
    this.batch.setVisibleAt(instance, true);
    return instance;
  }

  private place(key: string, color: THREE.Color): void {
    const instance = this.take(key);
    if (instance === null) return;
    this.dummy.updateMatrix();
    this.batch.setMatrixAt(instance, this.dummy.matrix);
    this.batch.setColorAt(instance, color);
  }

  /** Rebuild the habitat list after a state change. */
  sync(city: CityState, heightOf: (index: number) => number): void {
    const zoo: ZooState | undefined = city.progress?.zoo;
    this.tick = city.tick;
    this.visitors = zoo?.visitors ?? 0;
    this.sites = [];
    if (!zoo) return;
    // Habitats live in the Tierpark level now; the city shows the gate with a queue of visitors.
    if (zoo.gate >= 0 && city.services[zoo.gate] === TIERPARK_KIND) {
      const { x, y } = cellCoords(city, zoo.gate);
      const world = cellToWorld(city, x, y);
      const roads: { dx: number; dz: number }[] = [];
      for (const dir of DIRS) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (inBounds(city, nx, ny) && isRoad(city, cellIndex(city, nx, ny))) roads.push({ dx: dir.dx, dz: dir.dy });
      }
      this.sites.push({ cell: zoo.gate, type: "wiese", x: world.x, y: heightOf(zoo.gate), z: world.z, animals: [], roads: roads.slice(0, 1), crowdOnly: true });
    }
    for (const habitat of zoo.habitats) {
      if (!habitatTypeOf(city.services[habitat.cell])) continue;
      const { x, y } = cellCoords(city, habitat.cell);
      const world = cellToWorld(city, x, y);
      const roads: { dx: number; dz: number }[] = [];
      for (const dir of DIRS) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (inBounds(city, nx, ny) && isRoad(city, cellIndex(city, nx, ny))) roads.push({ dx: dir.dx, dz: dir.dy });
      }
      this.sites.push({
        cell: habitat.cell,
        type: habitat.type,
        x: world.x,
        y: heightOf(habitat.cell),
        z: world.z,
        animals: zoo.animals.filter((animal) => animal.cell === habitat.cell),
        roads,
      });
    }
    this.plantGrass();
  }

  /** Park level: habitats placed by the park view (world coordinates of their centres). */
  setSites(sites: ZooSite[], tick: number, visitors: number): void {
    this.sites = sites;
    this.tick = tick;
    this.visitors = visitors;
    this.fenceCrowd = false;
    // The park dresses habitats itself (HabitatDressing): no extra tufts here.
    this.grass.count = 0;
    this.grassKey = "";
  }

  /** Keep one animal still (selected in the park); −1 lets it wander again. */
  hold(id: number): void {
    if (id === this.holdId) return;
    this.holdId = id;
    this.held = null;
  }

  /** Little hop / spin / squash when the animal is petted, played with, fed or treated. */
  react(id: number, kind: Reaction): void {
    this.reactions.set(id, { kind, start: this.now });
  }

  /** Re-scatter grass only when the set of habitats (or their height) changed. */
  private plantGrass(): void {
    const key = this.sites.map((site) => `${site.cell}:${site.type}:${site.y.toFixed(2)}`).join("|");
    if (key === this.grassKey) return;
    this.grassKey = key;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let n = 0;
    for (const site of this.sites.filter((entry) => !entry.crowdOnly).slice(0, GRASS_SITES)) {
      const random = rng(site.cell * 31 + 7);
      const look = OUTSIDE_GRASS[site.type as DecorType];
      const want = Math.round(this.grassPer * look.density);
      for (let k = 0, tries = 0; k < want && tries < want * 5; tries += 1) {
        // inside the safari track, plus a band along the fence
        const band = random() < 0.3;
        let x: number;
        let z: number;
        if (band) {
          const t = (random() * 2 - 1) * 4.3;
          const d = 4.1 + random() * 0.35;
          const side = Math.floor(random() * 4);
          [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
        } else {
          x = (random() * 2 - 1) * 3.3;
          z = (random() * 2 - 1) * 3.3;
        }
        if (site.type === "wasser" && Math.abs(x - 0.2) < 2.95 && Math.abs(z - 0.1) < 2.65) continue;
        if (site.type === "polar" && Math.abs(x + 0.6) < 2.35 && Math.abs(z - 0.6) < 1.95) continue;
        const h = look.height[0] + random() * (look.height[1] - look.height[0]);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2);
        s.set(h * (0.9 + random() * 0.4), h, h * (0.9 + random() * 0.4));
        p.set(site.x + x, site.y + 0.24, site.z + z);
        this.grass.setMatrixAt(n, m.compose(p, q, s));
        this.grass.setColorAt(n, c.setHex(look.colors[Math.floor(random() * look.colors.length)]).multiplyScalar(0.9 + random() * 0.2));
        n += 1;
        k += 1;
      }
    }
    this.grass.count = n;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
  }

  setCamera(position: THREE.Vector3): void {
    this.camera.copy(position);
  }

  update(time: number): void {
    this.now = time;
    setWindTime(time);
    this.used.clear();
    this.poses.clear();
    let jeeps = 0;
    let people = 0;
    const populated = this.sites.filter((site) => site.animals.length > 0).length;
    for (const site of this.sites) {
      const local = new Map<number, Pose>();
      // mothers first so the young can follow
      const ordered = [...site.animals].sort((a, b) => Number(a.mother !== undefined) - Number(b.mother !== undefined) || a.id - b.id);
      for (const animal of ordered) {
        const info = speciesInfo(animal.species);
        if (!info) continue;
        const scale = growthScale(animal, this.tick);
        const geo = animalGeometry(animal.species);
        const radius = Math.max(0.4, INNER - (geo.model.lod[2] * scale) / 2);
        const young = scale < animal.genes.size * 0.95;
        const mother = young && animal.mother !== undefined ? local.get(animal.mother) : undefined;
        let pose = wanderPose(animal, time, radius, scale, mother);
        if (animal.id === this.holdId) {
          // Stand still where it was picked, head slightly bobbing.
          if (!this.held) this.held = { ...pose, y: 0, roll: 0 };
          pose = { ...this.held, y: 0, roll: 0, heading: this.held.heading + Math.sin(time * 0.8) * 0.12 };
        }
        local.set(animal.id, pose);
        let reactY = 0;
        let spin = 0;
        let squash = 1;
        const reaction = this.reactions.get(animal.id);
        if (reaction) {
          const t = time - reaction.start;
          if (t > 1.4 || t < 0) this.reactions.delete(animal.id);
          else if (reaction.kind === "play") spin = Math.min(1, t / 0.9) * Math.PI * 2;
          else if (reaction.kind === "feed") squash = 1 - Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.18 * Math.max(0, 1 - t);
          else reactY = Math.max(0, Math.sin(t * 7)) * 0.28 * scale * Math.max(0, 1 - t / 1.4);
        }
        const wx = site.x + pose.x;
        const wz = site.z + pose.z;
        const wy = site.y + 0.25 + pose.y + reactY;
        const dx = wx - this.camera.x;
        const dy = wy - this.camera.y;
        const dz = wz - this.camera.z;
        const far = dx * dx + dy * dy + dz * dz > ZOO_LOD_DISTANCE * ZOO_LOD_DISTANCE;
        this.poses.set(animal.id, { x: wx, y: wy, z: wz, far, heading: pose.heading, height: geo.model.lod[1] * scale });
        this.dummy.position.set(wx, wy, wz);
        if (far) {
          const [w, h, l] = geo.model.lod;
          this.dummy.rotation.set(0, pose.heading, 0);
          this.dummy.scale.set(w * scale * 0.8, h * scale * 0.75, l * scale * 0.8);
          this.place("block", this.color.setHex(info.color).multiply(coatTint(animal.genes.hue)));
          continue;
        }
        this.dummy.rotation.set(0, pose.heading + spin, pose.roll);
        this.dummy.scale.set(scale * (2 - squash), scale * squash, scale * (2 - squash));
        this.place(`${animal.species}:body`, coatTint(animal.genes.hue, this.color));
        this.place(`${animal.species}:pattern`, patternColor(info.color, geo.model, animal.genes.hue, animal.genes.pattern, this.color));
      }
      if (site.keeper && !this.fenceCrowd && people < VISITOR_CAP) {
        // Keeper in green walks a slow round past the bowls.
        const a = time * 0.22 + site.cell;
        const r = 2.2 + Math.sin(time * 0.13 + site.cell) * 0.9;
        this.dummy.position.set(site.x + Math.cos(a) * r, site.y + 0.27, site.z + Math.sin(a) * r);
        this.dummy.rotation.set(0, -a, 0);
        this.dummy.scale.setScalar(0.92);
        this.place("visitorBody", this.color.setHex(0x3f7a3a));
        this.place("visitorHead", this.color.setHex(0xffffff));
        people += 1;
      }
      if (site.animals.length === 0 && !site.crowdOnly) continue;
      if (site.crowdOnly && this.visitors <= 0) continue;
      // Safari jeep on the inner track (not in the petting meadow).
      if (!site.crowdOnly && site.type !== "wiese" && jeeps < JEEP_CAP) {
        const perimeter = TRACK * 8;
        const s = ((time * 1.4 + site.cell * 3.7) % perimeter + perimeter) % perimeter;
        const side = Math.floor(s / (TRACK * 2));
        const along = (s % (TRACK * 2)) - TRACK;
        const [px, pz, heading] =
          side === 0 ? [along, -TRACK, Math.PI / 2] : side === 1 ? [TRACK, along, 0] : side === 2 ? [-along, TRACK, -Math.PI / 2] : [-TRACK, -along, Math.PI];
        this.dummy.position.set(site.x + px, site.y + 0.25 + Math.abs(Math.sin(time * 9 + site.cell)) * 0.03, site.z + pz);
        this.dummy.rotation.set(0, heading, 0);
        this.dummy.scale.setScalar(0.85);
        this.place("jeep", this.color.setHex(0xffffff));
        jeeps += 1;
      }
      // Visitors at the fence on the road side; more visitors → more people.
      if (!this.fenceCrowd) continue;
      const share = site.crowdOnly ? this.visitors : this.visitors / Math.max(1, populated);
      const crowd = Math.max(1, Math.min(6, Math.round(share / 5)));
      for (let k = 0; k < crowd && site.roads.length > 0 && people < VISITOR_CAP; k += 1) {
        const road = site.roads[k % site.roads.length];
        const spread = ((k * 2.3 + site.cell * 0.7) % 6) - 3;
        const sway = Math.sin(time * 0.6 + k * 1.7 + site.cell) * 0.35;
        const px = road.dx * 5.25 + (road.dz !== 0 ? spread + sway : 0);
        const pz = road.dz * 5.25 + (road.dx !== 0 ? spread + sway : 0);
        this.dummy.position.set(site.x + px, site.y + 0.12, site.z + pz);
        this.dummy.rotation.set(0, Math.atan2(-road.dx, -road.dz), 0);
        this.dummy.scale.setScalar(0.92);
        this.place("visitorBody", this.color.setHex(CLOTHES[(k + site.cell) % CLOTHES.length]));
        this.place("visitorHead", this.color.setHex(0xffffff));
        people += 1;
      }
    }
    // Hide pooled instances that were not used this frame.
    let any = false;
    for (const [id, pool] of this.pools) {
      const n = this.used.get(id) ?? 0;
      if (n > 0) any = true;
      for (let i = n; i < pool.length; i += 1) this.batch.setVisibleAt(pool[i], false);
    }
    this.batch.visible = any;
    this.counts = { jeeps, visitors: people };
  }

  /** Counts for tests and the perf probe. */
  stats(): { animals: number; far: number; jeeps: number; visitors: number; meshes: number; grass: number } {
    let far = 0;
    for (const pose of this.poses.values()) if (pose.far) far += 1;
    return { animals: this.poses.size, far, jeeps: this.counts.jeeps, visitors: this.counts.visitors, meshes: (this.batch.visible ? 1 : 0) + (this.grass.count > 0 ? 1 : 0), grass: this.grass.count };
  }
}
