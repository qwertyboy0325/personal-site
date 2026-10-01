// The GUI layer around the terminal (wide screens only): live telemetry on the
// left, a clickable project map and recent commands on the right.
//
// Every number is real (clock, uptime, viewport, measured frame rate, pointer
// position and speed). The left column is decorative (aria-hidden); the right
// column contains real buttons, so it is labelled and keyboard reachable.

import { esc } from './render.js';
import { projects, ui } from './content.js';
import { describeTarget } from './fx/reticle.js';
import { formatClock, formatUptime, formatSpeed, sessionId, pushSample, sparkPoints, recentCommands } from './hud-format.js';

const MAP_NODES = ['n1', 'n2', 'n3', 'n4'];
const TICK_MS = 200;
const FPS_WINDOW_MS = 500;

export function createHud({ left, right, getState, getPointer, reduceMotion = false }) {
  const started = performance.now();
  const wide = matchMedia('(min-width: 1320px)');
  const sid = sessionId();
  let enabled = true;
  let timer = 0;
  let fpsRaf = 0;
  let frames = 0;
  let windowStart = 0;
  let samples = [];

  left.innerHTML = `
    <section class="panel"><h3>// SYSTEM</h3>
      <dl class="stat">
        <dt>SESSION</dt><dd>0x${sid}</dd>
        <dt>LOCAL</dt><dd data-h="clock">--:--:--</dd>
        <dt>UPTIME</dt><dd data-h="up">00:00</dd>
        <dt>VIEWPORT</dt><dd data-h="vp">-</dd>
        <dt>THEME</dt><dd data-h="theme">-</dd>
        <dt>LANG</dt><dd data-h="lang">-</dd>
      </dl>
    </section>
    <section class="panel"><h3>// SIGNAL</h3>
      <div class="fps"><b data-h="fps">--</b><span>fps</span></div>
      <svg class="spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true"><polyline data-h="spark" points=""/></svg>
      <dl class="stat"><dt>FX</dt><dd data-h="fx">-</dd><dt>TRANS</dt><dd data-h="trans">-</dd></dl>
    </section>
    <section class="panel"><h3>// POINTER</h3>
      <dl class="stat">
        <dt>X</dt><dd data-h="px">----</dd>
        <dt>Y</dt><dd data-h="py">----</dd>
        <dt>SPEED</dt><dd data-h="speed">0 px/s</dd>
        <dt>TARGET</dt><dd data-h="target">-</dd>
      </dl>
    </section>`;

  right.innerHTML = `
    <section class="panel"><h3>// PROJECT MAP</h3>
      <div class="map">
        <svg class="map-lines" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true">
          <line x1="100" y1="100" x2="48" y2="26"/><line x1="100" y1="100" x2="152" y2="26"/>
          <line x1="100" y1="100" x2="48" y2="174"/><line x1="100" y1="100" x2="152" y2="174"/>
        </svg>
        <button type="button" class="node node-core" data-cmd="about" title="about">EZRA</button>
        ${projects.map((p, i) => `<button type="button" class="node ${MAP_NODES[i] ?? ''}" data-cmd="project ${i + 1}" title="${esc(p.slug)}">${esc(p.short)}</button>`).join('')}
      </div>
    </section>
    <section class="panel"><h3>// RECENT</h3><ul class="recent" data-h="recent"></ul></section>`;

  const q = (name, root) => root.querySelector(`[data-h="${name}"]`);
  const el = {
    clock: q('clock', left), up: q('up', left), vp: q('vp', left), theme: q('theme', left), lang: q('lang', left),
    fps: q('fps', left), spark: q('spark', left), fx: q('fx', left), trans: q('trans', left),
    px: q('px', left), py: q('py', left), speed: q('speed', left), target: q('target', left),
    recent: q('recent', right),
  };
  const lastText = new Map();
  const setText = (key, value) => {
    if (lastText.get(key) === value) return; // avoid needless layout work
    lastText.set(key, value);
    el[key].textContent = value;
  };

  const active = () => enabled && wide.matches && !document.hidden;

  function tick() {
    const s = getState();
    setText('clock', formatClock(new Date()));
    setText('up', formatUptime(performance.now() - started));
    setText('vp', `${innerWidth}×${innerHeight} @${(devicePixelRatio || 1).toFixed(1).replace('.0', '')}x`);
    setText('theme', s.theme);
    setText('lang', s.lang);
    setText('fx', s.fx ?? '-');
    setText('trans', s.transition ?? '-');
    const p = getPointer();
    if (p?.seen) {
      setText('px', String(Math.round(p.x)).padStart(4, '0'));
      setText('py', String(Math.round(p.y)).padStart(4, '0'));
      const idle = performance.now() - p.t > 250;
      setText('speed', formatSpeed(idle ? 0 : p.speed));
      setText('target', describeTarget(document.elementFromPoint(p.x, p.y)).text);
    }
  }

  function fpsFrame(now) {
    fpsRaf = 0;
    if (!active() || reduceMotion) return;
    frames++;
    if (!windowStart) windowStart = now;
    if (now - windowStart >= FPS_WINDOW_MS) {
      const fps = Math.round((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;
      samples = pushSample(samples, fps, 60);
      setText('fps', String(fps));
      el.spark.setAttribute('points', sparkPoints(samples, 120, 32, 70));
    }
    fpsRaf = requestAnimationFrame(fpsFrame);
  }

  function refresh() {
    const s = getState();
    const t = ui[s.lang] ?? ui.en;
    right.setAttribute('aria-label', t.hudMapLabel);
    const cmds = recentCommands(s.history, 6);
    el.recent.innerHTML = cmds.length
      ? cmds.map((c) => `<li><button type="button" class="recent-btn" data-cmd="${esc(c)}">${esc(c)}</button></li>`).join('')
      : `<li class="dim">${esc(t.hudEmpty)}</li>`;
    tick();
  }

  function schedule() {
    clearInterval(timer);
    timer = 0;
    cancelAnimationFrame(fpsRaf);
    fpsRaf = 0;
    frames = 0;
    windowStart = 0;
    if (!active()) return;
    tick();
    timer = setInterval(tick, TICK_MS);
    if (!reduceMotion) fpsRaf = requestAnimationFrame(fpsFrame);
  }

  wide.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);

  return {
    refresh,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      document.documentElement.dataset.hud = enabled ? 'on' : 'off';
      left.hidden = right.hidden = !enabled;
      schedule();
    },
  };
}
