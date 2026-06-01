/**
 * Travel mode for Plan: limit to packed kites or recommend from full catalog (renting).
 */

import { loadCatalog, listAllCatalogKites } from "./kite-lookup.js";
import { migrateProfilesToSharedQuiver } from "./quiver-storage.js";

/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./engine.js').Kite} Kite */

/** @typedef {'packed' | 'renting'} PlanTravelGearMode */

/**
 * @typedef {Object} PlanTravelOptions
 * @property {boolean} enabled
 * @property {PlanTravelGearMode} mode
 * @property {string[]} packedKiteIds
 */

export function defaultPlanTravelOptions() {
  return { enabled: false, mode: /** @type {PlanTravelGearMode} */ ("packed"), packedKiteIds: [] };
}

/**
 * @param {PlanTravelOptions} travel
 * @param {AppState} state
 * @returns {string|null}
 */
export function validatePlanTravel(travel, state) {
  if (!travel.enabled) return null;
  if (travel.mode === "renting") return null;
  migrateProfilesToSharedQuiver(state);
  const all = state.quiver?.kites ?? [];
  if (!all.length) {
    return "Add kites on the Quiver tab, or choose Renting (no kites packed).";
  }
  if (!travel.packedKiteIds.length) {
    return "Select the kites you brought with you, or choose Renting.";
  }
  return null;
}

/**
 * Kites used for this rider's Plan (hourly picks, day kite line, bring kit).
 * @param {AppState} state
 * @param {PlanTravelOptions} travel
 * @param {RiderProfile} profile
 * @returns {Promise<Kite[]>}
 */
export async function resolvePlanKitesForRider(state, travel, profile) {
  migrateProfilesToSharedQuiver(state);
  const all = state.quiver?.kites ?? [];

  if (!travel.enabled) return all;

  if (travel.mode === "renting") {
    await loadCatalog();
    return listAllCatalogKites({
      weight: profile.weight,
      sex: profile.sex,
    });
  }

  const ids = new Set(travel.packedKiteIds);
  return all.filter((k) => ids.has(k.id));
}

/**
 * Shared pool for multi-rider fair allocation when travelling with packed gear.
 * @param {AppState} state
 * @param {PlanTravelOptions} travel
 * @returns {Kite[]}
 */
export function resolveCrewPackedKites(state, travel) {
  migrateProfilesToSharedQuiver(state);
  const all = state.quiver?.kites ?? [];
  if (!travel.enabled || travel.mode !== "packed") return all;
  const ids = new Set(travel.packedKiteIds);
  return all.filter((k) => ids.has(k.id));
}
