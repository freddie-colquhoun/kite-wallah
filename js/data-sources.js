/** Plain-language data source documentation shown in the app */

export const DATA_SOURCES = [
  {
    title: "Ability wind bands",
    source: "Built into this app (ability-levels.js)",
    detail:
      "Min/max wind and gust tolerance follow your experience level on the Riders tab (coaching-style bands)  ·  not from Windguru or IKO.",
  },
  {
    title: "Kite wind ranges",
    source: "Local catalog (data/kite-catalog.json)",
    detail:
      "Per make/model/size ranges are curated from manufacturer charts (Duotone, North, Cabrinha, etc.), then adjusted for your weight and sex. This is not a live feed from brands  ·  if your kite isn't listed, add the closest model or we can extend the catalog.",
  },
  {
    title: "Session planning (forecast)",
    source: "Open-Meteo hourly forecast (7 days)",
    detail:
      "Plan scores daylight hours only (sunrise/sunset from Open-Meteo), applies your spot tide launch window if set, then rolls up to **GO**, Possible, Maybe, Probably not, or Skip per day. Gust spread matters: 18 kt gusting 37 is treated as very gusty, not light wind. On-water narrative is rule-based from your profile and quiver  ·  not an external AI.",
  },
  {
    title: "Live wind",
    source: "Open-Meteo API  ·  UK Met Office model in UK, global model elsewhere",
    detail:
      "Your spot pin can be exact (map drag / GPS). Wind is fetched for those coordinates. In the UK we use the UKMO seamless model (~2 km grid). Elsewhere ~11 km. That's much better than city-level geocoding but still not as fine as a Windguru station on the beach  ·  micro-thermals and headland effects won't show.",
  },
  {
    title: "Kitesurf spot search",
    source: "Curated catalog (data/kitesurf-spots.json) + OpenStreetMap places",
    detail:
      "Known kitesurf launches (e.g. Portland Harbour, Hayling) are in our catalog with precise launch coordinates. General place search uses OpenStreetMap via Photon. Always drag the map pin to your exact rigging spot.",
  },
  {
    title: "Tides",
    source: "NOAA (US) + Open-Meteo Marine (global, free)",
    detail:
      "US spots: official NOAA CO-OPS high/low times from the nearest tide station. Everywhere else: Open-Meteo Marine sea level (hourly, no API key). Times are reliable for session planning; heights are relative to mean sea level, not chart datum  ·  use local knowledge for exact launch depth.",
  },
  {
    title: "Spot launch direction",
    source: "You configure per spot",
    detail:
      "Safe and offshore wind sectors are set by you when saving a spot. The app compares forecast/current wind direction (16-point compass from Open-Meteo) to those sectors  ·  it does not auto-detect coastline or beach aspect. Drag the pin to your launch and tick offshore directions you would not ride; the Plan timeline shows an arrow (wind toward sea), not a no-go hatch.",
  },
  {
    title: "Local knowledge",
    source: "You type it in per spot",
    detail:
      "Free-text notes (e.g. 'only ride 2 hours either side of high', 'reef at low tide') are shown in analysis and can trigger extra warnings if they mention offshore or tide limits.",
  },
  {
    title: "Past sessions",
    source: "Your logged sessions",
    detail:
      "Only data that comes directly from your experience. Sessions you log under Riders (spot, date, wind, gusts, kite, notes) adjust scores and Plan day comparisons.",
  },
  {
    title: "Jump / trick advice",
    source: "Rules based on ability + wind",
    detail:
      "The advisor uses ability level and current wind band  ·  not video analysis or personal history. Ask after running Analyse for a contextual answer.",
  },
];

export function renderDataSourcesHtml() {
  return DATA_SOURCES.map(
    (d) =>
      `<details class="explain-step"><summary>${d.title}</summary><div class="explain-body"><p><strong>Source:</strong> ${d.source}</p><p>${d.detail}</p></div></details>`
  ).join("");
}
