import { loadConfig } from "../config.ts";
import type { BuyerArena, ArenaInput, MatchResult } from "./types.ts";
import type { BlindCard } from "../brand/types.ts";
import { cardFromConcept, cardFromArchetype } from "./cardBuild.ts";
import { deriveTraits } from "./traits.ts";
import { negotiate } from "./negotiation.ts";
import { makeRng } from "./stats.ts";

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function midPrice(pack: ArenaInput["pack"], band: string): number {
  if (!pack.priceBands.length) return 0;
  const b =
    pack.priceBands.find((x) => x.label === band) ??
    pack.priceBands.find((x) => band.includes(x.label) || x.label.includes(band)) ??
    pack.priceBands[Math.floor(pack.priceBands.length / 2)]!;
  return Math.round((b.lowMinor + b.highMinor) / 2);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

/**
 * The DEEP arena: each persona negotiates independently against EVERY blind
 * option (candidates + disguised competitor archetypes), then picks the
 * AFFORDABLE option with the highest conviction. If nothing is affordable the
 * persona abstains — an honest "buy none" signal, NOT redistributed to any
 * competitor. Emits rich downstream signals: confidence/conviction,
 * perOptionWtpMinor, turnsToDecision.
 */
export class DeepNegotiationArena implements BuyerArena {
  readonly kind = "deep-negotiation" as const;
  readonly costClass = "expensive" as const;

  constructor(
    private pack: ArenaInput["pack"],
    private concurrency = loadConfig().concurrency,
    private negotiateFn = negotiate,
  ) {}

  async run(input: ArenaInput): Promise<MatchResult[]> {
    const pack = input.pack ?? this.pack;
    const includeCompetitors = input.opts?.includeCompetitors ?? true;
    const seed = String(input.opts?.seed ?? 0);
    const results: MatchResult[] = [];

    await pool(input.cohort, this.concurrency, async (persona) => {
      const traits = { ...deriveTraits(persona, pack, seed), name: persona.name };

      // Build the blind slate (candidates + disguised competitors).
      const entries: { card: BlindCard; conceptId: string }[] = [];
      input.candidates.forEach((c, i) => {
        entries.push({ card: cardFromConcept(c, `OPTION-${String.fromCharCode(65 + i)}`), conceptId: c.id });
      });
      if (includeCompetitors) {
        pack.competitorArchetypes.forEach((a, i) => {
          const price = midPrice(pack, a.pricePositioning);
          entries.push({
            card: cardFromArchetype(a, `OPTION-${String.fromCharCode(65 + input.candidates.length + i)}`, price),
            conceptId: `competitor:${a.codeName}`,
          });
        });
      }

      // Shuffle for blind control (SEEDED per persona for reproducibility).
      const rnd = makeRng(`${seed}::${persona.id}::slate`);
      const slate = shuffle(entries, rnd);

      // Negotiate each option independently (over the SHUFFLED slate).
      const perOptionWtpMinor: Record<string, number> = {};
      let best: { entry: typeof entries[number]; conviction: number; wtp: number; turns: number; objection: string } | null = null;
      let anyErrored = false;
      let erroredCount = 0;

      for (const e of slate) {
        const o = await this.negotiateFn(traits, e.card, pack.currency, `${seed}::${persona.id}`);
        perOptionWtpMinor[e.conceptId] = o.finalWtp;
        if (o.errored) { anyErrored = true; erroredCount++; continue; }
        const affordable = o.affordable;
        if (!affordable) continue;
        if (!best ||
            o.conviction > best.conviction ||
            (o.conviction === best.conviction && (o.finalWtp - e.card.priceMinor) > (best.wtp - best.entry.card.priceMinor))) {
          best = { entry: e, conviction: o.conviction, wtp: o.finalWtp, turns: o.turns, objection: o.lastObjection };
        }
      }

      if (!best) {
        const allErrored = erroredCount === slate.length;
        results.push({
          personaId: persona.id, segment: persona.segment, pickedConceptId: "",
          pickedLabel: "", willingnessToPayMinor: 0, reason: "", topObjection: "",
          abstained: !allErrored,   // queried but nothing affordable
          errored: allErrored,      // every option failed
          perOptionWtpMinor,
        });
        return;
      }

      results.push({
        personaId: persona.id, segment: persona.segment,
        pickedConceptId: best.entry.conceptId, pickedLabel: best.entry.card.label,
        willingnessToPayMinor: best.wtp, reason: `conviction ${best.conviction.toFixed(2)}`,
        topObjection: best.objection, confidence: best.conviction,
        perOptionWtpMinor, turnsToDecision: best.turns,
      });
    });

    return results;
  }
}
