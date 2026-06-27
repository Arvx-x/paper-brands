import { mkdir } from "node:fs/promises";
import { resolvePack } from "../categories/registry.ts";
import { Council } from "../council/council.ts";
import { buildCohort } from "../personas/cohort.ts";
import { DeepNegotiationArena } from "../arena/deep.ts";
import { SingleShotArena } from "../arena/singleShot.ts";
import { score, type ArenaReport } from "../scoring/score.ts";
import { mean, stddev } from "../arena/stats.ts";
import type { BrandConcept } from "../brand/types.ts";
import { calibrate } from "../calibration/calibrate.ts";
import type { CalibrationResult } from "../calibration/types.ts";
import type { DiversityReport } from "../council/diversity.ts";
import type { BuyerArena } from "../arena/types.ts";
import type { CategoryPack } from "../categories/types.ts";

export type ArenaMode = "cheap" | "deep";

export interface ArenaModeInfo {
  mode: ArenaMode;
  kind: "single-shot" | "deep-negotiation";
  costClass: "cheap" | "expensive";
}

export interface TournamentOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;
  outDir?: string;
  deep?: boolean;   // use the deep negotiation arena
  mode?: ArenaMode;
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
  groundingCoverage?: number;
  cohortDiversity?: number;
  calibration?: CalibrationResult;
  conceptDiversity?: DiversityReport;
  arenaMode?: ArenaModeInfo;
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

/** Resolve the arena from the requested mode. Default "deep"; `deep:true` is a legacy alias. */
export function resolveArena(
  pack: CategoryPack,
  opts: Pick<TournamentOptions, "mode" | "deep">,
): { arena: BuyerArena; arenaMode: ArenaModeInfo } {
  const mode: ArenaMode = opts.mode ?? "deep";
  const arena: BuyerArena = mode === "cheap" ? new SingleShotArena(pack) : new DeepNegotiationArena(pack);
  return { arena, arenaMode: { mode, kind: arena.kind, costClass: arena.costClass } };
}

export async function runTournament(opts: TournamentOptions): Promise<TournamentOutput> {
  const pack = await resolvePack(opts.categoryId);

  console.error(`[1/4] Council generating ${opts.candidates} candidate brands...`);
  const council = new Council(pack);
  const { concepts, diversity: conceptDiversity } = await council.generateCandidates(opts.candidates, opts.seed);
  if (concepts.length === 0) throw new Error("Council produced no valid concepts.");
  console.error(`      -> ${concepts.map((c) => c.name).join(", ")}`);

  console.error(`[2/4] Building representative cohort of ${opts.cohortSize}...`);
  const { personas: cohort, groundingCoverage, cohortDiversity } = await buildCohort(pack, opts.cohortSize);
  console.error(`      -> ${cohort.length} buyer agents`);

  const { arena, arenaMode } = resolveArena(pack, opts);

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

  const winRateForCal = report.winner?.winRate ?? report.candidateShareVsField ?? 0;
  const calibration = await calibrate(opts.categoryId, winRateForCal);

  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration, conceptDiversity, arenaMode };

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
  const { personas: cohort } = await buildCohort(pack, opts.cohortSize);

  console.error(`[opt] hill-climbing over ${opts.rounds} rounds...`);
  return optimize({ pack, champion, cohort, rounds: opts.rounds, outDir: opts.outDir });
}

export function formatReport(out: TournamentOutput): string {
  const { report } = out;
  const lines: string[] = [];
  lines.push(`\nCategory: ${out.categoryId}  |  trials: ${report.totalTrials}`);
  if (out.arenaMode) {
    lines.push(`Arena mode: ${out.arenaMode.mode} (${out.arenaMode.kind}, ${out.arenaMode.costClass})`);
  }
  lines.push(`Candidate share vs field: ${(report.candidateShareVsField * 100).toFixed(1)}%`);
  lines.push(
    `Abstention: ${(report.abstentionRate * 100).toFixed(1)}%  |  Errors: ${(report.errorRate * 100).toFixed(1)}%` +
      (report.degraded ? "  [DEGRADED]" : ""),
  );
  if (out.groundingCoverage !== undefined) {
    lines.push(
      `Persona grounding: ${(out.groundingCoverage * 100).toFixed(0)}% on real grievances` +
        ` | diversity ${(out.cohortDiversity ?? 0).toFixed(2)}`,
    );
  }
  lines.push(`\nLeaderboard (win-rate):`);
  for (const c of report.concepts ?? []) {
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
  const cal = out.calibration;
  if (cal) {
    if (cal.status === "uncalibrated") {
      lines.push(
        `\u26a0 UNCALIBRATED \u2014 win-rate is a relative hypothesis, not a demand forecast (${cal.n} real observations).`,
      );
    } else {
      const label = cal.status === "weak" ? "WEAK" : "CALIBRATED";
      const metric = cal.realMetric ? ` real (${cal.realMetric})` : "";
      lines.push(
        `${label} estimate: ${(cal.calibrated * 100).toFixed(1)}%${metric} ` +
          `\u00b1 ${(((cal.hi - cal.lo) / 2) * 100).toFixed(1)}%  [n=${cal.n}, ${cal.method}, R\u00b2=${(cal.r2 ?? 0).toFixed(2)}` +
          `${cal.status === "weak" ? " \u2014 directional only" : ""}]`,
      );
      lines.push(`  \u251c blind concept appeal: +${(cal.appealContribution * 100).toFixed(1)}%`);
      lines.push(
        cal.equityStatus === "learned"
          ? `  \u2514 brand equity:         +${(cal.equityContribution * 100).toFixed(1)}%  (learned, n=${cal.n})`
          : `  \u2514 brand equity:         +0.0%  (no equity data yet)`,
      );
    }
  }
  const div = out.conceptDiversity;
  if (div) {
    if (div.warning === "lowConceptDiversity") {
      lines.push(
        `\u26a0 LOW CONCEPT DIVERSITY \u2014 slate spans only ${div.distinctWedgeCount} distinct positioning ` +
          `fingerprint${div.distinctWedgeCount === 1 ? "" : "s"} [wedges: ${div.spannedWedges.join(", ")}]` +
          `${div.rerolled ? " (re-rolled once)" : ""}. Win-rates compare near-duplicates.`,
      );
    } else {
      const noun = div.distinctWedgeCount === 1 ? "fingerprint" : "fingerprints";
      lines.push(
        `Concept diversity: ${div.distinctWedgeCount} of ${div.requested} distinct positioning ${noun} ` +
          `[wedges: ${div.spannedWedges.join(", ")}]${div.rerolled ? " (re-rolled once)" : ""}`,
      );
    }
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
