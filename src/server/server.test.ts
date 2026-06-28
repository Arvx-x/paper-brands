import { test, expect } from "bun:test";
import { makeHandler } from "./server.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("GET / serves index.html from uiRoot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-"));
  await writeFile(join(dir, "index.html"), "<html><body>playground</body></html>");
  const handler = makeHandler({ uiRoot: dir } as any);
  const res = await handler(new Request("http://x/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("playground");
  await rm(dir, { recursive: true, force: true });
});

test("GET / -> 404 when index.html missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-"));
  const handler = makeHandler({ uiRoot: dir } as any);
  const res = await handler(new Request("http://x/"));
  expect(res.status).toBe(404);
  await rm(dir, { recursive: true, force: true });
});

test("GET /viewstate.js returns transpiled JS containing reduce", async () => {
  const handler = makeHandler({});
  const res = await handler(new Request("http://x/viewstate.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
  expect(await res.text()).toContain("reduce");
});
