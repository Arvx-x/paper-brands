import { mkdir } from "node:fs/promises";
import { packs } from "../categories/lipcare.ts";
import { Council } from "../council/council.ts";
import { buildCohort } from "../personas/cohort.ts";
import { Arena } from "../arena/arena.ts";
import { score, type ArenaReport } from "../scoring/score.ts";
import type { BrandConcept } from "../brand/types.ts";

export interface TournamentOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;
  outDir?: string;
}

export interface TournamentOutput {
  categoryId: string;
  concepts: BrandConcept[];
  report: ArenaReport;
}

export async function runTournament(opts: TournamentOptions): Promise<TournamentOutput> {
  const pack = packs[opts.categoryId];
  if (!pack) throw new Error(`Unknown category '${opts.categoryId}'. Known: ${Object.keys(packs).join(", ")}`);

  console.error(`[1/4] Council generating ${opts.candidates} candidate brands...`);
  const council = new Council(pack);
  const concepts = await council.generateCandidates(opts.candidates);
  if (concepts.length === 0) throw new Error("Council produced no valid concepts.");
  console.error(`      -> ${concepts.map((c) => c.name).join(", ")}`);

  console.error(`[2/4] Building representative cohort of ${opts.cohortSize}...`);
  const cohort = await buildCohort(pack, opts.cohortSize);
  console.error(`      -> ${cohort.length} buyer agents`);

  console.error(`[3/4] Running blind arena (candidates vs disguised competitors)...`);
  const arena = new Arena(pack);
  const results = await arena.run(concepts, cohort, { includeCompetitors: true });

  console.error(`[4/4] Scoring...`);
  const report = score(results, concepts);

  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report };

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
  const pack = packs[opts.categoryId];
  if (!pack) throw new Error(`Unknown category '${opts.categoryId}'.`);

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
  lines.push(`\nLeaderboard (win-rate):`);
  for (const c of report.concepts) {
    const tag = c.conceptId.startsWith("competitor:") ? "  [competitor]" : "";
    lines.push(
      `  ${(c.winRate * 100).toFixed(1).padStart(5)}%  ${c.name}${tag}` +
        (c.avgWtpMinor ? `  (avg WTP ${(c.avgWtpMinor / 100).toFixed(0)})` : ""),
    );
  }
  if (report.winner) {
    lines.push(`\nBest candidate: ${report.winner.name} @ ${(report.winner.winRate * 100).toFixed(1)}%`);
    if (report.winner.topObjections.length)
      lines.push(`Top objections: ${report.winner.topObjections.join(" | ")}`);
  }
  return lines.join("\n");
}
