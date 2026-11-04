import { cellIndex, inBounds } from "./grid.ts";
import type { BiomeId, CityState, MapGen } from "./types.ts";

export type { BiomeId, MapGen };

export interface MapGenOptions {
  seed?: number;
  biome?: BiomeId;
  water?: number;
  lakes?: number;
  forest?: number;
  rivers?: number;
}

export interface BiomePreset {
  id: BiomeId;
  label: string;
  blurb: string;
  water: number;
  lakes: number;
  forest: number;
  rivers: number;
}

export const BIOMES: BiomePreset[] = [
  { id: "temperate", label: "Gemäßigt", blurb: "Klassische Insel mit Fluss und Wald.", water: 42, lakes: 48, forest: 50, rivers: 55 },
  { id: "arid", label: "Trocken", blurb: "Weniger Wasser, spärlicher Bewuchs, mehr Stein.", water: 58, lakes: 12, forest: 14, rivers: 22 },
  { id: "alpine", label: "Alpin", blurb: "Zerklüftete Küste, dichter Nadelwald, klare Seen.", water: 40, lakes: 45, forest: 68, rivers: 72 },
  { id: "tropical", label: "Tropisch", blurb: "Üppiger Wald und viele Binnengewässer.", water: 36, lakes: 78, forest: 85, rivers: 48 },
  { id: "archipelago", label: "Archipel", blurb: "Mehrere Inseln im offenen Meer.", water: 74, lakes: 28, forest: 38, rivers: 18 },
];

export function biomePreset(id: BiomeId): BiomePreset {
  return BIOMES.find((entry) => entry.id === id) ?? BIOMES[0];
}

export function resolveMapGen(opts: MapGenOptions = {}): MapGen {
  const biome = opts.biome && BIOMES.some((entry) => entry.id === opts.biome) ? opts.biome : "temperate";
  const preset = biomePreset(biome);
  return {
    seed: normalizeSeed(opts.seed),
    biome,
    water: clamp(opts.water ?? preset.water, 0, 100),
    lakes: clamp(opts.lakes ?? preset.lakes, 0, 100),
    forest: clamp(opts.forest ?? preset.forest, 0, 100),
    rivers: clamp(opts.rivers ?? preset.rivers, 0, 100),
  };
}

export function normalizeSeed(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return ((Math.random() * 0x100000000) >>> 0) || 1;
  return (n >>> 0) || 1;
}

export function randomSeed(): number {
  return ((Math.random() * 0x100000000) >>> 0) || 1;
}

/** Fill city.terrain from options; stores city.gen and resets rng to seed. */
export function pourTerrain(city: CityState, opts: MapGenOptions = {}): void {
  const gen = resolveMapGen(opts);
  city.gen = gen;
  city.terrain.fill(0);
  const random = mulberry(gen.seed);

  if (gen.biome === "archipelago") carveArchipelago(city, gen, random);
  else carveContinent(city, gen, random);

  const riverBudget = gen.rivers < 18 ? 0 : gen.rivers < 45 ? 1 : gen.rivers < 75 ? 1 + (random() < 0.55 ? 1 : 0) : 2 + (random() < 0.4 ? 1 : 0);
  for (let index = 0; index < riverBudget; index += 1) carveRiver(city, random, gen);

  const lakeTries = Math.max(0, Math.round(gen.lakes / 14));
  for (let index = 0; index < lakeTries; index += 1) {
    if (random() < 0.35 + gen.lakes / 140) carveLake(city, random, gen);
  }

  if (gen.biome === "tropical") carveWetlands(city, gen, random);
  if (gen.biome === "arid") etchAridSpots(city, gen, random);

  // Soft coastal bays after rivers/lakes for organic edges.
  if (gen.biome !== "arid") etchBays(city, gen, random);

  city.rng = gen.seed >>> 0;
}

export function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
    return state / 4294967296;
  };
}

function carveContinent(city: CityState, gen: MapGen, random: () => number): void {
  const cx = (city.width - 1) / 2;
  const cy = (city.height - 1) / 2;
  // High water → smaller landmass.
  const shore = 0.78 - (gen.water / 100) * 0.4;
  const stretchX = 0.92 + random() * 0.22;
  const stretchY = 0.92 + random() * 0.22;
  for (let y = 0; y < city.height; y += 1) {
    for (let x = 0; x < city.width; x += 1) {
      const nx = ((x - cx) / (city.width * 0.5)) * stretchX;
      const ny = ((y - cy) / (city.height * 0.5)) * stretchY;
      const radial = Math.sqrt(nx * nx + ny * ny);
      const noise = fbm(x, y, gen.seed, gen.biome === "alpine" ? 0.11 : 0.09);
      const ridge = gen.biome === "alpine" ? Math.abs(noise - 0.5) * 0.55 : 0;
      const edge = shore + (noise - 0.5) * 0.38 - ridge;
      if (radial > edge) city.terrain[cellIndex(city, x, y)] = 1;
    }
  }
}

function carveArchipelago(city: CityState, gen: MapGen, random: () => number): void {
  const islands = 3 + Math.floor(random() * 3);
  const centers: { x: number; y: number; r: number }[] = [];
  for (let index = 0; index < islands; index += 1) {
    centers.push({
      x: 8 + random() * (city.width - 16),
      y: 8 + random() * (city.height - 16),
      r: (0.18 + random() * 0.16) * (1.15 - gen.water / 220),
    });
  }
  // Start as ocean, raise land near nuclei.
  city.terrain.fill(1);
  for (let y = 0; y < city.height; y += 1) {
    for (let x = 0; x < city.width; x += 1) {
      const noise = fbm(x, y, gen.seed + 9, 0.1);
      let land = false;
      for (const island of centers) {
        const nx = (x - island.x) / (city.width * island.r);
        const ny = (y - island.y) / (city.height * island.r);
        if (nx * nx + ny * ny < 0.85 + (noise - 0.5) * 0.55) land = true;
      }
      if (land && noise > 0.28) city.terrain[cellIndex(city, x, y)] = 0;
    }
  }
}

function carveRiver(city: CityState, random: () => number, gen: MapGen): void {
  let x = city.width * (0.35 + random() * 0.3);
  let y = city.height * (0.35 + random() * 0.3);
  // Prefer starting on land.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const sx = Math.round(8 + random() * (city.width - 16));
    const sy = Math.round(8 + random() * (city.height - 16));
    if (!isWaterCell(city, sx, sy)) {
      x = sx;
      y = sy;
      break;
    }
  }
  const angle = random() * Math.PI * 2;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const steps = Math.round(city.width * (0.55 + gen.rivers / 180));
  const wide = gen.rivers > 70 && random() < 0.45;
  for (let step = 0; step < steps; step += 1) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!inBounds(city, ix, iy)) break;
    stampWater(city, ix, iy, wide && step % 5 === 0 ? 1 : step % 7 === 0 ? 1 : 0);
    if (random() < 0.38) {
      const turn = (random() - 0.5) * (gen.biome === "alpine" ? 1.15 : 0.85);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const nextX = dx * cos - dy * sin;
      const nextY = dx * sin + dy * cos;
      dx = nextX;
      dy = nextY;
    }
    x += dx * (0.85 + random() * 0.35);
    y += dy * (0.85 + random() * 0.35);
  }
}

function carveLake(city: CityState, random: () => number, gen: MapGen): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cx = 8 + Math.floor(random() * (city.width - 16));
    const cy = 8 + Math.floor(random() * (city.height - 16));
    if (isWaterCell(city, cx, cy)) continue;
    const radius = 2 + Math.floor(random() * (2 + gen.lakes / 40));
    for (let dy = -radius - 1; dy <= radius + 1; dy += 1) {
      for (let dx = -radius - 1; dx <= radius + 1; dx += 1) {
        const wobble = (fbm(cx + dx, cy + dy, gen.seed + 44, 0.2) - 0.5) * 1.4;
        if (dx * dx + dy * dy <= (radius + wobble) * (radius + wobble)) stampWater(city, cx + dx, cy + dy, 0);
      }
    }
    return;
  }
}

function carveWetlands(city: CityState, gen: MapGen, random: () => number): void {
  const pools = 2 + Math.floor(gen.lakes / 30);
  for (let index = 0; index < pools; index += 1) {
    const cx = 10 + Math.floor(random() * (city.width - 20));
    const cy = 10 + Math.floor(random() * (city.height - 20));
    if (isWaterCell(city, cx, cy)) continue;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        if (random() < 0.55) stampWater(city, cx + dx, cy + dy, 0);
      }
    }
  }
}

function etchAridSpots(city: CityState, gen: MapGen, random: () => number): void {
  // Fill small inland puddles — deserts keep rare oases only.
  for (let y = 2; y < city.height - 2; y += 1) {
    for (let x = 2; x < city.width - 2; x += 1) {
      if (!isWaterCell(city, x, y)) continue;
      let land = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (!isWaterCell(city, x + dx, y + dy)) land += 1;
        }
      }
      if (land >= 6 && random() > gen.lakes / 180) city.terrain[cellIndex(city, x, y)] = 0;
    }
  }
}

function etchBays(city: CityState, gen: MapGen, random: () => number): void {
  const bites = 4 + Math.floor(random() * 5) + Math.floor(gen.water / 35);
  for (let index = 0; index < bites; index += 1) {
    const cx = Math.floor(random() * city.width);
    const cy = Math.floor(random() * city.height);
    if (!isWaterCell(city, cx, cy)) continue;
    const radius = 1 + Math.floor(random() * 3);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(city, nx, ny)) continue;
        // Nibble land next to water for fjord/bay feel.
        if (!isWaterCell(city, nx, ny) && random() < 0.55) city.terrain[cellIndex(city, nx, ny)] = 1;
      }
    }
  }
}

function stampWater(city: CityState, x: number, y: number, extra: number): void {
  for (let dy = -extra; dy <= extra; dy += 1) {
    for (let dx = -extra; dx <= extra; dx += 1) {
      if (!inBounds(city, x + dx, y + dy)) continue;
      city.terrain[cellIndex(city, x + dx, y + dy)] = 1;
    }
  }
}

function isWaterCell(city: CityState, x: number, y: number): boolean {
  if (!inBounds(city, x, y)) return true;
  return city.terrain[cellIndex(city, x, y)] === 1;
}

function fbm(x: number, y: number, seed: number, scale: number): number {
  const a = valueNoise(x * scale, y * scale, seed);
  const b = valueNoise(x * scale * 2.1, y * scale * 2.1, seed + 17);
  const c = valueNoise(x * scale * 4.3, y * scale * 4.3, seed + 41);
  return a * 0.55 + b * 0.3 + c * 0.15;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number, seed: number): number {
  let hash = Math.imul(x + seed * 13, 374761393) ^ Math.imul(y + seed * 7, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Stable 0–99 roll for vegetation, seed-aware. */
export function vegetationRoll(x: number, y: number, seed: number): number {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 3, 668265263) ^ Math.imul(seed, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 2246822519);
  return ((hash ^ (hash >>> 16)) >>> 0) % 100;
}
