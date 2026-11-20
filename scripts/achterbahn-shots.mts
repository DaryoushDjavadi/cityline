/**
 * Achterbahn & Preise im Tierpark (Playtest + Screenshots): Station mit dem Werkzeug setzen,
 * Strecke Stück für Stück im Panel bauen (Vorschau, Rückgängig, Schließen), Testfahrt mit
 * Bewertung, Öffnen, Besucher fahren mit und reagieren, Ticketpreis, Mitfahren (Ego-Kamera mit
 * HUD, Esc), Standpreise mit „Zu teuer“, Pixel-Art und Comic, Mobile ohne Überlappungen, Perf.
 *   SHOTS=/workspace/cityline-shots/achterbahn npx tsx scripts/achterbahn-shots.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/achterbahn";
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
async function clean(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await page.evaluate(() => {
    for (const id of ["#life-toast", "#toast", "#pk-toast", "#status"]) {
      const el = document.querySelector<HTMLElement>(id);
      if (el) el.hidden = true;
    }
  });
}
const zooCmd = (page: Page, zoo: Record<string, unknown>) => e2e<{ ok: boolean; reason?: string }>(page, "apply", { type: "zoo", zoo });

/** Park with habitats in the south, paths, stands, decor – and a free strip in the north for the coaster. */
async function tierpark(page: Page): Promise<void> {
  const area = await e2e<{ x: number; y: number }>(page, "findArea", 3, 2);
  const idx = (x: number, y: number) => e2e<number>(page, "cellIndex", x, y);
  await e2e(page, "apply", { type: "road", cells: [await idx(area.x, area.y + 1), await idx(area.x + 1, area.y + 1), await idx(area.x + 2, area.y + 1)] });
  await e2e(page, "apply", { type: "service", index: await idx(area.x + 1, area.y), kind: 20 });
  await e2e(page, "advanceZoo", 2);
  for (const cells of [line(20, 8, 20, 33), line(5, 20, 35, 20), line(8, 8, 32, 8), line(8, 9, 8, 19), line(32, 9, 32, 19)]) await zooCmd(page, { op: "pbuild", kind: "path", cells });
  const habitats: [string, number][] = [["savanne", P(15, 33)], ["wald", P(21, 33)], ["wasser", P(15, 26)], ["polar", P(21, 26)], ["wiese", P(9, 21)], ["savanne", P(26, 21)], ["wald", P(21, 10)], ["wiese", P(14, 10)]];
  for (const [kind, cell] of habitats) await zooCmd(page, { op: "pbuild", kind, cells: [cell] });
  for (const [kind, cells] of [["food", [P(19, 31), P(9, 19), P(17, 9)]], ["drink", [P(21, 31), P(31, 19), P(19, 9)]], ["souvenir", [P(19, 21)]], ["toilet", [P(21, 19)]], ["bench", [P(19, 19), P(14, 19), P(26, 19), P(19, 38), P(11, 9)]], ["bin", [P(21, 38), P(16, 21), P(29, 9)]], ["tree", [P(7, 23), P(28, 16), P(35, 26), P(4, 31), P(34, 35), P(6, 36), P(10, 30), P(31, 30), P(6, 3), P(9, 2), P(29, 2), P(33, 5), P(35, 2), P(26, 1)]], ["flowers", [P(18, 38), P(22, 38), P(19, 25), P(21, 25), P(13, 21), P(25, 19), P(10, 4), P(31, 4)]]] as const) await zooCmd(page, { op: "pbuild", kind, cells });
  const buy = (cell: number, species: string) => zooCmd(page, { op: "buy", cell, species, origin: "breeder" });
  for (const s of ["giraffe", "zebra", "zebra"]) await buy(P(15, 33), s);
  for (const s of ["monkey", "redpanda"]) await buy(P(21, 33), s);
  for (const s of ["flamingo", "flamingo", "otter"]) await buy(P(15, 26), s);
  for (const s of ["penguin", "penguin"]) await buy(P(21, 26), s);
  for (const s of ["goat", "alpaca", "rabbit"]) await buy(P(9, 21), s);
  for (const s of ["elephant", "kangaroo"]) await buy(P(26, 21), s);
  for (const s of ["bear", "wolf"]) await buy(P(21, 10), s);
  for (const s of ["goat", "rabbit"]) await buy(P(14, 10), s);
  await e2e(page, "advanceZoo", 40);
}

type Coaster = { id: number; name: string; station: number; dir: number; pieces: string[]; state: string; price: number; riders: number; revenue: number; stats?: Record<string, number> };
type Zoo = { coasters?: Coaster[]; prices?: Record<string, number>; visitors: number; satisfaction: number; rideSales?: number; sales: number };
const zooState = (page: Page) => e2e<Zoo>(page, "zoo");
const STATION = P(12, 7);
/** Hand-built track: lift hill over the main path, two drops, a loop, a turn back. */
const PIECES = ["straight", "up", "up", "up", "up", "straight", "down", "down", "loop", "left", "straight", "left"];

const errors: string[] = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror:", String(err)); });
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
await boot(page);
await e2e(page, "showcase", 10);
await e2e(page, "setOverlay", { zones: false });
await tierpark(page);
await e2e(page, "setHour", 10);
await pk(page, "enter");
await page.waitForTimeout(2500);

// Perf before any coaster (same views as after).
const perf: Record<string, unknown> = {};
const measure = async (label: string) => {
  for (const [view, args] of [["nah", [P(18, 8), 34, 0.5]], ["uebersicht", [P(20, 18), 110, 0.35]]] as const) {
    await pk(page, "lookAt", ...args);
    await page.waitForTimeout(900);
    const stats = await pk<{ drawCalls: number; triangles: number }>(page, "stats");
    perf[`${label}-${view}`] = { drawCalls: stats.drawCalls, triangles: stats.triangles };
  }
};
await measure("ohne");

// 1) Station with the tool: tab, item, hover ghost, click.
await pk(page, "setTab", "rides");
await page.locator('#pk-build [data-tool="coaster"]').click();
await pk(page, "lookAt", P(18, 6), 36, 0.45);
await page.waitForTimeout(500);
const st = await pk<{ x: number; y: number }>(page, "tileScreen", STATION);
await page.mouse.move(st.x, st.y);
await page.waitForTimeout(200);
await page.mouse.click(st.x, st.y);
await page.waitForTimeout(400);
let zoo = await zooState(page);
const coaster = zoo.coasters?.[0];
check(coaster && coaster.station === STATION && coaster.dir === 1, `Station gesetzt (Richtung ${coaster?.dir})`);
const ride = await pk<{ open: boolean; editing: boolean; coaster: number }>(page, "ride");
check(ride.open && ride.editing && ride.coaster === coaster?.id, `Panel öffnet im Strecken-Editor (${JSON.stringify(ride)} / ${coaster?.id})`);
const id = coaster!.id;

// 2) Pieces from the panel, undo, auto close.
for (const piece of PIECES) {
  await page.locator(`#ride-panel [data-piece="${piece}"]`).click();
  await page.waitForTimeout(60);
}
zoo = await zooState(page);
check(zoo.coasters![0].pieces.join(",") === PIECES.join(","), `${PIECES.length} Teile gebaut`);
await page.locator('#ride-panel [data-act="undo"]').click();
await page.waitForTimeout(80);
check((await zooState(page)).coasters![0].pieces.length === PIECES.length - 1, "Rückgängig nimmt das letzte Teil");
await page.locator('#ride-panel [data-piece="left"]').click();
await page.waitForTimeout(80);
// Hover a piece for the preview, then the editor shot.
await page.locator('#ride-panel [data-piece="straight"]').hover();
await page.waitForTimeout(300);
await pk(page, "lookAt", P(19, 5), 30, 0.62);
await page.waitForTimeout(700);
check(/Station/.test(await page.locator("#ride-panel .rp-status").innerText()), "Hinweis, wie der Kurs zur Station zurückfindet");
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "01-editor.png") });
await page.locator('#ride-panel [data-act="close-track"]').click();
await page.waitForTimeout(150);
zoo = await zooState(page);
check(zoo.coasters![0].pieces.length > PIECES.length, `Schließen ergänzt ${zoo.coasters![0].pieces.length - PIECES.length} Teile`);
check(/geschlossen/.test(await page.locator("#ride-panel .rp-status").innerText()), "Rundkurs geschlossen");

// 3) Test run → ratings, open.
await page.locator('#ride-panel [data-act="edit-done"]').click();
await page.locator('#ride-panel [data-state="test"]').click();
await page.waitForTimeout(200);
zoo = await zooState(page);
const stats = zoo.coasters![0].stats;
check(zoo.coasters![0].state === "test" && stats && stats.excitement > 0, `Testfahrt: Aufregung ${stats?.excitement} · Intensität ${stats?.intensity} · Übelkeit ${stats?.nausea} · ${stats?.maxKmh} km/h`);
const s0 = await pk<number>(page, "trainS", id);
await page.waitForTimeout(1500);
check(Math.abs((await pk<number>(page, "trainS", id)) - s0) > 0.5, "Zug fährt bei der Testfahrt");
await page.locator('#ride-panel [data-state="open"]').click();
await page.waitForTimeout(100);
check((await zooState(page)).coasters![0].state === "open", "Achterbahn geöffnet");

// 4) Riders: zoo steps (income) and visible visitors who ride and react.
await e2e(page, "advanceZoo", 40);
zoo = await zooState(page);
check(zoo.coasters![0].riders > 0 && zoo.coasters![0].revenue > 0 && (zoo.rideSales ?? 0) > 0, `Fahrgäste ${Math.round(zoo.coasters![0].riders)}, Einnahmen ${Math.round(zoo.coasters![0].revenue)} €`);
await pk(page, "hidePanel");
await pk(page, "lookAt", P(19, 12), 70, 0.4);
await page.waitForFunction(() => (window as any).__citylineE2E.parkUi().stats().rides > 1, undefined, { timeout: 60_000 }).catch(() => undefined);
const counters = await pk<{ rides: number; refused: number; coasters: { riders: number; cars: number } }>(page, "stats");
check(counters.rides > 1, `Besucher fahren mit (${counters.rides} Fahrten im Park gesehen, ${JSON.stringify(await pk(page, "crowdRides"))})`);
check(counters.coasters.cars === 4 && counters.coasters.riders === 4, "Zug mit 4 Wagen und Fahrgästen");
await pk(page, "lookAt", P(19, 13), 62, 0.55);
await page.waitForTimeout(1200);
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "02-park-achterbahn.png") });
await measure("mit");

// 5) Coaster panel by clicking the station.
await pk(page, "lookAt", P(16, 8), 34, 0.45);
await page.waitForTimeout(600);
const sc = await pk<{ x: number; y: number }>(page, "tileScreen", P(13, 7));
await page.mouse.click(sc.x, sc.y);
await page.waitForTimeout(300);
const clicked = await pk<{ open: boolean; coaster: number }>(page, "ride");
check(clicked.coaster === id, `Klick auf die Station öffnet das Achterbahn-Panel (${JSON.stringify(clicked)})`);
if (process.env.STOP === "5") process.exit(0);
const panelText = await page.locator("#ride-panel").innerText();
check(/Aufregung/.test(panelText) && /Intensität/.test(panelText) && /Übelkeit/.test(panelText) && /Mitfahren/.test(panelText) && /Ticketpreis/i.test(panelText), `Panel zeigt Bewertung, Ticketpreis und Mitfahren ${JSON.stringify(panelText.slice(0, 400))}`);
for (let k = 0; k < 2; k += 1) await page.locator('#ride-panel [data-act="price"][data-d="1"]').click();
await page.waitForTimeout(100);
check((await zooState(page)).coasters![0].price === 7, "Ticketpreis per + erhöht");
await page.waitForTimeout(1500);
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "03-achterbahn-panel.png") });

// 6) Mitfahren: first person, HUD, speed, Escape.
await page.locator('#ride-panel [data-act="ride"]').click();
await page.waitForTimeout(200);
check((await pk<number>(page, "riding")) === id && (await page.locator("#ride-hud").isVisible()), "Mitfahren: Ego-Kamera mit HUD");
check(!(await page.locator("#ride-panel").isVisible()) && !(await page.locator(".pk-build").isVisible()), "Nur das HUD bleibt sichtbar");
// Wait for the top of the drop (first "down" piece = index 6).
await page.waitForFunction((id) => (window as any).__citylineE2E.parkUi().trainPiece(id)?.piece === 6, id, { timeout: 60_000 }).catch(() => undefined);
await page.waitForTimeout(150);
const kmh = await pk<number>(page, "rideKmh");
check(kmh > 5, `Tempo im HUD (${kmh} km/h)`);
await page.screenshot({ path: path.join(SHOTS, "04-first-person.png") });
// Near the top of the loop (upside down).
await page.waitForFunction((id) => { const at = (window as any).__citylineE2E.parkUi().trainPiece(id); return at?.piece === 8 && at.y > 3.2; }, id, { timeout: 30_000, polling: 16 }).catch(() => undefined);
await page.screenshot({ path: path.join(SHOTS, "04b-looping.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check((await pk<number>(page, "riding")) === -1 && !(await page.locator("#ride-hud").isVisible()) && (await page.locator(".pk-top").isVisible()), "Esc: zurück zur Parkkamera");
check((await pk<boolean>(page, "isOpen")), "Park bleibt offen nach dem Aussteigen");

// 7) Stand price: click the food stand, overprice, see refusals.
const FOOD = P(17, 9);
await pk(page, "lookAt", P(18, 10), 28, 0.3);
await page.waitForTimeout(1500);
let fs = await pk<{ x: number; y: number }>(page, "tileScreen", FOOD);
for (let k = 0; k < 10 && (await pk<number>(page, "tileUnder", fs.x, fs.y - 6)) !== FOOD; k += 1) {
  await page.waitForTimeout(300);
  fs = await pk<{ x: number; y: number }>(page, "tileScreen", FOOD);
}
await page.mouse.click(fs.x, fs.y - 6);
await page.waitForTimeout(300);
const standRide = await pk<{ stand: number }>(page, "ride");
check(standRide.stand === FOOD, `Klick auf den Essensstand öffnet das Preis-Panel (${JSON.stringify(standRide)} tile ${await pk(page, "tileUnder", fs.x, fs.y - 6)} vs ${FOOD}, ${JSON.stringify(fs)}, code ${(await zooState(page)).park?.tiles?.[FOOD]} build ${await page.evaluate(() => document.body.dataset.build ?? "-")})`);
for (let k = 0; k < 5; k += 1) await page.locator('#ride-panel [data-act="price"][data-d="1"]').click();
await page.waitForTimeout(100);
zoo = await zooState(page);
check(zoo.prices?.[String(FOOD)] === 9, `Preis auf 9 € gesetzt (${zoo.prices?.[String(FOOD)]})`);
check(/Zu teuer/.test(await page.locator("#ride-panel .rp-mood").innerText()), "Panel warnt: Zu teuer");
const satBefore = zoo.satisfaction;
await e2e(page, "advanceZoo", 8);
await page.waitForFunction(() => (window as any).__citylineE2E.parkUi().stats().refused > 2, undefined, { timeout: 40_000 }).catch(() => undefined);
check((await pk<{ refused: number }>(page, "stats")).refused > 2, "Besucher sagen „Zu teuer“");
await page.waitForTimeout(800);
await clean(page);
await page.screenshot({ path: path.join(SHOTS, "05-stand-preis.png") });
zoo = await zooState(page);
check(zoo.satisfaction <= satBefore, `Zufriedenheit sinkt bei Wucherpreisen (${satBefore} → ${zoo.satisfaction})`);
await page.locator('#ride-panel .rp-range').fill("4");
await page.locator('#ride-panel .rp-range').dispatchEvent("change");
await page.waitForTimeout(100);
check((await zooState(page)).prices?.[String(FOOD)] === undefined, "Schieberegler zurück auf den Standardpreis");
await pk(page, "hidePanel");

// 8) Pixel-Art and Comic.
for (const [style, file] of [["pixel", "06-pixel-achterbahn.png"], ["comic", "06b-comic-achterbahn.png"]] as const) {
  await e2e(page, "setStyle", style);
  await pk(page, "lookAt", P(18, 7), 40, 0.6);
  await page.waitForTimeout(1500);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, file) });
  const st2 = await pk<{ drawCalls: number }>(page, "stats");
  perf[`${style}-nah`] = { drawCalls: st2.drawCalls };
}
await e2e(page, "setStyle", "standard");
console.log("PERF", JSON.stringify(perf));

// 9) Mobile: tap station → panel as bottom sheet, no overlaps; ride HUD fits.
const mobile = await browser.newContext({ ...devices["iPhone 13"] });
const mp = await mobile.newPage();
mp.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror (mobil):", String(err)); });
await boot(mp);
await e2e(mp, "showcase", 10);
await tierpark(mp);
await zooCmd(mp, { op: "cstation", tile: STATION, dir: 1 });
const mid = (await zooState(mp)).coasters![0].id;
for (const piece of PIECES) await zooCmd(mp, { op: "cpiece", coaster: mid, piece });
await zooCmd(mp, { op: "cclose", coaster: mid });
await zooCmd(mp, { op: "cstate", coaster: mid, state: "open" });
check((await zooState(mp)).coasters![0].state === "closed", "Öffnen ohne Testfahrt wird abgelehnt");
await zooCmd(mp, { op: "cstate", coaster: mid, state: "test" });
await zooCmd(mp, { op: "cstate", coaster: mid, state: "open" });
await e2e(mp, "setHour", 10);
await pk(mp, "enter");
await mp.waitForTimeout(2000);
await pk(mp, "lookAt", P(16, 8), 40, 0.45);
await mp.waitForTimeout(600);
const ms = await pk<{ x: number; y: number }>(mp, "tileScreen", P(13, 7));
await mp.touchscreen.tap(ms.x, ms.y);
await mp.waitForTimeout(500);
check((await pk<{ coaster: number }>(mp, "ride")).coaster === mid, "Mobil: Station antippen öffnet das Panel");
const box = async (sel: string) => mp.locator(sel).boundingBox();
const top = await box(".pk-top");
const panel = await box("#ride-panel");
const vw = mp.viewportSize()!;
check(top && panel && panel.y >= top.y + top.height - 1 && panel.y + panel.height <= vw.height + 1 && panel.x >= 0 && panel.x + panel.width <= vw.width + 1, "Mobil: Panel überlappt die Kopfleiste nicht und bleibt im Bild");
check(!(await mp.locator(".pk-build").isVisible()) || ((await box(".pk-build"))!.y >= panel!.y + panel!.height), "Mobil: Baumenü verdeckt das Panel nicht");
await clean(mp);
await mp.screenshot({ path: path.join(SHOTS, "07-mobile.png") });
await mp.locator('#ride-panel [data-act="edit"]').tap();
await mp.waitForTimeout(300);
await clean(mp);
await mp.screenshot({ path: path.join(SHOTS, "07b-mobile-editor.png") });
await mp.locator('#ride-panel [data-act="edit-done"]').tap();
await mp.locator('#ride-panel [data-state="open"]').tap();
await mp.waitForTimeout(200);
await mp.locator('#ride-panel [data-act="ride"]').tap();
await mp.waitForTimeout(1500);
const hud = await box("#ride-hud");
check(hud && hud.x >= 0 && hud.x + hud.width <= vw.width + 1, "Mobil: Mitfahr-HUD passt auf den Bildschirm");
await mp.screenshot({ path: path.join(SHOTS, "07c-mobile-mitfahren.png") });
await mp.locator('#ride-hud button').tap();
await mp.waitForTimeout(200);
check((await pk<number>(mp, "riding")) === -1, "Mobil: Aussteigen-Knopf");

check(errors.length === 0, `Keine Fehler in der Konsole (${errors.slice(0, 3).join(" | ")})`);
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} Fehler:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAchterbahn-Playtest: alles grün");
