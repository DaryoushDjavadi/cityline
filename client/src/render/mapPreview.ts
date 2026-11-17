import { cellCoords, vegetationRoll, type CityState } from "../../../shared/src/index.ts";

const LAND: Record<string, [number, number, number]> = {
  temperate: [116, 172, 72],
  arid: [196, 176, 110],
  alpine: [96, 138, 96],
  tropical: [72, 158, 82],
  archipelago: [108, 168, 88],
};

const TREE: Record<string, [number, number, number]> = {
  temperate: [70, 140, 68],
  arid: [130, 138, 82],
  alpine: [56, 108, 78],
  tropical: [48, 132, 62],
  archipelago: [62, 128, 70],
};

/** Top-down PNG-like paint of terrain for the lobby preview. */
export function paintMapPreview(canvas: HTMLCanvasElement, city: CityState): void {
  const size = Math.max(city.width, city.height);
  const scale = Math.max(2, Math.floor(256 / size));
  canvas.width = city.width * scale;
  canvas.height = city.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const biome = city.gen?.biome ?? "temperate";
  const land = LAND[biome] ?? LAND.temperate;
  const tree = TREE[biome] ?? TREE.temperate;
  const forest = city.gen?.forest ?? 50;
  const seed = city.gen?.seed ?? 1;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < city.terrain.length; index += 1) {
    const { x, y } = cellCoords(city, index);
    const water = city.terrain[index] === 1;
    const beach = city.terrain[index] === 2;
    let r = 42;
    let g = 98;
    let b = 148;
    if (beach) {
      r = 232;
      g = 210;
      b = 150;
    } else if (!water) {
      const shade = ((x * 13 + y * 7) % 5) - 2;
      r = land[0] + shade * 4;
      g = land[1] + shade * 3;
      b = land[2] + shade * 2;
      if (vegetationRoll(x, y, seed) < forest * 0.72) {
        r = tree[0];
        g = tree[1];
        b = tree[2];
      }
    } else {
      const deep = ((x + y) % 4) === 0;
      r = deep ? 22 : 42;
      g = deep ? 88 : 128;
      b = deep ? 160 : 196;
    }
    for (let py = 0; py < scale; py += 1) {
      for (let px = 0; px < scale; px += 1) {
        const slot = ((y * scale + py) * canvas.width + (x * scale + px)) * 4;
        data[slot] = r;
        data[slot + 1] = g;
        data[slot + 2] = b;
        data[slot + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
