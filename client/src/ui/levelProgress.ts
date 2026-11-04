import { LEVEL_COUNT } from "../../../shared/src/index.ts";

const KEY = "cityline-levels";

export function loadUnlockedLevel(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 1;
    const parsed = JSON.parse(raw) as { unlocked?: unknown };
    const unlocked = Number(parsed.unlocked);
    if (!Number.isInteger(unlocked)) return 1;
    return Math.min(LEVEL_COUNT + 1, Math.max(1, unlocked));
  } catch {
    return 1;
  }
}

export function unlockAfterWin(id: number): number {
  const next = Math.max(loadUnlockedLevel(), id + 1);
  localStorage.setItem(KEY, JSON.stringify({ unlocked: next }));
  return next;
}

export function isLevelOpen(id: number, unlocked: number): boolean {
  return id >= 1 && id <= LEVEL_COUNT && id <= Math.min(unlocked, LEVEL_COUNT);
}
