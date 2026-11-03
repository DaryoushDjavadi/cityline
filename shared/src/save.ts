import { createCity } from "./city.ts";
import { goalMask } from "./goals.ts";
import { buildMeta } from "./sim.ts";
import { asUint8Array, packCells, writeCity, type CityState, type SimMeta } from "./types.ts";

export interface CitySave {
  version: 1;
  savedAt: string;
  name: string;
  meta: SimMeta;
  cells: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function cityToSave(city: CityState, name: string): CitySave {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    name,
    meta: buildMeta(city),
    cells: bytesToBase64(packCells(city)),
  };
}

export function saveToCity(raw: unknown): CityState | null {
  if (!raw || typeof raw !== "object") return null;
  const save = raw as Partial<CitySave>;
  if (save.version !== 1 || typeof save.cells !== "string" || !save.meta) return null;
  const city = createCity();
  const cells = asUint8Array(base64ToBytes(save.cells));
  if (!cells) return null;
  writeCity(city, cells, save.meta);
  if (typeof save.meta.goals !== "number") city.goals = goalMask(city);
  return city;
}
