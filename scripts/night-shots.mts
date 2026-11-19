/** Night/dusk look shots: `SHOT_PREFIX=before npx tsx scripts/night-shots.mts` (needs built client on :8787). */
import { chromium } from "playwright";
const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const OUT = process.env.SHOTS ?? "/workspace/cityline-shots/v2";
const PREFIX = process.env.SHOT_PREFIX ?? "after";
const HOURS = (process.env.SHOT_HOURS ?? "7,19.5,21,0,5.5").split(",").map(Number);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const hour of HOURS) {
  await page.goto(`${BASE}/?preview=look&gfx=high&hud=0&hour=${hour}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const tag = String(hour).replace(".", "_").padStart(2, "0");
  await page.screenshot({ path: `${OUT}/${PREFIX}-look-${tag}h.png` });
}
await browser.close();
