/* ============================================================
   Sake Journey — server
   Dependency-free Node (built-ins only). Serves the PWA AND a
   live API so multiple guests share one event and the host sees
   the room update in real time (Server-Sent Events).
   Data persists to ./data/db.json. Run: node server.js
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SEED_EVENT, SEED_SAKES, SOLO_EVENT } from './js/seed.js';

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

// Festival trial: a small allow-list of emails that can sign in with a shared password instead of a
// magic link (for a hands-on trial day). Both configurable via env; set FESTIVAL_EMAILS='' to disable.
const FESTIVAL_PASSCODE = process.env.FESTIVAL_PASSCODE || 'Kanpai';
const FESTIVAL_EMAILS = new Set((process.env.FESTIVAL_EMAILS ?? 'ryanmerrett@gmail.com,jimbeam999@hotmail.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

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
    catch {
      // NEVER reseed over an existing-but-unreadable file (a truncated write, etc.) — that would
      // destroy recoverable data. Preserve it untouched, then start fresh so the server still boots.
      const aside = `${DB_FILE}.corrupt-${Date.now()}`;
      try { await rename(DB_FILE, aside); console.error(`db.json unreadable — preserved at ${aside}, starting fresh`); }
      catch (e) { console.error('db.json unreadable and could not be preserved:', e); }
      seed();
    }
  } else {
    seed();
  }
  // Ensure required collections exist even in an older db.
  for (const k of ['events', 'sakes', 'guests', 'ratings', 'magicTokens', 'guestTokens']) db[k] = db[k] || {};
  let dirty = false;
  // One-time migration: the OLD email-based unsubscribe only set consentMarketing=false (no `unsubscribed`
  // flag existed). Mark those legacy opt-outs unsubscribed=true so the new transactional recap excludes them.
  if (!db._migratedUnsub) {
    for (const g of Object.values(db.guests)) if (g.unsubscribed === undefined && g.consentMarketing === false) g.unsubscribed = true;
    db._migratedUnsub = true; dirty = true;
  }
  if (!db.events[SEED_EVENT.id]) { db.events[SEED_EVENT.id] = SEED_EVENT; dirty = true; }
  if (!db.events[SOLO_EVENT.id]) { db.events[SOLO_EVENT.id] = SOLO_EVENT; dirty = true; }
  if (dirty) save();
}
function seed() {
  db = { events: {}, sakes: {}, guests: {}, ratings: {}, magicTokens: {}, guestTokens: {} };
  for (const s of SEED_SAKES) db.sakes[s.id] = s;
  db.events[SEED_EVENT.id] = SEED_EVENT;
  db.events[SOLO_EVENT.id] = SOLO_EVENT;
}
// Debounced, serialised, ATOMIC persistence: write a temp file then rename over db.json
// (rename is atomic on the same volume), so a crash mid-write can never truncate the live file.
// Writes are chained so two flushes never interleave. Compact JSON (no pretty-print) to cut work.
let saveTimer = null, saveChain = Promise.resolve(), dbDirReady = false;
async function persist() {
  if (!dbDirReady) { await mkdir(DB_DIR, { recursive: true }); dbDirReady = true; }
  const tmp = `${DB_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(db));
  await rename(tmp, DB_FILE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveChain = saveChain.then(persist).catch((e) => console.error('save failed', e));
  }, 300);
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
// Heartbeat: keep SSE connections alive through proxies, and bound in-memory state by sweeping
// expired magic/session tokens and stale rate-limit buckets.
const _housekeep = setInterval(() => {
  for (const set of streams.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch { /* gone */ } }
  const now = Date.now();
  for (const k of Object.keys(db.magicTokens)) if (db.magicTokens[k].exp < now) delete db.magicTokens[k];
  for (const k of Object.keys(db.guestTokens)) { const s = db.guestTokens[k]; if (s.exp && s.exp < now) delete db.guestTokens[k]; }
  for (const [k, e] of _rl) if (e.resetAt < now) _rl.delete(k);
}, 25_000);
_housekeep.unref?.();

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...SEC_HEADERS });
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
  return !!token && timingSafeEqualStr(token, HOST_PASSCODE);
}
// Constant-time string compare so the passcode can't be probed via response timing.
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) { try { timingSafeEqual(ab, ab); } catch {} return false; }
  return timingSafeEqual(ab, bb);
}

// Only ever store photos that are genuine image data URLs — a rating field carrying
// anything else (e.g. a string crafted to break out of an <img src>) is dropped, not saved.
const DATA_IMG_RE = /^data:image\/(?:jpe?g|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
function sanitizePhotos(r) {
  for (const k of ['photoBottle', 'photoFood', 'photo']) {
    if (!(k in r)) continue;
    const v = r[k];
    if (v === null || v === '') continue;                 // allow explicit clear
    if (typeof v !== 'string' || v.length > 9_000_000 || !DATA_IMG_RE.test(v)) delete r[k];
  }
}

// Only known fields are ever written — an attacker can't smuggle arbitrary properties into a record.
const pick = (obj, keys) => { const o = {}; for (const k of keys) if (k in obj) o[k] = obj[k]; return o; };
const RATING_FIELDS = ['id', 'guestId', 'eventId', 'sakeId', 'guestEvent', 's1', 's2', 'wouldBuy', 'photoBottle', 'photoFood', 'photo', 'note', 'logged', 'createdAt', 'updatedAt'];
const GUEST_FIELDS = ['id', 'name', 'email', 'consentMarketing', 'consentPhotoFood', 'consentPhotoMe', 'consentAt', 'eventIds', 'createdAt', 'identified'];
const SAKE_FIELDS = ['id', 'name', 'romaji', 'brewery', 'region', 'grade', 'type4', 'temp', 'smv', 'acidity', 'amino', 'abv', 'seimai', 'profile', 'tags', 'adhoc', 'eventId', 'addedBy', '_deleted'];
// Generous ceilings that never bite a real event but cap runaway abuse of the open write endpoints.
const MAX_RATINGS_PER_EVENT = 6000, MAX_GUESTS_PER_EVENT = 1500, MAX_SAKES = 6000;
const countBy = (coll, pred) => Object.values(coll).reduce((n, x) => n + (pred(x) ? 1 : 0), 0);

/* ---------- rate limiting (in-memory) ---------- */
const _rl = new Map();   // key -> { count, resetAt }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const e = _rl.get(key);
  if (!e || e.resetAt < now) { _rl.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++; return true;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

/* ---------- security headers ---------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

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
function isPrivateIp(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 127 || o[0] === 10 || o[0] === 0) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;                 // link-local + cloud metadata (169.254.169.254)
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;    // CGNAT
    return false;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return true;  // link-local + ULA
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));                          // v4-mapped
    return false;
  }
  return false;
}
// Resolve the host and require EVERY address to be public — defeats numeric-IP encodings
// (http://2130706433/) and names that resolve to internal/metadata addresses. (Host-only endpoint;
// full DNS-rebind protection would additionally pin the socket to the validated IP.)
async function isSafeUrl(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !isPrivateIp(host);
  if (/^(0x[0-9a-f]+|\d+|0[0-7]+)$/i.test(host)) return false;     // decimal/hex/octal integer "IP"
  try {
    const addrs = await dnsLookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { return false; }
}
async function lookupVenue(input) {
  let url = (input || '').trim();
  if (!url) throw new Error('no url');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!(await isSafeUrl(url))) throw new Error('unsupported url');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let finalUrl = url, html = '';
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SakeJourney/1.0; +https://sake-journey.com)', Accept: 'text/html,*/*' },
    });
    finalUrl = r.url || url;
    if (!(await isSafeUrl(finalUrl))) throw new Error('redirected to unsupported url');
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

// Links inside emails must NEVER be derived from the client Host header (host-header injection →
// poisoned magic links → account takeover). Always use the configured PUBLIC_URL; localhost only for dev.
function baseUrl() {
  return (PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
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
  if (!s) return null;
  if (s.exp && s.exp < Date.now()) { delete db.guestTokens[tok]; save(); return null; }
  return s.email;
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
  return emailShell(inner, `You're receiving this because you asked us to email your recap of ${escHtml(event.title)}. <a href="${escHtml(unsubLink)}" style="color:#8a96a0">Unsubscribe</a>.`);
}

/* ---------- API ---------- */
async function handleAPI(req, res, url) {
  const p = url.pathname;
  const eventId = url.searchParams.get('event');

  if (req.method === 'GET' && p === '/api/health') return sendJSON(res, 200, { ok: true, menuScan: !!ANTHROPIC_API_KEY });

  // Host login — validates the shared passcode (which then rides as a Bearer token).
  if (req.method === 'POST' && p === '/api/host/login') {
    if (!rateLimit('hl:' + clientIp(req), 12, 5 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: 'too_many_attempts' });
    const b = await readBody(req);
    if (b.passcode && timingSafeEqualStr(b.passcode, HOST_PASSCODE)) return sendJSON(res, 200, { ok: true });
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
    // Throttle by IP and by target email so this can't be used to bomb a victim's inbox.
    if (!rateLimit('gli:' + clientIp(req), 20, 10 * 60 * 1000) || !rateLimit('gle:' + email, 5, 15 * 60 * 1000))
      return sendJSON(res, 429, { error: 'too_many_requests' });
    const hasAccount = guestsByEmail(email).length > 0;
    const link = `${baseUrl()}/#/claim/${makeMagicToken(email, 15 * 60 * 1000)}`;
    if (RESEND_API_KEY) {
      try { await sendEmail({ to: email, subject: 'Your Sake Journey sign-in link', html: magicLinkEmail(link), text: `Open your sake journey: ${link}` }); }
      catch (e) { console.error('login email failed:', e.message); return sendJSON(res, 502, { error: 'email_failed', message: e.message }); }
      return sendJSON(res, 200, { ok: true, sent: true, hasAccount });
    }
    // Return the link only in dev (no PUBLIC_URL configured). A configured deployment NEVER hands a
    // valid token back over the API — otherwise anyone could claim any email.
    if (!PUBLIC_URL) return sendJSON(res, 200, { ok: true, sent: false, hasAccount, devLink: link });
    return sendJSON(res, 200, { ok: true, sent: false, hasAccount, error: 'email_not_configured' });
  }

  // Festival trial: an allow-listed email signs in with the shared password (no magic link) and gets
  // the same guest session token a magic-link claim would issue.
  if (req.method === 'POST' && p === '/api/guest/password-login') {
    if (!rateLimit('gpl:' + clientIp(req), 20, 10 * 60 * 1000)) return sendJSON(res, 429, { error: 'too_many_requests' });
    const b = await readBody(req);
    const email = normEmail(b.email);
    if (!email.includes('@')) return sendJSON(res, 400, { error: 'bad_email' });
    if (!FESTIVAL_EMAILS.has(email) || !timingSafeEqualStr(String(b.password || ''), FESTIVAL_PASSCODE))
      return sendJSON(res, 401, { error: 'invalid_login' });
    let guest = canonicalGuest(email);
    if (!guest) {
      guest = { id: 'g_' + rid(6).slice(0, 8), name: '', email, consentMarketing: false, consentPhotoFood: false, consentPhotoMe: false, eventIds: [], createdAt: Date.now(), identified: true };
      db.guests[guest.id] = guest;
    }
    const sessionToken = rid(24);
    db.guestTokens[sessionToken] = { email, createdAt: Date.now(), exp: Date.now() + 90 * 24 * 60 * 60 * 1000 };
    save();
    return sendJSON(res, 200, { sessionToken, email, guest });
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
    db.guestTokens[sessionToken] = { email: t.email, createdAt: Date.now(), exp: Date.now() + 90 * 24 * 60 * 60 * 1000 };
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
    const base = baseUrl();
    // A recap is a transactional email the guest ASKED for (they chose to save/email their night).
    // It is NOT gated by marketing consent — only an explicit unsubscribe removes them.
    const recipients = Object.values(db.guests)
      .filter((g) => g.identified && g.email && !g.unsubscribed && (g.eventIds || []).includes(event.id))
      .filter((g) => guestEventItems(g.id, event).length > 0);
    const build = (g) => {
      if (!g.unsubToken) g.unsubToken = rid(12);   // stable opaque per-guest unsubscribe token
      const items = guestEventItems(g.id, event);
      const journeyLink = `${base}/#/claim/${makeMagicToken(g.email, 30 * 24 * 60 * 60 * 1000)}`;
      const unsubLink = `${base}/unsubscribe?u=${encodeURIComponent(g.unsubToken)}`;
      return recapEmail(g, event, items, journeyLink, unsubLink);
    };
    if (!RESEND_API_KEY) {
      return sendJSON(res, 200, { error: 'email_not_configured', wouldSend: recipients.length, preview: recipients[0] ? build(recipients[0]) : null });
    }
    // Idempotency: a double-click or a live re-render firing a second send within a minute is a no-op.
    const now = Date.now();
    if (event._lastRecapAt && now - event._lastRecapAt < 60_000)
      return sendJSON(res, 200, { sent: 0, skipped: true, reason: 'just_sent', recipients: recipients.length });
    event._lastRecapAt = now; save();
    let sent = 0, failed = 0;
    for (const g of recipients) {
      try { await sendEmail({ to: g.email, subject: `Your night at ${event.title}`, html: build(g) }); sent++; }
      catch (e) { failed++; console.error('recap email failed:', g.email, e.message); }
    }
    save();
    return sendJSON(res, 200, { sent, failed, recipients: recipients.length });
  }

  // Everything a device needs to render events: the events + the curated sake library.
  // Ad-hoc surprise pours stay on the device that created them (and in that guest's history) —
  // they're never shipped to every device, so bootstrap can't grow without bound.
  if (req.method === 'GET' && p === '/api/bootstrap') {
    const sakes = Object.values(db.sakes).filter((s) => !s.adhoc && !s._deleted);
    return sendJSON(res, 200, { events: Object.values(db.events), sakes });
  }

  // Results feed. Two shapes:
  //  • public (default): an ANONYMOUS aggregate only — per-sake score sums + counts, and a
  //    head count. No emails, no names, no consent, no photos, no notes. Safe for guest devices
  //    (powers the "room's favourite" moment) and event ids are not secret.
  //  • full=1 (host-only): the whole room — guest records + ratings incl. photos — for the studio.
  if (req.method === 'GET' && p === '/api/results') {
    const evRatings = Object.values(db.ratings).filter((r) => r.eventId === eventId);
    if (url.searchParams.get('full')) {
      if (!isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
      const guests = Object.values(db.guests).filter((g) => (g.eventIds || []).includes(eventId));
      return sendJSON(res, 200, { guests, ratings: evRatings });
    }
    const agg = {};
    for (const r of evRatings) {
      const f = r.s2 || r.s1;
      const a = agg[r.sakeId] || (agg[r.sakeId] = { sum: 0, n: 0, buys: 0, photos: 0 });
      if (f) { a.sum += f; a.n += 1; }
      if (r.wouldBuy) a.buys += 1;
      if (r.photoBottle || r.photoFood || r.photo) a.photos += 1;
    }
    const guestCount = Object.values(db.guests).filter((g) => (g.eventIds || []).includes(eventId)).length;
    return sendJSON(res, 200, { agg, guestCount });
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

  // Upserts. Guest-facing writes are open (device-local identity) but hardened: only known fields
  // are accepted, growth is capped, and existing identified/library records can't be clobbered.
  if (req.method === 'PUT' && p === '/api/ratings') {
    const r = pick(await readBody(req), RATING_FIELDS);
    if (!r.id) return sendJSON(res, 400, { error: 'missing id' });
    sanitizePhotos(r);
    // The per-event cap guards a single hosted event from flooding; the personal journal ('solo') is a
    // shared bucket across all guests, so the per-event count doesn't apply to it.
    const evtRec = db.events[r.eventId];
    if (!db.ratings[r.id] && !(evtRec && evtRec.personal) && countBy(db.ratings, (x) => x.eventId === r.eventId) >= MAX_RATINGS_PER_EVENT)
      return sendJSON(res, 429, { error: 'event_full' });
    db.ratings[r.id] = { ...db.ratings[r.id], ...r }; save();
    broadcast(r.eventId);
    return sendJSON(res, 200, db.ratings[r.id]);
  }
  if (req.method === 'POST' && p === '/api/guests') {
    const g = pick(await readBody(req), GUEST_FIELDS);
    if (!g.id) return sendJSON(res, 400, { error: 'missing id' });
    const existing = db.guests[g.id];
    if (!existing && countBy(db.guests, () => true) >= MAX_GUESTS_PER_EVENT * 50)
      return sendJSON(res, 429, { error: 'too_many_guests' });
    if (existing && existing.identified && !g.identified) {
      // Never let a fresh, blank device record overwrite an identified guest's name/email/consent —
      // only merge additive event membership.
      const eventIds = [...new Set([...(existing.eventIds || []), ...(g.eventIds || [])])];
      db.guests[g.id] = { ...existing, eventIds };
    } else {
      db.guests[g.id] = { ...existing, ...g };
    }
    // Re-opting into marketing clears any prior unsubscribe (a migrated legacy opt-out can opt back in).
    if (g.consentMarketing === true && db.guests[g.id].unsubscribed) db.guests[g.id].unsubscribed = false;
    save();
    (g.eventIds || []).forEach((eid) => broadcast(eid));
    return sendJSON(res, 200, db.guests[g.id]);
  }
  if (req.method === 'POST' && p === '/api/sakes') {
    const s = pick(await readBody(req), SAKE_FIELDS);
    if (!s.id) return sendJSON(res, 400, { error: 'missing id' });
    const existing = db.sakes[s.id];
    // Library bottles are host-only. A guest's ad-hoc pour may NOT overwrite an existing library bottle.
    if ((!s.adhoc || (existing && !existing.adhoc)) && !isHost(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    if (!existing && countBy(db.sakes, () => true) >= MAX_SAKES) return sendJSON(res, 429, { error: 'too_many_sakes' });
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
    const headers = { 'Content-Type': type, ...SEC_HEADERS };
    if (type === MIME['.html']) headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    // SPA-ish fallback for unknown non-file routes → index.html
    if (!extname(file)) {
      try { const html = await readFile(join(ROOT, 'index.html')); res.writeHead(200, { 'Content-Type': MIME['.html'], ...SEC_HEADERS, 'Content-Security-Policy': CSP }); return res.end(html); }
      catch { /* fall through */ }
    }
    res.writeHead(404); res.end('not found');
  }
}

/* ---------- Server ---------- */
function handleUnsubscribe(req, res, url) {
  // Token-based: only the opaque per-guest token in the emailed link can unsubscribe that guest —
  // no one can unsubscribe someone else by guessing their email address.
  const u = url.searchParams.get('u');
  let done = false;
  if (u) {
    for (const g of Object.values(db.guests)) if (g.unsubToken && g.unsubToken === u) { g.consentMarketing = false; g.unsubscribed = true; done = true; }
    if (done) save();
  }
  const msg = done
    ? "You've been unsubscribed. You won't receive further emails from Sake Journey."
    : 'This unsubscribe link is invalid or has expired.';
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4efe6;color:#17303f;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:400px;padding:24px"><div style="font-family:Georgia,serif;font-size:26px;color:#024e82">Sake Journey</div><p style="margin-top:16px;font-size:15px;line-height:1.5">${escHtml(msg)}</p></div></body>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS, 'Content-Security-Policy': CSP });
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
