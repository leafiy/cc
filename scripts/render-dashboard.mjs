import { getCombined, getReport } from "./sqlite-store.mjs";

const W = 1280;
const H = 720;
const agents = ["claude", "codex", "opencode", "pi"];
const nameMap = {
  "52-4": "Mac mini M4",
  "52-30": "MacBook Air M3",
  "52-5-piggy": "Mac mini M2",
  "52-20": "Mac mini M1",
  "pc-2223": "PC",
  "pc2-2223": "PC2",
  "pc2-2224": "Devbox"
};

export function renderDashboardHtml({ period = "month", theme = "paper" } = {}) {
  const payload = buildPayload(period, theme);
  const svg = renderSvg(payload);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="60">
  <title>Token 用量统计</title>
  <style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;overscroll-behavior:none;touch-action:none;background:${payload.theme.bg};}
    body{position:fixed;inset:0;}
    svg{display:block;width:100vw;height:100vh;}
    a{text-decoration:none;color:inherit}
  </style>
</head>
<body>${svg}</body>
</html>`;
}

function buildPayload(period, themeName) {
  const daily = getCombined("daily") || { daily: [], generatedAt: null };
  const monthly = getCombined("monthly") || { monthly: [], generatedAt: null };
  const machines = getCombined("machines") || { machines: [] };
  const theme = themes()[themeName] || themes().paper;
  const rows = selectedRows(period, daily.daily || [], monthly.monthly || []);
  const prev = comparisonRows(period, daily.daily || []);
  const totals = sumRows(rows);
  const prevTotals = sumRows(prev);
  const machineRows = loadMachineRows(machines.machines || []);
  const devices = buildDevices(machineRows, machines.machines || []);
  const models = buildModels(rows, totals);
  const activity = buildActivity(rows);
  const ok = (machines.machines || []).filter((m) => m.status === "ok").length;

  return {
    period,
    themeName,
    theme,
    rows,
    totals,
    delta: prevTotals.totalTokens ? `${totals.totalTokens >= prevTotals.totalTokens ? "↑" : "↓"} ${Math.abs((totals.totalTokens / prevTotals.totalTokens - 1) * 100).toFixed(1)}% 较上一周期` : `${rows.length} 个统计点`,
    range: rangeLabel(rows),
    updated: fmtUpdated(daily.generatedAt || monthly.generatedAt),
    nodeState: `${ok}/${machines.machines?.length || 0}`,
    nodeSub: (machines.machines || []).filter((m) => m.status !== "ok").map((m) => `${nodeName(m.machine)}:${m.status}`).join(" · ") || "全部节点正常",
    dailyAvg: fmtTok(totals.totalTokens / Math.max(activeDayCount(rows), 1)),
    activeDays: `${activeDayCount(rows)} 天`,
    models,
    activity,
    devices
  };
}

function renderSvg(p) {
  const { bg, ink, muted, hair, track } = p.theme;
  const parts = [];
  const add = (s) => parts.push(s);
  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Token 用量统计">`);
  add(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  add(`<style>
    .sans{font-family:Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .mono{font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
    .muted{fill:${muted}}
    .ink{fill:${ink}}
    .line{stroke:${ink};stroke-width:1.5;fill:none}
    .hair{stroke:${hair};stroke-width:1;fill:none}
  </style>`);

  line(add, 32, 54, 1248, 54, ink, 1.5);
  text(add, 32, 37, "Token 用量统计", 28, 650, ink);
  text(add, 1248, 26, p.range, 10, 400, muted, "end", "mono", ".08em");
  text(add, 1248, 43, `UPDATED · ${p.updated}`, 10, 400, muted, "end", "mono", ".08em");
  controls(add, p, ink, bg, muted);

  metricBoxes(add, p, ink, muted, track);
  mainPanels(add, p, ink, muted, hair, track);
  devicesPanel(add, p, ink, muted, hair, track);
  line(add, 32, 692, 1248, 692, ink, 1.5);
  text(add, 32, 710, p.range, 10, 400, muted, "start", "mono", ".12em");
  text(add, 1248, 710, "DATA · sqlite", 10, 400, muted, "end", "mono", ".12em");
  add("</svg>");
  return parts.join("");
}

function controls(add, p, ink, bg, muted) {
  const periods = [["today", "今天"], ["week", "本周"], ["month", "本月"], ["year", "全年"]];
  let x = 32;
  for (const [key, label] of periods) {
    button(add, x, 70, 58, 30, label, key === p.period, `/?period=${key}&theme=${p.themeName}`, ink, bg);
    x += 58;
  }
  text(add, 1030, 91, "质感", 10, 400, muted, "start", "mono", ".18em");
  let tx = 1084;
  for (const [key, label] of [["paper", "札记"], ["ink", "墨"], ["mist", "雾"]]) {
    button(add, tx, 70, 54, 30, label, key === p.themeName, `/?period=${p.period}&theme=${key}`, ink, bg);
    tx += 54;
  }
}

function metricBoxes(add, p, ink, muted) {
  const x = 32, y = 116, h = 116, w1 = 520, w2 = 348, w3 = 348;
  rect(add, x, y, w1 + w2 + w3, h, "transparent", ink, 1.5);
  line(add, x + w1, y, x + w1, y + h, ink, 1.5);
  line(add, x + w1 + w2, y, x + w1 + w2, y + h, ink, 1.5);
  text(add, x + 28, y + 38, "总 TOKEN 消耗", 11, 400, muted, "start", "mono", ".22em");
  text(add, x + 28, y + 82, fmtTok(p.totals.totalTokens), 44, 650, ink);
  text(add, x + 28, y + 104, p.delta, 11, 400, muted, "start", "mono");
  text(add, x + w1 + 28, y + 38, "花费估算", 11, 400, muted, "start", "mono", ".22em");
  text(add, x + w1 + 28, y + 82, `$${fmtMoney(p.totals.totalCost)}`, 34, 650, ink);
  text(add, x + w1 + 28, y + 104, "USD · ccusage 混合定价估算", 11, 400, muted, "start", "mono");
  text(add, x + w1 + w2 + 28, y + 38, "节点状态", 11, 400, muted, "start", "mono", ".22em");
  text(add, x + w1 + w2 + 28, y + 82, p.nodeState, 34, 650, ink);
  text(add, x + w1 + w2 + 28, y + 104, p.nodeSub, 11, 400, muted, "start", "mono");
}

function mainPanels(add, p, ink, muted, hair, track) {
  const leftX = 32, top = 270, leftW = 590;
  const rightX = 670, rightW = 578;
  sectionHeader(add, leftX, top, leftW, "按模型 · BY MODEL", `${p.models.length} MODELS`, ink, muted);
  const max = Math.max(...p.models.map((m) => m.totalTokens), 1);
  p.models.slice(0, 6).forEach((m, i) => {
    const y = top + 36 + i * 44;
    text(add, leftX, y + 18, String(i + 1).padStart(2, "0"), 10, 400, muted, "start", "mono");
    text(add, leftX + 34, y + 18, m.name, 18, 650, ink);
    text(add, leftX + leftW, y + 18, `${Math.round((m.totalTokens / Math.max(p.totals.totalTokens, 1)) * 100)}%`, 13, 700, ink, "end", "mono");
    rect(add, leftX, y + 28, leftW, 6, track);
    rect(add, leftX, y + 28, Math.max(2, (m.totalTokens / max) * leftW), 6, ink);
    text(add, leftX, y + 42, `${fmtTok(m.totalTokens)} tok`, 10, 400, muted, "start", "mono");
    text(add, leftX + leftW, y + 42, `$${fmtMoney(m.cost)}`, 10, 400, muted, "end", "mono");
    line(add, leftX, y + 48, leftX + leftW, y + 48, hair, 1);
  });

  sectionHeader(add, rightX, top, rightW, "活跃日期 · ACTIVITY", p.activity[0] ? `峰值 ${p.activity[0].period}` : "峰值 --", ink, muted);
  text(add, rightX, top + 62, "日均 TOKEN", 10, 400, muted, "start", "mono", ".18em");
  text(add, rightX, top + 98, p.dailyAvg, 28, 650, ink);
  text(add, rightX + rightW, top + 62, "活跃天数", 10, 400, muted, "end", "mono", ".18em");
  text(add, rightX + rightW, top + 98, p.activeDays, 28, 650, ink, "end");
  line(add, rightX, top + 118, rightX + rightW, top + 118, ink, 1);
  const maxAct = Math.max(...p.activity.map((a) => a.totalTokens), 1);
  p.activity.slice(0, 5).forEach((a, i) => {
    const y = top + 148 + i * 32;
    text(add, rightX, y, dayLabel(a.period), 15, 650, ink);
    text(add, rightX, y + 14, a.period, 10, 400, muted, "start", "mono");
    rect(add, rightX + 118, y - 13, 392, 14, track);
    rect(add, rightX + 118, y - 13, Math.max(2, (a.totalTokens / maxAct) * 392), 14, ink);
    text(add, rightX + rightW, y - 1, `${Math.round((a.totalTokens / maxAct) * 100)}%`, 12, 700, ink, "end", "mono");
  });
}

function devicesPanel(add, p, ink, muted, hair, track) {
  const x = 32, y = 574, w = 1216;
  sectionHeader(add, x, y, w, "按设备 · BY DEVICE", `${p.devices.length} 台设备`, ink, muted);
  const cols = Math.max(1, p.devices.length);
  const gap = 10;
  const cardW = (w - gap * (cols - 1)) / cols;
  const maxTokens = Math.max(...p.devices.map((d) => d.totalTokens), 1);
  p.devices.forEach((d, i) => {
    const cx = x + i * (cardW + gap);
    const cy = y + 40;
    const pct = d.totalTokens / maxTokens;
    rect(add, cx, cy + 34, cardW, 1, hair);
    circle(add, cx + 18, cy + 15, 14, track, "none", 3);
    arc(add, cx + 18, cy + 15, 14, pct, ink, 3);
    text(add, cx + 18, cy + 19, `${Math.round((d.totalTokens / Math.max(sumDeviceTokens(p.devices), 1)) * 100)}%`, 8, 700, ink, "middle", "mono");
    text(add, cx + 42, cy + 7, d.name, Math.min(14, Math.max(9, cardW / 9)), 650, ink);
    text(add, cx + 42, cy + 20, d.os, 7, 400, muted, "start", "mono");
    text(add, cx + 42, cy + 32, `${fmtTok(d.totalTokens)} · $${fmtMoney(d.totalCost)}`, 8, 400, muted, "start", "mono");
  });
}

function sectionHeader(add, x, y, w, left, right, ink, muted) {
  text(add, x, y, left, 11, 650, ink, "start", "mono", ".2em");
  text(add, x + w, y, right, 10, 400, muted, "end", "mono", ".08em");
  line(add, x, y + 16, x + w, y + 16, ink, 1);
}

function button(add, x, y, w, h, label, active, href, ink, bg) {
  add(`<a href="${escAttr(href)}">`);
  rect(add, x, y, w, h, active ? ink : "transparent", ink, 1);
  text(add, x + w / 2, y + 19, label, 11, 650, active ? bg : ink, "middle", "mono");
  add("</a>");
}

function selectedRows(period, dailyRows, monthlyRows) {
  const now = dailyRows.at(-1)?.period;
  if (!now) return [];
  if (period === "today") return dailyRows.filter((r) => r.period === now);
  if (period === "week") return dailyRows.slice(-7);
  if (period === "month") return dailyRows.filter((r) => r.period.startsWith(now.slice(0, 7)));
  return monthlyRows;
}

function comparisonRows(period, dailyRows) {
  const now = dailyRows.at(-1)?.period;
  if (!now) return [];
  if (period === "today") return dailyRows.slice(-2, -1);
  if (period === "week") return dailyRows.slice(-14, -7);
  if (period === "month") {
    const d = new Date(`${now}T00:00:00`);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 7);
    return dailyRows.filter((r) => r.period.startsWith(prev));
  }
  return [];
}

function loadMachineRows(machines) {
  const out = {};
  for (const machine of machines) {
    const rows = [];
    for (const agent of agents) {
      const payload = getReport(machine.machine, agent, "daily");
      for (const row of payload?.daily || []) rows.push({ ...row, agent });
    }
    out[machine.machine] = rows;
  }
  return out;
}

function buildDevices(machineRows, manifests) {
  const meta = new Map(manifests.map((m) => [m.machine, m]));
  return Object.entries(machineRows).map(([machine, rows]) => {
    const totals = sumRows(rows);
    return { machine, name: nodeName(machine), os: deviceInfo(meta.get(machine)), ...totals };
  }).sort((a, b) => b.totalTokens - a.totalTokens);
}

function buildModels(rows, totals) {
  const map = new Map();
  for (const row of rows) {
    for (const m of row.modelBreakdowns || []) {
      const key = m.modelName || "unknown";
      const item = map.get(key) || { name: key, totalTokens: 0, cost: 0 };
      item.totalTokens += tokenTotal(m);
      item.cost += number(m.cost ?? m.costUSD);
      map.set(key, item);
    }
  }
  if (!map.size && totals.totalTokens) map.set("unknown", { name: "unknown", totalTokens: totals.totalTokens, cost: totals.totalCost });
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6);
}

function buildActivity(rows) {
  return rows.filter((r) => r.period?.length === 10).sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0)).slice(0, 5);
}

function sumRows(rows) {
  return rows.reduce((acc, row) => {
    acc.inputTokens += number(row.inputTokens);
    acc.outputTokens += number(row.outputTokens);
    acc.cacheCreationTokens += number(row.cacheCreationTokens);
    acc.cacheReadTokens += number(row.cacheReadTokens);
    acc.totalTokens += tokenTotal(row);
    acc.totalCost += number(row.totalCost ?? row.costUSD);
    return acc;
  }, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 });
}

function tokenTotal(row) {
  const total = number(row.totalTokens);
  if (total > 0) return total;
  return number(row.inputTokens) + number(row.outputTokens) + number(row.cacheCreationTokens) + number(row.cacheReadTokens);
}

function activeDayCount(rows) {
  return new Set(rows.map((r) => r.period)).size;
}

function rangeLabel(rows) {
  if (!rows.length) return "NO DATA";
  return rows[0].period === rows.at(-1).period ? rows[0].period : `${rows[0].period} — ${rows.at(-1).period}`;
}

function fmtTok(value) {
  const n = number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function fmtMoney(value) {
  const n = number(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

function fmtUpdated(v) {
  if (!v) return "--";
  const d = new Date(v);
  return `${String(d.getMonth() + 1).padStart(2, "0")} / ${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function nodeName(id) {
  return nameMap[id] || id;
}

function deviceInfo(m) {
  const p = m?.probe || {};
  const os = m?.os || {};
  const pretty = os.pretty || m?.osPretty || p.osPretty || platformName(m?.platform || p.platform || p.kernel);
  const arch = os.arch || m?.arch || p.arch;
  return [pretty, arch].filter(Boolean).join(" · ") || "unknown os";
}

function platformName(v) {
  v = String(v || "").toLowerCase();
  if (v === "darwin") return "macOS";
  if (v === "linux") return "Linux";
  return v;
}

function dayLabel(period) {
  return `周${"日一二三四五六"[new Date(`${period}T00:00:00`).getDay()]}`;
}

function sumDeviceTokens(devices) {
  return devices.reduce((sum, d) => sum + d.totalTokens, 0);
}

function themes() {
  return {
    paper: { bg: "#f4f3ee", ink: "#141414", muted: "rgba(20,20,20,.55)", hair: "rgba(20,20,20,.16)", track: "rgba(20,20,20,.10)" },
    ink: { bg: "#141414", ink: "#efede7", muted: "rgba(239,237,231,.56)", hair: "rgba(239,237,231,.18)", track: "rgba(239,237,231,.10)" },
    mist: { bg: "#faf9f6", ink: "#2a2a2a", muted: "rgba(42,42,42,.55)", hair: "rgba(42,42,42,.15)", track: "rgba(42,42,42,.09)" }
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function rect(add, x, y, w, h, fill, stroke = "none", sw = 0) {
  add(`<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}/>`);
}

function line(add, x1, y1, x2, y2, stroke, sw) {
  add(`<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${sw}"/>`);
}

function circle(add, cx, cy, r, stroke, fill = "none", sw = 1) {
  add(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
}

function arc(add, cx, cy, r, pct, stroke, sw) {
  const c = 2 * Math.PI * r;
  add(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="${round(Math.max(0, Math.min(1, pct)) * c)} ${round(c)}" transform="rotate(-90 ${round(cx)} ${round(cy)})"/>`);
}

function text(add, x, y, value, size, weight, fill, anchor = "start", klass = "sans", spacing = "0") {
  add(`<text x="${round(x)}" y="${round(y)}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" class="${klass}" letter-spacing="${spacing}">${escText(value)}</text>`);
}

function round(n) {
  return Number(n).toFixed(2).replace(/\.?0+$/, "");
}

function escText(value) {
  return String(value ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function escAttr(value) {
  return escText(value).replace(/"/g, "&quot;");
}
