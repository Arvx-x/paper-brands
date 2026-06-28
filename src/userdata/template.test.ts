// src/userdata/template.test.ts
import { test, expect } from "bun:test";
import { buildTemplateWorkbook } from "./template.ts";
import { parseWorkbook } from "./parse.ts";

test("template is itself valid input and round-trips to example rows", () => {
  const buf = buildTemplateWorkbook();
  const { intel, warnings } = parseWorkbook(buf);
  expect(intel.voices.length).toBeGreaterThanOrEqual(1);
  expect(intel.skus.length).toBeGreaterThanOrEqual(1);
  expect(intel.competitors.length).toBeGreaterThanOrEqual(1);
  expect(warnings).toHaveLength(0);
});

test("template is a non-empty buffer", () => {
  expect(buildTemplateWorkbook().byteLength).toBeGreaterThan(1000);
});
