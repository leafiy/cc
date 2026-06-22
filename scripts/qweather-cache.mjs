import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.mjs";
import { getKv, saveKv } from "./sqlite-store.mjs";

const cacheKey = "qweather.current.v1";
const config = loadConfig();
const weatherConfig = config.weather || {};
const cacheTtlMs = Math.max(1, Number(weatherConfig.refreshMinutes || 30)) * 60 * 1000;

export function getCachedWeather() {
  if (!weatherConfig.enabled) return fallbackWeather("weather disabled");
  const stale = readCache();
  if (stale?.data && !stale.data.stale && Date.now() - Date.parse(stale.updatedAt || 0) < cacheTtlMs) return stale.data;

  const fresh = fetchQWeather();
  if (fresh.ok) {
    const payload = { updatedAt: new Date().toISOString(), data: fresh.data };
    saveKv(cacheKey, JSON.stringify(payload));
    return fresh.data;
  }

  if (stale?.data) return { ...stale.data, stale: true, message: fresh.message };
  return fallbackWeather(fresh.message);
}

export function weatherCacheStatus() {
  if (!weatherConfig.enabled) return { cachedAt: null, data: fallbackWeather("weather disabled") };
  const cached = readCache();
  return {
    cachedAt: cached?.updatedAt || null,
    data: cached?.data || fallbackWeather("no cached weather")
  };
}

function readCache() {
  const raw = getKv(cacheKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fetchQWeather() {
  if (!weatherConfig.enabled) return { ok: false, message: "weather disabled" };
  const apiKey = weatherConfig.apiKey || "";
  const apiHost = weatherConfig.apiHost || "";
  const location = weatherConfig.location || "";
  const credentialId = weatherConfig.credentialId || "";

  if (!apiKey) return { ok: false, message: "weather.apiKey missing" };
  if (!apiHost) return { ok: false, message: "weather.apiHost missing" };
  if (!location) return { ok: false, message: "weather.location missing" };

  const base = `https://${apiHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const common = `location=${encodeURIComponent(location)}&lang=zh`;
  const now = requestJson(`${base}/v7/weather/now?${common}`, apiKey);
  if (!now.ok) return now;
  const daily = requestJson(`${base}/v7/weather/3d?${common}`, apiKey);
  if (!daily.ok) return daily;

  if (now.data.code !== "200") return { ok: false, message: `weather now code ${now.data.code}` };
  if (daily.data.code !== "200") return { ok: false, message: `weather daily code ${daily.data.code}` };

  const today = daily.data.daily?.[0] || {};
  const locationName = now.data.refer?.sources?.[0] || "";
  return {
    ok: true,
    data: {
      provider: "QWeather",
      credentialId,
      city: weatherConfig.cityLabel || locationName || location,
      condition: now.data.now?.text || "--",
      temp: suffix(now.data.now?.temp, "°"),
      feelsLike: suffix(now.data.now?.feelsLike, "°"),
      range: range(today.tempMin, today.tempMax),
      humidity: suffix(now.data.now?.humidity, "%"),
      wind: [now.data.now?.windDir, now.data.now?.windScale && `${now.data.now.windScale}级`].filter(Boolean).join(" "),
      obsTime: now.data.now?.obsTime || null,
      updatedAt: new Date().toISOString()
    }
  };
}

function requestJson(url, apiKey) {
  const result = spawnSync("curl", ["-fsS", "--compressed", "-m", "12", "-H", `X-QW-Api-Key: ${apiKey}`, url], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.error) return { ok: false, message: result.error.message };
  if (result.status !== 0) return { ok: false, message: (result.stderr || result.stdout || `curl exit ${result.status}`).trim() };
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, message: `weather JSON parse failed: ${error.message}` };
  }
}

function fallbackWeather(message) {
  return {
    provider: "QWeather",
    city: weatherConfig.cityLabel || weatherConfig.location || "--",
    condition: "--",
    temp: "--",
    feelsLike: "--",
    range: "--",
    humidity: "--",
    wind: "--",
    obsTime: null,
    updatedAt: null,
    stale: true,
    message
  };
}

function suffix(value, unit) {
  return value == null || value === "" ? "--" : `${value}${unit}`;
}

function range(min, max) {
  if (min == null || max == null || min === "" || max === "") return "--";
  return `${min}° - ${max}°`;
}
