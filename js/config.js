/**
 * Cloud sync settings. Edit after creating Supabase (see DEPLOY.md).
 * The anon key is safe to commit — crew data is protected by login + RLS.
 */
export const CLOUD_CONFIG = {
  enabled: false,
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_PUBLIC_KEY",
  crewEmail: "crew@kite-wallah.local",
};
