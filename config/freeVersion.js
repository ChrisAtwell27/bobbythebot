/**
 * Free Version configuration.
 *
 * Single source of truth for the "toned-down" build that ships only the
 * security suite (verification, moderation, logging) and wordle. When
 * FREE_VERSION is on, only allow-listed handlers load and only allow-listed
 * slash commands register/deploy. Nothing is deleted — set FREE_VERSION=false
 * to restore the full paid bot.
 */

// Default ON for this build. Set FREE_VERSION=false in the environment to run
// the full paid bot.
const FREE_VERSION = process.env.FREE_VERSION !== "false";

// Handler keys that stay enabled in the free build. These keys are passed at
// each registration site in events/handlerRegistry.js.
const ENABLED_HANDLERS = new Set([
  // Security suite
  "verification",
  "moderation",
  "logging",
  // Wordle
  "wordle",
  // Infrastructure (must keep the bot usable + registrable)
  "help",
  "guildJoin",
]);

// Slash command names that stay registered/deployed in the free build.
const ENABLED_SLASH_COMMANDS = new Set([
  "help",
  "debug",
  "setup",
  "verification-setup",
]);

function isHandlerEnabled(key) {
  if (!FREE_VERSION) return true;
  return ENABLED_HANDLERS.has(key);
}

function isSlashCommandEnabled(name) {
  if (!FREE_VERSION) return true;
  return ENABLED_SLASH_COMMANDS.has(name);
}

module.exports = {
  FREE_VERSION,
  ENABLED_HANDLERS,
  ENABLED_SLASH_COMMANDS,
  isHandlerEnabled,
  isSlashCommandEnabled,
};
