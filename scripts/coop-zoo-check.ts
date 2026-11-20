/**
 * Koop-Tierpark: zwei Spieler im selben Raum. Wege, Stände und Gehege im Tierpark, Kauf, Umbenennen
 * und Streicheln laufen über den Server und kommen bei beiden identisch an; der Server lässt ein
 * Jungtier zur Welt kommen, das bei beiden (und bei einem später beitretenden dritten Spieler)
 * bitgleich ist. Ein 0.47-Spielstand mit Gehegen in der Stadt wird vom Server in einen Tierpark
 * umgezogen, ohne dass ein Tier verloren geht. Achterbahn bauen, testen, öffnen und Preise setzen laufen
 * ebenfalls über den Server und sind bei beiden identisch.
 *   CITYLINE_TICK_MS=20 PORT=8787 DATA_DIR=$(mktemp -d) npm start   →   npx tsx scripts/coop-zoo-check.ts
 */
import { io } from "socket.io-client";
import {
  GRID_SIZE, HABITAT_KIND, ServiceKind, Zone, applyCommand, cellIndex, cityToSave, createCity, ensureProgress, parkIndex, stepZoo,
  type Animal, type ZooState,
} from "../shared/src/index.ts";

const base = process.env.CITYLINE_URL ?? "http://127.0.0.1:8787";
type Meta = { funds: number; progress?: { zoo?: ZooState } };
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

const city = createCity(GRID_SIZE, GRID_SIZE, { seed: 23, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
city.terrain.fill(0);
city.funds = 200_000;
ensureProgress(city);
applyCommand(city, { type: "road", cells: Array.from({ length: 16 }, (_, x) => cellIndex(city, x + 2, 10)) });
for (let x = 2; x < 14; x += 1) {
  city.zones[cellIndex(city, x, 12)] = Zone.Residential;
  city.levels[cellIndex(city, x, 12)] = 2;
}
const gate = cellIndex(city, 6, 11);
applyCommand(city, { type: "service", index: gate, kind: ServiceKind.Tierpark as never });
city.tick += 1;
stepZoo(city);
// Habitats live in the park now (anchors next to the entrance path).
const polar = parkIndex(15, 33);
const meadow = parkIndex(21, 33);
applyCommand(city, { type: "zoo", zoo: { op: "pbuild", kind: "polar", cells: [polar] } as never });
applyCommand(city, { type: "zoo", zoo: { op: "pbuild", kind: "wiese", cells: [meadow] } as never });
if (city.progress!.zoo!.habitats.length !== 2) throw new Error("setup: Gehege im Park fehlen");
// A penguin pair that is already expecting, so the server has to deliver the baby.
for (const op of [{ op: "keeper", cell: polar, on: true }, { op: "buy", cell: polar, species: "penguin", origin: "breeder" }, { op: "buy", cell: polar, species: "penguin", origin: "breeder" }] as const) {
  applyCommand(city, { type: "zoo", zoo: op as never });
}
const pair = city.progress!.zoo!.animals;
const mother = pair.find((a) => a.sex === "w")!;
const father = pair.find((a) => a.sex === "m")!;
for (const a of pair) { a.health = 100; a.happy = 95; a.trust = 95; }
mother.pregnantUntil = city.tick + 120;
mother.mate = father.id;

function join(room: string, name: string) {
  return new Promise<{ socket: ReturnType<typeof io>; meta: () => Meta }>((resolve, reject) => {
    const socket = io(base, { transports: ["websocket"] });
    let latest: Meta | null = null;
    const timer = setTimeout(() => reject(new Error(`join timeout ${name}`)), 8000);
    socket.on("joinError", (payload) => reject(new Error(`joinError ${JSON.stringify(payload)}`)));
    socket.on("state", (state: { meta?: Meta }) => {
      if (state.meta) latest = state.meta;
      if (latest) { clearTimeout(timer); resolve({ socket, meta: () => latest! }); }
    });
    socket.on("connect", () => socket.emit("join", { room, name, clientId: `${name}-${room}` }));
  });
}
type Client = Awaited<ReturnType<typeof join>>;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (who: Client, zoo: unknown) =>
  new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    const id = `cmd-${Math.random().toString(36).slice(2)}`;
    const onResult = (res: { id: string; ok: boolean; reason?: string }) => {
      if (res.id !== id) return;
      who.socket.off("commandResult", onResult);
      resolve(res);
    };
    who.socket.on("commandResult", onResult);
    who.socket.emit("command", { id, command: { type: "zoo", zoo } });
  });
const zooOf = (who: Client) => who.meta().progress?.zoo;
/** Animal list without per-client noise (everything is server state, so it must match exactly). */
const animals = (who: Client) => JSON.stringify(zooOf(who)?.animals ?? []);

async function settle(a: Client, b: Client, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (animals(a) === animals(b)) return true;
    await wait(60);
  }
  return false;
}

async function main(): Promise<void> {
  const room = `zoo-${Date.now().toString(36)}`;
  const response = await fetch(`${base}/api/cities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cityToSave(city, "Zoostadt", room)) });
  if (!response.ok) throw new Error(`post ${response.status}`);
  const anna = await join(room, "Anna");
  const ben = await join(room, "Ben");
  await wait(600);
  check(zooOf(anna) && zooOf(ben), "beide sehen den Zoo");
  check(zooOf(anna)?.park && zooOf(anna)!.gate === gate && zooOf(anna)!.park!.tiles === zooOf(ben)!.park!.tiles, "beide sehen denselben Tierpark");

  // Park building (Anna paths and a stand, Ben clears) goes through the server.
  const path = Array.from({ length: 12 }, (_, k) => parkIndex(20, 22 + k));
  const paved = await send(anna, { op: "pbuild", kind: "path", cells: path });
  check(paved.ok, `Anna legt einen Weg (${paved.reason ?? "ok"})`);
  const stand = await send(anna, { op: "pbuild", kind: "food", cells: [parkIndex(19, 30)] });
  check(stand.ok, `Anna baut einen Essensstand (${stand.reason ?? "ok"})`);
  const blocked = await send(ben, { op: "pbuild", kind: "drink", cells: [parkIndex(16, 35)] });
  check(!blocked.ok && blocked.reason === "park_blocked", `Server lehnt einen Stand im Gehege ab (${blocked.reason})`);
  const badKind = await send(ben, { op: "pbuild", kind: "rakete", cells: [parkIndex(5, 5)] });
  check(!badKind.ok, "Server lehnt unbekannte Bauteile ab");
  await wait(400);
  const tilesA = zooOf(anna)!.park!.tiles;
  check(tilesA === zooOf(ben)!.park!.tiles, "Wege und Stand bei beiden gleich");
  check(tilesA[parkIndex(20, 22)] === "b" && tilesA[parkIndex(19, 30)] === "d", "Weg und Essensstand stehen im Park");
  const cleared = await send(ben, { op: "pclear", cells: [parkIndex(20, 22), parkIndex(20, 23)] });
  check(cleared.ok, "Ben reißt ein Stück Weg ab");
  await wait(400);
  check(zooOf(anna)!.park!.tiles[parkIndex(20, 22)] === "a" && zooOf(anna)!.park!.tiles === zooOf(ben)!.park!.tiles, "Abriss kommt bei Anna an");
  const habitatBuilt = await send(ben, { op: "pbuild", kind: "savanne", cells: [parkIndex(21, 26)] });
  check(habitatBuilt.ok, `Ben baut ein Savannen-Gehege (${habitatBuilt.reason ?? "ok"})`);
  await wait(400);
  check(zooOf(anna)!.habitats.length === 3 && JSON.stringify(zooOf(anna)!.habitats) === JSON.stringify(zooOf(ben)!.habitats), "Neues Gehege bei beiden");
  check(zooOf(anna)!.animals.length === 2 && (await settle(anna, ben)), "Pinguin-Paar bei beiden gleich");

  // Buy (Anna) → Ben sees it.
  const bought = await send(anna, { op: "buy", cell: meadow, species: "goat", origin: "rescue" });
  check(bought.ok, `Anna kauft eine Ziege (${bought.reason ?? "ok"})`);
  await wait(400);
  const goatA = zooOf(anna)!.animals.find((a) => a.species === "goat");
  const goatB = zooOf(ben)!.animals.find((a) => a.species === "goat");
  check(goatA && goatB && goatA.id === goatB.id && goatA.name === goatB.name && goatA.origin === "rescue", `Kauf synchron (${goatA?.name} / ${goatB?.name})`);
  check(JSON.stringify(goatA?.genes) === JSON.stringify(goatB?.genes), "Gene der gekauften Ziege identisch");

  // Rename (Ben) → Anna sees it; invalid names are rejected by the server.
  const bad = await send(ben, { op: "rename", animal: goatA!.id, name: "<b>x</b>" });
  check(!bad.ok, "Server lehnt ungültigen Namen ab");
  const renamed = await send(ben, { op: "rename", animal: goatA!.id, name: "Frau Meckerle" });
  check(renamed.ok, "Ben benennt die Ziege um");
  await wait(400);
  check(zooOf(anna)!.animals.find((a) => a.id === goatA!.id)?.name === "Frau Meckerle", "Anna sieht den neuen Namen");

  // Pet (Anna) → trust rises on both; second pet within the cooldown is rejected.
  const trustBefore = zooOf(ben)!.animals.find((a) => a.id === goatA!.id)!.trust;
  const pet = await send(anna, { op: "care", animal: goatA!.id, act: "pet" });
  check(pet.ok, `Anna streichelt die Ziege (${pet.reason ?? "ok"})`);
  const again = await send(ben, { op: "care", animal: goatA!.id, act: "pet" });
  check(!again.ok, "Cooldown gilt auch für den zweiten Spieler");
  await wait(400);
  const petB = zooOf(ben)!.animals.find((a) => a.id === goatA!.id)!;
  check(petB.trust > trustBefore && petB.react?.kind === "pet", `Ben sieht Vertrauen ${trustBefore} → ${petB.trust} und die Reaktion`);
  check(await settle(anna, ben), "Tierliste nach Kauf/Umbenennen/Streicheln identisch");

  // Build mode (0.51): Ben sets a turned 2×2 pond, Anna's overlapping rock is refused by the server.
  const pond = await send(ben, { op: "place", cell: meadow, item: "pool", x: 3, y: 1, rot: 1 });
  check(pond.ok, `Ben setzt einen Teich im Bau-Modus (${pond.reason ?? "ok"})`);
  const overlap = await send(anna, { op: "place", cell: meadow, item: "rock", x: 4, y: 2 });
  check(!overlap.ok, "Server lehnt Felsen auf dem Teich ab (2 × 2 Felder)");
  const turned = await send(anna, { op: "place", cell: meadow, item: "hay", x: 0, y: 0, rot: 3 });
  check(turned.ok, `Anna setzt gedrehtes Heu (${turned.reason ?? "ok"})`);
  await wait(400);
  const itemsOf = (who: Client) => JSON.stringify(zooOf(who)!.habitats.find((h) => h.cell === meadow)!.items);
  const annaItems = zooOf(anna)!.habitats.find((h) => h.cell === meadow)!.items;
  check(itemsOf(anna) === itemsOf(ben) && annaItems.some((i) => i.kind === "pool" && i.rot === 1) && annaItems.some((i) => i.kind === "hay" && i.rot === 3), "Beide sehen dieselbe Einrichtung mit Drehung");

  // Achterbahn and prices (0.52): every step goes through the server, both see the same ride.
  // A cross path at y = 8, joined to the entrance path at x = 20 (cut at 22/23 above).
  const lane = [...Array.from({ length: 25 }, (_, k) => parkIndex(8 + k, 8)), ...Array.from({ length: 15 }, (_, k) => parkIndex(20, 9 + k))];
  check((await send(anna, { op: "pbuild", kind: "path", cells: lane })).ok, "Anna legt einen Weg für die Achterbahn");
  const station = await send(anna, { op: "cstation", tile: parkIndex(12, 7), dir: 1 });
  check(station.ok, `Anna setzt eine Station (${station.reason ?? "ok"})`);
  const far = await send(ben, { op: "cstation", tile: parkIndex(3, 20), dir: 0 });
  check(!far.ok && far.reason === "coaster_no_path", `Server lehnt eine Station ohne Weg ab (${far.reason})`);
  await wait(400);
  const rideId = zooOf(ben)?.coasters?.[0]?.id;
  check(rideId !== undefined && zooOf(anna)?.coasters?.[0]?.id === rideId, "Ben sieht dieselbe Achterbahn");
  const track = ["straight", "up", "up", "up", "up", "straight", "down", "down", "loop", "left", "straight", "left"];
  let built = 0;
  for (const [k, piece] of track.entries()) if ((await send(k % 2 ? ben : anna, { op: "cpiece", coaster: rideId, piece })).ok) built += 1;
  check(built === track.length, `Beide bauen abwechselnd Teile (${built}/${track.length})`);
  const sneaky = await send(ben, { op: "cpiece", coaster: rideId, piece: "corkscrew" });
  check(!sneaky.ok, "Server lehnt unbekannte Streckenteile ab");
  check((await send(ben, { op: "cclose", coaster: rideId })).ok, "Ben schließt den Rundkurs");
  const early = await send(anna, { op: "cstate", coaster: rideId, state: "open" });
  check(!early.ok && early.reason === "coaster_untested", `Öffnen ohne Testfahrt abgelehnt (${early.reason})`);
  check((await send(anna, { op: "cstate", coaster: rideId, state: "test" })).ok, "Anna startet die Testfahrt");
  check((await send(ben, { op: "cstate", coaster: rideId, state: "open" })).ok, "Ben öffnet die Bahn");
  check((await send(ben, { op: "cprice", coaster: rideId, price: 8 })).ok, "Ben setzt den Ticketpreis auf 8 €");
  check(!(await send(anna, { op: "cprice", coaster: rideId, price: 99 })).ok, "Server lehnt 99 € ab");
  check((await send(anna, { op: "sprice", tile: parkIndex(19, 30), price: 6 })).ok, "Anna setzt den Pommes-Preis auf 6 €");
  check(!(await send(ben, { op: "sprice", tile: parkIndex(20, 30), price: 6 })).ok, "Server lehnt einen Preis auf einem Weg ab");
  await wait(500);
  const rideA = zooOf(anna)!.coasters![0];
  const rideB = zooOf(ben)!.coasters![0];
  check(rideA.state === "open" && rideA.price === 8 && rideA.stats && rideA.stats.excitement > 0, `Anna: geöffnet, 8 €, Aufregung ${rideA.stats?.excitement}`);
  check(JSON.stringify({ ...rideA, riders: 0, revenue: 0 }) === JSON.stringify({ ...rideB, riders: 0, revenue: 0 }), "Strecke, Zustand, Bewertung und Preis bei beiden identisch");
  check(zooOf(anna)!.prices?.[parkIndex(19, 30)] === 6 && zooOf(ben)!.prices?.[parkIndex(19, 30)] === 6, "Standpreis bei beiden");
  await wait(2500);
  check((zooOf(ben)!.coasters![0].riders ?? 0) > 0, `Server zählt Fahrgäste (${Math.round(zooOf(ben)!.coasters![0].riders)})`);

  // Birth on the server.
  let child: Animal | undefined;
  const until = Date.now() + 30_000;
  while (!child && Date.now() < until) {
    await wait(150);
    child = zooOf(anna)!.animals.find((a) => a.mother === mother.id);
  }
  check(child, "Server lässt das Jungtier zur Welt kommen");
  check(await settle(anna, ben), "Jungtier bei beiden identisch (Name, Gene, Familie)");
  const childB = zooOf(ben)!.animals.find((a) => a.id === child?.id);
  check(childB && JSON.stringify(childB) === JSON.stringify(child), `Jungtier ${child?.name} aus der ${child?.family}-Familie`);
  check(child?.family === `${father.name}-&-${mother.name}`, "Familienname aus den Eltern");

  // Ben leaves (rooms hold two players), Clara joins later and gets the same zoo.
  ben.socket.close();
  await wait(800);
  const clara = await join(room, "Clara");
  await wait(500);
  const late = zooOf(clara)!.animals.find((a) => a.id === child?.id);
  check(late && JSON.stringify(late.genes) === JSON.stringify(child?.genes) && late.name === child?.name, "Später beitretende Spielerin sieht dasselbe Jungtier");

  for (const who of [anna, clara]) who.socket.close();
  await migration();
}

/** A 0.47 save with habitats in the city: the server moves them into a Tierpark. */
async function migration(): Promise<void> {
  const old = createCity(GRID_SIZE, GRID_SIZE, { seed: 31, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  old.terrain.fill(0);
  old.funds = 100_000;
  ensureProgress(old);
  applyCommand(old, { type: "road", cells: Array.from({ length: 12 }, (_, x) => cellIndex(old, x + 2, 10)) });
  stepZoo(old);
  const z = old.progress!.zoo!;
  delete z.park;
  const cells = [cellIndex(old, 4, 11), cellIndex(old, 7, 11)];
  const types = ["savanne", "wiese"] as const;
  cells.forEach((cell, k) => {
    old.services[cell] = HABITAT_KIND[types[k]];
    z.habitats.push({ cell, type: types[k], items: [{ id: 80 + k, kind: "food", x: 2, y: 5, fill: 60 }], keeper: false, fed: true, watered: true });
  });
  const animal = (id: number, species: string, cell: number, name: string): Animal => ({ id, name, species, cell, sex: id % 2 ? "m" : "w", born: -5000, health: 90, trust: 80, happy: 85, genes: { hue: 0, size: 1, pattern: 0.5, robust: 0.5, temper: 0.5 }, origin: "breeder", story: 0, gen: 0 });
  z.animals.push(animal(1, "zebra", cells[0], "Zora"), animal(2, "goat", cells[1], "Mecki"), animal(3, "rabbit", cells[1], "Hoppel"));
  z.seq = 4;
  const room = `zoo-old-${Date.now().toString(36)}`;
  const response = await fetch(`${base}/api/cities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cityToSave(old, "Zoo 0.47", room)) });
  check(response.ok, `0.47-Spielstand hochgeladen (${response.status})`);
  const dora = await join(room, "Dora");
  const emil = await join(room, "Emil");
  const until = Date.now() + 5000;
  while (Date.now() < until && !zooOf(dora)?.park) await wait(100);
  const m = zooOf(dora);
  check(m?.park && m.gate === cells[0], "Server zieht die Gehege in einen Tierpark am ersten Gehege um");
  check(m && m.habitats.length === 2 && m.animals.length === 3 && m.animals.every((a) => m.habitats.some((h) => h.cell === a.cell)), "Kein Tier geht beim Umzug verloren");
  await wait(400);
  check(JSON.stringify(zooOf(emil)) === JSON.stringify(zooOf(dora)), "Beide sehen denselben umgezogenen Park");
  for (const who of [dora, emil]) who.socket.close();
}

main()
  .catch((error) => { failures.push(String(error)); console.error(error); })
  .finally(() => {
    if (failures.length) { console.log(`coop-zoo-check: ${failures.length} Fehler`); process.exit(1); }
    console.log("coop-zoo-check ok");
    process.exit(0);
  });
