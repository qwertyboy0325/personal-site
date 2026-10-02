// Floating picture windows for wide screens: draggable, several at once, click to
// bring to the front. Narrow and touch screens use the modal dialog in
// lightbox.js instead (dragging windows on a phone is not a good experience).
//
// Dragging is an enhancement, never a requirement: windows open in a sensible
// place, Alt+arrow keys move the focused window, Esc closes it, and ← / → switch
// pictures. Everything is inserted as text or properties (no innerHTML with content).

import { gallery, ui } from './content.js';
import { buildMedia, stopMedia, sourceLink, fileName, metaLine, shotLine, wrapIndex } from './viewer-content.js';

export const MAX_WINDOWS = 6;
export const Z_BASE = 30; // above the page, below the page wipe (60), the reticle (70) and the toast (90)
export const MOVE_STEP = 24;
const CASCADE = 30;
const MARGIN = 8;

/** Keep a w x h window fully inside a vw x vh viewport (windows larger than the viewport pin to the margin). */
export function clampToViewport(x, y, w, h, vw, vh, margin = MARGIN) {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return { x: Math.min(maxX, Math.max(margin, x)), y: Math.min(maxY, Math.max(margin, y)) };
}

/** Where the n-th window opens: centred, then stepping down and right (wrapping so it never walks off screen). */
export function cascadePosition(n, w, h, vw, vh) {
  const step = (n % MAX_WINDOWS) * CASCADE;
  return clampToViewport((vw - w) / 2 - 100 + step, (vh - h) / 2 - 40 + step, w, h, vw, vh);
}

/** Z-index for each window, from back to front, given their order. */
export const stackZ = (order) => order.map((_, i) => Z_BASE + i);

export function createWindows({ getLang, reduceMotion = false }) {
  const root = document.createElement('div');
  root.id = 'windows';
  document.body.append(root);

  /** Open windows, back to front. */
  const stack = [];
  let serial = 0;

  const front = () => stack.at(-1);

  function applyStack() {
    stack.forEach((w, i) => {
      w.el.style.zIndex = String(Z_BASE + i);
      w.el.classList.toggle('is-front', i === stack.length - 1);
    });
  }

  function bringToFront(w) {
    const i = stack.indexOf(w);
    if (i === -1) return;
    if (i !== stack.length - 1) { stack.splice(i, 1); stack.push(w); applyStack(); }
  }

  function render(w) {
    const lang = getLang();
    const t = ui[lang].viewer;
    const g = gallery[w.index];
    const c = g[lang];
    w.title.textContent = fileName(g.src);
    w.meta.textContent = metaLine(g);
    w.cap.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = c.title;
    const span = document.createElement('span');
    span.textContent = c.caption;
    w.cap.append(strong, ' ', span);
    const shot = shotLine(g);
    if (shot) {
      const exif = document.createElement('small');
      exif.className = 'exif';
      exif.textContent = shot;
      w.cap.append(exif);
    }
    w.close.setAttribute('aria-label', `${t.close}: ${fileName(g.src)}`);
    w.prev.setAttribute('aria-label', t.prev);
    w.next.setAttribute('aria-label', t.next);
    w.count.textContent = t.counter(w.index + 1, gallery.length);
    w.el.dataset.index = String(w.index);
    stopMedia(w.stage);
    w.stage.replaceChildren(buildMedia(g, lang, { reduceMotion }));
    w.links.replaceChildren();
    const link = sourceLink(g, lang);
    if (link) w.links.append(link);
  }

  function place(w, x, y) {
    const r = w.el.getBoundingClientRect();
    const p = clampToViewport(x, y, r.width, r.height, innerWidth, innerHeight);
    w.el.style.left = `${Math.round(p.x)}px`;
    w.el.style.top = `${Math.round(p.y)}px`;
  }

  function close(w) {
    const i = stack.indexOf(w);
    if (i === -1) return;
    stopMedia(w.stage);
    stack.splice(i, 1);
    w.el.remove();
    applyStack();
    const target = w.opener?.isConnected ? w.opener : front()?.el ?? document.getElementById('cmd');
    target?.focus?.({ preventScroll: true });
  }

  function go(w, delta) {
    w.index = wrapIndex(w.index + delta, gallery.length);
    render(w);
  }

  function build(index, opener) {
    const id = `win-${++serial}`;
    const el = document.createElement('section');
    el.className = 'win';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', `${id}-title`);
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="wbar">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="wtitle" id="${id}-title"></span>
        <span class="wmeta"></span>
        <button type="button" class="wclose">✕</button>
      </div>
      <div class="wstage"></div>
      <p class="wcap"></p>
      <div class="wnav"><button type="button" class="wprev">←</button><span class="wlinks"></span><span class="wcount"></span><button type="button" class="wnext">→</button></div>`;
    const q = (s) => el.querySelector(s);
    const w = { el, index, opener, bar: q('.wbar'), title: q('.wtitle'), meta: q('.wmeta'), close: q('.wclose'), stage: q('.wstage'), cap: q('.wcap'), prev: q('.wprev'), next: q('.wnext'), links: q('.wlinks'), count: q('.wcount') };

    w.close.addEventListener('click', () => close(w));
    w.prev.addEventListener('click', () => go(w, -1));
    w.next.addEventListener('click', () => go(w, 1));
    el.addEventListener('pointerdown', () => bringToFront(w), true);
    el.addEventListener('focusin', () => bringToFront(w));

    el.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(w); return; }
      if (e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const d = { ArrowLeft: [-MOVE_STEP, 0], ArrowRight: [MOVE_STEP, 0], ArrowUp: [0, -MOVE_STEP], ArrowDown: [0, MOVE_STEP] }[e.key];
        place(w, r.left + d[0], r.top + d[1]);
        return;
      }
      // ← / → switch pictures, but leave them alone inside the video's own controls.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('video')) {
        e.preventDefault();
        go(w, e.key === 'ArrowLeft' ? -1 : 1);
      }
    });

    // Drag by the title bar (mouse and pen; a button inside the bar is not a handle).
    let drag = null;
    w.bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      w.bar.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    w.bar.addEventListener('pointermove', (e) => { if (drag) place(w, e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = (e) => {
      if (!drag) return;
      drag = null;
      el.classList.remove('is-dragging');
      if (w.bar.hasPointerCapture?.(e.pointerId)) w.bar.releasePointerCapture(e.pointerId);
    };
    w.bar.addEventListener('pointerup', end);
    w.bar.addEventListener('pointercancel', end);
    return w;
  }

  return {
    /** Open picture `i` (0-based). Opening one that is already open brings that window forward instead. */
    open(i, from) {
      const index = wrapIndex(Number.isInteger(i) ? i : 0, gallery.length);
      const existing = stack.find((w) => w.index === index);
      if (existing) { bringToFront(existing); existing.el.focus({ preventScroll: true }); return existing.el; }
      if (stack.length >= MAX_WINDOWS) close(stack[0]); // the oldest makes room
      const w = build(index, from ?? document.activeElement);
      stack.push(w);
      root.append(w.el);
      render(w);
      applyStack();
      const r = w.el.getBoundingClientRect();
      const pos = cascadePosition(stack.length - 1, r.width, r.height, innerWidth, innerHeight);
      w.el.style.left = `${Math.round(pos.x)}px`;
      w.el.style.top = `${Math.round(pos.y)}px`;
      w.el.focus({ preventScroll: true });
      return w.el;
    },
    close() { if (front()) close(front()); },
    closeAll() { while (stack.length) close(stack.at(-1)); },
    refresh() { stack.forEach(render); }, // e.g. the language changed
    get count() { return stack.length; },
    get indexes() { return stack.map((w) => w.index); },
  };
}
