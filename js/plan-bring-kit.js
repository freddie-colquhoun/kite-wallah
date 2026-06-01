/**
 * Risk-averse "what to bring" for driving to the spot + rental gaps.
 */

import { recommendKite } from "./engine.js";
import { profileToConditions } from "./storage.js";
import { formatKt } from "./format.js";
import { gustSpread } from "./wind-session-copy.js";
import { buildPlanHourlyKites } from "./plan-hourly-kites.js";
import { rankRentalKitesForWind } from "./rental-kite-ranker.js";

/** @typedef {import('./planner.js').HourAssessment} HourAssessment */
/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./plan-hourly-kites.js').PlanHourKitePick} PlanHourKitePick */
/** @typedef {import('./rental-kite-ranker.js').RankedRentalKite} RankedRentalKite */

/**
 * @typedef {Object} PlanRentalNeed
 * @property {number} size
 * @property {string} label
 * @property {number} referenceWind
 * @property {number|null} referenceGust
 * @property {string} why
 * @property {RankedRentalKite[]} ranked
 */

/**
 * @typedef {Object} PlanBringKit
 * @property {string} headline
 * @property {string} riskNote
 * @property {{ id: string, name: string, size: number, note: string }[]} bring
 * @property {boolean} quiverEmpty
 * @property {boolean} hasGap
 * @property {PlanRentalNeed[]} rentalNeeds
 * @property {PlanHourKitePick[]} hourly
 * @property {'renting'|'packed'|null} [travelMode]
 */

const MIN_QUIVER_FIT = 50;
const MIN_RENTAL_TRIGGER = 52;

/**
 * @param {object} p
 * @param {RiderProfile} p.profile
 * @param {Kite[]} p.kites
 * @param {string} p.spotNotes
 * @param {string} p.waterType
 * @param {HourAssessment[]} p.scorable
 * @param {import('./plan-recommendation.js').RideableWindSummary|null} p.rideable
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} p.limits
 * @param {import('./plan-travel.js').PlanTravelOptions} [p.travel]
 */
export async function buildPlanBringKit({
  profile,
  kites,
  spotNotes,
  waterType,
  scorable,
  rideable,
  limits,
  travel,
}) {
  const travelMode =
    travel?.enabled && travel.mode === "renting"
      ? "renting"
      : travel?.enabled && travel.mode === "packed"
        ? "packed"
        : null;
  const hourly = buildPlanHourlyKites(
    profile,
    kites,
    spotNotes,
    waterType,
    scorable,
    limits
  );

  if (!hourly.length) {
    return {
      headline: "Nothing worth rigging for this window",
      riskNote: "Forecast is outside your powered band or launch/tide rules.",
      bring: [],
      quiverEmpty: !kites.length,
      hasGap: !kites.length,
      rentalNeeds: [],
      hourly,
      travelMode,
    };
  }

  const quiverEmpty = travelMode !== "renting" && !kites.length;
  const quiverById = new Map(kites.map((k) => [k.id, k]));
  const quiverSizes = [...new Set(kites.map((k) => k.size))].sort((a, b) => a - b);

  /** @type {Set<string>} */
  const bringIds = new Set();
  /** @type {Map<number, { wind: number, gust: number|null, score: number }>} */
  const sizeNeeds = new Map();

  const peakGust = rideable?.peakGust ?? Math.max(
    ...hourly.map((h) => h.gustSpeed ?? h.windSpeed)
  );
  const avgWind = rideable?.avgWind ?? Math.round(
    hourly.reduce((s, h) => s + h.windSpeed, 0) / hourly.length
  );
  const spread = gustSpread(avgWind, peakGust);
  const gusty = spread > limits.maxGustSpread * 0.75;

  for (const pick of hourly) {
    if (pick.kiteId && pick.score != null && pick.score >= MIN_QUIVER_FIT - 8) {
      bringIds.add(pick.kiteId);
      const k = quiverById.get(pick.kiteId);
      if (k) {
        addAdjacentSizes(bringIds, k.size, kites);
        if (gusty) addAdjacentSizes(bringIds, k.size, kites, true);
      }
    }

    const needSize =
      pick.kiteSize ??
      inferSizeFromWind(pick.windSpeed, profile.weight, limits);
    const prev = sizeNeeds.get(needSize);
    const score = pick.score ?? 0;
    if (
      !prev ||
      score < prev.score ||
      (score === prev.score && pick.windSpeed > prev.wind)
    ) {
      sizeNeeds.set(needSize, {
        wind: pick.windSpeed,
        gust: pick.gustSpeed,
        score,
      });
    }

    if (
      pick.score != null &&
      pick.score < MIN_RENTAL_TRIGGER &&
      (!pick.kiteId || !quiverById.has(pick.kiteId))
    ) {
      const fallbackSize = pick.kiteSize ?? inferSizeFromWind(pick.windSpeed, profile.weight, limits);
      sizeNeeds.set(fallbackSize, {
        wind: pick.windSpeed,
        gust: pick.gustSpeed,
        score: pick.score,
      });
    }
  }

  if (gusty && quiverSizes.length) {
    const smallest = quiverSizes[0];
    const sk = kites.find((k) => k.size === smallest);
    if (sk) bringIds.add(sk.id);
  }

  if (rideable && quiverSizes.length) {
    const maxPick = hourly.reduce((a, b) =>
      (b.windSpeed > (a?.windSpeed ?? 0) ? b : a), hourly[0]);
    if (maxPick?.kiteId) {
      const k = quiverById.get(maxPick.kiteId);
      if (k) addAdjacentSizes(bringIds, k.size, kites);
    }
  }

  const bring =
    travelMode === "renting"
      ? []
      : [...bringIds]
          .map((id) => quiverById.get(id))
          .filter(Boolean)
          .sort((a, b) => a.size - b.size)
          .map((k) => ({
            id: k.id,
            name: k.name,
            size: k.size,
            note:
              travelMode === "packed"
                ? gusty && k.size === quiverSizes[0]
                  ? "Gust insurance (packed)"
                  : "Packed · covers forecast hours"
                : gusty && k.size === quiverSizes[0]
                  ? "Gust insurance"
                  : "Covers forecast hours",
          }));

  /** @type {PlanRentalNeed[]} */
  const rentalNeeds = [];
  const windDir = scorable.find((h) => h.rideable)?.windDirection ?? "W";

  for (const [size, ref] of sizeNeeds) {
    const hasQuiverAtSize = kites.some(
      (k) => Math.abs(k.size - size) < 0.35 && (travelMode === "renting" || bringIds.has(k.id))
    );
    const bestAtSize = kites.length
      ? recommendKite(
          profileToConditions(
            profile,
            spotNotes,
            ref.wind,
            ref.gust,
            windDir,
            waterType
          ),
          kites.filter((k) => Math.abs(k.size - size) < 0.35),
          profile.calibration
        )
      : null;

    const quiverOk =
      bestAtSize && bestAtSize.score >= MIN_RENTAL_TRIGGER && bestAtSize.inRange;

    if (travelMode === "renting" && quiverOk) continue;

    if (quiverOk && hasQuiverAtSize) continue;

    const ranked = await rankRentalKitesForWind(
      size,
      ref.wind,
      ref.gust,
      windDir,
      profile,
      spotNotes,
      waterType
    );

    rentalNeeds.push({
      size,
      label: `${size}m`,
      referenceWind: ref.wind,
      referenceGust: ref.gust,
      why:
        travelMode === "renting"
          ? `Best rental options for ~${size}m at ${formatKt(ref.wind)} kt`
          : quiverEmpty
            ? `No kites in quiver — need ~${size}m for ${formatKt(ref.wind)} kt`
            : !bestAtSize
              ? `No ${size}m in packed bag for ${formatKt(ref.wind)} kt hours`
              : `Your ${size}m options score low (~${bestAtSize.score}%) at ${formatKt(ref.wind)} kt — consider renting`,
      ranked,
    });
  }

  rentalNeeds.sort((a, b) => a.size - b.size);

  const hasGap = quiverEmpty || rentalNeeds.length > 0;
  let headline = "";
  let riskNote = "";

  if (travelMode === "renting") {
    headline = "Renting — picks from the full shop catalog";
    riskNote =
      "Hourly timeline shows best catalog matches for your weight and ability. Expand sizes below for ranked models to hire.";
    if (rentalNeeds.length) {
      riskNote += ` Focus on: ${rentalNeeds.map((r) => r.label).join(", ")}.`;
    }
  } else if (travelMode === "packed" && quiverEmpty) {
    headline = "No packed kites selected";
    riskNote = "Tick the kites you brought in Plan setup, or switch to Renting.";
  } else if (quiverEmpty) {
    headline = "Pack a bag — add kites to Quiver or plan to rent";
    riskNote =
      "No kites in the app yet. Sizes below are what the forecast calls for; expand each for best models to hire.";
  } else if (travelMode === "packed" && bring.length) {
    headline = `Packed ${bring.length} kite${bring.length > 1 ? "s" : ""}: ${bring.map((b) => b.name).join(", ")}`;
    riskNote = gusty
      ? "Gusty day — your smallest packed kite is worth rigging too. Hourly picks use only what you brought."
      : "Only kites you ticked as packed are used for recommendations.";
  } else if (bring.length) {
    headline = `Bring ${bring.length} kite${bring.length > 1 ? "s" : ""}: ${bring.map((b) => b.name).join(", ")}`;
    riskNote = gusty
      ? "Gusty day — bringing a smaller kite as well is worth it. Check hourly picks before you rig."
      : "Risk-averse pick: covers forecast hours plus one size up/down where you have them.";
  } else {
    headline =
      travelMode === "packed" ? "Packed bag may not cover this day" : "Your quiver may not cover this day";
    riskNote = "See rental sizes below.";
  }

  if (rentalNeeds.length && !quiverEmpty && travelMode !== "renting") {
    riskNote += ` Rent or borrow: ${rentalNeeds.map((r) => r.label).join(", ")}.`;
  }

  return {
    headline,
    riskNote,
    bring,
    quiverEmpty,
    hasGap: travelMode === "renting" ? rentalNeeds.length > 0 : hasGap,
    rentalNeeds,
    hourly,
    travelMode,
  };
}

/**
 * @param {Set<string>} bringIds
 * @param {number} centerSize
 * @param {Kite[]} kites
 * @param {boolean} [smallerBias]
 */
function addAdjacentSizes(bringIds, centerSize, kites, smallerBias = false) {
  const sorted = [...kites].sort((a, b) => a.size - b.size);
  const idx = sorted.findIndex((k) => Math.abs(k.size - centerSize) < 0.35);
  if (idx < 0) return;
  bringIds.add(sorted[idx].id);
  if (sorted[idx - 1]) bringIds.add(sorted[idx - 1].id);
  if (sorted[idx + 1]) bringIds.add(sorted[idx + 1].id);
  if (smallerBias && sorted[idx - 2]) bringIds.add(sorted[idx - 2].id);
}

/**
 * @param {number} wind
 * @param {number} weight
 * @param {{ minWind: number }} limits
 */
function inferSizeFromWind(wind, weight, limits) {
  const weightFactor = weight / 75;
  const raw = (42 - wind * 1.05) / 2.8 / Math.pow(weightFactor, 0.35);
  const snapped = Math.round(raw * 2) / 2;
  return Math.max(5, Math.min(17, snapped));
}
