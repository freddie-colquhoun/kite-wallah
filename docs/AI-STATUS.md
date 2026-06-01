# AI features — current status

## Parked (v2.0.6+)

`AI_FEATURES_PARKED = true` in `js/ai-settings.js` hides OpenAI Options, Plan chat, and v2 narrative panels.

**Plan and Now still work** using the rules engine (kite picks, GO/Possible, who flies what, bring kit).

## Why browser OpenAI does not work here

Kite Wallah is a **static site** on GitHub Pages. Calling `https://api.openai.com/v1/chat/completions` from the browser:

1. **CORS** — OpenAI does not allow normal browser origins; preflight often fails (see [DEV: browser OpenAI failures](https://dev.to/tracepilot_2841f1db6718a1/that-openai-call-from-your-browser-is-failing-heres-why-3p3c)).
2. **Security** — Any key in JS is visible in DevTools ([OpenAI SDK: `dangerouslyAllowBrowser`](https://www.npmjs.com/package/openai)).

OpenAI’s supported runtimes are server-side (Node, Workers, etc.), not public static pages.

## Sensible path if you want AI later

| Approach | Effort | Notes |
|----------|--------|--------|
| **Keep rules only** | None | Recommended for now |
| **Supabase Edge Function** | Medium | Key stays on server; site calls your function |
| **Small proxy** (Fly.io, Vercel) | Medium | Same pattern |
| **Paste key in browser** | Low | Unreliable + insecure; not recommended |

Re-enable UI only after a **server proxy** exists; set `AI_FEATURES_PARKED = false` in `ai-settings.js`.
