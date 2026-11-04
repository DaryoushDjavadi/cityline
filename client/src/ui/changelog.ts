export interface PatchNote {
  version: string;
  at: string;
  title: string;
  items: string[];
}

export const CHANGELOG: PatchNote[] = [
  {
    version: "0.16",
    at: "4. Nov 2026",
    title: "Level-Modus",
    items: [
      "Im Menü Städte gibt es zehn Level. Level 1 ist frei, der Rest geht nacheinander auf.",
      "Jedes Level hat eine klare Aufgabe. Geschafft schaltet das nächste frei.",
      "Freies Bauen und Koop bleiben wie sie sind.",
    ],
  },
  {
    version: "0.15",
    at: "3. Nov 2026, 18:10",
    title: "Aufträge und Nachfrage",
    items: [
      "Links unten liegt immer ein Auftrag. Erledigt bringt eine Prämie.",
      "Die Stadt bekommt einen Rang, vom Außenposten bis zur Großstadt.",
      "Ab 25 Nachfrage gibt es beim Bauen bis zu 40 % des Preises zurück.",
    ],
  },
  {
    version: "0.14",
    at: "3. Nov 2026, 17:45",
    title: "Runde Küste",
    items: [
      "Die Inselkante ist gerundet, ohne die eckigen Kacheln am Ufer.",
      "Eine Böschung geht unter die Wellen, damit das Meer nicht mehr durch den Boden schneidet.",
    ],
  },
  {
    version: "0.13",
    at: "3. Nov 2026, 17:08",
    title: "Runde Insel, dichtes Ufer",
    items: [
      "Die Insel ist eine Küste mit Buchten, kein Rechteck mehr.",
      "Das Meer bleibt unter dem Boden. Wellen schneiden nicht mehr durchs Land.",
    ],
  },
  {
    version: "0.12",
    at: "3. Nov 2026, 17:00",
    title: "Meer, Modelle, Aufschütten",
    items: [
      "Um die Insel liegt Meer bis zum Horizont, die Fläche bewegt sich.",
      "Wohnhäuser, Läden, Fabriken und öffentliche Gebäude haben eigene Modelle.",
      "Aufschütten macht aus einem Wasserfeld Land, für 8.000 € das Stück.",
      "Das Baumenü und dieser Verlauf sind neu.",
    ],
  },
  {
    version: "0.11",
    at: "3. Nov 2026, 16:46",
    title: "Insel und Kasse",
    items: [
      "Neue Städte liegen auf einer Insel, mit Küste, Fluss und manchmal einem See.",
      "Wohnhäuser zahlen Steuern, besetzte Betriebe bringen den Gewinn.",
      "Unter der Kasse steht, was alle zwei Sekunden übrig bleibt.",
    ],
  },
  {
    version: "0.10",
    at: "3. Nov 2026, 16:20",
    title: "Brücken, Jobs, einzelne Häuser",
    items: [
      "Brücken über Wasser, mit Rampe und Türmen. Autos fahren auf der Fahrbahn.",
      "Strom und Wasser lassen sich über Straßen, Brücken und Wasser legen.",
      "Einzelne Häuser, Läden und Fabriken statt eines Zonenpinsels.",
      "Arbeitslose stellt man im Betrieb an. Offene Stellen und Arbeitslose zeigen ein Symbol.",
    ],
  },
  {
    version: "0.9",
    at: "3. Nov 2026, 15:30",
    title: "Stadt, Netze, Speicher",
    items: [
      "Häuser zeigen Familien, Autos und Bildung. Ein Abschluss braucht eine Schule in der Nähe.",
      "Eine Leitung versorgt eine zusammenhängende Häusergruppe.",
      "Städte lassen sich speichern, laden und löschen. Koop geht im gleichen Netzwerk.",
    ],
  },
];
