import type { EvidencedItem, GroundedGrievance } from "../categories/types.ts";
import { makeRng } from "../arena/stats.ts";

export interface SegmentSeed { seed: string }

/**
 * Tag already-verified EvidencedItems (rejectionReasons/unmetNeeds) to the buyer
 * segment each best fits. Drops unverified items — we never ground personas on
 * unverifiable complaints. `assign` maps an item's text to a segment seed
 * (LLM-backed in production; injected for tests).
 */
export function tagGrievancesToSegments(
  items: EvidencedItem[],
  segments: SegmentSeed[],
  assign: (text: string) => string,
): GroundedGrievance[] {
  const valid = new Set(segments.map((s) => s.seed));
  const out: GroundedGrievance[] = [];
  for (const it of items) {
    if (!it.verified) continue;
    const seg = assign(it.text);
    if (!valid.has(seg)) continue;
    out.push({
      segment: seg,
      anxiety: it.text,
      verbatimQuote: it.quote || it.text,
      sourceUrl: it.sourceUrl,
      sourceClass: it.independent ? "independent" : "other",
      verified: true,
    });
  }
  return out;
}

/** Seeded shuffle (Fisher-Yates). */
function shuffleSeeded<T>(arr: T[], seed: string): T[] {
  const rng = makeRng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Sample n grievances WITHOUT replacement (maximize distinctness across personas in a
 * segment). If pool < n, cycle through the shuffled pool so we always return n.
 * Seeded => reproducible.
 */
export function sampleGrievances(pool: GroundedGrievance[], n: number, seed: string): GroundedGrievance[] {
  if (pool.length === 0) return [];
  const shuffled = shuffleSeeded(pool, seed);
  const out: GroundedGrievance[] = [];
  for (let i = 0; i < n; i++) out.push(shuffled[i % shuffled.length]!);
  return out;
}

/** distinct anxieties / total personas (0 for empty). The variance-collapse metric. */
export function cohortDiversity(anxieties: string[]): number {
  if (anxieties.length === 0) return 0;
  return new Set(anxieties).size / anxieties.length;
}
