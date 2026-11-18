/** Klang settings in the Nachfrage/Einstellungen panel + speaker button in the HUD. */
import { getAudioSettings, onAudioSettings, playSfx, setAudioSettings, unlockAudio } from "../audio/sfx.ts";
import type { AudioSettings } from "../audio/settings.ts";

type Pair = { on: keyof AudioSettings; level: keyof AudioSettings; toggle: string; range: string };

const PAIRS: Pair[] = [
  { on: "musicOn", level: "music", toggle: "snd-music-on", range: "snd-music" },
  { on: "ambienceOn", level: "ambience", toggle: "snd-amb-on", range: "snd-amb" },
  { on: "uiOn", level: "ui", toggle: "snd-ui-on", range: "snd-ui" },
];

export function bindAudioControls(): void {
  const speaker = document.getElementById("toggle-sound") as HTMLButtonElement | null;
  const master = document.getElementById("snd-master") as HTMLInputElement | null;
  const on = document.getElementById("snd-on") as HTMLInputElement | null;
  const paint = (s: AudioSettings) => {
    if (speaker) {
      speaker.dataset.muted = s.muted ? "1" : "0";
      speaker.setAttribute("aria-pressed", String(!s.muted));
      const label = s.muted ? "Ton an" : "Ton aus";
      speaker.setAttribute("aria-label", label);
      speaker.title = `${label} (Lautstärken unter Einstellungen › Klang)`;
    }
    if (on) on.checked = !s.muted;
    if (master) {
      master.value = String(Math.round(s.master * 100));
      master.disabled = s.muted;
    }
    for (const pair of PAIRS) {
      const toggle = document.getElementById(pair.toggle) as HTMLInputElement | null;
      const range = document.getElementById(pair.range) as HTMLInputElement | null;
      if (toggle) {
        toggle.checked = Boolean(s[pair.on]);
        toggle.disabled = s.muted;
      }
      if (range) {
        range.value = String(Math.round(Number(s[pair.level]) * 100));
        range.disabled = s.muted || !s[pair.on];
      }
    }
    document.body.dataset.sound = s.muted ? "off" : "on";
  };
  paint(getAudioSettings());
  onAudioSettings(paint);

  speaker?.addEventListener("click", () => {
    const muted = !getAudioSettings().muted;
    setAudioSettings({ muted });
    if (!muted) {
      unlockAudio();
      playSfx("toggle");
    }
  });
  on?.addEventListener("change", () => {
    setAudioSettings({ muted: !on.checked });
    if (on.checked) {
      unlockAudio();
      playSfx("toggle");
    }
  });
  master?.addEventListener("input", () => setAudioSettings({ master: Number(master.value) / 100 }));
  for (const pair of PAIRS) {
    const toggle = document.getElementById(pair.toggle) as HTMLInputElement | null;
    const range = document.getElementById(pair.range) as HTMLInputElement | null;
    toggle?.addEventListener("change", () => {
      setAudioSettings({ [pair.on]: toggle.checked } as Partial<AudioSettings>);
      if (toggle.checked) unlockAudio();
    });
    range?.addEventListener("input", () => setAudioSettings({ [pair.level]: Number(range.value) / 100 } as Partial<AudioSettings>));
    range?.addEventListener("change", () => {
      if (pair.on === "uiOn") playSfx("click");
    });
  }

  // Soft click for every HUD button; first gesture anywhere unlocks audio.
  document.addEventListener(
    "pointerdown",
    () => unlockAudio(),
    { capture: true, passive: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest("button");
      if (!target || target.id === "toggle-sound" || target.closest("#event-card")) return;
      playSfx("click");
    },
    { capture: true },
  );
}
