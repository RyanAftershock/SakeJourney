/* ============================================================
   Sake Journey — guest experience
   QR → menu → course-by-course → capture & rate →
   de-anchored re-rank finale → "My Night" recap.
   Designed as a quiet glance-tool: big type, few taps.
   ============================================================ */

import { Events, Sakes, Guests, Ratings, session, uid } from '../store.js';
import * as Net from '../net.js';
import {
  $, $$, node, esc, svg, gradeLabel, quadrantHTML, quadLegend, tempHTML,
  heartsHTML, wireHearts, miniHearts, toast, openSheet, closeSheet, pickPhoto,
  fmtDate, ordinal,
} from '../ui.js';
import { applyTheme } from '../app.js';

const app = () => document.getElementById('app');
const go = (h) => { location.hash = h; };

/* ---------- shared data helpers ---------- */
async function activeEvent() {
  const ev = await Events.get(session.activeEventId);
  return ev || (await Events.all())[0];
}
async function guestFor(ev) { return Guests.ensure(ev.id); }

/** The photo that best represents a pour — the bottle first (find it again), then the dish, then legacy. */
const photoOf = (r) => (r && (r.photoBottle || r.photoFood || r.photo)) || null;
const hasPhoto = (r) => !!(r && (r.photoBottle || r.photoFood || r.photo));

/** Has the guest engaged with this pour at all? (rated, photographed, or wants a bottle) */
const engaged = (r) => !!(r && (r.s1 || r.s2 || r.photoBottle || r.photoFood || r.photo || r.wouldBuy));

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

/* ============================================================
   HOME — tonight's journey
   ============================================================ */
export async function home() {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);
  const guest = await guestFor(ev);
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
    <div class="screen pad-bottom-bar">
      <div class="topbar">
        <a class="brand" href="#/"><span class="brand-logo" role="img" aria-label="Sake Journey"></span></a>
        <button class="iconbtn" id="toHost" aria-label="Host tools">${svg('users')}</button>
      </div>

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

    <div class="actionbar">
      <button class="iconbtn accent" id="addSurprise" aria-label="Add a surprise pour">${svg('plus')}</button>
      <button class="btn primary block" id="begin">${started ? 'Continue tasting' : 'Begin the journey'}</button>
    </div>`;

  $('#toHost').onclick = () => go('#/host');
  $('#toHistory').onclick = () => go('#/history');
  $('#addSurprise').onclick = () => openAddSake(ev, guest);
  $('#begin').onclick = () => {
    const next = ev.courses.findIndex((c) => !progress.find((r) => r.sakeId === c.sakeId && engaged(r)));
    go(`#/course/${next === -1 ? 1 : next + 1}`);
  };
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
        <div class="photo-zone" id="zoneBottle">${zoneInner('bottle', rating.photoBottle)}</div>
        <div class="photo-zone" id="zoneFood">${zoneInner('food', rating.photoFood)}</div>
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
    <div class="screen pad-bottom-bar">
      <div class="topbar"><span style="width:42px"></span><div class="rail">${rail}</div><span style="width:42px"></span></div>

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

    <div class="actionbar">
      <button class="btn primary block" id="next">${i === list.length ? 'See my night' : 'Next'}</button>
    </div>`;

  // First pass: no s2 yet, so hearts start empty and Next waits for a tap (de-anchored).
  // Re-entry: a saved s2 pre-fills and lets them move on without re-rating.
  $('#next').disabled = !rating.s2;
  wireHearts($('.hearts-wrap'), rating.s2 || 0, async (v) => {
    await Ratings.save(guest.id, ev.id, sake.id, { s2: v });
    $('#next').disabled = false;
    // De-anchored reveal: only now do we show what they said earlier.
    const rv = $('#reveal');
    rv.classList.remove('hidden');
    if (rating.s1) {
      const d = v - rating.s1;
      const word = d > 0 ? `It climbed — nicely done, ${sake.name.split(' ')[0]}.`
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

    <div class="actionbar">
      ${guest.identified
        ? `<button class="btn primary block" id="done">We’ll send this to ${esc(guest.email || 'your inbox')}</button>`
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
  const all = await Ratings.forEvent(ev.id);
  const agg = new Map();
  for (const r of all) {
    const f = r.s2 || r.s1; if (!f) continue;
    const a = agg.get(r.sakeId) || { sum: 0, n: 0 };
    a.sum += f; a.n += 1; agg.set(r.sakeId, a);
  }
  let best = null;
  for (const [sakeId, a] of agg) {
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
export async function history() {
  const ev = await activeEvent();
  applyTheme(session.theme || ev.theme);

  const items = [];
  let name = '', email = Net.guestEmail();
  const server = Net.guestToken() ? await Net.guestHistory() : null;
  const loggedIn = !!server;

  if (loggedIn) {                                   // cross-device: everything for this email
    name = (server.guest && server.guest.name) || '';
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
  } else {                                          // local: this device's guest
    const guest = await guestFor(ev);
    name = guest.name; email = guest.email;
    for (const eid of (guest.eventIds || [])) {
      const e = await Events.get(eid);
      if (!e) continue;
      const ratings = await Ratings.forGuestEvent(guest.id, eid);
      for (const r of ratings) {
        if (!engaged(r)) continue;
        const sake = await Sakes.get(r.sakeId);
        if (!sake) continue;
        const course = (e.courses || []).find((c) => c.sakeId === r.sakeId) || null;
        items.push({ sake, rating: r, event: e, course, final: r.s2 || r.s1 || 0 });
      }
    }
  }
  // newest event first, then course order within an event
  items.sort((a, b) => a.event.id === b.event.id
    ? (a.course?.order || 99) - (b.course?.order || 99)
    : (b.event.date || '').localeCompare(a.event.date || ''));

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
            ${loggedIn ? '' : `<button class="linkbtn mt-16" id="toLogin">Been before? Sign in to see your journey →</button>`}</div>
        </div>
      </div>`;
    $('#back').onclick = () => go('#/');
    if ($('#toLogin')) $('#toLogin').onclick = () => go('#/login');
    return;
  }

  const eventsSeen = new Set(items.map((i) => i.event.id));
  const buys = items.filter((i) => i.rating.wouldBuy).length;
  const top = items.reduce((best, i) => (i.final > (best ? best.final : 0) ? i : best), null);

  const thumb = (r) => photoOf(r)
    ? `<img src="${photoOf(r)}" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none" alt="">`
    : `<span style="width:56px;height:56px;border-radius:12px;flex:none;display:grid;place-items:center;background:var(--surface-2);color:var(--ink-3)">${svg('cup')}</span>`;

  let rows = '', lastEvent = null, idx = 0;
  for (const it of items) {
    if (it.event.id !== lastEvent) {
      lastEvent = it.event.id;
      rows += `<div class="divider"><span class="k">${esc(it.event.title)}</span></div>
        <div class="faint center" style="font-size:.78rem;margin:-10px 0 14px">${esc(fmtDate(it.event.date))}${it.event.venue ? ' · ' + esc(it.event.venue) : ''}</div>`;
    }
    const r = it.rating;
    rows += `
      <div class="card tight" style="margin-bottom:12px">
        <div class="row gap-12" style="align-items:flex-start">
          ${thumb(r)}
          <div style="flex:1;min-width:0">
            <div class="sake-sub" style="font-family:var(--font-jp)">${esc(it.sake.romaji || '')}</div>
            <div class="serif" style="font-size:1.15rem">${esc(it.sake.name)}</div>
            <div class="faint" style="font-size:.8rem">${it.course ? esc(it.course.name) : 'Surprise pour'} · ${gradeLabel(it.sake.grade)}</div>
          </div>
          <div class="col" style="align-items:flex-end;gap:6px">
            ${miniHearts(it.final)}
            ${r.wouldBuy ? `<span class="pill accent" style="padding:3px 8px;font-size:.68rem">${svg('bottle')} bottle</span>` : ''}
          </div>
        </div>
        ${it.sake.profile ? `<p class="profile-line" style="font-size:1rem;margin-top:10px">“${esc(it.sake.profile)}”</p>` : ''}
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
      <div class="mt-16">${rows}</div>
      ${loggedIn
        ? `<p class="faint center mt-24" style="font-size:.8rem">Signed in as ${esc(email)} · <button class="linkbtn" id="logout" style="padding:0;font-size:.8rem">Sign out</button></p>`
        : `<p class="faint center mt-24" style="font-size:.8rem;line-height:1.5">Saved on this device.<br><button class="linkbtn" id="toLogin" style="padding:6px 0 0">Sign in to see your journey on any device →</button></p>`}
    </div>`;

  $('#back').onclick = () => go('#/');
  if ($('#toLogin')) $('#toLogin').onclick = () => go('#/login');
  if ($('#logout')) $('#logout').onclick = () => { Net.setGuestSession(null); toast('Signed out'); history(); };
  $$('.note-btn').forEach((b) => (b.onclick = () => editNote(items[+b.dataset.idx].rating)));
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
   Sign in (email magic-link) — see your journey on any device
   ============================================================ */
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
        </div>
      </div>
    </div>`;
  $('#back').onclick = () => go('#/history');
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
    Net.setGuestSession(data.sessionToken, data.email);
    // Link this device's guest to the account so future ratings aggregate by email.
    const g = await Guests.ensure(ev.id);
    if (g.email !== data.email) { g.email = data.email; g.identified = true; await Guests.save(g); }
    toast('Signed in ✨');
    go('#/history');
  } catch (e) {
    app().innerHTML = `
      <div class="screen">
        <div class="topbar"><button class="iconbtn" id="back">${svg('back')}</button>
          <span class="eyebrow">Sign in</span><span style="width:42px"></span></div>
        <div class="flex-grow" style="display:grid;place-items:center">
          <div class="empty"><div class="glyph">🍶</div>
            <div class="serif" style="font-size:1.15rem;color:var(--ink-2)">That link has expired</div>
            <div class="faint">Sign-in links last 15 minutes.</div>
            <a class="btn primary mt-24" href="#/login">Get a new link</a></div>
        </div>
      </div>`;
    $('#back').onclick = () => go('#/');
  }
}

/* ============================================================
   Surprise pour (+)  —  add & rate an off-menu sake
   ============================================================ */
async function openAddSake(ev, guest) {
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.6rem">A surprise pour</h2>
    <p class="muted" style="font-size:.92rem;margin:4px 0 16px">Kana - Sake Journey poured something off-menu? Capture it and add it to your night.</p>
    <div class="photo-zone" id="spPhoto" style="aspect-ratio:16/10"><div class="ph">${svg('camera')}<span>Snap the bottle</span></div></div>
    <label class="field mt-16"><span class="lab">What is it?</span>
      <input class="inp" id="spName" placeholder="e.g. Dassai 45, or ‘the cloudy one’"></label>
    <div class="rate-block center card" style="background:var(--surface)">
      <div class="rate-label">First impression</div>
      <div class="hearts-wrap">${heartsHTML(0)}</div>
      <div class="rate-word"></div>
    </div>
    <button class="btn primary block mt-16" id="spSave">Add to my night</button>
    <button class="linkbtn" id="spCancel" style="display:block;margin:8px auto 0">Cancel</button>
  `);

  let photo = null, score = 0;
  body.querySelector('#spPhoto').onclick = async () => {
    const d = await pickPhoto(); if (!d) return; photo = d;
    body.querySelector('#spPhoto').innerHTML = `<img src="${d}" alt="">`;
  };
  wireHearts(body.querySelector('.hearts-wrap'), 0, (v) => (score = v));
  body.querySelector('#spCancel').onclick = () => closeSheet();
  body.querySelector('#spSave').onclick = async () => {
    const name = body.querySelector('#spName').value.trim();
    if (!name && !photo) { toast('Add a name or a photo'); return; }
    const s = {
      id: uid('s'), name: name || 'Surprise pour', romaji: '', brewery: 'Off-menu', region: '',
      grade: '', type4: 'junshu', temp: 'joon', smv: '', acidity: '', abv: '', seimai: '',
      profile: 'A spontaneous pour, added at the table.', tags: ['surprise'],
      adhoc: true, eventId: ev.id, addedBy: guest.id,
    };
    await Sakes.save(s);
    await Ratings.save(guest.id, ev.id, s.id, { s1: score || null, photoBottle: photo });
    closeSheet();
    toast(`Added “${s.name}” ✨`);
    maybeAskIdentity(guest);
    if ((location.hash || '').startsWith('#/recap') || location.hash.startsWith('#/finale')) go('#/recap'); else home();
  };
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
