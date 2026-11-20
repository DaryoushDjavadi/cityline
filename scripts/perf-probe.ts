/**
 * Headless perf probe. Builds the dense showcase city (?preview=look), lets the
 * sim run (run=1), and samples frame pacing, render/update/sync cost and draw calls.
 *
 *   npm run build && PORT=8787 npm start   (serves client/dist)
 *   CITYLINE_CLIENT=http://127.0.0.1:8787 npx tsx scripts/perf-probe.ts
 */
import { chromium } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SECONDS = Number(process.env.PERF_SECONDS ?? 8);
const GFX = process.env.PERF_GFX ?? "high";

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  await page.addInitScript(() => localStorage.setItem("cityline-name", "Perf"));
  // Graphics style (Standard / Pixel-Art / Comic) to measure; main without styles ignores it.
  if (process.env.PERF_STYLE) await page.addInitScript((style) => localStorage.setItem("cityline-style", style), process.env.PERF_STYLE);
  await page.goto(`${BASE}/?preview=look&run=1&gfx=${GFX}&hour=9`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __cityline?: { ready?: boolean } }).__cityline?.ready), { timeout: 60_000 });
  await page.waitForTimeout(3000);
  if (process.env.PERF_TWEAK) await page.evaluate(process.env.PERF_TWEAK);
  await page.waitForTimeout(500);
  const result = await page.evaluate(async (seconds) => {
    const probe = () => (window as unknown as { __cityline: Record<string, number> }).__cityline;
    const frames: number[] = [];
    const render: number[] = [];
    const update: number[] = [];
    const syncs: number[] = [];
    let calls = 0;
    let tris = 0;
    let lastSync = -1;
    const heapStart = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    await new Promise<void>((resolve) => {
      let prev = performance.now();
      const end = prev + seconds * 1000;
      const loop = (now: number) => {
        frames.push(now - prev);
        prev = now;
        const p = probe();
        render.push(p.frameMs);
        update.push(p.updateMs ?? 0);
        if (p.syncMs !== lastSync) {
          syncs.push(p.syncMs ?? 0);
          lastSync = p.syncMs;
        }
        calls = Math.max(calls, p.drawCalls ?? 0);
        tris = Math.max(tris, p.triangles ?? 0);
        if (now < end) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
    const heapEnd = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
    const pct = (list: number[], q: number) => [...list].sort((a, b) => a - b)[Math.floor(list.length * q)] ?? 0;
    return {
      frames: frames.length,
      fps: frames.length / seconds,
      frameAvg: avg(frames),
      frameP95: pct(frames, 0.95),
      renderAvg: avg(render),
      updateAvg: avg(update),
      updateP95: pct(update, 0.95),
      syncAvg: avg(syncs),
      syncMax: Math.max(0, ...syncs),
      drawCalls: calls,
      triangles: tris,
      heapMB: (heapEnd / 1048576),
      heapDeltaMB: (heapEnd - heapStart) / 1048576,
    };
  }, SECONDS);
  console.log(JSON.stringify({ gfx: GFX, ...Object.fromEntries(Object.entries(result).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v])) }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
