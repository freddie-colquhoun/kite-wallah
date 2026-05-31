/** @typedef {'newcomer'|'novice'|'intermediate'|'competent'|'jumper'|'advanced'|'expert'} AbilityLevel */

/**
 * @typedef {Object} AbilityDefinition
 * @property {string} label
 * @property {string} cue
 * @property {string[]} examples
 * @property {number} minWind
 * @property {number} maxWind
 * @property {number} maxGustSpread
 */

/** @type {Record<AbilityLevel, AbilityDefinition>} */
export const ABILITY_LEVELS = {
  newcomer: {
    label: "Newcomer",
    cue: "First sessions on the water",
    examples: [
      "Body dragging and kite control on land",
      "First attempts at water starts",
      "Needs flat, shallow water and light crowds",
    ],
    minWind: 16,
    maxWind: 20,
    maxGustSpread: 5,
  },
  novice: {
    label: "Novice",
    cue: "Riding downwind, building board control",
    examples: [
      "Can ride downwind and stop safely",
      "Working on edge control and speed",
      "Not yet consistent with transitions",
    ],
    minWind: 15,
    maxWind: 22,
    maxGustSpread: 6,
  },
  intermediate: {
    label: "Intermediate",
    cue: "Just learnt to transition",
    examples: [
      "Heel-to-toe and toe-to-heel transitions",
      "Starting to ride upwind on one tack",
      "Small hops or learning to jump",
    ],
    minWind: 14,
    maxWind: 24,
    maxGustSpread: 8,
  },
  competent: {
    label: "Competent",
    cue: "Consistent upwind riding",
    examples: [
      "Rides confidently in both directions",
      "Can return to launch point reliably",
      "Comfortable in choppy water",
    ],
    minWind: 12,
    maxWind: 26,
    maxGustSpread: 9,
  },
  jumper: {
    label: "Jumper",
    cue: "Jumping ~1 m, basic air tricks",
    examples: [
      "Controlled jumps around 1 m height",
      "Basic grabs and simple rotations",
      "Comfortable edging hard for pop",
    ],
    minWind: 12,
    maxWind: 28,
    maxGustSpread: 10,
  },
  advanced: {
    label: "Advanced",
    cue: "Hooked tricks and kite loops",
    examples: [
      "Back rolls, front rolls, raleys",
      "Hooked kite loops in control",
      "Riding comfortably in strong wind",
    ],
    minWind: 11,
    maxWind: 32,
    maxGustSpread: 12,
  },
  expert: {
    label: "Expert",
    cue: "Unhooked, powered riding, all conditions",
    examples: [
      "Unhooked tricks and handle passes",
      "Riding overpowered safely",
      "Big air, waves, and light-wind foiling",
    ],
    minWind: 10,
    maxWind: 40,
    maxGustSpread: 15,
  },
};

/** Map legacy profile values to new levels */
const LEGACY_MAP = {
  beginner: "novice",
  intermediate: "competent",
  advanced: "advanced",
};

/** @param {string} ability */
export function normalizeAbility(ability) {
  if (ability in ABILITY_LEVELS) return /** @type {AbilityLevel} */ (ability);
  if (ability in LEGACY_MAP) return /** @type {AbilityLevel} */ (LEGACY_MAP[ability]);
  return "competent";
}

/** @param {AbilityLevel} level */
export function getAbilityDef(level) {
  return ABILITY_LEVELS[normalizeAbility(level)];
}

/** @param {AbilityLevel} level */
export function getAbilityLabel(level) {
  return getAbilityDef(level).label;
}

export function getAbilityOptionsHtml(selected) {
  const norm = normalizeAbility(selected);
  return Object.entries(ABILITY_LEVELS)
    .map(([value, def]) => {
      const sel = value === norm ? " selected" : "";
      return `<option value="${value}"${sel}>${def.label}  ·  ${def.cue}</option>`;
    })
    .join("");
}

export function renderAbilityGuide(level) {
  const def = getAbilityDef(level);
  return `
    <div class="ability-guide" id="ability-guide">
      <p class="ability-guide-cue"><strong>${def.label}:</strong> ${def.cue}</p>
      <ul class="ability-guide-list">
        ${def.examples.map((e) => `<li>${e}</li>`).join("")}
      </ul>
      <p class="ability-guide-limits">
        Comfortable wind band for your level: ~${def.minWind}-${def.maxWind} kt
      </p>
    </div>`;
}

export function getSkillLimits(level) {
  const def = getAbilityDef(level);
  return {
    minWind: def.minWind,
    maxWind: def.maxWind,
    maxGustSpread: def.maxGustSpread,
  };
}
