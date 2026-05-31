import {
  ABILITY_LEVELS,
  getAbilityDef,
  getSkillLimits,
  normalizeAbility,
} from "./ability-levels.js";

/** @typedef {import('./ability-levels.js').AbilityLevel} AbilityLevel */

/**
 * Progressive skills  ·  tick what you can do. Wind bands follow your highest skill
 * (small steps within a band barely change go/no-go).
 * @typedef {Object} RiderSkillDef
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {AbilityLevel} tier
 */

/** @type {RiderSkillDef[]} */
export const RIDER_SKILLS = [
  {
    id: "kite-control",
    label: "Kite control on land / in water",
    hint: "Relaunch, steering, safety",
    tier: "newcomer",
  },
  {
    id: "body-drag",
    label: "Body drag upwind / downwind",
    hint: "Recover board, control drift",
    tier: "newcomer",
  },
  {
    id: "water-start",
    label: "Water start consistently",
    hint: "Get on the board in moderate wind",
    tier: "novice",
  },
  {
    id: "ride-downwind",
    label: "Ride downwind with control",
    hint: "Speed, stopping, basic edging",
    tier: "novice",
  },
  {
    id: "transitions",
    label: "Heel-to-toe / toe-to-heel transitions",
    hint: "Ride both ways without stopping",
    tier: "intermediate",
  },
  {
    id: "upwind",
    label: "Ride upwind reliably",
    hint: "Return to launch  ·  game changer for sessions",
    tier: "competent",
  },
  {
    id: "jump-basic",
    label: "Controlled jumps (~1 m)",
    hint: "Pop, landing, basic air time",
    tier: "jumper",
  },
  {
    id: "jump-advanced",
    label: "Bigger air / grabs / simple rotations",
    hint: "Confident in stronger wind",
    tier: "advanced",
  },
  {
    id: "tricks-hooked",
    label: "Hooked tricks / kite loops",
    hint: "Powered manoeuvres in control",
    tier: "advanced",
  },
  {
    id: "unhooked",
    label: "Unhooked / overpowered riding",
    hint: "Expert-level kit handling",
    tier: "expert",
  },
];

const TIER_ORDER = /** @type {AbilityLevel[]} */ ([
  "newcomer",
  "novice",
  "intermediate",
  "competent",
  "jumper",
  "advanced",
  "expert",
]);

const SKILL_BY_ID = Object.fromEntries(RIDER_SKILLS.map((s) => [s.id, s]));

/** @param {AbilityLevel} ability */
export function defaultSkillsForAbility(ability) {
  const level = normalizeAbility(ability);
  const tierIdx = TIER_ORDER.indexOf(level);
  return RIDER_SKILLS.filter((s) => TIER_ORDER.indexOf(s.tier) <= tierIdx).map((s) => s.id);
}

/**
 * @param {string[]|undefined} skills
 * @param {string|undefined} [legacyAbility]
 */
export function normalizeProfileSkills(skills, legacyAbility) {
  const valid = new Set(RIDER_SKILLS.map((s) => s.id));
  if (Array.isArray(skills) && skills.length) {
    return [...new Set(skills.filter((id) => valid.has(id)))];
  }
  if (legacyAbility) return defaultSkillsForAbility(legacyAbility);
  return defaultSkillsForAbility("competent");
}

/** @param {string[]} skillIds */
export function skillsToAbilityLevel(skillIds) {
  let maxIdx = 0;
  for (const id of skillIds) {
    const def = SKILL_BY_ID[id];
    if (!def) continue;
    const idx = TIER_ORDER.indexOf(def.tier);
    if (idx > maxIdx) maxIdx = idx;
  }
  return TIER_ORDER[maxIdx] || "competent";
}

/** @param {{ skills?: string[], ability?: string }} profile */
export function getProfileSkillLimits(profile) {
  return getSkillLimits(normalizeAbility(profile.ability));
}

/** @param {{ skills?: string[], ability?: string }} profile */
export function getProfileAbilityLevel(profile) {
  return skillsToAbilityLevel(normalizeProfileSkills(profile.skills, profile.ability));
}

/** @param {{ skills?: string[], ability?: string }} profile */
export function getSkillsSummaryLabel(profile) {
  return getAbilityDef(getProfileAbilityLevel(profile)).label;
}

/**
 * @param {string[]} current
 * @param {string[]} learned
 */
export function mergeLearnedSkills(current, learned) {
  const valid = new Set(RIDER_SKILLS.map((s) => s.id));
  return [...new Set([...current, ...learned.filter((id) => valid.has(id))])];
}

/** @param {string[]} skillIds */
export function syncProfileAbilityFromSkills(skillIds) {
  return skillsToAbilityLevel(skillIds);
}

/**
 * @param {string[]} profileSkills
 * @param {{ prefix?: string, readonly?: boolean }} [opts]
 */
export function renderSkillsChecklistHtml(profileSkills, opts = {}) {
  const prefix = opts.prefix || "skill";
  const readonly = opts.readonly === true;
  const have = new Set(profileSkills);
  return `<ul class="skills-checklist" role="list">
    ${RIDER_SKILLS.map((s, i) => {
      const checked = have.has(s.id);
      const disabled = readonly ? " disabled" : "";
      const checkedAttr = checked ? " checked" : "";
      return `<li class="skills-checklist-item ${checked ? "is-checked" : ""}">
        <label class="skills-check-label">
          <input type="checkbox" name="${prefix}" value="${s.id}" data-skill-id="${s.id}"${checkedAttr}${disabled} />
          <span class="skills-check-text">
            <span class="skills-check-title">${i + 1}. ${s.label}</span>
            <span class="skills-check-hint">${s.hint}</span>
          </span>
        </label>
      </li>`;
    }).join("")}
  </ul>`;
}

/**
 * Skills not yet on profile  ·  for session "learned today" prompt.
 * @param {string[]} profileSkills
 */
export function renderNewSkillsPromptHtml(profileSkills) {
  const have = new Set(profileSkills);
  const missing = RIDER_SKILLS.filter((s) => !have.has(s.id));
  if (!missing.length) {
    return `<p class="hint hint-tight">You've ticked all skills in the list  ·  nice!</p>`;
  }
  return `
    <p class="hint hint-tight">Tick anything you learnt or felt solid on today (updates your rider profile).</p>
    <ul class="skills-checklist skills-checklist--session" role="list">
      ${missing
        .map(
          (s) => `
        <li class="skills-checklist-item">
          <label class="skills-check-label">
            <input type="checkbox" name="session-new-skill" value="${s.id}" data-skill-id="${s.id}" />
            <span class="skills-check-text">
              <span class="skills-check-title">${s.label}</span>
            </span>
          </label>
        </li>`
        )
        .join("")}
    </ul>`;
}

/** @param {string[]} skillIds */
export function renderSkillsWindBandHtml(skillIds) {
  const level = skillsToAbilityLevel(skillIds);
  const def = getAbilityDef(level);
  const limits = getSkillLimits(level);
  return `<p class="skills-wind-band"><strong>Wind band for recommendations:</strong> ~${limits.minWind}-${limits.maxWind} kt (${def.label}). Once you can ride upwind, most sessions use a similar band  ·  big changes need major skills or logged sessions.</p>`;
}

/** @param {HTMLElement} root */
export function readSkillsFromChecklist(root) {
  return [...root.querySelectorAll('input[type="checkbox"][data-skill-id]:checked')].map(
    (el) => /** @type {HTMLInputElement} */ (el).value
  );
}
