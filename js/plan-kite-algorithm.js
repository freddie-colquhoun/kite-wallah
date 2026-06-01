/**
 * Plan kite + day verdict algorithm.
 *
 * Principles:
 * 1. Size kites from AVERAGE wind in the powered window (not peak gust).
 * 2. Past sessions (calibration) weigh heavily when wind is similar.
 * 3. Gusts change handling advice, not automatic "rig smaller" unless you're outside your logged comfort.
 * 4. Per-kite session ranges override the chart when you have logs; chart only when you don't.
 * 5. Day GO/Maybe is about whether the powered window is worth a session, not gust spread alone.
 */

import { recommendKite } from "./engine.js";
import { getCalibrationAtWind } from "./calibration.js";
import { profileToConditions } from "./storage.js";
import { formatKt } from "./format.js";
import { gustSpread } from "./wind-session-copy.js";
import { cleanCopy } from "./copy-format.js";
import { ratePlanDay } from "./session-rating.js";
import { describeWindVsKiteRange } from "./kite-personal-range.js";

/** @typedef {import('./plan-recommendation.js').RideableWindSummary} RideableWindSummary */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

/**
 * @typedef {Object} PlanKitePick
 * @property {ReturnType<typeof recommendKite>} kiteRec
 * @property {string} kiteLine
 * @property {import('./session-rating.js').SessionLevel} dayVerdict
 */

/**
 * Pick kite for the powered window and build rider-facing advice.
 * @param {object} p
 * @param {RideableWindSummary} p.rideable
 * @param {Kite[]} p.kites
 * @param {CalibrationEntry[]} p.calibration
 * @param {import('./storage.js').RiderProfile} p.profile
 * @param {string} p.spotNotes
 * @param {string} p.waterType
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} p.limits
 * @param {import('./planner.js').HourAssessment[]} p.scorable
 */
export function buildPlanKitePick({
  rideable,
  kites,
  calibration,
  profile,
  spotNotes,
  waterType,
  limits,
  scorable,
}) {
  const avgWind = rideable.avgWind;
  const peakGust = rideable.peakGust;
  const spread = gustSpread(avgWind, peakGust);

  const conditions = profileToConditions(
    profile,
    spotNotes,
    avgWind,
    peakGust,
    rideable.windDirection,
    waterType
  );

  const cal = getCalibrationAtWind(avgWind, calibration);
  const riderKites = kites ?? [];
  let kiteRec = recommendKite(conditions, riderKites, calibration);

  if (cal.preferredSize != null && kiteRec && riderKites.length) {
    const bestByCal = pickKiteNearSize(riderKites, cal.preferredSize, conditions, calibration);
    if (bestByCal) {
      const calDiff = Math.abs(kiteRec.kite.size - cal.preferredSize);
      const histDiff = Math.abs(bestByCal.kite.size - cal.preferredSize);
      const trustCal =
        cal.confidence === "high" ||
        (cal.confidence === "medium" && kiteRec.kite.size < cal.preferredSize - 0.5);
      if (
        trustCal &&
        (histDiff < calDiff - 0.5 || (histDiff <= calDiff && bestByCal.score > kiteRec.score - 8))
      ) {
        kiteRec = bestByCal;
      }
    }
  }

  const dayVerdict = ratePlanDay(scorable, limits, rideable);
  const kiteLine = buildPlanKiteAdvice({
    kiteRec,
    rideable,
    cal,
    limits,
    spread,
    peakGust,
    avgWind,
  });

  return { kiteRec, kiteLine: cleanCopy(kiteLine), dayVerdict };
}

/**
 * @param {Kite[]} kites
 * @param {number} targetSize
 * @param {import('./engine.js').Conditions} conditions
 * @param {CalibrationEntry[]} calibration
 */
function pickKiteNearSize(kites, targetSize, conditions, calibration) {
  const scored = kites
    .map((kite) => {
      const rec = recommendKite({ ...conditions, windSpeed: conditions.windSpeed }, [kite], calibration);
      if (!rec) return null;
      return {
        rec,
        sizeDiff: Math.abs(kite.size - targetSize),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sizeDiff - b.sizeDiff);
  return scored[0]?.rec ?? null;
}

/**
 * @param {object} p
 * @param {ReturnType<typeof recommendKite>|null} p.kiteRec
 * @param {RideableWindSummary} p.rideable
 * @param {ReturnType<typeof getCalibrationAtWind>} p.cal
 * @param {{ minWind: number, maxWind: number }} p.limits
 * @param {number} p.spread
 * @param {number|null} p.peakGust
 * @param {number} p.avgWind
 */
function buildPlanKiteAdvice({ kiteRec, cal, limits, spread, peakGust, avgWind }) {
  if (!kiteRec?.kite) {
    return "Add kites on the Quiver tab.";
  }

  const name = kiteRec.kite.name;
  const size = kiteRec.kite.size;
  const parts = [];

  if (kiteRec.comfortNote) {
    parts.push(kiteRec.comfortNote);
  } else if (kiteRec.reason) {
    parts.push(`${name} at ${formatKt(avgWind)} kt average: ${kiteRec.reason}`);
  }

  if (
    !kiteRec.comfortNote &&
    (cal.confidence === "high" || cal.confidence === "medium") &&
    cal.preferredSize != null
  ) {
    const diff = Math.abs(size - cal.preferredSize);
    if (diff <= 0.5) {
      parts.push(
        `You've been comfortable near ${formatKt(avgWind)} kt on ~${cal.preferredSize}m in your log.`
      );
    } else if (size > cal.preferredSize) {
      parts.push(
        `You often use ~${cal.preferredSize}m at similar wind; ${name} is a size up if you want more depower.`
      );
    } else {
      parts.push(
        `You often use ~${cal.preferredSize}m at similar wind; ${name} may feel small in the lulls.`
      );
    }
  } else if (!kiteRec.comfortNote && kiteRec.inRange) {
    parts.push(
      `${name} fits the ${formatKt(avgWind)} kt average (${kiteRec.reason || "manufacturer chart"}).`
    );
  } else if (!kiteRec.comfortNote && kiteRec.catalogRange && avgWind < kiteRec.catalogRange.min) {
    parts.push(
      `${name} may feel light at ${formatKt(avgWind)} kt (chart from ${formatKt(kiteRec.catalogRange.min)} kt). Log a session to tune this kite.`
    );
  } else if (!kiteRec.comfortNote) {
    parts.push(kiteRec.reason || `${name} for ${formatKt(avgWind)} kt average.`);
  }

  if (peakGust != null && spread >= 6) {
    parts.push(buildGustHandlingNote(avgWind, peakGust, spread, limits, name, size, kiteRec));
  }

  return parts.join(" ");
}

/**
 * Gust note: handling, not automatic smaller kite unless average wind is already strong.
 */
function buildGustHandlingNote(avgWind, peakGust, spread, limits, kiteName, kiteSize, kiteRec) {
  const personal = kiteRec?.effectiveRange?.personal;
  const comfyTop = personal?.comfortMax ?? kiteRec?.catalogRange?.max;

  if (avgWind >= limits.maxWind - 1) {
    return `Gusts to ${formatKt(peakGust)} kt: strong wind for your level. ${kiteName} only if you're comfortable in conditions like this.`;
  }
  if (spread >= 16) {
    const hist =
      personal?.pushMax != null
        ? ` You've ridden ${kiteName} in harsh gusts before (to ~${formatKt(personal.pushMax)} kt).`
        : "";
    return `Gusts to ${formatKt(peakGust)} kt (+${spread} kt) at ${formatKt(avgWind)} kt average: gust-management day.${hist} Keep the kite high; size down only if spikes feel too much.`;
  }
  if (spread >= 10) {
    return `Gusts to ${formatKt(peakGust)} kt above a ${formatKt(avgWind)} kt average. ${kiteName} is fine for the mean wind if you're happy near ${comfyTop ? `${formatKt(comfyTop)} kt on this kite` : "the top of your band"}.`;
  }
  return `Gusts to ${formatKt(peakGust)} kt: stay ready for brief extra power.`;
}
