# Kite Wallah

Plan sessions, check conditions now, and manage riders, quiver, and spots. Uses Open-Meteo (no API keys for weather).

## Run locally

```bash
cd kitesurf-advisor
cp js/config.example.js js/config.js   # optional; leave enabled: false for local-only
python3 -m http.server 8080
```

Open http://localhost:8080 (a local server is required for module imports and forecast fetches).

## Host online + share data with friends

**Full step-by-step:** see **[DEPLOY.md](DEPLOY.md)**.

Summary:

1. Push to GitHub → enable **Pages** → get a public URL.
2. Create a free **Supabase** project → run `supabase/schema.sql` → create one shared Auth user.
3. Copy `js/config.example.js` → `js/config.js`, set `enabled: true` and your Supabase URL/keys.
4. Deploy `config.js` with the site (see DEPLOY.md if the repo is public).
5. Everyone signs in with the same crew password; riders, quiver, and spots stay in sync.

Photos are disabled to keep sync fast and small; use kite **colour** and **label** instead.

## Help pages (in the app footer)

- [How it works](pages/how-it-works.html)
- [Data & limits](pages/data-sources.html)

## Tabs

- **Plan** — multi-day forecast with **GO** / Possible / Maybe / Probably not / Skip per day
- **Now** — wind when you pick a spot
- **Spots** — locations, wind sectors, tide rules
- **Quiver** — shared kites and boards
- **Riders** — weight, ability, calibration

Recommendations are guidelines — always use your own judgment on the water.
