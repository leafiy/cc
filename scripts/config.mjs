import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const defaultConfig = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  ccusagePackage: "ccusage@20.0.14",
  storage: {
    exportJson: false
  },
  ui: {
    host: "0.0.0.0",
    port: 8765,
    dashboardDefaultPeriod: "month",
    clockDefaultPeriod: "week",
    defaultTheme: "paper"
  },
  agents: ["claude", "codex", "opencode", "pi"],
  nodes: [
    { id: "local", label: "Local machine", mode: "local" }
  ],
  displayNames: {
    local: "Local"
  },
  weather: {
    enabled: false,
    provider: "qweather",
    apiHost: "",
    apiKey: "",
    credentialId: "",
    location: "",
    cityLabel: "",
    refreshMinutes: 30
  }
};

export function loadConfig() {
  const file = resolveConfigPath();
  if (!existsSync(file)) return structuredClone(defaultConfig);
  const userConfig = JSON.parse(readFileSync(file, "utf8"));
  return normalizeConfig(mergeConfig(defaultConfig, userConfig));
}

export function resolveConfigPath() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--config");
  if (index >= 0 && args[index + 1]) return path.resolve(args[index + 1]);
  return path.resolve(process.env.CCUSAGE_CONFIG || path.join(repoRoot, "ccusage.config.json"));
}

export function normalizeReports(config) {
  const agentCommands = {
    claude: ["claude"],
    codex: ["codex"],
    opencode: ["opencode"],
    pi: ["pi"]
  };
  return (config.agents || []).map((agent) => {
    if (typeof agent === "string") {
      return { name: agent, command: agentCommands[agent] || [agent], periods: ["daily"] };
    }
    return {
      name: agent.name,
      command: agent.command || agentCommands[agent.name] || [agent.name],
      periods: agent.periods || ["daily"]
    };
  }).filter((agent) => agent.name);
}

function normalizeConfig(config) {
  config.nodes = (config.nodes || []).filter((node) => node && node.enabled !== false);
  config.agents = config.agents || [];
  config.displayNames = config.displayNames || {};
  config.weather = config.weather || defaultConfig.weather;
  return config;
}

function mergeConfig(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (!isObject(base) || !isObject(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = mergeConfig(base[key], value);
  return out;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
