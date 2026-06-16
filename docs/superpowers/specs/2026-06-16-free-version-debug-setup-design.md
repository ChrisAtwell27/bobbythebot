# Design: Debug Command, Free Version, and In-Discord Admin Setup

**Date:** 2026-06-16
**Status:** Approved (pending spec review)

## Overview

Three related changes to BobbyTheBot:

1. **`/debug` command** — an admin-only slash command that reports hosting/runtime
   info, so the operator can identify where the bot is currently deployed.
2. **Free version** — a single-flag "toned-down" mode that ships only **security**
   (verification, moderation, audit logging) and **wordle** (game + leaderboards),
   disabling all other features and bypassing the subscription system entirely.
3. **In-Discord admin setup** — admin-only slash commands so server admins can
   configure the required channels/roles entirely from within Discord, with no
   external website needed.
4. **Wordle leaderboard scope** — a per-server admin toggle (`private` default, or
   `global`) so a server's wordle players can opt into a cross-server global
   leaderboard, with global stats summed per user across all opted-in servers.

These build on patterns that already exist in the codebase. Nothing is deleted;
the full paid bot can be restored by flipping a single flag.

## Background: how the bot works today

- **Slash commands** are defined in `commands/slashCommandBuilder.js` (a `commands`
  array of `{ data: SlashCommandBuilder, category }`). `commands/deployCommands.js`
  maps over that array (`commands.map(c => c.data.toJSON())`) to register them with
  Discord. Runtime handlers are wired separately in
  `commands/slashCommandHandler.js` via `interactionRouter.registerSlashCommand(name, fn)`.
- **Feature handlers** (~45 of them in `events/`) are all loaded and registered
  centrally in `events/handlerRegistry.js`, through a few helpers:
  `registerCommandHandler(...)`, `createHandlerWrapper(...)`,
  `createMessageProcessor(...)`, and a handful of direct `require("./x")(client)` calls.
- **Subscriptions** are the single source of paid gating. Every paid handler calls
  `checkSubscription(guildId, requiredTier, ownerId)` in `utils/subscriptionUtils.js`
  and, on `!hasAccess`, shows `createUpgradeEmbed(...)` linking to crackedgames.co.
  `checkSubscription` fetches from the website API and defaults to FREE tier on failure.
- **Admin permissions** already exist: `utils/adminPermissions.js` →
  `hasAdminPermission(member, guildId)` allows the guild owner, Discord administrators,
  and any role in the per-guild `adminRoles` setting.
- **Settings** are per-guild, read/written via `utils/settingsManager.js`
  (`getSetting(guildId, key, default)`, `setSetting(guildId, key, value)`), backed by Convex.
- **An admin setup command already exists** as a model: `commands/verification-setup.js`
  is an admin-only (`setDefaultMemberPermissions(Administrator)`) slash command with
  `enable` / `disable` / `status` subcommands that persist via `setSetting`.

### Key settings keys (verified against handlers)

| Feature | Setting key(s) read by the runtime handler | Source |
|---|---|---|
| Wordle channel | `channels.wordle` | `events/wordleHandler.js:745-749` |
| Logging channel | `loggingChannelId` (i.e. `settings.loggingChannelId`) | `events/loggingHandler.js:23` |
| Logging enabled | `features.audit_logs` (enabled unless `=== false`) | `events/loggingHandler.js:41-43` |
| Admin roles | `adminRoles` (array of role IDs) | `utils/adminPermissions.js:35` |
| Verification | managed by existing `/verification-setup` | `commands/verification-setup.js` |
| Wordle scope | `wordleScope` (`'private'` default, or `'global'`) | new — Part 4 |

> The free version must write to these EXACT keys so setup and runtime agree.

### Wordle data model (verified)

`wordleScores` (Convex, `convex/schema.ts:202-219`) stores one row per `(guildId, userId)`
with `totalGames`, `totalHoney`, and a `scores` array. All existing leaderboard queries
filter by `guildId` (`convex/wordle.ts:41-52`), so **leaderboards are already private to
each server** — there is no global board today. `convex/servers.ts` has `getAllServers`
(line 39), which Part 4 uses to find servers whose `settings.wordleScope === 'global'`.

## Part 1 — `/debug` command

### Purpose
Answer "where is this bot hosted?" by surfacing every runtime signal that identifies
the host.

### Behavior
- New slash command `debug`, `category: "info"`, registered in
  `commands/slashCommandBuilder.js` and handled in `commands/slashCommandHandler.js`.
- **Admin-only**: `setDefaultMemberPermissions(PermissionFlagsBits.Administrator)` on
  the builder, plus a runtime `hasAdminPermission()` re-check in the handler.
- Replies **ephemerally** (`flags: MessageFlags.Ephemeral`) — only the invoker sees it.

### Reported fields
- **Host identity:** `os.hostname()`, `os.type()`, `process.platform`, `os.arch()`.
- **Container:** Docker detected via `fs.existsSync('/.dockerenv')`.
- **Platform env scan:** report which known host vars are present (names only, never
  values): `RAILWAY_*`, `RENDER_*`, `FLY_*` / `FLY_APP_NAME`, `DYNO` (Heroku),
  `KOYEB_*`, `K_SERVICE` (Cloud Run), `VERCEL`, `AWS_EXECUTION_ENV` / `AWS_*`,
  `REPL_ID` (Replit), `NODE_ENV`, `CI`. The present one identifies the host.
- **Public IP:** `axios.get('https://api.ipify.org', { timeout: 3000 })` with a
  try/catch fallback to `"unavailable"`. A reverse lookup of this IP reveals the provider.
- **Runtime:** `process.version`, `process.uptime()` (formatted), `process.memoryUsage()`
  (RSS/heap), `process.pid`, `process.cwd()`.
- **Bot state:** WS status label, `client.ws.ping`, `client.guilds.cache.size`.
- **Build:** current git commit via `child_process.execSync('git rev-parse --short HEAD')`
  in a try/catch (→ `"unknown"` if git is unavailable, e.g. in a container without `.git`).
- **Backends:** masked `CONVEX_URL` host, whether `MONGODB_URI` is set (boolean), and the
  bound API ports (`MAFIA_WEBHOOK_PORT`, `SUBSCRIPTION_API_PORT`, `SETTINGS_API_PORT`).

### Implementation notes
- Add a small helper module `utils/debugInfo.js` that gathers the above into a plain
  object, keeping the slash handler thin and the logic unit-testable.
- No secrets are ever printed — only presence/booleans and non-sensitive identifiers.

## Part 2 — Free version (security + wordle only)

### Strategy: central allow-list, nothing deleted
A new config module `config/freeVersion.js` exports:

```js
const FREE_VERSION = process.env.FREE_VERSION === 'true' || true; // default on for this build
const ENABLED_HANDLERS = new Set([ /* allow-list keys, see below */ ]);
const ENABLED_SLASH_COMMANDS = new Set([ /* slash command names */ ]);
module.exports = { FREE_VERSION, ENABLED_HANDLERS, ENABLED_SLASH_COMMANDS,
                   isHandlerEnabled, isSlashCommandEnabled };
```

`isHandlerEnabled(key)` returns `true` when `FREE_VERSION` is off (full bot) or when
`key` is in the allow-list. Same idea for slash commands.

### Allow-list (what stays ON)
**Security suite:** `verification` (`enhancedVerification`), `moderation`
(`moderationHandler`), `logging` (`loggingHandler`, made free — see below).
**Wordle:** `wordle` (`wordleHandler` — game, leaderboards, monthly/yearly winners, reminders).
**Infrastructure:** `help` (`helpHandler`), `debug` (new), `setup` (new, Part 3),
`verification-setup` (existing), `guildJoin` (`guildJoinHandler`, needed for guild
registration), and the internal HTTP/health server in `index.js`.

Everything else — all gambling/games (`gambling`, `blackjack`, `baccarat`, `plinko`,
`crash`, `russianRoulette`, `koth`, `gladiator`, `tournament`, `mafia`, `craftle`),
economy (`eggbuck`, `shop`, `bounty`, `betting`), `trivia`, all Valorant handlers,
`ask` (AI chat), `alert`, `thinIce`, `birthday`, `boosterRole`, `bump`, `clip`,
`changelog`, `memberCount`, `messageReaction`, `voteReminder`, `setupReminder`,
`subscriptionCommandHandler`, `settingsCommandHandler` — does **not** load.

### Two enforcement points

1. **Handler loading — `events/handlerRegistry.js`.**
   Guard each handler registration with `isHandlerEnabled(key)`. Implementation:
   wrap the existing helpers so each call site passes a stable key, e.g.
   `registerCommandHandler(..., './blackjackHandler', { key: 'blackjack' })` becomes a
   no-op when the key is disabled; same for the inline `createHandlerWrapper` blocks and
   the direct `require("./x")(client)` calls (wrap those in
   `if (isHandlerEnabled('x')) { ... }`). Disabled handlers never attach listeners, so
   they are silent — no "upgrade" message, no response at all.

2. **Slash commands — `commands/slashCommandBuilder.js` + `commands/slashCommandHandler.js`.**
   - In the builder, after assembling `commands`, export a filtered list when
     `FREE_VERSION` is on: only commands whose `data.name` is in
     `ENABLED_SLASH_COMMANDS`. `deployCommands.js` consumes this filtered array
     automatically, so disabled commands never appear in Discord's slash menu.
   - In `slashCommandHandler.js`, guard each `registerSlashCommand(name, ...)` with
     `isSlashCommandEnabled(name)` so disabled commands have no live handler even if a
     stale registration lingers in Discord.

### Subscriptions
- `utils/subscriptionUtils.js` and the subscription server stay in the tree but are
  never reached, because the handlers that call `checkSubscription` don't load and
  `subscriptionCommandHandler` is disabled.
- Logging is currently Plus-gated via `features.audit_logs` checks; in the free build
  it is part of the security suite. The `loggingHandler` already defaults
  `audit_logs` to enabled, so no gating change is needed there — it simply loads and
  reads `loggingChannelId`. (If any logging path calls `checkSubscription`, that call
  is removed/bypassed so logging is unconditionally free.)

### Reversibility
Set `FREE_VERSION=false` (or flip the default) and redeploy commands → the full paid
bot returns, untouched.

## Part 3 — In-Discord admin setup (`/setup`)

### Purpose
Let admins configure everything from inside Discord. Today only verification has a
setup command; wordle's channel and the logging channel are set via the external
website, which the free version removes.

### Command: unified `/setup` (admin-only)
A new slash command `setup`, `category: "utility"`, with
`setDefaultMemberPermissions(PermissionFlagsBits.Administrator)` and a runtime
`hasAdminPermission()` re-check in every subcommand. Subcommands:

- **`/setup wordle channel:<#channel>`** — writes `channels.wordle`. Validates the
  channel is a text channel the bot can read. `/setup wordle status` shows the current
  value (or "not set").
- **`/setup logging channel:<#channel>`** — writes `loggingChannelId` and ensures
  `features.audit_logs !== false`. `/setup logging disable` sets `features.audit_logs = false`.
  `/setup logging status` shows current config.
- **`/setup admin-roles add:<@role>` / `remove:<@role>` / `list`** — manages the
  `adminRoles` array that `hasAdminPermission()` already reads, so admins can delegate
  setup access to non-Discord-admins.
- **`/setup overview`** — one-shot embed of all current config: wordle channel,
  logging channel + enabled state, admin roles, and verification status (read the same
  keys `/verification-setup status` reads). Highlights what is unset so an admin can
  see what is left to configure.

Verification keeps its existing dedicated `commands/verification-setup.js` command
(already complete); `/setup overview` just surfaces its status alongside the rest.

### Implementation notes
- New module `commands/setup.js` following the `verification-setup.js` shape
  (`{ data, execute }`), registered into `slashCommandBuilder` / `slashCommandHandler`.
- All writes go through `setSetting()`; all reads through `getSetting()`. Uses the exact
  keys in the table above so the runtime handlers pick up the config immediately.
- All four subcommands and `/debug` and `/help` and `/verification-setup` are added to
  `ENABLED_SLASH_COMMANDS` so they survive the free-version filter.

## Part 4 — Wordle leaderboard scope (private vs global)

### Purpose
Today every wordle leaderboard is private to its server (all scores filtered by
`guildId`). This adds a per-server admin choice to opt that server's players into a
**global** cross-server leaderboard, while leaving the per-server board intact.

### Behavior
- **Setting:** `wordleScope` per guild — `'private'` (default) or `'global'`. Set via a
  new `/setup wordle scope <private|global>` subcommand. `/setup wordle status` and
  `/setup overview` show the current scope.
- **Private (default):** unchanged — the server's leaderboard shows only that server's
  players. No scores leave the server.
- **Global:** the server's players additionally appear on a global leaderboard that
  aggregates across **all** servers whose `wordleScope === 'global'`.
- **Viewing:** the existing wordle leaderboard command/output stays per-server. A new
  global view is exposed (a `global` option on the wordle leaderboard command, or a
  `/setup wordle status`-adjacent global display) that any user in a global-opted server
  can see. Implementation detail (option vs separate command) is settled in the plan;
  the data contract is what matters here.

### Aggregation rule (decided)
A user's global stats = the **sum** of their `totalGames` and `totalHoney` across every
global-opted-in server they play in. Ranking is by summed `totalHoney` (the existing
leaderboard's ranking currency), descending. The same `userId` appearing in multiple
opted-in servers is collapsed into one global row by summing.

### Data flow
1. New Convex query `getGlobalLeaderboard(limit)` in `convex/wordle.ts`:
   - Calls `getAllServers`, filters to those with `settings.wordleScope === 'global'`.
   - For each such `guildId`, reads its `wordleScores` rows.
   - Reduces into a `Map<userId, { totalGames, totalHoney }>` by summing.
   - Returns the top `limit` users by `totalHoney` desc.
2. Bot side: a helper in `convexApiHelper.js`/`wordleHandler.js` calls the query and
   formats the global embed (reusing the existing per-server leaderboard formatting,
   labelled "🌍 Global").

### Privacy & edge cases
- Switching a server from `global` back to `private` immediately removes it from the
  global aggregation on the next query (no historical leakage — the query is live).
- A server with scope unset is treated as `private`.
- Username display on the global board: resolve via the bot's user cache where possible;
  fall back to the stored display name or `userId` if the user isn't reachable
  cross-server (the bot may not share every guild with every global user).

### Scope note
This is a small, self-contained addition to the wordle subsystem and the `/setup`
command. It does not interact with the free-version gating beyond `/setup wordle scope`
living under the already-enabled `/setup` command.

## Components and boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `config/freeVersion.js` | Single source of truth for what's enabled | env `FREE_VERSION` |
| `utils/debugInfo.js` | Gather host/runtime info into a plain object | `os`, `process`, `axios`, git |
| `commands/setup.js` | Admin setup slash command (`/setup ...`) | `settingsManager`, `adminPermissions` |
| `/debug` handler | Format + reply with debug info, admin-gated | `debugInfo`, `adminPermissions` |
| `handlerRegistry` gate | Skip non-allow-listed handlers | `freeVersion` |
| builder/handler gate | Hide + unregister non-allow-listed slash commands | `freeVersion` |
| `getGlobalLeaderboard` query | Aggregate wordle scores across global-opted servers | `convex` `getAllServers`, `wordleScores` |
| `/setup wordle scope` | Set `wordleScope` per guild | `settingsManager` |

## Error handling
- `/debug`: every external/fragile call (public IP fetch, git commit) is wrapped in
  try/catch with a safe fallback string; the command never errors out.
- `/setup`: validates channel/role inputs; on a `setSetting` failure, replies with a
  clear ephemeral error rather than throwing.
- Free-version gating is fail-safe: an unknown handler key with `FREE_VERSION` on stays
  disabled (allow-list, not deny-list), so nothing paid leaks through by accident.

## Testing
- Unit: `utils/debugInfo.js` returns expected keys and never throws when env vars /
  git / network are absent (mock `axios` and `execSync`).
- Unit: `config/freeVersion.js` — `isHandlerEnabled` / `isSlashCommandEnabled` honor the
  allow-list when on and pass everything when off.
- Manual/integration: with `FREE_VERSION` on, confirm only security + wordle + setup +
  debug + help commands appear and respond; gambling/economy/valorant commands are
  silent; `/setup wordle` then a wordle results message in that channel is tracked;
  `/setup logging` then a deleted message is logged; `/setup admin-roles add` lets a
  non-admin role use `/setup`.
- Manual/integration (Part 4): set `/setup wordle scope global` in two servers, play in
  both as the same user, confirm the global board sums their totals; set one back to
  `private` and confirm it drops out of the global board.

## Out of scope
- Deleting subscription code or paid handlers (kept for reversibility).
- Migrating existing guilds' settings (admins reconfigure via `/setup`).
- Changing the verification system's internals (reused as-is).
