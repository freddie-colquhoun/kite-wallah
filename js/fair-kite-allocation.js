/**
 * Shared-quiver allocation for crew Plan / Now.
 *
 * Flow:
 * 1. Score each rider × each kite (scoreKiteForConditions — same as recommendKite / Ideal).
 * 2. Sort pick order: weight (kg) descending — heaviest picks first. Riders with only one safe kite in the bag go first.
 * 3. Each turn: largest SAFE unused kite; first picker also meets power target − 0.5 m.
 * 4. Rent only when no safe kite remains.
 */

import {
  recommendKite,
  scoreKiteForConditions,
  getKiteWindRange,
  idealKiteSizeForWind,
} from "./engine.js";
import { getSkillLimits, normalizeAbility } from "./ability-levels.js";
import {
  inferPreferredSize,
  getCalibrationAtWind,
  isUnderpoweredFeeling,
} from "./calibration.js";
import { describeWindVsKiteRange } from "./kite-personal-range.js";
import { escapeHtml } from "./dom-safe.js";
import { formatKt } from "./format.js";

/** @typedef {import('./kite-allocation.js').RiderAllocInput} RiderAllocInput */
/** @typedef {import('./kite-allocation.js').KiteAssignment} KiteAssignment */
/** @typedef {import('./kite-allocation.js').UnassignedRider} UnassignedRider */
/** @typedef {import('./kite-allocation.js').GroupKiteAllocation} GroupKiteAllocation */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {ReturnType<typeof scoreKiteForConditions>} KiteScoredRow */

/** @typedef {{ kite: Kite, need: number, scored: KiteScoredRow, rec: ReturnType<typeof recommendKite> }} ScoredRow */

export const MIN_SUITABLE_SCORE = 45;

/**
 * @param {number} windSpeed
 * @param {CalibrationEntry[]} calibration
 * @param {number} riderWeight
 */
export function inferMinAdequateKiteSize(windSpeed, calibration, riderWeight = 75) {
  const near = calibration.filter((e) => Math.abs(e.windSpeed - windSpeed) <= 4);
  let minSize = 0;

  for (const e of near) {
    if (isUnderpoweredFeeling(e.feeling)) {
      let preferred = inferPreferredSize(e);
      if (windSpeed < e.windSpeed - 2) {
        preferred += Math.min(1.5, ((e.windSpeed - windSpeed) / 4) * 0.5);
      }
      minSize = Math.max(minSize, preferred);
    }
  }

  if (minSize > 0) {
    if (riderWeight >= 88) minSize += 0.5;
    if (riderWeight >= 98) minSize += 0.5;
  }

  return minSize > 0 ? Math.round(minSize * 2) / 2 : null;
}

/** @param {import('./engine.js').Conditions['skillLevel']} skillLevel */
function abilityKiteWindSlack(skillLevel) {
  const level = normalizeAbility(skillLevel);
  if (level === "expert") return { belowCatalogMin: 2, aboveCatalogMax: 5 };
  if (level === "advanced" || level === "jumper") return { belowCatalogMin: 1.5, aboveCatalogMax: 3 };
  if (level === "competent") return { belowCatalogMin: 1, aboveCatalogMax: 2 };
  return { belowCatalogMin: 0.5, aboveCatalogMax: 1 };
}

/** @param {KiteScoredRow} row @param {import('./engine.js').Conditions} conditions */
function scoredRowToKiteRec(row, conditions) {
  return {
    kite: row.kite,
    score: row.score,
    catalogRange: row.catalog,
    effectiveRange: row.effective,
    comfortBand: row.band,
    comfortNote: describeWindVsKiteRange(conditions.windSpeed, row.effective),
    range: { min: row.range.min, ideal: row.range.ideal, max: row.range.max },
  };
}

/**
 * @param {RiderAllocInput & { minAdequate?: number|null }} rider
 * @param {ScoredRow} row
 */
function isKiteSafeForRider(rider, row) {
  const { conditions } = rider;
  const wind = conditions.windSpeed;
  const weight = conditions.riderWeight ?? 75;
  const skill = normalizeAbility(conditions.skillLevel ?? "competent");
  const slack = abilityKiteWindSlack(skill);
  const limits = getSkillLimits(skill);
  const catalog = row.scored.catalog;
  const band = row.scored.band;
  const minAdequate =
    rider.minAdequate ??
    inferMinAdequateKiteSize(wind, rider.calibration ?? [], weight);

  if (row.need < 5) return false;
  if (wind < limits.minWind - 3) return false;
  if (wind > limits.maxWind + slack.aboveCatalogMax) return false;
  if (minAdequate != null && row.kite.size + 0.5 < minAdequate) return false;
  if (wind < catalog.min - slack.belowCatalogMin - 1) return false;
  if (band === "light" && wind < catalog.min - slack.belowCatalogMin) return false;

  const catalogMaxAllowed = catalog.max + slack.aboveCatalogMax;
  if (wind > catalogMaxAllowed + 1) return false;

  if (band === "strong") {
    if (skill === "expert" || skill === "advanced") {
      return wind <= catalog.max + slack.aboveCatalogMax + 2;
    }
    if (skill === "jumper" || skill === "competent") {
      return wind <= catalog.max + slack.aboveCatalogMax;
    }
    return wind <= catalog.max + 0.5;
  }

  return true;
}

/** @param {RiderAllocInput & { scored: ScoredRow[] }} r */
function countViableKitesForRider(r) {
  return r.scored.filter(
    (s) => s.need >= MIN_SUITABLE_SCORE && isKiteSafeForRider(r, s)
  ).length;
}

/** @param {RiderAllocInput & { idealSize?: number, minAdequate?: number|null, solo?: ReturnType<typeof recommendKite>|null, calibration?: CalibrationEntry[] }} r */
function targetPowerSizeForRider(r) {
  const weight = r.conditions.riderWeight ?? 75;
  const wind = r.conditions.windSpeed;
  const cal = getCalibrationAtWind(wind, r.calibration ?? []);

  let target;
  if (cal.preferredSize != null && (cal.confidence === "high" || cal.confidence === "medium")) {
    target = cal.preferredSize;
  } else {
    target = r.idealSize ?? idealKiteSizeForWind(wind, weight);
    if (cal.preferredSize != null) target = Math.max(target, cal.preferredSize);
  }

  if (r.minAdequate != null) target = Math.max(target, r.minAdequate);

  const idealSize = r.solo?.kite?.size;
  if (idealSize != null && (r.solo?.score ?? 0) >= 40 && idealSize >= target - 0.25) {
    target = Math.max(target, idealSize);
  }

  return Math.round(target * 2) / 2;
}

/**
 * @param {ScoredRow[]} pool
 * @param {boolean} isFirstPicker
 * @param {number} powerTarget
 */
function pickBestFromPool(pool, isFirstPicker, powerTarget) {
  let candidates = pool;
  if (isFirstPicker) {
    const meets = pool.filter((s) => s.kite.size >= powerTarget - 0.5);
    candidates = meets.length ? meets : pool;
  }

  return (
    [...candidates].sort((a, b) => {
      if (b.kite.size !== a.kite.size) return b.kite.size - a.kite.size;
      if (isFirstPicker) {
        const gapA = Math.abs(a.kite.size - powerTarget);
        const gapB = Math.abs(b.kite.size - powerTarget);
        if (gapA !== gapB) return gapA - gapB;
      }
      return b.need - a.need;
    })[0] ?? null
  );
}

/** Target size (m) for Ideal / power — sessions first, then chart, then weight. */
function idealTargetSizeForRider(rider) {
  const weight = rider.conditions.riderWeight ?? 75;
  const wind = rider.conditions.windSpeed;
  const cal = getCalibrationAtWind(wind, rider.calibration ?? []);
  const minAdequate = inferMinAdequateKiteSize(wind, rider.calibration ?? [], weight);

  let target;
  if (cal.preferredSize != null && (cal.confidence === "high" || cal.confidence === "medium")) {
    // Session history is the primary signal when we have enough of it
    target = cal.preferredSize;
  } else {
    target = idealKiteSizeForWind(wind, weight);
    if (cal.preferredSize != null) target = Math.max(target, cal.preferredSize);
  }

  if (minAdequate != null) target = Math.max(target, minAdequate);
  return Math.round(target * 2) / 2;
}

/**
 * Ideal = best kite at or above target power size (not a smaller high-scoring kite).
 * @param {RiderAllocInput} rider
 * @param {Kite[]} allKites
 * @param {ScoredRow[]} scored
 */
function pickIdealKiteRecommendation(rider, allKites, scored) {
  const target = idealTargetSizeForRider(rider);
  const adequate = scored.filter((s) => s.kite.size >= target - 0.5);
  const pool = adequate.length
    ? adequate.map((s) => s.kite)
    : allKites;
  return recommendKite(rider.conditions, pool, rider.calibration);
}

/** @param {RiderAllocInput} rider @param {Kite[]} allKites */
function scoreRiderAgainstAllKites(rider, allKites) {
  const weight = rider.conditions.riderWeight ?? 75;
  const minAdequate = inferMinAdequateKiteSize(
    rider.conditions.windSpeed,
    rider.calibration,
    weight
  );

  const scored = allKites
    .map((kite) => {
      const row = scoreKiteForConditions(
        rider.conditions,
        kite,
        rider.calibration
      );
      return {
        kite,
        need: row.score,
        scored: row,
        rec: scoredRowToKiteRec(row, rider.conditions),
      };
    })
    .sort((a, b) => b.need - a.need);

  const solo = pickIdealKiteRecommendation(rider, allKites, scored);

  return {
    scored,
    solo,
    minAdequate,
    idealSize: idealTargetSizeForRider(rider),
    viableCount: 0,
  };
}

/** @param {RiderAllocInput & ReturnType<typeof scoreRiderAgainstAllKites>} r @param {Set<string>} usedIds @param {boolean} isFirstPicker */
function pickKiteForSharedQuiver(r, usedIds, isFirstPicker) {
  const available = r.scored.filter((s) => !usedIds.has(s.kite.id));
  const safe = available.filter((s) => isKiteSafeForRider(r, s));
  if (!safe.length) return null;
  return pickBestFromPool(safe, isFirstPicker, targetPowerSizeForRider(r));
}

/**
 * Pick order: heaviest first. Only riders with exactly one safe kite skip the queue (must claim it).
 * @param {Array<RiderAllocInput & ReturnType<typeof scoreRiderAgainstAllKites>>} riders
 */
function sortRidersForAllocation(riders) {
  const enriched = riders.map((r) => ({
    ...r,
    viableCount: countViableKitesForRider(r),
  }));

  const byWeight = (a, b) => {
    const weightA = Number(a.conditions.riderWeight) || 75;
    const weightB = Number(b.conditions.riderWeight) || 75;
    if (weightB !== weightA) return weightB - weightA;
    return a.name.localeCompare(b.name);
  };

  const mustPickFirst = enriched.filter((r) => r.viableCount === 1).sort(byWeight);
  const rest = enriched.filter((r) => r.viableCount !== 1).sort(byWeight);
  return [...mustPickFirst, ...rest];
}

/** @param {KiteAssignment[]} assignments */
function formatCrewKitLine(assignments) {
  return assignments.map((a) => `${a.name} → ${a.kite.name}`).join(" · ");
}

/**
 * @param {KiteAssignment} holder
 * @param {KiteAssignment} viewer
 */
function explainIdealTakenBy(holder, viewer) {
  const holderWeight = holder.riderWeight ?? 75;
  const viewerWeight = viewer.riderWeight ?? 75;
  const holderFewer =
    holder.viableCount != null &&
    viewer.viableCount != null &&
    holder.viableCount < viewer.viableCount;
  const holderEarlier =
    holder.pickOrder != null &&
    viewer.pickOrder != null &&
    holder.pickOrder < viewer.pickOrder;

  if (holderFewer) {
    return `${holder.name} flies it — fewer kites in the bag worked for them at this wind`;
  }
  if (holderEarlier && holderWeight <= viewerWeight) {
    return `${holder.name} flies it — picked earlier when splitting the shared bag`;
  }
  if (holderWeight > viewerWeight) {
    return `${holder.name} flies it — picked before you when splitting the bag`;
  }
  return `${holder.name} flies it — picked earlier when splitting the shared bag`;
}

function buildFairnessNote(rider, assigned, idealPick, minAdequate, conditions) {
  const wind = formatKt(conditions.windSpeed);
  const parts = [];

  if (minAdequate != null && assigned.size >= minAdequate - 0.25) {
    parts.push(
      `Needs about ${minAdequate}m+ near ${wind} kt from session history (underpowered on smaller sizes).`
    );
  }

  if (idealPick && idealPick.id !== assigned.id) {
    parts.push(
      `Ideal was ${idealPick.name}; ${assigned.name} is the best safe kite left in the bag for this wind.`
    );
  }

  return parts.length ? parts.join(" ") : null;
}

/** @param {RiderAllocInput} rider @param {ScoredRow} pick @param {number|null} minAdequate @param {number} idealSize */
function explainPoorRemainingKiteFit(rider, pick, minAdequate, idealSize) {
  const wind = rider.conditions.windSpeed;
  const weight = rider.conditions.riderWeight ?? 75;
  const kite = pick.kite;
  const rec = pick.rec;
  /** @type {string[]} */
  const parts = [];

  const catalog = rec?.catalogRange ?? getKiteWindRange(kite, weight);
  const band = rec?.comfortBand;

  if (band === "light" || wind < catalog.min - 0.5) {
    parts.push(
      `The ${kite.size}m would likely feel underpowered at ${formatKt(wind)} kt (manufacturer band from ${formatKt(catalog.min)} kt).`
    );
  } else if (band === "strong" || wind > catalog.max + 1) {
    parts.push(
      `The ${kite.size}m would likely feel too strong at ${formatKt(wind)} kt (chart tops out around ${formatKt(catalog.max)} kt).`
    );
  } else if (band === "extended" && rec?.comfortNote) {
    parts.push(rec.comfortNote);
  }

  const sizeGap = idealSize - kite.size;
  if (sizeGap >= 1 && !parts.some((p) => /underpower/i.test(p))) {
    parts.push(
      `At ~${weight} kg and ${formatKt(wind)} kt you would normally want about ${idealSize}m — this ${kite.size}m is noticeably smaller.`
    );
  } else if (kite.size - idealSize >= 1.5 && !parts.some((p) => /strong|overpower|hold down/i.test(p))) {
    parts.push(
      `This ${kite.size}m is larger than the ~${idealSize}m ideal for your weight at ${formatKt(wind)} kt — harder to hold down.`
    );
  }

  if (minAdequate != null && kite.size < minAdequate - 0.25) {
    parts.push(
      `Your sessions near ${formatKt(wind)} kt suggest you need at least ~${minAdequate}m (underpowered on smaller sizes in your log).`
    );
  }

  const cal = getCalibrationAtWind(wind, rider.calibration);
  if (cal.preferredSize != null && Math.abs(kite.size - cal.preferredSize) >= 1) {
    if (cal.summary) {
      parts.push(
        `${cal.summary} A ${kite.size}m is well off your usual ~${cal.preferredSize}m near this wind.`
      );
    } else if (kite.size < cal.preferredSize) {
      parts.push(
        `Near ${formatKt(wind)} kt your past sessions point to ~${cal.preferredSize}m — this ${kite.size}m is likely underpowered.`
      );
    } else {
      parts.push(
        `Near ${formatKt(wind)} kt your past sessions point to ~${cal.preferredSize}m — this ${kite.size}m may feel too big.`
      );
    }
  } else if (cal.summary && !parts.length) {
    parts.push(cal.summary);
  }

  if (!parts.length) {
    parts.push(
      `At ${formatKt(wind)} kt this ${kite.size}m only scores ${pick.need}% need-fit for you.`
    );
  }

  return parts.slice(0, 2).join(" ");
}

function computeRentSize(r, poorFitPick = null) {
  let size = targetPowerSizeForRider(r);
  if (poorFitPick && poorFitPick.kite.size < size - 0.5) {
    size = Math.max(size, Math.round((size + 1) * 2) / 2);
  }
  return Math.round(size * 2) / 2;
}

/** @param {UnassignedRider[]} unassigned @param {KiteAssignment[]} assignments */
function linkIdealKitesTakenByOthers(unassigned, assignments) {
  for (const u of unassigned) {
    if (!u.soloPick) continue;
    const holder = assignments.find((a) => a.kite.id === u.soloPick.id);
    if (!holder) continue;
    if (Math.abs(u.soloPick.size - (u.idealSize ?? u.soloPick.size)) > 0.75) continue;
    u.soloTakenBy = holder.name;
    u.takenKiteName = holder.kite.name;
  }
}

/**
 * @param {KiteAssignment|null} assign
 * @param {UnassignedRider|null} unassigned
 * @param {number|null} [windKt]
 * @param {KiteAssignment[]} [crewAssignments]
 */
export function buildRiderKiteDisplayHtml(
  assign,
  unassigned,
  windKt = null,
  crewAssignments = []
) {
  const ideal = assign?.soloPick ?? unassigned?.soloPick ?? null;
  const windLabel = windKt != null ? formatKt(windKt) : null;
  const kitLine =
    crewAssignments.length > 0 ? formatCrewKitLine(crewAssignments) : "";

  if (assign && !unassigned) {
    const assignedName = assign.kite.name;
    const fit = `<span class="plan-rider-fit">${assign.score}% need-fit</span>`;
    const compromised = assign.score < MIN_SUITABLE_SCORE;
    const flySub = compromised
      ? `<p class="plan-rider-kite-fly-sub hint-tight">Best safe kite left in the bag — not a perfect chart match.</p>`
      : "";

    let idealHtml = "";
    if (ideal && ideal.id !== assign.kite.id) {
      const holder = crewAssignments.find((a) => a.kite.id === ideal.id);
      const gap = holder
        ? ` (${explainIdealTakenBy(holder, assign)})`
        : ideal.size > assign.kite.size + 0.25
          ? " (larger size went to another rider)"
          : "";
      idealHtml = `<p class="plan-rider-kite-solo-ideal hint-tight">Ideal: ${escapeHtml(ideal.name)}${gap}</p>`;
    }

    return {
      html: `<p class="plan-rider-kite-fly">
          <span class="plan-rider-kite-fly-label">Fly this</span>
          <strong class="plan-rider-kite-fly-name">${escapeHtml(assignedName)}</strong>
          ${fit}
        </p>${flySub}${idealHtml}`,
      isWarn: compromised,
    };
  }

  if (unassigned) {
    const rentSize = unassigned.rentSize ?? ideal?.size;
    const idealLine =
      ideal && unassigned.idealSize != null && ideal.size >= unassigned.idealSize - 0.5 && !unassigned.soloTakenBy
        ? `<p class="plan-rider-kite-line"><strong>Ideal:</strong> ${escapeHtml(ideal.name)}</p>`
        : rentSize
          ? `<p class="plan-rider-kite-line"><strong>Ideal size:</strong> ~${rentSize}m${windLabel ? ` at ${windLabel} kt` : ""}</p>`
          : "";

    /** @type {string[]} */
    const reasons = [];
    if (kitLine) reasons.push(`In the bag: ${escapeHtml(kitLine)}.`);
    if (unassigned.soloTakenBy && unassigned.takenKiteName) {
      reasons.push(
        `${escapeHtml(unassigned.takenKiteName)} is with ${escapeHtml(unassigned.soloTakenBy)} — not free for you.`
      );
    }
    if (unassigned.poorFitKite) {
      const name = unassigned.poorFitKite.name || `${unassigned.poorFitKite.size}m`;
      const score =
        unassigned.poorFitScore != null ? ` (${unassigned.poorFitScore}% need-fit)` : "";
      reasons.push(`Only ${escapeHtml(name)} left${score} — not safe at this wind for you.`);
    }
    if (!reasons.length) reasons.push("No kite left in the bag that works for you.");

    const rentLine = rentSize
      ? `<p class="plan-rider-kite-alt hint-tight"><strong>Last resort:</strong> Rent ~${rentSize}m${windLabel ? ` for ${windLabel} kt` : ""} — nothing in the bag is safe enough.</p>`
      : `<p class="plan-rider-kite-alt hint-tight"><strong>Last resort:</strong> Rent — nothing in the bag is safe enough.</p>`;

    return {
      html: `<div class="plan-rider-kite-warn-block">${idealLine}${reasons.map((t) => `<p class="plan-rider-kite-line">${t}</p>`).join("")}${rentLine}</div>`,
      isWarn: true,
    };
  }

  return null;
}

/** @param {RiderAllocInput[]} riders @param {{ assignments: KiteAssignment[], unassigned: UnassignedRider[] }} alloc @param {Kite[]} allKites */
export function buildAllocationConflictGuidance(riders, alloc, allKites) {
  if (!alloc.unassigned.length) return null;

  const windLabel =
    riders[0]?.conditions.windSpeed != null
      ? `${formatKt(riders[0].conditions.windSpeed)} kt`
      : "this wind";

  const lines = [
    `Not enough safe kites for everyone at ${windLabel}. Heaviest rider picks first from the bag; rent only if nothing safe remains.`,
  ];

  if (alloc.assignments.length) {
    lines.push(`• In the bag: ${formatCrewKitLine(alloc.assignments)}.`);
  }

  const names = alloc.unassigned.map((u) => u.name).join(", ");
  lines.push(`• ${names} — rent only if no safe kite remains in the bag.`);

  const sizes = [...new Set(allKites.map((k) => k.size))];
  if (sizes.length < riders.length) {
    lines.push(
      `• ${sizes.length} size${sizes.length === 1 ? "" : "s"} for ${riders.length} riders — rotate or rent.`
    );
  }

  return lines.join("\n");
}

/**
 * @param {RiderAllocInput[]} riders
 * @param {Kite[]} allKites
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
              riderWeight: r.conditions.riderWeight ?? 75,
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
    const unassigned = rideable.map((r) => ({
      profileId: r.profileId,
      name: r.name,
      reason: /** @type {'no-kite'} */ ("no-kite"),
      message: "Add kites on the Quiver tab.",
      soloPick: null,
    }));
    return {
      assignments: [],
      unassigned,
      needRental: rideable.length,
      bannerHtml: "",
      conflictGuidance: buildAllocationConflictGuidance(
        rideable,
        { assignments: [], unassigned },
        []
      ),
    };
  }

  const queue = sortRidersForAllocation(
    rideable.map((r) => ({ ...r, ...scoreRiderAgainstAllKites(r, allKites) }))
  );

  const usedIds = new Set();
  /** @type {KiteAssignment[]} */
  const assignments = [];
  /** @type {UnassignedRider[]} */
  const unassigned = [];

  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    const available = r.scored.filter((s) => !usedIds.has(s.kite.id));
    const pick = pickKiteForSharedQuiver(r, usedIds, i === 0);
    const idealKite = r.solo?.kite ?? null;
    const riderWeight = r.conditions.riderWeight ?? 75;

    if (!pick) {
      const poor = available[0] ?? null;
      const detail = poor
        ? explainPoorRemainingKiteFit(r, poor, r.minAdequate ?? null, r.idealSize)
        : "No kite left in the quiver.";
      unassigned.push({
        profileId: r.profileId,
        name: r.name,
        reason: "shortage",
        message: `${r.name}: ${detail} Rent if nothing else works.`,
        soloPick: idealKite,
        idealSize: r.idealSize,
        minAdequate: r.minAdequate ?? null,
        rentSize: computeRentSize(r, poor),
        poorFitKite: poor?.kite ?? null,
        poorFitScore: poor?.need ?? null,
      });
      continue;
    }

    usedIds.add(pick.kite.id);
    assignments.push({
      profileId: r.profileId,
      name: r.name,
      kite: pick.kite,
      score: pick.need,
      soloPick: idealKite,
      kiteRec: pick.rec,
      pickOrder: i,
      viableCount: r.viableCount,
      riderWeight,
      fairnessNote: buildFairnessNote(
        r,
        pick.kite,
        idealKite,
        r.minAdequate ?? null,
        r.conditions
      ),
    });
  }

  linkIdealKitesTakenByOthers(unassigned, assignments);

  const result = {
    assignments,
    unassigned,
    needRental: unassigned.filter((u) => u.reason === "shortage").length,
    bannerHtml: "",
  };

  return {
    ...result,
    conflictGuidance: buildAllocationConflictGuidance(rideable, result, allKites),
  };
}
