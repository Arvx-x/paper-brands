import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";
import type { BuyerArena, ArenaInput, MatchResult } from "./types.ts";
import type { BlindCard } from "../brand/types.ts";
import { cardFromConcept, cardFromArchetype } from "./cardBuild.ts";
import { renderPitchFlat } from "./card.ts";

/** A choice made by one persona over a blinded slate of options. */
const ChoiceSchema = z.object({
  pick: z.string().describe("label of the chosen OPTION"),
  willingnessToPay: z.number().describe("max price in whole currency units"),
  reason: z.string(),
  topObjection: z.string(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

/**
 * Runs blind choice trials: each persona is shown a shuffled, label-anonymized
 * slate (candidate brands + disguised competitor archetypes) and picks one.
 * No real or candidate brand names are ever shown -> controls for pretraining
 * bias and name recognition. Output feeds relative win-rate scoring.
 */
export class SingleShotArena implements BuyerArena {
  readonly kind = "single-shot" as const;
  readonly costClass = "cheap" as const;

  constructor(
    private pack: CategoryPack,
    private llm = new LLMClient(),
    private concurrency = loadConfig().concurrency,
  ) {}

  async run(input: ArenaInput): Promise<MatchResult[]> {
    const { candidates, cohort } = input;
    const pack = input.pack ?? this.pack;
    const includeCompetitors = input.opts?.includeCompetitors ?? true;

    // Stable label -> conceptId map (built per-trial because order shuffles).
    const results: MatchResult[] = [];

    await pool(cohort, this.concurrency, async (persona) => {
      // Build a fresh shuffled slate for each persona.
      const entries: { card: BlindCard; conceptId: string }[] = [];
      candidates.forEach((c, i) => {
        const label = `OPTION-${String.fromCharCode(65 + i)}`;
        entries.push({ card: cardFromConcept(c, label), conceptId: c.id });
      });
      if (includeCompetitors) {
        pack.competitorArchetypes.forEach((a, i) => {
          const label = `OPTION-${String.fromCharCode(65 + candidates.length + i)}`;
          const price = midPrice(pack, a.pricePositioning);
          entries.push({
            card: cardFromArchetype(a, label, price),
            conceptId: `competitor:${a.codeName}`,
          });
        });
      }
      const slate = shuffle(entries);

      const choice = await this.ask(persona, slate.map((e) => e.card), pack.currency).catch(() => null);
      if (!choice) {
        results.push({
          personaId: persona.id, segment: persona.segment, pickedConceptId: "",
          pickedLabel: "", willingnessToPayMinor: 0, reason: "", topObjection: "",
          errored: true,
        });
        return;
      }
      const matched = slate.find((e) => e.card.label === choice.pick) ?? slate[0]!;
      results.push({
        personaId: persona.id,
        segment: persona.segment,
        pickedLabel: choice.pick,
        pickedConceptId: matched.conceptId,
        willingnessToPayMinor: Math.round(choice.willingnessToPay * 100),
        reason: choice.reason,
        topObjection: choice.topObjection,
      });
    });

    return results;
  }

  private async ask(persona: Persona, cards: BlindCard[], currency: string): Promise<Choice> {
    const slate = cards.map((c) => `${c.label}: ${renderPitchFlat(c, currency)}`).join("\n");
    return this.llm.completeJson<Choice>({
      model: loadConfig().simModel,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            `You ARE this shopper, deciding for real money. Do not be agreeable; ` +
            `apply your real budget sensitivity and anxieties. ` +
            `Persona: ${JSON.stringify(persona)}`,
        },
        {
          role: "user",
          content:
            `You are ${persona.shoppingContext}. These are unbranded options ` +
            `(names hidden on purpose). Pick exactly ONE you would actually buy.\n\n` +
            `${slate}\n\n` +
            `Return JSON: { "pick": "OPTION-x", "willingnessToPay": <whole ${currency}>, ` +
            `"reason": "...", "topObjection": "..." }`,
        },
      ],
    });
  }
}

function midPrice(pack: CategoryPack, band: string): number {
  if (!pack.priceBands.length) return 0;
  // Match by label; tolerate dynamic/renamed tiers by substring, else median band.
  const b =
    pack.priceBands.find((x) => x.label === band) ??
    pack.priceBands.find((x) => band.includes(x.label) || x.label.includes(band)) ??
    pack.priceBands[Math.floor(pack.priceBands.length / 2)]!;
  return Math.round((b.lowMinor + b.highMinor) / 2);
}
