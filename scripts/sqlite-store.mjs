import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
export const defaultDbPath = process.env.CCUSAGE_DB || path.join(repoRoot, "data", "ccusage.sqlite");

export function initDb(dbPath = defaultDbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  execSql(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS reports (
  machine TEXT NOT NULL,
  agent TEXT NOT NULL,
  period_type TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  message TEXT,
  PRIMARY KEY (machine, agent, period_type)
);
CREATE TABLE IF NOT EXISTS manifests (
  machine TEXT PRIMARY KEY,
  label TEXT,
  status TEXT,
  generated_at TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS combined (
  period_type TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fleet_runs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`, dbPath);
}

export function saveReport(machine, agent, periodType, payload, { status = "ok", message = null, generatedAt = new Date().toISOString(), dbPath = defaultDbPath } = {}) {
  execSql(`
INSERT INTO reports (machine, agent, period_type, generated_at, status, payload_json, message)
VALUES (${lit(machine)}, ${lit(agent)}, ${lit(periodType)}, ${lit(generatedAt)}, ${lit(status)}, ${lit(payload == null ? null : JSON.stringify(payload))}, ${lit(message)})
ON CONFLICT(machine, agent, period_type) DO UPDATE SET
  generated_at = excluded.generated_at,
  status = excluded.status,
  payload_json = excluded.payload_json,
  message = excluded.message;
`, dbPath);
}

export function getReport(machine, agent, periodType, dbPath = defaultDbPath) {
  const rows = queryJson(`
SELECT payload_json, status, message, generated_at
FROM reports
WHERE machine = ${lit(machine)} AND agent = ${lit(agent)} AND period_type = ${lit(periodType)}
LIMIT 1;
`, dbPath);
  if (!rows.length || !rows[0].payload_json) return null;
  return JSON.parse(rows[0].payload_json);
}

export function saveManifest(manifest, dbPath = defaultDbPath) {
  execSql(`
INSERT INTO manifests (machine, label, status, generated_at, manifest_json)
VALUES (${lit(manifest.machine)}, ${lit(manifest.label)}, ${lit(manifest.status || "unknown")}, ${lit(manifest.generatedAt || new Date().toISOString())}, ${lit(JSON.stringify(manifest))})
ON CONFLICT(machine) DO UPDATE SET
  label = excluded.label,
  status = excluded.status,
  generated_at = excluded.generated_at,
  manifest_json = excluded.manifest_json;
`, dbPath);
}

export function listManifests(machineNames = [], dbPath = defaultDbPath) {
  const where = machineNames.length ? `WHERE machine IN (${machineNames.map(lit).join(", ")})` : "";
  const rows = queryJson(`
SELECT manifest_json
FROM manifests
${where}
ORDER BY machine;
`, dbPath);
  return rows.map((row) => JSON.parse(row.manifest_json));
}

export function saveCombined(periodType, payload, dbPath = defaultDbPath) {
  execSql(`
INSERT INTO combined (period_type, generated_at, payload_json)
VALUES (${lit(periodType)}, ${lit(payload.generatedAt || new Date().toISOString())}, ${lit(JSON.stringify(payload))})
ON CONFLICT(period_type) DO UPDATE SET
  generated_at = excluded.generated_at,
  payload_json = excluded.payload_json;
`, dbPath);
}

export function getCombined(periodType, dbPath = defaultDbPath) {
  const rows = queryJson(`
SELECT payload_json
FROM combined
WHERE period_type = ${lit(periodType)}
LIMIT 1;
`, dbPath);
  return rows.length ? JSON.parse(rows[0].payload_json) : null;
}

export function saveFleetRun(payload, dbPath = defaultDbPath) {
  execSql(`
INSERT INTO fleet_runs (id, generated_at, payload_json)
VALUES (1, ${lit(payload.generatedAt || new Date().toISOString())}, ${lit(JSON.stringify(payload))})
ON CONFLICT(id) DO UPDATE SET
  generated_at = excluded.generated_at,
  payload_json = excluded.payload_json;
`, dbPath);
}

export function saveKv(key, value, dbPath = defaultDbPath) {
  execSql(`
INSERT INTO kv (key, value, updated_at)
VALUES (${lit(key)}, ${lit(value)}, ${lit(new Date().toISOString())})
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
`, dbPath);
}

export function getKv(key, dbPath = defaultDbPath) {
  const rows = queryJson(`SELECT value FROM kv WHERE key = ${lit(key)} LIMIT 1;`, dbPath);
  return rows.length ? rows[0].value : null;
}

export function execSql(sql, dbPath = defaultDbPath) {
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `sqlite3 exit ${result.status}`).trim());
  return result.stdout || "";
}

export function queryJson(sql, dbPath = defaultDbPath) {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `sqlite3 exit ${result.status}`).trim());
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : [];
}

function lit(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
