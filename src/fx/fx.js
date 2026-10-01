// Background layer: Matrix rain and/or a drifting point network on one canvas.
// Decorative only (aria-hidden, no pointer events). It pauses when the tab is
// hidden, caps device pixel ratio, steps its own density down if frames run
// slow, and draws a single static frame under prefers-reduced-motion.

import { createRain } from './rain.js';
import { createNetwork } from './network.js';

export const FX_MODES = ['both', 'rain', 'network', 'off'];
const SLOW_FRAME_MS = 26;
const SLOW_FRAMES_BEFORE_STEP = 90;

export function createFx(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  const rain = createRain();
  const net = createNetwork();
  let mode = 'off';
  let colors = { head: '#ffffff', body: '#5eead4' };
  let font = 'monospace';
  let w = 0;
  let h = 0;
  let level = 0; // 0 full quality .. 2 lowest; step down when frames are slow
  let raf = 0;
  let last = 0;
  let slow = 0;
  let pointer = null;

  const livePointer = () => (pointer && performance.now() - pointer.t < 2500 ? pointer : null);

  function resize() {
    w = innerWidth;
    h = innerHeight;
    const dpr = level === 0 ? Math.min(devicePixelRatio || 1, 2) : 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rain.resize(w, h, level);
    net.resize(w, h, level);
    if (isStatic()) draw(0);
  }

  const isStatic = () => reduceMotion || level > 2;
  const rainOn = () => mode === 'both' || mode === 'rain';
  const netOn = () => mode === 'both' || mode === 'network';

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    if (netOn()) net.draw(ctx, colors, mode === 'both' ? 0.85 : 1, livePointer());
    if (rainOn()) rain.draw(ctx, t, colors, mode === 'both' ? 0.7 : 1, font);
  }

  function frame(now) {
    raf = 0;
    if (mode === 'off' || document.hidden || isStatic()) return;
    const raw = now - last;
    const dt = Math.min(0.05, raw / 1000 || 0.016);
    if (last) {
      slow = raw > SLOW_FRAME_MS ? slow + 1 : Math.max(0, slow - 1);
      if (slow > SLOW_FRAMES_BEFORE_STEP) { slow = 0; level++; resize(); }
    }
    last = now;
    if (rainOn()) rain.update(dt);
    if (netOn()) net.update(dt, livePointer());
    draw(now / 1000);
    raf = requestAnimationFrame(frame);
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (mode === 'off') { ctx.clearRect(0, 0, w, h); return; }
    if (isStatic()) { draw(0); return; }
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  function refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    colors = { head: v('--fg', '#ffffff'), body: v('--accent', '#5eead4') };
    font = getComputedStyle(document.body).fontFamily || 'monospace';
    if (mode !== 'off' && isStatic()) draw(0);
  }

  addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; });
  document.addEventListener('visibilitychange', run);
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  });

  refreshColors();
  resize();

  return {
    get mode() { return mode; },
    refreshColors,
    setMode(next) {
      mode = FX_MODES.includes(next) ? next : 'off';
      canvas.hidden = mode === 'off';
      run();
    },
  };
}
