/**
 * Fair / safe shared-quiver allocation — weight order first, then need-fit from scoreKiteForConditions.
 * Ability widens which leftover kites are safe; it never changes assignment order.
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
  isOverpoweredFeeling,
  isHappyFeeling,
} from "./calibration.js";
import { describeWindVsKiteRange } from "./kite-personal-range.js";
import { formatKt } from "./format.js";

/** @typedef {import('./kite-allocation.js').RiderAllocInput} RiderAllocInput */
/** @typedef {import('./kite-allocation.js').KiteAssignment} KiteAssignment */
/** @typedef {import('./kite-allocation.js').UnassignedRider} UnassignedRider */
/** @typedef {import('./kite-allocation.js').GroupKiteAllocation} GroupKiteAllocation */
/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {ReturnType<typeof scoreKiteForConditions>} KiteScoredRow */

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

/**
 * Extra catalog wind slack — experts accept more powered-up kites from the bag.
 * @param {import('./engine.js').Conditions['skillLevel']} skillLevel
 */
function abilityKiteWindSlack(skillLevel) {
  const level = normalizeAbility(skillLevel);
  if (level === "expert") return { belowCatalogMin: 2, aboveCatalogMax: 5 };
  if (level === "advanced" || level === "jumper") return { belowCatalogMin: 1.5, aboveCatalogMax: 3 };
  if (level === "competent") return { belowCatalogMin: 1, aboveCatalogMax: 2 };
  return { belowCatalogMin: 0.5, aboveCatalogMax: 1 };
}

/**
 * @param {KiteScoredRow} row
 */
function scoredRowToKiteRec(row, conditions) {
  const wind = conditions.windSpeed;
  return {
    kite: row.kite,
    score: row.score,
    catalogRange: row.catalog,
    effectiveRange: row.effective,
    comfortBand: row.band,
    comfortNote: describeWindVsKiteRange(wind, row.effective),
    range: { min: row.range.min, ideal: row.range.ideal, max: row.range.max },
  };
}

/**
 * Minimum safety — ability expands acceptable catalog band; sessions set size floor.
 * @param {RiderAllocInput & { minAdequate?: number|null }} rider
 * @param {{ kite: Kite, need: number, scored: KiteScoredRow, rec: ReturnType<typeof recommendKite>|null }} row
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
    const scored = scoreKiteForConditions(
      rider.conditions,
      kite,
      rider.calibration
    );
    return {
      kite,
      need: scored.score,
      scored,
      rec: scoredRowToKiteRec(scored, rider.conditions),
    };
  });

  const byNeed = [...rows].sort((a, b) => b.need - a.need);
  const bestAltNeed = byNeed[1]?.need ?? 0;

  const scored = rows.map((row) => ({
    ...row,
    minAdequate,
    necessity: Math.max(0, row.need - bestAltNeed),
  }));

  const ranked = [...scored].sort((a, b) => b.need - a.need);
  const top = ranked[0];
  const soloRec = top ? recommendKite(rider.conditions, allKites, rider.calibration) : null;

  return {
    scored: ranked,
    solo: soloRec,
    soloKite: top?.kite ?? soloRec?.kite ?? null,
    soloScore: top?.need ?? soloRec?.score ?? 0,
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
    parts.push(
      `Solo pick was ${soloName}; ${assigned.name} is the best safe kite left in the bag for this wind.`
    );
  }

  return parts.length ? parts.join(" ") : null;
}

/**
 * @param {RiderAllocInput} rider
 * @param {{ kite: Kite, need: number, rec: ReturnType<typeof recommendKite>|null }} pick
 * @param {number|null} minAdequate
 * @param {number} idealSize
 */
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

  const onThisKite = rider.calibration.filter(
    (e) => e.kiteId === kite.id && Math.abs(e.windSpeed - wind) <= 5
  );
  if (onThisKite.length) {
    const bad = onThisKite.filter((e) =>
      isUnderpoweredFeeling(e.feeling) || isOverpoweredFeeling(e.feeling)
    );
    if (bad.length) {
      const notes = [
        ...new Set(
          bad.map((e) => {
            if (isOverpoweredFeeling(e.feeling)) return `overpowered on this kite at ${e.windSpeed} kt`;
            return `underpowered on this kite at ${e.windSpeed} kt`;
          })
        ),
      ];
      parts.push(`You've logged: ${notes.join("; ")}.`);
    } else {
      const ok = onThisKite.filter((e) => isHappyFeeling(e.feeling));
      if (!ok.length) {
        parts.push(
          `Your log on this kite near ${formatKt(wind)} kt does not show it working well for you.`
        );
      }
    }
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

  if (rec?.comfortNote && !parts.includes(rec.comfortNote)) {
    parts.push(rec.comfortNote);
  } else if (rec?.reason && parts.length < 2) {
    const trimmed = rec.reason.replace(/^[^:]+:\s*/, "").trim();
    if (trimmed && trimmed.length < 200) parts.push(trimmed);
  }

  if (!parts.length) {
    parts.push(
      `At ${formatKt(wind)} kt this ${kite.size}m only scores ${pick.need}% need-fit for you.`
    );
  }

  return parts.slice(0, 2).join(" ");
}

function escapeAllocHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {RiderAllocInput & { idealSize?: number, minAdequate?: number|null, solo?: { kite: Kite, score?: number }|null, calibration?: CalibrationEntry[] }} r
 */
function targetPowerSizeForRider(r) {
  const weight = r.conditions.riderWeight ?? 75;
  const wind = r.conditions.windSpeed;
  let target = r.idealSize ?? idealKiteSizeForWind(wind, weight);

  if (r.minAdequate != null) target = Math.max(target, r.minAdequate);

  const cal = getCalibrationAtWind(wind, r.calibration ?? []);
  if (cal.preferredSize != null) target = Math.max(target, cal.preferredSize);

  const soloSize = r.solo?.kite?.size;
  const soloScore = r.solo?.score ?? 0;
  if (soloSize != null && soloScore >= 40 && soloSize >= target - 0.25) {
    target = Math.max(target, soloSize);
  }

  return Math.round(target * 2) / 2;
}

function computeRentSize(r, poorFitPick = null) {
  let size = targetPowerSizeForRider(r);

  if (poorFitPick) {
    const left = poorFitPick.kite.size;
    if (left < size - 0.5) size = Math.max(size, Math.round((size + 1) * 2) / 2);
    else if (left > size + 0.75) size = Math.round(size * 2) / 2;
  }

  return Math.round(size * 2) / 2;
}

/**
 * @param {UnassignedRider[]} unassigned
 * @param {KiteAssignment[]} assignments
 */
function linkSoloKitesTakenByOthers(unassigned, assignments) {
  for (const u of unassigned) {
    if (!u.soloPick) continue;
    const holder = assignments.find((a) => a.kite.id === u.soloPick.id);
    if (!holder) continue;
    const targetSize = u.idealSize ?? u.soloPick.size;
    if (Math.abs(u.soloPick.size - targetSize) > 0.75) continue;
    u.soloTakenBy = holder.name;
    u.takenKiteName = holder.kite.name;
  }
}

/** @param {KiteAssignment[]} assignments */
function formatCrewKitLine(assignments) {
  return assignments.map((a) => `${a.name} → ${a.kite.name}`).join(" · ");
}

/**
 * @param {KiteAssignment|null} assign
 * @param {UnassignedRider|null} unassigned
 * @param {number|null} [windKt]
 * @returns {{ html: string, isWarn: boolean }|null}
 */
export function buildRiderKiteDisplayHtml(
  assign,
  unassigned,
  windKt = null,
  crewAssignments = []
) {
  const solo = assign?.soloPick ?? unassigned?.soloPick ?? null;
  const idealLabel = solo?.name ?? null;
  const windLabel = windKt != null ? formatKt(windKt) : null;
  const kitLine =
    crewAssignments.length > 0 ? formatCrewKitLine(crewAssignments) : "";

  if (assign && !unassigned) {
    const assignedName = assign.kite.name;
    const fit = ` <span class="plan-rider-fit">${assign.score}% need-fit</span>`;
    if (solo && solo.id === assign.kite.id) {
      return {
        html: `<p class="plan-rider-kite-line"><strong>Recommended kite:</strong> ${escapeAllocHtml(assignedName)}${fit}</p>`,
        isWarn: false,
      };
    }
    const compromised = assign.score < MIN_SUITABLE_SCORE;
    const sizeNote = compromised
      ? " — not a perfect chart match, but the best safe kite left in the bag. Rent only if you need a closer size."
      : " — best safe kite left in the shared quiver.";
    const recLabel = compromised ? "Use from bag" : "Recommendation";
    return {
      html: `<p class="plan-rider-kite-line"><strong>Ideal kite:</strong> ${escapeAllocHtml(idealLabel || assignedName)}</p>
        <p class="plan-rider-kite-alt hint-tight"><strong>${recLabel}:</strong> ${escapeAllocHtml(assignedName)}${fit}${sizeNote}</p>`,
      isWarn: compromised,
    };
  }

  if (unassigned) {
    const rentSize = unassigned.rentSize ?? solo?.size;
    const idealSize = unassigned.idealSize;
    const showSoloIdeal =
      idealLabel &&
      solo &&
      idealSize != null &&
      solo.size >= idealSize - 0.5 &&
      !unassigned.soloTakenBy;

    const idealLine = showSoloIdeal
      ? `<p class="plan-rider-kite-line"><strong>Ideal kite:</strong> ${escapeAllocHtml(idealLabel)}</p>`
      : rentSize
        ? `<p class="plan-rider-kite-line"><strong>Ideal size:</strong> ~${rentSize}m${windLabel ? ` at ${windLabel} kt` : ""} for your weight</p>`
        : "";

    /** @type {string[]} */
    const reasons = [];
    if (kitLine) {
      reasons.push(`<span class="plan-crew-kit-line">In the bag: ${escapeAllocHtml(kitLine)}.</span>`);
    }
    if (unassigned.soloTakenBy && unassigned.takenKiteName) {
      reasons.push(
        `<strong>${escapeAllocHtml(unassigned.takenKiteName)}</strong> is assigned to <strong>${escapeAllocHtml(unassigned.soloTakenBy)}</strong> — not free for you.`
      );
    }
    if (unassigned.poorFitKite) {
      const name = unassigned.poorFitKite.name || `${unassigned.poorFitKite.size}m`;
      const score =
        unassigned.poorFitScore != null ? ` (${unassigned.poorFitScore}% need-fit)` : "";
      const tooSmall =
        idealSize != null && unassigned.poorFitKite.size < idealSize - 0.5;
      reasons.push(
        tooSmall
          ? `Only <strong>${escapeAllocHtml(name)}</strong> was left${score} — too small for you in this wind.`
          : `Only <strong>${escapeAllocHtml(name)}</strong> was left${score} — not safe for your weight and ability at this wind.`
      );
    }
    if (!reasons.length) {
      reasons.push("No kite left in the shared bag that works for you in this window.");
    }

    const rentLine = rentSize
      ? `<p class="plan-rider-kite-alt hint-tight"><strong>Last resort:</strong> Rent ~${rentSize}m${windLabel ? ` for ${windLabel} kt` : ""} — no kite in the bag clears the minimum safety threshold.</p>`
      : `<p class="plan-rider-kite-alt hint-tight"><strong>Last resort:</strong> Rent a suitable size — no kite in the bag clears the minimum safety threshold.</p>`;

    return {
      html: `<div class="plan-rider-kite-warn-block">${idealLine}${reasons.map((t) => `<p class="plan-rider-kite-line">${t}</p>`).join("")}${rentLine}</div>`,
      isWarn: true,
    };
  }

  return null;
}

/**
 * Pick from remaining kites after heavier riders — weight order is fixed before this runs.
 * @param {ReturnType<typeof scoreRiderAgainstAllKites> & RiderAllocInput} r
 * @param {Set<string>} usedIds
 * @param {boolean} isHeaviest
 */
function pickKiteForSharedQuiver(r, usedIds, isHeaviest) {
  const available = r.scored.filter((s) => !usedIds.has(s.kite.id));
  if (!available.length) return null;

  const safe = available.filter((s) => isKiteSafeForRider(r, s));
  const pool = safe.length ? safe : available;

  if (isHeaviest) {
    return (
      [...pool].sort((a, b) => {
        if (b.need !== a.need) return b.need - a.need;
        return b.kite.size - a.kite.size;
      })[0] ?? null
    );
  }

  const soloId = r.solo?.kite?.id;
  const soloRow = soloId ? pool.find((s) => s.kite.id === soloId) : null;
  if (soloRow && soloRow.need >= pool[0].need - 8) return soloRow;

  return (
    [...pool].sort((a, b) => {
      if (b.need !== a.need) return b.need - a.need;
      return a.kite.size - b.kite.size;
    })[0] ?? null
  );
}

/**
 * @param {RiderAllocInput & { minAdequate?: number|null, idealSize?: number }} r
 * @param {{ kite: Kite, need: number, rec: ReturnType<typeof recommendKite>|null }} pick
 */
function buildPoorFitUnassignedMessage(r, pick) {
  const kiteLabel = pick.kite.name || `${pick.kite.brand || "Kite"} ${pick.kite.size}m`;
  const why = explainPoorRemainingKiteFit(
    r,
    pick,
    r.minAdequate ?? null,
    r.idealSize ?? idealKiteSizeForWind(r.conditions.windSpeed, r.conditions.riderWeight ?? 75)
  );
  return `${r.name}: no safe kite left in the bag — only ${kiteLabel} (${pick.need}% need-fit). ${why} Consider renting.`;
}

/**
 * @param {RiderAllocInput[]} riders
 * @param {{ assignments: KiteAssignment[], unassigned: UnassignedRider[] }} alloc
 * @param {Kite[]} allKites
 */
export function buildAllocationConflictGuidance(riders, alloc, allKites) {
  const hasShortage = alloc.unassigned.length > 0;
  if (!hasShortage) return null;

  const wind = riders[0]?.conditions.windSpeed;
  const windLabel = wind != null ? `${formatKt(wind)} kt` : "this wind";
  const byWeight = [...riders].sort(
    (a, b) => (b.conditions.riderWeight ?? 75) - (a.conditions.riderWeight ?? 75)
  );
  const heaviest = byWeight[0];
  const lightest = byWeight[byWeight.length - 1];

  const lines = [
    `Not enough safe kites for everyone at ${windLabel}. Assignment order is by weight (heaviest first) — ability only affects which leftover sizes each person can hold:`,
    "• Heavier riders pick first from what's left; they need more power for their weight.",
    "• Lighter riders take smaller safe kites from the remainder. Experts can hold down slightly more kite than intermediates at the same wind.",
  ];

  if (heaviest && lightest && heaviest.profileId !== lightest.profileId) {
    lines.push(
      `• Example: ${heaviest.name} (~${heaviest.conditions.riderWeight ?? "?"} kg) assigns before ${lightest.name} (~${lightest.conditions.riderWeight ?? "?"} kg), regardless of ability.`
    );
  }

  if (alloc.assignments.length) {
    lines.push(`• Assigned from the bag: ${formatCrewKitLine(alloc.assignments)}.`);
  }

  if (hasShortage) {
    const names = alloc.unassigned.map((u) => u.name).join(", ");
    lines.push(
      `• ${names} — rent only if no remaining kite in the bag is safe for them at this wind.`
    );
  }

  const sizes = [...new Set(allKites.map((k) => k.size))].sort((a, b) => b - a);
  if (sizes.length < riders.length && hasShortage) {
    lines.push(
      `• You have ${sizes.length} size${sizes.length === 1 ? "" : "s"} in the bag for ${riders.length} riders — plan a rental or rotate who rides each window.`
    );
  }

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

  enriched.sort((a, b) => {
    const dw =
      (b.conditions.riderWeight ?? 75) - (a.conditions.riderWeight ?? 75);
    if (dw !== 0) return dw;
    return a.name.localeCompare(b.name);
  });

  const usedIds = new Set();
  /** @type {KiteAssignment[]} */
  const assignments = [];
  /** @type {UnassignedRider[]} */
  const unassigned = [];

  for (let i = 0; i < enriched.length; i++) {
    const r = enriched[i];
    let pick = pickKiteForSharedQuiver(r, usedIds, i === 0);

    if (!pick) {
      unassigned.push({
        profileId: r.profileId,
        name: r.name,
        reason: "shortage",
        message: `${r.name}: no kite left in the quiver — may need to rent.`,
        soloPick: r.solo?.kite ?? null,
        idealSize: r.idealSize,
        minAdequate: r.minAdequate ?? null,
        rentSize: computeRentSize(r, null),
      });
      continue;
    }

    const anySafeLeft = r.scored.filter(
      (s) => !usedIds.has(s.kite.id) && isKiteSafeForRider(r, s)
    );
    if (!anySafeLeft.length) {
      unassigned.push({
        profileId: r.profileId,
        name: r.name,
        reason: "shortage",
        message: buildPoorFitUnassignedMessage(r, pick),
        soloPick: r.solo?.kite ?? null,
        idealSize: r.idealSize,
        minAdequate: r.minAdequate ?? null,
        rentSize: computeRentSize(r, pick),
        poorFitKite: pick.kite,
        poorFitScore: pick.need,
      });
      continue;
    }

    if (!isKiteSafeForRider(r, pick)) {
      pick =
        [...anySafeLeft].sort((a, b) => b.need - a.need)[0] ?? pick;
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
        r.conditions,
        enriched
      ),
    });
  }

  linkSoloKitesTakenByOthers(unassigned, assignments);

  const needRental = unassigned.filter((u) => u.reason === "shortage").length;
  const result = { assignments, unassigned, needRental, bannerHtml: "" };
  const conflictGuidance = buildAllocationConflictGuidance(rideable, result, allKites);

  return { ...result, conflictGuidance };
}
