/**
 * Per-kite comfort ranges from logged sessions.
 * Manufacturer charts + model character are the baseline; sessions refine per kite
 * or lightly hint from same-size logs on other brands.
 */

import { adjustCatalogForCharacter, getKiteCharacter } from "./kite-character.js";
import {
  isHappyFeeling,
  isUnderpoweredFeeling,
  isOverpoweredFeeling,
} from "./calibration.js";

/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {import('./engine.js').Kite} Kite */

/**
 * @typedef {'none'|'low'|'medium'|'high'} RangeConfidence
 */

/**
 * @typedef {Object} KitePersonalRange
 * @property {number|null} funMin
 * @property {number|null} comfortMax
 * @property {number|null} pushMax
 * @property {number|null} ideal
 * @property {number} sampleCount
 * @property {number} happyCount
 * @property {RangeConfidence} confidence
 * @property {'this-kite'|'size-hint'|'none'} [source]
 */

/**
 * @typedef {Object} EffectiveKiteRange
 * @property {number} min
 * @property {number} ideal
 * @property {number} max
 * @property {{ min: number, ideal: number, max: number }} catalog
 * @property {KitePersonalRange|null} personal
 * @property {'catalog'|'blend'|'sessions'|'size-hint'} source
 * @property {RangeConfidence} confidence
 * @property {import('./kite-character.js').KiteCharacter} [character]
 * @property {number|null} [sessionWindMin] lowest wind (kt) you were happy on this size — unblended
 */

/** Weight for same-size sessions on a different quiver kite */
const SIZE_CLASS_SESSION_WEIGHT = 0.35;

/**
 * @param {CalibrationEntry} entry
 * @param {Kite} kite
 * @returns {number} 1 = this kite, 0.35 = same size other brand, 0 = ignore
 */
export function sessionEntryWeight(entry, kite) {
  if (entry.kiteId && kite.id && entry.kiteId === kite.id) return 1;
  if (entry.kiteSize == null || !kite.size) return 0;
  if (Math.abs(entry.kiteSize - kite.size) >= 0.5) return 0;
  if (entry.kiteId && kite.id) return SIZE_CLASS_SESSION_WEIGHT;
  if (!entry.kiteId) return SIZE_CLASS_SESSION_WEIGHT * 0.5;
  return 0;
}

/**
 * @param {CalibrationEntry[]} entries
 * @param {Kite} kite
 * @param {number} minWeight
 */
function buildPersonalFromSessions(entries, kite, minWeight) {
  const picked = entries.filter((e) => sessionEntryWeight(e, kite) >= minWeight);
  if (!picked.length) {
    return {
      funMin: null,
      comfortMax: null,
      pushMax: null,
      ideal: null,
      sampleCount: 0,
      happyCount: 0,
      confidence: /** @type {RangeConfidence} */ ("none"),
      source: /** @type {'none'} */ ("none"),
    };
  }

  const happy = picked.filter((e) => isHappyFeeling(e.feeling));
  const tooSmall = picked.filter((e) => isUnderpoweredFeeling(e.feeling));
  const tooBig = picked.filter((e) => isOverpoweredFeeling(e.feeling));

  let funMin = null;
  if (happy.length) {
    funMin = Math.min(...happy.map((e) => e.windSpeed));
  } else if (tooSmall.length) {
    funMin = Math.round(Math.max(...tooSmall.map((e) => e.windSpeed)) + 1);
  }

  let comfortMax = null;
  if (happy.length) {
    comfortMax = Math.max(...happy.map((e) => e.windSpeed));
  }

  const pushCandidates = tooBig.filter((e) => (e.sessionRating ?? 3) >= 3);
  let pushMax = null;
  if (pushCandidates.length) {
    pushMax = Math.max(...pushCandidates.map((e) => e.windSpeed));
  } else if (tooBig.length === 1 && (tooBig[0].sessionRating ?? 0) >= 4) {
    pushMax = tooBig[0].windSpeed;
  }

  let ideal = null;
  if (happy.length) {
    const speeds = happy.map((e) => e.windSpeed).sort((a, b) => a - b);
    ideal = speeds[Math.floor(speeds.length / 2)];
  }

  let confidence = /** @type {RangeConfidence} */ ("low");
  const directCount = picked.filter((e) => sessionEntryWeight(e, kite) >= 1).length;
  if (happy.length >= 2 && directCount >= 1) confidence = "high";
  else if (happy.length >= 2 || (happy.length >= 1 && directCount >= 1)) confidence = "medium";
  else if (happy.length >= 1 || picked.length >= 2) confidence = "low";

  const source =
    directCount >= 1 ? /** @type {'this-kite'} */ ("this-kite") : /** @type {'size-hint'} */ ("size-hint");

  if (minWeight >= 1 && directCount === 0) {
    return {
      funMin: null,
      comfortMax: null,
      pushMax: null,
      ideal: null,
      sampleCount: 0,
      happyCount: 0,
      confidence: "none",
      source: "none",
    };
  }

  return {
    funMin,
    comfortMax,
    pushMax,
    ideal,
    sampleCount: picked.length,
    happyCount: happy.length,
    confidence: minWeight >= 1 ? confidence : confidence === "high" ? "medium" : "low",
    source,
  };
}

/** @param {Kite} kite @param {CalibrationEntry[]} entries */
export function getKitePersonalRange(kite, entries) {
  const direct = buildPersonalFromSessions(entries, kite, 1);
  if (direct.confidence !== "none") return direct;
  return buildPersonalFromSessions(entries, kite, SIZE_CLASS_SESSION_WEIGHT);
}

/**
 * @param {Kite} kite
 * @param {{ min: number, ideal: number, max: number }} catalog
 * @param {CalibrationEntry[]} entries
 */
export function getEffectiveKiteRange(kite, catalog, entries) {
  const character = getKiteCharacter(kite);
  const catalogAdj = adjustCatalogForCharacter(catalog, character);
  const personal = getKitePersonalRange(kite, entries);

  if (personal.confidence === "none") {
    return {
      min: catalogAdj.min,
      ideal: catalogAdj.ideal,
      max: catalogAdj.max,
      catalog: catalogAdj,
      personal: null,
      source: "catalog",
      confidence: "none",
      character,
    };
  }

  const sessionWindMin =
    personal.happyCount > 0 && personal.funMin != null ? personal.funMin : null;

  const blend =
    personal.source === "size-hint"
      ? 0.28
      : personal.confidence === "low"
        ? 0.35
        : personal.confidence === "medium"
          ? 0.65
          : 1;

  let funMin =
    personal.funMin != null
      ? Math.round((catalogAdj.min * (1 - blend) + personal.funMin * blend) * 10) / 10
      : catalogAdj.min;

  if (
    sessionWindMin != null &&
    sessionWindMin > catalogAdj.min + 3 &&
    sessionWindMin > funMin + 1
  ) {
    funMin = sessionWindMin;
  }

  const comfortMax =
    personal.comfortMax != null
      ? Math.round((catalogAdj.max * (1 - blend) + personal.comfortMax * blend) * 10) / 10
      : catalogAdj.max;

  const pushMax =
    personal.pushMax != null && blend >= 0.65
      ? personal.pushMax
      : personal.pushMax != null && blend >= 0.35
        ? Math.round((catalogAdj.max + personal.pushMax) / 2)
        : catalogAdj.max;

  const ideal =
    personal.ideal != null
      ? Math.round((catalogAdj.ideal * (1 - blend) + personal.ideal * blend) * 10) / 10
      : catalogAdj.ideal;

  const effectiveMax = Math.max(comfortMax, pushMax);

  let source = /** @type {EffectiveKiteRange['source']} */ ("blend");
  if (blend >= 0.65 && personal.source === "this-kite") source = "sessions";
  else if (personal.source === "size-hint") source = "size-hint";

  return {
    min: funMin,
    ideal,
    max: effectiveMax,
    catalog: catalogAdj,
    personal,
    source,
    confidence: personal.confidence,
    character,
    sessionWindMin,
  };
}

/**
 * @param {number} windSpeed
 * @param {EffectiveKiteRange} effective
 */
export function scoreWindAgainstEffectiveRange(windSpeed, effective) {
  const { min, ideal, max, catalog, personal, sessionWindMin } = effective;

  if (
    sessionWindMin != null &&
    windSpeed < sessionWindMin - 0.5
  ) {
    const gap = sessionWindMin - windSpeed;
    return {
      band: /** @type {'light'} */ ("light"),
      score: Math.max(0, Math.round(32 - gap * 9)),
    };
  }

  if (personal?.pushMax != null && windSpeed > (personal.comfortMax ?? catalog.max) && windSpeed <= personal.pushMax) {
    const over = windSpeed - (personal.comfortMax ?? catalog.max);
    const span = Math.max(1, personal.pushMax - (personal.comfortMax ?? catalog.max));
    return {
      band: /** @type {'extended'} */ ("extended"),
      score: Math.round(Math.max(48, 72 - (over / span) * 22)),
    };
  }

  if (windSpeed < min) {
    const distance = min - windSpeed;
    return { band: /** @type {'light'} */ ("light"), score: Math.max(0, 42 - distance * 10) };
  }

  if (windSpeed > max) {
    const distance = windSpeed - max;
    return { band: /** @type {'strong'} */ ("strong"), score: Math.max(0, 38 - distance * 12) };
  }

  const distFromIdeal = Math.abs(windSpeed - ideal);
  return { band: /** @type {'sweet'} */ ("sweet"), score: Math.round(100 - distFromIdeal * 8) };
}

/**
 * @param {number} windSpeed
 * @param {EffectiveKiteRange} effective
 */
export function describeWindVsKiteRange(windSpeed, effective) {
  const { catalog, personal, source, confidence, character } = effective;
  const parts = [];

  if (source === "catalog" || !personal) {
    if (character?.label && source === "catalog") {
      return `${character.label} (manufacturer chart ${formatKt(catalog.min)}-${formatKt(catalog.max)} kt).`;
    }
    return null;
  }

  const cat = `${formatKt(catalog.min)}-${formatKt(catalog.max)} kt (chart + model)`;

  if (personal.source === "size-hint") {
    const sizeM = personal.ideal != null ? `around ${formatKt(personal.ideal)} kt` : "similar wind";
    parts.push(
      `No sessions on this kite yet — your ${personal.sampleCount} same-size log${personal.sampleCount > 1 ? "s" : ""} on other kites suggest ${sizeM}; ${character?.label || "model chart"} (${cat}).`
    );
  }

  if (
    (effective.sessionWindMin != null || personal.funMin != null) &&
    windSpeed < (effective.sessionWindMin ?? personal.funMin ?? 0) - 0.5
  ) {
    const floor = effective.sessionWindMin ?? personal.funMin;
    parts.push(
      `You've only been happy on this size from about ${formatKt(floor)} kt — at ${formatKt(windSpeed)} kt it will likely feel underpowered (chart starts at ${formatKt(catalog.min)} kt).`
    );
  } else if (personal.funMin != null && personal.funMin > catalog.min + 1 && windSpeed < personal.funMin) {
    parts.push(
      `Chart starts at ${formatKt(catalog.min)} kt; you've only enjoyed this kite from about ${formatKt(personal.funMin)} kt.`
    );
  }

  if (
    personal.comfortMax != null &&
    personal.funMin != null &&
    windSpeed >= personal.funMin &&
    windSpeed <= personal.comfortMax &&
    personal.source === "this-kite"
  ) {
    if (confidence === "high") {
      parts.push(
        `Matches your comfortable band on this kite (about ${formatKt(personal.funMin)}-${formatKt(personal.comfortMax)} kt from sessions).`
      );
    } else {
      parts.push(`Within what you've logged as comfortable on this kite.`);
    }
  }

  if (
    personal.pushMax != null &&
    personal.comfortMax != null &&
    windSpeed > personal.comfortMax &&
    windSpeed <= personal.pushMax &&
    personal.source === "this-kite"
  ) {
    parts.push(
      `Above your usual comfortable top (~${formatKt(personal.comfortMax)} kt) but you've ridden this kite near ${formatKt(personal.pushMax)} kt before.`
    );
  } else if (personal.comfortMax != null && windSpeed > personal.comfortMax + 2 && personal.source === "this-kite") {
    parts.push(
      `Above winds where you've been comfortable on this kite (~${formatKt(personal.comfortMax)} kt max in your log). Chart says ${cat}.`
    );
  }

  if (!parts.length && personal.happyCount >= 1 && personal.source === "this-kite") {
    parts.push(
      `Sized using your session history on this kite (${personal.sampleCount} log${personal.sampleCount > 1 ? "s" : ""}); ${cat}.`
    );
  }

  if (character?.label && source !== "size-hint") {
    parts.push(character.label);
  }

  return parts.length ? parts.join(" ") : character?.label || null;
}

function formatKt(n) {
  return String(Math.round(n));
}
