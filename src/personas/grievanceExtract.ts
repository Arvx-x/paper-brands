import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import type { GroundedGrievance } from "../categories/types.ts";
import type { SourceDoc } from "../scrape/sources.ts";

const MARKER_RE = /review|rating|stars?|complain|doesn'?t work|sting|irritat|fake|oxidiz|breakout|no results?|refund|waste|burn|rash|smell|texture/i;
const ALLOWED_CLASSES = new Set(["marketplace", "community"]);
const EXCLUDED_CLASSES = new Set(["brand", "affiliate", "editorial"]);

export function shouldUseSourceForGrievances(s: Pick<SourceDoc, "sourceClass" | "rawText">): boolean {
  if (ALLOWED_CLASSES.has(String(s.sourceClass))) return true;
  if (EXCLUDED_CLASSES.has(String(s.sourceClass))) return false;
  return MARKER_RE.test(s.rawText || "");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function containsQuote(rawText: string, quote: string): boolean {
  const q = norm(quote);
  return q.length > 8 && norm(rawText).includes(q);
}

export interface ExtractedGrievance {
  anxiety: string;
  verbatimQuote: string;
  segment: string;
}

export function dedupeByQuote<T extends { verbatimQuote: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = norm(it.verbatimQuote);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
