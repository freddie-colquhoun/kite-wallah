import {
  FEELING_LABELS,
  isUnderpoweredFeeling,
  isOverpoweredFeeling,
  isSeriousUnderpoweredFeeling,
} from "./calibration.js";
import { sessionStartIso } from "./session-helpers.js";
import { gustSpread } from "./wind-session-copy.js";
import { formatKt } from "./format.js";

/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */
/** @typedef {import('./session-rating.js').SessionLevel} SessionLevel */

/**
 * @param {CalibrationEntry} entry
 * @returns {CalibrationEntry}
 */
export function normalizeSessionEntry(entry) {
  return {
    id: entry.id || "",
    windSpeed: Number(entry.windSpeed) || 0,
    gustSpeed: entry.gustSpeed != null ? Number(entry.gustSpeed) : null,
    windDirection: entry.windDirection || null,
    kiteSize: Number(entry.kiteSize) || 0,
    kiteName: entry.kiteName || null,
    kiteId: entry.kiteId || null,
    spotId: entry.spotId || null,
    spotName: entry.spotName || null,
    sessionAt: entry.sessionAt || entry.sessionStartAt || null,
    sessionStartAt: sessionStartIso(entry) || null,
    sessionEndAt: entry.sessionEndAt || null,
    boardId: entry.boardId || null,
    boardName: entry.boardName || null,
    waterDescription: entry.waterDescription?.trim() || null,
    feeling: entry.feeling || "just-right",
    sessionRating: entry.sessionRating != null ? Number(entry.sessionRating) : null,
    notes: entry.notes || "",
    waterType: entry.waterType || null,
  };
}

/**
 * @param {string|null|undefined} iso
 */
export function formatSessionDate(iso) {
  if (!iso) return "a past session";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "a past session";
  return d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * @param {CalibrationEntry[]} entries
 * @param {KiteSpot|null} spot
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @param {string|null} [pickSessionId] manual selection
 * @returns {CalibrationEntry|null}
 */
export function pickComparisonSession(entries, spot, forecast, pickSessionId) {
  const list = entries.map(normalizeSessionEntry).filter((e) => e.windSpeed > 0);
  if (!list.length) return null;

  if (pickSessionId === "none") return null;
  if (pickSessionId) {
    return list.find((e) => e.id === pickSessionId) ?? null;
  }

  const sameSpot = spot
    ? list.filter((e) => e.spotId === spot.id || e.spotName === spot.name)
    : [];
  const pool = sameSpot.length ? sameSpot : list;

  pool.sort((a, b) => {
    const scoreA =
      Math.abs(a.windSpeed - forecast.windSpeed) * 2 +
      (a.gustSpeed != null && forecast.gustSpeed != null
        ? Math.abs(a.gustSpeed - forecast.gustSpeed)
        : 4);
    const scoreB =
      Math.abs(b.windSpeed - forecast.windSpeed) * 2 +
      (b.gustSpeed != null && forecast.gustSpeed != null
        ? Math.abs(b.gustSpeed - forecast.gustSpeed)
        : 4);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const ta = sessionStartIso(a) ? new Date(sessionStartIso(a)).getTime() : 0;
    const tb = sessionStartIso(b) ? new Date(sessionStartIso(b)).getTime() : 0;
    return tb - ta;
  });

  const best = pool[0];
  if (Math.abs(best.windSpeed - forecast.windSpeed) > 8) return null;
  return best;
}

/**
 * @param {import('./calibration.js').SessionFeeling|string} feeling
 */
function naturalFeelingPhrase(feeling) {
  if (feeling === "slightly-underpowered") return "a little underpowered";
  if (feeling === "slightly-overpowered") return "a little overpowered";
  return (FEELING_LABELS[feeling] || feeling).toLowerCase();
}

/**
 * Compact comparison for Plan day cards.
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @param {CalibrationEntry} entry
 */
export function formatSessionCompareCard(forecast, entry) {
  const e = normalizeSessionEntry(entry);
  const windDelta = Math.round((forecast.windSpeed - e.windSpeed) * 10) / 10;
  const dateLabel = formatSessionDate(sessionStartIso(e));
  const kite = e.kiteName || `${e.kiteSize}m`;
  const feeling = naturalFeelingPhrase(e.feeling);
  const spotBit = e.spotName ? ` at ${e.spotName}` : "";

  let todayWind;
  if (Math.abs(windDelta) < 1) {
    todayWind = `about the same wind as that day (~${formatKt(forecast.windSpeed)} kt now)`;
  } else if (windDelta > 0) {
    todayWind = `a bit more wind today (~${formatKt(forecast.windSpeed)} kt vs ${formatKt(e.windSpeed)} kt then)`;
  } else {
    todayWind = `lighter wind today (~${formatKt(forecast.windSpeed)} kt vs ${formatKt(e.windSpeed)} kt then)`;
  }

  const parts = [
    `On ${dateLabel}${spotBit} you rode ${kite} in ${formatKt(e.windSpeed)} kt and felt ${feeling}.`,
    `Today is ${todayWind}.`,
  ];

  if (e.gustSpeed != null && forecast.gustSpeed != null) {
    const spreadNow = gustSpread(forecast.windSpeed, forecast.gustSpeed);
    const spreadThen = gustSpread(e.windSpeed, e.gustSpeed);
    if (spreadNow > spreadThen + 4) {
      parts.push(
        `Gusts are punchier now (to ${formatKt(forecast.gustSpeed)} kt vs ${formatKt(e.gustSpeed)} kt then).`
      );
    } else if (spreadNow < spreadThen - 4) {
      parts.push("Gusts look calmer than that day.");
    }
  }

  if (e.waterDescription) {
    parts.push(`Water then: ${e.waterDescription}.`);
  } else if (e.waterType) {
    parts.push(`${e.waterType} water that day.`);
  }

  if (e.notes?.trim()) {
    parts.push(`You noted: “${e.notes.trim()}”.`);
  }

  return {
    id: e.id,
    title: `${dateLabel} · ${e.spotName || "session"} · ${formatKt(e.windSpeed)} kt · ${kite}`,
    body: parts.join(" "),
  };
}

/**
 * One past-session note when it helps explain today's Plan pick (no manual compare toggle).
 * @param {CalibrationEntry[]} entries
 * @param {KiteSpot|null} spot
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @param {{ recommendedKiteSize?: number|null, recommendedKiteName?: string|null }} [opts]
 * @returns {{ body: string }|null}
 */
export function buildRelevantSessionNote(entries, spot, forecast, opts = {}) {
  const entry = pickComparisonSession(entries, spot, forecast);
  if (!entry) return null;

  const e = normalizeSessionEntry(entry);
  const windDiff = Math.abs(e.windSpeed - forecast.windSpeed);
  const recSize = opts.recommendedKiteSize;
  const recName = opts.recommendedKiteName;
  const sizeDiff =
    recSize != null && e.kiteSize > 0 ? Math.abs(e.kiteSize - recSize) : 0;
  const sameSpot = Boolean(
    spot && (e.spotId === spot.id || e.spotName === spot.name)
  );

  let relevant = false;
  if (windDiff <= 3) relevant = true;
  if (sameSpot && windDiff <= 6) relevant = true;
  if (
    (isUnderpoweredFeeling(e.feeling) || isOverpoweredFeeling(e.feeling)) &&
    windDiff <= 6
  ) {
    relevant = true;
  }
  if (sizeDiff >= 1 && windDiff <= 6) relevant = true;
  if (e.notes?.trim() && sameSpot && windDiff <= 5) relevant = true;

  if (e.gustSpeed != null && forecast.gustSpeed != null && windDiff <= 5) {
    const spreadNow = gustSpread(forecast.windSpeed, forecast.gustSpeed);
    const spreadThen = gustSpread(e.windSpeed, e.gustSpeed);
    if (Math.abs(spreadNow - spreadThen) >= 4) relevant = true;
  }

  if (!relevant) return null;

  const card = formatSessionCompareCard(forecast, e);
  const kite = e.kiteName || `${e.kiteSize}m`;
  const flyToday = recName || (recSize != null ? `~${recSize}m` : "today's pick");

  let opener = "";
  const sizedUp =
    recSize != null && e.kiteSize > 0 && recSize >= e.kiteSize + 1;

  if (e.feeling === "slightly-underpowered" && windDiff <= 4) {
    if (sizedUp) {
      opener = `You were a little underpowered on ${kite} in similar wind — ${flyToday} is a size up, which should feel stronger. `;
    } else if (recSize != null && Math.abs(e.kiteSize - recSize) <= 0.5) {
      opener = `You were a little underpowered on ${kite} in similar wind — ${flyToday} may still feel marginal unless you're happy to push it. `;
    } else {
      opener = `You were a little underpowered on ${kite} in similar wind before. `;
    }
  } else if (isSeriousUnderpoweredFeeling(e.feeling) && windDiff <= 5) {
    opener = `You were underpowered on ${kite} in similar wind before — size up or pick a stronger day if you can. `;
  } else if (isOverpoweredFeeling(e.feeling) && windDiff <= 5) {
    opener = `You were overpowered on ${kite} in similar wind before. `;
  } else if (sizeDiff >= 1 && recSize != null) {
    if (e.kiteSize < recSize - 0.25) {
      opener = `Today points to more power than your ${kite} session. `;
    } else if (e.kiteSize > recSize + 0.25) {
      opener = `Today points to less power than your ${kite} session. `;
    }
  }

  return { body: `${opener}${card.body}`.replace(/\s+/g, " ").trim() };
}

/**
 * Downgrade a bright GO when a similar log says the same kite size was marginal.
 * @param {SessionLevel} verdict
 * @param {CalibrationEntry[]} entries
 * @param {KiteSpot|null} spot
 * @param {{ windSpeed: number, gustSpeed?: number|null }} forecast
 * @param {{ recommendedKiteSize?: number|null }} [opts]
 * @returns {SessionLevel}
 */
export function adjustPlanVerdictForSessionContext(verdict, entries, spot, forecast, opts = {}) {
  if (!entries?.length) return verdict;

  const entry = pickComparisonSession(entries, spot, forecast);
  if (!entry) return verdict;

  const e = normalizeSessionEntry(entry);
  if (Math.abs(e.windSpeed - forecast.windSpeed) > 6) return verdict;

  const recSize = opts.recommendedKiteSize;
  const sameSize =
    recSize != null && e.kiteSize > 0 && Math.abs(e.kiteSize - recSize) <= 0.5;
  const sizedUp =
    recSize != null && e.kiteSize > 0 && recSize >= e.kiteSize + 1;
  const sizedDown =
    recSize != null && e.kiteSize > 0 && recSize <= e.kiteSize - 1;
  const similarOrLighterWind = forecast.windSpeed <= e.windSpeed + 2;

  /** @param {SessionLevel} level */
  function boostConfidence(level) {
    if (level === "probably-not" || level === "maybe") return "possible";
    if (level === "possible") return "go";
    return level;
  }

  if (e.feeling === "slightly-underpowered") {
    if (sizedUp && similarOrLighterWind) {
      return boostConfidence(verdict);
    }
    if (sizedUp) return verdict;

    if (verdict !== "go") return verdict;

    if (sameSize || recSize == null) {
      return similarOrLighterWind ? "maybe" : "possible";
    }
    if (sizedDown) return "possible";
    return verdict;
  }

  if (verdict !== "go") return verdict;

  if (e.feeling === "underpowered-rideable" || e.feeling === "too-small") {
    if (sizedUp && similarOrLighterWind) return "possible";
    return sameSize ? "maybe" : "possible";
  }

  if (e.feeling === "very-underpowered" || e.feeling === "couldnt-ride") {
    if (sizedUp && similarOrLighterWind) return "possible";
    return forecast.windSpeed > e.windSpeed ? "maybe" : "probably-not";
  }

  return verdict;
}

/**
 * One line for crew "From your logs" — who rode what in similar wind.
 * @param {string} riderName
 * @param {CalibrationEntry} entry
 */
export function formatCrewPastSessionLine(riderName, entry) {
  const e = normalizeSessionEntry(entry);
  const dateLabel = formatSessionDate(sessionStartIso(e));
  const spotLabel = e.spotName || "a session";
  const kite = e.kiteName || `${e.kiteSize}m`;
  const gustPart =
    e.gustSpeed != null && e.gustSpeed > e.windSpeed
      ? ` (gusts to ${e.gustSpeed} kt)`
      : "";

  let howGood = "";
  if (e.sessionRating != null) {
    const r = e.sessionRating;
    const label =
      r >= 5 ? "epic" : r >= 4 ? "great" : r >= 3 ? "OK" : r >= 2 ? "so-so" : "tough";
    howGood = ` — ${label} session (${r}/5)`;
  } else if (e.feeling === "just-right" || e.feeling === "comfortable") {
    howGood = " — kite felt good";
  } else {
    howGood = ` — ${naturalFeelingPhrase(e.feeling)}`;
  }

  const dir =
    e.windDirection && e.windDirection.length <= 3 ? ` ${e.windDirection}` : "";

  return `${riderName} kited at ${spotLabel} in ${e.windSpeed} kt${dir}${gustPart} on ${kite} on ${dateLabel}${howGood}.`;
}

/**
 * Best similar log per rider for the crew day brief.
 * @param {{ name: string, calibration: CalibrationEntry[] }[]} riders
 * @param {KiteSpot|null} spot
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @returns {string[]}
 */
export function buildCrewPastSessionLines(riders, spot, forecast) {
  /** @type {string[]} */
  const lines = [];
  const seen = new Set();

  for (const rider of riders) {
    const entry = pickComparisonSession(rider.calibration, spot, forecast);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    lines.push(formatCrewPastSessionLine(rider.name, entry));
  }

  return lines;
}
