import type { BlindCard } from "../brand/types.ts";

/** Cap text to a word budget without cutting a word in half. */
export function normalizeLen(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : words.slice(0, maxWords).join(" ");
}

const major = (minor: number) => Math.round(minor / 100);

/** Deep arena: render the structured sections so the PDP structure is actually used. */
export function renderCardForDeep(c: BlindCard, currency: string): string {
  return [
    `${c.label}`,
    `Headline: ${c.headline}`,
    `About: ${c.body}`,
    `Claims: ${c.claims.join(", ")}`,
    `Format: ${c.format}`,
    `Price: ${major(c.priceMinor)} ${currency}`,
  ].join("\n");
}

/** Single-shot arena: one flat line (back-compat with existing prompt). */
export function renderPitchFlat(c: BlindCard, currency: string): string {
  return (
    `${c.body} Key claims: ${c.claims.join(", ")}. ` +
    `Price: ${major(c.priceMinor)} ${currency}. Format: ${c.format}.`
  );
}
