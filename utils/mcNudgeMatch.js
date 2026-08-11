/**
 * Decides whether a chat message reads like a bug report, so the bot can point
 * a newly-joined modded player at the bug forum instead of letting the report
 * get lost in chat.
 *
 * Uses a two-tier keyword system:
 * - STRONG patterns fire on their own (these words only mean "broken")
 * - LOOSE patterns fire ONLY when a game noun is also present
 */

// STRONG patterns: fire on their own, unambiguous bug indicators
const STRONG_PATTERNS = [
  /\bbugs?\b/i,
  /\bglitch(es|ing|ed)?\b/i,
  /\bcrash(es|ing|ed|s)?\b/i,
  /\berrors?\b/i,
  /\bfail(s|ing|ed)?\b/i,
  /\bdoes\s*n['’]?t\s+work\b/i,
  /\bdoes\s+not\s+work\b/i,
  /\bwo?n['’]?t\s+(load|start|open|work|launch|connect|join|install)\b/i,
  /\bnot\s+loading\b/i,
  /\bblack\s+screen\b/i,
  /\binfinite\s+loading\b/i,
  /\bkicked\s+me\s+out\b/i,
  /\bnothing\s+happens\b/i,
];

// LOOSE patterns: only fire when a game noun is also present
const LOOSE_PATTERNS = [
  /\bissues?\b/i,
  /\bproblems?\b/i,
  /\bbroke(n)?\b/i,
  /\bnot\s+working\b/i,
  /\bsupposed\s+to\b/i,
  /\bstuck\b/i,
];

// Game nouns: trigger loose pattern matching
// Word-bounded, case-insensitive, singular and plural where natural
const GAME_NOUNS_PATTERN = /\b(mod|mods|modpack|modpacks|server|servers|world|worlds|client|launcher|texture|textures|recipe|recipes|block|blocks|item|items|screen)\b/i;

const LENGTH_THRESHOLD = 6;

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Returns true if the message contains a strong bug keyword OR
 * (a loose bug keyword AND a game noun).
 */
function hasBugKeyword(text) {
  const value = String(text || "");

  // Check strong patterns first
  if (STRONG_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  // Check loose patterns — only fire if a game noun is also present
  if (LOOSE_PATTERNS.some((pattern) => pattern.test(value))) {
    return GAME_NOUNS_PATTERN.test(value);
  }

  return false;
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
