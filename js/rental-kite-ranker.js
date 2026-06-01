/**
 * Rank catalog kites to rent when quiver is short for forecast wind.
 */

import { recommendKite, genericKiteWindRange } from "./engine.js";
import { listCatalogKitesAtSize, loadCatalog } from "./kite-lookup.js";
import { profileToConditions } from "./storage.js";
import { createId } from "./ids.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */

/**
 * @typedef {Object} RankedRentalKite
 * @property {string} id
 * @property {string} name
 * @property {string} brand
 * @property {string} model
 * @property {number} size
 * @property {string} style
 * @property {number} score
 * @property {string} reason
 * @property {{ min: number, ideal: number, max: number }} windRange
 */

/**
 * @param {number} size
 * @param {number} windSpeed
 * @param {number|null} gustSpeed
 * @param {string} windDirection
 * @param {RiderProfile} profile
 * @param {string} spotNotes
 * @param {string} waterType
 * @param {number} [limit]
 * @returns {Promise<RankedRentalKite[]>}
 */
export async function rankRentalKitesForWind(
  size,
  windSpeed,
  gustSpeed,
  windDirection,
  profile,
  spotNotes,
  waterType,
  limit = 8
) {
  await loadCatalog();
  const rider = { weight: profile.weight, sex: profile.sex };
  let catalogKites = listCatalogKitesAtSize(size, rider);

  if (!catalogKites.length) {
    const range = genericKiteWindRange(size, profile.weight);
    catalogKites = [
      {
        id: createId(),
        brand: "Generic",
        model: "All-round",
        size,
        name: `${size}m all-round (estimated chart)`,
        type: "hybrid",
        style: "Freeride",
        windRange: range,
        specsSource: "estimated",
      },
    ];
  }

  const conditions = profileToConditions(
    profile,
    spotNotes,
    windSpeed,
    gustSpeed,
    windDirection,
    waterType
  );

  const scored = catalogKites
    .map((kite) => {
      const rec = recommendKite(conditions, [kite], profile.calibration);
      if (!rec) return null;
      return {
        id: kite.id,
        name: kite.name,
        brand: kite.brand || "",
        model: kite.model || "",
        size: kite.size,
        style: kite.style || "",
        score: rec.score,
        reason: rec.reason,
        windRange: rec.catalogRange || kite.windRange,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
