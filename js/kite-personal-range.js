/**
 * Per-kite comfort ranges from logged sessions.
 * Manufacturer charts are the fallback; your history drives picks when you have logs.
 */

/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */
/** @typedef {import('./engine.js').Kite} Kite */

/**
 * @typedef {'none'|'low'|'medium'|'high'} RangeConfidence
 */

/**
 * @typedef {Object} KitePersonalRange
 * @property {number|null} funMin Lowest wind where this kite felt good
 * @property {number|null} comfortMax Highest wind where just-right / comfortable
 * @property {number|null} pushMax Highest wind logged on this kite (too-big but session still OK)
 * @property {number|null} ideal Median of comfortable session winds
 * @property {number} sampleCount Sessions on this kite
 * @property {number} happyCount Comfortable / just-right sessions
 * @property {RangeConfidence} confidence
 */

/**
 * @typedef {Object} EffectiveKiteRange
 * @property {number} min Used for scoring (fun floor)
 * @property {number} ideal
 * @property {number} max Soft top for scoring (comfort or push)
 * @property {{ min: number, ideal: number, max: number }} catalog Manufacturer / estimated
 * @property {KitePersonalRange|null} personal
 * @property {'catalog'|'blend'|'sessions'} source
 * @property {RangeConfidence} confidence
 */

/** @param {CalibrationEntry} entry @param {Kite} kite */
function sessionMatchesKite(entry, kite) {
  if (entry.kiteId && kite.id) return entry.kiteId === kite.id;
  return Math.abs(entry.kiteSize - kite.size) < 0.35;
}

/** @param {Kite} kite @param {CalibrationEntry[]} entries @returns {KitePersonalRange} */
export function getKitePersonalRange(kite, entries) {
  const mine = entries.filter((e) => sessionMatchesKite(e, kite));
  if (!mine.length) {
    return {
      funMin: null,
      comfortMax: null,
      pushMax: null,
      ideal: null,
      sampleCount: 0,
      happyCount: 0,
      confidence: "none",
    };
  }

  const happy = mine.filter((e) => e.feeling === "just-right" || e.feeling === "comfortable");
  const tooSmall = mine.filter((e) => e.feeling === "too-small");
  const tooBig = mine.filter((e) => e.feeling === "too-big");

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
  if (happy.length >= 2 || mine.length >= 4) confidence = "high";
  else if (happy.length >= 1 || mine.length >= 2) confidence = "medium";

  return {
    funMin,
    comfortMax,
    pushMax,
    ideal,
    sampleCount: mine.length,
    happyCount: happy.length,
    confidence,
  };
}

/**
 * Blend catalog range with personal comfort data. Without logs, catalog only (not tightened).
 * @param {Kite} kite
 * @param {{ min: number, ideal: number, max: number }} catalog
 * @param {CalibrationEntry[]} entries
 * @returns {EffectiveKiteRange}
 */
export function getEffectiveKiteRange(kite, catalog, entries) {
  const personal = getKitePersonalRange(kite, entries);

  if (personal.confidence === "none") {
    return {
      min: catalog.min,
      ideal: catalog.ideal,
      max: catalog.max,
      catalog,
      personal: null,
      source: "catalog",
      confidence: "none",
    };
  }

  const blend = personal.confidence === "low" ? 0.35 : personal.confidence === "medium" ? 0.65 : 1;

  const funMin =
    personal.funMin != null
      ? Math.round((catalog.min * (1 - blend) + personal.funMin * blend) * 10) / 10
      : catalog.min;

  const comfortMax =
    personal.comfortMax != null
      ? Math.round((catalog.max * (1 - blend) + personal.comfortMax * blend) * 10) / 10
      : catalog.max;

  const pushMax =
    personal.pushMax != null && blend >= 0.65
      ? personal.pushMax
      : personal.pushMax != null && blend >= 0.35
        ? Math.round((catalog.max + personal.pushMax) / 2)
        : catalog.max;

  const ideal =
    personal.ideal != null
      ? Math.round((catalog.ideal * (1 - blend) + personal.ideal * blend) * 10) / 10
      : catalog.ideal;

  const effectiveMax = Math.max(comfortMax, pushMax);

  return {
    min: funMin,
    ideal,
    max: effectiveMax,
    catalog,
    personal,
    source: blend >= 0.65 ? "sessions" : "blend",
    confidence: personal.confidence,
  };
}

/**
 * @param {number} windSpeed
 * @param {EffectiveKiteRange} effective
 * @returns {{ score: number, band: 'sweet'|'comfort'|'extended'|'light'|'strong' }}
 */
export function scoreWindAgainstEffectiveRange(windSpeed, effective) {
  const { min, ideal, max, catalog, personal } = effective;

  if (personal?.pushMax != null && windSpeed > (personal.comfortMax ?? catalog.max) && windSpeed <= personal.pushMax) {
    const over = windSpeed - (personal.comfortMax ?? catalog.max);
    const span = Math.max(1, personal.pushMax - (personal.comfortMax ?? catalog.max));
    return {
      band: "extended",
      score: Math.round(Math.max(48, 72 - (over / span) * 22)),
    };
  }

  if (windSpeed < min) {
    const distance = min - windSpeed;
    return { band: "light", score: Math.max(0, 42 - distance * 10) };
  }

  if (windSpeed > max) {
    const distance = windSpeed - max;
    return { band: "strong", score: Math.max(0, 38 - distance * 12) };
  }

  const distFromIdeal = Math.abs(windSpeed - ideal);
  return { band: "sweet", score: Math.round(100 - distFromIdeal * 8) };
}

/**
 * @param {number} windSpeed
 * @param {EffectiveKiteRange} effective
 */
export function describeWindVsKiteRange(windSpeed, effective) {
  const { catalog, personal, source, confidence } = effective;
  const parts = [];

  if (source === "catalog" || !personal) {
    return null;
  }

  const cat = `${formatKt(catalog.min)}-${formatKt(catalog.max)} kt (chart)`;

  if (personal.funMin != null && personal.funMin > catalog.min + 1 && windSpeed < personal.funMin) {
    parts.push(
      `Chart starts at ${formatKt(catalog.min)} kt; you've only enjoyed this kite from about ${formatKt(personal.funMin)} kt.`
    );
  }

  if (
    personal.comfortMax != null &&
    windSpeed >= personal.funMin &&
    windSpeed <= personal.comfortMax
  ) {
    if (confidence === "high") {
      parts.push(`Matches your comfortable band on this kite (about ${formatKt(personal.funMin)}-${formatKt(personal.comfortMax)} kt from sessions).`);
    } else {
      parts.push(`Within what you've logged as comfortable on this kite.`);
    }
  }

  if (
    personal.pushMax != null &&
    personal.comfortMax != null &&
    windSpeed > personal.comfortMax &&
    windSpeed <= personal.pushMax
  ) {
    parts.push(
      `Above your usual comfortable top (~${formatKt(personal.comfortMax)} kt) but you've ridden this kite near ${formatKt(personal.pushMax)} kt before. Only if you're happy in those conditions.`
    );
  } else if (personal.comfortMax != null && windSpeed > personal.comfortMax + 2) {
    parts.push(
      `Above winds where you've been comfortable on this kite (~${formatKt(personal.comfortMax)} kt max in your log). Chart says ${cat}.`
    );
  }

  if (!parts.length && personal.happyCount >= 1) {
    parts.push(`Sized using your session history on this kite (${personal.sampleCount} log${personal.sampleCount > 1 ? "s" : ""}); chart ${cat}.`);
  }

  return parts.length ? parts.join(" ") : null;
}

function formatKt(n) {
  return String(Math.round(n));
}
