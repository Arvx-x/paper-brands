import type { MatchResult } from "../arena/types.ts";
import { wilsonInterval } from "../arena/stats.ts";
import type { BrandConcept } from "../brand/types.ts";

export interface ConceptScore {
  conceptId: string;
  name: string;
  picks: number;
  trials: number;          // deciding trials (denominator)
  winRate: number;
  winRateCiLow: number;
  winRateCiHigh: number;
  avgWtpMinor: number;
  topObjections: string[];
}

export interface ArenaReport {
  totalTrials: number;       // all personas queried
  decidingTrials: number;    // personas who made a pick (denominator for win-rate)
  abstentionRate: number;
  errorRate: number;
  degraded: boolean;
  concepts: ConceptScore[];
  candidateShareVsField: number;
  winner: ConceptScore | null;
}

/**
 * Relative scoring. Win-rate is a HYPOTHESIS FILTER, not proof of demand:
 * treat it as directional until calibrated against real smoke-test CTR/signup.
 */
export function score(results: MatchResult[], candidates: BrandConcept[]): ArenaReport {
  const totalTrials = results.length;
  const abstained = results.filter((r) => r.abstained).length;
  const errored = results.filter((r) => r.errored).length;
  const deciding = results.filter((r) => !r.abstained && !r.errored && r.pickedConceptId);
  const decidingTrials = deciding.length;

  const byConcept = new Map<string, MatchResult[]>();
  for (const r of deciding) {
    const arr = byConcept.get(r.pickedConceptId) ?? [];
    arr.push(r);
    byConcept.set(r.pickedConceptId, arr);
  }

  const nameFor = (id: string): string =>
    id.startsWith("competitor:") ? id.replace("competitor:", "") : candidates.find((c) => c.id === id)?.name ?? id;

  const allIds = new Set<string>([...candidates.map((c) => c.id), ...deciding.map((r) => r.pickedConceptId)]);
  const concepts: ConceptScore[] = [];
  for (const id of allIds) {
    const picks = byConcept.get(id) ?? [];
    const wtp = picks.map((p) => p.willingnessToPayMinor).filter((n) => n > 0);
    const ci = wilsonInterval(picks.length, decidingTrials);
    concepts.push({
      conceptId: id, name: nameFor(id), picks: picks.length, trials: decidingTrials,
      winRate: decidingTrials ? picks.length / decidingTrials : 0,
      winRateCiLow: ci.low, winRateCiHigh: ci.high,
      avgWtpMinor: wtp.length ? Math.round(wtp.reduce((a, b) => a + b, 0) / wtp.length) : 0,
      topObjections: topN(picks.map((p) => p.topObjection), 3),
    });
  }
  concepts.sort((a, b) => b.winRate - a.winRate);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidatePicks = deciding.filter((r) => candidateIds.has(r.pickedConceptId)).length;
  const candidateConcepts = concepts.filter((c) => candidateIds.has(c.conceptId));

  const abstentionRate = totalTrials ? abstained / totalTrials : 0;
  const errorRate = totalTrials ? errored / totalTrials : 0;

  return {
    totalTrials, decidingTrials, abstentionRate, errorRate,
    degraded: abstentionRate > 0.5 || errorRate > 0.2,
    concepts,
    candidateShareVsField: decidingTrials ? candidatePicks / decidingTrials : 0,
    winner: candidateConcepts[0] ?? null,
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
