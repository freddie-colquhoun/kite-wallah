# Kite Wallah — paste this into ChatGPT / Claude for a logic review

**Repo:** `kitesurf-advisor/` (GitHub: `freddie-colquhoun/kite-wallah`)  
**Ask the reviewer:** “Check crew kite allocation + session-aware sizing for contradictions, edge cases, and clearer rules. Suggest one simple rule set a non-coder can understand.”

---

## What the app does

Vanilla JS SPA for kitesurf planning. **Plan** tab: forecast → per-rider day cards → **Who flies what** (shared quiver) → **What to bring**.

No bundler. Core logic is in `js/*.js`. User-facing trees in `pages/how-it-works.html`.

---

## Single scoring pipeline (do not duplicate)

All kite picks use **`scoreKiteForConditions()`** and **`recommendKite()`** in `js/engine.js`.

Inputs: `conditions` (wind, gust, weight, ability, spot notes), `kites[]`, `calibration[]` (session log).

Session history affects:

- `js/kite-personal-range.js` — per-kite comfort band from logs
- `js/calibration.js` — `getCalibrationAtWind`, `applyCalibrationToScore`, `inferMinAdequateKiteSize`
- `js/fair-kite-allocation.js` — crew assign + Ideal display

---

## Crew allocation (the contentious part)

**File:** `js/fair-kite-allocation.js` → `allocateKitesFairly()`  
**Called from:** `js/kite-allocation.js` → `js/planner-ui.js` (`buildPlanDayAllocations`) and `js/app.js` (Now tab, 2+ riders)

### Intended rules (as of latest fix)

1. **Ideal** — Best kite for that rider at crew-day wind if they had the whole bag alone. Uses `pickIdealKiteRecommendation()`: highest score among kites **≥ target power size** (chart + sessions + weight), not a smaller kite that scores higher on catalog alone.

2. **Pick order** — **Heaviest rider (kg) first.** Exception: if someone has **only one** safe kite in the bag (`viableCount === 1`), they pick before heavier riders who still have choices.

3. **Each turn** — Among **safe** unused kites (`isKiteSafeForRider`), take **largest** size. First picker in queue also must meet **power target** − 0.5 m (`targetPowerSizeForRider`).

4. **Fly this** — Assigned physical kite. Can differ from Ideal when bag is shared.

5. **Rent** — Only if no safe kite remains for that rider.

6. **MIN_SUITABLE_SCORE** = 45 — UI amber below this; still assign if safe.

### Safety (`isKiteSafeForRider`)

- Need-fit ≥ 5%
- Wind within ability limits + catalog slack (experts tolerate more strong wind)
- Not below `minAdequate` from underpowered sessions
- Comfort band not “light” below catalog min, etc.

### UI labels

- **Fly this** — dominant assignment
- **Ideal** — solo pick at this wind (not “solo ideal”)
- If Ideal ≠ Fly this, explain who took the Ideal kite (`explainIdealTakenBy`)

---

## Regression the user saw (v1.40–v1.42)

**Constrained-first sort** (fewest viable kites first) let **Fred (79 kg)** pick **before Harry (85 kg)** and take **12m**. User expectation: **Harry always gets first pick of largest safe kite** unless Fred literally has only one kite that works.

**Fix direction:** Weight-first pick order; constrained-first only when `viableCount === 1`.

---

## Test crew (paste into reviewer)

| Rider | Weight | Ability | Sessions |
|-------|--------|---------|----------|
| Harry | 85 kg | competent | none |
| Fred | 79 kg | expert | 8m perfect @ 26 kt, 8m comfortable @ 25 kt, 9m underpowered @ 22 kt |
| Sam | 70 kg | competent | none |

**Bag:** 9m, 10m, 11m Rebel, 12m Evo  
**Crew wind:** 16 kt avg, gusts 25 kt  

**Expected assignment:**

- Harry → 12m  
- Fred → 11m (Ideal ~11m, not 10m from strong-wind 8m sessions)  
- Sam → 10m  

**Wrong outcomes to flag:**

- Fred gets 12m before Harry  
- Fred Ideal 10m when sessions were only good at 25+ kt on 8m  
- Sam Ideal 12m while Fred Ideal 10m (inverted vs weight without session reason)

---

## Rental / travel mode

**File:** `js/plan-travel.js`, `js/planner-ui.js`  
When **Renting**: no `allocateKitesFairly`; each rider gets independent `recommendKite` on full catalog.  
Session fix (v1.41+): don’t treat 8m as “sweet” at 16 kt if logs only happy at 25+ kt (`sessionWindMin` in `kite-personal-range.js`).

---

## Bring list

**File:** `js/plan-bring-kit.js`, `js/plan-day-aggregate.js` (`mergeCrewBringKit`)  
Merges hourly picks + all kites from **Who flies what**. Adjacent sizes = **Gust backup**, not “Main ride window”.

---

## Key files checklist

| File | Role |
|------|------|
| `js/engine.js` | `scoreKiteForConditions`, `recommendKite`, `idealKiteSizeForWind` |
| `js/calibration.js` | Session → preferred size at wind; wind gap extrapolation |
| `js/kite-personal-range.js` | Session bands; `sessionWindMin` penalty below logged happy wind |
| `js/fair-kite-allocation.js` | **CREW RULES** — assign + `buildRiderKiteDisplayHtml` |
| `js/kite-allocation.js` | Wrapper + banner HTML |
| `js/planner-ui.js` | Plan render, crew cards, travel mode |
| `js/plan-kite-algorithm.js` | Day headline kite |
| `pages/how-it-works.html` | User-facing docs (must match code) |
| `AGENTS.md` | Agent map |

---

## Questions for the reviewing AI

1. Is **weight-first pick order + largest safe kite** the right default for a mates trip?
2. When should **Ideal** differ from **Fly this**, and what should the one-line explanation say?
3. Are **session logs at 25 kt on 8m** being applied correctly at **16 kt** (size up, not “8m is ideal”)?
4. Suggest **one paragraph** of rules for the Plan UI hint (non-technical).
5. List **automated test cases** (input riders + bag → expected assign) we should add.

---

## How to review in Claude Code / Cursor

1. Open the repo folder locally (same as this project).
2. Read `js/fair-kite-allocation.js` and `js/engine.js` first.
3. Run in terminal (from `kitesurf-advisor/`):

```bash
node --input-type=module -e "
import { allocateKitesFairly } from './js/fair-kite-allocation.js';
import { getKiteWindRange } from './js/engine.js';
const kites = [9,10,11,12].map(s => ({ id:String(s), name:'K'+s+'m', size:s, brand:'D', model:'E', windRange:getKiteWindRange({size:s},79), specsSource:'manufacturer' }));
const cal = [
  { id:'1', windSpeed:26, kiteSize:8, feeling:'just-right' },
  { id:'2', windSpeed:22, kiteSize:9, feeling:'slightly-underpowered' },
  { id:'3', windSpeed:25, kiteSize:8, feeling:'comfortable' },
];
const mk=(n,w,c)=>({ profileId:n, name:n, rideable:true, calibration:c, conditions:{ windSpeed:16, peakGust:25, riderWeight:w, skillLevel:n==='Fred'?'expert':'competent', spotNotes:'' }});
const r=allocateKitesFairly([mk('Harry',85,[]),mk('Fred',79,cal),mk('Sam',70,[])], kites);
r.assignments.forEach(a=>console.log(a.name,'fly',a.kite.size+'m','ideal',a.soloPick?.size+'m'));
"
```

4. Compare output to **Expected assignment** above.

---

## Version

Check `js/version.js` (`APP_VERSION`). User reported issues on **1.40–1.42**; live status dashboard **1.43**.
