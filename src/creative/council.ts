import { z } from "zod";
import { Agent } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import { CREATIVE_COUNCIL_SPECS } from "./agents.ts";
import { brandKitDigest } from "./brandkit.ts";
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
 * fully-specified, render-ready CreativeSpecs. Mirrors the strategy Council:
 * specialists propose, the Prompt Engineer synthesizes the buildable artifact.
 */
export class CreativeCouncil {
  private agents: Agent[];
  constructor(private kit: BrandKit, private llm = new LLMClient()) {
    this.agents = CREATIVE_COUNCIL_SPECS.map((s) => new Agent(s, llm));
  }

  private agent(role: string): Agent {
    return this.agents.find((a) => a.spec.role === role)!;
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
    const raw = await engineer.respondJson<Record<string, unknown>>(
      `BrandKit:\n${digest}\nExact palette hex: ${palette}\nArt direction: ${this.kit.artDirection}\n\n` +
        `Brief:\n${JSON.stringify(brief, null, 2)}\n\n` +
        `Direct ONE award-winning creative for a state-of-the-art image model — the ` +
        `kind of work that wins Cannes Lions, not a stock template. Think like a top ` +
        `art director shooting an editorial campaign. Aspect ratio will be ${assetAspect(brief.assetType)}.\n\n` +
        `Specify EACH field concretely (no vague adjectives without a visual anchor):\n` +
        `- subject: the hero and exactly how it's styled, posed, and placed\n` +
        `- camera: shot type, specific lens (e.g. 85mm), angle, depth of field/bokeh\n` +
        `- lighting: setup, direction, quality (soft/hard), time of day, any rim/fill\n` +
        `- colorGrade: which BrandKit hex dominate, contrast, a film/grade reference\n` +
        `- composition: framing, focal hierarchy, negative space, where text sits\n` +
        `- texture: materials and surface finish (matte, dewy, ceramic, paper grain)\n` +
        `- mood: the single emotion it must evoke\n` +
        `- typographyTreatment: how the headline/subhead/CTA are set and positioned\n` +
        `- imagePrompt: a single flowing paragraph weaving the above into a vivid, ` +
        `render-ready description with the exact palette hex and all IN-IMAGE TEXT spelled out verbatim\n` +
        `- headline, subhead, cta: the copy (tight, in brand voice)\n` +
        `- negativePrompt: what to avoid for this specific shot\n` +
        `- layout, rationale\n` +
        `Stay strictly within the BrandKit. Return ONLY the JSON object.`,
    );

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
      subject: raw.subject ?? "",
      camera: raw.camera ?? "",
      lighting: raw.lighting ?? "",
      colorGrade: raw.colorGrade ?? "",
      composition: raw.composition ?? "",
      texture: raw.texture ?? "",
      mood: raw.mood ?? "",
      typographyTreatment: raw.typographyTreatment ?? "",
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
