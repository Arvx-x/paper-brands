import type { BrandConcept } from "../brand/types.ts";
import type { SmokeConcept, SmokeExperiment } from "./types.ts";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface TournamentLike {
  categoryId: string;
  concepts: BrandConcept[];
  report: { concepts: Array<{ conceptId: string; winRate: number }>; winner?: { conceptId?: string } | null };
}

export function buildExperiment(tournament: TournamentLike, currency = "INR"): SmokeExperiment {
  const winRateById = new Map<string, number>();
  for (const r of tournament.report?.concepts ?? []) {
    if (typeof r?.conceptId === "string" && typeof r?.winRate === "number") {
      winRateById.set(r.conceptId, r.winRate);
    }
  }

  const usedSlugs = new Set<string>();
  const concepts: SmokeConcept[] = [];
  for (const c of tournament.concepts ?? []) {
    const score = winRateById.get(c.id);
    if (typeof score !== "number") continue;
    let slug = slugify(c.id) || slugify(c.name) || "concept";
    let n = 2;
    const base = slug;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    concepts.push({ conceptId: c.id, name: c.name, syntheticScore: score, slug, pagePath: `pages/${slug}.html` });
  }

  if (concepts.length === 0) {
    throw new Error("smoketest: no generated concept has a win-rate in tournament.report.concepts");
  }

  return {
    category: tournament.categoryId,
    currency,
    builtAt: new Date().toISOString(),
    realMetric: "notify CTR",
    source: "smoke-test",
    unit: "concept",
    tournamentRef: tournament.report?.winner?.conceptId ?? undefined,
    concepts,
  };
}
