# Design: Launchpages Orchestrator (finalists → branded smoke-test pages)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Pipeline piece #2b — the orchestrator that turns `finalists.json` into 3
branded, smoke-test-instrumented landing-page bundles + a calibration-ready manifest.

---

## Context

`foundry` produces `out/finalists.json` (top-3 concepts). `buildLandingPage` turns one concept +
creative assets into a deployable, smoke-test-instrumented page. This piece is the orchestrator
that connects them: for each finalist, produce real-brand-quality creative (logo, packaging, product
shot), build the page, write a deployable bundle, and emit a smoke-test experiment manifest so
`smoketest-import` can later record real CTR into calibration.

**Creative scope (decided):** the brand-face assets — **logo, packaging, product shot** — go through
the existing creative optimizer (council/jury hill-climb) so they look like a real brand (a janky
AI logo would confound the smoke test as much as an over-polished ad would). Everything heavier is
skipped: no full creative factory (no BrandKit council, no competitor research, no 4 ad-format
specs, no 2K pro re-renders, no hero hill-climb). The **expensive full creative optimizer runs
AFTER the smoke test, only on the winning concept** — out of scope here.

### Decisions (locked during brainstorming)

- **Input:** reads existing `out/finalists.json` (operator runs `foundry`, reviews top-3, then this).
- **Per finalist:** `deriveLiteKit` (pure) → `generateIdentity` (optimized logo+packaging) →
  `optimizeCreative` (optimized product shot, fed logo+packaging as refs) → `buildLandingPage`.
- **Concurrency:** sequential, fail-isolated (one finalist's failure never aborts the batch),
  resumable (skip finalists whose bundle already exists).
- **Output:** per-finalist bundle under `out/launchpages/<slug>/` + a `SmokeExperiment` manifest
  (`experiment.json`) reusing the existing smoke-test schema so `smoketest-import` works unchanged.
- **Optimizer depth:** `rounds=2, bestOf=2` for the product shot (≈ real-brand quality without the
  full factory's depth).
- **Specialized expert jury critics:** deferred to their own spec (a jury change, not an orchestrator
  change; must carry distinct rubrics + a measurement that it changes the chosen image — not a
  renamed prompt).

---

## 1. Architecture

```
runLaunchpages(opts, deps?)                        [orchestrator over finalists.json]
   ├─ read out/finalists.json → { categoryId, finalists[] }
   └─ for each finalist (SEQUENTIAL, resumable, fail-isolated):
        ├─ skip if out/launchpages/<slug>/index.html exists  (resume → skipped[])
        ├─ deriveLiteKit(concept)                                  [PURE: minimal BrandKit, no council]
        ├─ generateIdentity(liteKit, { outDir, imageClient, llm }) [OPTIMIZED logo+packaging → refImages]
        ├─ optimizeCreative({ kit, spec: productSpec(kit), rounds, bestOf, refImages }) [OPTIMIZED product shot]
        ├─ assets = { brandKit, logoPath, packagingPath, heroPath(=product), adPaths: [] }
        ├─ buildLandingPage(concept, assets, llm, { outDir: <slug>, experimentId })  [REUSED]
        └─ on throw → failed[] + continue
   ├─ write out/launchpages/experiment.json   (SmokeExperiment schema, built finalists only)
   └─ return LaunchpagesResult { built[], skipped[], failed[], manifestPath }
```

**New module:**
```text
src/launchpages/
  types.ts    LaunchpagesOptions, BuiltPage, LaunchpagesResult
  kit.ts      deriveLiteKit(concept) -> BrandKit            (PURE)
  spec.ts     productSpec(kit) -> CreativeSpec              (PURE)
  run.ts      runLaunchpages(opts, deps?)                   (orchestrator, injectable deps)
  *.test.ts
```

Reuses `generateIdentity` + `optimizeCreative` (`src/creative/`), `buildLandingPage`
(`src/launchpage/`), the `SmokeExperiment` schema (`src/smoketest/types.ts`), `Finalist`
(`src/pipeline/foundry.ts`). Skips `runCreativeFactory`. No new dependencies.

**Injectable deps** (all default to real impls; tests pass fakes → no real renders/LLM):
`{ readFinalists, generateIdentity, optimizeCreative, buildLandingPage, imageClient, llm }`.
`deriveLiteKit` and `productSpec` are pure (fixture-tested).

**Cost (honest):** identity (logo+packaging, internally optimized) + product `optimizeCreative`
(rounds=2 × bestOf=2 ≈ 4-8 renders + jury) per finalist; ≈ far less than the full factory's ~90
renders, while the three brand-face assets reach real-brand quality.

---

## 2. Data model, deriveLiteKit, productSpec, manifest

```typescript
export interface LaunchpagesOptions {
  finalistsPath?: string;      // default "out/finalists.json"
  outDir?: string;             // default "out/launchpages"
  experimentId?: string;       // stamped into each CTA; default = builtAt timestamp
  pageModel?: string;          // page-coder; default "gemini-3.1-flash"
  rounds?: number;             // product-shot optimizer rounds; default 2
  bestOf?: number;             // default 2
  currency?: string;           // default "INR"
}

export interface BuiltPage {
  conceptId: string;
  name: string;
  slug: string;
  bundleDir: string;           // out/launchpages/<slug>/
  indexPath: string;
  syntheticScore: number;      // finalist winRate → manifest pairing
  usedFallback: boolean;       // buildLandingPage LLM fallback flag
  warnings: string[];
}

export interface LaunchpagesResult {
  outDir: string;
  built: BuiltPage[];
  skipped: string[];           // conceptIds skipped (bundle existed)
  failed: { conceptId: string; reason: string }[];
  manifestPath: string;        // out/launchpages/experiment.json
}
```

**`deriveLiteKit(concept): BrandKit` — pure.** A minimal valid `BrandKit` (satisfies the schema
`generateIdentity`/`optimizeCreative`/`buildLandingPage` need) without an LLM council:
- `brandName` ← `concept.name`.
- `palette` ← a small deterministic set (dark ink neutral + background neutral + an accent picked
  from `priceBand`/positioning keywords), 3-4 swatches with real hex + roles.
- `voice` ← `{ tone: concept.brandVoice || "warm, clear, confident", doSay: [], dontSay: [] }`.
- `moodKeywords` ← a few words from `positioning`/`coreInsight`.
- `logoDirection` ← `"clean wordmark for {name}, {mood}"`; `packagingDirection`/`artDirection`/
  `visualDos`/`visualDonts`/`negativePrompt` ← sane minimal defaults.
Deterministic; the optimizer (identity/product) does the visual heavy lifting, the kit just gives a
consistent brief.

**`productSpec(kit): CreativeSpec` — pure.** A minimal spec for the product shot the optimizer
refines: `assetType: "product-hero"` (a real `ASSET_PRESETS` entry — "studio product shot, premium
lighting, clean backdrop"), `id: "product"`, a prompt for clean realistic D2C product photography of
the hero SKU in brand colors. Mirrors how `identitySpec` is built for logo/packaging.

**Asset assembly per finalist** (into `buildLandingPage`'s `CreativeAssets`):
- `brandKit` ← lite kit
- `logoPath` ← `identity.logo.imagePath`
- `packagingPath` ← `identity.packaging.imagePath`
- `heroPath` ← the optimized product shot's `champion.imagePath` (product shot doubles as the page
  hero — kept lean; it's a fully optimized asset, not a one-shot)
- `adPaths` ← `[]`
`buildLandingPage`'s `bundleAssets` copies the referenced images into `<slug>/assets/` with
canonical names; the gemini page-coder references them.

**Manifest (`out/launchpages/experiment.json`, reuses `SmokeExperiment`):** written after the loop,
built finalists only:
```
{ category, currency, builtAt, realMetric:"notify CTR", source:"smoke-test", unit:"concept",
  concepts: [ { conceptId, name, syntheticScore:<winRate>, slug, pagePath:"<slug>/index.html" } ] }
```
`category` ← the finalists' `categoryId`. Consumed unchanged by `smoketest-import`.

---

## 3. Orchestrator, CLI, error handling, tests

### 3a. `runLaunchpages(opts, deps?)`
```
1. { categoryId, finalists } = readFinalists(opts.finalistsPath ?? "out/finalists.json")
   (missing/empty → throw clear error)
2. builtAt = ISO; experimentId = opts.experimentId ?? builtAt; outDir = opts.outDir ?? "out/launchpages"
3. for each finalist (sequential):
     slug = slugify(concept.id || concept.name); bundleDir = `${outDir}/${slug}`
     if exists(`${bundleDir}/index.html`) → skipped.push(conceptId); continue
     try:
       kit  = deriveLiteKit(concept)
       id   = await generateIdentity(kit, { outDir: bundleDir, imageClient, llm })
       prod = await optimizeCreative({ kit, spec: productSpec(kit), rounds, bestOf,
                  refImages: id.refImages, outDir: bundleDir, llm, imageClient })
       assets = { brandKit: kit, logoPath: id.logo.imagePath, packagingPath: id.packaging.imagePath,
                  heroPath: prod.champion.imagePath, adPaths: [] }
       res  = await buildLandingPage(concept, assets, llm, { outDir: bundleDir, experimentId, currency })
       built.push({ conceptId, name, slug, bundleDir, indexPath: res.indexPath,
                    syntheticScore: finalist.winRate, usedFallback: res.usedFallback, warnings: res.warnings })
     catch e: failed.push({ conceptId, reason: e.message })   // fail-isolated
4. write `${outDir}/experiment.json` (SmokeExperiment, built only)
5. return { outDir, built, skipped, failed, manifestPath }
```
Injectable deps default to real impls. `generateIdentity`/`optimizeCreative` write images under
`bundleDir`; `buildLandingPage` copies the referenced ones into `bundleDir/assets/`.

### 3b. CLI `launchpages` verb
```bash
bun run launchpages [--finalists=out/finalists.json] [--out=out/launchpages] [--rounds=2] [--best-of=2]
```
Prints per-finalist ✓ built / ↷ skipped / ✗ failed lines, the manifest path, and a `Next:` hint
(deploy, run traffic, `smoketest-import`). Add to package.json scripts + the usage block.

### 3c. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| finalists.json missing/empty | clear error, nothing built, exit 2 |
| `<slug>/index.html` exists | skip (resume) → `skipped` |
| identity/optimize/build throws for a finalist | catch → `failed` + continue (fail-isolated) |
| `buildLandingPage` LLM page-code fails | its own `renderPdpPage` fallback → `usedFallback:true` (still built) |
| image render fails inside identity/optimize | their internal handling; if it throws up → finalist in `failed` |
| zero finalists built | still write (empty) manifest + warn; non-zero exit |

Doctrine: per-finalist isolation (one failure never aborts the batch); resumability (idempotent
re-run skips done work); the manifest references only pages that actually built (no dangling
entries); the page always carries the deterministic notify-CTA (guaranteed by `buildLandingPage`).

### 3d. Tests
- `deriveLiteKit` (pure): valid `BrandKit` shape, deterministic, real hex palette, voice/mood from
  concept.
- `productSpec` (pure): `assetType:"product-hero"`, id + prompt present.
- `runLaunchpages` (all deps faked — no renders/LLM):
  - happy path: 3 finalists → 3 built; manifest written with correct conceptId/syntheticScore/
    pagePath; identity+optimize+build called per finalist with the lite kit + refImages threaded.
  - resume: a finalist whose `index.html` exists → skipped, not rebuilt.
  - fail-isolation: one finalist's `generateIdentity` throws → that one in `failed`, others built.
  - manifest only includes built finalists; `syntheticScore` = winRate.
  - missing finalists.json → throws.

---

## Out of scope
- The full creative optimizer / polish pass on the **winning** concept after the smoke test (future
  spec — runs the heavy factory only on validated demand).
- **Specialized creative jury panel** (packaging/design/product-photo experts) — a jury change, its
  own spec, must include distinct rubrics + a measurement that it changes the chosen image.
- Deploy automation, live click-tracking endpoint (CSV ingestion via existing `smoketest-import`).
- Frontend UI (the `LaunchpagesResult` + manifest are the seams).
- Running `foundry` (operator runs it first; launchpages reads its output).
