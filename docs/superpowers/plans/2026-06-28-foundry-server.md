# Foundry Server + Live Event Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Bun + SSE server that runs the full foundry pipeline for one category and streams typed `PipelineEvent`s (stage transitions, per-persona arena decisions, finalists, images, page links) to the browser, with optional `onEvent` hooks threaded into the existing pipeline that are a no-op (zero behavior change) when absent.

**Architecture:** New `src/server/` module — a pure `RunBroadcaster` (typed events + SSE fan-out + late-join buffer) + `runFoundryPipeline` orchestrator + a thin `Bun.serve` HTTP layer. Pipeline instrumentation is additive: optional `onEvent?` on arena/tournament/foundry/launchpages options, emitted only when supplied. The CLI path and all existing tests are untouched.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`, `Bun.serve`). Reuses `runFoundry`, `runLaunchpages`, the deep arena. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-foundry-server-design.md`

---

## File Structure

- Create `src/server/events.ts` — `PipelineEvent` union, `Stage`, `Writer`, `RunBroadcaster`.
- Create `src/server/pipeline.ts` — `runFoundryPipeline(category, onEvent, deps?)`.
- Create `src/server/server.ts` — `makeServer()` returning a `fetch` handler + `startServer(port)`.
- Create `src/server/*.test.ts`.
- Modify `src/arena/types.ts` — `ArenaInput.opts.onEvent?` + an `ArenaEvent` mini-type.
- Modify `src/arena/deep.ts` — emit a persona-decision-shaped event per resolved persona (additive).
- Modify `src/pipeline/tournament.ts` — `TournamentOptions.onEvent?`; emit stage + brand-spawned.
- Modify `src/pipeline/foundry.ts` — thread `onEvent`; emit finalist-selected.
- Modify `src/launchpages/run.ts` — thread `onEvent`; emit image-ready + page-ready.
- Modify `src/cli.ts` — `serve` verb.
- Modify `package.json` — `serve` script.

Verified facts:
- `ArenaInput` = `{ candidates, cohort, pack, opts?: { includeCompetitors?, seed? } }`. `deep.ts run()` builds a `MatchResult` and pushes it at TWO sites (no-pick + picked); both inside a `pool(input.cohort, concurrency, async persona => {...})` PARALLEL pool.
- `MatchResult` = `{ personaId, segment, pickedConceptId, pickedLabel, willingnessToPayMinor, reason, topObjection, confidence?, abstained?, errored?, perOptionWtpMinor?, turnsToDecision? }`.
- `runFoundry(opts, deps?)`; `runLaunchpages(opts, deps?)`. `TournamentOptions` has categoryId/candidates/cohortSize/mode/moat/seed/etc.
- Tests: `import { test, expect } from "bun:test";`, run `bun test`. `Bun.serve({ port, fetch })`. CLI: `switch(process.argv[2])`, `arg(name,def?)`.

---

## Task 1: Event types + pure `RunBroadcaster`

**Files:**
- Create: `src/server/events.ts`
- Test: `src/server/events.test.ts`

- [ ] **Step 1: Write failing tests `src/server/events.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { RunBroadcaster, type Writer } from "./events.ts";

function fakeWriter() {
  const frames: string[] = [];
  const w: Writer = { write: (s) => frames.push(s), close: () => {} };
  return { w, frames };
}

test("emit assigns monotonic seq, ts, and SSE framing", () => {
  const b = new RunBroadcaster();
  const { w, frames } = fakeWriter();
  b.subscribe(w);
  const e1 = b.emit({ type: "run-started", category: "lipcare" });
  const e2 = b.emit({ type: "stage", stage: "council", status: "start" });
  expect(e1.seq).toBe(0);
  expect(e2.seq).toBe(1);
  expect(typeof e1.ts).toBe("string");
  expect(frames[0]).toContain("id: 0");
  expect(frames[0]).toContain('"type":"run-started"');
  expect(frames[0].endsWith("\n\n")).toBe(true);
});

test("fan-out to multiple subscribers", () => {
  const b = new RunBroadcaster();
  const a = fakeWriter(); const c = fakeWriter();
  b.subscribe(a.w); b.subscribe(c.w);
  b.emit({ type: "stage", stage: "arena", status: "start" });
  expect(a.frames).toHaveLength(1);
  expect(c.frames).toHaveLength(1);
});

test("late subscriber replays buffered events", () => {
  const b = new RunBroadcaster();
  b.emit({ type: "run-started", category: "x" });
  b.emit({ type: "stage", stage: "council", status: "done" });
  const late = fakeWriter();
  b.subscribe(late.w);
  expect(late.frames).toHaveLength(2); // both buffered events replayed
});

test("ring buffer is bounded", () => {
  const b = new RunBroadcaster(3); // cap 3
  for (let i = 0; i < 10; i++) b.emit({ type: "stage", stage: "arena", status: "start", note: `${i}` });
  const late = fakeWriter();
  b.subscribe(late.w);
  expect(late.frames).toHaveLength(3); // only last 3 retained
});

test("a throwing writer does not break others or the emit", () => {
  const b = new RunBroadcaster();
  const bad: Writer = { write: () => { throw new Error("boom"); } };
  const good = fakeWriter();
  b.subscribe(bad); b.subscribe(good.w);
  expect(() => b.emit({ type: "stage", stage: "scoring", status: "done" })).not.toThrow();
  expect(good.frames).toHaveLength(1);
});

test("snapshot returns status/category/lastSeq/events", () => {
  const b = new RunBroadcaster();
  b.setRunning("lipcare");
  b.emit({ type: "run-started", category: "lipcare" });
  const snap = b.snapshot();
  expect(snap.status).toBe("running");
  expect(snap.category).toBe("lipcare");
  expect(snap.lastSeq).toBe(0);
  expect(snap.events).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/events.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/events.ts`**

```typescript
export interface BaseEvent { seq: number; ts: string; }

export type Stage =
  | "council" | "cohort" | "arena" | "scoring" | "finalists" | "creative" | "pages";

export type PipelineEvent =
  | (BaseEvent & { type: "run-started"; category: string })
  | (BaseEvent & { type: "stage"; stage: Stage; status: "start" | "done"; note?: string })
  | (BaseEvent & { type: "brand-spawned"; conceptId: string; name: string; positioning: string })
  | (BaseEvent & { type: "persona-decision";
      personaId: string; segment: string; pickedConceptId: string; pickedLabel: string;
      reason: string; topObjection: string; confidence?: number;
      willingnessToPayMinor: number; abstained?: boolean; errored?: boolean })
  | (BaseEvent & { type: "finalist-selected";
      rank: number; conceptId: string; name: string;
      winRate: number; winRateCiLow: number; winRateCiHigh: number; moatOverall?: number })
  | (BaseEvent & { type: "image-ready"; conceptId: string; name: string; kind: "logo" | "packaging" | "product"; url: string })
  | (BaseEvent & { type: "page-ready"; conceptId: string; name: string; url: string })
  | (BaseEvent & { type: "run-complete"; pageUrls: { name: string; url: string }[] })
  | (BaseEvent & { type: "run-error"; stage?: Stage; message: string });

/** Anything an event payload can be, minus the base fields (assigned by emit). */
export type EmitInput = Omit<PipelineEvent, "seq" | "ts">;

export interface Writer { write(s: string): void; close?(): void; }

export type RunStatus = "idle" | "running" | "complete" | "error";

export class RunBroadcaster {
  private subscribers = new Set<Writer>();
  private buffer: PipelineEvent[] = [];
  private seq = 0;
  private status: RunStatus = "idle";
  private category?: string;

  constructor(private cap = 500) {}

  setRunning(category: string) { this.status = "running"; this.category = category; }
  setStatus(s: RunStatus) { this.status = s; }

  emit(input: EmitInput): PipelineEvent {
    const event = { ...input, seq: this.seq++, ts: new Date().toISOString() } as PipelineEvent;
    this.buffer.push(event);
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
    const frame = this.frame(event);
    for (const w of this.subscribers) {
      try { w.write(frame); } catch { /* one bad writer must not break others */ }
    }
    return event;
  }

  private frame(e: PipelineEvent): string {
    return `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
  }

  subscribe(w: Writer): void {
    for (const e of this.buffer) {
      try { w.write(this.frame(e)); } catch { /* ignore */ }
    }
    this.subscribers.add(w);
  }

  unsubscribe(w: Writer): void { this.subscribers.delete(w); }

  snapshot() {
    return { status: this.status, category: this.category, lastSeq: this.seq - 1, events: this.buffer };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/events.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/server/events.ts src/server/events.test.ts
git commit -m "feat(server): PipelineEvent contract + pure RunBroadcaster (SSE fan-out, replay buffer)"
```

---

## Task 2: Arena instrumentation (additive `onEvent`, results identical)

**Files:**
- Modify: `src/arena/types.ts`
- Modify: `src/arena/deep.ts`
- Test: `src/arena/deep-event.test.ts`

- [ ] **Step 1: Add the `onEvent` option type to `src/arena/types.ts`**

Add an arena-event mini type and extend `ArenaInput.opts`:
```typescript
export interface ArenaPersonaEvent {
  personaId: string; segment: string; pickedConceptId: string; pickedLabel: string;
  reason: string; topObjection: string; confidence?: number;
  willingnessToPayMinor: number; abstained?: boolean; errored?: boolean;
}
```
Change `ArenaInput`:
```typescript
export interface ArenaInput {
  candidates: BrandConcept[];
  cohort: Persona[];
  pack: CategoryPack;
  opts?: { includeCompetitors?: boolean; seed?: number; onEvent?: (e: ArenaPersonaEvent) => void };
}
```

- [ ] **Step 2: Write failing test `src/arena/deep-event.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

// Minimal pack + cohort; stub the negotiation so no LLM is needed.
const pack: any = { priceBands: [{ label: "value", lowMinor: 1000, highMinor: 5000 }], competitorArchetypes: [], benchmarkBrands: [], currency: "INR", buyerSegments: [] };
function persona(id: string) { return { id, name: id, segment: "seg", seed: id } as any; }
const candidates: any = [
  { id: "A", name: "A", positioning: "p", targetCustomer: "t", coreInsight: "c", productPromise: "pp", heroSku: "s", priceMinor: 2000, priceBand: "value", tagline: "t", claims: [], packagingDirection: "x", brandVoice: "x", landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] },
];

function arenaWithFakeNegotiation() {
  const a = new DeepNegotiationArena(pack);
  // negotiateFn: always affordable, fixed conviction → deterministic pick
  (a as any).negotiateFn = async () => ({ finalWtp: 3000, affordable: true, conviction: 0.8, turns: 1, lastObjection: "price", errored: false });
  return a;
}

test("emits one persona-decision event per persona with correct fields", async () => {
  const a = arenaWithFakeNegotiation();
  const events: any[] = [];
  await a.run({ candidates, cohort: [persona("p1"), persona("p2")], pack, opts: { seed: 0, onEvent: (e) => events.push(e) } });
  expect(events).toHaveLength(2);
  expect(events[0].personaId).toBeDefined();
  expect(events[0].pickedConceptId).toBe("A");
  expect(events[0].pickedLabel).toMatch(/OPTION-/);
});

test("results are IDENTICAL with and without onEvent (observability cannot change outcomes)", async () => {
  const cohort = [persona("p1"), persona("p2"), persona("p3")];
  const withEvt = await arenaWithFakeNegotiation().run({ candidates, cohort, pack, opts: { seed: 0, onEvent: () => {} } });
  const without = await arenaWithFakeNegotiation().run({ candidates, cohort, pack, opts: { seed: 0 } });
  expect(JSON.stringify(withEvt)).toBe(JSON.stringify(without));
});
```

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/arena/deep-event.test.ts`
Expected: FAIL (onEvent not emitted yet).

- [ ] **Step 4: Modify `src/arena/deep.ts` to emit after each result.**

In `run()`, capture the option: at the top of `run`, add `const onEvent = input.opts?.onEvent;`.

The function currently has TWO `results.push({...})` calls inside the persona pool. Refactor so each builds a local `const result: MatchResult = {...}` then `results.push(result); onEvent?.(result);`.

Specifically:
- The no-pick branch:
```typescript
      if (!best) {
        const allErrored = erroredCount === slate.length;
        const result: MatchResult = {
          personaId: persona.id, segment: persona.segment, pickedConceptId: "",
          pickedLabel: "", willingnessToPayMinor: 0, reason: "", topObjection: "",
          abstained: !allErrored, errored: allErrored, perOptionWtpMinor,
        };
        results.push(result);
        onEvent?.(result);
        return;
      }
```
- The picked branch:
```typescript
      const result: MatchResult = {
        personaId: persona.id, segment: persona.segment,
        pickedConceptId: best.entry.conceptId, pickedLabel: best.entry.card.label,
        willingnessToPayMinor: best.wtp, reason: `conviction ${best.conviction.toFixed(2)}`,
        topObjection: best.objection, confidence: best.conviction,
        perOptionWtpMinor, turnsToDecision: best.turns,
      };
      results.push(result);
      onEvent?.(result);
```
(`MatchResult` is already imported in deep.ts. `onEvent?.(result)` passes the full MatchResult; it structurally satisfies `ArenaPersonaEvent` since it has all those fields plus extras — TypeScript structural typing accepts it.)

- [ ] **Step 5: Run to verify pass + full arena suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/arena/`
Expected: PASS (the 2 new + all existing arena tests unchanged).

- [ ] **Step 6: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/arena/types.ts src/arena/deep.ts src/arena/deep-event.test.ts
git commit -m "feat(arena): additive onEvent persona-decision hook (results identical when absent)"
```

---

## Task 3: Tournament + foundry + launchpages instrumentation

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Modify: `src/pipeline/foundry.ts`
- Modify: `src/launchpages/run.ts`
- Modify: `src/server/events.ts` (export a shared `PipelineOnEvent` type)

- [ ] **Step 1: Export a shared callback type in `src/server/events.ts`**

Add:
```typescript
export type PipelineOnEvent = (e: EmitInput) => void;
```

- [ ] **Step 2: `src/pipeline/tournament.ts` — add `onEvent?` + emit stage/brand-spawned.**

Add import: `import type { PipelineOnEvent } from "../server/events.ts";`
Add `onEvent?: PipelineOnEvent;` to `TournamentOptions`.
In `runTournament`, after the council line (`const { concepts, diversity ... } = await council.generateCandidates(...)`):
```typescript
  opts.onEvent?.({ type: "stage", stage: "council", status: "done" });
  for (const c of concepts) opts.onEvent?.({ type: "brand-spawned", conceptId: c.id, name: c.name, positioning: c.positioning });
```
After `buildCohort`:
```typescript
  opts.onEvent?.({ type: "stage", stage: "cohort", status: "done", note: `${cohort.length} agents` });
```
Pass `onEvent` into the arena. NOTE the two callback types differ: the arena's `onEvent` takes an `ArenaPersonaEvent` (Task 2); the tournament's `opts.onEvent` is `PipelineOnEvent` (takes an `EmitInput`). Bridge them by re-shaping the persona event into a `persona-decision` `EmitInput`. In the `arena.run({...})` call's `opts`, add:
```typescript
        onEvent: opts.onEvent ? (e) => opts.onEvent!({ type: "persona-decision", ...e }) : undefined,
```
(`...e` spreads the `ArenaPersonaEvent` fields, which exactly match the `persona-decision` payload fields.)
Before scoring / after the report is built:
```typescript
  opts.onEvent?.({ type: "stage", stage: "scoring", status: "done" });
```

- [ ] **Step 3: `src/pipeline/foundry.ts` — thread onEvent + emit finalist-selected.**

Add `onEvent` to the `runTournament` call inside `runFoundry` (pass `opts.onEvent` through — add `onEvent?: PipelineOnEvent` to `FoundryOptions`). After `selectFinalists`:
```typescript
  opts.onEvent?.({ type: "stage", stage: "finalists", status: "done" });
  for (const f of artifact.finalists) {
    opts.onEvent?.({ type: "finalist-selected", rank: f.rank, conceptId: f.concept.id, name: f.concept.name,
      winRate: f.winRate, winRateCiLow: f.winRateCiLow, winRateCiHigh: f.winRateCiHigh, moatOverall: f.moat?.overall });
  }
```
(Import `PipelineOnEvent`.)

- [ ] **Step 4: `src/launchpages/run.ts` — thread onEvent + emit image-ready/page-ready.**

Add `onEvent?: PipelineOnEvent` to `LaunchpagesOptions`. After `generateIdentity` and `optimizeCreative` succeed for a finalist, emit (using server-relative URLs derived from the bundleDir relative to repo root — strip a leading `out/` to form `/out/...`):
```typescript
  const rel = (p: string) => "/" + p.replace(/^\.?\//, "");
  opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "logo", url: rel(id.logo.imagePath) });
  opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "packaging", url: rel(id.packaging.imagePath) });
  opts.onEvent?.({ type: "image-ready", conceptId: concept.id, name: concept.name, kind: "product", url: rel(prod.champion.imagePath) });
```
After `buildLandingPage`:
```typescript
  opts.onEvent?.({ type: "page-ready", conceptId: concept.id, name: concept.name, url: rel(res.indexPath) });
```
Also emit a `stage creative start` before the loop and `stage pages done` after (`opts.onEvent?.({ type:"stage", stage:"creative", status:"start" })` etc.).

- [ ] **Step 5: Typecheck + full suite + commit**

Run:
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
```
Expected: typecheck clean; all existing tests still pass (onEvent is optional everywhere → no test passes a callback → no behavior change).

```bash
git add src/pipeline/tournament.ts src/pipeline/foundry.ts src/launchpages/run.ts src/server/events.ts
git commit -m "feat(pipeline): additive onEvent stage/brand/finalist/image/page emission"
```

---

## Task 4: `runFoundryPipeline` orchestrator

**Files:**
- Create: `src/server/pipeline.ts`
- Test: `src/server/pipeline.test.ts`

- [ ] **Step 1: Write failing tests `src/server/pipeline.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { runFoundryPipeline } from "./pipeline.ts";

function deps(overrides: any = {}) {
  return {
    runFoundry: async (o: any) => {
      o.onEvent?.({ type: "stage", stage: "council", status: "done" });
      o.onEvent?.({ type: "finalist-selected", rank: 1, conceptId: "A", name: "Alpha", winRate: 0.3, winRateCiLow: 0.2, winRateCiHigh: 0.4 });
      return { finalists: [{ concept: { id: "A", name: "Alpha" } }] };
    },
    runLaunchpages: async (o: any) => {
      o.onEvent?.({ type: "page-ready", conceptId: "A", name: "Alpha", url: "/out/launchpages/a/index.html" });
      return { built: [{ conceptId: "A", name: "Alpha", indexPath: "out/launchpages/a/index.html" }] };
    },
    ...overrides,
  };
}

test("emits run-started ... run-complete in order; pageUrls assembled", async () => {
  const events: any[] = [];
  await runFoundryPipeline("lipcare", (e) => events.push(e), deps() as any);
  const types = events.map((e) => e.type);
  expect(types[0]).toBe("run-started");
  expect(types).toContain("page-ready");
  expect(types[types.length - 1]).toBe("run-complete");
  const complete = events.find((e) => e.type === "run-complete");
  expect(complete.pageUrls[0].url).toContain("index.html");
});

test("a thrown stage -> run-error with message", async () => {
  const events: any[] = [];
  await runFoundryPipeline("x", (e) => events.push(e), deps({ runFoundry: async () => { throw new Error("council down"); } }) as any);
  const err = events.find((e) => e.type === "run-error");
  expect(err).toBeDefined();
  expect(err.message).toContain("council down");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/pipeline.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/pipeline.ts`**

```typescript
import { runFoundry as realRunFoundry } from "../pipeline/foundry.ts";
import { runLaunchpages as realRunLaunchpages } from "../launchpages/run.ts";
import type { EmitInput } from "./events.ts";

export interface FoundryPipelineDeps {
  runFoundry?: typeof realRunFoundry;
  runLaunchpages?: typeof realRunLaunchpages;
}

export async function runFoundryPipeline(
  category: string,
  onEvent: (e: EmitInput) => void,
  deps: FoundryPipelineDeps = {},
): Promise<void> {
  const runFoundry = deps.runFoundry ?? realRunFoundry;
  const runLaunchpages = deps.runLaunchpages ?? realRunLaunchpages;

  onEvent({ type: "run-started", category });
  try {
    await runFoundry({ categoryId: category, candidates: 8, cohortSize: 80, mode: "deep", moat: true, onEvent } as any);
    const lp = await runLaunchpages({ onEvent } as any);
    const pageUrls = (lp.built ?? []).map((b: any) => ({ name: b.name, url: "/" + String(b.indexPath).replace(/^\.?\//, "") }));
    onEvent({ type: "run-complete", pageUrls });
  } catch (e) {
    onEvent({ type: "run-error", message: (e as Error).message });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/pipeline.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/server/pipeline.ts src/server/pipeline.test.ts
git commit -m "feat(server): runFoundryPipeline orchestrator (run-started..complete/error, injectable)"
```

---

## Task 5: Bun server (endpoints + static + single-run lock)

**Files:**
- Create: `src/server/server.ts`
- Test: `src/server/server.test.ts`

- [ ] **Step 1: Write failing tests `src/server/server.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { makeHandler } from "./server.ts";

function handlerWithFakeRun() {
  let started = 0;
  // a runFoundryPipeline that never resolves quickly keeps status "running"
  const fakePipeline = async (_cat: string, onEvent: any) => { onEvent({ type: "run-started", category: _cat }); await new Promise((r) => setTimeout(r, 50)); };
  return { handler: makeHandler({ runFoundryPipeline: fakePipeline as any }), started: () => started };
}

test("POST /api/run returns 202, second concurrent run returns 409", async () => {
  const { handler } = handlerWithFakeRun();
  const r1 = await handler(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ category: "lipcare" }) }));
  expect(r1.status).toBe(202);
  const r2 = await handler(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ category: "fragrance" }) }));
  expect(r2.status).toBe(409);
});

test("GET /api/state returns a snapshot", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/api/state"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json).toHaveProperty("status");
  expect(json).toHaveProperty("events");
});

test("GET /out path traversal is blocked with 403", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/out/../../etc/passwd"));
  expect(res.status).toBe(403);
});

test("unknown route -> 404", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/nope"));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/server.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/server.ts`**

```typescript
import { resolve, sep } from "node:path";
import { RunBroadcaster, type Writer } from "./events.ts";
import { runFoundryPipeline as realRunFoundryPipeline } from "./pipeline.ts";

export interface ServerDeps {
  runFoundryPipeline?: typeof realRunFoundryPipeline;
  outRoot?: string;
}

export function makeHandler(deps: ServerDeps = {}) {
  const runFoundryPipeline = deps.runFoundryPipeline ?? realRunFoundryPipeline;
  const outRoot = resolve(deps.outRoot ?? "out");
  const broadcaster = new RunBroadcaster();

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "POST" && path === "/api/run") {
      const snap = broadcaster.snapshot();
      if (snap.status === "running") return Response.json({ error: "a run is already active" }, { status: 409 });
      let category = "lipcare";
      try { category = (await req.json() as any).category ?? category; } catch { /* default */ }
      broadcaster.setRunning(category);
      // fire-and-forget
      runFoundryPipeline(category, (e) => broadcaster.emit(e))
        .then(() => broadcaster.setStatus("complete"))
        .catch((e) => { broadcaster.emit({ type: "run-error", message: (e as Error).message }); broadcaster.setStatus("error"); });
      return Response.json({ started: true }, { status: 202 });
    }

    if (req.method === "GET" && path === "/api/state") {
      return Response.json(broadcaster.snapshot());
    }

    if (req.method === "GET" && path === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const w: Writer = { write: (s) => controller.enqueue(enc.encode(s)), close: () => { try { controller.close(); } catch { /* */ } } };
          broadcaster.subscribe(w);
          req.signal.addEventListener("abort", () => broadcaster.unsubscribe(w));
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    }

    if (req.method === "GET" && path.startsWith("/out/")) {
      const target = resolve(outRoot, "." + path.slice("/out".length));
      if (target !== outRoot && !target.startsWith(outRoot + sep)) {
        return new Response("forbidden", { status: 403 });
      }
      const file = Bun.file(target);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file);
    }

    return new Response("not found", { status: 404 });
  };
}

export function startServer(port = 4317, deps: ServerDeps = {}): { port: number; stop: () => void } {
  const handler = makeHandler(deps);
  const server = Bun.serve({ port, fetch: handler });
  console.error(`[server] playground on http://localhost:${server.port}`);
  return { port: server.port, stop: () => server.stop(true) };
}
```

- [ ] **Step 4: Run to verify pass + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/server/server.test.ts`
Expected: PASS (4).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/server/server.ts src/server/server.test.ts
git commit -m "feat(server): Bun handler (POST /api/run 202/409, SSE /api/events, /api/state, static /out guard)"
```

---

## Task 6: CLI `serve` verb

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `serve` script to package.json**

```json
    "serve": "bun run src/cli.ts serve",
```

- [ ] **Step 2: Add import + case in `src/cli.ts`**

Import near other imports:
```typescript
import { startServer } from "./server/server.ts";
```
Add case (it should NOT `break` immediately — the server keeps running; just start it and leave the process alive):
```typescript
  case "serve": {
    startServer(Number(arg("port", "4317")));
    // keep process alive (Bun.serve holds it open)
    break;
  }
```

- [ ] **Step 3: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/cli.ts package.json
git commit -m "feat(cli): serve verb (starts the playground server)"
```

---

## Task 7: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new server tests). The arena results-identical test confirms instrumentation is observational-only.

- [ ] **Step 2: Manual smoke (handler-level, no real LLM)**

Run a quick check that the server starts and `/api/state` responds:
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
(bun run serve --port=4319 &) ; sleep 1
curl -s http://localhost:4319/api/state | head -c 200; echo
pkill -f "src/cli.ts serve" || true
```
Expected: a JSON snapshot like `{"status":"idle",...}`.

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead. Note: the UI that consumes this stream is the NEXT spec.**
```
