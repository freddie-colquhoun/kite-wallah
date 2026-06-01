/**
 * Hour-by-hour Plan commentary: spikes, lulls, and steadier alternatives.
 */

import { formatKt } from "./format.js";
import { gustSpread } from "./wind-session-copy.js";

/** @typedef {import('./planner.js').HourAssessment} HourAssessment */
/** @typedef {import('./plan-recommendation.js').RideableWindSummary} RideableWindSummary */

function parseHour(isoTime) {
  return new Date(isoTime).getHours();
}

function toDateKey(isoTime) {
  return isoTime.slice(0, 10);
}

function formatHourLabel(date, hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourRangeLabel(date, startH, endH) {
  return startH === endH
    ? formatHourLabel(date, startH)
    : `${formatHourLabel(date, startH)}-${formatHourLabel(date, endH)}`;
}

/** @param {HourAssessment} h */
function isPoweredHour(h, limits) {
  return (
    h.rideable &&
    h.launchOk &&
    h.tideAccessOk &&
    h.verdict !== "dark" &&
    h.verdict !== "tide-blocked" &&
    h.windSpeed >= limits.minWind + 2
  );
}

/** @param {HourAssessment[]} run */
function summarizeRun(run) {
  const gusts = run.map((h) => h.gustSpeed).filter((g) => g != null);
  const winds = run.map((h) => h.windSpeed);
  const date = toDateKey(run[0].time);
  const startH = parseHour(run[0].time);
  const endH = parseHour(run[run.length - 1].time);
  const avgWind = Math.round(winds.reduce((a, b) => a + b, 0) / winds.length);
  const minWind = Math.min(...winds);
  const peakWind = Math.max(...winds);

  return {
    label: hourRangeLabel(date, startH, endH),
    avgWind,
    minWind,
    peakWind,
    peakGust: gusts.length ? Math.max(...gusts) : null,
    hourCount: run.length,
    startTime: run[0].time,
    endTime: run[run.length - 1].time,
    windDirection: run.reduce((a, b) => (a.windSpeed >= b.windSpeed ? a : b)).windDirection,
    hours: run,
    windSpread: peakWind - minWind,
  };
}

/**
 * Longest contiguous sub-run with the highest minimum wind (steadier session).
 * @param {HourAssessment[]} hours
 * @param {{ minWind: number }} limits
 * @param {number} [minLen]
 */
function findSteadiestSubRun(hours, limits, minLen = 2) {
  if (hours.length < minLen) return null;

  /** @type {ReturnType<typeof summarizeRun>[]} */
  const candidates = [];

  for (let i = 0; i < hours.length; i++) {
    for (let j = i + minLen - 1; j < hours.length; j++) {
      const slice = hours.slice(i, j + 1);
      if (!slice.every((h) => isPoweredHour(h, limits))) continue;
      const sum = summarizeRun(slice);
      const score = sum.minWind * 14 + sum.hourCount * 6 - sum.windSpread * 5;
      candidates.push({ score, summary: sum });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * @param {HourAssessment[]} scorable
 * @param {RideableWindSummary} rideable
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} limits
 * @returns {{ tips: { title: string, text: string }[], refinedRideable: RideableWindSummary|null }}
 */
export function buildPlanTimingTips(scorable, rideable, limits) {
  /** @type {{ title: string, text: string }[]} */
  const tips = [];
  if (!rideable?.hours?.length) return { tips, refinedRideable: null };

  const hours = rideable.hours;
  const date = toDateKey(hours[0].time);
  const poweredMin = limits.minWind + 2;

  const steadier = findSteadiestSubRun(hours, limits, 2);
  const headlineStart = parseHour(rideable.startTime);
  const steadierStart = steadier ? parseHour(steadier.summary.startTime) : null;

  const useRefined =
    steadier &&
    steadierStart != null &&
    (steadierStart > headlineStart ||
      steadier.summary.minWind >= rideable.avgWind - 1 ||
      steadier.summary.windSpread + 2 < rideable.peakWind - rideable.avgWind);

  let refinedRideable = null;
  if (useRefined && steadier.summary.hourCount >= 2) {
    const s = steadier.summary;
    refinedRideable = {
      label: s.label,
      avgWind: s.avgWind,
      avgGust: null,
      peakGust: s.peakGust,
      peakWind: s.peakWind,
      windDirection: s.windDirection,
      hourCount: s.hourCount,
      startTime: s.startTime,
      endTime: s.endTime,
      hours: s.hours,
    };
    if (s.peakGust != null) {
      const gusts = s.hours.map((h) => h.gustSpeed).filter((g) => g != null);
      refinedRideable.avgGust = gusts.length
        ? Math.round(gusts.reduce((a, b) => a + b, 0) / gusts.length)
        : null;
    }

    if (steadierStart > headlineStart) {
      const early = hours.filter((h) => parseHour(h.time) < steadierStart);
      const maxEarly = early.length ? Math.max(...early.map((h) => h.windSpeed)) : 0;
      const maxEarlyHour = early.find((h) => h.windSpeed === maxEarly);

      tips.push({
        title: "Best time on the water",
        text:
          maxEarlyHour && maxEarly >= poweredMin + 3
            ? `${formatHourLabel(date, parseHour(maxEarlyHour.time))} briefly hits ${formatKt(maxEarly)} kt, but it does not hold — wind settles from ${s.label} with ${formatKt(s.minWind)}-${formatKt(s.peakWind)} kt for ${s.hourCount} hours. Plan to ride from ${formatHourLabel(date, steadierStart)} onward, not for the short early pulse.`
            : `The steadiest powered block is ${s.label} (${formatKt(s.avgWind)} kt average, ${formatKt(s.minWind)}-${formatKt(s.peakWind)} kt). The wider ${rideable.label} window includes lighter or gustier hours — aim for ${s.label}.`,
      });
    } else if (s.windSpread <= 3 && rideable.peakWind - rideable.avgWind >= 5) {
      tips.push({
        title: "Best time on the water",
        text: `Within ${rideable.label}, ${s.label} is the steadiest stretch (${formatKt(s.avgWind)} kt average, only ${formatKt(s.windSpread)} kt variation). Earlier or later hours in the window are gustier or lighter.`,
      });
    }
  }

  if (!tips.length && hours.length >= 2) {
    const first = hours[0];
    const second = hours[1];
    if (first.windSpeed >= second.windSpeed + 4 && second.windSpeed < first.windSpeed - 3) {
      const later = hours.slice(2).filter((h) => h.windSpeed >= poweredMin);
      if (later.length >= 2) {
        const lh = parseHour(later[0].time);
        const lh2 = parseHour(later[later.length - 1].time);
        const lMin = Math.min(...later.map((h) => h.windSpeed));
        const lMax = Math.max(...later.map((h) => h.windSpeed));
        tips.push({
          title: "Best time on the water",
          text: `${formatHourLabel(date, parseHour(first.time))} peaks at ${formatKt(first.windSpeed)} kt then drops to ${formatKt(second.windSpeed)} kt — less than an hour of strong wind. From ${hourRangeLabel(date, lh, lh2)} it holds ${formatKt(lMin)}-${formatKt(lMax)} kt more reliably.`,
        });
      }
    }
  }

  const spread = gustSpread(rideable.avgWind, rideable.peakGust);
  if (spread >= 12 && !tips.some((t) => t.title === "Best time on the water")) {
    tips.push({
      title: "Gust pattern",
      text: `Average ${formatKt(rideable.avgWind)} kt but gusts to ${formatKt(rideable.peakGust)} kt across ${rideable.label}. On the water you will feel lulls then sharp surges — size for the average and keep the kite high.`,
    });
  }

  if (!tips.length) {
    tips.push({
      title: "Best time on the water",
      text: `${rideable.label} holds powered wind (${formatKt(rideable.avgWind)} kt average${rideable.peakGust != null ? `, gusts to ${formatKt(rideable.peakGust)} kt` : ""}). Use the hourly strip above to see when it is strongest.`,
    });
  }

  return { tips, refinedRideable };
}
