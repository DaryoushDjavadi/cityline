export type GfxPreset = "auto" | "high" | "medium" | "low";
export type GfxLevel = "high" | "medium" | "low";

export interface GfxProfile {
  preset: GfxPreset;
  level: GfxLevel;
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  bloom: boolean;
  vignette: boolean;
  clouds: boolean;
  stars: boolean;
  seaSegments: number;
  rainCount: number;
  shadowEvery: number;
}

const STORAGE_KEY = "cityline-gfx";

export function loadGfxPreset(): GfxPreset {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "high" || stored === "medium" || stored === "low" || stored === "auto") return stored;
  return "auto";
}

export function saveGfxPreset(preset: GfxPreset): void {
  localStorage.setItem(STORAGE_KEY, preset);
}

export function detectLowEnd(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const mobile = /Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
  const small = typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) <= 520;
  return mobile || cores <= 4 || memory <= 4 || small;
}

export function resolveGfxLevel(preset: GfxPreset): GfxLevel {
  if (preset !== "auto") return preset;
  if (detectLowEnd()) return "low";
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 8 : 8;
  if (cores <= 6) return "medium";
  return "high";
}

export function gfxProfile(preset: GfxPreset, devicePixelRatio = 1): GfxProfile {
  const level = resolveGfxLevel(preset);
  if (level === "low") {
    return {
      preset,
      level,
      pixelRatio: 1,
      shadows: false,
      shadowMap: 0,
      bloom: false,
      vignette: false,
      clouds: false,
      stars: false,
      seaSegments: 24,
      rainCount: 280,
      shadowEvery: 0,
    };
  }
  if (level === "medium") {
    return {
      preset,
      level,
      pixelRatio: Math.min(devicePixelRatio || 1, 1.35),
      shadows: false,
      shadowMap: 0,
      bloom: false,
      vignette: true,
      clouds: true,
      stars: true,
      seaSegments: 48,
      rainCount: 520,
      shadowEvery: 0,
    };
  }
  return {
    preset,
    level,
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    shadows: true,
    shadowMap: 1024,
    bloom: true,
    vignette: true,
    clouds: true,
    stars: true,
    seaSegments: 80,
    rainCount: 720,
    shadowEvery: 2,
  };
}
