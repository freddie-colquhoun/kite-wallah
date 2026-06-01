/** @typedef {'hybrid' | 'bow' | 'c' | 'foil'} KiteType */

/**
 * @typedef {Object} SizeSpec
 * @property {number} minWind
 * @property {number} idealWind
 * @property {number} maxWind
 * @property {number} weightRef
 */

/**
 * @typedef {Object} KiteModelSpec
 * @property {KiteType} type
 * @property {string} style
 * @property {Record<string, SizeSpec>} sizes
 */

/**
 * @typedef {Object} FetchedKiteSpec
 * @property {string} brand
 * @property {string} model
 * @property {number} size
 * @property {KiteType} type
 * @property {string} style
 * @property {{ min: number, ideal: number, max: number }} windRange
 * @property {number} weightRef
 * @property {string} source
 */

let catalog = null;

function normalize(str) {
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

function findBrandKey(input) {
  if (!catalog) return null;
  const norm = normalize(input);
  return Object.keys(catalog.brands).find((b) => normalize(b) === norm) ?? null;
}

function findModelKey(brandKey, input) {
  const models = catalog.brands[brandKey];
  if (!models) return null;
  const norm = normalize(input);
  return Object.keys(models).find((m) => normalize(m) === norm) ?? null;
}

export async function loadCatalog() {
  if (catalog) return catalog;
  const url = new URL("../data/kite-catalog.json", import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load kite catalog");
  catalog = await res.json();
  return catalog;
}

export function getBrands() {
  if (!catalog) return [];
  return Object.keys(catalog.brands).sort();
}

export function getModels(brandInput) {
  const brandKey = findBrandKey(brandInput);
  if (!brandKey) return [];
  return Object.keys(catalog.brands[brandKey]).sort();
}

export function getSizes(brandInput, modelInput) {
  const brandKey = findBrandKey(brandInput);
  if (!brandKey) return [];
  const modelKey = findModelKey(brandKey, modelInput);
  if (!modelKey) return [];
  const sizes = catalog.brands[brandKey][modelKey].sizes;
  return Object.keys(sizes)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Adjust manufacturer wind range for rider weight and sex.
 * Heavier riders need more wind; women's charts often size ~0.5m smaller.
 */
export function adjustWindRange(base, riderWeight, weightRef = 75, sex = "unspecified") {
  const weightShift = ((riderWeight - weightRef) / weightRef) * 4;
  const sexShift = sex === "female" ? 1 : 0;

  return {
    min: Math.round((base.minWind + weightShift + sexShift) * 10) / 10,
    ideal: Math.round((base.idealWind + weightShift + sexShift) * 10) / 10,
    max: Math.round((base.maxWind + weightShift + sexShift) * 10) / 10,
  };
}

/**
 * Fetch manufacturer specs for a kite (simulated network delay for UX).
 * @param {string} brandInput
 * @param {string} modelInput
 * @param {number} size
 * @param {{ weight?: number, sex?: string }} rider
 * @returns {Promise<FetchedKiteSpec>}
 */
export async function fetchKiteSpecs(brandInput, modelInput, size, rider = {}) {
  await loadCatalog();
  await new Promise((r) => setTimeout(r, 350));

  const brandKey = findBrandKey(brandInput);
  if (!brandKey) {
    throw new Error(`Brand "${brandInput}" not found in catalog. Try Duotone, North, Cabrinha, F-One, Ozone, Core, or Slingshot.`);
  }

  const modelKey = findModelKey(brandKey, modelInput);
  if (!modelKey) {
    const available = getModels(brandKey).join(", ");
    throw new Error(`Model "${modelInput}" not found for ${brandKey}. Available: ${available}`);
  }

  const modelSpec = catalog.brands[brandKey][modelKey];
  const sizeKey = String(size);
  const sizeSpec = modelSpec.sizes[sizeKey];

  if (!sizeSpec) {
    const available = getSizes(brandKey, modelKey).join("m, ") + "m";
    throw new Error(`Size ${size}m not listed for ${brandKey} ${modelKey}. Available sizes: ${available}`);
  }

  const riderWeight = rider.weight ?? 75;
  const windRange = adjustWindRange(sizeSpec, riderWeight, sizeSpec.weightRef, rider.sex);

  return {
    brand: brandKey,
    model: modelKey,
    size,
    type: modelSpec.type,
    style: modelSpec.style,
    windRange,
    weightRef: sizeSpec.weightRef,
    source: "manufacturer",
  };
}

export function searchKites(query) {
  if (!catalog || !query.trim()) return [];
  const q = normalize(query);
  const results = [];

  for (const [brand, models] of Object.entries(catalog.brands)) {
    for (const [model, spec] of Object.entries(models)) {
      const label = `${brand} ${model}`;
      if (normalize(label).includes(q) || normalize(brand).includes(q) || normalize(model).includes(q)) {
        results.push({ brand, model, style: spec.style, type: spec.type });
      }
    }
  }

  return results.slice(0, 8);
}
