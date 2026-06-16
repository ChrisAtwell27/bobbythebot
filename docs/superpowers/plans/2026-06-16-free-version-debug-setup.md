# Free Version, /debug, and In-Discord Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin `/debug` command, ship a single-flag "free version" that exposes only security + wordle (bypassing subscriptions and removing all upgrade popups, without deleting code), add admin-only `/setup` slash commands so server admins configure everything inside Discord, and add a per-server wordle leaderboard scope toggle (private/global).

**Architecture:** A new `config/freeVersion.js` is the single source of truth for what's enabled; it gates handler loading in `events/handlerRegistry.js` and slash-command registration/deployment in `commands/slashCommandBuilder.js` + `commands/slashCommandHandler.js`. `/debug` and `/setup` are new slash commands following the existing `verification-setup` pattern (`{ data, execute }` → builder + `registerSlashCommand`). Subscription code is left intact but never reached.

**Tech Stack:** Node 20, discord.js v14.15, Convex-backed settings via `utils/settingsManager.js`, `node --test` (built-in) for pure-logic unit tests.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `config/freeVersion.js` | Create | Source of truth: `FREE_VERSION` flag + allow-lists + `isHandlerEnabled` / `isSlashCommandEnabled` |
| `tests/freeVersion.test.js` | Create | Unit tests for the gating predicates |
| `utils/debugInfo.js` | Create | Gather host/runtime/IP/git info into a plain object |
| `tests/debugInfo.test.js` | Create | Unit tests for debugInfo shape + fallbacks |
| `commands/debugCommand.js` | Create | `{ data, execute }` for `/debug` (admin-gated, ephemeral) |
| `commands/setup.js` | Create | `{ data, execute }` for `/setup` (wordle/logging/admin-roles/overview) |
| `commands/slashCommandBuilder.js` | Modify | Push `/debug` + `/setup` builders; filter exported list when free |
| `commands/slashCommandHandler.js` | Modify | Register `/debug` + `/setup` handlers; skip disabled ones |
| `events/handlerRegistry.js` | Modify | Gate every handler registration via `isHandlerEnabled(key)` |
| `convex/wordle.ts` | Modify | Add `getGlobalLeaderboard` query aggregating global-opted servers |
| `commands/setup.js` | Modify | Add `/setup wordle scope` subcommand (private/global) |
| `events/wordleHandler.js` (+ leaderboard command) | Modify | Expose a global leaderboard view |

**Testing note:** `package.json`'s `test` script is a stub and the project has no test framework. This plan adds `node --test` (built into Node 20, no new dependency) for the two pure-logic modules. Discord-integration pieces (slash handlers, registry gating end-to-end) are verified manually — they require a live bot and cannot be meaningfully unit-tested. Each such task has explicit manual verification steps.

---

## Task 1: Set up the `node --test` script

**Files:**
- Modify: `package.json:7`

- [ ] **Step 1: Update the test script**

Change the `scripts.test` line from the stub to run Node's built-in test runner over `tests/`:

```json
  "scripts": {
    "start": "node index.js",
    "test": "node --test tests/"
  },
```

- [ ] **Step 2: Verify the runner works (no tests yet → passes with 0 tests)**

Run: `npm test`
Expected: exits 0, output like `tests 0` / `pass 0` (Node reports no test files but does not fail). If your Node version errors on an empty dir, that's fine — Task 2 adds the first test file.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: use node --test for unit tests"
```

---

## Task 2: `config/freeVersion.js` — gating predicates (TDD)

**Files:**
- Create: `config/freeVersion.js`
- Test: `tests/freeVersion.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/freeVersion.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");

// Force free mode ON for this test process before requiring the module.
process.env.FREE_VERSION = "true";
const fv = require("../config/freeVersion");

test("FREE_VERSION is on when env is 'true'", () => {
  assert.strictEqual(fv.FREE_VERSION, true);
});

test("isHandlerEnabled allows allow-listed handlers", () => {
  assert.strictEqual(fv.isHandlerEnabled("wordle"), true);
  assert.strictEqual(fv.isHandlerEnabled("verification"), true);
  assert.strictEqual(fv.isHandlerEnabled("logging"), true);
  assert.strictEqual(fv.isHandlerEnabled("moderation"), true);
});

test("isHandlerEnabled blocks non-allow-listed handlers when free", () => {
  assert.strictEqual(fv.isHandlerEnabled("blackjack"), false);
  assert.strictEqual(fv.isHandlerEnabled("mafia"), false);
  assert.strictEqual(fv.isHandlerEnabled("trivia"), false);
  assert.strictEqual(fv.isHandlerEnabled("eggbuck"), false);
});

test("isSlashCommandEnabled honors the slash allow-list when free", () => {
  assert.strictEqual(fv.isSlashCommandEnabled("debug"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("setup"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("help"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("verification-setup"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("balance"), false);
  assert.strictEqual(fv.isSlashCommandEnabled("blackjack"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../config/freeVersion'`.

- [ ] **Step 3: Write the implementation**

Create `config/freeVersion.js`:

```js
/**
 * Free Version configuration.
 *
 * Single source of truth for the "toned-down" build that ships only the
 * security suite (verification, moderation, logging) and wordle. When
 * FREE_VERSION is on, only allow-listed handlers load and only allow-listed
 * slash commands register/deploy. Nothing is deleted — set FREE_VERSION=false
 * to restore the full paid bot.
 */

// Default ON for this build. Set FREE_VERSION=false in the environment to run
// the full paid bot.
const FREE_VERSION = process.env.FREE_VERSION !== "false";

// Handler keys that stay enabled in the free build. These keys are passed at
// each registration site in events/handlerRegistry.js.
const ENABLED_HANDLERS = new Set([
  // Security suite
  "verification",
  "moderation",
  "logging",
  // Wordle
  "wordle",
  // Infrastructure (must keep the bot usable + registrable)
  "help",
  "guildJoin",
]);

// Slash command names that stay registered/deployed in the free build.
const ENABLED_SLASH_COMMANDS = new Set([
  "help",
  "debug",
  "setup",
  "verification-setup",
]);

function isHandlerEnabled(key) {
  if (!FREE_VERSION) return true;
  return ENABLED_HANDLERS.has(key);
}

function isSlashCommandEnabled(name) {
  if (!FREE_VERSION) return true;
  return ENABLED_SLASH_COMMANDS.has(name);
}

module.exports = {
  FREE_VERSION,
  ENABLED_HANDLERS,
  ENABLED_SLASH_COMMANDS,
  isHandlerEnabled,
  isSlashCommandEnabled,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 `freeVersion` tests green.

- [ ] **Step 5: Commit**

```bash
git add config/freeVersion.js tests/freeVersion.test.js
git commit -m "feat: add freeVersion config with handler/command allow-lists"
```

---

## Task 3: `utils/debugInfo.js` — gather host/runtime info (TDD)

**Files:**
- Create: `utils/debugInfo.js`
- Test: `tests/debugInfo.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/debugInfo.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { gatherDebugInfo, detectHostingPlatform } = require("../utils/debugInfo");

test("detectHostingPlatform finds a known platform env var", () => {
  const platform = detectHostingPlatform({ RAILWAY_PROJECT_ID: "abc" });
  assert.strictEqual(platform, "Railway");
});

test("detectHostingPlatform returns 'Unknown' when nothing matches", () => {
  assert.strictEqual(detectHostingPlatform({}), "Unknown");
});

test("gatherDebugInfo returns the expected keys and never throws", async () => {
  // skipPublicIp avoids a real network call in tests.
  const info = await gatherDebugInfo({ skipPublicIp: true });
  for (const key of [
    "hostname",
    "platform",
    "arch",
    "nodeVersion",
    "uptimeSeconds",
    "memoryMB",
    "isDocker",
    "hostingPlatform",
    "publicIp",
    "gitCommit",
    "pid",
    "cwd",
  ]) {
    assert.ok(key in info, `missing key: ${key}`);
  }
  assert.strictEqual(info.publicIp, "skipped");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../utils/debugInfo'`.

- [ ] **Step 3: Write the implementation**

Create `utils/debugInfo.js`:

```js
/**
 * Debug info gathering for the /debug command.
 * Collects non-sensitive host/runtime signals that help identify where the bot
 * is deployed. Never returns secret values — only presence flags and
 * non-sensitive identifiers.
 */

const os = require("os");
const fs = require("fs");
const { execSync } = require("child_process");

// Map of known hosting platforms to an env var whose presence identifies them.
const PLATFORM_SIGNATURES = [
  ["Railway", (e) => e.RAILWAY_PROJECT_ID || e.RAILWAY_ENVIRONMENT],
  ["Render", (e) => e.RENDER || e.RENDER_SERVICE_ID],
  ["Fly.io", (e) => e.FLY_APP_NAME || e.FLY_ALLOC_ID],
  ["Heroku", (e) => e.DYNO],
  ["Koyeb", (e) => e.KOYEB_APP_NAME || e.KOYEB_SERVICE_ID],
  ["Google Cloud Run", (e) => e.K_SERVICE],
  ["Vercel", (e) => e.VERCEL],
  ["AWS", (e) => e.AWS_EXECUTION_ENV || e.AWS_REGION],
  ["Replit", (e) => e.REPL_ID],
];

function detectHostingPlatform(env = process.env) {
  for (const [name, probe] of PLATFORM_SIGNATURES) {
    if (probe(env)) return name;
  }
  return "Unknown";
}

function isRunningInDocker() {
  try {
    if (fs.existsSync("/.dockerenv")) return true;
    if (fs.existsSync("/proc/self/cgroup")) {
      return fs.readFileSync("/proc/self/cgroup", "utf8").includes("docker");
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

function getGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch (_) {
    return "unknown";
  }
}

async function getPublicIp() {
  try {
    const axios = require("axios");
    const res = await axios.get("https://api.ipify.org", { timeout: 3000 });
    return String(res.data).trim();
  } catch (_) {
    return "unavailable";
  }
}

/**
 * Gather all debug info.
 * @param {{ skipPublicIp?: boolean }} opts
 */
async function gatherDebugInfo(opts = {}) {
  const mem = process.memoryUsage();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    osType: os.type(),
    arch: os.arch(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    isDocker: isRunningInDocker(),
    hostingPlatform: detectHostingPlatform(),
    publicIp: opts.skipPublicIp ? "skipped" : await getPublicIp(),
    gitCommit: getGitCommit(),
    pid: process.pid,
    cwd: process.cwd(),
  };
}

module.exports = {
  gatherDebugInfo,
  detectHostingPlatform,
  isRunningInDocker,
  getGitCommit,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `debugInfo` tests green (plus the `freeVersion` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add utils/debugInfo.js tests/debugInfo.test.js
git commit -m "feat: add debugInfo host/runtime gatherer"
```

---

## Task 4: `/debug` command module

**Files:**
- Create: `commands/debugCommand.js`

- [ ] **Step 1: Write the command module**

Create `commands/debugCommand.js`:

```js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { gatherDebugInfo } = require("../utils/debugInfo");
const { hasAdminPermission } = require("../utils/adminPermissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug")
    .setDescription("Show bot hosting and runtime info (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Runtime admin re-check (covers configured adminRoles, not just Discord admins).
    const isAdmin = await hasAdminPermission(
      interaction.member,
      interaction.guild.id
    );
    if (!isAdmin) {
      return interaction.reply({
        content: "❌ You need admin permissions to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const info = await gatherDebugInfo();
    const client = interaction.client;
    const wsStatus = client.ws.status;

    const embed = new EmbedBuilder()
      .setTitle("🔍 Bot Debug Info")
      .setColor(0x3498db)
      .addFields(
        {
          name: "Hosting Platform (guess)",
          value: `${info.hostingPlatform}${info.isDocker ? " (Docker)" : ""}`,
        },
        { name: "Hostname", value: "`" + info.hostname + "`", inline: true },
        {
          name: "OS / Arch",
          value: `${info.osType} / ${info.arch} (${info.platform})`,
          inline: true,
        },
        { name: "Public IP", value: "`" + info.publicIp + "`", inline: true },
        { name: "Node", value: info.nodeVersion, inline: true },
        { name: "Git Commit", value: "`" + info.gitCommit + "`", inline: true },
        {
          name: "Uptime",
          value: `${Math.floor(info.uptimeSeconds / 3600)}h ${Math.floor(
            (info.uptimeSeconds % 3600) / 60
          )}m`,
          inline: true,
        },
        {
          name: "Memory",
          value: `RSS ${info.memoryMB.rss}MB / Heap ${info.memoryMB.heapUsed}MB`,
          inline: true,
        },
        { name: "PID", value: String(info.pid), inline: true },
        {
          name: "Discord WS",
          value: `status ${wsStatus} • ping ${client.ws.ping}ms • ${client.guilds.cache.size} guilds`,
        },
        { name: "Working Dir", value: "`" + info.cwd + "`" }
      )
      .setFooter({
        text: "Reverse-lookup the public IP to confirm the host provider.",
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
```

- [ ] **Step 2: Sanity-check the module loads**

Run: `node -e "const c=require('./commands/debugCommand'); console.log(c.data.name, typeof c.execute)"`
Expected: prints `debug function`

- [ ] **Step 3: Commit**

```bash
git add commands/debugCommand.js
git commit -m "feat: add /debug command module"
```

---

## Task 5: `/setup` command module

**Files:**
- Create: `commands/setup.js`

- [ ] **Step 1: Write the command module**

Create `commands/setup.js`. Writes to the EXACT keys the runtime handlers read
(`channels.wordle`, `loggingChannelId`, `features.audit_logs`, `adminRoles`) and
calls `invalidateCache` so changes apply immediately.

```js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const {
  getSetting,
  setSetting,
  invalidateCache,
} = require("../utils/settingsManager");
const { hasAdminPermission } = require("../utils/adminPermissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Bobby's channels and admin roles (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommandGroup((g) =>
      g
        .setName("wordle")
        .setDescription("Configure the wordle leaderboard channel")
        .addSubcommand((s) =>
          s
            .setName("channel")
            .setDescription("Set the channel Bobby watches for wordle results")
            .addChannelOption((o) =>
              o
                .setName("channel")
                .setDescription("The wordle results channel")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
        .addSubcommand((s) =>
          s.setName("status").setDescription("Show the current wordle channel")
        )
    )
    .addSubcommandGroup((g) =>
      g
        .setName("logging")
        .setDescription("Configure the security audit log channel")
        .addSubcommand((s) =>
          s
            .setName("channel")
            .setDescription("Set the audit log channel and enable logging")
            .addChannelOption((o) =>
              o
                .setName("channel")
                .setDescription("The log channel")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
        .addSubcommand((s) =>
          s.setName("disable").setDescription("Disable audit logging")
        )
        .addSubcommand((s) =>
          s.setName("status").setDescription("Show the current logging config")
        )
    )
    .addSubcommandGroup((g) =>
      g
        .setName("admin-roles")
        .setDescription("Manage roles allowed to use admin commands")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Allow a role to use admin commands")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Role to add").setRequired(true)
            )
        )
        .addSubcommand((s) =>
          s
            .setName("remove")
            .setDescription("Stop a role from using admin commands")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Role to remove").setRequired(true)
            )
        )
        .addSubcommand((s) =>
          s.setName("list").setDescription("List configured admin roles")
        )
    )
    .addSubcommand((s) =>
      s.setName("overview").setDescription("Show all current configuration")
    ),

  async execute(interaction) {
    const isAdmin = await hasAdminPermission(
      interaction.member,
      interaction.guild.id
    );
    if (!isAdmin) {
      return interaction.reply({
        content: "❌ You need admin permissions to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === "wordle") {
        return await handleWordle(interaction, guildId, sub);
      }
      if (group === "logging") {
        return await handleLogging(interaction, guildId, sub);
      }
      if (group === "admin-roles") {
        return await handleAdminRoles(interaction, guildId, sub);
      }
      if (sub === "overview") {
        return await handleOverview(interaction, guildId);
      }
      return interaction.editReply({ content: "Unknown subcommand." });
    } catch (error) {
      console.error("[/setup] error:", error);
      return interaction.editReply({
        content: `❌ Setup failed: ${error.message}`,
      });
    }
  },
};

async function handleWordle(interaction, guildId, sub) {
  if (sub === "channel") {
    const channel = interaction.options.getChannel("channel");
    const ok = await setSetting(guildId, "channels.wordle", channel.id);
    invalidateCache(guildId);
    return interaction.editReply({
      content: ok
        ? `✅ Wordle channel set to ${channel}. Bobby will now track results posted there.`
        : "❌ Failed to save the wordle channel.",
    });
  }
  // status
  const current = await getSetting(guildId, "channels.wordle");
  return interaction.editReply({
    content: current
      ? `📍 Wordle channel: <#${current}>`
      : "⚠️ No wordle channel set. Use `/setup wordle channel`.",
  });
}

async function handleLogging(interaction, guildId, sub) {
  if (sub === "channel") {
    const channel = interaction.options.getChannel("channel");
    await setSetting(guildId, "loggingChannelId", channel.id);
    await setSetting(guildId, "features.audit_logs", true);
    invalidateCache(guildId);
    return interaction.editReply({
      content: `✅ Audit logging enabled. Logs go to ${channel}.`,
    });
  }
  if (sub === "disable") {
    await setSetting(guildId, "features.audit_logs", false);
    invalidateCache(guildId);
    return interaction.editReply({ content: "✅ Audit logging disabled." });
  }
  // status
  const channelId = await getSetting(guildId, "loggingChannelId");
  const enabled = (await getSetting(guildId, "features.audit_logs")) !== false;
  return interaction.editReply({
    content:
      `📊 Logging: ${enabled ? "enabled" : "disabled"}\n` +
      (channelId ? `📍 Channel: <#${channelId}>` : "⚠️ No log channel set."),
  });
}

async function handleAdminRoles(interaction, guildId, sub) {
  const roles = (await getSetting(guildId, "adminRoles", [])) || [];
  if (sub === "add") {
    const role = interaction.options.getRole("role");
    if (roles.includes(role.id)) {
      return interaction.editReply({
        content: `⚠️ ${role} is already an admin role.`,
      });
    }
    roles.push(role.id);
    await setSetting(guildId, "adminRoles", roles);
    invalidateCache(guildId);
    return interaction.editReply({
      content: `✅ ${role} can now use admin commands.`,
    });
  }
  if (sub === "remove") {
    const role = interaction.options.getRole("role");
    const next = roles.filter((id) => id !== role.id);
    await setSetting(guildId, "adminRoles", next);
    invalidateCache(guildId);
    return interaction.editReply({
      content: `✅ ${role} can no longer use admin commands.`,
    });
  }
  // list
  return interaction.editReply({
    content: roles.length
      ? `👤 Admin roles: ${roles.map((id) => `<@&${id}>`).join(", ")}`
      : "⚠️ No admin roles configured (only Discord admins/owner have access).",
  });
}

async function handleOverview(interaction, guildId) {
  const wordleCh = await getSetting(guildId, "channels.wordle");
  const logCh = await getSetting(guildId, "loggingChannelId");
  const logOn = (await getSetting(guildId, "features.audit_logs")) !== false;
  const adminRoles = (await getSetting(guildId, "adminRoles", [])) || [];
  const verifyOn = (await getSetting(guildId, "features.verification")) === true;
  const verifyCh = await getSetting(guildId, "channels.verification");

  const embed = new EmbedBuilder()
    .setTitle("⚙️ Bobby Configuration")
    .setColor(0x2ecc71)
    .addFields(
      {
        name: "🟩 Wordle channel",
        value: wordleCh ? `<#${wordleCh}>` : "⚠️ not set — `/setup wordle channel`",
      },
      {
        name: "📊 Audit logging",
        value: `${logOn ? "enabled" : "disabled"}${
          logCh ? ` → <#${logCh}>` : " — `/setup logging channel`"
        }`,
      },
      {
        name: "🛡️ Verification",
        value: verifyOn
          ? `enabled${verifyCh ? ` → <#${verifyCh}>` : ""}`
          : "disabled — `/verification-setup enable`",
      },
      {
        name: "👤 Admin roles",
        value: adminRoles.length
          ? adminRoles.map((id) => `<@&${id}>`).join(", ")
          : "none (Discord admins/owner only)",
      }
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
```

- [ ] **Step 2: Sanity-check the module loads and the builder is valid**

Run: `node -e "const c=require('./commands/setup'); console.log(c.data.name, c.data.toJSON().options.length, typeof c.execute)"`
Expected: prints `setup 4 function` (3 subcommand groups + 1 plain subcommand = 4 top-level options).

- [ ] **Step 3: Commit**

```bash
git add commands/setup.js
git commit -m "feat: add /setup admin command for wordle, logging, admin roles"
```

---

## Task 6: Register `/debug` and `/setup` in the builder + handler, with free-version filtering

**Files:**
- Modify: `commands/slashCommandBuilder.js` (top imports, push new commands, filter export)
- Modify: `commands/slashCommandHandler.js` (register new handlers, guard with allow-list)

- [ ] **Step 1: Add the two new commands to the builder**

In `commands/slashCommandBuilder.js`, the file builds a `commands` array and (per existing code) already imports `PermissionFlagsBits, ChannelType` near line 484 for verification-setup. After the `verification-setup` push block (near line 530, before the final `module.exports`), append:

```js
// ==========================================
// DEBUG & SETUP (free-version infrastructure)
// ==========================================
const debugCommand = require("./debugCommand");
commands.push({ data: debugCommand.data, category: "info" });

const setupCommand = require("./setup");
commands.push({ data: setupCommand.data, category: "utility" });
```

- [ ] **Step 2: Filter the exported command list when FREE_VERSION is on**

At the very end of `commands/slashCommandBuilder.js`, find the export (currently `module.exports = commands;`). Replace it with a free-version-aware filter:

```js
const { FREE_VERSION, isSlashCommandEnabled } = require("../config/freeVersion");

const exportedCommands = FREE_VERSION
  ? commands.filter((c) => isSlashCommandEnabled(c.data.name))
  : commands;

module.exports = exportedCommands;
```

> If the file already ends with `module.exports = commands;`, replace that exact line. If it exports differently, adapt so the filtered array is what's exported.

- [ ] **Step 3: Register the handlers and guard all registrations**

In `commands/slashCommandHandler.js`, near the existing verification-setup registration (around line 352), add registrations for the two new commands:

```js
  // DEBUG COMMAND
  const debugCommand = require("./debugCommand");
  interactionRouter.registerSlashCommand("debug", debugCommand.execute);

  // SETUP COMMAND
  const setupCommand = require("./setup");
  interactionRouter.registerSlashCommand("setup", setupCommand.execute);
```

Then, at the very top of the `module.exports = (client, interactionRouter) => {` body (right after the opening `console.log`), add a guard wrapper so disabled commands never get a live handler when FREE_VERSION is on:

```js
  const { isSlashCommandEnabled } = require("../config/freeVersion");
  const _register = interactionRouter.registerSlashCommand.bind(interactionRouter);
  interactionRouter.registerSlashCommand = (name, fn) => {
    if (!isSlashCommandEnabled(name)) return; // skip disabled commands in free build
    return _register(name, fn);
  };
```

This wrapper makes every subsequent `registerSlashCommand(...)` call in the file a no-op for non-allow-listed commands — no need to edit each one individually.

- [ ] **Step 4: Verify the builder exports only allow-listed commands in free mode**

Run:
```bash
FREE_VERSION=true node -e "const c=require('./commands/slashCommandBuilder'); console.log(c.map(x=>x.data.name).sort().join(','))"
```
Expected: only `debug,help,setup,verification-setup` (alphabetical). No `balance`, `blackjack`, etc.

- [ ] **Step 5: Verify full mode still exports everything**

Run:
```bash
FREE_VERSION=false node -e "const c=require('./commands/slashCommandBuilder'); console.log('count', c.length); console.log(c.some(x=>x.data.name==='balance'))"
```
Expected: a large count and `true` (balance present when not free).

- [ ] **Step 6: Commit**

```bash
git add commands/slashCommandBuilder.js commands/slashCommandHandler.js commands/debugCommand.js commands/setup.js
git commit -m "feat: register /debug and /setup; filter slash commands in free version"
```

---

## Task 7: Gate handler loading in `handlerRegistry.js`

**Files:**
- Modify: `events/handlerRegistry.js`

This is the largest edit. The goal: every feature handler registration is guarded by
`isHandlerEnabled(key)`. Allow-listed keys (`verification`/`moderation`/`logging`/`wordle`/`help`/`guildJoin`)
load; everything else is skipped when FREE_VERSION is on.

> Note: `enhancedVerification` is initialized in `index.js` (not here) — see Task 8 for
> confirming it stays on. `moderationHandler` and `loggingHandler` and `wordleHandler`
> and `helpHandler` and `guildJoinHandler` are all registered in this file.

- [ ] **Step 1: Import the gate at the top of the module body**

In `events/handlerRegistry.js`, inside `module.exports = (client, commandRouter, interactionRouter) => {` (right after the opening `console.log`), add:

```js
  const { isHandlerEnabled } = require("../config/freeVersion");
```

- [ ] **Step 2: Wrap the always-free security + wordle + infra handlers in explicit guards**

These specific registrations should be guarded so they're controlled by the allow-list.
Wrap each existing call as shown (keep the existing call body unchanged inside the `if`):

```js
  // Logging handler - monitors message delete/update, bans
  if (isHandlerEnabled("logging")) {
    require("./loggingHandler")(client, loggingChannelId);
  }

  // Wordle handler - needs its own listener to receive bot messages
  if (isHandlerEnabled("wordle")) {
    require("./wordleHandler")(client);
  }

  // Guild join handler - monitors guildCreate/guildDelete for guild registration
  if (isHandlerEnabled("guildJoin")) {
    require("./guildJoinHandler")(client);
  }
```

And the help + moderation handlers (help is a wrapper block; moderation is a `registerCommandHandler` call):

```js
  // Help handler - !help, !commands, !cmdlist, !commandlist
  if (isHandlerEnabled("help")) {
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
  }
```

```js
  // Moderation handler - !kick, !ban, !timeout
  if (isHandlerEnabled("moderation")) {
    registerCommandHandler(
      client,
      commandRouter,
      interactionRouter,
      "./moderationHandler"
    );
  }
```

- [ ] **Step 3: Disable every other handler when free**

For all remaining feature handlers in this file (everything NOT in the allow-list),
wrap them in a single blanket guard. The simplest correct approach: wrap each remaining
registration block. Rather than wrap ~30 blocks individually, introduce one guard
constant near the top of the body and gate the non-allow-listed sections with it.

Add right after the `isHandlerEnabled` import:

```js
  // In the free build, only the security suite + wordle + infra handlers load.
  // `loadExtras` is false in free mode; the extra-feature blocks below are skipped.
  const loadExtras = isHandlerEnabled("eggbuck"); // any non-allow-listed key → false when free
```

Then wrap the extra-feature registrations. Concretely, guard these blocks with
`if (loadExtras) { ... }`:

- `messageReactionHandler`, `memberCountHandler`, `boosterRoleHandler`,
  `changelogHandler`, `birthdayHandler`, `bumpHandler`, `setupReminderHandler`,
  `voteReminderHandler`
- the `bettingHandler` wrapper block
- the `alertHandler` / `thinIceHandler` / `askHandler` message-processor blocks
- `valorantRankRoleHandler`, `debugEmojiHandler`, the `eggbuckHandler` wrapper block,
  `gamblingHandler`, `blackjackHandler`, `baccaratHandler`, `plinkoHandler`,
  the `crashHandler` wrapper, `clipHandler`, the `valorantTeamHandler` wrapper,
  the `rawValorantTeamHandler` wrapper, `russianRouletteHandler`, `kothHandler`,
  `valorantMapHandler`, `valorantInhouseHandler`, `valorantLeaderboardHandler`,
  `triviaHandler`, `bountyHandler`, the `shopHandler` wrapper,
  `subscriptionCommandHandler`, `settingsCommandHandler`, the `gladiatorHandler` wrapper,
  the `tournamentHandler` wrapper, the `mafiaHandler` wrapper, the `craftleHandler`
  wrapper + `startPuzzleGenerationCron()`, and the `valorantApiHandler` init block.

Example of wrapping a `registerCommandHandler` block:

```js
  if (loadExtras) {
    // Trivia handler - !trivia
    registerCommandHandler(
      client,
      commandRouter,
      interactionRouter,
      "./triviaHandler"
    );
  }
```

Example of wrapping a wrapper block (mafia):

```js
  let mafiaHandler = null;
  if (loadExtras) {
    mafiaHandler = require("./mafiaHandler");
    const mafiaWrapper = createHandlerWrapper(client, () => mafiaHandler);
    if (mafiaWrapper.messageHandler) {
      commandRouter.registerMessageProcessor(mafiaWrapper.messageHandler);
    }
    if (mafiaWrapper.interactionHandler) {
      interactionRouter.registerButton("mafia_", mafiaWrapper.interactionHandler);
      interactionRouter.registerButton("bee_mafia_", mafiaWrapper.interactionHandler);
      interactionRouter.registerSelectMenu("mafia_", mafiaWrapper.interactionHandler);
    }
  }
```

> IMPORTANT: `mafiaHandler` is returned at the end of the file (`return { mafiaHandler };`)
> and consumed by the webhook server in `index.js`. Declare `let mafiaHandler = null;`
> as shown so the return still works when the handler is not loaded. The mafia webhook
> server in `index.js` is also gated in Task 8, so a null handler is never used.

- [ ] **Step 4: Confirm the bot boots in free mode without errors**

Run (this requires a valid `.env`; it should connect and log handler registration):
```bash
FREE_VERSION=true node -e "require('dotenv').config(); console.log('registry loads:', typeof require('./events/handlerRegistry'))"
```
Expected: prints `registry loads: function` with no throw. (Full boot is verified in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add events/handlerRegistry.js
git commit -m "feat: gate feature handlers behind freeVersion allow-list"
```

---

## Task 8: Confirm security stays on and gate the paid API servers in `index.js`

**Files:**
- Modify: `index.js` (gate the subscription webhook/mafia server startup; confirm verification stays)

The `enhancedVerification` system is imported in `index.js` (line ~457) and should stay
ON — it's part of the security suite and is not subscription-gated. The mafia webhook
server and subscription server, however, support paid features and should not run in the
free build.

- [ ] **Step 1: Read the server-startup section**

Run: `grep -n "MafiaWebhookServer\|SubscriptionServer\|SettingsServer\|enhancedVerification\|mafiaHandler" index.js`
Confirm the line numbers for: mafia webhook server start (~402), subscription server (~422), settings server (~439), enhancedVerification import (~457).

- [ ] **Step 2: Gate the mafia webhook + subscription servers**

Wrap the `MafiaWebhookServer` startup block and the `SubscriptionServer` startup block
so they only run when extras are enabled. Add near the top of `index.js` (after other
requires):

```js
const { FREE_VERSION } = require("./config/freeVersion");
```

Then guard each block. For the mafia webhook server (around line 402):

```js
if (!FREE_VERSION) {
  const MafiaWebhookServer = require("./api/mafiaWebhookServer");
  // ... existing startup code ...
}
```

For the subscription server (around line 422):

```js
if (!FREE_VERSION) {
  const SubscriptionServer = require("./api/subscriptionServer");
  // ... existing startup code ...
}
```

> Keep the **settings server** (~439) running — admins may still rely on it, and it is
> not paid-only. Keep the health/HTTP server in `index.js` running. Keep
> `enhancedVerification` (~457) running — it is the security suite.

> If the existing code references `mafiaHandler` (returned from handlerRegistry) when
> starting the webhook server, that reference is now inside the `if (!FREE_VERSION)`
> block, so the null `mafiaHandler` from Task 7 is never used in free mode. Confirm no
> other code path dereferences `mafiaHandler` unconditionally; if it does, guard it with
> `if (mafiaHandler) { ... }`.

- [ ] **Step 3: Confirm index.js parses**

Run: `node --check index.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat: skip paid API servers in free version; keep security + settings"
```

---

## Task 9: Convex `getGlobalScores` query (global wordle aggregation)

**Files:**
- Modify: `convex/wordle.ts`

The global leaderboard sums each user's stats across every server whose
`settings.wordleScope === 'global'`. This task adds a Convex query that returns the raw
`wordleScores` rows for all global-opted guilds; the JS side (Task 10) reuses the
existing `calculateStats` aggregation logic to sum them.

- [ ] **Step 1: Add the query**

In `convex/wordle.ts`, after the existing `getLeaderboard` query (around line 52), add:

```ts
/**
 * Get raw wordle scores across all servers that opted into the global leaderboard
 * (settings.wordleScope === 'global'). The bot aggregates these per-user.
 */
export const getGlobalScores = query({
  args: {},
  handler: async (ctx) => {
    // Find all servers and keep only those opted into the global scope.
    const servers = await ctx.db.query("servers").collect();
    const globalGuildIds = servers
      .filter((s) => s.settings && s.settings.wordleScope === "global")
      .map((s) => s.guildId);

    if (globalGuildIds.length === 0) return [];

    // Collect every wordleScores row for those guilds.
    const allScores = [];
    for (const guildId of globalGuildIds) {
      const rows = await ctx.db
        .query("wordleScores")
        .withIndex("by_guild_and_user", (q) => q.eq("guildId", guildId))
        .collect();
      allScores.push(...rows);
    }
    return allScores;
  },
});
```

- [ ] **Step 2: Push the Convex schema/functions**

Run: `npx convex dev --once` (or your project's deploy command — check `package.json` /
`convex.json`). This regenerates `convex/_generated` so `api.wordle.getGlobalScores`
exists.
Expected: deploy succeeds; `api.wordle.getGlobalScores` is now available.

- [ ] **Step 3: Verify the generated api includes the new function**

Run: `node -e "const {api}=require('./convex/_generated/api'); console.log(typeof api.wordle.getGlobalScores)"`
Expected: prints `object` (a function reference), not `undefined`.

- [ ] **Step 4: Commit**

```bash
git add convex/wordle.ts convex/_generated
git commit -m "feat: add getGlobalScores query for cross-server wordle leaderboard"
```

---

## Task 10: `/setup wordle scope` + global leaderboard view

**Files:**
- Modify: `commands/setup.js` (add `scope` subcommand under the `wordle` group)
- Modify: `events/wordleHandler.js` (add `calculateGlobalStats` + `!wordleglobal` command)

- [ ] **Step 1: Add the `scope` subcommand to the `wordle` group in `commands/setup.js`**

In the `wordle` subcommand group of the builder (in `commands/setup.js`), add a third
subcommand after `status`:

```js
        .addSubcommand((s) =>
          s
            .setName("scope")
            .setDescription("Set whether this server's wordle board is private or global")
            .addStringOption((o) =>
              o
                .setName("scope")
                .setDescription("private = this server only; global = cross-server")
                .setRequired(true)
                .addChoices(
                  { name: "private (this server only)", value: "private" },
                  { name: "global (cross-server leaderboard)", value: "global" }
                )
            )
        )
```

- [ ] **Step 2: Handle the `scope` subcommand in `handleWordle`**

In `commands/setup.js`, update `handleWordle` to handle `scope` (and show scope in
`status`). Replace the existing `handleWordle` function body with:

```js
async function handleWordle(interaction, guildId, sub) {
  if (sub === "channel") {
    const channel = interaction.options.getChannel("channel");
    const ok = await setSetting(guildId, "channels.wordle", channel.id);
    invalidateCache(guildId);
    return interaction.editReply({
      content: ok
        ? `✅ Wordle channel set to ${channel}. Bobby will now track results posted there.`
        : "❌ Failed to save the wordle channel.",
    });
  }
  if (sub === "scope") {
    const scope = interaction.options.getString("scope"); // 'private' | 'global'
    await setSetting(guildId, "wordleScope", scope);
    invalidateCache(guildId);
    return interaction.editReply({
      content:
        scope === "global"
          ? "🌍 Wordle leaderboard is now **global** — this server's players appear on the cross-server board (`!wordleglobal`)."
          : "🔒 Wordle leaderboard is now **private** — only this server's players are shown.",
    });
  }
  // status
  const current = await getSetting(guildId, "channels.wordle");
  const scope = (await getSetting(guildId, "wordleScope")) || "private";
  return interaction.editReply({
    content:
      (current
        ? `📍 Wordle channel: <#${current}>`
        : "⚠️ No wordle channel set. Use `/setup wordle channel`.") +
      `\n🔭 Scope: **${scope}**`,
  });
}
```

- [ ] **Step 3: Show scope in `/setup overview`**

In `handleOverview` in `commands/setup.js`, add a scope read and field. After the
`wordleCh` line, add:

```js
  const wordleScope = (await getSetting(guildId, "wordleScope")) || "private";
```

And change the wordle field's `value` to include scope:

```js
      {
        name: "🟩 Wordle channel",
        value:
          (wordleCh ? `<#${wordleCh}>` : "⚠️ not set — `/setup wordle channel`") +
          ` • scope: **${wordleScope}**`,
      },
```

- [ ] **Step 4: Add `calculateGlobalStats` and `!wordleglobal` in `events/wordleHandler.js`**

`calculateStats(guildId)` aggregates one guild's scores. Add a sibling that aggregates
the global rows from `getGlobalScores`. After the `calculateStats` function (around line
710, after its closing brace), add:

```js
// Calculate global leaderboard statistics by summing each user's scores across all
// global-opted servers. Reuses the same weighting as calculateStats.
async function calculateGlobalStats() {
  try {
    const client = getConvexClient();
    if (!client) return {};

    const allRows = await client.query(api.wordle.getGlobalScores, {});
    // Merge rows by userId (a user may appear in several global servers).
    const byUser = {};
    for (const row of allRows) {
      if (!byUser[row.userId]) byUser[row.userId] = [];
      byUser[row.userId].push(...row.scores);
    }

    const result = {};
    for (const [userId, scores] of Object.entries(byUser)) {
      if (scores.length === 0) continue;
      const scoreValues = scores.map((s) => s.score);
      const totalScore = scoreValues.reduce((sum, s) => sum + s, 0);
      const bestScore = Math.min(...scoreValues);
      const avgScore = totalScore / scores.length;
      const totalGames = scores.length;
      const weightedScore = avgScore * Math.pow(50 / totalGames, 0.7);
      result[userId] = {
        avgScore,
        bestScore,
        totalGames,
        weightedScore,
        totalHoney: scores.reduce((sum, s) => sum + (s.honeyAwarded || 0), 0),
      };
    }
    return result;
  } catch (error) {
    console.error("[WORDLE] Error calculating global stats:", error);
    return {};
  }
}
```

> The weighting formula (`avgScore * (50 / games)^0.7`) mirrors the one in
> `calculateStats` (see `events/wordleHandler.js:672-674`). If that formula differs in
> the actual code, copy the exact expression used there so global ranking matches local.

- [ ] **Step 5: Add the `!wordleglobal` command handler**

In the `messageCreate` handler in `events/wordleHandler.js`, after the `!wordletop`
block (around line 999), add a `!wordleglobal` block. It mirrors `!wordletop` but uses
`calculateGlobalStats()` and resolves usernames from the client's global user cache
(cross-server users may not be in this guild):

```js
    // Handle !wordleglobal command (cross-server leaderboard)
    if (message.content.toLowerCase() === "!wordleglobal") {
      const stats = await calculateGlobalStats();
      if (Object.keys(stats).length === 0) {
        return await message.channel.send(
          "No servers have opted into the global leaderboard yet! An admin can enable it with `/setup wordle scope global`."
        );
      }

      const sortedUsers = Object.entries(stats).sort(
        (a, b) => a[1].weightedScore - b[1].weightedScore
      );

      const { EmbedBuilder } = require("discord.js");
      let leaderboardText = "";
      const topTen = sortedUsers.slice(0, 10);

      for (let i = 0; i < topTen.length; i++) {
        const [userId, userStats] = topTen[i];
        // Cross-server: resolve from the global user cache, fall back to id.
        const cachedUser = message.client.users.cache.get(userId);
        let username = cachedUser ? cachedUser.username : null;
        if (!username) {
          try {
            const fetched = await message.client.users.fetch(userId);
            username = fetched.username;
          } catch (_) {
            username = `User ${userId}`;
          }
        }

        let medal;
        if (i === 0) medal = "🥇";
        else if (i === 1) medal = "🥈";
        else if (i === 2) medal = "🥉";
        else medal = `**${i + 1}.**`;

        leaderboardText += `${medal} **${username}**\n`;
        leaderboardText += `└ Avg: **${userStats.avgScore.toFixed(2)}** | Games: **${userStats.totalGames}** | Best: **${userStats.bestScore}/6**\n\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("🌍 Global Wordle Leaderboard")
        .setColor("#6aaa64")
        .setDescription(leaderboardText.trim())
        .addFields({
          name: "📊 Total Players (global)",
          value: `${Object.keys(stats).length}`,
          inline: true,
        })
        .setFooter({
          text: "Combines all servers that opted in via /setup wordle scope global.",
        })
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
    }
```

- [ ] **Step 6: Verify the modules still load**

Run:
```bash
node -e "require('./commands/setup'); require('./events/wordleHandler'); console.log('ok')"
```
Expected: prints `ok` (no syntax/require errors).

- [ ] **Step 7: Commit**

```bash
git add commands/setup.js events/wordleHandler.js
git commit -m "feat: per-server wordle scope toggle + global leaderboard (!wordleglobal)"
```

---

## Task 11: Remove all subscription popup / upgrade messages

**Files:**
- Modify: `utils/subscriptionUtils.js` (neutralize `createUpgradeEmbed`)
- Audit: every caller of `createUpgradeEmbed` / `checkSubscription`

Even with paid handlers disabled in the free build, any remaining code path that reaches
a subscription gate must NOT show an upsell popup. The cleanest single-point fix:
neutralize the upgrade embed at its source and make `checkSubscription` always grant
access, so no "Feature Unavailable / Upgrade your subscription" message can render.

- [ ] **Step 1: Find every upgrade-popup usage**

Run:
```bash
grep -rn "createUpgradeEmbed\|Feature Unavailable\|Upgrade your subscription\|crackedgames.co/bobby-the-bot" --include=*.js events/ commands/ utils/ api/ | grep -v node_modules
```
Expected: a list of call sites (blackjack, mafia, betting, shop, valorant, etc.) plus the
definition in `utils/subscriptionUtils.js`. Note them; the next steps make them all no-ops.

- [ ] **Step 2: Make `checkSubscription` always grant access**

In `utils/subscriptionUtils.js`, at the very top of the `checkSubscription` function body
(before any API call), short-circuit so no gate ever fails. Add right after the function
signature `async function checkSubscription(guildId, requiredTier = TIERS.FREE, ownerId = null) {`:

```js
    // Free version: subscriptions are removed. Always grant access so no
    // upgrade popup is ever shown. (Reversible: delete this block to restore gating.)
    const { FREE_VERSION } = require("../config/freeVersion");
    if (FREE_VERSION) {
      return { hasAccess: true, guildTier: TIERS.ULTIMATE, subscription: null };
    }
```

This guarantees every `if (!subCheck.hasAccess)` branch is skipped, so no caller ever
builds or sends an upgrade embed.

- [ ] **Step 3: Neutralize `createUpgradeEmbed` as a defense-in-depth measure**

In `utils/subscriptionUtils.js`, change `createUpgradeEmbed` so that, in the free build,
it returns a minimal, link-free embed (in case any caller still references it). Replace
the `.setDescription(...)` block inside `createUpgradeEmbed` with:

```js
    const { FREE_VERSION } = require("../config/freeVersion");
    const embed = new EmbedBuilder()
      .setColor(tierColors[normalizedRequired] || 0x3498db)
      .setTitle(
        FREE_VERSION ? "ℹ️ Feature Not Available" : `${tierEmojis[normalizedRequired]} Feature Unavailable`
      )
      .setDescription(
        FREE_VERSION
          ? `**${featureName}** is not available on this bot.`
          : `**${featureName}** requires the **${tierNames[normalizedRequired]}** tier.\n\n` +
              `[Upgrade your subscription](https://crackedgames.co/bobby-the-bot) to unlock this feature!`
      )
      .setTimestamp();

    return embed;
```

> With Step 2 in place, this embed is effectively never produced in the free build (no
> gate fails). Step 3 only ensures that if some stray path calls it directly, it shows no
> subscription upsell or external link.

- [ ] **Step 4: Disable the `!subscription` / `!sub` / `!tier` command output**

The `subscriptionCommandHandler` is already not loaded in the free build (Task 7), so
`!subscription` / `!sub` / `!tier` produce no response. Confirm there is no OTHER handler
that prints subscription/upgrade text by re-running the Step 1 grep and checking each
remaining hit is either (a) inside a now-disabled handler, or (b) neutralized by Steps 2–3.

Run the grep again and review:
```bash
grep -rn "Upgrade your subscription\|crackedgames.co/bobby-the-bot" --include=*.js events/ commands/ utils/ api/ | grep -v node_modules
```
Expected: the only remaining hit is the (now `FREE_VERSION`-guarded) branch in
`utils/subscriptionUtils.js`. No reachable upsell in the free build.

- [ ] **Step 5: Verify it loads and grants access**

Run:
```bash
FREE_VERSION=true node -e "const s=require('./utils/subscriptionUtils'); s.checkSubscription('123','ultimate').then(r=>console.log('hasAccess:', r.hasAccess))"
```
Expected: `hasAccess: true` (no upgrade gate, even for the highest tier).

- [ ] **Step 6: Commit**

```bash
git add utils/subscriptionUtils.js
git commit -m "feat: remove subscription upgrade popups; always grant access in free version"
```

---

## Task 12: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: all `freeVersion` and `debugInfo` tests pass.

- [ ] **Step 2: Boot the bot in free mode**

Run: `FREE_VERSION=true npm start` (with a valid `.env`)
Expected: the bot logs in; registration log shows security + wordle + help handlers
registered and NO blackjack/mafia/valorant/etc. Watch for `✅ All handlers registered`.
No crash, no unhandled rejection.

- [ ] **Step 3: Deploy slash commands and confirm the filtered set**

Run: `FREE_VERSION=true node commands/deployCommands.js --guild=<TEST_GUILD_ID>`
Expected: the deployment log lists only `help`, `debug`, `setup`, `verification-setup`.

- [ ] **Step 4: In Discord, verify behavior (as a server admin)**

- `/debug` → ephemeral embed with hosting platform, public IP, hostname, git commit. ✅
  This answers "where is the bot hosted."
- `/setup overview` → shows wordle/logging/verification/admin-role config. ✅
- `/setup wordle channel #some-channel` → success; then post a wordle results message in
  that channel and confirm Bobby tracks it (leaderboard updates). ✅
- `/setup logging channel #logs` → success; delete a message and confirm it's logged. ✅
- `/setup admin-roles add @SomeRole`, then a member with only that role can run `/setup`. ✅
- A gambling/economy command (e.g. `!blackjack`, `!balance`) → no response (handler not
  loaded), and NO "Feature Unavailable / Upgrade your subscription" popup anywhere. ✅
- `!subscription` / `!sub` / `!tier` → no response (handler disabled). ✅

- [ ] **Step 5: Verify wordle scope (global vs private)**

- In TWO test servers, run `/setup wordle scope global` in both and set a wordle channel.
- Play wordle as the same user in both servers (post results in each wordle channel).
- Run `!wordleglobal` in either server → the user's Games count reflects the SUM across
  both servers. ✅
- Run `/setup wordle scope private` in one server, then `!wordleglobal` again → that
  server's scores no longer contribute to the global tally. ✅
- `!wordletop` still shows only the current server's players (private board unaffected). ✅

- [ ] **Step 6: Confirm reversibility**

Run: `FREE_VERSION=false node -e "const c=require('./commands/slashCommandBuilder'); console.log(c.length)"`
Expected: the full command count returns (paid commands present again). No code was deleted.

- [ ] **Step 7: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for free version rollout"
```

---

## Self-Review Notes (for the implementer)

- **Settings cache:** every `/setup` write calls `invalidateCache(guildId)` so the
  runtime handlers see changes without waiting for the 5-minute TTL.
- **Exact keys:** `channels.wordle`, `loggingChannelId`, `features.audit_logs`,
  `adminRoles` — these match what `wordleHandler.js`, `loggingHandler.js`, and
  `adminPermissions.js` actually read. Do not rename them.
- **Admin gating is double-layered:** `setDefaultMemberPermissions(Administrator)` on the
  builder (Discord-side) + `hasAdminPermission()` at runtime (covers configured
  `adminRoles`). Keep both.
- **discord.js v14.15:** `ephemeral: true` is valid in this version; the codebase already
  uses it (see `verification-setup.js`). No need to switch to `MessageFlags.Ephemeral`.
- **Allow-list, not deny-list:** new/unknown handler keys stay disabled in free mode by
  default, so nothing paid leaks through accidentally.
- **No upgrade popups:** `checkSubscription` short-circuits to `hasAccess: true` in the
  free build (Task 11), so no `createUpgradeEmbed` branch is ever reached; the embed is
  also neutralized to remove the external link as defense-in-depth.
- **Wordle scope keys:** `wordleScope` is `'private'` (default) or `'global'`. The global
  board sums `scores` per `userId` across servers where `settings.wordleScope === 'global'`
  via the Convex `getGlobalScores` query. Switching back to `private` drops a server from
  the live global query immediately (no historical leakage).
- **Convex deploy required:** Task 9 adds a Convex query — remember to run the Convex
  deploy/codegen step so `api.wordle.getGlobalScores` exists before Task 10 runs.
```
