# Launchpages Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `launchpages` command that reads `out/finalists.json` and, per finalist (sequential/resumable/fail-isolated), produces optimized brand assets (logo, packaging, product shot), builds a smoke-test-instrumented landing page, and writes a `SmokeExperiment` manifest.

**Architecture:** New `src/launchpages/` module — pure `deriveLiteKit` (minimal valid BrandKit) + pure `productSpec` (product-hero CreativeSpec) + `runLaunchpages` orchestrator with injectable deps (`readFinalists`, `generateIdentity`, `optimizeCreative`, `buildLandingPage`, `imageClient`, `llm`) so it's fully unit-testable without real renders/LLM. Reuses the existing creative optimizer + landing-page builder + smoke-test schema.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`, `Bun.write`/`Bun.file`, `node:fs/promises`). Reuses `generateIdentity`, `optimizeCreative`, `buildLandingPage`, `SmokeExperiment`, `Finalist`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-launchpages-orchestrator-design.md`

---

## File Structure

- Create `src/launchpages/types.ts` — `LaunchpagesOptions`, `BuiltPage`, `LaunchpagesResult`, `LaunchpagesDeps`.
- Create `src/launchpages/kit.ts` — `deriveLiteKit(concept)` (pure).
- Create `src/launchpages/spec.ts` — `productSpec(kit)` (pure).
- Create `src/launchpages/run.ts` — `runLaunchpages(opts, deps?)` (orchestrator) + local `slugify`.
- Create `src/launchpages/*.test.ts`.
- Modify `src/cli.ts` — `launchpages` verb.
- Modify `package.json` — `launchpages` script.

Verified facts:
- `BrandKit` required fields (from `src/creative/types.ts`): `brandId, brandName, essence, palette: {name,hex,role}[], typography: {headingMood,bodyMood,pairing}, artDirection, casting, moodKeywords: string[], logoDirection, packagingDirection, voice: {tone, doSay: string[], dontSay: string[]}, visualDos: string[], visualDonts: string[], negativePrompt: string, competitiveNotes: string[]`.
- `CreativeSpec` required fields: `id, briefId, assetType, aspect, headline, layout, imagePrompt` (the rest default). `ASSET_PRESETS["product-hero"]` = `{ aspect: "1:1", note: "studio product shot, premium lighting, clean backdrop" }`.
- `generateIdentity(kit, { outDir, dry?, structure?, imageClient?, llm? }): Promise<{ logo: {imagePath}, packaging: {imagePath}, refImages: ImageBlob[] }>`.
- `optimizeCreative({ kit, spec, rounds, bestOf?, refImages?, outDir, dry?, llm?, imageClient? }): Promise<{ champion: {imagePath}, ... }>`.
- `buildLandingPage(concept, assets: CreativeAssets, llm, opts: {outDir, experimentId?, model?, currency?}): Promise<LandingPageResult{indexPath, usedFallback, warnings, ...}>` from `src/launchpage/build.ts`.
- `Finalist` = `{ rank, concept: BrandConcept, winRate, ... }`; `FinalistsArtifact` = `{ categoryId, ..., finalists: Finalist[] }` written to `out/finalists.json`.
- `SmokeExperiment` = `{ category, currency, builtAt, realMetric:"notify CTR", source:"smoke-test", unit:"concept", concepts: {conceptId,name,syntheticScore,slug,pagePath}[] }` from `src/smoketest/types.ts`.
- CLI: `switch(process.argv[2])`, `arg(name,def?)`, `flag(name)`. Tests: `import { test, expect } from "bun:test";`, run `bun test`.

---

## Task 1: Types + pure `deriveLiteKit`

**Files:**
- Create: `src/launchpages/types.ts`
- Create: `src/launchpages/kit.ts`
- Test: `src/launchpages/kit.test.ts`

- [ ] **Step 1: Write `src/launchpages/types.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";

export interface LaunchpagesOptions {
  finalistsPath?: string;
  outDir?: string;
  experimentId?: string;
  pageModel?: string;
  rounds?: number;
  bestOf?: number;
  currency?: string;
}

export interface BuiltPage {
  conceptId: string;
  name: string;
  slug: string;
  bundleDir: string;
  indexPath: string;
  syntheticScore: number;
  usedFallback: boolean;
  warnings: string[];
}

export interface LaunchpagesResult {
  outDir: string;
  built: BuiltPage[];
  skipped: string[];
  failed: { conceptId: string; reason: string }[];
  manifestPath: string;
}
```

- [ ] **Step 2: Write failing tests `src/launchpages/kit.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { deriveLiteKit } from "./kit.ts";
import { BrandKitSchema } from "../creative/types.ts";

function concept(over: Partial<any> = {}) {
  return { id: "C1", name: "Heritage Balm", positioning: "traditional Indian ingredients, premium hydration",
    targetCustomer: "young Indians", coreInsight: "cultural authenticity matters", productPromise: "nourish",
    heroSku: "Heritage Balm 10g", priceMinor: 49900, priceBand: "premium", tagline: "Embrace heritage",
    claims: ["natural"], packagingDirection: "x", brandVoice: "warm and rooted", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [], ...over } as any;
}

test("produces a schema-valid BrandKit", () => {
  const kit = deriveLiteKit(concept());
  expect(() => BrandKitSchema.parse(kit)).not.toThrow();
});

test("brandName from concept, palette has real hex, voice.tone from brandVoice", () => {
  const kit = deriveLiteKit(concept());
  expect(kit.brandName).toBe("Heritage Balm");
  expect(kit.palette.length).toBeGreaterThanOrEqual(3);
  for (const sw of kit.palette) expect(sw.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(kit.voice.tone).toContain("warm");
});

test("deterministic: same concept -> identical kit", () => {
  expect(JSON.stringify(deriveLiteKit(concept()))).toBe(JSON.stringify(deriveLiteKit(concept())));
});

test("missing brandVoice -> sane default tone", () => {
  const kit = deriveLiteKit(concept({ brandVoice: "" }));
  expect(kit.voice.tone.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/kit.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/launchpages/kit.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { BrandKit } from "../creative/types.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A minimal, schema-valid BrandKit derived deterministically from the concept (no LLM council). */
export function deriveLiteKit(concept: BrandConcept): BrandKit {
  const premium = (concept.priceBand ?? "").toLowerCase().includes("premium");
  const accent = premium ? "#7c5cff" : "#1d9bf0";
  const moodWords = (concept.positioning + " " + concept.coreInsight)
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 4).slice(0, 5);

  return {
    brandId: slug(concept.id || concept.name),
    brandName: concept.name,
    essence: concept.tagline || concept.positioning,
    palette: [
      { name: "Ink", hex: "#171411", role: "primary" },
      { name: "Paper", hex: "#faf7f2", role: "background" },
      { name: "Accent", hex: accent, role: "accent" },
      { name: "Mute", hex: "#6b6258", role: "neutral" },
    ],
    typography: { headingMood: "modern, confident", bodyMood: "clean, readable", pairing: "grotesque + humanist serif" },
    artDirection: `Clean premium D2C product photography for ${concept.name}; ${concept.positioning}`,
    casting: "",
    moodKeywords: moodWords.length ? moodWords : ["clean", "premium"],
    logoDirection: `Clean wordmark for "${concept.name}", ${premium ? "premium and refined" : "approachable and bright"}`,
    packagingDirection: concept.packagingDirection || `Retail-ready packaging for ${concept.heroSku}, brand colors, clear hierarchy`,
    voice: { tone: concept.brandVoice || "warm, clear, confident", doSay: [], dontSay: [] },
    visualDos: ["realistic product detail", "consistent brand color", "clean composition"],
    visualDonts: ["AI artifacts", "warped text", "stocky cliche"],
    negativePrompt: "blurry, distorted text, watermark, extra fingers, low quality",
    competitiveNotes: [],
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/kit.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpages/types.ts src/launchpages/kit.ts src/launchpages/kit.test.ts
git commit -m "feat(launchpages): types + pure deriveLiteKit (schema-valid minimal BrandKit)"
```

---

## Task 2: pure `productSpec`

**Files:**
- Create: `src/launchpages/spec.ts`
- Test: `src/launchpages/spec.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpages/spec.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { productSpec } from "./spec.ts";
import { deriveLiteKit } from "./kit.ts";
import { CreativeSpecSchema } from "../creative/types.ts";

function concept() {
  return { id: "C1", name: "Heritage Balm", positioning: "premium", targetCustomer: "x", coreInsight: "x",
    productPromise: "nourish", heroSku: "Heritage Balm 10g", priceMinor: 49900, priceBand: "premium",
    tagline: "t", claims: [], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] } as any;
}

test("produces a schema-valid product-hero CreativeSpec", () => {
  const spec = productSpec(deriveLiteKit(concept()));
  expect(() => CreativeSpecSchema.parse(spec)).not.toThrow();
  expect(spec.assetType).toBe("product-hero");
  expect(spec.aspect).toBe("1:1");
  expect(spec.imagePrompt.length).toBeGreaterThan(0);
  expect(spec.id).toBe("product");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/spec.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpages/spec.ts`**

```typescript
import type { BrandKit, CreativeSpec } from "../creative/types.ts";

/** A product-shot spec the creative optimizer will refine to real-brand quality. */
export function productSpec(kit: BrandKit): CreativeSpec {
  return {
    id: "product",
    briefId: "launchpage-product",
    assetType: "product-hero",
    aspect: "1:1",
    headline: kit.brandName,
    subhead: "",
    cta: "",
    layout: "Centered hero product on a clean brand-colored surface, generous negative space.",
    imagePrompt:
      `Studio product shot of ${kit.brandName} — premium lighting, clean backdrop in brand colors, ` +
      `realistic packaging detail, retail-ready, photographic, high fidelity. ${kit.artDirection}`,
    direction: {},
    subject: `${kit.brandName} hero product`,
    camera: "product shot, 50mm, slight top-down, shallow depth of field",
    lighting: "soft key + gentle fill, premium studio",
    colorGrade: "brand palette emphasis, natural contrast",
    composition: "centered, rule-of-thirds, generous negative space",
    texture: "realistic material finish",
    mood: "premium, trustworthy",
    typographyTreatment: "",
    negativePrompt: "",
    rationale: "",
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/spec.test.ts`
Expected: PASS (1).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpages/spec.ts src/launchpages/spec.test.ts
git commit -m "feat(launchpages): pure productSpec (product-hero CreativeSpec)"
```

---

## Task 3: `runLaunchpages` orchestrator

**Files:**
- Create: `src/launchpages/run.ts`
- Test: `src/launchpages/run.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpages/run.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLaunchpages } from "./run.ts";

function finalist(id: string, name: string, winRate: number) {
  return { rank: 1, winRate, winRateCiLow: 0, winRateCiHigh: 1, avgWtpMinor: 1000,
    concept: { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c", productPromise: "pp",
      heroSku: "sku", priceMinor: 49900, priceBand: "premium", tagline: "t", claims: [], packagingDirection: "x",
      brandVoice: "x", landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] } };
}

function fakeDeps(overrides: any = {}) {
  const calls: any = { identity: [], optimize: [], build: [] };
  return {
    calls,
    deps: {
      readFinalists: async () => ({ categoryId: "lipcare-india", finalists: [
        finalist("A", "Alpha", 0.3), finalist("B", "Beta", 0.2), finalist("C", "Gamma", 0.1),
      ] }),
      generateIdentity: async (kit: any, o: any) => { calls.identity.push({ kit, o }); return { logo: { imagePath: o.outDir + "/logo.png" }, packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] }; },
      optimizeCreative: async (o: any) => { calls.optimize.push(o); return { champion: { imagePath: o.outDir + "/product.png" } }; },
      buildLandingPage: async (concept: any, assets: any, _llm: any, o: any) => { calls.build.push({ concept, assets, o }); await writeFile(join(o.outDir, "index.html"), "<html></html>"); return { dir: o.outDir, indexPath: join(o.outDir, "index.html"), assetsCopied: [], ctaInjected: "inserted", usedFallback: false, warnings: [] }; },
      ...overrides,
    },
  };
}

test("builds all finalists, writes manifest with conceptId/syntheticScore/pagePath", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps, calls } = fakeDeps();
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.built.map((b) => b.conceptId)).toEqual(["A", "B", "C"]);
  expect(calls.identity).toHaveLength(3);
  expect(calls.optimize).toHaveLength(3);
  // identity refImages threaded into optimize
  const manifest = await Bun.file(res.manifestPath).json();
  expect(manifest.source).toBe("smoke-test");
  expect(manifest.concepts.find((c: any) => c.conceptId === "A").syntheticScore).toBe(0.3);
  expect(manifest.concepts[0].pagePath).toContain("index.html");
  await rm(out, { recursive: true, force: true });
});

test("resume: a finalist whose index.html exists is skipped", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  await mkdir(join(out, "a"), { recursive: true });
  await writeFile(join(out, "a", "index.html"), "<html></html>");
  const { deps } = fakeDeps();
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.skipped).toContain("A");
  expect(res.built.map((b) => b.conceptId)).toEqual(["B", "C"]);
  await rm(out, { recursive: true, force: true });
});

test("fail-isolation: one finalist's identity throws -> failed, others built", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({
    generateIdentity: async (kit: any, o: any) => {
      if (o.outDir.endsWith("/b")) throw new Error("render timeout");
      return { logo: { imagePath: o.outDir + "/logo.png" }, packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] };
    },
  });
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.failed.map((f) => f.conceptId)).toEqual(["B"]);
  expect(res.built.map((b) => b.conceptId)).toEqual(["A", "C"]);
  await rm(out, { recursive: true, force: true });
});

test("manifest only includes built finalists", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({
    buildLandingPage: async (_c: any, _a: any, _l: any, o: any) => {
      if (o.outDir.endsWith("/c")) throw new Error("build fail");
      await writeFile(join(o.outDir, "index.html"), "<html></html>");
      return { dir: o.outDir, indexPath: join(o.outDir, "index.html"), assetsCopied: [], ctaInjected: "inserted", usedFallback: false, warnings: [] };
    },
  });
  const res = await runLaunchpages({ outDir: out }, deps as any);
  const manifest = await Bun.file(res.manifestPath).json();
  expect(manifest.concepts.map((c: any) => c.conceptId).sort()).toEqual(["A", "B"]);
  await rm(out, { recursive: true, force: true });
});

test("missing finalists -> throws", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({ readFinalists: async () => ({ categoryId: "x", finalists: [] }) });
  await expect(runLaunchpages({ outDir: out }, deps as any)).rejects.toThrow();
  await rm(out, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/run.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpages/run.ts`**

```typescript
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
```

- [ ] **Step 4: Run to verify pass + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpages/run.test.ts`
Expected: PASS (5).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpages/run.ts src/launchpages/run.test.ts
git commit -m "feat(launchpages): runLaunchpages orchestrator (sequential, resumable, fail-isolated, manifest)"
```

---

## Task 4: CLI `launchpages` verb

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `launchpages` script to package.json "scripts"**

```json
    "launchpages": "bun run src/cli.ts launchpages",
```

- [ ] **Step 2: Add import to `src/cli.ts`**

```typescript
import { runLaunchpages } from "./launchpages/run.ts";
```

- [ ] **Step 3: Add the `launchpages` case inside `switch (cmd)`**

```typescript
  case "launchpages": {
    const res = await runLaunchpages({
      finalistsPath: arg("finalists", "out/finalists.json"),
      outDir: arg("out", "out/launchpages"),
      rounds: Number(arg("rounds", "2")),
      bestOf: Number(arg("best-of", "2")),
      currency: arg("currency", "INR"),
    });
    console.log(`\nLaunchpages → ${res.outDir}`);
    for (const b of res.built) console.log(`  \u2713 ${b.name.padEnd(20)} → ${b.indexPath}${b.usedFallback ? "  (\u26a0 page fallback)" : ""}`);
    for (const s of res.skipped) console.log(`  \u21b7 ${s} (skipped — already built)`);
    for (const f of res.failed) console.log(`  \u2717 ${f.conceptId} (failed: ${f.reason})`);
    console.log(`Wrote ${res.manifestPath} (${res.built.length} concepts)`);
    console.log(`Next: deploy the bundles, run traffic, then bun run smoketest:import --category=<c> --csv=<results>`);
    break;
  }
```

- [ ] **Step 4: Add `launchpages` to the usage string in the `default:` case**

After the `bun run foundry` line, add:
```typescript
        `  bun run launchpages --finalists=out/finalists.json --out=out/launchpages\n` +
```

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/cli.ts package.json
git commit -m "feat(cli): launchpages verb (finalists -> branded smoke-test bundles + manifest)"
```

---

## Task 5: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new launchpages tests).

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 3: Review diff vs spec**

Run: `git log --oneline launchpages-orchestrator ^main`
Confirm tasks 1-4 each produced a commit and spec sections (types, deriveLiteKit, productSpec, runLaunchpages, CLI) are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead.**
```
