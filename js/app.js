/* ============================================================
   Sake Journey — bootstrap + hash router
   ============================================================ */

import { initStore, session, Events } from './store.js';
import * as Net from './net.js';
import { closeSheet } from './ui.js';
import * as Guest from './views/guest.js';
import * as Host from './views/host.js';

const app = () => document.getElementById('app');

/* ---------- Theme ---------- */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'default');
  // Keep the browser chrome in step with the theme (else Evening mode gets an ivory status bar).
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

/* ---------- Routing ---------- */
export function go(hash) {
  if (location.hash === hash) route();      // same hash → force re-render
  else location.hash = hash;
}

const ROUTES = [
  [/^#?\/?$/,                    () => Guest.home()],
  [/^#\/e\/([^/]+)$/,            (m) => { session.activeEventId = m[1]; go('#/'); }],
  [/^#\/course\/(\d+)$/,        (m) => Guest.course(+m[1])],
  [/^#\/finale$/,               () => Guest.finale()],
  [/^#\/finale\/(\d+)$/,        (m) => Guest.finaleStep(+m[1])],
  [/^#\/recap$/,                () => Guest.recap()],
  [/^#\/history$/,              () => Guest.history()],
  [/^#\/login$/,                () => Guest.login()],
  [/^#\/claim\/([^/]+)$/,       (m) => Guest.claim(m[1])],

  [/^#\/host$/,                 () => Host.home()],
  [/^#\/host\/event\/([^/]+)$/, (m) => Host.eventEditor(m[1])],
  [/^#\/host\/results\/([^/]+)$/,(m) => Host.results(m[1])],
  [/^#\/host\/library$/,        () => Host.library()],
  [/^#\/host\/share\/([^/]+)$/, (m) => Host.share(m[1])],
];

let _nav = 0;
let _navInTimer = 0;
async function route() {
  const nav = ++_nav;                    // stamp this navigation
  Net.closeStream();                     // drop any live subscription from the previous screen
  closeSheet();                          // a sheet belongs to the screen that opened it — never carry
                                         // one across navigation (it would also leave scroll locked)
  // Entrance animation is navigation-only: live re-renders outside route() don't get .nav-in.
  app().classList.add('nav-in');
  clearTimeout(_navInTimer);
  _navInTimer = setTimeout(() => app().classList.remove('nav-in'), 600);
  const hash = location.hash || '#/';
  for (const [re, handler] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      try { await handler(m); }
      catch (err) { if (nav === _nav) { console.error(err); app().innerHTML = errorScreen(err); } }
      // If a newer navigation started while this handler awaited, its route() owns the screen now —
      // don't scroll or otherwise fight it.
      if (nav === _nav) { window.scrollTo(0, 0); focusHeading(); }
      return;
    }
  }
  if (nav === _nav) app().innerHTML = `<div class="screen"><div class="empty"><div class="glyph">🍶</div>Page not found.<br><a class="linkbtn" href="#/">Back to the event</a></div></div>`;
}

// Move focus to the new screen's title so screen readers announce the change (replaces the old
// app-wide aria-live, which re-announced entire screens on every live update).
function focusHeading() {
  const el = app().querySelector('h1, .eyebrow');
  if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
}

function errorScreen(err) {
  return `<div class="screen"><div class="empty"><div class="glyph">🍶</div>
    Something went sideways.<br><span class="faint">${(err && err.message) || err}</span><br>
    <a class="linkbtn" href="#/">Start again</a></div></div>`;
}

/* ---------- Init ---------- */
async function boot() {
  try {
    await initStore();
  } catch (err) {
    // Local storage (IndexedDB) is blocked — often a locked-down private/incognito window. Show an
    // actionable message rather than a permanent blank screen.
    console.error('storage unavailable', err);
    app().innerHTML = `<div class="screen"><div class="empty"><div class="glyph">🍶</div>
      <div class="serif" style="font-size:1.2rem;color:var(--ink-2)">Can’t open on this browser</div>
      <div class="faint">Your browser is blocking local storage — this often happens in a private/incognito window. Open Sake Journey in a normal window to continue.</div></div></div>`;
    return;
  }
  // Set the opening theme from the active event (guest override wins).
  const ev = await Events.get(session.activeEventId);
  applyTheme(session.theme || (ev && ev.theme) || 'default');
  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot().catch((e) => console.error('boot failed', e));
