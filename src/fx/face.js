// A procedurally drawn ASCII face: a lit ellipsoid head with eyes that follow
// the pointer, blinking, a mouth that opens while the visitor types, and a
// glyph-dissolve intro. No photo is involved. `renderFace` is pure (same input,
// same string), so it is easy to test; `startFace` drives it in the browser.

import { GLYPHS, hash } from './rain.js';

export const FACE = { w: 34, h: 22 };
const RAMP = ' .:-=+*#%'; // '@' is deliberately absent: it is reserved for the pupils
const LIGHT = (() => { const v = [-0.45, -0.55, 0.7]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} s
 * @param {number} [s.reveal=1]  0..1, how much of the face has resolved from random glyphs
 * @param {{x:number,y:number}} [s.look]  -1..1 gaze direction
 * @param {number} [s.blink=0]   0 open .. 1 closed
 * @param {number} [s.talk=0]    0..1 mouth opening
 * @param {number} [s.smile=0.6] 0..1
 * @param {boolean} [s.invert=false]  invert the shading ramp (for light backgrounds)
 * @param {number} [s.frame=0]   seeds the flicker of unresolved cells
 */
export function renderFace({ reveal = 1, look = { x: 0, y: 0 }, blink = 0, talk = 0, smile = 0.6, invert = false, frame = 0 } = {}) {
  const { w, h } = FACE;
  const lines = [];
  for (let r = 0; r < h; r++) {
    let line = '';
    for (let c = 0; c < w; c++) {
      const x = ((c + 0.5) / w) * 2 - 1;
      const y = ((r + 0.5) / h) * 2 - 1;
      const rr = x * x + y * y;
      if (rr > 1) { line += ' '; continue; }
      // Cells resolve from the centre outward, in a noisy order.
      if (hash(c, r) * 0.6 + rr * 0.4 > reveal * 1.02) {
        line += GLYPHS[Math.floor(hash(c + frame * 31, r * 7, 3) * GLYPHS.length)];
        continue;
      }
      line += faceChar(x, y, rr, { look, blink, talk, smile, invert });
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

function faceChar(x, y, rr, { look, blink, talk, smile, invert }) {
  // Eyes
  for (const sx of [-1, 1]) {
    const ex = sx * 0.38;
    const ey = -0.16;
    const e = ((x - ex) / 0.2) ** 2 + ((y - ey) / 0.1) ** 2;
    if (e < 1) {
      if (blink > 0.6) return '-';
      const pd = ((x - (ex + look.x * 0.09)) / 0.075) ** 2 + ((y - (ey + look.y * 0.04)) / 0.075) ** 2;
      return pd < 1 ? '@' : ' ';
    }
    if (e < 1.7) return y < ey ? '=' : '.';
    if (Math.abs(x - ex) < 0.2 && Math.abs(y - (ey - 0.2)) < 0.035) return '~'; // brow
  }
  // Nose
  if (Math.abs(x) < 0.04 && y > -0.05 && y < 0.22) return ':';
  if (y > 0.22 && y < 0.3 && Math.abs(Math.abs(x) - 0.1) < 0.04) return 'o';
  // Mouth: a curve that lifts at the corners with `smile`, and opens with `talk`
  if (Math.abs(x) < 0.34) {
    const my = 0.58 - 0.13 * smile * (x / 0.34) ** 2;
    const half = 0.04 + talk * 0.12;
    const dy = Math.abs(y - my);
    if (dy < half) return talk > 0.3 && dy < half * 0.55 && Math.abs(x) < 0.2 ? ' ' : '=';
  }
  // Skin: a Lambert-lit ellipsoid mapped onto the ramp
  const z = Math.sqrt(Math.max(0, 1 - rr));
  const b = clamp((x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]) * 0.85 + 0.2);
  const i = Math.round(b * (RAMP.length - 1));
  return RAMP[invert ? RAMP.length - 1 - i : i];
}

/**
 * Animate a face into <pre>/<element> `el`. Returns { stop, nudge }.
 * getPointer() -> {x,y}|null (client coords); getTheme() -> 'dark'|'light'|'amber'.
 */
export function startFace(el, { getPointer = () => null, getTheme = () => 'dark', reduceMotion = false } = {}) {
  const t0 = performance.now();
  let raf = 0;
  let stopped = false;
  let lastDraw = 0;
  let blinkAt = t0 + 2200;
  let blinkStart = -1;
  let talk = 0;
  const look = { x: 0, y: 0 };

  const draw = (now, reveal) => {
    el.textContent = renderFace({
      reveal,
      look,
      blink: blinkStart < 0 ? 0 : Math.sin(clamp((now - blinkStart) / 180) * Math.PI),
      talk,
      smile: 0.55 + 0.15 * Math.sin((now - t0) / 2200),
      invert: getTheme() === 'light',
      frame: Math.floor(now / 90),
    });
  };

  if (reduceMotion) {
    draw(t0, 1);
    return { stop() {}, nudge() {} };
  }

  const frame = (now) => {
    if (stopped) return;
    if (!el.isConnected) { stop(); return; }
    raf = requestAnimationFrame(frame);
    if (now - lastDraw < 42) return; // ~24fps is plenty for ASCII
    lastDraw = now;

    const p = getPointer();
    let tx;
    let ty;
    if (p) {
      const r = el.getBoundingClientRect();
      tx = clamp((p.x - (r.left + r.width / 2)) / (innerWidth / 2), -1, 1);
      ty = clamp((p.y - (r.top + r.height / 2)) / (innerHeight / 2), -1, 1);
    } else {
      tx = Math.sin((now - t0) / 1900) * 0.6;
      ty = Math.sin((now - t0) / 2700) * 0.3;
    }
    look.x += (tx - look.x) * 0.18;
    look.y += (ty - look.y) * 0.18;

    if (blinkStart < 0 && now > blinkAt) blinkStart = now;
    if (blinkStart >= 0 && now - blinkStart > 180) { blinkStart = -1; blinkAt = now + 2500 + Math.random() * 3500; }
    talk *= 0.9;

    draw(now, clamp((now - t0) / 1800));
  };
  raf = requestAnimationFrame(frame);

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
  }
  return { stop, nudge() { talk = Math.min(1, talk + 0.35); } };
}
