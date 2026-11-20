/**
 * Tierpark im Browser: Tierpark in der Stadt bauen (Baumenü), Tor-Panel, Park betreten, Wege ziehen,
 * Gehege und Stände setzen, Tiere im Shop kaufen, Besucher laufen auf Wegen und kaufen (+€),
 * Statistik, Gehege-Bau-Modus im Park (Näpfe, Unterstand), Tier im Park anklicken, Streicheln,
 * Umbenennen, Zucht (Zeitraffer), zurück zur Stadt, Mobile. Screenshots nach SHOTS.
 *   npm run build && PORT=8787 npm start
 *   SHOTS=/workspace/cityline-shots/tierpark npx tsx scripts/zoo-playtest.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/tierpark";
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};
type E2E = Record<string, (...args: any[]) => any>;
const e2e = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args }) as Promise<T>;
const ui = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => {
    const api = (window as unknown as { __citylineE2E: E2E }).__citylineE2E.zooUi() as Record<string, (...a: unknown[]) => unknown>;
    return api[name](...args);
  }, { name, args }) as Promise<T>;
const pk = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => {
    const api = (window as unknown as { __citylineE2E: E2E }).__citylineE2E.parkUi() as Record<string, (...a: unknown[]) => unknown>;
    return api[name](...args);
  }, { name, args }) as Promise<T>;

interface Animal { id: number; name: string; species: string; cell: number; sex: string; health: number; trust: number; happy: number; origin: string; mother?: number; father?: number; family?: string; lineage?: string; gen: number; genes: Record<string, number>; born: number; pregnantUntil?: number }
interface Zoo { habitats: { cell: number; type: string; items: { id: number; kind: string; x: number; y: number; fill?: number }[]; keeper: boolean }[]; animals: Animal[]; visitors: number; income: number; born: number; gate: number; satisfaction: number; sales: number; park?: { tiles: string; entrance: number } }
interface ParkStats { walkers: number; drawCalls: number; triangles: number; grass: number; paths: number; buys: number; looks: number; coins: number; money: number; sits: number; bubbles: number }

/** Park tile index (40×40). */
const P = (x: number, y: number) => y * 40 + x;
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: number[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) out.push(P(x, y));
  return out;
};
const TIERPARK = 20;
/** Habitat anchors (top-left of 5×5) – along the main path and the cross path. */
const CELLS = { savanne: P(15, 33), wald: P(21, 33), wasser: P(15, 26), polar: P(21, 26), wiese: P(9, 21), polar2: P(26, 21) } as const;

/** Hide toasts/menus for clean city screenshots. */
async function clean(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await hideToasts(page);
}
async function hideToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const id of ["#life-toast", "#toast", "#pk-toast"]) {
      const toast = document.querySelector<HTMLElement>(id);
      if (toast) toast.hidden = true;
    }
  });
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
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
}

/** Road with the Tierpark lot above it. */
async function lot(page: Page): Promise<{ x: number; y: number; cell: number }> {
  const area = await e2e<{ x: number; y: number } | null>(page, "findArea", 3, 2);
  if (!area) throw new Error("kein Platz für den Tierpark");
  const idx = (x: number, y: number) => e2e<number>(page, "cellIndex", x, y);
  const road: number[] = [];
  for (let x = area.x; x < area.x + 3; x += 1) road.push(await idx(x, area.y + 1));
  await e2e(page, "apply", { type: "road", cells: road });
  return { x: area.x + 1, y: area.y, cell: await idx(area.x + 1, area.y) };
}

const zooCmd = (page: Page, zoo: Record<string, unknown>) => e2e<{ ok: boolean; reason?: string }>(page, "apply", { type: "zoo", zoo });

/** Lay out the rest of the park by commands (paths, habitats, stands, decor). */
async function layPark(page: Page, skip: Set<string>): Promise<void> {
  const paths = [line(5, 20, 35, 20), line(8, 8, 32, 8), line(8, 9, 8, 19), line(32, 9, 32, 19)];
  if (!skip.has("spine")) paths.unshift(line(20, 4, 20, 33));
  for (const cells of paths) await zooCmd(page, { op: "pbuild", kind: "path", cells });
  for (const [kind, cell] of Object.entries(CELLS)) {
    if (skip.has(kind)) continue;
    await zooCmd(page, { op: "pbuild", kind: kind === "polar2" ? "polar" : kind, cells: [cell] });
  }
  const objects: [string, number[]][] = [
    ["food", skip.has("food") ? [P(9, 19)] : [P(19, 31), P(9, 19)]],
    ["drink", [P(21, 31), P(31, 19)]],
    ["souvenir", [P(19, 21)]],
    ["toilet", [P(21, 19), P(19, 9)]],
    ["bench", [P(19, 19), P(14, 19), P(26, 19), P(21, 21), P(19, 38), P(33, 21)]],
    ["bin", [P(21, 38), P(16, 21), P(24, 21), P(21, 7)]],
    ["tree", [P(7, 23), P(12, 17), P(28, 16), P(27, 12), P(14, 12), P(35, 26), P(4, 31), P(34, 35), P(6, 36), P(24, 14), P(16, 15), P(36, 14), P(10, 30), P(31, 30), P(6, 12), P(34, 4), P(5, 4)]],
    ["flowers", [P(18, 38), P(22, 38), P(19, 25), P(21, 25), P(13, 21), P(25, 19), P(18, 7), P(22, 7), P(20, 3), P(15, 19)]],
  ];
  for (const [kind, cells] of objects) {
    await zooCmd(page, { op: "pbuild", kind, cells });
  }
}

/** Every visible walker stands on a path or the entrance. */
async function walkersOnPaths(page: Page): Promise<{ total: number; off: number }> {
  const zoo = await e2e<Zoo>(page, "zoo");
  const tiles = zoo.park?.tiles ?? "";
  const walkers = await pk<{ x: number; y: number }[]>(page, "walkers");
  let off = 0;
  for (const w of walkers) {
    const code = tiles.charCodeAt(P(Math.floor(w.x), Math.floor(w.y))) - 97;
    if (code !== 1 && code !== 2) off += 1;
  }
  return { total: walkers.length, off };
}

/** Drag on the park canvas between two tiles. */
async function dragTiles(page: Page, from: number, to: number): Promise<void> {
  const a = await pk<{ x: number; y: number }>(page, "tileScreen", from);
  const b = await pk<{ x: number; y: number }>(page, "tileScreen", to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8);
  await page.mouse.up();
  await page.waitForTimeout(250);
}


const FIX_SHOTS = process.env.FIX_SHOTS ?? "/workspace/cityline-shots/fix-innen";
mkdirSync(FIX_SHOTS, { recursive: true });
const settle = (page: Page) => page.waitForFunction(() => !(window as any).__citylineE2E.parkUi().flying(), undefined, { timeout: 8000 }).catch(() => undefined);

/**
 * Regression: the habitat build mode (replaces the old interior view) must always let you out –
 * via "✓ Fertig" (real click/tap at its position) and via Escape, one step per press – into a
 * park that keeps rendering and reacting, and from there to the city. Repeated visits must not
 * leak WebGL contexts (there is only the park canvas now).
 */
async function buildRegression(page: Page, mobile: boolean): Promise<void> {
  const tag = mobile ? "Mobile" : "Desktop";
  const press = async (selector: string) => {
    const locator = page.locator(selector);
    if (mobile) await locator.tap();
    else await locator.click();
  };
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (/Too many active WebGL contexts|Context Lost/i.test(msg.text())) warnings.push(msg.text());
  });
  /** Habitat panel on its overview (an animal picked shows its card first). */
  const openPanel = async () => {
    await pk(page, "openHabitat", CELLS.savanne);
    await page.waitForTimeout(200);
    const list = page.locator('#zoo-panel [data-act="list"]');
    if (await list.isVisible().catch(() => false)) await list.click();
    await page.waitForTimeout(100);
  };
  const state = () => page.evaluate(() => ({
    build: document.body.dataset.zooBuild === "on",
    dim: !(document.querySelector("#pk-dim") as HTMLElement).hidden,
    park: !(document.querySelector("#park-view") as HTMLElement).hidden,
    panel: !(document.querySelector("#zoo-panel") as HTMLElement).hidden,
    canvases: document.querySelectorAll("#zoo-canvas").length,
  }));
  if (!(await pk<boolean>(page, "isOpen"))) await pk(page, "enter");
  await page.waitForTimeout(400);
  await pk(page, "lookAt", P(17, 33), mobile ? 70 : 60);
  await openPanel();
  await press("#zoo-build");
  await page.waitForTimeout(600);
  let now = await state();
  check(now.build && now.dim && now.canvases === 0, `${tag}: Bau-Modus im Park, Umgebung gedimmt, kein zweites Canvas (${JSON.stringify(now)})`);

  // A. "✓ Fertig", clicked/tapped at its real position.
  const box = (await page.locator("#zb-done").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest("#zb-done") !== null, { x: cx, y: cy });
  check(hit, `${tag}: »✓ Fertig« ist sichtbar und nicht verdeckt`);
  if (mobile) await page.touchscreen.tap(cx, cy);
  else await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  now = await state();
  check(!now.build && !now.dim && now.park && now.panel, `${tag}: Fertig beendet den Bau-Modus, Park und Panel bleiben (${JSON.stringify(now)})`);
  const before = JSON.stringify(await pk(page, "walkers"));
  await page.waitForTimeout(700);
  const after = JSON.stringify(await pk(page, "walkers"));
  check(before !== after, `${tag}: Park-Szene läuft danach weiter`);
  await hideToasts(page);
  await page.screenshot({ path: path.join(FIX_SHOTS, `${mobile ? "mobile" : "desktop"}-nach-baumodus.png`) });
  // Controls still work: clicking/tapping the habitat opens its panel again.
  await page.locator("#zoo-close").click().catch(() => undefined);
  await page.waitForTimeout(200);
  await pk(page, "lookAt", P(17, 33), mobile ? 70 : 60);
  await page.waitForTimeout(200);
  const spot = await pk<{ x: number; y: number }>(page, "tileScreen", CELLS.savanne + 41);
  if (mobile) await page.touchscreen.tap(spot.x, spot.y);
  else await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(400);
  check((await state()).panel, `${tag}: Park reagiert danach wieder (Gehege antippen öffnet das Panel)`);
  await openPanel();

  // B. Escape, one step per press: tool → build mode → panel → park → city.
  await press("#zoo-build");
  await page.waitForTimeout(300);
  await press('.zb-item[data-id="rock"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check((await ui<{ tool: string | null } | null>(page, "build"))?.tool === null && (await state()).build, `${tag}: Esc legt zuerst das Werkzeug weg`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  now = await state();
  check(!now.build && now.park && now.panel, `${tag}: Esc beendet dann den Bau-Modus (${JSON.stringify(now)})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  now = await state();
  check(!now.panel && now.park, `${tag}: Esc schließt dann das Gehege-Panel`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  now = await state();
  check(!now.park, `${tag}: Esc führt dann zurück in die Stadt`);
  const frameMs = await page.evaluate(() => (window as Window & { __cityline?: { frameMs?: number } }).__cityline?.frameMs);
  check(typeof frameMs === "number", `${tag}: Stadt rendert wieder`);

  // C. "Zur Stadt" straight out of the build mode.
  await pk(page, "enter");
  await page.waitForTimeout(300);
  await openPanel();
  await press("#zoo-build");
  await page.waitForTimeout(300);
  await page.evaluate(() => (document.querySelector('#park-view [data-act="back"]') as HTMLElement).click());
  await page.waitForTimeout(300);
  now = await state();
  check(!now.park && !now.build && !now.panel, `${tag}: »← Zur Stadt« aus dem Bau-Modus räumt alles auf (${JSON.stringify(now)})`);

  // D. Many visits: no leaked WebGL contexts, build mode works every time.
  let opened = 0;
  for (let round = 0; round < 12; round += 1) {
    await pk(page, "enter");
    await page.waitForTimeout(150);
    await openPanel();
    await press("#zoo-build");
    await page.waitForTimeout(150);
    if ((await state()).build) opened += 1;
    await press("#zb-done");
    await page.waitForTimeout(80);
    await pk(page, "leave");
  }
  check(opened === 12 && warnings.length === 0, `${tag}: 12 Besuche mit Bau-Modus ohne verlorene WebGL-Kontexte (${opened}/12, ${warnings.length} Warnungen)`);
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const errors: string[] = [];

// ---------------------------------------------------------------- Desktop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror:", String(err)); });
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await boot(page);
  await e2e(page, "showcase", 10);
  await e2e(page, "setOverlay", { zones: false });
  await e2e(page, "dismissUi");
  const site = await lot(page);
  await e2e(page, "lookAt", site.x, site.y, 40, 0.9, 0, 0.5);
  await page.waitForTimeout(400);

  // 1. City build menu: Zoo category (key 9) has exactly the Tierpark.
  await page.keyboard.press("9");
  await page.waitForTimeout(250);
  const zooTiles = await page.locator(".build-item").evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent ?? ""));
  check(zooTiles.length === 1 && zooTiles[0].includes("Tierpark"), `Zoo-Kategorie zeigt nur den Tierpark (${zooTiles.join(" | ")})`);
  await page.locator(".build-item").filter({ hasText: "Tierpark" }).hover();
  await page.waitForTimeout(350);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-01-stadt-baumenue.png") });
  await page.locator(".build-item").filter({ hasText: "Tierpark" }).click();
  const screen = await e2e<{ x: number; y: number }>(page, "cellScreen", site.x, site.y);
  const fundsBefore = (await e2e(page, "snapshot")).funds;
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check((await e2e<number>(page, "countService", TIERPARK)) === 1, "Tierpark per Baumenü gebaut");
  const spent = fundsBefore - (await e2e(page, "snapshot")).funds;
  check(spent >= 4000 && spent <= 5000, `Tierpark kostet ${spent} €`);
  const second = await e2e<number>(page, "cellIndex", site.x + 1, site.y);
  await e2e(page, "apply", { type: "service", index: second, kind: TIERPARK });
  check((await e2e<number>(page, "countService", TIERPARK)) === 1, "Nur ein Tierpark pro Stadt");
  const legacy = await e2e<{ ok: boolean; reason?: string } | undefined>(page, "apply", { type: "service", index: second, kind: 15 });
  check((await e2e<number>(page, "countService", 15)) === 0, `Alte Gehege lassen sich nicht mehr in der Stadt bauen (${JSON.stringify(legacy)})`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("0");
  await e2e(page, "advanceZoo", 4);
  let zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.park && zoo.gate === site.cell, "Park-Zustand entsteht mit dem Tor");

  // 2. Click the gate: panel with "Tierpark betreten".
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(300);
  check(await page.locator("#park-gate").isVisible(), "Klick aufs Tor öffnet das Tierpark-Panel");
  check(await page.locator("#park-gate .pk-enter").isVisible(), "Knopf »Tierpark betreten«");
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-03-tor-panel.png") });
  await page.locator("#park-gate .pk-enter").click();
  await page.waitForTimeout(500);
  check(await page.locator("#park-view").isVisible(), "Park-Level ist offen");
  check(await page.evaluate(() => document.body.dataset.park === "on" && [...document.querySelectorAll("#hud > :not(#toast):not(#status), #life")].every((el) => getComputedStyle(el).visibility === "hidden")), "Stadt-HUD ist im Park ausgeblendet");

  // 3. Build in the park via the UI: path drag, savanna habitat, food stand.
  await pk(page, "lookAtWorld", 0, 4, 105);
  await page.waitForTimeout(300);
  await page.locator('.pk-tab[data-tab="paths"]').click();
  await page.locator('.pk-item[data-tool="path"]').click();
  await dragTiles(page, P(20, 33), P(20, 4));
  zoo = await e2e<Zoo>(page, "zoo");
  const pathCount = [...(zoo.park?.tiles ?? "")].filter((c) => c === "b").length;
  check(pathCount >= 34, `Weg per Ziehen gebaut (${pathCount} Wegfelder)`);
  await page.locator('.pk-tab[data-tab="habitat"]').click();
  await page.locator('.pk-item[data-tool="savanne"]').click();
  let at = await pk<{ x: number; y: number }>(page, "tileScreen", P(17, 35));
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.habitats.some((h) => h.cell === CELLS.savanne && h.type === "savanne"), `Savannen-Gehege im Park gebaut (${zoo.habitats.map((h) => h.cell).join(",")})`);
  await pk(page, "lookAt", P(19, 32), 38, 0.25);
  await page.waitForTimeout(250);
  await page.locator('.pk-tab[data-tab="stands"]').click();
  await page.locator('.pk-item[data-tool="food"]').click();
  at = await pk<{ x: number; y: number }>(page, "tileScreen", P(19, 31));
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(250);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-05-baumenue-park.png") });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.park?.tiles[P(19, 31)] === "d", "Essensstand am Weg gebaut");
  // Blocked: a stand on top of the habitat.
  at = await pk<{ x: number; y: number }>(page, "tileScreen", P(17, 35));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  check(await page.locator("#pk-toast").isVisible(), "Bauen aufs Gehege zeigt einen Hinweis");
  await layPark(page, new Set(["spine", "savanne", "food"]));
  await page.locator('.pk-tab[data-act="select"]').click();
  zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.habitats.length === 6, `6 Gehege im Park (${zoo.habitats.length})`);

  // 4. Habitat panel by clicking the habitat; shop with origins.
  await pk(page, "lookAt", P(17, 33), 60);
  await page.waitForTimeout(300);
  at = await pk<{ x: number; y: number }>(page, "habitatScreen", CELLS.savanne);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
  check(await page.locator("#zoo-panel").isVisible(), "Klick aufs Gehege im Park öffnet das Gehege-Panel");
  check(await page.locator("#zoo-build").isVisible() && (await page.locator("#zoo-open-interior").count()) === 0, "Panel hat den Knopf Bauen (keine Innenansicht mehr)");
  await settle(page);
  check((await pk<{ distance: number }>(page, "camera"))!.distance <= 26, "Kamera fährt ans Gehege heran");
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-09-gehege-panel.png") });
  await page.locator("#zoo-open-shop").click();
  await page.locator("#zoo-shop").waitFor({ state: "visible" });
  check(await page.locator(".shop-origin").count() === 4, "Shop bietet vier Herkünfte");
  check(await page.locator(".shop-species:not([disabled])").count() === 5, "Fünf Arten passen in die Savanne");
  const buys: [string, string][] = [["zebra", "rescue"], ["giraffe", "circus"], ["kangaroo", "breeder"], ["kangaroo", "wild"]];
  for (const [species, origin] of buys) {
    await page.locator(`.shop-species[data-id="${species}"]`).click();
    await page.locator(`.shop-origin[data-id="${origin}"]`).click();
    if (species === "giraffe") {
      await page.waitForTimeout(200);
      check(await page.locator('.shop-species.clash[data-id="lion"]').count() === 1, "Löwe ist neben Zebras gesperrt (Raubtier)");
      await page.screenshot({ path: path.join(SHOTS, "tp-10-shop.png") });
    }
    await page.locator("#shop-buy").click();
    await page.waitForTimeout(150);
    if (!(species === "kangaroo" && origin === "wild")) {
      await page.locator('#zoo-panel [data-act="list"]').click();
      await page.locator("#zoo-open-shop").click();
      await page.locator("#zoo-shop").waitFor({ state: "visible" });
    }
  }
  zoo = await e2e<Zoo>(page, "zoo");
  const savanna = zoo.animals.filter((a) => a.cell === CELLS.savanne);
  check(savanna.length === 4, `Vier Tiere in der Savanne (${savanna.length})`);
  const byOrigin = (o: string) => savanna.find((a) => a.origin === o);
  check(byOrigin("rescue") && byOrigin("rescue")!.health <= 40, `Rettungstier startet krank (${byOrigin("rescue")?.health})`);
  check(byOrigin("circus") && byOrigin("circus")!.trust <= 25, "Zirkustier startet ängstlich");
  check(new Set(savanna.map((a) => a.name)).size === 4, `Vier verschiedene Namen (${savanna.map((a) => a.name).join(", ")})`);
  await page.locator("#zoo-close").click();

  // Fill the other habitats via commands.
  const buy = (cell: number, species: string, origin: string) => zooCmd(page, { op: "buy", cell, species, origin });
  await buy(CELLS.wald, "monkey", "rescue");
  await buy(CELLS.wald, "redpanda", "breeder");
  await buy(CELLS.wasser, "flamingo", "breeder");
  await buy(CELLS.wasser, "flamingo", "breeder");
  await buy(CELLS.wasser, "otter", "wild");
  await buy(CELLS.wasser, "seal", "breeder");
  await buy(CELLS.polar, "penguin", "breeder");
  await buy(CELLS.polar, "penguin", "breeder");
  await buy(CELLS.polar2, "polarbear", "breeder");
  await buy(CELLS.polar2, "polarbear", "breeder");
  await buy(CELLS.wiese, "goat", "breeder");
  await buy(CELLS.wiese, "alpaca", "breeder");
  await buy(CELLS.wiese, "rabbit", "breeder");
  for (const cell of Object.values(CELLS)) await zooCmd(page, { op: "keeper", cell, on: true });
  await e2e(page, "advanceZoo", 40);
  zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.visitors > 20 && zoo.income > 0 && zoo.sales > 0, `Besucher kommen und kaufen (${zoo.visitors} Besucher, +${zoo.income} €/Schritt, Stände ${zoo.sales} €)`);
  check(zoo.satisfaction >= 60, `Zufriedenheit ${zoo.satisfaction} %`);

  // 5. Visitors: re-enter so the crowd is warmed up, then watch.
  await page.locator('#park-view [data-act="back"]').click();
  await page.waitForTimeout(300);
  check(await page.locator("#park-view").isHidden(), "← Zur Stadt verlässt den Park");
  await e2e(page, "lookAt", site.x, site.y + 0.2, 26, 0.86, 0, 0.55);
  await page.waitForTimeout(1600);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-02-stadt-tierpark-aussen.png") });
  const layer = await e2e<{ visitors: number }>(page, "zooLayer");
  check(layer.visitors >= 3, `Besucher-Schlange am Tor in der Stadt (${layer.visitors})`);
  await pk(page, "enter");
  await page.waitForTimeout(3500);
  let stats = await pk<ParkStats>(page, "stats");
  check(stats.walkers >= 40, `Viele Besucher im Park (${stats.walkers})`);
  check(stats.drawCalls <= 60, `Wenige Draw Calls im Park (${stats.drawCalls}, ${stats.triangles} Dreiecke)`);
  let onPath = await walkersOnPaths(page);
  check(onPath.total > 0 && onPath.off === 0, `Besucher laufen nur auf Wegen (${onPath.off}/${onPath.total} daneben)`);
  await pk(page, "lookAtWorld", 0, 13, 92);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#pk-hint")!).visibility === "hidden", undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-04-park-uebersicht.png") });
  await pk(page, "lookAt", P(20, 29), 26, 0.35);
  await page.waitForTimeout(2500);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-06-besucher-gehege.png") });
  await pk(page, "lookAt", P(19, 31), 24, -0.35);
  for (let k = 0; k < 40; k += 1) {
    await page.waitForTimeout(150);
    if ((await page.locator(".pk-coin").count()) > 0) break;
  }
  await page.waitForTimeout(350);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-07-besucher-essensstand.png") });
  await page.waitForTimeout(6000);
  stats = await pk<ParkStats>(page, "stats");
  check(stats.buys > 0 && stats.coins > 0 && stats.money > 0, `Besucher kaufen an Ständen, +€ schwebt (${stats.buys} Käufe, ${stats.money} €)`);
  check(stats.looks > 0, `Besucher schauen Gehege an (${stats.looks})`);
  onPath = await walkersOnPaths(page);
  check(onPath.off === 0, `Auch später alle auf Wegen (${onPath.off}/${onPath.total})`);

  // 6. Stats panel.
  await pk(page, "lookAtWorld", -6, 10, 92);
  await page.locator('#park-view [data-act="stats"]').click();
  await page.waitForTimeout(400);
  check(await page.locator("#pk-stats").isVisible(), "Statistik-Panel offen");
  const statText = (await page.locator("#pk-stats").textContent()) ?? "";
  check(/Zufriedenheit/.test(statText) && /Besucher/.test(statText) && /Tag/.test(statText), "Statistik zeigt Besucher, Zufriedenheit, Einnahmen pro Tag");
  const box = await page.locator("#pk-stats").boundingBox();
  const bar = await page.locator("#pk-build").boundingBox();
  check(box && bar && (box.y + box.height <= bar.y || box.x + box.width <= bar.x || box.x >= bar.x + bar.width), "Statistik überdeckt die Bauleiste nicht");
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-08-statistik.png") });
  await page.locator('#park-view [data-act="stats"]').click();

// 7. Build mode in the polar habitat (in the park): place items, pet, rename.
  await pk(page, "openHabitat", CELLS.polar);
  await settle(page);
  await page.locator("#zoo-build").click();
  await settle(page);
  await page.waitForTimeout(200);
  check((await ui<{ cell: number } | null>(page, "build"))?.cell === CELLS.polar, "Bau-Modus im Park geöffnet");
  const itemsBefore = (await e2e<Zoo>(page, "zoo")).habitats.find((h) => h.cell === CELLS.polar)!.items.length;
  for (const [kind, x, y] of [["toy", 2, 2], ["shelter", 6, 4], ["food", 1, 6], ["rock", 6, 6]] as const) {
    await page.locator(`.zb-item[data-id="${kind}"]`).click();
    const spot = await pk<{ x: number; y: number }>(page, "spotScreen", x, y);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(80);
  }
  let polar = (await e2e<Zoo>(page, "zoo")).habitats.find((h) => h.cell === CELLS.polar)!;
  check(polar.items.length === itemsBefore + 4, `Einrichtung platziert (${itemsBefore} → ${polar.items.length})`);
  check(polar.items.filter((i) => i.kind === "food").length === 2, "Zweiter Futternapf steht");
  await e2e(page, "advanceZoo", 4);
  await page.waitForTimeout(500);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-11-baumodus.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check((await ui(page, "build")) === null, "Esc beendet den Bau-Modus");

  // pet a penguin – clicked in the park
  zoo = await e2e<Zoo>(page, "zoo");
  const penguins = zoo.animals.filter((a) => a.species === "penguin");
  const target = penguins[0];
  await ui(page, "select", target.id);
  await settle(page);
  await page.waitForTimeout(300);
  const pos = await pk<{ x: number; y: number }>(page, "animalScreen", target.id);
  await page.locator('#zoo-panel [data-act="list"]').click();
  await page.waitForTimeout(100);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(250);
  check((await ui<number>(page, "selected")) === target.id, "Klick aufs Tier im Park wählt es aus");
  check(await page.locator("#zoo-panel .zoo-card").isVisible(), "Tierkarte im Panel");
  const trustBefore = target.trust;
  await page.locator('#zoo-panel .zoo-care[data-care="pet"]').click();
  await page.waitForTimeout(450);
  check((await pk<number>(page, "bursts")) > 0, "Herzen steigen am Tier im Park auf");
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-12-streicheln.png") });
  const petted = (await e2e<Zoo>(page, "zoo")).animals.find((a) => a.id === target.id)!;
  check(petted.trust > trustBefore, `Streicheln erhöht Vertrauen (${trustBefore} → ${petted.trust})`);
  check(await page.locator('#zoo-panel .zoo-care[data-care="pet"]').isDisabled(), "Streicheln hat Cooldown");
  // rename with validation
  await page.locator("#zoo-panel #zoo-name").fill("<script>");
  await page.locator('#zoo-panel [data-act="rename"]').click();
  check(await page.locator("#zoo-panel #zoo-name-error").isVisible(), "Ungültiger Name zeigt Fehler");
  await page.locator("#zoo-panel #zoo-name").fill("Kapitän Pingu");
  await page.locator("#zoo-panel #zoo-name").press("Enter");
  await page.waitForTimeout(150);
  check((await e2e<Zoo>(page, "zoo")).animals.find((a) => a.id === target.id)!.name === "Kapitän Pingu", "Umbenennen klappt");

  // 5. Breeding with time compression.
  let child: Animal | undefined;
  for (let round = 0; round < 60 && !child; round += 1) {
    await e2e(page, "advanceZoo", 100);
    zoo = await e2e<Zoo>(page, "zoo");
    child = zoo.animals.find((a) => a.species === "penguin" && a.mother !== undefined);
  }
  check(child, "Pinguin-Nachwuchs geboren (Zeitraffer)");
  if (child) {
    const mother = zoo.animals.find((a) => a.id === child!.mother)!;
    const father = zoo.animals.find((a) => a.id === child!.father)!;
    check(child.family === `${father.name}-&-${mother.name}`, `Familienname ${child.family}`);
    // Focus the family: select the mother (camera comes closer), then back to the list.
    await ui(page, "select", mother.id);
    await settle(page);
    await page.locator('#zoo-panel [data-act="list"]').click().catch(() => undefined);
    await page.waitForTimeout(600);
    await hideToasts(page);
    await page.screenshot({ path: path.join(SHOTS, "tp-13-jungtier.png") });
    const at = await pk<{ x: number; y: number } | null>(page, "animalScreen", child.id);
    if (at) await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    if ((await ui<number>(page, "selected")) !== child.id) await ui(page, "select", child.id);
    await page.waitForTimeout(1300);
    check(await page.locator("#zoo-panel .zoo-tree").isVisible(), "Stammbaum sichtbar");
    check((await page.locator("#zoo-panel .zoo-tree").textContent())?.includes(mother.name), "Stammbaum nennt die Mutter");
    check(await page.locator("#zoo-panel .zoo-gene").count() === 5, "Fünf Gene in der Karte");
    await page.locator("#zoo-panel .zoo-genes").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "tp-14-gene-stammbaum.png") });
  }

  // 6. Close the panel, then back to the city.
  await page.locator('#zoo-close').click().catch(() => undefined);
  check(await page.locator("#park-view").isVisible(), "Panel zu – man steht weiter im Tierpark");
  await page.locator('#park-view [data-act="back"]').click();
  await page.waitForTimeout(300);
  check(await page.locator("#park-view").isHidden(), "Zur Stadt schließt den Park");
  const ready = await page.evaluate(() => (window as Window & { __cityline?: { frameMs?: number } }).__cityline?.frameMs);
  check(typeof ready === "number", "Stadt rendert wieder");
  await buildRegression(page, false);
  await page.close();
}

// ---------------------------------------------------------------- Mobile
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => errors.push(String(err)));
  await boot(page);
  await e2e(page, "showcase", 10);
  await e2e(page, "setOverlay", { zones: false });
  await e2e(page, "dismissUi");
  const site = await lot(page);
  await e2e(page, "apply", { type: "service", index: site.cell, kind: TIERPARK });
  await e2e(page, "advanceZoo", 2);
  await layPark(page, new Set());
  for (const [species, origin] of [["elephant", "breeder"], ["zebra", "circus"], ["giraffe", "wild"]]) await zooCmd(page, { op: "buy", cell: CELLS.savanne, species, origin });
  await zooCmd(page, { op: "buy", cell: CELLS.wiese, species: "goat", origin: "breeder" });
  await zooCmd(page, { op: "buy", cell: CELLS.polar, species: "penguin", origin: "breeder" });
  await e2e(page, "advanceZoo", 40);
  await e2e(page, "openHabitat", site.cell);
  await page.waitForTimeout(300);
  const gateBox = await page.locator("#park-gate").boundingBox();
  check(gateBox && gateBox.x >= 0 && gateBox.x + gateBox.width <= 390, "Mobile: Tor-Panel passt in die Breite");
  await page.locator("#park-gate .pk-enter").tap();
  await page.waitForTimeout(3000);
  await hideToasts(page);
  const top = await page.locator("#park-view .pk-top").boundingBox();
  const bar = await page.locator("#pk-build").boundingBox();
  const hint = await page.locator("#pk-hint").boundingBox();
  check(bar && bar.x >= 0 && bar.x + bar.width <= 391 && bar.y + bar.height <= 845, `Mobile: Bauleiste im Bild (${JSON.stringify(bar)})`);
  check(top && bar && top.y + top.height < bar.y, "Mobile: Kopfzeile und Bauleiste überlappen nicht");
  check(!hint || !bar || hint.y + hint.height <= bar.y + 1, "Mobile: Hinweis über der Bauleiste");
  const tabSize = await page.locator(".pk-tab").first().boundingBox();
  check(tabSize && tabSize.height >= 36, `Mobile: Tabs groß genug zum Tippen (${tabSize?.height})`);
  await page.screenshot({ path: path.join(SHOTS, "tp-m1-park.png") });
  await page.locator('.pk-tab[data-tab="stands"]').tap();
  await page.locator('.pk-item[data-tool="drink"]').tap();
  await page.waitForTimeout(200);
  const before = (await e2e<Zoo>(page, "zoo")).park!.tiles;
  const target = await pk<{ x: number; y: number }>(page, "tileScreen", P(21, 22));
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForTimeout(300);
  const afterTiles = (await e2e<Zoo>(page, "zoo")).park!.tiles;
  check(afterTiles !== before, "Mobile: Stand per Tippen gebaut");
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-m2-baumenue.png") });
  await page.locator('.pk-tab[data-act="select"]').tap();
  await page.locator('#park-view [data-act="stats"]').tap();
  await page.waitForTimeout(300);
  const stats = await page.locator("#pk-stats").boundingBox();
  check(stats && stats.x >= 0 && stats.x + stats.width <= 391, "Mobile: Statistik passt in die Breite");
  const mBar = await page.locator("#pk-build").boundingBox();
  check(stats && mBar && stats.y + stats.height <= mBar.y, "Mobile: Statistik über der Bauleiste");
  check(await page.locator("#pk-hint").evaluate((el) => getComputedStyle(el).visibility === "hidden"), "Mobile: Hinweis weicht der Statistik");
  await page.screenshot({ path: path.join(SHOTS, "tp-m3-statistik.png") });
  await page.locator('#park-view [data-act="stats"]').tap();
  await pk(page, "openHabitat", CELLS.savanne);
  await page.waitForTimeout(500);
  await hideToasts(page);
  const panel = await page.locator("#zoo-panel").boundingBox();
  check(panel && panel.x >= 0 && panel.x + panel.width <= 391, "Mobile: Gehege-Panel passt in die Breite");
  check(await page.locator("#pk-build").isHidden() || !(await page.locator("#pk-build").boundingBox()), "Mobile: Bauleiste weicht dem Gehege-Panel");
  await page.screenshot({ path: path.join(SHOTS, "tp-m4-gehege-panel.png") });
  await settle(page);
  const z = await e2e<Zoo>(page, "zoo");
  const pick = z.animals.find((a) => a.cell === CELLS.savanne && a.species === "elephant")!;
  const pos = await pk<{ x: number; y: number }>(page, "animalScreen", pick.id);
  await page.touchscreen.tap(pos.x, pos.y);
  await page.waitForTimeout(400);
  check((await ui<number>(page, "selected")) === pick.id, `Mobile: Tier im Park antippen wählt es (${await ui(page, "selected")})`);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "tp-m5-tierkarte.png") });
  const side = await page.locator("#zoo-panel").boundingBox();
  check(!side || (side.x >= 0 && side.x + side.width <= 391), "Mobile: Tierkarte passt");
  await page.locator('#zoo-panel [data-act="list"]').tap();
  await buildRegression(page, true);
  await page.close();
}

await browser.close();
const relevant = errors.filter((e) => !/favicon|WebGL|GPU stall|ERR_CONNECTION/.test(e));
check(relevant.length === 0, `Keine Seitenfehler (${relevant.slice(0, 3).join(" | ")})`);
if (failures.length) {
  console.log(`zoo-playtest: ${failures.length} Fehler`);
  process.exit(1);
}
console.log("zoo-playtest ok");
