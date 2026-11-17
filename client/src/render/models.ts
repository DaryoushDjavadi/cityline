import * as THREE from "three";
import { farmModelKey, ServiceKind, Zone } from "../../../shared/src/index.ts";

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
  else if (part.shape === "cone") geometry = new THREE.ConeGeometry(part.sx, part.sy, 6);
  else if (part.shape === "sphere") {
    geometry = new THREE.SphereGeometry(part.sx, 10, 7);
    if (part.sy !== part.sx || part.sz !== part.sx) geometry.scale(1, part.sy / part.sx, part.sz / part.sx);
  } else geometry = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
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
    box(0, 3.92, 0, 6.35, 0.16, 0.42, color),
  ];
}

const WIN = 0x8ec8ea;

const CATALOG: Record<string, { height: number; parts: Part[] }> = {
  cottage: {
    height: 5.6,
    parts: [
      box(0, 0.18, 0, 6.4, 0.36, 5.6, 0xb89668),
      box(0, 1.7, 0, 5.5, 2.7, 4.7, 0xffe6c4),
      ...pitch(0xe24a32),
      box(0, 1.15, 2.4, 1.15, 1.9, 0.16, 0x6a4532),
      box(-1.35, 2.05, 2.38, 0.9, 0.85, 0.12, WIN),
      box(1.35, 2.05, 2.38, 0.9, 0.85, 0.12, WIN),
      box(1.7, 3.9, 0.4, 0.45, 1.5, 0.45, 0x7a6c60),
    ],
  },
  apartments: {
    height: 9.4,
    parts: [
      box(0, 0.2, 0, 7.6, 0.4, 6.4, 0x7d7468),
      box(0, 4.4, 0, 7.1, 8, 5.8, 0xf3d8b4),
      box(0, 2.3, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(0, 4.5, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(0, 6.7, 2.95, 6.4, 0.16, 0.18, 0xb7aa96),
      box(-1.7, 4.6, 2.96, 1.15, 5.6, 0.1, WIN),
      box(0, 4.6, 2.96, 1.15, 5.6, 0.1, WIN),
      box(1.7, 4.6, 2.96, 1.15, 5.6, 0.1, WIN),
      box(0, 8.6, 0, 7.5, 0.35, 6.2, 0x8a6a52),
      box(-3.15, 2.2, 0, 0.7, 4, 1.4, 0xc4b8a4),
    ],
  },
  tower: {
    height: 20.5,
    parts: [
      box(0, 0.25, 0, 5.6, 0.5, 5.6, 0x5e6a72),
      box(0, 8.6, 0, 4.7, 16.2, 4.7, 0xe8cba0),
      box(0, 4, 2.4, 3.6, 0.18, 0.12, WIN),
      box(0, 8, 2.4, 3.6, 0.18, 0.12, WIN),
      box(0, 12, 2.4, 3.6, 0.18, 0.12, WIN),
      box(0, 16, 2.4, 3.6, 0.18, 0.12, WIN),
      box(-1.1, 8.6, 2.38, 0.7, 14.2, 0.08, WIN),
      box(1.1, 8.6, 2.38, 0.7, 14.2, 0.08, WIN),
      box(0, 17.1, 0, 5.2, 0.7, 5.2, 0x4d5960),
      { shape: "cyl", x: 0, y: 19.2, z: 0, sx: 0.12, sy: 3.2, sz: 0.12, color: 0xd7dde2 },
    ],
  },
  shop: {
    height: 5.5,
    parts: [
      box(0, 0.18, 0, 7.6, 0.36, 5.6, 0x8a8174),
      box(0, 1.9, 0, 7.2, 3.1, 5.1, 0xfff0dc),
      box(0, 1.85, 2.6, 4.6, 2.1, 0.12, WIN),
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
      box(0, 7.2, 0, 5.2, 9.4, 5.2, 0xe6c8a0),
      box(0, 4.2, 2.66, 4.2, 0.14, 0.1, WIN),
      box(0, 6.6, 2.66, 4.2, 0.14, 0.1, WIN),
      box(0, 9, 2.66, 4.2, 0.14, 0.1, WIN),
      box(0, 11.4, 2.66, 4.2, 0.14, 0.1, WIN),
      box(0, 12.15, 0, 5.8, 0.45, 5.8, 0x4e5960),
    ],
  },
  mall: {
    height: 7.6,
    parts: [
      box(0, 0.2, 0, 8.8, 0.4, 7.4, 0x8b8176),
      box(0, 2.5, 0, 8.4, 4.2, 6.8, 0xf3e7ef),
      box(0, 4.8, 0, 8.8, 0.45, 7.2, 0xc9b8d4),
      box(0, 2.2, 3.5, 3.2, 2.6, 0.16, WIN),
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
      box(-2.2, 2.3, 2.7, 1.1, 1.1, 0.1, WIN),
      { shape: "cyl", x: 2.3, y: 4.5, z: -1.4, sx: 0.38, sy: 2.4, sz: 0.42, color: 0x6e6258 },
    ],
  },
  factory: {
    height: 9.8,
    parts: [
      box(0, 0.2, 0, 8.6, 0.4, 7.2, 0x6a6058),
      box(0, 2.6, 0, 8.2, 4.4, 6.6, 0xb24e36),
      box(-1.6, 5.3, 0, 2.2, 0.28, 6.4, 0x8d5a40, { rx: 0.4 }),
      box(1.6, 5.3, 0, 2.2, 0.28, 6.4, 0x8d5a40, { rx: -0.4 }),
      box(0, 1.4, 3.4, 3.2, 2.1, 0.16, 0x3d3834),
      { shape: "cyl", x: -2.6, y: 6.4, z: -2.2, sx: 0.45, sy: 3.6, sz: 0.5, color: 0x6a5e56 },
      ...stripedStack(2.4, -2.2, 7.2, 0.55, 5.2),
    ],
  },
  plant: {
    height: 12.4,
    parts: [
      box(0, 0.25, 0.4, 8.8, 0.5, 7.6, 0x5c564e),
      box(-0.8, 2.8, 0.6, 5.4, 4.6, 6.2, 0xb24e36),
      { shape: "cyl", x: 2.7, y: 2.4, z: -1.8, sx: 1.15, sy: 4.2, sz: 1.15, color: 0xb7c3c8 },
      { shape: "cyl", x: 2.7, y: 2.2, z: 1.5, sx: 0.9, sy: 3.6, sz: 0.9, color: 0x9aa7ad },
      ...stripedStack(-3.1, -1.6, 7.2, 0.72, 8.4),
      box(2.7, 4.6, -1.8, 2.5, 0.25, 2.5, 0x4e555c),
    ],
  },
  power: {
    height: 14.5,
    parts: [
      box(0, 0.3, 0, 8.2, 0.6, 7.4, 0x5a5148),
      box(-1.2, 2.4, 0.4, 4.6, 3.6, 5.4, 0xc2b49a),
      { shape: "cyl", x: 2.2, y: 6.4, z: -0.6, sx: 1.35, sy: 11, sz: 1.55, color: 0xd8dde2 },
      ...stripedStack(2.2, -0.6, 11.4, 1.42, 2.2),
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
      box(-1.8, 1.7, 2.15, 1.4, 1.6, 0.12, WIN),
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
      box(-2.4, 2.2, 2.85, 1.3, 1.1, 0.1, WIN),
      box(2.4, 2.2, 2.85, 1.3, 1.1, 0.1, WIN),
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
      box(0, 2, 2.95, 2.2, 2.2, 0.12, WIN),
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
      box(-1.8, 2.4, 2.75, 1, 1.3, 0.1, WIN),
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
      box(0, 0.12, 0, 8.6, 0.24, 8.2, 0x6a9a58),
      box(0, 0.2, 0, 2.4, 0.16, 2.4, 0xd7e2c8),
      { shape: "cyl", x: 0, y: 0.7, z: 0, sx: 0.7, sy: 0.8, sz: 0.7, color: 0x8aa0a8 },
      { shape: "sphere", x: -2.6, y: 1.7, z: -1.8, sx: 1.05, sy: 1.05, sz: 1.05, color: 0x7da85e },
      { shape: "sphere", x: 2.5, y: 1.55, z: 1.6, sx: 0.9, sy: 0.9, sz: 0.9, color: 0x6e9854 },
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
  farm: { height: 7.2, parts: farmWheatParts() },
  farmWet: { height: 7.2, parts: [...farmWheatParts(), ...farmIrrigationParts()] },
  farmSilo: { height: 8.6, parts: [...farmWheatParts(), ...farmSiloParts()] },
  farmWetSilo: { height: 8.6, parts: [...farmWheatParts(), ...farmIrrigationParts(), ...farmSiloParts()] },
  farmHerd: { height: 7.2, parts: farmHerdParts() },
  farmHerdWet: { height: 7.2, parts: [...farmHerdParts(), ...farmIrrigationParts()] },
  farmHerdSilo: { height: 8.6, parts: [...farmHerdParts(), ...farmSiloParts()] },
  farmHerdWetSilo: { height: 8.6, parts: [...farmHerdParts(), ...farmIrrigationParts(), ...farmSiloParts()] },
  harbor: {
    height: 11.2,
    parts: harborParts(),
  },
  airport: {
    height: 10.4,
    parts: airportParts(),
  },
};

function stripedStack(x: number, z: number, y: number, radius: number, height: number): Part[] {
  const bands: Part[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    const h = height / steps;
    bands.push({
      shape: "cyl",
      x,
      y: y - height / 2 + h * (i + 0.5),
      z,
      sx: radius,
      sy: h * 0.92,
      sz: radius,
      color: i % 2 === 0 ? 0xc44732 : 0xf4efe4,
    });
  }
  return bands;
}

export function buildTreeModels(): BuiltModel[] {
  const round = (leaf: number, leaf2: number): Part[] => [
    { shape: "cyl", x: 0, y: 0.42, z: 0, sx: 0.18, sy: 0.84, sz: 0.18, color: 0x8a6840 },
    { shape: "sphere", x: 0, y: 1.55, z: 0, sx: 1.05, sy: 1.05, sz: 1.05, color: leaf },
    { shape: "sphere", x: 0.35, y: 2.05, z: 0.15, sx: 0.7, sy: 0.7, sz: 0.7, color: leaf2 },
    { shape: "sphere", x: -0.28, y: 1.95, z: -0.22, sx: 0.62, sy: 0.62, sz: 0.62, color: leaf },
  ];
  const pine = (leaf: number, leaf2: number): Part[] => [
    { shape: "cyl", x: 0, y: 0.4, z: 0, sx: 0.16, sy: 0.8, sz: 0.16, color: 0x7a5a38 },
    { shape: "cone", x: 0, y: 1.45, z: 0, sx: 1.05, sy: 1.5, sz: 1.05, color: leaf },
    { shape: "cone", x: 0, y: 2.25, z: 0, sx: 0.72, sy: 1.2, sz: 0.72, color: leaf2 },
  ];
  return [
    { key: "tree0", height: 3.2, geometry: compose(round(0x86b066, 0x94bc72)) },
    { key: "tree1", height: 3.2, geometry: compose(round(0x78a45a, 0x88b268)) },
    { key: "tree2", height: 3.2, geometry: compose(round(0x90ba6e, 0x7eaa60)) },
    { key: "tree3", height: 3.4, geometry: compose(pine(0x7aaa62, 0x88b86e)) },
    { key: "tree4", height: 3.4, geometry: compose(pine(0x6e9e56, 0x7eae64)) },
    { key: "tree5", height: 3.4, geometry: compose(pine(0x84b468, 0x74a45a)) },
  ];
}

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
  if (zone === Zone.Farm) return modelForFarm(0);
  return null;
}

export function modelForFarm(skills: number): { key: string; height: number } {
  const key = farmModelKey(skills);
  const entry = CATALOG[key] ?? CATALOG.farm;
  return { key: CATALOG[key] ? key : "farm", height: entry.height };
}

function farmWheatParts(): Part[] {
  return [
    box(0, 0.1, 0, 9.2, 0.2, 8.6, 0x6d8f3c),
    box(-2.4, 0.18, 1.9, 3.8, 0.14, 4.4, 0xd4b45a),
    box(2.5, 0.18, 1.7, 3.4, 0.14, 3.8, 0xc9c25a),
    box(-2.6, 0.42, 2.4, 0.35, 0.55, 0.35, 0xe2c86a),
    box(-1.4, 0.42, 1.2, 0.35, 0.55, 0.35, 0xe2c86a),
    box(-0.4, 0.42, 2.8, 0.35, 0.55, 0.35, 0xe2c86a),
    box(2.0, 0.42, 2.2, 0.35, 0.55, 0.35, 0xd6c04e),
    box(3.0, 0.42, 1.0, 0.35, 0.55, 0.35, 0xd6c04e),
    box(-2.1, 1.7, -2.1, 4.4, 2.8, 3.4, 0xc48a4a),
    box(-2.1, 3.55, -2.1, 4.8, 0.28, 3.8, 0x8a4a32, { rx: 0.42 }),
    box(0.2, 1.1, -2.1, 1.4, 1.8, 0.12, 0x5c3a2a),
    { shape: "cyl", x: 2.6, y: 2.0, z: -2.2, sx: 0.85, sy: 3.4, sz: 0.85, color: 0xd9c7a2 },
    { shape: "cone", x: 2.6, y: 4.0, z: -2.2, sx: 1.0, sy: 0.75, sz: 1.0, color: 0x8a4a32 },
    box(2.2, 0.55, 2.4, 1.6, 0.7, 1.1, 0x6e6258),
  ];
}

function farmHerdParts(): Part[] {
  return [
    box(0, 0.1, 0, 9.2, 0.2, 8.6, 0x5f8a45),
    box(-2.2, 0.16, 1.8, 4.0, 0.12, 4.4, 0x6fa05a),
    box(2.4, 0.16, 1.6, 3.4, 0.12, 3.8, 0x78a862),
    box(-3.8, 0.55, 1.8, 0.18, 0.9, 4.2, 0x8a6a4a),
    box(0.2, 0.55, 1.8, 0.18, 0.9, 4.2, 0x8a6a4a),
    box(-1.8, 0.55, -0.3, 4.0, 0.9, 0.18, 0x8a6a4a),
    box(-1.8, 0.55, 3.9, 4.0, 0.9, 0.18, 0x8a6a4a),
    { shape: "cyl", x: -2.6, y: 0.55, z: 2.2, sx: 0.45, sy: 0.7, sz: 0.7, color: 0xe8e0d4 },
    { shape: "cyl", x: -1.2, y: 0.5, z: 1.4, sx: 0.4, sy: 0.6, sz: 0.6, color: 0xd8cfc0 },
    { shape: "cyl", x: -2.0, y: 0.48, z: 2.9, sx: 0.35, sy: 0.55, sz: 0.55, color: 0xcfc6b8 },
    { shape: "sphere", x: 2.2, y: 0.45, z: 2.0, sx: 0.38, sy: 0.38, sz: 0.38, color: 0xf0ebe3 },
    { shape: "sphere", x: 3.0, y: 0.42, z: 1.3, sx: 0.32, sy: 0.32, sz: 0.32, color: 0xe8e2d8 },
    box(-2.1, 1.7, -2.1, 4.4, 2.8, 3.4, 0xc48a4a),
    box(-2.1, 3.55, -2.1, 4.8, 0.28, 3.8, 0x8a4a32, { rx: 0.42 }),
    box(0.2, 1.1, -2.1, 1.4, 1.8, 0.12, 0x5c3a2a),
    { shape: "cyl", x: 2.6, y: 2.0, z: -2.2, sx: 0.85, sy: 3.4, sz: 0.85, color: 0xd9c7a2 },
    { shape: "cone", x: 2.6, y: 4.0, z: -2.2, sx: 1.0, sy: 0.75, sz: 1.0, color: 0x8a4a32 },
  ];
}

function farmIrrigationParts(): Part[] {
  return [
    box(-2.2, 0.22, 0.2, 3.6, 0.08, 0.28, 0x3d88c8),
    box(2.4, 0.22, 0.4, 3.0, 0.08, 0.28, 0x3d88c8),
    box(0.1, 0.22, 1.8, 0.28, 0.08, 3.6, 0x4a9ad4),
    { shape: "cyl", x: -3.2, y: 0.7, z: 1.8, sx: 0.12, sy: 1.0, sz: 0.12, color: 0x6e7c86 },
    { shape: "cyl", x: 3.2, y: 0.7, z: 1.5, sx: 0.12, sy: 1.0, sz: 0.12, color: 0x6e7c86 },
  ];
}

function farmSiloParts(): Part[] {
  return [
    { shape: "cyl", x: 3.5, y: 2.8, z: -0.4, sx: 1.15, sy: 5.0, sz: 1.15, color: 0xc9b896 },
    { shape: "cone", x: 3.5, y: 5.7, z: -0.4, sx: 1.35, sy: 1.0, sz: 1.35, color: 0x8a4a32 },
    box(3.5, 0.35, -0.4, 1.5, 0.35, 1.5, 0x6e6258),
  ];
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
  if (kind === ServiceKind.Harbor) return { key: "harbor", height: CATALOG.harbor.height };
  return null;
}

function harborParts(): Part[] {
  const stone = 0xc5c8cc;
  const stoneDark = 0xa8adb4;
  const wood = 0xd4a56a;
  const woodDark = 0xb8884c;
  return [
    box(0, 0.18, -1.55, 9.9, 0.38, 6.8, stone),
    box(0, 0.4, -1.4, 9.5, 0.12, 6.3, stoneDark),
    box(-4.6, 0.52, -1.3, 0.2, 0.42, 6.0, 0x9aa0a8),
    box(4.6, 0.52, -1.3, 0.2, 0.42, 6.0, 0x9aa0a8),
    box(-2.55, 1.85, -2.2, 4.6, 2.7, 4.0, 0xf3ece0),
    box(-2.55, 3.45, -2.2, 5.05, 0.2, 2.2, 0xc44732, { rx: 0.5 }),
    box(-2.55, 3.45, -1.15, 5.05, 0.2, 2.2, 0xc44732, { rx: -0.5 }),
    box(-2.55, 3.82, -1.68, 5.1, 0.1, 0.32, 0x8a2e22),
    box(-4.7, 2.05, -2.2, 0.16, 2.2, 3.8, 0xe7dcc8),
    box(-0.4, 2.05, -2.2, 0.16, 2.2, 3.8, 0xe7dcc8),
    box(-2.55, 2.05, -0.18, 1.8, 1.25, 0.08, WIN),
    box(-3.5, 2.05, -0.18, 1.05, 1.05, 0.08, WIN),
    box(-1.6, 1.05, -0.16, 0.95, 1.55, 0.1, 0x6a4a32),
    { shape: "cyl", x: 3.45, y: 2.85, z: -2.45, sx: 0.58, sy: 5.2, sz: 0.58, color: 0xf7f4ee },
    { shape: "cyl", x: 3.45, y: 1.5, z: -2.45, sx: 0.64, sy: 0.26, sz: 0.64, color: 0xe23b32 },
    { shape: "cyl", x: 3.45, y: 2.35, z: -2.45, sx: 0.64, sy: 0.26, sz: 0.64, color: 0xe23b32 },
    { shape: "cyl", x: 3.45, y: 3.2, z: -2.45, sx: 0.64, sy: 0.26, sz: 0.64, color: 0xe23b32 },
    box(3.45, 5.6, -2.45, 1.45, 0.62, 1.45, 0xe23b32),
    box(3.45, 5.9, -1.68, 0.65, 0.38, 0.08, 0xffe08a),
    { shape: "cyl", x: 3.45, y: 6.4, z: -2.45, sx: 0.07, sy: 0.85, sz: 0.07, color: 0xf7f4ee },
    { shape: "cyl", x: -1.35, y: 3.7, z: 1.7, sx: 0.22, sy: 7.0, sz: 0.22, color: 0xf0b43c },
    { shape: "cyl", x: -1.35, y: 0.55, z: 1.7, sx: 0.62, sy: 0.7, sz: 0.62, color: 0x7a838c },
    box(-1.35, 7.15, 1.7, 0.7, 0.22, 2.6, 0xf5a318),
    box(0, 0.28, 4.7, 4.2, 0.26, 9.4, wood),
    box(0, 0.14, 8.9, 4.6, 0.16, 1.5, woodDark),
    box(-1.95, 0.5, 4.1, 0.16, 0.38, 8.2, woodDark),
    box(1.95, 0.5, 4.1, 0.16, 0.38, 8.2, woodDark),
    { shape: "cyl", x: -1.7, y: -0.38, z: 3.4, sx: 0.14, sy: 1.4, sz: 0.14, color: 0x8a6a48 },
    { shape: "cyl", x: 1.7, y: -0.38, z: 3.4, sx: 0.14, sy: 1.4, sz: 0.14, color: 0x8a6a48 },
    { shape: "cyl", x: -1.7, y: -0.46, z: 6.2, sx: 0.14, sy: 1.55, sz: 0.14, color: 0x8a6a48 },
    { shape: "cyl", x: 1.7, y: -0.46, z: 6.2, sx: 0.14, sy: 1.55, sz: 0.14, color: 0x8a6a48 },
    { shape: "cyl", x: -1.7, y: -0.54, z: 8.7, sx: 0.16, sy: 1.7, sz: 0.16, color: 0x8a6a48 },
    { shape: "cyl", x: 1.7, y: -0.54, z: 8.7, sx: 0.16, sy: 1.7, sz: 0.16, color: 0x8a6a48 },
    { shape: "cyl", x: -1.55, y: 0.62, z: 4.9, sx: 0.18, sy: 0.38, sz: 0.18, color: 0x3a3530 },
    { shape: "cyl", x: 1.55, y: 0.62, z: 4.9, sx: 0.18, sy: 0.38, sz: 0.18, color: 0x3a3530 },
    { shape: "cyl", x: -1.55, y: 0.62, z: 8.1, sx: 0.18, sy: 0.38, sz: 0.18, color: 0x3a3530 },
    { shape: "cyl", x: 1.55, y: 0.62, z: 8.1, sx: 0.18, sy: 0.38, sz: 0.18, color: 0x3a3530 },
    { shape: "cyl", x: -3.55, y: 1.65, z: 0.55, sx: 0.07, sy: 2.9, sz: 0.07, color: 0x4a4540 },
    box(-3.55, 3.15, 0.55, 0.5, 0.14, 0.5, 0xf0e0b0),
    { shape: "sphere", x: -3.55, y: 3.35, z: 0.55, sx: 0.16, sy: 0.16, sz: 0.16, color: 0xffe08a },
    { shape: "cyl", x: 3.7, y: 1.65, z: 0.4, sx: 0.07, sy: 2.9, sz: 0.07, color: 0x4a4540 },
    box(3.7, 3.15, 0.4, 0.5, 0.14, 0.5, 0xf0e0b0),
    { shape: "sphere", x: 3.7, y: 3.35, z: 0.4, sx: 0.16, sy: 0.16, sz: 0.16, color: 0xffe08a },
    box(2.7, 0.85, 1.05, 1.85, 1.15, 1.15, 0xe23b32),
    box(2.7, 2.0, 1.05, 1.85, 1.15, 1.15, 0x2f6fbe),
    box(2.7, 0.85, 2.4, 1.85, 1.15, 1.15, 0xf0c12e),
    box(-3.7, 0.78, 1.2, 1.85, 1.0, 1.15, 0x2f9a55),
    box(-3.7, 1.78, 1.2, 1.85, 1.0, 1.15, 0xe23b32),
    box(3.45, 0.55, 3.95, 1.35, 0.65, 1.35, 0x8b93a0),
    { shape: "cyl", x: 0.15, y: -0.02, z: 11.15, sx: 0.26, sy: 0.65, sz: 0.26, color: 0xe23b32 },
    { shape: "cyl", x: 0.15, y: 0.4, z: 11.15, sx: 0.4, sy: 0.2, sz: 0.4, color: 0xf7f4ee },
    { shape: "cyl", x: 0.15, y: 0.9, z: 11.15, sx: 0.05, sy: 0.85, sz: 0.05, color: 0xf7f4ee },
  ];
}

function airportParts(): Part[] {
  const marks: Part[] = [];
  for (let i = 0; i < 8; i += 1) {
    marks.push(box(-4.15, 0.24, -1.55 + i * 0.44, 0.7, 0.04, 0.18, 0xf4efe4));
  }
  for (let i = 0; i < 7; i += 1) {
    marks.push(box(-2.4 + i * 1.05, 0.22, 0, 0.55, 0.03, 0.16, 0xf4efe4));
  }
  return [
    box(0, 0.08, 0, 18.5, 0.16, 10.4, 0x7bb056),
    box(1.2, 0.2, 0.15, 17.6, 0.16, 5.1, 0x9aa1a8),
    box(1.2, 0.26, -2.28, 17.2, 0.04, 0.14, 0xf7f4ee),
    box(1.2, 0.26, 2.55, 17.2, 0.04, 0.14, 0xf7f4ee),
    box(-7.4, 0.28, 0.15, 0.14, 0.05, 4.9, 0xf7f4ee),
    box(9.8, 0.28, 0.15, 0.14, 0.05, 4.9, 0xf7f4ee),
    ...marks,
    box(-3.35, 0.26, 1.55, 0.55, 0.05, 0.7, 0xf7f4ee),
    box(-2.7, 0.26, 1.55, 0.18, 0.05, 0.7, 0xf7f4ee),
    box(-2.7, 0.26, 1.15, 0.55, 0.05, 0.16, 0xf7f4ee),
    box(-2.7, 0.26, 1.95, 0.55, 0.05, 0.16, 0xf7f4ee),
    box(2.35, 0.2, -3.35, 4.4, 0.16, 2.4, 0xb8bec4),
    box(-2.35, 1.7, 3.05, 4.6, 3.0, 2.9, 0xf4efe6),
    box(-2.35, 1.85, 4.52, 4.0, 2.05, 0.1, WIN),
    box(-2.35, 3.35, 3.05, 4.9, 0.22, 3.15, 0xd8c49a),
    box(-2.35, 1.15, 4.48, 1.4, 1.75, 0.12, 0x6a4a32),
    box(2.85, 3.15, 3.15, 1.45, 5.8, 1.45, 0xf7f2e8),
    box(2.85, 6.2, 3.15, 2.25, 0.95, 2.25, 0xe2b15a),
    box(2.85, 6.25, 4.28, 1.45, 0.6, 0.1, WIN),
    box(2.85, 3.7, 3.9, 1.0, 0.75, 0.08, WIN),
    { shape: "cyl", x: 2.85, y: 8.15, z: 3.15, sx: 0.08, sy: 2.5, sz: 0.08, color: 0xe23b32 },
    { shape: "cyl", x: 2.85, y: 9.4, z: 3.15, sx: 0.2, sy: 0.2, sz: 0.2, color: 0xf7f4ee },
    box(3.55, 0.55, -3.2, 2.2, 0.7, 2.0, 0xf4efe4),
  ];
}

export function buildCraneGeometry(): THREE.BufferGeometry {
  return compose([
    box(0, 0.12, 0, 0.5, 0.2, 4.2, 0xf5a318),
    box(1.85, -0.55, 0, 0.14, 1.6, 0.14, 0xf0b43c),
    box(1.85, -1.35, 0, 0.95, 0.55, 0.95, 0xe23b32),
  ]);
}

export function buildWakeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    0.05, 0.03, 0.2, 0.55, 0.03, -2.8, 0.18, 0.03, -6.4,
    0.05, 0.03, 0.2, 0.18, 0.03, -6.4, 0.02, 0.03, -2.2,
    -0.05, 0.03, 0.2, -0.55, 0.03, -2.8, -0.18, 0.03, -6.4,
    -0.05, 0.03, 0.2, -0.18, 0.03, -6.4, -0.02, 0.03, -2.2,
  ]);
  const normals = new Float32Array(12 * 3);
  for (let i = 0; i < 12; i += 1) normals.set([0, 1, 0], i * 3);
  const colors = new Float32Array([
    1, 1, 1, 0.9, 0.95, 1, 0.45, 0.7, 0.8,
    1, 1, 1, 0.45, 0.7, 0.8, 0.85, 0.92, 1,
    1, 1, 1, 0.9, 0.95, 1, 0.45, 0.7, 0.8,
    1, 1, 1, 0.45, 0.7, 0.8, 0.85, 0.92, 1,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

export function buildFoamGeometry(): THREE.BufferGeometry {
  return compose([{ shape: "sphere", x: 0, y: 0.03, z: 0, sx: 0.9, sy: 0.07, sz: 0.35, color: 0xf4f7fb }]);
}

export function buildGrassTuftGeometry(): THREE.BufferGeometry {
  return compose([
    { shape: "cone", x: 0, y: 0.18, z: 0, sx: 0.16, sy: 0.36, sz: 0.16, color: 0x6eaa4a },
    { shape: "cone", x: 0.08, y: 0.14, z: 0.04, sx: 0.12, sy: 0.28, sz: 0.12, color: 0x7eb85a },
  ]);
}

export function buildBoatGeometry(kind: "cargo" | "fish" | "ferry"): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry;
  if (kind === "fish") {
    geo = compose([
      box(-0.15, 0.22, 0, 1.55, 0.32, 0.72, 0xd8c8a8),
      { shape: "cone", x: 0.85, y: 0.22, z: 0, sx: 0.34, sy: 0.7, sz: 0.34, color: 0xc9b896, rz: -Math.PI / 2 },
      box(-0.55, 0.52, 0, 0.75, 0.48, 0.58, 0xc44732),
      { shape: "cyl", x: 0.05, y: 1.05, z: 0, sx: 0.045, sy: 1.35, sz: 0.045, color: 0xe7dcc4 },
      box(0.05, 1.35, 0.28, 0.04, 0.7, 0.55, 0x6a7c86, { rx: 0.55 }),
      box(0.05, 1.35, -0.28, 0.04, 0.7, 0.55, 0x6a7c86, { rx: -0.55 }),
      { shape: "cyl", x: -0.55, y: 0.95, z: 0, sx: 0.06, sy: 0.45, sz: 0.06, color: 0x4e555c },
    ]);
  } else if (kind === "ferry") {
    geo = compose([
      box(-0.15, 0.28, 0, 2.9, 0.38, 1.15, 0xf4efe4),
      { shape: "cone", x: 1.45, y: 0.28, z: 0, sx: 0.52, sy: 0.85, sz: 0.52, color: 0xf4efe4, rz: -Math.PI / 2 },
      box(0, 0.62, 0, 2.6, 0.18, 1.05, 0xf7f8f8),
      box(-0.2, 1.05, 0, 2.15, 0.72, 0.92, 0x3d88b5),
      box(-0.2, 1.38, 0.48, 1.55, 0.38, 0.08, WIN),
      box(-0.95, 1.72, 0, 0.9, 0.55, 0.7, 0xf4efe4),
      box(-0.95, 1.9, 0.38, 0.55, 0.28, 0.06, WIN),
      { shape: "cyl", x: 0.55, y: 1.85, z: 0, sx: 0.07, sy: 1.05, sz: 0.07, color: 0xc44732 },
      box(0.9, 0.55, 0, 0.55, 0.22, 0.7, 0xe2b15a),
    ]);
  } else {
    geo = compose([
      box(-0.25, 0.42, 0, 5.4, 0.7, 1.85, 0x5c6772),
      { shape: "cone", x: 2.7, y: 0.42, z: 0, sx: 0.92, sy: 1.35, sz: 0.92, color: 0x4e5964, rz: -Math.PI / 2 },
      box(-0.45, 0.92, 0, 4.4, 0.42, 1.65, 0xd2b07a),
      box(-1.85, 1.55, 0, 1.7, 0.88, 1.25, 0x3e4a52),
      box(-1.85, 1.78, 0.64, 1.05, 0.38, 0.08, WIN),
      { shape: "cyl", x: -1.85, y: 2.55, z: 0, sx: 0.16, sy: 1.35, sz: 0.16, color: 0xd8dde2 },
      box(0.35, 1.28, 0.48, 1.45, 0.48, 0.85, 0xe23b32),
      box(0.35, 1.28, -0.48, 1.45, 0.48, 0.85, 0x2f6fbe),
      box(1.7, 1.28, 0, 1.15, 0.48, 0.85, 0xf0c12e),
      box(0.35, 1.76, 0, 1.15, 0.48, 0.85, 0x2f9a55),
    ]);
  }
  geo.rotateY(Math.PI / 2);
  return geo;
}

const SKIN = 0xf3c7a4;
const SHOE = 0x1c1916;
const HAIR = 0x3b2a20;
const EYE = 0x1a1614;
const CLOTH = 0xffffff;

function personArm(x: number, y: number, z: number, swing: number): Part[] {
  return [{ shape: "cyl", x, y, z, sx: 0.09, sy: 0.52, sz: 0.09, color: CLOTH, rx: swing }];
}

function personLeg(x: number, y: number, z: number, stride: number): Part[] {
  return [
    { shape: "cyl", x, y, z, sx: 0.11, sy: 0.58, sz: 0.11, color: CLOTH, rx: stride },
    box(x, 0.07, z + stride * 0.18, 0.18, 0.09, 0.28, SHOE),
  ];
}

function personTorso(y: number, z = 0): Part[] {
  return [
    { shape: "sphere", x: 0, y: y + 0.12, z, sx: 0.28, sy: 0.22, sz: 0.24, color: CLOTH },
    box(0, y - 0.02, z, 0.46, 0.52, 0.3, CLOTH),
  ];
}

function personBody(pose: PersonPose): Part[] {
  if (pose === "low") {
    return [
      { shape: "cyl", x: 0, y: 0.55, z: 0, sx: 0.2, sy: 0.95, sz: 0.2, color: CLOTH },
      { shape: "sphere", x: 0, y: 1.12, z: 0, sx: 0.26, sy: 0.26, sz: 0.26, color: CLOTH },
    ];
  }
  if (pose === "swim") {
    return [
      box(0, 0.16, 0, 0.42, 0.22, 0.7, CLOTH),
      { shape: "cyl", x: 0.22, y: 0.18, z: 0.12, sx: 0.08, sy: 0.46, sz: 0.08, color: CLOTH, rz: 1.1 },
      { shape: "cyl", x: -0.22, y: 0.18, z: -0.08, sx: 0.08, sy: 0.46, sz: 0.08, color: CLOTH, rz: -1.1 },
      { shape: "cyl", x: 0.12, y: 0.12, z: -0.48, sx: 0.09, sy: 0.5, sz: 0.09, color: CLOTH, rx: Math.PI / 2 },
      { shape: "cyl", x: -0.12, y: 0.12, z: -0.48, sx: 0.09, sy: 0.5, sz: 0.09, color: CLOTH, rx: Math.PI / 2 },
    ];
  }
  if (pose === "lie") {
    return [
      { shape: "sphere", x: 0, y: 0.26, z: 0.14, sx: 0.32, sy: 0.22, sz: 0.28, color: CLOTH },
      box(0, 0.24, -0.12, 0.48, 0.2, 0.58, CLOTH),
      { shape: "cyl", x: 0.14, y: 0.18, z: -0.52, sx: 0.1, sy: 0.5, sz: 0.1, color: CLOTH, rx: Math.PI / 2 },
      { shape: "cyl", x: -0.14, y: 0.18, z: -0.52, sx: 0.1, sy: 0.5, sz: 0.1, color: CLOTH, rx: Math.PI / 2 },
      box(0.14, 0.1, -0.78, 0.16, 0.08, 0.2, SHOE),
      box(-0.14, 0.1, -0.78, 0.16, 0.08, 0.2, SHOE),
      { shape: "cyl", x: 0.34, y: 0.26, z: 0.06, sx: 0.08, sy: 0.42, sz: 0.08, color: CLOTH, rz: Math.PI / 2 },
      { shape: "cyl", x: -0.34, y: 0.26, z: 0.06, sx: 0.08, sy: 0.42, sz: 0.08, color: CLOTH, rz: -Math.PI / 2 },
    ];
  }
  if (pose === "sit") {
    return [
      ...personTorso(0.58, 0),
      { shape: "cyl", x: 0.13, y: 0.26, z: 0.3, sx: 0.1, sy: 0.44, sz: 0.1, color: CLOTH, rx: Math.PI / 2 },
      { shape: "cyl", x: -0.13, y: 0.26, z: 0.3, sx: 0.1, sy: 0.44, sz: 0.1, color: CLOTH, rx: Math.PI / 2 },
      box(0.13, 0.09, 0.54, 0.16, 0.08, 0.2, SHOE),
      box(-0.13, 0.09, 0.54, 0.16, 0.08, 0.2, SHOE),
      { shape: "cyl", x: 0.28, y: 0.72, z: 0.04, sx: 0.08, sy: 0.42, sz: 0.08, color: CLOTH, rx: 0.55 },
      { shape: "cyl", x: -0.28, y: 0.72, z: 0.04, sx: 0.08, sy: 0.42, sz: 0.08, color: CLOTH, rx: 0.55 },
    ];
  }
  const left = pose === "walkL" ? 0.95 : pose === "walkR" ? -0.95 : 0.05;
  const right = -left;
  return [
    ...personTorso(0.92),
    ...personLeg(0.12, 0.42, 0, left),
    ...personLeg(-0.12, 0.42, 0, right),
    ...personArm(0.28, 1.12, 0, right * 0.78),
    ...personArm(-0.28, 1.12, 0, left * 0.78),
  ];
}

function personFace(y: number, z: number, hair = true): Part[] {
  return [
    { shape: "sphere", x: 0, y, z, sx: 0.26, sy: 0.28, sz: 0.26, color: SKIN },
    ...(hair
      ? [
          { shape: "sphere" as const, x: 0, y: y + 0.1, z: z - 0.04, sx: 0.28, sy: 0.18, sz: 0.28, color: HAIR },
          { shape: "sphere" as const, x: 0.16, y: y + 0.02, z: z - 0.08, sx: 0.1, sy: 0.14, sz: 0.12, color: HAIR },
        ]
      : []),
    { shape: "sphere", x: -0.07, y: y + 0.02, z: z + 0.22, sx: 0.04, sy: 0.045, sz: 0.035, color: EYE },
    { shape: "sphere", x: 0.07, y: y + 0.02, z: z + 0.22, sx: 0.04, sy: 0.045, sz: 0.035, color: EYE },
  ];
}

function personHead(pose: PersonPose): Part[] {
  if (pose === "low") return [];
  if (pose === "lie") return personFace(0.3, 0.5);
  if (pose === "swim") return personFace(0.22, 0.42);
  return personFace(pose === "sit" ? 1.05 : 1.42, 0.04);
}

export type PersonPose = "idle" | "walkL" | "walkR" | "sit" | "lie" | "low" | "swim";

export function buildPersonModels(): { key: PersonPose; body: THREE.BufferGeometry; head: THREE.BufferGeometry }[] {
  return (["idle", "walkL", "walkR", "sit", "lie", "low", "swim"] as const).map((key) => ({
    key,
    body: compose(personBody(key)),
    head: compose(personHead(key).length ? personHead(key) : [{ shape: "sphere", x: 0, y: 1.22, z: 0, sx: 0.01, sy: 0.01, sz: 0.01, color: SKIN }]),
  }));
}

export function buildTowelGeometry(): THREE.BufferGeometry {
  return compose([box(0, 0.03, 0, 1.15, 0.05, 1.85, 0xffffff)]);
}

export function buildUmbrellaGeometry(): THREE.BufferGeometry {
  const stripes: Part[] = [
    { shape: "cyl", x: 0, y: 0.95, z: 0, sx: 0.045, sy: 1.9, sz: 0.045, color: 0xe7dcc4 },
  ];
  const palette = [0xf4efe4, 0xe23b32, 0xf4efe4, 0x2f6fbe, 0xf4efe4, 0xf0c12e, 0xf4efe4, 0xe23b32];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    stripes.push(box(Math.sin(a) * 0.55, 1.88, Math.cos(a) * 0.55, 0.72, 0.1, 1.05, palette[i]!, { ry: a, rx: 0.42 }));
  }
  stripes.push({ shape: "cone", x: 0, y: 2.08, z: 0, sx: 0.22, sy: 0.22, sz: 0.22, color: 0xf4efe4 });
  return compose(stripes);
}

export function buildPlaneGeometry(): THREE.BufferGeometry {
  return compose([
    box(0, 0.32, 0, 5.4, 0.55, 1.05, 0xf7f2e8),
    { shape: "cone", x: 2.75, y: 0.34, z: 0, sx: 0.42, sy: 1.05, sz: 0.42, color: 0xf7f2e8, rz: -Math.PI / 2 },
    box(0.15, 0.38, 0, 1.45, 0.12, 6.4, 0xe7c36a),
    box(-2.15, 0.92, 0, 0.75, 1.05, 0.12, 0xe23b32),
    box(2.05, 0.62, 0, 0.95, 0.38, 0.75, 0x6e7c86),
    box(2.2, 0.82, 0, 0.16, 0.7, 1.55, 0xf7f2e8),
    { shape: "cyl", x: 0.35, y: 0.72, z: 0, sx: 0.32, sy: 0.42, sz: 0.32, color: WIN },
    box(-0.55, 0.14, 1.7, 0.75, 0.2, 0.22, 0x6e7c86),
    box(-0.55, 0.14, -1.7, 0.75, 0.2, 0.22, 0x6e7c86),
    box(-2.45, 0.22, 0, 0.7, 0.16, 1.55, 0xe23b32),
  ]);
}

export type CarKind = "sedan" | "hatch" | "wagon" | "van";

const CAR_BODY = 0xffffff;
const CAR_GLASS = 0x1c2733;
const CAR_TIRE = 0x151515;
const CAR_RIM = 0xc4cad0;
const CAR_LIGHT_F = 0xfff0c4;
const CAR_LIGHT_R = 0xd4543c;
const CAR_TRIM = 0x2c3036;
const CAR_BUMPER = 0xd8dde2;

function carWheel(x: number, y: number, z: number): Part[] {
  return [
    { shape: "cyl", x, y, z, sx: 0.34, sy: 0.24, sz: 0.34, color: CAR_TIRE, rz: Math.PI / 2 },
    { shape: "cyl", x, y, z, sx: 0.18, sy: 0.26, sz: 0.18, color: CAR_RIM, rz: Math.PI / 2 },
  ];
}

function carWheels(track: number, zFront: number, zRear: number, y = 0.34): Part[] {
  return [
    ...carWheel(-track, y, zFront),
    ...carWheel(track, y, zFront),
    ...carWheel(-track, y, zRear),
    ...carWheel(track, y, zRear),
  ];
}

function carLights(zFront: number, zRear: number, width: number, y = 0.48): Part[] {
  const half = width * 0.36;
  return [
    box(-half, y, zFront, 0.28, 0.16, 0.12, CAR_LIGHT_F),
    box(half, y, zFront, 0.28, 0.16, 0.12, CAR_LIGHT_F),
    box(-half, y, zRear, 0.24, 0.14, 0.1, CAR_LIGHT_R),
    box(half, y, zRear, 0.24, 0.14, 0.1, CAR_LIGHT_R),
  ];
}

/** White body parts take the instance tint; glass/tires stay dark. */
export function buildCarModels(): BuiltModel[] {
  return [
    { key: "sedan", height: 1.45, geometry: compose(sedanParts()) },
    { key: "hatch", height: 1.4, geometry: compose(hatchParts()) },
    { key: "wagon", height: 1.55, geometry: compose(wagonParts()) },
    { key: "van", height: 1.95, geometry: compose(vanParts()) },
  ];
}

function sedanParts(): Part[] {
  return [
    box(0, 0.42, 0, 1.85, 0.42, 4.15, CAR_BODY),
    box(0, 0.78, -0.15, 1.7, 0.38, 2.15, CAR_BODY),
    box(0, 0.95, -0.15, 1.55, 0.08, 1.9, CAR_TRIM),
    box(0, 0.82, 0.95, 1.52, 0.42, 0.08, CAR_GLASS),
    box(0, 0.82, -1.2, 1.52, 0.42, 0.08, CAR_GLASS),
    box(-0.82, 0.8, -0.15, 0.08, 0.36, 1.7, CAR_GLASS),
    box(0.82, 0.8, -0.15, 0.08, 0.36, 1.7, CAR_GLASS),
    box(0, 0.28, 2.05, 1.9, 0.22, 0.28, CAR_BUMPER),
    box(0, 0.28, -2.05, 1.9, 0.22, 0.28, CAR_BUMPER),
    box(0, 0.55, 1.55, 1.65, 0.12, 0.55, CAR_TRIM),
    ...carLights(2.12, -2.12, 1.85),
    ...carWheels(0.82, 1.25, -1.3),
  ];
}

function hatchParts(): Part[] {
  return [
    box(0, 0.4, 0.05, 1.7, 0.4, 3.5, CAR_BODY),
    box(0, 0.78, -0.05, 1.55, 0.42, 2.0, CAR_BODY),
    box(0, 0.88, -0.85, 1.45, 0.28, 0.7, CAR_BODY),
    box(0, 0.82, 0.9, 1.4, 0.4, 0.08, CAR_GLASS),
    box(0, 0.82, -1.15, 1.4, 0.38, 0.08, CAR_GLASS),
    box(-0.74, 0.78, -0.05, 0.08, 0.34, 1.55, CAR_GLASS),
    box(0.74, 0.78, -0.05, 0.08, 0.34, 1.55, CAR_GLASS),
    box(0, 0.26, 1.75, 1.75, 0.2, 0.24, CAR_BUMPER),
    box(0, 0.26, -1.7, 1.75, 0.2, 0.24, CAR_BUMPER),
    ...carLights(1.82, -1.78, 1.7, 0.46),
    ...carWheels(0.74, 1.05, -1.1),
  ];
}

function wagonParts(): Part[] {
  return [
    box(0, 0.42, 0, 1.9, 0.42, 4.45, CAR_BODY),
    box(0, 0.82, -0.35, 1.72, 0.48, 2.85, CAR_BODY),
    box(0, 1.02, -0.35, 1.55, 0.08, 2.6, CAR_TRIM),
    box(0, 0.84, 1.05, 1.55, 0.42, 0.08, CAR_GLASS),
    box(0, 0.84, -1.75, 1.55, 0.42, 0.08, CAR_GLASS),
    box(-0.84, 0.82, -0.35, 0.08, 0.38, 2.4, CAR_GLASS),
    box(0.84, 0.82, -0.35, 0.08, 0.38, 2.4, CAR_GLASS),
    box(0, 0.28, 2.2, 1.95, 0.22, 0.28, CAR_BUMPER),
    box(0, 0.28, -2.2, 1.95, 0.22, 0.28, CAR_BUMPER),
    box(0, 0.55, 1.65, 1.7, 0.12, 0.55, CAR_TRIM),
    ...carLights(2.28, -2.28, 1.9),
    ...carWheels(0.84, 1.35, -1.45),
  ];
}

function vanParts(): Part[] {
  return [
    box(0, 0.55, -0.15, 1.95, 0.95, 4.5, CAR_BODY),
    box(0, 0.95, 1.55, 1.85, 0.55, 1.15, CAR_BODY),
    box(0, 0.95, 2.05, 1.7, 0.48, 0.08, CAR_GLASS),
    box(-0.9, 0.95, 1.55, 0.08, 0.42, 0.9, CAR_GLASS),
    box(0.9, 0.95, 1.55, 0.08, 0.42, 0.9, CAR_GLASS),
    box(-0.9, 0.95, -0.4, 0.08, 0.55, 1.4, CAR_GLASS),
    box(0.9, 0.95, -0.4, 0.08, 0.55, 1.4, CAR_GLASS),
    box(0, 0.95, -2.3, 1.7, 0.7, 0.08, CAR_GLASS),
    box(0, 0.32, 2.2, 2.0, 0.24, 0.3, CAR_BUMPER),
    box(0, 0.32, -2.35, 2.0, 0.24, 0.3, CAR_BUMPER),
    box(0, 1.45, -0.2, 1.8, 0.08, 3.8, CAR_TRIM),
    ...carLights(2.28, -2.4, 1.95, 0.55),
    ...carWheels(0.88, 1.4, -1.5, 0.36),
  ];
}
