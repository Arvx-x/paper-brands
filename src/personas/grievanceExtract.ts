import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import type { GroundedGrievance } from "../categories/types.ts";

const NEGATIVE_RE = /complain|doesn\'?t work|sting|irritat|fake|oxidiz|breakout|no results?|refund|waste|burn|rash|smell|texture|sticky|greasy|pricey|expensive|allerg|redness|watery|leak|broke|changed colour|turned orange|dark spot|darken|ineffective|worse|dry|peel/i;
const REVIEW_CONTEXT_RE = /review|reviews|customer|verified buyer|rated|stars?|write a review|user said|buyers say/i;
const POSITIVE_ONLY_RE = /loved|visible results|highly effective|works well|amazing|excellent|happy to see|clear in|brightens skin|lightens skin|fades dark spots|hydrates|moisturi[sz]es|promotes collagen|non-sticky|original price|sale price|buy 1 get 1|regular price/i;
const INSTRUCTION_ONLY_RE = /patch test|discontinue if|avoid any reactions|consult|how to use|directions/i;
const ALLOWED_CLASSES = new Set(["community"]);
const EXCLUDED_CLASSES = new Set(["brand", "affiliate", "editorial"]);

export interface GrievanceSource {
  finalUrl: string;
  sourceClass: string;
  independent: boolean;
  rawText: string;
}

export function shouldUseSourceForGrievances(s: Pick<GrievanceSource, "sourceClass" | "rawText">): boolean {
  const cls = String(s.sourceClass);
  const text = s.rawText || "";
  if (ALLOWED_CLASSES.has(cls)) return true;
  if (EXCLUDED_CLASSES.has(cls)) return false;
  if (cls === "marketplace") return NEGATIVE_RE.test(text);
  // Unknown pages include many product/education pages. Use them only when they look
  // like review/customer text AND contain negative complaint markers.
  return NEGATIVE_RE.test(text) && REVIEW_CONTEXT_RE.test(text);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function containsQuote(rawText: string, quote: string): boolean {
  const q = norm(quote);
  return q.length > 8 && norm(rawText).includes(q);
}

export function looksLikeComplaint(text: string): boolean {
  const t = text || "";
  if (!NEGATIVE_RE.test(t)) return false;
  if (POSITIVE_ONLY_RE.test(t)) return false;
  if (INSTRUCTION_ONLY_RE.test(t)) return false;
  return true;
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
    anxiety: z.string().default(""),
    verbatimQuote: z.string().default(""),
    segment: z.string().default(""),
  })).default([]),
});

function chunkText(s: string, max = 8000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
  return chunks;
}

export interface ExtractOpts { maxTotal?: number; maxPerChunk?: number }

export async function extractGroundedGrievances(
  sources: GrievanceSource[],
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
          { role: "system", content: "Extract ONLY NEGATIVE first-hand shopper complaints/anxieties from raw review text. Do NOT extract positive product claims, benefits, educational advice, prices, promotions, FAQs, or instructions. A valid item must describe a problem, disappointment, irritation, no result, fake/oxidized product, bad texture/smell, high price concern, or similar negative purchase/use experience. Copy verbatimQuote EXACTLY from the text. Return JSON only." },
          { role: "user", content:
            `Segments (must use exact one):\n- ${segments.map((s) => s.seed).join("\n- ")}\n\n` +
            `Return at most ${maxPerChunk} product-use or purchase-decision complaints. Exclude generic benefits like brightens/hydrates/reduces wrinkles, educational statements about ingredients, or positive reviews unless the same quote states they failed, caused irritation, or created a concrete problem. ` +
            `JSON: { "grievances": [ { "anxiety", "verbatimQuote", "segment" } ] }\n\nTEXT:\n${chunk}` },
        ],
      }).catch(() => ({ grievances: [] }));
      const parsed = ExtractSchema.parse(raw).grievances;
      for (const g of parsed) {
        if (out.length >= maxTotal) break;
        if (!validSegments.has(g.segment)) continue;
        if (!containsQuote(src.rawText, g.verbatimQuote)) continue;
        // The quote itself must be complaint-like; do not let the LLM invent
        // negativity in the distilled anxiety from a positive claim.
        if (!looksLikeComplaint(g.verbatimQuote)) continue;
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
