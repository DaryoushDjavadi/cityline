/** Narrow or short viewports get the collapsible HUD. Wide desktops stay unchanged. */
export const COMPACT_HUD = "(max-width: 1100px), (max-height: 520px)";

export function isCompactHud(): boolean {
  return window.matchMedia(COMPACT_HUD).matches;
}

export function onCompactHudChange(fn: (compact: boolean) => void): () => void {
  const mq = window.matchMedia(COMPACT_HUD);
  const handler = () => fn(mq.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
