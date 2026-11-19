/**
 * Auftragstafel (Hay-Day-style delivery board). Pure view over city.progress.orders;
 * every change goes through the "order" command (server-authoritative in coop).
 */
import {
  GOOD_INFO,
  ORDERS_UNLOCK_POP,
  ORDER_CUSTOMERS,
  ORDER_SKIP_WAIT,
  availableGoods,
  canDeliver,
  isExpress,
  orderPayout,
  orderProducers,
  orderTimeLeft,
  stockOf,
  type CityState,
  type DeliveryOrder,
  type OrderBoard as Board,
  type OrderGood,
} from "../../../shared/src/index.ts";
import type { Cue } from "../audio/sfx.ts";

export interface OrderBoardHooks {
  order: (slot: number, id: number, action: "deliver" | "skip") => void;
  sound: (cue: Cue) => void;
  opened: () => void;
}

const euro = new Intl.NumberFormat("de-DE");
const SOURCE: Record<OrderGood, string> = {
  food: "aus Bauernhöfen & Import",
  goods: "aus Industrie mit Strom",
  fish: "aus dem Hafen",
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class OrderBoardView {
  private readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;
  private city: CityState | null = null;
  private shape = "";
  private lastDoneSeen = -1;
  private enabled = false;
  private readonly pending = new Set<number>();

  constructor(private readonly hooks: OrderBoardHooks) {
    this.button = document.createElement("button");
    this.button.id = "open-orders";
    this.button.type = "button";
    this.button.className = "hud-btn";
    this.button.hidden = true;
    this.button.setAttribute("aria-pressed", "false");
    this.button.setAttribute("aria-label", "Auftragstafel");
    this.button.title = "Auftragstafel: Lieferaufträge mit Belohnung (Taste J)";
    this.button.innerHTML = `<svg class="hud-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="16" rx="2"/><path d="M9 4.5V3.5h6v1M8 10h8M8 14h8M8 18h5"/></svg><span class="hud-text">Tafel</span><span id="orders-dot" hidden>0</span>`;
    this.badge = this.button.querySelector("#orders-dot") as HTMLElement;
    const actions = document.querySelector(".top-actions");
    const sound = document.getElementById("toggle-sound");
    if (actions) actions.insertBefore(this.button, sound ?? actions.firstChild);
    this.button.addEventListener("click", () => this.toggle());

    this.panel = document.createElement("aside");
    this.panel.id = "orders";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Auftragstafel");
    this.panel.innerHTML = `<div class="panel-head"><p class="eyebrow">Auftragstafel</p><button id="orders-close" type="button" aria-label="Schließen">×</button></div><div id="orders-body"></div>`;
    this.body = this.panel.querySelector("#orders-body") as HTMLElement;
    (this.panel.querySelector("#orders-close") as HTMLButtonElement).addEventListener("click", () => this.toggle(false));
    this.body.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
      if (!target || target.disabled) return;
      const slot = Number(target.dataset.slot);
      const id = Number(target.dataset.id);
      const action = target.dataset.act === "skip" ? "skip" : "deliver";
      if (action === "deliver") this.flyOut(slot);
      else this.hooks.sound("toggle");
      this.pending.add(id);
      this.hooks.order(slot, id, action);
    });
    document.body.appendChild(this.panel);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next && !this.enabled) return;
    this.open = next;
    this.panel.hidden = !next;
    document.body.dataset.orders = next ? "on" : "off";
    this.button.classList.toggle("active", next);
    this.button.setAttribute("aria-pressed", String(next));
    if (next) {
      this.hooks.opened();
      this.shape = "";
      this.render();
    }
  }

  reset(): void {
    this.lastDoneSeen = -1;
    this.shape = "";
    this.pending.clear();
  }

  update(city: CityState): void {
    this.city = city;
    const progress = city.progress;
    const enabled = Boolean(progress && !progress.off);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.button.hidden = !enabled;
      if (!enabled) this.toggle(false);
    }
    const board = progress?.orders;
    if (!enabled || !board) {
      this.badge.hidden = true;
      return;
    }
    // Deliveries (also by the coop partner) celebrate once on every client.
    const done = board.lastDone;
    if (done && this.lastDoneSeen >= 0 && done.tick !== this.lastDoneSeen) this.celebrate(done.reward, done.express, this.pending.has(done.id));
    this.lastDoneSeen = done?.tick ?? 0;
    if (done) this.pending.delete(done.id);

    let ready = 0;
    for (const order of board.slots) if (order && canDeliver(city, board, order)) ready += 1;
    this.badge.hidden = ready === 0;
    this.badge.textContent = String(ready);
    this.button.classList.toggle("has-ready", ready > 0);
    if (this.open) this.render();
  }

  private render(): void {
    const city = this.city;
    const board = city?.progress?.orders;
    if (!city || !board) {
      this.body.innerHTML = `<p class="orders-hint">Die Tafel wird gleich aufgehängt …</p>`;
      return;
    }
    const producers = orderProducers(city);
    const goods = availableGoods(city, producers);
    const locked = producers.population < ORDERS_UNLOCK_POP;
    const shape = `${locked ? 1 : 0}|${goods.join(",")}|${board.slots.map((order) => order?.id ?? "-").join(",")}`;
    if (shape !== this.shape) {
      this.shape = shape;
      this.body.innerHTML = this.markup(board, locked, goods);
    }
    this.refresh(city, board);
  }

  private markup(board: Board, locked: boolean, goods: OrderGood[]): string {
    const stock = (["food", "goods", "fish"] as OrderGood[])
      .map((good) => {
        const on = goods.includes(good);
        return `<span class="order-stock${on ? "" : " off"}" title="${GOOD_INFO[good].name} ${SOURCE[good]}"><i>${GOOD_INFO[good].icon}</i><b data-stock="${good}">0</b><small>${GOOD_INFO[good].name}</small></span>`;
      })
      .join("");
    if (locked) {
      return `<div class="order-stocks">${stock}</div><p class="orders-hint">Ab <b>${ORDERS_UNLOCK_POP} Einwohnern</b> hängen hier Lieferaufträge: Bäckereien, Märkte und Reedereien bestellen Nahrung, Waren und Fisch – gegen gutes Geld.</p>`;
    }
    const cards = board.slots
      .map((order, slot) => (order ? this.card(order, slot) : this.emptyCard(slot)))
      .join("");
    const help = goods.length === 0
      ? `<p class="orders-hint">Noch kann die Stadt nichts liefern. Baue <b>Industrie</b> (Waren), <b>Bauernhöfe</b> (Nahrung) oder einen <b>Hafen</b> (Fisch).</p>`
      : `<p class="orders-hint small">Schnell geliefert = <b>Express +30 %</b>. Ablehnen bringt nach ${Math.round(ORDER_SKIP_WAIT / 2 / 60)} Min. einen neuen Auftrag.</p>`;
    return `<div class="order-stocks">${stock}</div><div class="order-cards">${cards}</div>${help}<p class="orders-tally" data-tally></p>`;
  }

  private card(order: DeliveryOrder, slot: number): string {
    const customer = ORDER_CUSTOMERS[order.who] ?? ORDER_CUSTOMERS[0];
    const lines = order.lines
      .map((line) => `<li data-line="${line.good}"><i>${GOOD_INFO[line.good].icon}</i><span><b data-have="${line.good}">0</b> / ${line.amount} ${GOOD_INFO[line.good].name}</span><em class="tick" aria-hidden="true">✓</em></li>`)
      .join("");
    return `<article class="order-card${order.big ? " big" : ""}" data-slot="${slot}" data-order="${order.id}">
      <header><span class="order-who">${customer.name}</span>${order.big ? `<span class="order-tag">Großauftrag</span>` : ""}</header>
      <p class="order-quote">„${customer.line}“</p>
      <ul class="order-lines">${lines}</ul>
      <div class="order-timer"><span data-bar></span></div>
      <footer>
        <span class="order-reward"><b data-reward>+${euro.format(order.reward)} €</b><small data-express></small></span>
        <button type="button" class="order-skip" data-act="skip" data-slot="${slot}" data-id="${order.id}" title="Ablehnen" aria-label="Auftrag ablehnen">×</button>
        <button type="button" class="order-go" data-act="deliver" data-slot="${slot}" data-id="${order.id}">Liefern</button>
      </footer>
    </article>`;
  }

  private emptyCard(slot: number): string {
    return `<article class="order-card empty" data-slot="${slot}"><p>Neuer Auftrag in <b data-refill="${slot}">…</b></p></article>`;
  }

  /** Per-tick values without rebuilding the cards (keeps hover and focus). */
  private refresh(city: CityState, board: Board): void {
    for (const el of this.body.querySelectorAll<HTMLElement>("[data-stock]")) {
      el.textContent = euro.format(stockOf(city, board, el.dataset.stock as OrderGood));
    }
    for (const card of this.body.querySelectorAll<HTMLElement>(".order-card[data-order]")) {
      const slot = Number(card.dataset.slot);
      const order = board.slots[slot];
      if (!order) continue;
      let all = true;
      for (const line of order.lines) {
        const have = stockOf(city, board, line.good);
        const row = card.querySelector<HTMLElement>(`[data-line="${line.good}"]`);
        const ok = have >= line.amount;
        all &&= ok;
        row?.classList.toggle("ok", ok);
        const b = row?.querySelector<HTMLElement>("[data-have]");
        if (b) b.textContent = euro.format(Math.min(have, 9999));
      }
      const time = orderTimeLeft(order, city.tick);
      const bar = card.querySelector<HTMLElement>("[data-bar]");
      if (bar) {
        bar.style.width = `${Math.round(time.share * 100)}%`;
        bar.dataset.hurry = time.share < 0.2 ? "1" : "0";
      }
      const express = isExpress(order, city.tick);
      const payout = orderPayout(city, order);
      const reward = card.querySelector<HTMLElement>("[data-reward]");
      if (reward) reward.textContent = `+${euro.format(payout.reward)} €`;
      const tag = card.querySelector<HTMLElement>("[data-express]");
      if (tag) {
        const expressLeft = Math.max(0, Math.ceil((order.at + (order.until - order.at) * 0.4 - city.tick) / 2));
        tag.textContent = express ? `⚡ Express noch ${clock(expressLeft)}` : `noch ${clock(time.seconds)}`;
        tag.classList.toggle("express", express);
      }
      card.classList.toggle("ready", all);
      const go = card.querySelector<HTMLButtonElement>(".order-go");
      if (go) {
        go.disabled = !all || this.pending.has(order.id);
        go.title = all ? "Jetzt liefern" : "Es fehlt noch Ware";
      }
    }
    for (const el of this.body.querySelectorAll<HTMLElement>("[data-refill]")) {
      const slot = Number(el.dataset.refill);
      el.textContent = clock(Math.max(0, Math.ceil((board.refill[slot] - city.tick) / 2)));
    }
    const tally = this.body.querySelector<HTMLElement>("[data-tally]");
    if (tally) tally.textContent = board.done > 0 ? `Geliefert: ${board.done} · Verdient: ${euro.format(Math.round(board.earned))} €` : "";
  }

  /** The card lifts off as a stamped crate and flies to the cash counter. */
  private flyOut(slot: number): void {
    const card = this.body.querySelector<HTMLElement>(`.order-card[data-slot="${slot}"]`);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add("order-ghost");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.insertAdjacentHTML("beforeend", `<span class="order-stamp">Geliefert ✓</span>`);
    document.body.appendChild(ghost);
    window.setTimeout(() => ghost.remove(), 1300);
    const target = document.querySelector<HTMLElement>('[data-stat="funds"]') ?? this.button;
    const to = target.getBoundingClientRect();
    const crates = ["📦", "🥖", "🐟", "🪙", "🪙", "🪙"];
    crates.forEach((icon, index) => {
      const bit = document.createElement("span");
      bit.className = "order-fly";
      bit.textContent = icon;
      const sx = rect.left + rect.width * (0.25 + (index % 3) * 0.25);
      const sy = rect.top + rect.height * 0.55;
      bit.style.left = `${sx}px`;
      bit.style.top = `${sy}px`;
      document.body.appendChild(bit);
      const dx = to.left + to.width / 2 - sx;
      const dy = to.top + to.height / 2 - sy;
      bit.animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 70}px) scale(1.35)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.2 },
        ],
        { duration: 820 + index * 70, delay: index * 60, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "forwards" },
      ).onfinish = () => bit.remove();
    });
    this.hooks.sound("place");
  }

  private celebrate(reward: number, express: boolean, mine: boolean): void {
    // Own deliveries wait for the crates to land on the cash counter.
    if (mine) window.setTimeout(() => this.cashIn(reward, express, true), 760);
    else this.cashIn(reward, express, false);
  }

  private cashIn(reward: number, express: boolean, mine: boolean): void {
    this.hooks.sound(express ? "achievement" : "cash");
    if (!mine) this.hooks.sound("goal");
    const funds = document.querySelector<HTMLElement>('[data-stat="funds"]');
    funds?.classList.remove("cash-pop");
    void funds?.offsetWidth;
    funds?.classList.add("cash-pop");
    const anchor = (funds ?? this.button).getBoundingClientRect();
    const pop = document.createElement("span");
    pop.className = `order-pop${express ? " express" : ""}`;
    pop.textContent = `${express ? "⚡ " : ""}+${euro.format(reward)} €`;
    pop.style.left = `${anchor.left + anchor.width / 2}px`;
    pop.style.top = `${anchor.bottom + 6}px`;
    document.body.appendChild(pop);
    window.setTimeout(() => pop.remove(), 1800);
  }
}
