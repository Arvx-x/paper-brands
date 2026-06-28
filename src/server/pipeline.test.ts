import { test, expect } from "bun:test";
import { runFoundryPipeline } from "./pipeline.ts";

// Fake corpus returned by the harvest stub
const fakeCorpus: any = {
  citationCount: 100, sources: [], price: { bands: [], buckets: [], observations: [] },
  lenses: {}, coverage: { lensesPlanned: 8, lensesSucceeded: 8, missingLenses: [], perLens: [], providersAvailable: [], citationCountRaw: 100, distinctDomains: 6, independentDomains: 4, fetchedSources: 50, sourceClassCounts: {}, negativeEvidenceCovered: true }, currency: "INR",
};

function deps(overrides: any = {}) {
  return {
    harvest: async (o: any) => {
      o.onEvent?.({ type: "stage", stage: "harvest", status: "start" });
      o.onEvent?.({ type: "harvest-lens-done", lensId: "test", findings: 3, citations: 50 });
      return fakeCorpus;
    },
    buildCategoryPack: async (_brief: any, _llm: any, onEvent: any) => {
      onEvent?.({ type: "intel-done", confidence: "medium", grounded: true, attribution: 40, segments: 4, competitors: 5, degraded: false });
      return { id: "lipcare-india", name: "Lipcare", geography: "India", currency: "INR", unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [], priceBands: [], competitorArchetypes: [], benchmarkBrands: [], complianceNotes: [], buyerSegments: [], groundedGrievances: [], personaGroundingKnownUnknowns: [], benchmarksDegraded: false, benchmarkKnownUnknowns: [] };
    },
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
  expect(types).toContain("harvest-lens-done");
  expect(types).toContain("intel-done");
  expect(types).toContain("page-ready");
  expect(types[types.length - 1]).toBe("run-complete");
  const complete = events.find((e) => e.type === "run-complete");
  expect(complete.pageUrls[0].url).toContain("index.html");
});

test("a thrown stage -> run-error with message", async () => {
  const events: any[] = [];
  await runFoundryPipeline("x", (e) => events.push(e), deps({ harvest: async () => { throw new Error("harvest down"); } }) as any);
  const err = events.find((e) => e.type === "run-error");
  expect(err).toBeDefined();
  expect(err.message).toContain("harvest down");
});
