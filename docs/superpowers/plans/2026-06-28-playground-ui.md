# Playground UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser playground served at `GET /` that runs a category through the foundry and renders the live SSE event stream as 3 tabs (Arena: tally+feed, Creative: brand rows, Pages: preview cards), driven by a pure unit-tested `reduce(state, event) → ViewState` shipped to the browser transpiled.

**Architecture:** New pure `src/server/viewstate.ts` (`reduce`/`initialState`, fixture-tested) + a single self-contained `public/index.html` (inline CSS/JS, native `EventSource`) + two new server GET routes (`/` serves the HTML, `/viewstate.js` serves the transpiled reducer via `Bun.build`). The HTML imports the exact tested reducer; the DOM render layer is dumb/untested.

**Tech Stack:** TypeScript, Bun (`bun test`, `Bun.build`, `Bun.serve`). Native browser `EventSource`. No new dependencies, no build pipeline.

**Spec:** `docs/superpowers/specs/2026-06-28-playground-ui-design.md`

---

## File Structure

- Create `src/server/viewstate.ts` — `ViewState` + sub-types, `initialState()`, `reduce(state, event)` (PURE).
- Create `src/server/viewstate.test.ts` — pure fixture tests.
- Create `public/index.html` — the whole UI (inline CSS + module JS).
- Modify `src/server/server.ts` — add `GET /` + `GET /viewstate.js`; `uiRoot` injectable.
- Modify `src/server/server.test.ts` — handler tests for the two routes.

Verified facts:
- `PipelineEvent` union + `Stage` exported from `src/server/events.ts`. Event types: run-started, stage, brand-spawned, persona-decision, finalist-selected, image-ready, page-ready, run-complete, run-error.
- `persona-decision` fields: personaId, segment, pickedConceptId, pickedLabel, reason, topObjection, confidence?, willingnessToPayMinor, abstained?, errored?.
- `image-ready` fields: conceptId, name, kind ("logo"|"packaging"|"product"), url. `page-ready`: conceptId, name, url. `finalist-selected`: rank, conceptId, name, winRate, winRateCiLow, winRateCiHigh, moatOverall?.
- `src/server/server.ts` `makeHandler(deps)` has a traversal guard rejecting MULTI-segment paths not under `/api/` or `/out/`. `/` and `/viewstate.js` are single-segment → pass. Guard is the first block; add new routes after it.
- `Bun.build({ entrypoints: [path], target: "browser" })` returns `{ success, outputs: [{ text(): Promise<string> }] }` — VERIFIED working in-memory.
- Tests: `import { test, expect } from "bun:test";`, run `bun test`. tsconfig excludes `src/**/*.test.ts`.

---

## Task 1: `ViewState` + pure `reduce`

**Files:**
- Create: `src/server/viewstate.ts`
- Test: `src/server/viewstate.test.ts`

- [ ] **Step 1: Write failing tests `src/server/viewstate.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { initialState, reduce } from "./viewstate.ts";
import type { PipelineEvent } from "./events.ts";

let n = 0;
function ev(e: any): PipelineEvent { return { seq: n++, ts: "t", ...e }; }
function fold(events: any[]) { return events.reduce((s, e) => reduce(s, ev(e)), initialState()); }

test("run-started sets running + category, resets", () => {
  const s = fold([{ type: "run-started", category: "lipcare" }]);
  expect(s.status).toBe("running");
  expect(s.category).toBe("lipcare");
  expect(s.brands).toHaveLength(0);
});

test("persona-decision tallies by pickedLabel, counts abstain separately, feed newest-first", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "persona-decision", personaId: "p1", segment: "s", pickedConceptId: "A", pickedLabel: "OPTION-A", reason: "r", topObjection: "o", willingnessToPayMinor: 1 },
    { type: "persona-decision", personaId: "p2", segment: "s", pickedConceptId: "A", pickedLabel: "OPTION-A", reason: "r", topObjection: "o", willingnessToPayMinor: 1 },
    { type: "persona-decision", personaId: "p3", segment: "s", pickedConceptId: "B", pickedLabel: "OPTION-B", reason: "r", topObjection: "o", willingnessToPayMinor: 1 },
    { type: "persona-decision", personaId: "p4", segment: "s", pickedConceptId: "", pickedLabel: "", reason: "", topObjection: "", willingnessToPayMinor: 0, abstained: true },
  ]);
  expect(s.decided).toBe(3);
  expect(s.abstained).toBe(1);
  expect(s.tally[0]).toEqual({ conceptId: "OPTION-A", name: "OPTION-A", votes: 2 });
  expect(s.tally[1]!.votes).toBe(1);
  expect(s.feed[0]!.personaId).toBe("p4"); // newest first
});

test("feed is capped at 50 newest-first", () => {
  const events: any[] = [{ type: "run-started", category: "x" }];
  for (let i = 0; i < 60; i++) events.push({ type: "persona-decision", personaId: `p${i}`, segment: "s", pickedConceptId: "A", pickedLabel: "OPTION-A", reason: "r", topObjection: "o", willingnessToPayMinor: 1 });
  const s = fold(events);
  expect(s.feed).toHaveLength(50);
  expect(s.feed[0]!.personaId).toBe("p59");
});

test("image-ready groups assets per conceptId", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "image-ready", conceptId: "A", name: "Alpha", kind: "logo", url: "/out/a/logo.png" },
    { type: "image-ready", conceptId: "A", name: "Alpha", kind: "product", url: "/out/a/product.png" },
    { type: "image-ready", conceptId: "B", name: "Beta", kind: "logo", url: "/out/b/logo.png" },
  ]);
  const a = s.creative.find((c) => c.conceptId === "A")!;
  expect(a.logo).toBe("/out/a/logo.png");
  expect(a.product).toBe("/out/a/product.png");
  expect(a.packaging).toBeUndefined();
  expect(s.creative).toHaveLength(2);
});

test("page-ready joins winRate/moat from finalist", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "finalist-selected", rank: 1, conceptId: "A", name: "Alpha", winRate: 0.3, winRateCiLow: 0.2, winRateCiHigh: 0.4, moatOverall: 0.7 },
    { type: "page-ready", conceptId: "A", name: "Alpha", url: "/out/a/index.html" },
  ]);
  expect(s.pages[0]!.url).toBe("/out/a/index.html");
  expect(s.pages[0]!.winRate).toBe(0.3);
  expect(s.pages[0]!.moatOverall).toBe(0.7);
});

test("stage-done advances activeTab arena->creative->pages", () => {
  let s = fold([{ type: "run-started", category: "x" }]);
  expect(s.activeTab).toBe("arena");
  s = reduce(s, ev({ type: "stage", stage: "arena", status: "done" }));
  expect(s.activeTab).toBe("creative");
  s = reduce(s, ev({ type: "page-ready", conceptId: "A", name: "A", url: "/x" }));
  expect(s.activeTab).toBe("pages");
});

test("run-error sets error + status; run-complete sets complete + pages tab", () => {
  expect(fold([{ type: "run-error", message: "boom" }]).status).toBe("error");
  expect(fold([{ type: "run-error", message: "boom" }]).error).toBe("boom");
  const c = fold([{ type: "run-started", category: "x" }, { type: "run-complete", pageUrls: [] }]);
  expect(c.status).toBe("complete");
  expect(c.activeTab).toBe("pages");
});

test("unknown event type leaves state unchanged", () => {
  const s0 = fold([{ type: "run-started", category: "x" }]);
  const s1 = reduce(s0, ev({ type: "totally-unknown" } as any));
  expect(s1).toEqual(s0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/viewstate.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/viewstate.ts`**

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
  tally: BrandVote[];
  decided: number; abstained: number;
  feed: DecisionFeedItem[];
  creative: BrandAssets[];
  finalists: FinalistView[];
  pages: PageView[];
  error?: string;
}

const STAGES: Stage[] = ["council", "cohort", "arena", "scoring", "finalists", "creative", "pages"];

export function initialState(): ViewState {
  const stages = {} as Record<Stage, "pending" | "active" | "done">;
  for (const s of STAGES) stages[s] = "pending";
  return {
    status: "idle", activeTab: "arena", stages, brands: [], tally: [],
    decided: 0, abstained: 0, feed: [], creative: [], finalists: [], pages: [],
  };
}

const FEED_CAP = 50;

export function reduce(state: ViewState, e: PipelineEvent): ViewState {
  switch (e.type) {
    case "run-started": {
      const fresh = initialState();
      return { ...fresh, status: "running", category: e.category };
    }
    case "stage": {
      const stages = { ...state.stages, [e.stage]: e.status === "start" ? "active" : "done" } as ViewState["stages"];
      let activeTab = state.activeTab;
      if (e.status === "done" && e.stage === "arena") activeTab = "creative";
      return { ...state, stages, activeTab };
    }
    case "brand-spawned":
      return { ...state, brands: [...state.brands, { conceptId: e.conceptId, name: e.name, positioning: e.positioning }] };
    case "persona-decision": {
      const feed = [{ personaId: e.personaId, segment: e.segment, pickedLabel: e.pickedLabel,
        pickedConceptId: e.pickedConceptId, reason: e.reason, topObjection: e.topObjection,
        confidence: e.confidence, abstained: e.abstained, errored: e.errored }, ...state.feed].slice(0, FEED_CAP);
      if (e.abstained || e.errored) return { ...state, abstained: state.abstained + 1, feed };
      const tally = state.tally.map((t) => ({ ...t }));
      const hit = tally.find((t) => t.conceptId === e.pickedLabel);
      if (hit) hit.votes += 1; else tally.push({ conceptId: e.pickedLabel, name: e.pickedLabel, votes: 1 });
      tally.sort((a, b) => b.votes - a.votes);
      return { ...state, decided: state.decided + 1, tally, feed };
    }
    case "finalist-selected": {
      const finalists = [...state.finalists, { rank: e.rank, conceptId: e.conceptId, name: e.name,
        winRate: e.winRate, winRateCiLow: e.winRateCiLow, winRateCiHigh: e.winRateCiHigh, moatOverall: e.moatOverall }]
        .sort((a, b) => a.rank - b.rank);
      const creative = state.creative.find((c) => c.conceptId === e.conceptId)
        ? state.creative : [...state.creative, { conceptId: e.conceptId, name: e.name }];
      return { ...state, finalists, creative };
    }
    case "image-ready": {
      const creative = state.creative.map((c) => ({ ...c }));
      let entry = creative.find((c) => c.conceptId === e.conceptId);
      if (!entry) { entry = { conceptId: e.conceptId, name: e.name }; creative.push(entry); }
      entry[e.kind] = e.url;
      return { ...state, creative };
    }
    case "page-ready": {
      const fin = state.finalists.find((f) => f.conceptId === e.conceptId);
      const pages = [...state.pages, { conceptId: e.conceptId, name: e.name, url: e.url,
        winRate: fin?.winRate, moatOverall: fin?.moatOverall }];
      return { ...state, pages, activeTab: "pages" };
    }
    case "run-complete":
      return { ...state, status: "complete", activeTab: "pages" };
    case "run-error":
      return { ...state, status: "error", error: e.message };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/viewstate.test.ts`
Expected: PASS (8).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/server/viewstate.ts src/server/viewstate.test.ts
git commit -m "feat(ui): pure reduce(state,event) -> ViewState (tally, feed, asset grouping, joins)"
```

---

## Task 2: Server `GET /` + `GET /viewstate.js`

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/server/server.test.ts`

- [ ] **Step 1: Add failing tests (append to `src/server/server.test.ts`)**

Hoist any new imports to the top. Add a fixture `uiRoot` with a tiny index.html:
```typescript
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("GET / serves index.html from uiRoot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-"));
  await writeFile(join(dir, "index.html"), "<html><body>playground</body></html>");
  const handler = makeHandler({ uiRoot: dir } as any);
  const res = await handler(new Request("http://x/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("playground");
  await rm(dir, { recursive: true, force: true });
});

test("GET / -> 404 when index.html missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-"));
  const handler = makeHandler({ uiRoot: dir } as any);
  const res = await handler(new Request("http://x/"));
  expect(res.status).toBe(404);
  await rm(dir, { recursive: true, force: true });
});

test("GET /viewstate.js returns transpiled JS containing reduce", async () => {
  const handler = makeHandler({});
  const res = await handler(new Request("http://x/viewstate.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
  expect(await res.text()).toContain("reduce");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/server.test.ts`
Expected: FAIL (routes not implemented; `/` currently 404s with no html, `/viewstate.js` 404s).

- [ ] **Step 3: Modify `src/server/server.ts`.**

3a. Add `uiRoot?: string;` to `ServerDeps`.
3b. In `makeHandler`, add `const uiRoot = resolve(deps.uiRoot ?? "public");` near `outRoot`.
3c. AFTER the traversal-guard block (and before/after the other routes — placement among GETs is fine), add:
```typescript
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      const f = Bun.file(resolve(uiRoot, "index.html"));
      if (await f.exists()) return new Response(f, { headers: { "content-type": "text/html" } });
      return new Response("UI not built", { status: 404 });
    }

    if (req.method === "GET" && path === "/viewstate.js") {
      const built = await Bun.build({ entrypoints: [resolve("src/server/viewstate.ts")], target: "browser" });
      const js = built.success ? await built.outputs[0]?.text() : undefined;
      if (js) return new Response(js, { headers: { "content-type": "text/javascript" } });
      return new Response("// viewstate build failed", { status: 500 });
    }
```

- [ ] **Step 4: Run to verify pass + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/server.test.ts`
Expected: PASS (existing 4 + 3 new = 7).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/server/server.ts src/server/server.test.ts
git commit -m "feat(server): GET / serves playground UI; GET /viewstate.js serves transpiled reducer"
```

---

## Task 3: `public/index.html` (the UI)

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create `public/index.html`.**

This file is the whole UI: inline CSS, a top bar (category input + Run + status), 3 tabs, and a module script that imports the tested reducer from `/viewstate.js`, subscribes to `/api/events`, replays `/api/state` on load, and paints `state` (dumb render). Write EXACTLY:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paper Brands — Playground</title>
<style>
:root{--bg:#0f1117;--panel:#161b27;--line:#222a3d;--ink:#cdd3e0;--mut:#8a93a8;--accent:#5b8cff;--good:#5bd6a0;--warn:#e0a05b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.bar{display:flex;gap:10px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
.bar input{flex:1;max-width:340px;background:#0f1117;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 12px}
.bar button{background:var(--accent);border:0;color:#fff;border-radius:8px;padding:9px 18px;cursor:pointer;font-weight:600}
.pill{margin-left:auto;font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:20px;padding:4px 12px}
.tabs{display:flex;gap:8px;padding:12px 20px}
.tab{background:var(--panel);color:var(--mut);border:1px solid var(--line);border-radius:20px;padding:6px 16px;cursor:pointer;font-size:13px}
.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
main{padding:0 20px 40px}
.arena{display:grid;grid-template-columns:1fr 1.1fr;gap:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.tlabel{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin-bottom:10px}
.barrow{margin-bottom:9px}.barrow .h{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
.track{background:#1b2030;border-radius:5px;height:14px;overflow:hidden}.fill{background:var(--accent);height:14px;border-radius:5px;transition:width .3s}
.fitem{background:#11151f;border-left:3px solid var(--good);border-radius:6px;padding:7px 9px;margin-bottom:6px;font-size:12px}
.fitem.ab{border-left-color:#6b7280}.fitem .r{color:var(--mut)}
.brow{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.brow .name{width:150px;font-weight:600}.thumb{width:54px;height:54px;border-radius:8px;background:#222a3d;object-fit:cover}.thumb.ph{display:flex;align-items:center;justify-content:center;font-size:9px;color:#555}
.pages{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.pcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.pcard iframe{width:100%;height:200px;border:0;background:#fff}
.pcard .b{padding:12px}.pcard .b a{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;border-radius:7px;padding:8px;margin-top:8px}
.err{background:#3a1620;border:1px solid #6b2433;color:#ffb4c0;border-radius:10px;padding:12px;margin:14px 0}
.muted{color:var(--mut)}
</style></head>
<body>
<div class="bar">
  <input id="cat" placeholder="category, e.g. lip-balm-india" value="lip-balm-india">
  <button id="run">Run</button>
  <span class="pill" id="status">idle</span>
</div>
<div class="tabs" id="tabs">
  <span class="tab" data-tab="arena">① Arena</span>
  <span class="tab" data-tab="creative">② Creative</span>
  <span class="tab" data-tab="pages">③ Pages</span>
</div>
<main id="main"></main>

<script type="module">
import { reduce, initialState } from "/viewstate.js";
let state = initialState();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render(s) {
  $("status").textContent = s.status + (s.category ? " · " + s.category : "");
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === s.activeTab);
  const m = $("main");
  if (s.error) { m.innerHTML = `<div class="err">Run error: ${esc(s.error)}</div>`; return; }
  if (s.activeTab === "arena") m.innerHTML = arenaHtml(s);
  else if (s.activeTab === "creative") m.innerHTML = creativeHtml(s);
  else m.innerHTML = pagesHtml(s);
}

function arenaHtml(s) {
  const total = s.decided + s.abstained;
  const max = Math.max(1, ...s.tally.map((t) => t.votes));
  const bars = s.tally.map((t) => `<div class="barrow"><div class="h"><span>${esc(t.name)}</span><span>${t.votes}</span></div><div class="track"><div class="fill" style="width:${(t.votes / max) * 100}%"></div></div></div>`).join("") || `<div class="muted">waiting for decisions…</div>`;
  const feed = s.feed.map((f) => f.abstained || f.errored
    ? `<div class="fitem ab"><b>${esc(f.personaId)}</b> ${esc(f.segment)} → <span class="muted">${f.errored ? "errored" : "abstained"}</span></div>`
    : `<div class="fitem"><b>${esc(f.personaId)}</b> ${esc(f.segment)} → <b style="color:var(--accent)">${esc(f.pickedLabel)}</b>${f.confidence != null ? " · conv " + f.confidence.toFixed(2) : ""}<br><span class="r">"${esc(f.reason)}"${f.topObjection ? " · obj: " + esc(f.topObjection) : ""}</span></div>`).join("");
  return `<div class="arena">
    <div class="panel"><div class="tlabel">Vote tally (blind)</div>${bars}<div class="muted" style="margin-top:10px">${s.decided}/${total || "?"} decided · ${s.abstained} abstained</div></div>
    <div class="panel"><div class="tlabel">Live decisions</div>${feed || '<div class="muted">…</div>'}</div>
  </div>`;
}

function creativeHtml(s) {
  if (!s.creative.length) return `<div class="panel muted">Creative will appear once finalists are picked…</div>`;
  return `<div class="panel">${s.creative.map((b) => {
    const moat = s.finalists.find((f) => f.conceptId === b.conceptId)?.moatOverall;
    const cell = (label, url) => url ? `<img class="thumb" src="${esc(url)}" onerror="this.style.opacity=.2">` : `<div class="thumb ph">${label}</div>`;
    return `<div class="brow"><div class="name">${esc(b.name)}${moat != null ? `<div class="muted" style="font-size:11px">moat ${moat.toFixed(2)}</div>` : ""}</div>${cell("logo", b.logo)}${cell("pack", b.packaging)}${cell("product", b.product)}</div>`;
  }).join("")}</div>`;
}

function pagesHtml(s) {
  if (!s.pages.length) return `<div class="panel muted">Landing pages will appear here when ready…</div>`;
  return `<div class="pages">${s.pages.map((p) => `<div class="pcard"><iframe src="${esc(p.url)}" loading="lazy"></iframe><div class="b"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${p.winRate != null ? "win " + (p.winRate * 100).toFixed(0) + "%" : ""}${p.moatOverall != null ? " · moat " + p.moatOverall.toFixed(2) : ""}</div><a href="${esc(p.url)}" target="_blank">Open page ↗</a></div></div>`).join("")}</div>`;
}

for (const t of document.querySelectorAll(".tab")) t.onclick = () => { state = { ...state, activeTab: t.dataset.tab }; render(state); };

$("run").onclick = async () => {
  const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: $("cat").value }) });
  if (r.status === 409) { $("status").textContent = "a run is already active"; }
};

// Replay any in-progress/finished run, then go live.
(async () => {
  try { const snap = await (await fetch("/api/state")).json(); for (const e of snap.events ?? []) state = reduce(state, e); render(state); } catch { render(state); }
  const es = new EventSource("/api/events");
  es.onmessage = (m) => { try { state = reduce(state, JSON.parse(m.data)); render(state); } catch {} };
})();

render(state);
</script>
</body></html>
```

- [ ] **Step 2: Manual sanity (no test — this file is the dumb render layer).**

Verify the file is valid HTML and references `/viewstate.js` + `/api/events` + `/api/run` + `/api/state`:
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
grep -c "viewstate.js\|/api/events\|/api/run\|/api/state" public/index.html
```
Expected: ≥ 4 matches.

- [ ] **Step 3: Commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
git add public/index.html
git commit -m "feat(ui): self-contained playground index.html (tabs, tally+feed, brand rows, page cards)"
```

---

## Task 4: Final verification + manual smoke

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + viewstate + server route tests).

- [ ] **Step 2: Server-up smoke (no real LLM run; just routes).**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
(bun run serve --port=4321 &) ; sleep 1
echo "--- GET / ---"; curl -s http://localhost:4321/ | grep -o "<title>.*</title>"
echo "--- GET /viewstate.js ---"; curl -s http://localhost:4321/viewstate.js | grep -c "reduce"
echo "--- GET /api/state ---"; curl -s http://localhost:4321/api/state | head -c 80; echo
pkill -f "src/cli.ts serve" || true
```
Expected: a `<title>` line, a non-zero `reduce` count, and a JSON state snapshot.

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 4: Hand back to user for review + a real browser run.** The user should: `bun run serve`, open `http://localhost:4317`, type a category, hit Run, and watch the 3 tabs populate. Do NOT ff-merge to main or push without explicit user go-ahead.
```
