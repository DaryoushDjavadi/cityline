import * as THREE from "three";
import { CELL_SIZE, ServiceKind, Zone, cellCoords, cellToWorld, isRoad, type CityState } from "../../../shared/src/index.ts";

/**
 * Ambient life that has no simulation meaning: residents chatting in front of
 * houses, park visitors, queues at the Ferris wheel, chimney smoke and birds.
 * Everything is instanced; per-frame work is a handful of matrix writes.
 */

export interface Lingerer {
  x: number;
  y: number;
  z: number;
  rotY: number;
  pose: "idle" | "sit";
  color: number;
  child: boolean;
  phase: number;
}

export interface SmokeSource {
  x: number;
  y: number;
  z: number;
  phase: number;
  size: number;
  puffs: number;
  tint: number;
}

interface Flock {
  x: number;
  z: number;
  y: number;
  radius: number;
  speed: number;
  birds: number;
  phase: number;
  gull: boolean;
}

const CLOTHES = [0xd45a3c, 0x2f7d9a, 0x3d8a4a, 0xa85a8a, 0xe2a03a, 0x3d4a8a, 0xf2efe8, 0x7a5a9a, 0xe27a5a];
const DIRS = [
  { dx: 0, dy: 1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
];

function mix(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Population-dependent multiplier for street traffic (more people → busier streets). */
export function crowdScale(population: number): number {
  return Math.max(0.75, Math.min(1.6, 0.75 + population / 1800));
}

/** Chimney tops (local model space; models are not rotated). */
const CHIMNEYS: Record<string, { x: number; y: number; z: number; size: number; puffs: number; tint: number }[]> = {
  cottage: [{ x: 1.7, y: 4.75, z: 0.4, size: 0.55, puffs: 3, tint: 0xf4f0ea }],
  workshop: [{ x: 2.3, y: 5.8, z: -1.4, size: 0.7, puffs: 3, tint: 0xe6e2dc }],
  factory: [
    { x: 2.4, y: 9.9, z: -2.2, size: 1, puffs: 4, tint: 0xd8d4d0 },
    { x: -2.6, y: 8.3, z: -2.2, size: 0.7, puffs: 3, tint: 0xe6e2dc },
  ],
  plant: [{ x: -3.1, y: 11.5, z: -1.6, size: 1.2, puffs: 4, tint: 0xd2cec8 }],
  power: [{ x: 2.2, y: 12.3, z: -0.6, size: 1.2, puffs: 6, tint: 0xeeeae4 }],
};

function chimneyKey(city: CityState, index: number): string | null {
  if (city.services[index] === ServiceKind.Power) return "power";
  const level = city.levels[index];
  if (level <= 0) return null;
  if (city.zones[index] === Zone.Residential && level <= 2) return "cottage";
  if (city.zones[index] === Zone.Industrial) return level <= 2 ? "workshop" : level <= 4 ? "factory" : "plant";
  return null;
}

function roadSide(city: CityState, index: number): { dx: number; dy: number } | null {
  const { x, y } = cellCoords(city, index);
  for (const dir of DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
    if (isRoad(city, ny * city.width + nx)) return dir;
  }
  return null;
}

export interface AmbientPlan {
  people: Lingerer[];
  smoke: SmokeSource[];
  flocks: Flock[];
}

/**
 * Rebuilt only when the city changes (or every in-game hour for the crowd mix).
 * `activity` is the climate street activity (high by day, low at night).
 */
export function planAmbient(
  city: CityState,
  heightOf: (index: number) => number,
  activity: number,
  budget: { people: number; smoke: number; flocks: number },
  night: boolean,
): AmbientPlan {
  const people: Lingerer[] = [];
  const smoke: SmokeSource[] = [];
  const parks: number[] = [];
  const harbors: number[] = [];
  let sumX = 0;
  let sumZ = 0;
  let built = 0;
  const shift = Math.floor(city.tick / 50);
  const count = city.width * city.height;
  const chance = Math.round(14 + activity * 50);
  let smokePuffs = 0;

  const add = (entry: Lingerer) => {
    if (people.length < budget.people) people.push(entry);
  };

  for (let index = 0; index < count; index += 1) {
    const service = city.services[index];
    const key = chimneyKey(city, index);
    if (key && smokePuffs < budget.smoke) {
      // Not every cottage burns a fire; industry always smokes.
      if (key !== "cottage" || mix(index * 7 + 3) % 3 === 0) {
        const { x, y } = cellCoords(city, index);
        const world = cellToWorld(city, x, y);
        const gy = heightOf(index);
        for (const top of CHIMNEYS[key]) {
          smoke.push({ x: world.x + top.x, y: gy + top.y - 0.4 - top.size * 0.8, z: world.z + top.z, phase: (mix(index * 13) % 100) / 100, size: top.size, puffs: top.puffs, tint: top.tint });
          smokePuffs += top.puffs;
        }
      }
    }
    if (service === ServiceKind.Park) parks.push(index);
    if (service === ServiceKind.Harbor) harbors.push(index);
    if (city.levels[index] > 0 || service !== ServiceKind.None) {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      sumX += world.x;
      sumZ += world.z;
      built += 1;
    }

    // Residents in front of their houses.
    if (city.zones[index] === Zone.Residential && city.levels[index] > 0) {
      const roll = mix(index * 31 + shift) % 100;
      if (roll >= chance) continue;
      const side = roadSide(city, index);
      if (!side) continue;
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      const gy = heightOf(index);
      const front = CELL_SIZE * 0.38;
      const lat = { x: -side.dy, z: side.dx };
      const pair = city.levels[index] >= 2 || roll % 2 === 0 ? 2 : 1;
      for (let k = 0; k < pair; k += 1) {
        const spread = (k === 0 ? -1 : 1) * (pair === 2 ? 0.75 : 0) + ((roll % 5) - 2) * 0.3;
        const px = world.x + side.dx * front + lat.x * spread;
        const pz = world.z + side.dy * front + lat.z * spread;
        // Pairs face each other, singles look at the street.
        const face = pair === 2 ? Math.atan2(-lat.x * (k === 0 ? -1 : 1), -lat.z * (k === 0 ? -1 : 1)) : Math.atan2(side.dx, side.dy);
        const child = !night && k === 1 && roll % 3 === 0;
        add({ x: px, y: gy, z: pz, rotY: face, pose: "idle", color: CLOTHES[mix(index * 5 + k) % CLOTHES.length], child, phase: (roll + k * 17) / 10 });
      }
    }
  }

  const ringAt = (index: number, n: number, radius: number, sitShare: number, salt: number) => {
    const { x, y } = cellCoords(city, index);
    const world = cellToWorld(city, x, y);
    const gy = heightOf(index);
    for (let k = 0; k < n; k += 1) {
      const h = mix(index * 97 + k * 11 + salt + shift);
      const angle = (k / n) * Math.PI * 2 + (h % 60) / 60;
      const r = radius * (0.65 + ((h >>> 8) % 40) / 100);
      const px = world.x + Math.cos(angle) * r;
      const pz = world.z + Math.sin(angle) * r;
      const pose = (h % 100) / 100 < sitShare ? "sit" : "idle";
      // Face inward (towards the attraction / each other).
      const rotY = Math.atan2(world.x - px, world.z - pz) + (((h >>> 4) % 7) - 3) * 0.12;
      add({ x: px, y: gy + (pose === "sit" ? 0.02 : 0), z: pz, rotY, pose, color: CLOTHES[h % CLOTHES.length], child: !night && h % 5 === 0, phase: (h % 100) / 13 });
    }
  };

  const crowd = (base: number) => Math.max(night ? 1 : 2, Math.round(base * (0.3 + activity * 0.9)));
  for (const park of parks) ringAt(park, crowd(6), CELL_SIZE * 0.34, 0.45, 1);
  for (let index = 0; index < count; index += 1) {
    const service = city.services[index];
    if (service === ServiceKind.Wheel) {
      // Queue in front of the wheel plus onlookers.
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      const gy = heightOf(index);
      const queue = crowd(7);
      for (let k = 0; k < queue; k += 1) {
        add({ x: world.x - 2.6 + k * 0.95, y: gy, z: world.z + CELL_SIZE * 0.42, rotY: -Math.PI / 2, pose: "idle", color: CLOTHES[mix(index + k * 3) % CLOTHES.length], child: !night && k % 3 === 1, phase: k * 0.7 });
      }
      ringAt(index, crowd(4), CELL_SIZE * 0.5, 0, 7);
    } else if (service === ServiceKind.CityHall) {
      ringAt(index, crowd(9), CELL_SIZE * 0.5, 0.15, 3);
    } else if (service === ServiceKind.Tower) {
      ringAt(index, crowd(5), CELL_SIZE * 0.48, 0, 5);
    }
  }

  const flocks: Flock[] = [];
  if (built > 0 && budget.flocks > 0) {
    const cx = sumX / built;
    const cz = sumZ / built;
    flocks.push({ x: cx, z: cz, y: 30, radius: 26, speed: 0.22, birds: 7, phase: 0, gull: false });
    for (const harbor of harbors.slice(0, 2)) {
      const { x, y } = cellCoords(city, harbor);
      const world = cellToWorld(city, x, y);
      flocks.push({ x: world.x, z: world.z, y: 16, radius: 14, speed: 0.34, birds: 6, phase: harbor % 7, gull: true });
    }
    for (const park of parks.slice(0, 2)) {
      const { x, y } = cellCoords(city, park);
      const world = cellToWorld(city, x, y);
      flocks.push({ x: world.x, z: world.z, y: 20, radius: 12, speed: -0.3, birds: 5, phase: park % 5, gull: false });
    }
  }
  return { people, smoke, flocks: flocks.slice(0, budget.flocks) };
}

function birdGeometry(): THREE.BufferGeometry {
  // Two wings in a shallow V; flapping animates the Y scale.
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.35, -1.4, 0.35, -0.15, 0, 0, -0.35,
    0, 0, 0.35, 0, 0, -0.35, 1.4, 0.35, -0.15,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

export class AmbientLayer {
  readonly smoke: THREE.InstancedMesh;
  readonly birds: THREE.InstancedMesh;
  private plan: AmbientPlan = { people: [], smoke: [], flocks: [] };
  private readonly dummy = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private birdsShown = 1;

  constructor(scene: THREE.Scene, smokeCap = 160, birdCap = 48) {
    const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.58, depthWrite: false, flatShading: true });
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), smokeMat, smokeCap);
    this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(smokeCap * 3), 3);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 4;
    const birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: true });
    this.birds = new THREE.InstancedMesh(birdGeometry(), birdMat, birdCap);
    this.birds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(birdCap * 3), 3);
    this.birds.count = 0;
    this.birds.frustumCulled = false;
    scene.add(this.smoke, this.birds);
  }

  setPlan(plan: AmbientPlan): void {
    this.plan = plan;
  }

  get people(): readonly Lingerer[] {
    return this.plan.people;
  }

  /** `day` 0..1 (birds roost at night). */
  paint(time: number, day: number, smokeOn: boolean, birdsOn: boolean): void {
    let slot = 0;
    const cap = this.smoke.instanceMatrix.count;
    if (smokeOn) {
      for (const source of this.plan.smoke) {
        for (let k = 0; k < source.puffs && slot < cap; k += 1) {
          const t = (time * (0.16 / source.size) + source.phase + k / source.puffs) % 1;
          const rise = t * (6 + source.size * 6);
          const grow = (0.6 + t * 1.9) * source.size;
          const fade = t > 0.7 ? Math.max(0.05, (1 - t) / 0.3) : Math.min(1, 0.6 + t * 4);
          this.dummy.position.set(source.x + t * t * 3.2 + Math.sin(time * 0.8 + k) * 0.15, source.y + rise, source.z - t * 1.2);
          this.dummy.rotation.set(t * 2 + k, t * 3, 0);
          this.dummy.scale.setScalar(Math.max(0.01, grow * fade));
          this.dummy.updateMatrix();
          this.smoke.setMatrixAt(slot, this.dummy.matrix);
          this.tint.set(source.tint).lerp(this.white, t * 0.6);
          this.smoke.setColorAt(slot, this.tint);
          slot += 1;
        }
      }
    }
    finish(this.smoke, slot);

    let birds = 0;
    const birdCap = this.birds.instanceMatrix.count;
    if (birdsOn && day > 0.05) {
      for (const flock of this.plan.flocks) {
        const n = Math.max(1, Math.round(flock.birds * Math.min(1, day * 1.4)));
        for (let k = 0; k < n && birds < birdCap; k += 1) {
          const a = time * flock.speed + flock.phase + k * 0.42;
          const wobble = Math.sin(time * 0.7 + k * 1.3) * 3;
          const r = flock.radius + wobble + (k % 3) * 2.2;
          const x = flock.x + Math.cos(a) * r;
          const z = flock.z + Math.sin(a) * r;
          const y = flock.y + Math.sin(time * 0.9 + k) * 1.6 + (k % 2) * 1.2;
          const heading = Math.atan2(-Math.sin(a) * Math.sign(flock.speed), Math.cos(a) * Math.sign(flock.speed));
          const flap = Math.sin(time * (flock.gull ? 5 : 9) + k * 1.7);
          const s = flock.gull ? 0.95 : 0.7;
          this.dummy.position.set(x, y, z);
          this.dummy.rotation.set(0, heading, Math.sin(a) * 0.1);
          this.dummy.scale.set(s, flap * 1.6 * s, s);
          this.dummy.updateMatrix();
          this.birds.setMatrixAt(birds, this.dummy.matrix);
          this.tint.set(flock.gull ? 0xf6f4ee : 0x3a3640);
          this.birds.setColorAt(birds, this.tint);
          birds += 1;
        }
      }
    }
    finish(this.birds, birds);
    this.birdsShown = birds;
  }

  stats(): { smoke: number; birds: number; people: number } {
    return { smoke: this.smoke.count, birds: this.birdsShown, people: this.plan.people.length };
  }
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  const before = mesh.count;
  mesh.count = count;
  if (count === 0 && before === 0) return;
  const used = Math.max(1, count);
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, used * 16);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.clearUpdateRanges();
    mesh.instanceColor.addUpdateRange(0, used * 3);
    mesh.instanceColor.needsUpdate = true;
  }
}
