import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Track an analytics event
export const track = mutation({
  args: {
    event: v.string(),
    command: v.optional(v.string()),
    guildId: v.optional(v.string()),
    userId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("analytics", {
      event: args.event,
      command: args.command,
      guildId: args.guildId,
      userId: args.userId,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
  },
});

// Get event counts grouped by event type within a time range
export const getEventCounts = query({
  args: {
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const start = args.startTime ?? 0;
    const end = args.endTime ?? Date.now();

    const events = await ctx.db
      .query("analytics")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", start).lte("timestamp", end))
      .collect();

    const counts: Record<string, number> = {};
    for (const event of events) {
      counts[event.event] = (counts[event.event] ?? 0) + 1;
    }
    return counts;
  },
});

// Get command usage ranked by frequency
export const getCommandUsage = query({
  args: {
    startTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const start = args.startTime ?? 0;

    const events = await ctx.db
      .query("analytics")
      .withIndex("by_event_timestamp", (q) => q.eq("event", "command_use").gte("timestamp", start))
      .collect();

    const counts: Record<string, number> = {};
    for (const e of events) {
      if (e.command) {
        counts[e.command] = (counts[e.command] ?? 0) + 1;
      }
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.limit ?? 20)
      .map(([command, count]) => ({ command, count }));
  },
});

// Get top guilds by activity
export const getTopGuilds = query({
  args: {
    startTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const start = args.startTime ?? 0;

    const events = await ctx.db
      .query("analytics")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", start))
      .collect();

    const counts: Record<string, number> = {};
    for (const e of events) {
      if (e.guildId) {
        counts[e.guildId] = (counts[e.guildId] ?? 0) + 1;
      }
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.limit ?? 10)
      .map(([guildId, count]) => ({ guildId, count }));
  },
});
