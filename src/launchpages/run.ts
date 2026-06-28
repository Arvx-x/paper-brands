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

  const outDir = opts.outDir ?? "out/launchpages";
  const { categoryId, finalists } = await readFinalists(opts.finalistsPath ?? "out/finalists.json");
  if (!finalists || finalists.length === 0) throw new Error("launchpages: finalists list is empty");

  const builtAt = new Date().toISOString();
  const experimentId = opts.experimentId ?? builtAt;
  const rounds = opts.rounds ?? 2;
  const bestOf = opts.bestOf ?? 2;
  const currency = opts.currency ?? "INR";

  const built: BuiltPage[] = [];
  const skipped: string[] = [];
  const failed: { conceptId: string; reason: string }[] = [];

  for (const fin of finalists) {
    const concept = fin.concept;
    const slug = slugify(concept.id || concept.name);
    const bundleDir = `${outDir}/${slug}`;
    if (await Bun.file(`${bundleDir}/index.html`).exists()) {
      skipped.push(concept.id);
      continue;
    }
    try {
      await mkdir(bundleDir, { recursive: true });
      const kit = deriveLiteKit(concept);
      const id = await generateIdentity(kit, { outDir: bundleDir, imageClient, llm });
      const prod = await optimizeCreative({
        kit, spec: productSpec(kit), rounds, bestOf, refImages: id.refImages,
        outDir: bundleDir, llm, imageClient,
      });
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
      built.push({
        conceptId: concept.id, name: concept.name, slug, bundleDir, indexPath: res.indexPath,
        syntheticScore: fin.winRate, usedFallback: res.usedFallback, warnings: res.warnings,
      });
    } catch (e) {
      failed.push({ conceptId: concept.id, reason: (e as Error).message });
    }
  }

  const manifest: SmokeExperiment = {
    category: categoryId,
    currency,
    builtAt,
    realMetric: "notify CTR",
    source: "smoke-test",
    unit: "concept",
    concepts: built.map((b) => ({
      conceptId: b.conceptId, name: b.name, syntheticScore: b.syntheticScore,
      slug: b.slug, pagePath: `${b.slug}/index.html`,
    })),
  };
  const manifestPath = `${outDir}/experiment.json`;
  await mkdir(outDir, { recursive: true });
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

  return { outDir, built, skipped, failed, manifestPath };
}
