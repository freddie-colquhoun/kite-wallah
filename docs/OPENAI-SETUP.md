# OpenAI setup (Kite Wallah v2)

## 1. Create a key

1. Sign in at [platform.openai.com](https://platform.openai.com/).
2. **API keys** → Create key (starts with `sk-`).
3. Add a payment method if prompted.

## 2. Set a spend cap (recommended)

**Settings → Billing → Limits** → set a monthly budget (e.g. **$2–5**).

Personal use with `gpt-4o-mini` is usually **pennies to ~£1/month**.

## 3. Built into the site (no typing in the app)

Edit **`js/secrets.js`**:

```js
export const OPENAI_API_KEY = "sk-…your key…";
export const AI_LAYER_DEFAULT = "explain";  // or "review" or "off"
```

Commit and push (or deploy) with that file. Everyone using the site uses that key — **do not put a real key in a public repo** unless you accept that risk.

Then run **Plan** or **Now** — **v2 · AI** panels appear automatically.

**Plan chat** uses the same key.

## What AI does not change

Kite size, GO/Maybe, and crew allocation stay **rule-based**. AI only writes natural-language summaries from the computed forecast.
