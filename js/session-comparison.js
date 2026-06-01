import { FEELING_LABELS } from "./calibration.js";
import { sessionStartIso } from "./session-helpers.js";
import { gustSpread } from "./wind-session-copy.js";

/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */

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
 * @param {CalibrationEntry[]} entries
 * @param {KiteSpot|null} spot
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @param {number} [limit]
 */
export function pickTopSimilarSessions(entries, spot, forecast, limit = 3) {
  const list = entries.map(normalizeSessionEntry).filter((e) => e.windSpeed > 0);
  if (!list.length) return [];

  const sameSpot = spot
    ? list.filter((e) => e.spotId === spot.id || e.spotName === spot.name)
    : [];
  const pool = sameSpot.length ? sameSpot : list;

  const scored = pool
    .map((entry) => {
      const windDiff = Math.abs(entry.windSpeed - forecast.windSpeed);
      const gustDiff =
        entry.gustSpeed != null && forecast.gustSpeed != null
          ? Math.abs(entry.gustSpeed - forecast.gustSpeed)
          : 6;
      const score = windDiff * 2 + gustDiff;
      return { entry, score };
    })
    .filter(({ score }) => score <= 20)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map((s) => s.entry);
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
  const board = e.boardName ? ` · ${e.boardName}` : "";
  const feeling = (FEELING_LABELS[e.feeling] || e.feeling).toLowerCase();

  let windBit;
  if (Math.abs(windDelta) < 1) {
    windBit = `Same ballpark wind (${e.windSpeed} kt then vs ~${forecast.windSpeed} kt forecast)`;
  } else if (windDelta > 0) {
    windBit = `${Math.abs(windDelta)} kt stronger than your ${e.windSpeed} kt session`;
  } else {
    windBit = `${Math.abs(windDelta)} kt lighter than your ${e.windSpeed} kt session`;
  }

  let gustBit = "";
  if (e.gustSpeed != null && forecast.gustSpeed != null) {
    const spreadNow = gustSpread(forecast.windSpeed, forecast.gustSpeed);
    const spreadThen = gustSpread(e.windSpeed, e.gustSpeed);
    if (spreadNow > spreadThen + 4) {
      gustBit = ` Gustier now (to ${forecast.gustSpeed} kt vs ${e.gustSpeed} kt then).`;
    } else if (spreadNow < spreadThen - 4) {
      gustBit = ` Calmer gusts than that day.`;
    }
  }

  const water = e.waterDescription
    ? ` Water then: ${e.waterDescription}.`
    : e.waterType
      ? ` ${e.waterType} water.`
      : "";

  const notes = e.notes?.trim() ? ` Notes: “${e.notes.trim()}”.` : "";

  return {
    id: e.id,
    title: `${dateLabel} · ${e.spotName || " · "} · ${e.windSpeed} kt · ${kite}${board}`,
    body: `${windBit}  ·  you rode ${kite} and it felt ${feeling}.${gustBit}${water}${notes}`,
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
  const sizeDiff =
    recSize != null && e.kiteSize > 0 ? Math.abs(e.kiteSize - recSize) : 0;
  const sameSpot = Boolean(
    spot && (e.spotId === spot.id || e.spotName === spot.name)
  );

  let relevant = false;
  if (windDiff <= 3) relevant = true;
  if (sameSpot && windDiff <= 6) relevant = true;
  if (["too-small", "too-big", "couldnt-ride"].includes(e.feeling) && windDiff <= 6) {
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
  let lead = "";

  if (sizeDiff >= 1 && recSize != null) {
    if (e.kiteSize < recSize - 0.25) {
      lead = `Today points to more power than your ${e.kiteSize}m log. `;
    } else if (e.kiteSize > recSize + 0.25) {
      lead = `Today points to less power than your ${e.kiteSize}m log. `;
    }
  } else if (e.feeling === "too-small") {
    lead = "You were underpowered in similar wind before — ";
  } else if (e.feeling === "too-big") {
    lead = "You were overpowered in similar wind before — ";
  } else if (e.feeling === "couldnt-ride") {
    lead = "You struggled in similar wind before — ";
  }

  return { body: `${lead}${card.body}`.replace(/\s+/g, " ").trim() };
}

/**
 * @param {{ windSpeed: number, gustSpeed?: number|null, windDirection?: string }} forecast
 * @param {CalibrationEntry} entry
 * @param {KiteSpot|null} [spot]
 * @returns {string}
 */
export function formatSessionComparison(forecast, entry, spot) {
  const e = normalizeSessionEntry(entry);
  const windDelta = Math.round((forecast.windSpeed - e.windSpeed) * 10) / 10;
  const gustDelta =
    forecast.gustSpeed != null && e.gustSpeed != null
      ? Math.round((forecast.gustSpeed - e.gustSpeed) * 10) / 10
      : null;

  const spotLabel = e.spotName || spot?.name || "this spot";
  const dateLabel = formatSessionDate(sessionStartIso(e));
  const kite = e.kiteName || `${e.kiteSize}m`;
  const board = e.boardName ? ` on ${e.boardName}` : "";
  const feeling = FEELING_LABELS[e.feeling] || e.feeling;
  const notes = e.notes?.trim() ? ` You said: “${e.notes.trim()}”.` : "";

  let windPhrase;
  if (Math.abs(windDelta) < 1) {
    windPhrase = `about the same wind as your ${e.windSpeed} kt session`;
  } else if (windDelta > 0) {
    windPhrase = `${Math.abs(windDelta)} kt stronger than your ${e.windSpeed} kt session`;
  } else {
    windPhrase = `${Math.abs(windDelta)} kt lighter than your ${e.windSpeed} kt session`;
  }

  let gustPhrase = "";
  if (gustDelta != null && Math.abs(gustDelta) >= 2) {
    const spreadNow = gustSpread(forecast.windSpeed, forecast.gustSpeed);
    const spreadThen = gustSpread(e.windSpeed, e.gustSpeed);
    if (spreadNow > spreadThen + 3) {
      gustPhrase = ` Gusts are punchier now (${forecast.gustSpeed} kt vs ${e.gustSpeed} kt then).`;
    } else if (spreadNow < spreadThen - 3) {
      gustPhrase = ` Gusts look calmer now (${forecast.gustSpeed ?? " · "} kt vs ${e.gustSpeed} kt then).`;
    }
  }

  const dirPhrase =
    forecast.windDirection && e.windDirection && forecast.windDirection !== e.windDirection
      ? ` Wind direction differs (${forecast.windDirection} now vs ${e.windDirection} then).`
      : "";

  const water =
    e.waterDescription ? ` Sea was: ${e.waterDescription}.` : e.waterType ? ` (${e.waterType} water).` : "";
  return `Compared with ${spotLabel} on ${dateLabel}: forecast is ${windPhrase}  ·  you rode ${kite}${board} and it felt ${feeling.toLowerCase()}.${water}${gustPhrase}${dirPhrase}${notes}`;
}

/**
 * @param {CalibrationEntry[]} entries
 * @param {string|null} [spotId]
 */
export function sessionOptionsForSelect(entries, spotId) {
  return entries
    .map(normalizeSessionEntry)
    .filter((e) => e.windSpeed > 0)
    .sort((a, b) => {
      const tb = sessionStartIso(b) ? new Date(sessionStartIso(b)).getTime() : 0;
      const ta = sessionStartIso(a) ? new Date(sessionStartIso(a)).getTime() : 0;
      return tb - ta;
    })
    .map((e) => {
      const start = sessionStartIso(e);
      const date = start
        ? new Date(start).toLocaleDateString([], { day: "numeric", month: "short" })
        : "No date";
      const spot = e.spotName || "Unknown spot";
      const kite = e.kiteName || `${e.kiteSize}m`;
      return {
        id: e.id,
        label: `${date} · ${spot} · ${e.windSpeed} kt · ${kite} · ${FEELING_LABELS[e.feeling]}`,
      };
    });
}
