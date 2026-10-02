// What the picture viewers (the modal dialog in lightbox.js and the floating
// windows in windows.js) have in common: the file name shown as a title, the
// size line, the <img>/<video> element, and stopping a video cleanly.
// Everything is built with properties and textContent, never with innerHTML.

import { ui } from './content.js';

/** "assets/gallery/black-hole-scene.jpg" -> "black-hole-scene.jpg" */
export const fileName = (src) => String(src).split('/').at(-1);

/** "640×640 · JPG" (the size comes from the declared, test-verified dimensions). */
export const metaLine = (g) => `${g.width}×${g.height} · ${fileName(g.src).split('.').at(-1).toUpperCase()}`;

/** Wrap an index into 0..len-1 (so ← from the first goes to the last). */
export const wrapIndex = (i, len) => ((Math.trunc(i) % len) + len) % len;

/** The <img> or <video> for gallery item `g`. */
export function buildMedia(g, lang, { reduceMotion = false } = {}) {
  const c = g[lang];
  if (g.kind === 'video') {
    const v = document.createElement('video');
    v.controls = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.poster = g.poster ?? '';
    v.width = g.width;
    v.height = g.height;
    v.setAttribute('aria-label', c.alt);
    v.src = g.src;
    // Muted autoplay only for people who have not asked for reduced motion.
    if (!reduceMotion) v.play?.().catch(() => { /* the controls are there */ });
    return v;
  }
  const img = document.createElement('img');
  img.src = g.src;
  img.width = g.width;
  img.height = g.height;
  img.alt = c.alt;
  return img;
}

/** Stop any video inside `container` and abandon its download. */
export function stopMedia(container) {
  const v = container.querySelector('video');
  if (!v) return;
  v.pause();
  v.removeAttribute('src');
  v.load();
}

/** The "source ↗" link element for an item, or null. */
export function sourceLink(g, lang) {
  if (!g.source) return null;
  const a = document.createElement('a');
  a.href = g.source;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `${ui[lang].viewer.source} ↗`;
  return a;
}

