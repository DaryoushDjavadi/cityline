/** Serializable progress state (no runtime imports, so types.ts can use it without cycles). */
import type { CityState } from "./types.ts";

export const FIRST_EVENT_DELAY = 360;
export type ChallengeKind = "homes" | "pop" | "jobs" | "parks" | "trade" | "happy" | "roads";
export const CHALLENGE_KINDS: ChallengeKind[] = ["homes", "pop", "jobs", "parks", "trade", "happy", "roads"];
export const EVENT_IDS = ["festival", "storm", "tourists", "harborfest", "heat", "harvest", "concert", "investor"] as const;
const RANK_COUNT = 7;

export type EventId = (typeof EVENT_IDS)[number];

export interface CityEffect {
  id: string;
  until: number;
  mood: number;
  mult: number;
  flat: number;
}

export interface ProgressStats {
  trade: number;
  festivals: number;
  storms: number;
  events: number;
  challenges: number;
  /** Average home happiness 0–100 (last progress pass). */
  mood: number;
  /** Homes at "very happy" (smiley) level. */
  happy: number;
}

export interface DailyChallenge {
  day: number;
  kind: ChallengeKind;
  base: number;
  target: number;
  reward: number;
  done: boolean;
}

export interface CityProgress {
  v: 1;
  seeded: boolean;
  /** Level rooms switch the whole layer off. */
  off?: boolean;
  rank: number;
  ach: number;
  event: { id: EventId; at: number; until: number } | null;
  nextEvent: number;
  effects: CityEffect[];
  /** Last resolved thing, so every coop client can toast it once. */
  last: { tick: number; kind: "event" | "rank" | "ach" | "challenge"; title: string; text: string; pay: number } | null;
  stats: ProgressStats;
  challenge: DailyChallenge | null;
}

export function freshProgress(tick: number): CityProgress {
  return {
    v: 1,
    seeded: false,
    rank: 0,
    ach: 0,
    event: null,
    nextEvent: tick + FIRST_EVENT_DELAY,
    effects: [],
    last: null,
    stats: { trade: 0, festivals: 0, storms: 0, events: 0, challenges: 0, mood: 0, happy: 0 },
    challenge: null,
  };
}

const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, max = 160): string => (typeof value === "string" ? value.slice(0, max) : "");

/** Defensive copy for meta/save transport (also sanitizes untrusted input). */
export function cloneProgress(raw: unknown): CityProgress | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Partial<CityProgress>;
  const stats = (p.stats ?? {}) as Partial<ProgressStats>;
  const event = p.event && typeof p.event === "object" && EVENT_IDS.includes(p.event.id as EventId)
    ? { id: p.event.id as EventId, at: num(p.event.at) | 0, until: num(p.event.until) | 0 }
    : null;
  const challenge = p.challenge && typeof p.challenge === "object" && CHALLENGE_KINDS.includes(p.challenge.kind as ChallengeKind)
    ? {
      day: num(p.challenge.day) | 0,
      kind: p.challenge.kind as ChallengeKind,
      base: num(p.challenge.base),
      target: Math.max(1, num(p.challenge.target, 1)),
      reward: Math.max(0, num(p.challenge.reward)),
      done: !!p.challenge.done,
    }
    : null;
  const last = p.last && typeof p.last === "object"
    ? {
      tick: num(p.last.tick) | 0,
      kind: (["event", "rank", "ach", "challenge"].includes(p.last.kind as string) ? p.last.kind : "event") as "event",
      title: str(p.last.title, 60),
      text: str(p.last.text),
      pay: num(p.last.pay),
    }
    : null;
  return {
    v: 1,
    seeded: !!p.seeded,
    ...(p.off ? { off: true } : {}),
    rank: Math.max(0, Math.min(RANK_COUNT - 1, num(p.rank) | 0)),
    ach: num(p.ach) >>> 0,
    event,
    nextEvent: num(p.nextEvent) | 0,
    effects: Array.isArray(p.effects)
      ? p.effects.slice(0, 12).map((entry) => ({
        id: str(entry?.id, 24),
        until: num(entry?.until) | 0,
        mood: Math.max(-0.3, Math.min(0.3, num(entry?.mood))),
        mult: Math.max(0.5, Math.min(1.5, num(entry?.mult, 1))),
        flat: Math.max(0, Math.min(1000, num(entry?.flat))),
      }))
      : [],
    last,
    stats: {
      trade: Math.max(0, num(stats.trade)),
      festivals: Math.max(0, num(stats.festivals) | 0),
      storms: Math.max(0, num(stats.storms) | 0),
      events: Math.max(0, num(stats.events) | 0),
      challenges: Math.max(0, num(stats.challenges) | 0),
      mood: Math.max(0, Math.min(100, num(stats.mood))),
      happy: Math.max(0, num(stats.happy) | 0),
    },
    challenge,
  };
}


export function ensureProgress(city: CityState): CityProgress {
  if (!city.progress) city.progress = freshProgress(city.tick);
  return city.progress;
}
