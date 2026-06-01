/**
 * v2 sandboxed AI layer — narrates DecisionBundle only; never invents wind or kites.
 */

import { chatCompletion } from "./ai-client.js";
import { getAiLayerMode } from "./ai-settings.js";

const AI_TIMEOUT_MS = 14_000;

/** @typedef {'off'|'explain'|'review'} AiLayerMode */

/**
 * @typedef {Object} AiLayerResult
 * @property {string} narrative
 * @property {string[]} warnings
 * @property {AiLayerMode} mode
 * @property {boolean} fromAi
 */

/**
 * @param {Promise<string>} promise
 * @param {number} ms
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI request timed out")), ms)
    ),
  ]);
}

/**
 * @param {object} bundle
 * @param {AiLayerMode} mode
 */
function buildExplainSystemPrompt(bundle, mode) {
  const reviewExtra =
    mode === "review"
      ? `
Also return JSON with:
- "warnings": string[] — inconsistencies ONLY (e.g. day verdict GO but rider unassigned, fly kite score very low, narrative contradicts log). Max 4 short bullets. Do NOT suggest different kite IDs or sizes.
- "consistencyOk": boolean — true if picks align with wind and logs.

You MUST NOT change flyKiteId, verdict, or scores. Advisory warnings only.`
      : `
Return JSON: { "narrative": "..." , "warnings": [], "consistencyOk": true }`;

  return `You are Kite Wallah v2. The app already computed kites and GO/Maybe using rules. Your job is natural-language explanation ONLY.

Rules:
- Use ONLY facts from the decision bundle JSON. Never invent wind speeds, kite names, or verdicts not in the bundle.
- Wind in knots. Plain, direct UK English. No "crew" wording — say "you" or rider names.
- 2–3 short paragraphs for narrative: rideable window, who flies what and why, gust/tide cautions, link to logNote when present.
- Do not mention suitability scores or percentages.
- If isCrewDay, explain fair split (heaviest picks first) when Ideal ≠ Fly.
${reviewExtra}

Allowed kite IDs (do not recommend others): ${JSON.stringify(bundle.allowedKiteIds ?? [])}

Decision bundle:
${JSON.stringify(bundle)}`;
}

/**
 * @param {string} raw
 * @returns {AiLayerResult|null}
 */
function parseAiLayerJson(raw) {
  const trimmed = raw.trim();
  let parsed;
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
  } catch {
    return {
      narrative: trimmed,
      warnings: [],
      mode: getAiLayerMode(),
      fromAi: true,
    };
  }

  const narrative =
    typeof parsed.narrative === "string"
      ? parsed.narrative.trim()
      : typeof parsed.summary === "string"
        ? parsed.summary.trim()
        : "";
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w) => typeof w === "string").slice(0, 6)
    : [];

  if (!narrative) return null;

  return {
    narrative,
    warnings,
    mode: getAiLayerMode(),
    fromAi: true,
  };
}

/**
 * @param {object} bundle
 * @returns {Promise<AiLayerResult|null>}
 */
export async function runAiLayer(bundle) {
  const mode = getAiLayerMode();
  if (mode === "off") return null;

  const messages = [
    {
      role: "system",
      content: buildExplainSystemPrompt(bundle, mode),
    },
    {
      role: "user",
      content:
        "Write the JSON response for this session. narrative = what to expect on the water in friendly prose.",
    },
  ];

  try {
    const raw = await withTimeout(chatCompletion(messages, { temperature: 0.35 }), AI_TIMEOUT_MS);
    return parseAiLayerJson(raw);
  } catch (err) {
    if (err.message === "NO_API_KEY") return null;
    throw err;
  }
}

/** Limits copy for UI. */
export const AI_V2_LIMITS = [
  "Kite choice, GO/Maybe, and allocation stay rule-based — AI does not change them.",
  "AI only reads the decision bundle (forecast + scores + picks) and writes prose.",
  "Review mode adds consistency warnings only — no automatic re-picks.",
  "Requires your OpenAI key in Options; runs once per card after Plan/Now loads.",
  "On failure or timeout, you still see the normal rules-based card.",
];
