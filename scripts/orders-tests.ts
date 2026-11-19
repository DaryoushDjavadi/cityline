/**
 * Auftragstafel (Lieferaufträge): generation, production, delivery, express,
 * expiry, skip, determinism, meta/save round-trip, old saves, protocol.
 *   npx tsx scripts/orders-tests.ts
 */
import {
  BIG_ORDER_TICKS,
  EXPRESS_BONUS,
  ORDERS_UNLOCK_POP,
  ORDER_REFILL,
  ORDER_SKIP_WAIT,
  ORDER_TICKS,
  POWER_BIT,
  ServiceKind,
  Zone,
  applyCommand,
  availableGoods,
  buildMeta,
  canDeliver,
  cellIndex,
  cityToSave,
  createCity,
  ensureBoard,
  packCells,
  parseCommand,
  saveToCity,
  stepOrders,
  stepSimulation,
  writeCity,
  type CityState,
} from "../shared/src/index.ts";

let checks = 0;
function ok(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) throw new Error(message);
}

/** A town with homes, powered industry and a harbor cell (no full sim needed). */
function town(seed = 5): CityState {
  const city = createCity(32, 32, { seed, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  city.terrain.fill(0);
  city.funds = 50_000;
  for (let x = 2; x < 12; x += 1) {
    const i = cellIndex(city, x, 4);
    city.zones[i] = Zone.Residential;
    city.levels[i] = 2;
  }
  for (let x = 2; x < 5; x += 1) {
    const i = cellIndex(city, x, 8);
    city.zones[i] = Zone.Industrial;
    city.levels[i] = 3;
    city.utility[i] |= POWER_BIT;
  }
  city.services[cellIndex(city, 20, 20)] = ServiceKind.Harbor;
  return city;
}

function steps(city: CityState, n: number): void {
  for (let k = 0; k < n; k += 1) {
    city.tick += 1;
    stepOrders(city);
  }
}

// 1. Tiny villages get no orders; the board unlocks with population.
{
  const city = town();
  city.levels.fill(0);
  steps(city, 80);
  const board = ensureBoard(city);
  ok(board.slots.every((order) => order === null), "no orders below unlock population");
  ok(ORDERS_UNLOCK_POP > 0, "unlock threshold");
}

// 2. Orders appear, only for goods the city can make; production fills stock.
{
  const city = town();
  city.food = 0;
  steps(city, 60);
  const board = ensureBoard(city);
  const orders = board.slots.filter(Boolean);
  ok(orders.length === 3, `three orders on the board (${orders.length})`);
  const goods = availableGoods(city);
  ok(!goods.includes("food") && goods.includes("goods") && goods.includes("fish"), `available goods ${goods}`);
  for (const order of orders) {
    ok(order!.lines.every((line) => line.good !== "food"), "no food orders without farms/food");
    ok(order!.reward > 0 && order!.until - order!.at >= ORDER_TICKS, "reward and timer set");
  }
  ok(board.goods > 0 && board.fish > 0, `industry/harbor produce stock (${board.goods}/${board.fish})`);
}

// 3. Deliver: consumes stock, pays reward (+express), refills later; double delivery rejected.
{
  const city = town();
  steps(city, 60);
  const board = ensureBoard(city);
  board.goods = 5000;
  board.fish = 5000;
  city.food = 5000;
  const slot = board.slots.findIndex(Boolean);
  const order = board.slots[slot]!;
  // still within the express window
  city.tick = order.at + 1;
  const funds = city.funds;
  const goods = board.goods;
  const result = applyCommand(city, { type: "order", slot, id: order.id, action: "deliver" });
  ok(result.ok, `deliver ok (${result.reason})`);
  ok(city.funds === funds + Math.round(order.reward * (1 + EXPRESS_BONUS)), "express reward paid");
  const usedGoods = order.lines.filter((l) => l.good === "goods").reduce((s, l) => s + l.amount, 0);
  ok(board.goods === goods - usedGoods, "goods consumed");
  ok(board.slots[slot] === null && board.done === 1 && board.lastDone?.express, "slot cleared, tally, express flag");
  ok(city.progress!.last?.kind === "order", "toast for every client");
  const again = applyCommand(city, { type: "order", slot, id: order.id, action: "deliver" });
  ok(!again.ok && again.reason === "order_gone", "second delivery (coop race) rejected");
  steps(city, ORDER_REFILL + 1);
  ok(board.slots[slot] !== null && board.slots[slot]!.id !== order.id, "slot refilled with a new order");
}

// 4. Missing goods: no delivery, no money.
{
  const city = town();
  steps(city, 60);
  const board = ensureBoard(city);
  board.goods = 0;
  board.fish = 0;
  city.food = 0;
  const slot = board.slots.findIndex(Boolean);
  const order = board.slots[slot]!;
  ok(!canDeliver(city, board, order), "cannot deliver without stock");
  const funds = city.funds;
  const result = applyCommand(city, { type: "order", slot, id: order.id, action: "deliver" });
  ok(!result.ok && result.reason === "missing_goods" && city.funds === funds, "rejected without stock");
}

// 5. Normal (late) delivery pays the base reward.
{
  const city = town();
  steps(city, 60);
  const board = ensureBoard(city);
  board.goods = 5000;
  board.fish = 5000;
  const slot = board.slots.findIndex(Boolean);
  const order = board.slots[slot]!;
  city.tick = order.until - 2;
  const funds = city.funds;
  ok(applyCommand(city, { type: "order", slot, id: order.id, action: "deliver" }).ok, "late deliver ok");
  ok(city.funds === funds + order.reward, "base reward without express");
}

// 6. Expiry and skip.
{
  const city = town();
  steps(city, 60);
  const board = ensureBoard(city);
  const order = board.slots[0]!;
  steps(city, Math.max(ORDER_TICKS, BIG_ORDER_TICKS) + 2);
  ok(board.missed >= 1, "expired order counted as missed");
  ok(!board.slots.some((o) => o?.id === order.id), "expired order removed");
  const slot = board.slots.findIndex(Boolean);
  const next = board.slots[slot]!;
  ok(applyCommand(city, { type: "order", slot, id: next.id, action: "skip" }).ok, "skip ok");
  ok(board.slots[slot] === null && board.refill[slot] === city.tick + ORDER_SKIP_WAIT, "skip waits before refill");
}

// 7. Deterministic: two copies (solo worker vs. coop server) produce the same board.
{
  const a = town(7);
  const b = town(7);
  steps(a, 400);
  steps(b, 400);
  ok(JSON.stringify(a.progress!.orders) === JSON.stringify(b.progress!.orders), "deterministic board");
}

// 8. Meta + save round-trip, sanitizing, old saves without orders.
{
  const city = town();
  steps(city, 60);
  const meta = JSON.parse(JSON.stringify(buildMeta(city)));
  const mirror = createCity(32, 32);
  writeCity(mirror, packCells(city), meta);
  ok(JSON.stringify(mirror.progress!.orders) === JSON.stringify(city.progress!.orders), "orders survive meta round-trip");
  const save = saveToCity(JSON.parse(JSON.stringify(cityToSave(city, "Tafel"))));
  ok(JSON.stringify(save!.progress!.orders) === JSON.stringify(city.progress!.orders), "orders survive save round-trip");
  const evil = { ...meta, progress: { ...meta.progress, orders: { slots: [{ id: 1, lines: [{ good: "gold", amount: 5 }], reward: 1e12 }, "x", { id: 2, lines: [{ good: "fish", amount: -4 }], reward: 1e12 }], goods: -9, fish: 1e9 } } };
  writeCity(mirror, packCells(city), evil);
  const board = mirror.progress!.orders!;
  ok(board.slots.length === 3 && board.slots[0] === null && board.slots[1] === null, "bad orders dropped");
  ok(board.slots[2]!.lines[0].amount >= 1 && board.slots[2]!.reward <= 1_000_000, "amounts/rewards clamped");
  ok(board.goods === 0 && board.fish <= 9999, "stock clamped");
  // old save: progress without orders → board created on the next step
  const old = JSON.parse(JSON.stringify(cityToSave(city, "Alt")));
  delete old.meta.progress.orders;
  const loaded = saveToCity(old)!;
  ok(loaded.progress && !loaded.progress.orders, "old save loads without orders");
  stepSimulation(loaded);
  ok(loaded.progress!.orders && loaded.progress!.orders.slots.length === 3, "board created for old save");
  // even older save: no progress at all
  delete old.meta.progress;
  const ancient = saveToCity(old)!;
  stepSimulation(ancient);
  ok(ancient.progress?.orders, "board created for pre-progress save");
}

// 9. Protocol whitelists the order command and rejects junk (coop server input).
{
  ok(parseCommand({ type: "order", slot: 1, id: 4, action: "deliver" })?.type === "order", "parse deliver");
  ok(parseCommand({ type: "order", slot: 2, id: 4, action: "skip" })?.type === "order", "parse skip");
  ok(parseCommand({ type: "order", slot: 3, id: 4, action: "deliver" }) === null, "slot range");
  ok(parseCommand({ type: "order", slot: 0, id: 1.5, action: "deliver" }) === null, "integer id");
  ok(parseCommand({ type: "order", slot: 0, id: 1, action: "steal" }) === null, "action whitelist");
}

// 10. Level rooms (progress off) have no board.
{
  const city = town();
  steps(city, 2);
  city.progress!.off = true;
  const board = ensureBoard(city);
  const before = JSON.stringify(board);
  steps(city, 100);
  ok(JSON.stringify(board) === before, "no board activity in level rooms");
  const order = board.slots.find(Boolean);
  if (order) ok(!applyCommand(city, { type: "order", slot: 0, id: order.id, action: "deliver" }).ok, "no delivery in level rooms");
}

console.log(`orders-tests: ${checks} checks ok`);
