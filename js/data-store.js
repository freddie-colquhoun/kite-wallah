/**
 * Shared crew data: Supabase when configured, else browser localStorage.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { CLOUD_CONFIG } from "./config.js";
import { readLocalState, loadState, installState, stripPhotosFromState } from "./storage.js";
import { readLocalSpots, readLocalSettings, installSpots, installSettings } from "./spots-storage.js";

const CREW_ROW_ID = "crew";
const AUTH_STORAGE_KEY = "kite-wallah-auth";
const PERSIST_DEBOUNCE_MS = 700;

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let supabase = null;

/** @type {{ enabled: boolean, supabaseUrl: string, supabaseAnonKey: string, crewEmail: string }|null} */
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
  if (c?.enabled && urlOk && keyOk && c.crewEmail) {
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
 * Boot app data. Shows login overlay when cloud is enabled and not signed in.
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

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  const session = await ensureCrewSession(config);
  if (!session) return { ok: false };

  mode = "cloud";
  const remote = await fetchRemoteSnapshot();
  if (remote?.payload && hasPayloadData(remote.payload)) {
    applySnapshot(remote.payload);
    remoteVersion = remote.updatedAtMs;
    setSyncStatus("Synced with crew");
  } else if (hasLocalData(localState, localSpots)) {
    applySnapshot({
      version: 1,
      state: stripPhotosFromState(localState),
      spots: localSpots,
      settings: localSettings,
    });
    await pushSnapshotNow();
    setSyncStatus("Uploaded your local data to the crew");
  } else {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    await pushSnapshotNow();
    setSyncStatus("Synced with crew");
  }

  window.__schedulePersist = schedulePersist;
  subscribeRemoteChanges();
  return { ok: true, state: loadState() };
}

function hasPayloadData(/** @type {object} */ payload) {
  const st = payload.state;
  const spots = payload.spots;
  return (
    (st?.profiles?.length > 0) ||
    (st?.quiver?.kites?.length > 0) ||
    (Array.isArray(spots) && spots.length > 0)
  );
}

function hasLocalData(/** @type {import('./storage.js').AppState} */ state, /** @type {unknown[]} */ spots) {
  return state.profiles?.length > 0 || spots.length > 0;
}

/**
 * @param {object} payload
 */
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
    setSyncStatus("Save failed — try again");
    return;
  }
  const remote = await fetchRemoteSnapshot();
  if (remote) remoteVersion = remote.updatedAtMs;
  setSyncStatus("Synced with crew");
}

export function schedulePersist() {
  if (mode !== "cloud") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void pushSnapshotNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** @param {{ crewEmail: string }} config */
function ensureCrewSession(config) {
  return new Promise((resolve) => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        hideLogin();
        resolve(data.session);
        return;
      }
      showLogin(config, resolve);
    })();
  });
}

/** @param {{ crewEmail: string }} config @param {(session: unknown) => void} resolve */
function showLogin(config, resolve) {
  const overlay = document.getElementById("crew-login");
  const form = document.getElementById("crew-login-form");
  const err = document.getElementById("crew-login-error");
  const emailInput = document.getElementById("crew-login-email");
  if (!overlay || !form) {
    resolve(null);
    return;
  }
  if (emailInput) emailInput.value = config.crewEmail;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (err) {
      err.classList.add("hidden");
      err.textContent = "";
    }
    const password = document.getElementById("crew-login-password")?.value;
    if (!password) return;
    const { data, error } = await supabase.auth.signInWithPassword({
      email: config.crewEmail,
      password,
    });
    if (error) {
      if (err) {
        err.textContent = error.message;
        err.classList.remove("hidden");
      }
      return;
    }
    hideLogin();
    resolve(data.session);
  };
}

function hideLogin() {
  const overlay = document.getElementById("crew-login");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
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
        setSyncStatus("Updated from crew");
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
