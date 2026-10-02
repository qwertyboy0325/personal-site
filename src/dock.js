// A macOS-style dock for the seven main commands, on wide screens with a mouse.
// It shows what you are looking at (a dot under the current section) and the icons
// swell slightly towards the pointer. Narrow and touch screens keep the plain
// quick-command buttons instead. The maths is pure so it can be tested in Node.

import { NAV } from './engine.js';

export const DOCK_RADIUS = 120; // px: how far from the pointer an icon still reacts
export const DOCK_MAX = 1.3;    // scale of the icon right under the pointer

/** Scale for an icon whose centre is `distance` px from the pointer: DOCK_MAX under it, easing to 1 at the radius. */
export function scaleFor(distance, { radius = DOCK_RADIUS, max = DOCK_MAX } = {}) {
  const d = distance == null ? NaN : Math.abs(Number(distance));
  if (!Number.isFinite(d) || d >= radius) return 1;
  return 1 + (max - 1) * (0.5 + 0.5 * Math.cos((d / radius) * Math.PI));
}

/** Which dock item a command line belongs to: `project 2` -> projects, `view 1` -> gallery, `about` -> about, otherwise null. */
export function dockKey(line) {
  const word = String(line ?? '').trim().toLowerCase().split(/\s+/)[0];
  const key = { project: 'projects', work: 'works', view: 'gallery' }[word] ?? word;
  return NAV.has(key) ? key : null;
}

export function createDock({ root, reduceMotion = false }) {
  const items = [...root.querySelectorAll('[data-cmd]')];

  const reset = () => items.forEach((el) => el.style.setProperty('--s', '1'));
  if (!reduceMotion) {
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      for (const el of items) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--s', scaleFor(e.clientX - (r.left + r.width / 2)).toFixed(3));
      }
    });
    root.addEventListener('pointerleave', reset);
  }

  return {
    root,
    /** Mark the item for the command that just ran (other commands, like `theme`, leave it alone). */
    setActive(line) {
      const key = dockKey(line);
      if (!key) return;
      for (const el of items) {
        if (el.dataset.cmd === key) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      }
    },
  };
}
