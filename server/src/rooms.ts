import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { applyCommand, createCity } from "../../shared/src/city.ts";
import { uniqueCells } from "../../shared/src/grid.ts";
import { createLevelCity, evaluateLevel, isLevelRoom, levelById, levelRoomCode, parseLevelRoom } from "../../shared/src/levels.ts";
import { CHAT_HISTORY, cleanChat, cleanName, cleanRoom, commandCells, parseCommand, type ChatMessage, type LevelSync } from "../../shared/src/protocol.ts";
import { buildMeta, refreshUtilities, stepSimulation } from "../../shared/src/sim.ts";
import { packCells, writeCity, type CityState, type Command, type PublicPlayer } from "../../shared/src/types.ts";
import { deleteCity, loadCity, saveCity, savedRooms, type RoomListing } from "./persist.ts";

const MAX_PLAYERS = 2;
const TICK_MS = 500;
const LOCK_MS = 5000;

interface Player {
  id: string;
  name: string;
  socket: Socket;
  slot: number;
  lookX: number;
  lookZ: number;
}

interface Room {
  code: string;
  city: ReturnType<typeof createCity>;
  players: Player[];
  locks: Map<number, { playerId: string; at: number }>;
  level: LevelSync | null;
  chat: ChatMessage[];
}

export function attachCityServer(io: Server): {
  listRooms: () => RoomListing[];
  importCity: (code: string, city: CityState) => void;
  removeCity: (code: string) => "ok" | "missing" | "in_use";
} {
  const rooms = new Map<string, Room>();

  const timer = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.players.length === 0) continue;
      const frozen = room.level !== null && room.level.outcome !== "playing";
      if (!frozen) {
        stepSimulation(room.city);
        if (room.level) syncLevel(room);
        else if (room.city.tick % 8 === 0) saveCity(room.code, room.city);
      }
      emitState(room);
    }
  }, TICK_MS);
  timer.unref?.();

  io.on("connection", (socket) => {
    let joined: { room: Room; player: Player } | null = null;

    socket.on("join", (payload: unknown) => {
      if (joined) return;
      const body = payload as { room?: unknown; name?: unknown; level?: unknown };
      const wanted = Number(body?.level);
      const tagged = cleanRoom(body?.room);
      const fromLevel = Number.isInteger(wanted) ? levelRoomCode(wanted, tagged ?? "") : null;
      const code = fromLevel ?? tagged;
      if (!code) {
        socket.emit("joinError", { reason: "bad_room" });
        return;
      }
      const parsed = parseLevelRoom(code);
      const existing = rooms.get(code);
      if (existing && parsed && existing.level?.id !== parsed.level) {
        socket.emit("joinError", { reason: "level_mismatch" });
        return;
      }
      if (existing && !parsed && existing.level) {
        socket.emit("joinError", { reason: "level_mismatch" });
        return;
      }
      const room = existing ?? createRoom(code);
      if (room.players.length >= MAX_PLAYERS) {
        socket.emit("joinError", { reason: "room_full" });
        return;
      }
      rooms.set(code, room);
      const player: Player = {
        id: socket.id,
        name: cleanName(body?.name),
        socket,
        slot: room.players.length,
        lookX: 0,
        lookZ: 0,
      };
      room.players.push(player);
      joined = { room, player };
      socket.emit("welcome", {
        playerId: player.id,
        slot: player.slot,
        room: room.code,
        players: publicPlayers(room),
        level: room.level?.id ?? null,
        chat: room.chat,
      });
      emitState(room);
      broadcastPlayers(room);
    });

    socket.on("chat", (payload: unknown) => {
      if (!joined) return;
      const text = cleanChat((payload as { text?: unknown })?.text);
      if (!text) return;
      const message: ChatMessage = {
        id: randomUUID(),
        playerId: joined.player.id,
        name: joined.player.name,
        text,
        at: Date.now(),
      };
      joined.room.chat.push(message);
      if (joined.room.chat.length > CHAT_HISTORY) {
        joined.room.chat.splice(0, joined.room.chat.length - CHAT_HISTORY);
      }
      for (const player of joined.room.players) player.socket.emit("chat", message);
    });

    socket.on("lock", (payload: unknown) => {
      if (!joined) return;
      const cells = uniqueCells(readCells(payload));
      const now = Date.now();
      releaseLocks(joined.room, joined.player.id);
      const denied: number[] = [];
      for (const cell of cells) {
        const lock = freshLock(joined.room, cell, now);
        if (lock && lock.playerId !== joined.player.id) {
          denied.push(cell);
          continue;
        }
        joined.room.locks.set(cell, { playerId: joined.player.id, at: now });
      }
      socket.emit("lockResult", { denied });
      broadcastLocks(joined.room);
    });

    socket.on("unlock", () => {
      if (!joined) return;
      releaseLocks(joined.room, joined.player.id);
      broadcastLocks(joined.room);
    });

    socket.on("look", (payload: unknown) => {
      if (!joined) return;
      const body = payload as { x?: unknown; z?: unknown };
      const x = Number(body?.x);
      const z = Number(body?.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      joined.player.lookX = Math.max(-400, Math.min(400, x));
      joined.player.lookZ = Math.max(-400, Math.min(400, z));
      broadcastPlayers(joined.room);
    });

    socket.on("levelReset", () => {
      if (!joined?.room.level) return;
      resetLevel(joined.room);
      emitState(joined.room);
      broadcastLocks(joined.room);
    });

    socket.on("command", (payload: unknown) => {
      if (!joined) return;
      const body = payload as { id?: unknown; command?: unknown };
      const id = typeof body?.id === "string" ? body.id.slice(0, 64) : "";
      const command = parseCommand(body?.command);
      if (!id || !command) {
        socket.emit("commandResult", { id, ok: false, reason: "rejected", spent: 0, rejected: [] });
        return;
      }
      if (joined.room.level && joined.room.level.outcome !== "playing") {
        socket.emit("commandResult", { id, ok: false, reason: "rejected", spent: 0, rejected: [] });
        return;
      }
      const owned = filterLocked(joined.room, joined.player.id, command);
      const result = applyCommand(joined.room.city, owned.command);
      if (result.applied.length > 0) refreshUtilities(joined.room.city);
      if (owned.blocked.length > 0) {
        result.rejected.push(...owned.blocked);
        if (!result.ok) result.reason = "locked";
      }
      releaseLocks(joined.room, joined.player.id);
      socket.emit("commandResult", { id, ...result });
      emitState(joined.room);
      broadcastLocks(joined.room);
      if (result.applied.length > 0) {
        if (joined.room.level) syncLevel(joined.room);
        else saveCity(joined.room.code, joined.room.city);
      }
    });

    socket.on("disconnect", () => {
      if (!joined) return;
      const { room, player } = joined;
      releaseLocks(room, player.id);
      room.players = room.players.filter((entry) => entry.id !== player.id);
      room.players.forEach((entry, index) => {
        entry.slot = index;
      });
      broadcastLocks(room);
      broadcastPlayers(room);
      if (room.players.length === 0) {
        if (!room.level) saveCity(room.code, room.city);
        rooms.delete(room.code);
      }
      joined = null;
    });
  });

  return {
    removeCity(code) {
      const live = rooms.get(code);
      if (live && live.players.length > 0) return "in_use";
      if (live) rooms.delete(code);
      return deleteCity(code) ? "ok" : "missing";
    },
    importCity(code, next) {
      if (isLevelRoom(code)) return;
      const live = rooms.get(code);
      if (live) {
        if (live.level) return;
        writeCity(live.city, packCells(next), buildMeta(next));
        refreshUtilities(live.city);
        emitState(live);
        saveCity(code, live.city);
        return;
      }
      refreshUtilities(next);
      saveCity(code, next);
    },
    listRooms() {
      const listed = savedRooms().filter((entry) => !isLevelRoom(entry.code));
      for (const room of rooms.values()) {
        const existing = listed.find((entry) => entry.code === room.code);
        const summary = {
          code: room.code,
          savedAt: new Date().toISOString(),
          population: room.city.levels.reduce((sum, level, index) => sum + (room.city.zones[index] === 1 ? level * 12 : 0), 0),
          funds: room.city.funds,
          players: room.players.length,
          level: room.level?.id ?? null,
        };
        if (existing) Object.assign(existing, summary);
        else listed.push(summary);
      }
      return listed.sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
    },
  };
}

function createRoom(code: string): Room {
  const parsed = parseLevelRoom(code);
  if (parsed) {
    const def = levelById(parsed.level);
    if (!def) return { code, city: createCity(), players: [], locks: new Map(), level: null, chat: [] };
    const city = createLevelCity(def);
    return {
      code,
      city,
      players: [],
      locks: new Map(),
      level: { id: def.id, startedTick: city.tick, outcome: "playing" },
      chat: [],
    };
  }
  return { code, city: loadCity(code) ?? createCity(), players: [], locks: new Map(), level: null, chat: [] };
}

function resetLevel(room: Room): void {
  if (!room.level) return;
  const def = levelById(room.level.id);
  if (!def) return;
  const city = createLevelCity(def);
  writeCity(room.city, packCells(city), buildMeta(city));
  refreshUtilities(room.city);
  room.locks.clear();
  room.level = { id: def.id, startedTick: room.city.tick, outcome: "playing" };
}

function syncLevel(room: Room): void {
  if (!room.level || room.level.outcome !== "playing") return;
  const def = levelById(room.level.id);
  if (!def) return;
  const status = evaluateLevel(def, room.city, room.level.startedTick);
  if (status.won) room.level.outcome = "won";
  else if (status.failed) room.level.outcome = "lost";
}

function publicPlayers(room: Room): PublicPlayer[] {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    slot: player.slot,
    lookX: player.lookX,
    lookZ: player.lookZ,
  }));
}

function emitState(room: Room): void {
  const payload = { meta: buildMeta(room.city), cells: packCells(room.city), level: room.level };
  for (const player of room.players) player.socket.emit("state", payload);
}

function broadcastPlayers(room: Room): void {
  const players = publicPlayers(room);
  for (const player of room.players) player.socket.emit("players", { players });
}

function broadcastLocks(room: Room): void {
  const now = Date.now();
  const locks = [...room.locks.entries()]
    .filter(([, lock]) => now - lock.at <= LOCK_MS)
    .map(([cell, lock]) => ({ cell, playerId: lock.playerId }));
  for (const player of room.players) player.socket.emit("locks", { locks });
}

function releaseLocks(room: Room, playerId: string): void {
  for (const [cell, lock] of room.locks) {
    if (lock.playerId === playerId) room.locks.delete(cell);
  }
}

function freshLock(room: Room, cell: number, now: number): { playerId: string; at: number } | undefined {
  const lock = room.locks.get(cell);
  if (!lock) return undefined;
  if (now - lock.at > LOCK_MS) {
    room.locks.delete(cell);
    return undefined;
  }
  return lock;
}

function readCells(payload: unknown): number[] {
  const cells = (payload as { cells?: unknown })?.cells;
  return Array.isArray(cells) ? cells.filter((cell) => Number.isInteger(cell)) : [];
}

function filterLocked(room: Room, playerId: string, command: Command): { command: Command; blocked: number[] } {
  const now = Date.now();
  const blocked: number[] = [];
  const allowed: number[] = [];
  for (const cell of commandCells(command)) {
    const lock = freshLock(room, cell, now);
    if (lock && lock.playerId !== playerId) blocked.push(cell);
    else allowed.push(cell);
  }
  if (command.type === "hire") {
    return {
      command: blocked.length > 0 ? { type: "road", cells: [] } : command,
      blocked,
    };
  }
  if (command.type === "service" || command.type === "budget" || command.type === "gift") {
    return {
      command: blocked.includes(command.index) ? { type: "road", cells: [] } : command,
      blocked,
    };
  }
  if (command.type === "zone") return { command: { ...command, cells: allowed }, blocked };
  return { command: { ...command, cells: allowed }, blocked };
}
