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
- Once loaded once, it keeps working with no internet connection.
- All photos, videos, voice recordings and communication boards are stored
  **only on the device itself** (in the browser's local storage and
  IndexedDB) — nothing is uploaded to a server, because there is no server.
  This satisfies the "local-only by default" and "no cloud backup without
  consent" requirements simply by not having a backend at all.

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

## What's implemented (MVP)

- Onboarding: child's name/icon, and a 4-digit parent PIN.
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
- A hidden, press-and-hold PIN unlock in the corner of Child Mode, plus a
  Fullscreen request and a best-effort back-button trap.
- Full local backup export/import (single JSON file, including all media,
  base64-encoded) and a printable paper version of the communication board.
- "Delete everything" (typed confirmation) wipes local storage and
  IndexedDB entirely.
- Works fully offline after first load, via a service worker.

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
- **No multi-device cloud sync.** Each device keeps its own private copy.
  Use Backup & Restore to manually move content between devices.
- **Speech quality** depends entirely on the voices your browser/OS
  provides via the Web Speech API.

## File layout

```
index.html        Entry point
css/style.css      All styling (large touch targets, adjustable theme)
js/db.js           IndexedDB helper for photo/video/audio blobs
js/data.js         Default starter categories & buttons (fully editable)
js/app.js          Application state, rendering and all interaction logic
sw.js              Service worker for offline caching
manifest.json      PWA manifest (installable, home-screen icon)
icons/icon.svg     App icon
```

No build step, no external dependencies, no analytics or third-party
scripts — everything runs from these files alone.
