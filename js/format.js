/** Format numbers for display  ·  max one decimal place. */
export function formatNum(value, decimals = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const n = Number(value);
  const d = Math.max(0, Math.min(1, decimals));
  const factor = 10 ** d;
  return String(Math.round(n * factor) / factor);
}

/** Lat/lon for UI (1 decimal ≈ 11 km). */
export function formatCoord(value) {
  return formatNum(value, 1);
}

/** Wind speed in knots  ·  whole numbers. */
export function formatKt(value) {
  return formatNum(value, 0);
}
