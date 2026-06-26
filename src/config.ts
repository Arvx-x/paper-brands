export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  simModel: string;
  concurrency: number;
}

export function loadConfig(): Config {
  const baseUrl = process.env.PB_BASE_URL ?? "https://bifrost.clinikally.work/v1";
  const apiKey = process.env.PB_API_KEY ?? "";
  const model = process.env.PB_MODEL ?? "gpt-5.2";
  const simModel = process.env.PB_SIM_MODEL ?? model;
  const concurrency = Number(process.env.PB_CONCURRENCY ?? "6");

  if (!apiKey) {
    console.warn(
      "[paper-brands] PB_API_KEY is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return { baseUrl, apiKey, model, simModel, concurrency };
}
