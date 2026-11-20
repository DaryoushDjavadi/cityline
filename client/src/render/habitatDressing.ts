/**
 * Habitat dressing in the Tierpark at the quality of the old interior view: painted ground per
 * type, varied fences, bushes, flowers, stones, hay, ponds with waves and ice floes, swaying grass –
 * plus the furniture the player placed. Built from the interior decor set (one per habitat type,
 * cached) and merged so the whole park needs only a handful of draw calls:
 *   static decor (1) · ground atlas (1) · grass (1, instanced, wind shader) · water (1, instanced,
 *   waves) · furniture (1).
 */
import * as THREE from "three";
import { HABITAT_TILES, ITEM_GRID, PARK_TILE, itemSize, type Habitat, type HabitatItem, type HabitatType } from "../../../shared/src/index.ts";
import { buildInteriorDecor, groundTexture, swayMaterial, tuftGeometry, waterSurfaceMaterial, type DecorType, type InteriorDecor } from "./zooDecor.ts";
import { itemGeometry } from "./zooModels.ts";

/** Interior decor units: 8 spots of 2.2 across. */
const DECOR_SPOT = 2.2;
const DECOR_HALF = (ITEM_GRID * DECOR_SPOT) / 2;
/** Half the usable inside of a 5 × 5 tile habitat in park units (fence just inside the tiles). */
export const HABITAT_INNER = (HABITAT_TILES * PARK_TILE) / 2 - 0.8;
/** Interior units → park units. */
export const DRESS_SCALE = HABITAT_INNER / DECOR_HALF;
/** One furniture spot in park units. */
export const SPOT_SIZE = DECOR_SPOT * DRESS_SCALE;
const TYPES: DecorType[] = ["savanne", "wald", "wasser", "polar", "wiese"];

/** Spot (x, y) of a `size`-spot item → offset from the habitat centre in park units. */
export function spotOffset(x: number, y: number, size = 1): { x: number; z: number } {
  return { x: (-DECOR_HALF + (x + size / 2) * DECOR_SPOT) * DRESS_SCALE, z: (-DECOR_HALF + (y + size / 2) * DECOR_SPOT) * DRESS_SCALE };
}

/** Park offset from the habitat centre → grid spot, or null outside the grid. */
export function spotFromOffset(dx: number, dz: number): { x: number; y: number } | null {
  const x = Math.floor((dx / DRESS_SCALE + DECOR_HALF) / DECOR_SPOT);
  const y = Math.floor((dz / DRESS_SCALE + DECOR_HALF) / DECOR_SPOT);
  if (x < 0 || y < 0 || x >= ITEM_GRID || y >= ITEM_GRID) return null;
  return { x, y };
}

/** Furniture model scale (interior units → park). */
export function itemScale(kind: string): number {
  return (kind === "shelter" ? 1.35 : kind === "rock" ? 1.4 : 1.25) * DRESS_SCALE;
}

function poolOf(type: DecorType): { x: number; z: number; w: number; d: number } | null {
  return type === "wasser" || type === "polar" ? { x: DECOR_HALF - DECOR_SPOT * 1.8, z: -DECOR_HALF + DECOR_SPOT * 1.3, w: DECOR_SPOT * 3.6, d: DECOR_SPOT * 2.6 } : null;
}

interface Baked {
  pos: number[];
  nor: number[];
  col: number[];
}

const tmpM = new THREE.Matrix4();
const tmpN = new THREE.Matrix3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const white = new THREE.Color(1, 1, 1);

/** Append a geometry (any index/normals/colors) transformed by `matrix`, tinted by `tint`. */
function bake(out: Baked, source: THREE.BufferGeometry, matrix: THREE.Matrix4, tint: THREE.Color, flat: boolean): void {
  let geometry = source.index ? source.toNonIndexed() : source;
  if (flat) {
    if (geometry === source) geometry = source.clone();
    geometry.deleteAttribute("normal");
    geometry.computeVertexNormals();
  }
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const col = geometry.getAttribute("color");
  tmpN.getNormalMatrix(matrix);
  for (let i = 0; i < pos.count; i += 1) {
    tmpV.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    out.pos.push(tmpV.x, tmpV.y, tmpV.z);
    if (nor) tmpV.fromBufferAttribute(nor, i).applyMatrix3(tmpN).normalize();
    else tmpV.set(0, 1, 0);
    out.nor.push(tmpV.x, tmpV.y, tmpV.z);
    if (col) tmpC.setRGB(col.getX(i), col.getY(i), col.getZ(i)).multiply(tint);
    else tmpC.copy(tint);
    out.col.push(tmpC.r, tmpC.g, tmpC.b);
  }
  if (geometry !== source) geometry.dispose();
}

function toGeometry(baked: Baked): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(baked.pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(baked.nor, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(baked.col, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export class HabitatDressing {
  private readonly decor = new Map<DecorType, InteriorDecor>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 });
  private readonly statics: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly groundMaterial: THREE.MeshStandardMaterial;
  private readonly grass: THREE.InstancedMesh;
  private readonly water: THREE.InstancedMesh;
  private readonly furniture: THREE.Mesh;
  private readonly itemCache = new Map<string, THREE.BufferGeometry>();
  private layoutKey = "";
  private itemsKey = "";

  constructor(private readonly scene: THREE.Scene, private readonly low: boolean) {
    this.statics = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.statics.castShadow = !low;
    this.statics.receiveShadow = true;
    this.furniture = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.furniture.castShadow = !low;
    this.furniture.receiveShadow = true;
    this.groundMaterial = new THREE.MeshStandardMaterial({ map: this.atlas(), roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), this.groundMaterial);
    this.ground.receiveShadow = true;
    this.grass = new THREE.InstancedMesh(tuftGeometry(7, 12), swayMaterial(1.1), low ? 2400 : 7200);
    this.grass.count = 0;
    this.grass.receiveShadow = true;
    this.water = new THREE.InstancedMesh(new THREE.RingGeometry(0.001, 0.5, low ? 16 : 40, low ? 3 : 8).rotateX(-Math.PI / 2), waterSurfaceMaterial(0xffffff), 64);
    this.water.count = 0;
    for (const mesh of [this.statics, this.ground, this.grass, this.water, this.furniture]) {
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.water.renderOrder = 1;
  }

  /** Five painted grounds side by side (one texture, one draw call for every habitat floor). */
  private atlas(): THREE.CanvasTexture {
    const size = this.low ? 256 : 512;
    const canvas = document.createElement("canvas");
    canvas.width = size * TYPES.length;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    TYPES.forEach((type, i) => {
      const texture = groundTexture(type, size);
      ctx.drawImage(texture.image as HTMLCanvasElement, i * size, 0);
      texture.dispose();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private decorFor(type: DecorType): InteriorDecor {
    let set = this.decor.get(type);
    if (!set) {
      const edge = DECOR_HALF + 0.5;
      set = buildInteriorDecor(type, { half: DECOR_HALF, edge, step: (edge * 2) / (ITEM_GRID * 2), pool: poolOf(type), low: this.low });
      set.group.updateMatrixWorld(true);
      this.decor.set(type, set);
    }
    return set;
  }

  /** Rebuild the decor when habitats were built, removed or changed type. */
  setHabitats(habitats: { cell: number; type: HabitatType; x: number; z: number }[]): void {
    const key = habitats.map((h) => `${h.cell}:${h.type}:${h.x}:${h.z}`).join("|");
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const baked: Baked = { pos: [], nor: [], col: [] };
    const groundPos: number[] = [];
    const groundUv: number[] = [];
    const place = new THREE.Matrix4();
    const scale = new THREE.Matrix4().makeScale(DRESS_SCALE, DRESS_SCALE, DRESS_SCALE);
    const instance = new THREE.Matrix4();
    let grass = 0;
    let water = 0;
    const grassCap = this.grass.instanceMatrix.count;
    for (const habitat of habitats) {
      const type = habitat.type as DecorType;
      place.makeTranslation(habitat.x, 0.02, habitat.z).multiply(scale);
      // ground quad (atlas slot of the type, a hair inside so slots never bleed)
      // The painted floor covers the whole 5 × 5 tile footprint.
      const g = (HABITAT_TILES * PARK_TILE) / 2;
      const slot = TYPES.indexOf(type);
      const u0 = (slot + 0.01) / TYPES.length;
      const u1 = (slot + 0.99) / TYPES.length;
      const y = 0.03;
      const [x0, x1, z0, z1] = [habitat.x - g, habitat.x + g, habitat.z - g, habitat.z + g];
      groundPos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      groundUv.push(u0, 1, u0, 0, u1, 0, u0, 1, u1, 0, u1, 1);
      const set = this.decorFor(type);
      set.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        const cacheKey = material.customProgramCacheKey?.() ?? "";
        const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
        const count = inst ? inst.count : 1;
        for (let i = 0; i < count; i += 1) {
          if (inst) inst.getMatrixAt(i, instance);
          else instance.identity();
          const world = tmpM.multiplyMatrices(place, mesh.matrixWorld).multiply(instance);
          const tint = new THREE.Color().copy(material.color ?? white);
          if (inst?.instanceColor) {
            inst.getColorAt(i, tmpC);
            tint.multiply(tmpC);
          }
          if (cacheKey.startsWith("sway")) {
            if (grass >= grassCap) continue;
            this.grass.setMatrixAt(grass, world);
            this.grass.setColorAt(grass, tint);
            grass += 1;
          } else if (cacheKey === "zoo-water") {
            if (water >= this.water.instanceMatrix.count) continue;
            this.water.setMatrixAt(water, world);
            this.water.setColorAt(water, tint);
            water += 1;
          } else bake(baked, mesh.geometry, world, tint, material.flatShading);
        }
      });
    }
    this.statics.geometry.dispose();
    this.statics.geometry = toGeometry(baked);
    this.ground.geometry.dispose();
    const ground = new THREE.BufferGeometry();
    ground.setAttribute("position", new THREE.Float32BufferAttribute(groundPos, 3));
    ground.setAttribute("normal", new THREE.Float32BufferAttribute(groundPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    ground.setAttribute("uv", new THREE.Float32BufferAttribute(groundUv, 2));
    this.ground.geometry = ground;
    this.grass.count = grass;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    this.water.count = water;
    this.water.instanceMatrix.needsUpdate = true;
    if (this.water.instanceColor) this.water.instanceColor.needsUpdate = true;
    this.statics.visible = baked.pos.length > 0;
    this.itemsKey = "";
  }

  /** Furniture of every habitat (rebuilt only when an item, its fill level or turn changed). */
  setItems(habitats: { habitat: Habitat; x: number; z: number }[]): void {
    const bucket = (item: HabitatItem) => (item.fill === undefined ? 100 : Math.round(item.fill / 20) * 20);
    const key = habitats.map(({ habitat, x, z }) => `${x},${z}:${habitat.items.map((item) => `${item.id}.${item.kind}.${item.x}.${item.y}.${item.rot ?? 0}.${bucket(item)}`).join(",")}`).join("|");
    if (key === this.itemsKey) return;
    this.itemsKey = key;
    const baked: Baked = { pos: [], nor: [], col: [] };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const { habitat, x, z } of habitats) {
      for (const item of habitat.items) {
        const geometry = this.itemGeometry(item.kind, bucket(item));
        const at = spotOffset(item.x, item.y, itemSize(item.kind));
        p.set(x + at.x, 0.03, z + at.z);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((item.rot ?? 0) * Math.PI) / 2);
        s.setScalar(itemScale(item.kind));
        bake(baked, geometry, m.compose(p, q, s), white, false);
      }
    }
    this.furniture.geometry.dispose();
    this.furniture.geometry = toGeometry(baked);
    this.furniture.visible = baked.pos.length > 0;
  }

  itemGeometry(kind: string, fill: number): THREE.BufferGeometry {
    const key = `${kind}:${fill}`;
    let geometry = this.itemCache.get(key);
    if (!geometry) {
      geometry = itemGeometry(kind, fill);
      this.itemCache.set(key, geometry);
    }
    return geometry;
  }

  /** Draw calls this layer adds (for the perf check). */
  meshes(): number {
    return [this.statics, this.ground, this.furniture].filter((mesh) => mesh.visible).length + (this.grass.count > 0 ? 1 : 0) + (this.water.count > 0 ? 1 : 0);
  }

  stats(): { grass: number; water: number; vertices: number; furniture: number } {
    return {
      grass: this.grass.count,
      water: this.water.count,
      vertices: this.statics.geometry.getAttribute("position")?.count ?? 0,
      furniture: this.furniture.geometry.getAttribute("position")?.count ?? 0,
    };
  }

  dispose(): void {
    for (const set of this.decor.values()) set.dispose();
    for (const geometry of this.itemCache.values()) geometry.dispose();
    for (const mesh of [this.statics, this.ground, this.furniture, this.grass, this.water]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.groundMaterial.map?.dispose();
    this.groundMaterial.dispose();
    this.material.dispose();
  }
}
