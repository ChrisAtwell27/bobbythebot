const { EmbedBuilder } = require('discord.js');
const { api } = require('../convex/_generated/api');
const { getConvexClient } = require('../utils/convexClient');

/**
 * Setup Reminder Handler
 * Periodically checks for servers without configured settings and DMs owners
 * Groups all unconfigured servers per owner into a single message
 */

// Track which owners we've already DM'd to avoid spam
// Key: ownerId, Value: timestamp of last DM
const ownerDmCache = new Map();

// Don't DM the same owner more than once per week
const DM_COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 7 days

// Delay before first check after bot starts
const STARTUP_DELAY = 60 * 1000; // 1 minute

// How often to check for unconfigured servers
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if settings object is empty or effectively unconfigured
 */
function isSettingsEmpty(settings) {
  if (!settings) return true;
  if (typeof settings !== 'object') return true;

  // Check if it's an empty object {}
  const keys = Object.keys(settings);
  if (keys.length === 0) return true;

  // Check if all values are empty/null/undefined
  const hasAnyValue = keys.some(key => {
    const value = settings[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'object' && Object.keys(value).length === 0) return false;
    return true;
  });

  return !hasAnyValue;
}

/**
 * Create the setup reminder embed for a single server
 */
function createSetupReminderEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle('⚙️ Complete Your Bobby Bot Setup!')
    .setDescription(
      `Hey there! I noticed that **${guildName}** hasn't been fully configured yet.\n\n` +
      `To unlock all of Bobby's features and customize the bot for your server, please visit our dashboard!`
    )
    .addFields(
      {
        name: '🔗 Setup Dashboard',
        value: '**[crackedgames.co/bobby-the-bot](https://crackedgames.co/bobby-the-bot)**',
        inline: false
      },
      {
        name: '✨ What You Can Configure',
        value: [
          '• **Channels** - Set up betting, trivia, and more',
          '• **Features** - Enable/disable gambling, moderation, valorant tools',
          '• **Roles** - Configure notification roles and permissions',
          '• **Admin Roles** - Set which roles can manage the bot',
        ].join('\n'),
        inline: false
      },
      {
        name: '🎮 Popular Features',
        value: [
          '• 🎰 Casino & Gambling system',

          '• 🎯 Valorant Team Builder & Stats',
          '• 🧩 Daily Wordle & Trivia',
          '• 🕵️ Mafia Game',
          '• 🛒 Server Economy & Shop',
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'Weekly reminder until setup is complete' })
    .setTimestamp();
}

/**
 * Create the setup reminder embed for multiple servers
 */
function createMultiServerReminderEmbed(guildNames) {
  const serverList = guildNames.map(name => `• **${name}**`).join('\n');

  return new EmbedBuilder()
    .setColor(0xFF6B35)
    .setTitle('⚙️ Complete Your Bobby Bot Setup!')
    .setDescription(
      `Hey there! I noticed that **${guildNames.length} server(s)** you own haven't been fully configured yet:\n\n` +
      `${serverList}\n\n` +
      `To unlock all of Bobby's features and customize the bot for your servers, please visit our dashboard!`
    )
    .addFields(
      {
        name: '🔗 Setup Dashboard',
        value: '**[crackedgames.co/bobby-the-bot](https://crackedgames.co/bobby-the-bot)**',
        inline: false
      },
      {
        name: '✨ What You Can Configure',
        value: [
          '• **Channels** - Set up betting, trivia, and more',
          '• **Features** - Enable/disable gambling, moderation, valorant tools',
          '• **Roles** - Configure notification roles and permissions',
          '• **Admin Roles** - Set which roles can manage the bot',
        ].join('\n'),
        inline: false
      },
      {
        name: '🎮 Popular Features',
        value: [
          '• 🎰 Casino & Gambling system',

          '• 🎯 Valorant Team Builder & Stats',
          '• 🧩 Daily Wordle & Trivia',
          '• 🕵️ Mafia Game',
          '• 🛒 Server Economy & Shop',
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'Weekly reminder until setup is complete' })
    .setTimestamp();
}

/**
 * Check all guilds for unconfigured settings
 * Groups servers by owner to send consolidated messages
 */
async function checkAllGuilds(client) {
  console.log('[Setup Reminder] 🔍 Checking for unconfigured servers...');

  let convex;
  try {
    convex = getConvexClient();
  } catch (error) {
    console.error('[Setup Reminder] Failed to get Convex client:', error.message);
    return;
  }

  // Group unconfigured servers by owner
  // Key: ownerId, Value: { owner, guilds: [{ guild, name }] }
  const ownerGuilds = new Map();
  let checkedCount = 0;

  for (const guild of client.guilds.cache.values()) {
    checkedCount++;
    const ownerId = guild.ownerId;

    // Check if we've already DM'd this owner recently (per-owner cooldown)
    const lastDm = ownerDmCache.get(ownerId);
    if (lastDm && Date.now() - lastDm < DM_COOLDOWN) {
      continue;
    }

    try {
      // Query the server settings from Convex
      const server = await convex.query(api.servers.getServer, { guildId: guild.id });

      // Check if settings are empty/unconfigured
      if (!server || isSettingsEmpty(server.settings)) {
        // Add to owner's list of unconfigured servers
        if (!ownerGuilds.has(ownerId)) {
          ownerGuilds.set(ownerId, { owner: null, guilds: [] });
        }
        ownerGuilds.get(ownerId).guilds.push({ guild, name: guild.name });
      }
    } catch (error) {
      console.error(`[Setup Reminder] Error checking guild ${guild.name}:`, error.message);
    }
  }

  // Now send consolidated messages to each owner
  let remindersSent = 0;

  for (const [ownerId, data] of ownerGuilds) {
    if (data.guilds.length === 0) continue;

    try {
      // Fetch owner from first guild
      const owner = await data.guilds[0].guild.fetchOwner();

      if (!owner || owner.user.bot) {
        continue;
      }

      // Create embed based on number of unconfigured servers
      const guildNames = data.guilds.map(g => g.name);
      const embed = guildNames.length === 1
        ? createSetupReminderEmbed(guildNames[0])
        : createMultiServerReminderEmbed(guildNames);

      await owner.send({ embeds: [embed] });

      // Mark that we've DM'd this owner (single cooldown for all their servers)
      ownerDmCache.set(ownerId, Date.now());
      remindersSent++;

      const serverNames = guildNames.length <= 3
        ? guildNames.join(', ')
        : `${guildNames.slice(0, 3).join(', ')} (+${guildNames.length - 3} more)`;
      console.log(`[Setup Reminder] 📬 Sent setup reminder to ${owner.user.tag} for ${guildNames.length} server(s): ${serverNames}`);

      // Small delay between DMs to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (dmError) {
      if (dmError.code !== 50007) { // 50007 = Cannot send messages to this user
        console.log(`[Setup Reminder] Could not DM owner ${ownerId}: ${dmError.message}`);
      }
    }
  }

  console.log(`[Setup Reminder] ✅ Checked ${checkedCount} servers, sent ${remindersSent} reminder(s) to unique owners`);
}

module.exports = (client) => {
  console.log('[Setup Reminder] Handler initialized (DISABLED - no automatic DMs)');

  // DISABLED: Setup reminders were spamming users on every bot restart
  // The in-memory cache gets cleared on restart, causing duplicate DMs
  //
  // To re-enable with proper persistence:
  // 1. Store lastReminderSent timestamp in Convex servers table
  // 2. Query that timestamp instead of using in-memory ownerDmCache
  // 3. Uncomment the code below

  // setTimeout(() => {
  //   checkAllGuilds(client);
  // }, STARTUP_DELAY);

  // const intervalId = setInterval(() => {
  //   checkAllGuilds(client);
  // }, CHECK_INTERVAL);

  // if (!global.setupReminderIntervals) {
  //   global.setupReminderIntervals = [];
  // }
  // global.setupReminderIntervals.push(intervalId);
};
