import { test, expect } from "bun:test";
import { extractJsonLdReviews, redditCommentText } from "./extract.ts";

test("extractJsonLdReviews pulls Review bodies from JSON-LD script blocks", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"Product","review":[
      {"@type":"Review","reviewBody":"It stung my skin and turned orange","author":"A"},
      {"@type":"Review","reviewBody":"Stopped working after a month"}
    ]}</script>
    <script type="application/ld+json">{"@type":"Review","reviewBody":"Too pricey for what it does"}</script>
  </head><body>ignored prose</body></html>`;
  const out = extractJsonLdReviews(html);
  expect(out).toContain("It stung my skin and turned orange");
  expect(out).toContain("Stopped working after a month");
  expect(out).toContain("Too pricey for what it does");
});

test("extractJsonLdReviews returns '' when no review schema present", () => {
  expect(extractJsonLdReviews("<html><body>no schema here</body></html>")).toBe("");
  expect(extractJsonLdReviews(`<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>`)).toBe("");
});

test("extractJsonLdReviews tolerates malformed JSON-LD", () => {
  expect(extractJsonLdReviews(`<script type="application/ld+json">{ broken json `)).toBe("");
});

test("redditCommentText recurses the comment tree (not just top-level)", () => {
  const listing = [
    { data: { children: [{ data: { title: "Vit C serum thread", selftext: "which one?" } }] } },
    { data: { children: [
      { data: { body: "mine oxidized in 2 weeks", replies: { data: { children: [
        { data: { body: "same, turned orange and stung" } },
      ] } } } },
      { data: { body: "too expensive for the size" } },
    ] } },
  ];
  const t = redditCommentText(listing, 5000);
  expect(t).toContain("which one?");
  expect(t).toContain("mine oxidized in 2 weeks");
  expect(t).toContain("turned orange and stung");   // nested reply captured
  expect(t).toContain("too expensive for the size");
});

test("redditCommentText respects maxChars", () => {
  const big = { data: { children: [{ data: { body: "x".repeat(10000) } }] } };
  expect(redditCommentText([big], 100).length).toBeLessThanOrEqual(100);
});
