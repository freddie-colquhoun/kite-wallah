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

const MAX_BACKUP_ALTS = 2;

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

  const flyScored = scored.find((s) => s.kite.id === flyId);
  const flyRange = flyScored
    ? { min: flyScored.range.min, max: flyScored.range.max }
    : { min: assign.kite.windRange?.min ?? 0, max: assign.kite.windRange?.max ?? 0 };
  const flyFit = describeKiteFitShort(assign.score);
  const flyFitHtml = flyFit
    ? `<span class="plan-rider-fit">${escapeHtml(flyFit)}</span>`
    : "";

  const flyRow = `<div class="plan-kite-row plan-kite-row--fly">
        <div class="plan-kite-row-head">
          <span class="plan-rider-kite-fly-label">Fly</span>
          <strong class="plan-kite-row-name">${escapeHtml(assign.kite.name)}</strong>
          ${flyFitHtml}
        </div>
        ${renderWindBar(windKt, flyRange)}
      </div>`;

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

  const shownIds = new Set([flyId]);
  if (ideal) shownIds.add(ideal.id);

  const crewLines = crewAssignments
    .filter((a) => a.profileId !== profile.id && a.kite.id !== flyId)
    .map(
      (a) =>
        `<li><span class="plan-kite-crew-who">${escapeHtml(a.profileName)}</span> ${escapeHtml(a.kite.name)}</li>`
    );
  for (const a of crewAssignments) {
    if (a.profileId !== profile.id) shownIds.add(a.kite.id);
  }

  const backupAlts = scored
    .filter(
      (s) =>
        s.kite.id !== flyId &&
        !(ideal && s.kite.id === ideal.id) &&
        !shownIds.has(s.kite.id) &&
        s.score >= MIN_SUITABLE_SCORE
    )
    .slice(0, MAX_BACKUP_ALTS);
  for (const s of backupAlts) shownIds.add(s.kite.id);

  const altRows = backupAlts
    .map((s) => {
      const fit = describeKiteFitShort(s.score);
      return `<div class="plan-kite-row plan-kite-row--compact">
          <span class="plan-kite-row-name">${escapeHtml(s.kite.name)}</span>
          ${fit ? `<span class="plan-rider-fit">${escapeHtml(fit)}</span>` : ""}
        </div>`;
    })
    .join("");

  const crewHtml =
    crewLines.length > 0
      ? `<ul class="plan-kite-crew-others">${crewLines.join("")}</ul>`
      : "";

  const rest = quiverKites.filter((k) => !shownIds.has(k.id));
  const restHtml =
    rest.length > 0
      ? `<p class="plan-kite-bag-rest"><span class="plan-kite-bag-rest-label">Rest of bag</span> ${rest
          .map((k) => `<span class="plan-kite-chip">${escapeHtml(k.name)}</span>`)
          .join("")}</p>`
      : "";

  const altsBlock =
    altRows || crewHtml
      ? `<div class="plan-kite-alts">${crewHtml}${altRows}</div>`
      : "";

  return {
    html: `<div class="plan-kite-quiver">${flyRow}${flySub}${idealHtml}${altsBlock}${restHtml}</div>`,
    isWarn: compromised,
  };
}
