import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import type { CategoryPack, GroundedGrievance } from "../categories/types.ts";
import { sampleGrievances, cohortDiversity } from "./grievances.ts";

export const PersonaSchema = z.object({
  id: z.coerce.string(),
  segment: z.string(),
  name: z.string(),
  age: z.coerce.number(),
  context: z.string().describe("life context driving the purchase"),
  // Case/whitespace-tolerant: models (esp. Gemini) often return "Medium".
  budgetSensitivity: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.enum(["low", "medium", "high"]),
    )
    .catch("medium"),
  primaryNeed: z.string(),
  anxieties: z.array(z.string()),
  decisionStyle: z.string(),
  shoppingContext: z.string().describe("e.g. browsing Amazon, saw a Reel"),
});
export type Persona = z.infer<typeof PersonaSchema>;

const BatchSchema = z.object({ personas: z.array(PersonaSchema) });

export interface CohortResult {
  personas: Persona[];
  groundingCoverage: number;  // fraction of personas conditioned on a real grievance
  cohortDiversity: number;    // distinct anxieties / total personas (variance-collapse metric)
}

export interface BuildCohortOpts {
  groundingMode?: "synthesized" | "verbatim";
  seed?: string;
}

/**
 * Build a representative cohort proportional to segment weights.
 * When pack.groundedGrievances contains verified items, each persona's anxieties
 * are conditioned on a sampled real shopper complaint (synthesized mode, default).
 * Falls back to pure invention when no verified grievances exist for a segment.
 *
 * groundingMode "verbatim" (mode D) is a deferred extension seam — not yet implemented.
 */
export async function buildCohort(
  pack: CategoryPack,
  size: number,
  llm = new LLMClient(),
  opts: BuildCohortOpts = {},
): Promise<CohortResult> {
  const mode = opts.groundingMode ?? "synthesized";
  if (mode === "verbatim") {
    throw new Error("groundingMode 'verbatim' not yet implemented (mode D is a deferred seam — see persona-grounding spec)");
  }

  const seed = opts.seed ?? "cohort";
  const grievances: GroundedGrievance[] = (pack.groundedGrievances ?? []).filter((g) => g.verified);

  // Build a per-segment pool of verified grievances.
  const bySegment = new Map<string, GroundedGrievance[]>();
  for (const g of grievances) {
    const arr = bySegment.get(g.segment) ?? [];
    arr.push(g);
    bySegment.set(g.segment, arr);
  }

  const perSegment = pack.buyerSegments.map((s) => ({
    seed: s.seed,
    n: Math.max(1, Math.round(s.weight * size)),
  }));

  let grounded = 0;

  const batches = await Promise.all(
    perSegment.map(async ({ seed: segSeed, n }) => {
      const pool = bySegment.get(segSeed) ?? [];
      const sampled = pool.length ? sampleGrievances(pool, n, `${seed}::${segSeed}`) : [];

      // Build the grounding note injected into the prompt.
      const grievanceLines = sampled
        .map((g, i) => `  Persona ${i + 1}: <concern>${g.anxiety}</concern>`)
        .join("\n");
      const groundingNote = pool.length
        ? `Ground each persona in a REAL shopper concern listed below. ` +
          `Treat it as ONE worry among a full life — do not make the persona defined only by it. ` +
          `Vary age, context, and decision style independently.\n${grievanceLines}\n`
        : `(No grounded grievances available for this segment — invent realistic, diverse anxieties.)\n`;

      if (pool.length) grounded += Math.min(n, sampled.length);

      const raw = await llm.completeJson<z.infer<typeof BatchSchema>>({
        messages: [
          {
            role: "system",
            content:
              "You generate realistic, diverse buyer personas grounded in real " +
              "purchase behavior. Avoid stereotypes; vary age, context, and anxiety.",
          },
          {
            role: "user",
            content:
              `Category: ${pack.name} (${pack.geography}).\n` +
              `Segment: "${segSeed}".\n` +
              `Generate ${n} distinct personas in this segment.\n` +
              groundingNote +
              `Each: id, segment, name, age, context, budgetSensitivity ` +
              `(low|medium|high), primaryNeed, anxieties[], decisionStyle, ` +
              `shoppingContext.\nReturn { "personas": [...] }.`,
          },
        ],
        temperature: 0.9,
      });
      return BatchSchema.parse(raw).personas.map((p) => ({ ...p, segment: segSeed }));
    }),
  );

  const personas = batches.flat().slice(0, size);
  const groundingCoverage = personas.length
    ? Math.min(grounded, personas.length) / personas.length
    : 0;
  const diversity = cohortDiversity(personas.map((p) => p.anxieties.join("\0")));

  return { personas, groundingCoverage, cohortDiversity: diversity };
}
