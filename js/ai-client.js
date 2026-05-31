import { loadSettings, saveSettings } from "./spots-storage.js";

const SETTINGS_OPENAI_KEY = "openaiApiKey";

export function getOpenAiApiKey() {
  const s = loadSettings();
  return s.openaiApiKey?.trim() || "";
}

/** @param {string} key */
export function setOpenAiApiKey(key) {
  const s = loadSettings();
  s.openaiApiKey = key.trim();
  saveSettings(s);
}

/**
 * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} messages
 * @returns {Promise<string>}
 */
export async function chatCompletion(messages) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 600,
      temperature: 0.6,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `AI request failed (${res.status})`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

/**
 * @param {object} planContext
 * @param {string} question
 */
export function buildPlanSystemPrompt(planContext) {
  return `You are Kite Wallah, a kitesurf planning assistant. Answer briefly and practically (2-4 short paragraphs max). Use the rider's past sessions when provided. Never call gusty overpowered days "light wind". Wind speeds are in knots.

Plan context (JSON):
${JSON.stringify(planContext, null, 0)}`;
}

export { SETTINGS_OPENAI_KEY };
