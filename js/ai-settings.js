/**
 * v2 AI layer mode — stored in app settings (browser-local).
 */

import { getOpenAiApiKey, isOpenAiKeyFromConfig } from "./ai-client.js";
import { getStoredAiLayerMode, setStoredAiLayerMode } from "./user-secrets.js";

/** Park AI UI and API calls — set false to re-enable Plan/Now v2 + chat. */
export const AI_FEATURES_PARKED = true;

export function shouldShowAiFeatures() {
  return !AI_FEATURES_PARKED;
}

export { isOpenAiKeyFromConfig };

/** @typedef {'off'|'explain'|'review'} AiLayerMode */

export const AI_LAYER_MODES = /** @type {const} */ ({
  off: "off",
  explain: "explain",
  review: "review",
});

/** @type {Record<AiLayerMode, string>} */
export const AI_LAYER_MODE_LABELS = {
  off: "Off — rules only",
  explain: "Explain — natural language on picks",
  review: "Review — explain + consistency check",
};

/** @returns {AiLayerMode} */
export function getAiLayerMode() {
  return getStoredAiLayerMode();
}

/** @param {AiLayerMode} mode */
export function setAiLayerMode(mode) {
  setStoredAiLayerMode(mode);
}

/** @returns {boolean} */
export function isAiLayerEnabled() {
  if (AI_FEATURES_PARKED) return false;
  return getAiLayerMode() !== "off" && Boolean(getOpenAiApiKey());
}
