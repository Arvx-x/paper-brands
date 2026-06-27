import { Agent, COUNCIL_SPECS } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import type { CategoryPack } from "../categories/types.ts";
import { BrandConceptSchema, type BrandConcept } from "../brand/types.ts";
import { tagWedges, selectDiverse, type WedgeTag, type DiversityReport, type TerritoryLike } from "./diversity.ts";
import { z } from "zod";

const TerritoriesSchema = z.object({
  territories: z.array(
    z.object({
      name: z.string(),
      thesis: z.string(),
      whyNow: z.string(),
      primarySegment: z.string(),
    }),
  ),
});

/**
 * The Council turns a CategoryPack into brand territories, debates them, and
 * synthesizes fully-specified candidate brands. Each step keeps provenance so
 * the UI can later show "which agent argued for this and what lost".
 */
export class Council {
  private agents: Agent[];
  /** Test seam: override the wedge tagger. Defaults to the real batched LLM tagger. */
  private __tagFn?: (terrs: TerritoryLike[]) => Promise<WedgeTag[]>;

  constructor(private pack: CategoryPack, private llm = new LLMClient()) {
    this.agents = COUNCIL_SPECS.map((s) => new Agent(s, llm));
  }

  private packBrief(): string {
    return JSON.stringify(
      {
        category: this.pack.name,
        geography: this.pack.geography,
        currency: this.pack.currency,
        unmetNeeds: this.pack.unmetNeeds,
        purchaseTriggers: this.pack.purchaseTriggers,
        rejectionReasons: this.pack.rejectionReasons,
        priceBands: this.pack.priceBands,
        competitorArchetypes: this.pack.competitorArchetypes,
        complianceNotes: this.pack.complianceNotes,
      },
      null,
      2,
    );
  }

  /** Each specialist proposes territories from its own lens, then we merge. */
  async proposeTerritories(perAgent = 2, avoid: string[] = []): Promise<
    z.infer<typeof TerritoriesSchema>["territories"]
  > {
    const brief = this.packBrief();
    const results = await Promise.all(
      this.agents.map((a) =>
        a
          .respondJson<z.infer<typeof TerritoriesSchema>>(
            `Category brief:\n${brief}\n\n` +
              `Propose ${perAgent} distinct brand territories (white-space bets) ` +
              `from your specialist lens. Each must attack a named unmet need ` +
              `and avoid an existing competitor archetype's strength.\n` +
              (avoid.length
                ? `These positioning wedges are already saturated — propose territories that ` +
                  `attack DIFFERENT wedges, NOT these: ${avoid.join(", ")}.\n`
                : "") +
              `Schema: { "territories": [{ "name", "thesis", "whyNow", "primarySegment" }] }`,
          )
          .then((r) => TerritoriesSchema.parse(r).territories)
          .catch(() => []),
      ),
    );
    return results.flat();
  }

  /** Brand Strategist synthesizes a fully-specified concept from a territory. */
  async specifyBrand(territory: {
    name: string;
    thesis: string;
    primarySegment: string;
  }): Promise<BrandConcept> {
    const strategist = this.agents.find((a) => a.spec.role === "Brand Strategist")!;
    const raw = await strategist.respondJson<Record<string, unknown>>(
      `Category brief:\n${this.packBrief()}\n\n` +
        `Territory: ${JSON.stringify(territory)}\n\n` +
        `Specify ONE launchable brand concept. Price in minor units of ` +
        `${this.pack.currency}. Respect compliance notes (cosmetic claims only).\n` +
        `Schema keys: id, name, positioning, targetCustomer, coreInsight, ` +
        `productPromise, heroSku, priceMinor, priceBand, tagline, claims[], ` +
        `packagingDirection, brandVoice, landingHeadline, topAdAngles[], ` +
        `objections[], launchRisks[].`,
    );
    const withId = { ...raw, id: raw.id ?? slug(String(raw.name ?? territory.name)) };
    return BrandConceptSchema.parse(withId);
  }

  /** Generate N candidate brands end-to-end, with diversity selection + one bounded re-roll. */
  async generateCandidates(
    count: number,
    seed = 0,
  ): Promise<{ concepts: BrandConcept[]; diversity: DiversityReport }> {
    const bandLabels = (this.pack.priceBands ?? []).map((b) => b.label);
    const tag = (terrs: TerritoryLike[]) =>
      (this.__tagFn ? this.__tagFn(terrs) : tagWedges(terrs, bandLabels, this.llm));

    // 1. over-generate + tag + select
    let pool = await this.proposeTerritories(2);
    let tags = await tag(pool);
    let sel = selectDiverse(tags, count, seed);
    let rerolled = false;

    // 2. one bounded re-roll if the slate collapses
    if (sel.distinctWedgeCount < count) {
      try {
        const pool2 = await this.proposeTerritories(2, sel.spannedWedges);
        const tags2 = (await tag(pool2)).map((t) => ({ ...t, territoryIndex: t.territoryIndex + pool.length }));
        const combinedPool = [...pool, ...pool2];
        const combinedTags = [...tags, ...tags2];
        const sel2 = selectDiverse(combinedTags, count, seed);
        pool = combinedPool;
        tags = combinedTags;
        sel = sel2;
        rerolled = true;
      } catch (e) {
        console.warn(`[council] re-roll failed: ${(e as Error).message}`);
      }
    }

    // 3. specify the selected territories (unchanged).
    // `territoryIndex` is positionally aligned to `pool`: the first pool's tags use 0..pool0-1,
    // and re-roll tags were re-based by `+ pool0.length` while `pool` was concatenated in the
    // same order — so `pool[idx]` is the correct territory by construction.
    const tagByIndex = new Map(tags.map((t) => [t.territoryIndex, t]));
    const selected = sel.selectedIndices
      .map((idx) => ({ territory: pool[idx], tag: tagByIndex.get(idx) }))
      .filter((x): x is { territory: NonNullable<(typeof pool)[number]>; tag: WedgeTag } => Boolean(x.territory && x.tag));
    const specified = (
      await Promise.all(
        selected.map(async ({ territory, tag }) => {
          const concept = await this.specifyBrand(territory).catch((e) => {
            console.warn(`[council] failed to specify '${territory.name}': ${e.message}`);
            return null;
          });
          return concept ? { concept, tag } : null;
        }),
      )
    ).filter((x): x is { concept: BrandConcept; tag: WedgeTag } => x !== null);

    const concepts = specified.map((x) => x.concept);
    const successfulTags = specified.map((x) => x.tag);
    const fp = (t: WedgeTag) => `${t.fingerprint.wedge}|${t.fingerprint.segment}|${t.fingerprint.tier}`;
    const distinctWedgeCount = new Set(successfulTags.map(fp)).size;
    const spannedWedges = [...new Set(successfulTags.map((t) => t.fingerprint.wedge))].sort();
    const warning = distinctWedgeCount < count || concepts.length < count ? ("lowConceptDiversity" as const) : undefined;

    const diversity: DiversityReport = {
      requested: count,
      distinctWedgeCount,
      spannedWedges,
      poolSize: pool.length,
      rerolled,
      warning,
    };
    return { concepts, diversity };
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
