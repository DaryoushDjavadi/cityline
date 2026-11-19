/** Client-only, deterministic wandering for zoo animals (same motion outside and in the interior view). */
import type { Animal } from "../../../shared/src/index.ts";
import { animalModel } from "./zooModels.ts";

export interface Pose {
  x: number;
  z: number;
  heading: number;
  y: number;
  roll: number;
}

function hash(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function base(id: number, e: number, radius: number): { x: number; z: number } {
  const p1 = hash(id) * 6.283;
  const p2 = hash(id + 7) * 6.283;
  const p3 = hash(id + 13) * 6.283;
  const p4 = hash(id + 29) * 6.283;
  const f = 0.8 + hash(id + 3) * 0.5;
  return {
    x: radius * (0.62 * Math.sin(e * 0.9 * f + p1) + 0.38 * Math.sin(e * 1.7 * f + p2)),
    z: radius * (0.62 * Math.sin(e * 0.7 * f + p3) + 0.38 * Math.sin(e * 1.3 * f + p4)),
  };
}

/**
 * Pose inside a habitat of half-size `radius` (local coordinates, center 0,0).
 * Walk speed comes from the species; animals pause now and then (grazing).
 */
export function wanderPose(animal: Animal, time: number, radius: number, scale: number, mother?: Pose): Pose {
  const model = animalModel(animal.species);
  const id = animal.id;
  if (mother) {
    // Young stay close to their mother.
    const a = time * 0.5 + hash(id) * 6.283;
    const d = 0.7 + 0.25 * Math.sin(time * 0.37 + id);
    const x = mother.x + Math.cos(a) * d * scale * 2.2;
    const z = mother.z + Math.sin(a) * d * scale * 2.2;
    return { x: clamp(x, radius), z: clamp(z, radius), heading: -a, y: hop(model.gait, time, id, scale), roll: 0 };
  }
  const k = 0.35 + hash(id + 5) * 0.2;
  const rate = model.speed / Math.max(0.6, radius);
  const t = time * rate + hash(id + 11) * 100;
  // e' = 1 − cos(k t) ∈ [0, 2]: smooth stops and starts.
  const e = t - Math.sin(k * t) / k;
  const here = base(id, e, radius);
  const next = base(id, e + 0.02, radius);
  const heading = Math.atan2(next.x - here.x, next.z - here.z);
  const moving = 1 - Math.cos(k * t);
  return {
    x: here.x,
    z: here.z,
    heading,
    y: moving > 0.25 ? hop(model.gait, time, id, scale) : 0,
    roll: model.gait === "waddle" && moving > 0.25 ? Math.sin(time * 7 + id) * 0.14 : 0,
  };
}

function hop(gait: string, time: number, id: number, scale: number): number {
  if (gait === "hop") return Math.abs(Math.sin(time * 4.5 + id)) * 0.22 * scale;
  if (gait === "walk") return Math.abs(Math.sin(time * 5 + id)) * 0.025 * scale;
  return 0;
}

function clamp(v: number, r: number): number {
  return Math.max(-r, Math.min(r, v));
}
