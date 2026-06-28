import { test, expect } from "bun:test";
import { RunBroadcaster, type Writer } from "./events.ts";

function fakeWriter() {
  const frames: string[] = [];
  const w: Writer = { write: (s) => frames.push(s), close: () => {} };
  return { w, frames };
}

test("emit assigns monotonic seq, ts, and SSE framing", () => {
  const b = new RunBroadcaster();
  const { w, frames } = fakeWriter();
  b.subscribe(w);
  const e1 = b.emit({ type: "run-started", category: "lipcare" });
  const e2 = b.emit({ type: "stage", stage: "council", status: "start" });
  expect(e1.seq).toBe(0);
  expect(e2.seq).toBe(1);
  expect(typeof e1.ts).toBe("string");
  expect(frames[0]).toContain("id: 0");
  expect(frames[0]).toContain('"type":"run-started"');
  expect(frames[0].endsWith("\n\n")).toBe(true);
});

test("fan-out to multiple subscribers", () => {
  const b = new RunBroadcaster();
  const a = fakeWriter(); const c = fakeWriter();
  b.subscribe(a.w); b.subscribe(c.w);
  b.emit({ type: "stage", stage: "arena", status: "start" });
  expect(a.frames).toHaveLength(1);
  expect(c.frames).toHaveLength(1);
});

test("late subscriber replays buffered events", () => {
  const b = new RunBroadcaster();
  b.emit({ type: "run-started", category: "x" });
  b.emit({ type: "stage", stage: "council", status: "done" });
  const late = fakeWriter();
  b.subscribe(late.w);
  expect(late.frames).toHaveLength(2);
});

test("ring buffer is bounded", () => {
  const b = new RunBroadcaster(3);
  for (let i = 0; i < 10; i++) b.emit({ type: "stage", stage: "arena", status: "start", note: `${i}` });
  const late = fakeWriter();
  b.subscribe(late.w);
  expect(late.frames).toHaveLength(3);
});

test("a throwing writer does not break others or the emit", () => {
  const b = new RunBroadcaster();
  const bad: Writer = { write: () => { throw new Error("boom"); } };
  const good = fakeWriter();
  b.subscribe(bad); b.subscribe(good.w);
  expect(() => b.emit({ type: "stage", stage: "scoring", status: "done" })).not.toThrow();
  expect(good.frames).toHaveLength(1);
});

test("snapshot returns status/category/lastSeq/events", () => {
  const b = new RunBroadcaster();
  b.setRunning("lipcare");
  b.emit({ type: "run-started", category: "lipcare" });
  const snap = b.snapshot();
  expect(snap.status).toBe("running");
  expect(snap.category).toBe("lipcare");
  expect(snap.lastSeq).toBe(0);
  expect(snap.events).toHaveLength(1);
});
