import { loadConfig, resolveModel, type Config } from "../config.ts";

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
export function isRetryableStatus(s: number): boolean { return RETRYABLE.has(s); }
export function backoffMs(attempt: number): number {
  return Math.floor(Math.random() * Math.min(16000, 500 * 2 ** attempt));
}
const TIMEOUT_MS = Number(process.env.PB_LLM_TIMEOUT_MS ?? "60000");
const MAX_RETRIES = Number(process.env.PB_LLM_MAX_RETRIES ?? "5");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  messages: ChatMessage[];
  /** `provider:model` or bare model (uses default provider). */
  model?: string;
  temperature?: number;
  /** When set, requests a JSON object response and validates it parses. */
  json?: boolean;
  maxTokens?: number;
}

/**
 * Provider-aware OpenAI-compatible client. Resolves base URL + key per call
 * from the model's `provider:` prefix, so OpenAI and Google (Gemini) models
 * can be mixed freely — e.g. strategy on gpt-4o, arena sim on gemini-2.5-flash.
 */
export class LLMClient {
  constructor(private cfg: Config = loadConfig()) {}

  async complete(opts: CompleteOptions): Promise<string> {
    const ref = opts.model ?? this.cfg.model;
    const { model, conf } = resolveModel(ref, this.cfg);

    let messages = opts.messages;
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) {
      body.response_format = { type: "json_object" };
      // OpenAI (and Gemini's compat layer) want the word "json" present.
      if (!messages.some((m) => /json/i.test(m.content))) {
        messages = [
          { role: "system", content: "Respond with a single valid JSON object." },
          ...messages,
        ];
        body.messages = messages;
      }
    }

    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        res = await fetch(`${conf.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${conf.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw e;
        await sleep(backoffMs(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) break;
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        res = null;
        continue;
      }
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}) [${ref}]: ${text.slice(0, 500)}`);
    }
    if (!res) throw new Error(`LLM request failed after retries [${ref}]`);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`LLM returned empty content [${ref}]`);
    return content;
  }

  /** Complete and parse a JSON object, with one repair retry. */
  async completeJson<T>(opts: CompleteOptions): Promise<T> {
    const raw = await this.complete({ ...opts, json: true });
    const first = parseJson<T>(raw);
    if (first.ok) return first.value;

    // Repair pass at temperature 0, with generous headroom so the corrected
    // object isn't itself truncated (a common cause of "unterminated string").
    const repaired = await this.complete({
      ...opts,
      json: true,
      temperature: 0,
      maxTokens: Math.max(opts.maxTokens ?? 0, 4096),
      messages: [
        ...opts.messages,
        { role: "assistant", content: raw },
        { role: "user", content: "That was not valid JSON. Return ONLY the corrected, COMPLETE JSON object." },
      ],
    });
    const second = parseJson<T>(repaired);
    if (second.ok) return second.value;
    throw new Error(`Could not parse JSON after repair: ${second.error}`);
  }
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Best-effort JSON parse: strip code fences, then fall back to the largest
 * brace-balanced substring (tolerates leading/trailing prose). Returns a result
 * object rather than throwing so callers can decide whether to repair.
 */
function parseJson<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  const candidates = [stripFences(raw), braceSlice(raw)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c) as T };
    } catch {
      /* try next candidate */
    }
  }
  return { ok: false, error: (() => { try { JSON.parse(stripFences(raw)); return ""; } catch (e) { return (e as Error).message; } })() };
}

/** Slice from the first `{` to the last `}` — drops prose wrapped around an object. */
function braceSlice(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : null;
}
