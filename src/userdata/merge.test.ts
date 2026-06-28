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

// append to src/userdata/merge.test.ts
import { skusToObservations, mergeObservations } from "./merge.ts";
import type { UserSku } from "./types.ts";
import type { PriceObservation } from "../scrape/prices.ts";

const skus: UserSku[] = [
  { brand: "Acme", product: "Daily Balm", price: 199, rating: 4.2, unitsSold: 1200 },
];

test("skusToObservations maps fields drop-in", () => {
  const obs = skusToObservations(skus);
  expect(obs[0]!.brand).toBe("Acme");
  expect(obs[0]!.price).toBe(199);
  expect(obs[0]!.rating).toBe(4.2);
});

test("mergeObservations appends user obs and dedupes by brand+product (user wins)", () => {
  const harvested: PriceObservation[] = [
    { brand: "Acme", product: "Daily Balm", price: 250 },
    { brand: "Other", product: "Tint", price: 300 },
  ];
  const { merged, conflicts } = mergeObservations(harvested, skusToObservations(skus));
  expect(merged).toHaveLength(2); // Acme/Daily Balm deduped
  expect(conflicts).toBe(1);
  const acme = merged.find((o) => o.brand === "Acme")!;
  expect(acme.price).toBe(199); // user wins
});

test("mergeObservations is identity when user obs empty", () => {
  const harvested: PriceObservation[] = [{ brand: "X", product: "Y", price: 1 }];
  const { merged } = mergeObservations(harvested, []);
  expect(merged).toEqual(harvested);
});
