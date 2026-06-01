/**
 * v2 — inject AI narrative into Plan / Now after deterministic render.
 */

import { escapeHtml } from "./dom-safe.js";
import { formatAssistantReply } from "./assistant.js";
import { isAiLayerEnabled, getAiLayerMode } from "./ai-settings.js";
import { runAiLayer, AI_V2_LIMITS } from "./ai-layer.js";
import {
  buildPlanDayDecisionBundle,
  buildNowDecisionBundle,
} from "./decision-bundle.js";
import { getRiderDayEntries, pickCrewDayVerdict } from "./plan-day-aggregate.js";
import { profileToQuiver } from "./storage.js";
import { rateNowSession } from "./session-rating.js";

/** @typedef {import('./ai-layer.js').AiLayerResult} AiLayerResult */

/** @param {string} bundleId */
export function renderAiV2SlotHtml(bundleId) {
  return `<div class="ai-v2-slot ai-v2-slot--pending" data-ai-bundle-id="${escapeHtml(bundleId)}"></div>`;
}

/** @param {string} bundleId */
export function renderAiV2LoadingHtml(bundleId) {
  return `<section class="ai-v2-panel ai-v2-panel--loading" data-ai-bundle-id="${escapeHtml(bundleId)}" aria-live="polite">
    <header class="ai-v2-head">
      <span class="ai-v2-badge">v2 · AI</span>
      <span class="ai-v2-status">Writing summary…</span>
    </header>
  </section>`;
}

/**
 * @param {AiLayerResult} result
 * @param {string} bundleId
 * @param {string|null} [error]
 */
export function renderAiV2ResultHtml(result, bundleId, error = null) {
  if (error) {
    return `<section class="ai-v2-panel ai-v2-panel--error" data-ai-bundle-id="${escapeHtml(bundleId)}">
      <header class="ai-v2-head">
        <span class="ai-v2-badge">v2 · AI</span>
      </header>
      <p class="hint-tight ai-v2-error">${escapeHtml(error)}</p>
      <p class="hint-tight">Showing rules-based advice only.</p>
    </section>`;
  }
  if (!result) return "";

  const warnings =
    result.warnings.length > 0
      ? `<ul class="ai-v2-warnings">${result.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join("")}</ul>`
      : "";

  const modeNote =
    result.mode === "review" && result.warnings.length
      ? `<p class="hint-tight ai-v2-review-note">Review mode — warnings are advisory; kite picks unchanged.</p>`
      : "";

  return `<section class="ai-v2-panel" data-ai-bundle-id="${escapeHtml(bundleId)}">
    <header class="ai-v2-head">
      <span class="ai-v2-badge">v2 · AI</span>
      <span class="ai-v2-mode">${escapeHtml(result.mode === "review" ? "Explain + review" : "Explain")}</span>
    </header>
    <div class="ai-v2-body">${formatAssistantReply(result.narrative)}</div>
    ${warnings}
    ${modeNote}
  </section>`;
}

/** @param {HTMLElement} slot @param {string} html */
function fillAiSlot(slot, html) {
  slot.innerHTML = html;
  slot.classList.remove("ai-v2-slot--pending");
}

/**
 * @param {HTMLElement} root
 * @param {object} bundle
 */
async function enrichSlot(root, bundle) {
  const slot = root.querySelector(`.ai-v2-slot[data-ai-bundle-id="${bundle.id}"]`);
  if (!slot) return;

  fillAiSlot(slot, renderAiV2LoadingHtml(bundle.id));

  try {
    const result = await runAiLayer(bundle);
    fillAiSlot(slot, renderAiV2ResultHtml(result, bundle.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fillAiSlot(slot, renderAiV2ResultHtml(null, bundle.id, msg));
  }
}

/**
 * @param {HTMLElement} resultsEl
 * @param {import('./planner.js').RiderPlan[]} plans
 * @param {import('./storage.js').AppState} state
 * @param {import('./spots-storage.js').KiteSpot} spot
 * @param {Map<string, import('./kite-allocation.js').GroupKiteAllocation>} dayAllocations
 * @param {import('./engine.js').Kite[]} packedKites
 * @param {string} spotNotes
 */
export async function enrichPlanResultsWithAiV2(
  resultsEl,
  plans,
  state,
  spot,
  dayAllocations,
  packedKites,
  spotNotes
) {
  if (!isAiLayerEnabled() || !resultsEl) return;

  const notes = [spotNotes, spot.localKnowledge].filter(Boolean).join(". ");

  const dates = [...new Set(plans.flatMap((p) => p.days.map((d) => d.date)))].sort();
  const tasks = dates.map(async (date) => {
    const entries = getRiderDayEntries(date, plans);
    if (!entries.length) return;
    const lead = entries[0].day;
    const crewVerdicts = entries.map((e) => e.day.recommendation?.verdict ?? "no");
    const crewVerdict = pickCrewDayVerdict(crewVerdicts);
    const dayAlloc = dayAllocations.get(date) ?? null;
    const bundle = buildPlanDayDecisionBundle(
      lead,
      spot,
      notes,
      crewVerdict,
      entries,
      dayAlloc,
      packedKites,
      state
    );
    const card = resultsEl.querySelector(
      `.plan-day-card[data-day-date="${date}"]`
    );
    if (card) await enrichSlot(card, bundle);
  });

  await Promise.all(tasks);
}

/**
 * @param {HTMLElement} container
 * @param {Array<{ profile: import('./storage.js').RiderProfile, conditions: object, analysis: object }>} entries
 * @param {import('./spots-storage.js').KiteSpot|null} spot
 * @param {import('./kite-allocation.js').GroupKiteAllocation|null} allocation
 * @param {import('./storage.js').AppState} state
 */
export async function enrichNowResultsWithAiV2(
  container,
  entries,
  spot,
  allocation,
  state
) {
  if (!isAiLayerEnabled() || !container) return;

  const allKites = state.quiver?.kites ?? [];
  const assignById = new Map(
    (allocation?.assignments ?? []).map((a) => [a.profileId, a])
  );

  const tasks = entries.map(async (e) => {
    const sessionLevel = rateNowSession(
      e.analysis.suitability,
      e.conditions.windSpeed,
      e.analysis.suitability.limits,
      {
        launchOk: e.analysis.spotEval?.launchOk !== false,
        gustSpeed: e.conditions.gustSpeed,
      }
    );
    const bundle = buildNowDecisionBundle({
      profile: e.profile,
      conditions: e.conditions,
      analysis: e.analysis,
      assignment: assignById.get(e.profile.id) ?? null,
      spot,
      quiverKites: profileToQuiver(state, e.profile).kites.length
        ? profileToQuiver(state, e.profile).kites
        : allKites,
      sessionLevel,
    });
    const card = container.querySelector(
      `.rider-result[data-profile-id="${e.profile.id}"]`
    );
    if (card) await enrichSlot(card, bundle);
  });

  await Promise.all(tasks);
}

/** HTML for Options panel limits list. */
export function renderAiV2LimitsHintHtml() {
  return `<ul class="ai-v2-limits hint-tight">${AI_V2_LIMITS.map(
    (l) => `<li>${escapeHtml(l)}</li>`
  ).join("")}</ul>`;
}
