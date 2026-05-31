/** Lightweight Leaflet map for precise launch pin placement */

/** @type {import('leaflet').Map|null} */
let map = null;
/** @type {import('leaflet').Marker|null} */
let marker = null;
let leafletPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-leaflet", "1");
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error("Could not load map library"));
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

/**
 * @param {string} containerId
 * @param {number} lat
 * @param {number} lon
 * @param {(lat: number, lon: number) => void} onMove
 * @param {number} [zoom]
 */
export async function initSpotMap(containerId, lat, lon, onMove, zoom = 15) {
  const L = await loadLeaflet();
  const container = document.getElementById(containerId);
  if (!container) return;

  destroySpotMap();

  map = L.map(container, { scrollWheelZoom: true }).setView([lat, lon], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  marker = L.marker([lat, lon], { draggable: true }).addTo(map);

  marker.on("dragend", () => {
    const pos = marker.getLatLng();
    onMove(roundCoord(pos.lat), roundCoord(pos.lng));
  });

  map.on("click", (e) => {
    marker.setLatLng(e.latlng);
    onMove(roundCoord(e.latlng.lat), roundCoord(e.latlng.lng));
  });

  setTimeout(() => map?.invalidateSize(), 100);
}

/** @param {number} lat @param {number} lon @param {number} [zoom] */
export function setSpotMapPosition(lat, lon, zoom) {
  if (!map || !marker) return;
  marker.setLatLng([lat, lon]);
  if (zoom != null) map.setView([lat, lon], zoom);
  else map.panTo([lat, lon]);
}

export function destroySpotMap() {
  if (map) {
    map.remove();
    map = null;
    marker = null;
  }
}

export function roundCoord(n) {
  return Math.round(n * 1e6) / 1e6;
}
