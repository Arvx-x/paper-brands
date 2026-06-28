import type { BrandConcept } from "../brand/types.ts";
import type { MoatScore } from "../moat/types.ts";
import type { TournamentOutput } from "./tournament.ts";
import { runTournament } from "./tournament.ts";

export interface Finalist {
  rank: number;
  concept: BrandConcept;
  winRate: number;
  winRateCiLow: number;
  winRateCiHigh: number;
  avgWtpMinor: number;
  moat?: MoatScore;
}

export interface FinalistsArtifact {
  categoryId: string;
  builtAt: string;
  spawned: number;           // total generated concepts considered (t.concepts.length)
  selected: number;
  rankedBy: "winRate";
  finalists: Finalist[];
  warnings: string[];
  moatDegraded?: boolean;    // true if the moat scoring pass was degraded
}

export interface FoundryOptions {
  categoryId: string;
  candidates?: number;
  finalists?: number;
  cohortSize?: number;
  seed?: number;
  outDir?: string;
}

export interface FoundryDeps {
  runTournament?: typeof runTournament;
}

function isCandidate(conceptId: string): boolean {
  return !conceptId.startsWith("benchmark:") && !conceptId.startsWith("competitor:");
}

/** Pure: rank generated concepts by win-rate, take top n, join moat. */
export function selectFinalists(t: TournamentOutput, n: number): FinalistsArtifact {
  const warnings: string[] = [];
  const conceptById = new Map(t.concepts.map((c) => [c.id, c]));
  const moatById = new Map((t.moat?.concepts ?? []).map((m) => [m.conceptId, m]));

  const ranked = (t.report.concepts ?? [])
    .filter((c) => isCandidate(c.conceptId))
    .slice()
    .sort((a, b) => b.winRate - a.winRate || a.conceptId.localeCompare(b.conceptId));

  const spawned = t.concepts.length; // generated concepts, not the filtered rank list
  const finalists: Finalist[] = [];
  for (const score of ranked) {
    if (finalists.length >= n) break;
    const concept = conceptById.get(score.conceptId);
    if (!concept) {
      warnings.push(`report concept '${score.conceptId}' has no matching BrandConcept (skipped)`);
      continue;
    }
    const moat = moatById.get(score.conceptId);
    if (!moat) warnings.push(`moat unavailable for '${score.name}' (${score.conceptId})`);
    finalists.push({
      rank: finalists.length + 1,
      concept,
      winRate: score.winRate,
      winRateCiLow: score.winRateCiLow,
      winRateCiHigh: score.winRateCiHigh,
      avgWtpMinor: score.avgWtpMinor,
      moat,
    });
  }

  if (finalists.length < n) {
    warnings.push(`only ${finalists.length} concept(s) available; requested ${n}`);
  }

  return {
    categoryId: t.categoryId,
    builtAt: new Date().toISOString(),
    spawned,
    selected: finalists.length,
    rankedBy: "winRate",
    finalists,
    warnings,
    moatDegraded: t.moat?.degraded,
  };
}

/** Spawn N brands, run deep arena + moat, select top finalists, write finalists.json. */
export async function runFoundry(opts: FoundryOptions, deps: FoundryDeps = {}): Promise<FinalistsArtifact> {
  const run = deps.runTournament ?? runTournament;
  const outDir = opts.outDir ?? "out";
  const t = await run({
    categoryId: opts.categoryId,
    candidates: opts.candidates ?? 8,
    cohortSize: opts.cohortSize ?? 80,
    mode: "deep",
    moat: true,
    seed: opts.seed,
    outDir,
  });
  const artifact = selectFinalists(t, opts.finalists ?? 3);
  await Bun.write(`${outDir}/finalists.json`, JSON.stringify(artifact, null, 2));
  return artifact;
}
