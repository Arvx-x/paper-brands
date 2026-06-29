// src/brand/narrative.test.ts
import { test, expect } from "bun:test";
import { BrandNarrativeSchema } from "./narrative.ts";

test("BrandNarrativeSchema parses a full narrative", () => {
  const n = BrandNarrativeSchema.parse({
    brandId: "verdant", vision: "v", mission: "m", originStory: "o",
    values: [{ name: "Honest", description: "d" }], manifesto: "man",
    customerStory: "c", tagline: "t",
  });
  expect(n.values[0]!.name).toBe("Honest");
});

test("BrandNarrativeSchema defaults missing arrays/strings", () => {
  const n = BrandNarrativeSchema.parse({ brandId: "x" });
  expect(n.values).toEqual([]);
  expect(n.vision).toBe("");
});
