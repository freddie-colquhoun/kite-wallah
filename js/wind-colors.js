/**
 * Windfinder-style wind speed → colour scale (knots).
 * Stops every 2 kt; values between stops are interpolated.
 */

/** @type {[number, string][]} */
export const WIND_COLOR_STOPS = [
  [0, "#6b2d9e"],
  [2, "#303f9f"],
  [4, "#1565c0"],
  [6, "#1976d2"],
  [8, "#29b6f6"],
  [10, "#4fc3f7"],
  [12, "#26c6da"],
  [14, "#00acc1"],
  [16, "#26a69a"],
  [18, "#66bb6a"],
  [20, "#9ccc65"],
  [22, "#c0ca33"],
  [24, "#dce775"],
  [26, "#ffee58"],
  [28, "#ffc107"],
  [30, "#ffb74d"],
  [32, "#ff9800"],
  [34, "#f57c00"],
  [36, "#ff5722"],
  [38, "#f44336"],
  [40, "#e53935"],
  [42, "#c62828"],
  [44, "#b71c1c"],
  [46, "#880e4f"],
  [48, "#ad1457"],
  [50, "#e91e63"],
];

const MAX_KT = WIND_COLOR_STOPS[WIND_COLOR_STOPS.length - 1][0];

/** @param {string} hex */
function parseHex(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** @param {number} r @param {number} g @param {number} b */
function toHex(r, g, b) {
  const c = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** @param {string} a @param {string} b @param {number} t */
function lerpHex(a, b, t) {
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t
  );
}

/**
 * Background colour for a wind speed in knots.
 * @param {number} kt
 * @returns {string}
 */
export function windColorAtKnots(kt) {
  const k = Math.max(0, Math.min(MAX_KT, Number(kt) || 0));
  for (let i = 0; i < WIND_COLOR_STOPS.length - 1; i++) {
    const [k0, c0] = WIND_COLOR_STOPS[i];
    const [k1, c1] = WIND_COLOR_STOPS[i + 1];
    if (k <= k1) {
      const t = k1 === k0 ? 0 : (k - k0) / (k1 - k0);
      return lerpHex(c0, c1, t);
    }
  }
  return WIND_COLOR_STOPS[WIND_COLOR_STOPS.length - 1][1];
}

/** @param {string} hex */
export function windTextOnColor(hex) {
  const { r, g, b } = parseHex(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#14181f" : "#ffffff";
}

/**
 * Inline styles for a plan hour cell.
 * @param {number} kt
 * @returns {string}
 */
export function windHourStyle(kt) {
  const bg = windColorAtKnots(kt);
  return `background-color:${bg};color:#fff`;
}

/** CSS linear-gradient for legend bar (0 → max kt). */
export function windScaleGradientCss() {
  const stops = WIND_COLOR_STOPS.map(
    ([kt, hex]) => `${hex} ${(kt / MAX_KT) * 100}%`
  ).join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

/** Tick marks under the legend bar (knots). */
export const WIND_LEGEND_TICKS_KT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

/** HTML for positioned wind-speed labels aligned to the gradient. */
export function windLegendTicksHtml() {
  return WIND_LEGEND_TICKS_KT.map((kt) => {
    const pct = (kt / MAX_KT) * 100;
    const edge =
      kt === 0 ? " plan-wind-tick--start" : kt === MAX_KT ? " plan-wind-tick--end" : "";
    const label = kt === MAX_KT ? `${kt} kt` : String(kt);
    return `<span class="plan-wind-tick${edge}" style="left:${pct}%">${label}</span>`;
  }).join("");
}
