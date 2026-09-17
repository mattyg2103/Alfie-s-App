# My Voice and Safe Space

A private, parent-managed communication and sensory-support web app for a
non-speaking autistic child. It is an assistive communication and personal
support tool — it does not replace professional advice or an individually
assessed communication system, and it is not officially affiliated with
PECS or any other proprietary communication approach.

## Why a website

This is built as an offline-capable web app (a "PWA") rather than a native
App Store / Play Store app. That means:

- It can be opened immediately on any phone, tablet or computer with a
  modern browser — no app review, no install required (though it *can*
  be "Added to Home Screen" to launch like a normal app).
- Once loaded once, the core communication and photo/video experience keeps
  working with no internet connection.
- Photos, videos and voice recordings are stored **only on the device
  itself** (browser local storage and IndexedDB) and are never uploaded,
  full stop. A parent account and each child's board/settings *do* sync
  through a small backend so a parent can sign in on more than one device
  — see **Accounts & syncing** below for exactly what that does and doesn't
  include.

## Accounts & syncing

- `server/` is a small Express API (deployed separately on Render) backed
  by a Postgres database (Neon). It has exactly two tables: `parents`
  (email + salted/hashed password — never plaintext) and `children` (a
  JSON blob of board/settings per child).
- What syncs: the parent account, and each child's name, communication
  board (categories, buttons, wording, emoji, colours), Words & Actions
  board, layout/accessibility settings, Child Mode configuration, and PIN
  hash.
- What never syncs, by design: photos, videos, and voice recordings. Those
  stay in IndexedDB on whichever device captured them. A second device
  signed into the same account sees the same board and settings, but needs
  its own photos/recordings added.
- If you'd rather run with no backend at all (pure local-only, like the
  original MVP), that's a valid choice — see `js/app.js`'s `API_BASE` and
  the `boot()`/`Actions.authSubmit` flow, which would need to be swapped
  back to a local-only onboarding flow.

## Running it

Any static file server works. For example, from this folder:

```
python3 -m http.server 8080
```

then open `http://localhost:8080/` in a browser. To deploy it for real
use, upload the contents of this folder to any static web host (GitHub
Pages, Netlify, Vercel, S3, etc.) served over **HTTPS** — a secure origin
is required for the PIN's cryptographic hashing (`crypto.subtle`), camera
capture, and microphone recording to work.

On a tablet, open the site in Safari/Chrome and use "Add to Home Screen"
so it launches full-screen like an app.

## Deploying to Render

This is a static site (no build step, no backend), so it fits Render's
free **Static Site** service directly, and gets HTTPS automatically —
which this app needs for PIN hashing, camera capture and microphone
recording to work.

**Option A — Dashboard (no YAML needed):**

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the [Render dashboard](https://dashboard.render.com), click **New +** → **Static Site**.
3. Connect this GitHub repository.
4. Leave **Build Command** empty (there's nothing to build).
5. Set **Publish Directory** to `.` (the repo root, where `index.html` lives).
6. Click **Create Static Site**. Render will give you a URL like
   `https://my-voice-safe-space.onrender.com`.

**Option B — Blueprint (`render.yaml`):**

This repo includes a `render.yaml` at the root. In the Render dashboard,
click **New +** → **Blueprint**, connect this repository, and Render will
read `render.yaml` and provision the static site automatically using the
same settings as Option A. If Render's Blueprint schema has changed since
this was written and the sync fails, fall back to Option A — it takes
about a minute either way.

**After it's deployed:**

- Every push to this branch auto-redeploys (`autoDeploy: true`).
- Open the Render URL on the tablet you'll actually use, and "Add to Home
  Screen" so it behaves like an installed app.
- Because it's real HTTPS (not an embedded preview), camera capture,
  microphone voice recording, and offline mode (service worker) all work
  fully — unlike the sandboxed artifact demo shared earlier in this chat.

### Deploying the backend API

`server/` is a separate Render **Web Service** (Node), not part of the
static site above:

1. **New +** → **Web Service**, connect this repo, same branch.
2. **Build Command**: `cd server && npm install`
3. **Start Command**: `cd server && npm start`
4. Environment variables:
   - `DATABASE_URL` — a Neon Postgres connection string (Neon dashboard →
     your project → Connection Details). The schema (`parents`, `children`
     tables) needs to exist first — see `server/index.js` for the two
     `CREATE TABLE` statements if you're setting up a fresh database.
   - `JWT_SECRET` — any long random string (e.g. `openssl rand -hex 32`).
   - `CORS_ORIGIN` — the static site's URL, e.g.
     `https://my-voice-safe-space.onrender.com`.
5. Update `API_BASE` at the top of `js/app.js` to match this service's
   Render URL if you name it something other than
   `my-voice-safe-space-api`.

The API has no other secrets or third-party dependencies — just Express,
`pg`, `jsonwebtoken` and `cors`.

## What's implemented (MVP)

- Parent account registration/sign-in (email + password), syncing across
  devices. Support for multiple child profiles per account, with a
  switcher in Parent Mode and a picker screen when signing in fresh.
- The app boots straight into the last-selected child's locked Child Mode
  on launch — not the dashboard — so a reload never exposes parent
  controls by accident.
- **Parent Access**: a discreet, always-visible button in the corner of
  Child Mode. Five consecutive taps (not a long-press) opens an
  authentication screen offering PIN, account password, or optional
  WebAuthn Face/Touch ID.
- **Parent Mode** dashboard: child profile, photo & video library, a full
  communication-board editor ("My Voice"), a "Words and Actions" editor,
  voice/audio settings, Child Mode settings, layout & accessibility
  settings, backup/restore, privacy controls, a live interactive preview
  of exactly what the child will see, help, and about.
- **Child Mode**: three-tile home screen (Photos & Videos / My Voice /
  Words & Actions), each independently hideable or the child can be
  locked to a single section.
- Photo/video viewer with Previous/Next, categories, favourites, hide.
- Visual communication board with starter categories (Food & Drink,
  Personal Needs, TV & Activities, Feelings, Answers & Choices), each
  button editable with your own photo, wording, emoji/symbol and a voice
  recording made right in the browser (falls back to the device's
  text‑to‑speech voice when no recording exists).
- Optional sentence builder (multi-select strip with Speak/Clear/Undo).
- "Words and Actions" social board with a small built-in animation per
  word, and an optional parent-recorded demonstration video per word.
- Accessibility: adjustable button/text size, colours, optional
  confirm-before-speak, a configurable delay between selections, optional
  vibration, and reduced-motion support.
- Fullscreen request and a best-effort back-button trap while in Child Mode.
- Full local backup export/import (single JSON file, including this
  child's media, base64-encoded) and a printable paper version of the
  communication board.
- "Delete everything" (typed confirmation) deletes the account and all
  child profiles from the server, then wipes local storage and IndexedDB
  on this device.
- Works fully offline after first load for anyone already signed in with
  an active child selected — sign-in itself needs connectivity.

## Honest limitations

A website — even installed to the home screen — cannot do everything a
native app can. This app is upfront about that rather than overclaiming:

- **No true OS-level kiosk lock.** Child Mode is a strong *software*
  restriction (no settings, no external links, back-button trapped,
  fullscreen requested), but the browser chrome or a device's own
  multitasking gestures could still let a determined child leave the page.
  The **Child Mode Settings** tab in the dashboard gives step-by-step
  instructions for pairing this with iOS **Guided Access** or Android
  **Screen Pinning**, which *do* provide a true OS-level lock.
- **No screenshot/recording prevention.** Browsers do not expose an API
  for this — it is only possible in native apps.
- **Camera/video capture** uses the device's normal native camera UI (via
  a file input with `capture`), not a custom in-app camera preview.
- **Media never syncs.** Photos, videos and recordings stay per-device.
  Use Backup & Restore to manually move a child's media between devices.
- **Biometric unlock is a device-local gate, not a server login.** It uses
  WebAuthn's platform authenticator (Face ID/Touch ID/fingerprint) purely
  to withhold a locally-stored credential until the OS verifies you — it
  doesn't call the server, so it's a convenience layer on top of the PIN
  and password, not a replacement for them.
- **Speech quality** depends entirely on the voices your browser/OS
  provides via the Web Speech API.

## File layout

```
index.html          Entry point
css/style.css        All styling (large touch targets, adjustable theme)
js/db.js             IndexedDB helper for photo/video/audio blobs
js/data.js           Default starter categories & buttons (fully editable)
js/app.js            App state, rendering, interaction logic, and the API client
sw.js                Service worker for offline caching
manifest.json        PWA manifest (installable, home-screen icon)
icons/icon.svg       App icon
server/index.js      Express API: auth + child profile sync routes
server/auth.js        Password hashing (scrypt), JWT issuing/verification
server/db.js           Postgres connection pool
server/package.json    Backend dependencies (express, pg, jsonwebtoken, cors)
render.yaml           Blueprint for the static site (frontend only)
```

The frontend has no build step and no third-party analytics. The backend
is a minimal Express API with four dependencies, no ORM, no framework
magic — two tables, five routes.
