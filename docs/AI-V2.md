# Kite Wallah v2 — AI layer

## What it does

After Plan or Now runs the **normal rules pipeline**, v2 optionally calls OpenAI to:

1. **Explain** — write “what to expect” prose from a structured **decision bundle**.
2. **Review** — same, plus short **consistency warnings** (e.g. GO day but rider unassigned).

## What it does *not* do (sandbox)

- Does **not** choose kite size or change `flyKiteId`.
- Does **not** change GO / Possible / verdict enums.
- Does **not** replace `scoreKiteForConditions` or `allocateKitesFairly`.
- Does **not** run on every hour tick — once per day card (Plan) or rider card (Now).

On API failure, timeout, missing key, or mode **Off**, you only see the rules-based UI.

## Modules

| File | Role |
|------|------|
| `js/decision-bundle.js` | JSON facts for AI |
| `js/ai-layer.js` | Prompt + parse response |
| `js/ai-settings.js` | `off` / `explain` / `review` |
| `js/ai-enrich.js` | Inject panels into DOM |

## Setup

Plan → Options → **OpenAI API key** (`gpt-4o-mini`) + **AI layer v2** mode. See `docs/OPENAI-SETUP.md`.
