import { recommendKite } from "./engine.js";
import { formatKt } from "./format.js";
import { gustSpread } from "./wind-session-copy.js";
function parseHour(isoTime) {
  return new Date(isoTime).getHours();
}

function toDateKey(isoTime) {
  return isoTime.slice(0, 10);
}

function formatHourLabel(date, hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** @typedef {import('./planner.js').HourAssessment} HourAssessment */
/** @typedef {import('./engine.js').Kite} Kite */

/**
 * @typedef {Object} RideableWindSummary
 * @property {string} label
 * @property {number} avgWind
 * @property {number|null} avgGust
 * @property {number|null} peakGust
 * @property {number} peakWind
 * @property {string} windDirection
 * @property {number} hourCount
 * @property {string} startTime
 * @property {string} endTime
 * @property {HourAssessment[]} hours
 */

/**
 * @typedef {Object} PlanDayRecommendation
 * @property {import('./session-rating.js').SessionLevel} verdict
 * @property {string} windowLabel
 * @property {number} avgWind
 * @property {number|null} peakGust
 * @property {number} peakWind
 * @property {number} gustSpread
 * @property {string} windDirection
 * @property {string} kiteName
 * @property {string} kiteLine
 * @property {string|null} skipNote
 * @property {{ windSpeed: number, gustSpeed: number|null, windDirection: string }} forecast
 */

/** @param {HourAssessment} h */
function isRideableHour(h) {
  return (
    h.rideable &&
    h.launchOk &&
    h.tideAccessOk &&
    h.verdict !== "dark" &&
    h.verdict !== "tide-blocked"
  );
}

/** @param {HourAssessment} h @param {{ minWind: number }} limits */
function isPoweredHour(h, limits) {
  return isRideableHour(h) && h.windSpeed >= limits.minWind + 2;
}

/** @param {HourAssessment[]} hours @param {HourAssessment[]} scorable */
function groupContiguousRuns(hours, scorable) {
  /** @type {HourAssessment[][]} */
  const runs = [];
  let run = [hours[0]];
  for (let i = 1; i < hours.length; i++) {
    const prevIdx = scorable.indexOf(hours[i - 1]);
    const curIdx = scorable.indexOf(hours[i]);
    if (curIdx === prevIdx + 1) run.push(hours[i]);
    else {
      runs.push(run);
      run = [hours[i]];
    }
  }
  runs.push(run);
  return runs;
}

function finalizeRunSummary(run) {
  const gusts = run.map((h) => h.gustSpeed).filter((g) => g != null);
  const strongest = run.reduce((a, b) => (a.windSpeed >= b.windSpeed ? a : b));
  const date = toDateKey(run[0].time);
  const startH = parseHour(run[0].time);
  const endH = parseHour(run[run.length - 1].time);
  const label =
    endH === startH
      ? formatHourLabel(date, startH)
      : `${formatHourLabel(date, startH)}-${formatHourLabel(date, endH)}`;

  return {
    label,
    avgWind: Math.round(run.reduce((s, h) => s + h.windSpeed, 0) / run.length),
    avgGust: gusts.length
      ? Math.round(gusts.reduce((a, b) => a + b, 0) / gusts.length)
      : null,
    peakGust: gusts.length ? Math.max(...gusts) : null,
    peakWind: Math.max(...run.map((h) => h.windSpeed)),
    windDirection: strongest.windDirection,
    hourCount: run.length,
    startTime: run[0].time,
    endTime: run[run.length - 1].time,
    hours: run,
  };
}

/** @param {HourAssessment[]} run @param {{ minWind: number, maxGustSpread: number }} limits */
function scorePoweredRun(run, limits) {
  const winds = run.map((h) => h.windSpeed);
  const avgWind = winds.reduce((s, h) => s + h, 0) / run.length;
  const minWind = Math.min(...winds);
  const peakGust = Math.max(...run.map((h) => h.gustSpeed ?? h.windSpeed));
  const spread = peakGust - avgWind;
  const good = run.filter((h) => h.verdict === "good").length;
  const gustPenalty = spread > limits.maxGustSpread ? (spread - limits.maxGustSpread) * 3 : 0;
  const dipPenalty = (avgWind - minWind) * 6;
  const variance =
    winds.reduce((s, w) => s + (w - avgWind) ** 2, 0) / winds.length;
  const steadyBonus = minWind >= limits.minWind + 3 ? 12 : 0;
  return (
    avgWind * 12 +
    good * 18 +
    run.length * 4 +
    steadyBonus -
    gustPenalty -
    dipPenalty -
    variance * 2
  );
}

/**
 * Best window = longest meaningful **powered** block (not whole free-time marginal span).
 * @param {HourAssessment[]} scorable
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} limits
 * @returns {RideableWindSummary|null}
 */
export function computeRideableWindWindow(scorable, limits) {
  const powered = scorable.filter((h) => isPoweredHour(h, limits));
  if (powered.length >= 2) {
    const runs = groupContiguousRuns(powered, scorable).filter((r) => r.length >= 2);
    if (runs.length) {
      runs.sort((a, b) => scorePoweredRun(b, limits) - scorePoweredRun(a, limits));
      return finalizeRunSummary(runs[0]);
    }
  }
  return null;
}

/**
 * True when free time has a contiguous powered block (minWind+2 kt, 2+ hours).
 * @param {HourAssessment[]} scorable
 * @param {{ minWind: number }} limits
 * @param {RideableWindSummary|null} [rideable]
 */
export function hasSolidPoweredWindow(scorable, limits, rideable = null) {
  const powered = scorable.filter((h) => isPoweredHour(h, limits));
  if (powered.length < 2) return false;
  const hasRun = groupContiguousRuns(powered, scorable).some((r) => r.length >= 2);
  if (!hasRun) return false;
  if (rideable == null) return true;
  return rideable.avgWind >= limits.minWind + 2 && rideable.hourCount >= 2;
}

/**
 * @param {ReturnType<typeof recommendKite>} kiteRec
 * @param {RideableWindSummary} rideable
 * @param {Kite[]} kites
 */
function buildGustAwareKiteAdvice(kiteRec, rideable, kites) {
  if (!kiteRec?.kite) return "Add kites under Riders to get a size pick.";

  const spread = gustSpread(rideable.avgWind, rideable.peakGust);
  const peakGust = rideable.peakGust;
  const name = kiteRec.kite.name;

  if (!peakGust || spread < 8) {
    return `${name} for steady ${formatKt(rideable.avgWind)} kt  ·  ${kiteRec.reason}`;
  }

  const sorted = [...kites].sort((a, b) => b.size - a.size);
  const idx = sorted.findIndex((k) => k.id === kiteRec.kite.id);
  const smaller = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  if (peakGust >= 28 || spread >= 12) {
    if (smaller) {
      return `Avg ${formatKt(rideable.avgWind)} kt but gusts to ${formatKt(peakGust)} kt  ·  ${name} is risky. Prefer ${smaller.name} (or smaller) for gust control; only keep ${name} if you're comfortable being overpowered in surges.`;
    }
    return `Gusts to ${formatKt(peakGust)} kt with only ${formatKt(rideable.avgWind)} kt average  ·  rig smaller than ${name} if you have one; gust-management day.`;
  }

  if (smaller) {
    return `${name} works in the lulls (~${formatKt(rideable.avgWind)} kt) but gusts to ${formatKt(peakGust)} kt  ·  ${smaller.name} is the safer call.`;
  }

  return `${name} at ${formatKt(rideable.avgWind)} kt avg  ·  watch gusts to ${formatKt(peakGust)} kt and size down if it builds.`;
}

/**
 * @param {HourAssessment[]} scorable
 * @param {RideableWindSummary} rideable
 * @param {{ minWind: number }} limits
 */
function buildSkipNote(scorable, rideable, limits) {
  const windowStart = parseHour(rideable.startTime);
  const date = toDateKey(rideable.startTime);
  const light = scorable.filter(
    (h) =>
      h.inAvailability &&
      toDateKey(h.time) === date &&
      parseHour(h.time) < windowStart &&
      h.windSpeed < limits.minWind + 2
  );
  if (light.length < 2) return null;
  const speeds = light.map((h) => h.windSpeed);
  const minL = Math.min(...speeds);
  const maxL = Math.max(...speeds);
  const range = minL === maxL ? `${minL}` : `${minL}-${maxL}`;
  return `Skip before ${formatHourLabel(date, windowStart)}  ·  only ${range} kt and underpowered.`;
}

/**
 * @param {RideableWindSummary} rideable
 * @param {import('./session-rating.js').SessionLevel} dayVerdict
 * @param {ReturnType<typeof recommendKite>|null} kiteRec
 * @param {Kite[]} kites
 * @param {HourAssessment[]} scorable
 * @param {{ minWind: number, maxGustSpread: number }} limits
 * @returns {PlanDayRecommendation|null}
 */
export function buildPlanDayRecommendation(
  rideable,
  dayVerdict,
  kiteRec,
  kites,
  scorable,
  limits
) {
  if (!rideable) return null;

  const spread = gustSpread(rideable.avgWind, rideable.peakGust);
  return {
    verdict: dayVerdict,
    windowLabel: rideable.label,
    avgWind: rideable.avgWind,
    peakGust: rideable.peakGust,
    peakWind: rideable.peakWind,
    gustSpread: spread,
    windDirection: rideable.windDirection,
    kiteName: kiteRec?.kite?.name ?? " · ",
    kiteLine: buildGustAwareKiteAdvice(kiteRec, rideable, kites),
    skipNote: buildSkipNote(scorable, rideable, limits),
    forecast: {
      windSpeed: rideable.avgWind,
      gustSpeed: rideable.peakGust,
      windDirection: rideable.windDirection,
    },
  };
}
