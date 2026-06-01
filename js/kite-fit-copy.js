/**
 * Rider-facing kite fit wording — no percentage scores in the UI.
 */

/** @param {number|null|undefined} score @param {string|null|undefined} [band] */
export function describeKiteFitShort(score, band = null) {
  if (band === "light") return "May feel underpowered in these conditions";
  if (band === "strong") return "Strong end of your comfort band";
  if (score == null || Number.isNaN(score)) return null;
  if (score < 40) return "Likely too small for this wind";
  if (score < 50) return "A little underpowered in these conditions";
  if (score < 58) return "Usable, but not your sweet spot";
  return null;
}

/**
 * @param {number} size
 * @param {number|null|undefined} score
 * @param {boolean} [inRange]
 */
export function describeQuiverGapAtSize(size, score, inRange = true) {
  if (score == null) {
    return `No ${size}m in your bag for the main ride window`;
  }
  if (score < 40) {
    return `Your ${size}m would likely feel very underpowered in the main ride window`;
  }
  if (score < 52 || !inRange) {
    return `Your ${size}m would feel a little underpowered in the main ride window — consider renting`;
  }
  return `Your ${size}m is a weak match in the main ride window — consider renting`;
}

/**
 * @param {import('./plan-hourly-kites.js').PlanHourKitePick} pick
 */
export function describeHourKiteFitNote(pick) {
  if (!pick.kiteName) return null;
  if (pick.fit === "marginal") return "may feel a little underpowered";
  if (pick.fit === "none") return "weak match for this hour";
  return null;
}
