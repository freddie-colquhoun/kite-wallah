import { getAbilityLabel } from "./ability-levels.js";
import { sessionLevelLabel } from "./session-rating.js";
import { formatKt } from "./format.js";
import { gustSpread } from "./wind-session-copy.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */

/**
 * @param {object} p
 * @param {import('./planner.js').RideableWindSummary} p.rideable
 * @param {import('./session-rating.js').SessionLevel} p.dayVerdict
 * @param {ReturnType<import('./engine.js').assessSuitability>} p.suitability
 * @param {{ kite?: { name: string, size: number }|null }} p.kiteRec
 * @param {RiderProfile} p.profile
 */
export function buildPlanDayBrief({ rideable, dayVerdict, suitability, kiteRec, profile }) {
  const spread = gustSpread(rideable.avgWind, rideable.peakGust);
  const coreFacts = [
    { label: "Rating", value: sessionLevelLabel(dayVerdict) },
    {
      label: "Wind",
      value: `${formatKt(rideable.avgWind)} kt avg${rideable.windDirection ? ` ${rideable.windDirection}` : ""}`,
    },
    {
      label: "Gusts",
      value: rideable.peakGust != null ? `to ${formatKt(rideable.peakGust)} kt` : " · ",
    },
    { label: "Kite", value: kiteRec?.kite?.name ?? " · " },
  ];

  const blurbParts = [];
  blurbParts.push(
    `${profile.name} (${getAbilityLabel(profile.ability)}): ${sessionLevelLabel(dayVerdict)} for ${rideable.label}.`
  );

  if (spread > 12) {
    blurbParts.push(
      `Avg ${formatKt(rideable.avgWind)} kt with gusts to ${formatKt(rideable.peakGust)} kt  ·  size for gusts, not the lulls.`
    );
  } else if (rideable.avgWind >= suitability.limits.minWind + 2) {
    blurbParts.push(`Powered enough for your usual ${suitability.limits.minWind}-${suitability.limits.maxWind} kt band.`);
  } else {
    blurbParts.push(`On the lighter side for your level  ·  patience and kite size matter.`);
  }

  if (kiteRec?.kite) {
    blurbParts.push(`Quiver pick: ${kiteRec.kite.name}.`);
  } else if (!profile.calibration?.length) {
    blurbParts.push(`Log past sessions under Sessions to compare with real days on the water.`);
  }

  return { coreFacts, suitabilityBlurb: blurbParts.join(" ") };
}
