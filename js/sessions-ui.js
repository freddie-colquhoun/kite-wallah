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

  document.getElementById("sessions-main")?.addEventListener("submit", (e) => {
    const form = /** @type {HTMLFormElement|null} */ (e.target);
    if (form?.id !== "sessions-form") return;
    e.preventDefault();
    handleSessionSubmit(getState());
  });
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
    </div>`;

  populateSessionSpotSelect();
  populateSessionKiteSelect(profile);
  populateSessionBoardSelect(profile);
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

function populateSessionSpotSelect() {
  const sel = document.getElementById("sess-spot");
  if (!sel) return;
  const spots = loadSpots();
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">No spot</option>' +
    spots.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (cur) sel.value = cur;
}

function updateSessionKiteExtraFields() {
  const val = document.getElementById("sess-kite")?.value || "";
  const rented = document.getElementById("sess-rented-wrap");
  const sizeOnly = document.getElementById("sess-size-only-wrap");
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

/** @param {RiderProfile} profile */
function populateSessionKiteSelect(profile) {
  const sel = document.getElementById("sess-kite");
  if (!sel || !appState) return;
  const kites = getRiderKites(appState, profile);
  const quiverOpts = kites
    .map((k) => {
      const label = formatKiteSessionOptionLabel(k);
      return `<option value="${k.id}">${escapeHtml(label)}</option>`;
    })
    .join("");
  sel.innerHTML =
    '<option value="">Choose kite…</option>' +
    (quiverOpts
      ? `<optgroup label="Quiver">${quiverOpts}</optgroup>`
      : '<option value="" disabled>No kites in Quiver — add some on the Quiver tab</option>') +
    '<option value="rented">Rented / not in quiver…</option>' +
    '<option value="size-only">Size only (brand unknown)</option>';
}

/** @param {RiderProfile} profile */
function populateSessionBoardSelect(profile) {
  const sel = document.getElementById("sess-board");
  if (!sel) return;
  if (!appState) return;
  const boards = getRiderBoards(appState, profile);
  sel.innerHTML =
    '<option value="">-</option>' +
    boards.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
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
        <button type="button" class="btn-danger btn-sm" data-rm-sess="${e.id}">Remove</button>
      </li>`;
    })
    .join("");

  list.querySelectorAll("[data-rm-sess]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const state = appState;
      if (!state) return;
      const p = getProfile(state, state.activeProfileId);
      if (!p) return;
      p.calibration = p.calibration.filter((c) => c.id !== btn.dataset.rmSess);
      syncRiderGearIdsFromSessions(p);
      onPersist(p);
      renderSessionsPanel(state);
      refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
    });
  });
}

/** @param {AppState} state */
function handleSessionSubmit(state) {
  const profile = getProfile(state, state.activeProfileId);
  if (!profile) return;

  if (!isRiderSexSet(profile)) {
    alert("Set sex for this rider on the Riders tab before logging sessions.");
    return;
  }

  const val = document.getElementById("sess-kite")?.value;
  let kiteSize, kiteName, kiteId = null;
  if (!val) {
    alert("Choose a kite from the quiver, rented, or size-only.");
    return;
  }
  if (val === "rented") {
    const brand = document.getElementById("sess-rented-brand")?.value.trim() || "";
    const model = document.getElementById("sess-rented-model")?.value.trim() || "";
    kiteSize = Number(document.getElementById("sess-rented-size")?.value);
    if (!brand || !model || !kiteSize) {
      alert("Enter brand, model, and size for the rented kite.");
      return;
    }
    kiteName = formatKiteCanonicalName(brand, model, kiteSize);
  } else if (val === "size-only") {
    kiteSize = Number(document.getElementById("sess-size-only")?.value);
    kiteName = `${kiteSize}m`;
    if (!kiteSize) {
      alert("Enter the kite size (m²).");
      return;
    }
  } else {
    const k = getRiderKites(state, profile).find((x) => x.id === val);
    if (!k) return;
    kiteSize = k.size;
    kiteName = formatKiteSessionOptionLabel(k);
    kiteId = k.id;
  }

  const boardVal = document.getElementById("sess-board")?.value;
  let boardId = null;
  let boardName = null;
  if (boardVal) {
    const b = getRiderBoards(state, profile).find((x) => x.id === boardVal);
    if (b) {
      boardId = b.id;
      boardName = b.name;
    }
  }

  const spotId = document.getElementById("sess-spot")?.value;
  const spot = spotId ? getSpot(loadSpots(), spotId) : null;
  const date = document.getElementById("sess-date")?.value;
  const startTime = document.getElementById("sess-start")?.value;
  const endTime = document.getElementById("sess-end")?.value;
  const gustRaw = document.getElementById("sess-gust")?.value;
  const ratingRaw = document.getElementById("sess-rating")?.value;

  const sessionStartAt = buildSessionIso(date, startTime);
  const sessionEndAt = endTime ? buildSessionIso(date, endTime) : null;

  if (sessionStartAt && sessionEndAt) {
    const startMs = new Date(sessionStartAt).getTime();
    const endMs = new Date(sessionEndAt).getTime();
    if (endMs <= startMs) {
      alert("End time must be after start time.");
      return;
    }
  }

  profile.calibration.push({
    id: createId(),
    windSpeed: Number(document.getElementById("sess-wind")?.value),
    gustSpeed: gustRaw ? Number(gustRaw) : null,
    windDirection: document.getElementById("sess-direction")?.value,
    kiteSize,
    kiteName,
    kiteId,
    boardId,
    boardName,
    spotId: spot?.id ?? null,
    spotName: spot?.name ?? null,
    sessionAt: sessionStartAt,
    sessionStartAt,
    sessionEndAt,
    feeling: document.getElementById("sess-feeling")?.value,
    sessionRating: ratingRaw ? Number(ratingRaw) : null,
    notes: document.getElementById("sess-notes")?.value.trim(),
    waterType: document.getElementById("sess-water")?.value,
    waterDescription: document.getElementById("sess-water-look")?.value.trim() || null,
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
