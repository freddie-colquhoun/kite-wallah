/**
 * Fair / safe shared-quiver allocation — need and fit, not who "likes" a kite more.
 * Heavier riders are assigned first and penalize oversize on light riders.
 */

import { recommendKite, getKiteWindRange, idealKiteSizeForWind } from "./engine.js";
import { inferPreferredSize } from "./calibration.js";
import { formatKt } from "./format.js";

/** @typedef {import('./kite-allocation.js').RiderAllocInput} RiderAllocInput */
/** @typedef {import('./kite-allocation.js').KiteAssignment} KiteAssignment */
/** @typedef {import('./kite-allocation.js').UnassignedRider} UnassignedRider */
/** @typedef {import('./kite-allocation.js').GroupKiteAllocation} GroupKiteAllocation */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

const MIN_SUITABLE_SCORE = 45;

/**
 * @param {number} windSpeed
 * @param {CalibrationEntry[]} calibration
 * @param {number} riderWeight
 */
export function inferMinAdequateKiteSize(windSpeed, calibration, riderWeight = 75) {
  const near = calibration.filter((e) => Math.abs(e.windSpeed - windSpeed) <= 4);
  let minSize = 0;

  for (const e of near) {
    if (e.feeling === "too-small" || e.feeling === "couldnt-ride") {
      minSize = Math.max(minSize, inferPreferredSize(e));
    }
  }

  if (minSize > 0) {
    if (riderWeight >= 88) minSize += 0.5;
    if (riderWeight >= 98) minSize += 0.5;
  }

  return minSize > 0 ? Math.round(minSize * 2) / 2 : null;
}

/**
 * @param {import('./engine.js').Conditions} conditions
 * @param {Kite} kite
 * @param {number} riderWeight
 * @param {CalibrationEntry[]} calibration
 * @param {number|null} minAdequate
 */
function rawNeedScore(conditions, kite, riderWeight, calibration, minAdequate) {
  const rec = recommendKite(conditions, [kite], calibration);
  if (!rec) return { need: 0, rec: null };

  let need = rec.score;
  const wind = conditions.windSpeed;
  const idealSize = idealKiteSizeForWind(wind, riderWeight);
  const sizeDelta = kite.size - idealSize;

  if (sizeDelta > 1) need -= 35 + Math.round((sizeDelta - 1) * 12);
  else if (sizeDelta > 0.5) need -= 20;
  else if (sizeDelta < -1) need -= 28;
  else if (sizeDelta < -0.5) need -= 12;

  if (minAdequate != null) {
    if (kite.size + 0.25 < minAdequate) need -= 40;
    else if (kite.size >= minAdequate - 0.25) need += 22;
  }

  const range = getKiteWindRange(kite, riderWeight);
  if (wind < range.min) need -= 15;
  else if (wind > range.max + 2) need -= 12;

  return { need: Math.round(Math.max(0, Math.min(100, need))), rec };
}

/**
 * @param {RiderAllocInput} rider
 * @param {Kite[]} allKites
 */
function scoreRiderAgainstAllKites(rider, allKites) {
  const weight = rider.conditions.riderWeight ?? 75;
  const minAdequate = inferMinAdequateKiteSize(
    rider.conditions.windSpeed,
    rider.calibration,
    weight
  );

  const rows = allKites.map((kite) => {
    const { need, rec } = rawNeedScore(
      rider.conditions,
      kite,
      weight,
      rider.calibration,
      minAdequate
    );
    return { kite, need, rec };
  });

  const byNeed = [...rows].sort((a, b) => b.need - a.need);
  const bestAltNeed = byNeed[1]?.need ?? 0;

  const scored = rows.map((row) => ({
    ...row,
    minAdequate,
    necessity: Math.max(0, row.need - bestAltNeed),
  }));

  return {
    scored: scored.sort((a, b) => b.need - a.need),
    solo: recommendKite(rider.conditions, allKites, rider.calibration),
    minAdequate,
    viableCount: scored.filter((s) => s.need >= MIN_SUITABLE_SCORE).length,
    idealSize: idealKiteSizeForWind(rider.conditions.windSpeed, weight),
  };
}

/**
 * @param {RiderAllocInput} rider
 * @param {Kite} assigned
 * @param {import('./engine.js').Kite|null} soloPick
 * @param {number|null} minAdequate
 * @param {import('./engine.js').Conditions} conditions
 * @param {RiderAllocInput[]} allRiders
 */
function buildFairnessNote(rider, assigned, soloPick, minAdequate, conditions, allRiders) {
  const wind = formatKt(conditions.windSpeed);
  const weight = conditions.riderWeight ?? 75;
  const parts = [];

  if (minAdequate != null && assigned.size >= minAdequate - 0.25) {
    parts.push(
      `Needs about ${minAdequate}m+ near ${wind} kt from session history (underpowered on smaller sizes).`
    );
  }

  if (soloPick && soloPick.id !== assigned.id) {
    const soloName = soloPick.name;
    const heavierUnassigned = allRiders.some(
      (r) =>
        r.profileId !== rider.profileId &&
        (r.conditions.riderWeight ?? 75) > weight + 8
    );
    if (heavierUnassigned) {
      parts.push(
        `Solo pick was ${soloName}; ${assigned.name} kept so a heavier rider can take the larger kite in the bag.`
      );
    } else {
      parts.push(
        `Solo pick was ${soloName}; ${assigned.name} assigned so each person has a workable kite in this wind.`
      );
    }
  }

  return parts.length ? parts.join(" ") : null;
}

/**
 * Plain-language guidance when the quiver cannot give everyone a good match.
 * @param {RiderAllocInput[]} riders
 * @param {{ assignments: KiteAssignment[], unassigned: UnassignedRider[] }} alloc
 * @param {Kite[]} allKites
 */
export function buildAllocationConflictGuidance(riders, alloc, allKites) {
  const hasShortage = alloc.unassigned.length > 0;
  const hasSwaps = alloc.assignments.some(
    (a) => a.soloPick && a.soloPick.id !== a.kite.id
  );
  if (!hasShortage && !hasSwaps) return null;

  const wind = riders[0]?.conditions.windSpeed;
  const windLabel = wind != null ? `${formatKt(wind)} kt` : "this wind";
  const byWeight = [...riders].sort(
    (a, b) => (b.conditions.riderWeight ?? 75) - (a.conditions.riderWeight ?? 75)
  );
  const heaviest = byWeight[0];
  const lightest = byWeight[byWeight.length - 1];

  const lines = [
    `Not enough ideal kites for everyone at ${windLabel}. Use weight and confidence — not just who likes a model:`,
    "• Heavier riders usually need more power — they should get the largest kite each of you can hold down.",
    "• Lighter riders do better on smaller sizes; avoid putting the biggest sail on the lightest person unless they are the strongest in gusts.",
  ];

  if (heaviest && lightest && heaviest.profileId !== lightest.profileId) {
    lines.push(
      `• One way to decide: ${heaviest.name} (heaviest, ~${heaviest.conditions.riderWeight ?? "?"} kg) takes the largest suitable kite; the more confident of the others takes the next size down; whoever is least comfortable in strong wind rents or uses the smallest spare.`
    );
  }

  if (hasShortage) {
    const names = alloc.unassigned.map((u) => u.name).join(", ");
    lines.push(`• ${names} may need to rent or sit out unless you can swap bags.`);
  }

  const sizes = [...new Set(allKites.map((k) => k.size))].sort((a, b) => b - a);
  if (sizes.length < riders.length && hasShortage) {
    lines.push(
      `• You have ${sizes.length} size${sizes.length === 1 ? "" : "s"} in the bag for ${riders.length} riders — plan a rental or rotate who rides each window.`
    );
  }

  lines.push(
    "Skills and confidence matter as much as weight — adjust if someone is much stronger or more cautious than the numbers suggest."
  );

  return lines.join("\n");
}

/**
 * @param {RiderAllocInput[]} riders
 * @param {Kite[]} allKites
 * @returns {GroupKiteAllocation & { assignments: (KiteAssignment & { fairnessNote?: string|null })[], conflictGuidance: string|null }}
 */
export function allocateKitesFairly(riders, allKites) {
  const rideable = riders.filter((r) => r.rideable !== false);
  if (!rideable.length) {
    return {
      assignments: [],
      unassigned: [],
      needRental: 0,
      bannerHtml: "",
      conflictGuidance: null,
    };
  }

  if (rideable.length === 1) {
    const r = rideable[0];
    const kiteRec = recommendKite(r.conditions, allKites, r.calibration);
    return {
      assignments: kiteRec
        ? [
            {
              profileId: r.profileId,
              name: r.name,
              kite: kiteRec.kite,
              score: kiteRec.score,
              soloPick: kiteRec.kite,
              kiteRec,
              fairnessNote: null,
            },
          ]
        : [],
      unassigned: kiteRec
        ? []
        : [
            {
              profileId: r.profileId,
              name: r.name,
              reason: "no-kite",
              message: "No kite in the quiver fits this wind.",
              soloPick: null,
            },
          ],
      needRental: 0,
      bannerHtml: "",
      conflictGuidance: null,
    };
  }

  if (!allKites?.length) {
    return {
      assignments: [],
      unassigned: rideable.map((r) => ({
        profileId: r.profileId,
        name: r.name,
        reason: "no-kite",
        message: "Add kites on the Quiver tab.",
        soloPick: null,
      })),
      needRental: rideable.length,
      bannerHtml: "",
      conflictGuidance: buildAllocationConflictGuidance(
        rideable,
        {
          assignments: [],
          unassigned: rideable.map((r) => ({
            profileId: r.profileId,
            name: r.name,
            reason: /** @type {'no-kite'} */ ("no-kite"),
            message: "Add kites on the Quiver tab.",
          })),
        },
        []
      ),
    };
  }

  const enriched = rideable.map((r) => ({
    ...r,
    ...scoreRiderAgainstAllKites(r, allKites),
  }));

  enriched.sort(
    (a, b) =>
      (b.conditions.riderWeight ?? 75) - (a.conditions.riderWeight ?? 75)
  );

  const usedIds = new Set();
  /** @type {KiteAssignment[]} */
  const assignments = [];
  /** @type {UnassignedRider[]} */
  const unassigned = [];

  for (const r of enriched) {
    const suitable = r.scored.filter(
      (s) => s.need >= MIN_SUITABLE_SCORE && !usedIds.has(s.kite.id)
    );
    const fallback = r.scored.find((s) => !usedIds.has(s.kite.id));
    const pick = suitable[0] || fallback;

    if (!pick) {
      unassigned.push({
        profileId: r.profileId,
        name: r.name,
        reason: "shortage",
        message: `${r.name}: no kite left in the quiver — may need to rent.`,
        soloPick: r.solo?.kite ?? null,
      });
      continue;
    }

    if (pick.need < MIN_SUITABLE_SCORE) {
      unassigned.push({
        profileId: r.profileId,
        name: r.name,
        reason: "shortage",
        message: `${r.name}: no good kite left (${pick.kite.name} only ${pick.need}% need-fit). Consider renting.`,
        soloPick: r.solo?.kite ?? null,
      });
      continue;
    }

    usedIds.add(pick.kite.id);
    assignments.push({
      profileId: r.profileId,
      name: r.name,
      kite: pick.kite,
      score: pick.need,
      soloPick: r.solo?.kite ?? null,
      kiteRec: pick.rec,
      fairnessNote: buildFairnessNote(
        r,
        pick.kite,
        r.solo?.kite ?? null,
        r.minAdequate,
        r.conditions,
        rideable
      ),
    });
  }

  const needRental = unassigned.filter((u) => u.reason === "shortage").length;
  const result = { assignments, unassigned, needRental, bannerHtml: "" };
  const conflictGuidance = buildAllocationConflictGuidance(rideable, result, allKites);

  return { ...result, conflictGuidance };
}
