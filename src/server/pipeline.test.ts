import { test, expect } from "bun:test";
import { runFoundryPipeline } from "./pipeline.ts";
import type { UserIntel } from "../userdata/types.ts";

function fakeDeps(captured: { brief?: any }) {
  return {
    harvest: async () => ({
      category: "c", geography: "India", currency: "INR", harvestedAt: "t",
      plan: {} as any, lenses: {}, sources: [], citationCount: 0,
      price: { currency: "INR", unit: "g", observations: [], dropped: 0, bands: [], buckets: [], stats: null },
      coverage: {} as any,
    }) as any,
    buildCategoryPack: async (brief: any) => { captured.brief = brief; return {
      id: "c", name: "C", currency: "INR", geography: "India",
      unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
      priceBands: [{ label: "core", lowMinor: 10000, highMinor: 40000 }],
      competitorArchetypes: [], complianceNotes: [],
      buyerSegments: [{ seed: "a", weight: 1, basis: "" }],
      groundedGrievances: [], benchmarkBrands: [], benchmarkKnownUnknowns: [],
      personaGroundingKnownUnknowns: [], benchmarksDegraded: true,
      provenance: { confidence: "low", userVoices: 0, userSkus: 0, overridesApplied: [] },
    } as any; },
    runFoundry: async () => ({ finalists: [] }) as any,
    runLaunchpages: async () => ({ built: [] }) as any,
  };
}

test("no userIntel: brief has no user sources, run-complete emitted", async () => {
  const cap: { brief?: any } = {};
  const events: any[] = [];
  await runFoundryPipeline("c", (e) => events.push(e), fakeDeps(cap), 80);
  expect((cap.brief.sources ?? []).some((s: any) => s.sourceClass === "first-party")).toBe(false);
  expect(events.some((e) => e.type === "run-complete")).toBe(true);
});

test("with userIntel: voices appear as first-party sources and SKUs are present", async () => {
  const cap: { brief?: any } = {};
  const intel: UserIntel = {
    voices: [{ quote: "melts in my bag every summer", kind: "rejection", source: "NPS", independent: true }],
    skus: [{ brand: "Acme", product: "Balm", price: 199 }],
    competitors: [], overrides: { currency: "USD" },
    summary: { voices: 1, skus: 1, competitors: 0, overrides: ["currency"] },
  };
  await runFoundryPipeline("c", () => {}, fakeDeps(cap), 80, intel);
  const srcs = cap.brief.sources ?? [];
  expect(srcs.some((s: any) => s.sourceClass === "first-party" && s.rawText.includes("melts"))).toBe(true);
  expect((cap.brief.observations ?? []).some((o: any) => o.brand === "Acme")).toBe(true);
});
