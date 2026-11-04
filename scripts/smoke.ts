import { allocateCityCode, applyCommand, buildMeta, canPlace, cellCoords, cellIndex, cityLedger, cityToSave, claimGoals, cleanChat, cleanClientId, climateAt, createCity, createLevelCity, DAY_TICKS, evaluateLevel, farmYield, foodNeed, foodProduction, foodRatio, formatClock, isBridge, isLevelRoom, isLine, isOnDuty, isRoad, LEGACY_SOLO_KEY, LEVEL_COUNT, LEVEL_GOALS_MASK, LEVELS, levelRoomCode, lineCells, listAdults, listCitySlots, loadCitySlot, loadOrCreateClientId, MemoryStore, mergeRoomLists, packCells, parseChatMessage, parseCursor, parseLevelRoom, refreshUtilities, saveToCity, ServiceKind, stepSimulation, streetPedestrians, writeCity, writeCitySlot } from "../shared/src/index.ts";

const city = createCity();
{
  const a = createCity(undefined, undefined, { seed: 42, biome: "alpine", water: 40, lakes: 45, forest: 68, rivers: 72 });
  const b = createCity(undefined, undefined, { seed: 42, biome: "alpine", water: 40, lakes: 45, forest: 68, rivers: 72 });
  if (!a.gen || a.gen.biome !== "alpine" || a.gen.seed !== 42) throw new Error("map gen missing");
  for (let i = 0; i < a.terrain.length; i += 1) {
    if (a.terrain[i] !== b.terrain[i]) throw new Error("map gen not deterministic");
  }
  const dry = createCity(undefined, undefined, { seed: 7, biome: "temperate", water: 10, lakes: 0, rivers: 0 });
  const wet = createCity(undefined, undefined, { seed: 7, biome: "temperate", water: 90, lakes: 0, rivers: 0 });
  let dryWater = 0;
  let wetWater = 0;
  for (let i = 0; i < dry.terrain.length; i += 1) {
    if (dry.terrain[i] === 1) dryWater += 1;
    if (wet.terrain[i] === 1) wetWater += 1;
  }
  if (wetWater <= dryWater) throw new Error("higher water slider should yield more sea");
}
let dryInterior = false;
for (let y = 14; y < 50 && !dryInterior; y += 1) {
  for (let x = 14; x < 50; x += 1) {
    if (city.terrain[cellIndex(city, x, y)] === 0) dryInterior = true;
  }
}
if (city.terrain[0] !== 1 || city.terrain[cellIndex(city, 0, 32)] !== 1 || !dryInterior) throw new Error("expected an island");
city.terrain.fill(0);
const road = [];
for (let x = 20; x <= 34; x += 1) road.push(cellIndex(city, x, 32));
const zoned = [];
for (let x = 20; x <= 30; x += 1) zoned.push(cellIndex(city, x, 33));

const lines = road.slice();
const pipes = road.slice();
const roadResult = applyCommand(city, { type: "road", cells: road });
const power = applyCommand(city, { type: "service", index: cellIndex(city, 20, 31), kind: 1 });
const water = applyCommand(city, { type: "service", index: cellIndex(city, 22, 31), kind: 2 });
const wired = applyCommand(city, { type: "line", cells: lines });
const plumbed = applyCommand(city, { type: "pipe", cells: pipes });
const zone = applyCommand(city, { type: "zone", zone: 1, cells: zoned });
for (const index of zoned) city.levels[index] = 1;
refreshUtilities(city);

for (let tick = 0; tick < 24; tick += 1) stepSimulation(city);
const meta = buildMeta(city);
const levels = zoned.reduce((sum, index) => sum + city.levels[index], 0);

if (!roadResult.ok || !power.ok || !water.ok || !wired.ok || !plumbed.ok || !zone.ok) {
  throw new Error(`place failed ${roadResult.reason} ${power.reason} ${water.reason} ${wired.reason} ${plumbed.reason} ${zone.reason}`);
}
if (levels !== zoned.length) throw new Error(`placed homes were removed, levels=${levels}`);
const books = cityLedger(city);
if (books.income <= books.upkeep) throw new Error(`town should earn money ${books.income}/${books.upkeep}`);
if (meta.stats.population <= 0) throw new Error("expected population");
if ((city.utility[zoned[0]] & 3) !== 3) throw new Error(`utility ${city.utility[zoned[0]]}`);

const elbow = lineCells(city, 8, 8, 12, 11);
for (let step = 1; step < elbow.length; step += 1) {
  const from = cellCoords(city, elbow[step - 1]);
  const to = cellCoords(city, elbow[step]);
  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) throw new Error("road bend skipped a cell");
}
const bendCity = createCity();
bendCity.terrain.fill(0);
const bend = applyCommand(bendCity, { type: "road", cells: lineCells(bendCity, 8, 8, 12, 11) });
const corner = cellIndex(bendCity, 12, 8);
if (!bend.ok || (bendCity.roads[corner] & 0b1111) !== 0b1100) throw new Error(`corner mask ${bendCity.roads[corner]}`);

city.budget[zoned[0]] = 140;
city.skills[zoned[0]] = 6;
const restored = saveToCity(cityToSave(city, "probe"));
if (!restored) throw new Error("save failed");
const same = (label: string, left: number, right: number) => {
  if (left !== right) throw new Error(`${label} ${left} != ${right}`);
};
same("funds", restored.funds, city.funds);
same("tick", restored.tick, city.tick);
same("demand", restored.demand.residential, city.demand.residential);
same("road", restored.roads[road[0]], city.roads[road[0]]);
same("line", restored.lines[road[0]], city.lines[road[0]]);
same("pipe", restored.pipes[road[0]], city.pipes[road[0]]);
same("level", restored.levels[zoned[0]], city.levels[zoned[0]]);
same("zone", restored.zones[zoned[0]], city.zones[zoned[0]]);
same("budget", restored.budget[zoned[0]], 140);
same("skills", restored.skills[zoned[0]], 6);
same("plant", restored.services[cellIndex(city, 20, 31)], 1);
same("waterworks", restored.services[cellIndex(city, 22, 31)], 2);
same("goals", restored.goals, city.goals);
same("food", restored.food, city.food);
if ((city.goals & (1 | 2 | 4 | 16)) !== (1 | 2 | 4 | 16)) throw new Error(`goals ${city.goals}`);

const fed = createCity();
fed.terrain.fill(0);
const row = [0, 1, 2].map((x) => cellIndex(fed, x, 4));
const spine = [0, 1, 2].map((x) => cellIndex(fed, x, 3));
if (!applyCommand(fed, { type: "road", cells: spine }).ok) throw new Error("spine");
if (!applyCommand(fed, { type: "zone", zone: 1, cells: row }).ok) throw new Error("row");
if (!applyCommand(fed, { type: "service", index: cellIndex(fed, 0, 2), kind: 1 }).ok) throw new Error("plant");
if (!applyCommand(fed, { type: "service", index: cellIndex(fed, 2, 2), kind: 2 }).ok) throw new Error("works");
if (!applyCommand(fed, { type: "line", cells: [cellIndex(fed, 0, 3)] }).ok) throw new Error("line");
if (!applyCommand(fed, { type: "pipe", cells: [cellIndex(fed, 2, 3)] }).ok) throw new Error("pipe");
if (!applyCommand(fed, { type: "road", cells: [cellIndex(fed, 8, 8)] }).ok) throw new Error("bend road");
if (!applyCommand(fed, { type: "service", index: cellIndex(fed, 8, 7), kind: 1 }).ok) throw new Error("bend plant");
if (!applyCommand(fed, { type: "line", cells: lineCells(fed, 8, 8, 9, 9) }).ok) throw new Error("bend line");
fed.levels[row[0]] = 1;
refreshUtilities(fed);
const elbowLine = cellIndex(fed, 9, 8);
if ((fed.lines[elbowLine] & 0b1111) !== 0b1100) throw new Error(`line corner mask ${fed.lines[elbowLine]}`);
if ((fed.utility[cellIndex(fed, 9, 9)] & 1) === 0) throw new Error("orthogonal corner line did not conduct");
const ghost = createCity();
ghost.terrain.fill(0);
if (!applyCommand(ghost, { type: "road", cells: [cellIndex(ghost, 4, 4)] }).ok) throw new Error("ghost road");
if (!applyCommand(ghost, { type: "service", index: cellIndex(ghost, 4, 3), kind: 1 }).ok) throw new Error("ghost plant");
if (!applyCommand(ghost, { type: "line", cells: [cellIndex(ghost, 5, 3), cellIndex(ghost, 6, 4)] }).ok) throw new Error("diagonal skip");
refreshUtilities(ghost);
if ((ghost.utility[cellIndex(ghost, 6, 4)] & 1) !== 0) throw new Error("diagonal skip should not conduct");
if ((fed.utility[row[0]] & 1) === 0 || (fed.utility[row[1]] & 1) === 0 || (fed.utility[row[2]] & 1) === 0) {
  throw new Error(`power group ${fed.utility[row[0]]} ${fed.utility[row[1]]} ${fed.utility[row[2]]}`);
}
if ((fed.utility[row[2]] & 2) === 0 || (fed.utility[row[0]] & 2) === 0) {
  throw new Error(`water group ${fed.utility[row[0]]} ${fed.utility[row[2]]}`);
}
if (!isRoad(city, road[0]) || city.lines[road[0]] === 0 || city.pipes[road[0]] === 0) {
  throw new Error("a line or pipe removed the road");
}
const wet = createCity();
const spot = wet.terrain.indexOf(1);
if (spot < 0) throw new Error("expected water");
if (canPlace(wet, spot, "road") || canPlace(wet, spot, "zone", { zone: 1 }) || canPlace(wet, spot, "build")) {
  throw new Error("built on water");
}
if (!canPlace(wet, spot, "line") || !canPlace(wet, spot, "pipe")) throw new Error("lines should cross water");
if (!canPlace(wet, spot, "bridge")) throw new Error("bridge should cross water");
const spanned = applyCommand(wet, { type: "bridge", cells: [spot] });
if (!spanned.ok || !isRoad(wet, spot) || !isBridge(wet, spot)) throw new Error("bridge missing");
if (!applyCommand(wet, { type: "line", cells: [spot] }).ok || !isBridge(wet, spot)) throw new Error("line removed the bridge");
if (canPlace(wet, spot, "fill")) throw new Error("filled under a bridge");
const shore = wet.terrain.findIndex((value, index) => value === 1 && index !== spot);
if (shore < 0 || !canPlace(wet, shore, "fill")) throw new Error("expected open water to fill");
const before = wet.funds;
const filled = applyCommand(wet, { type: "fill", cells: [shore] });
if (!filled.ok || wet.terrain[shore] !== 0 || before - wet.funds !== 8000) throw new Error("fill failed");
const eager = createCity();
eager.terrain.fill(0);
if (!applyCommand(eager, { type: "road", cells: [cellIndex(eager, 3, 4)] }).ok) throw new Error("rebate road");
const purse = eager.funds;
const priced = applyCommand(eager, { type: "build", kind: "cottage", cells: [cellIndex(eager, 3, 3)] });
if (!priced.ok || priced.bonus !== 126 || purse - eager.funds !== 450 - 126) {
  throw new Error(`rebate ${priced.bonus} funds ${eager.funds}`);
}
if (canPlace(wet, shore, "fill") || !canPlace(wet, shore, "road")) throw new Error("filled land still behaves like water");

const jobs = createCity();
jobs.terrain.fill(0);
const home = cellIndex(jobs, 4, 5);
const factory = cellIndex(jobs, 3, 4);
if (!applyCommand(jobs, { type: "road", cells: [cellIndex(jobs, 4, 4)] }).ok) throw new Error("job road");
const cottage = cellIndex(jobs, 5, 4);
if (!applyCommand(jobs, { type: "build", kind: "cottage", cells: [cottage] }).ok || jobs.levels[cottage] !== 1) throw new Error("cottage");
if (!applyCommand(jobs, { type: "zone", zone: 1, cells: [home] }).ok) throw new Error("job home");
if (!applyCommand(jobs, { type: "zone", zone: 3, cells: [factory] }).ok) throw new Error("job factory");
jobs.levels[home] = 1;
jobs.levels[factory] = 1;
const idle = listAdults(jobs, home);
if (idle.length === 0 || idle.some((adult) => adult.workplace !== null)) throw new Error("adults should start unemployed");
const hired = applyCommand(jobs, { type: "hire", workplace: factory, home, slot: idle[0].slot });
if (!hired.ok || listAdults(jobs, home).find((adult) => adult.slot === idle[0].slot)?.workplace !== factory) {
  throw new Error("hire failed");
}
const kept = saveToCity(cityToSave(jobs, "jobs"));
if (!kept || kept.posts[home * 8 + idle[0].slot] !== factory + 1) throw new Error("hire did not save");

if (LEVELS.length !== LEVEL_COUNT || LEVELS.some((level, index) => level.id !== index + 1)) {
  throw new Error("levels must be 1–10 in order");
}
const blank = createCity();
blank.terrain.fill(0);
const blankStatus = evaluateLevel(LEVELS[0], blank);
if (blankStatus.won || blankStatus.failed || blankStatus.objectives.some((entry) => entry.done)) {
  throw new Error("empty city should not complete level 1");
}

const tutorial = createCity();
tutorial.terrain.fill(0);
const spineRoad = [20, 21, 22, 23, 24, 25].map((x) => cellIndex(tutorial, x, 20));
if (!applyCommand(tutorial, { type: "road", cells: spineRoad }).ok) throw new Error("level1 road");
if (!applyCommand(tutorial, { type: "build", kind: "cottage", cells: [cellIndex(tutorial, 20, 21)] }).ok) throw new Error("level1 house a");
if (!applyCommand(tutorial, { type: "build", kind: "cottage", cells: [cellIndex(tutorial, 21, 21)] }).ok) throw new Error("level1 house b");
if (!applyCommand(tutorial, { type: "build", kind: "shop", cells: [cellIndex(tutorial, 22, 21)] }).ok) throw new Error("level1 shop");
const shop = cellIndex(tutorial, 22, 21);
const seekers = [...listAdults(tutorial, cellIndex(tutorial, 20, 21)), ...listAdults(tutorial, cellIndex(tutorial, 21, 21))];
if (seekers.length < 2) throw new Error("level1 needs two adults");
if (!applyCommand(tutorial, { type: "hire", workplace: shop, home: seekers[0].home, slot: seekers[0].slot }).ok) throw new Error("level1 hire a");
if (!applyCommand(tutorial, { type: "hire", workplace: shop, home: seekers[1].home, slot: seekers[1].slot }).ok) throw new Error("level1 hire b");
const tutorialStatus = evaluateLevel(LEVELS[0], tutorial);
if (!tutorialStatus.won || tutorialStatus.failed || tutorialStatus.objectives.some((entry) => !entry.done)) {
  throw new Error(`level1 should be completable ${JSON.stringify(tutorialStatus.objectives)}`);
}

const timed = { ...LEVELS[6], timeLimitSeconds: 10 };
const late = createCity();
late.tick = 40;
const lateStatus = evaluateLevel(timed, late, 0);
if (!lateStatus.failed || lateStatus.won || lateStatus.remainingSeconds !== 0) {
  throw new Error(`time-out should fail a level ${lateStatus.remainingSeconds}`);
}
const lastSecond = { ...LEVELS[0], timeLimitSeconds: 1 };
tutorial.tick = 40;
const lastSecondStatus = evaluateLevel(lastSecond, tutorial, 0);
if (!lastSecondStatus.won || lastSecondStatus.failed) throw new Error("a finished city still wins after the clock");
if (formatClock(125) !== "2:05") throw new Error(`clock ${formatClock(125)}`);

const muted = createCity();
muted.terrain.fill(0);
muted.goals = LEVEL_GOALS_MASK;
muted.funds = 50_000;
if (!applyCommand(muted, { type: "road", cells: spineRoad }).ok) throw new Error("muted road");
const beforeGoals = muted.funds;
claimGoals(muted);
if (muted.funds !== beforeGoals) throw new Error("level mask must block freeplay payouts");

if (levelRoomCode(1, "Hauptstadt") !== "l1-hauptstadt") throw new Error("level room code");
if (levelRoomCode(3, "l3-hauptstadt") !== "l3-hauptstadt") throw new Error("level room strips prefix");
if (!isLevelRoom("l10-team") || isLevelRoom("hauptstadt")) throw new Error("level room detect");
if (parseLevelRoom("l3-hauptstadt")?.level !== 3) throw new Error("parse level room");
if (cleanChat("  hallo  ") !== "hallo") throw new Error("chat trim");
if (cleanChat("   ") !== null) throw new Error("empty chat");
if ((cleanChat("x".repeat(200)) ?? "").length !== 180) throw new Error("chat cap");
if (!parseChatMessage({ id: "a", playerId: "p", name: "Anna", text: "hi", at: 1 })) throw new Error("chat parse");
if (parseChatMessage({ id: "a", name: "Anna", text: "hi", at: 1 })) throw new Error("chat needs player");
if (!parseCursor({ playerId: "p", name: "Anna", x: 12, z: -4 })) throw new Error("cursor parse");
if (parseCursor({ name: "Anna", x: 1, z: 1 })) throw new Error("cursor needs player");
if (cleanClientId("short") || !cleanClientId("player-one-id")) throw new Error("client id");

if (allocateCityCode("Berlin", []) !== "berlin") throw new Error("first city keeps the name as key");
if (allocateCityCode("Berlin", ["berlin"]) !== "berlin-2") throw new Error("same name must get a new key");
if (allocateCityCode("Berlin", ["berlin", "berlin-2"]) !== "berlin-3") throw new Error("third same name");
if (allocateCityCode("l3-team", []) === "l3-team" || isLevelRoom(allocateCityCode("l3-team", []) ?? "")) {
  throw new Error("freeplay keys must not look like level rooms");
}

const store = new MemoryStore();
const first = cityToSave(city, "Berlin", "berlin");
if (!first.id || first.id !== "berlin") throw new Error("save id");
if (!writeCitySlot("berlin", first, store)) throw new Error("write A");
city.funds += 50;
const secondCity = createCity();
const second = cityToSave(secondCity, "Berlin", "berlin-2");
if (!writeCitySlot("berlin-2", second, store)) throw new Error("write B");
const storedA = loadCitySlot("berlin", store);
if (!storedA || storedA.meta.funds !== first.meta.funds) throw new Error("creating B must not clobber A");
if (listCitySlots(store).length !== 2) throw new Error("library should list both cities");
const emptySnap = cityToSave(createCity(), "Berlin", "berlin");
if (writeCitySlot("berlin", { ...emptySnap, meta: { ...emptySnap.meta, tick: 0 } }, store)) {
  throw new Error("blank overwrite of a developed slot must fail");
}
if (loadCitySlot("berlin", store)?.meta.funds !== first.meta.funds) throw new Error("developed slot stayed intact");

const legacy = new MemoryStore();
legacy.setItem(LEGACY_SOLO_KEY, JSON.stringify(cityToSave(city, "lokal")));
const migrated = listCitySlots(legacy);
if (migrated.length !== 1 || !loadCitySlot(migrated[0].id, legacy)) throw new Error("legacy solo slot should migrate");

const merged = mergeRoomLists(
  [{ code: "alpha", name: "Alpha", players: 0, population: 12, funds: 1, savedAt: "2026-01-01T00:00:00.000Z" }],
  [
    { code: "alpha", players: 1, population: 40, funds: 2, savedAt: "2026-02-01T00:00:00.000Z" },
    { code: "beta", players: 0, population: 0, funds: 0, savedAt: "2026-03-01T00:00:00.000Z" },
  ],
);
if (merged.length !== 2 || merged.find((row) => row.code === "alpha")?.players !== 1) throw new Error("lobby merge");
if (merged.find((row) => row.code === "alpha")?.savedAt !== "2026-02-01T00:00:00.000Z") throw new Error("lobby merge keeps later savedAt");
if (merged[0]?.code !== "alpha" || merged[1]?.code !== "beta") throw new Error("lobby merge sorts live first");
if (loadOrCreateClientId(store, () => "aaaaaaaa") !== "aaaaaaaa") throw new Error("new client id");
if (loadOrCreateClientId(store, () => "bbbbbbbb") !== "aaaaaaaa") throw new Error("stable client id");

if (foodNeed(12) !== 0 || foodNeed(24) !== 0 || foodNeed(48) !== 0) throw new Error("early city should not need food");
if (foodNeed(49) !== 1) throw new Error("growing city should start needing a little food");
if (foodNeed(84) !== 1 || foodNeed(120) !== 2) throw new Error("food demand should ramp slowly with population");

const newTown = createCity();
newTown.terrain.fill(0);
if (!applyCommand(newTown, { type: "road", cells: [8, 9, 10, 11, 12].map((x) => cellIndex(newTown, x, 8)) }).ok) throw new Error("new town road");
for (const x of [8, 9, 10, 11]) {
  if (!applyCommand(newTown, { type: "build", kind: "cottage", cells: [cellIndex(newTown, x, 9)] }).ok) throw new Error("new town cottage");
}
if (buildMeta(newTown).stats.population !== 48) throw new Error("four cottages should still be the free food tier");
if (foodRatio(newTown) !== 1) throw new Error("new city without a farm should stay fed");

const nextDoor = createCity();
nextDoor.terrain.fill(0);
if (!applyCommand(nextDoor, { type: "road", cells: [cellIndex(nextDoor, 4, 4), cellIndex(nextDoor, 6, 4)] }).ok) throw new Error("adj road");
if (!applyCommand(nextDoor, { type: "service", index: cellIndex(nextDoor, 4, 3), kind: ServiceKind.Power }).ok) throw new Error("adj plant");
if (!applyCommand(nextDoor, { type: "service", index: cellIndex(nextDoor, 6, 3), kind: ServiceKind.Water }).ok) throw new Error("adj water");
if (!applyCommand(nextDoor, { type: "build", kind: "cottage", cells: [cellIndex(nextDoor, 5, 3)] }).ok) throw new Error("adj house");
refreshUtilities(nextDoor);
if ((nextDoor.utility[cellIndex(nextDoor, 5, 3)] & 3) !== 3) throw new Error("house next to plants should be supplied");
if (!applyCommand(nextDoor, { type: "road", cells: [cellIndex(nextDoor, 4, 8)] }).ok) throw new Error("far road");
if (!applyCommand(nextDoor, { type: "build", kind: "cottage", cells: [cellIndex(nextDoor, 4, 7)] }).ok) throw new Error("far house");
refreshUtilities(nextDoor);
if ((nextDoor.utility[cellIndex(nextDoor, 4, 7)] & 1) !== 0) throw new Error("distant house should stay unpowered without a line");

{
  const lit = createCity();
  lit.terrain.fill(0);
  const road = [cellIndex(lit, 3, 5), cellIndex(lit, 4, 5), cellIndex(lit, 5, 5), cellIndex(lit, 6, 5), cellIndex(lit, 7, 5)];
  if (!applyCommand(lit, { type: "road", cells: road }).ok) throw new Error("lamp roads");
  if (!applyCommand(lit, { type: "service", index: cellIndex(lit, 3, 4), kind: ServiceKind.Power }).ok) throw new Error("lamp plant");
  const a = cellIndex(lit, 4, 4);
  const lamp = cellIndex(lit, 5, 4);
  const b = cellIndex(lit, 6, 4);
  const house = cellIndex(lit, 7, 4);
  if (!applyCommand(lit, { type: "line", cells: [a, lamp, b] }).ok) throw new Error("lamp lines");
  if (!applyCommand(lit, { type: "service", index: lamp, kind: ServiceKind.Lamp }).ok) throw new Error("place lamp on line");
  if (lit.services[lamp] !== ServiceKind.Lamp) throw new Error("lamp missing");
  if (!isLine(lit, lamp)) throw new Error("lamp should keep the power line");
  if (!applyCommand(lit, { type: "build", cells: [house], kind: "cottage" }).ok) throw new Error("lamp house");
  refreshUtilities(lit);
  if ((lit.utility[a] & 1) === 0 || (lit.utility[lamp] & 1) === 0 || (lit.utility[b] & 1) === 0) {
    throw new Error("power should pass through lamp");
  }
  if ((lit.utility[house] & 1) === 0) throw new Error("house past lamp should be powered");
}
if (canPlace(nextDoor, cellIndex(nextDoor, 4, 10), "build")) throw new Error("house two cells from a road must be illegal");

const farmTown = createCity();
farmTown.terrain.fill(0);
if (!applyCommand(farmTown, { type: "road", cells: [cellIndex(farmTown, 5, 5)] }).ok) throw new Error("farm road");
if (!applyCommand(farmTown, { type: "build", kind: "cottage", cells: [cellIndex(farmTown, 5, 6)] }).ok) throw new Error("farm cottage");
if (!applyCommand(farmTown, { type: "build", kind: "farm", cells: [cellIndex(farmTown, 6, 5)] }).ok) throw new Error("farm");
const farmCell = cellIndex(farmTown, 6, 5);
if (farmYield(farmTown, farmCell, 0) !== 0 || foodProduction(farmTown) !== 0) throw new Error("empty farm should produce nothing");
const grown = listAdults(farmTown, cellIndex(farmTown, 5, 6));
if (grown.length === 0) throw new Error("farm needs a worker");
if (!applyCommand(farmTown, { type: "hire", workplace: farmCell, home: grown[0].home, slot: grown[0].slot }).ok) throw new Error("farm hire");
if (foodProduction(farmTown) <= 0) throw new Error("staffed farm should produce food");
if (farmYield(farmTown, farmCell, 1) < foodNeed(96)) throw new Error("one farm worker should feed a small growing city");
if (foodRatio(farmTown) < 1) throw new Error("starter farm town should stay fed");
const wheatYield = farmYield(farmTown, farmCell, 2);
if (!applyCommand(farmTown, { type: "farm", index: farmCell, action: "livestock" }).ok) throw new Error("buy livestock");
if ((farmTown.skills[farmCell] & 8) === 0) throw new Error("livestock bit missing");
const herdYield = farmYield(farmTown, farmCell, 2);
if (herdYield <= wheatYield) throw new Error("livestock should produce more food than wheat");
if (!applyCommand(farmTown, { type: "farm", index: farmCell, action: "irrigation" }).ok) throw new Error("irrigation");
if (farmYield(farmTown, farmCell, 2) <= herdYield) throw new Error("irrigation should boost yield");
if (!applyCommand(farmTown, { type: "farm", index: farmCell, action: "wheat" }).ok) throw new Error("back to wheat");
if ((farmTown.skills[farmCell] & 8) !== 0) throw new Error("wheat mode should clear livestock bit");

const air = createCity();
air.terrain.fill(0);
air.funds = 100_000;
if (!applyCommand(air, { type: "road", cells: [cellIndex(air, 10, 10)] }).ok) throw new Error("air road");
const airportPurse = air.funds;
const airCell = cellIndex(air, 10, 9);
if (!applyCommand(air, { type: "service", index: airCell, kind: ServiceKind.Airport }).ok) throw new Error("airport");
if (airportPurse - air.funds !== 48000) throw new Error(`airport cost ${airportPurse - air.funds}`);
const booksAir = cityLedger(air);
if (booksAir.income < 200) throw new Error(`airport should pay ${booksAir.income}`);
const beforeFood = air.food;
const bought = applyCommand(air, { type: "trade", index: airCell, deal: "grain" });
if (!bought.ok || air.food !== beforeFood + 2) throw new Error("grain import");
const grainMeta = buildMeta(air);
if (grainMeta.stats.foodStock !== air.food || grainMeta.food !== air.food) {
  throw new Error("grain must raise the one city-wide food stock");
}
if (!applyCommand(air, { type: "trade", index: airCell, deal: "food_in" }).ok || air.food !== 6) throw new Error("food import");
const sold = applyCommand(air, { type: "trade", index: airCell, deal: "food_out" });
if (!sold.ok || air.food !== 2) throw new Error("food export");
if (applyCommand(air, { type: "trade", index: airCell, deal: "wares" }).ok) throw new Error("wares need commercial");

const wiredAir = createCity();
wiredAir.terrain.fill(0);
wiredAir.funds = 200_000;
if (!applyCommand(wiredAir, { type: "road", cells: [cellIndex(wiredAir, 4, 4), cellIndex(wiredAir, 6, 4), cellIndex(wiredAir, 8, 4)] }).ok) {
  throw new Error("wired air road");
}
if (!applyCommand(wiredAir, { type: "service", index: cellIndex(wiredAir, 4, 3), kind: ServiceKind.Power }).ok) throw new Error("wired air plant");
if (!applyCommand(wiredAir, { type: "service", index: cellIndex(wiredAir, 8, 3), kind: ServiceKind.Water }).ok) throw new Error("wired air water");
const wiredAirport = cellIndex(wiredAir, 6, 5);
if (!applyCommand(wiredAir, { type: "service", index: wiredAirport, kind: ServiceKind.Airport }).ok) throw new Error("wired airport");
if (!applyCommand(wiredAir, { type: "build", kind: "cottage", cells: [cellIndex(wiredAir, 4, 5)] }).ok) throw new Error("wired air house");
if (!applyCommand(wiredAir, { type: "line", cells: [cellIndex(wiredAir, 4, 4), cellIndex(wiredAir, 5, 4), cellIndex(wiredAir, 6, 4)] }).ok) {
  throw new Error("wired air line");
}
if (!applyCommand(wiredAir, { type: "pipe", cells: [cellIndex(wiredAir, 8, 4), cellIndex(wiredAir, 7, 4), cellIndex(wiredAir, 6, 4)] }).ok) {
  throw new Error("wired air pipe");
}
refreshUtilities(wiredAir);
if ((wiredAir.utility[wiredAirport] & 3) !== 3) throw new Error(`airport lines should supply ${wiredAir.utility[wiredAirport]}`);
if ((wiredAir.utility[cellIndex(wiredAir, 4, 5)] & 1) === 0) throw new Error("house on the same power line should stay powered");
if ((wiredAir.utility[cellIndex(wiredAir, 4, 4)] & 1) === 0) throw new Error("power line to airport should stay live");
if ((wiredAir.utility[cellIndex(wiredAir, 8, 4)] & 2) === 0) throw new Error("water pipe to airport should stay live");
const grain = applyCommand(wiredAir, { type: "trade", index: wiredAirport, deal: "grain" });
if (!grain.ok || wiredAir.food !== 2) throw new Error("supplied airport should still trade");

const nextAir = createCity();
nextAir.terrain.fill(0);
nextAir.funds = 200_000;
if (!applyCommand(nextAir, { type: "road", cells: [cellIndex(nextAir, 5, 4), cellIndex(nextAir, 6, 4), cellIndex(nextAir, 7, 4)] }).ok) {
  throw new Error("adj air road");
}
if (!applyCommand(nextAir, { type: "service", index: cellIndex(nextAir, 5, 5), kind: ServiceKind.Power }).ok) throw new Error("adj air plant");
if (!applyCommand(nextAir, { type: "service", index: cellIndex(nextAir, 7, 5), kind: ServiceKind.Water }).ok) throw new Error("adj air water");
const nextAirport = cellIndex(nextAir, 6, 5);
if (!applyCommand(nextAir, { type: "service", index: nextAirport, kind: ServiceKind.Airport }).ok) throw new Error("adj airport");
refreshUtilities(nextAir);
if ((nextAir.utility[nextAirport] & 3) !== 3) throw new Error(`airport next to plants should be supplied ${nextAir.utility[nextAirport]}`);

const darkAir = createCity();
darkAir.terrain.fill(0);
darkAir.funds = 200_000;
if (!applyCommand(darkAir, { type: "road", cells: [cellIndex(darkAir, 4, 4), cellIndex(darkAir, 10, 4)] }).ok) throw new Error("dark air road");
if (!applyCommand(darkAir, { type: "service", index: cellIndex(darkAir, 10, 3), kind: ServiceKind.Power }).ok) throw new Error("dark air plant");
if (!applyCommand(darkAir, { type: "service", index: cellIndex(darkAir, 10, 5), kind: ServiceKind.Water }).ok) throw new Error("dark air water");
const darkAirport = cellIndex(darkAir, 4, 5);
if (!applyCommand(darkAir, { type: "service", index: darkAirport, kind: ServiceKind.Airport }).ok) throw new Error("dark airport");
refreshUtilities(darkAir);
if ((darkAir.utility[darkAirport] & 3) !== 0) throw new Error(`distant airport should stay unsupplied ${darkAir.utility[darkAirport]}`);

const grainTown = createCity();
grainTown.terrain.fill(0);
grainTown.funds = 200_000;
if (!applyCommand(grainTown, { type: "road", cells: [10, 11, 12, 13, 14].map((x) => cellIndex(grainTown, x, 10)) }).ok) {
  throw new Error("grain town road");
}
for (const x of [10, 11, 12, 13, 14]) {
  if (!applyCommand(grainTown, { type: "build", kind: "cottage", cells: [cellIndex(grainTown, x, 11)] }).ok) throw new Error("grain town cottage");
}
const grainPort = cellIndex(grainTown, 10, 9);
if (!applyCommand(grainTown, { type: "service", index: grainPort, kind: ServiceKind.Airport }).ok) throw new Error("grain town airport");
const hungry = buildMeta(grainTown);
if (hungry.stats.population !== 60 || hungry.stats.foodUsed !== 1 || hungry.stats.foodCapacity !== 0) {
  throw new Error(`grain town need ${hungry.stats.foodUsed}/${hungry.stats.foodCapacity} pop=${hungry.stats.population}`);
}
if (hungry.stats.foodStock !== 0) throw new Error("grain town should start with empty stock");
if (!applyCommand(grainTown, { type: "trade", index: grainPort, deal: "grain" }).ok) throw new Error("grain town buy");
const grainFed = buildMeta(grainTown);
if (grainTown.food !== 2 || grainFed.stats.foodStock !== 2 || grainFed.food !== 2) {
  throw new Error(`grain buy should add +2 to the global stock ${grainTown.food} ${grainFed.stats.foodStock}`);
}
if (grainFed.stats.foodUsed !== 1 || grainFed.stats.foodCapacity !== 0) {
  throw new Error("import must not be a second warehouse next to need/production");
}

const restoredFood = saveToCity(cityToSave(farmTown, "food"));
if (!restoredFood || restoredFood.food !== farmTown.food) throw new Error("food did not save");

if (DAY_TICKS !== 600) throw new Error("day length should stay 5 minutes");
const noon = climateAt(Math.floor(DAY_TICKS * 0.5));
const midnight = climateAt(0);
if (noon.daylight <= midnight.daylight) throw new Error("noon should be brighter than midnight");
if (midnight.daylight < 0.1) throw new Error("night lighting must stay readable, not pitch black");
if (!/^\d{2}:\d{2}$/.test(noon.clock)) throw new Error(`bad clock ${noon.clock}`);
{
  const dawn = climateAt(createCity().tick);
  if (dawn.clock !== "07:00") throw new Error(`new city should start at 07:00, got ${dawn.clock}`);
  if (dawn.isNight) throw new Error("new city should not start in the dark");
  const levelDawn = climateAt(createLevelCity(LEVELS[0]).tick);
  if (levelDawn.clock !== dawn.clock) throw new Error("level cities should share the freeplay morning clock");
}
const walkers = streetPedestrians(city);
for (const ped of walkers) {
  if (ped.child) continue;
  const adult = listAdults(city, ped.home).find((entry) => entry.name === ped.name);
  if (adult && isOnDuty(adult.home, adult.slot, adult.workplace, climateAt(city.tick))) {
    throw new Error("on-duty adults must not walk the sidewalk");
  }
}

{
  const crush = createCity();
  crush.terrain.fill(0);
  const house = cellIndex(crush, 5, 4);
  if (!applyCommand(crush, { type: "road", cells: [cellIndex(crush, 5, 5)] }).ok) throw new Error("crush road");
  if (!applyCommand(crush, { type: "build", kind: "cottage", cells: [house] }).ok) throw new Error("crush cottage");
  if (canPlace(crush, house, "road")) throw new Error("road must not overwrite a house");
  if (applyCommand(crush, { type: "road", cells: [house] }).ok) throw new Error("road overwrote a house");
  if (crush.levels[house] !== 1) throw new Error("house vanished under a road");
}

{
  const peel = createCity();
  peel.terrain.fill(0);
  const cell = cellIndex(peel, 4, 4);
  if (!applyCommand(peel, { type: "road", cells: [cell] }).ok) throw new Error("peel road");
  if (!applyCommand(peel, { type: "line", cells: [cell] }).ok) throw new Error("peel line");
  if (!applyCommand(peel, { type: "service", index: cell, kind: ServiceKind.Lamp }).ok) throw new Error("peel lamp");
  if (!applyCommand(peel, { type: "bulldoze", cells: [cell] }).ok) throw new Error("peel bulldoze");
  if (peel.services[cell] !== ServiceKind.None) throw new Error("lamp should be gone");
  if (!isRoad(peel, cell) || !isLine(peel, cell)) throw new Error("road/line must survive lamp bulldoze");
}

{
  const plant = createCity();
  plant.terrain.fill(0);
  if (!applyCommand(plant, { type: "road", cells: [cellIndex(plant, 3, 3)] }).ok) throw new Error("plant road");
  const power = cellIndex(plant, 3, 2);
  const water = cellIndex(plant, 4, 3);
  if (!applyCommand(plant, { type: "service", index: power, kind: ServiceKind.Power }).ok) throw new Error("plant power");
  if (!applyCommand(plant, { type: "service", index: water, kind: ServiceKind.Water }).ok) throw new Error("plant water");
  refreshUtilities(plant);
  if ((plant.utility[power] & 1) === 0) throw new Error("power plant should show as powered");
  if ((plant.utility[water] & 2) === 0) throw new Error("water plant should show as watered");
}

{
  const stock = createCity();
  stock.terrain.fill(0);
  stock.funds = 50_000;
  stock.food = 119;
  if (!applyCommand(stock, { type: "road", cells: [cellIndex(stock, 2, 2)] }).ok) throw new Error("stock road");
  const pad = cellIndex(stock, 2, 1);
  if (!applyCommand(stock, { type: "service", index: pad, kind: ServiceKind.Airport }).ok) throw new Error("stock airport");
  if (applyCommand(stock, { type: "trade", index: pad, deal: "food_in" }).ok) throw new Error("full stock must reject food import");
  if (stock.food !== 119) throw new Error("rejected import changed food");
}

{
  const tagged = createCity(undefined, undefined, { seed: 42, biome: "alpine", forest: 70 });
  const meta = buildMeta(tagged);
  if (!meta.gen || meta.gen.biome !== "alpine" || meta.gen.seed !== 42) throw new Error("meta must carry map gen");
  const copy = createCity();
  writeCity(copy, packCells(tagged), meta);
  if (copy.gen?.biome !== "alpine" || copy.gen?.forest !== 70) throw new Error("writeCity must restore gen");
}

console.log(`smoke ok pop=${meta.stats.population} levels=${levels} funds=${meta.stats.funds} traffic=${meta.stats.traffic} tutorial=${tutorialStatus.won}`);
