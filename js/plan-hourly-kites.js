/**
 * Hour-by-hour kite picks for Plan timeline.
 */

import { recommendKite } from "./engine.js";
import { profileToConditions } from "./storage.js";
import { formatKt } from "./format.js";

/** @typedef {import('./planner.js').HourAssessment} HourAssessment */
/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

/**
 * @typedef {Object} PlanHourKitePick
 * @property {string} time
 * @property {number} hour
 * @property {number} windSpeed
 * @property {number|null} gustSpeed
 * @property {string|null} kiteId
 * @property {string|null} kiteName
 * @property {number|null} kiteSize
 * @property {number|null} score
 * @property {string} shortLabel
 * @property {string|null} altName
 * @property {'good'|'marginal'|'none'} fit
 */

const MIN_FIT_SCORE = 48;

/**
 * @param {RiderProfile} profile
 * @param {Kite[]} kites
 * @param {string} spotNotes
 * @param {string} waterType
 * @param {HourAssessment[]} hours
 * @param {{ minWind: number }} limits
 */
export function buildPlanHourlyKites(profile, kites, spotNotes, waterType, hours, limits) {
  /** @type {PlanHourKitePick[]} */
  const picks = [];

  for (const h of hours) {
    if (!h.inAvailability) continue;
    if (!h.launchOk || !h.tideAccessOk || h.verdict === "dark" || h.verdict === "tide-blocked") {
      continue;
    }

    const showKite =
      h.rideable || h.windSpeed >= limits.minWind - 1;
    if (!showKite) continue;

    const conditions = profileToConditions(
      profile,
      spotNotes,
      h.windSpeed,
      h.gustSpeed,
      h.windDirection,
      waterType
    );

    const rec = kites.length
      ? recommendKite(conditions, kites, profile.calibration)
      : null;

    const score = rec?.score ?? null;
    let fit = /** @type {'good'|'marginal'|'none'} */ ("none");
    if (score != null) {
      if (score >= 62 && rec?.inRange) fit = "good";
      else if (score >= MIN_FIT_SCORE) fit = "marginal";
    }

    const kiteName = rec?.kite?.name ?? null;
    const shortLabel = rec?.kite
      ? `${rec.kite.size}m`
      : kites.length
        ? "?"
        : "—";

    picks.push({
      time: h.time,
      hour: h.hour,
      windSpeed: h.windSpeed,
      gustSpeed: h.gustSpeed,
      kiteId: rec?.kite?.id ?? null,
      kiteName,
      kiteSize: rec?.kite?.size ?? null,
      score,
      shortLabel,
      altName: rec?.alternatives?.[0]?.kite?.name ?? null,
      fit,
    });
  }

  return picks;
}

/**
 * @param {PlanHourKitePick} pick
 */
/**
 * @param {PlanHourKitePick} pick
 * @param {{ travelRenting?: boolean }} [opts]
 */
export function formatHourKiteTooltipLine(pick, opts = {}) {
  if (!pick.kiteName) {
    return pick.fit === "none"
      ? opts.travelRenting
        ? "No strong catalog match — see rental sizes"
        : "No quiver kite fits well — see What to bring"
      : "Add kites on Quiver tab";
  }
  const gust =
    pick.gustSpeed != null && pick.gustSpeed > pick.windSpeed
      ? `, gusts ${formatKt(pick.gustSpeed)} kt`
      : "";
  const alt = pick.altName ? ` · alt ${pick.altName}` : "";
  return `${pick.kiteName} (${pick.score}% fit at ${formatKt(pick.windSpeed)} kt${gust})${alt}`;
}
