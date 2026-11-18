/** Audio preferences (tiny, no engine import). Persisted in localStorage. */
export interface AudioSettings {
  muted: boolean;
  master: number;
  musicOn: boolean;
  music: number;
  ambienceOn: boolean;
  ambience: number;
  uiOn: boolean;
  ui: number;
}

const KEY = "cityline-audio";

export const DEFAULT_AUDIO: AudioSettings = {
  muted: false,
  master: 0.8,
  musicOn: true,
  music: 0.55,
  ambienceOn: true,
  ambience: 0.7,
  uiOn: true,
  ui: 0.6,
};

const clamp = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: parsed.muted === true,
      master: clamp(parsed.master, DEFAULT_AUDIO.master),
      musicOn: parsed.musicOn !== false,
      music: clamp(parsed.music, DEFAULT_AUDIO.music),
      ambienceOn: parsed.ambienceOn !== false,
      ambience: clamp(parsed.ambience, DEFAULT_AUDIO.ambience),
      uiOn: parsed.uiOn !== false,
      ui: clamp(parsed.ui, DEFAULT_AUDIO.ui),
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked */
  }
}
