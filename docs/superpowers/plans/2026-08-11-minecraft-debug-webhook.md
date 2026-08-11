# Minecraft `/debug` Webhook + Forum Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Minecraft mod POST an in-game `/debug` report (version, description, logs, up to 3 screenshots) to the bot, which opens a Discord forum thread — and have the bot nudge newly-joined modded players toward that same forum when they report bugs in chat instead.

**Architecture:** A fourth internal express server (`api/mcDebugServer.js`, port 3004) joins the three the bot already runs, reached through the existing path-prefix proxy in `index.js`. All branching logic lives in three dependency-free `utils/` modules so the test suite never has to mock Discord or express. The chat nudge registers as a message processor on the existing centralized `commandRouter`, adding no new `messageCreate` listener.

**Tech Stack:** Node.js (CommonJS), discord.js v14, express 4, multer 2 (new dependency), mongoose 8, `node --test`.

## Global Constraints

- CommonJS only (`require`/`module.exports`). No ESM, no TypeScript.
- Node's built-in test runner. Tests live in `tests/`, named `*.test.js`, run by `npm test`.
- Never write working files, tests, or docs to the repo root (see `CLAUDE.md`).
- Uploaded files stay in memory. Nothing touches disk.
- Secrets come from `process.env` only. Never hardcode a secret or commit one.
- Keep every file under 500 lines.
- The only new npm dependency permitted is `multer@^2.0.0`.
- Log prefixes are exactly `[MC Debug]` for the webhook and `[MC Nudge]` for the chat handler.
- Forum channel default id: `1527727915817762997`. Main guild default id: `701308904877064193`.

---

### Task 1: Report helpers (`utils/mcDebugReport.js`)

Pure functions with no Discord or express imports: title building, log handling, validation, filename sanitizing, and client-IP extraction.

**Files:**

- Create: `utils/mcDebugReport.js`
- Test: `tests/mcDebugReport.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `buildThreadTitle(version: string, description: string): string` — always ≤100 chars
  - `buildLogTail(logs: string): string` — last 15 lines, ≤1000 chars, `""` when empty
  - `truncateLogs(logs: string): { text: string, truncated: boolean }` — keeps the last 1 MB
  - `validateReport({ version, description, username, screenshots }): { ok: true } | { ok: false, status: number, error: string }` where `screenshots` is an array of `{ mimetype, size, originalname, buffer }`
  - `sanitizeFilename(name: string, fallback: string): string`
  - `getClientIp(req): string`
  - Constants: `MAX_TITLE`, `MAX_DESCRIPTION`, `MAX_VERSION`, `MAX_USERNAME`, `MAX_LOG_BYTES`, `MAX_SCREENSHOTS`, `ALLOWED_IMAGE_TYPES`

- [ ] **Step 1: Write the failing test**

Create `tests/mcDebugReport.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../utils/mcDebugReport'`

- [ ] **Step 3: Write the implementation**

Create `utils/mcDebugReport.js`:

```js
/**
 * Pure helpers for the Minecraft in-game /debug webhook.
 *
 * Nothing here imports discord.js or express, so every branch is unit
 * testable without mocking either one.
 */

const MAX_TITLE = 100; // Discord's thread name limit
const MAX_DESCRIPTION = 2000;
const MAX_VERSION = 64;
const MAX_USERNAME = 32;
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_SCREENSHOTS = 3;
const LOG_TAIL_LINES = 15;
const LOG_TAIL_CHARS = 1000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

/**
 * Build a forum thread title that always fits Discord's 100 character limit.
 * Prefers breaking on a word boundary when one sits reasonably close to the cut.
 */
function buildThreadTitle(version, description) {
  const safeVersion = String(version || "unknown").trim().slice(0, MAX_VERSION);
  const prefix = `[v${safeVersion}] `;
  const text = String(description || "").replace(/\s+/g, " ").trim();
  const room = MAX_TITLE - prefix.length;

  if (room <= 0) return prefix.trim().slice(0, MAX_TITLE);
  if (!text) return `${prefix}bug report`.slice(0, MAX_TITLE);
  if (text.length <= room) return prefix + text;

  let cut = text.slice(0, room - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace);
  return `${prefix}${cut.trimEnd()}…`;
}

/**
 * The last few log lines, for an inline code block in the thread's first message.
 * Stack traces live at the end of a log, so the tail is the useful part.
 */
function buildLogTail(logs) {
  const text = String(logs || "").trimEnd();
  if (!text) return "";

  const lines = text.split(/\r?\n/).slice(-LOG_TAIL_LINES);
  let tail = lines.join("\n");
  if (tail.length > LOG_TAIL_CHARS) tail = tail.slice(-LOG_TAIL_CHARS);
  return tail;
}

/**
 * Cap logs at 1 MB, keeping the END. Oversized logs are trimmed, never rejected.
 */
function truncateLogs(logs) {
  const text = String(logs || "");
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_LOG_BYTES) return { text, truncated: false };
  return { text: buf.subarray(buf.length - MAX_LOG_BYTES).toString("utf8"), truncated: true };
}

function validateReport({ version, description, username, screenshots = [] } = {}) {
  if (!version || !String(version).trim()) {
    return { ok: false, status: 400, error: "version is required" };
  }
  if (String(version).length > MAX_VERSION) {
    return { ok: false, status: 400, error: `version must be ${MAX_VERSION} characters or fewer` };
  }
  if (!description || !String(description).trim()) {
    return { ok: false, status: 400, error: "description is required" };
  }
  if (String(description).length > MAX_DESCRIPTION) {
    return { ok: false, status: 400, error: `description must be ${MAX_DESCRIPTION} characters or fewer` };
  }
  if (username && String(username).length > MAX_USERNAME) {
    return { ok: false, status: 400, error: `username must be ${MAX_USERNAME} characters or fewer` };
  }
  if (screenshots.length > MAX_SCREENSHOTS) {
    return { ok: false, status: 400, error: `at most ${MAX_SCREENSHOTS} screenshots are allowed` };
  }
  for (const file of screenshots) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return {
        ok: false,
        status: 400,
        error: `screenshots must be image/png or image/jpeg (got ${file.mimetype})`,
      };
    }
  }
  return { ok: true };
}

function sanitizeFilename(name, fallback = "screenshot.png") {
  const base = String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-]/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 64);
  return /[a-zA-Z0-9]/.test(base) ? base : fallback;
}

/**
 * Every request reaches this server through the proxy in index.js, so the socket
 * address is always localhost. The proxy APPENDS the real remote address to
 * x-forwarded-for; a forging client can only prepend, so the last entry is ours.
 */
function getClientIp(req) {
  const header = req.headers?.["x-forwarded-for"];
  if (header) {
    const parts = String(header)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || "unknown";
}

module.exports = {
  buildThreadTitle,
  buildLogTail,
  truncateLogs,
  validateReport,
  sanitizeFilename,
  getClientIp,
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_VERSION,
  MAX_USERNAME,
  MAX_LOG_BYTES,
  MAX_SCREENSHOTS,
  ALLOWED_IMAGE_TYPES,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `mcDebugReport` tests green, existing `debugInfo` and `freeVersion` tests still green.

- [ ] **Step 5: Commit**

```bash
git add utils/mcDebugReport.js tests/mcDebugReport.test.js
git commit -m "feat: add pure helpers for Minecraft debug reports"
```

---

### Task 2: Rate limiter (`utils/mcDebugRateLimit.js`)

The mod ships an extractable secret, so rate limiting is the real protection. Time is an explicit argument, which lets the tests advance the clock instead of sleeping.

**Files:**

- Create: `utils/mcDebugRateLimit.js`
- Test: `tests/mcDebugRateLimit.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `class RateLimiter` with constructor `({ burst = 3, burstWindowMs = 600000, daily = 20, dayMs = 86400000 } = {})`
  - `check(key: string, now: number): { allowed: true } | { allowed: false, retryAfter: number }` — read-only, never records
  - `record(key: string, now: number): void`
  - `size(): number` — for the pruning test

`check` and `record` are deliberately separate: the server checks two keys (IP and username) before recording either, so a request blocked on its second key does not leave a phantom hit on its first.

- [ ] **Step 1: Write the failing test**

Create `tests/mcDebugRateLimit.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../utils/mcDebugRateLimit'`

- [ ] **Step 3: Write the implementation**

Create `utils/mcDebugRateLimit.js`:

```js
/**
 * In-memory rate limiter for the Minecraft debug webhook.
 *
 * `now` is always passed in rather than read from the clock, so tests can
 * advance time instead of sleeping. Entries older than a day are pruned on
 * every call, which keeps the map bounded without a background timer.
 */

const DEFAULTS = {
  burst: 3,
  burstWindowMs: 10 * 60 * 1000,
  daily: 20,
  dayMs: 24 * 60 * 60 * 1000,
};

class RateLimiter {
  constructor(options = {}) {
    const { burst, burstWindowMs, daily, dayMs } = { ...DEFAULTS, ...options };
    this.burst = burst;
    this.burstWindowMs = burstWindowMs;
    this.daily = daily;
    this.dayMs = dayMs;
    this.hits = new Map(); // key -> number[] of hit timestamps
  }

  /**
   * Would this hit be allowed? Read-only — call record() to actually consume it.
   * Kept separate from record() so the server can check several keys before
   * committing to any of them.
   */
  check(key, now) {
    this.prune(now);
    if (!key) return { allowed: true };

    const hits = this.hits.get(key) || [];
    const recent = hits.filter((t) => now - t < this.burstWindowMs);

    if (recent.length >= this.burst) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((this.burstWindowMs - (now - recent[0])) / 1000)),
      };
    }
    if (hits.length >= this.daily) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((this.dayMs - (now - hits[0])) / 1000)),
      };
    }
    return { allowed: true };
  }

  record(key, now) {
    if (!key) return;
    const hits = (this.hits.get(key) || []).filter((t) => now - t < this.dayMs);
    hits.push(now);
    this.hits.set(key, hits);
  }

  prune(now) {
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((t) => now - t < this.dayMs);
      if (kept.length) {
        this.hits.set(key, kept);
      } else {
        this.hits.delete(key);
      }
    }
  }

  size() {
    return this.hits.size;
  }
}

module.exports = { RateLimiter };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/mcDebugRateLimit.js tests/mcDebugRateLimit.test.js
git commit -m "feat: add rate limiter for Minecraft debug webhook"
```

---

### Task 3: Nudge text matcher (`utils/mcNudgeMatch.js`)

Decides whether a chat message reads like a bug report. Two modes: `keyword` (the default) and `keyword-or-length` (the literal original rule, which also fires on any message over 6 words).

**Files:**

- Create: `utils/mcNudgeMatch.js`
- Test: `tests/mcNudgeMatch.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `shouldNudge(text: string, mode?: "keyword" | "keyword-or-length"): boolean` — mode defaults to `"keyword"`
  - `hasBugKeyword(text: string): boolean`
  - `countWords(text: string): number`

- [ ] **Step 1: Write the failing test**

Create `tests/mcNudgeMatch.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");

const { shouldNudge, hasBugKeyword, countWords } = require("../utils/mcNudgeMatch");

test("countWords counts whitespace-separated words", () => {
  assert.strictEqual(countWords("one two three"), 3);
  assert.strictEqual(countWords("  padded   out  "), 2);
  assert.strictEqual(countWords(""), 0);
});

test("hasBugKeyword matches the core keywords in any case", () => {
  for (const text of [
    "there is a BUG here",
    "having an issue",
    "big problem",
    "the texture glitches",
    "my game crashed",
    "it's broken",
    "throws an error",
    "the recipe fails",
    "it doesn't work",
    "it doesnt work",
    "does not work at all",
    "this is not working",
    "the world won't load",
    "isn't it supposed to smelt",
    "I'm stuck on the loading screen",
  ]) {
    assert.strictEqual(hasBugKeyword(text), true, `expected a match for: ${text}`);
  }
});

test("hasBugKeyword does not match ordinary chat", () => {
  for (const text of [
    "hey everyone how is it going today",
    "just joined the server, love the mod",
    "what is the best way to farm diamonds",
    "gg that was a fun round",
  ]) {
    assert.strictEqual(hasBugKeyword(text), false, `unexpected match for: ${text}`);
  }
});

test("hasBugKeyword does not match keywords buried inside other words", () => {
  assert.strictEqual(hasBugKeyword("debugging is fun"), false);
  assert.strictEqual(hasBugKeyword("network is a tissue"), false);
});

test("keyword mode fires on a short report", () => {
  assert.strictEqual(shouldNudge("game crashes on load"), true);
});

test("keyword mode ignores a long message with no keyword", () => {
  assert.strictEqual(
    shouldNudge("hey guys I just joined this server today and I am having fun"),
    false
  );
});

test("keyword mode ignores empty or whitespace messages", () => {
  assert.strictEqual(shouldNudge(""), false);
  assert.strictEqual(shouldNudge("   "), false);
  assert.strictEqual(shouldNudge(null), false);
});

test("keyword-or-length mode also fires on any message over six words", () => {
  assert.strictEqual(
    shouldNudge("hey guys I just joined this server today", "keyword-or-length"),
    true
  );
});

test("keyword-or-length mode leaves messages of six words or fewer alone", () => {
  assert.strictEqual(shouldNudge("hey guys how is everyone doing", "keyword-or-length"), false);
});

test("an unknown mode falls back to keyword behaviour", () => {
  assert.strictEqual(shouldNudge("hey guys I just joined this server today", "nonsense"), false);
  assert.strictEqual(shouldNudge("it crashed", "nonsense"), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../utils/mcNudgeMatch'`

- [ ] **Step 3: Write the implementation**

Create `utils/mcNudgeMatch.js`:

```js
/**
 * Decides whether a chat message reads like a bug report, so the bot can point
 * a newly-joined modded player at the bug forum instead of letting the report
 * get lost in chat.
 */

// Word-bounded so "debugging" does not match "bug" and "tissue" does not
// match "issue".
const BUG_PATTERNS = [
  /\bbugs?\b/i,
  /\bissues?\b/i,
  /\bproblems?\b/i,
  /\bglitch(es|ing|ed)?\b/i,
  /\bbroke(n)?\b/i,
  /\bcrash(es|ing|ed)?\b/i,
  /\berrors?\b/i,
  /\bfail(s|ing|ed)?\b/i,
  /\bdoes\s*n['’]?t\s+work\b/i,
  /\bdoes\s+not\s+work\b/i,
  /\bnot\s+working\b/i,
  /\bwo?n['’]?t\s+(load|start|open|work|launch)\b/i,
  /\bsupposed\s+to\b/i,
  /\bstuck\b/i,
];

const LENGTH_THRESHOLD = 6;

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function hasBugKeyword(text) {
  const value = String(text || "");
  return BUG_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * @param {string} text - the message content
 * @param {"keyword"|"keyword-or-length"} mode - "keyword" (default) fires only
 *   on a bug keyword at any length. "keyword-or-length" additionally fires on
 *   any message longer than six words, which catches more but also greets.
 */
function shouldNudge(text, mode = "keyword") {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (hasBugKeyword(value)) return true;
  if (mode === "keyword-or-length") return countWords(value) > LENGTH_THRESHOLD;
  return false;
}

module.exports = { shouldNudge, hasBugKeyword, countWords, LENGTH_THRESHOLD };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/mcNudgeMatch.js tests/mcNudgeMatch.test.js
git commit -m "feat: add bug-report text matcher for forum nudge"
```

---

### Task 4: Webhook server (`api/mcDebugServer.js`)

The express server itself. Follows the shape of `api/mafiaWebhookServer.js` — a class with `setupMiddleware`, `setupRoutes`, `start(port)`, and `stop()` — with one deliberate difference: an unset secret rejects every request instead of disabling auth.

**Files:**

- Create: `api/mcDebugServer.js`
- Modify: `package.json` (add the `multer` dependency)

**Interfaces:**

- Consumes: everything exported by `utils/mcDebugReport.js` (Task 1) and `RateLimiter` from `utils/mcDebugRateLimit.js` (Task 2).
- Produces: `class McDebugServer` with constructor `(client)`, `start(port = 3004)`, and `stop()`. Exported as `module.exports = McDebugServer` (a bare class, matching `mafiaWebhookServer.js`).

- [ ] **Step 1: Install multer**

Run: `npm install multer@^2.0.0`

Multer 2.x keeps the 1.x API and drops the advisories that affected 1.x. Memory storage means uploads never touch disk.

- [ ] **Step 2: Verify the install**

Run: `node -e "console.log(require('multer/package.json').version)"`
Expected: a version starting with `2.`

- [ ] **Step 3: Write the server**

Create `api/mcDebugServer.js`:

```js
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const {
  AttachmentBuilder,
  ChannelFlags,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const {
  buildThreadTitle,
  buildLogTail,
  truncateLogs,
  validateReport,
  sanitizeFilename,
  getClientIp,
} = require("../utils/mcDebugReport");
const { RateLimiter } = require("../utils/mcDebugRateLimit");

const DEFAULT_FORUM_ID = "1527727915817762997";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** Constant-time string compare that tolerates differing lengths. */
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Pick a forum tag for the thread: the first tag that looks bug-related, or —
 * only when the forum requires a tag — the first available one, so creation
 * cannot fail for want of a tag.
 */
function pickTags(channel) {
  const tags = channel.availableTags || [];
  if (!tags.length) return undefined;

  const match = tags.find((tag) => /bug|debug|report/i.test(tag.name));
  if (match) return [match.id];
  if (channel.flags?.has?.(ChannelFlags.RequireTag)) return [tags[0].id];
  return undefined;
}

/**
 * Minecraft Debug Webhook API
 *
 * Receives in-game /debug reports from the Minecraft mod and opens a thread in
 * the Discord bug forum carrying the mod version, the player's description, the
 * logs, and up to three screenshots.
 */
class McDebugServer {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.secret = process.env.MC_DEBUG_WEBHOOK_SECRET || null;
    this.forumChannelId = process.env.MC_DEBUG_FORUM_CHANNEL_ID || DEFAULT_FORUM_ID;
    this.ipLimiter = new RateLimiter();
    this.userLimiter = new RateLimiter();

    if (!this.secret) {
      console.warn(
        "[MC Debug] MC_DEBUG_WEBHOOK_SECRET is not set — every report will be rejected with 503."
      );
    }

    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: 4, // 3 screenshots + an optional logs file
        fields: 10,
        // Matches fileSize so logs behave the same whether sent as a text field
        // or as a file: accepted up to 8 MB, then truncated to the last 1 MB.
        fieldSize: MAX_FILE_BYTES,
      },
    }).fields([
      { name: "screenshots", maxCount: 3 },
      { name: "logs", maxCount: 1 },
    ]);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use((req, res, next) => {
      console.log(`[MC Debug] ${req.method} ${req.path}`);
      next();
    });
  }

  requireAuth(req, res, next) {
    if (!this.secret) {
      return res.status(503).json({
        success: false,
        error: "The Minecraft debug endpoint is not configured on the bot.",
      });
    }

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token || !secretsMatch(token, this.secret)) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid or missing bearer token." });
    }
    return next();
  }

  setupRoutes() {
    this.app.get("/api/mcdebug/health", (req, res) => {
      res.json({
        success: true,
        service: "Minecraft Debug API",
        status: "online",
        botReady: this.client.ws.status === 0,
        configured: Boolean(this.secret),
        timestamp: new Date().toISOString(),
      });
    });

    this.app.post("/api/mcdebug/report", this.requireAuth.bind(this), (req, res) => {
      this.upload(req, res, (uploadError) => {
        if (uploadError) return this.handleUploadError(uploadError, res);

        this.handleReport(req, res).catch((error) => {
          console.error("[MC Debug] Unhandled report error:", error);
          if (!res.headersSent) {
            res.status(500).json({ success: false, error: "Internal error." });
          }
        });
      });
    });
  }

  handleUploadError(error, res) {
    console.warn(`[MC Debug] Upload rejected: ${error.code || error.message}`);

    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ success: false, error: "Each screenshot must be 8 MB or smaller." });
    }
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        error: "Send at most 3 files under the field name 'screenshots' and 1 under 'logs'.",
      });
    }
    if (error.code === "LIMIT_FIELD_VALUE") {
      return res.status(413).json({ success: false, error: "A text field was too large." });
    }
    return res.status(400).json({ success: false, error: "Malformed multipart upload." });
  }

  async handleReport(req, res) {
    const ip = getClientIp(req);
    const version = String(req.body.version || "").trim();
    const description = String(req.body.description || "").trim();
    const username = String(req.body.username || "").trim();
    const screenshots = req.files?.screenshots || [];
    const logsFile = (req.files?.logs || [])[0];
    const logs = logsFile ? logsFile.buffer.toString("utf8") : String(req.body.logs || "");

    const totalBytes = screenshots.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return res
        .status(413)
        .json({ success: false, error: "Screenshots exceed the 20 MB total limit." });
    }

    const validation = validateReport({ version, description, username, screenshots });
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, error: validation.error });
    }

    const now = Date.now();
    const userKey = username.toLowerCase();

    const ipCheck = this.ipLimiter.check(ip, now);
    if (!ipCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: "Too many reports from this address. Try again later.",
        retryAfter: ipCheck.retryAfter,
      });
    }

    const userCheck = this.userLimiter.check(userKey, now);
    if (!userCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: "Too many reports from this player. Try again later.",
        retryAfter: userCheck.retryAfter,
      });
    }

    if (this.client.ws.status !== 0) {
      return res.status(503).json({
        success: false,
        error: "The bot is not connected to Discord right now. Retry shortly.",
        retryAfter: 30,
      });
    }

    // Both keys passed, so consume both.
    this.ipLimiter.record(ip, now);
    this.userLimiter.record(userKey, now);

    try {
      const thread = await this.createThread({
        version,
        description,
        username,
        logs,
        screenshots,
      });
      console.log(`[MC Debug] Opened thread ${thread.id} for ${username || ip}`);
      return res.status(201).json({
        success: true,
        threadId: thread.id,
        url: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
      });
    } catch (error) {
      console.error("[MC Debug] Failed to create forum thread:", error);
      return res
        .status(error.status || 502)
        .json({ success: false, error: "Discord rejected the report." });
    }
  }

  async createThread({ version, description, username, logs, screenshots }) {
    const channel = await this.client.channels.fetch(this.forumChannelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      const error = new Error("MC_DEBUG_FORUM_CHANNEL_ID does not point at a forum channel");
      error.status = 502;
      throw error;
    }

    const { text: logText, truncated } = truncateLogs(logs);
    const tail = buildLogTail(logText);

    const embed = new EmbedBuilder()
      .setTitle("🐛 In-game bug report")
      .setColor(0xe67e22)
      .setDescription(description)
      .addFields({ name: "Mod version", value: `\`${version}\``, inline: true })
      .setTimestamp();

    if (username) embed.addFields({ name: "Reporter", value: username, inline: true });
    if (truncated) {
      embed.setFooter({ text: "Logs exceeded 1 MB — only the last 1 MB is attached." });
    }

    const logAttachments = logText
      ? [new AttachmentBuilder(Buffer.from(logText, "utf8"), { name: "logs.txt" })]
      : [];
    const imageAttachments = screenshots.map(
      (file, index) =>
        new AttachmentBuilder(file.buffer, {
          name: sanitizeFilename(file.originalname, `screenshot-${index + 1}.png`),
        })
    );

    const content = tail ? `**Last log lines**\n\`\`\`\n${tail}\n\`\`\`` : undefined;
    const appliedTags = pickTags(channel);
    const name = buildThreadTitle(version, description);

    try {
      return await channel.threads.create({
        name,
        message: { content, embeds: [embed], files: [...logAttachments, ...imageAttachments] },
        appliedTags,
        reason: "Minecraft in-game /debug report",
      });
    } catch (error) {
      if (!imageAttachments.length) throw error;

      // A partial report beats no report: drop the images and try once more.
      console.error(
        "[MC Debug] Thread creation failed with screenshots, retrying without them:",
        error.message
      );
      embed.addFields({
        name: "⚠️ Attachments",
        value: "Screenshots could not be uploaded and were dropped.",
      });
      return await channel.threads.create({
        name,
        message: { content, embeds: [embed], files: logAttachments },
        appliedTags,
        reason: "Minecraft in-game /debug report (screenshots dropped)",
      });
    }
  }

  start(port = 3004) {
    this.server = this.app.listen(port, () => {
      console.log(`[MC Debug] ✅ Minecraft Debug API listening on port ${port}`);
      console.log(`[MC Debug] Forum channel: ${this.forumChannelId}`);
    });

    this.server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`[MC Debug] ❌ Port ${port} is already in use.`);
      } else {
        console.error("[MC Debug] ❌ Server error:", error);
      }
    });

    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close(() => console.log("[MC Debug] Server stopped"));
    }
  }
}

module.exports = McDebugServer;
```

- [ ] **Step 4: Verify the module loads and the suite still passes**

Run: `node -e "require('./api/mcDebugServer'); console.log('loads ok')" && npm test`
Expected: `loads ok`, then all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/mcDebugServer.js package.json package-lock.json
git commit -m "feat: add Minecraft debug webhook server"
```

---

### Task 5: Wire the server into the bot (`index.js`, `.env.example`)

Route `/api/mcdebug/*` to port 3004, append the real client address to `X-Forwarded-For` so the rate limiter has something real to key on, start the server once Discord is ready, and stop it on shutdown.

**Files:**

- Modify: `index.js` (proxy routing ~line 313-338, startup ~line 436-450, shutdown ~line 512-540)
- Modify: `.env.example`

**Interfaces:**

- Consumes: `McDebugServer` from Task 4.
- Produces: a running server reachable at `POST /api/mcdebug/report` on the public port.

- [ ] **Step 1: Add the proxy route**

In `index.js`, find the settings routing block:

```js
  // Route /api/settings/* to the Settings API on port 3003
  if (req.url.startsWith("/api/settings")) {
    targetPort = process.env.SETTINGS_API_PORT || 3003;
    apiName = "Settings API";
  }
```

Add immediately after it:

```js
  // Route /api/mcdebug/* to the Minecraft Debug API on port 3004
  if (req.url.startsWith("/api/mcdebug")) {
    targetPort = process.env.MC_DEBUG_API_PORT || 3004;
    apiName = "MC Debug API";
  }
```

- [ ] **Step 2: Append the real client address to X-Forwarded-For**

Still in `index.js`, find the proxy options object:

```js
    const options = {
      hostname: "localhost",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };
```

Replace it with:

```js
    // Append the real remote address so internal APIs can rate limit by client.
    // A forging client can only PREPEND values, so ours stays last.
    const existingForwardedFor = req.headers["x-forwarded-for"];
    const remoteAddress = req.socket.remoteAddress || "";
    const options = {
      hostname: "localhost",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        "x-forwarded-for": existingForwardedFor
          ? `${existingForwardedFor}, ${remoteAddress}`
          : remoteAddress,
      },
    };
```

- [ ] **Step 3: Start the server when Discord is ready**

In `index.js`, after the Settings API startup block (the one ending with the `settingsServer.start(settingsPort)` try/catch), add:

```js
// Initialize Minecraft Debug API server on port 3004
let mcDebugServer = null;
if (process.env.MC_DEBUG_API_ENABLED !== "false") {
  const McDebugServer = require("./api/mcDebugServer");
  const mcDebugPort = process.env.MC_DEBUG_API_PORT || 3004;

  client.once("ready", () => {
    try {
      mcDebugServer = new McDebugServer(client);
      mcDebugServer.start(mcDebugPort);
    } catch (error) {
      console.error("Failed to start Minecraft Debug API:", error);
    }
  });
}
```

- [ ] **Step 4: Stop it on shutdown**

In `gracefulShutdown`, after the subscription server block:

```js
  // Stop subscription server
  if (subscriptionServer) {
```

...add a matching block once that `if` closes:

```js
  // Stop Minecraft debug server
  if (mcDebugServer) {
    try {
      mcDebugServer.stop();
      console.log("Minecraft debug server stopped");
    } catch (error) {
      console.error("Error stopping Minecraft debug server:", error);
    }
  }
```

- [ ] **Step 5: Document the environment variables**

Append to `.env.example`:

```dotenv

# Minecraft Debug Webhook (in-game /debug command)
MC_DEBUG_API_PORT=3004
MC_DEBUG_API_ENABLED=true
# Shared bearer token. The mod ships this, so treat it as a speed bump, not a
# real credential — rate limiting is what protects the forum. Unset = endpoint
# rejects everything with 503.
MC_DEBUG_WEBHOOK_SECRET=your_secure_random_secret_here
# Forum channel that receives the bug report threads
MC_DEBUG_FORUM_CHANNEL_ID=1527727915817762997

# Minecraft forum nudge (points new modded players at the bug forum)
MC_FORUM_GUILD_ID=701308904877064193
# Optional: exact role ids, comma-separated. Overrides matching by role name.
MC_NUDGE_ROLE_IDS=
# "keyword" (default) fires on a bug keyword at any length.
# "keyword-or-length" also fires on any message over 6 words.
MC_NUDGE_MODE=keyword
```

- [ ] **Step 6: Verify the wiring**

Run: `node --check index.js && npm test`
Expected: no syntax errors, all tests PASS.

Then confirm the route table by inspection: `/api/mcdebug/health` must map to `MC_DEBUG_API_PORT`, and the `x-forwarded-for` header must be built by appending, not overwriting.

- [ ] **Step 7: Commit**

```bash
git add index.js .env.example
git commit -m "feat: route and start the Minecraft debug API"
```

---

### Task 6: Chat nudge (`events/mcForumNudgeHandler.js`)

The message processor, the `User` field that makes "once ever" stick, and its registration on the central router.

**Files:**

- Create: `events/mcForumNudgeHandler.js`
- Modify: `database/models/User.js` (add `mcForumNudgedAt`)
- Modify: `events/handlerRegistry.js` (register the processor)

**Interfaces:**

- Consumes: `shouldNudge` from `utils/mcNudgeMatch.js` (Task 3).
- Produces: `module.exports = (client) => async function mcForumNudgeProcessor(message)` — a factory returning a processor with the `(message) => Promise<void>` shape that `commandRouter.registerMessageProcessor` expects.

- [ ] **Step 1: Add the persistence field**

In `database/models/User.js`, find the end of the activity-tracking fields:

```js
    lastDailyReset: {
        type: Date,
        default: Date.now
    },
```

Add immediately after it:

```js
    // One-time nudge pointing Minecraft players at the bug forum
    mcForumNudgedAt: {
        type: Date,
        default: null
    },
```

- [ ] **Step 2: Write the handler**

Create `events/mcForumNudgeHandler.js`:

```js
/**
 * Minecraft forum nudge
 *
 * When a newly-joined member holding the Minecraft or Craftics role describes a
 * bug in chat, reply once pointing them at the bug forum. Each member is nudged
 * at most once, ever — tracked by User.mcForumNudgedAt.
 *
 * Registered as a message processor on the centralized commandRouter, so it adds
 * no additional messageCreate listener.
 */

const { shouldNudge } = require("../utils/mcNudgeMatch");
const User = require("../database/models/User");

const DEFAULT_GUILD_ID = "701308904877064193";
const DEFAULT_FORUM_ID = "1527727915817762997";
const NEW_MEMBER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ROLE_NAMES = new Set(["minecraft", "craftics"]);

module.exports = (client) => {
  const guildId = process.env.MC_FORUM_GUILD_ID || DEFAULT_GUILD_ID;
  const forumId = process.env.MC_DEBUG_FORUM_CHANNEL_ID || DEFAULT_FORUM_ID;
  const roleIds = new Set(
    (process.env.MC_NUDGE_ROLE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const mode =
    process.env.MC_NUDGE_MODE === "keyword-or-length" ? "keyword-or-length" : "keyword";

  console.log(
    `[MC Nudge] Watching guild ${guildId} in "${mode}" mode, pointing at forum ${forumId}`
  );

  return async function mcForumNudgeProcessor(message) {
    try {
      // The forum only exists in one server, so scope hard rather than relying
      // on feature gating alone.
      if (message.guild?.id !== guildId) return;

      // Never nudge inside the forum itself — they already found it.
      if (message.channel.id === forumId) return;
      if (message.channel.isThread?.() && message.channel.parentId === forumId) return;

      const member = message.member;
      if (!member || !member.joinedTimestamp) return;
      if (Date.now() - member.joinedTimestamp > NEW_MEMBER_WINDOW_MS) return;

      const hasRole = roleIds.size
        ? member.roles.cache.some((role) => roleIds.has(role.id))
        : member.roles.cache.some((role) =>
            DEFAULT_ROLE_NAMES.has(role.name.trim().toLowerCase())
          );
      if (!hasRole) return;

      if (!shouldNudge(message.content, mode)) return;

      const userId = message.author.id;
      const existing = await User.findOne({ userId }).select("mcForumNudgedAt").lean();
      if (existing?.mcForumNudgedAt) return;

      await message.reply({
        content:
          `That sounds like a bug — please post it in <#${forumId}> so we can track it. ` +
          `Include your mod version, what happened, your logs, and screenshots if you have them.\n` +
          `Fastest option: run \`/debug\` in-game and it files the report for you.`,
        allowedMentions: { repliedUser: true },
      });

      await User.findOneAndUpdate(
        { userId },
        { $set: { mcForumNudgedAt: new Date() } },
        { upsert: true }
      );

      console.log(`[MC Nudge] Nudged ${message.author.tag} (${userId})`);
    } catch (error) {
      // Never throw: this processor shares the message router with every other
      // handler in the bot.
      console.error("[MC Nudge] processor error:", error);
    }
  };
};
```

- [ ] **Step 3: Register the processor**

In `events/handlerRegistry.js`, find the ask handler registration inside the MESSAGE PROCESSORS section:

```js
  // Ask handler - responds when messages contain "bobby" (includes AI chat + command suggestions)
  const askHandler = require("./askHandler");
  const askProcessor = createMessageProcessor(client, askHandler);
  if (askProcessor) {
    commandRouter.registerMessageProcessor(askProcessor, "ask");
  }
```

Add immediately after it:

```js
  // Minecraft forum nudge - points new modded players at the bug forum
  const mcForumNudgeHandler = require("./mcForumNudgeHandler");
  commandRouter.registerMessageProcessor(mcForumNudgeHandler(client), "mcForumNudge");
```

The `"mcForumNudge"` feature key is deliberately absent from `FREE_FEATURES` in `config/freeVersion.js`, so the router skips this processor on every server except full ones. No change to `freeVersion.js` is needed.

- [ ] **Step 4: Verify**

Run: `node --check events/mcForumNudgeHandler.js && node --check events/handlerRegistry.js && node --check database/models/User.js && npm test`
Expected: no syntax errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add events/mcForumNudgeHandler.js events/handlerRegistry.js database/models/User.js
git commit -m "feat: nudge new modded players toward the bug forum"
```

---

## Manual verification

The Discord API calls are not unit tested. After deploying, verify by hand:

1. **Health:** `curl https://<host>/api/mcdebug/health` returns `{"success":true,...,"botReady":true}`.
2. **Auth:** posting without a bearer token returns `401`; with the right token it proceeds.
3. **Happy path:**

   ```bash
   curl -X POST https://<host>/api/mcdebug/report \
     -H "Authorization: Bearer $MC_DEBUG_WEBHOOK_SECRET" \
     -F "version=1.2.3" \
     -F "description=Game crashes when opening the crafting table" \
     -F "username=Steve" \
     -F "logs=@latest.log" \
     -F "screenshots=@shot1.png" \
     -F "screenshots=@shot2.png"
   ```

   Expect `201` with a `url`, and a thread in the forum whose title starts `[v1.2.3]`, whose first message shows the log tail in a code block, and which carries `logs.txt` plus both images.

4. **Rate limit:** a fourth report inside 10 minutes returns `429` with `retryAfter`.
5. **Nudge:** with a test account that joined recently and holds the Minecraft role, post "the mod crashed on load" in a normal channel. Expect one reply. Post another bug message — expect no second reply.
6. **Nudge scoping:** post the same text from an account that joined more than 7 days ago, and from one without the role. Expect no reply in either case.
