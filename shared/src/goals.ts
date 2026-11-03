import { BRIDGE_FLAG, ROAD_FLAG } from "./grid.ts";
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

export function goalMask(city: CityState): number {
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
    if ((city.roads[index] & ROAD_FLAG) !== 0) roads += 1;
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
    if (city.levels[workplace] > 0 && (zone === Zone.Commercial || zone === Zone.Industrial)) jobs += 1;
  }
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
