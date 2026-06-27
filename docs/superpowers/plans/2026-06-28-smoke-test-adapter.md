# Fake-Door Smoke-Test Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a tournament's generated concepts into deployable static notify-me PDP pages + an experiment manifest, then ingest observed notify-click CTR from a CSV into the existing calibration store as `(syntheticScore, realOutcome)` pairs.

**Architecture:** New `src/smoketest/` module with pure cores (`buildExperiment`, `renderPdpPage`, `parseResultsCsv`) and a thin I/O layer (`write.ts`), plus two CLI verbs. Reuses `CalibrationStore`/`CalibrationObservation`; no new dependencies; HTML is a plain escaped template string.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`, `Bun.write`/`Bun.file`, `node:fs/promises` mkdir). Reuses `src/calibration/`.

**Spec:** `docs/superpowers/specs/2026-06-28-smoke-test-adapter-design.md`

---

## File Structure

- Create `src/smoketest/types.ts` — `SmokeConcept`, `SmokeExperiment`, `SmokeResultRow`.
- Create `src/smoketest/experiment.ts` — `buildExperiment(tournament, currency)` (pure) + `slugify`.
- Create `src/smoketest/page.ts` — `renderPdpPage(concept, opts)` (pure, HTML-escaped).
- Create `src/smoketest/results.ts` — `parseResultsCsv(experiment, csvText, recordedAt)` (pure) → `{ observations, skipped }`.
- Create `src/smoketest/write.ts` — `writeExperiment` / `readExperiment` (I/O).
- Create `src/smoketest/*.test.ts` for each.
- Modify `src/cli.ts` — add `smoketest-build` + `smoketest-import` cases.
- Modify `package.json` — `smoketest:build`, `smoketest:import` scripts.

Verified facts:
- `BrandConcept` fields: id, name, positioning, targetCustomer, coreInsight, productPromise, heroSku, priceMinor, priceBand, tagline, claims[], packagingDirection, brandVoice, landingHeadline, topAdAngles[], objections[], launchRisks[]. No `currency`.
- `out/tournament.json`: `{ categoryId, concepts: BrandConcept[], report: { concepts: [{conceptId, winRate, ...}], winner, ... }, ... }`. Win-rate join: `report.concepts[].conceptId === concepts[].id`. Benchmark/competitor ids start `benchmark:`/`competitor:`.
- `CalibrationObservation`: id, category, syntheticScore, realOutcome, source, unit, label, realMetric, recordedAt, notes?.
- `new CalibrationStore(category, baseDir="data")`, async `record(obs)`, async `read()`. Store re-validates 0..1.
- Tests: `import { test, expect } from "bun:test";`, run `bun test`. CLI: `switch(process.argv[2])`, `arg(name,def?)`, `flag(name)`, `slugify(s)` already exist in `src/cli.ts`.

---

## Task 1: Types

**Files:**
- Create: `src/smoketest/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
export interface SmokeConcept {
  conceptId: string;
  name: string;
  syntheticScore: number;   // 0..1, arena win-rate at build time
  slug: string;             // filesystem-safe; page + CSV display
  pagePath: string;         // relative, e.g. "pages/sunshield-lip-balm.html"
}

export interface SmokeExperiment {
  category: string;
  currency: string;
  builtAt: string;          // ISO
  realMetric: "notify CTR";
  source: "smoke-test";
  unit: "concept";
  tournamentRef?: string;
  concepts: SmokeConcept[];
}

export interface SmokeResultRow {
  conceptId: string;
  pageVisitors: number;
  notifyClicks: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
git add src/smoketest/types.ts
git commit -m "feat(smoketest): experiment + result types"
```

---

## Task 2: buildExperiment (pure)

**Files:**
- Create: `src/smoketest/experiment.ts`
- Test: `src/smoketest/experiment.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test, expect } from "bun:test";
import { buildExperiment } from "./experiment.ts";

function concept(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] };
}

const tournament: any = {
  categoryId: "lipcare-india",
  concepts: [concept("SPF-LIPCARE-001", "SunShield Lip Balm"), concept("001", "LipCraft")],
  report: {
    concepts: [
      { conceptId: "benchmark:bm-nivea", winRate: 0.5 },
      { conceptId: "SPF-LIPCARE-001", winRate: 0.25 },
      { conceptId: "001", winRate: 0.1 },
      { conceptId: "competitor:ARCH-X", winRate: 0.05 },
    ],
    winner: { conceptId: "SPF-LIPCARE-001", name: "SunShield Lip Balm", winRate: 0.25 },
  },
};

test("builds one entry per generated concept, joined to win-rate, excludes benchmarks/competitors", () => {
  const exp = buildExperiment(tournament, "INR");
  expect(exp.category).toBe("lipcare-india");
  expect(exp.currency).toBe("INR");
  expect(exp.realMetric).toBe("notify CTR");
  expect(exp.source).toBe("smoke-test");
  expect(exp.unit).toBe("concept");
  expect(exp.concepts.map((c) => c.conceptId)).toEqual(["SPF-LIPCARE-001", "001"]);
  expect(exp.concepts[0]!.syntheticScore).toBe(0.25);
  expect(exp.concepts[1]!.syntheticScore).toBe(0.1);
});

test("slug is filesystem-safe and pagePath points under pages/", () => {
  const exp = buildExperiment(tournament, "INR");
  expect(exp.concepts[0]!.slug).toBe("spf-lipcare-001");
  expect(exp.concepts[0]!.pagePath).toBe("pages/spf-lipcare-001.html");
});

test("concept with no matching win-rate is dropped", () => {
  const t = { ...tournament, concepts: [...tournament.concepts, concept("ZZZ", "Ghost")] };
  const exp = buildExperiment(t, "INR");
  expect(exp.concepts.map((c) => c.conceptId)).not.toContain("ZZZ");
});

test("throws when no generated concept has a win-rate", () => {
  const t = { categoryId: "x", concepts: [concept("A", "A")], report: { concepts: [], winner: null } };
  expect(() => buildExperiment(t as any, "INR")).toThrow();
});

test("slug collisions are disambiguated", () => {
  const t = {
    categoryId: "x",
    concepts: [concept("A/Name", "n1"), concept("A Name", "n2")],
    report: { concepts: [{ conceptId: "A/Name", winRate: 0.3 }, { conceptId: "A Name", winRate: 0.2 }], winner: null },
  };
  const exp = buildExperiment(t as any, "INR");
  const slugs = exp.concepts.map((c) => c.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/experiment.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/smoketest/experiment.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { SmokeConcept, SmokeExperiment } from "./types.ts";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface TournamentLike {
  categoryId: string;
  concepts: BrandConcept[];
  report: { concepts: Array<{ conceptId: string; winRate: number }>; winner?: { conceptId?: string } | null };
}

export function buildExperiment(tournament: TournamentLike, currency = "INR"): SmokeExperiment {
  const winRateById = new Map<string, number>();
  for (const r of tournament.report?.concepts ?? []) {
    if (typeof r?.conceptId === "string" && typeof r?.winRate === "number") {
      winRateById.set(r.conceptId, r.winRate);
    }
  }

  const usedSlugs = new Set<string>();
  const concepts: SmokeConcept[] = [];
  for (const c of tournament.concepts ?? []) {
    const score = winRateById.get(c.id);
    if (typeof score !== "number") continue; // drop concepts with no synthetic pair
    let slug = slugify(c.id) || slugify(c.name) || "concept";
    let n = 2;
    const base = slug;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    concepts.push({ conceptId: c.id, name: c.name, syntheticScore: score, slug, pagePath: `pages/${slug}.html` });
  }

  if (concepts.length === 0) {
    throw new Error("smoketest: no generated concept has a win-rate in tournament.report.concepts");
  }

  return {
    category: tournament.categoryId,
    currency,
    builtAt: new Date().toISOString(),
    realMetric: "notify CTR",
    source: "smoke-test",
    unit: "concept",
    tournamentRef: tournament.report?.winner?.conceptId ?? undefined,
    concepts,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/experiment.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/smoketest/experiment.ts src/smoketest/experiment.test.ts
git commit -m "feat(smoketest): pure buildExperiment from tournament output"
```

---

## Task 3: renderPdpPage (pure, escaped)

**Files:**
- Create: `src/smoketest/page.ts`
- Test: `src/smoketest/page.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test, expect } from "bun:test";
import { renderPdpPage } from "./page.ts";

function concept(over: Partial<any> = {}) {
  return { id: "x", name: "SunShield", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "SunShield SPF 50", priceMinor: 59900, priceBand: "premium",
    tagline: "Hydration meets protection", claims: ["SPF 50", "Hydrating"], packagingDirection: "x",
    brandVoice: "x", landingHeadline: "Protect & hydrate", topAdAngles: [], objections: [],
    launchRisks: [], ...over };
}

test("renders headline, tagline, claims, price in major units, and notify CTA hook", () => {
  const html = renderPdpPage(concept(), { currency: "INR", experimentId: "exp1" });
  expect(html).toContain("Protect &amp; hydrate"); // escaped headline
  expect(html).toContain("Hydration meets protection");
  expect(html).toContain("SPF 50");
  expect(html).toContain("599"); // 59900 minor -> 599
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="x"');
  expect(html).toContain("PB_TRACK");
});

test("HTML-escapes injection characters in concept text", () => {
  const html = renderPdpPage(concept({ name: '<script>"&', landingHeadline: "a<b>&c" }));
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("a&lt;b&gt;&amp;c");
});

test("empty claims -> no claim list, no empty bullets", () => {
  const html = renderPdpPage(concept({ claims: [] }));
  expect(html).not.toContain("<li></li>");
  expect(html).not.toContain("<ul"); // omit list entirely
});

test("deterministic for same input (no body timestamp)", () => {
  const a = renderPdpPage(concept(), { currency: "INR" });
  const b = renderPdpPage(concept(), { currency: "INR" });
  expect(a).toBe(b);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/page.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/smoketest/page.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPdpPage(
  concept: BrandConcept,
  opts: { experimentId?: string; currency?: string } = {},
): string {
  const currency = opts.currency ?? "INR";
  const price = (concept.priceMinor / 100).toLocaleString("en-IN");
  const claims = (concept.claims ?? []).filter((c) => c && c.trim());
  const claimsHtml = claims.length
    ? `<ul class="claims">${claims.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "";
  const expComment = opts.experimentId ? `<!-- experiment:${esc(opts.experimentId)} -->` : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(concept.name)}</title>
<style>
  :root{--ink:#171411;--accent:#1d4ed8}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:#faf7f2}
  main{max-width:560px;margin:0 auto;padding:48px 24px}
  h1{font-size:34px;line-height:1.1;margin:0 0 8px}
  .tagline{font-size:18px;color:#6b6258;margin:0 0 24px}
  .lead{font-size:16px;line-height:1.5}
  .claims{padding-left:20px;line-height:1.7}
  .price{font-weight:600;margin:20px 0}
  button{background:var(--ink);color:#fff;border:0;border-radius:999px;padding:14px 26px;font-size:16px;cursor:pointer}
  .ok{display:none;margin-top:16px;color:#15803d;font-weight:600}
</style></head>
<body>${expComment}
<main>
  <h1>${esc(concept.landingHeadline || concept.name)}</h1>
  <p class="tagline">${esc(concept.tagline)}</p>
  <p class="lead">${esc(concept.productPromise || concept.positioning)}</p>
  ${claimsHtml}
  <p class="price">${esc(concept.heroSku)} — ${esc(currency)} ${price}</p>
  <button id="notify-cta" data-cta="notify" data-concept-id="${esc(concept.id)}"${opts.experimentId ? ` data-experiment-id="${esc(opts.experimentId)}"` : ""} onclick="pbNotify()">Notify me at launch</button>
  <p class="ok" id="notify-ok">You're on the list ✅</p>
</main>
<script>
  // PB_TRACK: no-op stub. Wire to GA/Plausible/GTM to count notify clicks.
  function PB_TRACK(){ /* operator integration point */ }
  function pbNotify(){
    PB_TRACK("notify", document.getElementById("notify-cta").dataset);
    document.getElementById("notify-ok").style.display = "block";
  }
</script>
</body></html>`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/page.test.ts`
Expected: PASS (4).

NOTE: the price assertion checks the substring `599`; `toLocaleString("en-IN")` of 599 is `"599"`. If a future price crosses 1000 the locale adds a comma — tests use 59900 (=599) to stay simple.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/smoketest/page.ts src/smoketest/page.test.ts
git commit -m "feat(smoketest): pure escaped notify-me PDP renderer"
```

---

## Task 4: parseResultsCsv (pure, fail-clean)

**Files:**
- Create: `src/smoketest/results.ts`
- Test: `src/smoketest/results.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test, expect } from "bun:test";
import { parseResultsCsv } from "./results.ts";
import type { SmokeExperiment } from "./types.ts";

const exp: SmokeExperiment = {
  category: "lipcare-india", currency: "INR", builtAt: "2026-06-28T00:00:00.000Z",
  realMetric: "notify CTR", source: "smoke-test", unit: "concept",
  concepts: [
    { conceptId: "SPF-LIPCARE-001", name: "SunShield", syntheticScore: 0.25, slug: "spf", pagePath: "pages/spf.html" },
    { conceptId: "001", name: "LipCraft", syntheticScore: 0.1, slug: "lipcraft", pagePath: "pages/lipcraft.html" },
  ],
};
const at = "2026-06-28T10:00:00.000Z";

test("valid rows -> CTR observations with synthetic pair, source/unit/metric set", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,200,10\n001,100,4\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(skipped).toHaveLength(0);
  expect(observations).toHaveLength(2);
  expect(observations[0]!.realOutcome).toBeCloseTo(0.05, 6);
  expect(observations[0]!.syntheticScore).toBe(0.25);
  expect(observations[0]!.source).toBe("smoke-test");
  expect(observations[0]!.unit).toBe("concept");
  expect(observations[0]!.realMetric).toBe("notify CTR");
  expect(observations[0]!.id).toBe("smoke-lipcare-india-SPF-LIPCARE-001-2026-06-28T00:00:00.000Z");
});

test("zero visitors -> skipped (no div-by-zero, no fabricated CTR)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,0,0\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("visitors");
});

test("clicks > visitors -> skipped (CTR cannot exceed 1)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,10,20\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("clicks");
});

test("negative / non-numeric -> skipped", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,-5,1\n001,abc,2\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped).toHaveLength(2);
});

test("unknown conceptId -> skipped (no synthetic pair)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nZZZ,100,5\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("unknown");
});

test("malformed header -> throws", () => {
  expect(() => parseResultsCsv(exp, "foo,bar\n1,2\n", at)).toThrow();
});

test("dedupe id is stable across re-parse of same experiment", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,200,10\n";
  const a = parseResultsCsv(exp, csv, at).observations[0]!.id;
  const b = parseResultsCsv(exp, csv, "2026-06-28T12:00:00.000Z").observations[0]!.id;
  expect(a).toBe(b); // id keyed on experiment.builtAt, not import time
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/results.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/smoketest/results.ts`**

```typescript
import type { CalibrationObservation } from "../calibration/types.ts";
import type { SmokeExperiment } from "./types.ts";

export interface SkippedRow {
  conceptId: string;
  reason: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const REQUIRED_HEADER = ["conceptId", "pageVisitors", "notifyClicks"];

export function parseResultsCsv(
  experiment: SmokeExperiment,
  csvText: string,
  recordedAt: string,
): { observations: CalibrationObservation[]; skipped: SkippedRow[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("smoketest: empty results CSV");
  const header = lines[0]!.split(",").map((h) => h.trim());
  if (REQUIRED_HEADER.some((h, i) => header[i] !== h)) {
    throw new Error(`smoketest: bad CSV header; expected "${REQUIRED_HEADER.join(",")}"`);
  }

  const byId = new Map(experiment.concepts.map((c) => [c.conceptId, c]));
  const observations: CalibrationObservation[] = [];
  const skipped: SkippedRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const conceptId = cells[0] ?? "";
    const visitors = Number(cells[1]);
    const clicks = Number(cells[2]);
    const concept = byId.get(conceptId);

    if (!concept) { skipped.push({ conceptId, reason: "unknown conceptId (not in experiment)" }); continue; }
    if (!Number.isFinite(visitors) || !Number.isFinite(clicks)) { skipped.push({ conceptId, reason: "non-numeric visitors/clicks" }); continue; }
    if (visitors <= 0) { skipped.push({ conceptId, reason: "pageVisitors must be > 0" }); continue; }
    if (clicks < 0) { skipped.push({ conceptId, reason: "negative notifyClicks" }); continue; }
    if (clicks > visitors) { skipped.push({ conceptId, reason: "notifyClicks > pageVisitors (CTR > 1)" }); continue; }

    observations.push({
      id: `smoke-${experiment.category}-${conceptId}-${experiment.builtAt}`,
      category: experiment.category,
      syntheticScore: concept.syntheticScore,
      realOutcome: clamp01(clicks / visitors),
      source: "smoke-test",
      unit: "concept",
      label: `${concept.name} smoke`,
      realMetric: "notify CTR",
      recordedAt,
      notes: `visitors=${visitors}, clicks=${clicks}`,
    });
  }

  return { observations, skipped };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/results.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/smoketest/results.ts src/smoketest/results.test.ts
git commit -m "feat(smoketest): pure CSV->calibration parser, fail-clean"
```

---

## Task 5: writeExperiment / readExperiment (I/O)

**Files:**
- Create: `src/smoketest/write.ts`
- Test: `src/smoketest/write.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExperiment, readExperiment } from "./write.ts";
import type { SmokeExperiment } from "./types.ts";

function fixture(): { exp: SmokeExperiment; concepts: any[] } {
  const exp: SmokeExperiment = {
    category: "lipcare-india", currency: "INR", builtAt: "2026-06-28T00:00:00.000Z",
    realMetric: "notify CTR", source: "smoke-test", unit: "concept",
    concepts: [{ conceptId: "001", name: "LipCraft", syntheticScore: 0.1, slug: "lipcraft", pagePath: "pages/lipcraft.html" }],
  };
  const concepts = [{ id: "001", name: "LipCraft", positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 9900, priceBand: "value", tagline: "tg",
    claims: ["x"], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] }];
  return { exp, concepts };
}

test("writes manifest, csv template, and one page per concept; round-trips manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  const { exp, concepts } = fixture();
  await writeExperiment(exp, concepts as any, dir);
  const back = await readExperiment("lipcare-india", dir);
  expect(back?.concepts[0]!.conceptId).toBe("001");

  const base = join(dir, "lipcare-india", "smoketest");
  expect(await Bun.file(join(base, "experiment.json")).exists()).toBe(true);
  expect(await Bun.file(join(base, "results-template.csv")).exists()).toBe(true);
  expect(await Bun.file(join(base, "pages", "lipcraft.html")).exists()).toBe(true);

  const csv = await Bun.file(join(base, "results-template.csv")).text();
  expect(csv.split(/\r?\n/)[0]).toBe("conceptId,pageVisitors,notifyClicks");
  expect(csv).toContain("001,0,0");
  await rm(dir, { recursive: true, force: true });
});

test("readExperiment returns null when missing (no throw)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  expect(await readExperiment("nope", dir)).toBeNull();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/write.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/smoketest/write.ts`**

```typescript
import { mkdir } from "node:fs/promises";
import type { BrandConcept } from "../brand/types.ts";
import type { SmokeExperiment } from "./types.ts";
import { renderPdpPage } from "./page.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function dirFor(category: string, baseDir: string): string {
  return `${baseDir}/${slug(category)}/smoketest`;
}

export async function writeExperiment(
  experiment: SmokeExperiment,
  concepts: BrandConcept[],
  baseDir = "data",
): Promise<{ dir: string; pages: number }> {
  const dir = dirFor(experiment.category, baseDir);
  await mkdir(`${dir}/pages`, { recursive: true });

  await Bun.write(`${dir}/experiment.json`, JSON.stringify(experiment, null, 2));

  const csv =
    "conceptId,pageVisitors,notifyClicks\n" +
    experiment.concepts.map((c) => `${c.conceptId},0,0`).join("\n") + "\n";
  await Bun.write(`${dir}/results-template.csv`, csv);

  const byId = new Map(concepts.map((c) => [c.id, c]));
  let pages = 0;
  for (const sc of experiment.concepts) {
    const concept = byId.get(sc.conceptId);
    if (!concept) continue;
    const html = renderPdpPage(concept, { currency: experiment.currency, experimentId: experiment.builtAt });
    await Bun.write(`${dir}/${sc.pagePath}`, html);
    pages++;
  }
  return { dir, pages };
}

export async function readExperiment(category: string, baseDir = "data"): Promise<SmokeExperiment | null> {
  const path = `${dirFor(category, baseDir)}/experiment.json`;
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    return (await f.json()) as SmokeExperiment;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/smoketest/write.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/smoketest/write.ts src/smoketest/write.test.ts
git commit -m "feat(smoketest): write/read experiment bundle (manifest + csv + pages)"
```

---

## Task 6: CLI verbs smoketest-build + smoketest-import

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Add scripts to package.json**

In `"scripts"`, add:

```json
    "smoketest:build": "bun run src/cli.ts smoketest-build",
    "smoketest:import": "bun run src/cli.ts smoketest-import",
```

- [ ] **Step 2: Read `src/cli.ts` to confirm helpers (`arg`, `flag`, `slugify`) and the `switch (cmd)` block. Add imports near other imports:**

```typescript
import { buildExperiment } from "./smoketest/experiment.ts";
import { writeExperiment, readExperiment } from "./smoketest/write.ts";
import { parseResultsCsv } from "./smoketest/results.ts";
import { CalibrationStore } from "./calibration/store.ts";
```

(If `CalibrationStore` is already imported for the calibrate verbs, do not duplicate the import.)

- [ ] **Step 3: Add two cases inside `switch (cmd)`:**

```typescript
  case "smoketest-build": {
    const category = arg("category");
    if (!category) { console.error("usage: smoketest-build --category=<c> [--tournament=out/tournament.json] [--currency=INR] [--out=data]"); process.exit(2); }
    const tournamentPath = arg("tournament", "out/tournament.json")!;
    let tournament: any;
    try {
      tournament = await Bun.file(tournamentPath).json();
    } catch {
      console.error(`smoketest-build: cannot read tournament JSON at ${tournamentPath}`);
      process.exit(2);
    }
    let experiment;
    try {
      experiment = buildExperiment(tournament, arg("currency", "INR"));
    } catch (e) {
      console.error(`smoketest-build: ${(e as Error).message}`);
      process.exit(2);
    }
    const { dir, pages } = await writeExperiment(experiment, tournament.concepts ?? [], arg("out", "data"));
    console.log(
      `Built smoke-test experiment for '${experiment.category}' -> ${dir}\n` +
        `  ${pages} notify-me PDP pages, manifest + results-template.csv\n` +
        `  Next: run traffic, fill the CSV, then bun run smoketest:import --category=${category} --csv=<path>`,
    );
    break;
  }

  case "smoketest-import": {
    const category = arg("category");
    const csvPath = arg("csv");
    if (!category || !csvPath) { console.error("usage: smoketest-import --category=<c> --csv=<path> [--out=data]"); process.exit(2); }
    const baseDir = arg("out", "data");
    const experiment = await readExperiment(category, baseDir);
    if (!experiment) { console.error(`smoketest-import: no experiment.json for '${category}'; run smoketest-build first`); process.exit(2); }
    let csvText: string;
    try {
      csvText = await Bun.file(csvPath).text();
    } catch {
      console.error(`smoketest-import: cannot read CSV at ${csvPath}`);
      process.exit(2);
    }
    let parsed;
    try {
      parsed = parseResultsCsv(experiment, csvText, new Date().toISOString());
    } catch (e) {
      console.error(`smoketest-import: ${(e as Error).message}`);
      process.exit(2);
    }
    // Calibration store ALWAYS writes to the default "data" root so calibrate:status
    // (which defaults to data) can read these observations. --out only controls where
    // the experiment bundle (pages/manifest/csv) lives, not the calibration store.
    const store = new CalibrationStore(category);
    for (const obs of parsed.observations) await store.record(obs);
    console.log(`recorded ${parsed.observations.length} / skipped ${parsed.skipped.length}`);
    for (const s of parsed.skipped) console.log(`  skip ${s.conceptId}: ${s.reason}`);
    console.log(`Next: bun run calibrate:status --category=${category}`);
    break;
  }
```

- [ ] **Step 4: Manual smoke test (build from existing tournament, import a tiny CSV)**

Run (uses the current `out/tournament.json`; if absent, run a tournament first or skip to fixture):
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run smoketest:build --category=__smoke_demo --tournament=out/tournament.json --currency=INR --out=/tmp/pb_smoke
ls /tmp/pb_smoke/__smoke_demo/smoketest /tmp/pb_smoke/__smoke_demo/smoketest/pages
# pick a real conceptId from the printed manifest / pages, then:
cat > /tmp/pb_results.csv <<'CSV'
conceptId,pageVisitors,notifyClicks
REPLACE_WITH_REAL_ID,200,10
CSV
bun run smoketest:import --category=__smoke_demo --csv=/tmp/pb_results.csv --out=/tmp/pb_smoke
bun run calibrate:status --category=__smoke_demo
rm -rf /tmp/pb_smoke /tmp/pb_results.csv data/__smoke_demo
```
Expected: build prints page count; import prints `recorded 1 / skipped 0` (when the id matches); `calibrate:status` shows n≥1. Note: the experiment bundle lives under `--out` (`/tmp/pb_smoke`), but the calibration observations are recorded under the default `data/` root, which is exactly where `calibrate:status` reads — so clean up BOTH `/tmp/pb_smoke` and `data/__smoke_demo`.

If the tournament file is unavailable, this step may be skipped; Tasks 2-5 already prove the logic with fixtures.

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git status --short   # confirm no data/ or /tmp artifacts staged
git add src/cli.ts package.json
git commit -m "feat(cli): smoketest-build + smoketest-import verbs"
```

---

## Task 7: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new smoketest tests).

- [ ] **Step 2: Confirm clean tree, no stray artifacts**

Run: `git status --short`
Expected: clean (no `data/`, `/tmp`, or `out/` artifacts committed).

- [ ] **Step 3: Review diff against spec**

Run: `git log --oneline smoke-test-adapter ^main`
Confirm tasks 1-6 each produced a commit and spec sections 1-4 are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead.**
