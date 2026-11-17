import {
  AIRPORT_DELAY,
  DAY_TICKS,
  HARBOR_DELAY,
  ROAD_FLAG,
  ServiceKind,
  applyCommand,
  beachVisitors,
  buildMeta,
  canPlace,
  cellCoords,
  cellHeight,
  cellIndex,
  cityToSave,
  createCity,
  houseHappiness,
  hubSlots,
  isBeach,
  logisticsPartner,
  marketMultiplier,
  packCells,
  quoteTrade,
  refreshUtilities,
  saveToCity,
  stepSimulation,
  tradeDeal,
  writeCity,
} from "../shared/src/index.ts";

function fail(message: string): never {
  throw new Error(message);
}

function placeCoastalHarbor() {
  const city = createCity(undefined, undefined, { seed: 1842, biome: "temperate", water: 42, lakes: 8, forest: 18, rivers: 8 });
  city.funds = 400_000;
  city.food = 40;
  let harbor = -1;
  for (let y = 3; y < city.height - 3 && harbor < 0; y += 1) {
    for (let x = 3; x < city.width - 3 && harbor < 0; x += 1) {
      const index = cellIndex(city, x, y);
      if (!isBeach(city, index)) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const ri = cellIndex(city, x + dx, y + dy);
        if (city.terrain[ri] === 1 || isBeach(city, ri)) continue;
        applyCommand(city, { type: "road", cells: [ri] });
        if (applyCommand(city, { type: "service", index, kind: ServiceKind.Harbor }).ok) {
          harbor = index;
          break;
        }
      }
    }
  }
  if (harbor < 0) fail("no harbor site");
  refreshUtilities(city);
  return { city, harbor };
}

function placeAirportNear(city: ReturnType<typeof createCity>, harbor: number): number {
  const spot = cellCoords(city, harbor);
  const roads: number[] = [];
  for (let step = 1; step <= 10; step += 1) {
    const y = spot.y + step;
    const index = cellIndex(city, spot.x, y);
    if (city.terrain[index] === 1 || isBeach(city, index) || city.services[index] !== 0) continue;
    roads.push(index);
  }
  if (roads.length) applyCommand(city, { type: "road", cells: roads });
  for (const road of roads) {
    const { x, y } = cellCoords(city, road);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const index = cellIndex(city, x + dx, y + dy);
      if (index === harbor || isBeach(city, index) || city.terrain[index] === 1) continue;
      const placed = applyCommand(city, { type: "service", index, kind: ServiceKind.Airport });
      if (placed.ok) return index;
    }
  }
  return -1;
}

export function runSimTests(): void {
  const deal = tradeDeal("food_out");
  if (!deal) fail("food_out missing");

  {
    const { city, harbor } = placeCoastalHarbor();
    if (canPlace(city, harbor, "build")) fail("houses must not build on beach");
    const inland = cellIndex(city, 32, 32);
    if (city.terrain[inland] !== 1 && canPlace(city, inland, "service", { kind: ServiceKind.Harbor })) {
      fail("harbor must stay on the coast");
    }
    const quoteH = quoteTrade(city, harbor, deal);
    if (!quoteH || quoteH.hub !== "harbor") fail("harbor quote");
    if (quoteH.delay !== HARBOR_DELAY) fail(`harbor delay ${quoteH.delay}`);
    if (quoteH.price >= deal.price * 2) fail("harbor bulk should be cheaper per unit");
    const funds = city.funds;
    const food = city.food;
    if (!applyCommand(city, { type: "trade", index: harbor, deal: "food_out" }).ok) fail("harbor export");
    if (city.food >= food) fail("export should take food now");
    if (city.funds !== funds) fail("harbor money waits for the ship");
    if ((city.shipments ?? []).length !== 1) fail("delayed shipment");
  }

  {
    const { city, harbor } = placeCoastalHarbor();
    const airport = placeAirportNear(city, harbor);
    if (airport < 0) fail("need an airport for synergy");
    refreshUtilities(city);
    const quoteA = quoteTrade(city, airport, deal);
    const quoteH = quoteTrade(city, harbor, deal);
    if (!quoteA || !quoteH) fail("quotes");
    if (quoteA.delay !== AIRPORT_DELAY) fail("airport is instant");
    if (quoteH.delay <= quoteA.delay) fail("harbor is slower than airport");
    const linked = logisticsPartner(city, harbor) === airport || logisticsPartner(city, airport) === harbor;
    if (linked) {
      if (hubSlots(city, harbor) < 6) fail("synergy should add a harbor slot");
      if (quoteH.delay !== HARBOR_DELAY - 2) fail("linked harbor should be faster");
    }
  }

  {
    const { city, harbor } = placeCoastalHarbor();
    const first = quoteTrade(city, harbor, deal)!.price;
    applyCommand(city, { type: "trade", index: harbor, deal: "food_out" });
    applyCommand(city, { type: "trade", index: harbor, deal: "food_out" });
    const second = quoteTrade(city, harbor, deal)!.price;
    if (second >= first) fail("export saturation must drop prices");
    if (marketMultiplier(80) >= marketMultiplier(0) * 0.55) fail("high heat cuts payouts");
    const heat = city.tradeHeat ?? 0;
    for (let i = 0; i < 50; i += 1) stepSimulation(city);
    if ((city.tradeHeat ?? 0) >= heat) fail("market heat should recover");
  }

  {
    const { city, harbor } = placeCoastalHarbor();
    const spot = cellCoords(city, harbor);
    let home = -1;
    for (let dy = -5; dy <= 5 && home < 0; dy += 1) {
      for (let dx = -5; dx <= 5 && home < 0; dx += 1) {
        const index = cellIndex(city, spot.x + dx, spot.y + dy);
        if (!canPlace(city, index, "build")) continue;
        if (applyCommand(city, { type: "build", kind: "cottage", cells: [index] }).ok) home = index;
      }
    }
    if (home < 0) fail("cottage near beach");
    const mood = houseHappiness(city, home);
    if (!mood.beach || mood.tax < 0.3 || mood.score < 0.6) fail(`beach happiness ${JSON.stringify(mood)}`);
    city.tick = Math.round((16 / 24) * DAY_TICKS);
    const crowd = beachVisitors(city, 40);
    if (crowd.length === 0) fail("afternoon beach visitors");
    for (const visitor of crowd) {
      if (!isBeach(city, visitor.cell)) fail("visitor must stand on a sand tile");
      if ((city.roads[visitor.cell] & ROAD_FLAG) !== 0) fail("leisure visitors must not sit on roads");
    }
  }

  {
    const hills = createCity(undefined, undefined, { seed: 99, biome: "alpine" });
    let peaked = 0;
    let buildable = 0;
    for (let y = 10; y < 40; y += 1) {
      for (let x = 10; x < 40; x += 1) {
        if (hills.terrain[cellIndex(hills, x, y)] === 1) continue;
        const h = cellHeight(hills, x, y);
        if (h > 1.2) peaked += 1;
        const index = cellIndex(hills, x, y);
        if (canPlace(hills, index, "build") || canPlace(hills, index, "road")) buildable += 1;
      }
    }
    if (peaked < 8) fail(`hills should be visible, peaked=${peaked}`);
    const coastMap = createCity(undefined, undefined, { seed: 1842, biome: "temperate", water: 40 });
    let inlandPeak = 0;
    for (let y = 8; y < 56; y += 1) {
      for (let x = 8; x < 56; x += 1) {
        if (coastMap.terrain[cellIndex(coastMap, x, y)] === 1) continue;
        inlandPeak = Math.max(inlandPeak, cellHeight(coastMap, x, y));
      }
    }
    if (inlandPeak < 2.4) fail(`temperate hills should roll, peak=${inlandPeak}`);
    if (buildable < 20) fail("slopes stay buildable");
    hills.funds = 50_000;
    let placed = false;
    for (let y = 12; y < 40 && !placed; y += 1) {
      for (let x = 12; x < 40 && !placed; x += 1) {
        const index = cellIndex(hills, x, y);
        if (cellHeight(hills, x, y) < 1.0) continue;
        if (applyCommand(hills, { type: "road", cells: [index] }).ok) placed = true;
      }
    }
    if (!placed) fail("should pave a hill cell");
  }

  {
    const fresh = createCity(undefined, undefined, { seed: 7, biome: "temperate" });
    const save = cityToSave(fresh, "legacy");
    const meta = { ...save.meta };
    delete (meta as { gen?: unknown }).gen;
    delete (meta as { tradeHeat?: unknown }).tradeHeat;
    delete (meta as { shipments?: unknown }).shipments;
    const loaded = createCity();
    writeCity(loaded, packCells(fresh), meta);
    if (loaded.gen) fail("old saves without gen stay flat");
    if ((loaded.tradeHeat ?? -1) !== 0) fail("old saves get tradeHeat 0");
    if ((loaded.shipments ?? []).length !== 0) fail("old saves get empty shipments");
    let bump = false;
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        if (loaded.terrain[cellIndex(loaded, x, y)] === 1) continue;
        if (cellHeight(loaded, x, y) > 0.2) bump = true;
      }
    }
    if (bump) fail("legacy maps must not grow hills");
    const roundtrip = saveToCity({ ...save, gen: undefined, meta });
    if (!roundtrip || roundtrip.services.length !== fresh.services.length) fail("legacy saveToCity");
    if (roundtrip.gen) fail("saveToCity must not invent gen");
  }

  {
    const packed = cityToSave(createCity(undefined, undefined, { seed: 3 }), "now");
    const again = saveToCity(packed);
    if (!again?.gen || again.gen.seed !== 3) fail("new saves keep gen");
    if (buildMeta(again).gen?.seed !== 3) fail("meta carries gen");
  }

  {
    const { city, harbor } = placeCoastalHarbor();
    const before = city.goals;
    city.tick += 1;
    stepSimulation(city);
    if ((city.goals & 1024) === 0) fail("harbor quest should complete");
    if (city.funds <= 0) fail("harbor quest should pay");
    const airport = placeAirportNear(city, harbor);
    if (airport < 0) fail("airport for logistics quest");
    const spot = cellCoords(city, harbor);
    let home = -1;
    for (let dy = -5; dy <= 5 && home < 0; dy += 1) {
      for (let dx = -5; dx <= 5 && home < 0; dx += 1) {
        const index = cellIndex(city, spot.x + dx, spot.y + dy);
        if (applyCommand(city, { type: "build", kind: "cottage", cells: [index] }).ok) home = index;
      }
    }
    if (home < 0) fail("beach house for logistics quest");
    stepSimulation(city);
    if ((city.goals & 2048) === 0 && logisticsPartner(city, harbor) !== null) {
      fail("logistics quest should complete when linked and a beach house exists");
    }
    void before;
  }

  {
    const { city, harbor } = placeCoastalHarbor();
    city.food = 40;
    applyCommand(city, { type: "trade", index: harbor, deal: "food_out" });
    const due = city.shipments?.[0]?.due ?? 0;
    while (city.tick < due) stepSimulation(city);
    if ((city.shipments ?? []).length !== 0) fail("shipment should settle");
  }

  console.log("sim-tests ok");
}

if (process.argv[1]?.includes("sim-tests")) runSimTests();
