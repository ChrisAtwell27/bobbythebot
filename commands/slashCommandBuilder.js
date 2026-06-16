/**
 * Slash Command Builder
 * Defines all slash commands for the Discord bot
 * These will be registered with Discord's API
 */

const { SlashCommandBuilder } = require("discord.js");

/**
 * Command definitions
 * Each command should have:
 * - data: SlashCommandBuilder instance
 * - execute: async function (interaction) => {}
 */

const commands = [];

// ==========================================
// HELP & INFO COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display help menu with all available commands")
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Specific category to view")
        .setRequired(false)
        .addChoices(
          { name: "Games", value: "games" },
          { name: "Economy", value: "economy" },
          { name: "Valorant", value: "valorant" },
          { name: "Moderation", value: "moderation" },
          { name: "Utility", value: "utility" }
        )
    ),
  category: "info",
});

// ==========================================
// ECONOMY COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your BobbyBucks balance")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to check balance for")
        .setRequired(false)
    ),
  category: "economy",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily BobbyBucks reward"),
  category: "economy",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("give")
    .setDescription("Give BobbyBucks to another user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to give BobbyBucks to")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to give")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "economy",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the BobbyBucks leaderboard"),
  category: "economy",
});

// ==========================================
// GAMBLING COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("flip")
    .setDescription("Flip a coin and bet BobbyBucks")
    .addStringOption((option) =>
      option
        .setName("choice")
        .setDescription("Heads or Tails")
        .setRequired(true)
        .addChoices(
          { name: "Heads", value: "heads" },
          { name: "Tails", value: "tails" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to bet")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "gambling",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Play the slot machine")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to bet")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "gambling",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Roll a dice and bet on the outcome")
    .addIntegerOption((option) =>
      option
        .setName("guess")
        .setDescription("Your guess (1-6)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(6)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to bet")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "gambling",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play a game of Blackjack")
    .addIntegerOption((option) =>
      option
        .setName("bet")
        .setDescription("Amount to bet")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "gambling",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Spin the roulette wheel")
    .addStringOption((option) =>
      option
        .setName("bet")
        .setDescription("What to bet on")
        .setRequired(true)
        .addChoices(
          { name: "Red", value: "red" },
          { name: "Black", value: "black" },
          { name: "Green (0)", value: "green" },
          { name: "Odd", value: "odd" },
          { name: "Even", value: "even" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to bet")
        .setRequired(true)
        .setMinValue(1)
    ),
  category: "gambling",
});

// ==========================================
// GAME COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("mafia")
    .setDescription("Manage Bee Mafia games")
    .addSubcommand((subcommand) =>
      subcommand.setName("create").setDescription("Create a new Bee Mafia game")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("join").setDescription("Join an active Bee Mafia game")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Check the status of your current game")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leave")
        .setDescription("Leave your current Bee Mafia game")
    ),
  category: "games",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("wordle")
    .setDescription("Play Wordle")
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Start a new Wordle game")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("guess")
        .setDescription("Make a guess")
        .addStringOption((option) =>
          option
            .setName("word")
            .setDescription("Your 5-letter guess")
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5)
        )
    ),
  category: "games",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Answer the daily trivia question"),
  category: "games",
});

// ==========================================
// VALORANT COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("valstats")
    .setDescription("View your Valorant stats")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to check stats for")
        .setRequired(false)
    ),
  category: "valorant",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("valprofile")
    .setDescription("Link your Valorant profile")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Your Valorant username")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("tag")
        .setDescription("Your Valorant tag (without #)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("region")
        .setDescription("Your region")
        .setRequired(true)
        .addChoices(
          { name: "North America", value: "na" },
          { name: "Europe", value: "eu" },
          { name: "Asia Pacific", value: "ap" },
          { name: "Korea", value: "kr" },
          { name: "Latin America", value: "latam" },
          { name: "Brazil", value: "br" }
        )
    ),
  category: "valorant",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Create balanced Valorant teams")
    .addIntegerOption((option) =>
      option
        .setName("players")
        .setDescription("Number of players (default: 10)")
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(10)
    )
    .addNumberOption((option) =>
      option
        .setName("timer")
        .setDescription("Hours until the event starts (e.g. 0.5 for 30 mins)")
        .setRequired(false)
        .setMinValue(0.1)
        .setMaxValue(24)
    ),
  category: "valorant",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("valorantmap")
    .setDescription("Get a random Valorant map or vote on maps")
    .addSubcommand((subcommand) =>
      subcommand.setName("random").setDescription("Get a random map")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("vote").setDescription("Start a map vote")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("View all available maps")
    ),
  category: "valorant",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("inhouse")
    .setDescription("Create a Valorant in-house match")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Match mode")
        .setRequired(true)
        .addChoices(
          { name: "5v5 Competitive", value: "5v5" },
          { name: "3v3 Spike Rush", value: "3v3" }
        )
    ),
  category: "valorant",
});

// ==========================================
// MODERATION COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a user from the server")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for kicking")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0), // Admin only
  category: "moderation",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to ban").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for banning")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("delete_days")
        .setDescription("Days of messages to delete (0-7)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7)
    )
    .setDefaultMemberPermissions(0), // Admin only
  category: "moderation",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a user")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to timeout").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Duration in minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    ) // Max 28 days
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for timeout")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0), // Admin only
  category: "moderation",
});

// ==========================================
// UTILITY COMMANDS
// ==========================================

commands.push({
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Bobby a question (AI chat)")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("Your question for Bobby")
        .setRequired(true)
    ),
  category: "utility",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("bounty")
    .setDescription("View or claim bounties")
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("View all active bounties")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("claim")
        .setDescription("Claim a completed bounty")
        .addStringOption((option) =>
          option
            .setName("bounty_id")
            .setDescription("Bounty ID to claim")
            .setRequired(true)
        )
    ),
  category: "utility",
});

commands.push({
  data: new SlashCommandBuilder()
    .setName("thinice")
    .setDescription("Check thin ice status")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to check").setRequired(false)
    ),
  category: "utility",
});

// ==========================================
// ADMIN/SETUP COMMANDS
// ==========================================

const { PermissionFlagsBits, ChannelType } = require("discord.js");

commands.push({
  data: new SlashCommandBuilder()
    .setName("verification-setup")
    .setDescription("Configure the enhanced verification system")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable the verification system")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Verification channel (where users verify)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("unverified-role")
            .setDescription("Role assigned to unverified users")
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("quarantine-role")
            .setDescription("Role for suspicious users (optional)")
            .setRequired(false)
        )
        .addChannelOption((option) =>
          option
            .setName("log-channel")
            .setDescription("Channel for logging verification events (optional)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable the verification system")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("View current verification configuration")
    ),
  category: "admin",
});

// ==========================================
// DEBUG & SETUP (free-version infrastructure)
// ==========================================
const debugCommand = require("./debugCommand");
commands.push({ data: debugCommand.data, category: "info" });

const setupCommand = require("./setup");
commands.push({ data: setupCommand.data, category: "utility" });

// Export all commands
const { FREE_VERSION, isSlashCommandEnabled } = require("../config/freeVersion");

const exportedCommands = FREE_VERSION
  ? commands.filter((c) => isSlashCommandEnabled(c.data.name))
  : commands;

module.exports = exportedCommands;
