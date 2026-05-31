/**
 * Plan tab  ·  calendar day picker: click start + click end, or drag across range.
 */

const FORECAST_DAY_COUNT = 7;

/** @param {string} dateKey YYYY-MM-DD */
function parseDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** @param {Date} d */
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {number} count */
export function getPlanCalendarDates(count = FORECAST_DAY_COUNT) {
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    dates.push(toDateKey(d));
  }
  return dates;
}

/** @param {HTMLElement} root */
export function getPlanCalendarSelection(root) {
  if (!root) return [];
  return [...root.querySelectorAll(".plan-cal-day.is-selected")]
    .map((el) => el.dataset.date)
    .filter(Boolean)
    .sort();
}

/**
 * @param {HTMLElement} root
 * @param {string[]} dateKeys
 */
export function setPlanCalendarSelection(root, dateKeys) {
  if (!root) return;
  const set = new Set(dateKeys);
  const sorted = [...set].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  root.querySelectorAll(".plan-cal-day").forEach((el) => {
    const on = set.has(el.dataset.date);
    el.classList.toggle("is-selected", on);
    el.classList.toggle("is-range-start", on && !!first && el.dataset.date === first);
    el.classList.toggle("is-range-end", on && !!last && el.dataset.date === last);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/**
 * @param {HTMLElement} container
 * @param {string[]} [initialSelected]
 */
export function initPlanCalendar(container, initialSelected = []) {
  if (!container) return;

  const dates = getPlanCalendarDates();
  const first = parseDateKey(dates[0]);
  const last = parseDateKey(dates[dates.length - 1]);
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const monthLabel =
    first.getMonth() === last.getMonth()
      ? monthFmt.format(first)
      : `${monthFmt.format(first)} - ${monthFmt.format(last)}`;

  const dowFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const dayFmt = new Intl.DateTimeFormat(undefined, { day: "numeric" });
  const todayKey = toDateKey(new Date());

  container.className = "plan-calendar";
  container.innerHTML = `
    <p class="plan-calendar-hint">Click first day, then last  ·  or drag across the row.</p>
    <div class="plan-calendar-header">
      <span class="plan-calendar-month">${monthLabel}</span>
      <span class="plan-calendar-range">Next ${dates.length} days</span>
    </div>
    <div class="plan-calendar-grid" role="group" aria-label="Select forecast days">
      ${dates
        .map((dateKey, idx) => {
          const d = parseDateKey(dateKey);
          const isToday = dateKey === todayKey;
          return `<button type="button" class="plan-cal-day" data-date="${dateKey}" data-idx="${idx}" aria-pressed="false">
            <span class="plan-cal-dow">${dowFmt.format(d)}</span>
            <span class="plan-cal-num">${dayFmt.format(d)}</span>
            ${isToday ? '<span class="plan-cal-today">Today</span>' : ""}
          </button>`;
        })
        .join("")}
    </div>`;

  let dragActive = false;
  let dragAnchorIdx = -1;
  let moved = false;
  /** @type {number|null} first click when not dragging */
  let clickAnchorIdx = null;

  function applyRange(fromIdx, toIdx) {
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    const keys = [];
    for (let i = lo; i <= hi; i++) keys.push(dates[i]);
    setPlanCalendarSelection(container, keys);
  }

  function idxFromEl(el) {
    return Number(el?.dataset?.idx ?? -1);
  }

  function handleClickSelect(idx) {
    if (clickAnchorIdx === null) {
      clickAnchorIdx = idx;
      applyRange(idx, idx);
    } else {
      applyRange(clickAnchorIdx, idx);
      clickAnchorIdx = null;
    }
  }

  container.querySelectorAll(".plan-cal-day").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragActive = true;
      moved = false;
      dragAnchorIdx = idxFromEl(btn);
    });

    btn.addEventListener("mouseenter", () => {
      if (!dragActive) return;
      moved = true;
      applyRange(dragAnchorIdx, idxFromEl(btn));
    });

    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      dragActive = true;
      moved = false;
      dragAnchorIdx = idxFromEl(btn);
    }, { passive: false });
  });

  const endPointer = (target) => {
    if (!dragActive) return;
    const btn = target?.closest?.(".plan-cal-day");
    const idx = idxFromEl(btn);
    if (!moved && btn && idx >= 0) {
      handleClickSelect(idx);
    } else {
      clickAnchorIdx = null;
    }
    dragActive = false;
  };

  container.addEventListener("mouseup", (e) => endPointer(e.target));
  container.addEventListener("mouseleave", () => {
    if (dragActive && moved) clickAnchorIdx = null;
    dragActive = false;
  });
  document.addEventListener("mouseup", () => {
    dragActive = false;
  });

  container.addEventListener(
    "touchmove",
    (e) => {
      if (!dragActive) return;
      const t = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY)?.closest?.(".plan-cal-day");
      if (el) {
        moved = true;
        applyRange(dragAnchorIdx, idxFromEl(el));
      }
    },
    { passive: true }
  );

  container.addEventListener("touchend", (e) => endPointer(e.target));

  if (initialSelected.length) setPlanCalendarSelection(container, initialSelected);
}
