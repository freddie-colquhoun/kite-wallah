import { createId } from "./ids.js";

const SPOTS_KEY = "kitesurf-advisor-spots";
const SETTINGS_KEY = "kitesurf-advisor-settings";

/** @type {KiteSpot[]|null} */
let memorySpots = null;

/** @type {AppSettings|null} */
let memorySettings = null;

/** @param {KiteSpot[]} spots */
export function installSpots(spots) {
  memorySpots = spots;
}

/** @param {AppSettings} settings */
export function installSettings(settings) {
  memorySettings = settings;
}

/** @returns {KiteSpot[]} */
export function readLocalSpots() {
  try {
    const raw = localStorage.getItem(SPOTS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(normalizeSpot) : [];
  } catch {
    return [];
  }
}

/** @returns {AppSettings} */
export function readLocalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { activeSpotId: null, stormglassApiKey: "" };
    return { activeSpotId: null, stormglassApiKey: "", ...JSON.parse(raw) };
  } catch {
    return { activeSpotId: null, stormglassApiKey: "" };
  }
}

/** @typedef {'flat'|'choppy'|'waves'} WaterType */
/** @typedef {'any'|'mid'|'high'|'low'} TidePreference */
/** @typedef {'none'|'within_low'|'within_high'} TideAccessRule */

/**
 * @typedef {Object} KiteSpot
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string[]} safeDirections
 * @property {string[]} offshoreDirections
 * @property {TidePreference} tidePreference
 * @property {WaterType} waterType
 * @property {string} launchNotes
 * @property {string} localKnowledge
 * @property {string|null} [noaaStationId]
 * @property {TideAccessRule} tideAccessRule When you can launch (tide window)
 * @property {number} tideWindowHours Hours either side of low/high tide (e.g. 3)
 */

/**
 * @typedef {Object} AppSettings
 * @property {string|null} activeSpotId
 * @property {string} stormglassApiKey
 * @property {string} [openaiApiKey]
 */

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** @returns {KiteSpot[]} */
export function loadSpots() {
  if (memorySpots) return memorySpots;
  return readLocalSpots();
}

/** @param {KiteSpot[]} spots */
export function saveSpots(spots) {
  memorySpots = spots;
  localStorage.setItem(SPOTS_KEY, JSON.stringify(spots));
  window.__schedulePersist?.();
}

/** @returns {AppSettings} */
export function loadSettings() {
  if (memorySettings) return memorySettings;
  return readLocalSettings();
}

/** @param {AppSettings} settings */
export function saveSettings(settings) {
  memorySettings = settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.__schedulePersist?.();
}

/** @param {Partial<KiteSpot>} data */
export function createEmptySpot(name = "New spot", data = {}) {
  return normalizeSpot({
    id: createId(),
    name,
    lat: 50.8,
    lon: -1.1,
    safeDirections: ["SW", "W", "NW"],
    offshoreDirections: ["NE", "E"],
    tidePreference: "any",
    waterType: "choppy",
    launchNotes: "",
    localKnowledge: "",
    ...data,
  });
}

/** @param {KiteSpot} s */
function normalizeSpot(s) {
  return {
    id: s.id || createId(),
    name: s.name || "Spot",
    lat: Number(s.lat) || 0,
    lon: Number(s.lon) || 0,
    safeDirections: Array.isArray(s.safeDirections) ? s.safeDirections : ["SW", "W", "NW"],
    offshoreDirections: Array.isArray(s.offshoreDirections) ? s.offshoreDirections : ["NE", "E"],
    tidePreference: s.tidePreference || "any",
    waterType: s.waterType || "choppy",
    launchNotes: s.launchNotes || "",
    localKnowledge: s.localKnowledge || "",
    noaaStationId: s.noaaStationId ?? null,
    tideAccessRule: s.tideAccessRule || "none",
    tideWindowHours: Number(s.tideWindowHours) > 0 ? Number(s.tideWindowHours) : 3,
  };
}

export const TIDE_ACCESS_RULE_LABELS = {
  none: "No tide window (any tide)",
  within_low: "Only within X hours of low tide",
  within_high: "Only within X hours of high tide",
};

/** @param {KiteSpot[]} spots @param {string} id */
export function getSpot(spots, id) {
  return spots.find((s) => s.id === id) ?? null;
}

export { COMPASS };
