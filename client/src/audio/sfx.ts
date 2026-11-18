/**
 * Audio façade. The synth engine (music, city ambience, effects) is code-split and
 * only loaded after the first user gesture and only if sound is not muted.
 */
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from "./settings.ts";

export type Cue =
  | "place" | "reject" | "goal" | "win" | "lose" | "click" | "demolish" | "cash"
  | "event" | "achievement" | "rank" | "horn" | "plane" | "toggle";

export interface AudioScene {
  /** 0 = street level … 1 = far overview. */
  zoom: number;
  hour: number;
  weather: "clear" | "cloud" | "rain";
  /** 0..1 densities around the camera target. */
  traffic: number;
  green: number;
  coast: number;
  harbor: number;
  airport: number;
  homes: number;
  /** Stereo hint −1..1 for the nearest coast. */
  coastPan: number;
  playing: boolean;
}

interface EngineApi {
  apply: (settings: AudioSettings) => void;
  cue: (cue: Cue) => void;
  scene: (scene: AudioScene) => void;
  resume: () => void;
  suspend: () => void;
}

let settings = loadAudioSettings();
let engine: EngineApi | null = null;
let loading: Promise<void> | null = null;
let gesture = false;
let lastScene: AudioScene | null = null;
let pendingCue: Cue | null = null;
const listeners = new Set<(settings: AudioSettings) => void>();

function wanted(): boolean {
  return gesture && !settings.muted && (settings.musicOn || settings.ambienceOn || settings.uiOn) && settings.master > 0;
}

function ensureEngine(): void {
  if (engine || loading || !wanted()) return;
  loading = import("./engine.ts")
    .then((mod) => {
      engine = mod.createAudioEngine(settings);
      if (lastScene) engine?.scene(lastScene);
      if (pendingCue && engine) engine.cue(pendingCue);
      pendingCue = null;
    })
    .catch(() => {
      /* audio unsupported – stay silent */
    })
    .finally(() => {
      loading = null;
    });
}

/** Call from a user gesture (browser autoplay rules). */
export function unlockAudio(): void {
  gesture = true;
  if (engine) engine.resume();
  else ensureEngine();
}

export function playSfx(cue: Cue): void {
  if (settings.muted) return;
  if (!engine) {
    if (loading) pendingCue = cue;
    return;
  }
  engine.cue(cue);
}

export function updateAudioScene(scene: AudioScene): void {
  lastScene = scene;
  engine?.scene(scene);
}

export function getAudioSettings(): AudioSettings {
  return { ...settings };
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  settings = { ...settings, ...patch };
  saveAudioSettings(settings);
  if (engine) engine.apply(settings);
  else ensureEngine();
  for (const listener of listeners) listener({ ...settings });
  return { ...settings };
}

export function onAudioSettings(listener: (settings: AudioSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function audioLoaded(): boolean {
  return engine !== null;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!engine) return;
    if (document.hidden) engine.suspend();
    else if (wanted()) engine.resume();
  });
}
