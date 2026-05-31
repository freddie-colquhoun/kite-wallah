import { analyze, BOARD_TYPE_LABELS } from "./engine.js";
import {
  loadState,
  saveState,
  getProfile,
  upsertProfile,
  deleteProfile,
  createEmptyProfile,
  profileToConditions,
  profileToQuiver,
} from "./storage.js";
import {
  getRiderKites,
  getRiderBoards,
  migrateProfilesToSharedQuiver,
} from "./quiver-storage.js";
import { allocateKitesForRiders } from "./kite-allocation.js";
import { initQuiverModule, refreshQuiverPanel } from "./quiver-ui.js";
import { getAbilityOptionsHtml, renderAbilityGuide, getAbilityLabel } from "./ability-levels.js";
import { initSessionsModule, renderSessionsPanel } from "./sessions-ui.js";
import { FEELING_LABELS, getCalibrationAtWind } from "./calibration.js";
import { answerQuestion, formatAssistantReply, explainRecommendation } from "./assistant.js";
import { renderDataSourcesHtml } from "./data-sources.js";
import {
  initSpotsModule,
  renderSpotNav,
  renderSpotEditor,
  buildAnalysisContext,
  applySpotEvalToContext,
  getSpotsState,
} from "./spots-ui.js";
import { getSpot, loadSpots } from "./spots-storage.js";
import { initPlannerModule, refreshPlanUi, refreshPlanCompareSelect } from "./planner-ui.js";
import { buildNowWindHtml } from "./now-wind-panel.js";
import { initNowTab, refreshNowSpotsList, rerunNowSpotAnalyses, rerunAdhocAnalyse } from "./now-tab-ui.js";
import { rateNowSession, sessionLevelLabel } from "./session-rating.js";
import { assessTideLaunchWindow, hasTideLaunchRule } from "./spot-engine.js";
import { windArrowSvg, windBlowToDeg } from "./wind-arrow.js";
import { getTomorrowDate } from "./planner.js";
import { formatNum, formatKt } from "./format.js";
import { bootstrapData } from "./data-store.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./storage.js').AppState} AppState */

/** @type {AppState} */
let state;
/** @type {Map<string, ReturnType<typeof analyze>>} */
let lastAnalyses = new Map();

/** Last spot + conditions used for Now tab advisor chat */
let lastNowContext = { spot: /** @type {import('./spots-storage.js').KiteSpot|null} */ (null), form: null };
/** @type {object|null} */
let lastConditions = null;
/** @type {import('./spots-storage.js').KiteSpot|null} */
let lastSpot = null;

// --- Tabs ---

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

function isWindManualMode() {
  return document.getElementById("wind-manual-mode")?.checked === true;
}

function switchTab(target) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === target);
    t.setAttribute("aria-selected", t.dataset.tab === target ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    const on = panel.id === `panel-${target}`;
    panel.classList.toggle("active", on);
    panel.hidden = !on;
  });
  if (target === "quiver") refreshQuiverPanel(state);
  if (target === "sessions") renderSessionsPanel(state);
  if (target === "riders") renderProfileEditor();
  if (target === "spots") {
    renderSpotNav();
    renderSpotEditor(refreshAnalyseUi);
  }
  if (target === "check") {
    refreshNowSpotsList(nowTabHandlers);
  }
}

const nowTabHandlers = {
  getState: () => state,
  getSelectedProfileIds,
  escapeHtml,
  updateTideBanner: updateAnalyseTideBanner,
  renderAnalyseResults: (form, profileIds, opts) => {
    lastConditions = form;
    lastNowContext = { spot: opts.spot, form };
    lastAnalyses = new Map();
    renderAllResults(form, profileIds, opts);
  },
};

function refreshAnalyseUi() {
  refreshNowSpotsList(nowTabHandlers);
  refreshPlanUi(state);
}

// --- Helpers ---

function activeProfile() {
  return getProfile(state, state.activeProfileId);
}

function persistProfile(/** @type {RiderProfile} */ profile) {
  upsertProfile(state, profile);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getConditionsFromForm() {
  const gustRaw = document.getElementById("gust-speed").value;
  return {
    wind: Number(document.getElementById("wind-speed").value),
    gust: gustRaw ? Number(gustRaw) : null,
    direction: document.getElementById("wind-direction").value,
    water: document.getElementById("water-type").value,
    spotNotes: document.getElementById("spot-notes").value.trim(),
  };
}

function getSelectedProfileIds() {
  return [...document.querySelectorAll("#profile-selector input:checked")].map((el) => el.value);
}

// --- Profile selector (Analyse tab) ---

function renderProfileSelector() {
  const el = document.getElementById("profile-selector");
  el.innerHTML = state.profiles
    .map(
      (p) => `
    <label class="profile-chip">
      <input type="checkbox" name="analyse-profile" value="${p.id}" checked />
      <span class="profile-chip-text">
        <span>${escapeHtml(p.name)}</span>
        <small>${p.weight} kg · ${getAbilityLabel(p.ability)}</small>
      </span>
    </label>`
    )
    .join("");
  el.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
    inp.addEventListener("change", () => {
      rerunNowSpotAnalyses();
      rerunAdhocAnalyse();
    });
  });
}

/** @param {import('./spots-storage.js').KiteSpot|null} spot */
function updateAnalyseTideBanner(spot) {
  const tideEl = document.getElementById("tide-summary-analyse");
  if (!tideEl) return;
  const { lastTides } = getSpotsState();
  if (!lastTides || lastTides.source === "none") {
    tideEl.classList.add("hidden");
    tideEl.classList.remove("tide-banner--blocked");
    return;
  }
  tideEl.classList.remove("hidden");
  let text = lastTides.summary;
  tideEl.classList.remove("tide-banner--blocked");
  if (spot && hasTideLaunchRule(spot)) {
    const tideLaunch = assessTideLaunchWindow(
      spot,
      new Date().toISOString(),
      lastTides.predictions ?? []
    );
    if (tideLaunch.tideLaunchRuleActive) {
      const windowLabel =
        spot.tideAccessRule === "within_low" ? "low" : "high";
      if (tideLaunch.tideAccessOk) {
        text += ` · Inside tide launch window (${spot.tideWindowHours ?? 3}h around ${windowLabel} tide)`;
      } else {
        text += ` · Outside tide launch window`;
        if (tideLaunch.tideLaunchNote) text += `  ·  ${tideLaunch.tideLaunchNote}`;
        tideEl.classList.add("tide-banner--blocked");
      }
    }
  }
  tideEl.textContent = text;
}

/**
 * @param {ReturnType<typeof getConditionsFromForm>} form
 * @param {string[]} profileIds
 * @param {{ container: HTMLElement, spot: import('./spots-storage.js').KiteSpot|null, windSnap?: import('./now-wind-panel.js').NowWindSnapshot|null }} opts
 */
function renderAllResults(form, profileIds, opts) {
  const container = opts.container;
  const spot = opts.spot;
  if (spot) lastSpot = spot;
  const { lastTides, lastWindSource } = getSpotsState();
  const windSnap = opts.windSnap ?? null;

  migrateProfilesToSharedQuiver(state);
  const allKites = state.quiver?.kites ?? [];

  /** @type {Array<{ profile: import('./storage.js').RiderProfile, conditions: ReturnType<typeof profileToConditions>, analysis: ReturnType<typeof analyze> }>} */
  const entries = [];

  for (const id of profileIds) {
    const profile = getProfile(state, id);
    if (!profile) continue;

    const spotNotes = [form.spotNotes, spot?.localKnowledge].filter(Boolean).join(". ");
    const conditions = profileToConditions(
      profile,
      spotNotes,
      form.wind,
      form.gust,
      form.direction,
      spot?.waterType || form.water
    );

    let ctx = buildAnalysisContext(spot);
    ctx.tides = lastTides;
    ctx.windSource = lastWindSource;
    ctx = applySpotEvalToContext(ctx, conditions);

    const analysis = analyze(conditions, profileToQuiver(state, profile), profile.calibration, ctx);
    lastAnalyses.set(id, analysis);
    entries.push({ profile, conditions, analysis });
  }

  const windLabel = `${form.wind} kt ${form.direction}${form.gust ? `, gusts ${form.gust}` : ""}`;
  const allocation =
    profileIds.length > 1
      ? allocateKitesForRiders(
          entries.map((e) => ({
            profileId: e.profile.id,
            name: e.profile.name,
            conditions: e.conditions,
            calibration: e.profile.calibration,
            rideable:
              e.analysis.suitability.rideable &&
              e.analysis.spotEval?.launchOk !== false,
          })),
          allKites,
          { contextLabel: `Now · ${windLabel}` }
        )
      : null;

  const assignById = new Map(
    (allocation?.assignments ?? []).map((a) => [a.profileId, a])
  );

  let html = allocation?.bannerHtml ?? "";
  html += entries
    .map((e) =>
      renderOneResult(
        e.profile,
        e.conditions,
        e.analysis,
        spot,
        windSnap,
        opts,
        assignById.get(e.profile.id) ?? null
      )
    )
    .join("");
  container.innerHTML = html;
}

/**
 * @param {import('./storage.js').RiderProfile} profile
 * @param {ReturnType<typeof profileToConditions>} conditions
 * @param {ReturnType<typeof analyze>} analysis
 * @param {import('./spots-storage.js').KiteSpot|null} spot
 * @param {import('./now-wind-panel.js').NowWindSnapshot|null} [windSnap]
 * @param {{ container?: HTMLElement }} [opts]
 * @param {import('./kite-allocation.js').KiteAssignment|null} [kiteAssignment]
 */
function renderOneResult(profile, conditions, analysis, spot, windSnap = null, opts = {}, kiteAssignment = null) {
  const compactResult =
    opts.container?.classList?.contains("now-spot-results") ||
    opts.container?.classList?.contains("now-adhoc-results") ||
    false;
  const { suitability, boardRec, conditionGuide, spotEval } = analysis;
  const kiteRec = kiteAssignment?.kiteRec ?? analysis.kiteRec;
  const skipGuideTitles = new Set(["Your spot", "How confident are we?"]);
  const guideFiltered = conditionGuide.filter((b) => !skipGuideTitles.has(b.title));
  const { lastWindSource } = getSpotsState();
  const sessionLevel = rateNowSession(suitability, conditions.windSpeed, suitability.limits, {
    launchOk: spotEval?.launchOk !== false,
    gustSpeed: conditions.gustSpeed,
  });
  const status = {
    icon:
      sessionLevel === "go"
        ? "✓"
        : sessionLevel === "possible"
          ? "↑"
          : sessionLevel === "maybe"
            ? "~"
            : sessionLevel === "probably-not"
              ? "!"
              : "✕",
    text: sessionLevelLabel(sessionLevel),
  };
  const explain = explainRecommendation(conditions, profile, analysis);
  const cal = getCalibrationAtWind(conditions.windSpeed, profile.calibration);

  let gearHtml = "";
  const riderKites = getRiderKites(state, profile);
  const riderBoards = getRiderBoards(state, profile);
  if (!riderKites.length || !riderBoards.length) {
    gearHtml = `<div class="empty-quiver-cta">Add kites and boards on the <strong>Quiver</strong> tab.</div>`;
  } else if (suitability.rideable && kiteRec && boardRec) {
    const allocNote =
      kiteAssignment && kiteAssignment.soloPick && kiteAssignment.soloPick.id !== kiteAssignment.kite.id
        ? `<p class="kite-allocation-note hint-tight">Shared quiver pick (their solo choice was ${escapeHtml(kiteAssignment.soloPick.name)}).</p>`
        : "";
    const altHtml = kiteRec.alternatives.length
      ? `<details class="result-more action-panel"><summary class="action-panel-summary">Other kites in quiver</summary><ul class="notes-list">${kiteRec.alternatives
          .map(
            ({ kite, score, range }) =>
              `<li>${escapeHtml(kite.name)} ${score}% · ${formatKt(range.min)}-${formatKt(range.max)} kt</li>`
          )
          .join("")}</ul></details>`
      : "";
    gearHtml = `
      <div class="gear-stack">
        <div class="gear-pick gear-pick-compact">
          <span class="gear-pick-label">Kite</span>
          <div>
            <strong>${escapeHtml(kiteRec.kite.name)}</strong>
            <span>${formatNum(kiteRec.kite.size, 0)}m</span>
          </div>
        </div>
        ${renderWindBar(conditions.windSpeed, kiteRec.range)}
        <div class="gear-pick gear-pick-compact">
          <span class="gear-pick-label">Board</span>
          <div>
            <strong>${escapeHtml(boardRec.board.name)}</strong>
          </div>
        </div>
      </div>
      ${allocNote}
      ${altHtml}`;
  } else if (!suitability.rideable) {
    gearHtml = `<p class="result-empty">Not rideable right now.</p>`;
  }

  const explainHtml = explain
    .map(
      (s) =>
        `<details class="explain-step action-panel"><summary class="action-panel-summary">${escapeHtml(s.title)}</summary><div class="explain-body">${
          s.text ? `<p>${escapeHtml(s.text)}</p>` : ""
        }${s.bullets ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}</div></details>`
    )
    .join("");

  const metaBits = compactResult
    ? []
    : [
        spot ? escapeHtml(spot.name) : "",
        `${conditions.windSpeed} kt ${conditions.windDirection}`,
      ].filter(Boolean);

  const offshoreHtml = spotEval?.windOffshore
    ? `<p class="result-offshore"><span class="result-offshore-arrow" style="--wind-to:${windBlowToDeg(conditions.windDirection)}deg" aria-hidden="true">${windArrowSvg(14)}</span> Offshore at ${escapeHtml(spot?.name ?? "spot")} <span class="result-offshore-hint">(from your spot settings)</span></p>`
    : "";

  const tideLaunchWarn =
    spotEval?.tideLaunchRuleActive && !spotEval.tideAccessOk
      ? `<p class="tide-launch-warning">${escapeHtml(spotEval.tideLaunchNote || "Outside your tide launch window right now.")}</p>`
      : "";

  const launchWarn =
    spotEval && !spotEval.launchOk
      ? `<p class="launch-warning">Launch not advised (${conditions.windDirection} at ${escapeHtml(spot?.name ?? "spot")})</p>`
      : "";

  const notesHtml = suitability.notes.length
    ? `<ul class="result-notes">${suitability.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";

  const calCta =
    cal.confidence === "none" && conditions.windSpeed <= 16
      ? `<p class="calibration-cta">Light wind  ·  <button type="button" class="go-sessions-btn btn btn-secondary btn-sm">Log a past session</button> for ${escapeHtml(profile.name)}.</p>`
      : "";

  const windHtml =
    !compactResult && windSnap?.current
      ? buildNowWindHtml(windSnap, { manualMode: isWindManualMode(), embedded: true, compact: true })
      : "";

  const guideHtml = guideFiltered.length
    ? `<details class="result-more action-panel">
        <summary class="action-panel-summary">What to expect on the water</summary>
        <div class="condition-guide">${guideFiltered
          .map((b) => `<p><strong>${escapeHtml(b.title)}</strong> ${escapeHtml(b.text)}</p>`)
          .join("")}</div>
      </details>`
    : "";

  return `
    <div class="card card-slim result-card rider-result" data-profile-id="${profile.id}">
      ${windHtml}
      <div class="result-head">
        <h2 class="rider-result-name">${escapeHtml(profile.name)}</h2>
        ${metaBits.length ? `<p class="result-meta">${metaBits.join(" · ")}</p>` : ""}
      </div>
      ${offshoreHtml}
      ${tideLaunchWarn}
      ${launchWarn}
      <div class="result-status result-status--${sessionLevel} ${suitability.verdict}">
        <span class="result-status-icon" aria-hidden="true">${status.icon}</span>
        <span class="result-status-text">${status.text}</span>
        <span class="result-score" title="Internal suitability score  ·  higher means better match for your level, wind band, gusts, and spot">
          <span class="result-score-num">${suitability.score}</span>
          <span class="result-score-label">/100 suitability</span>
        </span>
      </div>
      ${gearHtml}
      ${notesHtml}
      ${calCta}
      ${guideHtml}
      <details class="result-more explain-section action-panel">
        <summary class="action-panel-summary">How this was scored</summary>
        <div class="explain-steps">${explainHtml}</div>
      </details>
    </div>`;
}

function renderWindBar(windSpeed, range) {
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

document.getElementById("panel-check")?.addEventListener("click", (e) => {
  if (e.target.closest(".go-sessions-btn")) {
    switchTab("sessions");
  }
});

// --- Chat ---

const chatMessages = document.getElementById("chat-messages");

function addChatMessage(text, role = "assistant") {
  const div = document.createElement("div");
  div.className = `chat-msg chat-msg-${role}`;
  div.innerHTML = role === "assistant" ? formatAssistantReply(text) : escapeHtml(text);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const q = input.value.trim();
  if (!q) return;
  addChatMessage(q, "user");
  input.value = "";

  const ids = getSelectedProfileIds();
  const profile = getProfile(state, ids[0] ?? state.activeProfileId);
  const form = lastConditions ?? getConditionsFromForm();
  const spot = lastNowContext.spot;
  const { lastTides, lastWindSource } = getSpotsState();

  const conditions = profile
    ? profileToConditions(
        profile,
        [form.spotNotes, spot?.localKnowledge].filter(Boolean).join(". "),
        form.wind,
        form.gust,
        form.direction,
        spot?.waterType || form.water
      )
    : null;
  const analysis = profile ? lastAnalyses.get(profile.id) : null;

  const reply = answerQuestion(q, {
    conditions,
    profile,
    analysis,
    allProfiles: state.profiles,
    spot,
    tides: lastTides,
    windSource: lastWindSource,
  });
  addChatMessage(reply, "assistant");
});

addChatMessage(
  "Hi! Run **Analyse** on a saved spot or ad-hoc location on the Now tab, then ask e.g. **Should I go out?** Ratings: **GO**, Possible, Maybe, Probably not, or Skip.",
  "assistant"
);

// --- Riders tab ---

document.getElementById("add-profile-btn").addEventListener("click", () => {
  const p = createEmptyProfile(`Rider ${state.profiles.length + 1}`);
  state.profiles.push(p);
  state.activeProfileId = p.id;
  saveState(state);
  renderProfileNav();
  renderProfileEditor();
  renderProfileSelector();
});

function renderProfileNav() {
  const list = document.getElementById("profile-nav-list");
  list.innerHTML = state.profiles
    .map(
      (p) => `
    <li>
      <button type="button" class="profile-nav-btn ${p.id === state.activeProfileId ? "active" : ""}" data-profile-id="${p.id}">
        <span class="profile-nav-text">
          <span>${escapeHtml(p.name)}</span>
          <small>${state.quiver?.kites?.length ?? 0} kites · ${p.calibration.length} sessions</small>
        </span>
      </button>
    </li>`
    )
    .join("");

  list.querySelectorAll(".profile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeProfileId = btn.dataset.profileId;
      saveState(state);
      renderProfileNav();
      renderProfileEditor();
    });
  });
}

function renderProfileEditor() {
  const profile = activeProfile();
  if (!profile) return;
  const editor = document.getElementById("profile-editor");

  editor.innerHTML = `
    <div class="card">
      <div class="profile-editor-header">
        <div class="field" style="flex:1;margin:0">
          <label for="edit-name">Profile name</label>
          <input type="text" id="edit-name" value="${escapeHtml(profile.name)}" />
        </div>
        <button type="button" class="btn btn-danger btn-sm" id="delete-profile-btn" ${state.profiles.length <= 1 ? "disabled" : ""}>Delete rider</button>
      </div>
    </div>

    <div class="card profile-section">
      <h2>Rider details</h2>
      <form id="rider-details-form">
        <div class="field-row">
          <div class="field"><label>Weight (kg)</label><input type="number" id="edit-weight" min="40" max="130" value="${profile.weight}" required /></div>
          <div class="field"><label>Height (cm)</label><input type="number" id="edit-height" min="130" max="220" value="${profile.height}" required /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Sex</label>
            <select id="edit-sex">
              <option value="unspecified" ${profile.sex === "unspecified" ? "selected" : ""}>Prefer not to say</option>
              <option value="male" ${profile.sex === "male" ? "selected" : ""}>Male</option>
              <option value="female" ${profile.sex === "female" ? "selected" : ""}>Female</option>
            </select>
          </div>
          <div class="field"><label>Years kitesurfing</label><input type="number" id="edit-years" min="0" max="50" value="${profile.yearsRiding ?? ""}" placeholder="Optional" /></div>
        </div>
        <div class="field">
          <label for="edit-ability">Experience level</label>
          <p class="hint hint-tight">Sets your comfortable wind band for Plan and Now (separate from logged sessions on each kite).</p>
          <select id="edit-ability">${getAbilityOptionsHtml(profile.ability)}</select>
          <div id="edit-ability-guide">${renderAbilityGuide(profile.ability)}</div>
        </div>
        <div class="field"><label>Preferred style</label>
          <select id="edit-style">
            ${["freeride", "freestyle", "wave", "foil", "big-air"]
              .map(
                (s) =>
                  `<option value="${s}" ${profile.preferredStyle === s ? "selected" : ""}>${s.replace("-", " ")}</option>`
              )
              .join("")}
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Save rider details</button>
      </form>
    </div>

    <div class="card profile-section profile-section--hint">
      <h2>Sessions</h2>
      <p class="hint" style="margin:0">Log past sessions on the <strong>Sessions</strong> tab. Used for Plan comparisons and per-kite comfort ranges.</p>
    </div>`;

  document.getElementById("edit-ability")?.addEventListener("change", (e) => {
    const level = e.target.value;
    const guide = document.getElementById("edit-ability-guide");
    if (guide) guide.innerHTML = renderAbilityGuide(level);
  });

  wireProfileEditorEvents(profile);
  refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
}

function wireProfileEditorEvents(/** @type {RiderProfile} */ profile) {
  document.getElementById("rider-details-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const yearsRaw = document.getElementById("edit-years").value;
    Object.assign(profile, {
      name: document.getElementById("edit-name").value.trim() || profile.name,
      weight: Number(document.getElementById("edit-weight").value),
      height: Number(document.getElementById("edit-height").value),
      sex: document.getElementById("edit-sex").value,
      ability: document.getElementById("edit-ability").value,
      yearsRiding: yearsRaw ? Number(yearsRaw) : null,
      preferredStyle: document.getElementById("edit-style").value,
    });
    persistProfile(profile);
    renderProfileNav();
    renderProfileSelector();
    addChatMessage(`Saved details for **${profile.name}**.`, "assistant");
  });

  document.getElementById("edit-name").addEventListener("change", (e) => {
    profile.name = e.target.value.trim() || profile.name;
    persistProfile(profile);
    renderProfileNav();
    renderProfileSelector();
  });

  document.getElementById("delete-profile-btn")?.addEventListener("click", () => {
    if (state.profiles.length <= 1) return;
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    deleteProfile(state, profile.id);
    renderProfileNav();
    renderProfileEditor();
    renderProfileSelector();
  });
}

// --- Init ---

function refreshAllFromState() {
  migrateProfilesToSharedQuiver(state);
  renderProfileSelector();
  renderProfileNav();
  renderSpotNav();
  refreshPlanUi(state);
  refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
  refreshQuiverPanel(state);
  renderSessionsPanel(state);
  refreshNowSpotsList(nowTabHandlers);
  if (document.getElementById("panel-riders")?.classList.contains("active")) {
    renderProfileEditor();
  }
}

function startApp() {
  document.getElementById("data-sources-content").innerHTML = renderDataSourcesHtml();
  renderProfileSelector();
  renderProfileNav();
  initSpotsModule(refreshAnalyseUi);
  initNowTab(nowTabHandlers);
  migrateProfilesToSharedQuiver(state);
  initQuiverModule(state, () => {
    renderProfileNav();
    renderProfileSelector();
    if (document.getElementById("panel-riders")?.classList.contains("active")) {
      renderProfileEditor();
    }
  });
  renderSpotNav();
  initPlannerModule(state);
  initSessionsModule({
    getState: () => state,
    persistProfile: (p) => {
      persistProfile(p);
      renderProfileNav();
      renderProfileSelector();
    },
    escapeHtml,
    onActiveProfileChange: () => {
      saveState(state);
      renderProfileNav();
      renderProfileSelector();
    },
  });
  renderSessionsPanel(state);

  window.addEventListener("crew-data-updated", () => {
    state = loadState();
    refreshAllFromState();
  });
}

void (async () => {
  const loading = document.getElementById("app-loading");
  const boot = await bootstrapData();
  if (loading) loading.classList.add("hidden");
  if (!boot.ok || !boot.state) return;
  state = boot.state;
  startApp();
})();
