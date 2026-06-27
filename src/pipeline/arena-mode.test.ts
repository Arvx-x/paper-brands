import { test, expect } from "bun:test";
import { resolveArena, formatReport, type TournamentOptions, type TournamentOutput } from "./tournament.ts";

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

function baseOut(arenaMode?: TournamentOutput["arenaMode"]): TournamentOutput {
  return {
    categoryId: "lipcare-india",
    concepts: [],
    report: { totalTrials: 40, concepts: [], candidateShareVsField: 0.5, abstentionRate: 0, errorRate: 0, degraded: false, winner: null } as any,
    arenaMode,
  };
}

test("formatReport renders the arena-mode line for deep", () => {
  const txt = formatReport(baseOut({ mode: "deep", kind: "deep-negotiation", costClass: "expensive" }));
  expect(txt).toContain("Arena mode: deep (deep-negotiation, expensive)");
});

test("formatReport renders the arena-mode line for cheap", () => {
  const txt = formatReport(baseOut({ mode: "cheap", kind: "single-shot", costClass: "cheap" }));
  expect(txt).toContain("Arena mode: cheap (single-shot, cheap)");
});

test("formatReport omits the arena-mode line when absent (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Arena mode:");
});
