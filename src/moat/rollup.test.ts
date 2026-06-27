import { test, expect } from "bun:test";
import { rollUp } from "./rollup.ts";
import type { MoatAxis } from "./types.ts";

function axis(name: any, score: number): MoatAxis {
  return { name, score, rationale: "r" };
}

test("equal-weight mean of axis scores", () => {
  const axes = [axis("copyability", 0.2), axis("proprietaryInsight", 0.4), axis("distributionWedge", 0.6), axis("brandTrustDurability", 0.8)];
  expect(rollUp(axes)).toBeCloseTo(0.5, 6);
});

test("empty axes -> 0", () => {
  expect(rollUp([])).toBe(0);
});

test("single axis -> itself", () => {
  expect(rollUp([axis("copyability", 0.37)])).toBeCloseTo(0.37, 6);
});

test("clamps result into [0,1]", () => {
  expect(rollUp([axis("copyability", 5), axis("proprietaryInsight", 5)])).toBe(1);
  expect(rollUp([axis("copyability", -5), axis("proprietaryInsight", -5)])).toBe(0);
});
