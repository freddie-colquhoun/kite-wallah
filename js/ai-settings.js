/**
 * v2 AI layer mode — stored in app settings (browser-local).
 */

import { getOpenAiApiKey, isOpenAiKeyFromConfig } from "./ai-client.js";
import { getStoredAiLayerMode, setStoredAiLayerMode } from "./user-secrets.js";

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
  return getAiLayerMode() !== "off" && Boolean(getOpenAiApiKey());
}
