#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const host = process.env.CCUSAGE_UI_HOST || "0.0.0.0";
const port = Number(process.env.CCUSAGE_UI_PORT || 8765);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
