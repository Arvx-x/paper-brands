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
    const res = await fetch(unwrapRedirect(url), {
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
    const text = htmlToText(html).slice(0, maxChars);
    return { requestedUrl, finalUrl, domain, status: res.status, text, ok: text.length > 0 };
  } catch {
    return { requestedUrl, finalUrl: url, domain: domainOf(url), status: 0, text: "", ok: false };
  } finally {
    clearTimeout(timer);
  }
}
