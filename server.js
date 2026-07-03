/* ============================================================
   Sake Journey — server
   Dependency-free Node (built-ins only). Serves the PWA AND a
   live API so multiple guests share one event and the host sees
   the room update in real time (Server-Sent Events).
   Data persists to ./data/db.json. Run: node server.js
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SEED_EVENT, SEED_SAKES } from './js/seed.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;
// DATA_DIR lets a host (e.g. a Railway volume) point persistence at durable storage.
const DB_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_FILE = join(DB_DIR, 'db.json');

// Host access: a shared passcode gates the host studio + its writes.
const HOST_PASSCODE = process.env.HOST_PASSCODE || 'kanpai';
// Menu scanning (optional): reads a printed-menu photo via the Claude API.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MENU_MODEL = process.env.MENU_MODEL || 'claude-opus-4-8';

// Email (optional): magic-link guest login + recap emails via Resend's REST API (no SDK).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Sake Journey <onboarding@resend.dev>';
const PUBLIC_URL = process.env.PUBLIC_URL || '';   // override for links in emails (else derived from request)

const GRADE_ENUM = ['', 'junmai', 'junmai_ginjo', 'junmai_daiginjo', 'ginjo', 'daiginjo', 'honjozo', 'nigori', 'sparkling', 'koshu'];
const MENU_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    courses: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' },
          desc: { type: 'string' },
          sakeName: { type: 'string' },
          sakeGrade: { type: 'string', enum: GRADE_ENUM },
          pairingText: { type: 'string' },
        },
        required: ['name', 'desc', 'sakeName', 'sakeGrade', 'pairingText'],
      },
    },
  },
  required: ['title', 'subtitle', 'courses'],
};
const MENU_PROMPT = `You are reading a photograph of a printed menu for a sake pairing dinner. Extract only what is ON the menu — do not invent anything.
- title / subtitle: the event name and tagline if shown, else "".
- courses: in the order printed. For each: the dish "name"; a short "desc" (garnishes, sauce, or sub-line as printed, else ""); the "sakeName" exactly as printed (include brewery/region if shown); a best-guess "sakeGrade" from the allowed list ONLY if the menu states or clearly implies it (e.g. the words "Junmai Ginjo"), else ""; and "pairingText" = any pairing rationale actually printed on the menu, else "".
Do NOT fabricate taste profiles, SMV, or pairing reasons that are not printed. Use empty strings for anything absent. Record the result via the record_menu tool.`;

/* ---------- Persistence ---------- */
let db = { events: {}, sakes: {}, guests: {}, ratings: {}, magicTokens: {}, guestTokens: {} };

async function loadDB() {
  if (existsSync(DB_FILE)) {
    try { db = JSON.parse(await readFile(DB_FILE, 'utf8')); }
    catch { console.warn('db.json unreadable — reseeding'); seed(); }
  } else {
    seed();
  }
  // Ensure required collections exist even in an older db.
  for (const k of ['events', 'sakes', 'guests', 'ratings', 'magicTokens', 'guestTokens']) db[k] = db[k] || {};
  if (!db.events[SEED_EVENT.id]) { db.events[SEED_EVENT.id] = SEED_EVENT; save(); }
}
function seed() {
  db = { events: {}, sakes: {}, guests: {}, ratings: {}, magicTokens: {}, guestTokens: {} };
  for (const s of SEED_SAKES) db.sakes[s.id] = s;
  db.events[SEED_EVENT.id] = SEED_EVENT;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await mkdir(DB_DIR, { recursive: true }); await writeFile(DB_FILE, JSON.stringify(db, null, 2)); }
    catch (e) { console.error('save failed', e); }
  }, 120);
}

/* ---------- Live updates (SSE) ---------- */
const streams = new Map();            // eventId -> Set(res)
function subscribe(eventId, res) {
  if (!streams.has(eventId)) streams.set(eventId, new Set());
  streams.get(eventId).add(res);
  res.on('close', () => { const s = streams.get(eventId); if (s) s.delete(res); });
}
function broadcast(eventId, type = 'update') {
  const s = streams.get(eventId);
  if (!s) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`;
  for (const res of s) { try { res.write(payload); } catch { /* client gone */ } }
}

/* ---------- Helpers ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 12e6) req.destroy(); }); // ~12MB cap (photos)
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function isHost(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!token && token === HOST_PASSCODE;
}

/* ---------- Menu scanning via the Claude API (optional) ---------- */
async function parseMenuImage(mediaType, b64) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MENU_MODEL,
      max_tokens: 4096,
      tools: [{ name: 'record_menu', description: 'Record the menu parsed from the photo.', input_schema: MENU_SCHEMA, strict: true }],
      tool_choice: { type: 'tool', name: 'record_menu' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: MENU_PROMPT },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const tool = (data.content || []).find((b) => b.type === 'tool_use');
  if (!tool) throw new Error('no structured result returned');
  return tool.input;
}

/* ---------- Venue lookup: read a restaurant's site for photo + menu/booking links ---------- */
const decodeEntities = (s = '') => s
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return m; } })
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function resolveUrl(base, href) { try { return new URL(href, base).toString(); } catch { return null; } }
function isSafeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === '::1' || h === '[::1]') return false;
    return true;
  } catch { return false; }
}
async function lookupVenue(input) {
  let url = (input || '').trim();
  if (!url) throw new Error('no url');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!isSafeUrl(url)) throw new Error('unsupported url');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let finalUrl = url, html = '';
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SakeJourney/1.0; +https://sake-journey.com)', Accept: 'text/html,*/*' },
    });
    finalUrl = r.url || url;
    if (!isSafeUrl(finalUrl)) throw new Error('redirected to unsupported url');
    html = (await r.text()).slice(0, 1_500_000);
  } finally { clearTimeout(timer); }

  const meta = (prop) => {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'));
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
    return (a && a[1]) || (b && b[1]) || '';
  };
  let image = meta('og:image') || meta('og:image:url') || meta('twitter:image') || '';
  if (image) image = resolveUrl(finalUrl, decodeEntities(image)) || '';
  let name = decodeEntities(meta('og:site_name') || meta('og:title') || '');
  if (!name) { const tm = html.match(/<title[^>]*>([^<]*)<\/title>/i); name = tm ? decodeEntities(tm[1]).trim() : ''; }
  name = name.replace(/\s*[|–—\-·].*$/, '').trim();   // drop " | Home" style suffixes

  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => { const href = decodeEntities(m[1]); return { href, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), abs: resolveUrl(finalUrl, href) }; })
    .filter((a) => a.abs && /^https?:/i.test(a.abs));
  const RESERVE = /(opentable|resy\.com|sevenrooms|quandoo|thefork|bookenda|obeeapp|tablein|eveve|reservation|book[\s-]*a[\s-]*table|reserve)/i;
  const reserve = anchors.find((a) => RESERVE.test(a.href) || RESERVE.test(a.text));
  const menu = anchors.find((a) => (/menu/i.test(a.href) || /\bmenus?\b/i.test(a.text)) && !RESERVE.test(a.href));

  return { name, image, website: finalUrl, menuUrl: menu ? menu.abs : '', reserveUrl: reserve ? reserve.abs : '' };
}

/* ---------- Email + guest accounts (magic-link) ---------- */
const rid = (n = 18) => randomBytes(n).toString('base64url');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const escHtml = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const heartStr = (n) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host}`;
}
const guestsByEmail = (email) => {
  const e = normEmail(email);
  return e ? Object.values(db.guests).filter((g) => normEmail(g.email) === e) : [];
};
const canonicalGuest = (email) =>
  guestsByEmail(email).sort((a, b) => (b.identified - a.identified) || (a.createdAt - b.createdAt))[0] || null;
function makeMagicToken(email, ttlMs) {
  const tok = rid();
  db.magicTokens[tok] = { email: normEmail(email), exp: Date.now() + ttlMs }; save();
  return tok;
}
function guestEmailFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const s = tok && db.guestTokens[tok];
  return s ? s.email : null;
}
function guestEventItems(guestId, event) {
  const eng = (r) => r && (r.s1 || r.s2 || r.wouldBuy || r.photoBottle || r.photoFood || r.photo);
  const items = [], seen = new Set();
  for (const c of event.courses || []) {
    const r = db.ratings[`${guestId}__${event.id}__${c.sakeId}`];
    if (eng(r) && db.sakes[c.sakeId]) { items.push({ sake: db.sakes[c.sakeId], rating: r, course: c }); seen.add(c.sakeId); }
  }
  for (const r of Object.values(db.ratings)) {
    if (r.guestId === guestId && r.eventId === event.id && !seen.has(r.sakeId) && eng(r) && db.sakes[r.sakeId]) {
      items.push({ sake: db.sakes[r.sakeId], rating: r, course: null });
    }
  }
  return items;
}

async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) throw new Error('email_not_configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, text: text || undefined }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

/* ---- email templates (inline styles for client compatibility) ---- */
const emailShell = (inner, footer) => `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17303f">
  <div style="max-width:540px;margin:0 auto;padding:26px 20px">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;color:#024e82;letter-spacing:.3px">Sake Journey</div>
    <div style="background:#ffffff;border:1px solid #e3dac9;border-radius:16px;padding:22px;margin-top:14px">${inner}</div>
    <div style="color:#8a96a0;font-size:12px;line-height:1.6;margin-top:16px">${footer || ''}</div>
  </div></body></html>`;
const emailBtn = (href, label) => `<a href="${escHtml(href)}" style="display:inline-block;background:#024e82;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px;font-size:15px">${label}</a>`;

function magicLinkEmail(link) {
  return emailShell(`
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:600">Your sign-in link</div>
    <p style="color:#4d5f6b;font-size:15px;line-height:1.5">Tap below to open your sake journey — every pour you've tasted, with your scores and notes. This link works for 15 minutes.</p>
    <p style="margin:18px 0">${emailBtn(link, 'Open my sake journey')}</p>
    <p style="color:#8a96a0;font-size:12px">If you didn't request this, you can safely ignore this email.</p>`,
    'Sent by Sake Journey.');
}
function venueLinksHtml(event) {
  if (!event.venue && !event.venueUrl) return '';
  const g = event.venueGoogleUrl || (event.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}` : '');
  const lk = (u, l) => (u ? `<a href="${escHtml(u)}" style="color:#0f6fb0;text-decoration:none;font-weight:600;margin-right:14px">${l}</a>` : '');
  return `<div style="margin-top:16px;padding-top:14px;border-top:1px solid #ece4d5">
    <div style="font-family:Georgia,serif;font-size:15px">${escHtml(event.venue || 'The restaurant')}</div>
    <div style="font-size:13px;margin-top:6px">${lk(event.venueMenuUrl, 'Menu')}${lk(event.venueReserveUrl, 'Reserve')}${lk(event.venueUrl, 'Website')}${lk(g, 'Google Maps')}</div>
  </div>`;
}
function recapEmail(guest, event, items, journeyLink, unsubLink) {
  const scored = items.map((x) => ({ ...x, final: x.rating.s2 || x.rating.s1 || 0 })).sort((a, b) => b.final - a.final);
  const top = scored[0];
  const buys = scored.filter((x) => x.rating.wouldBuy);
  const rows = scored.map((x) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #ece4d5">
      <div style="font-family:Georgia,serif;font-size:16px">${escHtml(x.sake.name)}</div>
      <div style="color:#8a96a0;font-size:12px">${x.course ? escHtml(x.course.name) : 'Surprise pour'}</div>
    </td>
    <td style="padding:8px 0;border-bottom:1px solid #ece4d5;text-align:right;color:#c15f45;font-size:15px;white-space:nowrap">${heartStr(x.final)}${x.rating.wouldBuy ? ' 🍶' : ''}</td>
  </tr>`).join('');
  const inner = `
    <div style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#0f6fb0;font-weight:700">${escHtml(event.title)}</div>
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin-top:4px">${guest.name ? escHtml(guest.name.split(' ')[0]) + "'s" : 'Your'} evening</div>
    ${top ? `<div style="margin-top:14px;background:#f7f2e9;border:1px solid #e3dac9;border-radius:12px;padding:14px;text-align:center">
      <div style="text-transform:uppercase;letter-spacing:.1em;font-size:11px;color:#0f6fb0;font-weight:700">Your pour of the night</div>
      <div style="font-family:Georgia,serif;font-size:19px;margin-top:4px">${escHtml(top.sake.name)}</div>
      <div style="color:#c15f45;font-size:16px">${heartStr(top.final)}</div></div>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-top:16px">${rows}</table>
    ${buys.length ? `<p style="color:#4d5f6b;font-size:14px;margin-top:14px"><b>Bottles you loved:</b> ${buys.map((x) => escHtml(x.sake.name)).join(', ')}. Reply if you'd like to take any home.</p>` : ''}
    ${venueLinksHtml(event)}
    <p style="margin:20px 0 6px">${emailBtn(journeyLink, 'Open your full sake journey')}</p>
    <p style="color:#8a96a0;font-size:12px">See your photos and every pour you've tasted with ${escHtml(event.host)}.</p>`;
  return emailShell(inner, `You're receiving this because you opted in at ${escHtml(event.title)}. <a href="${escHtml(unsubLink)}" style="color:#8a96a0">Unsubscribe</a>.`);
}

/* ---------- API ---------- */
async function handleAPI(req, res, url) {
  const p = url.pathname;
  const eventId = url.searchParams.get('event');

  if (req.method === 'GET' && p === '/api/health') return sendJSON(res, 200, { ok: true, menuScan: !!ANTHROPIC_API_KEY });

  // Host login — validates the shared passcode (which then rides as a Bearer token).
  if (req.method === 'POST' && p === '/api/host/login') {
    const b = await readBody(req);
    if (b.passcode && b.passcode === HOST_PASSCODE) return sendJSON(res, 200, { ok: true });
    return sendJSON(res, 401, { ok: false });
  }

  // Scan a printed menu photo into a draft event (host-only; needs ANTHROPIC_API_KEY).
  if (req.method === 'POST' && p === '/api/parse-menu') {
    if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    if (!ANTHROPIC_API_KEY) return sendJSON(res, 400, { error: 'no_api_key', message: 'Set ANTHROPIC_API_KEY on the server to enable menu scanning.' });
    const b = await readBody(req);
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(b.image || '');
    if (!m) return sendJSON(res, 400, { error: 'bad_image' });
    try { return sendJSON(res, 200, await parseMenuImage(m[1], m[2])); }
    catch (e) { console.error('parse-menu failed:', e.message); return sendJSON(res, 502, { error: 'parse_failed', message: String(e.message || e) }); }
  }

  // Look up a restaurant's site → photo + menu/booking links (host-only, no external key).
  if (req.method === 'POST' && p === '/api/venue-lookup') {
    if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const b = await readBody(req);
    try { return sendJSON(res, 200, await lookupVenue(b.url)); }
    catch (e) { console.error('venue-lookup failed:', e.message); return sendJSON(res, 502, { error: 'lookup_failed', message: String(e.message || e) }); }
  }

  // Guest magic-link login: email a sign-in link (or return it in dev when email is off).
  if (req.method === 'POST' && p === '/api/guest/login') {
    const b = await readBody(req);
    const email = normEmail(b.email);
    if (!email.includes('@')) return sendJSON(res, 400, { error: 'bad_email' });
    const hasAccount = guestsByEmail(email).length > 0;
    const link = `${baseUrl(req)}/#/claim/${makeMagicToken(email, 15 * 60 * 1000)}`;
    if (RESEND_API_KEY) {
      try { await sendEmail({ to: email, subject: 'Your Sake Journey sign-in link', html: magicLinkEmail(link), text: `Open your sake journey: ${link}` }); }
      catch (e) { console.error('login email failed:', e.message); return sendJSON(res, 502, { error: 'email_failed', message: e.message }); }
      return sendJSON(res, 200, { ok: true, sent: true, hasAccount });
    }
    return sendJSON(res, 200, { ok: true, sent: false, hasAccount, devLink: link });  // dev: no provider set
  }

  // Claim a magic-link token → returns a session token + the guest for that email.
  if (req.method === 'POST' && p === '/api/guest/claim') {
    const b = await readBody(req);
    const t = db.magicTokens[b.token];
    if (!t || t.exp < Date.now()) return sendJSON(res, 400, { error: 'invalid_token' });
    delete db.magicTokens[b.token];
    let guest = canonicalGuest(t.email);
    if (!guest) {
      // New account from a magic link: NOT opted into marketing — consent only comes from
      // the explicit, timestamped checkbox in the app (keeps parity with the client default).
      guest = { id: 'g_' + rid(6).slice(0, 8), name: '', email: t.email, consentMarketing: false, consentPhotoFood: false, consentPhotoMe: false, eventIds: [], createdAt: Date.now(), identified: true };
      db.guests[guest.id] = guest;
    }
    const sessionToken = rid(24);
    db.guestTokens[sessionToken] = { email: t.email, createdAt: Date.now() };
    save();
    return sendJSON(res, 200, { sessionToken, email: t.email, guest });
  }

  // Cross-device journey: all ratings across every guest-record sharing the logged-in email.
  if (req.method === 'GET' && p === '/api/guest/history') {
    const email = guestEmailFromReq(req);
    if (!email) return sendJSON(res, 401, { error: 'unauthorized' });
    const ids = new Set(guestsByEmail(email).map((g) => g.id));
    const ratings = Object.values(db.ratings).filter((r) => ids.has(r.guestId));
    const events = [...new Set(ratings.map((r) => r.eventId))].map((id) => db.events[id]).filter(Boolean);
    const sakes = [...new Set(ratings.map((r) => r.sakeId))].map((id) => db.sakes[id]).filter(Boolean);
    return sendJSON(res, 200, { email, guest: canonicalGuest(email), guestIds: [...ids], events, sakes, ratings });
  }

  // Host: send each consented guest their personal recap email for an event.
  if (req.method === 'POST' && p === '/api/host/send-recaps') {
    if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const b = await readBody(req);
    const event = db.events[b.eventId];
    if (!event) return sendJSON(res, 404, { error: 'no_event' });
    const base = baseUrl(req);
    const recipients = Object.values(db.guests)
      .filter((g) => g.identified && g.email && g.consentMarketing && (g.eventIds || []).includes(event.id))
      .filter((g) => guestEventItems(g.id, event).length > 0);
    const build = (g) => {
      const items = guestEventItems(g.id, event);
      const journeyLink = `${base}/#/claim/${makeMagicToken(g.email, 30 * 24 * 60 * 60 * 1000)}`;
      const unsubLink = `${base}/unsubscribe?e=${encodeURIComponent(g.email)}`;
      return recapEmail(g, event, items, journeyLink, unsubLink);
    };
    if (!RESEND_API_KEY) {
      return sendJSON(res, 200, { error: 'email_not_configured', wouldSend: recipients.length, preview: recipients[0] ? build(recipients[0]) : null });
    }
    let sent = 0, failed = 0;
    for (const g of recipients) {
      try { await sendEmail({ to: g.email, subject: `Your night at ${event.title}`, html: build(g) }); sent++; }
      catch (e) { failed++; console.error('recap email failed:', g.email, e.message); }
    }
    return sendJSON(res, 200, { sent, failed, recipients: recipients.length });
  }

  // Everything a device needs to render events: the events + the full sake library.
  if (req.method === 'GET' && p === '/api/bootstrap') {
    return sendJSON(res, 200, { events: Object.values(db.events), sakes: Object.values(db.sakes) });
  }

  // Aggregate feed for the host results + guest "room favourite" (ALL guests).
  if (req.method === 'GET' && p === '/api/results') {
    const guests = Object.values(db.guests).filter((g) => (g.eventIds || []).includes(eventId));
    const ratings = Object.values(db.ratings).filter((r) => r.eventId === eventId);
    return sendJSON(res, 200, { guests, ratings });
  }

  // Live stream
  if (req.method === 'GET' && p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    subscribe(eventId, res);
    return;
  }

  // Upserts
  if (req.method === 'PUT' && p === '/api/ratings') {
    const r = await readBody(req);
    if (!r.id) return sendJSON(res, 400, { error: 'missing id' });
    db.ratings[r.id] = { ...db.ratings[r.id], ...r }; save();
    broadcast(r.eventId);
    return sendJSON(res, 200, db.ratings[r.id]);
  }
  if (req.method === 'POST' && p === '/api/guests') {
    const g = await readBody(req);
    if (!g.id) return sendJSON(res, 400, { error: 'missing id' });
    db.guests[g.id] = { ...db.guests[g.id], ...g }; save();
    (g.eventIds || []).forEach((eid) => broadcast(eid));
    return sendJSON(res, 200, db.guests[g.id]);
  }
  if (req.method === 'POST' && p === '/api/sakes') {
    const s = await readBody(req);
    if (!s.id) return sendJSON(res, 400, { error: 'missing id' });
    // Guests may add their own surprise pours (adhoc); library sakes are host-only.
    if (!s.adhoc && !isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    db.sakes[s.id] = { ...db.sakes[s.id], ...s }; save();
    return sendJSON(res, 200, db.sakes[s.id]);
  }
  if (req.method === 'DELETE' && p === '/api/sakes') {
    if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const id = url.searchParams.get('id');
    delete db.sakes[id]; save();
    return sendJSON(res, 200, { ok: true });
  }
  if (req.method === 'PUT' && p === '/api/events') {
    if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const e = await readBody(req);
    if (!e.id) return sendJSON(res, 400, { error: 'missing id' });
    db.events[e.id] = { ...db.events[e.id], ...e }; save();
    broadcast(e.id, 'event');
    return sendJSON(res, 200, db.events[e.id]);
  }

  return sendJSON(res, 404, { error: 'not found' });
}

/* ---------- Static files ---------- */
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const data = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    // SPA-ish fallback for unknown non-file routes → index.html
    if (!extname(file)) {
      try { const html = await readFile(join(ROOT, 'index.html')); res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(html); }
      catch { /* fall through */ }
    }
    res.writeHead(404); res.end('not found');
  }
}

/* ---------- Server ---------- */
function handleUnsubscribe(req, res, url) {
  const email = normEmail(url.searchParams.get('e'));
  let n = 0;
  if (email) {
    for (const g of Object.values(db.guests)) if (normEmail(g.email) === email && g.consentMarketing) { g.consentMarketing = false; n++; }
    if (n) save();
  }
  const msg = email ? "You've been unsubscribed. You won't receive further emails." : 'No email specified.';
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4efe6;color:#17303f;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:400px;padding:24px"><div style="font-family:Georgia,serif;font-size:26px;color:#024e82">Sake Journey</div><p style="margin-top:16px;font-size:15px;line-height:1.5">${msg}</p></div></body>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/unsubscribe') return handleUnsubscribe(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e); sendJSON(res, 500, { error: 'server error' });
  }
});

await loadDB();
server.listen(PORT, () => {
  console.log(`\n  🍶 Sake Journey running at http://localhost:${PORT}`);
  console.log(`     data: ${DB_FILE}`);
  console.log(`     host passcode: ${process.env.HOST_PASSCODE ? 'set via HOST_PASSCODE' : `"${HOST_PASSCODE}" (default — set HOST_PASSCODE for production)`}`);
  console.log(`     menu scanning: ${ANTHROPIC_API_KEY ? `on (${MENU_MODEL})` : 'off (set ANTHROPIC_API_KEY to enable)'}`);
  console.log(`     email (login + recaps): ${RESEND_API_KEY ? `on (from ${FROM_EMAIL})` : 'off (set RESEND_API_KEY + FROM_EMAIL to enable)'}\n`);
});
