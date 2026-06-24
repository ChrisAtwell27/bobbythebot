/**
 * Admin Permissions Utility
 *
 * Provides centralized admin permission checking based on configurable
 * admin roles per server, stored in Convex settings.
 */

const { getSetting } = require('./settingsManager');

/**
 * Check if a guild member has admin permissions
 *
 * Admin permissions are granted if the member:
 * 1. Has Discord ADMINISTRATOR permission
 * 2. Is the server owner
 * 3. Has any role in the server's configured adminRoles list
 *
 * @param {GuildMember} member - Discord.js GuildMember object
 * @param {string} guildId - The guild ID
 * @returns {Promise<boolean>} Whether the member has admin permissions
 */
async function hasAdminPermission(member, guildId) {
    // Always allow the bot owner / superuser (any command, any server)
    const { isBotOwner } = require('../config/freeVersion');
    if (isBotOwner(member.id)) {
        return true;
    }

    // Always allow server owner
    if (member.id === member.guild.ownerId) {
        return true;
    }

    // Always allow Discord administrators
    if (member.permissions.has('Administrator')) {
        return true;
    }

    // Check configured admin roles
    try {
        const adminRoles = await getSetting(guildId, 'adminRoles', []);

        if (!Array.isArray(adminRoles) || adminRoles.length === 0) {
            // No admin roles configured - only Discord admins and owner have access
            return false;
        }

        // Check if member has any of the admin roles
        return member.roles.cache.some(role => adminRoles.includes(role.id));
    } catch (error) {
        console.error(`[Admin Permissions] Error checking permissions for ${member.id} in ${guildId}:`, error);
        // On error, fall back to Discord permissions only
        return false;
    }
}

/**
 * Get the list of configured admin roles for a guild
 *
 * @param {string} guildId - The guild ID
 * @returns {Promise<string[]>} Array of role IDs
 */
async function getAdminRoles(guildId) {
    try {
        const adminRoles = await getSetting(guildId, 'adminRoles', []);
        return Array.isArray(adminRoles) ? adminRoles : [];
    } catch (error) {
        console.error(`[Admin Permissions] Error fetching admin roles for ${guildId}:`, error);
        return [];
    }
}

/**
 * Check if a specific role ID is an admin role
 *
 * @param {string} guildId - The guild ID
 * @param {string} roleId - The role ID to check
 * @returns {Promise<boolean>}
 */
async function isAdminRole(guildId, roleId) {
    const adminRoles = await getAdminRoles(guildId);
    return adminRoles.includes(roleId);
}

module.exports = {
    hasAdminPermission,
    getAdminRoles,
    isAdminRole,
};
