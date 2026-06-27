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

import { youtubeVideoId, parseTimedTextXml, extractNextDataReviews } from "./extract.ts";

test("youtubeVideoId parses watch, youtu.be, shorts, embed forms", () => {
  expect(youtubeVideoId("https://www.youtube.com/watch?v=abc123XYZ_-")).toBe("abc123XYZ_-");
  expect(youtubeVideoId("https://youtu.be/abc123XYZ_-?t=10")).toBe("abc123XYZ_-");
  expect(youtubeVideoId("https://www.youtube.com/shorts/abc123XYZ_-")).toBe("abc123XYZ_-");
  expect(youtubeVideoId("https://www.youtube.com/embed/abc123XYZ_-")).toBe("abc123XYZ_-");
  expect(youtubeVideoId("https://example.com/x")).toBe("");
});

test("parseTimedTextXml decodes transcript cue text", () => {
  const xml = `<?xml version="1.0"?><transcript><text start="0" dur="2">this serum stung my face</text><text start="2" dur="2">and it oxidized fast &amp; turned orange</text></transcript>`;
  const t = parseTimedTextXml(xml);
  expect(t).toContain("this serum stung my face");
  expect(t).toContain("oxidized fast & turned orange");
});

test("parseTimedTextXml returns '' for empty/garbage", () => {
  expect(parseTimedTextXml("")).toBe("");
  expect(parseTimedTextXml("<nope/>")).toBe("");
});

test("extractNextDataReviews pulls review text from a __NEXT_DATA__ blob", () => {
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { reviews: [
      { text: "delivery was late and bottle leaked", rating: 1 },
      { reviewBody: "stopped working after two weeks" },
    ] } },
  })}</script></body></html>`;
  const t = extractNextDataReviews(html);
  expect(t).toContain("delivery was late and bottle leaked");
  expect(t).toContain("stopped working after two weeks");
});

test("extractNextDataReviews returns '' when absent/malformed", () => {
  expect(extractNextDataReviews("<html></html>")).toBe("");
  expect(extractNextDataReviews(`<script id="__NEXT_DATA__" type="application/json">{bad</script>`)).toBe("");
});
