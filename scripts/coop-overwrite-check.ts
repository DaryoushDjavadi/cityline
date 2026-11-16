/**
 * Regression check for the coop overwrite bug: POST /api/cities must not replace a live or
 * owned room without the owner key and the current revision.
 * Run against a server with an empty DATA_DIR:
 *   DATA_DIR=$(mktemp -d) PORT=8799 npm start &  CITYLINE_URL=http://127.0.0.1:8799 DATA_DIR=<same> npx tsx scripts/coop-overwrite-check.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { io } from "socket.io-client";
import { applyCommand, asUint8Array, cellIndex, cityToSave, createCity, writeCity, type CityState } from "../shared/src/index.ts";

const base = process.env.CITYLINE_URL ?? "http://127.0.0.1:8787";
const dataDir = process.env.DATA_DIR;
const tag = Date.now().toString(36);

function roadCity(roads: number, funds: number, tick = 0): CityState {
  const city = createCity();
  city.terrain.fill(0);
  city.funds = 10_000_000;
  const cells: number[] = [];
  for (let i = 0; i < roads; i += 1) cells.push(cellIndex(city, 4 + (i % 48), 4 + Math.floor(i / 48) * 2));
  if (roads > 0 && !applyCommand(city, { type: "road", cells }).ok) throw new Error("road setup");
  city.funds = funds;
  city.tick = tick;
  return city;
}

function countRoads(city: CityState): number {
  let total = 0;
  for (const value of city.roads) if (value) total += 1;
  return total;
}

async function post(id: string, city: CityState, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/cities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...cityToSave(city, id, id), ...extra }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function join(room: string, clientId: string): Promise<{ socket: ReturnType<typeof io>; roads: number; funds: number }> {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ["websocket"] });
    const timer = setTimeout(() => reject(new Error(`join timeout ${room}`)), 5000);
    socket.on("joinError", (payload) => reject(new Error(`joinError ${JSON.stringify(payload)}`)));
    socket.on("welcome", () => {
      socket.once("state", (state: { meta: Parameters<typeof writeCity>[2]; cells: ArrayBuffer | Uint8Array }) => {
        clearTimeout(timer);
        const city = createCity();
        const cells = asUint8Array(state.cells);
        if (!cells) throw new Error("no cells");
        writeCity(city, cells, state.meta);
        resolve({ socket, roads: countRoads(city), funds: city.funds });
      });
    });
    socket.on("connect", () => socket.emit("join", { room, name: clientId, clientId }));
  });
}

function expect(label: string, condition: boolean, detail: unknown): void {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
  console.log(`  ok  ${label}`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const room = `victim-${tag}`;
  const created = await post(room, roadCity(144, 77_777));
  expect("create returns key + rev", created.status === 200 && typeof created.body.key === "string" && typeof created.body.rev === "string", created);
  const key = created.body.key as string;
  const firstRev = created.body.rev as string;

  const host = await join(room, `host-${tag}`);
  expect("host sees 144 roads", host.roads === 144 && host.funds === 77_777, host);

  // The original attack: anonymous POST with an empty city while someone plays.
  const attack = await post(room, roadCity(0, 1));
  expect("anonymous overwrite of live room rejected (409 in_use)", attack.status === 409 && attack.body.reason === "in_use", attack);
  const ownerLive = await post(room, roadCity(0, 1), { ownerKey: key, rev: firstRev });
  expect("even the owner cannot POST over a live room", ownerLive.status === 409 && ownerLive.body.reason === "in_use", ownerLive);

  host.socket.disconnect();
  await wait(300);
  const idleAttack = await post(room, roadCity(0, 1));
  expect("anonymous overwrite of idle room rejected (403)", idleAttack.status === 403 && idleAttack.body.reason === "forbidden", idleAttack);
  const wrongKey = await post(room, roadCity(0, 1), { ownerKey: "guess", rev: firstRev });
  expect("wrong owner key rejected (403)", wrongKey.status === 403, wrongKey);
  // Leave-coop autosave / openCoopCity: owner uploads the local fork that predates the session.
  const stale = await post(room, roadCity(0, 1, 999_999), { ownerKey: key, rev: firstRev });
  expect("owner upload with pre-coop rev rejected (409 stale)", stale.status === 409 && stale.body.reason === "stale", stale);

  const back = await join(room, `host-${tag}`);
  expect("room intact after attacks (144 roads, funds kept)", back.roads === 144 && back.funds === 77_777, back);
  const guest = await join(room, `guest-${tag}`);
  expect("guest joins the same city", guest.roads === 144, guest);
  back.socket.disconnect();
  guest.socket.disconnect();

  // Normal solo sync: owner keeps uploading with the rev of the previous upload.
  const solo = `solo-${tag}`;
  const s1 = await post(solo, roadCity(10, 5_000));
  const s2 = await post(solo, roadCity(12, 6_000, 10), { ownerKey: s1.body.key, rev: s1.body.rev });
  expect("owner update with current rev accepted", s2.status === 200 && typeof s2.body.rev === "string" && s2.body.rev !== s1.body.rev && !s2.body.key, s2);
  const s3 = await post(solo, roadCity(1, 1, 20), { ownerKey: s1.body.key, rev: s1.body.rev });
  expect("owner update with old rev rejected", s3.status === 409 && s3.body.reason === "stale", s3);
  const s4 = await post(solo, roadCity(14, 7_000, 30), { ownerKey: s1.body.key, rev: s2.body.rev });
  expect("owner update with newest rev accepted", s4.status === 200, s4);
  const soloJoin = await join(solo, `solo-host-${tag}`);
  expect("coop open loads the latest solo upload", soloJoin.roads === 14 && soloJoin.funds === 7_000, soloJoin);
  soloJoin.socket.disconnect();

  // A room born from a socket join has no owner: HTTP can never replace it.
  const born = `born-${tag}`;
  const bornHost = await join(born, `born-host-${tag}`);
  bornHost.socket.disconnect();
  await wait(300);
  const bornPost = await post(born, roadCity(0, 1, 999_999));
  expect("socket-born room cannot be replaced via POST", bornPost.status === 403, bornPost);

  if (dataDir) {
    // Migration: a pre-fix save (no rev/owner) is claimed by the first upload that is not older.
    const legacy = `legacy-${tag}`;
    const old = cityToSave(roadCity(20, 3_000, 500), legacy, legacy);
    writeFileSync(path.join(dataDir, `${legacy}.json`), JSON.stringify(old));
    const older = await post(legacy, roadCity(0, 1, 100));
    expect("legacy save: older upload rejected", older.status === 409 && older.body.reason === "stale", older);
    const claim = await post(legacy, roadCity(22, 3_500, 600));
    expect("legacy save: newer upload claims it and gets a key", claim.status === 200 && typeof claim.body.key === "string", claim);
    const reclaim = await post(legacy, roadCity(0, 1, 9_999));
    expect("legacy save: after the claim anonymous uploads are rejected", reclaim.status === 403, reclaim);
  } else {
    console.log("  skip legacy migration check (DATA_DIR not set)");
  }
  console.log("coop-overwrite-check ok");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
