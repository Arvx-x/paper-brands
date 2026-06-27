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

const ExtractSchema = z.object({
  grievances: z.array(z.object({
    anxiety: z.string(),
    verbatimQuote: z.string(),
    segment: z.string(),
  })).default([]),
});

function chunkText(s: string, max = 8000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
  return chunks;
}

export interface ExtractOpts { maxTotal?: number; maxPerChunk?: number }

export async function extractGroundedGrievances(
  sources: SourceDoc[],
  segments: { seed: string }[],
  llm = new LLMClient(),
  opts: ExtractOpts = {},
): Promise<GroundedGrievance[]> {
  const maxTotal = opts.maxTotal ?? Number(process.env.PB_GRIEVANCE_MAX ?? "100");
  const maxPerChunk = opts.maxPerChunk ?? 8;
  const validSegments = new Set(segments.map((s) => s.seed));
  if (!sources.length || !validSegments.size) return [];

  const out: GroundedGrievance[] = [];
  for (const src of sources.filter(shouldUseSourceForGrievances)) {
    for (const chunk of chunkText(src.rawText || "")) {
      if (out.length >= maxTotal) break;
      const raw = await llm.completeJson<unknown>({
        temperature: 0,
        messages: [
          { role: "system", content: "Extract concrete shopper complaints/anxieties from raw review text. Copy verbatimQuote EXACTLY from the text. Return JSON only." },
          { role: "user", content:
            `Segments (must use exact one):\n- ${segments.map((s) => s.seed).join("\n- ")}\n\n` +
            `Return at most ${maxPerChunk} product-use or purchase-decision complaints. ` +
            `JSON: { "grievances": [ { "anxiety", "verbatimQuote", "segment" } ] }\n\nTEXT:\n${chunk}` },
        ],
      }).catch(() => ({ grievances: [] }));
      const parsed = ExtractSchema.parse(raw).grievances;
      for (const g of parsed) {
        if (out.length >= maxTotal) break;
        if (!validSegments.has(g.segment)) continue;
        if (!containsQuote(src.rawText, g.verbatimQuote)) continue;
        out.push({
          segment: g.segment,
          anxiety: g.anxiety,
          verbatimQuote: g.verbatimQuote,
          sourceUrl: src.finalUrl,
          sourceClass: src.sourceClass,
          verified: true,
        });
      }
    }
  }
  return dedupeByQuote(out).slice(0, maxTotal);
}
