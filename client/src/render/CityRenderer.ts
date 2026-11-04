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
  climateAt,
  inBounds,
  computeTraffic,
  helpBadges,
  utilityOutageBadges,
  isBridge,
  isLine,
  isPipe,
  isRoad,
  isWater,
  vegetationRoll,
  type BiomeId,
  type CityState,
  type Climate,
} from "../../../shared/src/index.ts";
import { streetCars, streetPedestrians, type StreetCar, type StreetPedestrian } from "../../../shared/src/people.ts";
import { buildCarModels, buildModels, buildPlaneGeometry, modelForFarm, modelForService, modelForZone } from "./models.ts";

const CORNER_ROT: Record<number, number> = {
  3: 0,
  9: Math.PI / 2,
  12: Math.PI,
  6: -Math.PI / 2,
};

const CAP = GRID_SIZE * GRID_SIZE;
const CAR_GAP = 5.2;
const PED_GAP = 1.15;

interface Walker {
  id: string;
  home: number;
  surname: string;
  driver: string;
  members: string;
  label: string;
  kind: string;
  from: number;
  to: number;
  t: number;
  speed: number;
  color: number;
  x: number;
  z: number;
}

interface Pedestrian {
  id: string;
  home: number;
  name: string;
  child: boolean;
  from: number;
  to: number;
  t: number;
  speed: number;
  color: number;
  side: number;
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
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly people: THREE.InstancedMesh;
  private readonly headlights: THREE.InstancedMesh;
  private readonly streetLamps: THREE.InstancedMesh;
  private readonly lampPoles: THREE.InstancedMesh;
  private readonly nightGlows: THREE.InstancedMesh;
  private readonly rain: THREE.Points;
  private readonly rainPositions: Float32Array;
  private pedestrians: Pedestrian[] = [];
  private climateStamp = "";
  private streetActivity = 0.4;
  private nightLit = false;
  private rainyPace = 1;
  private readonly buildings: THREE.InstancedMesh;
  private readonly services: THREE.InstancedMesh;
  private readonly curbs: THREE.InstancedMesh;
  private readonly asphalt: THREE.InstancedMesh;
  private readonly markings: THREE.InstancedMesh;
  private readonly zones: THREE.InstancedMesh;
  private readonly power: THREE.InstancedMesh;
  private readonly water: THREE.InstancedMesh;
  private readonly preview: THREE.InstancedMesh;
  private readonly radiusRing: THREE.InstancedMesh;
  private readonly births = new Map<number, number>();
  private lastOverlays: Overlays = { zones: true, power: false, water: false };
  private readonly locks: THREE.InstancedMesh;
  private readonly carMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly carSlots = new Map<string, number>();
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
  private readonly utilityBadges: THREE.Sprite[] = [];
  private readonly idleMaterial: THREE.SpriteMaterial;
  private readonly jobMaterial: THREE.SpriteMaterial;
  private readonly utilityMaterial: THREE.SpriteMaterial;
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
    this.fog = new THREE.Fog(0x9eb9c9, 420, 1500);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xf4f7fb, 0x3d6470, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff4df, 1.5);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target);

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
    this.radiusRing = mesh(plane, flat(0x7eb8e6, 0.18), 48);
    this.locks = mesh(plane, flat(0xff9a3c, 0.45));
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.18 });
    for (const model of buildCarModels()) {
      const instances = new THREE.InstancedMesh(model.geometry, carMat, 80);
      instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3);
      instances.count = 0;
      instances.frustumCulled = false;
      this.carMeshes.set(model.key, instances);
      this.carSlots.set(model.key, 0);
      this.scene.add(instances);
    }
    this.people = mesh(new THREE.CapsuleGeometry(0.28, 0.85, 3, 6), lit, 80);
    this.headlights = mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
      160,
    );
    this.lampPoles = mesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), lit, 400);
    this.streetLamps = mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0 }),
      400,
    );
    this.nightGlows = mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd89a,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      700,
    );
    this.planes = mesh(buildPlaneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.12 }), 24);
    this.rainPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i += 1) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 220;
      this.rainPositions[i * 3 + 1] = Math.random() * 80;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({ color: 0xb7c9d8, size: 0.55, transparent: true, opacity: 0.55 }),
    );
    this.rain.visible = false;
    this.rain.frustumCulled = false;
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
    this.utilityMaterial = new THREE.SpriteMaterial({ map: utilityBadge(), transparent: true, depthWrite: false });
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
      this.radiusRing,
      this.locks,
      this.people,
      this.headlights,
      this.lampPoles,
      this.streetLamps,
      this.nightGlows,
      this.planes,
      this.rain,
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

  /** Fresh builds pop in for a short beat. */
  noteBuilt(cells: readonly number[]): void {
    const now = performance.now();
    for (const cell of cells) this.births.set(cell, now);
  }

  sync(city: CityState, overlays: Overlays): void {
    this.shown = city;
    this.lastOverlays = overlays;
    this.traffic = computeTraffic(city).load;
    if (this.roadsChanged(city)) this.rebuildGraph(city);
    this.syncCars(city);
    this.syncPedestrians(city);
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
          : city.zones[index] === Zone.Farm
            ? ((city.skills[index] & 0b1000) !== 0 ? 0x7a9a55 : 0xc4b44a)
          : 0xd0892b;
        this.put(this.zones, zoneCount, world.x, 0.08, world.z, CELL_SIZE * 0.92, 1, CELL_SIZE * 0.92, 0, color);
        zoneCount += 1;
      }

      if (city.levels[index] > 0) {
        const shape =
          city.zones[index] === Zone.Farm
            ? modelForFarm(city.skills[index])
            : modelForZone(city.zones[index], city.levels[index]);
        if (shape) {
          const powered = (city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT);
          const nightWarm = this.nightLit && (city.utility[index] & POWER_BIT) !== 0;
          this.placeModel(shape.key, world.x, world.z, powered ? (nightWarm ? 0xfff1d2 : 0xffffff) : 0x8d847c, index);
        }
      }

      const service = city.services[index];
      if (service === ServiceKind.Lamp) {
        // Poles and night glow are drawn in paintLocalLights.
      } else {
      const served = modelForService(service);
      if (served) {
        const airportLit =
          service !== ServiceKind.Airport || (city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT);
        const nightWarm = this.nightLit && airportLit && (city.utility[index] & POWER_BIT) !== 0;
        this.placeModel(served.key, world.x, world.z, airportLit ? (nightWarm ? 0xfff1d2 : 0xffffff) : 0x8d847c, index);
      } else if (!isRoad(city, index) && !isLine(city, index) && !isPipe(city, index) && city.zones[index] === Zone.None && city.services[index] === ServiceKind.None && !isWater(city, index)) {
        const forest = city.gen?.forest ?? 50;
        const seed = city.gen?.seed ?? 1;
        const biome = city.gen?.biome ?? "temperate";
        const canopy = vegetationRoll(x, y, seed);
        const jx = ((scatter(x + 3, y) % 7) - 3) * 0.7;
        const jz = ((scatter(x, y + 5) % 7) - 3) * 0.7;
        const stoneChance = biome === "arid" ? 28 : biome === "alpine" ? 18 : 10;
        if (canopy < forest * 0.72) {
          const tall = (biome === "alpine" ? 2.6 : biome === "tropical" ? 2.8 : 2.1) + (scatter(x, y) % 5) * 0.35;
          const tint = treeTint(biome, canopy);
          this.put(this.trees, trees, world.x + jx, tall / 2, world.z + jz, 1.3 + (canopy % 3) * 0.22, tall, 1.3, 0, tint);
          trees += 1;
        } else if (vegetationRoll(x + 11, y + 5, seed) < stoneChance) {
          const size = 1.1 + (scatter(y, x) % 4) * 0.35;
          this.put(this.stones, stones, world.x + jx, size * 0.35, world.z + jz, size, size * 0.7, size * 0.85, (scatter(x, y) % 5) * 0.4, biome === "arid" ? 0xa89878 : 0x8d877c);
          stones += 1;
        }
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
    this.placeBadges(this.utilityBadges, this.utilityMaterial, utilityOutageBadges(city), city);
    this.paintCars();
    this.paintPedestrians();
    this.paintPlanes();
    this.paintLocalLights();
  }

  setPreview(city: CityState, cells: number[], legal: boolean[], radius = 0): void {
    cells.forEach((index, slot) => {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      this.put(this.preview, slot, world.x, 0.28, world.z, CELL_SIZE * 0.9, 1, CELL_SIZE * 0.9, 0, legal[slot] ? 0x8ee7a0 : 0xe36d62);
    });
    this.finish(this.preview, cells.length);
    let rings = 0;
    if (radius > 0 && cells.length > 0 && legal[0]) {
      const { x, y } = cellCoords(city, cells[0]);
      const world = cellToWorld(city, x, y);
      const span = (radius * 2 + 1) * CELL_SIZE;
      this.put(this.radiusRing, rings, world.x, 0.16, world.z, span, 1, span, 0, 0x7eb8e6);
      rings += 1;
      const inner = Math.max(CELL_SIZE * 1.2, span * 0.42);
      this.put(this.radiusRing, rings, world.x, 0.18, world.z, inner, 1, inner, 0, 0xa8d4f0);
      rings += 1;
    }
    this.finish(this.radiusRing, rings);
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
    const climate = climateAt(this.shown?.tick ?? 0);
    this.applyClimate(climate, target);
    this.seaTime += dt;
    this.seaMaterial.uniforms.uTime.value = this.seaTime;
    this.badgeTime += dt;
    const bob = Math.sin(this.badgeTime * 2.4) * 0.35;
    const pulse = 1 + Math.sin(this.badgeTime * 4.2) * 0.12;
    for (const sprite of this.idleBadges) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob;
      sprite.scale.setScalar(4.8);
    }
    for (const sprite of this.jobBadges) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob * 0.7;
      sprite.scale.setScalar(4.6);
    }
    for (const sprite of this.utilityBadges) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob;
      sprite.scale.setScalar(4.8 * pulse);
    }
    if (this.shown && this.births.size > 0) this.sync(this.shown, this.lastOverlays);
    this.flightTime += dt;
    if (this.flights.length > 0) this.paintPlanes();
    this.updateRain(dt, target, climate);
    const jam = 0.45 + (1 - this.streetActivity) * 0.7;
    const pace = jam * this.rainyPace;
    // Refresh world positions before collision checks.
    for (const walker of this.walkers) this.placeCar(walker);
    for (const ped of this.pedestrians) this.placePed(ped);
    for (const walker of this.walkers) {
      if (this.carBlocked(walker)) continue;
      walker.t += dt * walker.speed * pace;
      if (walker.t >= 1) this.advance(walker);
      this.placeCar(walker);
    }
    for (const ped of this.pedestrians) {
      if (this.pedBlocked(ped)) continue;
      ped.t += dt * ped.speed * (0.7 + this.streetActivity * 0.5) * this.rainyPace;
      if (ped.t >= 1) this.advancePed(ped);
      this.placePed(ped);
    }
    this.paintCars();
    this.paintPedestrians();
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
      walker.kind = car.kind;
      walker.color = car.color;
    }
  }

  private spawnCar(city: CityState, car: StreetCar): Walker {
    const roads = [...this.graph.keys()];
    const nearest = nearestRoad(city, car.home, roads);
    const links = this.graph.get(nearest) ?? [];
    const to = links[0] ?? nearest;
    let t = (hashCode(car.id) % 100) / 100;
    // Spread out if someone already sits on this edge.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const hit = this.walkers.some((other) => other.from === nearest && other.to === to && Math.abs(other.t - t) < 0.22);
      if (!hit) break;
      t = (t + 0.17) % 1;
    }
    return {
      id: car.id,
      home: car.home,
      surname: car.surname,
      driver: car.driver,
      members: car.members,
      label: car.label,
      kind: car.kind,
      from: nearest,
      to,
      t,
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
    const from = walker.to;
    const ranked = [...pool].sort((a, b) => this.edgeLoad(from, a) - this.edgeLoad(from, b));
    walker.from = from;
    walker.to = ranked[0] ?? from;
    walker.t = 0;
  }

  private edgeLoad(from: number, to: number): number {
    let load = 0;
    for (const other of this.walkers) {
      if (other.from === from && other.to === to) load += 2;
      else if (other.from === to && other.to === from) load += 1;
    }
    return load;
  }

  private placeCar(walker: Walker): void {
    const from = this.point(walker.from);
    const to = this.point(walker.to);
    walker.x = from.x + (to.x - from.x) * walker.t;
    walker.z = from.z + (to.z - from.z) * walker.t;
  }

  /** Hold if another car is too close ahead (or overlapping). */
  private carBlocked(walker: Walker): boolean {
    const from = this.point(walker.from);
    const to = this.point(walker.to);
    const fx = to.x - from.x;
    const fz = to.z - from.z;
    const len = Math.hypot(fx, fz) || 1;
    const nx = fx / len;
    const nz = fz / len;
    for (const other of this.walkers) {
      if (other.id === walker.id) continue;
      const dx = other.x - walker.x;
      const dz = other.z - walker.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= CAR_GAP) continue;
      const ahead = dx * nx + dz * nz;
      if (ahead > 0.2) return true;
      if (dist < CAR_GAP * 0.55) return true;
    }
    return false;
  }

  private paintCars(): void {
    for (const key of this.carSlots.keys()) this.carSlots.set(key, 0);
    let lights = 0;
    for (const walker of this.walkers) {
      this.placeCar(walker);
      const from = this.point(walker.from);
      const to = this.point(walker.to);
      const y = this.driveHeight(walker.from) + (this.driveHeight(walker.to) - this.driveHeight(walker.from)) * walker.t;
      const rotY = Math.atan2(to.x - from.x, to.z - from.z);
      const kind = this.carMeshes.has(walker.kind) ? walker.kind : "sedan";
      const mesh = this.carMeshes.get(kind);
      if (!mesh) continue;
      const slot = this.carSlots.get(kind) ?? 0;
      if (slot >= 80) continue;
      this.put(mesh, slot, walker.x, y, walker.z, 1, 1, 1, rotY, walker.color);
      this.carSlots.set(kind, slot + 1);
      if (this.nightLit && lights + 1 < 160) {
        const fx = Math.sin(rotY);
        const fz = Math.cos(rotY);
        const rx = Math.cos(rotY) * 0.52;
        const rz = -Math.sin(rotY) * 0.52;
        this.put(this.headlights, lights, walker.x + fx * 1.9 + rx, y + 0.55, walker.z + fz * 1.9 + rz, 0.3, 0.18, 0.14, rotY, 0xfff2c4);
        lights += 1;
        this.put(this.headlights, lights, walker.x + fx * 1.9 - rx, y + 0.55, walker.z + fz * 1.9 - rz, 0.3, 0.18, 0.14, rotY, 0xfff2c4);
        lights += 1;
      }
    }
    for (const [key, instances] of this.carMeshes) this.finish(instances, this.carSlots.get(key) ?? 0);
    this.finish(this.headlights, this.nightLit ? lights : 0);
  }

  private syncPedestrians(city: CityState): void {
    const roster = streetPedestrians(city);
    const previous = new Map(this.pedestrians.map((ped) => [ped.id, ped]));
    this.pedestrians = roster.map((entry) => previous.get(entry.id) ?? this.spawnPedestrian(city, entry));
  }

  private spawnPedestrian(city: CityState, entry: StreetPedestrian): Pedestrian {
    const roads = [...this.graph.keys()];
    const nearest = nearestRoad(city, entry.home, roads);
    const links = this.graph.get(nearest) ?? [];
    const to = links[0] ?? nearest;
    const side = hashCode(entry.id) % 2 === 0 ? 1 : -1;
    let t = (hashCode(entry.id) % 100) / 100;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const hit = this.pedestrians.some(
        (other) => other.side === side && other.from === nearest && other.to === to && Math.abs(other.t - t) < 0.2,
      );
      if (!hit) break;
      t = (t + 0.19) % 1;
    }
    return {
      id: entry.id,
      home: entry.home,
      name: entry.name,
      child: entry.child,
      from: nearest,
      to,
      t,
      speed: entry.child ? 0.32 + (hashCode(entry.id) % 20) / 100 : 0.28 + (hashCode(entry.id) % 18) / 100,
      color: entry.color,
      side,
      x: 0,
      z: 0,
    };
  }

  private advancePed(ped: Pedestrian): void {
    const options = this.graph.get(ped.to) ?? [];
    if (options.length === 0) {
      ped.t = 0;
      return;
    }
    const forward = options.filter((index) => index !== ped.from);
    const pool = forward.length > 0 ? forward : options;
    const from = ped.to;
    const ranked = [...pool].sort((a, b) => this.pedEdgeLoad(from, a, ped.side) - this.pedEdgeLoad(from, b, ped.side));
    ped.from = from;
    ped.to = ranked[0] ?? from;
    ped.t = 0;
  }

  private pedEdgeLoad(from: number, to: number, side: number): number {
    let load = 0;
    for (const other of this.pedestrians) {
      if (other.side !== side) continue;
      if (other.from === from && other.to === to) load += 2;
      else if (other.from === to && other.to === from) load += 1;
    }
    return load;
  }

  private placePed(ped: Pedestrian): void {
    const from = this.point(ped.from);
    const to = this.point(ped.to);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const curb = CELL_SIZE * 0.4;
    const ox = (-dz / len) * curb * ped.side;
    const oz = (dx / len) * curb * ped.side;
    ped.x = from.x + dx * ped.t + ox;
    ped.z = from.z + dz * ped.t + oz;
  }

  private pedBlocked(ped: Pedestrian): boolean {
    const from = this.point(ped.from);
    const to = this.point(ped.to);
    const fx = to.x - from.x;
    const fz = to.z - from.z;
    const len = Math.hypot(fx, fz) || 1;
    const nx = fx / len;
    const nz = fz / len;
    for (const other of this.pedestrians) {
      if (other.id === ped.id) continue;
      if (other.side !== ped.side) continue;
      const dx = other.x - ped.x;
      const dz = other.z - ped.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= PED_GAP) continue;
      const ahead = dx * nx + dz * nz;
      if (ahead > 0.15) return true;
      if (dist < PED_GAP * 0.6) return true;
    }
    return false;
  }

  private paintPedestrians(): void {
    this.pedestrians.forEach((ped, slot) => {
      this.placePed(ped);
      const from = this.point(ped.from);
      const to = this.point(ped.to);
      const y = this.driveHeight(ped.from) + (this.driveHeight(ped.to) - this.driveHeight(ped.from)) * ped.t;
      const scale = ped.child ? 0.72 : 1;
      this.put(
        this.people,
        slot,
        ped.x,
        y + 0.85 * scale,
        ped.z,
        scale,
        scale,
        scale,
        Math.atan2(to.x - from.x, to.z - from.z),
        ped.color,
      );
    });
    this.finish(this.people, this.pedestrians.length);
  }

  private applyClimate(climate: Climate, target: THREE.Vector3): void {
    this.streetActivity = climate.streetActivity;
    this.nightLit = climate.isNight || climate.daylight < 0.28;
    this.rainyPace = climate.weather === "rain" ? 0.72 : 1;
    const stamp = `${climate.clock}:${climate.weather}:${climate.daylight.toFixed(2)}:${climate.streetActivity.toFixed(2)}`;
    const sunHeight = 40 + climate.daylight * 140;
    const ring = 50 + (1 - climate.daylight) * 40;
    const az = climate.phase * Math.PI * 2;
    this.sun.position.set(
      target.x + Math.cos(az) * ring,
      sunHeight,
      target.z + Math.sin(az) * ring,
    );
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();

    if (stamp === this.climateStamp) return;
    this.climateStamp = stamp;

    const day = climate.daylight;
    const rainy = climate.weather === "rain";
    const cloudy = climate.weather === "cloud" || rainy;
    const night = climate.isNight;
    const golden = (climate.hour > 5.5 && climate.hour < 7.5) || (climate.hour > 17.5 && climate.hour < 19.5);
    const sky = new THREE.Color().setHSL(
      rainy ? 0.58 : golden ? 0.08 : night ? 0.62 : 0.57,
      cloudy ? 0.12 : golden ? 0.45 : night ? 0.16 : 0.22 + day * 0.15,
      night ? 0.24 + day * 0.1 : 0.1 + day * (cloudy ? 0.4 : 0.55),
    );
    this.scene.background = sky;
    this.fog.color.copy(sky);
    this.fog.near = rainy ? 160 : night ? 220 : 320 + day * 100;
    this.fog.far = rainy ? 850 : night ? 1100 : 1200 + day * 400;
    this.hemi.intensity = night ? 0.34 + day * 0.16 : 0.28 + day * 0.85;
    this.hemi.color.set(night ? 0x9aa6c0 : day > 0.35 ? 0xf4f7fb : 0x8fa0c0);
    this.hemi.groundColor.set(night ? 0x2a3842 : day > 0.35 ? 0x3d6470 : 0x1a2430);
    this.sun.intensity = (night ? 0.28 + day * 0.12 : 0.15 + day * 1.45) * (rainy ? 0.55 : cloudy ? 0.75 : 1);
    this.sun.color.set(golden ? 0xffb078 : day > 0.25 ? 0xfff4df : night ? 0x8ea0bc : 0x9bb0d8);
    this.seaMaterial.uniforms.uShade.value = night ? 0.58 + day * 0.12 : rainy ? 0.78 : 1;
    this.rain.visible = rainy;
    this.paintLocalLights();
  }

  /** Built lamps + powered buildings add a warm night glow; the map itself stays readable. */
  private paintLocalLights(): void {
    if (!this.shown) {
      this.finish(this.lampPoles, 0);
      this.finish(this.streetLamps, 0);
      this.finish(this.nightGlows, 0);
      return;
    }
    const city = this.shown;
    const count = city.width * city.height;
    let poles = 0;
    let bulbs = 0;
    let glows = 0;
    for (let index = 0; index < count; index += 1) {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      if (city.services[index] === ServiceKind.Lamp) {
        const crest = isRoad(city, index) ? this.driveHeight(index) : 0.02;
        const powered = (city.utility[index] & POWER_BIT) !== 0;
        const ox = isRoad(city, index) ? 2.4 : 0;
        const oz = isRoad(city, index) ? 2.4 : 0;
        const px = world.x + ox;
        const pz = world.z + oz;
        if (poles < 400) {
          this.put(this.lampPoles, poles, px, crest + 2.1, pz, 1, 4.2, 1, 0, 0x3a3f46);
          poles += 1;
        }
        if (bulbs < 400) {
          this.put(this.streetLamps, bulbs, px, crest + 4.35, pz, powered && this.nightLit ? 1.15 : 0.7, powered && this.nightLit ? 1.15 : 0.7, powered && this.nightLit ? 1.15 : 0.7, 0, powered ? 0xffe6b0 : 0x6a655c);
          bulbs += 1;
        }
        if (this.nightLit && powered && glows + 1 < 700) {
          this.put(this.nightGlows, glows, px, crest + 2.2, pz, 14, 7, 14, 0, 0xffd089);
          glows += 1;
        }
      }
      if (!this.nightLit) continue;
      const building = city.levels[index] > 0 || (city.services[index] !== ServiceKind.None && city.services[index] !== ServiceKind.Lamp);
      if (!building) continue;
      if ((city.utility[index] & POWER_BIT) === 0) continue;
      if (glows >= 700) continue;
      const height = city.levels[index] > 0 ? 1.2 + city.levels[index] * 0.55 : 2.4;
      const radius = city.services[index] === ServiceKind.Airport ? 18 : city.levels[index] >= 5 ? 11 : 8;
      this.put(this.nightGlows, glows, world.x, height, world.z, radius, radius * 0.55, radius, 0, 0xffe2b0);
      glows += 1;
    }
    this.finish(this.lampPoles, poles);
    this.finish(this.streetLamps, bulbs);
    this.finish(this.nightGlows, glows);
  }

  private updateRain(dt: number, target: THREE.Vector3, _climate: Climate): void {
    if (!this.rain.visible) return;
    this.rain.position.set(target.x, 0, target.z);
    const speed = 38 * dt;
    for (let i = 0; i < 900; i += 1) {
      let y = this.rainPositions[i * 3 + 1] - speed * (0.7 + (i % 5) * 0.12);
      if (y < 0) {
        y = 55 + Math.random() * 30;
        this.rainPositions[i * 3] = (Math.random() - 0.5) * 220;
        this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 220;
      }
      this.rainPositions[i * 3 + 1] = y;
    }
    const attr = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
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
      const shape =
        (city.zones[cell] === Zone.Farm
          ? modelForFarm(city.skills[cell])
          : modelForZone(city.zones[cell], city.levels[cell]))
        ?? modelForService(city.services[cell]);
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
    const heat = Math.min(1, (load / 255) * (0.35 + this.streetActivity * 1.15));
    this.tint.setRGB(0.2 + heat * 0.45, 0.22 - heat * 0.08, 0.24 - heat * 0.1);
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

  private placeModel(key: string, x: number, z: number, color: number, cell = -1): void {
    const instances = this.models.get(key);
    if (!instances) return;
    const slot = this.modelSlot.get(key) ?? 0;
    if (slot >= 700) return;
    const scale = cell >= 0 ? this.birthScale(cell) : 1;
    this.put(instances, slot, x, 0, z, scale, scale, scale, 0, color);
    this.modelSlot.set(key, slot + 1);
  }

  private birthScale(index: number): number {
    const born = this.births.get(index);
    if (born === undefined) return 1;
    const t = (performance.now() - born) / 420;
    if (t >= 1) {
      this.births.delete(index);
      return 1;
    }
    const u = 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
    return 0.2 + u * 0.8;
  }

  private rebuildGround(city: CityState): void {
    let hash = 2166136261;
    for (let index = 0; index < city.terrain.length; index += 1) {
      hash ^= city.terrain[index];
      hash = Math.imul(hash, 16777619);
    }
    const stamp = `${hash}:${city.gen?.biome ?? "temperate"}`;
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
    uniforms: { uTime: { value: 0 }, uShade: { value: 1 } },
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
      uniform float uShade;
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.10, 0.34, 0.55);
        vec3 mid = vec3(0.20, 0.55, 0.74);
        vec3 foam = vec3(0.78, 0.90, 0.94);
        float crest = smoothstep(0.02, 0.07, vWave);
        vec3 color = mix(deep, mid, clamp(vWave * 6.0 + 0.45, 0.0, 1.0));
        color = mix(color, foam, crest * 0.55);
        color *= uShade;
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

/** Amber badge: lightning + water drop for missing utilities. */
function utilityBadge(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#1f2420";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e2b15a";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#e2b15a";
  ctx.beginPath();
  ctx.moveTo(28, 12);
  ctx.lineTo(18, 32);
  ctx.lineTo(28, 32);
  ctx.lineTo(24, 52);
  ctx.lineTo(42, 28);
  ctx.lineTo(32, 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#5eb0e0";
  ctx.beginPath();
  ctx.moveTo(46, 18);
  ctx.bezierCurveTo(52, 28, 52, 36, 46, 42);
  ctx.bezierCurveTo(40, 36, 40, 28, 46, 18);
  ctx.fill();
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

function treeTint(biome: BiomeId, roll: number): number {
  if (biome === "arid") return roll % 2 === 0 ? 0x8a9460 : 0x6f7a48;
  if (biome === "alpine") return roll % 2 === 0 ? 0x1f4a38 : 0x2d5e44;
  if (biome === "tropical") return roll % 2 === 0 ? 0x1f6e36 : 0x2f8a42;
  if (biome === "archipelago") return roll % 2 === 0 ? 0x356f3c : 0x4a8a4e;
  return roll % 2 === 0 ? 0x2f5a34 : 0x4e7d43;
}

function groundPalette(biome: BiomeId): [number, number, number] {
  if (biome === "arid") return [0xb6a678, 0xc4b486, 0xa89468];
  if (biome === "alpine") return [0x5d7a58, 0x6a8a64, 0x516e4c];
  if (biome === "tropical") return [0x3f8a48, 0x4c9a52, 0x357a3e];
  if (biome === "archipelago") return [0x6d9258, 0x7aa264, 0x5f8450];
  return [0x6d8f55, 0x78985c, 0x61824c];
}

function islandSurface(city: CityState): { ground: THREE.BufferGeometry; plot: THREE.LineSegments["geometry"] } {
  const cols = city.width + 1;
  const rows = city.height + 1;
  const pointX = new Float32Array(cols * rows);
  const pointZ = new Float32Array(cols * rows);
  const half = (city.width * CELL_SIZE) / 2;
  const biome = city.gen?.biome ?? "temperate";
  const palette = groundPalette(biome);
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
  const earth = new THREE.Color(biome === "arid" ? 0x6a5a3c : 0x3d4a32);
  const paint = (x: number, y: number) => {
    const roll = scatter(x, y) % 3;
    grass.set(palette[roll] ?? palette[0]);
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
