# Dedicated Grievance Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract verified `GroundedGrievance[]` directly from raw review/complaint source text so persona grounding fires reliably on public corpora.

**Architecture:** Add `src/personas/grievanceExtract.ts`: source filtering, LLM extraction, containment verification, dedupe, limits. Wire it into `buildCategoryPack` before falling back to the older rejectionReasons/unmetNeeds path. Keep all failure modes fallback-safe.

**Tech Stack:** Bun + TypeScript, Zod, existing `LLMClient`, existing `SourceDoc` and `GroundedGrievance` types.

---

## Task 1: Pure source filtering + containment helpers

**Files:**
- Create: `src/personas/grievanceExtract.ts`
- Test: `src/personas/grievanceExtract.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test, expect } from "bun:test";
import { shouldUseSourceForGrievances, containsQuote, dedupeByQuote } from "./grievanceExtract.ts";

const src = (sourceClass: string, rawText: string) => ({ finalUrl: "u", sourceClass, independent: sourceClass === "community", rawText }) as any;

test("source filtering includes marketplace/community and excludes brand/editorial", () => {
  expect(shouldUseSourceForGrievances(src("marketplace", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("community", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("brand", "review stings"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("editorial", "review stings"))).toBe(false);
});

test("unknown source included only when complaint markers appear", () => {
  expect(shouldUseSourceForGrievances(src("unknown", "this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("unknown", "best vitamin c serum guide"))).toBe(false);
});

test("containment verification normalizes case/punctuation/spacing", () => {
  expect(containsQuote("This serum STINGS badly!", "serum stings badly")).toBe(true);
  expect(containsQuote("This serum works well", "caused rash")).toBe(false);
});

test("dedupe by normalized quote", () => {
  const items = [
    { verbatimQuote: "It stings badly!", anxiety: "stinging", segment: "s" },
    { verbatimQuote: "it stings badly", anxiety: "burning", segment: "s" },
    { verbatimQuote: "turned orange", anxiety: "oxidation", segment: "s" },
  ];
  expect(dedupeByQuote(items).map((i) => i.verbatimQuote)).toEqual(["It stings badly!", "turned orange"]);
});
```

- [ ] **Step 2: Run failing test**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievanceExtract.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement helpers**

Create `src/personas/grievanceExtract.ts` with:

```typescript
import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import type { GroundedGrievance } from "../categories/types.ts";
import type { SourceDoc } from "../scrape/sources.ts";

const MARKER_RE = /review|rating|stars?|complain|doesn'?t work|sting|irritat|fake|oxidiz|breakout|no results?|refund|waste|burn|rash|smell|texture/i;
const ALLOWED_CLASSES = new Set(["marketplace", "community"]);
const EXCLUDED_CLASSES = new Set(["brand", "affiliate", "editorial"]);

export function shouldUseSourceForGrievances(s: Pick<SourceDoc, "sourceClass" | "rawText">): boolean {
  if (ALLOWED_CLASSES.has(String(s.sourceClass))) return true;
  if (EXCLUDED_CLASSES.has(String(s.sourceClass))) return false;
  return MARKER_RE.test(s.rawText || "");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function containsQuote(rawText: string, quote: string): boolean {
  const q = norm(quote);
  return q.length > 8 && norm(rawText).includes(q);
}

export interface ExtractedGrievance {
  anxiety: string;
  verbatimQuote: string;
  segment: string;
}

export function dedupeByQuote<T extends { verbatimQuote: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = norm(it.verbatimQuote);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
```

- [ ] **Step 4: Run passing tests + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievanceExtract.test.ts && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/personas/grievanceExtract.ts src/personas/grievanceExtract.test.ts
git commit -m "feat(personas): grievance source filtering + containment helpers"
```

---

## Task 2: LLM extractor with containment verification

**Files:**
- Modify: `src/personas/grievanceExtract.ts`
- Test: `src/personas/grievanceExtract.test.ts`

- [ ] **Step 1: Add tests**

Append to test file:

```typescript
import { extractGroundedGrievances } from "./grievanceExtract.ts";

const fakeLlm = {
  completeJson: async () => ({ grievances: [
    { anxiety: "stinging fear", verbatimQuote: "serum stings badly", segment: "sensitive skin buyer" },
    { anxiety: "hallucinated", verbatimQuote: "not in source", segment: "sensitive skin buyer" },
    { anxiety: "bad segment", verbatimQuote: "turned orange", segment: "wrong segment" },
  ] }),
} as any;

test("extractGroundedGrievances keeps only contained quotes with valid segments", async () => {
  const sources = [{ finalUrl: "u", sourceClass: "marketplace", independent: false, rawText: "This serum stings badly and turned orange fast." }] as any;
  const out = await extractGroundedGrievances(sources, [{ seed: "sensitive skin buyer" }], fakeLlm, { maxTotal: 10 });
  expect(out).toHaveLength(1);
  expect(out[0]!.verified).toBe(true);
  expect(out[0]!.anxiety).toBe("stinging fear");
  expect(out[0]!.sourceUrl).toBe("u");
  expect(out[0]!.sourceClass).toBe("marketplace");
});

test("extractGroundedGrievances returns [] when no usable sources", async () => {
  const out = await extractGroundedGrievances([{ finalUrl: "u", sourceClass: "brand", independent: false, rawText: "stings" }] as any, [{ seed: "s" }], fakeLlm);
  expect(out).toEqual([]);
});
```

- [ ] **Step 2: Run failing test**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievanceExtract.test.ts`
Expected: extractGroundedGrievances not exported.

- [ ] **Step 3: Implement extractor**

Append to `grievanceExtract.ts`:

```typescript
const ExtractSchema = z.object({
  grievances: z.array(z.object({
    anxiety: z.string(),
    verbatimQuote: z.string(),
    segment: z.string(),
  })).default([]),
});

function chunkText(s: string, max = 8000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
  return chunks;
}

export interface ExtractOpts { maxTotal?: number; maxPerChunk?: number }

export async function extractGroundedGrievances(
  sources: SourceDoc[],
  segments: { seed: string }[],
  llm = new LLMClient(),
  opts: ExtractOpts = {},
): Promise<GroundedGrievance[]> {
  const maxTotal = opts.maxTotal ?? Number(process.env.PB_GRIEVANCE_MAX ?? "100");
  const maxPerChunk = opts.maxPerChunk ?? 8;
  const validSegments = new Set(segments.map((s) => s.seed));
  if (!sources.length || !validSegments.size) return [];

  const out: GroundedGrievance[] = [];
  for (const src of sources.filter(shouldUseSourceForGrievances)) {
    for (const chunk of chunkText(src.rawText || "")) {
      if (out.length >= maxTotal) break;
      const raw = await llm.completeJson<unknown>({
        temperature: 0,
        messages: [
          { role: "system", content: "Extract concrete shopper complaints/anxieties from raw review text. Copy verbatimQuote EXACTLY from the text. Return JSON only." },
          { role: "user", content:
            `Segments (must use exact one):\n- ${segments.map((s) => s.seed).join("\n- ")}\n\n` +
            `Return at most ${maxPerChunk} product-use or purchase-decision complaints. ` +
            `JSON: { "grievances": [ { "anxiety", "verbatimQuote", "segment" } ] }\n\nTEXT:\n${chunk}` },
        ],
      }).catch(() => ({ grievances: [] }));
      const parsed = ExtractSchema.parse(raw).grievances;
      for (const g of parsed) {
        if (out.length >= maxTotal) break;
        if (!validSegments.has(g.segment)) continue;
        if (!containsQuote(src.rawText, g.verbatimQuote)) continue;
        out.push({
          segment: g.segment,
          anxiety: g.anxiety,
          verbatimQuote: g.verbatimQuote,
          sourceUrl: src.finalUrl,
          sourceClass: src.sourceClass,
          verified: true,
        });
      }
    }
  }
  return dedupeByQuote(out).slice(0, maxTotal);
}
```

- [ ] **Step 4: Verify**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievanceExtract.test.ts && bun test && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/personas/grievanceExtract.ts src/personas/grievanceExtract.test.ts
git commit -m "feat(personas): extract grounded grievances directly from raw review sources"
```

---

## Task 3: Wire extractor into buildCategoryPack

**Files:**
- Modify: `src/intel/market.ts`
- Test: existing full suite + live test

- [ ] **Step 1: Implement wiring**

In `src/intel/market.ts`, import:

```typescript
import { extractGroundedGrievances } from "../personas/grievanceExtract.ts";
```

In the persona grounding block (currently after attribution), BEFORE falling back to `grievanceItems`, add:

```typescript
  let extractedGrievances = brief.sources?.length
    ? await extractGroundedGrievances(brief.sources, pack.buyerSegments, llm)
    : [];
  if (extractedGrievances.length) {
    pack.groundedGrievances = extractedGrievances;
  } else {
    // existing fallback: verified rejectionReasons + unmetNeeds
    ...
  }
```

Concretely, refactor the existing block so:
- Dedicated extractor runs first.
- If it returns non-empty, use it.
- Else keep the existing `grievanceItems = [...rr, ...un].filter(...)` + segment-assignment fallback.

Do not remove the known-unknowns block or distribution blend.

- [ ] **Step 2: Verify**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck && bun test`

- [ ] **Step 3: Commit**

```bash
git add src/intel/market.ts
git commit -m "feat(intel): use dedicated raw-source grievance extractor before rejectionReason fallback"
```

---

## Task 4: Live verification

**Files:** none

- [ ] **Step 1: Regenerate vitamin C serum pack**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run intel --category="vitamin C serum" --geo="India" --currency=INR --ground
```

Expected: `packs/vitamin-c-serum-india.json` has `groundedGrievances.length > 0`.

- [ ] **Step 2: Run small tournament**

```bash
PB_CONCURRENCY=8 PB_OPTION_CONCURRENCY=6 bun run tournament --category=vitamin-c-serum-india --candidates=2 --cohort=8 --deep=true --seed=1 --out=out-grievance
```

Expected report line: `Persona grounding: >0% on real grievances | diversity ...`

- [ ] **Step 3: Verify JSON**

Use Bun one-liner to print `groundingCoverage`, `cohortDiversity`, and sample grievances.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test: live dedicated grievance extractor verified with vitamin C serum"
```

---

## Done criteria

- `bun test` green; `bun run typecheck` clean.
- Fresh vitamin C serum intel run produces non-empty `groundedGrievances[]`.
- Tournament report shows `Persona grounding: >0%`.
- No real brand/metrics leak into buyer cards (unchanged previous invariant).
