import { mkdir } from "node:fs/promises";
import { resolvePack } from "../categories/registry.ts";
import { Council } from "../council/council.ts";
import { buildCohort } from "../personas/cohort.ts";
import { DeepNegotiationArena } from "../arena/deep.ts";
import { SingleShotArena } from "../arena/singleShot.ts";
import { score, type ArenaReport } from "../scoring/score.ts";
import { mean, stddev } from "../arena/stats.ts";
import type { BrandConcept } from "../brand/types.ts";

export interface TournamentOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;
  outDir?: string;
  deep?: boolean;   // use the deep negotiation arena
  seed?: number;
  runs?: number;    // replications across seeds for cross-run variance (default 1)
}

export interface RunStats {
  runs: number;
  winRates: number[];
  meanWinRate: number;
  stdWinRate: number;
}

export interface TournamentOutput {
  categoryId: string;
  concepts: BrandConcept[];
  report: ArenaReport;
  runStats?: RunStats;
}

/**
 * Aggregate per-run winner win-rates into a cross-run summary: tournament-level
 * mean ± 1σ (sample std), the variance the per-run Wilson CI cannot capture.
 */
export function aggregateRunStats(winRates: number[]): RunStats {
  return {
    runs: winRates.length,
    winRates,
    meanWinRate: mean(winRates),
    stdWinRate: stddev(winRates),
  };
}

export async function runTournament(opts: TournamentOptions): Promise<TournamentOutput> {
  const pack = await resolvePack(opts.categoryId);

  console.error(`[1/4] Council generating ${opts.candidates} candidate brands...`);
  const council = new Council(pack);
  const concepts = await council.generateCandidates(opts.candidates);
  if (concepts.length === 0) throw new Error("Council produced no valid concepts.");
  console.error(`      -> ${concepts.map((c) => c.name).join(", ")}`);

  console.error(`[2/4] Building representative cohort of ${opts.cohortSize}...`);
  const cohort = await buildCohort(pack, opts.cohortSize);
  console.error(`      -> ${cohort.length} buyer agents`);

  const arena = opts.deep ? new DeepNegotiationArena(pack) : new SingleShotArena(pack);

  // One arena+score pass for a given seed. Council/cohort are reused across runs;
  // only the seed varies (persona traits are seeded per-run), so replications are cheap.
  const runOnce = async (seed: number): Promise<ArenaReport> => {
    const results = await arena.run({
      candidates: concepts,
      cohort,
      pack,
      opts: { includeCompetitors: true, seed },
    });
    return score(results, concepts, pack.benchmarkBrands ?? []);
  };

  const baseSeed = opts.seed ?? 0;
  const runs = opts.runs && opts.runs > 1 ? opts.runs : 1;

  console.error(
    `[3/4] Running blind arena (candidates vs disguised competitors)` +
      (runs > 1 ? ` x${runs} replications` : "") + `...`,
  );

  // Run 1 is always the headline report (back-compat for single-run consumers).
  const report = await runOnce(baseSeed);
  const winRateOf = (r: ArenaReport) => r.winner?.winRate ?? r.candidateShareVsField;

  let runStats: RunStats | undefined;
  if (runs > 1) {
    const winRates = [winRateOf(report)];
    for (let i = 1; i < runs; i++) {
      console.error(`      -> replication ${i + 1}/${runs} (seed ${baseSeed + i})`);
      const r = await runOnce(baseSeed + i);
      winRates.push(winRateOf(r));
    }
    runStats = aggregateRunStats(winRates);
  }

  console.error(`[4/4] Scoring...`);

  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats };

  if (opts.outDir) {
    await mkdir(opts.outDir, { recursive: true });
    await Bun.write(`${opts.outDir}/tournament.json`, JSON.stringify(out, null, 2));
    console.error(`      -> wrote ${opts.outDir}/tournament.json`);
  }
  return out;
}

import { optimize, type OptimizeResult } from "../optimizer/optimize.ts";

export interface OptimizeRunOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;
  rounds: number;
  outDir?: string;
}

/** Full run: tournament -> take best candidate -> hill-climb its win-rate. */
export async function runOptimize(opts: OptimizeRunOptions): Promise<OptimizeResult> {
  const pack = await resolvePack(opts.categoryId);

  console.error(`[seed] tournament to pick a champion...`);
  const t = await runTournament({
    categoryId: opts.categoryId,
    candidates: opts.candidates,
    cohortSize: opts.cohortSize,
  });
  const winnerId = t.report.winner?.conceptId;
  const champion = t.concepts.find((c) => c.id === winnerId) ?? t.concepts[0]!;
  console.error(`[seed] champion = ${champion.name}`);

  const { buildCohort } = await import("../personas/cohort.ts");
  console.error(`[opt] building fixed evaluation cohort (${opts.cohortSize})...`);
  const cohort = await buildCohort(pack, opts.cohortSize);

  console.error(`[opt] hill-climbing over ${opts.rounds} rounds...`);
  return optimize({ pack, champion, cohort, rounds: opts.rounds, outDir: opts.outDir });
}

export function formatReport(out: TournamentOutput): string {
  const { report } = out;
  const lines: string[] = [];
  lines.push(`\nCategory: ${out.categoryId}  |  trials: ${report.totalTrials}`);
  lines.push(`Candidate share vs field: ${(report.candidateShareVsField * 100).toFixed(1)}%`);
  lines.push(
    `Abstention: ${(report.abstentionRate * 100).toFixed(1)}%  |  Errors: ${(report.errorRate * 100).toFixed(1)}%` +
      (report.degraded ? "  [DEGRADED]" : ""),
  );
  lines.push(`\nLeaderboard (win-rate):`);
  for (const c of report.concepts) {
    const tag = c.conceptId.startsWith("competitor:") ? "  [competitor]" : "";
    lines.push(
      `  ${(c.winRate * 100).toFixed(1).padStart(5)}%  ` +
        `[${(c.winRateCiLow * 100).toFixed(0)}-${(c.winRateCiHigh * 100).toFixed(0)}%]  ${c.name}${tag}` +
        (c.avgWtpMinor ? `  (avg WTP ${(c.avgWtpMinor / 100).toFixed(0)})` : ""),
    );
  }
  if (report.calibrationPairs && report.calibrationPairs.length) {
    lines.push(`\nBenchmark anchors (audit-only — real brands, disguised in arena):`);
    lines.push(`   real win-rate  traction   brand`);
    for (const p of [...report.calibrationPairs].sort((a, b) => b.tractionScore - a.tractionScore)) {
      lines.push(
        `   ${(p.arenaWinRate * 100).toFixed(1).padStart(8)}%   ${p.tractionScore.toFixed(2).padStart(6)}   ${p.realName}`,
      );
    }
  }
  if (report.correlationCheck) {
    const c = report.correlationCheck;
    lines.push(`\nCalibration smoke-check: Spearman rho = ${c.spearmanRho.toFixed(2)} (n=${c.n}, ${c.verdict})`);
    lines.push(`   ${c.note}`);
  }
  if (report.winner) {
    lines.push(`\nBest candidate: ${report.winner.name} @ ${(report.winner.winRate * 100).toFixed(1)}%`);
    if (report.winner.topObjections.length)
      lines.push(`Top objections: ${report.winner.topObjections.join(" | ")}`);
  }
  if (out.runStats) {
    const s = out.runStats;
    const perRun = s.winRates.map((w) => `${(w * 100).toFixed(1)}%`).join(", ");
    lines.push(
      `Replications: ${s.runs} | mean win-rate ${(s.meanWinRate * 100).toFixed(1)}% ± ` +
        `${(s.stdWinRate * 100).toFixed(1)}% (1σ) | per-run: [${perRun}]`,
    );
  }
  return lines.join("\n");
}
