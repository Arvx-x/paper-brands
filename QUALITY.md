# QUALITY.md — Operating Contract for the Brand Foundry

> The foundry's job is to find brand concepts **worth building**. That promise rests entirely on
> each step being **accurate, statistically significant, representative of real-world truth, and
> free of bias**. This document is the contract every step must satisfy. It exists because the
> price layer taught us the core lesson: **plausible, well-formed output can be completely
> untrustworthy, and the failure is silent.** We design against that, systematically — not reactively.

Derived from an adversarial review (3 independent judges) of the Market Intelligence step. Applies
to every step; written against Market Intelligence first.

---

## Part 1 — Guiding Principles

Every iteration must be checkable against these. A principle that can only be satisfied by a warning
no downstream consumer reads, or by a number with no defined meaning, is theatre.

### A. Evidence integrity
1. **Plausibility ≠ truth.** Every field is a *hypothesis* until bound to evidence. Hypothesis-status
   travels *with the claim*, not as a single global `grounded` flag.
2. **Bind claims to RAW sources, not paraphrases.** Each claim carries a *verbatim quote + source URL
   + source-class*, validated by literal string-containment against stored **raw** snippets. Counting
   themes in an LLM's summary measures the summarizer, not the market (construct validity).
3. **Separate observation from inference, structurally.** The schema must distinguish an observed
   quote from an inferred conclusion, or the separation is unverifiable.
4. **Grounding bar scales with stakes.** Compliance/claims (legal liability) require primary-source
   (regulator) citations; aesthetics tolerate softer evidence. The highest-stakes fields (segment
   weights, price bands, compliance) get the *strictest* bar — today they have the weakest.
5. **Weight sources by independence & incentive.** Diversity is over *incentive-classes*
   (independent-UGC / editorial / brand / affiliate / marketplace), never raw domain count. 63
   affiliate-SEO domains pushing the same top-5 are one viewpoint in 63 hats.

### B. Statistical integrity (the pillar the first draft lacked)
6. **No aggregate without a defined population, an *effective* (independent) sample size, and
   propagated uncertainty.** No %/share/weight without a named denominator. The same source surfacing
   across lenses/providers is **one** observation, not corroboration (pseudo-replication).
7. **Magnitude with sample size, not existence.** "31% of 1★ reviews (n=212) cite stickiness" beats a
   bare list. Lists without frequency/intensity/share + n + CI are near-worthless.
8. **Weight by reality (sales/volume), not catalog/search-surfaced count.**
9. **Aggregates must beat a null model and be stable under resampling.** Price tiers require a
   gap/null test + bootstrap CI; reject degenerate bands (`low==high`).
10. **Missing data ≠ null finding.** A failed/empty retrieval must NEVER license a "no need /
    well-served" conclusion. Distinguish "queried, found nothing" from "query failed."
11. **Reproducibility is MEASURED, not asserted.** Test/retest across resampled evidence and models —
    not `temperature:0`. Determinism of a biased estimate is not robustness; it hides variance.

### C. Epistemic integrity
12. **Seek disconfirmation, not just corroboration.** Each surfaced claim gets a red-team pass that
    tries to falsify it. A market-intel pack with no falsification lens is an advocacy document.
13. **Independence is measured, not assumed.** Two web-trained LLMs share priors. A verifier checks
    claims against *sources*, and its independence is tested empirically (disagreement on seeded
    falsehoods).
14. **Name positionality; allow the null verdict.** The schema must permit "do not enter / saturated /
    commoditized." Today's ontology (needs/triggers/objections) encodes a seller's worldview as
    neutral truth and can only ever manufacture an opening.
15. **Declare known-unknowns; calibrate against real outcomes.** Every pack ships `knownUnknowns[]`
    (e.g. no Hindi data, off-season, no offline/kirana channel) and, where possible, is calibrated
    against real-world signal.
16. **Account for the invisible (survivorship) at both levels** — market (non-buyers, rejected-at-shelf)
    and pipeline (truncated/dropped content, language/channel skew).

### D. Process integrity
17. **Fail loud AND hard.** `degraded` must HALT or propagate into downstream weighting/gating — not
    just log a warning the consumer never reads.
18. **Time/season-stamp and correct.** Record harvest season vs category seasonality; a single
    snapshot of a seasonal category is flagged non-representative.
19. **Harden the plan first.** Source selection upstream dominates everything. Require source-class +
    language + channel + **regulatory** lens coverage, plus open-ended discovery queries to counter the
    plan's own framing/anchoring bias.
20. **Respect category, channel & geo boundaries.** Never conflate sub-products (balm vs mask vs oil),
    channels (pharmacy vs beauty vs quick-commerce vs general-trade), or geographies/currencies
    (foreign grey-market ≠ domestic). Stratify; flag when one stratum dominates the sample.

---

## Part 2 — Cross-cutting failure modes (the catalog)

Every dimension is checked against these:

| # | Failure mode | Tell |
|---|---|---|
| F1 | Plausible fabrication | Well-formed output with no traceable source |
| F2 | Silent degradation | Thin/failed sub-step produces plausible result, ships anyway |
| F3 | Construct invalidity | Measuring the paraphraser/query-design, not the market |
| F4 | Pseudo-replication | One source counted as N independent signals across lenses/providers |
| F5 | No valid denominator | %/share/weight over a non-population |
| F6 | Aggregation/clustering artifact | Tiers/segments are an algorithm artifact, no null model/CI |
| F7 | Missing-data → null finding | Failed retrieval read as "no need" |
| F8 | Sampling/selection bias | Search-rank, English-only, one channel/geo, extreme-review tails |
| F9 | Survivorship (market + pipeline) | Non-buyers invisible; long/negative content truncated away |
| F10 | Stated ≠ revealed | Self-report taken over behavior |
| F11 | Quota pressure | "give 5–7 X" manufactures count |
| F12 | Unit/semantics/stratum mismatch | Per-unit, MRP-vs-street, mixed subtypes/channels/currencies |
| F13 | Monoculture / non-independent verifier | Generator ≈ verifier; correlated errors uncaught |
| F14 | Non-reproducibility unmeasured | Re-harvest would differ; never diffed |
| F15 | Incentive bias as neutral evidence | Affiliate/sponsored/brand copy treated as customer voice |
| F16 | Temporal/seasonal snapshot | One timestamp of a seasonal category |
| F17 | No falsifiability / no audit trail | Anonymization + truncation destroy claim→source link |
| F18 | Manufacture-opportunity framing | Schema cannot express "no opportunity" |
| F19 | Stakes/grounding inversion | Highest-stakes fields have weakest evidence |

---

## Part 3 — Per-dimension hardening template

For each dimension, define and satisfy: **(T)** truth it approximates · **(A)** ground-truth anchor ·
**(B)** required evidence binding · **(F)** dominant failure modes · **(C)** confidence signal ·
**(V)** verification gate · **(D)** done criteria.

| Dimension | (T) Truth | (A) Anchor | (B) Binding | (C) Confidence from | (V) Gate |
|---|---|---|---|---|---|
| **complianceNotes** | Binding legal/regulatory constraints | Primary regulators (CDSCO, Legal Metrology, ASCI, AYUSH for IN) | Each note cites a `.gov.in`/regulator source + jurisdiction + date | Regulatory-source coverage; regime classifier pass | Refuse `complianceGrounded:true` without regulator citation; flag SPF/medicated/anti-aging → drug regime |
| **buyerSegments + weights** | Who buys, in what proportion | Sales/traffic/demographic data | Weight cites its basis; else labeled `estimate` | Denominator validity; source independence | No weight without named denominator → else mark estimate + low conf; MECE check |
| **competitorArchetypes** | Real competitive structure | Clusters of real harvested SKUs/brands + review sentiment + sales-rank | Each archetype maps to ≥1 real cluster (audit-only real names) | Share-of-market weighting; sentiment grounding | Reject archetype with no real-cluster backing; keep reversible brand map |
| **priceBands** | Where buyers transact | Real SKUs, volume-weighted, per-unit, per-channel | Bands carry n, CI, channel, subtype mix | Effective n, CI width, null-model pass | Reject `low==high`; stratify by subtype/channel; CI-width gate |
| **unmetNeeds** | Genuine underserved demand | Frequency across distinct real reviews; ideally behavioral (returns) | Each need: verbatim quote + URL + count/n | Magnitude + independent-source count | No need without quote that literally appears in corpus; disconfirmation pass |
| **rejectionReasons** | Why purchase doesn't happen | Non-buyer/cart-abandon signal (often absent → low conf) | Quote + URL | Survivorship-aware coverage | Label survivorship gap explicitly; never infer from buyer reviews alone |
| **purchaseTriggers** | What moves a buyer | Conversion/attribution data | Quote + URL | Base-rate presence | Label as hypothesis where no base rate exists |
| **wellMetNeeds** | Where incumbents win (gap counterweight) | Same as unmetNeeds | Quote + URL | Same as unmetNeeds | Required; balances manufacture-opportunity bias |
| **research plan / lenses** | The evidence universe | — | — | Source-class + language + channel + regulatory coverage | Require regulatory + vernacular + discovery lenses; diversity floor |
| **evidence/citations** | Factual substrate | Raw page text (not provider summary) | Store raw snippet + resolved domain + date + source-class | Distinct independent domains; redirect-resolved | Verify a sample of URLs; resolve redirects; date every fact |

---

## Part 4 — Hardening roadmap (stakes × current-untrustworthiness)

0. **Evidence-attribution layer (FOUNDATION, do first).** Store raw source snippets (not just provider
   summaries); every pack claim carries `{verbatimQuote, sourceUrl, sourceClass}` validated by literal
   containment; confidence becomes `f(attribution-rate, independent-source diversity, effective n)` —
   not raw counts; separate missing-data from null. *Precondition for everything below.*
1. **complianceNotes** — regulatory lens + claim→regime classifier + primary-source citations. Highest
   stakes (externalized legal liability), currently zero regulatory grounding.
2. **Category / channel / geo boundary integrity** — stratify; flag dominance; geo-fence prices.
   Poisons every other dimension when violated.
3. **buyerSegment weights** — denominator-or-label; stop silently biasing the arena cohort.
4. **priceBands** — denominator + bootstrap CI + null-model for tiers (structure mostly done; add
   uncertainty).
5. **competitorArchetypes** — cluster from real brands + sentiment + share weighting.
6. **needs / triggers / rejections** — magnitude from real spans + disconfirmation + survivorship labels.

---

## Part 5 — Definition of "hardened" (the gate to move on)

A dimension is hardened when, on a live run:
- every emitted item is bound to a verbatim quote that literally appears in stored raw evidence (or is
  explicitly labeled an estimate/hypothesis with a reason);
- it carries a per-dimension confidence derived from independence + magnitude + uncertainty, not raw
  volume;
- missing-data and null-finding are distinguishable;
- a degraded result is propagated/gated downstream, not merely logged;
- an independent verifier (different model, checking against sources) and a disconfirmation pass have
  run, with their disagreement recorded;
- `knownUnknowns[]` for the dimension are declared.
