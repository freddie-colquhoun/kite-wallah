import { createId } from "./ids.js";
import { FEELING_LABELS } from "./calibration.js";
import { getSpot, loadSpots, COMPASS } from "./spots-storage.js";
import { getProfile, isRiderSexSet, syncRiderGearIdsFromSessions } from "./storage.js";
import {
  getRiderKites,
  getRiderBoards,
  formatKiteCanonicalName,
  formatKiteSessionOptionLabel,
} from "./quiver-storage.js";
import {
  buildSessionIso,
  formatSessionDateTimeLine,
  sessionStartIso,
} from "./session-helpers.js";
import { refreshPlanCompareSelect } from "./planner-ui.js";

/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

/** @type {string|null} */
let editingSessionId = null;

/** @type {AppState|null} */
let appState = null;

/** @type {(profile: RiderProfile) => void} */
let onPersist = () => {};

/** @type {(str: string) => string} */
let escapeHtml = (s) => s;

const FEELING_TAG_CLASS = {
  "just-right": "good",
  comfortable: "good",
  "too-small": "warn",
  "too-big": "warn",
  "couldnt-ride": "bad",
};

/**
 * @param {object} hooks
 * @param {() => AppState} hooks.getState
 * @param {(profile: RiderProfile) => void} hooks.persistProfile
 * @param {(str: string) => string} hooks.escapeHtml
 */
export function initSessionsModule(hooks) {
  appState = null;
  const getState = hooks.getState;
  onPersist = hooks.persistProfile;
  escapeHtml = hooks.escapeHtml;

  document.getElementById("sessions-profile-select")?.addEventListener("change", (e) => {
    const state = getState();
    const id = /** @type {HTMLSelectElement} */ (e.target).value;
    if (id) {
      state.activeProfileId = id;
      hooks.onActiveProfileChange?.(id);
    }
    renderSessionsPanel(getState());
  });

  const main = document.getElementById("sessions-main");
  main?.addEventListener("submit", (e) => {
    const form = /** @type {HTMLFormElement|null} */ (e.target);
    if (form?.id === "sessions-form") {
      e.preventDefault();
      handleSessionSubmit(getState());
      return;
    }
    if (form?.id === "sessions-edit-form") {
      e.preventDefault();
      handleSessionEditSubmit(getState());
    }
  });

  main?.addEventListener("click", (e) => {
    const editBtn = /** @type {HTMLElement|null} */ (e.target)?.closest?.("[data-edit-sess]");
    if (editBtn) {
      openSessionEditor(getState(), editBtn.getAttribute("data-edit-sess"));
      return;
    }
    const rmBtn = /** @type {HTMLElement|null} */ (e.target)?.closest?.("[data-rm-sess]");
    if (rmBtn) {
      removeSession(getState(), rmBtn.getAttribute("data-rm-sess"));
      return;
    }
    if (/** @type {HTMLElement|null} */ (e.target)?.id === "sessions-editor-close") {
      closeSessionEditor();
    }
  });
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** @param {string|null|undefined} iso */
function isoToDateAndTime(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: d.toISOString().slice(0, 10),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
}

/** @param {CalibrationEntry} entry @param {import('./engine.js').Kite[]} kites */
function entryKiteSelectValue(entry, kites) {
  if (entry.kiteId && kites.some((k) => k.id === entry.kiteId)) return entry.kiteId;
  if (entry.kiteName && /^\d+(\.\d+)?m$/i.test(String(entry.kiteName).trim())) return "size-only";
  if (!entry.kiteId && entry.kiteName) return "rented";
  return "";
}

/** @param {AppState} state */
export function renderSessionsPanel(state) {
  appState = state;
  const sel = document.getElementById("sessions-profile-select");
  const main = document.getElementById("sessions-main");
  if (!sel || !main) return;

  sel.innerHTML = state.profiles
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === state.activeProfileId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
    )
    .join("");

  const profile = getProfile(state, state.activeProfileId);
  if (!profile) {
    main.innerHTML = `<p class="hint">Add a rider under Riders first.</p>`;
    return;
  }

  main.innerHTML = `
    <div class="card profile-section">
      <h2>Log a session  ·  ${escapeHtml(profile.name)}</h2>
      <p class="hint hint-tight">Pick a kite from the shared Quiver, or log a rented / other kite. Plan/Now score every brand in the quiver; logs on a quiver kite count fully, same-size logs on other kites are a light hint only.</p>
      <form id="sessions-form">
        <div class="field-row field-row-tight">
          <div class="field"><label>Date</label><input type="date" id="sess-date" required /></div>
          <div class="field"><label>Start</label><input type="time" id="sess-start" required /></div>
          <div class="field"><label>End</label><input type="time" id="sess-end" /></div>
        </div>
        <div class="field-row field-row-tight">
          <div class="field"><label>Spot</label><select id="sess-spot"><option value="">No spot</option></select></div>
          <div class="field"><label>Water (general)</label>
            <select id="sess-water">
              <option value="flat">Flat</option>
              <option value="choppy" selected>Choppy</option>
              <option value="waves">Waves</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="sess-water-look">Water look &amp; feel</label>
          <input type="text" id="sess-water-look" list="sess-water-look-suggestions" placeholder="e.g. glassy, no white horses, head-high sets, messy shore break" />
          <datalist id="sess-water-look-suggestions">
            <option value="Glassy / flat"></option>
            <option value="Small chop, no white horses"></option>
            <option value="White horses, building swell"></option>
            <option value="Head-high waves, clean faces"></option>
            <option value="Big messy waves, lots of white water"></option>
            <option value="Shore dump / dangerous shore break"></option>
          </datalist>
        </div>
        <div class="field-row field-row-tight field-row--4">
          <div class="field"><label>Wind (kt)</label><input type="number" id="sess-wind" min="8" max="45" required placeholder="18" /></div>
          <div class="field"><label>Gusts (kt)</label><input type="number" id="sess-gust" min="8" max="55" placeholder=" · " /></div>
          <div class="field"><label>Direction</label>
            <select id="sess-direction">${COMPASS.map((d) => `<option value="${d}">${d}</option>`).join("")}</select>
          </div>
          <div class="field field-kite-select"><label>Kite</label><select id="sess-kite"><option value="">Choose kite…</option></select></div>
        </div>
        <div id="sess-rented-wrap" class="field-row field-row-tight hidden" hidden>
          <div class="field"><label>Brand</label><input type="text" id="sess-rented-brand" placeholder="e.g. Duotone" autocomplete="off" /></div>
          <div class="field"><label>Model</label><input type="text" id="sess-rented-model" placeholder="e.g. Evo" autocomplete="off" /></div>
          <div class="field"><label>Size (m²)</label><input type="number" id="sess-rented-size" min="3" max="21" step="0.5" /></div>
        </div>
        <div class="field hidden" id="sess-size-only-wrap" hidden><label>Kite size (m²)</label><input type="number" id="sess-size-only" min="3" max="21" step="0.5" /></div>
        <div class="field-row field-row-tight">
          <div class="field"><label>Board</label><select id="sess-board"><option value=""> · </option></select></div>
          <div class="field"><label>How the kite felt</label>
            <select id="sess-feeling" required>
              <option value="just-right">Just right</option>
              <option value="comfortable">Comfortable</option>
              <option value="too-small">Too small</option>
              <option value="too-big">Too big</option>
              <option value="couldnt-ride">Couldn't ride</option>
            </select>
          </div>
          <div class="field"><label>Session (1-5)</label>
            <select id="sess-rating">
              <option value=""> · </option>
              <option value="5">5  ·  Epic</option>
              <option value="4">4  ·  Great</option>
              <option value="3" selected>3  ·  OK</option>
              <option value="2">2  ·  Meh</option>
              <option value="1">1  ·  Poor</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Notes</label><input type="text" id="sess-notes" placeholder="Anything else worth remembering" /></div>
        <button type="submit" class="btn btn-primary">Save session</button>
      </form>
    </div>

    <div class="card profile-section">
      <h2>Past sessions</h2>
      <div id="sessions-summary" class="sessions-summary"></div>
      <ul id="sessions-list" class="gear-list sessions-list"></ul>
      <div id="sessions-editor" class="sessions-editor hidden" hidden aria-hidden="true"></div>
    </div>`;

  populateSessionSpotSelectFor("sess-spot");
  populateSessionKiteSelect(profile);
  populateSessionBoardSelect(profile);
  closeSessionEditor();
  const dateEl = document.getElementById("sess-date");
  const startEl = document.getElementById("sess-start");
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
  if (startEl && !startEl.value) {
    const now = new Date();
    startEl.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  document.getElementById("sess-kite")?.addEventListener("change", updateSessionKiteExtraFields);
  updateSessionKiteExtraFields();

  renderSessionsList(profile);
}

function updateSessionKiteExtraFields(prefix = "sess") {
  const val = document.getElementById(`${prefix}-kite`)?.value || "";
  const rented = document.getElementById(`${prefix}-rented-wrap`);
  const sizeOnly = document.getElementById(`${prefix}-size-only-wrap`);
  const showRented = val === "rented";
  const showSizeOnly = val === "size-only";
  if (rented) {
    rented.hidden = !showRented;
    rented.classList.toggle("hidden", !showRented);
  }
  if (sizeOnly) {
    sizeOnly.hidden = !showSizeOnly;
    sizeOnly.classList.toggle("hidden", !showSizeOnly);
  }
}

/**
 * @param {RiderProfile} profile
 * @param {string} selectId
 * @param {string} [selected]
 */
function populateSessionKiteSelect(profile, selectId = "sess-kite", selected = "") {
  const sel = document.getElementById(selectId);
  if (!sel || !appState) return;
  const kites = getRiderKites(appState, profile);
  const quiverOpts = kites
    .map((k) => {
      const label = formatKiteSessionOptionLabel(k);
      const selAttr = k.id === selected ? " selected" : "";
      return `<option value="${k.id}"${selAttr}>${escapeHtml(label)}</option>`;
    })
    .join("");
  sel.innerHTML =
    '<option value="">Choose kite…</option>' +
    (quiverOpts
      ? `<optgroup label="Quiver">${quiverOpts}</optgroup>`
      : '<option value="" disabled>No kites in Quiver — add some on the Quiver tab</option>') +
    `<option value="rented"${selected === "rented" ? " selected" : ""}>Rented / not in quiver…</option>` +
    `<option value="size-only"${selected === "size-only" ? " selected" : ""}>Size only (brand unknown)</option>`;
}

/**
 * @param {RiderProfile} profile
 * @param {string} selectId
 * @param {string} [selectedId]
 */
function populateSessionBoardSelect(profile, selectId = "sess-board", selectedId = "") {
  const sel = document.getElementById(selectId);
  if (!sel || !appState) return;
  const boards = getRiderBoards(appState, profile);
  sel.innerHTML =
    '<option value="">—</option>' +
    boards
      .map(
        (b) =>
          `<option value="${b.id}" ${b.id === selectedId ? "selected" : ""}>${escapeHtml(b.name)}</option>`
      )
      .join("");
}

/**
 * @param {string} selectId
 * @param {string} [selectedId]
 */
function populateSessionSpotSelectFor(selectId = "sess-spot", selectedId = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const spots = loadSpots();
  sel.innerHTML =
    '<option value="">No spot</option>' +
    spots
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(s.name)}</option>`
      )
      .join("");
}

/**
 * @param {string} prefix sess | sess-edit
 * @param {AppState} state
 * @param {RiderProfile} profile
 */
function readSessionKiteFromForm(prefix, state, profile) {
  const val = document.getElementById(`${prefix}-kite`)?.value;
  if (!val) return { error: "Choose a kite from the quiver, rented, or size-only." };

  if (val === "rented") {
    const brand = document.getElementById(`${prefix}-rented-brand`)?.value.trim() || "";
    const model = document.getElementById(`${prefix}-rented-model`)?.value.trim() || "";
    const kiteSize = Number(document.getElementById(`${prefix}-rented-size`)?.value);
    if (!brand || !model || !kiteSize) {
      return { error: "Enter brand, model, and size for the rented kite." };
    }
    return {
      kiteSize,
      kiteName: formatKiteCanonicalName(brand, model, kiteSize),
      kiteId: null,
    };
  }

  if (val === "size-only") {
    const kiteSize = Number(document.getElementById(`${prefix}-size-only`)?.value);
    if (!kiteSize) return { error: "Enter the kite size (m²)." };
    return { kiteSize, kiteName: `${kiteSize}m`, kiteId: null };
  }

  const k = getRiderKites(state, profile).find((x) => x.id === val);
  if (!k) return { error: "Kite not found in quiver." };
  return {
    kiteSize: k.size,
    kiteName: formatKiteSessionOptionLabel(k),
    kiteId: k.id,
  };
}

/**
 * @param {string} prefix
 * @param {AppState} state
 * @param {RiderProfile} profile
 */
function readSessionBoardFromForm(prefix, state, profile) {
  const boardVal = document.getElementById(`${prefix}-board`)?.value;
  if (!boardVal) return { boardId: null, boardName: null };
  const b = getRiderBoards(state, profile).find((x) => x.id === boardVal);
  if (!b) return { boardId: null, boardName: null };
  return { boardId: b.id, boardName: b.name };
}

/**
 * @param {string} prefix
 * @param {AppState} state
 * @param {RiderProfile} profile
 */
function readSessionFieldsFromForm(prefix, state, profile) {
  const kite = readSessionKiteFromForm(prefix, state, profile);
  if (kite.error) return { error: kite.error };

  const board = readSessionBoardFromForm(prefix, state, profile);
  const spotId = document.getElementById(`${prefix}-spot`)?.value;
  const spot = spotId ? getSpot(loadSpots(), spotId) : null;
  const date = document.getElementById(`${prefix}-date`)?.value;
  const startTime = document.getElementById(`${prefix}-start`)?.value;
  const endTime = document.getElementById(`${prefix}-end`)?.value;
  const gustRaw = document.getElementById(`${prefix}-gust`)?.value;
  const ratingRaw = document.getElementById(`${prefix}-rating`)?.value;
  const sessionStartAt = buildSessionIso(date, startTime);
  const sessionEndAt = endTime ? buildSessionIso(date, endTime) : null;

  if (sessionStartAt && sessionEndAt) {
    const startMs = new Date(sessionStartAt).getTime();
    const endMs = new Date(sessionEndAt).getTime();
    if (endMs <= startMs) return { error: "End time must be after start time." };
  }

  return {
    windSpeed: Number(document.getElementById(`${prefix}-wind`)?.value),
    gustSpeed: gustRaw ? Number(gustRaw) : null,
    windDirection: document.getElementById(`${prefix}-direction`)?.value,
    ...kite,
    ...board,
    spotId: spot?.id ?? null,
    spotName: spot?.name ?? null,
    sessionAt: sessionStartAt,
    sessionStartAt,
    sessionEndAt,
    feeling: document.getElementById(`${prefix}-feeling`)?.value,
    sessionRating: ratingRaw ? Number(ratingRaw) : null,
    notes: document.getElementById(`${prefix}-notes`)?.value.trim(),
    waterType: document.getElementById(`${prefix}-water`)?.value,
    waterDescription: document.getElementById(`${prefix}-water-look`)?.value.trim() || null,
  };
}

function closeSessionEditor() {
  editingSessionId = null;
  const panel = document.getElementById("sessions-editor");
  if (!panel) return;
  panel.innerHTML = "";
  panel.hidden = true;
  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
}

/** @param {AppState} state @param {string} entryId */
function openSessionEditor(state, entryId) {
  if (!entryId || !appState) return;
  const profile = getProfile(state, state.activeProfileId);
  if (!profile) return;
  const entry = profile.calibration.find((c) => c.id === entryId);
  if (!entry) return;

  editingSessionId = entryId;
  const panel = document.getElementById("sessions-editor");
  if (!panel) return;

  const start = isoToDateAndTime(sessionStartIso(entry));
  const end = isoToDateAndTime(entry.sessionEndAt);
  const kites = getRiderKites(state, profile);
  const kiteVal = entryKiteSelectValue(entry, kites);

  panel.innerHTML = `
    <div class="card quiver-editor-card sessions-editor-card">
      <h3 class="quiver-editor-title">Edit session</h3>
      <p class="hint hint-tight">Update board, kite, wind, spot, or how it felt. Changes affect Plan scoring and past-session compare.</p>
      <form id="sessions-edit-form">
        <input type="hidden" id="sess-edit-id" value="${escapeAttr(entry.id)}" />
        <div class="field-row field-row-tight">
          <div class="field"><label>Date</label><input type="date" id="sess-edit-date" required value="${escapeAttr(start.date)}" /></div>
          <div class="field"><label>Start</label><input type="time" id="sess-edit-start" required value="${escapeAttr(start.time)}" /></div>
          <div class="field"><label>End</label><input type="time" id="sess-edit-end" value="${escapeAttr(end.time)}" /></div>
        </div>
        <div class="field-row field-row-tight">
          <div class="field"><label>Spot</label><select id="sess-edit-spot"></select></div>
          <div class="field"><label>Board</label><select id="sess-edit-board"></select></div>
        </div>
        <div class="field-row field-row-tight field-row--4">
          <div class="field"><label>Wind (kt)</label><input type="number" id="sess-edit-wind" min="8" max="45" required value="${entry.windSpeed}" /></div>
          <div class="field"><label>Gusts (kt)</label><input type="number" id="sess-edit-gust" min="8" max="55" value="${entry.gustSpeed ?? ""}" /></div>
          <div class="field"><label>Direction</label>
            <select id="sess-edit-direction">${COMPASS.map((d) => `<option value="${d}" ${d === entry.windDirection ? "selected" : ""}>${d}</option>`).join("")}</select>
          </div>
          <div class="field field-kite-select"><label>Kite</label><select id="sess-edit-kite"></select></div>
        </div>
        <div id="sess-edit-rented-wrap" class="field-row field-row-tight hidden" hidden>
          <div class="field"><label>Brand</label><input type="text" id="sess-edit-rented-brand" placeholder="e.g. Duotone" /></div>
          <div class="field"><label>Model</label><input type="text" id="sess-edit-rented-model" placeholder="e.g. Evo" /></div>
          <div class="field"><label>Size (m²)</label><input type="number" id="sess-edit-rented-size" min="3" max="21" step="0.5" value="${entry.kiteSize || ""}" /></div>
        </div>
        <div class="field hidden" id="sess-edit-size-only-wrap" hidden>
          <label>Kite size (m²)</label>
          <input type="number" id="sess-edit-size-only" min="3" max="21" step="0.5" value="${entry.kiteSize || ""}" />
        </div>
        ${kiteVal === "rented" && entry.kiteName ? `<p class="hint hint-tight">Was logged as: <strong>${escapeHtml(entry.kiteName)}</strong></p>` : ""}
        <div class="field-row field-row-tight">
          <div class="field"><label>Water</label>
            <select id="sess-edit-water">
              <option value="flat" ${entry.waterType === "flat" ? "selected" : ""}>Flat</option>
              <option value="choppy" ${!entry.waterType || entry.waterType === "choppy" ? "selected" : ""}>Choppy</option>
              <option value="waves" ${entry.waterType === "waves" ? "selected" : ""}>Waves</option>
            </select>
          </div>
          <div class="field"><label>How the kite felt</label>
            <select id="sess-edit-feeling" required>
              ${["just-right", "comfortable", "too-small", "too-big", "couldnt-ride"]
                .map(
                  (f) =>
                    `<option value="${f}" ${entry.feeling === f ? "selected" : ""}>${FEELING_LABELS[f].split(" · ")[0]}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="field"><label>Session (1-5)</label>
            <select id="sess-edit-rating">
              <option value="">—</option>
              ${[5, 4, 3, 2, 1]
                .map(
                  (n) =>
                    `<option value="${n}" ${entry.sessionRating === n ? "selected" : ""}>${n}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="sess-edit-water-look">Water look &amp; feel</label>
          <input type="text" id="sess-edit-water-look" value="${escapeAttr(entry.waterDescription || "")}" />
        </div>
        <div class="field"><label>Notes</label><input type="text" id="sess-edit-notes" value="${escapeAttr(entry.notes || "")}" /></div>
        <div class="quiver-editor-actions">
          <button type="submit" class="btn btn-primary">Save changes</button>
          <button type="button" class="btn btn-cancel" id="sessions-editor-close">Cancel</button>
        </div>
      </form>
    </div>`;

  populateSessionSpotSelectFor("sess-edit-spot", entry.spotId || "");
  populateSessionBoardSelect(profile, "sess-edit-board", entry.boardId || "");
  populateSessionKiteSelect(profile, "sess-edit-kite", kiteVal);
  document.getElementById("sess-edit-kite")?.addEventListener("change", () => updateSessionKiteExtraFields("sess-edit"));
  updateSessionKiteExtraFields("sess-edit");

  panel.hidden = false;
  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** @param {AppState} state */
function handleSessionEditSubmit(state) {
  if (!editingSessionId) return;
  const profile = getProfile(state, state.activeProfileId);
  if (!profile) return;

  const fields = readSessionFieldsFromForm("sess-edit", state, profile);
  if (fields.error) {
    alert(fields.error);
    return;
  }

  const idx = profile.calibration.findIndex((c) => c.id === editingSessionId);
  if (idx < 0) return;

  profile.calibration[idx] = { ...profile.calibration[idx], ...fields, id: editingSessionId };
  profile.calibration.sort((a, b) => {
    const tb = sessionStartIso(b) ? new Date(sessionStartIso(b)).getTime() : 0;
    const ta = sessionStartIso(a) ? new Date(sessionStartIso(a)).getTime() : 0;
    return tb - ta;
  });

  syncRiderGearIdsFromSessions(profile);
  onPersist(profile);
  refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
  closeSessionEditor();
  renderSessionsPanel(state);
}

/** @param {AppState} state @param {string|null} entryId */
function removeSession(state, entryId) {
  if (!entryId || !appState) return;
  const p = getProfile(state, state.activeProfileId);
  if (!p) return;
  if (editingSessionId === entryId) closeSessionEditor();
  p.calibration = p.calibration.filter((c) => c.id !== entryId);
  syncRiderGearIdsFromSessions(p);
  onPersist(p);
  renderSessionsPanel(state);
  refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
}

/** @param {RiderProfile} profile */
function renderSessionsList(profile) {
  const summary = document.getElementById("sessions-summary");
  const list = document.getElementById("sessions-list");
  if (!summary || !list) return;

  if (!profile.calibration.length) {
    summary.innerHTML = "";
    list.innerHTML = `<li class="hint" style="list-style:none;padding:0">No sessions yet  ·  log one above.</li>`;
    return;
  }

  summary.innerHTML = `<p class="sessions-count">${profile.calibration.length} session${profile.calibration.length === 1 ? "" : "s"} logged</p>`;

  list.innerHTML = profile.calibration
    .map((e) => {
      const tag = FEELING_TAG_CLASS[e.feeling] ?? "warn";
      const when = formatSessionDateTimeLine(e);
      const spot = e.spotName ? escapeHtml(e.spotName) : " · ";
      const gust =
        e.gustSpeed != null && e.gustSpeed > e.windSpeed ? ` · gusts ${e.gustSpeed} kt` : "";
      const dir = e.windDirection ? ` ${e.windDirection}` : "";
      const rating = e.sessionRating ? ` · ${e.sessionRating}/5` : "";
      const board = e.boardName ? ` · ${escapeHtml(e.boardName)}` : "";
      const waterLook = e.waterDescription
        ? `<span class="gear-sub">${escapeHtml(e.waterDescription)}</span>`
        : "";
      const notes = e.notes ? `<span class="gear-sub">${escapeHtml(e.notes)}</span>` : "";
      return `<li class="gear-item session-item">
        <div class="gear-info">
          <strong class="session-item-title">${escapeHtml(when)}</strong>
          <span class="session-item-meta">${spot} · ${e.windSpeed} kt${gust}${dir} · ${escapeHtml(e.kiteName || e.kiteSize + "m")}${board}</span>
          <span class="feeling-tag ${tag}">${FEELING_LABELS[e.feeling]}${rating}</span>
          ${waterLook}
          ${notes}
        </div>
        <div class="gear-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-edit-sess="${e.id}">Edit</button>
          <button type="button" class="btn-danger btn-sm" data-rm-sess="${e.id}">Remove</button>
        </div>
      </li>`;
    })
    .join("");
}

/** @param {AppState} state */
function handleSessionSubmit(state) {
  const profile = getProfile(state, state.activeProfileId);
  if (!profile) return;

  if (!isRiderSexSet(profile)) {
    alert("Set sex for this rider on the Riders tab before logging sessions.");
    return;
  }

  const fields = readSessionFieldsFromForm("sess", state, profile);
  if (fields.error) {
    alert(fields.error);
    return;
  }

  profile.calibration.push({
    id: createId(),
    ...fields,
  });

  profile.calibration.sort((a, b) => {
    const tb = sessionStartIso(b) ? new Date(sessionStartIso(b)).getTime() : 0;
    const ta = sessionStartIso(a) ? new Date(sessionStartIso(a)).getTime() : 0;
    return tb - ta;
  });

  syncRiderGearIdsFromSessions(profile);
  onPersist(profile);
  refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);

  const form = document.getElementById("sessions-form");
  form?.reset();
  const dateEl = document.getElementById("sess-date");
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  updateSessionKiteExtraFields();
  renderSessionsPanel(state);
}
