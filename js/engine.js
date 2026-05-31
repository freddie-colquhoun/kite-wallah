import { getSkillLimits, getAbilityDef, normalizeAbility } from "./ability-levels.js";
import { rateNowSession } from "./session-rating.js";
import {
  getCalibrationAtWind,
  applyCalibrationToScore,
  adjustSuitabilityWithCalibration,
} from "./calibration.js";
import {
  getEffectiveKiteRange,
  scoreWindAgainstEffectiveRange,
  describeWindVsKiteRange,
} from "./kite-personal-range.js";

/** @typedef {import('./ability-levels.js').AbilityLevel} AbilityLevel */
/** @typedef {'flat' | 'choppy' | 'waves'} WaterType */
/** @typedef {'hybrid' | 'bow' | 'c' | 'foil'} KiteType */
/** @typedef {'twin-tip' | 'surfboard' | 'foil' | 'light-wind'} BoardType */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {import('./spot-engine.js').SpotEvaluation} SpotEvaluation */
/** @typedef {import('./tides.js').TideSummary} TideSummary */
/** @typedef {import('./spots-storage.js').KiteSpot} KiteSpot */

/**
 * @typedef {Object} Conditions
 * @property {number} windSpeed
 * @property {number|null} gustSpeed
 * @property {string} windDirection
 * @property {WaterType} waterType
 * @property {AbilityLevel|string} skillLevel
 * @property {number} riderWeight
 * @property {string} spotNotes
 */

/**
 * @typedef {Object} Kite
 * @property {string} id
 * @property {number} size
 * @property {string} name
 * @property {KiteType} type
 * @property {string} [brand]
 * @property {string} [model]
 * @property {string} [style]
 * @property {{ min: number, ideal: number, max: number }} [windRange]
 * @property {number} [weightRef]
 * @property {string} [specsSource]
 * @property {number|null} [yearManufactured]
 * @property {string} [purchasedFrom]
 * @property {string} [purchaseDate] ISO date YYYY-MM-DD
 */

/**
 * @typedef {Object} Board
 * @property {string} id
 * @property {BoardType} type
 * @property {string} name
 * @property {number|null} sizeCm
 * @property {number|null} [yearManufactured]
 * @property {string} [purchasedFrom]
 * @property {string} [purchaseDate] ISO date YYYY-MM-DD
 */

const REFERENCE_WEIGHT = 75;

const KITE_TYPE_LABELS = {
  hybrid: "Hybrid / all-round",
  bow: "Bow / delta",
  c: "C-kite",
  foil: "Foil kite",
};

const BOARD_TYPE_LABELS = {
  "twin-tip": "Twin tip",
  surfboard: "Surfboard / directional",
  foil: "Hydrofoil",
  "light-wind": "Light-wind board",
};

const WATER_LABELS = {
  flat: "flat water",
  choppy: "choppy water",
  waves: "waves",
};

export function genericKiteWindRange(size, riderWeight = REFERENCE_WEIGHT) {
  const weightFactor = riderWeight / REFERENCE_WEIGHT;
  const adjustedSize = size * Math.pow(weightFactor, 0.35);
  const ideal = Math.max(8, 42 - adjustedSize * 2.8);
  const spread = 4 + adjustedSize * 0.35;
  return {
    min: Math.round((ideal - spread) * 10) / 10,
    ideal: Math.round(ideal * 10) / 10,
    max: Math.round((ideal + spread + 2) * 10) / 10,
  };
}

/** @param {Kite} kite @param {number} [riderWeight] */
export function getKiteWindRange(kite, riderWeight = REFERENCE_WEIGHT) {
  if (kite.windRange) return { ...kite.windRange };
  return genericKiteWindRange(kite.size, riderWeight);
}

function kiteMatchScore(windSpeed, kite, riderWeight) {
  const { min, ideal, max } = getKiteWindRange(kite, riderWeight);
  if (windSpeed < min || windSpeed > max) {
    const distance = windSpeed < min ? min - windSpeed : windSpeed - max;
    return Math.max(0, 40 - distance * 12);
  }
  const distFromIdeal = Math.abs(windSpeed - ideal);
  return Math.round(100 - distFromIdeal * 8);
}

/** @param {Conditions} conditions @param {CalibrationEntry[]} [calibration] @param {SpotEvaluation|null} [spotEval] */
export function assessSuitability(conditions, calibration = [], spotEval = null) {
  const { windSpeed, gustSpeed } = conditions;
  const level = normalizeAbility(conditions.skillLevel);
  const limits = getSkillLimits(level);
  const ability = getAbilityDef(level);
  const notes = [];
  let score = 100;

  if (windSpeed < limits.minWind) {
    score -= (limits.minWind - windSpeed) * 8;
    notes.push(
      `At ${windSpeed} kt, wind is below the typical band for a ${ability.label} rider (~${limits.minWind} kt minimum).`
    );
  }

  if (windSpeed > limits.maxWind) {
    score -= (windSpeed - limits.maxWind) * 6;
    notes.push(
      `At ${windSpeed} kt, wind is above what's comfortable for a ${ability.label} rider (~${limits.maxWind} kt max).`
    );
  }

  if (gustSpeed != null && gustSpeed > windSpeed) {
    const spread = gustSpeed - windSpeed;
    if (spread > limits.maxGustSpread * 1.25) {
      score -= Math.min(35, (spread - limits.maxGustSpread) * 5);
    } else if (spread > limits.maxGustSpread) {
      score -= (spread - limits.maxGustSpread) * 4;
    } else if (spread > limits.maxGustSpread * 0.6) {
      notes.push(`Moderate gustiness (+${spread} kt). Size for the average wind; stay ready for brief extra power.`);
    }
  }

  if (windSpeed < 10) {
    score -= 25;
    notes.push("Below 10 kt is usually not rideable without a very large kite or foil.");
  }

  const gustSpreadVal =
    gustSpeed != null && gustSpeed > windSpeed ? gustSpeed - windSpeed : 0;
  if (
    windSpeed >= 10 &&
    windSpeed <= 14 &&
    gustSpreadVal <= limits.maxGustSpread * 0.5
  ) {
    notes.push(
      "Light-wind session: expect slower riding, more kite movement, and harder upwind progress."
    );
  }
  if (gustSpreadVal > limits.maxGustSpread * 1.25) {
    notes.push(
      `Very gusty: ${windSpeed} kt average with gusts to ${gustSpeed} kt (+${gustSpreadVal} kt). Gust-management day: size for the average, sheet out in the spikes.`
    );
  } else if (gustSpreadVal > limits.maxGustSpread * 0.75) {
    notes.push(
      `Gusty: gusts to ${gustSpeed} kt (+${gustSpreadVal} kt above average). Expect power spikes; keep the kite high in the lulls.`
    );
  }

  if (windSpeed > 35) {
    score -= 15;
    notes.push("Above 35 kt is expert territory. Most riders stay off the water.");
  }

  if (conditions.waterType === "waves" && ["newcomer", "novice"].includes(level)) {
    score -= 15;
    notes.push("Wave conditions are demanding at your level. Flat water is safer.");
  }

  if (conditions.spotNotes.toLowerCase().includes("offshore")) {
    score -= 20;
    notes.push("Offshore wind is dangerous. Only ride with boat support.");
  }

  const calAdjust = adjustSuitabilityWithCalibration(score, windSpeed, calibration);
  score = calAdjust.score;
  if (calAdjust.calibrationNote) notes.unshift(calAdjust.calibrationNote);

  if (spotEval) {
    score += spotEval.scoreAdjust;
    notes.unshift(...spotEval.notes);
    if (!spotEval.launchOk) {
      score = Math.min(score, 25);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict;
  const inBand = windSpeed >= limits.minWind && windSpeed <= limits.maxWind;
  if (score >= 68 && inBand && windSpeed >= limits.minWind + 2) verdict = "good";
  else if (score >= 70) verdict = "good";
  else if (score >= 45) verdict = "marginal";
  else verdict = "bad";

  const rideable = score >= 45 && windSpeed >= 10 && (!spotEval || spotEval.launchOk);

  return { score, verdict, rideable, notes, limits, abilityLevel: level };
}

/** @param {Conditions} conditions @param {Kite[]} kites @param {CalibrationEntry[]} [calibration] */
export function recommendKite(conditions, kites, calibration = []) {
  if (!kites?.length) return null;

  const cal = getCalibrationAtWind(conditions.windSpeed, calibration);
  const wind = conditions.windSpeed;

  const scored = kites
    .map((kite) => {
      const catalog = getKiteWindRange(kite, conditions.riderWeight);
      const effective = getEffectiveKiteRange(kite, catalog, calibration);
      const { score: rangeScore, band } = scoreWindAgainstEffectiveRange(wind, effective);
      const { score: calibratedScore } = applyCalibrationToScore(
        rangeScore,
        kite.size,
        wind,
        calibration
      );
      const sessionBoost =
        effective.source === "sessions" && effective.confidence === "high" ? 8 : 0;

      return {
        kite,
        score: Math.min(100, calibratedScore + sessionBoost),
        baseScore: rangeScore,
        range: effective,
        catalog,
        band,
        effective,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const inRange = wind >= best.range.min && wind <= best.range.max;
  const inCatalog =
    wind >= best.catalog.min && wind <= best.catalog.max;

  return {
    kite: best.kite,
    score: best.score,
    range: { min: best.range.min, ideal: best.range.ideal, max: best.range.max },
    catalogRange: best.catalog,
    effectiveRange: best.effective,
    inRange,
    inCatalog,
    comfortBand: best.band,
    alternatives: scored.slice(1, 3).map((a) => ({
      kite: a.kite,
      score: a.score,
      range: { min: a.range.min, ideal: a.range.ideal, max: a.range.max },
    })),
    reason: buildKiteReason({ ...best, inRange, inCatalog }, conditions, cal),
    comfortNote: describeWindVsKiteRange(wind, best.effective),
    calibration: cal,
  };
}

/**
 * @param {object} best
 * @param {Conditions} conditions
 * @param {ReturnType<typeof getCalibrationAtWind>} cal
 */
function buildKiteReason(best, conditions, cal) {
  const { kite, range, catalog, effective, inRange, band } = best;
  const name = kite.name || `${kite.brand ?? ""} ${kite.size}m`.trim();
  const specNote = kite.specsSource === "manufacturer" ? "manufacturer chart" : "estimated chart";
  const wind = conditions.windSpeed;

  let reason = "";

  if (effective.source === "sessions" && effective.personal?.happyCount) {
    if (band === "sweet") {
      reason = `${name} fits winds where you've been comfortable on this kite.`;
    } else if (band === "extended") {
      reason = `${name} is above your usual comfortable top on this kite, but you've ridden it in similar wind before.`;
    } else if (band === "light") {
      reason = `${name} may feel light at ${wind} kt based on your sessions (you've preferred it from about ${effective.personal.funMin} kt).`;
    } else if (band === "strong") {
      reason = `${name} is stronger than winds you've been happy on with this kite in your log.`;
    } else if (inRange) {
      reason = `${name} sits in your logged comfort band for this kite.`;
    }
  } else if (effective.source === "blend" && effective.personal?.happyCount) {
    reason = `${name} sized using your session history and the ${specNote}.`;
  } else if (inRange) {
    if (Math.abs(wind - range.ideal) <= 2) {
      reason = `${name} sits in the sweet spot of its ${specNote} at ${wind} kt.`;
    } else if (wind < range.ideal) {
      reason = `${name} should give enough power at ${wind} kt without feeling overpowered.`;
    } else {
      reason = `${name} is toward the top of its ${specNote} at ${wind} kt.`;
    }
  } else if (wind < catalog.min) {
    reason = `${name} is your largest kite but ${wind} kt may still feel light (chart from ${catalog.min} kt).`;
  } else {
    reason = `${name} is your smallest kite but ${wind} kt may feel strong (chart to ${catalog.max} kt).`;
  }

  if (cal.preferredSize != null && effective.confidence === "none") {
    const diff = Math.abs(kite.size - cal.preferredSize);
    if (diff <= 0.5) {
      reason += ` Matches sizes you've used near ${wind} kt in other sessions.`;
    } else if (diff >= 1.5) {
      reason += ` You've often used ~${cal.preferredSize}m near ${wind} kt; log more on ${name} to tune this kite.`;
    }
  }

  return reason;
}

/** @param {Conditions} conditions @param {Board[]} boards */
export function recommendBoard(conditions, boards) {
  if (!boards.length) return null;

  const { windSpeed, waterType, skillLevel } = conditions;
  const level = normalizeAbility(skillLevel);
  const isLight = windSpeed < 14;
  const isStrong = windSpeed > 24;

  const priority = getBoardPriority(waterType, isLight, isStrong, level);

  const scored = boards
    .map((board) => ({
      board,
      score: boardPriorityScore(board.type, priority),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  return {
    board: best.board,
    score: best.score,
    reason: buildBoardReason(best.board, conditions, priority[0]),
  };
}

function getBoardPriority(waterType, isLight, isStrong, level) {
  if (waterType === "waves") {
    return ["surfboard", "twin-tip", "light-wind", "foil"];
  }
  if (isLight) {
    return ["foil", "light-wind", "twin-tip", "surfboard"];
  }
  if (isStrong && !["newcomer", "novice"].includes(level)) {
    return ["twin-tip", "surfboard", "light-wind", "foil"];
  }
  if (waterType === "flat") {
    return ["twin-tip", "light-wind", "foil", "surfboard"];
  }
  return ["twin-tip", "light-wind", "surfboard", "foil"];
}

function boardPriorityScore(boardType, priority) {
  const idx = priority.indexOf(boardType);
  return idx === -1 ? 20 : 100 - idx * 25;
}

function buildBoardReason(board, conditions, preferredType) {
  const name = board.name || BOARD_TYPE_LABELS[board.type];
  const { waterType, windSpeed } = conditions;

  if (board.type === preferredType) {
    if (board.type === "surfboard" && waterType === "waves") {
      return `${name} suits wave riding  ·  drive off the rail and match the swell.`;
    }
    if (board.type === "foil" && windSpeed < 14) {
      return `${name} makes the most of light wind when others stay on the beach.`;
    }
    if (board.type === "twin-tip") {
      return `${name} is versatile for ${waterType} conditions at ${windSpeed} kt.`;
    }
    if (board.type === "light-wind") {
      return `${name} helps you plane early when wind is on the lighter side.`;
    }
  }
  return `${name} is the best match from your quiver for these conditions.`;
}

/**
 * Rich narrative about what to expect on the water.
 * @param {Conditions} conditions
 * @param {ReturnType<typeof assessSuitability>} suitability
 * @param {CalibrationEntry[]} calibration
 * @param {{ spot?: KiteSpot|null, spotEval?: SpotEvaluation|null, tides?: TideSummary|null, windSource?: string|null }} [context]
 */
export function describeConditions(conditions, suitability, calibration = [], context = {}) {
  const { windSpeed, gustSpeed, waterType, windDirection } = conditions;
  const level = normalizeAbility(conditions.skillLevel);
  const ability = getAbilityDef(level);
  const cal = getCalibrationAtWind(windSpeed, calibration);
  const sections = [];

  const spread = gustSpeed != null && gustSpeed > windSpeed ? gustSpeed - windSpeed : 0;
  const limits = getSkillLimits(level);

  // On the water
  let onWater = "";
  if (spread > limits.maxGustSpread * 1.25) {
    onWater = `Forecast averages ${windSpeed} kt but gusts to ${gustSpeed} kt (${spread} kt spread). On the water you'll feel long lulls then sharp surges. It's a gust-management day: size for the ${windSpeed} kt average and keep the kite high.`;
  } else if (spread > limits.maxGustSpread * 0.75) {
    onWater = `Around ${windSpeed} kt with gusts to ${gustSpeed} kt. Noticeably gusty: expect power to ramp up quickly. Size for the average wind and stay alert in the lulls.`;
  } else if (windSpeed < 12) {
    onWater =
      "Expect a slow, technical session. The kite will need constant movement to stay flying (figure-eights and smooth steering). Riding speed will be modest and upwind will take patience.";
  } else if (windSpeed <= 16) {
    onWater =
      "Moderate power: enough to cruise and practise manoeuvres without feeling rushed. Good for working on technique, transitions, and controlled jumps. The kite should feel responsive without pulling you off your edge.";
  } else if (windSpeed <= 22) {
    onWater =
      "Solid freeride conditions. You'll have plenty of power for upwind riding, jumps, and carving. Edging hard will feel natural and the kite will sit comfortably in the window.";
  } else if (windSpeed <= 28) {
    onWater =
      "Strong session. Expect fast riding, heavy load on your legs, and a smaller kite. Stay alert: gusts will hit harder and recovery from mistakes takes longer.";
  } else {
    onWater =
      "Very strong wind. Only ride if you're fully comfortable being overpowered. Short lines, small kite, and conservative choices are the order of the day.";
  }

  if (waterType === "flat") {
    onWater += " Flat water makes learning and landing tricks easier.";
  } else if (waterType === "choppy") {
    onWater += " Choppy water adds bump-and-jump opportunities but makes landings and board control harder.";
  } else {
    onWater += " In waves, timing your set and managing drift downwind become as important as kite choice.";
  }

  sections.push({ title: "On the water", text: onWater });

  // Launch & safety
  let launch = `Wind from the ${windDirection}. `;
  if (spread > limits.maxGustSpread * 1.25) {
    launch += `Gusts to ${gustSpeed} kt (+${spread} kt). Consider assisted launch, keep the kite high, and avoid parking low in the spikes. `;
  } else if (gustSpeed && spread >= 5) {
    launch += `With gusts to ${gustSpeed} kt, size for the average wind and keep the kite high on launch. `;
  } else if (gustSpeed) {
    launch += `Gusts to ${gustSpeed} kt: manageable but stay aware at the launch zone. `;
  } else {
    launch += "Steady wind makes launching and landing straightforward. ";
  }

  if (windSpeed <= 14) {
    launch +=
      "In lighter wind, launch with the kite at 12 o'clock and avoid oversheeting; the kite can back-stall if you're too aggressive.";
  } else if (windSpeed >= 25) {
    launch +=
      "In strong wind, consider a assisted launch, keep lines clear, and have an exit plan if overpowered.";
  }

  sections.push({ title: "Launch & handling", text: launch });

  // Confidence / calibration
  let confidence = "";
  if (cal.confidence === "high") {
    confidence = `${cal.summary} We're confident in this recommendation for ${windSpeed} kt.`;
  } else if (cal.confidence === "medium") {
    confidence = `${cal.summary} Recommendation blends manufacturer specs with your history. Log more past sessions to sharpen it.`;
  } else if (cal.confidence === "low") {
    confidence = `Limited past-session data near ${windSpeed} kt. The recommendation uses manufacturer ranges and your ability level. Log sessions under Riders if you're unsure, especially around ${windSpeed} kt.`;
  } else {
    confidence = `No past sessions logged yet. This recommendation is based on manufacturer kite ranges and your profile (${ability.label}). If ${windSpeed} kt feels borderline for you, log similar days under Sessions.`;
  }

  if (suitability.verdict === "marginal" && windSpeed <= 15 && spread <= limits.maxGustSpread * 0.5) {
    confidence +=
      " At this wind speed, many riders feel underpowered at first. Give yourself 10-15 minutes on the water before deciding to swap kites.";
  }
  if (spread > limits.maxGustSpread * 0.75) {
    confidence +=
      " Gust spread is the main story today. Don't judge the session by the average wind alone.";
  }

  sections.push({ title: "How confident are we?", text: confidence });

  // Ability-specific tip
  const tip =
    level === "newcomer" || level === "novice"
      ? "Stay in waist-deep water if you can, and focus on kite control over distance."
      : level === "intermediate"
        ? "Good day to practise transitions  ·  wind is forgiving enough to recover from mistakes."
        : level === "jumper"
          ? "Conditions suit working on jump height and landings  ·  watch your landing zone in " +
            WATER_LABELS[waterType] +
            "."
          : "Push your riding but keep a size-down option in mind if gusts build.";

  sections.push({ title: "Tip for your level", text: tip });

  if (context.spot) {
    let spotText = `Analysing for ${context.spot.name}. `;
    if (context.windSource) spotText += `Wind from ${context.windSource}. `;
    if (context.spotEval) {
      spotText +=
        context.spotEval.windDirectionStatus === "good"
          ? "Launch direction looks acceptable. "
          : context.spotEval.windDirectionStatus === "bad"
            ? "Launch direction is unsafe  ·  see warnings. "
            : "Launch direction is marginal. ";
    }
    if (context.tides?.source && context.tides.source !== "none") {
      spotText += context.tides.summary;
    }
    sections.unshift({ title: "Your spot", text: spotText });
  }

  return sections;
}

/**
 * @param {Conditions} conditions
 * @param {{ kites: Kite[], boards: Board[] }} quiver
 * @param {CalibrationEntry[]} [calibration]
 * @param {{ spot?: KiteSpot|null, spotEval?: SpotEvaluation|null, tides?: TideSummary|null, windSource?: string|null }} [context]
 */
export function analyze(conditions, quiver, calibration = [], context = {}) {
  const suitability = assessSuitability(conditions, calibration, context.spotEval ?? null);
  const sessionLevel = rateNowSession(suitability, conditions.windSpeed, suitability.limits, {
    launchOk: context.spotEval?.launchOk !== false,
    gustSpeed: conditions.gustSpeed,
  });
  const kiteRec = recommendKite(conditions, quiver.kites, calibration);
  const boardRec = recommendBoard(conditions, quiver.boards);
  const conditionGuide = describeConditions(conditions, suitability, calibration, context);

  return {
    suitability,
    sessionLevel,
    kiteRec,
    boardRec,
    conditionGuide,
    spotEval: context.spotEval ?? null,
  };
}

export { KITE_TYPE_LABELS, BOARD_TYPE_LABELS, genericKiteWindRange as kiteWindRange };
