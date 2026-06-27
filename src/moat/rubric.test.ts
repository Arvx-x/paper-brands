import { test, expect } from "bun:test";
import { scoreMoat } from "./rubric.ts";

function concept(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] };
}
const pack: any = { competitorArchetypes: [{ codeName: "ARCH-A", description: "d", pricePositioning: "pp", claims: [], strengths: ["s"], weaknesses: ["w"], evidence: [], realExamples: [] }] };

function fullAxes(c = 0.3, i = 0.5, w = 0.6, t = 0.4) {
  return [
    { name: "copyability", score: c, rationale: "rc" },
    { name: "proprietaryInsight", score: i, rationale: "ri" },
    { name: "distributionWedge", score: w, rationale: "rw" },
    { name: "brandTrustDurability", score: t, rationale: "rt" },
  ];
}

test("well-formed batch -> 4 axes per concept + correct overall, no warnings", async () => {
  const llm = { completeJson: async () => ({ scores: [
    { conceptId: "A", axes: fullAxes(0.2, 0.4, 0.6, 0.8) },
    { conceptId: "B", axes: fullAxes(0.1, 0.1, 0.1, 0.1) },
  ] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  expect(out).toHaveLength(2);
  const a = out.find((m) => m.conceptId === "A")!;
  expect(a.axes.map((x) => x.name)).toEqual(["copyability", "proprietaryInsight", "distributionWedge", "brandTrustDurability"]);
  expect(a.overall).toBeCloseTo(0.5, 6);
  expect(a.warnings).toHaveLength(0);
});

test("orientation preserved: a low copyability stays low (no sign flip)", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: fullAxes(0.1, 0.5, 0.5, 0.5) }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  expect(out[0]!.axes.find((x) => x.name === "copyability")!.score).toBeCloseTo(0.1, 6);
});

test("missing axis -> neutral 0.5 default + warning", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: [
    { name: "copyability", score: 0.2, rationale: "rc" },
    { name: "proprietaryInsight", score: 0.4, rationale: "ri" },
    // distributionWedge + brandTrustDurability missing
  ] }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  const wedge = out[0]!.axes.find((x) => x.name === "distributionWedge")!;
  expect(wedge.score).toBe(0.5);
  expect(out[0]!.warnings.length).toBeGreaterThan(0);
});

test("concept missing from output -> all-neutral + warning", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: fullAxes() }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  const b = out.find((m) => m.conceptId === "B")!;
  expect(b.axes.every((x) => x.score === 0.5)).toBe(true);
  expect(b.warnings.length).toBeGreaterThan(0);
});

test("LLM throws -> all concepts neutral, no throw", async () => {
  const llm = { completeJson: async () => { throw new Error("down"); } } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  expect(out).toHaveLength(2);
  expect(out.every((m) => m.axes.every((x) => x.score === 0.5))).toBe(true);
  expect(out.every((m) => m.warnings.length > 0)).toBe(true);
});

test("scores not an array -> all concepts neutral, no throw", async () => {
  const llm = { completeJson: async () => ({ scores: "malformed" }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  expect(out[0]!.axes.every((x) => x.score === 0.5)).toBe(true);
  expect(out[0]!.warnings.length).toBeGreaterThan(0);
});

test("out-of-range / non-numeric axis score -> clamped/defaulted", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: [
    { name: "copyability", score: 5, rationale: "rc" },
    { name: "proprietaryInsight", score: -2, rationale: "ri" },
    { name: "distributionWedge", score: "abc", rationale: "rw" },
    { name: "brandTrustDurability", score: 0.4, rationale: "rt" },
  ] }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  const ax = out[0]!.axes;
  expect(ax.find((x) => x.name === "copyability")!.score).toBe(1);
  expect(ax.find((x) => x.name === "proprietaryInsight")!.score).toBe(0);
  expect(ax.find((x) => x.name === "distributionWedge")!.score).toBe(0.5); // non-numeric -> default
});
