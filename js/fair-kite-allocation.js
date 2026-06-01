/**
 * Fair / safe shared-quiver allocation — need and fit, not who "likes" a kite more.
 */

import { recommendKite, getKiteWindRange } from "./engine.js";
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

  if (minAdequate != null) {
    if (kite.size + 0.25 < minAdequate) need -= 40;
    else if (kite.size >= minAdequate - 0.25) need += 22;
  }

  const range = getKiteWindRange(kite, riderWeight);
  if (conditions.windSpeed < range.min) need -= 15;
  else if (conditions.windSpeed > range.max + 2) need -= 12;

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
  const parts = [];

  if (minAdequate != null && assigned.size >= minAdequate - 0.25) {
    parts.push(
      `Needs about ${minAdequate}m+ near ${wind} kt from session history (underpowered on smaller sizes).`
    );
  }

  if (soloPick && soloPick.id !== assigned.id) {
    const soloName = soloPick.name;
    const heavier = allRiders.some(
      (r) =>
        r.profileId !== rider.profileId &&
        (r.conditions.riderWeight ?? 75) < (conditions.riderWeight ?? 75) - 12
    );
    if (heavier) {
      parts.push(
        `Solo pick was ${soloName}, but the ${assigned.size}m goes to the rider who needs the power here — fairness over preference.`
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
 * @param {RiderAllocInput[]} riders
 * @param {Kite[]} allKites
 * @returns {GroupKiteAllocation & { assignments: (KiteAssignment & { fairnessNote?: string|null })[] }}
 */
export function allocateKitesFairly(riders, allKites) {
  const rideable = riders.filter((r) => r.rideable !== false);
  if (!rideable.length) {
    return { assignments: [], unassigned: [], needRental: 0, bannerHtml: "" };
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
    };
  }

  const enriched = rideable.map((r) => ({
    ...r,
    ...scoreRiderAgainstAllKites(r, allKites),
  }));

  enriched.sort((a, b) => a.viableCount - b.viableCount);

  const usedIds = new Set();
  /** @type {KiteAssignment[]} */
  const assignments = [];
  /** @type {UnassignedRider[]} */
  const unassigned = [];

  const kitesBySize = groupKitesBySize(allKites);

  for (const kitesAtSize of kitesBySize.values()) {
    if (kitesAtSize.length !== 1) continue;
    const kite = kitesAtSize[0];
    if (usedIds.has(kite.id)) continue;

    /** @type {{ rider: (typeof enriched)[0], necessity: number, need: number }[]} */
    const contenders = [];
    for (const r of enriched) {
      if (assignments.some((a) => a.profileId === r.profileId)) continue;
      const row = r.scored.find((s) => s.kite.id === kite.id);
      if (!row || row.need < MIN_SUITABLE_SCORE) continue;
      const needsSize =
        r.minAdequate != null && kite.size >= r.minAdequate - 0.25;
      if (needsSize || row.necessity >= 12) {
        contenders.push({ rider: r, necessity: row.necessity, need: row.need });
      }
    }

    if (!contenders.length) continue;

    contenders.sort((a, b) => b.necessity - a.necessity || b.need - a.need);
    const winner = contenders[0].rider;
    const row = winner.scored.find((s) => s.kite.id === kite.id);
    usedIds.add(kite.id);
    assignments.push({
      profileId: winner.profileId,
      name: winner.name,
      kite,
      score: row.need,
      soloPick: winner.solo?.kite ?? null,
      kiteRec: row.rec,
      fairnessNote: buildFairnessNote(
        winner,
        kite,
        winner.solo?.kite ?? null,
        winner.minAdequate,
        winner.conditions,
        rideable
      ),
    });
  }

  for (const r of enriched) {
    if (assignments.some((a) => a.profileId === r.profileId)) continue;

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
  return { assignments, unassigned, needRental, bannerHtml: "" };
}

/** @param {Kite[]} kites */
function groupKitesBySize(kites) {
  /** @type {Map<string, Kite[]>} */
  const map = new Map();
  for (const k of kites) {
    const key = String(k.size);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(k);
  }
  return map;
}
