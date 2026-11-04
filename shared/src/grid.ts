export const GRID_SIZE = 64;
export const CELL_SIZE = 10;
export const ROAD_FLAG = 0b10000;
export const BRIDGE_FLAG = 0b100000;

export const COST = {
  road: 40,
  bridge: 140,
  fill: 8000,
  zone: 10,
  line: 15,
  pipe: 18,
  power: 7500,
  water: 5500,
  school: 12000,
  clinic: 14000,
  police: 9000,
  fire: 9500,
  park: 2000,
  university: 18000,
  airport: 48000,
  lamp: 120,
} as const;

export const DIRS = [
  { bit: 1, dx: 0, dy: -1 },
  { bit: 2, dx: 1, dy: 0 },
  { bit: 4, dx: 0, dy: 1 },
  { bit: 8, dx: -1, dy: 0 },
] as const;

export interface GridLike {
  width: number;
  height: number;
}

export function cellIndex(grid: GridLike, x: number, y: number): number {
  return y * grid.width + x;
}

export function cellCoords(grid: GridLike, index: number): { x: number; y: number } {
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

export function inBounds(grid: GridLike, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function cellToWorld(grid: GridLike, x: number, y: number): { x: number; z: number } {
  return {
    x: (x - grid.width / 2 + 0.5) * CELL_SIZE,
    z: (y - grid.height / 2 + 0.5) * CELL_SIZE,
  };
}

export function worldToCell(
  grid: GridLike,
  worldX: number,
  worldZ: number,
): { x: number; y: number } | null {
  const x = Math.floor(worldX / CELL_SIZE + grid.width / 2);
  const y = Math.floor(worldZ / CELL_SIZE + grid.height / 2);
  if (!inBounds(grid, x, y)) return null;
  return { x, y };
}

/** Orthogonal stroke: along X, then along Y, so a drag bends in one right angle and never skips a cell. */
export function lineCells(grid: GridLike, x0: number, y0: number, x1: number, y1: number): number[] {
  return lineStroke(grid, x0, y0, x1, y1).cells;
}

/** Same as lineCells, plus whether the L-corner stayed on the map (no gap). */
export function lineStroke(
  grid: GridLike,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { cells: number[]; complete: boolean } {
  const cells: number[] = [];
  let complete = true;
  const push = (x: number, y: number) => {
    if (!inBounds(grid, x, y)) {
      complete = false;
      return;
    }
    const index = cellIndex(grid, x, y);
    if (cells[cells.length - 1] !== index) cells.push(index);
  };
  const xDir = x0 <= x1 ? 1 : -1;
  for (let x = x0; x !== x1 + xDir; x += xDir) push(x, y0);
  const yDir = y0 <= y1 ? 1 : -1;
  for (let y = y0; y !== y1 + yDir; y += yDir) push(x1, y);
  return { cells, complete };
}

/** True when every consecutive pair in stroke order shares an edge. */
export function strokeConnected(grid: GridLike, cells: readonly number[]): boolean {
  if (cells.length <= 1) return true;
  for (let i = 1; i < cells.length; i += 1) {
    const a = cellCoords(grid, cells[i - 1]);
    const b = cellCoords(grid, cells[i]);
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  }
  return true;
}

export function brushCells(grid: GridLike, x: number, y: number, radius: number): number[] {
  const cells: number[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(grid, nx, ny)) cells.push(cellIndex(grid, nx, ny));
    }
  }
  return cells;
}

export function uniqueCells(cells: readonly number[], max = 1024): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const cell of cells) {
    if (!Number.isInteger(cell) || seen.has(cell)) continue;
    seen.add(cell);
    out.push(cell);
    if (out.length >= max) break;
  }
  return out;
}
