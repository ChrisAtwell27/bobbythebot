/**
 * Centralized Interaction Router
 * This replaces the individual client.on('interactionCreate') listeners in each handler
 * to dramatically reduce CPU usage by processing interactions only once.
 */

const { trackEvent } = require('../utils/analytics');
const {
  isFeatureAllowedInGuild,
  isSlashCommandAllowedInGuild,
} = require('../config/freeVersion');

// Maps for different interaction types.
// Values are { handler, featureKey }. featureKey gates the handler per guild
// (free servers only run free-tier features); a null featureKey always runs.
const buttonHandlers = new Map();
const selectMenuHandlers = new Map();
const slashCommandHandlers = new Map();
const modalHandlers = new Map();

module.exports = (client) => {
  console.log("🎛️  Centralized Interaction Router initializing...");

  // Single interactionCreate listener
  client.on("interactionCreate", async (interaction) => {
    try {
      // Route to appropriate handler based on interaction type
      // Track all interactions
      const eventType = interaction.isButton() ? 'button_click'
        : interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu() || interaction.isChannelSelectMenu() ? 'menu_select'
        : interaction.isChatInputCommand() || interaction.isCommand() ? 'slash_command'
        : interaction.isModalSubmit() ? 'modal_submit'
        : 'interaction';
      trackEvent(eventType, {
        command: interaction.commandName || interaction.customId,
        guildId: interaction.guild?.id,
        userId: interaction.user?.id,
      });

      if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (
        interaction.isStringSelectMenu() ||
        interaction.isRoleSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isChannelSelectMenu()
      ) {
        await handleSelectMenu(interaction);
      } else if (interaction.isChatInputCommand() || interaction.isCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction);
      } else if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
      }
    } catch (error) {
      console.error("Error in interaction router:", error);

      // Try to respond to the user if possible
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: "An error occurred while processing your interaction.",
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: "An error occurred while processing your interaction.",
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error("Failed to send error message to user:", replyError);
      }
    }
  });

  // Helper to get interaction context for logging
  function getInteractionContext(interaction) {
    const guildName = interaction.guild?.name || "DM";
    const channelName = interaction.channel?.name || "unknown";
    const userTag = interaction.user?.tag || "unknown";
    const userId = interaction.user?.id || "unknown";
    return { guildName, channelName, userTag, userId };
  }

  // Button interaction handler
  async function handleButton(interaction) {
    const customId = interaction.customId;
    const { guildName, channelName, userTag, userId } = getInteractionContext(interaction);

    // Try to find a handler by exact match first
    let entry = buttonHandlers.get(customId);

    // If no exact match, try prefix matching (for dynamic IDs like "mafia_vote_123")
    if (!entry) {
      for (const [key, value] of buttonHandlers.entries()) {
        if (customId.startsWith(key)) {
          entry = value;
          break;
        }
      }
    }

    if (entry) {
      if (!isInteractionAllowed(entry.featureKey, interaction)) {
        return replyFeatureUnavailable(interaction);
      }
      console.log(`[BTN] ${customId} | User: ${userTag} (${userId}) | Guild: ${guildName} | Channel: #${channelName}`);
      await entry.handler(interaction);
    } else {
      console.log(`No handler registered for button: ${customId}`);
      console.log(`[DEBUG] Registered button prefixes: ${Array.from(buttonHandlers.keys()).join(", ")}`);
    }
  }

  // Select menu interaction handler
  async function handleSelectMenu(interaction) {
    const customId = interaction.customId;
    const { guildName, channelName, userTag, userId } = getInteractionContext(interaction);
    const selectedValues = interaction.values?.join(", ") || "none";

    // Try exact match first
    let entry = selectMenuHandlers.get(customId);

    // If no exact match, try prefix matching
    if (!entry) {
      for (const [key, value] of selectMenuHandlers.entries()) {
        if (customId.startsWith(key)) {
          entry = value;
          break;
        }
      }
    }

    if (entry) {
      if (!isInteractionAllowed(entry.featureKey, interaction)) {
        return replyFeatureUnavailable(interaction);
      }
      console.log(`[SELECT] ${customId} -> [${selectedValues}] | User: ${userTag} (${userId}) | Guild: ${guildName} | Channel: #${channelName}`);
      await entry.handler(interaction);
    } else {
      console.log(`No handler registered for select menu: ${customId}`);
    }
  }

  // Slash command interaction handler
  async function handleSlashCommand(interaction) {
    const commandName = interaction.commandName;
    const { guildName, channelName, userTag, userId } = getInteractionContext(interaction);
    const entry = slashCommandHandlers.get(commandName);

    // Get subcommand if present
    let fullCommand = `/${commandName}`;
    try {
      const subcommand = interaction.options.getSubcommand(false);
      if (subcommand) fullCommand += ` ${subcommand}`;
    } catch (_) {}

    if (entry) {
      // Per-guild gating by command name (free servers only run free-tier commands).
      if (!isSlashCommandAllowedInGuild(commandName, interaction.guild?.id)) {
        return replyFeatureUnavailable(interaction);
      }
      console.log(`[SLASH] ${fullCommand} | User: ${userTag} (${userId}) | Guild: ${guildName} | Channel: #${channelName}`);
      await entry.handler(interaction);
    } else {
      console.log(`No handler registered for slash command: ${commandName}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "This command is not currently available.",
          ephemeral: true,
        });
      }
    }
  }

  // Modal interaction handler
  async function handleModal(interaction) {
    const customId = interaction.customId;
    const { guildName, channelName, userTag, userId } = getInteractionContext(interaction);

    // Try exact match first
    let entry = modalHandlers.get(customId);

    // If no exact match, try prefix matching
    if (!entry) {
      for (const [key, value] of modalHandlers.entries()) {
        if (customId.startsWith(key)) {
          entry = value;
          break;
        }
      }
    }

    if (entry) {
      if (!isInteractionAllowed(entry.featureKey, interaction)) {
        return replyFeatureUnavailable(interaction);
      }
      console.log(`[MODAL] ${customId} | User: ${userTag} (${userId}) | Guild: ${guildName} | Channel: #${channelName}`);
      await entry.handler(interaction);
    } else {
      console.log(`No handler registered for modal: ${customId}`);
    }
  }

  // Autocomplete interaction handler
  async function handleAutocomplete(interaction) {
    const commandName = interaction.commandName;
    const entry = slashCommandHandlers.get(commandName);

    // Many handlers export autocomplete within their slash command handler
    if (entry && entry.handler && entry.handler.autocomplete) {
      await entry.handler.autocomplete(interaction);
    }
  }

  // Per-guild gate for an interaction's feature. A null featureKey always runs.
  function isInteractionAllowed(featureKey, interaction) {
    if (!featureKey) return true;
    return isFeatureAllowedInGuild(featureKey, interaction.guild?.id);
  }

  // Politely tell the user the feature isn't available on this (free) server.
  async function replyFeatureUnavailable(interaction) {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "ℹ️ This feature isn't available on this server.",
          ephemeral: true,
        });
      }
    } catch (_) {
      /* ignore — interaction may have expired */
    }
  }

  console.log(`✅ Centralized Interaction Router initialized`);

  // Return registration functions for handlers to use
  return {
    registerButton: (customId, handler, featureKey = null) => {
      console.log(`[InteractionRouter] Registering button prefix: "${customId}"`);
      buttonHandlers.set(customId, { handler, featureKey });
    },
    registerSelectMenu: (customId, handler, featureKey = null) => {
      selectMenuHandlers.set(customId, { handler, featureKey });
    },
    registerSlashCommand: (commandName, handler, featureKey = null) => {
      slashCommandHandlers.set(commandName, { handler, featureKey });
    },
    registerModal: (customId, handler, featureKey = null) => {
      modalHandlers.set(customId, { handler, featureKey });
    },
    // Batch registration for convenience
    registerButtons: (handlers, featureKey = null) => {
      for (const [customId, handler] of Object.entries(handlers)) {
        buttonHandlers.set(customId, { handler, featureKey });
      }
    },
    registerSelectMenus: (handlers, featureKey = null) => {
      for (const [customId, handler] of Object.entries(handlers)) {
        selectMenuHandlers.set(customId, { handler, featureKey });
      }
    },
    registerSlashCommands: (handlers, featureKey = null) => {
      for (const [commandName, handler] of Object.entries(handlers)) {
        slashCommandHandlers.set(commandName, { handler, featureKey });
      }
    },
    registerModals: (handlers, featureKey = null) => {
      for (const [customId, handler] of Object.entries(handlers)) {
        modalHandlers.set(customId, { handler, featureKey });
      }
    },
  };
};
