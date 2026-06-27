import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import type { GroundedGrievance } from "../categories/types.ts";

// Source-selection markers (cheap pre-filter to avoid feeding pure product/marketing pages).
const NEGATIVE_RE = /complain|doesn\'?t work|sting|irritat|fake|oxidiz|breakout|no results?|refund|waste|burn|rash|smell|texture|sticky|greasy|pricey|expensive|allerg|redness|watery|leak|broke|changed colour|turned orange|dark spot|darken|ineffective|worse|dry|peel/i;
const REVIEW_CONTEXT_RE = /review|reviews|customer|verified buyer|rated|stars?|write a review|user said|buyers say/i;
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

/** Containment: the quote literally appears in the raw source text (length-guarded). */
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

/**
 * VERIFIER pass (replaces brittle regex gatekeeping): an independent LLM call judges
 * which candidates are GENUINE first-hand shopper complaints vs educational text,
 * marketing claims, instructions, or positive reviews. Mirrors the codebase's
 * containment+entailment philosophy: containment proves the quote is real, this
 * verifier proves it actually IS a complaint. Returns the kept indices.
 *
 * Fails OPEN-CLOSED: on any verifier error, returns [] (drop the batch) so a broken
 * verifier never lets junk through. Injectable for tests.
 */
const VerifySchema = z.object({ keep: z.array(z.number()).default([]) });

export async function verifyGrievances(
  candidates: ExtractedGrievance[],
  llm: LLMClient,
): Promise<ExtractedGrievance[]> {
  if (!candidates.length) return [];
  const numbered = candidates.map((c, i) => `${i}. "${c.verbatimQuote}"`).join("\n");
  const res = await llm
    .completeJson<unknown>({
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a strict reviewer. Decide which quoted lines are GENUINE first-hand " +
            "shopper complaints about using/buying a product (a problem, disappointment, " +
            "irritation, no result, fake/oxidized item, bad texture/smell, or a real price " +
            "objection). REJECT: marketing/benefit claims, educational/ingredient explanations, " +
            "usage instructions, FAQs, neutral facts, and positive reviews. Return JSON only.",
        },
        {
          role: "user",
          content:
            `Lines:\n${numbered}\n\n` +
            `Return the indices of ONLY the genuine shopper complaints: { "keep": [<indices>] }`,
        },
      ],
    })
    .catch(() => null);
  if (!res) return [];
  const keep = new Set(VerifySchema.parse(res).keep);
  return candidates.filter((_, i) => keep.has(i));
}

export interface ExtractOpts { maxTotal?: number; maxPerChunk?: number; verify?: typeof verifyGrievances }

export async function extractGroundedGrievances(
  sources: GrievanceSource[],
  segments: { seed: string }[],
  llm = new LLMClient(),
  opts: ExtractOpts = {},
): Promise<GroundedGrievance[]> {
  const maxTotal = opts.maxTotal ?? Number(process.env.PB_GRIEVANCE_MAX ?? "100");
  const maxPerChunk = opts.maxPerChunk ?? 8;
  const verify = opts.verify ?? verifyGrievances;
  const validSegments = new Set(segments.map((s) => s.seed));
  if (!sources.length || !validSegments.size) return [];

  // 1) Extract candidates per source chunk, keep only contained quotes with valid segments.
  const candidates: (ExtractedGrievance & { sourceUrl: string; sourceClass: string })[] = [];
  for (const src of sources.filter(shouldUseSourceForGrievances)) {
    for (const chunk of chunkText(src.rawText || "")) {
      if (candidates.length >= maxTotal * 2) break; // gather a buffer; verifier prunes
      const raw = await llm
        .completeJson<unknown>({
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Extract ONLY negative first-hand shopper complaints/anxieties from raw review " +
                "text. Copy verbatimQuote EXACTLY from the text. Return JSON only.",
            },
            {
              role: "user",
              content:
                `Segments (use exactly one):\n- ${segments.map((s) => s.seed).join("\n- ")}\n\n` +
                `Return at most ${maxPerChunk} product-use or purchase-decision complaints. ` +
                `JSON: { "grievances": [ { "anxiety", "verbatimQuote", "segment" } ] }\n\nTEXT:\n${chunk}`,
            },
          ],
        })
        .catch(() => ({ grievances: [] }));
      for (const g of ExtractSchema.parse(raw).grievances) {
        if (!validSegments.has(g.segment)) continue;
        if (!containsQuote(src.rawText, g.verbatimQuote)) continue;
        candidates.push({ ...g, sourceUrl: src.finalUrl, sourceClass: src.sourceClass });
      }
    }
  }

  // 2) Verifier pass (semantic complaint judgment) replaces brittle regex gatekeeping.
  const deduped = dedupeByQuote(candidates);
  const verifierLlm = new LLMClient({ ...loadConfig() });
  const kept = await verify(deduped, verifierLlm);

  // 3) Map kept candidates back to their source metadata.
  const keptQuotes = new Set(kept.map((k) => norm(k.verbatimQuote)));
  const out: GroundedGrievance[] = [];
  for (const c of deduped) {
    if (out.length >= maxTotal) break;
    if (!keptQuotes.has(norm(c.verbatimQuote))) continue;
    out.push({
      segment: c.segment,
      anxiety: c.anxiety,
      verbatimQuote: c.verbatimQuote,
      sourceUrl: c.sourceUrl,
      sourceClass: c.sourceClass,
      verified: true,
    });
  }
  return out.slice(0, maxTotal);
}
