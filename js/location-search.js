/** @typedef {Object} SearchResult
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string} label
 * @property {'kitesurf'|'photon'|'open-meteo'} source
 * @property {string} [badge]
 * @property {object} [defaults]
 */

let kitesurfCatalog = null;

function getCatalogUrl() {
  return new URL("../data/kitesurf-spots.json", import.meta.url).href;
}

async function loadKitesurfCatalog() {
  if (kitesurfCatalog) return kitesurfCatalog;
  const res = await fetch(getCatalogUrl());
  if (!res.ok) throw new Error(`Could not load kitesurf spots catalog (${res.status})`);
  kitesurfCatalog = await res.json();
  return kitesurfCatalog;
}

function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(str) {
  return normalize(str).split(" ").filter(Boolean);
}

function tokenScore(query, text) {
  const qTokens = tokens(query);
  const tTokens = tokens(text);
  if (!qTokens.length || !tTokens.length) return 0;
  let matched = 0;
  for (const qt of qTokens) {
    if (tTokens.some((tt) => tt === qt || tt.startsWith(qt) || qt.startsWith(tt))) matched++;
  }
  return matched / qTokens.length;
}

/** @param {string} query @param {object[]} catalog */
function searchKitesurfCatalog(query, catalog) {
  const q = normalize(query);
  if (q.length < 2) return [];

  /** @type {SearchResult[]} */
  const results = [];

  for (const spot of catalog) {
    const names = [spot.name, ...(spot.aliases || [])];
    let score = 0;
    for (const n of names) {
      const norm = normalize(n);
      if (norm === q) score = Math.max(score, 100);
      else if (norm.includes(q) || q.includes(norm)) score = Math.max(score, 85);
      else score = Math.max(score, tokenScore(q, n) * 70);
    }
    if (score < 40) continue;

    results.push({
      name: spot.name,
      lat: spot.lat,
      lon: spot.lon,
      label: `${spot.name}  ·  kitesurf launch${spot.region ? ` · ${spot.region}` : ""}`,
      source: "kitesurf",
      badge: "Kitesurf spot",
      score,
      defaults: {
        safeDirections: spot.safeDirections,
        offshoreDirections: spot.offshoreDirections,
        waterType: spot.waterType,
        localKnowledge: spot.localKnowledge,
        launchNotes: spot.launchNotes,
        tideAccessRule: spot.tideAccessRule,
        tideWindowHours: spot.tideWindowHours,
      },
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/** @param {string} query @param {{ ukOnly?: boolean }} [opts] */
async function searchPhoton(query, opts = {}) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  if (opts.ukOnly) url.searchParams.set("bbox", "-8,49,2,61");

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const parts = [p.name, p.city, p.county, p.state, p.country].filter(Boolean);
    return {
      name: p.name || parts[0] || "Location",
      lat,
      lon,
      label: parts.join(", "),
      source: /** @type {const} */ ("photon"),
      badge: "Place",
      score: 30,
    };
  });
}

/** @param {string} query */
async function searchOpenMeteo(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    source: /** @type {const} */ ("open-meteo"),
    badge: "Place",
    score: 20,
  }));
}

function dedupeResults(results) {
  const seen = [];
  const out = [];
  for (const r of results) {
    const dup = seen.find(
      (s) => Math.abs(s.lat - r.lat) < 0.002 && Math.abs(s.lon - r.lon) < 0.002
    );
    if (dup) continue;
    seen.push(r);
    out.push(r);
  }
  return out;
}

function querySuggestsUk(query) {
  const q = normalize(query);
  return (
    /\b(uk|england|scotland|wales|dorset|hampshire|cornwall|devon|sussex|kitesurf|kite surf|harbour|beach)\b/.test(
      q
    ) || q.includes("portland")
  );
}

/**
 * Search kitesurf catalog first, then places (Photon + Open-Meteo).
 * @param {string} query
 * @returns {Promise<SearchResult[]>}
 */
export async function searchLocations(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  /** @type {SearchResult[]} */
  let kitesurf = [];
  try {
    const catalog = await loadKitesurfCatalog();
    kitesurf = searchKitesurfCatalog(trimmed, catalog);
  } catch (err) {
    console.warn("Kitesurf catalog search skipped:", err);
  }

  const ukBias = querySuggestsUk(trimmed);

  const [photon, photonUk, openMeteo] = await Promise.all([
    searchPhoton(trimmed, { ukOnly: false }),
    ukBias ? searchPhoton(trimmed, { ukOnly: true }) : Promise.resolve([]),
    searchOpenMeteo(trimmed),
  ]);

  const merged = dedupeResults([
    ...kitesurf,
    ...photonUk,
    ...photon,
    ...openMeteo,
  ]).slice(0, 10);

  return merged.map(({ score, ...rest }) => rest);
}

export { loadKitesurfCatalog };
