import { isRoad } from "./city.ts";
import { cellCoords } from "./grid.ts";
import { Quadtree } from "./quadtree.ts";
import type { CityState } from "./types.ts";

const QUERY_RADIUS = 6;

/** Traffic weight per road cell, gathered through a quadtree of occupied buildings. */
export function computeTraffic(city: CityState): { load: Uint8Array; score: number } {
  const count = city.width * city.height;
  const load = new Uint8Array(count);
  const tree = new Quadtree({ x: 0, y: 0, w: city.width, h: city.height });

  for (let index = 0; index < count; index += 1) {
    if (city.levels[index] <= 0) continue;
    const { x, y } = cellCoords(city, index);
    tree.insert({ x, y, weight: city.levels[index] });
  }

  const nearby: { x: number; y: number; weight: number }[] = [];
  let total = 0;
  let roads = 0;
  for (let index = 0; index < count; index += 1) {
    if (!isRoad(city, index)) continue;
    const { x, y } = cellCoords(city, index);
    nearby.length = 0;
    tree.query({ x: x - QUERY_RADIUS, y: y - QUERY_RADIUS, w: QUERY_RADIUS * 2, h: QUERY_RADIUS * 2 }, nearby);
    let weight = 0;
    for (const building of nearby) weight += building.weight;
    const value = Math.min(255, weight);
    load[index] = value;
    total += value;
    roads += 1;
  }

  const score = roads === 0 ? 0 : Math.max(0, Math.min(100, Math.round(total / roads / 1.6)));
  return { load, score };
}
