import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { isLevelRoom } from "../../shared/src/levels.ts";
import { cleanRoom } from "../../shared/src/protocol.ts";
import { saveToCity } from "../../shared/src/save.ts";
import { attachCityServer } from "./rooms.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLIENT_DIST = path.join(REPO_ROOT, "client", "dist");
const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);
const app = express();
const httpServer = createServer(app);

app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.end();
    return;
  }
  next();
});

app.use(express.json({ limit: "2mb" }));

const io = new Server(httpServer, { cors: { origin: true } });
const city = attachCityServer(io);

app.get("/health", (request, response) => {
  response.json({ ok: true, service: "cityline", path: request.path });
});

app.get("/api/rooms", (_request, response) => {
  response.json(city.listRooms());
});

app.post("/api/cities", (request, response) => {
  const code = cleanRoom((request.body as { name?: unknown } | undefined)?.name);
  const loaded = saveToCity(request.body);
  if (!code || !loaded || isLevelRoom(code)) {
    response.status(400).json({ ok: false, reason: "bad_city" });
    return;
  }
  city.importCity(code, loaded);
  response.json({ ok: true, code });
});

app.delete("/api/cities/:code", (request, response) => {
  const code = cleanRoom(request.params.code);
  if (!code) {
    response.status(400).json({ ok: false, reason: "bad_city" });
    return;
  }
  const result = city.removeCity(code);
  if (result === "in_use") {
    response.status(409).json({ ok: false, reason: "in_use" });
    return;
  }
  if (result === "missing") {
    response.status(404).json({ ok: false, reason: "missing" });
    return;
  }
  response.json({ ok: true, code });
});

app.get("/api/host", (_request, response) => {
  const urls: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      urls.push(`http://${entry.address}:${CLIENT_PORT}`);
    }
  }
  response.json({ urls });
});

if (existsSync(path.join(CLIENT_DIST, "index.html"))) {
  app.use(express.static(CLIENT_DIST, { index: "index.html" }));
  // SPA fallback: everything that is not an API route or a real file gets index.html.
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/") || request.path.startsWith("/socket.io/")) {
      next();
      return;
    }
    response.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
  console.log(`Cityline-Client wird aus ${CLIENT_DIST} ausgeliefert`);
}

httpServer.listen(PORT, () => {
  console.log(`Cityline-Server hört auf http://localhost:${PORT}`);
});
