/**
 * Wind/gust wording shared by Plan and Now (avoids calling 18 kt "light" when gusts are huge).
 * @param {number|null|undefined} gustSpeed
 * @param {number} windSpeed
 */
export function gustSpread(windSpeed, gustSpeed) {
  if (gustSpeed == null || gustSpeed <= windSpeed) return 0;
  return gustSpeed - windSpeed;
}

/**
 * @typedef {'steady'|'light'|'strong'|'gusty'|'very-gusty'|'too-light'} WindCharacterKind
 */

/**
 * @param {number} windSpeed
 * @param {number|null|undefined} gustSpeed
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} limits
 * @returns {{ kind: WindCharacterKind, spread: number, summary: string }}
 */
export function classifyWindSession(windSpeed, gustSpeed, limits) {
  const spread = gustSpread(windSpeed, gustSpeed);
  const gustPart =
    gustSpeed != null && gustSpeed > windSpeed
      ? `, gusts to ${gustSpeed} kt (+${spread} kt)`
      : "";

  if (windSpeed < 10) {
    return {
      kind: "too-light",
      spread,
      summary: `${windSpeed} kt${gustPart}  ·  too light for most sessions.`,
    };
  }

  if (spread > limits.maxGustSpread * 1.25) {
    return {
      kind: "very-gusty",
      spread,
      summary: `${windSpeed} kt average${gustPart}  ·  very gusty; rig smaller than you would for steady ${windSpeed} kt and expect hard hits in the lulls.`,
    };
  }

  if (spread > limits.maxGustSpread * 0.75) {
    return {
      kind: "gusty",
      spread,
      summary: `${windSpeed} kt average${gustPart}  ·  gusty; size down and stay ready for power spikes.`,
    };
  }

  if (windSpeed < limits.minWind) {
    return {
      kind: "too-light",
      spread,
      summary: `${windSpeed} kt${gustPart}  ·  below your usual band (~${limits.minWind}+ kt).`,
    };
  }

  if (windSpeed < limits.minWind + 2) {
    return {
      kind: "light",
      spread,
      summary: `${windSpeed} kt${gustPart}  ·  workable but on the light side; may need your bigger kite.`,
    };
  }

  if (windSpeed > limits.maxWind) {
    return {
      kind: "strong",
      spread,
      summary: `${windSpeed} kt${gustPart}  ·  above your comfortable band (~${limits.maxWind} kt max).`,
    };
  }

  return {
    kind: "steady",
    spread,
    summary: `${windSpeed} kt${gustPart}  ·  solid powered wind for your level.`,
  };
}

/** @param {string[]} notes */
export function stripMisleadingLightNotes(notes) {
  return notes.filter(
    (n) =>
      !/light.wind session|light end of your band|underpowered at first|feels underpowered/i.test(
        n
      )
  );
}

/**
 * Dominant wind character across plan hours.
 * @param {Array<{ windSpeed: number, gustSpeed?: number|null, rideable?: boolean, tideAccessOk?: boolean }>} hours
 * @param {{ minWind: number, maxWind: number, maxGustSpread: number }} limits
 */
export function classifyDayFromHours(hours, limits) {
  const pool = hours.filter((h) => h.rideable !== false && h.tideAccessOk !== false);
  if (!pool.length) {
    return classifyWindSession(
      hours[0]?.windSpeed ?? 0,
      hours[0]?.gustSpeed,
      limits
    );
  }

  let maxSpread = 0;
  let repWind = pool[0].windSpeed;
  let repGust = pool[0].gustSpeed ?? null;

  for (const h of pool) {
    const s = gustSpread(h.windSpeed, h.gustSpeed);
    if (s >= maxSpread) {
      maxSpread = s;
      repWind = h.windSpeed;
      repGust = h.gustSpeed ?? null;
    } else if (s === maxSpread && h.windSpeed >= repWind) {
      repWind = h.windSpeed;
      repGust = h.gustSpeed ?? null;
    }
  }

  return classifyWindSession(repWind, repGust, limits);
}
