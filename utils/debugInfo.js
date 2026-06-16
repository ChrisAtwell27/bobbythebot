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
