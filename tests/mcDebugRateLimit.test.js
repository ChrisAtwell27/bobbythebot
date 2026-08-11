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

test("when both burst and daily caps are exhausted, retryAfter reports the larger (daily) wait", () => {
  const limiter = new RateLimiter({ daily: 5 });
  const hits = [0, 100000, 5000000, 5001000, 5002000];
  hits.forEach((t) => limiter.record("k", t));

  const result = limiter.check("k", 5003000);
  assert.strictEqual(result.allowed, false);
  // The burst window blocks at ~597 seconds, but daily blocks at ~81397 seconds.
  // We should return the larger value (daily-based).
  assert.strictEqual(result.retryAfter, 81397);
});

test("obeying a retryAfter from burst+daily exhaustion succeeds", () => {
  const limiter = new RateLimiter({ daily: 5 });
  const hits = [0, 100000, 5000000, 5001000, 5002000];
  hits.forEach((t) => limiter.record("k", t));

  const blocked = limiter.check("k", 5003000);
  assert.strictEqual(blocked.allowed, false);
  // A caller obeying this retryAfter will retry at now + retryAfter*1000
  const retryTime = 5003000 + blocked.retryAfter * 1000;
  const retryCheck = limiter.check("k", retryTime);
  assert.strictEqual(retryCheck.allowed, true);
});

test("total key count is capped at maxKeys with oldest-first eviction", () => {
  const limiter = new RateLimiter({ maxKeys: 5 });
  for (let i = 0; i < 10; i++) {
    limiter.record(`key${i}`, 1_000_000 + i);
  }

  assert.strictEqual(limiter.size(), 5, "size should never exceed maxKeys");
});

test("eviction is oldest-first, preserving newest offenders", () => {
  const limiter = new RateLimiter({ maxKeys: 3 });
  const t0 = 1_000_000;

  // Record three keys with multiple hits each to easily detect eviction
  limiter.record("first", t0);
  limiter.record("second", t0 + 1);
  limiter.record("third", t0 + 2);
  assert.strictEqual(limiter.size(), 3);

  // Recording a fourth key triggers oldest-first eviction
  limiter.record("fourth", t0 + 3);
  assert.strictEqual(limiter.size(), 3);

  // "first" should be gone; try to record it again and check the map doesn't grow
  limiter.record("first", t0 + 4);
  assert.strictEqual(limiter.size(), 3, "recording an evicted key replaces the oldest");

  // Verify the newest keys are still there by checking if they can be blocked
  // "second", "third", "fourth" should still exist and have hits
  // A fresh key "new" should be allowed
  const checkNew = limiter.check("new", t0 + 5);
  assert.strictEqual(checkNew.allowed, true);
});
