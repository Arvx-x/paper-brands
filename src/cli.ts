import { runTournament, runOptimize, formatReport } from "./pipeline/tournament.ts";
import { buildCategoryPack, savePack } from "./intel/market.ts";
import { harvest, corpusToEvidence, type Corpus } from "./scrape/harvest.ts";

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
      resultsPerQuery: Number(arg("results", "10")),
      pagesToFetch: Number(arg("pages", "25")),
      concurrency: Number(arg("concurrency", "5")),
    });
    const withText = corpus.docs.filter((d) => d.text).length;
    console.log(
      `Harvested ${corpus.docs.length} docs (${withText} with full text) for "${category}".\n` +
        `Saved to data/${slugify(category)}/corpus.json\n` +
        `Next: bun run intel --category="${category}" --ground`,
    );
    break;
  }

  case "intel": {
    const category = arg("category");
    if (!category) throw new Error('intel requires --category="..."');

    let evidence: string | undefined;
    if (flag("ground")) {
      const geo = arg("geo", "India");
      const path = `data/${slugify(category)}/corpus.json`;
      let corpus: Corpus | null = null;
      try {
        corpus = (await Bun.file(path).json()) as Corpus;
      } catch {
        console.error(`[intel] no corpus at ${path}; harvesting now...`);
        corpus = await harvest({ category, geography: geo });
      }
      evidence = corpusToEvidence(corpus);
      console.error(`[intel] grounding in ${evidence.length} chars of evidence`);
    }

    const pack = await buildCategoryPack({
      category,
      geography: arg("geo", "India (D2C + marketplaces)")!,
      currency: arg("currency", "INR")!,
      channel: arg("channel"),
      priceAmbition: arg("ambition"),
      notes: arg("notes"),
      evidence,
    });
    const path = await savePack(pack);
    console.log(
      `Generated CategoryPack '${pack.id}' (${pack.name}) -> ${path}\n` +
        `  ${pack.competitorArchetypes.length} competitor archetypes, ` +
        `${pack.buyerSegments.length} buyer segments, ` +
        `${pack.unmetNeeds.length} unmet needs.\n` +
        `Run it: bun run tournament --category=${pack.id} --candidates=4 --cohort=40`,
    );
    break;
  }

  default:
    console.log(
      `paper-brands\n\n` +
        `Usage:\n` +
        `  bun run intel       --category="..." --geo="..." --currency=INR\n` +
        `  bun run tournament  --category=lipcare --candidates=4 --cohort=40 --out=out\n` +
        `  bun run winrate     --category=lipcare --candidates=4 --cohort=40\n` +
        `  bun run optimize    --category=lipcare --candidates=3 --cohort=20 --rounds=5\n\n` +
        `Overrides (any command): --model=openai:gpt-4o --sim-model=google:gemini-2.5-flash\n` +
        `winrate prints only the best candidate's win-rate (0..100) for autoresearch.`,
    );
}
