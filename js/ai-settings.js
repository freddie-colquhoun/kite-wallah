/**
 * v2 AI layer mode — stored in app settings (browser-local).
 */

import { loadSettings, saveSettings } from "./spots-storage.js";
import { getOpenAiApiKey } from "./ai-client.js";

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
  const m = loadSettings().aiLayerMode;
  if (m === "explain" || m === "review") return m;
  return "off";
}

/** @param {AiLayerMode} mode */
export function setAiLayerMode(mode) {
  const s = loadSettings();
  s.aiLayerMode = mode === "explain" || mode === "review" ? mode : "off";
  saveSettings(s);
}

/** @returns {boolean} */
export function isAiLayerEnabled() {
  return getAiLayerMode() !== "off" && Boolean(getOpenAiApiKey());
}
