/**
 * Tierpark level renderer: its own Three.js scene with a 40×40 tile park (2 world units per tile).
 * Paths, curbs, every object kind, habitats, border hedges, outside trees, grass tufts and visitors
 * are instanced (one draw call per kind); animals, jeeps and habitat grass come from a ZooLayer.
 */
import * as THREE from "three";
import {
  HABITAT_TILES,
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
  type ParkObject,
  type Walker,
  type ZooState,
} from "../../../shared/src/index.ts";
import { ZooLayer, type ZooSite } from "./zooLayer.ts";
import { buildPersonModels, habitatGeometry } from "./models.ts";
import { StyleFx } from "./styleFx.ts";
import { boothGeometry, borderGeometry, outerTreeGeometry, parkObjectGeometry } from "./parkModels.ts";
import { rng, setWindTime, swayMaterial, tuftGeometry } from "./zooDecor.ts";

export const PARK_HALF = (PARK_SIZE * PARK_TILE) / 2;
const HABITAT_TYPES = ["savanne", "wald", "wasser", "polar", "wiese"] as const;
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
  private readonly habitats = new Map<string, THREE.InstancedMesh>();
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
    for (const type of HABITAT_TYPES) {
      const mesh = instanced(habitatGeometry(type), this.material, 48, !low);
      this.habitats.set(type, mesh);
      this.scene.add(mesh);
    }
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

    this.zoo = new ZooLayer(this.scene, low ? 30 : 90);
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
    const sites: ZooSite[] = zoo.habitats.map((habitat) => {
      const at = habitatWorld(habitat.cell);
      return { cell: habitat.cell, type: habitat.type, x: at.x, y: 0, z: at.z, animals: zoo.animals.filter((animal) => animal.cell === habitat.cell), roads: [] };
    });
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
    for (const [type, mesh] of this.habitats) {
      let n = 0;
      for (const habitat of zoo.habitats) {
        if (habitat.type !== type) continue;
        const at = habitatWorld(habitat.cell);
        this.dummy.position.set(at.x, 0, at.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1.04, 1, 1.04);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(n++, this.dummy.matrix);
      }
      mesh.count = n;
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

  // ------------------------------------------------------------ camera

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
    const k = (this.distance * 1.15) / Math.max(320, this.height);
    const cos = Math.cos(this.azimuth);
    const sin = Math.sin(this.azimuth);
    this.target.x += (-dx * cos - dy * sin) * k;
    this.target.z += (dx * sin - dy * cos) * k;
    this.clampTarget();
  }

  rotate(delta: number): void {
    this.azimuth += delta;
  }

  zoom(factor: number): void {
    this.distance = Math.max(16, Math.min(125, this.distance * factor));
  }

  lookAt(x: number, z: number, distance?: number): void {
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
    this.placeCamera();
    this.zoo.setCamera(this.camera.position);
    this.zoo.update(this.time);
    if (!this.fx.render(this.scene, this.camera, { focus: this.target, sun: this.sun, hazeRange: [0.9, 3.2], hazeAmount: 0.45 })) this.renderer.render(this.scene, this.camera);
    return events;
  }

  /** Counts for tests and the perf check. */
  stats(): { walkers: number; drawCalls: number; triangles: number; grass: number; paths: number } {
    return {
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
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
