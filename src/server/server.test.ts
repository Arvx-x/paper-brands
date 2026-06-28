import { test, expect } from "bun:test";
import { makeHandler } from "./server.ts";

function handlerWithFakeRun() {
  const fakePipeline = async (_cat: string, onEvent: any) => {
    onEvent({ type: "run-started", category: _cat });
    await new Promise((r) => setTimeout(r, 50));
  };
  return { handler: makeHandler({ runFoundryPipeline: fakePipeline as any }) };
}

test("POST /api/run returns 202, second concurrent run returns 409", async () => {
  const { handler } = handlerWithFakeRun();
  const r1 = await handler(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ category: "lipcare" }) }));
  expect(r1.status).toBe(202);
  const r2 = await handler(new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ category: "fragrance" }) }));
  expect(r2.status).toBe(409);
});

test("GET /api/state returns a snapshot", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/api/state"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json).toHaveProperty("status");
  expect(json).toHaveProperty("events");
});

test("GET /out path traversal is blocked with 403", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/out/../../etc/passwd"));
  expect(res.status).toBe(403);
});

test("unknown route -> 404", async () => {
  const { handler } = handlerWithFakeRun();
  const res = await handler(new Request("http://x/nope"));
  expect(res.status).toBe(404);
});
