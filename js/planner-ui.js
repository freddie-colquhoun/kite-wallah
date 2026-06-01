import { fetchWindForecast, fetchSunSchedule } from "./weather.js";
import { fetchHourlyTideForecast } from "./tides.js";
import {
  planRiderSessions,
  getWeekendDates,
  getTomorrowDate,
  getUpcomingDates,
  formatDateLabel,
} from "./planner.js";
import { cleanCopy } from "./copy-format.js";
import {
  initPlanCalendar,
  getPlanCalendarSelection,
  setPlanCalendarSelection,
  getPlanCalendarDates,
} from "./plan-calendar.js";
import { getSpot, loadSpots, loadSettings } from "./spots-storage.js";
import { getProfile, profileToConditions } from "./storage.js";
import { getRiderKites, migrateProfilesToSharedQuiver } from "./quiver-storage.js";
import { allocateKitesForRiders } from "./kite-allocation.js";
import { formatKt } from "./format.js";
import {
  windHourStyle,
  windScaleGradientCss,
  windLegendTicksHtml,
} from "./wind-colors.js";
import { windDialHtml } from "./wind-arrow.js";
import { hasTideLaunchRule } from "./spot-engine.js";
import { playFortunateSon } from "./fortunate-son.js";
import { sessionLevelLabel } from "./session-rating.js";
import {
  pickTopSimilarSessions,
  formatSessionCompareCard,
} from "./session-comparison.js";
import { answerPlanQuestion, formatAssistantReply } from "./plan-assistant.js";
import { getOpenAiApiKey, setOpenAiApiKey } from "./ai-client.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {import('./planner.js').RiderPlan} RiderPlan */

/** @type {object|null} */
let lastPlanContext = null;

/** @type {RiderPlan[]} */
let lastPlans = [];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  rows.push([
    "Kite",
    h.kiteName || (h.rideable ? "Add kites on Quiver" : "—"),
  ]);
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

  return `<div class="plan-hour ${hourCellClasses(h)}" style="${windHourStyle(h.windSpeed)}" tabindex="0" aria-describedby="plan-hour-float-tip" aria-label="${escapeHtml(aria)}">
    ${windDialHtml(h.windDirection)}
    <div class="plan-hour-speeds">
      <span class="plan-hour-kt">${formatKt(h.windSpeed)}</span>
      ${gustHtml}
    </div>
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
  renderPlanSpotSelect(state);
  renderPlanProfileSelector(state);
  renderPlanDayPicker(state);

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

  document.getElementById("plan-spot")?.addEventListener("change", () => {
    refreshPlanCompareSelect(state, document.getElementById("plan-spot")?.value || null);
  });

  refreshPlanUi(state);
}

function recomputePlansFromCache() {
  const ctx = lastPlanContext;
  if (!ctx) return;
  const showNight = document.getElementById("plan-show-night")?.checked ?? false;
  const plans = ctx.profileIds
    .map((id) => {
      const profile = getProfile(ctx.state, id);
      if (!profile) return null;
      migrateProfilesToSharedQuiver(ctx.state);
      return planRiderSessions({
        profile,
        spot: ctx.spot,
        forecast: ctx.forecast,
        tideHourly: ctx.tideHourly,
        availability: ctx.availability,
        spotNotes: ctx.spotNotes,
        showNight,
        sunByDate: ctx.sunByDate,
        kites: getRiderKites(ctx.state, profile),
      });
    })
    .filter(Boolean);

  lastPlans = plans;
  const dayAllocations = buildPlanDayAllocations(plans, ctx.state, ctx.spot, ctx.spotNotes);

  mountPlanResults(
    plans.map((p) => renderRiderPlan(p, ctx.spot.name, showNight, ctx.state, dayAllocations)).join(""),
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
  if (!availability.dates.length) {
    alert("Select at least one day you might kite.");
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

    /** @type {RiderPlan[]} */
    const plans = profileIds
      .map((id) => {
        const profile = getProfile(state, id);
        if (!profile) return null;
        migrateProfilesToSharedQuiver(state);
        return planRiderSessions({
          profile,
          spot,
          forecast: wind.hourly ?? [],
          tideHourly: tides.hourly ?? [],
          availability,
          spotNotes: document.getElementById("plan-notes")?.value.trim() || "",
          showNight,
          sunByDate,
          kites: getRiderKites(state, profile),
        });
      })
      .filter(Boolean);

    const tideRule =
      spot.tideAccessRule && spot.tideAccessRule !== "none"
        ? ` · Tide rule: ${spot.tideWindowHours}h around ${spot.tideAccessRule === "within_low" ? "low" : "high"}`
        : "";

    status.textContent = `${wind.source}${showNight ? " · incl. night" : ""}${tideRule}`;

    lastPlanContext = {
      state,
      profileIds,
      spot,
      forecast: wind.hourly,
      tideHourly: tides.hourly,
      availability,
      spotNotes: document.getElementById("plan-notes")?.value.trim() || "",
      sunByDate,
    };

    const spotNotes = document.getElementById("plan-notes")?.value.trim() || "";
    const dayAllocations = buildPlanDayAllocations(plans, state, spot, spotNotes);

    mountPlanResults(
      plans.map((p) => renderRiderPlan(p, spot.name, showNight, state, dayAllocations)).join(""),
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
function buildPlanDayAllocations(plans, state, spot, spotNotes) {
  /** @type {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} */
  const byDate = new Map();
  if (plans.length < 2) return byDate;

  migrateProfilesToSharedQuiver(state);
  const allKites = state.quiver?.kites ?? [];
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

  let html = "";
  for (const [date, alloc] of dayAllocations) {
    if (!alloc.bannerHtml) continue;
    html += alloc.bannerHtml;
  }
  if (!html) return "";
  return `<div class="plan-kite-allocation-wrap">${html}</div>`;
}

/** @param {RiderPlan} plan @param {string} spotName @param {boolean} showNight @param {AppState} state @param {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} [dayAllocations] */
function renderRiderPlan(plan, spotName, showNight, state, dayAllocations = new Map()) {
  const profile = getProfile(state, plan.profileId);
  const sessionCount = profile?.calibration?.length ?? 0;

  const daysHtml = plan.days
    .map((day) => {
      const rec = day.recommendation;
      const verdict = rec?.verdict ?? day.dayVerdict;
      const dayAlloc = dayAllocations.get(day.date);
      const assign = dayAlloc?.assignments.find((a) => a.profileId === plan.profileId);
      const unassigned = dayAlloc?.unassigned.find((u) => u.profileId === plan.profileId);
      const timeline = renderDayTimeline(day, showNight);

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
              <p class="plan-day-hero-kite">${escapeHtml(assign?.kite?.name ?? rec.kiteName)}</p>
              ${assign?.soloPick && assign.soloPick.id !== assign.kite.id ? `<p class="plan-day-hero-kite-note hint-tight">Shared quiver: ${escapeHtml(plan.profileName)} gets this kite (solo pick was ${escapeHtml(assign.soloPick.name)}).</p>` : ""}
              ${unassigned ? `<p class="plan-day-hero-kite-warn">${escapeHtml(unassigned.message)}</p>` : ""}
              <p class="plan-day-hero-advice">${escapeHtml(cleanCopy(rec.kiteLine))}</p>
              ${rec.timingNote ? `<p class="plan-day-hero-timing">${escapeHtml(cleanCopy(rec.timingNote))}</p>` : ""}
              ${rec.skipNote ? `<p class="plan-day-hero-skip">${escapeHtml(rec.skipNote)}</p>` : ""}
            </div>
            <div class="plan-day-hero-aside">
              <div class="plan-day-hero-verdict">${dayVerdictLabel(verdict)}</div>
              ${
                verdict === "go"
                  ? `<div class="plan-day-hero-actions">
                      <button type="button" class="btn-go-anthem" title="Open Fortunate Son on YouTube"><span class="btn-play-icon" aria-hidden="true">▶</span> Play Fortunate Son</button>
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

      const tidesOnce = day.tideTimes
        ? `<p class="plan-day-tides">${escapeHtml(day.tideTimes)}</p>`
        : "";

      const tipsHtml = day.tips?.length
        ? `<details class="plan-day-tips" open>
            <summary>What to expect on the water</summary>
            <div class="plan-day-tips-body">
              ${day.tips
                .map(
                  (s) =>
                    `<p><strong>${escapeHtml(s.title)}</strong> ${escapeHtml(s.text)}</p>`
                )
                .join("")}
            </div>
          </details>`
        : "";

      const compareHtml =
        sessionCount > 0 && rec
          ? `<div class="plan-day-compare" data-day-date="${escapeHtml(day.date)}">
              <label class="plan-compare-label">Compare to past sessions</label>
              <select class="plan-day-compare-select" data-profile-id="${escapeHtml(plan.profileId)}" data-day-date="${escapeHtml(day.date)}">
                <option value="">Off</option>
                <option value="similar">Show 3 closest sessions</option>
              </select>
              <div class="plan-compare-results hidden" aria-live="polite"></div>
            </div>`
          : "";

      return `
        <article class="plan-day-card plan-day-card--${verdict}" data-day-date="${escapeHtml(day.date)}">
          ${heroHtml}
          ${timeline}
          ${tidesOnce}
          ${compareHtml}
          ${tipsHtml}
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

/** @param {{ verdict: string }} b */
function blockLabel(b) {
  if (b.verdict === "tide-blocked") return "Outside tide window";
  if (b.verdict === "good") return "Good wind";
  if (b.verdict === "marginal") return "Marginal wind";
  if (b.verdict === "dark") return "Dark";
  return "No go";
}

/** @param {import('./planner.js').DayPlan} day @param {boolean} showNight */
function renderDayTimeline(day, showNight) {
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

  return `<div class="plan-timeline-wrap">
    <p class="plan-timeline-caption">Hour of day</p>
    <div class="plan-timeline-scroll">
      <div class="plan-timeline-strip">
        <div class="plan-timeline">${cells}</div>
        <div class="plan-timeline-axis" aria-hidden="true">${axis}</div>
      </div>
    </div>
  </div>`;
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

/** No-op  ·  compare moved to per-day cards. Kept for callers after session log. */
export function refreshPlanCompareSelect() {}

function mountPlanResults(html, state, plans, spot, dayAllocations = new Map()) {
  const results = document.getElementById("plan-results");
  const hasPlans = html.includes("plan-day-card");
  const allocSummary = renderPlanAllocationsSummary(dayAllocations);
  results.innerHTML = hasPlans ? renderPlanWindLegend(spot) + allocSummary + html : html;
  wirePlanTimelineTips(results);
  wirePlanDayCompare(results, state, plans, spot);
  results.querySelectorAll(".btn-go-anthem").forEach((btn) => {
    btn.addEventListener("click", () => playFortunateSon());
  });

  const aiPanel = document.getElementById("plan-ai-panel");
  if (aiPanel) {
    aiPanel.hidden = !hasPlans;
    if (hasPlans) wirePlanChat(state, plans, spot);
  }
}

/** @param {HTMLElement} root @param {AppState} state @param {RiderPlan[]} plans @param {import('./spots-storage.js').KiteSpot} spot */
function wirePlanDayCompare(root, state, plans, spot) {
  root.querySelectorAll(".plan-day-compare-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const profileId = sel.dataset.profileId;
      const date = sel.dataset.dayDate;
      const panel = sel.closest(".plan-day-compare")?.querySelector(".plan-compare-results");
      if (!panel) return;

      if (sel.value !== "similar") {
        panel.classList.add("hidden");
        panel.innerHTML = "";
        return;
      }

      const plan = plans.find((p) => p.profileId === profileId);
      const day = plan?.days.find((d) => d.date === date);
      const profile = getProfile(state, profileId);
      const forecast = day?.recommendation?.forecast;

      if (!profile?.calibration?.length || !forecast) {
        panel.classList.remove("hidden");
        panel.innerHTML = `<p class="hint">Log sessions under Sessions to compare.</p>`;
        return;
      }

      const top = pickTopSimilarSessions(profile.calibration, spot, forecast, 3);
      if (!top.length) {
        panel.classList.remove("hidden");
        panel.innerHTML = `<p class="hint">No past sessions close to this wind  ·  log more at similar speeds.</p>`;
        return;
      }

      panel.classList.remove("hidden");
      panel.innerHTML = top
        .map((entry) => {
          const card = formatSessionCompareCard(forecast, entry);
          return `<div class="plan-compare-card">
            <p class="plan-compare-card-title">${escapeHtml(card.title)}</p>
            <p class="plan-compare-card-body">${escapeHtml(card.body)}</p>
          </div>`;
        })
        .join("");
    });
  });
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
    "Ask about your forecast  ·  best day, gusts, tides, or how it compares to a past session. Add an OpenAI key under Options for full AI; otherwise you get smart local answers.",
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
  renderPlanSpotSelect(state);
  renderPlanProfileSelector(state);
  const keyEl = document.getElementById("plan-openai-key");
  if (keyEl && !keyEl.dataset.loaded) {
    keyEl.value = getOpenAiApiKey();
    keyEl.dataset.loaded = "1";
    keyEl.addEventListener("change", () => setOpenAiApiKey(keyEl.value));
  }
}
