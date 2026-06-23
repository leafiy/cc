// Shared front-end services for the Vue dashboards: time-based theming,
// anti-burn-in pixel shift, a resilient SSE live source with reconnect, and a
// few formatting helpers. Kept framework-agnostic (plain ES module).

export const THEMES = {
  paper: { bg: "#f4f3ee", ink: "#141414", muted: "rgba(20,20,20,.55)", hair: "rgba(20,20,20,.18)", track: "rgba(20,20,20,.10)", heat: "20,20,20" },
  ink: { bg: "#141414", ink: "#efede7", muted: "rgba(239,237,231,.56)", hair: "rgba(239,237,231,.18)", track: "rgba(239,237,231,.10)", heat: "239,237,231" },
  mist: { bg: "#faf9f6", ink: "#2a2a2a", muted: "rgba(42,42,42,.55)", hair: "rgba(42,42,42,.18)", track: "rgba(42,42,42,.10)", heat: "42,42,42" }
};

export const THEME_LABEL = { paper: "札记", ink: "墨", mist: "雾" };

// 12:00–20:00 → 札记/质感(paper); 21:00–06:00 → 墨(ink); 其余(06–12, 20–21) → 雾(mist).
export function themeForHour(hour) {
  if (hour >= 12 && hour < 20) return "paper";
  if (hour >= 21 || hour < 6) return "ink";
  return "mist";
}

export function themeForNow(date = new Date()) {
  return themeForHour(date.getHours());
}

export function applyTheme(name) {
  const t = THEMES[name] || THEMES.paper;
  const root = document.documentElement;
  root.dataset.theme = name;
  root.style.setProperty("--bg", t.bg);
  root.style.setProperty("--ink", t.ink);
  root.style.setProperty("--muted", t.muted);
  root.style.setProperty("--hair", t.hair);
  root.style.setProperty("--track", t.track);
  root.style.setProperty("--heat", t.heat);
}

// Theme controller: follows the time-of-day schedule by default, but a manual
// pick (the 质感 tabs) overrides it until the user switches back to auto.
// Re-evaluates every 20s so the scheduled theme flips at hour boundaries
// without a page reload. onChange(name) fires whenever the applied theme moves.
export function createThemeController(onChange) {
  const KEY = "ccui-theme";
  let manual = null;
  try { const saved = sessionStorage.getItem(KEY); if (saved && THEMES[saved]) manual = saved; } catch { /* ignore */ }
  let current = null;

  const apply = () => {
    const next = manual || themeForNow();
    if (next !== current) {
      current = next;
      applyTheme(next);
      if (onChange) onChange(next);
    }
  };
  apply();
  setInterval(() => { if (!manual) apply(); }, 20000);

  return {
    setManual(name) {
      manual = THEMES[name] ? name : null;
      try { manual ? sessionStorage.setItem(KEY, manual) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      apply();
    },
    auto() {
      manual = null;
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      apply();
    },
    get current() { return current; },
    get isManual() { return manual !== null; }
  };
}

// Anti burn-in: nudge the whole canvas by a few pixels on a slow cycle. The page
// stylesheet must apply translate(var(--shift-x), var(--shift-y)) to its root.
export function startPixelShift({ intervalMs = 60000, max = 6 } = {}) {
  const offsets = [
    [0, 0], [max, 0], [max, max], [0, max],
    [-max, max], [-max, 0], [-max, -max], [0, -max], [max, -max]
  ];
  let i = 0;
  const root = document.documentElement;
  const apply = () => {
    const [x, y] = offsets[i % offsets.length];
    root.style.setProperty("--shift-x", x + "px");
    root.style.setProperty("--shift-y", y + "px");
    i += 1;
  };
  apply();
  const id = setInterval(apply, intervalMs);
  return () => clearInterval(id);
}

// Live data signal over SSE. Calls onUpdate() on connect and whenever the
// backend reports the SQLite changed. Reconnects automatically, and a watchdog
// force-reopens a silently-dead connection. onStatus(state) where state is
// "live" | "reconnecting".
export function createLiveSource({ onUpdate, onStatus } = {}) {
  let es = null;
  let lastBeat = Date.now();
  let closed = false;

  const status = (s) => { if (onStatus) onStatus(s); };

  const open = () => {
    if (closed) return;
    try { es?.close(); } catch { /* ignore */ }
    es = new EventSource("/api/events");
    es.addEventListener("hello", () => { lastBeat = Date.now(); status("live"); onUpdate?.(); });
    es.addEventListener("update", () => { lastBeat = Date.now(); status("live"); onUpdate?.(); });
    es.addEventListener("ping", () => { lastBeat = Date.now(); status("live"); });
    es.onopen = () => { lastBeat = Date.now(); status("live"); };
    es.onerror = () => { status("reconnecting"); };
  };

  open();

  // Watchdog: the server pings every 15s; if we hear nothing for 45s the link is
  // dead (half-open TCP, sleep/wake, network drop) — tear it down and reopen.
  const watchdog = setInterval(() => {
    if (closed) return;
    if (Date.now() - lastBeat > 45000) {
      status("reconnecting");
      open();
    }
  }, 10000);

  // Re-check immediately when the display device wakes or regains focus.
  const wake = () => { if (!closed && (es?.readyState !== 1)) open(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);

  return {
    close() { closed = true; clearInterval(watchdog); try { es?.close(); } catch { /* ignore */ } }
  };
}

// ---- formatting (mirrors the server-side renderers) ----------------------
export function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

export function fmtTok(value) {
  const n = num(value);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney(value) {
  const n = num(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

export function shortModelName(name) {
  return String(name).replace(/^claude-/i, "claude ").replace(/^gpt-/i, "gpt ").replace(/^mimo-/i, "mimo ");
}

export function pad(n) { return String(n).padStart(2, "0"); }

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const LUNAR = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

export function solarDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${WEEK[d.getDay()]}`;
}

export function lunarDate(d) {
  try {
    const raw = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" }).format(d);
    return "农历" + raw.replace(/(\d+)日/, (_, day) => LUNAR[Number(day)] || day + "日");
  } catch {
    return "农历 --";
  }
}

// Read ?period= from the URL, falling back to a default.
export function readPeriod(fallback) {
  const p = new URL(location.href).searchParams.get("period");
  return ["today", "week", "month", "year"].includes(p) ? p : fallback;
}

export function writePeriod(period) {
  const url = new URL(location.href);
  url.searchParams.set("period", period);
  history.replaceState(null, "", url);
}

export async function fetchView(kind, period) {
  const res = await fetch(`/api/view/${kind}?period=${encodeURIComponent(period)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("view " + res.status);
  return res.json();
}
