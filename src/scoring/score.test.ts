import { test, expect } from "bun:test";
import { score } from "./score.ts";
import type { MatchResult } from "../arena/types.ts";

const candidates = [{ id: "c1", name: "Cand" }] as any;

const mk = (over: Partial<MatchResult>): MatchResult => ({
  personaId: "p", segment: "s", pickedConceptId: "c1", pickedLabel: "OPTION-A",
  willingnessToPayMinor: 1000, reason: "r", topObjection: "o", ...over,
});

test("abstained and errored personas are not counted as competitor wins", () => {
  const results = [mk({}), mk({ abstained: true, pickedConceptId: "" }), mk({ errored: true, pickedConceptId: "" })];
  const report = score(results, candidates);
  expect(report.abstentionRate).toBeCloseTo(1 / 3, 5);
  expect(report.errorRate).toBeCloseTo(1 / 3, 5);
  // win-rate is over DECIDING personas (1 decided, 1 picked candidate => 100%).
  const cand = report.concepts.find((c) => c.conceptId === "c1")!;
  expect(cand.winRate).toBeCloseTo(1, 5);
});

test("every concept score carries a Wilson interval", () => {
  const results = [mk({}), mk({ pickedConceptId: "competitor:ALPHA" })];
  const report = score(results, candidates);
  const cand = report.concepts.find((c) => c.conceptId === "c1")!;
  expect(cand.winRateCiLow).toBeGreaterThanOrEqual(0);
  expect(cand.winRateCiHigh).toBeLessThanOrEqual(1);
  expect(cand.winRateCiHigh).toBeGreaterThan(cand.winRateCiLow);
});

test("high abstention sets degraded=true", () => {
  const results = [mk({ abstained: true, pickedConceptId: "" }), mk({ abstained: true, pickedConceptId: "" }), mk({})];
  const report = score(results, candidates);
  expect(report.degraded).toBe(true);
});
