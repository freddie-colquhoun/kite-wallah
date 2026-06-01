/**
 * Copy this file to config.js and fill in your Supabase project details.
 * config.js is gitignored so secrets stay off GitHub.
 */
export const CLOUD_CONFIG = {
  /** Set true after Supabase is set up (see DEPLOY.md). */
  enabled: false,
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_PUBLIC_KEY",
};

/**
 * Optional — if set, the app never asks for a key in Options (key is in your deployed JS).
 * Only use on a private deploy; anyone who can open the site can extract it from DevTools.
 */
export const OPENAI_API_KEY = "";

/** When OPENAI_API_KEY is set: "off" | "explain" | "review" */
export const AI_LAYER_DEFAULT = "explain";
