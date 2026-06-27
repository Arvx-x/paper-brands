# Design: Fake-Door Smoke-Test Adapter (Ground-Truth #3)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #3 — ground-truth adapters. First adapter: static notify-me PDP smoke test.

---

## Context

The calibration layer (#2) maps the arena's blind win-rate to a real-world estimate, but it stays
`UNCALIBRATED` until real observations are recorded. We proved (Level-1) that public-traction
analogs cap at ρ≈0.5, so the only proxy that can plausibly do better is **our own fake-door PDP
click-through** — real humans, isolated from brand equity.

This piece produces that real signal. It turns a tournament's generated concepts into deployable
static notify-me landing pages, lets the operator run real traffic on any host, then ingests the
observed notify-click CTR into the calibration store as `(syntheticScore, realOutcome)` pairs.

It does NOT host pages, run traffic, or track clicks automatically — that's deferred frontend/
platform work. It builds the pages + manifest and ingests results via CSV.

### Decisions (locked during brainstorming)

- Page format: **static notify-me PDP**, one per concept.
- Generator input: **`out/tournament.json`** (only source that carries per-concept synthetic
  win-rate, the calibration pair's left side).
- Primary outcome: **notify-click CTR** = `notifyClicks / pageVisitors`
  (`realMetric = "notify CTR"`, `source = "smoke-test"`, `unit = "concept"`).
- Ingestion: **CSV manual import** into the existing `CalibrationStore` (host/analytics-agnostic,
  no backend, no tracking endpoint now).

---

## 1. Architecture

Pure-core / impure-edge split, mirroring the calibration layer.

Per-concept `syntheticScore` is read from `tournament.report.concepts[]` (each has `conceptId`
and `winRate`), joined to `tournament.concepts[]` (the generated `BrandConcept`s) by
`conceptId === concept.id`. Benchmark/competitor entries (`conceptId` starting `benchmark:` or
`competitor:`) are excluded — only generated concepts get pages. `slug` is a filesystem-safe
derivation of the id used solely for filenames; the synthetic↔real join always uses the original
`conceptId`.

```
out/tournament.json
   ├─ buildExperiment(tournamentOutput)   -> SmokeExperiment            [PURE]
   ├─ renderPdpPage(concept)              -> static HTML string         [PURE]
   ├─ writeExperiment(experiment, dir)    -> files on disk              [I/O]
   │     data/<category>/smoketest/{experiment.json, results-template.csv, pages/<slug>.html}
   └─ parseResultsCsv(experiment, csv)    -> { observations, skipped }  [PURE]
         -> CalibrationStore.record(...)   (existing, dedupe + 0..1 guard) [I/O]
```

**Module files:**
```text
src/smoketest/
  types.ts        SmokeConcept, SmokeExperiment, SmokeResultRow
  experiment.ts   buildExperiment (pure)
  page.ts         renderPdpPage (pure HTML string, escaped)
  results.ts      parseResultsCsv -> CalibrationObservation[] (pure)
  write.ts        writeExperiment / readExperiment (I/O)
  *.test.ts
```

**CLI verbs (existing hyphenated style):**
- `smoketest-build --category=<c>` — reads tournament JSON, writes pages + manifest + CSV template.
- `smoketest-import --category=<c> --csv=<path>` — parses CSV, records calibration observations.

Reuses `CalibrationStore` and `CalibrationObservation` as-is. No new dependencies; HTML is a plain
template string. Logic lives in the pure functions (fixture-tested); only `write.ts` touches disk.

---

## 2. Data model

```typescript
export interface SmokeConcept {
  conceptId: string;
  name: string;
  syntheticScore: number;     // 0..1, arena win-rate at build time
  slug: string;               // filesystem-safe; page + CSV join key
  pagePath: string;           // relative, e.g. "pages/sunshield-lip-balm.html"
}

export interface SmokeExperiment {
  category: string;           // from tournament.categoryId, e.g. "lipcare-india"
  currency: string;           // for price rendering; from --currency (default "INR")
  builtAt: string;            // ISO
  realMetric: "notify CTR";   // fixed
  source: "smoke-test";       // fixed
  unit: "concept";            // fixed
  tournamentRef?: string;     // optional run marker (winner id / timestamp)
  concepts: SmokeConcept[];
}

export interface SmokeResultRow {
  conceptId: string;
  pageVisitors: number;       // denominator
  notifyClicks: number;       // numerator
}
```

**Results CSV (template generated for the operator):**
```csv
conceptId,pageVisitors,notifyClicks
sunshield-lip-balm,0,0
lipcraft,0,0
```

**CSV → CalibrationObservation (in `parseResultsCsv`), per row joined by `conceptId`:**
```typescript
{
  id: `smoke-${category}-${conceptId}-${experiment.builtAt}`,  // stable, dedupe-friendly
  category,
  syntheticScore: concept.syntheticScore,            // from experiment.json (no drift)
  realOutcome: clamp01(notifyClicks / pageVisitors), // notify CTR
  source: "smoke-test",
  unit: "concept",
  label: `${concept.name} smoke`,
  realMetric: "notify CTR",
  recordedAt: <import time ISO>,
  notes: `visitors=${pageVisitors}, clicks=${notifyClicks}`,
}
```

**Validation (fail-clean; surfaced in import summary):**
- `pageVisitors <= 0` → skip row + warn (no div-by-zero, no fabricated CTR).
- `notifyClicks > pageVisitors` → reject row (CTR can't exceed 1).
- negative / non-numeric values → reject row.
- `conceptId` not in `experiment.json` → skip + warn (no synthetic pair).
- empty/missing rows → skipped; summary reports `recorded N / skipped M`.
- `CalibrationStore.record` re-guards 0..1 as a second check.

**Rationale:** `syntheticScore` comes from the manifest (locked to the exact tournament that made
the page — no drift). The deterministic `id` makes re-import **update** (dedupe-by-id), so adding
traffic overwrites cleanly instead of duplicating.

---

## 3. Page rendering (`renderPdpPage`, pure)

```typescript
renderPdpPage(concept: BrandConcept, opts?: { experimentId?: string; currency?: string }): string
```

Self-contained static HTML per concept; no framework, no external assets. Maps existing
`BrandConcept` fields:
- `<title>` + hero `name`; `landingHeadline` as H1; `tagline` as subhead.
- `positioning` / `productPromise` as lead paragraph; `claims[]` as a bullet list.
- `heroSku` + price: `priceMinor` → major units, rendered with `opts.currency` (default "INR").
  `BrandConcept` has no currency field, so currency is passed in (from the experiment/CLI), never
  read off the concept.
- single primary CTA: **"Notify me at launch"**.
- minimal inline CSS (system font, centered column, one accent) — mobile-friendly, not branded.

**Conversion mechanism (countable, host-agnostic, no backend):**
- CTA carries stable hooks: `id="notify-cta"`, `data-cta="notify"`, `data-concept-id`,
  `data-experiment-id`.
- On click: reveals a "You're on the list ✅" confirmation, and calls a no-op `PB_TRACK(...)` JS
  stub the operator can wire to GA/Plausible/GTM. Optional commented `<form action="">` placeholder
  for later email capture.
- Tracks nothing automatically (consistent with CSV import). The page only makes the notify click a
  discrete event the operator's own analytics can count. It never invents numbers.

**Safety / determinism:**
- Pure: same concept → identical HTML (no timestamps in body except optional `experimentId`
  comment).
- All interpolated concept text is **HTML-escaped** (`<`, `&`, `"`).
- Missing optional fields degrade gracefully (no claims → omit list; never empty bullets).

**Tests (pure, fixtures):** renders headline/tagline/claims/price/`notify-cta`; escapes injection
chars; empty claims → no list; deterministic output; includes `PB_TRACK` stub + `data-concept-id`.

**Non-goals (deferred to later frontend work):** brand identity/styling system, images/render
assets, responsive polish, live tracking endpoint, A/B traffic split, hosting/deploy automation,
multi-concept comparison page.

---

## 4. Write/import flow, CLI, error handling

### 4a. `writeExperiment(experiment, concepts, baseDir="data")` — I/O
Writes under `data/<slug(category)>/smoketest/`:
```
experiment.json          # manifest (source of truth for synthetic<->page pairing)
results-template.csv     # header + one zeroed row per concept
pages/<slug>.html        # one static notify-me PDP per concept
```
`mkdir -p` (harvest/calibration convention) + `Bun.write`. Rebuild overwrites pages + template;
returns written paths. Includes `readExperiment(category, baseDir)` for import.

### 4b. CLI `smoketest-build`
```bash
bun run smoketest:build --category=lipcare-india [--tournament=out/tournament.json] [--currency=INR] [--out=data]
```
Reads tournament JSON (default `out/tournament.json`), `buildExperiment(tournament, currency)`,
renders pages with `currency`, writes bundle. Validates `categoryId` + `report.concepts[]` with
win-rates joined to `concepts[]`; if no generated concept has a win-rate → clear error, exit 2,
nothing written. Prints bundle path, page count, and `Next: run traffic, then smoketest:import`.
(`--category` selects the calibration category/output dir; it should match the tournament's
`categoryId`.)

### 4c. CLI `smoketest-import`
```bash
bun run smoketest:import --category=lipcare-india --csv=path/to/results.csv [--out=data]
```
Loads `experiment.json` (absent → "run smoketest:build first", exit 2). `parseResultsCsv` →
`{ observations, skipped }`. Records via `CalibrationStore.record` (dedupe-by-id, 0..1 guard).
Prints `recorded N / skipped M` with each skip reason, then suggests `calibrate:status`.

### 4d. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| Missing/empty tournament JSON | build error, exit 2, nothing written |
| Concept missing win-rate | drop in build + warn (can't pair synthetic score) |
| Missing experiment.json on import | error "build first", exit 2 |
| `pageVisitors<=0` | skip row + warn (no div-by-zero / fabricated CTR) |
| `notifyClicks>pageVisitors` / negative / non-numeric | reject row + warn |
| Unknown `conceptId` in CSV | skip + warn |
| Malformed CSV header | fail-clean error with expected header; record nothing |
| Re-import same experiment | dedupe-by-id → update, no duplicates |

Doctrine: never fabricate a CTR; every skip surfaced (declare known-unknowns); deterministic ids
(reproducible); observation (CSV counts) separated from inference (calibration fit consumes later).

### 4e. Tests
- `buildExperiment`: fixture tournament → manifest (slugs, synthetic scores, page paths);
  win-rate-less concept dropped + flagged.
- `parseResultsCsv`: correct CTR observations; each fail-clean case; stable dedupe id.
- `writeExperiment`/`readExperiment`: temp-dir round-trip (manifest + pages + CSV); rebuild
  overwrites.
- CLI smoke (light): build from fixture tournament → import small CSV → `calibrate:status` n>0;
  bad args exit 2.
- End-to-end-ish (no network/LLM): fixture tournament → build → fill CSV → import →
  `calibrate(category, winRate)` returns non-uncalibrated once n≥3.

---

## Out of scope
- Hosting/deploying pages, running real traffic, automatic click tracking (deferred frontend work).
- Email capture backend / third-party form wiring beyond a commented placeholder.
- Ad-platform CTR import, waitlist/preorder funnel metrics (future adapters / deeper funnel).
- Multi-concept comparison page (format C, not chosen).
- Brand identity / visual design system for the pages.
