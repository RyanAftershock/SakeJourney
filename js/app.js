/* ============================================================
   Sake Journey — bootstrap + hash router
   ============================================================ */

import { initStore, session, Events } from './store.js';
import * as Net from './net.js';
import * as Guest from './views/guest.js';
import * as Host from './views/host.js';

const app = () => document.getElementById('app');

/* ---------- Theme ---------- */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'default');
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

async function route() {
  Net.closeStream();                     // drop any live subscription from the previous screen
  const hash = location.hash || '#/';
  for (const [re, handler] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      try { await handler(m); }
      catch (err) { console.error(err); app().innerHTML = errorScreen(err); }
      window.scrollTo(0, 0);
      return;
    }
  }
  app().innerHTML = `<div class="screen"><div class="empty"><div class="glyph">🍶</div>Page not found.<br><a class="linkbtn" href="#/">Back to the event</a></div></div>`;
}

function errorScreen(err) {
  return `<div class="screen"><div class="empty"><div class="glyph">🍶</div>
    Something went sideways.<br><span class="faint">${(err && err.message) || err}</span><br>
    <a class="linkbtn" href="#/">Start again</a></div></div>`;
}

/* ---------- Init ---------- */
async function boot() {
  await initStore();
  // Set the opening theme from the active event (guest override wins).
  const ev = await Events.get(session.activeEventId);
  applyTheme(session.theme || (ev && ev.theme) || 'default');
  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
