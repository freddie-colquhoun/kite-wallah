/**
 * Display suitability notes with ✓ / – / ✕ and drop lines already shown above the card.
 */

/** @typedef {'good'|'bad'|'neutral'} FactorImpact */

const ICON = { good: "✓", bad: "✕", neutral: "–" };
const ARIA = {
  good: "In favour",
  bad: "Against",
  neutral: "Neutral",
};

/**
 * @param {string} note
 * @returns {FactorImpact}
 */
export function classifyFactorNote(note) {
  const n = note.toLowerCase();

  if (
    /within the safe launch window|inside your tide launch window|calibration suggests|you've logged .* session\(s\) near this wind/i.test(
      note
    )
  ) {
    return "good";
  }

  if (
    /offshore for|is offshore|marginal at|outside your tide launch|outside the typical|below the typical band|above what's comfortable|below 10 kt is usually not rideable|tide level is a poor|tide is marginal for your spot preference|wave conditions are demanding|very gusty:|above 35 kt is expert|dangerous|do not ride|not rideable at high tide|launch not advised/i.test(
      n
    )
  ) {
    return "bad";
  }

  if (
    /spot notes mention offshore|double-check wind direction|local note mentions tide|moderate gustiness|light-wind session|gusty:|launch:|local knowledge:/i.test(
      n
    )
  ) {
    return "neutral";
  }

  return "neutral";
}

/**
 * @param {string[]} notes
 * @param {object} [opts]
 * @param {boolean} [opts.compact] Now tab card (tide/launch already in spot header)
 * @param {string} [opts.tideSummary] Full tide line shown above results
 * @param {string|null} [opts.tideLaunchNote] Shown in tide launch warning banner
 * @param {boolean} [opts.launchWarnShown]
 */
export function filterResultNotes(notes, opts = {}) {
  const { compact = false, tideSummary = "", tideLaunchNote = null, launchWarnShown = false } =
    opts;

  const seen = new Set();
  /** @type {string[]} */
  const out = [];

  for (const note of notes) {
    let skip = false;

    if (compact) {
      if (/^Tide \(/i.test(note) || /Next: (High|Low)/i.test(note)) skip = true;
      if (tideSummary && note.includes(tideSummary.slice(0, 40))) skip = true;
      if (/Inside your tide launch window/i.test(note)) skip = true;
    }

    if (tideLaunchNote && note.trim() === tideLaunchNote.trim()) skip = true;

    if (launchWarnShown && /is marginal at .* safe directions/i.test(note)) skip = true;

    const key = note.trim().toLowerCase();
    if (seen.has(key)) skip = true;

    if (!skip) {
      seen.add(key);
      out.push(note);
    }
  }

  if (out.some((n) => /below the typical band/i.test(n))) {
    return out.filter((n) => !/below 10 kt is usually not rideable/i.test(n));
  }

  return out;
}

/**
 * @param {string[]} notes
 * @param {(s: string) => string} escapeHtml
 * @param {Parameters<typeof filterResultNotes>[1]} [opts]
 */
export function renderResultNotesHtml(notes, escapeHtml, opts = {}) {
  const filtered = filterResultNotes(notes, opts);
  if (!filtered.length) return "";

  const items = filtered
    .map((note) => {
      const impact = classifyFactorNote(note);
      return `<li class="result-note result-note--${impact}">
        <span class="result-note-icon" aria-label="${ARIA[impact]}">${ICON[impact]}</span>
        <span class="result-note-text">${escapeHtml(note)}</span>
      </li>`;
    })
    .join("");

  return `<ul class="result-notes">${items}</ul>`;
}
