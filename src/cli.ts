import { runTournament, runOptimize, formatReport } from "./pipeline/tournament.ts";
import { runFoundry } from "./pipeline/foundry.ts";
import { buildCategoryPack, savePack } from "./intel/market.ts";
import { harvest, corpusToEvidence, corpusProvenance, type Corpus } from "./scrape/harvest.ts";
import { clusterCompetitors } from "./scrape/prices.ts";
import { loadConfig } from "./config.ts";
import type { Provenance } from "./categories/types.ts";
import { runCreativeFactory } from "./creative/pipeline.ts";
import { buildBrandKit, saveBrandKit, loadBrandKit } from "./creative/brandkit.ts";
import { researchCreatives } from "./creative/research.ts";
import { generateAsset } from "./creative/factory.ts";
import { optimizeStructure } from "./creative/metaOptimize.ts";
import { loadStructure } from "./creative/structure.ts";
import { readImage } from "./llm/imageClient.ts";
import { BrandConceptSchema } from "./brand/types.ts";
import { CalibrationStore } from "./calibration/store.ts";
import { calibrate, composeEquity } from "./calibration/calibrate.ts";
import type { CalibrationObservation } from "./calibration/types.ts";
import { buildExperiment } from "./smoketest/experiment.ts";
import { runLaunchpages } from "./launchpages/run.ts";
import { startServer } from "./server/server.ts";
import { writeExperiment, readExperiment } from "./smoketest/write.ts";
import { parseResultsCsv } from "./smoketest/results.ts";

/** Load identity/product reference images from a comma-separated --refs path list. */
async function loadRefs(spec?: string) {
  const paths = spec?.split(",").filter(Boolean) ?? [];
  const refs = await Promise.all(paths.map((p) => readImage(p).catch(() => null)));
  return refs.filter((b): b is NonNullable<typeof b> => b !== null);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}

function parseArenaMode(): "cheap" | "deep" | undefined {
  const raw = arg("mode");
  if (raw === undefined) return undefined;
  if (raw !== "cheap" && raw !== "deep") {
    console.error(`invalid --mode='${raw}'; expected cheap|deep`);
    process.exit(2);
  }
  const legacyDeep = arg("deep", "") === "true" || arg("deep", "") === "deep";
  if (legacyDeep) console.error(`note: --mode overrides legacy --deep`);
  return raw;
}

// Per-run model/provider overrides (applied before any loadConfig() call).
const modelOverride = arg("model");
const simOverride = arg("sim-model");
const providerOverride = arg("provider");
if (modelOverride) process.env.PB_MODEL = modelOverride;
if (simOverride) process.env.PB_SIM_MODEL = simOverride;
if (providerOverride) process.env.PB_DEFAULT_PROVIDER = providerOverride;

const cmd = process.argv[2];

switch (cmd) {
  case "foundry": {
    const artifact = await runFoundry({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "8")),
      finalists: Number(arg("finalists", "3")),
      cohortSize: Number(arg("cohort", "80")),
      seed: Number(arg("seed", "0")),
      outDir: arg("out", "out"),
    });
    console.log(
      `\nFoundry: ${artifact.categoryId} — spawned ${artifact.spawned}, advanced ${artifact.selected} (ranked by ${artifact.rankedBy})`,
    );
    for (const f of artifact.finalists) {
      const moat = f.moat ? `moat ${f.moat.overall.toFixed(2)}` : "moat n/a";
      console.log(
        `  ${f.rank}. ${f.concept.name.padEnd(20)} win-rate ${(f.winRate * 100).toFixed(1)}% ` +
          `[${(f.winRateCiLow * 100).toFixed(0)}-${(f.winRateCiHigh * 100).toFixed(0)}%]  ${moat}`,
      );
    }
    for (const w of artifact.warnings) console.log(`\u26a0 ${w}`);
    console.log(`Wrote ${arg("out", "out")}/finalists.json`);
    console.log(`Next: build landing pages for these ${artifact.selected} (creative step)`);
    break;
  }

  case "tournament": {
    const out = await runTournament({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "4")),
      cohortSize: Number(arg("cohort", "80")),
      outDir: arg("out", "out"),
      mode: parseArenaMode(),
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
      moat: flag("moat"),
      seed: Number(arg("seed", "0")),
      runs: Number(arg("runs", "1")),
    });
    console.log(formatReport(out));
    break;
  }

  // Autoresearch Verify hook: prints ONLY the best candidate win-rate (0..100)
  // as a single number on stdout, so an optimization loop can read it.
  case "winrate": {
    const out = await runTournament({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "4")),
      cohortSize: Number(arg("cohort", "80")),
      outDir: arg("out", "out"),
      mode: parseArenaMode(),
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
      seed: Number(arg("seed", "0")),
      runs: Number(arg("runs", "1")),
    });
    const wr = out.report.winner ? out.report.winner.winRate * 100 : 0;
    console.log(wr.toFixed(2));
    break;
  }

  case "optimize": {
    const res = await runOptimize({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "3")),
      cohortSize: Number(arg("cohort", "20")),
      rounds: Number(arg("rounds", "5")),
      outDir: arg("out", "out"),
    });
    console.log(
      `\nChampion: ${res.champion.name}\n` +
        `Win-rate: ${(res.startWinRate * 100).toFixed(1)}% -> ${(res.finalWinRate * 100).toFixed(1)}%\n` +
        `Accepted mutations: ${res.history.filter((h) => h.accepted).map((h) => h.mutation).join(", ") || "none"}`,
    );
    break;
  }

  // Autoresearch Verify hook for the optimizer: prints final win-rate delta.
  case "optimize-gain": {
    const res = await runOptimize({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "3")),
      cohortSize: Number(arg("cohort", "20")),
      rounds: Number(arg("rounds", "5")),
      outDir: arg("out", "out"),
    });
    console.log(((res.finalWinRate - res.startWinRate) * 100).toFixed(2));
    break;
  }

  case "harvest": {
    const category = arg("category");
    if (!category) throw new Error('harvest requires --category="..."');
    const corpus = await harvest({
      category,
      geography: arg("geo", "India"),
      currency: arg("currency", "INR"),
      lenses: arg("lenses")?.split(","),
      concurrency: Number(arg("concurrency", "3")),
    });
    const lensSummary = Object.entries(corpus.lenses)
      .map(([id, f]) => `${id}:${f.length}`)
      .join(" ");
    const bands = corpus.price.bands
      .map((b) => `${b.label} ${corpus.currency}${b.lowMinor / 100}-${b.highMinor / 100}`)
      .join(", ");
    console.log(
      `Harvested "${category}": ${corpus.citationCount} citations across lenses [${lensSummary}].\n` +
        `Price bands (from ${corpus.price.observations.length} real SKUs): ${bands || "n/a"}\n` +
        `Saved to data/${slugify(category)}/corpus.json\n` +
        `Next: bun run intel --category="${category}" --ground`,
    );
    break;
  }

  case "intel": {
    const category = arg("category");
    if (!category) throw new Error('intel requires --category="..."');

    // Grounding is ON by default (use --no-ground to generate from priors only).
    let evidence: string | undefined;
    let sources: { finalUrl: string; sourceClass: string; independent: boolean; rawText: string }[] | undefined;
    let priceBands: Corpus["price"]["bands"] | undefined;
    let observations: Corpus["price"]["observations"] | undefined;
    let marketSignal: string | undefined;
    let competitorClusters: ReturnType<typeof clusterCompetitors> | undefined;
    let provenance: Provenance | undefined;
    if (!flag("no-ground")) {
      const geo = arg("geo", "India");
      const path = `data/${slugify(category)}/corpus.json`;
      let corpus: Corpus | null = null;
      try {
        corpus = (await Bun.file(path).json()) as Corpus;
      } catch {
        console.error(`[intel] no corpus at ${path}; harvesting now...`);
        corpus = await harvest({ category, geography: geo, currency: arg("currency", "INR") });
      }
      const ev = corpusToEvidence(corpus);
      evidence = ev.text;
      sources = (corpus.sources ?? [])
        .filter((s) => s.fetched)
        .map((s) => ({ finalUrl: s.finalUrl, sourceClass: s.sourceClass, independent: s.independent, rawText: s.rawText }));
      priceBands = corpus.price.bands.length ? corpus.price.bands : undefined;
      observations = corpus.price.observations;
      // Real market-structure signal to ground segment weights (supply-proxy).
      const tierStr = corpus.price.buckets.map((b) => `${b.label} ${Math.round(b.share * 100)}%`).join(", ");
      const subCounts: Record<string, number> = {};
      for (const o of corpus.price.observations) {
        const t = (o.subtype || "").toLowerCase().trim();
        if (t) subCounts[t] = (subCounts[t] ?? 0) + 1;
      }
      const subTotal = Object.values(subCounts).reduce((a, b) => a + b, 0);
      const subStr = Object.entries(subCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, n]) => `${k} ${Math.round((n / subTotal) * 100)}%`)
        .join(", ");
      marketSignal = `price tiers: ${tierStr || "n/a"}${subStr ? `; subtypes observed: ${subStr}` : ""}`;
      competitorClusters = clusterCompetitors(corpus.price.observations, corpus.price.buckets);
      provenance = corpusProvenance(corpus, { truncated: ev.truncated, model: loadConfig().model });
      console.error(
        `[intel] grounding in ${evidence.length} chars + ${sources.length} fetched sources (${sources.filter((s) => s.independent).length} independent) + ${priceBands?.length ?? 0} price bands ` +
          `| confidence=${provenance.confidence}${provenance.degraded ? " (DEGRADED)" : ""} ` +
          `(${provenance.lensesSucceeded}/${provenance.lensesPlanned} lenses, ${provenance.independentDomains} indep domains, ${provenance.skuCount} SKUs)`,
      );
    } else {
      console.error(`[intel] ⚠ --no-ground: generating from model priors only (confidence will be 'low').`);
    }

    const pack = await buildCategoryPack({
      category,
      geography: arg("geo", "India (D2C + marketplaces)")!,
      currency: arg("currency", "INR")!,
      channel: arg("channel"),
      priceAmbition: arg("ambition"),
      notes: arg("notes"),
      evidence,
      sources,
      priceBands,
      observations,
      marketSignal,
      competitorClusters,
      provenance,
    });
    const path = await savePack(pack);
    const p = pack.provenance;
    console.log(
      `Generated CategoryPack '${pack.id}' (${pack.name}) -> ${path}\n` +
        `  confidence=${p?.confidence ?? "low"}${p?.degraded ? " ⚠DEGRADED" : ""} | grounded=${p?.grounded ?? false}\n` +
        `  attribution=${p ? Math.round((p.attributionRate ?? 0) * 100) : 0}% (${p?.attributedItems ?? 0}/${p?.totalItems ?? 0} claims quote-verified) | ` +
        `customer-voice ${p?.independentItems ?? 0}/${p?.attributedItems ?? 0} from independent sources\n` +
        `  ${pack.competitorArchetypes.length} competitor archetypes, ` +
        `${pack.buyerSegments.length} buyer segments, ` +
        `${pack.unmetNeeds.length} unmet / ${pack.wellMetNeeds.length} well-met needs.\n` +
        (p?.degraded
          ? `  ⚠ Evidence is thin/degraded — treat this pack as directional only.\n`
          : "") +
        `Run it: bun run tournament --category=${pack.id} --candidates=4 --cohort=40`,
    );
    break;
  }

  // ── Creative Factory ──────────────────────────────────────────────────────

  // Full creative loop: concept -> [research] -> BrandKit -> [identity] ->
  // brief -> spec -> render -> jury -> hill-climb -> library. Renders for real
  // unless --dry (judges the prompt instead, no image credits spent).
  case "creative": {
    // Use the meta-optimized structure when --use-structure is passed (or a version is given).
    const sv = arg("structure-version");
    const structure =
      flag("use-structure") || sv
        ? (await loadStructure(sv ? Number(sv) : "active")) ?? undefined
        : undefined;
    if (structure) console.error(`[creative] using structure v${structure.version}`);
    const res = await runCreativeFactory({
      categoryId: arg("category"),
      conceptPath: arg("concept"),
      assetTypes: arg("assets")?.split(","),
      perType: Number(arg("per-type", "1")),
      rounds: Number(arg("rounds", "3")),
      bestOf: Number(arg("best-of", "2")),
      imageSize: arg("image-size"),
      research: flag("research"),
      identity: !flag("no-identity"),
      dry: flag("dry"),
      candidates: Number(arg("candidates", "3")),
      cohortSize: Number(arg("cohort", "20")),
      geography: arg("geo"),
      structure,
      outDir: arg("out"),
    });
    console.log(
      `\nCreative library for ${res.brandName} -> ${res.outDir}\n` +
        res.library
          .map(
            (i) =>
              `  ${i.rendered.spec.assetType.padEnd(14)} ${i.startScore.toFixed(1)} -> ${i.finalScore.toFixed(1)}  ${i.rendered.imagePath}`,
          )
          .join("\n") +
        `\nReport: ${res.outDir}/library.md`,
    );
    break;
  }

  // Build (or rebuild) just the BrandKit for a saved concept JSON.
  case "brandkit": {
    const conceptPath = arg("concept");
    if (!conceptPath) throw new Error('brandkit requires --concept="<path-to-concept.json>"');
    const concept = BrandConceptSchema.parse(await Bun.file(conceptPath).json());
    const research = flag("research")
      ? await researchCreatives(concept, arg("category", concept.heroSku)!)
      : undefined;
    const kit = await buildBrandKit(concept, research);
    const path = await saveBrandKit(kit);
    console.log(
      `BrandKit for ${kit.brandName} -> ${path}\n` +
        `  palette: ${kit.palette.map((p) => p.hex).join(" ")}\n` +
        `  mood: ${kit.moodKeywords.join(", ")}`,
    );
    break;
  }

  // On-demand: generate ANY asset at ANY dimension from a saved BrandKit.
  case "creative-gen": {
    const brand = arg("brand");
    if (!brand) throw new Error('creative-gen requires --brand="<brand name or slug>"');
    const kit = await loadBrandKit(brand);
    if (!kit) throw new Error(`No saved BrandKit for "${brand}". Run \`creative\` or \`brandkit\` first.`);
    const refs = (await Promise.all(
      (arg("refs")?.split(",") ?? []).map((p) => readImage(p).catch(() => null)),
    )).filter((b): b is NonNullable<typeof b> => b !== null);
    const { rendered, verdict } = await generateAsset({
      kit,
      assetType: arg("asset", "ad-square")!,
      purpose: arg("purpose", "on-brand creative")!,
      aspect: arg("aspect"),
      audience: arg("audience"),
      channel: arg("channel"),
      refImages: refs.length ? refs : undefined,
      optimize: flag("optimize"),
      rounds: Number(arg("rounds", "3")),
      bestOf: Number(arg("best-of", "2")),
      dry: flag("dry"),
      outDir: arg("out", `out/creatives/${slugify(brand)}`)!,
    });
    console.log(`Generated ${rendered.spec.assetType} (score ${verdict.overall.toFixed(1)}) -> ${rendered.imagePath}`);
    break;
  }

  // Autoresearch Verify hook: prints the mean final creative score (0..100).
  case "creative-score": {
    const res = await runCreativeFactory({
      categoryId: arg("category"),
      conceptPath: arg("concept"),
      assetTypes: arg("assets")?.split(","),
      rounds: Number(arg("rounds", "3")),
      identity: !flag("no-identity"),
      dry: flag("dry"),
      geography: arg("geo"),
      outDir: arg("out"),
    });
    const mean = res.library.length
      ? res.library.reduce((s, i) => s + i.finalScore, 0) / res.library.length
      : 0;
    console.log(mean.toFixed(2));
    break;
  }

  // Meta-optimize the GENERATION STRUCTURE itself (autonomous hill-climb).
  // Renders a small fixed eval set under each candidate structure, scores with
  // the jury, keeps a version only if it beats the champion by a margin. The
  // winner is saved to structures/active.json for `creative --use-structure`.
  case "structure-optimize": {
    const conceptPath = arg("concept");
    if (!conceptPath) throw new Error('structure-optimize requires --concept="<path-to-concept.json>"');
    const concept = BrandConceptSchema.parse(await Bun.file(conceptPath).json());
    const research = flag("research")
      ? await researchCreatives(concept, arg("category", concept.heroSku)!)
      : undefined;
    const kit = await buildBrandKit(concept, research, undefined, arg("geo"));
    await saveBrandKit(kit);
    const refImages = await loadRefs(arg("refs"));
    const start = arg("from-version") ? await loadStructure(Number(arg("from-version"))) : undefined;

    const res = await optimizeStructure({
      kit,
      refImages: refImages.length ? refImages : undefined,
      evalAssets: arg("assets")?.split(","),
      rounds: Number(arg("rounds", "3")),
      variantsPerRound: Number(arg("variants", "2")),
      startStructure: start ?? undefined,
      dry: flag("dry"),
    });
    console.log(
      `\nStructure optimization: v${res.champion.version} wins.\n` +
        `Score: ${res.startScore.toFixed(1)} -> ${res.finalScore.toFixed(1)}\n` +
        res.history
          .map((h) => `  round ${h.round}: ${h.championScore.toFixed(1)} vs ${h.challengerScore.toFixed(1)} ${h.accepted ? "ACCEPT" : "keep"} — ${h.changelog}`)
          .join("\n") +
        `\nActive structure saved -> structures/active.json (use: bun run creative --use-structure ...)`,
    );
    break;
  }

  case "calibrate-record": {
    const category = arg("category");
    const synthetic = Number(arg("synthetic", "NaN"));
    const real = Number(arg("real", "NaN"));
    if (!category || !Number.isFinite(synthetic) || !Number.isFinite(real)) {
      console.error("usage: calibrate-record --category=<c> --synthetic=0..1 --real=0..1 [--source=] [--unit=] [--metric=] [--label=] [--equity=] [--equity-search=] [--equity-distribution=] [--equity-social=] [--notes=]");
      process.exit(2);
    }
    const equityComponents = {
      search: arg("equity-search") !== undefined ? Number(arg("equity-search")) : undefined,
      distribution: arg("equity-distribution") !== undefined ? Number(arg("equity-distribution")) : undefined,
      social: arg("equity-social") !== undefined ? Number(arg("equity-social")) : undefined,
    };
    const equityScore = arg("equity") !== undefined ? Number(arg("equity")) : composeEquity(equityComponents);
    const obs: CalibrationObservation = {
      id: arg("id", `${slugify(arg("label", "obs")!)}-${Date.now()}`)!,
      category,
      syntheticScore: synthetic,
      realOutcome: real,
      equityScore,
      equityComponents: Object.values(equityComponents).some((v) => v !== undefined) ? equityComponents : undefined,
      source: (arg("source", "manual") as CalibrationObservation["source"]),
      unit: (arg("unit", "concept") as CalibrationObservation["unit"]),
      label: arg("label", "obs")!,
      realMetric: arg("metric", "landing CTR")!,
      recordedAt: new Date().toISOString(),
      notes: arg("notes"),
    };
    try {
      await new CalibrationStore(category).record(obs);
      console.log(`recorded ${obs.id} (${category}): synthetic=${synthetic} real=${real}${equityScore !== undefined ? ` equity=${equityScore.toFixed(3)}` : ""}`);
    } catch (e) {
      console.error(`record rejected: ${(e as Error).message}`);
      process.exit(2);
    }
    break;
  }

  case "calibrate-status": {
    const category = arg("category");
    if (!category) { console.error("usage: calibrate-status --category=<c>"); process.exit(2); }
    const r = await calibrate(category, Number(arg("synthetic", "0.5")));
    const eq = r.equityStatus === "learned" ? "learned" : "not-learned";
    console.log(
      `n=${r.n} | method=${r.method} | R\u00b2=${(r.r2 ?? 0).toFixed(2)} | ` +
        `rmse=${r.residualRmse === null ? "n/a" : r.residualRmse.toFixed(3)} | status=${r.status} | equity=${eq}` +
        (r.warnings.length ? ` | warnings: ${r.warnings.join(",")}` : ""),
    );
    break;
  }

  case "smoketest-build": {
    const category = arg("category");
    if (!category) {
      console.error("usage: smoketest-build --category=<c> [--tournament=out/tournament.json] [--currency=INR] [--out=data]");
      process.exit(2);
    }
    const tournamentPath = arg("tournament", "out/tournament.json")!;
    let tournament: any;
    try {
      tournament = await Bun.file(tournamentPath).json();
    } catch {
      console.error(`smoketest-build: cannot read tournament JSON at ${tournamentPath}`);
      process.exit(2);
    }
    let experiment;
    try {
      experiment = buildExperiment(tournament, arg("currency", "INR"));
    } catch (e) {
      console.error(`smoketest-build: ${(e as Error).message}`);
      process.exit(2);
    }
    const { dir, pages } = await writeExperiment(experiment, tournament.concepts ?? [], arg("out", "data"));
    console.log(
      `Built smoke-test experiment for '${experiment.category}' -> ${dir}\n` +
        `  ${pages} notify-me PDP pages, manifest + results-template.csv\n` +
        `  Next: run traffic, fill the CSV, then bun run smoketest:import --category=${category} --csv=<path>`,
    );
    break;
  }

  case "smoketest-import": {
    const category = arg("category");
    const csvPath = arg("csv");
    if (!category || !csvPath) {
      console.error("usage: smoketest-import --category=<c> --csv=<path> [--out=data]");
      process.exit(2);
    }
    const baseDir = arg("out", "data");
    const experiment = await readExperiment(category, baseDir);
    if (!experiment) {
      console.error(`smoketest-import: no experiment.json for '${category}'; run smoketest-build first`);
      process.exit(2);
    }
    let csvText: string;
    try {
      csvText = await Bun.file(csvPath).text();
    } catch {
      console.error(`smoketest-import: cannot read CSV at ${csvPath}`);
      process.exit(2);
    }
    let parsed;
    try {
      parsed = parseResultsCsv(experiment, csvText, new Date().toISOString());
    } catch (e) {
      console.error(`smoketest-import: ${(e as Error).message}`);
      process.exit(2);
    }
    // CalibrationStore always writes to default "data" root (not --out) so calibrate:status can read it.
    const store = new CalibrationStore(category);
    for (const obs of parsed.observations) await store.record(obs);
    console.log(`recorded ${parsed.observations.length} / skipped ${parsed.skipped.length}`);
    for (const s of parsed.skipped) console.log(`  skip ${s.conceptId}: ${s.reason}`);
    console.log(`Calibration observations written to data/${category}/calibration.json (default root, independent of --out).`);
    console.log(`Next: bun run calibrate:status --category=${category}`);
    break;
  }

  case "serve": {
    startServer(Number(arg("port", "4317")));
    break;
  }

  case "launchpages": {
    const res = await runLaunchpages({
      finalistsPath: arg("finalists", "out/finalists.json"),
      outDir: arg("out", "out/launchpages"),
      rounds: Number(arg("rounds", "2")),
      bestOf: Number(arg("best-of", "2")),
      currency: arg("currency", "INR"),
    });
    console.log(`\nLaunchpages \u2192 ${res.outDir}`);
    for (const b of res.built) console.log(`  \u2713 ${b.name.padEnd(20)} \u2192 ${b.indexPath}${b.usedFallback ? "  (\u26a0 page fallback)" : ""}`);
    for (const s of res.skipped) console.log(`  \u21b7 ${s} (skipped \u2014 already built)`);
    for (const f of res.failed) console.log(`  \u2717 ${f.conceptId} (failed: ${f.reason})`);
    console.log(`Wrote ${res.manifestPath} (${res.built.length} concepts)`);
    console.log(`Next: deploy the bundles, run traffic, then bun run smoketest:import --category=<c> --csv=<results>`);
    break;
  }

  default:
    console.log(
      `paper-brands\n\n` +
        `Usage:\n` +
        `  bun run intel       --category="..." --geo="..." --currency=INR\n` +
        `  bun run tournament  --category=lipcare --candidates=4 --cohort=40 --out=out [--mode=cheap|deep] [--moat]\n` +
        `  bun run foundry     --category=lipcare --candidates=8 --finalists=3 --cohort=80\n` +
        `  bun run launchpages --finalists=out/finalists.json --out=out/launchpages\n` +
        `  bun run serve       [--port=4317]\n` +
        `  bun run winrate     --category=lipcare --candidates=4 --cohort=40\n` +
        `  bun run optimize    --category=lipcare --candidates=3 --cohort=20 --rounds=5\n` +
        `  bun run creative    --category=lipcare --assets=ad-square,ad-story --research --rounds=3\n` +
        `  bun run creative    --concept=out/concept.json --use-structure --dry\n` +
        `  bun run creative-gen --brand="<name>" --asset=ad-story --aspect=9:16 --purpose="..."\n` +
        `  bun run src/cli.ts structure-optimize --concept=out/concept.json --geo=India --rounds=2 --variants=2\n\n` +
        `Overrides (any command): --model=openai:gpt-4o --sim-model=google:gemini-2.5-flash\n` +
        `Creative uses Gemini image models (PB_IMAGE_MODEL / PB_IMAGE_MODEL_PRO). --dry skips renders.`,
    );
}
