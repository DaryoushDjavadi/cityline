export const POWER_BIT = 1;
export const WATER_BIT = 2;

export const Zone = {
  None: 0,
  Residential: 1,
  Commercial: 2,
  Industrial: 3,
  Farm: 4,
} as const;

export type ZoneId = (typeof Zone)[keyof typeof Zone];

export const ServiceKind = {
  None: 0,
  Power: 1,
  Water: 2,
  School: 3,
  Clinic: 4,
  Police: 5,
  Fire: 6,
  Park: 7,
  University: 8,
  Airport: 9,
} as const;

export type ServiceId = (typeof ServiceKind)[keyof typeof ServiceKind];

export interface Demand {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface CityStats {
  population: number;
  jobs: number;
  powerCapacity: number;
  powerUsed: number;
  waterCapacity: number;
  waterUsed: number;
  traffic: number;
  funds: number;
  foodCapacity: number;
  foodUsed: number;
  foodStock: number;
}

export interface CityState {
  width: number;
  height: number;
  tick: number;
  revision: number;
  rng: number;
  funds: number;
  /** Low nibble: N=1 E=2 S=4 W=8. Bit 4 marks a road cell. */
  roads: Uint8Array;
  zones: Uint8Array;
  levels: Uint8Array;
  /** Bit 0 power, bit 1 water. On lines or pipes this means the network reaches the cell. */
  utility: Uint8Array;
  services: Uint8Array;
  /** Power cables. Same bitmask as roads. */
  lines: Uint8Array;
  /** Water pipes. Same bitmask as roads. */
  pipes: Uint8Array;
  /** Maintenance budget, 50–150. 0 means the default of 100. */
  budget: Uint8Array;
  /** Bits 0–1 education, bit 2 paid scholarship. */
  skills: Uint8Array;
  /** 1 = lake or river. Building clears trees, not this water. */
  terrain: Uint8Array;
  /** Per home, POST_SLOTS adults. 0 = unemployed, otherwise workplace index + 1. */
  posts: Uint16Array;
  demand: Demand;
  /** Bits of city contracts already paid. */
  goals: number;
  /** Stadtweiter Nahrungsspeicher aus Bauernhöfen und Import. */
  food: number;
}

export type Command =
  | { type: "road"; cells: number[] }
  | { type: "bridge"; cells: number[] }
  | { type: "fill"; cells: number[] }
  | { type: "build"; cells: number[]; kind: string }
  | { type: "zone"; cells: number[]; zone: ZoneId }
  | { type: "bulldoze"; cells: number[] }
  | { type: "line"; cells: number[] }
  | { type: "pipe"; cells: number[] }
  | { type: "service"; index: number; kind: ServiceId }
  | { type: "budget"; index: number; value: number }
  | { type: "gift"; index: number }
  | { type: "hire"; workplace: number; home: number; slot: number }
  | { type: "trade"; index: number; deal: string };

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  spent: number;
  applied: number[];
  rejected: number[];
  bonus?: number;
}

export interface SimMeta {
  tick: number;
  revision: number;
  rng: number;
  funds: number;
  demand: Demand;
  stats: CityStats;
  ledger: { income: number; upkeep: number };
  goals: number;
  food: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  slot: number;
  lookX: number;
  lookZ: number;
}

export const POST_SLOTS = 8;
export const CELL_STRIDE = 10;
const LEGACY_STRIDE = 5;

export function packCells(state: CityState): Uint8Array {
  const count = state.width * state.height;
  const cells = count * CELL_STRIDE;
  const out = new Uint8Array(cells + state.posts.length * 2);
  for (let index = 0; index < count; index += 1) {
    const offset = index * CELL_STRIDE;
    out[offset] = state.roads[index];
    out[offset + 1] = state.zones[index];
    out[offset + 2] = state.levels[index];
    out[offset + 3] = state.utility[index];
    out[offset + 4] = state.services[index];
    out[offset + 5] = state.lines[index];
    out[offset + 6] = state.pipes[index];
    out[offset + 7] = state.budget[index];
    out[offset + 8] = state.skills[index];
    out[offset + 9] = state.terrain[index];
  }
  const view = new DataView(out.buffer);
  for (let index = 0; index < state.posts.length; index += 1) view.setUint16(cells + index * 2, state.posts[index], true);
  return out;
}

export function unpackCells(state: CityState, packed: Uint8Array): void {
  const count = state.width * state.height;
  const stride = packed.length === count * LEGACY_STRIDE ? LEGACY_STRIDE : packed.length === count * 8 ? 8 : packed.length === count * 9 ? 9 : CELL_STRIDE;
  if (packed.length < count * stride) return;
  for (let index = 0; index < count; index += 1) {
    const offset = index * stride;
    state.roads[index] = packed[offset];
    state.zones[index] = packed[offset + 1];
    state.levels[index] = packed[offset + 2];
    state.utility[index] = packed[offset + 3];
    state.services[index] = packed[offset + 4];
    state.lines[index] = stride < 8 ? 0 : packed[offset + 5];
    state.pipes[index] = stride < 8 ? 0 : packed[offset + 6];
    state.budget[index] = stride < 8 ? 100 : packed[offset + 7];
    state.skills[index] = stride < 9 ? 0 : packed[offset + 8];
    state.terrain[index] = stride < 10 ? 0 : packed[offset + 9];
  }
  const tail = packed.length - count * stride;
  state.posts.fill(0);
  if (tail !== count * POST_SLOTS * 2) return;
  const view = new DataView(packed.buffer, packed.byteOffset + count * stride, tail);
  for (let index = 0; index < state.posts.length; index += 1) state.posts[index] = view.getUint16(index * 2, true);
}

export function writeCity(state: CityState, packed: Uint8Array, meta: SimMeta): void {
  unpackCells(state, packed);
  state.tick = meta.tick;
  state.revision = meta.revision;
  state.rng = meta.rng;
  state.funds = meta.funds;
  state.demand.residential = meta.demand.residential;
  state.demand.commercial = meta.demand.commercial;
  state.demand.industrial = meta.demand.industrial;
  if (typeof meta.goals === "number") state.goals = meta.goals >>> 0;
  state.food = typeof meta.food === "number" && Number.isFinite(meta.food) ? Math.max(0, Math.min(200, Math.floor(meta.food))) : 0;
}

export function asUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
