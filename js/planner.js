import { assessSuitability, recommendKite, describeConditions } from "./engine.js";
import { evaluateSpot, hasTideLaunchRule, isOffshoreWind } from "./spot-engine.js";
import { profileToConditions } from "./storage.js";
import { isDaylightHour } from "./weather.js";
import {
  getTideExtremaFromHourly,
  getTideHourInfo,
  formatDayTideTimes,
} from "./tide-planning.js";
import { getProfileSkillLimits } from "./rider-skills.js";
import { ratePlanDay } from "./session-rating.js";
import {
  classifyDayFromHours,
  classifyWindSession,
  stripMisleadingLightNotes,
  gustSpread,
} from "./wind-session-copy.js";
import { computeRideableWindWindow } from "./plan-recommendation.js";
import { buildPlanKitePick } from "./plan-kite-algorithm.js";
import { buildPlanTimingTips } from "./plan-window-commentary.js";
import { buildPlanBringKit } from "./plan-bring-kit.js";
import { cleanCopy } from "./copy-format.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */

/**
 * @typedef {Object} ForecastHour
 * @property {string} time
 * @property {number} windSpeed
 * @property {number|null} gustSpeed
 * @property {string} windDirection
 */

/**
 * @typedef {Object} AvailabilityWindow
 * @property {string[]} dates
 * @property {number} startHour
 * @property {number} endHour
 */

/**
 * @typedef {Object} HourAssessment
 * @property {string} time
 * @property {number} hour
 * @property {string} date
 * @property {number} windSpeed
 * @property {number|null} gustSpeed
 * @property {string} windDirection
 * @property {number} score
 * @property {'good'|'marginal'|'bad'|'dark'|'tide-blocked'} verdict
 * @property {'good'|'marginal'|'bad'} windVerdict
 * @property {boolean} rideable
 * @property {boolean} inAvailability
 * @property {boolean} isDark
 * @property {boolean} tideAccessOk
 * @property {string|null} tideAccessNote
 * @property {string} tideLabel
 * @property {boolean} launchOk
 * @property {boolean} windOffshore
 * @property {boolean} tideRuleActive
 * @property {string|null} kiteName
 * @property {import('./plan-hourly-kites.js').PlanHourKitePick|null} [kitePick]
 * @property {string[]} notes
 */

/**
 * @typedef {Object} TimeBlock
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} label
 * @property {string} verdict
 * @property {number} avgWind
 */

/**
 * @typedef {Object} DayPlan
 * @property {string} date
 * @property {string} dateLabel
 * @property {import('./session-rating.js').SessionLevel} dayVerdict
 * @property {import('./plan-recommendation.js').PlanDayRecommendation|null} recommendation
 * @property {{ title: string, text: string }[]} tips
 * @property {string|null} tideTimes
 * @property {import('./tides.js').TidePrediction[]} [tideDayExtrema]
 * @property {TimeBlock|null} bestWindow
 * @property {TimeBlock[]} blocks
 * @property {HourAssessment[]} hours
 * @property {number} darkHoursHidden
 * @property {import('./plan-bring-kit.js').PlanBringKit|null} [bringKit]
 */

/**
 * @typedef {Object} RiderPlan
 * @property {string} profileId
 * @property {string} profileName
 * @property {DayPlan[]} days
 */

export function toDateKey(isoTime) {
  return isoTime.slice(0, 10);
}

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseHour(isoTime) {
  return parseInt(isoTime.slice(11, 13), 10);
}

export function formatHourLabel(date, hour) {
  const d = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateLabel(date) {
  const d = new Date(`${date}T12:00:00`);
  const today = localDateKey();
  const tomorrow = localDateKey(new Date(Date.now() + 86400000));
  const base = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
  if (date === today) return `Today (${base})`;
  if (date === tomorrow) return `Tomorrow (${base})`;
  return base;
}

/** @param {string} date ISO date key */
export function formatPlanDayTitle(date) {
  const d = new Date(`${date}T12:00:00`);
  const today = localDateKey();
  const tomorrow = localDateKey(new Date(Date.now() + 86400000));
  const weekday = d.toLocaleDateString([], { weekday: "long" });
  const dayMonth = d.toLocaleDateString([], { day: "numeric", month: "short" });
  let prefix = null;
  if (date === today) prefix = "Today";
  else if (date === tomorrow) prefix = "Tomorrow";
  return {
    prefix,
    primary: `${weekday} ${dayMonth}`,
    full: formatDateLabel(date),
  };
}

export function isInAvailability(avail, date, hour) {
  if (!avail.dates.includes(date)) return false;
  return hour >= avail.startHour && hour <= avail.endHour;
}

/**
 * Planning uses stricter bands than "Now"  ·  12 kt at the bottom of your range is marginal, not ideal.
 * @param {ReturnType<typeof assessSuitability>} base
 * @param {number} windSpeed
 * @param {number|null} gustSpeed
 */
function applyPlanWindVerdict(base, windSpeed, gustSpeed) {
  const limits = base.limits;
  let { score, rideable, notes } = base;
  const idealMin = limits.minWind + 2;
  const idealMax = limits.maxWind - 2;
  const spread = gustSpread(windSpeed, gustSpeed);
  const character = classifyWindSession(windSpeed, gustSpeed, limits);
  const veryGusty = character.kind === "very-gusty";
  const gusty = character.kind === "gusty" || veryGusty;

  notes = stripMisleadingLightNotes(notes);

  if (veryGusty) {
    score = Math.min(score, 58);
    notes = [...notes, character.summary];
  } else if (gusty) {
    score = Math.min(score, 65);
    notes = [...notes, character.summary];
  } else if (windSpeed >= limits.minWind && windSpeed < idealMin) {
    score = Math.min(score, 64);
    notes = [...notes, character.summary];
  } else if (windSpeed >= 10 && windSpeed <= 13) {
    score = Math.min(score, 68);
    notes = [...notes, character.summary];
  }

  let verdict = "bad";
  if (!rideable || windSpeed < 10) {
    verdict = "bad";
    rideable = false;
  } else if (
    score >= 65 &&
    windSpeed >= idealMin &&
    windSpeed <= idealMax &&
    spread <= limits.maxGustSpread * 1.1
  ) {
    verdict = "good";
  } else if (
    score >= 52 &&
    windSpeed >= limits.minWind &&
    windSpeed <= limits.maxWind
  ) {
    verdict = gusty || veryGusty ? "marginal" : "good";
    if (gusty || veryGusty) notes = [...notes, character.summary];
  } else if (score >= 40 && windSpeed >= limits.minWind) {
    verdict = "marginal";
    if (!notes.some((n) => n.includes(String(windSpeed)))) notes.push(character.summary);
  } else {
    verdict = "bad";
    rideable = false;
  }

  return { score, verdict, rideable, notes };
}

/**
 * @param {ForecastHour} fh
 * @param {RiderProfile} profile
 * @param {import('./engine.js').Kite[]} riderKites
 * @param {KiteSpot} spot
 * @param {string} spotNotes
 * @param {import('./tides.js').TidePrediction[]} tideHourly
 * @param {import('./tides.js').TidePrediction[]} tideExtrema
 * @param {Record<string, { sunrise: string, sunset: string }>} sunByDate
 */
function assessForecastHour(fh, profile, riderKites, spot, spotNotes, tideHourly, tideExtrema, sunByDate) {
  const conditions = profileToConditions(
    profile,
    spotNotes,
    fh.windSpeed,
    fh.gustSpeed,
    fh.windDirection,
    spot.waterType
  );

  const spotEval = evaluateSpot(spot, conditions, null);
  const base = assessSuitability(conditions, profile.calibration, spotEval);
  const wind = applyPlanWindVerdict(base, fh.windSpeed, fh.gustSpeed);

  const date = toDateKey(fh.time);
  const isDark = !isDaylightHour(fh.time, sunByDate[date]);

  const tideInfo = getTideHourInfo(
    fh.time,
    tideHourly,
    spot.tideAccessRule || "none",
    spot.tideWindowHours ?? 3,
    tideExtrema
  );

  const windVerdict = /** @type {'good'|'marginal'|'bad'} */ (
    wind.verdict === "good" ? "good" : wind.verdict === "marginal" ? "marginal" : "bad"
  );
  let verdict = windVerdict;
  let rideable = wind.rideable && spotEval.launchOk;
  const notes = [...wind.notes];
  let tideAccessNote = null;

  const tideRuleActive = hasTideLaunchRule(spot);

  if (!spotEval.launchOk) {
    verdict = "bad";
    rideable = false;
  } else if (tideRuleActive && !tideInfo.accessAllowed) {
    verdict = "tide-blocked";
    rideable = false;
    tideAccessNote = tideInfo.accessNote;
    if (tideAccessNote) notes.push(tideAccessNote);
  }

  const kiteRec = recommendKite(conditions, riderKites, profile.calibration);

  return {
    time: fh.time,
    hour: parseHour(fh.time),
    date,
    windSpeed: fh.windSpeed,
    gustSpeed: fh.gustSpeed,
    windDirection: fh.windDirection,
    score: wind.score,
    verdict,
    windVerdict,
    rideable,
    inAvailability: false,
    isDark,
    tideAccessOk: tideInfo.accessAllowed,
    tideAccessNote,
    tideLabel: tideInfo.label,
    launchOk: spotEval.launchOk,
    windOffshore: isOffshoreWind(spot, fh.windDirection),
    tideRuleActive,
    kiteName: kiteRec?.kite?.name ?? null,
    notes: notes.slice(0, 3),
  };
}

/** Hours that count toward go/maybe/skip (daylight + tide window + in availability) */
function isScorableHour(h, showNight) {
  if (!h.inAvailability) return false;
  if (h.isDark && !showNight) return false;
  return true;
}

/** Hours shown on timeline */
function isVisibleHour(h, showNight) {
  if (!h.inAvailability) return false;
  if (h.isDark && !showNight) return false;
  return true;
}

/** @param {HourAssessment[]} hours */
function groupIntoBlocks(hours) {
  if (!hours.length) return [];
  /** @type {TimeBlock[]} */
  const blocks = [];
  let cur = {
    startTime: hours[0].time,
    endTime: hours[0].time,
    verdict: hours[0].verdict,
    winds: [hours[0].windSpeed],
  };

  for (let i = 1; i < hours.length; i++) {
    const h = hours[i];
    if (h.verdict === cur.verdict) {
      cur.endTime = h.time;
      cur.winds.push(h.windSpeed);
    } else {
      blocks.push(finalizeBlock(cur));
      cur = {
        startTime: h.time,
        endTime: h.time,
        verdict: h.verdict,
        winds: [h.windSpeed],
      };
    }
  }
  blocks.push(finalizeBlock(cur));
  return blocks;
}

function finalizeBlock(cur) {
  const startH = parseHour(cur.startTime);
  const endH = parseHour(cur.endTime);
  const date = toDateKey(cur.startTime);
  const label =
    endH === startH
      ? formatHourLabel(date, startH)
      : `${formatHourLabel(date, startH)} to ${formatHourLabel(date, endH)}`;
  return {
    startTime: cur.startTime,
    endTime: cur.endTime,
    label,
    verdict: cur.verdict,
    avgWind: Math.round(cur.winds.reduce((a, b) => a + b, 0) / cur.winds.length),
  };
}

/** @param {HourAssessment[]} scorable @param {{ minWind: number, maxWind: number }} limits */
function findBestWindow(scorable, limits) {
  const rideable = computeRideableWindWindow(scorable, limits);
  if (!rideable) return null;
  return {
    startTime: rideable.startTime,
    endTime: rideable.endTime,
    label: rideable.label,
    verdict: "good",
    avgWind: rideable.avgWind,
  };
}

/** @param {import('./plan-recommendation.js').RideableWindSummary|null} rideable @param {HourAssessment[]} scorable */
function pickRepresentativeHour(rideable, scorable) {
  const isRideableHour = (/** @type {HourAssessment} */ h) =>
    h.rideable &&
    h.launchOk &&
    h.tideAccessOk &&
    h.verdict !== "dark" &&
    h.verdict !== "tide-blocked";
  if (rideable?.hours?.length) {
    const mid = rideable.hours[Math.floor(rideable.hours.length / 2)];
    return mid ?? rideable.hours[0];
  }
  const ok = scorable.filter(isRideableHour);
  return ok[0] ?? scorable[0] ?? null;
}

/**
 * @param {RiderProfile} profile
 * @param {KiteSpot} spot
 * @param {string} spotNotes
 * @param {HourAssessment[]} scorable
 * @param {import('./planner.js').TimeBlock|null} best
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} limits
 */
function buildPlanDayGuide(profile, riderKites, spot, spotNotes, scorable, rideable, limits) {
  const rep = pickRepresentativeHour(rideable, scorable);

  if (!rep || !rideable) {
    return { recommendation: null, tips: [] };
  }

  const { tips: timingTips, refinedRideable } = buildPlanTimingTips(scorable, rideable, limits);
  const effectiveRideable = refinedRideable ?? rideable;

  const conditions = profileToConditions(
    profile,
    spotNotes,
    effectiveRideable.avgWind,
    effectiveRideable.peakGust,
    effectiveRideable.windDirection,
    spot.waterType
  );
  const spotEval = evaluateSpot(spot, conditions, null);
  const suitability = assessSuitability(conditions, profile.calibration, spotEval);
  const adjusted = applyPlanWindVerdict(suitability, effectiveRideable.avgWind, effectiveRideable.peakGust);
  suitability.notes = adjusted.notes;
  suitability.verdict = adjusted.verdict;
  suitability.score = adjusted.score;

  const { kiteRec, kiteLine, dayVerdict } = buildPlanKitePick({
    rideable: effectiveRideable,
    kites: riderKites,
    calibration: profile.calibration,
    profile,
    spotNotes,
    waterType: spot.waterType,
    limits,
    scorable,
    spot,
  });

  const spread = gustSpread(effectiveRideable.avgWind, effectiveRideable.peakGust);
  const recommendation = {
    verdict: dayVerdict,
    windowLabel: effectiveRideable.label,
    avgWind: effectiveRideable.avgWind,
    peakGust: effectiveRideable.peakGust,
    peakWind: effectiveRideable.peakWind,
    gustSpread: spread,
    windDirection: effectiveRideable.windDirection,
    kiteName: kiteRec?.kite?.name ?? "Add kites on the Quiver tab",
    kiteLine,
    skipNote: buildSkipNoteForPlan(scorable, effectiveRideable, limits),
    timingNote: timingTips[0]?.text ?? null,
    forecast: {
      windSpeed: effectiveRideable.avgWind,
      gustSpeed: effectiveRideable.peakGust,
      windDirection: effectiveRideable.windDirection,
    },
  };

  const skipTitles = new Set(["Your spot", "How confident are we?", "On the water"]);
  const tips = [
    ...timingTips.map((s) => ({ ...s, text: cleanCopy(s.text) })),
    ...describeConditions(conditions, suitability, profile.calibration, {
      spot,
      spotEval,
    })
      .filter((s) => !skipTitles.has(s.title))
      .map((s) => ({ ...s, text: cleanCopy(s.text) })),
  ];

  if (spotEval?.windDirectionStatus === "bad") {
    tips.unshift({
      title: "Launch wind",
      text: "Forecast direction is unsafe for this spot. Check sectors under Spots before going.",
    });
  } else if (spotEval?.windDirectionStatus === "marginal") {
    tips.unshift({
      title: "Launch wind",
      text: "Wind direction is marginal for your launch. Have an exit plan.",
    });
  }

  return { recommendation, tips };
}

/** @param {HourAssessment[]} scorable @param {import('./plan-recommendation.js').RideableWindSummary} rideable @param {{ minWind: number }} limits */
function buildSkipNoteForPlan(scorable, rideable, limits) {
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
  const startLabel = formatHourLabel(date, windowStart);
  return `Skip before ${startLabel}: only ${range} kt and underpowered.`;
}

/** @param {HourAssessment[]} scorable @param {{ minWind: number, maxWind: number }} limits @param {import('./plan-recommendation.js').RideableWindSummary|null} [rideable] */
function dayVerdictFromHours(scorable, limits, rideable = null) {
  return ratePlanDay(scorable, limits, rideable);
}

/**
 * @param {object} params
 * @param {boolean} [params.showNight]
 * @param {Record<string, { sunrise: string, sunset: string }>} [params.sunByDate]
 */
export function planRiderSessions({
  profile,
  spot,
  forecast = [],
  tideHourly = [],
  availability,
  spotNotes = "",
  showNight = false,
  sunByDate = {},
  kites = [],
}) {
  const notes = [spotNotes, spot.localKnowledge].filter(Boolean).join(". ");
  const tideExtrema = tideHourly.length ? getTideExtremaFromHourly(tideHourly) : [];
  const skillLimits = getProfileSkillLimits(profile);
  const riderKites = kites ?? [];

  /** @type {HourAssessment[]} */
  const allHours = forecast.map((fh) => {
    const h = assessForecastHour(fh, profile, riderKites, spot, notes, tideHourly, tideExtrema, sunByDate);
    h.inAvailability = isInAvailability(availability, h.date, h.hour);
    return h;
  });

  const dates = [...new Set(availability.dates)].sort();
  /** @type {DayPlan[]} */
  const days = dates.map((date) => {
    const dayHours = allHours.filter((h) => h.date === date);
    const scorable = dayHours.filter((h) => isScorableHour(h, showNight));
    const visible = dayHours.filter((h) => isVisibleHour(h, showNight));
    const darkHidden = dayHours.filter((h) => h.inAvailability && h.isDark && !showNight).length;

    const blocks = groupIntoBlocks(visible);
    const rideable = computeRideableWindWindow(scorable, skillLimits);
    const best = findBestWindow(scorable, skillLimits);
    const tideDayExtrema = tideExtrema.filter((e) => e.time.slice(0, 10) === date);
    const tideTimes = formatDayTideTimes(date, tideExtrema);
    const { recommendation, tips } = buildPlanDayGuide(
      profile,
      riderKites,
      spot,
      notes,
      scorable,
      rideable,
      skillLimits
    );
    const dayVerdict =
      recommendation?.verdict ?? dayVerdictFromHours(scorable, skillLimits, rideable);

    return {
      date,
      dateLabel: formatDateLabel(date),
      planDayTitle: formatPlanDayTitle(date),
      dayVerdict,
      recommendation,
      tips,
      tideTimes,
      tideDayExtrema,
      bestWindow: best,
      blocks,
      hours: dayHours,
      darkHoursHidden: darkHidden,
    };
  });

  return {
    profileId: profile.id,
    profileName: profile.name,
    days,
  };
}

export function getUpcomingDates(count) {
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    dates.push(localDateKey(d));
  }
  return dates;
}

export function getWeekendDates() {
  const sat = new Date();
  sat.setHours(12, 0, 0, 0);
  const day = sat.getDay();
  const daysUntilSat = day === 6 ? 0 : day === 0 ? 6 : 6 - day;
  sat.setDate(sat.getDate() + daysUntilSat);
  const sun = new Date(sat);
  sun.setDate(sun.getDate() + 1);
  return [localDateKey(sat), localDateKey(sun)];
}

export function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateKey(d);
}

/**
 * Attach hourly kite picks + risk-averse bring list (requires catalog preload).
 * @param {RiderPlan} plan
 * @param {RiderProfile} profile
 * @param {import('./engine.js').Kite[]} kites
 * @param {KiteSpot} spot
 * @param {string} spotNotes
 * @param {boolean} showNight
 */
/**
 * @param {import('./plan-travel.js').PlanTravelOptions} [travel]
 */
export async function enrichRiderPlan(plan, profile, kites, spot, spotNotes, showNight, travel) {
  const skillLimits = getProfileSkillLimits(profile);

  for (const day of plan.days) {
    const scorable = day.hours.filter((h) => isScorableHour(h, showNight));
    const rideable = computeRideableWindWindow(scorable, skillLimits);

    day.bringKit = await buildPlanBringKit({
      profile,
      kites,
      spotNotes,
      waterType: spot.waterType,
      scorable,
      rideable,
      limits: skillLimits,
      travel,
    });

    const pickByTime = new Map(day.bringKit.hourly.map((p) => [p.time, p]));
    for (const h of day.hours) {
      h.kitePick = pickByTime.get(h.time) ?? null;
    }
  }

  return plan;
}
