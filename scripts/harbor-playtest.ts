import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:5173";
const ARTIFACTS = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

type E2E = {
  snapshot: () => { playing: boolean; harbors: number; airports: number; homes: number };
  apply: (command: unknown) => void;
  setTool: (tool: string) => void;
  cellScreen: (x: number, y: number) => { x: number; y: number } | null;
  placeReason: (x: number, y: number, tool?: string) => string | null;
  canHarbor: (x: number, y: number) => boolean;
  lookAt: (x: number, y: number, distance?: number, polar?: number, lift?: number, azimuth?: number) => void;
  lookSea: (kind: "harbor" | "boats" | "overview" | "beach" | "airport") => void;
  setHour: (hour: number) => void;
  setChrome: (on: boolean) => void;
  inspectCell: (x: number, y: number) => void;
  findCoast: () => { x: number; y: number } | null;
  findInland: () => { x: number; y: number } | null;
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

  const coast = await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    const found = e2e.findCoast();
    if (!found) throw new Error("no coast");
    e2e.setHour(7.2);
    e2e.setTool("harbor");
    e2e.lookAt(found.x, found.y, 36, 0.94, 1.1, 0.4);
    return found;
  });
  await page.waitForTimeout(400);
  const coastScreen = await page.evaluate((cell) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    const screen = e2e.cellScreen(cell.x, cell.y);
    if (!screen) throw new Error("coast not on screen");
    if (!e2e.canHarbor(cell.x, cell.y)) throw new Error("coast not a harbor site");
    return screen;
  }, coast);
  await page.mouse.move(coastScreen.x, coastScreen.y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(ARTIFACTS, "harbor-ghost-green.png"), type: "png" });
  await page.mouse.click(coastScreen.x, coastScreen.y);
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.snapshot());
  if (afterClick.harbors < 1) {
    await page.evaluate((cell) => {
      const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
      e2e.apply({ type: "service", index: cell.y * 64 + cell.x, kind: 11 });
    }, coast);
  }
  await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setChrome(false);
    e2e.lookSea("harbor");
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(ARTIFACTS, "harbor-placed.png"), type: "png" });

  const inland = await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    const found = e2e.findInland();
    if (!found) throw new Error("no inland");
    e2e.setChrome(true);
    e2e.setTool("harbor");
    e2e.lookAt(found.x, found.y, 42, 0.9, 1.4, 0.2);
    return { cell: found, reason: e2e.placeReason(found.x, found.y, "harbor") };
  });
  const inlandScreen = await page.evaluate((cell) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    return e2e.cellScreen(cell.x, cell.y);
  }, inland.cell);
  if (inlandScreen) {
    await page.mouse.move(inlandScreen.x, inlandScreen.y);
    await page.waitForTimeout(200);
    await page.mouse.click(inlandScreen.x, inlandScreen.y);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ARTIFACTS, "harbor-ghost-red.png"), type: "png" });
  if (inland.reason && !inland.reason.includes("Wasser")) {
    throw new Error(`inland reason ${inland.reason}`);
  }

  await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    const found = e2e.findHarbor() ?? e2e.findCoast();
    if (!found) throw new Error("no coast after place");
    const neighbors = [
      { x: found.x, y: found.y + 1 },
      { x: found.x, y: found.y - 1 },
      { x: found.x + 1, y: found.y },
      { x: found.x - 1, y: found.y },
      { x: found.x + 1, y: found.y + 1 },
      { x: found.x - 1, y: found.y + 1 },
    ];
    for (const cell of neighbors) e2e.apply({ type: "road", cells: [cell.y * 64 + cell.x] });
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
