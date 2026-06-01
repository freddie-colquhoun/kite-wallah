import { getSkillLimits, normalizeAbility } from "./ability-levels.js";

/** @typedef {import('./storage.js').RiderProfile} RiderProfile */

/** Wind limits for Plan from profile ability (legacy skills checklist removed). */
export function getProfileSkillLimits(profile) {
  return getSkillLimits(normalizeAbility(profile.ability));
}
