import { test, expect } from "bun:test";
import { selectDiverse, type WedgeTag } from "./diversity.ts";

function tag(i: number, wedge: string, segment: string, tier: string): WedgeTag {
  return { territoryIndex: i, territoryName: `t${i}`, fingerprint: { wedge, segment, tier } };
}

test("all-identical pool -> selects n but distinctWedgeCount=1", () => {
  const pool = [0, 1, 2, 3].map((i) => tag(i, "clean", "sensitive-skin", "premium"));
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(4);
  expect(sel.distinctWedgeCount).toBe(1);
  expect(sel.spannedWedges).toEqual(["clean"]);
});

test("fully-distinct pool >= n -> distinctWedgeCount === n", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "price-disruption", "gen-z-value", "value"),
  ];
  const sel = selectDiverse(pool, 3, 0);
  expect(sel.distinctWedgeCount).toBe(3);
  expect(sel.selectedIndices).toHaveLength(3);
});

test("mixed pool (3 distinct + 1 dup), n=4 -> 3 distinct chosen first, count=3", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "clean", "sensitive-skin", "premium"),
  ];
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(4);
  expect(sel.distinctWedgeCount).toBe(3);
  // the three distinct tuples are all selected
  expect(new Set(sel.selectedIndices)).toEqual(new Set([0, 1, 2, 3]));
});

test("deterministic: same (pool,n,seed) -> identical selectedIndices", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "refills", "eco", "value"),
  ];
  expect(selectDiverse(pool, 2, 7).selectedIndices).toEqual(selectDiverse(pool, 2, 7).selectedIndices);
});

test("pool smaller than n -> selects all, no crash, honest count", () => {
  const pool = [tag(0, "clean", "sensitive-skin", "premium"), tag(1, "longevity", "everyday", "value")];
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(2);
  expect(sel.distinctWedgeCount).toBe(2);
});

test("novelty priority: a new-wedge candidate is chosen over a new-tier-only candidate", () => {
  // after choosing index 0 (clean/sensitive/premium), index 1 shares wedge+segment but new tier,
  // index 2 brings a brand-new wedge. The new-wedge must be picked second.
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "clean", "sensitive-skin", "value"),     // only new tier
    tag(2, "longevity", "everyday", "premium"),      // new wedge
  ];
  const sel = selectDiverse(pool, 2, 0);
  expect(sel.selectedIndices).toContain(2);
  expect(sel.selectedIndices).not.toContain(1);
});

test("empty pool -> empty selection, count 0, no crash", () => {
  const sel = selectDiverse([], 4, 0);
  expect(sel.selectedIndices).toEqual([]);
  expect(sel.distinctWedgeCount).toBe(0);
  expect(sel.spannedWedges).toEqual([]);
});

import { tagWedges } from "./diversity.ts";

type Terr = { name: string; thesis: string; primarySegment: string };
const terrs: Terr[] = [
  { name: "Clean Skin", thesis: "non-toxic for sensitive skin", primarySegment: "sensitive-skin" },
  { name: "All Day", thesis: "longevity in heat", primarySegment: "everyday" },
];

test("tagWedges maps a well-formed batch response to fingerprints", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { territoryIndex: 1, wedge: "longevity", segment: "everyday", tier: "value" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  expect(out[0]!.fingerprint).toEqual({ wedge: "clean", segment: "sensitive-skin", tier: "premium" });
  expect(out[1]!.territoryName).toBe("All Day");
});

test("tagWedges fails clean: LLM throws -> sentinel-distinct fingerprints, no throw", async () => {
  const llm = { completeJson: async () => { throw new Error("down"); } } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  // sentinels are distinct per index, never collapse into duplicates
  expect(out[0]!.fingerprint.wedge).not.toBe(out[1]!.fingerprint.wedge);
  expect(out[0]!.fingerprint.wedge).toContain("untagged");
});

test("tagWedges fills sentinel for any territory missing from the response", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "premium" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  expect(out[1]!.fingerprint.wedge).toContain("untagged");
});

test("tagWedges fails clean when tags is not an array", async () => {
  const llm = { completeJson: async () => ({ tags: {} }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  expect(out[0]!.fingerprint.wedge).toBe("untagged-0");
  expect(out[1]!.fingerprint.wedge).toBe("untagged-1");
});

test("tagWedges sentinels malformed wedge/segment that normalize empty", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "!!!", segment: "...", tier: "value" },
    { territoryIndex: 1, wedge: "longevity", segment: "everyday", tier: "value" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out[0]!.fingerprint.wedge).toBe("untagged-0");
  expect(out[1]!.fingerprint.wedge).toBe("longevity");
});

test("tagWedges coerces a tier outside the pack bands to 'unknown'", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "ultra-premium" },
    { territoryIndex: 1, wedge: "longevity", segment: "everyday", tier: "value" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out[0]!.fingerprint.tier).toBe("unknown"); // not in ["value","premium"]
  expect(out[1]!.fingerprint.tier).toBe("value");
});
