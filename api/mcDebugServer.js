const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const {
  AttachmentBuilder,
  ChannelFlags,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const {
  buildThreadTitle,
  buildLogTail,
  truncateLogs,
  validateReport,
  sanitizeFilename,
  getClientIp,
} = require("../utils/mcDebugReport");
const { RateLimiter } = require("../utils/mcDebugRateLimit");

const DEFAULT_FORUM_ID = "1527727915817762997";
// Per-screenshot cap, enforced in app code (handleReport) — multer's own
// per-file limit is raised above this so a large `logs` upload isn't rejected.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// multer's fileSize applies to EVERY file part, including a logs file sent as
// an upload rather than a text field, and fieldSize applies to logs sent as
// text. Both are set to this so an oversized logs upload reaches
// truncateLogs() instead of being rejected outright; screenshots are still
// capped at MAX_FILE_BYTES by the explicit check in handleReport.
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/** Constant-time string compare that tolerates differing lengths. */
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Strip CR/LF and other control characters so untrusted text can't forge log lines. */
function stripControlChars(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Is this error plausibly about the attachments (screenshots) rather than some
 * unrelated failure (permissions, bad tag, bad title, ...)? Used to gate the
 * screenshot-drop retry so it only fires when dropping screenshots could help.
 */
function isAttachmentError(error) {
  if (error?.status === 413) return true;
  if (error?.code === 40005) return true;
  const message = String(error?.message || "").toLowerCase();
  return /attachment|file|size/.test(message);
}

/**
 * Pick a forum tag for the thread: the first tag that looks bug-related, or —
 * only when the forum requires a tag — the first available one, so creation
 * cannot fail for want of a tag.
 */
function pickTags(channel) {
  const tags = channel.availableTags || [];
  if (!tags.length) return undefined;

  const match = tags.find((tag) => /bug|debug|report/i.test(tag.name));
  if (match) return [match.id];
  if (channel.flags?.has?.(ChannelFlags.RequireTag)) return [tags[0].id];
  return undefined;
}

/**
 * Minecraft Debug Webhook API
 *
 * Receives in-game /debug reports from the Minecraft mod and opens a thread in
 * the Discord bug forum carrying the mod version, the player's description, the
 * logs, and up to three screenshots.
 */
class McDebugServer {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.secret = process.env.MC_DEBUG_WEBHOOK_SECRET || null;
    this.forumChannelId = process.env.MC_DEBUG_FORUM_CHANNEL_ID || DEFAULT_FORUM_ID;
    this.ipLimiter = new RateLimiter();
    this.userLimiter = new RateLimiter();

    if (!this.secret) {
      console.warn(
        "[MC Debug] MC_DEBUG_WEBHOOK_SECRET is not set — every report will be rejected with 503."
      );
    }

    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        // Applies to every file part (screenshots AND a logs file). Screenshots
        // are additionally capped at MAX_FILE_BYTES (8 MB) in handleReport;
        // this larger ceiling exists so a big logs upload survives to
        // truncateLogs() instead of being rejected here.
        fileSize: MAX_UPLOAD_BYTES,
        files: 4, // 3 screenshots + an optional logs file
        // Exactly the four text fields the contract defines: version,
        // description, username, logs. Kept tight (not a round number) so a
        // request can't pad in extra huge fields before any rate limit runs.
        fields: 4,
        // Logs behave the same whether sent as a text field or as a file:
        // accepted up to MAX_UPLOAD_BYTES, then truncated to the last 1 MB.
        fieldSize: MAX_UPLOAD_BYTES,
      },
    }).fields([
      { name: "screenshots", maxCount: 3 },
      { name: "logs", maxCount: 1 },
    ]);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use((req, res, next) => {
      console.log(`[MC Debug] ${req.method} ${req.path}`);
      next();
    });
  }

  requireAuth(req, res, next) {
    if (!this.secret) {
      return res.status(503).json({
        success: false,
        error: "The Minecraft debug endpoint is not configured on the bot.",
      });
    }

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token || !secretsMatch(token, this.secret)) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid or missing bearer token." });
    }
    return next();
  }

  /**
   * Rejects already-rate-limited sources BEFORE multer buffers the request
   * body. Runs between requireAuth and the upload middleware, using only
   * headers/socket (getClientIp needs no parsed body). This is a read-only
   * check() — it does NOT record() — so a malformed-but-allowed request still
   * gets to consume its quota exactly once, in handleReport, after
   * validation. That means an accepted report is check()ed twice (here, then
   * again in handleReport); check() is cheap and read-only by design, so
   * that's an acceptable cost for closing the buffer-before-limit gap.
   */
  checkIpRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const ipCheck = this.ipLimiter.check(ip, Date.now());
    if (!ipCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: "Too many reports from this address. Try again later.",
        retryAfter: ipCheck.retryAfter,
      });
    }
    return next();
  }

  setupRoutes() {
    this.app.get("/api/mcdebug/health", (req, res) => {
      res.json({
        success: true,
        service: "Minecraft Debug API",
        status: "online",
        botReady: this.client.ws.status === 0,
        configured: Boolean(this.secret),
        timestamp: new Date().toISOString(),
      });
    });

    this.app.post(
      "/api/mcdebug/report",
      this.requireAuth.bind(this),
      this.checkIpRateLimit.bind(this),
      (req, res) => {
        this.upload(req, res, (uploadError) => {
          if (uploadError) return this.handleUploadError(uploadError, res);

          this.handleReport(req, res).catch((error) => {
            console.error("[MC Debug] Unhandled report error:", error);
            if (!res.headersSent) {
              res.status(500).json({ success: false, error: "Internal error." });
            }
          });
        });
      }
    );
  }

  handleUploadError(error, res) {
    console.warn(`[MC Debug] Upload rejected: ${error.code || error.message}`);

    if (error.code === "LIMIT_FILE_SIZE") {
      // multer's own per-file ceiling (MAX_UPLOAD_BYTES) is above the 8 MB
      // screenshot cap so oversized logs uploads reach truncateLogs() instead
      // of landing here — this only fires for a file past that larger ceiling.
      return res.status(413).json({
        success: false,
        error: "A screenshot exceeded 8 MB, or an uploaded logs file exceeded 16 MB.",
      });
    }
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        error: "Send at most 3 files under the field name 'screenshots' and 1 under 'logs'.",
      });
    }
    if (error.code === "LIMIT_FIELD_VALUE") {
      return res.status(413).json({ success: false, error: "A text field was too large." });
    }
    return res.status(400).json({ success: false, error: "Malformed multipart upload." });
  }

  async handleReport(req, res) {
    const ip = getClientIp(req);
    const version = String(req.body.version || "").trim();
    const description = String(req.body.description || "").trim();
    const username = String(req.body.username || "").trim();
    const screenshots = req.files?.screenshots || [];
    const logsFile = (req.files?.logs || [])[0];
    const logs = logsFile ? logsFile.buffer.toString("utf8") : String(req.body.logs || "");

    // multer's own per-file limit was raised to MAX_UPLOAD_BYTES (16 MB) so a
    // large logs upload survives to truncateLogs(); screenshots still need
    // their own 8 MB cap enforced here.
    const oversizedScreenshot = screenshots.find((file) => file.size > MAX_FILE_BYTES);
    if (oversizedScreenshot) {
      return res
        .status(413)
        .json({ success: false, error: "Each screenshot must be 8 MB or smaller." });
    }

    const totalBytes = screenshots.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return res
        .status(413)
        .json({ success: false, error: "Screenshots exceed the 20 MB total limit." });
    }

    const validation = validateReport({ version, description, username, screenshots });
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, error: validation.error });
    }

    const now = Date.now();
    // An omitted username must not disable this limiter: fall back to the IP,
    // prefixed so the two key spaces (usernames vs. IP fallbacks) can't collide.
    const userKey = username ? username.toLowerCase() : `ip:${ip}`;

    const ipCheck = this.ipLimiter.check(ip, now);
    if (!ipCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: "Too many reports from this address. Try again later.",
        retryAfter: ipCheck.retryAfter,
      });
    }

    const userCheck = this.userLimiter.check(userKey, now);
    if (!userCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: "Too many reports from this player. Try again later.",
        retryAfter: userCheck.retryAfter,
      });
    }

    if (this.client.ws.status !== 0) {
      return res.status(503).json({
        success: false,
        error: "The bot is not connected to Discord right now. Retry shortly.",
        retryAfter: 30,
      });
    }

    // Both keys passed, so consume both.
    this.ipLimiter.record(ip, now);
    this.userLimiter.record(userKey, now);

    try {
      const thread = await this.createThread({
        version,
        description,
        username,
        logs,
        screenshots,
      });
      console.log(
        `[MC Debug] Opened thread ${thread.id} for ${stripControlChars(username) || ip}`
      );
      return res.status(201).json({
        success: true,
        threadId: thread.id,
        url: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
      });
    } catch (error) {
      console.error("[MC Debug] Failed to create forum thread:", error);
      return res
        .status(error.status || 502)
        .json({ success: false, error: "Discord rejected the report." });
    }
  }

  async createThread({ version, description, username, logs, screenshots }) {
    const channel = await this.client.channels.fetch(this.forumChannelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      const error = new Error("MC_DEBUG_FORUM_CHANNEL_ID does not point at a forum channel");
      error.status = 502;
      throw error;
    }

    const { text: logText, truncated } = truncateLogs(logs);
    const tail = buildLogTail(logText);

    const embed = new EmbedBuilder()
      .setTitle("🐛 In-game bug report")
      .setColor(0xe67e22)
      .setDescription(description)
      .addFields({ name: "Mod version", value: `\`${version}\``, inline: true })
      .setTimestamp();

    if (username) embed.addFields({ name: "Reporter", value: username, inline: true });
    if (truncated) {
      embed.setFooter({ text: "Logs exceeded 1 MB — only the last 1 MB is attached." });
    }

    const logAttachments = logText
      ? [new AttachmentBuilder(Buffer.from(logText, "utf8"), { name: "logs.txt" })]
      : [];
    const imageAttachments = screenshots.map(
      (file, index) =>
        new AttachmentBuilder(file.buffer, {
          name: sanitizeFilename(file.originalname, `screenshot-${index + 1}.png`),
        })
    );

    const content = tail ? `**Last log lines**\n\`\`\`\n${tail}\n\`\`\`` : undefined;
    const appliedTags = pickTags(channel);
    const name = buildThreadTitle(version, description);

    try {
      return await channel.threads.create({
        name,
        message: {
          content,
          embeds: [embed],
          files: [...logAttachments, ...imageAttachments],
          // logs and description are attacker-controlled (mod is client-side);
          // never let Discord parse mentions out of them — an @everyone or role
          // ping needs no special permission to land.
          allowedMentions: { parse: [] },
        },
        appliedTags,
        reason: "Minecraft in-game /debug report",
      });
    } catch (error) {
      if (!imageAttachments.length || !isAttachmentError(error)) throw error;

      // A partial report beats no report: drop the images and try once more.
      console.error(
        "[MC Debug] Thread creation failed with screenshots, retrying without them:",
        error.message
      );
      embed.addFields({
        name: "⚠️ Attachments",
        value: "Screenshots could not be uploaded and were dropped.",
      });
      return await channel.threads.create({
        name,
        message: {
          content,
          embeds: [embed],
          files: logAttachments,
          allowedMentions: { parse: [] },
        },
        appliedTags,
        reason: "Minecraft in-game /debug report (screenshots dropped)",
      });
    }
  }

  start(port = 3004) {
    this.server = this.app.listen(port, () => {
      console.log(`[MC Debug] ✅ Minecraft Debug API listening on port ${port}`);
      console.log(`[MC Debug] Forum channel: ${this.forumChannelId}`);
    });

    this.server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`[MC Debug] ❌ Port ${port} is already in use.`);
      } else {
        console.error("[MC Debug] ❌ Server error:", error);
      }
    });

    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close(() => console.log("[MC Debug] Server stopped"));
    }
  }
}

module.exports = McDebugServer;
