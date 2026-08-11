const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildThreadTitle,
  buildLogTail,
  truncateLogs,
  validateReport,
  sanitizeFilename,
  getClientIp,
  MAX_TITLE,
  MAX_LOG_BYTES,
} = require("../utils/mcDebugReport");

function png(overrides = {}) {
  return {
    mimetype: "image/png",
    size: 1024,
    originalname: "shot.png",
    buffer: Buffer.alloc(10),
    ...overrides,
  };
}

test("buildThreadTitle keeps a short description intact", () => {
  assert.strictEqual(
    buildThreadTitle("1.2.3", "crash on world load"),
    "[v1.2.3] crash on world load"
  );
});

test("buildThreadTitle never exceeds Discord's 100 character limit", () => {
  const title = buildThreadTitle("1.2.3", "x".repeat(500));
  assert.ok(title.length <= MAX_TITLE, `got ${title.length}`);
  assert.ok(title.startsWith("[v1.2.3] "));
  assert.ok(title.endsWith("…"));
});

test("buildThreadTitle breaks on a word boundary when one is close to the cut", () => {
  // Long enough to force truncation: 20 five-letter words = 119 chars.
  const words = Array.from({ length: 20 }, (_, i) => `word${i % 10}`).join(" ");
  const title = buildThreadTitle("1.0", words);

  assert.ok(title.length <= MAX_TITLE, `got ${title.length}`);
  assert.ok(title.endsWith("…"), "should be truncated");
  assert.ok(!/\s…$/.test(title), "should not leave a dangling space before the ellipsis");
  // The cut landed on a boundary, so no partial word survives.
  const lastWord = title.slice(0, -1).trim().split(" ").pop();
  assert.match(lastWord, /^word\d$/, `partial word left behind: ${lastWord}`);
});

test("buildThreadTitle collapses newlines and tabs", () => {
  assert.strictEqual(buildThreadTitle("1.0", "line one\n\tline two"), "[v1.0] line one line two");
});

test("buildThreadTitle falls back when the description is empty", () => {
  assert.strictEqual(buildThreadTitle("1.0", ""), "[v1.0] bug report");
});

test("buildLogTail returns an empty string for empty logs", () => {
  assert.strictEqual(buildLogTail(""), "");
  assert.strictEqual(buildLogTail(null), "");
});

test("buildLogTail returns everything when there are fewer than 15 lines", () => {
  assert.strictEqual(buildLogTail("a\nb\nc"), "a\nb\nc");
});

test("buildLogTail keeps only the last 15 lines", () => {
  const logs = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
  const tail = buildLogTail(logs);
  assert.strictEqual(tail.split("\n").length, 15);
  assert.ok(tail.endsWith("line39"));
  assert.ok(!tail.includes("line24"));
});

test("buildLogTail caps the tail at 1000 characters", () => {
  const logs = Array.from({ length: 15 }, () => "x".repeat(200)).join("\n");
  assert.ok(buildLogTail(logs).length <= 1000);
});

test("truncateLogs leaves small logs alone", () => {
  const result = truncateLogs("hello");
  assert.strictEqual(result.text, "hello");
  assert.strictEqual(result.truncated, false);
});

test("truncateLogs keeps the END of oversized logs", () => {
  const logs = "A".repeat(MAX_LOG_BYTES) + "TAIL_MARKER";
  const result = truncateLogs(logs);
  assert.strictEqual(result.truncated, true);
  assert.ok(Buffer.byteLength(result.text) <= MAX_LOG_BYTES);
  assert.ok(result.text.endsWith("TAIL_MARKER"));
});

test("validateReport accepts a well-formed report", () => {
  const result = validateReport({
    version: "1.2.3",
    description: "it crashed",
    username: "Steve",
    screenshots: [png()],
  });
  assert.strictEqual(result.ok, true);
});

test("validateReport rejects a missing or blank version", () => {
  assert.strictEqual(validateReport({ description: "x" }).ok, false);
  assert.strictEqual(validateReport({ version: "   ", description: "x" }).ok, false);
  assert.strictEqual(validateReport({ description: "x" }).status, 400);
});

test("validateReport rejects a missing description", () => {
  const result = validateReport({ version: "1.0" });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /description/);
});

test("validateReport rejects an oversized description", () => {
  const result = validateReport({ version: "1.0", description: "x".repeat(2001) });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /description/);
});

test("validateReport rejects a fourth screenshot", () => {
  const result = validateReport({
    version: "1.0",
    description: "x",
    screenshots: [png(), png(), png(), png()],
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /3 screenshots/);
});

test("validateReport rejects a non-image upload", () => {
  const result = validateReport({
    version: "1.0",
    description: "x",
    screenshots: [png({ mimetype: "application/zip" })],
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /image\/png/);
});

test("sanitizeFilename strips path separators and odd characters", () => {
  assert.strictEqual(sanitizeFilename("../../etc/pa ss wd.png"), "pa_ss_wd.png");
  assert.strictEqual(sanitizeFilename("", "fallback.png"), "fallback.png");
  assert.strictEqual(sanitizeFilename("!!!", "fallback.png"), "fallback.png");
});

test("getClientIp trusts the LAST x-forwarded-for entry, which our proxy appends", () => {
  const req = {
    headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.strictEqual(getClientIp(req), "203.0.113.9");
});

test("getClientIp falls back to the socket address", () => {
  const req = { headers: {}, socket: { remoteAddress: "198.51.100.7" } };
  assert.strictEqual(getClientIp(req), "198.51.100.7");
});
