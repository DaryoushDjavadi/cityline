/**
 * Zoo UI: habitat panel, animal card (genes, family tree, care, rename), animal shop with
 * origin choice and the habitat build mode ("Bauen": furniture palette, turn, remove). Everything
 * happens in the Tierpark scene itself (no separate interior view): the panel drives the park
 * through a small ZooPark bridge (camera flight, grid, preview, selection, care reactions).
 * Pure view over city.progress.zoo; every change goes through the "zoo" command
 * (server-authoritative in coop).
 */
import {
  clashWith,
  BUY_ORIGINS,
  GENE_RANGE,
  HABITAT_INFO,
  HABITAT_SPACE,
  HAND_FEED_COST,
  ITEM_INFO,
  ITEM_KINDS,
  KEEPER_FEE,
  MAX_ITEMS,
  TURNABLE_ITEMS,
  NAME_MAX,
  ORIGIN_INFO,
  PET_COOLDOWN,
  REFILL_FOOD_COST,
  REFILL_WATER_COST,
  SPECIES,
  VET_COOLDOWN,
  VET_COST,
  animalsIn,
  cleanAnimalName,
  familyLabel,
  habitatAt,
  isAdult,
  priceOf,
  spaceUsed,
  speciesInfo,
  storyText,
  type Animal,
  type CareAct,
  type CityState,
  type Habitat,
  type ItemKind,
  type OriginId,
  type ZooOp,
  type ZooState,
} from "../../../shared/src/index.ts";
import type { Cue } from "../audio/sfx.ts";

export interface ZooHooks {
  command: (op: ZooOp) => void;
  sound: (cue: Cue) => void;
  flash: (text: string) => void;
  /** Close other panels when the zoo panel opens. */
  opened: () => void;
  closed: () => void;
}

/** Build-mode tool: a furniture kind to place, "remove", or null (just look). */
export type BuildTool = ItemKind | "remove" | null;
export interface BuildState {
  cell: number;
  tool: BuildTool;
  rot: number;
}

/** What the habitat panel needs from the Tierpark scene. */
export interface ZooPark {
  /** Camera flies to the habitat (or to an animal in it). */
  focusHabitat(cell: number): void;
  focusAnimal(id: number): void;
  /** Build mode on (grid, dimmed park, preview) or off. */
  setBuild(state: BuildState | null): void;
  /** Selected animal (ring, stands still), −1 = none. */
  select(id: number): void;
  /** Hearts / stars at the animal. */
  react(id: number, kind: CareAct): void;
  /** The panel changed size (keep the habitat centred beside it). */
  layout(): void;
  /** Screen position of an animal (name tags), or null. */
  animalScreen(id: number): { x: number; y: number } | null;
}

export const SPECIES_ICON: Record<string, string> = {
  lion: "🦁", elephant: "🐘", giraffe: "🦒", zebra: "🦓", kangaroo: "🦘", bear: "🐻", monkey: "🐒", redpanda: "🦊",
  wolf: "🐺", seal: "🦭", flamingo: "🦩", otter: "🦦", penguin: "🐧", polarbear: "🐻‍❄️", rabbit: "🐇", goat: "🐐", alpaca: "🦙",
};
export const ITEM_ICON: Record<ItemKind, string> = { food: "🥣", water: "💧", toy: "⚽", shelter: "🛖", plant: "🌿", rock: "🪨", tree: "🌳", pool: "🫧", hay: "🌾" };
const ORIGIN_ICON: Record<OriginId, string> = { circus: "🎪", rescue: "🩹", breeder: "🏅", wild: "🌍", born: "🍼" };
const CARE: { act: CareAct; label: string; icon: string }[] = [
  { act: "pet", label: "Streicheln", icon: "🤚" },
  { act: "play", label: "Spielen", icon: "⚽" },
  { act: "feed", label: `Füttern · ${HAND_FEED_COST} €`, icon: "🥕" },
  { act: "vet", label: `Tierarzt · ${VET_COST} €`, icon: "🩺" },
];

const euro = new Intl.NumberFormat("de-DE");
/** Only touch the DOM when the markup changed (keeps hover/focus and avoids detached buttons). */
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bar(label: string, value: number, tone = ""): string {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return `<div class="zoo-bar ${tone}"><span>${label}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`;
}

function geneWord(key: string, value: number): string {
  if (key === "hue") return value < -0.33 ? "kühl & hell" : value > 0.33 ? "warm & kräftig" : "klassisch";
  if (key === "size") return value < 0.93 ? "zierlich" : value > 1.07 ? "groß" : "mittel";
  if (key === "pattern") return value < 0.33 ? "zart" : value > 0.66 ? "kräftig" : "deutlich";
  if (key === "robust") return value < 0.33 ? "empfindlich" : value > 0.66 ? "robust" : "normal";
  return value < 0.33 ? "scheu" : value > 0.66 ? "verspielt" : "ausgeglichen";
}
const GENE_LABEL: Record<string, string> = { hue: "Fellton", size: "Größe", pattern: "Muster", robust: "Robustheit", temper: "Temperament" };


export class ZooView {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly tags: HTMLElement;
  private city: CityState | null = null;
  private cell = -1;
  private animal = -1;
  private shopSpecies: string | null = null;
  private shopOrigin: Exclude<OriginId, "born"> = "breeder";
  private building = false;
  private tool: BuildTool = null;
  private rot = 0;
  private releaseArm = -1;
  private readonly seenReact = new Map<number, number>();
  /** Tierpark scene bridge (null while the park is closed). */
  private parkBridge: ZooPark | null = null;

  constructor(private readonly hooks: ZooHooks) {
    this.panel = document.createElement("aside");
    this.panel.id = "zoo-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Tiergehege");
    this.panel.innerHTML = `<div class="panel-head"><p class="eyebrow" id="zoo-kicker">Tiergehege</p><button id="zoo-close" type="button" aria-label="Schließen">×</button></div><div id="zoo-body"></div>`;
    this.body = this.panel.querySelector("#zoo-body") as HTMLElement;
    (this.panel.querySelector("#zoo-close") as HTMLButtonElement).addEventListener("click", () => this.hide());
    this.panel.addEventListener("click", (event) => this.onAction(event));
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.target as HTMLElement).id === "zoo-name") this.rename();
    });

    this.shop = document.createElement("section");
    this.shop.id = "zoo-shop";
    this.shop.hidden = true;
    this.shop.setAttribute("role", "dialog");
    this.shop.setAttribute("aria-label", "Tiere aufnehmen");
    this.shop.addEventListener("click", (event) => this.onAction(event));

    // Name tags over the animals of the open habitat (inside the park view).
    this.tags = document.createElement("div");
    this.tags.id = "zoo-tags";
    document.body.append(this.panel, this.shop, this.tags);
    window.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      if (this.building && (event.code === "KeyR" || event.key === "r" || event.key === "R")) {
        this.turn();
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }
      if (event.key !== "Escape") return;
      // One step per press: shop → tool → build mode → animal card; the park handles the rest.
      if (!this.shop.hidden) this.closeShop();
      else if (this.building && this.tool) this.setTool(null);
      else if (this.building) this.setBuilding(false);
      else if (!this.panel.hidden && this.animal >= 0) this.selectAnimal(-1);
      else return;
      event.stopImmediatePropagation();
      event.preventDefault();
    });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  get habitatCell(): number {
    return this.cell;
  }

  get buildMode(): BuildState | null {
    return this.building && this.cell >= 0 ? { cell: this.cell, tool: this.tool, rot: this.rot } : null;
  }

  /** Connect the Tierpark scene (or disconnect with null when the park closes). */
  set park(bridge: ZooPark | null) {
    this.parkBridge = bridge;
    // Do not replay old reactions when the park opens.
    for (const animal of this.zoo()?.animals ?? []) this.seenReact.set(animal.id, animal.react?.tick ?? -1);
    if (!bridge) {
      this.tags.replaceChildren();
      this.tags.dataset.key = "";
    }
  }

  private zoo(): ZooState | null {
    return this.city?.progress?.zoo ?? null;
  }

  private habitat(): Habitat | null {
    const zoo = this.zoo();
    return zoo && this.cell >= 0 ? habitatAt(zoo, this.cell) : null;
  }

  /** Habitat clicked in the park: camera flies there, panel opens. */
  showHabitat(city: CityState, cell: number): void {
    this.city = city;
    if (this.cell !== cell) {
      if (this.building) this.setBuilding(false);
      this.selectAnimal(-1, false);
    }
    this.cell = cell;
    this.panel.hidden = false;
    document.body.dataset.zoo = "on";
    this.hooks.opened();
    this.render();
    this.parkBridge?.focusHabitat(cell);
    this.parkBridge?.layout();
  }

  /** Animal clicked in the park: its card in the panel, the camera comes closer. */
  showAnimal(city: CityState, id: number): void {
    const animal = city.progress?.zoo?.animals.find((entry) => entry.id === id);
    if (!animal || animal.cell < 0) return;
    this.city = city;
    if (this.cell !== animal.cell && this.building) this.setBuilding(false);
    this.cell = animal.cell;
    this.panel.hidden = false;
    document.body.dataset.zoo = "on";
    this.hooks.opened();
    this.selectAnimal(id);
    this.parkBridge?.focusAnimal(id);
    this.parkBridge?.layout();
  }

  hide(): void {
    if (this.panel.hidden) return;
    if (this.building) this.setBuilding(false);
    this.closeShop();
    this.panel.hidden = true;
    document.body.dataset.zoo = "off";
    this.selectAnimal(-1, false);
    this.tags.replaceChildren();
    this.tags.dataset.key = "";
    this.hooks.closed();
    this.parkBridge?.layout();
  }

  update(city: CityState): void {
    this.city = city;
    if (this.cell >= 0 && !this.habitat() && city.progress?.zoo) {
      // habitat bulldozed
      this.closeShop();
      this.hide();
      this.cell = -1;
      return;
    }
    if (this.animal >= 0 && !city.progress?.zoo?.animals.some((entry) => entry.id === this.animal && entry.cell === this.cell)) this.selectAnimal(-1, false);
    if (!this.panel.hidden) this.render();
    if (!this.shop.hidden) this.renderShop();
    this.replayReactions();
    if (this.building) this.parkBridge?.setBuild(this.buildMode);
  }

  /** Care reactions (also from coop partners) play once at the animal in the park. */
  private replayReactions(): void {
    const zoo = this.zoo();
    if (!zoo) return;
    for (const animal of zoo.animals) {
      const seen = this.seenReact.get(animal.id);
      if (seen !== undefined && animal.react && animal.react.tick > seen) this.parkBridge?.react(animal.id, animal.react.kind);
      this.seenReact.set(animal.id, animal.react?.tick ?? seen ?? -1);
    }
  }

  private selectAnimal(id: number, render = true): void {
    this.animal = id;
    this.releaseArm = -1;
    this.parkBridge?.select(id);
    if (render && !this.panel.hidden) this.render();
  }

  // ------------------------------------------------------------ habitat panel

  private render(): void {
    const zoo = this.zoo();
    const habitat = this.habitat();
    const city = this.city;
    if (!city || !habitat) {
      setHtml(this.body, `<p class="zoo-empty">Das Gehege wird eingerichtet …</p>`);
      return;
    }
    if (this.panel.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === "INPUT") return;
    const info = HABITAT_INFO[habitat.type];
    this.panel.classList.toggle("building", this.building);
    (this.panel.querySelector("#zoo-kicker") as HTMLElement).textContent = this.building ? `${info.name} · Bau-Modus` : this.animal >= 0 ? `${info.name} · Tier` : "Tiergehege";
    if (this.building) {
      setHtml(this.body, this.buildPanel(habitat));
      return;
    }
    const animal = this.animal >= 0 ? zoo?.animals.find((entry) => entry.id === this.animal) : undefined;
    if (animal) {
      setHtml(this.body, `<button type="button" class="zoo-link" data-act="list">← ${esc(info.name)}</button>${this.animalCard(animal)}`);
      return;
    }
    this.animal = -1;
    const animals = zoo ? animalsIn(zoo, habitat.cell) : [];
    const food = habitat.items.filter((item) => item.kind === "food");
    const water = habitat.items.filter((item) => item.kind === "water");
    const pct = (list: { fill?: number }[]) => (list.length ? Math.round(list.reduce((sum, item) => sum + (item.fill ?? 0), 0) / list.length) : 0);
    const used = zoo ? spaceUsed(zoo, habitat.cell) : 0;
    const rows = animals.map((entry) => {
      const sp = speciesInfo(entry.species);
      const tags = [
        !isAdult(entry, city.tick) ? `<i class="tag young">Jungtier</i>` : "",
        entry.pregnantUntil ? `<i class="tag good">trächtig</i>` : "",
        entry.health < 40 ? `<i class="tag bad">krank</i>` : "",
        entry.trust < 30 ? `<i class="tag warn">scheu</i>` : "",
      ].join("");
      return `<button type="button" class="zoo-row" data-act="animal" data-id="${entry.id}"><span class="zoo-ico">${SPECIES_ICON[entry.species] ?? "🐾"}</span><span class="zoo-row-main"><b>${esc(entry.name)} <small>${entry.sex === "w" ? "♀" : "♂"} ${esc(sp?.name ?? "")}</small></b><span class="zoo-mini"><i style="--v:${entry.health}%" title="Gesundheit"></i><i style="--v:${entry.happy}%" title="Glück" class="happy"></i><i style="--v:${entry.trust}%" title="Vertrauen" class="trust"></i></span></span>${tags}</button>`;
    });
    setHtml(this.body, `
      <h2 class="zoo-title">${esc(info.name)}</h2>
      <p class="zoo-blurb">${esc(info.blurb)}</p>
      <div class="zoo-chips">
        <span class="zoo-chip"><small>Tiere</small><b>${animals.length} · Platz ${used}/${HABITAT_SPACE}</b></span>
        <span class="zoo-chip ${pct(food) < 25 ? "bad" : ""}"><small>Futter</small><b>${food.length ? `${pct(food)} %` : "kein Napf"}</b></span>
        <span class="zoo-chip ${pct(water) < 25 ? "bad" : ""}"><small>Wasser</small><b>${water.length ? `${pct(water)} %` : "kein Trog"}</b></span>
        <span class="zoo-chip"><small>Besucher</small><b>${zoo?.visitors ?? 0} · +${euro.format(Math.round(zoo?.income ?? 0))} €</b></span>
      </div>
      <div class="zoo-actions">
        <button type="button" class="zoo-primary" data-act="build" id="zoo-build" aria-pressed="false">🔨 Bauen</button>
        <button type="button" data-act="shop" id="zoo-open-shop">Tiere aufnehmen</button>
      </div>
      <div class="zoo-actions small">
        <button type="button" data-act="refill">Auffüllen · ${REFILL_FOOD_COST}/${REFILL_WATER_COST} €</button>
        <button type="button" data-act="keeper" aria-pressed="${habitat.keeper}" class="${habitat.keeper ? "on" : ""}">Pfleger ${habitat.keeper ? "an" : "aus"} · ${KEEPER_FEE} €/2 s</button>
      </div>
      <h3 class="zoo-h3">Bewohner</h3>
      ${rows.length ? `<div class="zoo-list">${rows.join("")}</div><p class="zoo-tip">Tipp: Tiere im Park direkt anklicken.</p>` : `<p class="zoo-empty">Noch leer. Nimm Tiere auf – Rettungstiere sind günstig, brauchen aber Pflege.</p>`}`);
  }

  /** Build mode: furniture palette, turn, remove, done. */
  private buildPanel(habitat: Habitat): string {
    const funds = this.city?.funds ?? 0;
    const full = habitat.items.length >= MAX_ITEMS;
    const palette = ITEM_KINDS.map((kind) => {
      const info = ITEM_INFO[kind];
      const poor = funds < info.cost;
      return `<button type="button" class="zb-item${this.tool === kind ? " on" : ""}${poor || full ? " poor" : ""}" data-act="tool" data-id="${kind}" title="${esc(info.blurb)}" aria-pressed="${this.tool === kind}"><span>${ITEM_ICON[kind]}</span><b>${esc(info.name)}</b><small>${info.cost} €</small></button>`;
    }).join("");
    const turnable = this.tool !== null && this.tool !== "remove" && TURNABLE_ITEMS.includes(this.tool);
    const hint = this.tool === "remove"
      ? "Tippe auf einen Gegenstand im Gehege, um ihn zu entfernen."
      : this.tool
        ? `${ITEM_INFO[this.tool].name}: auf ein freies Feld im Gehege setzen${turnable ? " · R oder ⟳ dreht" : ""}. Esc beendet.`
        : "Wähle einen Gegenstand und setze ihn direkt ins Gehege.";
    return `
      <p class="zb-hint" id="zb-hint">${hint}</p>
      <div class="zb-palette" role="toolbar" aria-label="Einrichtung">${palette}</div>
      <div class="zoo-actions zb-row">
        <button type="button" data-act="turn" id="zb-turn" ${turnable ? "" : "disabled"} title="Drehen (R)">⟳ Drehen</button>
        <button type="button" data-act="tool" data-id="remove" id="zb-remove" class="${this.tool === "remove" ? "on" : ""}" aria-pressed="${this.tool === "remove"}">✖ Entfernen</button>
        <button type="button" class="zoo-primary" data-act="build-done" id="zb-done">✓ Fertig</button>
      </div>
      <p class="zb-count">Einrichtung ${habitat.items.length}/${MAX_ITEMS} · Kasse ${euro.format(Math.floor(funds))} €</p>`;
  }

  setBuilding(on: boolean): void {
    if (on === this.building) return;
    if (on && !this.habitat()) return;
    this.building = on;
    this.tool = null;
    document.body.dataset.zooBuild = on ? "on" : "off";
    if (on) {
      this.closeShop();
      this.selectAnimal(-1, false);
      this.parkBridge?.focusHabitat(this.cell);
    }
    this.parkBridge?.setBuild(this.buildMode);
    this.hooks.sound("toggle");
    this.render();
    this.parkBridge?.layout();
  }

  private setTool(tool: BuildTool): void {
    this.tool = this.tool === tool ? null : tool;
    this.parkBridge?.setBuild(this.buildMode);
    this.render();
  }

  private turn(): void {
    this.rot = (this.rot + 1) % 4;
    this.parkBridge?.setBuild(this.buildMode);
    this.hooks.sound("click");
  }

  /** Click on a grid spot of the habitat in build mode (from the park). */
  buildAt(x: number, y: number): void {
    const habitat = this.habitat();
    if (!habitat || !this.building) return;
    if (this.tool === "remove") {
      const item = habitat.items.find((entry) => x >= entry.x && y >= entry.y && x < entry.x + (entry.kind === "pool" ? 2 : 1) && y < entry.y + (entry.kind === "pool" ? 2 : 1));
      if (!item) return;
      this.hooks.command({ op: "take", cell: habitat.cell, item: item.id });
      this.hooks.sound("demolish");
    } else if (this.tool) {
      this.hooks.command({ op: "place", cell: habitat.cell, item: this.tool, x, y, ...(this.rot ? { rot: this.rot } : {}) });
      this.hooks.sound("place");
    }
    this.render();
  }

  /** Animal card: status, story, genes, family tree, care, rename. */
  private animalCard(animal: Animal): string {
    const city = this.city!;
    const zoo = this.zoo()!;
    const sp = speciesInfo(animal.species);
    const byId = (id?: number) => (id === undefined ? undefined : zoo.animals.find((entry) => entry.id === id));
    const adult = isAdult(animal, city.tick);
    const family = familyLabel(animal);
    const parents = (animal.family ?? "").split("-&-");
    const father = byId(animal.father);
    const mother = byId(animal.mother);
    const node = (entry: Animal | undefined, fallback: string | undefined, role: string) =>
      entry
        ? `<button type="button" class="zt-node" data-act="animal" data-id="${entry.id}"><small>${role}</small><b>${esc(entry.name)}</b></button>`
        : fallback
          ? `<span class="zt-node gone"><small>${role}</small><b>${esc(fallback)}</b></span>`
          : `<span class="zt-node gone"><small>${role}</small><b>unbekannt</b></span>`;
    const grand = (parent: Animal | undefined) => parent && (parent.mother !== undefined || parent.father !== undefined)
      ? `<div class="zt-row grand">${node(byId(parent.father), parent.family?.split("-&-")[0], "Opa")}${node(byId(parent.mother), parent.family?.split("-&-")[1], "Oma")}</div>`
      : "";
    const children = zoo.animals.filter((entry) => entry.mother === animal.id || entry.father === animal.id);
    const petLeft = animal.petAt !== undefined ? Math.max(0, animal.petAt + PET_COOLDOWN - city.tick) : 0;
    const vetLeft = animal.vetAt !== undefined ? Math.max(0, animal.vetAt + VET_COOLDOWN - city.tick) : 0;
    const hasToy = this.habitat()?.items.some((item) => item.kind === "toy") ?? false;
    const care = CARE.map(({ act, label, icon }) => {
      const wait = act === "vet" ? vetLeft : petLeft;
      const blocked = wait > 0 || (act === "play" && !hasToy);
      const why = wait > 0 ? `noch ${Math.ceil(wait / 2)} s` : act === "play" && !hasToy ? "braucht Spielzeug" : "";
      return `<button type="button" class="zoo-care" data-act="care" data-care="${act}" ${blocked ? "disabled" : ""} title="${why}"><span>${icon}</span>${label}${why ? `<small>${why}</small>` : ""}</button>`;
    }).join("");
    const genes = (Object.keys(GENE_RANGE) as (keyof typeof GENE_RANGE)[]).map((key) => {
      const [min, max] = GENE_RANGE[key];
      const value = animal.genes[key];
      const pctV = ((value - min) / (max - min)) * 100;
      const marks = [father, mother].filter(Boolean).map((parent) => `<u style="left:${(((parent!.genes[key] - min) / (max - min)) * 100).toFixed(1)}%" title="${esc(parent!.name)}"></u>`).join("");
      return `<div class="zoo-gene"><span>${GENE_LABEL[key]}</span><i>${marks}<b style="left:${pctV.toFixed(1)}%"></b></i><em>${geneWord(key, value)}</em></div>`;
    }).join("");
    const status = [
      !adult ? `<i class="tag young">Jungtier · wächst</i>` : "",
      animal.pregnantUntil ? `<i class="tag good">trächtig · noch ${Math.max(0, Math.ceil((animal.pregnantUntil - city.tick) / 2))} s</i>` : "",
      animal.nursed ? `<i class="tag good">aufgepäppelt</i>` : "",
      animal.cell < 0 ? `<i class="tag bad">wartet auf Gehege</i>` : "",
    ].join("");
    return `
      <article class="zoo-card" data-animal="${animal.id}">
        <header class="zoo-card-head">
          <span class="zoo-ico big">${SPECIES_ICON[animal.species] ?? "🐾"}</span>
          <div><h2 id="zoo-animal-name">${esc(animal.name)}</h2><p>${animal.sex === "w" ? "♀ weiblich" : "♂ männlich"} · ${esc(sp?.name ?? animal.species)} · ${animal.gen > 0 ? `${animal.gen}. Generation` : "Gründertier"}</p>${family ? `<p class="zoo-family">${esc(family)}</p>` : ""}</div>
        </header>
        <div class="zoo-tags">${status}</div>
        ${bar("Gesundheit", animal.health, animal.health < 40 ? "bad" : "")}
        ${bar("Glück", animal.happy, "happy")}
        ${bar("Vertrauen", animal.trust, "trust")}
        <div class="zoo-care-row">${care}</div>
        <p class="zoo-story"><b>${ORIGIN_ICON[animal.origin]} ${esc(ORIGIN_INFO[animal.origin].name)}:</b> ${esc(storyText(animal))}</p>
        <h3 class="zoo-h3">Gene</h3>
        <div class="zoo-genes">${genes}</div>
        <h3 class="zoo-h3">Stammbaum</h3>
        <div class="zoo-tree">
          ${grand(father)}${grand(mother)}
          ${animal.family || father || mother
            ? `<div class="zt-row">${node(father, parents[0] || undefined, "Vater")}${node(mother, parents[1] || undefined, "Mutter")}</div>`
            : `<div class="zt-row"><span class="zt-node gone"><small>Herkunft</small><b>${ORIGIN_ICON[animal.origin]} ${esc(ORIGIN_INFO[animal.origin].name)}</b></span></div>`}
          <div class="zt-row self"><span class="zt-node me"><small>${animal.lineage ? `Linie ${esc(animal.lineage)}` : "Gründer"}</small><b>${esc(animal.name)}</b></span></div>
          ${children.length ? `<div class="zt-row kids">${children.map((child) => node(child, undefined, isAdult(child, city.tick) ? "Kind" : "Jungtier")).join("")}</div>` : ""}
        </div>
        <h3 class="zoo-h3">Name</h3>
        <div class="zoo-rename"><input id="zoo-name" maxlength="${NAME_MAX + 4}" value="${esc(animal.name)}" aria-label="Neuer Name" autocomplete="off"><button type="button" data-act="rename">Umbenennen</button></div>
        <p class="zoo-name-error" id="zoo-name-error" hidden></p>
        <button type="button" class="zoo-release ${this.releaseArm === animal.id ? "armed" : ""}" data-act="release">${this.releaseArm === animal.id ? "Wirklich an ein Schutzprojekt abgeben?" : "An Schutzprojekt abgeben"}</button>
      </article>`;
  }

  private onAction(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const act = target.dataset.act;
    const habitat = this.habitat();
    if (act === "animal") {
      const id = Number(target.dataset.id);
      this.selectAnimal(id);
      this.parkBridge?.focusAnimal(id);
      this.hooks.sound("click");
    } else if (act === "list") this.selectAnimal(-1);
    else if (act === "build") this.setBuilding(!this.building);
    else if (act === "build-done") this.setBuilding(false);
    else if (act === "turn") this.turn();
    else if (act === "shop") this.openShop();
    else if (act === "shop-close") this.closeShop();
    else if (act === "refill" && habitat) {
      this.hooks.command({ op: "refill", cell: habitat.cell });
      this.hooks.sound("cash");
    } else if (act === "keeper" && habitat) {
      this.hooks.command({ op: "keeper", cell: habitat.cell, on: !habitat.keeper });
      this.hooks.sound("toggle");
    } else if (act === "care") {
      const care = target.dataset.care as CareAct;
      this.care(care);
    } else if (act === "rename") this.rename();
    else if (act === "release") {
      if (this.releaseArm !== this.animal) {
        this.releaseArm = this.animal;
      } else {
        this.hooks.command({ op: "release", animal: this.animal });
        this.selectAnimal(-1, false);
      }
      this.render();
    } else if (act === "species") {
      this.shopSpecies = target.dataset.id ?? null;
      this.renderShop();
    } else if (act === "origin") {
      this.shopOrigin = target.dataset.id as Exclude<OriginId, "born">;
      this.renderShop();
    } else if (act === "buy") this.buy();
    else if (act === "tool") {
      this.setTool((target.dataset.id as BuildTool) || null);
      this.hooks.sound("click");
    }
  }

  private care(act: CareAct): void {
    if (this.animal < 0) return;
    this.hooks.command({ op: "care", animal: this.animal, act });
    this.hooks.sound(act === "pet" ? "goal" : act === "play" ? "event" : act === "vet" ? "toggle" : "click");
    // Solo: the state is already updated; coop: the reaction comes back with the server state.
    this.replayReactions();
    this.render();
  }

  private rename(): void {
    const input = this.body.querySelector<HTMLInputElement>("#zoo-name");
    const error = this.body.querySelector<HTMLElement>("#zoo-name-error");
    if (!input || this.animal < 0) return;
    const clean = cleanAnimalName(input.value);
    if (!clean) {
      if (error) {
        error.hidden = false;
        error.textContent = `Name: 1–${NAME_MAX} Zeichen, nur Buchstaben, Ziffern, Leerzeichen und . ' - &.`;
      }
      this.hooks.sound("reject");
      return;
    }
    input.blur();
    this.hooks.command({ op: "rename", animal: this.animal, name: clean });
    this.hooks.sound("click");
    this.render();
  }

  // ------------------------------------------------------------ shop

  // ------------------------------------------------------------ shop

  openShop(): void {
    const habitat = this.habitat();
    if (!habitat) return;
    if (!this.shopSpecies || speciesInfo(this.shopSpecies)?.habitat !== habitat.type) this.shopSpecies = SPECIES.find((entry) => entry.habitat === habitat.type)?.id ?? null;
    this.shop.hidden = false;
    document.body.dataset.zooShop = "on";
    this.renderShop();
  }

  closeShop(): void {
    this.shop.hidden = true;
    document.body.dataset.zooShop = "off";
  }

  private renderShop(): void {
    const habitat = this.habitat();
    const zoo = this.zoo();
    const city = this.city;
    if (!habitat || !zoo || !city) return;
    const free = HABITAT_SPACE - spaceUsed(zoo, habitat.cell);
    const fits = SPECIES.filter((entry) => entry.habitat === habitat.type);
    const others = SPECIES.filter((entry) => entry.habitat !== habitat.type);
    const clash = (entry: (typeof SPECIES)[number]) => clashWith(zoo, habitat.cell, entry.id);
    const chosen = speciesInfo(this.shopSpecies ?? "") ?? fits.find((entry) => !clash(entry)) ?? fits[0];
    const card = (entry: (typeof SPECIES)[number], ok: boolean) => {
      const enemy = ok ? clash(entry) : null;
      const note = !ok ? esc(HABITAT_INFO[entry.habitat].name) : enemy ? `nicht mit ${esc(enemy.plural)}` : `ab ${euro.format(priceOf(entry, "rescue"))} € · Platz ${entry.space}${entry.predator ? " · Raubtier" : ""}`;
      return `<button type="button" class="shop-species ${entry.id === chosen.id ? "on" : ""} ${enemy ? "clash" : ""}" data-act="species" data-id="${entry.id}" ${ok ? "" : "disabled"} title="${!ok ? `braucht ${HABITAT_INFO[entry.habitat].name}` : enemy ? "Raubtiere leben nur mit Artgenossen" : ""}"><span class="zoo-ico">${SPECIES_ICON[entry.id]}</span><b>${esc(entry.name)}</b><small>${note}</small></button>`;
    };
    const origins = BUY_ORIGINS.map((origin) => {
      const info = ORIGIN_INFO[origin];
      const price = priceOf(chosen, origin);
      const start = origin === "breeder" ? "gesund" : origin === "wild" ? "gesund, scheu" : origin === "circus" ? "erschöpft, ängstlich" : "krank, misstrauisch";
      return `<button type="button" class="shop-origin ${origin === this.shopOrigin ? "on" : ""}" data-act="origin" data-id="${origin}"><span class="zoo-ico">${ORIGIN_ICON[origin]}</span><span><b>${esc(info.name)}</b><small>${esc(info.blurb)}</small><em>Start: ${start} · Gesundheit ${info.health}</em></span><strong>${euro.format(price)} €</strong></button>`;
    }).join("");
    const price = priceOf(chosen, this.shopOrigin);
    const enemy = clash(chosen);
    const blocked = enemy
      ? `${chosen.predator ? `${esc(chosen.plural)} sind Raubtiere` : `${esc(enemy.plural)} sind Raubtiere`} – sie leben nur mit Artgenossen. Bau ein eigenes Gehege.`
      : chosen.space > free ? "Kein Platz mehr im Gehege." : city.funds < price ? "Dafür reicht das Geld nicht." : "";
    setHtml(this.shop, `
      <div class="shop-card">
        <header><div><small>Tiere aufnehmen</small><h2>${esc(HABITAT_INFO[habitat.type].name)} · Platz ${free} frei</h2></div><button type="button" class="shop-x" data-act="shop-close" aria-label="Schließen">×</button></header>
        <div class="shop-grid">${fits.map((entry) => card(entry, true)).join("")}</div>
        <details class="shop-more"><summary>Andere Arten (brauchen ein anderes Gehege)</summary><div class="shop-grid">${others.map((entry) => card(entry, false)).join("")}</div></details>
        <h3>Herkunft von ${esc(chosen.name)}</h3>
        <div class="shop-origins">${origins}</div>
        <div class="shop-foot"><p>${blocked || `${esc(chosen.name)} aus „${esc(ORIGIN_INFO[this.shopOrigin].name)}“. Bekommt einen Namen und eine eigene Geschichte.`}</p><button type="button" class="zoo-primary" data-act="buy" id="shop-buy" ${blocked ? "disabled" : ""}>Aufnehmen · ${euro.format(price)} €</button></div>
      </div>`);
  }

  private buy(): void {
    const habitat = this.habitat();
    const zoo = this.zoo();
    if (!habitat || !zoo || !this.shopSpecies) return;
    const before = zoo.seq;
    this.hooks.command({ op: "buy", cell: habitat.cell, species: this.shopSpecies, origin: this.shopOrigin });
    const fresh = this.zoo()?.animals.find((entry) => entry.id >= before && entry.cell === habitat.cell && entry.species === this.shopSpecies);
    if (fresh) {
      this.hooks.sound("cash");
      this.hooks.flash(`${SPECIES_ICON[fresh.species] ?? ""} ${fresh.name} ist eingezogen. ${storyText(fresh)}`);
      this.closeShop();
      this.selectAnimal(fresh.id);
      this.parkBridge?.focusAnimal(fresh.id);
    } else this.renderShop();
  }

  // ------------------------------------------------------------ in the park

  /** Every park frame: name tags over the animals of the open habitat. */
  frame(): void {
    const park = this.parkBridge;
    const zoo = this.zoo();
    if (!park || !zoo || this.panel.hidden || this.cell < 0) {
      if (this.tags.childElementCount) {
        this.tags.replaceChildren();
        this.tags.dataset.key = "";
      }
      return;
    }
    const animals = this.building ? [] : animalsIn(zoo, this.cell);
    const key = animals.map((entry) => `${entry.id}:${entry.name}:${entry.id === this.animal ? 1 : 0}:${entry.health < 40 ? 1 : 0}:${entry.pregnantUntil ? 1 : 0}`).join("|");
    if (this.tags.dataset.key !== key) {
      this.tags.dataset.key = key;
      this.tags.innerHTML = animals.map((entry) => `<span class="zi-tag ${entry.id === this.animal ? "on" : ""}" data-tag="${entry.id}">${esc(entry.name)}${entry.health < 40 ? " 🤒" : ""}${entry.pregnantUntil ? " 🍼" : ""}</span>`).join("");
    }
    for (const tag of this.tags.children as HTMLCollectionOf<HTMLElement>) {
      const at = park.animalScreen(Number(tag.dataset.tag));
      tag.hidden = !at;
      if (at) tag.style.transform = `translate(${at.x.toFixed(0)}px, ${(at.y - 18).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  // ------------------------------------------------------------ e2e helpers

  e2e() {
    return {
      selected: () => this.animal,
      select: (id: number) => {
        if (this.city) this.showAnimal(this.city, id);
        return this.animal === id;
      },
      build: () => this.buildMode,
      setBuilding: (on: boolean) => this.setBuilding(on),
      setTool: (tool: BuildTool) => {
        this.tool = null;
        this.setTool(tool);
      },
      buildAt: (x: number, y: number) => this.buildAt(x, y),
      turn: () => this.turn(),
    };
  }
}
