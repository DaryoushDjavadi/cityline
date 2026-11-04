import { AIRPORT_INCOME, FOOD_PER_WORKER, FOOD_STOCK_MAX, foodNeed, serviceInfo } from "./catalog.ts";
import { claimGoals } from "./goals.ts";
import { cellBudget, isLink, isRoad } from "./city.ts";
import { farmStatus } from "./farm.ts";
import { DIRS, ROAD_FLAG, cellCoords, cellIndex, inBounds } from "./grid.ts";
import { isWorkplace } from "./people.ts";
import { computeTraffic } from "./traffic.ts";
import {
  POST_SLOTS,
  POWER_BIT,
  ServiceKind,
  WATER_BIT,
  Zone,
  type CityState,
  type CityStats,
  type SimMeta,
} from "./types.ts";

const POWER_CAPACITY = 420;
const WATER_CAPACITY = 520;
const GROWTH_EVERY = 4;

export function utilityUse(zone: number, level: number): number {
  if (level <= 0) return 0;
  const base = zone === Zone.Industrial ? 6 : zone === Zone.Commercial ? 3 : 2;
  return base * level;
}

export function nextRand(city: CityState): number {
  let seed = city.rng | 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  city.rng = (value ^ (value >>> 14)) >>> 0;
  return city.rng / 4294967296;
}

function clampDemand(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function computeStats(city: CityState): CityStats {
  let population = 0;
  let jobs = 0;
  let powerCapacity = 0;
  let waterCapacity = 0;
  let powerUsed = 0;
  let waterUsed = 0;

  const count = city.width * city.height;
  const staff = staffCounts(city);
  for (let index = 0; index < count; index += 1) {
    if (city.services[index] === ServiceKind.Power) powerCapacity += Math.round(POWER_CAPACITY * (cellBudget(city, index) / 100));
    if (city.services[index] === ServiceKind.Water) waterCapacity += Math.round(WATER_CAPACITY * (cellBudget(city, index) / 100));
    const level = city.levels[index];
    if (level <= 0) continue;
    const zone = city.zones[index];
    if (zone === Zone.Residential) population += level * 12;
    const use = utilityUse(zone, level);
    if ((city.utility[index] & POWER_BIT) !== 0) powerUsed += use;
    if ((city.utility[index] & WATER_BIT) !== 0) waterUsed += use;
  }
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace < 0) continue;
    if (isWorkplace(city, workplace)) jobs += 1;
  }
  const produced = foodProductionFromStaff(city, staff);

  return {
    population,
    jobs,
    powerCapacity,
    powerUsed,
    waterCapacity,
    waterUsed,
    traffic: computeTraffic(city).score,
    funds: city.funds,
    foodCapacity: produced,
    foodUsed: foodNeed(population),
    foodStock: city.food,
  };
}

export function buildMeta(city: CityState): SimMeta {
  return {
    tick: city.tick,
    revision: city.revision,
    rng: city.rng >>> 0,
    funds: city.funds,
    demand: { ...city.demand },
    stats: computeStats(city),
    ledger: cityLedger(city),
    goals: city.goals >>> 0,
    food: city.food,
    ...(city.gen ? { gen: { ...city.gen } } : {}),
  };
}

export function refreshUtilities(city: CityState): void {
  city.utility.fill(0);
  supplyNetwork(city, ServiceKind.Power, POWER_BIT, POWER_CAPACITY, city.lines);
  supplyNetwork(city, ServiceKind.Water, WATER_BIT, WATER_CAPACITY, city.pipes);
}

function conducts(city: CityState, layer: Uint8Array, index: number, bit: number): boolean {
  if (isLink(layer, index)) return true;
  // Street lamps bridge power gaps and keep lines conducting through their cell.
  return bit === POWER_BIT && city.services[index] === ServiceKind.Lamp;
}

function supplyNetwork(city: CityState, kind: number, bit: number, capacityEach: number, layer: Uint8Array): void {
  const count = city.width * city.height;
  const sources: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (city.services[index] === kind) sources.push(index);
  }
  if (sources.length === 0) return;

  const distance = new Int16Array(count);
  distance.fill(-1);
  const queue: number[] = [];
  for (const source of sources) {
    // Sources themselves count as supplied (inspect/night light).
    city.utility[source] |= bit;
    const { x, y } = cellCoords(city, source);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(city, nx, ny)) continue;
      const next = cellIndex(city, nx, ny);
      if (conducts(city, layer, next, bit) && distance[next] < 0) {
        distance[next] = 0;
        queue.push(next);
      }
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const { x, y } = cellCoords(city, current);
    city.utility[current] |= bit;
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(city, nx, ny)) continue;
      const next = cellIndex(city, nx, ny);
      if (conducts(city, layer, next, bit) && distance[next] < 0) {
        distance[next] = distance[current] + 1;
        queue.push(next);
      }
    }
  }

  let remaining = 0;
  for (const source of sources) remaining += Math.round(capacityEach * (cellBudget(city, source) / 100));
  const seen = new Uint8Array(count);
  const groups: { cells: number[]; distance: number; use: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (seen[index] || isRoad(city, index)) continue;
    if (city.services[index] === ServiceKind.Airport) {
      seen[index] = 1;
      const reach = carrierDistance(city, index, layer, distance, kind);
      if (reach >= 0) groups.push({ cells: [index], distance: reach, use: 0 });
      continue;
    }
    if (city.zones[index] === Zone.None) continue;
    const cells: number[] = [];
    const pending = [index];
    seen[index] = 1;
    let use = 0;
    let reach = 9999;
    const zone = city.zones[index];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor];
      cells.push(current);
      if (city.levels[current] > 0) use += utilityUse(city.zones[current], city.levels[current]);
      const touch = carrierDistance(city, current, layer, distance, kind);
      if (touch >= 0) reach = Math.min(reach, touch);
      const spot = cellCoords(city, current);
      for (const dir of DIRS) {
        const nx = spot.x + dir.dx;
        const ny = spot.y + dir.dy;
        if (!inBounds(city, nx, ny)) continue;
        const next = cellIndex(city, nx, ny);
        if (seen[next] || city.zones[next] !== zone || isRoad(city, next)) continue;
        seen[next] = 1;
        pending.push(next);
      }
    }
    if (reach < 9999) groups.push({ cells, distance: reach, use });
  }

  groups.sort((a, b) => a.distance - b.distance || a.cells[0] - b.cells[0]);
  for (const group of groups) {
    // Free consumers (airport) still need leftover capacity; don't light them at 0.
    if (remaining <= 0) continue;
    if (group.use > remaining) continue;
    for (const cell of group.cells) city.utility[cell] |= bit;
    remaining -= group.use;
  }
}

function carrierDistance(city: CityState, index: number, layer: Uint8Array, distance: Int16Array, kind: number): number {
  const { x, y } = cellCoords(city, index);
  const power = kind === ServiceKind.Power;
  let best = 9999;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(city, nx, ny)) continue;
      const carrier = cellIndex(city, nx, ny);
      if (city.services[carrier] === kind) best = Math.min(best, 0);
      const linked = (layer[carrier] & ROAD_FLAG) !== 0 || (power && city.services[carrier] === ServiceKind.Lamp);
      if (linked && distance[carrier] >= 0) {
        best = Math.min(best, distance[carrier] + Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
  }
  return best === 9999 ? -1 : best;
}

export function staffCounts(city: CityState): Uint16Array {
  const filled = new Uint16Array(city.levels.length);
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace >= 0 && workplace < filled.length) filled[workplace] += 1;
  }
  return filled;
}

export function farmYield(city: CityState, index: number, workers: number): number {
  if (city.zones[index] !== Zone.Farm || city.levels[index] <= 0 || workers <= 0) return 0;
  const bits = city.utility[index] & (POWER_BIT | WATER_BIT);
  const utility = bits === (POWER_BIT | WATER_BIT) ? 1 : bits === 0 ? 0.4 : 0.7;
  const farm = farmStatus(city, index);
  const mult = farm?.yieldMult ?? 1;
  return Math.max(0, Math.round(workers * FOOD_PER_WORKER * utility * (cellBudget(city, index) / 100) * mult));
}

export function foodProduction(city: CityState): number {
  return foodProductionFromStaff(city, staffCounts(city));
}

function foodProductionFromStaff(city: CityState, staff: Uint16Array): number {
  let total = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    total += farmYield(city, index, staff[index] ?? 0);
  }
  return total;
}

export function foodRatio(city: CityState): number {
  let population = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] === Zone.Residential && city.levels[index] > 0) population += city.levels[index] * 12;
  }
  const need = foodNeed(population);
  if (need <= 0) return 1;
  return Math.max(0, Math.min(1, (foodProduction(city) + city.food) / need));
}

function settleFood(city: CityState): void {
  const produced = foodProduction(city);
  let population = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] === Zone.Residential && city.levels[index] > 0) population += city.levels[index] * 12;
  }
  const need = foodNeed(population);
  const available = city.food + produced;
  city.food = Math.max(0, Math.min(FOOD_STOCK_MAX, available - need));
}

function coverage(city: CityState, kind: number): { x: number; y: number; radius: number }[] {
  const found: { x: number; y: number; radius: number }[] = [];
  const info = serviceInfo(kind);
  if (!info || info.radius <= 0) return found;
  for (let index = 0; index < city.services.length; index += 1) {
    if (city.services[index] !== kind) continue;
    const { x, y } = cellCoords(city, index);
    found.push({ x, y, radius: Math.max(2, Math.round(info.radius * (cellBudget(city, index) / 100))) });
  }
  return found;
}

function insideCoverage(city: CityState, index: number, spots: { x: number; y: number; radius: number }[]): boolean {
  const { x, y } = cellCoords(city, index);
  return spots.some((spot) => Math.max(Math.abs(spot.x - x), Math.abs(spot.y - y)) <= spot.radius);
}

function updateDemand(city: CityState): void {
  let population = 0;
  let commercial = 0;
  let industrial = 0;
  let parks = 0;
  let farms = 0;
  const count = city.width * city.height;
  for (let index = 0; index < count; index += 1) {
    if (city.services[index] === ServiceKind.Park) parks += 1;
    const level = city.levels[index];
    if (level <= 0) continue;
    if (city.zones[index] === Zone.Residential) population += level * 12;
    if (city.zones[index] === Zone.Commercial) commercial += level;
    if (city.zones[index] === Zone.Industrial) industrial += level;
    if (city.zones[index] === Zone.Farm) farms += 1;
  }

  const residentialTarget = clampDemand(72 - population * 0.12 + commercial * 2 + industrial * 3 + parks * 4 + farms * 3);
  const commercialTarget = clampDemand(48 + population * 0.05 - commercial * 5);
  const industrialTarget = clampDemand(42 + population * 0.03 + commercial * 0.4 - industrial * 4);
  city.demand.residential = clampDemand(city.demand.residential * 0.75 + residentialTarget * 0.25);
  city.demand.commercial = clampDemand(city.demand.commercial * 0.75 + commercialTarget * 0.25);
  city.demand.industrial = clampDemand(city.demand.industrial * 0.75 + industrialTarget * 0.25);
}

export function maintenanceCost(city: CityState): number {
  const police = coverage(city, ServiceKind.Police);
  const fires = coverage(city, ServiceKind.Fire);
  let total = 0;
  for (let index = 0; index < city.services.length; index += 1) {
    const info = serviceInfo(city.services[index]);
    if (info) total += Math.round(info.upkeep * (cellBudget(city, index) / 100));
    const level = city.levels[index];
    if (level <= 0) continue;
    const zone = city.zones[index];
    const rate = zone === Zone.Industrial ? 3 : zone === Zone.Commercial ? 2 : zone === Zone.Residential ? 1.5 : zone === Zone.Farm ? 2 : 0;
    if (rate === 0) continue;
    let factor = insideCoverage(city, index, police) ? 0.75 : 1;
    if (zone === Zone.Industrial && insideCoverage(city, index, fires)) factor *= 0.8;
    total += Math.round(level * rate * (cellBudget(city, index) / 100) * factor);
  }
  return total;
}

export function cityLedger(city: CityState): { income: number; upkeep: number } {
  const clinics = coverage(city, ServiceKind.Clinic);
  const parks = coverage(city, ServiceKind.Park);
  const fires = coverage(city, ServiceKind.Fire);
  const meals = foodRatio(city);
  let income = 0;
  for (let index = 0; index < city.services.length; index += 1) {
    if (city.services[index] !== ServiceKind.Airport) continue;
    income += Math.round(AIRPORT_INCOME * (cellBudget(city, index) / 100));
  }
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] !== Zone.Residential || city.levels[index] <= 0) continue;
    const bits = city.utility[index] & (POWER_BIT | WATER_BIT);
    const utility = bits === (POWER_BIT | WATER_BIT) ? 1 : bits === 0 ? 0.15 : 0.45;
    let district = 1;
    if (insideCoverage(city, index, clinics)) district += 0.25;
    if (insideCoverage(city, index, parks)) district += 0.15;
    const education = 1 + (city.skills[index] & 3) * 0.22;
    income += city.levels[index] * 12 * 1.5 * utility * district * education * (0.72 + 0.28 * meals) * (cellBudget(city, index) / 100);
  }
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace < 0 || !isWorkplace(city, workplace)) continue;
    const zone = city.zones[workplace];
    const bits = city.utility[workplace] & (POWER_BIT | WATER_BIT);
    const home = Math.floor(index / POST_SLOTS);
    const education = city.skills[home] & 3;
    const skill = zone === Zone.Commercial ? 1 + education * 0.45 : 1 + education * 0.12;
    if (zone === Zone.Farm) {
      const utility = bits === (POWER_BIT | WATER_BIT) ? 1 : bits === 0 ? 0.5 : 0.75;
      const farm = farmStatus(city, workplace);
      const herd = farm?.livestock ? 1.25 : 1;
      income += 9 * skill * utility * herd * (cellBudget(city, workplace) / 100);
      continue;
    }
    if (bits === 0) continue;
    const utility = bits === (POWER_BIT | WATER_BIT) ? 1 : 0.4;
    const trade = zone === Zone.Industrial && insideCoverage(city, workplace, fires) ? 1.2 : 1;
    const base = zone === Zone.Industrial ? 16 : 12;
    income += base * skill * utility * trade * (cellBudget(city, workplace) / 100);
  }
  return { income: Math.floor(income), upkeep: maintenanceCost(city) };
}

function educate(city: CityState): void {
  const schools = coverage(city, ServiceKind.School);
  const universities = coverage(city, ServiceKind.University);
  for (let index = 0; index < city.skills.length; index += 1) {
    if (city.zones[index] !== Zone.Residential || city.levels[index] <= 0) continue;
    let education = city.skills[index] & 3;
    const scholarship = (city.skills[index] & 4) !== 0;
    if (insideCoverage(city, index, schools) && education < 1 && nextRand(city) < 0.45) education = 1;
    if (insideCoverage(city, index, universities) && education === 1 && nextRand(city) < 0.35) education = 2;
    if (scholarship && universities.length > 0) education = 2;
    city.skills[index] = education | (scholarship ? 4 : 0);
  }
}

export function stepSimulation(city: CityState): void {
  city.tick += 1;
  refreshUtilities(city);
  claimGoals(city);
  if (city.tick % GROWTH_EVERY === 0) {
    updateDemand(city);
    educate(city);
    const ledger = cityLedger(city);
    city.funds = Math.max(0, Math.min(5_000_000, city.funds + ledger.income - ledger.upkeep));
    settleFood(city);
  }
  city.revision += 1;
}
