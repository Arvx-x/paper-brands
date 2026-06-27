import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import type { EngineTraits } from "./traits.ts";
import type { Grades } from "./engine.ts";

const score10 = z.preprocess(
  (v) => Math.max(0, Math.min(10, Number(v) || 0)),
  z.number(),
);

export const GradesSchema = z.object({
  traumaResolutionScore: score10,
  valueScore: score10,
  pressureScore: score10,
  impulseTriggers: z
    .object({
      scarcity: z.boolean().default(false),
      socialProof: z.boolean().default(false),
      novelty: z.boolean().default(false),
      emotionalAppeal: z.boolean().default(false),
    })
    .default({ scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false }),
  desiredAction: z
    .enum(["WANT_TO_BUY", "STILL_OBJECTING", "WALKING_AWAY"])
    .catch("STILL_OBJECTING"),
  spokenObjection: z.string().default(""),
});

export function buildGraderPrompt(renderedCard: string, t: EngineTraits & { name?: string; demographic?: string }, turn: number): string {
  return (
    `You are a rigorous behavioral analyst grading a shopper's reaction to a product page. ` +
    `You are NOT the shopper and you do NOT want to please anyone. Real skeptical shoppers ` +
    `do NOT cave to nice copy or discounts; many get MORE suspicious. Reward genuine evidence, ` +
    `punish hype. This is turn ${turn} of 4 of the shopper's deliberation.\n\n` +
    `[SHOPPER]\n` +
    `Name: ${t.name ?? "Shopper"}\n` +
    `Deep reluctance / past trauma: ${t.reluctancePrior}\n` +
    `Skepticism: ${t.skepticism} | Impulsivity: ${t.impulsivity} | PriceConsciousness: ${t.priceConsciousness}\n\n` +
    `[PRODUCT PAGE — fixed, the shopper re-reads it]\n${renderedCard}\n\n` +
    `Surface the shopper's single most pressing remaining objection this turn, and grade how well ` +
    `the page ALREADY addresses it. Be strict; most turns are not a 9 or 10.\n` +
    `Return JSON: { "traumaResolutionScore":0-10, "valueScore":0-10, "pressureScore":0-10, ` +
    `"impulseTriggers": {"scarcity":bool,"socialProof":bool,"novelty":bool,"emotionalAppeal":bool}, ` +
    `"desiredAction":"WANT_TO_BUY"|"STILL_OBJECTING"|"WALKING_AWAY", "spokenObjection":"..." }`
  );
}

export async function gradeCard(
  renderedCard: string,
  traits: EngineTraits & { name?: string; demographic?: string },
  turn: number,
  llm = new LLMClient(),
): Promise<Grades & { spokenObjection: string }> {
  const raw = await llm.completeJson<unknown>({
    model: loadConfig().simModel,
    temperature: 0.4,
    messages: [{ role: "user", content: buildGraderPrompt(renderedCard, traits, turn) }],
  });
  return GradesSchema.parse(raw);
}
