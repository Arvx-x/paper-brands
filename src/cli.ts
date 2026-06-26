import { runTournament, runOptimize, formatReport } from "./pipeline/tournament.ts";
import { buildCategoryPack, savePack } from "./intel/market.ts";
import { harvest, corpusToEvidence, corpusProvenance, type Corpus } from "./scrape/harvest.ts";
import { loadConfig } from "./config.ts";
import type { Provenance } from "./categories/types.ts";
import { runCreativeFactory } from "./creative/pipeline.ts";
import { buildBrandKit, saveBrandKit, loadBrandKit } from "./creative/brandkit.ts";
import { researchCreatives } from "./creative/research.ts";
import { generateAsset } from "./creative/factory.ts";
import { readImage } from "./llm/imageClient.ts";
import { BrandConceptSchema } from "./brand/types.ts";

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

// Per-run model/provider overrides (applied before any loadConfig() call).
const modelOverride = arg("model");
const simOverride = arg("sim-model");
const providerOverride = arg("provider");
if (modelOverride) process.env.PB_MODEL = modelOverride;
if (simOverride) process.env.PB_SIM_MODEL = simOverride;
if (providerOverride) process.env.PB_DEFAULT_PROVIDER = providerOverride;

const cmd = process.argv[2];

switch (cmd) {
  case "tournament": {
    const out = await runTournament({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "4")),
      cohortSize: Number(arg("cohort", "40")),
      outDir: arg("out", "out"),
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
      cohortSize: Number(arg("cohort", "40")),
      outDir: arg("out", "out"),
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
    let sourceText: string | undefined;
    let priceBands: Corpus["price"]["bands"] | undefined;
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
      sourceText = (corpus.sources ?? []).filter((s) => s.fetched).map((s) => s.rawText).join("\n\n");
      priceBands = corpus.price.bands.length ? corpus.price.bands : undefined;
      provenance = corpusProvenance(corpus, { truncated: ev.truncated, model: loadConfig().model });
      console.error(
        `[intel] grounding in ${evidence.length} chars (${sourceText.length} raw quotable) + ${priceBands?.length ?? 0} price bands ` +
          `| confidence=${provenance.confidence}${provenance.degraded ? " (DEGRADED)" : ""} ` +
          `(${provenance.lensesSucceeded}/${provenance.lensesPlanned} lenses, ${provenance.independentDomains} indep domains, ${provenance.fetchedSources} fetched sources, ${provenance.skuCount} SKUs)`,
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
      sourceText,
      priceBands,
      provenance,
    });
    const path = await savePack(pack);
    const p = pack.provenance;
    console.log(
      `Generated CategoryPack '${pack.id}' (${pack.name}) -> ${path}\n` +
        `  confidence=${p?.confidence ?? "low"}${p?.degraded ? " ⚠DEGRADED" : ""} | grounded=${p?.grounded ?? false}\n` +
        `  attribution=${p ? Math.round((p.attributionRate ?? 0) * 100) : 0}% (${p?.attributedItems ?? 0}/${p?.totalItems ?? 0} claims quote-verified)\n` +
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
      outDir: arg("out"),
    });
    const mean = res.library.length
      ? res.library.reduce((s, i) => s + i.finalScore, 0) / res.library.length
      : 0;
    console.log(mean.toFixed(2));
    break;
  }

  default:
    console.log(
      `paper-brands\n\n` +
        `Usage:\n` +
        `  bun run intel       --category="..." --geo="..." --currency=INR\n` +
        `  bun run tournament  --category=lipcare --candidates=4 --cohort=40 --out=out\n` +
        `  bun run winrate     --category=lipcare --candidates=4 --cohort=40\n` +
        `  bun run optimize    --category=lipcare --candidates=3 --cohort=20 --rounds=5\n` +
        `  bun run creative    --category=lipcare --assets=ad-square,ad-story --research --rounds=3\n` +
        `  bun run creative    --concept=out/concept.json --dry   # no image credits\n` +
        `  bun run creative-gen --brand="<name>" --asset=ad-story --aspect=9:16 --purpose="..."\n\n` +
        `Overrides (any command): --model=openai:gpt-4o --sim-model=google:gemini-2.5-flash\n` +
        `Creative uses Gemini image models (PB_IMAGE_MODEL / PB_IMAGE_MODEL_PRO). --dry skips renders.`,
    );
}
