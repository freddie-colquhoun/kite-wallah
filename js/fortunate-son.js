/**
 * In-app playback for GO-day Fortunate Son (bundled MP3).
 */

const ANTHEM_SRC = new URL("../audio/fortunate-son.mp3", import.meta.url).href;

/** @type {HTMLAudioElement|null} */
let audio = null;

function dispatchAnthemState() {
  window.dispatchEvent(new CustomEvent("fortunate-son-state"));
}

function getAnthemAudio() {
  if (!audio) {
    audio = new Audio(ANTHEM_SRC);
    audio.preload = "auto";
    audio.addEventListener("ended", dispatchAnthemState);
    audio.addEventListener("pause", dispatchAnthemState);
    audio.addEventListener("play", dispatchAnthemState);
  }
  return audio;
}

/** @returns {boolean} */
export function isFortunateSonPlaying() {
  return Boolean(audio && !audio.paused && !audio.ended);
}

/** Play or pause the bundled track. @returns {Promise<void>} */
export async function playFortunateSon() {
  const el = getAnthemAudio();
  if (!el.paused && !el.ended) {
    el.pause();
    return;
  }
  if (el.ended) el.currentTime = 0;
  try {
    await el.play();
  } catch (err) {
    console.warn("Fortunate Son playback failed", err);
  }
}

/** Stop playback and reset. */
export function stopFortunateSon() {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}
