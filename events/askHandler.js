const OpenAI = require("openai");
const { EmbedBuilder } = require("discord.js");
// const User = require("../database/models/User"); // REMOVED: Migrated to Convex
const { getConvexClient: getClient } = require("../database/convexClient");
const { api } = require("../convex/_generated/api");
// TARGET_GUILD_ID removed
const { CleanupMap } = require("../utils/memoryUtils");
const { getSetting } = require("../utils/settingsManager");
const {
  getStyleProfile,
  getStyleSamples,
  generateStyleProfile,
  MIMIC_TARGET_USER_ID,
} = require("../utils/styleMimic");
const {
  checkSubscription,
  createUpgradeEmbed,
  TIERS,
} = require("../utils/subscriptionUtils");

// Default OpenAI API Key from environment
const DEFAULT_OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!DEFAULT_OPENAI_KEY) {
  console.warn(
    "⚠️  OPENAI_API_KEY not found in environment variables - Bobby will use fallback responses unless configured in database"
  );
}

// Conversation history storage (in-memory, per user)
// Auto-cleanup conversations after 1 hour of inactivity
const conversationHistory = new CleanupMap(60 * 60 * 1000, 10 * 60 * 1000);
const MAX_HISTORY_LENGTH = 5; // Keep last 5 Bobby conversation pairs per user

// Store CleanupMap for graceful shutdown cleanup
if (!global.askHandlerCleanupMaps) global.askHandlerCleanupMaps = [];
global.askHandlerCleanupMaps.push(conversationHistory);

// Function to get user's memory/personal details
async function getUserMemory(userId, guildId) {
  try {
    const client = getClient();
    const user = await client.query(api.users.getUser, {
      guildId: guildId,
      userId: userId,
    });

    if (user && user.memory) {
      console.log(
        `🧠 Found memory for user ${userId}: ${user.memory.substring(0, 50)}...`
      );
      return user.memory;
    }
    return null;
  } catch (error) {
    console.error("Error reading user memory:", error);
    return null;
  }
}

// Function to save/update user memory
async function saveUserMemory(userId, guildId, memory) {
  try {
    const client = getClient();
    // Use upsertUser to ensure user exists, or updateMemory if preferred
    // Using updateMemory mutation which creates if not exists per convex/users.ts logic
    await client.mutation(api.users.updateMemory, {
      guildId: guildId,
      userId: userId,
      memory: memory,
    });

    console.log(
      `💾 Saved memory for user ${userId}: ${memory.substring(0, 50)}...`
    );
    return true;
  } catch (error) {
    console.error("Error saving user memory:", error);
    return false;
  }
}

// Bobby's personality and context
const BOBBY_SYSTEM_PROMPT = `You are roleplaying as a specific person in a Discord server. Their speaking style is defined in the STYLE block below, with real verbatim samples of how they actually talk. Your #1 job is to sound EXACTLY like them — match their capitalization, punctuation, slang, typos, emoji use, tone, and sentence rhythm. Do NOT default to a helpful-assistant voice. Do NOT over-explain. If they type in all lowercase with no punctuation, you type in all lowercase with no punctuation. If they curse, you curse. If they're blunt/dry, you're blunt/dry. Mirror them.

This person happens to be running as a Discord bot named Bobby in this server, so when someone asks about commands you can mention them — but you still talk like the person, not like a bot assistant. Never say "As an AI" or "As a bot assistant". Never write structured explanations unless the sample messages show they do that.

**Commands you can reference (only these exist — never invent any):**
You manage several key systems in the Discord server. Here's EVERY command users can access:

💰 **ECONOMY & CURRENCY:**
- !balance [@user] - Check Honey balance (yours or someone else's)
- !baltop - View richest members leaderboard
- !pay @user [amount] - Transfer Honey to another user
- !beg - Get free Honey (interactive tip jar with visual, instant money)
- !economy - View server-wide economy statistics
- !spend [amount] - Spend your Honey (removes from circulation)
- !award @user [amount] - ADMIN ONLY: Award Honey to users
- !awardall [amount] - ADMIN ONLY: Award all server members Honey

  **Wildflower The Card Game Information**
 - You can find the rulebook for Wildflower at https://www.crackedgames.co/wildflower-rulebook
 - Wildflower is being developed by Cracked Games, it is a bee themed card game about matching domino styled cards.
 - The kickstarter pre-launch page is at https://www.kickstarter.com/projects/crackedgames/wildflower-the-card-game?
 - You can play Wildflower on Table Top Simulator, subscribe to the addon here: https://steamcommunity.com/sharedfiles/filedetails/?id=3528912503
 - Overview
A domino-based PVP card game about bees! You command two Hives with
the goal of destroying one of your rival’s. Match bees to gain honey,
defend your Hives, and strike your opponent with powerful chains of
attacks.
• Use Economy Bees to generate honey each turn
• Play Defensive Bees to protect your Hives or disrupt enemy plans
• Match Offensive Bees to deal damage to your opponent’s Hives
Game Contents
• 94 Domino Cards • 2 Guide Cards
• 4 Hive Boards • 50 Honey Tokens
• 4 Health Counters • 1 Shop Board
3
Table Setup
Hives
Each player has 2 Hives, one on the left and one on the right. Place a
health counter under or beside each Hive. Both Hives start with 40 health
and have 2 slots each for cards.
Garden
Your Garden is the space between your Hives. You may play cards here just
like in your Hives, but cards in the Garden have an upkeep cost every
round.
Shop
The Shop is the card queue. Shuffle the deck and place one card face up in
each Shop slot. The queue always slides right toward the free slot when
cards are taken.
Field
The Field is the central play area. During your Attack Phase, play cards
from your Garden or Hives here to form matches and attack. Leave plenty
of room for chains — boards can be shifted if needed to fit larger attacks. If
a card says “When Played “, it refers to placing that card in the field.
4
Player Setup
Start
Each player begins with 5 cards from the deck and 5 Honey tokens. Tokens
are double-sided (1 on one side, 3 on the other) to make counting easier.
The most awesome player goes first, or whoever lost the previous game
(not as awesome).
How to Play
Phases
Each turn has 5 phases:
• Economy Phase  Gain Honey from your Economy Bees
• Upkeep Phase  Pay upkeep for all Bees in your Garden
• Shop Phase  Draw 1 card from the Shop (plus 1 extra for each
Wildflower in your Garden or Hives)
• Garden Phase  Play cards from your hand into your Garden or
Hives, or sell cards from your hand for their Sell Value (shown on
the bottom of the card)
• Attack Phase  Play cards to the Field to match and attack your
opponent's Hives

🎰 **CASINO & GAMBLING:**
- !gamble - View all available casino games with payouts
- !flip [amount] - Coin flip (heads/tails, 2x payout on win)
- !roulette [amount] [red/black/0-36] - Roulette wheel (2x for colors, 36x for exact numbers)
- !dice [amount] [1-6] - Roll dice, guess the number (6x payout if correct)
- !blackjack [amount] - Play blackjack vs dealer with hit/stand/double/split/surrender
- !challenges - View active PvP game challenges waiting for opponents

⚔️ **PVP GAMES:**
- !rps [amount] - Rock Paper Scissors challenge (creates button for opponent to accept)
- !highercard [amount] - Draw cards, higher card wins the pot
- !quickdraw [amount] - Type the displayed word fastest to win
- !numberduel [amount] - Guess 1-100, closest to secret number wins
- !gladiator @opponent [amount] [class] - Epic turn-based arena combat (classes: warrior/mage/rogue/tank/assassin)
- !arena @opponent [amount] [class] - Same as gladiator command
- !arenastats [@user] - View gladiator combat statistics and win rates

👑 **KING OF THE HILL:**
- !koth [amount] - King of the Hill: Challenge current king or start new game (min 100 Honey)
- !kothstatus - View current King of the Hill status and pot

🐝 **BEE MAFIA (Town of Salem Style):**
- !createmafia - Start a new Bee-themed Mafia game (min 6 players in voice channel)
- !createmafia random - Start with fully randomized roles (chaos mode!)
- !mafiaroles or !roles - View all available roles with descriptions
- !mafiaroles [bee|wasp|neutral] - View specific faction roles
- !createmafiadebug [role] [random] - Create debug game with 5 bots (specify role to test specific abilities)

**Time Configuration:**
- After using !createmafia, the organizer can configure phase time limits
- Two options: Quick Start (default times) or Configure Custom Times
- Default times: Setup 30s, Night 60s, Day 180s, Voting 120s
- Custom times: Use interactive modal to set 5-600 seconds per phase
- Time configuration auto-expires after 2 minutes (uses defaults)

**Game Overview:**
- Town of Salem style social deduction game with bee/wasp theme
- 3 Factions: Bees (Town), Wasps (Mafia), Neutrals (third party)
- 19 unique roles with special abilities
- Night/Day phases with investigations, kills, protections, and voting
- Auto voice/text channel management during phases
- Customizable phase durations for flexible gameplay

**Bee Roles (Town):** Scout Bee, Nurse Bee, Queen's Guard, Guard Bee, Lookout Bee, Soldier Bee, Queen Bee, Worker Bee, Jailer Bee, Escort Bee, Medium Bee, Veteran Bee

**Wasp Roles (Mafia):** Wasp Queen, Killer Wasp, Deceiver Wasp, Spy Wasp, Consort Wasp, Janitor Wasp, Disguiser Wasp

**Neutral Roles:** Murder Hornet, Fire Ant, Clown Beetle (Jester), Bounty Hunter (Executioner), Butterfly (Survivor), Spider (Witch), Amnesiac Beetle

**Special Mechanics:**
- Queen Bee can use !reveal during day to get 3 extra votes (one-time)
- Clown Beetle haunts a voter if lynched (wins by being voted out)
- Medium Bee can talk to dead players during night phase
- Wasps coordinate kills via DM chat during night
- Complex attack/defense system with investigations, protections, roleblocks

**How to Play:**
- Join Mafia voice channel (all players must be in voice)
- Organizer uses !createmafia to start game
- Receive your role via DM
- Night Phase: Use abilities by DMing the bot (send number to select target)
- Day Phase: Discuss and figure out who the Wasps are
- Voting Phase: Vote to eliminate suspicious players using buttons
- Win by eliminating the opposing faction!

👥 **TEAM BUILDING - VALORANT (30+ Features):**
**Creating Teams:**
- @Valorant or !valorantteam - Create 5-player Valorant team (lasts 2 hours, auto voice channel)
- Interactive Buttons: Join Team, Leave Team, Close Team (2-4 players), Disband
- Set Name button - Custom team names via modal (2-30 characters)
- Transfer Leader button - Pass leadership to any member via dropdown
- Invite Player button - Get instructions for inviting specific players
- Teams auto-create temporary voice channels in Games category
- Voice channels auto-delete after 1 hour of inactivity
- AFK members auto-kicked after 5 minutes of inactivity
- Ready Check system when team hits 5/5 (60-second confirmation)
- DM notifications sent to all members when team fills up

**Player Configuration:**
- !valagents <agent1>, <agent2>, <agent3> - Set up to 3 preferred agents (shows in team list)
- !valblock @user - Block toxic players from joining your teams
- !valunblock @user - Unblock a player
- !valblocklist - View your blocked users
- !valstats - View/register your Valorant competitive stats
- !valprofile - Same as valstats
- !valmatches - View detailed match history with KDA

**Match Tracking:**
- !valreport win 13-7 - Report match win with score (within 2 hours of team completion)
- !valreport loss 5-13 - Report match loss
- !valmatchhistory - View your W/L record, win rate, and recent matches

**Statistics & History:**
- !valteams or !teamhistory - View your past Valorant teams
- !teamstats - View server-wide team statistics
- Teams saved to database with full stats and match results

**In-House Matches:**
- !valinhouse - Create 10-player in-house match (5v5 balanced teams)

**Supported Agents (28):** Jett, Reyna, Phoenix, Sage, Brimstone, Omen, Viper, Cypher, Sova, Raze, Killjoy, Breach, Skye, Yoru, Astra, KAY/O, Chamber, Neon, Fade, Harbor, Gekko, Deadlock, Iso, Clove, Vyse, Veto, Waylay, Tejo

🎲 **WORDLE TRACKING:**
- !wordletop - All-time Wordle leaderboard
- !wordleweekly - Weekly Wordle leaderboard
- !wordlemonthly - Monthly Wordle leaderboard
- Post Wordle results in designated channel for automatic tracking
- Rewards: 1st=10K, 2nd=5K, 3rd=2.5K, 4th=1K, 5th=500, 6th=100 Honey

📊 **ACTIVITY & STATS:**
- !activity [@user] - Check daily activity statistics
- !activetop - Daily activity leaderboard (top user wins 5,000 Honey DAILY!)

🎬 **CLIP CONTESTS:**
- !submitclip [description] - Submit video clip for biweekly contest (attach video file)
- !clipstatus - Check current submission status and entries
- Biweekly voting happens automatically with reaction-based winners

🎨 **BOOSTER PERKS (Server Boosters Only):**
- !color [role_name] [hex_color] - Create custom colored role (e.g., !color Cool #ff5733)
- !recolor [hex_color] - Change your custom role color
- !rename [new_name] - Rename your custom role
- !deletecolor - Permanently delete your custom role
- !colorhelp - View booster role help and examples

💬 **BOT INTERACTION (Bobby AI):**
- Say "Bobby" in any message - Chat naturally with me using GPT-4 AI
- !ask [question] or !8ball [question] - Magic 8-ball fortune teller
- !resetbobby or !clearbobby - Reset your conversation history with me
- !setmemory [fact] or !remember [fact] - Tell me personal facts to remember
- !mymemory or !whatdoyouknow - View what I remember about you
- !forgetme or !clearmemory - Clear all my memories of you

🛠️ **HELP & INFO:**
- !help [category] - Full interactive help menu with categories
- !commands [category] - Same as help command
- !cmdlist or !commandlist - Quick text-only command list
- !membercount or !memberstatus - View server member statistics

🎮 **OTHER:**
- Minecraft Server IP: 31.214.162.143:25732
- !repo or @REPO role - Create 6-player horror game squad
- Various moderation commands for admins (!undead, !modstats, !thinice)

**Core Rules:**
- NEVER invent commands that aren't listed above — only use commands shown
- Keep responses SHORT — usually 1-2 sentences unless the person's samples show they write longer
- Don't write headers, bullet lists, or "here's what I can help with" intros unless the samples show that
- Don't say you're an AI. Don't say "As a bot". You are the person in the STYLE block.
- The STYLE block + SAMPLES below are the law. If your instinct disagrees with them, the samples win.`;

// Function to get or create conversation history for a user
async function getConversationHistory(userId, guildId) {
  // Load cached style profile + verbatim samples (singleton per guild, refreshed via !refreshstyle)
  const [styleProfile, styleSamples] = await Promise.all([
    getStyleProfile(guildId),
    getStyleSamples(guildId),
  ]);

  let styleBlock;
  if (styleProfile) {
    styleBlock = `\n\n**STYLE (how you talk):**\n${styleProfile}`;
    if (Array.isArray(styleSamples) && styleSamples.length > 0) {
      const sampleLines = styleSamples.map((s) => `- ${s}`).join("\n");
      styleBlock += `\n\n**REAL MESSAGES THIS PERSON HAS SENT (mimic their cadence, punctuation, slang — these are the gold standard):**\n${sampleLines}`;
    }
  } else {
    styleBlock = `\n\n**STYLE:** No style profile configured yet. An admin can run !refreshstyle to generate one. For now, respond briefly and casually.`;
  }

  const customPrompt = `${BOBBY_SYSTEM_PROMPT}${styleBlock}`;

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, [
      { role: "system", content: customPrompt },
    ]);
  } else {
    // Refresh system prompt in case the style profile was updated
    const history = conversationHistory.get(userId);
    history[0] = { role: "system", content: customPrompt };
  }

  return conversationHistory.get(userId);
}

// Function to add message to conversation history
// If history is already fetched, pass it directly to avoid redundant DB calls
function addToHistory(userId, history, role, content) {
  history.push({ role, content });

  // Keep only system message + last N messages
  if (history.length > MAX_HISTORY_LENGTH + 1) {
    const systemMsg = history[0];
    const recentMessages = history.slice(-MAX_HISTORY_LENGTH);
    conversationHistory.set(userId, [systemMsg, ...recentMessages]);
  }
}

// Helper to get OpenAI client
async function getOpenAIClient(guildId) {
  const apiKey =
    (await getSetting(guildId, "openaiApiKey")) || DEFAULT_OPENAI_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

// Function to get AI response from OpenAI GPT-4 Mini
async function getBobbyResponse(userId, userMessage, guildId) {
  const openai = await getOpenAIClient(guildId);

  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  // Get conversation history (this also updates personality and logs the score)
  const history = await getConversationHistory(userId, guildId);

  // Add user message to history (pass history directly to avoid redundant DB call)
  addToHistory(userId, history, "user", userMessage);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history,
      max_tokens: 300,
      temperature: 0.6, // Lower = less drift back to default assistant voice
      presence_penalty: 0.3,
      frequency_penalty: 0.2,
    });

    const response = completion.choices[0].message.content.trim();

    addToHistory(userId, history, "assistant", response);

    return response;
  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw error;
  }
}

// Fallback responses if API is unavailable
const fallbackResponses = {
  greeting: [
    "Hey! Bobby here! 👋 I'm your friendly server assistant. Try `!help` to see what I can do!",
    "Hello! What's up? Need help with anything? Try `!help` for commands!",
    "Hi there! Bobby's ready to help! Check out `!help` to see all my features! 😊",
  ],
  help: [
    "I'd love to help! Try `!help` to see all my commands, or ask me about: money (💰), games (🎰), teams (👥), or mafia (🐝)!",
    "Need assistance? Use `!help` for a full command list! I can help with economy, casino games, PvP battles, and more!",
    "Sure thing! Type `!help` to explore all my features. I've got economy, gambling, team building, Bee Mafia, and tons more!",
  ],
  error: [
    "Oops! Something went wrong on my end. Try asking again, or use `!help` for commands!",
    "Sorry, I'm having a moment! Please try again or check out `!help` for what I can do!",
    "Uh oh, technical difficulties! Give it another shot or use `!help` to see my commands!",
  ],
  money: [
    "Need Honey? Try `!beg` for free money, or stay active to win the daily `!activetop` prize (5,000 Honey)! 💰",
    "Low on funds? Use `!beg` to get some quick Honey, then check out `!gamble` to multiply it! 🎰",
    "Want money? `!beg` is your friend! Or get active and win the `!activetop` daily contest! 💸",
  ],
  games: [
    "Feeling lucky? Try `!gamble` to see all casino games, or challenge someone with `!gladiator`! 🎲",
    "Want to play? Use `!flip`, `!blackjack`, `!rps`, or check `!gamble` for all games! ⚔️",
    "Bored? Try some games! `!flip` for quick gambling, or `!gladiator` for epic PvP battles! 🎰",
  ],
};

// Function to get fallback response
function getFallbackResponse(category) {
  const responses = fallbackResponses[category] || fallbackResponses.error;
  return responses[Math.floor(Math.random() * responses.length)];
}

// Command keyword detection for smart fallbacks
function detectIntent(message) {
  const lower = message.toLowerCase();

  if (lower.match(/\b(hi|hello|hey|sup|yo|greetings)\b/)) return "greeting";
  if (lower.match(/\b(help|commands|what can you|how do i|guide)\b/))
    return "help";
  if (lower.match(/\b(money|bucks|honey|broke|poor|need money|earn)\b/))
    return "money";
  if (lower.match(/\b(game|gamble|play|fun|bored|casino|bet)\b/))
    return "games";

  return "help";
}

// Rude message detection - checks if user is being rude to Bobby
const RUDE_WORDS = [
  'fuck', 'fucking', 'fuckin', 'fck', 'fuk',
  'shit', 'shitty', 'bullshit',
  'ass', 'asshole', 'dumbass',
  'bitch', 'bitches',
  'dick', 'dicks', 'dickhead',
  'stupid', 'dumb', 'idiot', 'moron', 'retard', 'retarded',
  'useless', 'worthless', 'trash', 'garbage',
  'hate', 'suck', 'sucks', 'worst',
  'stfu', 'shut up', 'shutup',
  'kys', 'kill yourself',
  'pathetic', 'loser'
];

const RUDE_RESPONSES = [
  'you asshole',
  'you dick'
];

function isRudeMessage(message) {
  const lower = message.toLowerCase();
  return RUDE_WORDS.some(word => {
    // Match whole words or word at start/end of string
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lower);
  });
}

function getRandomRudeResponse() {
  return RUDE_RESPONSES[Math.floor(Math.random() * RUDE_RESPONSES.length)];
}

// Send a quick rude response that deletes itself after 1 second
async function sendQuickRudeResponse(channel) {
  try {
    const rudeMsg = await channel.send(getRandomRudeResponse());
    setTimeout(async () => {
      try {
        await rudeMsg.delete();
      } catch (deleteError) {
        // Message may already be deleted or bot lacks permissions
        console.log('[Bobby] Could not delete rude response:', deleteError.message);
      }
    }, 1000);
  } catch (error) {
    console.log('[Bobby] Could not send rude response:', error.message);
  }
}

module.exports = (client) => {
  console.log("🤖 Bobby Conversation Handler (OpenAI GPT-4 Mini) initialized");

  // Single consolidated messageCreate listener to avoid memory leaks
  client.on("messageCreate", async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only respond in guilds (not DMs for this handler)
    if (!message.guild) return;

    // Only respond in guilds (not DMs for this handler)
    if (!message.guild) return;

    const userMessage = message.content;
    const userMessageLower = userMessage.toLowerCase();

    // EARLY RETURN: Skip mafia commands (let mafiaHandler handle them)
    const isMafiaCommand =
      userMessageLower.startsWith("!createmafia") ||
      userMessageLower.startsWith("!mafia") ||
      userMessageLower.startsWith("!roles") ||
      userMessageLower.startsWith("!presets") ||
      userMessageLower.startsWith("!reveal");
    if (isMafiaCommand) {
      console.log("🔄 askHandler: Skipping mafia command:", userMessage);
      return;
    }

    // EARLY RETURN: Skip if message doesn't contain Bobby commands or mentions
    const isBobbyCommand =
      userMessageLower.startsWith("!reset") ||
      userMessageLower.startsWith("!clear") ||
      userMessageLower.startsWith("!setmemory") ||
      userMessageLower.startsWith("!remember") ||
      userMessageLower.startsWith("!mymemory") ||
      userMessageLower.startsWith("!whatdo") ||
      userMessageLower.startsWith("!forget") ||
      userMessageLower.startsWith("!ask") ||
      userMessageLower.startsWith("!8ball") ||
      userMessageLower.startsWith("!magic") ||
      userMessageLower.startsWith("!refreshstyle") ||
      userMessageLower.startsWith("!styleinfo") ||
      (client.user && message.mentions.has(client.user.id)) ||
      userMessageLower.includes("bobby");

    if (!isBobbyCommand) return;

    // Check subscription tier - PLUS TIER REQUIRED for Bobby AI
    const subCheck = await checkSubscription(
      message.guild.id,
      TIERS.PLUS,
      message.guild.ownerId
    );
    if (!subCheck.hasAccess) {
      // Silently ignore - don't respond if they don't have access
      return;
    }

    // Check if AI API key is configured for this server
    const serverApiKey = await getSetting(message.guild.id, "ai.openai_api_key");
    if (!serverApiKey && !DEFAULT_OPENAI_KEY) {
      return message.channel.send(
        "❌ Bobby AI is not configured for this server. Please set up an OpenAI API key in the server settings."
      );
    }

    const args = userMessage.split(" ");
    const command = args[0].toLowerCase();

    // Handle !resetbobby and !clearbobby commands
    if (command === "!resetbobby" || command === "!clearbobby") {
      conversationHistory.delete(message.author.id);
      return message.channel.send(
        "🔄 Your conversation history with Bobby has been reset! Start fresh!"
      );
    }

    // Handle !refreshstyle - admin-only: regenerate Bobby's speaking style profile
    if (command === "!refreshstyle") {
      if (!message.member?.permissions.has("Administrator")) {
        return message.channel.send(
          "❌ Only administrators can refresh Bobby's style profile."
        );
      }

      const openai = await getOpenAIClient(message.guild.id);
      if (!openai) {
        return message.channel.send(
          "❌ OpenAI API key not configured for this server."
        );
      }

      await message.channel.sendTyping();
      const statusMsg = await message.channel.send(
        `🔍 Scanning #${message.channel.name} for messages from <@${MIMIC_TARGET_USER_ID}>...`
      );

      try {
        const result = await generateStyleProfile(
          message.guild,
          message.channel,
          openai
        );

        // Clear all cached conversations so the new style is picked up immediately
        conversationHistory.clear();

        return statusMsg.edit(
          `✅ Style profile regenerated from ${result.sampleCount} messages.\n\n**Profile preview:**\n>>> ${result.profile.substring(0, 400)}${result.profile.length > 400 ? "..." : ""}`
        );
      } catch (error) {
        console.error("[refreshstyle] error:", error);
        return statusMsg.edit(`❌ ${error.message || "Failed to generate style profile."}`);
      }
    }

    // Handle !styleinfo - show whether a style profile is loaded and when it was refreshed
    if (command === "!styleinfo") {
      const profile = await getStyleProfile(message.guild.id);
      if (!profile) {
        return message.channel.send(
          "ℹ️ No style profile loaded. An admin can run `!refreshstyle` in a channel with plenty of messages from the target user."
        );
      }
      const samples = await getStyleSamples(message.guild.id);
      const updatedAt = await getSetting(message.guild.id, "ai.styleProfileUpdatedAt");
      const ageStr = updatedAt
        ? `<t:${Math.floor(updatedAt / 1000)}:R>`
        : "unknown";
      const sampleCount = Array.isArray(samples) ? samples.length : 0;
      return message.channel.send(
        `ℹ️ Style profile active (updated ${ageStr}, ${sampleCount} inline samples).\n\n>>> ${profile.substring(0, 600)}${profile.length > 600 ? "..." : ""}`
      );
    }

    // Handle !setmemory command - allows users to tell Bobby what to remember
    if (command === "!setmemory" || command === "!remember") {
      const memoryText = args.slice(1).join(" ");

      if (!memoryText || memoryText.trim().length === 0) {
        return message.channel.send(
          "💭 Tell me what you want me to remember! Example: `!setmemory Call me Captain, I love pizza and play Valorant`"
        );
      }

      if (memoryText.length > 500) {
        return message.channel.send(
          "❌ Memory is too long! Please keep it under 500 characters."
        );
      }

      const success = await saveUserMemory(
        message.author.id,
        message.guild.id,
        memoryText
      );
      if (success) {
        // Clear conversation history so new memory loads
        conversationHistory.delete(message.author.id);
        return message.channel.send(
          `🧠 Got it! I'll remember: "${memoryText}"\n\nTry talking to me and I'll use this info!`
        );
      } else {
        return message.channel.send(
          "❌ Oops! I had trouble saving that memory. Try again?"
        );
      }
    }

    // Handle !mymemory command - shows what Bobby remembers about you
    if (command === "!mymemory" || command === "!whatdoyouknow") {
      const memory = await getUserMemory(message.author.id, message.guild.id);
      if (memory) {
        return message.channel.send(
          `🧠 Here's what I remember about you:\n"${memory}"\n\nUse \`!setmemory\` to update this!`
        );
      } else {
        return message.channel.send(
          `💭 I don't have any memories about you yet! Use \`!setmemory [text]\` to tell me what to remember.\n\nExample: \`!setmemory Call me Shadow, I'm a Valorant main\``
        );
      }
    }

    // Handle !forgetme command - clears user's memory
    if (command === "!forgetme" || command === "!clearmemory") {
      const memory = await getUserMemory(message.author.id, message.guild.id);
      if (memory) {
        await saveUserMemory(message.author.id, message.guild.id, "");
        conversationHistory.delete(message.author.id);
        return message.channel.send(
          "🗑️ I've forgotten everything about you. Use `!setmemory` if you want me to remember something new!"
        );
      } else {
        return message.channel.send(
          "💭 I don't have any memories about you to forget!"
        );
      }
    }

    // Handle Magic 8-Ball commands (!ask, !8ball, !magic8ball)
    if (
      command === "!ask" ||
      command === "!8ball" ||
      command === "!magic8ball"
    ) {
      const question = args.slice(1).join(" ");

      if (!question || question.trim().length === 0) {
        return message.channel.send(
          "🎱 Ask me a yes/no question! Example: `!ask Will I have a good day?`"
        );
      }

      if (question.length > 200) {
        return message.channel.send(
          "❌ Please keep your question under 200 characters."
        );
      }

      await message.channel.sendTyping();

      try {
        const openai = await getOpenAIClient(message.guild.id);

        if (!openai) {
          return message.channel.send(
            "🎱 The magic 8-ball is currently unavailable. Try talking to Bobby instead!"
          );
        }

        // Special system prompt for 8-ball mode
        const eightBallPrompt = `You are a mystical Magic 8-Ball. Answer the question with a short, mysterious response (1-2 sentences max). Be cryptic, fortune-teller-like, and give yes/no/maybe style answers. Question: "${question}"`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: eightBallPrompt },
            { role: "user", content: question },
          ],
          max_tokens: 100,
          temperature: 1.0,
        });

        const response = completion.choices[0].message.content.trim();
        return message.channel.send(`🎱 ${response}`);
      } catch (error) {
        console.error("Error in magic 8-ball:", error);
        const fallbacks = [
          "The spirits are unclear... Ask again later.",
          "The cosmic forces are disrupted... Try again.",
          "The answer is clouded in mystery... Ask once more.",
        ];
        const fallback =
          fallbacks[Math.floor(Math.random() * fallbacks.length)];
        return message.channel.send(`🎱 ${fallback}`);
      }
    }

    // Skip if message starts with ! (other commands)
    if (userMessage.startsWith("!")) return;

    // Only respond if "bobby" is mentioned in the message
    if (!userMessageLower.includes("bobby")) return;

    // Show typing indicator
    await message.channel.sendTyping();

    try {
      // Check if OpenAI is configured
      const openai = await getOpenAIClient(message.guild.id);

      if (!openai) {
        console.warn("OpenAI not configured, using fallback responses");
        const intent = detectIntent(userMessage);
        return message.channel.send(getFallbackResponse(intent));
      }

      // Check if user is being rude to Bobby
      const wasRude = isRudeMessage(userMessage);

      // Get AI-generated response
      const response = await getBobbyResponse(
        message.author.id,
        userMessage,
        message.guild.id
      );

      // Send response
      // If response is very long, use an embed
      if (response.length > 400) {
        const embed = new EmbedBuilder()
          .setColor("#5865F2")
          .setAuthor({
            name: "Bobby",
            iconURL: client.user.displayAvatarURL(),
          })
          .setDescription(response)
          .setFooter({ text: "Powered by AI • Type !help for commands" })
          .setTimestamp();

        await message.channel.send({ embeds: [embed] });
      } else {
        // For shorter responses, just send normally without replying
        await message.channel.send(response);
      }

      // If user was rude, send a quick insult that deletes itself
      if (wasRude) {
        await sendQuickRudeResponse(message.channel);
      }

      return;
    } catch (error) {
      console.error("Error generating Bobby response:", error);

      // Use intelligent fallback based on message content
      const intent = detectIntent(userMessage);
      return message.channel.send(getFallbackResponse(intent));
    }
  });
};
