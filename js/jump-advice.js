import { normalizeAbility, getAbilityLabel } from "./ability-levels.js";

/**
 * @param {number} windSpeed
 * @param {number|null} gustSpeed
 * @param {string} waterType
 * @param {string} abilityLevel
 * @param {{ verdict: string, rideable: boolean, score: number }|null} suitability
 */
export function assessJumpability(windSpeed, gustSpeed, waterType, abilityLevel, suitability) {
  const level = normalizeAbility(abilityLevel);
  const label = getAbilityLabel(level);

  if (!suitability?.rideable) {
    return {
      canJump: false,
      verdict: "no",
      explanation: `Conditions aren't suitable for riding at all (${suitability?.verdict ?? "unknown"})  ·  jumping isn't on the table.`,
    };
  }

  const minLevels = {
    newcomer: 99,
    novice: 99,
    intermediate: 14,
    competent: 14,
    jumper: 12,
    advanced: 12,
    expert: 10,
  };

  const idealMin = {
    newcomer: 99,
    novice: 99,
    intermediate: 16,
    competent: 16,
    jumper: 16,
    advanced: 14,
    expert: 14,
  };

  const idealMax = {
    newcomer: 0,
    novice: 0,
    intermediate: 22,
    competent: 24,
    jumper: 26,
    advanced: 28,
    expert: 32,
  };

  if (["newcomer", "novice"].includes(level)) {
    return {
      canJump: false,
      verdict: "no",
      explanation: `At **${label}** level, focus on board control and transitions  ·  jumping comes later. These conditions may still be fine for practising basics.`,
    };
  }

  if (windSpeed < minLevels[level]) {
    return {
      canJump: false,
      verdict: "unlikely",
      explanation: `At **${windSpeed} kt**, there may not be enough power for clean jumps at your level (${label}). You might get small hops in gusts but expect soft landings and limited height.`,
    };
  }

  if (windSpeed > idealMax[level]) {
    return {
      canJump: false,
      verdict: "risky",
      explanation: `At **${windSpeed} kt**, jumping is **risky** for a ${label} rider  ·  overpowered kitings and hard landings. Freeride yes; sent jumps, probably not today.`,
    };
  }

  const inIdeal = windSpeed >= idealMin[level] && windSpeed <= idealMax[level];
  const gustSpread = gustSpeed ? gustSpeed - windSpeed : 0;

  let canJump = inIdeal;
  let verdict = inIdeal ? "yes" : "maybe";
  let explanation = "";

  if (inIdeal) {
    explanation = `**Yes**  ·  ${windSpeed} kt is a solid band for jumping at **${label}** level. Expect good pop if you're on the right kite. `;
    if (waterType === "flat") {
      explanation += "Flat water is ideal for learning height and controlled landings.";
    } else if (waterType === "choppy") {
      explanation += "Choppy water means bump-and-jump potential but watch your landing zone.";
    } else {
      explanation += "In waves, jump when you're clear of the break  ·  timing matters more than height.";
    }
  } else if (windSpeed >= minLevels[level]) {
    explanation = `**Maybe**  ·  ${windSpeed} kt is on the lighter side for confident jumps. Small hops and practise pop are realistic; don't expect big air.`;
    canJump = level === "intermediate" ? false : true;
    verdict = level === "intermediate" ? "unlikely" : "maybe";
  }

  if (gustSpread >= 8) {
    explanation += ` Gust spread of ${gustSpread} kt makes timing jumps harder  ·  wait for lulls or size down.`;
    if (verdict === "yes") verdict = "maybe";
  }

  if (level === "intermediate" && windSpeed >= 16) {
    explanation += " As an intermediate rider, stick to controlled small jumps rather than sending it.";
    canJump = true;
    verdict = "maybe";
  }

  return { canJump, verdict, explanation };
}
