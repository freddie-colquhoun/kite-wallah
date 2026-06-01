/**
 * Shared data: Supabase when configured (public read/write, no sign-in), else localStorage.
 */

import { CLOUD_CONFIG } from "./config.js";
import { escapeHtml } from "./dom-safe.js";
import {
  readLocalState,
  loadState,
  installState,
  stripPhotosFromState,
  persistLocalCacheFromMemory,
} from "./storage.js";
import {
  readLocalSpots,
  readLocalSettings,
  installSpots,
  installSettings,
  persistSpotsLocalCache,
  persistSettingsLocalCache,
} from "./spots-storage.js";

const CREW_ROW_ID = "crew";
const PERSIST_DEBOUNCE_MS = 700;
const REMOTE_FETCH_TIMEOUT_MS = 12_000;
const REMOTE_SAVE_TIMEOUT_MS = 12_000;
const SUPABASE_IMPORT_TIMEOUT_MS = 8_000;
const CLOUD_OFF_SESSION_KEY = "kite-wallah-cloud-off";

/** @type {typeof import('@supabase/supabase-js').createClient|null} */
let createClientFn = null;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** @returns {Promise<typeof import('@supabase/supabase-js').createClient>} */
async function loadSupabaseCreateClient() {
  if (createClientFn) return createClientFn;

  const sources = [
    { label: "import map", url: "@supabase/supabase-js" },
    {
      label: "jsDelivr",
      url: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm",
    },
  ];

  /** @type {Error|null} */
  let lastErr = null;
  for (const src of sources) {
    try {
      const mod = await withTimeout(
        import(src.url),
        SUPABASE_IMPORT_TIMEOUT_MS,
        `Supabase library (${src.label})`
      );
      if (typeof mod.createClient !== "function") {
        throw new Error(`Supabase module from ${src.label} missing createClient`);
      }
      createClientFn = mod.createClient;
      return createClientFn;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(`Supabase import failed (${src.label})`, lastErr);
    }
  }

  throw lastErr ?? new Error("Could not load Supabase client library");
}

/** @returns {Promise<import('@supabase/supabase-js').SupabaseClient>} */
async function createSupabaseClient(config) {
  const createClient = await loadSupabaseCreateClient();
  return createClient(config.supabaseUrl, config.supabaseAnonKey);
}

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let supabase = null;

/** @type {{ enabled: boolean, supabaseUrl: string, supabaseAnonKey: string }|null} */
let cloudConfig = null;

/** @type {'local'|'cloud'} */
let mode = "local";

/** @type {'none'|'load_failed'|'save_failed'|'offline_copy'} */
let cloudIssue = "none";

let persistTimer = null;
let remoteVersion = 0;
/** @type {Error|null} */
let lastFetchError = null;

/** @returns {Promise<typeof cloudConfig>} */
export async function getCloudConfig() {
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(CLOUD_OFF_SESSION_KEY) === "1") {
    cloudConfig = null;
    return null;
  }
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

export function getCloudIssue() {
  return cloudIssue;
}

function setCloudWriteBlocked(blocked) {
  window.__cloudWriteBlocked = blocked;
}

function persistAllLocalCache() {
  persistLocalCacheFromMemory();
  persistSpotsLocalCache();
  persistSettingsLocalCache();
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   state?: import('./storage.js').AppState,
 *   cloudMode?: boolean,
 *   cloudIssue?: string,
 * }>}
 */
export async function bootstrapData() {
  const config = await getCloudConfig();
  const localState = readLocalState();
  const localSpots = readLocalSpots();
  const localSettings = readLocalSettings();

  cloudIssue = "none";
  hideCloudAlert();

  if (!config) {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    mode = "local";
    setCloudWriteBlocked(false);
    window.__schedulePersist = schedulePersist;
    setSyncStatus("Saved on this device only");
    return { ok: true, state: loadState(), cloudMode: false, cloudIssue: "none" };
  }

  try {
    supabase = await createSupabaseClient(config);
  } catch (err) {
    lastFetchError = err instanceof Error ? err : new Error(String(err));
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    mode = "local";
    setCloudWriteBlocked(true);
    cloudIssue = "load_failed";
    setSyncStatus("Shared data unavailable — using this device");
    showCloudAlert("load_failed", lastFetchError);
    window.__schedulePersist = schedulePersist;
    wireCloudRecovery();
    return { ok: true, state: loadState(), cloudMode: false, cloudIssue };
  }

  mode = "cloud";
  setCloudWriteBlocked(false);

  const remote = await fetchRemoteSnapshot();

  if (lastFetchError) {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    setCloudWriteBlocked(true);
    cloudIssue = "load_failed";
    setSyncStatus("Could not reach shared data");
    showCloudAlert("load_failed", lastFetchError);
    window.__schedulePersist = schedulePersist;
    wireCloudRecovery();
    return { ok: true, state: loadState(), cloudMode: true, cloudIssue };
  }

  if (remote?.payload && hasPayloadData(remote.payload)) {
    applySnapshot(remote.payload);
    remoteVersion = remote.updatedAtMs;
    persistAllLocalCache();
    setSyncStatusLive();
    window.__schedulePersist = schedulePersist;
    subscribeRemoteChanges();
    wireCloudRecovery();
    return { ok: true, state: loadState(), cloudMode: true, cloudIssue: "none" };
  }

  if (hasLocalData(localState, localSpots)) {
    applySnapshot({
      version: 1,
      state: stripPhotosFromState(localState),
      spots: localSpots,
      settings: localSettings,
    });
    const saved = await pushSnapshotNow();
    if (!saved) {
      cloudIssue = "save_failed";
      setCloudWriteBlocked(true);
      showCloudAlert("save_failed");
    } else {
      persistAllLocalCache();
      setSyncStatusLive();
    }
  } else {
    installState(localState);
    installSpots(localSpots);
    installSettings(localSettings);
    const saved = await pushSnapshotNow();
    if (!saved) {
      cloudIssue = "save_failed";
      setCloudWriteBlocked(true);
      showCloudAlert("save_failed");
    } else {
      persistAllLocalCache();
      setSyncStatusLive();
    }
  }

  window.__schedulePersist = schedulePersist;
  subscribeRemoteChanges();
  wireCloudRecovery();
  return { ok: true, state: loadState(), cloudMode: true, cloudIssue };
}

/** Stop trying cloud sync for this browser tab session (local data only). */
export function useDeviceOnlyCloudMode() {
  try {
    sessionStorage.setItem(CLOUD_OFF_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
  supabase = null;
  mode = "local";
  cloudIssue = "none";
  setCloudWriteBlocked(false);
  hideCloudAlert();
  setSyncStatus("Saved on this device only");
}

/** Try to load shared data again (e.g. after Retry button). */
export async function retryCloudSync() {
  const config = await getCloudConfig();
  if (!config) return false;

  setSyncStatus("Connecting to shared data…");
  lastFetchError = null;

  if (!supabase) {
    try {
      createClientFn = null;
      supabase = await createSupabaseClient(config);
      mode = "cloud";
      setCloudWriteBlocked(false);
      subscribeRemoteChanges();
    } catch (err) {
      lastFetchError = err instanceof Error ? err : new Error(String(err));
      cloudIssue = "load_failed";
      setCloudWriteBlocked(true);
      setSyncStatus("Could not reach shared data");
      showCloudAlert("load_failed", lastFetchError);
      return false;
    }
  }

  const remote = await fetchRemoteSnapshot();

  if (lastFetchError) {
    cloudIssue = "load_failed";
    setCloudWriteBlocked(true);
    setSyncStatus("Could not reach shared data");
    showCloudAlert("load_failed", lastFetchError);
    return false;
  }

  setCloudWriteBlocked(false);
  cloudIssue = "none";
  hideCloudAlert();

  if (remote?.payload && hasPayloadData(remote.payload)) {
    applySnapshot(remote.payload);
    remoteVersion = remote.updatedAtMs;
  }

  persistAllLocalCache();
  setSyncStatusLive();
  window.dispatchEvent(new CustomEvent("crew-data-updated"));
  return true;
}

let recoveryWired = false;

function wireCloudRecovery() {
  if (recoveryWired || !cloudConfig) return;
  recoveryWired = true;
  window.addEventListener("online", () => {
    if (cloudIssue === "load_failed" || cloudIssue === "save_failed") {
      void retryCloudSync();
    }
  });
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

function settingsForCloudSync() {
  const s = { ...readLocalSettings() };
  delete s.openaiApiKey;
  delete s.aiLayerMode;
  return s;
}

function buildSnapshot() {
  return {
    version: 1,
    state: stripPhotosFromState(readLocalState()),
    spots: readLocalSpots(),
    settings: settingsForCloudSync(),
  };
}

/** @returns {Promise<{ payload: object, updatedAtMs: number }|null>} */
async function fetchRemoteSnapshot() {
  if (!supabase) return null;
  lastFetchError = null;
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("crew_state")
        .select("payload, updated_at")
        .eq("id", CREW_ROW_ID)
        .maybeSingle(),
      REMOTE_FETCH_TIMEOUT_MS,
      "Shared data fetch"
    );
    if (error) {
      lastFetchError = error;
      console.warn("crew_state fetch", error);
      return null;
    }
    if (!data) return null;
    return {
      payload: data.payload,
      updatedAtMs: data.updated_at ? new Date(data.updated_at).getTime() : 0,
    };
  } catch (err) {
    lastFetchError = err instanceof Error ? err : new Error(String(err));
    console.warn("crew_state fetch", lastFetchError);
    return null;
  }
}

/** @returns {Promise<boolean>} */
async function pushSnapshotNow() {
  if (!supabase || mode !== "cloud") return false;
  if (window.__cloudWriteBlocked) return false;
  setSyncStatus("Saving…");
  const payload = buildSnapshot();
  let error = null;
  try {
    const result = await withTimeout(
      supabase.from("crew_state").upsert({
        id: CREW_ROW_ID,
        payload,
        updated_at: new Date().toISOString(),
      }),
      REMOTE_SAVE_TIMEOUT_MS,
      "Shared data save"
    );
    error = result.error;
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  if (error) {
    console.warn("crew_state upsert", error);
    cloudIssue = "save_failed";
    setCloudWriteBlocked(true);
    setSyncStatus("Save failed");
    showCloudAlert("save_failed", error);
    return false;
  }
  const remote = await fetchRemoteSnapshot();
  if (remote) remoteVersion = remote.updatedAtMs;
  if (!lastFetchError) {
    cloudIssue = "none";
    hideCloudAlert();
    setSyncStatusLive();
  }
  return true;
}

export function schedulePersist() {
  if (mode !== "cloud" || window.__cloudWriteBlocked) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void pushSnapshotNow();
  }, PERSIST_DEBOUNCE_MS);
}

let remoteSubscribed = false;

function subscribeRemoteChanges() {
  if (!supabase || remoteSubscribed) return;
  remoteSubscribed = true;
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
        persistAllLocalCache();
        cloudIssue = "none";
        hideCloudAlert();
        setSyncStatusLive();
        window.dispatchEvent(new CustomEvent("crew-data-updated"));
      }
    )
    .subscribe();
}

function setSyncStatusLive() {
  refreshLiveStatusFromStore();
}

/** @param {string} _text */
function setSyncStatus(_text) {
  refreshLiveStatusFromStore();
}

function refreshLiveStatusFromStore() {
  window.dispatchEvent(new CustomEvent("live-status-refresh"));
}

/** Re-apply header sync UI from current mode (call after app start). */
export function updateSyncStatusDisplay() {
  refreshLiveStatusFromStore();
}

/**
 * @param {'load_failed'|'save_failed'} kind
 * @param {Error|{ message?: string }|null} [err]
 */
/** @param {Error|{ message?: string }|null} [err] */
function formatCloudErrorDetail(err) {
  const msg = err?.message ? String(err.message) : "";
  if (!msg) return "";
  if (/importing a module|module script failed|failed to fetch|load failed|supabase library/i.test(msg)) {
    return " (Could not load the sync library — often a network blocker or Safari extension. Try Retry, or use “This device only”.)";
  }
  return ` (${msg})`;
}

function showCloudAlert(kind, err = null) {
  const el = document.getElementById("cloud-alert");
  if (!el) return;

  const detail = formatCloudErrorDetail(err);

  if (kind === "load_failed") {
    el.innerHTML = `
      <div class="cloud-alert-inner">
        <p class="cloud-alert-title"><strong>Could not load shared crew data</strong></p>
        <p class="cloud-alert-text">You may be seeing an old copy saved on this device only.${detail ? ` ${escapeHtml(detail)}` : ""}</p>
        <ol class="cloud-alert-steps">
          <li>Check your internet connection.</li>
          <li>In <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Supabase</a>, open <strong>SQL Editor</strong> and run the script in <code>supabase/schema-public.sql</code> (or <code>schema.sql</code>).</li>
          <li>Click <strong>Retry</strong> below, or refresh the page.</li>
          <li>If it still fails: clear site data for this page (browser settings), then open the link again.</li>
        </ol>
        <div class="cloud-alert-actions">
          <button type="button" class="btn btn-primary btn-sm" id="cloud-retry-btn">Retry</button>
          <button type="button" class="btn btn-secondary btn-sm" id="cloud-device-only-btn">This device only</button>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="cloud-alert-inner">
        <p class="cloud-alert-title"><strong>Could not save to shared crew data</strong></p>
        <p class="cloud-alert-text">Changes on this device may not reach your mates until this is fixed.${detail ? ` ${escapeHtml(detail)}` : ""}</p>
        <ol class="cloud-alert-steps">
          <li>Check your internet connection.</li>
          <li>Run <code>supabase/schema-public.sql</code> in Supabase SQL Editor if you have not already.</li>
          <li>Click <strong>Retry</strong> or refresh the page.</li>
        </ol>
        <div class="cloud-alert-actions">
          <button type="button" class="btn btn-primary btn-sm" id="cloud-retry-btn">Retry</button>
          <button type="button" class="btn btn-secondary btn-sm" id="cloud-device-only-btn">This device only</button>
        </div>
      </div>`;
  }

  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
  document.getElementById("cloud-retry-btn")?.addEventListener("click", () => {
    void retryCloudSync();
  });
  document.getElementById("cloud-device-only-btn")?.addEventListener("click", () => {
    useDeviceOnlyCloudMode();
    window.dispatchEvent(new CustomEvent("crew-data-updated"));
  });
}

function hideCloudAlert() {
  const el = document.getElementById("cloud-alert");
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "";
}

