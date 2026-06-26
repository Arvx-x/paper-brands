import { LLMClient } from "../llm/client.ts";
import { ImageClient, type ImageBlob } from "../llm/imageClient.ts";
import { CreativeCouncil } from "./council.ts";
import { renderCreative } from "./render.ts";
import { juryScore } from "./jury.ts";
import { optimizeCreative } from "./optimize.ts";
import { CreativeBriefSchema, assetAspect, type BrandKit, type JuryVerdict, type RenderedCreative } from "./types.ts";

export interface GenerateAssetOptions {
  kit: BrandKit;
  /** A known preset (logo, ad-square, ad-story, ...) or any custom asset label. */
  assetType: string;
  purpose: string;
  /** Override the preset aspect ratio — "generate any dimension". */
  aspect?: string;
  audience?: string;
  channel?: string;
  mustInclude?: string[];
  /** Identity/winning references for visual consistency. */
  refImages?: ImageBlob[];
  /** Hill-climb the asset before returning (default false for one-offs). */
  optimize?: boolean;
  rounds?: number;
  bestOf?: number;
  outDir: string;
  dry?: boolean;
  tier?: "flash" | "pro";
  llm?: LLMClient;
  imageClient?: ImageClient;
}

/**
 * The generative engine: once a BrandKit (and ideally identity refs) exist, make
 * ANY creative at ANY dimension on demand, on-brand. Spec via the Creative
 * Council, render with identity refs for consistency, optionally hill-climb.
 * This is what the whole pipeline optimizes toward.
 */
export async function generateAsset(
  opts: GenerateAssetOptions,
): Promise<{ rendered: RenderedCreative; verdict: JuryVerdict }> {
  const llm = opts.llm ?? new LLMClient();
  const ic = opts.imageClient ?? new ImageClient();
  const aspect = opts.aspect ?? assetAspect(opts.assetType);

  const council = new CreativeCouncil(opts.kit, llm);
  const brief = CreativeBriefSchema.parse({
    id: `${opts.assetType}-ondemand`,
    assetType: opts.assetType,
    purpose: opts.purpose,
    audience: opts.audience ?? "the brand's core customer",
    channel: opts.channel ?? opts.assetType,
    bigIdea: opts.purpose,
    mustInclude: opts.mustInclude ?? [],
  });
  const spec = { ...(await council.specifyCreative(brief)), aspect };

  if (opts.optimize) {
    const res = await optimizeCreative({
      kit: opts.kit,
      spec,
      rounds: opts.rounds ?? 3,
      bestOf: opts.bestOf,
      refImages: opts.refImages,
      outDir: opts.outDir,
      dry: opts.dry,
      llm,
      imageClient: ic,
    });
    return { rendered: res.champion, verdict: res.verdict };
  }

  const rendered = await renderCreative(opts.kit, spec, {
    tier: opts.tier ?? "pro",
    refImages: opts.refImages,
    dry: opts.dry,
    outDir: opts.outDir,
    client: ic,
  });
  const verdict = await juryScore(rendered, opts.kit, { imageClient: ic, llm });
  return { rendered, verdict };
}
