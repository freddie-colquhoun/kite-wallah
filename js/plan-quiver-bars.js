/**
 * Plan rider cards: fly kite + quiver wind-range bars.
 */

import { scoreKiteForConditions } from "./engine.js";
import { profileToConditions } from "./storage.js";
import { renderWindBar } from "./wind-bar.js";
import { escapeHtml } from "./dom-safe.js";
import { describeKiteFitShort } from "./kite-fit-copy.js";
import {
  buildRiderKiteDisplayHtml,
  MIN_SUITABLE_SCORE,
  explainIdealTakenBy,
} from "./fair-kite-allocation.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./kite-allocation.js').KiteAssignment} KiteAssignment */
/** @typedef {import('./kite-allocation.js').UnassignedRider} UnassignedRider */

/**
 * @param {RiderProfile} profile
 * @param {Kite[]} quiverKites
 * @param {number} windKt
 * @param {number|null|undefined} gustKt
 * @param {string} [spotNotes]
 * @param {KiteAssignment|null} assign
 * @param {UnassignedRider|null} unassigned
 * @param {KiteAssignment[]} crewAssignments
 */
export function buildRiderPlanKitePanelHtml(
  profile,
  quiverKites,
  windKt,
  gustKt,
  spotNotes = "",
  assign,
  unassigned,
  crewAssignments = []
) {
  if (unassigned && !assign) {
    return buildRiderKiteDisplayHtml(null, unassigned, windKt, crewAssignments);
  }
  if (!assign || windKt == null || !quiverKites.length) {
    return buildRiderKiteDisplayHtml(assign ?? null, unassigned ?? null, windKt, crewAssignments);
  }

  const conditions = profileToConditions(
    profile,
    spotNotes,
    windKt,
    gustKt ?? null,
    null
  );
  const flyId = assign.kite.id;
  const ideal = assign.soloPick ?? null;

  const scored = quiverKites
    .map((kite) => scoreKiteForConditions(conditions, kite, profile.calibration))
    .sort((a, b) => {
      if (a.kite.id === flyId) return -1;
      if (b.kite.id === flyId) return 1;
      return b.score - a.score;
    });

  const rows = scored
    .map((s) => {
      const isFly = s.kite.id === flyId;
      const range = { min: s.range.min, max: s.range.max };
      const fitScore = isFly ? assign.score : s.score;
      const fit = describeKiteFitShort(fitScore);
      const fitHtml = fit
        ? `<span class="plan-rider-fit">${escapeHtml(fit)}</span>`
        : "";
      return `<div class="plan-kite-row${isFly ? " plan-kite-row--fly" : " plan-kite-row--alt"}">
        <div class="plan-kite-row-head">
          ${isFly ? `<span class="plan-rider-kite-fly-label">Fly</span>` : ""}
          <strong class="plan-kite-row-name">${escapeHtml(s.kite.name)}</strong>
          ${fitHtml}
        </div>
        ${renderWindBar(windKt, range)}
      </div>`;
    })
    .join("");

  const compromised = assign.score < MIN_SUITABLE_SCORE;
  const flySub = compromised
    ? `<p class="plan-rider-kite-fly-sub hint-tight">Best safe kite left in the bag — ${escapeHtml(describeKiteFitShort(assign.score) ?? "not an ideal match for this wind")}.</p>`
    : "";

  let idealHtml = "";
  if (ideal && ideal.id !== assign.kite.id) {
    const holder = crewAssignments.find((a) => a.kite.id === ideal.id);
    const gap = holder
      ? ` (${explainIdealTakenBy(holder, assign)})`
      : ideal.size > assign.kite.size + 0.25
        ? " (larger size went to another rider)"
        : "";
    idealHtml = `<p class="plan-rider-kite-solo-ideal hint-tight">Ideal: ${escapeHtml(ideal.name)}${gap}</p>`;
  }

  return {
    html: `<div class="plan-kite-quiver">${rows}${flySub}${idealHtml}</div>`,
    isWarn: compromised,
  };
}
