/**
 * Measures how much screen height the build menu (+ status footer) takes at 1280×800:
 * palette open (choosing) and while placing. Also takes the v3 screenshots.
 *   CITYLINE_CLIENT=http://127.0.0.1:8787 SHOTS=/workspace/cityline-shots/v3 TAG=after npx tsx scripts/menu-measure.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v3";
const TAG = process.env.TAG ?? "after";
const LIMIT_OPEN = Number(process.env.LIMIT_OPEN ?? 0);
const LIMIT_PLACE = Number(process.env.LIMIT_PLACE ?? 0);
mkdirSync(SHOTS, { recursive: true });

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

/** Height from the top of the highest bottom UI element (menu, footer, tool chip) to the bottom edge. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const vh = window.innerHeight;
    const boxes: Record<string, number> = {};
    for (const sel of ["#rail", "footer", "#dock"]) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.top < vh * 0.4) continue; // only things in the lower part
      boxes[sel] = Math.round(vh - r.top);
    }
    const height = Math.max(0, ...Object.values(boxes));
    return { height, share: Math.round((height / vh) * 1000) / 10, boxes };
  });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const report: string[] = [];
let fail = false;
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await boot(page);
  await page.mouse.move(640, 300);
  await page.keyboard.press("2");
  await page.waitForTimeout(400);
  const open = await measure(page);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-desktop-palette-open.png`) });
  await page.keyboard.press("r");
  await page.mouse.move(640, 360);
  await page.waitForTimeout(600);
  const placing = await measure(page);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-desktop-placing.png`) });
  report.push(`desktop open: ${open.height}px (${open.share} %) ${JSON.stringify(open.boxes)}`);
  report.push(`desktop placing: ${placing.height}px (${placing.share} %) ${JSON.stringify(placing.boxes)}`);
  if (LIMIT_OPEN && open.share > LIMIT_OPEN) fail = true;
  if (LIMIT_PLACE && placing.share > LIMIT_PLACE) fail = true;
  if (process.env.NOTES) {
    await page.keyboard.press("Escape");
    await page.locator("#open-notes").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `notes-panel.png`) });
    const times = await page.$$eval("#notes time", (els) => els.slice(0, 4).map((el) => `${(el as HTMLTimeElement).dateTime} | ${el.textContent}`));
    report.push(`notes: ${JSON.stringify(times)}`);
  }
  await page.close();
}
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await boot(page);
  await page.locator("#toggle-rail").tap();
  await page.waitForTimeout(300);
  await page.locator("#build-tab-homes").tap();
  await page.waitForTimeout(300);
  const open = await measure(page);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-mobile-palette-open.png`) });
  await page.locator('#build-panel-homes [data-tool="cottage"]').tap();
  await page.waitForTimeout(600);
  const placing = await measure(page);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-mobile-placing.png`) });
  report.push(`mobile open: ${open.height}px (${open.share} %) ${JSON.stringify(open.boxes)}`);
  report.push(`mobile placing: ${placing.height}px (${placing.share} %) ${JSON.stringify(placing.boxes)}`);
}
await browser.close();
console.log(report.join("\n"));
if (fail) {
  console.error("menu-measure: über dem Höhenlimit");
  process.exit(1);
}
