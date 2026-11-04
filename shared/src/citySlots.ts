import { cleanRoom } from "./protocol.ts";
import { isLevelRoom } from "./levels.ts";
import { saveToCity, type CitySave } from "./save.ts";

export const LIBRARY_KEY = "cityline-library";
export const SLOT_PREFIX = "cityline-city:";
export const LEGACY_SOLO_KEY = "cityline-solo";
export const CLIENT_ID_KEY = "cityline-client-id";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CitySlotMeta {
  id: string;
  name: string;
  savedAt: string;
  population: number;
  funds: number;
}

interface LibraryIndex {
  version: 1;
  ids: string[];
  active: string | null;
}

export interface RoomListEntry {
  code: string;
  name?: string;
  players: number;
  population: number;
  funds: number;
  level?: number | null;
  savedAt?: string;
}

/** Unique storage/room key. Display names may collide; keys must not. */
export function allocateCityCode(name: string, taken: Iterable<string>): string | null {
  const cleaned = cleanRoom(name);
  if (!cleaned) return null;
  const used = new Set([...taken].map((code) => code.toLowerCase()));
  const root = isLevelRoom(cleaned) ? `s-${cleaned}`.slice(0, 24) : cleaned;
  const fits = (code: string) =>
    code.length >= 2 && code.length <= 24 && !used.has(code) && !isLevelRoom(code);
  if (fits(root)) return root;
  for (let n = 2; n < 10000; n += 1) {
    const suffix = `-${n}`;
    const stem = root.slice(0, Math.max(1, 24 - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (fits(candidate)) return candidate;
  }
  return null;
}

export function slotKey(id: string): string {
  return `${SLOT_PREFIX}${id}`;
}

export function listCitySlots(storage: KeyValueStore): CitySlotMeta[] {
  migrateLegacySolo(storage);
  const ids = readIndex(storage).ids;
  const rows: CitySlotMeta[] = [];
  for (const id of ids) {
    const save = loadCitySlot(id, storage);
    if (!save) continue;
    rows.push({
      id,
      name: save.name || id,
      savedAt: save.savedAt,
      population: save.meta?.stats?.population ?? 0,
      funds: save.meta?.funds ?? 0,
    });
  }
  return rows;
}

export function loadCitySlot(id: string, storage: KeyValueStore): CitySave | null {
  if (!cleanRoom(id)) return null;
  try {
    const raw = storage.getItem(slotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!saveToCity(parsed)) return null;
    return parsed as CitySave;
  } catch {
    return null;
  }
}

/**
 * Write one slot. Refuses a different city's id, and refuses a blank/stale
 * snapshot over a developed city (never clobber city A with an empty B).
 */
export function writeCitySlot(id: string, save: CitySave, storage: KeyValueStore): boolean {
  const code = cleanRoom(id);
  if (!code || isLevelRoom(code)) return false;
  if (save.id && save.id !== code) return false;
  const existing = loadCitySlot(code, storage);
  if (existing && isDeveloped(existing) && !isDeveloped(save) && (save.meta?.tick ?? 0) < (existing.meta?.tick ?? 0)) {
    return false;
  }
  const next: CitySave = { ...save, id: code, name: save.name || existing?.name || code };
  storage.setItem(slotKey(code), JSON.stringify(next));
  const index = readIndex(storage);
  if (!index.ids.includes(code)) index.ids.push(code);
  index.active = code;
  writeIndex(storage, index);
  return true;
}

export function deleteCitySlot(id: string, storage: KeyValueStore): void {
  const code = cleanRoom(id);
  if (!code) return;
  storage.removeItem(slotKey(code));
  const index = readIndex(storage);
  index.ids = index.ids.filter((entry) => entry !== code);
  if (index.active === code) index.active = index.ids[0] ?? null;
  writeIndex(storage, index);
}

export function getActiveCityId(storage: KeyValueStore): string | null {
  migrateLegacySolo(storage);
  return readIndex(storage).active;
}

export function setActiveCityId(id: string | null, storage: KeyValueStore): void {
  const index = readIndex(storage);
  index.active = id && index.ids.includes(id) ? id : index.ids[0] ?? null;
  writeIndex(storage, index);
}

export function migrateLegacySolo(storage: KeyValueStore): void {
  const index = readIndex(storage);
  if (index.ids.length > 0) return;
  const raw = storage.getItem(LEGACY_SOLO_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const city = saveToCity(parsed);
    if (!city) return;
    const save = parsed as CitySave;
    const id = allocateCityCode(save.name || "lokal", index.ids) ?? "lokal";
    writeCitySlot(id, { ...save, id, name: save.name || "lokal" }, storage);
  } catch {
    // Keep the legacy blob; a later visit can try again.
  }
}

export function mergeRoomLists(local: RoomListEntry[], remote: RoomListEntry[]): RoomListEntry[] {
  const map = new Map<string, RoomListEntry>();
  for (const row of local) map.set(row.code, { ...row });
  for (const row of remote) {
    const prev = map.get(row.code);
    const savedAt = [prev?.savedAt, row.savedAt].filter((value): value is string => !!value).sort().at(-1);
    map.set(row.code, {
      code: row.code,
      name: row.name || prev?.name,
      players: row.players,
      population: row.players > 0 ? row.population : row.population || prev?.population || 0,
      funds: row.funds || prev?.funds || 0,
      level: row.level ?? prev?.level ?? null,
      savedAt,
    });
  }
  return [...map.values()].sort((a, b) => {
    if (b.players !== a.players) return b.players - a.players;
    const byTime = stamp(b.savedAt) - stamp(a.savedAt);
    if (byTime !== 0) return byTime;
    return (a.name ?? a.code).localeCompare(b.name ?? b.code, "de");
  });
}

function stamp(value?: string): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function loadOrCreateClientId(storage: KeyValueStore, randomId: () => string): string {
  const existing = storage.getItem(CLIENT_ID_KEY);
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = randomId().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || `c${Date.now()}`;
  storage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function isDeveloped(save: CitySave): boolean {
  const stats = save.meta?.stats;
  return (stats?.population ?? 0) > 0 || (stats?.jobs ?? 0) > 0;
}

function readIndex(storage: KeyValueStore): LibraryIndex {
  try {
    const raw = storage.getItem(LIBRARY_KEY);
    if (!raw) return { version: 1, ids: [], active: null };
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    const ids = Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === "string" && !!cleanRoom(id) && !isLevelRoom(id))
      : [];
    const active = typeof parsed.active === "string" && ids.includes(parsed.active) ? parsed.active : ids[0] ?? null;
    return { version: 1, ids, active };
  } catch {
    return { version: 1, ids: [], active: null };
  }
}

function writeIndex(storage: KeyValueStore, index: LibraryIndex): void {
  storage.setItem(LIBRARY_KEY, JSON.stringify(index));
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
