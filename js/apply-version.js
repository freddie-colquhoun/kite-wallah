import { APP_VERSION } from "./version.js";

for (const el of document.querySelectorAll("[data-app-version]")) {
  el.textContent = `v${APP_VERSION}`;
}
