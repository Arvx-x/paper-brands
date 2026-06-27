# Design: Concept Diversity (Anti-Duplication for the Council)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #5 (defensibility), sub-piece A — concept diversity / anti-duplication.

---

## Context

The Council generates near-duplicate candidate brands. In the live fragrance run, all four
concepts — Gentle Essence, PureEssence, Gentle Aura, PureScent — shared one wedge:
clean/non-toxic positioning, sensitive-skin segment, premium tier. Three of four even used the
tagline "Fragrance without compromise." The same collapse happened in lipcare.

Consequence: the arena's win-rate measures *the wedge*, not *brand differentiation*, because the
slate is rephrasings of one idea. The "winner" is just the best-worded clone. Ranking moats on a
slate of clones would be meaningless, so diversity must be fixed before any moat scoring.

### Root cause (mechanical, in `src/council/council.ts`)

1. `proposeTerritories` — 8 specialist agents propose territories **independently and blindly**
   (no agent sees the others), so they all gravitate to the same obvious white-space.
2. `generateCandidates` does `territories.slice(0, count)` — takes the **first N**, with **no
   de-duplication and no diversity selection**.
3. `specifyBrand` runs per-territory in isolation, so concepts converge further.

### Decisions (locked during brainstorming)

- **Measure diversity via structured-axis tagging** (LLM), not embeddings (no dep, interpretable)
  or O(n²) pairwise judging.
- **Apply pressure as diverse SELECTION from an over-generated pool** — generators stay simple and
  parallel; all intelligence in one pure, deterministic, fixture-testable selector that replaces
  `slice(0, count)`.
- **Wedge fingerprint = (wedge, segment, tier)** — the three axes that actually drove the collapse.
- **Insufficient diversity → one bounded re-roll, then flag best-effort** — try to break the
  monoculture once, but never fabricate diversity; declare it (`lowConceptDiversity`).

---

## 1. Architecture

Impure edge (LLM tagging) separated from a pure, deterministic core (selection) — same shape as
the calibration layer (`fitCalibration` pure core, store/LLM at the edges).

```
Council.generateCandidates(count)
  ├─ proposeTerritories(perAgent=2)        ~16 raw territories (8 agents, unchanged, blind/parallel)
  ├─ tagWedges(territories)                WedgeTag[]    [IMPURE: one batched LLM classify call]
  ├─ selectDiverse(tagged, count, seed)    DiversitySelection  [PURE, deterministic]
  │     └─ if distinctWedgeCount < count -> ONE re-roll:
  │            proposeTerritories(avoid=spannedWedges) -> tag -> re-select from COMBINED pool
  │            then fill best-effort + flag lowConceptDiversity
  └─ specifyBrand(each selected territory) BrandConcept[]  (unchanged)
```

**New module:**
```text
src/council/diversity.ts
  types:    WedgeFingerprint, WedgeTag, DiversitySelection, DiversityReport
  tagWedges(territories, llm)   -> WedgeTag[]        (impure; batched; fail-clean)
  selectDiverse(tags, n, seed)  -> DiversitySelection (PURE)
src/council/diversity.test.ts   (pure selector tests + fake-LLM tag tests)
```

**Modified:**
- `src/council/council.ts` — `generateCandidates` over-generates, tags, selects, optional one
  re-roll; `proposeTerritories` gains optional `avoid?: string[]`; return shape becomes
  `{ concepts, diversity }`.
- `src/pipeline/tournament.ts` — additive `conceptDiversity?: DiversityReport` on
  `TournamentOutput` + report lines (same additive pattern as `calibration`).

No new dependencies. Tagging reuses `LLMClient.completeJson`; selection is pure TS reusing
`makeRng` from `src/arena/stats.ts`. Only `tagWedges` needs an LLM in tests (fake LLM); the
algorithmic risk lives in the pure selector, tested with fixtures.

---

## 2. Data model

```typescript
export interface WedgeFingerprint {
  wedge: string;     // positioning angle, normalized slug: "clean/non-toxic", "longevity", "gifting", ...
  segment: string;   // primary buyer segment, normalized slug: "sensitive-skin", "gen-z-value", ...
  tier: string;      // price tier; MUST be one of the pack's priceBands labels ("value" | "premium" | ...)
}

export interface WedgeTag {
  territoryIndex: number;      // index into input territories[] (stable join key)
  territoryName: string;       // for legible reporting
  fingerprint: WedgeFingerprint;
}

export interface DiversitySelection {
  selectedIndices: number[];   // chosen territory indices, in selection order
  distinctWedgeCount: number;  // # unique fingerprints among the SELECTED
  spannedWedges: string[];     // sorted unique `wedge` values among selected (legible)
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

// Attached to the tournament output (additive, like `calibration`)
export interface DiversityReport {
  requested: number;
  distinctWedgeCount: number;
  spannedWedges: string[];
  poolSize: number;            // territories tagged/selected from
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}
```

**Normalization contract (the key honesty detail):** `tagWedges` maps free-text positioning onto
short comparable tokens (lowercase, hyphenated, ≤3 words) and is instructed to **reuse an existing
token when two territories share an angle**, so wording differences don't masquerade as diversity.
`tier` is constrained to the pack's actual `priceBands` labels (cannot invent a tier). The pure
selector does exact-tuple matching on the normalized fingerprint — deterministic, no fuzzy
thresholds.

**Deliberate non-goals (YAGNI):**
- No numeric "diversity score 0..1" — `distinctWedgeCount` vs `requested` is the honest,
  interpretable measure; a synthesized score implies false precision.
- No moat fields now. `WedgeFingerprint` is reusable as the seed for the future moat-scoring
  sub-piece, but this piece adds none.

---

## 3. Selection algorithm (pure core)

`selectDiverse(tags: WedgeTag[], n: number, seed: number): DiversitySelection` — deterministic, no
LLM, no I/O.

**Greedy weighted-novelty pick over the fingerprint tuple:**

1. **Deterministic order.** Shuffle `tags` with `makeRng(String(seed))` then stable-sort, so ties
   resolve reproducibly. Same (pool, n, seed) → identical selection.
2. **Greedy fill.** Maintain `chosen` + running sets `usedFingerprints/usedWedges/usedSegments/
   usedTiers`. Until `chosen.length === n` or pool exhausted, score each remaining candidate by
   novelty in priority order:
   - `+1000` if its full `(wedge,segment,tier)` tuple is unused (a genuinely new wedge),
   - `+100` if `wedge` unused, `+10` if `segment` unused, `+1` if `tier` unused.
   Pick highest score; ties broken by the deterministic order. This maximizes distinct full
   tuples first, then spreads sub-axes — not merely "avoid exact dups."
3. **Honesty outputs.** `distinctWedgeCount = unique fingerprints among chosen`;
   `spannedWedges = sorted unique wedge values among chosen`.
4. `selectDiverse` reports the count honestly; it does NOT decide re-roll policy (the Council does).

**Worked examples:**
- Pool all `(clean,sensitive-skin,premium)` → picks 1 (+1000), rest score ~0 →
  `distinctWedgeCount=1`, `spannedWedges=["clean"]`. Honest monoculture. ✓
- Pool `(clean,sensitive,premium)`,`(longevity,everyday,value)`,`(gifting,luxury,premium)`,
  `(clean,sensitive,premium)`, n=4 → 3 distinct tuples chosen first, the dup last →
  `distinctWedgeCount=3`. ✓

**Why greedy, not exhaustive:** n≤~6, pool≤~16; greedy is O(n·pool), trivially correct, and
deterministic. The combinatorial optimum is unnecessary (YAGNI).

**Tests (pure, fixtures, no LLM):**
- all-identical pool → selects n, count=1, spannedWedges length 1.
- fully-distinct pool ≥ n → count===n; no repeat chosen before distinct exhausted.
- mixed (3 distinct + dups), n=4 → 3 distinct first, count=3.
- determinism: same (pool,n,seed) → identical `selectedIndices`; different seed only reorders ties,
  never lowers `distinctWedgeCount`.
- pool smaller than n → selects all, no crash, honest count.
- novelty priority: new-wedge candidate chosen over new-tier-only candidate.

---

## 4. Tagging, re-roll & Council integration (impure edge)

### 4a. `tagWedges(territories, llm)` — impure, batched, fail-clean
One `completeJson` call classifying ALL pool territories at once (cheaper; lets the model reuse
tokens across the batch).
- Input: territory list + the pack's `priceBands` labels.
- Output schema: `{ tags: [{ territoryIndex, wedge, segment, tier }] }`.
- Prompt rules: each axis a short slug (lowercase, hyphenated, ≤3 words); reuse the same token when
  two territories share an angle; `tier` MUST be one of the provided pack band labels.
- **Fail-clean:** on call failure or malformed/missing item, the untagged territory gets a sentinel
  `{ wedge: "untagged-<index>", segment: "unknown", tier: "unknown" }`. Sentinels are intentionally
  all-distinct, so tagging failure degrades to "treat as distinct" — it never *collapses* the slate
  into false duplicates. No throw.

### 4b. The one bounded re-roll (in `generateCandidates`)

`generateCandidates` gains a `seed` parameter — `generateCandidates(count, seed = 0)` — threaded
into `selectDiverse` so selection is reproducible across the same tournament seed. The caller
`src/pipeline/tournament.ts:58` passes `opts.seed` (already on `TournamentOptions`). Default `0`
preserves any existing direct callers/tests.

```
pool     = proposeTerritories(perAgent=2)                 // ~16
tags     = tagWedges(pool)
sel      = selectDiverse(tags, count, seed)
rerolled = false
if sel.distinctWedgeCount < count:
    avoid = sel.spannedWedges
    pool2 = proposeTerritories(perAgent=2, avoid)          // "these wedges are saturated, find others"
    tags2 = tagWedges(pool2)
    sel   = selectDiverse([...tags, ...tags2], count, seed) // select from COMBINED pool
    rerolled = true
if sel.distinctWedgeCount < count:
    sel.warning = "lowConceptDiversity"
concepts = selected territories -> specifyBrand(each)      // unchanged
return { concepts, diversity: DiversityReport{ requested:count, ...sel, rerolled, poolSize } }
```
- **Exactly one** re-roll bounds cost/non-determinism. Combined-pool re-select means a re-roll can
  only improve-or-equal diversity, never regress.
- `proposeTerritories` gains optional `avoid?: string[]` appended to the prompt; default `[]`
  preserves existing behavior/tests.
- Gated only on `distinctWedgeCount < count` — rich categories pass the first pool at zero extra
  cost.

### 4c. `generateCandidates` return-shape change
Today returns `BrandConcept[]`; becomes `{ concepts: BrandConcept[]; diversity: DiversityReport }`.
Single caller is the tournament pipeline (`tournament.ts:58`) — change it to
`const { concepts, diversity } = await council.generateCandidates(opts.candidates, opts.seed);`,
keep the existing empty-concepts guard, and add `conceptDiversity?: DiversityReport` to
`TournamentOutput` (additive/optional), assigned from `diversity`. `formatReport` gains lines after the
leaderboard:
```
Concept diversity: 3 of 4 distinct wedges [clean, longevity, gifting]
# on collapse:
⚠ LOW CONCEPT DIVERSITY — slate spans only 1 wedge [clean] (re-rolled once). Win-rates compare near-duplicates.
```
Absent `conceptDiversity` → nothing prints (non-breaking).

### 4d. Error handling / QUALITY map
| Principle | Satisfied by |
|---|---|
| Plausibility ≠ truth; declare known-unknowns | `lowConceptDiversity` warning + `distinctWedgeCount` surfaced on report + json |
| Fail loud, propagate degraded | warning propagates into report + json, not just a log line |
| Never fabricate | tagging failure → sentinel-distinct (never fake-collapse); no synthesized diversity score |
| Separate observation from inference | `tagWedges` (observe) vs `selectDiverse` (pure inference) |
| Reproducibility measured | deterministic seeded selection; same pool+seed → same slate |
| Bounded cost | exactly one re-roll; batched single tag call |

Failure modes:
- tag failure → sentinel-distinct fingerprints, no throw.
- re-roll `proposeTerritories` failure → catch → keep first selection + flag (best-effort).
- `specifyBrand` failure on a selected territory → existing behavior (warn + drop null), unchanged.

### Tests
- `tagWedges` (fake LLM): well-formed batch → correct fingerprints; malformed/failed →
  sentinel-distinct, no throw; `tier` constrained to pack bands.
- integration (fake LLM + fixture territories): collapsed pool → triggers re-roll → flags
  `lowConceptDiversity`; rich pool → no re-roll, no warning; `generateCandidates` returns concepts
  + correct `DiversityReport`.
- report: warning line renders on collapse; absent diversity prints nothing; non-collapse renders
  the "N of M distinct wedges" line.

---

## Out of scope

- Moat scoring per concept (defensibility sub-piece B — proprietary wedge, switching cost,
  copyability). `WedgeFingerprint` is the seed for it, but no moat logic here.
- Embedding-based similarity; numeric diversity scores.
- Sequential avoid-list generation (rejected in favor of diverse selection).
- More than one re-roll.
- Changing the 8-agent blind proposal step itself (we add diversity downstream, not by
  re-architecting the agents).
