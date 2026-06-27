import { test, expect } from "bun:test";
import { SingleShotArena } from "./singleShot.ts";

test("SingleShotArena advertises its kind and cost on the contract", () => {
  const a = new SingleShotArena({ currency: "INR", competitorArchetypes: [], priceBands: [] } as any);
  expect(a.kind).toBe("single-shot");
  expect(a.costClass).toBe("cheap");
  expect(typeof a.run).toBe("function");
});
