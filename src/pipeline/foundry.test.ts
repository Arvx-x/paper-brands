import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFinalists, runFoundry } from "./foundry.ts";

function bc(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 9900, priceBand: "value", tagline: "tg",
    claims: [], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] };
}
function cs(conceptId: string, name: string, winRate: number) {
  return { conceptId, name, picks: 1, trials: 10, winRate, winRateCiLow: Math.max(0, winRate - 0.1),
    winRateCiHigh: winRate + 0.1, avgWtpMinor: 12000, topObjections: [] };
}
function tournament(over: any = {}) {
  return {
    categoryId: "lipcare-india",
    concepts: [bc("A", "Alpha"), bc("B", "Beta"), bc("C", "Gamma"), bc("D", "Delta")],
    report: {
      totalTrials: 40, concepts: [
        cs("A", "Alpha", 0.30), cs("B", "Beta", 0.20), cs("C", "Gamma", 0.10), cs("D", "Delta", 0.05),
        cs("benchmark:bm-x", "X", 0.50), cs("competitor:ARCH-Y", "Y", 0.40),
      ], winner: null,
    },
    moat: { scored: 2, degraded: false, concepts: [
      { conceptId: "A", name: "Alpha", overall: 0.55, warnings: [], axes: [] },
      { conceptId: "B", name: "Beta", overall: 0.40, warnings: [], axes: [] },
    ] },
    ...over,
  } as any;
}

test("ranks generated concepts by win-rate desc, takes top 3, excludes benchmark/competitor", () => {
  const a = selectFinalists(tournament(), 3);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A", "B", "C"]);
  expect(a.finalists[0]!.rank).toBe(1);
  expect(a.finalists[0]!.winRate).toBe(0.30);
  expect(a.spawned).toBe(4);
  expect(a.selected).toBe(3);
  expect(a.rankedBy).toBe("winRate");
});

test("joins moat per finalist; missing moat -> undefined + warning", () => {
  const a = selectFinalists(tournament(), 3);
  expect(a.finalists.find((f) => f.concept.id === "A")!.moat!.overall).toBe(0.55);
  expect(a.finalists.find((f) => f.concept.id === "C")!.moat).toBeUndefined();
  expect(a.warnings.some((w) => w.includes("moat") && w.includes("Gamma"))).toBe(true);
});

test("carries winRate CI + avgWtp", () => {
  const a = selectFinalists(tournament(), 3);
  const f = a.finalists[0]!;
  expect(f.winRateCiLow).toBeCloseTo(0.20, 6);
  expect(f.winRateCiHigh).toBeCloseTo(0.40, 6);
  expect(f.avgWtpMinor).toBe(12000);
});

test("fewer concepts than n -> returns all + warning, no crash", () => {
  const t = tournament({ concepts: [bc("A", "Alpha")], report: { totalTrials: 10, concepts: [cs("A", "Alpha", 0.3)], winner: null }, moat: undefined });
  const a = selectFinalists(t, 3);
  expect(a.finalists).toHaveLength(1);
  expect(a.warnings.some((w) => w.toLowerCase().includes("available") || w.toLowerCase().includes("only"))).toBe(true);
});

test("deterministic tie-break by conceptId on equal win-rates", () => {
  const t = tournament({
    concepts: [bc("B", "Beta"), bc("A", "Alpha")],
    report: { totalTrials: 20, concepts: [cs("B", "Beta", 0.2), cs("A", "Alpha", 0.2)], winner: null },
    moat: undefined,
  });
  const a = selectFinalists(t, 2);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A", "B"]); // A before B on tie
});

test("report id with no matching BrandConcept -> skipped + warning", () => {
  const t = tournament({
    concepts: [bc("A", "Alpha")],
    report: { totalTrials: 20, concepts: [cs("A", "Alpha", 0.3), cs("GHOST", "Ghost", 0.9)], winner: null },
    moat: undefined,
  });
  const a = selectFinalists(t, 3);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A"]);
  expect(a.warnings.some((w) => w.includes("GHOST"))).toBe(true);
});

test("empty concepts -> empty finalists + warning, no throw", () => {
  const t = tournament({ concepts: [], report: { totalTrials: 0, concepts: [], winner: null }, moat: undefined });
  const a = selectFinalists(t, 3);
  expect(a.finalists).toHaveLength(0);
  expect(a.warnings.length).toBeGreaterThan(0);
});

// Task 2 tests appended below (runFoundry)
test("runFoundry calls tournament with candidates=8/deep/moat/cohort=80 and writes finalists.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-"));
  let captured: any = null;
  const fakeRun = async (o: any) => { captured = o; return tournament(); };
  const artifact = await runFoundry({ categoryId: "lipcare-india", outDir: dir }, { runTournament: fakeRun as any });

  expect(captured.candidates).toBe(8);
  expect(captured.mode).toBe("deep");
  expect(captured.moat).toBe(true);
  expect(captured.cohortSize).toBe(80);
  expect(artifact.finalists.map((f) => f.concept.id)).toEqual(["A", "B", "C"]);

  const written = await Bun.file(join(dir, "finalists.json")).json();
  expect(written.selected).toBe(3);
  await rm(dir, { recursive: true, force: true });
});

test("runFoundry respects candidates/finalists/cohort overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-"));
  let captured: any = null;
  const fakeRun = async (o: any) => { captured = o; return tournament(); };
  const artifact = await runFoundry(
    { categoryId: "c", candidates: 6, finalists: 2, cohortSize: 40, outDir: dir },
    { runTournament: fakeRun as any },
  );
  expect(captured.candidates).toBe(6);
  expect(captured.cohortSize).toBe(40);
  expect(artifact.finalists).toHaveLength(2);
  await rm(dir, { recursive: true, force: true });
});
