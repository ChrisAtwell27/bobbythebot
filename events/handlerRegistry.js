/**
 * Handler Registry
 * This file initializes all handlers and registers them with the centralized routers
 * to reduce CPU usage by eliminating duplicate event listeners.
 */

const {
  loggingChannelId,
  alertChannelId,
  alertKeywords,
  changelogChannelId,
} = require("../data/config");

module.exports = (client, commandRouter, interactionRouter) => {
  console.log("📋 Registering handlers with centralized routers...");

  // Initialize slash command handler (integrates with interaction router)
  require("../commands/slashCommandHandler")(client, interactionRouter);

  // ==========================================
  // HANDLERS THAT NEED THEIR OWN LISTENERS
  // (These monitor specific events other than messageCreate/interactionCreate)
  // ==========================================

  // Message reaction handler - monitors reactions
  require("./messageReactionHandler")(client);

  // Logging handler - monitors message delete/update, bans
  require("./loggingHandler")(client, loggingChannelId);

  // Member count handler - monitors member joins, voice state updates
  require("./memberCountHandler")(client);

  // Booster role handler - monitors member/role updates, voice state
  require("./boosterRoleHandler")(client);

  // Changelog handler - special initialization
  require("./changelogHandler")(client, changelogChannelId);

  // Birthday handler
  require("./birthdayHandler")(client);

  // Wordle handler - needs its own listener to receive bot messages
  require("./wordleHandler")(client);

  // Bump handler - needs its own listener to receive bot messages from DISBOARD
  require("./bumpHandler")(client);

  // Guild join handler - monitors guildCreate/guildDelete for guild registration
  require("./guildJoinHandler")(client);

  // Setup reminder handler - periodically DMs owners of unconfigured servers
  require("./setupReminderHandler")(client);


  // Vote reminder handler - weekly reminders to vote on top.gg
  require("./voteReminderHandler")(client);

  // Betting handler - custom betting pools with button/modal interactions
  const bettingHandler = require("./bettingHandler");
  const bettingWrapper = createHandlerWrapper(client, () => bettingHandler);
  if (bettingWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(bettingWrapper.messageHandler);
  }
  if (bettingWrapper.interactionHandler) {
    interactionRouter.registerButton("bet_", bettingWrapper.interactionHandler);
    interactionRouter.registerModal("bet_", bettingWrapper.interactionHandler);
    interactionRouter.registerSelectMenu(
      "bet_",
      bettingWrapper.interactionHandler
    );
  }

  // ==========================================
  // MESSAGE PROCESSORS
  // (These need to see ALL messages, not just commands)
  // ==========================================

  // Alert handler - monitors for keywords in all messages
  const alertHandler = require("./alertHandler");
  const alertProcessor = createMessageProcessor(
    client,
    alertHandler,
    alertKeywords,
    alertChannelId
  );
  if (alertProcessor) {
    commandRouter.registerMessageProcessor(alertProcessor);
  }

  // Thin ice handler - monitors for profanity in messages containing "bobby"
  const thinIceHandler = require("./thinIceHandler");
  const thinIceProcessor = createMessageProcessor(client, thinIceHandler);
  if (thinIceProcessor) {
    commandRouter.registerMessageProcessor(thinIceProcessor);
  }

  // Ask handler - responds when messages contain "bobby" (includes AI chat + command suggestions)
  const askHandler = require("./askHandler");
  const askProcessor = createMessageProcessor(client, askHandler);
  if (askProcessor) {
    commandRouter.registerMessageProcessor(askProcessor);
  }

  // Note: interactionHandler.js removed - askHandler already handles Bobby mentions with AI
  // The interactionHandler was causing duplicate/conflicting responses

  // ==========================================
  // COMMAND HANDLERS
  // (These respond to specific ! commands)
  // ==========================================

  // Help handler - !help, !commands, !cmdlist, !commandlist
  const helpHandler = require("./helpHandler");
  const helpWrapper = createHandlerWrapper(client, () => helpHandler);
  if (helpWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(helpWrapper.messageHandler);
  }
  if (helpWrapper.interactionHandler) {
    interactionRouter.registerSelectMenu(
      "help_category_",
      helpWrapper.interactionHandler
    );
  }

  // Valorant rank role handler - !setrankroles, !rankroles, etc.
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./valorantRankRoleHandler"
  );

  // Debug emoji handler - !emojis, !testemoji
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./debugEmojiHandler"
  );

  // Eggbuck handler - !balance, !beg, !give, etc. (with donation button interactions)
  const eggbuckHandler = require("./eggbuckHandler");
  const eggbuckWrapper = createHandlerWrapper(client, () => eggbuckHandler);
  if (eggbuckWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(eggbuckWrapper.messageHandler);
  }
  if (eggbuckWrapper.interactionHandler) {
    // Register donate button handler (donate_userId_messageId)
    interactionRouter.registerButton(
      "donate_",
      eggbuckWrapper.interactionHandler
    );
    // Register confirm/cancel buttons for clearhoney command
    interactionRouter.registerButton(
      "confirm_reset_",
      eggbuckWrapper.interactionHandler
    );
    interactionRouter.registerButton(
      "cancel_reset_",
      eggbuckWrapper.interactionHandler
    );
  }

  // Gambling handler - !flip, !roulette, !dice, !slots
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./gamblingHandler"
  );

  // Blackjack handler - !blackjack, !bj, !hit, !stand
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./blackjackHandler"
  );

  // Baccarat handler - !baccarat
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./baccaratHandler"
  );

  // Plinko handler - !plinko
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./plinkoHandler"
  );

  // Crash handler - !crash (with button interactions for cash-out selection)
  const crashHandler = require("./crashHandler");
  const crashWrapper = createHandlerWrapper(client, () => crashHandler);
  if (crashWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(crashWrapper.messageHandler);
  }
  if (crashWrapper.interactionHandler) {
    interactionRouter.registerButton("crash_", crashWrapper.interactionHandler);
  }

  // Clip handler - !submitclip, !clips
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./clipHandler"
  );

  // Valorant team handler - !team, !createteam
  const valorantTeamHandler = require("./valorantTeamHandler");
  const valorantTeamWrapper = createHandlerWrapper(
    client,
    () => valorantTeamHandler
  );
  if (valorantTeamWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(valorantTeamWrapper.messageHandler);
  }
  if (valorantTeamWrapper.interactionHandler) {
    interactionRouter.registerButton(
      "valorant_",
      valorantTeamWrapper.interactionHandler
    );
    interactionRouter.registerModal(
      "valorant_",
      valorantTeamWrapper.interactionHandler
    );
    interactionRouter.registerSelectMenu(
      "valorant_",
      valorantTeamWrapper.interactionHandler
    );
  }

  // RaW Valorant Premiere team handler - !rawteam
  const rawValorantTeamHandler = require("./rawValorantTeamHandler");
  const rawValorantTeamWrapper = createHandlerWrapper(
    client,
    () => rawValorantTeamHandler
  );
  console.log("[DEBUG] RaW Premiere wrapper:", {
    hasMessageHandler: !!rawValorantTeamWrapper.messageHandler,
    hasInteractionHandler: !!rawValorantTeamWrapper.interactionHandler
  });
  if (rawValorantTeamWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(
      rawValorantTeamWrapper.messageHandler
    );
  }
  if (rawValorantTeamWrapper.interactionHandler) {
    console.log("[DEBUG] Registering raw_premiere_ button handler");
    interactionRouter.registerButton(
      "raw_premiere_",
      rawValorantTeamWrapper.interactionHandler
    );
    interactionRouter.registerSelectMenu(
      "raw_premiere_",
      rawValorantTeamWrapper.interactionHandler
    );
  } else {
    console.log("[DEBUG] ⚠️ rawValorantTeamWrapper has NO interactionHandler!");
  }

  // Russian roulette handler - !roulette, !spin
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./russianRouletteHandler"
  );

  // KOTH handler - !koth, !king
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./kothHandler"
  );

  // Moderation handler - !kick, !ban, !timeout
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./moderationHandler"
  );

  // Valorant map handler - !map, !mapvote
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./valorantMapHandler"
  );

  // Valorant in-house handler - !inhouse
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./valorantInhouseHandler"
  );

  // Valorant leaderboard handler - !valtop, !valleaderboard
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./valorantLeaderboardHandler"
  );

  // Note: wordleHandler registered above with direct listener (needs to see bot messages)

  // Trivia handler - !trivia
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./triviaHandler"
  );

  // Bounty handler - !bounty, !claim
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./bountyHandler"
  );

  // Shop handler - !shop, !refreshshop, !clearshop (with buy button interactions)
  const shopHandler = require("./shopHandler");
  const shopWrapper = createHandlerWrapper(client, () => shopHandler);
  if (shopWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(shopWrapper.messageHandler);
  }
  if (shopWrapper.interactionHandler) {
    interactionRouter.registerButton(
      "shop_buy_",
      shopWrapper.interactionHandler
    );
  }

  // Subscription command handler - !subscription, !sub, !tier
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./subscriptionCommandHandler"
  );

  // Settings command handler - !settings, !config, !setup
  registerCommandHandler(
    client,
    commandRouter,
    interactionRouter,
    "./settingsCommandHandler"
  );

  // Gladiator Arena handler - !gladiator, !arena, !arenastats, !arenahelp
  const gladiatorHandler = require("./gladiatorHandler");
  const gladiatorWrapper = createHandlerWrapper(client, () => gladiatorHandler);
  if (gladiatorWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(gladiatorWrapper.messageHandler);
  }
  if (gladiatorWrapper.interactionHandler) {
    interactionRouter.registerButton(
      "gladiator_",
      gladiatorWrapper.interactionHandler
    );
  }

  // Tournament handler - !tournament, !tour (bracket system for external games)
  const tournamentHandler = require("./tournamentHandler");
  const tournamentWrapper = createHandlerWrapper(
    client,
    () => tournamentHandler
  );
  if (tournamentWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(tournamentWrapper.messageHandler);
  }
  if (tournamentWrapper.interactionHandler) {
    interactionRouter.registerButton(
      "tournament_",
      tournamentWrapper.interactionHandler
    );
    interactionRouter.registerSelectMenu(
      "tournament_",
      tournamentWrapper.interactionHandler
    );
  }

  // Mafia handler - !createmafia, !join, !vote, etc.
  const mafiaHandler = require("./mafiaHandler");
  const mafiaWrapper = createHandlerWrapper(client, () => mafiaHandler);
  if (mafiaWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(mafiaWrapper.messageHandler);
  }
  if (mafiaWrapper.interactionHandler) {
    // Mafia uses custom interaction handling
    interactionRouter.registerButton("mafia_", mafiaWrapper.interactionHandler);
    interactionRouter.registerButton(
      "bee_mafia_",
      mafiaWrapper.interactionHandler
    );
    interactionRouter.registerSelectMenu(
      "mafia_",
      mafiaWrapper.interactionHandler
    );
  }

  // Craftle handler - !craftle (daily Minecraft recipe guessing game)
  const craftleHandler = require("./craftleHandler");
  const craftleWrapper = createHandlerWrapper(client, () => craftleHandler);
  if (craftleWrapper.messageHandler) {
    commandRouter.registerMessageProcessor(craftleWrapper.messageHandler);
  }
  if (craftleWrapper.interactionHandler) {
    interactionRouter.registerButton(
      "craftle_",
      craftleWrapper.interactionHandler
    );
    interactionRouter.registerSelectMenu(
      "craftle_pick_item:",
      craftleWrapper.interactionHandler
    );
  }

  // Start Craftle puzzle generation cron
  const {
    startPuzzleGenerationCron,
  } = require("../craftle/utils/puzzleGenerator");
  startPuzzleGenerationCron();

  // Valorant API handler - special initialization
  try {
    const valorantApiHandler = require("./valorantApiHandler");
    const valorantApiWrapper = createHandlerWrapper(client, () => ({
      init: valorantApiHandler.init,
    }));
    if (valorantApiHandler.init) {
      valorantApiHandler.init(client, commandRouter, interactionRouter);
    }
  } catch (error) {
    console.log("⚠️  Valorant API handler skipped:", error.message);
  }

  console.log("✅ All handlers registered with routers");
  console.log(`   Total commands: ${commandRouter.getCommandCount()}`);
  console.log(`   Total processors: ${commandRouter.getProcessorCount()}`);

  // Return the mafiaHandler for external use (webhook API)
  return {
    mafiaHandler,
  };
};

/**
 * Creates a message processor from a handler that exports a function
 */
function createMessageProcessor(client, handlerModule, ...args) {
  // Create a mock client that captures the messageCreate listener
  let capturedListener = null;
  const mockClient = {
    on: (event, listener) => {
      if (event === "messageCreate") {
        capturedListener = listener;
      }
    },
    once: client.once.bind(client),
    setMaxListeners: () => {},
    // Pass through other client properties
    user: client.user,
    users: client.users,
    guilds: client.guilds,
    channels: client.channels,
    ws: client.ws,
  };

  // Initialize the handler with the mock client
  try {
    handlerModule(mockClient, ...args);
    return capturedListener;
  } catch (error) {
    console.error(`Failed to create message processor:`, error);
    return null;
  }
}

/**
 * Creates a wrapper for a handler and registers it with routers
 */
function createHandlerWrapper(client, handlerGetter) {
  let messageListener = null;
  let interactionListener = null;

  const mockClient = {
    on: (event, listener) => {
      console.log(`[DEBUG] mockClient.on called with event: ${event}`);
      if (event === "messageCreate") {
        messageListener = listener;
      } else if (event === "interactionCreate") {
        interactionListener = listener;
      }
    },
    once: client.once.bind(client),
    setMaxListeners: () => {},
    user: client.user,
    users: client.users,
    guilds: client.guilds,
    channels: client.channels,
    ws: client.ws,
  };

  try {
    const handler = handlerGetter();
    console.log(`[DEBUG] Handler type: ${typeof handler}`);
    if (typeof handler === "function") {
      handler(mockClient);
    } else if (handler.init) {
      handler.init(mockClient);
    }

    console.log(`[DEBUG] After handler init - messageListener: ${!!messageListener}, interactionListener: ${!!interactionListener}`);
    return {
      messageHandler: messageListener,
      interactionHandler: interactionListener,
    };
  } catch (error) {
    console.error(`[DEBUG] Failed to create handler wrapper:`, error);
    return {};
  }
}

/**
 * Registers a handler with both command and interaction routers
 */
function registerCommandHandler(
  client,
  commandRouter,
  interactionRouter,
  handlerPath,
  commandAliases = null
) {
  try {
    const handler = require(handlerPath);
    const wrapper = createHandlerWrapper(client, () => handler);

    // Register message handler as a processor
    if (wrapper.messageHandler) {
      commandRouter.registerMessageProcessor(wrapper.messageHandler);
    }

    // Register interaction handler
    if (wrapper.interactionHandler) {
      // Most handlers use custom IDs that we need to discover
      // For now, just register as a general processor
      // TODO: Extract specific button/select menu IDs from each handler
    }

    return wrapper;
  } catch (error) {
    console.error(`Failed to register handler ${handlerPath}:`, error);
    return null;
  }
}
