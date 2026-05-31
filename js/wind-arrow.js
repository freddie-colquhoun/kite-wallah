/** Wind “from” → degrees to rotate arrow (wind blows toward opposite bearing). */
export const WIND_BLOW_TO_DEG = {
  N: 180,
  NE: 225,
  E: 270,
  SE: 315,
  S: 0,
  SW: 45,
  W: 90,
  NW: 135,
};

/**
 * Arrow SVG pointing up; rotate parent with --wind-to (direction wind blows).
 * @param {number} [size]
 */
export function windArrowSvg(size = 12) {
  return `<svg class="wind-arrow-icon" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <path d="M8 3 L8 13 M8 3 L5.5 7.5 M8 3 L10.5 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** @param {string} windFrom */
export function windBlowToDeg(windFrom) {
  return WIND_BLOW_TO_DEG[windFrom?.toUpperCase()] ?? 0;
}

/**
 * Compact wind dial for plan hour cells (arrow = direction wind blows toward sea/shore).
 * @param {string} windFrom e.g. SW
 * @param {boolean} [isOffshore]
 */
export function windDialHtml(windFrom, isOffshore = false) {
  const deg = windBlowToDeg(windFrom);
  const off = isOffshore ? " plan-hour-dial--offshore" : "";
  return `<div class="plan-hour-dial${off}" style="--wind-to:${deg}deg" title="Wind toward ${windFrom} (from ${windFrom})">
    <span class="plan-dial-shore" aria-hidden="true"></span>
    ${windArrowSvg(12)}
  </div>`;
}
