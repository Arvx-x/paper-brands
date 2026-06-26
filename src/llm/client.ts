import { loadConfig, resolveModel, type Config } from "../config.ts";

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

    const res = await fetch(`${conf.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conf.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}) [${ref}]: ${text.slice(0, 500)}`);
    }

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
