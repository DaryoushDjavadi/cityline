/**
 * Stadtleben + Klang playtest (headless Chromium).
 * Needs a server with the built client: `npm run build && PORT=8787 npm start`.
 *   CITYLINE_CLIENT=http://127.0.0.1:8787 SHOTS=/workspace/cityline-shots npx tsx scripts/life-playtest.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots";
mkdirSync(SHOTS, { recursive: true });

const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

type E2E = Record<string, (...args: any[]) => any>;
const e2e = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args });

let engineBeforeGesture = false;

async function boot(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  let gestured = false;
  page.on("request", (req) => {
    if (!gestured && /\/engine-[^/]*\.js$/.test(req.url())) engineBeforeGesture = true;
  });
  await page.goto(`${BASE}/?e2e=1&gfx=high`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  gestured = true;
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

async function settle(page: Page): Promise<void> {
  await e2e(page, "dismissUi");
  await page.evaluate(() => {
    const demand = document.querySelector<HTMLElement>("#demand");
    if (demand) demand.style.display = "";
  });
}

async function desktop(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await boot(page);
  const show = (await e2e(page, "showcase", 9)) as { population: number; rank: number };
  check(show.population > 200 && show.rank >= 3, `Showcase-Stadt geladen (pop ${show.population}, Rang ${show.rank})`);
  await e2e(page, "setOverlay", { zones: false });
  await page.waitForTimeout(1500);
  await settle(page);
  await page.waitForTimeout(1000);
  check(await page.locator("#open-city").isVisible(), "Stadt-Button sichtbar");
  check(await page.locator("#toggle-sound").isVisible(), "Lautsprecher-Button sichtbar");
  await page.screenshot({ path: path.join(SHOTS, "01-overview.png") });

  // Audio: the engine chunk is only fetched after the first gesture.
  check(!engineBeforeGesture, "Audio-Engine-Chunk erst nach Nutzergeste geladen");
  await page.locator("#open-city").click();
  await page.locator("#life-close").click();
  await page.waitForTimeout(800);
  const audio = await page.evaluate(() => {
    const engine = (window as unknown as { __citylineAudio?: { ctx: AudioContext; debug?: () => unknown } }).__citylineAudio;
    return engine ? { state: engine.ctx.state, debug: engine.debug?.() ?? null } : null;
  });
  check(audio !== null, `Audio-Engine nach Klick geladen (${audio?.state ?? "–"})`);
  const scene = (await e2e(page, "audioScene")) as Record<string, number>;
  check(scene.homes > 0 || scene.traffic > 0, `Audio-Szene liest Stadt (traffic ${scene.traffic?.toFixed(2)}, homes ${scene.homes?.toFixed(2)}, coast ${scene.coast?.toFixed(2)})`);
  await page.evaluate(() => (window as unknown as { __citylineAudio?: { debug: () => unknown } }).__citylineAudio?.debug());
  await page.waitForTimeout(3500);
  const level = await page.evaluate(() => (window as unknown as { __citylineAudio?: { debug: () => { state: string; bar: number; rms: number } } }).__citylineAudio?.debug() ?? null);
  console.log("audio debug", JSON.stringify(level));
  check(level !== null && level.bar >= 1 && level.rms > 0.0005, `Musik + Ambiente erzeugen Signal (bar ${level?.bar}, rms ${level?.rms.toFixed(4)})`);

  // Settings panel with Klang section.
  const demand = page.locator("#demand");
  await page.locator(".audio-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "02-settings-audio.png") });
  const box = await demand.boundingBox();
  if (box) await page.screenshot({ path: path.join(SHOTS, "02b-settings-audio-crop.png"), clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: Math.min(800 - box.y + 8, box.height + 16) } });
  await page.locator("#snd-music-on").uncheck();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cityline-audio") ?? "{}"));
  check(stored.musicOn === false, "Musik-Toggle wird in localStorage gespeichert");
  check(await page.locator("#snd-music").isDisabled(), "Musik-Regler deaktiviert, wenn Musik aus");
  await page.locator("#snd-music-on").check();

  // HUD speaker: mute + unmute.
  await page.locator("#toggle-sound").click();
  check((await page.locator("#toggle-sound").getAttribute("data-muted")) === "1", "Lautsprecher schaltet stumm");
  const topbar = await page.locator("#topbar").boundingBox();
  if (topbar) await page.screenshot({ path: path.join(SHOTS, "03-hud-speaker-muted.png"), clip: { x: topbar.x + topbar.width - 520, y: topbar.y - 4, width: 524, height: topbar.height + 8 } });
  await page.locator("#toggle-sound").click();
  check((await page.locator("#toggle-sound").getAttribute("data-muted")) === "0", "Lautsprecher schaltet Ton wieder an");
  if (topbar) await page.screenshot({ path: path.join(SHOTS, "03b-hud-speaker-on.png"), clip: { x: topbar.x + topbar.width - 520, y: topbar.y - 4, width: 524, height: topbar.height + 8 } });

  // Event popup.
  await e2e(page, "forceEvent", "festival");
  await page.waitForTimeout(700);
  check(await page.locator("#event-card").isVisible(), "Ereignis-Karte erscheint");
  await page.screenshot({ path: path.join(SHOTS, "04-event-popup.png") });
  const fundsBefore = (await e2e(page, "stats")) as { funds: number };
  await page.locator('#event-card [data-option="0"]').click();
  await page.waitForTimeout(1600);
  check(await page.locator("#event-card").isHidden(), "Ereignis-Karte schließt nach Wahl");
  const progress = (await e2e(page, "progress")) as { event: unknown; effects: { id: string }[]; stats: { festivals: number } };
  check(progress.event === null && progress.effects.some((effect) => effect.id === "fest"), "Wahl angewendet: Stadtfest-Effekt aktiv");
  const fundsAfter = (await e2e(page, "stats")) as { funds: number };
  console.log("funds", fundsBefore.funds, "→", fundsAfter.funds);
  check(await page.locator("#life-toast").isVisible(), "Ergebnis-Toast sichtbar");
  await page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>("#toast");
    if (toast) toast.hidden = true;
  });
  await page.screenshot({ path: path.join(SHOTS, "05-event-result-toast.png") });

  // Achievements + feed panel.
  await e2e(page, "chatter", 6);
  await page.waitForTimeout(400);
  check(await page.locator("#feed-ticker").isVisible(), "Bürger-Feed-Ticker sichtbar");
  await page.waitForTimeout(5600);
  await page.locator("#open-city").click();
  await page.waitForTimeout(500);
  check(await page.locator("#life").isVisible(), "Stadt-Panel öffnet");
  check((await page.locator(".life-ach li").count()) === 21, "21 Erfolge gelistet");
  check((await page.locator(".life-ach li.got").count()) >= 2, "Erfolge freigeschaltet (Showcase)");
  check((await page.locator(".life-feed li").count()) >= 4, "Bürger-Feed im Panel");
  await page.screenshot({ path: path.join(SHOTS, "06-city-panel.png") });
  await page.locator(".life-ach").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "07-achievements.png") });
  await page.locator(".life-feed").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "08-buerger-feed.png") });

  // Landmarks: build the Riesenrad from the panel.
  await page.locator(".life-marks").scrollIntoViewIfNeeded();
  const go = page.locator('.life-marks [data-build="wheel"]');
  check(await go.isVisible(), "Riesenrad im Panel baubar (Rang Kleinstadt)");
  check((await page.locator('.life-marks li.locked').count()) >= 1, "Höhere Wahrzeichen gesperrt");
  await go.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "09-landmarks-menu.png") });
  const lockedHall = await page.locator('.build-item[data-tool="cityhall"]').getAttribute("data-locked");
  check(lockedHall === "on", "Rathaus im Baumenü gesperrt");
  const spot = (await e2e(page, "spotFor", "wheel")) as { x: number; y: number } | null;
  check(spot !== null, "Bauplatz für Riesenrad gefunden");
  if (spot) {
    const placed = await page.evaluate((spot) => {
      const api = (window as unknown as { __citylineE2E: E2E }).__citylineE2E;
      const index = (api.cellIndex as (x: number, y: number) => number)(spot.x, spot.y);
      api.apply({ type: "service", index, kind: 12 });
      api.setTool("inspect");
      api.lookAt(spot.x, spot.y, 62, 1.0, 4, 0.7);
      return (api.progress() as { ach: number }).ach;
    }, spot);
    await page.waitForTimeout(1200);
    const built = await page.evaluate(() => (window as unknown as { __citylineE2E: E2E }).__citylineE2E.countService(12) as number);
    check(built === 1, `Riesenrad gebaut (ach ${placed})`);
    check((await page.locator('.build-item[data-tool="wheel"]').getAttribute("data-locked")) === "on", "Riesenrad danach gesperrt (nur eins)");
    await page.screenshot({ path: path.join(SHOTS, "09b-landmark-wheel.png") });
  }
  console.log("errors", errors.slice(0, 5));
  check(errors.length === 0, `Keine Konsolenfehler (${errors.length})`);
  await browser.close();
}

async function mobile(): Promise<void> {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await boot(page);
  await e2e(page, "showcase", 9);
  await page.waitForTimeout(1500);
  await e2e(page, "dismissUi");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, "10-mobile-portrait.png") });
  check(await page.locator("#toggle-sound").isVisible(), "Mobil: Lautsprecher sichtbar");
  await e2e(page, "forceEvent", "tourists");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, "11-mobile-event.png") });
  await page.locator('#event-card [data-option="0"]').tap();
  await page.waitForTimeout(600);
  await e2e(page, "chatter", 4);
  await page.locator("#open-city").tap();
  await page.waitForTimeout(600);
  check(await page.locator("#life").isVisible(), "Mobil: Stadt-Panel öffnet");
  await page.screenshot({ path: path.join(SHOTS, "12-mobile-city-panel.png") });
  await browser.close();
}

await desktop();
await mobile();
if (failures.length) {
  console.error(`life-playtest: ${failures.length} Fehler`, failures);
  process.exit(1);
}
console.log("life-playtest ok");
