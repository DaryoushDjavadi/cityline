import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:5173";
const ARTIFACTS = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

type E2E = {
  snapshot: () => { playing: boolean; harbors: number; airports: number; homes: number };
  apply: (command: unknown) => void;
  lookAt: (x: number, y: number, distance?: number, polar?: number, lift?: number, azimuth?: number) => void;
  setHour: (hour: number) => void;
  findCoast: () => { x: number; y: number } | null;
  findHarbor: () => { x: number; y: number } | null;
  findBeach: () => { x: number; y: number } | null;
  roadRun: () => { cells: { x: number; y: number }[] } | null;
  cottageSpot: () => { x: number; y: number } | null;
};

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), { timeout: 40_000 });
}

async function enter(page: Page): Promise<void> {
  const gate = page.locator("#name-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#gate-name").fill("Hafen");
    await page.locator("#gate-enter").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
}

async function startSolo(page: Page): Promise<void> {
  await page.locator("#lobby-create > summary").click().catch(() => undefined);
  await page.locator("#map-seed").fill("1842");
  await page.locator("#map-water").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#solo-new").click();
  await page.locator("#lobby").waitFor({ state: "hidden", timeout: 20_000 });
}

async function shotLook(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  name: string,
  hour: number,
  viewport: { width: number; height: number },
  kind: "hills" | "harbor" | "beach" | "mobile",
): Promise<void> {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: kind === "mobile" ? 2 : 1,
    isMobile: kind === "mobile",
    hasTouch: kind === "mobile",
  });
  await page.goto(`${BASE}/?preview=look&hud=0&e2e=1&gfx=high&hour=${hour}`, { waitUntil: "networkidle" });
  await waitReady(page);
  await page.evaluate(({ kind, hour }) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setHour(hour);
    const harbor = e2e.findHarbor();
    const beach = e2e.findBeach();
    if (kind === "beach") {
      const target = beach ?? harbor ?? e2e.findCoast();
      if (target) e2e.lookAt(target.x, target.y, 34, 1.08, 1.8, 0.55);
    } else if (kind === "harbor") {
      const target = harbor ?? e2e.findCoast();
      if (target) e2e.lookAt(target.x, target.y, 40, 1.04, 1.2, 1.05);
    } else if (kind === "mobile") {
      const target = harbor ?? e2e.findCoast();
      if (target) e2e.lookAt(target.x, target.y, 48, 1.1, 2.4, 0.7);
    } else {
      const target = harbor ?? e2e.findCoast();
      if (target) e2e.lookAt(target.x, target.y + 3, 82, 1.16, 4.8, 0.48);
    }
  }, { kind, hour });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(ARTIFACTS, name), type: "png" });
  await page.close();
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  await enter(page);
  await startSolo(page);
  await waitReady(page);
  await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setHour(16);
    const found = e2e.findCoast();
    if (!found) throw new Error("no coast");
    const neighbors = [
      { x: found.x, y: found.y + 1 },
      { x: found.x, y: found.y - 1 },
      { x: found.x + 1, y: found.y },
      { x: found.x - 1, y: found.y },
      { x: found.x + 1, y: found.y + 1 },
      { x: found.x - 1, y: found.y + 1 },
    ];
    for (const cell of neighbors) e2e.apply({ type: "road", cells: [cell.y * 64 + cell.x] });
    e2e.apply({ type: "service", index: found.y * 64 + found.x, kind: 11 });
    for (const cell of neighbors) {
      e2e.apply({ type: "build", kind: "cottage", cells: [(cell.y - 1) * 64 + cell.x] });
      e2e.apply({ type: "build", kind: "cottage", cells: [(cell.y + 1) * 64 + cell.x] });
    }
    const run = e2e.roadRun();
    if (run) e2e.apply({ type: "road", cells: run.cells.map((c) => c.y * 64 + c.x) });
    const air = e2e.cottageSpot();
    if (air) e2e.apply({ type: "service", index: air.y * 64 + air.x, kind: 9 });
    e2e.lookAt(found.x, found.y, 58);
  });

  const built = await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.snapshot());
  if (built.harbors < 1) throw new Error(`harbor not placed ${JSON.stringify(built)}`);
  await page.close();

  await shotLook(browser, "desktop-day.png", 16, { width: 1440, height: 900 }, "hills");
  await shotLook(browser, "harbor-boats.png", 16, { width: 1440, height: 900 }, "harbor");
  await shotLook(browser, "desktop-beach-residents.png", 18, { width: 1440, height: 900 }, "beach");
  await shotLook(browser, "mobile-portrait.png", 16, { width: 390, height: 844 }, "mobile");
  await browser.close();
  console.log("playtest screenshots written", ARTIFACTS, "harborBuilt", built.harbors);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
