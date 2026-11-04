import * as THREE from "three";
import { ServiceKind, Zone } from "../../../shared/src/index.ts";

export interface BuiltModel {
  key: string;
  height: number;
  geometry: THREE.BufferGeometry;
}

type Shape = "box" | "cyl" | "cone" | "sphere";

interface Part {
  shape: Shape;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rot?: Partial<Pick<Part, "rx" | "ry" | "rz">>): Part => ({
  shape: "box",
  x,
  y,
  z,
  sx,
  sy,
  sz,
  color,
  ...rot,
});

function partGeometry(part: Part): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  if (part.shape === "cyl") geometry = new THREE.CylinderGeometry(part.sx, part.sz, part.sy, 12);
  else if (part.shape === "cone") geometry = new THREE.ConeGeometry(part.sx, part.sy, 4);
  else if (part.shape === "sphere") geometry = new THREE.SphereGeometry(part.sx, 12, 8);
  else geometry = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
  if (part.rx || part.ry || part.rz) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(part.rx ?? 0, part.ry ?? 0, part.rz ?? 0)));
  }
  geometry.translate(part.x, part.y, part.z);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color(part.color);
  for (let index = 0; index < count; index += 1) color.toArray(colors, index * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function compose(parts: Part[]): THREE.BufferGeometry {
  const pieces = parts.map(partGeometry);
  let vertices = 0;
  let indices = 0;
  for (const piece of pieces) {
    vertices += piece.getAttribute("position").count;
    const index = piece.getIndex();
    indices += index ? index.count : piece.getAttribute("position").count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let vertex = 0;
  let cursor = 0;
  for (const piece of pieces) {
    const positions = piece.getAttribute("position");
    const normals = piece.getAttribute("normal");
    const colors = piece.getAttribute("color");
    const base = vertex;
    for (let slot = 0; slot < positions.count; slot += 1) {
      position.set([positions.getX(slot), positions.getY(slot), positions.getZ(slot)], (vertex + slot) * 3);
      normal.set([normals.getX(slot), normals.getY(slot), normals.getZ(slot)], (vertex + slot) * 3);
      color.set([colors.getX(slot), colors.getY(slot), colors.getZ(slot)], (vertex + slot) * 3);
    }
    vertex += positions.count;
    const pieceIndex = piece.getIndex();
    if (pieceIndex) {
      for (let slot = 0; slot < pieceIndex.count; slot += 1) index[cursor++] = pieceIndex.getX(slot) + base;
    } else {
      for (let slot = 0; slot < positions.count; slot += 1) index[cursor++] = base + slot;
    }
    piece.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

function pitch(color: number): Part[] {
  return [
    box(0, 3.45, -1.05, 6.3, 0.28, 3.5, color, { rx: 0.62 }),
    box(0, 3.45, 1.05, 6.3, 0.28, 3.5, color, { rx: -0.62 }),
  ];
}

const CATALOG: Record<string, { height: number; parts: Part[] }> = {
  cottage: {
    height: 5.6,
    parts: [
      box(0, 0.18, 0, 6.4, 0.36, 5.6, 0x8d7b62),
      box(0, 1.7, 0, 5.5, 2.7, 4.7, 0xf0e2c8),
      ...pitch(0x8c3d32),
      box(0, 1.15, 2.4, 1.15, 1.9, 0.16, 0x5c3a2a),
      box(-1.35, 2.05, 2.38, 0.9, 0.85, 0.12, 0x9fd4e4),
      box(1.35, 2.05, 2.38, 0.9, 0.85, 0.12, 0x9fd4e4),
      box(1.7, 3.9, 0.4, 0.45, 1.5, 0.45, 0x6e6258),
    ],
  },
  apartments: {
    height: 9.4,
    parts: [
      box(0, 0.2, 0, 7.6, 0.4, 6.4, 0x7d7468),
      box(0, 4.4, 0, 7.1, 8, 5.8, 0xd9d0c2),
      box(0, 2.3, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(0, 4.5, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(0, 6.7, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(-1.7, 4.6, 2.96, 1.15, 5.6, 0.1, 0x7eb8cc),
      box(0, 4.6, 2.96, 1.15, 5.6, 0.1, 0x7eb8cc),
      box(1.7, 4.6, 2.96, 1.15, 5.6, 0.1, 0x7eb8cc),
      box(0, 8.6, 0, 7.5, 0.35, 6.2, 0x6e7c86),
      box(-3.15, 2.2, 0, 0.7, 4, 1.4, 0xc4b8a4),
    ],
  },
  tower: {
    height: 20.5,
    parts: [
      box(0, 0.25, 0, 5.6, 0.5, 5.6, 0x5e6a72),
      box(0, 8.6, 0, 4.7, 16.2, 4.7, 0xb7c9d4),
      box(0, 4, 2.4, 3.6, 0.18, 0.12, 0x6d8794),
      box(0, 8, 2.4, 3.6, 0.18, 0.12, 0x6d8794),
      box(0, 12, 2.4, 3.6, 0.18, 0.12, 0x6d8794),
      box(0, 16, 2.4, 3.6, 0.18, 0.12, 0x6d8794),
      box(0, 17.1, 0, 5.2, 0.7, 5.2, 0x4d5960),
      { shape: "cyl", x: 0, y: 19.2, z: 0, sx: 0.12, sy: 3.2, sz: 0.12, color: 0xd7dde2 },
    ],
  },
  shop: {
    height: 5.5,
    parts: [
      box(0, 0.18, 0, 7.6, 0.36, 5.6, 0x8a8174),
      box(0, 1.9, 0, 7.2, 3.1, 5.1, 0xf4efe4),
      box(0, 1.85, 2.6, 4.6, 2.1, 0.12, 0x8fd0e4),
      box(0, 3.15, 2.7, 5.4, 0.28, 1.3, 0xc44732),
      box(0, 4.15, 0, 3.4, 0.9, 0.28, 0xe2b15a),
      box(0, 0.85, 2.58, 1.3, 1.5, 0.12, 0x5c3a2a),
    ],
  },
  office: {
    height: 13.2,
    parts: [
      box(0, 0.3, 0, 7.2, 0.6, 7.2, 0x6a7378),
      box(0, 1.5, 0, 6.8, 1.8, 6.8, 0xd9d3c8),
      box(0, 7.2, 0, 5.2, 9.4, 5.2, 0x8eb8c9),
      box(0, 4.2, 2.66, 4.2, 0.14, 0.1, 0xe8eef2),
      box(0, 6.6, 2.66, 4.2, 0.14, 0.1, 0xe8eef2),
      box(0, 9, 2.66, 4.2, 0.14, 0.1, 0xe8eef2),
      box(0, 11.4, 2.66, 4.2, 0.14, 0.1, 0xe8eef2),
      box(0, 12.15, 0, 5.8, 0.45, 5.8, 0x4e5960),
    ],
  },
  mall: {
    height: 7.6,
    parts: [
      box(0, 0.2, 0, 8.8, 0.4, 7.4, 0x8b8176),
      box(0, 2.5, 0, 8.4, 4.2, 6.8, 0xf3e7ef),
      box(0, 4.8, 0, 8.8, 0.45, 7.2, 0xc9b8d4),
      box(0, 2.2, 3.5, 3.2, 2.6, 0.16, 0x9fd4e8),
      box(-2.2, 3.4, 3.55, 0.35, 3.2, 0.35, 0xe2b15a),
      box(2.2, 3.4, 3.55, 0.35, 3.2, 0.35, 0xe2b15a),
      box(0, 5.7, 0, 4.2, 0.7, 0.25, 0xc44732),
    ],
  },
  workshop: {
    height: 6.6,
    parts: [
      box(0, 0.18, 0, 7.2, 0.36, 5.8, 0x6e655c),
      box(0, 2.1, 0, 6.8, 3.4, 5.3, 0xc48a62),
      box(0, 3.95, 0, 7.1, 0.28, 5.6, 0x8a5a3c),
      box(0, 1.5, 2.7, 2.6, 2.2, 0.14, 0x4a4038),
      box(-2.2, 2.3, 2.7, 1.1, 1.1, 0.1, 0x9fd0e0),
      { shape: "cyl", x: 2.3, y: 4.5, z: -1.4, sx: 0.38, sy: 2.4, sz: 0.42, color: 0x6e6258 },
    ],
  },
  factory: {
    height: 9.8,
    parts: [
      box(0, 0.2, 0, 8.6, 0.4, 7.2, 0x6a6058),
      box(0, 2.6, 0, 8.2, 4.4, 6.6, 0xb86b3c),
      box(-1.6, 5.3, 0, 2.2, 0.28, 6.4, 0x8d5a40, { rx: 0.4 }),
      box(1.6, 5.3, 0, 2.2, 0.28, 6.4, 0x8d5a40, { rx: -0.4 }),
      box(0, 1.4, 3.4, 3.2, 2.1, 0.16, 0x3d3834),
      { shape: "cyl", x: -2.6, y: 6.4, z: -2.2, sx: 0.45, sy: 3.6, sz: 0.5, color: 0x6a5e56 },
      { shape: "cyl", x: 2.4, y: 7.2, z: -2.2, sx: 0.55, sy: 5.2, sz: 0.6, color: 0x5c534c },
    ],
  },
  plant: {
    height: 12.4,
    parts: [
      box(0, 0.25, 0.4, 8.8, 0.5, 7.6, 0x5c564e),
      box(-0.8, 2.8, 0.6, 5.4, 4.6, 6.2, 0x8d5a48),
      { shape: "cyl", x: 2.7, y: 2.4, z: -1.8, sx: 1.15, sy: 4.2, sz: 1.15, color: 0xb7c3c8 },
      { shape: "cyl", x: 2.7, y: 2.2, z: 1.5, sx: 0.9, sy: 3.6, sz: 0.9, color: 0x9aa7ad },
      { shape: "cyl", x: -3.1, y: 7.2, z: -1.6, sx: 0.7, sy: 8.4, sz: 0.78, color: 0x6e6258 },
      box(2.7, 4.6, -1.8, 2.5, 0.25, 2.5, 0x4e555c),
    ],
  },
  power: {
    height: 14.5,
    parts: [
      box(0, 0.3, 0, 8.2, 0.6, 7.4, 0x5a5148),
      box(-1.2, 2.4, 0.4, 4.6, 3.6, 5.4, 0xc2b49a),
      { shape: "cyl", x: 2.2, y: 6.4, z: -0.6, sx: 1.35, sy: 11, sz: 1.55, color: 0xe2b33a },
      { shape: "cyl", x: 2.2, y: 10.6, z: -0.6, sx: 1.05, sy: 1.4, sz: 1.45, color: 0x8a6a32 },
      box(2.2, 2.2, 1.8, 1.6, 1.5, 1.2, 0x6e6258),
    ],
  },
  waterworks: {
    height: 7.4,
    parts: [
      box(0, 0.2, 0, 8, 0.4, 7.2, 0x6a7c86),
      box(-1.8, 1.8, 0.4, 3.6, 2.8, 4.2, 0xd5e4ea),
      { shape: "cyl", x: 1.8, y: 2.6, z: -0.4, sx: 1.7, sy: 4.6, sz: 1.7, color: 0x3d88b5 },
      { shape: "cyl", x: 1.8, y: 5.05, z: -0.4, sx: 1.85, sy: 0.35, sz: 1.85, color: 0x2a5f80 },
      box(-1.8, 1.7, 2.15, 1.4, 1.6, 0.12, 0x7eb4c8),
    ],
  },
  school: {
    height: 6.8,
    parts: [
      box(0, 0.18, 0, 8.4, 0.36, 6.2, 0x8a7560),
      box(0, 2, 0, 8, 3.2, 5.6, 0xf2e4d4),
      box(0, 4.15, -0.9, 8.3, 0.28, 3.6, 0xc46a4a, { rx: 0.5 }),
      box(0, 4.15, 0.9, 8.3, 0.28, 3.6, 0xc46a4a, { rx: -0.5 }),
      box(0, 1.2, 2.85, 1.6, 2, 0.14, 0x5c3a2a),
      box(-2.4, 2.2, 2.85, 1.3, 1.1, 0.1, 0x9fd4e4),
      box(2.4, 2.2, 2.85, 1.3, 1.1, 0.1, 0x9fd4e4),
      { shape: "cyl", x: 3.4, y: 4.6, z: 0, sx: 0.08, sy: 2.4, sz: 0.08, color: 0x6e6258 },
    ],
  },
  clinic: {
    height: 7.2,
    parts: [
      box(0, 0.2, 0, 7.4, 0.4, 6.4, 0xb7c0c4),
      box(0, 2.6, 0, 6.8, 4.4, 5.8, 0xf7f8f8),
      box(0, 5.1, 0, 7.2, 0.4, 6.2, 0xd5dbde),
      box(0, 6.1, 0, 0.45, 1.6, 0.2, 0xc44732),
      box(0, 6.1, 0, 1.6, 0.45, 0.2, 0xc44732),
      box(0, 2, 2.95, 2.2, 2.2, 0.12, 0x9fd0e0),
    ],
  },
  police: {
    height: 8.4,
    parts: [
      box(0, 0.2, 0, 7.2, 0.4, 6.2, 0x3a4a5c),
      box(-0.6, 2.2, 0, 5.4, 3.6, 5.4, 0x355f86),
      box(2.3, 3.4, 0, 2.2, 6, 2.4, 0x2a4c70),
      box(2.3, 6.6, 0, 2.6, 0.4, 2.8, 0xe2b15a),
      box(0, 1.3, 2.75, 1.5, 2.1, 0.12, 0x1d3044),
      box(-1.8, 2.4, 2.75, 1, 1.3, 0.1, 0x9fd4e4),
    ],
  },
  fire: {
    height: 8.2,
    parts: [
      box(0, 0.2, 0, 8, 0.4, 6.4, 0x6a4038),
      box(0, 2.2, 0, 7.6, 3.6, 5.8, 0xc44732),
      box(-1.5, 1.4, 2.95, 1.8, 2.1, 0.12, 0xd8dde2),
      box(1.2, 1.4, 2.95, 1.8, 2.1, 0.12, 0xd8dde2),
      box(3.1, 3.6, -0.6, 1.5, 6.4, 1.5, 0x9a3424),
      box(3.1, 7, -0.6, 2, 0.4, 2, 0xf0e2c8),
    ],
  },
  park: {
    height: 3.6,
    parts: [
      box(0, 0.12, 0, 8.6, 0.24, 8.2, 0x3f8f4a),
      box(0, 0.2, 0, 2.4, 0.16, 2.4, 0xd7e2c8),
      { shape: "cyl", x: 0, y: 0.7, z: 0, sx: 0.7, sy: 0.8, sz: 0.7, color: 0x8aa0a8 },
      { shape: "cone", x: -2.6, y: 1.8, z: -1.8, sx: 1.15, sy: 2.8, sz: 1, color: 0x2f6a3c, ry: 0.4 },
      { shape: "cone", x: 2.5, y: 1.6, z: 1.6, sx: 1, sy: 2.4, sz: 1, color: 0x4e7d43 },
    ],
  },
  university: {
    height: 9.2,
    parts: [
      box(0, 0.25, 0, 8.8, 0.5, 7.6, 0x6d645c),
      box(0, 2.4, 0, 8.2, 3.8, 6.8, 0xe7e0d4),
      box(-3.2, 2.3, 3.3, 0.45, 3.4, 0.45, 0xf4efe4),
      box(-1.1, 2.3, 3.3, 0.45, 3.4, 0.45, 0xf4efe4),
      box(1.1, 2.3, 3.3, 0.45, 3.4, 0.45, 0xf4efe4),
      box(3.2, 2.3, 3.3, 0.45, 3.4, 0.45, 0xf4efe4),
      box(0, 4.6, 0, 8.6, 0.4, 7.2, 0x6d5a8a),
      { shape: "sphere", x: 0, y: 6.5, z: 0, sx: 1.7, sy: 1.7, sz: 1.7, color: 0x8d7eae },
      { shape: "cyl", x: 0, y: 8.3, z: 0, sx: 0.1, sy: 1.5, sz: 0.1, color: 0xe2b15a },
    ],
  },
  farm: {
    height: 7.2,
    parts: [
      box(0, 0.1, 0, 9.2, 0.2, 8.6, 0x6d8f3c),
      box(-2.2, 0.16, 1.8, 3.6, 0.12, 4.2, 0xc2a24a),
      box(2.4, 0.16, 1.6, 3.2, 0.12, 3.6, 0xb7c45a),
      box(-2.1, 1.7, -2.1, 4.4, 2.8, 3.4, 0xc48a4a),
      box(-2.1, 3.55, -2.1, 4.8, 0.28, 3.8, 0x8a4a32, { rx: 0.42 }),
      box(0.2, 1.1, -2.1, 1.4, 1.8, 0.12, 0x5c3a2a),
      { shape: "cyl", x: 2.6, y: 2.4, z: -2.2, sx: 1.05, sy: 4.4, sz: 1.05, color: 0xd9c7a2 },
      { shape: "cone", x: 2.6, y: 4.9, z: -2.2, sx: 1.2, sy: 0.9, sz: 1.2, color: 0x8a4a32 },
      box(2.2, 0.55, 2.4, 1.6, 0.7, 1.1, 0x6e6258),
    ],
  },
  airport: {
    height: 8.4,
    parts: [
      box(0, 0.08, 0, 9.4, 0.16, 8.6, 0x4e7d43),
      box(0, 0.14, 0, 9.2, 0.12, 2.2, 0x5c5550),
      box(0, 0.16, 0, 8.4, 0.04, 0.18, 0xe7d7a1),
      box(-2.8, 1.3, 2.8, 3.6, 2.2, 2.6, 0xb7c3c8),
      box(-2.8, 2.5, 2.8, 3.9, 0.22, 2.9, 0x6a7378),
      box(3.1, 2.4, 2.9, 1.3, 4.4, 1.3, 0xd9d3c8),
      box(3.1, 4.8, 2.9, 1.7, 0.28, 1.7, 0xe2b15a),
      { shape: "cyl", x: 3.1, y: 6.8, z: 2.9, sx: 0.08, sy: 2.2, sz: 0.08, color: 0xc44732 },
      box(2.4, 0.45, -0.2, 1.8, 0.5, 1.1, 0xf4efe4),
    ],
  },
};

export function buildModels(): BuiltModel[] {
  return Object.entries(CATALOG).map(([key, entry]) => ({
    key,
    height: entry.height,
    geometry: compose(entry.parts),
  }));
}

export function modelForZone(zone: number, level: number): { key: string; height: number } | null {
  if (level <= 0) return null;
  if (zone === Zone.Residential && level <= 2) return { key: "cottage", height: CATALOG.cottage.height };
  if (zone === Zone.Residential && level <= 4) return { key: "apartments", height: CATALOG.apartments.height };
  if (zone === Zone.Residential) return { key: "tower", height: CATALOG.tower.height };
  if (zone === Zone.Commercial && level <= 2) return { key: "shop", height: CATALOG.shop.height };
  if (zone === Zone.Commercial && level <= 4) return { key: "office", height: CATALOG.office.height };
  if (zone === Zone.Commercial) return { key: "mall", height: CATALOG.mall.height };
  if (zone === Zone.Industrial && level <= 2) return { key: "workshop", height: CATALOG.workshop.height };
  if (zone === Zone.Industrial && level <= 4) return { key: "factory", height: CATALOG.factory.height };
  if (zone === Zone.Industrial) return { key: "plant", height: CATALOG.plant.height };
  if (zone === Zone.Farm) return { key: "farm", height: CATALOG.farm.height };
  return null;
}

export function modelForService(kind: number): { key: string; height: number } | null {
  if (kind === ServiceKind.Power) return { key: "power", height: CATALOG.power.height };
  if (kind === ServiceKind.Water) return { key: "waterworks", height: CATALOG.waterworks.height };
  if (kind === ServiceKind.School) return { key: "school", height: CATALOG.school.height };
  if (kind === ServiceKind.Clinic) return { key: "clinic", height: CATALOG.clinic.height };
  if (kind === ServiceKind.Police) return { key: "police", height: CATALOG.police.height };
  if (kind === ServiceKind.Fire) return { key: "fire", height: CATALOG.fire.height };
  if (kind === ServiceKind.Park) return { key: "park", height: CATALOG.park.height };
  if (kind === ServiceKind.University) return { key: "university", height: CATALOG.university.height };
  if (kind === ServiceKind.Airport) return { key: "airport", height: CATALOG.airport.height };
  return null;
}

export function buildPlaneGeometry(): THREE.BufferGeometry {
  return compose([
    box(0, 0.18, 0, 3.2, 0.38, 0.7, 0xf4efe4),
    box(0.2, 0.22, 0, 1.1, 0.12, 3.8, 0xd7dde2),
    box(-1.35, 0.55, 0, 0.7, 0.7, 0.12, 0xc44732),
    box(1.2, 0.42, 0, 0.7, 0.28, 0.55, 0x6e7c86),
    { shape: "cyl", x: 0.4, y: 0.42, z: 0, sx: 0.22, sy: 0.28, sz: 0.22, color: 0x9fd4e4 },
  ]);
}
