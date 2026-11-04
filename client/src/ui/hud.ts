import { cityTitle, currentGoal, formatClock, GOALS, LEVELS, type ChatMessage, type LevelStatus, type SimMeta } from "../../../shared/src/index.ts";
import { CHANGELOG, type PatchNote } from "./changelog.ts";

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
  | "bulldoze";

export interface RoomCard {
  code: string;
  players: number;
  population: number;
  funds: number;
  level?: number | null;
}

export interface RosterPlayer {
  id: string;
  name: string;
  self: boolean;
  present: boolean;
}

export type InspectKind = "field" | "home" | "work" | "car" | "power" | "water";

export interface InspectStat {
  icon: "people" | "family" | "car" | "bolt" | "drop" | "book" | "home" | "work";
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

export interface InspectView {
  kind: InspectKind;
  kicker: string;
  title: string;
  stats: InspectStat[];
  families: InspectFamily[];
  hires: InspectHire[];
  note: string | null;
  budget: number | null;
  gift: string | null;
}

export interface HudControls {
  onTool: (tool: ToolId) => void;
  onOverlay: (overlay: "zones" | "power" | "water", enabled: boolean) => void;
  onJoin: (room: string, name: string) => void;
  onLeave: () => void;
  onNewSolo: () => void;
  onContinue: () => void;
  onOpenLobby: () => void;
  onLobbyBack: () => void;
  onSave: () => void;
  onDelete: (code: string) => void;
  onBudget: (value: number) => void;
  onGift: () => void;
  onHire: (home: number, slot: number) => void;
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
}

const money = new Intl.NumberFormat("de-DE");

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
  setPeerCursors: (cursors: { id: string; name: string; x: number; y: number }[]) => void;
  setInspecting: (open: boolean) => void;
  showNameGate: (open: boolean, preset?: string) => void;
  setGateError: (text: string) => void;
  showLevelEnd: (view: { won: boolean; title: string; text: string; next: boolean }) => void;
  hideLevelEnd: () => void;
  showInspect: (view: InspectView) => void;
  hideInspect: () => void;
  setPlayerName: (name: string) => void;
  playerName: () => string;
  roomName: () => string;
}

export function createHud(events: HudControls): Hud {
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>("#rail button[data-tool]")];
  const togglePan = requiredButton("#toggle-pan");
  const peerCursors = required("#peer-cursors");
  const funds = required("#funds");
  const pop = required("#pop");
  const jobs = required("#jobs");
  const power = required("#power");
  const water = required("#water");
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
  let menuOpen = true;
  const paintMenu = () => {
    document.body.dataset.menu = menuOpen ? "open" : "closed";
    toggleLabel.textContent = menuOpen ? "Menü zuklappen" : "Menü aufklappen";
    toggleRail.setAttribute("aria-expanded", String(menuOpen));
  };
  toggleRail.addEventListener("click", () => {
    menuOpen = !menuOpen;
    paintMenu();
  });
  paintMenu();

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => events.onTool(button.dataset.tool as ToolId));
  });
  togglePan.addEventListener("click", () => events.onTogglePan());
  for (const overlay of ["zones", "power", "water"] as const) {
    const input = document.querySelector<HTMLInputElement>(`#ov-${overlay}`);
    input?.addEventListener("change", () => events.onOverlay(overlay, input.checked));
  }
  requiredButton("#connect").addEventListener("click", () => events.onJoin(room.value, name.value));
  requiredButton("#solo-new").addEventListener("click", () => events.onNewSolo());
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
  requiredButton("#gate-enter").addEventListener("click", () => events.onNameReady(gateName.value));
  gateName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") events.onNameReady(gateName.value);
  });
  name.addEventListener("change", () => events.onNameReady(name.value));
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
      toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    },
    setStats(meta) {
      funds.textContent = `${money.format(meta.stats.funds)} €`;
      const flow = required<HTMLElement>("#cashflow");
      const net = meta.ledger.income - meta.ledger.upkeep;
      flow.textContent = `${net >= 0 ? "+" : "−"}${money.format(Math.abs(net))} alle 2 s`;
      flow.style.color = net >= 0 ? "#9dca86" : "#e07a6a";
      pop.textContent = money.format(meta.stats.population);
      jobs.textContent = money.format(meta.stats.jobs);
      power.textContent = `${meta.stats.powerUsed}/${meta.stats.powerCapacity}`;
      water.textContent = `${meta.stats.waterUsed}/${meta.stats.waterCapacity}`;
      traffic.textContent = `${meta.stats.traffic}`;
      paintDemand("r", meta.demand.residential);
      paintDemand("c", meta.demand.commercial);
      paintDemand("i", meta.demand.industrial);
      const title = cityTitle(meta.stats.population);
      rank.textContent = title.next ? `${title.name} · noch ${money.format(title.left)} bis ${title.next}` : title.name;
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
          window.clearTimeout(toastTimer);
          toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
        }
      }
      seenGoals = goals;
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
      window.clearTimeout(saveToastTimer);
      saveToastTimer = window.setTimeout(() => { saveToast.hidden = true; }, 2800);
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
        chatInput.focus();
      }
    },
    setChatMessages(messages, selfId) {
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
      chatLog.scrollTop = chatLog.scrollHeight;
    },
    setChatUnread(count) {
      const unread = count > 0;
      chatBadge.hidden = !unread;
      chatBadge.textContent = unread ? String(count) : "";
      openChat.classList.toggle("unread", unread);
    },
    setChatEnabled(enabled, note) {
      chatNote.textContent = note;
      chatInput.disabled = !enabled;
      chatSend.disabled = !enabled;
    },
    setPanMode(on) {
      togglePan.classList.toggle("active", on);
      togglePan.setAttribute("aria-pressed", String(on));
      document.body.dataset.pan = on ? "on" : "off";
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
    showLevelEnd(view) {
      levelEnd.hidden = false;
      levelEndSheet.classList.toggle("fail", !view.won);
      required("#level-end-kicker").textContent = view.won ? "Level-Modus" : "Nicht geschafft";
      required("#level-end-title").textContent = view.won ? "Level geschafft" : view.title;
      required("#level-end-text").textContent = view.text;
      requiredButton("#level-end-next").hidden = !view.won || !view.next;
    },
    hideLevelEnd() { levelEnd.hidden = true; },
    setRooms(entries) {
      const live = entries.filter((entry) => entry.players > 0);
      const saved = entries.filter((entry) => entry.players === 0);
      liveHeading.hidden = live.length === 0;
      liveNote.hidden = live.length === 0;
      liveList.hidden = live.length === 0;
      liveList.replaceChildren(...live.map((entry) => roomRow(entry, {
        onJoin: () => {
          room.value = entry.code;
          events.onJoin(entry.code, name.value);
        },
        onDelete: () => events.onDelete(entry.code),
        live: true,
      })));
      list.replaceChildren();
      if (saved.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = live.length > 0 ? "Keine weiteren gespeicherten Städte." : "Noch keine gespeicherte Stadt.";
        list.append(empty);
        return;
      }
      for (const entry of saved) list.append(roomRow(entry, {
        onJoin: () => {
          room.value = entry.code;
          events.onJoin(entry.code, name.value);
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

function roomRow(entry: RoomCard, options: { onJoin: () => void; onDelete: () => void; live: boolean }): HTMLElement {
  const joinable = entry.players > 0 && entry.players < 2;
  const full = entry.players >= 2;
  const row = document.createElement("div");
  row.className = joinable ? "room-row live" : full ? "room-row full" : "room-row";
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = full;
  const title = document.createElement("span");
  title.textContent = entry.code;
  button.append(title);
  if (joinable) {
    const badge = document.createElement("em");
    badge.className = "live-tag";
    badge.textContent = "Online-Koop-Stadt — bereit zum Beitreten";
    button.append(badge);
  }
  const meta = document.createElement("em");
  const kind = entry.level ? `Level ${entry.level}` : `${money.format(entry.population)} Einwohner`;
  meta.textContent = full ? `2/2 · gerade voll · ${kind}` : `${entry.players}/2 · ${kind}`;
  button.append(meta);
  if (!full) button.addEventListener("click", options.onJoin);
  if (options.live || entry.level) {
    row.append(button);
    return row;
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Löschen";
  remove.addEventListener("click", options.onDelete);
  row.append(button, remove);
  return row;
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
