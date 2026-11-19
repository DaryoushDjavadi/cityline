import { moodBonus } from "./progress.ts";
import { climateAt, isOnDuty, lifeActivity } from "./climate.ts";
import { serviceInfo } from "./catalog.ts";
import { ROAD_FLAG, cellCoords, cellIndex, inBounds } from "./grid.ts";
import { isBeach, waterDir } from "./terrain.ts";
import { hubJobs, isHub, logisticsPartner } from "./trade.ts";
import { POST_SLOTS, POWER_BIT, ServiceKind, WATER_BIT, Zone, type CityState } from "./types.ts";

export const BEACH_HAPPINESS_RADIUS = 5;
export const HAPPY_SMILE = 0.78;

const FIRST = ["Mara", "Jonas", "Lea", "Emil", "Nora", "Theo", "Mila", "Anton", "Frieda", "Luis", "Ida", "Mats"];
const CHILD = ["Mia", "Leo", "Emma", "Finn", "Lina", "Paul", "Greta", "Nils"];
const LAST = ["Berger", "Kranz", "Holm", "Adler", "Voss", "Seidel", "Hartmann", "Baum", "Lindner", "Oswald"];
const CAR_NAMES = ["Kombi", "Kleinwagen", "Limousine", "Transporter"] as const;
const CAR_KINDS = ["wagon", "hatch", "sedan", "van"] as const;
export type StreetCarKind = (typeof CAR_KINDS)[number];
const CAR_COLORS: { name: string; value: number }[] = [
  { name: "weißer", value: 0xf4f1ea },
  { name: "roter", value: 0xc44732 },
  { name: "blauer", value: 0x2f5f86 },
  { name: "gelber", value: 0xe2b33a },
  { name: "grüner", value: 0x2c6b49 },
];
const JOBS = [
  ["Lagerhilfe", "Bandarbeit", "Hofarbeit"],
  ["Verkauf", "Sachbearbeitung", "Werkstatt"],
  ["Planung", "Leitung", "Forschung"],
];

export interface Resident {
  name: string;
  child: boolean;
  education: number;
  educationLabel: string;
  job: string;
  slot: number;
  unemployed: boolean;
}

export interface Adult {
  home: number;
  slot: number;
  name: string;
  education: number;
  educationLabel: string;
  workplace: number | null;
}

export interface Household {
  surname: string;
  home: number;
  members: Resident[];
  cars: { label: string; driver: string; kind: StreetCarKind }[];
}

export interface StreetCar {
  id: string;
  home: number;
  surname: string;
  driver: string;
  members: string;
  label: string;
  color: number;
  kind: StreetCarKind;
}

export interface StreetPedestrian {
  id: string;
  home: number;
  name: string;
  child: boolean;
  color: number;
  happy: boolean;
}

export type BeachPose = "idle" | "sit" | "lie" | "swim";

export interface BeachVisitor {
  id: string;
  home: number;
  name: string;
  child: boolean;
  color: number;
  cell: number;
  ox: number;
  oz: number;
  pose: BeachPose;
  happy: boolean;
}

export function houseReport(city: CityState, home: number): Household[] {
  if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) return [];
  return families(city, home);
}

export function streetCars(city: CityState, limit = 72): StreetCar[] {
  const climate = climateAt(city.tick);
  const activity = lifeActivity(climate);
  const rainy = climate.weather === "rain";
  const cap = Math.max(8, Math.round(limit * (0.22 + activity * 0.95) * (rainy ? 0.85 : 1)));
  const cars: StreetCar[] = [];
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] !== Zone.Residential || city.levels[index] <= 0) continue;
    for (const family of families(city, index)) {
      const adults = family.members.filter((member) => !member.child && member.slot >= 0);
      family.cars.forEach((car, carIndex) => {
        const shift = Math.floor(city.tick / (climate.rushHour ? 18 : 30));
        if (carIndex !== shift % family.cars.length) return;
        const adult = adults[carIndex % Math.max(adults.length, 1)];
        if (adult) {
          const workplace = assignedWorkplace(city, index, adult.slot);
          if (isOnDuty(index, adult.slot, workplace, climate)) return;
        }
        // Quiet nights: only some cars leave the driveway.
        if (activity < 0.25 && (hash(index * 19 + carIndex + Math.floor(city.tick / 12)) % 3) !== 0) return;
        cars.push({
          id: `${index}-${family.surname}-${carIndex}`,
          home: index,
          surname: family.surname,
          driver: car.driver,
          members: family.members.map((member) => member.name).join(", "),
          label: car.label,
          color: CAR_COLORS[hash(index * 13 + carIndex) % CAR_COLORS.length].value,
          kind: car.kind,
        });
      });
    }
  }
  if (cars.length <= cap) return cars;
  const start = Math.floor(city.tick / 40) % cars.length;
  return Array.from({ length: cap }, (_, offset) => cars[(start + offset) % cars.length]);
}

const PED_COLORS = [0xd45a3c, 0x2f7d9a, 0x3d8a4a, 0xa85a8a, 0xe2a03a, 0x3d4a8a, 0xf2efe8];

/** People on the sidewalk — not those currently at work (commuters may walk). */
export function streetPedestrians(city: CityState, limit = 56): StreetPedestrian[] {
  const climate = climateAt(city.tick);
  const night = climate.isNight;
  const activity = lifeActivity(climate);
  const rainy = climate.weather === "rain";
  const cap = Math.max(4, Math.round(limit * (0.18 + activity * 0.95) * (rainy ? 0.55 : 1)));
  const walkers: StreetPedestrian[] = [];
  const rotate = Math.floor(city.tick / (climate.rushHour ? 12 : 18));
  for (let home = 0; home < city.levels.length; home += 1) {
    if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) continue;
    for (const family of families(city, home)) {
      for (const member of family.members) {
        if (member.child) {
          if (night || activity < 0.3) continue;
          if ((hash(home * 53 + member.name.length + rotate) % 4) !== 0) continue;
        } else {
          if (member.slot < 0) continue;
          const workplace = assignedWorkplace(city, home, member.slot);
          if (isOnDuty(home, member.slot, workplace, climate)) continue;
          const chance = activity > 0.7 ? 2 : night ? 4 : 3;
          if ((hash(home * 61 + member.slot * 9 + rotate) % chance) !== 0) continue;
        }
        walkers.push({
          id: `ped-${home}-${member.name}`,
          home,
          name: member.name,
          child: member.child,
          color: PED_COLORS[hash(home * 11 + member.slot + 3) % PED_COLORS.length],
          happy: houseHappiness(city, home).score >= HAPPY_SMILE,
        });
      }
    }
  }
  if (walkers.length <= cap) return walkers;
  const start = Math.floor(city.tick / 25) % walkers.length;
  return Array.from({ length: cap }, (_, offset) => walkers[(start + offset) % walkers.length]);
}

export function scholarshipCost(level: number): number {
  return 1800 + level * 500;
}

function families(city: CityState, home: number): Household[] {
  const level = city.levels[home];
  const education = city.skills[home] & 3;
  let remaining = 2 + level * 2;
  const result: Household[] = [];
  let familyIndex = 0;
  while (remaining > 0 && familyIndex < 4) {
    const size = Math.min(remaining, 2 + (hash(home * 19 + familyIndex) % 3));
    const surname = LAST[hash(home + familyIndex * 17) % LAST.length];
    const members: Resident[] = [];
    for (let person = 0; person < size; person += 1) {
      const child = person >= 2;
      const name = `${(child ? CHILD : FIRST)[hash(home * 31 + familyIndex * 7 + person) % (child ? CHILD.length : FIRST.length)]} ${surname}`;
      const personEducation = child ? Math.min(1, education) : education;
      const slot = child ? -1 : adultSlot(city, home, familyIndex, person);
      const workplace = slot >= 0 ? assignedWorkplace(city, home, slot) : null;
      members.push({
        name,
        child,
        education: personEducation,
        educationLabel: child ? (personEducation > 0 ? "in der Schule" : "ohne Schulplatz") : educationLabel(personEducation),
        job: child ? "kein Beruf" : workplace === null ? "arbeitslos" : jobTitle(city, workplace, personEducation, person),
        slot,
        unemployed: !child && workplace === null,
      });
    }
    const adults = members.filter((member) => !member.child);
    const carCount = adults.length === 0 ? 0 : hash(home * 29 + familyIndex) % 4;
    const cars = Array.from({ length: carCount }, (_, carIndex) => {
      const color = CAR_COLORS[hash(home * 13 + familyIndex + carIndex) % CAR_COLORS.length];
      const modelIndex = hash(home + carIndex * 11) % CAR_NAMES.length;
      const model = CAR_NAMES[modelIndex];
      const kind = CAR_KINDS[modelIndex];
      const driver = adults[hash(home + city.tick + carIndex) % adults.length]?.name ?? adults[0].name;
      return { label: `${color.name} ${model}`, driver, kind };
    });
    result.push({ surname, home, members, cars });
    remaining -= size;
    familyIndex += 1;
  }
  return result;
}

export function jobCapacity(zone: number, level: number): number {
  if (level <= 0) return 0;
  if (zone === Zone.Commercial) return level * 3;
  if (zone === Zone.Industrial) return level * 4;
  if (zone === Zone.Farm) return 4;
  return 0;
}

export function assignedWorkplace(city: CityState, home: number, slot: number): number | null {
  if (slot < 0 || slot >= POST_SLOTS) return null;
  const value = city.posts[home * POST_SLOTS + slot] ?? 0;
  if (value <= 0) return null;
  const workplace = value - 1;
  if (!isWorkplace(city, workplace)) return null;
  return workplace;
}

export function listAdults(city: CityState, home: number): Adult[] {
  return houseReport(city, home).flatMap((family) =>
    family.members.filter((member) => !member.child && member.slot >= 0).map((member) => ({
      home,
      slot: member.slot,
      name: member.name,
      education: member.education,
      educationLabel: member.educationLabel,
      workplace: assignedWorkplace(city, home, member.slot),
    })),
  );
}

export function unemployedAdults(city: CityState): Adult[] {
  const adults: Adult[] = [];
  for (let home = 0; home < city.levels.length; home += 1) {
    if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) continue;
    for (const adult of listAdults(city, home)) {
      if (adult.workplace === null) adults.push(adult);
    }
  }
  return adults;
}

export function employeesAt(city: CityState, workplace: number): Adult[] {
  const staff: Adult[] = [];
  for (let home = 0; home < city.levels.length; home += 1) {
    if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) continue;
    for (const adult of listAdults(city, home)) {
      if (adult.workplace === workplace) staff.push(adult);
    }
  }
  return staff;
}

export function houseHappiness(city: CityState, home: number): { score: number; beach: boolean; tax: number; label: string } {
  if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) {
    return { score: 0, beach: false, tax: 0, label: "—" };
  }
  const beach = nearBeach(city, home);
  const bits = city.utility[home] & (POWER_BIT | WATER_BIT);
  const utility = bits === (POWER_BIT | WATER_BIT) ? 0.18 : bits === 0 ? 0 : 0.08;
  const park = serviceNearby(city, home, ServiceKind.Park) ? 0.12 : 0;
  const clinic = serviceNearby(city, home, ServiceKind.Clinic) ? 0.1 : 0;
  const meals = city.food > 0 ? 0.12 : 0.04;
  const score = Math.max(0, Math.min(1, 0.28 + utility + park + clinic + meals + (beach ? 0.38 : 0) + moodBonus(city, home)));
  const label = beach ? "Strandglück" : score >= HAPPY_SMILE ? "sehr glücklich" : score >= 0.55 ? "zufrieden" : "unzufrieden";
  return { score, beach, tax: beach ? 0.42 : 0, label };
}

export function nearBeach(city: CityState, index: number): boolean {
  const here = cellCoords(city, index);
  for (let dy = -BEACH_HAPPINESS_RADIUS; dy <= BEACH_HAPPINESS_RADIUS; dy += 1) {
    for (let dx = -BEACH_HAPPINESS_RADIUS; dx <= BEACH_HAPPINESS_RADIUS; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > BEACH_HAPPINESS_RADIUS) continue;
      const nx = here.x + dx;
      const ny = here.y + dy;
      if (!inBounds(city, nx, ny)) continue;
      if (isBeach(city, cellIndex(city, nx, ny))) return true;
    }
  }
  return false;
}

function beachCells(city: CityState): number[] {
  const cells: number[] = [];
  for (let index = 0; index < city.terrain.length; index += 1) {
    if (isBeach(city, index)) cells.push(index);
  }
  return cells;
}

function isOpenSand(city: CityState, index: number): boolean {
  if (!isBeach(city, index) || city.levels[index] > 0) return false;
  if ((city.roads[index] & ROAD_FLAG) !== 0) return false;
  const service = city.services[index];
  return service === ServiceKind.None || service === ServiceKind.Lamp;
}

function nearestBeach(city: CityState, home: number, cells: number[]): number | null {
  if (cells.length === 0) return null;
  const origin = cellCoords(city, home);
  let best: number | null = null;
  let bestDist = 999;
  let paved: number | null = null;
  let pavedDist = 999;
  for (const cell of cells) {
    const spot = cellCoords(city, cell);
    const dist = Math.max(Math.abs(spot.x - origin.x), Math.abs(spot.y - origin.y));
    if (dist > BEACH_HAPPINESS_RADIUS) continue;
    if (isOpenSand(city, cell)) {
      if (dist < bestDist) {
        best = cell;
        bestDist = dist;
      }
    } else if (dist < pavedDist) {
      paved = cell;
      pavedDist = dist;
    }
  }
  return best ?? paved;
}

/** Leisure-time residents on nearby sand (day and evening). */
export function beachVisitors(city: CityState, limit = 36): BeachVisitor[] {
  const climate = climateAt(city.tick);
  const hour = climate.hour;
  const leisure = hour >= 10 && hour < 20.2 && climate.weather !== "rain";
  if (!leisure) return [];
  const sand = beachCells(city);
  if (sand.length === 0) return [];
  const visitors: BeachVisitor[] = [];
  const rotate = Math.floor(city.tick / 14);
  for (let home = 0; home < city.levels.length; home += 1) {
    if (city.zones[home] !== Zone.Residential || city.levels[home] <= 0) continue;
    const cell = nearestBeach(city, home, sand);
    if (cell === null) continue;
    for (const family of families(city, home)) {
      for (const member of family.members) {
        if (member.child) {
          if ((hash(home * 71 + member.name.length + rotate) % 3) !== 0) continue;
        } else {
          if (member.slot < 0) continue;
          const workplace = assignedWorkplace(city, home, member.slot);
          if (isOnDuty(home, member.slot, workplace, climate)) continue;
          if ((hash(home * 83 + member.slot * 5 + rotate) % 2) !== 0) continue;
        }
        const poseRoll = hash(home * 17 + member.name.length + 9) % 10;
        const pose: BeachPose = poseRoll <= 2 ? "lie" : poseRoll <= 4 ? "sit" : poseRoll <= 6 ? "idle" : "swim";
        const spot = cellCoords(city, cell);
        const dir = waterDir(city, spot.x, spot.y);
        const intoWater = pose === "swim"
          ? 10.4 + (hash(home * 13 + member.name.length) % 8) * 0.5
          : 3.2 + (hash(home * 19 + member.name.length) % 10) * 0.18;
        const along = intoWater;
        const side = ((hash(home * 29 + member.slot + 4) % 11) - 5) * 0.85;
        visitors.push({
          id: `beach-${home}-${member.name}`,
          home,
          name: member.name,
          child: member.child,
          color: PED_COLORS[hash(home * 11 + member.slot + 9) % PED_COLORS.length],
          cell,
          ox: dir.dx * along + dir.dy * side,
          oz: dir.dy * along - dir.dx * side,
          pose,
          happy: true,
        });
      }
    }
  }
  if (visitors.length <= limit) return visitors;
  const swimmers = visitors.filter((visitor) => visitor.pose === "swim");
  const rest = visitors.filter((visitor) => visitor.pose !== "swim");
  const swimKeep = Math.min(4, swimmers.length);
  const start = Math.floor(city.tick / 18) % Math.max(1, rest.length);
  const picked = swimmers.slice(0, swimKeep);
  for (let offset = 0; picked.length < limit && rest.length > 0; offset += 1) {
    picked.push(rest[(start + offset) % rest.length]!);
  }
  return picked;
}

export interface TradeTourist {
  id: string;
  from: number;
  to: number;
  color: number;
  child: boolean;
  happy: boolean;
  phase: number;
}

/** Visible visitors walking from ferry/airport toward a beach when the logistics link is active. */
export function tradeTourists(city: CityState, limit = 10): TradeTourist[] {
  if (limit <= 0) return [];
  const sand = beachCells(city).filter((cell) => isOpenSand(city, cell));
  if (sand.length === 0) return [];
  const hubs: number[] = [];
  for (let index = 0; index < city.services.length; index += 1) {
    if (!isHub(city, index)) continue;
    if (logisticsPartner(city, index) === null) continue;
    hubs.push(index);
  }
  if (hubs.length === 0) return [];
  const out: TradeTourist[] = [];
  const n = Math.min(limit, hubs.length * 4);
  for (let i = 0; i < n; i += 1) {
    const hub = hubs[i % hubs.length]!;
    const beach = nearestBeach(city, hub, sand) ?? sand[i % sand.length]!;
    out.push({
      id: `tour-${hub}-${i}`,
      from: hub,
      to: beach,
      color: PED_COLORS[i % PED_COLORS.length],
      child: i % 5 === 0,
      happy: true,
      phase: (i * 2.4 + (city.tick % 20) * 0.15) % 12,
    });
  }
  return out;
}

export function trimPosts(city: CityState, index: number): void {
  if (city.levels[index] <= 0 && !isHub(city, index)) {
    for (let slot = 0; slot < POST_SLOTS; slot += 1) city.posts[index * POST_SLOTS + slot] = 0;
    const mark = index + 1;
    for (let entry = 0; entry < city.posts.length; entry += 1) {
      if (city.posts[entry] === mark) city.posts[entry] = 0;
    }
    return;
  }
  if (city.zones[index] === Zone.Residential) {
    const kept = listAdults(city, index).length;
    for (let slot = kept; slot < POST_SLOTS; slot += 1) city.posts[index * POST_SLOTS + slot] = 0;
    return;
  }
  const capacity = effectiveJobCapacity(city, index);
  let seen = 0;
  const mark = index + 1;
  for (let entry = 0; entry < city.posts.length; entry += 1) {
    if (city.posts[entry] !== mark) continue;
    seen += 1;
    if (seen > capacity) city.posts[entry] = 0;
  }
}

export function helpBadges(city: CityState): { homes: number[]; workplaces: number[] } {
  const filled = new Uint16Array(city.levels.length);
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace >= 0) filled[workplace] += 1;
  }
  const homes: number[] = [];
  const workplaces: number[] = [];
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.levels[index] <= 0) continue;
    const zone = city.zones[index];
    if (zone === Zone.Residential && listAdults(city, index).some((adult) => adult.workplace === null)) homes.push(index);
    if (isWorkplace(city, index)) {
      const openings = effectiveJobCapacity(city, index) - filled[index];
      if (openings > 0) workplaces.push(index);
    }
  }
  return { homes, workplaces };
}

function outageBuildings(city: CityState, bit: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < city.levels.length; index += 1) {
    const zoneBuilding = city.levels[index] > 0;
    if (!zoneBuilding && !isHub(city, index)) continue;
    if ((city.utility[index] & bit) !== 0) continue;
    out.push(index);
  }
  return out;
}

/** Zone buildings and trade hubs that miss power and/or water. */
export function utilityOutageBadges(city: CityState): number[] {
  const out: number[] = [];
  for (let index = 0; index < city.levels.length; index += 1) {
    const zoneBuilding = city.levels[index] > 0;
    if (!zoneBuilding && !isHub(city, index)) continue;
    if ((city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT)) continue;
    out.push(index);
  }
  return out;
}

export function powerOutageBadges(city: CityState): number[] {
  return outageBuildings(city, POWER_BIT);
}

export function waterOutageBadges(city: CityState): number[] {
  return outageBuildings(city, WATER_BIT);
}

/** Without power/water, commercial and industrial keep their seats but earn much less (see cityLedger). */
export function effectiveJobCapacity(city: CityState, workplace: number): number {
  if (!isWorkplace(city, workplace)) return 0;
  const hub = hubJobs(city, workplace);
  if (hub > 0) return hub;
  return jobCapacity(city.zones[workplace], city.levels[workplace]);
}

export function jobOpenings(city: CityState, workplace: number): number {
  if (!isWorkplace(city, workplace)) return 0;
  let filled = 0;
  const mark = workplace + 1;
  for (let index = 0; index < city.posts.length; index += 1) {
    if (city.posts[index] === mark) filled += 1;
  }
  return Math.max(0, effectiveJobCapacity(city, workplace) - filled);
}

export function isWorkplace(city: CityState, index: number): boolean {
  if (index < 0 || index >= city.services.length) return false;
  if (isHub(city, index)) return true;
  if (city.levels[index] <= 0) return false;
  const zone = city.zones[index];
  return zone === Zone.Commercial || zone === Zone.Industrial || zone === Zone.Farm;
}

function adultSlot(city: CityState, home: number, family: number, person: number): number {
  let slot = 0;
  const level = city.levels[home];
  let remaining = 2 + level * 2;
  for (let familyIndex = 0; familyIndex < 4 && remaining > 0; familyIndex += 1) {
    const size = Math.min(remaining, 2 + (hash(home * 19 + familyIndex) % 3));
    for (let member = 0; member < size; member += 1) {
      if (member < 2) {
        if (familyIndex === family && member === person) return slot;
        slot += 1;
      }
    }
    remaining -= size;
  }
  return -1;
}

function jobTitle(city: CityState, workplace: number, education: number, person: number): string {
  const { x, y } = cellCoords(city, workplace);
  const title = JOBS[education]?.[hash(person + workplace) % 3] ?? "Aushilfe";
  const place = city.zones[workplace] === Zone.Industrial ? "Industrie" : city.zones[workplace] === Zone.Farm ? "Bauernhof" : "Gewerbe";
  if (city.services[workplace] === ServiceKind.Harbor) return `${title === "Aushilfe" ? "Kaianlage" : title}, Hafen Feld ${x}, ${y}`;
  if (city.services[workplace] === ServiceKind.Airport) return `${title === "Aushilfe" ? "Vorfeld" : title}, Flughafen Feld ${x}, ${y}`;
  const farmJob = city.zones[workplace] === Zone.Farm ? "Feldarbeit" : title;
  return `${farmJob}, ${place} Feld ${x}, ${y}`;
}

function educationLabel(level: number): string {
  if (level >= 2) return "Hochschulabschluss";
  if (level === 1) return "Schulabschluss";
  return "ohne Abschluss";
}

function hash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function serviceNearby(city: CityState, index: number, kind: number): boolean {
  const info = serviceInfo(kind);
  if (!info || info.radius <= 0) return city.services.some((entry) => entry === kind);
  const here = cellCoords(city, index);
  for (let cell = 0; cell < city.services.length; cell += 1) {
    if (city.services[cell] !== kind) continue;
    const spot = cellCoords(city, cell);
    if (Math.max(Math.abs(spot.x - here.x), Math.abs(spot.y - here.y)) <= info.radius) return true;
  }
  return false;
}
