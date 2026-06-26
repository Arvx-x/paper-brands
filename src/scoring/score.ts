import type { MatchResult } from "../arena/arena.ts";
import type { BrandConcept } from "../brand/types.ts";

export interface ConceptScore {
  conceptId: string;
  name: string;
  picks: number;
  trials: number;
  winRate: number; // 0..1 share of total picks
  avgWtpMinor: number;
  topObjections: string[];
}

export interface ArenaReport {
  totalTrials: number;
  concepts: ConceptScore[];
  /** Win-rate of candidates vs disguised competitors only. */
  candidateShareVsField: number;
  winner: ConceptScore | null;
}

/**
 * Relative scoring. Win-rate is a HYPOTHESIS FILTER, not proof of demand:
 * treat it as directional until calibrated against real smoke-test CTR/signup.
 */
export function score(results: MatchResult[], candidates: BrandConcept[]): ArenaReport {
  const totalTrials = results.length;
  const byConcept = new Map<string, MatchResult[]>();
  for (const r of results) {
    const arr = byConcept.get(r.pickedConceptId) ?? [];
    arr.push(r);
    byConcept.set(r.pickedConceptId, arr);
  }

  const nameFor = (id: string): string => {
    if (id.startsWith("competitor:")) return id.replace("competitor:", "");
    return candidates.find((c) => c.id === id)?.name ?? id;
  };

  const concepts: ConceptScore[] = [];
  const allIds = new Set<string>([
    ...candidates.map((c) => c.id),
    ...results.map((r) => r.pickedConceptId),
  ]);

  for (const id of allIds) {
    const picks = byConcept.get(id) ?? [];
    const wtp = picks.map((p) => p.willingnessToPayMinor).filter((n) => n > 0);
    concepts.push({
      conceptId: id,
      name: nameFor(id),
      picks: picks.length,
      trials: totalTrials,
      winRate: totalTrials ? picks.length / totalTrials : 0,
      avgWtpMinor: wtp.length ? Math.round(wtp.reduce((a, b) => a + b, 0) / wtp.length) : 0,
      topObjections: topN(picks.map((p) => p.topObjection), 3),
    });
  }

  concepts.sort((a, b) => b.winRate - a.winRate);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidatePicks = results.filter((r) => candidateIds.has(r.pickedConceptId)).length;

  const candidateConcepts = concepts.filter((c) => candidateIds.has(c.conceptId));
  const winner = candidateConcepts[0] ?? null;

  return {
    totalTrials,
    concepts,
    candidateShareVsField: totalTrials ? candidatePicks / totalTrials : 0,
    winner,
  };
}

function topN(items: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (!it) continue;
    counts.set(it, (counts.get(it) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}
