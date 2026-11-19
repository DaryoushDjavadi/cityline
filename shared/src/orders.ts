/**
 * Auftragstafel – Hay-Day-style delivery orders.
 *
 * Three cards with a customer, 1–2 goods, a timer and a reward. Food comes from
 * the city food store (farms/imports), Waren from powered industry, Fisch from
 * harbors. Everything is deterministic from the tick and map seed so the solo
 * worker and the coop server (authoritative) produce identical boards.
 */
import { POWER_BIT, ServiceKind, Zone, type ApplyResult, type CityState } from "./types.ts";
import {
  ORDER_SLOTS,
  ensureProgress,
  type DeliveryOrder,
  type OrderBoard,
  type OrderGood,
  type OrderLine,
} from "./progressState.ts";

export const ORDERS_UNLOCK_POP = 24;
export const ORDER_TICKS = 360;
export const BIG_ORDER_TICKS = 600;
export const ORDER_REFILL = 40;
export const ORDER_SKIP_WAIT = 120;
export const ORDER_PRODUCE_EVERY = 20;
/** Delivered within this share of the timer → express bonus. */
export const EXPRESS_SHARE = 0.4;
export const EXPRESS_BONUS = 0.3;
const STOCK_CAP = 999;

export const GOOD_INFO: Record<OrderGood, { name: string; unit: string; price: number; icon: string }> = {
  food: { name: "Nahrung", unit: "Kisten", price: 38, icon: "🥖" },
  goods: { name: "Waren", unit: "Pakete", price: 52, icon: "📦" },
  fish: { name: "Fisch", unit: "Kisten", price: 66, icon: "🐟" },
};

export const ORDER_CUSTOMERS: { name: string; wants: OrderGood[]; line: string }[] = [
  { name: "Bäckerei Holm", wants: ["food"], line: "Mehl und Butter für die Frühschicht!" },
  { name: "Schulmensa", wants: ["food", "fish"], line: "Die Kinder haben Hunger." },
  { name: "Markthalle", wants: ["food", "goods", "fish"], line: "Samstag ist Markttag." },
  { name: "Hafenkantine", wants: ["fish", "food"], line: "Die Crew vom Frachter will essen." },
  { name: "Baumarkt Berger", wants: ["goods"], line: "Die Regale sind leer." },
  { name: "Möbelhaus Adler", wants: ["goods"], line: "Neue Sofas für die Neubauten." },
  { name: "Reederei Kranz", wants: ["goods", "fish"], line: "Ladung fürs Festland." },
  { name: "Restaurant Seeblick", wants: ["fish", "food"], line: "Heute Abend Fischplatte." },
  { name: "Stadtfest-Komitee", wants: ["food", "goods"], line: "Das Fest braucht Nachschub." },
  { name: "Krankenhausküche", wants: ["food"], line: "Gesundes Essen für Station 3." },
];

function mix(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function freshBoard(tick: number): OrderBoard {
  return {
    slots: Array.from({ length: ORDER_SLOTS }, () => null),
    // Stagger the first cards so the board fills up with a little rhythm.
    refill: Array.from({ length: ORDER_SLOTS }, (_, slot) => tick + slot * 12),
    goods: 0,
    fish: 0,
    seq: 0,
    done: 0,
    missed: 0,
    earned: 0,
    lastDone: null,
  };
}

export function ensureBoard(city: CityState): OrderBoard {
  const p = ensureProgress(city);
  if (!p.orders) p.orders = freshBoard(city.tick);
  return p.orders;
}

export interface Producers {
  population: number;
  farms: number;
  industry: number;
  harbors: number;
}

export function orderProducers(city: CityState): Producers {
  let population = 0;
  let farms = 0;
  let industry = 0;
  let harbors = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    const level = city.levels[index];
    const zone = city.zones[index];
    if (level > 0) {
      if (zone === Zone.Residential) population += level * 12;
      else if (zone === Zone.Farm) farms += 1;
      else if (zone === Zone.Industrial && (city.utility[index] & POWER_BIT) !== 0) industry += level;
    }
    if (city.services[index] === ServiceKind.Harbor) harbors += 1;
  }
  return { population, farms, industry, harbors };
}

/** Goods the city can currently produce (only those get ordered). */
export function availableGoods(city: CityState, producers = orderProducers(city)): OrderGood[] {
  const goods: OrderGood[] = [];
  if (producers.farms > 0 || city.food >= 20) goods.push("food");
  if (producers.industry > 0) goods.push("goods");
  if (producers.harbors > 0) goods.push("fish");
  return goods;
}

export function stockOf(city: CityState, board: OrderBoard, good: OrderGood): number {
  if (good === "food") return Math.max(0, Math.floor(city.food));
  return Math.floor(good === "goods" ? board.goods : board.fish);
}

export function canDeliver(city: CityState, board: OrderBoard, order: DeliveryOrder): boolean {
  return order.lines.every((line) => stockOf(city, board, line.good) >= line.amount);
}

function round5(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

function lineAmount(good: OrderGood, population: number, big: boolean): number {
  const base = good === "food" ? 10 + population * 0.04 : good === "goods" ? 10 + population * 0.05 : 6 + population * 0.02;
  return round5(Math.min(400, base * (big ? 2.2 : 1)));
}

export function makeOrder(city: CityState, board: OrderBoard, slot: number, producers = orderProducers(city)): DeliveryOrder | null {
  const goods = availableGoods(city, producers);
  if (goods.length === 0) return null;
  const seed = (city.gen?.seed ?? 1) >>> 0;
  const id = board.seq + 1;
  const roll = mix(seed * 31 + id * 977 + slot * 13);
  const fitting = ORDER_CUSTOMERS.map((customer, index) => ({ customer, index })).filter(({ customer }) => customer.wants.some((good) => goods.includes(good)));
  const pick = fitting[roll % fitting.length];
  const wanted = pick.customer.wants.filter((good) => goods.includes(good));
  const big = board.done >= 2 && (roll >>> 8) % 5 === 0;
  const lines: OrderLine[] = [];
  const first = wanted[(roll >>> 4) % wanted.length];
  lines.push({ good: first, amount: lineAmount(first, producers.population, big) });
  if (wanted.length > 1 && (roll >>> 12) % 10 < 4) {
    const second = wanted.find((good) => good !== first);
    if (second) lines.push({ good: second, amount: round5(lineAmount(second, producers.population, big) * 0.6) });
  }
  const rank = city.progress?.rank ?? 0;
  const value = lines.reduce((sum, line) => sum + line.amount * GOOD_INFO[line.good].price, 0);
  const reward = Math.round((value * (1 + rank * 0.12) * (big ? 1.35 : 1)) / 10) * 10;
  return {
    id,
    who: pick.index,
    lines,
    reward,
    at: city.tick,
    until: city.tick + (big ? BIG_ORDER_TICKS : ORDER_TICKS),
    big,
  };
}

/** Called from stepProgress every tick: production, expiry and refills. */
export function stepOrders(city: CityState): void {
  const p = ensureProgress(city);
  if (p.off) return;
  const board = ensureBoard(city);
  const due = city.tick % ORDER_PRODUCE_EVERY === 0;
  const refillDue = board.slots.some((order, slot) => (!order && city.tick >= board.refill[slot]) || (order && city.tick >= order.until));
  if (!due && !refillDue) return;
  const producers = orderProducers(city);
  if (due) {
    board.goods = Math.min(STOCK_CAP, board.goods + producers.industry);
    board.fish = Math.min(STOCK_CAP, board.fish + producers.harbors * 4);
  }
  if (producers.population < ORDERS_UNLOCK_POP) return;
  for (let slot = 0; slot < ORDER_SLOTS; slot += 1) {
    const order = board.slots[slot];
    if (order && city.tick >= order.until) {
      board.slots[slot] = null;
      board.missed += 1;
      board.refill[slot] = city.tick + ORDER_REFILL;
      continue;
    }
    if (!order && city.tick >= board.refill[slot]) {
      const next = makeOrder(city, board, slot, producers);
      if (!next) {
        board.refill[slot] = city.tick + ORDER_REFILL;
        continue;
      }
      board.seq = next.id;
      board.slots[slot] = next;
    }
  }
}

export function isExpress(order: DeliveryOrder, tick: number): boolean {
  return tick - order.at <= (order.until - order.at) * EXPRESS_SHARE;
}

export function orderPayout(city: CityState, order: DeliveryOrder): { reward: number; express: boolean } {
  const express = isExpress(order, city.tick);
  const reward = express ? Math.round(order.reward * (1 + EXPRESS_BONUS)) : order.reward;
  return { reward, express };
}

/** Deliver or skip an order (shared by solo worker, client prediction and server). */
export function applyOrder(city: CityState, slot: number, id: number, action: "deliver" | "skip"): ApplyResult {
  const fail = (reason: string): ApplyResult => ({ ok: false, reason, spent: 0, applied: [], rejected: [] });
  const p = ensureProgress(city);
  if (p.off) return fail("orders_off");
  const board = ensureBoard(city);
  if (!Number.isInteger(slot) || slot < 0 || slot >= ORDER_SLOTS) return fail("bad_slot");
  const order = board.slots[slot];
  if (!order || order.id !== id) return fail("order_gone");
  if (action === "skip") {
    board.slots[slot] = null;
    board.refill[slot] = city.tick + ORDER_SKIP_WAIT;
    city.revision += 1;
    return { ok: true, spent: 0, applied: [], rejected: [] };
  }
  if (!canDeliver(city, board, order)) return fail("missing_goods");
  for (const line of order.lines) {
    if (line.good === "food") city.food = Math.max(0, city.food - line.amount);
    else if (line.good === "goods") board.goods = Math.max(0, board.goods - line.amount);
    else board.fish = Math.max(0, board.fish - line.amount);
  }
  const payout = orderPayout(city, order);
  city.funds = Math.max(0, Math.min(5_000_000, Math.round(city.funds + payout.reward)));
  board.slots[slot] = null;
  board.refill[slot] = city.tick + ORDER_REFILL;
  board.done += 1;
  board.earned += payout.reward;
  board.lastDone = { tick: city.tick, id: order.id, slot, who: order.who, reward: payout.reward, express: payout.express };
  const customer = ORDER_CUSTOMERS[order.who]?.name ?? "Kunde";
  p.last = {
    tick: city.tick,
    kind: "order",
    title: payout.express ? "Express-Lieferung!" : "Auftrag geliefert",
    text: `${customer} ist zufrieden.`,
    pay: payout.reward,
  };
  city.revision += 1;
  return { ok: true, spent: 0, applied: [], rejected: [], bonus: payout.reward };
}

/** Remaining time as share 0..1 and as an in-game "mm:ss" style label (real seconds at 2 ticks/s). */
export function orderTimeLeft(order: DeliveryOrder, tick: number): { share: number; seconds: number } {
  const total = Math.max(1, order.until - order.at);
  const left = Math.max(0, order.until - tick);
  return { share: left / total, seconds: Math.ceil(left / 2) };
}
