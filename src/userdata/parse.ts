// src/userdata/parse.ts
import * as XLSX from "xlsx";
import {
  UserVoiceSchema, UserSkuSchema, UserCompetitorSchema,
  type UserVoice, type UserSku, type UserCompetitor, type UserOverrides, type UserIntel,
} from "./types.ts";
import { summarize } from "./merge.ts";

type Row = Record<string, string>;

/** Read a sheet as array-of-objects keyed by trimmed lower-case header. */
function readSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return raw.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim().toLowerCase()] = String(v ?? "").trim();
    return out;
  });
}

const num = (s: string): number | undefined => {
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const truthy = (s: string): boolean => /^(true|yes|1|y)$/i.test(s.trim());
const splitList = (s: string): string[] => s.split(";").map((x) => x.trim()).filter(Boolean);

/** Sentinel highMinor for open-ended bands (e.g. "premium:400+"). Represents
 *  ~99,999 in the category's currency major units — effectively unlimited. */
const OPEN_BAND_HIGH_MINOR = 9_999_900;

/** "value:0-150, core:150-400, premium:400+" -> bands in MINOR units (x100). */
function parsePriceBands(s: string): UserOverrides["priceBands"] {
  const bands = s.split(",").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const [label, range] = seg.split(":").map((x) => x.trim());
    if (!label || !range) return undefined;
    const m = range.replace(/\+$/, "-").split("-").map((x) => x.trim());
    const low = Number(m[0]);
    const isOpen = m[1] === "" || m[1] === undefined;
    const high = isOpen ? undefined : Number(m[1]);
    if (!Number.isFinite(low) || (!isOpen && !Number.isFinite(high!))) return undefined;
    return {
      label,
      lowMinor: Math.round(low * 100),
      highMinor: isOpen ? OPEN_BAND_HIGH_MINOR : Math.round(high! * 100),
    };
  }).filter((b): b is NonNullable<typeof b> => !!b);
  return bands.length ? bands : undefined;
}

/** "dry-lips:0.4, tint:0.3" -> [{seed,weight}]. */
function parseSegments(s: string): UserOverrides["buyerSegments"] {
  const segs = s.split(",").map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const idx = seg.lastIndexOf(":");
    if (idx < 0) return undefined;
    const seed = seg.slice(0, idx).trim();
    const weight = Number(seg.slice(idx + 1).trim());
    if (!seed || !Number.isFinite(weight)) return undefined;
    return { seed, weight };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  return segs.length ? segs : undefined;
}

/**
 * Parse a user workbook into UserIntel. Fail-clean: a malformed row is dropped
 * with a warning, never silently coerced; a missing optional cell stays absent,
 * not 0/null. Throws ONLY when the buffer is not a readable workbook at all.
 */
export function parseWorkbook(buf: ArrayBuffer | Uint8Array): { intel: UserIntel; warnings: string[] } {
  // Validate: xlsx files are ZIP archives — they start with the PK magic bytes (0x50 0x4B 0x03 0x04).
  // SheetJS silently treats arbitrary bytes as CSV, so we must check ourselves.
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error("Not a valid xlsx workbook (expected ZIP/PK magic bytes).");
  }
  const wb = XLSX.read(buf, { type: "array" });
  const warnings: string[] = [];

  const voices: UserVoice[] = [];
  readSheet(wb, "Voices").forEach((r, i) => {
    if (!r.quote && !r.kind && !r.source) return; // blank row
    const parsed = UserVoiceSchema.safeParse({
      quote: r.quote, kind: r.kind, source: r.source,
      segment: r.segment || undefined, date: r.date || undefined,
      independent: r.internal ? !truthy(r.internal) : true,
    });
    if (parsed.success) voices.push(parsed.data);
    else warnings.push(`Voices row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const skus: UserSku[] = [];
  readSheet(wb, "SKUs").forEach((r, i) => {
    if (!r.brand && !r.product && !r.price) return;
    const parsed = UserSkuSchema.safeParse({
      brand: r.brand ?? "", product: r.product ?? "", price: num(r.price ?? ""),
      mrp: num(r.mrp ?? ""), packSize: r.packsize || undefined, unitQty: num(r.unitqty ?? ""),
      subtype: r.subtype || undefined, reviewCount: num(r.reviewcount ?? ""), rating: num(r.rating ?? ""),
      tier: r.tier || undefined, unitsSold: num(r.unitssold ?? ""), marginPct: num(r.marginpct ?? ""),
    });
    if (parsed.success) skus.push(parsed.data);
    else warnings.push(`SKUs row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const competitors: UserCompetitor[] = [];
  readSheet(wb, "Competitors").forEach((r, i) => {
    if (!r.name) return;
    const parsed = UserCompetitorSchema.safeParse({
      name: r.name, pricePositioning: r.pricepositioning || undefined,
      claims: splitList(r.claims ?? ""), strengths: splitList(r.strengths ?? ""), weaknesses: splitList(r.weaknesses ?? ""),
    });
    if (parsed.success) competitors.push(parsed.data);
    else warnings.push(`Competitors row ${i + 2} skipped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });

  const overrides: UserOverrides = {};
  readSheet(wb, "Overrides").forEach((r) => {
    const field = (r.field ?? "").toLowerCase();
    const value = r.value ?? "";
    if (!field || !value) return;
    if (field === "currency") overrides.currency = value;
    else if (field === "pricebands") { const b = parsePriceBands(value); if (b) overrides.priceBands = b; }
    else if (field === "buyersegments") { const s = parseSegments(value); if (s) overrides.buyerSegments = s; }
    else warnings.push(`Overrides: unknown field "${r.field}" ignored`);
  });

  if (!voices.length && !skus.length && !competitors.length && !Object.keys(overrides).length) {
    warnings.push("No usable rows found in any sheet (Voices/SKUs/Competitors/Overrides).");
  }

  const partial = { voices, skus, competitors, overrides };
  return { intel: { ...partial, summary: summarize(partial) }, warnings };
}
