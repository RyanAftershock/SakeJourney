/* ============================================================
   Sake Journey — the front door
   Shown at #/ whenever no current event is active. Three jobs:
   get event guests into their night (QR), get returning guests
   to their journey, and tell newcomers why sake belongs on
   every table — not just next to sashimi.
   ============================================================ */

import { Events, session } from '../store.js';
import { SEED_EVENT, TYPE4 } from '../seed.js';
import * as Net from '../net.js';
import { $, esc, svg, quadrantHTML, toast, openSheet, closeSheet } from '../ui.js';
import { applyTheme, go } from '../app.js';

const app = () => document.getElementById('app');

/** Is this event worth landing on directly? Recent (or undated host previews), and not the journal. */
export function isCurrentEvent(ev) {
  if (!ev || ev.personal) return false;
  if (!ev.date) return true;                                   // host drafts/previews have no date yet
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  return ev.date >= yesterday;                                 // ISO dates compare lexically
}

export async function welcome() {
  applyTheme(session.theme || 'default');
  const signedIn = !!Net.guestToken();
  const email = Net.guestEmail();
  // A stale active event (last week's dinner) still deserves a gentle pointer to the journey,
  // but tonight's event gets a proper "continue" card.
  const active = session.activeEventId ? await Events.get(session.activeEventId) : null;
  const tonight = isCurrentEvent(active) ? active : null;

  app().innerHTML = `
    <div class="screen">
      <div class="topbar">
        <a class="brand" href="#/"><span class="brand-logo" role="img" aria-label="Sake Journey"></span></a>
        <span style="width:42px"></span>
      </div>

      <div class="center mt-16">
        <div class="eyebrow">Your tasting companion</div>
        <h1 class="display" style="font-size:2.5rem;margin:10px 0 8px">Every pour,<br>remembered.</h1>
        <p class="muted" style="font-size:1rem;max-width:34ch;margin:0 auto">Sake Journey runs alongside our tasting evenings — the menu, the pairings, and your own notes, kept beautifully.</p>
      </div>

      ${tonight ? `
      <div class="card glow mt-24">
        <div class="eyebrow" style="color:var(--accent)">${svg('cup')} Tonight</div>
        <div class="serif" style="font-size:1.35rem;margin-top:4px">${esc(tonight.title)}</div>
        ${tonight.venue ? `<div class="faint" style="font-size:.85rem">${esc(tonight.venue)}</div>` : ''}
        <button class="btn primary block mt-16" id="wContinue">Open tonight’s menu</button>
      </div>` : `
      <div class="card mt-24">
        <div class="eyebrow" style="color:var(--accent)">${svg('camera')} At a tasting tonight?</div>
        <p class="muted" style="font-size:.92rem;margin:6px 0 12px">There’s a QR code on your table — it opens tonight’s menu right here.</p>
        <button class="btn primary block" id="wScan">Scan the table code</button>
        <p class="faint center" style="font-size:.78rem;margin:10px 0 0">or just point your phone’s camera at it</p>
      </div>`}

      <div class="card mt-16">
        ${signedIn
          ? `<div class="eyebrow" style="color:var(--ink-3)">${svg('sparkle')} Welcome back</div>
             <p class="muted" style="font-size:.92rem;margin:6px 0 12px">Signed in as <b>${esc(email)}</b>. Every pour you’ve tasted with us is in your journey.</p>`
          : `<div class="eyebrow" style="color:var(--ink-3)">${svg('sparkle')} Been before?</div>
             <p class="muted" style="font-size:.92rem;margin:6px 0 12px">Sign in and your whole journey — every pour, photo and note — follows you to any device.</p>`}
        <div class="row gap-8">
          <button class="btn subtle block" id="wJourney" style="flex:1">Your journey</button>
          ${signedIn ? '' : `<button class="btn ghost block" id="wSignIn" style="flex:1">Sign in</button>`}
        </div>
      </div>

      <div class="divider"><span class="k">酒</span></div>

      <div class="center">
        <h2 class="serif" style="font-size:1.5rem">Sake belongs on every table</h2>
      </div>
      <p class="muted" style="font-size:.95rem;line-height:1.65;margin-top:10px">
        Brewed from rice, yet closer to wine in the glass — and carrying more natural <b>umami</b> than
        any other drink. That’s why sake doesn’t fight food; it completes it. Not just sashimi:
        it mirrors the ocean-sweetness of <b>oysters</b>, cuts the cream of <b>burrata</b>, stands
        shoulder-to-shoulder with <b>wagyu</b>, and turns <b>aged cheese</b> into dessert.
      </p>

      <div class="card mt-16">
        <div class="eyebrow" style="color:var(--ink-3)">Four families of flavour</div>
        <div class="row gap-16 mt-8" style="align-items:flex-start">
          ${quadrantHTML('kunshu')}
          <div style="flex:1;min-width:0;font-size:.83rem;line-height:1.55" class="muted">
            ${['kunshu', 'soshu', 'junshu', 'jukushu'].map((k) => `<div style="margin-bottom:6px"><b class="serif" style="font-size:.95rem">${TYPE4[k].name}</b> — ${esc(TYPE4[k].blurb)}</div>`).join('')}
          </div>
        </div>
        <p class="faint" style="font-size:.8rem;margin-top:10px">Every pour you taste with us is placed on this map — and over time, so is your own palate.</p>
      </div>

      <div class="card mt-16">
        <div class="eyebrow" style="color:var(--ink-3)">How an evening works</div>
        <div style="font-size:.92rem;line-height:1.6;margin-top:8px" class="muted">
          <div class="row gap-12" style="align-items:baseline"><b class="serif" style="font-size:1.1rem;color:var(--accent-2)">1</b><span>Scan the code on your table — tonight’s menu opens here.</span></div>
          <div class="row gap-12 mt-8" style="align-items:baseline"><b class="serif" style="font-size:1.1rem;color:var(--accent-2)">2</b><span>Taste course by course — rate each pour, snap the bottle, jot what you loved.</span></div>
          <div class="row gap-12 mt-8" style="align-items:baseline"><b class="serif" style="font-size:1.1rem;color:var(--accent-2)">3</b><span>Keep the whole night — your recap, your take-home bottle list, and a palate map that grows with you.</span></div>
        </div>
      </div>

      <p class="center mt-24" style="font-size:.9rem">
        <a class="linkbtn" href="https://www.sake-journey.com/" target="_blank" rel="noopener">Tickets &amp; upcoming evenings → sake-journey.com</a>
      </p>
      <div class="center" style="margin-top:4px">
        <button class="linkbtn" id="wPeek" style="font-size:.82rem">Curious? Peek at a sample tasting night →</button>
      </div>
      <div class="center mt-24" style="padding-bottom:8px">
        <button class="linkbtn" id="wHost" style="font-size:.75rem;color:var(--ink-3)">Host studio</button>
      </div>
    </div>`;

  if ($('#wContinue')) $('#wContinue').onclick = () => go('#/');   // active event set → root renders the menu
  if ($('#wScan')) $('#wScan').onclick = scanEventCode;
  $('#wJourney').onclick = () => go('#/history');
  if ($('#wSignIn')) $('#wSignIn').onclick = () => go('#/login');
  $('#wPeek').onclick = () => { session.activeEventId = SEED_EVENT.id; go('#/'); };
  $('#wHost').onclick = () => go('#/host');
}

/* ---------- in-app QR scan (progressive enhancement) ----------
   BarcodeDetector + the rear camera where available (Android Chrome — most guests); everyone else
   gets a friendly pointer to their camera app, which opens table QRs natively anyway. */
function qrFallbackSheet(reason) {
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.5rem">Use your camera app</h2>
    <p class="muted" style="font-size:.95rem;margin:8px 0 4px">${esc(reason)}</p>
    <p class="muted" style="font-size:.95rem">Open your phone’s <b>camera</b>, point it at the QR code on your table, and tap the link that pops up — tonight’s menu will open here.</p>
    <button class="btn primary block mt-16" id="qrOk">Got it</button>
  `, { label: 'Scan the table code' });
  body.querySelector('#qrOk').onclick = () => closeSheet();
}

/** Accept only same-app event links from a scanned code — never navigate to arbitrary QR content. */
export function eventHashFrom(text) {
  const m = /#\/e\/([A-Za-z0-9._-]+)/.exec(String(text || ''));
  return m ? `#/e/${m[1]}` : null;
}

async function scanEventCode() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return qrFallbackSheet('This browser can’t scan from inside the app.');
  }
  let detector;
  try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
  catch { return qrFallbackSheet('This browser can’t scan from inside the app.'); }

  let stream = null, timer = 0;
  const stop = () => { clearInterval(timer); if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; } };
  const body = openSheet(`
    <h2 class="serif" style="font-size:1.5rem">Scan the table code</h2>
    <p class="muted" style="font-size:.9rem;margin:6px 0 12px">Hold the QR code inside the frame.</p>
    <video id="qrVideo" playsinline muted style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:16px;background:#000"></video>
    <button class="linkbtn" id="qrCancel" style="display:block;margin:12px auto 0">Cancel</button>
  `, { label: 'Scan the table code', onClose: stop });
  body.querySelector('#qrCancel').onclick = () => closeSheet();

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    closeSheet();
    return qrFallbackSheet('We couldn’t open the camera (it may be blocked for this site).');
  }
  const video = body.querySelector('#qrVideo');
  if (!video) { stop(); return; }   // sheet was closed while we waited for permission
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay quirks — detection loop still tries */ }

  timer = setInterval(async () => {
    if (!video.isConnected) { stop(); return; }
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const hash = eventHashFrom(c.rawValue);
        if (hash) {
          stop(); closeSheet();
          toast('Found your event ✨');
          go(hash);
          return;
        }
      }
    } catch { /* frame not ready yet */ }
  }, 350);
}
