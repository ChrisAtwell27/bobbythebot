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
 * Snaps to UTF-8 character boundaries to avoid corruption.
 */
function truncateLogs(logs) {
  const text = String(logs || "");
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_LOG_BYTES) return { text, truncated: false };

  // Start from where we'd cut
  let cutOffset = buf.length - MAX_LOG_BYTES;

  // Scan forward to find a valid UTF-8 character boundary.
  // UTF-8 continuation bytes have pattern 10xxxxxx (0x80-0xBF).
  // Skip past any continuation bytes to find the next character start.
  while (cutOffset < buf.length) {
    const byte = buf[cutOffset];
    // If not a continuation byte, we're at a character boundary
    if ((byte & 0xC0) !== 0x80) break;
    cutOffset++;
  }

  const decodedText = buf.subarray(cutOffset).toString("utf8");
  return { text: decodedText, truncated: true };
}

function validateReport({ version, description, username, screenshots } = {}) {
  // Normalize screenshots: null/undefined becomes empty array
  const files = Array.isArray(screenshots) ? screenshots : [];

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
  if (files.length > MAX_SCREENSHOTS) {
    return { ok: false, status: 400, error: `at most ${MAX_SCREENSHOTS} screenshots are allowed` };
  }
  for (const file of files) {
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
  // Guard fallback: null/undefined becomes default
  if (!fallback || typeof fallback !== "string") {
    fallback = "screenshot.png";
  }

  const base = String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-]/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 64);
  return /[a-zA-Z0-9]/.test(base) ? base : fallback;
}

/**
 * Every request reaches this server through the proxy in index.js, which resolves
 * the real client address ONCE (at the App Platform ingress edge) and hands it
 * down on a dedicated `x-mc-client-ip` header that it always overwrites — a
 * caller cannot forge it. We therefore read ONLY that header. We deliberately do
 * NOT read x-forwarded-for here: it is passed through unmodified from whatever
 * the caller/ingress sent, so trusting it directly would let a caller set their
 * own rate-limit key. Falls back to the socket address (direct connections,
 * local dev without the proxy in front), and finally to "unknown".
 */
function getClientIp(req) {
  const header = req.headers?.["x-mc-client-ip"];
  const trimmed = header ? String(header).trim() : "";
  if (trimmed) return trimmed;
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
