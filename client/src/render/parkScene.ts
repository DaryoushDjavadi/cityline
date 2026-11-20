/**
 * Tierpark level renderer: its own Three.js scene with a 40×40 tile park (2 world units per tile).
 * Paths, curbs, every object kind, border hedges, outside trees, grass tufts and visitors are
 * instanced (one draw call per kind); habitats are dressed by a HabitatDressing (merged decor,
 * ground atlas, grass, water, furniture) and animals and jeeps come from a ZooLayer. The habitat
 * build mode (grid, furniture preview, removal marker), animal selection and care reactions
 * (hearts, stars) live here too – there is no separate interior scene anymore.
 */
import * as THREE from "three";
import {
  HABITAT_TILES,
  ITEM_GRID,
  PARK_SIZE,
  PARK_TILE,
  PARK_TILES,
  ParkCrowd,
  TILE,
  occupancy,
  parkIndex,
  parkXY,
  walkable,
  type CrowdEvent,
  type ItemKind,
  type ParkObject,
  type Walker,
  type ZooState,
} from "../../../shared/src/index.ts";
import { ZooLayer, type Reaction, type ZooSite } from "./zooLayer.ts";
import { buildPersonModels } from "./models.ts";
import { HabitatDressing, SPOT_SIZE, itemScale, spotFromOffset, spotOffset } from "./habitatDressing.ts";
import { StyleFx } from "./styleFx.ts";
import { boothGeometry, borderGeometry, outerTreeGeometry, parkObjectGeometry } from "./parkModels.ts";
import { rng, setWindTime, swayMaterial, tuftGeometry } from "./zooDecor.ts";

export const PARK_HALF = (PARK_SIZE * PARK_TILE) / 2;
const GLYPH: Record<Reaction, { text: string; color: string }> = {
  pet: { text: "♥", color: "#ff5f8f" },
  play: { text: "★", color: "#ffd04a" },
  feed: { text: "♥", color: "#ff9a3c" },
  vet: { text: "✚", color: "#5fd08a" },
};

function glyphTexture(kind: Reaction): THREE.CanvasTexture {
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
const OBJECT_KINDS: Exclude<ParkObject, "path">[] = ["food", "drink", "souvenir", "bench", "bin", "toilet", "tree", "flowers", "entrance"];
const CLOTHES = [0x3d88c8, 0xe24a32, 0xf0b43c, 0x3d8a4a, 0xa85a8a, 0xf2efe8, 0x2a3e5c, 0xe98a5a];
const VISITOR_CAP = 160;
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** World centre of a tile. */
export function tileWorld(tile: number): { x: number; z: number } {
  const { x, y } = parkXY(tile);
  return { x: (x + 0.5) * PARK_TILE - PARK_HALF, z: (y + 0.5) * PARK_TILE - PARK_HALF };
}

/** World centre of a habitat (anchor = top-left tile). */
export function habitatWorld(anchor: number): { x: number; z: number } {
  const { x, y } = parkXY(anchor);
  return { x: (x + HABITAT_TILES / 2) * PARK_TILE - PARK_HALF, z: (y + HABITAT_TILES / 2) * PARK_TILE - PARK_HALF };
}

/** Seamless meadow: soft blotches drawn with wrap-around, tiny flowers. */
function meadowTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = rng(4711);
  ctx.fillStyle = "#7db85a";
  ctx.fillRect(0, 0, size, size);
  const blob = (color: string, count: number, rMin: number, rMax: number, alpha: number) => {
    const hex = parseInt(color.slice(1), 16);
    const clear = `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},0)`;
    for (let i = 0; i < count; i += 1) {
      const x0 = random() * size;
      const y0 = random() * size;
      const r = rMin + random() * (rMax - rMin);
      const a = alpha * (0.6 + random() * 0.4);
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const x = x0 + ox;
          const y = y0 + oy;
          if (x + r < 0 || y + r < 0 || x - r > size || y - r > size) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, color);
          g.addColorStop(1, clear);
          ctx.globalAlpha = a;
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  };
  blob("#6aa848", 26, 30, 90, 0.55);
  blob("#94cc6c", 22, 25, 70, 0.5);
  blob("#a8b870", 8, 20, 50, 0.3);
  for (let i = 0; i < 700; i += 1) {
    ctx.fillStyle = ["#5a9440", "#9ccc70", "#4e8a3a"][i % 3];
    ctx.globalAlpha = 0.5;
    ctx.fillRect(random() * size, random() * size, 1.6, 1.6);
  }
  for (let i = 0; i < 160; i += 1) {
    ctx.fillStyle = ["#ffffff", "#ffe066", "#f4a6c8", "#b8a0f0"][i % 4];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Gravel for paths: warm sand with pebbles, no border so tiles join seamlessly. */
function gravelTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = rng(99);
  ctx.fillStyle = "#e2cc9e";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i += 1) {
    ctx.fillStyle = ["#cdb586", "#efdcb2", "#c4a87a", "#d8c094", "#b89c70"][i % 5];
    ctx.globalAlpha = 0.6 + random() * 0.4;
    const x = random() * size;
    const y = random() * size;
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + random() * 1.8, 0.8 + random() * 1.2, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number, shadows: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

export class ParkScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  readonly crowd = new ParkCrowd(7);
  readonly target = new THREE.Vector3(0, 0, 14);
  private readonly sun: THREE.DirectionalLight;
  /** Graphics style (Standard / Pixel-Art / Comic). */
  private fx!: StyleFx;
  azimuth = 0;
  distance = 74;
  private readonly low: boolean;
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  private readonly paths: THREE.InstancedMesh;
  private readonly curbs: THREE.InstancedMesh;
  private readonly objects = new Map<string, THREE.InstancedMesh>();
  readonly dressing: HabitatDressing;
  /** Build mode: grid over the focused habitat, furniture preview and removal marker. */
  private readonly buildGrid: THREE.LineSegments;
  private readonly itemGhost = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.7, roughness: 0.8, depthWrite: false }));
  private readonly spotMark: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private selected = -1;
  private readonly bursts: { sprite: THREE.Sprite; born: number; vx: number; vz: number }[] = [];
  private readonly glyphs = new Map<Reaction, THREE.CanvasTexture>();
  /** Camera flight (habitat click): from → to over `duration` seconds. */
  private flight: { t: number; duration: number; from: { x: number; z: number; d: number; a: number }; to: { x: number; z: number; d: number; a: number } } | null = null;
  private readonly booth: THREE.Mesh;
  private readonly grass: THREE.InstancedMesh;
  private readonly visitorMeshes = new Map<string, { body: THREE.InstancedMesh; head: THREE.InstancedMesh }>();
  private readonly ghost: THREE.InstancedMesh;
  private readonly ghostBox: THREE.Mesh;
  /** Translucent preview of the stand/decor model under the cursor. */
  private readonly ghostModel = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.8, depthWrite: false }));
  readonly zoo: ZooLayer;
  private layoutKey = "";
  private grid: Uint8Array = new Uint8Array(PARK_TILES);
  private time = 0;
  private width = 1;
  private height = 1;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly inset = { right: 0, bottom: 0, top: 0 };

  constructor(readonly canvas: HTMLCanvasElement, low: boolean) {
    this.low = low;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.fx = new StyleFx(this.renderer);
    this.fx.low = low;
    if (!low) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    // Warm late-morning light like the concept art.
    this.scene.background = new THREE.Color(0xcfe3ea);
    this.scene.fog = new THREE.Fog(0xd8e6e2, 140, 320);
    const hemi = new THREE.HemisphereLight(0xfff1da, 0x6e6044, 1.45);
    const sun = new THREE.DirectionalLight(0xffe2b4, 2.5);
    this.sun = sun;
    sun.position.set(34, 58, 22);
    if (!low) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const r = PARK_HALF + 6;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 160 });
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.04;
      sun.shadow.radius = 3;
    }
    this.scene.add(hemi, sun);

    const meadow = meadowTexture();
    meadow.repeat.set(4, 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(PARK_HALF * 2, PARK_HALF * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: meadow, roughness: 1 }));
    ground.receiveShadow = true;
    const outsideTex = meadow.clone();
    outsideTex.repeat.set(14, 14);
    outsideTex.needsUpdate = true;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(560, 560).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: outsideTex, color: 0xb8c8a4, roughness: 1 }));
    outside.position.y = -0.04;
    outside.receiveShadow = true;
    this.scene.add(outside, ground);

    const gravel = gravelTexture();
    const pathGeo = new THREE.BoxGeometry(PARK_TILE, 0.08, PARK_TILE);
    pathGeo.translate(0, 0.04, 0);
    this.paths = instanced(pathGeo, new THREE.MeshStandardMaterial({ map: gravel, roughness: 0.95 }), PARK_TILES, false);
    const curbGeo = new THREE.BoxGeometry(PARK_TILE + 0.02, 0.14, 0.16);
    curbGeo.translate(0, 0.07, 0);
    this.curbs = instanced(curbGeo, new THREE.MeshStandardMaterial({ color: 0xbfb4a0, roughness: 0.9 }), PARK_TILES * 2, false);
    this.scene.add(this.paths, this.curbs);

    for (const kind of OBJECT_KINDS) {
      const mesh = instanced(parkObjectGeometry(kind), this.material, kind === "entrance" ? 1 : 400, !low);
      this.objects.set(kind, mesh);
      this.scene.add(mesh);
    }
    this.dressing = new HabitatDressing(this.scene, low);
    this.booth = new THREE.Mesh(boothGeometry(), this.material);
    this.booth.castShadow = !low;
    this.scene.add(this.booth);

    // Border hedge + fence and trees outside.
    const border = instanced(borderGeometry(), this.material, PARK_SIZE * 4, false);
    this.scene.add(border);
    this.border = border;
    const random = rng(321);
    for (const kind of [0, 1, 2]) {
      const trees = instanced(outerTreeGeometry(kind), this.material, 80, false);
      let n = 0;
      for (let k = 0; k < 70; k += 1) {
        if (Math.floor(random() * 3) !== kind) continue;
        const angle = random() * Math.PI * 2;
        const side = Math.floor(random() * 4);
        const along = (random() * 2 - 1) * (PARK_HALF + 14);
        const out = PARK_HALF + 4 + random() * 22;
        const [x, z] = side === 0 ? [along, -out] : side === 1 ? [out, along] : side === 2 ? [along, out + 8] : [-out, along];
        if (side === 2 && Math.abs(x) < 10) continue;
        this.dummy.position.set(x, 0, z);
        this.dummy.rotation.set(0, angle, 0);
        this.dummy.scale.setScalar(0.9 + random() * 0.7);
        this.dummy.updateMatrix();
        trees.setMatrixAt(n++, this.dummy.matrix);
      }
      trees.count = n;
      trees.instanceMatrix.needsUpdate = true;
      this.scene.add(trees);
    }

    this.grass = instanced(tuftGeometry(6, 5), swayMaterial(0.8), low ? 900 : 2800, false);
    this.grass.receiveShadow = true;
    this.scene.add(this.grass);

    for (const model of buildPersonModels()) {
      if (!["idle", "walkL", "walkR", "sit"].includes(model.key)) continue;
      const body = instanced(model.body, this.material, VISITOR_CAP, !low);
      const head = instanced(model.head, this.material, VISITOR_CAP, false);
      this.visitorMeshes.set(model.key, { body, head });
      this.scene.add(body, head);
    }

    const ghostGeo = new THREE.BoxGeometry(PARK_TILE * 0.94, 0.12, PARK_TILE * 0.94);
    ghostGeo.translate(0, 0.12, 0);
    this.ghost = new THREE.InstancedMesh(ghostGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), 420);
    this.ghost.count = 0;
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 3;
    this.ghostBox = new THREE.Mesh(new THREE.BoxGeometry(PARK_TILE * HABITAT_TILES, 0.3, PARK_TILE * HABITAT_TILES), new THREE.MeshBasicMaterial({ color: 0x7cd67c, transparent: true, opacity: 0.4, depthWrite: false }));
    this.ghostBox.visible = false;
    this.ghostBox.renderOrder = 3;
    this.ghostModel.visible = false;
    this.ghostModel.renderOrder = 4;
    this.scene.add(this.ghost, this.ghostBox, this.ghostModel);

    this.zoo = new ZooLayer(this.scene, 1);

    // Build-mode helpers (hidden until a habitat is in build mode).
    const lines: number[] = [];
    const half = (ITEM_GRID * SPOT_SIZE) / 2;
    for (let i = 0; i <= ITEM_GRID; i += 1) {
      const t = -half + i * SPOT_SIZE;
      lines.push(t, 0, -half, t, 0, half, -half, 0, t, half, 0, t);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.buildGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.55, depthWrite: false }));
    this.buildGrid.visible = false;
    this.buildGrid.renderOrder = 2;
    this.spotMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8604c, transparent: true, opacity: 0.45, depthWrite: false }));
    this.spotMark.visible = false;
    this.spotMark.renderOrder = 3;
    this.itemGhost.visible = false;
    this.itemGhost.renderOrder = 4;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.scene.add(this.buildGrid, this.spotMark, this.itemGhost, this.ring);
  }

  private readonly border: THREE.InstancedMesh;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.camera.aspect < 0.8 ? 58 : 45;
    this.applyInset();
  }

  /** Keep the view centred in the part of the screen not covered by bars/panels. */
  setInset(right: number, bottom: number, top = 0): void {
    if (Math.abs(right - this.inset.right) < 2 && Math.abs(bottom - this.inset.bottom) < 2 && Math.abs(top - this.inset.top) < 2) return;
    Object.assign(this.inset, { right, bottom, top });
    this.applyInset();
  }

  private applyInset(): void {
    const { right, bottom, top } = this.inset;
    if (right > 0 || bottom > 0 || top > 0) this.camera.setViewOffset(this.width, this.height, right / 2, (bottom - top) / 2, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild the layout (only when tiles/habitats changed) and the animals. */
  sync(zoo: ZooState, tick: number): void {
    const park = zoo.park;
    if (!park) return;
    const key = `${park.tiles}|${park.entrance}|${zoo.habitats.map((h) => `${h.cell}:${h.type}`).join(",")}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.grid = occupancy(park, zoo.habitats);
      this.buildLayout(zoo);
      this.crowd.setLayout(park, zoo.habitats);
    }
    const placed = zoo.habitats.map((habitat) => ({ habitat, ...habitatWorld(habitat.cell) }));
    this.dressing.setHabitats(placed.map(({ habitat, x, z }) => ({ cell: habitat.cell, type: habitat.type, x, z })));
    this.dressing.setItems(placed);
    // Animals stand on the painted ground (ZooLayer adds its city plinth height of 0.25).
    const sites: ZooSite[] = placed.map(({ habitat, x, z }) => ({ cell: habitat.cell, type: habitat.type, x, y: -0.21, z, animals: zoo.animals.filter((animal) => animal.cell === habitat.cell), roads: [], keeper: habitat.keeper }));
    this.zoo.setSites(sites, tick, zoo.visitors);
  }

  /** Which way a 1-tile object faces: toward its first neighbouring path. */
  private facing(tile: number): number {
    const { x, y } = parkXY(tile);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= PARK_SIZE || ny >= PARK_SIZE) continue;
      if (walkable(this.grid[parkIndex(nx, ny)])) return Math.atan2(dx, dy);
    }
    return 0;
  }

  private buildLayout(zoo: ZooState): void {
    const park = zoo.park!;
    const random = rng(17);
    let paths = 0;
    let curbs = 0;
    const counts = new Map<string, number>();
    for (let tile = 0; tile < PARK_TILES; tile += 1) {
      const code = this.grid[tile];
      if (code === TILE.grass || code === TILE.habitat) continue;
      const at = tileWorld(tile);
      if (walkable(code)) {
        this.dummy.position.set(at.x, 0, at.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.paths.setMatrixAt(paths, this.dummy.matrix);
        this.paths.setColorAt(paths, this.color.setScalar(0.94 + random() * 0.08));
        paths += 1;
        const { x, y } = parkXY(tile);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          const inside = nx >= 0 && ny >= 0 && nx < PARK_SIZE && ny < PARK_SIZE;
          if (inside && walkable(this.grid[parkIndex(nx, ny)])) continue;
          if (!inside) continue;
          this.dummy.position.set(at.x + dx * (PARK_TILE / 2 - 0.08), 0, at.z + dy * (PARK_TILE / 2 - 0.08));
          this.dummy.rotation.set(0, dx !== 0 ? Math.PI / 2 : 0, 0);
          this.dummy.updateMatrix();
          this.curbs.setMatrixAt(curbs++, this.dummy.matrix);
        }
      }
      const kind = OBJECT_KINDS.find((entry) => (entry === "entrance" ? TILE.entrance : TILE[entry]) === code);
      if (!kind) continue;
      const mesh = this.objects.get(kind)!;
      const n = counts.get(kind) ?? 0;
      if (n >= mesh.instanceMatrix.count) continue;
      let facing = this.facing(tile);
      let scale = 1;
      if (kind === "entrance") {
        // The gate looks outward across the edge.
        const { x, y } = parkXY(tile);
        facing = y === PARK_SIZE - 1 ? 0 : y === 0 ? Math.PI : x === 0 ? -Math.PI / 2 : Math.PI / 2;
        // Ticket booth outside the gate, to its left (outward o, sideways s).
        const ox = Math.sin(facing);
        const oz = Math.cos(facing);
        this.booth.position.set(at.x + ox * 1.6 - Math.cos(facing) * 2.5, 0, at.z + oz * 1.6 + Math.sin(facing) * 2.5);
        this.booth.rotation.set(0, facing, 0);
      } else if (kind === "tree") {
        facing = random() * Math.PI * 2;
        scale = 0.85 + random() * 0.35;
      }
      this.dummy.position.set(at.x, 0, at.z);
      this.dummy.rotation.set(0, facing, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      counts.set(kind, n + 1);
    }
    this.paths.count = paths;
    this.paths.instanceMatrix.needsUpdate = true;
    if (this.paths.instanceColor) this.paths.instanceColor.needsUpdate = true;
    this.curbs.count = curbs;
    this.curbs.instanceMatrix.needsUpdate = true;
    for (const [kind, mesh] of this.objects) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    // Border hedge with a gap at the gate.
    let b = 0;
    for (let i = 0; i < PARK_SIZE; i += 1) {
      for (const [x, y, ry] of [[i, 0, 0], [i, PARK_SIZE - 1, Math.PI], [0, i, Math.PI / 2], [PARK_SIZE - 1, i, -Math.PI / 2]] as const) {
        const tile = parkIndex(x, y);
        if (tile === park.entrance) continue;
        const at = tileWorld(tile);
        const out = 1.35;
        const ox = x === 0 && ry === Math.PI / 2 ? -out : x === PARK_SIZE - 1 && ry === -Math.PI / 2 ? out : 0;
        const oz = y === 0 && ry === 0 ? -out : y === PARK_SIZE - 1 && ry === Math.PI ? out : 0;
        this.dummy.position.set(at.x + ox, 0, at.z + oz);
        this.dummy.rotation.set(0, ry, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.border.setMatrixAt(b++, this.dummy.matrix);
      }
    }
    this.border.count = b;
    this.border.instanceMatrix.needsUpdate = true;
    this.plantGrass();
  }

  /** Grass tufts on free meadow tiles (fewer on the low preset). */
  private plantGrass(): void {
    const random = rng(2024);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const colors = [0x5c9c44, 0x6aa84c, 0x78b454, 0x8cc060];
    const cap = this.grass.instanceMatrix.count;
    const per = this.low ? 0.7 : 2.1;
    let n = 0;
    for (let tile = 0; tile < PARK_TILES && n < cap; tile += 1) {
      if (this.grid[tile] !== TILE.grass) continue;
      const k = Math.floor(per + random());
      const at = tileWorld(tile);
      for (let j = 0; j < k && n < cap; j += 1) {
        const h = 0.35 + random() * 0.35;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2);
        s.set(h * (0.9 + random() * 0.4), h, h * (0.9 + random() * 0.4));
        p.set(at.x + (random() - 0.5) * PARK_TILE * 0.9, 0, at.z + (random() - 0.5) * PARK_TILE * 0.9);
        this.grass.setMatrixAt(n, m.compose(p, q, s));
        this.grass.setColorAt(n, this.color.setHex(colors[Math.floor(random() * colors.length)]).multiplyScalar(0.9 + random() * 0.2));
        n += 1;
      }
    }
    this.grass.count = n;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
  }

  /** Ghost preview: tiles (green = ok, red = blocked) or a habitat footprint. */
  setGhost(tiles: { tile: number; ok: boolean }[], habitat: { anchor: number; ok: boolean } | null, model: Exclude<ParkObject, "path"> | null = null): void {
    this.ghostModel.visible = model !== null && tiles.length === 1 && tiles[0].ok;
    if (this.ghostModel.visible && model) {
      this.ghostModel.geometry = parkObjectGeometry(model);
      const at = tileWorld(tiles[0].tile);
      this.ghostModel.position.set(at.x, 0.05, at.z);
      this.ghostModel.rotation.set(0, this.facing(tiles[0].tile), 0);
    }
    let n = 0;
    for (const entry of tiles.slice(0, 420)) {
      const at = tileWorld(entry.tile);
      this.dummy.position.set(at.x, 0, at.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.ghost.setMatrixAt(n, this.dummy.matrix);
      this.ghost.setColorAt(n, this.color.setHex(entry.ok ? 0x7cd67c : 0xe8604c));
      n += 1;
    }
    this.ghost.count = n;
    this.ghost.instanceMatrix.needsUpdate = true;
    if (this.ghost.instanceColor) this.ghost.instanceColor.needsUpdate = true;
    this.ghostBox.visible = habitat !== null;
    if (habitat) {
      const at = habitatWorld(habitat.anchor);
      this.ghostBox.position.set(at.x, 0.2, at.z);
      (this.ghostBox.material as THREE.MeshBasicMaterial).color.setHex(habitat.ok ? 0x7cd67c : 0xe8604c);
    }
  }

  // ------------------------------------------------------------ habitat build mode

  /** Show the furniture grid over a habitat (anchor tile), or hide it. */
  setBuildGrid(anchor: number | null, type = "savanne"): void {
    this.buildGrid.visible = anchor !== null;
    // Dark lines on light floors (sand, snow, meadow), light lines on forest and shore.
    const light = type === "wald" || type === "wasser";
    const material = this.buildGrid.material as THREE.LineBasicMaterial;
    material.color.setHex(light ? 0xfff6d8 : 0x4a3418);
    material.opacity = light ? 0.6 : 0.42;
    if (anchor === null) {
      this.itemGhost.visible = false;
      this.spotMark.visible = false;
      return;
    }
    const at = habitatWorld(anchor);
    this.buildGrid.position.set(at.x, 0.06, at.z);
  }

  /** Furniture preview on a spot (tinted green/red), or null. */
  setItemGhost(anchor: number, ghost: { kind: ItemKind; x: number; y: number; size: number; rot: number; ok: boolean } | null): void {
    this.itemGhost.visible = ghost !== null;
    if (!ghost) return;
    const at = habitatWorld(anchor);
    const off = spotOffset(ghost.x, ghost.y, ghost.size);
    this.itemGhost.geometry = this.dressing.itemGeometry(ghost.kind, 100);
    this.itemGhost.position.set(at.x + off.x, 0.04, at.z + off.z);
    this.itemGhost.rotation.set(0, (ghost.rot * Math.PI) / 2, 0);
    this.itemGhost.scale.setScalar(itemScale(ghost.kind));
    const material = this.itemGhost.material as THREE.MeshStandardMaterial;
    material.color.setHex(ghost.ok ? 0xa8ffa0 : 0xff7a6a);
    material.emissive.setHex(ghost.ok ? 0x1a4a1a : 0x5a1410);
  }

  /** Red marker over the spots of the item that would be removed, or null. */
  setSpotMark(anchor: number, spot: { x: number; y: number; size: number; color?: number } | null): void {
    this.spotMark.visible = spot !== null;
    if (!spot) return;
    const at = habitatWorld(anchor);
    const off = spotOffset(spot.x, spot.y, spot.size);
    this.spotMark.position.set(at.x + off.x, 0.07, at.z + off.z);
    this.spotMark.scale.set(SPOT_SIZE * spot.size * 0.96, 1, SPOT_SIZE * spot.size * 0.96);
    (this.spotMark.material as THREE.MeshBasicMaterial).color.setHex(spot.color ?? 0xe8604c);
  }

  /** Grid spot of a habitat under a screen point, or null outside its grid. */
  pickSpot(anchor: number, clientX: number, clientY: number): { x: number; y: number } | null {
    const hit = this.pick(clientX, clientY);
    const at = habitatWorld(anchor);
    return spotFromOffset(hit.x - at.x, hit.z - at.z);
  }

  /** Screen position (canvas px) of a habitat grid spot. */
  spotScreen(anchor: number, x: number, y: number): { x: number; y: number } {
    const at = habitatWorld(anchor);
    const off = spotOffset(x, y);
    const p = this.project(at.x + off.x, 0.05, at.z + off.z);
    return { x: p.x, y: p.y };
  }

  /** Nearest animal to a screen point (within ~30 px of its body), or −1. */
  pickAnimal(clientX: number, clientY: number, among?: Set<number>): number {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best = -1;
    let bestD = Infinity;
    for (const [id, pose] of this.zoo.poses) {
      if (among && !among.has(id)) continue;
      const p = this.project(pose.x, pose.y + pose.height * 0.5, pose.z);
      if (p.behind) continue;
      // Allow a bigger radius for big animals seen close up.
      const top = this.project(pose.x, pose.y + pose.height, pose.z);
      const reach = Math.max(26, Math.abs(top.y - p.y) * 1.6);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < reach && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /** Screen position (canvas px) of an animal's head, or null. */
  animalScreen(id: number): { x: number; y: number } | null {
    const pose = this.zoo.poses.get(id);
    if (!pose) return null;
    const p = this.project(pose.x, pose.y + pose.height * 0.55, pose.z);
    return p.behind ? null : { x: p.x, y: p.y };
  }

  /** Select an animal (ring under it, it stands still), −1 = none. */
  select(id: number): void {
    this.selected = id;
    this.zoo.hold(id);
    this.ring.visible = false;
  }

  /** Hearts/stars rise from the animal; it hops, spins or squashes. */
  react(id: number, kind: Reaction): void {
    this.zoo.react(id, kind);
    const pose = this.zoo.poses.get(id);
    if (!pose) return;
    let texture = this.glyphs.get(kind);
    if (!texture) {
      texture = glyphTexture(kind);
      this.glyphs.set(kind, texture);
    }
    const size = Math.max(0.45, Math.min(0.9, pose.height * 0.45));
    for (let i = 0; i < 7; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.position.set(pose.x + (Math.random() - 0.5) * 0.6, pose.y + pose.height + 0.15 + Math.random() * 0.3, pose.z + (Math.random() - 0.5) * 0.6);
      sprite.scale.setScalar(size * (0.8 + Math.random() * 0.45));
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.scene.add(sprite);
      this.bursts.push({ sprite, born: this.time + i * 0.08, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6 });
    }
  }

  /** Visible care bursts (for tests). */
  burstCount(): number {
    return this.bursts.length;
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      const age = this.time - burst.born;
      if (age < 0) continue;
      burst.sprite.visible = true;
      burst.sprite.position.y += dt * 1.2;
      burst.sprite.position.x += burst.vx * dt;
      burst.sprite.position.z += burst.vz * dt;
      (burst.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - age / 1.3);
      if (age > 1.3) {
        this.scene.remove(burst.sprite);
        (burst.sprite.material as THREE.SpriteMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------ camera

  /** Smooth camera flight to a point (habitat click). Any manual pan/zoom/rotate stops it. */
  flyTo(x: number, z: number, distance: number, azimuth = this.azimuth, duration = 0.75): void {
    // Shortest way round.
    let a = azimuth;
    while (a - this.azimuth > Math.PI) a -= Math.PI * 2;
    while (a - this.azimuth < -Math.PI) a += Math.PI * 2;
    this.flight = { t: 0, duration, from: { x: this.target.x, z: this.target.z, d: this.distance, a: this.azimuth }, to: { x, z, d: distance, a } };
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  private fly(dt: number): void {
    const flight = this.flight;
    if (!flight) return;
    flight.t = Math.min(flight.duration, flight.t + dt);
    const k = flight.t / flight.duration;
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.target.x = flight.from.x + (flight.to.x - flight.from.x) * e;
    this.target.z = flight.from.z + (flight.to.z - flight.from.z) * e;
    this.distance = flight.from.d + (flight.to.d - flight.from.d) * e;
    this.azimuth = flight.from.a + (flight.to.a - flight.from.a) * e;
    if (k >= 1) this.flight = null;
  }

  private polar(): number {
    // Close up the view flattens a little (like the city camera).
    const t = Math.min(1, Math.max(0, (this.distance - 18) / 90));
    return 0.98 - t * 0.3;
  }

  private placeCamera(): void {
    const polar = this.polar();
    const d = this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * Math.sin(polar) * d,
      this.target.y + Math.cos(polar) * d,
      this.target.z + Math.cos(this.azimuth) * Math.sin(polar) * d,
    );
    this.camera.lookAt(this.target);
  }

  /** Drag in screen pixels moves the park under the finger. */
  pan(dx: number, dy: number): void {
    this.flight = null;
    const k = (this.distance * 1.15) / Math.max(320, this.height);
    const cos = Math.cos(this.azimuth);
    const sin = Math.sin(this.azimuth);
    this.target.x += (-dx * cos - dy * sin) * k;
    this.target.z += (dx * sin - dy * cos) * k;
    this.clampTarget();
  }

  rotate(delta: number): void {
    this.flight = null;
    this.azimuth += delta;
  }

  zoom(factor: number): void {
    this.flight = null;
    this.distance = Math.max(16, Math.min(125, this.distance * factor));
  }

  lookAt(x: number, z: number, distance?: number): void {
    this.flight = null;
    this.target.set(x, 0, z);
    if (distance !== undefined) this.distance = distance;
    this.clampTarget();
  }

  private clampTarget(): void {
    const r = PARK_HALF + 4;
    this.target.x = Math.max(-r, Math.min(r, this.target.x));
    this.target.z = Math.max(-r, Math.min(r, this.target.z));
  }

  /** Tile under a screen point (client coordinates), or −1. */
  pick(clientX: number, clientY: number): { tile: number; x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return { tile: -1, x: 0, z: 0 };
    const tx = Math.floor((hit.x + PARK_HALF) / PARK_TILE);
    const ty = Math.floor((hit.z + PARK_HALF) / PARK_TILE);
    if (tx < 0 || ty < 0 || tx >= PARK_SIZE || ty >= PARK_SIZE) return { tile: -1, x: hit.x, z: hit.z };
    return { tile: parkIndex(tx, ty), x: hit.x, z: hit.z };
  }

  /** Screen position (client px relative to the canvas) of a world point. */
  project(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, behind: v.z > 1 };
  }

  walkerWorld(walker: Walker): { x: number; z: number; heading: number } {
    if (walker.state === "sit") {
      // Sit on the bench, facing the path.
      const dx = walker.x - walker.faceX;
      const dz = walker.y - walker.faceY;
      const len = Math.hypot(dx, dz) || 1;
      return {
        x: (walker.faceX + (dx / len) * 0.12) * PARK_TILE - PARK_HALF,
        z: (walker.faceY + (dz / len) * 0.12) * PARK_TILE - PARK_HALF,
        heading: Math.atan2(dx, dz),
      };
    }
    return { x: walker.x * PARK_TILE - PARK_HALF, z: walker.y * PARK_TILE - PARK_HALF, heading: walker.heading };
  }

  /** Advance visitors and animals, render. Returns crowd events (sales, looks) for the overlay. */
  frame(dt: number, want: number): CrowdEvent[] {
    this.time += dt;
    setWindTime(this.time);
    const events = this.crowd.update(Math.min(dt, 0.1), want);
    const used = new Map<string, number>();
    for (const walker of this.crowd.walkers) {
      if (walker.state === "gone") continue;
      const pose = walker.state === "sit" ? "sit" : walker.state === "walk" ? (Math.floor(this.time * 3.2 + walker.id * 0.7) % 2 ? "walkL" : "walkR") : "idle";
      const meshes = this.visitorMeshes.get(pose)!;
      const n = used.get(pose) ?? 0;
      if (n >= VISITOR_CAP) continue;
      const at = this.walkerWorld(walker);
      this.dummy.position.set(at.x, walker.state === "sit" ? 0.0 : 0.08, at.z);
      this.dummy.rotation.set(0, at.heading, 0);
      this.dummy.scale.setScalar(0.92);
      this.dummy.updateMatrix();
      meshes.body.setMatrixAt(n, this.dummy.matrix);
      meshes.body.setColorAt(n, this.color.setHex(CLOTHES[walker.color % CLOTHES.length]));
      meshes.head.setMatrixAt(n, this.dummy.matrix);
      meshes.head.setColorAt(n, this.color.setHex(0xffffff));
      used.set(pose, n + 1);
    }
    for (const [pose, meshes] of this.visitorMeshes) {
      const n = used.get(pose) ?? 0;
      for (const mesh of [meshes.body, meshes.head]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.fly(dt);
    this.placeCamera();
    this.zoo.setCamera(this.camera.position);
    this.zoo.update(this.time);
    this.updateBursts(Math.min(dt, 0.1));
    const pose = this.selected >= 0 ? this.zoo.poses.get(this.selected) : undefined;
    this.ring.visible = !!pose;
    if (pose) {
      const r = Math.max(0.35, pose.height * 0.55);
      this.ring.position.set(pose.x, 0.08, pose.z);
      this.ring.scale.setScalar(r * (1 + Math.sin(this.time * 4) * 0.05));
    }
    if (!this.fx.render(this.scene, this.camera, { focus: this.target, sun: this.sun, hazeRange: [0.9, 3.2], hazeAmount: 0.45 })) this.renderer.render(this.scene, this.camera);
    return events;
  }

  /** Counts for tests and the perf check. */
  stats(): { walkers: number; drawCalls: number; triangles: number; grass: number; paths: number; habitatGrass: number; habitatMeshes: number } {
    return {
      habitatGrass: this.dressing.stats().grass,
      habitatMeshes: this.dressing.meshes(),
      walkers: this.crowd.walkers.filter((walker) => walker.state !== "gone").length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      grass: this.grass.count,
      paths: this.paths.count,
    };
  }

  dispose(): void {
    // Free the WebGL context right away: every visit makes a fresh canvas, and leaked contexts
    // push the browser over its limit (the city context gets dropped, new scenes fail to start).
    // (Geometries are cached and partly shared with the city, so they are not disposed here.)
    this.fx.dispose();
    this.dressing.dispose();
    for (const texture of this.glyphs.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
