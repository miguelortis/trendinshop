import test from "node:test";
import assert from "node:assert/strict";
import {
  getClientIdentifier,
  getRetryAfterSeconds,
  getWindowBucket,
} from "../src/lib/security/rate-limit-policy.mjs";

test("rate-limit windows use stable fixed buckets", () => {
  assert.equal(getWindowBucket(59_999, 60_000), 0);
  assert.equal(getWindowBucket(60_000, 60_000), 1);
  assert.equal(getWindowBucket(179_999, 60_000), 2);
});

test("client identifier prefers the platform real-ip header", () => {
  const headers = new Headers({
    "x-real-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.7, 10.0.0.1",
  });
  assert.equal(getClientIdentifier(headers), "203.0.113.8");
});

test("client identifier falls back to the first forwarded address", () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.equal(getClientIdentifier(headers), "198.51.100.7");
  assert.equal(getClientIdentifier(new Headers()), "unknown");
});

test("retry-after is a positive whole number of seconds", () => {
  assert.equal(getRetryAfterSeconds(1_000, 2_001), 2);
  assert.equal(getRetryAfterSeconds(3_000, 2_001), 1);
});
