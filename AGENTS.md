# Kite Wallah — agent notes

When you change **recommendation logic**, **Plan / Now behaviour**, **quiver or session scoring**, **multi-rider allocation**, or **travel mode**, update:

- `pages/how-it-works.html` — full decision trees and analysis (user-facing)
- `js/version.js` — bump `APP_VERSION` if deploying

Match the doc to the code in the modules listed below.

## Architecture (one pipeline)

```
storage.js (profiles, crew) + quiver-storage.js (shared bag)
spots-storage.js + spots-ui.js (launch spots, wind fetch)
        ↓
engine.js — scoreKiteForConditions / recommendKite / analyze (canonical scoring)
        ↓
├─ Now (app.js + now-tab-ui.js) — analyze per rider; crew → kite-allocation.js
└─ Plan (planner.js → planner-ui.js)
      plan-recommendation.js — powered window
      plan-kite-algorithm.js — day headline kite
      plan-hourly-kites.js — hour cells
      plan-bring-kit.js — bag list
      fair-kite-allocation.js — crew Ideal + Fly this (constrained-first pick order)
      plan-day-aggregate.js — crew day verdict + mergeCrewBringKit
```

**Do not add a second scoring path.** Plan, Now, allocation, and bring-kit all call `scoreKiteForConditions` or `recommendKite` from `engine.js`.

## Persistence

- Mutate in-memory state via `installState` / `saveState` (`storage.js`) and spot helpers (`spots-storage.js`).
- Cloud: `data-store.js` debounces `schedulePersist` on `window.__schedulePersist` after local write.
- Do not write `localStorage` keys outside those modules.

## UI helpers

- HTML escaping: `js/dom-safe.js` → `escapeHtml` (import in UI modules; do not copy inline).

## Removed / avoid reviving

- Legacy **Analyse** tab DOM ids (`analyse-spot`, `analyse-wind-slot`, `results-container`).
- Per-profile quiver (migrated to `state.quiver`).
- Skills checklist (`rider-skills.js` is ability → limits only).
- `refreshPlanCompareSelect`, `plan-day-brief.js`, duplicate `getProfileSkillLimits` on quiver-storage.

## Large files (split carefully if editing)

| File | Role |
|------|------|
| `planner-ui.js` | Plan fetch, render, crew cards — prefer new logic in `plan-*.js` / `fair-kite-allocation.js` |
| `engine.js` | Core scoring |
| `app.js` | Tabs, Now results, riders editor |
| `fair-kite-allocation.js` | Crew allocation rules + rider kite HTML |
