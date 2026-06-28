# Design: Playground UI (live foundry run in the browser)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Frontend piece #2 — the UI that consumes the SSE event stream from the foundry
server (piece #1). Completes the in-browser playground.

---

## Context

The foundry server (piece #1) runs a category through council → arena → finalists → creative → 3
pages and streams typed `PipelineEvent`s over SSE (`/api/events`), with `/api/run`, `/api/state`,
and static `/out/*`. `GET /` currently 404s. This piece fills that gap with a browser UI: type a
category, hit Run, and watch the buyer agents decide live, the creative get made, and the 3 final
landing-page links appear.

### Decisions (locked during brainstorming)

- **Tabbed layout:** Arena | Creative | Pages — one stage full-screen at a time, auto-advances with
  the run (also click-able).
- **Arena tab:** hybrid — live vote-tally bars (the race) + live decision feed (each agent's
  reasoning) side-by-side.
- **Creative tab:** one row per finalist; logo/packaging/product thumbnails fill in left-to-right.
- **Pages tab:** 3 preview cards — page thumbnail + win-rate/moat + "Open page ↗".
- **Single self-contained `index.html`** (inline CSS + vanilla JS, native `EventSource`); no
  framework, no build pipeline.
- **Pure reducer extracted + unit-tested:** `reduce(state, event) → ViewState` in
  `src/server/viewstate.ts`, shipped to the browser transpiled so the UI uses the exact tested logic.

---

## 1. Architecture

The UI is a **pure reducer** (testable) folding the SSE stream into a `ViewState`, plus a **thin DOM
renderer** (untested) that paints it. Plus one server route to serve the page.

```
GET / ──▶ server serves public/index.html
  index.html:
    EventSource("/api/events") ──each PipelineEvent──▶ reduce(state, e) → state'   [PURE, tested]
                                                              └─ render(state) → DOM  [thin, dumb]
    Run button ──POST /api/run {category}
    on load: GET /api/state → reduce over snapshot.events (replay in-progress run)
    tabs auto-advance on stage-done; also click-able
```

**New / changed files:**
```text
public/index.html             whole UI (inline CSS + JS), served at GET /
src/server/viewstate.ts       reduce(state, event) -> ViewState  (PURE, unit-tested)
src/server/viewstate.test.ts
src/server/server.ts          + GET / (serve index.html) + GET /viewstate.js (transpiled reducer)
```

**Why split the reducer out of the HTML:** event→state folding (vote tallies, abstain counting,
per-brand asset grouping, finalist↔page joining, tab advancement) is the only real logic. Extracting
it as a pure TS module lets us unit-test with fixture event sequences — no browser, no DOM. The HTML
imports the SAME logic (served transpiled), so there is one implementation, tested once.

**Out of scope:** auth, deploy, real-run polish. No new dependencies; native `EventSource`.

---

## 2. ViewState + reduce (the testable heart)

```typescript
import type { PipelineEvent, Stage } from "./events.ts";

export interface BrandVote { conceptId: string; name: string; votes: number; }
export interface DecisionFeedItem {
  personaId: string; segment: string; pickedLabel: string; pickedConceptId: string;
  reason: string; topObjection: string; confidence?: number; abstained?: boolean; errored?: boolean;
}
export interface BrandAssets { conceptId: string; name: string; logo?: string; packaging?: string; product?: string; }
export interface FinalistView {
  rank: number; conceptId: string; name: string;
  winRate: number; winRateCiLow: number; winRateCiHigh: number; moatOverall?: number;
}
export interface PageView { conceptId: string; name: string; url: string; winRate?: number; moatOverall?: number; }

export interface ViewState {
  status: "idle" | "running" | "complete" | "error";
  category?: string;
  activeTab: "arena" | "creative" | "pages";
  stages: Record<Stage, "pending" | "active" | "done">;
  brands: { conceptId: string; name: string; positioning: string }[];
  tally: BrandVote[];                 // votes per blind PICKED label, desc
  decided: number; abstained: number;
  feed: DecisionFeedItem[];           // cap ~50, newest first
  creative: BrandAssets[];            // grouped per finalist conceptId
  finalists: FinalistView[];
  pages: PageView[];
  error?: string;
}

export function initialState(): ViewState;          // all empty, activeTab "arena", stages pending
export function reduce(state: ViewState, e: PipelineEvent): ViewState;   // pure, returns NEW state
```

**Reducer rules (pure, immutable — return a new object, never mutate):**
- `run-started` → `status:"running"`, set `category`, reset everything else to `initialState()` minus
  status/category.
- `stage` → set `stages[e.stage]` to `e.status==="start"?"active":"done"`. On `stage done`, advance
  `activeTab` to a sensible default: arena-done → `creative`; any `creative`/`pages` stage or
  `page-ready` → `pages`. (User clicks override; reducer only sets defaults.)
- `brand-spawned` → append `{conceptId, name, positioning}` to `brands`.
- `persona-decision` → if `abstained||errored` → `abstained++`; else `decided++` and increment that
  **`pickedLabel`'s** vote in `tally` (keyed on the blind label the agent saw), re-sort desc. Always
  unshift to `feed`, cap at 50.
- `finalist-selected` → append to `finalists` (keep sorted by `rank`); ensure a `creative` entry for
  that `conceptId` exists (seeded with name).
- `image-ready` → set `creative[conceptId][e.kind] = e.url` (create the brand entry if missing).
- `page-ready` → append to `pages`, joining `winRate`/`moatOverall` from the matching `finalists`
  entry by `conceptId`.
- `run-complete` → `status:"complete"`, `activeTab:"pages"`.
- `run-error` → `status:"error"`, `error: e.message`.
- unknown/future `type` → return state unchanged (forward-compatible).

**Tests (pure, fixtures):**
- `run-started` resets + status running.
- N `persona-decision` → tally counts correct + sorted desc; abstained counted separately; feed
  capped 50 newest-first; tally keyed on `pickedLabel`.
- `image-ready` events group per conceptId into logo/packaging/product slots.
- `finalist-selected` + `page-ready` → page joined with finalist winRate/moat.
- stage-done advances `activeTab` (arena→creative→pages).
- `run-error` sets error + status.
- unknown event type → unchanged.
- full canned sequence (run-started…run-complete) → 3 pages, 3 finalists, populated tally.

---

## 3. index.html, the GET / server change, wiring, tests

### 3a. Server changes (`server.ts`) — the only server edits
Add two GET routes (`uiRoot` injectable, default `"public"`):
```typescript
if (req.method === "GET" && (path === "/" || path === "/index.html")) {
  const f = Bun.file(resolve(uiRoot, "index.html"));
  if (await f.exists()) return new Response(f, { headers: { "content-type": "text/html" } });
  return new Response("UI not built", { status: 404 });
}
if (req.method === "GET" && path === "/viewstate.js") {
  // Transpile the tested reducer to browser JS so the UI uses the exact same logic.
  const built = await Bun.build({ entrypoints: [resolve("src/server/viewstate.ts")], target: "browser" });
  const js = await built.outputs[0]?.text();
  if (js) return new Response(js, { headers: { "content-type": "text/javascript" } });
  return new Response("// build failed", { status: 500 });
}
```
NOTE the existing traversal guard only rejects MULTI-segment paths (`segments.length > 1`) not
starting with `/api/` or `/out/`. Both `/` and `/viewstate.js` are single-segment, so they pass the
guard unchanged — no guard edit needed. Add the two route handlers AFTER the guard block.
Fallback if `Bun.build` in-memory is fiddly: have the `serve` CLI run
`bun build src/server/viewstate.ts --outfile public/viewstate.js` on startup and serve the file
statically. Same single source of truth.

### 3b. `public/index.html` (single self-contained file)
- **Inline `<style>`:** dark theme, top bar (category `<input>` + Run button + status pill), 3 tabs
  (Arena | Creative | Pages).
- **Inline `<script type="module">`:**
  - `import { reduce, initialState } from "/viewstate.js";`
  - `let state = initialState(); const es = new EventSource("/api/events");`
    `es.onmessage = (m) => { state = reduce(state, JSON.parse(m.data)); render(state); };`
  - `runBtn.onclick` → `fetch("/api/run",{method:"POST",body:JSON.stringify({category: input.value})})`;
    on 409 → show "a run is already active".
  - on load → `fetch("/api/state")` then `for (const e of snap.events) state = reduce(state, e)` +
    render (replays an in-progress/finished run).
  - tab buttons set `state.activeTab` + render.
  - `render(state)` — dumb painting, no logic:
    - **Arena:** left = tally bars (`state.tally`, width = votes/decided) + `decided/total · abstained`;
      right = decision feed (`state.feed` newest-first, each = persona → OPTION + reason + objection,
      confidence-tinted).
    - **Creative:** one row per `state.creative` brand — name + moat (from finalists) + logo/packaging/
      product `<img src=url>` (placeholders until set).
    - **Pages:** 3 cards from `state.pages` — `<iframe>` thumbnail of `url` + name + winRate/moat +
      `<a target="_blank" href=url>Open page ↗</a>`.
    - error banner when `state.error`.

### 3c. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| `index.html` missing | `GET /` → 404 "UI not built" (server still runs) |
| EventSource drops | browser auto-reconnects; `/api/state` replay rebuilds state |
| 409 on Run | "a run is already active", no reset |
| `run-error` event | error banner from `state.error` |
| image url 404 | `<img onerror>` placeholder; never blocks |
| reduce unknown event | state unchanged (forward-compatible) |

Doctrine: the UI is a **pure projection of the event stream** — `state` derives solely from `reduce`,
so the view is always rebuildable from `/api/state` (reproducible); rendering never computes, only
paints; unknown/future events ignored, not crashed.

### 3d. Tests
- `reduce`/`initialState` pure suite (§2) — the real coverage.
- server (handler-level, fixture `uiRoot`): `GET /` serves fixture `index.html` (200, text/html);
  missing → 404; `GET /viewstate.js` returns JS containing `reduce`.
- No DOM/browser tests (render layer is intentionally dumb). A manual smoke step (start server, open
  browser, run a category, watch the 3 tabs) is the final task.

---

## Out of scope
- Auth, deploy beyond localhost, concurrent runs, run history.
- A component framework / build pipeline (single HTML file by design).
- The render layer is untested by design; all logic is in the tested `reduce`.
