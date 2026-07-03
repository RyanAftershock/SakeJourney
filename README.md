# 🍶 Sake Journey

The companion app for Kana - Sake Journey's sake tasting events — so guests **remember every pour**, every
pairing, and every night; and so Kana - Sake Journey quietly builds an audience she can invite back.

Experience-first, styled to the **Sake Journey brand** (calligraphic wordmark, deep-blue `#024e82`,
Bodoni editorial serif). Guests scan a QR at the table — no app-store install — and everyone at the
event shares one **live** session: the host watches the room's favourites update in real time.

---

## What it does

### For guests (the priority)
- **Scan → straight into tonight's menu.** No login wall — the food, the sake, and *why* Kana - Sake Journey
  paired them come first.
- **Course-by-course tasting.** One pour at a time: the dish, the sake's four-type flavour quadrant,
  serving temperature, specs (SMV / acidity / ABV / seimai), tasting notes, and Kana - Sake Journey's
  **"why this pairing"** in her voice (tagged *Match / Mirror / Contrast*).
- **Capture & rate in seconds** — one tap to photograph, one to rate (5 hearts), one for
  *"I'd take a bottle home."*
- **The "+" surprise pour** — snap and name an off-menu sake so it joins your night.
- **De-anchored finale** — re-taste each pour fresh (earlier score hidden), then see how your taste
  shifted over the night.
- **"My Night" recap** — your pour of the night, ranking with climb/drop deltas, biggest climber,
  and **the room's favourite** (updates live as others rate).
- **"Your sake journey"** — a running history of every pour you've tasted across all events, each with
  your score, would-buy flag, photo, Kana - Sake Journey's notes, and an optional **personal tasting
  note** you can add or edit anytime. **Sign in with your email** (magic link) to see it on **any
  device**; otherwise it's kept on the device you tasted on.
- **Gentle, compliant capture** — name/email asked after value, with separate unticked consent
  boxes (marketing + photo reuse), timestamped.

### For Kana - Sake Journey (host studio — `#/host`, passcode-protected)
- **Scan a printed menu photo** → the app reads it with Claude and drafts the courses + sakes for you
  to refine (needs `ANTHROPIC_API_KEY`; it only extracts what's printed — it never invents taste profiles).
- **Restaurant callout** → paste the restaurant's website and tap **Look up**: the server reads the
  site's preview photo and finds menu / booking links (OpenTable, Resy, SevenRooms, …). Guests get a
  card with **Menu / Reserve / Website / Google Maps** buttons (Google Maps auto-built from the name).
  No extra API key; auto-pull is best-effort and every field is editable.
- **Event builder** with the pairing-move scaffold; **reusable sake library** (build each bottle once).
- **Results** — the room's ranking, who wants which bottle, photo gallery, captured guests + consent,
  **CSV export** — all **live** as guests tap.
- **Send recap emails** → one tap emails each opted-in guest their personal recap (top pour, ranking,
  Kana - Sake Journey's notes, restaurant links) with a magic link back into their journey (needs
  `RESEND_API_KEY`; every email carries a one-click unsubscribe).
- **Share** — QR + link. Three themes: **Daylight** (brand light), **Evening** (dark, for dim venues),
  **Warm** (terracotta).

The host studio is behind a **passcode** (`HOST_PASSCODE`); guests never see it. Guest capture and
rating need no login.

---

## Run it

Needs Node (18+). No `npm install` — the server uses only Node built-ins.

```bash
node server.js        # or: npm start
# open http://localhost:5178
```

This one process serves **both** the app and the live API. Guest data persists to `data/db.json`.

**Config (env vars, all optional):**

| Var | Purpose |
|-----|---------|
| `HOST_PASSCODE` | Passcode for the host studio (`#/host`). Defaults to `kanpai` — **change it before sharing.** |
| `ANTHROPIC_API_KEY` | Enables "Scan a printed menu photo". Without it, the app runs fully; only scanning is off. |
| `MENU_MODEL` | Model for menu scanning (default `claude-opus-4-8`). |
| `RESEND_API_KEY` | Enables email — guest sign-in magic links + recap emails (via [Resend](https://resend.com)). Off without it (sign-in falls back to a dev link). |
| `FROM_EMAIL` | Sender for emails, e.g. `Sake Journey <hello@yourdomain.com>` (must be a verified Resend domain). |
| `PUBLIC_URL` | Base URL for links inside emails (your Railway domain). Derived per-request if unset. |
| `DATA_DIR` | Where to persist `db.json` (point at a mounted volume in prod). |
| `PORT` | Overrides `5178` (Railway sets this automatically). |

See `.env.example`.

---

## Deploy to Railway

1. Push this folder to a GitHub repo (a `.gitignore` is included; `data/` and `.env` are excluded).
2. In Railway: **New Project → Deploy from GitHub repo** → pick it. Railway auto-detects Node and runs
   `node server.js` (a `railway.json` pins this + a `/api/health` healthcheck).
3. **Variables** → add `HOST_PASSCODE` (required) and `ANTHROPIC_API_KEY` (for menu scanning).
4. **Networking → Generate Domain** to get a public URL.
5. **(Recommended) add a Volume** so guest data survives redeploys: mount it at e.g. `/data`, then set
   `DATA_DIR=/data`. Without a volume, `db.json` resets on each deploy.
6. The QR on the Share screen automatically points at your Railway URL. Print it for the table.

---

## How it's built

- **Front end:** vanilla JS PWA, **no build step** — ES modules, hash router, service worker
  (offline app shell). Styled to the brand (`css/styles.css`, themeable via CSS variables).
- **Back end:** `server.js` — **dependency-free Node** (built-in `http`). Serves static files + a
  JSON REST API + **Server-Sent Events** for live updates. Persists to `data/db.json`. Shares the
  exact same `js/seed.js` as the client, so the sample event is identical on both sides.
- **Offline-first sync:** every device keeps an **IndexedDB** cache and syncs through `js/net.js`.
  Writes that fail while offline are queued in an **outbox** and flushed on reconnect — nothing a
  guest captures is ever lost. Reads of the shared "room" (results, room's favourite) come from the
  server when online and fall back to local when not.
- **Live room:** the recap and host results subscribe to SSE and re-render when anyone rates.

### Files
| Path | Role |
|------|------|
| `server.js` | Node server: static + REST API + SSE + persistence |
| `js/net.js` | Client network layer: sync, outbox, live stream |
| `js/store.js` | IndexedDB cache + the data API the views use |
| `js/seed.js` | Shared sample event + sake library (client **and** server) |
| `js/ui.js` | Icons, hearts, quadrant, sheets, photo capture (compression) |
| `js/views/guest.js` · `js/views/host.js` | The two experiences |
| `css/styles.css` | Brand design system (Daylight / Evening / Warm) |
| `assets/logo.svg` | The real calligraphic wordmark (CSS-masked, themeable) |
| `sw.js`, `manifest.webmanifest` | Offline + installability |

### API (all JSON)
Guest/open: `GET /api/bootstrap` · `GET /api/results?event=:id` · `GET /api/stream?event=:id` (SSE) ·
`PUT /api/ratings` · `POST /api/guests` · `POST /api/sakes` (ad-hoc pours only).
Host-only (require `Authorization: Bearer <passcode>`): `PUT /api/events` · `POST /api/sakes` (library) ·
`DELETE /api/sakes?id=:id` · `POST /api/parse-menu`. Plus `POST /api/host/login`.

Sample sakes are **illustrative archetypes**; Kana - Sake Journey replaces them with her real roster in the library.

---

## Known limitations (honest list)

- **Host auth is a single shared passcode**, not per-user accounts. Good for one operator; change it
  from the default and rotate it if it leaks. It's sent as a Bearer token over HTTPS.
- **JSON-file storage.** `data/db.json` is great for events up to hundreds of guests; move to SQLite
  or Postgres for scale/backups. On Railway, mount a volume + set `DATA_DIR` so it survives redeploys.
- **Recap email is host-triggered, not scheduled.** Kana taps **Send recap emails** on the results
  screen (ideally 24–48h after the event). Automating it on a timer is a future step.
- **Guest sign-in is passwordless (email magic-link).** Signing in aggregates every rating across all
  guest-records sharing that email. Without email configured (`RESEND_API_KEY`), sign-in still works
  in a **dev mode** that returns the link directly instead of emailing it — configure email before
  relying on it in production.
- **Surprise-pour label scanning** (OCR + JP→EN translate) is intentionally not built — the flakiest,
  lowest-frequency feature; today you name the pour manually.
- **QR image** uses an online generator on the Share screen (setup-time only); the guest app is fully
  offline. **Fonts** load from Google with strong fallbacks — self-host for perfect offline first paint.

---

## Suggested next steps

1. **Schedule the recap email** to auto-send 24–48h after an event (it's host-triggered today), with a
   per-event tracking code for attribution.
2. **Live host "reveal next course" pacing control** + a big-screen "room's favourite" moment.
3. **Bottle intent → Shopify hand-off** (capture-only today; keeps clear of liquor licensing until
   that's sorted with proper advice).
4. **Durable storage** (SQLite/Postgres) for scale/backups.
5. Surprise-pour v2 (guest-side photo → scan → match, reusing the menu-scan pipeline).
6. Per-user host accounts if more than one person needs to run events.

> **Compliance note (AU):** marketing email needs express, timestamped opt-in (Spam Act); reusing a
> guest's face in a paid ad needs the separate photo consent (never anyone who looks under 25 or
> intoxicated). Bottle *sales/shipping* is a separately licensed activity — this MVP only captures
> *intent*. Get professional advice before selling. Consent capture is designed with this in mind,
> but it isn't legal advice.
