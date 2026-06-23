import { getCombined, getReport } from "./sqlite-store.mjs";
import { getCachedWeather } from "./qweather-cache.mjs";
import { loadConfig, normalizeReports } from "./config.mjs";

const config = loadConfig();
const agents = normalizeReports(config).map((report) => report.name);
const periods = [["today", "今天"], ["week", "本周"], ["month", "本月"], ["year", "全年"]];
const variants = [["paper", "札记"], ["ink", "墨"], ["mist", "雾"]];
const nameMap = config.displayNames || {};

export function renderClockDashboardHtml({ period = "week", theme = "paper" } = {}) {
  const p = buildPayload(period, theme);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="1800">
  <title>Token Usage Clock</title>
  <style>${styles(p)}</style>
</head>
<body>
  <main class="page">
    <header>
      <h1 class="fullscreen-trigger">Token 用量统计</h1>
      <div class="stamp mono">${esc(p.range)}<br>UPDATED · ${esc(p.updated)}</div>
    </header>
    <nav class="controls">
      <div class="seg">${periodLinks(p)}</div>
      <div class="tone"><span class="mono">质感</span><div class="seg">${themeLinks(p)}</div></div>
    </nav>
    <section class="hero">
      <div class="hero-cell primary">
        <div class="eyebrow">总 Token 消耗</div>
        <div class="big">${esc(fmtTok(p.totals.totalTokens))}</div>
        <div class="sub mono">${esc(p.delta)}</div>
      </div>
      <div class="hero-cell">
        <div class="eyebrow">花费估算</div>
        <div class="mid">$${esc(fmtMoney(p.totals.totalCost))}</div>
        <div class="sub mono">USD · ccusage 混合定价估算</div>
      </div>
      <div class="hero-cell">
        <div class="eyebrow">日均 Token</div>
        <div class="mid">${esc(p.dailyAvg)}</div>
        <div class="sub mono">${esc(p.activeDays)}</div>
      </div>
    </section>
    <section class="clock">
      <div class="clock-top">
        <div id="weekday" class="weekday">${esc(p.solarDate)}</div>
        <div class="weather">
          <div class="weather-main">
            ${weatherIcon(p.weather.condition)}
            <div class="weather-now">${esc(p.weather.condition)} ${esc(p.weather.temp)}</div>
          </div>
          <div class="weather-sub mono">${esc(p.weather.range)} · ${esc(p.weather.city)}</div>
        </div>
      </div>
      <div class="time" aria-label="当前时间">
        <span id="hh">${esc(p.hh)}</span><span id="colon" class="colon">:</span><span id="mm">${esc(p.mm)}</span><span id="ss" class="sec mono">${esc(p.ss)}</span>
      </div>
      <div class="clock-foot mono"><span id="date">${esc(p.lunarDate)}</span><span>24-HOUR · CST</span></div>
    </section>
    <section class="models">
      <div class="section-title mono"><strong>按模型 · By Model</strong><span>SHARE · TOKENS · COST</span></div>
      <div class="model-list">
        ${p.models.map((m, i) => `<article class="model">
          <div class="model-name"><span class="idx mono">${String(i + 1).padStart(2, "0")}</span><strong>${esc(shortModelName(m.name))}</strong></div>
          <div class="bar"><i style="width:${Math.max(2, m.width).toFixed(1)}%"></i></div>
          <span class="tok mono">${esc(fmtTok(m.totalTokens))} tok</span>
          <span class="cost mono">$${esc(fmtMoney(m.cost))}</span>
          <span class="pct mono">${Math.round(m.share)}%</span>
        </article>`).join("") || `<div class="empty mono">暂无模型数据</div>`}
      </div>
      <div class="section-title device-title mono"><strong>按设备 · By Device</strong><span>${p.devices.length} DEVICES</span></div>
      <div class="device-list">
        ${p.devices.map((d) => `<article class="device">
          <div class="ring">
            <svg viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="22" fill="none" stroke="${p.theme.track}" stroke-width="4.5"></circle>
              <circle cx="26" cy="26" r="22" fill="none" stroke="${p.theme.ink}" stroke-width="4.5" stroke-dasharray="${esc(d.dash)}"></circle>
            </svg>
            <b>${Math.round(d.share)}%</b>
          </div>
          <div class="device-copy">
            <strong>${esc(d.name)}</strong>
            <span class="mono">${esc(fmtTok(d.totalTokens))} tok · $${esc(fmtMoney(d.totalCost))}</span>
          </div>
        </article>`).join("") || `<div class="empty mono">暂无设备数据</div>`}
      </div>
    </section>
    <footer class="mono"><span>侘寂 · WABI-SABI LEDGER</span><span>${esc(p.range)}</span></footer>
  </main>
  <script>
    document.addEventListener("dblclick", async (event) => {
      if (!event.target.closest(".fullscreen-trigger")) return;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } catch {}
    });
    const dayNames = ["周日","周一","周二","周三","周四","周五","周六"];
    const lunarDays = ["","初一","初二","初三","初四","初五","初六","初七","初八","初九","初十","十一","十二","十三","十四","十五","十六","十七","十八","十九","二十","廿一","廿二","廿三","廿四","廿五","廿六","廿七","廿八","廿九","三十"];
    function pad(n){ return String(n).padStart(2, "0"); }
    function solarDate(d){ return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日" + dayNames[d.getDay()]; }
    function lunarDate(d){
      try {
        const raw = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(d);
        return "农历" + raw.replace(/(\\d+)日/, (_, day) => lunarDays[Number(day)] || (day + "日"));
      } catch {
        return "农历 --";
      }
    }
    function tick(){
      const d = new Date();
      document.getElementById("hh").textContent = pad(d.getHours());
      document.getElementById("mm").textContent = pad(d.getMinutes());
      document.getElementById("ss").textContent = pad(d.getSeconds());
      document.getElementById("colon").textContent = ":";
      document.getElementById("weekday").textContent = solarDate(d);
      document.getElementById("date").textContent = lunarDate(d);
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`;
}

function buildPayload(periodName, themeName) {
  const daily = getCombined("daily") || { daily: [], generatedAt: null };
  const monthly = getCombined("monthly") || { monthly: [], generatedAt: null };
  const period = periods.some(([key]) => key === periodName) ? periodName : "week";
  const theme = themes()[themeName] || themes().paper;
  const rows = selectedRows(period, daily.daily || [], monthly.monthly || []);
  const prev = comparisonRows(period, daily.daily || []);
  const totals = sumRows(rows);
  const prevTotals = sumRows(prev);
  const activeDays = activeDayCount(rows);
  const models = buildModels(rows, totals);
  const maxModel = Math.max(...models.map((m) => m.totalTokens), 1);
  const devices = buildDevicesForPeriod(period, getCombined("machines")?.machines || [], daily.daily || [], monthly.monthly || []);
  const maxDevice = Math.max(...devices.map((d) => d.totalTokens), 1);
  const now = new Date();

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
    models: models.map((m) => ({ ...m, share: totals.totalTokens ? (m.totalTokens / totals.totalTokens) * 100 : 0, width: (m.totalTokens / maxModel) * 100 })),
    devices: devices.map((d) => {
      const share = totals.totalTokens ? (d.totalTokens / totals.totalTokens) * 100 : 0;
      const circ = 2 * Math.PI * 22;
      return { ...d, share, width: (d.totalTokens / maxDevice) * 100, dash: `${(Math.min(100, Math.max(0, share)) / 100 * circ).toFixed(2)} ${circ.toFixed(2)}` };
    }),
    weather: getCachedWeather(),
    solarDate: formatSolarDate(now),
    lunarDate: formatLunarDate(now),
    hh: pad(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds())
  };
}

function styles(p) {
  const { bg, ink, muted, hair, track } = p.theme;
  return `
    *{box-sizing:border-box}
    html,body{margin:0;width:100%;min-height:100%;background:${bg};color:${ink};overflow:hidden}
    body{font-family:"Archivo",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    .mono{font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
    .page{width:100vw;height:100svh;display:flex;flex-direction:column;gap:clamp(8px,1.2vh,16px);padding:clamp(16px,2vh,34px) clamp(20px,2.6vw,64px)}
    header{flex:none;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid ${ink};padding-bottom:clamp(8px,1.1vh,16px);gap:18px}
    h1{margin:0;font-size:clamp(20px,2.1vw,42px);font-weight:600;letter-spacing:-.02em;line-height:.98;white-space:nowrap}
    .stamp{text-align:right;font-size:clamp(9px,.72vw,12px);line-height:1.7;color:${muted};letter-spacing:.04em}
    .controls{flex:none;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}
    .seg{display:flex;border:1.5px solid ${ink};width:max-content}
    .seg a{display:block;border-left:1.5px solid ${ink};font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(10px,.82vw,12px);letter-spacing:.12em;text-transform:uppercase;padding:clamp(8px,1.15vh,11px) clamp(14px,1.65vw,20px)}
    .seg a:first-child{border-left:0}
    .seg a.active{background:${ink};color:${bg}}
    .tone{display:flex;align-items:center;gap:12px}
    .tone>span{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${muted}}
    .hero{flex:none;display:grid;grid-template-columns:1.5fr 1fr 1fr;border:1.5px solid ${ink}}
    .hero-cell{min-width:0;padding:clamp(10px,1.35vh,18px) clamp(14px,1.8vw,34px);border-left:1.5px solid ${ink}}
    .hero-cell:first-child{border-left:0}
    .eyebrow{font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(9px,.72vw,11px);letter-spacing:.22em;text-transform:uppercase;color:${muted};white-space:nowrap}
    .big{margin-top:clamp(6px,.9vh,12px);font-size:clamp(28px,3.2vw,58px);font-weight:600;letter-spacing:-.03em;line-height:.9;font-variant-numeric:tabular-nums;white-space:nowrap}
    .mid{margin-top:clamp(8px,1.1vh,14px);font-size:clamp(22px,2.3vw,42px);font-weight:600;letter-spacing:-.02em;line-height:.95;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sub{margin-top:clamp(5px,.7vh,10px);font-size:clamp(10px,.78vw,12px);color:${muted};white-space:nowrap}
    .clock{flex:.95;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border:1.5px solid ${ink};padding:clamp(10px,1.35vh,18px) clamp(18px,2.4vw,44px)}
    .clock-top,.clock-foot{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:18px}
    .weekday{font-size:clamp(16px,1.8vw,34px);font-weight:600;letter-spacing:-.01em}
    .weather{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;text-align:right}
    .weather-main{display:flex;align-items:center;justify-content:flex-end;gap:clamp(8px,.75vw,12px);min-width:0}
    .weather svg{width:clamp(18px,1.7vw,30px);height:clamp(18px,1.7vw,30px);flex:none}
    .weather-now{font-size:clamp(15px,1.5vw,26px);font-weight:600;white-space:nowrap}
    .weather-sub{font-size:clamp(9px,.72vw,12px);color:${muted};margin-top:2px;white-space:nowrap}
    .time{min-height:0;display:flex;align-items:center;justify-content:center;font-weight:600;letter-spacing:-.03em;line-height:.8;font-variant-numeric:tabular-nums}
    .time>span:not(.sec){font-size:clamp(56px,8.5vw,150px)}
    .colon{opacity:.5;margin:0 clamp(2px,.4vw,8px)}
    .sec{font-size:clamp(16px,2.2vw,40px);opacity:.55;margin-left:clamp(8px,1vw,18px);line-height:1}
    .clock-foot{font-size:clamp(10px,.85vw,14px);color:${muted};letter-spacing:.08em}
    .models{flex:none;min-height:0;display:flex;flex-direction:column}
    .section-title{flex:none;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid ${ink};padding-bottom:clamp(7px,1vh,12px);font-size:clamp(9px,.72vw,11px);letter-spacing:.22em;text-transform:uppercase}
    .section-title span{color:${muted};letter-spacing:.1em}
    .model-list{flex:none;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:clamp(9px,1.15vh,15px);padding:clamp(7px,.95vh,12px) 0}
    .model{display:grid;grid-template-columns:minmax(130px,180px) minmax(120px,1fr) minmax(74px,96px) minmax(54px,72px) minmax(40px,52px);align-items:center;gap:clamp(12px,1.4vw,26px)}
    .model-name{min-width:0;display:flex;align-items:baseline;gap:12px}
    .idx,.tok,.cost{color:${muted};font-size:clamp(9px,.72vw,12px)}
    .model-name strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(15px,1.25vw,20px);font-weight:600;letter-spacing:-.01em}
    .bar{height:clamp(7px,.86vh,11px);background:${track};position:relative}
    .bar i{position:absolute;inset:0 auto 0 0;background:${ink}}
    .tok,.cost,.pct{text-align:right;white-space:nowrap}
    .pct{font-size:clamp(13px,1.1vw,16px);font-weight:700}
    .device-title{margin-top:clamp(2px,.35vh,6px)}
    .device-list{flex:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(7px,.9vh,12px) clamp(12px,1.4vw,22px);padding:clamp(6px,.8vh,10px) 0 0}
    .device{min-width:0;display:flex;align-items:center;gap:clamp(8px,.9vw,13px)}
    .ring{position:relative;width:clamp(34px,3vw,48px);height:clamp(34px,3vw,48px);flex:none}
    .ring svg{width:100%;height:100%;transform:rotate(-90deg)}
    .ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Space Mono",ui-monospace,monospace;font-size:clamp(8px,.7vw,10px);font-weight:700}
    .device-copy{min-width:0;display:flex;flex-direction:column;gap:2px}
    .device strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(12px,1vw,15px);font-weight:600}
    .device-copy span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${muted};font-size:clamp(8px,.62vw,10px)}
    footer{flex:none;padding-top:clamp(8px,1vh,14px);border-top:1.5px solid ${ink};display:flex;justify-content:space-between;font-size:clamp(9px,.7vw,11px);letter-spacing:.1em;color:${muted}}
    @media (max-width:760px){
      html,body{overflow:auto}
      .page{height:auto;min-height:100svh;padding:14px;gap:8px;overflow:visible}
      h1{font-size:19px}
      .stamp{font-size:9px}
      .controls{display:none}
      .hero{grid-template-columns:repeat(3,minmax(0,1fr))}
      .hero-cell{padding:9px 10px}
      .eyebrow{font-size:8px;letter-spacing:.12em}
      .big,.mid{font-size:20px;margin-top:5px}
      .sub{display:none}
      .clock{flex:none;min-height:34svh;padding:10px 12px}
      .weekday{font-size:18px}
      .weather-now{font-size:14px}
      .weather-sub{font-size:9px;max-width:45vw;overflow:hidden;text-overflow:ellipsis}
      .time>span:not(.sec){font-size:clamp(52px,18vw,88px)}
      .sec{font-size:20px}
      .models{flex:none}
      .section-title{font-size:9px;letter-spacing:.16em}
      .section-title span{display:none}
      .model-list{gap:9px;padding:8px 0}
      .model{grid-template-columns:minmax(95px,1fr) minmax(80px,1fr) 54px 44px;gap:8px}
      .model .cost{display:none}
      .model-name strong{font-size:12px}
      .idx{display:none}
      .bar{height:7px}
      .tok{font-size:8px}
      .device-title{margin-top:8px}
      .device-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px;padding-top:7px}
      .device{gap:6px}
      .device strong{font-size:11px}
      .ring{width:34px;height:34px}
      .ring b{font-size:8px}
      .device-copy span{font-size:7px}
      footer{display:none}
    }
    @media (orientation:landscape) and (max-height:760px){
      html,body{overflow:hidden}
      .page{height:100svh;gap:6px;padding:12px 24px}
      header{padding-bottom:6px}
      h1{font-size:clamp(22px,2.3vw,32px)}
      .stamp{font-size:10px;line-height:1.45}
      .controls{gap:10px}
      .seg a{font-size:10px;padding:7px 14px}
      .hero-cell{padding:8px 22px}
      .big{font-size:clamp(30px,4vw,48px);margin-top:6px}
      .mid{font-size:clamp(26px,3.4vw,42px);margin-top:6px}
      .sub{font-size:10px;margin-top:4px}
      .clock{flex:none;height:clamp(116px,20svh,150px);overflow:hidden;padding:8px 28px}
      .clock-top,.clock-foot{align-items:center}
      .weekday{font-size:clamp(18px,2vw,28px)}
      .weather-now{font-size:clamp(16px,1.8vw,24px)}
      .weather-sub{font-size:10px}
      .time{overflow:hidden}
      .time>span:not(.sec){font-size:clamp(58px,8.2svh,84px)}
      .sec{font-size:clamp(16px,2.2svh,22px)}
      .clock-foot{font-size:10px}
      .section-title{font-size:10px;padding-bottom:5px}
      .model-list{gap:6px;padding:6px 0}
      .model{gap:14px;grid-template-columns:minmax(150px,220px) minmax(120px,1fr) minmax(72px,96px) minmax(50px,70px) minmax(36px,48px)}
      .model-name strong{font-size:clamp(14px,1.35vw,18px)}
      .bar{height:7px}
      .idx,.tok,.cost{font-size:10px}
      .pct{font-size:14px}
      .device-title{margin-top:4px}
      .device-list{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 14px;padding-top:5px}
      .ring{width:34px;height:34px}
      .device strong{font-size:12px}
      .device-copy span{font-size:8px}
      footer{display:none}
    }
  `;
}

function periodLinks(p) {
  return periods.map(([key, label]) => `<a class="${key === p.period ? "active" : ""}" href="/clock?period=${key}&theme=${p.themeName}">${label}</a>`).join("");
}

function themeLinks(p) {
  return variants.map(([key, label]) => `<a class="${key === p.themeName ? "active" : ""}" href="/clock?period=${p.period}&theme=${key}">${label}</a>`).join("");
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
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name)).slice(0, 6);
}

function buildDevicesForPeriod(period, machines, dailyRows, monthlyRows) {
  const out = [];
  for (const machine of machines) {
    const rows = [];
    for (const agent of agents) {
      const payload = getReport(machine.machine, agent, "daily");
      for (const row of payload?.daily || []) rows.push({ ...row, period: row.period || row.date });
    }
    rows.sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const selected = period === "year" ? rows : selectedRows(period, rows, monthlyRows);
    const totals = sumRows(selected);
    out.push({ machine: machine.machine, name: nodeName(machine.machine), ...totals });
  }
  return out.sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
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
  return `${pad(d.getMonth() + 1)} / ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nodeName(id) {
  return nameMap[id] || id;
}

function formatSolarDate(d) {
  const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${dayNames[d.getDay()]}`;
}

function formatLunarDate(d) {
  const lunarDays = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
  try {
    const raw = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(d);
    return `农历${raw.replace(/(\d+)日/, (_, day) => lunarDays[Number(day)] || `${day}日`)}`;
  } catch {
    return "农历 --";
  }
}

function shortModelName(name) {
  return String(name).replace(/^claude-/i, "claude ").replace(/^gpt-/i, "gpt ").replace(/^mimo-/i, "mimo ");
}

function weatherIcon(condition) {
  const c = String(condition || "");
  if (/雨|雷|阵雨/.test(c)) {
    return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M13 26h19a8 8 0 0 0 0-16 12 12 0 0 0-22 5 6 6 0 0 0 3 11Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 32l-2 5M24 32l-2 5M33 32l-2 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  if (/阴|云|雾/.test(c)) {
    return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M13 30h19a8 8 0 0 0 0-16 12 12 0 0 0-22 5 6 6 0 0 0 3 11Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  }
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M22 5v5M22 34v5M5 22h5M34 22h5M10 10l4 4M30 30l4 4M34 10l-4 4M14 30l-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function themes() {
  return {
    paper: { bg: "#f4f3ee", ink: "#141414", muted: "rgba(20,20,20,.55)", hair: "rgba(20,20,20,.18)", track: "rgba(20,20,20,.10)" },
    ink: { bg: "#141414", ink: "#efede7", muted: "rgba(239,237,231,.56)", hair: "rgba(239,237,231,.18)", track: "rgba(239,237,231,.10)" },
    mist: { bg: "#faf9f6", ink: "#2a2a2a", muted: "rgba(42,42,42,.55)", hair: "rgba(42,42,42,.18)", track: "rgba(42,42,42,.10)" }
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
