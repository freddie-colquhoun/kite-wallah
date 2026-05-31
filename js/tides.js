/**
 * @typedef {Object} TidePrediction
 * @property {string} time ISO
 * @property {number} height metres
 * @property {string} type 'H'|'L'|''
 */

/**
 * @typedef {Object} TideSummary
 * @property {string} source
 * @property {TidePrediction[]} predictions
 * @property {string} summary
 * @property {'good'|'marginal'|'bad'|'unknown'} status
 * @property {number|null} currentHeight
 */

import { formatNum } from "./format.js";

let noaaStationsCache = null;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "GMT";
  } catch {
    return "GMT";
  }
}

async function loadNoaaStations() {
  if (noaaStationsCache) return noaaStationsCache;
  const res = await fetch(
    "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"
  );
  if (!res.ok) throw new Error("Could not load NOAA tide stations");
  const data = await res.json();
  noaaStationsCache = data.stations || [];
  return noaaStationsCache;
}

/** @param {number} lat @param {number} lon */
export async function findNearestNoaaStation(lat, lon) {
  const stations = await loadNoaaStations();
  let best = null;
  let bestDist = Infinity;
  for (const s of stations) {
    if (s.lat == null || s.lng == null) continue;
    const d = haversineKm(lat, lon, s.lat, s.lng);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best || bestDist > 150) return null;
  return { id: String(best.id), name: best.name, distanceKm: Math.round(bestDist) };
}

function formatNoaaDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** @param {string} stationId */
async function fetchNoaaTides(stationId) {
  const begin = formatNoaaDate(new Date());
  const url = new URL("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter");
  url.searchParams.set("begin_date", begin);
  url.searchParams.set("range", "48");
  url.searchParams.set("station", stationId);
  url.searchParams.set("product", "predictions");
  url.searchParams.set("datum", "MLLW");
  url.searchParams.set("time_zone", "gmt");
  url.searchParams.set("units", "metric");
  url.searchParams.set("interval", "h");
  url.searchParams.set("format", "json");

  const res = await fetch(url);
  if (!res.ok) throw new Error("NOAA tide fetch failed");
  const data = await res.json();
  /** @type {TidePrediction[]} */
  return (data.predictions || []).map((p) => ({
    time: p.t,
    height: Number(p.v),
    type: p.type || "",
  }));
}

/**
 * Hourly tide heights for planning (Open-Meteo Marine).
 * @param {number} lat @param {number} lon @param {number} [forecastDays]
 */
export async function fetchHourlyTideForecast(lat, lon, forecastDays = 7) {
  const preciseLat = Math.round(lat * 1e5) / 1e5;
  const preciseLon = Math.round(lon * 1e5) / 1e5;
  const tz = browserTimezone();
  const days = Math.min(8, Math.max(1, forecastDays));

  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", String(preciseLat));
  url.searchParams.set("longitude", String(preciseLon));
  url.searchParams.set("hourly", "sea_level_height_msl");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", tz);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo tide fetch failed (${res.status})`);

  const data = await res.json();
  const times = data.hourly?.time || [];
  const heights = data.hourly?.sea_level_height_msl || [];

  /** @type {TidePrediction[]} */
  const hourly = [];
  for (let i = 0; i < times.length; i++) {
    const h = heights[i];
    if (h == null) continue;
    hourly.push({ time: times[i], height: h, type: "" });
  }

  return { hourly, source: "Open-Meteo Marine" };
}

async function fetchOpenMeteoTides(lat, lon) {
  const { hourly } = await fetchHourlyTideForecast(lat, lon, 3);
  if (!hourly.length) throw new Error("No tide data from Open-Meteo for this location");
  const extrema = extractTideExtrema(hourly);
  return { hourly, extrema };
}

/** @param {TidePrediction[]} hourly */
function extractTideExtrema(hourly) {
  /** @type {TidePrediction[]} */
  const extrema = [];
  for (let i = 1; i < hourly.length - 1; i++) {
    const prev = hourly[i - 1].height;
    const cur = hourly[i].height;
    const next = hourly[i + 1].height;
    if (cur >= prev && cur >= next) {
      extrema.push({ ...hourly[i], type: "H" });
    } else if (cur <= prev && cur <= next) {
      extrema.push({ ...hourly[i], type: "L" });
    }
  }
  return extrema;
}

function formatLocalTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", weekday: "short" });
}

/** @param {TidePrediction[]} extrema @param {TidePrediction[]} hourly */
function buildOpenMeteoSummary(extrema, hourly) {
  const now = Date.now();
  const upcoming = extrema.filter((e) => new Date(e.time).getTime() > now).slice(0, 4);
  const parts = upcoming.map((e) => {
    const label = e.type === "H" ? "High" : e.type === "L" ? "Low" : "Tide";
    return `${label} ${formatLocalTime(e.time)} (${formatNum(e.height, 1)} m)`;
  });
  const base = parts.length ? `Next: ${parts.join(" · ")}.` : "Tide times from hourly model.";
  return `${base} Relative heights (not chart datum).`;
}

function assessTidePreference(preference, predictions, extraSummary = "") {
  if (!predictions.length || preference === "any") {
    return {
      status: /** @type {'unknown'} */ ("unknown"),
      summary: extraSummary || "Tide preference not checked.",
    };
  }

  const now = Date.now();
  const heights = predictions.map((p) => ({ ...p, ts: new Date(p.time).getTime() }));
  const nearest = heights.reduce((a, b) =>
    Math.abs(a.ts - now) < Math.abs(b.ts - now) ? a : b
  );

  const sorted = [...heights].sort((a, b) => a.height - b.height);
  const minH = sorted[0].height;
  const maxH = sorted[sorted.length - 1].height;
  const range = maxH - minH || 1;
  const relative = (nearest.height - minH) / range;

  let status = "good";
  let summary = `Tide ~${formatNum(nearest.height, 1)} m (${Math.round(relative * 100)}% of range in forecast).`;

  if (preference === "mid") {
    if (relative < 0.25 || relative > 0.75) {
      status = "marginal";
      summary += " Mid-tide preferred  ·  currently toward an extreme.";
    } else {
      summary += " Mid-tide window looks OK.";
    }
  } else if (preference === "high") {
    if (relative < 0.6) {
      status = "marginal";
      summary += " High tide preferred  ·  water may be low.";
    }
  } else if (preference === "low") {
    if (relative > 0.4) {
      status = "marginal";
      summary += " Low tide preferred  ·  water may be high.";
    }
  }

  if (extraSummary) summary += ` ${extraSummary}`;

  return { status, summary, currentHeight: nearest.height };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{ noaaStationId?: string|null, tidePreference?: string }} opts
 * @returns {Promise<TideSummary>}
 */
export async function fetchTides(lat, lon, opts = {}) {
  /** @type {TidePrediction[]} */
  let predictions = [];
  let source = "";
  let extraSummary = "";

  // 1. US: NOAA station predictions (official high/low times)
  let stationId = opts.noaaStationId;
  if (!stationId) {
    const nearest = await findNearestNoaaStation(lat, lon);
    if (nearest) stationId = nearest.id;
  }
  if (stationId) {
    try {
      predictions = await fetchNoaaTides(stationId);
      source = `NOAA (${stationId})`;
    } catch {
      predictions = [];
    }
  }

  // 2. Global: Open-Meteo Marine (free, no key)
  if (!predictions.length) {
    try {
      const { hourly, extrema } = await fetchOpenMeteoTides(lat, lon);
      predictions = hourly;
      source = "Open-Meteo Marine (global)";
      extraSummary = buildOpenMeteoSummary(extrema, hourly);
    } catch (e) {
      return {
        source: "none",
        predictions: [],
        summary: e.message || "Could not load tide data. Check your connection and try again.",
        status: "unknown",
        currentHeight: null,
      };
    }
  }

  const { status, summary, currentHeight } = assessTidePreference(
    opts.tidePreference || "any",
    predictions,
    extraSummary
  );

  return { source, predictions, summary, status, currentHeight };
}
