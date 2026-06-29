# Brand Identity Upgrade Implementation Plan (Sub-project 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `deriveLiteKit` stub with the real LLM `buildBrandKit` in the candidate-card path, add a new `BrandNarrative` (vision/story/values) and a restrained brand `motif` per winner, persist all three, and carry richer card data to the UI.

**Architecture:** New pure data type + LLM generator (`BrandNarrative`/`buildNarrative`) and a fail-clean image generator (`generateMotif`) live in their own focused modules. The card builder (`src/launchpages/run.ts`) swaps the lite kit for the real kit, builds narrative + motif, persists `brandkit.json`/`narrative.json`/`motif.png`, and emits a new `card-identity` event. The viewstate reducer stores per-concept identity. Pure functions are tested; LLM/image calls are thin wrappers behind injectable deps.

**Tech Stack:** Bun, TypeScript, zod, `bun:test`. Reuses `Agent` (`src/agents/agent.ts`), `buildBrandKit` (`src/creative/brandkit.ts`), `ImageClient` (`src/llm/imageClient.ts`).

**Spec:** `docs/superpowers/specs/2026-06-29-brand-identity-upgrade-design.md`

---

## File Structure

- Create: `src/brand/narrative.ts` — `BrandNarrative` type + `buildNarrative` + save/load.
- Create: `src/brand/narrative.test.ts`.
- Create: `src/creative/motif.ts` — `generateMotif` (fail-clean image gen).
- Create: `src/creative/motif.test.ts`.
- Modify: `src/server/events.ts` — add `card-identity` event.
- Modify: `src/server/viewstate.ts` — `identities` map + reduce `card-identity`.
- Modify: `src/server/viewstate.test.ts`.
- Modify: `src/launchpages/run.ts` — real kit + narrative + motif + persist + emit.
- Modify: `src/launchpages/run.test.ts` — assert new behavior.

---

## Task 1: BrandNarrative type + schema

**Files:**
- Create: `src/brand/narrative.ts`
- Test: `src/brand/narrative.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/brand/narrative.test.ts
import { test, expect } from "bun:test";
import { BrandNarrativeSchema } from "./narrative.ts";

test("BrandNarrativeSchema parses a full narrative", () => {
  const n = BrandNarrativeSchema.parse({
    brandId: "verdant", vision: "v", mission: "m", originStory: "o",
    values: [{ name: "Honest", description: "d" }], manifesto: "man",
    customerStory: "c", tagline: "t",
  });
  expect(n.values[0]!.name).toBe("Honest");
});

test("BrandNarrativeSchema defaults missing arrays/strings", () => {
  const n = BrandNarrativeSchema.parse({ brandId: "x" });
  expect(n.values).toEqual([]);
  expect(n.vision).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/brand/narrative.test.ts`
Expected: FAIL — cannot find module `./narrative.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/brand/narrative.ts
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { Agent } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "./types.ts";
import type { BrandKit } from "../creative/types.ts";

export const BrandNarrativeSchema = z.object({
  brandId: z.string(),
  vision: z.string().default(""),
  mission: z.string().default(""),
  originStory: z.string().default(""),
  values: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  manifesto: z.string().default(""),
  customerStory: z.string().default(""),
  tagline: z.string().default(""),
});
export type BrandNarrative = z.infer<typeof BrandNarrativeSchema>;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Generate the verbal brand narrative (vision/story/values/manifesto) grounded in
 * the concept + kit. Honest fallbacks: any field the LLM omits falls back to a
 * concept-derived value — never invented precision. Never introduces new product
 * claims (reuses the concept's positioning/claims).
 */
export async function buildNarrative(
  concept: BrandConcept,
  kit: BrandKit,
  llm: LLMClient = new LLMClient(),
  market?: string,
): Promise<BrandNarrative> {
  const strategist = new Agent(
    {
      role: "Brand Strategist & Storyteller",
      charter:
        "You write a brand's verbal identity — its vision, mission, origin story, " +
        "values, manifesto, and the customer it serves — grounded strictly in the " +
        "concept and visual kit. You never invent product claims; you make the brand " +
        "feel real, specific, and ownable.",
      temperature: 0.7,
    },
    llm,
  );
  const brief = JSON.stringify({
    name: concept.name, positioning: concept.positioning, coreInsight: concept.coreInsight,
    targetCustomer: concept.targetCustomer, productPromise: concept.productPromise,
    tagline: concept.tagline, essence: kit.essence, voice: kit.voice,
    market: market ?? "infer from the target customer",
  }, null, 2);

  const raw = await strategist
    .respondJson<Record<string, unknown>>(
      `Brand concept + kit:\n${brief}\n\n` +
        `Write the brand narrative. Return JSON with EXACTLY these keys:\n` +
        `- vision: the future this brand is building toward (1-2 sentences)\n` +
        `- mission: what it does, for whom, why (1 sentence)\n` +
        `- originStory: a short, specific founding narrative (2-4 sentences)\n` +
        `- values: 3-5 of { name, description }\n` +
        `- manifesto: a punchy, voice-forward rallying paragraph (short)\n` +
        `- customerStory: a day-in-the-life of the target customer (2-3 sentences)\n` +
        `- tagline: one memorable line\n` +
        `Ground everything in the concept. Do NOT invent product claims. Return ONLY JSON.`,
    )
    .catch(() => ({} as Record<string, unknown>));

  return BrandNarrativeSchema.parse({
    brandId: concept.id || slug(concept.name),
    vision: raw.vision ?? concept.positioning,
    mission: raw.mission ?? concept.productPromise,
    originStory: raw.originStory ?? concept.coreInsight,
    values: Array.isArray(raw.values) ? raw.values : [],
    manifesto: raw.manifesto ?? concept.tagline,
    customerStory: raw.customerStory ?? concept.targetCustomer,
    tagline: raw.tagline ?? concept.tagline,
  });
}

export async function saveNarrative(n: BrandNarrative, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/narrative.json`;
  await Bun.write(path, JSON.stringify(n, null, 2));
  return path;
}

export async function loadNarrative(dir: string): Promise<BrandNarrative | null> {
  try {
    return BrandNarrativeSchema.parse(await Bun.file(`${dir}/narrative.json`).json());
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/brand/narrative.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/brand/narrative.ts src/brand/narrative.test.ts
git commit -m "feat(brand): BrandNarrative type + schema"
```

---

## Task 2: buildNarrative behavior (fake LLM) + save/load

**Files:**
- Modify: `src/brand/narrative.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/brand/narrative.test.ts
import { buildNarrative, saveNarrative, loadNarrative } from "./narrative.ts";

const concept: any = {
  id: "verdant", name: "Verdant", positioning: "clinical botanical repair",
  coreInsight: "balms fail at altitude", targetCustomer: "trekkers",
  productPromise: "all-day barrier repair", tagline: "Repair that lasts the climb",
};
const kit: any = { essence: "clinical botanical", voice: { tone: "calm expert", doSay: [], dontSay: [] } };

test("buildNarrative returns schema-valid narrative from LLM JSON", async () => {
  const llm: any = { completeJson: async () => ({
    vision: "a world where outdoor skin never cracks", mission: "repair lips at altitude",
    originStory: "born on a Himalayan trek", values: [{ name: "Rigor", description: "clinical proof" }],
    manifesto: "go further", customerStory: "she summits at dawn", tagline: "Repair that lasts the climb",
  }) };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.brandId).toBe("verdant");
  expect(n.vision).toContain("outdoor skin");
  expect(n.values[0]!.name).toBe("Rigor");
});

test("buildNarrative falls back to concept fields when LLM omits them", async () => {
  const llm: any = { completeJson: async () => ({}) };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.vision).toBe(concept.positioning);
  expect(n.originStory).toBe(concept.coreInsight);
  expect(n.values).toEqual([]);
});

test("buildNarrative does not throw when LLM rejects (uses fallbacks)", async () => {
  const llm: any = { completeJson: async () => { throw new Error("llm down"); } };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.brandId).toBe("verdant");
  expect(n.tagline).toBe(concept.tagline);
});

test("saveNarrative/loadNarrative round-trip", async () => {
  const dir = `/tmp/pb-narr-${Date.now()}`;
  const n = await buildNarrative(concept, kit, { completeJson: async () => ({}) } as any);
  await saveNarrative(n, dir);
  const back = await loadNarrative(dir);
  expect(back?.brandId).toBe("verdant");
});
```

- [ ] **Step 2: Run the tests**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/brand/narrative.test.ts && bun run typecheck`
Expected: PASS (6 tests total — these exercise the `buildNarrative`/`saveNarrative`/
`loadNarrative` already implemented in Task 1), typecheck clean. If any fail, fix
`narrative.ts` until green (the test is the spec).

- [ ] **Step 3: Commit**

```bash
git add src/brand/narrative.test.ts
git commit -m "test(brand): buildNarrative fallbacks + save/load round-trip"
```

---

## Task 3: generateMotif (fail-clean)

**Files:**
- Create: `src/creative/motif.ts`
- Test: `src/creative/motif.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/creative/motif.test.ts
import { test, expect } from "bun:test";
import { generateMotif } from "./motif.ts";

const kit: any = {
  brandName: "Verdant", essence: "clinical botanical",
  moodKeywords: ["rugged", "clinical"], palette: [{ name: "Pine", hex: "#1f3d2b", role: "primary" }],
};

test("generateMotif returns the written path on success", async () => {
  const ic: any = { generate: async () => ({ base64: "AAAA", mime: "image/png" }) };
  const dir = `/tmp/pb-motif-${Date.now()}`;
  const r = await generateMotif(kit, { outDir: dir, imageClient: ic });
  expect(r?.imagePath).toBe(`${dir}/motif.png`);
  expect(await Bun.file(r!.imagePath).exists()).toBe(true);
});

test("generateMotif returns null on generation failure (no throw)", async () => {
  const ic: any = { generate: async () => { throw new Error("img fail"); } };
  const r = await generateMotif(kit, { outDir: `/tmp/pb-motif-${Date.now()}`, imageClient: ic });
  expect(r).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/creative/motif.test.ts`
Expected: FAIL — cannot find `./motif.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/creative/motif.ts
import { mkdir } from "node:fs/promises";
import { ImageClient, writeImage } from "../llm/imageClient.ts";
import { LLMClient } from "../llm/client.ts";
import type { BrandKit } from "./types.ts";

export interface MotifResult { imagePath: string; }

/**
 * Generate ONE restrained, transparent-PNG brand device per brand — the quiet
 * recurring thread reused across the brand book (divider background, light
 * watermark). Fail-clean: returns null on any failure; the motif is an
 * enhancement, never load-bearing.
 */
export async function generateMotif(
  kit: BrandKit,
  opts: { outDir: string; imageClient?: ImageClient; llm?: LLMClient },
): Promise<MotifResult | null> {
  const ic = opts.imageClient ?? new ImageClient();
  const primary = kit.palette?.find((p) => p.role === "primary")?.hex ?? kit.palette?.[0]?.hex ?? "#1a1a1a";
  const prompt =
    `A single, minimal, abstract brand device/motif for "${kit.brandName}" — ${kit.essence}. ` +
    `Mood: ${(kit.moodKeywords ?? []).join(", ")}. ` +
    `RESTRAINED and quiet: one simple line-based or geometric mark, lots of negative space, ` +
    `single-color (${primary}) or subtle two-tone. NOT a busy pattern, NOT loud, NOT a logo, ` +
    `no text. Transparent background. Suitable as a faint recurring accent in a brand book.`;
  try {
    const blob = await ic.generate({
      prompt,
      aspect: "1:1",
      imageSize: "1K",
      system: "You produce minimal, elegant, restrained abstract brand devices on transparent backgrounds. Never busy, never loud.",
    });
    await mkdir(opts.outDir, { recursive: true });
    const ext = blob.mime.includes("jpeg") ? "jpg" : "png";
    const path = await writeImage(blob, `${opts.outDir}/motif.${ext === "jpg" ? "jpg" : "png"}`);
    return { imagePath: path };
  } catch {
    return null;
  }
}
```

NOTE: the test expects `motif.png`. The image client's `response_format` requests
jpeg in some paths; to keep the test deterministic, the fake returns `image/png` so
the path ends `.png`. Real runs may yield `.jpg` — that's fine; callers use the
returned `imagePath`, never a hardcoded extension.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/creative/motif.test.ts && bun run typecheck`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/creative/motif.ts src/creative/motif.test.ts
git commit -m "feat(creative): generateMotif — restrained transparent brand device, fail-clean"
```

---

## Task 4: `card-identity` event

**Files:**
- Modify: `src/server/events.ts`

- [ ] **Step 1: Add the event to the union**

In `src/server/events.ts`, after the `image-ready` line, add:

```ts
  | (BaseEvent & { type: "card-identity"; conceptId: string; name: string;
      essence: string; vision: string; story: string;
      palette: { name: string; hex: string; role: string }[]; motifUrl?: string })
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: clean (reducer `switch` has a `default`, so the new variant compiles).

- [ ] **Step 3: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(events): card-identity event for richer candidate cards"
```

---

## Task 5: viewstate `identities` map + reduce `card-identity`

**Files:**
- Modify: `src/server/viewstate.ts`
- Modify: `src/server/viewstate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/server/viewstate.test.ts
test("card-identity populates identities map per concept", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "card-identity", conceptId: "A", name: "Verdant", essence: "clinical botanical",
      vision: "no cracked lips", story: "born on a trek",
      palette: [{ name: "Pine", hex: "#1f3d2b", role: "primary" }], motifUrl: "/out/a/motif.png" },
  ]);
  expect(s.identities["A"]!.name).toBe("Verdant");
  expect(s.identities["A"]!.vision).toBe("no cracked lips");
  expect(s.identities["A"]!.palette[0]!.hex).toBe("#1f3d2b");
  expect(s.identities["A"]!.motifUrl).toBe("/out/a/motif.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/viewstate.test.ts`
Expected: FAIL — `s.identities` is undefined.

- [ ] **Step 3: Add the state field + reduce case**

In `src/server/viewstate.ts`, add an interface above `ViewState`:

```ts
export interface CardIdentity {
  name: string; essence: string; vision: string; story: string;
  palette: { name: string; hex: string; role: string }[]; motifUrl?: string;
}
```

Add to the `ViewState` interface (after `pages`):

```ts
  identities: Record<string, CardIdentity>;
```

In `initialState()`, add `identities: {},` to the returned object.

Add the reduce case (after `image-ready`):

```ts
    case "card-identity":
      return { ...state, identities: { ...state.identities, [e.conceptId]: {
        name: e.name, essence: e.essence, vision: e.vision, story: e.story,
        palette: e.palette, motifUrl: e.motifUrl } } };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/server/viewstate.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/viewstate.ts src/server/viewstate.test.ts
git commit -m "feat(viewstate): identities map populated from card-identity"
```

---

## Task 6: Card builder — real kit + narrative + motif + persist + emit

**Files:**
- Modify: `src/launchpages/run.ts`
- Modify: `src/launchpages/run.test.ts`

**Read `src/launchpages/run.ts` fully before editing.** The current per-finalist loop
(around line 73) does `deriveLiteKit` → `generateIdentity` → `optimizeCreative` →
emits → `buildLandingPage`. Keep everything except swap the kit and add narrative +
motif + persistence + the `card-identity` emit. Do NOT remove the page build.

- [ ] **Step 1: Add the failing test**

```ts
// add to src/launchpages/run.test.ts (a new test; keep existing tests)
import { test, expect } from "bun:test";
import { runLaunchpages } from "./run.ts";

function finalist() {
  return { rank: 1, winRate: 0.4, concept: {
    id: "verdant", name: "Verdant", positioning: "clinical botanical repair",
    coreInsight: "balms fail at altitude", targetCustomer: "trekkers",
    productPromise: "barrier repair", heroSku: "Balm", priceMinor: 34900, priceBand: "premium",
    tagline: "Repair that lasts the climb", claims: ["SPF 30"], packagingDirection: "tube",
    brandVoice: "calm expert", landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [],
  } };
}

test("card builder uses real buildBrandKit, builds narrative+motif, emits card-identity", async () => {
  const events: any[] = [];
  let kitCalled = false, narrCalled = false, motifCalled = false;
  const dir = `/tmp/pb-cards-${Date.now()}`;
  await runLaunchpages(
    { outDir: dir, onEvent: (e) => events.push(e) },
    {
      readFinalists: async () => ({ categoryId: "lipcare", finalists: [finalist()] }),
      buildBrandKit: async (c: any) => { kitCalled = true; return {
        brandId: c.id, brandName: c.name, essence: "clinical botanical",
        palette: [{ name: "Pine", hex: "#1f3d2b", role: "primary" }],
        typography: { headingMood: "bold", bodyMood: "clean", pairing: "x" },
        artDirection: "a", casting: "", moodKeywords: ["rugged"], logoDirection: "l",
        packagingDirection: "p", voice: { tone: "calm", doSay: [], dontSay: [] },
        visualDos: [], visualDonts: [], negativePrompt: "", competitiveNotes: [] }; },
      buildNarrative: async () => { narrCalled = true; return {
        brandId: "verdant", vision: "no cracked lips", mission: "m", originStory: "born on a trek",
        values: [], manifesto: "go further", customerStory: "c", tagline: "t" }; },
      generateMotif: async () => { motifCalled = true; return { imagePath: `${dir}/verdant/motif.png` }; },
      generateIdentity: async () => ({ logo: { imagePath: `${dir}/verdant/logo.png` },
        packaging: { imagePath: `${dir}/verdant/pack.png` }, refImages: [] }) as any,
      optimizeCreative: async () => ({ champion: { imagePath: `${dir}/verdant/prod.png` } }) as any,
      buildLandingPage: async () => ({ indexPath: `${dir}/verdant/index.html`, usedFallback: false, warnings: [] }) as any,
    },
  );
  expect(kitCalled).toBe(true);
  expect(narrCalled).toBe(true);
  expect(motifCalled).toBe(true);
  const ci = events.find((e) => e.type === "card-identity");
  expect(ci?.vision).toBe("no cracked lips");
  expect(ci?.palette[0].hex).toBe("#1f3d2b");
  expect(await Bun.file(`${dir}/verdant/brandkit.json`).exists()).toBe(true);
  expect(await Bun.file(`${dir}/verdant/narrative.json`).exists()).toBe(true);
});

test("card builder falls back to deriveLiteKit when buildBrandKit throws", async () => {
  const events: any[] = [];
  const dir = `/tmp/pb-cards-fb-${Date.now()}`;
  await runLaunchpages(
    { outDir: dir, onEvent: (e) => events.push(e) },
    {
      readFinalists: async () => ({ categoryId: "lipcare", finalists: [finalist()] }),
      buildBrandKit: async () => { throw new Error("kit llm down"); },
      buildNarrative: async () => ({ brandId: "verdant", vision: "", mission: "", originStory: "",
        values: [], manifesto: "", customerStory: "", tagline: "t" }),
      generateMotif: async () => null,
      generateIdentity: async () => ({ logo: { imagePath: `${dir}/verdant/logo.png` },
        packaging: { imagePath: `${dir}/verdant/pack.png` }, refImages: [] }) as any,
      optimizeCreative: async () => ({ champion: { imagePath: `${dir}/verdant/prod.png` } }) as any,
      buildLandingPage: async () => ({ indexPath: `${dir}/verdant/index.html`, usedFallback: false, warnings: [] }) as any,
    },
  );
  // Still produced a card-identity (from the lite kit) and did not crash.
  expect(events.some((e) => e.type === "card-identity")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/launchpages/run.test.ts`
Expected: FAIL — deps `buildBrandKit`/`buildNarrative`/`generateMotif` not accepted; no `card-identity`.

- [ ] **Step 3: Update `LaunchpagesDeps` + types**

In `src/launchpages/run.ts`, add imports:

```ts
import { buildBrandKit as realBuildBrandKit, saveBrandKit } from "../creative/brandkit.ts";
import { buildNarrative as realBuildNarrative, saveNarrative } from "../brand/narrative.ts";
import { generateMotif as realGenerateMotif } from "../creative/motif.ts";
```

Add to the `LaunchpagesDeps` interface:

```ts
  buildBrandKit?: typeof realBuildBrandKit;
  buildNarrative?: typeof realBuildNarrative;
  generateMotif?: typeof realGenerateMotif;
```

In the function body where deps are resolved, add:

```ts
  const buildBrandKit = deps.buildBrandKit ?? realBuildBrandKit;
  const buildNarrative = deps.buildNarrative ?? realBuildNarrative;
  const generateMotif = deps.generateMotif ?? realGenerateMotif;
```

- [ ] **Step 4: Swap the kit + add narrative/motif/persist/emit in the loop**

In the per-finalist `try` block, replace `const kit = deriveLiteKit(concept);` with:

```ts
      let kit;
      try {
        kit = await buildBrandKit(concept, undefined, llm, "India");
      } catch (e) {
        console.error(`[launchpages] buildBrandKit failed for ${concept.id}, using lite kit: ${(e as Error).message}`);
        kit = deriveLiteKit(concept);
      }
      const narrative = await buildNarrative(concept, kit, llm, "India");
      const motif = await generateMotif(kit, { outDir: bundleDir, imageClient, llm });
      await saveBrandKit(kit, bundleDir);
      await saveNarrative(narrative, bundleDir);
      const rel = (p: string) => "/" + p.replace(/^\.?\//, "");
      opts.onEvent?.({ type: "card-identity", conceptId: concept.id, name: concept.name,
        essence: kit.essence, vision: narrative.vision, story: narrative.originStory,
        palette: kit.palette, motifUrl: motif ? rel(motif.imagePath) : undefined });
```

NOTE: there is already a `const rel = ...` later in the loop. Remove the later
duplicate declaration (keep this earlier one) so `rel` is defined once per iteration.
Keep `deriveLiteKit` imported (still used as the fallback).

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/launchpages/run.test.ts && bun run typecheck`
Expected: PASS (new tests + existing), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/launchpages/run.ts src/launchpages/run.test.ts
git commit -m "feat(launchpages): real BrandKit + narrative + motif per winner, persist + emit card-identity"
```

---

## Task 7: Full suite + typecheck green

**Files:** none (verification)

- [ ] **Step 1: Run the whole suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
Expected: all tests pass (311 prior + ~11 new), 0 fail.

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit (if fixups needed)**

```bash
git add -A
git commit -m "test(brand): full suite green for brand identity upgrade"
```

---

## Self-Review Notes

- **Spec coverage:** real buildBrandKit in card path (Task 6) · BrandNarrative type+generator+save/load (Tasks 1-2) · generateMotif fail-clean (Task 3) · persist kit+narrative+motif (Task 6) · card-identity event + reducer (Tasks 4-5) · richer card data carried (Tasks 5-6) · fallbacks for all three generators (Tasks 2,3,6). All spec sections mapped. Page build intentionally retained (Task 6 keeps `buildLandingPage`), per spec scope.
- **Type consistency:** `BrandNarrative` shape identical across narrative.ts, the card-identity event uses `vision`/`story`(=originStory)/`essence`/`palette` consistently; `CardIdentity` viewstate mirrors the event; `LaunchpagesDeps` new optional fields match the real function types via `typeof`.
- **No placeholders:** every step has complete code + exact commands/expected output.
- **Note for implementer:** Task 6 Step 4 flags an existing duplicate `const rel` in run.ts — dedupe to one declaration per loop iteration.
