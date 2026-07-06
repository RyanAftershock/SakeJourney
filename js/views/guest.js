/* ============================================================
   Sake Journey — guest experience
   QR → menu → course-by-course → capture & rate →
   de-anchored re-rank finale → "My Night" recap.
   Designed as a quiet glance-tool: big type, few taps.
   ============================================================ */

import { Events, Sakes, Guests, Ratings, session, uid } from '../store.js';
import { SOLO_EVENT, TYPE4 } from '../seed.js';
import * as Net from '../net.js';
import {
  $, $$, node, esc, svg, gradeLabel, quadrantHTML, quadLegend, tempHTML,
  heartsHTML, wireHearts, miniHearts, toast, openSheet, closeSheet, pickPhoto,
  fmtDate, ordinal,
} from '../ui.js';
import { applyTheme, go } from '../app.js';

const app = () => document.getElementById('app');

/* ---------- shared data helpers ---------- */
async function activeEvent() {
  let ev = await Events.get(session.activeEventId);
  if (!ev && session.activeEventId) {
    // A scanned QR set this event id but it isn't synced yet — pull it before falling back, so we
    // never silently render a DIFFERENT event and misattribute the guest's ratings to it.
    try { await Events.syncFromServer(); ev = await Events.get(session.activeEventId); } catch { /* offline */ }
  }
  if (ev) return ev;
  const all = await Events.all();
  return all.find((e) => !e.personal) || all[0];   // never fall back to the personal journal as "tonight"
}
async function guestFor(ev) { return Guests.ensure(ev.id); }

/** The photo that best represents a pour — the bottle first (find it again), then the dish, then legacy. */
const photoOf = (r) => (r && (r.photoBottle || r.photoFood || r.photo)) || null;
const hasPhoto = (r) => !!(r && (r.photoBottle || r.photoFood || r.photo));

/** Has the guest engaged with this pour at all? (rated, photographed, wants a bottle, or explicitly
    logged it themselves — a solo journal entry counts even with no score yet). */
const engaged = (r) => !!(r && (r.s1 || r.s2 || r.photoBottle || r.photoFood || r.photo || r.wouldBuy || r.logged));

/** All sakes this guest has engaged with (course pours first, then surprise pours).
    Skips any sake whose record is gone (e.g. deleted from the library) so downstream
    screens never dereference an undefined sake. */
async function ratedList(ev, guest) {
  const ratings = await Ratings.forGuestEvent(guest.id, ev.id);
  const byId = new Map(ratings.map((r) => [r.sakeId, r]));
  const out = [];
  for (const c of ev.courses) {
    const r = byId.get(c.sakeId);
    if (!r) continue;
    byId.delete(c.sakeId);              // it's a course pour, not a surprise one
    if (!engaged(r)) continue;
    const sake = await Sakes.get(c.sakeId);
    if (sake) out.push({ sake, rating: r, course: c });
  }
  // remaining = surprise pours
  const extras = [...byId.values()].filter(engaged).sort((a, b) => a.createdAt - b.createdAt);
  for (const r of extras) {
    const sake = await Sakes.get(r.sakeId);
    if (sake) out.push({ sake, rating: r, course: null });
  }
  return out;
}

/** If this guest has engaged with PAST events (any night but tonight), returns a warm welcome-back
    context — their name, how many nights they've shared, and the pour they loved most. Layered
    recognition: uses the signed-in cross-device history when available, else this device's local
    ratings. Returns null for a first-timer (nothing to welcome back to). */
async function returningContext(ev, guest) {
  let name = guest.name || '';
  let ratings = [], eventsById = {}, sakesById = {};
  // Bound the cross-device fetch so a stalled venue connection can't hang the home render (mirrors the
  // 3s cap in initStore); on timeout we fall back to this device's local ratings.
  const server = Net.guestToken()
    ? await Promise.race([Net.guestHistory(), new Promise((r) => setTimeout(() => r(null), 3000))])
    : null;
  if (server) {                                      // cross-device: everything for this email
    name = (server.guest && server.guest.name) || name;
    ratings = server.ratings || [];
    eventsById = Object.fromEntries((server.events || []).map((e) => [e.id, e]));
    sakesById = Object.fromEntries((server.sakes || []).map((s) => [s.id, s]));
  } else {                                           // this device: the guest's own past ratings
    for (const eid of (guest.eventIds || [])) {
      if (eid === ev.id) continue;
      ratings.push(...await Ratings.forGuestEvent(guest.id, eid));
    }
  }
  // Only real hosted nights count as "welcome back" — never the personal journal.
  const past = ratings.filter((r) => r.eventId !== ev.id && r.eventId !== SOLO_EVENT.id && engaged(r));
  const nights = new Set(past.map((r) => r.eventId));
  if (!nights.size) return null;

  const scored = past
    .map((r) => ({ r, final: r.s2 || r.s1 || 0 }))
    .sort((a, b) => b.final - a.final || (b.r.wouldBuy - a.r.wouldBuy));
  const topR = scored[0].r;
  const sake = sakesById[topR.sakeId] || await Sakes.get(topR.sakeId);
  const lastEvent = eventsById[topR.eventId] || await Events.get(topR.eventId);
  return {
    name: name ? esc(name.split(' ')[0]) : '',
    nights: nights.size,
    favSake: sake ? sake.name : null,
    favScore: scored[0].final,
    lastEventTitle: lastEvent ? lastEvent.title : null,
  };
}

function welcomeBackCard(b) {
  const line = b.favSake
    ? `Last time${b.lastEventTitle ? ' at ' + esc(b.lastEventTitle) : ''}, you loved <b>${esc(b.favSake)}</b> ${miniHearts(b.favScore)}.`
    : `Lovely to have you back for another evening.`;
  return `
    <div class="card mt-8" style="border-color:color-mix(in srgb,var(--accent) 32%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 8%,transparent),transparent)">
      <div class="row gap-12" style="align-items:flex-start">
        <span style="color:var(--accent);flex:none;line-height:0;margin-top:2px">${svg('sparkle')}</span>
        <div style="flex:1;min-width:0">
          <div class="eyebrow" style="color:var(--accent)">Welcome back${b.name ? ', ' + b.name : ''}</div>
          <div style="font-size:.95rem;margin-top:3px;line-height:1.45">${line}</div>
          <button class="linkbtn" id="wbHistory" style="padding:8px 0 0">Your ${b.nights === 1 ? 'last night' : b.nights + ' nights'} with us — see your journey →</button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   HOME — tonight's journey
   ============================================================ */
export async function home() {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);
  const guest = await guestFor(ev);
  const back = await returningContext(ev, guest);
  const progress = await Ratings.forGuestEvent(guest.id, ev.id);
  const doneCount = progress.filter(engaged).length;
  const started = doneCount > 0;

  const courseRows = await Promise.all(ev.courses.map(async (c, i) => {
    const s = await Sakes.get(c.sakeId);
    const r = progress.find((x) => x.sakeId === c.sakeId);
    const done = engaged(r);
    return `
      <a class="list-row" href="#/course/${i + 1}">
        <div style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;flex:none;
             background:${done ? 'var(--accent)' : 'var(--surface-2)'};color:${done ? 'var(--accent-ink)' : 'var(--ink-3)'};
             font-family:var(--font-display);font-weight:600">${done ? '✓' : i + 1}</div>
        <div class="lr-main">
          <div class="t">${esc(s ? s.name : 'Sake to be assigned')}</div>
          <div class="s">${gradeLabel(s && s.grade)}${c.name ? ' · with ' + esc(c.name) : ''}</div>
        </div>
        <span class="chev">${svg('chev')}</span>
      </a>`;
  }));

  app().innerHTML = `
    <div class="screen pad-bottom-bar-2">
      <div class="topbar">
        <a class="brand" href="#/"><span class="brand-logo" role="img" aria-label="Sake Journey"></span></a>
        <button class="iconbtn" id="toHost" aria-label="Host tools">${svg('users')}</button>
      </div>

      ${back ? welcomeBackCard(back) : ''}

      <div class="center mt-8">
        <div class="eyebrow">${esc(fmtDate(ev.date))} · ${esc(ev.venue)}</div>
        <h1 class="display" style="font-size:2.7rem;margin:10px 0 4px">${esc(ev.title)}</h1>
        <div class="muted serif" style="font-size:1.25rem">${esc(ev.subtitle)}</div>
        <div class="pill accent mt-16">${svg('cup')} Hosted by ${esc(ev.host)}</div>
      </div>

      <div class="divider"><span class="k">献立</span></div>

      <div class="col">
        <div class="row between" style="margin-bottom:10px">
          <span class="eyebrow" style="color:var(--ink-3)">The menu · ${ev.courses.length} pours</span>
          <span class="faint" style="font-size:.82rem">${started ? `${doneCount}/${ev.courses.length} tasted` : 'tap any course'}</span>
        </div>
        ${courseRows.join('')}
      </div>

      ${venueCard(ev, 'Tonight’s table')}

      <p class="faint center mt-24" style="font-size:.85rem;line-height:1.5">
        Take your time. Snap a photo, rate what you love — we’ll remember every pour so you don’t have to.
      </p>
      <button class="linkbtn" id="toHistory" style="display:block;margin:14px auto 0">Your sake journey — every pour you’ve tasted →</button>
    </div>

    <div class="actionbar col gap-8">
      <button class="btn primary block" id="begin">${started ? 'Continue tasting' : 'Begin the journey'}</button>
      <button class="btn subtle block" id="addSurprise">${svg('plus')} Add a pour that’s not on the menu</button>
    </div>`;

  $('#toHost').onclick = () => go('#/host');
  $('#toHistory').onclick = () => go('#/history');
  if ($('#wbHistory')) $('#wbHistory').onclick = () => go('#/history');
  $('#addSurprise').onclick = () => openAddSake(ev, guest);
  $('#begin').onclick = () => {
    const next = ev.courses.findIndex((c) => !progress.find((r) => r.sakeId === c.sakeId && engaged(r)));
    go(`#/course/${next === -1 ? 1 : next + 1}`);
  };
  maybeRestoreDraft(ev, guest, 'home');
}

/* ============================================================
   COURSE — the glance-tool tasting screen
   ============================================================ */
export async function course(n) {
  const ev = await activeEvent();
  const guest = await guestFor(ev);
  const c = ev.courses[n - 1];
  if (!c) return go('#/');
  // Placeholder keeps the screen rendering when a course has no sake yet
  // (host preview of a fresh event) or its library sake was deleted.
  const s = (await Sakes.get(c.sakeId)) || {
    name: 'Sake to be assigned', romaji: '', brewery: '', region: '', profile: '',
    grade: '', type4: 'junshu', temp: 'joon', smv: '', acidity: '', abv: '', seimai: '', tags: [],
  };
  let rating = (await Ratings.get(guest.id, ev.id, c.sakeId)) || {};
  const last = n === ev.courses.length;
  // "You loved a junmai ginjo like this at the Jazz night" — a past pour in the same flavour family.
  // Device-local only, so the tasting flow never waits on the network.
  const { items: myJourney } = await collectJourney(ev, guest, { localOnly: true });
  const pastLove = bestPastMatch(myJourney, s, ev);

  const rail = ev.courses.map((_, i) =>
    `<span class="dot ${i + 1 < n ? 'done' : ''} ${i + 1 === n ? 'now' : ''}"></span>`).join('');

  app().innerHTML = `
    <div class="screen pad-bottom-bar">
      <div class="topbar">
        <button class="iconbtn" id="back" aria-label="Back">${svg('back')}</button>
        <div class="rail">${rail}</div>
        <button class="iconbtn" id="addSurprise" aria-label="Add a surprise pour">${svg('plus')}</button>
      </div>

      <div class="course-hero mt-8">
        <div class="pour-index">${ordinal(c.order)} pour</div>
        ${s.romaji ? `<div class="sake-sub" style="font-family:var(--font-jp);font-size:1rem">${esc(s.romaji)}</div>` : ''}
        <h1 class="dish-title">${esc(s.name)}</h1>
        <div class="row between mt-8" style="align-items:center">
          <span class="sake-sub">${esc(s.brewery)}${s.brewery && s.region ? ' · ' : ''}${esc(s.region)}</span>
          <span class="badge-grade">${gradeLabel(s.grade)}</span>
        </div>
      </div>

      <div class="card sake-card mt-16">
        <div class="row gap-16" style="align-items:center">
          ${quadrantHTML(s.type4)}
          ${quadLegend(s.type4)}
        </div>
        ${pastLove ? `<div class="mt-12" style="background:color-mix(in srgb,var(--accent) 9%,transparent);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);border-radius:12px;padding:10px 12px;font-size:.9rem;line-height:1.42;display:flex;gap:8px;align-items:flex-start">
          <span style="color:var(--accent);flex:none;line-height:0;margin-top:1px">${svg('sparkle')}</span>
          <div>You loved <b>${esc(pastLove.sakeName)}</b> at ${esc(pastLove.eventTitle)}${pastLove.grade === s.grade ? ' — a similar ' + esc(gradeLabel(s.grade)) : ' — a similar style'}. ${miniHearts(pastLove.final)}</div>
        </div>` : ''}
        ${s.profile ? `<p class="profile-line mt-16">“${esc(s.profile)}”</p>` : ''}
        <div class="specs mt-16">
          ${spec('SMV', (s.smv === '' || s.smv == null) ? '–' : (s.smv > 0 ? '+' + s.smv : s.smv))}
          ${spec('Acidity', s.acidity || '–')}
          ${spec('ABV', s.abv ? s.abv + '%' : '–')}
          ${spec('Seimai', s.seimai ? s.seimai + '%' : '–')}
        </div>
        <div class="mt-12">${tempHTML(s.temp)}</div>
        ${(s.tags && s.tags.length) ? `<div class="row wrap gap-8 mt-12">${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="card mt-16">
        <div class="eyebrow" style="color:var(--ink-3)">Paired with</div>
        <div class="serif" style="font-size:1.45rem;margin-top:4px">${esc(c.name || 'This course')}</div>
        ${c.desc ? `<div class="muted" style="margin-top:2px">${esc(c.desc)}</div>` : ''}
      </div>

      <div class="why mt-16">
        <div class="why-head"><span class="movetag">${moveLabel(c.pairing.move)}</span>
          <span class="eyebrow" style="color:var(--ink-3)">Why this pairing</span></div>
        <p>${esc(c.pairing.text)}</p>
        ${c.pairing.host ? `<div class="host">— ${esc(ev.host)}: “${esc(c.pairing.host)}”</div>` : ''}
      </div>

      <div class="photo-duo mt-24">
        <div class="photo-zone" id="zoneBottle" role="button" tabindex="0" aria-label="Take a photo of the bottle">${zoneInner('bottle', rating.photoBottle)}</div>
        <div class="photo-zone" id="zoneFood" role="button" tabindex="0" aria-label="Take a photo of the dish">${zoneInner('food', rating.photoFood)}</div>
      </div>
      <div class="photo-caption">One for the bottle — so you can find it again. One for the plate — to keep the memory.</div>

      <div class="card mt-24 rate-block">
        <div class="rate-label">How are you finding it?</div>
        <div class="hearts-wrap">${heartsHTML(rating.s1 || 0)}</div>
        <div class="rate-word"></div>
        <button class="buy-toggle ${rating.wouldBuy ? 'on' : ''}" id="buy" style="margin-top:10px">
          ${svg('bottle')} <span>${rating.wouldBuy ? 'On your take-home list' : 'I’d take a bottle home'}</span>
        </button>
      </div>
    </div>

    <div class="actionbar">
      ${n > 1 ? `<button class="iconbtn" id="prev" aria-label="Previous">${svg('back')}</button>` : ''}
      <button class="btn primary block" id="next">${last ? 'Finish — rank the night' : 'Next pour'}</button>
    </div>`;

  // ---- wire ----
  $('#back').onclick = () => go('#/');
  $('#addSurprise').onclick = () => openAddSake(ev, guest);
  if ($('#prev')) $('#prev').onclick = () => go(`#/course/${n - 1}`);
  $('#next').onclick = () => go(last ? '#/finale' : `#/course/${n + 1}`);

  const wireZone = (id, kind, field) => {
    const zone = $('#' + id);
    zone.onclick = async () => {
      const dataUrl = await pickPhoto();
      if (!dataUrl) return;
      rating = await Ratings.save(guest.id, ev.id, c.sakeId, { [field]: dataUrl });
      zone.innerHTML = zoneInner(kind, dataUrl);
      toast(kind === 'bottle' ? 'Bottle saved ✨' : 'Dish saved ✨');
      maybeAskIdentity(guest);
    };
    zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zone.click(); } };
  };
  wireZone('zoneBottle', 'bottle', 'photoBottle');
  wireZone('zoneFood', 'food', 'photoFood');

  wireHearts($('.hearts-wrap'), rating.s1 || 0, async (v) => {
    rating = await Ratings.save(guest.id, ev.id, c.sakeId, { s1: v });
    maybeAskIdentity(guest);
  });

  $('#buy').onclick = async () => {
    const on = !rating.wouldBuy;
    rating = await Ratings.save(guest.id, ev.id, c.sakeId, { wouldBuy: on });
    const b = $('#buy');
    b.classList.toggle('on', on);
    b.querySelector('span').textContent = on ? 'On your take-home list' : 'I’d take a bottle home';
    if (on) { toast('Added to your take-home list'); maybeAskIdentity(guest); }
  };
  // The add-a-pour sheet opens from here too — restore it if the camera killed the page.
  maybeRestoreDraft(ev, guest, 'home');
}

const spec = (k, v) => `<div class="spec"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;
const moveLabel = (m) => ({ match: 'Match', mirror: 'Mirror', contrast: 'Contrast' }[m] || 'Pairing');
/** Inner markup for a capture zone — the bottle (find it again) or the dish (the memory). */
const zoneInner = (kind, photo) => {
  const label = kind === 'bottle' ? 'Snap the bottle' : 'Snap the dish';
  const icon = kind === 'bottle' ? 'bottle' : 'camera';
  return photo
    ? `<img src="${photo}" alt=""><button class="retake">${svg('camera')} Retake</button>`
    : `<div class="ph">${svg(icon)}<span>${label}</span></div>`;
};

/** The restaurant callout — photo + Menu / Reserve / Website / Google Maps buttons. */
function venueCard(ev, eyebrow) {
  if (!ev.venue && !ev.venueUrl) return '';
  const gmaps = ev.venueGoogleUrl
    || (ev.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue)}` : '');
  const btn = (url, icon, label, accent) => url
    ? `<a class="venue-btn${accent ? ' accent' : ''}" href="${esc(url)}" target="_blank" rel="noopener">${svg(icon)} ${label}</a>` : '';
  return `
    <div class="venue-card mt-24">
      ${ev.venueImage ? `<img class="venue-img" src="${esc(ev.venueImage)}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div class="eyebrow">${esc(eyebrow)}</div>
        <div class="venue-name">${esc(ev.venue || 'The restaurant')}</div>
        <div class="venue-actions">
          ${btn(ev.venueMenuUrl, 'book', 'Menu')}
          ${btn(ev.venueReserveUrl, 'calendar', 'Reserve', true)}
          ${btn(ev.venueUrl, 'link', 'Website')}
          ${btn(gmaps, 'pin', 'Google Maps')}
        </div>
      </div>
    </div>`;
}

/* ============================================================
   FINALE — the de-anchored re-rank (the shared moment)
   ============================================================ */
export async function finale() {
  const ev = await activeEvent();
  const guest = await guestFor(ev);
  const list = await ratedList(ev, guest);
  if (!list.length) { toast('Taste a pour or two first'); return go('#/'); }

  app().innerHTML = `
    <div class="screen">
      <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
        <span class="eyebrow">The finale</span><span style="width:42px"></span></div>
      <div class="flex-grow" style="display:grid;place-items:center;text-align:center">
        <div>
          <div class="hero-mark">${svg('sparkle', 'accent')}</div>
          <h1 class="display" style="font-size:2.4rem;margin:14px 0 8px">One last taste</h1>
          <p class="muted" style="font-size:1.05rem;line-height:1.55;max-width:23em;margin:0 auto">
            Palates change over an evening — a pour you liked early might steal the night by the end.
            Let’s revisit each one <i>fresh</i>, then see how your taste shifted.
          </p>
          <div class="pill accent mt-24">${list.length} sake to revisit</div>
        </div>
      </div>
      <div class="col gap-12">
        <button class="btn primary block" id="start">Begin the final tasting</button>
        <button class="linkbtn" id="skip">Skip to my night’s recap</button>
      </div>
    </div>`;
  $('#back').onclick = () => go(`#/course/${ev.courses.length}`);
  $('#start').onclick = () => go('#/finale/1');
  $('#skip').onclick = () => go('#/recap');
}

export async function finaleStep(i) {
  const ev = await activeEvent();
  const guest = await guestFor(ev);
  const list = await ratedList(ev, guest);
  if (i > list.length) return go('#/recap');
  const { sake, rating, course: c } = list[i - 1];

  const rail = list.map((_, idx) =>
    `<span class="dot ${idx + 1 < i ? 'done' : ''} ${idx + 1 === i ? 'now' : ''}"></span>`).join('');

  app().innerHTML = `
    <div class="screen pad-bottom-bar-2">
      <div class="topbar"><button class="iconbtn" id="fback" aria-label="Back">${svg('back')}</button><div class="rail">${rail}</div><span style="width:42px"></span></div>

      <div class="center mt-8">
        <div class="pour-index">${i} of ${list.length}</div>
        <div class="photo-zone mt-16" style="max-width:280px;margin-inline:auto;aspect-ratio:1" id="finalePhoto">
          ${photoOf(rating) ? `<img src="${photoOf(rating)}" alt="">` : `<div class="ph">${svg('cup')}<span>${esc(c ? c.name : 'Surprise pour')}</span></div>`}
        </div>
        <div class="sake-sub mt-16" style="font-family:var(--font-jp)">${esc(sake.romaji || '')}</div>
        <h1 class="sake-name" style="font-size:1.9rem">${esc(sake.name)}</h1>
        <div class="muted">${c ? esc(c.name) : 'Surprise pour'}</div>
      </div>

      <div class="card mt-24 rate-block center">
        <div class="rate-label">How does it taste <b>now</b>?</div>
        <div class="hearts-wrap">${heartsHTML(rating.s2 || 0)}</div>
        <div class="rate-word"></div>
        <div id="reveal" class="hidden mt-12"></div>
      </div>
    </div>

    <div class="actionbar col gap-8">
      <button class="btn primary block" id="next">${i === list.length ? 'See my night' : 'Next'}</button>
      <button class="linkbtn" id="skipStep">${i === list.length ? 'Skip to my recap' : 'Skip this pour'}</button>
    </div>`;

  // First pass: no s2 yet, so hearts start empty and Next waits for a tap (de-anchored).
  // Re-entry: a saved s2 pre-fills and lets them move on without re-rating.
  $('#next').disabled = !rating.s2;
  $('#fback').onclick = () => go(i === 1 ? '#/finale' : `#/finale/${i - 1}`);
  $('#skipStep').onclick = () => go(i === list.length ? '#/recap' : `#/finale/${i + 1}`);
  wireHearts($('.hearts-wrap'), rating.s2 || 0, async (v) => {
    await Ratings.save(guest.id, ev.id, sake.id, { s2: v });
    $('#next').disabled = false;
    // De-anchored reveal: only now do we show what they said earlier.
    const rv = $('#reveal');
    rv.classList.remove('hidden');
    if (rating.s1) {
      const d = v - rating.s1;
      const word = d > 0 ? `It climbed — nicely done, ${esc(sake.name.split(' ')[0])}.`
                 : d < 0 ? 'Settled back a touch — that’s the night talking.'
                 : 'Rock steady all evening.';
      rv.innerHTML = `<div class="faint" style="font-size:.85rem">Earlier tonight you said ${miniHearts(rating.s1)}</div>
                      <div class="serif" style="font-size:1.05rem;color:var(--accent-2);margin-top:4px">${word}</div>`;
    } else {
      rv.innerHTML = `<div class="serif" style="font-size:1.05rem;color:var(--accent-2)">Noted for the ranking ✨</div>`;
    }
  });

  $('#next').onclick = () => go(i === list.length ? '#/recap' : `#/finale/${i + 1}`);
}

/* ============================================================
   RECAP — "My Night"
   ============================================================ */
export async function recap() {
  const ev = await activeEvent();
  const guest = await guestFor(ev);
  const list = await ratedList(ev, guest);
  if (!list.length) { toast('Nothing to recap yet'); return go('#/'); }

  const scored = list.map((x) => ({ ...x, final: x.rating.s2 || x.rating.s1 || 0, climb: (x.rating.s2 && x.rating.s1) ? x.rating.s2 - x.rating.s1 : 0 }));
  const ranked = [...scored].sort((a, b) => b.final - a.final || (b.rating.wouldBuy - a.rating.wouldBuy));
  const top = ranked[0];
  const climber = [...scored].sort((a, b) => b.climb - a.climb)[0];
  const buys = scored.filter((x) => x.rating.wouldBuy);
  const photos = scored.filter((x) => hasPhoto(x.rating)).length;

  // Shared moment: the room's favourite across everyone on this device+event.
  const roomFav = await roomFavourite(ev);

  const journey = ranked.map((x) => {
    const d = x.climb;
    const chip = d > 0 ? `<span class="delta up">▲ ${d}</span>` : d < 0 ? `<span class="delta down">▼ ${-d}</span>` : `<span class="delta same">–</span>`;
    return `
      <div class="journey-item">
        ${photoOf(x.rating) ? `<img class="thumb" src="${photoOf(x.rating)}" alt="">` : `<span class="thumb">${svg('cup')}</span>`}
        <div class="jt">
          <div class="n">${esc(x.sake.name)}</div>
          <div class="faint" style="font-size:.8rem">${x.course ? esc(x.course.name) : 'Surprise pour'}</div>
        </div>
        <div class="col" style="align-items:flex-end;gap:4px">
          ${miniHearts(x.final)}
          ${x.rating.s1 && x.rating.s2 ? chip : ''}
        </div>
      </div>`;
  }).join('');

  app().innerHTML = `
    <div class="screen pad-bottom-bar">
      <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
        <span class="eyebrow">My night</span><button class="iconbtn" id="share">${svg('share')}</button></div>

      <div class="center mt-8">
        <div class="eyebrow">${esc(ev.title)} · ${esc(fmtDate(ev.date))}</div>
        <h1 class="display" style="font-size:2.5rem;margin:8px 0">${guest.name ? esc(guest.name.split(' ')[0]) + '’s' : 'Your'} evening</h1>
      </div>

      <div class="card glow mt-16 center">
        <div class="eyebrow">Your pour of the night</div>
        <div style="margin:10px auto 0;max-width:220px">
          ${photoOf(top.rating)
            ? `<img src="${photoOf(top.rating)}" style="width:100%;border-radius:14px;aspect-ratio:1;object-fit:cover" alt="">`
            : `<div style="width:120px;height:120px;margin:auto;border-radius:50%;display:grid;place-items:center;background:var(--surface-2);color:var(--accent);font-size:2.4rem">${svg('cup')}</div>`}
        </div>
        <h2 class="sake-name" style="font-size:1.8rem;margin-top:12px">${esc(top.sake.name)}</h2>
        <div class="muted">${gradeLabel(top.sake.grade)} · ${miniHearts(top.final)}</div>
      </div>

      <div class="stat-grid mt-16">
        <div class="stat"><div class="n">${scored.length}</div><div class="l">Pours tasted</div></div>
        <div class="stat"><div class="n">${photos}</div><div class="l">Moments captured</div></div>
        <div class="stat"><div class="n">${buys.length}</div><div class="l">On take-home list</div></div>
        <div class="stat"><div class="n">${climber && climber.climb > 0 ? '+' + climber.climb : '—'}</div><div class="l">Biggest climber</div></div>
      </div>

      ${roomFav ? `
      <div class="card mt-16 center" style="border-color:color-mix(in srgb,var(--plum) 35%,transparent)">
        <div class="eyebrow" style="color:var(--plum)">${svg('users')} The room’s favourite tonight</div>
        <h2 class="sake-name" style="font-size:1.5rem;margin-top:8px">${esc(roomFav.name)}</h2>
        <div class="faint" style="font-size:.84rem">across ${roomFav.count} ${roomFav.count === 1 ? 'taster' : 'tasters'} at the table</div>
      </div>` : ''}

      <div class="divider"><span class="k">記録</span></div>
      <div class="eyebrow" style="color:var(--ink-3);margin-bottom:6px">Your ranking</div>
      ${journey}

      ${climber && climber.climb > 0 ? `<p class="faint center mt-16" style="font-size:.85rem">
        <b style="color:var(--ink-2)">${esc(climber.sake.name)}</b> grew on you the most tonight — from ${miniHearts(climber.rating.s1)} to ${miniHearts(climber.rating.s2)}.</p>` : ''}

      ${venueCard(ev, 'Loved the room?')}

      <button class="linkbtn" id="toHistory" style="display:block;margin:18px auto 0">See your full tasting history →</button>
    </div>

    <div class="actionbar col gap-4">
      ${guest.identified
        ? `<button class="btn primary block" id="done">Your recap is coming ✨</button>
           <div class="faint center" style="font-size:.75rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">to ${esc(guest.email || 'your inbox')}</div>`
        : `<button class="btn primary block" id="capture">${svg('sparkle')} Email me my night</button>`}
    </div>`;

  $('#back').onclick = () => go('#/');
  $('#toHistory').onclick = () => go('#/history');
  $('#share').onclick = () => shareNight(ev, guest, top);
  if ($('#capture')) $('#capture').onclick = () => maybeAskIdentity(guest, { force: true, reason: 'recap' });
  if ($('#done')) $('#done').onclick = () => toast('Your recap is on its way ✨');

  // Live: the room's favourite updates as other guests keep rating.
  let t;
  Net.subscribe(ev.id, () => { clearTimeout(t); t = setTimeout(() => {
    if ((location.hash || '').startsWith('#/recap')) recap();
  }, 500); });
}

async function roomFavourite(ev) {
  // Uses the anonymous server aggregate — no other guest's identity or photos ever reach a guest device.
  const data = await Net.results(ev.id);
  const agg = data && data.agg;
  if (!agg) return null;
  let best = null;
  for (const sakeId of Object.keys(agg)) {
    const a = agg[sakeId];
    if (!a.n) continue;
    const avg = a.sum / a.n;
    if (!best || avg > best.avg) best = { sakeId, avg, count: a.n };
  }
  if (!best) return null;
  const s = await Sakes.get(best.sakeId);
  return s ? { name: s.name, count: best.count } : null;
}

/* ============================================================
   MY JOURNEY — every sake this guest has tasted, across all events
   ============================================================ */
/* ============================================================
   Repeat-attendee intelligence — cross-event journey helpers
   ============================================================ */

/** The guest's full journey — every engaged pour with its sake + event, newest first. Layered:
    signed-in cross-device history (bounded 3s so a stalled connection can't hang) when available,
    else this device's local ratings. localOnly skips the network entirely (tasting hot path). */
async function collectJourney(ev, guest, { localOnly = false } = {}) {
  const items = [];
  let name = guest.name || '', email = guest.email || Net.guestEmail(), loggedIn = false;
  const server = (!localOnly && Net.guestToken())
    ? await Promise.race([Net.guestHistory(), new Promise((r) => setTimeout(() => r(null), 3000))])
    : null;
  if (server) {                                    // cross-device: everything for this email
    loggedIn = true;
    name = (server.guest && server.guest.name) || name;
    email = server.email || email;
    const eventsById = Object.fromEntries((server.events || []).map((e) => [e.id, e]));
    const sakesById = Object.fromEntries((server.sakes || []).map((s) => [s.id, s]));
    for (const r of (server.ratings || [])) {
      if (!engaged(r)) continue;
      const sake = sakesById[r.sakeId], e = eventsById[r.eventId];
      if (!sake || !e) continue;
      const course = (e.courses || []).find((c) => c.sakeId === r.sakeId) || null;
      items.push({ sake, rating: r, event: e, course, final: r.s2 || r.s1 || 0 });
    }
  } else {                                         // local: this device's guest
    for (const eid of (guest.eventIds || [])) {
      const e = await Events.get(eid);
      if (!e) continue;
      for (const r of await Ratings.forGuestEvent(guest.id, eid)) {
        if (!engaged(r)) continue;
        const sake = await Sakes.get(r.sakeId);
        if (!sake) continue;
        const course = (e.courses || []).find((c) => c.sakeId === r.sakeId) || null;
        items.push({ sake, rating: r, event: e, course, final: r.s2 || r.s1 || 0 });
      }
    }
  }
  items.sort((a, b) => a.event.id === b.event.id
    ? (a.course?.order || 99) - (b.course?.order || 99)
    : (b.event.date || '').localeCompare(a.event.date || ''));
  return { items, name, email, loggedIn };
}

/** A past pour the guest loved that's in the same flavour family as tonight's sake — the "you loved
    a junmai ginjo like this at the Jazz night" moment. Curated sakes only (real type4), other events. */
function bestPastMatch(items, s, ev) {
  // The course placeholder sake (unassigned / deleted library sake) has a type4 but no id — bail so
  // we never claim "you loved a similar sake" on a "Sake to be assigned" course.
  if (!s || !s.id || !s.type4 || s.adhoc) return null;
  const cand = items.filter((it) =>
    it.event.id !== ev.id && it.sake && !it.sake.adhoc &&
    it.sake.id !== s.id && it.sake.type4 === s.type4 && it.final >= 4);
  if (!cand.length) return null;
  cand.sort((a, b) => b.final - a.final || (b.event.date || '').localeCompare(a.event.date || ''));
  const w = cand[0];
  return { sakeName: w.sake.name, grade: w.sake.grade, final: w.final, eventTitle: w.event.title };
}

/** Would-buy sakes across every event, deduped by sake (best score kept), highest first. */
function dedupeWants(list) {
  const byName = new Map();
  for (const it of list) {
    const k = (it.sake.name || '').trim().toLowerCase();
    const prev = byName.get(k);
    if (!prev || it.final > prev.final) byName.set(k, it);
  }
  return [...byName.values()].sort((a, b) => b.final - a.final);
}

/** Weighted centroid of the guest's palate on the four-type quadrant, from curated sakes they rated
    (weighted by score); plus a drift between their earliest and latest event. null if too little data. */
function tastePalette(items) {
  const real = items.filter((it) => it.sake && !it.sake.adhoc && TYPE4[it.sake.type4] && it.final > 0);
  if (real.length < 3) return null;
  const centroid = (list) => {
    let sx = 0, sy = 0, w = 0;
    for (const it of list) { const q = TYPE4[it.sake.type4]; sx += q.x * it.final; sy += q.y * it.final; w += it.final; }
    return w ? { x: sx / w, y: sy / w } : null;
  };
  const all = centroid(real);
  const key = all.x < 50 ? (all.y < 50 ? 'kunshu' : 'soshu') : (all.y < 50 ? 'jukushu' : 'junshu');
  const t = TYPE4[key];
  let drift = null, from = null;
  const byDate = real.slice().sort((a, b) => (a.event.date || '').localeCompare(b.event.date || ''));
  const firstEid = byDate[0].event.id, lastEid = byDate[byDate.length - 1].event.id;
  if (firstEid !== lastEid) {
    const early = centroid(real.filter((it) => it.event.id === firstEid));
    const late = centroid(real.filter((it) => it.event.id === lastEid));
    if (early && late) {
      from = early;
      const dx = late.x - early.x, dy = late.y - early.y, parts = [];
      if (Math.abs(dx) >= 6) parts.push(dx > 0 ? 'richer' : 'lighter');
      if (Math.abs(dy) >= 6) parts.push(dy < 0 ? 'more aromatic' : 'quieter');
      if (parts.length) drift = parts.join(' & ');
    }
  }
  return { x: all.x, y: all.y, typeName: t.name, typeTag: t.tag, drift, from };
}

/** The four-type quadrant with the guest's own palate dot (and a faint 'earlier' dot when drifting). */
function paletteQuadHTML(x, y, from) {
  const dot = (px, py, faint) => `<span class="dot" style="left:${px}%;top:${py}%${faint ? ';opacity:.35;width:11px;height:11px' : ''}"></span>`;
  return `
    <div class="quad" role="img" aria-label="Your taste profile on the four-type map">
      <div class="axis v"></div><div class="axis h"></div>
      <span class="lbl t">Aromatic</span><span class="lbl b">Quiet</span>
      <span class="lbl l">Light</span><span class="lbl r">Rich</span>
      ${from ? dot(from.x, from.y, true) : ''}
      ${dot(x, y, false)}
    </div>`;
}

function takeHomeCardHTML(wants) {
  if (!wants.length) return '';
  const rows = wants.map((w) => `
    <div class="row between" style="padding:9px 0;border-top:1px solid var(--line-soft)">
      <div style="min-width:0"><div class="serif" style="font-size:1.05rem">${esc(w.sake.name)}</div>
        <div class="faint" style="font-size:.76rem">${esc(w.event.title)}</div></div>
      <div style="flex:none">${miniHearts(w.final)}</div>
    </div>`).join('');
  return `
    <div class="card mt-16">
      <div class="eyebrow" style="color:var(--accent)">${svg('bottle')} Your take-home list</div>
      <p class="faint" style="font-size:.8rem;margin:4px 0 2px">Bottles you marked to take home, across every night — mention them to your host, or reply to your recap to order.</p>
      ${rows}
    </div>`;
}

function paletteCardHTML(p) {
  if (!p) return '';
  return `
    <div class="card mt-16">
      <div class="eyebrow" style="color:var(--ink-3)">Your palate</div>
      <div class="row gap-16 mt-8" style="align-items:center">
        ${paletteQuadHTML(p.x, p.y, p.from)}
        <div style="flex:1;min-width:0">
          <div class="serif" style="font-size:1.2rem">${esc(p.typeName)}</div>
          <div class="muted" style="font-size:.9rem">${esc(p.typeTag)}</div>
          ${p.drift ? `<div class="faint" style="font-size:.82rem;margin-top:6px">Lately you’re trending <b style="color:var(--accent-2)">${esc(p.drift)}</b>.</div>` : ''}
        </div>
      </div>
    </div>`;
}

export async function history() {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);
  const guest = await guestFor(ev);          // this device's guest — for logging a sake on your own

  // Land any queued offline ratings first so a signed-in journey never hides what's still in the outbox.
  if (Net.guestToken()) { try { await Net.flushOutbox(); } catch { /* still offline */ } }
  const { items, name, email, loggedIn } = await collectJourney(ev, guest);

  if (!items.length) {
    app().innerHTML = `
      <div class="screen">
        <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
          <span class="eyebrow">My journey</span><span style="width:42px"></span></div>
        <div class="flex-grow" style="display:grid;place-items:center">
          <div class="empty"><div class="glyph">🍶</div>
            <div class="serif" style="font-size:1.2rem;color:var(--ink-2)">Your journey starts tonight</div>
            <div class="faint">Taste a pour and it’ll live here — with your score, photo and notes.</div>
            <a class="btn primary mt-24" href="#/">See tonight’s menu</a>
            <button class="btn subtle block mt-8" id="logSake">${svg('plus')} Log a sake you’re tasting</button>
            ${loggedIn ? '' : `<button class="linkbtn mt-16" id="toLogin">Been before? Sign in to see your journey →</button>`}</div>
        </div>
      </div>`;
    $('#back').onclick = () => go('#/');
    if ($('#logSake')) $('#logSake').onclick = () => openAddSake(SOLO_EVENT, guest, { solo: true });
    if ($('#toLogin')) $('#toLogin').onclick = () => go('#/login');
    maybeRestoreDraft(ev, guest, 'history');
    return;
  }

  const eventsSeen = new Set(items.map((i) => i.event.id));
  const buys = items.filter((i) => i.rating.wouldBuy).length;
  const top = items.reduce((best, i) => (i.final > (best ? best.final : 0) ? i : best), null);
  const wants = dedupeWants(items.filter((i) => i.rating.wouldBuy));
  const palette = tastePalette(items);

  const thumb = (r) => photoOf(r)
    ? `<img src="${photoOf(r)}" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none" alt="">`
    : `<span style="width:56px;height:56px;border-radius:12px;flex:none;display:grid;place-items:center;background:var(--surface-2);color:var(--ink-3)">${svg('cup')}</span>`;

  let rows = '', lastEvent = null, idx = 0;
  for (const it of items) {
    if (it.event.id !== lastEvent) {
      lastEvent = it.event.id;
      const sub = it.event.personal
        ? esc(it.event.subtitle || '')
        : esc(fmtDate(it.event.date)) + (it.event.venue ? ' · ' + esc(it.event.venue) : '');
      rows += `<div class="divider"><span class="k">${esc(it.event.title)}</span></div>
        <div class="faint center" style="font-size:.78rem;margin:-10px 0 14px">${sub}</div>`;
    }
    const r = it.rating;
    rows += `
      <div class="card tight" style="margin-bottom:12px">
        <div class="row gap-12" style="align-items:flex-start">
          ${thumb(r)}
          <div style="flex:1;min-width:0">
            <div class="sake-sub" style="font-family:var(--font-jp)">${esc(it.sake.romaji || '')}</div>
            <div class="serif" style="font-size:1.15rem">${esc(it.sake.name)}</div>
            <div class="faint" style="font-size:.8rem">${it.course ? esc(it.course.name) : (it.event.personal ? 'Your own tasting' : 'Surprise pour')} · ${gradeLabel(it.sake.grade)}</div>
          </div>
          <div class="col" style="align-items:flex-end;gap:6px">
            ${miniHearts(it.final)}
            ${r.wouldBuy ? `<span class="pill accent" style="padding:3px 8px;font-size:.68rem">${svg('bottle')} bottle</span>` : ''}
          </div>
        </div>
        ${it.sake.profile ? `<p class="profile-line" style="font-size:1rem;margin-top:10px">“${esc(it.sake.profile)}”</p>` : ''}
        ${pourTasteHTML(it.sake, r)}
        ${it.course && it.course.pairing && it.course.pairing.text
          ? `<div class="faint" style="font-size:.82rem;margin-top:8px">${esc(it.event.host)}: “${esc(it.course.pairing.text)}”</div>` : ''}
        ${r.note ? `<div class="why" style="padding:12px;margin-top:10px"><div class="eyebrow" style="color:var(--ink-3);margin-bottom:4px">Your note</div><p style="font-size:1rem">${esc(r.note)}</p></div>` : ''}
        <button class="linkbtn note-btn" data-idx="${idx}" style="padding:8px 0 0">${r.note ? 'Edit your note' : '＋ Add your tasting note'}</button>
      </div>`;
    idx++;
  }

  app().innerHTML = `
    <div class="screen pad-bottom-bar">
      <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
        <span class="eyebrow">My journey</span><span style="width:42px"></span></div>
      <div class="center mt-8">
        <h1 class="display" style="font-size:2.3rem;margin-bottom:4px">${name ? esc(name.split(' ')[0]) + '’s' : 'Your'} sake journey</h1>
        <div class="muted">${items.length} ${items.length === 1 ? 'pour' : 'pours'} across ${eventsSeen.size} ${eventsSeen.size === 1 ? 'evening' : 'evenings'}</div>
      </div>
      <div class="stat-grid mt-16">
        <div class="stat"><div class="n">${items.length}</div><div class="l">Sakes tasted</div></div>
        <div class="stat"><div class="n">${buys}</div><div class="l">On take-home list</div></div>
      </div>
      ${top && top.final ? `<div class="card glow mt-16 center"><div class="eyebrow">Your highest pour</div>
        <h2 class="sake-name" style="font-size:1.4rem;margin-top:6px">${esc(top.sake.name)}</h2>
        <div class="muted">${miniHearts(top.final)}</div></div>` : ''}
      ${takeHomeCardHTML(wants)}
      ${paletteCardHTML(palette)}
      <button class="btn subtle block mt-16" id="logSake">${svg('plus')} Log a sake you’re tasting</button>
      <div class="mt-16">${rows}</div>
      ${loggedIn
        ? `<p class="faint center mt-24" style="font-size:.8rem">Signed in as ${esc(email)} · <button class="linkbtn" id="logout" style="padding:10px 8px;font-size:.8rem">Sign out</button></p>`
        : `<p class="faint center mt-24" style="font-size:.8rem;line-height:1.5">Saved on this device.<br><button class="linkbtn" id="toLogin" style="padding:6px 0 0">Sign in to see your journey on any device →</button></p>`}
    </div>`;

  $('#back').onclick = () => go('#/');
  if ($('#logSake')) $('#logSake').onclick = () => openAddSake(SOLO_EVENT, guest, { solo: true });
  if ($('#toLogin')) $('#toLogin').onclick = () => go('#/login');
  if ($('#logout')) $('#logout').onclick = () => { Net.setGuestSession(null); toast('Signed out'); history(); };
  $$('.note-btn').forEach((b) => (b.onclick = () => editNote(items[+b.dataset.idx].rating)));
  maybeRestoreDraft(ev, guest, 'history');
}

async function editNote(rating) {
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.5rem">Your tasting note</h2>
    <p class="muted" style="font-size:.9rem;margin:4px 0 14px">A line for future-you — what did it taste of, and what made the night?</p>
    <textarea class="inp" id="noteText" style="min-height:110px" placeholder="Pear and cream… the one with the burrata. Unforgettable.">${esc(rating.note || '')}</textarea>
    <button class="btn primary block mt-16" id="noteSave">Save note</button>
    <button class="linkbtn" id="noteCancel" style="display:block;margin:8px auto 0">Cancel</button>
  `);
  body.querySelector('#noteCancel').onclick = () => closeSheet();
  body.querySelector('#noteSave').onclick = async () => {
    const note = body.querySelector('#noteText').value.trim();
    // Carry the known scores/photos so saving a note never blanks a cross-device rating.
    await Ratings.save(rating.guestId, rating.eventId, rating.sakeId, {
      s1: rating.s1 ?? null, s2: rating.s2 ?? null, wouldBuy: !!rating.wouldBuy,
      photoBottle: rating.photoBottle || null, photoFood: rating.photoFood || null, photo: rating.photo || null,
      note,
    });
    closeSheet();
    toast('Note saved ✍️');
    history();
  };
}

/* ============================================================
   Sign in (email magic-link, or festival password) — journey on any device
   ============================================================ */

/** Attach a signed-in session to this device and bring the returning guest's profile onto it
    (name + consents), so a new device keeps them instead of resetting to a blank first-timer. */
async function applySignIn(ev, data) {
  Net.setGuestSession(data.sessionToken, data.email);
  const g = await Guests.ensure(ev.id);
  const canon = data.guest;
  if (canon && !g.identified) {
    g.name = canon.name || g.name;
    g.email = data.email || canon.email || g.email;
    g.consentMarketing = !!canon.consentMarketing;
    g.consentPhotoFood = !!canon.consentPhotoFood;
    g.consentPhotoMe = !!canon.consentPhotoMe;
    if (canon.consentAt) g.consentAt = canon.consentAt;
    g.identified = true;
    await Guests.save(g);
  } else if (g.email !== data.email) {
    g.email = data.email; g.identified = true; await Guests.save(g);
  }
}

export async function login() {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);
  app().innerHTML = `
    <div class="screen">
      <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
        <span class="eyebrow">Your journey</span><span style="width:42px"></span></div>
      <div class="flex-grow" style="display:grid;place-items:center;text-align:center">
        <div style="max-width:340px;width:100%">
          <div class="hero-mark">${svg('sparkle', 'accent')}</div>
          <h1 class="display" style="font-size:2rem;margin:12px 0 6px">See it on any device</h1>
          <p class="muted" style="font-size:.95rem;margin-bottom:18px">Enter your email and we’ll send a link to open your full sake journey — every pour you’ve tasted with ${esc(ev.host)}.</p>
          <input class="inp" id="loginEmail" type="email" placeholder="you@example.com" style="text-align:center" value="${esc(Net.guestEmail())}" autocomplete="email">
          <button class="btn primary block mt-16" id="loginSend">Email me a link</button>
          <div id="loginMsg" class="faint mt-16" style="font-size:.85rem;line-height:1.5"></div>
          <div class="divider" style="margin:22px 0 14px"><span class="k" style="font-family:var(--font-ui);font-size:.66rem;letter-spacing:.18em">FESTIVAL TRIAL</span></div>
          <p class="faint" style="font-size:.82rem;margin-bottom:10px">Trying Sake Journey at a festival? Use your email above with your festival password.</p>
          <input class="inp" id="pwField" type="password" placeholder="Festival password" autocomplete="current-password" style="text-align:center">
          <button class="btn subtle block mt-8" id="pwSend">Sign in with password</button>
        </div>
      </div>
    </div>`;
  $('#back').onclick = () => go('#/history');
  const pwSubmit = async () => {
    const email = $('#loginEmail').value.trim();
    if (!email.includes('@')) { toast('Enter your email first'); $('#loginEmail').focus(); return; }
    const btn = $('#pwSend'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const data = await Net.guestPasswordLogin(email, $('#pwField').value);
      await applySignIn(ev, data);
      toast('Signed in ✨');
      go('#/history');
    } catch (e) { btn.disabled = false; btn.textContent = 'Sign in with password'; toast(e.message, 3000); }
  };
  $('#pwSend').onclick = pwSubmit;
  $('#pwField').addEventListener('keydown', (e) => { if (e.key === 'Enter') pwSubmit(); });
  const send = async () => {
    const email = $('#loginEmail').value.trim();
    if (!email.includes('@')) { toast('Enter a valid email'); return; }
    const btn = $('#loginSend'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await Net.guestLogin(email);
      if (r.sent) { $('#loginMsg').innerHTML = `Check your inbox — a sign-in link is on its way to <b>${esc(email)}</b>.`; btn.textContent = 'Sent ✓'; }
      else if (r.devLink) { $('#loginMsg').innerHTML = `Email isn’t set up on the server yet — <a class="linkbtn" style="padding:0" href="${esc(r.devLink)}">tap here to sign in</a>.`; btn.disabled = false; btn.textContent = 'Email me a link'; }
      else { $('#loginMsg').textContent = 'Hmm, something went wrong.'; btn.disabled = false; btn.textContent = 'Email me a link'; }
    } catch (e) { btn.disabled = false; btn.textContent = 'Email me a link'; toast('Login failed: ' + e.message, 3000); }
  };
  $('#loginSend').onclick = send;
  $('#loginEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

export async function claim(token) {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);
  app().innerHTML = `<div class="screen"><div class="flex-grow" style="display:grid;place-items:center"><div class="empty"><div class="glyph">🍶</div>Signing you in…</div></div></div>`;
  try {
    const data = await Net.guestClaim(token);
    await applySignIn(ev, data);
    toast('Signed in ✨');
    go('#/history');
  } catch (e) {
    const offline = !navigator.onLine || /fetch|network|load failed/i.test(String(e && e.message));
    const title = offline ? 'Couldn’t reach the server' : 'That link has expired';
    const sub = offline ? 'Check your connection and try again — your link is still valid.' : 'Sign-in links last 15 minutes.';
    app().innerHTML = `
      <div class="screen">
        <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
          <span class="eyebrow">Sign in</span><span style="width:42px"></span></div>
        <div class="flex-grow" style="display:grid;place-items:center">
          <div class="empty"><div class="glyph">🍶</div>
            <div class="serif" style="font-size:1.15rem;color:var(--ink-2)">${title}</div>
            <div class="faint">${sub}</div>
            ${offline
              ? `<button class="btn primary mt-24" id="retry">Try again</button>`
              : `<a class="btn primary mt-24" href="#/login">Get a new link</a>`}</div>
        </div>
      </div>`;
    $('#back').onclick = () => go('#/');
    if ($('#retry')) $('#retry').onclick = () => claim(token);
  }
}

/* ============================================================
   Surprise pour (+)  —  add & rate an off-menu sake
   ============================================================ */
/* ---- add-sake draft: survive the page being killed while the camera is open ----
   Android reclaims background tabs aggressively; coming back from the camera app can mean a full
   reload that used to throw away everything typed. The draft lives in sessionStorage (survives
   that reload, dies with the tab) and is cleared whenever the sheet closes on purpose. */
const DRAFT_KEY = 'sj_sakeDraft';
function readDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    return d && Date.now() - d.at < 45 * 60 * 1000 ? d : null;
  } catch { return null; }
}
const clearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch {} };

/** Re-open the add-sake sheet if a draft survived a reload. Call after home()/history() render. */
function maybeRestoreDraft(ev, guest, screen) {
  const d = readDraft();
  if (!d || document.querySelector('.sheet')) return;   // nothing saved, or another dialog is up
  if (screen === 'history' && d.solo) {
    toast('Picked up the sake you were logging ✍️');
    openAddSake(SOLO_EVENT, guest, { solo: true });
  } else if (screen === 'home' && !d.solo && d.evId === ev.id) {
    toast('Picked up the pour you were adding ✍️');
    openAddSake(ev, guest);
  }
}

async function openAddSake(ev, guest, { solo = false } = {}) {
  let draft = readDraft();
  if (draft && (draft.solo !== solo || (!solo && draft.evId !== ev.id))) draft = null;
  const heading = solo ? 'Log a sake' : 'A surprise pour';
  const intro = solo
    ? 'Tasting a sake anywhere — a bar, a bottle at home? Snap the label and we’ll try to identify it and research it for you.'
    : `${esc(ev.host || 'Your host')} poured something off-menu? Capture it and add it to your night.`;
  const namePh = solo ? 'e.g. Dassai 45, or ‘the one at the izakaya’' : 'e.g. Dassai 45, or ‘the cloudy one’';
  const canScan = solo && !!Net.guestToken();   // scanning is a signed-in, server-side feature
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.6rem">${heading}</h2>
    <p class="muted" style="font-size:.92rem;margin:4px 0 16px">${intro}</p>
    <div class="photo-zone" id="spPhoto" role="button" tabindex="0" aria-label="Take a photo of the bottle" style="aspect-ratio:16/10"><div class="ph">${svg('camera')}<span>Snap the label</span></div></div>
    ${canScan ? `<button class="btn subtle block mt-8 hidden" id="spScan">${svg('sparkle')} Identify this sake with AI</button>` : ''}
    <div id="spFound"></div>
    <label class="field mt-16"><span class="lab">What is it?</span>
      <input class="inp" id="spName" placeholder="${namePh}" value="${esc((draft && draft.name) || '')}"></label>
    <div class="rate-block center card" style="background:var(--surface)">
      <div class="rate-label">First impression</div>
      <div class="hearts-wrap">${heartsHTML((draft && draft.score) || 0)}</div>
      <div class="rate-word"></div>
    </div>
    ${solo ? `<div id="spMatrix"></div>` : ''}
    <button class="btn primary block mt-16" id="spSave">${solo ? 'Save to my journey' : 'Add to my night'}</button>
    <button class="linkbtn" id="spCancel" style="display:block;margin:8px auto 0">Cancel</button>
  `, { label: heading, onClose: clearDraft });   // any deliberate close (cancel, Escape, navigation) drops the draft

  let photo = (draft && draft.photo) || null, score = (draft && draft.score) || 0,
      scanned = (draft && draft.scanned) || null,
      myX = draft && draft.myX != null ? draft.myX : null, myY = draft && draft.myY != null ? draft.myY : null;
  const q = (sel) => body.querySelector(sel);
  const saveDraft = () => {
    if (!body.isConnected) return;   // sheet was closed while an await was pending — a deliberate
                                     // close cleared the draft; never resurrect it from a continuation
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        at: Date.now(), solo, evId: ev.id, name: q('#spName').value, score, myX, myY, scanned,
        photo: photo && photo.length < 1_500_000 ? photo : null,   // stay well inside the quota
      }));
    } catch { /* quota — the in-memory state still works */ }
  };

  // ---- interactive self-vs-expert taste matrix (solo only) ----
  const mineTag = (x, y) => TYPE4[x < 50 ? (y < 50 ? 'kunshu' : 'soshu') : (y < 50 ? 'jukushu' : 'junshu')].tag;
  function renderMatrix() {
    const wrap = q('#spMatrix'); if (!wrap) return;
    const ex = scanned && Number.isFinite(+scanned.expertX) ? clampPct(scanned.expertX) : null;
    const ey = scanned && Number.isFinite(+scanned.expertY) ? clampPct(scanned.expertY) : null;
    const hasExpert = ex !== null && ey !== null && (scanned.type4 || scanned.identified);
    const expertName = hasExpert && scanned.type4 && TYPE4[scanned.type4] ? TYPE4[scanned.type4].name : '';
    wrap.innerHTML = `
      <div class="card mt-16">
        <div class="eyebrow" style="color:var(--ink-3)">Your tasting profile</div>
        <p class="faint" style="font-size:.8rem;margin:4px 0 12px">Tap the map where it sits for <b>you</b> — light ↔ rich, aromatic ↔ quiet.${hasExpert ? ' The hollow dot is the expert read.' : ''}</p>
        <div class="row gap-16" style="align-items:center">
          <div class="quad tap" id="spQuad" role="application" tabindex="0" aria-label="Tap or use arrow keys to place your taste dot">
            <div class="axis v"></div><div class="axis h"></div>
            <span class="lbl t">Aromatic</span><span class="lbl b">Quiet</span>
            <span class="lbl l">Light</span><span class="lbl r">Rich</span>
            ${hasExpert ? `<span class="dot expert" style="left:${ex}%;top:${ey}%"></span>` : ''}
            <span class="dot mine ${myX === null ? 'hidden' : ''}" id="spMineDot" style="${myX === null ? '' : `left:${myX}%;top:${myY}%`}"></span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="matrix-legend"><span class="key"><span class="dot mine sm"></span>You</span>${hasExpert ? `<span class="key"><span class="dot expert sm"></span>Expert${expertName ? ' · ' + esc(expertName) : ''}</span>` : ''}</div>
            <div class="faint" id="spMineLabel" style="font-size:.82rem;margin-top:8px">${myX === null ? 'Tap the map to add yours.' : 'You: ' + esc(mineTag(myX, myY))}</div>
          </div>
        </div>
      </div>`;
    const quad = q('#spQuad');
    const setMine = (x, y) => {
      myX = clampPct(x); myY = clampPct(y);
      const dot = q('#spMineDot'); if (dot) { dot.style.left = myX + '%'; dot.style.top = myY + '%'; dot.classList.remove('hidden'); }
      const lab = q('#spMineLabel'); if (lab) lab.textContent = 'You: ' + mineTag(myX, myY);
      saveDraft();
    };
    quad.onclick = (e) => { const r = quad.getBoundingClientRect(); setMine(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100); };
    quad.onkeydown = (e) => {
      const step = e.shiftKey ? 10 : 4; let nx = myX === null ? 50 : myX, ny = myY === null ? 50 : myY, used = true;
      if (e.key === 'ArrowLeft') nx -= step; else if (e.key === 'ArrowRight') nx += step;
      else if (e.key === 'ArrowUp') ny -= step; else if (e.key === 'ArrowDown') ny += step; else used = false;
      if (used) { e.preventDefault(); setMine(nx, ny); }
    };
  }
  if (solo) renderMatrix();

  // ---- photo capture ----
  const spZone = q('#spPhoto');
  const showPhoto = () => {
    if (!photo) return;
    spZone.innerHTML = `<img src="${esc(photo)}" alt="">`;
    const sb = q('#spScan'); if (sb) sb.classList.remove('hidden');
  };
  spZone.onclick = async () => {
    saveDraft();   // the camera may kill the page — bank what's typed so far first
    const d = await pickPhoto();
    if (!d || !body.isConnected) return;   // cancelled, unreadable, or the sheet was closed meanwhile
    photo = d; showPhoto(); saveDraft();
  };
  spZone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spZone.click(); } };

  // ---- AI scan ----
  const scanBtn = q('#spScan');
  if (scanBtn) scanBtn.onclick = async () => {
    if (!photo) { toast('Snap the label first'); return; }
    scanBtn.disabled = true; scanBtn.innerHTML = 'Reading the label…';
    try {
      scanned = await Net.scanSake(photo);
      if (!body.isConnected) return;   // sheet closed during the scan — don't toast or resurrect a draft
      const nameEl = q('#spName');
      if (scanned.name && !nameEl.value.trim()) nameEl.value = scanned.name;
      q('#spFound').innerHTML = scanAboutHTML(scanned);
      renderMatrix();
      saveDraft();
      toast(scanned.identified ? 'Identified ✨' : 'Logged what we could read');
    } catch (e) { toast(e.message || 'Couldn’t read that one'); }
    finally { scanBtn.disabled = false; scanBtn.innerHTML = `${svg('sparkle')} ${scanned ? 'Scan again' : 'Identify this sake with AI'}`; }
  };

  wireHearts(q('.hearts-wrap'), score, (v) => { score = v; saveDraft(); });
  q('#spName').addEventListener('input', saveDraft);
  // restore what a reload interrupted: the photo, the research card (matrix re-rendered above)
  showPhoto();
  if (scanned) q('#spFound').innerHTML = scanAboutHTML(scanned);
  q('#spCancel').onclick = () => closeSheet();
  q('#spSave').onclick = async () => {
    const name = q('#spName').value.trim();
    if (!name && !photo) { toast('Add a name or a photo'); return; }
    // A solo pour attaches to this device's guest and the personal journal — make sure both exist.
    if (solo) guest = await Guests.ensure(SOLO_EVENT.id);
    const sc = scanned || {};
    const s = {
      id: uid('s'),
      name: name || sc.name || (solo ? 'A sake' : 'Surprise pour'),
      romaji: sc.japaneseName || '',
      brewery: sc.brewery || (solo ? '' : 'Off-menu'),
      region: sc.region || '',
      grade: sc.grade || '',
      type4: sc.type4 || 'junshu',
      temp: 'joon',
      smv: sc.smv || '', acidity: sc.acidity || '', abv: sc.abv || '', seimai: sc.seimai || '',
      profile: sc.profile || (solo ? 'A sake you logged on your own.' : 'A spontaneous pour, added at the table.'),
      tags: (sc.tags && sc.tags.length) ? sc.tags : (solo ? ['solo'] : ['surprise']),
      about: sc.about || '',
      adhoc: true, eventId: ev.id, addedBy: guest.id,
    };
    if (scanned && Number.isFinite(+sc.expertX) && (sc.type4 || sc.identified)) { s.expertX = clampPct(sc.expertX); s.expertY = clampPct(sc.expertY); }
    await Sakes.save(s);
    const patch = { s1: score || null, photoBottle: photo };
    if (solo) patch.logged = true;   // a named solo entry counts even without a score
    if (myX !== null && myY !== null) { patch.myX = myX; patch.myY = myY; }
    await Ratings.save(guest.id, ev.id, s.id, patch);
    closeSheet();
    toast(`Added “${s.name}” ✨`);
    // Navigate via the router (it owns the hash — rendering home() directly from #/course/N would
    // leave that course row and "Continue tasting" dead, since re-tapping the same hash is a no-op).
    if (solo) go('#/history');
    else if ((location.hash || '').startsWith('#/recap') || location.hash.startsWith('#/finale')) go('#/recap');
    else go('#/');
    // Ask for identity after the new screen settles — navigation closes any open sheet.
    setTimeout(() => maybeAskIdentity(guest), 700);
  };
}

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(+v) || 0));

/** The "what we found" research card shown after an AI scan. Everything is escaped — model text is untrusted. */
function scanAboutHTML(sc) {
  if (!sc) return '';
  const specs = [];
  if (sc.grade) specs.push(gradeLabel(sc.grade));
  if (sc.seimai) specs.push('Seimai ' + esc(String(sc.seimai)));
  if (sc.smv) specs.push('SMV ' + esc(String(sc.smv)));
  if (sc.abv) specs.push(esc(String(sc.abv)) + (String(sc.abv).includes('%') ? '' : '% ABV'));
  const chips = (sc.tags || []).slice(0, 6).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('');
  const src = (sc.sources || []).length ? `<div class="faint" style="font-size:.72rem;margin-top:8px">Sources: ${sc.sources.map((x) => esc(x)).join(' · ')}</div>` : '';
  const header = sc.brewery ? `${esc(sc.brewery)}${sc.region ? ' · ' + esc(sc.region) : ''}` : (sc.region ? esc(sc.region) : '');
  return `
    <div class="card mt-8">
      <div class="eyebrow" style="color:var(--accent)">${svg('sparkle')} What we found${sc.identified ? '' : ' <span class="faint" style="text-transform:none;letter-spacing:0">· best guess</span>'}</div>
      ${sc.japaneseName ? `<div class="sake-sub" style="font-family:var(--font-jp);margin-top:4px">${esc(sc.japaneseName)}</div>` : ''}
      ${header ? `<div class="serif" style="font-size:1.05rem">${header}</div>` : ''}
      ${specs.length ? `<div class="faint" style="font-size:.8rem;margin-top:2px">${specs.join(' · ')}</div>` : ''}
      ${sc.about ? `<p style="font-size:.9rem;margin:8px 0 0;line-height:1.5">${esc(sc.about)}</p>` : ''}
      ${chips ? `<div class="mini-tags mt-8">${chips}</div>` : ''}
      ${src}
    </div>`;
}

/** A read-only self-vs-expert quadrant + research, shown on a journey pour that has either dot or research. */
function pourTasteHTML(sake, r) {
  const hasMine = r && r.myX != null && Number.isFinite(+r.myX) && r.myY != null && Number.isFinite(+r.myY);
  const hasExpert = sake && sake.expertX != null && Number.isFinite(+sake.expertX) && sake.expertY != null && Number.isFinite(+sake.expertY);
  if (!hasMine && !hasExpert && !(sake && sake.about)) return '';
  const dots = `${hasExpert ? `<span class="dot expert" style="left:${clampPct(sake.expertX)}%;top:${clampPct(sake.expertY)}%"></span>` : ''}${hasMine ? `<span class="dot mine" style="left:${clampPct(r.myX)}%;top:${clampPct(r.myY)}%"></span>` : ''}`;
  const legend = `${hasMine ? '<span class="key"><span class="dot mine sm"></span>You</span>' : ''}${hasExpert ? `<span class="key"><span class="dot expert sm"></span>Expert${sake.type4 && TYPE4[sake.type4] ? ' · ' + esc(TYPE4[sake.type4].name) : ''}</span>` : ''}`;
  const quad = (hasMine || hasExpert) ? `
    <div class="quad" role="img" aria-label="Your taste placement versus the expert">
      <div class="axis v"></div><div class="axis h"></div>
      <span class="lbl t">Aromatic</span><span class="lbl b">Quiet</span>
      <span class="lbl l">Light</span><span class="lbl r">Rich</span>
      ${dots}
    </div>` : '';
  return `
    <div class="why" style="padding:12px;margin-top:10px">
      <div class="row gap-12" style="align-items:center">
        ${quad}
        <div style="flex:1;min-width:0">
          ${legend ? `<div class="matrix-legend">${legend}</div>` : ''}
          ${sake.about ? `<p class="faint" style="font-size:.82rem;line-height:1.5;margin-top:${legend ? '8px' : '0'}">${esc(sake.about)}</p>` : ''}
        </div>
      </div>
    </div>`;
}

/* ============================================================
   Identity + consent capture (gentle, value-first)
   ============================================================ */
let identityShown = false;
export async function maybeAskIdentity(guest, { force = false, reason = 'save' } = {}) {
  const g = await Guests.get(guest.id);
  if (g.identified && !force) return;
  if (identityShown && !force) return;         // ask once per session unless forced
  identityShown = true;

  const ev = await activeEvent();
  const host = ev.host || 'us';
  const perk = (ev.optinPerk || '').trim();
  const recap0 = reason === 'recap';

  const heading = recap0 ? 'Keep your night' : 'Save your night';
  const sub = recap0
    ? `Your photos, rankings and ${esc(host)}’s pairing notes — and you’ll be first to hear about the next one.`
    : `Your recap, photos and notes — sent after the event, and yours to keep.`;

  const body = openSheet(`
    <h2 class="serif" style="font-size:1.7rem">${heading}</h2>
    <p class="muted" style="font-size:.92rem;margin:4px 0 14px">${sub}</p>

    <label class="field"><span class="lab">Email</span>
      <input class="inp" id="idEmail" type="email" inputmode="email" autocomplete="email" value="${esc(g.email)}" placeholder="you@example.com"></label>
    <label class="field"><span class="lab">First name <span class="faint">(optional)</span></span>
      <input class="inp" id="idName" value="${esc(g.name)}" placeholder="So ${esc(host.split(' ')[0])} can say hi"></label>

    <div class="card" style="padding:14px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent);border-color:color-mix(in srgb,var(--accent) 26%,transparent)">
      <div class="row gap-8" style="align-items:flex-start">
        <span style="color:var(--accent);flex:none;line-height:0;margin-top:2px">${svg('sparkle')}</span>
        <div style="font-size:.92rem;color:var(--ink);line-height:1.45">
          <b>Be first in the room.</b> ${esc(host)}’s nights sell out — list members get first pick of the next one${perk ? `, plus <b>${esc(perk)}</b>` : ''}.
        </div>
      </div>
    </div>

    <button class="btn primary block mt-16" id="idOptin">${recap0 ? 'Email my recap & keep me in the loop' : 'Save my night & keep me in the loop'}</button>
    <button class="linkbtn" id="idPlain" style="display:block;margin:10px auto 0">${recap0 ? 'Just email my recap' : 'Just save my night'} — no invites</button>

    <div class="mt-16" style="border-top:1px solid var(--line-soft);padding-top:12px">
      <div class="eyebrow" style="color:var(--ink-3);margin-bottom:8px">${svg('camera')} Feature my photos</div>
      <label class="check"><input type="checkbox" id="cPhotoFood" ${(g.consentPhotoFood || !g.identified) ? 'checked' : ''}>
        <span class="ct">${esc(host)} can share my <b>food &amp; drink</b> photos.</span></label>
      <label class="check"><input type="checkbox" id="cPhotoMe" ${g.consentPhotoMe ? 'checked' : ''}>
        <span class="ct">…and photos of <b>me</b> are fine too — tag me!</span></label>
    </div>

    <p class="faint center" style="font-size:.72rem;margin-top:4px">One-tap unsubscribe in every email. We never share your details.</p>
    <button class="linkbtn" id="idLater" style="display:block;margin:4px auto 0;color:var(--ink-3)">Not now</button>
  `);

  const commit = async (optIn) => {
    const email = body.querySelector('#idEmail').value.trim();
    if (!email.includes('@')) { toast('Add your email so we can send it'); body.querySelector('#idEmail').focus(); return; }
    g.name = body.querySelector('#idName').value.trim();
    g.email = email;
    g.consentMarketing = optIn;
    g.consentPhotoFood = body.querySelector('#cPhotoFood').checked;
    g.consentPhotoMe = body.querySelector('#cPhotoMe').checked;
    g.identified = true;
    g.consentAt = Date.now();               // timestamped consent (Spam Act / APP evidence)
    await Guests.save(g);
    closeSheet();
    if (optIn && perk) toast(`You’re in ✨ ${perk}`, 3400);
    else if (optIn) toast('You’re on the list ✨');
    else toast('Saved — your recap is on its way ✨');
    if ((location.hash || '').startsWith('#/recap')) recap();
  };
  body.querySelector('#idOptin').onclick = () => commit(true);
  body.querySelector('#idPlain').onclick = () => commit(false);
  body.querySelector('#idLater').onclick = () => closeSheet();
}

/* ---------- Share ---------- */
async function shareNight(ev, guest, top) {
  const text = `My night at ${ev.title} 🍶 — favourite pour: ${top.sake.name}. Hosted by ${ev.host}.`;
  try {
    if (navigator.share) { await navigator.share({ title: ev.title, text }); return; }
  } catch { /* cancelled */ }
  try { await navigator.clipboard.writeText(text); toast('Copied — share your night ✨'); }
  catch { toast('Screenshot this page to share'); }
}
