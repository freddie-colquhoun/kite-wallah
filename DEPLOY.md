# Deploy Kite Wallah — beginner guide (Mac + Cursor)

This guide matches how the app is built: **files on your Mac** → **GitHub** (stores the code) → **GitHub Pages** (shows the website) → **Supabase** (shared riders / quiver / spots for you and friends).

You do **not** need to be a programmer. Copy commands carefully, one block at a time.

---

## Important: how updates work (read this first)

| What | Does the live website update automatically? |
|------|-----------------------------------------------|
| You edit riders/spots in the **live website** | Yes — saves to Supabase (after Part B). Mates see changes. |
| **Cursor / AI changes code** in your project folder | **No** — not until **you** publish (see below). |
| You run the **publish commands** (`git push`) | **Yes** — usually within **2–5 minutes** GitHub rebuilds the site. |

**Publishing updates after the AI (or you) change the app:**

1. Changes are saved in your project folder (OneDrive path below).
2. Open **Terminal** (see below).
3. Run the three commands in [Part D — Publish updates](#part-d--publish-updates-after-changes) at the bottom of this file.
4. Wait a few minutes, refresh your website URL (hard refresh: **Cmd + Shift + R**).

Your **data** (riders, kites, spots) does **not** reset when you publish code — that lives in **Supabase** once Part B is done.

---

## Where is “Terminal”?

**Terminal** is Apple’s app for typing short commands. Your Mac has it built in.

**Easiest if you use Cursor (recommended):**

1. Open your project in **Cursor**.
2. Menu **View** → **Terminal** (or press **Ctrl + `** — the key above Tab).
3. A panel opens at the bottom. That **is** Terminal.

**Or open the Mac Terminal app:**

1. Press **Cmd + Space** (Spotlight).
2. Type **Terminal**.
3. Press **Enter**.

You’ll see a window with a blinking cursor and a line ending in `%` or `$`. Paste commands there and press **Enter**.

---

## Before you start

1. **GitHub account** — free at [github.com](https://github.com/signup).
2. **Project folder** on your Mac (this is where the app files live):

```
/Users/freddiecolquhoun/Library/CloudStorage/OneDrive-Personal/Project 2026/Cursor/kitesurf-advisor
```

3. **Git** on your Mac — in Terminal, type `git --version` and press Enter.  
   - If you see a version number, you’re fine.  
   - If it says “command not found”, install **Xcode Command Line Tools**: Terminal will often offer a popup; click **Install**, or run `xcode-select --install` and wait until it finishes.

---

## Part A — Put the website online (GitHub Pages)

### A1 — Create an empty repo on GitHub

1. Go to [github.com](https://github.com) and sign in.
2. Top right **+** → **New repository**.
3. **Repository name:** e.g. `kite-wallah` (remember this name).
4. **Public**.
5. **Do not** tick “Add a README”.
6. Click **Create repository**.

GitHub shows a page with setup hints. Leave it open.

Write down:

- **Your GitHub username** (e.g. `freddiecolquhoun`)
- **Repo name** (e.g. `kite-wallah`)

Your website URL will later be:

`https://YOUR_USERNAME.github.io/REPO_NAME/`

Example: `https://freddiecolquhoun.github.io/kite-wallah/`

---

### A2 — Copy your project to GitHub (first time only)

Open **Terminal** (Cursor bottom panel or Mac Terminal).

**Command 1 — go to the project folder**  
Copy this whole line, paste into Terminal, press **Enter**:

```bash
cd "/Users/freddiecolquhoun/Library/CloudStorage/OneDrive-Personal/Project 2026/Cursor/kitesurf-advisor"
```

If you get “No such file or directory”, the folder path changed — in Finder, open the `kitesurf-advisor` folder, right‑click the folder → **Get Info**, and check the path.

**Command 2 — tell git this folder is a project** (first time only):

```bash
git init
```

**Command 3 — stage all files:**

```bash
git add .
```

**Command 4 — save a snapshot:**

```bash
git commit -m "First version of Kite Wallah"
```

**Command 5 — link to GitHub**  
Replace `YOUR_USERNAME` and `REPO_NAME` with yours, then run **once**:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
```

Example:

```bash
git remote add origin https://github.com/freddiecolquhoun/kite-wallah.git
```

If it says `remote origin already exists`, skip Command 5 and go to Command 6.

**Command 6 — upload to GitHub:**

```bash
git push -u origin main
```

**Signing in:** The first push may open a browser or ask you to log in to GitHub. Use your GitHub account. If it asks for a password, GitHub no longer accepts your normal password — use a **Personal Access Token** ([GitHub help: creating a token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)) with “repo” permission, and paste that as the password.

When it finishes without errors, refresh your repo page on GitHub — you should see folders `js`, `css`, `index.html`, etc.

---

### A3 — Turn on the free website (GitHub Pages)

1. On GitHub, open **your repo** (not your profile).
2. Click **Settings** (top tab).
3. Left sidebar → **Pages** (under “Code and automation”).
4. **Build and deployment** → **Source:** Deploy from a branch.
5. **Branch:** `main` → **Folder:** `/ (root)` → click **Save**.
6. Wait **2–5 minutes**. Refresh the Pages section — it shows a green link:  
   `https://YOUR_USERNAME.github.io/REPO_NAME/`

Open that link in Safari/Chrome. You should see **Kite Wallah**.

**Version label:** After each deploy, bump the number in `js/version.js` (e.g. `1.6` → `1.7`), commit, and push. The header shows **Kite Wallah v1.7** so you can confirm the live site updated (hard-refresh if it still shows an old version).

The header may say **“Saved on this device only”** until you finish Part B — that’s normal.

---

## Part B — One shared database for you and friends (Supabase)

Do this when the website loads from Part A.

### B1 — Create Supabase project

1. [supabase.com](https://supabase.com) → sign up (free).
2. **New project** → name it e.g. `kite-wallah`.
3. Set a **database password** — save it in Notes (you rarely need it).
4. Wait until the dashboard says the project is ready.

### B2 — Create the `crew_state` table

1. Supabase left menu → **SQL Editor**.
2. Click **New query**.
3. On your Mac, in **Cursor**, open file:  
   `kitesurf-advisor/supabase/schema.sql`
4. Select all (**Cmd + A**), copy (**Cmd + C**).
5. Paste into Supabase SQL Editor.
6. Click **Run** (bottom right). It should say success.

### B3 — Realtime (optional but nice)

So when a mate saves, your page can update without refresh:

1. **Database** → **Replication** (name may vary).
2. Enable **Realtime** for table **`crew_state`**.

### B4 — One login everyone shares

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. **Email:** `crew@kite-wallah.local` (doesn’t need to be a real inbox).
3. **Password:** pick a strong password → share only with your crew (WhatsApp, etc.).
4. Enable **Auto Confirm User** if you see it.

### B5 — Copy API details into the app

1. Supabase **Project Settings** (gear icon) → **API**.
2. Copy **Project URL** and **anon public** key (`eyJ…`).

In **Cursor**, open `js/config.js` and edit:

```javascript
export const CLOUD_CONFIG = {
  enabled: true,
  supabaseUrl: "https://xxxx.supabase.co",   // paste Project URL
  supabaseAnonKey: "eyJ....",               // paste anon public key
  crewEmail: "crew@kite-wallah.local",      // same email as B4
};
```

Save the file (**Cmd + S**).

### B6 — Publish that config to the live site

In Terminal (same `cd` folder as before):

```bash
cd "/Users/freddiecolquhoun/Library/CloudStorage/OneDrive-Personal/Project 2026/Cursor/kitesurf-advisor"
git add js/config.js
git commit -m "Turn on crew cloud sync"
git push
```

Wait 2–5 minutes. Open your Pages URL → **Crew sign-in** → use the password from B4. Header should say **Synced with crew**.

**First login:** If you already used the app on this computer, your local riders/spots may upload to the cloud once.

---

## Part C — Share with friends

Send them:

1. Your Pages link, e.g. `https://YOUR_USERNAME.github.io/kite-wallah/`
2. The **crew password** (privately)
3. “Sign in on first visit”

They use the **same** login. Everyone sees the same quiver and spots.

---

## Part D — Publish updates after changes

Use this whenever **you or Cursor** change app files and you want the **live website** updated.

1. Open Terminal in Cursor (**View → Terminal** or **Ctrl + `**).
2. Run:

```bash
cd "/Users/freddiecolquhoun/Library/CloudStorage/OneDrive-Personal/Project 2026/Cursor/kitesurf-advisor"
git add .
git commit -m "Describe what changed, e.g. Plan tab tweak"
git push
```

3. Wait **2–5 minutes**.
4. Open your site URL and press **Cmd + Shift + R** (hard refresh).

You do **not** need to redo Part A or B each time — only these three commands (unless you change `js/config.js` or Supabase setup).

**Ask Cursor to publish for you:** you can say *“publish to GitHub”* and the agent can run these commands if git is set up — you may still need to approve sign-in the first time.

---

## Test on your Mac before going live (optional)

```bash
cd "/Users/freddiecolquhoun/Library/CloudStorage/OneDrive-Personal/Project 2026/Cursor/kitesurf-advisor"
python3 -m http.server 8080
```

Open http://localhost:8080 — with `enabled: false` in `config.js`, data stays in the browser only.

Stop the test server: click the Terminal panel and press **Ctrl + C**.

---

## Troubleshooting (plain English)

| Problem | What to try |
|--------|-------------|
| “command not found: git” | Install Xcode Command Line Tools (`xcode-select --install`) |
| “command not found: python3” | Install Python from [python.org](https://www.python.org/downloads/) or use the live GitHub URL instead |
| `git push` fails / login | Use a GitHub Personal Access Token as the password |
| Website is old after you pushed | Wait 5 minutes, then **Cmd + Shift + R** |
| Still “this device only” | Set `enabled: true` in `js/config.js` and run Part D commands |
| Sign-in fails | Email in `config.js` must match Supabase user; user must be confirmed |
| Blank website | Open the URL from GitHub Pages settings; don’t open `index.html` from Finder |

---

## Quick reference

| Piece | Role |
|-------|------|
| **Cursor / your Mac folder** | Where code is edited |
| **GitHub repo** | Backup + source for the website |
| **GitHub Pages** | Free public URL for the app |
| **Supabase** | Shared riders, quiver, spots |
| **Crew password** | Who can read/write shared data |

Photos are off on purpose — use kite **colour** and **label** instead.
