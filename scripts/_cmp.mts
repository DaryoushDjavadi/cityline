import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
for (const port of [4174, 8787]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript({ content: "window.__name = (fn) => fn;" });
  await page.goto(`http://127.0.0.1:${port}/?preview=look&run=1&gfx=low&hour=9`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `/tmp/cmp-${port}.png` });
  const vis = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 200 && r.height > 40 && s.display !== "none" && s.visibility !== "hidden" && e.tagName !== "CANVAS"; }).map((e) => `${e.tagName}#${e.id}.${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} bf=${getComputedStyle(e).backdropFilter}`).slice(0, 30));
  console.log(port, vis.join("\n  "));
}
await browser.close();
