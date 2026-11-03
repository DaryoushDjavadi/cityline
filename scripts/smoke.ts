import { applyCommand, buildMeta, canPlace, cellCoords, cellIndex, cityLedger, cityToSave, createCity, isBridge, isRoad, lineCells, listAdults, refreshUtilities, saveToCity, stepSimulation } from "../shared/src/index.ts";

const city = createCity();
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
if (!applyCommand(fed, { type: "line", cells: [cellIndex(fed, 8, 8), cellIndex(fed, 9, 9)] }).ok) throw new Error("bend line");
fed.levels[row[0]] = 1;
refreshUtilities(fed);
if ((fed.utility[cellIndex(fed, 9, 9)] & 1) === 0) throw new Error("diagonal line did not conduct");
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
const factory = cellIndex(jobs, 4, 6);
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

console.log(`smoke ok pop=${meta.stats.population} levels=${levels} funds=${meta.stats.funds} traffic=${meta.stats.traffic}`);
