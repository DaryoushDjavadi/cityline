import { BUILDINGS, type BuildingId } from "./catalog.ts";
import { createCity } from "./city.ts";
import { BRIDGE_FLAG, ROAD_FLAG } from "./grid.ts";
import { cityLedger } from "./sim.ts";
import { POWER_BIT, ServiceKind, WATER_BIT, Zone, type CityState } from "./types.ts";

export const LEVEL_COUNT = 10;
export const SIM_TICK_SECONDS = 0.5;

export type LevelObjectiveKind =
  | "roads"
  | "homes"
  | "servedHomes"
  | "jobs"
  | "population"
  | "funds"
  | "commercial"
  | "industrial"
  | "building"
  | "service"
  | "bridge"
  | "netIncome";

export interface LevelObjective {
  kind: LevelObjectiveKind;
  target: number;
  extra?: BuildingId | number;
  text: string;
}

export interface LevelDef {
  id: number;
  title: string;
  blurb: string;
  funds: number;
  timeLimitSeconds: number | null;
  objectives: LevelObjective[];
}

export interface ObjectiveProgress {
  text: string;
  current: number;
  target: number;
  done: boolean;
}

export interface LevelStatus {
  level: LevelDef;
  objectives: ObjectiveProgress[];
  remainingSeconds: number | null;
  won: boolean;
  failed: boolean;
}

export interface CityTally {
  roads: number;
  homes: number;
  servedHomes: number;
  jobs: number;
  population: number;
  funds: number;
  commercial: number;
  industrial: number;
  bridges: number;
  netIncome: number;
  buildings: Record<BuildingId, number>;
  services: Record<number, number>;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    title: "Erste Siedlung",
    blurb: "Ein paar Straßen, zwei Häuser, ein Laden. Dann zwei Leute anstellen.",
    funds: 100_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "roads", target: 6, text: "6 Straßenfelder" },
      { kind: "homes", target: 2, text: "2 Wohnhäuser" },
      { kind: "building", extra: "shop", target: 1, text: "1 Laden" },
      { kind: "jobs", target: 2, text: "2 Arbeiter anstellen" },
    ],
  },
  {
    id: 2,
    title: "Strom und Wasser",
    blurb: "Die Häuser gelten erst als versorgt, wenn Strom und Wasser ankommen.",
    funds: 90_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "roads", target: 8, text: "8 Straßenfelder" },
      { kind: "service", extra: ServiceKind.Power, target: 1, text: "1 Kraftwerk" },
      { kind: "service", extra: ServiceKind.Water, target: 1, text: "1 Wasserwerk" },
      { kind: "servedHomes", target: 3, text: "3 versorgte Wohnhäuser" },
    ],
  },
  {
    id: 3,
    title: "Arbeit finden",
    blurb: "Wohnen, ein Gewerbe und eine Industrie. Dann vier Stellen besetzen.",
    funds: 80_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "homes", target: 4, text: "4 Wohnhäuser" },
      { kind: "commercial", target: 1, text: "1 Gewerbe" },
      { kind: "industrial", target: 1, text: "1 Industrie" },
      { kind: "jobs", target: 4, text: "4 Arbeiter anstellen" },
    ],
  },
  {
    id: 4,
    title: "Grünes Dorf",
    blurb: "Ein kleines Dorf mit Park und genug Arbeit.",
    funds: 75_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "population", target: 48, text: "48 Einwohner" },
      { kind: "jobs", target: 6, text: "6 Arbeiter" },
      { kind: "service", extra: ServiceKind.Park, target: 1, text: "1 Park" },
    ],
  },
  {
    id: 5,
    title: "Schulpflicht",
    blurb: "Eine Schule ins Viertel, Häuser mit Strom und Wasser, ein paar Jobs.",
    funds: 70_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "service", extra: ServiceKind.School, target: 1, text: "1 Schule" },
      { kind: "servedHomes", target: 4, text: "4 versorgte Wohnhäuser" },
      { kind: "population", target: 60, text: "60 Einwohner" },
      { kind: "jobs", target: 6, text: "6 Arbeiter" },
    ],
  },
  {
    id: 6,
    title: "Etage um Etage",
    blurb: "Mehrfamilienhäuser und ein Bürohaus, damit die Stadt wächst.",
    funds: 65_000,
    timeLimitSeconds: null,
    objectives: [
      { kind: "building", extra: "apartments", target: 2, text: "2 Mehrfamilienhäuser" },
      { kind: "building", extra: "office", target: 1, text: "1 Bürohaus" },
      { kind: "population", target: 80, text: "80 Einwohner" },
      { kind: "jobs", target: 8, text: "8 Arbeiter" },
    ],
  },
  {
    id: 7,
    title: "Über den Fluss",
    blurb: "Eine Brücke, eine Klinik, und die Uhr läuft.",
    funds: 60_000,
    timeLimitSeconds: 10 * 60,
    objectives: [
      { kind: "bridge", target: 1, text: "1 Brücke" },
      { kind: "service", extra: ServiceKind.Clinic, target: 1, text: "1 Klinik" },
      { kind: "population", target: 80, text: "80 Einwohner" },
      { kind: "jobs", target: 8, text: "8 Arbeiter" },
    ],
  },
  {
    id: 8,
    title: "Kleinstadt",
    blurb: "Mehr Leute, Schule, Park, und Geld soll übrig bleiben.",
    funds: 55_000,
    timeLimitSeconds: 12 * 60,
    objectives: [
      { kind: "population", target: 120, text: "120 Einwohner" },
      { kind: "jobs", target: 12, text: "12 Arbeiter" },
      { kind: "service", extra: ServiceKind.School, target: 1, text: "1 Schule" },
      { kind: "service", extra: ServiceKind.Park, target: 1, text: "1 Park" },
      { kind: "funds", target: 20_000, text: "20.000 € in der Kasse" },
    ],
  },
  {
    id: 9,
    title: "Campus",
    blurb: "Universität, Schule und ein Hochhaus für eine richtige Stadt.",
    funds: 80_000,
    timeLimitSeconds: 14 * 60,
    objectives: [
      { kind: "service", extra: ServiceKind.University, target: 1, text: "1 Universität" },
      { kind: "service", extra: ServiceKind.School, target: 1, text: "1 Schule" },
      { kind: "building", extra: "tower", target: 1, text: "1 Hochhaus" },
      { kind: "population", target: 140, text: "140 Einwohner" },
      { kind: "jobs", target: 12, text: "12 Arbeiter" },
    ],
  },
  {
    id: 10,
    title: "Großstadt",
    blurb: "Einwohner, Jobs, öffentliche Bauten, eine Fabrik, und die Kasse im Plus.",
    funds: 90_000,
    timeLimitSeconds: 16 * 60,
    objectives: [
      { kind: "population", target: 180, text: "180 Einwohner" },
      { kind: "jobs", target: 16, text: "16 Arbeiter" },
      { kind: "service", extra: ServiceKind.University, target: 1, text: "1 Universität" },
      { kind: "service", extra: ServiceKind.School, target: 1, text: "1 Schule" },
      { kind: "service", extra: ServiceKind.Park, target: 1, text: "1 Park" },
      { kind: "building", extra: "factory", target: 1, text: "1 Fabrik" },
      { kind: "netIncome", target: 1, text: "Kasse im Plus (Einkommen > Unterhalt)" },
    ],
  },
];

const EMPTY_BUILDINGS: Record<BuildingId, number> = {
  cottage: 0,
  apartments: 0,
  tower: 0,
  shop: 0,
  office: 0,
  mall: 0,
  workshop: 0,
  factory: 0,
  plant: 0,
};

export function levelById(id: number): LevelDef | null {
  return LEVELS.find((level) => level.id === id) ?? null;
}

export function tallyCity(city: CityState): CityTally {
  const buildings = { ...EMPTY_BUILDINGS };
  const services: Record<number, number> = {};
  let roads = 0;
  let homes = 0;
  let servedHomes = 0;
  let jobs = 0;
  let population = 0;
  let commercial = 0;
  let industrial = 0;
  let bridges = 0;
  for (let index = 0; index < city.zones.length; index += 1) {
    if ((city.roads[index] & ROAD_FLAG) !== 0) roads += 1;
    if ((city.roads[index] & BRIDGE_FLAG) !== 0) bridges += 1;
    const service = city.services[index];
    if (service !== ServiceKind.None) services[service] = (services[service] ?? 0) + 1;
    const level = city.levels[index];
    if (level <= 0) continue;
    const zone = city.zones[index];
    if (zone === Zone.Residential) {
      homes += 1;
      population += level * 12;
      if ((city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT)) servedHomes += 1;
    } else if (zone === Zone.Commercial) commercial += 1;
    else if (zone === Zone.Industrial) industrial += 1;
    const match = Object.values(BUILDINGS).find((entry) => entry.zone === zone && entry.level === level);
    if (match) buildings[match.id] += 1;
  }
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace < 0) continue;
    const zone = city.zones[workplace];
    if (city.levels[workplace] > 0 && (zone === Zone.Commercial || zone === Zone.Industrial)) jobs += 1;
  }
  const ledger = cityLedger(city);
  return {
    roads,
    homes,
    servedHomes,
    jobs,
    population,
    funds: city.funds,
    commercial,
    industrial,
    bridges,
    netIncome: ledger.income - ledger.upkeep,
    buildings,
    services,
  };
}

export function objectiveCurrent(objective: LevelObjective, tally: CityTally): number {
  switch (objective.kind) {
    case "roads":
      return tally.roads;
    case "homes":
      return tally.homes;
    case "servedHomes":
      return tally.servedHomes;
    case "jobs":
      return tally.jobs;
    case "population":
      return tally.population;
    case "funds":
      return tally.funds;
    case "commercial":
      return tally.commercial;
    case "industrial":
      return tally.industrial;
    case "bridge":
      return tally.bridges;
    case "netIncome":
      return tally.netIncome;
    case "building":
      return typeof objective.extra === "string" ? tally.buildings[objective.extra] ?? 0 : 0;
    case "service":
      return typeof objective.extra === "number" ? tally.services[objective.extra] ?? 0 : 0;
  }
}

export function evaluateLevel(level: LevelDef, city: CityState, startedTick = 0): LevelStatus {
  const tally = tallyCity(city);
  const objectives = level.objectives.map((objective) => {
    const current = objectiveCurrent(objective, tally);
    return {
      text: objective.text,
      current,
      target: objective.target,
      done: current >= objective.target,
    };
  });
  const remainingSeconds = remainingLevelSeconds(level, city.tick, startedTick);
  const won = objectives.every((entry) => entry.done);
  const timedOut = remainingSeconds !== null && remainingSeconds <= 0;
  return {
    level,
    objectives,
    remainingSeconds,
    won,
    failed: timedOut && !won,
  };
}

export function remainingLevelSeconds(level: LevelDef, tick: number, startedTick = 0): number | null {
  if (level.timeLimitSeconds === null) return null;
  const elapsed = Math.max(0, (tick - startedTick) * SIM_TICK_SECONDS);
  return Math.max(0, Math.ceil(level.timeLimitSeconds - elapsed));
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Suppress freeplay contract payouts while a level is running. */
export const LEVEL_GOALS_MASK = 0x7fffffff;

const LEVEL_ROOM = /^l([1-9]|10)-([a-z0-9-]{2,20})$/;

export function createLevelCity(level: LevelDef): CityState {
  const city = createCity();
  city.funds = level.funds;
  city.goals = LEVEL_GOALS_MASK;
  return city;
}

/** Coop rooms are `l{level}-{tag}`, e.g. `l1-hauptstadt`. */
export function levelRoomCode(levelId: number, tag: string): string | null {
  if (levelId < 1 || levelId > LEVEL_COUNT) return null;
  const clean = tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^l\d{1,2}-/, "").slice(0, 18);
  if (clean.length < 2) return null;
  return `l${levelId}-${clean}`.slice(0, 24);
}

export function parseLevelRoom(code: string): { level: number; tag: string } | null {
  const match = LEVEL_ROOM.exec(code);
  if (!match) return null;
  const level = Number(match[1]);
  if (level < 1 || level > LEVEL_COUNT) return null;
  return { level, tag: match[2] };
}

export function isLevelRoom(code: string): boolean {
  return parseLevelRoom(code) !== null;
}
