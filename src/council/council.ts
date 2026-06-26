import { Agent, COUNCIL_SPECS } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import type { CategoryPack } from "../categories/types.ts";
import { BrandConceptSchema, type BrandConcept } from "../brand/types.ts";
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
  async proposeTerritories(perAgent = 2): Promise<
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

  /** Generate N candidate brands end-to-end. */
  async generateCandidates(count: number): Promise<BrandConcept[]> {
    const territories = await this.proposeTerritories();
    const picked = territories.slice(0, count);
    const concepts = await Promise.all(
      picked.map((t) =>
        this.specifyBrand(t).catch((e) => {
          console.warn(`[council] failed to specify '${t.name}': ${e.message}`);
          return null;
        }),
      ),
    );
    return concepts.filter((c): c is BrandConcept => c !== null);
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
