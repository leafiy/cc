#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { renderClockDashboardHtml } from "./render-clock-dashboard.mjs";
import { renderDashboardHtml } from "./render-dashboard.mjs";
import { getCachedWeather, weatherCacheStatus } from "./qweather-cache.mjs";
import { loadConfig } from "./config.mjs";
import { getCombined, getKv, getReport, initDb } from "./sqlite-store.mjs";

const root = path.resolve(import.meta.dirname, "..");
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
  if (url.pathname === "/" || url.pathname === "/ui/index.html") {
    sendDashboard(res, url);
    return;
  }
  if (url.pathname === "/clock" || url.pathname === "/clock/") {
    sendClockDashboard(res, url);
    return;
  }
  if (serveData(url.pathname, res)) return;

  const routed = url.pathname === "/" ? "/ui/index.html" : decodeURIComponent(url.pathname);
  const file = path.resolve(root, `.${routed}`);

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
});

function sendDashboard(res, url) {
  const html = renderDashboardHtml({
    period: url.searchParams.get("period") || config.ui?.dashboardDefaultPeriod || "month",
    theme: url.searchParams.get("theme") || config.ui?.defaultTheme || "paper"
  });
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function sendClockDashboard(res, url) {
  const html = renderClockDashboardHtml({
    period: url.searchParams.get("period") || config.ui?.clockDefaultPeriod || "week",
    theme: url.searchParams.get("theme") || config.ui?.defaultTheme || "paper"
  });
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
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
