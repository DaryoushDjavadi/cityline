/**
 * Stadtleben: rank progress, events with choices, daily challenge, achievements,
 * landmarks and the Bürger-Feed. Pure DOM; all state comes from the sim (city.progress),
 * so solo and coop behave the same.
 */
import {
  ACHIEVEMENTS,
  DAY_TICKS,
  EVENT_TIMEOUT,
  LANDMARKS,
  RANKS,
  challengeProgress,
  challengeText,
  cityMetrics,
  eventDef,
  incomeBoost,
  landmarkBlock,
  type CityProgress,
  type CityState,
  type SimMeta,
} from "../../../shared/src/index.ts";
import { cityChatter, type FeedLine } from "./feed.ts";
import type { Cue } from "../audio/sfx.ts";

export type LandmarkTool = "wheel" | "cityhall" | "tvtower";
const TOOL_BY_KEY: Record<string, LandmarkTool> = { wheel: "wheel", hall: "cityhall", tower: "tvtower" };

export interface CityLifeHooks {
  choose(event: string, option: number): void;
  sound(cue: Cue): void;
  pickTool(tool: LandmarkTool): void;
  locks(locks: Partial<Record<LandmarkTool, string | null>>): void;
  /** Called when the panel opens so other side panels can close. */
  opened(): void;
}

const EFFECT_LABEL: Record<string, string> = {
  fest: "Stadtfest",
  grumpy: "Enttäuschte Bürger",
  storm: "Sturmschäden",
  tourism: "Touristenwelle",
  calm: "Ruhige Gassen",
  harborfest: "Hafenfest",
  beachparty: "Strandparty",
  heat: "Hitzewelle",
  market: "Bauernmarkt",
  concert: "Konzert-Nachklang",
  boom: "Investitionsboom",
};

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
const money = (value: number): string => `${Math.round(value).toLocaleString("de-DE")} €`;
const hoursLeft = (ticks: number): string => {
  const hours = Math.max(1, Math.round((ticks / DAY_TICKS) * 24));
  return hours >= 24 ? `noch ${Math.round(hours / 24)} Tag${hours >= 36 ? "e" : ""}` : `noch ${hours} Std`;
};

interface Toast {
  kicker: string;
  title: string;
  text: string;
  pay: number;
  tone: "gold" | "event" | "teal";
}

export class CityLife {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly card: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private city: CityState | null = null;
  private enabled = true;
  private open = false;
  private baseline: CityProgress | null = null;
  private seen = { ach: 0, rank: 0, challenges: 0, lastTick: -1, event: "" };
  private feed: (FeedLine & { at: number })[] = [];
  private recent = new Set<string>();
  private nextChatter = performance.now() + 9_000;
  private toastQueue: Toast[] = [];
  private toastTimer = 0;
  private chosen = "";
  private lastRender = 0;
  private lockKey = "";
  private cardKey = "";

  constructor(private readonly hooks: CityLifeHooks) {
    this.button = document.getElementById("open-city") as HTMLButtonElement;
    this.badge = document.getElementById("life-dot") as HTMLElement;
    this.button.addEventListener("click", () => this.toggle());

    this.panel = document.createElement("aside");
    this.panel.id = "life";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Stadt-Übersicht");
    this.panel.innerHTML = `<div class="panel-head"><p class="eyebrow">Deine Stadt</p><button id="life-close" type="button" aria-label="Schließen">×</button></div><div id="life-body"></div>`;
    this.body = this.panel.querySelector("#life-body") as HTMLElement;
    (this.panel.querySelector("#life-close") as HTMLButtonElement).addEventListener("click", () => this.toggle(false));
    this.body.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-build]");
      if (!target) return;
      this.hooks.pickTool(target.dataset.build as LandmarkTool);
      this.toggle(false);
    });

    this.card = document.createElement("section");
    this.card.id = "event-card";
    this.card.hidden = true;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-live", "polite");
    this.card.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-option]");
      if (!target || target.disabled || !this.city?.progress?.event) return;
      const id = this.city.progress.event.id;
      this.chosen = `${id}:${this.city.progress.event.at}`;
      this.hooks.choose(id, Number(target.dataset.option));
      this.card.hidden = true;
    });

    this.toastEl = document.createElement("div");
    this.toastEl.id = "life-toast";
    this.toastEl.hidden = true;
    this.toastEl.setAttribute("aria-live", "polite");

    this.ticker = document.createElement("div");
    this.ticker.id = "feed-ticker";
    this.ticker.hidden = true;
    this.ticker.addEventListener("click", () => this.toggle(true));

    const app = document.getElementById("app") ?? document.body;
    app.append(this.panel, this.card, this.toastEl, this.ticker);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next && !this.enabled) return;
    this.open = next;
    this.panel.hidden = !next;
    document.body.dataset.life = next ? "on" : "off";
    this.button.classList.toggle("active", next);
    this.button.setAttribute("aria-pressed", String(next));
    if (next) {
      this.badge.hidden = true;
      this.hooks.opened();
      this.render(true);
    }
  }

  /** New city (load, new game, room switch): forget toasts/feed baseline. */
  reset(): void {
    this.baseline = null;
    this.feed = [];
    this.recent.clear();
    this.toastQueue = [];
    this.toastEl.hidden = true;
    this.card.hidden = true;
    this.ticker.hidden = true;
    this.chosen = "";
    this.cardKey = "";
    this.lockKey = "";
  }

  push(line: FeedLine): void {
    this.feed.unshift({ ...line, at: Date.now() });
    if (this.feed.length > 30) this.feed.length = 30;
    this.recent.add(line.text);
    if (this.recent.size > 14) this.recent.delete(this.recent.values().next().value as string);
    this.ticker.innerHTML = `<b>${esc(line.who)}</b><span>${esc(line.text)}</span>`;
    this.ticker.dataset.tone = line.tone;
    this.ticker.hidden = !this.enabled;
    this.ticker.classList.remove("in");
    void this.ticker.offsetWidth;
    this.ticker.classList.add("in");
    if (this.open) this.render(true);
  }

  /** Test/e2e helper: emit a few resident lines right away. */
  chatterNow(city: CityState, meta: SimMeta, count: number): number {
    let made = 0;
    for (let i = 0; i < count; i += 1) {
      const line = cityChatter(city, meta, this.recent, this.feed[0]?.text);
      if (!line) break;
      this.push(line);
      made += 1;
    }
    return made;
  }

  update(city: CityState, meta: SimMeta): void {
    this.city = city;
    const progress = city.progress;
    const enabled = Boolean(progress && !progress.off);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.button.hidden = !enabled;
      if (!enabled) {
        this.toggle(false);
        this.card.hidden = true;
        this.ticker.hidden = true;
      }
    }
    if (!progress || !enabled) return;
    if (!this.baseline) {
      this.baseline = progress;
      this.seen = {
        ach: progress.ach,
        rank: progress.rank,
        challenges: progress.stats.challenges,
        lastTick: progress.last?.tick ?? -1,
        event: progress.event ? `${progress.event.id}:${progress.event.at}` : "",
      };
    } else {
      this.diff(progress);
    }
    this.updateCard(city, progress, meta);
    this.updateLocks(city);
    const now = performance.now();
    if (now >= this.nextChatter && meta.stats.population > 0) {
      this.nextChatter = now + 32_000 + Math.random() * 28_000;
      const line = cityChatter(city, meta, this.recent, this.feed[0]?.text);
      if (line) this.push(line);
    }
    if (this.open && now - this.lastRender > 900) this.render(false);
  }

  private diff(p: CityProgress): void {
    const newAch = p.ach & ~this.seen.ach;
    if (newAch) {
      for (const ach of ACHIEVEMENTS) {
        if (!(newAch & ach.bit)) continue;
        this.queue({ kicker: "Erfolg freigeschaltet", title: ach.title, text: ach.text, pay: ach.reward, tone: "gold" }, "achievement");
        this.push({ who: "Stadtchronik", text: `Erfolg „${ach.title}“ freigeschaltet.`, tone: "city" });
      }
      if (!this.open) this.badge.hidden = false;
    }
    if (p.rank > this.seen.rank) {
      const rank = RANKS[p.rank];
      this.queue({ kicker: "Neuer Rang", title: rank.name, text: rank.perk, pay: rank.reward, tone: "teal" }, "rank");
      this.push({ who: "Stadtchronik", text: `Wir sind jetzt ${rank.name}! ${rank.perk}`, tone: "city" });
      if (!this.open) this.badge.hidden = false;
    }
    if (p.stats.challenges > this.seen.challenges && p.last?.kind === "challenge") {
      this.queue({ kicker: "Tagesaufgabe geschafft", title: p.last.title, text: p.last.text, pay: p.last.pay, tone: "gold" }, "goal");
    }
    if (p.last && p.last.tick !== this.seen.lastTick && p.last.kind === "event") {
      this.queue({ kicker: "Ereignis", title: p.last.title, text: p.last.text, pay: p.last.pay, tone: "event" }, p.last.pay < 0 ? "reject" : "cash");
      this.push({ who: "Stadtchronik", text: `${p.last.title}: ${p.last.text}`, tone: p.last.pay < 0 ? "bad" : "city" });
    }
    const eventKey = p.event ? `${p.event.id}:${p.event.at}` : "";
    if (eventKey && eventKey !== this.seen.event) {
      const def = eventDef(p.event!.id);
      this.hooks.sound("event");
      if (def) this.push({ who: "Eilmeldung", text: def.title, tone: "info" });
    }
    this.seen = { ach: p.ach, rank: p.rank, challenges: p.stats.challenges, lastTick: p.last?.tick ?? -1, event: eventKey };
  }

  private queue(toast: Toast, cue: Cue): void {
    this.toastQueue.push(toast);
    if (this.toastQueue.length > 4) this.toastQueue.shift();
    if (this.toastEl.hidden) this.nextToast(cue);
    else this.hooks.sound(cue);
  }

  private nextToast(cue?: Cue): void {
    window.clearTimeout(this.toastTimer);
    const toast = this.toastQueue.shift();
    if (!toast) {
      this.toastEl.hidden = true;
      return;
    }
    if (cue) this.hooks.sound(cue);
    const pay = toast.pay ? `<em class="${toast.pay < 0 ? "neg" : ""}">${toast.pay > 0 ? "+" : "−"}${money(Math.abs(toast.pay))}</em>` : "";
    this.toastEl.dataset.tone = toast.tone;
    this.toastEl.innerHTML = `<small>${esc(toast.kicker)}</small><strong>${esc(toast.title)}</strong><p>${esc(toast.text)}</p>${pay}`;
    this.toastEl.hidden = false;
    this.toastEl.classList.remove("in");
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("in");
    this.toastTimer = window.setTimeout(() => this.nextToast(), 5_200);
  }

  private updateCard(city: CityState, p: CityProgress, meta: SimMeta): void {
    const event = p.event;
    const def = event ? eventDef(event.id) : null;
    if (!event || !def || this.chosen === `${event.id}:${event.at}`) {
      if (!this.card.hidden) this.card.hidden = true;
      this.cardKey = "";
      return;
    }
    const left = Math.max(0, event.until - city.tick);
    const key = `${event.id}:${event.at}:${def.options.map((o) => (meta.funds >= o.cost ? 1 : 0)).join("")}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      const last = def.options.length - 1;
      this.card.innerHTML = `<div class="event-head"><small>Ereignis · Entscheidung</small><strong>${esc(def.title)}</strong></div><p class="event-text">${esc(def.text)}</p><div class="event-options">${def.options
        .map((option, index) => {
          const poor = option.cost > meta.funds;
          const cost = option.cost > 0 ? money(option.cost) : "kostenlos";
          return `<button type="button" data-option="${index}" ${poor ? "disabled" : ""}><span><b>${esc(option.label)}</b><em>${esc(cost)}</em></span><small>${esc(poor ? `Zu wenig Geld. ${option.hint}` : option.hint)}</small></button>`;
        })
        .join("")}</div><div class="event-timer"><i></i></div><p class="event-foot">Ohne Entscheidung gilt „${esc(def.options[last].label)}“.</p>`;
    }
    const bar = this.card.querySelector<HTMLElement>(".event-timer i");
    if (bar) bar.style.transform = `scaleX(${(left / EVENT_TIMEOUT).toFixed(3)})`;
    if (this.card.hidden) {
      this.card.hidden = false;
      this.card.classList.remove("in");
      void this.card.offsetWidth;
      this.card.classList.add("in");
    }
  }

  private updateLocks(city: CityState): void {
    const locks: Partial<Record<LandmarkTool, string | null>> = {};
    for (const mark of LANDMARKS) locks[TOOL_BY_KEY[mark.key]] = landmarkBlock(city, mark.kind);
    const key = JSON.stringify(locks);
    if (key === this.lockKey) return;
    this.lockKey = key;
    this.hooks.locks(locks);
  }

  private render(force: boolean): void {
    const city = this.city;
    const p = city?.progress;
    if (!city || !p || (!force && !this.open)) return;
    this.lastRender = performance.now();
    const m = cityMetrics(city);
    const rank = RANKS[p.rank];
    const next = RANKS[p.rank + 1];
    const pct = next ? Math.max(0, Math.min(1, (m.population - rank.at) / (next.at - rank.at))) : 1;
    const boost = incomeBoost(city);
    const effects = p.effects.filter((effect) => effect.until > city.tick);
    const achCount = ACHIEVEMENTS.filter((ach) => p.ach & ach.bit).length;

    const rankHtml = `<section class="life-rank"><div class="life-rank-top"><span class="life-rank-step">Rang ${p.rank + 1}/${RANKS.length}</span><h2>${esc(rank.name)}</h2></div><div class="life-bar"><i style="transform:scaleX(${pct.toFixed(3)})"></i></div><p>${
      next
        ? `${m.population.toLocaleString("de-DE")} / ${next.at.toLocaleString("de-DE")} Einwohner bis <b>${esc(next.name)}</b> · Belohnung ${money(next.reward)}<br><span class="life-perk">Dann: ${esc(next.perk)}</span>`
        : `${m.population.toLocaleString("de-DE")} Einwohner – höchster Rang erreicht.`
    }</p></section>`;

    const moodLines = [
      `<li><span>Ø Zufriedenheit</span><b>${Math.round(p.stats.mood)} %</b></li>`,
      `<li><span>Sehr glückliche Haushalte</span><b>${p.stats.happy}</b></li>`,
      ...boost.lines.map((line) => `<li class="good"><span>${esc(line.label)}</span><b>${esc(line.value)}</b></li>`),
      ...effects.map((effect) => {
        const bad = effect.mood < 0 || effect.mult < 1;
        return `<li class="${bad ? "bad" : "good"}"><span>${esc(EFFECT_LABEL[effect.id] ?? effect.id)}</span><b>${hoursLeft(effect.until - city.tick)}</b></li>`;
      }),
    ].join("");
    const moodHtml = `<section><h3>Stimmung & Boni</h3><ul class="life-list">${moodLines}</ul><p class="life-hint">Strand, Parks, Wahrzeichen und Feste machen glücklich. Ab 70 % Zufriedenheit gibt es Steuerbonus.</p></section>`;

    let challengeHtml: string;
    if (p.challenge) {
      const c = p.challenge;
      const done = c.done ? c.target : challengeProgress(c, m, p);
      challengeHtml = `<section class="life-challenge${c.done ? " done" : ""}"><h3>Tagesaufgabe · Tag ${c.day + 1}</h3><p>${esc(challengeText(c))}</p><div class="life-bar small"><i style="transform:scaleX(${(done / c.target).toFixed(3)})"></i></div><p class="life-meta">${c.done ? "Geschafft! Morgen gibt’s eine neue." : `${done.toLocaleString("de-DE")} / ${c.target.toLocaleString("de-DE")} · Belohnung ${money(c.reward)}`}</p></section>`;
    } else {
      challengeHtml = `<section class="life-challenge"><h3>Tagesaufgabe</h3><p class="life-meta">Ab Rang Siedlung (${RANKS[1].at} Einwohner) gibt es jeden Spieltag eine neue Aufgabe mit Belohnung.</p></section>`;
    }

    const marks = LANDMARKS.map((mark) => {
      const tool = TOOL_BY_KEY[mark.key];
      const built = city.services.includes(mark.kind);
      const block = landmarkBlock(city, mark.kind);
      const status = built
        ? `<span class="tag ok">Gebaut</span>`
        : p.rank < mark.rank
          ? `<span class="tag lock">ab ${esc(RANKS[mark.rank].name)}</span>`
          : `<button type="button" class="tag go" data-build="${tool}">Bauen</button>`;
      return `<li class="${built ? "built" : block ? "locked" : "ready"}"><div><b>${esc(mark.name)}</b><small>${esc(mark.text)}</small></div>${status}</li>`;
    }).join("");
    const marksHtml = `<section><h3>Wahrzeichen</h3><ul class="life-marks">${marks}</ul></section>`;

    const achHtml = `<section><h3>Erfolge <span class="life-count">${achCount}/${ACHIEVEMENTS.length}</span></h3><ul class="life-ach">${ACHIEVEMENTS.map((ach) => {
      const got = Boolean(p.ach & ach.bit);
      return `<li class="${got ? "got" : ""}" title="${esc(`${ach.title}: ${ach.text}${ach.reward ? ` (+${money(ach.reward)})` : ""}`)}"><span class="medal" aria-hidden="true">${got ? "★" : "☆"}</span><b>${esc(ach.title)}</b><small>${esc(ach.text)}</small></li>`;
    }).join("")}</ul></section>`;

    const feedHtml = `<section><h3>Bürger-Feed</h3>${
      this.feed.length
        ? `<ul class="life-feed">${this.feed
            .slice(0, 12)
            .map((line) => `<li data-tone="${line.tone}"><b>${esc(line.who)}</b><span>${esc(line.text)}</span></li>`)
            .join("")}</ul>`
        : `<p class="life-meta">Noch ist es still. Sobald Leute einziehen, erzählen sie, was sie bewegt.</p>`
    }</section>`;

    const scroll = this.body.scrollTop;
    this.body.innerHTML = rankHtml + challengeHtml + moodHtml + marksHtml + achHtml + feedHtml;
    this.body.scrollTop = scroll;
  }
}
