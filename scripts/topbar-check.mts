/**
 * Top bar layout check: height + overlaps at phone/tablet/desktop widths (quest open and collapsed).
 *   CITYLINE_CLIENT=http://127.0.0.1:8787 SHOTS=/workspace/cityline-shots/v3 TAG=after npx tsx scripts/topbar-check.mts
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? "/workspace/cityline-shots/v3";
const TAG = process.env.TAG ?? "after";
mkdirSync(SHOTS, { recursive: true });
const SIZES: [string, number, number, boolean][] = [
  ["375", 375, 812, true], ["390", 390, 844, true], ["430", 430, 932, true],
  ["land-844", 844, 390, true], ["1024", 1024, 768, false], ["1280", 1280, 800, false], ["1920", 1920, 1080, false],
];

async function boot(page: Page): Promise<void> {
  await page.addInitScript({ content: "window.__name = (fn) => fn; localStorage.setItem('cityline-name','Daryoush');" });
  await page.goto(`${BASE}/?e2e=1&gfx=low`, { waitUntil: "networkidle" });
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
  await page.waitForFunction(() => Boolean((window as any).__cityline?.ready), undefined, { timeout: 60_000 });
  // Worst case for the bar: all badges showing.
  await page.evaluate(() => { for (const id of ["orders-dot", "life-dot"]) { const el = document.getElementById(id); if (el) { el.hidden = false; if (!el.textContent) el.textContent = "3"; } } });
  await page.locator("#quest-hint-ok").click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

const inspect = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("#topbar")!;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const scroller = document.querySelector<HTMLElement>(".stats");
    const clip = scroller?.getBoundingClientRect();
    const items: { name: string; r: DOMRect }[] = [];
    const add = (el: Element | null, name: string) => {
      if (!el || !visible(el)) return;
      let r = el.getBoundingClientRect();
      if (clip && scroller!.contains(el)) {
        // Stats inside a scroll row only count where they are actually visible.
        const left = Math.max(r.left, clip.left);
        const right = Math.min(r.right, clip.right);
        if (right - left < 2) return;
        r = new DOMRect(left, r.top, right - left, r.height);
      }
      items.push({ name, r });
    };
    add(bar.querySelector(".brand"), "brand");
    bar.querySelectorAll(".stats .stat").forEach((el) => add(el, `stat:${(el as HTMLElement).dataset.stat}`));
    add(bar.querySelector("#quest .quest-main"), "quest");
    add(bar.querySelector("#quest-collapse"), "quest-collapse");
    bar.querySelectorAll(".top-actions > *").forEach((el) => add(el, `btn:${el.id}`));
    bar.querySelectorAll(".top-actions [id$='-dot']").forEach((el) => add(el, `dot:${el.id}`));
    const overlaps: string[] = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i].r;
        const b = items[j].r;
        if (items[i].name.startsWith("dot:") || items[j].name.startsWith("dot:")) {
          // A badge may sit on its own button; anything else is an overlap.
          const dot = items[i].name.startsWith("dot:") ? items[i] : items[j];
          const other = dot === items[i] ? items[j] : items[i];
          const owner = document.getElementById(dot.name.slice(4))?.closest(".hud-btn")?.id;
          if (other.name === `btn:${owner}`) continue;
        }
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) overlaps.push(`${items[i].name}×${items[j].name}`);
      }
    }
    // Things sticking out of the viewport count too.
    for (const it of items) if (it.r.right > innerWidth + 1 || it.r.left < -1) overlaps.push(`${it.name} außerhalb`);
    const r = bar.getBoundingClientRect();
    const quest = document.querySelector("#quest")?.getBoundingClientRect();
    return { height: Math.round(r.height), bottom: Math.round(Math.max(r.bottom, quest?.bottom ?? 0)), overlaps };
  });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
let bad = 0;
for (const [name, width, height, touch] of SIZES) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch });
  const page = await context.newPage();
  await boot(page);
  const open = await inspect(page);
  await page.screenshot({ path: `${SHOTS}/${TAG}-topbar-${name}.png`, clip: { x: 0, y: 0, width, height: Math.min(height, Math.max(open.bottom + 16, 120)) } });
  await page.locator("#quest-collapse").click().catch(() => undefined);
  await page.waitForTimeout(300);
  const folded = await inspect(page);
  await page.screenshot({ path: `${SHOTS}/${TAG}-topbar-${name}-quest-zu.png`, clip: { x: 0, y: 0, width, height: Math.min(height, Math.max(folded.bottom + 16, 120)) } });
  console.log(`${name}: Leiste ${open.height}px, HUD bis ${open.bottom}px (Auftrag zu: ${folded.bottom}px) · Überlappungen: ${[...open.overlaps, ...folded.overlaps.map((o) => `zu:${o}`)].join(", ") || "keine"}`);
  bad += open.overlaps.length + folded.overlaps.length;
  await context.close();
}
await browser.close();
if (bad && process.env.STRICT) process.exit(1);
