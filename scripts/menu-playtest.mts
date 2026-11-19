/**
 * Baumenü v2 playtest: categories, palette, hotkeys, tooltip, lines visible; desktop 1280 + mobile.
 *   CITYLINE_CLIENT=http://127.0.0.1:8787 SHOTS=/workspace/cityline-shots/v2 npx tsx scripts/menu-playtest.mts
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

async function boot(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn; try { localStorage.removeItem('cityline-build-tab'); } catch {}" });
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
  await page.locator("#quest-hint-ok").click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

const tool = (page: Page) => page.evaluate(() => document.body.dataset.tool);

async function desktop(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await boot(page);
  check((await page.locator("#rail .build-tab").count()) === 8, "8 Kategorien in der Leiste");
  const rail = await page.locator("#rail").boundingBox();
  check(rail && rail.y + rail.height > 700 && rail.x > 200, `Leiste unten mittig (${rail?.x.toFixed(0)}, ${rail?.y.toFixed(0)})`);
  const stats = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".stats");
    if (!bar) return null;
    const items = [...bar.querySelectorAll<HTMLElement>(".stat")].filter((el) => el.offsetParent !== null);
    const right = bar.getBoundingClientRect().right;
    return { total: items.length, cut: items.filter((el) => el.getBoundingClientRect().right > right + 1).length };
  });
  check(stats && stats.cut === 0, `Werteleiste bei 1280 px nicht abgeschnitten (${stats?.cut}/${stats?.total})`);
  await page.screenshot({ path: path.join(SHOTS, "menu-01-desktop.png") });

  await page.keyboard.press("2");
  await page.waitForTimeout(200);
  check(await page.locator("#build-panel-homes").isVisible(), "Taste 2 öffnet Wohnen");
  await page.keyboard.press("r");
  check((await tool(page)) === "cottage", "Taste R wählt Haus");
  await page.keyboard.press("4");
  await page.waitForTimeout(200);
  check(await page.locator('#build-panel-utility [data-tool="line"]').isVisible(), "Versorgung zeigt Stromleitung");
  check(await page.locator('#build-panel-utility [data-tool="pipe"]').isVisible(), "Versorgung zeigt Wasserrohr");
  check(await page.locator('.rail-quick [data-tool="line"]').isVisible(), "Schnellknopf Strom sichtbar");
  await page.locator('#build-panel-utility [data-tool="line"]').hover();
  await page.waitForTimeout(250);
  check(await page.locator("#build-tip").isVisible(), "Tooltip erscheint beim Hovern");
  const tipText = (await page.locator("#build-tip").textContent()) ?? "";
  check(/Braucht/.test(tipText) && /€/.test(tipText), "Tooltip zeigt Kosten und Voraussetzungen");
  await page.screenshot({ path: path.join(SHOTS, "menu-02-versorgung-tooltip.png") });
  await page.keyboard.press("t");
  check((await tool(page)) === "line", "Taste T = Stromleitung (2. Feld)");
  await page.keyboard.press("p");
  check((await tool(page)) === "pipe", "Taste P = Wasserrohr");
  await page.keyboard.press("7");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, "menu-03-wahrzeichen-locked.png") });
  check((await page.locator('#build-panel-landmarks .build-item[data-locked="on"]').count()) === 3, "Wahrzeichen gesperrt bei Rang 0");
  await page.keyboard.press("7");
  await page.waitForTimeout(150);
  check(await page.locator(".build-palette").isHidden(), "Gleiche Taste klappt Palette zu");
  await page.locator("#toggle-rail").click();
  await page.waitForTimeout(150);
  check(await page.locator("#rail").isHidden(), "Hammer klappt Baumenü zu");
  await page.keyboard.press("3");
  await page.waitForTimeout(150);
  check(await page.locator("#build-panel-work").isVisible(), "Taste 3 öffnet Menü + Arbeit");
  await page.screenshot({ path: path.join(SHOTS, "menu-04-arbeit.png") });
  check(errors.length === 0, `Keine Seitenfehler (${errors.length})`);
  await browser.close();
}

async function mobile(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await boot(page);
  await page.locator("#toggle-rail").tap();
  await page.waitForTimeout(300);
  check(await page.locator("#rail").isVisible(), "Mobil: Hammer öffnet Baumenü");
  await page.locator("#build-tab-utility").tap();
  await page.waitForTimeout(300);
  check(await page.locator('#build-panel-utility [data-tool="line"]').isVisible(), "Mobil: Versorgung mit Leitung");
  await page.screenshot({ path: path.join(SHOTS, "menu-05-mobile-versorgung.png") });
  await page.locator('#build-panel-utility [data-tool="pipe"]').tap();
  check((await tool(page)) === "pipe", "Mobil: Tippen wählt Rohr");
  if (await page.locator("#rail").isHidden()) await page.locator("#toggle-rail").tap();
  await page.waitForTimeout(300);
  await page.locator("#build-tab-homes").tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, "menu-06-mobile-wohnen.png") });
  await browser.close();
}

await desktop();
await mobile();
if (failures.length) {
  console.error(`menu-playtest: ${failures.length} Fehler`, failures);
  process.exit(1);
}
console.log("menu-playtest ok");
