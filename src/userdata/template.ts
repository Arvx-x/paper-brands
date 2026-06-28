// src/userdata/template.ts
import * as XLSX from "xlsx";

/**
 * Build the canonical paper-brands-intel.xlsx: 4 data sheets (with headers + one
 * example row each) plus a README sheet. The example rows are valid input, so the
 * template round-trips through parseWorkbook (verified in tests).
 */
export function buildTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();

  const readme = [
    ["Paper Brands — Category Intel Template"],
    ["Fill ONLY what you have. Blank sheets are skipped; gaps show honestly in provenance."],
    [""],
    ["Voices", "Customer verbatims. Each row becomes one independent evidence source."],
    ["  quote*", "the exact words (a survey comment, support ticket, review, sales note)"],
    ["  kind*", "one of: unmet | rejection | trigger | praise"],
    ["  segment", "optional: which buyer this is (e.g. 'outdoor/SPF user')"],
    ["  source*", "where it came from (e.g. 'Q2 NPS survey')"],
    ["  date", "optional: e.g. 2026-03"],
    ["  internal", "optional: true if this is a brand-internal note, not customer voice"],
    [""],
    ["SKUs", "Real products + data scraping cannot reach (sell-through, margin)."],
    ["  brand*, product*, price*", "price is current selling price in whole currency"],
    ["  mrp, packSize, unitQty, subtype, reviewCount, rating, tier", "optional"],
    ["  unitsSold, marginPct", "optional: recorded, informational (not yet load-bearing)"],
    [""],
    ["Competitors", "name* + optional pricePositioning, claims, strengths, weaknesses (use ; to separate lists)"],
    [""],
    ["Overrides", "field/value. field one of: currency | priceBands | buyerSegments"],
    ["  priceBands example", "value:0-150, core:150-400, premium:400+"],
    ["  buyerSegments example", "dry-lips relief:0.4, tint+care:0.3, SPF:0.3"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "README");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["quote", "kind", "segment", "source", "date", "internal"],
    ["the balm melts in my bag every summer", "rejection", "outdoor/SPF user", "Q2 NPS survey", "2026-03", ""],
  ]), "Voices");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["brand", "product", "price", "mrp", "packSize", "unitQty", "subtype", "reviewCount", "rating", "tier", "unitsSold", "marginPct"],
    ["Acme", "Daily Lip Balm", "199", "249", "4.5g", "4.5", "medicated", "1200", "4.2", "core", "8000", "55"],
  ]), "SKUs");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["name", "pricePositioning", "claims", "strengths", "weaknesses"],
    ["RivalCo", "premium", "long-lasting; SPF 30", "wide distribution; trusted", "expensive; waxy feel"],
  ]), "Competitors");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["field", "value"],
    ["currency", "INR"],
    ["priceBands", "value:0-150, core:150-400, premium:400+"],
    ["buyerSegments", "dry-lips relief:0.4, tint+care:0.3, SPF:0.3"],
  ]), "Overrides");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
