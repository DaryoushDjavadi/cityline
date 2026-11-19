import { BUILDINGS, COST, SERVICES as SERVICE_INFO, ServiceKind } from "../../../shared/src/index.ts";
import type { ToolId } from "./hud.ts";

export type BuildCategoryId = "roads" | "homes" | "work" | "utility" | "trade" | "civic" | "landmarks" | "zoo" | "tools";

export interface BuildItem {
  tool: ToolId;
  /** Short tile label. */
  label: string;
  name: string;
  cost: number;
  /** "pro Feld" for drag tools. */
  per?: string;
  group?: string;
  blurb: string;
  /** Short requirement chips shown in the tooltip, e.g. "Straße daneben". */
  needs: string[];
}

export interface BuildCategory {
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
  harbor: `<path d="M4 14h16l-2 5H6Z"/><path d="M7 14V8h3.5v6"/><path d="M12.5 14V6H18v8"/><path d="M3 19h18"/>`,
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
  wheel: `<circle cx="12" cy="10" r="6.5"/><circle cx="12" cy="10" r="1.2"/><path d="M12 3.5v13M5.5 10h13M7.4 5.4l9.2 9.2M16.6 5.4l-9.2 9.2"/><path d="M8.5 21 12 11l3.5 10M6.5 21h11"/>`,
  cityhall: `<path d="M3 20h18"/><path d="M5 20v-8h14v8"/><path d="M4 12l8-4 8 4"/><path d="M10 8V4.5h4V8"/><path d="M12 4.5V2.5M12 2.5h2.5"/><path d="M8 20v-5M12 20v-5M16 20v-5"/>`,
  tvtower: `<path d="M12 2v4"/><path d="M11 6h2v4h-2z"/><ellipse cx="12" cy="12" rx="4" ry="2.4"/><path d="M11 14.4 10 20h4l-1-5.6"/><path d="M7 21h10"/>`,
  civic: `<path d="M3 9 12 4l9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9"/><path d="M3 20h18"/>`,
  homes: `<path d="M3 12 9 6.5l6 5.5"/><path d="M5 10.5V19h8v-8.5"/><path d="M13 9.5 16.5 6 21 10v9h-8"/><path d="M8 19v-3.5h2V19"/>`,
  industry: `<path d="M3 20V12l5 3v-3l5 3V9h3V4h3v16Z"/><path d="M6.5 17.5h2M11 17.5h2"/><path d="M17.5 4c0-1 .8-1.6 1.7-1.6"/>`,
  trade: `<path d="M3 15h18l-2.5 4.5h-13Z"/><path d="M6 15v-4h5v4"/><path d="M12.5 15V8h5v7"/><path d="M14 8V5.5"/><path d="M2.5 21.5c1.5.8 3 .8 4.5 0s3-.8 4.5 0 3 .8 4.5 0 3-.8 4.5 0"/>`,
  landmark: `<path d="M12 2.5 14.6 8l6 .6-4.5 4 1.3 5.9L12 15.5l-5.4 3 1.3-5.9-4.5-4 6-.6Z"/>`,
  tools: `<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.3-.7-.7-2.3Z"/>`,
  zoo: `<ellipse cx="12" cy="16" rx="4.2" ry="3.6"/><ellipse cx="6.2" cy="10.6" rx="1.8" ry="2.3"/><ellipse cx="17.8" cy="10.6" rx="1.8" ry="2.3"/><ellipse cx="9.4" cy="6.4" rx="1.7" ry="2.3"/><ellipse cx="14.6" cy="6.4" rx="1.7" ry="2.3"/>`,
  zooSavanna: `<path d="M3 20h18"/><path d="M12 20v-8"/><path d="M5 11c2-2 12-2 14 0-3 1.4-11 1.4-14 0Z"/><path d="M12 12 9 9.5M12 12l3-2.5"/>`,
  zooForest: `<path d="M8 20v-3M16 20v-3"/><path d="M8 3 4 11h2.5L3.5 17h9L9.5 11H12Z"/><path d="M16 6l-3 6h2l-2.5 5h7L17 12h2Z"/>`,
  zooWater: `<path d="M3 15c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><path d="M3 19c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><path d="M7 12c1-3 4-5 7-4 1.6.5 2.6 1.6 3 3"/><circle cx="15.5" cy="8.6" r=".6"/>`,
  zooPolar: `<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>`,
  zooMeadow: `<path d="M3 20h18"/><path d="M4 20v-6M8 20v-6M12 20v-6M16 20v-6M20 20v-6"/><path d="M3 16h18"/><path d="M7 9c0-2.2 2.2-4 5-4s5 1.8 5 4-2.2 3-5 3-5-.8-5-3Z"/><path d="M15.5 7.2 17.5 5"/>`,
  utility: `<path d="M9 2 4 11h4l-1 7 6-9H9Z"/><path d="M17 9s3.5 3.8 3.5 6.2a3.5 3.5 0 0 1-7 0C13.5 12.8 17 9 17 9Z"/>`,
};

export function toolSvg(key: string, className = "tool-icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key] ?? ICONS.cottage}</svg>`;
}

const ZONE_NEEDS = ["Straße daneben", "Strom", "Wasser"];
const CIVIC_NEEDS = ["Straße direkt daneben", "Strom & Wasser für volle Wirkung"];

const building = (tool: keyof typeof BUILDINGS, label: string, group: string, blurb: string, needs = ZONE_NEEDS): BuildItem => ({
  tool,
  label,
  name: BUILDINGS[tool].name,
  cost: BUILDINGS[tool].cost,
  group,
  blurb,
  needs,
});

const service = (tool: ToolId, kind: number, label: string, needs: string[], blurb?: string, group?: string): BuildItem => {
  const info = SERVICE_INFO[kind];
  return { tool, label, name: info.name, cost: info.cost, blurb: blurb ?? info.blurb, needs, group };
};

/** Cities-Skylines-style toolbar: 9 categories (hotkeys 1–9), each with a palette (hotkeys R T Z U I O). */
export const BUILD_MENU: BuildCategory[] = [
  {
    id: "roads",
    label: "Straßen",
    icon: "road",
    blurb: "Straßen verbinden alles. Ziehen baut mehrere Felder am Stück, gerade oder mit einer Ecke.",
    items: [
      { tool: "road", label: "Straße", name: "Straße", cost: COST.road, per: "pro Feld", blurb: "Gerade oder mit einer rechtwinkligen Ecke ziehen. Jedes Gebäude braucht eine Straße direkt daneben.", needs: ["Freies Land"] },
      { tool: "bridge", label: "Brücke", name: "Brücke", cost: COST.bridge, per: "pro Feld", blurb: "Straße über Wasser, angeschlossen an bestehende Straßen.", needs: ["Über Wasser", "Anschluss an Straße"] },
    ],
  },
  {
    id: "homes",
    label: "Wohnen",
    icon: "homes",
    blurb: "Hier ziehen Familien ein. Mehr Einwohner bringen Steuern und Arbeiter.",
    items: [
      building("cottage", "Haus", "Wohnen", "Platz für eine Familie. Günstiger Start für jede Siedlung."),
      building("apartments", "Mehrfam.", "Wohnen", "Mehrere Familien auf einem Feld."),
      building("tower", "Hochhaus", "Wohnen", "Viele Einwohner auf kleiner Fläche."),
    ],
  },
  {
    id: "work",
    label: "Arbeit",
    icon: "industry",
    blurb: "Gewerbe und Industrie schaffen Jobs. Ohne Arbeitsplätze ziehen Leute wieder weg.",
    items: [
      building("shop", "Laden", "Gewerbe", "Kleines Gewerbe mit ersten Jobs."),
      building("office", "Büro", "Gewerbe", "Mehr Jobs, gut für gebildete Bewohner."),
      building("mall", "Kaufhaus", "Gewerbe", "Großes Gewerbe mit vielen Stellen."),
      building("workshop", "Werkstatt", "Industrie", "Kleine Industrie, schafft einfache Jobs."),
      building("factory", "Fabrik", "Industrie", "Mehr Industrie-Jobs und Waren."),
      building("plant", "Anlage", "Industrie", "Große Industrieanlage mit vielen Stellen."),
    ],
  },
  {
    id: "utility",
    label: "Versorgung",
    icon: "utility",
    blurb: "Strom und Wasser: Werk bauen, dann Leitung bzw. Rohr bis zu den Häusern ziehen. Versorgt ist, was die Leitung direkt berührt.",
    items: [
      service("power", ServiceKind.Power, "Kraftwerk", ["Freies Land", "danach Leitung ziehen"], undefined, "Strom"),
      { tool: "line", label: "Stromleitung", name: "Stromleitung", cost: COST.line, per: "pro Feld", group: "Strom", blurb: "Vom Kraftwerk zu den Häusern ziehen: gerade oder mit einer Ecke, auch über Straßen und Wasser. Rechtsklick entfernt nur die Leitung.", needs: ["Beginnt am Kraftwerk oder an einer Leitung"] },
      service("water", ServiceKind.Water, "Wasserwerk", ["Freies Land", "danach Rohr ziehen"], undefined, "Wasser"),
      { tool: "pipe", label: "Wasserrohr", name: "Wasserrohr", cost: COST.pipe, per: "pro Feld", group: "Wasser", blurb: "Wie die Stromleitung, für Wasser. Rechtsklick entfernt nur das Rohr.", needs: ["Beginnt am Wasserwerk oder an einem Rohr"] },
      service("lamp", ServiceKind.Lamp, "Laterne", ["An Straße oder Leitung"]),
    ],
  },
  {
    id: "trade",
    label: "Handel",
    icon: "trade",
    blurb: "Hafen, Flughafen und Bauernhof: Nahrung erzeugen und Waren in die Welt verkaufen.",
    items: [
      service("harbor", ServiceKind.Harbor, "Hafen", ["Meeresküste", "Straße, Strom, Wasser"], "Direkt an die Meeresküste, auf Sand oder Land. Der Steg ragt ins Wasser. Bringt Handel und Lieferungen."),
      service("airport", ServiceKind.Airport, "Flughafen", ["Viel freie Fläche", "Straße, Strom, Wasser"], "Schneller Handel, wenig Kapazität. Logistik-Verbund mit einem nahen Hafen."),
      building("farm", "Bauernhof", "Nahrung", "Erzeugt Nahrung mit Arbeitern. Im Infofenster Tiere kaufen oder den Hof verbessern.", ["Straße daneben", "Arbeiter", "Strom & Wasser = mehr Ertrag"]),
    ],
  },
  {
    id: "civic",
    label: "Öffentlich",
    icon: "civic",
    blurb: "Schulen, Gesundheit, Sicherheit und Parks wirken auf ihren Umkreis und machen glücklich.",
    items: [
      service("school", ServiceKind.School, "Schule", CIVIC_NEEDS),
      service("university", ServiceKind.University, "Uni", CIVIC_NEEDS),
      service("clinic", ServiceKind.Clinic, "Klinik", CIVIC_NEEDS),
      service("police", ServiceKind.Police, "Polizei", CIVIC_NEEDS),
      service("fire", ServiceKind.Fire, "Feuerwehr", CIVIC_NEEDS),
      service("park", ServiceKind.Park, "Park", ["Straße direkt daneben"]),
    ],
  },
  {
    id: "landmarks",
    label: "Wahrzeichen",
    icon: "landmark",
    blurb: "Je eins pro Stadt, freigeschaltet über den Stadt-Rang. Machen glücklich und bringen Einnahmen.",
    items: [
      service("wheel", ServiceKind.Wheel, "Riesenrad", ["Rang Kleinstadt", "Straße direkt daneben"], undefined, "Wahrzeichen"),
      service("cityhall", ServiceKind.CityHall, "Rathaus", ["Rang Stadt", "Straße direkt daneben"], undefined, "Wahrzeichen"),
      service("tvtower", ServiceKind.Tower, "Fernsehturm", ["Rang Großstadt", "Straße direkt daneben"], undefined, "Wahrzeichen"),
    ],
  },
  {
    id: "zoo",
    label: "Zoo",
    icon: "zoo",
    blurb: "Tiergehege bauen, Tiere aufnehmen und pflegen. Glückliche Tiere locken Besucher an.",
    items: [
      service("zooSavanna", ServiceKind.ZooSavanna, "Savanne", ["Straße direkt daneben"], undefined, "Gehege"),
      service("zooForest", ServiceKind.ZooForest, "Wald", ["Straße direkt daneben"], undefined, "Gehege"),
      service("zooWater", ServiceKind.ZooWater, "Wasser", ["Straße direkt daneben"], undefined, "Gehege"),
      service("zooPolar", ServiceKind.ZooPolar, "Polar", ["Straße direkt daneben"], undefined, "Gehege"),
      service("zooMeadow", ServiceKind.ZooMeadow, "Streichelzoo", ["Straße direkt daneben"], undefined, "Gehege"),
    ],
  },
  {
    id: "tools",
    label: "Werkzeuge",
    icon: "tools",
    blurb: "Abreißen und Land aufschütten.",
    items: [
      { tool: "bulldoze", label: "Abriss", name: "Abriss", cost: 0, blurb: "Felder abreißen (ziehen geht auch). Gebäude geben einen Teil der Kosten zurück.", needs: [] },
      { tool: "fill", label: "Aufschütten", name: "Aufschütten", cost: COST.fill, per: "pro Feld", blurb: "Macht ein blaues Wasserfeld zu Land.", needs: ["Wasserfeld"] },
    ],
  },
];

/** Palette hotkeys by position (event.key, so Z works on German and US layouts). */
export const PALETTE_KEYS = ["r", "t", "z", "u", "i", "o"];

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
  return "roads";
}

export function categoryOf(tool: ToolId): BuildCategory | null {
  return BUILD_MENU.find((category) => category.items.some((item) => item.tool === tool)) ?? null;
}

export interface BuildMenu {
  /** Keeps the active tab and detail in sync with the current tool. */
  showTool: (tool: ToolId) => void;
  /** Marks tools as locked (e.g. landmarks below the needed rank); null unlocks. */
  setLocked: (locks: Partial<Record<ToolId, string | null>>) => void;
  /** Hotkey 1–9: open that category's palette (toggles if already open). */
  selectCategory: (index: number) => void;
  /** Hotkey inside the open palette; returns the tool or null. */
  paletteTool: (key: string) => ToolId | null;
  /** Whether the palette is open (for hotkeys). */
  paletteOpen: () => boolean;
}

export function mountBuildMenu(tabsHost: HTMLElement, gridHost: HTMLElement, detailHost: HTMLElement): BuildMenu {
  let active = loadTab();
  let open = true;
  let current: ToolId = "inspect";
  /** While a tool is being placed the palette folds away (hover or a tab click brings it back). */
  let placing = false;
  const locked = new Map<ToolId, string>();
  const itemByTool = new Map<ToolId, { item: BuildItem; category: BuildCategory; button: HTMLButtonElement }>();
  const tabs = new Map<BuildCategoryId, HTMLButtonElement>();
  const panels = new Map<BuildCategoryId, HTMLElement>();
  const rail = tabsHost.closest<HTMLElement>("#rail") ?? document.body;

  const detailName = document.createElement("b");
  const detailCost = document.createElement("span");
  detailCost.className = "build-detail-cost";
  const detailText = document.createElement("p");
  const detailNeeds = document.createElement("div");
  detailNeeds.className = "build-needs";
  const detailHead = document.createElement("div");
  detailHead.className = "build-detail-head";
  detailHead.append(detailName, detailCost);
  detailHost.replaceChildren(detailHead, detailText, detailNeeds);

  // Slim "selected tool" chip in the bar while placing (Cities: Skylines style).
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "build-chip";
  chip.hidden = true;
  chip.title = "Palette aufklappen";
  chip.addEventListener("click", () => {
    placing = false;
    open = true;
    paintTabs();
  });
  tabsHost.before(chip);

  // Floating tooltip (desktop hover / keyboard focus).
  const tip = document.createElement("div");
  tip.id = "build-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  rail.append(tip);

  const chips = (item: BuildItem) => {
    const lock = locked.get(item.tool);
    const list = lock ? [lock, ...item.needs] : item.needs;
    return list.map((need, index) => `<span class="need${lock && index === 0 ? " lock" : ""}">${escapeHtml(need)}</span>`).join("");
  };

  const costText = (item: BuildItem) => (item.cost > 0 ? `${money.format(item.cost)} €${item.per ? ` ${item.per}` : ""}` : "kostenlos");

  const paintDetail = (tool: ToolId | null) => {
    const entry = tool ? itemByTool.get(tool) : undefined;
    const category = BUILD_MENU.find((item) => item.id === active) ?? BUILD_MENU[0];
    if (!entry || entry.category.id !== active) {
      detailHost.dataset.kind = "category";
      detailName.textContent = category.label;
      detailCost.textContent = "";
      detailText.textContent = category.blurb;
      detailNeeds.innerHTML = "";
      return;
    }
    const { item } = entry;
    detailHost.dataset.kind = "item";
    detailName.textContent = item.group ? `${item.name} · ${item.group}` : item.name;
    detailCost.textContent = costText(item);
    detailText.textContent = item.blurb;
    detailNeeds.innerHTML = chips(item);
  };

  const showTip = (tool: ToolId) => {
    const entry = itemByTool.get(tool);
    if (!entry) return;
    const { item, button } = entry;
    const index = entry.category.items.indexOf(item);
    const key = PALETTE_KEYS[index];
    tip.innerHTML = `<div class="tip-head"><b>${escapeHtml(item.name)}</b>${key ? `<kbd>${key.toUpperCase()}</kbd>` : ""}</div><span class="tip-cost">${escapeHtml(costText(item))}</span><p>${escapeHtml(item.blurb)}</p>${item.needs.length || locked.has(item.tool) ? `<div class="build-needs"><small>Braucht</small>${chips(item)}</div>` : ""}`;
    tip.hidden = false;
    const railRect = rail.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const width = tip.offsetWidth;
    let left = rect.left - railRect.left + rect.width / 2 - width / 2;
    left = Math.max(4, Math.min(railRect.width - width - 4, left));
    tip.style.left = `${left}px`;
    tip.style.bottom = `${railRect.bottom - rect.top + 8}px`;
  };
  const hideTip = () => {
    tip.hidden = true;
  };

  const paintChip = () => {
    const entry = itemByTool.get(current);
    chip.hidden = !placing || !entry;
    if (!entry) return;
    chip.innerHTML = `<i class="build-item-icon">${toolSvg(current, "tool-icon")}</i><span class="chip-name"></span><em class="chip-cost"></em><kbd>Esc</kbd>`;
    chip.dataset.tool = current;
    chip.querySelector(".chip-name")!.textContent = entry.item.label;
    chip.querySelector(".chip-cost")!.textContent = shortCost(entry.item.cost);
    chip.setAttribute("aria-label", `${entry.item.name} ausgewählt, ${costText(entry.item)}. Klicken klappt die Palette auf, Esc beendet.`);
  };

  const paintTabs = () => {
    for (const [id, tab] of tabs) {
      const on = id === active && open;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("aria-expanded", String(on));
      tab.tabIndex = id === active ? 0 : -1;
    }
    for (const [id, panel] of panels) panel.hidden = id !== active;
    gridHost.dataset.category = active;
    rail.dataset.palette = open ? "open" : "closed";
    rail.dataset.placing = placing ? "on" : "off";
    paintChip();
    paintDetail(current);
  };

  const select = (id: BuildCategoryId, toggle = false) => {
    // While placing, the first click on a category only unfolds the palette again.
    if (placing) {
      placing = false;
      open = true;
    } else if (toggle && id === active) open = !open;
    else open = true;
    active = id;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      // Remembering the tab is optional.
    }
    hideTip();
    paintTabs();
  };

  BUILD_MENU.forEach((category, categoryIndex) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "build-tab";
    tab.id = `build-tab-${category.id}`;
    tab.dataset.category = category.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `build-panel-${category.id}`);
    tab.title = `${category.label} (Taste ${categoryIndex + 1})`;
    tab.innerHTML = `<span class="tab-glyph">${toolSvg(category.icon, "tab-icon")}</span><span class="tab-label"></span><kbd class="tab-key">${categoryIndex + 1}</kbd>`;
    tab.querySelector(".tab-label")!.textContent = category.label;
    tab.addEventListener("click", () => select(category.id, true));
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
    panel.dataset.count = String(category.items.length);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    category.items.forEach((item, itemIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "build-item";
      button.dataset.tool = item.tool;
      if (item.group) button.dataset.group = item.group;
      const key = PALETTE_KEYS[itemIndex];
      button.setAttribute("aria-label", `${item.name}, ${item.cost > 0 ? `${money.format(item.cost)} €` : "kostenlos"}${key ? `, Taste ${key.toUpperCase()}` : ""}`);
      button.innerHTML = `<i class="build-item-icon">${toolSvg(item.tool, "tool-icon")}</i><span class="build-item-label"></span><em class="build-item-cost"></em>${key ? `<kbd class="build-item-key">${key.toUpperCase()}</kbd>` : ""}`;
      button.querySelector(".build-item-label")!.textContent = item.label;
      button.querySelector(".build-item-cost")!.textContent = shortCost(item.cost);
      itemByTool.set(item.tool, { item, category, button });
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "mouse") return;
        paintDetail(item.tool);
        showTip(item.tool);
      });
      button.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "mouse") return;
        paintDetail(current);
        hideTip();
      });
      button.addEventListener("focus", () => paintDetail(item.tool));
      button.addEventListener("blur", () => {
        paintDetail(current);
        hideTip();
      });
      let pressTimer = 0;
      let longPressed = false;
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        longPressed = false;
        window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
          longPressed = true;
          paintDetail(item.tool);
          showTip(item.tool);
          button.classList.add("peek");
        }, 420);
      });
      const endPress = () => {
        window.clearTimeout(pressTimer);
        button.classList.remove("peek");
        if (longPressed) window.setTimeout(hideTip, 1600);
      };
      button.addEventListener("pointerup", endPress);
      button.addEventListener("pointercancel", endPress);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      // A long press only previews; capture runs before the HUD's tool click handler.
      button.addEventListener("click", (event) => {
        hideTip();
        if (!longPressed) return;
        longPressed = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true });
      panel.append(button);
    });
    panels.set(category.id, panel);
    gridHost.append(panel);
  });
  tabsHost.setAttribute("role", "tablist");
  tabsHost.setAttribute("aria-label", "Baukategorien");
  paintTabs();
  // The status footer sits right above the bottom toolbar on desktop.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      document.body.style.setProperty("--rail-h", `${Math.round(rail.offsetHeight)}px`);
    }).observe(rail);
  }

  return {
    showTool(tool) {
      const changed = tool !== current;
      current = tool;
      const entry = itemByTool.get(tool);
      const nextPlacing = tool !== "inspect" && Boolean(entry);
      if (changed || nextPlacing !== placing) {
        placing = nextPlacing;
        paintTabs();
      }
      if (entry && entry.category.id !== active) select(entry.category.id);
      else paintDetail(tool);
    },
    setLocked(locks) {
      for (const [tool, reason] of Object.entries(locks) as [ToolId, string | null][]) {
        const entry = itemByTool.get(tool);
        if (!entry) continue;
        if (reason) {
          locked.set(tool, reason);
          entry.button.dataset.locked = "on";
        } else {
          locked.delete(tool);
          delete entry.button.dataset.locked;
        }
      }
      paintDetail(current);
    },
    selectCategory(index) {
      const category = BUILD_MENU[index];
      if (category) select(category.id, true);
    },
    paletteTool(key) {
      if (!open) return null;
      const index = PALETTE_KEYS.indexOf(key.toLowerCase());
      if (index < 0) return null;
      const category = BUILD_MENU.find((entry) => entry.id === active);
      return category?.items[index]?.tool ?? null;
    },
    paletteOpen() {
      return open;
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
