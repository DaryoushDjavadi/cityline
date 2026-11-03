import type { Server, Socket } from "socket.io";
import { applyCommand, createCity } from "../../shared/src/city.ts";
import { uniqueCells } from "../../shared/src/grid.ts";
import { cleanName, cleanRoom, commandCells, parseCommand } from "../../shared/src/protocol.ts";
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
}

interface Room {
  code: string;
  city: ReturnType<typeof createCity>;
  players: Player[];
  locks: Map<number, { playerId: string; at: number }>;
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
      stepSimulation(room.city);
      if (room.city.tick % 8 === 0) saveCity(room.code, room.city);
      emitState(room);
    }
  }, TICK_MS);
  timer.unref?.();

  io.on("connection", (socket) => {
    let joined: { room: Room; player: Player } | null = null;

    socket.on("join", (payload: unknown) => {
      if (joined) return;
      const body = payload as { room?: unknown; name?: unknown };
      const code = cleanRoom(body?.room);
      if (!code) {
        socket.emit("joinError", { reason: "bad_room" });
        return;
      }
      const room = rooms.get(code) ?? createRoom(code);
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
      };
      room.players.push(player);
      joined = { room, player };
      socket.emit("welcome", {
        playerId: player.id,
        slot: player.slot,
        room: room.code,
        players: publicPlayers(room),
      });
      emitState(room);
      broadcastPlayers(room);
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

    socket.on("command", (payload: unknown) => {
      if (!joined) return;
      const body = payload as { id?: unknown; command?: unknown };
      const id = typeof body?.id === "string" ? body.id.slice(0, 64) : "";
      const command = parseCommand(body?.command);
      if (!id || !command) {
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
      if (result.applied.length > 0) saveCity(joined.room.code, joined.room.city);
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
        saveCity(room.code, room.city);
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
      const live = rooms.get(code);
      if (live) {
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
      const online = new Map(rooms);
      const listed = savedRooms();
      for (const room of online.values()) {
        const existing = listed.find((entry) => entry.code === room.code);
        const summary = {
          code: room.code,
          savedAt: new Date().toISOString(),
          population: room.city.levels.reduce((sum, level, index) => sum + (room.city.zones[index] === 1 ? level * 12 : 0), 0),
          funds: room.city.funds,
          players: room.players.length,
        };
        if (existing) Object.assign(existing, summary);
        else listed.push(summary);
      }
      return listed.sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
    },
  };
}

function createRoom(code: string): Room {
  return { code, city: loadCity(code) ?? createCity(), players: [], locks: new Map() };
}

function publicPlayers(room: Room): PublicPlayer[] {
  return room.players.map((player) => ({ id: player.id, name: player.name, slot: player.slot }));
}

function emitState(room: Room): void {
  const payload = { meta: buildMeta(room.city), cells: packCells(room.city) };
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
