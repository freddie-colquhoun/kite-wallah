/**
 * Header live-data dashboard: crew sync + wind + tides freshness.
 */

import { getDataMode, getCloudIssue } from "./data-store.js";

/** @typedef {'live'|'local'|'error'|'off'|'stale'|'saving'} LiveChipState */

const WIND_FRESH_MS = 45 * 60 * 1000;
const TIDE_FRESH_MS = 3 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

/** @type {{ at: number|null, detail: string|null, source: string|null }} */
let wind = { at: null, detail: null, source: null };

/** @type {{ at: number|null, detail: string|null, source: string|null }} */
let tides = { at: null, detail: null, source: null };

/** @returns {LiveChipState} */
function crewChipState() {
  const issue = getCloudIssue();
  if (issue === "save_failed") return "saving";
  if (issue === "load_failed") return "error";
  if (getDataMode() === "cloud") return "live";
  return "local";
}

/** @param {number|null} at @param {number} maxAgeMs */
function freshnessState(at, maxAgeMs) {
  if (at == null) return /** @type {LiveChipState} */ ("off");
  if (Date.now() - at <= maxAgeMs) return "live";
  return "stale";
}

/** @param {LiveChipState} state */
function chipTitle(state, label, detail) {
  const base = {
    live: `${label} — live and up to date`,
    local: `${label} — saved on this device only (not shared)`,
    error: `${label} — could not reach shared data`,
    saving: `${label} — save to shared data failed`,
    off: `${label} — not loaded yet`,
    stale: `${label} — data is getting old; refresh when you can`,
  };
  const t = base[state] ?? label;
  return detail ? `${t}. ${detail}` : t;
}

/**
 * @param {string} label
 * @param {LiveChipState} state
 * @param {string} [detail]
 */
function chipHtml(label, state, detail = "") {
  const title = chipTitle(state, label, detail || null);
  const detailHtml = detail
    ? `<span class="live-status-chip-detail">${escapeAttr(detail)}</span>`
    : "";
  return `<span class="live-status-chip live-status-chip--${state}" role="status" title="${escapeAttr(title)}">
    <span class="live-status-dot" aria-hidden="true"></span>
    <span class="live-status-chip-label">${escapeAttr(label)}</span>
    ${detailHtml}
  </span>`;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAge(at) {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function crewDetail() {
  const s = crewChipState();
  if (s === "live") return "Cloud sync";
  if (s === "local") return "This device";
  if (s === "error") return "Retry in banner";
  if (s === "saving") return "Check connection";
  return "";
}

function renderBar() {
  const el = document.getElementById("live-status-bar");
  if (!el) return;

  const crew = crewChipState();
  const crewD = crewDetail();
  const windState = freshnessState(wind.at, WIND_FRESH_MS);
  const tideState = freshnessState(tides.at, TIDE_FRESH_MS);

  const windDetail =
    wind.at != null
      ? `${formatAge(wind.at)}${wind.source ? ` · ${wind.source}` : ""}`
      : "Fetch wind on Spots or Now";
  const tideDetail =
    tides.at != null
      ? `${formatAge(tides.at)}${tides.source ? ` · ${tides.source}` : ""}`
      : "Refresh tides on Spots";

  el.innerHTML = `<div class="live-status-inner" aria-label="Live data status">
    <span class="live-status-group" aria-label="Crew data">
      ${chipHtml("Riders", crew, crewD)}
      ${chipHtml("Quiver", crew, crewD)}
      ${chipHtml("Sessions", crew, crewD)}
    </span>
    <span class="live-status-divider" aria-hidden="true"></span>
    <span class="live-status-group" aria-label="Conditions data">
      ${chipHtml("Wind", windState, windDetail)}
      ${chipHtml("Tides", tideState, tideDetail)}
    </span>
  </div>`;

  const legacy = document.getElementById("sync-status");
  if (legacy) {
    legacy.classList.add("sr-only");
    legacy.textContent = "";
  }
}

/** @param {string|null} [source] @param {string|null} [fetchedAtIso] */
export function markWindFetched(source = null, fetchedAtIso = null) {
  wind = {
    at: fetchedAtIso ? new Date(fetchedAtIso).getTime() : Date.now(),
    detail: null,
    source: source ?? null,
  };
  renderBar();
}

/** @param {string|null} [source] */
export function markTidesFetched(source = null) {
  tides = {
    at: Date.now(),
    detail: null,
    source: source ?? null,
  };
  renderBar();
}

export function refreshLiveStatusBar() {
  renderBar();
}

let tickTimer = null;

export function initLiveStatus() {
  renderBar();
  window.addEventListener("crew-data-updated", refreshLiveStatusBar);
  window.addEventListener("live-status-refresh", refreshLiveStatusBar);
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(renderBar, TICK_MS);
}
