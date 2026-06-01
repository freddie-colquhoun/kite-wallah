/**
 * Now tab: ad-hoc location + one card per saved spot (wind, tide/launch, rider verdicts).
 */

import { loadSpots, getSpot } from "./spots-storage.js";
import { listKitesurfLocations } from "./location-search.js";
import { fetchWindForSpot, loadTidesForSpot, getSpotsState } from "./spots-ui.js";
import { COMPASS } from "./spots-storage.js";
import { renderWindPreviewInResults } from "./now-wind-panel.js";
import { evaluateSpot, assessTideLaunchWindow, hasTideLaunchRule } from "./spot-engine.js";
import { formatRidersMissingSexMessage } from "./storage.js";

/** @typedef {import('./location-search.js').SearchResult} SearchResult */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */
/** @typedef {import('./now-wind-panel.js').NowWindSnapshot} NowWindSnapshot */
/** @typedef {import('./tides.js').TideSummary} TideSummary */

/** @type {AdhocLocation|null} */
let adhocLocation = null;

/** @type {Map<string, NowWindSnapshot>} */
const spotWindById = new Map();

/** @type {Map<string, TideSummary|null>} */
const spotTidesById = new Map();

/** @type {NowWindSnapshot|null} */
let adhocWindSnapshot = null;

/** @type {NowTabHandlers|null} */
let nowHandlers = null;

/** @typedef {Object} AdhocLocation
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string} label
 * @property {SearchResult['defaults']} [defaults]
 */

/** @type {SearchResult[]} */
let adhocCatalogOptions = [];

/** @typedef {Object} NowTabHandlers
 * @property {() => import('./storage.js').AppState} getState
 * @property {() => string[]} getSelectedProfileIds
 * @property {(form: { wind: number, gust: number|null, direction: string, water: string, spotNotes: string }, profileIds: string[], opts: { container: HTMLElement, spot: KiteSpot|null, windSnap: NowWindSnapshot|null }) => void} renderAnalyseResults
 * @property {(spot: KiteSpot|null) => void} updateTideBanner
 * @property {(str: string) => string} escapeHtml
 */

/** @param {NowTabHandlers} handlers */
export function initNowTab(handlers) {
  nowHandlers = handlers;
  wireAdhocSearch(handlers);
  wireAdhocAnalyse(handlers);
  refreshNowSpotsList(handlers);
}

/** Re-run rider verdicts on every visible spot card (rider selection changed). */
export function rerunNowSpotAnalyses() {
  if (!nowHandlers) return;
  const spots = loadSpots();
  spots.forEach((spot) => {
    if (spotWindById.has(spot.id)) runSpotAnalyse(spot, nowHandlers);
  });
}

/** Re-run ad-hoc location results when riders change. */
export function rerunAdhocAnalyse() {
  if (!nowHandlers) return;
  runAdhocAnalyse(nowHandlers);
}

/** @param {NowTabHandlers} handlers */
export function refreshNowSpotsList(handlers) {
  nowHandlers = handlers;
  const list = document.getElementById("now-spots-list");
  const section = document.getElementById("now-spots-section");
  if (!list || !section) return;

  const spots = loadSpots();
  if (!spots.length) {
    section.hidden = true;
    list.innerHTML = "";
    return;
  }

  section.hidden = false;
  list.innerHTML = spots
    .map(
      (spot) => `
    <article class="now-spot-card card card-slim" data-spot-id="${spot.id}">
      <header class="now-spot-card-head">
        <h3 class="now-spot-card-title">${handlers.escapeHtml(spot.name)}</h3>
        <p class="now-spot-summary" data-now-summary="${spot.id}">Loading wind and tides…</p>
      </header>
      <div class="now-spot-wind-preview" data-now-preview="${spot.id}"></div>
      <div id="now-spot-results-${spot.id}" class="now-spot-results results-stack" aria-live="polite"></div>
    </article>`
    )
    .join("");

  spots.forEach((spot) => loadSpotCard(spot, handlers));
  populateAdhocLocationSelect(handlers);
}

export function getAdhocLocation() {
  return adhocLocation;
}

export function getAdhocWindSnapshot() {
  return adhocWindSnapshot;
}

export function getSpotWindSnapshot(spotId) {
  return spotWindById.get(spotId) ?? null;
}

/**
 * @param {KiteSpot} spot
 * @param {NowWindSnapshot|null} snap
 * @param {TideSummary|null} tides
 * @param {(s: string) => string} escapeHtml
 */
function buildSpotSummaryHtml(spot, snap, tides, escapeHtml) {
  const parts = [];

  if (tides?.summary && tides.source !== "none") {
    parts.push(escapeHtml(tides.summary));
  } else if (hasTideLaunchRule(spot)) {
    parts.push("Tide data loading…");
  }

  const cur = snap?.current;
  if (cur) {
    const conditions = {
      windDirection: cur.windDirection,
      spotNotes: spot.localKnowledge || "",
    };
    const eval_ = evaluateSpot(spot, conditions, tides);
    if (!eval_.launchOk) {
      parts.push(`<strong class="now-spot-warn">Launch not advised</strong> (${escapeHtml(cur.windDirection)} outside safe sectors)`);
    } else if (eval_.windOffshore) {
      parts.push(`<strong class="now-spot-warn">Offshore</strong> (${escapeHtml(cur.windDirection)})`);
    } else {
      parts.push(`Launch OK · ${escapeHtml(cur.windDirection)}`);
    }

    if (hasTideLaunchRule(spot) && tides?.predictions?.length) {
      const tideLaunch = assessTideLaunchWindow(spot, new Date().toISOString(), tides.predictions);
      if (tideLaunch.tideLaunchRuleActive) {
        if (tideLaunch.tideAccessOk) {
          parts.push("Inside your tide launch window");
        } else {
          parts.push(
            `<strong class="now-spot-warn">Outside tide launch window</strong>${tideLaunch.tideLaunchNote ? ` · ${escapeHtml(tideLaunch.tideLaunchNote)}` : ""}`
          );
        }
      }
    }
  }

  return parts.length ? parts.join(" · ") : "Wind loading…";
}

/** @param {KiteSpot} spot @param {NowTabHandlers} handlers */
async function loadSpotCard(spot, handlers) {
  const summaryEl = document.querySelector(`[data-now-summary="${spot.id}"]`);
  const preview = document.querySelector(`[data-now-preview="${spot.id}"]`);

  try {
    if (summaryEl) summaryEl.textContent = "Loading wind and tides…";

    await loadTidesForSpot(spot).catch(() => {});
    const tides = getSpotsState().lastTides;
    spotTidesById.set(spot.id, tides);

    const { snapshot } = await fetchWindForSpot(spot, { previewEl: preview });
    spotWindById.set(spot.id, snapshot);

    if (summaryEl) {
      summaryEl.innerHTML = buildSpotSummaryHtml(spot, snapshot, tides, handlers.escapeHtml);
    }
    runSpotAnalyse(spot, handlers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (summaryEl) summaryEl.textContent = msg;
  }
}

/** @param {KiteSpot} spot @param {NowTabHandlers} handlers */
function runSpotAnalyse(spot, handlers) {
  const container = document.getElementById(`now-spot-results-${spot.id}`);
  if (!container) return;

  const ids = handlers.getSelectedProfileIds();
  if (!ids.length) {
    container.innerHTML =
      '<p class="hint hint-tight now-spot-rider-hint">Select riders above to see GO / kite / board.</p>';
    return;
  }

  const state = handlers.getState();
  const sexMsg = formatRidersMissingSexMessage(state, ids);
  if (sexMsg) {
    container.innerHTML = `<p class="hint hint-tight now-spot-rider-hint">${handlers.escapeHtml(sexMsg)}</p>`;
    return;
  }

  const snap = spotWindById.get(spot.id) ?? null;
  if (!snap?.current) {
    container.innerHTML = '<p class="hint hint-tight">Wind not loaded yet.</p>';
    return;
  }

  handlers.updateTideBanner(spot);
  const form = windFormFromSnapshot(snap, spot);
  handlers.renderAnalyseResults(form, ids, {
    container,
    spot,
    windSnap: snap,
  });
}

function normalizeSpotName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {NowTabHandlers} handlers */
async function populateAdhocLocationSelect(handlers) {
  const select = document.getElementById("now-location-select");
  if (!select) return;

  const savedKeys = new Set(loadSpots().map((s) => normalizeSpotName(s.name)));
  const prev = select.value;

  try {
    const all = await listKitesurfLocations();
    adhocCatalogOptions = all.filter((o) => !savedKeys.has(normalizeSpotName(o.name)));
  } catch (err) {
    console.warn("kitesurf catalog", err);
    adhocCatalogOptions = [];
  }

  select.innerHTML =
    `<option value="">Choose a location…</option>` +
    adhocCatalogOptions
      .map(
        (o, i) =>
          `<option value="${i}">${handlers.escapeHtml(o.label)}</option>`
      )
      .join("");

  if (prev && adhocLocation) {
    const idx = adhocCatalogOptions.findIndex(
      (o) => o.lat === adhocLocation.lat && o.lon === adhocLocation.lon
    );
    if (idx >= 0) select.value = String(idx);
  }
}

/** @param {NowTabHandlers} handlers */
function wireAdhocSearch(handlers) {
  const select = document.getElementById("now-location-select");
  if (!select) return;

  populateAdhocLocationSelect(handlers);

  select.addEventListener("change", () => {
    const idx = select.value;
    if (idx === "") {
      clearAdhocLocation();
      return;
    }
    const r = adhocCatalogOptions[Number(idx)];
    if (r) pickAdhocLocation(r, handlers);
  });

  document.getElementById("now-adhoc-clear")?.addEventListener("click", () => {
    clearAdhocLocation();
    select.value = "";
  });
}

function clearAdhocLocation() {
  adhocLocation = null;
  adhocWindSnapshot = null;
  const preview = document.getElementById("now-adhoc-wind-preview");
  if (preview) preview.innerHTML = "";
  const status = document.getElementById("now-adhoc-wind-status");
  if (status) {
    status.classList.add("hidden");
    status.textContent = "";
  }
  const results = document.getElementById("now-adhoc-results");
  if (results) results.innerHTML = "";
}

/** @param {SearchResult} r @param {NowTabHandlers} handlers */
async function pickAdhocLocation(r, handlers) {
  adhocLocation = {
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    label: r.label,
    defaults: r.defaults,
  };

  const manual = document.getElementById("wind-manual-mode")?.checked === true;
  if (!manual) {
    await refreshAdhocWind(handlers);
    runAdhocAnalyse(handlers);
  }
}

/** @param {NowTabHandlers} handlers */
async function refreshAdhocWind(handlers) {
  if (!adhocLocation) return;
  const status = document.getElementById("now-adhoc-wind-status");
  const preview = document.getElementById("now-adhoc-wind-preview");
  const tempSpot = adhocSpotFromLocation(adhocLocation);

  try {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Fetching wind…";
    }
    const { snapshot } = await fetchWindForSpot(tempSpot, {
      statusEl: status,
      previewEl: preview,
      updateSharedForm: true,
    });
    adhocWindSnapshot = snapshot;
    await loadTidesForSpot(tempSpot).catch(() => {});
    handlers.updateTideBanner(tempSpot);
  } catch (e) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  }
}

/** @param {AdhocLocation} loc */
function adhocSpotFromLocation(loc) {
  const d = loc.defaults ?? {};
  const waterEl = document.getElementById("water-type");
  if (d.waterType && waterEl) waterEl.value = d.waterType;

  return {
    id: "adhoc",
    name: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    waterType: d.waterType || waterEl?.value || "choppy",
    safeDirections: d.safeDirections?.length ? d.safeDirections : [...COMPASS],
    offshoreDirections: d.offshoreDirections ?? [],
    launchNotes: d.launchNotes ?? "",
    localKnowledge: d.localKnowledge ?? "",
    tidePreference: "any",
    tideAccessRule: d.tideAccessRule ?? "any",
    tideWindowHours: d.tideWindowHours ?? 3,
    noaaStationId: null,
  };
}

/** @param {NowTabHandlers} handlers */
function runAdhocAnalyse(handlers) {
  const container = document.getElementById("now-adhoc-results");
  if (!container) return;

  const ids = handlers.getSelectedProfileIds();
  if (!ids.length) {
    container.innerHTML =
      '<p class="hint hint-tight">Select riders above to see GO / kite / board.</p>';
    return;
  }

  const state = handlers.getState();
  const sexMsg = formatRidersMissingSexMessage(state, ids);
  if (sexMsg) {
    container.innerHTML = `<p class="hint hint-tight">${handlers.escapeHtml(sexMsg)}</p>`;
    return;
  }

  const manual = document.getElementById("wind-manual-mode")?.checked === true;
  let spot = null;
  let snap = null;

  if (adhocLocation) {
    spot = adhocSpotFromLocation(adhocLocation);
    if (!manual) snap = adhocWindSnapshot;
  } else if (!manual) {
    return;
  }

  const form = getAdhocConditionsFromForm();
  handlers.renderAnalyseResults(form, ids, {
    container,
    spot,
    windSnap: manual ? null : snap,
  });
}

/** @param {NowTabHandlers} handlers */
function wireAdhocAnalyse(handlers) {
  document.getElementById("now-adhoc-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const manual = document.getElementById("wind-manual-mode")?.checked === true;
    if (adhocLocation && !manual && !adhocWindSnapshot) {
      await refreshAdhocWind(handlers);
    }
    runAdhocAnalyse(handlers);
    document.getElementById("now-adhoc-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  document.getElementById("wind-manual-mode")?.addEventListener("change", () => {
    const manual = document.getElementById("wind-manual-mode")?.checked === true;
    const status = document.getElementById("now-adhoc-wind-status");
    if (manual && status) {
      status.classList.remove("hidden");
      status.textContent = "Manual wind: enter speed, gusts, and direction below.";
    } else if (adhocLocation) {
      refreshAdhocWind(handlers).then(() => runAdhocAnalyse(handlers));
    }
  });
}

function getAdhocConditionsFromForm() {
  const gustRaw = document.getElementById("gust-speed")?.value;
  return {
    wind: Number(document.getElementById("wind-speed")?.value),
    gust: gustRaw ? Number(gustRaw) : null,
    direction: document.getElementById("wind-direction")?.value,
    water: document.getElementById("water-type")?.value,
    spotNotes: document.getElementById("spot-notes")?.value.trim() || "",
  };
}

/** @param {NowWindSnapshot|null} snap @param {KiteSpot} spot */
function windFormFromSnapshot(snap, spot) {
  const cur = snap?.current;
  return {
    wind: cur?.windSpeed ?? Number(document.getElementById("wind-speed")?.value),
    gust: cur?.gustSpeed ?? null,
    direction: cur?.windDirection ?? document.getElementById("wind-direction")?.value,
    water: spot.waterType,
    spotNotes: [document.getElementById("spot-notes")?.value.trim(), spot.localKnowledge]
      .filter(Boolean)
      .join(". "),
  };
}
