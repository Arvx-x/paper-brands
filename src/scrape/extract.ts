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

/** Extract a YouTube video id from common URL forms. Returns "" if not YouTube. */
export function youtubeVideoId(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] ?? "";
    if (!/(^|\.)youtube\.com$/.test(host)) return "";
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/);
    return m ? m[1]! : "";
  } catch {
    return "";
  }
}

/** Decode YouTube timedtext transcript XML (the free, no-key caption endpoint). */
export function parseTimedTextXml(xml: string): string {
  const parts: string[] = [];
  const re = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const decoded = (m[1] ?? "")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return " "; } })
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (decoded) parts.push(decoded);
  }
  return parts.join(" ").trim();
}

/** Recursively collect review-ish text fields (text/reviewBody/comment) from any node. */
function collectReviewText(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) { for (const n of node) collectReviewText(n, out); return; }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const key of ["reviewBody", "text", "comment", "content"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim().length > 12) out.push(v.trim());
    }
    for (const v of Object.values(o)) collectReviewText(v, out);
  }
}

/** Extract review text from a Next.js __NEXT_DATA__ JSON blob (Trustpilot etc.). */
export function extractNextDataReviews(html: string): string {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m || !m[1]) return "";
  try {
    const out: string[] = [];
    collectReviewText(JSON.parse(m[1]), out);
    return [...new Set(out)].join(" — ").trim();
  } catch {
    return "";
  }
}
