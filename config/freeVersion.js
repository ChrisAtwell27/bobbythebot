/**
 * Free Version configuration — PER-SERVER model.
 *
 * One bot instance serves two experiences, decided PER GUILD at message/
 * interaction dispatch time:
 *   - "Full" servers (in FULL_SERVER_IDS) get every feature.
 *   - All other servers get only the free feature set: security
 *     (verification, moderation, logging) + wordle + infrastructure.
 *
 * Unlike the old global FREE_VERSION flag, ALL handlers now load at startup;
 * the routers gate each feature per guild via isFeatureAllowedInGuild().
 *
 * To make a server full, add its guild id to FULL_SERVER_IDS (or the
 * FULL_SERVER_IDS env var, a comma-separated list).
 */

// Guilds that get the FULL bot. The main server is always included; extra ids
// can be added via the FULL_SERVER_IDS env var (comma-separated).
const MAIN_SERVER_ID = "701308904877064193";
const FULL_SERVER_IDS = new Set(
  [MAIN_SERVER_ID, ...(process.env.FULL_SERVER_IDS || "").split(",")]
    .map((s) => s.trim())
    .filter(Boolean)
);

// Bot owner(s) / superusers — can run ANY command/feature on ANY server,
// bypassing both the per-guild feature gate and admin-permission checks. Extra
// ids can be added via the BOT_OWNER_IDS env var (comma-separated).
const BOT_OWNER_IDS = new Set(
  ["451459488562806784", ...(process.env.BOT_OWNER_IDS || "").split(",")]
    .map((s) => s.trim())
    .filter(Boolean)
);

/**
 * Is this user a bot owner / superuser (bypasses all gating everywhere)?
 * @param {string|null|undefined} userId
 */
function isBotOwner(userId) {
  if (!userId) return false;
  return BOT_OWNER_IDS.has(String(userId));
}

// Feature keys available on EVERY server (the free tier): security + wordle +
// infrastructure. Everything else is a "full only" extra.
const FREE_FEATURES = new Set([
  // Security suite
  "verification",
  "moderation",
  "logging",
  // Wordle
  "wordle",
  // Infrastructure
  "help",
  "guildJoin",
]);

// Slash command names available on every server (free tier). Other slash
// commands only do anything on full servers (gated at execution time).
const FREE_SLASH_COMMANDS = new Set([
  "help",
  "debug",
  "setup",
  "verification-setup",
]);

/**
 * Is this guild a "full" server (gets every feature)?
 * @param {string|null|undefined} guildId
 */
function isFullServer(guildId) {
  if (!guildId) return false;
  return FULL_SERVER_IDS.has(String(guildId));
}

/**
 * Is a given feature allowed to run in a given guild?
 * Bot owner => always. Full servers => everything. Other servers => only
 * FREE_FEATURES. A missing guildId (e.g. DMs) is treated as a free context.
 * @param {string} featureKey
 * @param {string|null|undefined} guildId
 * @param {string|null|undefined} userId - optional; bot owner bypasses gating
 */
function isFeatureAllowedInGuild(featureKey, guildId, userId = null) {
  if (isBotOwner(userId)) return true;
  if (isFullServer(guildId)) return true;
  return FREE_FEATURES.has(featureKey);
}

/**
 * Is a slash command allowed to do work in a given guild?
 * (All slash commands stay registered with Discord; this gates execution.)
 * Bot owner => always.
 * @param {string} commandName
 * @param {string|null|undefined} guildId
 * @param {string|null|undefined} userId - optional; bot owner bypasses gating
 */
function isSlashCommandAllowedInGuild(commandName, guildId, userId = null) {
  if (isBotOwner(userId)) return true;
  if (isFullServer(guildId)) return true;
  return FREE_SLASH_COMMANDS.has(commandName);
}

module.exports = {
  MAIN_SERVER_ID,
  FULL_SERVER_IDS,
  BOT_OWNER_IDS,
  FREE_FEATURES,
  FREE_SLASH_COMMANDS,
  isFullServer,
  isBotOwner,
  isFeatureAllowedInGuild,
  isSlashCommandAllowedInGuild,
};
