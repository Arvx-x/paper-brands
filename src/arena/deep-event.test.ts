import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

const pack: any = {
  priceBands: [{ label: "value", lowMinor: 1000, highMinor: 5000 }],
  competitorArchetypes: [], benchmarkBrands: [], currency: "INR", buyerSegments: [],
};
function persona(id: string) { return { id, name: id, segment: "seg", seed: id } as any; }
const candidates: any = [
  { id: "A", name: "A", positioning: "p", targetCustomer: "t", coreInsight: "c", productPromise: "pp",
    heroSku: "s", priceMinor: 2000, priceBand: "value", tagline: "t", claims: [],
    packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] },
];

function arenaWithFakeNegotiation() {
  const a = new DeepNegotiationArena(pack);
  (a as any).negotiateFn = async () => ({
    finalWtp: 3000, affordable: true, conviction: 0.8, turns: 1, lastObjection: "price", errored: false,
  });
  return a;
}

test("emits one persona-decision event per persona with correct fields", async () => {
  const a = arenaWithFakeNegotiation();
  const events: any[] = [];
  await a.run({
    candidates, cohort: [persona("p1"), persona("p2")], pack,
    opts: { seed: 0, onEvent: (e) => events.push(e) },
  });
  expect(events).toHaveLength(2);
  expect(events[0].personaId).toBeDefined();
  expect(events[0].pickedConceptId).toBe("A");
  expect(events[0].pickedLabel).toMatch(/OPTION-/);
  expect(events[0].willingnessToPayMinor).toBe(3000);
});

test("results are IDENTICAL with and without onEvent (observability cannot change outcomes)", async () => {
  const cohort = [persona("p1"), persona("p2"), persona("p3")];
  const withEvt = await arenaWithFakeNegotiation().run({
    candidates, cohort, pack, opts: { seed: 0, onEvent: () => {} },
  });
  const without = await arenaWithFakeNegotiation().run({
    candidates, cohort, pack, opts: { seed: 0 },
  });
  expect(JSON.stringify(withEvt)).toBe(JSON.stringify(without));
});
