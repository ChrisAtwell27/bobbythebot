/**
 * Tier Definitions for Bot Settings
 * Defines which subscription tier is required for each setting.
 */

// Rank values for comparison (higher = better)
const TIERS = {
  free: 0,
  plus: 1,
  ultimate: 2,
};

// Default tier for guilds with no subscription
const DEFAULT_TIER = "free";

// Setting requirements
// Key: Setting name (dot notation supported)
// Value: Minimum required tier key
const SETTING_REQUIREMENTS = {
  // =====================================================================
  // FREE TIER FEATURE TOGGLES
  // =====================================================================
  "features.trivia": "free",
  "features.wordle": "free",
  "features.moderation": "free", // Basic spam/rate limiting - free
  "features.clips": "free",
  "features.bump_reminder": "free",
  // =====================================================================
  // FREE GAMBLING (House Games)
  // =====================================================================
  "features.gambling_free": "free", // Free house games: flip, roulette, dice

  // =====================================================================
  // PLUS TIER FEATURE TOGGLES
  // =====================================================================
  "features.alerts": "plus", // Keyword alert system
  "features.audit_logs": "plus", // Audit logs (singular alias)
  "features.gambling_plus": "plus", // Plus games: blackjack, rps, highercard, quickdraw, numberduel, russianroulette
  "features.mafia": "plus", // Bee Mafia game
  "features.birthdays": "plus",
  "features.bounties": "plus",
  "features.team_builder": "plus",
  "features.ask": "plus", // Bobby AI Chat
  "features.shop": "plus",
  "features.betting": "plus", // Custom betting pools

  // =====================================================================
  // ULTIMATE TIER FEATURE TOGGLES
  // =====================================================================
  "features.valorant": "ultimate", // Valorant API stats/matches
  "features.custom_branding": "ultimate",

  // =====================================================================
  // PLUS TIER CUSTOMIZATION
  // =====================================================================
  "currency.name": "ultimate", // Custom currency name (max 20 chars, letters only)
  "currency.emoji": "ultimate", // Custom currency emoji (single emoji)

  // =====================================================================
  // CHANNEL SETTINGS (free tier - all servers can configure channels)
  // =====================================================================
  "channels.trivia": "free",
  "channels.wordle": "free",
  "channels.alerts": "free",
  "channels.updates": "free",
  "channels.announcements": "free",
  "channels.commands": "free",
  "channels.logging": "free",
  "channels.changelog": "free",

  // Mafia channels
  "channels.mafia_text": "free",
  "channels.mafia_voice": "free",
  "channels.dailymafia": "free", // Daily Mafia game channel (asynchronous 24hr games)

  // Moderation channels
  "channels.graveyard": "free",

  // Clip submission
  "channels.clip_submission": "free",

  // Shop channels
  "channels.shop": "plus", // Channel where shop items are displayed
  "channels.shop_notifications": "plus", // Channel for purchase notifications

  // Betting channels
  "channels.betting": "plus", // Channel for betting pools

  // =====================================================================
  // ROLE SETTINGS (free tier - all servers can configure roles)
  // =====================================================================
  // Admin roles (who can use admin commands)
  adminRoles: "free",

  // Moderation roles
  "roles.dead": "free", // Role given to "dead" users in mafia/moderation

  // Notification roles (who gets pinged for various events)
  "roles.bump_reminder": "free", // Role to ping for server bumps
  "roles.updates": "free", // Role for update notifications
  "roles.clip_winner": "free", // Role for clip contest winners

  // Team builder / Valorant roles
  "roles.valorant_team": "plus", // Role to ping for Valorant teams
  "roles.valorant_inhouse": "plus", // Role for in-house games

  // Shop roles
  "roles.shop_notifications": "plus", // Role to ping for shop purchases
};

/**
 * Check if a tier meets the requirement
 * @param {string} currentTier - The guild's current tier
 * @param {string} requiredTier - The required tier
 * @returns {boolean}
 */
function meetsRequirement(currentTier, requiredTier) {
  const currentVal = TIERS[currentTier] || 0;
  const requiredVal = TIERS[requiredTier] || 0;
  return currentVal >= requiredVal;
}

/**
 * Get requirement for a specific setting key
 * @param {string} key
 * @returns {string} The required tier (defaults to 'free' if not defined)
 */
function getRequirement(key) {
  return SETTING_REQUIREMENTS[key] || "free";
}

module.exports = {
  TIERS,
  DEFAULT_TIER,
  SETTING_REQUIREMENTS,
  meetsRequirement,
  getRequirement,
};
