import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get wordle scores for a user
 */
export const getUserScores = query({
  args: { guildId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const userScore = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) =>
        q.eq("guildId", args.guildId).eq("userId", args.userId)
      )
      .first();
    return userScore;
  },
});

/**
 * Get all wordle scores for a guild
 */
export const getAllScores = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const scores = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) => q.eq("guildId", args.guildId))
      .collect();
    return scores;
  },
});

/**
 * Get wordle leaderboard
 */
export const getLeaderboard = query({
  args: { guildId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const scores = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_games", (q) => q.eq("guildId", args.guildId))
      .order("desc")
      .take(limit);
    return scores;
  },
});

/**
 * Get raw wordle scores across all servers that opted into the global leaderboard
 * (settings.wordleScope === 'global'). The bot aggregates these per-user.
 */
export const getGlobalScores = query({
  args: {},
  handler: async (ctx) => {
    // Find all servers and keep only those opted into the global scope.
    const servers = await ctx.db.query("servers").collect();
    const globalGuildIds = servers
      .filter((s) => s.settings && s.settings.wordleScope === "global")
      .map((s) => s.guildId);

    if (globalGuildIds.length === 0) return [];

    // Collect every wordleScores row for those guilds.
    const allScores = [];
    for (const guildId of globalGuildIds) {
      const rows = await ctx.db
        .query("wordleScores")
        .withIndex("by_guild_and_user", (q) => q.eq("guildId", guildId))
        .collect();
      allScores.push(...rows);
    }
    return allScores;
  },
});

/**
 * Get monthly winner
 */
export const getMonthlyWinner = query({
  args: { guildId: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    const winner = await ctx.db
      .query("wordleMonthlyWinners")
      .withIndex("by_guild_and_month", (q) =>
        q.eq("guildId", args.guildId).eq("month", args.month)
      )
      .first();
    return winner;
  },
});

/**
 * Get all monthly winners for a guild
 */
export const getAllMonthlyWinners = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const winners = await ctx.db
      .query("wordleMonthlyWinners")
      .withIndex("by_guild_and_month", (q) => q.eq("guildId", args.guildId))
      .order("desc")
      .collect();
    return winners;
  },
});

/**
 * Get yearly winner
 */
export const getYearlyWinner = query({
  args: { guildId: v.string(), year: v.string() },
  handler: async (ctx, args) => {
    const winner = await ctx.db
      .query("wordleYearlyWinners")
      .withIndex("by_guild_and_year", (q) =>
        q.eq("guildId", args.guildId).eq("year", args.year)
      )
      .first();
    return winner;
  },
});

/**
 * Get all yearly winners for a guild
 */
export const getAllYearlyWinners = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const winners = await ctx.db
      .query("wordleYearlyWinners")
      .withIndex("by_guild_and_year", (q) => q.eq("guildId", args.guildId))
      .order("desc")
      .collect();
    return winners;
  },
});

/**
 * Get users who played exactly 2 days ago but haven't played since
 * Used for sending reminders to inactive players
 */
export const getInactiveUsers = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000; // 48 hours ago
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000; // 72 hours ago

    // Get all users in this guild
    const allUsers = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) => q.eq("guildId", args.guildId))
      .collect();

    // Filter to users whose last play was between 48-72 hours ago
    const inactiveUsers = allUsers.filter((user) => {
      if (user.scores.length === 0) return false;

      // Find the most recent score timestamp
      const lastPlayTimestamp = Math.max(...user.scores.map((s) => s.timestamp));

      // Check if last play was between 48 and 72 hours ago
      return lastPlayTimestamp <= twoDaysAgo && lastPlayTimestamp > threeDaysAgo;
    });

    return inactiveUsers.map((user) => ({
      userId: user.userId,
      lastPlayTimestamp: Math.max(...user.scores.map((s) => s.timestamp)),
      totalGames: user.totalGames,
    }));
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Add a wordle score
 */
export const addScore = mutation({
  args: {
    guildId: v.string(),
    userId: v.string(),
    score: v.number(),
    honeyAwarded: v.number(),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) =>
        q.eq("guildId", args.guildId).eq("userId", args.userId)
      )
      .first();

    const now = Date.now();
    const scoreTimestamp = args.timestamp || now;
    const newScore = {
      score: args.score,
      timestamp: scoreTimestamp,
      honeyAwarded: args.honeyAwarded,
    };

    if (existing) {
      // Check for duplicate: same day (within 24 hours) with same score
      // This prevents duplicate entries from backfills or reprocessing
      const oneDayMs = 24 * 60 * 60 * 1000;
      const isDuplicate = existing.scores.some((s) => {
        const timeDiff = Math.abs(s.timestamp - scoreTimestamp);
        return timeDiff < oneDayMs && s.score === args.score;
      });

      if (isDuplicate) {
        // Return existing ID without adding duplicate
        return existing._id;
      }

      const updatedScores = [...existing.scores, newScore];
      const updatedTotalGames = existing.totalGames + 1;
      const updatedTotalHoney = existing.totalHoney + args.honeyAwarded;

      await ctx.db.patch(existing._id, {
        scores: updatedScores,
        totalGames: updatedTotalGames,
        totalHoney: updatedTotalHoney,
        updatedAt: now,
      });
      return existing._id;
    } else {
      const newUserScore = await ctx.db.insert("wordleScores", {
        guildId: args.guildId,
        userId: args.userId,
        scores: [newScore],
        totalGames: 1,
        totalHoney: args.honeyAwarded,
        createdAt: now,
        updatedAt: now,
      });
      return newUserScore;
    }
  },
});

/**
 * Clear all scores for a guild
 */
export const clearAllScores = mutation({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const scores = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) => q.eq("guildId", args.guildId))
      .collect();

    for (const score of scores) {
      await ctx.db.delete(score._id);
    }

    return scores.length;
  },
});

/**
 * Remove duplicate scores from a user's wordle record
 * Keeps only one score per day (based on timestamp within 24 hours and same score)
 */
export const deduplicateScores = mutation({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const allScores = await ctx.db
      .query("wordleScores")
      .withIndex("by_guild_and_user", (q) => q.eq("guildId", args.guildId))
      .collect();

    let totalRemoved = 0;
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const userScore of allScores) {
      const uniqueScores: typeof userScore.scores = [];

      for (const score of userScore.scores) {
        // Check if this score is a duplicate of any already-added score
        const isDuplicate = uniqueScores.some((s) => {
          const timeDiff = Math.abs(s.timestamp - score.timestamp);
          return timeDiff < oneDayMs && s.score === score.score;
        });

        if (!isDuplicate) {
          uniqueScores.push(score);
        }
      }

      const removedCount = userScore.scores.length - uniqueScores.length;
      if (removedCount > 0) {
        totalRemoved += removedCount;
        await ctx.db.patch(userScore._id, {
          scores: uniqueScores,
          totalGames: uniqueScores.length,
          updatedAt: Date.now(),
        });
      }
    }

    return { totalRemoved, usersProcessed: allScores.length };
  },
});

/**
 * Save monthly winner
 */
export const saveMonthlyWinner = mutation({
  args: {
    guildId: v.string(),
    month: v.string(),
    winner: v.any(),
    topTen: v.array(v.any()),
    totalPlayers: v.number(),
    totalGamesPlayed: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wordleMonthlyWinners")
      .withIndex("by_guild_and_month", (q) =>
        q.eq("guildId", args.guildId).eq("month", args.month)
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        winner: args.winner,
        topTen: args.topTen,
        totalPlayers: args.totalPlayers,
        totalGamesPlayed: args.totalGamesPlayed,
        announcedAt: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      const newWinner = await ctx.db.insert("wordleMonthlyWinners", {
        guildId: args.guildId,
        month: args.month,
        winner: args.winner,
        topTen: args.topTen,
        totalPlayers: args.totalPlayers,
        totalGamesPlayed: args.totalGamesPlayed,
        announcedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return newWinner;
    }
  },
});

/**
 * Save yearly winner
 */
export const saveYearlyWinner = mutation({
  args: {
    guildId: v.string(),
    year: v.string(),
    winner: v.any(),
    topTen: v.array(v.any()),
    totalPlayers: v.number(),
    totalGamesPlayed: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wordleYearlyWinners")
      .withIndex("by_guild_and_year", (q) =>
        q.eq("guildId", args.guildId).eq("year", args.year)
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        winner: args.winner,
        topTen: args.topTen,
        totalPlayers: args.totalPlayers,
        totalGamesPlayed: args.totalGamesPlayed,
        announcedAt: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      const newWinner = await ctx.db.insert("wordleYearlyWinners", {
        guildId: args.guildId,
        year: args.year,
        winner: args.winner,
        topTen: args.topTen,
        totalPlayers: args.totalPlayers,
        totalGamesPlayed: args.totalGamesPlayed,
        announcedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return newWinner;
    }
  },
});
