/**
 * Mehr Leben: Anwohner, Parkbesucher, Rauch, Vögel, Verkehr je nach Bevölkerung & Tageszeit.
 *   npm run build && PORT=8787 npm start
 *   SHOTS=/workspace/cityline-shots/v2 npx tsx scripts/ambient-playtest.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v2";
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};
type E2E = Record<string, (...args: any[]) => any>;
const e2e = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args });
type Life = { cars: number; pedestrians: number; residents: number; smoke: number; birds: number; beach: number };

async function boot(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  const gate = page.locator("#name-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#gate-name").fill("Daryoush");
    await page.locator("#gate-enter").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
  await page.locator("#lobby-create > summary").click().catch(() => undefined);
  await page.locator("#map-seed").fill("1842");
  await page.locator("#solo-new").click();
  await page.locator("#lobby").waitFor({ state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), undefined, { timeout: 40_000 });
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (err) => errors.push(String(err)));
await boot(page);

const empty = (await e2e(page, "life")) as Life;
check(empty.residents <= 4 && empty.smoke === 0, `Leere Karte: kaum Leben (${JSON.stringify(empty)})`);

await e2e(page, "showcase", 10);
await e2e(page, "setOverlay", { zones: false });
await e2e(page, "setProgress", { rank: 5 });
const kinds: Record<string, number> = { park: 7, wheel: 12, cityhall: 13 };
let focus: { x: number; y: number } | null = null;
for (const tool of ["park", "park", "wheel", "cityhall"]) {
  const spot = (await e2e(page, "spotFor", tool)) as { x: number; y: number } | null;
  if (!spot) continue;
  focus ??= spot;
  const index = (await e2e(page, "cellIndex", spot.x, spot.y)) as number;
  await e2e(page, "apply", { type: "service", index, kind: kinds[tool] });
}
check(((await e2e(page, "countService", 7)) as number) >= 1, "Park gebaut");
if (focus) await e2e(page, "lookAt", focus.x, focus.y + 1, 62, 0.95);
await page.waitForTimeout(2500);
await e2e(page, "dismissUi");
const day = (await e2e(page, "life")) as Life;
console.log("Tag 10:00", day);
check(day.residents >= 12, `Anwohner/Parkbesucher am Tag (${day.residents})`);
check(day.smoke >= 6, `Schornsteinrauch sichtbar (${day.smoke} Puffs)`);
check(day.birds >= 5, `Vögel am Tag (${day.birds})`);
check(day.cars >= 8 && day.pedestrians >= 8, `Autos ${day.cars} / Fußgänger ${day.pedestrians}`);
await page.screenshot({ path: path.join(SHOTS, "life-01-day.png") });
const power = (await e2e(page, "findService", 1)) as { x: number; y: number } | null;
await e2e(page, "setChrome", false);
if (power) await e2e(page, "lookAt", power.x + 6, power.y, 92, 0.98);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(SHOTS, "life-03-town-day.png") });

await e2e(page, "setHour", 0.5);
await page.waitForTimeout(2500);
const night = (await e2e(page, "life")) as Life;
console.log("Nacht 00:30", night);
check(night.residents < day.residents, `Nachts weniger Leute draußen (${night.residents} < ${day.residents})`);
check(night.birds === 0, `Vögel schlafen nachts (${night.birds})`);
check(night.pedestrians <= day.pedestrians, `Nachts weniger Fußgänger (${night.pedestrians} ≤ ${day.pedestrians})`);
await page.screenshot({ path: path.join(SHOTS, "life-04-town-night.png") });
await e2e(page, "setChrome", true);
if (focus) await e2e(page, "lookAt", focus.x, focus.y + 1, 62, 0.95);
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(SHOTS, "life-02-night.png") });

check(errors.length === 0, `Keine Seitenfehler ${errors.join(" | ")}`);
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} Fehler`);
  process.exit(1);
}
console.log("\nAmbient-Playtest OK");
