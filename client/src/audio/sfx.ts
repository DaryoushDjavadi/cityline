/** Tiny WebAudio cues — no asset files. Unlocks on first user gesture. */

type Cue = "place" | "reject" | "goal" | "win" | "lose" | "click";

let ctx: AudioContext | null = null;
let unlocked = false;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio(): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();
  unlocked = true;
}

export function playSfx(cue: Cue): void {
  const audio = context();
  if (!audio || !unlocked) return;
  if (audio.state === "suspended") void audio.resume();
  const now = audio.currentTime;
  if (cue === "place") blip(audio, now, [520, 740], 0.07, 0.045);
  else if (cue === "reject") blip(audio, now, [220, 160], 0.09, 0.05);
  else if (cue === "click") blip(audio, now, [440], 0.04, 0.03);
  else if (cue === "goal") chord(audio, now, [523, 659, 784], 0.22, 0.055);
  else if (cue === "win") chord(audio, now, [392, 523, 659, 784], 0.45, 0.06);
  else if (cue === "lose") blip(audio, now, [300, 240, 180], 0.28, 0.05);
}

function blip(audio: AudioContext, at: number, freqs: number[], duration: number, gain: number): void {
  freqs.forEach((freq, index) => {
    const start = at + index * 0.045;
    tone(audio, start, freq, duration, gain, "triangle");
  });
}

function chord(audio: AudioContext, at: number, freqs: number[], duration: number, gain: number): void {
  freqs.forEach((freq, index) => {
    tone(audio, at + index * 0.03, freq, duration - index * 0.02, gain * (1 - index * 0.08), "sine");
  });
}

function tone(
  audio: AudioContext,
  start: number,
  freq: number,
  duration: number,
  gain: number,
  type: OscillatorType,
): void {
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}
