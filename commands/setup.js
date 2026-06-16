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
  const wordleScope = (await getSetting(guildId, "wordleScope")) || "private";
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
        value:
          (wordleCh ? `<#${wordleCh}>` : "⚠️ not set — `/setup wordle channel`") +
          ` • scope: **${wordleScope}**`,
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
