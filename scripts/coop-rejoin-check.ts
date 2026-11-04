import { io } from "socket.io-client";
import { cityToSave, createCity } from "../shared/src/index.ts";

const base = process.env.CITYLINE_URL ?? "http://127.0.0.1:8787";

async function postCity(id: string, name: string, funds: number): Promise<void> {
  const city = createCity();
  city.funds = funds;
  const save = cityToSave(city, name, id);
  const response = await fetch(`${base}/api/cities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(save),
  });
  const body = await response.json() as { ok?: boolean; code?: string };
  if (!response.ok || body.code !== id) throw new Error(`post ${id} ${response.status} ${JSON.stringify(body)}`);
}

function join(room: string, name: string, clientId: string): Promise<{ socket: ReturnType<typeof io>; funds: number }> {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ["websocket"] });
    const timer = setTimeout(() => reject(new Error(`join timeout ${name}`)), 5000);
    socket.on("joinError", (payload) => {
      clearTimeout(timer);
      reject(new Error(`joinError ${JSON.stringify(payload)}`));
    });
    socket.on("welcome", () => {
      socket.once("state", (state: { meta?: { funds?: number } }) => {
        clearTimeout(timer);
        resolve({ socket, funds: state.meta?.funds ?? -1 });
      });
    });
    socket.on("connect", () => socket.emit("join", { room, name, clientId }));
  });
}

async function main(): Promise<void> {
  await postCity("alpha", "Berlin", 11111);
  await postCity("alpha-2", "Berlin", 22222);
  const rooms = await (await fetch(`${base}/api/rooms`)).json() as { code: string; name?: string; funds: number }[];
  const a = rooms.find((row) => row.code === "alpha");
  const b = rooms.find((row) => row.code === "alpha-2");
  if (!a || !b) throw new Error(`list missing cities ${JSON.stringify(rooms)}`);
  if (a.funds !== 11111 || b.funds !== 22222) throw new Error(`funds clobbered ${a.funds} ${b.funds}`);
  if ((a.name ?? "") !== "Berlin" || (b.name ?? "") !== "Berlin") throw new Error(`names ${a.name} ${b.name}`);

  const host = await join("alpha", "Anna", "client-anna-01");
  if (host.funds !== 11111) throw new Error(`host funds ${host.funds}`);
  const guest = await join("alpha", "Ben", "client-ben-01");
  if (guest.funds !== 11111) throw new Error(`guest funds ${guest.funds}`);

  let guestKicked = false;
  guest.socket.on("disconnect", () => { guestKicked = true; });
  host.socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (guestKicked) throw new Error("guest was kicked when host left");
  if (!guest.socket.connected) throw new Error("guest socket died");

  const hostBack = await join("alpha", "Anna", "client-anna-01");
  if (hostBack.funds !== 11111) throw new Error(`rejoin funds ${hostBack.funds}`);
  hostBack.socket.disconnect();
  guest.socket.disconnect();
  console.log("coop-rejoin-check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
