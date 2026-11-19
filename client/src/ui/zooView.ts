/**
 * Zoo UI: habitat panel, animal card (genes, family tree, care, rename), animal shop with
 * origin choice, and the interior view. Pure view over city.progress.zoo; every change goes
 * through the "zoo" command (server-authoritative in coop).
 */
import {
  BUY_ORIGINS,
  GENE_RANGE,
  HABITAT_INFO,
  HABITAT_SPACE,
  HAND_FEED_COST,
  ITEM_INFO,
  ITEM_KINDS,
  KEEPER_FEE,
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
import { InteriorScene, type InteriorTool } from "./zooInterior.ts";
import { animalModel } from "../render/zooModels.ts";

export interface ZooHooks {
  command: (op: ZooOp) => void;
  sound: (cue: Cue) => void;
  flash: (text: string) => void;
  /** Close other panels when the zoo panel opens. */
  opened: () => void;
  closed: () => void;
  /** Interior view open/closed (pause the city renderer). */
  interior: (open: boolean) => void;
}

export const SPECIES_ICON: Record<string, string> = {
  lion: "🦁", elephant: "🐘", giraffe: "🦒", zebra: "🦓", kangaroo: "🦘", bear: "🐻", monkey: "🐒", redpanda: "🦊",
  wolf: "🐺", seal: "🦭", flamingo: "🦩", otter: "🦦", penguin: "🐧", polarbear: "🐻‍❄️", rabbit: "🐇", goat: "🐐", alpaca: "🦙",
};
const ITEM_ICON: Record<ItemKind, string> = { food: "🥣", water: "💧", toy: "⚽", shelter: "🛖", plant: "🌿", rock: "🪨" };
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
  private readonly overlay: HTMLElement;
  private readonly tags: HTMLElement;
  private readonly side: HTMLElement;
  private readonly topInfo: HTMLElement;
  private readonly tools: HTMLElement;
  private interior: InteriorScene | null = null;
  private city: CityState | null = null;
  private cell = -1;
  private animal = -1;
  private shopSpecies: string | null = null;
  private shopOrigin: Exclude<OriginId, "born"> = "breeder";
  private tool: InteriorTool = null;
  private releaseArm = -1;
  private readonly seenReact = new Map<number, number>();
  private noticeTimer = 0;

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

    this.overlay = document.createElement("section");
    this.overlay.id = "zoo-interior";
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <canvas id="zoo-canvas"></canvas>
      <div id="zoo-tags"></div>
      <header class="zi-top">
        <button type="button" class="zi-back" data-act="back">← Zur Stadt</button>
        <div class="zi-title"><small id="zi-kicker">Innenansicht</small><b id="zi-name"></b></div>
        <div class="zi-info" id="zi-info"></div>
      </header>
      <nav class="zi-tools" id="zi-tools" aria-label="Einrichtung"></nav>
      <aside class="zi-side" id="zi-side" hidden></aside>
      <p class="zi-hint" id="zi-hint"></p>`;
    this.overlay.addEventListener("click", (event) => this.onAction(event));
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.target as HTMLElement).id === "zoo-name") this.rename();
    });
    this.tags = this.overlay.querySelector("#zoo-tags") as HTMLElement;
    this.side = this.overlay.querySelector("#zi-side") as HTMLElement;
    this.topInfo = this.overlay.querySelector("#zi-info") as HTMLElement;
    this.tools = this.overlay.querySelector("#zi-tools") as HTMLElement;
    document.body.append(this.panel, this.overlay, this.shop);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!this.shop.hidden) this.closeShop();
      else if (this.tool) this.setTool(null);
      else if (this.interior) this.closeInterior();
    });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  get interiorOpen(): boolean {
    return this.interior !== null;
  }

  get habitatCell(): number {
    return this.cell;
  }

  private zoo(): ZooState | null {
    return this.city?.progress?.zoo ?? null;
  }

  private habitat(): Habitat | null {
    const zoo = this.zoo();
    return zoo && this.cell >= 0 ? habitatAt(zoo, this.cell) : null;
  }

  showHabitat(city: CityState, cell: number): void {
    this.city = city;
    if (this.cell !== cell) this.animal = -1;
    this.cell = cell;
    this.panel.hidden = false;
    document.body.dataset.zoo = "on";
    this.hooks.opened();
    this.render();
  }

  hide(): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    document.body.dataset.zoo = "off";
    this.animal = -1;
    this.hooks.closed();
  }

  update(city: CityState): void {
    this.city = city;
    if (this.cell >= 0 && !this.habitat() && city.progress?.zoo) {
      // habitat bulldozed
      this.closeInterior();
      this.closeShop();
      this.hide();
      this.cell = -1;
      return;
    }
    if (!this.panel.hidden) this.render();
    if (!this.shop.hidden) this.renderShop();
    if (this.interior) this.renderInterior();
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
    (this.panel.querySelector("#zoo-kicker") as HTMLElement).textContent = this.animal >= 0 ? `${info.name} · Tier` : "Tiergehege";
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
        <button type="button" class="zoo-primary" data-act="interior" id="zoo-open-interior">Innenansicht</button>
        <button type="button" data-act="shop" id="zoo-open-shop">Tiere aufnehmen</button>
      </div>
      <div class="zoo-actions small">
        <button type="button" data-act="refill">Auffüllen · ${REFILL_FOOD_COST}/${REFILL_WATER_COST} €</button>
        <button type="button" data-act="keeper" aria-pressed="${habitat.keeper}" class="${habitat.keeper ? "on" : ""}">Pfleger ${habitat.keeper ? "an" : "aus"} · ${KEEPER_FEE} €/2 s</button>
      </div>
      <h3 class="zoo-h3">Bewohner</h3>
      ${rows.length ? `<div class="zoo-list">${rows.join("")}</div>` : `<p class="zoo-empty">Noch leer. Nimm Tiere auf – Rettungstiere sind günstig, brauchen aber Pflege.</p>`}`);
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
      this.animal = Number(target.dataset.id);
      this.releaseArm = -1;
      if (this.interior) {
        this.interior.selected = this.animal;
        this.renderInterior();
      } else this.render();
      this.hooks.sound("click");
    } else if (act === "list") {
      this.animal = -1;
      this.render();
    } else if (act === "interior") this.openInterior();
    else if (act === "back") this.closeInterior();
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
        this.releaseArm = -1;
        this.animal = -1;
        if (this.interior) this.interior.selected = -1;
      }
      this.refreshAll();
    } else if (act === "species") {
      this.shopSpecies = target.dataset.id ?? null;
      this.renderShop();
    } else if (act === "origin") {
      this.shopOrigin = target.dataset.id as Exclude<OriginId, "born">;
      this.renderShop();
    } else if (act === "buy") this.buy();
    else if (act === "tool") this.setTool((target.dataset.id as InteriorTool) || null);
    else if (act === "deselect") {
      this.animal = -1;
      if (this.interior) this.interior.selected = -1;
      this.renderInterior();
    }
  }

  private refreshAll(): void {
    if (!this.panel.hidden) this.render();
    if (this.interior) this.renderInterior();
  }

  private care(act: CareAct): void {
    if (this.animal < 0) return;
    this.hooks.command({ op: "care", animal: this.animal, act });
    this.hooks.sound(act === "pet" ? "goal" : act === "play" ? "event" : act === "vet" ? "toggle" : "click");
    this.refreshAll();
  }

  private rename(): void {
    const input = (this.interior ? this.side : this.body).querySelector<HTMLInputElement>("#zoo-name");
    const error = (this.interior ? this.side : this.body).querySelector<HTMLElement>("#zoo-name-error");
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
    this.refreshAll();
  }

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
    const chosen = speciesInfo(this.shopSpecies ?? "") ?? fits[0];
    const card = (entry: (typeof SPECIES)[number], ok: boolean) =>
      `<button type="button" class="shop-species ${entry.id === chosen.id ? "on" : ""}" data-act="species" data-id="${entry.id}" ${ok ? "" : "disabled"} title="${ok ? "" : `braucht ${HABITAT_INFO[entry.habitat].name}`}"><span class="zoo-ico">${SPECIES_ICON[entry.id]}</span><b>${esc(entry.name)}</b><small>${ok ? `ab ${euro.format(priceOf(entry, "rescue"))} € · Platz ${entry.space}` : esc(HABITAT_INFO[entry.habitat].name)}</small></button>`;
    const origins = BUY_ORIGINS.map((origin) => {
      const info = ORIGIN_INFO[origin];
      const price = priceOf(chosen, origin);
      const start = origin === "breeder" ? "gesund" : origin === "wild" ? "gesund, scheu" : origin === "circus" ? "erschöpft, ängstlich" : "krank, misstrauisch";
      return `<button type="button" class="shop-origin ${origin === this.shopOrigin ? "on" : ""}" data-act="origin" data-id="${origin}"><span class="zoo-ico">${ORIGIN_ICON[origin]}</span><span><b>${esc(info.name)}</b><small>${esc(info.blurb)}</small><em>Start: ${start} · Gesundheit ${info.health}</em></span><strong>${euro.format(price)} €</strong></button>`;
    }).join("");
    const price = priceOf(chosen, this.shopOrigin);
    const blocked = chosen.space > free ? "Kein Platz mehr im Gehege." : city.funds < price ? "Dafür reicht das Geld nicht." : "";
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
      this.animal = fresh.id;
      if (this.interior) this.interior.selected = fresh.id;
      this.closeShop();
      this.refreshAll();
    } else this.renderShop();
  }

  // ------------------------------------------------------------ interior

  openInterior(): void {
    const habitat = this.habitat();
    if (!habitat || this.interior) return;
    this.overlay.hidden = false;
    document.body.dataset.zooInterior = "on";
    // Fresh canvas each time: the previous one lost its WebGL context on close.
    const old = this.overlay.querySelector("#zoo-canvas") as HTMLCanvasElement;
    const canvas = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(canvas);
    this.interior = new InteriorScene(canvas, {
      pickAnimal: (id) => {
        this.animal = id;
        this.releaseArm = -1;
        this.interior!.selected = id;
        this.hooks.sound("click");
        this.renderInterior();
      },
      pickSpot: (x, y) => {
        if (!this.tool || this.tool === "remove") return;
        this.hooks.command({ op: "place", cell: habitat.cell, item: this.tool, x, y });
        this.hooks.sound("place");
        this.renderInterior();
      },
      pickItem: (id) => {
        this.hooks.command({ op: "take", cell: habitat.cell, item: id });
        this.hooks.sound("demolish");
        this.renderInterior();
      },
    });
    // Do not replay old reactions.
    for (const animal of this.zoo()?.animals ?? []) this.seenReact.set(animal.id, animal.react?.tick ?? -1);
    this.interior.selected = this.animal;
    this.resize();
    this.hooks.interior(true);
    this.renderInterior();
    this.hooks.sound("toggle");
  }

  closeInterior(): void {
    if (!this.interior) return;
    this.interior.dispose();
    this.interior = null;
    this.tool = null;
    this.overlay.hidden = true;
    document.body.dataset.zooInterior = "off";
    this.tags.replaceChildren();
    this.hooks.interior(false);
    if (!this.panel.hidden) this.render();
  }

  private setTool(tool: InteriorTool): void {
    this.tool = this.tool === tool ? null : tool;
    this.interior?.setTool(this.tool);
    this.renderInterior();
  }

  private resize(): void {
    if (!this.interior) return;
    this.interior.resize(window.innerWidth, window.innerHeight);
    this.updateInset();
  }

  private renderInterior(): void {
    const interior = this.interior;
    const habitat = this.habitat();
    const zoo = this.zoo();
    const city = this.city;
    if (!interior || !habitat || !zoo || !city) return;
    const animals = animalsIn(zoo, habitat.cell);
    interior.setHabitat(city, habitat, animals);
    for (const animal of animals) {
      const seen = this.seenReact.get(animal.id) ?? -1;
      if (animal.react && animal.react.tick > seen) interior.react(animal.id, animal.react.kind);
      this.seenReact.set(animal.id, animal.react?.tick ?? seen);
    }
    (this.overlay.querySelector("#zi-name") as HTMLElement).textContent = HABITAT_INFO[habitat.type].name;
    const food = habitat.items.filter((item) => item.kind === "food");
    const water = habitat.items.filter((item) => item.kind === "water");
    const pct = (list: { fill?: number }[]) => (list.length ? Math.round(list.reduce((sum, item) => sum + (item.fill ?? 0), 0) / list.length) : 0);
    setHtml(this.topInfo, `
      <span class="zi-chip ${pct(food) < 25 ? "bad" : ""}">🥣 ${food.length ? `${pct(food)} %` : "–"}</span>
      <span class="zi-chip ${pct(water) < 25 ? "bad" : ""}">💧 ${water.length ? `${pct(water)} %` : "–"}</span>
      <button type="button" data-act="refill" id="zi-refill">Auffüllen</button>
      <button type="button" data-act="keeper" class="${habitat.keeper ? "on" : ""}" aria-pressed="${habitat.keeper}">Pfleger ${habitat.keeper ? "an" : "aus"}</button>
      <button type="button" class="zoo-primary" data-act="shop" id="zi-shop">Tiere aufnehmen</button>`);
    setHtml(this.tools, [...ITEM_KINDS.map((kind) => `<button type="button" data-act="tool" data-id="${kind}" class="${this.tool === kind ? "on" : ""}" title="${esc(ITEM_INFO[kind].blurb)}"><span>${ITEM_ICON[kind]}</span><b>${esc(ITEM_INFO[kind].name)}</b><small>${ITEM_INFO[kind].cost} €</small></button>`), `<button type="button" data-act="tool" data-id="remove" class="${this.tool === "remove" ? "on" : ""}"><span>✖</span><b>Entfernen</b><small>Einrichtung</small></button>`].join(""));
    const hint = this.overlay.querySelector("#zi-hint") as HTMLElement;
    hint.textContent = this.tool === "remove"
      ? "Klicke auf einen Gegenstand, um ihn zu entfernen."
      : this.tool
        ? `${ITEM_INFO[this.tool].name}: Klicke auf ein freies Feld im Gehege. Esc beendet.`
        : animals.length
          ? "Klicke ein Tier an: streicheln, spielen, füttern, umbenennen. Ziehen dreht die Ansicht."
          : "Noch keine Tiere. Oben rechts „Tiere aufnehmen“.";
    const animal = this.animal >= 0 ? animals.find((entry) => entry.id === this.animal) : undefined;
    if (animal) {
      if (!(this.side.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === "INPUT")) {
        setHtml(this.side, `<button type="button" class="zoo-link" data-act="deselect">× Schließen</button>${this.animalCard(animal)}`);
      }
      this.side.hidden = false;
    } else {
      this.side.hidden = true;
      if (this.animal >= 0 && !zoo.animals.some((entry) => entry.id === this.animal)) this.animal = -1;
    }
    this.updateInset();
    // name tags
    const tags = animals.map((entry) => `<span class="zi-tag ${entry.id === this.animal ? "on" : ""}" data-tag="${entry.id}">${esc(entry.name)}${entry.health < 40 ? " 🤒" : ""}${entry.pregnantUntil ? " 🍼" : ""}</span>`).join("");
    if (this.tags.dataset.key !== tags) {
      this.tags.innerHTML = tags;
      this.tags.dataset.key = tags;
    }
  }

  /** Keep the habitat centred beside the animal card / above the mobile toolbar. */
  private updateInset(): void {
    if (!this.interior) return;
    const compact = window.innerWidth <= 1100 || window.innerHeight <= 520;
    const side = this.side.hidden ? null : this.side.getBoundingClientRect();
    const tools = this.tools.getBoundingClientRect();
    const right = !compact && side ? side.width + 12 : 0;
    const bottom = compact ? (side ? window.innerHeight - side.top : window.innerHeight - tools.top) * 0.85 : 0;
    this.interior.setInset(right, bottom);
  }

  /** Called every animation frame while the interior is open. */
  frame(dt: number): void {
    if (!this.interior) return;
    this.interior.frame(dt);
    const top = (this.overlay.querySelector(".zi-top") as HTMLElement).getBoundingClientRect().bottom + 22;
    for (const tag of this.tags.children as HTMLCollectionOf<HTMLElement>) {
      const id = Number(tag.dataset.tag);
      const pose = this.interior.poses.get(id);
      if (!pose) continue;
      const species = this.zoo()?.animals.find((animal) => animal.id === id)?.species ?? "goat";
      const height = animalModel(species).lod[1] * pose.boost;
      const at = this.interior.project(pose.x, pose.y + height + 0.35, pose.z);
      tag.hidden = at.y < top;
      tag.style.transform = `translate(${at.x.toFixed(0)}px, ${at.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  /** Short message inside the interior view (the city status bar is hidden there). */
  notice(text: string): void {
    if (!this.interior) return;
    let toast = this.overlay.querySelector<HTMLElement>(".zi-toast");
    if (!toast) {
      toast = document.createElement("p");
      toast.className = "zi-toast";
      toast.setAttribute("role", "status");
      this.overlay.append(toast);
    }
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      if (toast) toast.hidden = true;
    }, 4200);
  }

  // ------------------------------------------------------------ e2e helpers

  e2e() {
    return {
      animalScreen: (id: number) => {
        const pose = this.interior?.poses.get(id);
        return pose && this.interior ? this.interior.project(pose.x, pose.y + 0.4 * pose.boost, pose.z) : null;
      },
      spotScreen: (x: number, y: number) => this.interior?.spotScreen(x, y) ?? null,
      selected: () => this.animal,
      interiorOpen: () => this.interior !== null,
    };
  }
}
