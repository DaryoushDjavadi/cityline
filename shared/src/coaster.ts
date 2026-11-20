/**
 * Small roller coasters in the Tierpark (RollerCoaster-Tycoon style, kept tiny): a 3-tile station
 * and track pieces appended one by one on the park tile grid. Pure and deterministic, so the
 * server, the solo worker, coop clients and tests agree on where a coaster stands, its smooth 3D
 * track, the train physics (gravity, friction, chain lift) and the ratings
 * (Aufregung / Intensität / Übelkeit).
 *
 * Units: tile grid like park.ts; world positions like the park scene (2 units per tile, park
 * centred on 0); one world unit ≈ 1.8 m for speeds and heights shown to the player.
 */
import {
  PARK_SIZE,
  PARK_TILE,
  PARK_TILES,
  PRICE_MAX,
  TILE,
  inPark,
  occupancy,
  parkIndex,
  parkXY,
  walkable,
  type ParkHabitatRef,
  type ParkState,
  type RideRef,
  type RideState,
  type TrackTile,
} from "./park.ts";

export type PieceKind = "straight" | "left" | "right" | "up" | "down" | "loop";
export const PIECE_KINDS: PieceKind[] = ["straight", "left", "right", "up", "down", "loop"];

export const PIECE_INFO: Record<PieceKind, { name: string; icon: string; cost: number; blurb: string }> = {
  straight: { name: "Gerade", icon: "⬆️", cost: 60, blurb: "Ein Feld geradeaus." },
  left: { name: "Kurve links", icon: "↰", cost: 80, blurb: "Viertelkreis nach links." },
  right: { name: "Kurve rechts", icon: "↱", cost: 80, blurb: "Viertelkreis nach rechts." },
  up: { name: "Steigung", icon: "⛓️", cost: 120, blurb: "Kettenlift: zieht den Zug eine Stufe höher." },
  down: { name: "Abfahrt", icon: "⤵️", cost: 100, blurb: "Steile Abfahrt, zwei Stufen tiefer." },
  loop: { name: "Looping", icon: "➰", cost: 600, blurb: "Senkrechter Looping über zwei Felder. Braucht Schwung." },
};

export const STATION_COST = 1500;
export const STATION_LEN = 3;
export const MAX_PIECES = 80;
export const MAX_COASTERS = 4;
/** Highest track level (one level = LEVEL_H world units). */
export const MAX_LEVEL = 8;
export const LEVEL_H = 1.25;
/** From this level on the track is high enough to cross a path. */
export const CLEAR_LEVEL = 2;
/** Track height above the ground at level 0 (on short posts). */
export const TRACK_Y = 0.55;
export const UNIT_M = 1.8;
export const DEFAULT_RIDE_PRICE = 5;
const G = 9.81 / UNIT_M;
const LIFT_V = 2.2;
const STATION_V = 2.4;
const LOOP_R = 1.9;
const LOOP_W = 0.9;
const FORCE_SCALE = 0.22;

export interface CoasterStats {
  excitement: number;
  intensity: number;
  nausea: number;
  maxKmh: number;
  /** One lap (station to station) in seconds. */
  lapSec: number;
  /** Track length in metres. */
  length: number;
  maxHeight: number;
  maxDrop: number;
  drops: number;
  loops: number;
  turns: number;
  /** Peak vertical / lateral g. */
  maxG: number;
  latG: number;
}

export interface Coaster {
  id: number;
  name: string;
  /** First station tile; the station runs STATION_LEN tiles in `dir`. */
  station: number;
  /** 0 = north (−y), 1 = east, 2 = south, 3 = west. */
  dir: number;
  pieces: PieceKind[];
  state: RideState;
  price: number;
  /** Ratings from the last successful test run (gone when the track changes). */
  stats?: CoasterStats;
  /** Totals. */
  riders: number;
  revenue: number;
}

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
export const DIR_NAMES = ["Norden", "Osten", "Süden", "Westen"];

export interface Cursor {
  x: number;
  y: number;
  dir: number;
  /** Level at the start of the next piece. */
  h: number;
}

export interface CoasterLayout {
  /** Station tiles then one entry per piece tile (low = lowest track level on it). */
  tiles: { tile: number; low: number; piece: number }[];
  cursor: Cursor;
  closed: boolean;
  /** Pieces that fit (a save could hold more that no longer do). */
  valid: number;
  error: string | null;
}

export function stationTiles(station: number, dir: number): number[] {
  const { x, y } = parkXY(station);
  const out: number[] = [];
  for (let k = 0; k < STATION_LEN; k += 1) {
    const nx = x + DX[dir] * k;
    const ny = y + DY[dir] * k;
    if (!inPark(nx, ny)) return [];
    out.push(parkIndex(nx, ny));
  }
  return out;
}

/** Tiles a piece covers from a cursor and where the next piece starts, or null if it cannot go there. */
export function pieceStep(c: Cursor, kind: PieceKind): { tiles: { x: number; y: number; low: number }[]; next: Cursor } | null {
  const { x, y, dir, h } = c;
  const at = { x, y, low: h };
  switch (kind) {
    case "straight":
      return { tiles: [at], next: { x: x + DX[dir], y: y + DY[dir], dir, h } };
    case "left":
    case "right": {
      const d = (dir + (kind === "right" ? 1 : 3)) % 4;
      return { tiles: [at], next: { x: x + DX[d], y: y + DY[d], dir: d, h } };
    }
    case "up":
      if (h >= MAX_LEVEL) return null;
      return { tiles: [at], next: { x: x + DX[dir], y: y + DY[dir], dir, h: h + 1 } };
    case "down": {
      if (h <= 0) return null;
      const low = Math.max(0, h - 2);
      return { tiles: [{ x, y, low }], next: { x: x + DX[dir], y: y + DY[dir], dir, h: low } };
    }
    case "loop":
      return { tiles: [at, { x: x + DX[dir], y: y + DY[dir], low: h }], next: { x: x + 2 * DX[dir], y: y + 2 * DY[dir], dir, h } };
  }
}

/** Why a tile cannot take track at a level (null = fine). `grid` comes from blockGrid. */
export function tileBlocked(grid: Uint8Array, tile: number, low: number): string | null {
  const code = grid[tile];
  if (code === TILE.grass) return null;
  if (code === TILE.path && low >= CLEAR_LEVEL) return null;
  if (code === TILE.path) return "coaster_path_low";
  if (code === TILE.habitat) return "coaster_habitat";
  if (code === TILE.coaster) return "coaster_track";
  return "coaster_blocked";
}

/** Occupancy for building one coaster: everything else (habitats, objects, other coasters) blocks. */
export function blockGrid(park: ParkState, habitats: ParkHabitatRef[], coasters: Coaster[], except = -1): Uint8Array {
  const others = coasters.filter((coaster) => coaster.id !== except);
  const grid = occupancy(park, habitats, rideRefs(others));
  for (const coaster of others) for (const entry of coasterLayout(coaster).tiles) grid[entry.tile] = TILE.coaster;
  return grid;
}

/** Can a station go here? Returns a reason or null. */
export function stationProblem(grid: Uint8Array, station: number, dir: number): string | null {
  if (!Number.isInteger(station) || station < 0 || station >= PARK_TILES || !Number.isInteger(dir) || dir < 0 || dir > 3) return "coaster_blocked";
  const tiles = stationTiles(station, dir);
  if (tiles.length < STATION_LEN) return "coaster_edge";
  if (tiles.some((tile) => grid[tile] !== TILE.grass)) return "coaster_blocked";
  // The first track tile after the station must be on the park too.
  const first = parkXY(tiles[STATION_LEN - 1]);
  if (!inPark(first.x + DX[dir], first.y + DY[dir])) return "coaster_edge";
  for (const tile of tiles) {
    const { x, y } = parkXY(tile);
    for (let d = 0; d < 4; d += 1) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (inPark(nx, ny) && walkable(grid[parkIndex(nx, ny)])) return null;
    }
  }
  return "coaster_no_path";
}

/**
 * Walk the pieces from the station: tiles, the open end (cursor) and whether the circuit is closed.
 * With a grid, pieces must also fit there (building); without one only the geometry is checked.
 */
export function coasterLayout(coaster: Pick<Coaster, "station" | "dir" | "pieces">, grid?: Uint8Array): CoasterLayout {
  const station = stationTiles(coaster.station, coaster.dir);
  const tiles = station.map((tile) => ({ tile, low: 0, piece: -1 }));
  const used = new Set(station);
  const end = parkXY(station[station.length - 1] ?? coaster.station);
  let cursor: Cursor = { x: end.x + DX[coaster.dir], y: end.y + DY[coaster.dir], dir: coaster.dir, h: 0 };
  const start = parkXY(coaster.station);
  let closed = false;
  let valid = 0;
  let error: string | null = station.length < STATION_LEN ? "coaster_edge" : null;
  for (let index = 0; index < coaster.pieces.length && !error; index += 1) {
    if (closed) {
      error = "coaster_closed";
      break;
    }
    const step = pieceStep(cursor, coaster.pieces[index]);
    if (!step) {
      error = coaster.pieces[index] === "up" ? "coaster_high" : "coaster_low";
      break;
    }
    for (const t of step.tiles) {
      if (!inPark(t.x, t.y)) error = "coaster_edge";
      else {
        const tile = parkIndex(t.x, t.y);
        if (used.has(tile)) error = "coaster_cross";
        else if (grid) error = tileBlocked(grid, tile, t.low);
      }
      if (error) break;
    }
    if (error) break;
    for (const t of step.tiles) {
      const tile = parkIndex(t.x, t.y);
      used.add(tile);
      tiles.push({ tile, low: t.low, piece: index });
    }
    cursor = step.next;
    valid = index + 1;
    closed = cursor.x === start.x && cursor.y === start.y && cursor.dir === coaster.dir && cursor.h === 0;
  }
  return { tiles, cursor, closed, valid, error };
}

/** Tiles a coaster takes in the park (paths may stay under high track). */
export function trackTiles(coaster: Coaster): TrackTile[] {
  return coasterLayout(coaster).tiles.map((entry) => ({ tile: entry.tile, high: entry.low >= CLEAR_LEVEL }));
}

export function rideRefs(coasters: Coaster[] | undefined): RideRef[] {
  return (coasters ?? []).map((coaster) => ({
    id: coaster.id,
    station: stationTiles(coaster.station, coaster.dir),
    track: trackTiles(coaster),
    state: coaster.state,
    price: coaster.price,
    excitement: coaster.stats?.excitement ?? 0,
    intensity: coaster.stats?.intensity ?? 0,
    nausea: coaster.stats?.nausea ?? 0,
  }));
}

/** Coaster whose station or track covers a tile. */
export function coasterAtTile(coasters: Coaster[] | undefined, tile: number): Coaster | null {
  for (const coaster of coasters ?? []) if (coasterLayout(coaster).tiles.some((entry) => entry.tile === tile)) return coaster;
  return null;
}

export function coasterCost(coaster: Pick<Coaster, "pieces">): number {
  return STATION_COST + coaster.pieces.reduce((sum, piece) => sum + PIECE_INFO[piece].cost, 0);
}

// ---------------------------------------------------------------- closing helper

/**
 * Pieces that lead from the open end back into the station (arriving level, in its direction),
 * avoiding blocked tiles; null when there is no way (or it would need more than `max` pieces).
 */
export function closeRoute(coaster: Pick<Coaster, "station" | "dir" | "pieces">, grid: Uint8Array, max = 40): PieceKind[] | null {
  const layout = coasterLayout(coaster, grid);
  if (layout.error || layout.closed) return layout.closed ? [] : null;
  const used = new Set(layout.tiles.map((entry) => entry.tile));
  const start = parkXY(coaster.station);
  const key = (c: Cursor) => ((c.y * PARK_SIZE + c.x) * 4 + c.dir) * (MAX_LEVEL + 1) + c.h;
  const goal = key({ x: start.x, y: start.y, dir: coaster.dir, h: 0 });
  const cost = new Map<number, number>();
  const prev = new Map<number, { from: number; piece: PieceKind; cursor: Cursor }>();
  const cursors = new Map<number, Cursor>();
  const weights: Partial<Record<PieceKind, number>> = { straight: 1, left: 1.1, right: 1.1, down: 1.15, up: 1.6 };
  const startKey = key(layout.cursor);
  cost.set(startKey, 0);
  cursors.set(startKey, layout.cursor);
  // Small Dijkstra (open list scan; the state space is tiny and most states are unreachable).
  const open = new Set([startKey]);
  let expanded = 0;
  while (open.size > 0 && expanded < 20000) {
    let best = -1;
    let bestCost = Infinity;
    for (const k of open) {
      const c = cost.get(k)!;
      if (c < bestCost) {
        bestCost = c;
        best = k;
      }
    }
    open.delete(best);
    expanded += 1;
    if (best === goal) break;
    const at = cursors.get(best)!;
    for (const piece of ["straight", "left", "right", "down", "up"] as PieceKind[]) {
      const step = pieceStep(at, piece);
      if (!step) continue;
      if (step.tiles.some((t) => !inPark(t.x, t.y) || used.has(parkIndex(t.x, t.y)) || tileBlocked(grid, parkIndex(t.x, t.y), t.low))) continue;
      const k = key(step.next);
      const next = bestCost + weights[piece]!;
      if (next >= (cost.get(k) ?? Infinity)) continue;
      if (next > max) continue;
      cost.set(k, next);
      cursors.set(k, step.next);
      prev.set(k, { from: best, piece, cursor: step.next });
      open.add(k);
    }
  }
  if (!prev.has(goal)) return null;
  const out: PieceKind[] = [];
  let k = goal;
  while (k !== startKey) {
    const p = prev.get(k)!;
    out.push(p.piece);
    k = p.from;
  }
  out.reverse();
  // The search does not remember its own tiles: make sure the route does not cross itself.
  const check = coasterLayout({ ...coaster, pieces: [...coaster.pieces, ...out] }, grid);
  return check.closed && !check.error ? out : null;
}

/** Plain-language hint how far the open end is from the station entry. */
export function closeHint(coaster: Pick<Coaster, "station" | "dir" | "pieces">): string {
  const layout = coasterLayout(coaster);
  if (layout.closed) return "Rundkurs geschlossen.";
  const start = parkXY(coaster.station);
  // The track must arrive on the tile before the station, heading in the station direction.
  const ex = start.x - DX[coaster.dir];
  const ey = start.y - DY[coaster.dir];
  const c = layout.cursor;
  const parts: string[] = [];
  const dx = ex - c.x;
  const dy = ey - c.y;
  if (dy) parts.push(`${Math.abs(dy)} ${dy < 0 ? "nach Norden" : "nach Süden"}`);
  if (dx) parts.push(`${Math.abs(dx)} ${dx < 0 ? "nach Westen" : "nach Osten"}`);
  const where = parts.length ? `Noch ${parts.join(", ")} bis vor die Station` : "Direkt vor der Station";
  const height = c.h > 0 ? `, ${c.h} ${c.h === 1 ? "Stufe" : "Stufen"} runter` : "";
  return `${where}${height}, dann nach ${DIR_NAMES[coaster.dir]} einfahren.`;
}

// ---------------------------------------------------------------- 3D track

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  /** Arc length from the station start. */
  s: number;
  /** Unit tangent and track "up" (towards the riders' heads). */
  t: [number, number, number];
  up: [number, number, number];
  /** Station or chain lift (the train is pulled). */
  lift: boolean;
  station: boolean;
  /** Piece index (−1 = station). */
  piece: number;
}

export interface TrackPath {
  points: TrackPoint[];
  length: number;
  closed: boolean;
}

const HALF = (PARK_SIZE * PARK_TILE) / 2;
const pathCache = new Map<string, TrackPath>();

function tileCentre(x: number, y: number): { x: number; z: number } {
  return { x: (x + 0.5) * PARK_TILE - HALF, z: (y + 0.5) * PARK_TILE - HALF };
}

/** The smooth centre line of a coaster (world units), sampled about every 0.25 units. */
export function trackPath(coaster: Pick<Coaster, "station" | "dir" | "pieces">): TrackPath {
  const cacheKey = `${coaster.station}:${coaster.dir}:${coaster.pieces.join(",")}`;
  const hit = pathCache.get(cacheKey);
  if (hit) return hit;
  const layout = coasterLayout(coaster);
  const pieces = coaster.pieces.slice(0, layout.valid);
  type Raw = { x: number; y: number; z: number; fixed: boolean; lift: boolean; station: boolean; piece: number; up?: [number, number, number]; bank: number };
  const raw: Raw[] = [];
  const half = PARK_TILE / 2;
  // Station: straight, level, from the entry edge of its first tile.
  const s0 = parkXY(coaster.station);
  const c0 = tileCentre(s0.x, s0.y);
  const f0 = { x: DX[coaster.dir], z: DY[coaster.dir] };
  for (let k = 0; k < STATION_LEN * 8; k += 1) {
    const d = (k / 8) * PARK_TILE;
    raw.push({ x: c0.x - f0.x * half + f0.x * d, y: TRACK_Y, z: c0.z - f0.z * half + f0.z * d, fixed: true, lift: true, station: true, piece: -1, bank: 0 });
  }
  const end = parkXY(stationTiles(coaster.station, coaster.dir)[STATION_LEN - 1] ?? coaster.station);
  let cursor: Cursor = { x: end.x + DX[coaster.dir], y: end.y + DY[coaster.dir], dir: coaster.dir, h: 0 };
  pieces.forEach((piece, index) => {
    const step = pieceStep(cursor, piece)!;
    const c = tileCentre(cursor.x, cursor.y);
    const f = { x: DX[cursor.dir], z: DY[cursor.dir] };
    // Right-hand side in the park plane (x east, z south): north (0,−1) → east (1,0).
    const r = { x: -f.z, z: f.x };
    const e = { x: c.x - f.x * half, z: c.z - f.z * half };
    const h0 = TRACK_Y + cursor.h * LEVEL_H;
    const h1 = TRACK_Y + step.next.h * LEVEL_H;
    if (piece === "loop") {
      const n = 48;
      const L = 2 * PARK_TILE;
      for (let k = 0; k < n; k += 1) {
        const t = k / n;
        const th = t * Math.PI * 2;
        const fwd = L * t + LOOP_R * Math.sin(th);
        const side = (LOOP_W * (1 - Math.cos(th))) / 2;
        const up: [number, number, number] = [-f.x * Math.sin(th), Math.cos(th), -f.z * Math.sin(th)];
        raw.push({ x: e.x + f.x * fwd + r.x * side, y: h0 + LOOP_R * (1 - Math.cos(th)), z: e.z + f.z * fwd + r.z * side, fixed: k > 0, lift: false, station: false, piece: index, up, bank: 0 });
      }
    } else if (piece === "left" || piece === "right") {
      const sign = piece === "right" ? 1 : -1;
      const centre = { x: e.x + r.x * half * sign, z: e.z + r.z * half * sign };
      const n = 10;
      for (let k = 0; k < n; k += 1) {
        const th = (k / n) * (Math.PI / 2);
        raw.push({
          x: centre.x - r.x * sign * half * Math.cos(th) + f.x * half * Math.sin(th),
          y: h0,
          z: centre.z - r.z * sign * half * Math.cos(th) + f.z * half * Math.sin(th),
          fixed: false,
          lift: false,
          station: false,
          piece: index,
          bank: sign,
        });
      }
    } else {
      const n = 8;
      for (let k = 0; k < n; k += 1) {
        const t = k / n;
        raw.push({ x: e.x + f.x * PARK_TILE * t, y: h0 + (h1 - h0) * t, z: e.z + f.z * PARK_TILE * t, fixed: false, lift: piece === "up", station: false, piece: index, bank: 0 });
      }
    }
    cursor = step.next;
  });
  if (!layout.closed) {
    // Open end: one last point at the cursor's entry edge.
    const c = tileCentre(cursor.x, cursor.y);
    raw.push({ x: c.x - DX[cursor.dir] * half, y: TRACK_Y + cursor.h * LEVEL_H, z: c.z - DY[cursor.dir] * half, fixed: true, lift: false, station: false, piece: pieces.length - 1, bank: 0 });
  }
  const n = raw.length;
  const closed = layout.closed;
  // Round off the height profile (crests, valleys, lift ends); loops and the station keep their shape.
  for (let pass = 0; pass < 10; pass += 1) {
    const ys = raw.map((p) => p.y);
    for (let i = 0; i < n; i += 1) {
      if (raw[i].fixed) continue;
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      raw[i].y = (ys[a] + 2 * ys[i] + ys[b]) / 4;
    }
  }
  // Banking spreads a little past the curve ends.
  const bank = raw.map((p) => p.bank);
  for (let pass = 0; pass < 3; pass += 1) {
    const copy = [...bank];
    for (let i = 0; i < n; i += 1) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      bank[i] = (copy[a] + 2 * copy[i] + copy[b]) / 4;
    }
  }
  const points: TrackPoint[] = [];
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const p = raw[i];
    if (i > 0) s += Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y, p.z - raw[i - 1].z);
    const a = closed ? raw[(i - 1 + n) % n] : raw[Math.max(0, i - 1)];
    const b = closed ? raw[(i + 1) % n] : raw[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    let up: [number, number, number];
    if (p.up) up = p.up;
    else {
      // Bank into curves: tilt "up" toward the inside (the right-hand side for right turns).
      const rx = -tz;
      const rz = tx;
      const rl = Math.hypot(rx, rz) || 1;
      const k = bank[i] * 0.42;
      up = [(rx / rl) * Math.sin(k), Math.cos(k), (rz / rl) * Math.sin(k)];
    }
    const dot = up[0] * tx + up[1] * ty + up[2] * tz;
    let ux = up[0] - tx * dot;
    let uy = up[1] - ty * dot;
    let uz = up[2] - tz * dot;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    points.push({ x: p.x, y: p.y, z: p.z, s, t: [tx, ty, tz], up: [ux, uy, uz], lift: p.lift, station: p.station, piece: p.piece });
  }
  let length = s;
  if (closed && n > 1) length += Math.hypot(raw[0].x - raw[n - 1].x, raw[0].y - raw[n - 1].y, raw[0].z - raw[n - 1].z);
  const path = { points, length, closed };
  if (pathCache.size > 48) pathCache.delete(pathCache.keys().next().value!);
  pathCache.set(cacheKey, path);
  return path;
}

/** Position on the path at arc length s (wraps on closed tracks). */
export function pointAt(path: TrackPath, s: number): { x: number; y: number; z: number; t: [number, number, number]; up: [number, number, number]; i: number } {
  const pts = path.points;
  if (pts.length === 0) return { x: 0, y: 0, z: 0, t: [0, 0, 1], up: [0, 1, 0], i: 0 };
  if (path.closed) s = ((s % path.length) + path.length) % path.length;
  else s = Math.max(0, Math.min(pts[pts.length - 1].s, s));
  // Binary search for the segment.
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = lo + 1 < pts.length ? pts[lo + 1] : path.closed ? pts[0] : a;
  const segEnd = lo + 1 < pts.length ? b.s : path.length;
  const k = segEnd > a.s ? (s - a.s) / (segEnd - a.s) : 0;
  const mix = (u: number, v: number) => u + (v - u) * k;
  const t: [number, number, number] = [mix(a.t[0], b.t[0]), mix(a.t[1], b.t[1]), mix(a.t[2], b.t[2])];
  const up: [number, number, number] = [mix(a.up[0], b.up[0]), mix(a.up[1], b.up[1]), mix(a.up[2], b.up[2])];
  const tl = Math.hypot(...t) || 1;
  const ul = Math.hypot(...up) || 1;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), t: [t[0] / tl, t[1] / tl, t[2] / tl], up: [up[0] / ul, up[1] / ul, up[2] / ul], i: lo };
}

// ---------------------------------------------------------------- physics & ratings

export interface RideRun {
  ok: boolean;
  /** Why the train did not make it ("coaster_open" = not a closed circuit, "coaster_stall"). */
  reason: string | null;
  /** Speed (world units/s) at every path point. */
  speed: number[];
  lapSec: number;
  stallAt: number;
}

/**
 * One lap from the station: gravity, rolling friction and air drag; the station tyres and chain
 * lifts pull the train at a steady speed. The train stalls when it runs out of speed elsewhere.
 */
export function simulate(path: TrackPath): RideRun {
  const pts = path.points;
  const speed: number[] = new Array(pts.length).fill(0);
  if (!path.closed || pts.length < 4) return { ok: false, reason: "coaster_open", speed, lapSec: 0, stallAt: -1 };
  let v = STATION_V;
  let time = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    if (p.station) v = STATION_V;
    else if (p.lift) v = Math.max(v, LIFT_V);
    speed[i] = v;
    const q = i + 1 < pts.length ? pts[i + 1] : pts[0];
    const ds = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    const dy = q.y - p.y;
    let v2 = v * v - 2 * G * dy - 2 * (0.012 * G + 0.0022 * v * v) * ds;
    const lifted = q.lift || q.station;
    if (v2 <= 0.02 && !lifted) return { ok: false, reason: "coaster_stall", speed, lapSec: 0, stallAt: i };
    v2 = Math.max(v2, 0.02);
    const nv = Math.sqrt(v2);
    time += ds / Math.max(0.3, (v + nv) / 2);
    v = nv;
  }
  return { ok: true, reason: null, speed, lapSec: Math.round(time * 10) / 10, stallAt: -1 };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp10 = (value: number) => round2(Math.max(0, Math.min(10, value)));

/**
 * RCT-style ratings from a successful run: speed, drops, loops, curves, g-forces, height, length
 * and nearby scenery (habitats, trees and flower beds within a few tiles of the track).
 */
export function rateCoaster(coaster: Pick<Coaster, "station" | "dir" | "pieces">, scenery: number): CoasterStats | null {
  const path = trackPath(coaster);
  const run = simulate(path);
  if (!run.ok) return null;
  const pts = path.points;
  const n = pts.length;
  let maxV = 0;
  let maxG = 1;
  let latG = 0;
  let maxHeight = 0;
  for (let i = 0; i < n; i += 1) {
    const v = run.speed[i];
    maxV = Math.max(maxV, v);
    maxHeight = Math.max(maxHeight, pts[i].y);
    const a = pts[(i - 3 + n) % n];
    const b = pts[(i + 3) % n];
    const ds = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (ds < 1e-3) continue;
    // Curvature vector × v² = acceleration; felt force = acceleration + gravity reaction.
    const kx = (b.t[0] - a.t[0]) / ds;
    const ky = (b.t[1] - a.t[1]) / ds;
    const kz = (b.t[2] - a.t[2]) / ds;
    // The park is a miniature (curve radius ≈ 2 m): forces are scaled as if the track were full size.
    const fx = kx * v * v * FORCE_SCALE;
    const fy = ky * v * v * FORCE_SCALE + G;
    const fz = kz * v * v * FORCE_SCALE;
    const p = pts[i];
    const vert = (fx * p.up[0] + fy * p.up[1] + fz * p.up[2]) / G;
    const sx = p.t[1] * p.up[2] - p.t[2] * p.up[1];
    const sy = p.t[2] * p.up[0] - p.t[0] * p.up[2];
    const sz = p.t[0] * p.up[1] - p.t[1] * p.up[0];
    const lat = Math.abs(fx * sx + fy * sy + fz * sz) / G;
    maxG = Math.max(maxG, Math.min(6, vert));
    latG = Math.max(latG, Math.min(4, lat));
  }
  // Drops: continuous descents of more than ~1.5 m (loops are counted on their own).
  let drops = 0;
  let maxDrop = 0;
  let top = pts[0].y;
  let low = top;
  const descent = () => {
    const depth = (top - low) * UNIT_M;
    if (depth > 1.5) {
      drops += 1;
      maxDrop = Math.max(maxDrop, depth);
    }
  };
  for (let i = 1; i <= n; i += 1) {
    const p = pts[i % n];
    if (p.piece >= 0 && coaster.pieces[p.piece] === "loop") continue;
    const y = p.y;
    if (y < low) low = y;
    else if (y > low + 0.05) {
      descent();
      top = y;
      low = y;
    }
    if (y > top) top = low = y;
  }
  descent();
  const loops = coaster.pieces.filter((piece) => piece === "loop").length;
  const turns = coaster.pieces.filter((piece) => piece === "left" || piece === "right").length;
  const maxKmh = maxV * UNIT_M * 3.6;
  const lengthM = path.length * UNIT_M;
  const intensity = 0.4 + maxKmh / 22 + Math.max(0, maxG - 1) * 0.9 + latG * 1.5 + loops * 0.45;
  let excitement = 0.6 + maxKmh / 25 + drops * 0.35 + loops * 0.9 + Math.min(16, turns) * 0.07 + maxDrop * 0.05 + Math.min(1.5, scenery * 0.1) + Math.min(1, lengthM / 300);
  // Way too intense rides are less fun for most visitors.
  excitement -= Math.max(0, intensity - 8.5) * 0.8;
  const nausea = 0.2 + loops * 0.75 + latG * 1.0 + Math.max(0, maxG - 2.5) * 0.5 + turns * 0.03 + intensity * 0.15;
  return {
    excitement: clamp10(excitement),
    intensity: clamp10(intensity),
    nausea: clamp10(nausea),
    maxKmh: Math.round(maxKmh),
    lapSec: run.lapSec,
    length: Math.round(lengthM),
    maxHeight: Math.round(maxHeight * UNIT_M * 10) / 10,
    maxDrop: Math.round(maxDrop * 10) / 10,
    drops,
    loops,
    turns,
    maxG: round2(maxG),
    latG: round2(latG),
  };
}

/** Scenery around a track: habitats, trees and flower beds within 3 tiles. */
export function sceneryNear(grid: Uint8Array, coaster: Coaster): number {
  const near = new Set<number>();
  for (const { tile } of coasterLayout(coaster).tiles) {
    const { x, y } = parkXY(tile);
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) if (inPark(x + dx, y + dy)) near.add(parkIndex(x + dx, y + dy));
  }
  let score = 0;
  let habitat = 0;
  for (const tile of near) {
    const code = grid[tile];
    if (code === TILE.tree || code === TILE.flowers) score += 1;
    else if (code === TILE.habitat) habitat += 1;
  }
  // A habitat next to the track counts like a few trees (25 tiles each, so scale down).
  return score + Math.round(habitat / 6);
}

// ---------------------------------------------------------------- sanitize

export const RIDE_STATES: RideState[] = ["closed", "test", "open"];

export function cleanPrice(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(PRICE_MAX, Math.round(value))) : fallback;
}

/**
 * Coasters from a save or the wire: known pieces only, cut at the first piece that no longer
 * fits, no overlaps with habitats, objects or each other. Ratings survive only on closed tracks.
 */
export function cleanCoasters(raw: unknown, park: ParkState | undefined, habitats: ParkHabitatRef[]): Coaster[] {
  if (!Array.isArray(raw) || !park) return [];
  const out: Coaster[] = [];
  const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  for (const entry of raw.slice(0, MAX_COASTERS)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Partial<Coaster>;
    const station = num(r.station, -1) | 0;
    const dir = num(r.dir) & 3;
    const grid = blockGrid(park, habitats, out);
    if (stationProblem(grid, station, dir) && stationProblem(grid, station, dir) !== "coaster_no_path") continue;
    const pieces = Array.isArray(r.pieces) ? r.pieces.filter((piece): piece is PieceKind => PIECE_KINDS.includes(piece as PieceKind)).slice(0, MAX_PIECES) : [];
    const layout = coasterLayout({ station, dir, pieces }, grid);
    const kept = pieces.slice(0, layout.valid);
    const closed = coasterLayout({ station, dir, pieces: kept }).closed;
    const coaster: Coaster = {
      id: num(r.id) >>> 0,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 24) : `Achterbahn ${out.length + 1}`,
      station,
      dir,
      pieces: kept,
      state: closed && RIDE_STATES.includes(r.state as RideState) ? (r.state as RideState) : "closed",
      price: cleanPrice(r.price, DEFAULT_RIDE_PRICE),
      riders: Math.max(0, num(r.riders)),
      revenue: Math.max(0, num(r.revenue)),
    };
    const s = r.stats;
    if (closed && kept.length === pieces.length && s && typeof s === "object") {
      const keys: (keyof CoasterStats)[] = ["excitement", "intensity", "nausea", "maxKmh", "lapSec", "length", "maxHeight", "maxDrop", "drops", "loops", "turns", "maxG", "latG"];
      const stats = {} as CoasterStats;
      for (const key of keys) stats[key] = Math.max(0, Math.min(key === "excitement" || key === "intensity" || key === "nausea" ? 10 : 10_000, num(s[key])));
      coaster.stats = stats;
    }
    if (!coaster.stats && coaster.state === "open") coaster.state = "closed";
    if (out.some((other) => other.id === coaster.id)) coaster.id = Math.max(0, ...out.map((other) => other.id)) + 1;
    out.push(coaster);
  }
  return out;
}
