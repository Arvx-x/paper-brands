import { runFoundry as realRunFoundry } from "../pipeline/foundry.ts";
import { runLaunchpages as realRunLaunchpages } from "../launchpages/run.ts";
import { harvest as realHarvest } from "../scrape/harvest.ts";
import { buildCategoryPack as realBuildCategoryPack, savePack } from "../intel/market.ts";
import { corpusToEvidence, corpusProvenance } from "../scrape/harvest.ts";
import { clusterCompetitors } from "../scrape/prices.ts";
import { loadConfig } from "../config.ts";
import type { EmitInput } from "./events.ts";
import type { UserIntel } from "../userdata/types.ts";
import { voicesToSources, skusToObservations, mergeObservations, applyOverrides, competitorsToHints } from "../userdata/merge.ts";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface FoundryPipelineDeps {
  harvest?: typeof realHarvest;
  buildCategoryPack?: typeof realBuildCategoryPack;
  runFoundry?: typeof realRunFoundry;
  runLaunchpages?: typeof realRunLaunchpages;
}

export async function runFoundryPipeline(
  category: string,
  onEvent: (e: EmitInput) => void,
  deps: FoundryPipelineDeps = {},
  cohortSize = 80,
  userIntel?: UserIntel,
): Promise<void> {
  const doHarvest = deps.harvest ?? realHarvest;
  const doBuildPack = deps.buildCategoryPack ?? realBuildCategoryPack;
  const runFoundry = deps.runFoundry ?? realRunFoundry;
  const runLaunchpages = deps.runLaunchpages ?? realRunLaunchpages;

  onEvent({ type: "run-started", category });
  try {
    // ── HARVEST ──
    onEvent({ type: "stage", stage: "harvest", status: "start" });
    const corpus = await doHarvest({ category, geography: "India", currency: "INR", onEvent: onEvent as any });
    onEvent({ type: "stage", stage: "harvest", status: "done", note: `${corpus.citationCount} citations` });

    // ── INTEL ──
    onEvent({ type: "stage", stage: "intel", status: "start" });
    const ev = corpusToEvidence(corpus);
    const harvestedSources = (corpus.sources ?? []).filter((s) => s.fetched).map((s) => ({ finalUrl: s.finalUrl, sourceClass: s.sourceClass, independent: s.independent, rawText: s.rawText }));
    // User voices prepended as first-party independent sources.
    const sources = userIntel?.voices.length
      ? [...voicesToSources(userIntel.voices), ...harvestedSources]
      : harvestedSources;
    // User SKUs merged into observations (user wins on conflict).
    const { merged: observations } = userIntel?.skus.length
      ? mergeObservations(corpus.price.observations, skusToObservations(userIntel.skus))
      : { merged: corpus.price.observations };
    const priceBands = corpus.price.bands.length ? corpus.price.bands : undefined;
    const competitorClusters = clusterCompetitors(observations, corpus.price.buckets);
    const provenance = corpusProvenance(corpus, { truncated: ev.truncated, model: loadConfig().model });
    const notes = userIntel?.competitors.length ? competitorsToHints(userIntel.competitors) : undefined;
    const builtPack = await doBuildPack(
      { category, geography: "India (D2C + marketplaces)", currency: "INR", evidence: ev.text, sources, priceBands, observations, competitorClusters, provenance, notes },
      undefined,
      onEvent as any,
    );
    // Apply hard overrides AFTER build; priceBands override wins over recomputed bands.
    const { pack, applied } = userIntel
      ? applyOverrides(builtPack, userIntel.overrides)
      : { pack: builtPack, applied: [] as string[] };
    // Stamp honesty fields onto provenance.
    if (pack.provenance) {
      pack.provenance.userVoices = userIntel?.voices.length ?? 0;
      pack.provenance.userSkus = userIntel?.skus.length ?? 0;
      pack.provenance.overridesApplied = applied;
    }
    const packPath = await savePack(pack);
    onEvent({ type: "stage", stage: "intel", status: "done", note: packPath });

    // ── FOUNDRY (arena + creative + pages) ──
    await runFoundry({ categoryId: pack.id, candidates: 8, cohortSize, onEvent });
    const lp = await runLaunchpages({ onEvent });
    const pageUrls = (lp.built ?? []).map((b: any) => ({
      name: b.name,
      url: "/" + String(b.indexPath).replace(/^\.?\//, ""),
    }));
    onEvent({ type: "run-complete", pageUrls });
  } catch (e) {
    onEvent({ type: "run-error", message: (e as Error).message });
  }
}
