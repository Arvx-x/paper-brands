# User Data Ingestion — Design

Date: 2026-06-28
Status: Approved (frontend deferred)

## Problem

The simulation's quality is bottlenecked by the things web-scraping structurally
cannot reach: private first-party customer voice, real demand/sell-through, real
margins/COGS, and the true competitor set. The harvest explicitly carries only a
*supply proxy* (what's stocked) and a *review-activity proxy* (what's discussed),
never measured demand, and fights to find even 3 independent customer-voice
sources.

Users in a category often already hold this data — surveys, support tickets, sales
notes, distributor sell-through, supplier cost sheets. This feature lets a user
upload a structured workbook whose contents (a) **fill the gaps the harvest
misses** as high-trust evidence and (b) **hard-override specific facts** they know
the harvest gets wrong.

## Scope

In scope:
- A canonical `.xlsx` template (4 data sheets + README) users fill with what they have.
- Pure parse + merge modules that fold user data into the **existing** intel contract.
- Server endpoints to download the template, preview a parse, and run with a file.

Out of scope (deferred):
- Frontend / playground UI changes. Endpoints are framework-agnostic; the UI
  consumes them later on the user's terms.
- Freeform document extraction (PDF/deck) — structured template only.
- Calibration ground-truth ingestion (past launch CTRs). Not the primary goal; a
  `LaunchResults` sheet may be added later without disturbing this design.

## Core Principle

User data introduces **no new concepts** in the simulation. It populates slots the
pipeline already has:

- **Voices → synthetic `SourceDoc`s.** Each voice row becomes an independent,
  user-provided source whose `rawText` literally *is* the user's quote. The
  existing containment gate (`verifyAgainstSources`) therefore passes correctly and
  trivially — the quote provably appears in the source because the user *is* the
  source.
- **SKUs → `PriceObservation`s** appended to the harvested ones (deduped).
- **Competitors → grounding hints** fed into the brief.
- **Overrides → applied to the pack** after `buildCategoryPack`, replacing
  `priceBands` / `buyerSegments` / `currency`.

**Byte-identical guarantee:** when no file is uploaded, the merge is the identity
function and the pipeline output is unchanged. User data is strictly additive.

## Data Flow

```
xlsx upload ──► parseWorkbook() ──► UserIntel { voices[], skus[], competitors[], overrides{} }
                                          │
                  ┌───────────────────────┼──────────────────────────┐
                  ▼                        ▼                          ▼
          synthetic "sources"      PriceObservations          Overrides applied
          (each voice = 1          merged into harvest         AFTER pack build
           independent,            observations + bands         (priceBands,
           user-provided                                        buyerSegments,
           SourceDoc)                                           currency)
                  │                        │                          │
                  └────────────► CategoryBrief ◄─────────────────────┘
                                     │
                                buildCategoryPack()  ← unchanged contract
                                     │
                                applyOverrides(pack)
```

## The Template: `paper-brands-intel.xlsx`

Multi-sheet workbook. Every sheet is **optional** — fill what you have; blank
sheets are skipped and the gap shows honestly in provenance. Row 1 is fixed
headers. A `README` sheet documents each column. One example row per sheet.

### Sheet `Voices` (highest impact)
Customer verbatims. Each row → one independent, user-provided source.

| column      | required | example                                  | maps to |
|-------------|----------|------------------------------------------|---------|
| `quote`     | yes      | "the balm melts in my bag every summer"  | source rawText (quotable substrate) |
| `kind`      | yes      | rejection \| unmet \| trigger \| praise  | routes to unmetNeeds/rejectionReasons/purchaseTriggers/wellMetNeeds |
| `segment`   | no       | outdoor/SPF user                         | grounds groundedGrievances |
| `source`    | yes      | Q2 NPS survey / support ticket #4412     | provenance label |
| `date`      | no       | 2026-03                                  | recency (informational) |
| `internal`  | no       | true                                     | if true → `independent: false` (brand-internal note, not customer voice) |

### Sheet `SKUs`
Real products plus data scraping cannot get (sell-through, margin).

| column        | required | maps to |
|---------------|----------|---------|
| `brand`       | yes      | PriceObservation.brand |
| `product`     | yes      | PriceObservation.product |
| `price`       | yes      | PriceObservation.price (whole currency, current selling price) |
| `mrp`         | no       | PriceObservation.mrp |
| `packSize`    | no       | PriceObservation.packSize |
| `unitQty`     | no       | PriceObservation.unitQty |
| `subtype`     | no       | PriceObservation.subtype |
| `reviewCount` | no       | PriceObservation.reviewCount |
| `rating`      | no       | PriceObservation.rating |
| `tier`        | no       | value \| core \| premium — grounds competitor clusters |
| `unitsSold`   | no (NEW) | measured-demand signal (informational; recorded, not yet load-bearing) |
| `marginPct`   | no (NEW) | real economics (informational) |

### Sheet `Competitors`
| column            | required | maps to |
|-------------------|----------|---------|
| `name`            | yes      | grounds a competitorArchetype (real name audit-only; disguised in arena) |
| `pricePositioning`| no       | archetype.pricePositioning hint |
| `claims`          | no       | semicolon-separated → archetype.claims hints |
| `strengths`       | no       | semicolon-separated |
| `weaknesses`      | no       | semicolon-separated |

### Sheet `Overrides` (hard-fact lane)
Key/value. Only for facts the user *knows* the harvest gets wrong.

| `field`         | `value` example |
|-----------------|-----------------|
| `priceBands`    | value:0-150, core:150-400, premium:400+ |
| `buyerSegments` | dry-lips relief:0.4, tint+care:0.3, SPF:0.3 |
| `currency`      | INR |

## Modules

### `src/userdata/types.ts`
```ts
type VoiceKind = "unmet" | "rejection" | "trigger" | "praise";
interface UserVoice { quote: string; kind: VoiceKind; segment?: string; source: string; date?: string; independent: boolean }
interface UserSku { brand: string; product: string; price: number; mrp?: number; packSize?: string; unitQty?: number; subtype?: string; reviewCount?: number; rating?: number; tier?: string; unitsSold?: number; marginPct?: number }
interface UserCompetitor { name: string; pricePositioning?: string; claims: string[]; strengths: string[]; weaknesses: string[] }
interface UserOverrides { priceBands?: { label: string; lowMinor: number; highMinor: number }[]; buyerSegments?: { seed: string; weight: number }[]; currency?: string }
interface UserIntel { voices: UserVoice[]; skus: UserSku[]; competitors: UserCompetitor[]; overrides: UserOverrides; summary: { voices: number; skus: number; competitors: number; overrides: string[] } }
```
Zod schemas validate each row shape.

### `src/userdata/parse.ts`
`parseWorkbook(buf: ArrayBuffer | Buffer): { intel: UserIntel; warnings: string[] }`.
- The **only** file (with `template.ts`) that imports SheetJS (`xlsx`). Isolated so
  the dependency is contained.
- **Fail-clean (QUALITY.md):** a malformed/incomplete row is dropped with a
  `warning` string, never silently coerced. A missing optional cell is *absent*,
  not `0`/`null`/`""`. `price` that won't parse to a finite number → row dropped
  with warning, not `0`.
- Unknown sheets/columns ignored with a warning. Empty workbook → empty `UserIntel`
  + warning, never throws.
- `overrides` parsing: `priceBands` string parsed to minor units (×100);
  `buyerSegments` weights parsed and left for normalization downstream.

### `src/userdata/merge.ts` (pure, the tested heart)
- `voicesToSources(voices): EvidenceSource[]` — each voice → `{ finalUrl: "user://<source>#<i>", sourceClass: "first-party", independent: voice.independent, rawText: voice.quote }`.
- `skusToObservations(skus): PriceObservation[]`.
- `mergeObservations(harvested, user): PriceObservation[]` — user appended, deduped
  by normalized `brand+product`; on conflict the user row wins (recorded in a
  returned note count).
- `applyOverrides(pack, overrides): { pack, applied: string[] }` — replaces
  `priceBands` / `buyerSegments` (re-normalized) / `currency`; returns which fields
  changed. Pure: returns a new pack, does not mutate.
- `competitorsToHints(competitors): string` — compact grounding text appended to
  the brief (real names allowed here for grounding; archetypes stay disguised by
  the existing prompt rules).
- `summarize(intel): UserIntel["summary"]`.

### `src/userdata/template.ts`
`buildTemplateWorkbook(): Buffer` — generates the canonical `.xlsx` (4 sheets +
README + one example row each) via SheetJS. Deterministic.

## Wiring (minimal)

- `CategoryBrief` already carries `sources` / `priceBands` / `observations`. The
  pipeline merges user data into these **before** `buildCategoryPack`.
- `runFoundryPipeline(category, onEvent, deps, cohortSize, userIntel?)` — new
  optional final arg. When absent, behavior is identical to today.
- In the INTEL stage: prepend `voicesToSources(userIntel.voices)` to the source
  list; `mergeObservations` the user SKUs; append `competitorsToHints` to the
  brief notes; recompute clusters/bands over the merged observations when the user
  supplied SKUs.
- After `buildCategoryPack` returns: `applyOverrides(pack, userIntel.overrides)`
  before `savePack`.
- **Precedence (priceBands):** explicit `Overrides.priceBands` is the highest
  authority and wins over both harvested bands and bands recomputed from merged
  SKUs. Order is: harvested/recomputed bands during pack build → `applyOverrides`
  replaces them last if the user set them. There is exactly one final source of
  truth and it is recorded in `overridesApplied`.
- **Provenance honesty:** stamp `userVoices: N`, `userSkus: N`,
  `overridesApplied: string[]` onto the pack provenance so it is always auditable
  that results lean on user-supplied evidence. (Add optional fields to
  `ProvenanceSchema`.)
- Emit an `intel-done` extension / new event carrying `userVoices` / `overrides`
  so a future UI can surface honesty badges. Events remain observational — output
  is byte-identical with/without `onEvent`.

## Server Endpoints

- `GET /api/template` → streams `paper-brands-intel.xlsx`
  (`content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `content-disposition: attachment`).
- `POST /api/parse` (multipart, single file field) → parses, returns
  `{ summary, warnings }` for a confirmation chip. **Stateless** — no run started,
  nothing persisted.
- `POST /api/run` → accepts an optional file (multipart). When present, parses
  authoritatively server-side and threads `userIntel` into `runFoundryPipeline`.
  When absent, behaves exactly as today (still accepts the existing JSON body for
  back-compat).

The path-traversal guard already rejects multi-segment non-`/api/`/`/out/` paths;
all new routes are under `/api/`.

## Error Handling

- Parse never throws on bad rows — it drops + warns. It throws only on a file that
  is not a readable workbook at all (returned as 400 by `/api/parse` and `/api/run`).
- A file with zero usable rows is allowed: the run proceeds harvest-only, and the
  warnings explain why nothing was ingested.
- Override of `currency` that conflicts with the run's currency is applied (user
  wins) and recorded.

## Testing

- `parse.test.ts`: well-formed workbook → correct `UserIntel`; malformed rows
  dropped with warnings; missing optional cells stay absent (not `0`); empty
  workbook; non-workbook buffer throws.
- `merge.test.ts` (pure, no IO): `voicesToSources` independence flag honored;
  `mergeObservations` dedupe + user-wins; `applyOverrides` replaces + re-normalizes
  + reports `applied`; identity when overrides empty.
- `template.test.ts`: `buildTemplateWorkbook()` round-trips through `parseWorkbook`
  to the example rows (the template is itself valid input).
- Pipeline test: `runFoundryPipeline` with `userIntel = undefined` produces the
  same emitted events / pack as before (byte-identical guarantee), with injected
  fake deps.

## Dependency

Add `xlsx` (SheetJS, ~1MB) as the single new runtime dependency, imported only by
`src/userdata/parse.ts` and `src/userdata/template.ts`.

## Honesty Doctrine Compliance

- Plausibility ≠ truth: user voices are real evidence, but flagged `first-party`
  and (if `internal`) non-independent, so they don't masquerade as independent
  market voice.
- Missing ≠ null: absent optional cells are absent, never coerced to `0`/`null`.
- Declare known-unknowns: `unitsSold`/`marginPct` are recorded but explicitly
  *not yet load-bearing* in win-rate; provenance records what was user-supplied.
- Fail-clean: bad rows dropped + warned, never silently fabricated.
- Observation vs inference: overrides are user assertions, recorded as such in
  provenance (`overridesApplied`).
