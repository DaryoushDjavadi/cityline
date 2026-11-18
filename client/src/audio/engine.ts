/**
 * Cityline sound engine – everything is synthesized with Web Audio (no audio files):
 *
 *  - Music: calm generative ambient piano + warm pads + soft bass in the spirit of
 *    relaxed city-builder soundtracks. Chord progressions, motifs that repeat and vary,
 *    sections that build up and break down, key changes. Brighter in the morning/day,
 *    softer and sparser at night.
 *  - Ambience: traffic hum, wind, surf, rain beds driven by what the camera sees,
 *    plus birds, seagulls and crickets as little events.
 *  - Effects: build thunk, demolish crumble, cash chime, ship horn, plane flyover,
 *    jingles for events / achievements / rank-ups, UI clicks.
 */
import type { AudioSettings } from "./settings.ts";
import type { AudioScene, Cue } from "./sfx.ts";

type Ctx = AudioContext;

const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Seeded RNG so music stays varied but never repeats identically. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx: Ctx, seconds: number, brown = false): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else data[i] = white;
    }
  }
  return buffer;
}

function impulse(ctx: Ctx, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay * (i < 200 ? i / 200 : 1);
    }
  }
  return buffer;
}

// ------------------------------------------------------------------ music theory

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** Scale degrees (0-based) per bar. */
const PROGRESSIONS: number[][] = [
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 2, 3, 3],
  [3, 0, 4, 5],
  [0, 5, 1, 4],
  [3, 4, 2, 5],
  [0, 3, 5, 4],
];
const NIGHT_PROGRESSIONS: number[][] = [
  [5, 2, 3, 0],
  [5, 3, 0, 0],
  [3, 3, 0, 5],
  [1, 4, 0, 5],
];
/** Tonic (MIDI) of the keys we wander through – warm, piano-friendly keys. */
const KEYS = [60];

function chordTones(tonic: number, degree: number, extended: boolean): number[] {
  const tone = (step: number) => {
    const octave = Math.floor((degree + step) / 7);
    return tonic + MAJOR[(degree + step) % 7] + octave * 12;
  };
  const notes = [tone(0), tone(2), tone(4)];
  if (extended) notes.push(tone(6));
  return notes;
}

function scaleNote(tonic: number, index: number): number {
  const octave = Math.floor(index / 7);
  const step = ((index % 7) + 7) % 7;
  return tonic + MAJOR[step] + octave * 12;
}

// ------------------------------------------------------------------ engine

class Engine {
  private readonly ctx: Ctx;
  private readonly out: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly musicBus: GainNode;
  private readonly ambBus: GainNode;
  private readonly uiBus: GainNode;
  private readonly fxBus: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;
  private readonly musicTone: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private readonly brown: AudioBuffer;
  private settings: AudioSettings;
  private scene: AudioScene = {
    zoom: 0.5, hour: 7, weather: "clear", traffic: 0, green: 0.5, coast: 0, harbor: 0, airport: 0, homes: 0, coastPan: 0, playing: false,
  };
  private beds: Record<"traffic" | "wind" | "surf" | "rain", { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode }>;
  private timer = 0;
  private nextBar = 0;
  private bar = 0;
  private key = 0;
  private progression: number[] = PROGRESSIONS[0];
  private motif: number[] = [];
  private readonly rand = rng(Date.now() & 0xffffff);
  private nextBird = 0;
  private nextGull = 0;
  private nextCricket = 0;
  private nextHonk = 0;
  private nextFlyover = 0;
  private lastCue = new Map<Cue, number>();

  constructor(settings: AudioSettings) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "playback" });
    this.settings = settings;
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.3;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(this.comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb).connect(this.out);

    this.musicTone = ctx.createBiquadFilter();
    this.musicTone.type = "lowpass";
    this.musicTone.frequency.value = 5200;
    this.musicTone.Q.value = 0.3;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicTone);
    this.musicTone.connect(this.out);
    const musicWet = ctx.createGain();
    musicWet.gain.value = 0.42;
    this.musicTone.connect(musicWet).connect(this.reverbSend);

    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.out);
    const ambWet = ctx.createGain();
    ambWet.gain.value = 0.18;
    this.ambBus.connect(ambWet).connect(this.reverbSend);

    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.out);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.ambBus);
    const fxWet = ctx.createGain();
    fxWet.gain.value = 0.3;
    this.fxBus.connect(fxWet).connect(this.reverbSend);

    this.noise = noiseBuffer(ctx, 3);
    this.brown = noiseBuffer(ctx, 4, true);
    this.beds = {
      traffic: this.bed(this.brown, "lowpass", 380, 0.6),
      wind: this.bed(this.noise, "bandpass", 520, 0.6),
      surf: this.bed(this.brown, "lowpass", 900, 0.4),
      rain: this.bed(this.noise, "highpass", 2600, 0.3),
    };
    this.newSection(true);
    this.apply(settings);
    this.resume();
    this.nextBar = ctx.currentTime + 0.4;
    this.timer = window.setInterval(() => this.tick(), 120);
  }

  // ---------------------------------------------------------------- public

  apply(settings: AudioSettings): void {
    this.settings = settings;
    const now = this.ctx.currentTime;
    const master = settings.muted ? 0 : settings.master;
    this.out.gain.setTargetAtTime(master * 0.9, now, 0.25);
    this.musicBus.gain.setTargetAtTime(settings.musicOn ? settings.music * 0.75 : 0, now, 0.6);
    this.ambBus.gain.setTargetAtTime(settings.ambienceOn ? settings.ambience : 0, now, 0.5);
    this.uiBus.gain.setTargetAtTime(settings.uiOn ? settings.ui * 0.8 : 0, now, 0.05);
    if (settings.muted || master === 0) this.suspendSoon();
    else this.resume();
  }

  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private probe: AnalyserNode | null = null;

  /** Diagnostics for tests: context state, bar counter and current output level (RMS). */
  debug(): { state: string; bar: number; key: number; rms: number } {
    if (!this.probe) {
      this.probe = this.ctx.createAnalyser();
      this.probe.fftSize = 2048;
      this.comp.connect(this.probe);
    }
    const data = new Float32Array(this.probe.fftSize);
    this.probe.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    return { state: this.ctx.state, bar: this.bar, key: this.key, rms: Math.sqrt(sum / data.length) };
  }

  dispose(): void {
    window.clearInterval(this.timer);
    void this.ctx.close();
  }

  suspend(): void {
    if (this.ctx.state === "running") void this.ctx.suspend();
  }

  private suspendTimer = 0;
  private suspendSoon(): void {
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      if (this.settings.muted || this.settings.master === 0) this.suspend();
    }, 600);
  }

  setScene(scene: AudioScene): void {
    this.scene = scene;
    const now = this.ctx.currentTime;
    const near = 1 - clamp01(scene.zoom) * 0.65;
    const day = scene.hour >= 6 && scene.hour < 21;
    const rain = scene.weather === "rain";
    const play = scene.playing ? 1 : 0.35;
    this.ramp(this.beds.traffic.gain, play * near * (0.05 + scene.traffic * 0.5) * (day ? 1 : 0.55));
    this.beds.traffic.filter.frequency.setTargetAtTime(260 + scene.traffic * 320 + near * 120, now, 0.8);
    this.ramp(this.beds.wind.gain, (0.035 + clamp01(scene.zoom) * 0.11 + scene.green * 0.035) * (rain ? 1.4 : 1));
    this.ramp(this.beds.surf.gain, play * scene.coast * (0.1 + near * 0.32));
    this.beds.surf.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, scene.coastPan)), now, 1);
    this.ramp(this.beds.rain.gain, rain ? 0.12 + near * 0.08 : 0);
    // Music colour follows the time of day: warm and open by day, soft at night.
    const bright = this.brightness();
    this.musicTone.frequency.setTargetAtTime(1500 + bright * 4200, now, 2);
  }

  cue(cue: Cue): void {
    const now = this.ctx.currentTime;
    const last = this.lastCue.get(cue) ?? -1;
    const gap = cue === "click" ? 0.04 : cue === "place" || cue === "demolish" ? 0.06 : cue === "horn" || cue === "plane" ? 6 : 0.25;
    if (now - last < gap) return;
    this.lastCue.set(cue, now);
    this.resume();
    switch (cue) {
      case "click": this.click(now); break;
      case "toggle": this.blip(now, [660, 880], 0.05, 0.03, this.uiBus); break;
      case "place": this.thunk(now); break;
      case "demolish": this.crumble(now); break;
      case "reject": this.blip(now, [240, 180], 0.11, 0.05, this.uiBus, "triangle"); break;
      case "cash": this.chime(now, [1568, 2093], 0.05); break;
      case "goal": this.arp(now, [72, 76, 79, 84], 0.11, 0.07); break;
      case "achievement": this.arp(now, [67, 72, 76, 79, 84, 88], 0.09, 0.07); break;
      case "rank": this.fanfare(now); break;
      case "event": this.chime(now, [880, 1175, 1318], 0.045); break;
      case "win": this.arp(now, [60, 64, 67, 72, 76, 79, 84], 0.1, 0.08); break;
      case "lose": this.blip(now, [330, 262, 196], 0.3, 0.05, this.uiBus, "triangle"); break;
      case "horn": this.shipHorn(now); break;
      case "plane": this.flyover(now); break;
    }
  }

  // ---------------------------------------------------------------- scheduler

  private tick(): void {
    if (this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    // Lookahead keeps music steady even when timers are throttled.
    const ahead = now + 1.6;
    let guard = 0;
    while (this.nextBar < ahead && guard < 4) {
      if (this.nextBar < now - 0.5) this.nextBar = now + 0.1;
      this.scheduleBar(this.nextBar);
      this.nextBar += this.barSeconds();
      guard += 1;
    }
    this.ambientEvents(now);
  }

  private brightness(): number {
    const h = this.scene.hour;
    if (h < 5 || h >= 22) return 0.12;
    if (h < 7) return 0.12 + ((h - 5) / 2) * 0.6;
    if (h < 18) return 0.72 + Math.sin(((h - 7) / 11) * Math.PI) * 0.28;
    if (h < 22) return 0.72 - ((h - 18) / 4) * 0.6;
    return 0.12;
  }

  private night(): boolean {
    return this.scene.hour < 6 || this.scene.hour >= 21.5;
  }

  private barSeconds(): number {
    const bpm = this.night() ? 62 : 70 + this.brightness() * 6;
    return (60 / bpm) * 4;
  }

  private newSection(first = false): void {
    if (!first && this.rand() < 0.45) {
      const steps = [5, 7, -5, 2, -3];
      const shift = steps[Math.floor(this.rand() * steps.length)];
      const next = this.key + shift;
      this.key = next > 7 || next < -6 ? 0 : next;
    }
    const pool = this.night() ? NIGHT_PROGRESSIONS : PROGRESSIONS;
    this.progression = pool[Math.floor(this.rand() * pool.length)];
    // Motif: 8 eighth-note slots, scale indices or −1 rests.
    this.motif = [];
    let step = 7 + Math.floor(this.rand() * 4);
    for (let i = 0; i < 8; i += 1) {
      if (this.rand() < 0.38) {
        this.motif.push(-1);
        continue;
      }
      step += [-2, -1, -1, 0, 1, 1, 2][Math.floor(this.rand() * 7)];
      step = Math.max(5, Math.min(13, step));
      this.motif.push(step);
    }
  }

  private scheduleBar(at: number): void {
    const len = this.barSeconds();
    const beat = len / 4;
    const tonic = KEYS[0] + this.key + (this.key > 3 ? -12 : 0);
    const section = Math.floor(this.bar / 8) % 4; // 0 intro, 1 build, 2 full, 3 breakdown
    if (this.bar > 0 && this.bar % 16 === 0) this.newSection();
    const degree = this.progression[this.bar % this.progression.length];
    const bright = this.brightness();
    const night = this.night();
    const chord = chordTones(tonic, degree, true);

    // Pad: always there, the warm bed.
    this.pad(at, len * 1.02, chord.map((note) => note - 12), night ? 0.022 : 0.028, bright);

    // Bass: from build-up on.
    if (section >= 1 && section <= 2) {
      this.bass(at, beat * 3.6, chord[0] - 24, night ? 0.05 : 0.07);
      if (this.rand() < 0.4) this.bass(at + beat * 2.5, beat * 1.4, chord[0] - 24 + 7, 0.035);
    }

    // Piano arpeggio (broken chord), lighter at night.
    const arpChance = night ? 0.45 : section === 0 ? 0.5 : 0.85;
    if (this.rand() < arpChance) {
      const pattern = [0, 1, 2, 1, 3, 2, 1, 2];
      const tones = [chord[0], chord[1], chord[2], chord[3] ?? chord[0] + 12];
      for (let i = 0; i < 8; i += 1) {
        if (night && i % 2 === 1) continue;
        if (this.rand() < 0.18) continue;
        const note = tones[pattern[i]] + (i >= 4 && bright > 0.5 ? 12 : 0);
        this.piano(at + i * (beat / 2) + this.human(), note, 0.035 + this.rand() * 0.015, 2.4);
      }
    }

    // Melody: motif with small variations in the full section and breakdown.
    if (section === 2 || (section === 3 && this.rand() < 0.7) || (section === 1 && this.bar % 2 === 1)) {
      const drop = section === 3 ? 7 : 0;
      for (let i = 0; i < 8; i += 1) {
        let step = this.motif[i];
        if (step < 0) continue;
        if (this.rand() < 0.2) step += this.rand() < 0.5 ? 1 : -1;
        const note = scaleNote(tonic, step - drop);
        const fitted = this.fitToChord(note, chord);
        this.piano(at + i * (beat / 2) + this.human(), fitted, 0.06 + this.rand() * 0.02, 3.2);
      }
    }

    // Morning sparkle: celesta bells.
    if (!night && bright > 0.6 && this.rand() < 0.35) {
      const note = chord[1 + Math.floor(this.rand() * 2)] + 24;
      this.bell(at + beat * (1 + Math.floor(this.rand() * 3)), note, 0.018);
    }
    this.bar += 1;
  }

  private fitToChord(note: number, chord: number[]): number {
    // On strong clashes (semitone against a chord tone) step to the nearest chord tone.
    for (const tone of chord) {
      const d = (((note - tone) % 12) + 12) % 12;
      if (d === 1 || d === 11) return note + (d === 1 ? -1 : 1);
    }
    return note;
  }

  private human(): number {
    return (this.rand() - 0.5) * 0.03;
  }

  // ---------------------------------------------------------------- instruments

  private piano(at: number, midi: number, velocity: number, decay: number): void {
    const ctx = this.ctx;
    const freq = mtof(midi);
    const amp = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(Math.min(9000, freq * 6), at);
    tone.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 1.6), at + decay * 0.6);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(velocity, at + 0.008);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.35, at + 0.35);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    const partials: [number, number, OscillatorType][] = [[1, 1, "triangle"], [2, 0.32, "sine"], [3, 0.1, "sine"]];
    for (const [ratio, level, type] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * ratio * (1 + (this.rand() - 0.5) * 0.0015);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(tone);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 66) / 30));
    tone.connect(amp).connect(pan).connect(this.musicBus);
  }

  private pad(at: number, length: number, notes: number[], level: number, bright: number): void {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(500 + bright * 900, at);
    filter.frequency.linearRampToValueAtTime(700 + bright * 1400, at + length * 0.5);
    filter.frequency.linearRampToValueAtTime(500 + bright * 900, at + length);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(level, at + Math.min(1.6, length * 0.35));
    amp.gain.setValueAtTime(level, at + length * 0.75);
    amp.gain.linearRampToValueAtTime(0.0001, at + length + 1.2);
    for (const note of notes) {
      for (const detune of [-7, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = mtof(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(at);
        osc.stop(at + length + 1.3);
      }
    }
    filter.connect(amp).connect(this.musicBus);
  }

  private bass(at: number, length: number, midi: number, level: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = mtof(midi);
    const sub = ctx.createOscillator();
    sub.type = "triangle";
    sub.frequency.value = mtof(midi);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.25;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.04);
    amp.gain.exponentialRampToValueAtTime(level * 0.5, at + length * 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(amp);
    sub.connect(subGain).connect(amp);
    amp.connect(this.musicBus);
    osc.start(at);
    sub.start(at);
    osc.stop(at + length + 0.05);
    sub.stop(at + length + 0.05);
  }

  private bell(at: number, midi: number, level: number): void {
    const ctx = this.ctx;
    const freq = mtof(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
    for (const [ratio, gain] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(amp);
      osc.start(at);
      osc.stop(at + 2.7);
    }
    amp.connect(this.musicBus);
  }

  // ---------------------------------------------------------------- ambience

  private bed(buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number): { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode } {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = this.rand() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(filter).connect(gain).connect(pan).connect(this.ambBus);
    src.start();
    // Slow swells so beds breathe (surf, wind).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = type === "bandpass" ? 0.06 : 0.11 + this.rand() * 0.05;
    const depth = ctx.createGain();
    depth.gain.value = type === "bandpass" ? 220 : type === "lowpass" && freq > 600 ? 380 : 40;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();
    return { gain, filter, pan };
  }

  private ramp(gain: GainNode, value: number): void {
    gain.gain.setTargetAtTime(Math.max(0, value), this.ctx.currentTime, 0.9);
  }

  private ambientEvents(now: number): void {
    const s = this.scene;
    if (!this.settings.ambienceOn || !s.playing) return;
    const near = 1 - clamp01(s.zoom) * 0.7;
    const day = s.hour >= 5.5 && s.hour < 20.5;
    const rain = s.weather === "rain";
    if (day && !rain && s.green > 0.12 && now > this.nextBird) {
      this.birdSong(now, near * (0.4 + s.green));
      this.nextBird = now + 1.5 + this.rand() * (7 - s.green * 4);
    }
    if (day && (s.coast > 0.15 || s.harbor > 0.2) && now > this.nextGull) {
      this.gull(now, near * Math.max(s.coast, s.harbor));
      this.nextGull = now + 5 + this.rand() * 12;
    }
    if (!day && !rain && s.green > 0.1 && now > this.nextCricket) {
      this.crickets(now, near * (0.3 + s.green * 0.7));
      this.nextCricket = now + 0.8 + this.rand() * 2.2;
    }
    if (s.traffic > 0.3 && now > this.nextHonk) {
      if (this.rand() < 0.5) this.honk(now, near * s.traffic);
      this.nextHonk = now + 9 + this.rand() * 20;
    }
    if (s.airport > 0.25 && day && now > this.nextFlyover) {
      if (this.nextFlyover > 0) this.flyover(now, s.airport * near);
      this.nextFlyover = now + 26 + this.rand() * 30;
    }
  }

  private birdSong(at: number, level: number): void {
    const ctx = this.ctx;
    const notes = 2 + Math.floor(this.rand() * 4);
    const base = 2600 + this.rand() * 1800;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.6 - 0.8;
    pan.connect(this.ambBus);
    for (let i = 0; i < notes; i += 1) {
      const t = at + i * (0.09 + this.rand() * 0.07);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const f = base * (0.85 + this.rand() * 0.35);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (this.rand() < 0.5 ? 1.35 : 0.7), t + 0.07);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.018 * level + 0.002, t + 0.01);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(amp).connect(pan);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  private gull(at: number, level: number): void {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.scene.coastPan * 0.7 + (this.rand() - 0.5) * 0.4;
    pan.connect(this.ambBus);
    const calls = 1 + Math.floor(this.rand() * 3);
    for (let i = 0; i < calls; i += 1) {
      const t = at + i * 0.32;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(1350, t);
      osc.frequency.linearRampToValueAtTime(1750, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(820, t + 0.26);
      const vib = ctx.createOscillator();
      vib.frequency.value = 28;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = 40;
      vib.connect(vibDepth).connect(osc.frequency);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1500;
      band.Q.value = 2.2;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.035 * level + 0.002, t + 0.03);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(band).connect(amp).connect(pan);
      osc.start(t);
      vib.start(t);
      osc.stop(t + 0.3);
      vib.stop(t + 0.3);
    }
  }

  private crickets(at: number, level: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 4300 + this.rand() * 500;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.4 - 0.7;
    for (let i = 0; i < 6; i += 1) {
      const t = at + i * 0.045;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.006 * level + 0.0005, t + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    }
    osc.connect(amp).connect(pan).connect(this.ambBus);
    osc.start(at);
    osc.stop(at + 0.32);
  }

  private honk(at: number, level: number): void {
    const ctx = this.ctx;
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.012 * level + 0.001, at + 0.02);
    amp.gain.setValueAtTime(0.012 * level + 0.001, at + 0.16);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    for (const f of [392, 494]) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + 0.26);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.2 - 0.6;
    filter.connect(amp).connect(pan).connect(this.ambBus);
  }

  // ---------------------------------------------------------------- effects

  private shipHorn(at: number): void {
    const ctx = this.ctx;
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    const level = 0.08 * (0.5 + Math.max(this.scene.harbor, 0.3));
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.25);
    amp.gain.setValueAtTime(level, at + 1.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 2.3);
    for (const f of [98, 123.5, 196]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + 2.4);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.scene.coastPan * 0.6;
    filter.connect(amp).connect(pan).connect(this.fxBus);
  }

  private flyover(at: number, level = 0.6): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(380, at);
    filter.frequency.linearRampToValueAtTime(1100, at + 2.2);
    filter.frequency.linearRampToValueAtTime(320, at + 5);
    const amp = ctx.createGain();
    const peak = 0.05 * Math.max(0.3, level);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(peak, at + 2.2);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 5.2);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.8, at);
    pan.pan.linearRampToValueAtTime(0.8, at + 5);
    src.connect(filter).connect(amp).connect(pan).connect(this.fxBus);
    src.start(at, this.rand() * 1.5);
    src.stop(at + 5.3);
  }

  private thunk(at: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(170, at);
    osc.frequency.exponentialRampToValueAtTime(62, at + 0.12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.16, at + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(amp).connect(this.uiBus);
    osc.start(at);
    osc.stop(at + 0.2);
    // Wooden knock on top.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 3;
    const knock = ctx.createGain();
    knock.gain.setValueAtTime(0.05, at);
    knock.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(band).connect(knock).connect(this.uiBus);
    src.start(at, this.rand());
    src.stop(at + 0.06);
  }

  private crumble(at: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1600, at);
    filter.frequency.exponentialRampToValueAtTime(200, at + 0.45);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    src.connect(filter).connect(amp).connect(this.uiBus);
    src.start(at, this.rand() * 2);
    src.stop(at + 0.55);
    for (let i = 0; i < 4; i += 1) this.blip(at + 0.04 + i * 0.07 + this.rand() * 0.03, [140 + this.rand() * 90], 0.06, 0.03, this.uiBus, "triangle");
  }

  private click(at: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1250, at);
    osc.frequency.exponentialRampToValueAtTime(700, at + 0.03);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.045, at + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    osc.connect(amp).connect(this.uiBus);
    osc.start(at);
    osc.stop(at + 0.05);
  }

  private chime(at: number, freqs: number[], level: number): void {
    freqs.forEach((freq, i) => {
      const t = at + i * 0.08;
      const ctx = this.ctx;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(level, t + 0.005);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      for (const [ratio, g] of [[1, 1], [2.0, 0.25], [3.01, 0.08]] as const) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq * ratio;
        const gain = ctx.createGain();
        gain.gain.value = g;
        osc.connect(gain).connect(amp);
        osc.start(t);
        osc.stop(t + 0.95);
      }
      amp.connect(this.uiBus);
    });
  }

  private arp(at: number, notes: number[], step: number, level: number): void {
    notes.forEach((note, i) => this.chime(at + i * step, [mtof(note)], level * (1 - i * 0.05)));
  }

  private fanfare(at: number): void {
    const ctx = this.ctx;
    const chords = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]];
    chords.forEach((chord, i) => {
      const t = at + i * 0.18;
      const len = i === chords.length - 1 ? 1.4 : 0.22;
      for (const note of chord) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = mtof(note);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(0.035, t + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(amp).connect(this.uiBus);
        osc.start(t);
        osc.stop(t + len + 0.05);
      }
    });
  }

  private blip(at: number, freqs: number[], duration: number, gain: number, bus: GainNode, type: OscillatorType = "sine"): void {
    freqs.forEach((freq, index) => {
      const start = at + index * 0.05;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp).connect(bus);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }
}

export function createAudioEngine(settings: AudioSettings): {
  apply: (settings: AudioSettings) => void;
  cue: (cue: Cue) => void;
  scene: (scene: AudioScene) => void;
  resume: () => void;
  suspend: () => void;
} {
  const engine = new Engine(settings);
  (window as unknown as { __citylineAudio?: unknown }).__citylineAudio = engine;
  return {
    apply: (next) => engine.apply(next),
    cue: (cue) => engine.cue(cue),
    scene: (scene) => engine.setScene(scene),
    resume: () => engine.resume(),
    suspend: () => engine.suspend(),
  };
}
