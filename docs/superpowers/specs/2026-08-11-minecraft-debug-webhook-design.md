# Minecraft `/debug` Webhook + Forum Nudge — Design

**Date:** 2026-08-11
**Status:** Approved

## Problem

Minecraft mod players who hit a bug have no structured way to report it. They
report in Discord chat, where reports get lost and lack version/log context.

Two pieces solve this:

1. A **webhook** the mod POSTs to from an in-game `/debug` command. It creates a
   forum thread in Discord channel `1527727915817762997` containing the mod
   version, the player's description, the logs, and up to 3 screenshots.
2. A **nudge**: when a newly-joined member with the `@Minecraft` or `@Craftics`
   role describes a problem in chat, the bot replies once pointing them at that
   same forum.

## Scope

In scope: the HTTP endpoint, the forum thread creation, the chat nudge, and the
persistence needed to nudge each member only once.

Out of scope: linking Minecraft accounts to Discord accounts, an in-Discord
triage workflow, editing or closing threads after creation, and any change to
the existing Discord-side `/debug` slash command in
`commands/debugCommand.js` (unrelated feature, same name).

## Architecture

The bot already runs three internal express servers (mafia webhook on 3001,
subscription on 3002, settings on 3003), each started on `client.once("ready")`
and reached through the public HTTP server in `index.js`, which proxies
`/api/*` by path prefix. This feature adds a fourth on port 3004 following the
same pattern.

Chat monitoring goes through the existing centralized `commandRouter`, which
runs a single `messageCreate` listener and fans out to registered message
processors. No new Discord event listener is added.

### Components

| Component | Responsibility |
| --- | --- |
| `api/mcDebugServer.js` | HTTP endpoint, auth, rate limiting, forum thread creation |
| `utils/mcDebugReport.js` | Pure helpers: validation, thread title, log tail |
| `events/mcForumNudgeHandler.js` | Message processor that replies to new members |
| `utils/mcNudgeMatch.js` | Pure helper: does this message text look like a bug report |
| `database/models/User.js` | Gains `mcForumNudgedAt` so each member is nudged once |
| `index.js` | Proxy rule, server startup, graceful shutdown |
| `events/handlerRegistry.js` | Registers the nudge processor |

The two `utils/` modules hold every branch worth testing and depend on nothing
from Discord or express, so the test suite exercises them directly.

## Webhook

### Request

```http
POST /api/mcdebug/report
Authorization: Bearer <MC_DEBUG_WEBHOOK_SECRET>
Content-Type: multipart/form-data
```

| Field | Type | Rules |
| --- | --- | --- |
| `version` | text | required, 1–64 chars |
| `description` | text | required, 1–2000 chars |
| `logs` | text or file | optional, max 1 MB; if longer, keep the **last** 1 MB |
| `username` | text | optional, ≤32 chars, the player's Minecraft name |
| `screenshots` | file, 0–3 | `image/png` or `image/jpeg` only, ≤8 MB each, ≤20 MB total |

Files are parsed by `multer` (new dependency) using memory storage. Nothing
touches disk.

### Authentication

A single shared secret in `MC_DEBUG_WEBHOOK_SECRET`, sent as a bearer token.

The mod is client-side, so this secret is extractable by anyone who unpacks the
jar. It is a speed bump against drive-by abuse, not a real access control. Rate
limiting is what actually protects the forum. If the secret is unset the server
logs a warning and refuses every request, rather than running open — this
differs from `mafiaWebhookServer.js`, which skips auth when unconfigured.

### Rate limiting

In-memory, using the existing `CleanupMap` from `utils/memoryUtils.js`. Two
independent keys, both enforced:

- per source IP: 3 reports / 10 min, 20 / day
- per `username` when supplied: 3 reports / 10 min, 20 / day

Limits reset on bot restart. That is acceptable: the failure mode is a brief
window of extra allowance, not lost data.

### Responses

| Status | Meaning |
| --- | --- |
| `201` | `{ success: true, threadId, url }` |
| `400` | Validation failed; `error` names the offending field |
| `401` | Missing or wrong bearer token |
| `413` | A screenshot, or the total upload, exceeded its cap. Oversized `logs` are truncated instead of rejected, so they never produce a `413` |
| `429` | Rate limited; `retryAfter` in seconds |
| `502` | Discord rejected the thread creation |
| `503` | Discord client not ready; the mod should retry later |

`GET /api/mcdebug/health` returns service status, matching the other servers.

## Forum thread

Target channel comes from `MC_DEBUG_FORUM_CHANNEL_ID`, defaulting to
`1527727915817762997`. Created via `forumChannel.threads.create({ name, message,
appliedTags })`.

**Title:** `[v{version}] {description}`, with the description truncated so the
whole title stays within Discord's 100-character limit. Truncation breaks on a
word boundary where possible and appends `…`.

**Body:** an embed with Version, Reporter (omitted when no `username` was sent),
and Description fields, followed by a fenced code block holding the **last 15
lines** of the logs, itself capped at 1000 characters. This makes the common
case — a stack trace at the end of the log — readable without downloading
anything.

**Attachments:** the full logs as `logs.txt`, plus each screenshot under its
original filename (sanitized).

**Tags:** if the forum defines tags, apply the first whose name matches
`/bug|debug|report/i`. If the forum requires a tag and nothing matched, apply
the first available tag so creation does not fail.

## Nudge

Registered with `commandRouter.registerMessageProcessor(processor,
"mcForumNudge")`. The feature key keeps it off non-full servers; the handler
additionally hard-checks the guild id, since the forum only exists in one
server.

The nudge fires only when every condition holds:

1. Guild is `MC_FORUM_GUILD_ID`, default `701308904877064193` (the main server).
2. Channel is not the forum channel and not a thread inside it.
3. `member.joinedTimestamp` is within the last 7 days.
4. The member has a role named `minecraft` or `craftics`, matched
   case-insensitively. `MC_NUDGE_ROLE_IDS` (comma-separated) overrides name
   matching with exact ids.
5. The message text matches (see below).
6. The user's `mcForumNudgedAt` is unset.

On a match the bot replies publicly to the message, mentioning the forum
channel, then sets `mcForumNudgedAt` to now. Every member is therefore nudged at
most once, ever.

### Text matching

Default mode requires **both** a bug keyword and more than 6 words:

```text
bug, issue, problem, glitch, broke, broken, crash, crashing, error,
fail, failing, doesn't work, does not work, doesnt work, not working,
won't load, wont load, supposed to, stuck
```

The literal reading of the original request — keyword **or** more than 6 words —
fires on nearly every message a new member sends, including greetings. Setting
`MC_NUDGE_MODE=keyword-or-length` restores that literal behavior; the default is
`keyword`.

## Error handling

The webhook returns `503` rather than `500` when the Discord client is not
ready, so the mod can distinguish "retry later" from "this request is bad." If
Discord rejects the screenshots but accepts the thread, the thread is still
created and the embed notes that images were dropped — a partial report beats no
report.

The nudge handler wraps its whole body in a try/catch and logs failures. A
thrown nudge error must never break the shared message router, which every other
handler depends on. Database write failure after a successful reply is logged
and swallowed; the worst case is one duplicate nudge.

All logs are prefixed `[MC Debug]` or `[MC Nudge]`.

## Testing

`tests/mcDebugReport.test.js` and `tests/mcNudgeMatch.test.js`, run by the
existing `npm test` (`node --test "tests/**/*.test.js"`).

Covered: title truncation at the 100-char boundary and on word breaks; log tail
extraction when logs are empty, shorter than 15 lines, and longer; validation
rejecting missing version, oversized description, wrong mime type, and a fourth
screenshot; rate limiter allowing 3 then blocking the 4th and expiring correctly;
keyword matching in both modes, including the 6-word boundary and case
insensitivity.

Discord API calls and express wiring are not unit tested — they are verified by
hand against the real forum channel once deployed.

## Configuration

```dotenv
MC_DEBUG_API_PORT=3004
MC_DEBUG_WEBHOOK_SECRET=<random secret, also embedded in the mod>
MC_DEBUG_FORUM_CHANNEL_ID=1527727915817762997
MC_FORUM_GUILD_ID=701308904877064193
MC_NUDGE_ROLE_IDS=                  # optional, comma-separated, overrides name match
MC_NUDGE_MODE=keyword               # or keyword-or-length
MC_DEBUG_API_ENABLED=true           # set false to disable the server
```
