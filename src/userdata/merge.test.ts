// src/userdata/merge.test.ts
import { test, expect } from "bun:test";
import { voicesToSources } from "./merge.ts";
import type { UserVoice } from "./types.ts";

const voices: UserVoice[] = [
  { quote: "the balm melts in my bag every summer", kind: "rejection", source: "Q2 NPS", independent: true },
  { quote: "our internal target is repeat buyers", kind: "trigger", source: "strategy memo", independent: false },
];

test("each voice becomes one source with its quote as rawText", () => {
  const s = voicesToSources(voices);
  expect(s).toHaveLength(2);
  expect(s[0]!.rawText).toBe("the balm melts in my bag every summer");
  expect(s[0]!.sourceClass).toBe("first-party");
});

test("independence flag is honored (internal note is not independent)", () => {
  const s = voicesToSources(voices);
  expect(s[0]!.independent).toBe(true);
  expect(s[1]!.independent).toBe(false);
});

test("finalUrl is unique per voice", () => {
  const s = voicesToSources(voices);
  expect(new Set(s.map((x) => x.finalUrl)).size).toBe(2);
});
