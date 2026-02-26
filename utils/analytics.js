const Analytics = require('../database/models/Analytics');

/**
 * Track a bot analytics event.
 * @param {string} event - Event type (e.g. "command_use", "button_click", "menu_select", "error")
 * @param {object} data - Event data
 * @param {string} [data.command] - Command name
 * @param {string} [data.guildId] - Guild ID
 * @param {string} [data.userId] - User ID
 * @param {object} [data.metadata] - Additional context
 */
async function trackEvent(event, data = {}) {
  try {
    await Analytics.create({
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

/**
 * Get command usage counts for a time period.
 * @param {number} [sinceDays=30] - Days to look back
 * @returns {Promise<Array<{_id: string, count: number}>>}
 */
async function getCommandUsage(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return Analytics.aggregate([
    { $match: { event: 'command_use', timestamp: { $gte: since } } },
    { $group: { _id: '$command', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
}

/**
 * Get event counts grouped by type.
 * @param {number} [sinceDays=30]
 * @returns {Promise<Array<{_id: string, count: number}>>}
 */
async function getEventCounts(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return Analytics.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $group: { _id: '$event', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
}

/**
 * Get top guilds by usage.
 * @param {number} [sinceDays=30]
 * @param {number} [limit=10]
 */
async function getTopGuilds(sinceDays = 30, limit = 10) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return Analytics.aggregate([
    { $match: { timestamp: { $gte: since }, guildId: { $ne: null } } },
    { $group: { _id: '$guildId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
}

module.exports = {
  trackEvent,
  getCommandUsage,
  getEventCounts,
  getTopGuilds,
};
