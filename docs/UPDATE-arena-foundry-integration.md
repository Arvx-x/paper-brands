# Update: Arena → Foundry Integration (and what came after)

**Date:** 2026-06-27
**State:** `origin/main` @ `a9367a5` — local `main` matches remote. 108 tests passing.

## TL;DR

We pulled the foundry from remote and wired the **synthetic buyer arena** into it, then hardened
the pipeline end-to-end: real-brand benchmarking, persona grounding from real shopper voice, and
free-source harvest. The platform now runs a full **category → council → grounded synthetic
buyers → blind tournament → win-rate** loop on live data — with the win-rate honestly labeled as an
uncalibrated hypothesis, not a forecast. The next layer (calibration + brand equity) is specced and
in progress on the `calibration-layer` branch.

## What we did, in order

1. **BuyerArena seam + deep arena.** Extracted a `BuyerArena` interface; built
   `DeepNegotiationArena` (negotiate-vs-each blind option, engine-gated decisions, structured PDP
   cards, Wilson confidence intervals, multi-seed, honest abstention/error rates). Merged alongside
   the existing single-shot arena. CLI `--deep` selects it.

2. **Real-brand benchmarking (Level 1).** Disguised real brands into the blind slate (audit-only;
   names/metrics never leak), added a traction score and `calibrationPairs` + a Spearman
   `correlationCheck` self-test. **Key finding:** blind win-rate correlates with public real-brand
   traction only at ρ≈0.5 — because the arena strips brand equity. This is a definitive go/no-go: a
   win-rate alone cannot be trusted as a real-world forecast.

3. **Perf.** Per-persona options parallelized (deterministic, `PB_OPTION_CONCURRENCY`).

4. **Persona grounding.** Personas are now reconstructed from **real shopper complaints**, not
   invented: a dedicated grievance extractor reads raw review/community text (containment + LLM
   verifier, fail-closed), feeds `groundedGrievances[]` into cohort building, and reports
   `groundingCoverage` / `cohortDiversity`.

5. **Free-source harvest hardening.** Wired web search into multi-domain research (1→6 independent
   domains); added Reddit comment-tree, JSON-LD, Trustpilot/Next.js, and YouTube extractors with
   clean fallbacks (Reddit→Tavily snippet on 403, YouTube→Jina reader). No paid rendering.

6. **Live E2E verified** for vitamin C serum, niacinamide, and lip care: harvest → grounded intel →
   deep tournament with real win-rates and grounding coverage.

## What this means

The arena is now a **first-class, grounded stage inside the foundry**, not a bolt-on. But its
output is honestly an *uncalibrated hypothesis filter*: good for ranking and prioritizing
candidates, not yet trustworthy as a PMF go/no-go. The proven ρ≈0.5 ceiling is why the next piece
matters.

## In progress (branch: `calibration-layer`)

**Piece #2 — the calibration layer (the moat).** A source-agnostic store of `(synthetic, real)`
observation pairs + a fit engine + an honesty gate, so every reported win-rate is labeled
`UNCALIBRATED` / `WEAK` / `CALIBRATED (±CI)` and upgrades to evidence as real outcomes are recorded.

Two decisions locked into the spec:
- **Calibration target = our own fake-door PDP smoke tests** (intent CTR) — staged by piece #3,
  funded by us.
- **Brand equity added as a bivariate term** — `real ≈ a·blind_appeal + b·equity + c`, where
  equity is a *separate, separately-sourced* composite (search + distribution + social), learned
  from real pairs (never hand-set), reported as a decomposition, and degrading cleanly to
  univariate when no equity data exists. This is the principled path to push past ρ≈0.5 without
  contaminating the blind win-rate.

Spec: `docs/superpowers/specs/2026-06-27-calibration-layer-design.md` (pending review →
writing-plans → TDD execution).
