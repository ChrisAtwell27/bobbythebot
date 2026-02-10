const express = require("express");
const cors = require("cors");
const {
  getSettings,
  setSetting,
  getSetting,
  getServerTier,
} = require("../utils/settingsManager");
const { getRequirement, meetsRequirement } = require("../config/settingTiers");

/**
 * Settings API Server
 * Provides REST endpoints for managing bot settings per guild.
 */
class SettingsServer {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.apiKey =
      process.env.SETTINGS_API_KEY ||
      process.env.MAFIA_WEBHOOK_SECRET ||
      "default-secret";

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(
      cors({
        origin: process.env.SETTINGS_WEB_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "X-API-Key", "Authorization"],
      })
    );

    this.app.use((req, res, next) => {
      console.log(`[Settings API] ${req.method} ${req.path}`);
      next();
    });
  }

  verifyAuth(req, res, next) {
    const key = req.headers["x-api-key"];
    const auth = req.headers["authorization"];

    // Allow if key matches or bearer token matches
    if (
      key === this.apiKey ||
      (auth && auth.startsWith("Bearer ") && auth.substring(7) === this.apiKey)
    ) {
      return next();
    }

    res.status(401).json({ success: false, error: "Unauthorized" });
  }

  setupRoutes() {
    // Health check
    this.app.get("/health", (req, res) => {
      res.json({ status: "online", service: "Settings API" });
    });

    // Get all settings for a guild
    this.app.get(
      "/api/settings/:guildId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const settings = await getSettings(guildId);
          const tier = await getServerTier(guildId); // Get current tier
          res.json({ success: true, guildId, tier, settings });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Update a specific setting
    this.app.post(
      "/api/settings/:guildId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { key, value, tier: passedTier } = req.body;

          if (!key) {
            return res
              .status(400)
              .json({ success: false, error: "Missing key" });
          }

          // Check Tier Permissions
          const currentTier = passedTier || (await getServerTier(guildId));
          const requiredTier = getRequirement(key);

          if (!meetsRequirement(currentTier, requiredTier)) {
            return res.status(403).json({
              success: false,
              error: "Forbidden: Higher subscription tier required",
              tier: { current: currentTier, required: requiredTier },
            });
          }

          const result = await setSetting(guildId, key, value);

          if (result) {
            const newSettings = await getSettings(guildId);
            res.json({
              success: true,
              message: "Setting updated",
              settings: newSettings,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to update setting" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // ADMIN ROLES MANAGEMENT ENDPOINTS
    // =====================================================================

    // Get admin roles for a guild
    this.app.get(
      "/api/settings/:guildId/admin-roles",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const adminRoles = await getSetting(guildId, "adminRoles", []);

          // Also fetch role names from Discord if client is available
          let rolesWithNames = [];
          if (this.client && Array.isArray(adminRoles)) {
            try {
              const guild = await this.client.guilds.fetch(guildId);
              rolesWithNames = adminRoles.map((roleId) => {
                const role = guild.roles.cache.get(roleId);
                return {
                  id: roleId,
                  name: role ? role.name : "Unknown Role",
                  color: role ? role.hexColor : "#000000",
                };
              });
            } catch (fetchError) {
              // If we can't fetch guild, just return IDs
              rolesWithNames = adminRoles.map((roleId) => ({
                id: roleId,
                name: "Unknown",
                color: "#000000",
              }));
            }
          }

          res.json({
            success: true,
            guildId,
            adminRoles: rolesWithNames,
            adminRoleIds: adminRoles,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Add an admin role
    this.app.post(
      "/api/settings/:guildId/admin-roles",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { roleId, tier: passedTier } = req.body;

          if (!roleId) {
            return res
              .status(400)
              .json({ success: false, error: "Missing roleId" });
          }

          // Get current admin roles
          const currentRoles = await getSetting(guildId, "adminRoles", []);

          // Check if role already exists
          if (currentRoles.includes(roleId)) {
            return res
              .status(400)
              .json({ success: false, error: "Role is already an admin role" });
          }

          // Add the new role
          const newRoles = [...currentRoles, roleId];
          const result = await setSetting(guildId, "adminRoles", newRoles);

          if (result) {
            res.json({
              success: true,
              message: "Admin role added",
              adminRoles: newRoles,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to add admin role" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Remove an admin role
    this.app.delete(
      "/api/settings/:guildId/admin-roles/:roleId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, roleId } = req.params;

          // Get current admin roles
          const currentRoles = await getSetting(guildId, "adminRoles", []);

          // Check if role exists
          if (!currentRoles.includes(roleId)) {
            return res
              .status(404)
              .json({ success: false, error: "Role is not an admin role" });
          }

          // Remove the role
          const newRoles = currentRoles.filter((id) => id !== roleId);
          const result = await setSetting(guildId, "adminRoles", newRoles);

          if (result) {
            res.json({
              success: true,
              message: "Admin role removed",
              adminRoles: newRoles,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to remove admin role" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Get all available roles in the guild (for selection dropdown)
    this.app.get(
      "/api/settings/:guildId/available-roles",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;

          if (!this.client) {
            return res
              .status(500)
              .json({ success: false, error: "Bot client not available" });
          }

          const guild = await this.client.guilds.fetch(guildId);
          const roles = guild.roles.cache
            .filter((role) => !role.managed && role.name !== "@everyone")
            .sort((a, b) => b.position - a.position)
            .map((role) => ({
              id: role.id,
              name: role.name,
              color: role.hexColor,
              position: role.position,
            }));

          res.json({
            success: true,
            guildId,
            roles,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Get all available emojis in the guild (for emoji picker)
    this.app.get(
      "/api/settings/:guildId/available-emojis",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;

          if (!this.client) {
            return res
              .status(500)
              .json({ success: false, error: "Bot client not available" });
          }

          const guild = await this.client.guilds.fetch(guildId);

          // Fetch emojis if not cached
          await guild.emojis.fetch();

          const emojis = guild.emojis.cache.map((emoji) => ({
            id: emoji.id,
            name: emoji.name,
            animated: emoji.animated || false,
            url: emoji.url,
          }));

          res.json({
            success: true,
            guildId,
            emojis,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // CHANNEL SETTINGS ENDPOINTS
    // =====================================================================

    // Get all available channels in the guild (for selection dropdowns)
    this.app.get(
      "/api/settings/:guildId/available-channels",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { type } = req.query; // Optional: 'text', 'voice', or 'all'

          if (!this.client) {
            return res
              .status(500)
              .json({ success: false, error: "Bot client not available" });
          }

          const guild = await this.client.guilds.fetch(guildId);

          // Channel type constants: 0 = text, 2 = voice, 4 = category
          let channels = guild.channels.cache;

          if (type === "text") {
            channels = channels.filter((ch) => ch.type === 0);
          } else if (type === "voice") {
            channels = channels.filter((ch) => ch.type === 2);
          } else {
            // Default: text and voice channels (exclude categories)
            channels = channels.filter((ch) => ch.type === 0 || ch.type === 2);
          }

          const channelList = channels
            .sort((a, b) => a.position - b.position)
            .map((channel) => ({
              id: channel.id,
              name: channel.name,
              type: channel.type === 0 ? "text" : "voice",
              category: channel.parent ? channel.parent.name : null,
              position: channel.position,
            }));

          res.json({
            success: true,
            guildId,
            channels: channelList,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Get configured channels for a guild
    this.app.get(
      "/api/settings/:guildId/channels",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const channels = await getSetting(guildId, "channels", {});

          // Enrich with channel names if client is available
          let enrichedChannels = {};
          if (this.client) {
            try {
              const guild = await this.client.guilds.fetch(guildId);
              for (const [key, channelId] of Object.entries(channels)) {
                if (channelId) {
                  const channel = guild.channels.cache.get(channelId);
                  enrichedChannels[key] = {
                    id: channelId,
                    name: channel ? channel.name : "Unknown Channel",
                    type: channel
                      ? channel.type === 0
                        ? "text"
                        : "voice"
                      : "unknown",
                  };
                } else {
                  enrichedChannels[key] = null;
                }
              }
            } catch (fetchError) {
              // Return IDs only if guild fetch fails
              enrichedChannels = channels;
            }
          } else {
            enrichedChannels = channels;
          }

          res.json({
            success: true,
            guildId,
            channels: enrichedChannels,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Set a channel setting
    this.app.post(
      "/api/settings/:guildId/channels/:channelType",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, channelType } = req.params;
          const { channelId, tier: passedTier } = req.body;

          // Validate channel type
          const validTypes = [
            "trivia",
            "wordle",
            "alerts",
            "updates",
            "announcements",
            "commands",
            "logging",
            "changelog",
            "mafia_text",
            "mafia_voice",
            "dailymafia", // Daily Mafia game channel (asynchronous 24hr games)
            "graveyard",
            "clip_submission",
            "shop",
            "shop_notifications",
            "betting",
            "verification",
            "verification_log",
          ];

          if (!validTypes.includes(channelType)) {
            return res.status(400).json({
              success: false,
              error: `Invalid channel type. Valid types: ${validTypes.join(", ")}`,
            });
          }

          // Use tier from request body if provided (website passes tier from Convex - source of truth)
          // Fall back to local lookup if not provided (for direct bot API calls)
          const currentTier = passedTier || (await getServerTier(guildId));
          const requiredTier = getRequirement(`channels.${channelType}`);

          if (!meetsRequirement(currentTier, requiredTier)) {
            return res.status(403).json({
              success: false,
              error: "Forbidden: Higher subscription tier required",
              tier: { current: currentTier, required: requiredTier },
            });
          }

          // Set the channel
          const result = await setSetting(
            guildId,
            `channels.${channelType}`,
            channelId || null
          );

          if (result) {
            res.json({
              success: true,
              message: `Channel ${channelType} updated`,
              channelType,
              channelId: channelId || null,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to update channel" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // ROLE SETTINGS ENDPOINTS (for specific functional roles)
    // =====================================================================

    // Get configured roles for a guild
    this.app.get(
      "/api/settings/:guildId/roles",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const roles = await getSetting(guildId, "roles", {});

          // Enrich with role names if client is available
          let enrichedRoles = {};
          if (this.client) {
            try {
              const guild = await this.client.guilds.fetch(guildId);
              for (const [key, roleId] of Object.entries(roles)) {
                if (roleId) {
                  const role = guild.roles.cache.get(roleId);
                  enrichedRoles[key] = {
                    id: roleId,
                    name: role ? role.name : "Unknown Role",
                    color: role ? role.hexColor : "#000000",
                  };
                } else {
                  enrichedRoles[key] = null;
                }
              }
            } catch (fetchError) {
              enrichedRoles = roles;
            }
          } else {
            enrichedRoles = roles;
          }

          res.json({
            success: true,
            guildId,
            roles: enrichedRoles,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Set a role setting
    this.app.post(
      "/api/settings/:guildId/roles/:roleType",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, roleType } = req.params;
          const { roleId, tier: passedTier } = req.body;

          // Validate role type
          const validTypes = [
            "dead",
            "bump_reminder",
            "updates",
            "clip_winner",
            "valorant_team",
            "valorant_inhouse",
            "shop_notifications",
            "unverified",
            "quarantine",
          ];

          if (!validTypes.includes(roleType)) {
            return res.status(400).json({
              success: false,
              error: `Invalid role type. Valid types: ${validTypes.join(", ")}`,
            });
          }

          // Use tier from request body if provided (website passes tier from Convex - source of truth)
          // Fall back to local lookup if not provided (for direct bot API calls)
          const currentTier = passedTier || (await getServerTier(guildId));
          const requiredTier = getRequirement(`roles.${roleType}`);

          if (!meetsRequirement(currentTier, requiredTier)) {
            return res.status(403).json({
              success: false,
              error: "Forbidden: Higher subscription tier required",
              tier: { current: currentTier, required: requiredTier },
            });
          }

          // Set the role
          const result = await setSetting(
            guildId,
            `roles.${roleType}`,
            roleId || null
          );

          if (result) {
            res.json({
              success: true,
              message: `Role ${roleType} updated`,
              roleType,
              roleId: roleId || null,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to update role" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // CURRENCY SETTINGS ENDPOINTS
    // =====================================================================

    // Get currency settings for a guild
    this.app.get(
      "/api/settings/:guildId/currency",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const currencyName = await getSetting(guildId, "currency.name", null);
          const currencyEmoji = await getSetting(guildId, "currency.emoji", null);

          res.json({
            success: true,
            guildId,
            currency: {
              name: currencyName,
              emoji: currencyEmoji,
            },
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Set currency settings (name and/or emoji)
    this.app.post(
      "/api/settings/:guildId/currency",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { name, emoji, tier: passedTier } = req.body;

          // Check tier for currency settings (requires plus tier)
          const currentTier = passedTier || (await getServerTier(guildId));
          const requiredTier = getRequirement("currency.name"); // Both use same tier

          if (!meetsRequirement(currentTier, requiredTier)) {
            return res.status(403).json({
              success: false,
              error: "Forbidden: Higher subscription tier required",
              tier: { current: currentTier, required: requiredTier },
            });
          }

          const results = {};

          // Validate and set currency name
          if (name !== undefined) {
            if (name === null || name === "") {
              // Clear the setting
              await setSetting(guildId, "currency.name", null);
              results.name = { success: true, value: null, cleared: true };
            } else if (!/^[a-zA-Z]{1,20}$/.test(name)) {
              results.name = {
                success: false,
                error: "Invalid name: max 20 characters, letters only",
              };
            } else {
              await setSetting(guildId, "currency.name", name);
              results.name = { success: true, value: name };
            }
          }

          // Validate and set currency emoji
          if (emoji !== undefined) {
            if (emoji === null || emoji === "") {
              // Clear the setting
              await setSetting(guildId, "currency.emoji", null);
              results.emoji = { success: true, value: null, cleared: true };
            } else {
              // Accept any non-empty string for emoji (Discord custom emojis, unicode, etc.)
              await setSetting(guildId, "currency.emoji", emoji);
              results.emoji = { success: true, value: emoji };
            }
          }

          // If neither was provided
          if (name === undefined && emoji === undefined) {
            return res.status(400).json({
              success: false,
              error: "Provide 'name' and/or 'emoji' in request body",
            });
          }

          // Fetch updated values
          const updatedName = await getSetting(guildId, "currency.name", null);
          const updatedEmoji = await getSetting(guildId, "currency.emoji", null);

          res.json({
            success: true,
            message: "Currency settings updated",
            results,
            currency: {
              name: updatedName,
              emoji: updatedEmoji,
            },
          });
        } catch (error) {
          console.error("[Settings API] Currency update error:", error);
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // FEATURE TOGGLES ENDPOINTS
    // =====================================================================

    // Get all feature toggles
    this.app.get(
      "/api/settings/:guildId/features",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const features = await getSetting(guildId, "features", {});
          const tier = await getServerTier(guildId);

          res.json({
            success: true,
            guildId,
            tier,
            features,
          });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Toggle a feature
    this.app.post(
      "/api/settings/:guildId/features/:featureName",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, featureName } = req.params;
          const { enabled, tier: passedTier } = req.body;

          // Validate feature name
          const validFeatures = [
            "trivia",
            "alerts",
            "gambling",
            "wordle",
            "mafia",
            "moderation",
            "clips",
            "bump_reminder",
            "birthdays",
            "bounties",
            "team_builder",
            "valorant",
            "audit_log",
            "audit_logs",
            "shop",
            "ask",
            "custom_branding",
            "betting",
            "verification",
          ];

          if (!validFeatures.includes(featureName)) {
            return res.status(400).json({
              success: false,
              error: `Invalid feature. Valid features: ${validFeatures.join(", ")}`,
            });
          }

          // Use tier from request body if provided (website passes tier from Convex - source of truth)
          // Fall back to local lookup if not provided (for direct bot API calls)
          const currentTier = passedTier || (await getServerTier(guildId));
          const requiredTier = getRequirement(`features.${featureName}`);

          if (!meetsRequirement(currentTier, requiredTier)) {
            return res.status(403).json({
              success: false,
              error: "Forbidden: Higher subscription tier required",
              tier: { current: currentTier, required: requiredTier },
            });
          }

          // Set the feature
          const result = await setSetting(
            guildId,
            `features.${featureName}`,
            enabled === true
          );

          if (result) {
            res.json({
              success: true,
              message: `Feature ${featureName} ${enabled ? "enabled" : "disabled"}`,
              featureName,
              enabled: enabled === true,
            });
          } else {
            res
              .status(500)
              .json({ success: false, error: "Failed to update feature" });
          }
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // =====================================================================
    // SHOP ENDPOINTS
    // =====================================================================

    // Get all shop items for a guild
    this.app.get(
      "/api/settings/:guildId/shop/items",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          const items = await client.query(api.shop.getItems, { guildId });
          res.json({ success: true, guildId, items });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Get a specific shop item
    this.app.get(
      "/api/settings/:guildId/shop/items/:itemId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, itemId } = req.params;
          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          const item = await client.query(api.shop.getItem, { guildId, itemId });
          if (!item) {
            return res.status(404).json({ success: false, error: "Item not found" });
          }
          res.json({ success: true, item });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Create a new shop item
    this.app.post(
      "/api/settings/:guildId/shop/items",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { itemId, title, description, price, imageUrl, stock, maxPerUser, roleReward, sortOrder } = req.body;

          if (!itemId || !title || price === undefined) {
            return res.status(400).json({
              success: false,
              error: "Missing required fields: itemId, title, price",
            });
          }

          if (typeof price !== "number" || price < 0) {
            return res.status(400).json({
              success: false,
              error: "Price must be a non-negative number",
            });
          }

          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          await client.mutation(api.shop.createItem, {
            guildId,
            itemId,
            title,
            description,
            price,
            imageUrl,
            stock,
            maxPerUser,
            roleReward,
            sortOrder,
          });

          res.json({ success: true, message: "Shop item created", itemId });
        } catch (error) {
          if (error.message.includes("already exists")) {
            return res.status(409).json({ success: false, error: error.message });
          }
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Update a shop item
    this.app.put(
      "/api/settings/:guildId/shop/items/:itemId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, itemId } = req.params;
          const { title, description, price, imageUrl, stock, maxPerUser, roleReward, enabled, sortOrder, messageId } = req.body;

          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          await client.mutation(api.shop.updateItem, {
            guildId,
            itemId,
            title,
            description,
            price,
            imageUrl,
            stock,
            maxPerUser,
            roleReward,
            enabled,
            sortOrder,
            messageId,
          });

          res.json({ success: true, message: "Shop item updated", itemId });
        } catch (error) {
          if (error.message.includes("not found")) {
            return res.status(404).json({ success: false, error: error.message });
          }
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Delete a shop item
    this.app.delete(
      "/api/settings/:guildId/shop/items/:itemId",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId, itemId } = req.params;
          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          const deleted = await client.mutation(api.shop.deleteItem, { guildId, itemId });
          if (!deleted) {
            return res.status(404).json({ success: false, error: "Item not found" });
          }
          res.json({ success: true, message: "Shop item deleted", itemId });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Reorder shop items
    this.app.post(
      "/api/settings/:guildId/shop/items/reorder",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { itemIds } = req.body;

          if (!Array.isArray(itemIds)) {
            return res.status(400).json({
              success: false,
              error: "itemIds must be an array of item IDs in desired order",
            });
          }

          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          await client.mutation(api.shop.reorderItems, { guildId, itemIds });
          res.json({ success: true, message: "Shop items reordered" });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );

    // Get shop purchases
    this.app.get(
      "/api/settings/:guildId/shop/purchases",
      this.verifyAuth.bind(this),
      async (req, res) => {
        try {
          const { guildId } = req.params;
          const { limit } = req.query;
          const { getConvexClient } = require("../database/convexClient");
          const { api } = require("../convex/_generated/api");
          const client = getConvexClient();

          const purchases = await client.query(api.shop.getPurchases, {
            guildId,
            limit: limit ? parseInt(limit, 10) : undefined,
          });
          res.json({ success: true, guildId, purchases });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    );
  }

  start(port = 3003) {
    this.server = this.app.listen(port, () => {
      console.log(`✅ Settings API server listening on port ${port}`);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}

module.exports = SettingsServer;
