/**
 * Zoo / Tiergehege: habitats are services on the grid; animals, items and needs live in
 * city.progress.zoo. Everything here is deterministic (tick + map seed + ids) so the server,
 * the solo worker and coop clients compute the same births, names and genes.
 */
import type { ApplyResult, CityState } from "./types.ts";

// Plain numbers on purpose: types.ts → progressState.ts → zoo.ts is an import cycle, so no runtime
// values from types.ts/grid.ts here. They must match ServiceKind.Zoo* and CELL_SIZE.
const CELL_SIZE = 10;

// ---------------------------------------------------------------- catalog

export type HabitatType = "savanne" | "wald" | "wasser" | "polar" | "wiese";
export const HABITAT_TYPES: HabitatType[] = ["savanne", "wald", "wasser", "polar", "wiese"];

export const HABITAT_KIND: Record<HabitatType, number> = {
  savanne: 15,
  wald: 16,
  wasser: 17,
  polar: 18,
  wiese: 19,
};

export const HABITAT_INFO: Record<HabitatType, { name: string; short: string; blurb: string }> = {
  savanne: { name: "Savannen-Gehege", short: "Savanne", blurb: "Trockenes Gras, Akazie und Holzzaun. Für Löwen, Elefanten, Giraffen, Zebras und Kängurus." },
  wald: { name: "Waldgehege", short: "Wald", blurb: "Bäume, Moos und Kletterstämme. Für Bären, Affen, Rote Pandas und Wölfe." },
  wasser: { name: "Wasser-Gehege", short: "Wasser", blurb: "Großes Becken mit Uferzone. Für Seehunde, Flamingos und Otter." },
  polar: { name: "Polar-Gehege", short: "Polar", blurb: "Eisschollen, Schnee und kaltes Becken. Für Pinguine und Eisbären." },
  wiese: { name: "Streichelzoo", short: "Wiese", blurb: "Bunte Wiese mit niedrigem Zaun. Kaninchen, Ziegen und Alpakas zum Streicheln." },
};

export function habitatTypeOf(kind: number): HabitatType | null {
  for (const type of HABITAT_TYPES) if (HABITAT_KIND[type] === kind) return type;
  return null;
}

export function isHabitatKind(kind: number): boolean {
  return habitatTypeOf(kind) !== null;
}

export interface SpeciesInfo {
  id: string;
  name: string;
  plural: string;
  habitat: HabitatType;
  price: number;
  /** Space it takes in a habitat (capacity HABITAT_SPACE). */
  space: number;
  /** Food per needs step (2 s) as adult. */
  eat: number;
  /** Visitor appeal. */
  appeal: number;
  gestation: number;
  grow: number;
  /** Base color (hex) and body size (world units, ~shoulder height). */
  color: number;
  size: number;
  /** Predators only share a habitat with their own species. */
  predator?: boolean;
}

export const SPECIES: SpeciesInfo[] = [
  { id: "lion", name: "Löwe", plural: "Löwen", habitat: "savanne", price: 2600, space: 2, eat: 0.5, appeal: 1.6, gestation: 240, grow: 900, color: 0xc89a52, size: 1.1, predator: true },
  { id: "elephant", name: "Elefant", plural: "Elefanten", habitat: "savanne", price: 5200, space: 4, eat: 1.1, appeal: 2, gestation: 360, grow: 1200, color: 0x8f8d8a, size: 2.2 },
  { id: "giraffe", name: "Giraffe", plural: "Giraffen", habitat: "savanne", price: 3800, space: 3, eat: 0.8, appeal: 1.7, gestation: 320, grow: 1100, color: 0xd9a650, size: 1.6 },
  { id: "zebra", name: "Zebra", plural: "Zebras", habitat: "savanne", price: 1500, space: 2, eat: 0.6, appeal: 1.2, gestation: 260, grow: 900, color: 0xe8e4dc, size: 1.2 },
  { id: "kangaroo", name: "Känguru", plural: "Kängurus", habitat: "savanne", price: 1200, space: 1, eat: 0.35, appeal: 1.1, gestation: 180, grow: 720, color: 0xb07a4e, size: 0.95 },
  { id: "bear", name: "Braunbär", plural: "Braunbären", habitat: "wald", price: 3000, space: 3, eat: 0.8, appeal: 1.6, gestation: 300, grow: 1000, color: 0x6b4a32, size: 1.3, predator: true },
  { id: "monkey", name: "Affe", plural: "Affen", habitat: "wald", price: 1400, space: 1, eat: 0.3, appeal: 1.4, gestation: 200, grow: 720, color: 0x7a5a3c, size: 0.75 },
  { id: "redpanda", name: "Roter Panda", plural: "Rote Pandas", habitat: "wald", price: 1600, space: 1, eat: 0.25, appeal: 1.5, gestation: 180, grow: 720, color: 0xb8502a, size: 0.6 },
  { id: "wolf", name: "Wolf", plural: "Wölfe", habitat: "wald", price: 1800, space: 2, eat: 0.45, appeal: 1.2, gestation: 200, grow: 800, color: 0x8a8580, size: 0.9, predator: true },
  { id: "seal", name: "Seehund", plural: "Seehunde", habitat: "wasser", price: 1700, space: 2, eat: 0.5, appeal: 1.4, gestation: 260, grow: 800, color: 0x7d838a, size: 0.7 },
  { id: "flamingo", name: "Flamingo", plural: "Flamingos", habitat: "wasser", price: 900, space: 1, eat: 0.2, appeal: 1.2, gestation: 160, grow: 600, color: 0xf08aa0, size: 1.1 },
  { id: "otter", name: "Otter", plural: "Otter", habitat: "wasser", price: 1100, space: 1, eat: 0.25, appeal: 1.4, gestation: 160, grow: 600, color: 0x6b4c34, size: 0.45 },
  { id: "penguin", name: "Pinguin", plural: "Pinguine", habitat: "polar", price: 1000, space: 1, eat: 0.25, appeal: 1.5, gestation: 180, grow: 640, color: 0x2a2e36, size: 0.6 },
  { id: "polarbear", name: "Eisbär", plural: "Eisbären", habitat: "polar", price: 4200, space: 3, eat: 1, appeal: 1.9, gestation: 320, grow: 1100, color: 0xf0eee6, size: 1.35, predator: true },
  { id: "rabbit", name: "Kaninchen", plural: "Kaninchen", habitat: "wiese", price: 250, space: 1, eat: 0.1, appeal: 0.7, gestation: 120, grow: 480, color: 0xd8c8b0, size: 0.35 },
  { id: "goat", name: "Ziege", plural: "Ziegen", habitat: "wiese", price: 450, space: 1, eat: 0.2, appeal: 0.8, gestation: 160, grow: 560, color: 0xeee6d6, size: 0.7 },
  { id: "alpaca", name: "Alpaka", plural: "Alpakas", habitat: "wiese", price: 900, space: 2, eat: 0.3, appeal: 1.1, gestation: 220, grow: 720, color: 0xf2e2c4, size: 1.05 },
];

export function speciesInfo(id: string): SpeciesInfo | null {
  return SPECIES.find((entry) => entry.id === id) ?? null;
}

export type OriginId = "circus" | "rescue" | "breeder" | "wild" | "born";
export const BUY_ORIGINS: Exclude<OriginId, "born">[] = ["circus", "rescue", "breeder", "wild"];

export const ORIGIN_INFO: Record<OriginId, { name: string; price: number; health: number; trust: number; happy: number; blurb: string }> = {
  circus: { name: "Zirkus-Rettung", price: 0.4, health: 45, trust: 20, happy: 25, blurb: "Günstig, aber erschöpft und schreckhaft. Braucht Futter, Ruhe und viel Zuwendung." },
  rescue: { name: "Schlechte Haltung", price: 0.3, health: 30, trust: 12, happy: 20, blurb: "Sehr günstig, krank und misstrauisch. Mit Pflege und Tierarzt wird es wieder." },
  breeder: { name: "Züchter", price: 1, health: 95, trust: 70, happy: 70, blurb: "Teurer, dafür kerngesund und an Menschen gewöhnt." },
  wild: { name: "Auswilderungsprogramm", price: 0.7, health: 85, trust: 25, happy: 50, blurb: "Gesund, aber scheu. Hilft einem Schutzprojekt." },
  born: { name: "Im Zoo geboren", price: 0, health: 80, trust: 60, happy: 70, blurb: "Hier aufgewachsen." },
};

const STORIES: Record<OriginId, string[]> = {
  circus: [
    "{name} musste jahrelang in einem Wanderzirkus durch Reifen springen. Ein Tierschutzverein hat {name} freigekauft.",
    "{name} lebte im Zirkuswagen und kennt Applaus besser als Gras. Jetzt darf {name} einfach {species} sein.",
    "Nach der Pleite eines Zirkus stand {name} plötzlich allein da. Wir haben sofort zugesagt.",
  ],
  rescue: [
    "{name} wurde aus einem viel zu kleinen Hinterhofgehege befreit – abgemagert und misstrauisch.",
    "Ein Hinweis von Nachbarn: {name} wurde in einer Garage gehalten. Jetzt beginnt ein neues Leben.",
    "{name} kam aus einer Beschlagnahmung. Das Fell ist stumpf, der Blick ängstlich – aber {name} kämpft.",
  ],
  breeder: [
    "{name} stammt von einem zertifizierten Züchter, ist kerngesund und an Menschen gewöhnt.",
    "{name} kommt aus einer Zuchtstation mit gutem Ruf und bringt beste Papiere mit.",
    "Ein Partnerzoo hat {name} abgegeben – entspannt, neugierig und gut genährt.",
  ],
  wild: [
    "{name} gehört zu einem Auswilderungsprogramm und soll bei uns stark werden, bevor es weitergeht.",
    "{name} wurde verletzt in der Wildnis gefunden, gesund gepflegt und lebt jetzt im Schutzprogramm.",
    "Ein Artenschutzprojekt vertraut uns {name} an. Noch ist {name} sehr scheu.",
  ],
  born: [
    "{name} ist hier im Zoo zur Welt gekommen – Nachwuchs der {family}-Familie.",
  ],
};

const FEMALE_NAMES = [
  "Mira", "Luna", "Ella", "Frieda", "Lotte", "Ida", "Mia", "Greta", "Hanna", "Rosa", "Nala", "Wilma", "Clara", "Lina", "Paula",
  "Mila", "Juna", "Emma", "Lisa", "Maja", "Erna", "Tilda", "Pia", "Henni", "Smilla", "Jule", "Zora", "Nele", "Ronja", "Kiki", "Flocke",
];
const MALE_NAMES = [
  "Leo", "Bruno", "Max", "Paul", "Emil", "Oskar", "Karl", "Anton", "Felix", "Theo", "Simba", "Otto", "Jonas", "Fritz", "Hugo",
  "Ben", "Moritz", "Rudi", "Kalle", "Willi", "Bodo", "Knut", "Balu", "Gustav", "Fiete", "Mats", "Elvis", "Piet",
];
const EITHER_NAMES = ["Sam", "Momo", "Pünktchen", "Socke", "Krümel", "Wolke", "Sunny", "Bambi", "Lucky", "Toni"];
export const NAME_POOL = [...FEMALE_NAMES, ...MALE_NAMES, ...EITHER_NAMES];

export type ItemKind = "food" | "water" | "toy" | "shelter" | "plant" | "rock";
export const ITEM_KINDS: ItemKind[] = ["food", "water", "toy", "shelter", "plant", "rock"];
export const ITEM_INFO: Record<ItemKind, { name: string; cost: number; blurb: string }> = {
  food: { name: "Futternapf", cost: 60, blurb: "Muss nachgefüllt werden (oder ein Pfleger macht das)." },
  water: { name: "Wassertrog", cost: 60, blurb: "Frisches Wasser. Leert sich mit der Zeit." },
  toy: { name: "Spielzeug", cost: 120, blurb: "Ball und Seil. Macht glücklich, nötig zum Spielen." },
  shelter: { name: "Unterstand", cost: 400, blurb: "Schatten und Rückzug. Wichtig für scheue Tiere." },
  plant: { name: "Pflanze", cost: 40, blurb: "Busch oder Gras. Etwas mehr Wohlfühlen." },
  rock: { name: "Felsen", cost: 50, blurb: "Zum Klettern und Sonnen." },
};

/** Interior grid is ITEM_GRID × ITEM_GRID. */
export const ITEM_GRID = 8;
export const MAX_ITEMS = 14;
export const HABITAT_SPACE = 8;
export const MAX_ANIMALS = 72;
export const NAME_MAX = 18;
export const ZOO_EVERY = 4;
export const BREED_EVERY = 20;
export const PET_COOLDOWN = 16;
export const VET_COST = 150;
export const VET_COOLDOWN = 120;
export const HAND_FEED_COST = 5;
export const REFILL_FOOD_COST = 30;
export const REFILL_WATER_COST = 4;
export const KEEPER_FEE = 2;
export const BREED_CHANCE = 0.12;
/** Genes: inheritance mixes the parents and adds at most this mutation (per gene, in gene units). */
export const MUTATION = 0.06;

// ---------------------------------------------------------------- state

export interface Genes {
  /** Coat hue shift −1…1. */
  hue: number;
  /** Body scale 0.8…1.2. */
  size: number;
  /** Pattern strength 0…1 (stripes/spots). */
  pattern: number;
  /** Robustness 0…1: health gain/loss. */
  robust: number;
  /** Temperament 0 (scheu) … 1 (verspielt). */
  temper: number;
}

export const GENE_RANGE: Record<keyof Genes, [number, number]> = {
  hue: [-1, 1],
  size: [0.8, 1.2],
  pattern: [0, 1],
  robust: [0, 1],
  temper: [0, 1],
};
export const GENE_KEYS = Object.keys(GENE_RANGE) as (keyof Genes)[];

export interface Animal {
  id: number;
  name: string;
  species: string;
  /** Habitat cell, or −1 while waiting for a fitting habitat. */
  cell: number;
  sex: "m" | "w";
  born: number;
  health: number;
  trust: number;
  happy: number;
  genes: Genes;
  origin: OriginId;
  story: number;
  mother?: number;
  father?: number;
  /** "Leo-&-Mira" – the parents' family; lineage is passed on to children. */
  family?: string;
  lineage?: string;
  gen: number;
  pregnantUntil?: number;
  mate?: number;
  petAt?: number;
  vetAt?: number;
  /** Rescued animal nursed back to health (counted once). */
  nursed?: boolean;
  /** Last interaction (for client reactions). */
  react?: { tick: number; kind: CareAct };
}

export interface HabitatItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  /** 0–100 for bowls. */
  fill?: number;
}

export interface Habitat {
  cell: number;
  type: HabitatType;
  items: HabitatItem[];
  keeper: boolean;
  fed: boolean;
  watered: boolean;
}

export interface ZooState {
  habitats: Habitat[];
  animals: Animal[];
  seq: number;
  itemSeq: number;
  visitors: number;
  /** Per growth step (2 s), used by the city ledger. */
  income: number;
  cost: number;
  born: number;
  bought: number;
  nursed: number;
  earned: number;
  lastBirth: { tick: number; id: number } | null;
}

export function freshZoo(): ZooState {
  return { habitats: [], animals: [], seq: 1, itemSeq: 1, visitors: 0, income: 0, cost: 0, born: 0, bought: 0, nursed: 0, earned: 0, lastBirth: null };
}

export function zooOf(city: CityState): ZooState | null {
  return city.progress?.zoo ?? null;
}

function ensureZoo(city: CityState): ZooState | null {
  const p = city.progress;
  if (!p || p.off) return null;
  if (!p.zoo) p.zoo = freshZoo();
  return p.zoo;
}

// ---------------------------------------------------------------- deterministic random

function mix(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0…1 from the map seed and a few integers. */
export function zooRand(city: CityState, ...parts: number[]): number {
  let h = mix(((city.gen?.seed ?? 1) >>> 0) ^ 0x2005);
  for (const part of parts) h = mix(h * 31 + (part | 0) * 977 + 0x9e37);
  return h / 4294967296;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------- genes, names, family

export function randomGenes(city: CityState, salt: number): Genes {
  const r = (n: number) => zooRand(city, salt, n);
  return {
    hue: round3(-0.6 + r(1) * 1.2),
    size: round3(0.88 + r(2) * 0.24),
    pattern: round3(r(3)),
    robust: round3(0.25 + r(4) * 0.6),
    temper: round3(0.15 + r(5) * 0.7),
  };
}

/** Each gene: blend of both parents (25–75 %) plus a mutation of at most ±MUTATION × range. */
export function inheritGenes(city: CityState, a: Genes, b: Genes, salt: number): Genes {
  const out = {} as Genes;
  GENE_KEYS.forEach((key, index) => {
    const [min, max] = GENE_RANGE[key];
    const span = max - min;
    const t = 0.25 + zooRand(city, salt, index, 1) * 0.5;
    const mutation = (zooRand(city, salt, index, 2) * 2 - 1) * MUTATION * span;
    out[key] = round3(clamp(a[key] + (b[key] - a[key]) * t + mutation, min, max));
  });
  return out;
}

/** Random German name that fits the sex (plus a few neutral pet names). */
export function randomName(city: CityState, salt: number, avoid: string[] = [], sex?: "m" | "w"): string {
  const pool = sex === "w" ? [...FEMALE_NAMES, ...EITHER_NAMES] : sex === "m" ? [...MALE_NAMES, ...EITHER_NAMES] : NAME_POOL;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const name = pool[Math.floor(zooRand(city, salt, attempt, 7) * pool.length) % pool.length];
    if (!avoid.includes(name)) return name;
  }
  return pool[salt % pool.length];
}

/** Trimmed, single-spaced name or null when invalid (empty, too long, odd characters). */
export function cleanAnimalName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'\-&]*$/u.test(name)) return null;
  return name;
}

export function familyLabel(animal: Animal): string | null {
  return animal.family ? `${animal.name} aus der ${animal.family}-Familie` : null;
}

export function storyText(animal: Animal): string {
  const info = speciesInfo(animal.species);
  const list = STORIES[animal.origin] ?? STORIES.born;
  const template = list[animal.story % list.length] ?? list[0];
  return template.replaceAll("{name}", animal.name).replaceAll("{species}", info?.name ?? "Tier").replaceAll("{family}", animal.family ?? "Zoo");
}

export function isAdult(animal: Animal, tick: number): boolean {
  const info = speciesInfo(animal.species);
  return tick - animal.born >= (info?.grow ?? 600);
}

/** 0.45 (newborn) … 1 (adult), times the size gene. */
export function growthScale(animal: Animal, tick: number): number {
  const info = speciesInfo(animal.species);
  const grow = info?.grow ?? 600;
  const t = clamp((tick - animal.born) / grow, 0, 1);
  return (0.45 + 0.55 * t) * animal.genes.size;
}

// ---------------------------------------------------------------- habitats

export function habitatAt(zoo: ZooState, cell: number): Habitat | null {
  return zoo.habitats.find((entry) => entry.cell === cell) ?? null;
}

export function animalsIn(zoo: ZooState, cell: number): Animal[] {
  return zoo.animals.filter((animal) => animal.cell === cell);
}

export function spaceUsed(zoo: ZooState, cell: number): number {
  let used = 0;
  for (const animal of zoo.animals) {
    if (animal.cell !== cell) continue;
    used += speciesInfo(animal.species)?.space ?? 1;
  }
  return used;
}

/** Make sure every habitat service on the map has a state entry, drop removed ones. */
export function syncHabitats(city: CityState, zoo: ZooState): void {
  const seen = new Set<number>();
  for (let index = 0; index < city.services.length; index += 1) {
    const type = habitatTypeOf(city.services[index]);
    if (!type) continue;
    seen.add(index);
    const habitat = habitatAt(zoo, index);
    if (!habitat) zoo.habitats.push(starterHabitat(zoo, index, type));
    else if (habitat.type !== type) habitat.type = type;
  }
  if (zoo.habitats.some((habitat) => !seen.has(habitat.cell))) zoo.habitats = zoo.habitats.filter((habitat) => seen.has(habitat.cell));
  // Animals of removed habitats wait (cell −1) and move into the first fitting habitat with room.
  for (const animal of zoo.animals) {
    const home = animal.cell >= 0 ? habitatAt(zoo, animal.cell) : null;
    const info = speciesInfo(animal.species);
    if (home && info && home.type === info.habitat) continue;
    animal.cell = -1;
    if (!info) continue;
    const target = zoo.habitats.find((habitat) => habitat.type === info.habitat && spaceUsed(zoo, habitat.cell) + info.space <= HABITAT_SPACE);
    if (target) animal.cell = target.cell;
  }
}

function starterHabitat(zoo: ZooState, cell: number, type: HabitatType): Habitat {
  // A new habitat comes with one bowl and one trough, so it works right away.
  const items: HabitatItem[] = [
    { id: zoo.itemSeq++, kind: "food", x: 2, y: 5, fill: 100 },
    { id: zoo.itemSeq++, kind: "water", x: 5, y: 5, fill: 100 },
  ];
  return { cell, type, items, keeper: false, fed: true, watered: true };
}

// ---------------------------------------------------------------- simulation

function speciesCount(zoo: ZooState): number {
  return new Set(zoo.animals.filter((animal) => animal.cell >= 0).map((animal) => animal.species)).size;
}

/** Visitor appeal: happy, healthy animals and many species draw people. */
export function zooAppeal(zoo: ZooState): number {
  let appeal = 0;
  for (const animal of zoo.animals) {
    if (animal.cell < 0) continue;
    const info = speciesInfo(animal.species);
    if (!info) continue;
    const mood = (animal.happy * 0.65 + animal.health * 0.35) / 100;
    appeal += info.appeal * (0.25 + mood);
  }
  return appeal * (1 + speciesCount(zoo) * 0.12);
}

export const TICKET = 0.4;

/** Called every sim tick from stepProgress. */
export function stepZoo(city: CityState): void {
  const zoo = ensureZoo(city);
  if (!zoo) return;
  syncHabitats(city, zoo);
  if (city.tick % ZOO_EVERY !== 0) return;
  if (zoo.habitats.length === 0 && zoo.animals.length === 0) {
    zoo.visitors = 0;
    zoo.income = 0;
    zoo.cost = 0;
    return;
  }
  let cost = 0;
  for (const habitat of zoo.habitats) {
    const animals = animalsIn(zoo, habitat.cell);
    let eat = 0;
    for (const animal of animals) eat += (speciesInfo(animal.species)?.eat ?? 0.3) * (isAdult(animal, city.tick) ? 1 : 0.6);
    const drink = eat * 0.8;
    habitat.fed = drain(habitat, "food", eat) || animals.length === 0;
    habitat.watered = drain(habitat, "water", drink) || animals.length === 0;
    if (habitat.keeper) {
      cost += KEEPER_FEE;
      for (const item of habitat.items) {
        if ((item.kind === "food" || item.kind === "water") && (item.fill ?? 0) < 30) {
          const fee = item.kind === "food" ? REFILL_FOOD_COST : REFILL_WATER_COST;
          if (city.funds >= fee) {
            city.funds -= fee;
            item.fill = 100;
          }
        }
      }
    }
    const shelter = habitat.items.some((item) => item.kind === "shelter");
    const toy = habitat.items.some((item) => item.kind === "toy");
    const decor = Math.min(3, habitat.items.filter((item) => item.kind === "plant" || item.kind === "rock").length);
    const crowded = spaceUsed(zoo, habitat.cell) > HABITAT_SPACE;
    for (const animal of animals) stepAnimal(city, zoo, animal, habitat, { shelter, toy, decor, crowded });
    for (const animal of animals) cost += (speciesInfo(animal.species)?.eat ?? 0.3) * 0.6;
  }
  for (const animal of zoo.animals) {
    if (animal.cell >= 0) continue;
    // Waiting animals (no habitat): a little sad, but fed by the keepers.
    animal.happy = round1(Math.max(15, animal.happy - 0.2));
  }
  if (city.tick % BREED_EVERY === 0) stepBreeding(city, zoo);
  const appeal = zooAppeal(zoo);
  const pop = populationHint(city);
  zoo.visitors = Math.round(Math.min(appeal * 7, 25 + pop * 0.5));
  zoo.income = Math.round(zoo.visitors * TICKET * 10) / 10;
  zoo.cost = Math.round(cost * 10) / 10;
  zoo.earned = Math.round(zoo.earned + zoo.income);
}

function populationHint(city: CityState): number {
  let pop = 0;
  for (let index = 0; index < city.levels.length; index += 1) if (city.zones[index] === 1) pop += city.levels[index] * 4;
  return pop;
}

function drain(habitat: Habitat, kind: "food" | "water", amount: number): boolean {
  const bowls = habitat.items.filter((item) => item.kind === kind);
  const total = bowls.reduce((sum, item) => sum + (item.fill ?? 0), 0);
  if (bowls.length === 0 || total <= 0) return false;
  let left = amount;
  for (const bowl of [...bowls].sort((a, b) => (b.fill ?? 0) - (a.fill ?? 0))) {
    if (left <= 0) break;
    const take = Math.min(bowl.fill ?? 0, left);
    bowl.fill = round1((bowl.fill ?? 0) - take);
    left -= take;
  }
  return true;
}

function stepAnimal(
  city: CityState,
  zoo: ZooState,
  animal: Animal,
  habitat: Habitat,
  place: { shelter: boolean; toy: boolean; decor: number; crowded: boolean },
): void {
  const ok = habitat.fed && habitat.watered;
  const young = !isAdult(animal, city.tick);
  const robust = animal.genes.robust;
  if (ok) animal.health += 0.45 * (0.6 + 0.8 * robust);
  else animal.health -= 0.6 * (1.4 - robust) * (young ? 1.5 : 1);
  animal.health = round1(clamp(animal.health, 5, 100));
  const calm = 50 + animal.genes.temper * 20 + (place.shelter ? 8 : 0);
  if (ok && animal.trust < calm) animal.trust += 0.12;
  if (!ok) animal.trust -= 0.1;
  animal.trust = round1(clamp(animal.trust, 0, 100));
  let target = 22 + (habitat.fed ? 16 : 0) + (habitat.watered ? 10 : 0) + (place.shelter ? 14 : 0) + (place.toy ? 10 : 0) + place.decor * 5 + animal.trust * 0.12;
  if (place.crowded) target -= 20;
  if (animal.health < 40) target -= 15;
  animal.happy = round1(clamp(animal.happy + (target - animal.happy) * 0.06, 0, 100));
  if ((animal.origin === "circus" || animal.origin === "rescue") && !animal.nursed && animal.health >= 90 && animal.trust >= 65) {
    animal.nursed = true;
    zoo.nursed += 1;
  }
  if (animal.pregnantUntil && city.tick >= animal.pregnantUntil) giveBirth(city, zoo, animal);
}

/** Two healthy, happy, trusting adults of one species with room → chance of offspring. */
export function canBreed(city: CityState, zoo: ZooState, mother: Animal, father: Animal): boolean {
  if (mother.species !== father.species || mother.cell !== father.cell || mother.cell < 0) return false;
  if (mother.sex !== "w" || father.sex !== "m") return false;
  if (mother.pregnantUntil) return false;
  const shared = (a?: number, b?: number) => a !== undefined && a === b;
  if (shared(mother.mother, father.mother) || shared(mother.father, father.father)) return false;
  if (mother.father === father.id || father.mother === mother.id) return false;
  for (const animal of [mother, father]) {
    if (!isAdult(animal, city.tick)) return false;
    if (animal.health < 70 || animal.happy < 60 || animal.trust < 45) return false;
  }
  const info = speciesInfo(mother.species);
  if (!info) return false;
  return spaceUsed(zoo, mother.cell) + info.space <= HABITAT_SPACE;
}

function stepBreeding(city: CityState, zoo: ZooState): void {
  if (zoo.animals.length >= MAX_ANIMALS) return;
  for (const mother of zoo.animals) {
    if (mother.sex !== "w" || mother.pregnantUntil) continue;
    const father = zoo.animals.find((other) => canBreed(city, zoo, mother, other));
    if (!father) continue;
    if (zooRand(city, city.tick, mother.id, father.id, 11) >= BREED_CHANCE) continue;
    const info = speciesInfo(mother.species);
    mother.pregnantUntil = city.tick + (info?.gestation ?? 240);
    mother.mate = father.id;
  }
}

function giveBirth(city: CityState, zoo: ZooState, mother: Animal): void {
  const info = speciesInfo(mother.species);
  const father = zoo.animals.find((animal) => animal.id === mother.mate) ?? null;
  if (!info || zoo.animals.length >= MAX_ANIMALS || spaceUsed(zoo, mother.cell) + info.space > HABITAT_SPACE) {
    // No room: the birth waits (the bar in the panel says why).
    mother.pregnantUntil = city.tick + 40;
    return;
  }
  const id = zoo.seq++;
  const fatherGenes = father?.genes ?? mother.genes;
  const parents = [mother.name, father?.name ?? ""].filter(Boolean);
  const family = father ? `${father.name}-&-${mother.name}` : `${mother.name}`;
  const childSex: "m" | "w" = zooRand(city, id, 3) < 0.5 ? "w" : "m";
  const child: Animal = {
    id,
    name: randomName(city, id * 7 + city.tick, parents, childSex),
    species: mother.species,
    cell: mother.cell,
    sex: childSex,
    born: city.tick,
    health: 80,
    trust: round1(clamp(((mother.trust + (father?.trust ?? mother.trust)) / 2) * 0.8, 20, 90)),
    happy: 70,
    genes: inheritGenes(city, mother.genes, fatherGenes, id * 131 + city.tick),
    origin: "born",
    story: 0,
    mother: mother.id,
    ...(father ? { father: father.id } : {}),
    family,
    lineage: mother.lineage ?? father?.lineage ?? family,
    gen: Math.max(mother.gen, father?.gen ?? 0) + 1,
  };
  zoo.animals.push(child);
  delete mother.pregnantUntil;
  delete mother.mate;
  zoo.born += 1;
  zoo.lastBirth = { tick: city.tick, id };
  const p = city.progress;
  if (p) p.last = { tick: city.tick, kind: "zoo", title: `Nachwuchs: ${child.name}`, text: `${info.name}-Baby aus der ${family}-Familie.`, pay: 0 };
}

/** Homes near a habitat with animals get a little happier (moodBonus). */
export function zooMood(city: CityState, homeX: number, homeY: number, width: number): number {
  const zoo = zooOf(city);
  if (!zoo || zoo.animals.length === 0) return 0;
  const appeal = zoo.visitors;
  if (appeal <= 0) return 0;
  for (const habitat of zoo.habitats) {
    const hx = habitat.cell % width;
    const hy = Math.floor(habitat.cell / width);
    if (Math.max(Math.abs(hx - homeX), Math.abs(hy - homeY)) <= 10) return Math.min(0.08, 0.02 + appeal * 0.0006);
  }
  return 0;
}

// ---------------------------------------------------------------- commands

export type CareAct = "pet" | "play" | "feed" | "vet";

export type ZooOp =
  | { op: "buy"; cell: number; species: string; origin: Exclude<OriginId, "born"> }
  | { op: "place"; cell: number; item: ItemKind; x: number; y: number }
  | { op: "take"; cell: number; item: number }
  | { op: "refill"; cell: number }
  | { op: "keeper"; cell: number; on: boolean }
  | { op: "care"; animal: number; act: CareAct }
  | { op: "rename"; animal: number; name: string }
  | { op: "release"; animal: number };

/**
 * Who may move in: predators live only with their own species, and no other species joins a predator
 * (the polar bear would eat the penguins). Returns the blocking species or null.
 */
export function clashWith(zoo: ZooState, cell: number, species: string): SpeciesInfo | null {
  const info = speciesInfo(species);
  if (!info) return null;
  for (const other of animalsIn(zoo, cell)) {
    if (other.species === species) continue;
    const otherInfo = speciesInfo(other.species);
    if (otherInfo && (info.predator || otherInfo.predator)) return otherInfo;
  }
  return null;
}

export function priceOf(species: SpeciesInfo, origin: OriginId): number {
  return Math.round((species.price * ORIGIN_INFO[origin].price) / 10) * 10;
}

const fail = (reason: string): ApplyResult => ({ ok: false, reason, spent: 0, applied: [], rejected: [] });
const done = (spent = 0): ApplyResult => ({ ok: true, spent, applied: [], rejected: [] });

export function applyZoo(city: CityState, op: ZooOp): ApplyResult {
  if (city.progress?.off) return fail("zoo_off");
  const zoo = ensureZoo(city);
  if (!zoo) return fail("zoo_off");
  syncHabitats(city, zoo);
  if (op.op === "care" || op.op === "rename" || op.op === "release") {
    const animal = zoo.animals.find((entry) => entry.id === op.animal);
    if (!animal) return fail("zoo_gone");
    if (op.op === "rename") {
      const name = cleanAnimalName(op.name);
      if (!name) return fail("zoo_name");
      animal.name = name;
      return done();
    }
    if (op.op === "release") {
      zoo.animals = zoo.animals.filter((entry) => entry.id !== animal.id);
      for (const other of zoo.animals) if (other.mate === animal.id) delete other.mate;
      return done();
    }
    return care(city, zoo, animal, op.act);
  }
  const habitat = habitatAt(zoo, op.cell);
  if (!habitat) return fail("zoo_no_habitat");
  if (op.op === "buy") {
    const info = speciesInfo(op.species);
    if (!info || !BUY_ORIGINS.includes(op.origin)) return fail("rejected");
    if (info.habitat !== habitat.type) return fail("zoo_wrong_habitat");
    if (clashWith(zoo, habitat.cell, info.id)) return fail("zoo_predator");
    if (zoo.animals.length >= MAX_ANIMALS) return fail("zoo_full");
    if (spaceUsed(zoo, habitat.cell) + info.space > HABITAT_SPACE) return fail("zoo_full");
    const price = priceOf(info, op.origin);
    if (city.funds < price) return fail("funds");
    city.funds -= price;
    const id = zoo.seq++;
    const origin = ORIGIN_INFO[op.origin];
    const roll = (n: number) => zooRand(city, id, n, 41);
    const genes = randomGenes(city, id * 17 + 5);
    if (op.origin === "rescue" || op.origin === "circus") genes.robust = round3(Math.max(0, genes.robust - 0.1));
    const sameSpecies = animalsIn(zoo, habitat.cell).filter((entry) => entry.species === info.id);
    // Second animal of a species gets the other sex, so a pair can have young.
    const sex: "m" | "w" = sameSpecies.length > 0 ? (sameSpecies.filter((entry) => entry.sex === "w").length <= sameSpecies.filter((entry) => entry.sex === "m").length ? "w" : "m") : roll(1) < 0.5 ? "w" : "m";
    zoo.animals.push({
      id,
      name: randomName(city, id * 13, zoo.animals.map((entry) => entry.name), sex),
      species: info.id,
      cell: habitat.cell,
      sex,
      // Bought animals arrive grown up.
      born: city.tick - info.grow - Math.floor(roll(2) * 300),
      health: round1(clamp(origin.health + (roll(3) - 0.5) * 10, 5, 100)),
      trust: round1(clamp(origin.trust + (roll(4) - 0.5) * 10, 0, 100)),
      happy: origin.happy,
      genes,
      origin: op.origin,
      story: Math.floor(roll(5) * 3),
      gen: 0,
    });
    zoo.bought += 1;
    return done(price);
  }
  if (op.op === "place") {
    if (!ITEM_KINDS.includes(op.item)) return fail("rejected");
    if (habitat.items.length >= MAX_ITEMS) return fail("zoo_items_full");
    if (habitat.items.some((item) => item.x === op.x && item.y === op.y)) return fail("zoo_spot_taken");
    const cost = ITEM_INFO[op.item].cost;
    if (city.funds < cost) return fail("funds");
    city.funds -= cost;
    habitat.items.push({ id: zoo.itemSeq++, kind: op.item, x: op.x, y: op.y, ...(op.item === "food" || op.item === "water" ? { fill: 100 } : {}) });
    return done(cost);
  }
  if (op.op === "take") {
    const before = habitat.items.length;
    habitat.items = habitat.items.filter((item) => item.id !== op.item);
    return before === habitat.items.length ? fail("zoo_gone") : done();
  }
  if (op.op === "refill") {
    let cost = 0;
    for (const item of habitat.items) {
      if (item.kind !== "food" && item.kind !== "water") continue;
      if ((item.fill ?? 0) >= 99) continue;
      cost += item.kind === "food" ? REFILL_FOOD_COST : REFILL_WATER_COST;
    }
    if (cost === 0) return fail("zoo_full_bowls");
    if (city.funds < cost) return fail("funds");
    city.funds -= cost;
    for (const item of habitat.items) if (item.kind === "food" || item.kind === "water") item.fill = 100;
    habitat.fed = true;
    habitat.watered = true;
    return done(cost);
  }
  habitat.keeper = op.on;
  return done();
}

function care(city: CityState, zoo: ZooState, animal: Animal, act: CareAct): ApplyResult {
  if (animal.cell < 0) return fail("zoo_no_habitat");
  const tick = city.tick;
  if (act === "vet") {
    if (animal.vetAt !== undefined && tick - animal.vetAt < VET_COOLDOWN) return fail("zoo_cooldown");
    if (city.funds < VET_COST) return fail("funds");
    city.funds -= VET_COST;
    animal.vetAt = tick;
    animal.health = round1(clamp(animal.health + 25, 5, 100));
    animal.react = { tick, kind: act };
    return done(VET_COST);
  }
  if (animal.petAt !== undefined && tick - animal.petAt < PET_COOLDOWN) return fail("zoo_cooldown");
  const habitat = habitatAt(zoo, animal.cell);
  if (act === "play" && !habitat?.items.some((item) => item.kind === "toy")) return fail("zoo_need_toy");
  let spent = 0;
  if (act === "feed") {
    if (city.funds < HAND_FEED_COST) return fail("funds");
    city.funds -= HAND_FEED_COST;
    spent = HAND_FEED_COST;
  }
  // Shy animals warm up slower; playful ones love playing.
  const temper = animal.genes.temper;
  const gain = act === "pet" ? 5 + temper * 4 : act === "play" ? 3 + temper * 5 : 4;
  animal.trust = round1(clamp(animal.trust + gain, 0, 100));
  animal.happy = round1(clamp(animal.happy + (act === "play" ? 8 : act === "pet" ? 5 : 3), 0, 100));
  if (act === "feed") animal.health = round1(clamp(animal.health + 3, 5, 100));
  animal.petAt = tick;
  animal.react = { tick, kind: act };
  return done(spent);
}

export function parseZooOp(raw: unknown): ZooOp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const int = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
  const cellOk = int(r.cell, 0, 1_000_000);
  const animalOk = int(r.animal, 0, 0x7fffffff);
  switch (r.op) {
    case "buy":
      if (!cellOk || typeof r.species !== "string" || !speciesInfo(r.species) || !BUY_ORIGINS.includes(r.origin as never)) return null;
      return { op: "buy", cell: r.cell as number, species: r.species, origin: r.origin as Exclude<OriginId, "born"> };
    case "place":
      if (!cellOk || !ITEM_KINDS.includes(r.item as ItemKind) || !int(r.x, 0, ITEM_GRID - 1) || !int(r.y, 0, ITEM_GRID - 1)) return null;
      return { op: "place", cell: r.cell as number, item: r.item as ItemKind, x: r.x as number, y: r.y as number };
    case "take":
      if (!cellOk || !int(r.item, 0, 0x7fffffff)) return null;
      return { op: "take", cell: r.cell as number, item: r.item as number };
    case "refill":
      return cellOk ? { op: "refill", cell: r.cell as number } : null;
    case "keeper":
      return cellOk && typeof r.on === "boolean" ? { op: "keeper", cell: r.cell as number, on: r.on } : null;
    case "care":
      return animalOk && ["pet", "play", "feed", "vet"].includes(r.act as string) ? { op: "care", animal: r.animal as number, act: r.act as CareAct } : null;
    case "rename": {
      const name = cleanAnimalName(r.name);
      return animalOk && name ? { op: "rename", animal: r.animal as number, name } : null;
    }
    case "release":
      return animalOk ? { op: "release", animal: r.animal as number } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- sanitize (saves / transport)

const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export function cloneZoo(raw: unknown): ZooState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const z = raw as Partial<ZooState>;
  const habitats: Habitat[] = Array.isArray(z.habitats)
    ? z.habitats.slice(0, 256).flatMap((entry) => {
      if (!entry || typeof entry !== "object" || !HABITAT_TYPES.includes(entry.type)) return [];
      const items = Array.isArray(entry.items)
        ? entry.items.slice(0, MAX_ITEMS).flatMap((item) => {
          if (!item || !ITEM_KINDS.includes(item.kind)) return [];
          return [{
            id: num(item.id) >>> 0,
            kind: item.kind,
            x: clamp(num(item.x) | 0, 0, ITEM_GRID - 1),
            y: clamp(num(item.y) | 0, 0, ITEM_GRID - 1),
            ...(item.kind === "food" || item.kind === "water" ? { fill: clamp(num(item.fill, 100), 0, 100) } : {}),
          }];
        })
        : [];
      return [{ cell: Math.max(0, num(entry.cell) | 0), type: entry.type, items, keeper: !!entry.keeper, fed: entry.fed !== false, watered: entry.watered !== false }];
    })
    : [];
  const animals: Animal[] = Array.isArray(z.animals)
    ? z.animals.slice(0, MAX_ANIMALS).flatMap((entry) => (entry && typeof entry === "object" ? cloneAnimal(entry) : []))
    : [];
  const last = z.lastBirth && typeof z.lastBirth === "object" ? { tick: num(z.lastBirth.tick) | 0, id: num(z.lastBirth.id) >>> 0 } : null;
  return {
    habitats,
    animals,
    seq: Math.max(1, num(z.seq, 1) >>> 0),
    itemSeq: Math.max(1, num(z.itemSeq, 1) >>> 0),
    visitors: Math.max(0, num(z.visitors) | 0),
    income: clamp(num(z.income), 0, 100_000),
    cost: clamp(num(z.cost), 0, 100_000),
    born: num(z.born) >>> 0,
    bought: num(z.bought) >>> 0,
    nursed: num(z.nursed) >>> 0,
    earned: Math.max(0, num(z.earned)),
    lastBirth: last,
  };
}

function cloneAnimal(raw: Partial<Animal>): Animal[] {
  const info = typeof raw.species === "string" ? speciesInfo(raw.species) : null;
  if (!info) return [];
  const g = (raw.genes ?? {}) as Partial<Genes>;
  const genes = {} as Genes;
  for (const key of GENE_KEYS) {
    const [min, max] = GENE_RANGE[key];
    genes[key] = clamp(num(g[key], (min + max) / 2), min, max);
  }
  const origin = (["circus", "rescue", "breeder", "wild", "born"] as OriginId[]).includes(raw.origin as OriginId) ? raw.origin as OriginId : "breeder";
  const optInt = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value | 0 : undefined);
  const animal: Animal = {
    id: num(raw.id) >>> 0,
    name: cleanAnimalName(raw.name) ?? "Namenlos",
    species: info.id,
    cell: Math.max(-1, num(raw.cell, -1) | 0),
    sex: raw.sex === "m" ? "m" : "w",
    born: num(raw.born) | 0,
    health: clamp(num(raw.health, 50), 0, 100),
    trust: clamp(num(raw.trust, 50), 0, 100),
    happy: clamp(num(raw.happy, 50), 0, 100),
    genes,
    origin,
    story: clamp(num(raw.story) | 0, 0, 9),
    gen: clamp(num(raw.gen) | 0, 0, 999),
  };
  const mother = optInt(raw.mother);
  const father = optInt(raw.father);
  if (mother !== undefined) animal.mother = mother;
  if (father !== undefined) animal.father = father;
  const family = typeof raw.family === "string" ? raw.family.slice(0, 2 * NAME_MAX + 3) : "";
  const lineage = typeof raw.lineage === "string" ? raw.lineage.slice(0, 2 * NAME_MAX + 3) : "";
  if (family) animal.family = family;
  if (lineage) animal.lineage = lineage;
  for (const key of ["pregnantUntil", "mate", "petAt", "vetAt"] as const) {
    const value = optInt(raw[key]);
    if (value !== undefined) animal[key] = value;
  }
  if (raw.nursed) animal.nursed = true;
  if (raw.react && typeof raw.react === "object" && ["pet", "play", "feed", "vet"].includes(raw.react.kind)) {
    animal.react = { tick: num(raw.react.tick) | 0, kind: raw.react.kind };
  }
  return [animal];
}

/** Interior position (0…1 across the habitat cell) → world offset from the cell centre. */
export function itemWorldOffset(x: number, y: number): { dx: number; dz: number } {
  const step = (CELL_SIZE * 0.78) / ITEM_GRID;
  return { dx: (x + 0.5) * step - CELL_SIZE * 0.39, dz: (y + 0.5) * step - CELL_SIZE * 0.39 };
}
