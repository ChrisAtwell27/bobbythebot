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
