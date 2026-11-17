import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:5173";
const ARTIFACTS = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

type E2E = {
  apply: (command: unknown) => void;
  setTool: (tool: string) => void;
  cellScreen: (x: number, y: number) => { x: number; y: number } | null;
  lookAt: (x: number, y: number, distance?: number, polar?: number, lift?: number, azimuth?: number) => void;
  setHour: (hour: number) => void;
  setChrome: (on: boolean) => void;
  dismissUi: () => void;
  setOverlay: (flags: { zones?: boolean; power?: boolean; water?: boolean }) => void;
  hideCursor: () => void;
  findPlot: () => { x: number; y: number } | null;
  previewStroke: (x0: number, y0: number, x1: number, y1: number, erase?: boolean) => { cells: number; hint: string; label: string };
  hoverAt: (x: number, y: number) => { hint: string; miss: string | null };
  commitStroke: () => { ok: boolean };
  stats: () => { powerUsed: number; powerCapacity: number; waterUsed: number; waterCapacity: number };
};

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), { timeout: 40_000 });
}

async function enter(page: Page): Promise<void> {
  const gate = page.locator("#name-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#gate-name").fill("Leitung");
    await page.locator("#gate-enter").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
}

async function startSolo(page: Page): Promise<void> {
  await page.locator("#lobby-create > summary").click().catch(() => undefined);
  await page.locator("#map-seed").fill("1842");
  await page.locator("#map-water").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "28";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#solo-new").click();
  await page.locator("#lobby").waitFor({ state: "hidden", timeout: 20_000 });
}

async function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const screen = await page.evaluate(({ x, y }) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    return e2e.cellScreen(x, y);
  }, { x, y });
  if (!screen) throw new Error(`cell ${x},${y} not on screen`);
  return screen;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.dismissUi());
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(ARTIFACTS, name), type: "png" });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  await enter(page);
  await startSolo(page);
  await waitReady(page);

  const origin = await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setChrome(true);
    e2e.setHour(10.5);
    e2e.dismissUi();
    const found = e2e.findPlot();
    if (!found) throw new Error("no inland plot");
    return found;
  });
  const plot = { ox: origin.x, oy: origin.y };
  const cell = (x: number, y: number) => y * 64 + x;
  const road: number[] = [];
  for (let x = plot.ox; x <= plot.ox + 10; x += 1) road.push(cell(x, plot.oy + 3));
  await page.evaluate((payload) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.apply({ type: "road", cells: payload.road });
    e2e.apply({ type: "service", index: payload.power, kind: 1 });
    e2e.apply({ type: "service", index: payload.water, kind: 2 });
    e2e.apply({ type: "build", kind: "cottage", cells: payload.homes });
    e2e.lookAt(payload.lookX, payload.lookY, 46, 0.86, 2.2, 0.32);
  }, {
    road,
    power: cell(plot.ox, plot.oy + 4),
    water: cell(plot.ox + 2, plot.oy + 4),
    homes: [
      cell(plot.ox + 1, plot.oy + 2),
      cell(plot.ox + 3, plot.oy + 2),
      cell(plot.ox + 5, plot.oy + 2),
      cell(plot.ox + 9, plot.oy + 2),
    ],
    lookX: plot.ox + 4,
    lookY: plot.oy + 3,
  });

  const hud = await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.stats());
  if (hud.powerCapacity <= 0 || hud.waterCapacity <= 0) {
    throw new Error(`HUD capacity still 0 ${JSON.stringify(hud)}`);
  }

  await page.evaluate((plot) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.dismissUi();
    e2e.setTool("line");
    e2e.lookAt(plot.ox + 2, plot.oy + 2, 40, 0.7, 1.8, 0.28);
  }, plot);
  const start = { x: plot.ox, y: plot.oy + 3 };
  const corner = { x: plot.ox + 4, y: plot.oy + 3 };
  const end = { x: plot.ox + 4, y: plot.oy + 1 };
  const startScreen = await screenOf(page, start.x, start.y);
  const endScreen = await screenOf(page, end.x, end.y);
  await page.mouse.move(startScreen.x, startScreen.y);
  await page.mouse.down();
  const mid = await screenOf(page, corner.x, corner.y);
  await page.mouse.move(mid.x, mid.y, { steps: 12 });
  await page.mouse.move(endScreen.x, endScreen.y, { steps: 12 });
  const drag = await page.evaluate(({ start, end }) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    return e2e.previewStroke(start.x, start.y, end.x, end.y);
  }, { start, end });
  if (drag.cells < 5 || !drag.label.includes("€")) {
    throw new Error(`drag preview missing path/cost ${JSON.stringify(drag)}`);
  }
  await shot(page, "line-drag-preview.png");
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.commitStroke());

  await page.evaluate((plot) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.dismissUi();
    e2e.setOverlay({ power: true, water: false });
    e2e.setTool("inspect");
    e2e.hideCursor();
    e2e.lookAt(plot.ox + 6, plot.oy + 2, 44, 0.58, 2.6, 0.12);
  }, plot);
  await page.waitForTimeout(280);
  const powerHud = await page.locator("#power").textContent();
  if (!powerHud || powerHud === "0/0" || powerHud.startsWith("0/")) {
    throw new Error(`Strom HUD ${powerHud}`);
  }
  await shot(page, "power-overlay-network.png");

  const pipes: number[] = [];
  for (let x = plot.ox; x <= plot.ox + 6; x += 1) pipes.push(cell(x, plot.oy + 3));
  pipes.push(cell(plot.ox + 6, plot.oy + 2), cell(plot.ox + 6, plot.oy + 1));
  await page.evaluate((pipes) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.apply({ type: "pipe", cells: pipes });
  }, pipes);
  await page.evaluate((plot) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.dismissUi();
    e2e.setOverlay({ power: false, water: true });
    e2e.setTool("inspect");
    e2e.hideCursor();
    e2e.lookAt(plot.ox + 6, plot.oy + 2, 44, 0.58, 2.6, 0.12);
  }, plot);
  await page.waitForTimeout(280);
  const waterHud = await page.locator("#water").textContent();
  if (!waterHud || waterHud === "0/0" || waterHud.startsWith("0/")) {
    throw new Error(`Wasser HUD ${waterHud}`);
  }
  await shot(page, "water-overlay-network.png");

  await page.evaluate(() => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.dismissUi();
    e2e.setOverlay({ power: false, water: false });
    e2e.setTool("cottage");
  });
  const near = { x: plot.ox + 3, y: plot.oy + 4 };
  const far = { x: plot.ox + 8, y: plot.oy + 4 };
  await page.evaluate((near) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.lookAt(near.x, near.y, 36, 0.58, 1.4, 0.12);
  }, near);
  const nearScreen = await screenOf(page, near.x, near.y);
  await page.mouse.move(nearScreen.x, nearScreen.y);
  const nearHint = await page.evaluate((near) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    return e2e.hoverAt(near.x, near.y);
  }, near);
  if (nearHint.miss) throw new Error(`near house should be supplied: ${nearHint.hint}`);
  await shot(page, "supply-ghost-yes.png");

  await page.evaluate((plot) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.setOverlay({ power: false, water: false });
    e2e.apply({ type: "road", cells: [(plot.oy + 5) * 64 + (plot.ox + 8)] });
    e2e.lookAt(plot.ox + 8, plot.oy + 4, 36, 0.58, 1.4, 0.1);
  }, plot);
  const farScreen = await screenOf(page, far.x, far.y);
  await page.mouse.move(farScreen.x, farScreen.y);
  const farHint = await page.evaluate((far) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    return e2e.hoverAt(far.x, far.y);
  }, far);
  if (!farHint.miss || !farHint.miss.includes("Strom") && !farHint.miss.includes("Wasser") && !farHint.hint.includes("verbunden")) {
    throw new Error(`far house should show German supply hint: ${JSON.stringify(farHint)}`);
  }
  const status = await page.locator("#status").textContent();
  if (status?.includes("...")) throw new Error(`status truncated: ${status}`);
  await shot(page, "supply-ghost-no.png");

  await page.evaluate((plot) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.dismissUi();
    e2e.setOverlay({ power: true, water: false });
    e2e.setTool("line");
    e2e.lookAt(plot.ox + 3, plot.oy + 3, 40, 0.62, 1.6, 0.22);
  }, plot);
  const stripA = { x: plot.ox + 2, y: plot.oy + 3 };
  const stripB = { x: plot.ox + 4, y: plot.oy + 3 };
  const stripScreen = await screenOf(page, stripA.x, stripA.y);
  const stripEnd = await screenOf(page, stripB.x, stripB.y);
  await page.mouse.move(stripScreen.x, stripScreen.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(stripEnd.x, stripEnd.y, { steps: 8 });
  await page.evaluate(({ stripA, stripB }) => {
    const e2e = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
    e2e.previewStroke(stripA.x, stripA.y, stripB.x, stripB.y, true);
  }, { stripA, stripB });
  await shot(page, "line-strip-rightclick.png");
  await page.mouse.up({ button: "right" });
  await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.commitStroke());

  await page.close();
  await browser.close();
  console.log("line-playtest screenshots written", ARTIFACTS, "hud", hud);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
