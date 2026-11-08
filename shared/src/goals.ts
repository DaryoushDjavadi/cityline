import { isBridge, isRoad } from "./city.ts";
import { BRIDGE_FLAG } from "./grid.ts";
import { POWER_BIT, ServiceKind, WATER_BIT, Zone, type CityState } from "./types.ts";

export interface CityGoal {
  bit: number;
  title: string;
  text: string;
  reward: number;
}

export const GOALS: CityGoal[] = [
  { bit: 1, title: "Erste Straße", text: "Leg mindestens sechs Straßenfelder.", reward: 2_000 },
  { bit: 2, title: "Erstes Dach", text: "Bau ein Wohnhaus.", reward: 2_500 },
  { bit: 4, title: "Licht und Wasser", text: "Ein Wohnhaus braucht Strom und Wasser.", reward: 6_000 },
  { bit: 8, title: "Erste Stelle", text: "Stell im Betrieb eine Person ein.", reward: 4_000 },
  { bit: 16, title: "Dorf", text: "Bring die Stadt auf 48 Einwohner.", reward: 8_000 },
  { bit: 32, title: "Markt und Werk", text: "Bau ein Gewerbe und eine Industrie.", reward: 5_000 },
  { bit: 64, title: "Grünfläche", text: "Bau einen Park.", reward: 3_000 },
  { bit: 128, title: "Schule", text: "Bau eine Schule. Gebildete zahlen mehr Steuern.", reward: 7_000 },
  { bit: 256, title: "Brücke", text: "Bau eine Brücke über Wasser.", reward: 8_000 },
  { bit: 512, title: "Richtige Stadt", text: "120 Einwohner und acht besetzte Jobs.", reward: 20_000 },
];

export interface GoalProgress {
  /** 0..1 */
  ratio: number;
  label: string;
}

interface GoalCounts {
  roads: number;
  homes: number;
  lit: boolean;
  jobs: number;
  population: number;
  commercial: boolean;
  industrial: boolean;
  park: boolean;
  school: boolean;
  bridge: boolean;
}

function countGoals(city: CityState): GoalCounts {
  let roads = 0;
  let homes = 0;
  let lit = false;
  let jobs = 0;
  let population = 0;
  let commercial = false;
  let industrial = false;
  let park = false;
  let school = false;
  let bridge = false;
  for (let index = 0; index < city.zones.length; index += 1) {
    if (isRoad(city, index) && !isBridge(city, index)) roads += 1;
    if ((city.roads[index] & BRIDGE_FLAG) !== 0) bridge = true;
    if (city.services[index] === ServiceKind.Park) park = true;
    if (city.services[index] === ServiceKind.School) school = true;
    const level = city.levels[index];
    if (level <= 0) continue;
    if (city.zones[index] === Zone.Residential) {
      homes += 1;
      population += level * 12;
      if ((city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT)) lit = true;
    } else if (city.zones[index] === Zone.Commercial) commercial = true;
    else if (city.zones[index] === Zone.Industrial) industrial = true;
  }
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace < 0) continue;
    const zone = city.zones[workplace];
    if (city.levels[workplace] > 0 && (zone === Zone.Commercial || zone === Zone.Industrial || zone === Zone.Farm)) jobs += 1;
  }
  return { roads, homes, lit, jobs, population, commercial, industrial, park, school, bridge };
}

export function goalMask(city: CityState): number {
  const { roads, homes, lit, jobs, population, commercial, industrial, park, school, bridge } = countGoals(city);
  let mask = 0;
  if (roads >= 6) mask |= 1;
  if (homes >= 1) mask |= 2;
  if (lit) mask |= 4;
  if (jobs >= 1) mask |= 8;
  if (population >= 48) mask |= 16;
  if (commercial && industrial) mask |= 32;
  if (park) mask |= 64;
  if (school) mask |= 128;
  if (bridge) mask |= 256;
  if (population >= 120 && jobs >= 8) mask |= 512;
  return mask;
}

/** Live progress toward one city contract, for the quest tracker. */
export function goalProgress(city: CityState, bit: number): GoalProgress {
  const c = countGoals(city);
  const count = (current: number, target: number): GoalProgress => ({
    ratio: Math.max(0, Math.min(1, current / target)),
    label: `${Math.min(current, target)}/${target}`,
  });
  const flag = (done: boolean): GoalProgress => ({ ratio: done ? 1 : 0, label: done ? "fertig" : "0/1" });
  switch (bit) {
    case 1: return count(c.roads, 6);
    case 2: return count(c.homes, 1);
    case 4: return flag(c.lit);
    case 8: return count(c.jobs, 1);
    case 16: return count(c.population, 48);
    case 32: return count(Number(c.commercial) + Number(c.industrial), 2);
    case 64: return flag(c.park);
    case 128: return flag(c.school);
    case 256: return flag(c.bridge);
    case 512: {
      const pop = Math.min(1, c.population / 120);
      const jobs = Math.min(1, c.jobs / 8);
      return {
        ratio: (pop + jobs) / 2,
        label: `${Math.min(c.population, 120)}/120 EW · ${Math.min(c.jobs, 8)}/8 Jobs`,
      };
    }
    default: return { ratio: 0, label: "" };
  }
}

export function claimGoals(city: CityState): number {
  const fresh = goalMask(city) & ~city.goals;
  if (fresh === 0) return 0;
  let pay = 0;
  for (const goal of GOALS) if ((fresh & goal.bit) !== 0) pay += goal.reward;
  city.goals |= fresh;
  city.funds = Math.max(0, Math.min(5_000_000, city.funds + pay));
  return pay;
}

export function currentGoal(mask: number): CityGoal | null {
  return GOALS.find((goal) => (mask & goal.bit) === 0) ?? null;
}

export function cityTitle(population: number): { name: string; next: string | null; left: number } {
  const ranks = [
    { at: 0, name: "Außenposten" },
    { at: 12, name: "Siedlung" },
    { at: 36, name: "Dorf" },
    { at: 72, name: "Kleinstadt" },
    { at: 140, name: "Stadt" },
    { at: 280, name: "Großstadt" },
  ];
  let name = ranks[0].name;
  let next: { at: number; name: string } | null = ranks[1];
  for (let index = 0; index < ranks.length; index += 1) {
    if (population < ranks[index].at) break;
    name = ranks[index].name;
    next = ranks[index + 1] ?? null;
  }
  return { name, next: next?.name ?? null, left: next ? next.at - population : 0 };
}

export function demandRebate(demand: number, cost: number): number {
  if (demand < 25 || cost <= 0) return 0;
  return Math.round((cost * Math.min(demand, 100)) / 100 * 0.4);
}
