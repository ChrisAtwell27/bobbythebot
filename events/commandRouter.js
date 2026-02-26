/**
 * Centralized Command Router
 * This replaces the individual client.on('messageCreate') listeners in each handler
 * to dramatically reduce CPU usage by processing messages only once.
 *
 * Two types of handlers:
 * 1. Command handlers - respond to specific !commands
 * 2. Message processors - need to see all messages (like alertHandler, askHandler)
 */

const { trackEvent } = require('../utils/analytics');

// Command handlers map (!command based)
const commandHandlers = new Map();

// Message processors that need to see all messages
const messageProcessors = [];

module.exports = (client) => {
  console.log("📡 Centralized Command Router initializing...");

  // Single messageCreate listener - processes messages only ONCE
  client.on("messageCreate", async (message) => {
    // Skip bots (universal check done once)
    if (message.author.bot) return;

    // First, run message processors (these need to see all messages)
    // Examples: alertHandler (keyword monitoring), thinIceHandler (profanity check)
    for (const processor of messageProcessors) {
      try {
        await processor(message);
      } catch (error) {
        console.error(`Error in message processor:`, error);
      }
    }

    // Then, handle commands if message starts with !
    if (message.content.startsWith("!")) {
      const args = message.content.slice(1).trim().split(/\s+/);
      const commandName = args.shift().toLowerCase();

      // Check for exact command match
      const handler = commandHandlers.get(commandName);

      if (handler) {
        // Log the command usage
        const guildName = message.guild?.name || "DM";
        const channelName = message.channel?.name || "unknown";
        console.log(`[CMD] !${commandName} | User: ${message.author.tag} (${message.author.id}) | Guild: ${guildName} | Channel: #${channelName}`);

        // Track command usage
        trackEvent('command_use', {
          command: commandName,
          guildId: message.guild?.id,
          userId: message.author.id,
        });

        try {
          await handler(message, args, commandName);
        } catch (error) {
          console.error(`Error executing command ${commandName}:`, error);
          try {
            await message.reply("There was an error executing that command.");
          } catch (replyError) {
            // Ignore if we can't send error message
          }
        }
      }
    }
  });

  console.log(`✅ Centralized Command Router initialized`);
  console.log(`   - ${commandHandlers.size} command handlers registered`);
  console.log(`   - ${messageProcessors.length} message processors registered`);

  // Return registration functions for handlers to use
  return {
    /**
     * Register a command handler
     * @param {string|string[]} commands - Command name(s) without the ! prefix
     * @param {function} handler - Handler function (message, args, commandName) => Promise<void>
     */
    registerCommand: (commands, handler) => {
      const commandArray = Array.isArray(commands) ? commands : [commands];
      for (const cmd of commandArray) {
        commandHandlers.set(cmd.toLowerCase(), handler);
      }
    },

    /**
     * Register multiple commands at once
     * @param {Object} handlers - Object mapping command names to handler functions
     */
    registerCommands: (handlers) => {
      for (const [command, handler] of Object.entries(handlers)) {
        commandHandlers.set(command.toLowerCase(), handler);
      }
    },

    /**
     * Register a message processor that needs to see ALL messages
     * Use this for handlers like alertHandler that monitor for keywords
     * @param {function} processor - Processor function (message) => Promise<void>
     */
    registerMessageProcessor: (processor) => {
      messageProcessors.push(processor);
    },

    /**
     * Get registered command count
     */
    getCommandCount: () => commandHandlers.size,

    /**
     * Get registered processor count
     */
    getProcessorCount: () => messageProcessors.length,
  };
};
