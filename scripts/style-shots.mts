/**
 * Grafikstile: dieselbe Kameraansicht in Standard, Pixel-Art und Comic, Tierpark, Dämmerung,
 * Mobile, Auswahl in den Einstellungen; prüft, dass der Stil wechselt und gespeichert bleibt.
 *   SHOTS=/workspace/cityline-shots/stile npx tsx scripts/style-shots.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/stile";
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

async function settings(page: Page): Promise<void> {
  // Settings selector.
  await e2e(page, "setStyle", "pixel");
  await e2e(page, "dismissUi");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const select = page.locator("#gfx-style");
  // dismissUi hides the panel inline for clean shots; show it again like a player would see it.
  await page.evaluate(() => document.querySelector<HTMLElement>("#demand")?.style.removeProperty("display"));
  await page.waitForTimeout(400);
  if (await select.isVisible()) {
    await select.selectOption("comic");
    await page.waitForTimeout(300);
    check((await e2e<string>(page, "style")) === "comic", "Auswahl in den Einstellungen wechselt den Stil");
    await select.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "einstellungen-stil.png") });
  } else check(false, `Stil-Auswahl in den Einstellungen sichtbar (${await page.evaluate(() => {
    const out: string[] = [];
    let el: HTMLElement | null = document.querySelector("#gfx-style");
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      out.push(`${el.tagName}#${el.id}.${el.className} d=${cs.display} v=${cs.visibility} h=${el.getBoundingClientRect().height}`);
      el = el.parentElement;
    }
    return out.join(" < ");
  })})`);
  const stored = await page.evaluate(() => localStorage.getItem("cityline-style"));
  check(stored === "comic", `Stil in localStorage gespeichert (${stored})`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check((await e2e<string>(page, "style")) === "comic", "Stil bleibt nach dem Neuladen");
  check((await page.locator("#gfx-style").inputValue()) === "comic", "Auswahl zeigt den gespeicherten Stil");
  if (process.env.SETTINGS) process.exit(failures.length ? 1 : 0);
}
const CITY = { x: Number(process.env.CX ?? 20), y: Number(process.env.CY ?? 20), d: Number(process.env.CD ?? 62) };
async function cityView(page: Page): Promise<void> {
  await e2e(page, "lookSea", process.env.VIEW ?? "harbor");
  if (process.env.CD) await page.evaluate((d) => {
    const cam = (window as unknown as { __cityline: { game?: { camera?: { distance: number } } } }).__cityline;
    void cam; void d;
  }, Number(process.env.CD));
}
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
const styles = ["standard", "pixel", "comic"] as const;
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => { errors.push(String(err)); console.log("pageerror:", String(err)); });
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await boot(page);
  await e2e(page, "showcase", 10);
  await e2e(page, "setOverlay", { zones: false });
  await tierpark(page);
  await e2e(page, "setHour", 10);
  const site = await e2e<{ x: number; y: number }>(page, "findArea", 3, 2).catch(() => null);
  await clean(page);
  await page.waitForTimeout(1200);
  if (process.env.SETTINGS) await settings(page);
  const perf: Record<string, { ms: number; calls: number }> = {};
  for (const style of styles) {
    if (ONLY && !ONLY.includes(style)) continue;
    check((await e2e<string>(page, "setStyle", style)) === style, `Stil ${style} gesetzt`);
    await cityView(page);
    await clean(page);
    await page.waitForTimeout(1500);
    const snap = await page.evaluate(() => (window as unknown as { __cityline: { frameMs?: number; drawCalls?: number } }).__cityline);
    perf[style] = { ms: Number(snap.frameMs ?? -1), calls: Number(snap.drawCalls ?? -1) };
    await page.screenshot({ path: path.join(SHOTS, `stadt-${style}.png`) });
  }
  console.log("perf", JSON.stringify(perf));
  if (process.env.QUICK) {
    await e2e(page, "setStyle", "standard");
    await e2e(page, "setHour", 22.5);
    await cityView(page);
    await clean(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/std-nacht.png" });
    await e2e(page, "setStyle", "pixel");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, "stadt-pixel-nacht.png") });
    await e2e(page, "setHour", 18.2);
    await cityView(page);
    await clean(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOTS, "stadt-pixel-daemmerung.png") });
    await e2e(page, "setStyle", "standard");
    await browser.close();
    process.exit(0);
  }
  // Dusk in Pixel-Art.
  await e2e(page, "setStyle", "pixel");
  await e2e(page, "setHour", 18.2);
  await cityView(page);
  await clean(page);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, "stadt-pixel-daemmerung.png") });
  for (const style of ["pixel", "comic"] as const) {
    await e2e(page, "setStyle", style);
    await e2e(page, "setHour", 22.5);
    await cityView(page);
    await clean(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOTS, `stadt-${style}-nacht.png`) });
  }
  await e2e(page, "setStyle", "pixel");
  await e2e(page, "setHour", 10);
  await page.waitForTimeout(800);
  // Tierpark in Pixel-Art and Comic.
  await pk(page, "enter");
  await page.waitForTimeout(3500);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#pk-hint")!).visibility === "hidden", undefined, { timeout: 10_000 }).catch(() => undefined);
  for (const style of ["pixel", "comic", "standard"] as const) {
    await e2e(page, "setStyle", style);
    await pk(page, "lookAt", P(20, 29), 30, 0.35);
    await page.waitForTimeout(1200);
    await clean(page);
    if (style !== "standard") await page.screenshot({ path: path.join(SHOTS, `tierpark-${style}.png`) });
    const stats = await pk<{ drawCalls: number }>(page, "stats");
    console.log("park", style, JSON.stringify(stats));
  }
  // Habitat close-up (camera flies in on click) in Pixel-Art and Comic, with build mode.
  await e2e(page, "setStyle", "pixel");
  await pk(page, "openHabitat", P(15, 33));
  await page.waitForFunction(() => !(window as any).__citylineE2E.parkUi().flying(), undefined, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, "gehege-pixel.png") });
  await e2e(page, "setStyle", "comic");
  await page.locator("#zoo-build").click();
  await page.waitForTimeout(1200);
  await clean(page);
  await page.screenshot({ path: path.join(SHOTS, "gehege-comic-bauen.png") });
  check(await page.locator("#pk-dim").isVisible(), "Bau-Modus dimmt den Park auch im Comic-Stil");
  await page.locator("#zb-done").click();
  await page.locator("#zoo-close").click().catch(() => undefined);
  await pk(page, "leave");
  await settings(page);
  await page.evaluate(() => localStorage.setItem("cityline-style", "standard"));
  await page.close();
}
// Mobile in Pixel-Art.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.addInitScript({ content: "localStorage.setItem('cityline-style', 'pixel');" });
  await boot(page);
  await e2e(page, "showcase", 10);
  await e2e(page, "setOverlay", { zones: false });
  check((await e2e<string>(page, "style")) === "pixel", "Mobile startet mit dem gespeicherten Stil");
  await clean(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "mobile-pixel.png") });
  await page.evaluate(() => document.querySelector<HTMLElement>("#demand")?.style.removeProperty("display"));
  await page.locator("#toggle-demand").tap();
  await page.waitForTimeout(400);
  await page.locator("#gfx-style").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "mobile-einstellungen-stil.png") });
  await page.close();
}
await browser.close();
const relevant = errors.filter((e) => !/favicon|GPU stall|ERR_CONNECTION/.test(e));
check(relevant.length === 0, `Keine Seitenfehler (${relevant.slice(0, 3).join(" | ")})`);
if (failures.length) {
  console.log(`style-shots: ${failures.length} Fehler`);
  process.exit(1);
}
console.log("style-shots ok");
