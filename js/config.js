/**
 * Cloud sync — publishable Supabase anon key is OK here.
 * OpenAI key lives in secrets.js (bundled with deploy — not entered in the app UI).
 */
export const CLOUD_CONFIG = {
  enabled: true,
  supabaseUrl: "https://dnpthipfdyzvpwvabqih.supabase.co",
  supabaseAnonKey: "sb_publishable_5SquX_wuLX7Lwa1uGOgolg_Yj7-GcXe",
};

export { OPENAI_API_KEY, AI_LAYER_DEFAULT } from "./secrets.js";
