import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";
import { makeRng } from "./stats.ts";

export interface EngineTraits {
  basePMax: number;        // minor units; CATEGORY-anchored, not option-anchored
  skepticism: number;      // 0..1
  impulsivity: number;     // 0..1
  priceConsciousness: number; // 0..1
  reluctancePrior: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Median price band midpoint = the category price level the base budget anchors to. */
function categoryAnchorMinor(pack: CategoryPack): number {
  const bands = pack.priceBands ?? [];
  if (!bands.length) return 50000;
  const sorted = [...bands].sort((a, b) => (a.lowMinor + a.highMinor) - (b.lowMinor + b.highMinor));
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  return Math.round((mid.lowMinor + mid.highMinor) / 2);
}

export function deriveTraits(persona: Persona, pack: CategoryPack, seed: string): EngineTraits {
  const rng = makeRng(`${seed}::${persona.id}`);
  const jitter = (center: number, spread = 0.15) => clamp01(center + (rng() - 0.5) * 2 * spread);

  const bs = persona.budgetSensitivity; // "low" | "medium" | "high"
  const priceBase = bs === "high" ? 0.8 : bs === "low" ? 0.25 : 0.5;

  // Decision style nudges skepticism/impulsivity by simple keyword cues.
  const style = (persona.decisionStyle ?? "").toLowerCase();
  const skepBase = /caut|research|skeptic|careful|analy/.test(style) ? 0.7 : 0.45;
  const impBase = /impulse|quick|spontaneous|whim|emotional/.test(style) ? 0.7 : 0.35;

  // Budget: anchor to category, then reduce by price sensitivity (frugal => lower WTP).
  const anchor = categoryAnchorMinor(pack);
  const budgetMultiplier = bs === "high" ? 0.7 : bs === "low" ? 1.2 : 0.95;
  const basePMax = Math.round(anchor * budgetMultiplier);

  return {
    basePMax,
    skepticism: jitter(skepBase),
    impulsivity: jitter(impBase),
    priceConsciousness: jitter(priceBase),
    reluctancePrior: (persona.anxieties ?? []).join("; ") || "general skepticism about new brands",
  };
}
