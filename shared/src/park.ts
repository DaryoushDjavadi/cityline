/**
 * Tierpark: a 40×40 tile park behind one city building ("Tierpark"). Paths, stands and decor are
 * one compact string (one char per tile); habitats are 5×5 tiles and live in zoo.habitats, keyed by
 * their top-left tile. Pure and deterministic: the server, the solo worker and every coop client
 * compute the same reachability, stats and visitor walks.
 */

export const PARK_SIZE = 40;
export const PARK_TILES = PARK_SIZE * PARK_SIZE;
/** World units per tile. A habitat (5 tiles) is exactly one city cell (10). */
export const PARK_TILE = 2;
export const HABITAT_TILES = 5;
/** ServiceKind.Tierpark (plain number: types.ts → zoo.ts → park.ts would be an import cycle). */
export const TIERPARK_KIND = 20;
export const TIERPARK_COST = 4500;

export const TILE = {
  grass: 0,
  path: 1,
  entrance: 2,
  food: 3,
  drink: 4,
  souvenir: 5,
  bench: 6,
  bin: 7,
  toilet: 8,
  tree: 9,
  flowers: 10,
  /** Only in occupancy grids, never in the stored string. */
  habitat: 11,
  /** Only in occupancy grids: roller coaster track or station (see coaster.ts). */
  coaster: 12,
} as const;

export type ParkObject = "path" | "food" | "drink" | "souvenir" | "bench" | "bin" | "toilet" | "tree" | "flowers" | "entrance";
export const PARK_OBJECTS: ParkObject[] = ["path", "food", "drink", "souvenir", "bench", "bin", "toilet", "tree", "flowers", "entrance"];
export type StandKind = "food" | "drink" | "souvenir";
export const STANDS: StandKind[] = ["food", "drink", "souvenir"];

export const PARK_INFO: Record<ParkObject, { name: string; cost: number; upkeep: number; price: number; code: number; blurb: string }> = {
  path: { name: "Weg", cost: 20, upkeep: 0, price: 0, code: TILE.path, blurb: "Besucher laufen nur auf Wegen. Ziehen legt eine Strecke." },
  food: { name: "Essensstand", cost: 600, upkeep: 0.5, price: 4, code: TILE.food, blurb: "Pommes, Würstchen und Eis. Direkt an einen Weg stellen." },
  drink: { name: "Getränkestand", cost: 450, upkeep: 0.4, price: 3, code: TILE.drink, blurb: "Limo, Kaffee und Wasser. Direkt an einen Weg stellen." },
  souvenir: { name: "Souvenirshop", cost: 900, upkeep: 0.6, price: 9, code: TILE.souvenir, blurb: "Plüschtiere und Postkarten. Besucher kaufen gern auf dem Heimweg." },
  bench: { name: "Bank", cost: 60, upkeep: 0, price: 0, code: TILE.bench, blurb: "Zum Ausruhen. Macht Besucher zufriedener." },
  bin: { name: "Mülleimer", cost: 40, upkeep: 0, price: 0, code: TILE.bin, blurb: "Ohne Mülleimer liegt bald Abfall herum." },
  toilet: { name: "Toiletten", cost: 500, upkeep: 0.3, price: 0, code: TILE.toilet, blurb: "Eine pro 60 Besucher, sonst sinkt die Laune." },
  tree: { name: "Baum", cost: 80, upkeep: 0, price: 0, code: TILE.tree, blurb: "Schatten und Grün. Deko macht den Park schöner." },
  flowers: { name: "Blumenbeet", cost: 30, upkeep: 0, price: 0, code: TILE.flowers, blurb: "Bunte Beete. Deko macht den Park schöner." },
  entrance: { name: "Eingang", cost: 250, upkeep: 0, price: 0, code: TILE.entrance, blurb: "Verlegt das Eingangstor an einen anderen Platz am Rand." },
};

/** Habitat build cost inside the park (same as the old city habitats). */
export const HABITAT_COST: Record<string, number> = { savanne: 1800, wald: 1600, wasser: 2200, polar: 2600, wiese: 900 };

export interface ParkState {
  /** PARK_TILES chars, 'a' + tile code. */
  tiles: string;
  /** Tile index of the entrance gate (on the edge). */
  entrance: number;
}

export interface ParkHabitatRef {
  cell: number;
  type: string;
}

/** A tile under a roller coaster; `high` = the track is high enough to walk under (paths stay). */
export interface TrackTile {
  tile: number;
  high: boolean;
}

export type RideState = "closed" | "test" | "open";

/** What the park layout, economy and crowd need to know about a roller coaster (see coaster.ts). */
export interface RideRef {
  id: number;
  /** Station tiles (visitors queue on a path next to them). */
  station: number[];
  track: TrackTile[];
  state: RideState;
  price: number;
  /** Ratings after a test run (0 before). */
  excitement: number;
  intensity: number;
  nausea: number;
}

const CODE_A = 97;
export const parkIndex = (x: number, y: number) => y * PARK_SIZE + x;
export const parkXY = (index: number) => ({ x: index % PARK_SIZE, y: Math.floor(index / PARK_SIZE) });
export const inPark = (x: number, y: number) => x >= 0 && y >= 0 && x < PARK_SIZE && y < PARK_SIZE;
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export function tileAt(park: ParkState, index: number): number {
  const code = park.tiles.charCodeAt(index) - CODE_A;
  return code >= 0 && code < TILE.habitat ? code : 0;
}

export function writeTiles(park: ParkState, changes: Map<number, number>): void {
  if (changes.size === 0) return;
  const chars = park.tiles.split("");
  for (const [index, code] of changes) chars[index] = String.fromCharCode(CODE_A + code);
  park.tiles = chars.join("");
}

/** New park: gate in the middle of the south edge and a short path inwards. */
export function freshPark(): ParkState {
  const park: ParkState = { tiles: String.fromCharCode(CODE_A).repeat(PARK_TILES), entrance: parkIndex(20, PARK_SIZE - 1) };
  const changes = new Map<number, number>([[park.entrance, TILE.entrance]]);
  for (let y = PARK_SIZE - 6; y < PARK_SIZE - 1; y += 1) changes.set(parkIndex(20, y), TILE.path);
  writeTiles(park, changes);
  return park;
}

export function cleanPark(raw: unknown): ParkState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<ParkState>;
  if (typeof r.tiles !== "string" || r.tiles.length !== PARK_TILES) return undefined;
  let tiles = "";
  for (let i = 0; i < PARK_TILES; i += 1) {
    const code = r.tiles.charCodeAt(i) - CODE_A;
    tiles += String.fromCharCode(CODE_A + (code >= 0 && code < TILE.habitat && code !== TILE.entrance ? code : 0));
  }
  const entrance = typeof r.entrance === "number" && Number.isInteger(r.entrance) && isEdge(r.entrance) ? r.entrance : parkIndex(20, PARK_SIZE - 1);
  const park = { tiles, entrance };
  writeTiles(park, new Map([[entrance, TILE.entrance]]));
  return park;
}

export function isEdge(index: number): boolean {
  if (index < 0 || index >= PARK_TILES) return false;
  const { x, y } = parkXY(index);
  return x === 0 || y === 0 || x === PARK_SIZE - 1 || y === PARK_SIZE - 1;
}

export function habitatTiles(anchor: number): number[] {
  const { x, y } = parkXY(anchor);
  const out: number[] = [];
  for (let dy = 0; dy < HABITAT_TILES; dy += 1) for (let dx = 0; dx < HABITAT_TILES; dx += 1) out.push(parkIndex(x + dx, y + dy));
  return out;
}

export function habitatFits(anchor: number): boolean {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= PARK_TILES) return false;
  const { x, y } = parkXY(anchor);
  return x + HABITAT_TILES <= PARK_SIZE && y + HABITAT_TILES <= PARK_SIZE;
}

/** Tile codes including habitat footprints and roller coasters. */
export function occupancy(park: ParkState, habitats: ParkHabitatRef[], rides: RideRef[] = []): Uint8Array {
  const grid = new Uint8Array(PARK_TILES);
  for (let i = 0; i < PARK_TILES; i += 1) grid[i] = tileAt(park, i);
  for (const habitat of habitats) {
    if (!habitatFits(habitat.cell)) continue;
    for (const tile of habitatTiles(habitat.cell)) grid[tile] = TILE.habitat;
  }
  for (const ride of rides) {
    for (const { tile, high } of ride.track) {
      if (tile < 0 || tile >= PARK_TILES || grid[tile] === TILE.habitat) continue;
      // Paths under a high track stay walkable; everything else under a coaster is taken.
      if (high && walkable(grid[tile])) continue;
      grid[tile] = TILE.coaster;
    }
  }
  return grid;
}

export function habitatAtTile(habitats: ParkHabitatRef[], index: number): ParkHabitatRef | null {
  const { x, y } = parkXY(index);
  for (const habitat of habitats) {
    const a = parkXY(habitat.cell);
    if (x >= a.x && y >= a.y && x < a.x + HABITAT_TILES && y < a.y + HABITAT_TILES) return habitat;
  }
  return null;
}

export const walkable = (code: number) => code === TILE.path || code === TILE.entrance;

/** BFS distance (in tiles) from the entrance over paths; −1 = not reachable. */
export function reach(park: ParkState, grid: Uint8Array): Int16Array {
  const dist = new Int16Array(PARK_TILES).fill(-1);
  const queue = new Int16Array(PARK_TILES);
  let head = 0;
  let tail = 0;
  dist[park.entrance] = 0;
  queue[tail++] = park.entrance;
  while (head < tail) {
    const index = queue[head++];
    const x = index % PARK_SIZE;
    const y = (index - x) / PARK_SIZE;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inPark(nx, ny)) continue;
      const next = parkIndex(nx, ny);
      if (dist[next] >= 0 || !walkable(grid[next])) continue;
      dist[next] = dist[index] + 1;
      queue[tail++] = next;
    }
  }
  return dist;
}

/** Reachable path tiles next to any of the given tiles (sorted, unique). */
export function accessTiles(tiles: number[], dist: Int16Array): number[] {
  const out = new Set<number>();
  for (const tile of tiles) {
    const { x, y } = parkXY(tile);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inPark(nx, ny)) continue;
      const next = parkIndex(nx, ny);
      if (dist[next] >= 0 && !tiles.includes(next)) out.add(next);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export interface ParkSpot {
  /** Habitat anchor or object tile. */
  tile: number;
  kind: ParkObject | "habitat";
  /** Reachable path tiles where a visitor stands to use it. */
  access: number[];
}

export interface RideSpot extends RideRef {
  access: number[];
}

export interface ParkSummary {
  grid: Uint8Array;
  dist: Int16Array;
  paths: number;
  habitats: ParkSpot[];
  /** Reachable objects by kind. */
  spots: Record<ParkObject, ParkSpot[]>;
  /** All placed objects by kind (reachable or not). */
  counts: Record<ParkObject, number>;
  decor: number;
  /** Roller coasters whose station has a reachable path next to it. */
  rides: RideSpot[];
}

export function summarize(park: ParkState, habitats: ParkHabitatRef[], rides: RideRef[] = []): ParkSummary {
  const grid = occupancy(park, habitats, rides);
  const dist = reach(park, grid);
  const spots = Object.fromEntries(PARK_OBJECTS.map((kind) => [kind, [] as ParkSpot[]])) as Record<ParkObject, ParkSpot[]>;
  const counts = Object.fromEntries(PARK_OBJECTS.map((kind) => [kind, 0])) as Record<ParkObject, number>;
  let paths = 0;
  for (let i = 0; i < PARK_TILES; i += 1) {
    const code = grid[i];
    if (code === TILE.grass || code === TILE.habitat) continue;
    const kind = PARK_OBJECTS.find((entry) => PARK_INFO[entry].code === code);
    if (!kind) continue;
    counts[kind] += 1;
    if (kind === "path") {
      if (dist[i] >= 0) paths += 1;
      continue;
    }
    if (kind === "entrance") continue;
    const access = accessTiles([i], dist);
    if (access.length > 0 || kind === "tree" || kind === "flowers") spots[kind].push({ tile: i, kind, access });
  }
  const list: ParkSpot[] = [];
  for (const habitat of habitats) {
    if (!habitatFits(habitat.cell)) continue;
    const access = accessTiles(habitatTiles(habitat.cell), dist);
    if (access.length > 0) list.push({ tile: habitat.cell, kind: "habitat", access });
  }
  const decor = counts.tree + counts.flowers;
  const rideSpots: RideSpot[] = [];
  for (const ride of rides) {
    const access = accessTiles(ride.station, dist);
    if (access.length > 0) rideSpots.push({ ...ride, access });
  }
  return { grid, dist, paths, habitats: list, spots, counts, decor, rides: rideSpots };
}

/** Shortest walk between two walkable tiles (inclusive), or null. */
export function findPath(grid: Uint8Array, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Int16Array(PARK_TILES).fill(-1);
  const queue = new Int16Array(PARK_TILES);
  let head = 0;
  let tail = 0;
  prev[from] = from;
  queue[tail++] = from;
  while (head < tail) {
    const index = queue[head++];
    if (index === to) break;
    const x = index % PARK_SIZE;
    const y = (index - x) / PARK_SIZE;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inPark(nx, ny)) continue;
      const next = parkIndex(nx, ny);
      if (prev[next] >= 0 || !walkable(grid[next])) continue;
      prev[next] = index;
      queue[tail++] = next;
    }
  }
  if (prev[to] < 0) return null;
  const out = [to];
  let at = to;
  while (at !== from) {
    at = prev[at];
    out.push(at);
  }
  return out.reverse();
}

/** Tiles of a straight L-shaped drag (horizontal first), like roads in the city. */
export function dragLine(from: number, to: number): number[] {
  const a = parkXY(from);
  const b = parkXY(to);
  const out: number[] = [];
  const sx = Math.sign(b.x - a.x);
  for (let x = a.x; x !== b.x; x += sx) out.push(parkIndex(x, a.y));
  const sy = Math.sign(b.y - a.y);
  for (let y = a.y; y !== b.y; y += sy) out.push(parkIndex(b.x, y));
  out.push(to);
  return out;
}

// ---------------------------------------------------------------- satisfaction & money

export const PRICE_MAX = 30;
/** Riders per zoo step one coaster train can carry. */
export const RIDE_CAP = 8;
/** Running cost of a coaster per zoo step while it is not closed. */
export const RIDE_UPKEEP = 1.2;

/** Fair ticket price of a ride for its excitement (RCT-style: better rides may cost more). */
export function rideFair(excitement: number): number {
  return Math.max(1, Math.round(1 + excitement * 0.9));
}

/** Price of a stand on a tile (custom or the default from PARK_INFO). */
export function standPrice(prices: Record<number, number> | undefined, tile: number, kind: StandKind): number {
  const custom = prices?.[tile];
  return typeof custom === "number" ? custom : PARK_INFO[kind].price;
}

/**
 * Demand multiplier for a price against the fair price: cheap → a few more buyers, fair → 1,
 * overpriced → quickly fewer (2× fair ≈ nobody). Revenue (price × demand) peaks near the fair price.
 */
export function priceFactor(price: number, fair: number): number {
  if (fair <= 0) return 1;
  const r = price / fair;
  if (r <= 1) return 1 + (1 - r) * 0.35;
  return Math.max(0, 1 - (r - 1) * 1.1);
}

export type PriceMood = "cheap" | "fair" | "pricey" | "rip";
export function priceMood(price: number, fair: number): PriceMood {
  const r = fair > 0 ? price / fair : 1;
  return r <= 0.85 ? "cheap" : r <= 1.15 ? "fair" : r <= 1.45 ? "pricey" : "rip";
}

export interface StandStat {
  tile: number;
  kind: StandKind;
  price: number;
  fair: number;
  /** Buyers per zoo step. */
  customers: number;
  /** € per zoo step. */
  sales: number;
  mood: PriceMood;
}

export interface RideStat {
  id: number;
  price: number;
  fair: number;
  /** Riders per zoo step. */
  riders: number;
  revenue: number;
  mood: PriceMood;
}

export interface ParkEconomy {
  satisfaction: number;
  /** Visitor appeal multiplier from amenities (0.5…1.4). */
  factor: number;
  /** Stand sales per zoo step (2 s) in €. */
  sales: number;
  /** Stand and ride upkeep per zoo step. */
  upkeep: number;
  /** Ride tickets per zoo step in €. */
  rideSales: number;
  stands: StandStat[];
  rides: RideStat[];
}

/**
 * Satisfaction 0–100 from animals' mood, variety, stands, benches, bins, toilets, decor, rides
 * and prices. `visitors` is the current crowd; `animalMood` the average happiness of shown animals.
 */
export function parkEconomy(summary: ParkSummary, visitors: number, animalMood: number, species: number, prices?: Record<number, number>): ParkEconomy {
  const n = (kind: ParkObject) => summary.spots[kind].length;
  let score = 42 + (animalMood - 50) * 0.3 + Math.min(15, species * 3);
  score += n("food") > 0 ? 8 : visitors > 10 ? -6 : 0;
  score += n("drink") > 0 ? 6 : visitors > 10 ? -4 : 0;
  score += n("souvenir") > 0 ? 3 : 0;
  const toiletsNeeded = Math.ceil(visitors / 60);
  score += n("toilet") >= toiletsNeeded ? (visitors > 0 ? 7 : 0) : visitors > 20 ? -10 : -3;
  score += Math.min(8, n("bench") * 2);
  score += n("bin") > 0 ? Math.min(6, n("bin") * 2) : visitors > 30 ? -6 : 0;
  score += Math.min(9, summary.decor * 0.35);
  // Open rides make a day out; overpriced stands and rides annoy, bargains please a little.
  const open = summary.rides.filter((ride) => ride.state === "open" && ride.excitement > 0);
  score += Math.min(10, open.reduce((sum, ride) => sum + ride.excitement, 0));
  let penalty = 0;
  let bonus = 0;
  const judge = (price: number, fair: number) => {
    const r = fair > 0 ? price / fair : 1;
    if (r > 1.25) penalty += (r - 1.25) * 8;
    else if (r < 0.85) bonus += 1;
  };
  for (const kind of STANDS) for (const spot of summary.spots[kind]) judge(standPrice(prices, spot.tile, kind), PARK_INFO[kind].price);
  for (const ride of open) judge(ride.price, rideFair(ride.excitement));
  score += Math.min(4, bonus) - Math.min(14, penalty);
  const satisfaction = Math.round(Math.max(0, Math.min(100, score)));
  const factor = 0.5 + satisfaction / 100 * 0.9;
  const mood = 0.6 + satisfaction / 100 * 0.6;
  let sales = 0;
  let upkeep = 0;
  const stands: StandStat[] = [];
  const rate: Record<StandKind, number> = { food: 0.06, drink: 0.07, souvenir: 0.02 };
  for (const kind of STANDS) {
    const list = summary.spots[kind];
    upkeep += summary.counts[kind] * PARK_INFO[kind].upkeep;
    if (list.length === 0) continue;
    const share = (visitors * rate[kind] * mood) / list.length;
    for (const spot of list) {
      const price = standPrice(prices, spot.tile, kind);
      const fair = PARK_INFO[kind].price;
      const customers = Math.round(Math.min(4, share * priceFactor(price, fair)) * 100) / 100;
      const stat = { tile: spot.tile, kind, price, fair, customers, sales: Math.round(customers * price * 100) / 100, mood: priceMood(price, fair) };
      stands.push(stat);
      sales += stat.sales;
    }
  }
  upkeep += summary.counts.toilet * PARK_INFO.toilet.upkeep;
  let rideSales = 0;
  const rides: RideStat[] = [];
  for (const ride of summary.rides) {
    if (ride.state !== "closed") upkeep += RIDE_UPKEEP;
    if (ride.state !== "open" || ride.excitement <= 0) continue;
    const fair = rideFair(ride.excitement);
    const want = visitors * (0.03 + ride.excitement * 0.012) * mood * priceFactor(ride.price, fair);
    const riders = Math.round(Math.min(RIDE_CAP, want) * 100) / 100;
    const revenue = Math.round(riders * ride.price * 100) / 100;
    rides.push({ id: ride.id, price: ride.price, fair, riders, revenue, mood: priceMood(ride.price, fair) });
    rideSales += revenue;
  }
  return {
    satisfaction,
    factor,
    sales: Math.round(sales * 10) / 10,
    upkeep: Math.round(upkeep * 10) / 10,
    rideSales: Math.round(rideSales * 10) / 10,
    stands,
    rides,
  };
}

// ---------------------------------------------------------------- visitors (client visuals + tests)

export type WalkerState = "walk" | "look" | "buy" | "sit" | "gone";

interface Goal {
  kind: "habitat" | StandKind | "bench" | "toilet" | "bin" | "exit" | "ride";
  /** Coaster id for "ride". */
  ride?: number;
  /** Habitat anchor or object tile. */
  target: number;
  /** Path tile to stand on. */
  at: number;
}

export interface Walker {
  id: number;
  /** Tile coordinates (float, centre of tile = x + 0.5). */
  x: number;
  y: number;
  heading: number;
  route: number[];
  leg: number;
  progress: number;
  goals: Goal[];
  state: WalkerState;
  wait: number;
  /** Where the current pause looks at (tile coords). */
  faceX: number;
  faceY: number;
  /** Lateral lane offset so people don't walk in single file. */
  lane: number;
  color: number;
  speed: number;
  /** Shown thought: habitat anchor while looking. */
  looking: number;
}

/** How a rider felt: thrilled, happy, queasy – or the ticket was too expensive (no ride). */
export type RideMood = "thrilled" | "happy" | "queasy" | "pricey";

export type CrowdEvent =
  | { type: "buy"; kind: StandKind; tile: number; price: number; walker: number; refused?: boolean }
  | { type: "ride"; ride: number; tile: number; price: number; walker: number; mood: RideMood }
  | { type: "look"; habitat: number; walker: number; love: boolean }
  | { type: "sit"; tile: number; walker: number };

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Park visitors that walk only on paths: enter at the gate, look at a few habitats, maybe buy
 * at stands, sit on a bench, then leave. Deterministic for a seed; used by the park view and tests.
 */
export class ParkCrowd {
  readonly walkers: Walker[] = [];
  private summary: ParkSummary | null = null;
  private prices: Record<number, number> | undefined;
  private entrance = 0;
  private random: () => number;
  private seq = 1;
  private spawnIn = 0;

  constructor(seed = 1) {
    this.random = rng(seed);
  }

  setLayout(park: ParkState, habitats: ParkHabitatRef[], rides: RideRef[] = [], prices?: Record<number, number>): void {
    this.prices = prices;
    const before = new Set(this.summary?.rides.filter((ride) => ride.state === "open").map((ride) => ride.id) ?? []);
    this.summary = summarize(park, habitats, rides);
    this.entrance = park.entrance;
    // A ride that just opened tempts some of the people already in the park.
    const fresh = this.summary.rides.filter((ride) => ride.state === "open" && ride.excitement > 0 && ride.access.length > 0 && !before.has(ride.id));
    // Re-route anyone whose way got cut; drop people standing on a removed path.
    for (const walker of this.walkers) {
      const here = parkIndex(Math.floor(walker.x), Math.floor(walker.y));
      if (!walkable(this.summary.grid[here])) {
        walker.state = "gone";
        continue;
      }
      const open = new Set(this.summary.rides.filter((ride) => ride.state === "open").map((ride) => ride.id));
      walker.goals = walker.goals.filter((goal) => walkable(this.summary!.grid[goal.at]) && this.summary!.dist[goal.at] >= 0 && (goal.kind !== "ride" || open.has(goal.ride!)));
      if (walker.goals.length === 0 || walker.goals[walker.goals.length - 1].kind !== "exit") walker.goals.push({ kind: "exit", target: this.entrance, at: this.entrance });
      for (const ride of fresh) {
        if (this.random() >= Math.min(0.6, 0.15 + ride.excitement * 0.05)) continue;
        walker.goals.splice(Math.min(walker.goals.length - 1, 1), 0, { kind: "ride", ride: ride.id, target: ride.station[0], at: this.pick(ride.access) });
      }
      if (walker.state === "walk") this.routeTo(walker, here);
    }
  }

  /** Stand prices can change without a layout change. */
  setPrices(prices: Record<number, number> | undefined): void {
    this.prices = prices;
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.random() * list.length) % list.length];
  }

  private plan(): Goal[] {
    const s = this.summary!;
    const goals: Goal[] = [];
    const habitats = [...s.habitats];
    const looks = Math.min(habitats.length, 2 + Math.floor(this.random() * 3));
    for (let k = 0; k < looks; k += 1) {
      const index = Math.floor(this.random() * habitats.length);
      const spot = habitats.splice(index, 1)[0];
      goals.push({ kind: "habitat", target: spot.tile, at: this.pick(spot.access) });
    }
    const add = (kind: Goal["kind"], chance: number, position = -1) => {
      const list = s.spots[kind as ParkObject] ?? [];
      if (list.length === 0 || this.random() >= chance) return;
      const spot = this.pick(list);
      if (spot.access.length === 0) return;
      const goal = { kind, target: spot.tile, at: this.pick(spot.access) };
      if (position < 0 || position >= goals.length) goals.push(goal);
      else goals.splice(position, 0, goal);
    };
    // Open roller coasters pull people in: the more exciting, the more want to ride.
    for (const ride of s.rides) {
      if (ride.state !== "open" || ride.excitement <= 0 || ride.access.length === 0) continue;
      if (this.random() >= Math.min(0.85, 0.25 + ride.excitement * 0.06)) continue;
      const goal: Goal = { kind: "ride", ride: ride.id, target: ride.station[0], at: this.pick(ride.access) };
      goals.splice(Math.min(goals.length, 1 + Math.floor(this.random() * 2)), 0, goal);
    }
    add("drink", 0.5, 1);
    add("food", 0.55, 2);
    add("bin", 0.5, 3);
    add("bench", 0.4, 3);
    add("toilet", 0.15, 1);
    add("souvenir", 0.3);
    goals.push({ kind: "exit", target: this.entrance, at: this.entrance });
    return goals;
  }

  private routeTo(walker: Walker, from: number): void {
    const goal = walker.goals[0];
    const route = goal && this.summary ? findPath(this.summary.grid, from, goal.at) : null;
    if (!route) {
      walker.goals.shift();
      if (walker.goals.length === 0) walker.state = "gone";
      walker.route = [from];
      walker.leg = 0;
      walker.progress = 0;
      return;
    }
    walker.route = route;
    walker.leg = 0;
    walker.progress = 0;
  }

  private spawn(): void {
    const id = this.seq++;
    const { x, y } = parkXY(this.entrance);
    const walker: Walker = {
      id,
      x: x + 0.5,
      y: y + 0.5,
      heading: 0,
      route: [this.entrance],
      leg: 0,
      progress: 0,
      goals: this.plan(),
      state: "walk",
      wait: 0,
      faceX: x + 0.5,
      faceY: y,
      lane: (this.random() - 0.5) * 0.7,
      color: Math.floor(this.random() * 8),
      speed: 1.05 + this.random() * 0.45,
      looking: -1,
    };
    this.routeTo(walker, this.entrance);
    this.walkers.push(walker);
  }

  /** Run the crowd for a while without effects, so an opened park is already busy. */
  prewarm(seconds: number, want: number): void {
    for (let t = 0; t < seconds; t += 0.25) this.update(0.25, want);
  }

  /** Advance by dt seconds toward `want` visitors in the park. Returns what happened. */
  update(dt: number, want: number): CrowdEvent[] {
    const events: CrowdEvent[] = [];
    const s = this.summary;
    if (!s) return events;
    const open = s.habitats.length > 0;
    const active = this.walkers.filter((walker) => walker.state !== "gone").length;
    this.spawnIn -= dt;
    if (open && active < want && this.spawnIn <= 0) {
      this.spawn();
      this.spawnIn = (active < want / 2 ? 0.12 : 0.35) + this.random() * 0.4;
    }
    for (const walker of this.walkers) {
      if (walker.state === "gone") continue;
      if (walker.state !== "walk") {
        walker.wait -= dt;
        if (walker.wait > 0) continue;
        walker.state = "walk";
        walker.looking = -1;
        const here = walker.route[walker.route.length - 1];
        walker.goals.shift();
        if (walker.goals.length === 0) {
          walker.state = "gone";
          continue;
        }
        this.routeTo(walker, here);
        continue;
      }
      let move = dt * walker.speed;
      while (move > 0 && walker.state === "walk") {
        if (walker.leg >= walker.route.length - 1) {
          this.arrive(walker, events);
          break;
        }
        const a = parkXY(walker.route[walker.leg]);
        const b = parkXY(walker.route[walker.leg + 1]);
        const step = Math.min(move, 1 - walker.progress);
        walker.progress += step;
        move -= step;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        walker.heading = Math.atan2(dx, dy);
        walker.x = a.x + 0.5 + dx * walker.progress - dy * walker.lane;
        walker.y = a.y + 0.5 + dy * walker.progress + dx * walker.lane;
        if (walker.progress >= 1) {
          walker.leg += 1;
          walker.progress = 0;
        }
      }
    }
    if (this.walkers.length > 64 && this.walkers.some((walker) => walker.state === "gone")) {
      const keep = this.walkers.filter((walker) => walker.state !== "gone");
      this.walkers.length = 0;
      this.walkers.push(...keep);
    }
    return events;
  }

  private arrive(walker: Walker, events: CrowdEvent[]): void {
    const goal = walker.goals[0];
    if (!goal || goal.kind === "exit") {
      walker.state = "gone";
      return;
    }
    const target = goal.kind === "habitat" ? { x: parkXY(goal.target).x + HABITAT_TILES / 2, y: parkXY(goal.target).y + HABITAT_TILES / 2 } : { x: parkXY(goal.target).x + 0.5, y: parkXY(goal.target).y + 0.5 };
    walker.faceX = target.x;
    walker.faceY = target.y;
    walker.heading = Math.atan2(target.x - walker.x, target.y - walker.y);
    if (goal.kind === "habitat") {
      walker.state = "look";
      walker.wait = 2.5 + this.random() * 3;
      walker.looking = goal.target;
      events.push({ type: "look", habitat: goal.target, walker: walker.id, love: this.random() < 0.45 });
    } else if (goal.kind === "food" || goal.kind === "drink" || goal.kind === "souvenir") {
      walker.state = "buy";
      walker.wait = 1.2 + this.random();
      const price = standPrice(this.prices, goal.target, goal.kind);
      // Too expensive: they look at the board and walk on.
      const refused = this.random() > Math.min(1, priceFactor(price, PARK_INFO[goal.kind].price));
      if (refused) walker.wait = 0.9;
      events.push({ type: "buy", kind: goal.kind, tile: goal.target, price, walker: walker.id, ...(refused ? { refused } : {}) });
    } else if (goal.kind === "ride") {
      const ride = this.summary?.rides.find((entry) => entry.id === goal.ride);
      walker.state = "buy";
      if (!ride) {
        walker.wait = 0.5;
        return;
      }
      const fair = rideFair(ride.excitement);
      const roll = this.random();
      let mood: RideMood;
      if (this.random() > Math.min(1, priceFactor(ride.price, fair))) mood = "pricey";
      else if (roll < ride.nausea / 14) mood = "queasy";
      else if (ride.excitement >= 5.5 && roll > 0.3) mood = "thrilled";
      else mood = "happy";
      // Queue, ride and climb out (or just read the price board and walk on).
      walker.wait = mood === "pricey" ? 1 : 3 + this.random() * 2.5;
      events.push({ type: "ride", ride: ride.id, tile: goal.target, price: mood === "pricey" ? 0 : ride.price, walker: walker.id, mood });
    } else if (goal.kind === "bench") {
      walker.state = "sit";
      walker.wait = 4 + this.random() * 4;
      events.push({ type: "sit", tile: goal.target, walker: walker.id });
    } else {
      walker.state = "buy";
      walker.wait = 0.8;
    }
  }
}
