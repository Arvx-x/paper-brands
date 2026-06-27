import { test, expect } from "bun:test";
import { buildExperiment } from "./experiment.ts";

function concept(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] };
}

const tournament: any = {
  categoryId: "lipcare-india",
  concepts: [concept("SPF-LIPCARE-001", "SunShield Lip Balm"), concept("001", "LipCraft")],
  report: {
    concepts: [
      { conceptId: "benchmark:bm-nivea", winRate: 0.5 },
      { conceptId: "SPF-LIPCARE-001", winRate: 0.25 },
      { conceptId: "001", winRate: 0.1 },
      { conceptId: "competitor:ARCH-X", winRate: 0.05 },
    ],
    winner: { conceptId: "SPF-LIPCARE-001", name: "SunShield Lip Balm", winRate: 0.25 },
  },
};

test("builds one entry per generated concept, joined to win-rate, excludes benchmarks/competitors", () => {
  const exp = buildExperiment(tournament, "INR");
  expect(exp.category).toBe("lipcare-india");
  expect(exp.currency).toBe("INR");
  expect(exp.realMetric).toBe("notify CTR");
  expect(exp.source).toBe("smoke-test");
  expect(exp.unit).toBe("concept");
  expect(exp.concepts.map((c) => c.conceptId)).toEqual(["SPF-LIPCARE-001", "001"]);
  expect(exp.concepts[0]!.syntheticScore).toBe(0.25);
  expect(exp.concepts[1]!.syntheticScore).toBe(0.1);
});

test("slug is filesystem-safe and pagePath points under pages/", () => {
  const exp = buildExperiment(tournament, "INR");
  expect(exp.concepts[0]!.slug).toBe("spf-lipcare-001");
  expect(exp.concepts[0]!.pagePath).toBe("pages/spf-lipcare-001.html");
});

test("concept with no matching win-rate is dropped", () => {
  const t = { ...tournament, concepts: [...tournament.concepts, concept("ZZZ", "Ghost")] };
  const exp = buildExperiment(t, "INR");
  expect(exp.concepts.map((c) => c.conceptId)).not.toContain("ZZZ");
});

test("throws when no generated concept has a win-rate", () => {
  const t = { categoryId: "x", concepts: [concept("A", "A")], report: { concepts: [], winner: null } };
  expect(() => buildExperiment(t as any, "INR")).toThrow();
});

test("slug collisions are disambiguated", () => {
  const t = {
    categoryId: "x",
    concepts: [concept("A/Name", "n1"), concept("A Name", "n2")],
    report: { concepts: [{ conceptId: "A/Name", winRate: 0.3 }, { conceptId: "A Name", winRate: 0.2 }], winner: null },
  };
  const exp = buildExperiment(t as any, "INR");
  const slugs = exp.concepts.map((c) => c.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});
