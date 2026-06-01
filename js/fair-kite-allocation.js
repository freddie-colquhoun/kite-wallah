/**
 * Shared-quiver allocation for crew Plan / Now.
 *
 * Rules (in order):
 * 1. Sort riders by weight (kg) descending — ability never changes queue order.
 * 2. Score every bag kite with scoreKiteForConditions (same as solo recommendKite).
 * 3. Each turn: pick largest SAFE unused kite; heaviest must be ≥ power target − 0.5 m.
 * 4. Assign if safe; rent only when no safe kite remains.
 * 5. UI: need-fit < 45% = amber "Fly this"; solo ideal shown when different.
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

/** @param {RiderAllocInput & { idealSize?: number, minAdequate?: number|null, solo?: ReturnType<typeof recommendKite>|null, calibration?: CalibrationEntry[] }} r */
function targetPowerSizeForRider(r) {
  const weight = r.conditions.riderWeight ?? 75;
  const wind = r.conditions.windSpeed;
  let target = r.idealSize ?? idealKiteSizeForWind(wind, weight);

  if (r.minAdequate != null) target = Math.max(target, r.minAdequate);

  const cal = getCalibrationAtWind(wind, r.calibration ?? []);
  if (cal.preferredSize != null) target = Math.max(target, cal.preferredSize);

  const soloSize = r.solo?.kite?.size;
  if (soloSize != null && (r.solo?.score ?? 0) >= 40 && soloSize >= target - 0.25) {
    target = Math.max(target, soloSize);
  }

  return Math.round(target * 2) / 2;
}

/**
 * Largest safe kite in pool; heaviest also respects power target.
 * @param {ScoredRow[]} pool
 * @param {boolean} isHeaviest
 * @param {number} powerTarget
 */
function pickBestFromPool(pool, isHeaviest, powerTarget) {
  let candidates = pool;
  if (isHeaviest) {
    const meets = pool.filter((s) => s.kite.size >= powerTarget - 0.5);
    candidates = meets.length ? meets : pool;
  }

  return (
    [...candidates].sort((a, b) => {
      if (b.kite.size !== a.kite.size) return b.kite.size - a.kite.size;
      if (isHeaviest) {
        const gapA = Math.abs(a.kite.size - powerTarget);
        const gapB = Math.abs(b.kite.size - powerTarget);
        if (gapA !== gapB) return gapA - gapB;
      }
      return b.need - a.need;
    })[0] ?? null
  );
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

  const solo = recommendKite(rider.conditions, allKites, rider.calibration);

  return {
    scored,
    solo,
    minAdequate,
    idealSize: idealKiteSizeForWind(rider.conditions.windSpeed, weight),
  };
}

/** @param {RiderAllocInput & ReturnType<typeof scoreRiderAgainstAllKites>} r @param {Set<string>} usedIds @param {boolean} isHeaviest */
function pickKiteForSharedQuiver(r, usedIds, isHeaviest) {
  const available = r.scored.filter((s) => !usedIds.has(s.kite.id));
  const safe = available.filter((s) => isKiteSafeForRider(r, s));
  if (!safe.length) return null;
  return pickBestFromPool(safe, isHeaviest, targetPowerSizeForRider(r));
}

function sortRidersByWeight(riders) {
  return [...riders].sort((a, b) => {
    const weightA = Number(a.conditions.riderWeight) || 75;
    const weightB = Number(b.conditions.riderWeight) || 75;
    if (weightB !== weightA) return weightB - weightA;
    return a.name.localeCompare(b.name);
  });
}

/** @param {KiteAssignment[]} assignments */
function formatCrewKitLine(assignments) {
  return assignments.map((a) => `${a.name} → ${a.kite.name}`).join(" · ");
}

function buildFairnessNote(rider, assigned, soloPick, minAdequate, conditions) {
  const wind = formatKt(conditions.windSpeed);
  const parts = [];

  if (minAdequate != null && assigned.size >= minAdequate - 0.25) {
    parts.push(
      `Needs about ${minAdequate}m+ near ${wind} kt from session history (underpowered on smaller sizes).`
    );
  }

  if (soloPick && soloPick.id !== assigned.id) {
    parts.push(
      `Solo pick was ${soloPick.name}; ${assigned.name} is the best safe kite left in the bag for this wind.`
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
function linkSoloKitesTakenByOthers(unassigned, assignments) {
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
  const solo = assign?.soloPick ?? unassigned?.soloPick ?? null;
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

    let soloIdealHtml = "";
    if (solo && solo.id !== assign.kite.id) {
      const holder = crewAssignments.find((a) => a.kite.id === solo.id);
      const gap = holder
        ? ` (${escapeHtml(holder.name)} flies it — heaviest riders pick first)`
        : solo.size > assign.kite.size + 0.25
          ? " (larger kite went to a heavier rider)"
          : "";
      soloIdealHtml = `<p class="plan-rider-kite-solo-ideal hint-tight">Solo ideal: ${escapeHtml(solo.name)}${gap}</p>`;
    }

    return {
      html: `<p class="plan-rider-kite-fly">
          <span class="plan-rider-kite-fly-label">Fly this</span>
          <strong class="plan-rider-kite-fly-name">${escapeHtml(assignedName)}</strong>
          ${fit}
        </p>${flySub}${soloIdealHtml}`,
      isWarn: compromised,
    };
  }

  if (unassigned) {
    const rentSize = unassigned.rentSize ?? solo?.size;
    const idealLine =
      solo && unassigned.idealSize != null && solo.size >= unassigned.idealSize - 0.5 && !unassigned.soloTakenBy
        ? `<p class="plan-rider-kite-line"><strong>Solo ideal:</strong> ${escapeHtml(solo.name)}</p>`
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
  const byWeight = sortRidersByWeight(riders);
  const heaviest = byWeight[0];
  const lightest = byWeight[byWeight.length - 1];

  const lines = [
    `Not enough safe kites for everyone at ${windLabel}. Heaviest rider (by weight) picks first; ability only widens what each person can hold.`,
    `• ${heaviest?.name ?? "Heaviest"} (~${heaviest?.conditions.riderWeight ?? "?"} kg) before ${lightest?.name ?? "lightest"} (~${lightest?.conditions.riderWeight ?? "?"} kg).`,
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

  const queue = sortRidersByWeight(
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
        soloPick: r.solo?.kite ?? null,
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
      soloPick: r.solo?.kite ?? null,
      kiteRec: pick.rec,
      fairnessNote: buildFairnessNote(
        r,
        pick.kite,
        r.solo?.kite ?? null,
        r.minAdequate ?? null,
        r.conditions
      ),
    });
  }

  linkSoloKitesTakenByOthers(unassigned, assignments);

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
