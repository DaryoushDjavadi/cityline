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
    blurb: "Liefert Strom in Leitungen, die das Kraftwerk berühren, und in direkt angrenzende Gebäude.",
  },
  [ServiceKind.Water]: {
    kind: ServiceKind.Water,
    name: "Wasserwerk",
    cost: COST.water,
    upkeep: 16,
    radius: 0,
    blurb: "Speist Wasser in angeschlossene Rohre und in direkt angrenzende Gebäude.",
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
  [ServiceKind.Airport]: {
    kind: ServiceKind.Airport,
    name: "Flughafen",
    cost: COST.airport,
    upkeep: 48,
    radius: 0,
    blurb: "Kleiner Privatflugplatz. 48.000 € Bau, danach etwa 260 € alle 2 s. An der Lupe Import und Export.",
  },
};

export function serviceInfo(kind: number): ServiceInfo | null {
  return SERVICES[kind] ?? null;
}

export function readBudget(value: number): number {
  return value >= 50 && value <= 150 ? value : 100;
}

export type BuildingId = "cottage" | "apartments" | "tower" | "shop" | "office" | "mall" | "workshop" | "factory" | "plant" | "farm";

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
  farm: { id: "farm", name: "Bauernhof", zone: Zone.Farm, level: 1, cost: 2400 },
};

export type TradeDealId = "grain" | "food_in" | "food_out" | "wares" | "parts";

export interface TradeDeal {
  id: TradeDealId;
  name: string;
  side: "import" | "export";
  blurb: string;
  price: number;
  food?: number;
  requires?: "food" | "commercial" | "industrial";
}

export const TRADE: TradeDeal[] = [
  { id: "grain", name: "Getreide", side: "import", blurb: "Günstig im Einkauf. +2 Nahrung ins Lager.", price: 28, food: 2 },
  { id: "food_in", name: "Nahrung", side: "import", blurb: "+4 Nahrung. Teurer als Getreide.", price: 90, food: 4 },
  { id: "food_out", name: "Nahrung", side: "export", blurb: "4 Nahrung aus dem Lager verkaufen.", price: 55, food: -4, requires: "food" },
  { id: "wares", name: "Waren", side: "export", blurb: "Stadtprodukte. Braucht Gewerbe. Verkauf bringt mehr als der Einkauf.", price: 62, requires: "commercial" },
  { id: "parts", name: "Maschinen", side: "export", blurb: "Braucht Industrie. Verkauf unter dem Listenpreis.", price: 78, requires: "industrial" },
];

export function tradeDeal(id: string): TradeDeal | null {
  return TRADE.find((entry) => entry.id === id) ?? null;
}

export function buildingInfo(kind: string): BuildingInfo | null {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, kind) ? BUILDINGS[kind as BuildingId] : null;
}

export function refundForLevel(zone: number, level: number): number {
  const match = Object.values(BUILDINGS).find((entry) => entry.zone === zone && entry.level === level);
  return match ? Math.floor(match.cost / 4) : 20 * level;
}

export const FOOD_PER_WORKER = 4;
export const FOOD_STOCK_MAX = 120;
export const AIRPORT_INCOME = 260;
/** Four cottages (12 residents each) eat nothing. */
export const FOOD_FREE_POPULATION = 48;
/** About three extra cottages per additional food unit after the free tier. */
export const FOOD_POP_PER_NEED = 36;

/**
 * Early cities eat almost nothing so a new town is not hungry.
 * One modest staffed farm (a single worker, even without full utilities)
 * covers the first stretch of growth; demand then ramps with population.
 */
export function foodNeed(population: number): number {
  if (population <= FOOD_FREE_POPULATION) return 0;
  return Math.ceil((population - FOOD_FREE_POPULATION) / FOOD_POP_PER_NEED);
}
