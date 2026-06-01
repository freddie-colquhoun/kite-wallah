/**
 * OpenAI key and AI mode come from js/secrets.js (shipped with the site).
 * Not stored in Options or crew cloud sync.
 */

import { OPENAI_API_KEY, AI_LAYER_DEFAULT } from "./config.js";

/** @typedef {'off'|'explain'|'review'} AiLayerMode */

/** @returns {string} */
export function getStoredOpenAiApiKey() {
  return typeof OPENAI_API_KEY === "string" ? OPENAI_API_KEY.trim() : "";
}

/** @returns {AiLayerMode} */
export function getStoredAiLayerMode() {
  if (
    AI_LAYER_DEFAULT === "explain" ||
    AI_LAYER_DEFAULT === "review" ||
    AI_LAYER_DEFAULT === "off"
  ) {
    return AI_LAYER_DEFAULT;
  }
  return getStoredOpenAiApiKey() ? "explain" : "off";
}

/** @param {AiLayerMode} _mode */
export function setStoredAiLayerMode(_mode) {
  /* Mode is fixed in secrets.js — change there and redeploy. */
}

/** @param {string} _key */
export function setStoredOpenAiApiKey(_key) {
  /* Key is fixed in secrets.js — change there and redeploy. */
}

export function isOpenAiKeyFromConfig() {
  return Boolean(getStoredOpenAiApiKey());
}

export function migrateOpenAiKeyFromLegacySettings() {}
