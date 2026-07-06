/* ============================================================
   Sake Journey — UI toolkit
   Tiny render helpers, inline SVG icons, and the reusable
   components (hearts, quadrant, temp, sheet, toast, photo).
   Views render HTML strings; behaviour is wired after mount.
   ============================================================ */

import { TEMPS, TYPE4 } from './seed.js';

/* ---------- DOM ---------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build a detached element from an HTML string. */
export function node(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Icons ---------- */
export const ICONS = {
  camera:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  heart:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.9-10-9.2C.3 8.6 1.7 5 5 5c2 0 3.2 1.1 4 2.3C9.8 6.1 11 5 13 5c3.3 0 4.7 3.6 3 6.8C19.5 16.1 12 21 12 21z"/></svg>',
  heartline:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-6.7-4.4-9-8.2C1.4 9 2.6 6 5.5 6c1.9 0 3 1.1 3.7 2.1C10 7.1 11.1 6 13 6c2.9 0 4.1 3 2.5 5.8C18.7 15.6 12 20 12 20z"/></svg>',
  plus:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chev:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  bottle:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M10 2v3.5a3 3 0 0 1-.6 1.8L8 9M14 2v3.5a3 3 0 0 0 .6 1.8L16 9M8 9a3 3 0 0 0-.6 1.8V20a2 2 0 0 0 2 2h5.2a2 2 0 0 0 2-2V10.8A3 3 0 0 0 16 9z"/></svg>',
  share:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  edit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.4l-5.2 1.8L12 17l-1.8-5.8L5 9.4l5.2-1.8z"/></svg>',
  cup:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14l-1.4 6.5A4 4 0 0 1 13.7 19h-3.4a4 4 0 0 1-3.9-3.5z"/><ellipse cx="12" cy="9" rx="7" ry="1.8"/></svg>',
  users:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  chart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg>',
  qr:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M20 14v.01M14 20v.01M20 20v.01M17 17h.01M20 17h.01M17 20h3"/></svg>',
  book:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/></svg>',
  calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  pin:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  link:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};
export function svg(name, cls = '') {
  return `<span class="ico ${cls}" style="display:inline-flex">${ICONS[name] || ''}</span>`;
}

/* ---------- Grade labels ---------- */
const GRADE = {
  junmai: 'Junmai', junmai_ginjo: 'Junmai Ginjo', junmai_daiginjo: 'Junmai Daiginjo',
  ginjo: 'Ginjo', daiginjo: 'Daiginjo', honjozo: 'Honjozo',
  nigori: 'Nigori', sparkling: 'Sparkling', koshu: 'Koshu (Aged)',
};
export const gradeLabel = (g) => GRADE[g] || g || 'Sake';

/* ---------- Four-type quadrant ---------- */
export function quadrantHTML(type4, size = 0) {
  const t = TYPE4[type4] || TYPE4.junshu;
  const mini = size > 0 && size < 90;   // too small for axis labels to be legible
  return `
    <div class="quad${mini ? ' mini' : ''}" role="img" aria-label="Flavour type: ${t.name}, ${t.tag}"${size ? ` style="--s:${+size}px"` : ''}>
      <div class="axis v"></div><div class="axis h"></div>
      <span class="lbl t">Aromatic</span><span class="lbl b">Quiet</span>
      <span class="lbl l">Light</span><span class="lbl r">Rich</span>
      <span class="dot" style="left:${t.x}%;top:${t.y}%"></span>
    </div>`;
}
export function quadLegend(type4) {
  const t = TYPE4[type4] || TYPE4.junshu;
  return `<div class="quad-legend"><b>${t.name}</b><br>${t.blurb}</div>`;
}

/* ---------- Serving temperature ---------- */
export function tempHTML(tempKey) {
  const t = TEMPS[tempKey] || TEMPS.joon;
  return `<span class="temp"><span class="bulb" style="background:${t.color}"></span>Serve ${esc(t.label)} · <span class="faint">${esc(t.hint)}</span></span>`;
}

/* ---------- Hearts rating ---------- */
const RATE_WORDS = ['', 'Not for me', 'It’s fine', 'Rather nice', 'Really lovely', 'Unforgettable'];
export function heartsHTML(value = 0, size = '') {
  let h = `<div class="hearts ${size}" role="radiogroup" aria-label="Rating out of five">`;
  for (let i = 1; i <= 5; i++) {
    h += `<button type="button" role="radio" aria-checked="${i === value ? 'true' : 'false'}" data-v="${i}" class="${i <= value ? 'on' : ''}" aria-label="${i} of 5 — ${RATE_WORDS[i]}">${ICONS.heart}</button>`;
  }
  return h + '</div>';
}
export function wireHearts(container, initial, onChange) {
  let val = initial || 0;
  const wordEl = container.parentElement.querySelector('.rate-word');
  const paint = () => {
    $$('.hearts button', container).forEach((b) => {
      const v = +b.dataset.v;
      b.classList.toggle('on', v <= val);
      b.setAttribute('aria-checked', v === val ? 'true' : 'false');
    });
    if (wordEl) wordEl.textContent = RATE_WORDS[val] || '';
  };
  container.querySelector('.hearts').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    val = +btn.dataset.v; paint(); onChange(val);
  });
  paint();
}
export function miniHearts(value = 0) {
  let h = '<span class="mini-hearts">';
  for (let i = 1; i <= 5; i++) h += `<span class="${i <= value ? '' : 'off'}">${ICONS.heart}</span>`;
  return h + '</span>';
}

/* ---------- Toast ---------- */
export function toast(msg, ms) {
  const root = $('#toast-root');
  const t = node(`<div class="toast">${esc(msg)}</div>`);
  root.appendChild(t);
  // Long enough to read a sentence: scale with length when no explicit duration is given.
  const dur = ms || Math.max(2400, Math.min(6000, String(msg).length * 55));
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, dur);
}

/* ---------- Bottom sheet (modal dialog) ---------- */
const _focusable = (root) => $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root);
export function openSheet(innerHTML, { onClose, label = 'Dialog' } = {}) {
  closeSheet();
  const back = node(`<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><div class="grabber"></div><div class="sheet-body">${innerHTML}</div></div></div>`);
  back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
  $('#sheet-root').appendChild(back);
  document.body.style.overflow = 'hidden';
  back._onClose = onClose;
  // Move focus into the dialog (announces it to screen readers) without popping the keyboard;
  // trap Tab within it and close on Escape.
  const dialog = back.querySelector('.sheet');
  setTimeout(() => dialog.focus(), 0);
  back._keydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = _focusable(back); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', back._keydown);
  return back.querySelector('.sheet-body');
}
export function closeSheet() {
  const root = $('#sheet-root');
  const back = root.firstElementChild;
  if (back) {
    if (back._keydown) document.removeEventListener('keydown', back._keydown);
    if (back._onClose) back._onClose();
    back.remove();
  }
  document.body.style.overflow = '';
}

/* ---------- Photo capture (with downscale/compress) ----------
   Every failure is TOLD to the user — a camera photo that silently vanishes reads as a broken app.
   Real-world failure modes handled: HEIF/HEIC photos Chrome can't decode (Samsung "high efficiency"
   mode), the Android camera intent returning a zero-byte file, and slow decodes of huge photos. */
let _preferChooser = false;   // after a camera photo fails to read, offer the gallery too
export function pickPhoto() {
  return new Promise((resolve) => {
    const input = node(`<input type="file" accept="image/*" ${_preferChooser ? '' : 'capture="environment"'} class="hidden">`);
    document.body.appendChild(input);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return finish(null);
      if (!file.size) {
        _preferChooser = true;
        toast('That photo came through empty — take it again, or pick it from your gallery.', 4500);
        return finish(null);
      }
      // Big camera photos can take a couple of seconds to decode — say so, or it feels frozen.
      if (file.size > 2_500_000) toast('Reading your photo…', 1600);
      try { finish(await downscale(file)); }
      catch {
        _preferChooser = true;
        toast('Couldn’t read that photo — some cameras save a format the browser can’t open. Tap again to pick from your gallery, or set your camera to “most compatible” (JPEG).', 6000);
        finish(null);
      }
    }, { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.click();
  });
}
async function downscale(file, max = 1400, quality = 0.82) {
  // createImageBitmap decodes more formats (and off the main thread); fall back to <img>.
  // imageOrientation from-image is explicit so portrait camera shots keep their EXIF rotation —
  // browsers that reject the option (old Firefox) throw and take the <img> path, which honours EXIF.
  let src = null, w = 0, h = 0;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; } catch { /* try <img> */ }
  if (!src) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  if (!w || !h) throw new Error('empty image');
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  const out = c.toDataURL('image/jpeg', quality);
  if (out.length < 100) throw new Error('encode failed');   // a blank canvas encodes to almost nothing
  return out;
}

/* ---------- misc format ---------- */
export function fmtDate(iso) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return iso; }
}
export function ordinal(n) {
  return ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'][n] || `#${n}`;
}
