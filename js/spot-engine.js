import {
  getTideExtremaFromHourly,
  getTideHourInfo,
} from "./tide-planning.js";

/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */
/** @typedef {import('./tides.js').TideSummary} TideSummary */
/** @typedef {import('./tides.js').TidePrediction} TidePrediction */

/**
 * @typedef {Object} SpotEvaluation
 * @property {number} scoreAdjust
 * @property {string[]} notes
 * @property {boolean} launchOk
 * @property {boolean} windOffshore
 * @property {'good'|'marginal'|'bad'} windDirectionStatus
 * @property {string} [tideNote]
 * @property {boolean} tideLaunchRuleActive
 * @property {boolean} tideAccessOk
 * @property {string|null} tideLaunchNote
 */

/** @param {KiteSpot} spot */
export function hasTideLaunchRule(spot) {
  return !!(spot.tideAccessRule && spot.tideAccessRule !== "none");
}

/**
 * Tide launch window for “now” or a specific hour (uses your spot rule + forecast tide times).
 * @param {KiteSpot} spot
 * @param {string} isoTime
 * @param {TidePrediction[]} [predictions]
 */
export function assessTideLaunchWindow(spot, isoTime, predictions = []) {
  const rule = spot.tideAccessRule || "none";
  if (!hasTideLaunchRule(spot) || !predictions.length) {
    return {
      tideLaunchRuleActive: false,
      tideAccessOk: true,
      tideLaunchNote: null,
      tideLabel: null,
    };
  }
  const extrema = getTideExtremaFromHourly(predictions);
  const info = getTideHourInfo(
    isoTime,
    predictions,
    rule,
    spot.tideWindowHours ?? 3,
    extrema
  );
  return {
    tideLaunchRuleActive: true,
    tideAccessOk: info.accessAllowed,
    tideLaunchNote: info.accessNote,
    tideLabel: info.label,
  };
}

/** @param {KiteSpot} spot @param {{ windDirection: string, spotNotes?: string }} conditions @param {TideSummary|null} [tides] */
export function evaluateSpot(spot, conditions, tides = null) {
  const notes = [];
  let scoreAdjust = 0;
  let launchOk = true;
  let windDirectionStatus = /** @type {'good'|'marginal'|'bad'} */ ("good");

  const dir = conditions.windDirection?.toUpperCase();
  const windOffshore = isOffshoreWind(spot, dir);

  if (windOffshore) {
    scoreAdjust -= 18;
    windDirectionStatus = "marginal";
    notes.push(
      `${dir} is offshore for ${spot.name} (you marked ${spot.offshoreDirections.join(", ")} as offshore). We compare forecast direction to your spot settings  ·  not auto-detected from the coastline.`
    );
  } else if (!spot.safeDirections.map((d) => d.toUpperCase()).includes(dir)) {
    scoreAdjust -= 20;
    windDirectionStatus = "marginal";
    notes.push(
      `${dir} is marginal at ${spot.name}. Safe directions: ${spot.safeDirections.join(", ")}.`
    );
  } else {
    notes.push(`${dir} is within the safe launch window for ${spot.name}.`);
  }

  if (spot.launchNotes.trim()) {
    notes.push(`Launch: ${spot.launchNotes.trim()}`);
  }

  const local = spot.localKnowledge.trim();
  if (local) {
    notes.push(`Local knowledge: ${local}`);
    const lower = local.toLowerCase();
    if (lower.includes("offshore") || lower.includes("do not ride") || lower.includes("don't ride")) {
      scoreAdjust -= 30;
      launchOk = false;
    }
    if (lower.includes("low tide only") || lower.includes("not rideable at high tide")) {
      notes.push("Local note mentions tide constraints  ·  check tide summary below.");
    }
  }

  let tideNote;
  if (tides && tides.source !== "none") {
    tideNote = tides.summary;
    if (tides.status === "bad") scoreAdjust -= 25;
    else if (tides.status === "marginal") scoreAdjust -= 10;
    notes.push(`Tide (${tides.source}): ${tides.summary}`);
  }

  const combinedNotes = [conditions.spotNotes, local].filter(Boolean).join(" ");
  if (combinedNotes.toLowerCase().includes("offshore") && !windOffshore) {
    scoreAdjust -= 10;
    notes.push("Spot notes mention offshore conditions  ·  double-check wind direction.");
  }

  const nowIso = new Date().toISOString();
  const tideLaunch = assessTideLaunchWindow(spot, nowIso, tides?.predictions ?? []);
  if (tideLaunch.tideLaunchRuleActive) {
    if (!tideLaunch.tideAccessOk && tideLaunch.tideLaunchNote) {
      scoreAdjust -= 22;
      notes.push(tideLaunch.tideLaunchNote);
    } else {
      notes.push(
        `Inside your tide launch window (${spot.tideWindowHours ?? 3}h around ${spot.tideAccessRule === "within_low" ? "low" : "high"} tide).`
      );
    }
  }

  return {
    scoreAdjust,
    notes,
    launchOk,
    windOffshore,
    windDirectionStatus,
    tideNote,
    tideLaunchRuleActive: tideLaunch.tideLaunchRuleActive,
    tideAccessOk: tideLaunch.tideAccessOk,
    tideLaunchNote: tideLaunch.tideLaunchNote,
  };
}

/** @param {KiteSpot} spot @param {string} windDirection */
export function isOffshoreWind(spot, windDirection) {
  const dir = windDirection?.toUpperCase();
  if (!dir) return false;
  return spot.offshoreDirections.map((d) => d.toUpperCase()).includes(dir);
}
