import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import { renderPdpPage } from "../smoketest/page.ts";
import { codePage } from "./code.ts";
import { injectNotifyCta } from "./cta.ts";
import { bundleAssets } from "./bundle.ts";
import type { CreativeAssets, BuildLandingPageOptions, LandingPageResult } from "./types.ts";

export async function buildLandingPage(
  concept: BrandConcept,
  assets: CreativeAssets,
  llm: LLMClient,
  opts: BuildLandingPageOptions,
): Promise<LandingPageResult> {
  const warnings: string[] = [];
  let usedFallback = false;

  let html: string;
  try {
    html = await codePage(concept, assets, llm, opts.model ?? "gemini-3.1-flash");
  } catch (e) {
    usedFallback = true;
    warnings.push(`LLM page-code failed, used fallback renderPdpPage: ${(e as Error).message}`);
    html = renderPdpPage(concept, { experimentId: opts.experimentId, currency: opts.currency ?? "INR" });
  }

  const injected = injectNotifyCta(html, { conceptId: concept.id, experimentId: opts.experimentId });
  const bundle = await bundleAssets(injected.html, assets, opts.outDir);

  return {
    dir: opts.outDir,
    indexPath: `${opts.outDir}/index.html`,
    assetsCopied: bundle.assetsCopied,
    ctaInjected: injected.mode,
    usedFallback,
    warnings: [...warnings, ...bundle.warnings],
  };
}
