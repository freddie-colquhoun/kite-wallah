import { hasSolidPoweredWindow } from "./plan-recommendation.js";

/**
 * Session confidence labels (Now + Plan day badges).
 * @typedef {'go'|'possible'|'maybe'|'probably-not'|'no'} SessionLevel
 */

/** @type {Record<SessionLevel, { label: string, icon: string, short: string }>} */
export const SESSION_LEVEL_META = {
  go: { label: "GO", icon: "✓", short: "Solid session" },
  possible: { label: "Possible", icon: "↑", short: "Worth a look" },
  maybe: { label: "Maybe", icon: "~", short: "Borderline" },
  "probably-not": { label: "Probably not", icon: "!", short: "Weak odds" },
  no: { label: "Skip", icon: "✕", short: "Don't bother" },
};

/**
 * @param {SessionLevel} level
 */
export function sessionLevelLabel(level) {
  return SESSION_LEVEL_META[level]?.label ?? level;
}

/** @param {number} windSpeed @param {number|null|undefined} gustSpeed */
function windGustSpread(windSpeed, gustSpeed) {
  if (gustSpeed == null || gustSpeed <= windSpeed) return 0;
  return gustSpeed - windSpeed;
}

/**
 * Now tab / analyse  ·  from suitability score and wind vs ability band.
 * @param {{ score: number, rideable: boolean, verdict: string }} suitability
 * @param {number} windSpeed
 * @param {{ minWind: number, maxWind: number }} limits
 * @param {{ launchOk?: boolean, gustSpeed?: number|null }} [opts]
 * @returns {SessionLevel}
 */
export function rateNowSession(suitability, windSpeed, limits, opts = {}) {
  const launchOk = opts.launchOk !== false;
  const { score, rideable } = suitability;

  if (!rideable || !launchOk || windSpeed < 10) return "no";

  const sweetMin = limits.minWind + 2;
  const sweetMax = limits.maxWind - 2;
  const inSweet = windSpeed >= sweetMin && windSpeed <= sweetMax;
  const inBand = windSpeed >= limits.minWind && windSpeed <= limits.maxWind;

  const spread =
    opts.gustSpeed != null && opts.gustSpeed > windSpeed
      ? opts.gustSpeed - windSpeed
      : 0;
  const maxGust = limits.maxGustSpread ?? 9;
  const veryGusty = spread > maxGust * 1.25;
  const gusty = spread > maxGust * 0.75;

  if (veryGusty) {
    if (score >= 52 && inBand) return "maybe";
    return score >= 42 ? "probably-not" : "no";
  }
  if (gusty && score < 62) return "maybe";

  if (score >= 72 && inSweet && !gusty) return "go";
  if (score >= 65 && inBand) return "go";
  if (score >= 58 && inBand) return "possible";
  if (score >= 48 && windSpeed >= limits.minWind) return "maybe";
  if (score >= 42 || suitability.verdict === "marginal") return "probably-not";
  return "no";
}

/**
 * Plan day verdict from powered hours in the window (gust spread affects kite note, not a veto).
 * @param {import('./planner.js').HourAssessment[]} scorable
 * @param {{ minWind: number, maxWind: number, maxGustSpread?: number }} limits
 * @param {import('./plan-recommendation.js').RideableWindSummary|null} [rideable]
 * @returns {SessionLevel}
 */
export function ratePlanDay(scorable, limits, rideable = null) {
  const ok = (/** @type {import('./planner.js').HourAssessment} */ h) =>
    h.rideable && h.tideAccessOk && h.launchOk;

  const good = scorable.filter((h) => h.verdict === "good" && ok(h));
  const marginal = scorable.filter((h) => h.verdict === "marginal" && ok(h));
  const powered = (/** @type {import('./planner.js').HourAssessment} */ h) =>
    h.windSpeed >= limits.minWind + 2;

  const poweredGood = good.filter(powered);
  const poweredMarginal = marginal.filter(powered);
  const poweredAny = scorable.filter((h) => ok(h) && powered(h));

  const avgWind = rideable?.avgWind ?? null;
  const windowSpread =
    rideable != null ? windGustSpread(rideable.avgWind, rideable.peakGust) : 0;
  const maxGust = limits.maxGustSpread ?? 9;
  const gustyWindow = windowSpread > maxGust * 0.9;
  const veryGustyWindow = windowSpread > maxGust * 1.4;

  const wellPoweredWindow = avgWind != null && avgWind >= limits.minWind + 2;

  if (!poweredAny.length && !scorable.some((h) => ok(h))) return "no";

  if (wellPoweredWindow && poweredGood.length >= 2) {
    if (veryGustyWindow) return "possible";
    if (gustyWindow && poweredGood.length < 3) return "possible";
    return "go";
  }

  if (wellPoweredWindow && poweredGood.length >= 1) {
    return gustyWindow ? "possible" : "go";
  }

  if (poweredGood.length >= 2) return gustyWindow ? "possible" : "go";
  if (poweredGood.length >= 1 || poweredMarginal.length >= 3) return "possible";

  const solidPowered = hasSolidPoweredWindow(scorable, limits, rideable);

  if (poweredMarginal.length >= 2 || (good.length >= 1 && marginal.length >= 1)) {
    return solidPowered ? "maybe" : "probably-not";
  }
  if (marginal.length >= 2) return solidPowered ? "maybe" : "probably-not";
  if (scorable.some((h) => ok(h) && h.windSpeed >= limits.minWind)) return "probably-not";
  return "no";
}
