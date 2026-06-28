// src/userdata/types.test.ts
import { test, expect } from "bun:test";
import { UserVoiceSchema, UserSkuSchema, UserOverridesSchema, UserCompetitorSchema } from "./types.ts";

test("UserVoiceSchema requires quote/kind/source and defaults independent=true", () => {
  const v = UserVoiceSchema.parse({ quote: "melts in my bag", kind: "rejection", source: "NPS" });
  expect(v.independent).toBe(true);
  expect(v.kind).toBe("rejection");
});

test("UserVoiceSchema rejects an unknown kind", () => {
  expect(() => UserVoiceSchema.parse({ quote: "x", kind: "bogus", source: "s" })).toThrow();
});

test("UserSkuSchema requires brand/product/price as a finite number", () => {
  const s = UserSkuSchema.parse({ brand: "A", product: "Balm", price: 199 });
  expect(s.price).toBe(199);
  expect(() => UserSkuSchema.parse({ brand: "A", product: "B", price: Number.NaN })).toThrow();
});

test("UserOverridesSchema parses optional fields", () => {
  const o = UserOverridesSchema.parse({ currency: "INR" });
  expect(o.currency).toBe("INR");
});

test("UserCompetitorSchema requires name and defaults arrays", () => {
  const c = UserCompetitorSchema.parse({ name: "RivalCo" });
  expect(c.claims).toEqual([]);
  expect(c.strengths).toEqual([]);
  expect(() => UserCompetitorSchema.parse({ pricePositioning: "premium" })).toThrow();
});
