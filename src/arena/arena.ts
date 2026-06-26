import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import type { Persona } from "../personas/cohort.ts";
import type { BrandConcept, BlindCard } from "../brand/types.ts";
import type { CompetitorArchetype, CategoryPack } from "../categories/types.ts";

/** A choice made by one persona over a blinded slate of options. */
const ChoiceSchema = z.object({
  pick: z.string().describe("label of the chosen OPTION"),
  willingnessToPay: z.number().describe("max price in whole currency units"),
  reason: z.string(),
  topObjection: z.string(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export interface MatchResult {
  personaId: string;
  segment: string;
  pickedLabel: string;
  pickedConceptId: string;
  willingnessToPayMinor: number;
  reason: string;
  topObjection: string;
}

/** Turn a candidate brand into a neutral blind card. */
function cardFromConcept(c: BrandConcept, label: string): BlindCard {
  return {
    label,
    pitch:
      `${c.positioning}. ${c.productPromise} ` +
      `Key claims: ${c.claims.join(", ")}. ` +
      `Price: ${c.priceMinor / 100}. Format: ${c.heroSku}.`,
  };
}

/** Turn a disguised competitor archetype into a neutral blind card. */
function cardFromArchetype(a: CompetitorArchetype, label: string, priceMinor: number): BlindCard {
  return {
    label,
    pitch:
      `${a.description} Key claims: ${a.claims.join(", ")}. ` +
      `Price: ${priceMinor / 100}. Positioning: ${a.pricePositioning}.`,
  };
}

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
export class Arena {
  constructor(
    private pack: CategoryPack,
    private llm = new LLMClient(),
    private concurrency = loadConfig().concurrency,
  ) {}

  async run(
    candidates: BrandConcept[],
    cohort: Persona[],
    opts: { includeCompetitors?: boolean } = {},
  ): Promise<MatchResult[]> {
    const includeCompetitors = opts.includeCompetitors ?? true;

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
        this.pack.competitorArchetypes.forEach((a, i) => {
          const label = `OPTION-${String.fromCharCode(65 + candidates.length + i)}`;
          const price = midPrice(this.pack, a.pricePositioning);
          entries.push({
            card: cardFromArchetype(a, label, price),
            conceptId: `competitor:${a.codeName}`,
          });
        });
      }
      const slate = shuffle(entries);

      const choice = await this.ask(persona, slate.map((e) => e.card)).catch(() => null);
      if (!choice) return;
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

  private async ask(persona: Persona, cards: BlindCard[]): Promise<Choice> {
    const slate = cards.map((c) => `${c.label}: ${c.pitch}`).join("\n");
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
            `Return JSON: { "pick": "OPTION-x", "willingnessToPay": <whole ${this.pack.currency}>, ` +
            `"reason": "...", "topObjection": "..." }`,
        },
      ],
    });
  }
}

function midPrice(pack: CategoryPack, band: string): number {
  const b = pack.priceBands.find((x) => x.label === band) ?? pack.priceBands[0]!;
  return Math.round((b.lowMinor + b.highMinor) / 2);
}
