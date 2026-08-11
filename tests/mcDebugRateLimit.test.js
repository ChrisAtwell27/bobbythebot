const { test } = require("node:test");
const assert = require("node:assert");

const { RateLimiter } = require("../utils/mcDebugRateLimit");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test("allows the first three hits inside the burst window", () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(limiter.check("ip", t0 + i).allowed, true, `hit ${i + 1}`);
    limiter.record("ip", t0 + i);
  }
});

test("blocks the fourth hit inside the burst window", () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) limiter.record("ip", t0 + i);

  const result = limiter.check("ip", t0 + 4);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.retryAfter > 0);
  assert.ok(result.retryAfter <= 600);
});

test("allows again once the burst window has passed", () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) limiter.record("ip", t0 + i);

  assert.strictEqual(limiter.check("ip", t0 + 11 * MINUTE).allowed, true);
});

test("enforces the daily cap even when bursts are spread out", () => {
  const limiter = new RateLimiter();
  let now = 1_000_000;
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(limiter.check("ip", now).allowed, true, `hit ${i + 1}`);
    limiter.record("ip", now);
    now += 40 * MINUTE; // clears the burst window every time
  }

  const result = limiter.check("ip", now);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.retryAfter > 0);
});

test("keys are independent", () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) limiter.record("ip-a", t0 + i);

  assert.strictEqual(limiter.check("ip-a", t0 + 4).allowed, false);
  assert.strictEqual(limiter.check("ip-b", t0 + 4).allowed, true);
});

test("check never records, so repeated checks do not consume budget", () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i++) assert.strictEqual(limiter.check("ip", t0).allowed, true);
});

test("an empty key is always allowed and never stored", () => {
  const limiter = new RateLimiter();
  assert.strictEqual(limiter.check("", 1).allowed, true);
  limiter.record("", 1);
  assert.strictEqual(limiter.size(), 0);
});

test("entries older than a day are pruned so the map stays bounded", () => {
  const limiter = new RateLimiter();
  limiter.record("old", 1_000_000);
  assert.strictEqual(limiter.size(), 1);

  limiter.check("other", 1_000_000 + 25 * HOUR);
  assert.strictEqual(limiter.size(), 0);
});
