import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const PORT = Number(process.env.LOOK_PORT ?? 5173);
const OUT = process.env.LOOK_OUT ?? "/opt/cursor/artifacts/look";
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-land", width: 844, height: 390 },
] as const;

const HOURS = [
  { name: "day", hour: 7 },
  { name: "dusk", hour: 18.6 },
  { name: "night", hour: 22 },
] as const;

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), { timeout: 30_000 });
  await page.waitForTimeout(900);
}

async function sampleFps(page: Page, samples = 40): Promise<{ avg: number; p95: number }> {
  const times: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const ms = await page.evaluate(() => (window as Window & { __cityline?: { frameMs: number } }).__cityline?.frameMs ?? 16);
    times.push(ms);
    await page.waitForTimeout(32);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? avg;
  return { avg, p95 };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const report: string[] = [];
  for (const view of VIEWPORTS) {
    for (const slot of HOURS) {
      const page = await browser.newPage({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1 });
      const url = `${BASE}/?preview=look&hud=0&gfx=high&hour=${slot.hour}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await waitReady(page);
      const file = `${view.name}-${slot.name}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, type: "png" });
      const fps = await sampleFps(page);
      const line = `${file}  avgFrame=${fps.avg.toFixed(2)}ms  p95=${fps.p95.toFixed(2)}ms`;
      report.push(line);
      console.log(line);
      await page.close();
    }
  }

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await mobile.goto(`${BASE}/?preview=look&hud=0&gfx=auto&hour=7`, { waitUntil: "networkidle" });
  await waitReady(mobile);
  const quality = await mobile.evaluate(() => (window as Window & { __cityline?: { quality: string } }).__cityline?.quality ?? "?");
  const mobileFps = await sampleFps(mobile);
  await mobile.screenshot({ path: `${OUT}/phone-auto-day.png`, type: "png" });
  report.push(`phone-auto-day.png quality=${quality} avgFrame=${mobileFps.avg.toFixed(2)}ms p95=${mobileFps.p95.toFixed(2)}ms`);
  console.log(report.at(-1));
  await mobile.close();
  await browser.close();
  writeFileSync(`${OUT}/fps.txt`, `${report.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
