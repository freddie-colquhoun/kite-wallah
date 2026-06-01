/**
 * Device-only secrets — never uploaded to Supabase crew_state.
 * Optional baked-in key: OPENAI_API_KEY in js/secrets.js (deploy only).
 */

import { OPENAI_API_KEY as CONFIG_OPENAI_KEY, AI_LAYER_DEFAULT } from "./config.js";

const STORAGE_KEY = "kitesurf-advisor-user-secrets";

/** @typedef {'off'|'explain'|'review'} AiLayerMode */

/**
 * @returns {{ openaiApiKey?: string, aiLayerMode?: AiLayerMode }}
 */
function readSecrets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

/** @param {{ openaiApiKey?: string, aiLayerMode?: AiLayerMode }} patch */
function writeSecrets(patch) {
  const next = { ...readSecrets(), ...patch };
  if (!next.openaiApiKey) delete next.openaiApiKey;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** One-time: keep key if it was saved in settings before cloud sync wiped it. */
export function migrateOpenAiKeyFromLegacySettings() {
  const secrets = readSecrets();
  if (secrets.openaiApiKey?.trim()) return;

  try {
    const raw = localStorage.getItem("kitesurf-advisor-settings");
    if (!raw) return;
    const settings = JSON.parse(raw);
    const legacy = settings?.openaiApiKey?.trim();
    if (legacy) writeSecrets({ openaiApiKey: legacy });
  } catch {
    /* ignore */
  }
}

/** @returns {string} */
export function getStoredOpenAiApiKey() {
  const fromConfig =
    typeof CONFIG_OPENAI_KEY === "string" ? CONFIG_OPENAI_KEY.trim() : "";
  if (fromConfig) return fromConfig;

  migrateOpenAiKeyFromLegacySettings();
  return readSecrets().openaiApiKey?.trim() ?? "";
}

/** @param {string} key */
export function setStoredOpenAiApiKey(key) {
  if (isOpenAiKeyFromConfig()) return;
  writeSecrets({ openaiApiKey: key.trim() });
}

/** @returns {AiLayerMode} */
export function getStoredAiLayerMode() {
  const configKey =
    typeof CONFIG_OPENAI_KEY === "string" ? CONFIG_OPENAI_KEY.trim() : "";
  if (
    configKey &&
    (AI_LAYER_DEFAULT === "explain" ||
      AI_LAYER_DEFAULT === "review" ||
      AI_LAYER_DEFAULT === "off")
  ) {
    return AI_LAYER_DEFAULT;
  }

  migrateOpenAiKeyFromLegacySettings();
  const m = readSecrets().aiLayerMode;
  if (m === "explain" || m === "review" || m === "off") return m;
  return getStoredOpenAiApiKey() ? "explain" : "off";
}

/** @param {AiLayerMode} mode */
export function setStoredAiLayerMode(mode) {
  if (isOpenAiKeyFromConfig()) return;
  writeSecrets({
    aiLayerMode: mode === "explain" || mode === "review" ? mode : "off",
  });
}

/** True when key comes from secrets.js on this deploy. */
export function isOpenAiKeyFromConfig() {
  return Boolean(
    typeof CONFIG_OPENAI_KEY === "string" && CONFIG_OPENAI_KEY.trim()
  );
}
