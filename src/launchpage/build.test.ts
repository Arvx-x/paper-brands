import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLandingPage } from "./build.ts";

function concept() {
  return { id: "C1", name: "MyBrand", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "Hero SKU", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "Big Headline", topAdAngles: [], objections: [], launchRisks: [] } as any;
}
const assets: any = { brandKit: { palette: [], typeMoods: [], artDirection: "", voice: "", logoDirection: "" } };

test("happy path: gemini page -> CTA injected -> bundle written, no fallback", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => "<!DOCTYPE html><html><body><h1>Big Headline</h1><button>Join waitlist</button></body></html>" } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out, experimentId: "exp1" });
  expect(res.usedFallback).toBe(false);
  expect(res.ctaInjected).toBe("found-and-tagged");
  const html = await Bun.file(res.indexPath).text();
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="C1"');
  expect(html).toContain("function pbNotify");
  await rm(out, { recursive: true, force: true });
});

test("LLM throws -> falls back to renderPdpPage, still injects CTA, usedFallback true", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => { throw new Error("down"); } } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out });
  expect(res.usedFallback).toBe(true);
  const html = await Bun.file(res.indexPath).text();
  expect(html).toContain('id="notify-cta"');
  expect(html).toContain('data-concept-id="C1"');
  expect(res.warnings.some((w) => w.toLowerCase().includes("fallback"))).toBe(true);
  await rm(out, { recursive: true, force: true });
});

test("LLM returns no html -> fallback", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-"));
  const llm = { complete: async () => "sorry no" } as any;
  const res = await buildLandingPage(concept(), assets, llm, { outDir: out });
  expect(res.usedFallback).toBe(true);
  await rm(out, { recursive: true, force: true });
});
