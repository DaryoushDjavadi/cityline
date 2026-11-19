/**
 * Zoo im Browser: Gehege über das Baumenü bauen, Tiere jeder Herkunft im Shop kaufen,
 * Innenansicht mit Näpfen/Einrichtung, Streicheln (Herzen), Umbenennen, Zucht bis zum Jungtier
 * (Zeitraffer), Zurück zur Stadt, Mobile. Screenshots nach SHOTS.
 *   npm run build && PORT=8787 npm start
 *   SHOTS=/workspace/cityline-shots/zoo npx tsx scripts/zoo-playtest.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/zoo";
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

interface Animal { id: number; name: string; species: string; cell: number; sex: string; health: number; trust: number; happy: number; origin: string; mother?: number; father?: number; family?: string; lineage?: string; gen: number; genes: Record<string, number>; born: number; pregnantUntil?: number }
interface Zoo { habitats: { cell: number; type: string; items: { id: number; kind: string; x: number; y: number; fill?: number }[]; keeper: boolean }[]; animals: Animal[]; visitors: number; income: number; born: number }

/** Hide toasts/menus for clean city screenshots. */
async function clean(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await hideToasts(page);
}
async function hideToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const id of ["#life-toast", "#toast"]) {
      const toast = document.querySelector<HTMLElement>(id);
      if (toast) toast.hidden = true;
    }
  });
}

const SERVICE = { savanne: 15, wald: 16, wasser: 17, polar: 18, wiese: 19 } as const;

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

/** Road with five habitats above it (and a second savanna below). Returns cells. */
async function layZoo(page: Page, viaMenu: boolean): Promise<{ area: { x: number; y: number }; cells: Record<string, number>; road: number[] }> {
  const area = await e2e<{ x: number; y: number } | null>(page, "findArea", 7, 3);
  if (!area) throw new Error("kein Platz für den Zoo");
  const idx = (x: number, y: number) => e2e<number>(page, "cellIndex", x, y);
  const road: number[] = [];
  for (let x = area.x; x < area.x + 7; x += 1) road.push(await idx(x, area.y + 1));
  await e2e(page, "apply", { type: "road", cells: road });
  const cells: Record<string, number> = {};
  const types = ["savanne", "wald", "wasser", "polar", "wiese"] as const;
  for (let i = 0; i < types.length; i += 1) {
    const type = types[i];
    const cell = await idx(area.x + 1 + i, area.y);
    cells[type] = cell;
    if (viaMenu && type === "savanne") continue;
    await e2e(page, "apply", { type: "service", index: cell, kind: SERVICE[type] });
  }
  // Second polar habitat: the polar bear must not live with the penguins.
  cells.polar2 = await idx(area.x + 6, area.y);
  await e2e(page, "apply", { type: "service", index: cells.polar2, kind: SERVICE.polar });
  return { area, cells, road };
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
  const { area, cells } = await layZoo(page, true);
  const sx = area.x + 1;
  const sy = area.y;
  await e2e(page, "lookAt", sx + 2, sy, 70, 0.95, 0, 0.5);
  await page.waitForTimeout(400);

  // 1. Build menu: Zoo category (key 9), savanna tile (R), click the cell.
  await page.keyboard.press("9");
  await page.waitForTimeout(250);
  const zooTiles = await page.locator(".build-item").evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent ?? ""));
  check(zooTiles.length === 5 && zooTiles.some((t) => t.includes("Savanne")) && zooTiles.some((t) => t.includes("Streichelzoo")), `Zoo-Kategorie zeigt 5 Gehege (${zooTiles.length})`);
  await page.locator(".build-item").filter({ hasText: "Savanne" }).hover();
  await page.waitForTimeout(350);
  await hideToasts(page);
  await page.screenshot({ path: path.join(SHOTS, "zoo-01-baumenue.png") });
  await page.locator(".build-item").filter({ hasText: "Savanne" }).click();
  const screen = await e2e<{ x: number; y: number }>(page, "cellScreen", sx, sy);
  const fundsBefore = (await e2e(page, "snapshot")).funds;
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const built = await e2e<number>(page, "countService", SERVICE.savanne);
  const spent = fundsBefore - (await e2e(page, "snapshot")).funds;
  check(built === 1, "Savannen-Gehege per Baumenü gebaut");
  check(spent > 0 && spent <= 2500, `Gehege ist günstig (${spent} €)`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("0");
  await e2e(page, "advanceZoo", 8);
  let zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.habitats.length === 6, `6 Gehege im Zustand (${zoo.habitats.length})`);
  check(zoo.habitats.every((h) => h.items.some((i) => i.kind === "food") && h.items.some((i) => i.kind === "water")), "Jedes Gehege startet mit Napf und Trog");

  // 2. Habitat panel by clicking the cell with the magnifier, shop with origins.
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(300);
  check(await page.locator("#zoo-panel").isVisible(), "Klick aufs Gehege öffnet das Gehege-Panel");
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, "zoo-02b-gehege-info.png") });
  check(await page.locator("#zoo-open-interior").isVisible(), "Panel hat den Knopf Innenansicht");
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
      await page.screenshot({ path: path.join(SHOTS, "zoo-03-shop-herkunft.png") });
    }
    await page.locator("#shop-buy").click();
    await page.waitForTimeout(150);
    if (!(species === "kangaroo" && origin === "wild")) {
      check(await page.locator("#zoo-panel .zoo-card .zoo-story").isVisible(), `Nach dem Kauf: Karte mit Geschichte (${species})`);
      await page.locator('#zoo-panel [data-act="list"]').click();
      await page.locator("#zoo-open-shop").click();
      await page.locator("#zoo-shop").waitFor({ state: "visible" });
    }
  }
  zoo = await e2e<Zoo>(page, "zoo");
  const savanna = zoo.animals.filter((a) => a.cell === cells.savanne);
  check(savanna.length === 4, `Vier Tiere in der Savanne (${savanna.length})`);
  const byOrigin = (o: string) => savanna.find((a) => a.origin === o);
  check(byOrigin("rescue") && byOrigin("rescue")!.health <= 40, `Rettungstier startet krank (${byOrigin("rescue")?.health})`);
  check(byOrigin("circus") && byOrigin("circus")!.trust <= 25, "Zirkustier startet ängstlich");
  check(byOrigin("breeder") && byOrigin("breeder")!.health >= 90, "Züchtertier ist gesund");
  check(byOrigin("wild") && byOrigin("wild")!.trust < 40, "Auswilderungstier ist scheu");
  check(new Set(savanna.map((a) => a.name)).size === 4, `Vier verschiedene Namen (${savanna.map((a) => a.name).join(", ")})`);
  check(await page.locator(".zoo-card .zoo-story").isVisible(), "Nach dem Kauf zeigt das Panel die Geschichte");

  // Fill the other habitats via commands (keeper, toys) for the outside shots and breeding.
  const buy = (cell: number, species: string, origin: string) => e2e(page, "apply", { type: "zoo", zoo: { op: "buy", cell, species, origin } });
  await buy(cells.wald, "monkey", "rescue");
  await buy(cells.wald, "redpanda", "breeder");
  await buy(cells.wasser, "flamingo", "breeder");
  await buy(cells.wasser, "flamingo", "breeder");
  await buy(cells.wasser, "otter", "wild");
  await buy(cells.wasser, "seal", "breeder");
  await buy(cells.polar, "penguin", "breeder");
  await buy(cells.polar, "penguin", "breeder");
  await buy(cells.polar2, "polarbear", "breeder");
  await buy(cells.polar2, "polarbear", "breeder");
  await buy(cells.wiese, "goat", "breeder");
  await buy(cells.wiese, "alpaca", "breeder");
  await buy(cells.wiese, "rabbit", "breeder");
  for (const cell of Object.values(cells)) await e2e(page, "apply", { type: "zoo", zoo: { op: "keeper", cell, on: true } });
  await e2e(page, "advanceZoo", 40);
  zoo = await e2e<Zoo>(page, "zoo");
  check(zoo.visitors > 0 && zoo.income > 0, `Besucher kommen (${zoo.visitors}, +${zoo.income} €)`);
  await page.locator("#zoo-close").click();

  // 3. Outside view.
  await e2e(page, "lookAt", sx + 2, sy + 0.3, 46, 0.85, 0, 0.5);
  await clean(page);
  await page.waitForTimeout(2600);
  await clean(page);
  const layer = await e2e<{ animals: number; far: number; jeeps: number; visitors: number; meshes: number }>(page, "zooLayer");
  check(layer.animals >= 15 && layer.jeeps >= 3 && layer.visitors >= 3, `Tiere, Jeeps und Besucher sichtbar (${JSON.stringify(layer)})`);
  await page.screenshot({ path: path.join(SHOTS, "zoo-02-gehege-aussen.png") });
  await e2e(page, "lookAt", sx + 1, sy + 0.5, 20, 0.9, 0, 0.3);
  await page.waitForTimeout(900);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, "zoo-08-safari-besucher.png") });
  await e2e(page, "lookAt", sx + 2, sy, 260, 0.95, 0, 0.5);
  await page.waitForTimeout(600);
  const farLayer = await e2e<{ animals: number; far: number }>(page, "zooLayer");
  check(farLayer.far === farLayer.animals && farLayer.animals > 0, `Aus der Ferne LOD-Blöcke (${farLayer.far}/${farLayer.animals})`);

  // 4. Interior of the polar habitat: place items, pet, rename.
  await e2e(page, "openHabitat", cells.polar);
  await page.locator("#zoo-open-interior").click();
  await page.locator("#zoo-interior").waitFor({ state: "visible" });
  check(await ui(page, "interiorOpen"), "Innenansicht geöffnet");
  const itemsBefore = (await e2e<Zoo>(page, "zoo")).habitats.find((h) => h.cell === cells.polar)!.items.length;
  await page.locator('.zi-tools button[data-id="toy"]').click();
  let spot = await ui<{ x: number; y: number }>(page, "spotScreen", 2, 2);
  await page.mouse.click(spot.x, spot.y);
  await page.locator('.zi-tools button[data-id="shelter"]').click();
  spot = await ui<{ x: number; y: number }>(page, "spotScreen", 6, 1);
  await page.mouse.click(spot.x, spot.y);
  await page.locator('.zi-tools button[data-id="food"]').click();
  spot = await ui<{ x: number; y: number }>(page, "spotScreen", 1, 6);
  await page.mouse.click(spot.x, spot.y);
  await page.locator('.zi-tools button[data-id="rock"]').click();
  spot = await ui<{ x: number; y: number }>(page, "spotScreen", 6, 6);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.press("Escape");
  let polar = (await e2e<Zoo>(page, "zoo")).habitats.find((h) => h.cell === cells.polar)!;
  check(polar.items.length === itemsBefore + 4, `Einrichtung platziert (${itemsBefore} → ${polar.items.length})`);
  check(polar.items.filter((i) => i.kind === "food").length === 2, "Zweiter Futternapf steht");
  // empty bowls and refill
  await e2e(page, "advanceZoo", 4);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "zoo-04-innenansicht-naepfe.png") });

  // pet a penguin
  zoo = await e2e<Zoo>(page, "zoo");
  const penguins = zoo.animals.filter((a) => a.species === "penguin");
  const target = penguins[0];
  const pos = await ui<{ x: number; y: number }>(page, "animalScreen", target.id);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
  check((await ui<number>(page, "selected")) === target.id, "Klick aufs Tier wählt es aus");
  check(await page.locator("#zi-side .zoo-card").isVisible(), "Tierkarte in der Innenansicht");
  const trustBefore = target.trust;
  await page.locator('#zi-side .zoo-care[data-care="pet"]').click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, "zoo-05-streicheln-herzen.png") });
  const petted = (await e2e<Zoo>(page, "zoo")).animals.find((a) => a.id === target.id)!;
  check(petted.trust > trustBefore, `Streicheln erhöht Vertrauen (${trustBefore} → ${petted.trust})`);
  check(await page.locator('#zi-side .zoo-care[data-care="pet"]').isDisabled(), "Streicheln hat Cooldown");
  // rename with validation
  await page.locator("#zi-side #zoo-name").fill("<script>");
  await page.locator('#zi-side [data-act="rename"]').click();
  check(await page.locator("#zi-side #zoo-name-error").isVisible(), "Ungültiger Name zeigt Fehler");
  await page.locator("#zi-side #zoo-name").fill("Frau Pingu");
  await page.locator("#zi-side #zoo-name").press("Enter");
  await page.waitForTimeout(150);
  check((await e2e<Zoo>(page, "zoo")).animals.find((a) => a.id === target.id)!.name === "Frau Pingu", "Umbenennen klappt");

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
    // Focus the family: select the mother (camera follows), zoom in, close the card.
    const mum = await ui<{ x: number; y: number }>(page, "animalScreen", mother.id);
    await page.mouse.click(mum.x, mum.y);
    await page.waitForTimeout(1200);
    await page.mouse.move(500, 400);
    for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, -120);
    await page.locator('#zi-side [data-act="deselect"]').click().catch(() => undefined);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, "zoo-07-jungtier-eltern.png") });
    const at = await ui<{ x: number; y: number }>(page, "animalScreen", child.id);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    if ((await ui<number>(page, "selected")) !== child.id) await page.evaluate((id) => {
      const btn = document.querySelector<HTMLElement>(`.zoo-row[data-id="${id}"]`);
      btn?.click();
    }, child.id);
    check(await page.locator("#zi-side .zoo-tree").isVisible(), "Stammbaum sichtbar");
    check((await page.locator("#zi-side .zoo-tree").textContent())?.includes(mother.name), "Stammbaum nennt die Mutter");
    check(await page.locator("#zi-side .zoo-gene").count() === 5, "Fünf Gene in der Karte");
    await page.locator("#zi-side .zoo-genes").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "zoo-06-info-gene-stammbaum.png") });
  }

  // 6. Back to the city.
  await page.locator(".zi-back").click();
  await page.waitForTimeout(300);
  check(await page.locator("#zoo-interior").isHidden(), "Zurück schließt die Innenansicht");
  const ready = await page.evaluate(() => (window as Window & { __cityline?: { frameMs?: number } }).__cityline?.frameMs);
  check(typeof ready === "number", "Stadt rendert wieder");
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
  const { area, cells } = await layZoo(page, false);
  for (const [species, origin] of [["elephant", "breeder"], ["zebra", "circus"], ["giraffe", "wild"]]) {
    await e2e(page, "apply", { type: "zoo", zoo: { op: "buy", cell: cells.savanne, species, origin } });
  }
  await e2e(page, "advanceZoo", 8);
  await e2e(page, "lookAt", area.x + 1, area.y, 40, 0.9, 0, 0.6);
  await e2e(page, "openHabitat", cells.savanne);
  await page.waitForTimeout(500);
  const panel = await page.locator("#zoo-panel").boundingBox();
  check(panel && panel.x >= 0 && panel.x + panel.width <= 390, "Mobile: Gehege-Panel passt in die Breite");
  await page.screenshot({ path: path.join(SHOTS, "zoo-09-mobile-panel.png") });
  await page.locator("#zoo-open-interior").click();
  await page.waitForTimeout(600);
  const z = await e2e<Zoo>(page, "zoo");
  const pick = z.animals.find((a) => a.cell === cells.savanne)!;
  const at = await ui<{ x: number; y: number }>(page, "animalScreen", pick.id);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "zoo-10-mobile-innen.png") });
  const side = await page.locator("#zi-side").boundingBox();
  check(!side || (side.x >= 0 && side.x + side.width <= 390), "Mobile: Tierkarte passt");
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
