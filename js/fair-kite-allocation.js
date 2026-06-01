/**
 * Fair / safe shared-quiver allocation — need and fit, not who "likes" a kite more.
 * Heavier riders are assigned first and penalize oversize on light riders.
 */

import { recommendKite, getKiteWindRange, idealKiteSizeForWind } from "./engine.js";
import {
  inferPreferredSize,
  getCalibrationAtWind,
  isUnderpoweredFeeling,
  isOverpoweredFeeling,
  isHappyFeeling,
} from "./calibration.js";
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
    if (isUnderpoweredFeeling(e.feeling)) {
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

  if (sizeDelta > 1) need -= 45 + Math.round((sizeDelta - 1) * 15);
  else if (sizeDelta > 0.5) need -= 28;
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
 * Why the only kite left would be a bad match (underpowered, overpowered, vs sessions).
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
      const ok = onThisKite.filter((e) =>
        isHappyFeeling(e.feeling)
      );
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
 * @param {KiteAssignment|null} assign
 * @param {UnassignedRider|null} unassigned
 * @returns {{ html: string, isWarn: boolean }|null}
 */
/**
 * @param {RiderAllocInput & { idealSize?: number, minAdequate?: number|null, solo?: { kite: Kite }|null }} r
 * @param {{ kite: Kite, need: number }|null} [poorFitPick]
 */
function computeRentSize(r, poorFitPick = null) {
  const weight = r.conditions.riderWeight ?? 75;
  const wind = r.conditions.windSpeed;
  let size = r.idealSize ?? idealKiteSizeForWind(wind, weight);
  if (r.minAdequate != null) size = Math.max(size, r.minAdequate);
  const soloSize = r.solo?.kite?.size;
  if (soloSize != null && soloSize >= size - 0.25) size = Math.max(size, soloSize);

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
    if (holder) u.soloTakenBy = holder.name;
  }
}

/**
 * @param {KiteAssignment|null} assign
 * @param {UnassignedRider|null} unassigned
 * @param {number|null} [windKt]
 * @returns {{ html: string, isWarn: boolean }|null}
 */
export function buildRiderKiteDisplayHtml(assign, unassigned, windKt = null) {
  const solo = assign?.soloPick ?? unassigned?.soloPick ?? null;
  const idealLabel = solo?.name ?? null;
  const windLabel = windKt != null ? formatKt(windKt) : null;

  if (assign && !unassigned) {
    const assignedName = assign.kite.name;
    const fit = ` <span class="plan-rider-fit">${assign.score}% need-fit</span>`;
    if (solo && solo.id === assign.kite.id) {
      return {
        html: `<p class="plan-rider-kite-line"><strong>Recommended kite:</strong> ${escapeAllocHtml(assignedName)}${fit}</p>`,
        isWarn: false,
      };
    }
    return {
      html: `<p class="plan-rider-kite-line"><strong>Ideal kite:</strong> ${escapeAllocHtml(idealLabel || assignedName)}</p>
        <p class="plan-rider-kite-alt hint-tight"><strong>Recommendation:</strong> ${escapeAllocHtml(assignedName)}${fit} — best available from the shared quiver.</p>`,
      isWarn: false,
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
    if (unassigned.soloTakenBy && unassigned.soloPick) {
      reasons.push(
        `<strong>${escapeAllocHtml(unassigned.soloPick.name)}</strong> is with <strong>${escapeAllocHtml(unassigned.soloTakenBy)}</strong> — not free for you.`
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
          : `Only <strong>${escapeAllocHtml(name)}</strong> was left${score} — not a good match for you here.`
      );
    }
    if (!reasons.length) {
      reasons.push("No kite left in the shared bag that works for you in this window.");
    }

    const rentLine = rentSize
      ? `<p class="plan-rider-kite-alt hint-tight"><strong>Recommendation:</strong> Rent ~${rentSize}m${windLabel ? ` for ${windLabel} kt` : ""}, or sit out.</p>`
      : `<p class="plan-rider-kite-alt hint-tight"><strong>Recommendation:</strong> Rent a suitable size, or sit out.</p>`;

    return {
      html: `<div class="plan-rider-kite-warn-block">${idealLine}${reasons.map((t) => `<p class="plan-rider-kite-line">${t}</p>`).join("")}${rentLine}</div>`,
      isWarn: true,
    };
  }

  return null;
}

/**
 * Solo ideal if free; else largest suitable (heavier) or smallest (lighter).
 * @param {ReturnType<typeof scoreRiderAgainstAllKites> & RiderAllocInput} r
 * @param {Set<string>} usedIds
 * @param {number} medianWeight
 */
function pickKiteForSharedQuiver(r, usedIds, medianWeight) {
  const weight = r.conditions.riderWeight ?? 75;
  const suitable = r.scored.filter(
    (s) => s.need >= MIN_SUITABLE_SCORE && !usedIds.has(s.kite.id)
  );
  if (!suitable.length) {
    return r.scored.find((s) => !usedIds.has(s.kite.id)) ?? null;
  }

  const preferLarge = weight >= medianWeight;
  const soloId = r.solo?.kite?.id;
  if (soloId) {
    const soloRow = suitable.find((s) => s.kite.id === soloId);
    if (soloRow) {
      const largest = [...suitable].sort((a, b) => b.kite.size - a.kite.size)[0];
      const keepSolo =
        !preferLarge ||
        !largest ||
        soloRow.kite.size >= largest.kite.size - 0.5;
      if (keepSolo) return soloRow;
    }
  }
  const sorted = [...suitable].sort((a, b) =>
    preferLarge ? b.kite.size - a.kite.size : a.kite.size - b.kite.size
  );
  return sorted[0];
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
  return `${r.name}: no good kite left — only ${kiteLabel} (${pick.need}% need-fit). ${why} Consider renting.`;
}

/**
 * Plain-language guidance when the quiver cannot give everyone a good match.
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

  const weights = enriched.map((r) => r.conditions.riderWeight ?? 75).sort((a, b) => a - b);
  const medianWeight =
    weights.length % 2
      ? weights[(weights.length - 1) / 2]
      : (weights[weights.length / 2 - 1] + weights[weights.length / 2]) / 2;

  const usedIds = new Set();
  /** @type {KiteAssignment[]} */
  const assignments = [];
  /** @type {UnassignedRider[]} */
  const unassigned = [];

  for (const r of enriched) {
    const pick = pickKiteForSharedQuiver(r, usedIds, medianWeight);

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

    if (pick.need < MIN_SUITABLE_SCORE) {
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

    usedIds.add(pick.kite.id);
    assignments.push({
      profileId: r.profileId,
      name: r.name,
      kite: pick.kite,
      score: pick.need,
      soloPick: r.solo?.kite ?? null,
      kiteRec: pick.rec,
      fairnessNote: null,
    });
  }

  linkSoloKitesTakenByOthers(unassigned, assignments);

  const needRental = unassigned.filter((u) => u.reason === "shortage").length;
  const result = { assignments, unassigned, needRental, bannerHtml: "" };
  const conflictGuidance = buildAllocationConflictGuidance(rideable, result, allKites);

  return { ...result, conflictGuidance };
}
