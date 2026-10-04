import { execute, complete, welcomeBlocks, bootLines, LAYOUT_MODES, resolveCommand } from './engine.js';
import { lineForHash, documentTitle } from './route.js';
import { renderEntry, esc } from './render.js';
import { THEMES, LANGS, ui, profile, gallery } from './content.js';
import { renderPage } from './page.js';
import { createSite } from './site.js';
import { startFace } from './fx/face.js';
import { startAscii3d } from './fx/ascii3d.js';
import { createTransitions } from './fx/wipe.js';
import { TRANSITION_MODES } from './fx/transition.js';
import { createLightbox } from './lightbox.js';
import { createMirror, stopMirror, defaultFocal } from './fx/mirror.js';
import { asciiFromImage, asciiColumns, createAsciiCache } from './fx/imgascii.js';

// The page is the site; the terminal is a second way in. It lives in a drawer (press ~), reads the same content,
// and keeps the page in step: a command that names a part of the page scrolls the page there.

const $ = (id) => document.getElementById(id);
const pageEl = $('page');
const term = $('term');
const log = $('log');
const screen = $('screen');
const form = $('prompt');
const input = $('cmd');
const chips = $('chips');
const cmdline = $('cmdline');
const cmdlineText = $('cmdline-text');

const PS1 = `${profile.user}@${profile.host}:~$`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// localStorage can throw (private mode, blocked storage); never depend on it.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const detectLang = () => {
  const saved = store.get('lang');
  if (LANGS.includes(saved)) return saved;
  return (navigator.languages ?? [navigator.language]).some((l) => /^zh/i.test(l ?? '')) ? 'zh' : 'en';
};
const detectTransition = () => {
  const saved = store.get('transition');
  if (TRANSITION_MODES.includes(saved)) return saved;
  return navigator.connection?.saveData ? 'off' : 'auto';
};
const detectMode = () => (LAYOUT_MODES.includes(store.get('mode')) ? store.get('mode') : 'page');

const state = {
  lang: detectLang(),
  theme: THEMES.includes(store.get('theme')) ? store.get('theme') : 'auto', // older saved themes (dark, light, amber) mean auto
  transition: detectTransition(),
  mode: detectMode(), // `page`: each page replaces the last; `log`: output keeps scrolling
  open: false,
  booted: false,
  booting: false,
  bootDone: null,
  skip: false,
  history: [],
  cursor: 0,
  draft: '',
};
const ctx = () => ({ lang: state.lang, theme: state.theme, transition: state.transition, mode: state.mode, history: state.history });

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
  if (btn && profile.email) copyEmail(btn.dataset.copy);
});

// Picture viewer (native <dialog>): opened from the page and from pictures in the terminal.
const lightbox = createLightbox({ getLang: () => state.lang, reduceMotion });

// ASCII transitions: a dissolving overlay on new terminal output, and a wipe for theme / language / clear.
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const trans = createTransitions({
  wipeCanvas: $('wipe'),
  reduceMotion,
  getMode: () => state.transition,
  getColors: () => ({ bg: cssVar('--night', '#0e0d0b'), dim: cssVar('--sun', '#ffc27a'), lead: cssVar('--paper', '#ede7dc') }),
});

// ---- the page --------------------------------------------------------------------------------------
const SECTION_COMMAND = { top: 'help', photos: 'photos', lab: '3d donut', work: 'projects', about: 'about', mirror: 'mirror', contact: 'contact' };
let typing = 0;
function showCommand(line) {
  clearInterval(typing);
  if (reduceMotion) { cmdlineText.textContent = line; return; }
  let n = 0;
  cmdlineText.textContent = '';
  typing = setInterval(() => { cmdlineText.textContent = line.slice(0, ++n); if (n >= line.length) clearInterval(typing); }, 45);
}
let sectionLine = 'help';

let site = null;
function mountSite({ quiet = false } = {}) {
  site?.destroy();
  site = createSite(pageEl, {
    lang: state.lang,
    reduceMotion,
    finePointer,
    quiet,
    toast,
    onCommand: (line) => { openTerm({ focus: false, hurry: true }).then(() => run(line)); },
    onOpenPicture: (index, from) => lightbox.open(index, from),
    onSection: (id) => { sectionLine = SECTION_COMMAND[id] ?? 'help'; showCommand(sectionLine); },
  });
  site.setTheme(state.theme);
  syncTools();
}

function syncTools() {
  const theme = $('btn-theme');
  if (theme) theme.textContent = state.theme === 'auto' ? 'AUTO' : state.theme.toUpperCase();
}

pageEl.addEventListener('click', (e) => {
  if (e.target.closest('#btn-theme')) {
    const cycle = THEMES.filter((x) => x !== 'matrix');
    const next = cycle[(cycle.indexOf(state.theme) + 1) % cycle.length];
    trans.run(() => applyTheme(next, true));
  } else if (e.target.closest('#btn-lang')) {
    const next = state.lang === 'zh' ? 'en' : 'zh';
    trans.run(() => applyLang(next, true));
  }
});

// ---- the terminal drawer ------------------------------------------------------------------------------
/** Open the drawer; resolves once the boot lines are done, so a command run right after lands below them. */
function openTerm({ focus = finePointer, hurry = false } = {}) {
  if (hurry) state.skip = true;
  if (!state.open) {
    state.open = true;
    term.hidden = false;
    term.classList.remove('is-in');
    void term.offsetWidth; // restart the slide-in
    term.classList.add('is-in');
    document.documentElement.dataset.drawer = 'open';
    cmdline.setAttribute('aria-expanded', 'true');
    if (!state.booted) state.bootDone = boot();
  }
  if (focus) input.focus({ preventScroll: true });
  return state.bootDone ?? Promise.resolve();
}

function closeTerm() {
  if (!state.open) return;
  state.open = false;
  term.hidden = true;
  document.documentElement.dataset.drawer = 'closed';
  cmdline.setAttribute('aria-expanded', 'false');
  stopMirror(); // a camera opened from the terminal never outlives it
  cmdline.focus({ preventScroll: true });
}

cmdline.addEventListener('click', () => {
  const line = sectionLine;
  openTerm({ hurry: true }).then(() => run(line));
});
$('term-close').addEventListener('click', closeTerm);

const typingInField = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Escape' && state.open && !document.querySelector('dialog[open]')) { e.preventDefault(); closeTerm(); return; }
  if ((e.key === '~' || e.key === '`') && !e.ctrlKey && !e.metaKey && !e.altKey && !typingInField(e.target)) {
    e.preventDefault();
    if (state.open) closeTerm(); else openTerm();
  }
});

// ---- terminal output: faces, models, pictures, the mirror's big view -------------------------------------
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
    models = [startAscii3d(el, { shape: el.dataset.shape, getPointer: () => pointer, getTheme: () => 'dark', reduceMotion })];
  }
}

/** Animate any freshly printed ASCII faces; only the newest one keeps running. */
function startNewFaces() {
  for (const el of log.querySelectorAll('[data-ascii-face]:not([data-started])')) {
    el.dataset.started = '';
    faces.forEach((f) => f.stop());
    faces = [startFace(el, { getPointer: () => pointer, getTheme: () => 'dark', reduceMotion })];
  }
}

const ASCII_HOLD_MS = 800;

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

// Pictures-in-letters are worked out ahead of time, once the browser has nothing better to do, so opening a picture
// in the terminal only has to show the result.
const asciiCache = createAsciiCache();
const pictureWidth = () => Math.min(720, log.clientWidth || 480);

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
  const todo = [];
  for (const img of log.querySelectorAll('.sheet-img')) {
    const index = Number(img.closest('.sheet-item')?.querySelector('[data-cmd^="view "]')?.dataset.cmd?.split(' ')[1]);
    const g = gallery[index - 1];
    if (g && g.kind !== 'video' && img.complete && img.naturalWidth > 0 && !asciiCache.has(asciiCache.key(g.slug, cols, false))) todo.push([g.slug, img]);
  }
  const step = () => {
    const job = todo.shift();
    if (!job) return;
    try { lettersFor(job[0], job[1], cols, false); } catch { /* converted when opened instead */ }
    if (todo.length) (window.requestIdleCallback ?? ((f) => setTimeout(f, 50)))(step);
  };
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(step);
}
const schedulePrecompute = () => { clearTimeout(precomputeTimer); precomputeTimer = setTimeout(precomputeLetters, 600); };

/** A picture in the terminal first appears as letters made from its own pixels, then dissolves into the real image. */
async function animateImage(fig) {
  const img = fig.querySelector('.shot-img');
  const pre = fig.querySelector('.shot-ascii');
  if (!img || !pre || reduceMotion || state.transition === 'off') return;
  fig.classList.add('is-ascii');
  const fullReady = img.decode().catch(() => {});
  try {
    const index = Number(fig.dataset.open);
    const slug = gallery[index - 1]?.slug ?? fig.dataset.thumb;
    const early = img.complete && img.naturalWidth > 0 ? img : null;
    const box = img.getBoundingClientRect();
    const cols = asciiColumns(box.width);
    const family = getComputedStyle(pre).fontFamily;
    const source = asciiCache.has(asciiCache.key(slug, cols, false)) ? null : (early ?? (await smallPicture(fig.dataset.thumb)) ?? (await fullReady, img));
    const text = lettersFor(slug, source, cols, false);
    pre.textContent = text;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `100px ${family}`;
    const charWidth = (probe.measureText('M').width || 60) / 100;
    pre.style.fontSize = `${box.width / (cols * charWidth)}px`;
    pre.style.lineHeight = `${box.height / text.split('\n').length}px`;
    pre.hidden = false;
    await new Promise((r) => setTimeout(r, ASCII_HOLD_MS));
  } catch {
    // reading pixels failed: just show the real image
  }
  await fullReady;
  pre.hidden = true;
  fig.classList.remove('is-ascii');
  trans.revealEntry(fig.querySelector('.shot-open') ?? fig);
}

function startNewMirrors() {
  for (const fig of log.querySelectorAll('[data-mirror]:not([data-started])')) {
    fig.dataset.started = '';
    const t = ui[state.lang].mirror;
    createMirror(fig, { t, reduceMotion, focal: defaultFocal(finePointer), onCopied: (ok) => toast(ok ? t.copied : t.copyFailed) });
  }
}

function startNewImages() {
  for (const fig of log.querySelectorAll('[data-image]:not([data-started])')) {
    fig.dataset.started = '';
    animateImage(fig);
  }
}

function print(blocks, { reveal = true, top = false } = {}) {
  if (!blocks.length) return;
  log.insertAdjacentHTML('beforeend', renderEntry(blocks, { ps1: PS1 }));
  startNewFaces();
  startNewModels();
  startNewImages();
  startNewMirrors();
  if (blocks.some((b) => b.t === 'sheet')) schedulePrecompute();
  if (top) screen.scrollTop = 0;
  else screen.scrollTop = screen.scrollHeight;
  if (reveal && !blocks.some((b) => b.t === 'image')) trans.revealEntry(log.lastElementChild);
}

// ---- settings ----------------------------------------------------------------------------------------
function applyTheme(name, persist) {
  state.theme = THEMES.includes(name) ? name : 'auto';
  site?.setTheme(state.theme);
  syncTools();
  if (persist) store.set('theme', state.theme);
}

function labelTerminal() {
  const t = ui[state.lang];
  document.documentElement.lang = state.lang === 'zh' ? 'zh-Hant' : 'en';
  document.title = documentTitle(null, state.lang);
  document.querySelector('.skip').textContent = t.skip;
  term.setAttribute('aria-label', t.page.terminal.title);
  $('term-hint').textContent = t.page.terminal.hint;
  $('term-close').setAttribute('aria-label', t.page.terminal.close);
  $('term-close').title = t.page.terminal.close;
  cmdline.setAttribute('aria-label', t.page.terminal.open);
  input.setAttribute('aria-label', t.inputLabel);
  chips.setAttribute('aria-label', t.chipsLabel);
}

function applyLang(lang, persist) {
  state.lang = lang;
  labelTerminal();
  stopMirror();
  pageEl.innerHTML = renderPage(lang); // our own markup: every piece of text in it is escaped (src/page.js)
  mountSite({ quiet: true });
  lightbox.refresh();
  if (persist) store.set('lang', lang);
}

function applyEffects(effects) {
  for (const fx of effects) {
    if (fx.type === 'clear') { stopFaces(); stopMirror(); log.replaceChildren(); }
    else if (fx.type === 'mirror') stopMirror();
    else if (fx.type === 'theme') applyTheme(fx.value, true);
    else if (fx.type === 'lang') applyLang(fx.value, true);
    else if (fx.type === 'mode') { state.mode = fx.value; store.set('mode', fx.value); }
    else if (fx.type === 'transition') { state.transition = fx.value; store.set('transition', fx.value); }
    else if (fx.type === 'open') window.open(fx.url, '_blank', 'noopener,noreferrer');
  }
}

// ---- running commands ---------------------------------------------------------------------------------
const WIPE_EFFECTS = new Set(['theme', 'lang', 'clear']);
/** The part of the page a command is about; running it scrolls the page there, behind the drawer. */
const PAGE_FOR = { about: 'about', skills: 'about', ascii: 'about', projects: 'work', project: 'work', works: 'work', work: 'work', gallery: 'photos', photos: 'photos', view: 'photos', '3d': 'lab', mirror: 'mirror', contact: 'contact', home: 'main' };
const PAGES = new Set(['home', 'about', 'skills', 'projects', 'project', 'works', 'work', 'gallery', 'photos', 'view', 'mirror', 'contact', 'help']);

function run(line) {
  trans.settle();
  const trimmed = line.trim();
  if (!trimmed) { print([{ t: 'echo', v: '' }]); return; }
  if (state.history.at(-1) !== trimmed) state.history = [...state.history, trimmed].slice(-100);
  state.cursor = state.history.length;
  state.draft = '';

  const res = execute(trimmed, ctx());
  const { name } = resolveCommand(trimmed);
  const clearing = res.effects.some((e) => e.type === 'clear');
  const wiping = res.effects.some((e) => WIPE_EFFECTS.has(e.type));
  const apply = () => {
    applyEffects(res.effects.filter((e) => e.type !== 'open'));
    if (!clearing) {
      const asPage = PAGES.has(name) && state.mode === 'page';
      if (asPage) { stopFaces(); log.replaceChildren(); }
      print([{ t: 'echo', v: trimmed }, ...res.blocks], { reveal: !wiping, top: asPage });
    }
    const target = PAGE_FOR[name] && document.getElementById(PAGE_FOR[name]);
    if (target && !res.blocks.some((b) => b.t === 'err')) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };
  if (wiping) trans.run(apply, clearing ? { rect: screen.getBoundingClientRect() } : {});
  else apply();
  applyEffects(res.effects.filter((e) => e.type === 'open'));
}

// ---- boot: the first time the drawer opens ------------------------------------------------------------
const sleep = (ms) => (state.skip || reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

async function boot() {
  state.booted = true;
  state.booting = true;
  log.setAttribute('aria-live', 'off');
  for (const line of bootLines(ctx())) {
    log.insertAdjacentHTML('beforeend', `<div class="boot"><span class="ok">[ ok ]</span> ${esc(line)}</div>`);
    screen.scrollTop = screen.scrollHeight;
    await sleep(140);
  }
  print(welcomeBlocks(ctx()));
  log.setAttribute('aria-live', 'polite');
  state.booting = false;
  state.skip = false;
}

// ---- events -------------------------------------------------------------------------------------------------
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

// The ASCII faces "listen": typing makes their mouths move.
input.addEventListener('input', () => faces.forEach((f) => f.nudge()));

function onCommandClick(e) {
  const btn = e.target.closest('[data-cmd]');
  if (!btn || state.booting) return;
  run(btn.dataset.cmd);
  if (finePointer) input.focus({ preventScroll: true });
}
log.addEventListener('click', onCommandClick);
log.addEventListener('click', (e) => {
  const open = e.target.closest('.shot-open, .sheet-open');
  if (open) lightbox.open(Number(open.dataset.open) - 1, open);
});
chips.addEventListener('click', onCommandClick);

// Clicking empty terminal space focuses the prompt, unless the person is selecting text.
screen.addEventListener('click', (e) => {
  if (e.target.closest('a, button, input')) return;
  if (getSelection()?.toString()) return;
  input.focus({ preventScroll: true });
});

// Addresses: #photos, #about... are parts of the page (the browser scrolls there). Anything else the terminal knows
// (#projects, #help, #works/black-hole, #photos/looking-back) opens the terminal on that page.
function followHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || document.getElementById(id)) return;
  const line = lineForHash(location.hash);
  if (line && line !== 'home') openTerm({ focus: false, hurry: true }).then(() => run(line));
}
addEventListener('hashchange', followHash);

// ---- start ----------------------------------------------------------------------------------------------------
if (state.lang !== 'en') pageEl.innerHTML = renderPage(state.lang); // the static copy is English
labelTerminal();
mountSite();
cmdline.hidden = false;
document.documentElement.dataset.drawer = 'closed';
window.__siteReady = true; // tells src/guard.js the page is live
document.querySelector('.boot-fail')?.remove(); // it may have appeared on a very slow load
if (document.readyState === 'complete') schedulePrecompute();
else addEventListener('load', schedulePrecompute, { once: true });
followHash();
