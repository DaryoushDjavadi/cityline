import { buildingInfo, FOOD_STOCK_MAX, readBudget, refundForLevel, serviceInfo, tradeDeal } from "./catalog.ts";
import { demandRebate } from "./goals.ts";
import { jobOpenings, listAdults } from "./people.ts";
import {
  COST,
  DIRS,
  GRID_SIZE,
  BRIDGE_FLAG,
  ROAD_FLAG,
  cellCoords,
  cellIndex,
  inBounds,
  uniqueCells,
} from "./grid.ts";
import {
  ServiceKind,
  POST_SLOTS,
  Zone,
  type ApplyResult,
  type CityState,
  type Command,
  type ServiceId,
  type ZoneId,
} from "./types.ts";

const STARTING_FUNDS = 100_000;
const ZONE_REACH = 3;

export function createCity(width = GRID_SIZE, height = GRID_SIZE): CityState {
  const count = width * height;
  const city: CityState = {
    width,
    height,
    tick: 0,
    revision: 0,
    rng: (Math.random() * 0x100000000) >>> 0 || 1,
    funds: STARTING_FUNDS,
    roads: new Uint8Array(count),
    zones: new Uint8Array(count),
    levels: new Uint8Array(count),
    utility: new Uint8Array(count),
    services: new Uint8Array(count),
    lines: new Uint8Array(count),
    pipes: new Uint8Array(count),
    budget: new Uint8Array(count).fill(100),
    skills: new Uint8Array(count),
    terrain: new Uint8Array(count),
    posts: new Uint16Array(count * POST_SLOTS),
    demand: { residential: 70, commercial: 62, industrial: 58 },
    goals: 0,
    food: 0,
  };
  pourTerrain(city);
  return city;
}

export function isWater(city: CityState, index: number): boolean {
  return index >= 0 && index < city.terrain.length && city.terrain[index] === 1;
}

export function pourTerrain(city: CityState): void {
  const seed = city.rng || 1;
  const random = mulberry(seed);
  carveIsland(city, seed);
  carveRiver(city, random);
  if (random() < 0.7) carveLake(city, random);
  city.rng = seed >>> 0;
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
    return state / 4294967296;
  };
}

function carveIsland(city: CityState, seed: number): void {
  const cx = (city.width - 1) / 2;
  const cy = (city.height - 1) / 2;
  for (let y = 0; y < city.height; y += 1) {
    for (let x = 0; x < city.width; x += 1) {
      const nx = (x - cx) / (city.width * 0.5);
      const ny = (y - cy) / (city.height * 0.5);
      const noise = field(x, y, seed);
      const shore = 0.58 + (noise - 0.5) * 0.42;
      if (nx * nx + ny * ny > shore * shore) city.terrain[cellIndex(city, x, y)] = 1;
    }
  }
}

function field(x: number, y: number, seed: number): number {
  const coarse = valueNoise(x * 0.085, y * 0.085, seed);
  const fine = valueNoise(x * 0.17, y * 0.17, seed + 23);
  return coarse * 0.72 + fine * 0.28;
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

function carveRiver(city: CityState, random: () => number): void {
  let x = city.width * 0.5;
  let y = city.height * 0.5;
  const angle = random() * Math.PI * 2;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  for (let step = 0; step < city.width; step += 1) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!inBounds(city, ix, iy) || isWater(city, cellIndex(city, ix, iy))) break;
    stampWater(city, ix, iy, step % 6 === 0 ? 1 : 0);
    if (random() < 0.4) {
      const turn = (random() - 0.5) * 0.9;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const nextX = dx * cos - dy * sin;
      const nextY = dx * sin + dy * cos;
      dx = nextX;
      dy = nextY;
    }
    x += dx;
    y += dy;
  }
}

function carveLake(city: CityState, random: () => number): void {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const cx = 10 + Math.floor(random() * (city.width - 20));
    const cy = 10 + Math.floor(random() * (city.height - 20));
    if (isWater(city, cellIndex(city, cx, cy))) continue;
    const radius = 3 + Math.floor(random() * 3);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) stampWater(city, cx + dx, cy + dy, 0);
      }
    }
    return;
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

export function isLink(layer: Uint8Array, index: number): boolean {
  return index >= 0 && index < layer.length && (layer[index] & ROAD_FLAG) !== 0;
}

export function isRoad(city: CityState, index: number): boolean {
  return isLink(city.roads, index);
}

export function isBridge(city: CityState, index: number): boolean {
  return index >= 0 && index < city.roads.length && (city.roads[index] & BRIDGE_FLAG) !== 0;
}

export function isLine(city: CityState, index: number): boolean {
  return isLink(city.lines, index);
}

export function isPipe(city: CityState, index: number): boolean {
  return isLink(city.pipes, index);
}

export function cellBudget(city: CityState, index: number): number {
  return readBudget(city.budget[index] ?? 0);
}

export function nearRoad(city: CityState, index: number): boolean {
  const { x, y } = cellCoords(city, index);
  for (let dy = -ZONE_REACH; dy <= ZONE_REACH; dy += 1) {
    for (let dx = -ZONE_REACH; dx <= ZONE_REACH; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > ZONE_REACH) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(city, nx, ny)) continue;
      if (isRoad(city, cellIndex(city, nx, ny))) return true;
    }
  }
  return false;
}

function zonePresent(city: CityState, zone: number): boolean {
  for (let index = 0; index < city.zones.length; index += 1) {
    if (city.zones[index] === zone && city.levels[index] > 0) return true;
  }
  return false;
}

function orthogonalRoad(city: CityState, index: number): boolean {
  const { x, y } = cellCoords(city, index);
  for (const dir of DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (inBounds(city, nx, ny) && isRoad(city, cellIndex(city, nx, ny))) return true;
  }
  return false;
}

export type PlaceAction = "road" | "bridge" | "fill" | "zone" | "bulldoze" | "service" | "line" | "pipe" | "build";

export function canPlace(
  city: CityState,
  index: number,
  action: PlaceAction,
  extra?: { zone?: ZoneId; kind?: ServiceId },
): boolean {
  if (index < 0 || index >= city.roads.length) return false;
  if (action === "bridge") return isWater(city, index) && !isRoad(city, index) && city.services[index] === ServiceKind.None;
  if (action === "fill") {
    return isWater(city, index) && !isRoad(city, index) && city.services[index] === ServiceKind.None && city.levels[index] === 0 && city.zones[index] === Zone.None;
  }
  if ((action === "line" || action === "pipe") && isWater(city, index)) {
    if (city.services[index] !== ServiceKind.None || city.levels[index] > 0 || city.zones[index] !== Zone.None) return false;
    return action === "line" ? !isLine(city, index) : !isPipe(city, index);
  }
  if (action !== "bulldoze" && isWater(city, index)) return false;
  if (action === "road") return city.services[index] === ServiceKind.None && !isRoad(city, index);
  if (action === "build") {
    if (isRoad(city, index) || isLine(city, index) || isPipe(city, index) || city.services[index] !== ServiceKind.None) return false;
    if (city.zones[index] !== Zone.None || city.levels[index] > 0) return false;
    return nearRoad(city, index);
  }
  if (action === "line") {
    return city.services[index] === ServiceKind.None && city.levels[index] === 0 && city.zones[index] === Zone.None && !isLine(city, index);
  }
  if (action === "pipe") {
    return city.services[index] === ServiceKind.None && city.levels[index] === 0 && city.zones[index] === Zone.None && !isPipe(city, index);
  }
  if (action === "zone") {
    const zone = extra?.zone ?? Zone.None;
    if (zone !== Zone.Residential && zone !== Zone.Commercial && zone !== Zone.Industrial) return false;
    if (isRoad(city, index) || isLine(city, index) || isPipe(city, index) || city.services[index] !== ServiceKind.None) return false;
    if (city.zones[index] === zone) return false;
    return nearRoad(city, index);
  }
  if (action === "bulldoze") {
    return (
      isRoad(city, index) ||
      isLine(city, index) ||
      isPipe(city, index) ||
      city.zones[index] !== 0 ||
      city.levels[index] !== 0 ||
      city.services[index] !== 0
    );
  }
  const info = serviceInfo(extra?.kind ?? ServiceKind.None);
  if (!info) return false;
  if (isRoad(city, index) || isLine(city, index) || isPipe(city, index) || city.services[index] !== ServiceKind.None) return false;
  return orthogonalRoad(city, index);
}

function recomputeLayer(city: CityState, layer: Uint8Array, index: number): void {
  if (!isLink(layer, index)) {
    layer[index] = 0;
    return;
  }
  const { x, y } = cellCoords(city, index);
  const bridge = (layer[index] & BRIDGE_FLAG) !== 0;
  let mask = ROAD_FLAG;
  for (const dir of DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (inBounds(city, nx, ny) && isLink(layer, cellIndex(city, nx, ny))) mask |= dir.bit;
  }
  layer[index] = bridge ? mask | BRIDGE_FLAG : mask;
}

function recomputeAround(city: CityState, layer: Uint8Array, indices: readonly number[]): void {
  const seen = new Set<number>();
  for (const index of indices) {
    seen.add(index);
    const { x, y } = cellCoords(city, index);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (inBounds(city, nx, ny)) seen.add(cellIndex(city, nx, ny));
    }
  }
  for (const index of seen) recomputeLayer(city, layer, index);
}

function releaseWork(city: CityState, index: number): void {
  for (let slot = 0; slot < POST_SLOTS; slot += 1) city.posts[index * POST_SLOTS + slot] = 0;
  const mark = index + 1;
  for (let entry = 0; entry < city.posts.length; entry += 1) {
    if (city.posts[entry] === mark) city.posts[entry] = 0;
  }
}

function costOf(action: PlaceAction, kind?: ServiceId): number {
  if (action === "road") return COST.road;
  if (action === "bridge") return COST.bridge;
  if (action === "fill") return COST.fill;
  if (action === "zone") return COST.zone;
  if (action === "line") return COST.line;
  if (action === "pipe") return COST.pipe;
  if (action === "service") return serviceInfo(kind ?? 0)?.cost ?? 0;
  return 0;
}

export function applyCommand(city: CityState, command: Command): ApplyResult {
  const applied: number[] = [];
  const rejected: number[] = [];
  let spent = 0;
  let bonus = 0;
  let reason: string | undefined;

  const pay = (cost: number): boolean => {
    if (city.funds < spent + cost) {
      reason = "funds";
      return false;
    }
    spent += cost;
    return true;
  };

  if (command.type === "budget") {
    const occupied = city.services[command.index] !== ServiceKind.None || city.levels[command.index] > 0;
    if (!occupied || command.value < 50 || command.value > 150) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [command.index] };
    }
    city.budget[command.index] = command.value;
    city.revision += 1;
    return { ok: true, spent: 0, applied: [command.index], rejected };
  }

  if (command.type === "gift") {
    const index = command.index;
    const level = city.levels[index];
    if (city.zones[index] !== Zone.Residential || level <= 0) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [index] };
    }
    if ((city.skills[index] & 4) !== 0) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [index] };
    }
    const hasSchool = city.services.some((kind) => kind === ServiceKind.School);
    const hasUniversity = city.services.some((kind) => kind === ServiceKind.University);
    if (!hasSchool || !hasUniversity) {
      return { ok: false, reason: "no_university", spent: 0, applied, rejected: [index] };
    }
    const cost = 1800 + level * 500;
    if (!pay(cost)) return { ok: false, reason: "funds", spent: 0, applied, rejected: [index] };
    city.skills[index] = 2 | 4;
    city.funds -= spent;
    city.revision += 1;
    return { ok: true, spent, applied: [index], rejected };
  }

  if (command.type === "trade") {
    const index = command.index;
    if (city.services[index] !== ServiceKind.Airport) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [index] };
    }
    const deal = tradeDeal(command.deal);
    if (!deal) return { ok: false, reason: "rejected", spent: 0, applied, rejected: [index] };
    if (deal.side === "import") {
      if (!pay(deal.price)) return { ok: false, reason: "funds", spent: 0, applied, rejected: [index] };
      if (deal.food) city.food = Math.min(FOOD_STOCK_MAX, city.food + deal.food);
      city.funds -= spent;
      city.revision += 1;
      return { ok: true, spent, applied: [index], rejected };
    }
    if (deal.requires === "food") {
      const take = Math.abs(deal.food ?? 0);
      if (city.food < take) return { ok: false, reason: "no_stock", spent: 0, applied, rejected: [index] };
      city.food -= take;
    } else if (deal.requires === "commercial" && !zonePresent(city, Zone.Commercial)) {
      return { ok: false, reason: "no_market", spent: 0, applied, rejected: [index] };
    } else if (deal.requires === "industrial" && !zonePresent(city, Zone.Industrial)) {
      return { ok: false, reason: "no_market", spent: 0, applied, rejected: [index] };
    }
    city.funds = Math.min(5_000_000, city.funds + deal.price);
    city.revision += 1;
    return { ok: true, spent: 0, applied: [index], rejected, bonus: deal.price };
  }

  if (command.type === "hire") {
    const { workplace, home, slot } = command;
    const openings = jobOpenings(city, workplace);
    const worker = listAdults(city, home).find((adult) => adult.slot === slot);
    if (!worker || worker.workplace !== null || openings <= 0) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [workplace] };
    }
    city.posts[home * POST_SLOTS + slot] = workplace + 1;
    city.revision += 1;
    return { ok: true, spent: 0, applied: [workplace, home], rejected };
  }

  if (command.type === "service") {
    const index = command.index;
    if (!canPlace(city, index, "service", { kind: command.kind })) {
      return { ok: false, reason: "rejected", spent: 0, applied, rejected: [index] };
    }
    if (!pay(costOf("service", command.kind))) {
      return { ok: false, reason: "funds", spent: 0, applied, rejected: [index] };
    }
    city.services[index] = command.kind;
    city.zones[index] = Zone.None;
    city.levels[index] = 0;
    city.roads[index] = 0;
    city.lines[index] = 0;
    city.pipes[index] = 0;
    releaseWork(city, index);
    city.budget[index] = 100;
    city.skills[index] = 0;
    city.funds -= spent;
    city.revision += 1;
    recomputeAround(city, city.roads, [index]);
    recomputeAround(city, city.lines, [index]);
    recomputeAround(city, city.pipes, [index]);
    return { ok: true, spent, applied: [index], rejected };
  }

  const cells = uniqueCells(command.cells);
  if (cells.length === 0) return { ok: false, reason: "empty", spent: 0, applied, rejected };

  for (const index of cells) {
    const extra = command.type === "zone" ? { zone: command.zone } : undefined;
    if (!canPlace(city, index, command.type, extra)) {
      rejected.push(index);
      reason ??= "rejected";
      continue;
    }
    const cost = command.type === "build" ? (buildingInfo(command.kind)?.cost ?? 0) : costOf(command.type);
    if (cost > 0 && !pay(cost)) {
      rejected.push(index);
      continue;
    }
    if (command.type === "road" || command.type === "bridge") {
      releaseWork(city, index);
      city.roads[index] = command.type === "bridge" ? ROAD_FLAG | BRIDGE_FLAG : ROAD_FLAG;
      city.zones[index] = Zone.None;
      city.levels[index] = 0;
    } else if (command.type === "build") {
      const info = buildingInfo(command.kind);
      if (!info) {
        rejected.push(index);
        reason ??= "rejected";
        continue;
      }
      releaseWork(city, index);
      city.zones[index] = info.zone;
      city.levels[index] = info.level;
      city.budget[index] = 100;
      city.skills[index] = 0;
      const demand =
        info.zone === Zone.Residential ? city.demand.residential
        : info.zone === Zone.Commercial ? city.demand.commercial
        : info.zone === Zone.Industrial ? city.demand.industrial
        : 0;
      bonus += demandRebate(demand, info.cost);
    } else if (command.type === "fill") {
      city.terrain[index] = 0;
    } else if (command.type === "line") {
      city.lines[index] = ROAD_FLAG;
    } else if (command.type === "pipe") {
      city.pipes[index] = ROAD_FLAG;
    } else if (command.type === "zone") {
      releaseWork(city, index);
      city.zones[index] = command.zone;
      city.levels[index] = 0;
      city.budget[index] = 100;
      city.skills[index] = 0;
    } else {
      releaseWork(city, index);
      if (isBridge(city, index)) city.funds += Math.floor(COST.bridge / 3);
      else if (isRoad(city, index)) city.funds += Math.floor(COST.road / 3);
      else if (isLine(city, index)) city.funds += 5;
      else if (isPipe(city, index)) city.funds += 5;
      else if (city.services[index] !== ServiceKind.None) city.funds += Math.floor((serviceInfo(city.services[index])?.cost ?? 0) / 5);
      else if (city.levels[index] > 0) city.funds += refundForLevel(city.zones[index], city.levels[index]);
      city.roads[index] = 0;
      city.lines[index] = 0;
      city.pipes[index] = 0;
      city.zones[index] = Zone.None;
      city.levels[index] = 0;
      city.services[index] = ServiceKind.None;
      city.budget[index] = 100;
      city.skills[index] = 0;
    }
    applied.push(index);
  }

  if (applied.length === 0) return { ok: false, reason: reason ?? "rejected", spent: 0, applied, rejected };
  if (command.type === "road" || command.type === "bridge" || command.type === "bulldoze") recomputeAround(city, city.roads, cells);
  if (command.type === "line" || command.type === "bulldoze") recomputeAround(city, city.lines, cells);
  if (command.type === "pipe" || command.type === "bulldoze") recomputeAround(city, city.pipes, cells);
  city.funds -= spent;
  if (bonus > 0) city.funds = Math.min(5_000_000, city.funds + bonus);
  city.revision += 1;
  return { ok: true, reason: rejected.length > 0 ? reason : undefined, spent, applied, rejected, bonus };
}
