/**
 * Wind speed marker on a kite's effective range band.
 */

import { formatKt } from "./format.js";

/**
 * @param {number} windSpeed
 * @param {{ min: number, max: number }} range
 */
export function renderWindBar(windSpeed, range) {
  const scaleMin = Math.max(0, range.min - 5);
  const scaleMax = range.max + 5;
  const span = scaleMax - scaleMin;
  return `
    <div class="wind-bar">
      <div class="wind-bar-range" style="left:${((range.min - scaleMin) / span) * 100}%;width:${((range.max - range.min) / span) * 100}%"></div>
      <div class="wind-bar-marker" style="left:${Math.min(100, Math.max(0, ((windSpeed - scaleMin) / span) * 100))}%"></div>
    </div>
    <div class="wind-bar-labels"><span>${formatKt(scaleMin)} kt</span><span>${formatKt(range.min)}-${formatKt(range.max)} kt</span><span>${formatKt(scaleMax)} kt</span></div>`;
}
