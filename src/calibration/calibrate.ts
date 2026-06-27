import type { EquityComponents } from "./types.ts";

/** Equal-weight mean of PRESENT equity components (missing omitted, not zero-filled). */
export function composeEquity(components?: EquityComponents): number | undefined {
  if (!components) return undefined;
  const vals = [components.search, components.distribution, components.social]
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
