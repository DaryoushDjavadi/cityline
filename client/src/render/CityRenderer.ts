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
  cellHeight,
  cellToWorld,
  climateAt,
  inBounds,
  computeTraffic,
  helpBadges,
  powerOutageBadges,
  utilityOutageBadges,
  waterOutageBadges,
  isBeach,
  isBridge,
  isLine,
  isPipe,
  isRoad,
  populationOf,
  lifeActivity,
  isWater,
  occupancyStamp,
  oceanMask,
  cellFlattened,
  vegetationRoll,
  vertexHeight,
  vertexSand,
  waterDir,
  type BiomeId,
  type CityState,
  type Climate,
} from "../../../shared/src/index.ts";
import { beachVisitors, streetCars, streetPedestrians, tradeTourists, type BeachVisitor, type StreetCar, type StreetPedestrian, type TradeTourist } from "../../../shared/src/people.ts";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { applyLook, COLOR_GRADE, createAtmosphere, goldenAmount, nightAmount, nightWindowCompile, poseSun, seaMaterial, type Atmosphere } from "./look.ts";
import { AmbientLayer, crowdScale, planAmbient } from "./ambient.ts";
import { gfxProfile, loadGfxPreset, type GfxPreset, type GfxProfile } from "./quality.ts";
import {
  buildBoatGeometry,
  buildCarModels,
  buildCraneGeometry,
  buildWheelRimGeometry,
  buildFoamGeometry,
  buildGrassTuftGeometry,
  buildModels,
  buildPersonModels,
  buildPlaneGeometry,
  buildTowelGeometry,
  buildUmbrellaGeometry,
  buildWakeGeometry,
  buildTreeModels,
  modelForFarm,
  modelForService,
  modelForZone,
  type PersonPose,
} from "./models.ts";

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
  happy: boolean;
}

interface Overlays {
  zones: boolean;
  power: boolean;
  water: boolean;
}

interface Flight {
  cell: number;
  phase: number;
  parked?: boolean;
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
  private readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly atmosphere: Atmosphere;
  private quality: GfxProfile;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private readonly windowNight = { value: 0 };
  private weatherOverride: Climate["weather"] | null = null;
  private frameIndex = 0;
  lastFrameMs = 16;
  /** Perf probes (rolling, exposed via window.__cityline). */
  lastSyncMs = 0;
  lastUpdateMs = 0;
  drawCalls = 0;
  triangles = 0;
  private readonly shadowCasters: THREE.Object3D[] = [];
  private decorations = true;
  private readonly people: THREE.InstancedMesh;
  private readonly headlights: THREE.InstancedMesh;
  private readonly streetLamps: THREE.InstancedMesh;
  private readonly lampPoles: THREE.InstancedMesh;
  private readonly nightGlows: THREE.InstancedMesh;
  private readonly rain: THREE.Points;
  private readonly rainPositions: Float32Array;
  private pedestrians: Pedestrian[] = [];
  private beachCrowd: BeachVisitor[] = [];
  private tourists: TradeTourist[] = [];
  private readonly personBodies = new Map<PersonPose, THREE.InstancedMesh>();
  private readonly personHeads = new Map<PersonPose, THREE.InstancedMesh>();
  private readonly personBodySlot = new Map<PersonPose, number>();
  private readonly personHeadSlot = new Map<PersonPose, number>();
  private readonly towels: THREE.InstancedMesh;
  private readonly ambient: AmbientLayer;
  private ambientStamp = "";
  private ambientPlannedAt = 0;
  private population = 0;
  private readonly umbrellas: THREE.InstancedMesh;
  private readonly smileys: THREE.InstancedMesh;
  private readonly smileyDummy = new THREE.Object3D();
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
  private readonly locks: THREE.InstancedMesh;
  private readonly carMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly carSlots = new Map<string, number>();
  private readonly corners: THREE.InstancedMesh;
  private readonly cornerCurbs: THREE.InstancedMesh;
  private readonly cables: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private readonly pipeMesh: THREE.InstancedMesh;
  private readonly roofs: THREE.InstancedMesh;
  private readonly treeMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly treeSlots = new Map<string, number>();
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
  private readonly powerOutBadges: THREE.Sprite[] = [];
  private readonly waterOutBadges: THREE.Sprite[] = [];
  private readonly idleMaterial: THREE.SpriteMaterial;
  private readonly jobMaterial: THREE.SpriteMaterial;
  private readonly utilityMaterial: THREE.SpriteMaterial;
  private readonly powerOutMaterial: THREE.SpriteMaterial;
  private readonly waterOutMaterial: THREE.SpriteMaterial;
  private badgeTime = 0;
  private readonly hover: THREE.LineLoop;
  private readonly peerMarks: THREE.Group[] = [];
  private readonly graph = new Map<number, number[]>();
  private shown: CityState | null = null;
  private walkers: Walker[] = [];
  private roadStamp = "";
  /** Signature of everything the static grid pass draws; unchanged ticks skip the rebuild. */
  private staticStamp = "";
  /** Instances still popping in; animated in place instead of a full rebuild per frame. */
  private birthSlots: { mesh: THREE.InstancedMesh; slot: number; x: number; y: number; z: number; rotY: number; color: number; cell: number; base: number }[] = [];
  private traffic: Uint8Array<ArrayBufferLike> = new Uint8Array(CAP);
  private readonly planes: THREE.InstancedMesh;
  private readonly cargoBoats: THREE.InstancedMesh;
  private readonly fishBoats: THREE.InstancedMesh;
  private readonly ferryBoats: THREE.InstancedMesh;
  private readonly cranes: THREE.InstancedMesh;
  private readonly wheelRims: THREE.InstancedMesh;
  private wheelCells: number[] = [];
  private readonly wakes: THREE.InstancedMesh;
  private readonly foam: THREE.InstancedMesh;
  private readonly tufts: THREE.InstancedMesh;
  private flights: Flight[] = [];
  private boats: { cell: number; phase: number; kind: "cargo" | "fish" | "ferry"; lane: number; docked?: boolean }[] = [];
  private flightTime = 0;
  private foamCells: number[] = [];
  private landMap: THREE.DataTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = gfxProfile(loadGfxPreset(), window.devicePixelRatio || 1);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.level !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(0x7eb3d8);
    this.fog = new THREE.Fog(0x3f8fc8, 2400, 5200);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xfff6ea, 0x4d6a40, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.85);
    this.sun.target.position.set(0, 0, 0);
    this.configureSunShadow();
    this.fill = new THREE.DirectionalLight(0xb7d4e8, 0.28);
    this.fill.target.position.set(0, 0, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);

    this.atmosphere = createAtmosphere();
    this.atmosphere.clouds.visible = this.quality.clouds;
    this.atmosphere.stars.visible = this.quality.stars;
    this.scene.add(this.atmosphere.sky, this.atmosphere.clouds, this.atmosphere.stars, this.atmosphere.moon, this.atmosphere.sunDisc);

    const sea = new THREE.PlaneGeometry(5200, 5200, this.quality.seaSegments, this.quality.seaSegments);
    sea.rotateX(-Math.PI / 2);
    this.seaMaterial = seaMaterial();
    const ocean = new THREE.Mesh(sea, this.seaMaterial);
    ocean.position.y = -0.32;
    ocean.frustumCulled = false;
    ocean.receiveShadow = this.quality.shadows;
    this.scene.add(ocean);
    this.ground = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    );
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 1;
    this.ground.receiveShadow = true;
    this.plot = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x6a7a48, transparent: true, opacity: 0.08 }),
    );
    this.plot.frustumCulled = false;
    this.scene.add(this.ground, this.plot);

    const lit = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.04 });
    lit.shadowSide = THREE.FrontSide;
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
    const pad = new THREE.BoxGeometry(1, 1, 1);
    this.power = mesh(pad, flat(0xf0c14a, 0.78));
    this.water = mesh(pad, flat(0x3d88c8, 0.76));
    this.preview = mesh(pad, flat(0xffffff, 1));
    this.power.renderOrder = 3;
    this.water.renderOrder = 3;
    this.preview.renderOrder = 12;
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
    this.people = mesh(new THREE.CapsuleGeometry(0.28, 0.85, 3, 6), lit, 8);
    const personMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04 });
    const personCap = 192;
    for (const model of buildPersonModels()) {
      const bodies = new THREE.InstancedMesh(model.body, personMat, personCap);
      bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(personCap * 3), 3);
      bodies.count = 0;
      bodies.frustumCulled = false;
      const heads = new THREE.InstancedMesh(model.head, personMat, personCap);
      heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(personCap * 3), 3);
      heads.count = 0;
      heads.frustumCulled = false;
      this.personBodies.set(model.key, bodies);
      this.personHeads.set(model.key, heads);
      this.personBodySlot.set(model.key, 0);
      this.personHeadSlot.set(model.key, 0);
      this.scene.add(bodies, heads);
    }
    this.ambient = new AmbientLayer(this.scene);
    this.towels = mesh(buildTowelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 48);
    this.umbrellas = mesh(buildUmbrellaGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), 24);
    const smileMap = smileyTexture();
    this.smileys = mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ map: smileMap, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      80,
    );
    this.headlights = mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
      160,
    );
    this.lampPoles = mesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), lit, 400);
    this.streetLamps = mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc56a }),
      400,
    );
    this.nightGlows = mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffc070,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      700,
    );
    this.planes = mesh(buildPlaneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.12 }), 24);
    const boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.12 });
    this.cargoBoats = mesh(buildBoatGeometry("cargo"), boatMat, 16);
    this.fishBoats = mesh(buildBoatGeometry("fish"), boatMat, 16);
    this.ferryBoats = mesh(buildBoatGeometry("ferry"), boatMat, 12);
    this.cranes = mesh(buildCraneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.18 }), 8);
    this.wheelRims = mesh(buildWheelRimGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.12 }), 4);
    this.wakes = mesh(
      buildWakeGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
      24,
    );
    this.foam = mesh(
      buildFoamGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xf4f8fb, transparent: true, opacity: 0.7, depthWrite: false }),
      220,
    );
    this.tufts = mesh(buildGrassTuftGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 400);
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
    this.stones = mesh(new THREE.DodecahedronGeometry(0.55, 0), lit);
    this.lakes = mesh(plane, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.08, fog: false }));
    const litBuildings = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.06 });
    litBuildings.onBeforeCompile = (shader) => {
      nightWindowCompile(shader);
      shader.uniforms.uNightWindows = this.windowNight;
    };
    litBuildings.customProgramCacheKey = () => "cityline-windows";
    for (const model of buildModels()) {
      const instances = new THREE.InstancedMesh(model.geometry, litBuildings, 700);
      instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3);
      instances.count = 0;
      instances.frustumCulled = false;
      this.models.set(model.key, instances);
      this.modelSlot.set(model.key, 0);
      this.shadowCasters.push(instances);
      this.scene.add(instances);
    }
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    for (const model of buildTreeModels()) {
      const instances = new THREE.InstancedMesh(model.geometry, treeMat, CAP);
      instances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      instances.count = 0;
      instances.frustumCulled = false;
      this.treeMeshes.set(model.key, instances);
      this.treeSlots.set(model.key, 0);
      this.shadowCasters.push(instances);
      this.scene.add(instances);
    }
    this.rebuildComposer();
    this.applyShadowFlags();
    this.idleMaterial = new THREE.SpriteMaterial({ map: personBadge(), transparent: true, depthWrite: false });
    this.jobMaterial = new THREE.SpriteMaterial({ map: jobBadge(), transparent: true, depthWrite: false });
    this.utilityMaterial = new THREE.SpriteMaterial({ map: utilityBadge(), transparent: true, depthWrite: false });
    this.powerOutMaterial = new THREE.SpriteMaterial({ map: powerOutBadge(), transparent: true, depthWrite: false, depthTest: false });
    this.waterOutMaterial = new THREE.SpriteMaterial({ map: waterOutBadge(), transparent: true, depthWrite: false, depthTest: false });
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
      this.stones,
      this.poles,
      this.cables,
      this.preview,
      this.radiusRing,
      this.locks,
      this.people,
      this.towels,
      this.umbrellas,
      this.smileys,
      this.cargoBoats,
      this.fishBoats,
      this.ferryBoats,
      this.cranes,
      this.wheelRims,
      this.wakes,
      this.foam,
      this.tufts,
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
    this.composer?.setSize(width, height);
    this.bloom?.setSize(width, height);
  }

  setQuality(preset: GfxPreset): void {
    this.quality = gfxProfile(preset, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.configureSunShadow();
    this.applyShadowFlags();
    this.rebuildComposer();
    this.atmosphere.clouds.visible = this.quality.clouds && !this.nightLit;
    this.atmosphere.stars.visible = this.quality.stars && this.nightLit;
    this.climateStamp = "";
  }

  gfxLevel(): GfxProfile {
    return this.quality;
  }

  setWeatherOverride(weather: Climate["weather"] | null): void {
    this.weatherOverride = weather;
    this.climateStamp = "";
  }

  setDecorations(on: boolean): void {
    this.decorations = on;
  }

  /** Fresh builds pop in for a short beat. */
  noteBuilt(cells: readonly number[]): void {
    const now = performance.now();
    for (const cell of cells) this.births.set(cell, now);
  }

  sync(city: CityState, overlays: Overlays): void {
    this.shown = city;
    this.traffic = computeTraffic(city).load;
    this.population = populationOf(city);
    if (this.roadsChanged(city)) this.rebuildGraph(city);
    this.syncCars(city);
    this.syncPedestrians(city);
    this.syncFlights(city);
    this.syncBoats(city);
    this.beachCrowd = beachVisitors(city, this.quality.level === "low" ? 10 : this.quality.level === "medium" ? 22 : 36);
    this.tourists = tradeTourists(city, this.quality.level === "low" ? 4 : this.quality.level === "medium" ? 8 : 12);
    this.rebuildGround(city);
    const stamp = this.staticSignature(city, overlays);
    this.syncAmbient(city, stamp);
    if (stamp === this.staticStamp) {
      this.paintCars();
      this.paintPedestrians();
      this.paintPlanes();
      this.paintBoats();
      return;
    }
    this.staticStamp = stamp;
    this.birthSlots = [];
    this.wheelCells = [];

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
    let stones = 0;
    let lakes = 0;
    let tufts = 0;
    this.foamCells = [];
    for (const key of this.modelSlot.keys()) this.modelSlot.set(key, 0);
    for (const key of this.treeSlots.keys()) this.treeSlots.set(key, 0);
    const count = city.width * city.height;

    for (let index = 0; index < count; index += 1) {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      if (isBeach(city, index)) this.foamCells.push(index);
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
        const gy = this.heightOf(index);
        if (bend === undefined) {
          const laid = this.layRoad(world.x, world.z, mask, asphalt, curbs, roads, gy);
          curbs = laid.curbs;
          roads = laid.roads;
          if (mask === 0b0101 || mask === 0b1010) {
            const east = mask === 0b1010;
            this.put(this.markings, marks, world.x, gy + 0.18, world.z, east ? CELL_SIZE * 0.55 : CELL_SIZE * 0.08, 0.04, east ? CELL_SIZE * 0.08 : CELL_SIZE * 0.55, 0, 0xffffff);
            marks += 1;
            if ((x + y) % 4 === 0) {
              this.put(this.poles, poles, world.x + (east ? 0 : 3.4), gy + 1.1, world.z + (east ? 3.4 : 0), 0.28, 2.2, 0.28, 0, 0xded3b4);
              poles += 1;
            }
          }
        } else {
          this.put(this.cornerCurbs, bends, world.x, gy, world.z, CELL_SIZE, 1, CELL_SIZE, bend, 0xd2c8b4);
          this.put(this.corners, bends, world.x, gy, world.z, CELL_SIZE, 1, CELL_SIZE, bend, asphalt);
          bends += 1;
        }
      }
      if (isLine(city, index)) {
        const live = (city.utility[index] & POWER_BIT) !== 0;
        const color = live ? 0xf0c14a : 0x5c5348;
        const raised = isBridge(city, index) ? bridgeCrest(city, index) + 3.4 : isWater(city, index) ? 4.6 : this.heightOf(index) + 2.45;
        this.put(this.poles, poles, world.x, raised / 2, world.z, 0.35, raised, 0.35, 0, 0x6d6458);
        poles += 1;
        cables = this.layConductor(this.cables, cables, index, city.lines, world.x, world.z, raised, overlays.power ? 0.28 : 0.16, color);
        if (overlays.power) {
          this.put(this.power, powerCount, world.x, this.heightOf(index) + 0.42, world.z, CELL_SIZE * 0.94, 0.48, CELL_SIZE * 0.94, 0, live ? 0xffd45a : 0x6a6358);
          powerCount += 1;
        }
      }
      if (isPipe(city, index)) {
        const live = (city.utility[index] & WATER_BIT) !== 0;
        const color = live ? 0x3d88c8 : 0x6a7c86;
        const pipeY = isBridge(city, index) ? bridgeCrest(city, index) + 0.45 : isWater(city, index) ? 0.55 : this.heightOf(index) + 0.22;
        pipes = this.layConductor(this.pipeMesh, pipes, index, city.pipes, world.x, world.z, pipeY, overlays.water ? 0.48 : 0.35, color);
        if (overlays.water) {
          this.put(this.water, waterCount, world.x, this.heightOf(index) + 0.36, world.z, CELL_SIZE * 0.9, 0.42, CELL_SIZE * 0.9, 0, live ? 0x4ea6e6 : 0x6a7c86);
          waterCount += 1;
        }
      }

      if (overlays.power && (city.levels[index] > 0 || city.services[index] === ServiceKind.Power || isHubService(city.services[index]))) {
        const live = (city.utility[index] & POWER_BIT) !== 0;
        this.put(this.power, powerCount, world.x, this.heightOf(index) + 0.4, world.z, CELL_SIZE * 0.86, 0.55, CELL_SIZE * 0.86, 0, live ? 0xffe08a : 0x8a3d36);
        powerCount += 1;
      }
      if (overlays.water && (city.levels[index] > 0 || city.services[index] === ServiceKind.Water || isHubService(city.services[index]))) {
        const live = (city.utility[index] & WATER_BIT) !== 0;
        this.put(this.water, waterCount, world.x, this.heightOf(index) + 0.28, world.z, CELL_SIZE * 0.78, 0.42, CELL_SIZE * 0.78, 0, live ? 0x6cbcf0 : 0x4a5a66);
        waterCount += 1;
      }

      if (overlays.zones && city.zones[index] !== Zone.None && !isRoad(city, index)) {
        const color =
          city.zones[index] === Zone.Residential ? 0x3f9d55
          : city.zones[index] === Zone.Commercial ? 0x2f86c6
          : city.zones[index] === Zone.Farm
            ? ((city.skills[index] & 0b1000) !== 0 ? 0x7a9a55 : 0xc4b44a)
          : 0xd0892b;
        this.put(this.zones, zoneCount, world.x, this.heightOf(index) + 0.08, world.z, CELL_SIZE * 0.92, 1, CELL_SIZE * 0.92, 0, color);
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
          this.placeModel(shape.key, world.x, world.z, powered ? (nightWarm ? 0xfff1d2 : 0xffffff) : 0x8d847c, index, this.heightOf(index));
        }
      }

      const service = city.services[index];
      if (service === ServiceKind.Wheel) this.wheelCells.push(index);
      if (service === ServiceKind.Lamp) {
        // Poles and night glow are drawn in paintLocalLights.
      } else {
      const served = modelForService(service);
      if (served) {
        const airportLit =
          !isHubService(service) || (city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT);
        const nightWarm = this.nightLit && airportLit && (city.utility[index] & POWER_BIT) !== 0;
        const facing = service === ServiceKind.Harbor ? Math.atan2(waterDir(city, x, y).dx, waterDir(city, x, y).dy) : 0;
        this.placeModel(served.key, world.x, world.z, airportLit ? (nightWarm ? 0xfff1d2 : 0xffffff) : 0x8d847c, index, this.heightOf(index), facing);
      } else if (!isRoad(city, index) && !isLine(city, index) && !isPipe(city, index) && city.zones[index] === Zone.None && city.services[index] === ServiceKind.None && !isWater(city, index) && !isBeach(city, index)) {
        const forest = city.gen?.forest ?? 50;
        const seed = city.gen?.seed ?? 1;
        const biome = city.gen?.biome ?? "temperate";
        const canopy = vegetationRoll(x, y, seed);
        const jx = ((scatter(x + 3, y) % 7) - 3) * 0.7;
        const jz = ((scatter(x, y + 5) % 7) - 3) * 0.7;
        const stoneChance = biome === "arid" ? 28 : biome === "alpine" ? 18 : 10;
        if (canopy < forest * 0.72) {
          const tall = (biome === "alpine" ? 2.6 : biome === "tropical" ? 2.8 : 2.1) + (scatter(x, y) % 5) * 0.35;
          const key = biome === "alpine" ? `tree${3 + (scatter(x, y) % 3)}` : `tree${scatter(x, y) % 6}`;
          const mesh = this.treeMeshes.get(key) ?? this.treeMeshes.get("tree0");
          const slot = this.treeSlots.get(key) ?? this.treeSlots.get("tree0") ?? 0;
          if (mesh && slot < CAP) {
            this.put(mesh, slot, world.x + jx, this.heightOf(index), world.z + jz, 2.4 + (canopy % 3) * 0.35, tall * 1.15, 2.4, (scatter(x, y) % 6) * 0.5, 0xffffff);
            this.treeSlots.set(key, slot + 1);
          }
        } else if (this.quality.level !== "low" && !cellFlattened(city, index) && this.heightOf(index) > 0.55 && vegetationRoll(x + 2, y + 9, seed) < 36 && tufts < 400) {
          this.put(this.tufts, tufts, world.x + jx * 0.4, this.heightOf(index), world.z + jz * 0.4, 1.3, 1.1 + (canopy % 3) * 0.2, 1.3, (scatter(x, y) % 6) * 0.4, 0xffffff);
          tufts += 1;
        } else if (vegetationRoll(x + 11, y + 5, seed) < stoneChance) {
          const size = 1.1 + (scatter(y, x) % 4) * 0.35;
          this.put(this.stones, stones, world.x + jx, this.heightOf(index) + size * 0.35, world.z + jz, size, size * 0.7, size * 0.85, (scatter(x, y) % 5) * 0.4, biome === "arid" ? 0xa89878 : 0x8d877c);
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
    for (const [key, instances] of this.treeMeshes) this.finish(instances, this.treeSlots.get(key) ?? 0);
    this.finish(this.stones, stones);
    this.finish(this.lakes, lakes);
    this.finish(this.tufts, this.quality.level === "low" ? 0 : tufts);
    for (const [key, instances] of this.models) this.finish(instances, this.modelSlot.get(key) ?? 0);
    const badges = this.decorations ? helpBadges(city) : { homes: [], workplaces: [] };
    this.placeBadges(this.idleBadges, this.idleMaterial, overlays.power || overlays.water ? [] : badges.homes, city, 4.8);
    this.placeBadges(this.jobBadges, this.jobMaterial, overlays.power || overlays.water ? [] : badges.workplaces, city, 4.6);
    const mixedOut = this.decorations && !overlays.power && !overlays.water;
    this.placeBadges(this.utilityBadges, this.utilityMaterial, mixedOut ? utilityOutageBadges(city) : [], city, 5.4);
    this.placeBadges(this.powerOutBadges, this.powerOutMaterial, overlays.power ? powerOutageBadges(city) : [], city, 8.2);
    this.placeBadges(this.waterOutBadges, this.waterOutMaterial, overlays.water ? waterOutageBadges(city) : [], city, 8.2);
    this.paintCars();
    this.paintPedestrians();
    this.paintPlanes();
    this.paintBoats();
    this.paintCranes();
    this.paintFoam();
    this.paintLocalLights();
  }

  setPreview(city: CityState, cells: number[], legal: boolean[], radius = 0, supplied: boolean[] = []): void {
    cells.forEach((index, slot) => {
      const { x, y } = cellCoords(city, index);
      const world = cellToWorld(city, x, y);
      const color = !legal[slot] ? 0xff6b5b : supplied[slot] === false ? 0xffc14a : 0xb8ff4a;
      this.put(this.preview, slot, world.x, this.heightOf(index) + 0.72, world.z, CELL_SIZE * 0.96, 0.9, CELL_SIZE * 0.96, 0, color);
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
      this.put(this.locks, slot, world.x, this.heightOf(index) + 0.24, world.z, CELL_SIZE * 0.95, 1, CELL_SIZE * 0.95, 0, 0xff9a3c);
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
    this.hover.position.set(world.x, this.heightOf(index) + 0.3, world.z);
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
      sprite.scale.setScalar((Number(sprite.userData.scale) || 5.4) * pulse);
    }
    for (const sprite of this.powerOutBadges) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob;
      sprite.scale.setScalar((Number(sprite.userData.scale) || 8.2) * pulse);
    }
    for (const sprite of this.waterOutBadges) {
      if (!sprite.visible) continue;
      sprite.position.y = Number(sprite.userData.baseY) + bob;
      sprite.scale.setScalar((Number(sprite.userData.scale) || 8.2) * pulse);
    }
    if (this.birthSlots.length > 0) this.animateBirths();
    this.flightTime += dt;
    if (this.flights.length > 0) this.paintPlanes();
    if (this.boats.length > 0) this.paintBoats();
    const dayAmt = 1 - nightAmount(climate.hour);
    this.ambient.paint(this.flightTime, dayAmt, this.quality.level !== "low", this.quality.level !== "low");
    // Clouds drift slowly instead of hanging still.
    this.atmosphere.clouds.position.set(Math.sin(this.seaTime * 0.012) * 46, 0, Math.cos(this.seaTime * 0.009) * 22);
    if (this.shown) {
      this.paintCranes();
      this.paintFoam();
      this.paintWheels();
    }
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
    const started = performance.now();
    this.renderer.info.reset();
    this.frameIndex += 1;
    if (this.quality.shadows && this.quality.shadowEvery > 0 && this.frameIndex % this.quality.shadowEvery === 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.faceSmileys(camera);
    if (this.composer && this.renderPass) {
      this.renderPass.camera = camera;
      this.composer.render();
    } else this.renderer.render(this.scene, camera);
    this.lastFrameMs = performance.now() - started;
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
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

  /** Residents, park visitors, smoke and birds: replanned on city change or every ~2 in-game hours. */
  private syncAmbient(city: CityState, stamp: string): void {
    const climate = climateAt(city.tick);
    const bucket = `${Math.floor(city.tick / 50)}:${climate.isNight ? 1 : 0}`;
    const key = `${stamp}:${bucket}`;
    if (key === this.ambientStamp) return;
    // A growing city changes the static stamp nearly every tick; replan at most every 1.5 s then.
    const now = performance.now();
    const sameBucket = this.ambientStamp.endsWith(`:${bucket}`);
    if (sameBucket && now - this.ambientPlannedAt < 1500) return;
    this.ambientStamp = key;
    this.ambientPlannedAt = now;
    const level = this.quality.level;
    const budget =
      level === "low" ? { people: 14, smoke: 0, flocks: 0 }
      : level === "medium" ? { people: 52, smoke: 96, flocks: 3 }
      : { people: 84, smoke: 156, flocks: 5 };
    this.ambient.setPlan(planAmbient(city, (index) => this.heightOf(index), lifeActivity(climate), budget, climate.isNight));
  }

  /** Counts for tests / perf probes. */
  lifeStats(): { cars: number; pedestrians: number; residents: number; smoke: number; birds: number; beach: number } {
    const ambient = this.ambient.stats();
    return { cars: this.walkers.length, pedestrians: this.pedestrians.length, residents: ambient.people, smoke: ambient.smoke, birds: ambient.birds, beach: this.beachCrowd.length };
  }

  private syncCars(city: CityState): void {
    const base = this.quality.level === "low" ? 28 : this.quality.level === "medium" ? 48 : 72;
    // Weak devices keep the old budget; medium/high scale with population.
    const scale = this.quality.level === "low" ? 1 : crowdScale(this.population);
    const roster = streetCars(city, Math.min(110, Math.round(base * scale)));
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
    const base = this.quality.level === "low" ? 18 : this.quality.level === "medium" ? 36 : 56;
    const roster = streetPedestrians(city, Math.round(base * (this.quality.level === "low" ? 1 : crowdScale(this.population))));
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
      happy: entry.happy,
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
    for (const key of this.personBodySlot.keys()) {
      this.personBodySlot.set(key, 0);
      this.personHeadSlot.set(key, 0);
    }
    this.finish(this.people, 0);
    let smiles = 0;
    let towels = 0;
    let umbrellas = 0;
    const low = this.quality.level === "low";
    for (const visitor of this.beachCrowd) {
      if (!this.shown) continue;
      const { x, y } = cellCoords(this.shown, visitor.cell);
      const world = cellToWorld(this.shown, x, y);
      const gy = this.heightOf(visitor.cell);
      const scale = (visitor.child ? 0.7 : 1) * (low ? 1.05 : visitor.pose === "swim" ? 2.15 : 1.42);
      const pose: PersonPose = low ? "low" : visitor.pose === "lie" ? "lie" : visitor.pose === "sit" ? "sit" : visitor.pose === "swim" ? "swim" : "idle";
      const px = world.x + visitor.ox;
      const pz = world.z + visitor.oz;
      const py = visitor.pose === "swim"
        ? BOAT_SEA_Y + 0.22 + Math.sin(this.flightTime * 2 + visitor.ox) * 0.08
        : visitor.pose === "lie"
          ? gy + 0.08
          : gy;
      this.placePerson(pose, px, py, pz, scale, visitor.ox * 0.4, visitor.color);
      if (visitor.pose === "lie" && towels < 48) {
        this.put(this.towels, towels, px, gy + 0.05, pz, 1, 1, 1, visitor.ox * 0.2, TOWEL_COLORS[hashCode(visitor.id) % TOWEL_COLORS.length]);
        towels += 1;
      }
      if (!low && (visitor.pose === "sit" || visitor.pose === "lie") && umbrellas < 24 && (hashCode(visitor.id) % 3) !== 0) {
        this.put(this.umbrellas, umbrellas, px + 0.7, gy, pz - 0.45, 1.2, 1.2, 1.2, visitor.ox * 0.15, 0xffffff);
        umbrellas += 1;
      }
      if (visitor.happy && smiles < 80) {
        this.put(this.smileys, smiles, px, py + (pose === "lie" || pose === "swim" ? 0.85 : 2.15 * scale), pz, 1, 1, 1, 0, 0xffffff);
        smiles += 1;
      }
    }
    for (const ped of this.pedestrians) {
      this.placePed(ped);
      const from = this.point(ped.from);
      const to = this.point(ped.to);
      const y = this.driveHeight(ped.from) + (this.driveHeight(ped.to) - this.driveHeight(ped.from)) * ped.t;
      const scale = (ped.child ? 0.72 : 1) * (low ? 1.05 : 1.42);
      const pose: PersonPose = low ? "low" : (Math.floor(ped.t * 8) % 2 === 0 ? "walkL" : "walkR");
      const rotY = Math.atan2(to.x - from.x, to.z - from.z);
      this.placePerson(pose, ped.x, y, ped.z, scale, rotY, ped.color);
      if (ped.happy && (!low || smiles < 6) && smiles < 80) {
        this.put(this.smileys, smiles, ped.x, y + 2.15 * scale, ped.z, 1, 1, 1, 0, 0xffffff);
        smiles += 1;
      }
    }
    for (const tourist of this.tourists) {
      const from = this.point(tourist.from);
      const to = this.point(tourist.to);
      const cycle = 12;
      const t = ((this.flightTime + tourist.phase) % cycle) / cycle;
      const u = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
      const px = from.x + (to.x - from.x) * u;
      const pz = from.z + (to.z - from.z) * u;
      const gy = this.heightOf(tourist.from) + (this.heightOf(tourist.to) - this.heightOf(tourist.from)) * u;
      const scale = (tourist.child ? 0.72 : 1) * (low ? 1.05 : 1.42);
      const pose: PersonPose = low ? "low" : (Math.floor(u * 10) % 2 === 0 ? "walkL" : "walkR");
      const rotY = Math.atan2(to.x - from.x, to.z - from.z) + (t < 0.5 ? 0 : Math.PI);
      this.placePerson(pose, px, gy, pz, scale, rotY, tourist.color);
      if (tourist.happy && smiles < 80) {
        this.put(this.smileys, smiles, px, gy + 2.15 * scale, pz, 1, 1, 1, 0, 0xffffff);
        smiles += 1;
      }
    }
    for (const person of this.ambient.people) {
      const scale = (person.child ? 0.72 : 1) * (low ? 1.05 : 1.42);
      const pose: PersonPose = low ? "low" : person.pose;
      // Idle chatter: a slow turn of the shoulders.
      const sway = Math.sin(this.flightTime * 0.6 + person.phase) * 0.35;
      this.placePerson(pose, person.x, person.y, person.z, scale, person.rotY + sway, person.color);
    }
    for (const [key, instances] of this.personBodies) this.finish(instances, this.personBodySlot.get(key) ?? 0);
    for (const [key, instances] of this.personHeads) this.finish(instances, this.personHeadSlot.get(key) ?? 0);
    this.finish(this.towels, this.quality.level === "low" ? 0 : towels);
    this.finish(this.umbrellas, this.quality.level === "low" ? 0 : umbrellas);
    this.finish(this.smileys, smiles);
  }

  private placePerson(pose: PersonPose, x: number, y: number, z: number, scale: number, rotY: number, cloth: number): void {
    const bodies = this.personBodies.get(pose);
    const heads = this.personHeads.get(pose);
    if (!bodies || !heads) return;
    const slot = this.personBodySlot.get(pose) ?? 0;
    if (slot >= 192) return;
    this.put(bodies, slot, x, y, z, scale, scale, scale, rotY, cloth);
    this.put(heads, slot, x, y, z, scale, scale, scale, rotY, 0xffffff);
    this.personBodySlot.set(pose, slot + 1);
    this.personHeadSlot.set(pose, slot + 1);
  }

  private applyClimate(climate: Climate, target: THREE.Vector3): void {
    const weather = this.weatherOverride ?? climate.weather;
    const lookClimate = weather === climate.weather ? climate : { ...climate, weather, weatherLabel: weather === "rain" ? "Regen" : weather === "cloud" ? "Bewölkt" : "Klar" };
    this.streetActivity = lookClimate.streetActivity;
    this.rainyPace = lookClimate.weather === "rain" ? 0.72 : 1;
    const day = lookClimate.daylight;
    const sunPos = poseSun(lookClimate.hour, target);
    this.sun.position.copy(sunPos);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(target.x * 2 - sunPos.x, 36, target.z * 2 - sunPos.z);
    this.fill.target.position.copy(target);
    this.seaMaterial.uniforms.uSunDir.value.copy(sunPos).sub(target).normalize();
    this.atmosphere.sky.position.copy(target);
    this.atmosphere.stars.position.copy(target);
    const stamp = `${lookClimate.clock}:${lookClimate.weather}:${day.toFixed(2)}:${this.quality.level}`;
    if (stamp === this.climateStamp) return;
    this.climateStamp = stamp;
    const stamped = applyLook(
      lookClimate,
      this.hemi,
      this.sun,
      this.fill,
      this.fog,
      this.atmosphere.skyMaterial,
      this.seaMaterial,
      this.atmosphere.clouds,
      this.atmosphere.stars,
      this.atmosphere.moon,
      this.atmosphere.sunDisc,
      target,
      this.quality,
    );
    this.nightLit = stamped.nightLit;
    this.windowNight.value = Math.max(Math.min(1, nightAmount(lookClimate.hour) * 1.6), goldenAmount(lookClimate.hour) * 0.12);
    this.renderer.toneMappingExposure = stamped.exposure;
    this.scene.background = this.atmosphere.skyMaterial.uniforms.uZenith.value;
    this.rain.visible = lookClimate.weather === "rain";
    if (this.bloom) {
      this.bloom.strength = this.nightLit ? 0.1 : 0.05;
      // Daytime bloom at 0.05 is invisible but costs ~10 full-screen passes.
      this.bloom.enabled = this.nightLit || goldenAmount(lookClimate.hour) > 0.4;
    }
    this.paintLocalLights();
  }

  private configureSunShadow(): void {
    this.sun.castShadow = this.quality.shadows;
    if (!this.quality.shadows) return;
    this.sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    this.sun.shadow.camera.near = 8;
    this.sun.shadow.camera.far = 720;
    this.sun.shadow.camera.left = -240;
    this.sun.shadow.camera.right = 240;
    this.sun.shadow.camera.top = 240;
    this.sun.shadow.camera.bottom = -240;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.7;
    this.sun.shadow.radius = 4;
  }

  private applyShadowFlags(): void {
    const on = this.quality.shadows;
    this.ground.receiveShadow = on;
    const extras = [
      this.curbs, this.asphalt, this.corners, this.cornerCurbs, this.buildings, this.roofs,
      this.services, this.poles, this.pipeMesh, this.stones, this.people, this.planes, this.lampPoles,
      this.cargoBoats, this.fishBoats, this.ferryBoats, this.cranes, this.tufts, this.wheelRims,
    ];
    for (const mesh of extras) {
      mesh.castShadow = on;
      mesh.receiveShadow = on;
    }
    for (const mesh of this.carMeshes.values()) {
      mesh.castShadow = on;
      mesh.receiveShadow = on;
    }
    for (const mesh of this.shadowCasters) {
      mesh.castShadow = on;
      mesh.receiveShadow = on;
    }
  }

  private rebuildComposer(): void {
    this.composer = null;
    this.bloom = null;
    this.renderPass = null;
    if (!this.quality.bloom) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    const pass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(pass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(size.x, 1), Math.max(size.y, 1)), 0.12, 0.4, 0.86);
    composer.addPass(bloom);
    composer.addPass(new ShaderPass(COLOR_GRADE));
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
    this.renderPass = pass;
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
        const crest = isRoad(city, index) ? this.driveHeight(index) : this.heightOf(index) + 0.02;
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
          this.put(this.streetLamps, bulbs, px, crest + 4.35, pz, powered && this.nightLit ? 1.35 : 0.7, powered && this.nightLit ? 1.35 : 0.7, powered && this.nightLit ? 1.35 : 0.7, 0, powered ? 0xffc56a : 0x6a655c);
          bulbs += 1;
        }
        if (this.nightLit && powered && glows + 1 < 700) {
          this.put(this.nightGlows, glows, px, crest + 2.2, pz, 7.4, 3.6, 7.4, 0, 0xffb45a);
          glows += 1;
        }
      }
      if (!this.nightLit) continue;
      const building = city.levels[index] > 0 || (city.services[index] !== ServiceKind.None && city.services[index] !== ServiceKind.Lamp);
      if (!building) continue;
      if ((city.utility[index] & POWER_BIT) === 0) continue;
      if (glows >= 700) continue;
      const height = this.heightOf(index) + (city.levels[index] > 0 ? 1.2 + city.levels[index] * 0.55 : 2.4);
      const radius = city.services[index] === ServiceKind.Airport || city.services[index] === ServiceKind.Harbor ? 8 : city.levels[index] >= 5 ? 5.5 : 4.2;
      this.put(this.nightGlows, glows, world.x, height, world.z, radius, radius * 0.45, radius, 0, 0xffe2b0);
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
      this.flights.push(kept.get(`${cell}:park`) ?? { cell, phase: 0, parked: true, x: 0, y: 0, z: 0, rotY: 0 });
    }
    if (this.flights.length === 0) this.finish(this.planes, 0);
  }

  private syncBoats(city: CityState): void {
    const harbors: number[] = [];
    for (let index = 0; index < city.services.length; index += 1) {
      if (city.services[index] === ServiceKind.Harbor) harbors.push(index);
    }
      const cargoN = this.quality.level === "low" ? 1 : this.quality.level === "medium" ? 2 : 3;
      const busy = Math.min(3, Math.floor(this.population / 900));
      const fishN = this.quality.level === "low" ? 0 : (this.quality.level === "medium" ? 1 : 2) + busy;
      const ferryN = this.quality.level === "low" ? 0 : 1;
      this.boats = [];
      for (const cell of harbors) {
        this.boats.push({ cell, phase: 0, kind: "cargo", lane: 0, docked: true });
        for (let i = 0; i < cargoN; i += 1) this.boats.push({ cell, phase: i * 7.5, kind: "cargo", lane: i + 1 });
        for (let i = 0; i < fishN; i += 1) this.boats.push({ cell, phase: i * 5.2 + 1.4, kind: "fish", lane: i });
        for (let i = 0; i < ferryN; i += 1) this.boats.push({ cell, phase: 3.2, kind: "ferry", lane: 0 });
      }
  }

  private paintBoats(): void {
    if (!this.shown) {
      this.finish(this.cargoBoats, 0);
      this.finish(this.fishBoats, 0);
      this.finish(this.ferryBoats, 0);
      this.finish(this.wakes, 0);
      return;
    }
    let cargo = 0;
    let fish = 0;
    let ferry = 0;
    let wakes = 0;
    const low = this.quality.level === "low";
    for (const boat of this.boats) {
      const pose = boatPose(this.shown, boat.cell, this.flightTime + boat.phase, boat.kind, boat.lane, boat.docked);
      const mesh = boat.kind === "cargo" ? this.cargoBoats : boat.kind === "fish" ? this.fishBoats : this.ferryBoats;
      const slot = boat.kind === "cargo" ? cargo : boat.kind === "fish" ? fish : ferry;
      const cap = boat.kind === "ferry" ? 12 : 16;
      if (slot >= cap) continue;
      const scale = boat.kind === "cargo" ? 1.58 : boat.kind === "ferry" ? 1.18 : 0.78;
      this.putEuler(mesh, slot, pose.x, pose.y, pose.z, scale, scale, scale, pose.rx, pose.rotY, pose.rz, 0xffffff);
      if (boat.kind === "cargo") cargo += 1;
      else if (boat.kind === "fish") fish += 1;
      else ferry += 1;
      if (!low && pose.speed > 0.2 && wakes < 24) {
        this.putEuler(this.wakes, wakes, pose.x, BOAT_SEA_Y + 0.04, pose.z, scale, 1, scale * (0.9 + pose.speed * 0.35), 0, pose.rotY, 0, 0xffffff);
        wakes += 1;
      }
    }
    this.finish(this.cargoBoats, cargo);
    this.finish(this.fishBoats, fish);
    this.finish(this.ferryBoats, ferry);
    this.finish(this.wakes, low ? 0 : wakes);
  }

  /** Landmark ferris wheels turn slowly (one turn ≈ 40 s). */
  private paintWheels(): void {
    if (!this.shown || this.wheelCells.length === 0) {
      this.finish(this.wheelRims, 0);
      return;
    }
    let count = 0;
    for (const index of this.wheelCells) {
      if (count >= 4) break;
      const { x, y } = cellCoords(this.shown, index);
      const world = cellToWorld(this.shown, x, y);
      const grow = this.birthScale(index);
      this.putEuler(this.wheelRims, count, world.x, this.heightOf(index) + 7.4 * grow, world.z, grow, grow, grow, 0, 0, this.flightTime * 0.16, 0xffffff);
      count += 1;
    }
    this.finish(this.wheelRims, count);
  }

  private paintCranes(): void {
    if (!this.shown) {
      this.finish(this.cranes, 0);
      return;
    }
    let count = 0;
    for (let index = 0; index < this.shown.services.length && count < 8; index += 1) {
      if (this.shown.services[index] !== ServiceKind.Harbor) continue;
      const { x, y } = cellCoords(this.shown, index);
      const world = cellToWorld(this.shown, x, y);
      const dir = waterDir(this.shown, x, y);
      const facing = Math.atan2(dir.dx, dir.dy);
      const swing = Math.sin(this.flightTime * 0.7 + index) * 0.55;
      const lift = 0.35 + (Math.sin(this.flightTime * 1.1 + index) * 0.5 + 0.5) * 1.4;
      const ox = -1.55 * Math.cos(facing) + 1.85 * Math.sin(facing);
      const oz = 1.55 * Math.sin(facing) + 1.85 * Math.cos(facing);
      this.putEuler(this.cranes, count, world.x + ox, this.heightOf(index) + 6.4 - lift * 0.15, world.z + oz, 1, 1, 1, 0, facing + swing, 0, 0xffffff);
      count += 1;
    }
    this.finish(this.cranes, count);
  }

  private paintFoam(): void {
    this.finish(this.foam, 0);
  }

  private paintPlanes(): void {
    if (!this.shown) {
      this.finish(this.planes, 0);
      return;
    }
    this.flights.forEach((flight, slot) => {
      const pose = planePose(this.shown!, flight.cell, this.flightTime + flight.phase, flight.parked);
      flight.x = pose.x;
      flight.y = pose.y;
      flight.z = pose.z;
      flight.rotY = pose.rotY;
      this.put(this.planes, slot, pose.x, pose.y, pose.z, 2.45, 2.45, 2.45, pose.rotY, 0xffffff);
    });
    this.finish(this.planes, this.flights.length);
  }

  private point(index: number): { x: number; z: number } {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    return cellToWorld({ width: GRID_SIZE, height: GRID_SIZE }, x, y);
  }

  private placeBadges(pool: THREE.Sprite[], material: THREE.SpriteMaterial, cells: number[], city: CityState, scale = 4.8): void {
    while (pool.length < cells.length) {
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(scale, scale, 1);
      sprite.visible = false;
      sprite.renderOrder = 8;
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
      const top = this.heightOf(cell) + (shape?.height ?? 4) + 3.2;
      const sprite = pool[slot];
      sprite.visible = true;
      sprite.userData.baseY = top;
      sprite.userData.scale = scale;
      sprite.scale.set(scale, scale, 1);
      sprite.position.set(spot.x, top, spot.z);
    });
    for (let index = cells.length; index < pool.length; index += 1) pool[index].visible = false;
  }

  private driveHeight(index: number): number {
    const base = this.heightOf(index);
    if (!this.shown || !isBridge(this.shown, index)) return base + 0.48;
    return bridgeCrest(this.shown, index) + 0.28;
  }

  private heightOf(index: number): number {
    if (!this.shown) return 0;
    const { x, y } = cellCoords(this.shown, index);
    return cellHeight(this.shown, x, y);
  }

  private faceSmileys(camera: THREE.Camera): void {
    for (let slot = 0; slot < this.smileys.count; slot += 1) {
      this.smileys.getMatrixAt(slot, this.smileyDummy.matrix);
      this.smileyDummy.matrix.decompose(this.smileyDummy.position, this.smileyDummy.quaternion, this.smileyDummy.scale);
      this.smileyDummy.lookAt(camera.position);
      this.smileyDummy.updateMatrix();
      this.smileys.setMatrixAt(slot, this.smileyDummy.matrix);
    }
    if (this.smileys.count > 0) {
      this.smileys.instanceMatrix.clearUpdateRanges();
      this.smileys.instanceMatrix.addUpdateRange(0, this.smileys.count * 16);
      this.smileys.instanceMatrix.needsUpdate = true;
    }
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
    this.tint.setRGB(0.22 + heat * 0.2, 0.23 - heat * 0.04, 0.26 - heat * 0.05);
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

  private putEuler(
    mesh: THREE.InstancedMesh,
    slot: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx: number,
    ry: number,
    rz: number,
    color: number,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(rx, ry, rz);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(slot, this.dummy.matrix);
    this.tint.set(color);
    mesh.setColorAt(slot, this.tint);
    this.dummy.rotation.set(0, 0, 0);
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

  private layRoad(x: number, z: number, mask: number, color: number, curbs: number, roads: number, gy = 0): { curbs: number; roads: number } {
    const arms = [
      { bit: 1, ox: 0, oz: -1, wide: false },
      { bit: 2, ox: 1, oz: 0, wide: true },
      { bit: 4, ox: 0, oz: 1, wide: false },
      { bit: 8, ox: -1, oz: 0, wide: true },
    ];
    const slab = (slotMesh: THREE.InstancedMesh, slot: number, ox: number, oz: number, sx: number, sz: number, y: number, height: number, paint: number) => {
      this.put(slotMesh, slot, x + ox * CELL_SIZE * 0.25, gy + y, z + oz * CELL_SIZE * 0.25, sx, height, sz, 0, paint);
    };
    slab(this.curbs, curbs, 0, 0, CELL_SIZE * 0.92, CELL_SIZE * 0.92, 0.05, 0.1, 0xd2c8b4);
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
      slab(this.curbs, curbs, arm.ox, arm.oz, sx, sz, 0.05, 0.1, 0xd2c8b4);
      curbs += 1;
      slab(this.asphalt, roads, arm.ox, arm.oz, ax, az, 0.11, 0.12, color);
      roads += 1;
    }
    return { curbs, roads };
  }

  private placeModel(key: string, x: number, z: number, color: number, cell = -1, y = 0, rotY = 0): void {
    const instances = this.models.get(key);
    if (!instances) return;
    const slot = this.modelSlot.get(key) ?? 0;
    if (slot >= 700) return;
    const base = key === "airport" ? 1.28 : 1;
    const scale = (cell >= 0 ? this.birthScale(cell) : 1) * base;
    this.put(instances, slot, x, y, z, scale, scale, scale, rotY, color);
    if (cell >= 0 && this.births.has(cell)) this.birthSlots.push({ mesh: instances, slot, x, y, z, rotY, color, cell, base });
    this.modelSlot.set(key, slot + 1);
  }

  /** Grow freshly built models in place (no full grid rebuild per frame). */
  private animateBirths(): void {
    const touched = new Set<THREE.InstancedMesh>();
    this.birthSlots = this.birthSlots.filter((entry) => {
      const scale = this.birthScale(entry.cell) * entry.base;
      this.put(entry.mesh, entry.slot, entry.x, entry.y, entry.z, scale, scale, scale, entry.rotY, entry.color);
      touched.add(entry.mesh);
      return this.births.has(entry.cell);
    });
    for (const mesh of touched) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private staticSignature(city: CityState, overlays: Overlays): string {
    let hash = 2166136261;
    const layers = [city.roads, city.zones, city.levels, city.utility, city.services, city.lines, city.pipes, city.skills, city.terrain];
    for (const layer of layers) {
      for (let index = 0; index < layer.length; index += 1) {
        hash ^= layer[index];
        hash = Math.imul(hash, 16777619);
      }
    }
    let posts = 0;
    for (let index = 0; index < city.posts.length; index += 1) posts = (Math.imul(posts, 31) + city.posts[index]) | 0;
    return `${hash >>> 0}:${posts}:${overlays.zones ? 1 : 0}${overlays.power ? 1 : 0}${overlays.water ? 1 : 0}:${this.nightLit ? 1 : 0}:${this.decorations ? 1 : 0}:${this.quality.level}:${city.width}`;
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
    const stamp = `${hash}:${city.gen?.biome ?? "temperate"}:${city.gen?.seed ?? 0}:${occupancyStamp(city)}`;
    if (stamp === this.groundStamp) return;
    this.groundStamp = stamp;
    const built = islandSurface(city);
    this.ground.geometry.dispose();
    this.plot.geometry.dispose();
    this.ground.geometry = built.ground;
    this.plot.geometry = built.plot;
    this.landMap?.dispose();
    this.landMap = occupancyTexture(city);
    this.seaMaterial.uniforms.uLand.value = this.landMap;
    this.seaMaterial.uniforms.uMapHalf.value = (city.width * CELL_SIZE) / 2;
    this.seaMaterial.uniforms.uMapExtent.value = city.width * CELL_SIZE;
  }

  /** Upload only the live instance range; empty-to-empty meshes upload nothing. */
  private finish(mesh: THREE.InstancedMesh, count: number): void {
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

function powerOutBadge(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = "#2a2422";
  ctx.beginPath();
  ctx.arc(48, 48, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e36d62";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = "#e36d62";
  ctx.beginPath();
  ctx.moveTo(44, 16);
  ctx.lineTo(26, 48);
  ctx.lineTo(42, 48);
  ctx.lineTo(36, 80);
  ctx.lineTo(70, 42);
  ctx.lineTo(52, 42);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function waterOutBadge(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = "#1e2628";
  ctx.beginPath();
  ctx.arc(48, 48, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8aa0aa";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = "#7eb8e6";
  ctx.beginPath();
  ctx.moveTo(48, 18);
  ctx.bezierCurveTo(70, 42, 70, 62, 48, 76);
  ctx.bezierCurveTo(26, 62, 26, 42, 48, 18);
  ctx.fill();
  ctx.fillStyle = "#2a3336";
  ctx.beginPath();
  ctx.moveTo(48, 34);
  ctx.bezierCurveTo(58, 46, 58, 56, 48, 64);
  ctx.bezierCurveTo(38, 56, 38, 46, 48, 34);
  ctx.fill();
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

const TOWEL_COLORS = [0xe24b4b, 0x3d88d8, 0xf0c12e, 0xf4efe4, 0x2f9a55, 0xe07ad0];

function occupancyTexture(city: CityState): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size);
  const half = (city.width * CELL_SIZE) / 2;
  const extent = city.width * CELL_SIZE;
  for (let ty = 0; ty < size; ty += 1) {
    for (let tx = 0; tx < size; tx += 1) {
      const wx = ((tx + 0.5) / size) * extent - half;
      const wz = ((ty + 0.5) / size) * extent - half;
      const gx = wx / CELL_SIZE + city.width / 2;
      const gy = wz / CELL_SIZE + city.height / 2;
      let acc = 0;
      let weight = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const cx = Math.floor(gx + dx);
          const cy = Math.floor(gy + dy);
          const land = inBounds(city, cx, cy) && !isWater(city, cy * city.width + cx) ? 1 : 0;
          const dist = Math.hypot(gx - (cx + 0.5), gy - (cy + 0.5));
          const w = Math.exp(-dist * dist * 1.35);
          acc += land * w;
          weight += w;
        }
      }
      data[ty * size + tx] = Math.round((acc / Math.max(weight, 0.0001)) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function planePose(city: CityState, cell: number, time: number, parked = false): { x: number; y: number; z: number; rotY: number } {
  const { x, y } = cellCoords(city, cell);
  const origin = cellToWorld(city, x, y);
  const gy = cellHeight(city, x, y);
  if (parked) {
    return { x: origin.x + 2.6, y: gy + 0.62, z: origin.z - 3.15, rotY: 0.12 };
  }
  const cycle = 24;
  const t = ((time % cycle) + cycle) % cycle;
  let px = origin.x;
  let py = gy + 1.35;
  let pz = origin.z;
  let vx = 1;
  let vz = 0;
  if (t < 7) {
    const u = t / 7;
    const ease = (1 - u) * (1 - u);
    px = origin.x - 88 + u * 88;
    py = gy + 0.95 + ease * 28;
    vx = 1;
  } else if (t < 11) {
    const u = (t - 7) / 4;
    px = origin.x + u * 8;
    py = gy + 0.95;
    vx = 1;
  } else if (t < 19) {
    const u = (t - 11) / 8;
    const climb = u * u * (3 - 2 * u);
    px = origin.x + 8 + u * 108;
    py = gy + 0.95 + climb * 36;
    vx = 1;
  } else {
    const u = (t - 19) / 5;
    px = origin.x + 116 - u * 204;
    py = gy + 30;
    pz = origin.z - 16;
    vx = -1;
  }
  return { x: px, y: py, z: pz, rotY: Math.atan2(vx, vz) - Math.PI / 2 };
}

function isHubService(kind: number): boolean {
  return kind === ServiceKind.Airport || kind === ServiceKind.Harbor;
}

const BOAT_SEA_Y = -0.22;

function boatPose(
  city: CityState,
  cell: number,
  time: number,
  kind: "cargo" | "fish" | "ferry",
  lane = 0,
  docked = false,
): { x: number; y: number; z: number; rotY: number; rx: number; rz: number; speed: number } {
  const { x, y } = cellCoords(city, cell);
  const origin = cellToWorld(city, x, y);
  const step = waterDir(city, x, y);
  const wx = step.dx;
  const wz = step.dy;
  const pierAlong = kind === "fish" ? 6.2 : 4.2 + lane * 2.15;
  const side = kind === "fish" ? (lane % 2 === 0 ? 5.2 : -5.2) : 5.6;
  const dockX = origin.x + wx * pierAlong + wz * side;
  const dockZ = origin.z + wz * pierAlong - wx * side;
  const heading = Math.atan2(wx, wz);
  const bob = Math.sin(time * 1.7 + lane) * 0.07;
  const roll = Math.sin(time * 1.15 + lane * 0.7) * 0.05;
  const keepSea = (px: number, pz: number) => keepOnWater(city, px, pz, wx, wz);
  if (docked || (kind !== "fish" && (((time % 36) + 36) % 36) / 36 < 0.02)) {
    const kept = keepSea(dockX, dockZ);
    return { x: kept.x, y: BOAT_SEA_Y + bob * 0.35, z: kept.z, rotY: heading, rx: roll * 0.25, rz: 0, speed: 0 };
  }
  if (kind === "fish") {
    const cycle = 22;
    const t = (((time % cycle) + cycle) % cycle) / cycle;
    if (t < 0.2) {
      const kept = keepSea(dockX + wz * 2.6, dockZ - wx * 2.6);
      return { x: kept.x, y: BOAT_SEA_Y + bob * 0.4, z: kept.z, rotY: heading, rx: roll * 0.3, rz: 0, speed: 0 };
    }
    const u = (t - 0.2) / 0.8;
    const ang = u * Math.PI * 2;
    const radius = 18 + (cell % 6);
    const kept = keepSea(origin.x + wx * 24 + Math.cos(ang) * radius, origin.z + wz * 24 + Math.sin(ang) * radius);
    return {
      x: kept.x,
      y: BOAT_SEA_Y + bob,
      z: kept.z,
      rotY: ang + Math.PI / 2,
      rx: roll,
      rz: 0,
      speed: 1,
    };
  }
  const cycle = kind === "ferry" ? 28 : 36;
  const t = (((time % cycle) + cycle) % cycle) / cycle;
  const reach = kind === "ferry" ? 42 : 56;
  let along: number;
  let outbound: boolean;
  let speed = 0;
  if (t < 0.34) {
    along = 0;
    outbound = true;
  } else if (t < 0.58) {
    along = ((t - 0.34) / 0.24) * reach;
    outbound = true;
    speed = 1;
  } else if (t < 0.7) {
    along = reach;
    outbound = false;
  } else {
    along = (1 - (t - 0.7) / 0.3) * reach;
    outbound = false;
    speed = 1;
  }
  const kept = keepSea(dockX + wx * along, dockZ + wz * along);
  return {
    x: kept.x,
    y: BOAT_SEA_Y + bob * (0.4 + speed * 0.6),
    z: kept.z,
    rotY: outbound ? heading : heading + Math.PI,
    rx: roll * (0.25 + speed * 0.75),
    rz: 0,
    speed,
  };
}

function keepOnWater(city: CityState, x: number, z: number, wx: number, wz: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  const half = (city.width * CELL_SIZE) / 2;
  for (let step = 0; step < 6; step += 1) {
    const gx = Math.floor((px + half) / CELL_SIZE);
    const gy = Math.floor((pz + half) / CELL_SIZE);
    if (!inBounds(city, gx, gy) || isWater(city, gy * city.width + gx)) return { x: px, z: pz };
    px += wx * 4;
    pz += wz * 4;
  }
  return { x: px, z: pz };
}

function smileyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#3bb85a";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a3d22";
  ctx.beginPath();
  ctx.arc(22, 26, 5, 0, Math.PI * 2);
  ctx.arc(42, 26, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1a3d22";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 34, 14, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const WATER_Y = -0.14;
const SKIRT_Y = -2.85;

function groundPalette(biome: BiomeId): [number, number, number] {
  if (biome === "arid") return [0xc4b486, 0xd0c094, 0xb6a678];
  if (biome === "alpine") return [0x6a9a58, 0x74a462, 0x5e8e4e];
  if (biome === "tropical") return [0x5eaa56, 0x6ab860, 0x529e4c];
  if (biome === "archipelago") return [0x74b056, 0x80bc62, 0x68a44c];
  return [0x90c256, 0x97c85e, 0x90c256];
}

function islandSurface(city: CityState): { ground: THREE.BufferGeometry; plot: THREE.LineSegments["geometry"] } {
  const cols = city.width + 1;
  const rows = city.height + 1;
  const pointX = new Float32Array(cols * rows);
  const pointZ = new Float32Array(cols * rows);
  const half = (city.width * CELL_SIZE) / 2;
  const biome = city.gen?.biome ?? "temperate";
  const palette = groundPalette(biome);
  const ocean = oceanMask(city);
  const landHere = (x: number, y: number) => inBounds(city, x, y) && !isWater(city, y * city.width + x);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const baseX = -half + x * CELL_SIZE;
      const baseZ = -half + y * CELL_SIZE;
      pointX[y * cols + x] = baseX;
      pointZ[y * cols + x] = baseZ;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const grass = new THREE.Color();
  const earth = new THREE.Color(biome === "arid" ? 0xb08650 : 0xc48442);
  const earthDeep = new THREE.Color(biome === "arid" ? 0x8a6438 : 0x9a5a28);
  const sand = new THREE.Color(biome === "arid" ? 0xd8c48c : 0xead6a0);
  const ca = new THREE.Color();
  const cb = new THREE.Color();
  const cc = new THREE.Color();
  const cornerTint = (vx: number, vy: number, out: THREE.Color) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [dx, dy] of [[-1, -1], [-1, 0], [0, -1], [0, 0]] as const) {
      const cx = vx + dx;
      const cy = vy + dy;
      if (!inBounds(city, cx, cy) || isWater(city, cy * city.width + cx)) continue;
      grass.set(palette[(cx + cy) & 1] ?? palette[0]);
      r += grass.r;
      g += grass.g;
      b += grass.b;
      n += 1;
    }
    if (n === 0) {
      out.copy(sand);
      return out;
    }
    const mix = vertexSand(city, vx, vy);
    out.setRGB(r / n, g / n, b / n);
    const h = vertexHeight(city, vx, vy);
    out.offsetHSL(0, 0.02, Math.min(0.06, h * 0.018) - Math.max(0, (h - 2.4) * 0.03));
    out.lerp(sand, mix);
    return out;
  };
  const addTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    ca: THREE.Color, cb: THREE.Color, cc: THREE.Color,
  ) => {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };
  const top = (
    ax: number, ay: number, az: number, ac: THREE.Color,
    bx: number, by: number, bz: number, bc: THREE.Color,
    cx: number, cy: number, cz: number, cc: THREE.Color,
  ) => {
    addTri(ax, ay, az, bx, by, bz, cx, cy, cz, ac, bc, cc);
  };
  const skirt = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cellX: number, cellY: number, sandy: boolean) => {
    const spot = cellToWorld(city, cellX, cellY);
    let nx = z0 - z1;
    let nz = x1 - x0;
    const edge = Math.hypot(nx, nz) || 1;
    nx /= edge;
    nz /= edge;
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    if ((mx - spot.x) * nx + (mz - spot.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const out = sandy ? 3.6 : 5.2;
    const bottom = sandy ? WATER_Y + 0.01 : SKIRT_Y;
    const lip = sandy ? sand : earth;
    const deep = sandy ? sand : earthDeep;
    const bx0 = x0 + nx * out;
    const bz0 = z0 + nz * out;
    const bx1 = x1 + nx * out;
    const bz1 = z1 + nz * out;
    addTri(x0, y0, z0, x1, y1, z1, bx1, bottom, bz1, lip, lip, deep);
    addTri(x0, y0, z0, bx1, bottom, bz1, bx0, bottom, bz0, lip, deep, deep);
  };

  const plot: number[] = [];
  for (let y = 0; y < city.height; y += 1) {
    for (let x = 0; x < city.width; x += 1) {
      if (!landHere(x, y)) continue;
      const corners = [y * cols + x, y * cols + x + 1, (y + 1) * cols + x + 1, (y + 1) * cols + x];
      const h0 = vertexHeight(city, x, y);
      const h1 = vertexHeight(city, x + 1, y);
      const h2 = vertexHeight(city, x + 1, y + 1);
      const h3 = vertexHeight(city, x, y + 1);
      const c0 = cornerTint(x, y, ca.clone());
      const c1 = cornerTint(x + 1, y, cb.clone());
      const c2 = cornerTint(x + 1, y + 1, cc.clone());
      const c3 = cornerTint(x, y + 1, grass.clone());
      top(pointX[corners[0]], h0, pointZ[corners[0]], c0, pointX[corners[2]], h2, pointZ[corners[2]], c2, pointX[corners[1]], h1, pointZ[corners[1]], c1);
      top(pointX[corners[0]], h0, pointZ[corners[0]], c0, pointX[corners[3]], h3, pointZ[corners[3]], c3, pointX[corners[2]], h2, pointZ[corners[2]], c2);
      const edges = [
        { nextX: x, nextY: y - 1, a: corners[0], b: corners[1], ha: h0, hb: h1 },
        { nextX: x + 1, nextY: y, a: corners[1], b: corners[2], ha: h1, hb: h2 },
        { nextX: x, nextY: y + 1, a: corners[3], b: corners[2], ha: h3, hb: h2 },
        { nextX: x - 1, nextY: y, a: corners[0], b: corners[3], ha: h0, hb: h3 },
      ];
      for (const edge of edges) {
        if (landHere(edge.nextX, edge.nextY)) continue;
        const nextIndex = inBounds(city, edge.nextX, edge.nextY) ? edge.nextY * city.width + edge.nextX : -1;
        const sandy = nextIndex < 0 || ocean[nextIndex] === 1 || isBeach(city, y * city.width + x);
        skirt(pointX[edge.a], edge.ha, pointZ[edge.a], pointX[edge.b], edge.hb, pointZ[edge.b], x, y, sandy);
      }
      const east = landHere(x + 1, y);
      const south = landHere(x, y + 1);
      if (east && landHere(x, y - 1) && landHere(x + 1, y - 1)) {
        const edge = pointX[corners[1]];
        plot.push(edge, h1 + 0.04, pointZ[corners[1]], edge, h2 + 0.04, pointZ[corners[2]]);
      }
      if (south && landHere(x - 1, y) && landHere(x - 1, y + 1)) {
        plot.push(pointX[corners[3]], h3 + 0.04, pointZ[corners[3]], pointX[corners[2]], h2 + 0.04, pointZ[corners[2]]);
      }
    }
  }

  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  ground.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  ground.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(plot, 3));
  return { ground, plot: lines };
}
