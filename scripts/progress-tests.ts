/**
 * Tests for the long-term layer: ranks, achievements, events with choices,
 * daily challenges, landmarks, save/coop compatibility.
 *   npx tsx scripts/progress-tests.ts
 */
import {
  ACHIEVEMENTS,
  DAY_TICKS,
  EVENTS,
  RANKS,
  ServiceKind,
  applyCommand,
  buildMeta,
  cellIndex,
  cityToSave,
  createCity,
  createLevelCity,
  goalMask,
  incomeBoost,
  levelById,
  packCells,
  parseCommand,
  placeBlockReason,
  rankFor,
  refreshUtilities,
  saveToCity,
  stepSimulation,
  writeCity,
  type CityState,
} from "../shared/src/index.ts";

let checks = 0;
function ok(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) throw new Error(message);
}

function flatTown(): CityState {
  const city = createCity(48, 48, { seed: 5, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  city.terrain.fill(0);
  city.funds = 400_000;
  return city;
}

/** Road on row y, buildings on row y+1 from x0..x1. */
function street(city: CityState, y: number, x0: number, x1: number): void {
  const cells: number[] = [];
  for (let x = x0; x <= x1; x += 1) cells.push(cellIndex(city, x, y));
  ok(applyCommand(city, { type: "road", cells }).ok, "road");
}

function houses(city: CityState, kind: string, y: number, x0: number, x1: number): void {
  const cells: number[] = [];
  for (let x = x0; x <= x1; x += 1) cells.push(cellIndex(city, x, y));
  ok(applyCommand(city, { type: "build", kind, cells }).ok, `build ${kind}`);
}

function run(city: CityState, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) stepSimulation(city);
}

// 1. Fresh city seeds silently; first progress pass creates state.
{
  const city = flatTown();
  run(city, 1);
  ok(city.progress && city.progress.seeded, "seeded after first tick");
  ok(city.progress!.rank === 0 && city.progress!.ach === 0, "fresh city has no rank/achievements");
}

// 2. Old save without progress: loads, seeds silently (no retro cash / toast).
{
  const city = flatTown();
  street(city, 10, 4, 30);
  houses(city, "tower", 11, 4, 10); // 7 towers → 420 pop → Stadt
  refreshUtilities(city);
  const save = cityToSave(city, "Alt");
  delete (save.meta as { progress?: unknown }).progress;
  const loaded = saveToCity(JSON.parse(JSON.stringify(save)));
  ok(loaded, "legacy save loads");
  ok(loaded!.progress === undefined, "legacy save has no progress yet");
  loaded!.goals = goalMask(loaded!); // quests are a separate system; isolate rank cash
  const before = loaded!.funds;
  stepSimulation(loaded!);
  const p = loaded!.progress!;
  ok(p.seeded, "legacy seeded");
  ok(p.rank === rankFor(420) && p.rank === 4, `legacy rank should be Stadt, got ${p.rank}`);
  ok((p.ach & 1) !== 0, "legacy gets Grundstein silently");
  ok(p.last === null, "no toast on silent seed");
  // income may tick on growth ticks; rank rewards must not be paid retroactively
  ok(loaded!.funds - before < RANKS[4].reward, "no retroactive rank cash");
}

// 3. Rank up pays reward + toast record; achievements pay.
{
  const city = flatTown();
  street(city, 10, 4, 30);
  run(city, 4);
  const funds = city.funds;
  houses(city, "cottage", 11, 4, 4);
  run(city, 4);
  const p = city.progress!;
  ok(p.rank === 1, `Siedlung after 12 pop, got ${p.rank}`);
  ok((p.ach & 1) !== 0, "Grundstein achieved");
  ok(p.last !== null, "toast record set");
  ok(city.funds >= funds + RANKS[1].reward - 2_000, "rank reward paid");
}

// 4. Events: start after delay when rank >= Dorf, choices cost money and apply effects; timeout auto-resolves.
{
  const city = flatTown();
  street(city, 10, 2, 40);
  houses(city, "apartments", 11, 2, 8); // 7*36=252 → Kleinstadt
  run(city, 4);
  const p = city.progress!;
  ok(p.rank >= 2, "rank Dorf+");
  ok(p.event === null, "no event right away");
  p.nextEvent = city.tick + 1;
  run(city, 4);
  ok(p.event !== null, "event started after nextEvent");
  const id = p.event!.id;
  const def = EVENTS.find((entry) => entry.id === id)!;
  ok(def.can, "event def exists");
  // invalid: wrong event id
  ok(!applyCommand(city, { type: "choose", event: "nope", option: 0 }).ok, "wrong event rejected");
  const funds = city.funds;
  const res = applyCommand(city, { type: "choose", event: id, option: 0 });
  ok(res.ok, `choose ok (${res.reason})`);
  ok(city.funds <= funds - def.options[0].cost + 3_000, "option cost charged");
  ok(city.progress!.event === null, "event closed");
  ok(city.progress!.last?.kind === "event" && city.progress!.last.text.length > 5, "event outcome text");
  ok(city.progress!.nextEvent > city.tick + 300, "next event scheduled with gap");
  ok(!applyCommand(city, { type: "choose", event: id, option: 0 }).ok, "double choose rejected");

  // Timeout path
  city.progress!.nextEvent = city.tick;
  run(city, 4);
  ok(city.progress!.event !== null, "second event");
  run(city, 250);
  ok(city.progress!.event === null || city.progress!.event.at > city.tick - 250, "timed out event resolved");
  ok(city.progress!.stats.events >= 2, "events counted");
}

// 5. Festival effect raises happiness and income multiplier.
{
  const city = flatTown();
  street(city, 10, 2, 40);
  houses(city, "apartments", 11, 2, 8);
  run(city, 8);
  const p = city.progress!;
  p.event = { id: "festival", at: city.tick, until: city.tick + 200 };
  const base = incomeBoost(city).mult;
  ok(applyCommand(city, { type: "choose", event: "festival", option: 0 }).ok, "festival big");
  ok(incomeBoost(city).mult > base, "festival raises income multiplier");
  ok(p.stats.festivals === 1, "festival counted");
  run(city, DAY_TICKS + 8);
  ok(incomeBoost(city).mult <= base + 0.0001 || (city.progress!.stats.mood >= 70), "effect expires");
}

// 6. Funds check: cannot pick an option you cannot afford.
{
  const city = flatTown();
  street(city, 10, 2, 20);
  houses(city, "apartments", 11, 2, 4);
  run(city, 4);
  city.progress!.event = { id: "investor", at: city.tick, until: city.tick + 200 };
  city.funds = 100;
  const res = applyCommand(city, { type: "choose", event: "investor", option: 0 });
  ok(!res.ok && res.reason === "funds", "unaffordable option rejected");
  ok(applyCommand(city, { type: "choose", event: "investor", option: 1 }).ok, "free option works");
}

// 7. Landmarks: rank-gated, unique, give income.
{
  const city = flatTown();
  street(city, 10, 2, 40);
  run(city, 4);
  const spot = cellIndex(city, 20, 11);
  ok(placeBlockReason(city, spot, "service", { kind: ServiceKind.Wheel })?.includes("Rang"), "wheel locked at low rank");
  ok(!applyCommand(city, { type: "service", index: spot, kind: ServiceKind.Wheel }).ok, "locked wheel rejected");
  houses(city, "apartments", 11, 2, 6); // 180 pop → Kleinstadt
  run(city, 4);
  ok(city.progress!.rank >= 3, "Kleinstadt");
  const before = incomeBoost(city).flat;
  ok(applyCommand(city, { type: "service", index: spot, kind: ServiceKind.Wheel }).ok, "wheel placed");
  run(city, 4);
  ok(incomeBoost(city).flat > before, "wheel adds flat income");
  ok(placeBlockReason(city, cellIndex(city, 30, 11), "service", { kind: ServiceKind.Wheel })?.includes("nur einmal"), "wheel unique");
  ok((city.progress!.ach & (1 << 11)) !== 0, "Wahrzeichen achievement");
}

// 8. Daily challenge appears from Siedlung on and completes.
{
  const city = flatTown();
  street(city, 10, 2, 40);
  houses(city, "cottage", 11, 2, 3);
  run(city, 4);
  const p = city.progress!;
  ok(p.challenge !== null, "challenge exists");
  p.challenge = { day: Math.floor(city.tick / DAY_TICKS), kind: "homes", base: 2, target: 2, reward: 3_000, done: false };
  const funds = city.funds;
  houses(city, "cottage", 11, 10, 11);
  run(city, 4);
  ok(p.challenge.done, "homes challenge done");
  ok(p.stats.challenges === 1, "challenge counted");
  ok(city.funds >= funds + 3_000 - 1_000, "challenge reward paid");
}

// 9. Meta round-trip (coop clients, worker resets) keeps progress identical.
{
  const city = flatTown();
  street(city, 10, 2, 30);
  houses(city, "apartments", 11, 2, 6);
  run(city, 12);
  city.progress!.event = { id: "festival", at: city.tick, until: city.tick + 99 };
  const meta = JSON.parse(JSON.stringify(buildMeta(city)));
  const mirror = createCity(48, 48);
  writeCity(mirror, packCells(city), meta);
  ok(JSON.stringify(mirror.progress) === JSON.stringify(city.progress), "progress survives meta round-trip");
  const save = saveToCity(JSON.parse(JSON.stringify(cityToSave(city, "Neu"))));
  ok(JSON.stringify(save!.progress) === JSON.stringify(city.progress), "progress survives save round-trip");
  // garbage from the wire is sanitized
  const evil = { ...meta, progress: { rank: 999, ach: "x", event: { id: "boom" }, effects: [{ id: "x", mood: 9, mult: 99, flat: 1e9, until: 1e9 }] } };
  writeCity(mirror, packCells(city), evil);
  ok(mirror.progress!.rank === RANKS.length - 1 && mirror.progress!.event === null, "sanitized rank/event");
  ok(mirror.progress!.effects[0].mult <= 1.5 && mirror.progress!.effects[0].flat <= 1000, "sanitized effects");
}

// 10. Protocol accepts/rejects choose.
{
  ok(parseCommand({ type: "choose", event: "storm", option: 1 })?.type === "choose", "parse choose");
  ok(parseCommand({ type: "choose", event: "storm", option: 9 }) === null, "reject bad option");
  ok(parseCommand({ type: "choose", event: 5, option: 0 }) === null, "reject bad event");
}

// 11. Level rooms keep the layer off.
{
  const level = levelById(1);
  ok(level, "level 1");
  const city = createLevelCity(level!);
  run(city, 30);
  ok(city.progress?.off === true && city.progress.event === null && city.progress.challenge === null, "levels: progress off");
}

// 12. Achievement list sanity
{
  const bits = new Set(ACHIEVEMENTS.map((entry) => entry.bit));
  ok(bits.size === ACHIEVEMENTS.length, "unique achievement bits");
  ok(ACHIEVEMENTS.every((entry) => entry.bit > 0 && entry.bit < 2 ** 31), "bits fit in uint32");
}

console.log(`progress-tests ok (${checks} checks)`);
