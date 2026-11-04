export interface PatchNote {
  version: string;
  at: string;
  title: string;
  items: string[];
}

export const CHANGELOG: PatchNote[] = [
  {
    version: "0.25",
    at: "4. Nov 2026",
    title: "Städtemenü",
    items: [
      "Das Startmenü ist klarer: Name oben, dann Neue Stadt und Levels, darunter die Städte als Karten.",
      "Gespeicherte Städte zeigen Einwohner und zuletzt gespielt. Laufende Koop-Städte bleiben grün markiert.",
      "Eine leere Liste erklärt, wie man die erste Stadt anlegt. Koop-Hosten steht darunter.",
    ],
  },
  {
    version: "0.24",
    at: "4. Nov 2026",
    title: "Leitungen, Flughafen, Nahrung",
    items: [
      "Strom und Wasser folgen dem Raster: Ecken und T-Stücke ohne schräge Geisterstücke.",
      "Ein Haus direkt neben Kraftwerk oder Wasserwerk gilt als versorgt, auch ohne Leitung auf der Kante.",
      "Neuer Flughafen: 48.000 €, danach etwa 260 € alle 2 s. Kleiner Privatflugplatz mit an- und abfliegenden Flugzeugen. An der Lupe Import und Export.",
      "Nahrung kommt vom Bauernhof. Ohne Arbeiter wächst fast nichts. Neue Städte brauchen kaum Nahrung; ein Hof mit wenigen Arbeitern reicht am Anfang, später steigt der Bedarf mit der Einwohnerzahl.",
      "Getreide ist günstig im Import. Waren und Maschinen lassen sich teurer verkaufen, wenn Gewerbe oder Industrie stehen.",
    ],
  },
  {
    version: "0.23",
    at: "4. Nov 2026",
    title: "Handy und Tablet",
    items: [
      "Auf schmalen Bildschirmen klappen Menü, Aufgabe, Kasse, Nachfrage und Chat ein. Die Karte bleibt frei.",
      "Unten liegen kleine Buttons für Bauen, Verschieben, Städte und Nachfrage. Ein Finger baut, zwei Finger zoomen.",
      "Am großen Bildschirm bleibt die Oberfläche wie bisher.",
    ],
  },
  {
    version: "0.22",
    at: "4. Nov 2026",
    title: "Eigene Städte, Chat, Koop",
    items: [
      "Jede Stadt hat einen eigenen Speicherplatz. Eine neue Stadt überschreibt keine andere, auch nicht bei gleichem Namen.",
      "Nach dem Erstellen und nach dem Speichern steht die Stadt in der Liste. Nach dem Neuladen auch.",
      "Im Chat lassen sich die Nachrichten scrollen. Neue Nachrichten holen dich nach unten, wenn du schon unten warst.",
      "Wenn jemand den Tab schließt, bleibt die Koop-Stadt für die anderen offen. Später kann man denselben Raum wieder betreten.",
    ],
  },
  {
    version: "0.21",
    at: "4. Nov 2026",
    title: "Automatisch speichern",
    items: [
      "Eigene Städte speichern sich alle zwei Minuten von selbst, nicht im Level-Modus.",
      "Rechts unten erscheint kurz „Stadt gespeichert“.",
    ],
  },
  {
    version: "0.20",
    at: "4. Nov 2026",
    title: "Städtemenü, Verschieben, Koop-Zeiger",
    items: [
      "Im Städtemenü steht zuerst dein Name, dann eine neue Stadt erstellen, danach die vorgefertigten Levels.",
      "Unter Schauen gibt es Verschieben: Ziehen bewegt die Karte, auch ohne rechte Maustaste.",
      "Im Koop siehst du den Zeiger der anderen Person mit Namen auf der Karte.",
    ],
  },
  {
    version: "0.19",
    at: "4. Nov 2026",
    title: "Chat, Städtemenü, Baumenü",
    items: [
      "Rechts oben gibt es Chat. Zugeklappt zeigt eine Zahl, wenn etwas Neues da ist.",
      "Im Koop schreibt ihr euch über denselben Raum, frei oder im Level.",
      "Das Städtemenü hat oben ein X. So kommst du zurück, ohne neu zu laden.",
      "Abriss und Aufschütten stehen unter Gelände, Leitungen bei der Versorgung.",
      "Im Städtemenü stehen laufende Koop-Räume grün als Online-Koop-Stadt, bereit zum Beitreten.",
    ],
  },
  {
    version: "0.18",
    at: "4. Nov 2026",
    title: "HUD ohne Überlappung",
    items: [
      "Aufgabe, Menü, Spielerliste und Inspektor liegen nebeneinander, nicht übereinander.",
      "Die Spielerliste und die Lupe teilen sich die rechte Seite: immer nur eines ist offen.",
    ],
  },
  {
    version: "0.17",
    at: "4. Nov 2026",
    title: "Level-Koop und Spielerliste",
    items: [
      "Die Aufgabe bleibt oben rechts sichtbar. Ein Klick öffnet das Briefing wieder.",
      "Jedes Level geht auch zu zweit: Raum l3-hauptstadt ist Level 3 in der Stadt hauptstadt.",
      "Beim ersten Besuch fragt das Spiel nach dem Namen. Die Spielerliste zeigt, wer da ist.",
    ],
  },
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
