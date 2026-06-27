import { test, expect } from "bun:test";
import { mergeResearch, type ResearchResult } from "./research.ts";
import type { SearchResult } from "./search.ts";

const r = (content: string, urls: string[]): ResearchResult => ({
  query: "q", content, citations: urls.map((u) => ({ url: u, title: u })),
});

test("mergeResearch dedupes citations by url and concatenates content", () => {
  const out = mergeResearch("q", [r("a", ["x", "y"]), r("b", ["y", "z"])], []);
  expect(out.content).toContain("a");
  expect(out.content).toContain("b");
  expect(out.citations.map((c) => c.url).sort()).toEqual(["x", "y", "z"]);
});

test("mergeResearch folds webSearch results in as citations + content", () => {
  const web: SearchResult[] = [
    { title: "Reddit thread", url: "https://reddit.com/r/x", snippet: "this serum stings badly" },
    { title: "dup", url: "x", snippet: "" },
  ];
  const out = mergeResearch("q", [r("llm answer", ["x"])], web);
  // new url added, existing 'x' not duplicated
  expect(out.citations.map((c) => c.url).sort()).toEqual(["https://reddit.com/r/x", "x"]);
  // tavily cleaned snippet content is appended (becomes quotable)
  expect(out.content).toContain("this serum stings badly");
});

test("mergeResearch with empty web is identical to plain merge", () => {
  const out = mergeResearch("q", [r("only", ["x"])], []);
  expect(out.content).toBe("only");
  expect(out.citations.map((c) => c.url)).toEqual(["x"]);
});
