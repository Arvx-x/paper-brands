import { test, expect } from "bun:test";
import { parseResultsCsv } from "./results.ts";
import type { SmokeExperiment } from "./types.ts";

const exp: SmokeExperiment = {
  category: "lipcare-india", currency: "INR", builtAt: "2026-06-28T00:00:00.000Z",
  realMetric: "notify CTR", source: "smoke-test", unit: "concept",
  concepts: [
    { conceptId: "SPF-LIPCARE-001", name: "SunShield", syntheticScore: 0.25, slug: "spf", pagePath: "pages/spf.html" },
    { conceptId: "001", name: "LipCraft", syntheticScore: 0.1, slug: "lipcraft", pagePath: "pages/lipcraft.html" },
  ],
};
const at = "2026-06-28T10:00:00.000Z";

test("valid rows -> CTR observations with synthetic pair, source/unit/metric set", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,200,10\n001,100,4\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(skipped).toHaveLength(0);
  expect(observations).toHaveLength(2);
  expect(observations[0]!.realOutcome).toBeCloseTo(0.05, 6);
  expect(observations[0]!.syntheticScore).toBe(0.25);
  expect(observations[0]!.source).toBe("smoke-test");
  expect(observations[0]!.unit).toBe("concept");
  expect(observations[0]!.realMetric).toBe("notify CTR");
  expect(observations[0]!.id).toBe("smoke-lipcare-india-SPF-LIPCARE-001-2026-06-28T00:00:00.000Z");
});

test("zero visitors -> skipped (no div-by-zero, no fabricated CTR)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,0,0\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("visitors");
});

test("clicks > visitors -> skipped (CTR cannot exceed 1)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,10,20\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("clicks");
});

test("negative / non-numeric -> skipped", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,-5,1\n001,abc,2\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped).toHaveLength(2);
});

test("unknown conceptId -> skipped (no synthetic pair)", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nZZZ,100,5\n";
  const { observations, skipped } = parseResultsCsv(exp, csv, at);
  expect(observations).toHaveLength(0);
  expect(skipped[0]!.reason).toContain("unknown");
});

test("malformed header -> throws", () => {
  expect(() => parseResultsCsv(exp, "foo,bar\n1,2\n", at)).toThrow();
});

test("dedupe id is stable across re-parse of same experiment", () => {
  const csv = "conceptId,pageVisitors,notifyClicks\nSPF-LIPCARE-001,200,10\n";
  const a = parseResultsCsv(exp, csv, at).observations[0]!.id;
  const b = parseResultsCsv(exp, csv, "2026-06-28T12:00:00.000Z").observations[0]!.id;
  expect(a).toBe(b); // id keyed on experiment.builtAt, not import time
});
