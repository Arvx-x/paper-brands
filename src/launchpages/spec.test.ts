import { test, expect } from "bun:test";
import { productSpec } from "./spec.ts";
import { deriveLiteKit } from "./kit.ts";
import { CreativeSpecSchema } from "../creative/types.ts";

function concept() {
  return { id: "C1", name: "Heritage Balm", positioning: "premium", targetCustomer: "x", coreInsight: "x",
    productPromise: "nourish", heroSku: "Heritage Balm 10g", priceMinor: 49900, priceBand: "premium",
    tagline: "t", claims: [], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] } as any;
}

test("produces a schema-valid product-hero CreativeSpec", () => {
  const spec = productSpec(deriveLiteKit(concept()));
  expect(() => CreativeSpecSchema.parse(spec)).not.toThrow();
  expect(spec.assetType).toBe("product-hero");
  expect(spec.aspect).toBe("1:1");
  expect(spec.imagePrompt.length).toBeGreaterThan(0);
  expect(spec.id).toBe("product");
});
