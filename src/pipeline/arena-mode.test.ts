import { test, expect } from "bun:test";
import { resolveArena, type TournamentOptions } from "./tournament.ts";

const pack: any = { id: "p", name: "P", priceBands: [], buyerSegments: [], competitorArchetypes: [] };

function opts(over: Partial<TournamentOptions> = {}): TournamentOptions {
  return { categoryId: "c", candidates: 4, cohortSize: 40, ...over };
}

test("mode=cheap -> SingleShotArena (single-shot, cheap)", () => {
  const { arena, arenaMode } = resolveArena(pack, opts({ mode: "cheap" }));
  expect(arena.kind).toBe("single-shot");
  expect(arena.costClass).toBe("cheap");
  expect(arenaMode).toEqual({ mode: "cheap", kind: "single-shot", costClass: "cheap" });
});

test("mode=deep -> DeepNegotiationArena (deep-negotiation, expensive)", () => {
  const { arena, arenaMode } = resolveArena(pack, opts({ mode: "deep" }));
  expect(arena.kind).toBe("deep-negotiation");
  expect(arena.costClass).toBe("expensive");
  expect(arenaMode).toEqual({ mode: "deep", kind: "deep-negotiation", costClass: "expensive" });
});

test("deep:true with mode unset -> deep", () => {
  const { arenaMode } = resolveArena(pack, opts({ deep: true }));
  expect(arenaMode.mode).toBe("deep");
});

test("neither set -> default deep", () => {
  const { arenaMode } = resolveArena(pack, opts());
  expect(arenaMode.mode).toBe("deep");
});

test("mode wins over deep when both set", () => {
  const { arenaMode } = resolveArena(pack, opts({ mode: "cheap", deep: true }));
  expect(arenaMode.mode).toBe("cheap");
});
