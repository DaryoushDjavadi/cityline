/**
 * Tierpark UI: the gate panel in the city ("Tierpark betreten") and the park level overlay with its
 * own canvas, top bar with stats, build bar (Gehege, Wege, Stände, Deko, Abriss), ghost previews,
 * floating +€ at stands and thought bubbles over visitors. Clicking a habitat flies the camera
 * there and opens its panel; clicking an animal opens its card. The habitat build mode (furniture
 * on the habitat grid, preview, removal, dimmed surroundings) runs here too. Every change is a
 * zoo command.
 */
import {
  DAY_TICKS,
  HABITAT_COST,
  HABITAT_INFO,
  HABITAT_TILES,
  HABITAT_TYPES,
  ITEM_INFO,
  MAX_ITEMS,
  PARK_INFO,
  PARK_SIZE,
  TILE,
  ZOO_EVERY,
  animalsIn,
  dragLine,
  habitatAt,
  habitatAtTile,
  habitatFits,
  habitatTiles,
  isEdge,
  itemAt,
  itemFits,
  itemSize,
  occupancy,
  parkIndex,
  parkXY,
  speciesInfo,
  summarize,
  type CityState,
  type CrowdEvent,
  type HabitatType,
  type ParkBuild,
  type ParkObject,
  type ZooOp,
  type ZooState,
} from "../../../shared/src/index.ts";
import type { Cue } from "../audio/sfx.ts";
import { ParkScene, habitatWorld, tileWorld } from "../render/parkScene.ts";
import { gfxProfile, loadGfxPreset } from "../render/quality.ts";
import { SPECIES_ICON, type BuildState, type ZooPark } from "./zooView.ts";

export interface ParkHooks {
  command: (op: ZooOp) => void;
  sound: (cue: Cue) => void;
  /** Close other city panels when the gate panel opens. */
  opened: () => void;
  /** Park level open/closed (pause the city renderer, hide the city HUD). */
  mode: (open: boolean) => void;
  /** Habitat clicked inside the park: show the habitat panel (animals, shop, build mode). */
  habitat: (cell: number) => void;
  /** Animal clicked inside the park: show its card. */
  animal: (id: number) => void;
  /** Close the habitat panel (when building). */
  closeHabitat: () => void;
  /** Habitat build mode of the panel (null = off). */
  build: () => BuildState | null;
  /** Click on a grid spot of the habitat in build mode. */
  buildAt: (x: number, y: number) => void;
  endBuild: () => void;
  /** Every park frame (name tags). */
  frame: () => void;
  /** Short message in the city status line. */
  flash: (text: string) => void;
}

export type ParkTool = ParkBuild | "clear" | null;

const ICON: Record<string, string> = {
  savanne: "🦒", wald: "🌲", wasser: "💧", polar: "❄️", wiese: "🐐",
  path: "🟫", entrance: "🚪", food: "🍟", drink: "🥤", souvenir: "🧸", toilet: "🚻", bench: "🪑", bin: "🗑️", tree: "🌳", flowers: "🌷",
  clear: "🧹", select: "👆",
};

const TABS: { id: string; label: string; icon: string; items: ParkBuild[] }[] = [
  { id: "habitat", label: "Gehege", icon: "🦒", items: [...HABITAT_TYPES] },
  { id: "paths", label: "Wege", icon: "🟫", items: ["path", "entrance"] },
  { id: "stands", label: "Stände", icon: "🍟", items: ["food", "drink", "souvenir", "toilet"] },
  { id: "decor", label: "Deko", icon: "🌳", items: ["bench", "bin", "tree", "flowers"] },
];

const euro = new Intl.NumberFormat("de-DE");
const PER_DAY = DAY_TICKS / ZOO_EVERY;
const isHabitat = (kind: ParkBuild | "clear" | null): kind is HabitatType => !!kind && (HABITAT_TYPES as string[]).includes(kind);

function nameOf(kind: ParkBuild): string {
  return isHabitat(kind) ? HABITAT_INFO[kind].short : PARK_INFO[kind as ParkObject].name;
}
function costOf(kind: ParkBuild): number {
  return isHabitat(kind) ? HABITAT_COST[kind] : PARK_INFO[kind as ParkObject].cost;
}
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

export class ParkView {
  private readonly gate: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly fx: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly build: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private scene: ParkScene | null = null;
  private city: CityState | null = null;
  private gateCell = -1;
  private tab = "habitat";
  private tool: ParkTool = null;
  private hover = -1;
  private drag: { start: number; tile: number } | null = null;
  private pan: { x: number; y: number; moved: boolean; rotate: boolean } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly bubbles = new Map<number, { el: HTMLElement; text: string }>();
  private readonly counters = { buys: 0, looks: 0, coins: 0, money: 0, sits: 0 };
  private coins = 0;
  private toastTimer = 0;
  private statsOpen = false;
  /** Dims everything but the habitat in build mode (CSS clip-path hole, works in every style). */
  private readonly dim: HTMLElement;
  /** Hovered grid spot in build mode. */
  private spot: { x: number; y: number } | null = null;
  /** For the habitat panel: camera, build mode, selection, reactions. */
  readonly bridge: ZooPark = {
    focusHabitat: (cell) => {
      const scene = this.scene;
      if (!scene) return;
      const at = habitatWorld(cell);
      const close = window.innerWidth < 700 ? 30 : 25;
      scene.flyTo(at.x, at.z, Math.min(scene.distance, this.hooks.build() ? close - 3 : close));
    },
    focusAnimal: (id) => {
      const scene = this.scene;
      const pose = scene?.zoo.poses.get(id);
      if (!scene || !pose) return;
      scene.flyTo(pose.x, pose.z, Math.min(scene.distance, window.innerWidth < 700 ? 22 : 18));
    },
    setBuild: (state) => {
      this.scene?.setBuildGrid(state ? state.cell : null);
      this.overlay.classList.toggle("zoo-build", !!state);
      if (!state) this.spot = null;
      this.buildPreview();
      this.renderHint();
    },
    select: (id) => this.scene?.select(id),
    react: (id, kind) => this.scene?.react(id, kind),
    layout: () => requestAnimationFrame(() => this.updateInset()),
    animalScreen: (id) => this.scene?.animalScreen(id) ?? null,
  };

  constructor(private readonly hooks: ParkHooks) {
    this.gate = document.createElement("aside");
    this.gate.id = "park-gate";
    this.gate.hidden = true;
    this.gate.setAttribute("aria-label", "Tierpark");
    this.gate.addEventListener("click", (event) => this.onAction(event));

    this.overlay = document.createElement("section");
    this.overlay.id = "park-view";
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <canvas id="park-canvas"></canvas>
      <div id="pk-dim" hidden></div>
      <div id="park-fx"></div>
      <header class="pk-top">
        <button type="button" class="zi-back" data-act="back">← Zur Stadt</button>
        <div class="zi-title"><small>Tierpark</small><b id="pk-name">Tierpark</b></div>
        <div class="pk-chips" id="pk-chips"></div>
        <button type="button" class="pk-statbtn" data-act="stats" aria-expanded="false">📊 <span>Statistik</span></button>
      </header>
      <aside class="pk-stats" id="pk-stats" hidden></aside>
      <p class="pk-hint" id="pk-hint"></p>
      <nav class="pk-build" id="pk-build" aria-label="Im Tierpark bauen"></nav>
      <p class="zi-toast pk-toast" id="pk-toast" role="status" hidden></p>`;
    this.overlay.addEventListener("click", (event) => this.onAction(event));
    this.fx = this.overlay.querySelector("#park-fx") as HTMLElement;
    this.chips = this.overlay.querySelector("#pk-chips") as HTMLElement;
    this.stats = this.overlay.querySelector("#pk-stats") as HTMLElement;
    this.build = this.overlay.querySelector("#pk-build") as HTMLElement;
    this.hint = this.overlay.querySelector("#pk-hint") as HTMLElement;
    this.toast = this.overlay.querySelector("#pk-toast") as HTMLElement;
    this.dim = this.overlay.querySelector("#pk-dim") as HTMLElement;
    document.body.append(this.gate, this.overlay);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (!this.scene) return;
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      // The city is hidden while the park is open: its shortcuts must not act behind the park.
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        // One step per press: tool → statistics → habitat panel → back to the city.
        event.preventDefault();
        if (this.tool) this.setTool(null);
        else if (this.statsOpen) this.toggleStats(false);
        else if (document.body.dataset.zoo === "on") this.hooks.closeHabitat();
        else this.close();
        return;
      }
      if (event.code === "KeyQ") this.scene.rotate(0.2);
      if (event.code === "KeyE") this.scene.rotate(-0.2);
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
  }

  get isOpen(): boolean {
    return this.scene !== null;
  }

  get gateOpen(): boolean {
    return !this.gate.hidden;
  }

  private zoo(): ZooState | null {
    return this.city?.progress?.zoo ?? null;
  }

  // ------------------------------------------------------------ gate panel (city)

  showGate(city: CityState, cell: number): void {
    this.city = city;
    this.gateCell = cell;
    this.gate.hidden = false;
    document.body.dataset.parkGate = "on";
    this.hooks.opened();
    this.renderGate();
  }

  hideGate(): void {
    if (this.gate.hidden) return;
    this.gate.hidden = true;
    document.body.dataset.parkGate = "off";
  }

  private renderGate(): void {
    const zoo = this.zoo();
    const animals = zoo?.animals.filter((animal) => animal.cell >= 0).length ?? 0;
    const lines = zoo
      ? [
        ["👥", "Besucher", `${zoo.visitors}`],
        ["😊", "Zufriedenheit", `${Math.round(zoo.satisfaction)} %`],
        ["💶", "Einnahmen", `${euro.format(Math.round(zoo.income * PER_DAY))} € / Tag`],
        ["🦒", "Gehege · Tiere", `${zoo.habitats.length} · ${animals}`],
      ]
      : [];
    setHtml(this.gate, `
      <div class="panel-head"><p class="eyebrow">Tierpark</p><button type="button" class="pk-x" data-act="close-gate" aria-label="Schließen">×</button></div>
      <p class="pk-gate-lead">${zoo?.habitats.length ? "Euer Zoo hinter dem Tor. Gehege, Wege und Stände baust du im Park." : "Noch leer: Betritt den Park und baue Gehege, Wege und einen Essensstand."}</p>
      <dl class="pk-gate-stats">${lines.map(([icon, label, value]) => `<div><dt>${icon} ${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      <button type="button" class="pk-enter" data-act="enter">Tierpark betreten</button>`);
  }

  // ------------------------------------------------------------ park level

  open(): void {
    if (this.scene || !this.city) return;
    this.hideGate();
    this.overlay.hidden = false;
    document.body.dataset.park = "on";
    // Fresh canvas each time (a disposed renderer loses its context).
    const old = this.overlay.querySelector("#park-canvas") as HTMLCanvasElement;
    const canvas = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(canvas);
    const low = gfxProfile(loadGfxPreset(), window.devicePixelRatio || 1).level === "low";
    try {
      this.scene = new ParkScene(canvas, low);
    } catch (error) {
      // No WebGL context: stay in the city instead of an empty park without a way back.
      console.warn("Tierpark nicht verfügbar", error);
      this.overlay.hidden = true;
      document.body.dataset.park = "off";
      this.hooks.flash("Der Tierpark konnte gerade nicht starten. Versuch es gleich noch einmal.");
      return;
    }
    this.bindCanvas(canvas);
    this.tool = null;
    this.tab = "habitat";
    this.hooks.mode(true);
    this.resize();
    this.update(this.city);
    this.scene?.crowd.prewarm(40, this.want(this.zoo()?.visitors ?? 0));
    this.renderBuild();
    this.hooks.sound("toggle");
  }

  close(): void {
    if (!this.scene) return;
    this.scene.dispose();
    this.scene = null;
    this.overlay.hidden = true;
    this.fx.replaceChildren();
    this.bubbles.clear();
    this.coins = 0;
    this.drag = null;
    this.pan = null;
    this.pointers.clear();
    this.toggleStats(false);
    document.body.dataset.park = "off";
    this.hooks.closeHabitat();
    this.hooks.mode(false);
  }

  update(city: CityState): void {
    this.city = city;
    const zoo = this.zoo();
    if (!this.gate.hidden) {
      if (city.services[this.gateCell] !== 20) this.hideGate();
      else this.renderGate();
    }
    if (!this.scene) return;
    if (!zoo?.park || zoo.gate < 0) {
      this.close();
      return;
    }
    this.scene.sync(zoo, city.tick);
    this.renderTop(zoo);
    if (this.statsOpen) this.renderStats(zoo);
    this.renderHint();
  }

  resize(): void {
    if (!this.scene) return;
    this.scene.resize(window.innerWidth, window.innerHeight);
    this.updateInset();
  }

  private updateInset(): void {
    if (!this.scene) return;
    const top = (this.overlay.querySelector(".pk-top") as HTMLElement).getBoundingClientRect();
    const bar = this.build.getBoundingClientRect();
    const compact = window.innerWidth <= 1100 || window.innerHeight <= 520;
    const zooPanel = document.body.dataset.zoo === "on" ? document.querySelector<HTMLElement>("#zoo-panel") : null;
    const panel = zooPanel && !zooPanel.hidden ? zooPanel.getBoundingClientRect() : null;
    let side = this.statsOpen && !compact ? this.stats.getBoundingClientRect().width + 12 : 0;
    let bottom = Math.max(0, window.innerHeight - bar.top);
    if (panel && !compact) side = Math.max(side, window.innerWidth - panel.left);
    // Mobile: the panel is a bottom sheet over the build bar.
    if (panel && compact) bottom = Math.max(0, window.innerHeight - panel.top);
    this.scene.setInset(side, bottom, top.bottom);
  }

  /** Visual crowd size: the park's visitor count, capped for the screen. */
  private want(visitors: number): number {
    return Math.min(visitors, window.innerWidth < 700 ? 60 : 120);
  }

  frame(dt: number): void {
    const scene = this.scene;
    if (!scene) return;
    const zoo = this.zoo();
    const speed = 40 * dt;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) scene.pan(0, speed * 8);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) scene.pan(0, -speed * 8);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) scene.pan(speed * 8, 0);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) scene.pan(-speed * 8, 0);
    const events = scene.frame(dt, this.want(zoo?.visitors ?? 0));
    for (const event of events) this.onCrowd(event, zoo);
    this.placeBubbles();
    this.placeDim();
    this.hooks.frame();
  }

  // ------------------------------------------------------------ habitat build mode

  /** Hole in the dim layer around the habitat in build mode (convex hull of its box on screen). */
  private placeDim(): void {
    const build = this.hooks.build();
    const scene = this.scene;
    this.dim.hidden = !build || !scene;
    if (!build || !scene) return;
    const at = habitatWorld(build.cell);
    const r = (HABITAT_TILES * 2) / 2 + 0.15;
    const points: { x: number; y: number }[] = [];
    for (const y of [0, 1.7]) for (const [dx, dz] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
      const p = scene.project(at.x + dx, y, at.z + dz);
      if (p.behind) {
        this.dim.hidden = true;
        return;
      }
      points.push({ x: p.x, y: p.y });
    }
    const hull = convexHull(points);
    const w = this.dim.clientWidth || window.innerWidth;
    const h = this.dim.clientHeight || window.innerHeight;
    const path = hull.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(", ");
    this.dim.style.clipPath = `polygon(evenodd, 0 0, ${w}px 0, ${w}px ${h}px, 0 ${h}px, 0 0, ${path}, ${hull[0].x.toFixed(1)}px ${hull[0].y.toFixed(1)}px, 0 0)`;
  }

  /** Furniture preview (green fits / red blocked) or the removal marker at the hovered spot. */
  private buildPreview(): void {
    const scene = this.scene;
    if (!scene) return;
    const build = this.hooks.build();
    const zoo = this.zoo();
    const habitat = build && zoo ? habitatAt(zoo, build.cell) : null;
    if (!build || !habitat || !this.spot || !build.tool) {
      if (build) {
        scene.setItemGhost(build.cell, null);
        scene.setSpotMark(build.cell, null);
      }
      return;
    }
    const { x, y } = this.spot;
    if (build.tool === "remove") {
      scene.setItemGhost(build.cell, null);
      const item = itemAt(habitat, x, y);
      scene.setSpotMark(build.cell, item ? { x: item.x, y: item.y, size: itemSize(item.kind) } : { x, y, size: 1, color: 0xfff6d8 });
      return;
    }
    const size = itemSize(build.tool);
    // Bigger items: the cursor spot is their top-left; clamp so they stay inside.
    const gx = Math.min(x, 8 - size);
    const gy = Math.min(y, 8 - size);
    const ok = itemFits(habitat, build.tool, gx, gy) && habitat.items.length < MAX_ITEMS && (this.city?.funds ?? 0) >= ITEM_INFO[build.tool].cost;
    scene.setSpotMark(build.cell, null);
    scene.setItemGhost(build.cell, { kind: build.tool, x: gx, y: gy, size, rot: build.rot, ok });
  }

  private buildClick(clientX: number, clientY: number): boolean {
    const build = this.hooks.build();
    const scene = this.scene;
    if (!build || !scene) return false;
    const spot = scene.pickSpot(build.cell, clientX, clientY);
    if (!spot) return false;
    if (build.tool && build.tool !== "remove") {
      const size = itemSize(build.tool);
      spot.x = Math.min(spot.x, 8 - size);
      spot.y = Math.min(spot.y, 8 - size);
      const zoo = this.zoo();
      const habitat = zoo ? habitatAt(zoo, build.cell) : null;
      if (habitat && !itemFits(habitat, build.tool, spot.x, spot.y)) {
        this.notice("Hier steht schon etwas.");
        this.hooks.sound("reject");
        return true;
      }
    }
    this.hooks.buildAt(spot.x, spot.y);
    this.spot = spot;
    this.buildPreview();
    return true;
  }

  // ------------------------------------------------------------ crowd effects

  private onCrowd(event: CrowdEvent, zoo: ZooState | null): void {
    const scene = this.scene!;
    if (event.type === "buy") {
      this.counters.buys += 1;
      this.counters.money += event.price;
      if (this.coins >= 14) return;
      const at = tileWorld(event.tile);
      const p = scene.project(at.x, 2.6, at.z);
      if (p.behind || p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight) return;
      const coin = document.createElement("span");
      coin.className = "pk-coin";
      coin.textContent = `+${event.price} €`;
      coin.style.left = `${p.x.toFixed(0)}px`;
      coin.style.top = `${p.y.toFixed(0)}px`;
      this.fx.append(coin);
      this.coins += 1;
      this.counters.coins += 1;
      window.setTimeout(() => {
        coin.remove();
        this.coins -= 1;
      }, 1500);
    } else if (event.type === "look") {
      this.counters.looks += 1;
      const animals = zoo ? animalsIn(zoo, event.habitat) : [];
      const pick = animals.length ? animals[event.walker % animals.length] : null;
      const text = event.love ? "❤️" : pick ? SPECIES_ICON[pick.species] ?? "🐾" : "💭";
      this.bubbles.set(event.walker, { el: this.bubble(text, event.love), text });
    } else if (event.type === "sit") {
      this.counters.sits += 1;
    }
  }

  private bubble(text: string, love: boolean): HTMLElement {
    const el = document.createElement("span");
    el.className = love ? "pk-think love" : "pk-think";
    el.textContent = text;
    this.fx.append(el);
    return el;
  }

  private placeBubbles(): void {
    const scene = this.scene!;
    const walkers = new Map(scene.crowd.walkers.map((walker) => [walker.id, walker]));
    for (const [id, bubble] of this.bubbles) {
      const walker = walkers.get(id);
      if (!walker || walker.state !== "look") {
        bubble.el.remove();
        this.bubbles.delete(id);
        continue;
      }
      const at = scene.walkerWorld(walker);
      const p = scene.project(at.x, 2.25, at.z);
      bubble.el.hidden = p.behind;
      bubble.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  // ------------------------------------------------------------ input

  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        // Two fingers: pinch zoom + pan, cancel any build drag.
        this.drag = null;
        this.pan = null;
        this.scene?.setGhost([], null);
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
      const buildDrag = event.button === 0 && this.tool && this.tool !== "entrance" && !isHabitat(this.tool);
      if (buildDrag) {
        const tile = this.scene!.pick(event.clientX, event.clientY).tile;
        if (tile >= 0) this.drag = { start: tile, tile };
        this.preview();
        return;
      }
      this.pan = { x: event.clientX, y: event.clientY, moved: false, rotate: event.button === 2 };
    });
    canvas.addEventListener("pointermove", (event) => {
      const scene = this.scene;
      if (!scene) return;
      const prev = this.pointers.get(event.pointerId);
      if (prev) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        if (dist > 0 && this.pinch.dist > 0) scene.zoom(this.pinch.dist / dist);
        scene.pan(cx - this.pinch.x, cy - this.pinch.y);
        this.pinch = { dist, x: cx, y: cy };
        return;
      }
      if (this.pan && prev) {
        const dx = event.clientX - this.pan.x;
        const dy = event.clientY - this.pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.pan.moved = true;
        if (this.pan.moved) {
          if (this.pan.rotate) scene.rotate(-(event.clientX - prev.x) * 0.006);
          else scene.pan(event.clientX - prev.x, event.clientY - prev.y);
        }
        return;
      }
      const build = this.hooks.build();
      if (build) {
        this.spot = scene.pickSpot(build.cell, event.clientX, event.clientY);
        this.buildPreview();
        return;
      }
      const tile = scene.pick(event.clientX, event.clientY).tile;
      if (this.drag) {
        if (tile >= 0) this.drag.tile = tile;
      } else this.hover = tile;
      this.preview();
    });
    const end = (event: PointerEvent) => {
      const had = this.pointers.has(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        return;
      }
      if (!had) return;
      if (this.drag) {
        const drag = this.drag;
        this.drag = null;
        if (event.type === "pointerup") this.commitDrag(drag.start, drag.tile);
        this.preview();
        return;
      }
      const pan = this.pan;
      this.pan = null;
      if (pan && !pan.moved && event.type === "pointerup" && event.button !== 2) this.click(event.clientX, event.clientY);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => {
      if (this.drag || this.pointers.size) return;
      this.hover = -1;
      this.spot = null;
      this.buildPreview();
      this.preview();
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.scene?.zoom(Math.exp(event.deltaY * 0.0012));
    }, { passive: false });
  }

  private click(clientX: number, clientY: number): void {
    const scene = this.scene!;
    const zoo = this.zoo();
    if (!zoo?.park) return;
    if (this.hooks.build() && this.buildClick(clientX, clientY)) return;
    const tile = scene.pick(clientX, clientY).tile;
    if (isHabitat(this.tool)) {
      if (tile < 0) return;
      this.hooks.command({ op: "pbuild", kind: this.tool, cells: [this.anchorFor(tile)] });
      this.hooks.sound("place");
      return;
    }
    if (this.tool === "entrance") {
      if (tile < 0) return;
      this.hooks.command({ op: "pbuild", kind: "entrance", cells: [tile] });
      this.hooks.sound("place");
      return;
    }
    // Select: animals open their card, habitats their panel, stands tell what they earn.
    if (!this.hooks.build()) {
      const id = scene.pickAnimal(clientX, clientY);
      if (id >= 0) {
        this.hooks.sound("click");
        this.hooks.animal(id);
        return;
      }
    }
    if (tile < 0) return;
    const habitat = habitatAtTile(zoo.habitats, tile);
    if (habitat) {
      this.hooks.sound("click");
      this.hooks.habitat(habitat.cell);
      return;
    }
    const code = occupancy(zoo.park, zoo.habitats)[tile];
    const kind = (Object.keys(PARK_INFO) as ParkObject[]).find((entry) => PARK_INFO[entry].code === code && entry !== "path");
    if (kind) {
      const info = PARK_INFO[kind];
      const reachable = summarize(zoo.park, zoo.habitats).spots[kind]?.some((spot) => spot.tile === tile) ?? kind === "entrance";
      this.notice(`${ICON[kind]} ${info.name}${info.price ? ` · ${info.price} € pro Kauf` : ""}${!reachable && kind !== "entrance" && kind !== "tree" && kind !== "flowers" ? " · Kein Weg daneben, Besucher kommen nicht hin." : ""}`);
    }
  }

  private commitDrag(start: number, end: number): void {
    const tool = this.tool;
    if (!tool) return;
    const cells = this.dragCells(start, end);
    if (cells.length === 0) return;
    if (tool === "clear") {
      this.hooks.command({ op: "pclear", cells });
      this.hooks.sound("demolish");
      return;
    }
    const grid = this.grid();
    const free = cells.filter((tile) => grid?.[tile] === TILE.grass);
    if (free.length === 0) {
      this.notice("Hier ist schon etwas gebaut.");
      return;
    }
    this.hooks.command({ op: "pbuild", kind: tool, cells: free });
    this.hooks.sound("place");
  }

  /** Path and 1-tile objects: L-shaped line; Abriss: rectangle. */
  private dragCells(start: number, end: number): number[] {
    if (this.tool === "clear") {
      const a = parkXY(start);
      const b = parkXY(end);
      const out: number[] = [];
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) out.push(parkIndex(x, y));
      return out.slice(0, 400);
    }
    return dragLine(start, end).slice(0, 400);
  }

  /** Habitat anchor so the 5×5 footprint is centred on the cursor (clamped into the park). */
  private anchorFor(tile: number): number {
    const { x, y } = parkXY(tile);
    const ax = Math.max(0, Math.min(PARK_SIZE - HABITAT_TILES, x - 2));
    const ay = Math.max(0, Math.min(PARK_SIZE - HABITAT_TILES, y - 2));
    return parkIndex(ax, ay);
  }

  private grid(): Uint8Array | null {
    const zoo = this.zoo();
    return zoo?.park ? occupancy(zoo.park, zoo.habitats) : null;
  }

  private preview(): void {
    const scene = this.scene;
    if (!scene) return;
    const grid = this.grid();
    const tool = this.tool;
    if (!grid || !tool) {
      scene.setGhost([], null);
      return;
    }
    if (isHabitat(tool)) {
      if (this.hover < 0) return scene.setGhost([], null);
      const anchor = this.anchorFor(this.hover);
      const ok = habitatFits(anchor) && habitatTiles(anchor).every((tile) => grid[tile] === TILE.grass) && (this.city?.funds ?? 0) >= costOf(tool);
      scene.setGhost([], { anchor, ok });
      return;
    }
    const cells = this.drag ? this.dragCells(this.drag.start, this.drag.tile) : this.hover >= 0 ? [this.hover] : [];
    const zoo = this.zoo();
    scene.setGhost(
      cells.map((tile) => ({
        tile,
        ok: tool === "clear"
          ? grid[tile] !== TILE.grass && grid[tile] !== TILE.entrance
          : tool === "entrance"
            ? isEdge(tile) && (grid[tile] === TILE.grass || grid[tile] === TILE.path) && tile !== zoo?.park?.entrance
            : grid[tile] === TILE.grass,
      })),
      null,
      tool === "clear" || tool === "path" || tool === "entrance" ? null : (tool as Exclude<ParkObject, "path">),
    );
  }

  // ------------------------------------------------------------ bars

  private onAction(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target) return;
    const act = target.dataset.act;
    if (act === "enter") this.open();
    else if (act === "close-gate") this.hideGate();
    else if (act === "back") this.close();
    else if (act === "stats") this.toggleStats(!this.statsOpen);
    else if (act === "tab") {
      this.tab = target.dataset.tab ?? "habitat";
      this.renderBuild();
      this.hooks.sound("click");
    } else if (act === "tool") {
      const tool = (target.dataset.tool || null) as ParkTool;
      this.setTool(this.tool === tool ? null : tool);
      this.hooks.sound("click");
    } else if (act === "select") this.setTool(null);
    else if (act === "clear") this.setTool(this.tool === "clear" ? null : "clear");
  }

  setTool(tool: ParkTool): void {
    this.tool = tool;
    if (tool) this.hooks.closeHabitat();
    this.drag = null;
    this.renderBuild();
    this.renderHint();
    this.preview();
    this.overlay.dataset.tool = tool ?? "select";
  }

  private toggleStats(open: boolean): void {
    this.statsOpen = open;
    this.stats.hidden = !open;
    this.overlay.classList.toggle("stats-on", open);
    (this.overlay.querySelector(".pk-statbtn") as HTMLElement).setAttribute("aria-expanded", String(open));
    const zoo = this.zoo();
    if (open && zoo) this.renderStats(zoo);
    this.updateInset();
  }

  private renderBuild(): void {
    const tab = TABS.find((entry) => entry.id === this.tab) ?? TABS[0];
    const funds = this.city?.funds ?? 0;
    const tabs = [
      `<button type="button" class="pk-tab${this.tool === null ? " on" : ""}" data-act="select" title="Auswählen und umsehen"><span>${ICON.select}</span><b>Auswahl</b></button>`,
      ...TABS.map((entry) => `<button type="button" class="pk-tab${entry.id === tab.id ? " open" : ""}" data-act="tab" data-tab="${entry.id}"><span>${entry.icon}</span><b>${entry.label}</b></button>`),
      `<button type="button" class="pk-tab${this.tool === "clear" ? " on" : ""}" data-act="clear" title="Abreißen (ziehen für eine Fläche)"><span>${ICON.clear}</span><b>Abriss</b></button>`,
    ].join("");
    const items = tab.items.map((kind) => {
      const cost = costOf(kind);
      return `<button type="button" class="pk-item${this.tool === kind ? " on" : ""}${funds < cost ? " poor" : ""}" data-act="tool" data-tool="${kind}" title="${isHabitat(kind) ? HABITAT_INFO[kind].blurb : PARK_INFO[kind as ParkObject].blurb}"><span>${ICON[kind]}</span><b>${nameOf(kind)}</b><small>${euro.format(cost)} €${kind === "path" ? " / Feld" : ""}</small></button>`;
    }).join("");
    setHtml(this.build, `<div class="pk-items">${items}</div><div class="pk-tabs">${tabs}</div>`);
    requestAnimationFrame(() => this.updateInset());
  }

  private renderTop(zoo: ZooState): void {
    const perDay = Math.round(zoo.income * PER_DAY);
    const sat = Math.round(zoo.satisfaction);
    const name = this.overlay.querySelector("#pk-name") as HTMLElement;
    const text = `${zoo.habitats.length} Gehege · ${zoo.animals.filter((a) => a.cell >= 0).length} Tiere`;
    if (name.textContent !== text) name.textContent = text;
    setHtml(this.chips, [
      `<span class="zi-chip" title="Besucher im Park">👥 ${zoo.visitors}</span>`,
      `<span class="zi-chip${sat < 40 && zoo.visitors > 0 ? " bad" : ""}" title="Zufriedenheit">😊 ${sat} %</span>`,
      `<span class="zi-chip" title="Einnahmen pro Spieltag (Eintritt + Stände)">💶 ${euro.format(perDay)} €/Tag</span>`,
      `<span class="zi-chip pk-funds" title="Stadtkasse">🏦 ${euro.format(Math.floor(this.city?.funds ?? 0))} €</span>`,
    ].join(""));
  }

  private renderStats(zoo: ZooState): void {
    if (!zoo.park) return;
    const s = summarize(zoo.park, zoo.habitats);
    const tickets = Math.round(Math.max(0, zoo.income - zoo.sales) * PER_DAY);
    const sales = Math.round(zoo.sales * PER_DAY);
    const cost = Math.round(zoo.cost * PER_DAY);
    const animals = zoo.animals.filter((a) => a.cell >= 0);
    const species = new Set(animals.map((a) => a.species)).size;
    const tips: string[] = [];
    const unreachable = zoo.habitats.length - s.habitats.length;
    if (zoo.habitats.length === 0) tips.push("Baue ein Gehege direkt an einen Weg.");
    if (unreachable > 0) tips.push(`${unreachable} Gehege ohne Weg – Besucher sehen es nicht.`);
    if (zoo.habitats.length > 0 && animals.length === 0) tips.push("Klicke ein Gehege an und nimm Tiere auf.");
    if (s.spots.food.length === 0) tips.push("Ein Essensstand am Weg bringt Geld und gute Laune.");
    if (s.spots.drink.length === 0) tips.push("Ein Getränkestand fehlt noch.");
    if (s.spots.toilet.length < Math.ceil(zoo.visitors / 60)) tips.push("Zu wenig Toiletten für so viele Besucher.");
    if (s.spots.bin.length === 0 && zoo.visitors > 30) tips.push("Ohne Mülleimer liegt Abfall herum.");
    if (s.spots.bench.length === 0) tips.push("Bänke zum Ausruhen machen Besucher zufriedener.");
    if (s.decor < 4) tips.push("Bäume und Blumen machen den Park schöner.");
    const row = (label: string, value: string, tone = "") => `<div class="${tone}"><dt>${label}</dt><dd>${value}</dd></div>`;
    const sat = Math.round(zoo.satisfaction);
    setHtml(this.stats, `
      <h3>Statistik</h3>
      <div class="zoo-bar ${sat < 40 ? "bad" : sat > 70 ? "good" : ""}"><span>Zufriedenheit</span><i><b style="width:${sat}%"></b></i><em>${sat}</em></div>
      <dl>
        ${row("👥 Besucher jetzt", `${zoo.visitors}`)}
        ${row("🎟️ Eintritt", `${euro.format(tickets)} € / Tag`)}
        ${row("🍟 Stände", `${euro.format(sales)} € / Tag`)}
        ${row("🧾 Kosten (Futter, Pfleger, Personal)", `−${euro.format(cost)} € / Tag`)}
        ${row("💶 Gewinn", `${euro.format(tickets + sales - cost)} € / Tag`, tickets + sales - cost >= 0 ? "good" : "bad")}
        ${row("🦒 Gehege mit Weg", `${s.habitats.length} / ${zoo.habitats.length}`)}
        ${row("🐾 Tiere · Arten", `${animals.length} · ${species}`)}
        ${row("🍟🥤🧸 Stände", `${s.spots.food.length} · ${s.spots.drink.length} · ${s.spots.souvenir.length}`)}
        ${row("🚻 Toiletten", `${s.spots.toilet.length} (nötig ${Math.ceil(zoo.visitors / 60)})`)}
        ${row("🪑 Bänke · 🗑️ Mülleimer", `${s.spots.bench.length} · ${s.spots.bin.length}`)}
        ${row("🌳 Deko", `${s.decor}`)}
        ${row("🟫 Wege", `${s.paths} Felder`)}
      </dl>
      ${tips.length ? `<ul class="pk-tips">${tips.slice(0, 4).map((tip) => `<li>${tip}</li>`).join("")}</ul>` : `<p class="pk-tips ok">Alles da – die Besucher sind rundum versorgt.</p>`}`);
  }

  private renderHint(): void {
    const tool = this.tool;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let text = "Gehege anklicken für Tiere und Bau-Modus. Ziehen verschiebt, Mausrad zoomt, rechte Taste dreht.";
    if (coarse) text = "Gehege antippen für Tiere und Bau-Modus. Ziehen verschiebt, zwei Finger zoomen.";
    const build = this.hooks.build();
    if (build) text = build.tool === "remove" ? "Entfernen: Gegenstand im Gehege antippen." : build.tool ? `${ITEM_INFO[build.tool].name}: freies Feld im Gehege ${coarse ? "antippen" : "anklicken"}${coarse ? "" : " · R dreht"} · Esc beendet.` : "Bau-Modus: Gegenstand im Panel wählen.";
    else if (tool === "clear") text = "Abriss: tippen oder eine Fläche ziehen. Der Eingang bleibt stehen.";
    else if (tool === "path") text = `Weg: ziehen legt eine Strecke (${PARK_INFO.path.cost} € pro Feld). Besucher laufen nur auf Wegen.`;
    else if (tool === "entrance") text = "Eingang: ein Feld am Rand des Parks wählen.";
    else if (isHabitat(tool)) text = `${HABITAT_INFO[tool].name}: 5 × 5 Felder, direkt an einen Weg setzen. ${euro.format(HABITAT_COST[tool])} €.`;
    else if (tool) text = `${PARK_INFO[tool as ParkObject].name}: ${PARK_INFO[tool as ParkObject].blurb} ${euro.format(PARK_INFO[tool as ParkObject].cost)} €.`;
    if (this.hint.textContent !== text) {
      this.hint.textContent = text;
      // The look-around hint fades after a few seconds; tool hints stay while the tool is active.
      this.hint.classList.remove("idle");
      if (!tool && !build) {
        void this.hint.offsetWidth;
        this.hint.classList.add("idle");
      }
    }
  }

  notice(text: string): void {
    if (!this.scene) return;
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 3800);
  }

  // ------------------------------------------------------------ e2e

  e2e() {
    return {
      isOpen: () => this.isOpen,
      gateOpen: () => this.gateOpen,
      enter: () => {
        this.open();
        return this.isOpen;
      },
      leave: () => this.close(),
      openHabitat: (anchor: number) => this.hooks.habitat(anchor),
      setTool: (tool: ParkTool) => this.setTool(tool),
      setTab: (tab: string) => {
        this.tab = tab;
        this.renderBuild();
      },
      toggleStats: (open: boolean) => this.toggleStats(open),
      tileScreen: (tile: number) => {
        if (!this.scene) return null;
        const at = tileWorld(tile);
        const p = this.scene.project(at.x, 0, at.z);
        return { x: p.x, y: p.y };
      },
      habitatScreen: (anchor: number) => {
        if (!this.scene) return null;
        const at = habitatWorld(anchor);
        const p = this.scene.project(at.x, 0.3, at.z);
        return { x: p.x, y: p.y };
      },
      lookAt: (tile: number, distance?: number, azimuth?: number) => {
        if (!this.scene) return;
        const at = tileWorld(tile);
        this.scene.lookAt(at.x, at.z, distance);
        if (azimuth !== undefined) this.scene.azimuth = azimuth;
      },
      lookAtWorld: (x: number, z: number, distance?: number, azimuth?: number) => {
        if (!this.scene) return;
        this.scene.lookAt(x, z, distance);
        if (azimuth !== undefined) this.scene.azimuth = azimuth;
      },
      spotScreen: (x: number, y: number) => {
        const build = this.hooks.build();
        return build && this.scene ? this.scene.spotScreen(build.cell, x, y) : null;
      },
      animalScreen: (id: number) => this.scene?.animalScreen(id) ?? null,
      bursts: () => this.scene?.burstCount() ?? 0,
      flying: () => this.scene?.flying ?? false,
      camera: () => (this.scene ? { x: this.scene.target.x, z: this.scene.target.z, distance: this.scene.distance } : null),
      dimOn: () => !this.dim.hidden,
      stats: () => (this.scene ? { ...this.scene.stats(), ...this.counters, bubbles: this.bubbles.size, zoo: this.scene.zoo.stats() } : null),
      walkers: () => this.scene?.crowd.walkers.filter((w) => w.state !== "gone").map((w) => ({ id: w.id, x: w.x, y: w.y, state: w.state })) ?? [],
    };
  }
}

/** Convex hull (monotone chain) of screen points, counter-clockwise. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Plain helper for tests: species names of a habitat. */
export function habitatSpecies(zoo: ZooState, cell: number): string[] {
  return animalsIn(zoo, cell).map((animal) => speciesInfo(animal.species)?.name ?? animal.species);
}
