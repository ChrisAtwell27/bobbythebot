const { getConvexClient } = require('../database/convexClient');
const { api } = require('../convex/_generated/api');

/**
 * Track a bot analytics event via Convex.
 * @param {string} event - Event type (e.g. "command_use", "button_click", "slash_command")
 * @param {object} data - Event data
 * @param {string} [data.command] - Command name
 * @param {string} [data.guildId] - Guild ID
 * @param {string} [data.userId] - User ID
 * @param {object} [data.metadata] - Additional context
 */
async function trackEvent(event, data = {}) {
  try {
    const client = getConvexClient();
    if (!client) return;

    await client.mutation(api.analytics.track, {
      event,
      command: data.command,
      guildId: data.guildId,
      userId: data.userId,
      metadata: data.metadata,
    });
  } catch (err) {
    // Analytics should never crash the bot
    console.error('[Analytics] Failed to track event:', err.message);
  }
}

module.exports = { trackEvent };
