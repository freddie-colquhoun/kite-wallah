import { normalizeAbility } from "./ability-levels.js";
import { createId } from "./ids.js";
import { normalizeSessionEntry } from "./session-comparison.js";
import {
  migrateProfilesToSharedQuiver,
  profileToQuiverFromState,
  normalizeKite,
} from "./quiver-storage.js";

const STORAGE_KEY = "kitesurf-advisor-profiles-v3";

/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./engine.js').Board} Board */
/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

/**
 * @typedef {Object} RiderProfile
 * @property {string} id
 * @property {string} name
 * @property {number} weight
 * @property {number} height
 * @property {'male' | 'female' | 'unspecified'} sex
 * @property {string} ability
 * @property {string[]} [skills] legacy, unused in UI
 * @property {number|null} yearsRiding
 * @property {'freeride' | 'freestyle' | 'wave' | 'foil' | 'big-air'} preferredStyle
 * @property {string[]} kiteIds Links to shared quiver kites
 * @property {string[]} boardIds Links to shared quiver boards
 * @property {Kite[]} [kites] legacy, migrated to shared quiver
 * @property {Board[]} [boards] legacy
 * @property {CalibrationEntry[]} calibration
 */

/**
 * @typedef {Object} AppState
 * @property {string} activeProfileId
 * @property {RiderProfile[]} profiles
 * @property {{ kites: Kite[], boards: Board[] }} [quiver]
 * @property {boolean} [quiverMigrated]
 */

const DEFAULT_RIDER = {
  weight: 75,
  height: 175,
  sex: "unspecified",
  ability: "competent",
  yearsRiding: null,
  preferredStyle: "freeride",
};

export function createEmptyProfile(name = "New rider") {
  return {
    id: createId(),
    name,
    ...DEFAULT_RIDER,
    kiteIds: [],
    boardIds: [],
    calibration: [],
    skills: [],
  };
}

function seedDemoKites() {
  return [
    {
      id: createId(),
      brand: "Duotone",
      model: "Rebel",
      size: 9,
      name: "Duotone Rebel 9m",
      type: "hybrid",
      style: "Big air / freeride",
      windRange: { min: 15, ideal: 21, max: 28 },
      weightRef: 75,
      specsSource: "manufacturer",
    },
    {
      id: createId(),
      brand: "Duotone",
      model: "Rebel",
      size: 12,
      name: "Duotone Rebel 12m",
      type: "hybrid",
      style: "Big air / freeride",
      windRange: { min: 10, ideal: 14, max: 20 },
      weightRef: 75,
      specsSource: "manufacturer",
    },
    {
      id: createId(),
      brand: "North",
      model: "Orbit",
      size: 7,
      name: "North Orbit 7m",
      type: "hybrid",
      style: "Big air / freeride",
      windRange: { min: 20, ideal: 26, max: 35 },
      weightRef: 75,
      specsSource: "manufacturer",
    },
  ];
}

function seedDemoBoards() {
  return [
    { id: createId(), type: "twin-tip", name: "138cm twin tip", sizeCm: 138 },
    { id: createId(), type: "surfboard", name: "5'10 surfboard", sizeCm: null },
  ];
}

/** @type {AppState|null} */
let memoryState = null;

/** @param {AppState} state */
export function installState(state) {
  memoryState = state;
}

/** Strip photo fields so cloud payloads stay small. @param {AppState} state */
export function stripPhotosFromState(state) {
  if (!state?.quiver?.kites) return state;
  return {
    ...state,
    quiver: {
      ...state.quiver,
      kites: state.quiver.kites.map((k) => {
        const { photo, ...rest } = k;
        return rest;
      }),
    },
  };
}

/** Read from localStorage only (bootstrap / migration). @returns {AppState} */
export function readLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.profiles) && data.profiles.length) {
        data.profiles = data.profiles.map(normalizeProfile);
        if (!data.activeProfileId || !data.profiles.find((p) => p.id === data.activeProfileId)) {
          data.activeProfileId = data.profiles[0].id;
        }
        migrateProfilesToSharedQuiver(data);
        return stripPhotosFromState(data);
      }
    }
  } catch {
    /* migrate below */
  }

  try {
    const v2 = localStorage.getItem("kitesurf-advisor-profiles-v2");
    if (v2) {
      const data = JSON.parse(v2);
      if (Array.isArray(data.profiles) && data.profiles.length) {
        data.profiles = data.profiles.map(normalizeProfile);
        if (!data.activeProfileId) data.activeProfileId = data.profiles[0].id;
        migrateProfilesToSharedQuiver(data);
        return stripPhotosFromState(data);
      }
    }
  } catch {
    /* fall through */
  }

  return stripPhotosFromState(migrateLegacyStorageNoPersist());
}

/** @returns {AppState} */
export function loadState() {
  if (!memoryState) throw new Error("App data not loaded yet — wait for bootstrap.");
  return memoryState;
}

function normalizeProfile(/** @type {RiderProfile} */ p) {
  return {
    ...createEmptyProfile(p.name || "Rider"),
    ...p,
    ability: normalizeAbility(p.ability),
    kiteIds: Array.isArray(p.kiteIds) ? p.kiteIds : [],
    boardIds: Array.isArray(p.boardIds) ? p.boardIds : [],
    calibration: Array.isArray(p.calibration)
      ? p.calibration.map((e) => normalizeSessionEntry(e))
      : [],
  };
}

/** Migrate v1 single-profile storage (writes to localStorage once). */
function migrateLegacyStorageNoPersist() {
  let name = "Me";
  let rider = { ...DEFAULT_RIDER };
  let kites = [];
  let boards = [];
  let calibration = [];

  try {
    const oldProfile = localStorage.getItem("kitesurf-advisor-profile");
    if (oldProfile) {
      const p = JSON.parse(oldProfile);
      rider = { ...DEFAULT_RIDER, ...p, ability: normalizeAbility(p.ability) };
    }
    const oldQuiver = localStorage.getItem("kitesurf-advisor-quiver");
    if (oldQuiver) {
      const q = JSON.parse(oldQuiver);
      kites = Array.isArray(q.kites) ? q.kites : [];
      boards = Array.isArray(q.boards) ? q.boards : [];
    }
    const oldCal = localStorage.getItem("kitesurf-advisor-calibration");
    if (oldCal) {
      calibration = JSON.parse(oldCal);
      if (!Array.isArray(calibration)) calibration = [];
    }
  } catch {
    /* use defaults */
  }

  const hasData = kites.length || boards.length || calibration.length;
  const profile = createEmptyProfile(name);
  Object.assign(profile, rider, { calibration });
  const demoKites = hasData ? kites.map(normalizeKite) : seedDemoKites().map(normalizeKite);
  const demoBoards = hasData ? boards : seedDemoBoards();
  profile.kiteIds = demoKites.map((k) => k.id);
  profile.boardIds = demoBoards.map((b) => b.id);

  const state = {
    activeProfileId: profile.id,
    profiles: [profile],
    quiver: { kites: demoKites, boards: demoBoards },
    quiverMigrated: true,
  };
  memoryState = stripPhotosFromState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
  return memoryState;
}

/** @param {AppState} state */
export function saveState(state) {
  memoryState = stripPhotosFromState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
  if (!window.__cloudWriteBlocked) window.__schedulePersist?.();
}

/** After loading shared data — keep this device’s cache in sync (does not upload). */
export function persistLocalCacheFromMemory() {
  if (!memoryState) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
}

/** @param {AppState} state @param {string} id */
export function getProfile(state, id) {
  return state.profiles.find((p) => p.id === id) ?? null;
}

/** @param {AppState} state @param {RiderProfile} profile */
export function upsertProfile(state, profile) {
  const idx = state.profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) state.profiles[idx] = profile;
  else state.profiles.push(profile);
  saveState(state);
}

/** @param {AppState} state @param {string} id */
export function deleteProfile(state, id) {
  if (state.profiles.length <= 1) return false;
  state.profiles = state.profiles.filter((p) => p.id !== id);
  if (state.activeProfileId === id) {
    state.activeProfileId = state.profiles[0].id;
  }
  saveState(state);
  return true;
}

/** @param {RiderProfile} profile */
export function profileToConditions(profile, spotNotes, wind, gust, direction, water) {
  return {
    windSpeed: wind,
    gustSpeed: gust,
    windDirection: direction,
    waterType: water,
    skillLevel: normalizeAbility(profile.ability),
    riderWeight: profile.weight,
    spotNotes,
  };
}

/** @param {AppState} state @param {RiderProfile} profile */
export function profileToQuiver(state, profile) {
  return profileToQuiverFromState(state, profile);
}

export { DEFAULT_RIDER };
