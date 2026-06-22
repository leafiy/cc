#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  initDb,
  saveCombined,
  saveFleetRun,
  saveKv,
  saveManifest,
  saveReport
} from "./sqlite-store.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const agentNames = ["claude", "codex", "opencode", "pi", "all"];
const periodTypes = ["daily", "monthly"];

initDb();
importMachines();
importCombined();
importFleetRun();

console.log("imported legacy JSON data into SQLite");

function importMachines() {
  const machinesDir = path.join(repoRoot, "data", "machines");
  if (!existsSync(machinesDir)) return;

  for (const entry of readdirSync(machinesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const machine = entry.name;
    const latestDir = path.join(machinesDir, machine, "latest");
    const manifest = readJsonIfExists(path.join(latestDir, "manifest.json"));
    if (manifest) saveManifest(manifest);

    for (const agent of agentNames) {
      for (const periodType of periodTypes) {
        const payload = readJsonIfExists(path.join(latestDir, `${agent}.${periodType}.json`));
        if (payload) saveReport(machine, agent, periodType, payload, { status: agent === "all" ? "derived" : "ok" });
      }
    }
  }
}

function importCombined() {
  const combinedDir = path.join(repoRoot, "data", "combined");
  const daily = readJsonIfExists(path.join(combinedDir, "daily.json"));
  const monthly = readJsonIfExists(path.join(combinedDir, "monthly.json"));
  const machines = readJsonIfExists(path.join(combinedDir, "machines.json"));
  const summary = readTextIfExists(path.join(combinedDir, "summary.md"));

  if (daily) saveCombined("daily", daily);
  if (monthly) saveCombined("monthly", monthly);
  if (machines) saveCombined("machines", machines);
  if (summary) saveKv("summary.md", summary);
}

function importFleetRun() {
  const payload = readJsonIfExists(path.join(repoRoot, "data", "fleet", "latest-run.json"));
  if (payload) saveFleetRun(payload);
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function readTextIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
