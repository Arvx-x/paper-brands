import { test, expect } from "bun:test";
import { buildCohort } from "./cohort.ts";

// Fake LLM: echoes a persona using the grounded anxiety it receives in the prompt.
const fakeLlm = {
  completeJson: async (opts: any) => {
    const content = opts.messages.map((m: any) => m.content).join(" ");
    const m = content.match(/<concern>([^<]+)<\/concern>/);
    const anxiety = m ? m[1] : "generic worry";
    return { personas: [{ id: "1", segment: "s", name: "N", age: 30, context: "c",
      budgetSensitivity: "medium", primaryNeed: "n", anxieties: [anxiety],
      decisionStyle: "d", shoppingContext: "browsing" }] };
  },
} as any;

const packBase = {
  name: "Lip Care", geography: "India",
  buyerSegments: [{ seed: "dry-lips relief seeker", weight: 1, basis: "x" }],
  groundedGrievances: [
    { segment: "dry-lips relief seeker", anxiety: "balm wore off in an hour",
      verbatimQuote: "wore off in an hour", sourceUrl: "u", sourceClass: "independent", verified: true },
  ],
} as any;

test("synthesized mode conditions personas on a real grievance + emits metrics", async () => {
  const r = await buildCohort(packBase, 1, fakeLlm);
  expect(r.personas).toHaveLength(1);
  expect(r.personas[0]!.anxieties.join(" ")).toContain("wore off");
  expect(r.groundingCoverage).toBe(1);   // was toBeGreaterThan(0)
  expect(r.cohortDiversity).toBe(1);     // was toBeGreaterThanOrEqual(0)
});

test("ungrounded pack (no grievances) falls back to invention, coverage 0", async () => {
  const ungrounded = { ...packBase, groundedGrievances: [] };
  const r = await buildCohort(ungrounded, 1, fakeLlm);
  expect(r.personas).toHaveLength(1);
  expect(r.groundingCoverage).toBe(0);
});

test("verbatim mode is a documented deferred stub", async () => {
  await expect(buildCohort(packBase, 1, fakeLlm, { groundingMode: "verbatim" })).rejects.toThrow(/not yet implemented/);
});

test("two segments — only one grounded — partial coverage, diversity reflects both", async () => {
  const pack2 = {
    name: "Lip Care", geography: "India",
    buyerSegments: [
      { seed: "dry-lips seeker", weight: 0.5, basis: "x" },
      { seed: "budget buyer", weight: 0.5, basis: "x" },
    ],
    groundedGrievances: [
      { segment: "dry-lips seeker", anxiety: "balm wore off in an hour",
        verbatimQuote: "wore off in an hour", sourceUrl: "u", sourceClass: "independent", verified: true },
    ],
  } as any;
  const r = await buildCohort(pack2, 2, fakeLlm);
  expect(r.personas.length).toBe(2);
  // one segment grounded, one not -> coverage is between 0 and 1 (exclusive)
  expect(r.groundingCoverage).toBeGreaterThan(0);
  expect(r.groundingCoverage).toBeLessThan(1);
});
