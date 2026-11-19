/**
 * Auftragstafel im Browser: Tafel öffnen, Ware fehlt/vorhanden, Liefern mit Animation + Belohnung, Mobile.
 *   npm run build && PORT=8787 npm start
 *   SHOTS=/workspace/cityline-shots/v2 npx tsx scripts/orders-playtest.mts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v2";
mkdirSync(SHOTS, { recursive: true });
const failures: string[] = [];
const check = (ok: unknown, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};
type E2E = Record<string, (...args: any[]) => any>;
const e2e = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(({ name, args }) => ((window as unknown as { __citylineE2E: E2E }).__citylineE2E[name] as (...a: unknown[]) => unknown)(...args), { name, args });
type Board = { slots: ({ id: number; reward: number; lines: { good: string; amount: number }[] } | null)[]; done: number; earned: number; lastDone?: { reward: number } | null };

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

async function fullBoard(page: Page): Promise<Board> {
  for (let i = 0; i < 40; i += 1) {
    const board = (await e2e(page, "orders")) as Board | null;
    if (board && board.slots.filter(Boolean).length === 3) return board;
    if (i % 5 === 4) console.log("  … warte auf Aufträge", JSON.stringify(await e2e(page, "snapshot")), JSON.stringify(board)?.slice(0, 200));
    await e2e(page, "advanceOrders", 15);
    await page.waitForTimeout(300);
  }
  throw new Error("Tafel füllt sich nicht");
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const errors: string[] = [];

// Desktop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => errors.push(String(err)));
  await boot(page);
  check(await page.locator("#open-orders").isHidden(), "Tafel-Knopf vor dem ersten Fortschritt versteckt oder bereit");
  await e2e(page, "showcase", 10);
  await e2e(page, "setOverlay", { zones: false });
  await e2e(page, "dismissUi");
  const board = await fullBoard(page);
  check(board.slots.every(Boolean), "Drei Aufträge hängen an der Tafel");
  check(await page.locator("#open-orders").isVisible(), "Tafel-Knopf in der Kopfleiste");
  const statsCut = await page.evaluate(() => {
    const bar = document.querySelector("#topbar")!.getBoundingClientRect();
    const actions = document.querySelector(".top-actions")!.getBoundingClientRect();
    return [...document.querySelectorAll("#city-stats .stat")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > Math.min(bar.right, actions.left) + 1 || r.left < bar.left - 1);
    }).length;
  });
  check(statsCut === 0, `Werteleiste bei 1280 px nicht abgeschnitten (${statsCut})`);
  await e2e(page, "setOrderStock", { food: 0, goods: 0, fish: 0 });
  await page.keyboard.press("j");
  await page.locator("#orders").waitFor({ state: "visible" });
  check(await page.locator(".order-card[data-order]").count() === 3, "Drei Karten sichtbar");
  check(await page.locator(".order-go:disabled").count() === 3, "Ohne Ware ist Liefern gesperrt");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "orders-01-tafel.png") });

  await e2e(page, "setOrderStock", { food: 900, goods: 900, fish: 900 });
  await page.waitForTimeout(700);
  check(await page.locator(".order-card.ready").count() === 3, "Mit Ware: alle Karten bereit (grün)");
  check((await page.locator("#orders-dot").textContent())?.trim() === "3", "Abzeichen zählt lieferbare Aufträge");
  await page.screenshot({ path: path.join(SHOTS, "orders-02-bereit.png") });

  await e2e(page, "dismissUi");
  // The showcase finishes the old city contracts at once; keep their toast out of the reward shot.
  await page.addStyleTag({ content: "#toast, #life-toast { display: none !important; }" });
  const before = (await e2e(page, "stats")) as { funds: number };
  const first = (await e2e(page, "orders")) as Board;
  await page.locator(".order-card[data-slot='0'] .order-go").click();
  await page.waitForTimeout(380);
  await page.screenshot({ path: path.join(SHOTS, "orders-03-liefern.png") });
  await page.waitForTimeout(650);
  check(await page.locator(".order-pop").count() === 1, "Belohnungs-Pop an der Kasse");
  await page.screenshot({ path: path.join(SHOTS, "orders-04-belohnung.png") });
  const after = (await e2e(page, "orders")) as Board;
  const stats = (await e2e(page, "stats")) as { funds: number };
  check(after.done === 1 && after.earned >= first.slots[0]!.reward, `Lieferung gezählt (done ${after.done}, +${after.earned} €)`);
  check(stats.funds >= before.funds + first.slots[0]!.reward - 2000, `Kasse gestiegen (${before.funds} → ${stats.funds})`);
  check(after.lastDone?.reward === after.earned, "Belohnung in lastDone für alle Koop-Clients");
  // Skip
  const skipId = after.slots[1]!.id;
  await page.locator(".order-card[data-slot='1'] .order-skip").click();
  await page.waitForTimeout(400);
  const skipped = (await e2e(page, "orders")) as Board;
  check(skipped.slots[1] === null || skipped.slots[1].id !== skipId, "Ablehnen entfernt den Auftrag");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "orders-05-danach.png") });
  await page.keyboard.press("Escape");
  check(await page.locator("#orders").isHidden(), "Escape schließt die Tafel");
  await page.close();
}

// Mobile
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (err) => errors.push(String(err)));
  await boot(page);
  await e2e(page, "showcase", 10);
  await e2e(page, "dismissUi");
  await fullBoard(page);
  await e2e(page, "setOrderStock", { food: 900, goods: 40, fish: 900 });
  await page.locator("#open-orders").tap();
  await page.locator("#orders").waitFor({ state: "visible" });
  const box = await page.locator("#orders").boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 391, "Tafel passt auf Handybreite");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "orders-06-mobile.png") });
  await page.close();
}

check(errors.length === 0, `Keine Seitenfehler ${errors.join(" | ")}`);
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} Fehler`);
  process.exit(1);
}
console.log("\nAuftragstafel-Playtest OK");
