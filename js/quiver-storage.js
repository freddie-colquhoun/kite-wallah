/**
 * Shared crew quiver — all kites/boards are candidates for every rider's recommendations.
 * profile.kiteIds / boardIds track gear used in that rider's logged sessions only.
 */

import { createId } from "./ids.js";
import { normalizeAbility } from "./ability-levels.js";
import { getSkillLimits } from "./ability-levels.js";

/** @typedef {import('./engine.js').Kite} Kite */
/** @typedef {import('./engine.js').Board} Board */
/** @typedef {import('./storage.js').RiderProfile} RiderProfile */
/** @typedef {import('./storage.js').AppState} AppState */

/**
 * @typedef {Object} QuiverState
 * @property {Kite[]} kites
 * @property {Board[]} boards
 */

/**
 * @typedef {Object} KiteRepair
 * @property {string} id
 * @property {string} date ISO date or datetime
 * @property {string} note
 */

/** @param {Partial<Kite>} k */
export function normalizeKite(k) {
  return {
    id: k.id || createId(),
    brand: k.brand || "",
    model: k.model || "",
    size: Number(k.size) || 0,
    name: k.name || `${k.brand || "Kite"} ${k.model || ""} ${k.size || "?"}m`.trim(),
    type: k.type || "hybrid",
    style: k.style || "",
    windRange: k.windRange,
    weightRef: k.weightRef,
    specsSource: k.specsSource,
    label: (k.label || "").trim(),
    color: (k.color || "").trim(),
    isSls: Boolean(k.isSls),
    repairs: Array.isArray(k.repairs)
      ? k.repairs.map((r) => ({
          id: r.id || createId(),
          date: r.date || "",
          note: (r.note || "").trim(),
        }))
      : [],
    notes: (k.notes || "").trim(),
    yearManufactured: parseYearManufactured(k.yearManufactured),
    purchasedFrom: (k.purchasedFrom || "").trim(),
    purchaseDate: normalizePurchaseDate(k.purchaseDate),
  };
}

/** @param {unknown} value */
function parseYearManufactured(value) {
  const y = Number(value);
  if (!Number.isFinite(y) || y < 1990 || y > new Date().getFullYear() + 1) return null;
  return Math.round(y);
}

/** @param {unknown} value */
function normalizePurchaseDate(value) {
  if (!value || typeof value !== "string") return "";
  const s = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** @param {Partial<Board>} b */
export function normalizeBoard(b) {
  return {
    id: b.id || createId(),
    type: b.type || "twin-tip",
    name: (b.name || "").trim() || BOARD_TYPE_FALLBACK_NAME(b.type),
    sizeCm: b.sizeCm != null && b.sizeCm !== "" ? Number(b.sizeCm) : null,
    yearManufactured: parseYearManufactured(b.yearManufactured),
    purchasedFrom: (b.purchasedFrom || "").trim(),
    purchaseDate: normalizePurchaseDate(b.purchaseDate),
  };
}

/** @param {string} [type] */
function BOARD_TYPE_FALLBACK_NAME(type) {
  const labels = {
    "twin-tip": "Twin tip",
    surfboard: "Surfboard",
    foil: "Foil board",
    "light-wind": "Light-wind board",
  };
  return labels[type] || "Board";
}

/** @param {AppState} state */
export function ensureQuiverState(state) {
  if (!state.quiver) {
    state.quiver = { kites: [], boards: [] };
  }
  if (!Array.isArray(state.quiver.kites)) state.quiver.kites = [];
  if (!Array.isArray(state.quiver.boards)) state.quiver.boards = [];
}

/**
 * Move per-rider kites/boards into shared quiver once.
 * @param {AppState} state
 */
export function migrateProfilesToSharedQuiver(state) {
  ensureQuiverState(state);
  if (state.quiverMigrated) return;

  const kiteById = new Map(state.quiver.kites.map((k) => [k.id, normalizeKite(k)]));
  const boardById = new Map(state.quiver.boards.map((b) => [b.id, normalizeBoard(b)]));

  for (const profile of state.profiles) {
    const legacyKites = profile.kites || [];
    const legacyBoards = profile.boards || [];

    for (const k of legacyKites) {
      const n = normalizeKite(k);
      kiteById.set(n.id, n);
    }
    for (const b of legacyBoards) {
      const n = normalizeBoard(b);
      boardById.set(n.id, n);
    }

    if (!profile.kiteIds?.length && legacyKites.length) {
      profile.kiteIds = legacyKites.map((k) => k.id);
    }
    if (!profile.boardIds?.length && legacyBoards.length) {
      profile.boardIds = legacyBoards.map((b) => b.id);
    }

    profile.kiteIds = profile.kiteIds || [];
    profile.boardIds = profile.boardIds || [];
    delete profile.kites;
    delete profile.boards;
  }

  state.quiver.kites = [...kiteById.values()].sort((a, b) => a.size - b.size);
  state.quiver.boards = [...boardById.values()];
  state.quiverMigrated = true;
}

/** @param {AppState} state @param {RiderProfile} profile */
/** All quiver kites are used for every rider (no per-rider assignment). */
export function getRiderKites(state, profile) {
  void profile;
  migrateProfilesToSharedQuiver(state);
  return [...state.quiver.kites].map((k) => normalizeKite(k)).sort((a, b) => a.size - b.size);
}

/** @param {AppState} state @param {RiderProfile} profile */
export function getRiderBoards(state, profile) {
  void profile;
  migrateProfilesToSharedQuiver(state);
  return state.quiver.boards.map((b) => normalizeBoard(b));
}

/** @param {AppState} state @param {RiderProfile} profile */
export function profileToQuiverFromState(state, profile) {
  return {
    kites: getRiderKites(state, profile),
    boards: getRiderBoards(state, profile),
  };
}

/** @param {RiderProfile} profile */
export function getProfileSkillLimits(profile) {
  return getSkillLimits(normalizeAbility(profile.ability));
}

/** @param {AppState} state @param {Kite} kite */
export function upsertQuiverKite(state, kite) {
  ensureQuiverState(state);
  const n = normalizeKite(kite);
  const idx = state.quiver.kites.findIndex((k) => k.id === n.id);
  if (idx >= 0) state.quiver.kites[idx] = n;
  else state.quiver.kites.push(n);
  state.quiver.kites.sort((a, b) => a.size - b.size);
  return n;
}

/** @param {AppState} state @param {string} kiteId */
export function removeQuiverKite(state, kiteId) {
  ensureQuiverState(state);
  state.quiver.kites = state.quiver.kites.filter((k) => k.id !== kiteId);
  for (const p of state.profiles) {
    if (p.kiteIds) p.kiteIds = p.kiteIds.filter((id) => id !== kiteId);
  }
}

/** @param {AppState} state @param {Board} board */
export function upsertQuiverBoard(state, board) {
  ensureQuiverState(state);
  const n = normalizeBoard(board);
  const idx = state.quiver.boards.findIndex((b) => b.id === n.id);
  if (idx >= 0) state.quiver.boards[idx] = n;
  else state.quiver.boards.push(n);
  return n;
}

/** @param {AppState} state @param {string} boardId */
export function removeQuiverBoard(state, boardId) {
  ensureQuiverState(state);
  state.quiver.boards = state.quiver.boards.filter((b) => b.id !== boardId);
  for (const p of state.profiles) {
    if (p.boardIds) p.boardIds = p.boardIds.filter((id) => id !== boardId);
  }
}

/** @param {Kite} kite */
export function kiteDisplayTitle(kite) {
  const k = normalizeKite(kite);
  if (k.label) return k.label;
  return k.name;
}
