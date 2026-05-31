/**
 * @typedef {'too-small'|'just-right'|'comfortable'|'too-big'|'couldnt-ride'} SessionFeeling
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
  "too-small": "Too small  ·  underpowered",
  "just-right": "Just right",
  comfortable: "Comfortable  ·  would use again",
  "too-big": "Too big  ·  overpowered or scary",
  "couldnt-ride": "Couldn't get out / stay upwind",
};

/**
 * Infer the kite size the rider would have preferred from a session entry.
 * @param {CalibrationEntry} entry
 * @returns {number}
 */
function inferPreferredSize(entry) {
  switch (entry.feeling) {
    case "just-right":
    case "comfortable":
      return entry.kiteSize;
    case "too-big":
      return entry.kiteSize - 1;
    case "too-small":
      return entry.kiteSize + 1;
    case "couldnt-ride":
      return entry.kiteSize + 2;
    default:
      return entry.kiteSize;
  }
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
  const preferredSize =
    Math.round(
      (nearby.reduce((s, n) => s + n.preferred * n.weight, 0) / totalWeight) * 2
    ) / 2;

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
    (e) =>
      Math.abs(e.windSpeed - windSpeed) <= 3 &&
      (e.feeling === "just-right" || e.feeling === "comfortable")
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
