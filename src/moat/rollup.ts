import type { MoatAxis } from "./types.ts";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Equal-weight mean of axis scores, clamped to [0,1]. Empty -> 0. */
export function rollUp(axes: MoatAxis[]): number {
  if (axes.length === 0) return 0;
  const sum = axes.reduce((a, x) => a + x.score, 0);
  return clamp01(sum / axes.length);
}
