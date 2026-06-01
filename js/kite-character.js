/**
 * Brand/model character from catalog type + style — same size ≠ same feel.
 */

/** @typedef {import('./engine.js').Kite} Kite */

/**
 * @typedef {Object} KiteCharacter
 * @property {number} powerBiasKt Positive = pulls harder / wants more wind for comfort
 * @property {number} gustSensitivity 0–1 extra penalty in gusty conditions
 * @property {string} label Short rider-facing trait
 * @property {string} [styleKey]
 */

/** @param {Kite} kite */
export function getKiteCharacter(kite) {
  const style = (kite.style || "").toLowerCase();
  const type = kite.type || "hybrid";
  const model = (kite.model || "").toLowerCase();

  /** @type {KiteCharacter} */
  const base = { powerBiasKt: 0, gustSensitivity: 0, label: "all-round", styleKey: "freeride" };

  if (style.includes("freestyle") || style.includes("wakestyle") || style.includes("park")) {
    Object.assign(base, {
      powerBiasKt: 1.5,
      gustSensitivity: 0.55,
      label: "freestyle / responsive — wants steady power",
      styleKey: "freestyle",
    });
  } else if (style.includes("wave") || style.includes("strapless")) {
    Object.assign(base, {
      powerBiasKt: -1,
      gustSensitivity: 0.2,
      label: "wave / drifty — lighter bar pressure",
      styleKey: "wave",
    });
  } else if (style.includes("big air") || style.includes("big-air")) {
    Object.assign(base, {
      powerBiasKt: 1.2,
      gustSensitivity: 0.65,
      label: "big-air — strong pull, less forgiving in gusts",
      styleKey: "big-air",
    });
  } else if (style.includes("freeride")) {
    Object.assign(base, {
      powerBiasKt: 0.2,
      gustSensitivity: 0.35,
      label: "freeride — balanced",
      styleKey: "freeride",
    });
  } else if (style.includes("all-round")) {
    Object.assign(base, {
      powerBiasKt: 0,
      gustSensitivity: 0.3,
      label: "all-round — forgiving",
      styleKey: "all-round",
    });
  }

  if (type === "c") {
    base.powerBiasKt += 1;
    base.gustSensitivity = Math.min(1, base.gustSensitivity + 0.25);
    if (!style.includes("freestyle")) {
      base.label = "C-kite — direct power, less depower";
    }
  } else if (type === "bow") {
    base.powerBiasKt -= 0.5;
    base.gustSensitivity = Math.max(0, base.gustSensitivity - 0.1);
  } else if (type === "foil") {
    base.powerBiasKt -= 1.5;
    base.label = "foil kite — light wind specialist";
  }

  if (model.includes("orbit") || model.includes("rebel")) {
    base.powerBiasKt = Math.max(base.powerBiasKt, 1);
    base.gustSensitivity = Math.max(base.gustSensitivity, 0.6);
    base.label = "big-air oriented — more pull than a mellow freeride at this size";
  } else if (model.includes("evo") || model.includes("reach")) {
    base.powerBiasKt = Math.min(base.powerBiasKt, 0.5);
    base.label = "freeride oriented — mellower than a big-air kite at this size";
  } else if (model.includes("dice") || model.includes("pulse")) {
    base.powerBiasKt = Math.max(base.powerBiasKt, 1.2);
    base.label = "freestyle oriented — snappy, wants solid wind";
  }

  return base;
}

/**
 * Shift manufacturer range for how this model actually feels.
 * @param {{ min: number, ideal: number, max: number }} catalog
 * @param {KiteCharacter} character
 */
export function adjustCatalogForCharacter(catalog, character) {
  const b = character.powerBiasKt;
  return {
    min: Math.round((catalog.min + b * 0.5) * 10) / 10,
    ideal: Math.round((catalog.ideal + b) * 10) / 10,
    max: Math.round((catalog.max + b * 0.35) * 10) / 10,
  };
}

/**
 * Score tweak at this wind (after range score).
 * @param {number} windSpeed
 * @param {number|null} gustSpeed
 * @param {KiteCharacter} character
 */
export function kiteCharacterScoreAdjust(windSpeed, gustSpeed, character) {
  let adjust = 0;
  const spread =
    gustSpeed != null && gustSpeed > windSpeed ? gustSpeed - windSpeed : 0;

  if (spread >= 8) {
    adjust -= Math.round(character.gustSensitivity * spread * 1.2);
  }

  return adjust;
}

/**
 * When two quiver kites are the same size, explain chart/character difference.
 * @param {Kite} a
 * @param {Kite} b
 */
export function compareSameSizeKitesNote(a, b) {
  if (Math.abs(a.size - b.size) > 0.25) return null;
  const ca = getKiteCharacter(a);
  const cb = getKiteCharacter(b);
  const diff = ca.powerBiasKt - cb.powerBiasKt;
  if (Math.abs(diff) < 0.6) return null;

  const nameA = a.name || `${a.brand || ""} ${a.size}m`.trim();
  const nameB = b.name || `${b.brand || ""} ${b.size}m`.trim();
  if (diff > 0) {
    return `At ${a.size}m, ${nameA} is typically more aggressive / powered than ${nameB} (${ca.label} vs ${cb.label}) — compare charts, not just size.`;
  }
  return `At ${a.size}m, ${nameB} is typically more aggressive / powered than ${nameA} (${cb.label} vs ${ca.label}) — compare charts, not just size.`;
}
