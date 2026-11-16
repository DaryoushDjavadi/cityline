import { cleanRoom } from "./protocol.ts";
import type { KeyValueStore } from "./citySlots.ts";

/**
 * Per-device credentials for cities this device created (or claimed) on the coop server.
 * `key` proves ownership for POST /api/cities; `rev` is the server revision this device last
 * wrote. The server rejects a POST whose rev is not the current one, so a local copy that
 * forked off a coop session can never overwrite the newer server city.
 */
export const CITY_AUTH_KEY = "cityline-city-auth";
/** Cities this device has played in a coop room. Their local copy is a fork, never pushed blindly. */
export const COOP_JOINED_KEY = "cityline-coop-joined";

export interface CityAuth {
  key: string;
  rev: string;
}

export interface CityPushReply {
  ok?: boolean;
  code?: string;
  reason?: string;
  rev?: string;
  key?: string;
}

function readMap<T>(storage: KeyValueStore, name: string): Record<string, T> {
  try {
    const parsed = JSON.parse(storage.getItem(name) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function loadCityAuth(id: string, storage: KeyValueStore): CityAuth | null {
  const code = cleanRoom(id);
  if (!code) return null;
  const entry = readMap<Partial<CityAuth>>(storage, CITY_AUTH_KEY)[code];
  return entry && typeof entry.key === "string" && typeof entry.rev === "string" ? { key: entry.key, rev: entry.rev } : null;
}

export function writeCityAuth(id: string, auth: CityAuth, storage: KeyValueStore): void {
  const code = cleanRoom(id);
  if (!code) return;
  const map = readMap<CityAuth>(storage, CITY_AUTH_KEY);
  map[code] = { key: auth.key, rev: auth.rev };
  storage.setItem(CITY_AUTH_KEY, JSON.stringify(map));
}

export function deleteCityAuth(id: string, storage: KeyValueStore): void {
  const code = cleanRoom(id);
  if (!code) return;
  const map = readMap<CityAuth>(storage, CITY_AUTH_KEY);
  if (!(code in map)) return;
  delete map[code];
  storage.setItem(CITY_AUTH_KEY, JSON.stringify(map));
}

/** Store what a successful POST /api/cities returned (new key on create/claim, new rev always). */
export function rememberCityPush(id: string, reply: CityPushReply, storage: KeyValueStore): void {
  if (!reply.ok || typeof reply.rev !== "string") return;
  const key = typeof reply.key === "string" ? reply.key : loadCityAuth(id, storage)?.key;
  if (!key) return;
  writeCityAuth(id, { key, rev: reply.rev }, storage);
}

export function markCoopJoined(id: string, storage: KeyValueStore): void {
  const code = cleanRoom(id);
  if (!code) return;
  const map = readMap<number>(storage, COOP_JOINED_KEY);
  map[code] = Date.now();
  storage.setItem(COOP_JOINED_KEY, JSON.stringify(map));
}

export function wasCoopJoined(id: string, storage: KeyValueStore): boolean {
  const code = cleanRoom(id);
  return Boolean(code && readMap<number>(storage, COOP_JOINED_KEY)[code]);
}

export function forgetCoopJoined(id: string, storage: KeyValueStore): void {
  const code = cleanRoom(id);
  if (!code) return;
  const map = readMap<number>(storage, COOP_JOINED_KEY);
  if (!(code in map)) return;
  delete map[code];
  storage.setItem(COOP_JOINED_KEY, JSON.stringify(map));
}
