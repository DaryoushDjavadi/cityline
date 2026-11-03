import { buildMeta, createCity, packCells, stepSimulation, writeCity, type SimMeta } from "../../../shared/src/index.ts";

const city = createCity();
let generation = 1;
let running = true;

interface ResetMessage {
  t: "reset";
  generation: number;
  cells: Uint8Array;
  meta: SimMeta;
  running: boolean;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ResetMessage>) => {
  if (event.data?.t !== "reset") return;
  generation = event.data.generation;
  running = event.data.running;
  writeCity(city, event.data.cells, event.data.meta);
};

setInterval(() => {
  if (!running) return;
  const stamp = generation;
  stepSimulation(city);
  scope.postMessage({
    t: "tick",
    generation: stamp,
    cells: packCells(city),
    meta: buildMeta(city),
  });
}, 500);
