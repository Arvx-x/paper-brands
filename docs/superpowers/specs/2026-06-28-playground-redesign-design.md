# Playground Redesign — Design

Date: 2026-06-28
Status: Approved

## Problem

The playground (`public/index.html`) works but looks basic: a single cramped top bar
holds brand, category, cohort, and run controls, and there is nowhere to add the
new user-data upload dropzone. The visual treatment is inconsistent and there is no
global view of run progress. We want a production-grade redesign that:

- Houses the run setup (including the new upload dropzone) in a persistent left
  sidebar that doubles as the live progress/status column.
- Restyles all four result tabs to a refined, restrained neobrutalist system.
- Surfaces user-data provenance honestly when a run used an uploaded workbook.

## Scope

In scope:
- Full DOM-render redesign of `public/index.html` (two-column shell, restyled tabs,
  upload dropzone + chip, sidebar stage checklist, honesty badges).
- Wiring the run form to multipart `POST /api/run` (carry the file), `POST /api/parse`
  (preview chip), and `GET /api/template` (download).
- Additive: extend the `intel-done` event + `viewstate.ts` `IntelState` with
  user-data provenance fields so honesty badges can render.

Out of scope:
- Any change to the pipeline simulation logic.
- Rewriting the reducer's existing behavior. Only the `intel` slice gains fields.
- A frontend framework. Stays a single self-contained HTML file with native
  `EventSource` + vanilla DOM, reducer served transpiled at `/viewstate.js`.

## Core Principle

`src/server/viewstate.ts` (`reduce`/`initialState`) remains the single, tested
source of truth. The DOM render layer is a dumb projection of that state and stays
untested. Only the render layer and the `intel` slice change.

## Architecture

Two-column full-height app shell:

```
┌─────────────┬───────────────────────────────────────┐
│  SIDEBAR    │  TAB STRIP                             │
│ (control +  │  Harvest&Intel · Arena · Creative ·    │
│  status)    │  Pages                                 │
│             ├───────────────────────────────────────┤
│ brand       │                                        │
│ category    │  active tab content (full height)      │
│ cohort      │                                        │
│ dropzone    │                                        │
│ Run         │                                        │
│ status pill │                                        │
│ stage list  │                                        │
└─────────────┴───────────────────────────────────────┘
```

- Left **sidebar** (~280px, fixed, ink right-border): all controls + run status +
  vertical stage checklist. The single source of progress truth.
- Right **pane**: thin tab strip + full-height active-tab content. Tabs lose their
  inline spinners (the sidebar checklist owns progress).

## Components

### Sidebar (control + status column)
Top to bottom:
1. **Brand mark** — "Paper Brands" wordmark.
2. **Category input** — 2px ink border, accent focus ring.
3. **Cohort slider** — 20–120 step 20, accent thumb, live value readout.
4. **Upload zone** — dashed-border dropzone ("Drop your data — optional") + a
   "Download template" link (`GET /api/template`). On file drop/select →
   `POST /api/parse` (multipart, field `file`) → collapses to a **result chip**:
   `<filename> · N voices · N SKUs · N competitors · N overrides`. If warnings
   exist, a `⚠ N rows skipped` toggle expands an inline warning list. An `×`
   clears the file (restores the empty dropzone). Drag-over highlights the zone.
   The parsed file is held in a JS variable (the `File` object) and attached to the
   run request; `/api/parse` is preview-only and starts nothing.
5. **Run button** — primary hard-shadow block (ink fill, coral on hover). Disabled
   and labelled "Running…" while `status === "running"`.
6. **Status pill** — Idle / Running·category / Complete / Error, colored
   (idle neutral, running amber, complete green, error red). An SSE reconnect
   indicator appears here if the EventSource drops.
7. **Stage checklist** — vertical list of the five stage groups:
   Harvest → Intel → Arena → Creative → Pages. Each row shows a state glyph driven
   by `state.stages`: pending `○`, active `⟳` (spinning), done `✓`. Group→stage
   mapping: Harvest=`harvest`, Intel=`intel`, Arena=`council|cohort|arena|scoring`,
   Creative=`finalists|creative`, Pages=`pages`. A group is "active" if any of its
   stages is active, "done" if all its stages are done.

### Right pane tabs
- **Harvest & Intel** — a **live research view** that shows what is being scraped
  and searched, with numbers, as it happens (not just a static post-hoc list):
  - Each research **lens** appears as a row the moment its `harvest-lens-done`
    event lands, showing the lens id and its `findings` + `citations` counts. While
    lenses are still in flight (before all expected lenses are in), an active
    `⟳ researching…` row shows progress `X/total`.
  - A **sources** row shows `fetched/total · domains (independent)` once
    `harvest-sources-done` lands; an active fetching row before that.
  - A **price intel** row shows `N SKUs` and the derived price bands
    (`label ₹min–max (share%)`) once `harvest-price-done` lands.
  - A **running totals** strip at the top of the tab aggregates live:
    `N lenses · N citations · N SKUs` so the user sees the scrape growing.
  - An **intel stat block** (confidence · attribution% · segments · competitors,
    with a degraded warning) once `intel-done` lands.
  - When user data was used, **honesty badges** render: `+N user voices`,
    `N user SKUs (M displaced)` (M from `skuConflicts`), and
    `overrides: priceBands, currency` (from `overridesApplied`). Badges only show
    when the respective count/array is non-zero/non-empty.
- **Arena** — winner/leading banner (hard-shadow hero, resolves blind label →
  real brand name via finalists/brands as today), blind-label tally bars, and a
  **tall, scrollable live conversation feed** that is the centerpiece of the tab:
  every agent's decision streams in as it is made, each showing persona id, segment,
  blind pick, the agent's stated **reasoning (reason) in full**, its top objection,
  confidence, and WTP when present. The feed fills the available height and scrolls;
  clicking any decision opens the conversation modal for the full per-agent detail
  (behavior unchanged, restyled). This uses the existing `persona-decision` event
  data — no backend change.
- **Creative** — finalist brand rows with logo/packaging/product thumbnails filled
  as `image-ready` events arrive; moat score per row.
- **Pages** — three landing-page preview cards (iframe thumbnail + win/moat tags +
  "Open page ↗"); hard-shadow hero cards.

### Modal
The conversation modal (persona decision detail) keeps its current data and
behavior; only the styling is refreshed.

## Visual System

- **Palette:** paper-white bg (`#f6f6f4`), white surfaces, ink borders (`#1a1a1a`,
  2px), single accent coral (`#f9427d`) reserved for primary action + winner/leading
  + focus ring. Health colors green/amber/red only for status pill + confidence +
  degraded.
- **Shadows:** exactly one hard-shadow style (`4px 4px 0 #1a1a1a`) used ONLY on hero
  elements: winner banner, Run button, page cards. Not on every card.
- **Spacing:** 4/8/12/16/24/32 scale. **Type ramp:** display / heading / body /
  mono-meta. Generous whitespace.
- **States:** every tab has explicit empty, loading, and error states. Run-level
  error banner at top of the pane. No blank panels.

## Data Flow / Backend Changes (additive)

1. **`intel-done` event** (`src/server/events.ts`) gains four optional fields:
   `userVoices: number`, `userSkus: number`, `skuConflicts: number`,
   `overridesApplied: string[]`. The pipeline (`src/server/pipeline.ts`) already
   computes these on `pack.provenance`; the `intel-done` emit reads them from the
   pack (defaulting to 0 / []). Keeping them optional preserves back-compat for any
   emitter that omits them.
2. **`IntelState`** (`src/server/viewstate.ts`) gains the same four fields; the
   `intel-done` case copies them through (defaulting when absent). This is the only
   reducer change.
3. **Run form** issues `POST /api/run` as `multipart/form-data` with fields
   `category`, `cohortSize`, and optional `file`. The server already accepts this.
   When no file is attached, the request still carries category/cohortSize and the
   run behaves identically to today.

## Error Handling

- `/api/parse` failure (non-workbook) → the dropzone shows an inline error
  ("Couldn't read that file — is it an .xlsx?") and does not collapse to a chip.
- `/api/run` 409 (run already active) → status pill shows "a run is already active".
- SSE drop → reconnect indicator near the status pill; native `EventSource`
  auto-reconnects.
- Run-level pipeline error (`run-error` event) → error banner in the pane (existing
  behavior, restyled).

## Testing

- `src/server/viewstate.test.ts` gains a case: `intel-done` with user-data fields
  populates `IntelState.userVoices/userSkus/skuConflicts/overridesApplied`; and a
  case confirming they default (0 / []) when the event omits them.
- `src/server/events` type change is compile-checked (typecheck).
- DOM render remains untested (dumb projection of tested state), consistent with the
  current approach.
- The `/viewstate.js` transpile route already exists and is covered.

## Honesty Doctrine Compliance

- User-data provenance is surfaced, not hidden: badges disclose voices, displaced
  SKUs, and applied overrides whenever a run leaned on uploaded data.
- Warnings from `/api/parse` are always reachable (expander), never swallowed.
- Degraded intel and low confidence remain visible in the intel stat block.
