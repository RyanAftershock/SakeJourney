/* ============================================================
   Sake Journey — data layer
   IndexedDB (durable, offline) + a thin in-memory cache.
   Everything a guest captures survives reloads and dead wifi.
   A backend can later replace the persist() calls 1:1.
   ============================================================ */

import { SEED_EVENT, SEED_SAKES } from './seed.js';
import * as Net from './net.js';

const DB_NAME = 'sake-journey';
const DB_VERSION = 1;

/** Generate a short unique id (crypto when available, else fallback). */
export function uid(prefix = 'id') {
  try {
    if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch (_) { /* not a secure context — fall through */ }
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sakes'))  db.createObjectStore('sakes',  { keyPath: 'id' });
      if (!db.objectStoreNames.contains('guests')) db.createObjectStore('guests', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ratings')) {
        const r = db.createObjectStore('ratings', { keyPath: 'id' });
        r.createIndex('eventId', 'eventId', { unique: false });
        r.createIndex('guestEvent', 'guestEvent', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(store, value) { return reqP((await tx(store, 'readwrite')).put(value)); }
async function get(store, key)   { return reqP((await tx(store, 'readonly')).get(key)); }
async function del(store, key)   { return reqP((await tx(store, 'readwrite')).delete(key)); }
async function all(store)        { return reqP((await tx(store, 'readonly')).getAll()); }
async function allByIndex(store, index, key) {
  const os = await tx(store, 'readonly');
  return reqP(os.index(index).getAll(key));
}

/* ---------- Session (light, in localStorage) ---------- */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sj_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sj_' + k, JSON.stringify(v)); } catch {} },
};

export const session = {
  get activeEventId() { return LS.get('activeEventId', SEED_EVENT.id); },
  set activeEventId(v) { LS.set('activeEventId', v); },
  get guestId() { return LS.get('guestId', null); },
  set guestId(v) { LS.set('guestId', v); },
  get theme() { return LS.get('theme', null); },
  set theme(v) { LS.set('theme', v); },
};

/* ---------- Bootstrap / seed ---------- */
export async function initStore() {
  await openDB();
  const seeded = await get('meta', 'seeded');
  if (!seeded) {
    for (const s of SEED_SAKES) await put('sakes', s);
    await put('events', SEED_EVENT);
    await put('meta', { k: 'seeded', at: Date.now() });
  }
  // Sync with the backend when reachable: pull the shared events + sake library
  // (so every device sees the same menu Kana - Sake Journey authored) and flush offline writes.
  try {
    const boot = await Net.bootstrap();
    if (boot) {
      for (const e of boot.events || []) await put('events', e);
      for (const s of boot.sakes || []) await put('sakes', s);
    }
    await Net.flushOutbox();
  } catch { /* offline — the local seed stands in */ }
}

/** Wipe everything and re-seed — handy for demos. */
export async function resetAll() {
  const db = await openDB();
  await Promise.all(['events', 'sakes', 'guests', 'ratings', 'meta'].map(
    (s) => reqP(db.transaction(s, 'readwrite').objectStore(s).clear())
  ));
  session.guestId = null;
  await initStore();
}

/* ---------- Events ---------- */
export const Events = {
  get: (id) => get('events', id),
  all: () => all('events'),
  async save(ev) { await put('events', ev); Net.pushEvent(ev); return ev; },
};

/* ---------- Sakes (the reusable library / moat) ---------- */
export const Sakes = {
  get: (id) => get('sakes', id),
  // The curated library: excludes soft-deleted bottles and guests' ad-hoc surprise pours.
  async all() { return (await all('sakes')).filter((s) => !s._deleted && !s.adhoc); },
  async save(s) { await put('sakes', s); Net.pushSake(s); return s; },
  async delete(id) { await del('sakes', id); Net.deleteSake(id); },
};

/* ---------- Guests ---------- */
// Serialise ensure() so two concurrent renders on load can't each mint a guest
// before session.guestId is persisted (would create phantom duplicate guests).
let _ensureChain = Promise.resolve();
async function ensureGuest(eventId) {
  // Reserve the guest id SYNCHRONOUSLY — read and write with no await between —
  // so two concurrent callers can never both see a null id and mint duplicates.
  let id = session.guestId;
  if (!id) { id = uid('g'); session.guestId = id; }
  let g = await get('guests', id);
  let dirty = false;
  if (!g) {
    g = { id, name: '', email: '', consentMarketing: false,
          consentPhotoFood: false, consentPhotoMe: false,
          eventIds: [], createdAt: Date.now(), identified: false };
    dirty = true;
  }
  if (!g.eventIds.includes(eventId)) { g.eventIds.push(eventId); dirty = true; }
  if (dirty) { await put('guests', g); Net.pushGuest(g); }
  return g;
}

export const Guests = {
  get: (id) => get('guests', id),
  all: () => all('guests'),
  async save(g) { await put('guests', g); Net.pushGuest(g); return g; },
  /** All guests at an event — from the server (every device) when online, else local. */
  async forEvent(eventId) {
    const srv = await Net.results(eventId);
    if (srv && srv.guests) return srv.guests;
    const gs = await all('guests');
    return gs.filter((g) => (g.eventIds || []).includes(eventId));
  },
  /** Ensure there is a current guest for this device+event (provisional, no PII yet). */
  ensure(eventId) {
    const run = _ensureChain.then(() => ensureGuest(eventId));
    _ensureChain = run.catch(() => {});
    return run;
  },
};

/* ---------- Ratings ----------
   One row per (guest, event, sake). Holds both the in-the-moment
   score (s1) and the de-anchored end-of-night score (s2), the
   "would buy" intent flag, and the guest's photo (dataURL).       */
export const Ratings = {
  key: (guestId, eventId, sakeId) => `${guestId}__${eventId}__${sakeId}`,
  get: (guestId, eventId, sakeId) => get('ratings', Ratings.key(guestId, eventId, sakeId)),

  async save(guestId, eventId, sakeId, patch) {
    const key = Ratings.key(guestId, eventId, sakeId);
    const existing = (await get('ratings', key)) || {
      id: key, guestId, eventId, sakeId, guestEvent: `${guestId}__${eventId}`,
      s1: null, s2: null, wouldBuy: false, photo: null, note: '', createdAt: Date.now(),
    };
    Object.assign(existing, patch, { updatedAt: Date.now() });
    await put('ratings', existing);
    Net.pushRating(existing);            // sync to the shared event (offline-queued if needed)
    return existing;
  },

  // This guest's own ratings — always local (works offline; it's their device's data).
  forGuestEvent: (guestId, eventId) => allByIndex('ratings', 'guestEvent', `${guestId}__${eventId}`),

  // Every guest's ratings for an event — from the server (the whole room) when online.
  async forEvent(eventId) {
    const srv = await Net.results(eventId);
    if (srv && srv.ratings) return srv.ratings;
    return allByIndex('ratings', 'eventId', eventId);
  },
};
