import * as THREE from "three";
import { io, type Socket } from "socket.io-client";
import { apiUrl, isDevServer, socketUrl } from "./serverUrl.ts";
import { CityRenderer } from "../render/CityRenderer.ts";
import { RtsCamera } from "../render/RtsCamera.ts";
import { createHud, type ToolId } from "../ui/hud.ts";
import {
  BUILDINGS,
  CELL_SIZE,
  COST,
  LEVEL_COUNT,
  POWER_BIT,
  ServiceKind,
  TRADE,
  WATER_BIT,
  Zone,
  applyCommand,
  asUint8Array,
  cleanChat,
  brushCells,
  buildMeta,
  canPlace,
  cellBudget,
  cellCoords,
  cellIndex,
  allocateCityCode,
  cityToSave,
  createCity,
  createLevelCity,
  deleteCitySlot,
  getActiveCityId,
  listCitySlots,
  loadCitySlot,
  loadOrCreateClientId,
  mergeRoomLists,
  employeesAt,
  evaluateLevel,
  farmYield,
  foodRatio,
  houseReport,
  isLine,
  isWorkplace,
  jobOpenings,
  isPipe,
  isRoad,
  levelById,
  levelRoomCode,
  lineCells,
  packCells,
  parseChatMessage,
  parseCursor,
  parseLevelRoom,
  refreshUtilities,
  saveToCity,
  writeCitySlot,
  scholarshipCost,
  serviceInfo,
  serviceNearby,
  unemployedAdults,
  worldToCell,
  writeCity,
  type ChatMessage,
  type CitySave,
  type CityState,
  type Command,
  type CommandResult,
  type LevelSync,
  type LockSnapshot,
  type PublicPlayer,
  type ServiceId,
  type SimMeta,
  type StatePayload,
  type WelcomePayload,
} from "../../../shared/src/index.ts";
import { isLevelOpen, loadPlayerName, loadUnlockedLevel, savePlayerName, unlockAfterWin } from "../ui/levelProgress.ts";
import { isCompactHud, onCompactHudChange } from "../ui/layout.ts";

const AUTO_SAVE_MS = (() => {
  const raw = Number(new URLSearchParams(location.search).get("autosave"));
  return Number.isFinite(raw) && raw >= 250 ? raw : 120_000;
})();

const HINTS: Partial<Record<ToolId, string>> = {
  inspect: "Lupe: Straßen, Häuser und fahrende Autos anklicken.",
  road: `Straße ziehen. Gerade oder eine rechtwinklige Ecke. ${COST.road} € pro Feld.`,
  bridge: `Brücke über Wasser, neben den Straßen. ${COST.bridge} € pro Feld.`,
  fill: `Land aufschütten, ${COST.fill} € pro blaues Feld an der Küste, im Fluss oder im See. Das Meer außerhalb der Karte hat keine Felder.`,
  cottage: `${BUILDINGS.cottage.name}, ein Feld an einer Straße. ${BUILDINGS.cottage.cost} €.`,
  apartments: `${BUILDINGS.apartments.name}, ein Feld an einer Straße. ${BUILDINGS.apartments.cost} €.`,
  tower: `${BUILDINGS.tower.name}, ein Feld an einer Straße. ${BUILDINGS.tower.cost} €.`,
  shop: `${BUILDINGS.shop.name}, ein Feld an einer Straße. ${BUILDINGS.shop.cost} €.`,
  office: `${BUILDINGS.office.name}, ein Feld an einer Straße. ${BUILDINGS.office.cost} €.`,
  mall: `${BUILDINGS.mall.name}, ein Feld an einer Straße. ${BUILDINGS.mall.cost} €.`,
  workshop: `${BUILDINGS.workshop.name}, ein Feld an einer Straße. ${BUILDINGS.workshop.cost} €.`,
  factory: `${BUILDINGS.factory.name}, ein Feld an einer Straße. ${BUILDINGS.factory.cost} €.`,
  plant: `${BUILDINGS.plant.name}, ein Feld an einer Straße. ${BUILDINGS.plant.cost} €.`,
  farm: `${BUILDINGS.farm.name}. Arbeiter erzeugen Nahrung. Am Anfang reicht ein Hof mit wenigen Leuten. ${BUILDINGS.farm.cost} €.`,
  line: `Stromleitung, auch über Straßen, Brücken und Wasser. ${COST.line} €.`,
  pipe: `Wasserrohr, auch über Straßen, Brücken und Wasser. ${COST.pipe} €.`,
  power: `Kraftwerk direkt neben eine Straße. ${COST.power} €.`,
  water: `Wasserwerk direkt neben eine Straße. ${COST.water} €.`,
  school: `Schule, damit Bewohner einen Abschluss bekommen. ${COST.school} €.`,
  university: `Universität für bessere Jobs. ${COST.university} €.`,
  clinic: `Klinik. ${COST.clinic} €.`,
  police: `Polizei. ${COST.police} €.`,
  fire: `Feuerwehr. ${COST.fire} €.`,
  park: `Park. ${COST.park} €.`,
  airport: `Kleiner Privatflugplatz. ${COST.airport.toLocaleString("de-DE")} €, danach etwa 260 € alle 2 s. Import und Export an der Lupe.`,
  bulldoze: "Ein einzelnes Feld abreißen.",
};

const SERVICES: Partial<Record<ToolId, ServiceId>> = {
  power: ServiceKind.Power,
  water: ServiceKind.Water,
  school: ServiceKind.School,
  clinic: ServiceKind.Clinic,
  police: ServiceKind.Police,
  fire: ServiceKind.Fire,
  park: ServiceKind.Park,
  university: ServiceKind.University,
  airport: ServiceKind.Airport,
};

const REASONS: Record<string, string> = {
  room_full: "In diesem Raum bauen schon zwei Spieler.",
  bad_room: "Der Raumname braucht mindestens zwei Buchstaben oder Ziffern.",
  level_mismatch: "Dieser Raum läuft auf einem anderen Level.",
  funds: "Für den Rest der Fläche reicht das Geld nicht.",
  locked: "Diese Felder belegt gerade der andere Spieler.",
  empty: "Nichts zu bauen.",
  rejected: "Die Fläche nimmt das so nicht an.",
  no_university: "Studium braucht eine Schule und eine Universität in der Stadt.",
  no_stock: "Dafür reicht das Nahrungslager nicht.",
  no_market: "Dafür braucht die Stadt das passende Gewerbe oder die Industrie.",
};

interface TickMessage {
  t: "tick";
  generation: number;
  cells: Uint8Array;
  meta: SimMeta;
}

export class Game {
  private readonly city: CityState = createCity();
  private readonly camera: RtsCamera;
  private readonly view: CityRenderer;
  private readonly worker: Worker;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly hud = createHud({
    onTool: (tool) => this.setTool(tool),
    onOverlay: (overlay, enabled) => {
      this.overlays[overlay] = enabled;
      this.publish();
    },
    onJoin: (room, name) => this.join(room, name),
    onLeave: () => this.leave(),
    onNewSolo: () => this.startSolo(false),
    onContinue: () => this.startSolo(true),
    onOpenSaved: (code) => this.openSavedCity(code),
    onOpenLobby: () => this.openLobby(),
    onLobbyBack: () => this.closeLobby(),
    onStartLevel: (id) => this.startLevel(id, false),
    onStartLevelCoop: (id) => this.startLevel(id, true),
    onRetryLevel: () => this.retryLevel(),
    onNextLevel: () => this.nextLevel(),
    onOpenLevelSelect: () => this.openLobby(true),
    onToggleBrief: () => this.setBriefOpen(!this.briefOpen),
    onCloseBrief: () => this.setBriefOpen(false),
    onToggleRoster: () => this.setRosterOpen(!this.rosterOpen),
    onToggleChat: () => this.setChatOpen(!this.chatOpen),
    onSendChat: (text) => this.sendChat(text),
    onFocusPlayer: (id) => this.focusPlayer(id),
    onNameReady: (value) => this.acceptName(value),
    onTogglePan: () => this.setPanMode(!this.panMode),
    onCompactPanel: (panel) => this.onCompactPanel(panel),
    onSave: () => {
      void this.saveCurrentCity();
    },
    onDelete: (code) => {
      void this.deleteSavedCity(code);
    },
    onBudget: (value) => this.setBudget(value),
    onGift: () => this.giveScholarship(),
    onHire: (home, slot) => this.hire(home, slot),
    onTrade: (deal) => this.trade(deal),
    onCloseInspect: () => {
      this.focus = null;
      this.hud.hideInspect();
    },
  });

  private socket: Socket | null = null;
  private mode: "single" | "multi" = "single";
  private playKind: "free" | "level" = "free";
  private levelId = 0;
  private levelStartedTick = 0;
  private levelSettled = false;
  private generation = 1;
  private tool: ToolId = "inspect";
  private focus: "cell" | null = null;
  private selected = -1;
  private playing = false;
  private lastSave = 0;
  private building = false;
  private anchor: { x: number; y: number } | null = null;
  private readonly painted = new Set<number>();
  private stroke: number[] = [];
  private readonly denied = new Set<number>();
  private lockSig = "";
  private playerId = "";
  private readonly clientId = loadOrCreateClientId(localStorage, () => crypto.randomUUID());
  private room = "";
  private activeCityId: string | null = null;
  private joinIntent: { room: string; name: string; level?: number } | null = null;
  private joinRetries = 0;
  private lastRoomCodes: string[] = [];
  private lastRooms: { code: string; players: number }[] = [];
  private overlays = { zones: true, power: false, water: false };
  private statusUntil = 0;
  private lastFrame = performance.now();
  private lastLook = 0;
  private briefOpen = true;
  private rosterOpen = false;
  private chatOpen = false;
  private named = false;
  private peers: PublicPlayer[] = [];
  private rosterSig = "";
  private chatLog: ChatMessage[] = [];
  private chatUnread = 0;
  private panMode = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; midX: number; midY: number; distance: number } | null = null;
  private pinched = false;
  private inspectDown: { x: number; y: number } | null = null;
  private lastCursor = 0;
  private readonly remoteCursors = new Map<string, { name: string; x: number; z: number }>();
  private readonly cursorNdc = new THREE.Vector3();
  private peerCursorsPainted = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new RtsCamera();
    this.view = new CityRenderer(canvas);
    this.worker = new Worker(new URL("../sim/sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<TickMessage>) => this.onTick(event.data);
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.hud.setContinueVisible(listCitySlots(localStorage).length > 0);
    this.hud.setLevelUnlock(loadUnlockedLevel());
    this.setBriefOpen(!isCompactHud());
    this.hud.setRosterOpen(false);
    this.hud.setChatOpen(false);
    this.hud.setChatUnread(0);
    this.hud.setChatEnabled(false, "Chat gibt es im Koop.");
    this.hud.setPanMode(false);
    this.hud.setPeerCursors([]);
    const storedName = loadPlayerName();
    if (storedName) {
      this.named = true;
      this.hud.setPlayerName(storedName);
      this.hud.showNameGate(false);
    } else {
      this.hud.setLobby(false);
      this.hud.showNameGate(true);
    }
    this.setTool("inspect");
    onCompactHudChange((compact) => {
      if (compact) {
        this.setBriefOpen(false);
        this.setRosterOpen(false);
        this.setChatOpen(false);
      } else {
        this.setBriefOpen(true);
      }
      this.refreshHint();
    });
    this.rememberWorker(false);
    void this.refreshLobby();
    window.setInterval(() => {
      if (!this.playing || !document.getElementById("lobby")?.hidden) void this.refreshLobby();
    }, 4000);
    this.publish();
    requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    const dt = Math.min(0.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    this.camera.update(dt);
    if (this.mode === "multi" && this.socket && time - this.lastLook > 280) {
      this.lastLook = time;
      this.socket.emit("look", { x: this.camera.target.x, z: this.camera.target.z });
    }
    this.view.update(dt, this.camera.target);
    this.view.render(this.camera.camera);
    this.paintPeerCursors();
    requestAnimationFrame((next) => this.frame(next));
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.view.resize(width, height);
    this.camera.resize(width, height);
  }

  private setTool(tool: ToolId): void {
    this.tool = tool;
    this.hud.setTool(tool);
    this.refreshHint();
    this.cancelStroke(false);
  }

  private setPanMode(on: boolean): void {
    this.panMode = on;
    this.hud.setPanMode(on);
    if (on) this.cancelStroke(false);
    this.refreshHint();
  }

  private refreshHint(): void {
    const compact = isCompactHud();
    const camera = this.panMode
      ? compact
        ? "Ziehen verschiebt die Karte. Zwei Finger zoomen. Nochmal Verschieben beendet den Modus."
        : "Ziehen verschiebt die Karte ohne zu drehen. Nochmal Verschieben beendet den Modus. Mausrad zoomt, Q/E dreht, WASD fährt."
      : compact
        ? "Ein Finger baut oder tippt. Ziehen mit der Lupe verschiebt, zwei Finger zoomen. Verschieben für die Hand."
        : "Rechte Taste schaut um, mittlere Taste oder Verschieben schiebt die Karte, Mausrad zoomt, Q/E dreht, WASD fährt. Escape zurück zur Lupe.";
    this.hud.setHint(`${HINTS[this.tool] ?? "Werkzeug gewählt."} ${camera}`);
  }

  private bindInput(): void {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    window.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.wheel(event.deltaY);
    }, { passive: false });
    window.addEventListener("keydown", (event) => this.onKey(event, true));
    window.addEventListener("keyup", (event) => this.onKey(event, false));
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const tools: Record<string, ToolId> = {
      Digit1: "road",
      Digit2: "bridge",
      Digit3: "cottage",
      Digit4: "shop",
      Digit5: "workshop",
      Digit6: "line",
      Digit7: "bulldoze",
      Digit8: "school",
      Digit9: "university",
      Digit0: "inspect",
    };
    if (down && tools[event.code]) {
      this.setTool(tools[event.code]);
      return;
    }
    if (down && event.code === "Escape") {
      if (this.building) this.cancelStroke(true);
      else {
        this.focus = null;
        this.hud.hideInspect();
        this.setTool("inspect");
      }
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(event.code)) {
      event.preventDefault();
      this.camera.setKey(event.code, down);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      this.cancelStroke(false);
      this.camera.end();
      this.pinched = true;
      const [a, b] = this.pinchPoints();
      this.pinch = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        distance: this.camera.distance,
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (this.camera.begin(event.button, event.clientX, event.clientY, this.panMode)) {
      if (event.button === 0) this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const cell = this.pick(event);
    if (!cell) {
      if (this.tool === "fill") this.flash("Das offene Meer hat keine Felder. Aufschütten geht auf den blauen Feldern an der Küste.");
      return;
    }
    this.anchor = cell;
    if (this.tool === "inspect") {
      this.inspectDown = { x: event.clientX, y: event.clientY };
      if (event.pointerType !== "mouse") this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    this.building = true;
    this.painted.clear();
    this.denied.clear();
    this.updateStroke(cell);
    this.canvas.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      this.movePinch();
      return;
    }
    if (
      this.inspectDown &&
      !this.camera.isDragging() &&
      !this.building &&
      event.pointerType !== "mouse" &&
      this.tool === "inspect"
    ) {
      const dx = event.clientX - this.inspectDown.x;
      const dy = event.clientY - this.inspectDown.y;
      if (Math.hypot(dx, dy) >= 12) {
        this.camera.begin(0, this.inspectDown.x, this.inspectDown.y, true);
        this.camera.move(event.clientX, event.clientY);
      }
    }
    this.camera.move(event.clientX, event.clientY);
    this.emitCursor(event);
    const cell = this.pick(event);
    this.view.setHover(this.city, cell ? cellIndex(this.city, cell.x, cell.y) : null);
    this.describe(cell);
    if (this.building && cell) this.updateStroke(cell);
  }

  private onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (event.type === "pointercancel") {
      this.pinched = this.pointers.size >= 2;
      this.inspectDown = null;
      this.camera.end();
      this.cancelStroke(false);
      this.building = false;
      this.anchor = null;
      return;
    }
    if (this.pinched) {
      if (this.pointers.size === 0) this.pinched = false;
      this.inspectDown = null;
      this.camera.end();
      this.cancelStroke(false);
      return;
    }
    const cameraDrag = this.camera.isDragging();
    this.camera.end();
    this.inspectDown = null;
    if (cameraDrag && event.button === 0) {
      this.cancelStroke(false);
      this.anchor = null;
      return;
    }
    if (event.button !== 0) return;
    if (this.tool === "inspect") {
      const car = this.view.pickCar(this.camera.camera, this.pointer.x, this.pointer.y);
      if (car) this.showCar(car);
      else if (this.anchor) this.showCell(this.anchor);
      this.anchor = null;
      return;
    }
    if (!this.building) return;
    this.building = false;
    this.commit();
  }

  private pinchPoints(): { x: number; y: number }[] {
    return [...this.pointers.values()].slice(0, 2);
  }

  private movePinch(): void {
    if (!this.pinch || this.pointers.size < 2) return;
    const [a, b] = this.pinchPoints();
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (this.pinch.dist > 8 && dist > 8) {
      this.camera.setDistance(this.pinch.distance * (this.pinch.dist / dist));
    }
    this.camera.nudge(midX - this.pinch.midX, midY - this.pinch.midY);
    this.pinch.midX = midX;
    this.pinch.midY = midY;
  }

  private updateStroke(cell: { x: number; y: number }): void {
    if (!this.anchor) return;
    if (this.tool === "bulldoze" || this.tool === "fill") {
      this.stroke = [cellIndex(this.city, cell.x, cell.y)];
    } else if (this.tool === "road" || this.tool === "bridge" || this.tool === "line" || this.tool === "pipe") {
      this.stroke = lineCells(this.city, this.anchor.x, this.anchor.y, cell.x, cell.y);
    } else if (SERVICES[this.tool]) {
      this.stroke = [cellIndex(this.city, this.anchor.x, this.anchor.y)];
    } else if (BUILDINGS[this.tool as keyof typeof BUILDINGS]) {
      this.painted.add(cellIndex(this.city, cell.x, cell.y));
      this.stroke = [...this.painted];
    } else {
      for (const index of brushCells(this.city, cell.x, cell.y, 1)) this.painted.add(index);
      this.stroke = [...this.painted];
    }
    this.refreshPreview();
    this.syncLock();
  }

  private refreshPreview(): void {
    const legal: boolean[] = [];
    let running = 0;
    for (const index of this.stroke) {
      const allowed = this.canUse(index) && !this.denied.has(index);
      const cost = allowed ? this.cost() : 0;
      const accept = allowed && this.city.funds >= running + cost;
      legal.push(accept);
      if (accept) running += cost;
    }
    this.view.setPreview(this.city, this.stroke, legal);
  }

  private commit(): void {
    const preview = this.stroke;
    const legal: number[] = [];
    let running = 0;
    for (const index of preview) {
      if (!this.canUse(index) || this.denied.has(index)) continue;
      const cost = this.cost();
      if (this.city.funds < running + cost) continue;
      legal.push(index);
      running += cost;
    }
    this.stroke = [];
    this.painted.clear();
    this.anchor = null;
    this.lockSig = "";
    this.view.setPreview(this.city, [], []);
    if (this.mode === "multi") this.socket?.emit("unlock");
    if (legal.length === 0) {
      this.flash(this.tool === "fill" ? "Aufschütten nur auf einem blauen Wasserfeld, nicht auf Land oder auf einer Brücke." : "Keine gültige Fläche unter dem Zeiger.");
      return;
    }
    const command = this.command(legal);
    const result = applyCommand(this.city, command);
    if (result.applied.length > 0) refreshUtilities(this.city);
    if (this.mode === "single") this.rememberWorker(true);
    this.publish();
    if (this.mode === "multi") this.socket?.emit("command", { id: crypto.randomUUID(), command });
    if (!result.ok) this.flash(REASONS[result.reason ?? "rejected"] ?? "Die Aktion wurde abgelehnt.");
    else if (result.reason) this.flash(REASONS[result.reason] ?? result.reason);
    if (result.bonus) this.flash(`Nachfrage zahlt ${result.bonus.toLocaleString("de-DE")} € zurück.`);
    if (result.applied.length > 0 && (SERVICES[this.tool] || BUILDINGS[this.tool as keyof typeof BUILDINGS])) this.setTool("inspect");
  }

  private canUse(index: number): boolean {
    if (this.tool === "inspect") return false;
    if (this.tool === "road") return canPlace(this.city, index, "road");
    if (this.tool === "bridge") return canPlace(this.city, index, "bridge");
    if (this.tool === "fill") return canPlace(this.city, index, "fill");
    if (BUILDINGS[this.tool as keyof typeof BUILDINGS]) return canPlace(this.city, index, "build");
    if (this.tool === "line") return canPlace(this.city, index, "line");
    if (this.tool === "pipe") return canPlace(this.city, index, "pipe");
    if (this.tool === "bulldoze") return canPlace(this.city, index, "bulldoze");
    const kind = SERVICES[this.tool];
    if (kind) return canPlace(this.city, index, "service", { kind });
    return false;
  }

  private cost(): number {
    if (this.tool === "road") return COST.road;
    if (this.tool === "bridge") return COST.bridge;
    if (this.tool === "fill") return COST.fill;
    const building = BUILDINGS[this.tool as keyof typeof BUILDINGS];
    if (building) return building.cost;
    if (this.tool === "line") return COST.line;
    if (this.tool === "pipe") return COST.pipe;
    if (this.tool === "bulldoze" || this.tool === "inspect") return 0;
    return serviceInfo(SERVICES[this.tool] ?? 0)?.cost ?? COST.zone;
  }

  private command(cells: number[]): Command {
    if (this.tool === "road") return { type: "road", cells };
    if (this.tool === "bridge") return { type: "bridge", cells };
    if (this.tool === "fill") return { type: "fill", cells };
    const building = BUILDINGS[this.tool as keyof typeof BUILDINGS];
    if (building) return { type: "build", cells, kind: building.id };
    if (this.tool === "line") return { type: "line", cells };
    if (this.tool === "pipe") return { type: "pipe", cells };
    if (this.tool === "bulldoze") return { type: "bulldoze", cells };
    const index = cells[0] ?? 0;
    const kind = SERVICES[this.tool];
    if (kind) return { type: "service", index, kind };
    return { type: "zone", cells, zone: Zone.Residential };
  }

  private cancelStroke(announce: boolean): void {
    this.building = false;
    this.anchor = null;
    this.painted.clear();
    this.stroke = [];
    this.lockSig = "";
    this.view.setPreview(this.city, [], []);
    if (this.mode === "multi") this.socket?.emit("unlock");
    if (announce) this.flash("Bau abgebrochen.");
  }

  private syncLock(): void {
    if (this.mode !== "multi" || !this.socket) return;
    const signature = this.stroke.join(",");
    if (signature === this.lockSig) return;
    this.lockSig = signature;
    this.socket.emit("lock", { cells: this.stroke });
  }

  private join(room: string, name: string, level?: number): void {
    this.leaveSocket();
    this.joinIntent = { room, name, level };
    const socket = io(socketUrl(), { reconnection: true, reconnectionDelay: 800, reconnectionAttempts: Infinity });
    this.socket = socket;
    socket.on("connect", () => {
      if (!this.joinIntent) return;
      socket.emit("join", {
        room: this.joinIntent.room,
        name: this.joinIntent.name,
        level: this.joinIntent.level,
        clientId: this.clientId,
      });
    });
    socket.on("connect_error", () => this.flash(isDevServer ? "Server nicht erreichbar. Starte ihn auf Port 8787." : "Server nicht erreichbar. Versuch es gleich noch einmal."));
    socket.on("disconnect", (reason) => {
      if (!this.joinIntent || reason === "io client disconnect") return;
      this.flash("Verbindung unterbrochen. Verbinde neu…");
    });
    socket.on("replaced", () => {
      this.joinIntent = null;
      this.flash("Dieser Platz wird in einem anderen Fenster genutzt.");
      this.leave();
    });
    socket.on("joinError", (payload: { reason?: string }) => {
      if (payload.reason === "room_full" && this.joinIntent && this.joinRetries < 6) {
        this.joinRetries += 1;
        window.setTimeout(() => {
          if (this.socket === socket && this.joinIntent && socket.connected) {
            socket.emit("join", {
              room: this.joinIntent.room,
              name: this.joinIntent.name,
              level: this.joinIntent.level,
              clientId: this.clientId,
            });
          }
        }, 350);
        return;
      }
      this.flash(REASONS[payload.reason ?? ""] ?? "Beitritt abgelehnt.");
      this.joinIntent = null;
      this.leaveSocket();
    });
    socket.on("welcome", (payload: WelcomePayload) => {
      this.joinRetries = 0;
      this.mode = "multi";
      this.playerId = payload.playerId;
      this.room = payload.room;
      this.playing = true;
      this.hud.setJoined(true);
      this.hud.setLobby(false);
      this.hud.setLobbyBackVisible(true);
      this.hud.setRoomName(payload.room);
      if (payload.level) {
        this.enterLevel(payload.level, `Koop Level ${payload.level} · ${payload.room}`);
      } else {
        this.clearLevel();
        this.activeCityId = payload.room;
        this.hud.setMode(`Koop · ${payload.room}`);
        this.lastSave = performance.now();
      }
      this.renderPlayers(payload.players);
      this.loadChat(payload.chat);
      this.rememberWorker(false);
      this.setBriefOpen(!isCompactHud());
      this.flash(payload.level ? "Level-Koop verbunden. Ihr baut an derselben Aufgabe." : "Verbunden. Bauaktionen laufen über den Server.");
    });
    socket.on("state", (payload: StatePayload) => {
      if (this.mode !== "multi") return;
      const cells = asUint8Array(payload.cells);
      if (!cells) return;
      writeCity(this.city, cells, payload.meta);
      if (payload.level) this.applyLevelSync(payload.level);
      this.publish(payload.meta);
    });
    socket.on("players", (payload: { players: PublicPlayer[] }) => this.renderPlayers(payload.players));
    socket.on("chat", (payload: unknown) => {
      const message = parseChatMessage(payload);
      if (message) this.receiveChat(message, false);
    });
    socket.on("cursor", (payload: unknown) => {
      const cursor = parseCursor(payload);
      if (!cursor || cursor.playerId === this.playerId) return;
      this.remoteCursors.set(cursor.playerId, { name: cursor.name, x: cursor.x, z: cursor.z });
    });
    socket.on("cursorGone", (payload: unknown) => {
      const playerId = typeof (payload as { playerId?: unknown })?.playerId === "string"
        ? (payload as { playerId: string }).playerId
        : "";
      if (playerId) this.remoteCursors.delete(playerId);
    });
    socket.on("locks", (payload: LockSnapshot) => {
      const foreign = payload.locks.filter((lock) => lock.playerId !== this.playerId).map((lock) => lock.cell);
      this.view.setLocks(this.city, foreign);
    });
    socket.on("lockResult", (payload: { denied: number[] }) => {
      this.denied.clear();
      for (const index of payload.denied) this.denied.add(index);
      if (this.stroke.length > 0) this.refreshPreview();
    });
    socket.on("commandResult", (result: CommandResult) => {
      if (!result.ok) this.flash(REASONS[result.reason ?? "rejected"] ?? "Die Aktion wurde abgelehnt.");
      else if (result.reason) this.flash(REASONS[result.reason] ?? result.reason);
    });
  }

  private leave(): void {
    const wasMulti = this.mode === "multi";
    this.joinIntent = null;
    this.joinRetries = 0;
    this.leaveSocket();
    this.mode = "single";
    this.playerId = "";
    this.room = "";
    this.view.setLocks(this.city, []);
    this.hud.setJoined(false);
    this.hud.setMode("Singleplayer");
    this.hud.setPlayers("");
    this.peers = [];
    this.rosterSig = "";
    this.remoteCursors.clear();
    this.hud.setPeerCursors([]);
    this.view.setPeers([]);
    this.hud.setRoster([], "Du spielst allein.");
    this.resetChat();
    this.hud.setLobbyBackVisible(this.playing);
    if (wasMulti) {
      this.rememberWorker(true);
      this.flash("Getrennt. Diese Stadt läuft jetzt lokal weiter.");
    }
  }

  private leaveSocket(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.resetChat();
  }

  private renderPlayers(players: PublicPlayer[]): void {
    this.peers = players;
    const living = new Set(players.map((player) => player.id));
    for (const id of [...this.remoteCursors.keys()]) {
      if (!living.has(id)) this.remoteCursors.delete(id);
    }
    this.view.setPeers(
      players
        .filter((player) => player.id !== this.playerId)
        .map((player) => ({ x: player.lookX, z: player.lookZ })),
    );
    const signature = players.map((player) => `${player.id}:${player.name}`).join("|");
    if (signature === this.rosterSig) return;
    this.rosterSig = signature;
    if (players.length === 0) {
      this.hud.setPlayers("");
      this.hud.setRoster([], "Niemand ist verbunden.");
      return;
    }
    this.hud.setPlayers(players.length > 1 ? `${players.length}/2 verbunden` : `${players.length}/2 wartet`);
    this.hud.setRoster(
      players.map((player) => ({
        id: player.id,
        name: player.name,
        self: player.id === this.playerId,
        present: true,
      })),
      players.length > 1 ? "Ihr seid zu zweit in diesem Raum." : "Noch warte auf die zweite Person.",
    );
    if (this.mode === "multi") {
      this.hud.setChatEnabled(
        true,
        players.length > 1 ? "Ihr schreibt in diesem Raum." : "Noch warte auf die zweite Person.",
      );
    }
  }

  private onTick(message: TickMessage): void {
    if (message.t !== "tick" || this.mode !== "single" || message.generation !== this.generation) return;
    const cells = asUint8Array(message.cells);
    if (!cells) return;
    writeCity(this.city, cells, message.meta);
    this.publish(message.meta);
    if (this.stroke.length > 0) this.refreshPreview();
  }

  private rememberWorker(running: boolean): void {
    this.generation += 1;
    const meta = buildMeta(this.city);
    this.worker.postMessage({
      t: "reset",
      generation: this.generation,
      running,
      cells: packCells(this.city),
      meta,
    });
  }

  private publish(meta: SimMeta = buildMeta(this.city)): void {
    this.hud.setStats(meta);
    this.view.sync(this.city, this.overlays);
    if (this.playKind === "level") this.syncLevel();
    else this.maybeAutoSave();
    if (this.focus === "cell" && this.selected >= 0) this.showCell(cellCoords(this.city, this.selected));
  }

  private maybeAutoSave(): void {
    if (!this.playing || this.playKind === "level") return;
    if (!this.activeCityId) return;
    if (performance.now() - this.lastSave < AUTO_SAVE_MS) return;
    this.lastSave = performance.now();
    if (this.persistActiveCity()) this.hud.showSaveToast("Stadt gespeichert");
  }

  private describe(cell: { x: number; y: number } | null): void {
    if (performance.now() < this.statusUntil) return;
    if (!cell) {
      this.hud.setStatus(this.mode === "multi" ? `Koopraum ${this.room}` : "Bereit zum Bauen.");
      return;
    }
    const index = cellIndex(this.city, cell.x, cell.y);
    const parts = [`Feld ${cell.x}, ${cell.y}`];
    if (isRoad(this.city, index)) parts.push("Straße");
    if (isLine(this.city, index)) parts.push((this.city.utility[index] & POWER_BIT) !== 0 ? "Stromleitung aktiv" : "Stromleitung ohne Strom");
    if (isPipe(this.city, index)) parts.push((this.city.utility[index] & WATER_BIT) !== 0 ? "Rohr mit Wasser" : "Rohr ohne Wasser");
    const service = serviceInfo(this.city.services[index]);
    if (service) parts.push(service.name);
    if (this.city.zones[index] === Zone.Residential) parts.push(`Wohnen Stufe ${this.city.levels[index]}`);
    if (this.city.zones[index] === Zone.Commercial) parts.push(`Gewerbe Stufe ${this.city.levels[index]}`);
    if (this.city.zones[index] === Zone.Industrial) parts.push(`Industrie Stufe ${this.city.levels[index]}`);
    if (this.city.zones[index] === Zone.Farm) parts.push("Bauernhof");
    parts.push((this.city.utility[index] & POWER_BIT) !== 0 ? "Strom" : "kein Strom");
    parts.push((this.city.utility[index] & WATER_BIT) !== 0 ? "Wasser" : "kein Wasser");
    this.hud.setStatus(parts.join(" · "));
  }

  private flash(text: string): void {
    this.statusUntil = performance.now() + 2600;
    this.hud.setStatus(text);
  }

  private emitCursor(event: PointerEvent): void {
    if (this.mode !== "multi" || !this.socket) return;
    const now = performance.now();
    if (now - this.lastCursor < 50) return;
    this.lastCursor = now;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera.camera);
    const point = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    if (!point) return;
    this.socket.emit("cursor", { x: point.x, z: point.z });
  }

  private paintPeerCursors(): void {
    if (this.mode !== "multi" || this.remoteCursors.size === 0) {
      if (this.peerCursorsPainted) {
        this.hud.setPeerCursors([]);
        this.peerCursorsPainted = false;
      }
      return;
    }
    this.peerCursorsPainted = true;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const marks: { id: string; name: string; x: number; y: number }[] = [];
    for (const [id, cursor] of this.remoteCursors) {
      this.cursorNdc.set(cursor.x, 6, cursor.z).project(this.camera.camera);
      if (this.cursorNdc.z < -1 || this.cursorNdc.z > 1) continue;
      marks.push({
        id,
        name: cursor.name,
        x: (this.cursorNdc.x * 0.5 + 0.5) * width,
        y: (-this.cursorNdc.y * 0.5 + 0.5) * height,
      });
    }
    this.hud.setPeerCursors(marks);
  }

  private pick(event: PointerEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera.camera);
    const point = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    if (!point) return null;
    if (this.tool === "fill") return this.fillTarget(point.x, point.z);
    return worldToCell(this.city, point.x, point.z);
  }

  private fillTarget(worldX: number, worldZ: number): { x: number; y: number } | null {
    const direct = worldToCell(this.city, worldX, worldZ);
    if (direct && canPlace(this.city, cellIndex(this.city, direct.x, direct.y), "fill")) return direct;
    const cx = worldX / CELL_SIZE + this.city.width / 2;
    const cy = worldZ / CELL_SIZE + this.city.height / 2;
    let best: { x: number; y: number } | null = null;
    let bestDistance = 1.4;
    for (let y = Math.floor(cy) - 1; y <= Math.ceil(cy) + 1; y += 1) {
      for (let x = Math.floor(cx) - 1; x <= Math.ceil(cx) + 1; x += 1) {
        if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
        if (x < 0 || y < 0 || x >= this.city.width || y >= this.city.height) continue;
        if (!canPlace(this.city, cellIndex(this.city, x, y), "fill")) continue;
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (distance < bestDistance) {
          best = { x, y };
          bestDistance = distance;
        }
      }
    }
    return best ?? direct;
  }

  private startSolo(load: boolean): void {
    if (load) {
      const id = getActiveCityId(localStorage) ?? listCitySlots(localStorage)[0]?.id;
      if (!id) {
        this.flash("Keine gespeicherte Stadt.");
        return;
      }
      this.loadLocalCity(id);
      return;
    }
    const typed = this.hud.roomName().trim();
    const taken = this.knownCodes();
    const id = allocateCityCode(typed, taken);
    if (!id) {
      this.flash("Der Name braucht mindestens zwei Buchstaben oder Ziffern.");
      return;
    }
    this.joinIntent = null;
    this.leaveSocket();
    this.clearLevel();
    this.mode = "single";
    this.playing = true;
    this.activeCityId = id;
    this.hud.setRoomName(id);
    this.hud.setJoined(false);
    this.hud.setMode("Singleplayer");
    this.hud.setPlayers("");
    this.hud.setLobby(false);
    this.hud.setLobbyBackVisible(true);
    this.setBriefOpen(!isCompactHud());
    const fresh = createCity();
    writeCity(this.city, packCells(fresh), buildMeta(fresh));
    refreshUtilities(this.city);
    this.persistActiveCity(typed || id);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.lastSave = performance.now();
    this.publish();
    void this.refreshLobby();
  }

  private loadLocalCity(id: string): void {
    const save = loadCitySlot(id, localStorage);
    const loaded = save ? saveToCity(save) : null;
    if (!loaded) {
      this.flash("Diese Stadt ließ sich nicht laden.");
      return;
    }
    this.joinIntent = null;
    this.leaveSocket();
    this.clearLevel();
    this.mode = "single";
    this.playing = true;
    this.activeCityId = id;
    this.hud.setRoomName(id);
    this.hud.setJoined(false);
    this.hud.setMode("Singleplayer");
    this.hud.setPlayers("");
    this.hud.setLobby(false);
    this.hud.setLobbyBackVisible(true);
    this.setBriefOpen(!isCompactHud());
    writeCity(this.city, packCells(loaded), buildMeta(loaded));
    refreshUtilities(this.city);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.lastSave = performance.now();
    this.publish();
  }

  private openSavedCity(code: string): void {
    const live = this.lastRooms.find((entry) => entry.code === code && entry.players > 0);
    if (live) {
      this.join(code, this.hud.playerName());
      return;
    }
    if (loadCitySlot(code, localStorage)) {
      this.loadLocalCity(code);
      return;
    }
    this.join(code, this.hud.playerName());
  }

  private knownCodes(): string[] {
    return [...new Set([...listCitySlots(localStorage).map((slot) => slot.id), ...this.lastRoomCodes])];
  }

  private persistActiveCity(displayName?: string): boolean {
    if (this.playKind === "level" || !this.activeCityId) return false;
    const id = this.activeCityId;
    const existing = loadCitySlot(id, localStorage);
    const name = (displayName && displayName.trim()) || existing?.name || id;
    const save = cityToSave(this.city, name, id);
    if (!writeCitySlot(id, save, localStorage)) return false;
    this.hud.setContinueVisible(true);
    if (this.mode === "single") void this.pushCityToServer(save);
    return true;
  }

  private async pushCityToServer(save: CitySave): Promise<string | null> {
    try {
      const response = await fetch(apiUrl("/api/cities"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(save),
      });
      const body = (await response.json()) as { ok?: boolean; code?: string };
      if (!response.ok || !body.ok || !body.code) return null;
      return body.code;
    } catch {
      return null;
    }
  }

  private startLevel(id: number, coop: boolean): void {
    const level = levelById(id);
    if (!level) return;
    if (!isLevelOpen(id, loadUnlockedLevel())) {
      this.flash("Dieses Level ist noch gesperrt.");
      return;
    }
    if (coop) {
      const tag = this.hud.roomName();
      const code = levelRoomCode(id, tag);
      if (!code) {
        this.flash("Für Koop braucht der Stadtname mindestens zwei Buchstaben oder Ziffern.");
        return;
      }
      this.join(tag, this.hud.playerName(), id);
      return;
    }
    this.leaveSocket();
    this.mode = "single";
    this.playing = true;
    const fresh = createLevelCity(level);
    writeCity(this.city, packCells(fresh), buildMeta(fresh));
    refreshUtilities(this.city);
    this.enterLevel(id, `Level ${id} · ${level.title}`);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.publish();
    this.flash(`Aufgabe: ${level.blurb}`);
  }

  private enterLevel(id: number, mode: string): void {
    this.playKind = "level";
    this.activeCityId = null;
    this.levelId = id;
    this.levelSettled = false;
    this.levelStartedTick = this.city.tick;
    this.hud.hideLevelEnd();
    this.hud.setPlayKind("level");
    this.hud.setMode(mode);
    this.hud.setLobby(false);
    this.hud.setLobbyBackVisible(true);
    this.hud.setLevelUnlock(loadUnlockedLevel(), id);
    this.setBriefOpen(!isCompactHud());
  }

  private applyLevelSync(sync: LevelSync): void {
    this.playKind = "level";
    this.levelId = sync.id;
    this.levelStartedTick = sync.startedTick;
    this.hud.setPlayKind("level");
    if (sync.outcome === "won" && !this.levelSettled) this.finishLevel(true);
    else if (sync.outcome === "lost" && !this.levelSettled) this.finishLevel(false);
    else if (sync.outcome === "playing" && this.levelSettled) {
      this.levelSettled = false;
      this.hud.hideLevelEnd();
    }
  }

  private retryLevel(): void {
    if (this.levelId <= 0) return;
    if (this.mode === "multi") {
      this.socket?.emit("levelReset");
      this.levelSettled = false;
      this.hud.hideLevelEnd();
      return;
    }
    this.startLevel(this.levelId, false);
  }

  private nextLevel(): void {
    if (this.levelId <= 0 || this.levelId >= LEVEL_COUNT) return;
    const next = this.levelId + 1;
    if (this.mode === "multi") {
      const parsed = parseLevelRoom(this.room);
      const tag = parsed?.tag ?? this.hud.roomName();
      this.join(tag, this.hud.playerName(), next);
      return;
    }
    this.startLevel(next, false);
  }

  private syncLevel(): void {
    const level = levelById(this.levelId);
    if (!level) return;
    const status = evaluateLevel(level, this.city, this.levelStartedTick);
    this.hud.setLevelBrief(status);
    if (this.mode === "multi") return;
    if (this.levelSettled) return;
    if (status.won) this.finishLevel(true);
    else if (status.failed) this.finishLevel(false);
  }

  private finishLevel(won: boolean): void {
    this.levelSettled = true;
    if (this.mode === "single") this.rememberWorker(false);
    const level = levelById(this.levelId);
    if (!level) return;
    this.setBriefOpen(true);
    if (won) {
      const unlocked = unlockAfterWin(level.id);
      this.hud.setLevelUnlock(unlocked, level.id);
      this.hud.showLevelEnd({
        won: true,
        title: "Level geschafft",
        text: level.id >= LEVEL_COUNT
          ? "Alle zehn Level sind geschafft. Du kannst sie jederzeit nochmal spielen."
          : `${level.title} ist geschafft. Das nächste Level ist frei.`,
        next: level.id < LEVEL_COUNT,
      });
      this.flash("Level geschafft.");
      return;
    }
    this.hud.showLevelEnd({
      won: false,
      title: "Zeit abgelaufen",
      text: "Die Aufgabe ist in der Zeit nicht fertig geworden. Nochmal versuchen oder zurück zur Levelwahl.",
      next: false,
    });
    this.flash("Zeit abgelaufen.");
  }

  private clearLevel(): void {
    this.playKind = "free";
    this.levelId = 0;
    this.levelStartedTick = 0;
    this.levelSettled = false;
    this.hud.setPlayKind("free");
    this.hud.hideLevelEnd();
  }

  private setBriefOpen(open: boolean): void {
    this.briefOpen = open;
    this.hud.setBriefOpen(open);
    if (open) this.shrinkCompactHud("brief");
  }

  private setRosterOpen(open: boolean): void {
    if (open) {
      this.focus = null;
      this.hud.hideInspect();
      this.chatOpen = false;
      this.hud.setChatOpen(false);
      this.shrinkCompactHud("roster");
    }
    this.rosterOpen = open;
    this.hud.setRosterOpen(open);
  }

  private setChatOpen(open: boolean): void {
    if (open) {
      this.focus = null;
      this.hud.hideInspect();
      this.rosterOpen = false;
      this.hud.setRosterOpen(false);
      this.chatUnread = 0;
      this.hud.setChatUnread(0);
      this.shrinkCompactHud("chat");
    }
    this.chatOpen = open;
    this.hud.setChatOpen(open);
  }

  private onCompactPanel(panel: "menu" | "demand" | "stats"): void {
    if (!isCompactHud()) return;
    if (panel === "stats") return;
    this.briefOpen = false;
    this.hud.setBriefOpen(false);
    this.chatOpen = false;
    this.hud.setChatOpen(false);
    this.rosterOpen = false;
    this.hud.setRosterOpen(false);
    this.focus = null;
    this.hud.hideInspect();
    if (panel === "menu") this.hud.setDemandOpen(false);
    if (panel === "demand") this.hud.setMenuOpen(false);
  }

  private shrinkCompactHud(keep: "brief" | "roster" | "chat" | "inspect"): void {
    if (!isCompactHud()) return;
    this.hud.setDemandOpen(false);
    this.hud.setStatsOpen(false);
    if (keep !== "brief") {
      this.briefOpen = false;
      this.hud.setBriefOpen(false);
    }
    if (keep === "chat" || keep === "roster" || keep === "inspect") this.hud.setMenuOpen(false);
  }

  private sendChat(value: string): void {
    const text = cleanChat(value);
    if (!text) return;
    if (this.mode !== "multi" || !this.socket) {
      this.flash("Chat gibt es im Koop.");
      return;
    }
    this.socket.emit("chat", { text });
  }

  private loadChat(raw: ChatMessage[] | undefined): void {
    this.chatLog = [];
    this.chatUnread = 0;
    for (const entry of raw ?? []) {
      const message = parseChatMessage(entry);
      if (message) this.receiveChat(message, true);
    }
    this.hud.setChatUnread(0);
    this.hud.setChatMessages(this.chatLog, this.playerId);
  }

  private receiveChat(message: ChatMessage, fromHistory: boolean): void {
    if (this.chatLog.some((entry) => entry.id === message.id)) return;
    this.chatLog.push(message);
    this.hud.setChatMessages(this.chatLog, this.playerId);
    if (!fromHistory && !this.chatOpen && message.playerId !== this.playerId) {
      this.chatUnread += 1;
      this.hud.setChatUnread(this.chatUnread);
    }
  }

  private resetChat(): void {
    this.chatLog = [];
    this.chatUnread = 0;
    this.chatOpen = false;
    this.hud.setChatOpen(false);
    this.hud.setChatMessages([], "");
    this.hud.setChatUnread(0);
    this.hud.setChatEnabled(false, "Chat gibt es im Koop.");
  }

  private focusPlayer(id: string): void {
    const peer = this.peers.find((entry) => entry.id === id);
    if (!peer) {
      this.flash("Die Person ist gerade nicht da.");
      return;
    }
    this.camera.lookAt(peer.lookX, peer.lookZ);
    this.setRosterOpen(false);
    this.flash(`${peer.name} ist hier.`);
  }

  private acceptName(value: string): void {
    const clean = savePlayerName(value);
    if (!clean) {
      this.hud.showNameGate(true);
      this.hud.setGateError("Bitte einen Namen eingeben.");
      return;
    }
    this.named = true;
    this.hud.setPlayerName(clean);
    this.hud.setGateError("");
    this.hud.showNameGate(false);
    if (!this.playing) {
      this.hud.setLobby(true);
      void this.refreshLobby();
    }
  }

  private openLobby(fromLevelEnd = false): void {
    if (!this.named) {
      this.hud.showNameGate(true);
      return;
    }
    this.hud.setLobby(true);
    this.hud.setLobbyBackVisible(this.playing && (!fromLevelEnd || !this.levelSettled));
    this.hud.setLevelUnlock(loadUnlockedLevel(), this.levelId || null);
    if (fromLevelEnd) this.hud.hideLevelEnd();
    if (this.playKind === "level" && this.mode === "single" && !this.levelSettled) this.rememberWorker(false);
    void this.refreshLobby();
  }

  private closeLobby(): void {
    this.hud.setLobby(false);
    if (this.playKind === "level" && this.mode === "single" && !this.levelSettled) this.rememberWorker(true);
  }

  private async refreshLobby(): Promise<void> {
    const local = listCitySlots(localStorage).map((slot) => ({
      code: slot.id,
      name: slot.name,
      players: 0,
      population: slot.population,
      funds: slot.funds,
      level: null as number | null,
    }));
    let remote: { code: string; name?: string; players: number; population: number; funds: number; level?: number | null }[] = [];
    try {
      const [rooms, host] = await Promise.all([
        fetch(apiUrl("/api/rooms"), { cache: "no-store" }).then((response) => response.json() as Promise<{ code: string; name?: string; players: number; population: number; funds: number; level?: number | null }[]>),
        fetch(apiUrl("/api/host")).then((response) => response.json() as Promise<{ urls: string[] }>),
      ]);
      remote = rooms;
      this.lastRoomCodes = rooms.map((entry) => entry.code);
      this.lastRooms = rooms.map((entry) => ({ code: entry.code, players: entry.players }));
      if (isDevServer) {
        const localHost = host.urls.length > 0 ? host.urls.join(", ") : `http://${location.host}`;
        this.hud.setHost(`Im gleichen Netzwerk öffnen andere Geräte ${localHost}. Aus einem anderen WLAN ist dieser Rechner nicht erreichbar.`);
      } else {
        this.hud.setHost(`Freunde öffnen ${location.origin}. Freie Städte teilt ihr über den Stadtnamen, Level über l3-stadtname.`);
      }
    } catch {
      this.hud.setHost(isDevServer ? "Der Koop-Server antwortet nicht. Eine lokale Stadt geht trotzdem. Koop braucht den Server auf diesem Rechner, Port 8787." : "Der Koop-Server antwortet gerade nicht. Eine lokale Stadt geht trotzdem.");
    }
    this.hud.setRooms(mergeRoomLists(local, remote));
    this.hud.setContinueVisible(local.length > 0);
  }

  private async deleteSavedCity(code: string): Promise<void> {
    deleteCitySlot(code, localStorage);
    if (this.activeCityId === code) this.activeCityId = getActiveCityId(localStorage);
    try {
      const response = await fetch(apiUrl(`/api/cities/${encodeURIComponent(code)}`), { method: "DELETE" });
      const body = (await response.json()) as { ok?: boolean; reason?: string };
      if (!response.ok || !body.ok) {
        if (body.reason === "in_use") {
          this.hud.setSaveNote("Die Stadt ist gerade im Koop offen.");
          return;
        }
        if (body.reason === "missing") {
          this.hud.setSaveNote(`„${code}“ ist lokal gelöscht.`);
          await this.refreshLobby();
          return;
        }
        this.hud.setSaveNote("Die Stadt ließ sich nicht löschen.");
        return;
      }
      this.hud.setSaveNote(`„${code}“ ist gelöscht.`);
      await this.refreshLobby();
    } catch {
      this.hud.setSaveNote(`„${code}“ ist lokal gelöscht.`);
      await this.refreshLobby();
    }
  }

  private async saveCurrentCity(): Promise<void> {
    if (this.playKind === "level") {
      this.hud.setSaveNote("Im Level-Modus gibt es keinen Speicherstand.");
      return;
    }
    if (!this.activeCityId) {
      const id = allocateCityCode(this.hud.roomName(), this.knownCodes());
      if (!id) {
        this.hud.setSaveNote("Der Name braucht mindestens zwei Buchstaben oder Ziffern.");
        return;
      }
      this.activeCityId = id;
      this.hud.setRoomName(id);
    }
    const existing = loadCitySlot(this.activeCityId, localStorage);
    const typed = this.hud.roomName().trim();
    const display = existing?.name || typed || this.activeCityId;
    if (!this.persistActiveCity(display)) {
      this.hud.setSaveNote("Diese Stadt wurde nicht überschrieben.");
      return;
    }
    const save = loadCitySlot(this.activeCityId, localStorage);
    const code = save ? await this.pushCityToServer(save) : null;
    if (!code) {
      this.hud.setSaveNote("Lokal gesichert. Der Koop-Server hat die Stadt nicht übernommen.");
      await this.refreshLobby();
      return;
    }
    this.hud.setSaveNote(`„${display}“ ist gespeichert (${code}), inklusive Straßen, Leitungen, Zonen, Gebäuden, Bildung und Kasse. Im Koop öffnen lädt genau diese Stadt.`);
    await this.refreshLobby();
  }

  private showCell(cell: { x: number; y: number }): void {
    const index = cellIndex(this.city, cell.x, cell.y);
    this.selected = index;
    this.focus = "cell";
    const families = houseReport(this.city, index);
    const service = serviceInfo(this.city.services[index]);
    const powered = (this.city.utility[index] & POWER_BIT) !== 0;
    const watered = (this.city.utility[index] & WATER_BIT) !== 0;
    const workplace = isWorkplace(this.city, index);
    const farm = workplace && this.city.zones[index] === Zone.Farm;
    const airport = service?.kind === ServiceKind.Airport;
    const occupied = this.city.levels[index] > 0 || this.city.services[index] !== ServiceKind.None;
    const gifted = (this.city.skills[index] & 4) !== 0;
    const unemployedHere = families.some((family) => family.members.some((member) => member.unemployed));
    const staff = workplace ? employeesAt(this.city, index) : [];
    const openings = workplace ? jobOpenings(this.city, index) : 0;
    const seeking = workplace && openings > 0 ? unemployedAdults(this.city).slice(0, 8) : [];
    const school = families.length > 0 && serviceNearby(this.city, index, ServiceKind.School);
    const university = families.length > 0 && serviceNearby(this.city, index, ServiceKind.University);
    const meals = foodRatio(this.city);
    const harvest = farm ? farmYield(this.city, index, staff.length) : 0;
    this.setRosterOpen(false);
    this.setChatOpen(false);
    this.shrinkCompactHud("inspect");
    this.hud.showInspect({
      kind: service?.kind === ServiceKind.Power ? "power" : service?.kind === ServiceKind.Water ? "water" : airport ? "airport" : farm ? "farm" : workplace ? "work" : families.length > 0 ? "home" : "field",
      kicker: airport ? "Verkehr" : farm ? "Landwirtschaft" : service ? "Gebäude" : workplace ? (this.city.zones[index] === Zone.Industrial ? "Industrie" : "Gewerbe") : families.length > 0 ? "Wohnhaus" : "Feld",
      title: service?.name ?? (farm ? BUILDINGS.farm.name : families.length > 0 || workplace ? `Stufe ${this.city.levels[index]}` : `${cell.x}, ${cell.y}`),
      stats: [
        { icon: "bolt", label: "Strom", value: powered ? "versorgt" : "ohne", tone: powered ? "good" : "bad" },
        { icon: "drop", label: "Wasser", value: watered ? "versorgt" : "ohne", tone: watered ? "good" : "bad" },
        ...(families.length > 0 ? [
          { icon: "people" as const, label: "Bewohner", value: String(families.reduce((sum, family) => sum + family.members.length, 0)) },
          { icon: "car" as const, label: "Autos", value: String(families.reduce((sum, family) => sum + family.cars.length, 0)) },
          { icon: "food" as const, label: "Nahrung", value: meals >= 1 ? "satt" : "knapp", tone: meals >= 1 ? "good" as const : "bad" as const },
          { icon: "book" as const, label: "Schule", value: school ? "im Viertel" : "fehlt", tone: school ? "good" as const : "bad" as const },
          { icon: "book" as const, label: "Universität", value: university ? "im Viertel" : "fehlt", tone: university ? "good" as const : "bad" as const },
        ] : []),
        ...(workplace ? [
          { icon: "work" as const, label: "Frei", value: String(openings) },
          { icon: "people" as const, label: "Belegt", value: String(staff.length) },
        ] : []),
        ...(farm ? [
          { icon: "food" as const, label: "Nahrung", value: staff.length === 0 ? "ohne Arbeiter 0" : `${harvest} von ${staff.length} Arbeitern`, tone: harvest > 0 ? "good" as const : "bad" as const },
        ] : []),
        ...(airport ? [
          { icon: "plane" as const, label: "Ertrag", value: "260 € / 2 s" },
          { icon: "food" as const, label: "Lager", value: String(this.city.food) },
        ] : []),
      ],
      families: families.map((family) => ({
        surname: family.surname,
        cars: family.cars.map((car) => car.label),
        members: family.members.map((member) => ({
          name: member.name,
          child: member.child,
          education: member.educationLabel,
          job: member.child ? "kein Beruf" : member.job,
          unemployed: member.unemployed,
        })),
      })),
      hires: seeking.map((adult) => ({
        name: adult.name,
        detail: `${adult.educationLabel} · Feld ${cellCoords(this.city, adult.home).x},${cellCoords(this.city, adult.home).y}`,
        home: adult.home,
        slot: adult.slot,
      })),
      trade: airport ? TRADE.map((deal) => ({
        id: deal.id,
        name: deal.name,
        side: deal.side,
        detail: deal.blurb,
        price: `${deal.price.toLocaleString("de-DE")} €`,
        enabled: this.canTrade(deal.id),
      })) : [],
      note: farm
        ? [staff.length > 0 ? `Arbeiter: ${staff.map((adult) => adult.name).join(", ")}. Nahrung ${harvest}.` : "Ohne Arbeiter wächst hier fast nichts.", "Am Anfang braucht die Stadt kaum Nahrung; ein besetzter Hof reicht lange.", seeking.length > 0 ? "Arbeitslose anstellen." : ""].filter(Boolean).join(" ")
        : service?.blurb
        ?? (workplace ? [staff.length > 0 ? `Beschäftigt: ${staff.map((adult) => adult.name).join(", ")}` : "Noch niemand angestellt.", seeking.length > 0 ? "Arbeitslose aus der Stadt anstellen." : ""].filter(Boolean).join(" ") : null)
        ?? (unemployedHere ? "Arbeitslose stellt man im Gewerbe, in der Industrie oder auf dem Bauernhof an." : null)
        ?? (families.length === 0 && !service ? (isRoad(this.city, index) ? "Straße" : "Hier ist nichts gebaut.") : null),
      budget: occupied ? cellBudget(this.city, index) : null,
      gift: families.length > 0 && !gifted ? `Studium finanzieren (${scholarshipCost(this.city.levels[index])} €)` : null,
    });
  }

  private showCar(car: { surname: string; driver: string; members: string; label: string; home: number }): void {
    this.focus = null;
    this.selected = car.home;
    const home = cellCoords(this.city, car.home);
    const family = houseReport(this.city, car.home).find((entry) => entry.surname === car.surname);
    this.setRosterOpen(false);
    this.setChatOpen(false);
    this.shrinkCompactHud("inspect");
    this.hud.showInspect({
      kind: "car",
      kicker: "Unterwegs",
      title: `Familie ${car.surname}`,
      stats: [
        { icon: "car", label: "Wagen", value: car.label },
        { icon: "people", label: "Fahrer", value: car.driver },
        { icon: "home", label: "Wohnort", value: `${home.x}, ${home.y}` },
      ],
      families: family ? [{
        surname: family.surname,
        cars: family.cars.map((entry) => entry.label),
        members: family.members.map((member) => ({
          name: member.name,
          child: member.child,
          education: member.educationLabel,
          job: member.child ? "kein Beruf" : member.job,
          unemployed: member.unemployed,
        })),
      }] : [],
      hires: [],
      note: `Mitfahrt: ${car.members}`,
      budget: null,
      gift: null,
    });
  }

  private setBudget(value: number): void {
    if (this.selected < 0) return;
    this.applyLocal({ type: "budget", index: this.selected, value });
  }

  private hire(home: number, slot: number): void {
    if (this.selected < 0) return;
    this.applyLocal({ type: "hire", workplace: this.selected, home, slot });
    if (this.focus === "cell") this.showCell(cellCoords(this.city, this.selected));
  }

  private trade(deal: string): void {
    if (this.selected < 0) return;
    this.applyLocal({ type: "trade", index: this.selected, deal });
    if (this.focus === "cell") this.showCell(cellCoords(this.city, this.selected));
  }

  private canTrade(dealId: string): boolean {
    const deal = TRADE.find((entry) => entry.id === dealId);
    if (!deal) return false;
    if (deal.side === "import") return this.city.funds >= deal.price;
    if (deal.requires === "food") return this.city.food >= Math.abs(deal.food ?? 0);
    if (deal.requires === "commercial") return this.city.zones.some((zone, index) => zone === Zone.Commercial && this.city.levels[index] > 0);
    if (deal.requires === "industrial") return this.city.zones.some((zone, index) => zone === Zone.Industrial && this.city.levels[index] > 0);
    return true;
  }

  private giveScholarship(): void {
    if (this.selected < 0) return;
    this.applyLocal({ type: "gift", index: this.selected });
    if (this.focus === "cell") this.showCell(cellCoords(this.city, this.selected));
  }

  private applyLocal(command: Command): void {
    const result = applyCommand(this.city, command);
    if (result.applied.length > 0) refreshUtilities(this.city);
    if (this.mode === "single") this.rememberWorker(true);
    this.publish();
    if (this.mode === "multi") this.socket?.emit("command", { id: crypto.randomUUID(), command });
    if (!result.ok) this.flash(REASONS[result.reason ?? "rejected"] ?? "Das geht so nicht.");
  }
}
