/**
 * Long-term motivation layer: city ranks, achievements, random city events with
 * choices, daily challenges, landmark perks and happiness bonuses.
 *
 * All state lives in `city.progress` and travels in SimMeta, so the authoritative
 * sim (worker in solo, server in coop) drives it and both coop players see the same.
 * Old saves without `progress` are seeded silently (no retroactive cash, no toasts).
 */
import { DAY_TICKS, climateAt } from "./climate.ts";
import { cellCoords, cellIndex, inBounds } from "./grid.ts";
import { HAPPY_SMILE, houseHappiness, isWorkplace, nearBeach } from "./people.ts";
import { nextRand } from "./sim.ts";
import { ServiceKind, Zone, type ApplyResult, type CityState } from "./types.ts";
import { FIRST_EVENT_DELAY, ensureProgress, type ChallengeKind, type CityEffect, type CityProgress, type DailyChallenge, type EventId } from "./progressState.ts";

export * from "./progressState.ts";

export const PROGRESS_EVERY = 4;
export const MONEY_CAP = 5_000_000;

// ---------------------------------------------------------------- ranks

export interface CityRank {
  at: number;
  name: string;
  reward: number;
  perk: string;
}

export const RANKS: CityRank[] = [
  { at: 0, name: "Außenposten", reward: 0, perk: "Der Anfang. Straße, Haus, Strom und Wasser." },
  { at: 12, name: "Siedlung", reward: 1_000, perk: "Tagesaufgaben starten." },
  { at: 48, name: "Dorf", reward: 2_500, perk: "Stadt-Ereignisse beginnen." },
  { at: 120, name: "Kleinstadt", reward: 5_000, perk: "Wahrzeichen Riesenrad freigeschaltet." },
  { at: 300, name: "Stadt", reward: 10_000, perk: "Wahrzeichen Rathaus freigeschaltet (+6 % Steuern)." },
  { at: 700, name: "Großstadt", reward: 20_000, perk: "Wahrzeichen Fernsehturm freigeschaltet." },
  { at: 1500, name: "Metropole", reward: 40_000, perk: "+5 % auf alle Einnahmen. Die Stadt ist weltberühmt." },
];

export function rankFor(population: number): number {
  let rank = 0;
  for (let index = 0; index < RANKS.length; index += 1) if (population >= RANKS[index].at) rank = index;
  return rank;
}

// ---------------------------------------------------------------- landmarks

export interface Landmark {
  kind: number;
  key: "wheel" | "hall" | "tower";
  name: string;
  rank: number;
  radius: number;
  mood: number;
  flat: number;
  boost: number;
  text: string;
}

export const LANDMARKS: Landmark[] = [
  { kind: ServiceKind.Wheel, key: "wheel", name: "Riesenrad", rank: 3, radius: 9, mood: 0.14, flat: 70, boost: 0, text: "Wohnhäuser im Umkreis werden deutlich glücklicher. Lockt Ausflügler: +70 € / 2 s." },
  { kind: ServiceKind.CityHall, key: "hall", name: "Rathaus", rank: 4, radius: 11, mood: 0.08, flat: 0, boost: 0.06, text: "+6 % auf alle Einnahmen. Ereignisse bringen mehr. Umgebung etwas glücklicher." },
  { kind: ServiceKind.Tower, key: "tower", name: "Fernsehturm", rank: 5, radius: 14, mood: 0.06, flat: 160, boost: 0.03, text: "Sendet die Stadt in die Welt: +160 € / 2 s, +3 % Einnahmen, Ausblick für Touristen." },
];

export function landmarkInfo(kind: number): Landmark | null {
  return LANDMARKS.find((entry) => entry.kind === kind) ?? null;
}

export function isLandmark(kind: number): boolean {
  return landmarkInfo(kind) !== null;
}

/** Why a landmark cannot be placed right now (rank / already built), or null. */
export function landmarkBlock(city: CityState, kind: number): string | null {
  const info = landmarkInfo(kind);
  if (!info) return null;
  const rank = Math.max(city.progress?.rank ?? 0, rankFor(populationOf(city)));
  if (rank < info.rank) return `${info.name} gibt es ab Rang ${RANKS[info.rank].name}.`;
  for (let index = 0; index < city.services.length; index += 1) {
    if (city.services[index] === kind) return `${info.name} steht schon – jedes Wahrzeichen gibt es nur einmal.`;
  }
  return null;
}

const landmarkCache = new WeakMap<CityState, { rev: number; tick: number; cells: { index: number; info: Landmark }[] }>();

function landmarkCells(city: CityState): { index: number; info: Landmark }[] {
  const cached = landmarkCache.get(city);
  if (cached && cached.rev === city.revision && cached.tick === city.tick) return cached.cells;
  const cells: { index: number; info: Landmark }[] = [];
  for (let index = 0; index < city.services.length; index += 1) {
    const kind = city.services[index];
    if (kind < ServiceKind.Wheel) continue;
    const info = landmarkInfo(kind);
    if (info) cells.push({ index, info });
  }
  landmarkCache.set(city, { rev: city.revision, tick: city.tick, cells });
  return cells;
}

/** Extra happiness for a home from landmarks in range plus city-wide event moods. */
export function moodBonus(city: CityState, home: number): number {
  let bonus = eventMood(city);
  const marks = landmarkCells(city);
  if (marks.length > 0) {
    const here = cellCoords(city, home);
    for (const mark of marks) {
      const spot = cellCoords(city, mark.index);
      if (Math.max(Math.abs(spot.x - here.x), Math.abs(spot.y - here.y)) <= mark.info.radius) bonus += mark.info.mood;
    }
  }
  return bonus;
}

// ---------------------------------------------------------------- state

// ---------------------------------------------------------------- effects & ledger hooks

function activeEffects(city: CityState): CityEffect[] {
  const progress = city.progress;
  if (!progress || progress.effects.length === 0) return [];
  return progress.effects.filter((effect) => effect.until > city.tick);
}

export function eventMood(city: CityState): number {
  let mood = 0;
  for (const effect of activeEffects(city)) mood += effect.mood;
  return mood;
}

export interface IncomeBoost {
  mult: number;
  flat: number;
  lines: { label: string; value: string }[];
}

/** Multiplier and flat bonus on top of the base ledger (landmarks, events, happiness, rank). */
export function incomeBoost(city: CityState): IncomeBoost {
  let mult = 1;
  let flat = 0;
  const lines: { label: string; value: string }[] = [];
  for (const mark of landmarkCells(city)) {
    if (mark.info.boost > 0) mult += mark.info.boost;
    flat += mark.info.flat;
  }
  for (const effect of activeEffects(city)) {
    mult *= effect.mult;
    flat += effect.flat;
  }
  const progress = city.progress;
  const mood = progress?.stats.mood ?? 0;
  if (mood >= 80) {
    mult *= 1.06;
    lines.push({ label: "Glückliche Stadt", value: "+6 %" });
  } else if (mood >= 70) {
    mult *= 1.03;
    lines.push({ label: "Zufriedene Stadt", value: "+3 %" });
  }
  if ((progress?.rank ?? 0) >= RANKS.length - 1) {
    mult *= 1.05;
    lines.push({ label: "Metropole", value: "+5 %" });
  }
  return { mult, flat, lines };
}

export function applyBoost(city: CityState, income: number): number {
  const boost = incomeBoost(city);
  return income * boost.mult + boost.flat;
}

export function noteTradeIncome(city: CityState, money: number): void {
  if (money <= 0) return;
  ensureProgress(city).stats.trade += money;
}

// ---------------------------------------------------------------- metrics

export interface CityMetrics {
  population: number;
  homes: number;
  jobs: number;
  parks: number;
  roads: number;
  happy: number;
  mood: number;
  landmarks: number;
  hubs: number;
  harbor: boolean;
  airport: boolean;
  farm: boolean;
  park: boolean;
  beachHomes: number;
  lit: number;
}

export function populationOf(city: CityState): number {
  let population = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    if (city.zones[index] === Zone.Residential && city.levels[index] > 0) population += city.levels[index] * 12;
  }
  return population;
}

export function cityMetrics(city: CityState): CityMetrics {
  const m: CityMetrics = {
    population: 0, homes: 0, jobs: 0, parks: 0, roads: 0, happy: 0, mood: 0, landmarks: 0, hubs: 0,
    harbor: false, airport: false, farm: false, park: false, beachHomes: 0, lit: 0,
  };
  let moodSum = 0;
  for (let index = 0; index < city.levels.length; index += 1) {
    const service = city.services[index];
    if (service === ServiceKind.Park) m.parks += 1;
    if (service === ServiceKind.Harbor) m.harbor = true;
    if (service === ServiceKind.Airport) m.airport = true;
    if (isLandmark(service)) m.landmarks += 1;
    if ((city.roads[index] & 16) !== 0) m.roads += 1;
    const level = city.levels[index];
    if (level <= 0) continue;
    if ((city.utility[index] & 1) !== 0) m.lit += 1;
    const zone = city.zones[index];
    if (zone === Zone.Farm) m.farm = true;
    if (zone !== Zone.Residential) continue;
    m.homes += 1;
    m.population += level * 12;
    const mood = houseHappiness(city, index);
    moodSum += mood.score;
    if (mood.score >= HAPPY_SMILE) m.happy += 1;
    if (mood.beach || nearBeach(city, index)) m.beachHomes += 1;
  }
  for (let index = 0; index < city.posts.length; index += 1) {
    const workplace = city.posts[index] - 1;
    if (workplace >= 0 && isWorkplace(city, workplace)) m.jobs += 1;
  }
  m.park = m.parks > 0;
  m.hubs = Number(m.harbor) + Number(m.airport);
  m.mood = m.homes > 0 ? (moodSum / m.homes) * 100 : 0;
  return m;
}

// ---------------------------------------------------------------- achievements

export interface Achievement {
  bit: number;
  title: string;
  text: string;
  reward: number;
  test: (m: CityMetrics, p: CityProgress, city: CityState) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { bit: 1 << 0, title: "Grundstein", text: "Das erste Wohnhaus steht.", reward: 500, test: (m) => m.homes >= 1 },
  { bit: 1 << 1, title: "Dorfgemeinschaft", text: "Rang Dorf erreicht.", reward: 0, test: (_m, p) => p.rank >= 2 },
  { bit: 1 << 2, title: "Kleinstadtflair", text: "Rang Kleinstadt erreicht.", reward: 0, test: (_m, p) => p.rank >= 3 },
  { bit: 1 << 3, title: "Stadtrecht", text: "Rang Stadt erreicht.", reward: 0, test: (_m, p) => p.rank >= 4 },
  { bit: 1 << 4, title: "Großstadtlichter", text: "Rang Großstadt erreicht.", reward: 0, test: (_m, p) => p.rank >= 5 },
  { bit: 1 << 5, title: "Metropole", text: "Die höchste Stufe: Metropole.", reward: 0, test: (_m, p) => p.rank >= 6 },
  { bit: 1 << 6, title: "Händler", text: "10.000 € Erlös aus Hafen- oder Flughafenhandel.", reward: 2_000, test: (_m, p) => p.stats.trade >= 10_000 },
  { bit: 1 << 7, title: "Handelsimperium", text: "100.000 € Erlös aus Handel.", reward: 10_000, test: (_m, p) => p.stats.trade >= 100_000 },
  { bit: 1 << 8, title: "Strahlende Gesichter", text: "10 Haushalte gleichzeitig sehr glücklich.", reward: 3_000, test: (m) => m.happy >= 10 },
  { bit: 1 << 9, title: "Partystadt", text: "Drei große Stadtfeste gefeiert.", reward: 4_000, test: (_m, p) => p.stats.festivals >= 3 },
  { bit: 1 << 10, title: "Sturmerprobt", text: "Einen Sturm überstanden.", reward: 2_000, test: (_m, p) => p.stats.storms >= 1 },
  { bit: 1 << 11, title: "Wahrzeichen", text: "Das erste Wahrzeichen gebaut.", reward: 5_000, test: (m) => m.landmarks >= 1 },
  { bit: 1 << 12, title: "Skyline", text: "Alle drei Wahrzeichen stehen.", reward: 25_000, test: (m) => m.landmarks >= 3 },
  { bit: 1 << 13, title: "Glückliche Stadt", text: "Ø Zufriedenheit 80 % bei mindestens 10 Häusern.", reward: 6_000, test: (m) => m.homes >= 10 && m.mood >= 80 },
  { bit: 1 << 14, title: "Tagesheld", text: "Drei Tagesaufgaben geschafft.", reward: 4_000, test: (_m, p) => p.stats.challenges >= 3 },
  { bit: 1 << 15, title: "Ausdauer", text: "Sieben Spieltage durchgehalten.", reward: 5_000, test: (_m, _p, city) => city.tick >= DAY_TICKS * 7 },
  { bit: 1 << 16, title: "Weltoffen", text: "Hafen und Flughafen in einer Stadt.", reward: 3_000, test: (m) => m.harbor && m.airport },
  { bit: 1 << 17, title: "Millionär", text: "1.000.000 € in der Kasse.", reward: 0, test: (_m, _p, city) => city.funds >= 1_000_000 },
];

// ---------------------------------------------------------------- daily challenges


export function challengeMetric(kind: ChallengeKind, m: CityMetrics, p: CityProgress): number {
  if (kind === "homes") return m.homes;
  if (kind === "pop") return m.population;
  if (kind === "jobs") return m.jobs;
  if (kind === "parks") return m.parks;
  if (kind === "trade") return p.stats.trade;
  if (kind === "happy") return m.happy;
  return m.roads;
}

export function challengeText(challenge: DailyChallenge): string {
  const n = challenge.target.toLocaleString("de-DE");
  if (challenge.kind === "homes") return `Baue heute ${n} neue Wohnhäuser.`;
  if (challenge.kind === "pop") return `Gewinne heute ${n} neue Einwohner.`;
  if (challenge.kind === "jobs") return `Besetze heute ${n} weitere Arbeitsplätze.`;
  if (challenge.kind === "parks") return `Leg heute ${n === "1" ? "einen neuen Park" : `${n} neue Parks`} an.`;
  if (challenge.kind === "trade") return `Verdiene heute ${n} € mit Handel.`;
  if (challenge.kind === "happy") return `Mach heute ${n} weitere Haushalte sehr glücklich.`;
  return `Bau heute ${n} Straßenfelder.`;
}

export function challengeProgress(challenge: DailyChallenge, m: CityMetrics, p: CityProgress): number {
  return Math.max(0, Math.min(challenge.target, challengeMetric(challenge.kind, m, p) - challenge.base));
}

function pickChallenge(city: CityState, day: number, m: CityMetrics, p: CityProgress): DailyChallenge {
  const options: ChallengeKind[] = ["homes", "pop", "jobs", "roads"];
  if (p.rank >= 2) options.push("parks", "happy");
  if (m.hubs > 0) options.push("trade", "trade");
  const seed = ((city.gen?.seed ?? 7) ^ Math.imul(day + 1, 2654435761)) >>> 0;
  const kind = options[seed % options.length];
  const rank = p.rank;
  let target = 3;
  if (kind === "homes") target = 3 + rank;
  else if (kind === "pop") target = Math.max(24, Math.round((m.population * 0.18) / 12) * 12);
  else if (kind === "jobs") target = 3 + rank;
  else if (kind === "parks") target = rank >= 4 ? 2 : 1;
  else if (kind === "trade") target = 3_000 + rank * 1_500;
  else if (kind === "happy") target = 2 + Math.floor(rank / 2);
  else target = 10 + rank * 3;
  return { day, kind, base: challengeMetric(kind, m, p), target, reward: 2_500 + rank * 1_000, done: false };
}

// ---------------------------------------------------------------- events

export const EVENT_GAP_MIN = 720;
export const EVENT_GAP_SPAN = 480;
export const EVENT_TIMEOUT = 240;

export interface EventOption {
  label: string;
  cost: number;
  hint: string;
}

export interface CityEventDef {
  id: EventId;
  title: string;
  text: string;
  options: EventOption[];
  can: (m: CityMetrics, city: CityState) => boolean;
}

export const EVENTS: CityEventDef[] = [
  {
    id: "festival",
    title: "Stadtfest!",
    text: "Die Nachbarschaft will feiern: Lampions, Musik, Würstchenstand. Wie groß soll es werden?",
    options: [
      { label: "Großes Fest", cost: 4_000, hint: "Einen Tag lang +12 % Glück und +8 % Einnahmen." },
      { label: "Straßenfest", cost: 1_000, hint: "Kleiner Rahmen: etwas mehr Glück für einen halben Tag." },
      { label: "Absagen", cost: 0, hint: "Spart Geld, aber die Leute sind kurz enttäuscht." },
    ],
    can: (m) => m.homes >= 3,
  },
  {
    id: "storm",
    title: "Sturmwarnung",
    text: "Der Wetterdienst meldet einen Herbststurm von See. Sichern wir Küste und Dächer?",
    options: [
      { label: "Alles sichern", cost: 2_500, hint: "Kein Schaden. Die Stadt bleibt ruhig." },
      { label: "Abwarten", cost: 0, hint: "Mit Glück passiert nichts – sonst kostet der Schaden." },
    ],
    can: (m) => m.homes >= 4,
  },
  {
    id: "tourists",
    title: "Touristenwelle",
    text: "Ein Reiseblog hat eure Stadt entdeckt. Busse voller Gäste stehen vor der Tür.",
    options: [
      { label: "Werbekampagne", cost: 1_500, hint: "Einen Tag +55 € / 2 s aus Tourismus." },
      { label: "Ruhig bleiben", cost: 0, hint: "Die Einheimischen freuen sich über die Ruhe." },
    ],
    can: (m) => m.beachHomes > 0 || m.hubs > 0 || m.landmarks > 0,
  },
  {
    id: "harborfest",
    title: "Hafenfest",
    text: "Die Fischer laden zum Hafenfest: Fischbrötchen, Shanty-Chor und Bootskorso.",
    options: [
      { label: "Mitfeiern", cost: 2_000, hint: "Exportmarkt erholt sich sofort, dazu Glück und +30 € / 2 s." },
      { label: "Weiterarbeiten", cost: 0, hint: "Sofort +1.500 € aus Extraschichten." },
    ],
    can: (m) => m.harbor,
  },
  {
    id: "heat",
    title: "Hitzewelle",
    text: "34 Grad im Schatten! Alle wollen an den Strand.",
    options: [
      { label: "Eiswagen & Schirme", cost: 1_200, hint: "Strandparty: Glück steigt für einen halben Tag." },
      { label: "Nichts tun", cost: 0, hint: "Die Hitze schlägt auf die Laune." },
    ],
    can: (m, city) => m.beachHomes > 0 && climateAt(city.tick).weather !== "rain",
  },
  {
    id: "harvest",
    title: "Erntefest",
    text: "Die Höfe hatten ein Rekordjahr. Was machen wir mit dem Überschuss?",
    options: [
      { label: "Bauernmarkt", cost: 800, hint: "+25 Nahrung und gute Laune." },
      { label: "Exportieren", cost: 0, hint: "Sofort +2.000 €." },
    ],
    can: (m) => m.farm,
  },
  {
    id: "concert",
    title: "Open-Air-Konzert",
    text: "Eine bekannte Band würde im Park spielen – wenn die Stadt die Bühne zahlt.",
    options: [
      { label: "Bühne zahlen", cost: 2_500, hint: "Fast einen Tag lang +10 % Glück in der ganzen Stadt." },
      { label: "Lieber nicht", cost: 0, hint: "Nichts passiert." },
    ],
    can: (m) => m.park && m.homes >= 6,
  },
  {
    id: "investor",
    title: "Besuch einer Investorin",
    text: "Eine Investorin will Geld in eure Läden und Betriebe stecken – mit städtischer Förderung.",
    options: [
      { label: "Fördern", cost: 5_000, hint: "Anderthalb Tage +6 % auf alle Einnahmen." },
      { label: "Ablehnen", cost: 0, hint: "Nichts passiert." },
    ],
    can: (m) => m.population >= 300 && m.jobs >= 10,
  },
];


export function eventDef(id: EventId | string): CityEventDef | null {
  return EVENTS.find((entry) => entry.id === id) ?? null;
}

function hallBonus(city: CityState): number {
  return landmarkCells(city).some((mark) => mark.info.key === "hall") ? 1.25 : 1;
}

function addEffect(p: CityProgress, city: CityState, id: string, ticks: number, mood: number, mult = 1, flat = 0): void {
  p.effects = p.effects.filter((effect) => effect.until > city.tick && effect.id !== id);
  p.effects.push({ id, until: city.tick + ticks, mood, mult, flat });
}

function pay(city: CityState, amount: number): void {
  city.funds = Math.max(0, Math.min(MONEY_CAP, Math.round(city.funds + amount)));
}

/** Resolve the open event with the chosen option. Shared by both sides of the wire. */
export function chooseEvent(city: CityState, option: number): ApplyResult {
  const p = ensureProgress(city);
  const open = p.event;
  const def = open ? eventDef(open.id) : null;
  if (!open || !def) return { ok: false, reason: "no_event", spent: 0, applied: [], rejected: [] };
  const chosen = def.options[option];
  if (!chosen) return { ok: false, reason: "rejected", spent: 0, applied: [], rejected: [] };
  if (city.funds < chosen.cost) return { ok: false, reason: "funds", spent: 0, applied: [], rejected: [] };
  pay(city, -chosen.cost);
  const outcome = resolveEvent(city, p, def.id, option);
  p.event = null;
  p.stats.events += 1;
  p.nextEvent = city.tick + EVENT_GAP_MIN + Math.floor(nextRand(city) * EVENT_GAP_SPAN) - (p.rank >= 5 ? 120 : 0);
  p.last = { tick: city.tick, kind: "event", title: def.title, text: outcome.text, pay: outcome.pay };
  city.revision += 1;
  return { ok: true, spent: chosen.cost, applied: [], rejected: [] };
}

function resolveEvent(city: CityState, p: CityProgress, id: EventId, option: number): { text: string; pay: number } {
  const hall = hallBonus(city);
  if (id === "festival") {
    if (option === 0) {
      addEffect(p, city, "fest", DAY_TICKS, 0.12 * hall, 1.08);
      p.stats.festivals += 1;
      return { text: "Die ganze Stadt tanzt bis spät in die Nacht. Alle strahlen!", pay: 0 };
    }
    if (option === 1) {
      addEffect(p, city, "fest", DAY_TICKS / 2, 0.05 * hall);
      return { text: "Ein gemütliches Straßenfest mit Kuchenbuffet.", pay: 0 };
    }
    addEffect(p, city, "grumpy", DAY_TICKS / 3, -0.05);
    return { text: "Das Fest fällt aus. Einige murren im Café.", pay: 0 };
  }
  if (id === "storm") {
    p.stats.storms += 1;
    if (option === 0) return { text: "Sandsäcke und Planen haben gehalten. Kein Schaden!", pay: 0 };
    if (nextRand(city) < 0.5) return { text: "Glück gehabt: Der Sturm zieht knapp vorbei.", pay: 0 };
    const damage = Math.min(9_000, Math.max(1_500, Math.round(city.funds * 0.08)));
    pay(city, -damage);
    for (const shipment of city.shipments ?? []) shipment.due += 6;
    addEffect(p, city, "storm", DAY_TICKS / 4, -0.04);
    return { text: `Abgedeckte Dächer und ein umgekippter Kran: ${damage.toLocaleString("de-DE")} € Schaden, Lieferungen verspäten sich.`, pay: -damage };
  }
  if (id === "tourists") {
    if (option === 0) {
      addEffect(p, city, "tourism", DAY_TICKS, 0.02, 1, Math.round(55 * hall));
      return { text: "Die Kampagne zieht: Hotels und Cafés sind ausgebucht.", pay: 0 };
    }
    addEffect(p, city, "calm", DAY_TICKS / 2, 0.04);
    return { text: "Die Einheimischen genießen die ruhigen Gassen.", pay: 0 };
  }
  if (id === "harborfest") {
    if (option === 0) {
      city.tradeHeat = 0;
      addEffect(p, city, "harborfest", DAY_TICKS, 0.06 * hall, 1, 30);
      return { text: "Shanties, Fischbrötchen und ein Bootskorso. Der Exportmarkt ist wieder hungrig!", pay: 0 };
    }
    const bonus = Math.round(1_500 * hall);
    pay(city, bonus);
    return { text: "Extraschichten am Kai bringen Geld in die Kasse.", pay: bonus };
  }
  if (id === "heat") {
    if (option === 0) {
      addEffect(p, city, "beachparty", DAY_TICKS / 2, 0.08 * hall);
      return { text: "Eis, Sonnenschirme und Wasserbälle – der Strand ist voller Lachen.", pay: 0 };
    }
    addEffect(p, city, "heat", DAY_TICKS / 2, -0.06);
    return { text: "Schwitzende Bürger, lange Gesichter.", pay: 0 };
  }
  if (id === "harvest") {
    if (option === 0) {
      city.food = Math.min(120, city.food + 25);
      addEffect(p, city, "market", DAY_TICKS / 2, 0.04 * hall);
      return { text: "Kürbisse, Äpfel, frisches Brot. Die Speicher sind voll.", pay: 0 };
    }
    const bonus = Math.round(2_000 * hall);
    pay(city, bonus);
    return { text: "Der Überschuss geht per Lastwagen ins Umland.", pay: bonus };
  }
  if (id === "concert") {
    if (option === 0) {
      addEffect(p, city, "concert", Math.round(DAY_TICKS * 0.8), 0.1 * hall);
      return { text: "Tausende singen im Park mit. Gänsehaut!", pay: 0 };
    }
    return { text: "Die Band spielt woanders.", pay: 0 };
  }
  if (option === 0) {
    addEffect(p, city, "boom", Math.round(DAY_TICKS * 1.5), 0, 1 + 0.06 * hall);
    return { text: "Neue Schaufenster, neue Maschinen: Die Wirtschaft brummt.", pay: 0 };
  }
  return { text: "Die Investorin zieht weiter.", pay: 0 };
}

function maybeStartEvent(city: CityState, p: CityProgress, m: CityMetrics): void {
  if (p.event || p.rank < 2 || city.tick < p.nextEvent) return;
  const pool = EVENTS.filter((entry) => entry.can(m, city));
  if (pool.length === 0) {
    p.nextEvent = city.tick + 120;
    return;
  }
  // Avoid repeating the last event back to back.
  const lastTitle = p.last?.kind === "event" ? p.last.title : "";
  const fresh = pool.filter((entry) => entry.title !== lastTitle);
  const list = fresh.length > 0 ? fresh : pool;
  const pick = list[Math.floor(nextRand(city) * list.length) % list.length];
  p.event = { id: pick.id, at: city.tick, until: city.tick + EVENT_TIMEOUT };
}

// ---------------------------------------------------------------- step

/** Advance ranks, achievements, challenges and events. Called every sim tick. */
export function stepProgress(city: CityState): void {
  const p = ensureProgress(city);
  if (p.off) return;
  if (p.event && city.tick >= p.event.until) {
    const def = eventDef(p.event.id);
    // Timeout picks the free option (the last one).
    if (def) chooseEvent(city, def.options.length - 1);
    else p.event = null;
  }
  if (p.effects.length > 0 && p.effects.some((effect) => effect.until <= city.tick)) {
    p.effects = p.effects.filter((effect) => effect.until > city.tick);
  }
  if (p.seeded && city.tick % PROGRESS_EVERY !== 0) return;
  const m = cityMetrics(city);
  p.stats.mood = Math.round(m.mood * 10) / 10;
  p.stats.happy = m.happy;
  const silent = !p.seeded;

  const rank = rankFor(m.population);
  if (rank > p.rank) {
    let reward = 0;
    for (let index = p.rank + 1; index <= rank; index += 1) reward += RANKS[index].reward;
    p.rank = rank;
    if (!silent) {
      pay(city, reward);
      p.last = { tick: city.tick, kind: "rank", title: RANKS[rank].name, text: RANKS[rank].perk, pay: reward };
    }
  }

  for (const achievement of ACHIEVEMENTS) {
    if ((p.ach & achievement.bit) !== 0) continue;
    if (!achievement.test(m, p, city)) continue;
    p.ach = (p.ach | achievement.bit) >>> 0;
    if (silent) continue;
    pay(city, achievement.reward);
    p.last = { tick: city.tick, kind: "ach", title: achievement.title, text: achievement.text, pay: achievement.reward };
  }

  const day = Math.floor(city.tick / DAY_TICKS);
  if (p.rank >= 1 && (!p.challenge || p.challenge.day !== day)) p.challenge = pickChallenge(city, day, m, p);
  if (p.challenge && !p.challenge.done && challengeProgress(p.challenge, m, p) >= p.challenge.target) {
    p.challenge.done = true;
    p.stats.challenges += 1;
    if (!silent) {
      pay(city, p.challenge.reward);
      p.last = { tick: city.tick, kind: "challenge", title: "Tagesaufgabe geschafft", text: challengeText(p.challenge), pay: p.challenge.reward };
    }
  }

  if (silent) {
    p.seeded = true;
    if (p.nextEvent < city.tick + FIRST_EVENT_DELAY / 2) p.nextEvent = city.tick + FIRST_EVENT_DELAY;
    return;
  }
  maybeStartEvent(city, p, m);
}

/** Nearest homes count toward a landmark radius preview in the UI. */
export function homesInRadius(city: CityState, index: number, radius: number): number {
  const here = cellCoords(city, index);
  let homes = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = here.x + dx;
      const ny = here.y + dy;
      if (!inBounds(city, nx, ny)) continue;
      const cell = cellIndex(city, nx, ny);
      if (city.zones[cell] === Zone.Residential && city.levels[cell] > 0) homes += 1;
    }
  }
  return homes;
}

