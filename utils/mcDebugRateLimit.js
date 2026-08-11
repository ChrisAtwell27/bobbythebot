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
