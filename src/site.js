// Brings the rendered home page (src/page.js) to life. Every picture develops out of letters the first time it is seen
// (the hero in resolution steps, photos dissolving from the centre, the black hole under a scanning band); exposure
// readouts tick to the real values while that happens; headings and names decode out of the same character ramp; the
// hero becomes a flashlight under the pointer; the face in "about" watches you; the mirror at the end turns your camera
// into letters on a light box and prints frames you can copy.
//
// Nothing here is needed to read the page: without JavaScript, or with reduced motion, the pictures and text are simply
// there. createSite() returns destroy(), so the page can be rendered again (another language) without leaks.

import { RAMP, easeOut, decodeFrame, developStep, tickExposure, parseExif, rampIndex, kelvinOf, kelvinForHour, sunColor, clock } from './light.js';
import { startFace } from './fx/face.js';
import { createMirror, stopMirror } from './fx/mirror.js';
import { ui } from './content.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Draw `img` covering a dw x dh box, as object-fit: cover does. */
function cover(g, img, dw, dh) {
  const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(dw / iw, dh / ih), sw = dw / s, sh = dh / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, dw, dh);
}

/** A canvas over a picture that can draw it as coloured letters at any resolution, or as itself. */
class Plate {
  constructor(pic, img, night) {
    this.pic = pic; this.img = img; this.night = night;
    this.c = document.createElement('canvas');
    this.c.className = 'dev-canvas';
    this.c.setAttribute('aria-hidden', 'true');
    pic.append(this.c);
    this.ctx = this.c.getContext('2d');
    this.grids = new Map();
    this.resize();
  }
  resize() {
    const r = this.pic.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1); this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.c.width = Math.round(this.W * this.dpr); this.c.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.grids.clear(); this.photo = null;
  }
  photoCanvas() {
    if (this.photo) return this.photo;
    const o = document.createElement('canvas'); o.width = this.c.width; o.height = this.c.height;
    cover(o.getContext('2d'), this.img, o.width, o.height);
    return (this.photo = o);
  }
  grid(cols) {
    if (this.grids.has(cols)) return this.grids.get(cols);
    const cw = this.W / cols, rows = Math.max(1, Math.round(this.H / (cw / 0.6))), ch = this.H / rows;
    const o = document.createElement('canvas'); o.width = cols; o.height = rows;
    const g = o.getContext('2d', { willReadFrequently: true });
    cover(g, this.img, cols, rows);
    const grid = { cols, rows, cw, ch, fs: Math.min(ch, cw / 0.6) * 0.98, data: g.getImageData(0, 0, cols, rows).data };
    this.grids.set(cols, grid);
    return grid;
  }
  clear(ctx = this.ctx) { ctx.fillStyle = this.night; ctx.fillRect(0, 0, this.W, this.H); }
  /** Letters, denser where brighter, coloured by the picture. `cell(x, y, grid)` may return a gain, or -1 to skip the cell. */
  letters(cols, { gain = 1, cell = null, ctx = this.ctx } = {}) {
    const g = this.grid(cols);
    ctx.font = `600 ${g.fs}px ${MONO}`;
    ctx.textBaseline = 'top';
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        const k = cell ? cell(x, y, g) : 1;
        if (k < 0) continue;
        const i = (y * g.cols + x) * 4, R = g.data[i], G = g.data[i + 1], B = g.data[i + 2];
        const ci = rampIndex((0.2126 * R + 0.7152 * G + 0.0722 * B) / 255);
        if (!ci) continue;
        const m = gain * k;
        ctx.fillStyle = `rgb(${Math.min(255, R * m) | 0},${Math.min(255, G * m) | 0},${Math.min(255, B * m) | 0})`;
        ctx.fillText(RAMP[ci], x * g.cw, y * g.ch);
      }
    }
    return g;
  }
  image(alpha = 1) {
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.photoCanvas(), 0, 0, this.W, this.H);
    this.ctx.globalAlpha = 1;
  }
  remove() { this.c.remove(); this.pic.classList.remove('is-dev'); }
}

/**
 * @param {HTMLElement} root  the element holding the rendered page
 * @param {object} o
 * @param {'en'|'zh'} o.lang
 * @param {boolean} o.reduceMotion
 * @param {boolean} o.finePointer
 * @param {boolean} [o.quiet]  skip the entrance effects (the page was only re-rendered, e.g. another language)
 * @param {(line: string) => void} o.onCommand  run a terminal command
 * @param {(index: number, from: Element) => void} o.onOpenPicture  open the viewer at gallery index (0-based)
 * @param {(id: string) => void} o.onSection  the section now on screen changed
 * @param {(message: string) => void} o.toast
 */
export function createSite(root, { lang, reduceMotion, finePointer, quiet = false, onCommand, onOpenPicture, onSection, toast }) {
  const t = ui[lang] ?? ui.en;
  const night = getComputedStyle(document.documentElement).getPropertyValue('--night').trim() || '#0e0d0b';
  const intro = !reduceMotion && !quiet;
  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const cleanups = [];
  const observers = [];
  let pointer = null;
  on(window, 'pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

  /** Run fn(t) over `ms`; reduced motion jumps to the end. Returns a cancel function. */
  function play(ms, frame) {
    if (reduceMotion) { frame(1); return () => {}; }
    let raf = 0;
    let t0;
    const step = (now) => { t0 ??= now; const k = clamp((now - t0) / ms, 0, 1); frame(k); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    const cancel = () => cancelAnimationFrame(raf);
    cleanups.push(cancel);
    return cancel;
  }
  /** fn() the first time `el` is at least `threshold` visible. */
  function whenSeen(el, fn, threshold = 0.3) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold });
    io.observe(el);
    observers.push(io);
  }
  const decoding = new Set(); // elements mid-decode, so destroy() can put their text back
  cleanups.push(() => decoding.forEach((el) => { cancelAnimationFrame(el._decode); el.textContent = el.dataset.text; }));
  function decode(el, ms = 900) {
    const final = (el.dataset.text ??= el.textContent);
    if (reduceMotion) { el.textContent = final; return; }
    cancelAnimationFrame(el._decode);
    decoding.add(el);
    let t0;
    const step = (now) => {
      t0 ??= now;
      const k = (now - t0) / ms;
      el.textContent = k >= 1 ? final : decodeFrame(final, k);
      if (k < 1) el._decode = requestAnimationFrame(step);
      else decoding.delete(el);
    };
    el._decode = requestAnimationFrame(step);
  }

  // ---- reveal the parts that need JavaScript ---------------------------------------------------
  for (const el of root.querySelectorAll('[data-term], [data-copy], [data-shutter], #btn-theme, #btn-lang')) el.hidden = false;
  if (finePointer) root.querySelector('[data-hint]')?.removeAttribute('hidden');

  // ---- clicks: pictures open the viewer, some links run a terminal command ------------------------
  on(root, 'click', (e) => {
    const pic = e.target.closest('a[data-open]');
    if (pic) { e.preventDefault(); onOpenPicture(Number(pic.dataset.open) - 1, pic); return; }
    const term = e.target.closest('[data-term]');
    if (term) { e.preventDefault(); onCommand(term.dataset.term); }
  });

  // ---- headings, names, dividers and the mark decode out of the ramp --------------------------------
  if (intro) {
    for (const h of root.querySelectorAll('[data-decode]')) whenSeen(h, () => decode(h, 900), 0.6);
    for (const r of root.querySelectorAll('[data-rule]')) whenSeen(r, () => decode(r, 1400), 0.9);
    for (const ul of root.querySelectorAll('.idx')) whenSeen(ul, () => [...ul.querySelectorAll('[data-decode-hover]')].forEach((n, i) => setTimeout(() => decode(n, 800), i * 90)), 0.4);
    const mark = root.querySelector('[data-mark]');
    if (mark) decode(mark, 1600);
  }
  for (const n of root.querySelectorAll('[data-decode-hover]')) {
    const a = n.closest('a');
    on(a, 'mouseenter', () => decode(n, 650));
    on(a, 'focus', () => decode(n, 650));
  }
  for (const a of root.querySelectorAll('.links a')) on(a, 'mouseenter', () => decode(a, 500));

  // ---- where am I: the nav light and the command line follow the section on screen ------------------
  const links = [...root.querySelectorAll('.links a')];
  const sections = ['photos', 'lab', 'work', 'about', 'mirror', 'contact'].map((id) => root.querySelector(`#${id}`)).filter(Boolean);
  const hero = root.querySelector('.hero');
  const spy = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const id = e.target.id || 'top';
      links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.sec === id)));
      onSection(id);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const s of [hero, ...sections]) if (s) spy.observe(s);
  observers.push(spy);

  // ---- pictures develop out of letters ----------------------------------------------------------
  async function ready(img) {
    try { await img.decode(); return img.naturalWidth > 0; } catch { return false; }
  }

  // The hero: develops in resolution steps while the exposure ticks; then, under a mouse, it becomes a flashlight.
  const heroPic = root.querySelector('[data-develop="hero"]')?.closest('.pic');
  if (heroPic) {
    const img = heroPic.querySelector('img');
    const exif = root.querySelector('.hero [data-exif]');
    const shot = parseExif(exif?.dataset.exif);
    const finalExif = exif?.textContent;
    if (intro) heroPic.classList.add('is-dev');
    ready(img).then((ok) => {
      if (ac.signal.aborted) return;
      if (!ok) { heroPic.classList.remove('is-dev'); return; }
      const plate = new Plate(heroPic, img, night);
      let done = !intro;
      let base = null;
      let lens = null;
      let mix = 0;
      let target = 0;
      let lx = 0.5;
      let ly = 0.4;
      const STEPS = [10, 16, 26, 42, 68, 110];
      const develop = (k) => {
        plate.clear();
        const e = easeOut(k), s = clamp(e / 0.8, 0, 1);
        plate.letters(developStep(STEPS, s), { gain: 0.55 + 0.6 * s });
        if (e > 0.8) plate.image((e - 0.8) / 0.2);
        if (exif) exif.textContent = k >= 1 ? finalExif : tickExposure(shot, s);
        if (k >= 1) { done = true; heroPic.classList.remove('is-dev'); draw(); }
      };
      const makeBase = () => {
        base = document.createElement('canvas'); base.width = plate.c.width; base.height = plate.c.height;
        const g = base.getContext('2d'); g.setTransform(plate.dpr, 0, 0, plate.dpr, 0, 0);
        plate.clear(g); plate.letters(120, { gain: 0.42, ctx: g });
        lens = document.createElement('canvas'); lens.width = plate.c.width; lens.height = plate.c.height;
      };
      // At rest the photo is whole; while a mouse is over it, everything outside a soft circle of light falls back to letters.
      function draw() {
        if (!done) return;
        plate.image(1);
        if (mix <= 0.001) return;
        if (!base) makeBase();
        const g = lens.getContext('2d'), d = plate.dpr, x = lx * plate.W * d, y = ly * plate.H * d, r = plate.W * 0.2 * d;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, lens.width, lens.height);
        g.drawImage(base, 0, 0);
        g.globalCompositeOperation = 'destination-out';
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, '#000'); grad.addColorStop(0.45, '#000'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, lens.width, lens.height);
        plate.ctx.globalAlpha = mix;
        plate.ctx.drawImage(lens, 0, 0, plate.W, plate.H);
        plate.ctx.globalAlpha = 1;
      }
      let fading = false;
      const fade = () => {
        if (fading) return;
        fading = true;
        const step = () => {
          if (ac.signal.aborted) return;
          mix += (target - mix) * (reduceMotion ? 1 : 0.12);
          if (Math.abs(target - mix) < 0.01) mix = target;
          draw();
          if (mix !== target) requestAnimationFrame(step); else fading = false;
        };
        requestAnimationFrame(step);
      };
      const ro = new ResizeObserver(() => { plate.resize(); base = null; if (done) draw(); });
      ro.observe(heroPic);
      observers.push(ro);
      if (finePointer) {
        on(heroPic, 'pointermove', (e) => {
          const r = heroPic.getBoundingClientRect();
          lx = (e.clientX - r.left) / r.width; ly = (e.clientY - r.top) / r.height; target = 1;
          if (!fading) { if (mix === target) draw(); else fade(); }
        });
        on(heroPic, 'pointerleave', () => { target = 0; fade(); });
      }
      if (intro) play(2600, develop); else develop(1);
    });
  }

  // Photos dissolve from the centre outwards when they come into view; the black hole is scanned in; mirror's card stays letters.
  for (const img of root.querySelectorAll('img[data-develop="dissolve"], img[data-develop="scan"], img[data-develop="letters"]')) {
    const pic = img.closest('.pic');
    const kind = img.dataset.develop;
    const exif = pic.closest('figure')?.querySelector('[data-exif]');
    const shot = parseExif(exif?.dataset.exif);
    const finalExif = exif?.textContent;
    const stays = kind === 'letters';
    if (!intro && !stays) continue;
    pic.classList.add('is-dev');
    whenSeen(pic, async () => {
      if (!(await ready(img)) || ac.signal.aborted) { pic.classList.remove('is-dev'); return; }
      const plate = new Plate(pic, img, night);
      let cur = 0;
      let thr = null;
      const draw = (k) => {
        cur = k;
        plate.clear();
        if (kind === 'letters') {
          const steps = [12, 20, 32, 50, 72];
          plate.letters(developStep(steps, intro ? easeOut(k) : 1), { gain: 1.05 });
          return;
        }
        if (kind === 'scan') {
          const band = 0.18, y = k * (1 + band) - band;
          plate.letters(80, { cell: (cx, cy, g) => { const v = (cy + 0.5) / g.rows; return v < y ? -1 : v < y + band ? 1.35 : 0.38; } });
          const cut = clamp(y, 0, 1) * plate.H;
          if (cut > 0) plate.ctx.drawImage(plate.photoCanvas(), 0, 0, plate.c.width, cut * plate.dpr, 0, 0, plate.W, cut);
        } else {
          const g = plate.grid(56);
          if (!thr || thr.length !== g.cols * g.rows) {
            thr = new Float32Array(g.cols * g.rows);
            for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
              const dx = (x + 0.5) / g.cols - 0.5, dy = ((y + 0.5) / g.rows - 0.5) * (plate.H / plate.W);
              thr[y * g.cols + x] = 0.55 * Math.random() + 0.45 * Math.min(1, Math.hypot(dx, dy) / 0.62);
            }
          }
          const e = easeOut(k), src = plate.photoCanvas(), d = plate.dpr;
          plate.letters(56, { gain: 0.75, cell: (x, y) => (thr[y * g.cols + x] < e ? -1 : 1) });
          for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
            if (thr[y * g.cols + x] >= e) continue;
            const sx = x * g.cw, sy = y * g.ch;
            plate.ctx.drawImage(src, sx * d, sy * d, g.cw * d + 1, g.ch * d + 1, sx, sy, g.cw + 0.5, g.ch + 0.5);
          }
          if (exif) exif.textContent = k >= 1 ? finalExif : tickExposure(shot, e);
        }
        if (k >= 1) plate.remove();
      };
      if (stays) {
        const ro = new ResizeObserver(() => { plate.resize(); draw(1); });
        ro.observe(pic);
        observers.push(ro);
      }
      play(kind === 'scan' ? 1900 : 1700, draw);
      cleanups.push(() => { if (!stays && cur < 1) plate.remove(); });
    }, 0.35);
  }

  // ---- the face in "about" watches the pointer while it is on screen, and talks while you type ---------------
  const facePre = root.querySelector('[data-face]');
  let face = null;
  if (facePre) {
    const io = new IntersectionObserver((es) => {
      const visible = es.some((e) => e.isIntersecting);
      if (visible && !face) face = startFace(facePre, { getPointer: () => pointer, reduceMotion });
      else if (!visible && face) { face.stop(); face = null; }
    });
    io.observe(facePre);
    observers.push(io);
    on(window, 'keydown', () => face?.nudge());
    cleanups.push(() => face?.stop());
  }

  // ---- the mirror: your camera on a light box, a shutter, and prints ----------------------------------------
  const fig = root.querySelector('.lightbox-stage[data-mirror]');
  if (fig) {
    const pm = t.page.mirror;
    createMirror(fig, { t: t.mirror, reduceMotion, getInvert: () => true, stage: false, onCopied: (ok) => toast(ok ? t.mirror.copied : t.mirror.copyFailed) });
    const live = fig.querySelector('.mirror-ascii');
    const still = fig.querySelector('[data-placeholder]');
    const colsEl = fig.querySelector('[data-cols]');
    const prints = root.querySelector('[data-prints]');
    const flash = fig.querySelector('.flash');
    const frameText = () => (fig.dataset.state === 'live' && live.textContent ? live.textContent : still.textContent);
    const width = (text) => Math.max(...text.split('\n').map((l) => l.length));
    const showCols = () => { colsEl.textContent = pm.cols(width(frameText())); };
    showCols();
    const mo = new MutationObserver(() => { clearTimeout(mo.t); mo.t = setTimeout(showCols, 250); });
    mo.observe(live, { childList: true, characterData: true, subtree: true });
    mo.observe(fig, { attributes: true, attributeFilter: ['data-state'] });
    cleanups.push(() => { mo.disconnect(); clearTimeout(mo.t); stopMirror(); });
    on(fig.querySelector('[data-shutter]'), 'click', () => {
      flash.classList.remove('go');
      void flash.offsetWidth; // restart the animation
      flash.classList.add('go');
      const text = frameText().replace(/ +$/gm, '');
      const d = new Date();
      prints.querySelector('.empty')?.remove();
      const card = document.createElement('figure');
      card.className = 'print';
      const pre = document.createElement('pre');
      pre.textContent = text;
      const cap = document.createElement('figcaption');
      const meta = document.createElement('span');
      meta.textContent = `${clock(d)}:${String(d.getSeconds()).padStart(2, '0')} · ${pm.cols(width(text))}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = pm.copy;
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); btn.textContent = pm.copied; } catch {
          const r = document.createRange(); r.selectNodeContents(pre);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          toast(t.mirror.copyFailed);
        }
        setTimeout(() => { btn.textContent = pm.copy; }, 2000);
      });
      cap.append(meta, btn);
      card.append(pre, cap);
      prints.prepend(card);
    });
  }

  return {
    /** Colour temperature: 'auto' follows the local time; '2700k' etc. fix it; 'matrix' is green. */
    setTheme(theme) {
      const el = root.querySelector('[data-kelvin]');
      const html = document.documentElement;
      if (theme === 'matrix') {
        html.dataset.theme = 'matrix';
        html.style.removeProperty('--sun');
        if (el) el.textContent = 'theme matrix';
        return;
      }
      delete html.dataset.theme;
      const fixed = kelvinOf(theme);
      const now = new Date();
      const k = fixed ?? kelvinForHour(now.getHours());
      html.style.setProperty('--sun', sunColor(k));
      if (el) el.textContent = fixed ? t.page.lightFixed(k) : t.page.light(clock(now), k);
    },
    destroy() {
      ac.abort();
      observers.forEach((o) => o.disconnect());
      cleanups.forEach((f) => f());
    },
  };
}
