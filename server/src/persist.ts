import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cityToSave, saveToCity } from "../../shared/src/save.ts";
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
  savedAt: string;
  population: number;
  funds: number;
  players: number;
}

export function loadCity(code: string): CityState | null {
  try {
    const city = saveToCity(JSON.parse(readFileSync(fileFor(code), "utf8")));
    if (!city) return null;
    refreshUtilities(city);
    return city;
  } catch {
    return null;
  }
}

export function saveCity(code: string, city: CityState): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileFor(code), JSON.stringify(cityToSave(city, code)));
}

export function deleteCity(code: string): boolean {
  try {
    rmSync(fileFor(code));
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
        const city = loadCity(code);
        const raw = JSON.parse(readFileSync(fileFor(code), "utf8")) as { savedAt?: string };
        return {
          code,
          savedAt: raw.savedAt ?? "",
          population: city ? countPopulation(city) : 0,
          funds: city?.funds ?? 0,
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

function fileFor(code: string): string {
  return path.join(directory, `${code}.json`);
}
