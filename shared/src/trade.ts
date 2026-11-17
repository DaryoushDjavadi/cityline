import { AIRPORT_INCOME, FOOD_STOCK_MAX, HARBOR_INCOME, tradeDeal, type TradeDeal } from "./catalog.ts";
import { ROAD_FLAG, cellCoords, inBounds } from "./grid.ts";
import { POWER_BIT, ServiceKind, WATER_BIT, Zone, type ApplyResult, type CityState } from "./types.ts";

function isRoadCell(city: CityState, index: number): boolean {
  return index >= 0 && index < city.roads.length && (city.roads[index] & ROAD_FLAG) !== 0;
}

export const TOURISM_INCOME = 85;
export const LOGISTICS_RANGE = 14;
export const LOGISTICS_ROAD = 28;
export const AIRPORT_JOBS = 4;
export const HARBOR_JOBS = 6;
export const HARBOR_FOOD_PER_WORKER = 2;
export const MARKET_HEAT_MAX = 100;
export const MARKET_DECAY = 7;
export const AIRPORT_SLOTS = 2;
export const HARBOR_SLOTS = 5;
export const AIRPORT_DELAY = 0;
export const HARBOR_DELAY = 6;
export const SYNERGY_IMPORT = 0.88;
export const SYNERGY_EXPORT = 1.08;

export interface Shipment {
  cell: number;
  due: number;
  money: number;
  food: number;
}

export type HubId = "airport" | "harbor";

export interface TradeQuote {
  id: string;
  name: string;
  side: "import" | "export";
  hub: HubId;
  delay: number;
  slots: number;
  used: number;
  listPrice: number;
  price: number;
  food: number;
  volume: number;
  detail: string;
  blurb: string;
}

export function isHub(city: CityState, index: number): boolean {
  const kind = city.services[index];
  return kind === ServiceKind.Airport || kind === ServiceKind.Harbor;
}

export function hubId(city: CityState, index: number): HubId | null {
  if (city.services[index] === ServiceKind.Airport) return "airport";
  if (city.services[index] === ServiceKind.Harbor) return "harbor";
  return null;
}

export function hubJobs(city: CityState, index: number): number {
  if (city.services[index] === ServiceKind.Airport) return AIRPORT_JOBS;
  if (city.services[index] === ServiceKind.Harbor) return HARBOR_JOBS;
  return 0;
}

export function hubSlots(city: CityState, index: number): number {
  const kind = hubId(city, index);
  if (!kind) return 0;
  const extra = logisticsPartner(city, index) !== null ? 1 : 0;
  return (kind === "harbor" ? HARBOR_SLOTS : AIRPORT_SLOTS) + extra;
}

export function pendingAt(city: CityState, index: number): number {
  return (city.shipments ?? []).filter((entry) => entry.cell === index).length;
}

export function marketMultiplier(heat: number): number {
  const safe = Math.max(0, Math.min(MARKET_HEAT_MAX, heat));
  return 1 / (1 + safe / 38);
}

export function exportHeatGain(deal: TradeDeal, hub: HubId): number {
  const bulk = hub === "harbor" ? 2 : 1;
  if (deal.requires === "food") return 10 * bulk;
  if (deal.requires === "commercial") return 8 * bulk;
  if (deal.requires === "industrial") return 9 * bulk;
  return 6 * bulk;
}

export function decayMarket(city: CityState): void {
  city.tradeHeat = Math.max(0, (city.tradeHeat ?? 0) - MARKET_DECAY);
}

export function settleShipments(city: CityState): void {
  const pending = city.shipments ?? [];
  if (pending.length === 0) return;
  const keep: Shipment[] = [];
  for (const entry of pending) {
    if (city.tick < entry.due) {
      keep.push(entry);
      continue;
    }
    if (entry.food > 0) city.food = Math.min(FOOD_STOCK_MAX, city.food + entry.food);
    if (entry.money > 0) city.funds = Math.min(5_000_000, city.funds + entry.money);
  }
  city.shipments = keep;
}

function zonePresent(city: CityState, zone: number): boolean {
  for (let index = 0; index < city.zones.length; index += 1) {
    if (city.zones[index] === zone && city.levels[index] > 0) return true;
  }
  return false;
}

function bulk(hub: HubId): number {
  return hub === "harbor" ? 2 : 1;
}

export function quoteTrade(city: CityState, index: number, deal: TradeDeal): TradeQuote | null {
  const hub = hubId(city, index);
  if (!hub) return null;
  const linked = logisticsPartner(city, index) !== null;
  const volume = bulk(hub);
  const food = (deal.food ?? 0) * volume;
  let price = deal.price * volume;
  if (hub === "harbor") price *= deal.side === "import" ? 0.78 : 0.72;
  else price *= deal.side === "import" ? 1 : 1;
  if (linked) price *= deal.side === "import" ? SYNERGY_IMPORT : SYNERGY_EXPORT;
  if (deal.side === "export") price *= marketMultiplier(city.tradeHeat ?? 0);
  price = Math.max(4, Math.round(price));
  const delay = hub === "harbor" ? (linked ? HARBOR_DELAY - 2 : HARBOR_DELAY) : AIRPORT_DELAY;
  const listPrice = Math.round(deal.price * volume);
  const unit = deal.food ? Math.abs(food) : volume;
  const delayLabel = delay <= 0 ? "sofort" : `${delay} Ticks`;
  const detail = deal.food
    ? `${food > 0 ? "+" : ""}${food} Nahrung · ${delayLabel}`
    : `${hub === "harbor" ? "Bulk" : "Express"} · ${delayLabel}`;
  return {
    id: deal.id,
    name: deal.name,
    side: deal.side,
    hub,
    delay,
    slots: hubSlots(city, index),
    used: pendingAt(city, index),
    listPrice,
    price,
    food,
    volume: unit,
    detail,
    blurb: deal.blurb,
  };
}

export function tradeBlockReason(city: CityState, index: number, dealId: string): string | null {
  if (!isHub(city, index)) return "Nur Flughafen oder Hafen handeln.";
  const deal = tradeDeal(dealId);
  if (!deal) return "Unbekanntes Geschäft.";
  const quote = quoteTrade(city, index, deal);
  if (!quote) return "Unbekanntes Geschäft.";
  if (quote.used >= quote.slots) return `Alle ${quote.slots} Handelsplätze sind belegt. Warte auf laufende Lieferungen.`;
  if (deal.side === "import") {
    if (city.funds < quote.price) return `Zu wenig Geld (braucht ${quote.price.toLocaleString("de-DE")} €).`;
    if (quote.food > 0 && city.food + quote.food > FOOD_STOCK_MAX) {
      return `Nahrungsspeicher voll (noch ${Math.max(0, FOOD_STOCK_MAX - city.food)} frei).`;
    }
    return null;
  }
  if (deal.requires === "food") {
    const need = Math.abs(quote.food);
    if (city.food < need) return `Zu wenig Nahrung (braucht ${need}).`;
    return null;
  }
  if (deal.requires === "commercial" && !zonePresent(city, Zone.Commercial)) return "Braucht ein Gewerbe in der Stadt.";
  if (deal.requires === "industrial" && !zonePresent(city, Zone.Industrial)) return "Braucht eine Industrie in der Stadt.";
  return null;
}

export function applyHubTrade(city: CityState, index: number, dealId: string): ApplyResult {
  const applied = [index];
  const rejected: number[] = [];
  const blocked = tradeBlockReason(city, index, dealId);
  if (blocked) {
    const reason = blocked.includes("Geld") ? "funds"
      : blocked.includes("voll") ? "stock_full"
      : blocked.includes("Nahrung") ? "no_stock"
      : blocked.includes("Gewerbe") || blocked.includes("Industrie") ? "no_market"
      : blocked.includes("Handelsplätze") ? "busy"
      : "rejected";
    return { ok: false, reason, spent: 0, applied: [], rejected: [index] };
  }
  const deal = tradeDeal(dealId)!;
  const quote = quoteTrade(city, index, deal)!;
  if (deal.side === "import") {
    city.funds -= quote.price;
    if (quote.delay <= 0) {
      if (quote.food > 0) city.food = Math.min(FOOD_STOCK_MAX, city.food + quote.food);
    } else {
      city.shipments = [...(city.shipments ?? []), { cell: index, due: city.tick + quote.delay, money: 0, food: quote.food }];
    }
    city.revision += 1;
    return { ok: true, spent: quote.price, applied, rejected };
  }
  if (deal.requires === "food") city.food -= Math.abs(quote.food);
  city.tradeHeat = Math.min(MARKET_HEAT_MAX, (city.tradeHeat ?? 0) + exportHeatGain(deal, quote.hub));
  if (quote.delay <= 0) {
    city.funds = Math.min(5_000_000, city.funds + quote.price);
    city.revision += 1;
    return { ok: true, spent: 0, applied, rejected, bonus: quote.price };
  }
  city.shipments = [...(city.shipments ?? []), { cell: index, due: city.tick + quote.delay, money: quote.price, food: 0 }];
  city.revision += 1;
  return { ok: true, spent: 0, applied, rejected, bonus: quote.price };
}

export function logisticsPartner(city: CityState, index: number): number | null {
  const self = hubId(city, index);
  if (!self) return null;
  const want = self === "airport" ? ServiceKind.Harbor : ServiceKind.Airport;
  const here = cellCoords(city, index);
  let best: number | null = null;
  let bestDist = 9999;
  for (let cell = 0; cell < city.services.length; cell += 1) {
    if (city.services[cell] !== want) continue;
    const spot = cellCoords(city, cell);
    const chebyshev = Math.max(Math.abs(spot.x - here.x), Math.abs(spot.y - here.y));
    if (chebyshev <= LOGISTICS_RANGE || roadDistance(city, index, cell) <= LOGISTICS_ROAD) {
      if (chebyshev < bestDist) {
        best = cell;
        bestDist = chebyshev;
      }
    }
  }
  return best;
}

function roadDistance(city: CityState, from: number, to: number): number {
  const count = city.width * city.height;
  const dist = new Int16Array(count);
  dist.fill(-1);
  const queue: number[] = [];
  const startRoads = neighborsRoad(city, from);
  for (const cell of startRoads) {
    dist[cell] = 0;
    queue.push(cell);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    if (dist[current] > LOGISTICS_ROAD) continue;
    const { x, y } = cellCoords(city, current);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(city, nx, ny)) continue;
      const next = ny * city.width + nx;
      if (dist[next] >= 0) continue;
      if (!isRoadCell(city, next)) continue;
      dist[next] = dist[current] + 1;
      queue.push(next);
    }
  }
  const goalRoads = neighborsRoad(city, to);
  let best = 9999;
  for (const cell of goalRoads) {
    if (dist[cell] >= 0) best = Math.min(best, dist[cell]);
  }
  return best;
}

function neighborsRoad(city: CityState, index: number): number[] {
  const { x, y } = cellCoords(city, index);
  const found: number[] = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(city, nx, ny)) continue;
    const next = ny * city.width + nx;
    if (isRoadCell(city, next)) found.push(next);
  }
  return found;
}

export function harborYield(city: CityState, index: number, workers: number): number {
  if (city.services[index] !== ServiceKind.Harbor || workers <= 0) return 0;
  const bits = city.utility[index] & (POWER_BIT | WATER_BIT);
  const utility = bits === (POWER_BIT | WATER_BIT) ? 1 : bits === 0 ? 0.35 : 0.65;
  const budget = city.budget[index] >= 50 && city.budget[index] <= 150 ? city.budget[index] : 100;
  return Math.max(0, Math.round(workers * HARBOR_FOOD_PER_WORKER * utility * (budget / 100)));
}

export function hubIncome(city: CityState, index: number): number {
  const kind = hubId(city, index);
  if (!kind) return 0;
  const budget = city.budget[index] >= 50 && city.budget[index] <= 150 ? city.budget[index] : 100;
  const base = kind === "harbor" ? HARBOR_INCOME : AIRPORT_INCOME;
  const linked = logisticsPartner(city, index) !== null;
  const tourism = linked ? TOURISM_INCOME : 0;
  return Math.round((base + tourism) * (budget / 100));
}

export function cloneShipments(list: Shipment[] | undefined): Shipment[] {
  return (list ?? []).map((entry) => ({ cell: entry.cell, due: entry.due, money: entry.money, food: entry.food }));
}
