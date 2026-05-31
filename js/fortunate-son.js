/** Opens Fortunate Son on YouTube (user taps Go-day button). */

const YOUTUBE_URL =
  "https://www.youtube.com/watch?v=ZWijx_AgPiA&list=RDZWijx_AgPiA&start_radio=1";

export function playFortunateSon() {
  window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
}
