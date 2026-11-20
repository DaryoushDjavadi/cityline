/**
 * Gehege-Baumodus im Tierpark: Gehege anklicken (Kamera fährt heran), Bau-Modus mit Vorschau,
 * Drehen und Entfernen, Möbel aus der Übersicht sichtbar, Streicheln mit Herzen im Park,
 * Mobile und Pixel-Art. Misst die Draw Calls im Park (PERF_ONLY=1 nur Messung, auch für main).
 *   SHOTS=/workspace/cityline-shots/baumodus npx tsx scripts/baumodus-shots.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/baumodus";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};
type E2E = Record<string, (...args: any[]) => any>;
const e2e = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args }) as Promise<T>;
const pk = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E.parkUi() as Record<string, (...a: unknown[]) => unknown>)[name](...args), { name, args }) as Promise<T>;
const P = (x: number, y: number) => y * 40 + x;
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: number[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) out.push(P(x, y));
  return out;
};

async function boot(page: Page, fresh = true): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  const gate = page.locator("#name-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#gate-name").fill("Daryoush");
    await page.locator("#gate-enter").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
  if (!fresh) return;
  await page.locator("#lobby-create > summary").click().catch(() => undefined);
  await page.locator("#map-seed").fill("1842");
  await page.locator("#solo-new").click();
  await page.locator("#lobby").waitFor({ state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), undefined, { timeout: 40_000 });
}
async function clean(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await page.evaluate(() => {
    for (const id of ["#life-toast", "#toast", "#pk-toast", "#status"]) {
      const el = document.querySelector<HTMLElement>(id);
      if (el) el.hidden = true;
    }
  });
}
const zooCmd = (page: Page, zoo: Record<string, unknown>) => e2e(page, "apply", { type: "zoo", zoo });
async function tierpark(page: Page): Promise<void> {
  const area = await e2e<{ x: number; y: number }>(page, "findArea", 3, 2);
  const idx = (x: number, y: number) => e2e<number>(page, "cellIndex", x, y);
  await e2e(page, "apply", { type: "road", cells: [await idx(area.x, area.y + 1), await idx(area.x + 1, area.y + 1), await idx(area.x + 2, area.y + 1)] });
  await e2e(page, "apply", { type: "service", index: await idx(area.x + 1, area.y), kind: 20 });
  await e2e(page, "advanceZoo", 2);
  for (const cells of [line(20, 4, 20, 33), line(5, 20, 35, 20), line(8, 8, 32, 8), line(8, 9, 8, 19), line(32, 9, 32, 19)]) await zooCmd(page, { op: "pbuild", kind: "path", cells });
  const habitats: [string, number][] = [["savanne", P(15, 33)], ["wald", P(21, 33)], ["wasser", P(15, 26)], ["polar", P(21, 26)], ["wiese", P(9, 21)], ["savanne", P(26, 21)]];
  for (const [kind, cell] of habitats) await zooCmd(page, { op: "pbuild", kind, cells: [cell] });
  for (const [kind, cells] of [["food", [P(19, 31), P(9, 19)]], ["drink", [P(21, 31), P(31, 19)]], ["souvenir", [P(19, 21)]], ["toilet", [P(21, 19)]], ["bench", [P(19, 19), P(14, 19), P(26, 19), P(19, 38)]], ["bin", [P(21, 38), P(16, 21)]], ["tree", [P(7, 23), P(12, 17), P(28, 16), P(27, 12), P(14, 12), P(35, 26), P(4, 31), P(34, 35), P(6, 36), P(24, 14), P(16, 15), P(10, 30), P(31, 30)]], ["flowers", [P(18, 38), P(22, 38), P(19, 25), P(21, 25), P(13, 21), P(25, 19)]]] as const) await zooCmd(page, { op: "pbuild", kind, cells });
  const buy = (cell: number, species: string) => zooCmd(page, { op: "buy", cell, species, origin: "breeder" });
  for (const s of ["giraffe", "zebra", "zebra"]) await buy(P(15, 33), s);
  for (const s of ["monkey", "redpanda"]) await buy(P(21, 33), s);
  for (const s of ["flamingo", "flamingo", "otter"]) await buy(P(15, 26), s);
  for (const s of ["penguin", "penguin"]) await buy(P(21, 26), s);
  for (const s of ["goat", "alpaca", "rabbit"]) await buy(P(9, 21), s);
  for (const s of ["elephant", "kangaroo"]) await buy(P(26, 21), s);
  await e2e(page, "advanceZoo", 40);
}


const PERF_ONLY = process.env.PERF_ONLY === "1";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror:", String(err)); });
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
await boot(page);
await e2e(page, "showcase", 10);
await e2e(page, "setOverlay", { zones: false });
await tierpark(page);
// Some furniture (old saves: plain spots, no turn).
const furnish: [number, string, number, number][] = [[P(15, 33), "food", 1, 1], [P(15, 33), "water", 2, 1], [P(15, 33), "shelter", 5, 5], [P(15, 33), "rock", 6, 2], [P(21, 33), "toy", 3, 4], [P(21, 33), "plant", 1, 6], [P(9, 21), "food", 4, 4], [P(9, 21), "shelter", 1, 1]];
for (const [cell, item, x, y] of furnish) await zooCmd(page, { op: "place", cell, item, x, y });
await e2e(page, "setHour", 10);
await pk(page, "enter");
await page.waitForTimeout(3500);
await page.waitForFunction(() => getComputedStyle(document.querySelector("#pk-hint")!).visibility === "hidden", undefined, { timeout: 10_000 }).catch(() => undefined);
const perf: Record<string, unknown> = {};
for (const style of ["standard", "pixel", "comic"] as const) {
  await e2e(page, "setStyle", style);
  for (const [view, args] of [["nah", [P(20, 29), 30, 0.35]], ["uebersicht", [P(20, 20), 110, 0.35]]] as const) {
    await pk(page, "lookAt", ...args);
    await page.waitForTimeout(1200);
    const stats = await pk<{ drawCalls: number; triangles: number }>(page, "stats");
    perf[`${style}-${view}`] = { drawCalls: stats.drawCalls, triangles: stats.triangles };
  }
}
console.log("PERF", JSON.stringify(perf));
await e2e(page, "setStyle", "standard");
if (PERF_ONLY) {
  await browser.close();
  process.exit(0);
}
