import { loadConfig, type Config } from "../config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  /** When set, requests a JSON object response and validates it parses. */
  json?: boolean;
  maxTokens?: number;
}

/**
 * Thin OpenAI-compatible client. All traffic is meant to route through the
 * Bifrost gateway so virtual keys, routing rules, and request logs apply.
 */
export class LLMClient {
  constructor(private cfg: Config = loadConfig()) {}

  async complete(opts: CompleteOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model ?? this.cfg.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: "json_object" };

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
  }

  /** Complete and parse a JSON object, with one repair retry. */
  async completeJson<T>(opts: CompleteOptions): Promise<T> {
    const raw = await this.complete({ ...opts, json: true });
    try {
      return JSON.parse(stripFences(raw)) as T;
    } catch {
      const repaired = await this.complete({
        ...opts,
        json: true,
        temperature: 0,
        messages: [
          ...opts.messages,
          { role: "assistant", content: raw },
          {
            role: "user",
            content: "That was not valid JSON. Return ONLY the corrected JSON object.",
          },
        ],
      });
      return JSON.parse(stripFences(repaired)) as T;
    }
  }
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}
