/** @typedef {import('./calibration.js').CalibrationEntry} CalibrationEntry */

/** @param {CalibrationEntry} entry */
export function sessionStartIso(entry) {
  return entry.sessionStartAt || entry.sessionAt || null;
}

/** @param {CalibrationEntry} entry */
export function sessionEndIso(entry) {
  return entry.sessionEndAt || null;
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {string} [time] HH:mm
 */
export function buildSessionIso(date, time) {
  if (!date) return null;
  if (!time) return `${date}T12:00:00`;
  return `${date}T${time}:00`;
}

/**
 * @param {string|null} startIso
 * @param {string|null} endIso
 * @returns {string|null}
 */
export function formatSessionDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * @param {CalibrationEntry} entry
 */
export function formatSessionDateTimeLine(entry) {
  const start = sessionStartIso(entry);
  if (!start) return "No date";
  const startD = new Date(start);
  if (Number.isNaN(startD.getTime())) return "No date";

  const datePart = startD.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const startTime = startD.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const endIso = sessionEndIso(entry);
  if (!endIso) return `${datePart} · from ${startTime}`;

  const endD = new Date(endIso);
  if (Number.isNaN(endD.getTime())) return `${datePart} · from ${startTime}`;

  const endTime = endD.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const dur = formatSessionDuration(start, endIso);
  return dur
    ? `${datePart} · ${startTime}-${endTime} (${dur})`
    : `${datePart} · ${startTime}-${endTime}`;
}
