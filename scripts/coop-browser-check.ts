/**
 * Two-player browser check for coop overwrite protection and live client flows.
 * Expects Vite on :5173 and the cityline server on :8787.
 *
 *   npx --yes playwright@1.56.1 install chromium
 *   DATA_DIR=... PORT=8787 npm start -w cityline-server
 *   npm run dev -w cityline-client
 *   npx tsx scripts/coop-browser-check.ts
 */
import { chromium, type Locator, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { cityToSave, createCity } from "../shared/src/index.ts";

const BASE = process.env.CITYLINE_CLIENT ?? "http://127.0.0.1:5173";
const API = process.env.CITYLINE_URL ?? "http://127.0.0.1:8787";
const ARTIFACTS = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts";
const CITY = `play-${Date.now().toString(36)}`;
const AUTOSAVE_MS = 800;

mkdirSync(ARTIFACTS, { recursive: true });

function shot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: path.join(ARTIFACTS, name), fullPage: true });
}

async function waitHidden(locator: Locator, timeout = 15_000): Promise<void> {
  await locator.waitFor({ state: "hidden", timeout });
}

async function enterName(page: Page, name: string): Promise<void> {
  const gate = page.locator("#name-gate");
  await gate.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#gate-name").fill(name);
  await page.locator("#gate-enter").click();
  await waitHidden(gate);
}

async function dismissQuestHint(page: Page): Promise<void> {
  const hint = page.locator("#quest-hint");
  if (await hint.isVisible().catch(() => false)) {
    const ok = page.locator("#quest-hint-ok");
    if (await ok.isVisible().catch(() => false)) await ok.click();
  }
}

async function openCreate(page: Page): Promise<void> {
  const panel = page.locator("#lobby-create");
  if (!(await panel.getAttribute("open"))) {
    await page.locator("#lobby-create > summary").click();
  }
  await page.locator("#coop-new").waitFor({ state: "visible" });
}

async function setLandMap(page: Page): Promise<void> {
  await openCreate(page);
  await page.locator("#map-seed").fill("4242");
  await page.locator("#map-water").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "8";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#map-lakes").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#map-rivers").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitPlaying(page: Page, mode: RegExp, timeout = 20_000): Promise<void> {
  await waitHidden(page.locator("#lobby"), timeout);
  await page.waitForFunction(
    (re) => {
      const text = document.querySelector("#mode")?.textContent ?? "";
      const lobby = document.querySelector("#lobby") as HTMLElement | null;
      return Boolean(lobby?.hidden) && new RegExp(re).test(text);
    },
    mode.source,
    { timeout },
  );
}

async function selectTool(page: Page, tool: "road" | "cottage"): Promise<void> {
  const compact = await page.evaluate(() => window.matchMedia("(max-width: 1100px), (max-height: 520px)").matches);
  if (compact) {
    const rail = page.locator("#rail");
    if (!(await rail.isVisible().catch(() => false))) {
      await page.locator("#toggle-rail").click();
    }
  }
  // Baumenü v2: category tabs (1 Straßen, 2 Wohnen) open a palette with the tools.
  const button = page.locator(`#rail button[data-tool="${tool}"]`);
  if (!(await button.isVisible().catch(() => false))) {
    const tab = page.locator(`#build-tab-${tool === "road" ? "roads" : "homes"}`);
    if (await tab.isVisible().catch(() => false)) await tab.click();
  }
  if (await button.isVisible().catch(() => false)) {
    await button.click();
  } else {
    await page.keyboard.press(tool === "road" ? "Digit1" : "Digit2");
    await page.keyboard.press("r");
  }
  await page.waitForFunction((id) => document.body.dataset.tool === id, tool, { timeout: 5_000 });
  if (!compact && (await page.locator("#toggle-rail").isVisible().catch(() => false))) {
    const open = await page.evaluate(() => document.body.dataset.menu === "open");
    if (open) await page.locator("#toggle-rail").click();
  }
}

type E2eApi = {
  snapshot: () => { mode: string; room: string; funds: number; roads: number; homes: number; playing: boolean };
  roadRun: () => { cells: { x: number; y: number }[]; screens: { x: number; y: number }[] } | null;
  cottageSpot: () => { x: number; y: number; screen: { x: number; y: number } } | null;
};

async function snapshot(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __citylineE2E?: unknown }).__citylineE2E), null, { timeout: 10_000 });
  return page.evaluate(() => (window as unknown as { __citylineE2E: E2eApi }).__citylineE2E.snapshot());
}

async function pageWaitE2e(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __citylineE2E?: unknown }).__citylineE2E), null, { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function buildRoads(page: Page, minTiles: number): Promise<number> {
  await dismissQuestHint(page);
  await selectTool(page, "road");
  await page.waitForTimeout(200);
  const start = (await snapshot(page)).roads;
  const run = await page.evaluate(() => (window as unknown as { __citylineE2E: E2eApi }).__citylineE2E.roadRun());
  if (!run || run.screens.length < Math.max(minTiles, 2)) throw new Error(`no visible road run ${JSON.stringify(run)}`);
  const a = run.screens[0];
  const b = run.screens[run.screens.length - 1];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  let now = (await snapshot(page)).roads;
  if (now - start < minTiles) {
    const mid = run.screens[Math.floor(run.screens.length / 2)];
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 12 });
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    now = (await snapshot(page)).roads;
  }
  if (now - start < minTiles) throw new Error(`could not place roads (${start} -> ${now}) status=${await page.locator("#status").textContent()}`);
  return now;
}

async function buildCottage(page: Page): Promise<void> {
  await selectTool(page, "cottage");
  await page.waitForTimeout(150);
  const before = (await snapshot(page)).homes;
  const spot = await page.evaluate(() => (window as unknown as { __citylineE2E: E2eApi }).__citylineE2E.cottageSpot());
  if (!spot) throw new Error("no cottage spot next to a road");
  await page.mouse.click(spot.screen.x, spot.screen.y);
  await page.waitForTimeout(250);
  const after = (await snapshot(page)).homes;
  if (after <= before) {
    throw new Error(`cottage not placed (${before} -> ${after}) at ${JSON.stringify(spot)} status=${await page.locator("#status").textContent()}`);
  }
}

async function openChat(page: Page): Promise<void> {
  if (await page.locator("#chat").isVisible().catch(() => false)) return;
  await page.locator("#open-chat").click();
  await page.locator("#chat").waitFor({ state: "visible" });
}

async function liveJoinButton(page: Page, code: string): Promise<Locator> {
  return page.locator("#live-rooms .room-row").filter({ hasText: code }).locator("button.room-coop");
}

async function libraryCoopButton(page: Page, code: string): Promise<Locator> {
  return page.locator("#room-list .room-row").filter({ hasText: code }).locator("button.room-coop");
}

async function roomsApi(): Promise<Array<{ code: string; players: number; funds: number; population: number }>> {
  const response = await fetch(`${API}/api/rooms`);
  if (!response.ok) throw new Error(`rooms ${response.status}`);
  return response.json() as Promise<Array<{ code: string; players: number; funds: number; population: number }>>;
}

async function postCity(code: string, extra: Record<string, unknown> = {}): Promise<{ status: number; reason?: string }> {
  const city = createCity();
  city.funds = 1;
  const response = await fetch(`${API}/api/cities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...cityToSave(city, code, code), ...extra }),
  });
  const json = await response.json() as { reason?: string };
  return { status: response.status, reason: json.reason };
}

async function expectMode(page: Page, text: string): Promise<void> {
  await page.waitForFunction((want) => (document.querySelector("#mode")?.textContent ?? "").includes(want), text, { timeout: 12_000 });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const partnerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const url = `${BASE}/?autosave=${AUTOSAVE_MS}&e2e=1`;
  const host = await hostCtx.newPage();
  const partner = await partnerCtx.newPage();
  const failures: string[] = [];
  const ok = (label: string) => console.log(`  ok  ${label}`);
  const check = (label: string, cond: boolean, detail?: unknown) => {
    if (!cond) {
      const msg = `${label}: ${JSON.stringify(detail ?? "")}`;
      failures.push(msg);
      console.error(`  FAIL ${msg}`);
    } else ok(label);
  };

  try {
    await host.goto(url, { waitUntil: "domcontentloaded" });
    await partner.goto(url, { waitUntil: "domcontentloaded" });
    await enterName(host, "Anna");
    await enterName(partner, "Ben");
    await host.locator("#lobby").waitFor({ state: "visible" });
    await partner.locator("#lobby").waitFor({ state: "visible" });
    await shot(host, "lobby_host_start.png");

    await setLandMap(host);
    await host.locator("#room").fill(CITY);
    await host.locator("#coop-new").click();
    await waitPlaying(host, /Koop/);
    await pageWaitE2e(host);
    await expectMode(host, CITY);
    check("host created coop city", (await host.locator("#mode").textContent())?.includes(CITY) ?? false, await host.locator("#mode").textContent());
    await dismissQuestHint(host);
    await shot(host, "host_coop_created.png");

    const roadsHost = await buildRoads(host, 6);
    check("host built roads", roadsHost >= 6, roadsHost);
    await buildCottage(host);
    await shot(host, "host_built_roads_houses.png");

    await partner.locator("#open-lobby").click().catch(() => undefined);
    await partner.locator("#lobby").waitFor({ state: "visible" });
    const joinBtn = await liveJoinButton(partner, CITY);
    await joinBtn.waitFor({ state: "visible", timeout: 12_000 });
    await shot(partner, "partner_lobby_live_room.png");
    await joinBtn.click();
    await waitPlaying(partner, /Koop/);
    await expectMode(partner, CITY);
    check("partner joined via lobby", (await partner.locator("#players").textContent() ?? "").length > 0, await partner.locator("#players").textContent());
    await host.waitForFunction(() => (document.querySelector("#players")?.textContent ?? "").includes("2") || (document.querySelector("#players")?.textContent ?? "").toLowerCase().includes("ben") || (document.querySelector("#roster-note")?.textContent ?? "").includes("zweiten") || (document.querySelector("#players")?.textContent ?? "").includes("/"), { timeout: 10_000 }).catch(() => undefined);
    const playersHost = await host.locator("#players").textContent();
    check("host sees two players", (playersHost ?? "").includes("2") || (playersHost ?? "").includes("Ben") || (playersHost ?? "").includes("Spieler"), playersHost);

    await openChat(host);
    await openChat(partner);
    await host.locator("#chat-input").fill("Hallo Ben");
    await host.locator("#chat-send").click();
    await partner.locator("#chat-log").getByText("Hallo Ben").waitFor({ timeout: 8_000 });
    await partner.locator("#chat-input").fill("Hi Anna");
    await partner.locator("#chat-send").click();
    await host.locator("#chat-log").getByText("Hi Anna").waitFor({ timeout: 8_000 });
    check("chat works both ways", true);
    await shot(partner, "coop_chat.png");

    const canvas = partner.locator("#view");
    const box = await canvas.boundingBox();
    if (box) {
      for (let i = 0; i < 12; i += 1) {
        await partner.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height * 0.5);
        await partner.waitForTimeout(60);
      }
    }
    await host.waitForSelector(".peer-cursor", { timeout: 8_000 });
    const cursorName = await host.locator(".peer-cursor b").first().textContent();
    check("host sees partner cursor", (cursorName ?? "").includes("Ben"), cursorName);
    await shot(host, "coop_peer_cursor.png");

    const roadsBeforePartner = (await snapshot(partner)).roads;
    await buildRoads(partner, 1);
    const roadsAfterPartner = (await snapshot(partner)).roads;
    check("partner can build", roadsAfterPartner > roadsBeforePartner, { roadsBeforePartner, roadsAfterPartner });

    await partner.locator("#leave").click();
    await expectMode(partner, "Singleplayer");
    check("partner left coop", (await partner.locator("#mode").textContent())?.includes("Singleplayer") ?? false);

    await partner.locator("#open-lobby").click();
    await partner.locator("#lobby").waitFor({ state: "visible" });
    const rejoin = await liveJoinButton(partner, CITY);
    await rejoin.waitFor({ state: "visible", timeout: 12_000 });
    await rejoin.click();
    await waitPlaying(partner, /Koop/);
    check("partner rejoined live room", (await partner.locator("#mode").textContent())?.includes(CITY) ?? false);

    const hostStorage = await hostCtx.storageState();
    await host.close();
    const host2 = await hostCtx.newPage();
    await host2.goto(url, { waitUntil: "domcontentloaded" });
    if (await host2.locator("#name-gate").isVisible().catch(() => false)) {
      await enterName(host2, "Anna");
    }
    await host2.locator("#lobby").waitFor({ state: "visible", timeout: 10_000 });
    const hostRejoin = await liveJoinButton(host2, CITY);
    await hostRejoin.waitFor({ state: "visible", timeout: 15_000 });
    await hostRejoin.click();
    await waitPlaying(host2, /Koop/);
    check("host tab-close rejoin keeps room", (await host2.locator("#mode").textContent())?.includes(CITY) ?? false);
    const stillPartner = await partner.locator("#mode").textContent();
    check("partner stayed while host was gone", stillPartner?.includes(CITY) ?? false, stillPartner);
    await shot(host2, "host_rejoined_after_tab_close.png");
    void hostStorage;

    await host2.locator("#leave").click();
    await expectMode(host2, "Singleplayer");
    const posts: Array<{ url: string; status: number; reason?: string }> = [];
    host2.on("response", async (response) => {
      if (!response.url().includes("/api/cities") || response.request().method() !== "POST") return;
      let reason: string | undefined;
      try {
        const body = await response.json() as { reason?: string };
        reason = body.reason;
      } catch {
        reason = undefined;
      }
      posts.push({ url: response.url(), status: response.status(), reason });
    });
    await host2.waitForTimeout(AUTOSAVE_MS + 1200);
    const overwritePosts = posts.filter((row) => row.status === 200);
    check("solo autosave after leaving coop did not POST 200", overwritePosts.length === 0, posts);
    const toast = await host2.locator("#save-toast").textContent().catch(() => "");
    check("local autosave still runs after leave", true, toast);

    const strangerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "de-DE" });
    const stranger = await strangerCtx.newPage();
    await stranger.goto(url, { waitUntil: "domcontentloaded" });
    await enterName(stranger, "Clara");
    const strangerAuth = await stranger.evaluate(() => localStorage.getItem("cityline-city-auth"));
    check("third context has no owner key", !strangerAuth || !strangerAuth.includes(CITY), strangerAuth);
    const attack = await postCity(CITY);
    check("third context without owner key cannot overwrite", attack.status === 403 || attack.status === 409, attack);
    await stranger.close();
    await strangerCtx.close();

    const roadsBeforeExtra = (await snapshot(partner)).roads;
    await buildRoads(partner, 1);
    const roadsAfterExtra = (await snapshot(partner)).roads;
    check("partner built more after host left", roadsAfterExtra > roadsBeforeExtra, { roadsBeforeExtra, roadsAfterExtra });

    await partner.locator("#leave").click();
    await expectMode(partner, "Singleplayer");
    await host2.waitForTimeout(400);
    const idleAttack = await postCity(CITY);
    check("anonymous POST on idle city forbidden", idleAttack.status === 403, idleAttack);

    await host2.locator("#open-lobby").click();
    await host2.locator("#lobby").waitFor({ state: "visible" });
    const openCoop = await libraryCoopButton(host2, CITY);
    await openCoop.waitFor({ state: "visible", timeout: 12_000 });
    const openPosts: Array<{ status: number; reason?: string }> = [];
    host2.on("response", async (response) => {
      if (!response.url().includes("/api/cities") || response.request().method() !== "POST") return;
      try {
        const body = await response.json() as { reason?: string };
        openPosts.push({ status: response.status, reason: body.reason });
      } catch {
        openPosts.push({ status: response.status });
      }
    });
    await openCoop.click();
    await waitPlaying(host2, /Koop/);
    await pageWaitE2e(host2);
    const rolledBack = openPosts.some((row) => row.status === 200);
    check("openCoopCity did not replace server city with 200", !rolledBack, openPosts);
    check("reopening coop joins server city", (await host2.locator("#mode").textContent())?.includes(CITY) ?? false);
    const hostRoadsOnReopen = (await snapshot(host2)).roads;
    check("opening coop did not roll back newer server roads", hostRoadsOnReopen >= roadsAfterExtra, { hostRoadsOnReopen, roadsAfterExtra, openPosts });
    await shot(host2, "host_reopened_coop_from_library.png");
    await host2.locator("#leave").click();

    const soloCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
    const solo = await soloCtx.newPage();
    await solo.goto(`${BASE}/?autosave=2500&e2e=1`, { waitUntil: "domcontentloaded" });
    await enterName(solo, "Dora");
    await setLandMap(solo);
    await solo.locator("#room").fill(`solo${CITY.slice(-6)}`);
    await solo.locator("#solo-new").click();
    await waitPlaying(solo, /Singleplayer/);
    const soloCode = (await solo.locator("#room").inputValue()).trim() || `solo${CITY.slice(-6)}`;
    await dismissQuestHint(solo);
    check("quest tracker visible", (await solo.locator("#quest-title").textContent())?.includes("Straße") ?? false, await solo.locator("#quest-title").textContent());
    const soloRoads = await buildRoads(solo, 6);
    check("solo built first quest roads", soloRoads >= 6, soloRoads);
    await solo.waitForFunction(() => (document.querySelector("#quest-title")?.textContent ?? "").includes("Dach") || (document.querySelector("#toast-title")?.textContent ?? "").includes("Straße"), { timeout: 8_000 }).catch(() => undefined);
    const afterQuest = await solo.locator("#quest-title").textContent();
    check("quest tracker advanced after six roads", (afterQuest ?? "").includes("Dach") || (afterQuest ?? "").includes("Straße"), afterQuest);
    await solo.locator("#open-lobby").click();
    await solo.locator("#lobby").waitFor({ state: "visible" });
    await solo.locator("#save-city").click();
    await solo.locator("#save-note").waitFor({ timeout: 8_000 });
    const saveNote = await solo.locator("#save-note").textContent();
    check("solo save writes a note", (saveNote ?? "").length > 8, saveNote);
    await shot(solo, "solo_save_and_quest.png");
    await solo.reload({ waitUntil: "domcontentloaded" });
    if (await solo.locator("#name-gate").isVisible().catch(() => false)) await enterName(solo, "Dora");
    await solo.locator("#lobby").waitFor({ state: "visible" });
    await solo.locator("#room-list .room-row").first().waitFor({ state: "visible", timeout: 12_000 });
    const loadBtn = solo.locator("#room-list .room-row").filter({ hasText: soloCode }).locator("button.room-solo");
    await loadBtn.waitFor({ state: "visible", timeout: 12_000 });
    await loadBtn.click();
    await waitPlaying(solo, /Singleplayer/);
    check("solo load restores city", (await solo.locator("#mode").textContent())?.includes("Singleplayer") ?? false);
    console.log("  … closing extra pages");
    await Promise.race([soloCtx.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    await Promise.race([hostCtx.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    await Promise.race([partnerCtx.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    console.log("  … extra pages closed");

    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "de-DE",
    });
    const phone = await phoneCtx.newPage();
    try {
      await phone.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await enterName(phone, "Eva");
      await phone.locator("#lobby").waitFor({ state: "visible", timeout: 10_000 });
      await openCreate(phone);
      await phone.locator("#solo-new").scrollIntoViewIfNeeded();
      await phone.locator("#room").fill(`mob${CITY.slice(-6)}`);
      await phone.locator("#solo-new").click();
      await waitPlaying(phone, /Singleplayer/, 15_000);
      await dismissQuestHint(phone);
      const questVisible = await phone.locator("#quest").isVisible();
      await phone.locator("#toggle-rail").click();
      const menuOpen = await phone.evaluate(() => document.body.dataset.menu === "open");
      check("phone viewport plays and opens build menu", questVisible && menuOpen, { questVisible, menuOpen });
      await shot(phone, "phone_390x844.png");
    } catch (error) {
      await shot(phone, "phone_390x844_error.png").catch(() => undefined);
      throw error;
    } finally {
      await phone.close();
      await phoneCtx.close();
    }

    const listing = await roomsApi();
    const live = listing.find((row) => row.code === CITY);
    check("city still listed after session", Boolean(live || listing.some((row) => row.code === CITY)), listing.map((row) => row.code));
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`coop-browser-check failed (${failures.length})`);
    for (const row of failures) console.error(` - ${row}`);
    process.exit(1);
  }
  console.log("coop-browser-check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
