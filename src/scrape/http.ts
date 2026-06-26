const UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

export function ua(): string {
  return UAS[Math.floor(Math.random() * UAS.length)]!;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

/** Fetch with timeout, retry/backoff, and rotating UA. Returns raw body text. */
export async function fetchRaw(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const { timeoutMs = 15000, retries = 2, method = "GET", body, headers } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: "follow",
        signal: ctrl.signal,
        headers: {
          "User-Agent": ua(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...headers,
        },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1) + Math.random() * 300);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Get readable text for a URL: try a direct scripted fetch first, then fall
 * back to the Jina reader proxy (renders JS, bypasses most soft blocks).
 */
export async function fetchReadable(url: string, timeoutMs = 12000): Promise<string> {
  try {
    const html = await fetchRaw(url, { timeoutMs, retries: 1 });
    const text = await htmlToText(html);
    if (text.length > 250) return text;
  } catch {
    /* fall through to reader */
  }
  try {
    const md = await fetchRaw(`https://r.jina.ai/${url}`, { timeoutMs: timeoutMs * 2, retries: 1 });
    return md;
  } catch {
    return "";
  }
}

/** Extract readable text from HTML using Bun's HTMLRewriter (drops script/style). */
export async function htmlToText(html: string): Promise<string> {
  const chunks: string[] = [];
  let skip = 0;
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, svg, nav, footer, header", {
      element(el) {
        skip++;
        el.onEndTag(() => {
          skip--;
        });
      },
    })
    .on("*", {
      text(t) {
        if (skip === 0) {
          const s = t.text.replace(/\s+/g, " ");
          if (s.trim()) chunks.push(s);
        }
      },
    });
  // HTMLRewriter needs a Response to transform.
  await rewriter.transform(new Response(html)).text();
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
