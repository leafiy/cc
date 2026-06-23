import { getCombined, getReport } from "./sqlite-store.mjs";
import { loadConfig, normalizeReports } from "./config.mjs";

const config = loadConfig();
const agents = normalizeReports(config).map((report) => report.name);
const periods = [["today", "今天"], ["week", "本周"], ["month", "本月"], ["year", "全年"]];
const variants = [["paper", "札记"], ["ink", "墨"], ["mist", "雾"]];
const nameMap = config.displayNames || {};

// Data-only builder for the Vue/SSE front-end. Theme is decided client-side by
// time of day, so we ignore it here and just return the computed payload.
export function buildDashboardData(period = "month") {
  return buildPayload(period, "paper");
}

export function renderDashboardHtml({ period = "month", theme = "paper" } = {}) {
  const payload = buildPayload(period, theme);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="60">
  <title>Token 用量统计</title>
  <style>${styles(payload)}</style>
</head>
<body>
  <main class="screen" aria-label="Token 用量统计">
    ${desktop(payload)}
    ${mobile(payload)}
  </main>
  <script>
    document.addEventListener("dblclick", async (event) => {
      if (!event.target.closest(".fullscreen-trigger")) return;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } catch {}
    });
  </script>
</body>
</html>`;
}

function buildPayload(periodName, themeName) {
  const daily = getCombined("daily") || { daily: [], generatedAt: null };
  const monthly = getCombined("monthly") || { monthly: [], generatedAt: null };
  const machines = getCombined("machines") || { machines: [] };
  const theme = themes()[themeName] || themes().paper;
  const period = periods.some(([key]) => key === periodName) ? periodName : "month";
  const rows = selectedRows(period, daily.daily || [], monthly.monthly || []);
  const prev = comparisonRows(period, daily.daily || []);
  const totals = sumRows(rows);
  const prevTotals = sumRows(prev);
  const machineRows = loadMachineRows(machines.machines || [], periodDateFilter(period, daily.daily || []));
  const devices = buildDevices(machineRows, machines.machines || []);
  const models = buildModels(rows, totals);
  const activeDays = activeDayCount(rows);

  return {
    period,
    themeName: themes()[themeName] ? themeName : "paper",
    theme,
    rows,
    totals,
    delta: deltaLabel(totals.totalTokens, prevTotals.totalTokens, rows.length),
    range: rangeLabel(rows),
    updated: fmtUpdated(daily.generatedAt || monthly.generatedAt),
    dailyAvg: fmtTok(totals.totalTokens / Math.max(activeDays, 1)),
    activeDays: `${activeDays} 天`,
    models,
    devices,
    desktopDevices: compressDevices(devices, 10),
    mobileDevices: compressDevices(devices, 8)
  };
}

function styles(p) {
  const { bg, ink, muted, hair, track, inkRgb } = p.theme;
  const mCols = Math.min(4, Math.max(1, p.mobileDevices.length));
  const dCols = p.desktopDevices.length > 7 ? 2 : 1;
  return `
    *{box-sizing:border-box}
    html,body{margin:0;width:100%;min-height:100%;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:auto;touch-action:pan-y;background:${bg};color:${ink}}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    button{font:inherit;color:inherit}
    .screen{width:100vw;min-height:100svh;display:flex;flex-direction:column;background:${bg};color:${ink};overflow:visible}
    .mono{font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
    .muted{color:${muted}}
    .hair{border-color:${hair}}
    .page{width:100%;min-height:0;margin-block:auto;display:flex;flex-direction:column;gap:clamp(9px,1.35vh,16px);padding:clamp(16px,2.35vh,34px) clamp(22px,3.4vw,54px) clamp(10px,1.6vh,22px)}
    .desktop{display:flex}
    .mobile{display:none}
    .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid ${ink};padding-bottom:clamp(8px,1.05vh,13px);flex:none}
    h1{margin:0;font-size:clamp(24px,2.5vw,34px);font-weight:600;letter-spacing:-.02em;line-height:.95;white-space:nowrap}
    .stamp{text-align:right;font-size:clamp(9px,.72vw,11px);line-height:1.55;letter-spacing:.06em;color:${muted}}
    .controls{display:flex;justify-content:space-between;align-items:center;gap:18px;flex:none}
    .seg{display:inline-flex;border:1.5px solid ${ink}}
    .seg a{display:block;border-left:1.5px solid ${ink};font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(10px,.82vw,12px);letter-spacing:.12em;text-transform:uppercase;padding:clamp(8px,1.12vh,11px) clamp(14px,1.7vw,20px)}
    .seg a:first-child{border-left:0}
    .seg a.active{background:${ink};color:${bg}}
    .tone{display:flex;align-items:center;gap:14px}
    .tone-label{font-size:clamp(9px,.7vw,10px);letter-spacing:.18em;text-transform:uppercase;color:${muted}}
    .hero{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1.5px solid ${ink};flex:none}
    .hero-cell{min-width:0;padding:clamp(12px,1.65vh,20px) clamp(18px,2.35vw,30px);border-left:1.5px solid ${ink}}
    .hero-cell:first-child{border-left:0}
    .eyebrow{font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(9px,.72vw,11px);letter-spacing:.22em;text-transform:uppercase;color:${muted};white-space:nowrap}
    .big{margin-top:clamp(7px,1vh,12px);font-size:clamp(30px,4vw,52px);font-weight:600;letter-spacing:-.035em;line-height:.9;font-variant-numeric:tabular-nums;white-space:nowrap}
    .mid{margin-top:clamp(7px,1vh,12px);font-size:clamp(26px,3vw,40px);font-weight:600;letter-spacing:-.03em;line-height:.92;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sub{margin-top:clamp(6px,.9vh,10px);font-size:clamp(10px,.82vw,12px);color:${muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:clamp(22px,3vw,42px);align-items:stretch}
    .panel{min-height:0;display:flex;flex-direction:column}
    .section-title{flex:none;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid ${ink};padding-bottom:clamp(7px,1vh,12px);gap:14px}
    .section-title strong{font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(9px,.72vw,11px);letter-spacing:.22em;text-transform:uppercase;white-space:nowrap}
    .section-title span{font-size:clamp(9px,.72vw,11px);color:${muted};white-space:nowrap}
    .models{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:clamp(7px,1vh,12px);padding:clamp(7px,1vh,13px) 0}
    .model{min-height:0;padding-bottom:clamp(5px,.8vh,9px);border-bottom:1px solid ${hair}}
    .model-head,.model-foot{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
    .model-name{display:flex;gap:clamp(9px,1vw,12px);align-items:baseline;min-width:0}
    .idx,.model-foot{color:${muted};font-size:clamp(8px,.62vw,10px)}
    .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(13px,1.2vw,18px);font-weight:600;letter-spacing:-.01em}
    .pct{font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(11px,.95vw,13px);font-weight:700;white-space:nowrap}
    .bar{height:clamp(5px,.72vh,8px);background:${track};position:relative;margin:clamp(4px,.7vh,7px) 0}
    .bar i{position:absolute;inset:0 auto 0 0;background:${ink}}
    .devices{--device-cols:${dCols};flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--device-cols),minmax(0,1fr));gap:clamp(7px,1vh,12px) clamp(14px,1.2vw,20px);padding:clamp(7px,1vh,13px) 0}
    .device{min-width:0;display:flex;align-items:center;gap:clamp(9px,1vw,14px);border-bottom:1px solid ${hair};padding-bottom:clamp(5px,.82vh,9px)}
    .ring{position:relative;width:clamp(38px,3.5vw,60px);height:clamp(38px,3.5vw,60px);flex:none}
    .ring svg{width:100%;height:100%;transform:rotate(-90deg)}
    .ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(9px,.82vw,12px);font-weight:700}
    .device-title{font-size:clamp(12px,1.05vw,16px);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .device-sub,.device-foot{font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(8px,.62vw,10px);color:${muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .device-sub{margin-top:2px}
    .device-foot{margin-top:clamp(4px,.6vh,8px)}
    .footer{flex:none;padding-top:clamp(7px,1vh,13px);border-top:1.5px solid ${ink};display:flex;justify-content:space-between;gap:20px;font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(9px,.72vw,11px);letter-spacing:.1em;color:${muted};white-space:nowrap}
    @media (max-width:759px){
      .desktop{display:none}
      .mobile{display:flex}
      .page{min-height:0;padding:14px 14px 12px;gap:7px}
      .top{padding-bottom:9px}
      h1{font-size:18px}
      .stamp{font-size:9px;line-height:1.45}
      .mobile-tabs{display:flex;border:1.5px solid ${ink};flex:none}
      .mobile-tabs a{flex:1;text-align:center;font-family:"Space Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:9px 0;border-left:1.5px solid ${ink}}
      .mobile-tabs a:first-child{border-left:0}
      .mobile-tabs a.active{background:${ink};color:${bg}}
      .hero{grid-template-columns:repeat(3,minmax(0,1fr))}
      .hero-cell{padding:9px 10px}
      .eyebrow{font-size:8px;letter-spacing:.14em}
      .big,.mid{font-size:20px;margin-top:5px}
      .sub{display:none}
      .mobile-models{flex:none;min-height:0}
      .section-title{padding-bottom:6px}
      .section-title strong,.section-title span{font-size:9px;letter-spacing:.18em}
      .models{padding:5px 0;gap:7px}
      .model{padding-bottom:6px;border-bottom:1px solid ${hair}}
      .model-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
      .model-foot{display:flex}
      .idx{display:none}
      .name{font-size:12px}
      .pct{font-size:11px;text-align:right}
      .bar{height:7px;margin:3px 0}
      .mobile-devices{flex:none}
      .devices{--device-cols:${mCols};display:grid;grid-template-columns:repeat(var(--device-cols),minmax(0,1fr));gap:5px 8px;padding:7px 0 0}
      .device{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;border:0;padding:0}
      .ring{width:${p.mobileDevices.length > 4 ? "34px" : "42px"};height:${p.mobileDevices.length > 4 ? "34px" : "42px"}}
      .ring b{font-size:9px}
      .device-title{font-size:9px;max-width:100%}
      .device-sub{display:none}
      .device-foot{font-size:7px;margin-top:0;max-width:100%}
      .footer{display:none}
    }
  `;
}

function desktop(p) {
  return `<section class="page desktop">
    ${header(p)}
    ${controls(p)}
    ${hero(p)}
    <div class="grid">
      ${modelsPanel(p, false)}
      ${devicesPanel(p, false)}
    </div>
    ${footer(p)}
  </section>`;
}

function mobile(p) {
  return `<section class="page mobile">
    ${header(p)}
    ${mobileTabs(p)}
    ${hero(p)}
    ${modelsPanel(p, true)}
    ${devicesPanel(p, true)}
  </section>`;
}

function header(p) {
  return `<header class="top">
    <h1 class="fullscreen-trigger">Token 用量统计</h1>
    <div class="stamp mono">${esc(p.range)}<br>UPDATED · ${esc(p.updated)}</div>
  </header>`;
}

function controls(p) {
  return `<nav class="controls" aria-label="控制">
    <div class="seg">${periodLinks(p)}</div>
    <div class="tone"><span class="tone-label mono">质感</span><div class="seg">${themeLinks(p)}</div></div>
  </nav>`;
}

function mobileTabs(p) {
  return `<nav class="mobile-tabs" aria-label="周期">${periodLinks(p)}</nav>`;
}

function periodLinks(p) {
  return periods.map(([key, label]) => `<a class="${key === p.period ? "active" : ""}" href="/?period=${key}&theme=${p.themeName}">${label}</a>`).join("");
}

function themeLinks(p) {
  return variants.map(([key, label]) => `<a class="${key === p.themeName ? "active" : ""}" href="/?period=${p.period}&theme=${key}">${label}</a>`).join("");
}

function hero(p) {
  return `<section class="hero">
    <div class="hero-cell">
      <div class="eyebrow">总 TOKEN 消耗</div>
      <div class="big">${esc(fmtTok(p.totals.totalTokens))}</div>
      <div class="sub">${esc(p.delta)}</div>
    </div>
    <div class="hero-cell">
      <div class="eyebrow">花费估算</div>
      <div class="mid">$${esc(fmtMoney(p.totals.totalCost))}</div>
      <div class="sub">USD · ccusage 混合定价估算</div>
    </div>
    <div class="hero-cell">
      <div class="eyebrow">日均 TOKEN</div>
      <div class="mid">${esc(p.dailyAvg)}</div>
      <div class="sub">${esc(p.activeDays)}</div>
    </div>
  </section>`;
}

function modelsPanel(p, mobileView) {
  const max = Math.max(...p.models.map((m) => m.totalTokens), 1);
  const total = Math.max(p.totals.totalTokens, 1);
  const models = p.models.slice(0, 6);
  return `<section class="panel ${mobileView ? "mobile-models" : ""}">
    <div class="section-title"><strong>按模型 · By Model</strong><span>${models.length} models</span></div>
    <div class="models">${models.map((m, i) => {
      const share = Math.round((m.totalTokens / total) * 100);
      const width = Math.max(2, (m.totalTokens / max) * 100).toFixed(1);
      return `<article class="model">
        <div class="model-head">
          <div class="model-name"><span class="idx mono">${String(i + 1).padStart(2, "0")}</span><span class="name">${esc(shortModelName(m.name, mobileView))}</span></div>
          <div class="bar"><i style="width:${width}%"></i></div>
          <span class="pct">${share}%</span>
        </div>
        <div class="model-foot mono"><span>${esc(fmtTok(m.totalTokens))} tok</span><span>$${esc(fmtMoney(m.cost))}</span></div>
      </article>`;
    }).join("") || `<div class="muted mono">暂无模型数据</div>`}</div>
  </section>`;
}

function devicesPanel(p, mobileView) {
  const devices = mobileView ? p.mobileDevices : p.desktopDevices;
  const total = Math.max(sumDeviceTokens(devices), 1);
  const circ = 2 * Math.PI * 22;
  return `<section class="panel ${mobileView ? "mobile-devices" : ""}">
    <div class="section-title"><strong>按设备 · By Device</strong><span>${p.devices.length} 台设备</span></div>
    <div class="devices">${devices.map((d) => {
      const ratio = d.totalTokens / total;
      const dash = `${(Math.max(0, Math.min(1, ratio)) * circ).toFixed(2)} ${circ.toFixed(2)}`;
      return `<article class="device">
        <div class="ring">
          <svg viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="22" fill="none" stroke="${p.theme.track}" stroke-width="4.5"></circle>
            <circle cx="26" cy="26" r="22" fill="none" stroke="${p.theme.ink}" stroke-width="4.5" stroke-dasharray="${dash}"></circle>
          </svg>
          <b>${Math.round((d.totalTokens / Math.max(sumDeviceTokens(p.devices), 1)) * 100)}%</b>
        </div>
        <div style="min-width:0;max-width:100%">
          <div class="device-title">${esc(d.name)}</div>
          <div class="device-sub">${esc(d.os)}</div>
          <div class="device-foot">${esc(fmtTok(d.totalTokens))} · $${esc(fmtMoney(d.totalCost))}</div>
        </div>
      </article>`;
    }).join("") || `<div class="muted mono">暂无设备数据</div>`}</div>
  </section>`;
}

function footer(p) {
  return `<footer class="footer"><span>侘寂 · WABI-SABI LEDGER</span><span>${esc(p.range)} · DATA · sqlite</span></footer>`;
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

// Build a predicate over a daily row's date that mirrors selectedRows, but is
// anchored to the GLOBAL latest date (from the combined daily rows) so every
// machine is compared over the identical calendar window.
function periodDateFilter(period, globalDailyRows) {
  const now = globalDailyRows.at(-1)?.period;
  if (!now) return () => false;
  if (period === "today") return (p) => p === now;
  if (period === "week") {
    const days = new Set(globalDailyRows.slice(-7).map((r) => r.period));
    return (p) => days.has(p);
  }
  if (period === "month") {
    const ym = now.slice(0, 7);
    return (p) => String(p).startsWith(ym);
  }
  return () => true; // year/all -> lifetime
}

function loadMachineRows(machines, rowFilter = () => true) {
  const out = {};
  for (const machine of machines) {
    const rows = [];
    for (const agent of agents) {
      const payload = getReport(machine.machine, agent, "daily");
      for (const row of payload?.daily || []) {
        if (rowFilter(row.period || row.date)) rows.push({ ...row, agent });
      }
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

function compressDevices(devices, limit) {
  if (devices.length <= limit) return devices;
  const head = devices.slice(0, limit - 1);
  const tail = devices.slice(limit - 1);
  const totals = tail.reduce((acc, d) => {
    acc.totalTokens += d.totalTokens;
    acc.totalCost += d.totalCost;
    return acc;
  }, { totalTokens: 0, totalCost: 0 });
  return [...head, { machine: "other", name: `其他 ${tail.length} 台`, os: "aggregated", ...totals }];
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

function deltaLabel(current, previous, points) {
  if (!previous) return `${points} 个统计点`;
  return `${current >= previous ? "↑" : "↓"} ${Math.abs((current / previous - 1) * 100).toFixed(1)}% 较上一周期`;
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

function sumDeviceTokens(devices) {
  return devices.reduce((sum, d) => sum + d.totalTokens, 0);
}

function shortModelName(name, mobileView) {
  if (!mobileView) return name;
  return String(name).replace(/^claude-/i, "claude ").replace(/^gpt-/i, "gpt ").replace(/^mimo-/i, "mimo ");
}

function themes() {
  return {
    paper: { bg: "#f4f3ee", ink: "#141414", muted: "rgba(20,20,20,.55)", hair: "rgba(20,20,20,.18)", track: "rgba(20,20,20,.10)", inkRgb: "20,20,20" },
    ink: { bg: "#141414", ink: "#efede7", muted: "rgba(239,237,231,.56)", hair: "rgba(239,237,231,.18)", track: "rgba(239,237,231,.10)", inkRgb: "239,237,231" },
    mist: { bg: "#faf9f6", ink: "#2a2a2a", muted: "rgba(42,42,42,.55)", hair: "rgba(42,42,42,.18)", track: "rgba(42,42,42,.10)", inkRgb: "42,42,42" }
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
