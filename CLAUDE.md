# Sake Journey (`sake-journey`) — Claude project guide

An event-companion **PWA** for a sake sommelier ("Kana"). Guests scan a QR code at
a tasting dinner (no install, no login wall), share one live session, go
course-by-course through pairings, photograph and rate each pour, and get a
personal "My Night" recap + cross-event history (email magic-link to sync). A
passcode-protected **host studio** builds events, scans a printed menu photo into a
draft (AI vision), and watches live results. Standalone — not part of the
Aftershock marketing stack.

## Stack (ground truth)
- **Front end:** vanilla JS, **no framework, no build step.** Native ES modules,
  hand-rolled hash router (`js/app.js`), CSS variables (`css/styles.css`).
- **Back end:** `server.js` — **zero-dependency Node** (only built-ins:
  `node:http`, `fs`, `crypto`, `dns`). Serves static files + JSON REST API +
  Server-Sent Events. Node 18+. `package.json` has **no dependencies —
  `npm install` is not needed.**
- **AI:** Anthropic Claude API directly via `fetch` (no SDK). Two surfaces —
  `/api/parse-menu` (vision → structured courses) and `/api/scan-sake` (two-phase:
  quick vision pass, then a full pass using Claude's server-side `web_search` tool
  with graceful fallback). Default model `claude-opus-4-8` (`MENU_MODEL`).
- **Email:** Resend REST API (magic-link + recap), no SDK.
- **Data:** a single JSON file `data/db.json`, atomic write-and-rename.
- **Hosting:** Railway (Nixpacks), health `/api/health`.

## Run / verify (no build, no tests — drive the real flow)
```bash
node server.js        # http://localhost:5178
```
There is no test suite or CI. Before any deploy, click through **both** flows:
join event → rate a pour → recap, and host login → scan a menu.

## Invariants — do NOT break
- **API keys stay server-side.** `ANTHROPIC_API_KEY` / `RESEND_API_KEY` live in
  env and are used only in server-side `fetch`. **Never move keys or AI calls into
  `js/`** (the classic PWA leak).
- **Never commit `data/` or `.env`** — `db.json` holds live guest PII and tokens.
- Writes are **field-allow-listed** (`RATING_FIELDS`/`GUEST_FIELDS`/`SAKE_FIELDS`)
  and sanitised — adding a stored field means updating the allow-list *and* the
  sanitizer.
- Persistence is **atomic** (temp+rename) and never reseeds over a corrupt file —
  don't "simplify" `loadDB`/`persist`.
- The offline **outbox merges patches by target key** — don't change writes to send
  whole records.
- **Bump `CACHE` in `sw.js`** (currently `sake-journey-vNN`) whenever a shell file
  changes, or guests get stale assets.
- Keep the server zero-dependency — don't add npm packages.

## Auth model (one paragraph)
Guests = device-local identity + optional email magic-link session (90-day token).
Host = single shared passcode as a Bearer token. "Festival" = an allow-listed
shared-password shortcut — **disable in prod.**

## Production checklist (do before a real event) ⚠️
- Railway → set a strong `HOST_PASSCODE` (default `'kanpai'` is public knowledge).
- Set `FESTIVAL_EMAILS=` (empty) to disable the trial-login backdoor
  (`server.js` defaults to two personal emails).
- **Mount a Railway volume + set `DATA_DIR`** — without it, `db.json` (all guest
  history) is wiped on every redeploy. Highest-impact operational fix.
- Set `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `PUBLIC_URL`.
- Cost lever: `MENU_MODEL` defaults to Opus for what is OCR — a cheaper tier cuts
  per-scan cost; `/api/parse-menu` is not rate-limited (only host-gated).
