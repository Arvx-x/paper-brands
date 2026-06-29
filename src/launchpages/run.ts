import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { ImageClient } from "../llm/imageClient.ts";
import { generateIdentity as realGenerateIdentity } from "../creative/identity.ts";
import { optimizeCreative as realOptimizeCreative } from "../creative/optimize.ts";
import { buildLandingPage as realBuildLandingPage } from "../launchpage/build.ts";
import type { SmokeExperiment } from "../smoketest/types.ts";
import type { FinalistsArtifact } from "../pipeline/foundry.ts";
import { deriveLiteKit } from "./kit.ts";
import { productSpec } from "./spec.ts";
import type { LaunchpagesOptions, BuiltPage, LaunchpagesResult } from "./types.ts";
import { buildBrandKit as realBuildBrandKit, saveBrandKit } from "../creative/brandkit.ts";
import { buildNarrative as realBuildNarrative, saveNarrative } from "../brand/narrative.ts";
import { generateMotif as realGenerateMotif } from "../creative/motif.ts";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface LaunchpagesDeps {
  readFinalists?: (path: string) => Promise<Pick<FinalistsArtifact, "categoryId" | "finalists">>;
  generateIdentity?: typeof realGenerateIdentity;
  optimizeCreative?: typeof realOptimizeCreative;
  buildLandingPage?: typeof realBuildLandingPage;
  imageClient?: ImageClient;
  llm?: LLMClient;
  buildBrandKit?: typeof realBuildBrandKit;
  buildNarrative?: typeof realBuildNarrative;
  generateMotif?: typeof realGenerateMotif;
}

async function defaultReadFinalists(path: string) {
  const f = Bun.file(path);
  if (!(await f.exists())) throw new Error(`launchpages: no finalists at ${path} (run foundry first)`);
  return (await f.json()) as FinalistsArtifact;
}

export async function runLaunchpages(
  opts: LaunchpagesOptions,
  deps: LaunchpagesDeps = {},
): Promise<LaunchpagesResult> {
  const readFinalists = deps.readFinalists ?? defaultReadFinalists;
  const generateIdentity = deps.generateIdentity ?? realGenerateIdentity;
  const optimizeCreative = deps.optimizeCreative ?? realOptimizeCreative;
  const buildLandingPage = deps.buildLandingPage ?? realBuildLandingPage;
  const llm = deps.llm ?? new LLMClient();
  const imageClient = deps.imageClient ?? new ImageClient();
  const buildBrandKit = deps.buildBrandKit ?? realBuildBrandKit;
  const buildNarrative = deps.buildNarrative ?? realBuildNarrative;
  const generateMotif = deps.generateMotif ?? realGenerateMotif;

  const outDir = opts.outDir ?? "out/launchpages";
  const { categoryId, finalists } = await readFinalists(opts.finalistsPath ?? "out/finalists.json");
  if (!finalists || finalists.length === 0) throw new Error("launchpages: finalists list is empty");

  const builtAt = new Date().toISOString();
  const experimentId = opts.experimentId ?? builtAt;
  const rounds = (opts.rounds && Number.isFinite(opts.rounds) ? opts.rounds : 0) || 2;
  const bestOf = (opts.bestOf && Number.isFinite(opts.bestOf) ? opts.bestOf : 0) || 2;
  const currency = opts.currency ?? "INR";

  const built: BuiltPage[] = [];
  const skipped: string[] = [];
  const failed: { conceptId: string; reason: string }[] = [];
  const usedSlugs = new Set<string>();

  opts.onEvent?.({ type: "stage", stage: "creative", status: "start" });

  for (const fin of finalists) {
    const concept = fin.concept;
    let slug = slugify(concept.id || concept.name) || "concept";
    const base = slug; let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    const bundleDir = `${outDir}/${slug}`;
    if (await Bun.file(`${bundleDir}/index.html`).exists()) {
      skipped.push(concept.id);
      continue;
    }
    try {
      await mkdir(bundleDir, { recursive: true });
      // Build the real LLM kit; fall back to the lite stub if it fails.
      let kit;
      try {
        kit = await buildBrandKit(concept, undefined, llm, "India");
      } catch (e) {
        console.error(`[launchpages] buildBrandKit failed for ${concept.id}, using lite kit: ${(e as Error).message}`);
        kit = deriveLiteKit(concept);
      }
      const narrative = await buildNarrative(concept, kit, llm, "India");
      const motif = await generateMotif(kit, { outDir: bundleDir, imageClient, llm });
      await saveBrandKit(kit, bundleDir);
      await saveNarrative(narrative, bundleDir);
      const rel = (p: string) => "/" + p.replace(/^\.?\//, "");
      opts.onEvent?.({ type: "card-identity", conceptId: concept.id, name: concept.name,
        essence: kit.essence, vision: narrative.vision, story: narrative.originStory,
        palette: kit.palette, motifUrl: motif ? rel(motif.imagePath) : undefined });
      const id = await generateIdentity(kit, { outDir: bundleDir, imageClient, llm });
      const prod = await optimizeCreative({
        kit, spec: productSpec(kit), rounds, bestOf, refImages: id.refImages,
        outDir: bundleDir, llm, imageClient,
      });
      opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "logo", url: rel(id.logo.imagePath) });
      opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "packaging", url: rel(id.packaging.imagePath) });
      opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "product", url: rel(prod.champion.imagePath) });
      const assets = {
        brandKit: kit,
        logoPath: id.logo.imagePath,
        packagingPath: id.packaging.imagePath,
        heroPath: prod.champion.imagePath,
        adPaths: [],
      };
      const res = await buildLandingPage(concept, assets, llm, {
        outDir: bundleDir, experimentId, model: opts.pageModel, currency,
      });
      opts.onEvent?.({ type: "page-ready", conceptId: concept.id, name: concept.name, url: rel(res.indexPath) });
      built.push({
        conceptId: concept.id, name: concept.name, slug, bundleDir, indexPath: res.indexPath,
        syntheticScore: fin.winRate, usedFallback: res.usedFallback, warnings: res.warnings,
      });
    } catch (e) {
      failed.push({ conceptId: concept.id, reason: (e as Error).message });
    }
  }
  opts.onEvent?.({ type: "stage", stage: "pages", status: "done" });

  const manifest: SmokeExperiment = {
    category: categoryId,
    currency,
    builtAt,
    realMetric: "notify CTR",
    source: "smoke-test",
    unit: "concept",
    concepts: built.map((b) => ({
      conceptId: b.conceptId, name: b.name, syntheticScore: b.syntheticScore,
      slug: b.slug, pagePath: `${b.slug}/index.html`, // bundle layout: <slug>/index.html (not flat pages/<slug>.html)
    })),
  };
  const manifestPath = `${outDir}/experiment.json`;
  await mkdir(outDir, { recursive: true });
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

  return { outDir, built, skipped, failed, manifestPath };
}
