import * as THREE from "three";
import { io, type Socket } from "socket.io-client";
import { apiUrl, isDevServer, socketUrl } from "./serverUrl.ts";
import { CityRenderer } from "../render/CityRenderer.ts";
import { buildLookCity, hourToTick } from "../render/lookCity.ts";
import { loadGfxPreset, saveGfxPreset, type GfxPreset } from "../render/quality.ts";
import { RtsCamera } from "../render/RtsCamera.ts";
import { createHud, type ToolId } from "../ui/hud.ts";
import { playSfx, unlockAudio, updateAudioScene } from "../audio/sfx.ts";
import { sampleAudioScene } from "../audio/scene.ts";
import { bindAudioControls } from "../ui/audioPanel.ts";
import { CityLife } from "../ui/cityLife.ts";
import { OrderBoardView } from "../ui/orderBoard.ts";
import { ZooView } from "../ui/zooView.ts";
import { ParkView } from "../ui/parkView.ts";
import {
  BUILDINGS,
  CELL_SIZE,
  COST,
  LEVEL_COUNT,
  POWER_BIT,
  ServiceKind,
  habitatTypeOf,
  stepZoo,
  TRADE,
  WATER_BIT,
  Zone,
  applyCommand,
  asUint8Array,
  beachVisitors,
  cleanChat,
  goalProgress,
  brushCells,
  buildMeta,
  adjacentToOcean,
  afterLoadCity,
  canPlace,
  canPlaceHarbor,
  cellBudget,
  cellCoords,
  cellIndex,
  cellToWorld,
  allocateCityCode,
  cityToSave,
  createCity,
  suggestCityName,
  createLevelCity,
  deleteCityAuth,
  deleteCitySlot,
  forgetCoopJoined,
  getActiveCityId,
  loadCityAuth,
  markCoopJoined,
  rememberCityPush,
  wasCoopJoined,
  listCitySlots,
  loadCitySlot,
  loadOrCreateClientId,
  mergeRoomLists,
  employeesAt,
  evaluateLevel,
  farmActionAvailable,
  farmStatus,
  farmYield,
  FARM_UPGRADES,
  foodRatio,
  harborYield,
  houseHappiness,
  hubIncome,
  hubSlots,
  isBeach,
  isFarmAction,
  isHub,
  houseReport,
  logisticsPartner,
  marketMultiplier,
  pendingAt,
  quoteTrade,
  inBounds,
  cellHeight,
  isLine,
  isWorkplace,
  jobOpenings,
  isPipe,
  isRoad,
  levelById,
  levelRoomCode,
  lineStroke,
  packCells,
  placeBlockReason,
  resolveHarborCell,
  strokeConnected,
  supplyMissingHint,
  wouldReceiveSupply,
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
  waterDir,
  worldToCell,
  writeCity,
  ensureProgress,
  ensureBoard,
  stepOrders,
  stepProgress,
  EVENT_TIMEOUT,
  type EventId,
  tradeBlockReason as hubTradeReason,
  type ChatMessage,
  type CityPushReply,
  type CitySave,
  type CityState,
  type Command,
  type CommandResult,
  type LevelSync,
  type LockSnapshot,
  type PublicPlayer,
  type RoomListEntry,
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
  fill: `Land aufschütten, ${COST.fill} € pro blaues Wasserfeld auf der Karte (Küste, Fluss, See). Das Meer außerhalb der Karte hat keine Felder.`,
  cottage: `${BUILDINGS.cottage.name}, direkt an einer Straße. ${BUILDINGS.cottage.cost} €.`,
  apartments: `${BUILDINGS.apartments.name}, direkt an einer Straße. ${BUILDINGS.apartments.cost} €.`,
  tower: `${BUILDINGS.tower.name}, direkt an einer Straße. ${BUILDINGS.tower.cost} €.`,
  shop: `${BUILDINGS.shop.name}, direkt an einer Straße. ${BUILDINGS.shop.cost} €.`,
  office: `${BUILDINGS.office.name}, direkt an einer Straße. ${BUILDINGS.office.cost} €.`,
  mall: `${BUILDINGS.mall.name}, direkt an einer Straße. ${BUILDINGS.mall.cost} €.`,
  workshop: `${BUILDINGS.workshop.name}, direkt an einer Straße. ${BUILDINGS.workshop.cost} €.`,
  factory: `${BUILDINGS.factory.name}, direkt an einer Straße. ${BUILDINGS.factory.cost} €.`,
  plant: `${BUILDINGS.plant.name}, direkt an einer Straße. ${BUILDINGS.plant.cost} €.`,
  farm: `${BUILDINGS.farm.name}. Startet mit Getreide. Im Infofenster Tiere kaufen oder Hof verbessern. ${BUILDINGS.farm.cost} €.`,
  line: `Stromleitung: klicken und L ziehen. Kosten am Zeiger. Rechtsklick reißt nur die Leitung ab.`,
  pipe: `Wasserrohr: klicken und L ziehen. Kosten am Zeiger. Rechtsklick reißt nur das Rohr ab.`,
  power: `Kraftwerk direkt neben eine Straße. ${COST.power} €.`,
  water: `Wasserwerk direkt neben eine Straße. ${COST.water} €.`,
  school: `Schule, damit Bewohner einen Abschluss bekommen. ${COST.school} €.`,
  university: `Universität für bessere Jobs. ${COST.university} €.`,
  clinic: `Klinik. ${COST.clinic} €.`,
  police: `Polizei. ${COST.police} €.`,
  fire: `Feuerwehr. ${COST.fire} €.`,
  park: `Park. ${COST.park} €.`,
  airport: `Flughafen. ${COST.airport.toLocaleString("de-DE")} €. Schneller, teurer Handel. Logistik-Verbund mit einem Hafen in der Nähe.`,
  harbor: `Hafen direkt am Meer, auf Sand oder Land. ${COST.harbor.toLocaleString("de-DE")} €. Der Steg ragt ins Wasser. Straße, Strom und Wasser danach anschließen.`,
  wheel: `Riesenrad (Wahrzeichen) neben eine Straße. ${COST.wheel.toLocaleString("de-DE")} €. Macht die Nachbarschaft glücklich.`,
  cityhall: `Rathaus (Wahrzeichen) neben eine Straße. ${COST.hall.toLocaleString("de-DE")} €. +6 % Einnahmen.`,
  tvtower: `Fernsehturm (Wahrzeichen) neben eine Straße. ${COST.tower.toLocaleString("de-DE")} €. Tourismus und Einnahmen.`,
  tierpark: `Tierpark neben eine Straße. ${COST.tierpark.toLocaleString("de-DE")} €. Eingangstor zum eigenen Park-Level: Gehege, Wege und Stände baust du darin.`,
  lamp: `Laterne für die Nacht. Auf Straße oder Stromleitung; leitet Strom weiter. ${COST.lamp} €.`,
  bulldoze: "Ziehen reißt Felder in einer Linie ab. Bei Leitungen reicht auch Rechtsklick auf die Leitung.",
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
  harbor: ServiceKind.Harbor,
  lamp: ServiceKind.Lamp,
  wheel: ServiceKind.Wheel,
  cityhall: ServiceKind.CityHall,
  tvtower: ServiceKind.Tower,
  tierpark: ServiceKind.Tierpark,
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
  no_stock: "Dafür reicht die Nahrung nicht.",
  stock_full: "Der Nahrungsspeicher ist voll.",
  no_market: "Dafür braucht die Stadt das passende Gewerbe oder die Industrie.",
  busy: "Alle Handelsplätze sind belegt. Warte auf die Schiffe oder Flugzeuge.",
  zoo_off: "Den Zoo gibt es nur in freien Städten, nicht in Levels.",
  zoo_gone: "Dieses Tier oder Gehege gibt es nicht mehr.",
  zoo_name: "Name: 1–18 Zeichen, Buchstaben, Ziffern, Leerzeichen und . ' - &.",
  zoo_no_habitat: "Hier steht kein Gehege.",
  zoo_wrong_habitat: "Diese Art passt nicht in dieses Gehege.",
  zoo_predator: "Raubtiere leben nur mit Artgenossen – das gäbe Ärger im Gehege.",
  zoo_full: "Im Gehege ist kein Platz mehr.",
  zoo_items_full: "Mehr Einrichtung passt nicht ins Gehege.",
  zoo_spot_taken: "Der Platz ist schon belegt.",
  zoo_full_bowls: "Napf und Trog sind schon voll.",
  zoo_cooldown: "Das Tier braucht kurz Ruhe.",
  zoo_need_toy: "Zum Spielen braucht das Gehege ein Spielzeug.",
  park_none: "Erst einen Tierpark in der Stadt bauen.",
  park_blocked: "Hier ist kein Platz frei.",
  park_nothing: "Hier steht nichts zum Abreißen.",
  park_edge: "Der Eingang muss an den Rand des Parks.",
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
      saveOverlays(this.overlays);
      this.publish();
    },
    onLeave: () => this.leave(),
    onNewSolo: () => this.startSolo(false),
    onNewCoop: () => {
      void this.startNewCoop();
    },
    onContinue: () => this.startSolo(true),
    onOpenSolo: (code) => this.openSoloCity(code),
    onOpenCoop: (code) => {
      void this.openCoopCity(code);
    },
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
    onToggleOrbit: () => this.setOrbitMode(!this.orbitMode),
    onCompactPanel: (panel) => this.onCompactPanel(panel),
    onRoomNameChange: (value) => saveLastRoomName(value),
    onQuality: (preset) => this.setQuality(preset),
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
  private lastShipments: { cell: number; due: number; money: number; food: number }[] = [];
  private life!: CityLife;
  private orders!: OrderBoardView;
  private zooView!: ZooView;
  private parkView!: ParkView;
  private lastAudioScene = 0;
  private lastStats: SimMeta["stats"] | null = null;
  private building = false;
  private anchor: { x: number; y: number } | null = null;
  private readonly painted = new Set<number>();
  private stroke: number[] = [];
  private readonly denied = new Set<number>();
  private lockSig = "";
  private playerId = "";
  private readonly clientId = loadOrCreateClientId(sessionStorage, () => crypto.randomUUID());
  private room = "";
  private activeCityId: string | null = null;
  private joinIntent: { room: string; name: string; level?: number } | null = null;
  private joinRetries = 0;
  private lastRoomCodes: string[] = [];
  private lastRooms: { code: string; players: number }[] = [];
  /** Cities whose local copy must not be uploaded this session (left coop, or server said stale/forbidden). */
  private readonly serverSyncBlocked = new Set<string>();
  /** Uploads run one after another so each one carries the rev the previous one returned. */
  private pushQueue: Promise<unknown> = Promise.resolve();
  private overlays = loadOverlays();
  private strokeComplete = true;
  private erasing = false;
  private hoverCell: { x: number; y: number } | null = null;
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
  private orbitMode = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; midX: number; midY: number; distance: number } | null = null;
  private pinched = false;
  private inspectDown: { x: number; y: number } | null = null;
  private lastCursor = 0;
  private readonly remoteCursors = new Map<string, { name: string; x: number; z: number }>();
  private readonly cursorNdc = new THREE.Vector3();
  private peerCursorsPainted = false;
  private lastBuildTap = 0;
  private lastLookTap = 0;
  private lastLookCell = -1;
  private buildCursorOn = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new RtsCamera();
    this.camera.heightAt = (x, z) => this.cameraFloor(x, z);
    this.view = new CityRenderer(canvas);
    this.worker = new Worker(new URL("../sim/sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<TickMessage>) => this.onTick(event.data);
    this.life = new CityLife({
      choose: (event, option) => {
        playSfx("cash");
        this.applyLocal({ type: "choose", event, option });
      },
      sound: (cue) => playSfx(cue),
      pickTool: (tool) => {
        this.hud.setMenuOpen(true);
        this.setTool(tool);
      },
      locks: (locks) => this.hud.setLockedTools(locks),
      opened: () => {
        this.orders?.toggle(false);
        this.zooView?.hide();
        this.parkView?.hideGate();
        this.focus = null;
        this.hud.hideInspect();
        this.setRosterOpen(false);
        this.setChatOpen(false);
        this.setBriefOpen(false);
        if (isCompactHud()) {
          this.hud.setDemandOpen(false);
          this.hud.setMenuOpen(false);
        }
      },
    });
    this.orders = new OrderBoardView({
      order: (slot, id, action) => this.applyLocal({ type: "order", slot, id, action }),
      sound: (cue) => playSfx(cue),
      opened: () => {
        this.life.toggle(false);
        this.zooView?.hide();
        this.parkView?.hideGate();
        this.focus = null;
        this.hud.hideInspect();
        this.setRosterOpen(false);
        this.setChatOpen(false);
        this.setBriefOpen(false);
        if (isCompactHud()) {
          this.hud.setDemandOpen(false);
          this.hud.setMenuOpen(false);
        }
      },
    });
    this.zooView = new ZooView({
      command: (zoo) => this.applyLocal({ type: "zoo", zoo }),
      sound: (cue) => playSfx(cue),
      flash: (text) => this.flash(text),
      opened: () => {
        this.life.toggle(false);
        this.orders.toggle(false);
        this.focus = null;
        this.hud.hideInspect();
        this.setRosterOpen(false);
        this.setChatOpen(false);
        this.setBriefOpen(false);
        if (isCompactHud()) {
          this.hud.setDemandOpen(false);
          this.hud.setMenuOpen(false);
        }
      },
      closed: () => {
        this.selected = -1;
      },
      interior: (open) => {
        document.body.dataset.zooInterior = open ? "on" : "off";
        if (!open) {
          this.resize();
          this.parkView?.resize();
        }
      },
    });
    this.parkView = new ParkView({
      command: (zoo) => this.applyLocal({ type: "zoo", zoo }),
      sound: (cue) => playSfx(cue),
      opened: () => {
        this.life.toggle(false);
        this.orders.toggle(false);
        this.zooView.hide();
        this.focus = null;
        this.hud.hideInspect();
        this.setRosterOpen(false);
        this.setChatOpen(false);
        this.setBriefOpen(false);
        if (isCompactHud()) {
          this.hud.setDemandOpen(false);
          this.hud.setMenuOpen(false);
        }
      },
      mode: (open) => {
        this.zooView.hide();
        this.setTool("inspect");
        this.hud.hideInspect();
        if (!open) this.resize();
      },
      habitat: (cell) => this.zooView.showHabitat(this.city, cell),
      closeHabitat: () => this.zooView.hide(),
    });
    bindAudioControls();
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.hud.setContinueVisible(listCitySlots(localStorage).length > 0);
    this.hud.setLevelUnlock(loadUnlockedLevel());
    this.setBriefOpen(false);
    this.hud.setRosterOpen(false);
    this.hud.setChatOpen(false);
    this.hud.setChatUnread(0);
    this.hud.setChatEnabled(false, "Chat gibt es im Koop.");
    this.hud.setPanMode(false);
    this.hud.setOrbitMode(false);
    this.hud.setPeerCursors([]);
    this.hud.setOverlays(this.overlays);
    this.hud.setQuality(loadGfxPreset());
    this.paintVignette();
    this.hud.setRoomName(suggestCityName(this.knownCodes()));
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
    this.canvas.tabIndex = 0;
    this.canvas.focus({ preventScroll: true });
    onCompactHudChange((compact) => {
      if (compact) {
        this.setBriefOpen(false);
        this.setRosterOpen(false);
        this.setChatOpen(false);
      } else if (this.playKind === "level") {
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
    this.bootLookPreview();
    requestAnimationFrame((time) => this.frame(time));
    if (new URLSearchParams(location.search).has("e2e")) this.attachE2e();
  }

  /** Browser-test helper: project buildable cells so Playwright can click the real canvas. */
  private attachE2e(): void {
    const self = this;
    (window as unknown as { __citylineE2E: unknown }).__citylineE2E = {
      snapshot() {
        let roads = 0;
        let homes = 0;
        for (let i = 0; i < self.city.roads.length; i += 1) if (self.city.roads[i]) roads += 1;
        for (let i = 0; i < self.city.levels.length; i += 1) {
          if (self.city.levels[i] > 0 && self.city.zones[i] === Zone.Residential) homes += 1;
        }
        return {
          mode: self.mode,
          room: self.room,
          funds: self.city.funds,
          roads,
          homes,
          playing: self.playing,
          tick: self.city.tick,
          harbors: [...self.city.services].filter((kind) => kind === ServiceKind.Harbor).length,
          airports: [...self.city.services].filter((kind) => kind === ServiceKind.Airport).length,
          boats: (self.view as unknown as { boats?: unknown[] }).boats?.length ?? 0,
        };
      },
      apply(command: Command) {
        self.applyLocal(command);
        return { funds: self.city.funds, revision: self.city.revision };
      },
      zoo() {
        return JSON.parse(JSON.stringify(self.city.progress?.zoo ?? null));
      },
      zooUi() {
        return self.zooView.e2e();
      },
      parkUi() {
        return self.parkView.e2e();
      },
      zooLayer() {
        return self.view.zoo.stats();
      },
      openHabitat(cell: number) {
        self.showCell(cellCoords(self.city, cell));
      },
      /** Time compression for tests (solo only): run the zoo n ticks ahead. */
      advanceZoo(ticks: number) {
        if (self.mode !== "single") return false;
        for (let k = 0; k < ticks; k += 1) {
          self.city.tick += 1;
          stepZoo(self.city);
        }
        self.rememberWorker(true);
        self.publish();
        return true;
      },
      /** Free flat land block (w×h) near the camera target, for building a test zoo. */
      findArea(w: number, h: number): { x: number; y: number } | null {
        const center = worldToCell(self.city, self.camera.target.x, self.camera.target.z) ?? { x: self.city.width >> 1, y: self.city.height >> 1 };
        for (let r = 0; r < 40; r += 1) {
          for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x0 = center.x + dx;
              const y0 = center.y + dy;
              if (x0 < 2 || y0 < 2 || x0 + w >= self.city.width - 2 || y0 + h >= self.city.height - 2) continue;
              let free = true;
              const ground = cellHeight(self.city, x0, y0);
              for (let y = y0; y < y0 + h && free; y += 1) {
                for (let x = x0; x < x0 + w && free; x += 1) {
                  const index = cellIndex(self.city, x, y);
                  if (placeBlockReason(self.city, index, "road") || self.cellHasStructure(index) || Math.abs(cellHeight(self.city, x, y) - ground) > 0.01) free = false;
                }
              }
              if (free) return { x: x0, y: y0 };
            }
          }
        }
        return null;
      },
      zooAnimalPose(id: number) {
        return self.view.zoo.poses.get(id) ?? null;
      },
      setTool(tool: ToolId) {
        self.setTool(tool);
      },
      cellScreen(x: number, y: number): { x: number; y: number } | null {
        self.camera.update(0);
        self.camera.camera.updateMatrixWorld(true);
        const width = self.canvas.clientWidth || window.innerWidth;
        const height = self.canvas.clientHeight || window.innerHeight;
        const rect = self.canvas.getBoundingClientRect();
        const world = cellToWorld(self.city, x, y);
        self.cursorNdc.set(world.x, 0.2, world.z).project(self.camera.camera);
        if (self.cursorNdc.z < -1 || self.cursorNdc.z > 1) return null;
        return {
          x: rect.left + (self.cursorNdc.x * 0.5 + 0.5) * width,
          y: rect.top + (-self.cursorNdc.y * 0.5 + 0.5) * height,
        };
      },
      placeReason(x: number, y: number, tool?: ToolId): string | null {
        const index = cellIndex(self.city, x, y);
        const used = tool ?? self.tool;
        const kind = SERVICES[used];
        if (kind) return placeBlockReason(self.city, index, "service", { kind });
        if (BUILDINGS[used as keyof typeof BUILDINGS]) return placeBlockReason(self.city, index, "build");
        return placeBlockReason(self.city, index, used as "line");
      },
      canHarbor(x: number, y: number): boolean {
        return canPlaceHarbor(self.city, cellIndex(self.city, x, y));
      },
      lookAt(x: number, y: number, distance = 48, polar?: number, lift?: number, azimuth?: number) {
        const world = cellToWorld(self.city, x, y);
        self.camera.target.set(world.x, 0, world.z);
        self.camera.distance = distance;
        if (polar !== undefined) self.camera.polar = polar;
        if (lift !== undefined) self.camera.lookLift = lift;
        if (azimuth !== undefined) self.camera.azimuth = azimuth;
        self.camera.update(0);
        self.camera.camera.updateMatrixWorld(true);
      },
      lookSea(kind: "harbor" | "boats" | "overview" | "beach" | "airport") {
        const e2e = (window as unknown as { __citylineE2E: { findHarbor: () => { x: number; y: number } | null; findBeach: () => { x: number; y: number } | null; findAirport: () => { x: number; y: number } | null; findCoast: () => { x: number; y: number } | null; lookAt: (x: number, y: number, distance?: number, polar?: number, lift?: number, azimuth?: number) => void } }).__citylineE2E;
        const harbor = e2e.findHarbor();
        const beach = e2e.findBeach();
        const airport = e2e.findAirport();
        const coast = harbor ?? beach ?? e2e.findCoast();
        if (!coast) return;
        const dir = waterDir(self.city, coast.x, coast.y);
        const inland = Math.atan2(-dir.dx, -dir.dy);
        if (kind === "boats") e2e.lookAt(coast.x + dir.dx * 2, coast.y + dir.dy * 2, 42, 0.92, 1.4, inland + 0.18);
        else if (kind === "harbor") e2e.lookAt(coast.x + dir.dx * 1.2, coast.y + dir.dy * 1.2, 32, 0.94, 1.1, inland + 0.62);
        else if (kind === "beach") {
          const target = beach ?? coast;
          e2e.lookAt(target.x + dir.dx * 1.4, target.y + dir.dy * 1.4, 22, 1.05, 0.9, inland + 0.18);
        } else if (kind === "airport") {
          const target = airport ?? coast;
          e2e.lookAt(target.x + 1, target.y, 36, 0.85, 1.7, 0.18);
        } else e2e.lookAt(coast.x - dir.dx * 7, coast.y - dir.dy * 8, 118, 0.96, 12, inland + 0.06);
      },
      setHour(hour: number) {
        self.city.tick = Math.round(((hour % 24) / 24) * 600);
        self.rememberWorker(false);
        self.publish();
      },
      setChrome(on: boolean) {
        self.view.setDecorations(on);
        if (on) delete document.body.dataset.look;
        else document.body.dataset.look = "shot";
        self.setQuality("high");
        self.publish();
      },
      findCoast(): { x: number; y: number; screen: { x: number; y: number } } | null {
        for (let y = 3; y < self.city.height - 3; y += 1) {
          for (let x = 3; x < self.city.width - 3; x += 1) {
            const index = cellIndex(self.city, x, y);
            if (!canPlaceHarbor(self.city, index)) continue;
            return { x, y, screen: { x: 0, y: 0 } };
          }
        }
        for (let y = 3; y < self.city.height - 3; y += 1) {
          for (let x = 3; x < self.city.width - 3; x += 1) {
            const index = cellIndex(self.city, x, y);
            if (self.city.terrain[index] === 1) continue;
            if (self.city.services[index] !== ServiceKind.None || self.city.levels[index] > 0) continue;
            if (!isBeach(self.city, index) && !adjacentToOcean(self.city, index)) continue;
            return { x, y, screen: { x: 0, y: 0 } };
          }
        }
        return null;
      },
      findInland(): { x: number; y: number } | null {
        for (let y = 16; y < self.city.height - 16; y += 1) {
          for (let x = 16; x < self.city.width - 16; x += 1) {
            const index = cellIndex(self.city, x, y);
            if (self.city.terrain[index] === 1) continue;
            if (adjacentToOcean(self.city, index) || isBeach(self.city, index)) continue;
            if (self.city.services[index] !== ServiceKind.None) continue;
            return { x, y };
          }
        }
        return null;
      },
      findHarbor(): { x: number; y: number } | null {
        for (let i = 0; i < self.city.services.length; i += 1) {
          if (self.city.services[i] === ServiceKind.Harbor) return cellCoords(self.city, i);
        }
        return null;
      },
      findAirport(): { x: number; y: number } | null {
        for (let i = 0; i < self.city.services.length; i += 1) {
          if (self.city.services[i] === ServiceKind.Airport) return cellCoords(self.city, i);
        }
        return null;
      },
      inspectCell(x: number, y: number) {
        self.showCell({ x, y });
      },
      findBeach(): { x: number; y: number } | null {
        const crowd = beachVisitors(self.city, 36);
        if (crowd.length > 0) {
          const counts = new Map<number, number>();
          let bestCell = crowd[0].cell;
          let bestCount = 0;
          for (const visitor of crowd) {
            const next = (counts.get(visitor.cell) ?? 0) + 1;
            counts.set(visitor.cell, next);
            if (next > bestCount) {
              bestCount = next;
              bestCell = visitor.cell;
            }
          }
          const { x, y } = cellCoords(self.city, bestCell);
          return { x, y };
        }
        let best: { x: number; y: number } | null = null;
        let score = -1;
        for (let y = 2; y < self.city.height - 2; y += 1) {
          for (let x = 2; x < self.city.width - 2; x += 1) {
            const index = cellIndex(self.city, x, y);
            if (!isBeach(self.city, index)) continue;
            if (self.city.services[index] !== ServiceKind.None) continue;
            let homes = 0;
            for (let dy = -5; dy <= 5; dy += 1) {
              for (let dx = -5; dx <= 5; dx += 1) {
                const nx = x + dx;
                const ny = y + dy;
                if (!inBounds(self.city, nx, ny)) continue;
                const home = cellIndex(self.city, nx, ny);
                if (self.city.zones[home] === Zone.Residential && self.city.levels[home] > 0) homes += 1;
              }
            }
            if (homes > score) {
              score = homes;
              best = { x, y };
            }
          }
        }
        return best;
      },
      roadRun(): { cells: { x: number; y: number }[]; screens: { x: number; y: number }[] } | null {
        self.camera.update(0);
        self.camera.camera.updateMatrixWorld(true);
        const width = self.canvas.clientWidth || window.innerWidth;
        const height = self.canvas.clientHeight || window.innerHeight;
        const rect = self.canvas.getBoundingClientRect();
        const project = (cx: number, cy: number) => {
          const world = cellToWorld(self.city, cx, cy);
          self.cursorNdc.set(world.x, 0.2, world.z).project(self.camera.camera);
          if (self.cursorNdc.z < -1 || self.cursorNdc.z > 1) return null;
          const x = (self.cursorNdc.x * 0.5 + 0.5) * width;
          const y = (-self.cursorNdc.y * 0.5 + 0.5) * height;
          if (x < 8 || y < 8 || x > width - 8 || y > height - 8) return null;
          return { x: rect.left + x, y: rect.top + y };
        };
        for (let y = 8; y < self.city.height - 8; y += 1) {
          let run: { x: number; y: number }[] = [];
          for (let x = 8; x < self.city.width - 8; x += 1) {
            const index = cellIndex(self.city, x, y);
            if (canPlace(self.city, index, "road")) run.push({ x, y });
            else run = [];
            if (run.length >= 6) {
              const screens = run.map((cell) => project(cell.x, cell.y));
              if (screens.every(Boolean)) return { cells: run, screens: screens as { x: number; y: number }[] };
              run = run.slice(-3);
            }
          }
        }
        return null;
      },
      cottageSpot(): { x: number; y: number; screen: { x: number; y: number } } | null {
        self.camera.update(0);
        self.camera.camera.updateMatrixWorld(true);
        const width = self.canvas.clientWidth || window.innerWidth;
        const height = self.canvas.clientHeight || window.innerHeight;
        const rect = self.canvas.getBoundingClientRect();
        for (let i = 0; i < self.city.roads.length; i += 1) {
          if (!self.city.roads[i]) continue;
          const { x, y } = cellCoords(self.city, i);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(self.city, nx, ny)) continue;
            if (!canPlace(self.city, cellIndex(self.city, nx, ny), "build")) continue;
            const world = cellToWorld(self.city, nx, ny);
            self.cursorNdc.set(world.x, 0.2, world.z).project(self.camera.camera);
            if (self.cursorNdc.z < -1 || self.cursorNdc.z > 1) continue;
            const sx = (self.cursorNdc.x * 0.5 + 0.5) * width;
            const sy = (-self.cursorNdc.y * 0.5 + 0.5) * height;
            if (sx < 8 || sy < 8 || sx > width - 8 || sy > height - 8) continue;
            return { x: nx, y: ny, screen: { x: rect.left + sx, y: rect.top + sy } };
          }
        }
        return null;
      },
      stats() {
        return buildMeta(self.city).stats;
      },
      /** Ambient life counts (cars, pedestrians, residents, smoke, birds). */
      life() {
        return self.view.lifeStats();
      },
      /** Swap the current solo city for the look showcase (pop ~280) and keep simulating. */
      showcase(hour = 9) {
        const showcase = buildLookCity(hour);
        self.adoptCity(packCells(showcase.city), buildMeta(showcase.city));
        self.city.gen = showcase.city.gen ? { ...showcase.city.gen } : undefined;
        self.city.tick = hourToTick(hour);
        self.city.progress = undefined;
        refreshUtilities(self.city);
        stepProgress(self.city);
        self.life.reset();
        // The showcase is a still life (no real power grid); keep the sim paused like ?preview=look.
        self.rememberWorker(false);
        self.camera.lookAt(showcase.focusX, showcase.focusZ);
        self.camera.azimuth = 0.58;
        self.camera.polar = 1.1;
        self.camera.lookLift = 10;
        self.camera.setDistance(176);
        self.publish();
        return { population: buildMeta(self.city).stats.population, rank: ensureProgress(self.city).rank };
      },
      forceEvent(id: EventId) {
        const p = ensureProgress(self.city);
        p.seeded = true;
        p.event = { id, at: self.city.tick, until: self.city.tick + EVENT_TIMEOUT };
        self.rememberWorker(false);
        self.publish();
      },
      setProgress(patch: { ach?: number; rank?: number; trade?: number }) {
        const p = ensureProgress(self.city);
        if (patch.ach !== undefined) p.ach = patch.ach;
        if (patch.rank !== undefined) p.rank = patch.rank;
        if (patch.trade !== undefined) p.stats.trade = patch.trade;
        self.rememberWorker(false);
        self.publish();
        return { ach: p.ach, rank: p.rank, event: p.event, challenge: p.challenge, last: p.last };
      },
      progress() {
        return self.city.progress ? JSON.parse(JSON.stringify(self.city.progress)) : null;
      },
      /** Auftragstafel state (deep copy). */
      orders() {
        const board = self.city.progress?.orders;
        return board ? JSON.parse(JSON.stringify(board)) : null;
      },
      /** Fill the order stocks for tests/screenshots. */
      setOrderStock(stock: { food?: number; goods?: number; fish?: number }) {
        const board = ensureBoard(self.city);
        if (stock.food !== undefined) self.city.food = stock.food;
        if (stock.goods !== undefined) board.goods = stock.goods;
        if (stock.fish !== undefined) board.fish = stock.fish;
        self.rememberWorker(false);
        self.publish();
        return { food: self.city.food, goods: board.goods, fish: board.fish };
      },
      /** Paused showcase: advance only the order board (time, production, refills). */
      advanceOrders(ticks = 40) {
        for (let k = 0; k < ticks; k += 1) {
          self.city.tick += 1;
          stepOrders(self.city);
        }
        self.rememberWorker(false);
        self.publish();
        return JSON.parse(JSON.stringify(self.city.progress?.orders ?? null));
      },
      openOrders(open = true) {
        self.orders.toggle(open);
        return self.orders.isOpen();
      },
      chatter(count = 4) {
        return self.life.chatterNow(self.city, buildMeta(self.city), count);
      },
      spotFor(tool: ToolId): { x: number; y: number } | null {
        const kind = SERVICES[tool];
        const center = worldToCell(self.city, self.camera.target.x, self.camera.target.z) ?? { x: self.city.width >> 1, y: self.city.height >> 1 };
        for (let r = 0; r < 30; r += 1) {
          for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = center.x + dx;
              const y = center.y + dy;
              if (x < 1 || y < 1 || x >= self.city.width - 1 || y >= self.city.height - 1) continue;
              if (kind && !placeBlockReason(self.city, cellIndex(self.city, x, y), "service", { kind })) return { x, y };
            }
          }
        }
        return null;
      },
      cellIndex(x: number, y: number) {
        return cellIndex(self.city, x, y);
      },
      findService(kind: number): { x: number; y: number } | null {
        for (let i = 0; i < self.city.services.length; i += 1) {
          if (self.city.services[i] === kind) return { x: i % self.city.width, y: Math.floor(i / self.city.width) };
        }
        return null;
      },
      countService(kind: number) {
        let n = 0;
        for (let i = 0; i < self.city.services.length; i += 1) if (self.city.services[i] === kind) n += 1;
        return n;
      },
      openCity(open = true) {
        self.life.toggle(open);
      },
      audioScene() {
        return sampleAudioScene(self.city, self.camera.target.x, self.camera.target.z, self.camera.distance, self.lastStats?.traffic ?? 0, self.playing);
      },
      dismissUi() {
        self.hud.closeOverlays();
        self.hud.clearToast();
        document.querySelector<HTMLButtonElement>("#quest-hint-ok")?.click();
        const quest = document.querySelector<HTMLElement>("#quest");
        if (quest) {
          quest.hidden = true;
          quest.dataset.collapsed = "on";
          document.body.dataset.quest = "collapsed";
        }
        const rail = document.querySelector<HTMLButtonElement>("#toggle-rail");
        if (document.body.dataset.menu === "open") rail?.click();
        if (document.body.dataset.demand === "open") {
          document.querySelector<HTMLButtonElement>("#toggle-demand")?.click();
        }
        const demand = document.querySelector<HTMLElement>("#demand");
        if (demand) demand.style.display = "none";
        const toast = document.querySelector<HTMLElement>("#toast");
        if (toast) toast.hidden = true;
      },
      setOverlay(flags: { zones?: boolean; power?: boolean; water?: boolean }) {
        self.overlays = { ...self.overlays, ...flags };
        saveOverlays(self.overlays);
        self.publish();
        const stats = buildMeta(self.city).stats;
        self.hud.setStatus(`Strom ${stats.powerUsed}/${stats.powerCapacity} · Wasser ${stats.waterUsed}/${stats.waterCapacity}`);
      },
      hideCursor() {
        self.hideBuildCursor();
      },
      findPlot(): { x: number; y: number } | null {
        const need = 14;
        for (let y = 18; y < self.city.height - 18; y += 1) {
          for (let x = 18; x < self.city.width - 18; x += 1) {
            let ok = true;
            for (let dy = 0; dy < need && ok; dy += 1) {
              for (let dx = 0; dx < need && ok; dx += 1) {
                const index = cellIndex(self.city, x + dx, y + dy);
                if (self.city.terrain[index] === 1 || isBeach(self.city, index) || adjacentToOcean(self.city, index)) ok = false;
              }
            }
            if (ok) return { x, y };
          }
        }
        return null;
      },
      previewStroke(x0: number, y0: number, x1: number, y1: number, erase = false) {
        self.erasing = erase;
        self.building = true;
        self.anchor = { x: x0, y: y0 };
        self.painted.clear();
        self.denied.clear();
        self.updateStroke({ x: x1, y: y1 });
        self.hoverCell = { x: x1, y: y1 };
        const screen = (window as unknown as { __citylineE2E: { cellScreen: (x: number, y: number) => { x: number; y: number } | null } }).__citylineE2E.cellScreen(x1, y1);
        if (screen) self.paintBuildCursor(screen.x, screen.y);
        self.describe({ x: x1, y: y1 });
        return { cells: self.stroke.length, hint: self.cursorHint(), label: self.cursorLabel() };
      },
      hoverAt(x: number, y: number) {
        const index = cellIndex(self.city, x, y);
        self.statusUntil = 0;
        self.hoverCell = { x, y };
        self.stroke = [index];
        self.strokeComplete = true;
        self.refreshPreview();
        const screen = (window as unknown as { __citylineE2E: { cellScreen: (xx: number, yy: number) => { x: number; y: number } | null } }).__citylineE2E.cellScreen(x, y);
        if (screen) self.paintBuildCursor(screen.x, screen.y);
        self.describe({ x, y });
        return {
          screen,
          reason: placeBlockReason(self.city, index, "build"),
          miss: supplyMissingHint(self.city, index, BUILDINGS.cottage.zone),
          hint: self.cursorHint(),
        };
      },
      commitStroke() {
        if (!self.building && self.stroke.length === 0) return { ok: false };
        self.building = false;
        self.commit();
        return { ok: true, lines: [...self.city.lines].filter((v) => v !== 0).length };
      },
    };
  }

  private frame(time: number): void {
    const dt = Math.min(0.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    if (this.zooView.interiorOpen) {
      // Interior view: its own scene; the city waits.
      this.zooView.frame(dt);
      requestAnimationFrame((next) => this.frame(next));
      return;
    }
    if (this.parkView.isOpen) {
      // Tierpark level: its own scene; the city waits (the simulation keeps running).
      this.parkView.frame(dt);
      requestAnimationFrame((next) => this.frame(next));
      return;
    }
    this.camera.update(dt);
    if (this.mode === "multi" && this.socket && time - this.lastLook > 280) {
      this.lastLook = time;
      this.socket.emit("look", { x: this.camera.target.x, z: this.camera.target.z });
    }
    const updateStart = performance.now();
    this.view.update(dt, this.camera.target);
    this.view.lastUpdateMs = performance.now() - updateStart;
    this.view.render(this.camera.camera);
    this.paintPeerCursors();
    if (time - this.lastAudioScene > 250) {
      this.lastAudioScene = time;
      updateAudioScene(
        sampleAudioScene(this.city, this.camera.target.x, this.camera.target.z, this.camera.distance, this.lastStats?.traffic ?? 0, this.playing),
      );
    }
    const stats = window as Window & { __cityline?: Record<string, unknown> };
    stats.__cityline = {
      frameMs: this.view.lastFrameMs,
      updateMs: this.view.lastUpdateMs,
      syncMs: this.view.lastSyncMs,
      drawCalls: this.view.drawCalls,
      triangles: this.view.triangles,
      quality: this.view.gfxLevel().level,
      ready: true,
    };
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
    if (this.panMode) {
      this.panMode = false;
      this.hud.setPanMode(false);
    }
    if (this.orbitMode) {
      this.orbitMode = false;
      this.hud.setOrbitMode(false);
    }
    this.lastBuildTap = 0;
    this.refreshHint();
    this.cancelStroke(false);
    if (tool === "inspect") this.hideBuildCursor();
    this.publish();
  }

  private liveOverlays(): { zones: boolean; power: boolean; water: boolean } {
    return {
      zones: this.overlays.zones,
      power: this.overlays.power || this.tool === "line" || this.tool === "power",
      water: this.overlays.water || this.tool === "pipe" || this.tool === "water",
    };
  }

  private adoptCity(cells: Uint8Array, meta: SimMeta): void {
    writeCity(this.city, cells, meta);
    afterLoadCity(this.city);
  }

  private setPanMode(on: boolean): void {
    this.panMode = on;
    this.hud.setPanMode(on);
    if (on) {
      if (this.orbitMode) {
        this.orbitMode = false;
        this.hud.setOrbitMode(false);
      }
      this.cancelStroke(false);
      this.hideBuildCursor();
    }
    this.refreshHint();
  }

  private setQuality(preset: GfxPreset): void {
    saveGfxPreset(preset);
    this.view.setQuality(preset);
    this.hud.setQuality(preset);
    this.paintVignette();
    this.resize();
    this.publish();
  }

  private paintVignette(): void {
    document.body.dataset.vignette = this.view.gfxLevel().vignette ? "on" : "off";
  }

  private bootLookPreview(): void {
    const params = new URLSearchParams(location.search);
    if (params.get("preview") !== "look") return;
    const hour = Number(params.get("hour") ?? 7);
    const gfx = params.get("gfx");
    if (gfx === "auto" || gfx === "high" || gfx === "medium" || gfx === "low") this.setQuality(gfx);
    if (params.get("hud") === "0") document.body.dataset.look = "shot";
    this.hud.showNameGate(false);
    this.hud.setLobby(false);
    this.joinIntent = null;
    this.leaveSocket();
    this.clearLevel();
    this.mode = "single";
    this.playing = true;
    this.activeCityId = "look";
    this.resetUiForCityChange();
    this.hud.setJoined(false);
    this.hud.setMode("Vorschau");
    this.hud.setLobbyBackVisible(false);
    this.beginSession(false);
    const showcase = buildLookCity(Number.isFinite(hour) ? hour : 7);
    this.adoptCity(packCells(showcase.city), buildMeta(showcase.city));
    this.city.gen = showcase.city.gen ? { ...showcase.city.gen } : undefined;
    this.city.tick = hourToTick(Number.isFinite(hour) ? hour : 7);
    refreshUtilities(this.city);
    const weather = params.get("weather");
    this.view.setWeatherOverride(weather === "rain" || weather === "cloud" ? weather : "clear");
    this.view.setDecorations(false);
    this.overlays.zones = false;
    this.hud.setOverlays(this.overlays);
    this.rememberWorker(params.get("run") === "1");
    (window as unknown as { __citylineView?: unknown }).__citylineView = this.view;
    this.setTool("inspect");
    this.camera.resetOverview();
    this.camera.lookAt(showcase.focusX, showcase.focusZ);
    this.camera.azimuth = 0.58;
    this.camera.polar = 1.1;
    this.camera.lookLift = 10;
    this.camera.setDistance(176);
    this.publish();
  }

  private setOrbitMode(on: boolean): void {
    this.orbitMode = on;
    this.hud.setOrbitMode(on);
    if (on) {
      if (this.panMode) {
        this.panMode = false;
        this.hud.setPanMode(false);
      }
      this.cancelStroke(false);
    } else {
      this.hideBuildCursor();
    }
    this.refreshHint();
  }

  private hideBuildCursor(): void {
    if (this.buildCursorOn) {
      this.buildCursorOn = false;
      this.hud.setBuildCursor(null);
    }
    if (!this.building) {
      this.stroke = [];
      this.view.setPreview(this.city, [], []);
    }
  }

  private paintBuildCursor(clientX: number, clientY: number): void {
    if (this.orbitMode) {
      this.buildCursorOn = true;
      this.hud.setBuildCursor({
        x: clientX,
        y: clientY,
        label: "Drehen",
        hint: "Ziehen zum Orbit",
        kind: "orbit",
      });
      return;
    }
    if (this.tool === "inspect" || this.panMode) {
      this.hideBuildCursor();
      return;
    }
    this.buildCursorOn = true;
    const hint = this.cursorHint();
    this.hud.setBuildCursor({
      x: clientX,
      y: clientY,
      label: this.cursorLabel(),
      hint,
      kind: this.erasing ? "erase" : this.tool === "line" ? "line" : this.tool === "pipe" ? "pipe" : "build",
    });
  }

  private cursorLabel(): string {
    if (this.erasing) return this.tool === "pipe" ? "Rohr abreißen" : "Leitung abreißen";
    if (this.tool === "line" || this.tool === "pipe") {
      const cell = this.hoverCell;
      const index = cell ? cellIndex(this.city, cell.x, cell.y) : -1;
      const cells = this.stroke.length > 0 ? this.stroke : index >= 0 ? [index] : [];
      let n = 0;
      for (const item of cells) {
        if (this.isExistingLink(item)) continue;
        if (this.canUse(item)) n += 1;
      }
      const cost = n * this.cost();
      return `${this.toolLabel()} · ${cost.toLocaleString("de-DE")} €`;
    }
    return this.toolLabel();
  }

  private cursorHint(): string {
    if (this.erasing) return "Leitung abreißen";
    const cell = this.hoverCell;
    const index = cell ? cellIndex(this.city, cell.x, cell.y) : -1;
    if (this.tool === "line" || this.tool === "pipe") {
      const cells = this.stroke.length > 0 ? this.stroke : index >= 0 ? [index] : [];
      let n = 0;
      for (const item of cells) {
        if (this.isExistingLink(item)) continue;
        if (this.canUse(item)) n += 1;
      }
      const cost = n * this.cost();
      const stats = buildMeta(this.city).stats;
      const cap = this.tool === "line"
        ? `Netz ${stats.powerUsed}/${stats.powerCapacity}`
        : `Netz ${stats.waterUsed}/${stats.waterCapacity}`;
      return `${n} Feld${n === 1 ? "" : "er"} · ${cost.toLocaleString("de-DE")} € · ${cap}`;
    }
    if (index >= 0 && BUILDINGS[this.tool as keyof typeof BUILDINGS]) {
      const reason = placeBlockReason(this.city, index, "build");
      if (reason) return reason;
      const miss = supplyMissingHint(this.city, index, BUILDINGS[this.tool as keyof typeof BUILDINGS].zone);
      if (miss) return miss;
      return `${this.cost().toLocaleString("de-DE")} € · versorgt`;
    }
    if (index >= 0 && this.tool === "harbor") {
      return placeBlockReason(this.city, index, "service", { kind: ServiceKind.Harbor }) ?? `${COST.harbor.toLocaleString("de-DE")} €`;
    }
    const kind = SERVICES[this.tool];
    if (index >= 0 && kind) {
      const reason = placeBlockReason(this.city, index, "service", { kind });
      if (reason) return reason;
    }
    if (this.stroke.length > 0) {
      const n = this.stroke.filter((item) => this.canUse(item) && !this.isExistingLink(item)).length;
      const cost = n * this.cost();
      if (cost > 0) return `${n} Feld${n === 1 ? "" : "er"} · ${cost.toLocaleString("de-DE")} €`;
    }
    return "Doppelklick beendet";
  }

  private refreshHint(): void {
    const compact = isCompactHud();
    const camera = this.orbitMode
      ? compact
        ? "Ziehen dreht die Kamera. Zwei Finger zoomen. Nochmal Drehen beendet den Modus."
        : "Ziehen dreht die Kamera um die Karte. Nochmal Drehen beendet den Modus. Mausrad zoomt, WASD fährt."
      : this.panMode
        ? compact
          ? "Ziehen verschiebt die Karte. Zwei Finger zoomen. Nochmal Verschieben beendet den Modus. Doppeltipp auf Gebäude zoomt nah ran."
          : "Ziehen verschiebt die Karte ohne zu drehen. Nochmal Verschieben beendet den Modus. Doppelklick auf Gebäude zoomt nah ran."
        : compact
          ? this.tool === "inspect"
            ? "Ein Finger tippt. Ziehen mit der Lupe verschiebt, zwei Finger zoomen. Doppeltipp auf Gebäude zoomt nah ran."
            : ""
          : this.tool === "inspect"
            ? "Doppelklick auf Gebäude zoomt nah ran. Rechte Taste oder Drehen schaut um, Verschieben schiebt, Mausrad zoomt, Q/E dreht, WASD fährt."
            : "";
    this.hud.setHint(`${HINTS[this.tool] ?? "Werkzeug gewählt."}${camera ? ` ${camera}` : ""}`);
  }

  private bindInput(): void {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    window.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.camera.wheel(event.deltaY, event.clientX, event.clientY, rect);
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", (event) => {
      unlockAudio();
      if (document.activeElement !== this.canvas) this.canvas.focus({ preventScroll: true });
      this.paintBuildCursor(event.clientX, event.clientY);
    });
    this.canvas.addEventListener("pointerleave", () => {
      if (!this.building) this.hideBuildCursor();
    });
    window.addEventListener("pointerdown", () => unlockAudio(), { once: true });
    window.addEventListener("keydown", (event) => this.onKey(event, true));
    window.addEventListener("keyup", (event) => this.onKey(event, false));
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (down && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Age-of-Empires-style: 1–9 opens a build category, R T Z U I O picks from its palette.
      const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
      if (digit === "0") {
        this.setTool("inspect");
        return;
      }
      if (digit && Number(digit) >= 1 && Number(digit) <= 9) {
        this.hud.selectBuildCategory(Number(digit) - 1);
        return;
      }
      const picked = event.key.length === 1 ? this.hud.paletteTool(event.key) : null;
      if (picked) {
        event.preventDefault();
        this.setTool(picked);
        return;
      }
      if (event.key === "l" || event.key === "L") {
        this.setTool("line");
        return;
      }
      if (event.key === "p" || event.key === "P") {
        this.setTool("pipe");
        return;
      }
      if (event.key === "j" || event.key === "J") {
        this.orders.toggle();
        return;
      }
    }
    if (down && event.code === "Escape") {
      if (this.orders.isOpen()) {
        this.orders.toggle(false);
        return;
      }
      if (this.hud.closeOverlays()) return;
      if (this.building) this.cancelStroke(true);
      else {
        this.focus = null;
        this.hud.hideInspect();
        this.setTool("inspect");
      }
      return;
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(event.code)) {
      event.preventDefault();
      if (down && (event.code === "KeyQ" || event.code === "KeyE") && !event.repeat) {
        this.camera.nudgeRotate(event.code);
      }
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
    if (event.button === 2 && (this.tool === "line" || this.tool === "pipe") && !this.panMode && !this.orbitMode) {
      const cell = this.pick(event);
      if (!cell) return;
      this.erasing = true;
      this.building = true;
      this.anchor = cell;
      this.painted.clear();
      this.denied.clear();
      this.updateStroke(cell);
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (this.camera.begin(event.button, event.clientX, event.clientY, this.panMode, this.orbitMode)) {
      if (event.button === 0) {
        this.anchor = this.pick(event);
        this.canvas.setPointerCapture(event.pointerId);
      }
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
    this.erasing = false;
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
    this.hoverCell = cell;
    this.view.setHover(this.city, cell ? cellIndex(this.city, cell.x, cell.y) : null);
    this.describe(cell);
    if (this.building && cell) this.updateStroke(cell);
    else if (!this.building && cell && this.tool !== "inspect" && !this.panMode && !this.orbitMode) {
      this.stroke = [cellIndex(this.city, cell.x, cell.y)];
      this.strokeComplete = true;
      this.refreshPreview();
    }
    this.paintBuildCursor(event.clientX, event.clientY);
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
    const dragged = this.camera.didDrag();
    this.camera.end();
    this.inspectDown = null;
    if (cameraDrag && event.button === 0) {
      if (!dragged && (this.panMode || this.orbitMode) && this.tryZoomToBuilding()) {
        this.anchor = null;
        return;
      }
      this.cancelStroke(false);
      this.anchor = null;
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    if (event.button === 2 && !this.erasing) return;
    if (this.tool === "inspect") {
      if (this.tryZoomToBuilding()) {
        this.pickInspect();
        this.anchor = null;
        return;
      }
      this.pickInspect();
      this.anchor = null;
      return;
    }
    if (!this.building) return;
    this.building = false;
    const now = performance.now();
    if (now - this.lastBuildTap < 340) {
      this.lastBuildTap = 0;
      this.cancelStroke(false);
      this.setTool("inspect");
      this.flash("Baumodus beendet. Lupe ist aktiv.");
      return;
    }
    this.lastBuildTap = now;
    this.commit();
  }

  /** Prefer buildings/services over cars when the cell under the pointer is occupied. */
  private pickInspect(): void {
    const cell = this.anchor;
    const car = this.view.pickCar(this.camera.camera, this.pointer.x, this.pointer.y);
    if (cell) {
      const index = cellIndex(this.city, cell.x, cell.y);
      if (this.cellHasStructure(index)) {
        this.showCell(cell);
        return;
      }
    }
    if (car) this.showCar(car);
    else if (cell) this.showCell(cell);
  }

  private cellHasStructure(index: number): boolean {
    if (index < 0 || index >= this.city.levels.length) return false;
    return (
      this.city.levels[index] > 0 ||
      this.city.services[index] !== ServiceKind.None ||
      this.city.zones[index] !== Zone.None
    );
  }

  /** Doppelklick/Doppeltipp auf Gebäude: Kamera nah heranzoomen. */
  private tryZoomToBuilding(): boolean {
    const cell = this.anchor;
    if (!cell) return false;
    const index = cellIndex(this.city, cell.x, cell.y);
    if (!this.cellHasStructure(index)) {
      this.lastLookTap = 0;
      this.lastLookCell = -1;
      return false;
    }
    const now = performance.now();
    if (now - this.lastLookTap < 340 && this.lastLookCell === index) {
      const world = cellToWorld(this.city, cell.x, cell.y);
      this.camera.focusNear(world.x, world.z);
      this.lastLookTap = 0;
      this.lastLookCell = -1;
      return true;
    }
    this.lastLookTap = now;
    this.lastLookCell = index;
    return false;
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
    this.strokeComplete = true;
    if (this.tool === "fill") {
      this.stroke = [cellIndex(this.city, cell.x, cell.y)];
    } else if (this.tool === "road" || this.tool === "bridge" || this.tool === "line" || this.tool === "pipe" || this.tool === "bulldoze" || this.erasing) {
      const stroke = lineStroke(this.city, this.anchor.x, this.anchor.y, cell.x, cell.y);
      this.stroke = stroke.cells;
      this.strokeComplete = stroke.complete;
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
    const linked = this.tool === "road" || this.tool === "bridge" || this.tool === "line" || this.tool === "pipe" || this.tool === "bulldoze" || this.erasing;
    const broken = linked && (!this.strokeComplete || this.strokeHasGap());
    const legal: boolean[] = [];
    const supplied: boolean[] = [];
    let running = 0;
    for (const index of this.stroke) {
      const existing = this.isExistingLink(index);
      const allowed = !broken && (this.canUse(index) || existing) && !this.denied.has(index);
      const cost = allowed && !existing && !this.erasing && this.tool !== "bulldoze" ? this.cost() : 0;
      const accept = allowed && this.city.funds >= running + cost;
      legal.push(accept);
      if (accept && cost > 0) running += cost;
      supplied.push(accept && this.ghostSupplied(index));
    }
    const service = SERVICES[this.tool];
    const radius = service ? (serviceInfo(service)?.radius ?? 0) : 0;
    this.view.setPreview(this.city, this.stroke, legal, radius, supplied);
  }

  private isExistingLink(index: number): boolean {
    if (this.erasing) return false;
    if (this.tool === "line") return isLine(this.city, index);
    if (this.tool === "pipe") return isPipe(this.city, index);
    if (this.tool === "road" || this.tool === "bridge") return isRoad(this.city, index);
    return false;
  }

  private ghostSupplied(index: number): boolean {
    const building = BUILDINGS[this.tool as keyof typeof BUILDINGS];
    if (!building) return true;
    return wouldReceiveSupply(this.city, index, POWER_BIT, building.zone) && wouldReceiveSupply(this.city, index, WATER_BIT, building.zone);
  }

  private strokeHasGap(): boolean {
    if (this.erasing) return !strokeConnected(this.city, this.stroke);
    if (this.tool === "line") {
      const placeable = this.stroke.filter((index) => this.canUse(index) || isLine(this.city, index));
      return !strokeConnected(this.city, placeable);
    }
    if (this.tool === "pipe") {
      const placeable = this.stroke.filter((index) => this.canUse(index) || isPipe(this.city, index));
      return !strokeConnected(this.city, placeable);
    }
    if (this.tool !== "road" && this.tool !== "bridge") return !strokeConnected(this.city, this.stroke);
    const placeable = this.stroke.filter((index) => this.canUse(index) || isRoad(this.city, index));
    return !strokeConnected(this.city, placeable);
  }

  private commit(): void {
    const preview = this.stroke;
    const stripping = this.erasing;
    const linked = this.tool === "road" || this.tool === "bridge" || this.tool === "line" || this.tool === "pipe" || this.tool === "bulldoze" || stripping;
    const broken = linked && (!this.strokeComplete || this.strokeHasGap());
    const legal: number[] = [];
    let running = 0;
    if (!broken) {
      for (const index of preview) {
        if (this.denied.has(index)) continue;
        if (stripping) {
          if (this.tool === "line" && isLine(this.city, index)) legal.push(index);
          else if (this.tool === "pipe" && isPipe(this.city, index)) legal.push(index);
          continue;
        }
        if (this.isExistingLink(index)) continue;
        if (!this.canUse(index)) continue;
        const cost = this.tool === "bulldoze" ? 0 : this.cost();
        if (this.city.funds < running + cost) continue;
        legal.push(index);
        running += cost;
      }
    }
    this.stroke = [];
    this.strokeComplete = true;
    this.erasing = false;
    this.painted.clear();
    this.anchor = null;
    this.lockSig = "";
    this.view.setPreview(this.city, [], []);
    if (broken) {
      if (this.mode === "multi") this.socket?.emit("unlock");
      playSfx("reject");
      this.flash("Die Strecke hat eine Lücke (Wasser oder Kartenrand). Ziehe die Ecke auf Land.");
      return;
    }
    if (legal.length === 0) {
      if (this.mode === "multi") this.socket?.emit("unlock");
      playSfx("reject");
      this.flash(this.rejectReason(preview));
      return;
    }
    if (this.tool === "bulldoze") {
      const heavy = legal.some((index) => {
        if (this.city.levels[index] > 0) return true;
        const service = this.city.services[index];
        return service !== ServiceKind.None && service !== ServiceKind.Lamp;
      });
      if (heavy && !window.confirm("Gebäude wirklich abreißen? Du bekommst nur einen Teil des Preises zurück.")) {
        if (this.mode === "multi") this.socket?.emit("unlock");
        return;
      }
    }
    const command = stripping
      ? { type: "strip" as const, cells: legal, layer: this.tool === "pipe" ? "pipe" as const : "line" as const }
      : this.command(legal);
    const result = applyCommand(this.city, command);
    if (result.applied.length > 0) {
      refreshUtilities(this.city);
      this.view.noteBuilt(result.applied);
      playSfx(this.tool === "bulldoze" || stripping ? "demolish" : "place");
    }
    if (this.mode === "single") this.rememberWorker(true);
    // Keep the build tool active (B8); never open inspect/car after a place (B2).
    this.focus = null;
    this.hud.hideInspect();
    this.publish();
    // Emit command before unlock so the partner cannot steal the cells mid-apply.
    if (this.mode === "multi") {
      this.socket?.emit("command", { id: crypto.randomUUID(), command });
      this.socket?.emit("unlock");
    }
    if (!result.ok) {
      playSfx("reject");
      this.flash(REASONS[result.reason ?? "rejected"] ?? "Die Aktion wurde abgelehnt.");
    } else if (result.reason) this.flash(REASONS[result.reason] ?? result.reason);
    if (result.bonus) {
      this.hud.pulseFunds("good");
      this.flash(`Nachfrage zahlt ${result.bonus.toLocaleString("de-DE")} € zurück.`);
    }
  }

  private rejectReason(preview: number[]): string {
    if (this.tool === "fill") {
      return "Aufschütten nur auf einem blauen Wasserfeld, nicht auf Land oder auf einer Brücke.";
    }
    const index = preview[0] ?? (this.anchor ? cellIndex(this.city, this.anchor.x, this.anchor.y) : -1);
    if (index < 0) return "Keine gültige Fläche unter dem Zeiger.";
    const cost = this.cost();
    const placeable = preview.some((cell) => this.canUse(cell) && !this.denied.has(cell));
    if (placeable && cost > 0 && this.city.funds < cost) {
      const label = this.toolLabel();
      return `Zu wenig Geld: ${label} kostet ${cost.toLocaleString("de-DE")} €, in der Kasse sind ${this.city.funds.toLocaleString("de-DE")} €.`;
    }
    if (this.tool === "road") return placeBlockReason(this.city, index, "road") ?? "Keine gültige Fläche unter dem Zeiger.";
    if (this.tool === "bridge") return placeBlockReason(this.city, index, "bridge") ?? "Keine gültige Fläche unter dem Zeiger.";
    if (this.tool === "line") return placeBlockReason(this.city, index, "line") ?? "Keine gültige Fläche unter dem Zeiger.";
    if (this.tool === "pipe") return placeBlockReason(this.city, index, "pipe") ?? "Keine gültige Fläche unter dem Zeiger.";
    if (this.tool === "bulldoze") return placeBlockReason(this.city, index, "bulldoze") ?? "Keine gültige Fläche unter dem Zeiger.";
    if (BUILDINGS[this.tool as keyof typeof BUILDINGS]) {
      return placeBlockReason(this.city, index, "build") ?? "Keine gültige Fläche unter dem Zeiger.";
    }
    const kind = SERVICES[this.tool];
    if (kind) return placeBlockReason(this.city, index, "service", { kind }) ?? "Keine gültige Fläche unter dem Zeiger.";
    return "Keine gültige Fläche unter dem Zeiger.";
  }

  private toolLabel(): string {
    const building = BUILDINGS[this.tool as keyof typeof BUILDINGS];
    if (building) return building.name;
    const kind = SERVICES[this.tool];
    if (kind) return serviceInfo(kind)?.name ?? "Dieses Gebäude";
    if (this.tool === "road") return "Straße";
    if (this.tool === "bridge") return "Brücke";
    if (this.tool === "fill") return "Aufschütten";
    if (this.tool === "line") return "Stromleitung";
    if (this.tool === "pipe") return "Wasserrohr";
    return "Das";
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
    this.erasing = false;
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
        // From now on the server owns this city; a local copy is only a fork of it.
        markCoopJoined(payload.room, localStorage);
        this.hud.setMode(`Koop · ${payload.room}`);
        this.lastSave = performance.now();
      }
      this.renderPlayers(payload.players);
      this.loadChat(payload.chat);
      this.rememberWorker(false);
      this.beginSession(Boolean(payload.level));
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
    // The city keeps running locally; its autosave must never be posted over the coop room.
    if (wasMulti && this.activeCityId) this.serverSyncBlocked.add(this.activeCityId);
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
    this.noticeArrivals();
    const live = this.liveOverlays();
    document.body.dataset.powerNet = live.power ? "on" : "off";
    document.body.dataset.waterNet = live.water ? "on" : "off";
    this.hud.setOverlays(live);
    this.hud.setStats(meta, (bit) => goalProgress(this.city, bit));
    this.lastStats = meta.stats;
    this.life.update(this.city, meta);
    this.orders.update(this.city);
    this.zooView.update(this.city);
    this.parkView.update(this.city);
    const syncStart = performance.now();
    this.view.sync(this.city, live);
    this.view.lastSyncMs = performance.now() - syncStart;
    if (this.playKind === "level") this.syncLevel();
    else this.maybeAutoSave();
    // Only refresh an open building panel; never auto-switch to a car (B1).
    if (this.focus === "cell" && this.selected >= 0) this.showCell(cellCoords(this.city, this.selected));
  }

  private frameOpening(): void {
    this.camera.resetOverview();
    for (let y = this.city.height - 8; y >= 8; y -= 1) {
      for (let x = 10; x < this.city.width - 10; x += 1) {
        const index = cellIndex(this.city, x, y);
        if (!isBeach(this.city, index) && !adjacentToOcean(this.city, index)) continue;
        if (this.city.terrain[index] === 1) continue;
        const world = cellToWorld(this.city, x, y);
        this.camera.lookAt(world.x, world.z - 18);
        this.camera.distance = 175;
        this.camera.polar = 0.98;
        this.camera.lookLift = 10;
        this.camera.azimuth = 0.58;
        return;
      }
    }
  }

  private noticeArrivals(): void {
    const now = this.city.shipments ?? [];
    if (this.lastShipments.length > 0) {
      for (const prev of this.lastShipments) {
        const still = now.some((entry) => entry.cell === prev.cell && entry.due === prev.due && entry.money === prev.money && entry.food === prev.food);
        if (still) continue;
        const service = this.city.services[prev.cell];
        playSfx(service === ServiceKind.Airport ? "plane" : service === ServiceKind.Harbor ? "horn" : "cash");
        if (prev.money > 0) {
          this.flash(`Lieferung angekommen: +${prev.money.toLocaleString("de-DE")} €`);
          window.setTimeout(() => playSfx("cash"), 900);
        } else if (prev.food > 0) this.flash(`Fracht angekommen: +${prev.food} Nahrung`);
      }
    }
    this.lastShipments = now.map((entry) => ({ cell: entry.cell, due: entry.due, money: entry.money, food: entry.food }));
  }

  private resetUiForCityChange(): void {
    this.focus = null;
    this.selected = -1;
    this.lastShipments = [];
    this.life.reset();
    this.orders.reset();
    this.zooView.closeInterior();
    this.zooView.closeShop();
    this.zooView.hide();
    this.parkView.close();
    this.parkView.hideGate();
    this.statusUntil = 0;
    this.hud.hideInspect();
    this.hud.hideLevelEnd();
    this.hud.clearToast();
    this.hud.setStatus("Bereit zum Bauen.");
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
    if ((this.building || this.tool === "line" || this.tool === "pipe") && (this.tool === "line" || this.tool === "pipe" || this.erasing)) {
      this.hud.setStatus(this.cursorHint());
      return;
    }
    if (this.tool !== "inspect" && !this.panMode && !this.orbitMode) {
      const kind = SERVICES[this.tool];
      const building = BUILDINGS[this.tool as keyof typeof BUILDINGS];
      const reason = kind
        ? placeBlockReason(this.city, index, "service", { kind })
        : building
          ? placeBlockReason(this.city, index, "build")
          : this.tool === "road" || this.tool === "bridge" || this.tool === "fill" || this.tool === "bulldoze"
            ? placeBlockReason(this.city, index, this.tool)
            : null;
      if (reason) {
        this.hud.setStatus(reason);
        return;
      }
      if (building) {
        const miss = supplyMissingHint(this.city, index, building.zone);
        if (miss) {
          this.hud.setStatus(miss);
          return;
        }
        this.hud.setStatus(`${this.cost().toLocaleString("de-DE")} € · versorgt`);
        return;
      }
    }
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

  /** Rough top of whatever stands under a world point (terrain + building), so the close-up camera never clips in. */
  private cameraFloor(x: number, z: number): number {
    const cell = worldToCell(this.city, x, z);
    if (!cell || !inBounds(this.city, cell.x, cell.y)) return 0;
    const index = cellIndex(this.city, cell.x, cell.y);
    const ground = cellHeight(this.city, cell.x, cell.y);
    if (this.city.services[index]) return ground + 12;
    const level = this.city.levels[index];
    if (level <= 0) return ground;
    const zone = this.city.zones[index];
    if (zone === Zone.Farm) return ground + 5;
    if (zone === Zone.Industrial) return ground + 12;
    const tall = zone === Zone.Commercial ? [0, 9, 16, 34] : [0, 8, 14, 30];
    return ground + (tall[Math.min(level, 3)] ?? 30);
  }

  private flash(text: string): void {
    this.statusUntil = performance.now() + 2600;
    this.hud.flashStatus(text);
    this.zooView?.notice(text);
    this.parkView?.notice(text);
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
    const cell = worldToCell(this.city, point.x, point.z);
    if (!cell) return null;
    if (this.tool === "harbor") {
      const snapped = resolveHarborCell(this.city, cellIndex(this.city, cell.x, cell.y));
      return cellCoords(this.city, snapped);
    }
    return cell;
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
    this.resetUiForCityChange();
    this.hud.setRoomName(id);
    saveLastRoomName(id);
    this.hud.setJoined(false);
    this.hud.setMode("Singleplayer");
    this.hud.setPlayers("");
    this.hud.setLobby(false);
    this.hud.setLobbyBackVisible(true);
    this.beginSession(false);
    const fresh = createCity(undefined, undefined, this.hud.mapGenOptions());
    this.adoptCity(packCells(fresh), buildMeta(fresh));
    this.city.gen = fresh.gen ? { ...fresh.gen } : undefined;
    refreshUtilities(this.city);
    this.persistActiveCity(typed || id);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.frameOpening();
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
    this.resetUiForCityChange();
    this.hud.setRoomName(id);
    saveLastRoomName(id);
    this.hud.setJoined(false);
    this.hud.setMode("Singleplayer");
    this.hud.setPlayers("");
    this.hud.setLobby(false);
    this.hud.setLobbyBackVisible(true);
    this.beginSession(false);
    this.adoptCity(packCells(loaded), buildMeta(loaded));
    this.city.gen = loaded.gen ? { ...loaded.gen } : undefined;
    refreshUtilities(this.city);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.camera.resetOverview();
    this.lastSave = performance.now();
    this.publish();
  }

  private openSoloCity(code: string): void {
    if (loadCitySlot(code, localStorage)) {
      this.loadLocalCity(code);
      return;
    }
    this.flash("Diese Stadt ist lokal nicht gespeichert. Im Koop beitreten geht trotzdem.");
  }

  private async openCoopCity(code: string): Promise<void> {
    const live = this.lastRooms.find((entry) => entry.code === code && entry.players > 0);
    if (live) {
      this.join(code, this.hud.playerName());
      return;
    }
    const save = loadCitySlot(code, localStorage);
    const onServer = this.lastRoomCodes.includes(code);
    // Upload only to create a city the server does not have yet, or as its owner. The server
    // additionally rejects stale revisions, so an older local save never replaces the room.
    const upload = save && !this.serverSyncBlocked.has(code) && (!onServer || loadCityAuth(code, localStorage) !== null);
    if (upload) {
      const pushed = await this.pushCityToServer(save);
      if (!pushed.code && !pushed.reason) {
        this.flash(isDevServer
          ? "Koop-Server nicht erreichbar. Starte ihn auf Port 8787."
          : "Koop-Server nicht erreichbar. Versuch es gleich noch einmal.");
        return;
      }
    }
    this.join(code, this.hud.playerName());
  }

  private async startNewCoop(): Promise<void> {
    const typed = this.hud.roomName().trim();
    const id = allocateCityCode(typed, this.knownCodes());
    if (!id) {
      this.flash("Der Name braucht mindestens zwei Buchstaben oder Ziffern.");
      return;
    }
    const fresh = createCity(undefined, undefined, this.hud.mapGenOptions());
    this.adoptCity(packCells(fresh), buildMeta(fresh));
    this.city.gen = fresh.gen ? { ...fresh.gen } : undefined;
    this.activeCityId = id;
    this.hud.setRoomName(id);
    saveLastRoomName(id);
    if (!this.persistActiveCity(typed || id)) {
      this.activeCityId = null;
      this.flash("Stadt konnte nicht gespeichert werden.");
      return;
    }
    const save = loadCitySlot(id, localStorage);
    const code = save ? (await this.pushCityToServer(save)).code : null;
    if (!code) {
      this.flash(isDevServer
        ? "Koop-Server nicht erreichbar (Port 8787). Die Stadt liegt lokal bereit — Solo starten geht."
        : "Koop-Server nicht erreichbar. Die Stadt liegt lokal bereit — Solo starten geht.");
      await this.refreshLobby();
      return;
    }
    this.join(id, this.hud.playerName());
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
    if (this.mode === "single" && this.mayAutoPush(id)) void this.pushCityToServer(save);
    return true;
  }

  /** Background sync only for cities this device owns, or never played in coop here. */
  private mayAutoPush(id: string): boolean {
    if (this.serverSyncBlocked.has(id)) return false;
    return loadCityAuth(id, localStorage) !== null || !wasCoopJoined(id, localStorage);
  }

  /** `code` on success; `reason` when the server refused; neither when it was unreachable. */
  private pushCityToServer(save: CitySave): Promise<{ code: string | null; reason?: string }> {
    const run = this.pushQueue.then(() => this.sendCityToServer(save));
    this.pushQueue = run.catch(() => undefined);
    return run;
  }

  private async sendCityToServer(save: CitySave): Promise<{ code: string | null; reason?: string }> {
    const id = save.id ?? "";
    const auth = id ? loadCityAuth(id, localStorage) : null;
    try {
      const response = await fetch(apiUrl("/api/cities"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(auth ? { ...save, ownerKey: auth.key, rev: auth.rev } : save),
      });
      const body = (await response.json()) as CityPushReply;
      if (!response.ok || !body.ok || !body.code) {
        const reason = body.reason ?? "rejected";
        // The server has a newer or foreign city under this code: stop syncing over it.
        if (id && reason !== "bad_city") this.serverSyncBlocked.add(id);
        return { code: null, reason };
      }
      rememberCityPush(body.code, body, localStorage);
      return { code: body.code };
    } catch {
      return { code: null };
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
    this.resetUiForCityChange();
    const fresh = createLevelCity(level);
    this.adoptCity(packCells(fresh), buildMeta(fresh));
    refreshUtilities(this.city);
    this.enterLevel(id, `Level ${id} · ${level.title}`);
    this.rememberWorker(true);
    this.setTool("inspect");
    this.camera.resetOverview();
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
    this.beginSession(true);
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
      playSfx("win");
      this.hud.pulseFunds("good");
      this.camera.resetOverview();
      this.flash("Level geschafft.");
      return;
    }
    this.hud.showLevelEnd({
      won: false,
      title: "Zeit abgelaufen",
      text: "Die Aufgabe ist in der Zeit nicht fertig geworden. Nochmal versuchen oder zurück zur Levelwahl.",
      next: false,
    });
    playSfx("lose");
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

  private beginSession(level: boolean): void {
    this.hud.resetQuests();
    this.setBriefOpen(level && !isCompactHud());
    this.hud.showQuestIntro();
  }

  private setBriefOpen(open: boolean): void {
    this.briefOpen = open;
    this.hud.setBriefOpen(open);
    if (open) this.shrinkCompactHud("brief");
  }

  private setRosterOpen(open: boolean): void {
    if (open) {
      this.life.toggle(false);
      this.orders.toggle(false);
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
      this.life.toggle(false);
      this.orders.toggle(false);
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
    if (keep !== "brief") {
      this.briefOpen = false;
      this.hud.setBriefOpen(false);
    }
    this.hud.setMenuOpen(false);
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
    if (!fromLevelEnd) this.hud.setRoomName(suggestCityName(this.knownCodes()));
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
      savedAt: slot.savedAt,
    }));
    let remote: RoomListEntry[] = [];
    try {
      const [rooms, host] = await Promise.all([
        fetch(apiUrl("/api/rooms"), { cache: "no-store" }).then((response) => response.json() as Promise<RoomListEntry[]>),
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
    // Test phase: anyone may delete any city; only ask so clicks are intentional.
    if (!window.confirm(`Stadt „${code}“ wirklich löschen? Das gilt lokal und auf dem Server.`)) return;
    // Stop autosave from recreating the slot before the server delete finishes (B5).
    if (this.activeCityId === code) this.activeCityId = null;
    deleteCitySlot(code, localStorage);
    deleteCityAuth(code, localStorage);
    forgetCoopJoined(code, localStorage);
    this.serverSyncBlocked.delete(code);
    try {
      const response = await fetch(apiUrl(`/api/cities/${encodeURIComponent(code)}`), { method: "DELETE" });
      const body = (await response.json()) as { ok?: boolean; reason?: string };
      if (!response.ok || !body.ok) {
        if (body.reason === "in_use") {
          this.hud.setSaveNote("Die Stadt ist gerade im Koop offen. Lokal ist sie gelöscht; der laufende Raum bleibt bis alle raus sind.");
          await this.refreshLobby();
          return;
        }
        if (body.reason === "missing") {
          this.hud.setSaveNote(`„${code}“ ist gelöscht.`);
          await this.refreshLobby();
          return;
        }
        this.hud.setSaveNote("Die Stadt ließ sich nicht vollständig löschen.");
        await this.refreshLobby();
        return;
      }
      this.hud.setSaveNote(`„${code}“ ist gelöscht.`);
      await this.refreshLobby();
    } catch {
      this.hud.setSaveNote(`„${code}“ ist lokal gelöscht. Der Server war nicht erreichbar.`);
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
    const pushed = save && this.mode === "single" && !this.serverSyncBlocked.has(this.activeCityId)
      ? await this.pushCityToServer(save)
      : { code: null, reason: this.mode === "multi" ? "multi" : "stale" };
    const code = pushed.code;
    if (!code) {
      this.hud.setSaveNote(pushed.reason === "multi"
        ? "Lokal gesichert. Im Koop speichert der Server die Stadt selbst."
        : pushed.reason
          ? "Lokal gesichert. Auf dem Server liegt ein neuerer oder fremder Stand dieser Stadt; er wurde nicht überschrieben."
          : "Lokal gesichert. Der Koop-Server hat die Stadt nicht übernommen.");
      await this.refreshLobby();
      return;
    }
    this.hud.setSaveNote(`„${display}“ ist gespeichert (${code}), inklusive Straßen, Leitungen, Zonen, Gebäuden, Bildung und Kasse. Im Koop öffnen lädt genau diese Stadt.`);
    await this.refreshLobby();
  }

  private showCell(cell: { x: number; y: number }): void {
    const index = cellIndex(this.city, cell.x, cell.y);
    if (this.city.services[index] === ServiceKind.Tierpark && !this.city.progress?.off) {
      this.focus = null;
      this.selected = index;
      this.hud.hideInspect();
      this.parkView.showGate(this.city, index);
      return;
    }
    this.parkView.hideGate();
    if (habitatTypeOf(this.city.services[index]) && !this.city.progress?.off) {
      this.focus = null;
      this.selected = index;
      this.hud.hideInspect();
      this.zooView.showHabitat(this.city, index);
      return;
    }
    this.zooView.hide();
    this.selected = index;
    this.focus = "cell";
    const families = houseReport(this.city, index);
    const service = serviceInfo(this.city.services[index]);
    const powered = (this.city.utility[index] & POWER_BIT) !== 0;
    const watered = (this.city.utility[index] & WATER_BIT) !== 0;
    const workplace = isWorkplace(this.city, index);
    const farm = workplace && this.city.zones[index] === Zone.Farm;
    const hub = isHub(this.city, index);
    const happy = families.length > 0 ? houseHappiness(this.city, index) : null;
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
    const farmInfo = farm ? farmStatus(this.city, index) : null;
    this.setRosterOpen(false);
    this.setChatOpen(false);
    this.shrinkCompactHud("inspect");
    if (hub) {
      const kind = this.city.services[index] === ServiceKind.Harbor ? "harbor" : "airport";
      const partner = logisticsPartner(this.city, index);
      const partnerSpot = partner !== null ? cellCoords(this.city, partner) : null;
      const staffed = employeesAt(this.city, index);
      const openingsHere = jobOpenings(this.city, index);
      const seekingHub = openingsHere > 0 ? unemployedAdults(this.city).slice(0, 8) : [];
      const fish = kind === "harbor" ? harborYield(this.city, index, staffed.length) : 0;
      const heat = this.city.tradeHeat ?? 0;
      const earn = hubIncome(this.city, index);
      const slots = hubSlots(this.city, index);
      const used = pendingAt(this.city, index);
      this.hud.showInspect({
        kind,
        kicker: kind === "harbor" ? "Seeverkehr" : "Luftverkehr",
        title: kind === "harbor" ? "Hafen" : "Flughafen",
        stats: [
          { icon: "bolt", label: "Strom", value: powered ? "an" : "fehlt", tone: powered ? "good" : "bad" },
          { icon: "drop", label: "Wasser", value: watered ? "an" : "fehlt", tone: watered ? "good" : "bad" },
          { icon: kind === "harbor" ? "boat" : "plane", label: "Ertrag", value: `+${earn} € / 2 s`, tone: "good" },
          { icon: "work", label: "Handel", value: `${used}/${slots} Plätze` },
          { icon: "food", label: "Stadtnahrung", value: String(this.city.food) },
          { icon: "people", label: "Markt", value: heat <= 12 ? "frei" : `satt ${heat}%`, tone: heat >= 70 ? "bad" : "good" },
          ...(kind === "harbor" ? [{ icon: "food" as const, label: "Fischerei", value: staffed.length === 0 ? "ohne Arbeiter 0" : `+${fish}`, tone: fish > 0 ? "good" as const : "bad" as const }] : []),
          { icon: "work", label: "Jobs", value: `${staffed.length} belegt · ${openingsHere} frei` },
        ],
        families: [],
        hires: seekingHub.map((adult) => ({
          name: adult.name,
          detail: `${adult.educationLabel} · Feld ${cellCoords(this.city, adult.home).x},${cellCoords(this.city, adult.home).y}`,
          home: adult.home,
          slot: adult.slot,
        })),
        trade: TRADE.map((deal) => {
          const quote = quoteTrade(this.city, index, deal);
          const enabled = this.canTrade(deal.id);
          const delay = quote?.delay ?? 0;
          const profit = quote && deal.side === "export"
            ? `+${quote.price.toLocaleString("de-DE")} €`
            : quote
              ? `−${quote.price.toLocaleString("de-DE")} €`
              : "";
          return {
            id: deal.id,
            name: deal.name,
            side: deal.side,
            detail: quote?.detail ?? tradeEffect(deal),
            price: `${(quote?.price ?? deal.price).toLocaleString("de-DE")} €`,
            enabled,
            hint: enabled ? null : this.tradeBlockReason(deal.id),
            route: kind === "harbor" ? "Schiff → Hafen" : "Flug → Flughafen",
            goods: deal.food ? `${quote?.food ?? deal.food} Nahrung` : deal.requires === "industrial" ? "Maschinen" : deal.requires === "commercial" ? "Waren" : deal.name,
            time: delay <= 0 ? "sofort" : `${delay} Ticks`,
            capacity: quote ? `${quote.used}/${quote.slots} Plätze` : "",
            profit,
          };
        }),
        note: [
          kind === "harbor"
            ? "Hafen: mehr Menge, niedrigere Preise, längere Lieferzeit. Schiffe fahren raus aufs Meer."
            : "Flughafen: schnell, teurer, weniger Kapazität. Flugzeuge starten und landen.",
          partnerSpot
            ? `Logistik-Verbund mit ${kind === "harbor" ? "Flughafen" : "Hafen"} ${partnerSpot.x},${partnerSpot.y}: günstigere Umschläge, Touristen, extra Handelsplatz.`
            : "Mit Hafen und Flughafen in der Nähe (Straße oder 14 Felder) entsteht ein Logistik-Verbund.",
          heat > 20 ? `Exportpreise bei Marktsättigung ${Math.round(marketMultiplier(heat) * 100)} %. Erholt sich mit der Zeit.` : null,
          powered && watered ? null : "Ohne Strom oder Wasser bleibt das Gebäude dunkel — Handel geht trotzdem, Fischerei und Jobs schwächeln.",
        ].filter(Boolean).join(" "),
        budget: cellBudget(this.city, index),
        gift: null,
      });
      return;
    }
    this.hud.showInspect({
      kind: service?.kind === ServiceKind.Power ? "power" : service?.kind === ServiceKind.Water ? "water" : farm ? "farm" : workplace ? "work" : families.length > 0 ? "home" : "field",
      kicker: farm ? "Landwirtschaft" : service ? "Gebäude" : workplace ? (this.city.zones[index] === Zone.Industrial ? "Industrie" : "Gewerbe") : families.length > 0 ? "Wohnhaus" : "Feld",
      title: service?.name ?? (farm ? (farmInfo?.livestock ? "Bauernhof mit Tieren" : "Bauernhof · Getreide") : families.length > 0 || workplace ? `Stufe ${this.city.levels[index]}` : `${cell.x}, ${cell.y}`),
      stats: [
        { icon: "bolt", label: "Strom", value: powered ? "versorgt" : "ohne", tone: powered ? "good" : "bad" },
        { icon: "drop", label: "Wasser", value: watered ? "versorgt" : "ohne", tone: watered ? "good" : "bad" },
        ...(families.length > 0 ? [
          { icon: "people" as const, label: "Bewohner", value: `${this.city.levels[index] * 12} · ${families.length} Haushalte` },
          { icon: "car" as const, label: "Autos", value: String(families.reduce((sum, family) => sum + family.cars.length, 0)) },
          { icon: "food" as const, label: "Nahrung", value: meals >= 1 ? "satt" : "knapp", tone: meals >= 1 ? "good" as const : "bad" as const },
          { icon: "people" as const, label: "Glück", value: happy?.label ?? "—", tone: happy && happy.score >= 0.7 ? "good" as const : happy?.beach ? "good" as const : undefined },
          { icon: "book" as const, label: "Schule", value: school ? "im Viertel" : "fehlt", tone: school ? "good" as const : "bad" as const },
          { icon: "book" as const, label: "Universität", value: university ? "im Viertel" : "fehlt", tone: university ? "good" as const : "bad" as const },
        ] : []),
        ...(workplace ? [
          { icon: "work" as const, label: "Frei", value: String(openings) },
          { icon: "people" as const, label: "Belegt", value: String(staff.length) },
          { icon: "bolt" as const, label: "Ertrag", value: (this.city.utility[index] & (POWER_BIT | WATER_BIT)) === (POWER_BIT | WATER_BIT) ? "voll versorgt" : "ohne Strom/Wasser kaum Ertrag" },
        ] : []),
        ...(farm && farmInfo ? [
          { icon: "food" as const, label: "Anbau", value: farmInfo.cropLabel, tone: "good" as const },
          { icon: "food" as const, label: "Nahrung", value: staff.length === 0 ? "ohne Arbeiter 0" : `${harvest} von ${staff.length} Arbeitern`, tone: harvest > 0 ? "good" as const : "bad" as const },
          { icon: "drop" as const, label: "Bewässerung", value: farmInfo.irrigation ? "angelegt" : "fehlt", tone: farmInfo.irrigation ? "good" as const : "bad" as const },
          { icon: "home" as const, label: "Silo", value: farmInfo.silo ? "steht" : "fehlt", tone: farmInfo.silo ? "good" as const : "bad" as const },
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
      trade: farm
        ? (["livestock", "wheat", "irrigation", "silo"] as const).map((action) => {
          const upgrade = FARM_UPGRADES[action];
          const available = farmActionAvailable(this.city, index, action);
          const canPay = this.city.funds >= upgrade.cost;
          const enabled = available.ok && canPay;
          return {
            id: `farm:${action}`,
            name: upgrade.name,
            side: upgrade.side,
            detail: upgrade.detail,
            price: `${upgrade.cost.toLocaleString("de-DE")} €`,
            enabled,
            hint: !available.ok ? available.hint : !canPay ? "Zu wenig Geld in der Kasse." : null,
          };
        })
        : [],
      note: farm
        ? [
          farmInfo ? `${farmInfo.modeLabel}: ${farmInfo.cropLabel}.` : "",
          staff.length > 0 ? `Arbeiter: ${staff.map((adult) => adult.name).join(", ")}. Nahrung ${harvest}.` : "Ohne Arbeiter wächst hier fast nichts.",
          "Standard ist Getreide. Tiere bringen mehr Nahrung, sind von außen als Weide zu sehen.",
          seeking.length > 0 ? "Arbeitslose anstellen." : "",
        ].filter(Boolean).join(" ")
        : service?.blurb
        ?? (workplace ? [staff.length > 0 ? `Beschäftigt: ${staff.map((adult) => adult.name).join(", ")}` : "Noch niemand angestellt.", seeking.length > 0 ? "Arbeitslose aus der Stadt anstellen." : ""].filter(Boolean).join(" ") : null)
        ?? (happy?.beach ? "Die Bewohner gehen an den Strand — starkes Glück, grüne Smileys über den Köpfen." : null)
        ?? (unemployedHere ? "Arbeitslose stellt man im Gewerbe, in der Industrie, am Hafen, Flughafen oder auf dem Bauernhof an." : null)
        ?? (families.length === 0 && !service ? (isRoad(this.city, index) ? "Straße" : "Hier ist nichts gebaut.") : null),
      budget: occupied ? cellBudget(this.city, index) : null,
      gift: families.length > 0 && !gifted ? `Studium finanzieren (${scholarshipCost(this.city.levels[index])} €)` : null,
    });
  }

  private showCar(car: { surname: string; driver: string; members: string; label: string; home: number }): void {
    this.zooView.hide();
    this.parkView.hideGate();
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
    if (deal.startsWith("farm:")) {
      const action = deal.slice(5);
      if (!isFarmAction(action)) return;
      this.applyLocal({ type: "farm", index: this.selected, action });
      if (this.focus === "cell") this.showCell(cellCoords(this.city, this.selected));
      return;
    }
    const listed = TRADE.find((entry) => entry.id === deal);
    const quote = listed ? quoteTrade(this.city, this.selected, listed) : null;
    this.applyLocal({ type: "trade", index: this.selected, deal });
    if (quote && quote.delay <= 0) {
      if (quote.side === "export") this.flash(`Ankunft: +${quote.price.toLocaleString("de-DE")} €`);
      else if (quote.food > 0) this.flash(`Ankunft: +${quote.food} Nahrung`);
    }
    if (this.focus === "cell") this.showCell(cellCoords(this.city, this.selected));
  }

  private canTrade(dealId: string): boolean {
    return this.tradeBlockReason(dealId) === null;
  }

  private tradeBlockReason(dealId: string): string | null {
    if (this.selected < 0) return "Kein Gebäude gewählt.";
    return hubTradeReason(this.city, this.selected, dealId);
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

const OVERLAY_KEY = "cityline.overlays";
const ROOM_KEY = "cityline.lastRoom";

function loadOverlays(): { zones: boolean; power: boolean; water: boolean } {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return { zones: true, power: false, water: false };
    const parsed = JSON.parse(raw) as Partial<{ zones: boolean; power: boolean; water: boolean }>;
    return {
      zones: parsed.zones !== false,
      power: !!parsed.power,
      water: !!parsed.water,
    };
  } catch {
    return { zones: true, power: false, water: false };
  }
}

function saveOverlays(overlays: { zones: boolean; power: boolean; water: boolean }): void {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlays));
  } catch {
    /* ignore quota */
  }
}

function saveLastRoomName(value: string): void {
  const clean = value.trim().slice(0, 24);
  if (!clean) return;
  try {
    localStorage.setItem(ROOM_KEY, clean);
  } catch {
    /* ignore quota */
  }
}

function tradeEffect(deal: (typeof TRADE)[number]): string {
  if (deal.food && deal.food > 0) return `+${deal.food} Nahrung`;
  if (deal.food && deal.food < 0) return `${deal.food} Nahrung`;
  if (deal.requires === "commercial") return "aus dem Gewerbe";
  if (deal.requires === "industrial") return "aus der Industrie";
  return deal.blurb;
}
