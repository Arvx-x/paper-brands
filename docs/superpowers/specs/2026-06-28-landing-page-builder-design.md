# Design: Branded Landing-Page Builder (LLM-coded + smoke-test instrumented)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Pipeline piece #2a — the landing-page builder for ONE concept. The
`launchpages` orchestrator (reads finalists.json, runs the creative suite per finalist, calls this
builder) is a separate later spec.

---

## Context

The smoke-test adapter produces bare, template HTML notify-pages. The foundry produces finalists.
To run real traffic, finalists need *real, branded* landing pages. The creative factory produces
brand assets (BrandKit palette/fonts/voice + logo/hero/packaging/ad images) but no HTML page.

This piece builds a **branded landing-page builder for one concept**: feed the concept copy + its
already-produced creative assets to gemini-3.1-flash, which codes a complete polished HTML/CSS
landing page; then a **deterministic** step injects the smoke-test notify-CTA metadata so the page
is countable; then assets are copied into a self-contained deployable bundle.

The honesty contract — the page must have a countable notify event for the smoke test to be valid —
is guaranteed by a **pure, LLM-independent** injection step, never by trusting the LLM.

### Decisions (locked during brainstorming)

- **Full creative suite per concept** (logo/packaging/hero/ads + BrandKit) feeds the page.
- **gemini-3.1-flash codes the full HTML/CSS page** (not a fixed template).
- **CTA integrity = deterministic post-process injection (option 1 only).** The LLM makes a page
  with a notify button; a pure step injects the required `id`/`data-*`/`PB_TRACK` metadata after.
- **Assets copied next to the page + relative paths** → self-contained deployable bundle.
- **This spec = builder for ONE concept**; orchestrator (`launchpages` over finalists.json) later.
- **Builder input = `CreativeAssets` struct** (BrandKit + image paths); orchestrator supplies it.

---

## 1. Architecture

```
buildLandingPage(concept, assets, llm, opts)        [orchestrator for ONE concept]
   ├─ codePage(concept, assets, llm, model)         [IMPURE: gemini-3.1-flash codes HTML/CSS]
   │      → raw HTML referencing assets/<name>.png
   ├─ injectNotifyCta(html, { conceptId, experimentId })   [PURE — honesty-critical]
   │      → find-or-insert canonical notify-CTA (id, data-concept-id, data-experiment-id) + PB_TRACK
   ├─ bundleAssets(html, assets, outDir)            [I/O: copy images in, verify paths]
   │      → self-contained folder: index.html + assets/
   └─ return LandingPageResult
```

**New module:**
```text
src/launchpage/
  types.ts     CreativeAssets, BuildLandingPageOptions, LandingPageResult
  code.ts      codePage(concept, assets, llm, model) -> Promise<string>   (impure, LLM)
  cta.ts       injectNotifyCta(html, ids) -> { html, mode }               (PURE, honesty-critical)
  bundle.ts    bundleAssets(html, assets, outDir) -> Promise<{...}>        (I/O)
  build.ts     buildLandingPage(concept, assets, llm, opts)               (orchestrator)
  *.test.ts
```

Reuses `BrandConcept`, `BrandKit` (`../creative/types.ts`), `LLMClient` (`../llm/client.ts`),
and the smoke-test `renderPdpPage` (`../smoketest/page.ts`) as the fail-clean fallback. No new
dependencies. The honesty-critical `injectNotifyCta` is **pure** (fixture-tested, no LLM); `codePage`
is the only LLM edge (fake-LLM tested); `bundleAssets` is temp-dir tested.

**Out of scope (next spec):** `launchpages` orchestrator, reading `finalists.json`, running the
creative suite per finalist.

---

## 2. Data model

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { BrandKit } from "../creative/types.ts";

export interface CreativeAssets {
  brandKit: BrandKit;          // palette (hex+role), type moods, art direction, voice, logoDirection
  logoPath?: string;           // absolute source paths (optional — may be absent/degraded)
  heroPath?: string;
  packagingPath?: string;
  adPaths?: string[];
}

export interface BuildLandingPageOptions {
  outDir: string;              // where the self-contained bundle is written
  experimentId?: string;       // stamped into the CTA for smoke-test attribution
  model?: string;              // page-coder model; default "gemini-3.1-flash"
  currency?: string;           // for the fallback renderPdpPage price; default "INR"
}

export interface LandingPageResult {
  dir: string;
  indexPath: string;           // <dir>/index.html
  assetsCopied: string[];      // relative asset paths written into the bundle
  ctaInjected: "found-and-tagged" | "inserted";
  usedFallback: boolean;       // true if LLM page-code failed and renderPdpPage was used
  warnings: string[];
}
```

**Asset reference flow:**
1. `codePage` is told the **relative** filenames to reference (`assets/logo.png`, `assets/hero.png`,
   …) — only those present — so the LLM codes against the final layout, not source paths.
2. `bundleAssets` copies each present source image to `<outDir>/assets/<canonical>.<ext>` (canonical:
   `logo`, `hero`, `packaging`, `ad-1`, `ad-2`…) and verifies the HTML's `assets/...` refs resolve;
   missing → warning (broken `<img>` tolerated, never a crash).
3. Absent assets → the LLM is told they're unavailable and codes around them; recorded in warnings.

**Non-goals (YAGNI):** multi-page sites, A/B variants, responsive QA beyond gemini's output, a live
tracking endpoint (still CSV ingestion via the existing smoke-test import).

---

## 3. codePage (LLM) + injectNotifyCta (pure) + bundleAssets (I/O) + buildLandingPage

### 3a. `codePage(concept, assets, llm, model)` — impure
One `LLMClient.complete` call (text, gemini-3.1-flash via model override) returning a full HTML doc.
- **Inputs:** concept copy (name, landingHeadline, tagline, positioning, productPromise, claims,
  heroSku, priceMinor/band, targetCustomer) + BrandKit (palette hex+role, type moods, art direction,
  voice) + the relative asset paths that exist.
- **Instruction:** code ONE self-contained `index.html` (inline `<style>`, no external deps/
  frameworks) for a real D2C product landing page — hero, value props from claims, price, clear
  primary waitlist CTA button. Use palette hex + type mood; reference images via
  `<img src="assets/...">`; mobile-responsive.
- **Output extraction:** take the ```html fenced block, else the `<!DOCTYPE...></html>` span; if
  neither → treat as failure (caller falls back).

### 3b. `injectNotifyCta(html, { conceptId, experimentId }): { html, mode }` — PURE, honesty-critical
Deterministic, no LLM/I/O. Guarantees exactly one `id="notify-cta"` with `data-cta="notify"`,
`data-concept-id`, optional `data-experiment-id`, plus the `PB_TRACK` + `pbNotify()` script.
1. **Find** a notify-ish CTA: first `<button>`/`<a>` whose inner text matches
   `/notify|waitlist|join|launch|sign ?up|early access/i`.
2. Found → **tag it** (set id + data-attrs + `onclick="pbNotify()"`); `mode="found-and-tagged"`.
3. Not found → **insert** the canonical CTA block before `</body>`; `mode="inserted"`.
4. **Always** ensure the `PB_TRACK`/`pbNotify()` `<script>` + a hidden confirmation element exist
   (append if absent).
5. HTML-escape injected attribute values. Idempotent (re-running adds nothing).
- **Accepted risk:** HTML isn't regular; string/regex heuristics could mis-find a button. Mitigation:
  **when in doubt, insert** the canonical CTA (safe default) rather than mis-tag; the test suite
  locks find/insert/idempotent behavior.

**Tests (pure, fixtures):** waitlist button → tagged + single `#notify-cta`; no CTA → canonical
inserted before `</body>`; PB_TRACK always present, not duplicated; ids escaped; exactly one
`#notify-cta`; idempotent (twice → one CTA, one script); malformed/empty html → inserts, no throw.

### 3c. `bundleAssets(html, assets, outDir): Promise<{ assetsCopied, warnings }>` — I/O
- `mkdir -p <outDir>/assets`.
- Copy each present asset → `<outDir>/assets/<canonical>.<ext>`.
- Verify HTML `assets/...` refs resolve to copied files; missing → warning (broken img tolerated).
- Write `<outDir>/index.html`.
- Return copied relative paths + warnings.

### 3d. `buildLandingPage(concept, assets, llm, opts): Promise<LandingPageResult>` — orchestrator
```
1. html = await codePage(...).catch(() => renderPdpPage(concept, { currency, experimentId }))   // fallback
   (usedFallback / warn if fallback)
2. { html, mode } = injectNotifyCta(html, { conceptId: concept.id, experimentId: opts.experimentId })
3. { assetsCopied, warnings } = await bundleAssets(html, assets, opts.outDir)
4. return { dir, indexPath, assetsCopied, ctaInjected: mode, usedFallback, warnings }
```
- The fallback `renderPdpPage` already has a CTA, but `injectNotifyCta` runs regardless (idempotent)
  so the contract is enforced uniformly on both paths.

### 3e. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| LLM page-code fails/empty/no-html | fall back to `renderPdpPage` + `usedFallback:true` + warning (always a tracked page) |
| LLM page has no notify button | `injectNotifyCta` inserts canonical block |
| referenced asset missing on disk | copy skipped + warning; broken `<img>` tolerated, page still deploys |
| no assets at all | text-only page; `assetsCopied` empty + warning |
| outDir unwritable | propagates (real I/O error, not silenced) |

Doctrine: the smoke-test honesty contract (countable notify event) is **deterministically guaranteed**
by the pure `injectNotifyCta`, never the LLM; LLM failure degrades to a working bare tracked page,
never nothing; missing assets degrade visibly (warnings + broken img), never crash.

### 3f. Tests
- `injectNotifyCta` pure suite (3b).
- `bundleAssets` (temp dir + fixture image files): copies present assets, verifies paths, missing
  asset → warning, writes index.html.
- `buildLandingPage` (fake LLM): happy path → bundle with tagged CTA, `usedFallback:false`;
  LLM-throws → falls back to `renderPdpPage`, still injects CTA, `usedFallback:true` + warning;
  result fields assembled.

---

## Out of scope
- `launchpages` orchestrator (reads finalists.json, runs creative suite per finalist, calls this
  builder for each) — next spec.
- Running/producing the creative suite (the orchestrator's job; builder consumes `CreativeAssets`).
- Live click-tracking endpoint (still CSV ingestion via existing smoke-test import).
- Multi-page sites, A/B variants, deploy automation, frontend UI.
