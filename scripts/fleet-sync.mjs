#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  getReport,
  initDb,
  listManifests,
  saveCombined,
  saveFleetRun,
  saveKv,
  saveManifest,
  saveReport
} from "./sqlite-store.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const nodes = [
  { id: "52-4", label: "52.4 local", mode: "local" },
  { id: "52-30", label: "leafiy@192.168.52.30", user: "leafiy", host: "192.168.52.30" },
  { id: "52-20", label: "leafiy@192.168.52.20", user: "leafiy", host: "192.168.52.20" },
  { id: "52-5-piggy", label: "piggy@192.168.52.5", user: "piggy", host: "192.168.52.5" },
  { id: "pc-2223", label: "root@pc:2223", user: "root", host: "pc", port: 2223 },
  { id: "pc2-2223", label: "root@pc2:2223", user: "root", host: "pc2", port: 2223 },
  { id: "pc2-2224", label: "root@pc2:2224", user: "root", host: "pc2", port: 2224 }
];

const options = parseArgs(process.argv.slice(2));
const timezone = options.timezone || process.env.CCUSAGE_TZ || defaultTimezone;
const ccusagePackage = process.env.CCUSAGE_PACKAGE || "ccusage@20.0.14";
const since = options.since || process.env.CCUSAGE_SINCE;
const until = options.until || process.env.CCUSAGE_UNTIL;
const exportJson = options.exportJson || process.env.CCUSAGE_JSON_EXPORT === "1";

const reports = [
  { name: "claude", command: ["claude"], periods: ["daily"] },
  { name: "codex", command: ["codex"], periods: ["daily"] },
  { name: "opencode", command: ["opencode"], periods: ["daily"] },
  { name: "pi", command: ["pi"], periods: ["daily"] }
];

main();

function main() {
  initDb();
  const selectedNodes = filterNodes(nodes);
  const run = {
    generatedAt: new Date().toISOString(),
    timezone,
    ccusagePackage,
    filters: { since: since || null, until: until || null },
    nodes: []
  };

  for (const node of selectedNodes) {
    run.nodes.push(collectNode(node));
  }

  rebuildCombined(nodes.map((node) => node.id));
  saveFleetRun(run);
  if (exportJson) writeJson(path.join(repoRoot, "data", "fleet", "latest-run.json"), run);

  console.log(`fleet sync complete: ${run.nodes.filter((node) => node.status === "ok").length}/${run.nodes.length} nodes ok`);
  for (const node of run.nodes) {
    console.log(`${node.id}: ${node.status}${node.message ? ` - ${node.message}` : ""}`);
  }
}

function collectNode(node) {
  const latestDir = path.join(repoRoot, "data", "machines", node.id, "latest");
  if (exportJson) mkdirSync(latestDir, { recursive: true });
  const reportPayloads = new Map();

  const manifest = {
    machine: node.id,
    label: node.label,
    node,
    timezone,
    ccusagePackage,
    generatedAt: new Date().toISOString(),
    filters: { since: since || null, until: until || null },
    probe: null,
    reports: []
  };

  const probe = runProbe(node);
  manifest.probe = probe.ok ? probe.data : null;
  if (!probe.ok) {
    manifest.status = "error";
    manifest.message = probe.message;
    saveManifest(manifest);
    if (exportJson) writeJson(path.join(latestDir, "manifest.json"), manifest);
    return { id: node.id, label: node.label, status: "error", message: probe.message };
  }

  for (const report of reports) {
    for (const period of report.periods) {
      const key = `${report.name}.${period}`;
      const args = buildCcusageArgs(report, period);
      const outputPath = path.join(latestDir, `${key}.json`);
      const result = runCcusageOnNode(node, args, report.name === "pi");

      if (result.ok) {
        saveReport(node.id, report.name, period, result.data, { status: "ok" });
        reportPayloads.set(key, result.data);
        if (exportJson) writeJson(outputPath, result.data);
        manifest.reports.push({ key, status: "ok", storage: "sqlite", path: exportJson ? relativePath(outputPath) : null });
      } else {
        const errorPath = path.join(latestDir, `${key}.error.json`);
        const errorPayload = {
          key,
          args,
          message: result.message,
          generatedAt: new Date().toISOString()
        };
        saveReport(node.id, report.name, period, null, { status: "error", message: result.message });
        if (exportJson) writeJson(errorPath, errorPayload);
        manifest.reports.push({ key, status: "error", storage: "sqlite", path: exportJson ? relativePath(errorPath) : null, message: result.message });
      }
    }
  }

  writeDerivedNodeReports(node.id, reportPayloads, latestDir, manifest);

  const failedReports = manifest.reports.filter((report) => report.status === "error");
  manifest.status = failedReports.length === 0 ? "ok" : "partial";
  manifest.message = failedReports.length === 0 ? null : `${failedReports.length} report(s) failed`;
  saveManifest(manifest);
  if (exportJson) writeJson(path.join(latestDir, "manifest.json"), manifest);
  return { id: node.id, label: node.label, status: manifest.status, message: manifest.message };
}

function runProbe(node) {
  const result = runShellOnNode(node, remoteShell("probe"));
  if (!result.ok) return result;

  const data = {};
  for (const line of result.stdout.trim().split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) data[line.slice(0, index)] = line.slice(index + 1);
  }
  return { ok: true, data };
}

function runCcusageOnNode(node, args, includePiPath) {
  const command = remoteShell("ccusage", { args, includePiPath });
  const result = runShellOnNode(node, command, 180_000);
  if (!result.ok) return result;

  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, message: `non-JSON ccusage output: ${error.message}` };
  }
}

function remoteShell(mode, context = {}) {
  const setup = `
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
detect_pi_paths() {
  pi_paths=""
  add_path() {
    p="$1"
    [ -n "$p" ] || return 0
    [ -d "$p" ] || return 0
    case ",$pi_paths," in
      *,"$p",*) ;;
      *) pi_paths="\${pi_paths:+$pi_paths,}$p" ;;
    esac
  }
  add_path "\${PI_CODING_AGENT_DIR:-}"
  add_path "$HOME/.omp/agent"
  add_path "$PWD/.omp/agent"
  add_path "/root/1/devbox/.omp/agent"
  printf '%s' "$pi_paths"
}
run_ccusage() {
  if command -v npx >/dev/null 2>&1; then
    npx --yes "$@"
  elif command -v bun >/dev/null 2>&1; then
    bun x --silent "$@"
  else
    echo "npx or bun not found" >&2
    exit 127
  fi
}
`;

  if (mode === "probe") {
    return `${setup}
printf 'hostname=%s\\n' "$(hostname 2>/dev/null || true)"
printf 'pwd=%s\\n' "$PWD"
printf 'home=%s\\n' "$HOME"
printf 'node=%s\\n' "$(command -v node 2>/dev/null || true)"
printf 'npx=%s\\n' "$(command -v npx 2>/dev/null || true)"
printf 'npm=%s\\n' "$(command -v npm 2>/dev/null || true)"
printf 'bun=%s\\n' "$(command -v bun 2>/dev/null || true)"
if command -v npx >/dev/null 2>&1; then
  printf 'runner=npx\\n'
elif command -v bun >/dev/null 2>&1; then
  printf 'runner=bun\\n'
else
  printf 'runner=\\n'
fi
printf 'piPaths=%s\\n' "$(detect_pi_paths)"
`;
  }

  const args = [...context.args];
  if (context.includePiPath) {
    return `${setup}
pi_paths="$(detect_pi_paths)"
if [ -n "$pi_paths" ]; then
  run_ccusage ${quoteShell(ccusagePackage)} ${args.map(quoteShell).join(" ")} --pi-path "$pi_paths"
else
  run_ccusage ${quoteShell(ccusagePackage)} ${args.map(quoteShell).join(" ")}
fi
`;
  }

  return `${setup}
run_ccusage ${quoteShell(ccusagePackage)} ${args.map(quoteShell).join(" ")}
`;
}

function runShellOnNode(node, command, timeout = 30_000) {
  if (node.mode === "local") {
    return runProcess("sh", ["-s"], { timeout, input: command });
  }

  const sshArgs = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=accept-new"
  ];
  if (node.port) sshArgs.push("-p", String(node.port));
  sshArgs.push(`${node.user}@${node.host}`, "sh", "-s");
  return runProcess("ssh", sshArgs, { timeout, input: command });
}

function runProcess(command, args, { timeout, input = undefined }) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    timeout
  });

  if (result.error) {
    return { ok: false, message: result.error.message, stdout: result.stdout || "", stderr: result.stderr || "" };
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    return { ok: false, message, stdout: result.stdout || "", stderr: result.stderr || "" };
  }
  return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
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
  return args;
}

function writeDerivedNodeReports(machineName, reportPayloads, latestDir, manifest) {
  const agentRows = [];
  for (const report of reports) {
    const payload = reportPayloads.get(`${report.name}.daily`);
    if (!payload) continue;
    const rows = Array.isArray(payload.daily) ? payload.daily : [];
    agentRows.push(...rows.map((row) => ({ row, agent: report.name })));

    const monthlyPayload = buildAggregatePayload(rows.map((row) => ({ row, agent: report.name })), "monthly");
    const monthlyPath = path.join(latestDir, `${report.name}.monthly.json`);
    saveReport(machineName, report.name, "monthly", monthlyPayload, { status: "derived" });
    if (exportJson) writeJson(monthlyPath, monthlyPayload);
    manifest.reports.push({ key: `${report.name}.monthly`, status: "derived", storage: "sqlite", path: exportJson ? relativePath(monthlyPath) : null });
  }

  const allDailyPath = path.join(latestDir, "all.daily.json");
  const allMonthlyPath = path.join(latestDir, "all.monthly.json");
  const allDaily = buildAggregatePayload(agentRows, "daily");
  const allMonthly = buildAggregatePayload(agentRows, "monthly");
  saveReport(machineName, "all", "daily", allDaily, { status: "derived" });
  saveReport(machineName, "all", "monthly", allMonthly, { status: "derived" });
  if (exportJson) {
    writeJson(allDailyPath, allDaily);
    writeJson(allMonthlyPath, allMonthly);
  }
  manifest.reports.push({ key: "all.daily", status: "derived", storage: "sqlite", path: exportJson ? relativePath(allDailyPath) : null });
  manifest.reports.push({ key: "all.monthly", status: "derived", storage: "sqlite", path: exportJson ? relativePath(allMonthlyPath) : null });
}

function buildAggregatePayload(agentRows, periodType) {
  const fieldName = periodType === "monthly" ? "monthly" : "daily";
  const rowsByPeriod = new Map();

  for (const { row, agent } of agentRows) {
    const sourcePeriod = row.period || row.date || row.month;
    if (!sourcePeriod) continue;
    const period = periodType === "monthly" ? sourcePeriod.slice(0, 7) : sourcePeriod;
    const target = rowsByPeriod.get(period) || emptyCombinedRow(period);
    addRow(target, row, null, agent);
    rowsByPeriod.set(period, target);
  }

  const rows = [...rowsByPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const totals = rows.reduce((acc, row) => addTotals(acc, row), emptyTotals());
  return {
    generatedAt: new Date().toISOString(),
    timezone,
    source: "ccusage-fleet-derived",
    [fieldName]: rows,
    totals
  };
}

function rebuildCombined(machineNames) {
  const combinedDir = path.join(repoRoot, "data", "combined");
  if (exportJson) mkdirSync(combinedDir, { recursive: true });

  const manifests = listManifests(machineNames);
  const machinesPayload = {
    generatedAt: new Date().toISOString(),
    machines: manifests.sort((a, b) => a.machine.localeCompare(b.machine))
  };
  saveCombined("machines", machinesPayload);
  if (exportJson) writeJson(path.join(combinedDir, "machines.json"), machinesPayload);

  const daily = combinePeriod("daily", "daily", machineNames, combinedDir);
  const monthly = combinePeriod("monthly", "monthly", machineNames, combinedDir);
  writeSummary(machineNames, combinedDir, { daily, monthly, manifests });
}

function combinePeriod(filePeriod, fieldName, machineNames, combinedDir) {
  const rowsByPeriod = new Map();
  const agentNames = ["claude", "codex", "opencode", "pi"];

  for (const machineName of machineNames) {
    for (const agentName of agentNames) {
      const data = getReport(machineName, agentName, filePeriod);
      if (!data) continue;
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
    source: "ccusage-fleet",
    machines: machineNames,
    agents: agentNames,
    [fieldName]: rows,
    totals
  };
  saveCombined(filePeriod, payload);
  if (exportJson) writeJson(path.join(combinedDir, `${filePeriod}.json`), payload);
  return payload;
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
  target.totalTokens += number(row.totalTokens);
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
    model.totalTokens += number(breakdown.totalTokens);
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
  acc.totalTokens += number(row.totalTokens);
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

function writeSummary(machineNames, combinedDir, { daily, monthly, manifests }) {
  const latestMonth = monthly.monthly.at(-1);
  const latestDay = daily.daily.at(-1);
  const totals = monthly.totals;
  const manifestByMachine = new Map(manifests.map((manifest) => [manifest.machine, manifest]));
  const statuses = machineNames.map((machineName) => {
    const manifest = manifestByMachine.get(machineName);
    if (!manifest) return `${machineName}: missing`;
    return `${machineName}: ${manifest.status || "unknown"}`;
  });

  const lines = [
    "# ccusage fleet summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Timezone: ${timezone}`,
    `Machines: ${machineNames.join(", ") || "none"}`,
    "",
    "## Node status",
    "",
    ...statuses.map((status) => `- ${status}`),
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

  const summary = `${lines.join("\n")}\n`;
  saveKv("summary.md", summary);
  if (exportJson) writeFileSync(path.join(combinedDir, "summary.md"), summary);
}

function filterNodes(allNodes) {
  if (!options.node) return allNodes;
  const requested = new Set(options.node.split(",").map((item) => item.trim()).filter(Boolean));
  return allNodes.filter((node) => requested.has(node.id));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--offline") parsed.offline = true;
    else if (arg === "--export-json") parsed.exportJson = true;
    else if (arg === "--timezone" || arg === "-z") parsed.timezone = args[++index];
    else if (arg === "--node") parsed.node = args[++index];
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
  console.log(`Usage: npm run fleet:sync -- [options]

Options:
  --timezone, -z <iana>  Date grouping timezone. Defaults to local system timezone.
  --node <ids>           Comma-separated node ids to collect.
  --since, -s <date>     Filter from date, passed to ccusage.
  --until, -u <date>     Filter until date, passed to ccusage.
  --offline              Ask ccusage to use cached pricing data.
  --export-json          Also write legacy data/*.json files.

Node ids:
  ${nodes.map((node) => node.id).join(", ")}
`);
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
    totalTokens: model.totalTokens,
    cost: entries.length === 1 ? row.totalCost ?? row.costUSD : 0
  }));
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function relativePath(file) {
  return path.relative(repoRoot, file);
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function addUnique(array, value) {
  if (value && !array.includes(value)) array.push(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(number(value)));
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
