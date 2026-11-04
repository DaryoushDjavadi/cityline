/** Shared day/night + weather from city.tick (identical for all clients). */

/** 600 ticks × 0.5 s = 5 real minutes per in-game day. */
export const DAY_TICKS = 600;

export type WeatherKind = "clear" | "cloud" | "rain";

export interface Climate {
  tick: number;
  phase: number;
  hour: number;
  minute: number;
  isNight: boolean;
  /** Day-shift window roughly 7–19. */
  isDayShift: boolean;
  weather: WeatherKind;
  clock: string;
  weatherLabel: string;
  /** 0 = midnight dark, 1 = noon bright. */
  daylight: number;
  /** 0 quiet … 1 packed streets (rush hour). */
  streetActivity: number;
  rushHour: boolean;
  vibeLabel: string;
}

export function climateAt(tick: number): Climate {
  const safe = Math.max(0, tick | 0);
  const phase = (safe % DAY_TICKS) / DAY_TICKS;
  const hourFloat = phase * 24;
  const hour = Math.floor(hourFloat) % 24;
  const minute = Math.floor((hourFloat - Math.floor(hourFloat)) * 60);
  const isNight = hourFloat < 6.5 || hourFloat >= 20.5;
  const isDayShift = hourFloat >= 7 && hourFloat < 19;
  const weather = weatherAt(safe);
  const daylight = daylightCurve(hourFloat);
  const streetActivity = streetActivityAt(hourFloat);
  const rushHour = streetActivity >= 0.85;
  return {
    tick: safe,
    phase,
    hour: hourFloat,
    minute,
    isNight,
    isDayShift,
    weather,
    clock: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    weatherLabel: weather === "rain" ? "Regen" : weather === "cloud" ? "Bewölkt" : "Klar",
    daylight,
    streetActivity,
    rushHour,
    vibeLabel: vibeLabelAt(hourFloat, streetActivity, weather),
  };
}

/** ~20 % of adults work nights (stable per home+slot). */
export function isNightShift(home: number, slot: number): boolean {
  return climateHash(home * 17 + slot * 41) % 5 === 0;
}

/** Employed adult currently at their workplace (not commuting / not on the street). */
export function isOnDuty(home: number, slot: number, workplace: number | null, climate: Climate): boolean {
  if (workplace === null) return false;
  if (isCommuting(home, slot, workplace, climate)) return false;
  const nights = isNightShift(home, slot);
  return nights ? !climate.isDayShift : climate.isDayShift;
}

/** Workers heading to / from the job — fills the streets at rush hour. */
export function isCommuting(home: number, slot: number, workplace: number | null, climate: Climate): boolean {
  if (workplace === null) return false;
  const h = climate.hour;
  if (isNightShift(home, slot)) {
    return (h >= 18.4 && h < 20.2) || (h >= 5.8 && h < 7.4);
  }
  return (h >= 6.8 && h < 9.1) || (h >= 16.6 && h < 19.2);
}

/** How busy the roads feel right now (shared for all clients via tick). */
export function streetActivityAt(hour: number): number {
  const peaks = [
    { center: 8.0, width: 1.15, height: 1 },
    { center: 12.6, width: 0.7, height: 0.55 },
    { center: 17.6, width: 1.25, height: 1 },
    { center: 21.2, width: 1.1, height: 0.42 },
  ];
  let activity = 0.1;
  for (const peak of peaks) {
    const t = Math.abs(hour - peak.center) / peak.width;
    if (t < 1) activity = Math.max(activity, peak.height * (1 - t * t));
  }
  if (hour >= 0 && hour < 5.5) activity = Math.min(activity, 0.14);
  return Math.max(0.08, Math.min(1, activity));
}

function vibeLabelAt(hour: number, activity: number, weather: WeatherKind): string {
  if (weather === "rain" && activity > 0.55) return "Nasser Berufsverkehr";
  if (activity >= 0.85) return hour < 12 ? "Morgen-Rushhour" : "Abend-Rushhour";
  if (hour >= 12 && hour < 13.5 && activity > 0.45) return "Mittagspause";
  if (hour >= 20 && hour < 23.5) return "Abendleben";
  if (hour >= 0 && hour < 5.5) return "Ruhezeit";
  if (hour >= 5.5 && hour < 7) return "Früher Morgen";
  return weather === "rain" ? "Regentag" : "Tagesverkehr";
}

function weatherAt(tick: number): WeatherKind {
  const period = Math.max(1, Math.floor(DAY_TICKS / 4));
  const bucket = Math.floor(tick / period);
  const roll = climateHash(bucket * 7919 + 13) % 10;
  if (roll >= 8) return "rain";
  if (roll >= 5) return "cloud";
  return "clear";
}

/** Smooth daylight for lighting (peaks at noon). */
function daylightCurve(hour: number): number {
  const noon = 1 - Math.abs(hour - 12) / 12;
  return Math.max(0, Math.min(1, noon ** 1.15));
}

function climateHash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
