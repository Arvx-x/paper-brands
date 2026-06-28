# Design: Foundry Server + Live Event Stream (playground backend)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Frontend piece #1 — the backend/event layer. The UI that consumes the stream
is a separate later spec.

---

## Context

The foundry pipeline (council → arena → finalists → creative → 3 pages) is CLI/Node-side; a browser
can't run it or call the LLM. To build a playground UI where you watch the buyer agents decide live,
then watch the creative get made, then get the 3 page links, we first need a **local server that
runs the pipeline and streams typed events to the browser**.

This spec is that backend: a Bun HTTP server with Server-Sent Events (SSE), a typed `PipelineEvent`
contract, and additive `onEvent` hooks threaded into the existing pipeline so per-persona arena
decisions + stage/asset/page events stream as they happen — **with zero behavior change when no
callback is supplied** (the CLI path stays identical; all existing tests pass).

### Decisions (locked during brainstorming)

- **Local Bun server + SSE**, single active run at a time.
- **Run** = one full pipeline execution for one category prompt (council → arena → top-3 → creative
  → 3 landing pages).
- **Optional `onEvent` callback** threaded through `runFoundry`/`runTournament`/arena (absent →
  no-op → unchanged).
- **Typed `PipelineEvent` set:** run-started, stage, brand-spawned, persona-decision,
  finalist-selected, image-ready, page-ready, run-complete, run-error.
- **UI is out of scope** here — this is the server + event contract only.

---

## 1. Architecture

```
Browser ──POST /api/run {category}──▶ Bun server (single active run)
   │◀──── GET /api/events (SSE) ─────┤  RunBroadcaster fans out PipelineEvents
   │                                  │  runFoundryPipeline(category, broadcaster.emit)
   │                                  │    ├─ runFoundry({..., onEvent})   [stage, brand-spawned,
   │                                  │    │     └─ arena.run({onEvent})    persona-decision, finalist-selected]
   │                                  │    └─ runLaunchpages({..., onEvent}) [image-ready, page-ready]
   │◀── GET /out/* (images, bundles) ─┤  static serving
```

**New module:**
```text
src/server/
  events.ts     PipelineEvent union (typed contract) + RunBroadcaster (pure fan-out)
  pipeline.ts   runFoundryPipeline(category, onEvent, deps?) — end-to-end orchestrator
  server.ts     Bun.serve — POST /api/run, GET /api/events (SSE), GET /api/state, GET /out/*
  *.test.ts
```

**Pipeline instrumentation (additive, optional `onEvent`):**
- `src/arena/types.ts` `ArenaInput.opts` += `onEvent?`; `deep.ts` emits a `persona-decision` per
  persona as it resolves (the data already exists in the `MatchResult` it builds).
- `src/pipeline/tournament.ts` `TournamentOptions` += `onEvent?`; emits `stage` + `brand-spawned`.
- `src/pipeline/foundry.ts` threads `onEvent`; emits `finalist-selected`.
- `src/launchpages/run.ts` threads `onEvent`; emits `image-ready`, `page-ready`.

**Guarantees:** `onEvent` optional everywhere → absent behaves exactly as today → all existing tests
pass. Server is thin (HTTP + SSE + single-run lock + static); all pipeline logic reused via the
callback. `PipelineEvent` types + `RunBroadcaster` fan-out are pure (fixture-tested, no real HTTP).

**Out of scope (next spec):** the frontend UI (HTML/JS consuming the SSE stream, rendering the 3
stages).

---

## 2. The PipelineEvent contract

```typescript
interface BaseEvent { seq: number; ts: string; }   // monotonic seq for ordering/late-join; ts for display

export type Stage =
  | "council" | "cohort" | "arena" | "scoring" | "finalists" | "creative" | "pages";

export type PipelineEvent =
  | (BaseEvent & { type: "run-started"; category: string })
  | (BaseEvent & { type: "stage"; stage: Stage; status: "start" | "done"; note?: string })
  | (BaseEvent & { type: "brand-spawned"; conceptId: string; name: string; positioning: string })
  | (BaseEvent & { type: "persona-decision";
      personaId: string; segment: string;
      pickedConceptId: string; pickedLabel: string;   // blind label the agent actually saw, e.g. OPTION-C
      reason: string; topObjection: string;
      confidence?: number; willingnessToPayMinor: number; abstained?: boolean; errored?: boolean })
  | (BaseEvent & { type: "finalist-selected";
      rank: number; conceptId: string; name: string;
      winRate: number; winRateCiLow: number; winRateCiHigh: number; moatOverall?: number })
  | (BaseEvent & { type: "image-ready";
      conceptId: string; name: string; kind: "logo" | "packaging" | "product"; url: string })
  | (BaseEvent & { type: "page-ready"; conceptId: string; name: string; url: string })
  | (BaseEvent & { type: "run-complete"; pageUrls: { name: string; url: string }[] })
  | (BaseEvent & { type: "run-error"; stage?: Stage; message: string });
```

**Notes:**
- `persona-decision` is the playground star: carries exactly what the arena's `MatchResult` already
  produces, emitted as each persona resolves (not batched). Both `pickedLabel` (the blind OPTION-x
  the agent saw) AND `pickedConceptId` are sent — the UI may map id→name, but the event preserves
  what the persona actually saw (honesty: the agent never saw the brand name).
- `image-ready` / `page-ready` carry **server-relative URLs** (e.g. `/out/launchpages/<slug>/assets/
  hero.png`, `/out/launchpages/<slug>/index.html`) the UI loads via the server's static serving.
- `run-error` is fail-loud: which stage broke + message.

**`RunBroadcaster` (pure):**
- State: `subscribers: Set<Writer>`, `buffer: PipelineEvent[]` (ring, cap ~500), `seq`,
  `status: "idle"|"running"|"complete"|"error"`, `category?`.
- `emit(partial): PipelineEvent` — assign `seq++`, stamp `ts`, push to buffer (evict oldest past
  cap), write SSE frame `id: <seq>\ndata: <json>\n\n` to each subscriber; returns full event. Each
  per-subscriber write wrapped in try/catch so one bad writer never breaks others or the pipeline.
- `subscribe(w)` → replay buffered events to the new subscriber (late-join), then add. `unsubscribe`.
- `snapshot()` → `{ status, category, lastSeq, events: buffer }` for `GET /api/state`.
- `Writer` = `{ write(s: string): void; close?(): void }` — tests inject a fake; real impl wraps the
  SSE stream controller.

**Non-goals (YAGNI):** no per-LLM-call trace events, no runId (single run), no auth, no persistence
beyond the in-memory ring buffer.

---

## 3. Server endpoints, instrumentation, error handling, tests

### 3a. `runFoundryPipeline(category, onEvent, deps?)`
```
emit run-started
runFoundry({ categoryId: category, candidates: 8, cohortSize: 80, mode:"deep", moat:true, onEvent })
   → stage(council/cohort/arena/scoring), brand-spawned, persona-decision, finalist-selected
runLaunchpages({ onEvent })  → stage(creative/pages), image-ready, page-ready
emit run-complete { pageUrls }   // or run-error { stage, message } on throw
```
Injectable `deps` (`runFoundry`, `runLaunchpages`) for tests without real LLM/renders.

### 3b. Bun server (`server.ts`)
- `POST /api/run` `{category}` → if running → **409**; else status=running, fire-and-forget
  `runFoundryPipeline(category, broadcaster.emit)` (catch → run-error + status), return `202`.
- `GET /api/events` → SSE (`text/event-stream`); subscribe writer (buffered replay then live);
  unsubscribe on close.
- `GET /api/state` → `snapshot()` JSON (late-join / reload).
- `GET /out/*` → static serve files under repo `out/` (images + page bundles) with a resolve-path
  guard (must stay inside `out/`) → 403 on traversal.
- `GET /` → placeholder/404 (UI deferred).
- CLI verb `serve`: `bun run serve [--port=4317]`.

### 3c. Instrumentation points (each wrapped `if (onEvent)`, absent → no-op)
| Where | Emits |
|---|---|
| `runTournament` after council | `stage council done` + one `brand-spawned` per concept |
| after `buildCohort` | `stage cohort done` |
| `arena.run` per persona resolved | `persona-decision` (from its existing `MatchResult`) |
| after `score` | `stage scoring done` |
| `runFoundry` after `selectFinalists` | `stage finalists done` + one `finalist-selected` per finalist |
| `runLaunchpages` per identity/product render | `image-ready` (logo/packaging/product) |
| `runLaunchpages` per page built | `page-ready` |

The arena per-persona emit is the one hot-loop change: a guarded `onEvent?.(...)` right after each
result is built inside `deep.ts`'s persona pool. Strictly additive.

**Concurrency note (honest):** the arena runs personas through a concurrency-limited parallel pool
(`pool(input.cohort, concurrency, ...)`), not a sequential loop. So `persona-decision` events arrive
**in completion order, not persona index order** — the UI should treat them as a live feed keyed by
`personaId`, ordered by `seq` (emission order), not assume cohort sequence. This is inherent to the
existing parallel arena and is not changed by instrumentation.

### 3d. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| second `/api/run` while running | 409, no second run |
| pipeline throws mid-run | `run-error` (with stage) + status→error; SSE stays open |
| SSE subscriber disconnects | unsubscribe; run continues (tolerates 0 subscribers) |
| static path traversal | resolve-guard → 403 |
| `onEvent` callback throws | server wraps emit in try/catch — a UI/broadcaster bug never crashes the pipeline |
| CLI run (no onEvent) | zero events, zero behavior change, all existing tests pass |

Doctrine: events are **observational, never load-bearing** — identical pipeline results with or
without `onEvent` (separation of observation from computation); failures emit `run-error`, never a
silent death; the broadcaster tolerates zero/many subscribers.

### 3e. Tests
- `RunBroadcaster` (pure, fake writer): monotonic seq + SSE framing; fan-out to multiple subscribers;
  late `subscribe` replays buffer; ring-buffer bound; `snapshot` shape; a throwing writer doesn't
  break others.
- `runFoundryPipeline` (faked runFoundry/runLaunchpages invoking `onEvent`): emits run-started…
  run-complete in order; a thrown stage → run-error with stage; pageUrls assembled.
- **arena instrumentation regression:** `arena.run` with an `onEvent` spy emits one `persona-decision`
  per persona with correct fields; AND results are identical with vs without `onEvent` (observability
  can't change outcomes).
- server (handler-level, no real pipeline): `POST /api/run` → 202 then 409; `GET /api/state` →
  snapshot; static path-traversal → 403.

---

## Out of scope
- The frontend UI (HTML/JS SSE client + 3-stage rendering) — next spec, built on this contract.
- Concurrent runs / runId, auth, event persistence, per-LLM-call trace.
- Deploying the server beyond localhost.
