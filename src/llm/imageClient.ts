import { loadConfig, type Config } from "../config.ts";

/** A raw image payload: base64 bytes + mime type (no `data:` prefix). */
export interface ImageBlob {
  base64: string;
  mime: string;
}

export interface GenImageOptions {
  prompt: string;
  /** Bare Gemini model id; defaults to cfg.imageModel. A `google:` prefix is tolerated. */
  model?: string;
  /**
   * Reference images to edit/iterate from. Passing the brand's logo/packaging
   * here is what keeps a whole library visually consistent — the model edits
   * from the supplied identity rather than inventing a new look every render.
   */
  refImages?: ImageBlob[];
  /** Aspect ratio, e.g. "1:1", "4:5", "9:16", "16:9". */
  aspect?: string;
  /** Output resolution tier: "1K" | "2K" | "4K". */
  imageSize?: string;
  /** Optional system instruction (e.g. global brand do/don'ts). */
  system?: string;
  temperature?: number;
}

export interface AnalyzeImageOptions {
  prompt: string;
  images: ImageBlob[];
  /** Vision model on the OpenAI-compat layer; defaults to cfg.visionModel. */
  model?: string;
  /** Request + parse a single JSON object (with one repair retry). */
  json?: boolean;
  temperature?: number;
}

/** Typed input part for the Interactions API. */
type InputPart =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string };

interface InteractionResponse {
  output_image?: { data?: string; mime_type?: string };
  output_text?: string;
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string; data?: string; mime_type?: string }[] }[];
}

/**
 * Gemini image generation (via the Interactions API, `POST /v1beta/interactions`)
 * + multimodal vision for the creative jury. Image gen is not on the OpenAI-compat
 * layer the text `LLMClient` uses, so `generate()` talks to `/interactions`
 * directly; `analyze()` reuses the known-good OpenAI-compat vision path.
 */
export class ImageClient {
  constructor(private cfg: Config = loadConfig()) {}

  private googleKey(): string {
    const key = this.cfg.providers.google?.apiKey;
    if (!key) throw new Error("Image generation requires PB_GOOGLE_API_KEY (Gemini).");
    return key;
  }

  /** Generate a single image. text-only -> create; with refImages -> edit/iterate. */
  async generate(opts: GenImageOptions): Promise<ImageBlob> {
    const model = bareModel(opts.model ?? this.cfg.imageModel);
    const input: InputPart[] = [{ type: "text", text: opts.prompt }];
    for (const ref of opts.refImages ?? []) {
      input.push({ type: "image", mime_type: ref.mime, data: ref.base64 });
    }

    // The Interactions API only supports image/jpeg output for response_format.
    const response_format: Record<string, unknown> = { type: "image", mime_type: "image/jpeg" };
    if (opts.aspect) response_format.aspect_ratio = opts.aspect;
    if (opts.imageSize) response_format.image_size = opts.imageSize;

    const body: Record<string, unknown> = {
      model,
      input,
      response_format,
      // Image models accept thinking_level high|low (not 'minimal'); low keeps it fast.
      generation_config: { temperature: opts.temperature ?? 0.9, thinking_level: "low" },
    };
    if (opts.system) body.system_instruction = opts.system;

    const data = await this.interactions(body);
    const img = extractImage(data);
    if (!img) {
      const reason = data.output_text || data.status || "no image returned";
      throw new Error(`Image model '${model}' returned no image: ${reason.slice(0, 200)}`);
    }
    return img;
  }

  private async interactions(body: unknown): Promise<InteractionResponse> {
    const res = await fetch(`${this.cfg.geminiBaseUrl}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.googleKey() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini interactions failed (${res.status}): ${t.slice(0, 400)}`);
    }
    return (await res.json()) as InteractionResponse;
  }

  /**
   * Multimodal analysis: hand the model image(s) + a prompt, get text back. Uses
   * the OpenAI-compatible /chat/completions endpoint (vision via image_url data
   * URLs) — the same transport the text client and arena already rely on.
   */
  async analyze(opts: AnalyzeImageOptions): Promise<string> {
    const model = bareModel(opts.model ?? this.cfg.visionModel);
    const google = this.cfg.providers.google;
    if (!google?.apiKey) throw new Error("Vision jury requires PB_GOOGLE_API_KEY.");

    const content: unknown[] = [{ type: "text", text: opts.prompt }];
    for (const im of opts.images) {
      content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.base64}` } });
    }
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content }],
      temperature: opts.temperature ?? 0.3,
    };
    if (opts.json) body.response_format = { type: "json_object" };

    const res = await fetch(`${google.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${google.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Vision request failed (${res.status}) [${model}]: ${t.slice(0, 400)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Vision model '${model}' returned empty content.`);
    return text;
  }

  /** analyze() + JSON parse with one repair retry (mirrors LLMClient.completeJson). */
  async analyzeJson<T>(opts: AnalyzeImageOptions): Promise<T> {
    const raw = await this.analyze({ ...opts, json: true });
    try {
      return JSON.parse(stripFences(raw)) as T;
    } catch {
      const repaired = await this.analyze({
        ...opts,
        json: true,
        temperature: 0,
        prompt: `${opts.prompt}\n\nReturn ONLY a single valid JSON object, no prose.`,
      });
      return JSON.parse(stripFences(repaired)) as T;
    }
  }
}

/** Pull the generated image out of an Interactions response, wherever it landed. */
function extractImage(data: InteractionResponse): ImageBlob | null {
  if (data.output_image?.data) {
    return { base64: data.output_image.data, mime: data.output_image.mime_type || "image/png" };
  }
  for (const step of data.steps ?? []) {
    for (const c of step.content ?? []) {
      if (c.type === "image" && c.data) return { base64: c.data, mime: c.mime_type || "image/png" };
    }
  }
  return null;
}

function bareModel(ref: string): string {
  const i = ref.indexOf(":");
  return i > 0 ? ref.slice(i + 1) : ref;
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Write an ImageBlob to disk, returning the path. */
export async function writeImage(blob: ImageBlob, path: string): Promise<string> {
  await Bun.write(path, Buffer.from(blob.base64, "base64"));
  return path;
}

/** Read an image file back into an ImageBlob (for use as a reference / jury input). */
export async function readImage(path: string, mime = "image/png"): Promise<ImageBlob> {
  const bytes = await Bun.file(path).arrayBuffer();
  return { base64: Buffer.from(bytes).toString("base64"), mime };
}
