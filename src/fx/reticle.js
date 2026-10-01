// A hacker-style targeting reticle that follows the pointer: crosshair
// hairlines, a ring, and a label with live coordinates. Over something
// clickable it "locks on" and names the target.
//
// The native cursor is replaced by a crosshair SVG (CSS `cursor:`), so the
// pointer itself has zero lag; only the decorative layer eases behind it.
// Pure helpers are exported for tests; createReticle() is the DOM part.
// Decorative only: aria-hidden, no pointer events, off for touch input.

export const CURSOR_MODES = ['full', 'minimal', 'off'];

export const LABEL_W = 120;
export const LABEL_H = 40;

const pad4 = (n) => String(Math.max(0, Math.round(n))).padStart(4, '0');

/** "X 0812  Y 0304", clamped to non-negative integers. */
export const formatCoords = (x, y) => `X ${pad4(x)}  Y ${pad4(y)}`;

/** Where to put the label so it never leaves the viewport (flips near the edges). */
export function labelPlacement(x, y, vw, vh, w = LABEL_W, h = LABEL_H, gap = 20) {
  let lx = x + gap;
  let ly = y + gap;
  if (lx + w > vw - 4) lx = x - gap - w;
  if (ly + h > vh - 4) ly = y - gap - h;
  return { x: Math.max(4, lx), y: Math.max(4, ly) };
}

export const IDLE_MS = 1400;
export const BURST_GLYPHS = ['+', '×', '*', '▪', '░', '▒'];

/** Eight particles, one per 45 degrees, each with a retro glyph and a landing offset in whole pixels. */
export function burstParticles(radius = 26, glyphs = BURST_GLYPHS) {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return { glyph: glyphs[i % glyphs.length], dx: Math.round(Math.cos(a) * radius), dy: Math.round(Math.sin(a) * radius) };
  });
}

const TARGET_SELECTOR = '[data-cmd], a[href], button, input, textarea, select, [role="button"]';

/**
 * Describe what is under the pointer: { lock, text } or { lock:false, text }.
 * Takes anything with a `closest()` method, so tests can pass plain objects.
 */
export function describeTarget(el) {
  const hit = el?.closest?.(TARGET_SELECTOR);
  if (!hit) return { lock: false, text: 'SEEK' };
  const cmd = hit.dataset?.cmd ?? hit.getAttribute?.('data-cmd');
  if (cmd) return { lock: true, text: `LOCK ▸ ${cmd}`.slice(0, 22) };
  const tag = (hit.tagName ?? '').toLowerCase();
  if (tag === 'a') {
    let host = '';
    try { host = new URL(hit.href).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    return { lock: true, text: `LINK ↗ ${host}`.trim().slice(0, 22) };
  }
  if (tag === 'input' || tag === 'textarea') return { lock: false, text: 'INPUT ▌' };
  return { lock: true, text: `LOCK ▸ ${tag || 'target'}`.slice(0, 22) };
}

/** Move `current` toward `target`; snaps when closer than a sub-pixel. */
export const ease = (current, target, k) => (Math.abs(target - current) < 0.1 ? target : current + (target - current) * k);

export function createReticle({ reduceMotion = false } = {}) {
  const root = document.createElement('div');
  root.id = 'reticle';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<i class="rt-h"></i><i class="rt-v"></i><i class="rt-ring"></i><div class="rt-label"><b class="rt-xy"></b><span class="rt-tgt"></span></div>';
  document.body.append(root);
  const [hLine, vLine, ring] = root.querySelectorAll('i');
  const label = root.querySelector('.rt-label');
  const xy = root.querySelector('.rt-xy');
  const tgt = root.querySelector('.rt-tgt');

  let mode = 'off';
  let x = 0;
  let y = 0;
  let rx = 0;
  let ry = 0;
  let raf = 0;
  let locked = false;
  let lastText = '';
  let lastTarget = '';

  const pointer = { x: 0, y: 0, speed: 0, t: 0, seen: false };
  let lastMove = 0;
  let idleTimer = 0;

  function render() {
    raf = 0;
    const k = reduceMotion ? 1 : 0.34;
    rx = ease(rx, x, k);
    ry = ease(ry, y, k);
    hLine.style.transform = `translate3d(0, ${y}px, 0)`;
    vLine.style.transform = `translate3d(${x}px, 0, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    const p = labelPlacement(x, y, innerWidth, innerHeight);
    label.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    const text = formatCoords(x, y);
    if (text !== lastText) { xy.textContent = text; lastText = text; }
    if (rx !== x || ry !== y) raf = requestAnimationFrame(render);
  }

  function setTarget(t) {
    if (t.text !== lastTarget) { tgt.textContent = t.text; lastTarget = t.text; }
    if (t.lock !== locked) { locked = t.lock; root.classList.toggle('rt-lock', locked); }
  }

  function onMove(e) {
    if (e.pointerType === 'touch') return;
    // Position and speed are tracked in every mode (the HUD reads them); drawing only when on.
    const now = performance.now();
    const dt = Math.max(1, now - lastMove);
    pointer.speed = Math.round((Math.hypot(e.clientX - x, e.clientY - y) / dt) * 1000);
    pointer.t = lastMove = now;
    if (!pointer.seen) { rx = e.clientX; ry = e.clientY; pointer.seen = true; }
    x = pointer.x = e.clientX;
    y = pointer.y = e.clientY;
    if (mode === 'off') return;
    root.classList.add('rt-visible');
    root.classList.remove('rt-idle'); // the label fades away when the pointer rests
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('rt-idle'), IDLE_MS);
    setTarget(describeTarget(e.target));
    raf ||= requestAnimationFrame(render);
  }

  // Retro click: a burst of characters flying outward in stepped (8-bit) frames
  // plus a pixel box that grows in steps. All timing lives in CSS steps().
  function onDown(e) {
    if (mode === 'off' || reduceMotion || e.pointerType === 'touch') return;
    const fx = document.createElement('div');
    fx.className = 'rt-burst';
    fx.style.left = `${e.clientX}px`;
    fx.style.top = `${e.clientY}px`;
    const box = document.createElement('i');
    box.className = 'rt-box';
    fx.append(box);
    for (const p of burstParticles()) {
      const el = document.createElement('i');
      el.className = 'rt-px';
      el.textContent = p.glyph;
      el.style.setProperty('--dx', `${p.dx}px`);
      el.style.setProperty('--dy', `${p.dy}px`);
      fx.append(el);
    }
    root.append(fx);
    const remove = () => fx.remove();
    box.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 900); // safety net
  }

  const hide = () => root.classList.remove('rt-visible');

  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  document.documentElement.addEventListener('pointerleave', hide);
  addEventListener('blur', hide);

  return {
    get mode() { return mode; },
    get pointer() { return pointer; },
    setMode(next) {
      mode = CURSOR_MODES.includes(next) ? next : 'off';
      root.dataset.mode = mode;
      document.documentElement.classList.toggle('rt-on', mode !== 'off');
      if (mode === 'off') hide();
    },
  };
}
