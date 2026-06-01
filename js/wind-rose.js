/**
 * Clickable 8-point wind rose for spot safe / offshore sectors.
 */

import { COMPASS } from "./spots-storage.js";

const ANGLE = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/**
 * @param {HTMLElement} container
 * @param {{ safe?: string[], offshore?: string[] }} initial
 */
export function mountWindRosePair(container, initial = {}) {
  const safe = [...(initial.safe || [])];
  const offshore = [...(initial.offshore || [])];

  container.innerHTML = `
    <div class="wind-rose-row">
      <div class="wind-rose-block">
        <p class="wind-rose-heading">Safe to launch</p>
        <p class="hint hint-tight">Tap wind directions you can launch in.</p>
        <div class="wind-rose wind-rose--safe" data-rose="safe" role="group" aria-label="Safe wind directions"></div>
        <p class="wind-rose-summary" id="wind-rose-safe-summary" aria-live="polite"></p>
      </div>
      <div class="wind-rose-block">
        <p class="wind-rose-heading">Offshore (dangerous)</p>
        <p class="hint hint-tight">Tap directions that blow offshore at this spot.</p>
        <div class="wind-rose wind-rose--offshore" data-rose="offshore" role="group" aria-label="Offshore wind directions"></div>
        <p class="wind-rose-summary" id="wind-rose-offshore-summary" aria-live="polite"></p>
      </div>
    </div>`;

  const safeEl = container.querySelector('[data-rose="safe"]');
  const offEl = container.querySelector('[data-rose="offshore"]');
  if (safeEl) buildRose(safeEl, safe);
  if (offEl) buildRose(offEl, offshore);
  updateSummaries(container);
}

/**
 * @param {HTMLElement} roseEl
 * @param {string[]} selected
 */
function buildRose(roseEl, selected) {
  roseEl.innerHTML = `<span class="wind-rose-center" aria-hidden="true">Launch</span>`;
  for (const dir of COMPASS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wind-rose-sector" + (selected.includes(dir) ? " is-on" : "");
    btn.dataset.dir = dir;
    btn.style.setProperty("--rose-angle", `${ANGLE[dir]}deg`);
    btn.textContent = dir;
    btn.setAttribute("aria-pressed", selected.includes(dir) ? "true" : "false");
    btn.addEventListener("click", () => {
      btn.classList.toggle("is-on");
      btn.setAttribute("aria-pressed", btn.classList.contains("is-on") ? "true" : "false");
      const root = roseEl.closest(".wind-rose-row")?.parentElement;
      if (root) updateSummaries(root);
    });
    roseEl.appendChild(btn);
  }
}

/**
 * @param {HTMLElement} root
 */
function updateSummaries(root) {
  const safe = getRoseDirections(root, "safe");
  const off = getRoseDirections(root, "offshore");
  const safeSum = root.querySelector("#wind-rose-safe-summary");
  const offSum = root.querySelector("#wind-rose-offshore-summary");
  if (safeSum) {
    safeSum.textContent = safe.length ? `Selected: ${safe.join(", ")}` : "None selected — pick at least one safe direction.";
  }
  if (offSum) {
    offSum.textContent = off.length ? `Selected: ${off.join(", ")}` : "None marked offshore.";
  }
}

/**
 * @param {HTMLElement} root
 * @param {'safe'|'offshore'} mode
 * @returns {string[]}
 */
export function getRoseDirections(root, mode) {
  const rose = root.querySelector(`[data-rose="${mode}"]`);
  if (!rose) return [];
  return [...rose.querySelectorAll(".wind-rose-sector.is-on")].map((b) => b.dataset.dir);
}

/**
 * @param {HTMLElement} root
 * @param {string[]} safe
 * @param {string[]} offshore
 */
export function setWindRoseSelections(root, safe, offshore) {
  root.querySelectorAll('[data-rose="safe"] .wind-rose-sector').forEach((btn) => {
    const on = safe.includes(btn.dataset.dir);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  root.querySelectorAll('[data-rose="offshore"] .wind-rose-sector').forEach((btn) => {
    const on = offshore.includes(btn.dataset.dir);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  updateSummaries(root);
}
