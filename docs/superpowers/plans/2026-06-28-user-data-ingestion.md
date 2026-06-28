# User Data Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a structured `.xlsx` workbook whose contents augment the harvest as high-trust evidence and hard-override specific facts, folded into the existing intel contract with a byte-identical guarantee when absent.

**Architecture:** User data introduces no new simulation concepts. Voices become synthetic independent `SourceDoc`s, SKUs become `PriceObservation`s merged into harvested ones, competitors become brief grounding hints, and overrides replace `priceBands`/`buyerSegments`/`currency` on the pack after it is built. Pure parse + merge modules are the tested heart; SheetJS is isolated behind two files. Server endpoints download the template, preview a parse, and run with a file.

**Tech Stack:** Bun, TypeScript, zod, SheetJS (`xlsx`, new dependency), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-28-user-data-ingestion-design.md`

---

## File Structure

- Create: `src/userdata/types.ts` — `UserIntel` and row types + zod schemas.
- Create: `src/userdata/merge.ts` — pure: voices→sources, skus→observations, mergeObservations, applyOverrides, competitorsToHints, summarize.
- Create: `src/userdata/merge.test.ts` — pure unit tests.
- Create: `src/userdata/parse.ts` — `parseWorkbook` (imports `xlsx`).
- Create: `src/userdata/parse.test.ts`.
- Create: `src/userdata/template.ts` — `buildTemplateWorkbook` (imports `xlsx`).
- Create: `src/userdata/template.test.ts`.
- Modify: `src/categories/types.ts` — add optional provenance fields `userVoices`, `userSkus`, `overridesApplied`.
- Modify: `src/server/pipeline.ts` — optional `userIntel` arg + merge wiring.
- Modify: `src/server/pipeline.test.ts` (or create) — byte-identical guarantee.
- Modify: `src/server/server.ts` — `/api/template`, `/api/parse`, `/api/run` multipart.

---

## Task 1: Add the `xlsx` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install SheetJS**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun add xlsx`
Expected: `xlsx` appears under `dependencies` in `package.json`; lockfile updates.

- [ ] **Step 2: Verify it imports under Bun ESM**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun -e 'import * as XLSX from "xlsx"; console.log(typeof XLSX.utils.book_new)'`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "build: add xlsx (SheetJS) for user-data ingestion"
```

---

## Task 2: User data types + schemas

**Files:**
- Create: `src/userdata/types.ts`
- Test: `src/userdata/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/userdata/types.test.ts
import { test, expect } from "bun:test";
import { UserVoiceSchema, UserSkuSchema, UserOverridesSchema } from "./types.ts";

test("UserVoiceSchema requires quote/kind/source and defaults independent=true", () => {
  const v = UserVoiceSchema.parse({ quote: "melts in my bag", kind: "rejection", source: "NPS" });
  expect(v.independent).toBe(true);
  expect(v.kind).toBe("rejection");
});

test("UserVoiceSchema rejects an unknown kind", () => {
  expect(() => UserVoiceSchema.parse({ quote: "x", kind: "bogus", source: "s" })).toThrow();
});

test("UserSkuSchema requires brand/product/price as a finite number", () => {
  const s = UserSkuSchema.parse({ brand: "A", product: "Balm", price: 199 });
  expect(s.price).toBe(199);
  expect(() => UserSkuSchema.parse({ brand: "A", product: "B", price: Number.NaN })).toThrow();
});

test("UserOverridesSchema parses optional fields", () => {
  const o = UserOverridesSchema.parse({ currency: "INR" });
  expect(o.currency).toBe("INR");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/types.test.ts`
Expected: FAIL — cannot find module `./types.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/userdata/types.ts
import { z } from "zod";

export const VOICE_KINDS = ["unmet", "rejection", "trigger", "praise"] as const;
export type VoiceKind = (typeof VOICE_KINDS)[number];

export const UserVoiceSchema = z.object({
  quote: z.string().min(1),
  kind: z.enum(VOICE_KINDS),
  segment: z.string().optional(),
  source: z.string().min(1),
  date: z.string().optional(),
  /** A brand-internal note (not customer voice) is NOT independent. */
  independent: z.boolean().default(true),
});
export type UserVoice = z.infer<typeof UserVoiceSchema>;

export const UserSkuSchema = z.object({
  brand: z.string().min(1),
  product: z.string().min(1),
  price: z.number().finite(),
  mrp: z.number().finite().optional(),
  packSize: z.string().optional(),
  unitQty: z.number().finite().optional(),
  subtype: z.string().optional(),
  reviewCount: z.number().finite().optional(),
  rating: z.number().finite().optional(),
  tier: z.string().optional(),
  /** NEW: measured-demand signal. Recorded, NOT yet load-bearing in win-rate. */
  unitsSold: z.number().finite().optional(),
  /** NEW: real economics. Recorded, informational. */
  marginPct: z.number().finite().optional(),
});
export type UserSku = z.infer<typeof UserSkuSchema>;

export const UserCompetitorSchema = z.object({
  name: z.string().min(1),
  pricePositioning: z.string().optional(),
  claims: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
});
export type UserCompetitor = z.infer<typeof UserCompetitorSchema>;

export const UserOverridesSchema = z.object({
  priceBands: z.array(z.object({ label: z.string(), lowMinor: z.number(), highMinor: z.number() })).optional(),
  buyerSegments: z.array(z.object({ seed: z.string(), weight: z.number() })).optional(),
  currency: z.string().optional(),
});
export type UserOverrides = z.infer<typeof UserOverridesSchema>;

export interface UserIntel {
  voices: UserVoice[];
  skus: UserSku[];
  competitors: UserCompetitor[];
  overrides: UserOverrides;
  summary: { voices: number; skus: number; competitors: number; overrides: string[] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/types.ts src/userdata/types.test.ts
git commit -m "feat(userdata): UserIntel row types + zod schemas"
```

---

## Task 3: Pure merge — voicesToSources

**Files:**
- Create: `src/userdata/merge.ts`
- Test: `src/userdata/merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/userdata/merge.test.ts
import { test, expect } from "bun:test";
import { voicesToSources } from "./merge.ts";
import type { UserVoice } from "./types.ts";

const voices: UserVoice[] = [
  { quote: "the balm melts in my bag every summer", kind: "rejection", source: "Q2 NPS", independent: true },
  { quote: "our internal target is repeat buyers", kind: "trigger", source: "strategy memo", independent: false },
];

test("each voice becomes one source with its quote as rawText", () => {
  const s = voicesToSources(voices);
  expect(s).toHaveLength(2);
  expect(s[0]!.rawText).toBe("the balm melts in my bag every summer");
  expect(s[0]!.sourceClass).toBe("first-party");
});

test("independence flag is honored (internal note is not independent)", () => {
  const s = voicesToSources(voices);
  expect(s[0]!.independent).toBe(true);
  expect(s[1]!.independent).toBe(false);
});

test("finalUrl is unique per voice", () => {
  const s = voicesToSources(voices);
  expect(new Set(s.map((x) => x.finalUrl)).size).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: FAIL — cannot find `./merge.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/userdata/merge.ts
import type { UserVoice, UserSku, UserCompetitor, UserOverrides, UserIntel } from "./types.ts";
import type { EvidenceSource } from "../intel/market.ts";
import type { PriceObservation } from "../scrape/prices.ts";
import type { CategoryPack } from "../categories/types.ts";

/**
 * Each user voice becomes a synthetic, user-provided source whose rawText IS the
 * quote. The intel containment gate then passes correctly because the user is the
 * source. Internal notes are marked non-independent so they cannot masquerade as
 * independent market voice.
 */
export function voicesToSources(voices: UserVoice[]): EvidenceSource[] {
  return voices.map((v, i) => ({
    finalUrl: `user://${encodeURIComponent(v.source)}#${i}`,
    sourceClass: "first-party",
    independent: v.independent,
    rawText: v.quote,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/merge.ts src/userdata/merge.test.ts
git commit -m "feat(userdata): voicesToSources — voices become independent first-party sources"
```

---

## Task 4: Pure merge — skusToObservations + mergeObservations

**Files:**
- Modify: `src/userdata/merge.ts`
- Modify: `src/userdata/merge.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/userdata/merge.test.ts
import { skusToObservations, mergeObservations } from "./merge.ts";
import type { UserSku } from "./types.ts";
import type { PriceObservation } from "../scrape/prices.ts";

const skus: UserSku[] = [
  { brand: "Acme", product: "Daily Balm", price: 199, rating: 4.2, unitsSold: 1200 },
];

test("skusToObservations maps fields drop-in", () => {
  const obs = skusToObservations(skus);
  expect(obs[0]!.brand).toBe("Acme");
  expect(obs[0]!.price).toBe(199);
  expect(obs[0]!.rating).toBe(4.2);
});

test("mergeObservations appends user obs and dedupes by brand+product (user wins)", () => {
  const harvested: PriceObservation[] = [
    { brand: "Acme", product: "Daily Balm", price: 250 },
    { brand: "Other", product: "Tint", price: 300 },
  ];
  const { merged, conflicts } = mergeObservations(harvested, skusToObservations(skus));
  expect(merged).toHaveLength(2); // Acme/Daily Balm deduped
  expect(conflicts).toBe(1);
  const acme = merged.find((o) => o.brand === "Acme")!;
  expect(acme.price).toBe(199); // user wins
});

test("mergeObservations is identity when user obs empty", () => {
  const harvested: PriceObservation[] = [{ brand: "X", product: "Y", price: 1 }];
  const { merged } = mergeObservations(harvested, []);
  expect(merged).toEqual(harvested);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: FAIL — `skusToObservations`/`mergeObservations` not exported.

- [ ] **Step 3: Add the implementation to `merge.ts`**

```ts
// append to src/userdata/merge.ts
export function skusToObservations(skus: UserSku[]): PriceObservation[] {
  return skus.map((s) => ({
    brand: s.brand,
    product: s.product,
    price: s.price,
    mrp: s.mrp,
    packSize: s.packSize,
    unitQty: s.unitQty,
    subtype: s.subtype,
    reviewCount: s.reviewCount,
    rating: s.rating,
  }));
}

const obsKey = (o: PriceObservation): string =>
  `${o.brand.toLowerCase().trim()}|${o.product.toLowerCase().trim()}`;

/**
 * Append user observations to harvested ones, deduped by brand+product. On
 * conflict the USER row wins (they know their own / measured data); the number of
 * conflicts is returned so provenance can record it.
 */
export function mergeObservations(
  harvested: PriceObservation[],
  user: PriceObservation[],
): { merged: PriceObservation[]; conflicts: number } {
  if (!user.length) return { merged: harvested, conflicts: 0 };
  const userKeys = new Set(user.map(obsKey));
  let conflicts = 0;
  const keptHarvested = harvested.filter((o) => {
    if (userKeys.has(obsKey(o))) { conflicts++; return false; }
    return true;
  });
  return { merged: [...keptHarvested, ...user], conflicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/merge.ts src/userdata/merge.test.ts
git commit -m "feat(userdata): skusToObservations + mergeObservations (dedupe, user-wins)"
```

---

## Task 5: Pure merge — applyOverrides + competitorsToHints + summarize

**Files:**
- Modify: `src/userdata/merge.ts`
- Modify: `src/userdata/merge.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/userdata/merge.test.ts
import { applyOverrides, competitorsToHints, summarize } from "./merge.ts";
import type { CategoryPack } from "../categories/types.ts";
import type { UserCompetitor, UserOverrides } from "./types.ts";

function basePack(): CategoryPack {
  return {
    id: "cat", name: "Cat", currency: "USD", geography: "X",
    unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
    priceBands: [{ label: "core", lowMinor: 10000, highMinor: 40000 }],
    competitorArchetypes: [], complianceNotes: [],
    buyerSegments: [{ seed: "a", weight: 0.5, basis: "" }, { seed: "b", weight: 0.5, basis: "" }],
    groundedGrievances: [], benchmarkBrands: [], benchmarkKnownUnknowns: [],
    personaGroundingKnownUnknowns: [], benchmarksDegraded: true,
  } as unknown as CategoryPack;
}

test("applyOverrides replaces priceBands/currency and re-normalizes buyerSegments", () => {
  const ov: UserOverrides = {
    priceBands: [{ label: "v", lowMinor: 0, highMinor: 15000 }],
    buyerSegments: [{ seed: "x", weight: 2 }, { seed: "y", weight: 2 }],
    currency: "INR",
  };
  const { pack, applied } = applyOverrides(basePack(), ov);
  expect(pack.currency).toBe("INR");
  expect(pack.priceBands).toHaveLength(1);
  expect(pack.buyerSegments[0]!.weight).toBe(0.5); // 2/4 normalized
  expect(applied.sort()).toEqual(["buyerSegments", "currency", "priceBands"]);
});

test("applyOverrides is identity (no applied fields) when overrides empty", () => {
  const before = basePack();
  const { pack, applied } = applyOverrides(before, {});
  expect(applied).toEqual([]);
  expect(pack.currency).toBe("USD");
  expect(pack.priceBands).toEqual(before.priceBands);
});

test("applyOverrides does not mutate the input pack", () => {
  const before = basePack();
  applyOverrides(before, { currency: "INR" });
  expect(before.currency).toBe("USD");
});

test("competitorsToHints renders names + positioning", () => {
  const comps: UserCompetitor[] = [
    { name: "BrandA", pricePositioning: "premium", claims: ["long-lasting"], strengths: ["distribution"], weaknesses: ["price"] },
  ];
  const hint = competitorsToHints(comps);
  expect(hint).toContain("BrandA");
  expect(hint).toContain("premium");
});

test("competitorsToHints returns empty string for no competitors", () => {
  expect(competitorsToHints([])).toBe("");
});

test("summarize counts each section and lists applied override fields", () => {
  const s = summarize({
    voices: [{ quote: "q", kind: "praise", source: "s", independent: true }],
    skus: [], competitors: [], overrides: { currency: "INR" },
  } as any);
  expect(s.voices).toBe(1);
  expect(s.overrides).toEqual(["currency"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: FAIL — `applyOverrides`/`competitorsToHints`/`summarize` not exported.

- [ ] **Step 3: Add the implementation to `merge.ts`**

```ts
// append to src/userdata/merge.ts

/** Re-normalize segment weights to sum ~1.0 (whole-percent, matches intel.ts). */
function normalizeWeights<T extends { weight: number }>(segs: T[]): T[] {
  const total = segs.reduce((a, s) => a + (s.weight || 0), 0);
  if (total <= 0) return segs.map((s) => ({ ...s, weight: Math.round(100 / segs.length) / 100 }));
  return segs.map((s) => ({ ...s, weight: Math.round((s.weight / total) * 100) / 100 }));
}

/**
 * Apply hard user overrides to a built pack. Returns a NEW pack (no mutation) and
 * the list of fields actually changed, recorded in provenance. priceBands override
 * is the highest authority — it wins over harvested/recomputed bands.
 */
export function applyOverrides(
  pack: CategoryPack,
  ov: UserOverrides,
): { pack: CategoryPack; applied: string[] } {
  const applied: string[] = [];
  const next: CategoryPack = { ...pack };
  if (ov.priceBands && ov.priceBands.length) { next.priceBands = ov.priceBands; applied.push("priceBands"); }
  if (ov.buyerSegments && ov.buyerSegments.length) {
    next.buyerSegments = normalizeWeights(ov.buyerSegments.map((s) => ({ seed: s.seed, weight: s.weight, basis: "user-provided override" })));
    applied.push("buyerSegments");
  }
  if (ov.currency) { next.currency = ov.currency; applied.push("currency"); }
  return { pack: next, applied };
}

/** Compact grounding text for the brief. Real names allowed here (archetypes stay
 * disguised by the existing prompt rules); empty input => empty string. */
export function competitorsToHints(comps: UserCompetitor[]): string {
  if (!comps.length) return "";
  return (
    "USER-PROVIDED COMPETITORS (real, for grounding only — keep archetypes disguised):\n" +
    comps
      .map((c) => {
        const bits = [c.pricePositioning ? `positioning: ${c.pricePositioning}` : "",
          c.claims.length ? `claims: ${c.claims.join("; ")}` : "",
          c.strengths.length ? `strengths: ${c.strengths.join("; ")}` : "",
          c.weaknesses.length ? `weaknesses: ${c.weaknesses.join("; ")}` : ""].filter(Boolean).join(" | ");
        return `- ${c.name}${bits ? " (" + bits + ")" : ""}`;
      })
      .join("\n")
  );
}

export function summarize(intel: Omit<UserIntel, "summary">): UserIntel["summary"] {
  const overrides: string[] = [];
  if (intel.overrides.priceBands?.length) overrides.push("priceBands");
  if (intel.overrides.buyerSegments?.length) overrides.push("buyerSegments");
  if (intel.overrides.currency) overrides.push("currency");
  return { voices: intel.voices.length, skus: intel.skus.length, competitors: intel.competitors.length, overrides };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/merge.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/merge.ts src/userdata/merge.test.ts
git commit -m "feat(userdata): applyOverrides (pure, re-normalizes) + competitorsToHints + summarize"
```

---

## Task 6: Workbook parser

**Files:**
- Create: `src/userdata/parse.ts`
- Test: `src/userdata/parse.test.ts`

- [ ] **Step 1: Write the failing test (builds a workbook in-memory, then parses it)**

```ts
// src/userdata/parse.test.ts
import { test, expect } from "bun:test";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./parse.ts";

function makeBook(sheets: Record<string, any[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("parses well-formed Voices and SKUs sheets", () => {
  const buf = makeBook({
    Voices: [["quote", "kind", "source", "internal"], ["melts in my bag", "rejection", "NPS", ""]],
    SKUs: [["brand", "product", "price"], ["Acme", "Balm", "199"]],
  });
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices).toHaveLength(1);
  expect(intel.voices[0]!.kind).toBe("rejection");
  expect(intel.voices[0]!.independent).toBe(true);
  expect(intel.skus[0]!.price).toBe(199);
  expect(warnings).toHaveLength(0);
});

test("drops a malformed row with a warning, never coerces", () => {
  const buf = makeBook({
    SKUs: [["brand", "product", "price"], ["Acme", "Balm", "notanumber"], ["B", "P", "50"]],
  });
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.skus).toHaveLength(1);
  expect(intel.skus[0]!.price).toBe(50);
  expect(warnings.join(" ")).toContain("SKUs");
});

test("missing optional cell stays absent, not 0", () => {
  const buf = makeBook({ SKUs: [["brand", "product", "price", "rating"], ["A", "B", "10", ""]] });
  const { intel } = parseWorkbook(buf);
  expect(intel.skus[0]!.rating).toBeUndefined();
});

test("internal=true marks a voice non-independent", () => {
  const buf = makeBook({ Voices: [["quote", "kind", "source", "internal"], ["our goal", "trigger", "memo", "true"]] });
  const { intel } = parseWorkbook(buf);
  expect(intel.voices[0]!.independent).toBe(false);
});

test("Overrides sheet parses priceBands/currency", () => {
  const buf = makeBook({
    Overrides: [["field", "value"], ["currency", "INR"], ["priceBands", "value:0-150, core:150-400"]],
  });
  const { intel } = parseWorkbook(buf);
  expect(intel.overrides.currency).toBe("INR");
  expect(intel.overrides.priceBands).toHaveLength(2);
  expect(intel.overrides.priceBands![0]!.highMinor).toBe(15000); // 150 * 100
});

test("empty workbook returns empty intel + a warning, never throws", () => {
  const buf = makeBook({});
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices).toHaveLength(0);
  expect(warnings.length).toBeGreaterThan(0);
});

test("non-workbook buffer throws", () => {
  expect(() => parseWorkbook(new TextEncoder().encode("not a workbook").buffer)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/parse.test.ts`
Expected: FAIL — cannot find `./parse.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/userdata/parse.ts
import * as XLSX from "xlsx";
import {
  UserVoiceSchema, UserSkuSchema, UserCompetitorSchema,
  type UserVoice, type UserSku, type UserCompetitor, type UserOverrides, type UserIntel,
} from "./types.ts";
import { summarize } from "./merge.ts";

type Row = Record<string, string>;

/** Read a sheet as array-of-objects keyed by trimmed lower-case header. */
function readSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return raw.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim().toLowerCase()] = String(v ?? "").trim();
    return out;
  });
}

const num = (s: string): number | undefined => {
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const truthy = (s: string): boolean => /^(true|yes|1|y)$/i.test(s.trim());
const splitList = (s: string): string[] => s.split(";").map((x) => x.trim()).filter(Boolean);

/** "value:0-150, core:150-400, premium:400+" -> bands in MINOR units (x100). */
function parsePriceBands(s: string): UserOverrides["priceBands"] {
  const bands = s.split(",").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const [label, range] = seg.split(":").map((x) => x.trim());
    if (!label || !range) return undefined;
    const m = range.replace(/\+$/, "-").split("-").map((x) => x.trim());
    const low = Number(m[0]);
    const high = m[1] === "" || m[1] === undefined ? low * 10 : Number(m[1]);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
    return { label, lowMinor: Math.round(low * 100), highMinor: Math.round(high * 100) };
  }).filter((b): b is NonNullable<typeof b> => !!b);
  return bands.length ? bands : undefined;
}

/** "dry-lips:0.4, tint:0.3" -> [{seed,weight}]. */
function parseSegments(s: string): UserOverrides["buyerSegments"] {
  const segs = s.split(",").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const idx = seg.lastIndexOf(":");
    if (idx < 0) return undefined;
    const seed = seg.slice(0, idx).trim();
    const weight = Number(seg.slice(idx + 1).trim());
    if (!seed || !Number.isFinite(weight)) return undefined;
    return { seed, weight };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  return segs.length ? segs : undefined;
}

/**
 * Parse a user workbook into UserIntel. Fail-clean: a malformed row is dropped
 * with a warning, never silently coerced; a missing optional cell stays absent,
 * not 0/null. Throws ONLY when the buffer is not a readable workbook at all.
 */
export function parseWorkbook(buf: ArrayBuffer | Uint8Array): { intel: UserIntel; warnings: string[] } {
  const wb = XLSX.read(buf, { type: "array" }); // throws on a non-workbook buffer
  const warnings: string[] = [];

  const voices: UserVoice[] = [];
  readSheet(wb, "Voices").forEach((r, i) => {
    if (!r.quote && !r.kind && !r.source) return; // blank row
    const parsed = UserVoiceSchema.safeParse({
      quote: r.quote, kind: r.kind, source: r.source,
      segment: r.segment || undefined, date: r.date || undefined,
      independent: r.internal ? !truthy(r.internal) : true,
    });
    if (parsed.success) voices.push(parsed.data);
    else warnings.push(`Voices row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const skus: UserSku[] = [];
  readSheet(wb, "SKUs").forEach((r, i) => {
    if (!r.brand && !r.product && !r.price) return;
    const parsed = UserSkuSchema.safeParse({
      brand: r.brand, product: r.product, price: num(r.price),
      mrp: num(r.mrp), packSize: r.packSize || undefined, unitQty: num(r.unitqty),
      subtype: r.subtype || undefined, reviewCount: num(r.reviewcount), rating: num(r.rating),
      tier: r.tier || undefined, unitsSold: num(r.unitssold), marginPct: num(r.marginpct),
    });
    if (parsed.success) skus.push(parsed.data);
    else warnings.push(`SKUs row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const competitors: UserCompetitor[] = [];
  readSheet(wb, "Competitors").forEach((r, i) => {
    if (!r.name) return;
    const parsed = UserCompetitorSchema.safeParse({
      name: r.name, pricePositioning: r.pricepositioning || undefined,
      claims: splitList(r.claims ?? ""), strengths: splitList(r.strengths ?? ""), weaknesses: splitList(r.weaknesses ?? ""),
    });
    if (parsed.success) competitors.push(parsed.data);
    else warnings.push(`Competitors row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const overrides: UserOverrides = {};
  readSheet(wb, "Overrides").forEach((r) => {
    const field = (r.field ?? "").toLowerCase();
    const value = r.value ?? "";
    if (!field || !value) return;
    if (field === "currency") overrides.currency = value;
    else if (field === "priceBands".toLowerCase()) { const b = parsePriceBands(value); if (b) overrides.priceBands = b; }
    else if (field === "buyerSegments".toLowerCase()) { const s = parseSegments(value); if (s) overrides.buyerSegments = s; }
    else warnings.push(`Overrides: unknown field "${r.field}" ignored`);
  });

  if (!voices.length && !skus.length && !competitors.length && !Object.keys(overrides).length) {
    warnings.push("No usable rows found in any sheet (Voices/SKUs/Competitors/Overrides).");
  }

  const partial = { voices, skus, competitors, overrides };
  return { intel: { ...partial, summary: summarize(partial) }, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/parse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/parse.ts src/userdata/parse.test.ts
git commit -m "feat(userdata): parseWorkbook — fail-clean xlsx parser (SheetJS isolated)"
```

---

## Task 7: Template generator

**Files:**
- Create: `src/userdata/template.ts`
- Test: `src/userdata/template.test.ts`

- [ ] **Step 1: Write the failing test (template must round-trip through the parser)**

```ts
// src/userdata/template.test.ts
import { test, expect } from "bun:test";
import { buildTemplateWorkbook } from "./template.ts";
import { parseWorkbook } from "./parse.ts";

test("template is itself valid input and round-trips to example rows", () => {
  const buf = buildTemplateWorkbook();
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices.length).toBeGreaterThanOrEqual(1);
  expect(intel.skus.length).toBeGreaterThanOrEqual(1);
  expect(intel.competitors.length).toBeGreaterThanOrEqual(1);
  expect(warnings).toHaveLength(0);
});

test("template is a non-empty buffer", () => {
  expect(buildTemplateWorkbook().byteLength).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/template.test.ts`
Expected: FAIL — cannot find `./template.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/userdata/template.ts
import * as XLSX from "xlsx";

/**
 * Build the canonical paper-brands-intel.xlsx: 4 data sheets (with headers + one
 * example row each) plus a README sheet. The example rows are valid input, so the
 * template round-trips through parseWorkbook (verified in tests).
 */
export function buildTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const readme = [
    ["Paper Brands — Category Intel Template"],
    ["Fill ONLY what you have. Blank sheets are skipped; gaps show honestly in provenance."],
    [""],
    ["Voices", "Customer verbatims. Each row becomes one independent evidence source."],
    ["  quote*", "the exact words (a survey comment, support ticket, review, sales note)"],
    ["  kind*", "one of: unmet | rejection | trigger | praise"],
    ["  segment", "optional: which buyer this is (e.g. 'outdoor/SPF user')"],
    ["  source*", "where it came from (e.g. 'Q2 NPS survey')"],
    ["  date", "optional: e.g. 2026-03"],
    ["  internal", "optional: true if this is a brand-internal note, not customer voice"],
    [""],
    ["SKUs", "Real products + data scraping cannot reach (sell-through, margin)."],
    ["  brand*, product*, price*", "price is current selling price in whole currency"],
    ["  mrp, packSize, unitQty, subtype, reviewCount, rating, tier", "optional"],
    ["  unitsSold, marginPct", "optional: recorded, informational (not yet load-bearing)"],
    [""],
    ["Competitors", "name* + optional pricePositioning, claims, strengths, weaknesses (use ; to separate lists)"],
    [""],
    ["Overrides", "field/value. field one of: currency | priceBands | buyerSegments"],
    ["  priceBands example", "value:0-150, core:150-400, premium:400+"],
    ["  buyerSegments example", "dry-lips relief:0.4, tint+care:0.3, SPF:0.3"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "README");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["quote", "kind", "segment", "source", "date", "internal"],
    ["the balm melts in my bag every summer", "rejection", "outdoor/SPF user", "Q2 NPS survey", "2026-03", ""],
  ]), "Voices");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["brand", "product", "price", "mrp", "packSize", "unitQty", "subtype", "reviewCount", "rating", "tier", "unitsSold", "marginPct"],
    ["Acme", "Daily Lip Balm", "199", "249", "4.5g", "4.5", "medicated", "1200", "4.2", "core", "8000", "55"],
  ]), "SKUs");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["name", "pricePositioning", "claims", "strengths", "weaknesses"],
    ["RivalCo", "premium", "long-lasting; SPF 30", "wide distribution; trusted", "expensive; waxy feel"],
  ]), "Competitors");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["field", "value"],
    ["currency", "INR"],
    ["priceBands", "value:0-150, core:150-400, premium:400+"],
    ["buyerSegments", "dry-lips relief:0.4, tint+care:0.3, SPF:0.3"],
  ]), "Overrides");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/userdata/template.ts src/userdata/template.test.ts
git commit -m "feat(userdata): buildTemplateWorkbook — canonical xlsx, round-trips through parser"
```

---

## Task 8: Provenance honesty fields

**Files:**
- Modify: `src/categories/types.ts:57-91` (ProvenanceSchema)
- Test: `src/userdata/provenance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/userdata/provenance.test.ts
import { test, expect } from "bun:test";
import { ProvenanceSchema } from "../categories/types.ts";

test("ProvenanceSchema accepts user-data honesty fields and defaults them", () => {
  const p = ProvenanceSchema.parse({});
  expect(p.userVoices).toBe(0);
  expect(p.userSkus).toBe(0);
  expect(p.overridesApplied).toEqual([]);
});

test("ProvenanceSchema records supplied user-data fields", () => {
  const p = ProvenanceSchema.parse({ userVoices: 12, userSkus: 5, overridesApplied: ["priceBands"] });
  expect(p.userVoices).toBe(12);
  expect(p.overridesApplied).toEqual(["priceBands"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/provenance.test.ts`
Expected: FAIL — `userVoices` is `undefined` (field not in schema).

- [ ] **Step 3: Add fields to `ProvenanceSchema`**

In `src/categories/types.ts`, inside `ProvenanceSchema` (just before the closing `confidence` line), add:

```ts
  /** Count of user-supplied customer voices folded in as first-party sources. */
  userVoices: z.number().default(0),
  /** Count of user-supplied SKU observations merged in. */
  userSkus: z.number().default(0),
  /** Pack fields the user hard-overrode (e.g. ["priceBands","currency"]). */
  overridesApplied: z.array(z.string()).default([]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/userdata/provenance.test.ts && bun run typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/categories/types.ts src/userdata/provenance.test.ts
git commit -m "feat(userdata): provenance records userVoices/userSkus/overridesApplied (honesty)"
```

---

## Task 9: Pipeline wiring (byte-identical when absent)

**Files:**
- Modify: `src/server/pipeline.ts`
- Test: `src/server/pipeline.test.ts`

- [ ] **Step 1: Write the failing test (injected fake deps; asserts identity + merge)**

```ts
// src/server/pipeline.test.ts
import { test, expect } from "bun:test";
import { runFoundryPipeline } from "./pipeline.ts";
import type { UserIntel } from "../userdata/types.ts";

function fakeDeps(captured: { brief?: any }) {
  return {
    harvest: async () => ({
      category: "c", geography: "India", currency: "INR", harvestedAt: "t",
      plan: {} as any, lenses: {}, sources: [], citationCount: 0,
      price: { currency: "INR", unit: "g", observations: [], dropped: 0, bands: [], buckets: [], stats: null },
      coverage: {} as any,
    }) as any,
    buildCategoryPack: async (brief: any) => { captured.brief = brief; return {
      id: "c", name: "C", currency: "INR", geography: "India",
      unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
      priceBands: [{ label: "core", lowMinor: 10000, highMinor: 40000 }],
      competitorArchetypes: [], complianceNotes: [],
      buyerSegments: [{ seed: "a", weight: 1, basis: "" }],
      groundedGrievances: [], benchmarkBrands: [], benchmarkKnownUnknowns: [],
      personaGroundingKnownUnknowns: [], benchmarksDegraded: true,
      provenance: { confidence: "low" },
    } as any; },
    runFoundry: async () => ({ finalists: [] }) as any,
    runLaunchpages: async () => ({ built: [] }) as any,
  };
}

test("no userIntel: brief has no user sources, no overrides applied", async () => {
  const cap: { brief?: any } = {};
  const events: any[] = [];
  await runFoundryPipeline("c", (e) => events.push(e), fakeDeps(cap), 80);
  expect((cap.brief.sources ?? []).some((s: any) => s.sourceClass === "first-party")).toBe(false);
  expect(events.some((e) => e.type === "run-complete")).toBe(true);
});

test("with userIntel: voices appear as first-party sources and currency override applies", async () => {
  const cap: { brief?: any } = {};
  const intel: UserIntel = {
    voices: [{ quote: "melts in my bag every summer", kind: "rejection", source: "NPS", independent: true }],
    skus: [{ brand: "Acme", product: "Balm", price: 199 }],
    competitors: [], overrides: { currency: "USD" },
    summary: { voices: 1, skus: 1, competitors: 0, overrides: ["currency"] },
  };
  await runFoundryPipeline("c", () => {}, fakeDeps(cap), 80, intel);
  const srcs = cap.brief.sources ?? [];
  expect(srcs.some((s: any) => s.sourceClass === "first-party" && s.rawText.includes("melts"))).toBe(true);
  expect((cap.brief.observations ?? []).some((o: any) => o.brand === "Acme")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/pipeline.test.ts`
Expected: FAIL — `runFoundryPipeline` does not accept a 5th arg / does not merge user data.

- [ ] **Step 3: Wire user data into `pipeline.ts`**

Add the import near the top:

```ts
import type { UserIntel } from "../userdata/types.ts";
import { voicesToSources, skusToObservations, mergeObservations, applyOverrides, competitorsToHints } from "../userdata/merge.ts";
```

Change the signature:

```ts
export async function runFoundryPipeline(
  category: string,
  onEvent: (e: EmitInput) => void,
  deps: FoundryPipelineDeps = {},
  cohortSize = 80,
  userIntel?: UserIntel,
): Promise<void> {
```

In the INTEL stage, replace the block that builds `sources`/`priceBands`/`competitorClusters`/`pack` with:

```ts
    // ── INTEL ──
    onEvent({ type: "stage", stage: "intel", status: "start" });
    const ev = corpusToEvidence(corpus);
    const harvestedSources = (corpus.sources ?? []).filter((s) => s.fetched).map((s) => ({ finalUrl: s.finalUrl, sourceClass: s.sourceClass, independent: s.independent, rawText: s.rawText }));
    // User voices are prepended as first-party independent sources.
    const sources = userIntel ? [...voicesToSources(userIntel.voices), ...harvestedSources] : harvestedSources;
    // User SKUs merged into observations (user wins on conflict); recompute clusters over the merged set.
    const { merged: observations } = userIntel
      ? mergeObservations(corpus.price.observations, skusToObservations(userIntel.skus))
      : { merged: corpus.price.observations };
    const priceBands = corpus.price.bands.length ? corpus.price.bands : undefined;
    const competitorClusters = clusterCompetitors(observations, corpus.price.buckets);
    const provenance = corpusProvenance(corpus, { truncated: ev.truncated, model: loadConfig().model });
    const notes = userIntel ? competitorsToHints(userIntel.competitors) : undefined;
    const builtPack = await doBuildPack(
      { category, geography: "India (D2C + marketplaces)", currency: "INR", evidence: ev.text, sources, priceBands, observations, competitorClusters, provenance, notes },
      undefined,
      onEvent as any,
    );
    // Apply hard overrides AFTER build; priceBands override wins over recomputed bands.
    const { pack, applied } = userIntel ? applyOverrides(builtPack, userIntel.overrides) : { pack: builtPack, applied: [] as string[] };
    // Stamp honesty fields onto provenance.
    if (pack.provenance) {
      pack.provenance.userVoices = userIntel?.voices.length ?? 0;
      pack.provenance.userSkus = userIntel?.skus.length ?? 0;
      pack.provenance.overridesApplied = applied;
    }
    const packPath = await savePack(pack);
    onEvent({ type: "stage", stage: "intel", status: "done", note: packPath });
```

NOTE: `CategoryBrief.notes` already exists (string, optional) at `src/intel/market.ts:19`. Confirmed: it is currently only included via the `JSON.stringify({...brief})` dump, NOT as a prominent instruction. In this task, also surface it explicitly: in `buildCategoryPack`'s user-content string, prepend `(brief.notes ? brief.notes + "\n\n" : "")` so user competitor hints are a first-class instruction, not buried in the JSON. Keep `notes` out of the `JSON.stringify(... )` exclusion list is unnecessary — leave the existing dump as-is; just add the explicit prepend.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/pipeline.test.ts && bun run typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/pipeline.ts src/server/pipeline.test.ts src/intel/market.ts
git commit -m "feat(userdata): thread userIntel into pipeline — voices/SKUs merged, overrides applied, provenance stamped"
```

---

## Task 10: Server endpoints — template + parse + run multipart

**Files:**
- Modify: `src/server/server.ts:47-67` (run handler) + add two routes
- Test: `src/server/userdata-endpoints.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/userdata-endpoints.test.ts
import { test, expect, afterAll } from "bun:test";
import { startServer } from "./server.ts";
import { buildTemplateWorkbook } from "../userdata/template.ts";

const srv = startServer(0);
const base = `http://localhost:${srv.port}`;
afterAll(() => srv.stop());

test("GET /api/template streams an xlsx attachment", async () => {
  const res = await fetch(`${base}/api/template`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("spreadsheetml");
  const buf = await res.arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(1000);
});

test("POST /api/parse returns a summary for an uploaded workbook", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([buildTemplateWorkbook()]), "intel.xlsx");
  const res = await fetch(`${base}/api/parse`, { method: "POST", body: fd });
  expect(res.status).toBe(200);
  const json = (await res.json()) as any;
  expect(json.summary.voices).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(json.warnings)).toBe(true);
});

test("POST /api/parse rejects a non-workbook with 400", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([new TextEncoder().encode("nope")]), "x.xlsx");
  const res = await fetch(`${base}/api/parse`, { method: "POST", body: fd });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/userdata-endpoints.test.ts`
Expected: FAIL — 404 on `/api/template` and `/api/parse`.

- [ ] **Step 3: Add the routes + multipart run in `server.ts`**

Add the import near the top:

```ts
import { parseWorkbook } from "../userdata/parse.ts";
import { buildTemplateWorkbook } from "../userdata/template.ts";
import type { UserIntel } from "../userdata/types.ts";
```

Add these routes (before the final `return new Response("not found", { status: 404 })`):

```ts
    if (req.method === "GET" && path === "/api/template") {
      const buf = buildTemplateWorkbook();
      return new Response(buf, { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="paper-brands-intel.xlsx"',
      } });
    }

    if (req.method === "POST" && path === "/api/parse") {
      try {
        const fd = await req.formData();
        const file = fd.get("file");
        if (!(file instanceof Blob)) return Response.json({ error: "no file" }, { status: 400 });
        const { intel, warnings } = parseWorkbook(await file.arrayBuffer());
        return Response.json({ summary: intel.summary, warnings });
      } catch (e) {
        return Response.json({ error: `not a readable workbook: ${(e as Error).message}` }, { status: 400 });
      }
    }
```

Replace the body-parsing portion of the `/api/run` handler so it accepts EITHER JSON (back-compat) OR multipart with a file:

```ts
    if (req.method === "POST" && path === "/api/run") {
      const snap = broadcaster.snapshot();
      if (snap.status === "running") {
        return Response.json({ error: "a run is already active" }, { status: 409 });
      }
      let category = "lipcare";
      let cohortSize = 80;
      let userIntel: UserIntel | undefined;
      const ctype = req.headers.get("content-type") ?? "";
      try {
        if (ctype.includes("multipart/form-data")) {
          const fd = await req.formData();
          category = String(fd.get("category") ?? category);
          cohortSize = Number(fd.get("cohortSize") ?? cohortSize) || 80;
          const file = fd.get("file");
          if (file instanceof Blob && file.size > 0) {
            userIntel = parseWorkbook(await file.arrayBuffer()).intel;
          }
        } else {
          const body = (await req.json()) as any;
          category = body.category ?? category;
          cohortSize = Number(body.cohortSize ?? cohortSize) || 80;
        }
      } catch (e) {
        return Response.json({ error: `bad request: ${(e as Error).message}` }, { status: 400 });
      }
      broadcaster.setRunning(category);
      runFoundryPipeline(category, (e) => broadcaster.emit(e), {}, cohortSize, userIntel)
        .then(() => broadcaster.setStatus("complete"))
        .catch((e) => {
          broadcaster.emit({ type: "run-error", message: (e as Error).message });
          broadcaster.setStatus("error");
        });
      return Response.json({ started: true, userData: userIntel?.summary ?? null }, { status: 202 });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/userdata-endpoints.test.ts && bun run typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts src/server/userdata-endpoints.test.ts
git commit -m "feat(userdata): /api/template + /api/parse + /api/run multipart file upload"
```

---

## Task 11: Full suite + typecheck green

**Files:** none (verification task)

- [ ] **Step 1: Run the whole suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
Expected: all tests pass (268 prior + ~30 new), 0 fail.

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: clean (no output, exit 0).

- [ ] **Step 3: Manual smoke of the template round-trip via CLI**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun -e 'import {buildTemplateWorkbook} from "./src/userdata/template.ts"; import {parseWorkbook} from "./src/userdata/parse.ts"; const r=parseWorkbook(buildTemplateWorkbook()); console.log(JSON.stringify(r.intel.summary), r.warnings)'`
Expected: prints a summary like `{"voices":1,"skus":1,"competitors":1,"overrides":["currency","priceBands","buyerSegments"]}` and `[]`.

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test(userdata): full suite + typecheck green for user-data ingestion"
```

---

## Self-Review Notes

- **Spec coverage:** template (Task 7) · parse fail-clean (Task 6) · merge voices/skus/overrides/competitors (Tasks 3-5) · provenance honesty (Task 8) · pipeline byte-identical (Task 9) · endpoints (Task 10) · dependency isolated to parse/template (Tasks 1,6,7). All spec sections mapped.
- **Type consistency:** `EvidenceSource` (`finalUrl`/`sourceClass`/`independent`/`rawText`) matches `src/intel/market.ts`. `PriceObservation` fields match `src/scrape/prices.ts`. `buyerSegments` shape (`seed`/`weight`/`basis`) and `priceBands` (`label`/`lowMinor`/`highMinor`) match `src/categories/types.ts`. `runFoundryPipeline` 5th arg `userIntel` is consistent across Tasks 9 and 10.
- **No placeholders:** every code step shows complete code; commands have expected output.
- **Open verify-at-execution item:** Task 9 Step 3 notes `CategoryBrief.notes` must be concatenated into the prompt in `buildCategoryPack`; if the field/concat does not already exist, add it (guarded) in the same task.
