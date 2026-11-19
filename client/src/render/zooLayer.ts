/**
 * Zoo animals, safari jeeps and fence visitors in the city view.
 * One InstancedMesh pair (body + pattern overlay) per species present, one block mesh for the
 * far LOD, one jeep mesh, one visitor pair. Meshes with no instances are hidden (no draw call).
 */
import * as THREE from "three";
import {
  DIRS,
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
} from "../../../shared/src/index.ts";
import { animalGeometry, buildJeepGeometry, coatTint, patternColor } from "./zooModels.ts";
import { buildPersonModels } from "./models.ts";
import { wanderPose, type Pose } from "./zooMotion.ts";

const SPECIES_CAP = 32;
const LOD_CAP = 80;
const JEEP_CAP = 24;
const VISITOR_CAP = 120;
/** Beyond this camera distance animals are drawn as simple blocks. */
export const ZOO_LOD_DISTANCE = 120;
const INNER = 3.05;
const TRACK = 3.9;
const CLOTHES = [0x3d88c8, 0xe24a32, 0xf0b43c, 0x3d8a4a, 0xa85a8a, 0xf2efe8, 0x2a3e5c, 0xe98a5a];

interface Site {
  cell: number;
  type: string;
  x: number;
  y: number;
  z: number;
  animals: Animal[];
  /** Outward unit vectors toward neighbouring roads (visitor spots). */
  roads: { dx: number; dz: number }[];
}

export class ZooLayer {
  private readonly bodies = new Map<string, THREE.InstancedMesh>();
  private readonly patterns = new Map<string, THREE.InstancedMesh>();
  private readonly blocks: THREE.InstancedMesh;
  private readonly jeeps: THREE.InstancedMesh;
  private readonly visitorBodies: THREE.InstancedMesh;
  private readonly visitorHeads: THREE.InstancedMesh;
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private sites: Site[] = [];
  private visitors = 0;
  private tick = 0;
  private readonly camera = new THREE.Vector3(0, 1e4, 0);
  /** Latest pose per animal id (world coordinates), for picking and tests. */
  readonly poses = new Map<number, { x: number; y: number; z: number; far: boolean }>();

  constructor(private readonly scene: THREE.Scene) {
    const block = new THREE.BoxGeometry(1, 1, 1);
    block.translate(0, 0.5, 0);
    const white = new Float32Array(block.getAttribute("position").count * 3).fill(1);
    block.setAttribute("color", new THREE.BufferAttribute(white, 3));
    this.blocks = this.instanced(block, LOD_CAP);
    this.jeeps = this.instanced(buildJeepGeometry(), JEEP_CAP);
    const person = buildPersonModels().find((model) => model.key === "idle")!;
    this.visitorBodies = this.instanced(person.body, VISITOR_CAP);
    this.visitorHeads = this.instanced(person.head, VISITOR_CAP);
  }

  private instanced(geometry: THREE.BufferGeometry, cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  private speciesMeshes(species: string): { body: THREE.InstancedMesh; pattern: THREE.InstancedMesh } {
    let body = this.bodies.get(species);
    let pattern = this.patterns.get(species);
    if (!body || !pattern) {
      const geo = animalGeometry(species);
      body = this.instanced(geo.body, SPECIES_CAP);
      pattern = this.instanced(geo.pattern, SPECIES_CAP);
      this.bodies.set(species, body);
      this.patterns.set(species, pattern);
    }
    return { body, pattern };
  }

  /** Rebuild the habitat list after a state change. */
  sync(city: CityState, heightOf: (index: number) => number): void {
    const zoo: ZooState | undefined = city.progress?.zoo;
    this.tick = city.tick;
    this.visitors = zoo?.visitors ?? 0;
    this.sites = [];
    if (!zoo) return;
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
  }

  setCamera(position: THREE.Vector3): void {
    this.camera.copy(position);
  }

  get drawMeshes(): number {
    let n = 0;
    for (const mesh of [...this.bodies.values(), ...this.patterns.values(), this.blocks, this.jeeps, this.visitorBodies, this.visitorHeads]) if (mesh.visible) n += 1;
    return n;
  }

  update(time: number): void {
    const bodyCount = new Map<string, number>();
    let blocks = 0;
    let jeeps = 0;
    let people = 0;
    this.poses.clear();
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
        const pose = wanderPose(animal, time, radius, scale, mother);
        local.set(animal.id, pose);
        const wx = site.x + pose.x;
        const wz = site.z + pose.z;
        const wy = site.y + 0.25 + pose.y;
        const dx = wx - this.camera.x;
        const dy = wy - this.camera.y;
        const dz = wz - this.camera.z;
        const far = dx * dx + dy * dy + dz * dz > ZOO_LOD_DISTANCE * ZOO_LOD_DISTANCE;
        this.poses.set(animal.id, { x: wx, y: wy, z: wz, far });
        if (far) {
          if (blocks >= LOD_CAP) continue;
          const [w, h, l] = geo.model.lod;
          this.dummy.position.set(wx, wy, wz);
          this.dummy.rotation.set(0, pose.heading, 0);
          this.dummy.scale.set(w * scale * 0.8, h * scale * 0.75, l * scale * 0.8);
          this.dummy.updateMatrix();
          this.blocks.setMatrixAt(blocks, this.dummy.matrix);
          this.blocks.setColorAt(blocks, this.color.setHex(info.color).multiply(coatTint(animal.genes.hue)));
          blocks += 1;
          continue;
        }
        const slot = bodyCount.get(animal.species) ?? 0;
        if (slot >= SPECIES_CAP) continue;
        const meshes = this.speciesMeshes(animal.species);
        this.dummy.position.set(wx, wy, wz);
        this.dummy.rotation.set(0, pose.heading, pose.roll);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        meshes.body.setMatrixAt(slot, this.dummy.matrix);
        meshes.pattern.setMatrixAt(slot, this.dummy.matrix);
        meshes.body.setColorAt(slot, coatTint(animal.genes.hue, this.color));
        meshes.pattern.setColorAt(slot, patternColor(info.color, geo.model, animal.genes.hue, animal.genes.pattern, this.color));
        bodyCount.set(animal.species, slot + 1);
      }
      if (site.animals.length === 0) continue;
      // Safari jeep on the inner track (not in the petting meadow).
      if (site.type !== "wiese" && jeeps < JEEP_CAP) {
        const perimeter = TRACK * 8;
        const s = ((time * 1.4 + site.cell * 3.7) % perimeter + perimeter) % perimeter;
        const side = Math.floor(s / (TRACK * 2));
        const along = (s % (TRACK * 2)) - TRACK;
        const [px, pz, heading] =
          side === 0 ? [along, -TRACK, Math.PI / 2] : side === 1 ? [TRACK, along, 0] : side === 2 ? [-along, TRACK, -Math.PI / 2] : [-TRACK, -along, Math.PI];
        this.dummy.position.set(site.x + px, site.y + 0.25 + Math.abs(Math.sin(time * 9 + site.cell)) * 0.03, site.z + pz);
        this.dummy.rotation.set(0, heading, 0);
        this.dummy.scale.setScalar(0.85);
        this.dummy.updateMatrix();
        this.jeeps.setMatrixAt(jeeps, this.dummy.matrix);
        this.jeeps.setColorAt(jeeps, this.color.setHex(0xffffff));
        jeeps += 1;
      }
      // Visitors at the fence on the road side; more visitors → more people.
      const share = this.visitors / Math.max(1, populated);
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
        this.dummy.updateMatrix();
        this.visitorBodies.setMatrixAt(people, this.dummy.matrix);
        this.visitorHeads.setMatrixAt(people, this.dummy.matrix);
        this.visitorBodies.setColorAt(people, this.color.setHex(CLOTHES[(k + site.cell) % CLOTHES.length]));
        this.visitorHeads.setColorAt(people, this.color.setHex(0xffffff));
        people += 1;
      }
    }
    for (const [species, mesh] of this.bodies) this.finish(mesh, bodyCount.get(species) ?? 0);
    for (const [species, mesh] of this.patterns) this.finish(mesh, bodyCount.get(species) ?? 0);
    this.finish(this.blocks, blocks);
    this.finish(this.jeeps, jeeps);
    this.finish(this.visitorBodies, people);
    this.finish(this.visitorHeads, people);
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Counts for tests and the perf probe. */
  stats(): { animals: number; far: number; jeeps: number; visitors: number; meshes: number } {
    let far = 0;
    for (const pose of this.poses.values()) if (pose.far) far += 1;
    return { animals: this.poses.size, far, jeeps: this.jeeps.count, visitors: this.visitorBodies.count, meshes: this.drawMeshes };
  }
}
