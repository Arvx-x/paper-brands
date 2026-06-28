// src/userdata/parse.test.ts
import { test, expect } from "bun:test";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./parse.ts";

function makeBook(sheets: Record<string, any[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  // xlsx requires at least one sheet; add an empty placeholder so the buffer is valid.
  if (!wb.SheetNames.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "_empty");
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("parses well-formed Voices and SKUs sheets", () => {
  const buf = makeBook({
    Voices: [["quote", "kind", "source", "internal"], ["melts in my bag", "rejection", "NPS", ""]],
    SKUs: [["brand", "product", "price"], ["Acme", "Balm", "199"]],
  });
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices).toHaveLength(1);
  expect(intel.voices[0]!.kind).toBe("rejection");
  expect(intel.voices[0]!.independent).toBe(true);
  expect(intel.skus[0]!.price).toBe(199);
  expect(warnings).toHaveLength(0);
});

test("drops a malformed row with a warning, never coerces", () => {
  const buf = makeBook({
    SKUs: [["brand", "product", "price"], ["Acme", "Balm", "notanumber"], ["B", "P", "50"]],
  });
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.skus).toHaveLength(1);
  expect(intel.skus[0]!.price).toBe(50);
  expect(warnings.join(" ")).toContain("SKUs");
});

test("missing optional cell stays absent, not 0", () => {
  const buf = makeBook({ SKUs: [["brand", "product", "price", "rating"], ["A", "B", "10", ""]] });
  const { intel } = parseWorkbook(buf);
  expect(intel.skus[0]!.rating).toBeUndefined();
});

test("internal=true marks a voice non-independent", () => {
  const buf = makeBook({ Voices: [["quote", "kind", "source", "internal"], ["our goal", "trigger", "memo", "true"]] });
  const { intel } = parseWorkbook(buf);
  expect(intel.voices[0]!.independent).toBe(false);
});

test("Overrides sheet parses priceBands/currency", () => {
  const buf = makeBook({
    Overrides: [["field", "value"], ["currency", "INR"], ["priceBands", "value:0-150, core:150-400"]],
  });
  const { intel } = parseWorkbook(buf);
  expect(intel.overrides.currency).toBe("INR");
  expect(intel.overrides.priceBands).toHaveLength(2);
  expect(intel.overrides.priceBands![0]!.highMinor).toBe(15000); // 150 * 100
});

test("empty workbook returns empty intel + a warning, never throws", () => {
  const buf = makeBook({});
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices).toHaveLength(0);
  expect(warnings.length).toBeGreaterThan(0);
});

test("non-workbook buffer throws", () => {
  expect(() => parseWorkbook(new TextEncoder().encode("not a workbook").buffer)).toThrow();
});

test("Overrides priceBands: open-ended band (400+) uses defined sentinel highMinor", () => {
  const buf = makeBook({
    Overrides: [["field", "value"], ["priceBands", "value:0-150, premium:400+"]],
  });
  const { intel } = parseWorkbook(buf);
  expect(intel.overrides.priceBands).toHaveLength(2);
  const premium = intel.overrides.priceBands!.find((b) => b.label === "premium")!;
  expect(premium.lowMinor).toBe(40000); // 400 * 100
  expect(premium.highMinor).toBe(9_999_900); // the sentinel
});
