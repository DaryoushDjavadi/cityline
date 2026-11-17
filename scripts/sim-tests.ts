import {
  AIRPORT_DELAY,
  DAY_TICKS,
  HARBOR_DELAY,
  POWER_BIT,
  ROAD_FLAG,
  ServiceKind,
  WATER_BIT,
  afterLoadCity,
  applyCommand,
  beachVisitors,
  buildMeta,
  canPlace,
  canPlaceHarbor,
  cellCoords,
  cellHeight,
  cellIndex,
  cityToSave,
  createCity,
  houseHappiness,
  hubSlots,
  isBeach,
  isWater,
  logisticsPartner,
  marketMultiplier,
  packCells,
  placeBlockReason,
  quoteTrade,
  refreshUtilities,
  resolveHarborCell,
  saveToCity,
  stepSimulation,
  supplyMissingHint,
  tradeDeal,
  wouldReceiveSupply,
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

  {
    const city = createCity(undefined, undefined, { seed: 1842, biome: "temperate", water: 42 });
    city.funds = 400_000;
    let site = -1;
    for (let y = 3; y < city.height - 3 && site < 0; y += 1) {
      for (let x = 3; x < city.width - 3 && site < 0; x += 1) {
        const index = cellIndex(city, x, y);
        if (!canPlaceHarbor(city, index) || isWater(city, index)) continue;
        const placed = applyCommand(city, { type: "service", index, kind: ServiceKind.Harbor });
        if (placed.ok) site = placed.applied[0] ?? index;
      }
    }
    if (site < 0) fail("gen map must accept a harbor without a road");
    if (isWater(city, site)) fail("harbor must sit on land/sand");
    const inland = cellIndex(city, 32, 32);
    if (canPlace(city, inland, "service", { kind: ServiceKind.Harbor })) fail("inland harbor");
    const inlandWhy = placeBlockReason(city, inland, "service", { kind: ServiceKind.Harbor });
    if (!inlandWhy || !inlandWhy.includes("Wasser")) fail(`inland reason ${inlandWhy}`);
    if (canPlace(city, site, "service", { kind: ServiceKind.Airport })) fail("airport must not replace the harbor");
    let water = -1;
    const spot = cellCoords(city, site);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const index = cellIndex(city, spot.x + dx, spot.y + dy);
      if (isWater(city, index)) water = index;
    }
    if (water < 0) fail("placed harbor must touch water");
  }

  {
    const city = createCity();
    city.terrain.fill(0);
    city.gen = undefined;
    city.funds = 400_000;
    afterLoadCity(city);
    let water = 0;
    for (let i = 0; i < city.terrain.length; i += 1) if (city.terrain[i] === 1) water += 1;
    if (water < 40) fail(`old flat save should gain a coast, water=${water}`);
    let harbor = -1;
    for (let y = 1; y < city.height - 1 && harbor < 0; y += 1) {
      for (let x = 1; x < city.width - 1 && harbor < 0; x += 1) {
        const index = cellIndex(city, x, y);
        if (applyCommand(city, { type: "service", index, kind: ServiceKind.Harbor }).ok) harbor = index;
      }
    }
    if (harbor < 0) fail("old flat save must place a harbor on the restored coast");
  }

  {
    const city = createCity();
    city.terrain.fill(0);
    city.gen = undefined;
    city.funds = 50_000;
    for (let y = 0; y <= 3; y += 1) city.terrain[cellIndex(city, 4, y)] = 1;
    afterLoadCity(city);
    const sea = cellIndex(city, 4, 3);
    const snapped = resolveHarborCell(city, sea);
    if (snapped === sea || isWater(city, snapped)) fail("sea click must snap onto land");
    if (!canPlaceHarbor(city, sea)) fail("clicking the sea next to shore must be legal");
    const placed = applyCommand(city, { type: "service", index: sea, kind: ServiceKind.Harbor });
    if (!placed.ok) fail(`snap-from-water harbor ${placed.reason}`);
    if (city.services[sea] === ServiceKind.Harbor) fail("pier cell must stay water, building on land");
    if (city.services[snapped] !== ServiceKind.Harbor) fail("harbor should occupy the shore");
  }

  {
    const city = createCity();
    city.terrain.fill(0);
    city.funds = 80_000;
    const road = [cellIndex(city, 4, 4), cellIndex(city, 5, 4), cellIndex(city, 6, 4)];
    if (!applyCommand(city, { type: "road", cells: road }).ok) fail("supply road");
    if (!applyCommand(city, { type: "service", index: cellIndex(city, 4, 3), kind: ServiceKind.Power }).ok) fail("supply plant");
    if (!applyCommand(city, { type: "service", index: cellIndex(city, 6, 3), kind: ServiceKind.Water }).ok) fail("supply water");
    if (!applyCommand(city, { type: "line", cells: [cellIndex(city, 4, 4), cellIndex(city, 5, 4)] }).ok) fail("supply line");
    if (!applyCommand(city, { type: "pipe", cells: [cellIndex(city, 6, 4), cellIndex(city, 5, 4)] }).ok) fail("supply pipe");
    if (!applyCommand(city, { type: "build", kind: "cottage", cells: [cellIndex(city, 5, 5)] }).ok) fail("supply house");
    refreshUtilities(city);
    const house = cellIndex(city, 5, 5);
    if (!wouldReceiveSupply(city, house, POWER_BIT) || !wouldReceiveSupply(city, house, WATER_BIT)) fail("adjacent house should be supplied");
    if ((city.utility[house] & (POWER_BIT | WATER_BIT)) !== (POWER_BIT | WATER_BIT)) fail("sim utility bits");
    const far = cellIndex(city, 10, 10);
    if (!applyCommand(city, { type: "road", cells: [cellIndex(city, 10, 11)] }).ok) fail("far road");
    if (!applyCommand(city, { type: "build", kind: "cottage", cells: [far] }).ok) fail("far house");
    refreshUtilities(city);
    if (wouldReceiveSupply(city, far, POWER_BIT)) fail("radius must not skip a gap");
    const hint = supplyMissingHint(city, far);
    if (!hint || !hint.includes("Strom")) fail(`hint ${hint}`);
    const stripped = applyCommand(city, { type: "strip", cells: [cellIndex(city, 4, 4), cellIndex(city, 5, 4)], layer: "line" });
    if (!stripped.ok) fail("strip line");
    if (city.roads[cellIndex(city, 5, 4)] === 0) fail("strip must keep the road");
    refreshUtilities(city);
    if ((city.utility[house] & POWER_BIT) !== 0) fail("house should lose power after the line is stripped");
    const stats = buildMeta(city).stats;
    if (stats.powerCapacity <= 0 || stats.waterCapacity <= 0) fail(`plants should add capacity ${stats.powerCapacity}/${stats.waterCapacity}`);
  }

  console.log("sim-tests ok");
}

if (process.argv[1]?.includes("sim-tests")) runSimTests();
