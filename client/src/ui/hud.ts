import {
  BIOMES,
  biomePreset,
  cityTitle,
  climateAt,
  createCity,
  currentGoal,
  formatClock,
  GOALS,
  LEVELS,
  normalizeSeed,
  randomSeed,
  type BiomeId,
  type ChatMessage,
  type LevelStatus,
  type MapGenOptions,
  type SimMeta,
} from "../../../shared/src/index.ts";
import { playSfx } from "../audio/sfx.ts";
import { paintMapPreview } from "../render/mapPreview.ts";
import { CHANGELOG, type PatchNote } from "./changelog.ts";
import { isCompactHud, onCompactHudChange } from "./layout.ts";

export type ToolId =
  | "inspect"
  | "road"
  | "bridge"
  | "fill"
  | "cottage"
  | "apartments"
  | "tower"
  | "shop"
  | "office"
  | "mall"
  | "workshop"
  | "factory"
  | "plant"
  | "farm"
  | "line"
  | "pipe"
  | "power"
  | "water"
  | "school"
  | "clinic"
  | "police"
  | "fire"
  | "park"
  | "university"
  | "airport"
  | "lamp"
  | "bulldoze";

export interface RoomCard {
  code: string;
  name?: string;
  players: number;
  population: number;
  funds: number;
  level?: number | null;
  savedAt?: string;
}

export interface RosterPlayer {
  id: string;
  name: string;
  self: boolean;
  present: boolean;
}

export type InspectKind = "field" | "home" | "work" | "car" | "power" | "water" | "airport" | "farm";

export interface InspectStat {
  icon: "people" | "family" | "car" | "bolt" | "drop" | "book" | "home" | "work" | "food" | "plane";
  label: string;
  value: string;
  tone?: "good" | "bad";
}

export interface InspectPerson {
  name: string;
  child: boolean;
  education: string;
  job: string;
  unemployed: boolean;
}

export interface InspectFamily {
  surname: string;
  cars: string[];
  members: InspectPerson[];
}

export interface InspectHire {
  name: string;
  detail: string;
  home: number;
  slot: number;
}

export interface InspectTrade {
  id: string;
  name: string;
  side: "import" | "export";
  /** Short effect, e.g. "+2 Nahrung". */
  detail: string;
  price: string;
  enabled: boolean;
  /** Why the deal is locked, if any. */
  hint?: string | null;
}

export interface InspectView {
  kind: InspectKind;
  kicker: string;
  title: string;
  stats: InspectStat[];
  families: InspectFamily[];
  hires: InspectHire[];
  trade?: InspectTrade[];
  note: string | null;
  budget: number | null;
  gift: string | null;
}

export interface HudControls {
  onTool: (tool: ToolId) => void;
  onOverlay: (overlay: "zones" | "power" | "water", enabled: boolean) => void;
  onLeave: () => void;
  onNewSolo: () => void;
  onNewCoop: () => void;
  onContinue: () => void;
  onOpenSolo: (code: string) => void;
  onOpenCoop: (code: string) => void;
  onOpenLobby: () => void;
  onLobbyBack: () => void;
  onSave: () => void;
  onDelete: (code: string) => void;
  onBudget: (value: number) => void;
  onGift: () => void;
  onHire: (home: number, slot: number) => void;
  onTrade: (deal: string) => void;
  onCloseInspect: () => void;
  onStartLevel: (id: number) => void;
  onStartLevelCoop: (id: number) => void;
  onRetryLevel: () => void;
  onNextLevel: () => void;
  onOpenLevelSelect: () => void;
  onToggleBrief: () => void;
  onCloseBrief: () => void;
  onToggleRoster: () => void;
  onToggleChat: () => void;
  onSendChat: (text: string) => void;
  onFocusPlayer: (id: string) => void;
  onNameReady: (name: string) => void;
  onTogglePan: () => void;
  onToggleOrbit: () => void;
  onCompactPanel: (panel: "menu" | "demand" | "stats") => void;
  onRoomNameChange?: (name: string) => void;
}

const money = new Intl.NumberFormat("de-DE");

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")} Mio`;
  if (abs >= 10_000) return `${Math.round(value / 1000)} k`;
  return money.format(value);
}

export interface Hud {
  setTool: (tool: ToolId) => void;
  setStats: (meta: SimMeta) => void;
  setStatus: (text: string) => void;
  setHint: (text: string) => void;
  setMode: (text: string) => void;
  setPlayers: (text: string) => void;
  setJoined: (joined: boolean) => void;
  setLobby: (open: boolean) => void;
  setHost: (text: string) => void;
  setSaveNote: (text: string) => void;
  showSaveToast: (text?: string) => void;
  setContinueVisible: (visible: boolean) => void;
  setLobbyBackVisible: (visible: boolean) => void;
  setRooms: (rooms: RoomCard[]) => void;
  setLevelUnlock: (unlocked: number, current?: number | null) => void;
  setPlayKind: (kind: "free" | "level") => void;
  setLevelBrief: (status: LevelStatus | null) => void;
  setMission: (summary: string) => void;
  setBriefOpen: (open: boolean) => void;
  setRoster: (players: RosterPlayer[], note: string) => void;
  setRosterOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setChatMessages: (messages: ChatMessage[], selfId: string) => void;
  setChatUnread: (count: number) => void;
  setChatEnabled: (enabled: boolean, note: string) => void;
  setPanMode: (on: boolean) => void;
  setOrbitMode: (on: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setDemandOpen: (open: boolean) => void;
  setStatsOpen: (open: boolean) => void;
  setPeerCursors: (cursors: { id: string; name: string; x: number; y: number }[]) => void;
  setBuildCursor: (view: { x: number; y: number; label: string; hint?: string; kind?: "build" | "orbit" } | null) => void;
  pulseFunds: (tone?: "good" | "bad") => void;
  setInspecting: (open: boolean) => void;
  showNameGate: (open: boolean, preset?: string) => void;
  setGateError: (text: string) => void;
  showLevelEnd: (view: { won: boolean; title: string; text: string; next: boolean }) => void;
  hideLevelEnd: () => void;
  showInspect: (view: InspectView) => void;
  hideInspect: () => void;
  setPlayerName: (name: string) => void;
  setRoomName: (name: string) => void;
  setOverlays: (overlays: { zones: boolean; power: boolean; water: boolean }) => void;
  closeOverlays: () => boolean;
  clearToast: () => void;
  playerName: () => string;
  roomName: () => string;
  mapGenOptions: () => MapGenOptions;
}

export function createHud(events: HudControls): Hud {
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>("#rail button[data-tool], #tool-inspect-hud")];
  const togglePan = requiredButton("#toggle-pan");
  const togglePanHud = requiredButton("#toggle-pan-hud");
  const toggleOrbit = requiredButton("#toggle-orbit");
  const toggleOrbitHud = requiredButton("#toggle-orbit-hud");
  const inspectHud = requiredButton("#tool-inspect-hud");
  const buildCursorHint = required("#build-cursor-hint");
  const toggleDemand = requiredButton("#toggle-demand");
  const toggleStats = requiredButton("#toggle-stats");
  const peerCursors = required("#peer-cursors");
  const buildCursor = required("#build-cursor");
  const buildCursorTool = required("#build-cursor-tool");
  const funds = required<HTMLElement>("#funds");
  let fundsPulseTimer = 0;
  const clock = required("#clock");
  const weather = required<HTMLElement>("#weather");
  const weatherLabel = required("#weather-label");
  const vibeLabel = required("#vibe-label");
  const pop = required("#pop");
  const jobs = required("#jobs");
  const power = required("#power");
  const water = required("#water");
  const food = required("#food");
  const foodStock = required("#food-stock");
  const traffic = required("#traffic");
  const status = required("#status");
  const hint = required("#hint");
  const mode = required("#mode");
  const players = required("#players");
  const leave = requiredButton("#leave");
  const room = requiredInput("#room");
  const name = requiredInput("#name");
  const lobby = required("#lobby");
  const host = required("#host-note");
  const list = required("#room-list");
  const liveList = required("#live-rooms");
  const liveHeading = required("#live-heading");
  const liveNote = required("#live-note");
  const inspector = required("#inspector");
  const budgetWrap = required("#insp-budget-wrap");
  const budget = requiredInput("#insp-budget");
  const budgetLabel = required("#insp-budget-label");
  const gift = requiredButton("#insp-gift");
  const stats = required("#insp-stats");
  const families = required("#insp-families");
  const hires = required("#insp-hires");
  const trade = required("#insp-trade");
  const note = required("#insp-note");
  const toggleRail = requiredButton("#toggle-rail");
  const toggleLabel = required("#toggle-label");
  const notes = required("#notes");
  const notesCurrent = required("#notes-current");
  const notesList = required("#notes-list");
  const brief = required("#brief");
  const briefKicker = required("#brief-kicker");
  const briefTitle = required("#brief-title");
  const briefText = required("#brief-text");
  const briefPay = required("#brief-pay");
  const briefGoals = required("#brief-goals");
  const briefTime = required("#brief-time");
  const briefRetry = requiredButton("#brief-retry");
  const mission = required("#mission-summary");
  const roster = required("#roster");
  const rosterList = required("#roster-list");
  const rosterNote = required("#roster-note");
  const chat = required("#chat");
  const chatLog = required("#chat-log");
  const chatNote = required("#chat-note");
  const chatInput = requiredInput("#chat-input");
  const chatSend = requiredButton("#chat-send");
  const chatBadge = required("#chat-badge");
  const openChat = requiredButton("#open-chat");
  const nameGate = required("#name-gate");
  const gateName = requiredInput("#gate-name");
  const gateError = required("#gate-error");
  const levelGrid = required("#level-grid");
  const levelEnd = required("#level-end");
  const levelEndSheet = required(".level-sheet");
  const toast = required("#toast");
  const saveToast = required("#save-toast");
  const rank = required("#rank");
  let seenGoals: number | null = null;
  let toastTimer = 0;
  let saveToastTimer = 0;
  let levelMode = false;
  for (const level of LEVELS) {
    const card = document.createElement("div");
    card.className = "level-card";
    card.dataset.level = String(level.id);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = String(level.id);
    button.addEventListener("click", () => {
      if (button.disabled) return;
      events.onStartLevel(level.id);
    });
    const coop = document.createElement("button");
    coop.type = "button";
    coop.className = "coop";
    coop.dataset.level = String(level.id);
    coop.textContent = "Koop";
    coop.addEventListener("click", () => {
      if (coop.disabled) return;
      events.onStartLevelCoop(level.id);
    });
    card.append(button, coop);
    levelGrid.append(card);
  }
  const latest = CHANGELOG[0];
  if (latest) {
    required("#notes-version").textContent = latest.version;
    notesCurrent.append(renderNote(latest, true));
    for (const entry of CHANGELOG.slice(1)) notesList.append(renderNote(entry, false));
  }
  const paintNotes = (open: boolean) => {
    notes.hidden = !open;
  };
  requiredButton("#open-notes").addEventListener("click", () => paintNotes(notes.hidden));
  requiredButton("#notes-close").addEventListener("click", () => paintNotes(false));
  let menuOpen = !isCompactHud();
  let demandOpen = false;
  let statsOpen = true;
  const paintMenu = () => {
    document.body.dataset.menu = menuOpen ? "open" : "closed";
    toggleLabel.textContent = isCompactHud() ? "Bauen" : menuOpen ? "Menü zuklappen" : "Menü aufklappen";
    toggleRail.setAttribute("aria-expanded", String(menuOpen));
    toggleRail.setAttribute("aria-label", menuOpen ? "Baumenü zuklappen" : "Baumenü aufklappen");
  };
  const paintDemandOpen = () => {
    document.body.dataset.demand = demandOpen ? "open" : "closed";
    toggleDemand.setAttribute("aria-expanded", String(demandOpen));
    toggleDemand.classList.toggle("active", demandOpen);
  };
  const paintStatsOpen = () => {
    document.body.dataset.stats = statsOpen ? "open" : "closed";
    toggleStats.setAttribute("aria-expanded", String(statsOpen));
    toggleStats.classList.toggle("active", !statsOpen);
    const label = statsOpen ? "Werte ausblenden" : "Werte einblenden";
    toggleStats.setAttribute("aria-label", label);
    toggleStats.title = label;
  };
  toggleRail.addEventListener("click", () => {
    menuOpen = !menuOpen;
    paintMenu();
    if (menuOpen) events.onCompactPanel("menu");
  });
  toggleDemand.addEventListener("click", () => {
    demandOpen = !demandOpen;
    paintDemandOpen();
    if (demandOpen) events.onCompactPanel("demand");
  });
  requiredButton("#demand-close").addEventListener("click", () => {
    demandOpen = false;
    paintDemandOpen();
  });
  const statTips = wireStatTips();
  toggleStats.addEventListener("click", () => {
    statsOpen = !statsOpen;
    paintStatsOpen();
    statTips.hide(true);
    if (statsOpen) events.onCompactPanel("stats");
  });
  onCompactHudChange((compact) => {
    if (compact) {
      menuOpen = false;
      demandOpen = false;
    } else {
      menuOpen = true;
      demandOpen = false;
    }
    paintMenu();
    paintDemandOpen();
    paintStatsOpen();
  });
  paintMenu();
  paintDemandOpen();
  paintStatsOpen();

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      events.onTool(button.dataset.tool as ToolId);
      if (isCompactHud()) {
        menuOpen = false;
        paintMenu();
      }
    });
  });
  togglePan.addEventListener("click", () => {
    events.onTogglePan();
    if (isCompactHud()) {
      menuOpen = false;
      paintMenu();
    }
  });
  togglePanHud.addEventListener("click", () => events.onTogglePan());
  toggleOrbit.addEventListener("click", () => {
    events.onToggleOrbit();
    if (isCompactHud()) {
      menuOpen = false;
      paintMenu();
    }
  });
  toggleOrbitHud.addEventListener("click", () => events.onToggleOrbit());
  for (const overlay of ["zones", "power", "water"] as const) {
    const input = document.querySelector<HTMLInputElement>(`#ov-${overlay}`);
    input?.addEventListener("change", () => events.onOverlay(overlay, input.checked));
  }
  const mapPreview = required<HTMLCanvasElement>("#map-preview");
  const mapBiome = required<HTMLSelectElement>("#map-biome");
  const mapBiomeBlurb = required("#map-biome-blurb");
  const mapSeed = requiredInput("#map-seed");
  const mapSeedRoll = requiredButton("#map-seed-roll");
  const mapWater = requiredInput("#map-water");
  const mapLakes = requiredInput("#map-lakes");
  const mapRivers = requiredInput("#map-rivers");
  const mapForest = requiredInput("#map-forest");
  const mapWaterLabel = required("#map-water-label");
  const mapLakesLabel = required("#map-lakes-label");
  const mapRiversLabel = required("#map-rivers-label");
  const mapForestLabel = required("#map-forest-label");
  let previewTimer = 0;

  const readMapGen = (): MapGenOptions => {
    // Pin seed into the field immediately so Solo/Koop can't race the preview timer.
    if (!mapSeed.value.trim()) mapSeed.value = String(randomSeed());
    return {
      seed: normalizeSeed(mapSeed.value.trim()),
      biome: (BIOMES.some((entry) => entry.id === mapBiome.value) ? mapBiome.value : "temperate") as BiomeId,
      water: Number(mapWater.value),
      lakes: Number(mapLakes.value),
      rivers: Number(mapRivers.value),
      forest: Number(mapForest.value),
    };
  };

  const applyBiomeDefaults = (id: BiomeId, keepSeed: boolean) => {
    const preset = biomePreset(id);
    mapBiomeBlurb.textContent = preset.blurb;
    mapWater.value = String(preset.water);
    mapLakes.value = String(preset.lakes);
    mapRivers.value = String(preset.rivers);
    mapForest.value = String(preset.forest);
    mapWaterLabel.textContent = String(preset.water);
    mapLakesLabel.textContent = String(preset.lakes);
    mapRiversLabel.textContent = String(preset.rivers);
    mapForestLabel.textContent = String(preset.forest);
    if (!keepSeed || !mapSeed.value.trim()) mapSeed.value = String(randomSeed());
  };

  const refreshMapPreview = () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const opts = readMapGen();
      if (!mapSeed.value.trim()) mapSeed.value = String(opts.seed);
      else opts.seed = normalizeSeed(mapSeed.value.trim());
      paintMapPreview(mapPreview, createCity(undefined, undefined, opts));
      mapPreview.dataset.ready = "1";
    }, 60);
  };

  const syncSliderLabel = (input: HTMLInputElement, label: HTMLElement) => {
    label.textContent = input.value;
  };

  mapBiome.addEventListener("change", () => {
    applyBiomeDefaults(mapBiome.value as BiomeId, true);
    refreshMapPreview();
  });
  mapSeedRoll.addEventListener("click", () => {
    mapSeed.value = String(randomSeed());
    refreshMapPreview();
  });
  mapSeed.addEventListener("change", () => refreshMapPreview());
  mapSeed.addEventListener("input", () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshMapPreview, 220);
  });
  for (const [input, label] of [
    [mapWater, mapWaterLabel],
    [mapLakes, mapLakesLabel],
    [mapRivers, mapRiversLabel],
    [mapForest, mapForestLabel],
  ] as const) {
    input.addEventListener("input", () => {
      syncSliderLabel(input, label);
      refreshMapPreview();
    });
  }
  applyBiomeDefaults("temperate", false);
  refreshMapPreview();

  requiredButton("#solo-new").addEventListener("click", () => events.onNewSolo());
  requiredButton("#coop-new").addEventListener("click", () => events.onNewCoop());
  requiredButton("#solo-continue").addEventListener("click", () => events.onContinue());
  requiredButton("#lobby-back").addEventListener("click", () => events.onLobbyBack());
  requiredButton("#lobby-close").addEventListener("click", () => events.onLobbyBack());
  requiredButton("#open-lobby").addEventListener("click", () => events.onOpenLobby());
  requiredButton("#open-brief").addEventListener("click", () => events.onToggleBrief());
  requiredButton("#brief-close").addEventListener("click", () => events.onCloseBrief());
  requiredButton("#open-players").addEventListener("click", () => events.onToggleRoster());
  requiredButton("#roster-close").addEventListener("click", () => events.onToggleRoster());
  openChat.addEventListener("click", () => events.onToggleChat());
  requiredButton("#chat-close").addEventListener("click", () => events.onToggleChat());
  required("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    events.onSendChat(chatInput.value);
    chatInput.value = "";
    chatInput.focus();
  });
  const stopPanelWheel = (event: WheelEvent) => event.stopPropagation();
  chat.addEventListener("wheel", stopPanelWheel, { passive: true });
  chatLog.addEventListener("wheel", stopPanelWheel, { passive: true });
  chatLog.addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });
  inspector.addEventListener("wheel", stopPanelWheel, { passive: true });
  required("#rail").addEventListener("wheel", stopPanelWheel, { passive: true });
  required("#rail").addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });
  requiredButton("#gate-enter").addEventListener("click", () => events.onNameReady(gateName.value));
  gateName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") events.onNameReady(gateName.value);
  });
  name.addEventListener("change", () => events.onNameReady(name.value));
  const paintRoomHint = () => {
    const tag = room.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "stadtname";
    const hintNode = document.querySelector("#level-coop-hint");
    if (hintNode) hintNode.innerHTML = `Zehn Aufgaben, allein oder zu zweit. Level 1 ist frei. Koop-Raum: <code>l3-${tag}</code>.`;
    events.onRoomNameChange?.(room.value);
  };
  room.addEventListener("input", paintRoomHint);
  room.addEventListener("change", paintRoomHint);
  paintRoomHint();
  briefRetry.addEventListener("click", () => events.onRetryLevel());
  requiredButton("#level-end-next").addEventListener("click", () => events.onNextLevel());
  requiredButton("#level-end-retry").addEventListener("click", () => events.onRetryLevel());
  requiredButton("#level-end-select").addEventListener("click", () => events.onOpenLevelSelect());
  requiredButton("#save-city").addEventListener("click", () => events.onSave());
  leave.addEventListener("click", () => events.onLeave());
  requiredButton("#insp-close").addEventListener("click", () => events.onCloseInspect());
  gift.addEventListener("click", () => events.onGift());
  budget.addEventListener("input", () => {
    budgetLabel.textContent = `${budget.value}%`;
    events.onBudget(Number(budget.value));
  });

  return {
    setTool(tool) {
      document.body.dataset.tool = tool;
      toolButtons.forEach((button) => {
        const on = button.dataset.tool === tool;
        button.classList.toggle("active", on);
        if (button === inspectHud) button.setAttribute("aria-pressed", String(on));
      });
    },
    setStats(meta) {
      const climate = climateAt(meta.tick);
      clock.textContent = climate.clock;
      weather.dataset.weather = climate.weather;
      weather.title = climate.weatherLabel;
      weatherLabel.textContent = climate.weatherLabel;
      vibeLabel.textContent = climate.vibeLabel;
      vibeLabel.dataset.rush = climate.rushHour ? "on" : "off";
      funds.textContent = `${compactMoney(meta.stats.funds)} €`;
      const flow = required<HTMLElement>("#cashflow");
      const net = meta.ledger.income - meta.ledger.upkeep;
      flow.textContent = `${net >= 0 ? "+" : "−"}${compactMoney(Math.abs(net))} / 2 s`;
      flow.style.color = net >= 0 ? "#9dca86" : "#e07a6a";
      pop.textContent = compactMoney(meta.stats.population);
      jobs.textContent = compactMoney(meta.stats.jobs);
      power.textContent = `${meta.stats.powerUsed}/${meta.stats.powerCapacity}`;
      water.textContent = `${meta.stats.waterUsed}/${meta.stats.waterCapacity}`;
      food.textContent = compactMoney(meta.stats.foodStock);
      foodStock.textContent = `Bedarf ${compactMoney(meta.stats.foodUsed)} · Erzeugung ${compactMoney(meta.stats.foodCapacity)}`;
      const hungry = meta.stats.foodUsed > 0 && meta.stats.foodUsed > meta.stats.foodCapacity + meta.stats.foodStock;
      foodStock.style.color = hungry ? "#e07a6a" : "#9dca86";
      traffic.textContent = `${meta.stats.traffic}`;
      paintDemand("r", meta.demand.residential);
      paintDemand("c", meta.demand.commercial);
      paintDemand("i", meta.demand.industrial);
      const title = cityTitle(meta.stats.population);
      rank.textContent = title.name;
      rank.title = title.next ? `${title.name} · noch ${money.format(title.left)} bis ${title.next}` : title.name;
      if (levelMode) return;
      const goals = meta.goals ?? 0;
      const done = GOALS.filter((goal) => (goals & goal.bit) !== 0).length;
      const goal = currentGoal(goals);
      briefGoals.hidden = true;
      briefTime.hidden = true;
      briefRetry.hidden = true;
      if (goal) {
        briefKicker.textContent = `Auftrag ${done + 1}/${GOALS.length}`;
        briefTitle.textContent = goal.title;
        briefText.textContent = goal.text;
        briefPay.hidden = false;
        briefPay.textContent = `+${money.format(goal.reward)} €`;
        mission.textContent = `${goal.title} · ${done + 1}/${GOALS.length}`;
      } else {
        briefKicker.textContent = `Aufträge ${GOALS.length}/${GOALS.length}`;
        briefTitle.textContent = "Die Stadt steht";
        briefText.textContent = "Alle Aufträge sind bezahlt. Bau weiter, worauf du Lust hast.";
        briefPay.hidden = true;
        mission.textContent = "Stadt steht";
      }
      const previous = seenGoals;
      if (previous !== null && goals !== previous) {
        const fresh = GOALS.filter((entry) => (goals & entry.bit) !== 0 && (previous & entry.bit) === 0);
        if (fresh.length > 0) {
          const pay = fresh.reduce((sum, entry) => sum + entry.reward, 0);
          toast.textContent = fresh.length === 1 ? `${fresh[0].title} erledigt, +${money.format(pay)} €` : `${fresh.length} Aufträge erledigt, +${money.format(pay)} €`;
          toast.hidden = false;
          toast.classList.remove("pop");
          void toast.offsetWidth;
          toast.classList.add("pop");
          playSfx("goal");
          funds.classList.remove("pulse-good", "pulse-bad");
          void funds.offsetWidth;
          funds.classList.add("pulse-good");
          window.clearTimeout(fundsPulseTimer);
          fundsPulseTimer = window.setTimeout(() => funds.classList.remove("pulse-good", "pulse-bad"), 700);
          window.clearTimeout(toastTimer);
          toastTimer = window.setTimeout(() => {
            toast.hidden = true;
            toast.classList.remove("pop");
          }, 3400);
        }
      }
      seenGoals = goals;
    },
    pulseFunds(tone = "good") {
      funds.classList.remove("pulse-good", "pulse-bad");
      void funds.offsetWidth;
      funds.classList.add(tone === "bad" ? "pulse-bad" : "pulse-good");
      window.clearTimeout(fundsPulseTimer);
      fundsPulseTimer = window.setTimeout(() => funds.classList.remove("pulse-good", "pulse-bad"), 700);
    },
    setStatus(text) { status.textContent = text; },
    setHint(text) { hint.textContent = text; },
    setMode(text) { mode.textContent = text; },
    setPlayers(text) { players.textContent = text; },
    setJoined(joined) { leave.hidden = !joined; },
    setLobby(open) { lobby.hidden = !open; },
    setHost(text) { host.textContent = text; },
    setSaveNote(text) { required("#save-note").textContent = text; },
    showSaveToast(text = "Stadt gespeichert") {
      saveToast.textContent = text;
      saveToast.hidden = false;
      saveToast.classList.remove("pop");
      void saveToast.offsetWidth;
      saveToast.classList.add("pop");
      window.clearTimeout(saveToastTimer);
      saveToastTimer = window.setTimeout(() => {
        saveToast.hidden = true;
        saveToast.classList.remove("pop");
      }, 2800);
    },
    setContinueVisible(visible) { requiredButton("#solo-continue").hidden = !visible; },
    setLobbyBackVisible(visible) { requiredButton("#lobby-back").hidden = !visible; },
    setLevelUnlock(unlocked, current = null) {
      for (const card of levelGrid.querySelectorAll<HTMLElement>(".level-card")) {
        const id = Number(card.dataset.level);
        const def = LEVELS.find((entry) => entry.id === id);
        const locked = id > Math.min(unlocked, LEVELS.length);
        const cleared = id < unlocked;
        card.classList.toggle("locked", locked);
        card.classList.toggle("cleared", cleared);
        card.classList.toggle("current", current === id);
        for (const button of card.querySelectorAll("button")) button.disabled = locked;
        const play = card.querySelector<HTMLButtonElement>("button[data-level]:not(.coop)");
        if (play) {
          const title = document.createElement("b");
          title.textContent = `Level ${id}`;
          const label = document.createElement("span");
          label.textContent = locked ? "Gesperrt" : (def?.title ?? "");
          play.replaceChildren(title, label);
        }
      }
    },
    setPlayKind(kind) {
      levelMode = kind === "level";
      document.body.dataset.play = kind;
      briefGoals.hidden = !levelMode;
      briefTime.hidden = true;
      briefRetry.hidden = !levelMode;
      if (levelMode) briefPay.hidden = true;
    },
    setLevelBrief(status) {
      if (!status) return;
      levelMode = true;
      document.body.dataset.play = "level";
      const done = status.objectives.filter((entry) => entry.done).length;
      briefKicker.textContent = `Level ${status.level.id}/${LEVELS.length} · ${done}/${status.objectives.length}`;
      briefTitle.textContent = status.level.title;
      briefText.textContent = status.level.blurb;
      briefPay.hidden = true;
      briefRetry.hidden = false;
      briefGoals.hidden = false;
      briefGoals.replaceChildren(...status.objectives.map((entry) => {
        const row = document.createElement("li");
        row.className = entry.done ? "done" : "";
        const label = document.createElement("b");
        label.textContent = entry.done ? `✓ ${entry.text}` : entry.text;
        const value = document.createElement("span");
        value.textContent = `${money.format(entry.current)}/${money.format(entry.target)}`;
        row.append(label, value);
        return row;
      }));
      if (status.remainingSeconds === null) {
        briefTime.hidden = true;
        mission.textContent = `Level ${status.level.id} · ${done}/${status.objectives.length}`;
      } else {
        briefTime.hidden = false;
        briefTime.textContent = `Zeit ${formatClock(status.remainingSeconds)}`;
        briefTime.classList.toggle("late", status.remainingSeconds <= 60);
        mission.textContent = `Level ${status.level.id} · ${done}/${status.objectives.length} · ${formatClock(status.remainingSeconds)}`;
      }
    },
    setMission(summary) { mission.textContent = summary; },
    setBriefOpen(open) {
      document.body.dataset.brief = open ? "open" : "closed";
      brief.hidden = !open;
    },
    setRoster(players, note) {
      rosterNote.textContent = note;
      rosterList.replaceChildren(...players.map((player) => {
        const row = document.createElement("div");
        row.className = "roster-row";
        const copy = document.createElement("div");
        const who = document.createElement("b");
        who.textContent = player.self ? `${player.name} (du)` : player.name;
        const state = document.createElement("span");
        state.textContent = player.present ? "verbunden" : "nicht da";
        copy.append(who, state);
        row.append(copy);
        if (!player.self) {
          const look = document.createElement("button");
          look.type = "button";
          look.textContent = "Anschauen";
          look.addEventListener("click", () => events.onFocusPlayer(player.id));
          row.append(look);
        }
        return row;
      }));
    },
    setRosterOpen(open) {
      roster.hidden = !open;
      document.body.dataset.roster = open ? "on" : "off";
    },
    setChatOpen(open) {
      chat.hidden = !open;
      document.body.dataset.chat = open ? "on" : "off";
      if (open) {
        chatLog.scrollTop = chatLog.scrollHeight;
        if (!isCompactHud()) chatInput.focus();
      }
    },
    setMenuOpen(open) {
      menuOpen = open;
      paintMenu();
    },
    setDemandOpen(open) {
      demandOpen = open;
      paintDemandOpen();
    },
    setStatsOpen(open) {
      statsOpen = open;
      paintStatsOpen();
    },
    setChatMessages(messages, selfId) {
      const slack = 48;
      const stick = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight <= slack;
      chatLog.replaceChildren(...messages.map((message) => {
        const row = document.createElement("div");
        row.className = message.playerId === selfId ? "chat-row self" : "chat-row";
        const who = document.createElement("b");
        who.textContent = message.playerId === selfId ? `${message.name} (du)` : message.name;
        const body = document.createElement("p");
        body.textContent = message.text;
        row.append(who, body);
        return row;
      }));
      if (stick) chatLog.scrollTop = chatLog.scrollHeight;
    },
    setChatUnread(count) {
      const unread = count > 0;
      chatBadge.hidden = !unread;
      chatBadge.textContent = unread ? String(count) : "";
      openChat.classList.toggle("unread", unread);
    },
    setChatEnabled(enabled, note) {
      chatNote.textContent = note;
      chatNote.hidden = false;
      chatInput.disabled = !enabled;
      chatSend.disabled = !enabled;
      chatInput.placeholder = enabled ? "Nachricht" : "Nur im Koop";
    },
    setOverlays(overlays) {
      const zones = document.querySelector<HTMLInputElement>("#ov-zones");
      const power = document.querySelector<HTMLInputElement>("#ov-power");
      const water = document.querySelector<HTMLInputElement>("#ov-water");
      if (zones) zones.checked = overlays.zones;
      if (power) power.checked = overlays.power;
      if (water) water.checked = overlays.water;
    },
    closeOverlays() {
      let closed = false;
      if (!notes.hidden) {
        paintNotes(false);
        closed = true;
      }
      if (!lobby.hidden) {
        lobby.hidden = true;
        closed = true;
      }
      return closed;
    },
    clearToast() {
      toast.hidden = true;
      window.clearTimeout(toastTimer);
    },
    setPanMode(on) {
      togglePan.classList.toggle("active", on);
      togglePan.setAttribute("aria-pressed", String(on));
      togglePanHud.classList.toggle("active", on);
      togglePanHud.setAttribute("aria-pressed", String(on));
      document.body.dataset.pan = on ? "on" : "off";
    },
    setOrbitMode(on) {
      toggleOrbit.classList.toggle("active", on);
      toggleOrbit.setAttribute("aria-pressed", String(on));
      toggleOrbitHud.classList.toggle("active", on);
      toggleOrbitHud.setAttribute("aria-pressed", String(on));
      document.body.dataset.orbit = on ? "on" : "off";
    },
    setBuildCursor(view) {
      if (!view) {
        buildCursor.hidden = true;
        document.body.dataset.build = "off";
        return;
      }
      document.body.dataset.build = "on";
      buildCursor.hidden = false;
      buildCursor.dataset.kind = view.kind ?? "build";
      buildCursorTool.textContent = view.label;
      buildCursorHint.textContent = view.hint ?? "Doppelklick beendet";
      buildCursor.style.left = `${Math.round(view.x)}px`;
      buildCursor.style.top = `${Math.round(view.y)}px`;
    },
    setPeerCursors(cursors) {
      const existing = new Map(
        [...peerCursors.children].map((node) => [(node as HTMLElement).dataset.id ?? "", node as HTMLElement]),
      );
      const kept = new Set<string>();
      for (const cursor of cursors) {
        kept.add(cursor.id);
        let mark = existing.get(cursor.id);
        if (!mark) {
          mark = document.createElement("div");
          mark.className = "peer-cursor";
          mark.dataset.id = cursor.id;
          mark.append(document.createElement("i"), document.createElement("b"));
          peerCursors.append(mark);
        }
        mark.style.left = `${Math.round(cursor.x)}px`;
        mark.style.top = `${Math.round(cursor.y)}px`;
        const label = mark.querySelector("b");
        if (label) label.textContent = cursor.name;
      }
      for (const [id, node] of existing) {
        if (!kept.has(id)) node.remove();
      }
    },
    setInspecting(open) { document.body.dataset.inspect = open ? "on" : "off"; },
    showNameGate(open, preset = "") {
      nameGate.hidden = !open;
      gateError.hidden = true;
      gateError.textContent = "";
      if (open && preset) gateName.value = preset;
      if (open) gateName.focus();
    },
    setGateError(text) {
      gateError.textContent = text;
      gateError.hidden = !text;
    },
    setPlayerName(value) {
      name.value = value;
      gateName.value = value;
    },
    setRoomName(value) {
      room.value = value;
      paintRoomHint();
    },
    showLevelEnd(view) {
      levelEnd.hidden = false;
      levelEndSheet.classList.toggle("fail", !view.won);
      levelEndSheet.classList.remove("enter");
      void levelEndSheet.offsetWidth;
      levelEndSheet.classList.add("enter");
      required("#level-end-kicker").textContent = view.won ? "Level-Modus" : "Nicht geschafft";
      required("#level-end-title").textContent = view.won ? "Level geschafft" : view.title;
      required("#level-end-text").textContent = view.text;
      requiredButton("#level-end-next").hidden = !view.won || !view.next;
    },
    hideLevelEnd() {
      levelEnd.hidden = true;
      levelEndSheet.classList.remove("enter");
    },
    setRooms(entries) {
      const live = entries.filter((entry) => entry.players > 0);
      const saved = entries.filter((entry) => entry.players === 0);
      liveHeading.hidden = live.length === 0;
      liveNote.hidden = live.length === 0;
      liveList.hidden = live.length === 0;
      liveList.replaceChildren(...live.map((entry) => roomRow(entry, {
        onSolo: () => {
          room.value = entry.code;
          events.onOpenSolo(entry.code);
        },
        onCoop: () => {
          room.value = entry.code;
          events.onOpenCoop(entry.code);
        },
        onDelete: () => events.onDelete(entry.code),
        live: true,
      })));
      list.replaceChildren();
      if (saved.length === 0) {
        list.append(roomsEmpty(
          live.length > 0 ? "Keine weiteren gespeicherten Städte" : "Noch keine gespeicherte Stadt",
          live.length > 0
            ? "Oben in der Liste sind die Räume, in denen gerade jemand spielt."
            : "Lege oben eine neue Stadt an und starte Solo oder Koop.",
        ));
        return;
      }
      for (const entry of saved) list.append(roomRow(entry, {
        onSolo: () => {
          room.value = entry.code;
          events.onOpenSolo(entry.code);
        },
        onCoop: () => {
          room.value = entry.code;
          events.onOpenCoop(entry.code);
        },
        onDelete: () => events.onDelete(entry.code),
        live: false,
      }));
    },
    showInspect(view) {
      inspector.hidden = false;
      document.body.dataset.inspect = "on";
      inspector.dataset.kind = view.kind;
      required("#insp-mark").innerHTML = mark(view.kind);
      required("#insp-kicker").textContent = view.kicker;
      required("#insp-title").textContent = view.title;
      stats.replaceChildren(...view.stats.map(statCard));
      families.replaceChildren(...view.families.map(familyCard));
      hires.replaceChildren(...view.hires.map((hire) => hireRow(hire, () => events.onHire(hire.home, hire.slot))));
      const deals = view.trade ?? [];
      trade.hidden = deals.length === 0;
      trade.replaceChildren(...(deals.length === 0 ? [] : tradePanel(deals, (id) => events.onTrade(id))));
      note.hidden = view.note === null;
      note.textContent = view.note ?? "";
      budgetWrap.hidden = view.budget === null;
      gift.hidden = view.gift === null;
      if (view.gift) gift.textContent = view.gift;
      if (view.budget !== null && document.activeElement !== budget) {
        budget.value = String(view.budget);
        budgetLabel.textContent = `${view.budget}%`;
      }
    },
    hideInspect() {
      inspector.hidden = true;
      document.body.dataset.inspect = "off";
    },
    playerName: () => name.value,
    roomName: () => room.value,
    mapGenOptions: () => readMapGen(),
  };
}

function statCard(stat: InspectStat): HTMLElement {
  const card = document.createElement("div");
  card.className = `insp-stat${stat.tone ? ` ${stat.tone}` : ""}`;
  card.innerHTML = `${glyph(stat.icon)}<div><span></span><b></b></div>`;
  card.querySelector("span")!.textContent = stat.label;
  card.querySelector("b")!.textContent = stat.value;
  return card;
}

function familyCard(family: InspectFamily): HTMLElement {
  const card = document.createElement("article");
  card.className = "insp-family";
  const title = document.createElement("h3");
  title.textContent = `Familie ${family.surname}`;
  card.append(title);
  if (family.cars.length > 0) {
    const cars = document.createElement("p");
    cars.className = "insp-note";
    cars.textContent = family.cars.join(" · ");
    card.append(cars);
  }
  for (const member of family.members) {
    const row = document.createElement("div");
    row.className = "insp-person";
    row.innerHTML = glyph(member.child ? "people" : "work");
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = member.name;
    const tags = document.createElement("div");
    tags.className = "insp-tags";
    tags.append(
      tag(member.child ? "Kind" : "Erwachsen", ""),
      tag(member.education, member.education.startsWith("ohne") ? "bad" : "good"),
      tag(member.job, member.unemployed ? "bad" : ""),
    );
    copy.append(name, tags);
    row.append(copy);
    card.append(row);
  }
  return card;
}

function tradePanel(deals: InspectTrade[], onTrade: (id: string) => void): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const intro = document.createElement("p");
  intro.className = "insp-trade-intro";
  const farmPanel = deals.every((deal) => deal.id.startsWith("farm:"));
  intro.textContent = farmPanel ? "Hof ausbauen" : "Handel";
  nodes.push(intro);
  for (const side of ["import", "export"] as const) {
    const rows = deals.filter((deal) => deal.side === side);
    if (rows.length === 0) continue;
    const block = document.createElement("section");
    block.className = `insp-trade-block ${side}`;
    const heading = document.createElement("h3");
    heading.textContent = farmPanel
      ? (side === "import" ? "Kaufen & ausbauen" : "Umrüsten")
      : (side === "import" ? "Einkaufen" : "Verkaufen");
    block.append(heading);
    const list = document.createElement("div");
    list.className = "insp-trade-list";
    for (const deal of rows) {
      const row = document.createElement("div");
      row.className = deal.enabled ? "insp-trade-row" : "insp-trade-row locked";
      const copy = document.createElement("div");
      copy.className = "insp-trade-copy";
      const name = document.createElement("b");
      name.textContent = deal.name;
      const detail = document.createElement("span");
      detail.textContent = deal.enabled ? deal.detail : (deal.hint || deal.detail);
      copy.append(name, detail);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = deal.price;
      button.disabled = !deal.enabled;
      button.setAttribute("aria-label", `${side === "import" ? "Kaufen" : "Verkaufen"}: ${deal.name} für ${deal.price}`);
      if (deal.enabled) button.addEventListener("click", () => onTrade(deal.id));
      row.append(copy, button);
      list.append(row);
    }
    block.append(list);
    nodes.push(block);
  }
  return nodes;
}

function hireRow(hire: InspectHire, onHire: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "insp-hire";
  const copy = document.createElement("div");
  const name = document.createElement("b");
  name.textContent = hire.name;
  const detail = document.createElement("span");
  detail.textContent = hire.detail;
  copy.append(name, detail);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Anstellen";
  button.addEventListener("click", onHire);
  row.append(copy, button);
  return row;
}

const STAT_TIPS: Record<string, { title: string; text: string }> = {
  time: {
    title: "Zeit & Stadtpuls",
    text: "Die Uhr zeigt den Tag-Nacht-Zyklus. Wetter und Puls (Rushhour, Nacht) steuern, wie voll die Straßen sind und wie hell die Stadt wirkt.",
  },
  funds: {
    title: "Kasse",
    text: "Dein Geld zum Bauen und Handeln. Die kleine Zahl darunter ist der aktuelle Saldo aus Steuern und laufenden Kosten.",
  },
  pop: {
    title: "Einwohner",
    text: "Menschen in bebauten Wohnungen. Mehr Wohnraum und gute Versorgung lassen die Stadt wachsen.",
  },
  jobs: {
    title: "Jobs",
    text: "Arbeitsplätze in Gewerbe, Industrie und Betrieben. Ohne Jobs bleiben Erwachsene arbeitslos und verdienen weniger.",
  },
  power: {
    title: "Strom",
    text: "Verbrauch / Kapazität. Kraftwerke speisen Leitungen; ohne Strom bleiben Gebäude unversorgt und entwickeln sich nicht.",
  },
  water: {
    title: "Wasser",
    text: "Verbrauch / Kapazität. Wasserwerke speisen Rohre; ohne Wasser stockt Wachstum und Versorgung.",
  },
  food: {
    title: "Nahrung",
    text: "Vorrat in der Stadt. Darunter siehst du Bedarf und Erzeugung (Höfe). Reicht die Versorgung nicht, hungert die Stadt.",
  },
  traffic: {
    title: "Verkehr",
    text: "Auslastung der Straßen. Hohe Werte bedeuten Stau — mehr Straßen und kürzere Wege entlasten.",
  },
};

function wireStatTips(): { hide: (clearPin?: boolean) => void } {
  const tip = required("#stat-tip");
  const tipTitle = required("#stat-tip-title");
  const tipText = required("#stat-tip-text");
  const stats = required("#city-stats");
  let pinned: HTMLElement | null = null;
  let hoverTimer = 0;

  const place = (node: HTMLElement) => {
    const box = node.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const width = tipBox.width || 240;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2));
    const top = Math.min(window.innerHeight - 12, box.bottom + 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const show = (node: HTMLElement) => {
    const key = node.dataset.stat ?? "";
    const entry = STAT_TIPS[key];
    if (!entry) return;
    tipTitle.textContent = entry.title;
    tipText.textContent = entry.text;
    tip.hidden = false;
    for (const stat of stats.querySelectorAll<HTMLElement>(".stat")) {
      stat.dataset.open = stat === node ? "on" : "";
    }
    requestAnimationFrame(() => place(node));
  };

  const hide = (clearPin = false) => {
    if (clearPin) pinned = null;
    if (pinned) return;
    tip.hidden = true;
    for (const stat of stats.querySelectorAll<HTMLElement>(".stat")) delete stat.dataset.open;
  };

  for (const node of stats.querySelectorAll<HTMLElement>(".stat")) {
    node.addEventListener("mouseenter", () => {
      window.clearTimeout(hoverTimer);
      if (pinned && pinned !== node) return;
      show(node);
    });
    node.addEventListener("mouseleave", () => {
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => hide(false), 120);
    });
    node.addEventListener("focus", () => show(node));
    node.addEventListener("blur", () => hide(false));
    node.addEventListener("click", (event) => {
      event.preventDefault();
      if (pinned === node) {
        pinned = null;
        hide(true);
        return;
      }
      pinned = node;
      show(node);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      node.click();
    });
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (stats.contains(target) || tip.contains(target)) return;
    hide(true);
  });

  tip.style.position = "fixed";
  return { hide };
}

function roomsEmpty(title: string, hint: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "rooms-empty";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = hint;
  empty.append(heading, copy);
  return empty;
}

function roomRow(entry: RoomCard, options: {
  onSolo: () => void;
  onCoop: () => void;
  onDelete: () => void;
  live: boolean;
}): HTMLElement {
  const joinable = entry.players > 0 && entry.players < 2;
  const full = entry.players >= 2;
  const label = entry.name || entry.code;
  const row = document.createElement("div");
  row.className = joinable ? "room-row live" : full ? "room-row full" : "room-row";
  const card = document.createElement("div");
  card.className = "room-card";
  const mark = document.createElement("span");
  mark.className = "room-mark";
  mark.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "room-card-copy";
  const title = document.createElement("strong");
  title.className = "room-name";
  title.textContent = label;
  const meta = document.createElement("span");
  meta.className = "room-meta";
  const bits: string[] = [];
  if (full) bits.push("2/2 · gerade voll");
  else if (joinable) bits.push("1/2 · Platz frei");
  bits.push(entry.level ? `Level ${entry.level}` : `${money.format(entry.population)} Einwohner`);
  const played = formatSavedAt(entry.savedAt);
  if (played && !joinable && !full) bits.push(`Zuletzt ${played}`);
  if (entry.name && entry.name.toLowerCase() !== entry.code.toLowerCase()) bits.push(entry.code);
  meta.textContent = bits.join(" · ");
  copy.append(title, meta);
  card.append(mark, copy);
  if (joinable) {
    const badge = document.createElement("em");
    badge.className = "live-tag";
    badge.textContent = "Online";
    card.append(badge);
  }
  const actions = document.createElement("div");
  actions.className = "room-actions";
  if (options.live || entry.level) {
    const join = document.createElement("button");
    join.type = "button";
    join.className = "room-coop";
    join.textContent = full ? "Voll" : "Beitreten";
    join.disabled = full;
    join.setAttribute("aria-label", full ? `${label} ist voll` : `${label} beitreten`);
    if (!full) join.addEventListener("click", options.onCoop);
    actions.append(join);
    row.append(card, actions);
    return row;
  }
  const solo = document.createElement("button");
  solo.type = "button";
  solo.className = "room-solo";
  solo.textContent = "Solo";
  solo.setAttribute("aria-label", `${label} solo öffnen`);
  solo.addEventListener("click", options.onSolo);
  const coop = document.createElement("button");
  coop.type = "button";
  coop.className = "room-coop";
  coop.textContent = "Koop";
  coop.setAttribute("aria-label", `${label} im Koop öffnen`);
  coop.addEventListener("click", options.onCoop);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "room-delete";
  remove.textContent = "Löschen";
  remove.setAttribute("aria-label", `${label} löschen`);
  remove.addEventListener("click", options.onDelete);
  actions.append(solo, coop, remove);
  row.append(card, actions);
  return row;
}

function formatSavedAt(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  if (diff < 45_000) return "gerade eben";
  if (diff < 3_600_000) return `vor ${Math.max(1, Math.floor(diff / 60_000))} Min.`;
  if (diff < 22 * 3_600_000) return `vor ${Math.max(1, Math.floor(diff / 3_600_000))} Std.`;
  if (diff < 48 * 3_600_000) return "gestern";
  if (diff < 6 * 86_400_000) return `vor ${Math.max(2, Math.floor(diff / 86_400_000))} Tagen`;
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(date);
}

function renderNote(entry: PatchNote, latest: boolean): HTMLElement {
  const card = document.createElement("article");
  card.className = latest ? "note-card latest" : "note-card";
  const title = document.createElement("h3");
  title.textContent = `${entry.version} · ${entry.title}`;
  const time = document.createElement("time");
  time.dateTime = entry.at;
  time.textContent = entry.at;
  const list = document.createElement("ul");
  for (const item of entry.items) {
    const row = document.createElement("li");
    row.textContent = item;
    list.append(row);
  }
  card.append(title, time, list);
  return card;
}

function tag(text: string, tone: string): HTMLElement {
  const node = document.createElement("em");
  if (tone) node.className = tone;
  node.textContent = text;
  return node;
}

function mark(kind: InspectKind): string {
  if (kind === "home") return glyph("home");
  if (kind === "car") return glyph("car");
  if (kind === "power") return glyph("bolt");
  if (kind === "water") return glyph("drop");
  if (kind === "work") return glyph("work");
  if (kind === "farm") return glyph("food");
  if (kind === "airport") return glyph("plane");
  return glyph("book");
}

function glyph(icon: InspectStat["icon"] | "people"): string {
  const paths: Record<string, string> = {
    people: `<circle cx="12" cy="8" r="3"/><path d="M5 19c1.2-3 3.4-4.5 7-4.5S17.8 16 19 19"/>`,
    family: `<circle cx="8" cy="8" r="2.4"/><circle cx="16" cy="8" r="2.4"/><path d="M3 19c.8-2.6 2.4-4 5-4s4.2 1.4 5 4M11 19c.8-2.6 2.4-4 5-4s4.2 1.4 5 4"/>`,
    car: `<path d="M4 15h16l-1.4-4.2A2 2 0 0 0 16.7 9H7.3a2 2 0 0 0-1.9 1.8L4 15Z"/><circle cx="7.5" cy="16.5" r="1.4"/><circle cx="16.5" cy="16.5" r="1.4"/>`,
    bolt: `<path d="M13 2 5 14h6l-1 8 9-13h-6l0-7Z"/>`,
    drop: `<path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z"/>`,
    book: `<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5Z"/><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3"/>`,
    home: `<path d="M4 11.5 12 4l8 7.5"/><path d="M7 10.5V20h10v-9.5"/>`,
    work: `<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 7V5h8v2"/>`,
    food: `<path d="M12 3c2.4 3.2 4 6 4 8.4A4 4 0 0 1 8 11.4C8 9 9.6 6.2 12 3Z"/><path d="M12 21V12"/>`,
    plane: `<path d="M3 13.5 12 11l9 2.5-9 2.5Z"/><path d="M12 4v16"/><path d="M8 18h8"/>`,
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[icon] ?? paths.book}</svg>`;
}

function paintDemand(key: string, value: number): void {
  const label = required(`#dem-${key}`);
  const bar = required<HTMLElement>(`#bar-${key}`);
  label.textContent = `${value > 0 ? "+" : ""}${value}`;
  bar.style.width = `${Math.min(100, Math.abs(value))}%`;
  bar.style.background = value >= 0 ? "#7dbe6a" : "#d16155";
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Element fehlt: ${selector}`);
  return node;
}

function requiredButton(selector: string): HTMLButtonElement {
  return required(selector);
}

function requiredInput(selector: string): HTMLInputElement {
  return required(selector);
}
