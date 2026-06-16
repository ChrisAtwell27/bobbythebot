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
