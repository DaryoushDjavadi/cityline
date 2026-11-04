import type { CityState } from "./types.ts";
import { Zone } from "./types.ts";

/** Stored in city.skills on Farm cells (residential uses bits 0–2). */
export const FARM_LIVESTOCK = 0b1000;
export const FARM_IRRIGATION = 0b10000;
export const FARM_SILO = 0b100000;

export type FarmAction = "livestock" | "wheat" | "irrigation" | "silo";

export interface FarmUpgrade {
  action: FarmAction;
  name: string;
  detail: string;
  cost: number;
  /** import = kaufen, export = umstellen */
  side: "import" | "export";
}

export const FARM_UPGRADES: Record<FarmAction, FarmUpgrade> = {
  livestock: {
    action: "livestock",
    name: "Tiere kaufen",
    detail: "Weide statt Acker · mehr Nahrung je Arbeiter",
    cost: 2800,
    side: "import",
  },
  wheat: {
    action: "wheat",
    name: "Nur Getreide",
    detail: "Herde verkaufen · zurück zum Acker",
    cost: 400,
    side: "export",
  },
  irrigation: {
    action: "irrigation",
    name: "Bewässerung",
    detail: "+35 % Ernte · Gräben und Sprinkler",
    cost: 1600,
    side: "import",
  },
  silo: {
    action: "silo",
    name: "Getreidesilo",
    detail: "+20 % Ernte · größeres Lager",
    cost: 2200,
    side: "import",
  },
};

export interface FarmStatus {
  livestock: boolean;
  irrigation: boolean;
  silo: boolean;
  modeLabel: string;
  cropLabel: string;
  /** Multiplier on top of workers × FOOD_PER_WORKER × utility × budget. */
  yieldMult: number;
}

export function farmStatus(city: CityState, index: number): FarmStatus | null {
  if (city.zones[index] !== Zone.Farm || city.levels[index] <= 0) return null;
  const bits = city.skills[index];
  const livestock = (bits & FARM_LIVESTOCK) !== 0;
  const irrigation = (bits & FARM_IRRIGATION) !== 0;
  const silo = (bits & FARM_SILO) !== 0;
  let yieldMult = livestock ? 1.55 : 1;
  if (irrigation) yieldMult *= 1.35;
  if (silo) yieldMult *= 1.2;
  return {
    livestock,
    irrigation,
    silo,
    modeLabel: livestock ? "Viehwirtschaft" : "Getreideanbau",
    cropLabel: livestock ? "Weide & Tiere" : "Weizenacker",
    yieldMult,
  };
}

export function farmActionAvailable(city: CityState, index: number, action: FarmAction): { ok: boolean; hint?: string } {
  const status = farmStatus(city, index);
  if (!status) return { ok: false, hint: "Kein Bauernhof." };
  if (action === "livestock") {
    if (status.livestock) return { ok: false, hint: "Tiere sind schon da." };
    return { ok: true };
  }
  if (action === "wheat") {
    if (!status.livestock) return { ok: false, hint: "Läuft schon auf Getreide." };
    return { ok: true };
  }
  if (action === "irrigation") {
    if (status.irrigation) return { ok: false, hint: "Bewässerung ist fertig." };
    return { ok: true };
  }
  if (action === "silo") {
    if (status.silo) return { ok: false, hint: "Silo steht schon." };
    return { ok: true };
  }
  return { ok: false, hint: "Unbekannt." };
}

export function farmModelKey(skills: number): string {
  const livestock = (skills & FARM_LIVESTOCK) !== 0;
  const irrigation = (skills & FARM_IRRIGATION) !== 0;
  const silo = (skills & FARM_SILO) !== 0;
  if (livestock && irrigation && silo) return "farmHerdWetSilo";
  if (livestock && irrigation) return "farmHerdWet";
  if (livestock && silo) return "farmHerdSilo";
  if (livestock) return "farmHerd";
  if (irrigation && silo) return "farmWetSilo";
  if (irrigation) return "farmWet";
  if (silo) return "farmSilo";
  return "farm";
}

export function isFarmAction(value: string): value is FarmAction {
  return value === "livestock" || value === "wheat" || value === "irrigation" || value === "silo";
}
