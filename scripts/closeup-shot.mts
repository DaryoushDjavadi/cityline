/** Close-up zoom check: wheel all the way in over the showcase town and take close-up shots. */
import { chromium } from "playwright";
const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v3";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript({ content: "window.__name = (fn) => fn; localStorage.setItem('cityline-name','Shot');" });
await page.goto(`${BASE}/?preview=look&hour=${process.env.HOUR ?? 10}&run=1&gfx=high&hud=0`, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__cityline?.ready), undefined, { timeout: 60_000 });
await page.waitForTimeout(1500);
const [x, y] = (process.env.AT ?? "640,430").split(",").map(Number);
await page.mouse.move(x, y);
for (let i = 0; i < 14; i += 1) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/close-up-01.png` });
// Rotate a bit (Q) for a second angle.
await page.keyboard.down("KeyQ"); await page.waitForTimeout(500); await page.keyboard.up("KeyQ");
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/close-up-02.png` });
// Back out a bit: mid zoom.
for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, 240); await page.waitForTimeout(100); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/close-up-03-mittel.png` });
console.log("errors", errors.length, errors.slice(0, 2));
await browser.close();
