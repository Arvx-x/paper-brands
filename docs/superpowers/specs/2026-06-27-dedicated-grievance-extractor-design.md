# Design: Dedicated Grievance Extractor (Containment-Only Persona Grounding)

**Date:** 2026-06-27
**Status:** Approved
**Repo target:** `paper-brands`

---

## Context

Persona grounding is wired and works when `pack.groundedGrievances[]` contains verified grievances. But real public runs often produce `groundedGrievances: []` because the pack-level `rejectionReasons`/`unmetNeeds` path is too broad and strict: it depends on the CategoryPack generator emitting complaint items that later pass quote attribution. In recent `lip balm` and `vitamin C serum` runs, this yielded 0 verified grievances despite complaint/review raw sources existing.

We need a dedicated extractor that reads raw review/complaint source text directly and produces `GroundedGrievance[]` for persona grounding.

---

## Architecture

```
Corpus.sources[]
  -> select customer-voice-ish sources
  -> chunk rawText
  -> LLM extracts { anxiety, verbatimQuote, segment }
  -> containment verify quote in rawText
  -> dedupe by normalized quote
  -> pack.groundedGrievances[]
```

New module:

```text
src/personas/grievanceExtract.ts
```

Inputs:
- `SourceDoc[]` from the harvest corpus (`finalUrl`, `sourceClass`, `independent`, `rawText`)
- buyer segments (`{ seed: string }[]`)
- optional LLM client and limits

Output:
- verified `GroundedGrievance[]`

---

## Source filtering

Include likely customer voice:
- Always include `sourceClass === "community"` or `sourceClass === "marketplace"`
- Include `sourceClass === "unknown"` only when raw text contains review/complaint markers:
  - `review`, `rating`, `stars`, `complaint`, `doesn't work`, `stings`, `irritation`, `fake`, `oxidized`, `breakout`, `no results`, `refund`, `waste`, `burning`, `rash`, `smell`, `texture`
- Exclude `brand`, `affiliate`, `editorial` by default for persona grounding

Rationale: marketplace/community complaints are real shopper anxieties, even if not independent sources. We preserve `sourceClass`/`independent` on each grievance so operators can see source mix.

---

## Extraction prompt

For each selected source chunk, ask the LLM to extract concrete shopper complaints/anxieties:

```json
{
  "grievances": [
    {
      "anxiety": "short distilled fear",
      "verbatimQuote": "exact phrase copied from the text",
      "segment": "one exact buyer segment seed"
    }
  ]
}
```

Rules in prompt:
- `verbatimQuote` must be copied exactly from the raw text
- complaints must be product-use or purchase-decision relevant
- segment must be one of the exact provided segment seeds
- max 8 per chunk
- return empty array when the chunk lacks real shopper complaints

---

## Verification

Containment-only:

```typescript
verified = normalize(rawText).includes(normalize(verbatimQuote))
```

If false, drop it. No entailment model; no independence requirement.

Reason: this is persona grounding, not legal claim substantiation. The key truth requirement is that the anxiety came from a real shopper text. Entailment would reduce recall and recreate the 0-grievance failure.

---

## Dedupe and limits

- Deduplicate by normalized `verbatimQuote`
- Default max total grievances: `PB_GRIEVANCE_MAX ?? 100`
- Default max per source chunk: 8
- Process selected sources until max is reached

---

## Integration

In `buildCategoryPack`, after attribution and before known-unknowns are finalized:

1. Run `extractGroundedGrievances(brief.sources, pack.buyerSegments, llm)` when `brief.sources` exists.
2. If the dedicated extractor returns non-empty, assign `pack.groundedGrievances = extracted`.
3. Else fall back to the existing verified `rejectionReasons`/`unmetNeeds` path.
4. `buildCohort` remains unchanged: it consumes `pack.groundedGrievances` and reports `groundingCoverage`/`cohortDiversity`.

This keeps the extractor additive and backward-compatible.

---

## Error handling

- No selected sources -> `[]`, no throw
- LLM extraction failure for a chunk -> skip that chunk
- Invalid segment -> drop item
- Non-contained quote -> drop item
- Empty result -> fall back to current path / invention

No fabrication: if no verified grievances can be extracted, groundingCoverage remains 0.

---

## Tests

Unit tests (no network):
- source filtering includes marketplace/community
- unknown source included only with complaint markers
- brand/editorial/affiliate excluded
- containment verification keeps exact quotes and drops hallucinated quotes
- dedupe by normalized quote
- invalid segment dropped
- extraction failure returns empty / skips chunk

Integration tests with fake LLM:
- selected raw source -> `extractGroundedGrievances` returns verified grievances with sourceUrl/sourceClass
- no complaint text -> empty result

Live test:
- rerun `bun run intel --category="vitamin C serum" --geo="India" --currency=INR --ground`
- expected: `pack.groundedGrievances.length > 0`
- run small deep tournament: expected `Persona grounding: >0%`

---

## Out of scope

- Entailment verification
- OCR/prescription data
- Calibration
- UI observatory
