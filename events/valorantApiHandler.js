const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

// ===============================================
// VALORANT STATS & API HANDLER (REFACTORED)
// ===============================================
// This handler manages Valorant account registration and stats display
// Commands: !valstats, !valprofile, !valmatches, !esports, !createteams (admin), !valtest (admin), !valreset (admin), !vallist (admin), !valskills (admin)
//
// IMPORTANT: This is separate from the Valorant TEAM BUILDER
// Team Builder uses: !valorant, @Valorant role, valorant_ button prefixes
// This handler uses: !valstats, !valprofile, valstats_ button prefixes
// ===============================================

// Import utilities
const {
  validateValorantRegistration,
  VALID_REGIONS,
} = require("../utils/validators");
const { safeInteractionResponse } = require("../utils/interactionUtils");
const {
  checkSubscription,
  createUpgradeEmbed,
  TIERS,
} = require("../utils/subscriptionUtils");

// Import Valorant API modules
const {
  getAccountData,
  getMMRData,
  getMMRDataV3,
  getMMRHistory,
  getStoredMatches,
  getMatches,
  getEsportsSchedule,
} = require("../valorantApi/apiClient");
const {
  RANK_MAPPING,
  loadRankImage,
  createFallbackRankIcon,
  getRankInfo,
  calculateMMR,
} = require("../valorantApi/rankUtils");
const {
  getUserRegistration,
  getAllRegisteredUsers,
  addUserRegistration,
  removeUserRegistration,
  getUserRankData,
  isUserRegistered,
  findOrMigrateUser,
  updateUserRegistration,
  USERS_FILE,
} = require("../valorantApi/registrationManager");
const {
  AGENT_DATA,
  MAX_PREFERRED_AGENTS,
  getAgentById,
  getAgentName,
  getAgentEmoji,
  getAgentRole,
  isValidAgent,
  formatAgentList,
  getAgentSelectOptionsByRole,
  getAllRoles,
  ROLE_EMOJIS,
} = require("../valorantApi/agentUtils");
const {
  getPlayerMatchStats,
  getAgentStatsFromMatches,
  getTeammateStatsFromMatches,
  COMPETITIVE_MODES,
} = require("../valorantApi/matchStats");
const { createStatsVisualization, createMatchHistoryCanvas, createMMRHistoryCanvas } = require("../valorantApi/statsVisualizer");
const { createCompareVisualization } = require("../valorantApi/compareVisualizer");
const {
  calculateEnhancedSkillScore,
  createBalancedTeams,
} = require("../valorantApi/teamBalancer");

// ===============================================
// VALSTATS DATA CACHE
// ===============================================
// Caches API data from initial !valstats call to reuse when buttons are clicked
// This avoids re-fetching data for "Detailed Matches", "MMR History", etc.
// Cache key format: `${guildId}_${userId}` -> { data, timestamp }
const valstatsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Get cached valstats data for a user
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @returns {Object|null} - Cached data or null if expired/missing
 */
function getCachedValstatsData(guildId, userId) {
  const key = `${guildId}_${userId}`;
  const cached = valstatsCache.get(key);

  if (!cached) return null;

  // Check if cache has expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    valstatsCache.delete(key);
    return null;
  }

  console.log(`[ValStats Cache] Using cached data for ${userId}`);
  return cached.data;
}

/**
 * Store valstats data in cache
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @param {Object} data - Data to cache (accountData, mmrData, matchData, etc.)
 */
function setCachedValstatsData(guildId, userId, data) {
  const key = `${guildId}_${userId}`;
  valstatsCache.set(key, {
    data,
    timestamp: Date.now()
  });
  console.log(`[ValStats Cache] Cached data for ${userId}`);

  // Clean up old entries periodically (keep cache size reasonable)
  if (valstatsCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of valstatsCache) {
      if (now - v.timestamp > CACHE_TTL) {
        valstatsCache.delete(k);
      }
    }
  }
}

/**
 * Clear cached data for a user (e.g., after refresh button)
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 */
function clearCachedValstatsData(guildId, userId) {
  const key = `${guildId}_${userId}`;
  valstatsCache.delete(key);
  console.log(`[ValStats Cache] Cleared cache for ${userId}`);
}

// ===============================================
// UNIQUE HANDLER FUNCTIONS
// ===============================================
// These functions are specific to this handler and handle command logic

// Helper function to show registration modal
async function showRegistrationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`valstats_registration_${interaction.user.id}`)
    .setTitle("📝 Valorant Account Registration");

  const usernameInput = new TextInputBuilder()
    .setCustomId("valorant_username")
    .setLabel("Valorant Username (Name#Tag)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Example: PlayerName#1234")
    .setRequired(true)
    .setMaxLength(30);

  const regionInput = new TextInputBuilder()
    .setCustomId("valorant_region")
    .setLabel("Region")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("na, eu, ap, kr, latam, or br")
    .setRequired(true)
    .setMaxLength(10);

  const firstRow = new ActionRowBuilder().addComponents(usernameInput);
  const secondRow = new ActionRowBuilder().addComponents(regionInput);

  modal.addComponents(firstRow, secondRow);

  await interaction.showModal(modal);
}

// Show registration prompt with button
async function showRegistrationPrompt(message) {
  const embed = new EmbedBuilder()
    .setTitle("🎮 Valorant Stats Registration")
    .setColor("#ff4654")
    .setDescription("You need to register your Valorant account first!")
    .addFields(
      {
        name: "📋 What We Track",
        value:
          "• Competitive Rank & RR\n• Match History & KDA\n• Win Rate & ACS\n• Peak Rank",
        inline: true,
      },
      {
        name: "🔒 Privacy",
        value:
          "• Only public Riot data\n• No account access\n• Secure & private",
        inline: true,
      },
      {
        name: "🌍 Supported Regions",
        value: "`NA`, `EU`, `AP`, `KR`, `LATAM`, `BR`",
        inline: false,
      }
    )
    .setFooter({ text: "Click the button below to register" });

  const registerButton = new ButtonBuilder()
    .setCustomId(`valstats_register_${message.author.id}`)
    .setLabel("Register Now")
    .setEmoji("✅")
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(registerButton);

  await message.channel.send({
    embeds: [embed],
    components: [row],
  });
}

// Handle registration submission with validation
async function handleRegistrationSubmission(interaction) {
  const username = interaction.fields.getTextInputValue("valorant_username");
  const region = interaction.fields
    .getTextInputValue("valorant_region")
    .toLowerCase();

  // Extract name and tag from username
  if (!username.includes("#")) {
    return await safeInteractionResponse(interaction, "reply", {
      content:
        "❌ Invalid username format! Please use the format: Username#Tag (e.g., Player#1234)",
      ephemeral: true,
    });
  }

  const [name, tag] = username.split("#");

  // Validate inputs using the validators module
  const validation = validateValorantRegistration({
    name: name,
    tag: tag,
    region: region,
  });

  if (!validation.valid) {
    const errorMessages = Object.values(validation.errors).join("\n");
    return await safeInteractionResponse(interaction, "reply", {
      content: `❌ Validation failed:\n${errorMessages}`,
      ephemeral: true,
    });
  }

  // Use sanitized values
  const {
    name: cleanName,
    tag: cleanTag,
    region: cleanRegion,
  } = validation.sanitized;

  await safeInteractionResponse(interaction, "defer", { ephemeral: true });

  try {
    console.log(
      `Testing account: ${cleanName}#${cleanTag} in region ${cleanRegion}`
    );
    const accountData = await getAccountData(cleanName, cleanTag);

    if (accountData.status !== 200) {
      return await safeInteractionResponse(interaction, "reply", {
        content: `❌ Could not find a Valorant account with that username and tag. Please check your spelling and try again.\n\nAPI Response: ${
          accountData.error || "Unknown error"
        }`,
      });
    }

    const userData = {
      name: cleanName,
      tag: cleanTag,
      region: cleanRegion,
      puuid: accountData.data.puuid,
      registeredAt: new Date().toISOString(),
    };

    await addUserRegistration(interaction.guild.id, interaction.user.id, userData);

    const successEmbed = new EmbedBuilder()
      .setTitle("✅ Registration Successful!")
      .setColor("#00ff00")
      .setDescription(
        `Successfully registered your Valorant account: **${cleanName}#${cleanTag}**`
      )
      .addFields(
        { name: "🌍 Region", value: cleanRegion.toUpperCase(), inline: true },
        {
          name: "🆔 PUUID",
          value: accountData.data.puuid.substring(0, 8) + "...",
          inline: true,
        },
        {
          name: "📅 Registered",
          value: new Date().toLocaleDateString(),
          inline: true,
        },
        {
          name: "🚀 Next Step",
          value: "Use `!valstats` or `!valprofile` to view your stats!",
          inline: false,
        }
      )
      .setTimestamp()
      .setFooter({ text: "Valorant Stats Tracker" });

    await safeInteractionResponse(interaction, "reply", {
      embeds: [successEmbed],
    });
  } catch (error) {
    console.error("Registration error:", error);

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Account Validation Failed")
      .setColor("#ff0000")
      .setDescription(
        "Unable to verify your Valorant account. **Most common causes:** Typo in Name#Tag, no ranked games played, or API rate limit."
      )
      .addFields({
        name: "🔧 Quick Fixes",
        value:
          '1. Verify spelling: **"PlayerName#1234"** (case-sensitive)\n' +
          "2. Play 1+ Ranked match if new account\n" +
          "3. Wait 1 minute and retry\n" +
          "4. Contact admin if issue persists",
        inline: false,
      })
      .setFooter({ text: `Error: ${error.message.substring(0, 100)}...` })
      .setTimestamp();

    await safeInteractionResponse(interaction, "reply", {
      embeds: [errorEmbed],
    });
  }
}

// Handle updating registration
async function handleUpdateRegistration(message, args) {
  if (args.length < 1) {
    return await message.channel.send(
      "❌ Usage: `!valupdate <Name#Tag> [region]`\nExample: `!valupdate NewName#Tag na`"
    );
  }

  const username = args[0];
  let region = args[1] ? args[1].toLowerCase() : null;

  // Extract name and tag from username
  if (!username.includes("#")) {
    return await message.channel.send(
      "❌ Invalid username format! Please use the format: Username#Tag (e.g., Player#1234)"
    );
  }

  const [name, tag] = username.split("#");

  // If region not provided, try to get from existing registration
  if (!region) {
    const existing = await getUserRegistration(message.guild.id, message.author.id);
    if (existing) {
      region = existing.region;
    } else {
      return await message.channel.send(
        "❌ Region is required for new registrations or if I cannot find your old one.\nUsage: `!valupdate <Name#Tag> <region>`"
      );
    }
  }

  // Validate inputs
  const validation = validateValorantRegistration({
    name: name,
    tag: tag,
    region: region,
  });

  if (!validation.valid) {
    const errorMessages = Object.values(validation.errors).join("\n");
    return await message.channel.send(
      `❌ Validation failed:\n${errorMessages}`
    );
  }

  // Use sanitized values
  const {
    name: cleanName,
    tag: cleanTag,
    region: cleanRegion,
  } = validation.sanitized;

  const loadingMsg = await message.channel.send(
    "🔄 Verifying new Valorant account..."
  );

  try {
    const accountData = await getAccountData(cleanName, cleanTag);

    if (accountData.status !== 200) {
      return await loadingMsg.edit(
        `❌ Could not find account **${cleanName}#${cleanTag}**. Please check spelling and try again.`
      );
    }

    const userData = {
      name: cleanName,
      tag: cleanTag,
      region: cleanRegion,
      puuid: accountData.data.puuid,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addUserRegistration(message.guild.id, message.author.id, userData);

    const successEmbed = new EmbedBuilder()
      .setTitle("✅ Valorant Tag Updated!")
      .setColor("#00ff00")
      .setDescription(
        `Successfully updated your Valorant account to: **${cleanName}#${cleanTag}**`
      )
      .addFields(
        { name: "🌍 Region", value: cleanRegion.toUpperCase(), inline: true },
        {
          name: "🆔 PUUID",
          value: accountData.data.puuid.substring(0, 8) + "...",
          inline: true,
        }
      )
      .setTimestamp();

    await loadingMsg.edit({ content: null, embeds: [successEmbed] });
  } catch (error) {
    console.error("Update error:", error);
    await loadingMsg.edit(`❌ Error updating account: ${error.message}`);
  }
}

// Handle !valcompare command - Head-to-head comparison
async function handleValCompare(message) {
  const mentions = message.mentions.users;

  // Get the two users to compare
  let user1 = message.author;
  let user2 = null;

  if (mentions.size === 0) {
    // No mentions - show help
    const helpEmbed = new EmbedBuilder()
      .setTitle("⚔️ Head-to-Head Comparison")
      .setColor("#ff4654")
      .setDescription(
        "Compare your Valorant stats with another player!\n\n" +
        "**Usage:**\n" +
        "`!valcompare @user` - Compare yourself vs another user\n" +
        "`!valcompare @user1 @user2` - Compare two other users\n\n" +
        "Both players must be registered with `!valstats`"
      )
      .setFooter({ text: "Stats based on recent competitive matches" });
    return message.channel.send({ embeds: [helpEmbed] });
  } else if (mentions.size === 1) {
    // One mention - compare author vs mentioned user
    user2 = mentions.first();
  } else if (mentions.size >= 2) {
    // Two mentions - compare the two mentioned users
    const mentionArray = [...mentions.values()];
    user1 = mentionArray[0];
    user2 = mentionArray[1];
  }

  // Can't compare to yourself
  if (user1.id === user2.id) {
    return message.channel.send("❌ You can't compare a player to themselves!");
  }

  // Check registrations
  const reg1 = await findOrMigrateUser(message.guild.id, user1);
  const reg2 = await findOrMigrateUser(message.guild.id, user2);

  if (!reg1 || !reg1.name || !reg1.tag || !reg1.region) {
    return message.channel.send(
      `❌ **${user1.displayName || user1.username}** is not registered. They need to use \`!valstats\` first.`
    );
  }
  if (!reg2 || !reg2.name || !reg2.tag || !reg2.region) {
    return message.channel.send(
      `❌ **${user2.displayName || user2.username}** is not registered. They need to use \`!valstats\` first.`
    );
  }

  // Show loading message
  const loadingEmbed = new EmbedBuilder()
    .setTitle("⚔️ Loading Head-to-Head Comparison...")
    .setColor("#ff4654")
    .setDescription(
      `Fetching stats for **${reg1.name}#${reg1.tag}** vs **${reg2.name}#${reg2.tag}**...`
    )
    .setTimestamp();

  const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

  try {
    // Fetch data for both players in parallel
    const [player1Data, player2Data] = await Promise.all([
      fetchPlayerCompareData(reg1, user1),
      fetchPlayerCompareData(reg2, user2)
    ]);

    // Generate comparison visualization
    const compareBuffer = await createCompareVisualization(player1Data, player2Data);
    const attachment = new AttachmentBuilder(compareBuffer, { name: "compare.png" });

    // Calculate winner summary
    const winner = determineOverallWinner(player1Data, player2Data);

    const resultEmbed = new EmbedBuilder()
      .setTitle(`⚔️ ${reg1.name} vs ${reg2.name}`)
      .setColor("#ff4654")
      .setImage("attachment://compare.png")
      .setDescription(winner.summary)
      .setFooter({ text: "Based on recent competitive matches • Stats refresh every 10 minutes" })
      .setTimestamp();

    await loadingMessage.edit({
      embeds: [resultEmbed],
      files: [attachment]
    });

  } catch (error) {
    console.error("[ValCompare] Error:", error);
    await loadingMessage.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ Comparison Failed")
          .setColor("#ff0000")
          .setDescription(
            "Failed to fetch player data. This could be due to:\n" +
            "• API rate limiting\n" +
            "• Invalid player registration\n" +
            "• Players have no recent competitive matches\n\n" +
            "Try again in a few moments."
          )
      ]
    });
  }
}

// Fetch all data needed for comparison
async function fetchPlayerCompareData(registration, discordUser) {
  const [accountData, mmrData, storedMatchData] = await Promise.all([
    getAccountData(registration.name, registration.tag).catch(() => null),
    getMMRData(registration.region, registration.name, registration.tag).catch(() => null),
    getStoredMatches(registration.region, registration.name, registration.tag).catch(() => null)
  ]);

  // Get match stats
  const matchStats = await getPlayerMatchStats(registration, false).catch(() => ({}));

  // Get best agent from stored matches (up to 30 competitive matches)
  const agentMatchData = storedMatchData?.data || [];
  const { bestAgent } = getAgentStatsFromMatches(registration, agentMatchData);

  return {
    account: accountData?.data || { name: registration.name, tag: registration.tag },
    mmr: mmrData,
    matchStats,
    bestAgent,
    avatar: discordUser.displayAvatarURL({ extension: "png", size: 128 }),
    registration
  };
}

// Determine overall winner based on stats
function determineOverallWinner(player1, player2) {
  let p1Wins = 0;
  let p2Wins = 0;

  const p1Stats = player1.matchStats || {};
  const p2Stats = player2.matchStats || {};
  const p1Rank = player1.mmr?.data?.current_data || player1.mmr?.current_data;
  const p2Rank = player2.mmr?.data?.current_data || player2.mmr?.current_data;

  // Compare rank
  if ((p1Rank?.currenttier || 0) > (p2Rank?.currenttier || 0)) p1Wins++;
  else if ((p2Rank?.currenttier || 0) > (p1Rank?.currenttier || 0)) p2Wins++;

  // Compare win rate
  if ((p1Stats.winRate || 0) > (p2Stats.winRate || 0)) p1Wins++;
  else if ((p2Stats.winRate || 0) > (p1Stats.winRate || 0)) p2Wins++;

  // Compare KDA
  if ((p1Stats.avgKDA || 0) > (p2Stats.avgKDA || 0)) p1Wins++;
  else if ((p2Stats.avgKDA || 0) > (p1Stats.avgKDA || 0)) p2Wins++;

  // Compare ACS
  if ((p1Stats.avgACS || 0) > (p2Stats.avgACS || 0)) p1Wins++;
  else if ((p2Stats.avgACS || 0) > (p1Stats.avgACS || 0)) p2Wins++;

  const p1Name = player1.account?.name || player1.registration?.name;
  const p2Name = player2.account?.name || player2.registration?.name;

  if (p1Wins > p2Wins) {
    return {
      winner: 1,
      summary: `🏆 **${p1Name}** wins ${p1Wins}-${p2Wins} in head-to-head stats!`
    };
  } else if (p2Wins > p1Wins) {
    return {
      winner: 2,
      summary: `🏆 **${p2Name}** wins ${p2Wins}-${p1Wins} in head-to-head stats!`
    };
  } else {
    return {
      winner: 0,
      summary: `🤝 **It's a tie!** Both players are evenly matched (${p1Wins}-${p2Wins})`
    };
  }
}

// Show user stats with comprehensive visualization
async function showUserStats(message, registration) {
  const loadingEmbed = new EmbedBuilder()
    .setTitle("🔄 Loading Enhanced Valorant Stats...")
    .setColor("#ff4654")
    .setDescription(
      "Fetching your latest data from Riot Games with comprehensive analysis..."
    )
    .setTimestamp();

  const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

  try {
    console.log(
      `Fetching enhanced stats for: ${registration.name}#${registration.tag} in ${registration.region}`
    );

    // Single consolidated progress message
    const updateProgress = async (step) => {
      const steps = [
        `${step >= 1 ? "✓" : step === 1 ? "⏳" : "⏸️"} Account data`,
        `${step >= 2 ? "✓" : step === 2 ? "⏳" : "⏸️"} MMR & Rank info`,
        `${step >= 3 ? "✓" : step === 3 ? "⏳" : "⏸️"} Match history`,
      ];

      await loadingMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔄 Loading Valorant Stats...")
            .setColor("#ff4654")
            .setDescription(
              `**${registration.name}#${
                registration.tag
              }** • ${registration.region.toUpperCase()}\n\n${steps.join(
                " • "
              )}`
            )
            .setTimestamp(),
        ],
      });
    };

    await updateProgress(1);
    const accountData = await getAccountData(
      registration.name,
      registration.tag
    );

    await updateProgress(2);
    // Fetch both v2 MMR (legacy) and v3 MMR (comprehensive) data
    const [mmrData, mmrDataV3] = await Promise.all([
      getMMRData(registration.region, registration.name, registration.tag),
      getMMRDataV3(registration.region, registration.name, registration.tag),
    ]);

    await updateProgress(3);
    // Fetch both regular matches (for display) and stored matches (for agent stats)
    // Regular matches: shows 8 most recent for match history display
    // Stored matches: up to 30 competitive matches for comprehensive agent stats
    // Use .catch() to gracefully handle slow/failing endpoints
    const [matchData, storedMatchData] = await Promise.all([
      getMatches(registration.region, registration.name, registration.tag).catch(err => {
        console.warn("v3 matches endpoint failed:", err.message);
        return { status: 0, data: [], error: err.message };
      }),
      getStoredMatches(registration.region, registration.name, registration.tag).catch(err => {
        console.warn("Stored matches endpoint failed:", err.message);
        return { status: 0, data: [], error: err.message };
      })
    ]);

    if (accountData.status !== 200) {
      throw new Error(
        `Could not fetch account data: ${accountData.error || "Unknown error"}`
      );
    }

    if (mmrData.status !== 200) {
      console.warn("MMR v2 data unavailable:", mmrData.error);
    }

    if (mmrDataV3.status !== 200) {
      console.warn("MMR v3 data unavailable:", mmrDataV3.error);
    }

    // Get user avatar
    const userAvatar = message.author.displayAvatarURL({
      extension: "png",
      size: 256,
    });

    // Calculate best agent and all agent stats from stored matches (30 competitive matches)
    // Use stored matches for comprehensive agent stats, fall back to regular matches if unavailable
    const agentMatchData = (storedMatchData?.status === 200 && storedMatchData?.data?.length > 0)
      ? storedMatchData.data
      : matchData.data || [];
    const { bestAgent, sortedAgents } = getAgentStatsFromMatches(registration, agentMatchData);

    // Calculate teammate stats from v3 match data (has all players info)
    const teammateData = getTeammateStatsFromMatches(registration, matchData.data || []);

    // Cache all the fetched data for reuse when buttons are clicked
    // This avoids re-fetching when user clicks "Detailed Matches" or "MMR History"
    setCachedValstatsData(message.guild?.id || 'dm', message.author.id, {
      accountData: accountData.data,
      mmrData: mmrData.data,
      mmrDataV3: mmrDataV3.data,
      matchData: matchData.data || [],
      storedMatchData: storedMatchData.data || [],
      registration,
      userAvatar
    });

    // Create enhanced visualization with v3 MMR data, best agent, all agents, and teammates
    const statsCanvas = await createStatsVisualization(
      accountData.data,
      mmrData.data,
      matchData.data || [],
      userAvatar,
      registration,
      mmrDataV3.data, // Pass v3 MMR data for enhanced display
      bestAgent, // Pass best agent stats
      sortedAgents, // Pass all agents sorted by games played
      teammateData // Pass teammate statistics
    );

    const attachment = new AttachmentBuilder(statsCanvas.toBuffer(), {
      name: "valorant-stats.png",
    });

    const statsEmbed = new EmbedBuilder()
      .setTitle(
        `📊 ${accountData.data.name}#${accountData.data.tag} - Valorant Profile`
      )
      .setColor("#ff4654")
      .setImage("attachment://valorant-stats.png")
      .setDescription(
        "Comprehensive statistics with match history and performance metrics"
      )
      .setTimestamp()
      .setFooter({ text: "Enhanced Stats v4.0" });

    const refreshButton = new ButtonBuilder()
      .setCustomId(`valstats_refresh_${message.author.id}`)
      .setLabel("Refresh Stats")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary);

    const matchesButton = new ButtonBuilder()
      .setCustomId(`valmatches_refresh_${message.author.id}`)
      .setLabel("Detailed Matches")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary);

    const mmrHistoryButton = new ButtonBuilder()
      .setCustomId(`valmmr_history_${message.author.id}`)
      .setLabel("MMR History")
      .setEmoji("📈")
      .setStyle(ButtonStyle.Secondary);

    const agentsButton = new ButtonBuilder()
      .setCustomId(`valagents_select_${message.author.id}`)
      .setLabel("My Agents")
      .setEmoji("🎮")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(
      refreshButton,
      matchesButton,
      mmrHistoryButton,
      agentsButton
    );

    await loadingMessage.edit({
      embeds: [statsEmbed],
      files: [attachment],
      components: [row],
    });
  } catch (error) {
    console.error("Error displaying stats:", error);

    let errorDesc = "There was an error fetching your Valorant statistics.";
    let isAccountError = false;

    // Check if it's likely a changed tag issue
    if (
      error.message.includes("404") ||
      error.message.includes("Could not fetch account data")
    ) {
      errorDesc = `**Could not find your Valorant account.**\n\nDid you change your Riot ID/Tag recently?\nUse \`!valupdate <NewName#Tag>\` to update it!`;
      isAccountError = true;
    }

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Error Fetching Stats")
      .setColor("#ff0000")
      .setDescription(errorDesc);

    if (!isAccountError) {
      errorEmbed.addFields({
        name: "Error Details",
        value: `\`\`\`${error.message}\`\`\``,
        inline: false,
      });
    }

    await loadingMessage.edit({ embeds: [errorEmbed] });
  }
}

// Show MMR history for a user with canvas visualization
async function showMMRHistory(message, registration) {
  const loadingEmbed = new EmbedBuilder()
    .setTitle("🔄 Loading MMR History...")
    .setColor("#ff4654")
    .setDescription("Loading your ranked progression history...")
    .setTimestamp();

  const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

  try {
    console.log(
      `Fetching MMR history for: ${registration.name}#${registration.tag}`
    );

    // Try to use cached data first (from initial !valstats call)
    const cachedData = getCachedValstatsData(message.guild?.id || 'dm', message.author.id);

    let accountData, mmrDataV3, mmrHistory;

    if (cachedData && cachedData.mmrDataV3) {
      // Use cached account and MMR data, only fetch MMR history (not cached)
      console.log('[MMR History] Using cached data from !valstats');
      accountData = cachedData.accountData;
      mmrDataV3 = cachedData.mmrDataV3;

      // MMR History isn't cached - fetch it fresh
      mmrHistory = await getMMRHistory(registration.region, registration.name, registration.tag)
        .catch(err => {
          console.warn("MMR history endpoint failed:", err.message);
          return { status: 0, data: null, error: err.message };
        });
    } else {
      // No cache - fetch all data fresh
      console.log('[MMR History] No cache available, fetching fresh data');

      const [accountResult, mmrV3Result, mmrHistoryResult] = await Promise.all([
        getAccountData(registration.name, registration.tag),
        getMMRDataV3(registration.region, registration.name, registration.tag),
        getMMRHistory(registration.region, registration.name, registration.tag),
      ]);

      accountData = accountResult?.data || { name: registration.name, tag: registration.tag };
      mmrDataV3 = mmrV3Result?.data || null;
      mmrHistory = mmrHistoryResult;
    }

    // Check if we have at least some MMR data
    const hasMMRData = mmrDataV3 || (mmrHistory?.status === 200 && mmrHistory?.data);
    if (!hasMMRData) {
      throw new Error("Could not fetch MMR data. Player may not have competitive history.");
    }

    // Get user avatar
    const userAvatar = cachedData?.userAvatar || message.author.displayAvatarURL({
      extension: "png",
      size: 256,
    });

    // Create MMR history canvas
    const mmrCanvas = await createMMRHistoryCanvas(
      accountData || { name: registration.name, tag: registration.tag },
      mmrDataV3 || null,
      mmrHistory?.data || null,
      registration,
      userAvatar
    );

    const attachment = new AttachmentBuilder(mmrCanvas.toBuffer(), {
      name: "mmr-history.png",
    });

    const statsEmbed = new EmbedBuilder()
      .setTitle(`📈 ${registration.name}#${registration.tag} - MMR History`)
      .setColor("#ff4654")
      .setImage("attachment://mmr-history.png")
      .setDescription("Ranked progression, seasonal performance, and RR tracking")
      .setTimestamp()
      .setFooter({ text: "MMR History v1.0" });

    const refreshButton = new ButtonBuilder()
      .setCustomId(`valmmr_history_${message.author.id}`)
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary);

    const backButton = new ButtonBuilder()
      .setCustomId(`valstats_refresh_${message.author.id}`)
      .setLabel("Back to Stats")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(refreshButton, backButton);

    await loadingMessage.edit({ embeds: [statsEmbed], files: [attachment], components: [row] });
  } catch (error) {
    console.error("Error displaying MMR history:", error);

    let errorDesc = "There was an error fetching your MMR history.";
    let isAccountError = false;

    if (
      error.message.includes("404") ||
      error.message.includes("Could not fetch")
    ) {
      errorDesc = `**Could not find your Valorant account.**\n\nDid you change your Riot ID/Tag recently?\nUse \`!valupdate <NewName#Tag>\` to update it!`;
      isAccountError = true;
    }

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Error Fetching MMR History")
      .setColor("#ff0000")
      .setDescription(errorDesc);

    if (!isAccountError) {
      errorEmbed.addFields({
        name: "Error Details",
        value: `\`\`\`${error.message}\`\`\``,
        inline: false,
      });
    }

    await loadingMessage.edit({ embeds: [errorEmbed] });
  }
}

// Show agent selection page with role-based menus
async function showAgentSelection(interaction, registration) {
  const currentAgents = registration.preferredAgents || [];

  // Build the embed showing current selection
  const embed = new EmbedBuilder()
    .setTitle("🎮 Preferred Agents Selection")
    .setColor("#ff4654")
    .setDescription(
      `Select up to **${MAX_PREFERRED_AGENTS} agents** you prefer to play.\n` +
      "These will be displayed when you join team lobbies.\n\n" +
      "Use the dropdowns below to select agents by role:"
    )
    .setTimestamp()
    .setFooter({ text: "Agent Selection" });

  // Show current selection
  if (currentAgents.length > 0) {
    const agentDisplay = currentAgents.map(agentId => {
      const agent = getAgentById(agentId);
      if (!agent) return agentId;
      return `${agent.emoji} **${agent.name}** (${agent.role})`;
    }).join("\n");

    embed.addFields({
      name: `✅ Current Selection (${currentAgents.length}/${MAX_PREFERRED_AGENTS})`,
      value: agentDisplay,
      inline: false,
    });
  } else {
    embed.addFields({
      name: "✅ Current Selection",
      value: "*No agents selected yet*",
      inline: false,
    });
  }

  // Create role-based select menus (Discord allows max 5 action rows, max 25 options per menu)
  const roles = getAllRoles();
  const components = [];

  for (const role of roles) {
    const roleOptions = getAgentSelectOptionsByRole(role);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`valagents_role_${role.toLowerCase()}_${interaction.user.id}`)
      .setPlaceholder(`${ROLE_EMOJIS[role]} Select ${role}s...`)
      .setMinValues(0)
      .setMaxValues(Math.min(roleOptions.length, MAX_PREFERRED_AGENTS))
      .addOptions(roleOptions.map(opt => ({
        ...opt,
        default: currentAgents.includes(opt.value),
      })));

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Add button row
  const backButton = new ButtonBuilder()
    .setCustomId(`valstats_refresh_${interaction.user.id}`)
    .setLabel("Back to Stats")
    .setEmoji("◀️")
    .setStyle(ButtonStyle.Secondary);

  const clearButton = new ButtonBuilder()
    .setCustomId(`valagents_clear_${interaction.user.id}`)
    .setLabel("Clear Selection")
    .setEmoji("🗑️")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(currentAgents.length === 0);

  const buttonRow = new ActionRowBuilder().addComponents(backButton, clearButton);
  components.push(buttonRow);

  await interaction.editReply({
    embeds: [embed],
    components,
  });
}

// Handle agent selection from menu
async function handleAgentSelection(interaction, selectedAgents) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // Update registration with new preferred agents
  const success = await updateUserRegistration(guildId, userId, {
    preferredAgents: selectedAgents,
  });

  if (!success) {
    return await interaction.reply({
      content: "❌ Failed to save agent selection. Please try again.",
      ephemeral: true,
    });
  }

  // Get updated registration to show the new selection
  const registration = await getUserRegistration(guildId, userId);

  // Show confirmation
  const agentDisplay = selectedAgents.length > 0
    ? selectedAgents.map(agentId => {
        const agent = getAgentById(agentId);
        return agent ? `${agent.emoji} ${agent.name}` : agentId;
      }).join(", ")
    : "*None selected*";

  const embed = new EmbedBuilder()
    .setTitle("✅ Agents Updated!")
    .setColor("#00ff00")
    .setDescription(`Your preferred agents have been saved.`)
    .addFields({
      name: `🎮 Selected Agents (${selectedAgents.length}/${MAX_PREFERRED_AGENTS})`,
      value: agentDisplay,
      inline: false,
    })
    .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: [],
  });

  // After a brief pause, show the full selection page again
  setTimeout(async () => {
    try {
      await showAgentSelection(interaction, registration);
    } catch {
      // Message may have been deleted or interaction expired
    }
  }, 1500);
}

// Show detailed match history with canvas visualization
async function showUserMatches(message, registration) {
  const loadingEmbed = new EmbedBuilder()
    .setTitle("🔄 Loading Detailed Match History...")
    .setColor("#ff4654")
    .setDescription("Loading your recent competitive matches...")
    .setTimestamp();

  const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

  try {
    console.log(
      `Fetching detailed matches for: ${registration.name}#${registration.tag}`
    );

    // Try to use cached data first (from initial !valstats call)
    const cachedData = getCachedValstatsData(message.guild?.id || 'dm', message.author.id);

    let accountData, matches, alreadyFiltered;

    if (cachedData && cachedData.matchData) {
      // Use cached data - no need to re-fetch!
      console.log('[Match History] Using cached data from !valstats');
      accountData = cachedData.accountData;

      // Prefer v3 matchData (already filtered for competitive by the API)
      if (cachedData.matchData && cachedData.matchData.length > 0) {
        matches = cachedData.matchData;
        alreadyFiltered = true; // v3 data is already filtered for competitive
      } else if (cachedData.storedMatchData && cachedData.storedMatchData.length > 0) {
        matches = cachedData.storedMatchData;
        alreadyFiltered = false; // stored data includes all game modes
      } else {
        matches = [];
        alreadyFiltered = true;
      }
    } else {
      // No cache - fetch fresh data
      console.log('[Match History] No cache available, fetching fresh data');

      // Fetch account data and v3 matches (already filtered for competitive)
      const [accountResult, matchResult] = await Promise.all([
        getAccountData(registration.name, registration.tag),
        getMatches(registration.region, registration.name, registration.tag).catch(err => {
          console.warn("v3 matches endpoint failed:", err.message);
          return { status: 0, data: [], error: err.message };
        })
      ]);

      accountData = accountResult?.data || { name: registration.name, tag: registration.tag };
      matches = matchResult.data || [];
      alreadyFiltered = true; // v3 data is already filtered for competitive
    }

    if (matches.length === 0) {
      const noMatchesEmbed = new EmbedBuilder()
        .setTitle("📊 No Competitive Matches Found")
        .setColor("#ffaa00")
        .setDescription(
          `No recent competitive matches found for **${registration.name}#${registration.tag}**`
        )
        .addFields({
          name: "💡 Tip",
          value: "Play some competitive matches and try again!",
          inline: false,
        })
        .setTimestamp();

      return await loadingMessage.edit({ embeds: [noMatchesEmbed] });
    }

    // Get user avatar
    const userAvatar = cachedData?.userAvatar || message.author.displayAvatarURL({
      extension: "png",
      size: 256,
    });

    // Create detailed match history canvas
    // Pass alreadyFiltered=true for v3 data (API pre-filters), false for stored matches
    const matchCanvas = await createMatchHistoryCanvas(
      accountData,
      matches,
      registration,
      userAvatar,
      alreadyFiltered
    );

    const attachment = new AttachmentBuilder(matchCanvas.toBuffer(), {
      name: "match-history.png",
    });

    const statsEmbed = new EmbedBuilder()
      .setTitle(`📊 ${registration.name}#${registration.tag} - Match History`)
      .setColor("#ff4654")
      .setImage("attachment://match-history.png")
      .setDescription("Detailed competitive match history with performance metrics")
      .setTimestamp()
      .setFooter({ text: "Match History v1.0" });

    const refreshButton = new ButtonBuilder()
      .setCustomId(`valmatches_refresh_${message.author.id}`)
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary);

    const backButton = new ButtonBuilder()
      .setCustomId(`valstats_refresh_${message.author.id}`)
      .setLabel("Back to Stats")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(refreshButton, backButton);

    await loadingMessage.edit({ embeds: [statsEmbed], files: [attachment], components: [row] });
  } catch (error) {
    console.error("Error displaying matches:", error);

    let errorDesc = "There was an error fetching your match history.";
    let isAccountError = false;

    // Check if it's likely a changed tag issue
    if (
      error.message.includes("404") ||
      error.message.includes("Could not fetch") ||
      error.message.includes("Account not found")
    ) {
      errorDesc = `**Could not find your Valorant account.**\n\nDid you change your Riot ID/Tag recently?\nUse \`!valupdate <NewName#Tag>\` to update it!`;
      isAccountError = true;
    }

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Error Fetching Matches")
      .setColor("#ff0000")
      .setDescription(errorDesc);

    if (!isAccountError) {
      errorEmbed.addFields({
        name: "Error Details",
        value: `\`\`\`${error.message}\`\`\``,
        inline: false,
      });
    }

    errorEmbed.setTimestamp();

    await loadingMessage.edit({ embeds: [errorEmbed] });
  }
}

// Get all users who reacted to a message
async function getMessageReactors(targetMessage) {
  const reactors = new Set();

  // Get all reactions from the message
  for (const reaction of targetMessage.reactions.cache.values()) {
    try {
      const users = await reaction.users.fetch();
      users.forEach((user) => {
        if (!user.bot) {
          // Exclude bots
          reactors.add(user);
        }
      });
    } catch (error) {
      console.error("Error fetching reaction users:", error);
    }
  }

  return Array.from(reactors);
}

// Get comprehensive stats for players who have registered
async function getPlayersWithStats(guildId, reactors, client) {
  const players = [];

  for (const user of reactors) {
    const registration = await getUserRegistration(guildId, user.id);
    if (!registration) {
      console.log(`User ${user.tag} is not registered`);
      continue;
    }

    try {
      // Get rank data
      const rankData = await getUserRankData(guildId, user.id);
      if (!rankData) {
        console.log(`No rank data for ${user.tag}`);
        continue;
      }

      // Get match statistics with KDA data
      const matchStats = await getPlayerMatchStats(registration);

      const currentTier = rankData.current_data?.currenttier || 0;
      const peakTier = rankData.highest_rank?.tier || currentTier;
      const currentRR = rankData.current_data?.ranking_in_tier || 0;
      const avgKDA = matchStats.avgKDA || 0;
      const winRate = matchStats.winRate || 0;
      const avgACS = matchStats.avgACS || 0;

      // Calculate skill score
      const skillScore = calculateEnhancedSkillScore(
        currentTier,
        peakTier,
        winRate,
        currentRR,
        avgKDA,
        avgACS
      );

      const rankInfo = getRankInfo(currentTier);

      players.push({
        user,
        registration,
        rankInfo,
        currentTier,
        peakTier,
        currentRR,
        avgKDA,
        winRate,
        avgACS,
        skillScore,
        mmr: calculateMMR(currentTier, currentRR),
      });

      console.log(
        `Added player ${user.tag}: Rank ${rankInfo.name}, KDA ${avgKDA.toFixed(
          2
        )}, WR ${winRate.toFixed(1)}%, Skill ${skillScore.toFixed(2)}`
      );
    } catch (error) {
      console.error(`Error getting stats for ${user.tag}:`, error);
    }
  }

  return players;
}

// Handle team creation from message reactions
async function handleCreateTeams(client, message, messageId, channelId = null) {
  const loadingEmbed = new EmbedBuilder()
    .setTitle("🔄 Creating Balanced Teams...")
    .setColor("#ff4654")
    .setDescription(
      "Analyzing player reactions and calculating comprehensive team balance..."
    )
    .setTimestamp();

  const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

  try {
    // Determine which channel to search in
    let targetChannel = message.channel;
    if (channelId) {
      try {
        targetChannel = await client.channels.fetch(channelId);
        if (!targetChannel) {
          throw new Error("Channel not found");
        }
        if (!targetChannel.isTextBased()) {
          throw new Error("Target channel is not a text channel");
        }
      } catch (error) {
        throw new Error(
          `Could not access channel ${channelId}: ${error.message}`
        );
      }
    }

    // Validate message ID format
    if (!/^\d{17,19}$/.test(messageId)) {
      throw new Error(
        "Invalid message ID format. Message IDs should be 17-19 digits long."
      );
    }

    // Attempt to fetch the target message with better error handling
    let targetMessage;
    try {
      targetMessage = await targetChannel.messages.fetch(messageId);
      if (!targetMessage) {
        throw new Error("Message not found");
      }
    } catch (fetchError) {
      if (fetchError.code === 10008) {
        throw new Error(
          `Message with ID ${messageId} was not found in ${targetChannel.name}. Please check:\n• The message ID is correct\n• The message exists in the specified channel\n• The message hasn't been deleted\n• The bot has permission to read message history`
        );
      } else if (fetchError.code === 50001) {
        throw new Error(
          `The bot doesn't have permission to access ${targetChannel.name}`
        );
      } else if (fetchError.code === 50013) {
        throw new Error(
          `The bot doesn't have permission to read message history in ${targetChannel.name}`
        );
      } else {
        throw new Error(`Failed to fetch message: ${fetchError.message}`);
      }
    }

    // Check if the message has any reactions
    if (!targetMessage.reactions.cache.size) {
      throw new Error(
        "The target message has no reactions. Players need to react to the message to be included in team creation."
      );
    }

    // Get all users who reacted to the message
    const reactors = await getMessageReactors(targetMessage);

    if (reactors.length < 2) {
      throw new Error(
        `Need at least 2 players to create teams. Found ${reactors.length} reactor(s).`
      );
    }

    // Update loading message with progress
    const progressEmbed = new EmbedBuilder()
      .setTitle("🔄 Processing Players...")
      .setColor("#ff4654")
      .setDescription(
        `Found ${reactors.length} players. Getting comprehensive Valorant stats...`
      )
      .addFields({
        name: "📊 Progress",
        value:
          "Fetching player registrations, rank data, and match statistics...",
        inline: false,
      })
      .setTimestamp();

    await loadingMessage.edit({ embeds: [progressEmbed] });

    // Get comprehensive stats for each registered player
    const players = await getPlayersWithStats(message.guild.id, reactors, client);

    if (players.length < 2) {
      const unregisteredCount = reactors.length - players.length;

      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ Not Enough Registered Players")
        .setColor("#ff0000")
        .setDescription(
          `Need at least **2 registered players** to create teams.\n\n**Found:** ${players.length}/${reactors.length} reactors registered`
        )
        .addFields(
          {
            name: "🔧 Unregistered Players - How to Fix",
            value:
              "1. Each unregistered player: Use `!valstats` in chat\n" +
              '2. Click the **"Register Now"** button\n' +
              "3. Fill in: **Valorant Name#Tag** and **region**\n" +
              "4. Wait 30 seconds for API verification\n" +
              "5. Try `!createteams` again",
            inline: false,
          },
          {
            name: "🌍 Supported Regions",
            value: "`NA`, `EU`, `AP`, `KR`, `LATAM`, `BR`",
            inline: false,
          },
          {
            name: "💡 Already Registered?",
            value: "Make sure you reacted to the message with an emoji!",
            inline: false,
          }
        )
        .setFooter({ text: `${unregisteredCount} player(s) need to register` });

      await loadingMessage.edit({ embeds: [errorEmbed] });
      return; // Exit gracefully instead of throwing
    }

    // Update loading with calculation phase
    const calcEmbed = new EmbedBuilder()
      .setTitle("⚖️ Calculating Team Balance...")
      .setColor("#ff4654")
      .setDescription(
        `Analyzing ${players.length} players using enhanced skill formula...`
      )
      .addFields({
        name: "🧮 Skill Formula Components",
        value:
          "• Current Rank (30%)\n• KDA Ratio (20%)\n• ACS (15%)\n• Win Rate (15%)\n• Peak Rank (15%)\n• Current RR (5%)",
        inline: false,
      })
      .setTimestamp();

    await loadingMessage.edit({ embeds: [calcEmbed] });

    // Create balanced teams
    const teams = createBalancedTeams(players);

    // Display the teams
    await displayBalancedTeams(
      loadingMessage,
      teams,
      reactors.length,
      players.length,
      targetChannel.name
    );
  } catch (error) {
    console.error("Error creating teams:", error);

    const errorEmbed = new EmbedBuilder()
      .setTitle("❌ Error Creating Teams")
      .setColor("#ff0000")
      .setDescription("There was an error creating balanced teams.")
      .addFields(
        {
          name: "🐛 Error Details:",
          value: `\`\`\`${error.message}\`\`\``,
          inline: false,
        },
        {
          name: "💡 Common Solutions:",
          value: [
            "• Double-check the message ID is correct",
            "• Ensure the message has reactions",
            "• Make sure players are registered with `!valstats`",
            "• Verify the bot has permission to read message history",
            "• If using a different channel, include the channel ID: `!createteams <messageId> <channelId>`",
          ].join("\n"),
          inline: false,
        },
        {
          name: "📖 Command Format:",
          value: "`!createteams <messageId> [channelId]`",
          inline: false,
        }
      )
      .setTimestamp();

    await loadingMessage.edit({ embeds: [errorEmbed] });
  }
}

// Display balanced teams with comprehensive information
async function displayBalancedTeams(
  loadingMessage,
  teams,
  totalReactors,
  registeredPlayers,
  channelName = "current channel"
) {
  const embed = new EmbedBuilder()
    .setTitle("⚖️ Enhanced Balanced Valorant Teams")
    .setColor("#ff4654")
    .setDescription(
      `Created ${teams.length} balanced teams from reactions in ${channelName}`
    )
    .addFields({
      name: "📊 Analysis Summary",
      value: `**Total Reactors:** ${totalReactors}\n**Registered Players:** ${registeredPlayers}\n**Teams Created:** ${teams.length}\n**Algorithm:** Enhanced Snake Draft with KDA`,
      inline: false,
    });

  // Add each team
  teams.forEach((team, index) => {
    const teamNumber = index + 1;
    const teamMembers = team.players
      .map((p) => {
        const rankIcon = p.rankInfo.name.charAt(0);
        return `${rankIcon} **${p.user.username}** - ${p.rankInfo.name} (${
          p.currentRR
        } RR)\n   └ KDA: ${p.avgKDA.toFixed(2)} | WR: ${p.winRate.toFixed(
          1
        )}% | Skill: ${p.skillScore.toFixed(1)}`;
      })
      .join("\n");

    embed.addFields({
      name: `👥 Team ${teamNumber} - Avg Skill: ${team.avgSkill.toFixed(2)}`,
      value: teamMembers || "No players",
      inline: false,
    });

    // Add team statistics
    embed.addFields({
      name: `📊 Team ${teamNumber} Stats`,
      value: `**Avg KDA:** ${team.avgKDA.toFixed(
        2
      )} | **Avg WR:** ${team.avgWinRate.toFixed(1)}% | **Players:** ${
        team.players.length
      }`,
      inline: false,
    });
  });

  // Add unregistered players info
  const unregisteredCount = totalReactors - registeredPlayers;
  if (unregisteredCount > 0) {
    embed.addFields({
      name: "⚠️ Unregistered Players",
      value: `${unregisteredCount} players who reacted are not registered.\nThey can use \`!valstats\` to register and be included in future team creation.`,
      inline: false,
    });
  }

  embed.setTimestamp().setFooter({
    text: "Balanced using: Current Rank (30%) + KDA (20%) + ACS (15%) + Win Rate (15%) + Peak Rank (15%) + RR (5%) • Use !valskills (admin) to view ratings",
  });

  await loadingMessage.edit({ embeds: [embed] });
}

// ===============================================
// MODULE EXPORTS AND EVENT HANDLERS
// ===============================================

module.exports = {
  // Export functions for other handlers to use
  getUserRegistration,
  getUserRankData,
  loadRankImage,
  RANK_MAPPING,
  createFallbackRankIcon,
  getAllRegisteredUsers,

  // Initialize function to set up event handlers
  init: async (client) => {
    // Only add event listeners if not already added
    if (!client._valorantApiHandlerInitialized) {
      console.log(
        "Valorant API Handler (Refactored) with KDA Integration & Stored Matches loaded successfully!"
      );
      console.log(`Registered regions: ${VALID_REGIONS.join(", ")}`);
      console.log(
        "Commands: !valstats, !valprofile, !valmatches, !esports, !createteams (admin), !valtest (admin), !valreset (admin), !vallist (admin), !valskills (admin)"
      );
      console.log(`Data file: ${USERS_FILE}`);

      client.on("messageCreate", async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return;

        const command = message.content.toLowerCase().split(" ")[0];

        // !valstats or !valprofile command - ULTIMATE TIER REQUIRED
        if (command === "!valstats" || command === "!valprofile") {
          // Check subscription tier (guild-based)
          const subCheck = await checkSubscription(
            message.guild.id,
            TIERS.ULTIMATE,
            message.guild.ownerId
          );
          if (!subCheck.hasAccess) {
            const upgradeEmbed = createUpgradeEmbed(
              "Valorant Stats",
              TIERS.ULTIMATE,
              subCheck.guildTier
            );
            return message.channel.send({ embeds: [upgradeEmbed] });
          }

          // Use migration utility to handle legacy username registrations
          const registration = await findOrMigrateUser(message.guild.id, message.author);

          // Check if registration exists AND has all required fields
          if (!registration || !registration.name || !registration.tag || !registration.region) {
            // If incomplete registration exists, remove it first so they can re-register
            if (registration) {
              await removeUserRegistration(message.guild.id, message.author.id);
            }
            await showRegistrationPrompt(message);
          } else {
            await showUserStats(message, registration);
          }
        }

        // !valupdate command
        if (command === "!valupdate") {
          const args = message.content.split(" ").slice(1);
          await handleUpdateRegistration(message, args);
        }

        // !valmatches command - ULTIMATE TIER REQUIRED
        if (command === "!valmatches") {
          // Check subscription tier (guild-based)
          const subCheck = await checkSubscription(
            message.guild.id,
            TIERS.ULTIMATE,
            message.guild.ownerId
          );
          if (!subCheck.hasAccess) {
            const upgradeEmbed = createUpgradeEmbed(
              "Valorant Match History",
              TIERS.ULTIMATE,
              subCheck.guildTier
            );
            return message.channel.send({ embeds: [upgradeEmbed] });
          }

          const registration = await findOrMigrateUser(message.guild.id, message.author);
          // Check if registration exists AND has all required fields
          if (!registration || !registration.name || !registration.tag || !registration.region) {
            await message.channel.send(
              "❌ You need to register first! Use `!valstats` to register your Valorant account."
            );
          } else {
            await showUserMatches(message, registration);
          }
        }

        // !valcompare command - Head-to-head comparison - ULTIMATE TIER REQUIRED
        if (command === "!valcompare") {
          // Check subscription tier (guild-based)
          const subCheck = await checkSubscription(
            message.guild.id,
            TIERS.ULTIMATE,
            message.guild.ownerId
          );
          if (!subCheck.hasAccess) {
            const upgradeEmbed = createUpgradeEmbed(
              "Valorant Head-to-Head",
              TIERS.ULTIMATE,
              subCheck.guildTier
            );
            return message.channel.send({ embeds: [upgradeEmbed] });
          }

          await handleValCompare(message);
        }

        // !valreset command (admin only)
        if (
          command === "!valreset" &&
          message.member.permissions.has("ADMINISTRATOR")
        ) {
          const mentionedUser = message.mentions.users.first();
          if (mentionedUser) {
            const removed = await removeUserRegistration(message.guild.id, mentionedUser.id);
            if (removed) {
              await message.channel.send(
                `✅ Reset Valorant registration for ${mentionedUser.tag}`
              );
            } else {
              await message.channel.send(
                `❌ ${mentionedUser.tag} is not registered.`
              );
            }
          } else {
            await message.channel.send(
              "❌ Please mention a user to reset their registration."
            );
          }
        }

        // !createteams command (admin only) - PLUS TIER REQUIRED
        if (
          command === "!createteams" &&
          message.member.permissions.has("ADMINISTRATOR")
        ) {
          // Check subscription tier (guild-based)
          const subCheck = await checkSubscription(
            message.guild.id,
            TIERS.PLUS,
            message.guild.ownerId
          );
          if (!subCheck.hasAccess) {
            const upgradeEmbed = createUpgradeEmbed(
              "Valorant Team Builder",
              TIERS.PLUS,
              subCheck.guildTier
            );
            await message.channel.send({ embeds: [upgradeEmbed] });
            return;
          }

          const args = message.content.split(" ").slice(1);
          if (args.length === 0) {
            const helpEmbed = new EmbedBuilder()
              .setTitle("📖 Create Teams Command Help")
              .setColor("#ff4654")
              .setDescription(
                "Create balanced Valorant teams from message reactions using comprehensive player statistics."
              )
              .addFields(
                {
                  name: "📝 Command Format",
                  value:
                    "`!createteams <messageId> [channelId]`\n\n**Examples:**\n• `!createteams 1234567890` (same channel)\n• `!createteams 1234567890 9876543210` (different channel)",
                  inline: false,
                },
                {
                  name: "🔍 How to Get Message ID",
                  value:
                    '1. Enable Developer Mode in Discord Settings\n2. Right-click any message\n3. Click "Copy Message ID"',
                  inline: false,
                }
              )
              .setTimestamp();
            await message.channel.send({ embeds: [helpEmbed] });
            return;
          }
          const messageId = args[0];
          const channelId = args[1] || null;
          await handleCreateTeams(client, message, messageId, channelId);
        }

        // !vallist command (admin only)
        if (
          command === "!vallist" &&
          message.member.permissions.has("ADMINISTRATOR")
        ) {
          const allUsers = await getAllRegisteredUsers(message.guild.id);
          if (allUsers.size === 0) {
            await message.channel.send("No registered Valorant users found.");
            return;
          }

          const embed = new EmbedBuilder()
            .setTitle("📋 Registered Valorant Users")
            .setColor("#ff4654")
            .setDescription(`Total registered users: ${allUsers.size}`)
            .setTimestamp();

          let userList = [];
          for (const [userId, userData] of allUsers) {
            try {
              const user = await client.users.fetch(userId);
              userList.push(
                `• **${user.tag}**: ${userData.name || "Unknown"}#${
                  userData.tag || "????"
                } (${(userData.region || "unknown").toUpperCase()})`
              );
            } catch (error) {
              userList.push(
                `• **Unknown User** (${userId}): ${userData.name || "Unknown"}#${
                  userData.tag || "????"
                } (${(userData.region || "unknown").toUpperCase()})`
              );
            }
          }

          // Split into chunks if too long
          const chunkSize = 10;
          for (let i = 0; i < userList.length; i += chunkSize) {
            const chunk = userList.slice(i, i + chunkSize);
            embed.addFields({
              name: `Users ${i + 1}-${Math.min(
                i + chunkSize,
                userList.length
              )}`,
              value: chunk.join("\n") || "None",
              inline: false,
            });
          }

          await message.channel.send({ embeds: [embed] });
        }

        // !valskills command (admin only) - Show skill ratings
        if (
          command === "!valskills" &&
          message.member.permissions.has("ADMINISTRATOR")
        ) {
          const allUsers = await getAllRegisteredUsers(message.guild.id);
          if (allUsers.size === 0) {
            await message.channel.send("No registered Valorant users found.");
            return;
          }

          const loadingMsg = await message.channel.send(
            "🔄 Calculating skill ratings for all users..."
          );

          const playerSkills = [];
          for (const [userId, userData] of allUsers) {
            try {
              const user = await client.users.fetch(userId);
              const rankData = await getUserRankData(message.guild.id, userId);
              if (!rankData) continue;

              const matchStats = await getPlayerMatchStats(userData);

              const currentTier = rankData.current_data?.currenttier || 0;
              const peakTier = rankData.highest_rank?.tier || currentTier;
              const currentRR = rankData.current_data?.ranking_in_tier || 0;
              const avgKDA = matchStats.avgKDA || 0;
              const winRate = matchStats.winRate || 0;
              const avgACS = matchStats.avgACS || 0;

              const skillScore = calculateEnhancedSkillScore(
                currentTier,
                peakTier,
                winRate,
                currentRR,
                avgKDA,
                avgACS
              );

              const rankInfo = getRankInfo(currentTier);

              playerSkills.push({
                user,
                rankInfo,
                skillScore,
                avgKDA,
                winRate,
              });
            } catch (error) {
              console.error(`Error getting skills for user ${userId}:`, error);
            }
          }

          // Sort by skill score
          playerSkills.sort((a, b) => b.skillScore - a.skillScore);

          const embed = new EmbedBuilder()
            .setTitle("🎯 Player Skill Ratings")
            .setColor("#ff4654")
            .setDescription(
              `Comprehensive skill ratings for ${playerSkills.length} players\n\n**Formula:** Current Rank (30%) + KDA (20%) + ACS (15%) + Win Rate (15%) + Peak Rank (15%) + RR (5%)`
            )
            .setTimestamp();

          const playerList = playerSkills
            .map((p, i) => {
              return `**${i + 1}.** ${p.user.username}\n   └ ${
                p.rankInfo.name
              } | Skill: ${p.skillScore.toFixed(2)} | KDA: ${p.avgKDA.toFixed(
                2
              )} | WR: ${p.winRate.toFixed(1)}%`;
            })
            .join("\n\n");

          // Split if too long
          if (playerList.length > 1024) {
            const chunks = playerList.match(/[\s\S]{1,1024}/g) || [];
            chunks.forEach((chunk, i) => {
              embed.addFields({
                name: i === 0 ? "📊 Rankings" : "\u200b",
                value: chunk,
                inline: false,
              });
            });
          } else {
            embed.addFields({
              name: "📊 Rankings",
              value: playerList || "No data",
              inline: false,
            });
          }

          await loadingMsg.edit({ content: null, embeds: [embed] });
        }

        // !valtest command (admin only)
        if (
          command === "!valtest" &&
          message.member.permissions.has("ADMINISTRATOR")
        ) {
          const args = message.content.split(" ").slice(1);
          if (args.length < 2) {
            await message.channel.send(
              "Usage: `!valtest <username#tag> <region>`\nExample: `!valtest Player#1234 na`"
            );
            return;
          }

          const username = args[0];
          const region = args[1].toLowerCase();

          if (!username.includes("#")) {
            await message.channel.send(
              "❌ Invalid username format! Use: Username#Tag"
            );
            return;
          }

          // Validate inputs
          const [name, tag] = username.split("#");
          const validation = validateValorantRegistration({
            name,
            tag,
            region,
          });

          if (!validation.valid) {
            const errorMessages = Object.values(validation.errors).join("\n");
            await message.channel.send(
              `❌ Validation failed:\n${errorMessages}`
            );
            return;
          }

          const {
            name: cleanName,
            tag: cleanTag,
            region: cleanRegion,
          } = validation.sanitized;

          const testEmbed = new EmbedBuilder()
            .setTitle("🧪 Testing Valorant API")
            .setColor("#ff4654")
            .setDescription(
              `Testing account: **${cleanName}#${cleanTag}** in region **${cleanRegion.toUpperCase()}**`
            )
            .setTimestamp();

          const testMessage = await message.channel.send({
            embeds: [testEmbed],
          });

          try {
            const accountData = await getAccountData(cleanName, cleanTag);

            if (accountData.status !== 200) {
              throw new Error(
                `Account not found: ${accountData.error || "Unknown error"}`
              );
            }

            const mmrData = await getMMRData(cleanRegion, cleanName, cleanTag);

            testEmbed.addFields({
              name: "✅ Account Found",
              value: `**Level:** ${
                accountData.data.account_level
              }\n**Region:** ${
                accountData.data.region
              }\n**PUUID:** ${accountData.data.puuid.substring(0, 16)}...`,
              inline: false,
            });

            if (mmrData.status === 200 && mmrData.data) {
              const currentRank = mmrData.data.current_data;
              const rankInfo = getRankInfo(currentRank?.currenttier || 0);

              testEmbed.addFields({
                name: "🏆 Rank Data",
                value: `**Current Rank:** ${rankInfo.name}\n**RR:** ${
                  currentRank?.ranking_in_tier || 0
                }\n**MMR Change:** ${
                  currentRank?.mmr_change_to_last_game || 0
                }`,
                inline: false,
              });
            } else {
              testEmbed.addFields({
                name: "⚠️ MMR Data",
                value: "No competitive rank data available",
                inline: false,
              });
            }

            testEmbed.setColor("#00ff00");
            await testMessage.edit({ embeds: [testEmbed] });
          } catch (error) {
            testEmbed.setColor("#ff0000");
            testEmbed.addFields({
              name: "❌ Error",
              value: `\`\`\`${error.message}\`\`\``,
              inline: false,
            });
            await testMessage.edit({ embeds: [testEmbed] });
          }
        }

        // !esports command - Show Valorant esports schedule
        if (command === "!esports") {
          const args = message.content.split(" ").slice(1);
          const region = args[0] ? args[0].toLowerCase().replace(/ /g, "_") : null;
          const league = args[1] ? args[1].toLowerCase() : null;

          const loadingEmbed = new EmbedBuilder()
            .setTitle("🏆 Loading Esports Schedule...")
            .setColor("#ff4654")
            .setDescription("Fetching upcoming Valorant esports matches...")
            .setTimestamp();

          const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

          try {
            const esportsData = await getEsportsSchedule(region, league);

            if (esportsData.status !== 200 && esportsData.status !== 1) {
              throw new Error(esportsData.error || "Failed to fetch esports data");
            }

            const matches = esportsData.data || [];

            if (matches.length === 0) {
              const noDataEmbed = new EmbedBuilder()
                .setTitle("🏆 Valorant Esports Schedule")
                .setColor("#ffaa00")
                .setDescription("No upcoming matches found for the specified filters.")
                .addFields({
                  name: "💡 Try Different Filters",
                  value: "`!esports` - All matches\n`!esports international` - International matches\n`!esports emea` - EMEA region\n`!esports na vct_americas` - VCT Americas",
                  inline: false,
                })
                .setTimestamp();

              return await loadingMessage.edit({ embeds: [noDataEmbed] });
            }

            // Get upcoming matches (filter out completed, limit to 10)
            const upcomingMatches = matches
              .filter(m => m.state !== "completed")
              .slice(0, 10);

            const recentMatches = matches
              .filter(m => m.state === "completed")
              .slice(0, 5);

            const embed = new EmbedBuilder()
              .setTitle("🏆 Valorant Esports Schedule")
              .setColor("#ff4654")
              .setDescription(
                region || league
                  ? `Showing matches${region ? ` for **${region.toUpperCase()}**` : ""}${league ? ` in **${league}**` : ""}`
                  : "Showing all upcoming Valorant esports matches"
              )
              .setTimestamp()
              .setFooter({ text: "Esports Schedule v1.0" });

            // Add upcoming matches
            if (upcomingMatches.length > 0) {
              const upcomingText = upcomingMatches.map(match => {
                const date = new Date(match.date);
                const dateStr = `<t:${Math.floor(date.getTime() / 1000)}:R>`;
                const leagueName = match.league?.name || "Unknown League";
                const teams = match.match?.teams || [];

                let matchInfo = `**${leagueName}**\n`;
                if (teams.length >= 2) {
                  matchInfo += `${teams[0]?.name || "TBD"} vs ${teams[1]?.name || "TBD"}\n`;
                } else if (teams.length === 1) {
                  matchInfo += `${teams[0]?.name || "TBD"} vs TBD\n`;
                }
                matchInfo += `📅 ${dateStr}`;

                return matchInfo;
              }).join("\n\n");

              embed.addFields({
                name: "📅 Upcoming Matches",
                value: upcomingText.substring(0, 1024) || "No upcoming matches",
                inline: false,
              });
            }

            // Add recent results
            if (recentMatches.length > 0) {
              const recentText = recentMatches.map(match => {
                const leagueName = match.league?.name || "Unknown League";
                const teams = match.match?.teams || [];

                let matchInfo = `**${leagueName}**\n`;
                if (teams.length >= 2) {
                  const team1 = teams[0];
                  const team2 = teams[1];
                  const winner1 = team1?.has_won ? "🏆 " : "";
                  const winner2 = team2?.has_won ? "🏆 " : "";
                  matchInfo += `${winner1}${team1?.name || "TBD"} (${team1?.game_wins || 0}) vs (${team2?.game_wins || 0}) ${winner2}${team2?.name || "TBD"}`;
                }

                if (match.vod) {
                  matchInfo += `\n[📺 VOD](${match.vod})`;
                }

                return matchInfo;
              }).join("\n\n");

              embed.addFields({
                name: "✅ Recent Results",
                value: recentText.substring(0, 1024) || "No recent results",
                inline: false,
              });
            }

            // Add usage help
            embed.addFields({
              name: "🔍 Filter Options",
              value:
                "**Regions:** `international`, `north_america`, `emea`, `brazil`, `japan`, `korea`, `oceania`\n" +
                "**Leagues:** `vct_americas`, `vct_emea`, `vct_pacific`, `champions`, `masters`, `challengers_na`\n" +
                "**Usage:** `!esports [region] [league]`",
              inline: false,
            });

            await loadingMessage.edit({ embeds: [embed] });
          } catch (error) {
            console.error("Error fetching esports data:", error);

            const errorEmbed = new EmbedBuilder()
              .setTitle("❌ Error Fetching Esports Data")
              .setColor("#ff0000")
              .setDescription("There was an error fetching the esports schedule.")
              .addFields({
                name: "Error Details",
                value: `\`\`\`${error.message}\`\`\``,
                inline: false,
              })
              .setTimestamp();

            await loadingMessage.edit({ embeds: [errorEmbed] });
          }
        }
      });

      // Handle button interactions
      client.on("interactionCreate", async (interaction) => {
        try {
          if (interaction.isButton()) {
            // Registration button
            if (interaction.customId.startsWith("valstats_register_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This registration is not for you!",
                  ephemeral: true,
                });
              }
              await showRegistrationModal(interaction);
            }

            // Refresh stats button
            if (interaction.customId.startsWith("valstats_refresh_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your stats panel!",
                  ephemeral: true,
                });
              }

              const registration = await getUserRegistration(interaction.guild.id, userId);
              if (!registration) {
                return await safeInteractionResponse(interaction, "reply", {
                  content:
                    "❌ You are not registered! Use `!valstats` to register.",
                  ephemeral: true,
                });
              }

              // Clear cache on explicit refresh to fetch fresh data
              clearCachedValstatsData(interaction.guild?.id || 'dm', userId);

              await safeInteractionResponse(interaction, "defer");
              await showUserStats(
                {
                  channel: interaction.channel,
                  author: interaction.user,
                  guild: interaction.guild,
                },
                registration
              );
            }

            // Refresh matches button
            if (interaction.customId.startsWith("valmatches_refresh_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your matches panel!",
                  ephemeral: true,
                });
              }

              const registration = await getUserRegistration(interaction.guild.id, userId);
              if (!registration) {
                return await safeInteractionResponse(interaction, "reply", {
                  content:
                    "❌ You are not registered! Use `!valstats` to register.",
                  ephemeral: true,
                });
              }

              await safeInteractionResponse(interaction, "defer");
              await showUserMatches(
                {
                  channel: interaction.channel,
                  author: interaction.user,
                },
                registration
              );
            }

            // MMR History button
            if (interaction.customId.startsWith("valmmr_history_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your MMR history panel!",
                  ephemeral: true,
                });
              }

              const registration = await getUserRegistration(interaction.guild.id, userId);
              if (!registration) {
                return await safeInteractionResponse(interaction, "reply", {
                  content:
                    "❌ You are not registered! Use `!valstats` to register.",
                  ephemeral: true,
                });
              }

              await safeInteractionResponse(interaction, "defer");
              await showMMRHistory(
                {
                  channel: interaction.channel,
                  author: interaction.user,
                },
                registration
              );
            }

            // Agent selection button
            if (interaction.customId.startsWith("valagents_select_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your agents panel!",
                  ephemeral: true,
                });
              }

              const registration = await getUserRegistration(interaction.guild.id, userId);
              if (!registration) {
                return await safeInteractionResponse(interaction, "reply", {
                  content:
                    "❌ You are not registered! Use `!valstats` to register.",
                  ephemeral: true,
                });
              }

              await safeInteractionResponse(interaction, "defer");
              await showAgentSelection(interaction, registration);
            }

            // Clear agents button
            if (interaction.customId.startsWith("valagents_clear_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your agents panel!",
                  ephemeral: true,
                });
              }

              // Clear the preferred agents
              await updateUserRegistration(interaction.guild.id, userId, {
                preferredAgents: [],
              });

              const registration = await getUserRegistration(interaction.guild.id, userId);
              await safeInteractionResponse(interaction, "defer");
              await showAgentSelection(interaction, registration);
            }
          }

          // Handle select menu interactions
          if (interaction.isStringSelectMenu()) {
            // Role-based agent selection menu (valagents_role_<role>_<userId>)
            if (interaction.customId.startsWith("valagents_role_")) {
              const parts = interaction.customId.split("_");
              const userId = parts[3];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your agents menu!",
                  ephemeral: true,
                });
              }

              const selectedRole = parts[2]; // duelist, initiator, controller, sentinel
              const selectedAgentsFromRole = interaction.values;

              // Get current registration to merge selections
              const registration = await getUserRegistration(interaction.guild.id, userId);
              if (!registration) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ You are not registered!",
                  ephemeral: true,
                });
              }

              const currentAgents = registration.preferredAgents || [];

              // Get agents from other roles (keep them)
              const otherRoleAgents = currentAgents.filter(agentId => {
                const agent = getAgentById(agentId);
                return agent && agent.role.toLowerCase() !== selectedRole;
              });

              // Merge: other roles + new selection from this role
              let newAgents = [...otherRoleAgents, ...selectedAgentsFromRole];

              // Enforce max limit
              if (newAgents.length > MAX_PREFERRED_AGENTS) {
                // Keep the most recent selections (prioritize new role selection)
                newAgents = newAgents.slice(-MAX_PREFERRED_AGENTS);
              }

              await handleAgentSelection(interaction, newAgents);
            }

            // Legacy single menu support (valagents_menu_<userId>)
            if (interaction.customId.startsWith("valagents_menu_")) {
              const userId = interaction.customId.split("_")[2];
              if (interaction.user.id !== userId) {
                return await safeInteractionResponse(interaction, "reply", {
                  content: "❌ This is not your agents menu!",
                  ephemeral: true,
                });
              }

              const selectedAgents = interaction.values;
              await handleAgentSelection(interaction, selectedAgents);
            }
          }

          // Handle modal submissions
          if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith("valstats_registration_")) {
              await handleRegistrationSubmission(interaction);
            }
          }
        } catch (error) {
          console.error("Error handling interaction:", error);
        }
      });

      client._valorantApiHandlerInitialized = true;
    }
  },
};
