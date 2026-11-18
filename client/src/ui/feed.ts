/** Bürger-Feed: short, mostly funny lines from residents, picked from what the city is doing. */
import { climateAt, type CityState, type SimMeta, ServiceKind } from "../../../shared/src/index.ts";

const FIRST = ["Mara", "Jonas", "Lea", "Emil", "Nora", "Theo", "Mila", "Anton", "Frieda", "Luis", "Ida", "Mats", "Greta", "Paul", "Hanna", "Oskar"];
const LAST = ["Berger", "Kranz", "Holm", "Adler", "Voss", "Seidel", "Hartmann", "Baum", "Lindner", "Oswald", "Brandt", "Kühn"];

export interface FeedLine {
  text: string;
  who: string;
  tone: "info" | "good" | "bad" | "city";
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length) % list.length];
}

function has(city: CityState, kind: number): boolean {
  for (let index = 0; index < city.services.length; index += 1) if (city.services[index] === kind) return true;
  return false;
}

export function residentName(): string {
  return `${pick(FIRST)} ${pick(LAST)}`;
}

/** One resident voice for the current city state, or null when nothing fits. */
export function cityChatter(city: CityState, meta: SimMeta, recent: Set<string>, last?: string): FeedLine | null {
  const s = meta.stats;
  if (s.population <= 0) return null;
  const climate = climateAt(city.tick);
  const h = climate.hour;
  const mood = city.progress?.stats.mood ?? 0;
  const all: { text: string; tone: FeedLine["tone"]; weight: number }[] = [];
  const add = (weight: number, tone: FeedLine["tone"], ...texts: string[]) => {
    for (const text of texts) all.push({ text, tone, weight });
  };
  if (s.powerCapacity > 0 && s.powerUsed > s.powerCapacity) add(4, "bad", "Schon wieder Stromausfall – und ich wollte gerade Nudeln kochen.", "Mein Kühlschrank summt nicht mehr. Kein gutes Zeichen.");
  if (s.powerCapacity === 0 && s.population > 20) add(3, "bad", "Wir lesen abends bei Kerzenlicht. Romantisch, aber unpraktisch.");
  if (s.waterCapacity > 0 && s.waterUsed > s.waterCapacity) add(4, "bad", "Duschen nur noch kalt und tröpfchenweise. Bitte mehr Wasser!");
  if (s.foodUsed > 0 && s.foodUsed > s.foodCapacity + s.foodStock) add(4, "bad", "Im Laden ist das Brot schon wieder aus.", "Mein Magen knurrt lauter als der Verkehr.");
  if (s.traffic > 55) add(3, "bad", "Stau auf der Hauptstraße. Ich komm zu spät zur Arbeit!", "Zu Fuß bin ich schneller als mit dem Auto.");
  if (meta.funds < 1_500) add(2, "bad", "Im Rathaus munkelt man, die Stadtkasse sei leer.");
  if (climate.weather === "rain") add(2, "info", "Regenschirm vergessen. Typisch.", "Endlich Regen – meine Tomaten freuen sich.");
  if (h >= 6 && h < 9) add(2, "info", "Guten Morgen! Erst Kaffee, dann die Welt.", "Die Morgensonne über dem Meer – dafür steh ich gern früh auf.");
  if (h >= 21 || h < 5) add(2, "info", "Die Stadt schläft. Nur die Laternen summen leise.", "Nachtschicht. Zum Glück ist es ruhig.");
  if (h >= 11 && h < 18 && climate.weather !== "rain") add(1, "good", "Mittagspause im Freien – herrlich.");
  if (has(city, ServiceKind.Harbor)) add(2, "good", "Frischer Fisch direkt vom Hafen. Heute Abend gibt’s Scholle!", "Die Kräne am Hafen sind so beruhigend anzusehen.");
  if (has(city, ServiceKind.Airport)) add(2, "good", "Gerade gelandet – was für eine Aussicht auf die Küste!", "Der Flughafen bringt so viele Touristen. Mein Café brummt.");
  if (has(city, ServiceKind.Park)) add(2, "good", "Picknick im Park. Die Enten bekommen die Hälfte.", "Im Park joggen? Na gut, morgen.");
  if (has(city, ServiceKind.Wheel)) add(3, "good", "Vom Riesenrad aus sieht man die ganze Bucht!", "Erstes Date im Riesenrad. Ganz oben hat’s gefunkt.");
  if (has(city, ServiceKind.CityHall)) add(2, "good", "Das neue Rathaus ist wirklich hübsch. Die Uhr geht sogar richtig.");
  if (has(city, ServiceKind.Tower)) add(3, "good", "Ich hab den Fernsehturm von meinem Balkon aus fotografiert. 400 Likes!");
  if (!has(city, ServiceKind.Park) && s.population > 60) add(3, "bad", "Ganz ehrlich: Hier fehlt ein Park.");
  if (!has(city, ServiceKind.School) && s.population > 80) add(2, "bad", "Meine Kinder brauchen eine Schule. Bitte!");
  if (mood >= 78) add(3, "good", "Ich zieh hier nie wieder weg.", "Bestes Städtchen am ganzen Meer. Punkt.");
  if (mood > 0 && mood < 50) add(3, "bad", "Ich überlege, wegzuziehen. Hier ist zu wenig los.");
  if ((city.progress?.effects ?? []).some((effect) => effect.id === "fest" && effect.until > city.tick)) add(5, "good", "Was für ein Fest! Meine Füße tun weh vom Tanzen.");
  if ((city.progress?.effects ?? []).some((effect) => effect.id === "beachparty" && effect.until > city.tick)) add(5, "good", "Eis am Strand und Musik – so muss Sommer!");
  if ((city.shipments ?? []).length > 0) add(2, "info", "Ein Frachter läuft ein. Ich wink immer.");
  add(1, "info", "Neue Nachbarn eingezogen. Die bringen Kuchen mit!", "Mein Hund hat heute die ganze Stadt begrüßt.", "Hat jemand meine Katze gesehen? Rot, frech, heißt Pixel.");
  // Prefer fresh lines; once everything was said recently, repeat (but never the same line twice in a row).
  let options = all.filter((entry) => !recent.has(entry.text));
  if (options.length === 0) options = all.filter((entry) => entry.text !== last);
  if (options.length === 0) options = all;
  if (options.length === 0) return null;
  const total = options.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of options) {
    roll -= entry.weight;
    if (roll <= 0) return { text: entry.text, tone: entry.tone, who: residentName() };
  }
  const tail = options[options.length - 1];
  return { text: tail.text, tone: tail.tone, who: residentName() };
}
