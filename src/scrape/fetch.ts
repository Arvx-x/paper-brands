/**
 * Best-effort raw page fetch. The search providers return a synthesized ANSWER
 * plus citation URLs — but binding a claim to a provider's paraphrase only
 * proves the paraphraser said it, not that the source did. To get real
 * attribution we fetch the cited page ourselves, follow redirects (Gemini hands
 * back opaque `vertexaisearch` redirect blobs), and extract readable text.
 *
 * Fetching arbitrary web pages is unreliable (403s, bot walls, timeouts), so
 * this is strictly best-effort: failures return ok:false with empty text and
 * are recorded as coverage gaps, never thrown.
 */

import { extractJsonLdReviews, redditCommentText, youtubeVideoId, parseTimedTextXml, extractNextDataReviews } from "./extract.ts";

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  domain: string;
  status: number;
  text: string;
  ok: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Unwrap known search-redirect wrappers so the FINAL real URL is recorded. */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url);
    // google.com/url?q=<real> and similar ?url=/<dest> wrappers.
    const q = u.searchParams.get("q") ?? u.searchParams.get("url") ?? u.searchParams.get("dest");
    if (q && /^https?:\/\//.test(q)) return q;
  } catch {
    /* fall through */
  }
  return url;
}

/**
 * Strip HTML to readable text. No DOM dependency: drop script/style/noscript,
 * convert tags to spaces, decode the common entities, collapse whitespace.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return " ";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reddit blocks HTML scraping but serves a public JSON view of any thread
 * (append `.json`). Community discussion is the scarcest, highest-value
 * independent source, so we fetch it natively: post title + selftext + the
 * top-level comment bodies — the real customer language.
 */
async function fetchRedditJson(
  requestedUrl: string,
  target: string,
  signal: AbortSignal,
  maxChars: number,
): Promise<FetchedPage | null> {
  try {
    const u = new URL(target);
    u.search = "";
    u.pathname = u.pathname.replace(/\/+$/, "") + ".json";
    const res = await fetch(u.toString(), {
      redirect: "follow",
      signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const listings = Array.isArray(data) ? data : [data];
    // Walk the FULL comment tree (recursive) — complaints live in comments/replies,
    // not just the post body. Allow more chars for comment-rich threads.
    const text = redditCommentText(listings, Math.max(maxChars, 12000));
    return { requestedUrl, finalUrl: target, domain: "reddit.com", status: res.status, text, ok: text.length > 0 };
  } catch {
    return null;
  }
}

/**
 * YouTube blocks scraping the watch page, but the free, no-key `timedtext` caption
 * endpoint returns the transcript XML. Review videos ("I tried X for 30 days") are a
 * rich free source of first-hand product experience.
 */
async function fetchYouTubeTranscript(
  requestedUrl: string,
  videoId: string,
  signal: AbortSignal,
  maxChars: number,
): Promise<FetchedPage | null> {
  // Try a few common caption tracks (manual EN, ASR EN, generic).
  const urls = [
    `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`,
    `https://www.youtube.com/api/timedtext?lang=en&kind=asr&v=${videoId}`,
    `https://video.google.com/timedtext?lang=en&v=${videoId}`,
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, { redirect: "follow", signal, headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const xml = await res.text();
      const text = parseTimedTextXml(xml).slice(0, Math.max(maxChars, 12000));
      if (text.length > 0) {
        return { requestedUrl, finalUrl: requestedUrl, domain: "youtube.com", status: res.status, text, ok: true };
      }
    } catch {
      /* try next track */
    }
  }
  return null;
}

export async function fetchPage(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxChars = opts.maxChars ?? 4000;
  const requestedUrl = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const target = unwrapRedirect(url);
    if (/(^|\.)reddit\.com$/.test(domainOf(target))) {
      const r = await fetchRedditJson(requestedUrl, target, ctrl.signal, maxChars);
      if (r && r.ok) return r;
    }
    const ytId = youtubeVideoId(target);
    if (ytId) {
      const r = await fetchYouTubeTranscript(requestedUrl, ytId, ctrl.signal, maxChars);
      // YouTube watch pages are nav chrome, not review text — only the transcript is useful.
      // If the no-key timedtext endpoint returns nothing, fail rather than scrape the page.
      return r ?? { requestedUrl, finalUrl: requestedUrl, domain: "youtube.com", status: 0, text: "", ok: false };
    }
    const res = await fetch(target, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });
    const finalUrl = res.url || url;
    const domain = domainOf(finalUrl);
    if (!res.ok) {
      return { requestedUrl, finalUrl, domain, status: res.status, text: "", ok: false };
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ctype)) {
      // Non-HTML (pdf, image, json) — we can't reliably extract quotable prose.
      return { requestedUrl, finalUrl, domain, status: res.status, text: "", ok: false };
    }
    const html = await res.text();
    // Pull embedded JSON-LD Review text first (survives even when visible reviews are
    // JS-rendered), then the readable prose. htmlToText drops <script>, so extract before.
    const ldReviews = extractJsonLdReviews(html);
    const nextReviews = extractNextDataReviews(html);
    const structured = [ldReviews, nextReviews].filter(Boolean).join(" — ");
    const prose = htmlToText(html);
    const combined = (structured ? structured + " — " : "") + prose;
    const text = combined.slice(0, structured ? Math.max(maxChars, 12000) : maxChars);
    return { requestedUrl, finalUrl, domain, status: res.status, text, ok: text.length > 0 };
  } catch {
    return { requestedUrl, finalUrl: url, domain: domainOf(url), status: 0, text: "", ok: false };
  } finally {
    clearTimeout(timer);
  }
}
