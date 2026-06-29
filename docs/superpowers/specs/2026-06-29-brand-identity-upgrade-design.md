# Brand Identity Upgrade — Design (Sub-project 1 of 3)

Date: 2026-06-29
Status: Approved

Part of the larger pivot: **Brand Foundry → Candidate Cards → Brand Book** (replacing
the landing-page flow). This is the first of three sub-projects:

1. **Brand Identity Upgrade (THIS SPEC)** — real LLM `BrandKit` in the card path +
   new `BrandNarrative` (vision/story/values) + a restrained brand motif + richer
   candidate cards.
2. Brand Book renderer — coded HTML/CSS book from identity data + image slots.
3. Approval flow + asset expansion — `/api/approve`, expansion image gen, UI.

## Problem

The post-arena creative path uses `deriveLiteKit` — a deterministic, hardcoded stub
(generic ink/paper palette, canned typography, empty casting/voice). Every brand's
identity is therefore a near-template, which is the root cause of generic creatives.
There is already a full LLM `buildBrandKit` in `src/creative/brandkit.ts`, but the
card/launchpages path bypasses it.

Separately, the candidate cards the user will approve need a **rich brand narrative**
(vision, origin story, values, manifesto) that does not exist anywhere today — neither
`BrandConcept` nor `BrandKit` carries it.

For book cohesion (sub-project 2), each brand needs ONE subtle signature **motif**.

## Scope

In scope:
- Swap `deriveLiteKit` → real `buildBrandKit` (LLM) in the candidate-card builder.
- New `BrandNarrative` type + `buildNarrative` LLM generator, run once per winner.
- New `generateMotif` — one restrained, transparent-PNG brand device per winner.
- Persist kit + narrative + motif next to each brand's assets so sub-projects 2/3
  reuse them (single source of truth).
- Richer candidate-card data carried to the UI (narrative teaser + kit summary).

Out of scope (later sub-projects):
- The brand book renderer itself (sub-project 2).
- The approval gate / `/api/approve` / asset expansion (sub-project 3).
- Removing the landing-page modules (done when sub-project 3 rewires the pipeline).
  This sub-project leaves the existing page flow working; it only upgrades identity.

## Core Principle

Rich identity (kit + narrative + motif) is generated ONCE per winner at card time and
saved to disk, so every later step (card display, brand book) reads the same artifacts.
Pure data/transform functions are tested; LLM and image-gen calls are thin wrappers
behind injectable deps.

## New Data: BrandNarrative

`src/brand/narrative.ts`:
```ts
BrandNarrativeSchema = {
  brandId: string,
  vision: string,        // the future the brand is building toward (1-2 sentences)
  mission: string,       // what it does, for whom, why (1 sentence)
  originStory: string,   // a short, specific founding narrative (2-4 sentences)
  values: { name: string; description: string }[],  // 3-5
  manifesto: string,     // punchy, voice-forward rallying statement (short paragraph)
  customerStory: string, // a day-in-the-life of the target customer (2-3 sentences)
  tagline: string,       // one memorable line (may echo concept.tagline)
}
```

`buildNarrative(concept, kit, llm?, market?) : Promise<BrandNarrative>`:
- Uses an `Agent` ("Brand Strategist & Storyteller" charter), `respondJson`.
- Grounds strictly in the concept (positioning/coreInsight/targetCustomer/promise)
  and the kit (essence/voice) — no invented product claims.
- Honest fallbacks (QUALITY.md): if a field is missing from the LLM output, fall back
  to a concept-derived value; never fabricate precision. Validated by zod.
- `saveNarrative(narrative, dir)` / `loadNarrative(brandId, dir)` mirror the kit helpers.

## New Asset: Brand Motif

`src/creative/motif.ts`:
```ts
generateMotif(kit, { outDir, imageClient?, llm? }) : Promise<{ imagePath: string } | null>
```
- One simple, **restrained** abstract brand device on a transparent background, derived
  from the kit's essence + moodKeywords + primary palette color.
- Prompt explicitly: minimal, single-color or two-tone, lots of negative space, a quiet
  recurring device (NOT a busy pattern, NOT loud). Transparent PNG.
- Fail-clean: returns `null` on generation failure (motif is an enhancement, not
  load-bearing); the card/book must render fine without it.

## Identity Bundle (persisted per winner)

For each winner, the card builder writes to the brand's bundle dir:
- `brandkit.json` (real LLM kit)
- `narrative.json` (BrandNarrative)
- `motif.png` (or absent if generation failed)
- the existing logo / product / ad image files

A small `IdentityBundle` summary is what the card surfaces.

## Card Builder Changes

In the candidate-card builder (currently `src/launchpages/run.ts` — kept at this path
for this sub-project to avoid churn; sub-project 3 may rename it when it rewires the
pipeline and drops the page build):
- Replace `deriveLiteKit(concept)` with `await buildBrandKit(concept, research?, llm, market)`.
  `research`/`market` optional; market defaults from the run (India). Falls back to
  `deriveLiteKit` ONLY if `buildBrandKit` throws (kept as a safety net, logged).
- After the kit: `await buildNarrative(concept, kit, llm, market)` and
  `await generateMotif(kit, { outDir, imageClient, llm })` (motif failure → null).
- Save `brandkit.json` + `narrative.json` (+ motif already written by generateMotif).
- Identity generation (`generateIdentity`) + product + ad unchanged, but now driven by
  the richer kit.
- Emit richer card data (see Events) so the UI shows the narrative teaser.

The landing-page build (`buildLandingPage`) call stays for now (removed in sub-project
3). This keeps the pipeline working end-to-end while identity is upgraded.

## Events (additive)

Extend the existing creative events so the card can show narrative + kit summary.
Add one event:
```ts
{ type: "card-identity"; conceptId: string; name: string;
  essence: string; vision: string; story: string;          // narrative teasers
  palette: { name: string; hex: string; role: string }[];  // kit palette for the card
  motifUrl?: string }                                        // transparent motif png
```
Emitted right after kit+narrative+motif are built, before the image renders. The
viewstate reducer stores it on a per-concept `identities` map; the UI Creative card
renders the vision/story teasers + palette chips. (The approve button + full card
layout land in sub-project 3; this sub-project just carries the data and shows teasers.)

Events remain observational — pipeline output is byte-identical with/without `onEvent`.

## Error Handling

- `buildBrandKit` throws → log + fall back to `deriveLiteKit` (never crash the run).
- `buildNarrative` throws → fall back to a concept-derived narrative (vision=positioning,
  story=coreInsight, etc.); logged.
- `generateMotif` fails → `null`, card/book omit the motif.
- All per-winner work stays fail-isolated (one winner failing doesn't kill the others),
  matching the current run.ts try/catch-per-finalist.

## Testing

- `narrative.test.ts`: `buildNarrative` with a fake LLM returns a schema-valid
  BrandNarrative; missing fields fall back to concept-derived values (no fabrication);
  zod rejects malformed shapes; save/load round-trips.
- `motif.test.ts`: `generateMotif` returns the written path on success (fake
  ImageClient); returns `null` on generation failure (no throw).
- Card-builder test: with injected fake `buildBrandKit`/`buildNarrative`/`generateMotif`,
  the builder saves brandkit.json + narrative.json and emits `card-identity` with the
  narrative teasers + palette; falls back to `deriveLiteKit` when buildBrandKit throws.
- `viewstate.test.ts`: `card-identity` populates `state.identities[conceptId]`.
- Existing creative tests stay green.

## Honesty Doctrine Compliance

- Narrative is grounded in the concept; missing fields fall back to concept-derived
  values, never invented precision.
- Motif is an enhancement; its absence is handled cleanly, never faked.
- No new product claims are introduced by the narrative generator (it reuses the
  concept's claims/positioning).
