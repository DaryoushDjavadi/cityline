/**
 * Koop-Zoo: zwei Spieler im selben Raum. Kauf, Umbenennen und Streicheln laufen über den Server
 * und kommen bei beiden identisch an; der Server lässt ein Jungtier zur Welt kommen, das bei
 * beiden (und bei einem später beitretenden dritten Spieler) bitgleich ist.
 *   CITYLINE_TICK_MS=20 PORT=8787 DATA_DIR=$(mktemp -d) npm start   →   npx tsx scripts/coop-zoo-check.ts
 */
import { io } from "socket.io-client";
import {
  GRID_SIZE, HABITAT_KIND, Zone, applyCommand, cellIndex, cityToSave, createCity, ensureProgress, stepZoo,
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
const polar = cellIndex(city, 6, 11);
const meadow = cellIndex(city, 9, 11);
applyCommand(city, { type: "service", index: polar, kind: HABITAT_KIND.polar as never });
applyCommand(city, { type: "service", index: meadow, kind: HABITAT_KIND.wiese as never });
city.tick += 1;
stepZoo(city);
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
}

main()
  .catch((error) => { failures.push(String(error)); console.error(error); })
  .finally(() => {
    if (failures.length) { console.log(`coop-zoo-check: ${failures.length} Fehler`); process.exit(1); }
    console.log("coop-zoo-check ok");
    process.exit(0);
  });
