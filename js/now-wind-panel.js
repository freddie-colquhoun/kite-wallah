import { formatKt } from "./format.js";
import { windDialHtml } from "./wind-arrow.js";
import { windHourStyle } from "./wind-colors.js";

/**
 * @typedef {import('./weather.js').WindHourSnapshot} WindHourSnapshot
 * @typedef {Object} NowWindSnapshot
 * @property {{ windSpeed: number, gustSpeed: number|null, windDirection: string, fetchedAt: string }} current
 * @property {WindHourSnapshot[]} outlook
 * @property {string} source
 * @property {string} [spotName]
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatHourLabel(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * @param {NowWindSnapshot|null} snapshot
 * @param {{ manualMode?: boolean, embedded?: boolean }} [opts]
 * @returns {string}
 */
export function buildNowWindHtml(snapshot, opts = {}) {
  if (!snapshot?.current) return "";

  const { current, outlook } = snapshot;
  const compact = Boolean(opts.compact);
  const spread =
    current.gustSpeed != null && current.gustSpeed > current.windSpeed
      ? current.gustSpeed - current.windSpeed
      : 0;

  const nowRow = `
    <div class="now-wind-now" style="${windHourStyle(current.windSpeed)}">
      <div class="now-wind-now-label">Now</div>
      ${windDialHtml(current.windDirection, false)}
      <div class="now-wind-now-speeds">
        <span class="now-wind-now-kt">${formatKt(current.windSpeed)}</span>
        <span class="now-wind-now-unit">kt</span>
        ${
          current.gustSpeed != null
            ? `<span class="now-wind-now-gust">gusts ${formatKt(current.gustSpeed)}</span>`
            : ""
        }
      </div>
      <span class="now-wind-now-dir">${escapeHtml(current.windDirection)}</span>
    </div>`;

  const outlookRows =
    outlook.length > 0
      ? outlook
          .map((h) => {
            const g =
              h.gustSpeed != null && h.gustSpeed > h.windSpeed
                ? `<span class="now-wind-cell-gust">${formatKt(h.gustSpeed)}</span>`
                : `<span class="now-wind-cell-gust now-wind-cell-gust--empty"> · </span>`;
            return `<div class="now-wind-hour" style="${windHourStyle(h.windSpeed)}">
              <span class="now-wind-hour-time">${formatHourLabel(h.time)}</span>
              ${windDialHtml(h.windDirection, false)}
              <span class="now-wind-hour-kt">${formatKt(h.windSpeed)}</span>
              ${g}
              <span class="now-wind-hour-dir">${escapeHtml(h.windDirection)}</span>
            </div>`;
          })
          .join("")
      : `<p class="hint hint-tight" style="margin:0">Hourly outlook not available.</p>`;

  const updatedAt = new Date(current.fetchedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const embeddedClass = opts.embedded ? " now-wind-panel--embedded" : "";
  const compactClass = compact ? " now-wind-panel--compact" : "";

  const headHtml = compact
    ? ""
    : `<div class="now-wind-panel-head">
          <h3 class="now-wind-panel-title">Live wind</h3>
          <p class="now-wind-panel-meta">${[
            `Updated ${updatedAt}`,
            spread >= 8 ? `Gust spread +${spread} kt` : null,
            opts.manualMode ? "Manual wind" : null,
          ]
            .filter(Boolean)
            .join(" · ")}</p>
        </div>`;

  const footHtml = compact
    ? `<p class="now-wind-updated hint hint-tight">Updated ${updatedAt}${spread >= 8 ? ` · gusty (+${spread} kt spread)` : ""}</p>`
    : "";

  return `
    <section class="now-wind-panel${embeddedClass}${compactClass}" aria-label="Wind now and next hours">
      <div class="now-wind-panel-inner">
        ${headHtml}
        <div class="now-wind-panel-body">
          ${nowRow}
          <div class="now-wind-outlook">
            <p class="now-wind-outlook-title">${compact ? "Next hours" : `Next ${outlook.length || 4} hours`}</p>
            <div class="now-wind-outlook-grid">${outlookRows}</div>
          </div>
        </div>
        ${footHtml}
      </div>
    </section>`;
}

/**
 * @param {NowWindSnapshot|null} snapshot
 * @param {{ manualMode?: boolean }} [opts]
 */
export function renderNowWindPanel(snapshot, opts = {}) {
  const el = document.getElementById("analyse-wind-slot");
  if (!el) return;
  if (!snapshot?.current) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = buildNowWindHtml(snapshot, { ...opts, embedded: false });
}

export function clearNowWindPanel() {
  const el = document.getElementById("analyse-wind-slot");
  if (el) {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

/**
 * Show live wind above results when user has fetched but not analysed yet.
 * @param {HTMLElement|null} container
 * @param {NowWindSnapshot|null} snapshot
 * @param {boolean} [manualMode]
 */
export function renderWindPreviewInResults(container, snapshot, manualMode = false) {
  if (!container) return;
  if (!snapshot?.current || manualMode) {
    if (!container.querySelector(".rider-result")) container.innerHTML = "";
    return;
  }
  container.innerHTML = buildNowWindHtml(snapshot, { embedded: true, compact: true });
}
