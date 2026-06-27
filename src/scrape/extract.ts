/**
 * Free review-content extractors — no rendering API, no new keys.
 *  - extractJsonLdReviews: pull Review/reviewBody text out of embedded
 *    <script type="application/ld+json"> blocks (present in static HTML of many
 *    product/review pages even when the visible reviews are JS-rendered).
 *  - redditCommentText: walk Reddit's free `.json` comment TREE (recursively),
 *    where real first-hand complaints live — not just the post body.
 */

/** Recursively collect any `reviewBody`/`description` strings from a JSON-LD node. */
function collectReviewBodies(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) collectReviewBodies(n, out);
    return;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    const type = String(o["@type"] ?? "");
    if (/review/i.test(type)) {
      const body = o["reviewBody"] ?? o["description"];
      if (typeof body === "string" && body.trim()) out.push(body.trim());
    }
    // Recurse into common containers: review, reviews, itemListElement, @graph, etc.
    for (const v of Object.values(o)) collectReviewBodies(v, out);
  }
}

/** Extract review text embedded as JSON-LD in raw HTML. Returns "" if none. */
export function extractJsonLdReviews(html: string): string {
  const bodies: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      collectReviewBodies(JSON.parse(raw), bodies);
    } catch {
      /* malformed JSON-LD — skip, never throw */
    }
  }
  // dedupe
  return [...new Set(bodies)].join(" — ").trim();
}

interface RedditNode {
  data?: {
    title?: unknown;
    selftext?: unknown;
    body?: unknown;
    children?: RedditNode[];
    replies?: { data?: { children?: RedditNode[] } } | string;
  };
}

/** Recursively collect title/selftext/body across the whole Reddit listing tree. */
function walkReddit(node: RedditNode | RedditNode[] | undefined, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walkReddit(n, out);
    return;
  }
  const d = node.data;
  if (!d) return;
  for (const key of ["title", "selftext", "body"] as const) {
    const v = d[key];
    if (typeof v === "string" && v.trim() && v !== "[deleted]" && v !== "[removed]") out.push(v.trim());
  }
  if (Array.isArray(d.children)) walkReddit(d.children, out);
  if (d.replies && typeof d.replies === "object" && d.replies.data?.children) {
    walkReddit(d.replies.data.children, out);
  }
}

/** Flatten a Reddit `.json` listing (post + full comment tree) to text, capped. */
export function redditCommentText(listings: unknown, maxChars: number): string {
  const out: string[] = [];
  walkReddit(listings as RedditNode[], out);
  return out.join(" — ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
