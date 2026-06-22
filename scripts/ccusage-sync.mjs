#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { loadConfig, normalizeReports } from "./config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const options = parseArgs(process.argv.slice(2));
const config = loadConfig();
const timezone = options.timezone || config.timezone || defaultTimezone;
const machine = safeName(options.machine || config.machine || os.hostname());
const ccusagePackage = config.ccusagePackage || "ccusage@20.0.14";
const since = options.since || config.filters?.since;
const until = options.until || config.filters?.until;
const piPaths = detectPiPaths(options.piPath || (config.piPaths || []).join(","));
const reports = [
  { name: "all", command: ["daily"], periods: ["daily", "monthly"] },
  ...normalizeReports(config).map((report) => ({ ...report, periods: ["daily", "monthly"] }))
];

main();

function main() {
  const latestDir = path.join(repoRoot, "data", "machines", machine, "latest");
  mkdirSync(latestDir, { recursive: true });

  const manifest = {
    machine,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    timezone,
    ccusagePackage,
    generatedAt: new Date().toISOString(),
    filters: { since: since || null, until: until || null },
    piPaths,
    reports: []
  };

  for (const report of reports) {
    for (const period of report.periods) {
      const key = `${report.name}.${period}`;
      const args = buildCcusageArgs(report, period);
      const outputPath = path.join(latestDir, `${key}.json`);

      try {
        const json = runCcusage(args);
        writeJson(outputPath, json);
        manifest.reports.push({ key, status: "ok", path: relativePath(outputPath) });
      } catch (error) {
        const errorPath = path.join(latestDir, `${key}.error.json`);
        writeJson(errorPath, {
          key,
          args,
          message: error.message,
          generatedAt: new Date().toISOString()
        });
        manifest.reports.push({ key, status: "error", path: relativePath(errorPath), message: error.message });
      }
    }
  }

  writeJson(path.join(latestDir, "manifest.json"), manifest);
  rebuildCombined();

  console.log(`ccusage sync complete for ${machine}`);
  console.log(`machine data: ${relativePath(latestDir)}`);
  console.log(`combined data: data/combined`);
}

function buildCcusageArgs(report, period) {
  const args = [...report.command];
  if (report.name === "all") {
    args[0] = period;
  } else {
    args.push(period);
  }
  args.push("--json", "--timezone", timezone);
  if (options.offline) args.push("--offline");
  if (since) args.push("--since", since);
  if (until) args.push("--until", until);
  if (report.name === "pi" && piPaths.length > 0) args.push("--pi-path", piPaths.join(","));
  return args;
}

function runCcusage(args) {
  const result = spawnSync("npx", ["--yes", ccusagePackage, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new Error(stderr || stdout || `ccusage exited with status ${result.status}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`ccusage returned non-JSON output: ${error.message}`);
  }
}

function rebuildCombined() {
  const machinesDir = path.join(repoRoot, "data", "machines");
  const combinedDir = path.join(repoRoot, "data", "combined");
  mkdirSync(combinedDir, { recursive: true });

  const manifests = [];
  const machineNames = existsSync(machinesDir)
    ? readdirSync(machinesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];

  for (const machineName of machineNames) {
    const manifestPath = path.join(machinesDir, machineName, "latest", "manifest.json");
    if (existsSync(manifestPath)) {
      manifests.push(readJson(manifestPath));
    }
  }

  writeJson(path.join(combinedDir, "machines.json"), {
    generatedAt: new Date().toISOString(),
    machines: manifests.sort((a, b) => a.machine.localeCompare(b.machine))
  });

  combinePeriod("daily", "daily", machineNames, combinedDir);
  combinePeriod("monthly", "monthly", machineNames, combinedDir);
  writeSummary(machineNames, combinedDir);
}

function combinePeriod(filePeriod, fieldName, machineNames, combinedDir) {
  const rowsByPeriod = new Map();
  const agentNames = ["claude", "codex", "opencode", "pi"];

  for (const machineName of machineNames) {
    for (const agentName of agentNames) {
      const file = path.join(repoRoot, "data", "machines", machineName, "latest", `${agentName}.${filePeriod}.json`);
      if (!existsSync(file)) continue;

      const data = readJson(file);
      const rows = Array.isArray(data[fieldName]) ? data[fieldName] : [];

      for (const row of rows) {
        const period = row.period || row.date || row.month;
        if (!period) continue;
        const target = rowsByPeriod.get(period) || emptyCombinedRow(period);
        addRow(target, row, machineName, agentName);
        rowsByPeriod.set(period, target);
      }
    }
  }

  const rows = [...rowsByPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const totals = rows.reduce((acc, row) => addTotals(acc, row), emptyTotals());
  const payload = {
    generatedAt: new Date().toISOString(),
    timezone,
    source: "ccusage",
    machines: machineNames,
    agents: agentNames,
    [fieldName]: rows,
    totals
  };

  writeJson(path.join(combinedDir, `${filePeriod}.json`), payload);
}

function emptyCombinedRow(period) {
  return {
    period,
    machines: [],
    agents: [],
    modelsUsed: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelBreakdowns: []
  };
}

function addRow(target, row, machineName, agentName) {
  addUnique(target.machines, machineName);
  addUnique(target.agents, agentName);
  for (const agent of row.metadata?.agents || []) addUnique(target.agents, agent);
  for (const model of getModelsUsed(row)) addUnique(target.modelsUsed, model);

  target.inputTokens += number(row.inputTokens);
  target.outputTokens += number(row.outputTokens);
  target.cacheCreationTokens += number(row.cacheCreationTokens);
  target.cacheReadTokens += number(row.cacheReadTokens);
  target.totalTokens += tokenTotal(row);
  target.totalCost += number(row.totalCost ?? row.costUSD);

  for (const breakdown of getModelBreakdowns(row)) {
    const modelName = breakdown.modelName || "unknown";
    let model = target.modelBreakdowns.find((item) => item.modelName === modelName);
    if (!model) {
      model = {
        modelName,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        cost: 0
      };
      target.modelBreakdowns.push(model);
    }
    model.inputTokens += number(breakdown.inputTokens);
    model.outputTokens += number(breakdown.outputTokens);
    model.cacheCreationTokens += number(breakdown.cacheCreationTokens);
    model.cacheReadTokens += number(breakdown.cacheReadTokens);
    model.totalTokens += tokenTotal(breakdown);
    model.cost += number(breakdown.cost ?? breakdown.costUSD);
  }

  target.agents.sort();
  target.modelsUsed.sort();
  target.modelBreakdowns.sort((a, b) => b.totalTokens - a.totalTokens || a.modelName.localeCompare(b.modelName));
}

function addTotals(acc, row) {
  acc.inputTokens += number(row.inputTokens);
  acc.outputTokens += number(row.outputTokens);
  acc.cacheCreationTokens += number(row.cacheCreationTokens);
  acc.cacheReadTokens += number(row.cacheReadTokens);
  acc.totalTokens += tokenTotal(row);
  acc.totalCost += number(row.totalCost ?? row.costUSD);
  return acc;
}

function emptyTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0
  };
}

function writeSummary(machineNames, combinedDir) {
  const monthly = readJson(path.join(combinedDir, "monthly.json"));
  const daily = readJson(path.join(combinedDir, "daily.json"));
  const latestMonth = monthly.monthly.at(-1);
  const latestDay = daily.daily.at(-1);
  const totals = monthly.totals;

  const lines = [
    "# ccusage combined summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Timezone: ${timezone}`,
    `Machines: ${machineNames.join(", ") || "none"}`,
    "",
    "## Lifetime",
    "",
    `- Tokens: ${formatNumber(totals.totalTokens)}`,
    `- Input: ${formatNumber(totals.inputTokens)}`,
    `- Output: ${formatNumber(totals.outputTokens)}`,
    `- Cache read: ${formatNumber(totals.cacheReadTokens)}`,
    `- Cache creation: ${formatNumber(totals.cacheCreationTokens)}`,
    `- Estimated cost: $${totals.totalCost.toFixed(4)}`,
    ""
  ];

  if (latestMonth) {
    lines.push("## Latest month", "");
    lines.push(`- Period: ${latestMonth.period}`);
    lines.push(`- Tokens: ${formatNumber(latestMonth.totalTokens)}`);
    lines.push(`- Estimated cost: $${latestMonth.totalCost.toFixed(4)}`);
    lines.push(`- Agents: ${latestMonth.agents.join(", ") || "unknown"}`);
    lines.push(`- Models: ${latestMonth.modelsUsed.join(", ") || "unknown"}`, "");
  }

  if (latestDay) {
    lines.push("## Latest day", "");
    lines.push(`- Date: ${latestDay.period}`);
    lines.push(`- Tokens: ${formatNumber(latestDay.totalTokens)}`);
    lines.push(`- Estimated cost: $${latestDay.totalCost.toFixed(4)}`);
    lines.push(`- Agents: ${latestDay.agents.join(", ") || "unknown"}`);
    lines.push(`- Models: ${latestDay.modelsUsed.join(", ") || "unknown"}`, "");
  }

  writeFileSync(path.join(combinedDir, "summary.md"), `${lines.join("\n")}\n`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--offline") parsed.offline = true;
    else if (arg === "--config") parsed.config = args[++index];
    else if (arg === "--timezone" || arg === "-z") parsed.timezone = args[++index];
    else if (arg === "--machine") parsed.machine = args[++index];
    else if (arg === "--pi-path") parsed.piPath = args[++index];
    else if (arg === "--since" || arg === "-s") parsed.since = args[++index];
    else if (arg === "--until" || arg === "-u") parsed.until = args[++index];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run sync -- [options]

Options:
  --timezone, -z <iana>  Date grouping timezone. Defaults to local system timezone.
  --machine <name>       Override the machine key used under data/machines.
  --pi-path <paths>      Oh My Pi/pi-agent session root(s), comma-separated.
  --since, -s <date>     Filter from date, passed to ccusage.
  --until, -u <date>     Filter until date, passed to ccusage.
  --offline              Ask ccusage to use cached pricing data.
  --config <file>        JSON config path. Defaults to ./ccusage.config.json.

Configuration:
  Copy ccusage.config.example.json to ccusage.config.json and edit it locally.
`);
}

function detectPiPaths(rawPaths) {
  const candidates = [];
  if (rawPaths) candidates.push(...splitPaths(rawPaths));
  if (process.env.PI_CODING_AGENT_DIR) candidates.push(...splitPaths(process.env.PI_CODING_AGENT_DIR));
  candidates.push(path.join(os.homedir(), ".omp", "agent"));

  const seen = new Set();
  return candidates
    .map((candidate) => path.resolve(expandHome(candidate)))
    .filter((candidate) => {
      if (seen.has(candidate) || !existsSync(candidate)) return false;
      seen.add(candidate);
      return true;
    });
}

function splitPaths(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function getModelsUsed(row) {
  const models = [];
  for (const model of row.modelsUsed || []) addUnique(models, model);
  for (const model of Object.keys(row.models || {})) addUnique(models, model);
  for (const breakdown of row.modelBreakdowns || []) addUnique(models, breakdown.modelName);
  return models;
}

function getModelBreakdowns(row) {
  if (Array.isArray(row.modelBreakdowns) && row.modelBreakdowns.length > 0) return row.modelBreakdowns;
  if (!row.models || typeof row.models !== "object") return [];

  const entries = Object.entries(row.models);
  return entries.map(([modelName, model]) => ({
    modelName,
    inputTokens: model.inputTokens,
    outputTokens: model.outputTokens,
    cacheCreationTokens: model.cacheCreationTokens,
    cacheReadTokens: model.cacheReadTokens,
    totalTokens: tokenTotal(model),
    cost: entries.length === 1 ? row.totalCost ?? row.costUSD : 0
  }));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function relativePath(file) {
  return path.relative(repoRoot, file);
}

function safeName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function tokenTotal(row) {
  const total = number(row.totalTokens);
  if (total > 0) return total;
  return number(row.inputTokens)
    + number(row.outputTokens)
    + number(row.cacheCreationTokens)
    + number(row.cacheReadTokens);
}

function addUnique(array, value) {
  if (value && !array.includes(value)) array.push(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(number(value)));
}
