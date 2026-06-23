#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { buildClockData, renderClockDashboardHtml } from "./render-clock-dashboard.mjs";
import { buildDashboardData, renderDashboardHtml } from "./render-dashboard.mjs";
import { getCachedWeather, weatherCacheStatus } from "./qweather-cache.mjs";
import { loadConfig } from "./config.mjs";
import { getCombined, getKv, getReport, initDb, queryJson } from "./sqlite-store.mjs";

const root = path.resolve(import.meta.dirname, "..");
const uiDir = path.join(root, "ui");
const config = loadConfig();
const host = config.ui?.host || "0.0.0.0";
const port = Number(config.ui?.port || 8765);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

initDb();

http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // Vue app shells (front/back separated). Data arrives via JSON + SSE, so these
  // are static and never re-render server-side — no meta-refresh flicker.
  if (pathname === "/" || pathname === "/index.html") return sendFile(res, path.join(uiDir, "dashboard.html"));
  if (pathname === "/clock" || pathname === "/clock/") return sendFile(res, path.join(uiDir, "clock.html"));

  // Legacy server-rendered pages, kept for fallback / debugging.
  if (pathname === "/legacy") return sendHtml(res, renderDashboardHtml({ period: url.searchParams.get("period") || config.ui?.dashboardDefaultPeriod || "month", theme: url.searchParams.get("theme") || config.ui?.defaultTheme || "paper" }));
  if (pathname === "/legacy/clock") return sendHtml(res, renderClockDashboardHtml({ period: url.searchParams.get("period") || config.ui?.clockDefaultPeriod || "week", theme: url.searchParams.get("theme") || config.ui?.defaultTheme || "paper" }));

  // JSON view payloads consumed by the Vue front-ends.
  if (pathname === "/api/view/dashboard") return sendJson(res, safeView(() => buildDashboardData(url.searchParams.get("period") || config.ui?.dashboardDefaultPeriod || "month")));
  if (pathname === "/api/view/clock") return sendJson(res, safeView(() => buildClockData(url.searchParams.get("period") || config.ui?.clockDefaultPeriod || "week")));

  // Server-sent events: push a signal whenever the underlying SQLite changes.
  if (pathname === "/api/events") return openEventStream(req, res);

  if (serveData(pathname, res)) return;

  const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return;
  }
  res.writeHead(200, {
    "content-type": types[path.extname(file)] || "application/octet-stream",
    "cache-control": file.endsWith(".json") ? "no-store" : "no-cache"
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`ccusage UI listening on http://${host}:${port}/`);
  startAutoSync();
});

// ---------------------------------------------------------------------------
// SSE: one watcher polls a content version (the fleet run's generated_at); on
// change it notifies every connected client, which then re-fetches its JSON
// view. Heartbeats keep the link alive and let the browser detect a dead
// connection for reconnection.
// ---------------------------------------------------------------------------
const sseClients = new Set();

function openEventStream(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ version: currentDataVersion() })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(frame); } catch { sseClients.delete(client); }
  }
}

function currentDataVersion() {
  // Content version, NOT file mtime. In WAL mode a write lands in the -wal
  // sidecar and does not bump the main .sqlite mtime until a checkpoint, so an
  // mtime watcher silently misses real updates. A read query can't change
  // generated_at, so there is no read-feedback loop either.
  try {
    const rows = queryJson("SELECT generated_at AS v FROM fleet_runs WHERE id = 1");
    return rows?.[0]?.v || "";
  } catch { return ""; }
}

let lastDataVersion = currentDataVersion();
setInterval(() => {
  const version = currentDataVersion();
  if (version !== lastDataVersion) {
    lastDataVersion = version;
    broadcast("update", { version });
  }
}, 3000).unref();
setInterval(() => broadcast("ping", { t: Date.now() }), 15000).unref();

function safeView(fn) {
  try { return fn(); } catch (error) { return { error: error.message }; }
}

function sendFile(res, file) {
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

function sendHtml(res, html) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

function startAutoSync() {
  const raw = process.env.CCUSAGE_AUTO_SYNC_MINUTES ?? config.ui?.autoSyncMinutes ?? 0;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("auto-sync: disabled");
    return;
  }

  let running = false;
  const run = (label, extraArgs = []) => {
    if (running) {
      console.log(`auto-sync: previous sync still running, skipping ${label}`);
      return Promise.resolve();
    }
    running = true;
    console.log(`auto-sync: starting ${label} at ${new Date().toISOString()}`);
    const child = spawn("node", [path.join(root, "scripts", "fleet-sync.mjs"), ...extraArgs], { cwd: root, stdio: "inherit" });
    return new Promise((resolve) => {
      child.on("exit", (code) => {
        running = false;
        console.log(`auto-sync: ${label} finished (exit ${code}) at ${new Date().toISOString()}`);
        resolve();
      });
      child.on("error", (error) => {
        running = false;
        console.error(`auto-sync: ${label} failed to start: ${error.message}`);
        resolve();
      });
    });
  };

  const localNode = (config.nodes || []).find((node) => node.mode === "local" || node.id === "local");

  console.log(`auto-sync: enabled, running fleet sync every ${minutes} minute(s)`);
  (async () => {
    if (localNode) {
      // Local collection is fast (no SSH), so surface its data first, then fill in the rest.
      await run(`local sync (${localNode.id})`, ["--node", localNode.id]);
    }
    await run("full fleet sync");
  })();
  setInterval(() => run("full fleet sync"), minutes * 60_000).unref();
}

function serveData(pathname, res) {
  try {
    const normalized = decodeURIComponent(pathname);
    if (normalized === "/api/combined/daily" || normalized === "/data/combined/daily.json") {
      return sendJsonOrFallback(res, getCombined("daily"), "/data/combined/daily.json");
    }
    if (normalized === "/api/combined/monthly" || normalized === "/data/combined/monthly.json") {
      return sendJsonOrFallback(res, getCombined("monthly"), "/data/combined/monthly.json");
    }
    if (normalized === "/api/combined/machines" || normalized === "/data/combined/machines.json") {
      return sendJsonOrFallback(res, getCombined("machines"), "/data/combined/machines.json");
    }
    if (normalized === "/api/summary" || normalized === "/data/combined/summary.md") {
      return sendTextOrFallback(res, getKv("summary.md"), "/data/combined/summary.md", "text/markdown; charset=utf-8");
    }
    if (normalized === "/api/weather") {
      return sendJson(res, weatherCacheStatus());
    }
    if (normalized === "/api/weather/refresh") {
      return sendJson(res, getCachedWeather());
    }

    const reportMatch = normalized.match(/^\/(?:api\/)?data\/machines\/([^/]+)\/latest\/([^/.]+)\.(daily|monthly)\.json$/)
      || normalized.match(/^\/api\/machines\/([^/]+)\/latest\/([^/.]+)\.(daily|monthly)$/);
    if (reportMatch) {
      const [, machine, agent, periodType] = reportMatch;
      const payload = getReport(machine, agent, periodType);
      return sendJsonOrFallback(res, payload, `/data/machines/${machine}/latest/${agent}.${periodType}.json`);
    }
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`${error.message}\n`);
    return true;
  }
  return false;
}

function sendJson(res, payload) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(`${JSON.stringify(payload)}\n`);
  return true;
}

function sendJsonOrFallback(res, payload, fallbackPath) {
  if (payload) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(`${JSON.stringify(payload)}\n`);
    return true;
  }
  return sendFileFallback(res, fallbackPath);
}

function sendTextOrFallback(res, text, fallbackPath, contentType) {
  if (text != null) {
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    res.end(text);
    return true;
  }
  return sendFileFallback(res, fallbackPath);
}

function sendFileFallback(res, fallbackPath) {
  const file = path.resolve(root, `.${fallbackPath}`);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return true;
  }
  res.writeHead(200, {
    "content-type": types[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(readFileSync(file));
  return true;
}
