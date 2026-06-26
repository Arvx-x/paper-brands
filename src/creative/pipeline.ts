import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { ImageClient, readImage } from "../llm/imageClient.ts";
import { resolvePack } from "../categories/registry.ts";
import { runTournament } from "../pipeline/tournament.ts";
import { BrandConceptSchema, type BrandConcept } from "../brand/types.ts";
import { researchCreatives } from "./research.ts";
import { buildBrandKit, saveBrandKit } from "./brandkit.ts";
import { generateIdentity } from "./identity.ts";
import { CreativeCouncil } from "./council.ts";
import { renderCreative, composeEditPrompt } from "./render.ts";
import { optimizeCreative } from "./optimize.ts";
import { brandSlug, type BrandKit, type JuryVerdict, type RenderedCreative } from "./types.ts";

export interface CreativeFactoryOptions {
  /** Seed source: a category to run a tournament on, OR a saved concept JSON. */
  categoryId?: string;
  conceptPath?: string;
  /** Asset types to build for the launch library. */
  assetTypes?: string[];
  /** Variants the council generates per asset type before optimizing. */
  perType?: number;
  /** Hill-climb rounds per creative. */
  rounds?: number;
  /** Candidates rendered per creative before iterating (best-of-N). */
  bestOf?: number;
  /** Final render resolution: "1K" | "2K" | "4K". */
  imageSize?: string;
  /** Research competitor creatives first. */
  research?: boolean;
  /** Generate visual identity (logo + packaging) first; refs feed every render. */
  identity?: boolean;
  /** Skip paid renders (judges the prompt instead). */
  dry?: boolean;
  /** Candidates/cohort when seeding from a category. */
  candidates?: number;
  cohortSize?: number;
  outDir?: string;
}

export interface LibraryItem {
  rendered: RenderedCreative;
  verdict: JuryVerdict;
  startScore: number;
  finalScore: number;
}

export interface CreativeFactoryResult {
  brandId: string;
  brandName: string;
  kit: BrandKit;
  identity?: { logo: string; packaging: string };
  library: LibraryItem[];
  outDir: string;
}

const DEFAULT_ASSETS = ["ad-square", "ad-story", "landing-hero", "product-hero"];

/**
 * End-to-end Creative Factory (mirrors runTournament/runOptimize):
 *   concept -> [creative research] -> BrandKit -> [identity] -> brief -> spec
 *   -> render -> jury -> hill-climb -> final pro render -> library + report.
 * Everything loops and self-optimizes on the jury score; the resulting BrandKit
 * + identity refs then power on-demand generation of any asset/dimension.
 */
export async function runCreativeFactory(
  opts: CreativeFactoryOptions,
): Promise<CreativeFactoryResult> {
  const llm = new LLMClient();
  const ic = new ImageClient();
  const assetTypes = opts.assetTypes?.length ? opts.assetTypes : DEFAULT_ASSETS;

  // 1) Resolve the brand concept (identity input).
  const { concept, category } = await resolveConcept(opts);
  console.error(`[1/6] Brand: ${concept.name}`);

  // 2) Competitor-creative research (optional).
  let research;
  if (opts.research) {
    console.error(`[2/6] Researching competitor creatives...`);
    research = await researchCreatives(concept, category).catch(() => undefined);
    if (research) console.error(`      -> ${research.citationCount} citations`);
  }

  // 3) BrandKit.
  console.error(`[3/6] Building BrandKit...`);
  const kit = await buildBrandKit(concept, research, llm);
  const kitPath = await saveBrandKit(kit);
  console.error(`      -> ${kitPath}`);

  const outDir = opts.outDir ?? `out/creatives/${brandSlug(concept.name)}`;
  await mkdir(outDir, { recursive: true });

  // 4) Identity stage (logo + packaging) -> consistency refs.
  let refImages = undefined;
  let identityPaths;
  if (opts.identity !== false) {
    console.error(`[4/6] Generating visual identity (logo + packaging)...`);
    const id = await generateIdentity(kit, { outDir, dry: opts.dry, imageClient: ic, llm });
    refImages = id.refImages;
    identityPaths = { logo: id.logo.imagePath, packaging: id.packaging.imagePath };
    console.error(`      -> logo ${id.logo.imagePath}, packaging ${id.packaging.imagePath}`);
  }

  // 5) Brief -> spec for each asset type.
  console.error(`[5/6] Council generating specs for: ${assetTypes.join(", ")}...`);
  const council = new CreativeCouncil(kit, llm);
  const specs = await council.generateSpecs(assetTypes, opts.perType ?? 1);
  console.error(`      -> ${specs.length} specs`);

  // 6) Render -> jury -> hill-climb each; final pro render of the champion.
  console.error(`[6/6] Rendering, scoring, and optimizing (${opts.rounds ?? 3} rounds each)...`);
  const library: LibraryItem[] = [];
  for (const spec of specs) {
    const res = await optimizeCreative({
      kit,
      spec,
      rounds: opts.rounds ?? 3,
      bestOf: opts.bestOf ?? 2,
      refImages,
      outDir,
      dry: opts.dry,
      llm,
      imageClient: ic,
    }).catch((e) => {
      console.warn(`[creative] optimize failed for ${spec.id}: ${(e as Error).message}`);
      return null;
    });
    if (!res) continue;

    // Final high-fidelity render: re-render the winning spec with the PRO model
    // at high resolution, using the champion image itself as a reference so the
    // converged, jury-approved look is reproduced (not re-rolled) at full quality.
    const champBlob =
      opts.dry || res.champion.imagePath.endsWith(".prompt.txt")
        ? null
        : await readImage(
            res.champion.imagePath,
            res.champion.imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png",
          ).catch(() => null);
    const finalRender = await renderCreative(kit, res.champion.spec, {
      tier: "pro",
      imageSize: opts.imageSize ?? "2K",
      refImages: champBlob ? [champBlob, ...(refImages ?? [])] : refImages,
      promptOverride: champBlob
        ? composeEditPrompt(kit, res.champion.spec, [
            "reproduce this exact creative at the highest fidelity",
            "sharpen detail, perfect the typography kerning, and deepen lighting realism",
          ])
        : undefined,
      nameStem: `${res.champion.spec.id}-final`,
      dry: opts.dry,
      outDir,
      client: ic,
    }).catch(() => res.champion);

    library.push({
      rendered: finalRender,
      verdict: res.verdict,
      startScore: res.startScore,
      finalScore: res.finalScore,
    });
    console.error(
      `      ${spec.assetType}: ${res.startScore.toFixed(1)} -> ${res.finalScore.toFixed(1)} (${finalRender.imagePath})`,
    );
  }

  const result: CreativeFactoryResult = {
    brandId: kit.brandId,
    brandName: kit.brandName,
    kit,
    identity: identityPaths,
    library,
    outDir,
  };
  await writeReport(result);
  return result;
}

async function resolveConcept(
  opts: CreativeFactoryOptions,
): Promise<{ concept: BrandConcept; category: string }> {
  if (opts.conceptPath) {
    const concept = BrandConceptSchema.parse(await Bun.file(opts.conceptPath).json());
    return { concept, category: opts.categoryId ?? concept.heroSku };
  }
  if (!opts.categoryId) throw new Error("Creative Factory needs --category or --concept=<path>.");
  const pack = await resolvePack(opts.categoryId);
  const t = await runTournament({
    categoryId: opts.categoryId,
    candidates: opts.candidates ?? 3,
    cohortSize: opts.cohortSize ?? 20,
  });
  const winnerId = t.report.winner?.conceptId;
  const concept = t.concepts.find((c) => c.id === winnerId) ?? t.concepts[0];
  if (!concept) throw new Error("No concept available to build creatives from.");
  return { concept, category: pack.name };
}

async function writeReport(r: CreativeFactoryResult): Promise<void> {
  await Bun.write(`${r.outDir}/factory.json`, JSON.stringify(r, null, 2));
  const lines: string[] = [
    `# Creative Library — ${r.brandName}`,
    ``,
    `Essence: ${r.kit.essence}`,
    r.identity ? `\nIdentity: logo \`${r.identity.logo}\`, packaging \`${r.identity.packaging}\`` : "",
    ``,
    `## Assets`,
  ];
  for (const item of r.library) {
    lines.push(
      `- **${item.rendered.spec.assetType}** — score ${item.startScore.toFixed(1)} → ${item.finalScore.toFixed(1)}  `,
      `  \`${item.rendered.imagePath}\` — "${item.rendered.spec.headline}"`,
    );
  }
  await Bun.write(`${r.outDir}/library.md`, lines.filter((l) => l !== undefined).join("\n"));
}
