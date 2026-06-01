import {
  loadSpots,
  saveSpots,
  loadSettings,
  saveSettings,
  createEmptySpot,
  getSpot,
  TIDE_ACCESS_RULE_LABELS,
} from "./spots-storage.js";
import { searchLocations, fetchNowWindOutlook } from "./weather.js";
import { mountWindRosePair, getRoseDirections, setWindRoseSelections } from "./wind-rose.js";
import { renderWindPreviewInResults } from "./now-wind-panel.js";
import { formatCoord } from "./format.js";
import { initSpotMap, setSpotMapPosition, destroySpotMap, roundCoord } from "./spot-map.js";
import { fetchTides, findNearestNoaaStation } from "./tides.js";
import { evaluateSpot } from "./spot-engine.js";

/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */

let spots = loadSpots();
let settings = loadSettings();
/** @type {TideSummary|null} */
let lastTides = null;
let lastWindSource = null;

/** @type {import('./now-wind-panel.js').NowWindSnapshot|null} */
let lastNowWindSnapshot = null;
/** @type {(() => void)|null} */
let onSpotsChange = null;

/** @typedef {import('./tides.js').TideSummary} TideSummary */

export function getSpotsState() {
  return { spots, settings, lastTides, lastWindSource, lastNowWindSnapshot };
}

export function getNowWindSnapshot() {
  return lastNowWindSnapshot;
}

export function getActiveSpot() {
  return settings.activeSpotId ? getSpot(spots, settings.activeSpotId) : null;
}

export function setActiveSpotId(id) {
  settings.activeSpotId = id;
  saveSettings(settings);
}

/** @param {() => void} onChange */
export function initSpotsModule(onChange) {
  onSpotsChange = onChange;
  document.getElementById("add-spot-btn")?.addEventListener("click", () => {
    const s = createEmptySpot(`Spot ${spots.length + 1}`);
    spots.push(s);
    settings.activeSpotId = s.id;
    saveSpots(spots);
    saveSettings(settings);
    renderSpotNav();
    renderSpotEditor(onChange);
    onChange();
  });
}

export function renderSpotNav() {
  const list = document.getElementById("spot-nav-list");
  if (!list) return;
  list.innerHTML = spots
    .map(
      (s) => `
    <li><button type="button" class="profile-nav-btn ${s.id === settings.activeSpotId ? "active" : ""}" data-spot-id="${s.id}">
      ${escapeHtml(s.name)}<small>${formatCoord(s.lat)}, ${formatCoord(s.lon)}</small>
    </button></li>`
    )
    .join("");

  list.querySelectorAll("[data-spot-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.activeSpotId = btn.dataset.spotId;
      saveSettings(settings);
      renderSpotNav();
      renderSpotEditor(onSpotsChange ?? (() => {}));
      onSpotsChange?.();
    });
  });
}

/** Legacy no-op: Now tab uses per-spot cards instead of a dropdown. */
export function renderAnalyseSpotSelect() {}

/** @param {() => void} onChange */
export function renderSpotEditor(onChange) {
  const editor = document.getElementById("spot-editor");
  if (!editor) return;

  if (!spots.length) {
    editor.innerHTML = `<div class="card"><p class="hint">Add a spot to save GPS, launch directions, tides, and local knowledge.</p></div>`;
    return;
  }

  if (!settings.activeSpotId || !getSpot(spots, settings.activeSpotId)) {
    settings.activeSpotId = spots[0].id;
    saveSettings(settings);
  }

  const spot = getSpot(spots, settings.activeSpotId);
  if (!spot) return;

  editor.innerHTML = `
    <div class="card">
      <div class="profile-editor-header">
        <div class="field" style="flex:1;margin:0"><label>Spot name</label><input type="text" id="spot-name" value="${escapeHtml(spot.name)}" /></div>
        <button type="button" class="btn btn-danger btn-sm" id="delete-spot-btn">Delete</button>
      </div>
    </div>

    <div class="card profile-section">
      <h2>Location</h2>
      <p class="hint hint-tight">Search a spot, then drag the pin to your launch.</p>
      <div class="field"><label>Search spot</label>
        <input type="text" id="spot-search" placeholder="e.g. Portland Harbour, Hayling Island" autocomplete="off" />
        <div id="spot-search-results" class="search-results"></div>
      </div>
      <div id="spot-map" class="spot-map" aria-label="Map  ·  click or drag pin to set launch location"></div>
      <div class="field-row spot-coord-row">
        <div class="field"><label>Latitude</label><input type="number" id="spot-lat" step="0.000001" value="${spot.lat}" /></div>
        <div class="field"><label>Longitude</label><input type="number" id="spot-lon" step="0.000001" value="${spot.lon}" /></div>
      </div>
      <div class="spot-location-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="use-gps-btn">Use my GPS</button>
        <span class="hint map-accuracy-hint">Drag pin to your launch. UK wind ~2 km grid.</span>
      </div>
      <button type="button" class="btn btn-secondary" id="refresh-tides-btn">Refresh tides</button>
      <p class="hint hint-tight">Tides: NOAA (US) or Open-Meteo globally.</p>
      <div id="spot-tide-display" class="tide-banner">${lastTides?.summary ?? "Click refresh to load tides."}</div>
    </div>

    <div class="card profile-section">
      <h2>Launch & wind</h2>
      <div id="spot-wind-rose-mount"></div>
      <div class="field"><label>Launch notes</label><input type="text" id="spot-launch-notes" value="${escapeHtml(spot.launchNotes)}" placeholder="e.g. rig on grass, walk 200m" /></div>
    </div>

    <div class="card profile-section">
      <h2>Conditions</h2>
      <div class="field-row">
        <div class="field"><label>Default water</label>
          <select id="spot-water">${["flat", "choppy", "waves"].map((w) => `<option value="${w}" ${spot.waterType === w ? "selected" : ""}>${w}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Tide preference (soft)</label>
          <select id="spot-tide-pref">${["any", "mid", "high", "low"].map((t) => `<option value="${t}" ${spot.tidePreference === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Tide launch window</label>
          <select id="spot-tide-access">${Object.entries(TIDE_ACCESS_RULE_LABELS)
            .map(
              ([v, l]) =>
                `<option value="${v}" ${spot.tideAccessRule === v ? "selected" : ""}>${l}</option>`
            )
            .join("")}</select>
        </div>
        <div class="field"><label>Hours each side</label>
          <input type="number" id="spot-tide-window" min="1" max="6" step="1" value="${spot.tideWindowHours ?? 3}" />
        </div>
      </div>
      <p class="hint hint-tight">e.g. Hayling: only within 3h of low tide. Used in Plan forecast.</p>
      <div class="field"><label>Local knowledge</label>
        <textarea id="spot-local" rows="4" placeholder="e.g. Only ride 2h either side of high tide. Reef exposed below 1m.">${escapeHtml(spot.localKnowledge)}</textarea>
      </div>
      <button type="button" class="btn btn-primary" id="save-spot-btn">Save spot</button>
    </div>`;

  wireSpotEditor(spot, onChange);
  renderSpotNav();
}

/** @param {KiteSpot} spot @param {() => void} onChange */
function wireSpotEditor(spot, onChange) {
  let searchTimer;

  const roseMount = document.getElementById("spot-wind-rose-mount");
  if (roseMount) {
    mountWindRosePair(roseMount, {
      safe: spot.safeDirections,
      offshore: spot.offshoreDirections,
    });
  }

  const syncCoordsToInputs = (lat, lon) => {
    document.getElementById("spot-lat").value = roundCoord(lat);
    document.getElementById("spot-lon").value = roundCoord(lon);
  };

  initSpotMap("spot-map", spot.lat, spot.lon, syncCoordsToInputs, 15);

  const latInput = document.getElementById("spot-lat");
  const lonInput = document.getElementById("spot-lon");
  let coordTimer;
  const onCoordInput = () => {
    clearTimeout(coordTimer);
    coordTimer = setTimeout(() => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        setSpotMapPosition(lat, lon);
      }
    }, 400);
  };
  latInput?.addEventListener("input", onCoordInput);
  lonInput?.addEventListener("input", onCoordInput);

  document.getElementById("use-gps-btn")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("GPS not available in this browser.");
      return;
    }
    const btn = document.getElementById("use-gps-btn");
    btn.disabled = true;
    btn.textContent = "Getting location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        syncCoordsToInputs(pos.coords.latitude, pos.coords.longitude);
        setSpotMapPosition(pos.coords.latitude, pos.coords.longitude, 17);
        btn.disabled = false;
        btn.textContent = "Use my GPS";
      },
      (err) => {
        alert(err.message || "Could not get GPS location.");
        btn.disabled = false;
        btn.textContent = "Use my GPS";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  document.getElementById("spot-search")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById("spot-search-results").innerHTML = "";
      return;
    }
    searchTimer = setTimeout(async () => {
      const el = document.getElementById("spot-search-results");
      if (!el) return;
      el.innerHTML = `<p class="hint search-empty">Searching…</p>`;
      let results = [];
      try {
        results = await searchLocations(q);
      } catch (err) {
        console.warn("spot search", err);
        el.innerHTML = `<p class="hint search-empty">Search failed  ·  check connection or drag the map pin manually.</p>`;
        return;
      }
      if (!results.length) {
        el.innerHTML = `<p class="hint search-empty">No results  ·  try a nearby beach name or drag the map pin manually.</p>`;
        return;
      }
      el.innerHTML = results
        .map(
          (r, i) =>
            `<button type="button" class="search-result-btn" data-idx="${i}"><span class="search-result-badge search-badge-${r.source}">${escapeHtml(r.badge || r.source)}</span>${escapeHtml(r.label)}</button>`
        )
        .join("");
      el.querySelectorAll(".search-result-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const r = results[Number(btn.dataset.idx)];
          syncCoordsToInputs(r.lat, r.lon);
          document.getElementById("spot-name").value = r.name;
          setSpotMapPosition(r.lat, r.lon, r.source === "kitesurf" ? 16 : 14);
          if (r.defaults) applySpotDefaults(r.defaults);
          el.innerHTML = "";
          document.getElementById("spot-search").value = "";
        });
      });
    }, 450);
  });

  document.getElementById("save-spot-btn")?.addEventListener("click", () => {
    Object.assign(spot, readSpotForm(spot));
    saveSpots(spots);
    renderSpotNav();
    renderAnalyseSpotSelect();
    onChange();
  });

  document.getElementById("spot-name")?.addEventListener("change", (e) => {
    spot.name = e.target.value.trim() || spot.name;
    saveSpots(spots);
    renderSpotNav();
    renderAnalyseSpotSelect();
  });

  document.getElementById("delete-spot-btn")?.addEventListener("click", () => {
    if (!confirm(`Delete ${spot.name}?`)) return;
    spots = spots.filter((s) => s.id !== spot.id);
    saveSpots(spots);
    if (settings.activeSpotId === spot.id) {
      settings.activeSpotId = spots[0]?.id ?? null;
      saveSettings(settings);
    }
    renderSpotNav();
    renderSpotEditor(onChange);
    renderAnalyseSpotSelect();
    onChange();
  });

  document.getElementById("refresh-tides-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("refresh-tides-btn");
    const display = document.getElementById("spot-tide-display");
    btn.disabled = true;
    display.textContent = "Loading tides…";
    try {
      Object.assign(spot, readSpotForm(spot));
      const nearest = await findNearestNoaaStation(spot.lat, spot.lon);
      if (nearest && !spot.noaaStationId) spot.noaaStationId = nearest.id;
      lastTides = await fetchTides(spot.lat, spot.lon, {
        noaaStationId: spot.noaaStationId,
        tidePreference: spot.tidePreference,
      });
      display.textContent = lastTides.summary;
      saveSpots(spots);
    } catch (e) {
      display.textContent = e.message;
    }
    btn.disabled = false;
  });

}

function applySpotDefaults(defaults) {
  if (defaults.launchNotes) document.getElementById("spot-launch-notes").value = defaults.launchNotes;
  if (defaults.localKnowledge) document.getElementById("spot-local").value = defaults.localKnowledge;
  if (defaults.waterType) document.getElementById("spot-water").value = defaults.waterType;
  if (defaults.tideAccessRule) document.getElementById("spot-tide-access").value = defaults.tideAccessRule;
  if (defaults.tideWindowHours != null)
    document.getElementById("spot-tide-window").value = defaults.tideWindowHours;

  const roseMount = document.getElementById("spot-wind-rose-mount");
  if (roseMount && (defaults.safeDirections || defaults.offshoreDirections)) {
    setWindRoseSelections(
      roseMount,
      defaults.safeDirections || [],
      defaults.offshoreDirections || []
    );
  }
}

/** @param {KiteSpot} spot */
function readSpotForm(spot) {
  const roseMount = document.getElementById("spot-wind-rose-mount");
  const safe = roseMount ? getRoseDirections(roseMount, "safe") : [];
  const offshore = roseMount ? getRoseDirections(roseMount, "offshore") : [];
  return {
    ...spot,
    name: document.getElementById("spot-name").value.trim() || spot.name,
    lat: Number(document.getElementById("spot-lat").value),
    lon: Number(document.getElementById("spot-lon").value),
    safeDirections: safe.length ? safe : spot.safeDirections,
    offshoreDirections: offshore.length ? offshore : spot.offshoreDirections,
    launchNotes: document.getElementById("spot-launch-notes").value.trim(),
    waterType: document.getElementById("spot-water").value,
    tidePreference: document.getElementById("spot-tide-pref").value,
    tideAccessRule: document.getElementById("spot-tide-access").value,
    tideWindowHours: Number(document.getElementById("spot-tide-window").value) || 3,
    localKnowledge: document.getElementById("spot-local").value.trim(),
  };
}

/**
 * @param {KiteSpot} spot
 * @param {{ statusEl?: HTMLElement|null, previewEl?: HTMLElement|null, updateSharedForm?: boolean }} [opts]
 */
export async function fetchWindForSpot(spot, opts = {}) {
  const { statusEl, previewEl, updateSharedForm = false } = opts;

  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Fetching wind…";
  }

  const outlook = await fetchNowWindOutlook(spot.lat, spot.lon, 4);
  const wind = {
    ...outlook.current,
    source: outlook.source,
    lat: outlook.lat,
    lon: outlook.lon,
  };

  if (updateSharedForm) {
    const speedEl = document.getElementById("wind-speed");
    const gustEl = document.getElementById("gust-speed");
    const dirEl = document.getElementById("wind-direction");
    const waterEl = document.getElementById("water-type");
    if (speedEl) speedEl.value = String(wind.windSpeed);
    if (gustEl) gustEl.value = wind.gustSpeed ? String(wind.gustSpeed) : "";
    if (dirEl) dirEl.value = wind.windDirection;
    if (waterEl && spot.waterType) waterEl.value = spot.waterType;
  }

  lastWindSource = outlook.source;
  const snapshot = {
    current: outlook.current,
    outlook: outlook.outlook,
    source: outlook.source,
    spotName: spot.name,
  };
  lastNowWindSnapshot = snapshot;

  if (previewEl) {
    renderWindPreviewInResults(previewEl, snapshot, false);
  }

  const statusText = `${wind.windSpeed} kt ${wind.windDirection}${wind.gustSpeed ? `, gusting ${wind.gustSpeed}` : ""}`;
  if (statusEl) statusEl.textContent = statusText;

  return { spot, wind, snapshot, source: outlook.source };
}

/** @deprecated Use fetchWindForSpot with a spot from loadSpots */
export async function fetchWindForAnalyseSpot() {
  const sel = document.getElementById("analyse-spot");
  const spotId = sel?.value;
  if (!spotId) throw new Error("Select a spot first");
  const spot = getSpot(spots, spotId);
  if (!spot) throw new Error("Spot not found");
  const status = document.getElementById("wind-fetch-status");
  return fetchWindForSpot(spot, {
    statusEl: status,
    previewEl: document.getElementById("results-container"),
    updateSharedForm: true,
  });
}

export async function loadTidesForSpot(spot) {
  if (!spot) return null;
  lastTides = await fetchTides(spot.lat, spot.lon, {
    noaaStationId: spot.noaaStationId,
    tidePreference: spot.tidePreference,
  });
  return lastTides;
}

/** @param {KiteSpot|null} spot @param {{ windDirection: string, spotNotes?: string }} conditions */
export function buildSpotEval(spot, conditions) {
  if (!spot) return null;
  return evaluateSpot(spot, conditions, lastTides);
}

export function buildAnalysisContext(spot) {
  return {
    spot: spot ?? null,
    spotEval: null,
    tides: lastTides,
    windSource: lastWindSource,
  };
}

export function applySpotEvalToContext(ctx, conditions) {
  if (ctx.spot) ctx.spotEval = evaluateSpot(ctx.spot, conditions, ctx.tides);
  return ctx;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// re-export for mutation
export function reloadSpotsFromStorage() {
  spots = loadSpots();
  settings = loadSettings();
}

export { spots, settings };
