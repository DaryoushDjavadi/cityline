/**
 * Koop: Auftragstafel ist serverautoritativ. Zwei Spieler sehen dieselbe Tafel,
 * eine Lieferung zahlt genau einmal (der zweite Klick auf denselben Auftrag wird abgelehnt).
 *   PORT=8787 npm start   →   npx tsx scripts/coop-orders-check.ts
 */
import { io } from "socket.io-client";
import { ServiceKind, Zone, cellIndex, cityToSave, createCity, ensureBoard, stepOrders } from "../shared/src/index.ts";

const base = process.env.CITYLINE_URL ?? "http://127.0.0.1:8787";
type Meta = { funds: number; progress?: { orders?: { slots: ({ id: number; reward: number } | null)[]; done: number; fish: number } } };

async function postCity(id: string): Promise<void> {
  const city = createCity(48, 48, { seed: 11, biome: "temperate", water: 0, lakes: 0, forest: 0, rivers: 0 });
  city.terrain.fill(0);
  city.funds = 10_000;
  for (let x = 4; x < 14; x += 1) {
    const i = cellIndex(city, x, 6);
    city.zones[i] = Zone.Residential;
    city.levels[i] = 2;
  }
  city.services[cellIndex(city, 20, 20)] = ServiceKind.Harbor;
  for (let k = 0; k < 60; k += 1) {
    city.tick += 1;
    stepOrders(city);
  }
  ensureBoard(city).fish = 900;
  const response = await fetch(`${base}/api/cities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cityToSave(city, "Tafelstadt", id)),
  });
  if (!response.ok) throw new Error(`post ${response.status}`);
}

function join(room: string, name: string, clientId: string) {
  return new Promise<{ socket: ReturnType<typeof io>; meta: () => Meta }>((resolve, reject) => {
    const socket = io(base, { transports: ["websocket"] });
    let latest: Meta | null = null;
    const timer = setTimeout(() => reject(new Error(`join timeout ${name}`)), 6000);
    socket.on("joinError", (payload) => reject(new Error(`joinError ${JSON.stringify(payload)}`)));
    socket.on("state", (state: { meta?: Meta }) => {
      if (state.meta) latest = state.meta;
      if (latest) {
        clearTimeout(timer);
        resolve({ socket, meta: () => latest! });
      }
    });
    socket.on("connect", () => socket.emit("join", { room, name, clientId }));
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const room = `tafel-${Date.now().toString(36)}`;
  await postCity(room);
  const anna = await join(room, "Anna", `anna-${room}`);
  const ben = await join(room, "Ben", `ben-${room}`);
  await wait(800);
  const boardA = anna.meta().progress?.orders;
  const boardB = ben.meta().progress?.orders;
  if (!boardA || !boardB) throw new Error("no board in coop meta");
  if (JSON.stringify(boardA.slots) !== JSON.stringify(boardB.slots)) throw new Error("boards differ between players");
  const slot = boardA.slots.findIndex(Boolean);
  if (slot < 0) throw new Error("no order on board");
  const order = boardA.slots[slot]!;
  const funds = anna.meta().funds;
  const results: { ok: boolean; reason?: string }[] = [];
  const send = (who: typeof anna) =>
    new Promise<void>((resolve) => {
      const id = `cmd-${Math.random().toString(36).slice(2)}`;
      who.socket.on("commandResult", (res: { id: string; ok: boolean; reason?: string }) => {
        if (res.id !== id) return;
        results.push(res);
        resolve();
      });
      who.socket.emit("command", { id, command: { type: "order", slot, id: order.id, action: "deliver" } });
    });
  await Promise.all([send(anna), send(ben)]);
  await wait(1200);
  const okCount = results.filter((r) => r.ok).length;
  if (okCount !== 1) throw new Error(`expected exactly one successful delivery, got ${JSON.stringify(results)}`);
  const afterA = anna.meta();
  const afterB = ben.meta();
  if (afterA.progress?.orders?.done !== 1 || afterB.progress?.orders?.done !== 1) throw new Error("done counter not synced");
  if (afterA.funds < funds + order.reward - 50) throw new Error(`reward not paid once ${funds} → ${afterA.funds}`);
  if (afterA.funds > funds + Math.round(order.reward * 1.3) + 2000) throw new Error(`paid twice? ${funds} → ${afterA.funds}`);
  // junk command is ignored by the server
  anna.socket.emit("command", { id: "junk", command: { type: "order", slot: 9, id: -1, action: "steal" } });
  await wait(400);
  if (anna.meta().progress?.orders?.done !== 1) throw new Error("junk changed the board");
  anna.socket.disconnect();
  ben.socket.disconnect();
  console.log(`coop-orders-check ok (Lieferung +${afterA.funds - funds} €, beide Clients synchron)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
