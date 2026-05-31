/**
 * Copy this file to config.js and fill in your Supabase project details.
 * config.js is gitignored so secrets stay off GitHub.
 */
export const CLOUD_CONFIG = {
  /** Set true after Supabase is set up (see DEPLOY.md). */
  enabled: false,
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_PUBLIC_KEY",
  /** Shared crew login — create this user in Supabase Auth (see DEPLOY.md). */
  crewEmail: "crew@kite-wallah.local",
};
