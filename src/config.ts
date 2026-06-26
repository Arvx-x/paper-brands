export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export interface Config {
  /** Default provider used when a model has no `provider:` prefix. */
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  model: string;
  simModel: string;
  concurrency: number;
}

/**
 * Models are addressed as `provider:model`, e.g. `google:gemini-2.5-flash`
 * or `openai:gpt-4o-mini`. A bare model name uses the default provider.
 * Both OpenAI and Google expose OpenAI-compatible /chat/completions endpoints,
 * so one client serves both.
 */
export function loadConfig(): Config {
  const providers: Record<string, ProviderConfig> = {
    openai: {
      baseUrl: process.env.PB_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.PB_API_KEY ?? "",
    },
    google: {
      baseUrl:
        process.env.PB_GOOGLE_BASE_URL ??
        "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.PB_GOOGLE_API_KEY ?? "",
    },
  };

  const defaultProvider = process.env.PB_DEFAULT_PROVIDER ?? "openai";
  const model = process.env.PB_MODEL ?? "openai:gpt-4o-mini";
  // Default the high-volume simulation arena to fast/cheap Gemini Flash.
  const simModel = process.env.PB_SIM_MODEL ?? "google:gemini-2.5-flash";
  const concurrency = Number(process.env.PB_CONCURRENCY ?? "6");

  return { defaultProvider, providers, model, simModel, concurrency };
}

/** Split a `provider:model` string into its parts using the default provider. */
export function resolveModel(
  ref: string,
  cfg: Config,
): { provider: string; model: string; conf: ProviderConfig } {
  const idx = ref.indexOf(":");
  let provider = cfg.defaultProvider;
  let model = ref;
  if (idx > 0) {
    provider = ref.slice(0, idx);
    model = ref.slice(idx + 1);
  }
  const conf = cfg.providers[provider];
  if (!conf) throw new Error(`Unknown provider '${provider}' for model '${ref}'.`);
  if (!conf.apiKey) {
    console.warn(`[paper-brands] No API key for provider '${provider}'. Set it in .env.`);
  }
  return { provider, model, conf };
}
