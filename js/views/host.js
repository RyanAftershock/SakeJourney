/* ============================================================
   Sake Journey — host tools (Kana - Sake Journey's side)
   Build events, curate the reusable sake library (the moat),
   read the room's results, and hand guests a QR.
   ============================================================ */

import { Events, Sakes, Guests, Ratings, session, uid, resetAll } from '../store.js';
import * as Net from '../net.js';
import { TEMPS, TYPE4 } from '../seed.js';
import {
  $, $$, node, esc, svg, gradeLabel, quadrantHTML, tempHTML, miniHearts,
  toast, openSheet, closeSheet, fmtDate, pickPhoto,
} from '../ui.js';
import { applyTheme } from '../app.js';

const app = () => document.getElementById('app');
const go = (h) => { location.hash = h; };

const GRADES = ['junmai', 'junmai_ginjo', 'junmai_daiginjo', 'ginjo', 'daiginjo', 'honjozo', 'nigori', 'sparkling', 'koshu'];

/* ---------- host access gate (shared passcode) ---------- */
const hostAuthed = () => !!Net.hostKey();
/** Call at the top of every host view: renders the passcode screen and returns true if not yet authed. */
function requireHostAuth() {
  if (hostAuthed()) return false;
  loginScreen();
  return true;
}
function loginScreen() {
  app().innerHTML = `
    <div class="screen">
      <div class="topbar">
        <a class="brand" href="#/"><span class="brand-logo" role="img" aria-label="Sake Journey"></span></a>
        <span style="width:42px"></span>
      </div>
      <div class="flex-grow" style="display:grid;place-items:center;text-align:center">
        <div style="max-width:340px;width:100%">
          <div class="hero-mark">${svg('users', 'accent')}</div>
          <h1 class="display" style="font-size:2rem;margin:12px 0 6px">Host studio</h1>
          <p class="muted" style="font-size:.95rem;margin-bottom:20px">Enter your passcode to manage events.</p>
          <input class="inp" id="pass" type="password" placeholder="Passcode" style="text-align:center" autocomplete="current-password">
          <button class="btn primary block mt-16" id="unlock">Unlock</button>
          <button class="linkbtn mt-8" id="toGuest2" style="display:block;margin:10px auto 0">Back to the event</button>
        </div>
      </div>
    </div>`;
  const submit = async () => {
    const pass = $('#pass').value.trim();
    if (!pass) return;
    if (await Net.hostLogin(pass)) { Net.setHostKey(pass); location.reload(); }
    else toast('Wrong passcode');
  };
  $('#unlock').onclick = submit;
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('#toGuest2').onclick = () => go('#/');
}
const THEMES = [['default', 'Daylight'], ['jazz', 'Evening'], ['ghibli', 'Warm']];

function hostShell(title, bodyHTML, { back = '#/host' } = {}) {
  return `
    <div class="screen">
      <div class="topbar">
        <button class="iconbtn" id="hback" aria-label="Back">${svg('back')}</button>
        <span class="eyebrow">${esc(title)}</span>
        <button class="iconbtn" id="toGuest" aria-label="Guest view">${svg('cup')}</button>
      </div>
      ${bodyHTML}
    </div>`;
}
function wireShell(back) {
  $('#hback').onclick = () => go(back);
  if ($('#toGuest')) $('#toGuest').onclick = () => go('#/');
}

/* ============================================================
   HOME — events + library entry
   ============================================================ */
export async function home() {
  if (requireHostAuth()) return;
  applyTheme(session.theme || 'default');
  const events = await Events.all();
  const sakes = await Sakes.all();

  const rows = await Promise.all(events.map(async (ev) => {
    const guests = await Guests.forEvent(ev.id);
    return `
      <div class="list-row" data-ev="${ev.id}">
        <div class="lr-main">
          <div class="t">${esc(ev.title)}</div>
          <div class="s">${esc(fmtDate(ev.date))} · ${ev.courses.length} pours · ${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}</div>
        </div>
        <span class="chev">${svg('chev')}</span>
      </div>`;
  }));

  app().innerHTML = `
    <div class="screen">
      <div class="topbar">
        <div class="brand"><span class="brand-logo sm" role="img" aria-label="Sake Journey"></span>
          <span class="pill" style="padding:3px 9px;font-size:.7rem">Host</span></div>
        <button class="iconbtn" id="toGuest" aria-label="Guest view">${svg('cup')}</button>
      </div>

      <div class="row between mt-8">
        <h1 class="serif" style="font-size:1.9rem">Your events</h1>
        <button class="btn small primary" id="newEv">${svg('plus')} New</button>
      </div>
      <div class="mt-16">${rows.join('') || emptyState('No events yet', 'Create your first tasting.')}</div>

      <div class="divider"><span class="k">蔵</span></div>

      <div class="list-row" id="toLibrary">
        <span class="iconbtn" style="pointer-events:none">${svg('book')}</span>
        <div class="lr-main"><div class="t">Sake library</div>
          <div class="s">${sakes.length} bottles · reused across every event</div></div>
        <span class="chev">${svg('chev')}</span>
      </div>

      <div class="mt-32 center">
        <div class="eyebrow" style="color:var(--ink-3);margin-bottom:10px">Theme preview</div>
        <div class="seg" id="themeSeg" style="max-width:320px;margin:auto">
          ${THEMES.map(([t, label]) => `<button data-t="${t}" class="${(session.theme || 'default') === t ? 'on' : ''}">${label}</button>`).join('')}
        </div>
        <div class="row gap-16" style="justify-content:center;margin-top:16px">
          <button class="linkbtn" id="reset">Reset demo data</button>
          <button class="linkbtn" id="logout">Lock studio</button>
        </div>
      </div>
    </div>`;

  $('#toGuest').onclick = () => go('#/');
  $('#newEv').onclick = createEvent;
  $('#toLibrary').onclick = () => go('#/host/library');
  $$('.list-row[data-ev]').forEach((r) => r.onclick = () => openEventMenu(r.dataset.ev));
  $$('#themeSeg button').forEach((b) => b.onclick = () => { session.theme = b.dataset.t; applyTheme(b.dataset.t); home(); });
  $('#reset').onclick = async () => { if (confirm('Reset all demo data and guest ratings?')) { await resetAll(); toast('Demo data reset'); home(); } };
  $('#logout').onclick = () => { Net.setHostKey(''); toast('Studio locked'); go('#/'); };
}

function emptyState(t, s) {
  return `<div class="empty"><div class="glyph">🍶</div><div class="serif" style="font-size:1.2rem;color:var(--ink-2)">${esc(t)}</div><div class="faint">${esc(s)}</div></div>`;
}

function openEventMenu(id) {
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.5rem;margin-bottom:14px">Manage event</h2>
    <button class="btn subtle block mb" id="mEdit" style="margin-bottom:10px">${svg('edit')} Edit menu & pairings</button>
    <button class="btn subtle block mb" id="mResults" style="margin-bottom:10px">${svg('chart')} Results & guests</button>
    <button class="btn subtle block mb" id="mShare" style="margin-bottom:10px">${svg('qr')} Share / QR code</button>
    <button class="btn subtle block" id="mOpen">${svg('cup')} Open as a guest</button>
  `);
  body.querySelector('#mEdit').onclick = () => { closeSheet(); go(`#/host/event/${id}`); };
  body.querySelector('#mResults').onclick = () => { closeSheet(); go(`#/host/results/${id}`); };
  body.querySelector('#mShare').onclick = () => { closeSheet(); go(`#/host/share/${id}`); };
  body.querySelector('#mOpen').onclick = () => { closeSheet(); session.activeEventId = id; go('#/'); };
}

async function createEvent() {
  const ev = {
    id: uid('evt'), title: 'New tasting', subtitle: 'A pairing evening', theme: 'default',
    date: new Date().toISOString().slice(0, 10), venue: 'Venue TBC', host: 'Kana - Sake Journey',
    published: false, courses: [],
  };
  await Events.save(ev);
  go(`#/host/event/${ev.id}`);
}

/* ============================================================
   EVENT EDITOR
   ============================================================ */
export async function eventEditor(id) {
  if (requireHostAuth()) return;
  const ev = await Events.get(id);
  if (!ev) return go('#/host');
  const sakes = await Sakes.all();

  const courseHTML = ev.courses.map((c, i) => {
    const s = sakes.find((x) => x.id === c.sakeId);
    return `
      <div class="course-edit" data-i="${i}">
        <div class="ce-head">
          <span class="pill accent">Pour ${i + 1}</span>
          <div class="row gap-8">
            <button class="iconbtn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${svg('back')}<span class="hidden"></span></button>
            <button class="iconbtn" data-del="${i}" aria-label="Remove">${svg('trash')}</button>
          </div>
        </div>
        <label class="field"><span class="lab">Dish</span>
          <input class="inp" data-f="name" value="${esc(c.name)}" placeholder="e.g. Pan-seared scallops"></label>
        <label class="field"><span class="lab">Description</span>
          <input class="inp" data-f="desc" value="${esc(c.desc)}" placeholder="garnishes, sauce, story"></label>
        <label class="field"><span class="lab">Paired sake</span>
          <select class="inp" data-f="sakeId">
            <option value="">— choose —</option>
            ${sakes.map((x) => `<option value="${x.id}" ${x.id === c.sakeId ? 'selected' : ''}>${esc(x.name)} · ${gradeLabel(x.grade)}</option>`).join('')}
          </select></label>
        ${s ? `<div class="faint" style="font-size:.8rem;margin:-6px 0 12px">${esc(s.romaji || '')} · ${quadName(s.type4)}</div>` : ''}
        <span class="lab">Why this pairing</span>
        <div class="seg" data-move style="margin-bottom:10px">
          ${['match', 'mirror', 'contrast'].map((m) => `<button data-m="${m}" class="${c.pairing.move === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
        </div>
        <textarea class="inp" data-f="ptext" placeholder="Match weight · mirror a flavour · contrast to cut. What makes it work?">${esc(c.pairing.text)}</textarea>
        <textarea class="inp" data-f="phost" style="margin-top:10px;min-height:56px" placeholder="A line in your voice (optional)">${esc(c.pairing.host || '')}</textarea>
      </div>`;
  }).join('');

  app().innerHTML = hostShell('Edit event', `
    <input class="inp" id="fTitle" value="${esc(ev.title)}" style="font-family:var(--font-display);font-size:1.5rem;margin-bottom:10px">
    <input class="inp" id="fSubtitle" value="${esc(ev.subtitle)}" placeholder="subtitle" style="margin-bottom:10px">
    <div class="grid-2">
      <input class="inp" id="fDate" type="date" value="${esc(ev.date)}">
      <input class="inp" id="fHost" value="${esc(ev.host)}" placeholder="host">
    </div>
    <input class="inp mt-8" id="fVenue" value="${esc(ev.venue)}" placeholder="venue / restaurant name" style="margin-top:10px">
    <div class="row gap-8" style="margin-top:10px">
      <input class="inp" id="fVenueUrl" value="${esc(ev.venueUrl || '')}" placeholder="Restaurant website (https://…)" style="flex:1">
      <button class="btn subtle small" id="fVenueLookup" type="button" style="white-space:nowrap">${svg('sparkle')} Look up</button>
    </div>
    <p class="faint" style="font-size:.74rem;margin:6px 0 0">Paste the restaurant’s website and tap Look up — we’ll pull its photo and find menu / booking links.</p>
    <div class="grid-2" style="margin-top:10px">
      <input class="inp" id="fVenueMenu" value="${esc(ev.venueMenuUrl || '')}" placeholder="Menu link">
      <input class="inp" id="fVenueReserve" value="${esc(ev.venueReserveUrl || '')}" placeholder="Reservations link">
    </div>
    <input class="inp" id="fVenueGoogle" value="${esc(ev.venueGoogleUrl || '')}" placeholder="Google Maps link (blank = auto from name)" style="margin-top:10px">
    <div class="row gap-12" style="margin-top:10px;align-items:center">
      <div style="width:56px;height:56px;border-radius:10px;flex:none;background:var(--surface-2) center/cover no-repeat;${ev.venueImage ? `background-image:url('${esc(ev.venueImage)}')` : ''}"></div>
      <button class="btn subtle small" id="fVenuePhoto" type="button">${svg('camera')} ${ev.venueImage ? 'Change' : 'Add'} photo</button>
      ${ev.venueImage ? `<button class="linkbtn" id="fVenueClear" type="button">Clear</button>` : ''}
    </div>
    <span class="lab" style="margin-top:14px;display:block">Theme</span>
    <div class="seg" id="fTheme">
      ${THEMES.map(([t, label]) => `<button data-t="${t}" class="${ev.theme === t ? 'on' : ''}">${label}</button>`).join('')}
    </div>

    <span class="lab" style="margin-top:14px;display:block">Sign-up perk <span class="faint">— lifts opt-in; shown when guests join your list</span></span>
    <input class="inp" id="fOptinPerk" value="${esc(ev.optinPerk || '')}" placeholder="e.g. 10% off your first bottle, or code SAKE10">

    <div class="divider"><span class="k">品書き</span></div>
    <button class="btn subtle block" id="scanMenu">${svg('camera')} Scan a printed menu photo</button>
    <p class="faint center" style="font-size:.76rem;margin:8px 0 0">Snap the printed menu — we’ll draft the courses & sakes for you to refine.</p>
    <div class="row between mt-24"><span class="eyebrow" style="color:var(--ink-3)">Courses</span>
      <span class="faint" style="font-size:.8rem">changes save automatically</span></div>
    <div id="courses" class="mt-16">${courseHTML || emptyState('No courses yet', 'Add your first pour, or scan a menu.')}</div>
    <button class="btn ghost block mt-8" id="addCourse">${svg('plus')} Add a pour</button>

    <div class="col gap-12 mt-24">
      <button class="btn primary block" id="preview">${svg('cup')} Preview as guest</button>
      <button class="btn subtle block" id="toShare">${svg('qr')} Get the QR code</button>
    </div>
  `);
  wireShell('#/host');

  const save = async () => { await Events.save(ev); };

  // header fields
  const bind = (sel, key, after) => { const el = $(sel); el.onchange = async () => { ev[key] = el.value; await save(); if (after) after(); }; };
  bind('#fTitle', 'title'); bind('#fSubtitle', 'subtitle'); bind('#fDate', 'date'); bind('#fHost', 'host'); bind('#fVenue', 'venue'); bind('#fOptinPerk', 'optinPerk');
  bind('#fVenueUrl', 'venueUrl'); bind('#fVenueMenu', 'venueMenuUrl'); bind('#fVenueReserve', 'venueReserveUrl'); bind('#fVenueGoogle', 'venueGoogleUrl');
  $('#fVenuePhoto').onclick = async () => { const d = await pickPhoto(); if (!d) return; ev.venueImage = d; await save(); eventEditor(id); };
  if ($('#fVenueClear')) $('#fVenueClear').onclick = async () => { ev.venueImage = ''; await save(); eventEditor(id); };
  $('#fVenueLookup').onclick = async () => {
    const url = $('#fVenueUrl').value.trim();
    if (!url) { toast('Paste the restaurant website first'); return; }
    const btn = $('#fVenueLookup'); btn.disabled = true; btn.textContent = 'Looking up…';
    try {
      const v = await Net.venueLookup(url);
      if (v.name && !ev.venue) ev.venue = v.name;
      if (v.image) ev.venueImage = v.image;
      if (v.website) ev.venueUrl = v.website;
      if (v.menuUrl) ev.venueMenuUrl = v.menuUrl;
      if (v.reserveUrl) ev.venueReserveUrl = v.reserveUrl;
      await save();
      const found = [v.image && 'photo', v.menuUrl && 'menu', v.reserveUrl && 'reservations'].filter(Boolean);
      toast(found.length ? 'Found ' + found.join(' + ') : 'Fetched — add menu / reservations manually', 2600);
      eventEditor(id);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Look up';
      toast('Lookup failed: ' + e.message, 3400);
    }
  };
  $$('#fTheme button').forEach((b) => b.onclick = async () => {
    ev.theme = b.dataset.t; $$('#fTheme button').forEach((x) => x.classList.toggle('on', x === b)); applyTheme(ev.theme); await save();
  });

  // course fields
  $$('.course-edit').forEach((box) => {
    const i = +box.dataset.i;
    box.querySelectorAll('[data-f]').forEach((el) => {
      el.onchange = async () => {
        const f = el.dataset.f;
        if (f === 'ptext') ev.courses[i].pairing.text = el.value;
        else if (f === 'phost') ev.courses[i].pairing.host = el.value;
        else ev.courses[i][f] = el.value;
        await save();
        if (f === 'sakeId') eventEditor(id);
      };
    });
    box.querySelectorAll('[data-move] button').forEach((b) => b.onclick = async () => {
      ev.courses[i].pairing.move = b.dataset.m;
      box.querySelectorAll('[data-move] button').forEach((x) => x.classList.toggle('on', x === b));
      await save();
    });
    const up = box.querySelector('[data-up]'); if (up && !up.disabled) up.onclick = async () => {
      [ev.courses[i - 1], ev.courses[i]] = [ev.courses[i], ev.courses[i - 1]];
      ev.courses.forEach((c, idx) => c.order = idx + 1); await save(); eventEditor(id);
    };
    box.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Remove this pour?')) return;
      ev.courses.splice(i, 1); ev.courses.forEach((c, idx) => c.order = idx + 1); await save(); eventEditor(id);
    };
  });

  $('#scanMenu').onclick = () => scanMenu(ev);
  $('#addCourse').onclick = async () => {
    ev.courses.push({ id: uid('c'), order: ev.courses.length + 1, name: '', desc: '', sakeId: '', pairing: { move: 'mirror', text: '', host: '' } });
    await save(); eventEditor(id);
  };
  $('#preview').onclick = () => { session.activeEventId = id; go('#/'); };
  $('#toShare').onclick = () => go(`#/host/share/${id}`);
}
const quadName = (t) => (TYPE4[t] || TYPE4.junshu).name + ' · ' + (TYPE4[t] || TYPE4.junshu).tag;

/* ---------- Scan a printed menu into a draft event ---------- */
async function scanMenu(ev) {
  const dataUrl = await pickPhoto();
  if (!dataUrl) return;
  openSheet(`<div class="center" style="padding:22px 0">
    <div class="hero-mark">${svg('sparkle', 'accent')}</div>
    <h2 class="serif" style="font-size:1.5rem;margin-top:12px">Reading your menu…</h2>
    <p class="muted" style="font-size:.9rem">Pulling out the courses and sakes — a few seconds.</p>
    <img src="${dataUrl}" style="max-width:220px;border-radius:12px;margin-top:14px;opacity:.55">
  </div>`);
  try {
    const draft = await Net.parseMenu(dataUrl);
    await applyMenuDraft(ev, draft);
    closeSheet();
    toast('Menu scanned — review & refine each pour');
    eventEditor(ev.id);
  } catch (e) {
    closeSheet();
    const msg = /api key|no_api_key/i.test(e.message)
      ? 'Menu scanning isn’t enabled on the server (no API key set).'
      : 'Couldn’t read that menu — try a clearer photo. (' + e.message + ')';
    toast(msg, 3400);
  }
}

async function applyMenuDraft(ev, draft) {
  if (draft.title && (!ev.title || ev.title === 'New tasting')) ev.title = draft.title;
  if (draft.subtitle && (!ev.subtitle || ev.subtitle === 'A pairing evening')) ev.subtitle = draft.subtitle;

  const lib = await Sakes.all();
  const byName = new Map(lib.map((s) => [s.name.trim().toLowerCase(), s]));
  const scanned = [];
  for (const c of (draft.courses || [])) {
    let sakeId = '';
    const key = (c.sakeName || '').trim().toLowerCase();
    if (key) {
      let s = byName.get(key);
      if (!s) {                                   // new bottle → add to the library (host is authed)
        s = { id: uid('s'), name: c.sakeName.trim(), romaji: '', brewery: '', region: '',
              grade: c.sakeGrade || 'junmai', type4: 'junshu', temp: 'joon',
              smv: '', acidity: '', abv: '', seimai: '', profile: '', tags: [] };
        await Sakes.save(s);
        byName.set(key, s);
      }
      sakeId = s.id;
    }
    scanned.push({ id: uid('c'), order: 0, name: c.name || '', desc: c.desc || '',
      sakeId, pairing: { move: 'mirror', text: c.pairingText || '', host: '' } });
  }

  if (scanned.length) {
    if (ev.courses.length && !confirm(`Replace the current ${ev.courses.length} course(s) with the ${scanned.length} scanned?`)) {
      ev.courses.push(...scanned);                // keep existing, append the scanned ones
    } else {
      ev.courses = scanned;
    }
    ev.courses.forEach((c, i) => (c.order = i + 1));
  }
  await Events.save(ev);
}

/* ============================================================
   RESULTS — read the room + captured guests
   ============================================================ */
export async function results(id) {
  if (requireHostAuth()) return;
  const ev = await Events.get(id);
  if (!ev) return go('#/host');
  const ratings = await Ratings.forEvent(id);
  // Guests who actually recorded something — matches the server's recap-recipient predicate.
  const ratedGuestIds = new Set(ratings.filter((r) => r.s1 || r.s2 || r.wouldBuy || r.photoBottle || r.photoFood || r.photo).map((r) => r.guestId));
  const guests = await Guests.forEvent(id);

  // aggregate per sake
  const agg = new Map();
  for (const r of ratings) {
    const f = r.s2 || r.s1; if (!f && !r.wouldBuy && !r.photoBottle && !r.photoFood && !r.photo) continue;
    const a = agg.get(r.sakeId) || { sum: 0, n: 0, buys: 0, photos: 0 };
    if (f) { a.sum += f; a.n += 1; }
    if (r.wouldBuy) a.buys += 1;
    if (r.photoBottle || r.photoFood || r.photo) a.photos += 1;
    agg.set(r.sakeId, a);
  }
  const cards = await Promise.all([...agg.entries()]
    .map(async ([sid, a]) => ({ s: await Sakes.get(sid), a }))
  );
  cards.sort((x, y) => (y.a.n ? y.a.sum / y.a.n : 0) - (x.a.n ? x.a.sum / x.a.n : 0));

  const identified = guests.filter((g) => g.identified);
  const mktConsent = identified.filter((g) => g.consentMarketing).length;
  const optinRate = identified.length ? Math.round((mktConsent / identified.length) * 100) : 0;
  const photoConsent = identified.filter((g) => g.consentPhotoFood || g.consentPhotoMe).length;
  const faceConsent = identified.filter((g) => g.consentPhotoMe).length;
  // Each photo carries its guest's consent so the gallery can badge it and warn on download.
  const guestById = Object.fromEntries(guests.map((g) => [g.id, g]));
  const photoItems = [];
  for (const r of ratings) {
    const g = guestById[r.guestId] || {};
    const meta = { guestId: r.guestId, name: g.name || '', foodOk: !!g.consentPhotoFood, meOk: !!g.consentPhotoMe };
    if (r.photoBottle) photoItems.push({ ...meta, url: r.photoBottle, kind: 'bottle' });
    if (r.photoFood) photoItems.push({ ...meta, url: r.photoFood, kind: 'dish' });
    if (r.photo) photoItems.push({ ...meta, url: r.photo, kind: 'photo' });
  }
  const shownPhotos = photoItems.slice(0, 12);

  const barRows = cards.map(({ s, a }) => {
    const avg = a.n ? a.sum / a.n : 0;
    return `
      <div style="margin-bottom:14px">
        <div class="row between"><b class="serif" style="font-size:1.05rem">${esc(s ? s.name : 'Sake')}</b>
          <span class="faint" style="font-size:.82rem">${avg ? avg.toFixed(1) : '–'} · ${a.n} ${a.n === 1 ? 'rating' : 'ratings'}</span></div>
        <div class="result-bar mt-8"><i style="width:${(avg / 5) * 100}%"></i></div>
        <div class="row gap-12 mt-8" style="font-size:.78rem;color:var(--ink-3)">
          <span>${svg('bottle')} ${a.buys} want a bottle</span>
          <span>${svg('camera')} ${a.photos} photos</span>
        </div>
      </div>`;
  }).join('');

  const gallery = shownPhotos.map((p, i) => `
    <button class="gallery-tile" data-idx="${i}" title="${p.foodOk ? 'Consented — tap to download' : 'No consent — tap to download (warns first)'}"
      style="position:relative;padding:0;border:none;border-radius:10px;overflow:hidden;cursor:pointer;background:var(--surface-2);aspect-ratio:1">
      <img src="${p.url}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
      <span style="position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:800;color:#fff;background:${p.foodOk ? 'var(--good)' : 'var(--danger)'};box-shadow:0 1px 5px rgba(0,0,0,.5)">${p.foodOk ? '✓' : '!'}</span>
    </button>`).join('');

  app().innerHTML = hostShell('Results', `
    <h1 class="serif" style="font-size:1.9rem">${esc(ev.title)}</h1>
    <div class="faint">${esc(fmtDate(ev.date))} · ${esc(ev.venue)}</div>

    <div class="stat-grid mt-16">
      <div class="stat"><div class="n">${guests.length}</div><div class="l">Guests joined</div></div>
      <div class="stat"><div class="n">${identified.length}</div><div class="l">Named + emailed</div></div>
      <div class="stat"><div class="n">${optinRate}%</div><div class="l">Marketing opt-in</div></div>
      <div class="stat"><div class="n">${photoConsent}</div><div class="l">Photo consent</div></div>
    </div>
    <p class="faint center mt-8" style="font-size:.78rem">${mktConsent} of ${identified.length} named guest${identified.length === 1 ? '' : 's'} opted in${optinRate >= 80 ? ' — nailing the 80% target 🎯' : optinRate ? ' · aim for 80%+ (try a sign-up perk)' : ''}</p>

    <div class="divider"><span class="k">評</span></div>
    <div class="eyebrow" style="color:var(--ink-3);margin-bottom:14px">The room’s ranking</div>
    ${barRows || emptyState('No ratings yet', 'Results appear as guests taste.')}

    ${gallery ? `<div class="divider"><span class="k">写</span></div>
      <div class="eyebrow" style="color:var(--ink-3);margin-bottom:6px">Guest gallery</div>
      <p class="faint" style="font-size:.76rem;margin:0 0 10px">Tap a photo to download. <b style="color:var(--good)">✓</b> guest consented · <b style="color:var(--danger)">!</b> no consent (warns first). ${faceConsent} of ${identified.length} also OK’d their face.</p>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">${gallery}</div>` : ''}

    <button class="btn primary block mt-24" id="sendRecaps">${svg('sparkle')} Send recap emails</button>
    <button class="btn subtle block mt-8" id="csv">${svg('share')} Export guests (CSV)</button>
    <p class="faint center mt-16" style="font-size:.76rem;line-height:1.5">Only guests who opted in should be emailed. Only photos with consent should be reused — never anyone who looks under 25 or intoxicated.</p>
  `);
  wireShell('#/host');

  $('#csv').onclick = () => exportCSV(ev, identified);
  $$('.gallery-tile').forEach((el) => (el.onclick = () => downloadPhoto(shownPhotos[+el.dataset.idx])));
  $('#sendRecaps').onclick = async () => {
    const opted = identified.filter((g) => g.consentMarketing && g.email && ratedGuestIds.has(g.id)).length;
    if (!opted) { toast('No opted-in guests with ratings to recap yet'); return; }
    if (!confirm(`Email a personal recap to the ${opted} opted-in guest${opted === 1 ? '' : 's'}?`)) return;
    const btn = $('#sendRecaps'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await Net.sendRecaps(id);
      if (r.error === 'email_not_configured') { toast(`Email isn’t set up on the server (set RESEND_API_KEY). ${r.wouldSend} recap${r.wouldSend === 1 ? '' : 's'} ready to send.`, 3800); btn.disabled = false; btn.textContent = 'Send recap emails'; }
      else { toast(`Sent ${r.sent} recap${r.sent === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} failed` : ''} ✨`, 3200); btn.textContent = `Sent ${r.sent} ✓`; }
    } catch (e) { btn.disabled = false; btn.textContent = 'Send recap emails'; toast('Send failed: ' + e.message, 3400); }
  };

  // Live: the room's ratings, favourites and gallery update as guests tap.
  let t;
  Net.subscribe(id, () => { clearTimeout(t); t = setTimeout(() => {
    if ((location.hash || '').startsWith('#/host/results/')) results(id);
  }, 500); });
}

/** Download a gallery photo, warning first if the guest didn't consent to photo use. */
function downloadPhoto(p) {
  if (!p) return;
  const who = p.name || 'This guest';
  const dl = () => {
    const a = document.createElement('a');
    a.href = p.url;
    a.download = `sake-journey-${p.kind}-${(p.name || p.guestId || 'guest').replace(/\W+/g, '-').toLowerCase()}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  if (!p.foodOk) {
    if (confirm(`⚠ NOT CLEARED FOR USE\n\n${who} did not consent to their photos being used in promotion.\n\nOnly download for your own records — do not post or advertise with it.\n\nDownload anyway?`)) {
      dl(); toast('Downloaded — ⚠ not cleared for promotion', 3600);
    }
    return;
  }
  dl();
  const faceSafe = p.kind === 'bottle' || p.meOk;
  toast(faceSafe ? 'Downloaded — cleared for use ✓' : 'Downloaded ✓ — food/drink only; check there’s no face before public use', 3600);
}

function exportCSV(ev, guests) {
  const head = 'name,email,marketing_consent,photo_food_consent,photo_me_consent,consent_at\n';
  const rows = guests.map((g) =>
    [g.name, g.email, g.consentMarketing, g.consentPhotoFood, g.consentPhotoMe, g.consentAt ? new Date(g.consentAt).toISOString() : '']
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([head + rows], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ev.title.replace(/\W+/g, '-').toLowerCase()}-guests.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${guests.length} guests`);
}

/* ============================================================
   LIBRARY — the reusable sake roster
   ============================================================ */
export async function library() {
  if (requireHostAuth()) return;
  const sakes = await Sakes.all();
  const rows = sakes.map((s) => `
    <div class="list-row" data-s="${s.id}">
      <div class="quad" style="--s:52px;flex:none">${quadrantHTML(s.type4)}</div>
      <div class="lr-main"><div class="t" style="font-size:1.1rem">${esc(s.name)}</div>
        <div class="s">${gradeLabel(s.grade)}${s.region ? ' · ' + esc(s.region) : ''}</div></div>
      <span class="chev">${svg('edit')}</span>
    </div>`).join('');

  app().innerHTML = hostShell('Sake library', `
    <div class="row between mt-8">
      <h1 class="serif" style="font-size:1.9rem">Your bottles</h1>
      <button class="btn small primary" id="add">${svg('plus')} Add</button>
    </div>
    <p class="faint" style="font-size:.85rem;margin:8px 0 16px">Build each bottle once — verified by you. Every event reuses them, and your notes become a library no generic app can match.</p>
    ${rows || emptyState('No sakes yet', 'Add your first bottle.')}
  `);
  wireShell('#/host');
  $('#add').onclick = () => editSake(null);
  $$('.list-row[data-s]').forEach((r) => r.onclick = () => editSake(r.dataset.s));
}

async function editSake(id) {
  const s = id ? await Sakes.get(id) : {
    id: uid('s'), name: '', romaji: '', brewery: '', region: '', grade: 'junmai',
    type4: 'junshu', temp: 'joon', smv: '', acidity: '', amino: '', abv: '', seimai: '',
    profile: '', tags: [],
  };
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.6rem;margin-bottom:14px">${id ? 'Edit' : 'New'} sake</h2>
    <label class="field"><span class="lab">Name</span><input class="inp" id="sName" value="${esc(s.name)}" placeholder="e.g. Dassai 45"></label>
    <label class="field"><span class="lab">Japanese (optional)</span><input class="inp" id="sRomaji" value="${esc(s.romaji)}" placeholder="獺祭 四五"></label>
    <div class="grid-2">
      <label class="field"><span class="lab">Brewery</span><input class="inp" id="sBrewery" value="${esc(s.brewery)}"></label>
      <label class="field"><span class="lab">Region</span><input class="inp" id="sRegion" value="${esc(s.region)}"></label>
    </div>
    <label class="field"><span class="lab">Grade</span>
      <select class="inp" id="sGrade">${GRADES.map((g) => `<option value="${g}" ${g === s.grade ? 'selected' : ''}>${gradeLabel(g)}</option>`).join('')}</select></label>
    <label class="field"><span class="lab">Flavour type</span>
      <select class="inp" id="sType">${Object.entries(TYPE4).map(([k, v]) => `<option value="${k}" ${k === s.type4 ? 'selected' : ''}>${v.name} — ${v.tag}</option>`).join('')}</select></label>
    <label class="field"><span class="lab">Serve at</span>
      <select class="inp" id="sTemp">${Object.entries(TEMPS).map(([k, v]) => `<option value="${k}" ${k === s.temp ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <div class="grid-2">
      <label class="field"><span class="lab">SMV</span><input class="inp" id="sSmv" value="${esc(s.smv)}" placeholder="+3"></label>
      <label class="field"><span class="lab">Acidity</span><input class="inp" id="sAcid" value="${esc(s.acidity)}" placeholder="1.5"></label>
    </div>
    <div class="grid-2">
      <label class="field"><span class="lab">ABV %</span><input class="inp" id="sAbv" value="${esc(s.abv)}" placeholder="15"></label>
      <label class="field"><span class="lab">Seimai %</span><input class="inp" id="sSeimai" value="${esc(s.seimai)}" placeholder="60"></label>
    </div>
    <label class="field"><span class="lab">Taste in a line</span>
      <textarea class="inp" id="sProfile" placeholder="Pear blossom and white peach, clean cool finish.">${esc(s.profile)}</textarea></label>
    <label class="field"><span class="lab">Flavour tags (comma-separated)</span>
      <input class="inp" id="sTags" value="${esc((s.tags || []).join(', '))}" placeholder="floral, peach, silky"></label>
    <button class="btn primary block mt-8" id="sSave">Save bottle</button>
    ${id ? `<button class="linkbtn" id="sDel" style="display:block;margin:10px auto 0;color:var(--danger)">Delete</button>` : ''}
  `);

  body.querySelector('#sSave').onclick = async () => {
    const v = (x) => body.querySelector(x).value.trim();
    Object.assign(s, {
      name: v('#sName'), romaji: v('#sRomaji'), brewery: v('#sBrewery'), region: v('#sRegion'),
      grade: v('#sGrade'), type4: v('#sType'), temp: v('#sTemp'),
      smv: v('#sSmv'), acidity: v('#sAcid'), abv: v('#sAbv'), seimai: v('#sSeimai'),
      profile: v('#sProfile'), tags: v('#sTags').split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (!s.name) { toast('Give it a name'); return; }
    await Sakes.save(s); closeSheet(); toast('Saved to your library'); library();
  };
  if (id) body.querySelector('#sDel').onclick = async () => {
    if (!confirm('Delete this sake?')) return;
    await Sakes.delete(s.id); closeSheet(); toast('Deleted'); library();
  };
}

/* ============================================================
   SHARE — QR + link
   ============================================================ */
export async function share(id) {
  if (requireHostAuth()) return;
  const ev = await Events.get(id);
  if (!ev) return go('#/host');
  const base = location.origin + location.pathname;
  const link = `${base}#/e/${id}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=8&data=${encodeURIComponent(link)}`;

  app().innerHTML = hostShell('Share', `
    <div class="center">
      <h1 class="serif" style="font-size:1.9rem">${esc(ev.title)}</h1>
      <p class="muted" style="font-size:.92rem">Print this on the table. Guests scan with their phone camera — no app to install.</p>
      <div class="qr-wrap mt-16">
        <img id="qr" src="${qrSrc}" alt="QR code" onerror="this.style.display='none';document.getElementById('qrfallback').style.display='block'">
        <div id="qrfallback" style="display:none;color:#141210">${svg('qr')}<br>QR needs a connection to render.</div>
        <div style="color:#141210;font-weight:700;font-family:var(--font-display);font-size:1.1rem">${esc(ev.title)}</div>
      </div>
      <div class="share-link mt-16" id="link">${esc(link)}</div>
      <div class="col gap-12 mt-16">
        <button class="btn primary block" id="copy">${svg('share')} Copy link</button>
        <button class="btn subtle block" id="open">${svg('cup')} Open it myself</button>
      </div>
      <p class="faint mt-24" style="font-size:.78rem;line-height:1.5">The QR points at wherever you host this app. Publish the folder to any static host (Netlify, GitHub Pages, your site) and the same QR works at the venue — even if the wifi drops mid-dinner.</p>
    </div>
  `);
  wireShell('#/host');
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Copy failed — long-press the link'); } };
  $('#open').onclick = () => { session.activeEventId = id; go('#/'); };
}
