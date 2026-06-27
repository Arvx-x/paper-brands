import { z } from "zod";
import { Agent } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import { brandKitDigest } from "./brandkit.ts";
import { defaultStructure, type GenStructure } from "./structure.ts";
import {
  CreativeBriefSchema,
  CreativeSpecSchema,
  ASSET_PRESETS,
  assetAspect,
  brandSlug,
  type BrandKit,
  type CreativeBrief,
  type CreativeSpec,
} from "./types.ts";

const BriefsSchema = z.object({ briefs: z.array(CreativeBriefSchema.partial({ id: true })) });

/**
 * The Creative Council turns a BrandKit into creative briefs and synthesizes
 * fully-specified, render-ready CreativeSpecs. The roster, the fields it fills,
 * and how it's instructed all come from the active GenStructure, so the
 * meta-optimizer can evolve the council itself.
 */
export class CreativeCouncil {
  private agents: Agent[];
  constructor(
    private kit: BrandKit,
    private llm = new LLMClient(),
    private structure: GenStructure = defaultStructure(),
  ) {
    this.agents = this.structure.council.map((s) => new Agent(s, llm));
  }

  /** Find an agent by role, falling back to the first agent if the role is absent. */
  private agent(role: string): Agent {
    return this.agents.find((a) => a.spec.role.toLowerCase().includes(role.toLowerCase())) ?? this.agents[0]!;
  }

  /** Propose a slate of creative briefs across the requested asset types. */
  async proposeBriefs(assetTypes: string[], perType = 1): Promise<CreativeBrief[]> {
    const marketer = this.agent("Performance Marketer");
    const digest = brandKitDigest(this.kit);
    const wanted = assetTypes.map((t) => `${t} (${ASSET_PRESETS[t]?.note ?? "creative"})`).join(", ");

    const out = await marketer
      .respondJson<z.infer<typeof BriefsSchema>>(
        `BrandKit:\n${digest}\n\n` +
          `Propose ${perType} brief(s) for EACH of these asset types: ${wanted}.\n` +
          `Each brief: a single big idea expressed visually, the job it does, audience, ` +
          `channel, and what must appear in-frame. Distinct ideas, all on-brand.\n` +
          `Schema: { "briefs": [{ "assetType", "purpose", "audience", "channel", "bigIdea", "mustInclude"[] }] }`,
      )
      .then((r) => BriefsSchema.parse(r).briefs)
      .catch(() => []);

    return out.map((b, i) =>
      CreativeBriefSchema.parse({ ...b, id: b.id ?? `${brandSlug(b.assetType)}-${i + 1}` }),
    );
  }

  /**
   * Synthesize a render-ready CreativeSpec for a brief. Art Director + Copywriter
   * inform the Prompt Engineer, who emits the concrete image prompt + copy.
   */
  async specifyCreative(brief: CreativeBrief): Promise<CreativeSpec> {
    const digest = brandKitDigest(this.kit);
    const palette = this.kit.palette.map((p) => `${p.name} ${p.hex}`).join(", ");

    const engineer = this.agent("Prompt Engineer");
    const fieldLines = this.structure.specFields.map((f) => `- ${f.key}: ${f.instruction}`).join("\n");
    const fieldKeys = this.structure.specFields.map((f) => f.key).join(", ");
    const raw = await engineer.respondJson<Record<string, unknown>>(
      `BrandKit:\n${digest}\nExact palette hex: ${palette}\nArt direction: ${this.kit.artDirection}\n\n` +
        `Brief:\n${JSON.stringify(brief, null, 2)}\n\n` +
        `${this.structure.specSystem} Aspect ratio will be ${assetAspect(brief.assetType)}.\n\n` +
        `Specify EACH of these art-direction fields concretely (no vague adjectives without a visual anchor):\n` +
        `${fieldLines}\n` +
        `Then also provide:\n` +
        `- imagePrompt: a single flowing paragraph weaving the above fields into a vivid, ` +
        `render-ready description with the exact palette hex and all IN-IMAGE TEXT spelled out verbatim\n` +
        `- headline, subhead, cta: the copy (tight, in brand voice)\n` +
        `- negativePrompt: what to avoid for this specific shot\n` +
        `- rationale: one line on why this wins\n\n` +
        `Stay strictly within the BrandKit. Return ONLY a JSON object with keys: ` +
        `${fieldKeys}, imagePrompt, headline, subhead, cta, negativePrompt, rationale.`,
    );

    // Collect the structure's art-direction fields into the dynamic `direction` map.
    const direction: Record<string, string> = {};
    for (const f of this.structure.specFields) {
      const v = raw[f.key];
      if (v != null && String(v).trim()) direction[f.key] = String(v);
    }

    return CreativeSpecSchema.parse({
      id: `${brief.id}-spec`,
      briefId: brief.id,
      assetType: brief.assetType,
      aspect: assetAspect(brief.assetType),
      headline: raw.headline ?? brief.bigIdea,
      subhead: raw.subhead ?? "",
      cta: raw.cta ?? "",
      layout: raw.layout ?? "",
      imagePrompt: raw.imagePrompt ?? brief.bigIdea,
      direction,
      negativePrompt: raw.negativePrompt ?? "",
      rationale: raw.rationale ?? "",
    });
  }

  /** End-to-end: briefs -> specs for the requested asset types. */
  async generateSpecs(assetTypes: string[], perType = 1): Promise<CreativeSpec[]> {
    const briefs = await this.proposeBriefs(assetTypes, perType);
    const specs = await Promise.all(
      briefs.map((b) =>
        this.specifyCreative(b).catch((e) => {
          console.warn(`[creative] failed to specify '${b.id}': ${(e as Error).message}`);
          return null;
        }),
      ),
    );
    return specs.filter((s): s is CreativeSpec => s !== null);
  }
}
