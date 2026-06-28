// src/userdata/merge.test.ts
import { test, expect } from "bun:test";
import { voicesToSources } from "./merge.ts";
import type { UserVoice } from "./types.ts";

const voices: UserVoice[] = [
  { quote: "the balm melts in my bag every summer", kind: "rejection", source: "Q2 NPS", independent: true },
  { quote: "our internal target is repeat buyers", kind: "trigger", source: "strategy memo", independent: false },
];

test("each voice becomes one source with its quote as rawText", () => {
  const s = voicesToSources(voices);
  expect(s).toHaveLength(2);
  expect(s[0]!.rawText).toBe("the balm melts in my bag every summer");
  expect(s[0]!.sourceClass).toBe("first-party");
});

test("independence flag is honored (internal note is not independent)", () => {
  const s = voicesToSources(voices);
  expect(s[0]!.independent).toBe(true);
  expect(s[1]!.independent).toBe(false);
});

test("finalUrl is unique per voice", () => {
  const s = voicesToSources(voices);
  expect(new Set(s.map((x) => x.finalUrl)).size).toBe(2);
});

import { skusToObservations, mergeObservations } from "./merge.ts";
import type { UserSku } from "./types.ts";
import type { PriceObservation } from "../scrape/prices.ts";

const skus: UserSku[] = [
  { brand: "Acme", product: "Daily Balm", price: 199, rating: 4.2, unitsSold: 1200 },
];

test("skusToObservations maps fields drop-in", () => {
  const obs = skusToObservations(skus);
  expect(obs[0]!.brand).toBe("Acme");
  expect(obs[0]!.price).toBe(199);
  expect(obs[0]!.rating).toBe(4.2);
});

test("mergeObservations appends user obs and dedupes by brand+product (user wins)", () => {
  const harvested: PriceObservation[] = [
    { brand: "Acme", product: "Daily Balm", price: 250 },
    { brand: "Other", product: "Tint", price: 300 },
  ];
  const { merged, conflicts } = mergeObservations(harvested, skusToObservations(skus));
  expect(merged).toHaveLength(2); // Acme/Daily Balm deduped
  expect(conflicts).toBe(1);
  const acme = merged.find((o) => o.brand === "Acme")!;
  expect(acme.price).toBe(199); // user wins
});

test("mergeObservations is identity when user obs empty", () => {
  const harvested: PriceObservation[] = [{ brand: "X", product: "Y", price: 1 }];
  const { merged } = mergeObservations(harvested, []);
  expect(merged).toEqual(harvested);
});

import { applyOverrides, competitorsToHints, summarize } from "./merge.ts";
import type { CategoryPack } from "../categories/types.ts";
import type { UserCompetitor, UserOverrides } from "./types.ts";

function basePack(): CategoryPack {
  return {
    id: "cat", name: "Cat", currency: "USD", geography: "X",
    unmetNeeds: [], wellMetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
    priceBands: [{ label: "core", lowMinor: 10000, highMinor: 40000 }],
    competitorArchetypes: [], complianceNotes: [],
    buyerSegments: [{ seed: "a", weight: 0.5, basis: "" }, { seed: "b", weight: 0.5, basis: "" }],
    groundedGrievances: [], benchmarkBrands: [], benchmarkKnownUnknowns: [],
    personaGroundingKnownUnknowns: [], benchmarksDegraded: true,
  } as unknown as CategoryPack;
}

test("applyOverrides replaces priceBands/currency and re-normalizes buyerSegments", () => {
  const ov: UserOverrides = {
    priceBands: [{ label: "v", lowMinor: 0, highMinor: 15000 }],
    buyerSegments: [{ seed: "x", weight: 2 }, { seed: "y", weight: 2 }],
    currency: "INR",
  };
  const { pack, applied } = applyOverrides(basePack(), ov);
  expect(pack.currency).toBe("INR");
  expect(pack.priceBands).toHaveLength(1);
  expect(pack.buyerSegments[0]!.weight).toBe(0.5); // 2/4 normalized
  expect(applied.sort()).toEqual(["buyerSegments", "currency", "priceBands"]);
});

test("applyOverrides is identity (no applied fields) when overrides empty", () => {
  const before = basePack();
  const { pack, applied } = applyOverrides(before, {});
  expect(applied).toEqual([]);
  expect(pack.currency).toBe("USD");
  expect(pack.priceBands).toEqual(before.priceBands);
});

test("applyOverrides does not mutate the input pack", () => {
  const before = basePack();
  applyOverrides(before, { currency: "INR" });
  expect(before.currency).toBe("USD");
});

test("competitorsToHints renders names + positioning", () => {
  const comps: UserCompetitor[] = [
    { name: "BrandA", pricePositioning: "premium", claims: ["long-lasting"], strengths: ["distribution"], weaknesses: ["price"] },
  ];
  const hint = competitorsToHints(comps);
  expect(hint).toContain("BrandA");
  expect(hint).toContain("premium");
});

test("competitorsToHints returns empty string for no competitors", () => {
  expect(competitorsToHints([])).toBe("");
});

test("summarize counts each section and lists applied override fields", () => {
  const s = summarize({
    voices: [{ quote: "q", kind: "praise", source: "s", independent: true }],
    skus: [], competitors: [], overrides: { currency: "INR" },
  } as any);
  expect(s.voices).toBe(1);
  expect(s.overrides).toEqual(["currency"]);
});

test("competitorsToHints renders all fields when present", () => {
  const comps: UserCompetitor[] = [
    { name: "BrandA", pricePositioning: "premium", claims: ["long-lasting", "SPF 30"], strengths: ["distribution"], weaknesses: ["price"] },
  ];
  const hint = competitorsToHints(comps);
  expect(hint).toContain("claims: long-lasting; SPF 30");
  expect(hint).toContain("strengths: distribution");
  expect(hint).toContain("weaknesses: price");
});

test("competitorsToHints omits empty optional sections", () => {
  const comps: UserCompetitor[] = [
    { name: "BrandB", claims: [], strengths: [], weaknesses: [] },
  ];
  const hint = competitorsToHints(comps);
  expect(hint).toContain("BrandB");
  // No parenthetical section on the competitor line when all optional fields are empty
  const competitorLine = hint.split("\n").find((l) => l.includes("BrandB"))!;
  expect(competitorLine).not.toContain("(");
});
