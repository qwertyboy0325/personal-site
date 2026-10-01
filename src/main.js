import { execute, complete, welcomeBlocks, bootLines, NAV } from './engine.js';
import { renderEntry, esc } from './render.js';
import { THEMES, LANGS, ui, profile } from './content.js';
import { createFx, FX_MODES } from './fx/fx.js';
import { startFace } from './fx/face.js';
import { startAscii3d } from './fx/ascii3d.js';
import { createTransitions } from './fx/wipe.js';
import { TRANSITION_MODES } from './fx/transition.js';
import { createReticle, CURSOR_MODES } from './fx/reticle.js';
import { createHud } from './hud.js';
import { createGui } from './gui.js';

const $ = (id) => document.getElementById(id);
const log = $('log');
const screen = $('screen');
const form = $('prompt');
const input = $('cmd');
const chips = $('chips');
const win = $('window');

const PS1 = `${profile.user}@${profile.host}:~$`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// localStorage can throw (private mode, blocked storage); never depend on it.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const systemTheme = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const detectLang = () => {
  const saved = store.get('lang');
  if (LANGS.includes(saved)) return saved;
  return (navigator.languages ?? [navigator.language]).some((l) => /^zh/i.test(l ?? '')) ? 'zh' : 'en';
};

// Background effect default: on, except when the visitor asked to save data.
const detectFx = () => {
  const saved = store.get('fx');
  if (FX_MODES.includes(saved)) return saved;
  return navigator.connection?.saveData ? 'off' : 'both';
};

const detectTransition = () => {
  const saved = store.get('transition');
  if (TRANSITION_MODES.includes(saved)) return saved;
  return navigator.connection?.saveData ? 'off' : 'auto';
};

const detectHud = () => (store.get('hud') === 'off' ? 'off' : 'on');

const detectCursor = () => {
  const saved = store.get('cursor');
  if (CURSOR_MODES.includes(saved)) return saved;
  return finePointer ? 'minimal' : 'off'; // `cursor full` adds the screen-wide crosshair
};

const state = {
  lang: detectLang(),
  theme: THEMES.includes(store.get('theme')) ? store.get('theme') : null,
  fx: detectFx(),
  transition: detectTransition(),
  reticle: detectCursor(), // reticle mode; note `cursor` below is the history index
  hud: detectHud(),
  history: [],
  cursor: 0,
  draft: '',
  booting: true,
  skip: false,
};
const ctx = () => ({ lang: state.lang, theme: state.theme ?? systemTheme(), fx: state.fx, transition: state.transition, cursor: state.reticle, hud: state.hud, history: state.history });

// ---- background effect + ASCII faces ------------------------------------------
const backdrop = createFx($('fx'), { reduceMotion });

// Targeting reticle that follows the pointer (fine pointers only; `cursor off` restores the native one).
const reticle = createReticle({ reduceMotion });

// The overview pane (cards + live telemetry): beside the terminal on wide screens, behind a tab on narrow ones.
const guiEl = $('gui');
const tabs = $('tabs');
const narrow = matchMedia('(max-width: 999.98px)');
const gui = createGui({ root: guiEl });
gui.render(state.lang);
const hud = createHud({ left: $('hud-left'), right: $('hud-right'), getState: () => ctx(), getPointer: () => reticle.pointer, reduceMotion });

function setView(view) {
  document.documentElement.dataset.view = view;
  tabs.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  hud.reschedule();
}

function applyHud(on) {
  // Show or hide first: the telemetry only runs while its panels are actually on screen.
  guiEl.hidden = !on;
  tabs.hidden = !on;
  if (!on) setView('term');
  hud.setEnabled(on); // also (re)starts or stops the telemetry timers
}

// ASCII transitions: a dissolving overlay on new output, and a page wipe for theme / language / clear.
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const trans = createTransitions({
  wipeCanvas: $('wipe'),
  reduceMotion,
  getMode: () => state.transition,
  getColors: () => ({ bg: cssVar('--panel', '#0f151c'), dim: cssVar('--accent', '#5eead4'), lead: cssVar('--fg', '#ffffff') }),
});
let pointer = null;
addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
let faces = [];

let models = [];

function stopFaces() {
  faces.forEach((f) => f.stop());
  faces = [];
  models.forEach((m) => m.stop());
  models = [];
}

/** Animate freshly printed ASCII 3D models; only the newest one keeps spinning. */
function startNewModels() {
  for (const el of log.querySelectorAll('[data-ascii3d]:not([data-started])')) {
    el.dataset.started = '';
    models.forEach((m) => m.stop());
    models = [startAscii3d(el, { shape: el.dataset.shape, getPointer: () => pointer, getTheme: () => ctx().theme, reduceMotion })];
  }
}

/** Animate any freshly printed ASCII faces; only the newest one keeps running. */
function startNewFaces() {
  for (const el of log.querySelectorAll('[data-ascii-face]:not([data-started])')) {
    el.dataset.started = '';
    faces.forEach((f) => f.stop());
    faces = [startFace(el, { getPointer: () => pointer, getTheme: () => ctx().theme, reduceMotion })];
  }
}

function applyFx(mode, persist) {
  state.fx = mode;
  document.documentElement.dataset.fx = mode === 'off' ? 'off' : 'on';
  backdrop.setMode(mode);
  if (persist) store.set('fx', mode);
}

// ---- view helpers -------------------------------------------------------------
function scrollToEnd() {
  screen.scrollTop = screen.scrollHeight;
}

function print(blocks, { reveal = true } = {}) {
  if (!blocks.length) return;
  log.insertAdjacentHTML('beforeend', renderEntry(blocks, { ps1: PS1 }));
  startNewFaces();
  startNewModels();
  scrollToEnd();
  if (reveal) trans.revealEntry(log.lastElementChild);
}

function applyTheme(name, persist) {
  state.theme = name ?? null; // ctx().theme (the `theme` command, the toolbar cycle, the HUD) reads this
  if (name) document.documentElement.dataset.theme = name;
  else delete document.documentElement.dataset.theme;
  if (persist && name) store.set('theme', name);
  // Keep the browser UI colour in sync with the page background.
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', bg); });
  backdrop.refreshColors();
}

function applyLang(lang, persist) {
  state.lang = lang;
  const t = ui[lang];
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  document.title = t.documentTitle;
  input.setAttribute('aria-label', t.inputLabel);
  chips.setAttribute('aria-label', t.chipsLabel);
  $('btn-theme').setAttribute('aria-label', t.themeButton);
  $('btn-theme').title = t.themeButton;
  $('btn-lang').setAttribute('aria-label', t.langButton);
  $('btn-lang').title = t.langButton;
  $('btn-lang').textContent = lang === 'zh' ? 'EN' : '中';
  $('btn-fx').setAttribute('aria-label', t.fxButton);
  $('btn-fx').title = t.fxButton;
  document.querySelector('.skip').textContent = t.skip;
  tabs.setAttribute('aria-label', t.gui.tabs);
  tabs.querySelector('[data-view="gui"]').textContent = t.gui.tabGui;
  tabs.querySelector('[data-view="term"]').textContent = t.gui.tabTerm;
  gui.render(lang);
  if (persist) store.set('lang', lang);
}

function applyEffects(effects) {
  for (const fx of effects) {
    if (fx.type === 'clear') { stopFaces(); log.replaceChildren(); }
    else if (fx.type === 'theme') applyTheme(fx.value, true);
    else if (fx.type === 'lang') applyLang(fx.value, true);
    else if (fx.type === 'fx') applyFx(fx.value, true);
    else if (fx.type === 'hud') { state.hud = fx.value; applyHud(fx.value === 'on'); store.set('hud', fx.value); }
    else if (fx.type === 'cursor') { state.reticle = fx.value; reticle.setMode(fx.value); store.set('cursor', fx.value); }
    else if (fx.type === 'transition') { state.transition = fx.value; store.set('transition', fx.value); }
    else if (fx.type === 'open') window.open(fx.url, '_blank', 'noopener,noreferrer');
  }
}

// ---- running commands ---------------------------------------------------------
const WIPE_EFFECTS = new Set(['theme', 'lang', 'clear']);

function run(line, { record = true } = {}) {
  trans.settle(); // a pending clear / theme / language swap must land before this command runs
  const trimmed = line.trim();
  if (!trimmed) { print([{ t: 'echo', v: '' }]); return; }
  if (record && state.history.at(-1) !== trimmed) state.history = [...state.history, trimmed].slice(-100);
  state.cursor = state.history.length;
  state.draft = '';

  const res = execute(trimmed, ctx());
  const clearing = res.effects.some((e) => e.type === 'clear');
  const wiping = res.effects.some((e) => WIPE_EFFECTS.has(e.type));
  const apply = () => {
    applyEffects(res.effects.filter((e) => e.type !== 'open'));
    if (!clearing) print([{ t: 'echo', v: trimmed }, ...res.blocks], { reveal: !wiping });
    gui.setActive(trimmed);
    hud.refresh();
  };
  // Theme, language and clear swap state while the page is covered in glyphs.
  if (wiping) trans.run(apply, clearing ? { rect: screen.getBoundingClientRect() } : {});
  else apply();
  applyEffects(res.effects.filter((e) => e.type === 'open'));
  if (res.nav) { try { history.replaceState(null, '', `#${res.nav}`); } catch { /* ignore */ } }
}

// ---- boot ---------------------------------------------------------------------
const sleep = (ms) => (state.skip || reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

async function boot() {
  const hash = location.hash.slice(1).toLowerCase();
  const deepLink = NAV.has(hash) ? hash : null;
  log.replaceChildren();
  log.setAttribute('aria-live', 'off');

  if (!deepLink) {
    for (const line of bootLines(ctx())) {
      log.insertAdjacentHTML('beforeend', `<div class="boot"><span class="ok">[ ok ]</span> ${esc(line)}</div>`);
      scrollToEnd();
      await sleep(160);
    }
    await sleep(120);
  }
  print(welcomeBlocks(ctx()));
  if (deepLink) run(deepLink, { record: false });

  log.setAttribute('aria-live', 'polite');
  state.booting = false;
  if (finePointer) input.focus({ preventScroll: true });
}

// ---- events -------------------------------------------------------------------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.booting) { state.skip = true; return; }
  const value = input.value;
  input.value = '';
  run(value);
});

input.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // IME composition (e.g. Zhuyin): leave keys alone
  const k = e.key;
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (!state.history.length) return;
    e.preventDefault();
    if (state.cursor === state.history.length) state.draft = input.value;
    state.cursor = Math.min(state.history.length, Math.max(0, state.cursor + (k === 'ArrowUp' ? -1 : 1)));
    input.value = state.cursor === state.history.length ? state.draft : state.history[state.cursor];
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
  } else if (k === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const res = complete(input.value);
    input.value = res.line;
    if (res.options.length) print([{ t: 'echo', v: input.value }, { t: 'p', v: [{ dim: `${ui[state.lang].completions}: ` }, res.options.join('  ')] }]);
  } else if (e.ctrlKey && k.toLowerCase() === 'l') {
    e.preventDefault();
    trans.settle();
    trans.run(() => { stopFaces(); log.replaceChildren(); }, { rect: screen.getBoundingClientRect() });
  } else if (e.ctrlKey && k.toLowerCase() === 'c') {
    e.preventDefault();
    print([{ t: 'echo', v: `${input.value}^C` }]);
    input.value = '';
  } else if (e.ctrlKey && k.toLowerCase() === 'u') {
    e.preventDefault();
    input.value = '';
  }
});

// The ASCII face "listens": typing makes its mouth move.
input.addEventListener('input', () => faces.forEach((f) => f.nudge()));

// Buttons rendered inside output and the quick-command chips share one handler.
function onCommandClick(e) {
  const btn = e.target.closest('[data-cmd]');
  if (!btn || state.booting) return;
  run(btn.dataset.cmd);
  // On a narrow screen the overview replaces the terminal, so show the result.
  if (guiEl.contains(btn) && narrow.matches) setView('term');
  if (finePointer) input.focus({ preventScroll: true });
}
log.addEventListener('click', onCommandClick);
chips.addEventListener('click', onCommandClick);
guiEl.addEventListener('click', onCommandClick); // cards and the recent-commands list
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});
narrow.addEventListener('change', () => hud.reschedule());

// Clicking empty terminal space focuses the prompt, unless the user is selecting text.
win.addEventListener('click', (e) => {
  if (e.target.closest('a, button, input')) return;
  if (getSelection()?.toString()) return;
  input.focus({ preventScroll: true });
});

$('btn-theme').addEventListener('click', () => {
  const cur = ctx().theme;
  run(`theme ${THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]}`);
});
$('btn-lang').addEventListener('click', () => run(`lang ${state.lang === 'zh' ? 'en' : 'zh'}`));
$('btn-fx').addEventListener('click', () => run(`fx ${FX_MODES[(FX_MODES.indexOf(state.fx) + 1) % FX_MODES.length]}`));
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => backdrop.refreshColors());

// Any key or tap during the boot sequence skips the animation.
const skipBoot = () => { state.skip = true; };
addEventListener('keydown', skipBoot, { once: true });
addEventListener('pointerdown', skipBoot, { once: true });

addEventListener('hashchange', () => {
  const hash = location.hash.slice(1).toLowerCase();
  if (!state.booting && NAV.has(hash)) run(hash, { record: false });
});

// ---- start --------------------------------------------------------------------
applyLang(state.lang, false);
if (state.theme) applyTheme(state.theme, false);
form.hidden = false;
chips.hidden = false;
window.__siteReady = true; // tells src/guard.js the terminal is operable
document.querySelector('.boot-fail')?.remove(); // it may have appeared on a very slow load
$('btn-fx').hidden = false;
reticle.setMode(state.reticle);
setView('term');
applyHud(state.hud === 'on');
hud.refresh();
applyFx(state.fx, false); // starts immediately, so the rain also plays behind the boot lines
boot();
