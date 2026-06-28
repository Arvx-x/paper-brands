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
  expect(s.tally[0]).toEqual({ label: "OPTION-A", votes: 2 });
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

test("stage-done advances activeTab harvest->arena->creative->pages", () => {
  let s = fold([{ type: "run-started", category: "x" }]);
  expect(s.activeTab).toBe("harvest");
  s = reduce(s, ev({ type: "stage", stage: "council", status: "start" }));
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

test("intel-userdata populates user-data fields on intel state", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "intel-done", confidence: "medium", grounded: true, attribution: 60, segments: 5, competitors: 4, degraded: false },
    { type: "intel-userdata", userVoices: 42, userSkus: 18, skuConflicts: 1, overridesApplied: ["priceBands", "currency"] },
  ]);
  expect(s.intel.confidence).toBe("medium");
  expect(s.intel.userVoices).toBe(42);
  expect(s.intel.userSkus).toBe(18);
  expect(s.intel.skuConflicts).toBe(1);
  expect(s.intel.overridesApplied).toEqual(["priceBands", "currency"]);
});

test("intel state has no user-data fields when intel-userdata never fires", () => {
  const s = fold([
    { type: "run-started", category: "x" },
    { type: "intel-done", confidence: "low", grounded: false, attribution: 0, segments: 3, competitors: 2, degraded: true },
  ]);
  expect(s.intel.userVoices).toBeUndefined();
  expect(s.intel.overridesApplied).toBeUndefined();
});
