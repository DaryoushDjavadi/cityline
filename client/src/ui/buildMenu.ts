import { BUILDINGS, COST, SERVICES as SERVICE_INFO, ServiceKind } from "../../../shared/src/index.ts";
import type { ToolId } from "./hud.ts";

export type BuildCategoryId = "buildings" | "traffic" | "utility" | "services" | "food" | "terrain";

interface BuildItem {
  tool: ToolId;
  /** Short tile label. */
  label: string;
  name: string;
  cost: number;
  /** "pro Feld" for drag tools. */
  per?: string;
  group?: string;
  blurb: string;
}

interface BuildCategory {
  id: BuildCategoryId;
  label: string;
  icon: string;
  blurb: string;
  items: BuildItem[];
}

const ICONS: Record<string, string> = {
  cottage: `<path d="M4 12 12 5l8 7"/><path d="M6.5 10.5V19h11v-8.5"/><path d="M10.5 19v-4h3v4"/>`,
  apartments: `<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M9 8h1.5M13.5 8H15M9 12h1.5M13.5 12H15M10.5 20v-3h3v3"/>`,
  tower: `<rect x="8" y="2.5" width="8" height="18" rx="1"/><path d="M10.5 6h3M10.5 9.5h3M10.5 13h3M10.5 16.5h3M5 21h14"/>`,
  shop: `<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9c0 1.4 1.1 2.5 2.7 2.5S9.3 10.4 9.3 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.4 20 9"/><path d="M5.5 11.5V20h13v-8.5"/><path d="M10 20v-5h4v5"/>`,
  office: `<rect x="4" y="7" width="9" height="13"/><path d="M13 20V3h7v17"/><path d="M6.5 10.5h4M6.5 14h4M15.5 7h2M15.5 10.5h2M15.5 14h2"/>`,
  mall: `<path d="M3 10h18"/><path d="M5 10v10h14V10"/><path d="M4 10 7 5h10l3 5"/><path d="M9 20v-5h6v5"/>`,
  workshop: `<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.3-.7-.7-2.3Z"/>`,
  factory: `<path d="M3 20v-9l5 3v-3l5 3v-3l5 3V5h3v15Z"/><path d="M7 17h2M12 17h2"/>`,
  plant: `<path d="M3 20h18"/><path d="M5 20V9h3v11"/><path d="M10 20v-7l5-3v3l5-3v10"/><path d="M6.5 6c0-1 .8-1.6 1.6-1.6s1.4-.8 2.4-.8"/>`,
  farm: `<path d="M12 21V9"/><path d="M12 9c-2.4 0-3.5-1.8-3.5-4 2.2 0 3.5 1.6 3.5 4Zm0 0c2.4 0 3.5-1.8 3.5-4-2.2 0-3.5 1.6-3.5 4Z"/><path d="M12 14c-2.4 0-3.5-1.8-3.5-4 2.2 0 3.5 1.6 3.5 4Zm0 0c2.4 0 3.5-1.8 3.5-4-2.2 0-3.5 1.6-3.5 4Z"/><path d="M12 19c-2.4 0-3.5-1.8-3.5-4 2.2 0 3.5 1.6 3.5 4Zm0 0c2.4 0 3.5-1.8 3.5-4-2.2 0-3.5 1.6-3.5 4Z"/>`,
  road: `<path d="M8 3 5 21M16 3l3 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>`,
  bridge: `<path d="M2 12h20"/><path d="M4 12c2-4 5-6 8-6s6 2 8 6"/><path d="M7 12V8.3M12 12V6M17 12V8.3"/><path d="M2 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/>`,
  lamp: `<path d="M12 3v2"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 1.4-.8 2.2-1.5 3.2-.5.7-.8 1.3-.9 2.3h-1.2c-.1-1-.4-1.6-.9-2.3-.7-1-1.5-1.8-1.5-3.2Z"/><path d="M11 14h2v7h-2z"/><path d="M9 21h6"/>`,
  airport: `<path d="M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v4.5l2.5 2V21L12 20l-4 1v-1.5l2.5-2V13l-7 2v-2l7-4Z"/>`,
  power: `<path d="M13 2 6 13h5l-1 9 8-12h-5Z"/>`,
  water: `<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>`,
  line: `<path d="M12 3 7 21M12 3l5 18M8.5 15h7M9.8 9.5h4.4M4 7h16"/>`,
  pipe: `<path d="M3 8h8a5 5 0 0 1 5 5v8"/><path d="M3 13h6a2 2 0 0 1 2 2v6"/>`,
  school: `<path d="M4 20V10l8-5 8 5v10"/><path d="M10 20v-5h4v5"/><circle cx="12" cy="10.5" r="1.5"/>`,
  university: `<path d="M3 9.5 12 5l9 4.5-9 4.5Z"/><path d="M7 11.5V16c1.5 1.5 3 2 5 2s3.5-.5 5-2v-4.5"/><path d="M21 9.5V15"/>`,
  clinic: `<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>`,
  police: `<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9.5 12 1.8 1.8L15 10"/>`,
  fire: `<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-1.5 2-2 3.5-2 5-1-1-1.8-2-2-3.5C8 8.5 6 11.5 6 15a6 6 0 0 0 6 6Z"/>`,
  park: `<path d="M12 21v-5"/><path d="M12 16c-3.5 0-6-2.2-6-5.2C6 7 8.8 3.5 12 3.5S18 7 18 10.8c0 3-2.5 5.2-6 5.2Z"/><path d="M9 21h6"/>`,
  fill: `<path d="M3 19h18L14.5 8.5 12 12 8.5 7Z"/><path d="M5 19v2M19 19v2"/>`,
  bulldoze: `<path d="M3 13v-3h3l2-3h7v6"/><rect x="8" y="13" width="11" height="4" rx="1"/><path d="M3 10v5h5"/><circle cx="10" cy="19" r="2"/><circle cx="17" cy="19" r="2"/>`,
  civic: `<path d="M3 9 12 4l9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9"/><path d="M3 20h18"/>`,
  utility: `<path d="M9 2 4 11h4l-1 7 6-9H9Z"/><path d="M17 9s3.5 3.8 3.5 6.2a3.5 3.5 0 0 1-7 0C13.5 12.8 17 9 17 9Z"/>`,
};

export function toolSvg(key: string, className = "tool-icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key] ?? ICONS.cottage}</svg>`;
}

const building = (tool: keyof typeof BUILDINGS, label: string, group: string, blurb: string): BuildItem => ({
  tool,
  label,
  name: BUILDINGS[tool].name,
  cost: BUILDINGS[tool].cost,
  group,
  blurb,
});

const service = (tool: ToolId, kind: number, label: string, blurb?: string): BuildItem => {
  const info = SERVICE_INFO[kind];
  return { tool, label, name: info.name, cost: info.cost, blurb: blurb ?? info.blurb };
};

export const BUILD_MENU: BuildCategory[] = [
  {
    id: "buildings",
    label: "Gebäude",
    icon: "cottage",
    blurb: "Wohnen, Gewerbe und Industrie. Jedes Gebäude braucht eine Straße direkt daneben.",
    items: [
      building("cottage", "Haus", "Wohnen", "Platz für eine Familie. Günstiger Start für jede Siedlung."),
      building("apartments", "Mehrfam.", "Wohnen", "Mehrere Familien auf einem Feld."),
      building("tower", "Hochhaus", "Wohnen", "Viele Einwohner auf kleiner Fläche."),
      building("shop", "Laden", "Gewerbe", "Kleines Gewerbe mit ersten Jobs."),
      building("office", "Büro", "Gewerbe", "Mehr Jobs, gut für gebildete Bewohner."),
      building("mall", "Kaufhaus", "Gewerbe", "Großes Gewerbe mit vielen Stellen."),
      building("workshop", "Werkstatt", "Industrie", "Kleine Industrie, schafft einfache Jobs."),
      building("factory", "Fabrik", "Industrie", "Mehr Industrie-Jobs und Waren."),
      building("plant", "Anlage", "Industrie", "Große Industrieanlage mit vielen Stellen."),
    ],
  },
  {
    id: "traffic",
    label: "Verkehr",
    icon: "road",
    blurb: "Straßen verbinden alles. Ziehen baut mehrere Felder am Stück.",
    items: [
      { tool: "road", label: "Straße", name: "Straße", cost: COST.road, per: "pro Feld", blurb: "Gerade oder mit einer rechtwinkligen Ecke ziehen." },
      { tool: "bridge", label: "Brücke", name: "Brücke", cost: COST.bridge, per: "pro Feld", blurb: "Straße über Wasser, angeschlossen an bestehende Straßen." },
      service("lamp", ServiceKind.Lamp, "Laterne"),
      service("airport", ServiceKind.Airport, "Flughafen", "Privatflugplatz mit Import und Export. Braucht Strom und Wasser, bringt etwa 260 € alle 2 s."),
    ],
  },
  {
    id: "utility",
    label: "Versorgung",
    icon: "utility",
    blurb: "Strom und Wasser lassen Gebäude wachsen. Leitungen verteilen beides.",
    items: [
      service("power", ServiceKind.Power, "Kraftwerk"),
      service("water", ServiceKind.Water, "Wasserwerk"),
      { tool: "line", label: "Leitung", name: "Stromleitung", cost: COST.line, per: "pro Feld", blurb: "Verteilt Strom, auch über Straßen, Brücken und Wasser." },
      { tool: "pipe", label: "Rohr", name: "Wasserrohr", cost: COST.pipe, per: "pro Feld", blurb: "Verteilt Wasser, auch über Straßen, Brücken und Wasser." },
    ],
  },
  {
    id: "services",
    label: "Dienste",
    icon: "civic",
    blurb: "Öffentliche Gebäude wirken auf ihren Umkreis.",
    items: [
      service("school", ServiceKind.School, "Schule"),
      service("university", ServiceKind.University, "Uni"),
      service("clinic", ServiceKind.Clinic, "Klinik"),
      service("police", ServiceKind.Police, "Polizei"),
      service("fire", ServiceKind.Fire, "Feuerwehr"),
      service("park", ServiceKind.Park, "Park"),
    ],
  },
  {
    id: "food",
    label: "Nahrung",
    icon: "farm",
    blurb: "Nahrung kommt vom Bauernhof mit Arbeitern. Neue Städte brauchen kaum welche.",
    items: [
      building("farm", "Bauernhof", "Landwirtschaft", "Startet mit Getreide. Im Infofenster Tiere kaufen oder den Hof verbessern."),
    ],
  },
  {
    id: "terrain",
    label: "Gelände",
    icon: "fill",
    blurb: "Land gewinnen oder Felder wieder frei machen.",
    items: [
      { tool: "fill", label: "Aufschütten", name: "Aufschütten", cost: COST.fill, per: "pro Feld", blurb: "Macht ein blaues Wasserfeld zu Land." },
      { tool: "bulldoze", label: "Abriss", name: "Abriss", cost: 0, blurb: "Ein einzelnes Feld abreißen. Gebäude geben einen Teil der Kosten zurück." },
    ],
  },
];

const money = new Intl.NumberFormat("de-DE");

function shortCost(cost: number): string {
  if (cost <= 0) return "frei";
  if (cost >= 10_000) return `${money.format(Math.round(cost / 1000))}k €`;
  return `${money.format(cost)} €`;
}

const TAB_KEY = "cityline-build-tab";

function loadTab(): BuildCategoryId {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw && BUILD_MENU.some((entry) => entry.id === raw)) return raw as BuildCategoryId;
  } catch {
    // Storage can be blocked; fall back to the first tab.
  }
  return "buildings";
}

export interface BuildMenu {
  /** Keeps the active tab and detail in sync with the current tool. */
  showTool: (tool: ToolId) => void;
}

export function mountBuildMenu(tabsHost: HTMLElement, gridHost: HTMLElement, detailHost: HTMLElement): BuildMenu {
  let active = loadTab();
  let current: ToolId = "inspect";
  const itemByTool = new Map<ToolId, { item: BuildItem; category: BuildCategory }>();
  const tabs = new Map<BuildCategoryId, HTMLButtonElement>();
  const panels = new Map<BuildCategoryId, HTMLElement>();

  const detailName = document.createElement("b");
  const detailCost = document.createElement("span");
  detailCost.className = "build-detail-cost";
  const detailText = document.createElement("p");
  const detailHead = document.createElement("div");
  detailHead.className = "build-detail-head";
  detailHead.append(detailName, detailCost);
  detailHost.replaceChildren(detailHead, detailText);

  const paintDetail = (tool: ToolId | null) => {
    const entry = tool ? itemByTool.get(tool) : undefined;
    const category = BUILD_MENU.find((item) => item.id === active) ?? BUILD_MENU[0];
    if (!entry || entry.category.id !== active) {
      detailHost.dataset.kind = "category";
      detailName.textContent = category.label;
      detailCost.textContent = "";
      detailText.textContent = category.blurb;
      return;
    }
    const { item } = entry;
    detailHost.dataset.kind = "item";
    detailName.textContent = item.group ? `${item.name} · ${item.group}` : item.name;
    detailCost.textContent = item.cost > 0 ? `${money.format(item.cost)} €${item.per ? ` ${item.per}` : ""}` : "kostenlos";
    detailText.textContent = item.blurb;
  };

  const paintTabs = () => {
    for (const [id, tab] of tabs) {
      const on = id === active;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const [id, panel] of panels) panel.hidden = id !== active;
    gridHost.dataset.category = active;
    paintDetail(current);
  };

  const select = (id: BuildCategoryId) => {
    active = id;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      // Remembering the tab is optional.
    }
    paintTabs();
  };

  for (const category of BUILD_MENU) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "build-tab";
    tab.id = `build-tab-${category.id}`;
    tab.dataset.category = category.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `build-panel-${category.id}`);
    tab.title = category.label;
    tab.innerHTML = `${toolSvg(category.icon, "tab-icon")}<span></span>`;
    tab.querySelector("span")!.textContent = category.label;
    tab.addEventListener("click", () => select(category.id));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const index = BUILD_MENU.findIndex((entry) => entry.id === active);
      const next = BUILD_MENU[(index + (event.key === "ArrowRight" ? 1 : -1) + BUILD_MENU.length) % BUILD_MENU.length];
      select(next.id);
      tabs.get(next.id)?.focus();
    });
    tabs.set(category.id, tab);
    tabsHost.append(tab);

    const panel = document.createElement("div");
    panel.className = "build-grid";
    panel.id = `build-panel-${category.id}`;
    panel.dataset.category = category.id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    for (const item of category.items) {
      itemByTool.set(item.tool, { item, category });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "build-item";
      button.dataset.tool = item.tool;
      if (item.group) button.dataset.group = item.group;
      button.setAttribute("aria-label", `${item.name}, ${item.cost > 0 ? `${money.format(item.cost)} €` : "kostenlos"}`);
      button.innerHTML = `<i class="build-item-icon">${toolSvg(item.tool, "tool-icon")}</i><span class="build-item-label"></span><em class="build-item-cost"></em>`;
      button.querySelector(".build-item-label")!.textContent = item.label;
      button.querySelector(".build-item-cost")!.textContent = shortCost(item.cost);
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") paintDetail(item.tool);
      });
      button.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") paintDetail(current);
      });
      button.addEventListener("focus", () => paintDetail(item.tool));
      button.addEventListener("blur", () => paintDetail(current));
      let pressTimer = 0;
      let longPressed = false;
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        longPressed = false;
        window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
          longPressed = true;
          paintDetail(item.tool);
          button.classList.add("peek");
        }, 420);
      });
      const endPress = () => {
        window.clearTimeout(pressTimer);
        button.classList.remove("peek");
      };
      button.addEventListener("pointerup", endPress);
      button.addEventListener("pointercancel", endPress);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      // A long press only previews; capture runs before the HUD's tool click handler.
      button.addEventListener("click", (event) => {
        if (!longPressed) return;
        longPressed = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true });
      panel.append(button);
    }
    panels.set(category.id, panel);
    gridHost.append(panel);
  }
  tabsHost.setAttribute("role", "tablist");
  tabsHost.setAttribute("aria-label", "Baukategorien");
  paintTabs();

  return {
    showTool(tool) {
      current = tool;
      const entry = itemByTool.get(tool);
      if (entry && entry.category.id !== active) select(entry.category.id);
      else paintDetail(tool);
    },
  };
}
