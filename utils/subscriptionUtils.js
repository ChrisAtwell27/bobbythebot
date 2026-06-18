// ===============================================
// SUBSCRIPTION UTILITIES
// ===============================================
// Utilities for checking guild subscription tiers and access control
// Uses the website API (crackedgames.co) as the single source of truth

const { EmbedBuilder } = require('discord.js');

// Website API configuration
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://crackedgames.co';
const API_SECRET = process.env.SUBSCRIPTION_API_SECRET;

// Tier constants (hierarchical: free < plus < ultimate)
const TIERS = {
    FREE: 'free',
    PLUS: 'plus',
    ULTIMATE: 'ultimate',
    // Legacy tier mappings from old model
    BASIC: 'basic',      // Maps to 'plus'
    PREMIUM: 'premium',  // Maps to 'ultimate'
    ENTERPRISE: 'enterprise' // Maps to 'ultimate'
};

// Tier hierarchy for comparison (lower number = lower tier)
const TIER_HIERARCHY = {
    [TIERS.FREE]: 0,
    [TIERS.PLUS]: 1,
    [TIERS.BASIC]: 1,      // Legacy: basic = plus
    [TIERS.ULTIMATE]: 2,
    [TIERS.PREMIUM]: 2,    // Legacy: premium = ultimate
    [TIERS.ENTERPRISE]: 2  // Legacy: enterprise = ultimate
};

// Cache subscription data to reduce API calls
// Using a simple Map with 5-minute cache expiration
const subscriptionCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Normalize legacy tier names to new tier system
 * @param {string} tier - The tier name to normalize
 * @returns {string} - Normalized tier name
 */
function normalizeTier(tier) {
    if (!tier) return TIERS.FREE;

    const lowerTier = tier.toLowerCase();

    // Map legacy tiers to new system
    if (lowerTier === 'basic') return TIERS.PLUS;
    if (lowerTier === 'premium' || lowerTier === 'enterprise') return TIERS.ULTIMATE;

    // Return as-is if already normalized
    return lowerTier;
}

/**
 * Fetch subscription from website API
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<Object|null>} - Subscription data or null on error
 */
async function fetchSubscriptionFromAPI(guildId) {
    if (!API_SECRET) {
        console.warn('[Subscription] SUBSCRIPTION_API_SECRET not set, defaulting to free tier');
        return null;
    }

    try {
        const response = await fetch(`${WEBSITE_URL}/api/subscription/guild/${guildId}`, {
            method: 'GET',
            headers: {
                'X-API-Key': API_SECRET,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                // Guild not found in website database - return free tier
                return {
                    tier: 'free',
                    status: 'active',
                    features: [],
                    guildId
                };
            }
            console.error(`[Subscription] API error for guild ${guildId}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        console.log(`[Subscription] API response for guild ${guildId}:`, JSON.stringify(data));

        // Handle nested subscription object
        if (data.success && data.subscription) {
            return {
                tier: data.subscription.tier || 'free',
                status: data.subscription.status || 'active',
                features: data.subscription.features || [],
                guildId: data.subscription.guildId || guildId,
                guildName: data.subscription.guildName,
                expiresAt: data.subscription.expiresAt
            };
        }

        // Handle flat response (tier at root level)
        if (data.success && data.tier) {
            return {
                tier: data.tier || 'free',
                status: data.status || 'active',
                features: data.features || [],
                guildId: data.guildId || guildId,
                guildName: data.guildName,
                expiresAt: data.expiresAt
            };
        }

        // Handle case where success is not present but tier is
        if (data.tier) {
            return {
                tier: data.tier || 'free',
                status: data.status || 'active',
                features: data.features || [],
                guildId: data.guildId || guildId,
                guildName: data.guildName,
                expiresAt: data.expiresAt
            };
        }

        console.warn(`[Subscription] Unexpected API response format for guild ${guildId}:`, data);
        return null;
    } catch (error) {
        console.error(`[Subscription] Failed to fetch from API for guild ${guildId}:`, error.message);
        return null;
    }
}

/**
 * Get subscription data for a specific guild (with caching)
 * Fetches from website API - the single source of truth
 * @param {string} guildId - Discord guild (server) ID
 * @param {string} ownerId - Discord owner ID (kept for backward compatibility, not used)
 * @param {boolean} forceRefresh - Skip cache and force API call
 * @returns {Promise<Object>} - Guild subscription object with tier/status
 */
async function getSubscription(guildId, ownerId = null, forceRefresh = false) {
    // Check guild cache first
    if (!forceRefresh) {
        const cached = subscriptionCache.get(guildId);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.data;
        }
    }

    // Fetch from website API
    const subscription = await fetchSubscriptionFromAPI(guildId);

    if (subscription) {
        // Cache the result
        subscriptionCache.set(guildId, {
            data: subscription,
            timestamp: Date.now()
        });
        return subscription;
    }

    // API failed or returned null - return free tier as fallback
    const defaultData = {
        tier: 'free',
        status: 'active',
        features: [],
        guildId: guildId,
    };

    subscriptionCache.set(guildId, {
        data: defaultData,
        timestamp: Date.now()
    });

    return defaultData;
}

/**
 * Get subscription data for a guild/server by owner ID
 * @deprecated Use getSubscription(guildId) instead - website is now source of truth
 * @param {string} ownerId - Discord owner ID
 * @param {boolean} forceRefresh - Skip cache
 * @returns {Promise<Object|null>} - Subscription object or null
 */
async function getSubscriptionByOwner(ownerId, forceRefresh = false) {
    console.warn('[Subscription] getSubscriptionByOwner is deprecated. Use getSubscription(guildId) instead.');
    // Return null as we no longer track by owner
    return null;
}

/**
 * Check if a guild/server has access to a specific tier (or higher)
 * @param {string} guildId - Discord guild (server) ID
 * @param {string} requiredTier - Required tier level (TIERS.FREE, TIERS.PLUS, or TIERS.ULTIMATE)
 * @param {string} ownerId - Discord owner ID (not used, kept for backward compatibility)
 * @returns {Promise<Object>} - { hasAccess: boolean, guildTier: string, subscription: Object|null }
 */
async function checkSubscription(guildId, requiredTier = TIERS.FREE, ownerId = null) {
    // Subscriptions are removed. Feature availability is now decided per guild
    // by the routers (isFeatureAllowedInGuild) BEFORE a handler runs, so any
    // handler reaching this point should be allowed. Always grant access; no
    // upgrade popup is ever shown.
    return { hasAccess: true, guildTier: TIERS.ULTIMATE, subscription: null };

    // eslint-disable-next-line no-unreachable
    // Normalize the required tier
    const normalizedRequired = normalizeTier(requiredTier);

    // Get guild's subscription from website API
    const subscription = await getSubscription(guildId, ownerId);

    // If no subscription found, default to free tier
    if (!subscription) {
        const isFree = normalizedRequired === TIERS.FREE;
        return {
            hasAccess: isFree,
            guildTier: TIERS.FREE,
            subscription: null
        };
    }

    // Use this guild's specific tier
    const guildTier = normalizeTier(subscription.tier);

    // Check if subscription is active and valid
    // Parse expiresAt if it's a string (ISO date format)
    let expiresAtTimestamp = subscription.expiresAt;
    if (typeof expiresAtTimestamp === 'string') {
        expiresAtTimestamp = new Date(expiresAtTimestamp).getTime();
    }
    const isValid = subscription.status === 'active' &&
                   (!expiresAtTimestamp || Date.now() <= expiresAtTimestamp);

    // If subscription is invalid, treat as free tier
    if (!isValid) {
        const isFree = normalizedRequired === TIERS.FREE;
        return {
            hasAccess: isFree,
            guildTier: TIERS.FREE,
            subscription: subscription,
            reason: subscription.status === 'expired' ? 'expired' : 'inactive'
        };
    }

    // Compare tier hierarchy (higher or equal = has access)
    const guildTierLevel = TIER_HIERARCHY[guildTier] ?? 0;
    const requiredTierLevel = TIER_HIERARCHY[normalizedRequired] ?? 0;
    const hasAccess = guildTierLevel >= requiredTierLevel;

    console.log(`[Subscription] Tier check for guild ${guildId}:`, {
        rawTier: subscription.tier,
        normalizedTier: guildTier,
        guildTierLevel,
        requiredTier: normalizedRequired,
        requiredTierLevel,
        hasAccess
    });

    return {
        hasAccess,
        guildTier,
        subscription
    };
}

/**
 * Check if a subscription has a specific feature
 * Uses the features array from the website API
 * @param {Object} subscription - Subscription object from getSubscription
 * @param {string} featureName - Feature name to check
 * @returns {boolean} - Whether the subscription has the feature
 */
function hasFeature(subscription, featureName) {
    return subscription?.features?.includes(featureName) ?? false;
}

/**
 * Create an upgrade prompt embed for servers without required tier
 * @param {string} featureName - Name of the feature being accessed
 * @param {string} requiredTier - Required tier for the feature
 * @param {string} guildTier - Server's current tier
 * @returns {EmbedBuilder} - Discord embed with upgrade prompt
 */
function createUpgradeEmbed(featureName, requiredTier, guildTier = TIERS.FREE) {
    const normalizedRequired = normalizeTier(requiredTier);

    // Tier colors
    const tierColors = {
        [TIERS.FREE]: 0x95A5A6,      // Gray
        [TIERS.PLUS]: 0x3498DB,      // Blue
        [TIERS.ULTIMATE]: 0x9B59B6   // Purple
    };

    // Tier emojis
    const tierEmojis = {
        [TIERS.FREE]: '🆓',
        [TIERS.PLUS]: '⭐',
        [TIERS.ULTIMATE]: '👑'
    };

    // Tier display names (no pricing)
    const tierNames = {
        [TIERS.FREE]: 'Free',
        [TIERS.PLUS]: 'Plus',
        [TIERS.ULTIMATE]: 'Ultimate'
    };

    // Subscriptions are removed. checkSubscription() always grants access, so
    // this embed is effectively never produced; if some stray caller does build
    // it, show a neutral message with no subscription upsell or external link.
    const embed = new EmbedBuilder()
        .setColor(tierColors[normalizedRequired] || 0x3498DB)
        .setTitle('ℹ️ Feature Not Available')
        .setDescription(`**${featureName}** is not available on this server.`)
        .setTimestamp();

    return embed;
}

/**
 * Clear cached subscription for a guild (useful after subscription updates)
 * @param {string} guildId - Discord guild ID
 */
function clearSubscriptionCache(guildId) {
    subscriptionCache.delete(guildId);
    console.log(`[Subscription] Cache cleared for guild ${guildId}`);
}

/**
 * Clear cached subscription for an owner
 * @deprecated No longer used - subscriptions are per-guild from website
 * @param {string} ownerId - Discord owner ID
 */
function clearOwnerSubscriptionCache(ownerId) {
    console.warn('[Subscription] clearOwnerSubscriptionCache is deprecated. Use clearSubscriptionCache(guildId) instead.');
}

/**
 * Clear all subscription cache (useful for debugging or major updates)
 */
function clearAllSubscriptionCache() {
    const size = subscriptionCache.size;
    subscriptionCache.clear();
    console.log(`[Subscription] Cleared ${size} cached subscriptions`);
}

/**
 * Middleware function to check subscription before command execution
 * Returns a function that can be used to wrap command handlers
 *
 * @param {string} requiredTier - Required tier for the command
 * @param {string} featureName - Name of the feature (for upgrade prompt)
 * @returns {Function} - Async middleware function
 *
 * @example
 * const checkTier = requireTier(TIERS.PLUS, 'Blackjack');
 * const result = await checkTier(message.guild.id, message.guild.ownerId);
 * if (!result.allowed) {
 *   await message.reply({ embeds: [result.embed] });
 *   return;
 * }
 */
function requireTier(requiredTier, featureName) {
    return async function(guildId, ownerId) {
        const result = await checkSubscription(guildId, requiredTier, ownerId);

        if (result.hasAccess) {
            return {
                allowed: true,
                subscription: result.subscription,
                guildTier: result.guildTier
            };
        } else {
            return {
                allowed: false,
                subscription: result.subscription,
                guildTier: result.guildTier,
                embed: createUpgradeEmbed(featureName, requiredTier, result.guildTier),
                reason: result.reason || 'insufficient_tier'
            };
        }
    };
}

module.exports = {
    // Constants
    TIERS,
    TIER_HIERARCHY,

    // Core functions
    getSubscription,
    getSubscriptionByOwner, // Deprecated
    checkSubscription,
    normalizeTier,
    hasFeature,

    // UI helpers
    createUpgradeEmbed,

    // Cache management
    clearSubscriptionCache,
    clearOwnerSubscriptionCache, // Deprecated
    clearAllSubscriptionCache,

    // Middleware
    requireTier
};
