/** Mobile-portrait look shots (e.g. 03:45 with rain). TAG=before|after HOURS=3.75 WEATHER=rain */
import { chromium } from "playwright";
const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v3";
const TAG = process.env.TAG ?? "after";
const cases = (process.env.CASES ?? "3.75:rain:low,3.75:rain:high,7:clear:high").split(",");
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
for (const c of cases) {
  const [hour, weather, gfx] = c.split(":");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript({ content: "window.__name = (fn) => fn; localStorage.setItem('cityline-name','Shot');" });
  await page.goto(`${BASE}/?preview=look&hour=${hour}&weather=${weather}&gfx=${gfx}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as any).__cityline?.ready), undefined, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  const name = `${SHOTS}/${TAG}-mobile-night-${hour.replace(".", "_")}h-${weather}-${gfx}.png`;
  await page.screenshot({ path: name });
  console.log(name);
  await context.close();
}
await browser.close();
