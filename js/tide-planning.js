import { formatNum } from "./format.js";

function dateKey(iso) {
  return iso.slice(0, 10);
}

/** @typedef {import('./tides.js').TidePrediction} TidePrediction */
/** @typedef {'none'|'within_low'|'within_high'} TideAccessRule */

/**
 * @typedef {Object} TideHourInfo
 * @property {'rising'|'falling'|'high'|'low'} phase
 * @property {string} label
 * @property {boolean} accessAllowed
 * @property {string|null} accessNote
 */

/** @param {TidePrediction[]} hourly */
export function getTideExtremaFromHourly(hourly) {
  /** @type {TidePrediction[]} */
  const extrema = [];
  for (let i = 1; i < hourly.length - 1; i++) {
    const prev = hourly[i - 1].height;
    const cur = hourly[i].height;
    const next = hourly[i + 1].height;
    if (cur >= prev && cur >= next) extrema.push({ ...hourly[i], type: "H" });
    else if (cur <= prev && cur <= next) extrema.push({ ...hourly[i], type: "L" });
  }
  return extrema;
}

/**
 * @param {string} date
 * @param {TidePrediction[]} extrema
 * @returns {TidePrediction[]}
 */
export function getDayTideExtrema(date, extrema) {
  return extrema
    .filter((e) => dateKey(e.time) === date)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

/**
 * @param {string} date
 * @param {TidePrediction[]} extrema
 */
export function formatDayTideTimes(date, extrema) {
  const day = getDayTideExtrema(date, extrema);
  if (!day.length) return null;

  return day
    .map((e) => {
      const t = new Date(e.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const kind = e.type === "H" ? "High" : "Low";
      return `${kind} ${t} (${formatNum(e.height, 1)} m)`;
    })
    .join(" · ");
}

/**
 * Readable tide panel with mini height chart.
 * @param {TidePrediction[]} dayExtrema sorted for one day
 */
export function renderDayTideChartHtml(dayExtrema) {
  if (!dayExtrema.length) return "";

  const heights = dayExtrema.map((e) => e.height);
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const range = maxH - minH || 0.1;

  const bars = dayExtrema
    .map((e) => {
      const t = new Date(e.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const isHigh = e.type === "H";
      const pct = Math.round(((e.height - minH) / range) * 100);
      const barRem = (0.6 + (pct / 100) * 2.8).toFixed(2);
      return `<div class="plan-tide-event plan-tide-event--${isHigh ? "high" : "low"}">
        <div class="plan-tide-event-bar" style="height:${barRem}rem" aria-hidden="true"></div>
        <span class="plan-tide-event-kind">${isHigh ? "High" : "Low"}</span>
        <span class="plan-tide-event-time">${t}</span>
        <span class="plan-tide-event-height">${formatNum(e.height, 1)} m</span>
      </div>`;
    })
    .join("");

  return `<div class="plan-tide-chart" role="img" aria-label="Tide high and low times for this day">
    <div class="plan-tide-chart-bars">${bars}</div>
  </div>`;
}

/**
 * @param {string} isoTime
 * @param {TidePrediction[]} hourly
 */
export function getTidePhaseAtHour(isoTime, hourly) {
  const idx = hourly.findIndex((h) => h.time === isoTime);
  if (idx < 0 || hourly.length < 2) return { phase: "rising", label: "Tide" };

  const cur = hourly[idx];
  const next = hourly[Math.min(idx + 1, hourly.length - 1)];
  const rising = next.height > cur.height;

  const nearHigh =
    idx > 0 && cur.height >= hourly[idx - 1].height && cur.height >= next.height;
  const nearLow =
    idx > 0 && cur.height <= hourly[idx - 1].height && cur.height <= next.height;

  if (nearHigh) return { phase: "high", label: "Near high" };
  if (nearLow) return { phase: "low", label: "Near low" };
  return rising
    ? { phase: "rising", label: "Rising" }
    : { phase: "falling", label: "Falling" };
}

/**
 * @param {string} isoTime
 * @param {TideAccessRule} rule
 * @param {number} windowHours
 * @param {TidePrediction[]} extrema
 */
export function assessTideAccess(isoTime, rule, windowHours, extrema) {
  if (!rule || rule === "none" || !extrema.length) {
    return { accessAllowed: true, accessNote: null };
  }

  const ts = new Date(isoTime).getTime();
  const windowMs = windowHours * 60 * 60 * 1000;
  const targets = extrema.filter((e) =>
    rule === "within_low" ? e.type === "L" : rule === "within_high" ? e.type === "H" : false
  );

  if (!targets.length) {
    return { accessAllowed: true, accessNote: null };
  }

  for (const t of targets) {
    if (Math.abs(new Date(t.time).getTime() - ts) <= windowMs) {
      return { accessAllowed: true, accessNote: null };
    }
  }

  const label = rule === "within_low" ? "low" : "high";
  return {
    accessAllowed: false,
    accessNote: `Outside ${windowHours}h window around ${label} tide`,
  };
}

/**
 * @param {string} isoTime
 * @param {TidePrediction[]} hourly
 * @param {TideAccessRule} rule
 * @param {number} windowHours
 * @param {TidePrediction[]} extrema
 * @returns {TideHourInfo}
 */
export function getTideHourInfo(isoTime, hourly, rule, windowHours, extrema) {
  const phase = getTidePhaseAtHour(isoTime, hourly);
  const access = assessTideAccess(isoTime, rule, windowHours, extrema);
  return {
    phase: phase.phase,
    label: phase.label,
    accessAllowed: access.accessAllowed,
    accessNote: access.accessNote,
  };
}
