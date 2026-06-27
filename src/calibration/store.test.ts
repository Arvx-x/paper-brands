import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalibrationStore } from "./store.ts";
import type { CalibrationObservation } from "./types.ts";

function ob(id: string, s = 0.4, r = 0.03): CalibrationObservation {
  return { id, category: "lip-care", syntheticScore: s, realOutcome: r,
    source: "smoke-test", unit: "concept", label: id, realMetric: "landing CTR",
    recordedAt: new Date().toISOString() };
}

async function tmp() { return mkdtemp(join(tmpdir(), "calib-")); }

test("round-trip: record then read identical", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a"));
  const read = await store.read();
  expect(read.observations).toHaveLength(1);
  expect(read.observations[0]!.id).toBe("a");
  await rm(dir, { recursive: true, force: true });
});

test("append-only: second record keeps the first", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a"));
  await store.record(ob("b"));
  expect((await store.read()).observations.map((o) => o.id)).toEqual(["a", "b"]);
  await rm(dir, { recursive: true, force: true });
});

test("dedupe by id: re-recording same id is idempotent (last wins)", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a", 0.4, 0.03));
  await store.record(ob("a", 0.4, 0.05));
  const read = await store.read();
  expect(read.observations).toHaveLength(1);
  expect(read.observations[0]!.realOutcome).toBe(0.05);
  await rm(dir, { recursive: true, force: true });
});

test("missing file reads as empty, no throw", async () => {
  const dir = await tmp();
  const read = await new CalibrationStore("lip-care", dir).read();
  expect(read.observations).toHaveLength(0);
  await rm(dir, { recursive: true, force: true });
});

test("corrupt JSON reads as empty + warns, no throw", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "lip-care"), { recursive: true });
  await writeFile(join(dir, "lip-care", "calibration.json"), "{ not json");
  const read = await new CalibrationStore("lip-care", dir).read();
  expect(read.observations).toHaveLength(0);
  await rm(dir, { recursive: true, force: true });
});

test("range rejection: out-of-range synthetic/real/equity throws", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await expect(store.record(ob("bad", 1.5, 0.03))).rejects.toThrow();
  await expect(store.record(ob("bad2", 0.4, -0.1))).rejects.toThrow();
  await expect(store.record({ ...ob("bad3"), equityScore: 2 })).rejects.toThrow();
  await rm(dir, { recursive: true, force: true });
});
