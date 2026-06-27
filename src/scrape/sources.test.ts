import { test, expect } from "bun:test";
import { mergeResearch, type ResearchResult } from "./research.ts";
import type { SearchResult } from "./search.ts";

// Verifies the Reddit path: Tavily snippet content is carried on the citation so a
// bot-walled page can still contribute its real text downstream (used as fallback rawText).
test("mergeResearch attaches Tavily snippet as citation.content for new urls", () => {
  const llm: ResearchResult = { query: "q", content: "answer", citations: [{ url: "x", title: "X" }] };
  const web: SearchResult[] = [
    { title: "Reddit thread", url: "https://reddit.com/r/x/c/1", snippet: "this niacinamide serum caused breakouts and stinging for me" },
  ];
  const out = mergeResearch("q", [llm], web);
  const reddit = out.citations.find((c) => c.url.includes("reddit"));
  expect(reddit).toBeDefined();
  expect(reddit!.content).toContain("caused breakouts and stinging");
  // pre-existing citation without a web snippet has no content
  expect(out.citations.find((c) => c.url === "x")!.content).toBeUndefined();
});

import { buildSourceRegistry } from "./sources.ts";

test("buildSourceRegistry falls back to citation.content when a page is blocked/empty", async () => {
  // URL that will fail/garbage-fetch; with Tavily snippet content it should still yield text.
  const docs = await buildSourceRegistry(
    [{ url: "https://blocked.example.invalid/x", title: "t", content: "real complaint: serum caused purging and bumps for weeks" }],
    { maxSources: 1, timeoutMs: 3000 },
  );
  expect(docs).toHaveLength(1);
  expect(docs[0]!.fetched).toBe(true);
  expect(docs[0]!.rawText).toContain("caused purging and bumps");
});

test("buildSourceRegistry does NOT fabricate when fetch fails and no snippet content", async () => {
  const docs = await buildSourceRegistry(
    [{ url: "https://blocked.example.invalid/y", title: "t" }],
    { maxSources: 1, timeoutMs: 3000 },
  );
  expect(docs[0]!.fetched).toBe(false);
  expect(docs[0]!.rawText).toBe("");
});
