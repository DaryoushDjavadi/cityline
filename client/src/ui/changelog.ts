export interface PatchNote {
  version: string;
  at: string;
  title: string;
  items: string[];
}

export const CHANGELOG: PatchNote[] = [
  {
    version: "0.47",
    at: "19. Nov 2026, 21:05 Uhr",
    title: "Zoo mit Tiergehegen",
    items: [
      "Neue Baukategorie Zoo: fünf Gehege (Savanne, Wald, Wasser, Polar, Streichelzoo). Die Tiere laufen darin herum, Besucher schauen zu und ein Safari-Jeep fährt Runden.",
      "Tierhandlung mit 17 Arten aus vier Herkünften: Zirkus-Rettung, schlechte Haltung, Züchter und Auswilderungsprogramm. Jedes Tier hat einen deutschen Namen und seine eigene Geschichte. Umbenennen geht, auch im Koop.",
      "Raubtiere wie Löwe, Bär, Wolf und Eisbär leben nur mit Artgenossen; der Shop zeigt, was nicht zusammenpasst.",
      "Innenansicht jedes Geheges: streicheln, spielen und füttern mit Herzen, Näpfe und Spielzeug platzieren, ein Pfleger füllt nach. Mit „Zur Stadt“ geht es zurück.",
      "Nachwuchs mit Familiennamen, Stammbaum und vererbten, sichtbaren Genen. Dazu Eintritt, laufende Kosten und neue Erfolge.",
      "Schönere Gehege: Boden je Lebensraum, wehende Gräser, Büsche, Blumen, Steine, Wasser mit Ufer und Eisschollen, warmes Licht mit weichen Schatten, Holzzäune. Gras auch draußen in der Stadtansicht.",
      "Runde, niedliche Low-Poly-Tiere. Dächer von Haus, Rathaus und Hafen sitzen jetzt richtig, und Bäume direkt vor der nahen Kamera blenden aus.",
    ],
  },
  {
    version: "0.46",
    at: "19. Nov 2026, 19:31 Uhr",
    title: "Schlankes Baumenü, näher ranzoomen",
    items: [
      "Baumenü viel flacher: Icon-Leiste und eine Reihe kleiner Kacheln, Beschreibung im Tooltip. Beim Platzieren klappt die Auswahl weg, nur ein kleiner Chip mit Gebäude und Preis bleibt.",
      "Obere Leiste schlanker und eleganter, auf dem Handy überlagert sich nichts mehr.",
      "Viel näher zoomen, bis auf Straßenhöhe; nah dran kippt die Kamera in die Seitenansicht.",
      "Nacht und Meer auf Handys und der Grafikstufe Schonend nicht mehr zu dunkel. Bei Regen verschwinden Sterne und Mond.",
      "Neuigkeiten zeigen jetzt Datum und Uhrzeit.",
    ],
  },
  {
    version: "0.45",
    at: "19. Nov 2026, 16:27 Uhr",
    title: "Neues Baumenü, hellere Nacht, Auftragstafel",
    items: [
      "Baumenü mit Icon-Leiste unten: Straßen, Wohnen, Arbeit, Versorgung, Handel, Öffentlich, Wahrzeichen, Werkzeuge. Kacheln mit Preis und Tastenkürzel, Tooltip zeigt, was ein Gebäude braucht; gesperrte Gebäude sagen, warum.",
      "Schnellknöpfe für Strom- und Wasserleitungen, Abriss, Verschieben und Drehen direkt neben den Kategorien. Auf dem Handy öffnet sich das Menü als Leiste von unten.",
      "Nacht nur noch leicht dunkler: warmes Blau-Violett, leuchtende Fenster, weiche Übergänge am Abend und Morgen.",
      "Mehr Leben: Anwohner vor den Häusern, Parkbesucher, Schlange am Riesenrad, Rauch aus Schornsteinen, Vogelschwärme, Möwen am Hafen und mehr Verkehr, je größer die Stadt wird.",
      "Neue Auftragstafel (Taste J): ab 24 Einwohnern drei Lieferaufträge für Nahrung, Waren oder Fisch, mit Zeitlimit und +30 % Express-Bonus. Abliefern mit Stempel und Münzregen.",
    ],
  },
  {
    version: "0.44",
    at: "18. Nov 2026, 01:39 Uhr",
    title: "Musik, Stadtleben und mehr Tempo",
    items: [
      "Dynamische Musik, die sich mit der Tageszeit ändert, dazu Stadtgeräusche je nach Kamera: Verkehr, Vögel, Grillen, Brandung, Möwen, Schiffshorn und Flugzeuge.",
      "Klang-Einstellungen: Musik, Stadtgeräusche und UI-Sounds einzeln an/aus und regelbar. Der Lautsprecher oben schaltet alles sofort stumm.",
      "Stadtränge vom Außenposten bis zur Metropole, Wahrzeichen (Riesenrad, Rathaus, Fernsehturm), Ereignisse mit Entscheidungen, Tagesaufgabe, 18 Erfolge, Glücksbonus und Bürger-Feed — alles hinter dem Pokal-Knopf.",
      "Deutlich weniger Rechenzeit pro Bild und ein viel kleinerer Download. Der Ton lädt erst nach dem ersten Klick.",
    ],
  },
  {
    version: "0.43",
    at: "17. Nov 2026, 12:08 Uhr",
    title: "Hafen am Ufer, Leitungen klarer",
    items: [
      "Hafen steht auf dem Küstenfeld direkt am Meer — ohne Straße. Klick ins Wasser setzt ihn aufs Ufer, der Steg ragt hinaus. Rot: „Hafen muss direkt am Wasser stehen.“",
      "Alte Speicherstände ohne Meer bekommen eine Küste am Kartenrand.",
      "Strom- und Wasserleitungen: L-förmig ziehen, Kosten am Zeiger, bestehende Leitungen gelten als Anschluss (grün). Rechte Maustaste entfernt nur die Leitung, nicht die Straße. Hinweise unten laufen um, nicht mit … ab.",
      "Versorgt ist ein Gebäude, wenn Leitung, Rohr oder Werk im Umkreis von einem Feld liegt (oder in derselben Häuserzeile). Overlay bei Leitungs-Werkzeug: gelbes Stromnetz, blaues Wassernetz, rotes Blitz-Icon / graues Tropfen-Icon an unversorgten Häusern. HUD zeigt Verbrauch/Kapazität sobald ein Werk steht.",
    ],
  },
  {
    version: "0.42",
    at: "17. Nov 2026, 02:08 Uhr",
    title: "Hafen, Meer und Handel im Feinschliff",
    items: [
      "Hafen mit Kai, Pier, Kran (bewegt Container), Lager, Leuchtturm und bunten Containern. Schiffe haben Rumpf, Kajüte und Kielwasser, legen am Pier an und bleiben auf dem Wasser.",
      "Flughafen mit Startbahn-Markierungen, Glas-Terminal und Tower. Flugzeuge rollen, starten und landen mit weicher Höhenkurve.",
      "Hügel und Küste: weiches Licht, Sand-Gras-Übergang, türkises Flachwasser als weicher Shader-Verlauf (keine Treppen am Ufer) und bewegte Gischt. Am Strand: gestreifte Schirme, bunte Tücher, Schwimmer und grüne Smileys.",
      "Handelspanel zeigt Route, Ware, Zeit, Plätze und Gewinn. Ankunft eines Schiffs oder Flugzeugs bringt eine kurze +€-Meldung. Touristen laufen vom Verbund zum Strand.",
      "Neue Aufträge: Hafenstadt und Logistik-Verbund. Grafikqualität Auto/Hoch/Mittel/Schonend bleibt gültig.",
    ],
  },
  {
    version: "0.41",
    at: "17. Nov 2026, 01:25 Uhr",
    title: "Hafen, Hügel und Strandglück",
    items: [
      "Neuer Hafen unter Verkehr: nur an der Meeresküste, mit Pier, Kran und Containern. Schiffe legen an und fahren aufs Meer.",
      "Hafen handelt in großen, günstigen, langsamen Ladungen. Der Flughafen bleibt schnell, teurer und mit weniger Kapazität. Zusammen in der Nähe bilden sie einen Logistik-Verbund (Touristen, bessere Preise, extra Handelsplatz).",
      "Export sättigt den Markt: Preise fallen und erholen sich mit der Zeit — kein Endlosgeld.",
      "Neue Karten haben sanfte Hügel. Gebäude und Straßen ebnen lokal ein. Am Meer liegt Sand, der weich ins Gras übergeht. Am Strand stehen nur Hafen und Wege.",
      "Häuser nah am Strand machen die Bewohner sehr glücklich. Nachmittags liegen sie am Wasser. Glückliche Leute tragen ein kleines grünes Smiley über dem Kopf.",
      "Bewohner sind stilisierte Low-Poly-Figuren (runder Kopf, Körper, Arme/Beine, bunte Kleidung). Sie laufen, sitzen oder liegen — auf Schonend als einfache Kapsel.",
    ],
  },
  {
    version: "0.40",
    at: "16. Nov 2026, 13:48 Uhr",
    title: "Stadt im Konzeptlicht",
    items: [
      "Beleuchtung, Himmel, Meer und Gelände folgen der Key-Art: warmes Sonnenlicht, weiche Schatten, klareres Blau im Wasser, helleres Gras und Sand am Ufer.",
      "Nachts bleibt die Karte nur etwas dunkler, mit warmen Fenstern, Laternen und einem blauen Himmel — nicht pechschwarz.",
      "Grafikqualität unter Nachfrage: Auto, Hoch, Mittel, Schonend. Handys und schwache Geräte gehen von allein auf Schonend, ohne die Simulation jedes Bild neu zu bauen.",
      "Neue Städte starten morgens um 07:00, mit warmem Morgenlicht wie in der Key-Art.",
    ],
  },
  {
    version: "0.39",
    at: "8. Nov 2026, 14:52 Uhr",
    title: "Aufträge im Blick & neues Baumenü",
    items: [
      "Der aktuelle Auftrag steht jetzt immer oben im Bild — mit Fortschritt, Belohnung und kurzem Hinweis beim Start. Auf dem Handy lässt er sich einklappen.",
      "Erledigte Aufträge werden groß gefeiert, inklusive Belohnung und dem nächsten Auftrag.",
      "Das Baumenü ist nach Kategorien sortiert (Gebäude, Verkehr, Versorgung, Dienste, Nahrung, Gelände) und zeigt kompakte Kacheln mit Preis. Details per Maus oder langem Tippen.",
    ],
  },
  {
    version: "0.38",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Stabiler Bau & Handy",
    items: [
      "Straßen und Zonen überschreiben keine Gebäude mehr. Laternen abreißen lässt Straße und Leitung stehen.",
      "Abriss von Gebäuden fragt nach. Voller Nahrungsspeicher blockiert Import. Kraftwerk und Wasserwerk gelten als versorgt.",
      "Koop übernimmt Biom und Wald. Seed und Kartenvorschau bleiben beim Start gleich. Handy Hoch/Quer ohne verdeckte Buttons.",
    ],
  },
  {
    version: "0.37",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Nachtlicht & Laternen",
    items: [
      "Nachts ist die Stadt dunkel — Häuser und Betriebe mit Strom leuchten selbst und ein Stück weit um sich herum.",
      "Laternen baust du unter Versorgung (auch auf Straßen und Stromleitungen). Die Leitung leitet Strom durch die Laterne weiter.",
    ],
  },
  {
    version: "0.36",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Werte immer im Blick",
    items: [
      "Die Statusleiste (Kasse, Einwohner, Strom …) ist standardmäßig sichtbar und lässt sich über „Werte“ ausblenden.",
      "Hover oder Klick auf einen Wert erklärt, was er bedeutet.",
    ],
  },
  {
    version: "0.35",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Solo oder Koop wählen",
    items: [
      "Neue Stadt: Solo starten oder Koop starten.",
      "Gespeicherte Städte haben Solo- und Koop-Buttons. Online-Räume zeigen Beitreten.",
    ],
  },
  {
    version: "0.34",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Karten & Biome",
    items: [
      "Beim Anlegen: Biom wählen (gemäßigt, trocken, alpin, tropisch, Archipel), Seed und Slider für Meer, Seen, Flüsse und Wald.",
      "Kartenvorschau zeigt die Landschaft vor dem Start. Zufalls-Seed per Knopf.",
      "Terrain-Generation mit Fjorden, Inselketten und biomtypischer Vegetation.",
    ],
  },
  {
    version: "0.33",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Stadt im Rhythmus",
    items: [
      "Rushhour morgens und abends: mehr Autos und Fußgänger, vollere Straßen, langsameres Tempo.",
      "Nachts ruhiger, mit Scheinwerfern und Straßenlaternen. Oben steht der aktuelle Stadtpuls.",
    ],
  },
  {
    version: "0.32",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Bauernhof ausbauen",
    items: [
      "Höfe starten mit Getreide. Im Infofenster: Tiere kaufen, zurück zu Getreide, Bewässerung und Silo.",
      "Anbau ist von außen sichtbar (goldener Acker vs. Weide mit Tieren). Ausbauten ändern das Modell.",
      "Tiere und Verbesserungen erhöhen die Nahrung; der Stand speichert sich und gilt auch im Koop.",
    ],
  },
  {
    version: "0.31",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Bessere Autos",
    items: [
      "Limousine, Kleinwagen, Kombi und Transporter haben eigene Modelle mit Fenstern, Rädern und Lichtern statt einfacher Kisten.",
    ],
  },
  {
    version: "0.30",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Tag, Nacht und Fußgänger",
    items: [
      "Gemeinsamer Tag-Nacht-Zyklus (etwa 5 Minuten pro Tag) für Solo und Koop, mit Uhr und Wetter oben.",
      "Hell und dunkel wechseln; manchmal regnet es. Tag- und Nachtschichten beleben die Straßen unterschiedlich.",
      "Bewohner laufen auf dem Gehweg. Wer gerade arbeitet, ist nicht unterwegs.",
    ],
  },
  {
    version: "0.29",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Drehen und Nahzoom",
    items: [
      "Neuer Schauen-Modus Drehen neben Verschieben: Ziehen orbitiert die Kamera, mit Cursor-Hinweis.",
      "Doppelklick oder Doppeltipp auf ein Gebäude (Lupe oder Verschieben) zoomt nah heran.",
    ],
  },
  {
    version: "0.28",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Feedback und Atmosphäre",
    items: [
      "Kurze Sounds beim Bauen, Ablehnen, Auftrag und Level-Ende.",
      "Neue Gebäude poppen kurz auf. Versorgungs-Icons pulsieren.",
      "Schule, Klinik und Co. zeigen beim Platzieren den Wirkungsradius.",
      "Auftrags-Toasts und die Kasse reagieren sichtbarer. Level-Ende fährt weicher ein.",
      "Im Baumodus hängt ein Hinweis am Zeiger; Doppelklick beendet den Modus.",
    ],
  },
  {
    version: "0.27",
    at: "4. Nov 2026, 22:12 Uhr",
    title: "Testbericht-Fixes",
    items: [
      "Gebäude gehen vor Autos bei der Lupe; Infofenster springt nicht mehr von allein um. Bauwerkzeuge bleiben aktiv.",
      "Verschieben endet beim Wechseln des Werkzeugs. Zoom folgt dem Mauszeiger, Level starten in der Übersicht.",
      "Straßen mit Lücke (Wasser/Rand) werden verweigert. Level 7 hat wieder einen Fluss. Häuser nur direkt an der Straße.",
      "Löschen fragt nach und räumt lokal plus Server gemeinsam ab (ohne Eigentümer-Sperre, Testphase).",
      "Escape schließt Städte und Neuigkeiten. Mobile: Bau-Menü und Chat lassen sich scrollen.",
    ],
  },
  {
    version: "0.26",
    at: "4. Nov 2026, 18:28 Uhr",
    title: "Flughafen: Strom, Wasser, Nahrung",
    items: [
      "Der Flughafen gilt als versorgt, wenn Leitungen oder Rohre ihn berühren, oder wenn Kraftwerk und Wasserwerk direkt daneben stehen.",
      "Nahrung ist ein stadtweiter Vorrat. Die Kasse oben zeigt diese Zahl. Getreide und Import erhöhen genau denselben Stand.",
    ],
  },
  {
    version: "0.25",
    at: "4. Nov 2026, 18:26 Uhr",
    title: "Städtemenü",
    items: [
      "Das Startmenü ist klarer: Name oben, dann Neue Stadt und Levels, darunter die Städte als Karten.",
      "Gespeicherte Städte zeigen Einwohner und zuletzt gespielt. Laufende Koop-Städte bleiben grün markiert.",
      "Eine leere Liste erklärt, wie man die erste Stadt anlegt. Koop-Hosten steht darunter.",
    ],
  },
  {
    version: "0.24",
    at: "4. Nov 2026, 17:49 Uhr",
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
    at: "4. Nov 2026, 17:17 Uhr",
    title: "Handy und Tablet",
    items: [
      "Auf schmalen Bildschirmen klappen Menü, Aufgabe, Kasse, Nachfrage und Chat ein. Die Karte bleibt frei.",
      "Unten liegen kleine Buttons für Bauen, Verschieben, Städte und Nachfrage. Ein Finger baut, zwei Finger zoomen.",
      "Am großen Bildschirm bleibt die Oberfläche wie bisher.",
    ],
  },
  {
    version: "0.22",
    at: "4. Nov 2026, 17:01 Uhr",
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
    at: "4. Nov 2026, 16:39 Uhr",
    title: "Automatisch speichern",
    items: [
      "Eigene Städte speichern sich alle zwei Minuten von selbst, nicht im Level-Modus.",
      "Rechts unten erscheint kurz „Stadt gespeichert“.",
    ],
  },
  {
    version: "0.20",
    at: "4. Nov 2026, 16:36 Uhr",
    title: "Städtemenü, Verschieben, Koop-Zeiger",
    items: [
      "Im Städtemenü steht zuerst dein Name, dann eine neue Stadt erstellen, danach die vorgefertigten Levels.",
      "Unter Schauen gibt es Verschieben: Ziehen bewegt die Karte, auch ohne rechte Maustaste.",
      "Im Koop siehst du den Zeiger der anderen Person mit Namen auf der Karte.",
    ],
  },
  {
    version: "0.19",
    at: "4. Nov 2026, 16:28 Uhr",
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
    at: "4. Nov 2026, 14:15 Uhr",
    title: "HUD ohne Überlappung",
    items: [
      "Aufgabe, Menü, Spielerliste und Inspektor liegen nebeneinander, nicht übereinander.",
      "Die Spielerliste und die Lupe teilen sich die rechte Seite: immer nur eines ist offen.",
    ],
  },
  {
    version: "0.17",
    at: "4. Nov 2026, 14:15 Uhr",
    title: "Level-Koop und Spielerliste",
    items: [
      "Die Aufgabe bleibt oben rechts sichtbar. Ein Klick öffnet das Briefing wieder.",
      "Jedes Level geht auch zu zweit: Raum l3-hauptstadt ist Level 3 in der Stadt hauptstadt.",
      "Beim ersten Besuch fragt das Spiel nach dem Namen. Die Spielerliste zeigt, wer da ist.",
    ],
  },
  {
    version: "0.16",
    at: "4. Nov 2026, 14:15 Uhr",
    title: "Level-Modus",
    items: [
      "Im Menü Städte gibt es zehn Level. Level 1 ist frei, der Rest geht nacheinander auf.",
      "Jedes Level hat eine klare Aufgabe. Geschafft schaltet das nächste frei.",
      "Freies Bauen und Koop bleiben wie sie sind.",
    ],
  },
  {
    version: "0.15",
    at: "3. Nov 2026, 18:10 Uhr",
    title: "Aufträge und Nachfrage",
    items: [
      "Links unten liegt immer ein Auftrag. Erledigt bringt eine Prämie.",
      "Die Stadt bekommt einen Rang, vom Außenposten bis zur Großstadt.",
      "Ab 25 Nachfrage gibt es beim Bauen bis zu 40 % des Preises zurück.",
    ],
  },
  {
    version: "0.14",
    at: "3. Nov 2026, 17:45 Uhr",
    title: "Runde Küste",
    items: [
      "Die Inselkante ist gerundet, ohne die eckigen Kacheln am Ufer.",
      "Eine Böschung geht unter die Wellen, damit das Meer nicht mehr durch den Boden schneidet.",
    ],
  },
  {
    version: "0.13",
    at: "3. Nov 2026, 17:08 Uhr",
    title: "Runde Insel, dichtes Ufer",
    items: [
      "Die Insel ist eine Küste mit Buchten, kein Rechteck mehr.",
      "Das Meer bleibt unter dem Boden. Wellen schneiden nicht mehr durchs Land.",
    ],
  },
  {
    version: "0.12",
    at: "3. Nov 2026, 17:00 Uhr",
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
    at: "3. Nov 2026, 16:46 Uhr",
    title: "Insel und Kasse",
    items: [
      "Neue Städte liegen auf einer Insel, mit Küste, Fluss und manchmal einem See.",
      "Wohnhäuser zahlen Steuern, besetzte Betriebe bringen den Gewinn.",
      "Unter der Kasse steht, was alle zwei Sekunden übrig bleibt.",
    ],
  },
  {
    version: "0.10",
    at: "3. Nov 2026, 16:20 Uhr",
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
    at: "3. Nov 2026, 15:30 Uhr",
    title: "Stadt, Netze, Speicher",
    items: [
      "Häuser zeigen Familien, Autos und Bildung. Ein Abschluss braucht eine Schule in der Nähe.",
      "Eine Leitung versorgt eine zusammenhängende Häusergruppe.",
      "Städte lassen sich speichern, laden und löschen. Koop geht im gleichen Netzwerk.",
    ],
  },
];

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, "Mär": 3, Mar: 3, Apr: 4, Mai: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Okt: 10, Nov: 11, Dez: 12 };

/** "19. Nov 2026, 16:27 Uhr" → "2026-11-19T16:27+01:00" (Berlin time; the patch notes are all CET). */
export function noteIso(at: string): string | null {
  const m = /^(\d{1,2})\.\s*([A-Za-zä]{3})\w*\.?\s+(\d{4}),\s*(\d{1,2}):(\d{2})/.exec(at);
  const month = m ? MONTHS[m[2]] : undefined;
  if (!m || !month) return null;
  const pad = (n: number | string) => String(n).padStart(2, "0");
  return `${m[3]}-${pad(month)}-${pad(m[1])}T${pad(m[4])}:${m[5]}+01:00`;
}

/** Newest first, whatever order the list above is written in (stable for equal times). */
export function sortedNotes(notes: PatchNote[] = CHANGELOG): PatchNote[] {
  const time = (note: PatchNote) => Date.parse(noteIso(note.at) ?? "") || 0;
  return notes.map((note, index) => ({ note, index })).sort((a, b) => time(b.note) - time(a.note) || a.index - b.index).map((entry) => entry.note);
}
