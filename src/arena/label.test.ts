import { test, expect } from "bun:test";
import { optionLabel } from "./label.ts";

test("first 26 are OPTION-A..Z", () => {
  expect(optionLabel(0)).toBe("OPTION-A");
  expect(optionLabel(25)).toBe("OPTION-Z");
});

test("past 26 keeps producing distinct labels (no collision)", () => {
  expect(optionLabel(26)).not.toBe(optionLabel(0));
  expect(optionLabel(26)).toBe("OPTION-AA");
});
