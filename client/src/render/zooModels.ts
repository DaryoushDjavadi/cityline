/**
 * Low-poly zoo animals and habitat items (vertex colors, merged per species).
 * Animals face +z, stand on y = 0, adult size in world units (a person is ~1.7).
 * The "pattern" geometry is an overlay (stripes/spots/patches) drawn slightly outside the body;
 * its color is blended toward the accent by the pattern gene, so pattern 0 is invisible.
 */
import * as THREE from "three";
import { box, compose, type Part } from "./models.ts";

const EYE = 0x1c1a18;
const NOSE = 0x2e2622;
const ball = (x: number, y: number, z: number, rx: number, ry: number, rz: number, color: number): Part => ({ shape: "sphere", x, y, z, sx: rx, sy: ry, sz: rz, color });
const cyl = (x: number, y: number, z: number, r: number, h: number, color: number, rot?: Partial<Pick<Part, "rx" | "ry" | "rz">>): Part => ({ shape: "cyl", x, y, z, sx: r, sy: h, sz: r, color, ...rot });
const cone = (x: number, y: number, z: number, r: number, h: number, color: number, rot?: Partial<Pick<Part, "rx" | "ry" | "rz">>): Part => ({ shape: "cone", x, y, z, sx: r, sy: h, sz: r, color, ...rot });

function legs(halfW: number, halfL: number, height: number, r: number, color: number, hoof?: number): Part[] {
  const parts: Part[] = [];
  for (const [x, z] of [[-halfW, -halfL], [halfW, -halfL], [-halfW, halfL], [halfW, halfL]]) {
    parts.push(cyl(x, height / 2, z, r, height, color));
    if (hoof !== undefined) parts.push(cyl(x, 0.05, z, r * 1.1, 0.1, hoof));
  }
  return parts;
}

function eyes(x: number, y: number, z: number, r = 0.05): Part[] {
  return [ball(-x, y, z, r, r, r, EYE), ball(x, y, z, r, r, r, EYE)];
}

export type PatternStyle = "stripes" | "spots" | "patches" | "mane";

export interface AnimalModel {
  body: Part[];
  pattern: Part[];
  style: PatternStyle;
  /** Accent color of the pattern at gene 1. */
  accent: number;
  /** Bounding box (w, h, l) for the far LOD block. */
  lod: [number, number, number];
  /** Wander speed (units/s) and hop/bob style. */
  speed: number;
  gait: "walk" | "hop" | "waddle" | "swim";
}

/** Thin shells hugging an ellipsoid body (radii rx/ry/rz at y), so stripes read as coat, not ribs. */
function stripes(rz: number, y: number, ry: number, rx: number, z0: number, color: number, count = 6): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < count; i += 1) {
    const z = z0 - rz * 0.8 + ((i + 0.5) * rz * 1.6) / count;
    const f = Math.sqrt(Math.max(0.05, 1 - ((z - z0) / rz) ** 2)) * 1.04;
    parts.push({ ...ball(0, y, z, rx * f, ry * f, (rz / count) * 0.32, color), rx: 0.2 });
  }
  return parts;
}

function spots(len: number, y: number, h: number, w: number, color: number, count = 8, r = 0.13): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < count; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -len / 2 + ((i + 0.5) * len) / count;
    const dy = ((i * 37) % 7) / 7 - 0.5;
    parts.push(ball(side * w / 2, y + dy * h * 0.6, z, r * 0.45, r, r, color));
  }
  return parts;
}

const MODELS: Record<string, () => AnimalModel> = {
  lion: () => ({
    body: [
      ...legs(0.24, 0.5, 0.55, 0.1, 0xc89a52),
      ball(0, 0.78, 0, 0.36, 0.3, 0.72, 0xc89a52),
      ball(0, 1.02, 0.72, 0.24, 0.24, 0.24, 0xd2a660),
      ball(0, 0.94, 0.94, 0.11, 0.09, 0.1, 0xe2c08a),
      ball(0, 0.96, 1.03, 0.04, 0.035, 0.03, NOSE),
      ...eyes(0.09, 1.08, 0.92),
      cyl(0, 0.78, -0.86, 0.04, 0.6, 0xb4884a, { rx: -0.9 }),
      ball(0, 0.58, -1.08, 0.07, 0.07, 0.07, 0x5a3a22),
    ],
    pattern: [ball(0, 1.04, 0.6, 0.4, 0.4, 0.32, 0xffffff)],
    style: "mane",
    accent: 0x6a3e1e,
    lod: [0.7, 1.1, 1.8],
    speed: 0.35,
    gait: "walk",
  }),
  elephant: () => ({
    body: [
      ...legs(0.42, 0.62, 1.05, 0.2, 0x8f8d8a),
      ball(0, 1.55, 0, 0.7, 0.62, 1.0, 0x8f8d8a),
      ball(0, 1.9, 0.95, 0.46, 0.46, 0.42, 0x979590),
      cyl(0, 1.25, 1.32, 0.11, 1.0, 0x8a8884, { rx: 0.25 }),
      box(-0.48, 1.85, 0.82, 0.08, 0.7, 0.55, 0x85837f, { ry: -0.4 }),
      box(0.48, 1.85, 0.82, 0.08, 0.7, 0.55, 0x85837f, { ry: 0.4 }),
      cone(-0.2, 1.42, 1.28, 0.05, 0.4, 0xf2ead8, { rx: 2.3 }),
      cone(0.2, 1.42, 1.28, 0.05, 0.4, 0xf2ead8, { rx: 2.3 }),
      ...eyes(0.27, 2.0, 1.28, 0.05),
      cyl(0, 1.4, -1.02, 0.04, 0.6, 0x7e7c78, { rx: -0.3 }),
    ],
    pattern: [ball(0, 1.9, 0, 0.6, 0.18, 0.7, 0xffffff)],
    style: "patches",
    accent: 0x6a6662,
    lod: [1.4, 2.4, 2.4],
    speed: 0.25,
    gait: "walk",
  }),
  giraffe: () => ({
    body: [
      ...legs(0.22, 0.45, 1.3, 0.08, 0xe0b060, 0x4a3828),
      ball(0, 1.55, 0, 0.36, 0.34, 0.62, 0xe0b060),
      cyl(0, 2.35, 0.5, 0.13, 1.6, 0xe0b060, { rx: 0.42 }),
      box(0, 3.15, 0.9, 0.24, 0.24, 0.5, 0xe6ba6a),
      cyl(-0.08, 3.38, 0.78, 0.03, 0.2, 0x5a4030),
      cyl(0.08, 3.38, 0.78, 0.03, 0.2, 0x5a4030),
      ...eyes(0.12, 3.22, 0.98, 0.04),
      cyl(0, 1.4, -0.66, 0.03, 0.6, 0xc8964e, { rx: -0.25 }),
    ],
    pattern: [...spots(1.2, 1.6, 0.4, 0.74, 0xffffff, 10, 0.15), ...spots(0.9, 2.3, 0.6, 0.27, 0xffffff, 6, 0.09).map((p) => ({ ...p, z: p.z * 0.4 + 0.5 }))],
    style: "spots",
    accent: 0x7a4a24,
    lod: [0.8, 3.4, 1.8],
    speed: 0.3,
    gait: "walk",
  }),
  zebra: () => ({
    body: [
      ...legs(0.2, 0.46, 0.75, 0.08, 0xeeeae2, 0x222222),
      ball(0, 1.0, 0, 0.32, 0.3, 0.62, 0xeeeae2),
      cyl(0, 1.32, 0.56, 0.12, 0.6, 0xeeeae2, { rx: 0.7 }),
      box(0, 1.5, 0.84, 0.2, 0.22, 0.46, 0xeeeae2, { rx: 0.4 }),
      box(0, 1.45, 0.48, 0.05, 0.16, 0.5, 0x2a2a2a, { rx: 0.7 }),
      ...eyes(0.1, 1.58, 0.84, 0.035),
      cyl(0, 1.0, -0.66, 0.03, 0.5, 0x2a2a2a, { rx: -0.3 }),
    ],
    pattern: [...stripes(0.62, 1.0, 0.3, 0.32, 0, 0xffffff, 7), ...legs(0.2, 0.46, 0.3, 0.085, 0xffffff).map((p) => ({ ...p, y: 0.55 }))],
    style: "stripes",
    accent: 0x1e1e22,
    lod: [0.66, 1.7, 1.5],
    speed: 0.45,
    gait: "walk",
  }),
  kangaroo: () => ({
    body: [
      box(-0.16, 0.12, 0.14, 0.12, 0.08, 0.5, 0xa06e46),
      box(0.16, 0.12, 0.14, 0.12, 0.08, 0.5, 0xa06e46),
      ball(-0.16, 0.38, -0.05, 0.13, 0.26, 0.22, 0xb07a4e),
      ball(0.16, 0.38, -0.05, 0.13, 0.26, 0.22, 0xb07a4e),
      ball(0, 0.78, 0.05, 0.26, 0.42, 0.26, 0xb07a4e),
      ball(0, 0.68, 0.22, 0.17, 0.22, 0.08, 0xd8b48a),
      ball(0, 1.22, 0.16, 0.14, 0.15, 0.2, 0xb88252),
      cone(-0.07, 1.42, 0.12, 0.05, 0.18, 0xa06e46),
      cone(0.07, 1.42, 0.12, 0.05, 0.18, 0xa06e46),
      ...eyes(0.07, 1.27, 0.3, 0.03),
      cyl(0, 0.3, -0.42, 0.07, 0.8, 0xa06e46, { rx: -1.1 }),
    ],
    pattern: [ball(0, 0.95, -0.02, 0.24, 0.24, 0.22, 0xffffff)],
    style: "patches",
    accent: 0x6e4a2e,
    lod: [0.5, 1.4, 1.0],
    speed: 0.6,
    gait: "hop",
  }),
  bear: () => ({
    body: [
      ...legs(0.3, 0.45, 0.5, 0.15, 0x6b4a32),
      ball(0, 0.85, 0, 0.48, 0.44, 0.78, 0x6b4a32),
      ball(0, 1.08, 0.78, 0.3, 0.28, 0.28, 0x704e36),
      ball(0, 1.0, 1.04, 0.13, 0.1, 0.12, 0x9a7656),
      ball(0, 1.02, 1.15, 0.05, 0.04, 0.04, NOSE),
      ball(-0.2, 1.33, 0.74, 0.08, 0.08, 0.05, 0x5a3c28),
      ball(0.2, 1.33, 0.74, 0.08, 0.08, 0.05, 0x5a3c28),
      ...eyes(0.11, 1.15, 1.0, 0.035),
    ],
    pattern: [ball(0, 1.12, 0.2, 0.42, 0.24, 0.5, 0xffffff)],
    style: "patches",
    accent: 0x3e2a1c,
    lod: [1.0, 1.4, 1.9],
    speed: 0.28,
    gait: "walk",
  }),
  monkey: () => ({
    body: [
      ...legs(0.12, 0.14, 0.3, 0.06, 0x6e5034),
      ball(0, 0.48, 0, 0.18, 0.26, 0.2, 0x7a5a3c),
      ball(0, 0.82, 0.04, 0.16, 0.16, 0.15, 0x7a5a3c),
      ball(0, 0.8, 0.15, 0.11, 0.1, 0.06, 0xe2c4a0),
      ball(-0.17, 0.85, 0.02, 0.06, 0.07, 0.03, 0xd8b48e),
      ball(0.17, 0.85, 0.02, 0.06, 0.07, 0.03, 0xd8b48e),
      ...eyes(0.05, 0.85, 0.2, 0.025),
      cyl(-0.22, 0.48, 0.06, 0.04, 0.38, 0x6e5034, { rz: 0.4 }),
      cyl(0.22, 0.48, 0.06, 0.04, 0.38, 0x6e5034, { rz: -0.4 }),
      cyl(0, 0.62, -0.32, 0.03, 0.62, 0x6e5034, { rx: 0.7 }),
    ],
    pattern: [ball(0, 0.48, 0.09, 0.13, 0.18, 0.13, 0xffffff)],
    style: "patches",
    accent: 0xd8b088,
    lod: [0.45, 1.0, 0.5],
    speed: 0.55,
    gait: "hop",
  }),
  redpanda: () => ({
    body: [
      ...legs(0.1, 0.18, 0.18, 0.05, 0x2a1e18),
      ball(0, 0.3, 0, 0.15, 0.13, 0.28, 0xb8502a),
      ball(0, 0.4, 0.3, 0.13, 0.12, 0.12, 0xc25a32),
      ball(0, 0.37, 0.4, 0.07, 0.05, 0.05, 0xf2ead8),
      cone(-0.09, 0.53, 0.28, 0.04, 0.08, 0xf2ead8),
      cone(0.09, 0.53, 0.28, 0.04, 0.08, 0xf2ead8),
      ...eyes(0.05, 0.43, 0.4, 0.02),
      cyl(0, 0.3, -0.42, 0.07, 0.4, 0xb8502a, { rx: -1.3 }),
    ],
    pattern: [cyl(0, 0.3, -0.36, 0.075, 0.07, 0xffffff, { rx: -1.3 }), cyl(0, 0.3, -0.5, 0.075, 0.07, 0xffffff, { rx: -1.3 }), ball(0, 0.44, 0.38, 0.09, 0.06, 0.05, 0xffffff)],
    style: "stripes",
    accent: 0x5a2414,
    lod: [0.35, 0.55, 0.9],
    speed: 0.4,
    gait: "walk",
  }),
  wolf: () => ({
    body: [
      ...legs(0.15, 0.36, 0.45, 0.06, 0x8a8580),
      ball(0, 0.62, 0, 0.22, 0.2, 0.5, 0x8a8580),
      ball(0, 0.78, 0.5, 0.15, 0.14, 0.15, 0x908b86),
      box(0, 0.73, 0.68, 0.12, 0.1, 0.22, 0x9a958f),
      ball(0, 0.75, 0.8, 0.03, 0.03, 0.03, NOSE),
      cone(-0.08, 0.95, 0.46, 0.05, 0.12, 0x7a7570),
      cone(0.08, 0.95, 0.46, 0.05, 0.12, 0x7a7570),
      ...eyes(0.07, 0.82, 0.62, 0.025),
      cyl(0, 0.58, -0.6, 0.06, 0.48, 0x7a7570, { rx: -0.7 }),
    ],
    pattern: [ball(0, 0.72, 0.02, 0.2, 0.12, 0.42, 0xffffff), ball(0, 0.68, 0.6, 0.1, 0.06, 0.1, 0xffffff)],
    style: "patches",
    accent: 0x3e3a38,
    lod: [0.45, 1.0, 1.3],
    speed: 0.5,
    gait: "walk",
  }),
  seal: () => ({
    body: [
      ball(0, 0.22, 0, 0.26, 0.22, 0.6, 0x7d838a),
      ball(0, 0.4, 0.5, 0.17, 0.17, 0.18, 0x868c92),
      ball(0, 0.36, 0.64, 0.08, 0.06, 0.06, 0x9aa0a6),
      ...eyes(0.08, 0.45, 0.62, 0.03),
      box(-0.24, 0.08, 0.22, 0.24, 0.04, 0.14, 0x6a7076, { ry: 0.5 }),
      box(0.24, 0.08, 0.22, 0.24, 0.04, 0.14, 0x6a7076, { ry: -0.5 }),
      box(0, 0.1, -0.62, 0.32, 0.04, 0.18, 0x6a7076),
    ],
    pattern: spots(1.0, 0.3, 0.2, 0.5, 0xffffff, 10, 0.07),
    style: "spots",
    accent: 0x3a3e44,
    lod: [0.55, 0.6, 1.3],
    speed: 0.35,
    gait: "swim",
  }),
  flamingo: () => ({
    body: [
      cyl(-0.05, 0.38, 0, 0.025, 0.76, 0xe07890),
      cyl(0.05, 0.38, 0.02, 0.025, 0.76, 0xe07890),
      ball(0, 0.88, 0, 0.17, 0.15, 0.27, 0xf08aa0),
      box(0, 0.9, -0.24, 0.24, 0.07, 0.16, 0x2a2224),
      cyl(0, 1.18, 0.16, 0.03, 0.6, 0xf08aa0, { rx: 0.25 }),
      ball(0, 1.48, 0.22, 0.06, 0.06, 0.07, 0xf499ae),
      cone(0, 1.42, 0.32, 0.03, 0.12, 0x2a2224, { rx: 2.2 }),
      ...eyes(0.04, 1.5, 0.25, 0.015),
    ],
    pattern: [ball(0, 0.94, -0.04, 0.15, 0.11, 0.2, 0xffffff)],
    style: "patches",
    accent: 0xd8406a,
    lod: [0.35, 1.5, 0.6],
    speed: 0.3,
    gait: "walk",
  }),
  otter: () => ({
    body: [
      ...legs(0.08, 0.15, 0.08, 0.04, 0x5a3e2a),
      ball(0, 0.16, 0, 0.1, 0.09, 0.26, 0x6b4c34),
      ball(0, 0.22, 0.26, 0.08, 0.075, 0.08, 0x765638),
      ball(0, 0.2, 0.32, 0.05, 0.04, 0.04, 0xcdb89c),
      ...eyes(0.035, 0.25, 0.32, 0.015),
      cone(0, 0.13, -0.36, 0.05, 0.3, 0x5a3e2a, { rx: -Math.PI / 2 }),
    ],
    pattern: [ball(0, 0.13, 0.08, 0.08, 0.06, 0.16, 0xffffff)],
    style: "patches",
    accent: 0xcdb08a,
    lod: [0.22, 0.35, 0.7],
    speed: 0.6,
    gait: "swim",
  }),
  penguin: () => ({
    body: [
      ball(0, 0.32, 0, 0.17, 0.3, 0.16, 0x2a2e36),
      ball(0, 0.3, 0.08, 0.13, 0.25, 0.1, 0xf4f2ee),
      ball(0, 0.66, 0.02, 0.11, 0.11, 0.11, 0x2a2e36),
      cone(0, 0.64, 0.14, 0.03, 0.09, 0xf0a030, { rx: Math.PI / 2 }),
      ...eyes(0.05, 0.69, 0.1, 0.018),
      box(-0.17, 0.34, 0, 0.04, 0.24, 0.1, 0x2a2e36, { rz: 0.25 }),
      box(0.17, 0.34, 0, 0.04, 0.24, 0.1, 0x2a2e36, { rz: -0.25 }),
      box(-0.06, 0.02, 0.06, 0.07, 0.03, 0.1, 0xf0a030),
      box(0.06, 0.02, 0.06, 0.07, 0.03, 0.1, 0xf0a030),
    ],
    pattern: [ball(0, 0.62, 0.06, 0.1, 0.05, 0.08, 0xffffff), ball(-0.1, 0.4, 0.08, 0.04, 0.1, 0.04, 0xffffff), ball(0.1, 0.4, 0.08, 0.04, 0.1, 0.04, 0xffffff)],
    style: "patches",
    accent: 0xf0b030,
    lod: [0.35, 0.75, 0.35],
    speed: 0.3,
    gait: "waddle",
  }),
  polarbear: () => ({
    body: [
      ...legs(0.3, 0.5, 0.5, 0.2, 0xe6e2d6),
      ball(-0.3, 0.06, 0.56, 0.18, 0.07, 0.22, 0xdcd8cc),
      ball(0.3, 0.06, 0.56, 0.18, 0.07, 0.22, 0xdcd8cc),
      ball(-0.3, 0.06, -0.44, 0.18, 0.07, 0.22, 0xdcd8cc),
      ball(0.3, 0.06, -0.44, 0.18, 0.07, 0.22, 0xdcd8cc),
      ball(0, 0.86, -0.1, 0.5, 0.48, 0.74, 0xf0eee6),
      ball(0, 0.92, 0.45, 0.44, 0.42, 0.42, 0xf2f0e8),
      cyl(0, 0.92, 0.82, 0.2, 0.36, 0xf2f0e8, { rx: 1.2 }),
      ball(0, 0.94, 1.05, 0.24, 0.22, 0.27, 0xf4f2ea),
      ball(0, 0.88, 1.3, 0.11, 0.09, 0.08, 0xe8e4d8),
      ball(0, 0.92, 1.37, 0.05, 0.04, 0.035, NOSE),
      ball(-0.16, 1.14, 0.98, 0.07, 0.07, 0.04, 0xe2ded2),
      ball(0.16, 1.14, 0.98, 0.07, 0.07, 0.04, 0xe2ded2),
      ...eyes(0.1, 1.02, 1.24, 0.03),
      ball(0, 0.78, -0.82, 0.09, 0.08, 0.08, 0xe6e2d6),
    ],
    pattern: [ball(0, 0.62, 0.1, 0.36, 0.2, 0.55, 0xffffff), ball(0, 0.86, 1.3, 0.1, 0.07, 0.06, 0xffffff)],
    style: "patches",
    accent: 0xd8cca8,
    lod: [1.0, 1.3, 2.3],
    speed: 0.28,
    gait: "walk",
  }),
  rabbit: () => ({
    body: [
      ball(0, 0.16, 0, 0.12, 0.12, 0.17, 0xd8c8b0),
      ball(0, 0.27, 0.15, 0.085, 0.08, 0.09, 0xdcccb4),
      { ...ball(-0.05, 0.4, 0.11, 0.022, 0.1, 0.035, 0xd0bea4), rx: -0.25, rz: 0.25 },
      { ...ball(0.05, 0.4, 0.11, 0.022, 0.1, 0.035, 0xd0bea4), rx: -0.25, rz: -0.25 },
      ball(0, 0.17, -0.17, 0.04, 0.04, 0.04, 0xffffff),
      ...eyes(0.05, 0.3, 0.2, 0.015),
    ],
    pattern: [ball(0, 0.2, -0.02, 0.1, 0.07, 0.12, 0xffffff), ball(0, 0.3, 0.19, 0.04, 0.05, 0.03, 0xffffff)],
    style: "patches",
    accent: 0x6e5440,
    lod: [0.22, 0.4, 0.35],
    speed: 0.5,
    gait: "hop",
  }),
  goat: () => ({
    body: [
      ...legs(0.13, 0.28, 0.42, 0.05, 0xe2dacb, 0x3a3230),
      ball(0, 0.58, 0, 0.19, 0.18, 0.36, 0xeee6d6),
      box(0, 0.78, 0.38, 0.14, 0.18, 0.24, 0xeee6d6, { rx: 0.3 }),
      cone(-0.05, 0.94, 0.32, 0.025, 0.16, 0x8a7a68, { rx: -0.5 }),
      cone(0.05, 0.94, 0.32, 0.025, 0.16, 0x8a7a68, { rx: -0.5 }),
      cone(0, 0.62, 0.48, 0.03, 0.1, 0xd8d0c0, { rx: Math.PI }),
      ...eyes(0.065, 0.82, 0.46, 0.02),
      cyl(0, 0.68, -0.38, 0.025, 0.14, 0xe2dacb, { rx: -0.6 }),
    ],
    pattern: [ball(0, 0.64, -0.06, 0.15, 0.12, 0.2, 0xffffff), ball(0, 0.8, 0.42, 0.07, 0.08, 0.08, 0xffffff)],
    style: "patches",
    accent: 0x5a4636,
    lod: [0.4, 1.0, 0.9],
    speed: 0.45,
    gait: "walk",
  }),
  alpaca: () => ({
    body: [
      ...legs(0.15, 0.3, 0.6, 0.06, 0xe8d6b6),
      ball(0, 0.85, 0, 0.26, 0.25, 0.42, 0xf2e2c4),
      cyl(0, 1.25, 0.32, 0.1, 0.7, 0xf2e2c4, { rx: 0.15 }),
      ball(0, 1.62, 0.38, 0.13, 0.14, 0.15, 0xf4e6cc),
      box(0, 1.56, 0.52, 0.09, 0.08, 0.1, 0xe8d6b6),
      cone(-0.06, 1.8, 0.36, 0.03, 0.12, 0xe8d6b6),
      cone(0.06, 1.8, 0.36, 0.03, 0.12, 0xe8d6b6),
      ...eyes(0.08, 1.66, 0.5, 0.022),
    ],
    pattern: [ball(0, 0.92, -0.1, 0.22, 0.18, 0.26, 0xffffff), cyl(0, 1.25, 0.34, 0.105, 0.3, 0xffffff, { rx: 0.15 })],
    style: "patches",
    accent: 0x8a6a4c,
    lod: [0.55, 1.85, 1.0],
    speed: 0.35,
    gait: "walk",
  }),
};

const cache = new Map<string, { model: AnimalModel; body: THREE.BufferGeometry; pattern: THREE.BufferGeometry }>();

/** Merged geometries for one species (cached). */
export function animalGeometry(species: string): { model: AnimalModel; body: THREE.BufferGeometry; pattern: THREE.BufferGeometry } {
  const hit = cache.get(species);
  if (hit) return hit;
  const model = (MODELS[species] ?? MODELS.goat)();
  // Overlay pieces are pushed slightly outward so they never z-fight the body.
  const pattern = model.pattern.map((part) => ({ ...part, sx: part.sx * 1.04 + 0.006, sy: part.sy * 1.04 + 0.006, sz: part.sz * 1.04 + 0.006 }));
  const entry = { model, body: compose(model.body), pattern: compose(pattern) };
  cache.set(species, entry);
  return entry;
}

export function animalModel(species: string): AnimalModel {
  return animalGeometry(species).model;
}

/** Hue gene → per-instance color multiplier (warmer/darker vs cooler/lighter coat). */
export function coatTint(hue: number, out = new THREE.Color()): THREE.Color {
  const warm = Math.max(0, hue);
  const cool = Math.max(0, -hue);
  return out.setRGB(1 + warm * 0.14 - cool * 0.12, 1 - warm * 0.08 - cool * 0.02, 1 - warm * 0.22 + cool * 0.1);
}

/** Pattern overlay color: body color at pattern 0, full accent at pattern 1. */
export function patternColor(base: number, model: AnimalModel, hue: number, pattern: number, out = new THREE.Color()): THREE.Color {
  const tint = coatTint(hue);
  const body = new THREE.Color(base).multiply(tint);
  // Stripes and spots are the species' signature: always visible, the gene sets the contrast.
  const min = model.style === "stripes" || model.style === "spots" ? 0.5 : 0;
  const amount = min + (1 - min) * Math.min(1, Math.max(0, pattern));
  return out.copy(body).lerp(new THREE.Color(model.accent), amount * 0.9);
}

// ---------------------------------------------------------------- habitat items (interior + outside)

const ITEM_PARTS: Record<string, (fill: number) => Part[]> = {
  food: (fill) => [
    cyl(0, 0.12, 0, 0.42, 0.24, 0x8a6a4a),
    cyl(0, 0.2, 0, 0.36, 0.1, 0x5a4232),
    ...(fill > 0 ? [ball(0, 0.24, 0, 0.32, 0.05 + fill * 0.0012, 0.32, 0xd8a650), ball(0.1, 0.27, 0.06, 0.08, 0.06, 0.08, 0x8ab84a)] : []),
  ],
  water: (fill) => [
    box(0, 0.16, 0, 1.0, 0.32, 0.5, 0x9aa2a8),
    box(0, 0.24, 0, 0.86, 0.2, 0.36, 0x5e666c),
    ...(fill > 0 ? [box(0, 0.2 + fill * 0.0012, 0, 0.84, 0.04, 0.34, 0x4ab0dc)] : []),
  ],
  toy: () => [
    ball(0, 0.26, 0, 0.26, 0.26, 0.26, 0xe8463a),
    box(0, 0.26, 0, 0.53, 0.06, 0.06, 0xf4f0e8),
    cyl(0.6, 0.05, 0.3, 0.05, 0.6, 0xc8a46a, { rz: Math.PI / 2, ry: 0.6 }),
  ],
  shelter: () => [
    box(0, 0.6, 0, 1.6, 1.2, 1.3, 0xa07a50),
    box(0, 0.5, 0.66, 0.6, 0.8, 0.04, 0x3e2e22),
    box(0, 1.47, -0.36, 1.9, 0.12, 0.98, 0x6e4a32, { rx: -0.55 }),
    box(0, 1.47, 0.36, 1.9, 0.12, 0.98, 0x6e4a32, { rx: 0.55 }),
  ],
  plant: () => [
    ball(0, 0.4, 0, 0.45, 0.4, 0.45, 0x6aa04e),
    ball(0.28, 0.32, 0.18, 0.3, 0.28, 0.3, 0x7ab25a),
    ball(-0.22, 0.28, -0.2, 0.26, 0.24, 0.26, 0x5e9446),
  ],
  rock: () => [
    ball(0, 0.32, 0, 0.6, 0.38, 0.5, 0xa49c90),
    ball(0.38, 0.22, 0.24, 0.32, 0.24, 0.3, 0x948c80),
  ],
};

export function itemGeometry(kind: string, fill = 100): THREE.BufferGeometry {
  return compose((ITEM_PARTS[kind] ?? ITEM_PARTS.rock)(fill));
}

// ---------------------------------------------------------------- safari jeep and visitors

export function buildJeepGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [
    box(0, 0.62, 0, 1.25, 0.5, 2.3, 0xc8b070),
    box(0, 0.62, 1.2, 1.2, 0.36, 0.1, 0x6e6250),
    box(0, 0.92, 0.85, 1.15, 0.1, 0.06, 0x6e6250),
    box(0, 1.55, -0.2, 1.3, 0.08, 1.9, 0xe9e2c8),
    ...[-0.6, 0.6].flatMap((x) => [-1.05, 0.6].map((z) => box(x, 1.2, z, 0.06, 0.7, 0.06, 0x6e6250))),
    ...[-0.62, 0.62].flatMap((x) => [-0.75, 0.75].map((z) => cyl(x, 0.3, z, 0.28, 0.2, 0x2a2a2a, { rz: Math.PI / 2 }))),
    box(0, 0.68, -0.3, 1.0, 0.1, 0.12, 0x1e1e22),
    box(0, 0.68, 0.3, 1.0, 0.1, 0.12, 0x1e1e22),
    // passengers
    ball(-0.3, 1.12, 0.35, 0.15, 0.17, 0.15, 0xf0c8a0),
    ball(0.3, 1.12, -0.45, 0.15, 0.17, 0.15, 0xc89a72),
    ball(-0.3, 1.12, -0.45, 0.15, 0.17, 0.15, 0xe8b890),
    box(-0.3, 0.92, 0.35, 0.3, 0.3, 0.24, 0x3d88c8),
    box(0.3, 0.92, -0.45, 0.3, 0.3, 0.24, 0xe24a32),
    box(-0.3, 0.92, -0.45, 0.3, 0.3, 0.24, 0xf0b43c),
  ];
  return compose(parts);
}
