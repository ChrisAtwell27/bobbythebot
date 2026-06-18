const { Client, GatewayIntentBits, Partials } = require("discord.js");
const http = require("http");
const https = require("https");

// Load environment variables
require("dotenv").config();

// Global error handlers
process.on("unhandledRejection", (error) => {
  console.error("[ERROR] Unhandled promise rejection:", error);
});

let crashCount = 0;
const MAX_CRASH_COUNT = 5;
const CRASH_RESET_TIME = 60000; // Reset crash counter after 1 minute

process.on("uncaughtException", (error) => {
  console.error("[CRITICAL] Uncaught exception:", error);
  crashCount++;

  if (crashCount >= MAX_CRASH_COUNT) {
    console.error(
      `[CRITICAL] Bot crashed ${MAX_CRASH_COUNT} times. Exiting...`
    );
    setTimeout(() => process.exit(1), 1000);
  } else {
    console.log(
      `[RECOVERY] Crash ${crashCount}/${MAX_CRASH_COUNT}. Bot will attempt to continue...`
    );
    // Reset crash counter after a minute of stability
    setTimeout(() => {
      if (crashCount > 0) {
        console.log("[RECOVERY] Reset crash counter after stability period");
        crashCount = 0;
      }
    }, CRASH_RESET_TIME);
  }
});

// Load configuration values
const {
  loggingChannelId,
  alertChannelId,
  alertKeywords,
  changelogChannelId,
} = require("./data/config");

// Initialize database connection
const {
  connectToDatabase,
  disconnectFromDatabase,
} = require("./database/connection");
const { destroyAllCleanupMaps } = require("./utils/memoryUtils");
connectToDatabase().catch((err) => {
  console.error("Failed to initialize database:", err);
  console.error("Bot will exit due to database connection failure");
  process.exit(1);
});

// Create the client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Discord client error handlers
client.on("error", (error) => {
  console.error("[DISCORD] Client error:", error);
});

client.on("shardError", (error) => {
  console.error("[DISCORD] Shard error:", error);
});

client.on("shardDisconnect", (event, shardId) => {
  console.warn(`[DISCORD] Shard ${shardId} disconnected. Code: ${event.code}`);
  console.warn(
    "[DISCORD] ⚠️ Connection lost! Bot will attempt to reconnect..."
  );
});

client.on("shardReconnecting", (shardId) => {
  console.log(`[DISCORD] Shard ${shardId} attempting to reconnect...`);
});

client.on("shardResume", (shardId, replayedEvents) => {
  console.log(
    `[DISCORD] Shard ${shardId} resumed. Replayed ${replayedEvents} events.`
  );
});

// Track connection state
client.on("ready", () => {
  console.log("[DISCORD] ✅ WebSocket connection established");
});

client.on("invalidSession", () => {
  console.error("[DISCORD] ❌ Invalid session! Reconnecting...");
});

// Handle rate limits
client.rest.on("rateLimited", (info) => {
  console.warn(
    `[DISCORD] Rate limited! Timeout: ${info.timeout}ms, Limit: ${info.limit}, Method: ${info.method}, Path: ${info.route}`
  );
});

// Monitor WebSocket status every 30 seconds
let consecutiveDisconnects = 0;
const DISCONNECT_THRESHOLD = 3; // Force restart after 3 consecutive disconnect checks

setInterval(() => {
  const wsStatus = client.ws.status;
  const wsStatusText =
    [
      "READY",
      "CONNECTING",
      "RECONNECTING",
      "IDLE",
      "NEARLY",
      "DISCONNECTED",
      "WAITING_FOR_GUILDS",
      "IDENTIFYING",
      "RESUMING",
    ][wsStatus] || "UNKNOWN";
  const ping = client.ws.ping;

  if (wsStatus !== 0) {
    // 0 = READY
    consecutiveDisconnects++;
    console.warn(
      `[DISCORD] ⚠️ WebSocket NOT READY! Status: ${wsStatusText} (${wsStatus}) | Ping: ${ping}ms | Consecutive disconnects: ${consecutiveDisconnects}`
    );

    // If disconnected for too long, force restart
    if (consecutiveDisconnects >= DISCONNECT_THRESHOLD) {
      console.error(
        `[DISCORD] 🚨 Bot has been disconnected for ${DISCONNECT_THRESHOLD * 30}s. Forcing restart...`
      );
      process.exit(1);
    }
  } else {
    // Reset counter when connected
    if (consecutiveDisconnects > 0) {
      console.log(
        `[DISCORD] ✅ Reconnected successfully after ${consecutiveDisconnects} disconnect checks`
      );
      consecutiveDisconnects = 0;
    }

    if (ping > 500) {
      console.warn(`[DISCORD] ⚠️ High ping detected: ${ping}ms`);
    }
  }
}, 30000);

// Watchdog: Detect complete process freeze
let lastHeartbeat = Date.now();
let watchdogAlive = true;

// Update heartbeat every 10 seconds
setInterval(() => {
  lastHeartbeat = Date.now();
  watchdogAlive = true;
}, 10000);

// Check heartbeat every 15 seconds
setInterval(() => {
  const timeSinceHeartbeat = Date.now() - lastHeartbeat;

  if (!watchdogAlive || timeSinceHeartbeat > 20000) {
    console.error(
      `[WATCHDOG] 🚨 Process appears frozen! Time since last heartbeat: ${timeSinceHeartbeat}ms`
    );
    console.error("[WATCHDOG] Forcing process exit to allow restart...");
    process.exit(1);
  }

  watchdogAlive = false;
}, 15000);

// CPU Monitoring using OS-level metrics
const os = require("os");
let lastCpuInfo = os.cpus();
let highCpuWarningCount = 0;

function getSystemCPUUsage() {
  const currentCpuInfo = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < currentCpuInfo.length; i++) {
    const current = currentCpuInfo[i];
    const last = lastCpuInfo[i];

    const currentTick = Object.values(current.times).reduce((a, b) => a + b, 0);
    const lastTick = Object.values(last.times).reduce((a, b) => a + b, 0);

    const currentIdle = current.times.idle;
    const lastIdle = last.times.idle;

    totalIdle += currentIdle - lastIdle;
    totalTick += currentTick - lastTick;
  }

  const idle = totalIdle / currentCpuInfo.length;
  const total = totalTick / currentCpuInfo.length;

  // Prevent division by zero on first call
  if (total === 0) {
    lastCpuInfo = currentCpuInfo;
    return 0;
  }

  const usage = 100 - (100 * idle) / total;

  lastCpuInfo = currentCpuInfo;
  return usage;
}

setInterval(() => {
  const systemCpuPercent = getSystemCPUUsage();
  const currentMemory = process.memoryUsage();

  // Memory in MB
  const heapUsedMB = (currentMemory.heapUsed / 1024 / 1024).toFixed(2);
  const heapTotalMB = (currentMemory.heapTotal / 1024 / 1024).toFixed(2);
  const rssMB = (currentMemory.rss / 1024 / 1024).toFixed(2);

  // Load average
  const loadAvg = os.loadavg();
  const load1m = loadAvg[0].toFixed(2);

  // Log if CPU is high (over 50%)
  if (systemCpuPercent > 50) {
    highCpuWarningCount++;
    console.warn(
      `[CPU] 🚨 HIGH SYSTEM CPU: ${systemCpuPercent.toFixed(2)}% | Load: ${load1m} | Memory: ${heapUsedMB}/${heapTotalMB}MB heap, ${rssMB}MB RSS | Warning #${highCpuWarningCount}`
    );
  } else if (systemCpuPercent > 30) {
    console.log(
      `[CPU] Elevated system CPU: ${systemCpuPercent.toFixed(2)}% | Load: ${load1m} | Memory: ${heapUsedMB}/${heapTotalMB}MB heap, ${rssMB}MB RSS`
    );
  }

}, 5000); // Check every 5 seconds

// Initialize centralized routers FIRST to reduce CPU usage
// This replaces 33+ individual messageCreate listeners with 1 central router
console.log("[INIT] 🚀 Initializing centralized event routing system...");
const commandRouter = require("./events/commandRouter")(client);
const interactionRouter = require("./events/interactionRouter")(client);

// Initialize all handlers through the registry
// Handlers will register with the routers instead of creating individual listeners
const { mafiaHandler } = require("./events/handlerRegistry")(
  client,
  commandRouter,
  interactionRouter
);
console.log(
  "[INIT] ✅ All handlers registered with centralized routers (97% CPU reduction)"
);

// Create HTTP server that proxies webhook API requests
// This starts IMMEDIATELY so App Platform health checks pass
const PORT = process.env.PORT || 8080;
const WEBHOOK_PORT = process.env.MAFIA_WEBHOOK_PORT || 3001;
const SUBSCRIPTION_PORT = process.env.SUBSCRIPTION_API_PORT || 3002;

const server = http.createServer((req, res) => {
  // Add CORS headers for all requests
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Webhook-Signature, X-API-Key, X-Discord-Token",
    "Access-Control-Max-Age": "86400",
  };

  // Handle OPTIONS preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Handle health checks for App Platform
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(
      JSON.stringify({
        status: "ok",
        botStatus: client.ws.status === 0 ? "ready" : "not ready",
        uptime: process.uptime(),
      })
    );
    return;
  }

  // Determine which internal API to proxy to based on path
  let targetPort = WEBHOOK_PORT;
  let apiName = "Webhook API";

  // Route /api/subscription/* to the Subscription API on port 3002
  if (req.url.startsWith("/api/subscription")) {
    targetPort = SUBSCRIPTION_PORT;
    apiName = "Subscription API";
  }

  // Route /api/settings/* to the Settings API on port 3003
  if (req.url.startsWith("/api/settings")) {
    targetPort = process.env.SETTINGS_API_PORT || 3003;
    apiName = "Settings API";
  }

  // Proxy /api/* requests to the appropriate internal API
  if (req.url.startsWith("/api/")) {
    // Forward the request to the target API
    const options = {
      hostname: "localhost",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // Get headers from API but REMOVE any CORS headers to avoid duplicates
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["access-control-allow-origin"];
      delete responseHeaders["access-control-allow-methods"];
      delete responseHeaders["access-control-allow-headers"];
      delete responseHeaders["access-control-max-age"];

      // Add our CORS headers (only once!)
      Object.assign(responseHeaders, corsHeaders);

      // Forward the response headers with CORS
      res.writeHead(proxyRes.statusCode, responseHeaders);
      // Pipe the response back to the client
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (error) => {
      console.error(`Proxy error (${apiName}):`, error);
      res.writeHead(502, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(
        JSON.stringify({
          success: false,
          error: `${apiName} not available`,
          message: `The ${apiName} server is not running yet. Please wait for Discord client to connect.`,
        })
      );
    });

    // Pipe the request body to the proxy request
    req.pipe(proxyReq);
    return;
  }

  // 404 for other routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Not Found",
      hint: "Use /health for health checks, /api/subscription/* for subscription API, or /api/* for webhook API endpoints",
    })
  );
});

server.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use`);
  } else {
    console.error("HTTP server error:", error);
  }
});

// Initialize Mafia Webhook API server on port 3001 (internal only)
let mafiaWebhookServer = null;
if (process.env.MAFIA_WEBHOOK_ENABLED !== "false") {
  const MafiaWebhookServer = require("./api/mafiaWebhookServer");
  const webhookPort = process.env.MAFIA_WEBHOOK_PORT || 3001;

  // Wait for client to be ready before starting webhook server
  client.once("ready", () => {
    try {
      mafiaWebhookServer = new MafiaWebhookServer(
        client,
        mafiaHandler.getActiveGames()
      );
      mafiaWebhookServer.start(webhookPort);
    } catch (error) {
      console.error("Failed to start Mafia Webhook API:", error);
    }
  });
}

// Initialize Subscription Verification API server on port 3002
let subscriptionServer = null;
if (process.env.SUBSCRIPTION_API_ENABLED !== "false") {
  const SubscriptionServer = require("./api/subscriptionServer");
  const subscriptionPort = process.env.SUBSCRIPTION_API_PORT || 3002;

  // Wait for client to be ready before starting subscription server
  client.once("ready", () => {
    try {
      subscriptionServer = new SubscriptionServer(client);
      subscriptionServer.start(subscriptionPort);
    } catch (error) {
      console.error("Failed to start Subscription API:", error);
    }
  });
}

// Initialize Settings API server on port 3003
let settingsServer = null;
if (process.env.SETTINGS_API_ENABLED !== "false") {
  const SettingsServer = require("./api/settingsServer");
  const settingsPort = process.env.SETTINGS_API_PORT || 3003;

  client.once("ready", () => {
    try {
      settingsServer = new SettingsServer(client);
      settingsServer.start(settingsPort);
    } catch (error) {
      console.error("Failed to start Settings API:", error);
    }
  });
}

// Start the bot - Enhanced Verification System
const {
  setupVerificationChannel,
  handleMemberJoin,
  handleVerificationInteraction,
} = require("./events/enhancedVerification");

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Log all servers the bot is in
  console.log("\n=== Servers this bot is in ===");
  for (const guild of client.guilds.cache.values()) {
    console.log(
      `- ${guild.name} (ID: ${guild.id}) - ${guild.memberCount} members`
    );
  }
  console.log("==============================\n");

  // Setup verification channels for all guilds (enhanced verification with button-based system)
  for (const guild of client.guilds.cache.values()) {
    try {
      await setupVerificationChannel(guild);
    } catch (error) {
      console.error(
        `Failed to setup verification for guild ${guild.name}:`,
        error
      );
    }
  }
});

// Handle new member joins with enhanced security checks (raid detection, suspicious patterns)
client.on("guildMemberAdd", async (member) => {
  try {
    await handleMemberJoin(member);
  } catch (error) {
    console.error("Error handling member join:", error);
  }
});

// Handle verification button interactions
client.on("interactionCreate", async (interaction) => {
  // Only handle verification-related button interactions
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("verify_")) return;

  try {
    await handleVerificationInteraction(interaction);
  } catch (error) {
    console.error("Error handling verification interaction:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "An error occurred during verification. Please try again.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, starting graceful shutdown...`);

  // Close HTTP server
  server.close(() => {
    console.log("HTTP server closed");
  });

  // Stop mafia webhook server
  if (mafiaWebhookServer) {
    try {
      mafiaWebhookServer.stop();
      console.log("Mafia webhook server stopped");
    } catch (error) {
      console.error("Error stopping mafia webhook server:", error);
    }
  }

  // Stop subscription server
  if (subscriptionServer) {
    try {
      subscriptionServer.stop();
      console.log("Subscription server stopped");
    } catch (error) {
      console.error("Error stopping subscription server:", error);
    }
  }

  // Clear all intervals
  const intervalArrays = [
    global.alertHandlerIntervals,
    global.changelogHandlerIntervals,
    global.moderationHandlerIntervals,
    global.bountyHandlerIntervals,
    global.mafiaHandlerIntervals,
    global.registrationManagerIntervals,
    global.setupReminderIntervals,
    global.voteReminderIntervals,
  ];

  let clearedCount = 0;
  intervalArrays.forEach((arr) => {
    if (Array.isArray(arr)) {
      arr.forEach((interval) => {
        clearInterval(interval);
        clearedCount++;
      });
    }
  });

  if (clearedCount > 0) {
    console.log(`Cleared ${clearedCount} interval timers`);
  }

  // Destroy all CleanupMaps to stop their internal cleanup timers
  const destroyedCount = destroyAllCleanupMaps();
  if (destroyedCount > 0) {
    console.log(`Destroyed ${destroyedCount} CleanupMap instances`);
  }

  // Disconnect from database
  disconnectFromDatabase().catch((err) => {
    console.error("Error disconnecting from database:", err);
  });

  // Destroy Discord client
  client.destroy();
  console.log("Discord client disconnected");

  // Exit process
  setTimeout(() => {
    console.log("Shutdown complete");
    process.exit(0);
  }, 1000);
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
  console.error("Failed to login to Discord:", error);
  process.exit(1);
});
