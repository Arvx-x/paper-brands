import { makeRng } from "../arena/stats.ts";

export interface WedgeFingerprint {
  wedge: string;
  segment: string;
  tier: string;
}

export interface WedgeTag {
  territoryIndex: number;
  territoryName: string;
  fingerprint: WedgeFingerprint;
}

export interface DiversitySelection {
  selectedIndices: number[];
  distinctWedgeCount: number;
  spannedWedges: string[];
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

export interface DiversityReport {
  requested: number;
  distinctWedgeCount: number;
  spannedWedges: string[];
  poolSize: number;
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

const fpKey = (f: WedgeFingerprint) => `${f.wedge}|${f.segment}|${f.tier}`;

/** Pure, deterministic greedy max-diversity selection over (wedge, segment, tier). */
export function selectDiverse(tags: WedgeTag[], n: number, seed: number): DiversitySelection {
  // 1. Deterministic order: shuffle by seed, then the greedy loop breaks ties by this order.
  const rng = makeRng(String(seed));
  const ordered = tags
    .map((t) => ({ t, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  const chosen: WedgeTag[] = [];
  const usedFp = new Set<string>();
  const usedWedge = new Set<string>();
  const usedSegment = new Set<string>();
  const usedTier = new Set<string>();
  const remaining = [...ordered];

  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i]!.fingerprint;
      let score = 0;
      if (!usedFp.has(fpKey(f))) score += 1000;
      if (!usedWedge.has(f.wedge)) score += 100;
      if (!usedSegment.has(f.segment)) score += 10;
      if (!usedTier.has(f.tier)) score += 1;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    const pick = remaining.splice(bestIdx, 1)[0]!;
    chosen.push(pick);
    usedFp.add(fpKey(pick.fingerprint));
    usedWedge.add(pick.fingerprint.wedge);
    usedSegment.add(pick.fingerprint.segment);
    usedTier.add(pick.fingerprint.tier);
  }

  const distinctWedgeCount = new Set(chosen.map((c) => fpKey(c.fingerprint))).size;
  const spannedWedges = [...new Set(chosen.map((c) => c.fingerprint.wedge))].sort();
  return {
    selectedIndices: chosen.map((c) => c.territoryIndex),
    distinctWedgeCount,
    spannedWedges,
    rerolled: false,
  };
}
