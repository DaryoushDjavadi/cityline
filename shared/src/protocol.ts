import { buildingInfo, serviceInfo } from "./catalog.ts";
import { Zone, type Command, type PublicPlayer, type ServiceId, type SimMeta, type ZoneId } from "./types.ts";

export interface JoinPayload {
  room: string;
  name: string;
  level?: number;
}

export type LevelOutcome = "playing" | "won" | "lost";

export interface LevelSync {
  id: number;
  startedTick: number;
  outcome: LevelOutcome;
}

export interface WelcomePayload {
  playerId: string;
  slot: number;
  room: string;
  players: PublicPlayer[];
  level: number | null;
}

export interface StatePayload {
  meta: SimMeta;
  cells: Uint8Array;
  level?: LevelSync | null;
}

export interface ClientCommand {
  id: string;
  command: Command;
}

export interface CommandResult {
  id: string;
  ok: boolean;
  reason?: string;
  spent: number;
  rejected: number[];
}

export interface LockSnapshot {
  locks: { cell: number; playerId: string }[];
}

export function cleanRoom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const room = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  return room.length >= 2 ? room : null;
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") return "Spieler";
  const name = value.trim().replace(/\s+/g, " ").slice(0, 18);
  return name.length > 0 ? name : "Spieler";
}

export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== "object") return null;
  const command = raw as { type?: unknown; cells?: unknown; zone?: unknown; index?: unknown; kind?: unknown; value?: unknown; workplace?: unknown; home?: unknown; slot?: unknown };
  if (command.type === "road" || command.type === "bridge" || command.type === "fill" || command.type === "bulldoze" || command.type === "line" || command.type === "pipe") {
    if (!Array.isArray(command.cells)) return null;
    return { type: command.type, cells: command.cells.filter((cell) => Number.isInteger(cell)) as number[] };
  }
  if (command.type === "build") {
    if (!Array.isArray(command.cells) || typeof command.kind !== "string" || !buildingInfo(command.kind)) return null;
    return {
      type: "build",
      kind: command.kind,
      cells: command.cells.filter((cell) => Number.isInteger(cell)) as number[],
    };
  }
  if (command.type === "zone") {
    if (!Array.isArray(command.cells)) return null;
    const zone = command.zone;
    if (zone !== Zone.Residential && zone !== Zone.Commercial && zone !== Zone.Industrial) return null;
    return {
      type: "zone",
      zone: zone as ZoneId,
      cells: command.cells.filter((cell) => Number.isInteger(cell)) as number[],
    };
  }
  if (command.type === "service") {
    if (!Number.isInteger(command.index)) return null;
    if (typeof command.kind !== "number" || !serviceInfo(command.kind)) return null;
    return { type: "service", index: command.index as number, kind: command.kind as ServiceId };
  }
  if (command.type === "budget") {
    if (!Number.isInteger(command.index) || !Number.isInteger(command.value)) return null;
    return { type: "budget", index: command.index as number, value: command.value as number };
  }
  if (command.type === "gift") {
    if (!Number.isInteger(command.index)) return null;
    return { type: "gift", index: command.index as number };
  }
  if (command.type === "hire") {
    if (!Number.isInteger(command.workplace) || !Number.isInteger(command.home) || !Number.isInteger(command.slot)) return null;
    if ((command.slot as number) < 0 || (command.slot as number) > 7) return null;
    return { type: "hire", workplace: command.workplace as number, home: command.home as number, slot: command.slot as number };
  }
  return null;
}

export function commandCells(command: Command): number[] {
  if (command.type === "service" || command.type === "budget" || command.type === "gift") return [command.index];
  if (command.type === "hire") return [command.workplace, command.home];
  return command.cells;
}
