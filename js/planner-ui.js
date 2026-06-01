import { fetchWindForecast, fetchSunSchedule } from "./weather.js";
import { fetchHourlyTideForecast } from "./tides.js";
import {
  planRiderSessions,
  enrichRiderPlan,
  getWeekendDates,
  getTomorrowDate,
  getUpcomingDates,
  formatDateLabel,
} from "./planner.js";
import { loadCatalog } from "./kite-lookup.js";
import { formatHourKiteTooltipLine } from "./plan-hourly-kites.js";
import { renderDayTideChartHtml } from "./tide-planning.js";
import {
  buildSharedDayTips,
  mergeCrewBringKit,
  getRiderDayEntries,
  pickCrewDayVerdict,
} from "./plan-day-aggregate.js";
import { cleanCopy } from "./copy-format.js";
import {
  initPlanCalendar,
  getPlanCalendarSelection,
  setPlanCalendarSelection,
  getPlanCalendarDates,
} from "./plan-calendar.js";
import { getSpot, loadSpots, loadSettings } from "./spots-storage.js";
import { getProfile, profileToConditions, formatRidersMissingSexMessage } from "./storage.js";
import { migrateProfilesToSharedQuiver } from "./quiver-storage.js";
import {
  defaultPlanTravelOptions,
  validatePlanTravel,
  resolvePlanKitesForRider,
  resolveCrewPackedKites,
} from "./plan-travel.js";
import { allocateKitesForRiders } from "./kite-allocation.js";
import { buildRiderPlanKitePanelHtml } from "./plan-quiver-bars.js";
import { formatKt } from "./format.js";
import {
  windHourStyle,
  windScaleGradientCss,
  windLegendTicksHtml,
} from "./wind-colors.js";
import { windDialHtml } from "./wind-arrow.js";
import { hasTideLaunchRule } from "./spot-engine.js";
import { isFortunateSonPlaying, playFortunateSon } from "./fortunate-son.js";
import { sessionLevelLabel } from "./session-rating.js";
import { buildRelevantSessionNote } from "./session-comparison.js";
import { answerPlanQuestion, formatAssistantReply } from "./plan-assistant.js";
import { getOpenAiApiKey, setOpenAiApiKey } from "./ai-client.js";
import {
  getAiLayerMode,
  setAiLayerMode,
  isAiLayerEnabled,
  isOpenAiKeyFromConfig,
} from "./ai-settings.js";
import { migrateOpenAiKeyFromLegacySettings } from "./user-secrets.js";
import {
  enrichPlanResultsWithAiV2,
  renderAiV2SlotHtml,
  renderAiV2LimitsHintHtml,
} from "./ai-enrich.js";
import { escapeHtml } from "./dom-safe.js";
import { markWindFetched, markTidesFetched } from "./live-status.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {import('./planner.js').RiderPlan} RiderPlan */

/** @type {object|null} */
let lastPlanContext = null;

/** @type {RiderPlan[]} */
let lastPlans = [];

/** @type {AppState|null} */
let planUiState = null;

/** @param {HTMLElement|null|undefined} el */
function setTravelBlockVisible(el, visible) {
  if (!el) return;
  if (visible) {
    el.removeAttribute("hidden");
    el.classList.remove("hidden");
  } else {
    el.setAttribute("hidden", "");
    el.classList.add("hidden");
  }
}

const WIND_LABELS = {
  good: "Good wind",
  marginal: "Marginal wind",
  bad: "Too light / strong",
};

function formatHourTimeLabel(isoTime) {
  return new Date(isoTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** @param {import('./planner.js').HourAssessment} h */
function getHourTooltipRows(h) {
  const gustPart =
    h.gustSpeed != null && h.gustSpeed > h.windSpeed
      ? `, gusts ${formatKt(h.gustSpeed)} kt (+${h.gustSpeed - h.windSpeed})`
      : "";
  const gustNote =
    h.gustSpeed != null && h.gustSpeed > h.windSpeed
      ? h.gustSpeed - h.windSpeed > 12
        ? " (very gusty)"
        : h.gustSpeed - h.windSpeed > 6
          ? " (gusty)"
          : ""
      : "";

  /** @type {[string, string][]} */
  const rows = [
    ["Time", formatHourTimeLabel(h.time)],
    ["Wind", `${formatKt(h.windSpeed)} kt ${h.windDirection}${gustPart}${gustNote}`],
    ["Wind band", WIND_LABELS[h.windVerdict] || String(h.windVerdict)],
    ["Tide", h.tideLabel || "—"],
  ];

  if (h.tideRuleActive) {
    rows.push([
      "Tide launch",
      h.tideAccessOk
        ? "Inside your launch window"
        : h.tideAccessNote || "Outside your launch window",
    ]);
  }

  if (h.windOffshore) {
    rows.push(["Launch wind", `Offshore (${h.windDirection})`]);
  } else if (!h.launchOk) {
    rows.push(["Launch wind", `Not advised (${h.windDirection})`]);
  } else {
    rows.push(["Launch wind", `OK (${h.windDirection})`]);
  }

  if (h.isDark) rows.push(["Daylight", "After dark"]);

  if (h.kitePick) {
    const travel = getPlanTravelOptionsFromForm();
    rows.push([
      "Kite this hour",
      formatHourKiteTooltipLine(h.kitePick, {
        travelRenting: travel.enabled && travel.mode === "renting",
      }),
    ]);
  } else {
    rows.push([
      "Kite",
      h.kiteName || (h.rideable ? "Add kites on Quiver" : "—"),
    ]);
  }
  rows.push(["Rideable", h.rideable ? "Yes" : "No"]);

  return rows;
}

/** @param {import('./planner.js').HourAssessment} h */
function buildHourTooltipHtml(h) {
  return getHourTooltipRows(h)
    .map(
      ([label, value]) =>
        `<p class="plan-tip-row"><span class="plan-tip-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</p>`
    )
    .join("");
}

function buildHourTooltipAria(h) {
  return getHourTooltipRows(h)
    .map(([label, value]) => `${label}: ${value}`)
    .join(", ");
}

function hourCellClasses(h) {
  const mods = [];
  if (!h.tideAccessOk && h.tideRuleActive) mods.push("tide-blocked");
  if (h.isDark) mods.push("is-dark");
  return ["plan-hour-wind", ...mods.map((m) => `plan-hour--${m}`)].join(" ");
}

/** @param {import('./planner.js').HourAssessment} h */
function renderHourCell(h) {
  const aria = buildHourTooltipAria(h);
  const gustHtml =
    h.gustSpeed != null && h.gustSpeed > 0
      ? `<span class="plan-hour-gust">${formatKt(h.gustSpeed)}</span>`
      : `<span class="plan-hour-gust plan-hour-gust--empty">-</span>`;

  const pick = h.kitePick;
  const kiteHtml = pick
    ? `<span class="plan-hour-kite plan-hour-kite--${pick.fit}">${escapeHtml(pick.shortLabel)}</span>`
    : "";

  return `<div class="plan-hour ${hourCellClasses(h)}" style="${windHourStyle(h.windSpeed)}" tabindex="0" aria-describedby="plan-hour-float-tip" aria-label="${escapeHtml(aria)}">
    ${windDialHtml(h.windDirection)}
    <div class="plan-hour-speeds">
      <span class="plan-hour-kt">${formatKt(h.windSpeed)}</span>
      ${gustHtml}
    </div>
    ${kiteHtml}
    <div class="plan-hour-tip-src" hidden>${buildHourTooltipHtml(h)}</div>
  </div>`;
}

/** @param {AppState} state */
export function renderPlanSpotSelect(state) {
  const sel = document.getElementById("plan-spot");
  if (!sel) return;
  const spots = loadSpots();
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Select spot…</option>' +
    spots.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  const settings = loadSettings();
  if (cur) sel.value = cur;
  else if (settings.activeSpotId) sel.value = settings.activeSpotId;
}

/** @param {AppState} state */
export function renderPlanProfileSelector(state) {
  const el = document.getElementById("plan-profile-selector");
  if (!el) return;
  el.innerHTML = state.profiles
    .map(
      (p) => `
    <label class="profile-chip">
      <input type="checkbox" name="plan-profile" value="${p.id}" checked />
      <span>${escapeHtml(p.name)}</span>
    </label>`
    )
    .join("");
}

function getPlanCalendarEl() {
  return document.getElementById("plan-day-picker");
}

/** @param {AppState} state */
export function renderPlanDayPicker(state) {
  const el = getPlanCalendarEl();
  if (!el) return;
  initPlanCalendar(el, [getTomorrowDate()]);
}

function getSelectedPlanProfileIds() {
  return [...document.querySelectorAll("#plan-profile-selector input:checked")].map((el) => el.value);
}

function getSelectedPlanDates() {
  return getPlanCalendarSelection(getPlanCalendarEl());
}

function getAvailabilityFromForm() {
  const dates = getSelectedPlanDates();
  return { dates, startHour: 0, endHour: 23 };
}

function getPlanCrewAllocationHint() {
  const travel = getPlanTravelOptionsFromForm();
  if (travel.enabled && travel.mode === "renting") {
    return "Renting mode: each rider gets their own catalog pick (weight-adjusted). No shared-bag split.";
  }
  if (travel.enabled && travel.mode === "packed") {
    return "Packed bag: heaviest rider picks first; lighter riders get smaller kites. See conflict notes if the bag is tight.";
  }
  return "Shared quiver: wind bars show each kite vs today’s wind; Fly = who rigs what (heaviest picks first from the bag).";
}

/**
 * @param {RiderProfile|null|undefined} profile
 * @param {import('./spots-storage.js').KiteSpot} spot
 * @param {{ avgWind: number, peakGust?: number|null, windDirection?: string }} rec
 * @param {{ kite?: { size?: number, name?: string }|null }} [assign]
 */
function renderRelevantSessionNoteHtml(profile, spot, rec, assign) {
  if (!profile?.calibration?.length) return "";
  const note = buildRelevantSessionNote(
    profile.calibration,
    spot,
    {
      windSpeed: rec.avgWind,
      gustSpeed: rec.peakGust ?? null,
      windDirection: rec.windDirection,
    },
    {
      recommendedKiteSize: assign?.kite?.size ?? null,
      recommendedKiteName: assign?.kite?.name ?? null,
    }
  );
  if (!note) return "";
  return `<p class="plan-session-context hint-tight">${escapeHtml(note.body)}</p>`;
}

/** @param {string|null|undefined} guidance */
function renderPlanConflictGuidanceHtml(guidance) {
  if (!guidance) return "";
  return `<div class="plan-alloc-conflict card card-slim" role="note">
    <h5 class="plan-alloc-conflict-title">How to split kit when it is tight</h5>
    ${guidance
      .split("\n")
      .map((line) => `<p class="hint-tight">${escapeHtml(line)}</p>`)
      .join("")}
  </div>`;
}

function isPlanTravelEnabled() {
  const btn = document.getElementById("plan-travel-enable");
  return btn?.getAttribute("aria-pressed") === "true";
}

/** @returns {import('./plan-travel.js').PlanTravelOptions} */
function getPlanTravelOptionsFromForm() {
  if (!isPlanTravelEnabled()) return defaultPlanTravelOptions();

  const modeInput = document.querySelector('input[name="plan-travel-mode"]:checked');
  const mode =
    modeInput?.value === "renting"
      ? /** @type {'renting'} */ ("renting")
      : /** @type {'packed'} */ ("packed");

  const packedKiteIds = [...document.querySelectorAll("#plan-travel-kite-list input:checked")].map(
    (el) => /** @type {HTMLInputElement} */ (el).value
  );

  return { enabled: true, mode, packedKiteIds };
}

/** @param {AppState} [state] */
function syncPlanTravelPanel(state) {
  const mode = document.querySelector('input[name="plan-travel-mode"]:checked')?.value ?? "packed";
  const packed = document.getElementById("plan-travel-packed");
  const renting = document.getElementById("plan-travel-renting");
  const isRenting = mode === "renting";

  setTravelBlockVisible(packed, !isRenting);
  setTravelBlockVisible(renting, isRenting);

  if (state && !isRenting) renderPlanTravelKites(state);
}

function setPlanTravelEnabled(on, state) {
  const btn = document.getElementById("plan-travel-enable");
  const options = document.getElementById("plan-travel-options");
  const hint = document.querySelector(".plan-travel-default-hint");
  if (!btn || !options) return;

  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-expanded", on ? "true" : "false");
  btn.textContent = on ? "Travelling: on" : "Travelling: off";
  btn.classList.toggle("plan-travel-enable-btn--on", on);
  setTravelBlockVisible(options, on);
  setTravelBlockVisible(hint, !on);

  if (on) syncPlanTravelPanel(state ?? planUiState ?? undefined);
}

function wirePlanTravelUiOnce() {
  const form = document.getElementById("plan-form");
  if (!form || form.dataset.planTravelWired === "1") return;
  form.dataset.planTravelWired = "1";

  form.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement|null} */ (e.target)?.closest?.("#plan-travel-enable");
    if (!btn) return;
    e.preventDefault();
    const on = btn.getAttribute("aria-pressed") !== "true";
    setPlanTravelEnabled(on, planUiState ?? undefined);
  });

  form.addEventListener("change", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.matches?.('input[name="plan-travel-mode"]')) {
      syncPlanTravelPanel(planUiState ?? undefined);
    }
  });
}

/** @param {AppState} state */
export function renderPlanTravelKites(state) {
  const list = document.getElementById("plan-travel-kite-list");
  if (!list) return;
  migrateProfilesToSharedQuiver(state);
  const kites = [...(state.quiver?.kites ?? [])].sort((a, b) => a.size - b.size);
  const prev = new Set(
    [...list.querySelectorAll("input:checked")].map((el) => /** @type {HTMLInputElement} */ (el).value)
  );

  if (!kites.length) {
    list.innerHTML = `<p class="hint hint-tight">No kites in Quiver — add gear there or choose Renting.</p>`;
    return;
  }

  list.innerHTML = kites
    .map(
      (k) => `
    <label class="profile-chip">
      <input type="checkbox" name="plan-travel-kite" value="${k.id}" ${prev.has(k.id) ? "checked" : ""} />
      <span>${escapeHtml(k.name)} <small>${k.size}m</small></span>
    </label>`
    )
    .join("");
}

function applyDayPreset(preset) {
  const el = getPlanCalendarEl();
  if (!el) return;
  let dates = [];
  if (preset === "tomorrow") dates = [getTomorrowDate()];
  else if (preset === "weekend") dates = getWeekendDates().filter((d) => getPlanCalendarDates().includes(d));
  else if (preset === "7days") dates = getPlanCalendarDates();
  setPlanCalendarSelection(el, dates);
}

/** @param {AppState} state */
export function initPlannerModule(state) {
  planUiState = state;
  renderPlanSpotSelect(state);
  renderPlanProfileSelector(state);
  renderPlanDayPicker(state);
  wirePlanTravelUiOnce();
  setPlanTravelEnabled(false, state);
  syncPlanTravelPanel(state);

  document.querySelectorAll("[data-plan-day-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyDayPreset(btn.dataset.planDayPreset));
  });

  document.getElementById("plan-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await runPlan(state);
  });

  document.getElementById("plan-show-night")?.addEventListener("change", () => {
    if (lastPlanContext) recomputePlansFromCache();
  });

  refreshPlanUi(state);
}

async function recomputePlansFromCache() {
  const ctx = lastPlanContext;
  if (!ctx) return;
  const showNight = document.getElementById("plan-show-night")?.checked ?? false;
  const travel = getPlanTravelOptionsFromForm();
  await loadCatalog();

  const plans = (
    await Promise.all(
      ctx.profileIds.map(async (id) => {
        const profile = getProfile(ctx.state, id);
        if (!profile) return null;
        migrateProfilesToSharedQuiver(ctx.state);
        const kites = await resolvePlanKitesForRider(ctx.state, travel, profile);
        const plan = planRiderSessions({
          profile,
          spot: ctx.spot,
          forecast: ctx.forecast,
          tideHourly: ctx.tideHourly,
          availability: ctx.availability,
          spotNotes: ctx.spotNotes,
          showNight,
          sunByDate: ctx.sunByDate,
          kites,
        });
        return enrichRiderPlan(plan, profile, kites, ctx.spot, ctx.spotNotes, showNight, travel);
      })
    )
  ).filter(Boolean);

  lastPlans = plans;
  const dayAllocations = buildPlanDayAllocations(plans, ctx.state, ctx.spot, ctx.spotNotes, travel);

  mountPlanResults(
    renderPlanResultsHtml(plans, ctx.spot, showNight, ctx.state, dayAllocations),
    ctx.state,
    plans,
    ctx.spot,
    dayAllocations
  );
}

/** @param {AppState} state */
async function runPlan(state) {
  const status = document.getElementById("plan-status");
  const results = document.getElementById("plan-results");
  const spotId = document.getElementById("plan-spot").value;
  const profileIds = getSelectedPlanProfileIds();
  const availability = getAvailabilityFromForm();
  const showNight = document.getElementById("plan-show-night")?.checked ?? false;

  if (!spotId) {
    alert("Select a spot  ·  forecast is tied to your launch location.");
    return;
  }
  if (!profileIds.length) {
    alert("Select at least one rider.");
    return;
  }

  const sexMsg = formatRidersMissingSexMessage(state, profileIds);
  if (sexMsg) {
    alert(sexMsg);
    return;
  }

  if (!availability.dates.length) {
    alert("Select at least one day you might kite.");
    return;
  }

  const travel = getPlanTravelOptionsFromForm();
  const travelErr = validatePlanTravel(travel, state);
  if (travelErr) {
    alert(travelErr);
    return;
  }

  const spot = getSpot(loadSpots(), spotId);
  if (!spot) return;

  status.classList.remove("hidden");
  status.textContent = "Fetching wind, tides, and daylight…";
  results.innerHTML = "";

  try {
    const forecastDays = Math.min(
      7,
      Math.max(
        1,
        Math.ceil(
          (new Date(availability.dates[availability.dates.length - 1]).getTime() - Date.now()) /
            86400000
        ) + 1
      )
    );

    const [wind, tides, sunByDate] = await Promise.all([
      fetchWindForecast(spot.lat, spot.lon, forecastDays),
      fetchHourlyTideForecast(spot.lat, spot.lon, forecastDays).catch(() => ({
        hourly: [],
        source: "",
      })),
      fetchSunSchedule(spot.lat, spot.lon, forecastDays),
    ]);

    markWindFetched(wind.source ?? "Forecast", new Date().toISOString());
    if (tides.source) markTidesFetched(tides.source);

    await loadCatalog();

    const spotNotes = document.getElementById("plan-notes")?.value.trim() || "";

    /** @type {RiderPlan[]} */
    const plans = (
      await Promise.all(
        profileIds.map(async (id) => {
          const profile = getProfile(state, id);
          if (!profile) return null;
          migrateProfilesToSharedQuiver(state);
          const kites = await resolvePlanKitesForRider(state, travel, profile);
          const plan = planRiderSessions({
            profile,
            spot,
            forecast: wind.hourly ?? [],
            tideHourly: tides.hourly ?? [],
            availability,
            spotNotes,
            showNight,
            sunByDate,
            kites,
          });
          return enrichRiderPlan(plan, profile, kites, spot, spotNotes, showNight, travel);
        })
      )
    ).filter(Boolean);

    const tideRule =
      spot.tideAccessRule && spot.tideAccessRule !== "none"
        ? ` · Tide rule: ${spot.tideWindowHours}h around ${spot.tideAccessRule === "within_low" ? "low" : "high"}`
        : "";

    const travelNote = travel.enabled
      ? travel.mode === "renting"
        ? " · travelling · renting"
        : ` · travelling · ${travel.packedKiteIds.length} packed`
      : "";
    status.textContent = `${wind.source}${showNight ? " · incl. night" : ""}${travelNote}${tideRule}`;

    lastPlanContext = {
      state,
      profileIds,
      spot,
      forecast: wind.hourly,
      tideHourly: tides.hourly,
      availability,
      spotNotes,
      sunByDate,
      travel,
    };

    const dayAllocations = buildPlanDayAllocations(plans, state, spot, spotNotes, travel);

    mountPlanResults(
      renderPlanResultsHtml(plans, spot, showNight, state, dayAllocations),
      state,
      plans,
      spot,
      dayAllocations
    );
  } catch (err) {
    status.textContent = err.message;
    mountPlanResults(`<div class="card"><p class="hint">${escapeHtml(err.message)}</p></div>`);
  }
}

/**
 * @param {RiderPlan[]} plans
 * @param {AppState} state
 * @param {import('./spots-storage.js').KiteSpot} spot
 * @param {string} spotNotes
 * @returns {Map<string, import('./kite-allocation.js').GroupKiteAllocation>}
 */
function buildPlanDayAllocations(plans, state, spot, spotNotes, travel = defaultPlanTravelOptions()) {
  /** @type {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} */
  const byDate = new Map();
  if (plans.length < 2) return byDate;
  if (travel.enabled && travel.mode === "renting") return byDate;

  migrateProfilesToSharedQuiver(state);
  const allKites = travel.enabled
    ? resolveCrewPackedKites(state, travel)
    : (state.quiver?.kites ?? []);
  const notes = [spotNotes, spot.localKnowledge].filter(Boolean).join(". ");
  const dates = [...new Set(plans.flatMap((p) => p.days.map((d) => d.date)))];

  for (const date of dates) {
    /** @type {import('./kite-allocation.js').RiderAllocInput[]} */
    const riders = [];
    for (const plan of plans) {
      const day = plan.days.find((d) => d.date === date);
      const rec = day?.recommendation;
      if (!rec) continue;
      const verdict = rec.verdict ?? day.dayVerdict;
      if (verdict === "no") continue;

      const profile = getProfile(state, plan.profileId);
      if (!profile) continue;

      riders.push({
        profileId: plan.profileId,
        name: plan.profileName,
        conditions: profileToConditions(
          profile,
          notes,
          rec.avgWind,
          rec.peakGust,
          rec.windDirection,
          spot.waterType
        ),
        calibration: profile.calibration,
        rideable: true,
      });
    }

    if (riders.length >= 2) {
      const dayLabel = plans[0].days.find((d) => d.date === date)?.dateLabel ?? date;
      const ctx = `${dayLabel} · ${formatKt(riders[0].conditions.windSpeed)} kt avg`;
      byDate.set(date, allocateKitesForRiders(riders, allKites, { contextLabel: ctx }));
    }
  }

  return byDate;
}

/** @param {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} dayAllocations */
function renderPlanAllocationsSummary(dayAllocations) {
  if (!dayAllocations.size) return "";
  return "";
}

/**
 * @param {RiderPlan[]} plans
 * @param {string} spotName
 * @param {boolean} showNight
 * @param {AppState} state
 * @param {import('./spots-storage.js').KiteSpot} spot
 * @param {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} dayAllocations
 */

/** @param {{ title: string, text: string }[]} tips */
const PLAN_TIMING_TITLES = new Set(["Rideable", "Best window", "Gust pattern"]);

function renderPlanDayExpectationHtml(tips) {
  if (!tips?.length) return "";

  let body = "";
  let inLogs = false;
  let timingBlock = "";
  for (const s of tips) {
    if (s.title === "From your logs") {
      if (!inLogs) {
        body += `<p class="plan-day-expect-heading"><strong>From your logs</strong></p>`;
        inLogs = true;
      }
      body += `<p class="plan-day-past-log">${escapeHtml(s.text)}</p>`;
    } else if (PLAN_TIMING_TITLES.has(s.title)) {
      inLogs = false;
      timingBlock += `<p class="plan-timing-line"><span class="plan-timing-label">${escapeHtml(s.title)}</span> ${escapeHtml(s.text)}</p>`;
    } else {
      inLogs = false;
      body += `<p><strong>${escapeHtml(s.title)}</strong> ${escapeHtml(s.text)}</p>`;
    }
  }
  if (timingBlock) {
    body = `<div class="plan-timing-block">${timingBlock}</div>${body}`;
  }

  return `<section class="plan-day-expect" aria-label="What to expect on the water">
    <h4 class="plan-day-expect-title">What to expect on the water</h4>
    <div class="plan-day-tips-body">${body}</div>
  </section>`;
}

function renderPlanByDay(plans, spotName, showNight, state, spot, dayAllocations) {
  const travel = getPlanTravelOptionsFromForm();
  migrateProfilesToSharedQuiver(state);
  const packedKites = travel.enabled
    ? resolveCrewPackedKites(state, travel)
    : (state.quiver?.kites ?? []);
  const spotNotes = document.getElementById("plan-notes")?.value.trim() || "";
  const notes = [spotNotes, spot.localKnowledge].filter(Boolean).join(". ");

  const dates = [...new Set(plans.flatMap((p) => p.days.map((d) => d.date)))].sort();

  const daysHtml = dates
    .map((date) => {
      const entries = getRiderDayEntries(date, plans);
      if (!entries.length) return "";

      const lead = entries[0].day;
      const rec = lead.recommendation;
      const crewVerdicts = entries.map(
        (e) => e.day.recommendation?.verdict ?? "no"
      );
      const crewVerdict = pickCrewDayVerdict(crewVerdicts);
      const dayAlloc = dayAllocations.get(date);

      const title = lead.planDayTitle ?? { prefix: null, primary: lead.dateLabel };
      const sharedTips = buildSharedDayTips(
        lead,
        spot,
        [document.getElementById("plan-notes")?.value?.trim(), spot.localKnowledge]
          .filter(Boolean)
          .join(". "),
        {
          crewVerdict,
          riders: entries.map(({ plan }) => {
            const profile = getProfile(state, plan.profileId);
            return {
              name: plan.profileName,
              calibration: profile?.calibration ?? [],
            };
          }),
        }
      );

      const bringKit = mergeCrewBringKit(
        entries.map((e) => e.day.bringKit),
        dayAlloc ?? null
      );
      const bringHtml =
        shouldShowBringKit(crewVerdict) && bringKit
          ? renderBringKitHtml(bringKit, date)
          : "";

      const showPoweredHero = rec && crewVerdict === "go";

      const heroHtml = showPoweredHero
        ? `<div class="plan-day-hero plan-day-hero--${crewVerdict} plan-day-hero--crew">
            <div class="plan-day-hero-body">
              ${title.prefix ? `<p class="plan-day-hero-prefix">${escapeHtml(title.prefix)}</p>` : ""}
              <h4 class="plan-day-hero-date">${escapeHtml(title.primary)}</h4>
              <p class="plan-day-spot-name">${escapeHtml(spotName)}</p>
              <p class="plan-day-hero-window">
                Ride <strong>${escapeHtml(rec.windowLabel)}</strong>
                · avg <strong>${formatKt(rec.avgWind)}</strong> kt
                ${rec.windDirection ? ` ${escapeHtml(rec.windDirection)}` : ""}
                ${rec.peakGust != null ? ` · gusts to <strong>${formatKt(rec.peakGust)}</strong> kt` : ""}
              </p>
            </div>
            <div class="plan-day-hero-aside">
              <div class="plan-day-hero-verdict">${dayVerdictLabel(crewVerdict)}</div>
              ${
                crewVerdict === "go"
                  ? `<div class="plan-day-hero-actions">
                      <button type="button" class="btn-go-anthem" title="Play Fortunate Son in the app"><span class="btn-play-icon" aria-hidden="true">▶</span><span class="btn-go-anthem-label">Play Fortunate Son</span></button>
                    </div>`
                  : ""
              }
            </div>
          </div>`
        : `<div class="plan-day-hero plan-day-hero--${crewVerdict} plan-day-hero--crew">
            <div class="plan-day-hero-body">
              <h4 class="plan-day-hero-date">${escapeHtml(title.primary)}</h4>
              <p class="plan-day-spot-name">${escapeHtml(spotName)}</p>
              <p class="plan-day-hero-advice">No solid powered window this day.</p>
            </div>
            <div class="plan-day-hero-aside">
              <div class="plan-day-hero-verdict">${dayVerdictLabel(crewVerdict)}</div>
            </div>
          </div>`;

      const tipsHtml = renderPlanDayExpectationHtml(sharedTips);

      const ridersHtml = [...entries]
        .sort(
          (a, b) =>
            (getProfile(state, b.plan.profileId)?.weight ?? 75) -
            (getProfile(state, a.plan.profileId)?.weight ?? 75)
        )
        .map(({ plan, day }) => {
          const profile = getProfile(state, plan.profileId);
          const verdict = day.recommendation?.verdict ?? "no";
          const assign = dayAlloc?.assignments.find((a) => a.profileId === plan.profileId);
          const unassigned = dayAlloc?.unassigned.find((u) => u.profileId === plan.profileId);
          const recR = day.recommendation;
          const crewWindKt = recR?.avgWind ?? rec?.avgWind ?? null;
          const sessionNoteHtml =
            recR && profile
              ? renderRelevantSessionNoteHtml(profile, spot, recR, assign)
              : "";

          const kiteDisplay =
            profile && (assign || unassigned)
              ? buildRiderPlanKitePanelHtml(
                  profile,
                  packedKites,
                  crewWindKt,
                  recR?.peakGust,
                  notes,
                  assign ?? null,
                  unassigned ?? null,
                  dayAlloc?.assignments ?? []
                )
              : null;

          return `<article class="plan-rider-day-card plan-rider-day-card--${verdict}">
            <header class="plan-rider-day-head">
              <h5>${escapeHtml(plan.profileName)}</h5>
              <span class="plan-rider-day-verdict plan-day-hero-verdict plan-day-hero-verdict--small">${dayVerdictLabel(verdict)}</span>
            </header>
            ${
              recR
                ? `${kiteDisplay?.html ?? `<p class="plan-rider-kite-line"><strong>Recommended kite:</strong> ${escapeHtml(assign?.kite?.name ?? recR.kiteName)}</p>`}${sessionNoteHtml}`
                : `<p class="hint-tight">Not worth rigging for this rider today.</p>`
            }
          </article>`;
        })
        .join("");

      const conditionsPanel = renderDayConditionsPanel(lead, showNight);

      return `<article class="plan-day-card plan-day-card--crew plan-day-card--${crewVerdict}" data-day-date="${escapeHtml(date)}">
        ${heroHtml}
        ${conditionsPanel}
        ${renderAiV2SlotHtml(`plan-${date}`)}
        ${tipsHtml}
        <section class="plan-crew-riders" aria-label="Kite assignment per rider">
          <div class="plan-crew-riders-head">
            <h4 class="plan-crew-riders-title">Who flies what</h4>
            <p class="hint hint-tight plan-crew-fair-hint">${escapeHtml(getPlanCrewAllocationHint())}</p>
          </div>
          ${renderPlanConflictGuidanceHtml(dayAlloc?.conflictGuidance)}
          <div class="plan-crew-riders-grid">${ridersHtml}</div>
        </section>
        ${bringHtml}
      </article>`;
    })
    .join("");

  return `<div class="plan-days-stack plan-days-stack--crew">${daysHtml}</div>`;
}

function renderPlanResultsHtml(plans, spot, showNight, state, dayAllocations) {
  if (plans.length >= 2) {
    return renderPlanByDay(plans, spot.name, showNight, state, spot, dayAllocations);
  }
  return plans
    .map((p) => renderRiderPlan(p, spot.name, showNight, state, spot, dayAllocations))
    .join("");
}

/** @param {import('./plan-bring-kit.js').PlanBringKit|null} kit @param {string} dayDate */
function renderBringKitHtml(kit, dayDate) {
  if (!kit) return "";

  const bringList =
    kit.bring.length > 0
      ? `<ul class="plan-bring-list">
          ${kit.bring
            .map(
              (b) =>
                `<li><strong>${escapeHtml(b.name)}</strong> <span class="plan-bring-meta">${formatKt(b.size)}m · ${escapeHtml(b.note)}</span></li>`
            )
            .join("")}
        </ul>`
      : kit.travelMode === "renting"
        ? `<p class="hint-tight">Hourly timeline shows catalog picks — expand rental sizes for ranked shop options.</p>`
        : `<p class="hint-tight">No quiver kite covers the forecast — see rental sizes below.</p>`;

  const rentalHtml = kit.rentalNeeds.length
    ? `<div class="plan-rental-needs">
        ${kit.rentalNeeds
          .map((r, idx) => {
            const rid = `plan-rental-${dayDate}-${r.size}-${idx}`;
            const ranked =
              r.ranked.length > 0
                ? `<ol class="plan-rental-ranked">
                    ${r.ranked
                      .map(
                        (k, i) =>
                          `<li>
                            <span class="plan-rental-rank">${i + 1}</span>
                            <strong>${escapeHtml(k.name)}</strong>
                            <span class="plan-rental-meta">${escapeHtml(k.style)} · ${formatKt(k.windRange.min)}-${formatKt(k.windRange.max)} kt</span>
                            <span class="plan-rental-reason">${escapeHtml(k.reason)}</span>
                          </li>`
                      )
                      .join("")}
                  </ol>`
                : `<p class="hint-tight">No catalog match — ask shop for ~${r.label} all-round.</p>`;
            return `<details class="plan-rental-size" id="${rid}">
              <summary><strong>Rent ~${escapeHtml(r.label)}</strong> — ${escapeHtml(r.why)}</summary>
              <div class="plan-rental-body">${ranked}</div>
            </details>`;
          })
          .join("")}
      </div>`
    : "";

  const warn =
    kit.hasGap && kit.rentalNeeds.length
      ? `<p class="plan-bring-warn">You may need another size for the main ride window — see rental options below.</p>`
      : "";

  const sectionTitle = kit.travelMode === "renting" ? "What to rent" : "What to bring";

  return `<section class="plan-bring-kit ${kit.hasGap ? "plan-bring-kit--gap" : ""}">
    <h4 class="plan-bring-title">${escapeHtml(sectionTitle)}</h4>
    <p class="plan-bring-headline">${escapeHtml(kit.headline)}</p>
    <p class="plan-bring-risk">${escapeHtml(kit.riskNote)}</p>
    ${warn}
    ${bringList}
    ${rentalHtml}
  </section>`;
}

/** @param {RiderPlan} plan @param {string} spotName @param {boolean} showNight @param {AppState} state @param {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} [dayAllocations] */
function renderRiderPlan(plan, spotName, showNight, state, spot, dayAllocations = new Map()) {
  const profile = getProfile(state, plan.profileId);

  const daysHtml = plan.days
    .map((day) => {
      const rec = day.recommendation;
      const verdict = rec?.verdict ?? day.dayVerdict;
      const dayAlloc = dayAllocations.get(day.date);
      const assign = dayAlloc?.assignments.find((a) => a.profileId === plan.profileId);
      const unassigned = dayAlloc?.unassigned.find((u) => u.profileId === plan.profileId);
      const conditionsPanel = renderDayConditionsPanel(day, showNight);

      const title = day.planDayTitle ?? {
        prefix: null,
        primary: day.dateLabel,
      };
      const heroHtml = rec
        ? `<div class="plan-day-hero plan-day-hero--${verdict}">
            <div class="plan-day-hero-body">
              ${title.prefix ? `<p class="plan-day-hero-prefix">${escapeHtml(title.prefix)}</p>` : ""}
              <h4 class="plan-day-hero-date">${escapeHtml(title.primary)}</h4>
              <p class="plan-day-hero-window">
                Ride <strong>${escapeHtml(rec.windowLabel)}</strong>
                · avg <strong>${formatKt(rec.avgWind)}</strong> kt
                ${rec.windDirection ? ` ${escapeHtml(rec.windDirection)}` : ""}
                ${rec.peakGust != null ? ` · gusts to <strong>${formatKt(rec.peakGust)}</strong> kt` : ""}
              </p>
              <p class="plan-day-hero-kite">Fly <strong>${escapeHtml(assign?.kite?.name ?? rec.kiteName)}</strong></p>
              ${rec.kiteLine ? `<p class="plan-day-hero-kite-why">${escapeHtml(cleanCopy(rec.kiteLine))}</p>` : ""}
              ${assign?.soloPick && assign.soloPick.id !== assign.kite.id ? `<p class="plan-day-hero-kite-note hint-tight">Shared quiver: ${escapeHtml(plan.profileName)} gets this kite (ideal was ${escapeHtml(assign.soloPick.name)}).</p>` : ""}
              ${unassigned ? `<p class="plan-day-hero-kite-warn">${escapeHtml(unassigned.message)}</p>` : ""}
              ${rec.timingNote ? `<p class="plan-day-hero-timing">${escapeHtml(cleanCopy(rec.timingNote))}</p>` : ""}
              ${rec.skipNote ? `<p class="plan-day-hero-skip">${escapeHtml(rec.skipNote)}</p>` : ""}
              ${profile ? renderRelevantSessionNoteHtml(profile, spot, rec, assign) : ""}
            </div>
            <div class="plan-day-hero-aside">
              <div class="plan-day-hero-verdict">${dayVerdictLabel(verdict)}</div>
              ${
                verdict === "go"
                  ? `<div class="plan-day-hero-actions">
                      <button type="button" class="btn-go-anthem" title="Play Fortunate Son in the app"><span class="btn-play-icon" aria-hidden="true">▶</span><span class="btn-go-anthem-label">Play Fortunate Son</span></button>
                    </div>`
                  : ""
              }
            </div>
          </div>`
        : `<div class="plan-day-hero plan-day-hero--${day.dayVerdict}">
            <div class="plan-day-hero-body">
              ${title.prefix ? `<p class="plan-day-hero-prefix">${escapeHtml(title.prefix)}</p>` : ""}
              <h4 class="plan-day-hero-date">${escapeHtml(title.primary)}</h4>
              <p class="plan-day-hero-advice">No solid powered window this day.</p>
            </div>
            <div class="plan-day-hero-aside">
              <div class="plan-day-hero-verdict">${dayVerdictLabel(day.dayVerdict)}</div>
            </div>
          </div>`;

      const tipsHtml = renderPlanDayExpectationHtml(day.tips ?? []);

      const bringHtml =
        shouldShowBringKit(verdict) && day.bringKit
          ? renderBringKitHtml(day.bringKit, day.date)
          : "";

      return `
        <article class="plan-day-card plan-day-card--${verdict}" data-day-date="${escapeHtml(day.date)}">
          ${heroHtml}
          ${conditionsPanel}
          ${renderAiV2SlotHtml(`plan-${day.date}`)}
          ${tipsHtml}
          ${bringHtml}
        </article>`;
    })
    .join("");

  return `
    <section class="plan-result" data-profile-id="${escapeHtml(plan.profileId)}">
      <header class="plan-result-head">
        <h3>${escapeHtml(plan.profileName)}</h3>
        <span class="plan-result-spot">${escapeHtml(spotName)}</span>
      </header>
      <div class="plan-days-stack">${daysHtml}</div>
    </section>`;
}

/** @param {import('./spots-storage.js').KiteSpot|null} spot */
function renderPlanWindLegend(spot) {
  const tideRow =
    spot && hasTideLaunchRule(spot)
      ? `<div class="plan-key-row">
          <span class="plan-key-label">Outside tide window</span>
          <div class="plan-key-body"><i class="plan-legend-swatch plan-legend-swatch--tide-blocked" aria-hidden="true"></i><span class="plan-key-hint">Dimmed = outside your tide launch window</span></div>
        </div>`
      : "";

  return `
    <div class="plan-session-key" role="doc-glossary">
      <div class="plan-key-row">
        <span class="plan-key-label">Wind speed (kt)</span>
        <div class="plan-key-body plan-key-body--scale">
          <div class="plan-wind-scale-bar" style="background:${windScaleGradientCss()}"></div>
          <div class="plan-wind-scale-ticks" aria-hidden="true">${windLegendTicksHtml()}</div>
        </div>
      </div>
      ${tideRow}
      <div class="plan-key-row">
        <span class="plan-key-label">Wind direction</span>
        <div class="plan-key-body plan-key-body--dial">
          ${windDialHtml("W")}
          <span class="plan-key-hint">Arrow = direction wind blows toward</span>
        </div>
      </div>
    </div>`;
}

function dayVerdictLabel(v) {
  return sessionLevelLabel(/** @type {import('./session-rating.js').SessionLevel} */ (v));
}

/** @param {import('./session-rating.js').SessionLevel} verdict */
function shouldShowBringKit(verdict) {
  return verdict === "go";
}

/** @param {import('./planner.js').DayPlan} day @param {boolean} showNight */
function renderDayTidePanel(day) {
  const extrema = day.tideDayExtrema ?? [];
  if (!extrema.length) return "";

  return `<section class="plan-tide-panel" aria-label="Tide times">
    <h5 class="plan-section-label">Tide</h5>
    ${renderDayTideChartHtml(extrema)}
  </section>`;
}

/** @param {import('./planner.js').DayPlan} day @param {boolean} showNight */
function renderDayConditionsPanel(day, showNight) {
  const wind = renderDayWindTimeline(day, showNight);
  const tide = renderDayTidePanel(day);
  if (!wind && !tide) return "";
  return `<div class="plan-conditions-panel">${wind}${tide}</div>`;
}

/** @param {{ verdict: string }} b */
function blockLabel(b) {
  if (b.verdict === "tide-blocked") return "Outside tide window";
  if (b.verdict === "good") return "Good wind";
  if (b.verdict === "marginal") return "Marginal wind";
  if (b.verdict === "dark") return "Dark";
  return "No go";
}

/** @param {import('./planner.js').DayPlan} day @param {boolean} showNight */
function renderDayWindTimeline(day, showNight) {
  const visible = day.hours.filter(
    (h) => h.inAvailability && (showNight || !h.isDark)
  );
  if (!visible.length) return "";

  const cells = visible.map((h) => renderHourCell(h)).join("");
  const axis = visible
    .map(
      (h) =>
        `<span class="plan-axis-time">${escapeHtml(formatHourTimeLabel(h.time))}</span>`
    )
    .join("");

  return `<section class="plan-wind-panel" aria-label="Hourly wind">
    <h5 class="plan-section-label">Wind</h5>
    <div class="plan-timeline-wrap">
      <div class="plan-timeline-scroll">
        <div class="plan-timeline-strip">
          <div class="plan-timeline">${cells}</div>
          <div class="plan-timeline-axis" aria-hidden="true">${axis}</div>
        </div>
      </div>
    </div>
  </section>`;
}

/** @type {HTMLElement|null} */
let planHourFloatTip = null;

/** @type {HTMLElement|null} */
let planHourTipActive = null;

function ensurePlanHourFloatTip() {
  if (!planHourFloatTip) {
    planHourFloatTip = document.createElement("div");
    planHourFloatTip.id = "plan-hour-float-tip";
    planHourFloatTip.className = "plan-hour-float-tip";
    planHourFloatTip.setAttribute("role", "tooltip");
    planHourFloatTip.hidden = true;
    document.body.appendChild(planHourFloatTip);
  }
  return planHourFloatTip;
}

function hidePlanHourFloatTip() {
  if (planHourFloatTip) planHourFloatTip.hidden = true;
  if (planHourTipActive) {
    planHourTipActive.classList.remove("is-tip-active", "is-tip-open");
    planHourTipActive = null;
  }
}

/** @param {HTMLElement} hourEl @param {HTMLElement} tip */
function positionPlanHourFloatTip(hourEl, tip) {
  tip.hidden = false;
  tip.style.visibility = "hidden";
  tip.style.left = "0";
  tip.style.top = "0";

  const rect = hourEl.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  const gap = 8;
  const margin = 8;

  let top = rect.bottom + gap;
  let placeAbove = false;
  if (top + tipH > window.innerHeight - margin) {
    top = rect.top - tipH - gap;
    placeAbove = true;
  }
  if (top < margin) top = margin;

  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));

  tip.classList.toggle("plan-hour-float-tip--above", placeAbove);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.visibility = "";
}

/** @param {HTMLElement} hourEl */
function showPlanHourFloatTip(hourEl) {
  const src = hourEl.querySelector(".plan-hour-tip-src");
  if (!src) return;

  const tip = ensurePlanHourFloatTip();
  tip.innerHTML = src.innerHTML;

  if (planHourTipActive && planHourTipActive !== hourEl) {
    planHourTipActive.classList.remove("is-tip-active", "is-tip-open");
  }
  planHourTipActive = hourEl;
  hourEl.classList.add("is-tip-active");

  positionPlanHourFloatTip(hourEl, tip);
}

/** Hover + touch tooltips (fixed layer — not clipped by timeline scroll) */
function wirePlanTimelineTips(root) {
  if (!root) return;

  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  root.querySelectorAll(".plan-hour").forEach((hour) => {
    hour.addEventListener("mouseenter", () => {
      if (canHover) showPlanHourFloatTip(hour);
    });
    hour.addEventListener("mouseleave", () => {
      if (canHover) hidePlanHourFloatTip();
    });
    hour.addEventListener("focus", () => showPlanHourFloatTip(hour));
    hour.addEventListener("blur", () => {
      if (canHover) hidePlanHourFloatTip();
    });
  });

  if (!canHover) {
    root.querySelectorAll(".plan-timeline").forEach((timeline) => {
      timeline.addEventListener("click", (e) => {
        const hour = e.target.closest(".plan-hour");
        if (!hour) return;
        const wasOpen = hour.classList.contains("is-tip-open");
        hidePlanHourFloatTip();
        if (!wasOpen) {
          hour.classList.add("is-tip-open");
          showPlanHourFloatTip(hour);
        }
      });
    });
  }

  if (!window.__planTipDismissWired) {
    window.__planTipDismissWired = true;
    document.addEventListener(
      "click",
      (e) => {
        if (!e.target.closest(".plan-hour")) hidePlanHourFloatTip();
      },
      true
    );
    window.addEventListener("scroll", hidePlanHourFloatTip, true);
    window.addEventListener("resize", hidePlanHourFloatTip);
  }
}

function mountPlanResults(html, state, plans, spot, dayAllocations = new Map()) {
  const results = document.getElementById("plan-results");
  const hasPlans = html.includes("plan-day-card");
  const allocSummary = plans.length >= 2 ? "" : renderPlanAllocationsSummary(dayAllocations);
  results.innerHTML = hasPlans ? renderPlanWindLegend(spot) + allocSummary + html : html;
  wirePlanTimelineTips(results);
  const syncAnthemButtons = () => {
    results.querySelectorAll(".btn-go-anthem").forEach((btn) => {
      const icon = btn.querySelector(".btn-play-icon");
      const label = btn.querySelector(".btn-go-anthem-label");
      const playing = isFortunateSonPlaying();
      btn.classList.toggle("btn-go-anthem--playing", playing);
      if (icon) icon.textContent = playing ? "❚❚" : "▶";
      if (label) label.textContent = playing ? "Pause Fortunate Son" : "Play Fortunate Son";
    });
  };
  results.querySelectorAll(".btn-go-anthem").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await playFortunateSon();
      syncAnthemButtons();
    });
  });
  syncAnthemButtons();
  if (!results.dataset.anthemWired) {
    results.dataset.anthemWired = "1";
    window.addEventListener("fortunate-son-state", syncAnthemButtons);
  }

  const aiPanel = document.getElementById("plan-ai-panel");
  if (aiPanel) {
    aiPanel.hidden = !hasPlans;
    if (hasPlans) wirePlanChat(state, plans, spot);
  }

  if (hasPlans) {
    const travel = getPlanTravelOptionsFromForm();
    migrateProfilesToSharedQuiver(state);
    const packedKites = travel.enabled
      ? resolveCrewPackedKites(state, travel)
      : (state.quiver?.kites ?? []);
    const spotNotes = document.getElementById("plan-notes")?.value.trim() || "";
    void enrichPlanResultsWithAiV2(
      results,
      plans,
      state,
      spot,
      dayAllocations,
      packedKites,
      spotNotes
    );
  }
}

function wirePlanChat(state, plans, spot) {
  const box = document.getElementById("plan-chat-messages");
  const form = document.getElementById("plan-chat-form");
  if (!box || !form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  const addMsg = (text, role) => {
    const div = document.createElement("div");
    div.className = `chat-msg chat-msg-${role}`;
    div.innerHTML =
      role === "assistant" ? formatAssistantReply(text) : escapeHtml(text);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  };

  addMsg(
    "Ask about your forecast — best day, gusts, tides, or a past session. Needs your OpenAI key under Plan → Options (same key as v2 AI summaries).",
    "assistant"
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("plan-chat-input");
    const q = input?.value?.trim();
    if (!q) return;
    addMsg(q, "user");
    input.value = "";
    addMsg("Thinking…", "assistant");
    const thinking = box.lastElementChild;

    const profiles = getSelectedPlanProfileIds()
      .map((id) => getProfile(state, id))
      .filter(Boolean);

    const planContext = {
      spot: spot ? { name: spot.name, waterType: spot.waterType } : null,
      profiles: profiles.map((p) => ({
        name: p.name,
        ability: p.ability,
        sessionCount: p.calibration?.length ?? 0,
        sessions: (p.calibration ?? []).slice(0, 8),
      })),
      plans: plans.map((p) => ({
        profileName: p.profileName,
        days: p.days.map((d) => ({
          dateLabel: d.dateLabel,
          verdict: d.recommendation?.verdict ?? d.dayVerdict,
          recommendation: d.recommendation,
          tips: d.tips,
        })),
      })),
    };

    try {
      const reply = await answerPlanQuestion(q, { plans, spot, profiles, planContext });
      thinking.remove();
      addMsg(reply, "assistant");
    } catch (err) {
      thinking.remove();
      addMsg(err.message || "Could not answer.", "assistant");
    }
  });
}

export function refreshPlanUi(state) {
  planUiState = state;
  renderPlanSpotSelect(state);
  renderPlanProfileSelector(state);
  wirePlanTravelUiOnce();
  syncPlanTravelPanel(state);
  wireOpenAiSettingsOnce();
}

function refreshOpenAiSettingsUi() {
  migrateOpenAiKeyFromLegacySettings();
  const keyEl = document.getElementById("plan-openai-key");
  const modeEl = document.getElementById("ai-layer-mode");
  const statusEl = document.getElementById("openai-setup-status");
  const fromConfig = isOpenAiKeyFromConfig();

  if (keyEl) {
    keyEl.value = fromConfig ? "•••••••• (from config.js)" : getOpenAiApiKey();
    keyEl.readOnly = fromConfig;
    keyEl.disabled = fromConfig;
  }
  if (modeEl) modeEl.value = getAiLayerMode();

  if (!statusEl) return;
  if (fromConfig) {
    statusEl.textContent =
      "Key loaded from config.js on this deploy — no need to type it in Options.";
  } else if (!getOpenAiApiKey()) {
    statusEl.textContent =
      "Paste key once — saved on this device only (not shared with crew sync). Pennies per Plan run.";
  } else if (!isAiLayerEnabled()) {
    statusEl.textContent = "Key saved on this device. Set AI layer to Explain or Review.";
  } else {
    statusEl.textContent = "OpenAI ready — key remembered on this browser.";
  }
}

function wireOpenAiSettingsOnce() {
  const keyEl = document.getElementById("plan-openai-key");
  const modeEl = document.getElementById("ai-layer-mode");
  const limitsEl = document.getElementById("ai-v2-limits");

  if (limitsEl && !limitsEl.dataset.loaded) {
    limitsEl.innerHTML = renderAiV2LimitsHintHtml();
    limitsEl.dataset.loaded = "1";
  }

  if (!keyEl || keyEl.dataset.openaiWired === "1") {
    refreshOpenAiSettingsUi();
    return;
  }
  keyEl.dataset.openaiWired = "1";

  const persistKey = () => {
    if (!isOpenAiKeyFromConfig()) setOpenAiApiKey(keyEl.value);
    if (keyEl.value.trim() && getAiLayerMode() === "off" && modeEl) {
      setAiLayerMode("explain");
      modeEl.value = "explain";
    }
    refreshOpenAiSettingsUi();
  };

  keyEl.addEventListener("input", persistKey);
  keyEl.addEventListener("change", persistKey);
  keyEl.addEventListener("blur", persistKey);
  if (modeEl) {
    modeEl.addEventListener("change", () => {
      setAiLayerMode(/** @type {import('./ai-settings.js').AiLayerMode} */ (modeEl.value));
      refreshOpenAiSettingsUi();
    });
  }

  window.addEventListener("crew-data-updated", refreshOpenAiSettingsUi);
  refreshOpenAiSettingsUi();
}
