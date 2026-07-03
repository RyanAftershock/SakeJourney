/* ============================================================
   Sake Journey — network layer
   Talks to the live backend when reachable; degrades gracefully
   to offline. Writes that fail are queued in an outbox and
   flushed on reconnect, so nothing a guest captures is ever lost.
   ============================================================ */

const BASE = '';                        // same origin
let reachable = null;                   // null=unknown, true/false after first try
const OUTBOX_KEY = 'sj_outbox';

/* ---------- outbox (localStorage, deduped by target) ---------- */
function loadOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || {}; } catch { return {}; } }
function saveOutbox(o) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); } catch { /* quota */ } }
function enqueue(method, path, body) {
  const o = loadOutbox();
  o[`${method} ${path} ${(body && body.id) || ''}`] = { method, path, body };
  saveOutbox(o);
}

/* ---------- host auth (shared passcode → Bearer token) ---------- */
export function hostKey() { try { return localStorage.getItem('sj_hostkey') || ''; } catch { return ''; } }
export function setHostKey(k) { try { k ? localStorage.setItem('sj_hostkey', k) : localStorage.removeItem('sj_hostkey'); } catch {} }

function headersFor(body) {
  const h = {};
  if (body) h['Content-Type'] = 'application/json';
  const k = hostKey();
  if (k) h['Authorization'] = 'Bearer ' + k;   // ignored by the server on guest endpoints
  return h;
}

async function raw(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: headersFor(body),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  reachable = true;
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Write that tolerates being offline: queues on failure, returns null. */
async function write(method, path, body) {
  try { const r = await raw(method, path, body); flushOutbox(); return r; }
  catch { reachable = false; enqueue(method, path, body); return null; }
}

export async function flushOutbox() {
  const o = loadOutbox();
  const keys = Object.keys(o);
  if (!keys.length) return;
  for (const k of keys) {
    const { method, path, body } = o[k];
    try { await raw(method, path, body); delete o[k]; }
    catch { break; }                    // still offline — stop, keep the rest
  }
  saveOutbox(o);
}

/* ---------- reads ---------- */
export async function bootstrap() {
  try { return await raw('GET', '/api/bootstrap'); }
  catch { reachable = false; return null; }
}

// Small TTL cache so host-results + room-favourite don't double-fetch.
let _resCache = { key: null, at: 0, data: null };
export async function results(eventId) {
  const now = Date.now();
  if (_resCache.key === eventId && now - _resCache.at < 700) return _resCache.data;
  try {
    const data = await raw('GET', `/api/results?event=${encodeURIComponent(eventId)}`);
    _resCache = { key: eventId, at: now, data };
    return data;
  } catch { reachable = false; return null; }
}

/* ---------- writes ---------- */
export const pushRating = (r) => write('PUT', '/api/ratings', r);
export const pushGuest  = (g) => write('POST', '/api/guests', g);
export const pushSake   = (s) => write('POST', '/api/sakes', s);
export const pushEvent  = (e) => write('PUT', '/api/events', e);
export const deleteSake = (id) => write('DELETE', `/api/sakes?id=${encodeURIComponent(id)}`, null);

export const isReachable = () => reachable;

/** Validate the host passcode against the server (returns true on success). */
export async function hostLogin(passcode) {
  try {
    const r = await fetch(BASE + '/api/host/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    return r.ok;
  } catch { return false; }
}

/** Send a menu photo (dataURL) to be parsed into a draft event. Throws with a message on failure. */
export async function parseMenu(dataUrl) {
  const r = await fetch(BASE + '/api/parse-menu', {
    method: 'POST', headers: headersFor({}),
    body: JSON.stringify({ image: dataUrl }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}

/** Look up a restaurant's website → { name, image, website, menuUrl, reserveUrl }. */
export async function venueLookup(url) {
  const r = await fetch(BASE + '/api/venue-lookup', {
    method: 'POST', headers: headersFor({}),
    body: JSON.stringify({ url }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}

/* ---------- guest accounts (email magic-link) ---------- */
export const guestToken = () => { try { return localStorage.getItem('sj_guesttoken') || ''; } catch { return ''; } };
export const guestEmail = () => { try { return localStorage.getItem('sj_guestemail') || ''; } catch { return ''; } };
export function setGuestSession(token, email) {
  try {
    if (token) { localStorage.setItem('sj_guesttoken', token); localStorage.setItem('sj_guestemail', email || ''); }
    else { localStorage.removeItem('sj_guesttoken'); localStorage.removeItem('sj_guestemail'); }
  } catch {}
}

/** Request a sign-in link. Returns { sent, hasAccount, devLink? }. */
export async function guestLogin(email) {
  const r = await fetch(BASE + '/api/guest/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}
/** Claim a magic-link token → { sessionToken, email, guest }. */
export async function guestClaim(token) {
  const r = await fetch(BASE + '/api/guest/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
/** Cross-device journey for the signed-in email, or null if not signed in / expired. */
export async function guestHistory() {
  const tok = guestToken();
  if (!tok) return null;
  const r = await fetch(BASE + '/api/guest/history', { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 401) { setGuestSession(null); return null; }
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** Host: send recap emails for an event. Returns { sent, failed } or { error, wouldSend, preview }. */
export async function sendRecaps(eventId) {
  const r = await fetch(BASE + '/api/host/send-recaps', { method: 'POST', headers: headersFor({}), body: JSON.stringify({ eventId }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}

/* ---------- live stream (SSE) ---------- */
let activeSource = null;
export function closeStream() {
  if (activeSource) { try { activeSource.close(); } catch {} activeSource = null; }
}
/** Subscribe to live updates for an event. Returns an unsubscribe fn. */
export function subscribe(eventId, onUpdate) {
  closeStream();
  if (typeof EventSource === 'undefined') return () => {};
  try {
    const es = new EventSource(`/api/stream?event=${encodeURIComponent(eventId)}`);
    es.addEventListener('update', onUpdate);
    es.addEventListener('event', onUpdate);
    es.onerror = () => { /* browser auto-reconnects */ };
    activeSource = es;
  } catch { return () => {}; }
  return closeStream;
}

/* Flush the outbox whenever we come back online. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', flushOutbox);
}
