import {
  BUILDINGS,
  DAY_TICKS,
  ServiceKind,
  applyCommand,
  cellIndex,
  cellToWorld,
  createCity,
  isWater,
  refreshUtilities,
  type CityState,
} from "../../../shared/src/index.ts";

export interface LookCity {
  city: CityState;
  focusX: number;
  focusZ: number;
}

/** Dense showcase city for look comparisons (client-only, not persisted). */
export function buildLookCity(hour = 7): LookCity {
  const city = createCity(undefined, undefined, {
    seed: 1842,
    biome: "temperate",
    water: 38,
    lakes: 22,
    forest: 18,
    rivers: 18,
  });
  city.funds = 5_000_000;
  city.tick = hourToTick(hour);

  const land = (x: number, y: number) => {
    if (x < 2 || y < 2 || x >= city.width - 2 || y >= city.height - 2) return false;
    return !isWater(city, cellIndex(city, x, y));
  };

  let bestY = 32;
  let best = 0;
  for (let y = 18; y < 46; y += 1) {
    let run = 0;
    for (let x = 10; x < 54; x += 1) if (land(x, y)) run += 1;
    if (run > best) {
      best = run;
      bestY = y;
    }
  }

  const roadCells: number[] = [];
  const addRoad = (x: number, y: number) => {
    if (!land(x, y)) return;
    roadCells.push(cellIndex(city, x, y));
  };
  for (let x = 12; x <= 50; x += 1) addRoad(x, bestY);
  for (let y = bestY - 8; y <= bestY + 8; y += 1) addRoad(26, y);
  for (let y = bestY - 4; y <= bestY + 10; y += 1) addRoad(40, y);
  for (let x = 26; x <= 48; x += 1) addRoad(x, bestY + 8);
  applyCommand(city, { type: "road", cells: unique(roadCells) });

  const placeBuild = (x: number, y: number, kind: keyof typeof BUILDINGS) => {
    const index = cellIndex(city, x, y);
    if (isWater(city, index)) return;
    applyCommand(city, { type: "build", cells: [index], kind });
  };
  const placeService = (x: number, y: number, kind: (typeof ServiceKind)[keyof typeof ServiceKind]) => {
    const index = cellIndex(city, x, y);
    if (isWater(city, index)) return;
    applyCommand(city, { type: "service", index, kind });
  };

  const cottages: [number, number][] = [
    [18, bestY - 1], [20, bestY - 1], [22, bestY - 1],
    [18, bestY + 1], [20, bestY + 1], [16, bestY - 1],
    [14, bestY + 1], [24, bestY + 1],
  ];
  for (const [x, y] of cottages) placeBuild(x, y, "cottage");
  placeBuild(28, bestY - 1, "apartments");
  placeBuild(30, bestY - 1, "apartments");
  placeBuild(32, bestY - 1, "tower");
  placeBuild(28, bestY + 1, "shop");
  placeBuild(30, bestY + 1, "office");
  placeBuild(32, bestY + 1, "mall");
  placeBuild(34, bestY - 1, "workshop");
  placeBuild(36, bestY - 1, "factory");
  placeBuild(38, bestY - 1, "plant");
  placeBuild(28, bestY - 3, "apartments");
  placeBuild(30, bestY - 3, "office");
  placeBuild(32, bestY - 3, "apartments");
  placeBuild(34, bestY + 1, "shop");
  placeBuild(22, bestY + 1, "cottage");
  placeBuild(26, bestY - 1, "cottage");
  placeBuild(14, bestY - 3, "cottage");
  placeBuild(16, bestY - 3, "cottage");

  placeService(24, bestY - 1, ServiceKind.Power);
  placeService(24, bestY + 1, ServiceKind.Water);
  placeService(42, bestY + 1, ServiceKind.Airport);
  placeService(34, bestY + 1, ServiceKind.School);
  placeService(36, bestY + 1, ServiceKind.Fire);

  const lines: number[] = [];
  const pipes: number[] = [];
  for (let x = 18; x <= 42; x += 1) {
    const index = cellIndex(city, x, bestY);
    lines.push(index);
    pipes.push(index);
  }
  applyCommand(city, { type: "line", cells: unique(lines) });
  applyCommand(city, { type: "pipe", cells: unique(pipes) });

  const lamps: number[] = [];
  for (let x = 16; x <= 48; x += 4) lamps.push(cellIndex(city, x, bestY));
  for (const index of unique(lamps)) applyCommand(city, { type: "service", index, kind: ServiceKind.Lamp });

  refreshUtilities(city);
  const focus = cellToWorld(city, 32, bestY);
  return { city, focusX: focus.x, focusZ: focus.z };
}

export function hourToTick(hour: number): number {
  const wrapped = ((hour % 24) + 24) % 24;
  return Math.round((wrapped / 24) * DAY_TICKS) % DAY_TICKS;
}

function unique(cells: number[]): number[] {
  return [...new Set(cells)];
}
