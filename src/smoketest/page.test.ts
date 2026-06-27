import { test, expect } from "bun:test";
import { renderPdpPage } from "./page.ts";

function concept(over: Partial<any> = {}) {
  return { id: "x", name: "SunShield", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "SunShield SPF 50", priceMinor: 59900, priceBand: "premium",
    tagline: "Hydration meets protection", claims: ["SPF 50", "Hydrating"], packagingDirection: "x",
    brandVoice: "x", landingHeadline: "Protect & hydrate", topAdAngles: [], objections: [],
    launchRisks: [], ...over };
}

test("renders headline, tagline, claims, price in major units, and notify CTA hook", () => {
  const html = renderPdpPage(concept(), { currency: "INR", experimentId: "exp1" });
  expect(html).toContain("Protect &amp; hydrate"); // escaped headline
  expect(html).toContain("Hydration meets protection");
  expect(html).toContain("SPF 50");
  expect(html).toContain("599"); // 59900 minor -> 599
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="x"');
  expect(html).toContain("PB_TRACK");
});

test("HTML-escapes injection characters in concept text", () => {
  const html = renderPdpPage(concept({ name: '<script>"&', landingHeadline: "a<b>&c" }));
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("a&lt;b&gt;&amp;c");
});

test("empty claims -> no claim list, no empty bullets", () => {
  const html = renderPdpPage(concept({ claims: [] }));
  expect(html).not.toContain("<li></li>");
  expect(html).not.toContain("<ul");
});

test("deterministic for same input (no body timestamp)", () => {
  const a = renderPdpPage(concept(), { currency: "INR" });
  const b = renderPdpPage(concept(), { currency: "INR" });
  expect(a).toBe(b);
});
