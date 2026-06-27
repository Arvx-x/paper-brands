import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExperiment, readExperiment } from "./write.ts";
import type { SmokeExperiment } from "./types.ts";

function fixture(): { exp: SmokeExperiment; concepts: any[] } {
  const exp: SmokeExperiment = {
    category: "lipcare-india", currency: "INR", builtAt: "2026-06-28T00:00:00.000Z",
    realMetric: "notify CTR", source: "smoke-test", unit: "concept",
    concepts: [{ conceptId: "001", name: "LipCraft", syntheticScore: 0.1, slug: "lipcraft", pagePath: "pages/lipcraft.html" }],
  };
  const concepts = [{ id: "001", name: "LipCraft", positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 9900, priceBand: "value", tagline: "tg",
    claims: ["x"], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] }];
  return { exp, concepts };
}

test("writes manifest, csv template, and one page per concept; round-trips manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  const { exp, concepts } = fixture();
  await writeExperiment(exp, concepts as any, dir);
  const back = await readExperiment("lipcare-india", dir);
  expect(back?.concepts[0]!.conceptId).toBe("001");

  const base = join(dir, "lipcare-india", "smoketest");
  expect(await Bun.file(join(base, "experiment.json")).exists()).toBe(true);
  expect(await Bun.file(join(base, "results-template.csv")).exists()).toBe(true);
  expect(await Bun.file(join(base, "pages", "lipcraft.html")).exists()).toBe(true);

  const csv = await Bun.file(join(base, "results-template.csv")).text();
  expect(csv.split(/\r?\n/)[0]).toBe("conceptId,pageVisitors,notifyClicks");
  expect(csv).toContain("001,0,0");
  await rm(dir, { recursive: true, force: true });
});

test("readExperiment returns null when missing (no throw)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  expect(await readExperiment("nope", dir)).toBeNull();
  await rm(dir, { recursive: true, force: true });
});
