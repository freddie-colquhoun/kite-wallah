/**
 * Header status: Live weather data (wind + tides) and Live user data (crew sync).
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

/** @param {LiveChipState[]} states */
function worstState(states) {
  const rank = { error: 0, saving: 1, off: 2, stale: 3, local: 4, live: 5 };
  return states.reduce((a, b) => (rank[a] < rank[b] ? a : b));
}

/** @returns {LiveChipState} */
function weatherChipState() {
  const windS = freshnessState(wind.at, WIND_FRESH_MS);
  const tideS = freshnessState(tides.at, TIDE_FRESH_MS);
  if (wind.at == null && tides.at == null) return "off";
  return worstState([windS, tideS]);
}

function formatAge(at) {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function weatherDetail() {
  const parts = [];
  if (wind.at != null) {
    parts.push(`Wind ${formatAge(wind.at)}`);
  }
  if (tides.at != null) {
    parts.push(`Tides ${formatAge(tides.at)}`);
  }
  if (!parts.length) return "Open Spots or Now to load";
  return parts.join(" · ");
}

function crewDetail() {
  const s = crewChipState();
  if (s === "live") return "Synced for all riders";
  if (s === "local") return "This device only";
  if (s === "error") return "Could not load shared data";
  if (s === "saving") return "Save failed — retry";
  return "";
}

/** @param {LiveChipState} state @param {string} label @param {string} detail */
function pillTitle(state, label, detail) {
  const base = {
    live: `${label} is up to date`,
    local: `${label} is on this device only`,
    error: `${label} could not sync`,
    saving: `${label} could not save`,
    off: `${label} not loaded yet`,
    stale: `${label} may be out of date`,
  };
  const t = base[state] ?? label;
  return detail ? `${t}. ${detail}` : t;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} label
 * @param {LiveChipState} state
 * @param {string} detail
 */
function pillHtml(label, state, detail) {
  const title = pillTitle(state, label, detail);
  return `<span class="live-pill live-pill--${state}" role="status" title="${escapeAttr(title)}">
    <span class="live-pill-dot" aria-hidden="true"></span>
    <span class="live-pill-label">${escapeAttr(label)}</span>
  </span>`;
}

function renderBar() {
  const el = document.getElementById("live-status-bar");
  if (!el) return;

  const weatherState = weatherChipState();
  const crewState = crewChipState();

  el.innerHTML = `<div class="live-status-inner" aria-label="Connection status">
    ${pillHtml("Live weather data", weatherState, weatherDetail())}
    ${pillHtml("Live user data", crewState, crewDetail())}
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
