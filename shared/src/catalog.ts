import { COST } from "./grid.ts";
import { ServiceKind, Zone, type ServiceId, type ZoneId } from "./types.ts";

export interface ServiceInfo {
  kind: ServiceId;
  name: string;
  cost: number;
  upkeep: number;
  radius: number;
  blurb: string;
}

export const SERVICES: Record<number, ServiceInfo> = {
  [ServiceKind.Power]: {
    kind: ServiceKind.Power,
    name: "Kraftwerk",
    cost: COST.power,
    upkeep: 22,
    radius: 0,
    blurb: "Liefert Strom nur in Leitungen, die das Gebäude berühren.",
  },
  [ServiceKind.Water]: {
    kind: ServiceKind.Water,
    name: "Wasserwerk",
    cost: COST.water,
    upkeep: 16,
    radius: 0,
    blurb: "Speist Wasser nur in angeschlossene Rohre.",
  },
  [ServiceKind.School]: {
    kind: ServiceKind.School,
    name: "Schule",
    cost: COST.school,
    upkeep: 10,
    radius: 12,
    blurb: "Gebildete Bewohner zahlen mehr Steuern und verdienen im Gewerbe deutlich mehr.",
  },
  [ServiceKind.Clinic]: {
    kind: ServiceKind.Clinic,
    name: "Klinik",
    cost: COST.clinic,
    upkeep: 12,
    radius: 10,
    blurb: "Wohnhäuser im Umkreis zahlen ein Viertel mehr Steuern.",
  },
  [ServiceKind.Police]: {
    kind: ServiceKind.Police,
    name: "Polizei",
    cost: COST.police,
    upkeep: 8,
    radius: 9,
    blurb: "Senkt den Unterhalt von Häusern und Betrieben im Umkreis.",
  },
  [ServiceKind.Fire]: {
    kind: ServiceKind.Fire,
    name: "Feuerwehr",
    cost: COST.fire,
    upkeep: 8,
    radius: 9,
    blurb: "Industrie im Umkreis hat weniger Unterhalt und liefert mehr.",
  },
  [ServiceKind.Park]: {
    kind: ServiceKind.Park,
    name: "Park",
    cost: COST.park,
    upkeep: 3,
    radius: 7,
    blurb: "Wohnhäuser im Umkreis zahlen etwas mehr Steuern.",
  },
  [ServiceKind.University]: {
    kind: ServiceKind.University,
    name: "Universität",
    cost: COST.university,
    upkeep: 16,
    radius: 16,
    blurb: "Macht aus Schulabsolventen Akademiker. Die verdienen im Gewerbe fast das Doppelte.",
  },
};

export function serviceInfo(kind: number): ServiceInfo | null {
  return SERVICES[kind] ?? null;
}

export function readBudget(value: number): number {
  return value >= 50 && value <= 150 ? value : 100;
}

export type BuildingId = "cottage" | "apartments" | "tower" | "shop" | "office" | "mall" | "workshop" | "factory" | "plant";

export interface BuildingInfo {
  id: BuildingId;
  name: string;
  zone: ZoneId;
  level: number;
  cost: number;
}

export const BUILDINGS: Record<BuildingId, BuildingInfo> = {
  cottage: { id: "cottage", name: "Kleines Haus", zone: Zone.Residential, level: 1, cost: 450 },
  apartments: { id: "apartments", name: "Mehrfamilienhaus", zone: Zone.Residential, level: 3, cost: 1600 },
  tower: { id: "tower", name: "Hochhaus", zone: Zone.Residential, level: 5, cost: 4200 },
  shop: { id: "shop", name: "Laden", zone: Zone.Commercial, level: 1, cost: 700 },
  office: { id: "office", name: "Bürohaus", zone: Zone.Commercial, level: 3, cost: 2400 },
  mall: { id: "mall", name: "Kaufhaus", zone: Zone.Commercial, level: 5, cost: 5200 },
  workshop: { id: "workshop", name: "Werkstatt", zone: Zone.Industrial, level: 1, cost: 900 },
  factory: { id: "factory", name: "Fabrik", zone: Zone.Industrial, level: 3, cost: 2800 },
  plant: { id: "plant", name: "Industrieanlage", zone: Zone.Industrial, level: 5, cost: 6400 },
};

export function buildingInfo(kind: string): BuildingInfo | null {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, kind) ? BUILDINGS[kind as BuildingId] : null;
}

export function refundForLevel(zone: number, level: number): number {
  const match = Object.values(BUILDINGS).find((entry) => entry.zone === zone && entry.level === level);
  return match ? Math.floor(match.cost / 4) : 20 * level;
}
