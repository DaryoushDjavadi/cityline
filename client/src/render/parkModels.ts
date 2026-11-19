/**
 * Low-poly models for the Tierpark level: stands, benches, bins, toilets, trees, flower beds and the
 * entrance gate. One tile is 2 × 2 world units; every model faces +z (toward its path).
 */
import * as THREE from "three";
import type { ParkObject } from "../../../shared/src/index.ts";
import { acacia, ballPart as ball, box, compose, conifer, cylPart as cyl, pitch, type Part } from "./models.ts";

const WOOD = 0x8a5a34;
const WOOD_LIGHT = 0xb07c4c;
const CREAM = 0xf4ead2;

/** Striped awning along x at height y, front edge at z. */
function awning(width: number, y: number, z: number, a: number, b: number, depth = 0.7): Part[] {
  const parts: Part[] = [];
  const n = 6;
  for (let i = 0; i < n; i += 1) {
    parts.push(box(-width / 2 + (i + 0.5) * (width / n), y, z, width / n + 0.005, 0.07, depth, i % 2 ? b : a, { rx: 0.32 }));
  }
  // scalloped edge
  for (let i = 0; i < n; i += 1) parts.push(ball(-width / 2 + (i + 0.5) * (width / n), y - 0.16, z + depth / 2 - 0.02, width / n / 2.1, i % 2 ? b : a, 0.1));
  return parts;
}

function foodStand(): Part[] {
  return [
    box(0, 0.08, 0, 1.8, 0.16, 1.6, 0xcfc4ae),
    box(0, 0.62, -0.15, 1.5, 0.95, 1.05, 0xf2b84a),
    box(0, 1.14, 0.42, 1.6, 0.1, 0.36, CREAM),
    box(0, 1.5, -0.15, 1.36, 0.6, 0.06, 0x3a2a20),
    box(-0.55, 1.45, -0.32, 0.08, 1.0, 0.08, WOOD),
    box(0.55, 1.45, -0.32, 0.08, 1.0, 0.08, WOOD),
    box(0, 2.0, -0.15, 1.6, 0.12, 1.2, CREAM),
    ...awning(1.7, 1.86, 0.5, 0xe24a32, 0xfdf6ea),
    // sign: a giant ice cream on the roof
    { shape: "cone", x: 0, y: 2.45, z: -0.15, sx: 0.2, sy: 0.55, sz: 0.2, color: 0xd9a050, rx: Math.PI },
    ball(0, 2.82, -0.15, 0.26, 0xf6a0c0),
    ball(0.05, 3.05, -0.12, 0.17, 0xfdf3e4),
    // fries cups on the counter
    box(-0.45, 1.27, 0.44, 0.14, 0.18, 0.14, 0xe24a32),
    box(-0.45, 1.39, 0.44, 0.1, 0.08, 0.1, 0xf6d050),
    box(0.4, 1.27, 0.44, 0.2, 0.14, 0.14, 0xfdf6ea),
  ];
}

function drinkStand(): Part[] {
  return [
    box(0, 0.08, 0, 1.8, 0.16, 1.6, 0xcfc4ae),
    cyl(0, 0.62, -0.1, 0.72, 0.95, 0x4a9ad0),
    box(0, 1.12, 0.35, 1.3, 0.09, 0.42, CREAM),
    cyl(0, 1.7, -0.1, 0.06, 1.6, 0xdcdcdc),
    { shape: "cone", x: 0, y: 2.55, z: -0.1, sx: 1.05, sy: 0.5, sz: 1.05, color: 0xfdf6ea },
    { shape: "cone", x: 0, y: 2.56, z: -0.1, sx: 0.98, sy: 0.46, sz: 0.98, color: 0x4ab0c8, ry: Math.PI / 6 },
    // giant cup sign with straw
    cyl(0.6, 1.5, -0.6, 0.18, 0.45, 0xf2efe8),
    cyl(0.6, 1.76, -0.6, 0.19, 0.06, 0x4ab0c8),
    cyl(0.66, 1.98, -0.6, 0.025, 0.4, 0xe24a32, { rz: -0.3 }),
    box(-0.35, 1.24, 0.38, 0.12, 0.16, 0.12, 0xf28a3c),
    box(0.3, 1.24, 0.38, 0.12, 0.16, 0.12, 0x6cc070),
  ];
}

function souvenirShop(): Part[] {
  return [
    box(0, 0.08, 0, 1.9, 0.16, 1.8, 0xcfc4ae),
    box(0, 0.75, -0.2, 1.6, 1.2, 1.2, 0xf0dcc0),
    box(0, 0.75, 0.41, 0.5, 0.95, 0.05, 0x7a4c2c),
    box(-0.55, 0.9, 0.41, 0.4, 0.45, 0.05, 0x8ec8ea),
    box(0.55, 0.9, 0.41, 0.4, 0.45, 0.05, 0x8ec8ea),
    ...pitch(0x4f8e3c, { x: 0, z: -0.2, width: 1.9, half: 0.62, wallTop: 1.35, eave: 0.18, angle: 0.6 }),
    // plush toys in front
    box(0, 0.32, 0.7, 1.4, 0.32, 0.36, WOOD_LIGHT),
    ball(-0.45, 0.62, 0.7, 0.16, 0xd9a050),
    ball(-0.45, 0.82, 0.7, 0.11, 0xd9a050),
    ball(-0.05, 0.6, 0.72, 0.15, 0x2a2e36),
    ball(-0.05, 0.6, 0.82, 0.09, 0xf2efe8),
    ball(0.38, 0.62, 0.7, 0.16, 0xb8502a),
    ball(0.38, 0.82, 0.7, 0.11, 0xb8502a),
    // balloons
    cyl(0.85, 1.4, 0.6, 0.012, 1.4, 0xffffff),
    ball(0.85, 2.15, 0.6, 0.18, 0xe24a32, 0.22),
    ball(1.0, 2.0, 0.5, 0.16, 0xf0b43c, 0.2),
  ];
}

function bench(): Part[] {
  return [
    box(0, 0.42, 0.25, 1.5, 0.07, 0.42, WOOD_LIGHT),
    box(0, 0.72, 0.02, 1.5, 0.3, 0.06, WOOD_LIGHT, { rx: -0.15 }),
    box(-0.62, 0.21, 0.25, 0.07, 0.42, 0.38, 0x3a3a3a),
    box(0.62, 0.21, 0.25, 0.07, 0.42, 0.38, 0x3a3a3a),
    box(-0.62, 0.55, 0.05, 0.07, 0.5, 0.07, 0x3a3a3a),
    box(0.62, 0.55, 0.05, 0.07, 0.5, 0.07, 0x3a3a3a),
    // a little shrub behind
    ball(-0.5, 0.35, -0.55, 0.42, 0x5f9a48, 0.35),
    ball(0.45, 0.32, -0.6, 0.36, 0x6aa850, 0.3),
  ];
}

function bin(): Part[] {
  return [
    cyl(0, 0.42, 0.2, 0.26, 0.84, 0x3d7a4a),
    cyl(0, 0.86, 0.2, 0.29, 0.06, 0x2e5e38),
    box(0, 0.5, 0.47, 0.2, 0.2, 0.02, 0xf4ead2),
    ball(0.55, 0.28, -0.3, 0.3, 0x6aa850, 0.26),
  ];
}

function toilet(): Part[] {
  return [
    box(0, 0.08, 0, 1.9, 0.16, 1.8, 0xcfc4ae),
    box(0, 0.8, -0.15, 1.7, 1.3, 1.3, 0xe8eef2),
    box(-0.42, 0.68, 0.51, 0.5, 1.0, 0.05, 0x4a7ac8),
    box(0.42, 0.68, 0.51, 0.5, 1.0, 0.05, 0xd05a7a),
    ball(-0.42, 1.38, 0.53, 0.09, 0xffffff),
    ball(0.42, 1.38, 0.53, 0.09, 0xffffff),
    ...pitch(0x5a6a7a, { x: 0, z: -0.15, width: 1.95, half: 0.66, wallTop: 1.45, eave: 0.16, angle: 0.5 }),
    ball(-0.95, 0.35, -0.6, 0.35, 0x6aa850, 0.3),
  ];
}

function tree(): Part[] {
  return [
    cyl(0, 0.8, 0, 0.16, 1.6, 0x6e5238),
    ball(0, 2.1, 0, 0.95, 0x6aa04c, 0.85),
    ball(0.5, 1.8, 0.25, 0.65, 0x7aae56, 0.6),
    ball(-0.45, 1.85, -0.2, 0.7, 0x5f9444, 0.62),
    ball(0.1, 2.65, -0.1, 0.55, 0x82b65c, 0.5),
  ];
}

function flowers(): Part[] {
  const parts: Part[] = [box(0, 0.1, 0, 1.6, 0.2, 1.6, 0x7a5a3c), box(0, 0.06, 0, 1.75, 0.12, 1.75, 0xb8aa94)];
  const tones = [0xf4d04a, 0xf28aa8, 0xffffff, 0xb59ae4, 0xe24a32, 0xf2a03c];
  for (let i = 0; i < 16; i += 1) {
    const x = -0.6 + (i % 4) * 0.4 + ((i * 7) % 3) * 0.04;
    const z = -0.6 + Math.floor(i / 4) * 0.4 + ((i * 5) % 3) * 0.04;
    parts.push(cyl(x, 0.3, z, 0.02, 0.2, 0x4f8e3c), ball(x, 0.42, z, 0.12, tones[i % tones.length], 0.08));
  }
  return parts;
}

/** Entrance gate on the park edge: arch with sign, ticket booth, flags. Path runs along z. */
function gate(): Part[] {
  return [
    box(0, 0.05, 0, 2.0, 0.1, 2.0, 0xdcc49a),
    cyl(-1.1, 1.6, 0, 0.24, 3.2, WOOD),
    cyl(1.1, 1.6, 0, 0.24, 3.2, WOOD),
    box(0, 3.1, 0, 2.9, 0.32, 0.4, 0x7a4c2c),
    box(0, 3.7, 0.05, 2.5, 0.8, 0.12, CREAM),
    box(0, 3.7, 0.12, 2.1, 0.5, 0.04, 0x4f8e3c),
    ball(0, 3.7, 0.16, 0.22, 0xe0a040),
    ball(-0.17, 3.9, 0.16, 0.08, 0xe0a040),
    ball(0.17, 3.9, 0.16, 0.08, 0xe0a040),
    box(0, 4.2, 0, 3.0, 0.14, 0.7, 0x4f7e3c),
    cyl(-1.1, 4.6, 0, 0.04, 0.8, 0x5a4030),
    box(-0.86, 4.85, 0, 0.45, 0.28, 0.03, 0xe24a32),
    cyl(1.1, 4.6, 0, 0.04, 0.8, 0x5a4030),
    box(1.34, 4.85, 0, 0.45, 0.28, 0.03, 0xf0b43c),
    // turnstiles
    box(-0.45, 0.45, 0, 0.12, 0.8, 0.6, 0x9aa0a6),
    box(0.45, 0.45, 0, 0.12, 0.8, 0.6, 0x9aa0a6),
  ];
}

/** Ticket booth placed next to the gate (outside the park, on the left). */
export function boothGeometry(): THREE.BufferGeometry {
  return compose([
    box(0, 0.85, 0, 1.4, 1.5, 1.2, 0xf2e6cc),
    box(0, 0.95, 0.61, 0.8, 0.5, 0.04, 0x8ec8ea),
    box(0, 0.62, 0.7, 0.9, 0.08, 0.25, WOOD),
    ...pitch(0xc0503a, { x: 0, z: 0, width: 1.7, half: 0.66, wallTop: 1.6, eave: 0.15, angle: 0.55 }),
  ]);
}

const BUILDERS: Record<Exclude<ParkObject, "path">, () => Part[]> = {
  food: foodStand,
  drink: drinkStand,
  souvenir: souvenirShop,
  bench,
  bin,
  toilet,
  tree,
  flowers,
  entrance: gate,
};

const cache = new Map<string, THREE.BufferGeometry>();

export function parkObjectGeometry(kind: Exclude<ParkObject, "path">): THREE.BufferGeometry {
  let geometry = cache.get(kind);
  if (!geometry) {
    geometry = compose(BUILDERS[kind]());
    cache.set(kind, geometry);
  }
  return geometry;
}

/** Trees outside the park fence (conifers and acacias for variety). */
export function outerTreeGeometry(kind: number): THREE.BufferGeometry {
  const key = `outer${kind}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = compose(kind === 0 ? conifer(0, 0, 1.4) : kind === 1 ? tree() : acacia(0, 0, 1.2));
    cache.set(key, geometry);
  }
  return geometry;
}

/** Hedge + wooden fence segment along x, length 2 (one tile). */
export function borderGeometry(): THREE.BufferGeometry {
  let geometry = cache.get("border");
  if (!geometry) {
    geometry = compose([
      ball(0, 0.45, -0.35, 0.75, 0x4f8a40, 0.55),
      ball(0.8, 0.5, -0.4, 0.6, 0x5a9446, 0.6),
      ball(-0.8, 0.42, -0.3, 0.55, 0x4a8240, 0.5),
      cyl(-1, 0.55, 0.35, 0.08, 1.1, WOOD),
      box(0, 0.75, 0.35, 2.0, 0.1, 0.07, WOOD_LIGHT),
      box(0, 0.4, 0.35, 2.0, 0.1, 0.07, WOOD_LIGHT),
    ]);
    cache.set("border", geometry);
  }
  return geometry;
}
