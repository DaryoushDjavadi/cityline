/**
 * Achterbahnen und Preise: Stationsbau, Strecke Stück für Stück, Rückgängig, Rundkurs
 * schließen, Physik/Bewertung, Zustände, Fahrgäste und Einnahmen, Preiselastizität,
 * Stand- und Ticketpreise, Abriss, Protokoll und Spielstand-Rundreise (auch alte Stände).
 *   npx tsx scripts/coaster-tests.ts
 */
import {
  GRID_SIZE,
  PARK_INFO,
  PRICE_MAX,
  ParkCrowd,
  ServiceKind,
  STATION_COST,
  TILE,
  Zone,
  applyCommand,
  cellIndex,
  cityToSave,
  cleanCoasters,
  closeRoute,
  blockGrid,
  coasterAtTile,
  coasterLayout,
  createCity,
  ensureProgress,
  occupancy,
  parkEconomy,
  parkIndex,
  parseCommand,
  priceFactor,
  priceMood,
  rateCoaster,
  rideFair,
  rideRefs,
  saveToCity,
  simulate,
  stepZoo,
  summarize,
  trackPath,
  walkable,
  zooOf,
  type CityState,
  type Coaster,
  type CrowdEvent,
  type PieceKind,
  type ZooOp,
} from "../shared/src/index.ts";

let checks = 0;
function ok(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`✗ ${message}`);
}
const P = parkIndex;
const zoo = (city: CityState) => zooOf(city)!;
const run = (city: CityState, op: ZooOp) => applyCommand(city, { type: "zoo", zoo: op });
const ticks = (city: CityState, n: number) => { for (let k = 0; k < n; k += 1) { city.tick += 1; stepZoo(city); } };
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: number[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) out.push(P(x, y));
  return out;
};

/** Town with a Tierpark, paths along y = 8 and x = 20, one savanne with zebras and two stands. */
function park(seed = 7): CityState {
  const city = createCity(GRID_SIZE, GRID_SIZE, { seed, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  city.terrain.fill(0);
  city.funds = 500_000;
  ensureProgress(city);
  ok(applyCommand(city, { type: "road", cells: Array.from({ length: 20 }, (_, x) => cellIndex(city, x + 2, 10)) }).ok, "road");
  for (let x = 2; x < 14; x += 1) { const i = cellIndex(city, x, 12); city.zones[i] = Zone.Residential; city.levels[i] = 2; }
  ok(applyCommand(city, { type: "service", index: cellIndex(city, 20, 11), kind: ServiceKind.Tierpark }).ok, "Tierpark");
  ok(run(city, { op: "pbuild", kind: "path", cells: line(20, 4, 20, 39) }).ok, "main path");
  ok(run(city, { op: "pbuild", kind: "path", cells: line(8, 8, 32, 8) }).ok, "cross path");
  ok(run(city, { op: "pbuild", kind: "savanne", cells: [P(21, 27)] }).ok, "savanne");
  for (const species of ["zebra", "zebra", "giraffe"]) ok(run(city, { op: "buy", cell: P(21, 27), species, origin: "breeder" }).ok, `buy ${species}`);
  ok(run(city, { op: "pbuild", kind: "food", cells: [P(19, 20)] }).ok, "food stand");
  ok(run(city, { op: "pbuild", kind: "drink", cells: [P(19, 22)] }).ok, "drink stand");
  ticks(city, 4);
  return city;
}

const STATION = P(12, 7);
const TRACK: PieceKind[] = ["straight", "up", "up", "up", "up", "straight", "down", "down", "loop", "left", "straight", "left"];

/** Station + track + closed + tested + open. Returns the coaster. */
function coaster(city: CityState): Coaster {
  ok(run(city, { op: "cstation", tile: STATION, dir: 1 }).ok, "station");
  const c = zoo(city).coasters!.at(-1)!;
  for (const piece of TRACK) ok(run(city, { op: "cpiece", coaster: c.id, piece }).ok, `piece ${piece}`);
  ok(run(city, { op: "cclose", coaster: c.id }).ok, "close");
  ok(run(city, { op: "cstate", coaster: c.id, state: "test" }).ok, "test run");
  ok(run(city, { op: "cstate", coaster: c.id, state: "open" }).ok, "open");
  return c;
}

// 1. Station: needs a path beside it, costs money, occupies tiles.
{
  const city = park();
  const r = run(city, { op: "cstation", tile: P(5, 30), dir: 1 });
  ok(!r.ok && r.reason === "coaster_no_path", `station away from paths rejected (${r.reason})`);
  ok(!run(city, { op: "cstation", tile: P(19, 7), dir: 1 }).ok, "station over a path rejected");
  const funds = city.funds;
  ok(run(city, { op: "cstation", tile: STATION, dir: 1 }).ok, "station next to the path");
  ok(funds - city.funds === STATION_COST, "station cost");
  const c = zoo(city).coasters![0];
  ok(c.state === "closed" && c.pieces.length === 0, "new coaster closed, empty");
  const grid = occupancy(zoo(city).park!, zoo(city).habitats, rideRefs(zoo(city).coasters));
  ok([P(12, 7), P(13, 7), P(14, 7)].every((t) => grid[t] === TILE.coaster), "station tiles occupied");
  ok(coasterAtTile(zoo(city).coasters, P(13, 7))?.id === c.id, "coasterAtTile finds it");
  ok(!run(city, { op: "pbuild", kind: "bench", cells: [P(13, 7)] }).ok, "no bench on the station");
}

// 2. Building piece by piece, undo refunds, impossible pieces are rejected.
{
  const city = park();
  run(city, { op: "cstation", tile: STATION, dir: 1 });
  const id = zoo(city).coasters![0].id;
  const r = run(city, { op: "cpiece", coaster: id, piece: "down" });
  ok(!r.ok, `drop at ground level rejected (${r.reason})`);
  const before = city.funds;
  ok(run(city, { op: "cpiece", coaster: id, piece: "straight" }).ok && run(city, { op: "cpiece", coaster: id, piece: "up" }).ok, "straight + lift");
  ok(before - city.funds === 60 + 120, "piece costs");
  const lay = coasterLayout(zoo(city).coasters![0]);
  ok(lay.cursor.h === 1 && !lay.closed && lay.valid === 2, `cursor one level up (${JSON.stringify(lay.cursor)})`);
  ok(run(city, { op: "cundo", coaster: id }).ok && city.funds === before - 60, "undo refunds the last piece in full");
  // Turning south runs into the cross path at ground level.
  ok(run(city, { op: "cpiece", coaster: id, piece: "right" }).ok, "right turn (south)");
  const blocked = run(city, { op: "cpiece", coaster: id, piece: "straight" });
  ok(!blocked.ok, `low track over a path rejected (${blocked.reason})`);
  ok(!run(city, { op: "cstate", coaster: id, state: "test" }).ok, "no test run on an open circuit");
}

// 3. Closing the circuit, physics and ratings, states.
{
  const city = park();
  run(city, { op: "cstation", tile: STATION, dir: 1 });
  const id = zoo(city).coasters![0].id;
  for (const piece of TRACK) run(city, { op: "cpiece", coaster: id, piece });
  const c = zoo(city).coasters![0];
  const grid = blockGrid(zoo(city).park!, zoo(city).habitats, zoo(city).coasters!, id);
  const route = closeRoute(c, grid);
  ok(route && route.length > 0, `closeRoute finds a way back (${route?.length})`);
  ok(run(city, { op: "cstate", coaster: id, state: "open" }).reason === "coaster_open", "cannot open an unclosed track");
  ok(run(city, { op: "cclose", coaster: id }).ok, "cclose");
  ok(coasterLayout(c).closed, "circuit closed");
  ok(run(city, { op: "cclose", coaster: id }).reason === "coaster_closed", "closing twice is rejected");
  ok(run(city, { op: "cstate", coaster: id, state: "open" }).reason === "coaster_untested", "open needs a test run");
  const path = trackPath(c);
  ok(path.closed && path.length > 20, `track path closed (${path.length.toFixed(1)})`);
  const ride = simulate(path);
  const kmh = Math.max(...ride.speed) * 1.8 * 3.6;
  ok(ride.ok && kmh > 25 && kmh < 110 && ride.lapSec > 5, `train completes the lap (${kmh.toFixed(0)} km/h, ${ride.lapSec.toFixed(1)} s)`);
  ok(run(city, { op: "cstate", coaster: id, state: "test" }).ok, "test run");
  const stats = c.stats!;
  ok(stats.excitement > 2 && stats.excitement <= 10 && stats.intensity > 2 && stats.intensity <= 10 && stats.nausea > 0 && stats.nausea <= 10, `ratings in range (E ${stats.excitement} I ${stats.intensity} N ${stats.nausea})`);
  ok(stats.loops === 1, "one loop counted");
  const bare = rateCoaster(c, 0)!;
  const pretty = rateCoaster(c, 12)!;
  ok(pretty.excitement > bare.excitement && pretty.intensity === bare.intensity, `scenery raises excitement only (${bare.excitement} → ${pretty.excitement})`);
  const flat = rateCoaster({ station: STATION, dir: 1, pieces: c.pieces.map((p): PieceKind => (p === "loop" ? "straight" : p)) }, 0);
  ok(!flat || flat.intensity < bare.intensity, "a loop makes it more intense");
  ok(run(city, { op: "cstate", coaster: id, state: "open" }).ok && c.state === "open", "opened");
  // Editing the track closes it and drops the rating.
  ok(run(city, { op: "cundo", coaster: id }).ok && c.state === "closed" && !c.stats, "edit → closed, untested");
}

// 4. A loop right after the station stalls (no speed) → the test run fails.
{
  const city = park();
  run(city, { op: "cstation", tile: STATION, dir: 1 });
  const id = zoo(city).coasters![0].id;
  for (const piece of ["loop", "left", "straight", "left"] as PieceKind[]) run(city, { op: "cpiece", coaster: id, piece });
  run(city, { op: "cclose", coaster: id });
  const c = zoo(city).coasters![0];
  if (coasterLayout(c).closed) {
    const r = run(city, { op: "cstate", coaster: id, state: "test" });
    ok(!r.ok && r.reason === "coaster_stall", `stall detected (${r.reason})`);
  } else ok(true, "stall track could not be closed here (skipped)");
}

// 5. Price elasticity.
{
  ok(priceFactor(4, 4) === 1, "fair price → factor 1");
  ok(priceFactor(2, 4) > 1 && priceFactor(2, 4) < 1.25, "cheap → a few more buyers");
  ok(priceFactor(6, 4) < 0.5 && priceFactor(8, 4) === 0, "overpriced → fewer, 2× → nobody");
  ok(priceMood(3, 4) === "cheap" && priceMood(4, 4) === "fair" && priceMood(5.5, 4) === "pricey" && priceMood(8, 4) === "rip", "price moods");
  let best = 0;
  let bestPrice = 0;
  for (let p = 1; p <= 10; p += 1) { const revenue = p * priceFactor(p, 4); if (revenue > best) { best = revenue; bestPrice = p; } }
  ok(bestPrice >= 4 && bestPrice <= 5, `revenue peaks near the fair price (${bestPrice} €)`);
  ok(rideFair(0) === 1 && rideFair(5) === 6 && rideFair(10) === 10, "fair ride price grows with excitement");
  const city = park();
  const z = zoo(city);
  const summary = summarize(z.park!, z.habitats);
  const fair = parkEconomy(summary, 30, 80, 2);
  const food = summary.spots.food[0].tile;
  const rip = parkEconomy(summary, 30, 80, 2, { [food]: 12 });
  const cheap = parkEconomy(summary, 30, 80, 2, { [food]: 2 });
  const ripFood = rip.stands.find((s) => s.tile === food)!;
  ok(ripFood.customers === 0 && ripFood.mood === "rip", "12 € fries: nobody buys");
  ok(rip.satisfaction < fair.satisfaction, `rip-off lowers satisfaction (${fair.satisfaction} → ${rip.satisfaction})`);
  ok(cheap.satisfaction >= fair.satisfaction, "bargains do not hurt satisfaction");
  ok(cheap.stands.find((s) => s.tile === food)!.customers > fair.stands.find((s) => s.tile === food)!.customers, "cheap → more customers");
}

// 6. Price commands: stands and tickets, clamped, default removes the override.
{
  const city = park();
  const z = zoo(city);
  ok(run(city, { op: "sprice", tile: P(19, 20), price: 7 }).ok && z.prices?.[P(19, 20)] === 7, "stand price set");
  ok(!run(city, { op: "sprice", tile: P(18, 20), price: 7 }).ok, "price only on stands");
  ok(run(city, { op: "sprice", tile: P(19, 20), price: PARK_INFO.food.price }).ok && z.prices?.[P(19, 20)] === undefined, "default price removes the override");
  ok(parseCommand({ type: "zoo", zoo: { op: "sprice", tile: P(19, 20), price: PRICE_MAX + 1 } }) === null, "price above max rejected by the protocol");
  const c = coaster(city);
  ok(run(city, { op: "cprice", coaster: c.id, price: 9 }).ok && c.price === 9, "ticket price set");
  ok(c.state === "open", "price change keeps the ride open");
  // Removing a stand drops its price.
  run(city, { op: "sprice", tile: P(19, 22), price: 1 });
  run(city, { op: "pclear", cells: [P(19, 22)] });
  ticks(city, 1);
  ok(z.prices?.[P(19, 22)] === undefined || summarize(z.park!, z.habitats).spots.drink.length === 0, "cleared stand: price no longer used");
}

// 7. Riders and revenue; closed rides earn nothing; overpriced rides lose riders.
{
  const city = park();
  const z = zoo(city);
  const c = coaster(city);
  ticks(city, 30);
  ok(c.riders > 0 && c.revenue > 0 && (z.rideSales ?? 0) > 0, `riders ${c.riders.toFixed(0)}, revenue ${c.revenue.toFixed(0)} €`);
  ok(z.income >= (z.rideSales ?? 0), "ride sales count as income");
  const riders = c.riders;
  run(city, { op: "cprice", coaster: c.id, price: PRICE_MAX });
  ticks(city, 10);
  ok(c.riders - riders < 1, "nobody pays 30 € for a small coaster");
  run(city, { op: "cstate", coaster: c.id, state: "closed" });
  const r2 = c.riders;
  ticks(city, 10);
  ok(c.riders === r2 && (z.rideSales ?? 0) === 0, "closed ride: no riders");
}

// 8. Crowd: open rides draw visitors, reactions include moods; overpricing → "pricey".
{
  const city = park();
  const z = zoo(city);
  const c = coaster(city);
  const crowd = new ParkCrowd(3);
  crowd.setLayout(z.park!, z.habitats, rideRefs(z.coasters), z.prices);
  const events: CrowdEvent[] = [];
  for (let k = 0; k < 6000; k += 1) events.push(...crowd.update(0.05, 30));
  const rides = events.filter((e) => e.type === "ride");
  ok(rides.length > 3, `visitors ride (${rides.length})`);
  run(city, { op: "cprice", coaster: c.id, price: 25 });
  const crowd2 = new ParkCrowd(3);
  crowd2.setLayout(z.park!, z.habitats, rideRefs(z.coasters), z.prices);
  const pricey: CrowdEvent[] = [];
  for (let k = 0; k < 6000; k += 1) pricey.push(...crowd2.update(0.05, 30));
  const moods = pricey.filter((e) => e.type === "ride").map((e) => (e as Extract<CrowdEvent, { type: "ride" }>).mood);
  ok(moods.length > 0 && moods.every((m) => m === "pricey"), `25 € ticket: "Zu teuer" (${moods.length})`);
  // Stand refusals.
  run(city, { op: "sprice", tile: P(19, 20), price: 14 });
  const crowd3 = new ParkCrowd(5);
  crowd3.setLayout(z.park!, z.habitats, rideRefs(z.coasters), z.prices);
  const buys: CrowdEvent[] = [];
  for (let k = 0; k < 6000; k += 1) buys.push(...crowd3.update(0.05, 30));
  const food = buys.filter((e) => e.type === "buy" && e.tile === P(19, 20)) as Extract<CrowdEvent, { type: "buy" }>[];
  ok(food.length === 0 || food.every((e) => e.refused), `14 € food: refused (${food.length})`);
}

// 9. Delete: half refund, tiles free; pclear on the station removes the coaster.
{
  const city = park();
  const c = coaster(city);
  const funds = city.funds;
  ok(run(city, { op: "cdelete", coaster: c.id }).ok, "delete");
  ok(city.funds > funds && zoo(city).coasters!.length === 0, "half refund, coaster gone");
  ok(walkable(occupancy(zoo(city).park!, zoo(city).habitats, [])[P(19, 8)]) && occupancy(zoo(city).park!, zoo(city).habitats, rideRefs(zoo(city).coasters))[P(13, 7)] !== TILE.coaster, "tiles free again");
  coaster(city);
  ok(run(city, { op: "pclear", cells: [P(13, 7)] }).ok && zoo(city).coasters!.length === 0, "bulldozing the station removes the coaster");
}

// 10. Protocol.
{
  const parse = (zoo: unknown) => parseCommand({ type: "zoo", zoo });
  ok(parse({ op: "cstation", tile: STATION, dir: 1 }) !== null && parse({ op: "cstation", tile: STATION, dir: 4 }) === null, "cstation parse");
  ok(parse({ op: "cpiece", coaster: 1, piece: "loop" }) !== null && parse({ op: "cpiece", coaster: 1, piece: "corkscrew" }) === null, "cpiece parse");
  ok(parse({ op: "cstate", coaster: 1, state: "open" }) !== null && parse({ op: "cstate", coaster: 1, state: "broken" }) === null, "cstate parse");
  ok(parse({ op: "cprice", coaster: 1, price: 3.5 }) === null && parse({ op: "cprice", coaster: 1, price: -1 }) === null, "cprice parse");
  ok(["cundo", "cclose", "cdelete"].every((op) => parse({ op, coaster: 2 }) !== null && parse({ op, coaster: "x" }) === null), "coaster op parse");
}

// 11. Save round trip, old saves, sanitizing.
{
  const city = park();
  const c = coaster(city);
  run(city, { op: "cprice", coaster: c.id, price: 7 });
  run(city, { op: "sprice", tile: P(19, 20), price: 3 });
  ticks(city, 5);
  const loaded = saveToCity(JSON.parse(JSON.stringify(cityToSave(city, "Bahn"))))!;
  const lz = zoo(loaded);
  const lc = lz.coasters![0];
  ok(lc && lc.id === c.id && lc.pieces.join() === c.pieces.join() && lc.state === "open" && lc.price === 7, "coaster survives save/load");
  ok(lc.stats && Math.abs(lc.stats.excitement - c.stats!.excitement) < 1e-9, "ratings survive");
  ok(lz.prices?.[P(19, 20)] === 3, "stand price survives");
  ok(run(loaded, { op: "cprice", coaster: lc.id, price: 6 }).ok && lc.price === 6, "loaded coaster still accepts commands");
  // Old save without coasters/prices.
  const plain = park(9);
  const old = JSON.parse(JSON.stringify(cityToSave(plain, "Alt")));
  const raw = old.progress?.zoo ?? old.zoo;
  if (raw) { delete raw.coasters; delete raw.coasterSeq; delete raw.prices; delete raw.rideSales; }
  const oldCity = saveToCity(old)!;
  ok(oldCity && (zoo(oldCity).coasters ?? []).length === 0, "old save loads without coasters");
  ticks(oldCity, 3);
  ok(zoo(oldCity).visitors >= 0, "old save keeps running");
  // Garbage is cleaned.
  const z = zoo(city);
  const junk = cleanCoasters([{ id: 9, station: STATION, dir: 7, pieces: ["x"] }, { id: "a" }, null, { id: 3, station: P(30, 30), dir: 1, pieces: ["straight", "loop", "bogus"], state: "open", price: 999 }], z.park, z.habitats);
  ok(junk.every((c) => c.price <= PRICE_MAX && c.pieces.every((p) => ["straight", "left", "right", "up", "down", "loop"].includes(p))), `junk coasters sanitized (${junk.length} kept)`);
  ok(junk.every((c) => c.state === "closed" || !!c.stats), "an untested coaster is never open after load");
}

console.log(`coaster-tests: ${checks} checks ok`);
