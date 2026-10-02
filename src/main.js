import { execute, complete, welcomeBlocks, bootLines, LAYOUT_MODES } from './engine.js';
import { routeFor, lineForHash, crumbsFor, documentTitle } from './route.js';
import { renderEntry, esc } from './render.js';
import { THEMES, LANGS, ui, profile, gallery } from './content.js';
import { createFx, FX_MODES } from './fx/fx.js';
import { startFace } from './fx/face.js';
import { startAscii3d } from './fx/ascii3d.js';
import { createTransitions } from './fx/wipe.js';
import { TRANSITION_MODES } from './fx/transition.js';
import { createReticle, CURSOR_MODES } from './fx/reticle.js';
import { createHud } from './hud.js';
import { createGui } from './gui.js';
import { createLightbox } from './lightbox.js';
import { createDock } from './dock.js';
import { createWindows } from './windows.js';
import { asciiFromImage, asciiColumns, createAsciiCache } from './fx/imgascii.js';

const $ = (id) => document.getElementById(id);
const log = $('log');
const screen = $('screen');
const form = $('prompt');
const input = $('cmd');
const chips = $('chips');
const dockEl = $('dock');
const win = $('window');
const crumbsEl = $('crumbs');
const crumbPath = $('crumb-path');
const crumbBack = $('crumb-back');
const crumbFwd = $('crumb-fwd');

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
const detectMode = () => (LAYOUT_MODES.includes(store.get('mode')) ? store.get('mode') : 'page');

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
  mode: detectMode(), // `page`: each page replaces the last; `log`: output keeps scrolling
  page: null,         // the route of the page on screen (src/route.js), null after `clear`
  navI: 0,            // position in the browser history entries this site made, and the furthest one (for Back / Forward)
  navMax: 0,
  history: [],
  cursor: 0,
  draft: '',
  booting: true,
  skip: false,
};
const ctx = () => ({ lang: state.lang, theme: state.theme ?? systemTheme(), fx: state.fx, transition: state.transition, cursor: state.reticle, hud: state.hud, mode: state.mode, history: state.history });

// ---- background effect + ASCII faces ------------------------------------------
const backdrop = createFx($('fx'), { reduceMotion });

// Targeting reticle that follows the pointer (fine pointers only; `cursor off` restores the native one).
const reticle = createReticle({ reduceMotion });

// The overview pane (cards + live telemetry): beside the terminal on wide screens, behind a tab on narrow ones.
const guiEl = $('gui');
const tabs = $('tabs');
const narrow = matchMedia('(max-width: 999.98px)');
const gui = createGui({ root: guiEl });
const dock = createDock({ root: dockEl, reduceMotion });
gui.render(state.lang);
const hud = createHud({ left: $('hud-left'), right: $('hud-right'), getState: () => ctx(), getPointer: () => reticle.pointer, reduceMotion });

// ---- contact: copy the public email address (the buttons only exist when profile.email is set) ----
let toastTimer = 0;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'sr';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
  ta.remove();
  return ok;
}

async function copyEmail(addr) {
  if (!addr) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(addr);
    ok = true;
  } catch {
    ok = fallbackCopy(addr); // insecure context or permission denied
  }
  const t = ui[state.lang];
  toast(ok ? t.contactCopied : t.contactFailed(addr)); // if copying is impossible, at least show the address
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) copyEmail(btn.dataset.copy);
});

// Picture viewer window (native <dialog>): opened by clicking a picture in the terminal output.
const lightbox = createLightbox({ getLang: () => state.lang, reduceMotion });
// On wide screens with a mouse, pictures open in floating windows you can drag and stack; otherwise in the modal viewer above.
const windows = createWindows({ getLang: () => state.lang, reduceMotion });
const floatingViewer = matchMedia('(min-width: 1000px) and (hover: hover) and (pointer: fine)');
const openPicture = (index, from) => (floatingViewer.matches ? windows.open(index, from) : lightbox.open(index, from));

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

const ASCII_HOLD_MS = 800;

/** A picture first appears as ASCII art made from its own pixels, then dissolves into the real image. */
/** The small version of a picture, decoded; null if it cannot be loaded (the caller then falls back to the full picture). */
async function smallPicture(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

// Pictures-in-letters are worked out ahead of time: once the page has loaded, and the browser has nothing better to do, every
// thumbnail that is already on screen is converted, so opening a picture only has to show the result.
const asciiCache = createAsciiCache();
const pictureWidth = () => Math.min(720, log.clientWidth || 480); // how wide a picture is on its own page (see .shot in the stylesheet)

function lettersFor(slug, source, cols, invert) {
  const key = asciiCache.key(slug, cols, invert);
  let text = asciiCache.get(key);
  if (text === undefined) {
    text = asciiFromImage(source, { cols, invert });
    asciiCache.set(key, text);
  }
  return text;
}

let precomputeTimer = 0;
function precomputeLetters() {
  clearTimeout(precomputeTimer);
  const cols = asciiColumns(pictureWidth());
  const invert = ctx().theme === 'light';
  const todo = [];
  for (const img of document.querySelectorAll('.gthumb img, .sheet-img')) {
    const index = Number((img.closest('[data-cmd^="view "]') ?? img.closest('.sheet-item')?.querySelector('[data-cmd^="view "]'))?.dataset.cmd?.split(' ')[1]);
    const g = gallery[index - 1];
    if (g && g.kind !== 'video' && img.complete && img.naturalWidth > 0 && !asciiCache.has(asciiCache.key(g.slug, cols, invert))) todo.push([g.slug, img]);
  }
  const step = () => {
    const job = todo.shift();
    if (!job) return;
    try { lettersFor(job[0], job[1], cols, invert); } catch { /* the picture will be converted when it is opened */ }
    if (todo.length) (window.requestIdleCallback ?? ((f) => setTimeout(f, 50)))(step);
  };
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(step);
}
const schedulePrecompute = () => { clearTimeout(precomputeTimer); precomputeTimer = setTimeout(precomputeLetters, 600); };

async function animateImage(fig) {
  const img = fig.querySelector('.shot-img');
  const pre = fig.querySelector('.shot-ascii');
  if (!img || !pre || reduceMotion || state.transition === 'off') return; // the real image is already showing
  fig.classList.add('is-ascii'); // hide the real image (it keeps its space, so nothing jumps)
  const fullReady = img.decode().catch(() => {}); // the full picture keeps loading while the letters show
  try {
    // The letters never wait for the full picture to download: they are worked out ahead of time (see precomputeLetters), or
    // from whatever is already here, or from the small version (a few KB) as a last resort.
    const index = Number(fig.dataset.open);
    const slug = gallery[index - 1]?.slug ?? fig.dataset.thumb;
    const fullHere = img.complete && img.naturalWidth > 0; // already in the cache: use the real picture, no need for the small one
    const early = fullHere ? img : null;
    const box = img.getBoundingClientRect(); // the reserved box: width and height are declared, so it is final already
    const cols = asciiColumns(box.width); // denser for bigger pictures, but always clearly letters
    const family = getComputedStyle(pre).fontFamily;
    const invert = ctx().theme === 'light';
    // Worked out already? Use that. Otherwise convert now, from the real picture if it is here, else from the small version.
    const source = asciiCache.has(asciiCache.key(slug, cols, invert)) ? null : (early ?? (await smallPicture(fig.dataset.thumb)) ?? (await fullReady, img));
    const text = lettersFor(slug, source, cols, invert);
    pre.textContent = text;
    // Size the text so `cols` characters span the image exactly, using this font's real character width.
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `100px ${family}`;
    const charWidth = (probe.measureText('M').width || 60) / 100; // as a fraction of the font size
    pre.style.fontSize = `${box.width / (cols * charWidth)}px`;
    pre.style.lineHeight = `${box.height / text.split('\n').length}px`;
    pre.hidden = false;
    await new Promise((r) => setTimeout(r, ASCII_HOLD_MS));
  } catch {
    // reading pixels failed: just show the real image
  }
  await fullReady; // never swap to a picture that has not arrived yet
  pre.hidden = true;
  fig.classList.remove('is-ascii');
  trans.revealEntry(fig.querySelector('.shot-open') ?? fig); // dissolve only over the picture itself, never the whole entry
}

function startNewImages() {
  for (const fig of log.querySelectorAll('[data-image]:not([data-started])')) {
    fig.dataset.started = '';
    animateImage(fig);
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

function print(blocks, { reveal = true, top = false } = {}) {
  if (!blocks.length) return;
  log.insertAdjacentHTML('beforeend', renderEntry(blocks, { ps1: PS1 }));
  startNewFaces();
  startNewModels();
  startNewImages();
  if (blocks.some((b) => b.t === 'sheet')) schedulePrecompute(); // a contact sheet brought new thumbnails
  if (top) screen.scrollTop = 0; // a new page starts at its top; output appended to a log follows the end
  else scrollToEnd();
  // Entries with a picture run their own ASCII-to-image reveal instead of the generic overlay.
  if (reveal && !blocks.some((b) => b.t === 'image')) trans.revealEntry(log.lastElementChild);
}

// ---- location: breadcrumb, Back / Forward, one address per page -----------------------
function renderCrumbs() {
  const t = ui[state.lang];
  crumbsEl.setAttribute('aria-label', t.nav.label);
  for (const [b, label] of [[crumbBack, t.nav.back], [crumbFwd, t.nav.forward]]) { b.setAttribute('aria-label', label); b.title = label; }
  crumbBack.disabled = state.navI <= 0;
  crumbFwd.disabled = state.navI >= state.navMax;
  const parts = crumbsFor(state.page);
  crumbPath.replaceChildren(...parts.map((c, i) => {
    const li = document.createElement('li');
    if (c.cmd) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb';
      b.dataset.cmd = c.cmd;
      b.textContent = c.label;
      li.append(b);
    } else li.textContent = c.label;
    if (i === parts.length - 1) li.setAttribute('aria-current', 'page');
    return li;
  }));
}

/** A page is now on screen: remember it, retitle the tab, and (for a new page) add a browser history entry so Back works. */
function enterPage(route, { push = true } = {}) {
  const changed = !state.page || state.page.hash !== route.hash;
  state.page = route;
  if (push && changed) {
    try {
      state.navI += 1;
      state.navMax = state.navI;
      history.pushState({ i: state.navI }, '', route.hash ? `#${route.hash}` : `${location.pathname}${location.search}`);
    } catch { /* e.g. a sandboxed frame: the page still works, only Back does not */ }
  }
  document.title = documentTitle(route, state.lang);
  renderCrumbs();
}

function leavePage() {
  state.page = null;
  document.title = documentTitle(null, state.lang);
  renderCrumbs();
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
  document.title = documentTitle(state.page, lang);
  $('status').setAttribute('aria-label', t.status.label);
  $('status').querySelector('.status-claims').textContent = t.status.claims;
  input.setAttribute('aria-label', t.inputLabel);
  chips.setAttribute('aria-label', t.chipsLabel);
  dockEl.setAttribute('aria-label', t.chipsLabel);
  $('btn-theme').setAttribute('aria-label', t.themeButton);
  $('btn-theme').title = t.themeButton;
  // The accessible name must contain the visible text (WCAG 2.5.3 "Label in Name"), so voice control ("click EN") works.
  $('btn-lang').textContent = lang === 'zh' ? 'EN' : '中';
  $('btn-lang').setAttribute('aria-label', `${t.langButton} (${$('btn-lang').textContent})`);
  $('btn-lang').title = t.langButton;
  $('btn-fx').setAttribute('aria-label', `${t.fxButton} (${$('btn-fx').textContent})`);
  $('btn-fx').title = t.fxButton;
  document.querySelector('.skip').textContent = t.skip;
  tabs.setAttribute('aria-label', t.gui.tabs);
  tabs.querySelector('[data-view="gui"]').textContent = t.gui.tabGui;
  tabs.querySelector('[data-view="term"]').textContent = t.gui.tabTerm;
  for (const b of [$('btn-mail'), $('tab-mail')]) {
    b.setAttribute('aria-label', t.contactButton);
    b.title = t.contactButton;
  }
  renderCrumbs();
  gui.render(lang);
  lightbox.refresh();
  windows.refresh();
  if (persist) store.set('lang', lang);
}

function applyEffects(effects) {
  for (const fx of effects) {
    if (fx.type === 'clear') { stopFaces(); log.replaceChildren(); leavePage(); }
    else if (fx.type === 'theme') applyTheme(fx.value, true);
    else if (fx.type === 'lang') applyLang(fx.value, true);
    else if (fx.type === 'fx') applyFx(fx.value, true);
    else if (fx.type === 'hud') { state.hud = fx.value; applyHud(fx.value === 'on'); store.set('hud', fx.value); }
    else if (fx.type === 'mode') { state.mode = fx.value; store.set('mode', fx.value); }
    else if (fx.type === 'cursor') { state.reticle = fx.value; reticle.setMode(fx.value); store.set('cursor', fx.value); }
    else if (fx.type === 'transition') { state.transition = fx.value; store.set('transition', fx.value); }
    else if (fx.type === 'open') window.open(fx.url, '_blank', 'noopener,noreferrer');
  }
}

// ---- running commands ---------------------------------------------------------
const WIPE_EFFECTS = new Set(['theme', 'lang', 'clear']);

function run(line, { record = true, push = true } = {}) {
  trans.settle(); // a pending clear / theme / language swap must land before this command runs
  const trimmed = line.trim();
  if (!trimmed) { print([{ t: 'echo', v: '' }]); return; }
  if (record && state.history.at(-1) !== trimmed) state.history = [...state.history, trimmed].slice(-100);
  state.cursor = state.history.length;
  state.draft = '';

  const res = execute(trimmed, ctx());
  const route = routeFor(trimmed);
  const clearing = res.effects.some((e) => e.type === 'clear');
  const wiping = res.effects.some((e) => WIPE_EFFECTS.has(e.type));
  const langChanged = res.effects.some((e) => e.type === 'lang');
  const apply = () => {
    applyEffects(res.effects.filter((e) => e.type !== 'open'));
    if (!clearing) {
      const asPage = Boolean(route) && state.mode === 'page';
      if (asPage) { stopFaces(); log.replaceChildren(); } // a page replaces the one before it
      else if (langChanged && state.page && state.mode === 'page') {
        // The language changed: show the page you are on in the new language, then the confirmation under it.
        const again = execute(state.page.cmd, ctx());
        stopFaces();
        log.replaceChildren();
        print([{ t: 'echo', v: state.page.cmd }, ...again.blocks], { reveal: false, top: true });
      }
      print([{ t: 'echo', v: trimmed }, ...res.blocks], { reveal: !wiping, top: asPage });
    }
    if (route) enterPage(route, { push });
    gui.setActive(trimmed);
    dock.setActive(trimmed);
    hud.refresh();
  };
  // Theme, language and clear swap state while the page is covered in glyphs.
  if (wiping) trans.run(apply, clearing ? { rect: screen.getBoundingClientRect() } : {});
  else apply();
  applyEffects(res.effects.filter((e) => e.type === 'open'));
}

// ---- boot ---------------------------------------------------------------------
const sleep = (ms) => (state.skip || reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

async function boot() {
  const deepLink = location.hash && lineForHash(location.hash) !== 'home' ? lineForHash(location.hash) : null;
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
  // As a page, a deep link replaces the welcome screen; as a log it follows it.
  if (!deepLink || state.mode === 'log') {
    print(welcomeBlocks(ctx()));
    state.page = routeFor('home');
    document.title = documentTitle(state.page, state.lang);
    renderCrumbs();
  }
  if (deepLink) run(deepLink, { record: false, push: false });

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
    trans.run(() => { stopFaces(); log.replaceChildren(); leavePage(); }, { rect: screen.getBoundingClientRect() });
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
log.addEventListener('click', (e) => {
  const open = e.target.closest('.shot-open, .sheet-open');
  if (open) openPicture(Number(open.dataset.open) - 1, open);
});
chips.addEventListener('click', onCommandClick);
dockEl.addEventListener('click', onCommandClick);
crumbsEl.addEventListener('click', onCommandClick); // the parts of the breadcrumb
crumbBack.addEventListener('click', () => history.back());
crumbFwd.addEventListener('click', () => history.forward());
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

// Back / Forward and edited addresses: show the page the address names.
addEventListener('popstate', (e) => {
  if (state.booting) return;
  if (Number.isInteger(e.state?.i)) state.navI = e.state.i;
  else {
    // An address typed in by hand (or an in-page link): the browser made a new entry for it, forgetting any forward ones.
    state.navI += 1;
    state.navMax = state.navI;
    try { history.replaceState({ i: state.navI }, ''); } catch { /* ignore */ }
  }
  const line = lineForHash(location.hash);
  if (line) run(line, { record: false, push: false });
  else {
    // The address names no page: keep what is on screen, and make the address say so.
    try { history.replaceState({ i: state.navI }, '', state.page?.hash ? `#${state.page.hash}` : `${location.pathname}${location.search}`); } catch { /* ignore */ }
    renderCrumbs();
  }
});

// ---- start --------------------------------------------------------------------
applyLang(state.lang, false);
if (state.theme) applyTheme(state.theme, false);
form.hidden = false;
chips.hidden = false;
crumbsEl.hidden = false;
try { history.replaceState({ i: 0 }, ''); } catch { /* ignore */ }
dockEl.hidden = false;
window.__siteReady = true; // tells src/guard.js the terminal is operable
document.querySelector('.boot-fail')?.remove(); // it may have appeared on a very slow load
$('btn-fx').hidden = false;
if (profile.email) {
  // Persistent contact buttons: in the terminal's title bar and in the narrow-screen tab bar.
  for (const b of [$('btn-mail'), $('tab-mail')]) { b.dataset.copy = profile.email; b.hidden = false; }
}
reticle.setMode(state.reticle);
if (document.readyState === 'complete') schedulePrecompute();
else addEventListener('load', schedulePrecompute, { once: true });
setView('term');
applyHud(state.hud === 'on');
hud.refresh();
applyFx(state.fx, false); // starts immediately, so the rain also plays behind the boot lines
boot();
