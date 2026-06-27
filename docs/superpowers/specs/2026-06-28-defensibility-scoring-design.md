# Design: Defensibility / Moat Scoring (#5B)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #5B — defensibility scoring (follows #5A concept diversity).

---

## Context

#5A stopped the Council from producing near-duplicate concepts, so the slate now spans distinct
positioning wedges. But a concept can be distinct *and* indefensible — anyone can ship "clean
fragrance for sensitive skin." The arena win-rate measures *appeal under blind choice*; it says
nothing about *whether the idea survives being copied*.

This piece adds a per-concept **moat score**: an LLM rubric rates each generated concept on four
defensibility axes (0..1 + a rationale each), rolled up to an equal-weight overall. It is reported
**side-by-side with win-rate, never blended** — a concept can win the arena yet be a commodity, and
the operator must see both honestly. Scoring is **opt-in** (`--moat`) since it's one extra LLM call.

### Decisions (locked during brainstorming)

- **Separate, side-by-side** with win-rate (additive, never blended/re-ranked).
- **LLM rubric per axis**, 0..1 + one-sentence rationale each.
- **4 axes:** copyability (resistance), proprietary insight, distribution/wedge, brand-trust
  durability. All oriented **higher = more defensible**.
- **Roll-up:** equal-weight mean, always shown with the per-axis breakdown.
- **Opt-in** via `--moat` (default off; non-breaking).
- **v1 input drops the #5A wedge fingerprint** (not plumbed to the tournament): `distributionWedge`
  is judged from positioning/coreInsight + competitor archetypes. (Future enhancement.)

---

## 1. Architecture

Pure roll-up core + impure LLM rubric edge, wired additively — same shape as calibration/diversity.

```
runTournament (after scoring, before writing out; only if --moat)
   scoreMoat(concepts, pack, llm)        [IMPURE: one batched LLM rubric call, fail-clean]
       → per concept: 4 axis scores (0..1) + rationale
   rollUp(axes)                          [PURE: equal-weight mean, clamped]
   MoatReport attached to TournamentOutput (additive)
   formatReport renders per-concept moat line + axis breakdown
```

**New module:**
```text
src/moat/
  types.ts    MoatAxisName, MoatAxis, MoatScore, MoatReport
  rollup.ts   rollUp(axes) -> number   (PURE)
  rubric.ts   scoreMoat(concepts, pack, llm) -> MoatScore[]   (impure, batched, fail-clean)
  *.test.ts
```

**Modified:**
- `src/pipeline/tournament.ts` — `moat?: boolean` option; call `scoreMoat` when set; additive
  `moat?: MoatReport` field; `formatReport` block.
- `src/cli.ts` — `--moat` flag on the `tournament` case.

Reuses `BrandConcept` fields, `pack.competitorArchetypes`, the `LLMClient` pattern. `scoreMoat`
constructs its own `new LLMClient()` (the tournament does not expose one — `Council` makes its own);
tests inject a fake `{ completeJson }`. No new dependencies.

**Opt-in rationale:** moat scoring is one extra batched LLM call. Default off; when off, `moat` is
absent and nothing changes (non-breaking).

---

## 2. Data model

```typescript
export type MoatAxisName =
  | "copyability"          // RESISTANCE to copying (1 = very hard to copy, 0 = trivial commodity)
  | "proprietaryInsight"   // non-obvious truth behind it (1 = unique, 0 = generic)
  | "distributionWedge"    // channel / positioning edge (1 = strong wedge, 0 = none)
  | "brandTrustDurability";// builds defensible affinity (1 = durable, 0 = forgettable)

export const MOAT_AXES: MoatAxisName[] =
  ["copyability", "proprietaryInsight", "distributionWedge", "brandTrustDurability"];

export interface MoatAxis {
  name: MoatAxisName;
  score: number;           // 0..1, clamped
  rationale: string;       // short, grounded in the concept/competitors
}

export interface MoatScore {
  conceptId: string;
  name: string;
  axes: MoatAxis[];        // the 4 axes, canonical order
  overall: number;         // 0..1, equal-weight mean
  warnings: string[];      // e.g. "axis defaulted: missing from LLM output"
}

export interface MoatReport {
  scored: number;          // concepts with zero warnings (cleanly scored)
  concepts: MoatScore[];   // sorted by overall desc
  degraded: boolean;       // any concept had a warning / the call failed
}
```

**Orientation (honesty detail):** every axis is **higher = more defensible**, including
`copyability` scored as *resistance* (1 = hard to copy). The rubric states this so the LLM cannot
invert it; the equal-weight mean is then meaningful with no sign-flipping.

**Rubric context fed per concept:** the concept's `positioning, coreInsight, productPromise, claims,
priceBand, targetCustomer` + `pack.competitorArchetypes` (so copyability/wedge are judged relative
to who's already there). No wedge fingerprint in v1.

**Validation / fail-clean:**
- Each axis `score` clamped `[0,1]`; missing/non-numeric → default `0.5` (neutral — a known-unknown,
  not weakness=0 or strength=1) + a warning; rationale marked "(not scored)".
- Concept missing entirely from LLM output → all-neutral axes + warnings; contributes to `degraded`.
- `overall` = equal-weight mean of the 4 axes; never a synthesized weighting.

**Non-goals (YAGNI):** no CI on moat (rationale is the uncertainty surface); no per-axis weights;
no blending/re-ranking with win-rate; no benchmark/competitor scoring (moat is for *our* concepts).

---

## 3. Roll-up (pure) + rubric scoring (impure)

### 3a. `rollUp(axes: MoatAxis[]): number` — pure
Equal-weight mean of axis scores, clamped `[0,1]`. Empty → `0`. Isolated so the "how we combine"
choice never entangles with the LLM call.

### 3b. `scoreMoat(concepts, pack, llm, opts?): Promise<MoatScore[]>` — impure, batched, fail-clean
One `completeJson` call scoring ALL concepts at once (cheaper; lets the model compare them against
the same competitor set).

- **Input:** each concept's `{id, name, positioning, coreInsight, productPromise, claims, priceBand,
  targetCustomer}` + `pack.competitorArchetypes` (codeName/description/strengths/weaknesses).
- **Rubric:** score each concept on the 4 axes, **0..1, higher = more defensible**, with the
  copyability=resistance orientation note; each axis needs a **one-sentence rationale grounded in the
  concept/competitors** (no generic filler).
- **Output schema:** `{ scores: [{ conceptId, axes: [{ name, score, rationale }] }] }`.
- **Anti-inflation guard (in prompt):** "Most generic D2C concepts are easy to copy — reserve high
  copyability-resistance for genuinely hard-to-replicate ideas. Do not give every concept high
  scores." (Counters the rate-everything-0.7 tendency.)

**Assembly (per concept):**
1. Join LLM output to concepts by `conceptId`.
2. For each of the 4 canonical axes (in `MOAT_AXES` order): LLM score if present + numeric → clamp
   `[0,1]`; else `0.5` + warning.
3. `overall = rollUp(axes)`.
4. Concept missing from output → all-neutral axes + warning (degraded).

**Fail-clean:**
- LLM throws / malformed → **every** concept all-neutral + warning; never throws, never fabricates a
  confident moat. A degraded report still renders, flagged.
- Missing/non-string rationale → kept with `"(no rationale)"`, flagged.

**Why neutral 0.5 default:** a missing axis is a known-unknown, not evidence either way; neutral +
explicit warning is the honest representation and keeps `overall` computable (same doctrine as the
calibration sentinel).

### Tests
- `rollUp` (pure): equal-weight mean; clamp both ends; empty → 0; single axis → itself.
- `scoreMoat` (fake LLM): well-formed → 4 axes/concept, correct overall; missing axis → 0.5 +
  warning; concept missing from output → all-neutral + warning + degraded; LLM throws → all neutral,
  degraded, no throw; out-of-range/non-numeric → clamped/defaulted; orientation preserved (a
  returned `copyability:0.1` stays 0.1, no sign-flip).

---

## 4. Tournament/report wiring, CLI, error handling

### 4a. `runTournament` integration (opt-in, additive)
```typescript
// after the headline `report` is scored, before building `out`:
let moat: MoatReport | undefined;
if (opts.moat) {
  const moatScores = await scoreMoat(concepts, pack, new LLMClient());
  moat = {
    scored: moatScores.filter((m) => m.warnings.length === 0).length,
    concepts: [...moatScores].sort((a, b) => b.overall - a.overall),
    degraded: moatScores.some((m) => m.warnings.length > 0),
  };
}
const out: TournamentOutput = { ...existing, moat };
```
- Scores **generated concepts only** (not benchmark/competitor).
- One extra batched LLM call, only when opted in.

### 4b. `TournamentOptions`
Add `moat?: boolean;` (default false). `moat?: MoatReport` added to `TournamentOutput` (optional →
non-breaking).

### 4c. `formatReport` block (after leaderboard, alongside calibration/diversity)
```
Moat (defensibility, opt-in):
  LipCraft            overall 0.61  [copy 0.70 · insight 0.65 · wedge 0.60 · trust 0.50]
    copyability: bespoke blend-kit + interactive flow is harder to clone than a single SKU.
  SunShield Lip Balm  overall 0.42  [copy 0.30 · insight 0.55 · wedge 0.50 · trust 0.35]
    copyability: SPF+hydration combo is common; easily matched by incumbents.
⚠ moat degraded — some axes defaulted to neutral (see warnings).   # only when degraded
```
Shows overall + per-axis breakdown (never the number alone) + the top concept's rationales. Absent
when `--moat` not set → nothing prints (non-breaking).

### 4d. CLI
```bash
bun run tournament --category=lipcare-india --mode=deep --moat --candidates=4 --cohort=40
```
`flag("moat")` → `moat: true` on the `tournament` options. (Skip `winrate` — it prints only a
number.)

### 4e. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| `--moat` not set | no scoring, no LLM call, `moat` absent (non-breaking) |
| LLM fails/malformed | all-neutral axes, `degraded=true`, report renders with ⚠ |
| concept missing from output | neutral axes + warning + degraded |
| axis missing/non-numeric | neutral 0.5 default + warning (missing ≠ weakness) |
| no generated concepts | `moat` absent |

Doctrine: moat is a **declared judgment, never blended** with win-rate; every score ships with a
rationale (the uncertainty surface) and a breakdown (never a lone number); failures degrade loudly
(`degraded` + ⚠), never silently fabricating a confident moat.

### 4f. Tests
- `rollUp` + `scoreMoat` (§3).
- dispatch: `opts.moat:true` attaches `moat`; absent when off (non-breaking); only generated
  concepts scored.
- report: moat block renders overall + axis breakdown; degraded flag renders; absent when off.
- CLI smoke: `--moat` sets the flag (light).

---

## Out of scope
- Feeding the #5A wedge fingerprint into the rubric (needs Council plumbing; future enhancement).
- Blending/re-ranking the leaderboard by moat.
- Per-axis weights, confidence intervals, or deterministic moat heuristics.
- Scoring benchmark/competitor brands.
- Frontend surface (CLI/report is the interim).
