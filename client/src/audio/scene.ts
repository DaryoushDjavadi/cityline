/** Samples the city around the camera into an AudioScene (cheap: ≤ 21×21 cells, 4×/s). */
import { ServiceKind, Zone, climateAt, worldToCell, type CityState } from "../../../shared/src/index.ts";
import type { AudioScene } from "./sfx.ts";

const MIN_DIST = 48;
const MAX_DIST = 560;

/** `congestion` is the city-wide traffic stat (0–100). */
export function sampleAudioScene(city: CityState, targetX: number, targetZ: number, distance: number, congestion: number, playing: boolean): AudioScene {
  const zoom = Math.max(0, Math.min(1, (distance - MIN_DIST) / (MAX_DIST - MIN_DIST)));
  const climate = climateAt(city.tick);
  const center = worldToCell(city, targetX, targetZ);
  // Wider radius when zoomed out: you hear the whole bay, just quieter.
  const radius = Math.round(5 + zoom * 9);
  let cells = 0;
  let roads = 0;
  let green = 0;
  let water = 0;
  let homes = 0;
  let harbor = 0;
  let airport = 0;
  let coastX = 0;
  if (center) {
    const step = radius > 8 ? 2 : 1;
    for (let dy = -radius; dy <= radius; dy += step) {
      const y = center.y + dy;
      if (y < 0 || y >= city.height) continue;
      for (let dx = -radius; dx <= radius; dx += step) {
        const x = center.x + dx;
        if (x < 0 || x >= city.width) {
          water += 1;
          coastX += Math.sign(dx);
          cells += 1;
          continue;
        }
        const index = y * city.width + x;
        cells += 1;
        const terrain = city.terrain[index];
        if (terrain === 1 || terrain === 2) {
          water += terrain === 1 ? 1 : 0.6;
          coastX += Math.sign(dx);
          continue;
        }
        if (city.roads[index]) roads += 1;
        const service = city.services[index];
        if (service === ServiceKind.Harbor) harbor += 1;
        else if (service === ServiceKind.Airport) airport += 1;
        else if (service === ServiceKind.Park) green += 2;
        const zone = city.zones[index];
        if (zone === Zone.Residential && city.levels[index] > 0) homes += 1;
        if (!city.roads[index] && zone === Zone.None && service === ServiceKind.None) green += 1;
        else if (zone === Zone.Farm) green += 0.6;
      }
    }
  }
  const total = Math.max(1, cells);
  const roadShare = roads / total;
  const busy = Math.max(0, Math.min(1, congestion / 100));
  return {
    zoom,
    hour: climate.hour,
    weather: climate.weather,
    traffic: Math.min(1, roadShare * 2.6 * (0.25 + climate.streetActivity * 0.75) * (0.7 + busy * 0.6)),
    green: Math.min(1, green / total),
    coast: Math.min(1, (water / total) * 1.8),
    harbor: Math.min(1, harbor / 3),
    airport: Math.min(1, airport / 6),
    homes: Math.min(1, (homes / total) * 4),
    coastPan: water > 0 ? Math.max(-1, Math.min(1, coastX / water)) : 0,
    playing,
  };
}
