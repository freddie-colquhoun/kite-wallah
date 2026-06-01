/**
 * Shared quiver tab: kites (labels, repairs) + boards.
 */

import { loadCatalog, getBrands, getModels, getSizes, fetchKiteSpecs } from "./kite-lookup.js";
import { createId } from "./ids.js";
import { formatNum, formatKt } from "./format.js";
import { getKiteWindRange, BOARD_TYPE_LABELS } from "./engine.js";
import {
  normalizeKite,
  normalizeBoard,
  upsertQuiverKite,
  removeQuiverKite,
  upsertQuiverBoard,
  removeQuiverBoard,
  kiteDisplayTitle,
  formatKiteCanonicalName,
  stripBrandPrefixFromModel,
  migrateProfilesToSharedQuiver,
} from "./quiver-storage.js";
import { saveState, getProfile } from "./storage.js";

/** @typedef {import('./storage.js').AppState} AppState */
/** @typedef {import('./quiver-storage.js').Kite} Kite */

/** @type {AppState|null} */
let quiverState = null;

/** @type {ReturnType<typeof fetchKiteSpecs> extends Promise<infer T> ? T : never|null} */
let pendingKiteSpec = null;

/** @type {string|null} */
let editingKiteId = null;

/** @type {string|null} */
let editingBoardId = null;

/**
 * @param {AppState} state
 * @param {(s: AppState) => void} [onChange]
 */
export function initQuiverModule(state, onChange) {
  quiverState = state;
  migrateProfilesToSharedQuiver(state);
  renderQuiverPanel();
  wireQuiverGlobalEvents(onChange);
}

/** @param {AppState} state */
export function refreshQuiverPanel(state) {
  quiverState = state;
  migrateProfilesToSharedQuiver(state);
  renderQuiverPanel();
}

function getQuiverRiderForSpecs() {
  if (!quiverState) return { weight: 75, sex: "unspecified" };
  const profile = getProfile(quiverState, quiverState.activeProfileId);
  if (!profile) return { weight: 75, sex: "unspecified" };
  return {
    weight: profile.weight,
    sex: profile.sex === "male" || profile.sex === "female" ? profile.sex : "unspecified",
  };
}

function persist(/** @type {(s: AppState) => void} */ onChange) {
  if (!quiverState) return;
  saveState(quiverState);
  onChange?.(quiverState);
}

function renderQuiverPanel() {
  const root = document.getElementById("quiver-main");
  if (!root || !quiverState) return;

  const kites = quiverState.quiver.kites;
  const boards = quiverState.quiver.boards;

  root.innerHTML = `
    <div class="quiver-layout">
      <div class="card card-slim">
        <h2>Kites</h2>
        <p class="hint hint-tight">Shared crew quiver — every rider's Plan and Now picks from all kites here (manufacturer chart + any sessions logged on each kite).</p>
        <button type="button" class="btn btn-primary btn-sm" id="quiver-add-kite-btn">+ Add kite</button>
      </div>
      <div id="quiver-kite-grid" class="quiver-kite-grid">${renderKiteCards(kites)}</div>

      <div class="card card-slim quiver-boards-card">
        <h2>Boards</h2>
        <button type="button" class="btn btn-primary btn-sm" id="quiver-add-board-btn">+ Add board</button>
        <ul id="quiver-board-list" class="gear-list quiver-board-list">${renderBoardList(boards)}</ul>
      </div>

      <div id="quiver-kite-editor" class="quiver-kite-editor hidden" aria-hidden="true"></div>
      <div id="quiver-board-editor" class="quiver-board-editor hidden" aria-hidden="true"></div>
    </div>`;

  root.querySelectorAll("[data-edit-kite]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeBoardEditor();
      openKiteEditor(btn.dataset.editKite);
    });
  });
  root.querySelectorAll("[data-rm-kite]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this kite from the quiver? Riders will be unlinked.")) return;
      removeQuiverKite(quiverState, btn.dataset.rmKite);
      closeKiteEditor();
      closeBoardEditor();
      renderQuiverPanel();
      persist(window.__quiverOnChange);
    });
  });

  document.getElementById("quiver-add-kite-btn")?.addEventListener("click", () => {
    closeBoardEditor();
    openKiteEditor(null);
  });
  document.getElementById("quiver-add-board-btn")?.addEventListener("click", () => {
    closeKiteEditor();
    openBoardEditor(null);
  });
  root.querySelectorAll("[data-edit-board]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeKiteEditor();
      openBoardEditor(btn.dataset.editBoard);
    });
  });
}

/** @param {import('./quiver-storage.js').Kite} n */
function kiteCardSubtitle(n) {
  const parts = [];
  if (n.label) parts.push(formatKiteCanonicalName(n.brand, n.model, n.size));
  if (n.style) parts.push(n.style);
  if (n.windRange) {
    parts.push(`${formatKt(n.windRange.min)}–${formatKt(n.windRange.max)} kt`);
  }
  return parts.filter(Boolean).join(" · ") || formatKiteCanonicalName(n.brand, n.model, n.size);
}

/** @param {Kite[]} kites */
function renderKiteCards(kites) {
  if (!kites.length) {
    return `<p class="hint quiver-empty">No kites yet. Add your first kite above.</p>`;
  }
  return kites
    .map((k) => {
      const n = normalizeKite(k);
      const title = escapeHtml(kiteDisplayTitle(n));
      const sub = escapeHtml(kiteCardSubtitle(n));
      const badges = [
        n.isSls ? `<span class="quiver-badge quiver-badge-sls">SLS</span>` : "",
        n.color ? `<span class="quiver-badge">${escapeHtml(n.color)}</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      const repairCount = n.repairs.length;
      const purchaseMeta = formatPurchaseMeta(n);
      return `<article class="quiver-kite-card" data-kite-id="${n.id}">
        <div class="quiver-kite-card-body">
          <h3 class="quiver-kite-card-title">${title}</h3>
          <p class="quiver-kite-card-sub">${sub}${purchaseMeta ? `<br><span class="quiver-purchase-meta">${escapeHtml(purchaseMeta)}</span>` : ""}</p>
          ${badges ? `<div class="quiver-kite-badges">${badges}</div>` : ""}
          ${repairCount ? `<p class="quiver-kite-repairs-hint">${repairCount} repair note${repairCount > 1 ? "s" : ""}</p>` : ""}
          <div class="quiver-kite-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-kite="${n.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-rm-kite="${n.id}">Remove</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

/** @param {import('./engine.js').Board[]} boards */
function renderBoardList(boards) {
  if (!boards.length) return `<li class="hint" style="list-style:none;padding:0">No boards yet.</li>`;
  return boards
    .map((raw) => {
      const b = normalizeBoard(raw);
      const size = b.sizeCm ? ` · ${b.sizeCm} cm` : "";
      const purchaseMeta = formatPurchaseMeta(b);
      return `<li class="gear-item quiver-board-item">
        <div class="gear-info">
          <strong>${escapeHtml(b.name)}</strong>
          <span>${BOARD_TYPE_LABELS[b.type]}${size}${purchaseMeta ? ` · ${escapeHtml(purchaseMeta)}` : ""}</span>
        </div>
        <div class="quiver-board-item-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-edit-board="${b.id}">Edit</button>
          <button type="button" class="btn btn-danger btn-sm" data-rm-board="${b.id}">Remove</button>
        </div>
      </li>`;
    })
    .join("");
}

/**
 * @param {{ yearManufactured?: number|null, purchaseDate?: string, purchasedFrom?: string }} item
 */
function formatPurchaseMeta(item) {
  const parts = [];
  if (item.yearManufactured) parts.push(String(item.yearManufactured));
  if (item.purchaseDate) parts.push(`Bought ${formatPurchaseDateLabel(item.purchaseDate)}`);
  if (item.purchasedFrom) parts.push(item.purchasedFrom);
  return parts.join(" · ");
}

/** @param {string} iso */
function formatPurchaseDateLabel(iso) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * @param {string} prefix
 * @param {{ yearManufactured?: number|null, purchaseDate?: string, purchasedFrom?: string }|null} item
 */
function renderPurchaseFieldsHtml(prefix, item) {
  const maxYear = new Date().getFullYear() + 1;
  return `
    <div class="field-row quiver-purchase-row">
      <div class="field">
        <label for="${prefix}-year-mfg">Year manufactured</label>
        <input type="number" id="${prefix}-year-mfg" min="1990" max="${maxYear}" step="1" placeholder="e.g. 2023" value="${item?.yearManufactured ?? ""}" />
      </div>
      <div class="field">
        <label for="${prefix}-purchase-date">Purchase date</label>
        <input type="date" id="${prefix}-purchase-date" value="${escapeAttr(item?.purchaseDate)}" />
      </div>
    </div>
    <div class="field field-flush">
      <label for="${prefix}-purchased-from">Purchased from</label>
      <input type="text" id="${prefix}-purchased-from" placeholder="Shop, dealer, or seller" value="${escapeAttr(item?.purchasedFrom)}" />
    </div>`;
}

/** @param {string} prefix */
function readPurchaseFields(prefix) {
  const yearRaw = document.getElementById(`${prefix}-year-mfg`)?.value;
  return {
    yearManufactured: yearRaw ? Number(yearRaw) : null,
    purchasedFrom: document.getElementById(`${prefix}-purchased-from`)?.value.trim() || "",
    purchaseDate: document.getElementById(`${prefix}-purchase-date`)?.value || "",
  };
}

/** @param {string|null} kiteId */
function openKiteEditor(kiteId) {
  closeBoardEditor();
  editingKiteId = kiteId;
  const panel = document.getElementById("quiver-kite-editor");
  if (!panel || !quiverState) return;

  const existing = kiteId
    ? quiverState.quiver.kites.find((k) => k.id === kiteId)
    : null;
  const k = existing ? normalizeKite(existing) : null;
  pendingKiteSpec = null;

  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  panel.innerHTML = `
    <div class="card quiver-editor-card">
      <h2 class="quiver-editor-title">${k ? "Edit kite" : "Add kite"}</h2>
      <form id="quiver-kite-form">
        <div class="quiver-catalog-picks field-row field-row-tight">
          <div class="field field-flush">
            <label for="qk-brand-select">Brand</label>
            <select id="qk-brand-select"><option value="">Please select…</option></select>
          </div>
          <div class="field field-flush">
            <label for="qk-model-select">Model</label>
            <select id="qk-model-select"><option value="">Please select…</option></select>
          </div>
          <div class="field field-flush">
            <label for="qk-size">Size (m)</label>
            <select id="qk-size"><option value="">Please select…</option></select>
          </div>
        </div>
        <p class="hint hint-tight">
          <button type="button" class="btn-link" id="qk-toggle-manual-brand">Can't find it in the list?</button>
        </p>
        <div id="qk-manual-brand" class="quiver-catalog-type field-row field-row-tight hidden" hidden>
          <input type="text" id="qk-brand" list="quiver-brand-list" placeholder="Brand" value="${escapeAttr(k?.brand)}" autocomplete="off" />
          <input type="text" id="qk-model" list="quiver-model-list" placeholder="Model" value="${escapeAttr(k?.model)}" autocomplete="off" />
        </div>
        <datalist id="quiver-brand-list"></datalist>
        <datalist id="quiver-model-list"></datalist>
        <div id="qk-spec-preview" class="spec-preview hidden"></div>
        <div class="field-row">
          <div class="field"><label>Label (your name for it)</label>
            <input type="text" id="qk-label" placeholder="e.g. Red bag / Dad's 8m" value="${escapeAttr(k?.label)}" /></div>
          <div class="field"><label>Colour</label>
            <input type="text" id="qk-color" placeholder="e.g. red/black" value="${escapeAttr(k?.color)}" /></div>
        </div>
        <label class="check-inline"><input type="checkbox" id="qk-sls" ${k?.isSls ? "checked" : ""} /> SLS model</label>
        ${renderPurchaseFieldsHtml("qk", k)}
        <div class="field"><label>General notes</label>
          <textarea id="qk-notes" rows="2" placeholder="e.g. bag zip sticky, bridles 2024">${escapeHtml(k?.notes || "")}</textarea></div>
        <div class="field">
          <label>Repairs</label>
          <div id="qk-repairs-list" class="quiver-repairs-list"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="qk-add-repair">+ Add repair note</button>
        </div>
        <div class="quiver-editor-actions">
          <button type="submit" class="btn btn-primary">${k ? "Save kite" : "Add to quiver"}</button>
          <button type="button" class="btn btn-cancel" id="quiver-editor-close">Cancel</button>
        </div>
      </form>
    </div>`;

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  wireKiteEditor(k);
}

function closeKiteEditor() {
  editingKiteId = null;
  pendingKiteSpec = null;
  const panel = document.getElementById("quiver-kite-editor");
  if (panel) {
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = "";
  }
}

/** @param {string|null} boardId */
function openBoardEditor(boardId) {
  editingBoardId = boardId;
  const panel = document.getElementById("quiver-board-editor");
  if (!panel || !quiverState) return;

  const existing = boardId
    ? quiverState.quiver.boards.find((b) => b.id === boardId)
    : null;
  const b = existing ? normalizeBoard(existing) : null;

  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  panel.innerHTML = `
    <div class="card quiver-editor-card">
      <h2 class="quiver-editor-title">${b ? "Edit board" : "Add board"}</h2>
      <form id="quiver-board-form">
        <div class="field-row">
          <div class="field">
            <label for="qb-type">Type</label>
            <select id="qb-type" required>${Object.entries(BOARD_TYPE_LABELS)
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${b?.type === v ? "selected" : ""}>${l}</option>`
              )
              .join("")}</select>
          </div>
          <div class="field">
            <label for="qb-size">Size (cm)</label>
            <input type="number" id="qb-size" min="100" max="200" placeholder="Optional" value="${b?.sizeCm ?? ""}" />
          </div>
        </div>
        <div class="field field-flush">
          <label for="qb-name">Name</label>
          <input type="text" id="qb-name" placeholder="e.g. 138 freestyle" value="${escapeAttr(b?.name)}" required />
        </div>
        ${renderPurchaseFieldsHtml("qb", b)}
        <div class="quiver-editor-actions">
          <button type="submit" class="btn btn-primary">${b ? "Save board" : "Add to quiver"}</button>
          <button type="button" class="btn btn-cancel" id="quiver-board-editor-close">Cancel</button>
        </div>
      </form>
    </div>`;

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  wireBoardEditor(b);
}

function closeBoardEditor() {
  editingBoardId = null;
  const panel = document.getElementById("quiver-board-editor");
  if (panel) {
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = "";
  }
}

/** @param {import('./engine.js').Board|null} b */
function wireBoardEditor(b) {
  document.getElementById("quiver-board-editor-close")?.addEventListener("click", closeBoardEditor);
  document.getElementById("quiver-board-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = document.getElementById("qb-type")?.value;
    const name = document.getElementById("qb-name")?.value.trim();
    if (!type || !name) {
      alert("Enter board type and name.");
      return;
    }
    const sizeRaw = document.getElementById("qb-size")?.value;
    upsertQuiverBoard(quiverState, {
      id: b?.id || createId(),
      type,
      name,
      sizeCm: sizeRaw ? Number(sizeRaw) : null,
      ...readPurchaseFields("qb"),
    });
    closeBoardEditor();
    renderQuiverPanel();
    persist(window.__quiverOnChange);
  });
}

/** @param {Kite|null} k */
function wireKiteEditor(k) {
  const repairs = k?.repairs ? [...k.repairs] : [];
  const repairsList = document.getElementById("qk-repairs-list");

  const renderRepairs = () => {
    if (!repairsList) return;
    if (!repairs.length) {
      repairsList.innerHTML = `<p class="hint hint-tight">No repair notes yet.</p>`;
      return;
    }
    repairsList.innerHTML = repairs
      .map(
        (r, i) => `<div class="quiver-repair-row">
          <input type="date" data-repair-date="${i}" value="${escapeAttr(r.date?.slice(0, 10))}" />
          <input type="text" data-repair-note="${i}" value="${escapeAttr(r.note)}" placeholder="e.g. leading edge patch" />
          <button type="button" class="btn btn-danger btn-sm" data-repair-rm="${i}">×</button>
        </div>`
      )
      .join("");
    repairsList.querySelectorAll("[data-repair-rm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        repairs.splice(Number(btn.dataset.repairRm), 1);
        renderRepairs();
      });
    });
    repairsList.querySelectorAll("[data-repair-date]").forEach((el) => {
      el.addEventListener("change", () => {
        repairs[Number(el.dataset.repairDate)].date = el.value;
      });
    });
    repairsList.querySelectorAll("[data-repair-note]").forEach((el) => {
      el.addEventListener("input", () => {
        repairs[Number(el.dataset.repairNote)].note = el.value;
      });
    });
  };
  renderRepairs();

  document.getElementById("qk-add-repair")?.addEventListener("click", () => {
    repairs.push({ id: createId(), date: new Date().toISOString().slice(0, 10), note: "" });
    renderRepairs();
  });

  document.getElementById("quiver-editor-close")?.addEventListener("click", closeKiteEditor);

  const brandEl = document.getElementById("qk-brand");
  const modelEl = document.getElementById("qk-model");
  const brandSelect = document.getElementById("qk-brand-select");
  const modelSelect = document.getElementById("qk-model-select");
  const sizeEl = document.getElementById("qk-size");
  const specPreview = document.getElementById("qk-spec-preview");

  function fillSelect(select, options, placeholder, current) {
    if (!select) return;
    const opts = options
      .map(
        (o) =>
          `<option value="${escapeAttr(o)}" ${o === current ? "selected" : ""}>${escapeHtml(o)}</option>`
      )
      .join("");
    select.innerHTML = `<option value="">${placeholder}</option>${opts}`;
  }

  function readBrandModelFromForm() {
    const brand = (brandSelect?.value || brandEl?.value || "").trim();
    const modelRaw = (modelSelect?.value || modelEl?.value || "").trim();
    const model = stripBrandPrefixFromModel(brand, modelRaw);
    return { brand, model };
  }

  function syncBrandFromSelect() {
    if (!brandSelect) return;
    if (brandSelect.value) {
      fillSelect(modelSelect, getModels(brandSelect.value), "Please select…", modelSelect?.value || "");
      const bl = document.getElementById("quiver-model-list");
      if (bl) {
        bl.innerHTML = getModels(brandSelect.value)
          .map((m) => `<option value="${escapeHtml(m)}">`)
          .join("");
      }
    }
  }

  function refreshSizeOptions(brand, model, selectedSize) {
    if (!sizeEl) return;
    const sizes = getSizes(brand, model);
    const opts = sizes
      .map(
        (s) =>
          `<option value="${s}" ${selectedSize === s ? "selected" : ""}>${s}m</option>`
      )
      .join("");
    sizeEl.innerHTML = `<option value="">Please select…</option>${opts}`;
  }

  async function lookupSpecs() {
    const { brand, model } = readBrandModelFromForm();
    const size = Number(sizeEl.value);
    if (!brand || !model || !size) return;
    specPreview.classList.remove("hidden");
    specPreview.textContent = "Looking up specs…";
    try {
      const rider = getQuiverRiderForSpecs();
      pendingKiteSpec = await fetchKiteSpecs(brand, model, size, rider);
      const previewName = formatKiteCanonicalName(
        pendingKiteSpec.brand,
        pendingKiteSpec.model,
        pendingKiteSpec.size
      );
      specPreview.innerHTML = `<strong>${escapeHtml(previewName)}</strong> · ${formatKt(pendingKiteSpec.windRange.min)}-${formatKt(pendingKiteSpec.windRange.max)} kt`;
    } catch (err) {
      specPreview.textContent = err.message;
      pendingKiteSpec = {
        brand,
        model,
        size,
        type: "hybrid",
        style: "",
        windRange: { min: 12, ideal: 18, max: 26 },
        weightRef: 75,
        source: "manual",
      };
    }
  }

  loadCatalog().then(() => {
    const brands = getBrands();
    fillSelect(brandSelect, brands, "Please select…", k?.brand || "");
    const bl = document.getElementById("quiver-brand-list");
    if (bl) bl.innerHTML = brands.map((b) => `<option value="${escapeHtml(b)}">`).join("");

    if (k?.brand) {
      const inCatalog = brands.includes(k.brand);
      if (inCatalog) brandSelect.value = k.brand;
      else {
        const manual = document.getElementById("qk-manual-brand");
        if (manual) {
          manual.hidden = false;
          manual.classList.remove("hidden");
        }
        if (brandEl) brandEl.value = k.brand;
        if (modelEl) modelEl.value = k.model || "";
      }
      fillSelect(modelSelect, getModels(k.brand), "Please select…", k.model || "");
      const ml = document.getElementById("quiver-model-list");
      if (ml) {
        ml.innerHTML = getModels(k.brand)
          .map((m) => `<option value="${escapeHtml(m)}">`)
          .join("");
      }
      if (k.model) {
        if (getModels(k.brand).includes(k.model)) modelSelect.value = k.model;
        refreshSizeOptions(k.brand, k.model, k.size);
      }
      pendingKiteSpec = {
        brand: k.brand,
        model: k.model,
        size: k.size,
        type: k.type,
        style: k.style,
        windRange: k.windRange,
        weightRef: k.weightRef,
        source: k.specsSource,
      };
    }
  });

  document.getElementById("qk-toggle-manual-brand")?.addEventListener("click", () => {
    const manual = document.getElementById("qk-manual-brand");
    if (!manual) return;
    const show = manual.hidden;
    manual.hidden = !show;
    manual.classList.toggle("hidden", !show);
  });

  brandSelect?.addEventListener("change", () => {
    pendingKiteSpec = null;
    syncBrandFromSelect();
    modelSelect.value = "";
    sizeEl.innerHTML = '<option value="">Please select…</option>';
  });

  modelSelect?.addEventListener("change", () => {
    pendingKiteSpec = null;
    refreshSizeOptions(brandSelect?.value || brandEl?.value || "", modelSelect.value, null);
  });

  brandEl?.addEventListener("input", () => {
    pendingKiteSpec = null;
    const b = brandEl.value.trim();
    if (getBrands().includes(b)) brandSelect.value = b;
    else brandSelect.value = "";
    document.getElementById("quiver-model-list").innerHTML = getModels(b)
      .map((m) => `<option value="${escapeHtml(m)}">`)
      .join("");
    fillSelect(modelSelect, getModels(b), "Please select…", "");
    sizeEl.innerHTML = '<option value="">Please select…</option>';
  });

  modelEl?.addEventListener("input", () => {
    pendingKiteSpec = null;
    const b = brandEl.value.trim();
    const m = modelEl.value.trim();
    if (getModels(b).includes(m)) modelSelect.value = m;
    else modelSelect.value = "";
    refreshSizeOptions(b, m, null);
  });

  sizeEl?.addEventListener("change", () => {
    void lookupSpecs();
  });

  document.getElementById("quiver-kite-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const { brand, model } = readBrandModelFromForm();
    const size = Number(sizeEl.value) || pendingKiteSpec?.size || k?.size;
    if (!brand || !model || !size) {
      alert("Choose brand, model, and size from the lists (or use “Can't find it in the list?”).");
      return;
    }
    const spec = pendingKiteSpec || {
      brand,
      model,
      size,
      type: k?.type || "hybrid",
      style: k?.style || "",
      windRange: k?.windRange,
      weightRef: k?.weightRef,
      source: k?.specsSource || "manual",
    };

    const saved = upsertQuiverKite(quiverState, {
      id: k?.id || createId(),
      brand: spec.brand,
      model: spec.model,
      size: spec.size,
      name: formatKiteCanonicalName(spec.brand, spec.model, spec.size),
      type: spec.type,
      style: spec.style,
      windRange: spec.windRange,
      weightRef: spec.weightRef,
      specsSource: spec.source,
      label: document.getElementById("qk-label").value.trim(),
      color: document.getElementById("qk-color").value.trim(),
      isSls: document.getElementById("qk-sls").checked,
      notes: document.getElementById("qk-notes").value.trim(),
      repairs: repairs.filter((r) => r.note.trim()),
      ...readPurchaseFields("qk"),
    });

    closeKiteEditor();
    renderQuiverPanel();
    persist(window.__quiverOnChange);
    void saved;
  });
}

/** @type {boolean} */
let quiverEventsWired = false;

function wireQuiverGlobalEvents(/** @type {(s: AppState) => void} */ onChange) {
  window.__quiverOnChange = onChange;
  if (quiverEventsWired) return;
  quiverEventsWired = true;

  const root = document.getElementById("quiver-main");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-board]");
    if (!rm || !quiverState) return;
    removeQuiverBoard(quiverState, rm.dataset.rmBoard);
    closeBoardEditor();
    saveState(quiverState);
    onChange?.(quiverState);
    renderQuiverPanel();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str ?? "").replace(/"/g, "&quot;");
}
