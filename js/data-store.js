/**
 * Shared data: Supabase when configured (public read/write, no sign-in), else localStorage.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { CLOUD_CONFIG } from "./config.js";
import { readLocalState, loadState, installState, stripPhotosFromState } from "./storage.js";
import { readLocalSpots, readLocalSettings, installSpots, installSettings } from "./spots-storage.js";

const CREW_ROW_ID = "crew";
const PERSIST_DEBOUNCE_MS = 700;

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let supabase = null;

/** @type {{ enabled: boolean, supabaseUrl: string, supabaseAnonKey: string }|null} */
let cloudConfig = null;

/** @type {'local'|'cloud'} */
let mode = "local";

let persistTimer = null;
let remoteVersion = 0;

/** @returns {Promise<typeof cloudConfig>} */
export async function getCloudConfig() {
  if (cloudConfig !== null) return cloudConfig;
  const c = CLOUD_CONFIG;
  const urlOk =
    c?.supabaseUrl &&
    !c.supabaseUrl.includes("YOUR_PROJECT") &&
    c.supabaseUrl.startsWith("https://");
  const keyOk = c?.supabaseAnonKey && !c.supabaseAnonKey.includes("YOUR_ANON");
  if (c?.enabled && urlOk && keyOk) {
    cloudConfig = c;
    return c;
  }
  cloudConfig = null;
  return null;
}

export function getDataMode() {
  return mode;
}

/**
 * @returns {Promise<{ ok: boolean, state?: import('./storage.js').AppState }>}
 */
export async function bootstrapData() {
  const config = await getCloudConfig();
  const localState = readLocalState();
  const localSpots = readLocalSpots();
  const localSettings = readLocalSettings();

  if (!config) {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    mode = "local";
    window.__schedulePersist = schedulePersist;
    setSyncStatus("Saved on this device only");
    return { ok: true, state: loadState() };
  }

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  mode = "cloud";

  const remote = await fetchRemoteSnapshot();
  if (remote?.payload && hasPayloadData(remote.payload)) {
    applySnapshot(remote.payload);
    remoteVersion = remote.updatedAtMs;
    setSyncStatus("Shared data (everyone)");
  } else if (hasLocalData(localState, localSpots)) {
    applySnapshot({
      version: 1,
      state: stripPhotosFromState(localState),
      spots: localSpots,
      settings: localSettings,
    });
    await pushSnapshotNow();
    setSyncStatus("Uploaded local data to shared storage");
  } else {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    await pushSnapshotNow();
    setSyncStatus("Shared data (everyone)");
  }

  window.__schedulePersist = schedulePersist;
  subscribeRemoteChanges();
  return { ok: true, state: loadState() };
}

function hasPayloadData(/** @type {object} */ payload) {
  const st = payload.state;
  const spots = payload.spots;
  return (
    st?.profiles?.length > 0 ||
    st?.quiver?.kites?.length > 0 ||
    (Array.isArray(spots) && spots.length > 0)
  );
}

function hasLocalData(/** @type {import('./storage.js').AppState} */ state, /** @type {unknown[]} */ spots) {
  return state.profiles?.length > 0 || spots.length > 0;
}

/** @param {object} payload */
function applySnapshot(payload) {
  if (payload.state) installState(stripPhotosFromState(payload.state));
  if (Array.isArray(payload.spots)) installSpots(payload.spots);
  if (payload.settings) installSettings(payload.settings);
}

function buildSnapshot() {
  return {
    version: 1,
    state: stripPhotosFromState(readLocalState()),
    spots: readLocalSpots(),
    settings: readLocalSettings(),
  };
}

/** @returns {Promise<{ payload: object, updatedAtMs: number }|null>} */
async function fetchRemoteSnapshot() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("crew_state")
    .select("payload, updated_at")
    .eq("id", CREW_ROW_ID)
    .maybeSingle();
  if (error) {
    console.warn("crew_state fetch", error);
    setSyncStatus("Could not load shared data — check Supabase policies");
    return null;
  }
  if (!data) return null;
  return {
    payload: data.payload,
    updatedAtMs: data.updated_at ? new Date(data.updated_at).getTime() : 0,
  };
}

async function pushSnapshotNow() {
  if (!supabase || mode !== "cloud") return;
  setSyncStatus("Saving…");
  const payload = buildSnapshot();
  const { error } = await supabase.from("crew_state").upsert({
    id: CREW_ROW_ID,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("crew_state upsert", error);
    setSyncStatus("Save failed — run supabase/schema-public.sql in Supabase");
    return;
  }
  const remote = await fetchRemoteSnapshot();
  if (remote) remoteVersion = remote.updatedAtMs;
  setSyncStatus("Shared data (everyone)");
}

export function schedulePersist() {
  if (mode !== "cloud") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void pushSnapshotNow();
  }, PERSIST_DEBOUNCE_MS);
}

function subscribeRemoteChanges() {
  if (!supabase) return;
  supabase
    .channel("crew_state_changes")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "crew_state", filter: `id=eq.${CREW_ROW_ID}` },
      (payload) => {
        const row = payload.new;
        if (!row?.payload) return;
        const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        if (updatedAtMs <= remoteVersion) return;
        remoteVersion = updatedAtMs;
        applySnapshot(row.payload);
        setSyncStatus("Updated from shared data");
        window.dispatchEvent(new CustomEvent("crew-data-updated"));
      }
    )
    .subscribe();
}

/** @param {string} text */
function setSyncStatus(text) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = text;
}
