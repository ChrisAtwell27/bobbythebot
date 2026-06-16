const { test } = require("node:test");
const assert = require("node:assert");
const { gatherDebugInfo, detectHostingPlatform } = require("../utils/debugInfo");

test("detectHostingPlatform finds a known platform env var", () => {
  const platform = detectHostingPlatform({ RAILWAY_PROJECT_ID: "abc" });
  assert.strictEqual(platform, "Railway");
});

test("detectHostingPlatform returns 'Unknown' when nothing matches", () => {
  assert.strictEqual(detectHostingPlatform({}), "Unknown");
});

test("gatherDebugInfo returns the expected keys and never throws", async () => {
  // skipPublicIp avoids a real network call in tests.
  const info = await gatherDebugInfo({ skipPublicIp: true });
  for (const key of [
    "hostname",
    "platform",
    "arch",
    "nodeVersion",
    "uptimeSeconds",
    "memoryMB",
    "isDocker",
    "hostingPlatform",
    "publicIp",
    "gitCommit",
    "pid",
    "cwd",
  ]) {
    assert.ok(key in info, `missing key: ${key}`);
  }
  assert.strictEqual(info.publicIp, "skipped");
});
