/**
 * Kite feel slider — ordered steps from underpowered to overpowered.
 * Stored values extend legacy SessionFeeling ids for Plan scoring.
 */

/** @typedef {import('./calibration.js').SessionFeeling} SessionFeeling */

/** @typedef {{ id: SessionFeeling, label: string, tag: 'bad'|'warn'|'good' }} KiteFeelStep */

/** @type {KiteFeelStep[]} */
export const KITE_FEEL_STEPS = [
  { id: "couldnt-ride", label: "Couldn't get going / stay upwind", tag: "bad" },
  { id: "very-underpowered", label: "Very underpowered", tag: "bad" },
  { id: "underpowered-rideable", label: "Underpowered but still rideable", tag: "warn" },
  { id: "slightly-underpowered", label: "A little underpowered", tag: "warn" },
  { id: "just-right", label: "Perfect", tag: "good" },
  { id: "comfortable", label: "Comfortable — would use again", tag: "good" },
  { id: "slightly-overpowered", label: "A little powered up", tag: "warn" },
  { id: "overpowered-rideable", label: "Overpowered but still manageable", tag: "warn" },
  { id: "very-overpowered", label: "Very overpowered / hard to hold down", tag: "bad" },
];

/** Legacy session feelings → nearest slider step */
const LEGACY_FEELING_INDEX = {
  "too-small": 2,
  "too-big": 8,
};

/**
 * @param {string} [feeling]
 * @returns {number}
 */
export function feelingStepIndex(feeling) {
  if (!feeling) return 4;
  if (feeling in LEGACY_FEELING_INDEX) {
    return LEGACY_FEELING_INDEX[/** @type {keyof typeof LEGACY_FEELING_INDEX} */ (feeling)];
  }
  const idx = KITE_FEEL_STEPS.findIndex((s) => s.id === feeling);
  return idx >= 0 ? idx : 4;
}

/** @param {number} index */
export function feelingAtStep(index) {
  const i = Math.max(0, Math.min(KITE_FEEL_STEPS.length - 1, Math.round(index)));
  return KITE_FEEL_STEPS[i];
}

/**
 * @param {string} prefix e.g. "sess" or "sess-edit"
 * @param {string} [initialFeeling]
 */
export function renderFeelingSliderHtml(prefix, initialFeeling) {
  const idx = feelingStepIndex(initialFeeling);
  const step = feelingAtStep(idx);
  const max = KITE_FEEL_STEPS.length - 1;
  return `<div class="field field-feeling-slider field-flush">
    <label for="${prefix}-feeling-slider">How the kite felt</label>
    <p class="feeling-slider-current" id="${prefix}-feeling-label">${step.label}</p>
    <input
      type="range"
      id="${prefix}-feeling-slider"
      class="feeling-slider"
      min="0"
      max="${max}"
      step="1"
      value="${idx}"
      aria-valuemin="0"
      aria-valuemax="${max}"
      aria-valuenow="${idx}"
      aria-labelledby="${prefix}-feeling-label"
    />
    <input type="hidden" id="${prefix}-feeling" value="${step.id}" />
  </div>`;
}

/**
 * Wire range input → label + hidden feeling id.
 * @param {string} prefix
 */
export function wireFeelingSlider(prefix) {
  const slider = document.getElementById(`${prefix}-feeling-slider`);
  const label = document.getElementById(`${prefix}-feeling-label`);
  const hidden = document.getElementById(`${prefix}-feeling`);
  if (!slider || !label || !hidden) return;

  const sync = () => {
    const step = feelingAtStep(Number(slider.value));
    label.textContent = step.label;
    hidden.value = step.id;
    slider.setAttribute("aria-valuenow", slider.value);
  };

  slider.addEventListener("input", sync);
  sync();
}

/** @param {string} [feeling] */
export function feelingTagFor(feeling) {
  return feelingAtStep(feelingStepIndex(feeling)).tag;
}
