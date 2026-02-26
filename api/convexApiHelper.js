const { ConvexHttpClient } = require('convex/browser');
const { api } = require('../convex/_generated/api');

/**
 * Convex API Helper for Subscription Server
 *
 * This module provides a bridge between the Express API server
 * and the Convex database, allowing the API to query guild-specific
 * subscription data.
 */

let convexClient = null;

/**
 * Initialize Convex HTTP client
 */
function initConvexClient() {
    if (!convexClient) {
        const convexUrl = process.env.CONVEX_URL;
        if (!convexUrl) {
            throw new Error('CONVEX_URL environment variable is not set');
        }
        convexClient = new ConvexHttpClient(convexUrl);
        console.log('✅ Convex API Helper initialized');
    }
    return convexClient;
}

/**
 * Get subscription with per-guild data
 * @param {string} discordId - Discord user ID
 * @returns {Promise<Object|null>} Subscription with per-guild details
 */
async function getSubscriptionByDiscordId(discordId) {
    const client = initConvexClient();
    try {
        const subscription = await client.query(api.subscriptions.getSubscription, {
            discordId
        });
        return subscription;
    } catch (error) {
        console.error('[Convex API Helper] Error getting subscription:', error);
        throw error;
    }
}

/**
 * Get guild-specific subscription status
 * @param {string} discordId - Discord user ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} Guild-specific subscription data
 */
async function getGuildSubscription(discordId, guildId) {
    const client = initConvexClient();
    try {
        const guildData = await client.query(api.subscriptions.getGuildSubscription, {
            discordId,
            guildId
        });
        return guildData;
    } catch (error) {
        console.error('[Convex API Helper] Error getting guild subscription:', error);
        throw error;
    }
}

/**
 * Add verified guild
 * @param {string} discordId - Discord user ID
 * @param {string} guildId - Guild ID
 * @param {string} guildName - Guild name
 * @returns {Promise<string>} Subscription ID
 */
async function addVerifiedGuild(discordId, guildId, guildName) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.subscriptions.addVerifiedGuild, {
            discordId,
            guildId,
            guildName
        });
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error adding verified guild:', error);
        throw error;
    }
}

/**
 * Update guild-specific subscription
 * @param {string} discordId - Discord user ID
 * @param {string} guildId - Guild ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<string>} Subscription ID
 */
async function updateGuildSubscription(discordId, guildId, updates) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.subscriptions.updateGuildSubscription, {
            discordId,
            guildId,
            ...updates
        });
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error updating guild subscription:', error);
        throw error;
    }
}

/**
 * Upsert subscription (create or update user-level data)
 * @param {Object} subscriptionData - Subscription data
 * @returns {Promise<string>} Subscription ID
 */
async function upsertSubscription(subscriptionData) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.subscriptions.upsertSubscription, subscriptionData);
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error upserting subscription:', error);
        throw error;
    }
}

/**
 * Format guild data for API response
 */
function formatGuildForResponse(guild) {
    const now = Date.now();
    let status = guild.status || 'active';
    let tier = guild.tier || 'free';

    // Check if paid subscription has expired
    if (status === 'active' && guild.expiresAt && guild.expiresAt < now) {
        status = 'expired';
    }

    return {
        guildId: guild.guildId,
        guildName: guild.guildName,
        guildIcon: null, // Not stored in Convex, will be populated from Discord API
        isOwner: false,  // Will be populated from Discord API
        tier,
        status,
        expiresAt: guild.expiresAt || null,
        subscribedAt: guild.subscribedAt || guild.verifiedAt,
    };
}

/**
 * Update server subscription tier
 * Updates the tier field in the servers table for tier-gating features
 * @param {string} guildId - Guild ID
 * @param {string} tier - Subscription tier (free, plus, ultimate)
 * @returns {Promise<string>} Server ID
 */
async function updateServerTier(guildId, tier) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.servers.updateTier, {
            guildId,
            tier
        });
        console.log(`[Convex API Helper] Updated server tier for ${guildId} to ${tier}`);
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error updating server tier:', error);
        throw error;
    }
}

/**
 * Get subscription by metadata key/value (e.g., Clerk user ID)
 * @param {string} key - Metadata key to search
 * @param {string} value - Metadata value to match
 * @returns {Promise<Object|null>} Subscription or null
 */
async function getSubscriptionByMetadata(key, value) {
    const client = initConvexClient();
    try {
        const subscription = await client.query(api.subscriptions.getSubscriptionByMetadata, {
            key,
            value
        });
        return subscription;
    } catch (error) {
        console.error('[Convex API Helper] Error getting subscription by metadata:', error);
        throw error;
    }
}

/**
 * Get all subscriptions with optional filters
 * @param {Object} filters - Optional filters (tier, status, botVerified, limit)
 * @returns {Promise<Object>} { subscriptions, total, hasMore }
 */
async function getAllSubscriptions(filters = {}) {
    const client = initConvexClient();
    try {
        const result = await client.query(api.subscriptions.getAllSubscriptions, filters);
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error getting all subscriptions:', error);
        throw error;
    }
}

/**
 * Get subscription statistics
 * @returns {Promise<Object>} Stats object with total, verified, byTier, byStatus
 */
async function getSubscriptionStats() {
    const client = initConvexClient();
    try {
        const stats = await client.query(api.subscriptions.getSubscriptionStats, {});
        return stats;
    } catch (error) {
        console.error('[Convex API Helper] Error getting subscription stats:', error);
        throw error;
    }
}

/**
 * Cancel subscription (set to cancelled and free tier)
 * @param {string} discordId - Discord user ID
 * @returns {Promise<Object|null>} Updated subscription or null if not found
 */
async function cancelSubscription(discordId) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.subscriptions.cancelSubscription, {
            discordId
        });
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error cancelling subscription:', error);
        throw error;
    }
}

/**
 * Update verification check timestamp
 * @param {string} discordId - Discord user ID
 * @returns {Promise<string>} Subscription ID
 */
async function updateVerificationCheck(discordId) {
    const client = initConvexClient();
    try {
        const result = await client.mutation(api.subscriptions.updateVerificationCheck, {
            discordId
        });
        return result;
    } catch (error) {
        console.error('[Convex API Helper] Error updating verification check:', error);
        throw error;
    }
}

/**
 * Get analytics event counts grouped by event type
 * @param {number} [startTime] - Start of time range (Unix ms)
 * @param {number} [endTime] - End of time range (Unix ms)
 * @returns {Promise<Record<string, number>>} Event type -> count
 */
async function getEventCounts(startTime, endTime) {
    const client = initConvexClient();
    try {
        return await client.query(api.analytics.getEventCounts, { startTime, endTime });
    } catch (error) {
        console.error('[Convex API Helper] Error getting event counts:', error);
        throw error;
    }
}

/**
 * Get command usage ranked by frequency
 * @param {number} [startTime] - Start of time range (Unix ms)
 * @param {number} [limit] - Max results (default 20)
 * @returns {Promise<Array<{command: string, count: number}>>}
 */
async function getCommandUsage(startTime, limit) {
    const client = initConvexClient();
    try {
        return await client.query(api.analytics.getCommandUsage, { startTime, limit });
    } catch (error) {
        console.error('[Convex API Helper] Error getting command usage:', error);
        throw error;
    }
}

/**
 * Get top guilds by activity
 * @param {number} [startTime] - Start of time range (Unix ms)
 * @param {number} [limit] - Max results (default 10)
 * @returns {Promise<Array<{guildId: string, count: number}>>}
 */
async function getTopGuilds(startTime, limit) {
    const client = initConvexClient();
    try {
        return await client.query(api.analytics.getTopGuilds, { startTime, limit });
    } catch (error) {
        console.error('[Convex API Helper] Error getting top guilds:', error);
        throw error;
    }
}

/**
 * Get tier features based on tier level
 * @param {string} tier - Subscription tier (free, plus, ultimate)
 * @returns {string[]} Array of feature names
 */
function getTierFeatures(tier) {
    const tierFeatures = {
        free: ['basic_commands', 'economy', 'casino_basic'],
        plus: ['basic_commands', 'economy', 'casino_basic', 'blackjack', 'pvp_games', 'valorant_team', 'bee_mafia', 'bobby_ai', 'activity_tracking'],
        ultimate: ['basic_commands', 'economy', 'casino_basic', 'blackjack', 'pvp_games', 'valorant_team', 'bee_mafia', 'bobby_ai', 'activity_tracking', 'audit_logs', 'auto_moderation', 'custom_prefix', 'api_access', 'priority_support']
    };
    return tierFeatures[tier] || tierFeatures.free;
}

module.exports = {
    initConvexClient,
    getSubscriptionByDiscordId,
    getGuildSubscription,
    addVerifiedGuild,
    updateGuildSubscription,
    upsertSubscription,
    formatGuildForResponse,
    updateServerTier,
    getSubscriptionByMetadata,
    getAllSubscriptions,
    getSubscriptionStats,
    cancelSubscription,
    updateVerificationCheck,
    getTierFeatures,
    getEventCounts,
    getCommandUsage,
    getTopGuilds,
};
