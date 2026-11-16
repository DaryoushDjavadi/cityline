import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanRoom } from "../../shared/src/protocol.ts";
import { cityToSave, saveToCity, type CitySave } from "../../shared/src/save.ts";
import { refreshUtilities } from "../../shared/src/sim.ts";
import type { CityState } from "../../shared/src/types.ts";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// DATA_DIR (e.g. a Render persistent disk at /var/data/rooms) wins; otherwise <repo>/data/rooms.
const directory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(serverRoot, "../data/rooms");
const seedDirectory = path.join(serverRoot, "seed", "rooms");

seedRooms();

/** Copy bundled seed cities into an empty/new data dir without overwriting existing saves. */
function seedRooms(): void {
  try {
    mkdirSync(directory, { recursive: true });
    if (!existsSync(seedDirectory)) return;
    for (const name of readdirSync(seedDirectory)) {
      if (!name.endsWith(".json")) continue;
      const target = path.join(directory, name);
      if (!existsSync(target)) copyFileSync(path.join(seedDirectory, name), target);
    }
  } catch (error) {
    console.warn("Seed-Städte konnten nicht kopiert werden:", error);
  }
}

export interface RoomListing {
  code: string;
  name: string;
  savedAt: string;
  population: number;
  funds: number;
  players: number;
  level?: number | null;
}

export function loadCity(code: string): CityState | null {
  try {
    const city = saveToCity(readRaw(code));
    if (!city) return null;
    refreshUtilities(city);
    return city;
  } catch {
    return null;
  }
}

export function peekSave(code: string): CitySave | null {
  try {
    const raw = readRaw(code);
    return raw && saveToCity(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Server-only fields stored next to a save. Never sent to clients via /api/rooms. */
interface StoredAuth {
  /** sha256 (hex) of the owner key handed out when the city was created or claimed. */
  owner?: string;
  /** Changes on every content save; a POST must name the current rev to overwrite. */
  rev?: string;
}

export interface SaveAuth {
  /** File was written before revisions existed (pre coop-overwrite fix). */
  legacy: boolean;
  owner: string | null;
  rev: string | null;
  tick: number;
}

export interface SaveOptions {
  /** Keep the current rev (content did not change, e.g. evicting an idle room). */
  keepRev?: boolean;
  /** Set a new owner hash (create/claim). Otherwise the stored owner is kept. */
  owner?: string;
}

export function peekAuth(code: string): SaveAuth | null {
  const raw = peekSave(code) as (CitySave & StoredAuth) | null;
  if (!raw) return null;
  return {
    legacy: typeof raw.rev !== "string",
    owner: typeof raw.owner === "string" ? raw.owner : null,
    rev: typeof raw.rev === "string" ? raw.rev : null,
    tick: Number(raw.meta?.tick) || 0,
  };
}

/** Write the city to disk and return the revision that now identifies it. */
export function saveCity(code: string, city: CityState, name?: string, options: SaveOptions = {}): string | null {
  const safe = cleanRoom(code);
  if (!safe) return null;
  mkdirSync(directory, { recursive: true });
  const previous = peekSave(safe) as (CitySave & StoredAuth) | null;
  const label = (name && name.trim()) || previous?.name || safe;
  const owner = options.owner ?? previous?.owner;
  const rev = options.keepRev && typeof previous?.rev === "string" ? previous.rev : randomUUID();
  const stored: CitySave & StoredAuth = { ...cityToSave(city, label, safe), rev };
  if (owner) stored.owner = owner;
  writeFileSync(fileFor(safe), JSON.stringify(stored));
  return rev;
}

export function deleteCity(code: string): boolean {
  const safe = cleanRoom(code);
  if (!safe) return false;
  try {
    rmSync(fileFor(safe));
    return true;
  } catch {
    return false;
  }
}

export function savedRooms(): RoomListing[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const code = name.slice(0, -5);
        const raw = peekSave(code);
        const city = raw ? loadCity(code) : null;
        return {
          code,
          name: raw?.name || code,
          savedAt: raw?.savedAt ?? "",
          population: city ? countPopulation(city) : raw?.meta?.stats?.population ?? 0,
          funds: city?.funds ?? raw?.meta?.funds ?? 0,
          players: 0,
        };
      });
  } catch {
    return [];
  }
}

function countPopulation(city: CityState): number {
  let population = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] === 1) population += city.levels[index] * 12;
  }
  return population;
}

function readRaw(code: string): CitySave | null {
  const safe = cleanRoom(code);
  if (!safe) return null;
  const parsed = JSON.parse(readFileSync(fileFor(safe), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as CitySave;
}

function fileFor(code: string): string {
  const safe = cleanRoom(code);
  if (!safe) throw new Error("bad city code");
  return path.join(directory, `${safe}.json`);
}
