/** Convert Open-Meteo degrees to 8-point compass */
export function degreesToCompass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function isUK(lat, lon) {
  return lat >= 49.5 && lat <= 61 && lon >= -8.5 && lon <= 2.5;
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "GMT";
  } catch {
    return "GMT";
  }
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ windSpeed: number, gustSpeed: number|null, windDirection: string, source: string, fetchedAt: string, lat: number, lon: number, modelNote: string }>}
 */
export async function fetchLiveWind(lat, lon) {
  const preciseLat = Math.round(lat * 1e6) / 1e6;
  const preciseLon = Math.round(lon * 1e6) / 1e6;
  const uk = isUK(preciseLat, preciseLon);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(preciseLat));
  url.searchParams.set("longitude", String(preciseLon));
  url.searchParams.set("current", "wind_speed_10m,wind_gusts_10m,wind_direction_10m");
  url.searchParams.set("wind_speed_unit", "kn");
  if (uk) url.searchParams.set("models", "ukmo_seamless");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wind fetch failed (${res.status})`);

  const data = await res.json();
  const c = data.current;
  if (!c) throw new Error("No current wind data for this location");

  return {
    windSpeed: Math.round(c.wind_speed_10m),
    gustSpeed: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : null,
    windDirection: degreesToCompass(c.wind_direction_10m),
    source: uk ? "Open-Meteo / UK Met Office (~2 km)" : "Open-Meteo (~11 km model)",
    fetchedAt: c.time || new Date().toISOString(),
    lat: preciseLat,
    lon: preciseLon,
    modelNote: uk
      ? "Pin is exact; wind is from the UKMO grid cell nearest your coordinates (~2 km)."
      : "Pin is exact; wind is from the nearest global model grid cell (~11 km).",
  };
}

/**
 * Hourly wind forecast for session planning.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [forecastDays] 1-7
 * @returns {Promise<{ hourly: import('./planner.js').ForecastHour[], source: string, timezone: string }>}
 */
export async function fetchWindForecast(lat, lon, forecastDays = 7) {
  const preciseLat = Math.round(lat * 1e6) / 1e6;
  const preciseLon = Math.round(lon * 1e6) / 1e6;
  const uk = isUK(preciseLat, preciseLon);
  const tz = browserTimezone();
  const days = Math.min(7, Math.max(1, forecastDays));

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(preciseLat));
  url.searchParams.set("longitude", String(preciseLon));
  url.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m,wind_direction_10m");
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", tz);
  if (uk) url.searchParams.set("models", "ukmo_seamless");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Forecast fetch failed (${res.status})`);

  const data = await res.json();
  const times = data.hourly?.time || [];
  const speeds = data.hourly?.wind_speed_10m || [];
  const gusts = data.hourly?.wind_gusts_10m || [];
  const dirs = data.hourly?.wind_direction_10m || [];

  /** @type {import('./planner.js').ForecastHour[]} */
  const hourly = [];
  for (let i = 0; i < times.length; i++) {
    if (speeds[i] == null) continue;
    hourly.push({
      time: times[i],
      windSpeed: Math.round(speeds[i]),
      gustSpeed: gusts[i] != null ? Math.round(gusts[i]) : null,
      windDirection: degreesToCompass(dirs[i] ?? 0),
      windDirectionDeg: dirs[i] ?? 0,
    });
  }

  if (!hourly.length) throw new Error("No forecast data for this location");

  return {
    hourly,
    source: uk ? "Open-Meteo forecast / UK Met Office" : "Open-Meteo forecast (global)",
    timezone: tz,
  };
}

/**
 * @typedef {Object} WindHourSnapshot
 * @property {string} time ISO hour
 * @property {number} windSpeed kt
 * @property {number|null} gustSpeed kt
 * @property {string} windDirection
 * @property {number} [windDirectionDeg]
 * @property {boolean} [isNow]
 */

/**
 * Live wind plus the next N hourly steps (for Now tab).
 * @param {number} lat
 * @param {number} lon
 * @param {number} [outlookHours] hours after the current slot (default 4)
 */
export async function fetchNowWindOutlook(lat, lon, outlookHours = 4) {
  const preciseLat = Math.round(lat * 1e6) / 1e6;
  const preciseLon = Math.round(lon * 1e6) / 1e6;
  const uk = isUK(preciseLat, preciseLon);
  const tz = browserTimezone();
  const hours = Math.min(12, Math.max(1, outlookHours));

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(preciseLat));
  url.searchParams.set("longitude", String(preciseLon));
  url.searchParams.set("current", "wind_speed_10m,wind_gusts_10m,wind_direction_10m");
  url.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m,wind_direction_10m");
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("timezone", tz);
  url.searchParams.set("forecast_hours", String(hours + 2));
  if (uk) url.searchParams.set("models", "ukmo_seamless");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wind fetch failed (${res.status})`);

  const data = await res.json();
  const c = data.current;
  if (!c) throw new Error("No current wind data for this location");

  const current = {
    windSpeed: Math.round(c.wind_speed_10m),
    gustSpeed: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : null,
    windDirection: degreesToCompass(c.wind_direction_10m),
    windDirectionDeg: c.wind_direction_10m,
    fetchedAt: c.time || new Date().toISOString(),
  };

  const times = data.hourly?.time || [];
  const speeds = data.hourly?.wind_speed_10m || [];
  const gusts = data.hourly?.wind_gusts_10m || [];
  const dirs = data.hourly?.wind_direction_10m || [];
  const nowMs = Date.now();

  /** @type {WindHourSnapshot[]} */
  const outlook = [];
  for (let i = 0; i < times.length; i++) {
    if (speeds[i] == null) continue;
    const t = new Date(times[i]).getTime();
    if (t <= nowMs - 5 * 60 * 1000) continue;
    outlook.push({
      time: times[i],
      windSpeed: Math.round(speeds[i]),
      gustSpeed: gusts[i] != null ? Math.round(gusts[i]) : null,
      windDirection: degreesToCompass(dirs[i] ?? 0),
      windDirectionDeg: dirs[i] ?? 0,
    });
    if (outlook.length >= hours) break;
  }

  return {
    current,
    outlook,
    source: uk ? "Open-Meteo / UK Met Office (~2 km)" : "Open-Meteo (~11 km model)",
    timezone: tz,
    lat: preciseLat,
    lon: preciseLon,
  };
}

/**
 * Sunrise/sunset per day for daylight filtering in Plan.
 * @param {number} lat @param {number} lon @param {number} [forecastDays]
 * @returns {Promise<Record<string, { sunrise: string, sunset: string }>>}
 */
export async function fetchSunSchedule(lat, lon, forecastDays = 7) {
  const tz = browserTimezone();
  const days = Math.min(7, Math.max(1, forecastDays));
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", tz);

  const res = await fetch(url);
  if (!res.ok) return {};

  const data = await res.json();
  const times = data.daily?.time || [];
  const sunrises = data.daily?.sunrise || [];
  const sunsets = data.daily?.sunset || [];
  /** @type {Record<string, { sunrise: string, sunset: string }>} */
  const byDate = {};

  for (let i = 0; i < times.length; i++) {
    byDate[times[i]] = { sunrise: sunrises[i], sunset: sunsets[i] };
  }
  return byDate;
}

/** @param {string} isoHour e.g. 2026-06-01T14:00 @param {{ sunrise: string, sunset: string }|undefined} sun */
export function isDaylightHour(isoHour, sun) {
  if (!sun?.sunrise || !sun?.sunset) return true;
  const t = new Date(isoHour).getTime();
  const rise = new Date(sun.sunrise).getTime();
  const set = new Date(sun.sunset).getTime();
  // Modest buffer: usable light ~30 min after sunrise, stop ~30 min before sunset
  const buffer = 30 * 60 * 1000;
  return t >= rise + buffer && t < set - buffer;
}

export { searchLocations } from "./location-search.js";
