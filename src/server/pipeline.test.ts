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

test("provenance stamping does not mutate builtPack provenance (shallow-spread safety)", async () => {
  const cap: { brief?: any; returnedPack?: any } = {};
  const intel: UserIntel = {
    voices: [{ quote: "test", kind: "unmet", source: "survey", independent: true }],
    skus: [],
    competitors: [],
    overrides: { currency: "USD" },
    summary: { voices: 1, skus: 0, competitors: 0, overrides: ["currency"] },
  };
  // Capture the pack returned by buildCategoryPack (builtPack) to check it's not mutated.
  const deps = {
    ...fakeDeps(cap),
    buildCategoryPack: async (brief: any) => {
      cap.brief = brief;
      const pack = {
        id: "c", name: "C", currency: "INR", geography: "India",
        unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
        priceBands: [{ label: "core", lowMinor: 10000, highMinor: 40000 }],
        competitorArchetypes: [], complianceNotes: [],
        buyerSegments: [{ seed: "a", weight: 1, basis: "" }],
        groundedGrievances: [], benchmarkBrands: [], benchmarkKnownUnknowns: [],
        personaGroundingKnownUnknowns: [], benchmarksDegraded: true,
        provenance: { confidence: "low", userVoices: 0, userSkus: 0, overridesApplied: [] },
      };
      cap.returnedPack = pack;
      return pack as any;
    },
  };
  await runFoundryPipeline("c", () => {}, deps, 80, intel);
  // builtPack.provenance should NOT have been mutated — still 0 from construction
  expect(cap.returnedPack.provenance.userVoices).toBe(0);
});

test("harvest throwing emits run-error event", async () => {
  const events: any[] = [];
  const deps = {
    harvest: async () => { throw new Error("harvest failed"); },
    buildCategoryPack: async () => { throw new Error("should not reach"); },
    runFoundry: async () => ({ finalists: [] }) as any,
    runLaunchpages: async () => ({ built: [] }) as any,
  };
  await runFoundryPipeline("c", (e) => events.push(e), deps as any, 80);
  expect(events.some((e) => e.type === "run-error" && e.message.includes("harvest failed"))).toBe(true);
  expect(events.some((e) => e.type === "run-complete")).toBe(false);
});
