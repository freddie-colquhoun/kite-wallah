/**
 * User-facing copy helpers. No em dashes (U+2014) in UI text.
 */

const EM_DASH = /\s*\u2014\s*/g;
const EN_DASH = /\u2013/g;

/** @param {string} str */
export function cleanCopy(str) {
  if (!str) return str;
  return str
    .replace(EM_DASH, ". ")
    .replace(EN_DASH, "-")
    .replace(/\s+\./g, ".")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/** Missing / empty placeholder in lists */
export const EMPTY = "-";

/** @param {string} start @param {string} end */
export function formatHourRange(start, end) {
  return start === end ? start : `${start} to ${end}`;
}

/** @param {number} min @param {number} max @param {string} [unit] */
export function formatWindRange(min, max, unit = "kt") {
  return `${min}-${max} ${unit}`;
}
