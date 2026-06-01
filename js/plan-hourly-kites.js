/**
 * Hour-by-hour kite picks for Plan timeline.
 * Picks are stabilized within a session so small wind shifts do not flip kite size.
 */

import { recommendKite, scoreKiteForConditions } from "./engine.js";
import { profileToConditions } from "./storage.js";
import { formatKt } from "./format.js";
import { describeHourKiteFitNote } from "./kite-fit-copy.js";

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
 * @property {boolean} [sessionHeld] — same kite as earlier in this block despite a fresh chart pick
 * @property {string|null} [windDirection]
 */

const MIN_FIT_SCORE = 48;

/** Do not swap kite size for wind changes smaller than this within one session block. */
const SESSION_REPICK_WIND_KT = 5;

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
  const raw = [];

  for (const h of hours) {
    if (!h.inAvailability) continue;
    if (!h.launchOk || !h.tideAccessOk || h.verdict === "dark" || h.verdict === "tide-blocked") {
      continue;
    }

    const showKite =
      h.rideable || h.windSpeed >= limits.minWind - 1;
    if (!showKite) continue;

    const pick = pickKiteForHour(profile, kites, spotNotes, waterType, h);
    if (pick) raw.push(pick);
  }

  return stabilizeSessionHourlyKites(raw, profile, kites, spotNotes, waterType);
}

/**
 * @param {RiderProfile} profile
 * @param {Kite[]} kites
 * @param {string} spotNotes
 * @param {string} waterType
 * @param {HourAssessment} h
 * @returns {PlanHourKitePick|null}
 */
function pickKiteForHour(profile, kites, spotNotes, waterType, h) {
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

  return kiteRecToHourPick(h, rec);
}

/**
 * @param {HourAssessment} h
 * @param {ReturnType<typeof recommendKite>|null} rec
 * @returns {PlanHourKitePick|null}
 */
function kiteRecToHourPick(h, rec) {
  const score = rec?.score ?? null;
  let fit = /** @type {'good'|'marginal'|'none'} */ ("none");
  if (score != null) {
    if (score >= 62 && rec?.inRange) fit = "good";
    else if (score >= MIN_FIT_SCORE) fit = "marginal";
  }

  const kiteName = rec?.kite?.name ?? null;
  const shortLabel = rec?.kite
    ? `${rec.kite.size}m`
    : "—";

  return {
    time: h.time,
    hour: h.hour,
    windSpeed: h.windSpeed,
    gustSpeed: h.gustSpeed,
    windDirection: h.windDirection ?? null,
    kiteId: rec?.kite?.id ?? null,
    kiteName,
    kiteSize: rec?.kite?.size ?? null,
    score,
    shortLabel,
    altName: rec?.alternatives?.[0]?.kite?.name ?? null,
    fit,
    sessionHeld: false,
  };
}

/**
 * @param {PlanHourKitePick} pick
 */
function cloneSessionKiteFields(pick) {
  return {
    kiteId: pick.kiteId,
    kiteName: pick.kiteName,
    kiteSize: pick.kiteSize,
    shortLabel: pick.shortLabel,
    altName: pick.altName,
  };
}

/**
 * @param {PlanHourKitePick} pick
 * @param {ReturnType<typeof cloneSessionKiteFields>} sessionKite
 * @param {RiderProfile} profile
 * @param {Kite[]} kites
 * @param {string} spotNotes
 * @param {string} waterType
 * @param {boolean} sessionHeld
 */
function applySessionKiteToHour(pick, sessionKite, profile, kites, spotNotes, waterType, sessionHeld) {
  if (!sessionKite.kiteId) {
    return { ...pick, sessionHeld: false };
  }

  const kite = kites.find((k) => k.id === sessionKite.kiteId);
  if (!kite) {
    return { ...pick, ...sessionKite, sessionHeld };
  }

  const conditions = profileToConditions(
    profile,
    spotNotes,
    pick.windSpeed,
    pick.gustSpeed,
    pick.windDirection ?? undefined,
    waterType
  );
  const row = scoreKiteForConditions(conditions, kite, profile.calibration);
  const score = row.score;
  let fit = /** @type {'good'|'marginal'|'none'} */ ("none");
  if (score >= 62) fit = "good";
  else if (score >= MIN_FIT_SCORE) fit = "marginal";

  return {
    ...pick,
    ...sessionKite,
    score,
    fit,
    sessionHeld,
  };
}

/**
 * Keep one rig choice per continuous on-water block unless wind moves ≥ SESSION_REPICK_WIND_KT.
 * @param {PlanHourKitePick[]} raw
 * @param {RiderProfile} profile
 * @param {Kite[]} kites
 * @param {string} spotNotes
 * @param {string} waterType
 */
function stabilizeSessionHourlyKites(raw, profile, kites, spotNotes, waterType) {
  if (raw.length < 2) return raw;

  /** @type {PlanHourKitePick[]} */
  const out = [];
  let anchorWind = raw[0].windSpeed;
  let sessionKite = cloneSessionKiteFields(raw[0]);
  out.push({ ...raw[0], sessionHeld: false });

  for (let i = 1; i < raw.length; i++) {
    const cur = raw[i];
    const prev = raw[i - 1];
    const hourGap = cur.hour - prev.hour;
    const newBlock = hourGap > 1;

    if (newBlock) {
      out.push({ ...cur, sessionHeld: false });
      anchorWind = cur.windSpeed;
      sessionKite = cloneSessionKiteFields(cur);
      continue;
    }

    const windDelta = Math.abs(cur.windSpeed - anchorWind);
    const sameSize =
      cur.kiteSize != null &&
      sessionKite.kiteSize != null &&
      Math.abs(cur.kiteSize - sessionKite.kiteSize) < 0.25;

    if (windDelta < SESSION_REPICK_WIND_KT && sessionKite.kiteId && !sameSize) {
      out.push(
        applySessionKiteToHour(cur, sessionKite, profile, kites, spotNotes, waterType, true)
      );
    } else {
      out.push({ ...cur, sessionHeld: false });
      if (!sameSize || windDelta >= SESSION_REPICK_WIND_KT) {
        anchorWind = cur.windSpeed;
        sessionKite = cloneSessionKiteFields(cur);
      }
    }
  }

  return out;
}

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
  const fitNote = describeHourKiteFitNote(pick);
  const fitSuffix = fitNote ? ` — ${fitNote}` : "";
  const sessionNote = pick.sessionHeld
    ? " — same kite for this session (wind only shifted a little)"
    : "";
  return `${pick.kiteName} at ${formatKt(pick.windSpeed)} kt${gust}${fitSuffix}${sessionNote}${alt}`;
}
