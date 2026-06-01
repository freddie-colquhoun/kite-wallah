/**
 * Structured decision payload for v2 AI (explain / review). Rules compute this; AI only narrates it.
 */

import { scoreKiteForConditions } from "./engine.js";
import { profileToConditions, getProfile } from "./storage.js";
import { sessionLevelLabel } from "./session-rating.js";
import { buildRelevantSessionNote } from "./session-comparison.js";
import { describeKiteFitShort } from "./kite-fit-copy.js";

/**
 * @param {import('./storage.js').RiderProfile} profile
 * @param {import('./engine.js').Kite[]} kites
 * @param {number} windKt
 * @param {number|null|undefined} gustKt
 * @param {string} spotNotes
 * @param {string} waterType
 */
function scoreQuiverForRider(profile, kites, windKt, gustKt, spotNotes, waterType) {
  const conditions = profileToConditions(
    profile,
    spotNotes,
    windKt,
    gustKt ?? null,
    null,
    waterType
  );
  return kites
    .map((kite) => {
      const row = scoreKiteForConditions(conditions, kite, profile.calibration);
      return {
        id: kite.id,
        name: kite.name,
        size: kite.size,
        score: row.score,
        fit: describeKiteFitShort(row.score),
        rangeKt: `${row.range.min}-${row.range.max}`,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {import('./planner.js').DayPlan} day
 * @param {import('./spots-storage.js').KiteSpot} spot
 * @param {string} spotNotes
 * @param {import('./session-rating.js').SessionLevel} dayVerdict
 * @param {Array<{ plan: import('./planner.js').RiderPlan, day: import('./planner.js').DayPlan }>} entries
 * @param {import('./kite-allocation.js').GroupKiteAllocation|null} dayAlloc
 * @param {import('./engine.js').Kite[]} packedKites
 * @param {import('./storage.js').AppState} state
 */
export function buildPlanDayDecisionBundle(
  day,
  spot,
  spotNotes,
  dayVerdict,
  entries,
  dayAlloc,
  packedKites,
  state
) {
  const rec = day.recommendation;
  const timingTips = (day.tips ?? []).filter((t) =>
    ["Rideable", "Best window", "Gust pattern", "When to rig"].includes(t.title)
  );

  /** @type {object[]} */
  const riders = [];
  for (const { plan, day: riderDay } of entries) {
    const profile = getProfile(state, plan.profileId);
    if (!profile) continue;
    const recR = riderDay.recommendation;
    const assign = dayAlloc?.assignments.find((a) => a.profileId === plan.profileId);
    const unassigned = dayAlloc?.unassigned.find((u) => u.profileId === plan.profileId);
    const windKt = recR?.avgWind ?? rec?.avgWind ?? 0;
    const logNote = recR
      ? buildRelevantSessionNote(profile.calibration, spot, {
          windSpeed: recR.avgWind,
          gustSpeed: recR.peakGust,
          windDirection: recR.windDirection,
        }, {
          recommendedKiteSize: assign?.kite?.size ?? null,
          recommendedKiteName: assign?.kite?.name ?? recR.kiteName ?? null,
        })?.body ?? null
      : null;

    riders.push({
      name: plan.profileName,
      profileId: plan.profileId,
      weightKg: profile.weight,
      verdict: recR?.verdict ?? riderDay.dayVerdict,
      flyKiteId: assign?.kite?.id ?? null,
      flyKiteName: assign?.kite?.name ?? recR?.kiteName ?? null,
      flyScore: assign?.score ?? null,
      idealKiteName: assign?.soloPick?.name ?? null,
      unassigned: Boolean(unassigned),
      unassignedReason: unassigned?.message ?? null,
      logNote,
      quiverScores: scoreQuiverForRider(
        profile,
        packedKites,
        windKt,
        recR?.peakGust,
        spotNotes,
        spot.waterType
      ),
    });
  }

  return {
    kind: "plan-day",
    id: `plan-${day.date}`,
    date: day.date,
    dateLabel: day.dateLabel,
    spotName: spot.name,
    dayVerdict,
    dayVerdictLabel: sessionLevelLabel(dayVerdict),
    window: rec
      ? {
          label: rec.windowLabel,
          avgWindKt: rec.avgWind,
          peakGustKt: rec.peakGust,
          direction: rec.windDirection,
          skipNote: rec.skipNote,
          timingNote: rec.timingNote,
        }
      : null,
    timingTips: timingTips.map((t) => ({ title: t.title, text: t.text })),
    tideTimes: day.tideTimes ?? null,
    riders,
    allowedKiteIds: packedKites.map((k) => k.id),
    bringSummary: day.bringKit?.headline ?? null,
    isCrewDay: entries.length > 1,
  };
}

/**
 * @param {object} p
 * @param {import('./storage.js').RiderProfile} p.profile
 * @param {ReturnType<typeof profileToConditions>} p.conditions
 * @param {ReturnType<typeof import('./engine.js').analyze>} p.analysis
 * @param {import('./kite-allocation.js').KiteAssignment|null} p.assignment
 * @param {import('./spots-storage.js').KiteSpot|null} p.spot
 * @param {import('./engine.js').Kite[]} p.quiverKites
 * @param {import('./session-rating.js').SessionLevel} p.sessionLevel
 */
export function buildNowDecisionBundle({
  profile,
  conditions,
  analysis,
  assignment,
  spot,
  quiverKites,
  sessionLevel,
}) {
  const kiteRec = assignment?.kiteRec ?? analysis.kiteRec;
  const flyKite = assignment?.kite ?? kiteRec?.kite ?? null;
  const logNote =
    buildRelevantSessionNote(profile.calibration, spot, {
      windSpeed: conditions.windSpeed,
      gustSpeed: conditions.gustSpeed,
      windDirection: conditions.windDirection,
    }, {
      recommendedKiteSize: flyKite?.size ?? null,
      recommendedKiteName: flyKite?.name ?? null,
    })?.body ?? null;

  return {
    kind: "now",
    id: `now-${profile.id}-${spot?.id ?? "adhoc"}`,
    spotName: spot?.name ?? "Manual wind",
    riderName: profile.name,
    weightKg: profile.weight,
    sessionLevel,
    sessionLabel: sessionLevelLabel(sessionLevel),
    suitabilityScore: analysis.suitability.score,
    windKt: conditions.windSpeed,
    gustKt: conditions.gustSpeed,
    direction: conditions.windDirection,
    flyKiteId: flyKite?.id ?? null,
    flyKiteName: flyKite?.name ?? null,
    flyScore: assignment?.score ?? kiteRec?.score ?? null,
    idealKiteName: assignment?.soloPick?.name ?? null,
    boardName: analysis.boardRec?.board?.name ?? null,
    launchOk: analysis.spotEval?.launchOk !== false,
    tideOk: analysis.spotEval?.tideAccessOk !== false,
    logNote,
    quiverScores: scoreQuiverForRider(
      profile,
      quiverKites,
      conditions.windSpeed,
      conditions.gustSpeed,
      conditions.spotNotes,
      conditions.waterType
    ),
    allowedKiteIds: quiverKites.map((k) => k.id),
    notes: analysis.suitability.notes?.slice(0, 5) ?? [],
  };
}
