import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex Schema for BobbyTheBot
 *
 * Data Partitioning Strategy:
 * - All guilds share the same tables (users, bounties, etc.)
 * - Data is partitioned by 'guildId' field
 * - Compound indexes ensure fast queries per guild
 * - Same approach as MongoDB, but with TypeScript type safety
 *
 * Example:
 * - Guild A and Guild B both use the 'users' table
 * - Queries filter by guildId: { guildId: '123', userId: 'user1' }
 * - Indexes make these queries fast even with millions of records
 */

export default defineSchema({
  // ============================================================================
  // USER TABLE
  // ============================================================================
  users: defineTable({
    guildId: v.string(),
    userId: v.string(),

    // Conversation memory
    memory: v.optional(v.string()),
    personalityScore: v.optional(v.number()),

    // Economy
    balance: v.number(),

    // Activity tracking
    messageCount: v.optional(v.number()),
    lastActive: v.optional(v.number()),
    dailyMessageCount: v.optional(v.number()),
    lastDailyReset: v.optional(v.number()),

    // Virtual Pet (legacy - no longer used, kept for migration compatibility)
    pet: v.optional(v.any()),

    // Birthday
    birthday: v.optional(v.object({
      month: v.number(),
      day: v.number(),
      year: v.optional(v.number()),
      lastBirthdayWish: v.optional(v.number()),
    })),

    // Valorant (legacy - may have incomplete data, kept for migration compatibility)
    valorant: v.optional(v.any()),

    // Gladiator Arena (legacy - kept for migration compatibility)
    gladiatorStats: v.optional(v.any()),

    // Mafia Game (legacy - kept for migration compatibility)
    mafiaStats: v.optional(v.any()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild_and_user", ["guildId", "userId"])
    .index("by_guild_and_balance", ["guildId", "balance"])
    .index("by_guild_and_messages", ["guildId", "dailyMessageCount"]),

  // ============================================================================
  // BOUNTY TABLE
  // ============================================================================
  bounties: defineTable({
    guildId: v.string(),
    bountyId: v.string(),
    creatorId: v.string(),
    creatorName: v.string(),
    description: v.string(),
    reward: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("claimed"),
      v.literal("expired"),
      v.literal("cancelled")
    ),
    claimedBy: v.optional(v.string()),
    claimedByName: v.optional(v.string()),
    proofUrl: v.optional(v.string()),
    channelId: v.string(),
    messageId: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_guild_and_status", ["guildId", "status"])
    .index("by_status", ["status"])
    .index("by_guild_and_expiry", ["guildId", "expiresAt"])
    .index("by_bounty_id", ["bountyId"])
    .index("by_guild_creator", ["guildId", "creatorId"]),

  // ============================================================================
  // CHALLENGE TABLE
  // ============================================================================
  challenges: defineTable({
    guildId: v.string(),
    challengeId: v.string(),
    type: v.union(
      v.literal("rps"),
      v.literal("highercard"),
      v.literal("quickdraw"),
      v.literal("numberduel"),
      v.literal("gladiator")
    ),
    creator: v.string(),
    creatorName: v.string(),
    challenged: v.optional(v.string()),
    challengedName: v.optional(v.string()),
    amount: v.number(),
    channelId: v.string(),

    // Gladiator specific
    gladiatorClass: v.optional(v.string()),
    challengerAvatarURL: v.optional(v.string()),
    challengedAvatarURL: v.optional(v.string()),

    createdAt: v.number(),
    expiresAt: v.number(), // For TTL cleanup
  })
    .index("by_challenge_id", ["challengeId"])
    .index("by_guild", ["guildId"])
    .index("by_expiry", ["expiresAt"]),

  // ============================================================================
  // TEAM HISTORY TABLE
  // ============================================================================
  teamHistories: defineTable({
    guildId: v.string(),
    teamId: v.string(),
    leaderId: v.string(),
    leaderName: v.string(),
    memberIds: v.array(v.string()),
    memberNames: v.array(v.string()),
    channelId: v.string(),
    createdAt: v.number(),
    completedAt: v.number(),
    status: v.union(
      v.literal("completed"),
      v.literal("disbanded"),
      v.literal("timeout")
    ),
    matchResult: v.optional(v.union(
      v.literal("win"),
      v.literal("loss"),
      v.literal("pending"),
      v.null()
    )),
    matchScore: v.optional(v.string()),
    reportedBy: v.optional(v.string()),
    reportedAt: v.optional(v.number()),

    stats: v.optional(v.object({
      maxMembers: v.optional(v.number()),
      totalJoins: v.optional(v.number()),
      totalLeaves: v.optional(v.number()),
      durationMinutes: v.optional(v.number()),
    })),
  })
    .index("by_guild_and_created", ["guildId", "createdAt"])
    .index("by_guild_and_leader", ["guildId", "leaderId"])
    .index("by_team_id", ["teamId"]),

  // ============================================================================
  // TRIVIA SESSION TABLE
  // ============================================================================
  triviaSessions: defineTable({
    guildId: v.string(),
    sessionToken: v.optional(v.string()),
    lastUsed: v.number(),

    activeQuestion: v.optional(v.object({
      question: v.string(),
      correctAnswer: v.string(),
      incorrectAnswers: v.array(v.string()),
      allAnswers: v.array(v.string()),
      difficulty: v.string(),
      category: v.string(),
      postedAt: v.number(),
      messageId: v.optional(v.string()),
      answered: v.boolean(),
      answeredAt: v.optional(v.number()),
    })),

    questionHistory: v.array(v.string()),
    totalQuestions: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild", ["guildId"]),

  // ============================================================================
  // WORDLE SCORE TABLE
  // ============================================================================
  wordleScores: defineTable({
    guildId: v.string(),
    userId: v.string(),

    scores: v.array(v.object({
      score: v.number(),
      timestamp: v.number(),
      honeyAwarded: v.number(),
    })),

    totalGames: v.number(),
    totalHoney: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild_and_user", ["guildId", "userId"])
    .index("by_guild_and_games", ["guildId", "totalGames"]),

  // ============================================================================
  // WORDLE MONTHLY WINNER TABLE
  // ============================================================================
  wordleMonthlyWinners: defineTable({
    guildId: v.string(),
    month: v.string(), // Format: "YYYY-MM"

    winner: v.object({
      userId: v.string(),
      username: v.string(),
      stats: v.object({
        totalGames: v.number(),
        avgScore: v.number(),
        bestScore: v.number(),
        weightedScore: v.number(),
        totalHoney: v.number(),
      }),
    }),

    topTen: v.array(v.object({
      userId: v.string(),
      username: v.string(),
      totalGames: v.number(),
      avgScore: v.number(),
      bestScore: v.number(),
      weightedScore: v.number(),
      totalHoney: v.number(),
      position: v.number(),
    })),

    announcedAt: v.optional(v.number()),
    totalPlayers: v.number(),
    totalGamesPlayed: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild_and_month", ["guildId", "month"]),

  // ============================================================================
  // WORDLE YEARLY WINNER TABLE
  // ============================================================================
  wordleYearlyWinners: defineTable({
    guildId: v.string(),
    year: v.string(), // Format: "YYYY"

    winner: v.object({
      userId: v.string(),
      username: v.string(),
      stats: v.object({
        totalGames: v.number(),
        avgScore: v.number(),
        bestScore: v.number(),
        weightedScore: v.number(),
        totalHoney: v.number(),
      }),
    }),

    topTen: v.array(v.object({
      userId: v.string(),
      username: v.string(),
      totalGames: v.number(),
      avgScore: v.number(),
      bestScore: v.number(),
      weightedScore: v.number(),
      totalHoney: v.number(),
      position: v.number(),
    })),

    announcedAt: v.optional(v.number()),
    totalPlayers: v.number(),
    totalGamesPlayed: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild_and_year", ["guildId", "year"]),

  // ============================================================================
  // SHOP ITEMS TABLE
  // ============================================================================
  shopItems: defineTable({
    guildId: v.string(),
    itemId: v.string(), // Unique identifier for the item
    title: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()), // null = unlimited
    maxPerUser: v.optional(v.number()), // null = unlimited
    enabled: v.boolean(),
    roleReward: v.optional(v.string()), // Role ID to give on purchase
    messageId: v.optional(v.string()), // Discord message ID for the shop embed
    sortOrder: v.number(), // For ordering items in the shop
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild", ["guildId"])
    .index("by_guild_and_item", ["guildId", "itemId"])
    .index("by_guild_and_enabled", ["guildId", "enabled"])
    .index("by_guild_and_order", ["guildId", "sortOrder"]),

  // ============================================================================
  // SHOP PURCHASES TABLE
  // ============================================================================
  shopPurchases: defineTable({
    guildId: v.string(),
    itemId: v.string(),
    userId: v.string(),
    username: v.string(),
    price: v.number(), // Price at time of purchase
    itemTitle: v.string(), // Title at time of purchase
    purchasedAt: v.number(),
    notified: v.boolean(), // Whether admin notification was sent
  })
    .index("by_guild", ["guildId"])
    .index("by_guild_and_item", ["guildId", "itemId"])
    .index("by_guild_and_user", ["guildId", "userId"])
    .index("by_guild_item_user", ["guildId", "itemId", "userId"]),

  // ============================================================================
  // SERVER TABLE (Guild-wide settings)
  // ============================================================================
  servers: defineTable({
    guildId: v.string(),
    houseBalance: v.number(),
    lastVotingDate: v.optional(v.number()),
    settings: v.optional(v.record(v.string(), v.any())),
    tier: v.optional(v.string()), // "free", "basic", "premium", "enterprise"

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild", ["guildId"]),

  // ============================================================================
  // BETTING POOLS TABLE (Admin-created bets)
  // ============================================================================
  bets: defineTable({
    guildId: v.string(),
    betId: v.string(), // Unique ID (e.g., "bet_abc123")
    title: v.string(), // "Who wins tonight's game?"
    description: v.optional(v.string()), // Optional details
    options: v.array(v.object({
      id: v.string(), // "a", "b", "c", etc.
      label: v.string(), // "Team A", "Team B"
      totalWagered: v.number(), // Running total for this option
    })),
    creatorId: v.string(),
    creatorName: v.string(),
    channelId: v.string(),
    messageId: v.optional(v.string()), // Main embed message ID
    status: v.union(
      v.literal("open"), // Accepting bets
      v.literal("locked"), // No more bets, awaiting result
      v.literal("resolved"), // Winner selected, payouts done
      v.literal("cancelled") // Refunded
    ),
    winningOption: v.optional(v.string()), // Option ID that won
    totalPool: v.number(), // Total wagered across all options
    houseCut: v.number(), // 5% of pool (calculated on resolve)
    createdAt: v.number(),
    lockedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_guild", ["guildId"])
    .index("by_guild_and_status", ["guildId", "status"])
    .index("by_bet_id", ["guildId", "betId"]),

  // ============================================================================
  // BET ENTRIES TABLE (User wagers)
  // ============================================================================
  betEntries: defineTable({
    guildId: v.string(),
    betId: v.string(),
    oddsAtEntry: v.optional(v.number()), // Potential payout multiplier at time of bet
    userId: v.string(),
    username: v.string(),
    optionId: v.string(), // Which option they bet on
    amount: v.number(), // How much they wagered
    payout: v.optional(v.number()), // Filled when resolved
    createdAt: v.number(),
  })
    .index("by_bet", ["guildId", "betId"])
    .index("by_bet_and_user", ["guildId", "betId", "userId"])
    .index("by_user", ["guildId", "userId"]),

  // ============================================================================
  // SUBSCRIPTION TABLE (Global - not per-guild)
  // ============================================================================
  subscriptions: defineTable({
    discordId: v.string(),
    discordUsername: v.optional(v.string()),
    discordAvatar: v.optional(v.string()),
    tier: v.union(
      v.literal("free"),
      v.literal("plus"),
      v.literal("ultimate")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("cancelled"),
      v.literal("pending")
    ),
    botVerified: v.boolean(),

    verifiedGuilds: v.array(v.object({
      guildId: v.string(),
      guildName: v.string(),
      verifiedAt: v.number(),
      // Per-guild subscription data
      tier: v.optional(v.union(
        v.literal("free"),
        v.literal("plus"),
        v.literal("ultimate")
      )),
      status: v.optional(v.union(
        v.literal("active"),
        v.literal("expired"),
        v.literal("cancelled"),
        v.literal("pending"),
        v.literal("trial")
      )),
      expiresAt: v.optional(v.number()),
      subscribedAt: v.optional(v.number()),
      trialEndsAt: v.optional(v.number()),
    })),

    lastVerificationCheck: v.optional(v.number()),
    subscribedAt: v.number(),
    expiresAt: v.optional(v.number()),
    paymentReference: v.optional(v.string()),
    features: v.array(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_discord_id", ["discordId"])
    .index("by_status", ["status"])
    .index("by_tier", ["tier"]),

  // ============================================================================
  // TOURNAMENT TABLE
  // ============================================================================
  tournaments: defineTable({
    guildId: v.string(),
    tournamentId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),

    // Configuration
    type: v.union(
      v.literal("single_elim"),
      v.literal("double_elim"),
      v.literal("round_robin")
    ),
    teamSize: v.number(), // 1 = 1v1, 2 = 2v2, etc.
    maxParticipants: v.optional(v.number()), // null = unlimited

    // Timing
    startTime: v.number(), // Unix timestamp
    registrationCloseTime: v.number(), // startTime - 15 min

    // State
    status: v.union(
      v.literal("open"),      // Registration open
      v.literal("closed"),    // Registration closed, waiting to start
      v.literal("active"),    // Tournament in progress
      v.literal("completed"), // Tournament finished
      v.literal("cancelled")  // Tournament cancelled
    ),
    currentRound: v.number(),

    // Discord references
    channelId: v.string(),
    mainMessageId: v.optional(v.string()),
    bracketMessageId: v.optional(v.string()),

    // Organizer
    creatorId: v.string(),
    creatorName: v.string(),

    // Results
    winnerId: v.optional(v.string()), // Winner participant/team ID
    winnerName: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild", ["guildId"])
    .index("by_guild_and_status", ["guildId", "status"])
    .index("by_tournament_id", ["guildId", "tournamentId"]),

  // ============================================================================
  // TOURNAMENT PARTICIPANTS TABLE
  // ============================================================================
  tournamentParticipants: defineTable({
    guildId: v.string(),
    tournamentId: v.string(),

    participantId: v.string(), // Unique ID for this participant/team

    // For 1v1: single user
    // For team: team captain + members
    userId: v.string(), // Captain or solo player
    username: v.string(),
    teamName: v.optional(v.string()), // For team tournaments
    teamMembers: v.optional(v.array(v.object({
      userId: v.string(),
      username: v.string(),
    }))),

    // Seeding
    seed: v.optional(v.number()),

    // Stats for this tournament
    wins: v.number(),
    losses: v.number(),

    // Status
    eliminated: v.boolean(),

    joinedAt: v.number(),
  })
    .index("by_tournament", ["guildId", "tournamentId"])
    .index("by_tournament_and_user", ["guildId", "tournamentId", "userId"])
    .index("by_participant_id", ["guildId", "tournamentId", "participantId"]),

  // ============================================================================
  // TOURNAMENT MATCHES TABLE
  // ============================================================================
  tournamentMatches: defineTable({
    guildId: v.string(),
    tournamentId: v.string(),
    matchId: v.string(),

    // Bracket position
    round: v.number(), // 1, 2, 3... (for double elim: negative = losers bracket)
    matchNumber: v.number(), // Position within round
    bracketType: v.union(
      v.literal("winners"),
      v.literal("losers"),
      v.literal("grand_finals"),
      v.literal("round_robin")
    ),

    // Participants
    participant1Id: v.optional(v.string()), // null = TBD (waiting for previous match)
    participant1Name: v.optional(v.string()),
    participant2Id: v.optional(v.string()),
    participant2Name: v.optional(v.string()),

    // Result
    winnerId: v.optional(v.string()),
    winnerName: v.optional(v.string()),
    score: v.optional(v.string()), // e.g., "13-7" or "2-1"

    // Status
    status: v.union(
      v.literal("pending"),    // Waiting for participants
      v.literal("ready"),      // Both participants known
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("bye")         // One participant auto-advances
    ),

    // Discord thread
    threadId: v.optional(v.string()),
    threadMessageId: v.optional(v.string()),

    // For progression
    nextMatchId: v.optional(v.string()), // Winner goes here
    nextMatchSlot: v.optional(v.number()), // 1 or 2 (which slot in next match)
    loserNextMatchId: v.optional(v.string()), // For double elim losers bracket

    // Reporting
    reportedBy: v.optional(v.string()),
    reportedWinnerId: v.optional(v.string()),
    reportedAt: v.optional(v.number()),
    confirmedBy: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournament", ["guildId", "tournamentId"])
    .index("by_match_id", ["guildId", "tournamentId", "matchId"])
    .index("by_tournament_and_round", ["guildId", "tournamentId", "round"])
    .index("by_tournament_and_status", ["guildId", "tournamentId", "status"]),

  // ============================================================================
  // CRAFTLE PUZZLES TABLE
  // ============================================================================
  craftlePuzzles: defineTable({
    puzzleId: v.string(), // Format: "craftle-YYYY-MM-DD"
    date: v.string(), // "2025-12-19"

    recipe: v.object({
      id: v.string(),
      output: v.string(),
      outputCount: v.number(),
      grid: v.array(v.array(v.union(v.string(), v.null()))), // 3x3 array of item IDs or null
      category: v.string(),
      difficulty: v.union(v.literal("easy"), v.literal("medium"), v.literal("hard")),
      description: v.string(),
    }),

    metadata: v.object({
      difficulty: v.union(v.literal("easy"), v.literal("medium"), v.literal("hard")),
      category: v.string(),
      commonItems: v.optional(v.array(v.string())), // Legacy field - Items that appear in recipe
      recipeItems: v.optional(v.array(v.string())), // Items required for the recipe
      dailyItems: v.optional(v.array(v.string())), // Random items available for today's puzzle
    }),

    stats: v.object({
      totalAttempts: v.number(), // How many users attempted
      totalSolved: v.number(), // How many users solved
      averageAttempts: v.number(), // Avg attempts to solve
      solveRate: v.number(), // % of users who solved
    }),

    createdAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_puzzle_id", ["puzzleId"]),

  // ============================================================================
  // CRAFTLE USER PROGRESS TABLE
  // ============================================================================
  craftleUserProgress: defineTable({
    guildId: v.string(),
    userId: v.string(),
    puzzleId: v.string(), // Which puzzle
    date: v.string(), // "2025-12-19"

    attempts: v.number(), // How many guesses made (max 6)
    solved: v.boolean(), // Did they solve it?
    guesses: v.array(
      v.object({
        grid: v.array(v.array(v.union(v.string(), v.null()))), // 3x3 array of item IDs
        feedback: v.array(
          v.array(
            v.union(
              v.literal("correct"),
              v.literal("wrong_position"),
              v.literal("not_in_recipe"),
              v.literal("missing"), // Empty cell where item should be
              v.null()
            )
          )
        ), // 3x3 array of feedback
        timestamp: v.number(),
      })
    ),

    solveTime: v.optional(v.number()), // Milliseconds to solve
    completedAt: v.optional(v.number()), // Unix timestamp when solved/failed
    rewardGiven: v.boolean(), // Currency awarded?
    rewardAmount: v.optional(v.number()), // How much currency awarded

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_and_puzzle", ["userId", "puzzleId"])
    .index("by_guild_and_date", ["guildId", "date"])
    .index("by_guild_and_user", ["guildId", "userId"])
    .index("by_user_stats", ["userId", "solved"]),

  // ============================================================================
  // CRAFTLE USER STATS TABLE
  // ============================================================================
  craftleUserStats: defineTable({
    guildId: v.string(),
    userId: v.string(),

    totalAttempts: v.number(), // Total puzzles attempted
    totalSolved: v.number(), // Puzzles solved successfully
    currentStreak: v.number(), // Consecutive days solved
    longestStreak: v.number(), // Best streak ever
    bestTime: v.optional(v.number()), // Fastest solve time (ms)
    averageAttempts: v.number(), // Avg guesses per solve
    totalHoneyEarned: v.number(), // Total currency earned

    lastPlayedDate: v.string(), // "2025-12-19"
    lastPlayedPuzzle: v.string(), // "craftle-2025-12-19"

    distribution: v.object({
      // Guess distribution (like Wordle)
      solve1: v.number(), // Solved in 1 guess
      solve2: v.number(), // Solved in 2 guesses
      solve3: v.number(),
      solve4: v.number(),
      solve5: v.number(),
      solve6: v.number(),
      fail: v.number(), // Failed to solve
    }),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild_and_user", ["guildId", "userId"])
    .index("by_guild_leaderboard", ["guildId", "totalSolved"]),

  // ============================================================================
  // CRAFTLE LEADERBOARDS TABLE
  // ============================================================================
  craftleLeaderboards: defineTable({
    guildId: v.string(),
    type: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("alltime")
    ),
    period: v.string(), // "2025-12-19", "2025-W50", "2025-12", "all"

    rankings: v.array(
      v.object({
        userId: v.string(),
        displayName: v.string(),
        score: v.number(), // Weighted score for ranking
        solveCount: v.number(),
        averageAttempts: v.number(),
        currentStreak: v.number(),
        bestTime: v.optional(v.number()),
      })
    ),

    generatedAt: v.number(),
    expiresAt: v.number(), // When to regenerate
  })
    .index("by_guild_and_type", ["guildId", "type"])
    .index("by_guild_period", ["guildId", "period"]),
});
