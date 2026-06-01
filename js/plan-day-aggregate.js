/**
 * Shared day view for multi-rider Plan — one forecast, per-rider kite blocks.
 */

import { describeConditions, assessSuitability } from "./engine.js";
import { evaluateSpot } from "./spot-engine.js";
import { profileToConditions } from "./storage.js";
import { sessionLevelLabel } from "./session-rating.js";
import { cleanCopy } from "./copy-format.js";

/** @typedef {import('./planner.js').RiderPlan} RiderPlan */
/** @typedef {import('./planner.js').DayPlan} DayPlan */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */
/** @typedef {import('./kite-allocation.js').GroupKiteAllocation} GroupKiteAllocation */

const VERDICT_RANK = { go: 5, possible: 4, maybe: 3, "probably-not": 2, no: 1 };

/**
 * @param {import('./session-rating.js').SessionLevel[]} verdicts
 */
export function pickCrewDayVerdict(verdicts) {
  let best = "no";
  let bestRank = 0;
  for (const v of verdicts) {
    const r = VERDICT_RANK[v] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = v;
    }
  }
  return /** @type {import('./session-rating.js').SessionLevel} */ (best);
}

/**
 * Generic on-the-water feel for the day (no single rider's session bias).
 * @param {DayPlan} day
 * @param {KiteSpot} spot
 * @param {string} spotNotes
 */
export function buildSharedDayTips(day, spot, spotNotes) {
  const rec = day.recommendation;
  if (!rec) return [];

  const conditions = profileToConditions(
    {
      ability: "competent",
      weight: 75,
      sex: "unspecified",
    },
    spotNotes,
    rec.avgWind,
    rec.peakGust,
    rec.windDirection,
    spot.waterType
  );

  const spotEval = evaluateSpot(spot, conditions, null);
  const suitability = assessSuitability(conditions, [], spotEval);

  const skip = new Set(["Your spot", "How confident are we?", "On the water"]);
  const tips = describeConditions(conditions, suitability, [], { spot, spotEval })
    .filter((s) => !skip.has(s.title))
    .map((s) => ({ ...s, text: cleanCopy(s.text) }));

  const timing = day.tips?.find((t) => t.title === "Best time on the water");
  if (timing) {
    tips.unshift({ title: timing.title, text: cleanCopy(timing.text) });
  }

  if (rec.skipNote) {
    tips.push({ title: "When to rig", text: cleanCopy(rec.skipNote) });
  }

  const gust = rec.peakGust != null ? rec.peakGust - rec.avgWind : 0;
  if (gust >= 10) {
    tips.unshift({
      title: "On the water",
      text: `Crew average ${rec.avgWind} kt with gusts to ${rec.peakGust} kt — gust-management day; size for the average and keep kites high.`,
    });
  } else {
    tips.unshift({
      title: "On the water",
      text: `Around ${rec.avgWind} kt ${rec.windDirection || ""} across ${rec.windowLabel}. Rider kite picks below account for weight and who needs power, not who prefers which kite.`,
    });
  }

  return tips;
}

/**
 * Merge bring lists from all riders for one day.
 * @param {import('./plan-bring-kit.js').PlanBringKit[]} kits
 */
export function mergeCrewBringKit(kits) {
  const valid = kits.filter(Boolean);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  /** @type {Map<string, import('./plan-bring-kit.js').PlanBringKit['bring'][0]>} */
  const bringMap = new Map();
  for (const kit of valid) {
    for (const b of kit.bring) {
      if (!bringMap.has(b.id)) bringMap.set(b.id, b);
    }
  }

  const rentalBySize = new Map();
  for (const kit of valid) {
    for (const r of kit.rentalNeeds) {
      const cur = rentalBySize.get(r.size);
      if (!cur || r.ranked.length > cur.ranked.length) rentalBySize.set(r.size, r);
    }
  }

  const hasGap = valid.some((k) => k.hasGap);
  const bring = [...bringMap.values()].sort((a, b) => a.size - b.size);

  const names = bring.map((b) => b.name).join(", ");
  return {
    headline: bring.length
      ? `Pack ${bring.length} kite${bring.length === 1 ? "" : "s"}: ${names}`
      : "Nothing to pack from the forecast",
    riskNote: hasGap
      ? "Rent or borrow any sizes listed below if the bag does not cover everyone."
      : "Covers the crew for this day based on the picks above.",
    bring,
    quiverEmpty: valid.every((k) => k.quiverEmpty),
    hasGap,
    rentalNeeds: [...rentalBySize.values()].sort((a, b) => a.size - b.size),
    hourly: valid[0].hourly,
  };
}

/**
 * @param {string} date
 * @param {RiderPlan[]} plans
 */
export function getRiderDayEntries(date, plans) {
  return plans
    .map((plan) => {
      const day = plan.days.find((d) => d.date === date);
      if (!day) return null;
      return { plan, day };
    })
    .filter(Boolean);
}
