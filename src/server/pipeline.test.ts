import { test, expect } from "bun:test";
import { runFoundryPipeline } from "./pipeline.ts";

function deps(overrides: any = {}) {
  return {
    runFoundry: async (o: any) => {
      o.onEvent?.({ type: "stage", stage: "council", status: "done" });
      o.onEvent?.({ type: "finalist-selected", rank: 1, conceptId: "A", name: "Alpha", winRate: 0.3, winRateCiLow: 0.2, winRateCiHigh: 0.4 });
      return { finalists: [{ concept: { id: "A", name: "Alpha" } }] };
    },
    runLaunchpages: async (o: any) => {
      o.onEvent?.({ type: "page-ready", conceptId: "A", name: "Alpha", url: "/out/launchpages/a/index.html" });
      return { built: [{ conceptId: "A", name: "Alpha", indexPath: "out/launchpages/a/index.html" }] };
    },
    ...overrides,
  };
}

test("emits run-started ... run-complete in order; pageUrls assembled", async () => {
  const events: any[] = [];
  await runFoundryPipeline("lipcare", (e) => events.push(e), deps() as any);
  const types = events.map((e) => e.type);
  expect(types[0]).toBe("run-started");
  expect(types).toContain("page-ready");
  expect(types[types.length - 1]).toBe("run-complete");
  const complete = events.find((e) => e.type === "run-complete");
  expect(complete.pageUrls[0].url).toContain("index.html");
});

test("a thrown stage -> run-error with message", async () => {
  const events: any[] = [];
  await runFoundryPipeline("x", (e) => events.push(e), deps({ runFoundry: async () => { throw new Error("council down"); } }) as any);
  const err = events.find((e) => e.type === "run-error");
  expect(err).toBeDefined();
  expect(err.message).toContain("council down");
});
