# Kite Wallah — agent notes

When you change **recommendation logic**, **Plan / Now behaviour**, **quiver or session scoring**, **multi-rider allocation**, or **travel mode**, update:

- `pages/how-it-works.html` — full decision trees and analysis (user-facing)
- `js/version.js` — bump `APP_VERSION` if deploying

Match the doc to the code in `js/engine.js`, `js/planner.js`, `js/plan-recommendation.js`, `js/plan-kite-algorithm.js`, `js/fair-kite-allocation.js`, `js/plan-bring-kit.js`, `js/plan-travel.js`, and related modules.
