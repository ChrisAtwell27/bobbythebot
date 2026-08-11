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

      // Cheap fast path: avoids a write for the overwhelmingly common
      // already-nudged case. This read alone is racy (two concurrent
      // qualifying messages can both pass it before either writes) — the
      // actual "once ever" guarantee comes from the atomic claim below.
      const existing = await User.findOne({ userId }).select("mcForumNudgedAt").lean();
      if (existing?.mcForumNudgedAt) return;

      // Make sure the user document exists, since the claim below is a
      // conditional update and needs something to match against.
      await User.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });

      // Claim the nudge atomically BEFORE replying. The filter itself is the
      // lock: only one of two concurrent messages from the same member can
      // match `mcForumNudgedAt: null`, so only one proceeds past this point.
      const claim = await User.updateOne(
        { userId, mcForumNudgedAt: null },
        { $set: { mcForumNudgedAt: new Date() } }
      );
      if (claim.modifiedCount === 0) return; // someone else claimed it first

      try {
        await message.reply({
          content:
            `That sounds like a bug — please post it in <#${forumId}> so we can track it. ` +
            `Include your mod version, what happened, your logs, and screenshots if you have them.\n` +
            `Fastest option: run \`/debug\` in-game and it files the report for you.`,
          allowedMentions: { repliedUser: true },
        });
      } catch (replyError) {
        // The reply failed after we claimed the nudge. Release the claim so
        // the member stays eligible for a future nudge rather than being
        // silently locked out by a one-off Discord API failure. This rollback
        // must never itself throw.
        await User.updateOne({ userId }, { $set: { mcForumNudgedAt: null } }).catch(() => {});
        console.error(`[MC Nudge] reply failed, released claim for ${userId}:`, replyError);
        return;
      }

      console.log(`[MC Nudge] Nudged ${message.author.tag} (${userId})`);
    } catch (error) {
      // Never throw: this processor shares the message router with every other
      // handler in the bot.
      console.error("[MC Nudge] processor error:", error);
    }
  };
};
