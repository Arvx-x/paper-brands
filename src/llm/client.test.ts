import { test, expect } from "bun:test";
import { isRetryableStatus, backoffMs } from "./client.ts";

test("retryable statuses", () => {
  expect(isRetryableStatus(429)).toBe(true);
  expect(isRetryableStatus(503)).toBe(true);
  expect(isRetryableStatus(400)).toBe(false);
  expect(isRetryableStatus(401)).toBe(false);
});

test("backoff grows and is bounded with jitter", () => {
  const b0 = backoffMs(0), b3 = backoffMs(3);
  expect(b0).toBeGreaterThanOrEqual(0);
  expect(b0).toBeLessThanOrEqual(500);
  expect(b3).toBeLessThanOrEqual(16000);
});
