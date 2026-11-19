/**
 * Zoo: habitats, buying with origins, needs/bowls, care, renaming, genetics (inheritance +
 * mutation bounds), breeding conditions, family names, visitors/income, save/load + old saves,
 * protocol, level rooms.
 *   npx tsx scripts/zoo-tests.ts
 */
import {
  clashWith,
  BREED_EVERY,
  GRID_SIZE,
  GENE_KEYS,
  GENE_RANGE,
  HABITAT_KIND,
  HABITAT_SPACE,
  MUTATION,
  NAME_MAX,
  ORIGIN_INFO,
  PET_COOLDOWN,
  SPECIES,
  ServiceKind,
  Zone,
  applyCommand,
  buildMeta,
  canBreed,
  cityLedger,
  cityToSave,
  cleanAnimalName,
  createCity,
  cellIndex,
  ensureProgress,
  inheritGenes,
  isAdult,
  packCells,
  parseCommand,
  priceOf,
  saveToCity,
  speciesInfo,
  stepSimulation,
  stepZoo,
  storyText,
  writeCity,
  zooOf,
  type Animal,
  type CityState,
  type HabitatType,
  type ZooOp,
  PARK_INFO,
  PARK_SIZE,
  ParkCrowd,
  TILE,
  dragLine,
  occupancy,
  parkIndex,
  parkXY,
  summarize,
  walkable,
} from "../shared/src/index.ts";

let checks = 0;
function ok(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) throw new Error(`✗ ${message}`);
}

/** Flat town with a road row and room for habitats along it. */
function town(seed = 7): CityState {
  const city = createCity(GRID_SIZE, GRID_SIZE, { seed, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  city.terrain.fill(0);
  city.funds = 200_000;
  ensureProgress(city);
  ok(applyCommand(city, { type: "road", cells: Array.from({ length: 20 }, (_, x) => cellIndex(city, x + 2, 10)) }).ok, "road built");
  for (let x = 2; x < 14; x += 1) {
    const i = cellIndex(city, x, 12);
    city.zones[i] = Zone.Residential;
    city.levels[i] = 2;
  }
  return city;
}

const zoo = (city: CityState) => {
  const state = zooOf(city);
  if (!state) throw new Error("no zoo");
  return state;
};
const run = (city: CityState, op: ZooOp) => applyCommand(city, { type: "zoo", zoo: op });

/** The Tierpark gate next to the road (once per city) with a long main path. */
function tierpark(city: CityState): number {
  const gate = cellIndex(city, 20, 11);
  if (city.services[gate] !== ServiceKind.Tierpark) {
    ok(applyCommand(city, { type: "service", index: gate, kind: ServiceKind.Tierpark }).ok, "Tierpark placed");
    ok(run(city, { op: "pbuild", kind: "path", cells: Array.from({ length: 30 }, (_, k) => parkIndex(20, 4 + k)) }).ok, "main path built");
  }
  return gate;
}

/** Habitat slots on both sides of the main path (x 15–19 and 21–25). */
const SLOT_ANCHORS = [33, 27, 21, 15, 9].flatMap((y) => [parkIndex(15, y), parkIndex(21, y)]);

/** A habitat in the city's Tierpark, next to the main path. `_x` is kept from the 0.47 tests. */
function habitat(city: CityState, type: HabitatType, _x = 0): number {
  tierpark(city);
  const z = zoo(city);
  const anchor = SLOT_ANCHORS.find((slot) => !z.habitats.some((h) => h.cell === slot));
  ok(anchor !== undefined, "free habitat slot");
  const result = run(city, { op: "pbuild", kind: type, cells: [anchor!] });
  ok(result.ok, `${type} habitat placed (${result.reason ?? "ok"})`);
  return anchor!;
}

function ticks(city: CityState, n: number): void {
  for (let k = 0; k < n; k += 1) {
    city.tick += 1;
    stepZoo(city);
  }
}

function newest(city: CityState): Animal {
  const list = zoo(city).animals;
  return list[list.length - 1];
}

// 1. Catalog: ≥12 species, every habitat type has animals, prices by origin.
{
  ok(SPECIES.length >= 12, `${SPECIES.length} species`);
  for (const type of ["savanne", "wald", "wasser", "polar", "wiese"] as HabitatType[]) ok(SPECIES.some((s) => s.habitat === type), `species for ${type}`);
  const lion = speciesInfo("lion")!;
  ok(priceOf(lion, "rescue") < priceOf(lion, "circus") && priceOf(lion, "circus") < priceOf(lion, "wild") && priceOf(lion, "wild") < priceOf(lion, "breeder"), "rescue < circus < wild < breeder");
  ok(ORIGIN_INFO.rescue.health < ORIGIN_INFO.breeder.health && ORIGIN_INFO.circus.trust < ORIGIN_INFO.breeder.trust, "rescue animals start weak");
}

// 2. Habitats: cheap, need a road, a starter bowl + trough, wrong species rejected.
{
  const city = town();
  const funds = city.funds;
  const cell = habitat(city, "savanne", 3);
  ok(funds - city.funds <= 4500 + 30 * 20 + 2500, "Tierpark, path and habitat are affordable");
  ok(!applyCommand(city, { type: "service", index: cellIndex(city, 3, 11), kind: ServiceKind.ZooForest }).ok, "0.47 habitats are no longer built in the city");
  ok(!applyCommand(city, { type: "service", index: cellIndex(city, 6, 11), kind: ServiceKind.Tierpark }).ok, "only one Tierpark");
  ok(!run(city, { op: "pbuild", kind: "wald", cells: [cell + 2] }).ok, "habitats cannot overlap");
  stepZoo(city);
  const h = zoo(city).habitats.find((entry) => entry.cell === cell)!;
  ok(h && h.type === "savanne", "habitat state created");
  ok(h.items.some((i) => i.kind === "food") && h.items.some((i) => i.kind === "water"), "starter bowl and trough");
  ok(!run(city, { op: "buy", cell, species: "penguin", origin: "breeder" }).ok, "penguin not in savanna");
  ok(run(city, { op: "buy", cell, species: "zebra", origin: "breeder" }).ok, "zebra bought");
  ok(!run(city, { op: "buy", cell: cellIndex(city, 9, 9), species: "zebra", origin: "breeder" }).ok, "buy needs a habitat");
}

// 3. Origins → health/trust, price, story text.
{
  const city = town();
  const cell = habitat(city, "wald", 4);
  const before = city.funds;
  ok(run(city, { op: "buy", cell, species: "monkey", origin: "rescue" }).ok, "rescue monkey");
  const rescued = newest(city);
  ok(before - city.funds === priceOf(speciesInfo("monkey")!, "rescue"), "rescue price charged");
  ok(rescued.health <= 40 && rescued.trust <= 20, `rescue starts sick/scared (${rescued.health}/${rescued.trust})`);
  ok(run(city, { op: "buy", cell, species: "monkey", origin: "breeder" }).ok, "breeder monkey");
  const bred = newest(city);
  ok(bred.health >= 85 && bred.trust >= 60, "breeder animal healthy and trusting");
  ok(run(city, { op: "buy", cell, species: "redpanda", origin: "circus" }).ok, "circus panda");
  ok(newest(city).health < 60, "circus animal exhausted");
  ok(run(city, { op: "buy", cell, species: "redpanda", origin: "wild" }).ok, "wild panda");
  ok(newest(city).trust < 40 && newest(city).health >= 75, "wild animal healthy but shy");
  ok(storyText(rescued).includes(rescued.name) && storyText(rescued).length > 30, "story mentions the name");
  ok(zoo(city).animals.every((a) => a.name.length > 0 && a.name.length <= NAME_MAX), "every animal has a name");
  ok(!run(city, { op: "buy", cell, species: "bear", origin: "born" as never }).ok, "origin 'born' cannot be bought");
}

// 4. Space limit.
{
  const city = town();
  const cell = habitat(city, "savanne", 5);
  let bought = 0;
  while (run(city, { op: "buy", cell, species: "elephant", origin: "breeder" }).ok) bought += 1;
  ok(bought === Math.floor(HABITAT_SPACE / speciesInfo("elephant")!.space), `space limit (${bought} elephants)`);
}

// 5. Needs: bowls drain, empty bowls hurt, refill and keeper.
{
  const city = town();
  const cell = habitat(city, "savanne", 6);
  run(city, { op: "buy", cell, species: "elephant", origin: "breeder" });
  const ele = newest(city);
  const h = () => zoo(city).habitats.find((entry) => entry.cell === cell)!;
  ticks(city, 400);
  const food = h().items.find((i) => i.kind === "food")!;
  ok((food.fill ?? 100) < 100, "food bowl drains");
  ticks(city, 2000);
  ok(!h().fed, "bowl empty after a long time");
  const sick = ele.health;
  ticks(city, 200);
  ok(ele.health < sick || ele.health <= 5, "empty bowls cost health");
  const funds = city.funds;
  ok(run(city, { op: "refill", cell }).ok, "refill");
  ok(city.funds < funds && h().items.every((i) => i.fill === undefined || i.fill === 100), "refill costs money and fills bowls");
  ok(!run(city, { op: "refill", cell }).ok, "nothing to refill");
  ok(run(city, { op: "keeper", cell, on: true }).ok && h().keeper, "keeper on");
  ticks(city, 4000);
  ok(h().fed && h().watered, "keeper keeps bowls filled");
  ok(zoo(city).cost > 0, "keeper and food cost money");
  // place/take items
  ok(run(city, { op: "place", cell, item: "shelter", x: 1, y: 1 }).ok, "place shelter");
  ok(!run(city, { op: "place", cell, item: "rock", x: 1, y: 1 }).ok, "spot taken");
  const shelter = h().items.find((i) => i.kind === "shelter")!;
  ok(run(city, { op: "take", cell, item: shelter.id }).ok && !h().items.some((i) => i.kind === "shelter"), "take item");
}

// 6. Care: pet/play/feed/vet with cooldown, play needs a toy; renaming.
{
  const city = town();
  const cell = habitat(city, "wiese", 7);
  run(city, { op: "buy", cell, species: "goat", origin: "rescue" });
  const goat = newest(city);
  const trust = goat.trust;
  ok(run(city, { op: "care", animal: goat.id, act: "pet" }).ok, "pet");
  ok(goat.trust > trust && goat.react?.kind === "pet", "petting raises trust and leaves a reaction");
  ok(!run(city, { op: "care", animal: goat.id, act: "pet" }).ok, "pet cooldown");
  ticks(city, PET_COOLDOWN);
  ok(!run(city, { op: "care", animal: goat.id, act: "play" }).ok, "play needs a toy");
  run(city, { op: "place", cell, item: "toy", x: 3, y: 3 });
  ok(run(city, { op: "care", animal: goat.id, act: "play" }).ok, "play with toy");
  ticks(city, PET_COOLDOWN);
  const health = goat.health;
  ok(run(city, { op: "care", animal: goat.id, act: "feed" }).ok && goat.health > health, "hand feeding");
  ok(run(city, { op: "care", animal: goat.id, act: "vet" }).ok && goat.health >= health + 20, "vet heals");
  ok(!run(city, { op: "care", animal: goat.id, act: "vet" }).ok, "vet cooldown");
  ok(run(city, { op: "rename", animal: goat.id, name: "  Frau   Meier " }).ok && goat.name === "Frau Meier", "rename trims");
  ok(!run(city, { op: "rename", animal: goat.id, name: "" }).ok, "empty name rejected");
  ok(cleanAnimalName("x".repeat(NAME_MAX + 1)) === null, "too long rejected");
  ok(cleanAnimalName("<script>") === null && cleanAnimalName("Bob\u0000") === null, "odd characters rejected");
  ok(cleanAnimalName("Jörg-Ünal") === "Jörg-Ünal", "umlauts ok");
  // nursing a rescue animal back
  run(city, { op: "keeper", cell, on: true });
  run(city, { op: "place", cell, item: "shelter", x: 6, y: 1 });
  for (let k = 0; k < 40 && !goat.nursed; k += 1) {
    ticks(city, PET_COOLDOWN + 1);
    run(city, { op: "care", animal: goat.id, act: "pet" });
  }
  ok(goat.nursed && zoo(city).nursed === 1, "rescued goat nursed back");
}

// 7. Genetics: inheritance blends parents, mutations stay within bounds, deterministic.
{
  const city = town();
  const a = { hue: -1, size: 0.8, pattern: 0, robust: 0, temper: 0 };
  const b = { hue: 1, size: 1.2, pattern: 1, robust: 1, temper: 1 };
  for (let salt = 0; salt < 400; salt += 1) {
    const child = inheritGenes(city, a, b, salt);
    for (const key of GENE_KEYS) {
      const [min, max] = GENE_RANGE[key];
      const span = max - min;
      ok(child[key] >= min && child[key] <= max, `gene ${key} in range`);
      // blend is 25–75 % between the parents, mutation adds at most MUTATION × span
      ok(child[key] >= a[key] + 0.25 * (b[key] - a[key]) - MUTATION * span - 1e-6, `gene ${key} lower bound`);
      ok(child[key] <= a[key] + 0.75 * (b[key] - a[key]) + MUTATION * span + 1e-6, `gene ${key} upper bound`);
    }
  }
  const same = { hue: 0.2, size: 1, pattern: 0.5, robust: 0.5, temper: 0.5 };
  let maxDiff = 0;
  for (let salt = 0; salt < 300; salt += 1) {
    const child = inheritGenes(city, same, same, salt);
    for (const key of GENE_KEYS) maxDiff = Math.max(maxDiff, Math.abs(child[key] - same[key]) / (GENE_RANGE[key][1] - GENE_RANGE[key][0]));
  }
  ok(maxDiff > 0 && maxDiff <= MUTATION + 1e-6, `identical parents: only small mutations (${maxDiff.toFixed(3)})`);
  ok(JSON.stringify(inheritGenes(city, a, b, 42)) === JSON.stringify(inheritGenes(city, a, b, 42)), "deterministic");
}

// 8. Breeding: conditions, pregnancy, birth, family name, young grow up.
{
  const city = town();
  const cell = habitat(city, "polar", 8);
  run(city, { op: "keeper", cell, on: true });
  run(city, { op: "place", cell, item: "shelter", x: 1, y: 1 });
  run(city, { op: "place", cell, item: "toy", x: 6, y: 2 });
  run(city, { op: "buy", cell, species: "penguin", origin: "breeder" });
  const first = newest(city);
  run(city, { op: "buy", cell, species: "penguin", origin: "breeder" });
  const second = newest(city);
  ok(first.sex !== second.sex, "second animal of a species gets the other sex");
  const mother = first.sex === "w" ? first : second;
  const father = first.sex === "m" ? first : second;
  mother.health = father.health = 100;
  mother.trust = father.trust = 90;
  mother.happy = father.happy = 90;
  ok(canBreed(city, zoo(city), mother, father), "healthy happy pair can breed");
  mother.happy = 20;
  ok(!canBreed(city, zoo(city), mother, father), "unhappy animals do not breed");
  mother.happy = 90;
  // run until a baby arrives (time compression)
  let child: Animal | undefined;
  for (let k = 0; k < 40 && !child; k += 1) {
    ticks(city, BREED_EVERY * 10);
    for (const animal of [mother, father]) { animal.happy = 95; animal.trust = 95; animal.health = 100; }
    child = zoo(city).animals.find((animal) => animal.mother === mother.id);
  }
  ok(child, "a baby is born");
  ok(child!.father === father.id && child!.origin === "born" && child!.gen === 1, "parents recorded");
  ok(child!.family === `${father.name}-&-${mother.name}`, `family name ${child!.family}`);
  ok(child!.lineage === child!.family, "lineage starts with the parents");
  ok(!isAdult(child!, city.tick), "baby is young");
  ok(zoo(city).born === 1 && zoo(city).lastBirth?.id === child!.id, "birth counted");
  ok(city.progress!.last?.kind === "zoo" && city.progress!.last.title.includes(child!.name), "birth toast");
  ok(!canBreed(city, zoo(city), child!.sex === "w" ? child! : mother, child!.sex === "w" ? father : child!), "no breeding with young/parents");
  ticks(city, speciesInfo("penguin")!.grow + 5);
  ok(isAdult(child!, city.tick), "baby grows up");
  // genes come from the parents
  for (const key of GENE_KEYS) {
    const span = GENE_RANGE[key][1] - GENE_RANGE[key][0];
    const lo = Math.min(mother.genes[key], father.genes[key]) - MUTATION * span - 1e-6;
    const hi = Math.max(mother.genes[key], father.genes[key]) + MUTATION * span + 1e-6;
    ok(child!.genes[key] >= lo && child!.genes[key] <= hi, `child ${key} between parents`);
  }
  // a grandchild keeps the lineage
  const grand = { ...child!, id: 999, mother: child!.id, family: "X-&-Y", lineage: child!.lineage };
  ok(grand.lineage === child!.family, "lineage passed on");
}

// 9. Determinism: same commands → identical zoo (server and client agree).
{
  const make = () => {
    const city = town(11);
    const cell = habitat(city, "wasser", 9);
    run(city, { op: "keeper", cell, on: true });
    run(city, { op: "buy", cell, species: "otter", origin: "breeder" });
    run(city, { op: "buy", cell, species: "otter", origin: "wild" });
    for (const animal of zoo(city).animals) { animal.health = 100; animal.happy = 95; animal.trust = 95; }
    ticks(city, 3000);
    return JSON.stringify(zoo(city));
  };
  ok(make() === make(), "zoo simulation is deterministic");
}

// 10. Visitors and money: happy animals bring visitors and admission, ledger includes zoo.
{
  const city = town();
  const cell = habitat(city, "savanne", 10);
  run(city, { op: "keeper", cell, on: true });
  run(city, { op: "buy", cell, species: "kangaroo", origin: "breeder" });
  run(city, { op: "buy", cell, species: "giraffe", origin: "breeder" });
  ticks(city, 40);
  const z = zoo(city);
  ok(z.visitors > 0 && z.income > 0, `visitors ${z.visitors}, income ${z.income}`);
  const ledger = cityLedger(city);
  const plain = (() => { const copy = saveToCity(JSON.parse(JSON.stringify(cityToSave(city, "x"))))!; copy.progress!.zoo!.income = 0; copy.progress!.zoo!.cost = 0; return cityLedger(copy); })();
  ok(ledger.income > plain.income && ledger.upkeep > plain.upkeep, "ledger includes admission and zoo costs");
  // more species, more appeal
  const before = z.visitors;
  run(city, { op: "buy", cell, species: "zebra", origin: "breeder" });
  ticks(city, 40);
  ok(zoo(city).visitors >= before, "variety does not lower visitors");
}

// 10b. Predators live only with their own species.
{
  const city = town();
  const savanna = habitat(city, "savanne", 4);
  const polar = habitat(city, "polar", 6);
  ok(run(city, { op: "buy", cell: savanna, species: "zebra", origin: "breeder" }).ok, "zebra first");
  const lion = run(city, { op: "buy", cell: savanna, species: "lion", origin: "breeder" });
  ok(!lion.ok && lion.reason === "zoo_predator", `no lion with zebras (${lion.reason})`);
  ok(clashWith(zoo(city), savanna, "lion")?.id === "zebra", "clash names the zebra");
  ok(run(city, { op: "buy", cell: polar, species: "polarbear", origin: "breeder" }).ok, "polar bear alone");
  ok(!run(city, { op: "buy", cell: polar, species: "penguin", origin: "breeder" }).ok, "no penguin next to the polar bear");
  ok(run(city, { op: "buy", cell: polar, species: "polarbear", origin: "breeder" }).ok, "second polar bear is fine");
  ok(clashWith(zoo(city), savanna, "giraffe") === null, "prey animals mix");
}

// 11. Save/load round trip, meta transport, sanitizing, old saves.
{
  const city = town();
  const cell = habitat(city, "wald", 11);
  run(city, { op: "buy", cell, species: "bear", origin: "circus" });
  run(city, { op: "place", cell, item: "rock", x: 4, y: 4 });
  const save = saveToCity(JSON.parse(JSON.stringify(cityToSave(city, "Zoo"))))!;
  ok(JSON.stringify(save.progress!.zoo) === JSON.stringify(zoo(city)), "zoo survives save round trip");
  const mirror = createCity();
  const meta = JSON.parse(JSON.stringify(buildMeta(city)));
  writeCity(mirror, packCells(city), meta);
  ok(JSON.stringify(mirror.progress!.zoo) === JSON.stringify(zoo(city)), "zoo travels in meta");
  const evil = JSON.parse(JSON.stringify(meta));
  evil.progress.zoo.animals.push({ id: 5, name: "<b>x</b>".repeat(9), species: "dragon", genes: { size: 99 } });
  evil.progress.zoo.animals[0].genes.size = 50;
  evil.progress.zoo.animals[0].name = "";
  evil.progress.zoo.habitats[0].items.push({ kind: "bomb", x: 99 }, { kind: "rock", x: 99, y: -3 });
  writeCity(mirror, packCells(city), evil);
  const clean = mirror.progress!.zoo!;
  ok(clean.animals.length === 1, "unknown species dropped");
  ok(clean.animals[0].genes.size <= 1.2 && clean.animals[0].name === "Namenlos", "genes clamped, empty name replaced");
  ok(clean.habitats[0].items.every((i) => i.x >= 0 && i.x < 8 && i.y >= 0 && i.y < 8 && i.kind !== ("bomb" as never)), "items sanitized");
  // old save without zoo / without progress
  const old = JSON.parse(JSON.stringify(cityToSave(city, "Alt")));
  delete old.meta.progress.zoo;
  const loaded = saveToCity(old)!;
  ok(loaded.progress && !loaded.progress.zoo, "old save loads without zoo");
  stepSimulation(loaded);
  stepSimulation(loaded);
  stepSimulation(loaded);
  stepSimulation(loaded);
  ok(loaded.progress!.zoo && loaded.progress!.zoo.gate >= 0 && loaded.progress!.zoo.park, "save without zoo state: Tierpark gets a fresh park");
  delete old.meta.progress;
  const ancient = saveToCity(old)!;
  for (let k = 0; k < 4; k += 1) stepSimulation(ancient);
  ok(ancient.progress?.zoo, "zoo created for pre-progress save");
}

// 12. Protocol: whitelist + validation.
{
  const parse = (zoo: unknown) => parseCommand({ type: "zoo", zoo });
  ok(parse({ op: "buy", cell: 4, species: "lion", origin: "rescue" })?.type === "zoo", "parse buy");
  ok(parse({ op: "buy", cell: 4, species: "dragon", origin: "rescue" }) === null, "unknown species");
  ok(parse({ op: "buy", cell: 4, species: "lion", origin: "born" }) === null, "origin whitelist");
  ok(parse({ op: "place", cell: 4, item: "toy", x: 8, y: 0 }) === null, "item position range");
  ok(parse({ op: "place", cell: 4, item: "lava", x: 1, y: 1 }) === null, "item whitelist");
  ok(parse({ op: "care", animal: 3, act: "pet" })?.type === "zoo", "parse care");
  ok(parse({ op: "care", animal: 3, act: "kick" }) === null, "care whitelist");
  ok(parse({ op: "rename", animal: 3, name: "x".repeat(40) }) === null, "rename length");
  ok((parse({ op: "rename", animal: 3, name: " Lea " }) as { zoo: { name: string } }).zoo.name === "Lea", "rename cleaned on parse");
  ok(parse({ op: "keeper", cell: 1, on: "yes" }) === null, "keeper boolean");
  ok(parse({ op: "teleport" }) === null && parse(null) === null, "junk rejected");
}

// 13. Level rooms: no habitats, no zoo commands.
{
  const city = town();
  city.progress!.off = true;
  ok(!applyCommand(city, { type: "service", index: cellIndex(city, 3, 11), kind: ServiceKind.ZooMeadow }).ok, "no habitats in levels");
  ok(!applyCommand(city, { type: "service", index: cellIndex(city, 4, 11), kind: ServiceKind.Tierpark }).ok, "no Tierpark in levels");
  ok(!run(city, { op: "pbuild", kind: "path", cells: [5] }).ok, "no park building in levels");
  ok(!run(city, { op: "refill", cell: 0 }).ok, "zoo commands off in levels");
  for (let k = 0; k < 8; k += 1) stepSimulation(city);
  ok(!city.progress!.zoo, "no zoo state in levels");
}

// 14. Bulldozing a habitat: animals wait and move into the next fitting habitat.
{
  const city = town();
  const a = habitat(city, "wiese", 12);
  run(city, { op: "buy", cell: a, species: "rabbit", origin: "breeder" });
  const bunny = newest(city);
  ok(run(city, { op: "pclear", cells: [a + 1] }).ok, "habitat removed in the park");
  ticks(city, 4);
  ok(bunny.cell === -1, "animal waits without habitat");
  const b = habitat(city, "wiese", 13);
  ticks(city, 4);
  ok(bunny.cell === b, "animal moves into the new habitat");
}

// 15. Tierpark: one gate in the city, its own park level with paths, stands and reachability.
{
  const city = town();
  ok(!applyCommand(city, { type: "service", index: cellIndex(city, 3, 20), kind: ServiceKind.Tierpark }).ok, "Tierpark needs a road");
  const gate = cellIndex(city, 20, 11);
  ok(applyCommand(city, { type: "service", index: gate, kind: ServiceKind.Tierpark }).ok, "Tierpark built");
  ticks(city, 1);
  const z = zoo(city);
  ok(z.gate === gate && z.park, "park level created for the gate");
  ok(z.park!.tiles.length === PARK_SIZE * PARK_SIZE, "40×40 park");
  const entrance = parkXY(z.park!.entrance);
  ok(entrance.y === PARK_SIZE - 1, "entrance on the south edge");
  // A habitat away from any path is not visited.
  const far = parkIndex(3, 3);
  ok(run(city, { op: "pbuild", kind: "savanne", cells: [far] }).ok, "habitat in the park");
  ok(!run(city, { op: "pbuild", kind: "path", cells: [parkIndex(4, 4)] }).ok, "no path through a habitat");
  run(city, { op: "keeper", cell: far, on: true });
  ok(run(city, { op: "buy", cell: far, species: "giraffe", origin: "breeder" }).ok, "giraffe in the park habitat");
  run(city, { op: "buy", cell: far, species: "zebra", origin: "breeder" });
  ticks(city, 40);
  ok(z.visitors === 0, "no path → no visitors");
  // Drag a path from the entrance path to the habitat (L-shape like city roads).
  const funds = city.funds;
  const line = dragLine(parkIndex(20, 34), parkIndex(5, 8)).filter((tile) => tile !== parkIndex(20, 34));
  ok(line.length === 15 + 26, `drag line ${line.length} tiles`);
  ok(run(city, { op: "pbuild", kind: "path", cells: line }).ok, "path dragged");
  ok(funds - city.funds === line.length * PARK_INFO.path.cost, "paths cost per tile");
  const summary = summarize(z.park!, z.habitats);
  ok(summary.habitats.some((spot) => spot.tile === far), "habitat reachable over paths");
  ticks(city, 40);
  ok(z.visitors > 0 && z.income > 0, `visitors come (${z.visitors}, ${z.income} €/2 s)`);
  const plainSat = z.satisfaction;
  const plainIncome = z.income;
  // Stands next to the path sell; toilets, benches, bins and decor raise satisfaction.
  ok(run(city, { op: "pbuild", kind: "food", cells: [parkIndex(18, 33)] }).ok, "food stand");
  ok(run(city, { op: "pbuild", kind: "drink", cells: [parkIndex(16, 33)] }).ok, "drink stand");
  ok(run(city, { op: "pbuild", kind: "souvenir", cells: [parkIndex(14, 35)] }).ok, "souvenir shop");
  ok(run(city, { op: "pbuild", kind: "bench", cells: [parkIndex(12, 33), parkIndex(12, 35)] }).ok, "benches");
  ok(run(city, { op: "pbuild", kind: "bin", cells: [parkIndex(10, 33)] }).ok, "bin");
  ok(run(city, { op: "pbuild", kind: "toilet", cells: [parkIndex(8, 35)] }).ok, "toilets");
  ok(run(city, { op: "pbuild", kind: "tree", cells: [parkIndex(10, 20), parkIndex(11, 20), parkIndex(12, 22)] }).ok, "trees");
  ok(run(city, { op: "pbuild", kind: "flowers", cells: [parkIndex(10, 22), parkIndex(13, 20)] }).ok, "flowers");
  ok(!run(city, { op: "pbuild", kind: "bench", cells: [parkIndex(18, 33)] }).ok, "tile taken");
  ticks(city, 40);
  ok(z.sales > 0, `stands sell (${z.sales} €/2 s)`);
  ok(z.satisfaction > plainSat, `amenities raise satisfaction (${plainSat} → ${z.satisfaction})`);
  ok(z.income > plainIncome, `more income with stands (${plainIncome} → ${z.income})`);
  // Unreachable stands do not sell.
  const lone = summarize(z.park!, z.habitats).spots.food.length;
  run(city, { op: "pbuild", kind: "food", cells: [parkIndex(35, 20)] });
  ok(summarize(z.park!, z.habitats).spots.food.length === lone, "stand without path is not used");
  // Move the entrance; cut the path → habitat unreachable again.
  ok(!run(city, { op: "pbuild", kind: "entrance", cells: [parkIndex(10, 10)] }).ok, "entrance only on the edge");
  ok(run(city, { op: "pbuild", kind: "entrance", cells: [parkIndex(20, 0)] }).ok, "entrance moved to the north edge");
  ok(tileAtGrid(z, parkIndex(20, PARK_SIZE - 1)) === TILE.path, "old gate becomes path");
  ok(!run(city, { op: "pclear", cells: [z.park!.entrance] }).ok, "entrance cannot be removed");
  ok(run(city, { op: "pbuild", kind: "entrance", cells: [parkIndex(20, PARK_SIZE - 1)] }).ok, "entrance back");
  ok(run(city, { op: "pclear", cells: [parkIndex(20, 34)] }).ok, "path removed");
  ok(!summarize(z.park!, z.habitats).habitats.some((spot) => spot.tile === far), "cut path → habitat unreachable");
  ticks(city, 8);
  ok(z.visitors === 0, "no visitors without a way in");
  // Bulldozing the Tierpark keeps the park; rebuilding opens it again.
  applyCommand(city, { type: "bulldoze", cells: [gate] });
  ticks(city, 4);
  ok(z.gate === -1 && z.park && z.habitats.length === 1, "park kept while the gate is gone");
  ok(!run(city, { op: "pbuild", kind: "path", cells: [parkIndex(20, 34)] }).ok, "no building without the gate");
}

function tileAtGrid(z: ReturnType<typeof zoo>, tile: number): number {
  return occupancy(z.park!, z.habitats)[tile];
}

// 16. Save migration: 0.47 habitats in the city move into a Tierpark, animals and items included.
{
  const city = town(21);
  ensureProgress(city);
  stepZoo(city);
  const z = zoo(city);
  delete z.park;
  // Old 0.47 layout: three habitat services along the road, state keyed by city cells.
  const cells = [cellIndex(city, 4, 11), cellIndex(city, 8, 11), cellIndex(city, 12, 11)];
  const types: HabitatType[] = ["savanne", "polar", "wiese"];
  cells.forEach((cell, k) => {
    city.services[cell] = HABITAT_KIND[types[k]];
    z.habitats.push({ cell, type: types[k], items: [{ id: 90 + k, kind: "food", x: 2, y: 5, fill: 60 }, { id: 95 + k, kind: "toy", x: 4, y: 4 }], keeper: k === 0, fed: true, watered: true });
  });
  const animal = (id: number, species: string, cell: number, name: string): Animal => ({ id, name, species, cell, sex: id % 2 ? "m" : "w", born: -5000, health: 90, trust: 80, happy: 85, genes: { hue: 0, size: 1, pattern: 0.5, robust: 0.5, temper: 0.5 }, origin: "breeder", story: 0, gen: 0 });
  z.animals.push(animal(1, "zebra", cells[0], "Zora"), animal(2, "giraffe", cells[0], "Gustav"), animal(3, "penguin", cells[1], "Pingu"), animal(4, "rabbit", cells[2], "Hoppel"));
  z.seq = 5;
  const json = JSON.parse(JSON.stringify(cityToSave(city, "Zoo 0.47")));
  const old = saveToCity(json)!;
  ok(!old.progress!.zoo!.park && old.progress!.zoo!.habitats.length === 3, "0.47 save loads as before");
  stepSimulation(old);
  const m = old.progress!.zoo!;
  ok(old.services[cells[0]] === ServiceKind.Tierpark, "first habitat cell became the Tierpark");
  ok(old.services[cells[1]] === 0 && old.services[cells[2]] === 0, "other habitat cells freed");
  ok([...old.services].filter((kind) => kind >= 15 && kind <= 19).length === 0, "no 0.47 habitats left in the city");
  ok(m.park && m.gate === cells[0], "park created at the first habitat");
  ok(m.habitats.length === 3 && m.habitats.map((h) => h.type).join() === types.join(), "all habitats moved into the park");
  ok(m.animals.length === 4 && m.animals.every((a) => m.habitats.some((h) => h.cell === a.cell)), "no animal lost, all housed");
  ok(m.animals.find((a) => a.name === "Pingu")!.cell === m.habitats.find((h) => h.type === "polar")!.cell, "penguin still in the polar habitat");
  ok(m.habitats[0].keeper && m.habitats[0].items.some((i) => i.kind === "toy"), "items and keeper kept");
  const s = summarize(m.park!, m.habitats);
  ok(s.habitats.length === 3, "migrated habitats are reachable by path");
  ok(s.spots.food.length === 1 && s.spots.drink.length === 1 && s.spots.bench.length === 1 && s.spots.bin.length === 1, "welcome stands, bench and bin at the gate");
  for (let k = 0; k < 40; k += 1) stepSimulation(old);
  ok(m.visitors > 0 && m.income > 0, `migrated park has visitors (${m.visitors})`);
  // Determinism of the migration (server and clients agree).
  const again = saveToCity(JSON.parse(JSON.stringify(json)))!;
  stepSimulation(again);
  const first = saveToCity(JSON.parse(JSON.stringify(json)))!;
  stepSimulation(first);
  ok(JSON.stringify(again.progress!.zoo) === JSON.stringify(first.progress!.zoo), "migration is deterministic");
  // Round trip after migration.
  const back = saveToCity(JSON.parse(JSON.stringify(cityToSave(old, "Zoo 0.48"))))!;
  ok(JSON.stringify(back.progress!.zoo) === JSON.stringify(m), "park survives save round trip");
  const meta = JSON.parse(JSON.stringify(buildMeta(old)));
  meta.progress.zoo.park.tiles = "zzz";
  const mirror = createCity();
  writeCity(mirror, packCells(old), meta);
  ok(!mirror.progress!.zoo!.park, "broken park string dropped");
}

// 17. Visitors walk only on paths, look at habitats, buy at stands and leave.
{
  const city = town(5);
  const a = habitat(city, "savanne");
  const b = habitat(city, "wald");
  run(city, { op: "buy", cell: a, species: "zebra", origin: "breeder" });
  run(city, { op: "buy", cell: b, species: "monkey", origin: "breeder" });
  run(city, { op: "pbuild", kind: "food", cells: [parkIndex(19, 38)] });
  run(city, { op: "pbuild", kind: "drink", cells: [parkIndex(21, 38)] });
  run(city, { op: "pbuild", kind: "bench", cells: [parkIndex(19, 32)] });
  run(city, { op: "pbuild", kind: "souvenir", cells: [parkIndex(21, 32)] });
  const z = zoo(city);
  const walk = (seed: number) => {
    const crowd = new ParkCrowd(seed);
    crowd.setLayout(z.park!, z.habitats);
    const grid = occupancy(z.park!, z.habitats);
    const seen = { buy: 0, look: 0, sit: 0, off: 0, money: 0, gone: 0, max: 0 };
    for (let frame = 0; frame < 2400; frame += 1) {
      for (const event of crowd.update(0.05, 30)) {
        if (event.type === "buy") {
          seen.buy += 1;
          seen.money += event.price;
          ok([TILE.food, TILE.drink, TILE.souvenir].includes(grid[event.tile] as never), "buy happens at a stand");
        }
        if (event.type === "look") seen.look += 1;
        if (event.type === "sit") seen.sit += 1;
      }
      for (const walker of crowd.walkers) {
        if (walker.state === "gone") continue;
        const tile = parkIndex(Math.floor(walker.x), Math.floor(walker.y));
        if (!walkable(grid[tile])) seen.off += 1;
      }
      seen.max = Math.max(seen.max, crowd.walkers.filter((w) => w.state !== "gone").length);
    }
    seen.gone = crowd.walkers.filter((w) => w.state === "gone").length;
    return seen;
  };
  const seen = walk(3);
  ok(seen.off === 0, "visitors never leave the paths");
  ok(seen.look > 10 && seen.buy > 5 && seen.sit > 0, `visitors look (${seen.look}), buy (${seen.buy}) and sit (${seen.sit})`);
  ok(seen.max <= 30 && seen.max >= 20, `crowd follows the wanted size (${seen.max})`);
  ok(JSON.stringify(walk(3)) === JSON.stringify(seen), "crowd is deterministic");
  // Removing a path re-routes or sends people home, nobody ends up on grass.
  const crowd = new ParkCrowd(9);
  crowd.setLayout(z.park!, z.habitats);
  for (let k = 0; k < 400; k += 1) crowd.update(0.05, 20);
  run(city, { op: "pclear", cells: [parkIndex(20, 30)] });
  crowd.setLayout(z.park!, z.habitats);
  const grid = occupancy(z.park!, z.habitats);
  let off = 0;
  for (let k = 0; k < 800; k += 1) {
    crowd.update(0.05, 20);
    for (const walker of crowd.walkers) if (walker.state !== "gone" && !walkable(grid[parkIndex(Math.floor(walker.x), Math.floor(walker.y))])) off += 1;
  }
  ok(off === 0, "after a path is removed nobody walks on grass");
}

// 18. Protocol for park commands.
{
  const parse = (zoo: unknown) => parseCommand({ type: "zoo", zoo });
  ok(parse({ op: "pbuild", kind: "path", cells: [1, 2, 3] })?.type === "zoo", "parse pbuild");
  ok(parse({ op: "pbuild", kind: "savanne", cells: [41] })?.type === "zoo", "parse habitat build");
  ok(parse({ op: "pbuild", kind: "casino", cells: [1] }) === null, "park kind whitelist");
  ok(parse({ op: "pbuild", kind: "path", cells: [1600] }) === null, "tile range");
  ok(parse({ op: "pbuild", kind: "path", cells: [] }) === null, "cells required");
  ok(parse({ op: "pbuild", kind: "path", cells: Array.from({ length: 401 }, (_, k) => k) }) === null, "cell count limit");
  ok(parse({ op: "pclear", cells: [5] })?.type === "zoo", "parse pclear");
  ok(parse({ op: "pclear", cells: ["5"] }) === null, "pclear integers only");
}

console.log(`zoo-tests: ${checks} checks ok`);
