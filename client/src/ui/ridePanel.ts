/**
 * Tierpark side panel for roller coasters and stands (RCT style): coaster ratings, ride state,
 * ticket price, riders and revenue, "Mitfahren", the piece-by-piece track editor; for food,
 * drink and souvenir stands the price with sales and visitor feedback. Every change is a zoo
 * command, so coop partners see the same.
 */
import {
  DAY_TICKS,
  PARK_INFO,
  PIECE_INFO,
  PIECE_KINDS,
  PRICE_MAX,
  STANDS,
  ZOO_EVERY,
  blockGrid,
  closeHint,
  closeRoute,
  coasterLayout,
  parkReport,
  priceMood,
  rideFair,
  standPrice,
  tileAt,
  type CityState,
  type Coaster,
  type CrowdEvent,
  type PieceKind,
  type PriceMood,
  type StandKind,
  type ZooOp,
  type ZooState,
} from "../../../shared/src/index.ts";
import type { Cue } from "../audio/sfx.ts";

export interface RideHooks {
  command: (op: ZooOp) => void;
  sound: (cue: Cue) => void;
  /** Start the first-person ride; false when the train is not running. */
  ride: (id: number) => boolean;
  /** Panel opened/closed/resized (camera inset, other panels). */
  layout: (open: boolean) => void;
}

const PER_DAY = DAY_TICKS / ZOO_EVERY;
const euro = new Intl.NumberFormat("de-DE");
const euro2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const STAND_ICON: Record<StandKind, string> = { food: "🍟", drink: "🥤", souvenir: "🧸" };

export const MOOD_TEXT: Record<PriceMood, { icon: string; text: string }> = {
  cheap: { icon: "😀", text: "Günstig – mehr Käufer, die Besucher freuen sich." },
  fair: { icon: "🙂", text: "Fairer Preis – so verdient der Stand am meisten." },
  pricey: { icon: "😕", text: "Teuer – einige gehen lieber weiter." },
  rip: { icon: "😠", text: "Zu teuer! Kaum jemand kauft, die Laune im Park sinkt." },
};

export const PIECE_REASON: Record<string, string> = {
  coaster_path_low: "Über Wege erst ab Höhe 2",
  coaster_habitat: "Gehege im Weg",
  coaster_track: "Achterbahn im Weg",
  coaster_blocked: "Hier steht etwas",
  coaster_edge: "Parkrand",
  coaster_high: "Schon ganz oben",
  coaster_low: "Erst hochfahren",
  coaster_cross: "Strecke kreuzt sich",
  coaster_closed: "Rundkurs fertig",
};

function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function level(value: number): string {
  return value < 2 ? "sehr niedrig" : value < 4 ? "niedrig" : value < 6 ? "mittel" : value < 8 ? "hoch" : "sehr hoch";
}

export class RidePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private city: CityState | null = null;
  private coasterId = -1;
  private standTile = -1;
  editing = false;
  /** Piece shown in the preview (last hovered/used). */
  piece: PieceKind = "straight";
  private confirmDelete = false;
  /** Recent visitor reactions per stand tile / coaster id (timestamps in ms). */
  private readonly reactions = new Map<string, { at: number; refused: boolean; mood?: string }[]>();
  private routeCache: { key: string; route: PieceKind[] | null } = { key: "", route: null };

  constructor(private readonly hooks: RideHooks) {
    this.el = document.createElement("aside");
    this.el.id = "ride-panel";
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Achterbahn oder Stand");
    this.el.innerHTML = `<div class="panel-head"><p class="eyebrow" id="rp-eyebrow">Achterbahn</p><button type="button" class="pk-x" data-act="rp-close" aria-label="Schließen">×</button></div><div id="rp-body"></div>`;
    this.body = this.el.querySelector("#rp-body") as HTMLElement;
    this.el.addEventListener("click", (event) => this.onClick(event));
    this.el.addEventListener("pointerover", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-piece]");
      if (target && this.editing) this.piece = target.dataset.piece as PieceKind;
    });
    this.el.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.act !== "price-range") return;
      const label = this.el.querySelector(".rp-price b");
      if (label) label.textContent = `${input.value} €`;
    });
    this.el.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.act === "price-range") this.setPrice(Number(input.value));
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  get coaster(): number {
    return this.open ? this.coasterId : -1;
  }

  get stand(): number {
    return this.open ? this.standTile : -1;
  }

  private zoo(): ZooState | null {
    return this.city?.progress?.zoo ?? null;
  }

  private current(): Coaster | null {
    return this.zoo()?.coasters?.find((entry) => entry.id === this.coasterId) ?? null;
  }

  showCoaster(city: CityState, id: number, edit = false): void {
    this.city = city;
    this.coasterId = id;
    this.standTile = -1;
    this.editing = edit;
    this.confirmDelete = false;
    this.show();
  }

  showStand(city: CityState, tile: number): void {
    this.city = city;
    this.standTile = tile;
    this.coasterId = -1;
    this.editing = false;
    this.confirmDelete = false;
    this.show();
  }

  private show(): void {
    this.el.hidden = false;
    document.body.dataset.ridePanel = "on";
    this.render();
    this.hooks.layout(true);
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.editing = false;
    document.body.dataset.ridePanel = "off";
    this.hooks.layout(false);
  }

  setEditing(on: boolean): void {
    this.editing = on;
    this.render();
    this.hooks.layout(true);
  }

  update(city: CityState): void {
    this.city = city;
    if (!this.open) return;
    this.render();
  }

  /** Visitor reactions for the feedback lines (bought / too expensive / ride moods). */
  onCrowd(event: CrowdEvent): void {
    let key = "";
    let refused = false;
    let mood: string | undefined;
    if (event.type === "buy") {
      key = `s${event.tile}`;
      refused = !!event.refused;
    } else if (event.type === "ride") {
      key = `c${event.ride}`;
      refused = event.mood === "pricey";
      mood = event.mood;
    } else return;
    const now = performance.now();
    const list = this.reactions.get(key) ?? [];
    list.push({ at: now, refused, mood });
    while (list.length > 0 && now - list[0].at > 60_000) list.shift();
    if (list.length > 200) list.splice(0, list.length - 200);
    this.reactions.set(key, list);
  }

  private recent(key: string): { buys: number; refused: number; moods: Record<string, number> } {
    const now = performance.now();
    const list = (this.reactions.get(key) ?? []).filter((entry) => now - entry.at <= 60_000);
    const moods: Record<string, number> = {};
    for (const entry of list) if (entry.mood) moods[entry.mood] = (moods[entry.mood] ?? 0) + 1;
    return { buys: list.filter((entry) => !entry.refused).length, refused: list.filter((entry) => entry.refused).length, moods };
  }

  /** Close route for the editor (cached per track). */
  route(coaster: Coaster): PieceKind[] | null {
    const zoo = this.zoo();
    if (!zoo?.park) return null;
    const key = `${coaster.id}:${coaster.station}:${coaster.dir}:${coaster.pieces.join("")}:${zoo.park.tiles}:${zoo.habitats.map((h) => h.cell).join(".")}:${(zoo.coasters ?? []).map((c) => c.pieces.length).join(".")}`;
    if (this.routeCache.key !== key) {
      this.routeCache = { key, route: closeRoute(coaster, blockGrid(zoo.park, zoo.habitats, zoo.coasters ?? [], coaster.id)) };
    }
    return this.routeCache.route;
  }

  /** Whether a piece fits at the open end ("" = fits) – for buttons and the preview colour. */
  pieceProblem(coaster: Coaster, piece: PieceKind): string {
    const zoo = this.zoo();
    if (!zoo?.park) return "coaster_blocked";
    const grid = blockGrid(zoo.park, zoo.habitats, zoo.coasters ?? [], coaster.id);
    const layout = coasterLayout({ ...coaster, pieces: [...coaster.pieces, piece] }, grid);
    if (layout.valid > coaster.pieces.length) return (this.city?.funds ?? 0) < PIECE_INFO[piece].cost ? "funds" : "";
    return layout.error ?? "coaster_blocked";
  }

  render(): void {
    const zoo = this.zoo();
    if (!zoo) return this.hide();
    if (this.coasterId >= 0) {
      const coaster = this.current();
      if (!coaster) return this.hide();
      this.renderCoaster(zoo, coaster);
    } else if (this.standTile >= 0) {
      const kind = zoo.park ? STANDS.find((entry) => PARK_INFO[entry].code === tileAt(zoo.park!, this.standTile)) : undefined;
      if (!kind) return this.hide();
      this.renderStand(zoo, kind);
    }
  }

  private priceBlock(price: number, fair: number, label: string): string {
    const mood = priceMood(price, fair);
    return `
      <h3 class="zoo-h3">${label}</h3>
      <div class="rp-price">
        <button type="button" data-act="price" data-d="-1" aria-label="Billiger" ${price <= 0 ? "disabled" : ""}>−</button>
        <div><b>${price} €</b><small>fair ≈ ${fair} €</small></div>
        <button type="button" data-act="price" data-d="1" aria-label="Teurer" ${price >= PRICE_MAX ? "disabled" : ""}>+</button>
      </div>
      <input class="rp-range" type="range" min="0" max="${PRICE_MAX}" step="1" value="${price}" data-act="price-range" aria-label="${label}">
      <p class="rp-mood ${mood}"><span>${MOOD_TEXT[mood].icon}</span>${MOOD_TEXT[mood].text}</p>`;
  }

  private renderCoaster(zoo: ZooState, coaster: Coaster): void {
    (this.el.querySelector("#rp-eyebrow") as HTMLElement).textContent = "Achterbahn";
    this.el.classList.toggle("editing", this.editing);
    const layout = coasterLayout(coaster);
    const stats = coaster.stats;
    const report = parkReport(zoo);
    const live = report?.economy.rides.find((entry) => entry.id === coaster.id);
    const state = coaster.state;
    const bar = (label: string, value: number, cls: string) =>
      `<div class="zoo-bar rp-bar ${cls}"><span>${label}</span><i><b style="width:${Math.min(100, value * 10)}%"></b></i><em>${value.toFixed(1)}</em><small>${level(value)}</small></div>`;
    const ratings = stats
      ? `${bar("Aufregung", stats.excitement, "exc")}${bar("Intensität", stats.intensity, "int")}${bar("Übelkeit", stats.nausea, "nau")}
         <p class="rp-facts">🚀 ${stats.maxKmh} km/h · 📏 ${stats.length} m · ⛰️ ${euro2.format(stats.maxHeight)} m · ⏱️ ${euro2.format(stats.lapSec)} s${stats.loops ? ` · ➰ ${stats.loops}` : ""}${stats.drops ? ` · ⤵️ ${stats.drops}` : ""}</p>`
      : `<p class="zoo-empty rp-norate">${layout.closed ? "Noch keine Bewertung – starte eine Testfahrt." : "Erst den Rundkurs zur Station schließen, dann Testfahrt."}</p>`;
    const moods = this.recent(`c${coaster.id}`);
    const feedback = state === "open"
      ? `<p class="rp-feedback">Letzte Minute: ${moods.moods.thrilled ? `🤩 ${moods.moods.thrilled} ` : ""}${moods.moods.happy ? `😀 ${moods.moods.happy} ` : ""}${moods.moods.queasy ? `🤢 ${moods.moods.queasy} ` : ""}${moods.refused ? `💸 ${moods.refused}× „Zu teuer“` : ""}${moods.buys + moods.refused === 0 ? "noch keine Fahrgäste" : ""}</p>`
      : "";
    const stateBtn = (id: string, label: string, disabled: boolean, title = "") =>
      `<button type="button" data-act="state" data-state="${id}" class="${state === id ? "on" : ""}" ${disabled ? "disabled" : ""} ${title ? `title="${title}"` : ""}>${label}</button>`;
    let editor = "";
    if (this.editing) {
      const route = layout.closed ? [] : this.route(coaster);
      const routeCost = route ? route.reduce((sum, piece) => sum + PIECE_INFO[piece].cost, 0) : 0;
      const pieces = PIECE_KINDS.map((kind) => {
        const problem = layout.closed ? "coaster_closed" : this.pieceProblem(coaster, kind);
        const why = problem && problem !== "funds" ? PIECE_REASON[problem] ?? "Passt nicht" : problem === "funds" ? "Zu wenig Geld" : PIECE_INFO[kind].blurb;
        return `<button type="button" class="rp-piece${kind === this.piece ? " on" : ""}${problem ? " bad" : ""}" data-act="piece" data-piece="${kind}" title="${why}"><span>${PIECE_INFO[kind].icon}</span><b>${PIECE_INFO[kind].name}</b><small>${problem && problem !== "funds" ? why : `${euro.format(PIECE_INFO[kind].cost)} €`}</small></button>`;
      }).join("");
      const status = layout.closed
        ? `<p class="rp-status ok">✓ Rundkurs geschlossen (${coaster.pieces.length} Teile). Jetzt eine Testfahrt starten.</p>`
        : `<p class="rp-status">${closeHint(coaster)}${route ? "" : " <em>Automatisch schließen geht von hier nicht.</em>"}</p>`;
      editor = `
        <h3 class="zoo-h3">Strecke bauen</h3>
        <div class="rp-pieces">${pieces}</div>
        <div class="zoo-actions small rp-edit">
          <button type="button" data-act="undo" ${coaster.pieces.length ? "" : "disabled"}>↶ Rückgängig</button>
          <button type="button" data-act="close-track" ${!layout.closed && route && route.length ? "" : "disabled"}>🔁 Schließen${route && route.length ? ` · ${route.length} Teile · ${euro.format(routeCost)} €` : ""}</button>
          <button type="button" data-act="edit-done" class="zoo-primary">✓ Fertig</button>
        </div>
        ${status}`;
    }
    const running = state !== "closed";
    setHtml(this.body, `
      <h2 class="zoo-title">🎢 ${coaster.name}</h2>
      ${editor}
      <div class="rp-states">
        ${stateBtn("closed", "⛔ Geschlossen", false)}
        ${stateBtn("test", "🧪 Testfahrt", !layout.closed, layout.closed ? "Leerer Zug fährt eine Proberunde" : "Erst den Rundkurs schließen")}
        ${stateBtn("open", "✅ Geöffnet", !stats, stats ? "Besucher dürfen mitfahren" : "Erst eine Testfahrt")}
      </div>
      ${this.editing ? "" : `<h3 class="zoo-h3">Bewertung</h3>${ratings}`}
      ${this.editing ? "" : this.priceBlock(coaster.price, rideFair(stats?.excitement ?? 4), "Ticketpreis")}
      ${this.editing ? "" : `<div class="zoo-chips">
        <div class="zoo-chip"><small>Fahrgäste</small><b>${euro.format(Math.round(coaster.riders))}${live ? ` · ${euro.format(Math.round(live.riders * PER_DAY))}/Tag` : ""}</b></div>
        <div class="zoo-chip"><small>Einnahmen</small><b>${euro.format(Math.round(coaster.revenue))} €${live ? ` · ${euro.format(Math.round(live.revenue * PER_DAY))} €/Tag` : ""}</b></div>
      </div>${feedback}`}
      <div class="zoo-actions">
        <button type="button" class="zoo-primary" data-act="ride" ${running ? "" : "disabled"} title="${running ? "In der ersten Reihe mitfahren" : "Erst Testfahrt oder öffnen"}">🎥 Mitfahren</button>
        ${this.editing ? "" : `<button type="button" data-act="edit">✏️ Strecke</button>`}
      </div>
      ${this.editing ? "" : `<div class="zoo-actions small"><button type="button" data-act="delete" class="${this.confirmDelete ? "rp-danger" : ""}">${this.confirmDelete ? `Wirklich abreißen? (+${euro.format(Math.round((1500 + coaster.pieces.reduce((s, p) => s + PIECE_INFO[p].cost, 0)) / 2))} €)` : "🧹 Abreißen"}</button></div>`}`);
  }

  private renderStand(zoo: ZooState, kind: StandKind): void {
    (this.el.querySelector("#rp-eyebrow") as HTMLElement).textContent = "Stand";
    this.el.classList.remove("editing");
    const info = PARK_INFO[kind];
    const price = standPrice(zoo.prices, this.standTile, kind);
    const report = parkReport(zoo);
    const stat = report?.economy.stands.find((entry) => entry.tile === this.standTile);
    const reachable = !!report?.summary.spots[kind].some((spot) => spot.tile === this.standTile);
    const seen = this.recent(`s${this.standTile}`);
    setHtml(this.body, `
      <h2 class="zoo-title">${STAND_ICON[kind]} ${info.name}</h2>
      <p class="zoo-blurb">${info.blurb}</p>
      ${reachable ? "" : `<p class="rp-warn">Kein Weg daneben – Besucher kommen nicht hin.</p>`}
      <div class="zoo-chips">
        <div class="zoo-chip"><small>Kosten</small><b>${euro.format(info.cost)} € · ${euro.format(Math.round(info.upkeep * PER_DAY))} €/Tag</b></div>
        <div class="zoo-chip"><small>Preis</small><b>${price} € pro Kauf</b></div>
        <div class="zoo-chip"><small>Verkäufe</small><b>${euro.format(Math.round((stat?.customers ?? 0) * PER_DAY))} / Tag</b></div>
        <div class="zoo-chip"><small>Umsatz</small><b>${euro.format(Math.round((stat?.sales ?? 0) * PER_DAY))} € / Tag</b></div>
      </div>
      ${this.priceBlock(price, info.price, "Preis einstellen")}
      <p class="rp-feedback">Letzte Minute: 🛒 ${seen.buys} ${seen.buys === 1 ? "Kauf" : "Käufe"}${seen.refused ? ` · 💸 ${seen.refused}× „Zu teuer“` : ""}</p>`);
  }

  private setPrice(price: number): void {
    const value = Math.max(0, Math.min(PRICE_MAX, Math.round(price)));
    if (this.coasterId >= 0) this.hooks.command({ op: "cprice", coaster: this.coasterId, price: value });
    else if (this.standTile >= 0) this.hooks.command({ op: "sprice", tile: this.standTile, price: value });
    this.hooks.sound("click");
  }

  private onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const act = target.dataset.act;
    const zoo = this.zoo();
    const coaster = this.current();
    if (act !== "delete") this.confirmDelete = false;
    if (act === "rp-close") {
      this.hide();
      this.hooks.sound("click");
      return;
    }
    if (act === "price") {
      const d = Number(target.dataset.d ?? 0);
      const now = coaster ? coaster.price : zoo ? standPrice(zoo.prices, this.standTile, STANDS.find((k) => PARK_INFO[k].code === tileAt(zoo.park!, this.standTile)) ?? "food") : 0;
      this.setPrice(now + d);
      return;
    }
    if (!coaster) return;
    if (act === "state") {
      this.hooks.command({ op: "cstate", coaster: coaster.id, state: target.dataset.state as Coaster["state"] });
      this.hooks.sound(target.dataset.state === "closed" ? "click" : "toggle");
    } else if (act === "piece") {
      const piece = target.dataset.piece as PieceKind;
      this.piece = piece;
      this.hooks.command({ op: "cpiece", coaster: coaster.id, piece });
      this.hooks.sound("place");
    } else if (act === "undo") {
      this.hooks.command({ op: "cundo", coaster: coaster.id });
      this.hooks.sound("demolish");
    } else if (act === "close-track") {
      this.hooks.command({ op: "cclose", coaster: coaster.id });
      this.hooks.sound("place");
    } else if (act === "edit") {
      if (coaster.state !== "closed") this.hooks.command({ op: "cstate", coaster: coaster.id, state: "closed" });
      this.setEditing(true);
      this.hooks.sound("click");
      return;
    } else if (act === "edit-done") {
      this.setEditing(false);
      this.hooks.sound("click");
      return;
    } else if (act === "ride") {
      if (this.hooks.ride(coaster.id)) this.hooks.sound("toggle");
      return;
    } else if (act === "delete") {
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        this.render();
        return;
      }
      this.hooks.command({ op: "cdelete", coaster: coaster.id });
      this.hooks.sound("demolish");
      this.hide();
      return;
    }
    this.render();
  }
}
