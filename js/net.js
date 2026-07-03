/* ============================================================
   Sake Journey — network layer
   Talks to the live backend when reachable; degrades gracefully
   to offline. Writes that fail are queued in an outbox and
   flushed on reconnect, so nothing a guest captures is ever lost.
   ============================================================ */

import { Outbox } from './store.js';

const BASE = '';                        // same origin
let reachable = null;                   // null=unknown, true/false after first try

/* ---------- outbox (durable, in IndexedDB — see store.js) ----------
   Bodies for the SAME target (method+path+id) MERGE, so a patch stream (s1 → a photo → wouldBuy)
   accumulates into one complete replay instead of the last write clobbering earlier fields.
   All mutations go through a mutex so a get-then-put can't interleave with another write. */
let _obLock = Promise.resolve();
let _obSeq = Date.now();   // ever-increasing across reloads → an entry's seq changes on every re-enqueue
function withOutbox(fn) { const run = _obLock.then(fn, fn); _obLock = run.then(() => {}, () => {}); return run; }

function enqueue(method, path, body) {
  return withOutbox(async () => {
    const k = `${method} ${path} ${(body && body.id) || ''}`;
    let merged = body;
    if (body && typeof body === 'object') {
      const prev = await Outbox.get(k);
      if (prev && prev.body && typeof prev.body === 'object') merged = { ...prev.body, ...body };
    }
    await Outbox.put(k, { method, path, body: merged, seq: ++_obSeq });
  });
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
  catch { reachable = false; await enqueue(method, path, body); return null; }
}

// Single-flight flush: one drainer at a time (no read-modify-write race that loses queued writes),
// deleting each entry from the live store as it sends. A 4xx (bad request) is dropped so it can't
// wedge the queue forever; a network/5xx error stops the drain and we retry on the next trigger.
let _flushing = false;
export async function flushOutbox() {
  if (_flushing) return;
  _flushing = true;
  try {
    const items = await withOutbox(() => Outbox.all());
    for (const it of items) {
      try {
        await raw(it.method, it.path, it.body);            // network — outside the outbox lock
        // Delete only if unchanged since our snapshot; if a write merged new fields (a higher seq) in
        // the meantime, leave it so the next flush sends the newer, complete body. Seq works for every
        // body type (guest/sake/event have no updatedAt), so no concurrent update is ever dropped.
        await withOutbox(async () => { const cur = await Outbox.get(it.k); if (cur && cur.seq === it.seq) await Outbox.del(it.k); });
      } catch (e) {
        const m = /-> (\d+)$/.exec(String(e && e.message));
        const status = m ? +m[1] : 0;
        if (status >= 400 && status < 500) { await withOutbox(() => Outbox.del(it.k)); continue; }  // poison → drop
        break;                                                                                      // offline/5xx → stop, keep rest
      }
    }
  } finally { _flushing = false; }
}

/* ---------- reads ---------- */
export async function bootstrap() {
  try { return await raw('GET', '/api/bootstrap'); }
  catch { reachable = false; return null; }
}

// Results feed. Default = anonymous aggregate { agg, guestCount } (safe for guests).
// { full:true } = the host's full { guests, ratings } (needs the host Bearer; 401 otherwise).
// A short TTL cache + in-flight coalescing so concurrent callers share one request.
let _resCache = { key: null, at: 0, data: null };
const _resInflight = new Map();
export async function results(eventId, { full = false } = {}) {
  const key = (full ? 'full:' : 'agg:') + eventId;
  const now = Date.now();
  if (_resCache.key === key && now - _resCache.at < 700) return _resCache.data;
  if (_resInflight.has(key)) return _resInflight.get(key);
  const q = `/api/results?event=${encodeURIComponent(eventId)}${full ? '&full=1' : ''}`;
  const pr = raw('GET', q)
    .then((data) => { _resCache = { key, at: Date.now(), data }; return data; })
    .catch(() => { reachable = false; return null; })
    .finally(() => { _resInflight.delete(key); });
  _resInflight.set(key, pr);
  return pr;
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
  try {
    const r = await fetch(BASE + '/api/guest/history', { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401) { setGuestSession(null); return null; }
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch { return null; }   // offline — history() falls back to the local-device branch
}

/** Host: send recap emails for an event. Returns { sent, failed } or { error, wouldSend, preview }. */
export async function sendRecaps(eventId) {
  const r = await fetch(BASE + '/api/host/send-recaps', { method: 'POST', headers: headersFor({}), body: JSON.stringify({ eventId }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
  return data;
}

/* ---------- live stream (SSE) ---------- */
let activeSource = null, activeEventId = null;
export function closeStream() {
  if (activeSource) { try { activeSource.close(); } catch {} activeSource = null; }
  activeEventId = null;
}
/** Subscribe to live updates for an event. Idempotent per event (re-renders don't churn the
    connection); re-syncs on reconnect. Returns an unsubscribe fn. */
export function subscribe(eventId, onUpdate) {
  if (activeSource && activeEventId === eventId) return closeStream;   // already streaming this event
  closeStream();
  if (typeof EventSource === 'undefined') return () => {};
  try {
    const es = new EventSource(`/api/stream?event=${encodeURIComponent(eventId)}`);
    let opened = false;
    es.addEventListener('update', onUpdate);
    es.addEventListener('event', onUpdate);
    es.onopen = () => { if (opened) onUpdate(); opened = true; };      // reconnect → re-sync missed updates
    es.onerror = () => { /* browser auto-reconnects */ };
    activeSource = es; activeEventId = eventId;
  } catch { return () => {}; }
  return closeStream;
}

/* Flush the outbox whenever we come back online. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', flushOutbox);
}
