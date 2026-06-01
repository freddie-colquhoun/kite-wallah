/**
 * Shared day view for multi-rider Plan — one forecast, per-rider kite blocks.
 */

import { describeConditions, assessSuitability } from "./engine.js";
import { evaluateSpot } from "./spot-engine.js";
import { profileToConditions } from "./storage.js";
import { sessionLevelLabel, SESSION_LEVEL_META } from "./session-rating.js";
import { cleanCopy } from "./copy-format.js";
import { buildCrewPastSessionLines } from "./session-comparison.js";
import { formatKt } from "./format.js";

/** @typedef {import('./planner.js').RiderPlan} RiderPlan */
/** @typedef {import('./planner.js').DayPlan} DayPlan */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */
/** @typedef {import('./kite-allocation.js').GroupKiteAllocation} GroupKiteAllocation */
/** @typedef {import('./session-rating.js').SessionLevel} SessionLevel */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

const VERDICT_RANK = { go: 5, possible: 4, maybe: 3, "probably-not": 2, no: 1 };

/**
 * Crew day label uses the most conservative rider verdict (weakest link).
 * @param {import('./session-rating.js').SessionLevel[]} verdicts
 */
export function pickCrewDayVerdict(verdicts) {
  if (!verdicts.length) return "no";
  let worst = verdicts[0];
  let worstRank = VERDICT_RANK[worst] ?? 0;
  for (const v of verdicts) {
    const r = VERDICT_RANK[v] ?? 0;
    if (r < worstRank) {
      worstRank = r;
      worst = v;
    }
  }
  return /** @type {SessionLevel} */ (worst);
}

/**
 * @param {SessionLevel} verdict
 * @param {import('./planner.js').PlanDayRecommendation} rec
 */
function crewDayNarrative(verdict, rec) {
  const gust =
    rec.peakGust != null ? `, gusts to ${formatKt(rec.peakGust)} kt` : "";
  const dir = rec.windDirection ? ` from the ${rec.windDirection}` : "";
  const short = SESSION_LEVEL_META[verdict]?.short ?? sessionLevelLabel(verdict);

  switch (verdict) {
    case "go":
      return `${short}: powered riding ${rec.windowLabel} at ~${formatKt(rec.avgWind)} kt${gust}${dir}. A strong crew day if launch and tide work for you.`;
    case "possible":
      return `${short}: ${rec.windowLabel} around ~${formatKt(rec.avgWind)} kt${gust}${dir}. Worth going with realistic kit; some riders may prefer to sit out gust spikes.`;
    case "maybe":
      return `${short}: borderline power in ${rec.windowLabel} (~${formatKt(rec.avgWind)} kt${gust}). Fine for confident riders; others may find it marginal.`;
    case "probably-not":
      return `${short}: weak odds in ${rec.windowLabel}. Only keen riders with the right kite and patience.`;
    default:
      return `${short}: no solid powered window in ${rec.windowLabel} for the crew.`;
  }
}

/**
 * @param {import('./planner.js').PlanDayRecommendation} rec
 * @param {KiteSpot} spot
 * @param {ReturnType<typeof evaluateSpot>} spotEval
 */
function conditionsAtAGlance(rec, spot, spotEval) {
  const parts = [
    `${spot.name}: main window ${rec.windowLabel}`,
    `~${formatKt(rec.avgWind)} kt${rec.windDirection ? ` ${rec.windDirection}` : ""}`,
  ];
  if (rec.peakGust != null) parts.push(`gusts to ${formatKt(rec.peakGust)} kt`);
  if (spotEval.windDirectionStatus === "bad") {
    parts.push("launch direction unsafe today");
  } else if (!spotEval.launchOk) {
    parts.push("launch direction marginal or offshore");
  } else {
    parts.push("launch direction OK for the spot");
  }
  return parts.join(" · ") + ".";
}

/**
 * Shared on-the-water narrative for the crew (no single-rider kit bias).
 * @param {import('./planner.js').PlanDayRecommendation} rec
 */
function crewOnWaterNarrative(rec) {
  const gust = rec.peakGust != null ? rec.peakGust - rec.avgWind : 0;
  if (gust >= 10) {
    return `Crew average ${formatKt(rec.avgWind)} kt with gusts to ${formatKt(rec.peakGust)} kt — gust-management day: size for the average, keep kites high, and expect power spikes.`;
  }
  if (rec.avgWind <= 14) {
    return `Light-to-moderate wind (~${formatKt(rec.avgWind)} kt) in ${rec.windowLabel}: technical riding, steady kite movement, and patience upwind.`;
  }
  if (rec.avgWind <= 20) {
    return `Moderate-to-solid wind (~${formatKt(rec.avgWind)} kt) in ${rec.windowLabel}: good freeride band for cruising, transitions, and jumps if gusts stay manageable.`;
  }
  return `Strong wind (~${formatKt(rec.avgWind)} kt${rec.peakGust != null ? `, gusts to ${formatKt(rec.peakGust)} kt` : ""}) in ${rec.windowLabel}: fast riding, heavy load on the legs, and conservative kite choices.`;
}

/**
 * Generic on-the-water feel for the day (no single rider's session bias).
 * @param {DayPlan} day
 * @param {KiteSpot} spot
 * @param {string} spotNotes
 * @param {{ crewVerdict?: SessionLevel, riders?: { name: string, calibration: CalibrationEntry[] }[] }} [opts]
 */
export function buildSharedDayTips(day, spot, spotNotes, opts = {}) {
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

  /** @type {{ title: string, text: string }[]} */
  const tips = [];

  if (opts.crewVerdict) {
    tips.push({ title: "The day", text: crewDayNarrative(opts.crewVerdict, rec) });
  }

  tips.push({
    title: "Conditions",
    text: conditionsAtAGlance(rec, spot, spotEval),
  });

  tips.push({ title: "On the water", text: crewOnWaterNarrative(rec) });

  const skip = new Set([
    "Your spot",
    "How confident are we?",
    "On the water",
    "The day",
    "Conditions",
  ]);

  const fromEngine = describeConditions(conditions, suitability, [], {
    spot,
    spotEval,
  })
    .filter((s) => !skip.has(s.title))
    .map((s) => ({ ...s, text: cleanCopy(s.text) }));

  tips.push(...fromEngine);

  const timing = day.tips?.find((t) => t.title === "Best time on the water");
  if (timing && !tips.some((t) => t.title === timing.title)) {
    tips.push({ title: timing.title, text: cleanCopy(timing.text) });
  }

  if (rec.skipNote) {
    tips.push({ title: "When to rig", text: cleanCopy(rec.skipNote) });
  }

  const riders = opts.riders ?? [];
  if (riders.length) {
    const past = buildCrewPastSessionLines(riders, spot, {
      windSpeed: rec.avgWind,
      gustSpeed: rec.peakGust,
      windDirection: rec.windDirection,
    });
    for (const line of past) {
      tips.push({ title: "From your logs", text: cleanCopy(line) });
    }
  }

  return tips;
}

/**
 * Kites assigned in Who flies what — always included in the crew pack list.
 * @param {import('./kite-allocation.js').GroupKiteAllocation|null|undefined} dayAlloc
 * @returns {import('./engine.js').Kite[]}
 */
export function kitesFromDayAllocation(dayAlloc) {
  if (!dayAlloc?.assignments?.length) return [];
  return dayAlloc.assignments.map((a) => a.kite).filter(Boolean);
}

/**
 * Merge bring lists from all riders for one day, plus crew allocation assignments.
 * Hourly per-rider bring can omit allocated kites; dayAlloc fixes that.
 * @param {import('./plan-bring-kit.js').PlanBringKit[]} kits
 * @param {import('./kite-allocation.js').GroupKiteAllocation|null} [dayAlloc]
 */
export function mergeCrewBringKit(kits, dayAlloc = null) {
  const valid = kits.filter(Boolean);
  const fromAlloc = kitesFromDayAllocation(dayAlloc);
  /** @type {Map<string, import('./engine.js').Kite>} */
  const allocById = new Map();
  for (const kite of fromAlloc) {
    if (kite?.id) allocById.set(kite.id, kite);
  }
  const allocationKites = [...allocById.values()];

  if (!valid.length && !allocationKites.length) return null;
  if (valid.length === 1 && !allocationKites.length) return valid[0];

  /** @type {Map<string, import('./plan-bring-kit.js').PlanBringKit['bring'][0]>} */
  const bringMap = new Map();
  for (const kit of valid) {
    for (const b of kit.bring) {
      if (!bringMap.has(b.id)) bringMap.set(b.id, b);
    }
  }

  const assignedIds = new Set(allocationKites.map((k) => k.id).filter(Boolean));

  for (const kite of allocationKites) {
    if (!kite?.id) continue;
    bringMap.set(kite.id, {
      id: kite.id,
      name: kite.name,
      size: kite.size,
      note: "Who flies what · rig this",
    });
  }

  for (const [id, item] of bringMap) {
    if (assignedIds.has(id)) continue;
    if (/main ride window/i.test(item.note)) {
      bringMap.set(id, {
        ...item,
        note: "Gust backup · not assigned to a rider",
      });
    }
  }

  const rentalBySize = new Map();
  for (const kit of valid) {
    for (const r of kit.rentalNeeds ?? []) {
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
    riskNote: allocationKites.length
      ? "Includes every kite assigned in Who flies what — plus forecast coverage for the main window."
      : hasGap
        ? "Rent or borrow any sizes listed below if the bag does not cover everyone."
        : "Covers the crew for this day based on the picks above.",
    bring,
    quiverEmpty: valid.length ? valid.every((k) => k.quiverEmpty) : false,
    hasGap,
    rentalNeeds: [...rentalBySize.values()].sort((a, b) => a.size - b.size),
    hourly: valid[0]?.hourly ?? [],
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
