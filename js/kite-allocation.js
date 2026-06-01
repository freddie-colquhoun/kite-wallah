/**
 * Assign unique kites when multiple riders share one quiver (Plan + Now).
 */

import {
  allocateKitesFairly,
  MIN_SUITABLE_SCORE,
} from "./fair-kite-allocation.js";
import { recommendKite, scoreKiteForConditions } from "./engine.js";
import { formatKt } from "./format.js";
import { kiteDisplayTitle } from "./quiver-storage.js";

/** @typedef {import('./engine.js').Conditions} Conditions */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {ReturnType<typeof recommendKite>} KiteRecommendation */

export { MIN_SUITABLE_SCORE };

/**
 * @typedef {Object} RiderAllocInput
 * @property {string} profileId
 * @property {string} name
 * @property {Conditions} conditions
 * @property {CalibrationEntry[]} calibration
 * @property {boolean} [rideable]
 */

/**
 * @typedef {Object} KiteAssignment
 * @property {string} profileId
 * @property {string} name
 * @property {Kite} kite
 * @property {number} score
 * @property {Kite|null} soloPick
 * @property {KiteRecommendation|null} kiteRec
 * @property {string|null} [fairnessNote]
 */

/**
 * @typedef {Object} UnassignedRider
 * @property {string} profileId
 * @property {string} name
 * @property {'shortage'|'no-kite'|'not-rideable'} reason
 * @property {string} message
 * @property {Kite|null} [soloPick]
 * @property {number} [idealSize]
 * @property {number|null} [minAdequate]
 * @property {number} [rentSize]
 * @property {Kite|null} [poorFitKite]
 * @property {number|null} [poorFitScore]
 * @property {string|null} [soloTakenBy]
 * @property {string|null} [takenKiteName]
 */

/**
 * @typedef {Object} GroupKiteAllocation
 * @property {KiteAssignment[]} assignments
 * @property {UnassignedRider[]} unassigned
 * @property {number} needRental
 * @property {string} bannerHtml
 * @property {string|null} [conflictGuidance]
 */

/**
 * @param {Conditions} conditions
 * @param {Kite[]} kites
 * @param {CalibrationEntry[]} calibration
 * @returns {Array<{ kite: Kite, score: number }>}
 */
export function scoreAllKites(conditions, kites, calibration = []) {
  if (!kites?.length) return [];

  const wind = conditions.windSpeed;
  return kites
    .map((kite) => ({
      kite,
      score: scoreKiteForConditions(conditions, kite, calibration).score,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {RiderAllocInput[]} riders
 * @param {Kite[]} allKites
 * @param {{ contextLabel?: string }} [opts]
 * @returns {GroupKiteAllocation}
 */
export function allocateKitesForRiders(riders, allKites, opts = {}) {
  const contextLabel = opts.contextLabel || "";
  const rideableRiders = riders.filter((r) => r.rideable !== false);

  if (!rideableRiders.length) {
    return emptyAllocation(contextLabel);
  }

  if (!allKites?.length) {
    return {
      assignments: [],
      unassigned: rideableRiders.map((r) => ({
        profileId: r.profileId,
        name: r.name,
        reason: "no-kite",
        message: "Add kites on the Quiver tab.",
        soloPick: null,
      })),
      needRental: rideableRiders.length,
      bannerHtml: renderAllocationBannerHtml(
        { assignments: [], unassigned: rideableRiders, needRental: rideableRiders.length },
        contextLabel
      ),
    };
  }

  if (rideableRiders.length >= 2) {
    const result = allocateKitesFairly(rideableRiders, allKites);
    return {
      ...result,
      bannerHtml: renderAllocationBannerHtml(result, contextLabel),
    };
  }

  if (rideableRiders.length === 1) {
    const r = rideableRiders[0];
    const kiteRec = recommendKite(r.conditions, allKites, r.calibration);
    const assignments = kiteRec
      ? [
          {
            profileId: r.profileId,
            name: r.name,
            kite: kiteRec.kite,
            score: kiteRec.score,
            soloPick: kiteRec.kite,
            kiteRec,
          },
        ]
      : [];
    const unassigned = kiteRec
      ? []
      : [
          {
            profileId: r.profileId,
            name: r.name,
            reason: /** @type {'no-kite'} */ ("no-kite"),
            message: "No kite in the quiver fits this wind.",
            soloPick: null,
          },
        ];
    return {
      assignments,
      unassigned,
      needRental: 0,
      bannerHtml: "",
      conflictGuidance: null,
    };
  }

  return emptyAllocation(contextLabel);
}

/** @param {string} contextLabel */
function emptyAllocation(contextLabel) {
  return {
    assignments: [],
    unassigned: [],
    needRental: 0,
    bannerHtml: "",
    conflictGuidance: null,
  };
}

/**
 * @param {{ assignments: KiteAssignment[], unassigned: UnassignedRider[], needRental: number }} alloc
 * @param {string} contextLabel
 */
function renderAllocationBannerHtml(alloc, contextLabel) {
  if (!alloc.assignments.length && !alloc.unassigned.length && !alloc.conflictGuidance) return "";

  const heading = contextLabel
    ? `<p class="kite-allocation-context">${escapeHtml(contextLabel)}</p>`
    : "";

  const conflict = alloc.conflictGuidance
    ? `<div class="kite-allocation-conflict">${alloc.conflictGuidance
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}</div>`
    : "";

  const rows = alloc.assignments
    .map((a) => {
      const title = kiteDisplayTitle(a.kite);
      const soloNote =
        a.soloPick && a.soloPick.id !== a.kite.id
          ? ` <span class="kite-allocation-solo">(solo pick was ${escapeHtml(a.soloPick.name)})</span>`
          : "";
      return `<li><strong>${escapeHtml(a.name)}</strong> → ${escapeHtml(title)} (${a.score}% match)${soloNote}</li>`;
    })
    .join("");

  const warnings = alloc.unassigned
    .map((u) => `<li class="kite-allocation-warn-item">${escapeHtml(u.message)}</li>`)
    .join("");

  const rental =
    alloc.needRental > 0
      ? `<p class="kite-allocation-rental"><strong>${alloc.needRental} rider${alloc.needRental > 1 ? "s" : ""} need${alloc.needRental === 1 ? "s" : ""} another kite</strong> — consider renting for the day.</p>`
      : "";

  return `<div class="kite-allocation-banner card card-slim">
    <h3 class="kite-allocation-title">Who flies which kite</h3>
    <p class="hint hint-tight">One kite per person — heavier riders pick from the bag first; lighter riders get smaller sizes.</p>
    ${heading}
    ${conflict}
    ${rows ? `<ul class="kite-allocation-list">${rows}</ul>` : ""}
    ${warnings ? `<ul class="kite-allocation-warnings">${warnings}</ul>` : ""}
    ${rental}
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
