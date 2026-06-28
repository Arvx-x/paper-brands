# Branded Landing-Page Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a landing-page builder for one concept: gemini-3.1-flash codes a full HTML/CSS page from the concept + creative assets, a deterministic step injects the smoke-test notify-CTA metadata, and assets are copied into a self-contained deployable bundle.

**Architecture:** New `src/launchpage/` module — pure `injectNotifyCta` (honesty-critical, LLM-independent) + impure `codePage` (gemini) + I/O `bundleAssets` + `buildLandingPage` orchestrator that falls back to the smoke-test `renderPdpPage` on LLM failure. Same pure-core/impure-edge pattern as the rest of the repo.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`, `Bun.write`/`Bun.file`, `node:fs/promises`). Reuses `BrandConcept`, `BrandKit`, `LLMClient.complete`, `renderPdpPage`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-landing-page-builder-design.md`

---

## File Structure

- Create `src/launchpage/types.ts` — `CreativeAssets`, `BuildLandingPageOptions`, `LandingPageResult`.
- Create `src/launchpage/cta.ts` — `injectNotifyCta(html, ids)` (PURE).
- Create `src/launchpage/code.ts` — `codePage(concept, assets, llm, model)` (impure, LLM).
- Create `src/launchpage/bundle.ts` — `bundleAssets(html, assets, outDir)` (I/O).
- Create `src/launchpage/build.ts` — `buildLandingPage(concept, assets, llm, opts)` (orchestrator).
- Create `src/launchpage/*.test.ts`.

Verified facts:
- `LLMClient.complete({ messages, model?, temperature?, maxTokens? }): Promise<string>`. `model` accepts a bare model name like `"gemini-3.1-flash"` (or `provider:model`). Tests fake via `{ complete: async () => "<html>...</html>" } as any`.
- `renderPdpPage(concept, { experimentId?, currency? }): string` in `src/smoketest/page.ts` — the fallback. Its CTA already has `id="notify-cta"`, `data-cta="notify"`, `data-concept-id`, and the `PB_TRACK`/`pbNotify()` script.
- `BrandKit` type exported from `src/creative/types.ts` (`palette: {name,hex,role}[]`, `typeMoods`, `artDirection`, `voice`, `logoDirection`).
- `BrandConcept` fields: id, name, positioning, targetCustomer, coreInsight, productPromise, heroSku, priceMinor, priceBand, tagline, claims[], packagingDirection, brandVoice, landingHeadline, topAdAngles[], objections[], launchRisks[].
- Tests: `import { test, expect } from "bun:test";`, run `bun test`. Repo I/O: `mkdir` from `node:fs/promises`, `Bun.write`, `Bun.file`. `node:fs/promises` `copyFile` for copying assets.

---

## Task 1: Types

**Files:**
- Create: `src/launchpage/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
import type { BrandKit } from "../creative/types.ts";

export interface CreativeAssets {
  brandKit: BrandKit;
  logoPath?: string;
  heroPath?: string;
  packagingPath?: string;
  adPaths?: string[];
}

export interface BuildLandingPageOptions {
  outDir: string;
  experimentId?: string;
  model?: string;       // default "gemini-3.1-flash"
  currency?: string;    // fallback price currency, default "INR"
}

export interface LandingPageResult {
  dir: string;
  indexPath: string;
  assetsCopied: string[];
  ctaInjected: "found-and-tagged" | "inserted";
  usedFallback: boolean;
  warnings: string[];
}
```

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
git add src/launchpage/types.ts
git commit -m "feat(launchpage): types (CreativeAssets, options, result)"
```

---

## Task 2: `injectNotifyCta` (PURE, honesty-critical)

**Files:**
- Create: `src/launchpage/cta.ts`
- Test: `src/launchpage/cta.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpage/cta.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { injectNotifyCta } from "./cta.ts";

const ids = { conceptId: "C1", experimentId: "exp1" };

function count(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

test("tags an existing waitlist button (found-and-tagged), single #notify-cta", () => {
  const html = `<html><body><h1>Brand</h1><button>Join the waitlist</button></body></html>`;
  const { html: out, mode } = injectNotifyCta(html, ids);
  expect(mode).toBe("found-and-tagged");
  expect(count(out, /id="notify-cta"/g)).toBe(1);
  expect(out).toContain('data-concept-id="C1"');
  expect(out).toContain('data-experiment-id="exp1"');
});

test("inserts canonical CTA when no notify-ish button exists", () => {
  const html = `<html><body><h1>Brand</h1><p>copy</p></body></html>`;
  const { html: out, mode } = injectNotifyCta(html, ids);
  expect(mode).toBe("inserted");
  expect(count(out, /id="notify-cta"/g)).toBe(1);
  expect(out).toContain('data-concept-id="C1"');
});

test("PB_TRACK script always present, not duplicated", () => {
  const html = `<html><body><button>Notify me</button></body></html>`;
  const { html: out } = injectNotifyCta(html, ids);
  expect(count(out, /function pbNotify/g)).toBe(1);
  expect(count(out, /PB_TRACK/g)).toBeGreaterThanOrEqual(1);
});

test("idempotent: injecting twice yields one CTA and one script", () => {
  const html = `<html><body><p>x</p></body></html>`;
  const once = injectNotifyCta(html, ids).html;
  const twice = injectNotifyCta(once, ids).html;
  expect(count(twice, /id="notify-cta"/g)).toBe(1);
  expect(count(twice, /function pbNotify/g)).toBe(1);
});

test("escapes injected ids", () => {
  const { html: out } = injectNotifyCta(`<html><body><p>x</p></body></html>`, { conceptId: '"><script>', experimentId: "e" });
  expect(out).not.toContain('"><script>');
  expect(out).toContain("&quot;&gt;&lt;script&gt;");
});

test("malformed/empty html -> inserts, no throw", () => {
  const { html: out, mode } = injectNotifyCta("not really html", ids);
  expect(mode).toBe("inserted");
  expect(out).toContain('id="notify-cta"');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/cta.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpage/cta.ts`**

```typescript
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NOTIFY_TEXT = /notify|waitlist|join|launch|sign ?up|early access/i;

const TRACK_SCRIPT = `<script>
function PB_TRACK(){ /* operator integration point */ }
function pbNotify(){ PB_TRACK("notify", document.getElementById("notify-cta").dataset); var ok=document.getElementById("notify-ok"); if(ok) ok.style.display="block"; }
</script>`;

function canonicalCta(conceptId: string, experimentId?: string): string {
  const exp = experimentId ? ` data-experiment-id="${esc(experimentId)}"` : "";
  return `<div style="text-align:center;margin:32px 0">
<button id="notify-cta" data-cta="notify" data-concept-id="${esc(conceptId)}"${exp} onclick="pbNotify()" style="background:#171411;color:#fff;border:0;border-radius:999px;padding:14px 26px;font-size:16px;cursor:pointer">Notify me at launch</button>
<p id="notify-ok" style="display:none;margin-top:12px;color:#15803d;font-weight:600">You're on the list \u2705</p>
</div>`;
}

/** Deterministically guarantee a single countable notify CTA + PB_TRACK script. Idempotent. */
export function injectNotifyCta(
  html: string,
  ids: { conceptId: string; experimentId?: string },
): { html: string; mode: "found-and-tagged" | "inserted" } {
  let out = html;
  let mode: "found-and-tagged" | "inserted";

  if (out.includes('id="notify-cta"')) {
    // Already tagged (idempotent path) — leave the element, ensure script below.
    mode = out.indexOf('id="notify-cta"') >= 0 ? "found-and-tagged" : "inserted";
  } else {
    // Try to find a notify-ish <button> or <a> and tag it.
    const tagRe = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/i;
    let tagged = false;
    out = out.replace(tagRe, (full, tag, attrs, inner) => {
      if (tagged || !NOTIFY_TEXT.test(inner)) return full;
      tagged = true;
      const exp = ids.experimentId ? ` data-experiment-id="${esc(ids.experimentId)}"` : "";
      return `<${tag}${attrs} id="notify-cta" data-cta="notify" data-concept-id="${esc(ids.conceptId)}"${exp} onclick="pbNotify()">${inner}</${tag}>`;
    });
    if (tagged) {
      mode = "found-and-tagged";
      // ensure confirmation element exists
      if (!out.includes('id="notify-ok"')) {
        out = insertBeforeBodyEnd(out, `<p id="notify-ok" style="display:none">You're on the list \u2705</p>`);
      }
    } else {
      out = insertBeforeBodyEnd(out, canonicalCta(ids.conceptId, ids.experimentId));
      mode = "inserted";
    }
  }

  // ensure tracking script exactly once
  if (!out.includes("function pbNotify")) {
    out = insertBeforeBodyEnd(out, TRACK_SCRIPT);
  }
  return { html: out, mode };
}

function insertBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return html + "\n" + snippet;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/cta.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpage/cta.ts src/launchpage/cta.test.ts
git commit -m "feat(launchpage): pure deterministic injectNotifyCta (honesty-critical)"
```

---

## Task 3: `codePage` (LLM page coder)

**Files:**
- Create: `src/launchpage/code.ts`
- Test: `src/launchpage/code.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpage/code.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { codePage } from "./code.ts";

function concept() {
  return { id: "C1", name: "MyBrand", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "Hero SKU", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["claim a", "claim b"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "Big Headline", topAdAngles: [], objections: [], launchRisks: [] } as any;
}
const assets: any = { brandKit: { palette: [{ name: "Ink", hex: "#171411", role: "primary" }], typeMoods: [], artDirection: "", voice: "", logoDirection: "" }, heroPath: "/src/hero.png" };

test("returns the html doc the LLM produced (fenced block extracted)", async () => {
  const page = "<!DOCTYPE html><html><body><h1>Big Headline</h1></body></html>";
  const llm = { complete: async () => "Here you go:\n```html\n" + page + "\n```" } as any;
  const out = await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(out).toContain("<!DOCTYPE html>");
  expect(out).toContain("Big Headline");
  expect(out).not.toContain("```");
});

test("extracts a bare <!DOCTYPE..></html> span when no fence", async () => {
  const llm = { complete: async () => "prose <!DOCTYPE html><html><body>x</body></html> trailing" } as any;
  const out = await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(out.endsWith("</html>")).toBe(true);
});

test("throws when output contains no html", async () => {
  const llm = { complete: async () => "sorry, I cannot help with that" } as any;
  await expect(codePage(concept(), assets, llm, "gemini-3.1-flash")).rejects.toThrow();
});

test("passes the model through and references hero asset path in prompt", async () => {
  let capturedModel: string | undefined;
  let capturedPrompt = "";
  const llm = { complete: async (o: any) => { capturedModel = o.model; capturedPrompt = o.messages.map((m: any) => m.content).join("\n"); return "<!DOCTYPE html><html><body>x</body></html>"; } } as any;
  await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(capturedModel).toBe("gemini-3.1-flash");
  expect(capturedPrompt).toContain("assets/hero");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/code.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpage/code.ts`**

```typescript
import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CreativeAssets } from "./types.ts";

/** Canonical relative asset names the page should reference (only those present). */
export function assetRefs(assets: CreativeAssets): string[] {
  const refs: string[] = [];
  if (assets.logoPath) refs.push("assets/logo.png");
  if (assets.heroPath) refs.push("assets/hero.png");
  if (assets.packagingPath) refs.push("assets/packaging.png");
  (assets.adPaths ?? []).forEach((_, i) => refs.push(`assets/ad-${i + 1}.png`));
  return refs;
}

function extractHtml(raw: string): string | null {
  const fence = raw.match(/```html\s*([\s\S]*?)```/i);
  if (fence?.[1] && /<html[\s>]/i.test(fence[1])) return fence[1].trim();
  const span = raw.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) ?? raw.match(/<html[\s>][\s\S]*<\/html>/i);
  if (span) return span[0].trim();
  return null;
}

export async function codePage(
  concept: BrandConcept,
  assets: CreativeAssets,
  llm: LLMClient,
  model = "gemini-3.1-flash",
): Promise<string> {
  const refs = assetRefs(assets);
  const kit = assets.brandKit;
  const palette = (kit.palette ?? []).map((p) => `${p.name} ${p.hex} (${p.role})`).join(", ");

  const prompt =
    `Code ONE complete, self-contained, mobile-responsive HTML landing page for this D2C product.\n` +
    `Inline all CSS in a <style> tag. NO external stylesheets, NO JS frameworks, NO CDN links.\n\n` +
    `Brand: ${concept.name}\n` +
    `Headline: ${concept.landingHeadline}\nTagline: ${concept.tagline}\n` +
    `Positioning: ${concept.positioning}\nPromise: ${concept.productPromise}\n` +
    `Claims: ${(concept.claims ?? []).join("; ")}\n` +
    `Hero SKU: ${concept.heroSku} — price ${(concept.priceMinor / 100).toLocaleString("en-IN")} (${concept.priceBand})\n` +
    `Target customer: ${concept.targetCustomer}\n\n` +
    `Brand palette (use these hex values): ${palette || "(none)"}\n` +
    `Type mood: ${(kit.typeMoods ?? []).join(", ") || "(default)"}\nArt direction: ${kit.artDirection || "(none)"}\nVoice: ${kit.voice || "(none)"}\n\n` +
    (refs.length
      ? `Reference these local images with <img src="..."> (relative paths, exactly these): ${refs.join(", ")}\n`
      : `No images are available; design a strong text + color layout.\n`) +
    `Include a clear primary call-to-action button to JOIN THE LAUNCH WAITLIST.\n` +
    `Return ONLY the HTML document (a single <!DOCTYPE html>...</html>).`;

  const raw = await llm.complete({
    messages: [{ role: "user", content: prompt }],
    model,
    temperature: 0.7,
    maxTokens: 4000,
  });
  const html = extractHtml(raw);
  if (!html) throw new Error("codePage: LLM returned no usable HTML");
  return html;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/code.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpage/code.ts src/launchpage/code.test.ts
git commit -m "feat(launchpage): gemini page-coder (assetRefs + html extraction, fail on no-html)"
```

---

## Task 4: `bundleAssets` (I/O)

**Files:**
- Create: `src/launchpage/bundle.ts`
- Test: `src/launchpage/bundle.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpage/bundle.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleAssets } from "./bundle.ts";

async function srcImg(dir: string, name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, "PNGDATA");
  return p;
}

test("copies present assets to assets/ and writes index.html", async () => {
  const src = await mkdtemp(join(tmpdir(), "lp-src-"));
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const logo = await srcImg(src, "logo.png");
  const hero = await srcImg(src, "hero.png");
  const html = `<html><body><img src="assets/logo.png"><img src="assets/hero.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any, logoPath: logo, heroPath: hero }, out);

  expect(res.assetsCopied.sort()).toEqual(["assets/hero.png", "assets/logo.png"]);
  expect(await Bun.file(join(out, "index.html")).exists()).toBe(true);
  expect(await Bun.file(join(out, "assets", "logo.png")).exists()).toBe(true);
  expect(await Bun.file(join(out, "assets", "hero.png")).exists()).toBe(true);
  expect(res.warnings).toHaveLength(0);
  await rm(src, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("html references an asset that was not provided -> warning, no crash", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const html = `<html><body><img src="assets/hero.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any }, out);
  expect(res.warnings.some((w) => w.includes("hero"))).toBe(true);
  expect(await Bun.file(join(out, "index.html")).exists()).toBe(true);
  await rm(out, { recursive: true, force: true });
});

test("adPaths copied as ad-1.png, ad-2.png", async () => {
  const src = await mkdtemp(join(tmpdir(), "lp-src-"));
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const a1 = await srcImg(src, "a1.png");
  const a2 = await srcImg(src, "a2.png");
  const html = `<html><body><img src="assets/ad-1.png"><img src="assets/ad-2.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any, adPaths: [a1, a2] }, out);
  expect(res.assetsCopied.sort()).toEqual(["assets/ad-1.png", "assets/ad-2.png"]);
  await rm(src, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/bundle.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpage/bundle.ts`**

```typescript
import { mkdir, copyFile } from "node:fs/promises";
import type { CreativeAssets } from "./types.ts";

interface AssetMap { rel: string; src: string }

function plannedAssets(assets: CreativeAssets): AssetMap[] {
  const list: AssetMap[] = [];
  if (assets.logoPath) list.push({ rel: "assets/logo.png", src: assets.logoPath });
  if (assets.heroPath) list.push({ rel: "assets/hero.png", src: assets.heroPath });
  if (assets.packagingPath) list.push({ rel: "assets/packaging.png", src: assets.packagingPath });
  (assets.adPaths ?? []).forEach((src, i) => list.push({ rel: `assets/ad-${i + 1}.png`, src }));
  return list;
}

export async function bundleAssets(
  html: string,
  assets: CreativeAssets,
  outDir: string,
): Promise<{ assetsCopied: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  await mkdir(`${outDir}/assets`, { recursive: true });

  const planned = plannedAssets(assets);
  const assetsCopied: string[] = [];
  for (const a of planned) {
    try {
      await copyFile(a.src, `${outDir}/${a.rel}`);
      assetsCopied.push(a.rel);
    } catch {
      warnings.push(`asset copy failed for ${a.rel} (source ${a.src})`);
    }
  }

  // Verify each asset the HTML references was actually copied.
  const referenced = [...html.matchAll(/<img[^>]+src="(assets\/[^"]+)"/gi)].map((m) => m[1]!);
  for (const ref of referenced) {
    if (!assetsCopied.includes(ref)) warnings.push(`html references missing asset '${ref}'`);
  }

  await Bun.write(`${outDir}/index.html`, html);
  return { assetsCopied, warnings };
}
```

NOTE: canonical asset names always use `.png` (the creative renders are png), so no extension handling is needed.

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/bundle.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpage/bundle.ts src/launchpage/bundle.test.ts
git commit -m "feat(launchpage): bundleAssets (copy images + verify refs + write index.html)"
```

---

## Task 5: `buildLandingPage` orchestrator

**Files:**
- Create: `src/launchpage/build.ts`
- Test: `src/launchpage/build.test.ts`

- [ ] **Step 1: Write failing tests `src/launchpage/build.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLandingPage } from "./build.ts";

function concept() {
  return { id: "C1", name: "MyBrand", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "Hero SKU", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "Big Headline", topAdAngles: [], objections: [], launchRisks: [] } as any;
}
const assets: any = { brandKit: { palette: [], typeMoods: [], artDirection: "", voice: "", logoDirection: "" } };

test("happy path: gemini page -> CTA injected -> bundle written, no fallback", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => "<!DOCTYPE html><html><body><h1>Big Headline</h1><button>Join waitlist</button></body></html>" } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out, experimentId: "exp1" });
  expect(res.usedFallback).toBe(false);
  expect(res.ctaInjected).toBe("found-and-tagged");
  const html = await Bun.file(res.indexPath).text();
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="C1"');
  expect(html).toContain("function pbNotify");
  await rm(out, { recursive: true, force: true });
});

test("LLM throws -> falls back to renderPdpPage, still injects CTA, usedFallback true", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => { throw new Error("down"); } } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out });
  expect(res.usedFallback).toBe(true);
  const html = await Bun.file(res.indexPath).text();
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="C1"');
  expect(res.warnings.some((w) => w.toLowerCase().includes("fallback"))).toBe(true);
  await rm(out, { recursive: true, force: true });
});

test("LLM returns no html -> fallback", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => "sorry no" } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out });
  expect(res.usedFallback).toBe(true);
  await rm(out, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/build.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/launchpage/build.ts`**

```typescript
import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import { renderPdpPage } from "../smoketest/page.ts";
import { codePage } from "./code.ts";
import { injectNotifyCta } from "./cta.ts";
import { bundleAssets } from "./bundle.ts";
import type { CreativeAssets, BuildLandingPageOptions, LandingPageResult } from "./types.ts";

export async function buildLandingPage(
  concept: BrandConcept,
  assets: CreativeAssets,
  llm: LLMClient,
  opts: BuildLandingPageOptions,
): Promise<LandingPageResult> {
  const warnings: string[] = [];
  let usedFallback = false;

  let html: string;
  try {
    html = await codePage(concept, assets, llm, opts.model ?? "gemini-3.1-flash");
  } catch (e) {
    usedFallback = true;
    warnings.push(`LLM page-code failed, used fallback renderPdpPage: ${(e as Error).message}`);
    html = renderPdpPage(concept, { experimentId: opts.experimentId, currency: opts.currency ?? "INR" });
  }

  const injected = injectNotifyCta(html, { conceptId: concept.id, experimentId: opts.experimentId });
  const bundle = await bundleAssets(injected.html, assets, opts.outDir);

  return {
    dir: opts.outDir,
    indexPath: `${opts.outDir}/index.html`,
    assetsCopied: bundle.assetsCopied,
    ctaInjected: injected.mode,
    usedFallback,
    warnings: [...warnings, ...bundle.warnings],
  };
}
```

- [ ] **Step 4: Run to verify pass + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/launchpage/build.test.ts`
Expected: PASS (3).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/launchpage/build.ts src/launchpage/build.test.ts
git commit -m "feat(launchpage): buildLandingPage orchestrator (code->inject->bundle, fail-clean fallback)"
```

---

## Task 6: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new launchpage tests).

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: clean (no temp dirs / artifacts committed).

- [ ] **Step 3: Review diff vs spec**

Run: `git log --oneline creative-pdp ^main`
Confirm tasks 1-5 each produced a commit and spec sections (types, cta, code, bundle, build) are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead. Note: no CLI verb in this spec — the launchpages orchestrator (next spec) will expose it.**
```
