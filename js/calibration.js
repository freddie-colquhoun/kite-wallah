/**
 * @typedef {'couldnt-ride'|'very-underpowered'|'underpowered-rideable'|'slightly-underpowered'|'just-right'|'comfortable'|'slightly-overpowered'|'overpowered-rideable'|'very-overpowered'|'too-small'|'too-big'} SessionFeeling
 */

/**
 * @typedef {Object} CalibrationEntry
 * @property {string} id
 * @property {number} windSpeed
 * @property {number|null} [gustSpeed]
 * @property {string|null} [windDirection]
 * @property {number} kiteSize
 * @property {string} [kiteName]
 * @property {string|null} [kiteId]
 * @property {string|null} [spotId]
 * @property {string|null} [spotName]
 * @property {string|null} [sessionAt] ISO datetime (legacy  ·  use sessionStartAt)
 * @property {string|null} [sessionStartAt] ISO datetime
 * @property {string|null} [sessionEndAt] ISO datetime
 * @property {string|null} [boardId]
 * @property {string|null} [boardName]
 * @property {string|null} [waterDescription] Visual sea state, e.g. flat, white horses
 * @property {SessionFeeling} feeling
 * @property {number|null} [sessionRating] 1-5 how good the session was
 * @property {string} [notes]
 * @property {string|null} [waterType]
 */

const FEELING_LABELS = {
  "couldnt-ride": "Couldn't get going / stay upwind",
  "very-underpowered": "Very underpowered",
  "underpowered-rideable": "Underpowered but still rideable",
  "slightly-underpowered": "A little underpowered",
  "just-right": "Perfect",
  comfortable: "Comfortable  ·  would use again",
  "slightly-overpowered": "A little powered up",
  "overpowered-rideable": "Overpowered but still manageable",
  "very-overpowered": "Very overpowered / hard to hold down",
  "too-small": "Too small  ·  underpowered",
  "too-big": "Too big  ·  overpowered or scary",
};

/** @param {SessionFeeling|string} feeling */
export function isHappyFeeling(feeling) {
  return feeling === "just-right" || feeling === "comfortable";
}

/** @param {SessionFeeling|string} feeling */
export function isUnderpoweredFeeling(feeling) {
  return [
    "couldnt-ride",
    "very-underpowered",
    "underpowered-rideable",
    "slightly-underpowered",
    "too-small",
  ].includes(feeling);
}

/** @param {SessionFeeling|string} feeling */
export function isOverpoweredFeeling(feeling) {
  return [
    "slightly-overpowered",
    "overpowered-rideable",
    "very-overpowered",
    "too-big",
  ].includes(feeling);
}

/** @param {SessionFeeling} feeling */
function feelingSizeDelta(feeling) {
  switch (feeling) {
    case "couldnt-ride":
      return 2;
    case "very-underpowered":
      return 1.5;
    case "underpowered-rideable":
    case "too-small":
      return 1;
    case "slightly-underpowered":
      return 0.5;
    case "just-right":
    case "comfortable":
      return 0;
    case "slightly-overpowered":
      return -0.5;
    case "overpowered-rideable":
      return -0.75;
    case "too-big":
      return -1;
    case "very-overpowered":
      return -1.5;
    default:
      return 0;
  }
}

/**
 * Infer the kite size the rider would have preferred from a session entry.
 * @param {CalibrationEntry} entry
 * @returns {number}
 */
export function inferPreferredSize(entry) {
  const delta = feelingSizeDelta(entry.feeling);
  return Math.round((entry.kiteSize + delta) * 2) / 2;
}

/**
 * @param {number} windSpeed
 * @param {CalibrationEntry[]} entries
 * @returns {{ preferredSize: number|null, confidence: 'none'|'low'|'medium'|'high', matchingEntries: CalibrationEntry[], summary: string|null }}
 */
export function getCalibrationAtWind(windSpeed, entries) {
  if (!entries.length) {
    return { preferredSize: null, confidence: "none", matchingEntries: [], summary: null };
  }

  const nearby = entries
    .map((entry) => ({
      entry,
      preferred: inferPreferredSize(entry),
      weight: Math.max(0.2, 1 - Math.abs(entry.windSpeed - windSpeed) / 6),
    }))
    .filter(({ entry, weight }) => weight > 0.15);

  if (!nearby.length) {
    return { preferredSize: null, confidence: "none", matchingEntries: [], summary: null };
  }

  const totalWeight = nearby.reduce((s, n) => s + n.weight, 0);
  let preferredSize =
    Math.round(
      (nearby.reduce((s, n) => s + n.preferred * n.weight, 0) / totalWeight) * 2
    ) / 2;

  const happyNearby = nearby.filter(({ entry }) => isHappyFeeling(entry.feeling));
  const minHappyWind = happyNearby.length
    ? Math.min(...happyNearby.map(({ entry }) => entry.windSpeed))
    : null;

  if (minHappyWind != null && windSpeed < minHappyWind - 3) {
    const ktGap = minHappyWind - windSpeed;
    const sizeBump = Math.min(4, Math.round((ktGap / 2) * 0.5 * 2) / 2);
    preferredSize = Math.round((preferredSize + sizeBump) * 2) / 2;
    const maxHappySize = Math.max(...happyNearby.map(({ entry }) => entry.kiteSize));
    const extrapolated = Math.round((maxHappySize + ktGap * 0.35) * 2) / 2;
    preferredSize = Math.max(preferredSize, extrapolated);
  }

  const closeMatches = entries.filter((e) => Math.abs(e.windSpeed - windSpeed) <= 3);
  let confidence = "low";
  if (closeMatches.length >= 3) confidence = "high";
  else if (closeMatches.length >= 1 || entries.length >= 4) confidence = "medium";

  const atWind = entries.filter((e) => Math.abs(e.windSpeed - windSpeed) <= 2);
  let summary = null;
  if (atWind.length) {
    const names = atWind
      .slice(0, 2)
      .map((e) => `${e.kiteSize}m (${FEELING_LABELS[e.feeling].toLowerCase()})`)
      .join(", ");
    summary = `You've logged ${atWind.length} session${atWind.length > 1 ? "s" : ""} near ${windSpeed} kt: ${names}.`;
  } else if (minHappyWind != null && windSpeed < minHappyWind - 3) {
    summary = `Your logs show happy sessions from ~${minHappyWind} kt upward — at ${windSpeed} kt aim closer to ~${preferredSize}m, not the sizes you used in stronger wind.`;
  } else {
    summary = `Based on ${entries.length} past session${entries.length > 1 ? "s" : ""}, your typical size near ${windSpeed} kt is ~${preferredSize}m.`;
  }

  return {
    preferredSize,
    confidence,
    matchingEntries: closeMatches.length ? closeMatches : nearby.map((n) => n.entry),
    summary,
  };
}

/**
 * Boost kite match score using calibration data.
 * @param {number} baseScore
 * @param {number} kiteSize
 * @param {number} windSpeed
 * @param {CalibrationEntry[]} entries
 */
export function applyCalibrationToScore(baseScore, kiteSize, windSpeed, entries) {
  const cal = getCalibrationAtWind(windSpeed, entries);
  if (cal.preferredSize == null) return { score: baseScore, calibration: cal };

  const minHappyWind = entries
    .filter((e) => isHappyFeeling(e.feeling))
    .reduce((m, e) => (m == null ? e.windSpeed : Math.min(m, e.windSpeed)), /** @type {number|null} */ (null));

  if (
    minHappyWind != null &&
    windSpeed < minHappyWind - 4 &&
    kiteSize <= cal.preferredSize - 1
  ) {
    const gap = minHappyWind - windSpeed;
    const penalty = Math.round(Math.min(35, gap * 4));
    return {
      score: Math.max(0, Math.round(baseScore - penalty)),
      calibration: cal,
    };
  }

  const sizeDiff = Math.abs(kiteSize - cal.preferredSize);
  const weight =
    cal.confidence === "high" ? 1 : cal.confidence === "medium" ? 0.75 : 0.45;
  const boost = Math.max(0, (30 - sizeDiff * 16) * weight);
  const penalty = sizeDiff >= 2 ? (sizeDiff - 1) * 12 * weight : sizeDiff >= 1 ? 4 * weight : 0;

  return {
    score: Math.round(Math.min(100, Math.max(0, baseScore + boost - penalty))),
    calibration: cal,
  };
}

/**
 * Adjust suitability score when calibration supports riding at this wind.
 * @param {number} score
 * @param {number} windSpeed
 * @param {CalibrationEntry[]} entries
 */
export function adjustSuitabilityWithCalibration(score, windSpeed, entries) {
  const positive = entries.filter(
    (e) => Math.abs(e.windSpeed - windSpeed) <= 3 && isHappyFeeling(e.feeling)
  );

  if (!positive.length) return { score, calibrationNote: null };

  let adjusted = score;
  if (score < 70) adjusted = Math.min(100, score + positive.length * 8);

  const sizes = positive.map((e) => `${e.kiteSize}m`).join(", ");
  const calibrationNote =
    positive.length === 1
      ? `Your calibration: at ~${positive[0].windSpeed} kt you were happy on ${sizes}.`
      : `Your calibration: you've had good sessions near ${windSpeed} kt on ${sizes}.`;

  return { score: adjusted, calibrationNote };
}

export { FEELING_LABELS };
