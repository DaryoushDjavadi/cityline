import * as THREE from "three";
import {
  CELL_SIZE,
  DIRS,
  GRID_SIZE,
  POWER_BIT,
  ServiceKind,
  WATER_BIT,
  Zone,
  cellCoords,
  cellToWorld,
  inBounds,
  computeTraffic,
  helpBadges,
  isBridge,
  isLine,
  isPipe,
  isRoad,
  isWater,
  type CityState,
} from "../../../shared/src/index.ts";
import { streetCars, type StreetCar } from "../../../shared/src/people.ts";
import { buildModels, buildPlaneGeometry, modelForService, modelForZone } from "./models.ts";

const CORNER_ROT: Record<number, number> = {
  3: 0,
  9: Math.PI / 2,
  12: Math.PI,
  6: -Math.PI / 2,
};

const CAP = GRID_SIZE * GRID_SIZE;

interface Walker {
  id: string;
  home: number;
  surname: string;
  driver: string;
  members: string;
  label: string;
  from: number;
  to: number;
  t: number;
  speed: number;
  color: number;
  x: number;
  z: number;
}

interface Overlays {
  zones: boolean;
  power: boolean;
  water: boolean;
}

interface Flight {
  cell: number;
  phase: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export class CityRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly dummy = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  private readonly sun: THREE.DirectionalLight;
  private readonly buildings: THREE.InstancedMesh;
  private readonly services: THREE.InstancedMesh;
  private readonly curbs: THREE.InstancedMesh;
  private readonly asphalt: THREE.InstancedMesh;
  private readonly markings: THREE.InstancedMesh;
  private readonly zones: THREE.InstancedMesh;
  private readonly power: THREE.InstancedMesh;
  private readonly water: THREE.InstancedMesh;
  private readonly preview: THREE.InstancedMesh;
  private readonly locks: THREE.InstancedMesh;
  private readonly cars: THREE.InstancedMesh;
  private readonly corners: THREE.InstancedMesh;
  private readonly cornerCurbs: THREE.InstancedMesh;
  private readonly cables: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly pipeMesh: THREE.InstancedMesh;
  private readonly roofs: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh;
  private readonly stones: THREE.InstancedMesh;
  private readonly lakes: THREE.InstancedMesh;
  private readonly ground: THREE.Mesh;
  private readonly plot: THREE.LineSegments;
  private groundStamp = "";
  private readonly models = new Map<string, THREE.InstancedMesh>();
  private readonly modelSlot = new Map<string, number>();
  private readonly seaMaterial: THREE.ShaderMaterial;
  private seaTime = 0;
  private readonly idleBadges: THREE.Sprite[] = [];
  private readonly jobBadges: THREE.Sprite[] = [];
  private readonly idleMaterial: THREE.SpriteMaterial;
  private readonly jobMaterial: THREE.SpriteMaterial;
  private badgeTime = 0;
  private readonly hover: THREE.LineLoop;
  private readonly peerMarks: THREE.Group[] = [];
  private readonly graph = new Map<number, number[]>();
  private shown: CityState | null = null;
  private walkers: Walker[] = [];
  private roadStamp = "";
  private traffic: Uint8Array<ArrayBufferLike> = new Uint8Array(CAP);
  private readonly planes: THREE.InstancedMesh;
  private flights: Flight[] = [];
  private flightTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x9eb9c9);
    this.scene.fog = new THREE.Fog(0x9eb9c9, 420, 1500);

    const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x3d6470, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff4df, 1.5);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(hemi, this.sun, this.sun.target);

    const sea = new THREE.PlaneGeometry(5200, 5200, 90, 90);
    sea.rotateX(-Math.PI / 2);
    this.seaMaterial = seaMaterial();
    const ocean = new THREE.Mesh(sea, this.seaMaterial);
    ocean.position.y = -0.85;
    ocean.frustumCulled = false;
    this.scene.add(ocean);
    this.ground = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }),
    );
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 1;
    this.plot = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x31442c, transparent: true, opacity: 0.28 }),
    );
    this.plot.frustumCulled = false;
    this.scene.add(this.ground, this.plot);

    const lit = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04 });
    const flat = (color: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
      });

    const roadCap = CAP * 6;
    this.curbs = mesh(new THREE.BoxGeometry(1, 1, 1), lit, roadCap);
    this.asphalt = mesh(new THREE.BoxGeometry(1, 1, 1), lit, roadCap);
    this.markings = mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.buildings = mesh(new THREE.BoxGeometry(1, 1, 1), lit);
    this.services = mesh(new THREE.CylinderGeometry(0.5, 0.55, 1, 10), lit);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.zones = mesh(plane, flat(0xffffff, 0.42));
    this.power = mesh(plane, flat(0x7ed0ff, 0.7));
    this.water = mesh(plane, flat(0x3d7ed6, 0.65));
    this.preview = mesh(plane, flat(0xffffff, 0.72));
    this.locks = mesh(plane, flat(0xff9a3c, 0.45));
    this.cars = mesh(new THREE.BoxGeometry(1, 1, 1), lit);
    this.planes = mesh(buildPlaneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.12 }), 24);
    this.cornerCurbs = mesh(cornerGeometry(0.04, 0.96, 0.02, 0.1), lit);
    this.corners = mesh(cornerGeometry(0.11, 0.89, 0.1, 0.18), lit);
    this.cables = mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.45 }), CAP * 6);
    this.poles = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), lit);
    this.pipeMesh = mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), CAP * 6);
    this.roofs = mesh(new THREE.ConeGeometry(0.5, 1, 4), lit);
    this.trees = mesh(new THREE.ConeGeometry(0.5, 1, 6), lit);
    this.stones = mesh(new THREE.DodecahedronGeometry(0.55, 0), lit);
    this.lakes = mesh(plane, flat(0xffffff, 0.92));
    const litBuildings = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.05 });
    for (const model of buildModels()) {
      const instances = new THREE.InstancedMesh(model.geometry, litBuildings, 700);
      instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3);
      instances.count = 0;
      instances.frustumCulled = false;
      this.models.set(model.key, instances);
      this.modelSlot.set(model.key, 0);
      this.scene.add(instances);
    }
    this.idleMaterial = new THREE.SpriteMaterial({ map: personBadge(), transparent: true, depthWrite: false });
    this.jobMaterial = new THREE.SpriteMaterial({ map: jobBadge(), transparent: true, depthWrite: false });
    this.scene.add(
      this.curbs,
      this.cornerCurbs,
      this.asphalt,
      this.corners,
      this.markings,
      this.pipeMesh,
      this.zones,
      this.power,
      this.water,
      this.buildings,
      this.roofs,
      this.services,
      this.lakes,
      this.trees,
      this.stones,
      this.poles,
      this.cables,
      this.preview,
      this.locks,
      this.cars,
      this.planes,
    );

    const loop = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ]);
    this.hover = new THREE.LineLoop(loop, new THREE.LineBasicMaterial({ color: 0xf3e2b0 }));
    this.hover.scale.set(CELL_SIZE * 0.96, 1, CELL_SIZE * 0.96);
    this.hover.visible = false;
    this.scene.add(this.hover);
  }

  setPeers(peers: { x: number; z: number }[]): void {
    while (this.peerMarks.length < peers.length) {
      const mark = peerPin();
      this.scene.add(mark);
      this.peerMarks.push(mark);
    }
    this.peerMarks.forEach((mark, index) => {
      const peer = peers[index];
      if (!peer) {
        mark.visible = false;
        return;
      }
      mark.visible = true;
      mark.position.set(peer.x, 0, peer.z);
    });
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  sync(city: CityState, overlays: Overlays): void {
    this.shown = city;
    this.traffic = computeTraffic(city).load;
    if (this.roadsChanged(city)) this.rebuildGraph(city);
    this.syncCars(city);
    this.syncFlights(city);
    this.rebuildGround(city);

    let curbs = 0;
    let roads = 0;
    let bends = 0;
    let marks = 0;
    let homes = 0;
    let roofs = 0;
    let plants = 0;
    let zoneCount = 0;
    let powerCount = 0;
    let waterCount = 0;
    let cables = 0;
    let poles = 0;
    let pipes = 0;
    let trees = 0;
    let stones = 0;
    let lakes = 0;
    for (const key of this.modelSlot.keys()) this.modelSlot.set(key, 0);
    const count = city.width * city.height;

    for (let index = 0; index < count; index += 1) {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      if (isRoad(city, index) && isBridge(city, index)) {
        const laid = this.layBridge(city, x, y, world.x, world.z, curbs, roads, poles, cables);
        curbs = laid.curbs;
        roads = laid.roads;
        poles = laid.poles;
        cables = laid.cables;
      } else if (isRoad(city, index)) {
        const mask = city.roads[index] & 0b1111;
        const bend = CORNER_ROT[mask];
        const asphalt = this.asphaltColor(this.traffic[index] ?? 0);
        if (bend === undefined) {
          const laid = this.layRoad(world.x, world.z, mask, asphalt, curbs, roads);
          curbs = laid.curbs;
          roads = laid.roads;
          if (mask === 0b0101 || mask === 0b1010) {
            const east = mask === 0b1010;
            this.put(this.markings, marks, world.x, 0.18, world.z, east ? CELL_SIZE * 0.55 : CELL_SIZE * 0.07, 0.04, east ? CELL_SIZE * 0.07 : CELL_SIZE * 0.55, 0, 0xe7d7a1);
            marks += 1;
            if ((x + y) % 4 === 0) {
              this.put(this.poles, poles, world.x + (east ? 0 : 3.4), 1.1, world.z + (east ? 3.4 : 0), 0.28, 2.2, 0.28, 0, 0xded3b4);
              poles += 1;
            }
          }
        } else {
          this.put(this.cornerCurbs, bends, world.x, 0, world.z, CELL_SIZE, 1, CELL_SIZE, bend, 0x8b8172);
          this.put(this.corners, bends, world.x, 0, world.z, CELL_SIZE, 1, CELL_SIZE, bend, asphalt);
          bends += 1;
        }
      }
      if (isLine(city, index)) {
        const live = (city.utility[index] & POWER_BIT) !== 0;
        const color = live ? 0xf0c14a : 0x5c5348;
        const raised = isBridge(city, index) ? bridgeCrest(city, index) + 3.4 : isWater(city, index) ? 4.6 : 2.45;
        this.put(this.poles, poles, world.x, raised / 2, world.z, 0.35, raised, 0.35, 0, 0x6d6458);
        poles += 1;
        cables = this.layConductor(this.cables, cables, index, city.lines, world.x, world.z, raised, 0.16, color);
        if (overlays.power && live) {
          this.put(this.power, powerCount, world.x, 0.22, world.z, CELL_SIZE * 0.4, 1, CELL_SIZE * 0.4, 0, 0x8ad8ff);
          powerCount += 1;
        }
      }
      if (isPipe(city, index)) {
        const live = (city.utility[index] & WATER_BIT) !== 0;
        const color = live ? 0x3d88c8 : 0x6a7c86;
        const pipeY = isBridge(city, index) ? bridgeCrest(city, index) + 0.45 : isWater(city, index) ? 0.55 : 0.22;
        pipes = this.layConductor(this.pipeMesh, pipes, index, city.pipes, world.x, world.z, pipeY, 0.35, color);
        if (overlays.water && live) {
          this.put(this.water, waterCount, world.x, 0.24, world.z, CELL_SIZE * 0.36, 1, CELL_SIZE * 0.36, 0, 0x3f86d8);
          waterCount += 1;
        }
      }

      if (overlays.zones && city.zones[index] !== Zone.None && !isRoad(city, index)) {
        const color =
          city.zones[index] === Zone.Residential ? 0x3f9d55
          : city.zones[index] === Zone.Commercial ? 0x2f86c6
          : city.zones[index] === Zone.Farm ? 0xc4b44a
          : 0xd0892b;
        this.put(this.zones, zoneCount, world.x, 0.08, world.z, CELL_SIZE * 0.92, 1, CELL_SIZE * 0.92, 0, color);
        zoneCount += 1;
      }

      if (city.levels[index] > 0) {
        const shape = modelForZone(city.zones[index], city.levels[index]);
        if (shape) {
          const powered = (city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT);
          this.placeModel(shape.key, world.x, world.z, powered ? 0xffffff : 0x8d847c);
        }
      }

      const service = city.services[index];
      const served = modelForService(service);
      if (served) {
        const airportLit =
          service !== ServiceKind.Airport || (city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT);
        this.placeModel(served.key, world.x, world.z, airportLit ? 0xffffff : 0x8d847c);
      } else if (!isRoad(city, index) && !isLine(city, index) && !isPipe(city, index) && city.zones[index] === Zone.None && city.services[index] === ServiceKind.None && !isWater(city, index)) {
        const roll = scatter(x, y) % 19;
        const jx = ((scatter(x + 3, y) % 7) - 3) * 0.7;
        const jz = ((scatter(x, y + 5) % 7) - 3) * 0.7;
        if (roll === 0 || roll === 4 || roll === 11) {
          const tall = 2.1 + (scatter(x, y) % 5) * 0.35;
          this.put(this.trees, trees, world.x + jx, tall / 2, world.z + jz, 1.4 + (roll % 3) * 0.25, tall, 1.4, 0, roll === 4 ? 0x2f5a34 : 0x4e7d43);
          trees += 1;
        } else if (roll === 7 || roll === 15) {
          const size = 1.1 + (scatter(y, x) % 4) * 0.35;
          this.put(this.stones, stones, world.x + jx, size * 0.35, world.z + jz, size, size * 0.7, size * 0.85, (scatter(x, y) % 5) * 0.4, 0x8d877c);
          stones += 1;
        }
      }
    }

    this.finish(this.curbs, curbs);
    this.finish(this.cornerCurbs, bends);
    this.finish(this.asphalt, roads);
    this.finish(this.corners, bends);
    this.finish(this.markings, marks);
    this.finish(this.buildings, homes);
    this.finish(this.roofs, roofs);
    this.finish(this.services, plants);
    this.finish(this.zones, zoneCount);
    this.finish(this.power, powerCount);
    this.finish(this.water, waterCount);
    this.finish(this.cables, cables);
    this.finish(this.poles, poles);
    this.finish(this.pipeMesh, pipes);
    this.finish(this.trees, trees);
    this.finish(this.stones, stones);
    this.finish(this.lakes, lakes);
    for (const [key, instances] of this.models) this.finish(instances, this.modelSlot.get(key) ?? 0);
    const badges = helpBadges(city);
    this.placeBadges(this.idleBadges, this.idleMaterial, badges.homes, city);
    this.placeBadges(this.jobBadges, this.jobMaterial, badges.workplaces, city);
    this.paintCars();
    this.paintPlanes();
  }

  setPreview(city: CityState, cells: number[], legal: boolean[]): void {
    cells.forEach((index, slot) => {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      this.put(this.preview, slot, world.x, 0.28, world.z, CELL_SIZE * 0.9, 1, CELL_SIZE * 0.9, 0, legal[slot] ? 0x8ee7a0 : 0xe36d62);
    });
    this.finish(this.preview, cells.length);
  }

  setLocks(city: CityState, cells: number[]): void {
    cells.forEach((index, slot) => {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      this.put(this.locks, slot, world.x, 0.24, world.z, CELL_SIZE * 0.95, 1, CELL_SIZE * 0.95, 0, 0xff9a3c);
    });
    this.finish(this.locks, cells.length);
  }

  setHover(city: CityState, index: number | null): void {
    if (index === null) {
      this.hover.visible = false;
      return;
    }
    const { x, y } = cellCoords(city, index);
    const world = cellToWorld(city, x, y);
    this.hover.visible = true;
    this.hover.position.set(world.x, 0.3, world.z);
  }

  update(dt: number, target: THREE.Vector3): void {
    this.sun.position.set(target.x + 90, 170, target.z + 36);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    this.seaTime += dt;
    this.seaMaterial.uniforms.uTime.value = this.seaTime;
    this.badgeTime += dt;
    const bob = Math.sin(this.badgeTime * 2.4) * 0.35;
    for (const sprite of [...this.idleBadges, ...this.jobBadges]) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob;
    }
    this.flightTime += dt;
    if (this.flights.length > 0) this.paintPlanes();
    if (this.walkers.length === 0) return;
    for (const walker of this.walkers) {
      walker.t += dt * walker.speed;
      if (walker.t >= 1) this.advance(walker);
    }
    this.paintCars();
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  private roadsChanged(city: CityState): boolean {
    let hash = 2166136261;
    for (let index = 0; index < city.roads.length; index += 1) {
      hash ^= city.roads[index];
      hash = Math.imul(hash, 16777619);
    }
    const stamp = `${hash}`;
    if (stamp === this.roadStamp) return false;
    this.roadStamp = stamp;
    return true;
  }

  private rebuildGraph(city: CityState): void {
    this.graph.clear();
    const count = city.width * city.height;
    for (let index = 0; index < count; index += 1) {
      if (!isRoad(city, index)) continue;
      const { x, y } = cellCoords(city, index);
      const links: number[] = [];
      for (const dir of DIRS) {
        if ((city.roads[index] & dir.bit) === 0) continue;
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
        links.push(ny * city.width + nx);
      }
      this.graph.set(index, links);
    }
  }

  private syncCars(city: CityState): void {
    const roster = streetCars(city);
    const previous = new Map(this.walkers.map((walker) => [walker.id, walker]));
    this.walkers = roster.map((car) => previous.get(car.id) ?? this.spawnCar(city, car));
    for (const walker of this.walkers) {
      const car = roster.find((entry) => entry.id === walker.id);
      if (!car) continue;
      walker.driver = car.driver;
      walker.members = car.members;
      walker.label = car.label;
      walker.surname = car.surname;
    }
  }

  private spawnCar(city: CityState, car: StreetCar): Walker {
    const roads = [...this.graph.keys()];
    const nearest = nearestRoad(city, car.home, roads);
    const links = this.graph.get(nearest) ?? [];
    return {
      id: car.id,
      home: car.home,
      surname: car.surname,
      driver: car.driver,
      members: car.members,
      label: car.label,
      from: nearest,
      to: links[0] ?? nearest,
      t: (hashCode(car.id) % 100) / 100,
      speed: 0.8 + (hashCode(car.id) % 40) / 100,
      color: car.color,
      x: 0,
      z: 0,
    };
  }

  pickCar(camera: THREE.Camera, ndcX: number, ndcY: number): Walker | null {
    const point = new THREE.Vector3();
    let best: Walker | null = null;
    let bestDistance = 0.055;
    for (const walker of this.walkers) {
      point.set(walker.x, 0.5, walker.z).project(camera);
      const distance = Math.hypot(point.x - ndcX, point.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = walker;
      }
    }
    return best;
  }

  private advance(walker: Walker): void {
    const options = this.graph.get(walker.to) ?? [];
    if (options.length === 0) {
      walker.t = 0;
      return;
    }
    const forward = options.filter((index) => index !== walker.from);
    const pool = forward.length > 0 ? forward : options;
    walker.from = walker.to;
    walker.to = pool[Math.floor(Math.random() * pool.length)];
    walker.t = 0;
  }

  private paintCars(): void {
    this.walkers.forEach((walker, slot) => {
      const from = this.point(walker.from);
      const to = this.point(walker.to);
      const x = from.x + (to.x - from.x) * walker.t;
      const z = from.z + (to.z - from.z) * walker.t;
      const y = this.driveHeight(walker.from) + (this.driveHeight(walker.to) - this.driveHeight(walker.from)) * walker.t;
      walker.x = x;
      walker.z = z;
      this.put(this.cars, slot, x, y, z, 2.1, 1.25, 4.3, Math.atan2(to.x - from.x, to.z - from.z), walker.color);
    });
    this.finish(this.cars, this.walkers.length);
  }

  private syncFlights(city: CityState): void {
    const airports: number[] = [];
    for (let index = 0; index < city.services.length; index += 1) {
      if (city.services[index] === ServiceKind.Airport) airports.push(index);
    }
    const kept = new Map(this.flights.map((flight) => [`${flight.cell}:${flight.phase}`, flight]));
    this.flights = [];
    for (const cell of airports) {
      for (const phase of [0, 11.5]) {
        const key = `${cell}:${phase}`;
        this.flights.push(kept.get(key) ?? { cell, phase, x: 0, y: 0, z: 0, rotY: 0 });
      }
    }
    if (this.flights.length === 0) this.finish(this.planes, 0);
  }

  private paintPlanes(): void {
    if (!this.shown) {
      this.finish(this.planes, 0);
      return;
    }
    this.flights.forEach((flight, slot) => {
      const pose = planePose(this.shown!, flight.cell, this.flightTime + flight.phase);
      flight.x = pose.x;
      flight.y = pose.y;
      flight.z = pose.z;
      flight.rotY = pose.rotY;
      this.put(this.planes, slot, pose.x, pose.y, pose.z, 1, 1, 1, pose.rotY, 0xffffff);
    });
    this.finish(this.planes, this.flights.length);
  }

  private point(index: number): { x: number; z: number } {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    return cellToWorld({ width: GRID_SIZE, height: GRID_SIZE }, x, y);
  }

  private placeBadges(pool: THREE.Sprite[], material: THREE.SpriteMaterial, cells: number[], city: CityState): void {
    while (pool.length < cells.length) {
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(4.8, 4.8, 1);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.scene.add(sprite);
      pool.push(sprite);
    }
    cells.forEach((cell, slot) => {
      const coords = cellCoords(city, cell);
      const spot = cellToWorld(city, coords.x, coords.y);
      const shape = modelForZone(city.zones[cell], city.levels[cell]);
      const top = (shape?.height ?? 4) + 2.4;
      const sprite = pool[slot];
      sprite.visible = true;
      sprite.userData.baseY = top;
      sprite.position.set(spot.x, top, spot.z);
    });
    for (let index = cells.length; index < pool.length; index += 1) pool[index].visible = false;
  }

  private driveHeight(index: number): number {
    if (!this.shown || !isBridge(this.shown, index)) return 0.48;
    return bridgeCrest(this.shown, index) + 0.28;
  }

  private layBridge(
    city: CityState,
    cellX: number,
    cellY: number,
    x: number,
    z: number,
    curbs: number,
    roads: number,
    poles: number,
    cables: number,
  ): { curbs: number; roads: number; poles: number; cables: number } {
    const index = cellY * city.width + cellX;
    const mask = city.roads[index] & 0b1111;
    const crest = bridgeCrest(city, index);
    const arms = [
      { bit: 1, ox: 0, oz: -1, alongX: false },
      { bit: 2, ox: 1, oz: 0, alongX: true },
      { bit: 4, ox: 0, oz: 1, alongX: false },
      { bit: 8, ox: -1, oz: 0, alongX: true },
    ];
    const active = arms.filter((arm) => (mask & arm.bit) !== 0);
    const used = active.length > 0 ? active : arms.filter((arm) => arm.alongX);
    const deck = CELL_SIZE * 0.78;
    this.put(this.asphalt, roads, x, crest, z, deck, 0.16, deck, 0, 0x4e555c);
    roads += 1;
    for (const arm of used) {
      const neighbor = neighborIndex(city, cellX, cellY, arm.ox, arm.oz);
      const neighborCrest = neighbor === null ? crest : bridgeCrest(city, neighbor);
      const meetsRoad = neighbor !== null && isRoad(city, neighbor) && !isBridge(city, neighbor);
      const edge = meetsRoad ? ROAD_TOP : (crest + neighborCrest) / 2;
      const steps = 4;
      for (let step = 0; step < steps; step += 1) {
        const t = (step + 1) / steps;
        const height = crest + (edge - crest) * t;
        const along = CELL_SIZE * 0.5 * t;
        const length = CELL_SIZE * 0.5 / steps + 0.2;
        const sx = arm.alongX ? length : deck;
        const sz = arm.alongX ? deck : length;
        this.put(this.asphalt, roads, x + arm.ox * along, height, z + arm.oz * along, sx, 0.16, sz, 0, 0x4e555c);
        roads += 1;
        this.put(this.curbs, curbs, x + arm.ox * along, height + 0.16, z + arm.oz * along, arm.alongX ? length : deck + 0.7, 0.1, arm.alongX ? deck + 0.7 : length, 0, 0xc73e1d);
        curbs += 1;
      }
    }
    const northSouth = (mask & 0b0101) !== 0 && (mask & 0b1010) === 0;
    const side = northSouth ? 1 : 0;
    const tower = crest > 2.4 && (touchesLand(city, index) || (cellX + cellY) % 4 === 0);
    if (tower) {
      const gap = deck * 0.62;
      for (const sign of [-1, 1]) {
        const tx = x + (side === 0 ? 0 : sign * gap);
        const tz = z + (side === 0 ? sign * gap : 0);
        this.put(this.poles, poles, tx, crest + 6.2, tz, 0.85, 12.4, 0.85, 0, 0xc73e1d);
        poles += 1;
      }
      const beamY = crest + 11.4;
      this.put(this.cables, cables, x, beamY, z, northSouth ? deck * 1.35 : 0.7, 0.55, northSouth ? 0.7 : deck * 1.35, 0, 0xc73e1d);
      cables += 1;
      this.put(this.cables, cables, x, crest + 7.2, z, northSouth ? deck * 1.2 : 0.45, 0.35, northSouth ? 0.45 : deck * 1.2, 0, 0xc73e1d);
      cables += 1;
    } else if (crest > 2.2) {
      const gap = deck * 0.56;
      const hang = crest + 3.6;
      for (const sign of [-1, 1]) {
        const tx = x + (side === 0 ? 0 : sign * gap);
        const tz = z + (side === 0 ? sign * gap : 0);
        this.put(this.poles, poles, tx, (crest + hang) / 2, tz, 0.12, hang - crest, 0.12, 0, 0xd7c7a4);
        poles += 1;
        this.put(this.cables, cables, tx, hang, tz, side === 0 ? 0.16 : CELL_SIZE * 0.55, 0.16, side === 0 ? CELL_SIZE * 0.55 : 0.16, 0, 0xc73e1d);
        cables += 1;
      }
    }
    return { curbs, roads, poles, cables };
  }

  private asphaltColor(load: number): number {
    const heat = load / 255;
    this.tint.setRGB(0.2 + heat * 0.4, 0.22 - heat * 0.05, 0.24 - heat * 0.06);
    return this.tint.getHex();
  }

  private put(
    mesh: THREE.InstancedMesh,
    slot: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotY: number,
    color: number,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, rotY, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(slot, this.dummy.matrix);
    this.tint.set(color);
    mesh.setColorAt(slot, this.tint);
  }

  private layConductor(
    target: THREE.InstancedMesh,
    slot: number,
    index: number,
    layer: Uint8Array,
    x: number,
    z: number,
    y: number,
    thickness: number,
    color: number,
  ): number {
    this.put(target, slot, x, y, z, thickness * 1.8, thickness * 1.8, thickness * 1.8, 0, color);
    slot += 1;
    const mask = layer[index] & 0b1111;
    const arms = [
      { bit: 1, ox: 0, oz: -0.25, sx: thickness, sz: CELL_SIZE * 0.5 },
      { bit: 2, ox: 0.25, oz: 0, sx: CELL_SIZE * 0.5, sz: thickness },
      { bit: 4, ox: 0, oz: 0.25, sx: thickness, sz: CELL_SIZE * 0.5 },
      { bit: 8, ox: -0.25, oz: 0, sx: CELL_SIZE * 0.5, sz: thickness },
    ];
    for (const arm of arms) {
      if ((mask & arm.bit) === 0) continue;
      this.put(target, slot, x + arm.ox * CELL_SIZE, y, z + arm.oz * CELL_SIZE, arm.sx, thickness, arm.sz, 0, color);
      slot += 1;
    }
    return slot;
  }

  private layRoad(x: number, z: number, mask: number, color: number, curbs: number, roads: number): { curbs: number; roads: number } {
    const arms = [
      { bit: 1, ox: 0, oz: -1, wide: false },
      { bit: 2, ox: 1, oz: 0, wide: true },
      { bit: 4, ox: 0, oz: 1, wide: false },
      { bit: 8, ox: -1, oz: 0, wide: true },
    ];
    const slab = (slotMesh: THREE.InstancedMesh, slot: number, ox: number, oz: number, sx: number, sz: number, y: number, height: number, paint: number) => {
      this.put(slotMesh, slot, x + ox * CELL_SIZE * 0.25, y, z + oz * CELL_SIZE * 0.25, sx, height, sz, 0, paint);
    };
    slab(this.curbs, curbs, 0, 0, CELL_SIZE * 0.92, CELL_SIZE * 0.92, 0.05, 0.1, 0x8b8172);
    curbs += 1;
    slab(this.asphalt, roads, 0, 0, CELL_SIZE * 0.78, CELL_SIZE * 0.78, 0.11, 0.12, color);
    roads += 1;
    for (const arm of arms) {
      if ((mask & arm.bit) === 0) continue;
      const span = CELL_SIZE * 0.5;
      const curbWidth = CELL_SIZE * 0.92;
      const roadWidth = CELL_SIZE * 0.78;
      const sx = arm.wide ? span : curbWidth;
      const sz = arm.wide ? curbWidth : span;
      const ax = arm.wide ? span : roadWidth;
      const az = arm.wide ? roadWidth : span;
      slab(this.curbs, curbs, arm.ox, arm.oz, sx, sz, 0.05, 0.1, 0x8b8172);
      curbs += 1;
      slab(this.asphalt, roads, arm.ox, arm.oz, ax, az, 0.11, 0.12, color);
      roads += 1;
    }
    return { curbs, roads };
  }

  private placeModel(key: string, x: number, z: number, color: number): void {
    const instances = this.models.get(key);
    if (!instances) return;
    const slot = this.modelSlot.get(key) ?? 0;
    if (slot >= 700) return;
    this.put(instances, slot, x, 0, z, 1, 1, 1, 0, color);
    this.modelSlot.set(key, slot + 1);
  }

  private rebuildGround(city: CityState): void {
    let hash = 2166136261;
    for (let index = 0; index < city.terrain.length; index += 1) {
      hash ^= city.terrain[index];
      hash = Math.imul(hash, 16777619);
    }
    const stamp = `${hash}`;
    if (stamp === this.groundStamp) return;
    this.groundStamp = stamp;
    const built = islandSurface(city);
    this.ground.geometry.dispose();
    this.plot.geometry.dispose();
    this.ground.geometry = built.ground;
    this.plot.geometry = built.plot;
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

const ROAD_TOP = 0.2;
const SPAN_TOP = 3.05;

function bridgeCrest(city: CityState, index: number): number {
  if (!isBridge(city, index)) return ROAD_TOP;
  return touchesLand(city, index) ? 1.45 : SPAN_TOP;
}

function touchesLand(city: CityState, index: number): boolean {
  const x = index % city.width;
  const y = Math.floor(index / city.width);
  for (const dir of DIRS) {
    const next = neighborIndex(city, x, y, dir.dx, dir.dy);
    if (next !== null && isRoad(city, next) && !isBridge(city, next)) return true;
  }
  return false;
}

function neighborIndex(city: CityState, x: number, y: number, dx: number, dy: number): number | null {
  const nx = x + dx;
  const ny = y + dy;
  if (!inBounds(city, nx, ny)) return null;
  return ny * city.width + nx;
}

function seaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying float vWave;
      void main() {
        vec3 shifted = position;
        float wave = sin(position.x * 0.045 + uTime * 0.95) * 0.045
          + sin(position.z * 0.06 - uTime * 0.72) * 0.035
          + sin((position.x + position.z) * 0.028 + uTime * 1.25) * 0.025;
        shifted.y += wave;
        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(shifted, 1.0);
      }
    `,
    fragmentShader: `
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.10, 0.34, 0.55);
        vec3 mid = vec3(0.20, 0.55, 0.74);
        vec3 foam = vec3(0.78, 0.90, 0.94);
        float crest = smoothstep(0.02, 0.07, vWave);
        vec3 color = mix(deep, mid, clamp(vWave * 6.0 + 0.45, 0.0, 1.0));
        color = mix(color, foam, crest * 0.55);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function personBadge(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#c84b3a";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff8ee";
  ctx.beginPath();
  ctx.arc(32, 22, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(20, 32, 24, 18, 8);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function jobBadge(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#e2b15a";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a2116";
  ctx.fillRect(18, 28, 28, 18);
  ctx.fillRect(26, 22, 12, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function peerPin(): THREE.Group {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe2b15a, roughness: 0.45 }),
  );
  pole.position.y = 5;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf4efe4, emissive: 0xe2b15a, emissiveIntensity: 0.35 }),
  );
  head.position.y = 11;
  group.add(pole, head);
  return group;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity = CAP): THREE.InstancedMesh {
  const instances = new THREE.InstancedMesh(geometry, material, capacity);
  instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  instances.count = 0;
  instances.frustumCulled = false;
  return instances;
}

function cornerGeometry(inner: number, outer: number, yBottom: number, yTop: number): THREE.BufferGeometry {
  const segments = 16;
  const centerX = 0.5;
  const centerZ = -0.5;
  const positions: number[] = [];
  const indices: number[] = [];
  const ring = (y: number) => {
    const base = positions.length / 3;
    for (let step = 0; step <= segments; step += 1) {
      const angle = Math.PI - (Math.PI / 2) * (step / segments);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(centerX + cos * inner, y, centerZ + sin * inner, centerX + cos * outer, y, centerZ + sin * outer);
    }
    return base;
  };
  const top = ring(yTop);
  const bottom = ring(yBottom);
  for (let step = 0; step < segments; step += 1) {
    const above = top + step * 2;
    const below = bottom + step * 2;
    indices.push(above, above + 1, above + 2, above + 1, above + 3, above + 2);
    indices.push(below, below + 2, below + 1, below + 1, below + 2, below + 3);
    indices.push(above, below + 2, below, above, above + 2, below + 2);
    indices.push(above + 1, below + 1, below + 3, above + 1, below + 3, above + 3);
  }
  const stub = (x0: number, x1: number, z0: number, z1: number) => {
    const base = positions.length / 3;
    positions.push(x0, yBottom, z0, x1, yBottom, z0, x1, yBottom, z1, x0, yBottom, z1);
    positions.push(x0, yTop, z0, x1, yTop, z0, x1, yTop, z1, x0, yTop, z1);
    const faces = [
      [4, 5, 6, 4, 6, 7],
      [0, 2, 1, 0, 3, 2],
      [0, 4, 7, 0, 7, 3],
      [1, 6, 5, 1, 2, 6],
      [3, 7, 6, 3, 6, 2],
      [0, 1, 5, 0, 5, 4],
    ];
    for (const face of faces) indices.push(base + face[0], base + face[1], base + face[2], base + face[3], base + face[4], base + face[5]);
  };
  const reach = 0.28;
  stub(centerX - outer, centerX - inner, centerZ - reach, centerZ);
  stub(centerX, centerX + reach, centerZ + inner, centerZ + outer);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function scatter(x: number, y: number): number {
  let value = Math.imul(x ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(y ^ 0x85ebca6b, 0x165667b1);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

function nearestRoad(city: CityState, home: number, roads: number[]): number {
  if (roads.length === 0) return home;
  const origin = cellCoords(city, home);
  let best = roads[0] ?? home;
  let bestDistance = 9999;
  for (const road of roads) {
    const spot = cellCoords(city, road);
    const distance = Math.abs(spot.x - origin.x) + Math.abs(spot.y - origin.y);
    if (distance < bestDistance) {
      best = road;
      bestDistance = distance;
    }
  }
  return best;
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash, 31) + value.charCodeAt(index);
  return Math.abs(hash);
}

function planePose(city: CityState, cell: number, time: number): { x: number; y: number; z: number; rotY: number } {
  const { x, y } = cellCoords(city, cell);
  const origin = cellToWorld(city, x, y);
  const cycle = 22;
  const t = ((time % cycle) + cycle) % cycle;
  let px = origin.x;
  let py = 2.2;
  let pz = origin.z;
  let vx = 1;
  let vz = 0;
  if (t < 8) {
    const u = t / 8;
    px = origin.x - 90 + u * 90;
    py = 2.2 + (1 - u) * (1 - u) * 22;
    vx = 1;
  } else if (t < 11) {
    const u = (t - 8) / 3;
    px = origin.x + u * 6;
    py = 2.15;
    vx = 1;
  } else if (t < 18) {
    const u = (t - 11) / 7;
    px = origin.x + 6 + u * 100;
    py = 2.2 + u * u * 30;
    vx = 1;
  } else {
    const u = (t - 18) / 4;
    px = origin.x + 106 - u * 196;
    py = 32;
    pz = origin.z - 18;
    vx = -1;
    vz = 0;
  }
  return { x: px, y: py, z: pz, rotY: Math.atan2(vx, vz) };
}

const GROUND_Y = 0.02;
const SKIRT_Y = -1.8;

function islandSurface(city: CityState): { ground: THREE.BufferGeometry; plot: THREE.LineSegments["geometry"] } {
  const cols = city.width + 1;
  const rows = city.height + 1;
  const pointX = new Float32Array(cols * rows);
  const pointZ = new Float32Array(cols * rows);
  const half = (city.width * CELL_SIZE) / 2;
  const landHere = (x: number, y: number) => inBounds(city, x, y) && !isWater(city, y * city.width + x);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const baseX = -half + x * CELL_SIZE;
      const baseZ = -half + y * CELL_SIZE;
      const touches = [
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y],
        [x, y],
      ];
      let land = 0;
      let total = 0;
      let sumX = 0;
      let sumZ = 0;
      for (const [cellX, cellY] of touches) {
        if (!inBounds(city, cellX, cellY)) continue;
        total += 1;
        if (!landHere(cellX, cellY)) continue;
        land += 1;
        const spot = cellToWorld(city, cellX, cellY);
        sumX += spot.x;
        sumZ += spot.z;
      }
      let worldX = baseX;
      let worldZ = baseZ;
      if (land > 0 && land < total) {
        worldX = baseX + (sumX / land - baseX) * 0.16;
        worldZ = baseZ + (sumZ / land - baseZ) * 0.16;
      }
      pointX[y * cols + x] = worldX;
      pointZ[y * cols + x] = worldZ;
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const grass = new THREE.Color();
  const earth = new THREE.Color(0x3d4a32);
  const paint = (x: number, y: number) => {
    const roll = scatter(x, y) % 3;
    grass.set(roll === 0 ? 0x6d8f55 : roll === 1 ? 0x78985c : 0x61824c);
  };
  const top = (x: number, z: number, cellX: number, cellY: number) => {
    paint(cellX, cellY);
    positions.push(x, GROUND_Y, z);
    colors.push(grass.r, grass.g, grass.b);
  };
  const skirt = (x0: number, z0: number, x1: number, z1: number, cellX: number, cellY: number) => {
    paint(cellX, cellY);
    positions.push(x0, GROUND_Y, z0, x1, GROUND_Y, z1, x1, SKIRT_Y, z1);
    colors.push(grass.r, grass.g, grass.b, grass.r, grass.g, grass.b, earth.r, earth.g, earth.b);
    positions.push(x0, GROUND_Y, z0, x1, SKIRT_Y, z1, x0, SKIRT_Y, z0);
    colors.push(grass.r, grass.g, grass.b, earth.r, earth.g, earth.b, earth.r, earth.g, earth.b);
  };

  const plot: number[] = [];
  for (let y = 0; y < city.height; y += 1) {
    for (let x = 0; x < city.width; x += 1) {
      if (!landHere(x, y)) continue;
      const corners = [y * cols + x, y * cols + x + 1, (y + 1) * cols + x + 1, (y + 1) * cols + x];
      const quad = [
        [corners[0], corners[2], corners[1]],
        [corners[0], corners[3], corners[2]],
      ];
      for (const triangle of quad) {
        for (const corner of triangle) top(pointX[corner], pointZ[corner], x, y);
      }
      const edges = [
        { nextX: x, nextY: y - 1, a: corners[0], b: corners[1] },
        { nextX: x + 1, nextY: y, a: corners[1], b: corners[2] },
        { nextX: x, nextY: y + 1, a: corners[3], b: corners[2] },
        { nextX: x - 1, nextY: y, a: corners[0], b: corners[3] },
      ];
      for (const edge of edges) {
        if (landHere(edge.nextX, edge.nextY)) continue;
        skirt(pointX[edge.a], pointZ[edge.a], pointX[edge.b], pointZ[edge.b], x, y);
      }
      const east = landHere(x + 1, y);
      const south = landHere(x, y + 1);
      if (east && landHere(x, y - 1) && landHere(x + 1, y - 1)) {
        const edge = pointX[corners[1]];
        plot.push(edge, GROUND_Y + 0.04, pointZ[corners[1]], edge, GROUND_Y + 0.04, pointZ[corners[2]]);
      }
      if (south && landHere(x - 1, y) && landHere(x - 1, y + 1)) {
        plot.push(pointX[corners[3]], GROUND_Y + 0.04, pointZ[corners[3]], pointX[corners[2]], GROUND_Y + 0.04, pointZ[corners[2]]);
      }
    }
  }

  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  ground.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(plot, 3));
  return { ground, plot: lines };
}
