/**
 * Gehege-Baumodus im Tierpark: Gehege anklicken (Kamera fährt heran), Bau-Modus mit Vorschau,
 * Drehen und Entfernen, Möbel aus der Übersicht sichtbar, Streicheln mit Herzen im Park,
 * Mobile und Pixel-Art. Misst die Draw Calls im Park (PERF_ONLY=1 nur Messung, auch für main).
 *   SHOTS=/workspace/cityline-shots/baumodus npx tsx scripts/baumodus-shots.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/baumodus";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};
type E2E = Record<string, (...args: any[]) => any>;
const e2e = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args }) as Promise<T>;
const pk = <T = any>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E.parkUi() as Record<string, (...a: unknown[]) => unknown>)[name](...args), { name, args }) as Promise<T>;
const P = (x: number, y: number) => y * 40 + x;
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const out: number[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) out.push(P(x, y));
  return out;
};

async function boot(page: Page, fresh = true): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  const gate = page.locator("#name-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#gate-name").fill("Daryoush");
    await page.locator("#gate-enter").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
  if (!fresh) return;
  await page.locator("#lobby-create > summary").click().catch(() => undefined);
  await page.locator("#map-seed").fill("1842");
  await page.locator("#solo-new").click();
  await page.locator("#lobby").waitFor({ state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as Window & { __cityline?: { ready?: boolean } }).__cityline?.ready), undefined, { timeout: 40_000 });
}
async function clean(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await page.evaluate(() => {
    for (const id of ["#life-toast", "#toast", "#pk-toast", "#status"]) {
      const el = document.querySelector<HTMLElement>(id);
      if (el) el.hidden = true;
    }
  });
}
const zooCmd = (page: Page, zoo: Record<string, unknown>) => e2e(page, "apply", { type: "zoo", zoo });
async function tierpark(page: Page): Promise<void> {
  const area = await e2e<{ x: number; y: number }>(page, "findArea", 3, 2);
  const idx = (x: number, y: number) => e2e<number>(page, "cellIndex", x, y);
  await e2e(page, "apply", { type: "road", cells: [await idx(area.x, area.y + 1), await idx(area.x + 1, area.y + 1), await idx(area.x + 2, area.y + 1)] });
  await e2e(page, "apply", { type: "service", index: await idx(area.x + 1, area.y), kind: 20 });
  await e2e(page, "advanceZoo", 2);
  for (const cells of [line(20, 4, 20, 33), line(5, 20, 35, 20), line(8, 8, 32, 8), line(8, 9, 8, 19), line(32, 9, 32, 19)]) await zooCmd(page, { op: "pbuild", kind: "path", cells });
  const habitats: [string, number][] = [["savanne", P(15, 33)], ["wald", P(21, 33)], ["wasser", P(15, 26)], ["polar", P(21, 26)], ["wiese", P(9, 21)], ["savanne", P(26, 21)]];
  for (const [kind, cell] of habitats) await zooCmd(page, { op: "pbuild", kind, cells: [cell] });
  for (const [kind, cells] of [["food", [P(19, 31), P(9, 19)]], ["drink", [P(21, 31), P(31, 19)]], ["souvenir", [P(19, 21)]], ["toilet", [P(21, 19)]], ["bench", [P(19, 19), P(14, 19), P(26, 19), P(19, 38)]], ["bin", [P(21, 38), P(16, 21)]], ["tree", [P(7, 23), P(12, 17), P(28, 16), P(27, 12), P(14, 12), P(35, 26), P(4, 31), P(34, 35), P(6, 36), P(24, 14), P(16, 15), P(10, 30), P(31, 30)]], ["flowers", [P(18, 38), P(22, 38), P(19, 25), P(21, 25), P(13, 21), P(25, 19)]]] as const) await zooCmd(page, { op: "pbuild", kind, cells });
  const buy = (cell: number, species: string) => zooCmd(page, { op: "buy", cell, species, origin: "breeder" });
  for (const s of ["giraffe", "zebra", "zebra"]) await buy(P(15, 33), s);
  for (const s of ["monkey", "redpanda"]) await buy(P(21, 33), s);
  for (const s of ["flamingo", "flamingo", "otter"]) await buy(P(15, 26), s);
  for (const s of ["penguin", "penguin"]) await buy(P(21, 26), s);
  for (const s of ["goat", "alpaca", "rabbit"]) await buy(P(9, 21), s);
  for (const s of ["elephant", "kangaroo"]) await buy(P(26, 21), s);
  await e2e(page, "advanceZoo", 40);
}


const PERF_ONLY = process.env.PERF_ONLY === "1";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror:", String(err)); });
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
await boot(page);
await e2e(page, "showcase", 10);
await e2e(page, "setOverlay", { zones: false });
await tierpark(page);
// Some furniture (old saves: plain spots, no turn).
const furnish: [number, string, number, number][] = [[P(15, 33), "food", 1, 1], [P(15, 33), "water", 2, 1], [P(15, 33), "shelter", 6, 6], [P(15, 33), "rock", 6, 2], [P(21, 33), "toy", 3, 4], [P(21, 33), "plant", 1, 6], [P(9, 21), "food", 4, 4], [P(9, 21), "shelter", 1, 1]];
for (const [cell, item, x, y] of furnish) await zooCmd(page, { op: "place", cell, item, x, y });
await e2e(page, "setHour", 10);
await pk(page, "enter");
await page.waitForTimeout(3500);
await page.waitForFunction(() => getComputedStyle(document.querySelector("#pk-hint")!).visibility === "hidden", undefined, { timeout: 10_000 }).catch(() => undefined);
const perf: Record<string, unknown> = {};
for (const style of ["standard", "pixel", "comic"] as const) {
  await e2e(page, "setStyle", style);
  for (const [view, args] of [["nah", [P(20, 29), 30, 0.35]], ["uebersicht", [P(20, 20), 110, 0.35]]] as const) {
    await pk(page, "lookAt", ...args);
    await page.waitForTimeout(1200);
    const stats = await pk<{ drawCalls: number; triangles: number }>(page, "stats");
    perf[`${style}-${view}`] = { drawCalls: stats.drawCalls, triangles: stats.triangles };
  }
}
console.log("PERF", JSON.stringify(perf));
await e2e(page, "setStyle", "standard");
if (PERF_ONLY) {
  await browser.close();
  process.exit(0);
}

type Zoo = { habitats: { cell: number; items: { id: number; kind: string; x: number; y: number; rot?: number }[]; keeper: boolean }[]; animals: { id: number; cell: number; name: string; species: string; react?: { kind: string } }[] };
const zooState = () => e2e<Zoo>(page, "zoo");
const zu = <T = any>(name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E.zooUi() as Record<string, (...a: unknown[]) => unknown>)[name](...args), { name, args }) as Promise<T>;
const SAV = P(15, 33);
const items = async (cell = SAV) => (await zooState()).habitats.find((h) => h.cell === cell)!.items;

// 1) Click the habitat in the park: the camera flies closer, the panel opens.
await pk(page, "lookAt", P(20, 24), 80, 0.35);
await page.waitForTimeout(600);
const before = await pk<{ distance: number }>(page, "camera");
const hs = await pk<{ x: number; y: number }>(page, "habitatScreen", SAV);
// a spot on the habitat floor away from the animals' middle
await page.mouse.click(hs.x + 30, hs.y + 18);
await page.waitForTimeout(150);
check(await pk<boolean>(page, "flying") || (await pk<{ distance: number }>(page, "camera")).distance < before.distance, "Kamera fliegt beim Klick aufs Gehege");
await page.waitForFunction(() => !(window as any).__citylineE2E.parkUi().flying(), undefined, { timeout: 8000 }).catch(() => undefined);
await page.waitForTimeout(300);
const near = await pk<{ x: number; z: number; distance: number }>(page, "camera");
check(near.distance <= 26 && near.distance < before.distance, `Kamera nah am Gehege (Abstand ${near.distance.toFixed(1)})`);
check(await page.locator("#zoo-panel").isVisible(), "Gehege-Panel offen");
check((await page.locator("#zoo-open-interior").count()) === 0 && (await page.locator("#zoo-interior").count()) === 0, "Keine Innenansicht mehr");
check(await page.locator("#zoo-build").isVisible(), "Bauen-Knopf im Panel");
check((await page.locator("#zoo-canvas").count()) === 0, "Kein zweites Gehege-Canvas");
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "01-gehege-nah.png") });

// 2) Build mode with preview, turn, place, remove.
await page.locator("#zoo-build").click();
await page.waitForTimeout(900);
check((await zu<{ cell: number } | null>("build"))?.cell === SAV, "Bau-Modus an");
check(await pk<boolean>(page, "dimOn"), "Park außerhalb gedimmt");
await page.locator('.zb-item[data-id="shelter"]').click();
await page.keyboard.press("r");
await page.waitForFunction(() => !(window as any).__citylineE2E.parkUi().flying(), undefined, { timeout: 8000 }).catch(() => undefined);
let spot = await pk<{ x: number; y: number }>(page, "spotScreen", 3, 6);
await page.mouse.move(spot.x, spot.y);
await page.waitForTimeout(300);
check((await zu<{ rot: number }>("build")).rot === 1, "R dreht die Vorschau");
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "02-baumodus-vorschau.png") });
let count = (await items()).length;
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(300);
const placed = (await items()).find((item) => item.kind === "shelter" && item.x === 3 && item.y === 6);
check(!!placed && placed.rot === 1, `Unterstand gesetzt und gedreht (${JSON.stringify(placed)})`);
// occupied spot → refused
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(200);
check((await items()).length === count + 1, "Besetztes Feld wird abgelehnt");
// new kinds: tree, hay, a 2×2 pond
for (const [kind, x, y] of [["tree", 0, 7], ["hay", 7, 7], ["pool", 3, 2]] as const) {
  await page.locator(`.zb-item[data-id="${kind}"]`).click();
  spot = await pk(page, "spotScreen", x, y);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(250);
}
const now = await items();
check(["tree", "hay", "pool"].every((kind) => now.some((item) => item.kind === kind)), `Baum, Heu und Teich gesetzt (${now.map((i) => i.kind).join(",")})`);
// pond covers 2×2: the spot next to its corner is taken
await page.locator('.zb-item[data-id="rock"]').click();
spot = await pk(page, "spotScreen", 4, 3);
const n0 = (await items()).length;
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(250);
check((await items()).length === n0, "Teich belegt 2 × 2 Felder");
// remove the tree
await page.locator("#zb-remove").click();
spot = await pk(page, "spotScreen", 0, 7);
await page.mouse.move(spot.x, spot.y);
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(250);
check(!(await items()).some((item) => item.kind === "tree"), "Entfernen nimmt den Baum weg");
// Escape: tool, then build mode
await page.keyboard.press("Escape");
check((await zu<{ tool: string | null }>("build"))?.tool === null, "Esc: Werkzeug aus");
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check((await zu("build")) === null && !(await pk<boolean>(page, "dimOn")), "Esc: Bau-Modus aus, Park nicht mehr gedimmt");
check(await page.locator("#zoo-panel").isVisible() && (await pk<boolean>(page, "isOpen")), "Panel und Park bleiben offen");
// close button path
await page.locator("#zoo-build").click();
await page.locator("#zb-done").click();
check((await zu("build")) === null, "Fertig beendet den Bau-Modus");

// 3) Furniture visible from the park overview.
await pk(page, "lookAt", P(19, 28), 52, 0.5);
await page.waitForTimeout(1200);
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "03-moebel-uebersicht.png") });
const after = await pk<{ habitatMeshes: number }>(page, "stats");
check(after.habitatMeshes <= 5, `Gehege-Dekor + Möbel in ${after.habitatMeshes} Draw Calls`);

// 4) Click an animal in the park, pet it: hearts at the animal.
const zoo = await zooState();
const giraffe = zoo.animals.find((a) => a.cell === SAV && a.species === "giraffe")!;
await zu("select", giraffe.id);
await page.waitForTimeout(1300);
const as = await pk<{ x: number; y: number } | null>(page, "animalScreen", giraffe.id);
await zu("select", -1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
if (as) await page.mouse.click(as.x, as.y);
await page.waitForTimeout(500);
check((await zu<number>("selected")) === giraffe.id, `Tier per Klick im Park gewählt (${await zu("selected")})`);
check(await page.locator("#zoo-panel .zoo-card").isVisible(), "Tierkarte im Panel");
await page.locator('#zoo-panel [data-care="pet"]').click();
await page.waitForTimeout(450);
check((await pk<number>(page, "bursts")) > 0, "Herzen beim Streicheln");
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "04-streicheln-herzen.png") });
await page.waitForTimeout(1500);
// rename
await page.locator("#zoo-name").fill("Stupsi");
await page.locator('#zoo-panel [data-act="rename"]').click();
await page.waitForTimeout(200);
check((await zooState()).animals.find((a) => a.id === giraffe.id)?.name === "Stupsi", "Umbenennen im Park");
// genes and family tree in the card
check(await page.locator("#zoo-panel .zoo-genes").isVisible() && (await page.locator("#zoo-panel .zoo-tree").isVisible()), "Gene und Stammbaum in der Karte");
// feed → reaction
await page.locator('#zoo-panel [data-care="feed"]').click();
await page.waitForTimeout(200);
check((await pk<number>(page, "bursts")) > 0, "Füttern zeigt Reaktion");
// play needs a toy: habitat with toy
const monkey = zoo.animals.find((a) => a.cell === P(21, 33))!;
await zu("select", monkey.id);
await page.waitForTimeout(300);
await page.locator('#zoo-panel [data-care="play"]').click();
await page.waitForTimeout(200);
check((await zooState()).animals.find((a) => a.id === monkey.id)?.react?.kind === "play", "Spielen im Park");
// buy an animal with an origin
await pk(page, "openHabitat", P(9, 21));
await page.waitForTimeout(300);
await page.locator("#zoo-open-shop").click();
await page.locator('.shop-species[data-id="rabbit"]').click();
await page.locator('.shop-origin[data-id="rescue"]').click();
const animalsBefore = (await zooState()).animals.length;
console.log("Shop:", await page.locator(".shop-foot p").textContent());
await page.locator("#shop-buy").click({ timeout: 5000 });
await page.waitForTimeout(300);
const bought = (await zooState()).animals.length > animalsBefore;
check(bought, "Tier mit Herkunft aufgenommen");
// keeper on: the keeper refills
await pk(page, "openHabitat", P(21, 33));
await page.waitForTimeout(200);
await page.locator('#zoo-panel [data-act="list"]').click({ timeout: 2000 }).catch(() => undefined);
await page.locator('#zoo-panel [data-act="keeper"]').click();
await page.waitForTimeout(200);
check((await zooState()).habitats.find((h) => h.cell === P(21, 33))?.keeper === true, "Pfleger an");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// 6) Pixel-Art close-up (and Comic).
if (!(await pk<boolean>(page, "isOpen"))) await pk(page, "enter");
await page.waitForTimeout(800);
for (const style of ["pixel", "comic"] as const) {
  await e2e(page, "setStyle", style);
  await pk(page, "openHabitat", P(15, 26));
  await page.waitForTimeout(1300);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, `06-${style}-nah.png`) });
}
await e2e(page, "setStyle", "standard");
await pk(page, "openHabitat", P(21, 26));
await page.waitForTimeout(1300);
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "07-polar-nah.png") });
await page.close();

// 5) Mobile build mode.
{
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  m.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror (mobil):", String(err)); });
  await boot(m);
  await e2e(m, "showcase", 10);
  await e2e(m, "setOverlay", { zones: false });
  await tierpark(m);
  for (const [cell, item, x, y] of furnish) await e2e(m, "apply", { type: "zoo", zoo: { op: "place", cell, item, x, y } });
  await e2e(m, "setHour", 10);
  await m.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.parkUi().enter());
  await m.waitForTimeout(2500);
  const pkm = <T = any>(name: string, ...args: unknown[]) =>
    m.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E.parkUi() as Record<string, (...a: unknown[]) => unknown>)[name](...args), { name, args }) as Promise<T>;
  await pkm("lookAt", P(17, 30), 60, 0.35);
  await m.waitForTimeout(600);
  const h = await pkm<{ x: number; y: number }>("habitatScreen", SAV);
  await m.touchscreen.tap(h.x + 20, h.y + 12);
  await m.waitForTimeout(1300);
  if (!(await m.locator("#zoo-build").isVisible()) && (await m.locator('#zoo-panel [data-act="list"]').isVisible())) await m.locator('#zoo-panel [data-act="list"]').tap();
  check(await m.locator("#zoo-build").isVisible(), "Mobile: Gehege antippen öffnet das Panel");
  await m.locator("#zoo-build").tap();
  await m.waitForTimeout(1000);
  await m.locator('.zb-item[data-id="toy"]').tap();
  const sp = await pkm<{ x: number; y: number }>("spotScreen", 4, 6);
  const panelTop = await m.locator("#zoo-panel").evaluate((el) => el.getBoundingClientRect().top);
  check(sp.y < panelTop - 10, `Mobile: Gehege über dem Bau-Panel sichtbar (Feld y ${sp.y.toFixed(0)} < Panel ${panelTop.toFixed(0)})`);
  const n = (await e2e<Zoo>(m, "zoo")).habitats.find((x) => x.cell === SAV)!.items.length;
  await m.touchscreen.tap(sp.x, sp.y);
  await m.waitForTimeout(400);
  check((await e2e<Zoo>(m, "zoo")).habitats.find((x) => x.cell === SAV)!.items.length === n + 1, "Mobile: Antippen setzt Spielzeug");
  // show the preview for the shot: pick the next item and hover by pointer (touch has no hover)
  await m.locator('.zb-item[data-id="tree"]').tap();
  const s2 = await pkm<{ x: number; y: number }>("spotScreen", 6, 3);
  await m.mouse.move(s2.x, s2.y);
  await m.waitForTimeout(400);
  await m.evaluate(() => document.querySelector<HTMLElement>("#demand")?.style.setProperty("display", "none"));
  await m.screenshot({ path: path.join(SHOTS, "05-mobile-baumodus.png") });
  await m.close();
}
await browser.close();
const relevant = errors.filter((e) => !/favicon|GPU stall|ERR_CONNECTION/.test(e));
check(relevant.length === 0, `Keine Seitenfehler (${relevant.slice(0, 3).join(" | ")})`);
if (failures.length) {
  console.log(`baumodus-shots: ${failures.length} Fehler`);
  process.exit(1);
}
console.log("baumodus-shots ok");
