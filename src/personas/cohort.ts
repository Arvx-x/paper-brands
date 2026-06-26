import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import type { CategoryPack } from "../categories/types.ts";

export const PersonaSchema = z.object({
  id: z.coerce.string(),
  segment: z.string(),
  name: z.string(),
  age: z.coerce.number(),
  context: z.string().describe("life context driving the purchase"),
  budgetSensitivity: z.enum(["low", "medium", "high"]),
  primaryNeed: z.string(),
  anxieties: z.array(z.string()),
  decisionStyle: z.string(),
  shoppingContext: z.string().describe("e.g. browsing Amazon, saw a Reel"),
});
export type Persona = z.infer<typeof PersonaSchema>;

const BatchSchema = z.object({ personas: z.array(PersonaSchema) });

/**
 * Build a representative cohort proportional to category segment weights.
 * In v0 personas are generated from segment seeds; the full system grounds
 * them in mined reviews, search queries, and CRM/survey data.
 */
export async function buildCohort(
  pack: CategoryPack,
  size: number,
  llm = new LLMClient(),
): Promise<Persona[]> {
  const perSegment = pack.buyerSegments.map((s) => ({
    seed: s.seed,
    n: Math.max(1, Math.round(s.weight * size)),
  }));

  const batches = await Promise.all(
    perSegment.map(async ({ seed, n }) => {
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
              `Segment: "${seed}".\n` +
              `Generate ${n} distinct personas in this segment.\n` +
              `Each: id, segment, name, age, context, budgetSensitivity ` +
              `(low|medium|high), primaryNeed, anxieties[], decisionStyle, ` +
              `shoppingContext.\nReturn { "personas": [...] }.`,
          },
        ],
        temperature: 0.9,
      });
      return BatchSchema.parse(raw).personas.map((p) => ({ ...p, segment: seed }));
    }),
  );

  return batches.flat().slice(0, size);
}
