import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import type { CategoryPack } from "../categories/types.ts";
import { BrandConceptSchema, type BrandConcept } from "../brand/types.ts";
import { Arena } from "../arena/arena.ts";
import { score } from "../scoring/score.ts";
import type { Persona } from "../personas/cohort.ts";

export interface OptimizeOptions {
  pack: CategoryPack;
  /** The current best candidate to improve. */
  champion: BrandConcept;
  /** Fixed cohort so win-rate comparisons are apples-to-apples. */
  cohort: Persona[];
  rounds: number;
  /** Variants generated per round; best challenger faces the champion. */
  variantsPerRound?: number;
  outDir?: string;
}

export interface OptimizeStep {
  round: number;
  championWinRate: number;
  challengerWinRate: number;
  accepted: boolean;
  mutation: string;
}

export interface OptimizeResult {
  champion: BrandConcept;
  startWinRate: number;
  finalWinRate: number;
  history: OptimizeStep[];
}

/**
 * Autoresearch loop: mutate the champion (name/tagline/claim/price/offer/copy),
 * run a head-to-head blind arena against disguised competitors on a FIXED
 * cohort, and keep the mutation only if win-rate strictly improves. This is a
 * hill-climb on a synthetic metric — guard against overfitting by re-validating
 * on a fresh cohort / real smoke test before trusting the gain.
 */
export async function optimize(opts: OptimizeOptions): Promise<OptimizeResult> {
  const llm = new LLMClient();
  const arena = new Arena(opts.pack, llm);
  const variantsPerRound = opts.variantsPerRound ?? 3;

  const winRateOf = async (c: BrandConcept): Promise<number> => {
    const results = await arena.run({
      candidates: [c],
      cohort: opts.cohort,
      pack: opts.pack,
      opts: { includeCompetitors: true },
    });
    return score(results, [c]).winner?.winRate ?? 0;
  };

  let champion = opts.champion;
  let championWR = await winRateOf(champion);
  const startWinRate = championWR;
  const history: OptimizeStep[] = [];

  for (let round = 1; round <= opts.rounds; round++) {
    const variants = await proposeVariants(llm, opts.pack, champion, variantsPerRound);

    // Score challengers, pick the strongest.
    let best: { c: BrandConcept; wr: number; mutation: string } | null = null;
    for (const v of variants) {
      const wr = await winRateOf(v.concept).catch(() => 0);
      if (!best || wr > best.wr) best = { c: v.concept, wr, mutation: v.mutation };
    }

    const accepted = !!best && best.wr > championWR;
    history.push({
      round,
      championWinRate: championWR,
      challengerWinRate: best?.wr ?? 0,
      accepted,
      mutation: best?.mutation ?? "(none)",
    });
    console.error(
      `  round ${round}: champ ${(championWR * 100).toFixed(1)}% vs ` +
        `challenger ${((best?.wr ?? 0) * 100).toFixed(1)}% -> ` +
        `${accepted ? "ACCEPT" : "keep"} | ${best?.mutation ?? ""}`,
    );

    if (accepted && best) {
      champion = best.c;
      championWR = best.wr;
    }
  }

  const result: OptimizeResult = {
    champion,
    startWinRate,
    finalWinRate: championWR,
    history,
  };
  if (opts.outDir) {
    await mkdir(opts.outDir, { recursive: true });
    await Bun.write(`${opts.outDir}/optimize.json`, JSON.stringify(result, null, 2));
  }
  return result;
}

interface Variant {
  concept: BrandConcept;
  mutation: string;
}

async function proposeVariants(
  llm: LLMClient,
  pack: CategoryPack,
  champion: BrandConcept,
  n: number,
): Promise<Variant[]> {
  const out: Variant[] = [];
  const levers = [
    "tagline + landing headline",
    "hero claim framing (stay compliant: cosmetic claims only)",
    "price point and price band",
    "positioning sharpness and target customer",
    "packaging direction and brand voice",
    "offer / hero SKU bundling",
  ];

  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const lever = levers[i % levers.length]!;
      try {
        const raw = await llm.completeJson<Record<string, unknown>>({
          messages: [
            {
              role: "system",
              content:
                "You optimize brand concepts. Change ONLY the specified lever; " +
                "keep everything else stable. Stay compliant (cosmetic claims only). " +
                "Return a full brand concept JSON.",
            },
            {
              role: "user",
              content:
                `Compliance: ${pack.complianceNotes.join("; ")}\n` +
                `Current concept JSON:\n${JSON.stringify(champion)}\n\n` +
                `Mutate the lever: ${lever}. Keep id="${champion.id}". ` +
                `Return the COMPLETE concept JSON with the same keys.`,
            },
          ],
          temperature: 0.9,
        });
        const concept = BrandConceptSchema.parse({ ...raw, id: champion.id });
        out.push({ concept, mutation: lever });
      } catch {
        /* skip failed variant */
      }
    }),
  );
  return out;
}
