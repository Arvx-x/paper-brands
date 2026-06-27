import { test, expect } from "bun:test";
import { blendWeights, type SegInput } from "./distribution.ts";

test("blends supply+demand, normalizes to 1, attaches basis", () => {
  const segs: SegInput[] = [
    { seed: "a", estimateWeight: 0.5, supplyShare: 0.6, demandShare: 0.4 },
    { seed: "b", estimateWeight: 0.5, supplyShare: 0.4, demandShare: 0.6 },
  ];
  const out = blendWeights(segs, 0.5);
  const total = out.reduce((s, x) => s + x.weight, 0);
  expect(total).toBeCloseTo(1, 5);
  expect(out[0]!.basis).toContain("blend");
});

test("segment with NEITHER proxy falls back to estimate weight, basis=estimate (never zero)", () => {
  const segs: SegInput[] = [
    { seed: "a", estimateWeight: 0.7, supplyShare: 0.8, demandShare: 0.8 },
    { seed: "b", estimateWeight: 0.3, supplyShare: 0, demandShare: 0 },
  ];
  const out = blendWeights(segs, 0.5);
  const b = out.find((x) => x.seed === "b")!;
  expect(b.weight).toBeGreaterThan(0);
  expect(b.basis).toContain("estimate");
});
