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
  lookSea: (kind: "harbor" | "boats" | "overview" | "beach" | "airport") => void;
  setHour: (hour: number) => void;
  setChrome: (on: boolean) => void;
  inspectCell: (x: number, y: number) => void;
  findCoast: () => { x: number; y: number } | null;
  findHarbor: () => { x: number; y: number } | null;
  findBeach: () => { x: number; y: number } | null;
  findAirport: () => { x: number; y: number } | null;
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

async function shot(page: Page, name: string, hour: number, aim: "overview" | "harbor" | "boats" | "beach" | "airport" | "night"): Promise<void> {
  await page.evaluate(({ hour, aim }) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setChrome(false);
    e2e.setHour(hour);
    e2e.lookSea(aim === "night" ? "overview" : aim);
  }, { hour, aim });
  await page.waitForTimeout(aim === "boats" ? 2200 : aim === "harbor" ? 900 : 1600);
  await page.screenshot({ path: path.join(ARTIFACTS, name), type: "png" });
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
    const plant = e2e.cottageSpot();
    if (plant) {
      e2e.apply({ type: "service", index: plant.y * 64 + plant.x, kind: 1 });
      e2e.apply({ type: "line", cells: [plant.y * 64 + plant.x, found.y * 64 + found.x] });
    }
  });

  const built = await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.snapshot());
  if (built.harbors < 1) throw new Error(`harbor not placed ${JSON.stringify(built)}`);

  await shot(page, "overview-day.png", 7, "overview");
  await shot(page, "harbor-closeup.png", 7.2, "harbor");
  await shot(page, "boats-sea.png", 8, "boats");
  await shot(page, "beach-closeup.png", 16, "beach");
  await shot(page, "airport.png", 10, "airport");
  await shot(page, "night.png", 21.5, "night");

  await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setChrome(true);
    e2e.setHour(11);
    const harbor = e2e.findHarbor();
    if (harbor) {
      e2e.lookSea("harbor");
      e2e.inspectCell(harbor.x, harbor.y);
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACTS, "trade-panel.png"), type: "png" });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${BASE}/?preview=look&hud=0&e2e=1&gfx=high&hour=7`, { waitUntil: "networkidle" });
  await waitReady(mobile);
  await mobile.waitForTimeout(1400);
  await mobile.screenshot({ path: path.join(ARTIFACTS, "mobile-portrait.png"), type: "png" });
  await mobile.close();
  await page.close();
  await browser.close();
  console.log("playtest screenshots written", ARTIFACTS, "harborBuilt", built.harbors);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
