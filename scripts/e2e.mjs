// End-to-end check in real headless Chrome via the DevTools Protocol.
// Zero dependencies. Needs Chrome/Chromium: set CHROME=/path/to/chrome if it
// is not at the macOS default. Screenshots land in .shots/ (gitignored).
//
//   npm run e2e

import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = 5199;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${SITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`);
  if (!ok) failures++;
};

// ---- processes ---------------------------------------------------------------
// Live reload is off here: the tests must see exactly what gets deployed.
const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), String(SITE_PORT)], { stdio: 'ignore', env: { ...process.env, LIVERELOAD: '0' } });
const profileDir = await mkdtemp(join(tmpdir(), 'site-e2e-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const cleanup = async () => { chrome.kill(); server.kill(); await rm(profileDir, { recursive: true, force: true }).catch(() => {}); };
process.on('exit', () => { chrome.kill(); server.kill(); });

async function until(fn, ms = 10000, label = 'condition') {
  const t = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t > ms) throw new Error(`timed out: ${label}`);
    await sleep(100);
  }
}

// ---- minimal CDP client --------------------------------------------------------
const targets = await until(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json().then((l) => l.find((t) => t.type === 'page')), 15000, 'chrome');
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
const logText = () => ev(`document.getElementById('log').innerText`);
const key = async (k, code, vk, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const typeText = async (s) => { await ev(`document.getElementById('cmd').focus()`); await send('Input.insertText', { text: s }); };
const enter = () => key('Enter', 'Enter', 13, '\r');
const shot = async (name, wait = 260) => { await sleep(wait); /* default: let transitions finish */ const r = await send('Page.captureScreenshot', { format: 'png' }); await mkdir(join(ROOT, '.shots'), { recursive: true }); await writeFile(join(ROOT, `.shots/${name}.png`), Buffer.from(r.data, 'base64')); };
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const load = async (url = BASE) => {
  // Keep the page "visible" and focused even if the machine's window is occluded: a hidden page does not load lazy images or media.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.bringToFront').catch(() => {});
  await send('Page.navigate', { url });
  await until(() => ev(`document.readyState === 'complete'`), 10000, 'load');
};
// Generous on purpose: a busy machine (a render running in another app) must not make the suite flaky.
const bootDone = () => until(() => ev(`document.getElementById('log').getAttribute('aria-live') === 'polite'`), 20000, 'boot');

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  // Pin the browser language so results do not depend on the machine's locale.
  const setLanguage = async (acceptLanguage) => send('Emulation.setUserAgentOverride', { userAgent: await ev('navigator.userAgent'), acceptLanguage });
  await setLanguage('en-US');

  // ---- desktop, real boot animation ---------------------------------------------
  console.log('desktop / boot');
  await viewport(1280, 800);
  await load();
  await sleep(300);
  await shot('01-boot-midway');
  await bootDone();
  check((await ev(`document.title`)).startsWith('Ezra Wu'), 'title set');
  check(await ev(`!document.getElementById('prompt').hidden && !document.getElementById('chips').hidden`), 'prompt and chips revealed by JS');
  check((await logText()).includes('Backend / Platform Engineer'), 'welcome rendered');
  check(await ev(`document.activeElement.id === 'cmd'`), 'input focused on desktop');
  await shot('02-welcome-dark');

  console.log('typing and keyboard');
  await typeText('projects'); await enter();
  await until(async () => (await logText()).includes('handoff-semantics'), 3000, 'projects output');
  check((await ev(`location.hash`)) === '#projects', 'URL hash updated to #projects');
  check((await ev(`document.getElementById('cmd').value`)) === '', 'input cleared after Enter');
  await typeText('ab'); await key('Tab', 'Tab', 9);
  check((await ev(`document.getElementById('cmd').value`)) === 'about ', 'Tab completes "ab" to "about "');
  await ev(`document.getElementById('cmd').value = ''`);
  await key('ArrowUp', 'ArrowUp', 38);
  check((await ev(`document.getElementById('cmd').value`)) === 'projects', 'ArrowUp recalls previous command');
  await ev(`document.getElementById('cmd').value = ''`);

  console.log('clickable commands');
  await ev(`document.querySelector('#log button.cmd[data-cmd="project 1"]').click()`);
  await until(async () => (await logText()).includes('outbox'), 3000, 'project 1 detail');
  check(true, 'clicking a command button runs it');
  await shot('03-project-detail');

  console.log('themes');
  for (const theme of ['light', 'amber', 'matrix', 'dark']) {
    await typeText(`theme ${theme}`); await enter();
    await until(() => ev(`document.documentElement.dataset.theme === '${theme}'`), 2000, theme);
    check(true, `theme ${theme} applied`);
    await shot(`04-theme-${theme}`);
  }
  check((await ev(`(() => { try { return localStorage.getItem('theme'); } catch { return 'n/a'; } })()`)) === 'dark', 'theme persisted');
  // Regression: the toolbar button must cycle through every theme in order (it used to always pick "light").
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await ev(`document.getElementById('btn-theme').click()`);
    await sleep(900); // let the page wipe finish
    seen.push(await ev(`document.documentElement.dataset.theme`));
  }
  check(JSON.stringify(seen) === JSON.stringify(['light', 'amber', 'matrix', 'dark', 'light']), 'theme button cycles dark > light > amber > matrix > dark', JSON.stringify(seen));
  await typeText('theme dark'); await enter(); await sleep(900);
  await typeText('theme'); await enter();
  await until(async () => (await logText()).includes('theme: dark'), 3000, 'theme reports the current theme');
  check(true, '`theme` with no argument reports the real current theme');

  console.log('language');
  await typeText('lang zh'); await enter();
  await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 2000, 'lang');
  check((await ev(`document.title`)).includes('後端'), 'document title localised');
  await typeText('about'); await enter();
  await until(async () => (await logText()).includes('我是軟體工程師'), 3000, 'zh about');
  check(true, 'zh content rendered');
  await shot('05-zh-about');
  await typeText('lang en'); await enter();

  console.log('misc commands');
  await typeText('echo <b>x</b>'); await enter();
  check(!(await ev(`!!document.querySelector('#log b')`)), 'echo does not inject HTML');
  await typeText('projcets'); await enter();
  check((await logText()).includes('Did you mean projects?'), 'typo suggestion shown');
  await ev(`document.getElementById('btn-theme').click()`);
  check(true, 'theme toolbar button works');
  await typeText('clear'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log .entry').length`)) === 0, 3000, 'clear');
  check(true, 'clear empties the log');
  // Regression: a command typed right after `clear` must not be wiped by the pending swap.
  await typeText('about'); await enter(); await typeText('clear'); await enter();
  await typeText('skills'); await enter(); await sleep(1200);
  const kept = await logText();
  check(kept.includes('What I fix') && !kept.includes('I am a software engineer'), 'a command right after clear survives the wipe');

  console.log('ASCII transitions');
  const overlays = () => ev(`document.querySelectorAll('#log .reveal-canvas').length`);
  const wipeVisible = () => ev(`!document.getElementById('wipe').hidden`);
  for (const effect of ['dissolve', 'scan', 'rain']) {
    await typeText(`transition ${effect}`); await enter();
    await until(async () => (await logText()).includes(`transition set to ${effect}`), 3000, `transition ${effect}`);
    await sleep(900);
    await typeText('skills'); await enter();
    await until(async () => (await overlays()) >= 1, 1500, `${effect} overlay appears`);
    check(true, `${effect}: overlay appears over the new output`);
    await shot(`08-transition-${effect}`, 150); // mid-animation
    check((await logText()).includes('What I fix'), `${effect}: real text is already in the DOM (screen readers, copy)`);
    await until(async () => (await overlays()) === 0, 3000, `${effect} overlay removed`);
    check(true, `${effect}: overlay removed when finished`);
  }
  await typeText('transition auto'); await enter(); await sleep(900);
  // Page wipe: theme change happens while covered, and the cover goes away afterwards.
  await typeText('theme amber'); await enter();
  await until(wipeVisible, 1000, 'wipe canvas shown');
  await shot('09-wipe-cover', 120);
  await until(async () => (await ev(`document.documentElement.dataset.theme`)) === 'amber', 2000, 'theme swapped during wipe');
  check(true, 'theme swaps during the page wipe');
  await until(async () => !(await wipeVisible()), 3000, 'wipe canvas hidden');
  check(true, 'wipe canvas hidden again afterwards');
  await typeText('clear'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log .entry').length`)) === 0, 3000, 'clear after wipe');
  check(true, 'clear works through the wipe');
  await typeText('transition off'); await enter(); await sleep(300);
  await typeText('about'); await enter(); await sleep(150);
  check((await overlays()) === 0, 'transition off: no overlay is created');
  await typeText('transition auto'); await enter();
  // Reduced motion: nothing animates at all.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load(BASE);
  await bootDone();
  await typeText('skills'); await enter(); await sleep(120);
  check((await overlays()) === 0, 'prefers-reduced-motion: no transition overlay');
  await typeText('theme light'); await enter(); await sleep(80);
  check(!(await wipeVisible()) && (await ev(`document.documentElement.dataset.theme`)) === 'light', 'prefers-reduced-motion: theme changes instantly, no wipe');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await ev(`localStorage.clear()`);

  console.log('reticle cursor');
  await load(BASE);
  await bootDone();
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
  check((await ev(`document.getElementById('reticle').dataset.mode`)) === 'minimal', 'the default reticle mode is the quiet one (no screen-wide hairlines)');
  check((await ev(`getComputedStyle(document.querySelector('#reticle .rt-h')).display`)) === 'none', 'default: no full-screen crosshair lines');
  check(await ev(`document.documentElement.classList.contains('rt-on')`), 'reticle is on by default for a fine pointer',
    await ev(`JSON.stringify({ fine: matchMedia('(hover: hover) and (pointer: fine)').matches, hover: matchMedia('(hover: hover)').matches, pointer: matchMedia('(pointer: fine)').matches, stored: (() => { try { return localStorage.getItem('cursor'); } catch (e) { return String(e); } })(), cls: document.documentElement.className, reticle: !!document.getElementById('reticle'), mode: document.getElementById('reticle')?.dataset.mode })`));
  check(!(await ev(`document.getElementById('reticle').classList.contains('rt-visible')`)), 'hidden until the pointer moves');
  await mouse('mouseMoved', 500, 300);
  await until(() => ev(`document.querySelector('#reticle .rt-xy')?.textContent === 'X 0500  Y 0300'`), 2000, 'coordinates shown');
  check(true, 'label shows the live pointer coordinates');
  check(await ev(`document.getElementById('reticle').classList.contains('rt-visible')`), 'reticle becomes visible');
  await sleep(500);
  const ringAt = await ev(`(() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#reticle .rt-ring')).transform); return [Math.round(m.m41), Math.round(m.m42)]; })()`);
  check(ringAt[0] === 500 && ringAt[1] === 300, 'the ring settles exactly on the pointer tip', JSON.stringify(ringAt));
  check((await ev(`getComputedStyle(document.querySelector('#reticle .rt-tgt')).display`)) === 'none', 'the "SEEK" line is hidden unless something is locked');
  check((await ev(`document.querySelector('#reticle .rt-ring').getBoundingClientRect().width`)) <= 22, 'the ring is small');
  await shot('10-reticle-free', 50);
  // At rest the coordinate label fades out (quieter), without being removed.
  await sleep(2300);
  check((await ev(`getComputedStyle(document.querySelector('#reticle .rt-label')).opacity`)) === '0', 'the coordinate label fades out when the pointer rests');
  await mouse('mouseMoved', 520, 310);
  await sleep(600);
  check(Number(await ev(`getComputedStyle(document.querySelector('#reticle .rt-label')).opacity`)) > 0.9, 'and comes back as soon as it moves');
  // Lock on to a dock item.
  const chip = await ev(`(() => { const r = document.querySelector('.dock-item[data-cmd="projects"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await mouse('mouseMoved', chip[0], chip[1]);
  await until(() => ev(`document.getElementById('reticle').classList.contains('rt-lock')`), 2000, 'lock on chip');
  check((await ev(`document.querySelector('#reticle .rt-tgt').textContent`)) === 'LOCK ▸ projects', 'locks on and names the target');
  check((await ev(`getComputedStyle(document.querySelector('.dock-item')).cursor`)).includes('cursor-hot.svg'), 'hot cursor over clickable things');
  await shot('11-reticle-lock', 450);
  await sleep(1800); // a locked target keeps its label even while the pointer rests
  check(Number(await ev(`getComputedStyle(document.querySelector('#reticle .rt-label')).opacity`)) > 0.9, 'a locked target keeps its label visible at rest');
  // Retro click: a stepped burst of glyphs plus a pixel box.
  await mouse('mousePressed', chip[0], chip[1], { button: 'left', clickCount: 1 });
  await sleep(60);
  check((await ev(`document.querySelectorAll('#reticle .rt-burst .rt-px').length`)) === 8 && (await ev(`document.querySelectorAll('#reticle .rt-burst .rt-box').length`)) === 1, 'click spawns 8 retro glyphs and one pixel box');
  const glyphs = await ev(`[...document.querySelectorAll('#reticle .rt-px')].map((e) => e.textContent).join('')`);
  check(glyphs.length === 8 && !/\w/.test(glyphs), 'the burst is made of retro symbols', glyphs);
  const timing = await ev(`getComputedStyle(document.querySelector('#reticle .rt-px')).animationTimingFunction`);
  check(/steps/.test(timing), 'the click animation is stepped (8-bit), not smooth', timing);
  await shot('15-retro-click', 120);
  await mouse('mouseReleased', chip[0], chip[1], { button: 'left', clickCount: 1 });
  await until(async () => (await ev(`document.querySelectorAll('#reticle .rt-burst').length`)) === 0, 2500, 'burst removed');
  check(true, 'the burst cleans itself up');
  // The label never leaves the viewport.
  await mouse('mouseMoved', 1270, 790);
  await sleep(100);
  const box = await ev(`(() => { const r = document.querySelector('#reticle .rt-label').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; })()`);
  check(box[0] >= 0 && box[1] >= 0 && box[2] <= box[4] && box[3] <= box[5], 'label stays inside the viewport at the corner', JSON.stringify(box));
  // Text input keeps the native I-beam.
  check((await ev(`getComputedStyle(document.getElementById('cmd')).cursor`)) === 'text', 'text input keeps the I-beam cursor');
  // Switching modes through the command
  await typeText('cursor full'); await enter();
  await until(() => ev(`document.getElementById('reticle').dataset.mode === 'full'`), 2000, 'full');
  check((await ev(`getComputedStyle(document.querySelector('#reticle .rt-h')).display`)) === 'block', '`cursor full` brings back the screen-wide crosshair');
  await typeText('cursor off'); await enter();
  await until(() => ev(`!document.documentElement.classList.contains('rt-on')`), 2000, 'off');
  check((await ev(`getComputedStyle(document.getElementById('reticle')).display`)) === 'none', 'cursor off hides the reticle and restores the native cursor');
  await typeText('cursor minimal'); await enter();
  await until(() => ev(`document.documentElement.classList.contains('rt-on')`), 2000, 'minimal');
  check((await ev(`localStorage.getItem('cursor')`)) === 'minimal', 'cursor mode is persisted');
  // Touch devices never get the reticle.
  await ev(`localStorage.clear()`);
  await viewport(390, 844, true);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await load('about:blank');
  await load(BASE);
  await bootDone();
  check(await ev(`matchMedia('(hover: none) and (pointer: coarse)').matches`), 'touch emulation is active (test sanity)');
  check(!(await ev(`document.documentElement.classList.contains('rt-on')`)), 'no custom cursor on touch devices');
  check((await ev(`getComputedStyle(document.getElementById('reticle')).display`)) === 'none', 'reticle layer is not rendered on touch devices');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);

  console.log('split screen: overview pane + terminal');
  await viewport(1440, 900);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  const disp = (sel) => ev(`getComputedStyle(document.querySelector('${sel}')).display`);
  check((await disp('#gui')) === 'flex' && (await disp('#tabs')) === 'none', 'at 1440px the overview pane is shown and the tabs are not');
  check((await ev(`document.getElementById('hud-left').getAttribute('aria-hidden')`)) === 'true', 'decorative telemetry is hidden from screen readers');
  check((await ev(`document.getElementById('gui').getAttribute('aria-label')`)).length > 2, 'the overview region is labelled');
  const geometry = await ev(`(() => { const g = document.getElementById('gui').getBoundingClientRect(); const w = document.getElementById('window').getBoundingClientRect(); return { guiRight: g.right, winLeft: w.left, guiW: g.width, winW: w.width, guiH: g.height, winH: w.height, scroll: document.documentElement.scrollWidth - innerWidth }; })()`);
  check(geometry.guiRight <= geometry.winLeft, 'the overview sits to the LEFT of the terminal, not overlapping it', JSON.stringify(geometry));
  check(geometry.guiW > 340 && geometry.winW > 500, 'both panes have a usable width', JSON.stringify([geometry.guiW, geometry.winW]));
  check(Math.abs(geometry.guiH - geometry.winH) <= 2, 'the two panes are the same height', JSON.stringify([geometry.guiH, geometry.winH]));
  check(geometry.scroll <= 0, 'no horizontal overflow');
  const counts = await ev(`({ projects: document.querySelectorAll('#gui [data-cmd^="project "]').length, works: document.querySelectorAll('#gui [data-cmd^="work "]').length, kinds: document.querySelectorAll('#gui .gkind').length, chips: document.querySelectorAll('#gui .gtools i').length, link: !!document.querySelector('#gui a.glink[rel="noopener noreferrer"]') })`);
  check(counts.projects === 4 && counts.works === 6 && counts.kinds === 6 && counts.chips >= 4 && counts.link, 'cards for 4 projects and 6 works, skills and a safe contact link', JSON.stringify(counts));
  await shot('12-split-screen', 700);

  // Cards drive the terminal, and the terminal lights up the card.
  await ev(`document.querySelector('#gui [data-cmd="project 2"]').click()`);
  await until(async () => (await logText()).includes('vox-proof'), 3000, 'card runs project 2');
  check((await ev(`document.querySelector('#gui [data-key="project 2"]').getAttribute('aria-current')`)) === 'true', 'clicking a card runs its command in the terminal and marks the card current');
  await typeText('work 3'); await enter();
  await until(async () => (await logText()).includes('permission'), 3000, 'typed work 3');
  check((await ev(`document.querySelector('#gui [data-key="work 3"]').getAttribute('aria-current')`)) === 'true' && (await ev(`document.querySelectorAll('#gui [aria-current]').length`)) === 1, 'typing a command in the terminal highlights the matching card (and only one)');
  await typeText('project black-hole'); await enter();
  await typeText('project echlub'); await enter();
  await sleep(150);
  check((await ev(`document.querySelector('#gui [data-key="project 3"]')?.getAttribute('aria-current')`)) === 'true', 'slug commands resolve to their card too');
  await typeText('skills'); await enter();
  await sleep(150);
  check((await ev(`document.querySelectorAll('#gui [aria-current]').length`)) === 0, 'a command with no card clears the highlight');
  check(await ev(`(() => { const c = document.querySelector('#gui .gbtn'); c.focus(); return document.activeElement === c; })()`), 'cards are keyboard focusable');
  await ev(`document.querySelector('#gui [data-cmd="work 1"]').click()`);
  await until(async () => (await logText()).includes('physics equations'), 3000, 'work 1 card');
  check(true, 'work cards run their command');

  console.log('telemetry inside the overview');
  const clock1 = await ev(`document.querySelector('[data-h="clock"]').textContent`);
  const up1 = await ev(`document.querySelector('[data-h="up"]').textContent`);
  await sleep(1300);
  const clock2 = await ev(`document.querySelector('[data-h="clock"]').textContent`);
  const up2 = await ev(`document.querySelector('[data-h="up"]').textContent`);
  check(/^\d\d:\d\d:\d\d$/.test(clock2) && clock1 !== clock2, 'the clock ticks', `${clock1} -> ${clock2}`);
  check(up1 !== up2, 'uptime advances', `${up1} -> ${up2}`);
  check((await ev(`document.querySelector('[data-h="vp"]').textContent`)).startsWith('1440×900'), 'viewport readout is correct');
  // NB: inside a template literal "\\d" must be doubled, or it silently becomes the letter "d".
  await until(() => ev(`/^\\d+$/.test(document.querySelector('[data-h="fps"]').textContent)`), 4000, 'fps measured');
  check(Number(await ev(`document.querySelector('[data-h="fps"]').textContent`)) > 0 && (await ev(`document.querySelector('[data-h="spark"]').getAttribute('points')`)).length > 0, 'frame rate is measured and the sparkline is drawn');
  await mouse('mouseMoved', 700, 400);
  await until(() => ev(`document.querySelector('[data-h="px"]').textContent === '0700'`), 2000, 'pointer x');
  check((await ev(`document.querySelector('[data-h="py"]').textContent`)) === '0400', 'the pointer panel shows the live position');
  check((await ev(`document.querySelector('#hud-right .recent-btn')?.dataset.cmd`)) === 'work 1', 'the recent list shows the newest command first');
  await ev(`[...document.querySelectorAll('#hud-right .recent-btn')].find(b => b.dataset.cmd === 'project 2').click()`);
  await sleep(150);
  check((await ev(`[...document.querySelectorAll('#log .typed')].filter(e => e.textContent === 'project 2').length`)) >= 2, 'recent commands can be re-run with one click');

  console.log('language and theme reach the overview');
  await typeText('lang zh'); await enter();
  await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 3000, 'zh');
  await sleep(900);
  check((await ev(`document.getElementById('gui').innerText`)).includes('黑洞光線渲染器') && (await ev(`document.getElementById('gui').getAttribute('aria-label')`)) === '概覽', 'the overview switches to Traditional Chinese');
  check((await ev(`document.querySelector('#tabs [data-view="gui"]').textContent`)) === '概覽', 'tab labels follow the language');
  await typeText('lang en'); await enter();
  await sleep(900);
  await typeText('theme matrix'); await enter();
  await until(() => ev(`document.documentElement.dataset.theme === 'matrix'`), 3000, 'matrix');
  await sleep(900);
  check((await ev(`document.querySelector('[data-h="theme"]').textContent`)) === 'matrix', 'the telemetry shows the real theme');
  check((await ev(`getComputedStyle(document.getElementById('window'), '::after').content`)) !== 'none', 'matrix theme draws CRT scanlines');
  await shot('13-split-matrix', 300);
  await typeText('theme dark'); await enter();
  await sleep(900);

  console.log('hide / show the overview');
  await typeText('hud off'); await enter();
  await until(async () => (await disp('#gui')) === 'none', 3000, 'hud off');
  check((await ev(`Math.round(document.getElementById('window').getBoundingClientRect().width)`)) === 980, 'with the overview hidden the terminal returns to its normal width');
  check((await ev(`localStorage.getItem('hud')`)) === 'off', 'the choice is persisted');
  await typeText('gui on'); await enter();
  await until(async () => (await disp('#gui')) === 'flex', 3000, 'gui on');
  check(true, '`gui on` brings the overview back (alias of `hud`)');

  console.log('narrow screens: tabs');
  await viewport(820, 1000);
  await sleep(300);
  check((await disp('#tabs')) === 'flex' && (await disp('#gui')) === 'none' && (await disp('#window')) === 'flex', 'below 1000px the terminal is shown first, with Overview / Terminal tabs');
  check((await ev(`document.querySelector('#tabs [data-view="term"]').getAttribute('aria-pressed')`)) === 'true', 'the terminal tab is marked pressed');
  await ev(`document.querySelector('#tabs [data-view="gui"]').click()`);
  await sleep(300);
  check((await disp('#gui')) === 'flex' && (await disp('#window')) === 'none', 'the Overview tab shows the cards and hides the terminal');
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'no horizontal overflow on the Overview tab');
  await until(() => ev(`document.querySelector('[data-h="clock"]').textContent !== '--:--:--'`), 3000, 'telemetry runs on the Overview tab');
  check(true, 'the telemetry also runs on the Overview tab');
  await ev(`document.querySelector('#gui [data-cmd="project 4"]').click()`);
  await sleep(500);
  check((await disp('#window')) === 'flex' && (await disp('#gui')) === 'none' && (await logText()).includes('echlub-demo'), 'on a narrow screen, tapping a card switches to the terminal and shows the result');

  console.log('phone');
  await viewport(390, 844, true);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'phone: no horizontal overflow');
  const tabBox = await ev(`[...document.querySelectorAll('#tabs .tab')].filter((b) => b.getClientRects().length > 0).map((b) => b.getBoundingClientRect().height)`); // visible tabs only (the ✉ one exists only when an email is set)
  check(tabBox.every((h) => h >= 44), 'phone: tabs are touch-sized', JSON.stringify(tabBox));
  await ev(`document.querySelector('#tabs [data-view="gui"]').click()`);
  await sleep(500);
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'phone: no horizontal overflow on the Overview tab');
  const tooSmall = await ev(`[...document.querySelectorAll('#gui .gbtn')].filter((b) => b.getBoundingClientRect().height < 44).length`);
  check(tooSmall === 0, 'phone: every overview card is at least 44px tall', String(tooSmall));
  await shot('20-overview-phone', 500);
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);

  console.log('ASCII 3D');
  await viewport(1280, 800);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  const modelText = (i = 0) => ev(`document.querySelectorAll('#log pre[data-ascii3d]')[${i}]?.textContent ?? ''`);
  await typeText('3d'); await enter();
  await until(async () => (await modelText()).length > 100, 4000, '3d model drawn');
  const m1 = await modelText();
  await sleep(450);
  const m2 = await modelText();
  check(m1 !== m2, 'the 3D model spins by itself');
  check((await ev(`document.querySelector('#log pre[data-ascii3d]').getAttribute('role')`)) === 'img' && (await ev(`document.querySelector('#log pre[data-ascii3d]').getAttribute('aria-label')`)).length > 5, 'the model is exposed to screen readers as one labelled image');
  check(m2.split('\n').length >= 20 && m2.split('\n').length <= 26, 'the model fits its grid', String(m2.split('\n').length));
  const widest = await ev(`(() => { const pre = document.querySelector('#log pre[data-ascii3d]'); return [pre.scrollWidth, pre.clientWidth]; })()`);
  check(widest[0] <= widest[1] + 1, 'the model fits the terminal width without scrolling', JSON.stringify(widest));
  await mouse('mouseMoved', 1100, 120);
  await sleep(500);
  const m3 = await modelText();
  check(m3 !== m2, 'the model keeps moving while the pointer steers it');
  await shot('16-ascii3d-donut', 50);
  // A newer model replaces the old one as the animated one; the old one freezes.
  await typeText('cube'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log pre[data-ascii3d]').length`)) === 2, 3000, 'second model');
  check((await ev(`document.querySelectorAll('#log pre[data-ascii3d]')[1].dataset.shape`)) === 'cube', 'the `cube` shortcut draws a cube');
  const old1 = await modelText(0);
  const new1 = await modelText(1);
  await sleep(450);
  check(old1 === (await modelText(0)), 'the previous model stops animating (only the newest runs)');
  check(new1 !== (await modelText(1)), 'the newest model is the one that spins');
  await shot('17-ascii3d-cube', 50);
  await typeText('3d teapot'); await enter();
  await until(async () => (await logText()).includes('unknown shape'), 3000, 'bad shape');
  check(true, 'an unknown shape gives a clear error');
  await typeText('clear'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log .entry').length`)) === 0, 3000, 'clear');
  check(true, 'clear stops and removes the models');
  // Reduced motion: one static frame, no animation.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await typeText('3d'); await enter();
  await until(async () => (await modelText()).length > 100, 4000, 'static model');
  const s1 = await modelText();
  await sleep(600);
  check(s1 === (await modelText()), 'prefers-reduced-motion: the model is a still picture');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await ev(`localStorage.clear()`);

  console.log('deep link');
  await load(`${BASE}#skills`);
  await bootDone();
  check((await logText()).includes('What I fix'), '#skills deep link runs the command');

  console.log('mobile');
  await viewport(390, 844, true);
  await ev(`localStorage.clear()`);
  await load('about:blank'); // a hash-only change would not reload the page
  await load(`${BASE}#projects`);
  await bootDone();
  const overflow = await ev(`document.documentElement.scrollWidth - innerWidth`);
  check(overflow <= 0, 'no horizontal page overflow at 390px', `scrollWidth - innerWidth = ${overflow}`);
  const smallTargets = await ev(`[...document.querySelectorAll('.chip,.tool')].filter(e => e.getClientRects().length > 0 && e.getBoundingClientRect().height < 36).length`); // visible ones only
  check(smallTargets === 0, 'chips and toolbar buttons are touch-sized');
  await shot('06-mobile-projects');

  console.log('contrast (WCAG AA 4.5:1)');
  await viewport(1280, 800);
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const theme of ['dark', 'light', 'amber', 'matrix']) {
    await ev(`document.documentElement.dataset.theme = '${theme}'`);
    const colors = await ev(`(() => { const s = getComputedStyle(document.documentElement); const probe = document.createElement('i'); document.body.append(probe); const get = (v) => { probe.style.color = s.getPropertyValue(v); return getComputedStyle(probe).color; }; const out = Object.fromEntries(['--panel','--bar','--fg','--dim','--accent','--accent2','--link','--err'].map(v => [v, get(v)])); probe.remove(); return out; })()`);
    const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    for (const fgVar of ['--fg', '--dim', '--accent', '--accent2', '--link', '--err']) {
      for (const bgVar of ['--panel', '--bar']) {
        const r = ratio(rgb(colors[fgVar]), rgb(colors[bgVar]));
        check(r >= 4.5, `${theme}: ${fgVar} on ${bgVar} = ${r.toFixed(2)}`);
      }
    }
  }

  console.log('no JavaScript');
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await load(BASE);
  const noJs = await ev(`({ text: document.getElementById('log').innerText, promptHidden: document.getElementById('prompt').hidden, chipsHidden: document.getElementById('chips').hidden, deadButtons: document.querySelectorAll('#log button').length })`);
  check(noJs.text.includes('handoff-semantics') && noJs.text.includes('PostgreSQL'), 'content is readable without JS');
  check(noJs.text.includes('Black hole renderer') && noJs.text.includes('Research and thinking'), 'the works are readable without JS too');
  check(noJs.promptHidden && noJs.chipsHidden, 'inert prompt and chips stay hidden without JS');
  check(noJs.deadButtons === 0, 'no dead buttons without JS');
  await shot('07-no-js');
  await send('Emulation.setScriptExecutionDisabled', { value: false });

  console.log('pictures: ASCII first, then the real image');
  await viewport(1440, 900);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  const fig = (sel) => ev(`(() => { const e = document.querySelector('#log figure.shot ${sel}'); return e ? e.textContent : null; })()`);
  await typeText('view 1'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot')`), 3000, 'figure rendered');
  const before = await ev(`(() => { const i = document.querySelector('#log .shot-img'); const r = i.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), attrW: i.getAttribute('width'), attrH: i.getAttribute('height'), alt: i.alt }; })()`);
  check(before.attrW === '1024' && before.attrH === '1024' && before.alt.length > 20 && before.h > 100, 'the image reserves its space (real width/height) and has alt text, so the page does not jump', JSON.stringify(before));
  await until(() => ev(`(() => { const p = document.querySelector('#log .shot-ascii'); return !!p && !p.hidden && p.textContent.length > 200; })()`), 3000, 'ascii phase');
  const ascii = await ev(`(() => { const p = document.querySelector('#log .shot-ascii'); const i = document.querySelector('#log .shot-img'); const pr = p.getBoundingClientRect(); const ir = i.getBoundingClientRect(); return { text: p.textContent, lines: p.textContent.split('\\n').length, imgVisibility: getComputedStyle(i).visibility, sameBox: Math.abs(pr.width - ir.width) <= 2 && Math.abs(pr.height - ir.height) <= 2, boxes: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height), Math.round(ir.left), Math.round(ir.top), Math.round(ir.width), Math.round(ir.height)], hiddenFromAT: p.getAttribute('aria-hidden') === 'true' }; })()`);
  check(/^[ .:\-=+*#%@\n]+$/.test(ascii.text) && ascii.lines >= 20, 'the picture first appears drawn in characters (made from its own pixels)', `${ascii.lines} lines`);
  check(ascii.imgVisibility === 'hidden' && ascii.sameBox, 'while the ASCII shows, the real image is hidden and the ASCII fills exactly its box', JSON.stringify({ v: ascii.imgVisibility, same: ascii.sameBox, boxes: ascii.boxes }));
  check(ascii.hiddenFromAT, 'the ASCII version is hidden from screen readers (the image has the alt text)');
  await shot('21-image-ascii', 80);
  await until(() => ev(`document.querySelector('#log .shot-ascii').hidden`), 5000, 'ascii phase ends');
  await until(() => ev(`!!document.querySelector('#log .reveal-canvas')`), 1500, 'dissolve canvas appears');
  const dis = await ev(`(() => { const c = document.querySelector('#log .reveal-canvas'); const i = document.querySelector('#log .shot-img'); const e = c.closest('.entry'); const cr = c.getBoundingClientRect(); const ir = i.getBoundingClientRect(); const er = e.getBoundingClientRect(); return { parent: c.parentElement.className, dx: Math.abs(cr.left - ir.left), dy: Math.abs(cr.top - ir.top), dw: Math.abs(cr.width - ir.width), dh: Math.abs(cr.height - ir.height), entryH: Math.round(er.height), canvasH: Math.round(cr.height) }; })()`);
  check(dis.parent === 'shot-open' && dis.dx <= 1.5 && dis.dy <= 1.5 && dis.dw <= 1.5 && dis.dh <= 1.5 && dis.canvasH < dis.entryH, 'the dissolve covers exactly the picture (not the whole entry or the page)', JSON.stringify(dis));
  await shot('21-image-dissolve', 0);
  const after = await ev(`(() => { const i = document.querySelector('#log .shot-img'); return { visible: getComputedStyle(i).visibility === 'visible', loaded: i.complete && i.naturalWidth === 1024, h: Math.round(i.getBoundingClientRect().height) }; })()`);
  check(after.visible && after.loaded, 'then it dissolves into the real image, fully loaded', JSON.stringify(after));
  check(after.h === before.h, 'the layout did not shift between the ASCII and the real image', `${before.h} -> ${after.h}`);
  await shot('22-image-real', 1300);

  console.log('floating picture windows (wide screens with a mouse)');
  const opener = `document.querySelector('#log .shot-open')`;
  const wins = () => ev(`document.querySelectorAll('#windows .win').length`);
  const winProp = (n, expr) => ev(`(() => { const w = document.querySelectorAll('#windows .win')[${n}]; return w ? (${expr}) : null; })()`);
  const barCentre = (n) => winProp(n, `(() => { const r = w.querySelector('.wtitle').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const dragBy = async (n, dx, dy) => {
    const [x, y] = await barCentre(n);
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', x + (dx * i) / 6, y + (dy * i) / 6, { button: 'left', buttons: 1 });
    await mouse('mouseReleased', x + dx, y + dy, { button: 'left', buttons: 0, clickCount: 1 });
  };
  await ev(`${opener}.focus(); ${opener}.click()`);
  await ev(`${opener}.click()`); // clicking the same picture again must not open a duplicate
  await until(async () => (await wins()) >= 1, 3000, 'window opens');
  await sleep(300);
  check((await wins()) === 1, 'opening the same picture twice reuses its window instead of stacking a duplicate');
  const w1 = await winProp(0, `({ role: w.getAttribute('role'), modal: w.getAttribute('aria-modal'), labelled: document.getElementById(w.getAttribute('aria-labelledby'))?.textContent, meta: w.querySelector('.wmeta').textContent, img: w.querySelector('.wstage img')?.getAttribute('src'), alt: w.querySelector('.wstage img')?.alt.length, cap: w.querySelector('.wcap').textContent, focused: document.activeElement === w, rect: (() => { const r = w.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })() })`);
  check(!(await ev(`!!document.querySelector('dialog.viewer[open]')`)), 'on a wide screen the picture does NOT open the full-page modal');
  check(w1.role === 'dialog' && w1.modal === 'false' && w1.labelled === 'black-hole-presentation.jpg', 'the window is a labelled, non-modal dialog titled with the file name', JSON.stringify(w1));
  check(w1.meta === '1024×1024 · JPG' && w1.img.endsWith('black-hole-presentation.jpg') && w1.alt > 20 && w1.cap.includes('A black hole, prepared for viewing'), 'it shows the size, the image with alt text and the caption');
  check(w1.focused, 'focus moves into the window');
  check(w1.rect[0] >= 0 && w1.rect[1] >= 0 && w1.rect[2] <= 1440 && w1.rect[3] <= 900, 'it opens fully inside the screen');
  await typeText('echo still usable'); await enter();
  await until(async () => (await logText()).includes('still usable'), 3000, 'terminal works');
  check(true, 'the terminal behind the window keeps working (the window is not modal)');
  await shot('23-window-one', 500);

  // A second and third window stack and cascade.
  await typeText('view 2'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log figure.shot').length`)) >= 2, 3000, 'second figure');
  await ev(`[...document.querySelectorAll('#log .shot-open')].at(-1).click()`);
  await until(async () => (await wins()) === 2, 3000, 'second window');
  const pos = await ev(`[...document.querySelectorAll('#windows .win')].map((w) => { const r = w.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), z: Number(getComputedStyle(w).zIndex), front: w.classList.contains('is-front') }; })`);
  check(pos[1].l > pos[0].l && pos[1].t > pos[0].t, 'a new window cascades down and to the right of the previous one', JSON.stringify(pos));
  check(pos[1].z > pos[0].z && pos[1].front && !pos[0].front, 'the newest window is in front', JSON.stringify(pos));

  // Click an older window: it comes to the front.
  const [bx, by] = await barCentre(0);
  await mouse('mouseMoved', bx, by);
  await mouse('mousePressed', bx, by, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', bx, by, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
  check((await winProp(0, `w.classList.contains('is-front')`)) && !(await winProp(1, `w.classList.contains('is-front')`)) && (await winProp(0, `Number(getComputedStyle(w).zIndex)`)) > (await winProp(1, `Number(getComputedStyle(w).zIndex)`)), 'clicking a window brings it to the front');

  // Drag by the title bar.
  const dragFrom = await winProp(0, `(() => { const r = w.getBoundingClientRect(); return [r.left, r.top]; })()`);
  await dragBy(0, 120, 80);
  const dragTo = await winProp(0, `(() => { const r = w.getBoundingClientRect(); return [r.left, r.top]; })()`);
  check(Math.abs(dragTo[0] - dragFrom[0] - 120) <= 2 && Math.abs(dragTo[1] - dragFrom[1] - 80) <= 2, 'dragging the title bar moves the window with the pointer', JSON.stringify({ dragFrom, dragTo }));
  await dragBy(0, 4000, 4000);
  const edge = await winProp(0, `(() => { const r = w.getBoundingClientRect(); return [r.right, r.bottom]; })()`);
  check(edge[0] <= 1440 && edge[1] <= 900 && edge[0] >= 1400, 'a window dragged far away is held inside the screen', JSON.stringify(edge));
  await dragBy(0, -4000, -4000);
  const corner = await winProp(0, `(() => { const r = w.getBoundingClientRect(); return [r.left, r.top]; })()`);
  check(corner[0] >= 0 && corner[1] >= 0 && corner[0] <= 16 && corner[1] <= 16, 'and also at the top-left corner', JSON.stringify(corner));
  check(!(await ev(`document.querySelector('#windows .win.is-dragging')`)), 'the dragging state is cleared when the button is released');

  // Keyboard alternative to dragging: Alt + arrows.
  await ev(`document.querySelectorAll('#windows .win')[1].focus()`);
  const k0 = await winProp(1, `w.getBoundingClientRect().left`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 });
  const k1 = await winProp(1, `w.getBoundingClientRect().left`);
  check(Math.round(k1 - k0) === 24, 'Alt+→ moves the focused window by one step (a keyboard alternative to dragging)', `${k0} -> ${k1}`);

  // ← / → switch pictures inside a window; the title (file name) follows.
  const t0 = await winProp(1, `w.querySelector('.wtitle').textContent`);
  await key('ArrowRight', 'ArrowRight', 39);
  await until(async () => (await winProp(1, `w.querySelector('.wtitle').textContent`)) !== t0, 2000, 'next picture in window');
  check(true, '→ switches the picture shown in the focused window');
  await key('ArrowLeft', 'ArrowLeft', 37);
  await until(async () => (await winProp(1, `w.querySelector('.wtitle').textContent`)) === t0, 2000, 'back');

  // Esc closes the front window and focus goes back to what opened it.
  await ev(`document.querySelectorAll('#windows .win')[1].focus()`);
  await key('Escape', 'Escape', 27);
  await until(async () => (await wins()) === 1, 2000, 'esc closes');
  check(true, 'Esc closes the focused window');
  check(await ev(`document.activeElement?.classList.contains('shot-open') || document.activeElement?.classList.contains('win')`), 'focus goes back to the picture that opened it (or the window beneath)');
  await ev(`document.querySelector('#windows .wclose').click()`);
  await until(async () => (await wins()) === 0, 2000, 'close button');
  check(true, 'the ✕ button closes a window');

  // All four pictures can be open together; each is its own window (the cap of six is covered by unit tests).
  for (let i = 1; i <= 3; i++) { await typeText(`view ${i}`); await enter(); }
  await until(async () => (await ev(`document.querySelectorAll('#log figure.shot').length`)) >= 4, 4000, 'figures');
  await ev(`[...document.querySelectorAll('#log figure.shot')].slice(-4).forEach((f) => f.querySelector('.shot-open').click())`);
  await sleep(400);
  const many = await ev(`[...document.querySelectorAll('#windows .win')].map((w) => w.dataset.index).sort()`);
  check(many.length >= 3 && many.length <= 4 && new Set(many).size === many.length, 'several pictures can be open at once, one window each', JSON.stringify(many));
  await shot('23-windows-many', 600);
  // (Esc is sent once per open window: a stray Esc with nothing to close makes headless Chrome abandon media loads.)
  for (let n = await wins(); n > 0; n--) { await ev(`document.querySelector('#windows .win:last-child').focus()`); await key('Escape', 'Escape', 27); }
  check((await wins()) === 0, 'Esc closes them all, one at a time');

  // Video in a window: plays, and stops when closed.
  await typeText('view 4'); await enter();
  await until(async () => (await ev(`document.querySelectorAll('#log figure[data-kind="video"]').length`)) >= 1, 3000, 'video figure');
  await ev(`document.querySelector('#log figure[data-kind="video"] .shot-open').click()`);
  await until(async () => (await ev(`!!document.querySelector('#windows .win video')`)), 3000, 'video window');
  const vid = await ev(`(() => { const v = document.querySelector('#windows .win video'); return { src: v.getAttribute('src'), controls: v.controls, muted: v.muted, label: v.getAttribute('aria-label')?.length, title: document.querySelector('#windows .win .wtitle').textContent, meta: document.querySelector('#windows .win .wmeta').textContent }; })()`);
  check(vid.src.endsWith('black-hole-evolution.mp4') && vid.controls && vid.muted && vid.label > 20 && vid.title === 'black-hole-evolution.mp4' && vid.meta === '640×640 · MP4', 'a video opens in a window with controls, muted, a text description and its file name', JSON.stringify(vid));
  await until(() => ev(`document.querySelector('#windows .win video').readyState >= 1`), 15000, 'video metadata');
  check((await ev(`document.querySelector('#windows .win video').duration`)) > 20, 'the video loads');
  await ev(`document.querySelector('#windows .win').focus()`);
  await key('Escape', 'Escape', 27);
  await until(async () => (await wins()) === 0, 2000, 'video window closed');
  check(!(await ev(`!!document.querySelector('#windows video')`)), 'closing the window removes the video (no hidden playback)');

  // Language reaches open windows.
  await ev(`${opener}.click()`);
  await until(async () => (await wins()) === 1, 3000, 'reopen');
  await typeText('lang zh'); await enter();
  await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 3000, 'zh');
  await sleep(900);
  check((await winProp(0, `w.querySelector('.wclose').getAttribute('aria-label')`)).startsWith('關閉') && (await winProp(0, `w.querySelector('.wcap').textContent`)).includes('黑洞'), 'an open window switches to Traditional Chinese with the page');
  await typeText('lang en'); await enter();
  await sleep(900);
  await ev(`document.querySelector('#windows .win')?.focus()`);
  await key('Escape', 'Escape', 27);

  console.log('modal viewer (narrow screens keep the dialog)');
  await viewport(820, 1000);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await typeText('view 1'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot')`), 3000, 'figure (narrow)');
  await sleep(1800);
  await ev(`${opener}.focus(); ${opener}.click()`);
  await until(() => ev(`!!document.querySelector('dialog.viewer[open]')`), 3000, 'narrow viewer opens');
  check((await wins()) === 0, 'below 1000px pictures open in the modal dialog, not in a floating window');
  const vw = await ev(`(() => { const d = document.querySelector('dialog.viewer'); return { title: d.querySelector('.vtitle').textContent, count: d.querySelector('.vcount').textContent, img: d.querySelector('.vstage img')?.getAttribute('src'), labelledby: d.getAttribute('aria-labelledby'), titleId: d.querySelector('.vtitle').id, modal: d.matches(':modal'), alt: d.querySelector('.vstage img')?.alt.length }; })()`);
  check(vw.title === 'A black hole, prepared for viewing' && vw.count === '1 / 16' && vw.img.endsWith('black-hole-presentation.jpg') && vw.alt > 20, 'the dialog shows the title, counter, image and alt text', JSON.stringify(vw));
  check(vw.labelledby === vw.titleId && vw.modal, 'and it is a labelled modal dialog');
  await key('ArrowRight', 'ArrowRight', 39);
  await until(() => ev(`document.querySelector('dialog.viewer .vcount').textContent === '2 / 16'`), 2000, 'next');
  await key('ArrowLeft', 'ArrowLeft', 37);
  await key('ArrowLeft', 'ArrowLeft', 37);
  await until(() => ev(`document.querySelector('dialog.viewer .vcount').textContent === '16 / 16'`), 2000, 'wrap');
  check(!!(await ev(`document.querySelector('dialog.viewer .vstage img')`)) && !(await ev(`document.querySelector('dialog.viewer .vstage video')`)), '← from the first wraps around to the last picture');
  for (let i = 0; i < 4; i++) await key('ArrowRight', 'ArrowRight', 39);
  await until(() => ev(`document.querySelector('dialog.viewer .vcount').textContent === '4 / 16'`), 2000, 'to the video');
  check(!!(await ev(`document.querySelector('dialog.viewer .vstage video')`)), '→ from the last wraps to the first, and the fourth item is the video');
  await until(() => ev(`document.querySelector('dialog.viewer video').readyState >= 1`), 30000, 'video metadata');
  check((await ev(`document.querySelector('dialog.viewer video').duration`)) > 20, 'the video loads (the dev server answers Range requests, which Safari requires)');
  await key('Escape', 'Escape', 27);
  await until(() => ev(`!document.querySelector('dialog.viewer[open]')`), 2000, 'closed');
  await until(() => ev(`document.activeElement === ${opener} && !document.querySelector('dialog.viewer video')`), 2000, 'cleanup after close').catch(() => {}); // the close event fires a tick after [open] clears
  check(!(await ev(`!!document.querySelector('dialog.viewer video')`)) && (await ev(`document.activeElement === ${opener}`)), 'Esc closes it, removes the video, and focus returns to the picture', await ev(`JSON.stringify({ video: !!document.querySelector('dialog.viewer video'), active: document.activeElement?.className + '|' + document.activeElement?.tagName, openerConnected: !!${opener} })`));
  await ev(`${opener}.click()`);
  await until(() => ev(`!!document.querySelector('dialog.viewer[open]')`), 3000, 'reopen');
  await ev(`document.querySelector('dialog.viewer').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await until(() => ev(`!document.querySelector('dialog.viewer[open]')`), 2000, 'backdrop close');
  check(true, 'clicking outside the dialog closes it');
  // (From the test side: the page's own CSP, rightly, does not allow fetch().)
  const rangeRes = await fetch(`${BASE}assets/gallery/black-hole-evolution.mp4`, { headers: { Range: 'bytes=0-99' } });
  const rangeTest = { status: rangeRes.status, cr: rangeRes.headers.get('content-range'), type: rangeRes.headers.get('content-type'), ar: rangeRes.headers.get('accept-ranges') };
  const badRange = await fetch(`${BASE}assets/gallery/black-hole-evolution.mp4`, { headers: { Range: 'bytes=99999999-' } });
  check(badRange.status === 416, 'an impossible Range is answered with 416');
  check(rangeTest.status === 206 && /^bytes 0-99\//.test(rangeTest.cr) && rangeTest.type === 'video/mp4' && rangeTest.ar === 'bytes', 'the server answers Range requests with 206 and the right headers', JSON.stringify(rangeTest));
  await viewport(1440, 900);
  await load('about:blank');
  await load(BASE);
  await bootDone();

  console.log('typography: large display name');
  const nameInfo = () => ev(`(() => { const n = document.querySelector('#gui .gname'); const cs = getComputedStyle(n); const r = n.getBoundingClientRect(); return { px: parseFloat(cs.fontSize), family: cs.fontFamily.slice(0, 40), weight: cs.fontWeight, w: Math.round(r.width), sw: n.scrollWidth, cw: n.clientWidth, doc: document.documentElement.scrollWidth, vw: innerWidth, lines: Math.round(r.height / parseFloat(cs.lineHeight)) }; })()`);
  const big = await nameInfo();
  check(big.px >= 56 && big.px <= 68.5, 'at 1440px the name is display-sized (56 to 68px)', JSON.stringify(big));
  check(/sans|system-ui|Helvetica|Segoe/i.test(big.family) && !/mono/i.test(big.family) && Number(big.weight) >= 600, 'the name uses the sans display face, bold', JSON.stringify(big));
  check(big.sw <= big.cw + 1 && big.doc <= big.vw, 'the big name does not overflow its card or the page');
  check((await ev(`parseFloat(getComputedStyle(document.querySelector('#gui .grole')).fontSize)`)) > 15.5, 'the role line is a step above body text');
  check((await ev(`parseFloat(getComputedStyle(document.getElementById('cmd')).fontSize)`)) >= 15, 'the terminal itself stays in monospace body size');
  await ev(`document.querySelector('#gui').scrollTo(0, 0)`);
  await shot('24-typography-1440', 400);
  for (const [theme, label] of [['light', 'light'], ['amber', 'amber'], ['matrix', 'matrix'], ['dark', 'dark']]) {
    await typeText(`theme ${theme}`); await enter(); await sleep(700);
    const c = await ev(`(() => { const n = document.querySelector('#gui .gname'); return { color: getComputedStyle(n).color, bg: getComputedStyle(document.querySelector('#gui .gprofile')).backgroundColor }; })()`);
    check(c.color !== c.bg, `the name is visible in the ${label} theme`, JSON.stringify(c));
  }
  await typeText('lang zh'); await enter(); await sleep(900);
  const zhName = await nameInfo();
  check(zhName.sw <= zhName.cw + 1 && zhName.doc <= zhName.vw && zhName.px === big.px, 'switching to Traditional Chinese keeps the layout and the name size');
  await typeText('lang en'); await enter(); await sleep(900);
  for (const [w, h, min, max] of [[1000, 800, 50, 68.5], [390, 800, 38, 44], [320, 640, 38, 44]]) {
    await viewport(w, h, w < 500);
    await load('about:blank'); await load(BASE); await bootDone();
    if (w < 1000) await ev(`document.querySelector('.tab[data-view="gui"]')?.click()`);
    await sleep(500);
    const n = await nameInfo();
    check(n.px >= min && n.px <= max && n.sw <= n.cw + 1 && n.doc <= n.vw && n.lines <= 2, `at ${w}px the name is ${n.px.toFixed(0)}px, fits, and does not scroll sideways`, JSON.stringify(n));
    if (w === 390) await shot('24-typography-390', 300);
  }
  await viewport(1440, 900);
  await load('about:blank'); await load(BASE); await bootDone();

  console.log('status line: version and privacy claims');
  const statusInfo = () => ev(`(() => { const s = document.getElementById('status'); const r = s.getBoundingClientRect(); const w = document.getElementById('window').getBoundingClientRect(); const c = document.getElementById('chips').getBoundingClientRect(); return { ver: s.querySelector('.status-ver').textContent, claims: s.querySelector('.status-claims').textContent, label: s.getAttribute('aria-label'), inside: r.left >= w.left - 1 && r.right <= w.right + 1 && r.bottom <= w.bottom + 1, belowChips: r.top >= c.bottom - 1, h: Math.round(r.height), doc: document.documentElement.scrollWidth, vw: innerWidth, vh: document.documentElement.scrollHeight, ih: innerHeight, size: parseFloat(getComputedStyle(s).fontSize), color: getComputedStyle(s).color }; })()`);
  const st = await statusInfo();
  check(st.ver === 'v1.0.0' && st.claims === '0 cookies · 0 trackers · 0 dependencies' && st.label === 'Site details', 'the status line shows the version and the three claims', JSON.stringify(st));
  check(st.inside && st.belowChips && st.h < 50, 'it sits at the bottom of the terminal window, under the quick commands', JSON.stringify(st));
  check(st.vh <= st.ih + 1 && st.doc <= st.vw, 'it does not make the page scroll');
  await shot('25-status-line', 300);
  await typeText('lang zh'); await enter(); await sleep(900);
  const stZh = await statusInfo();
  check(stZh.claims === '0 個 cookie · 0 個追蹤器 · 0 個依賴套件' && stZh.label === '網站資訊' && stZh.ver === 'v1.0.0', 'it follows the language', JSON.stringify(stZh));
  await typeText('lang en'); await enter(); await sleep(900);
  for (const theme of ['light', 'amber', 'matrix', 'dark']) {
    await typeText(`theme ${theme}`); await enter(); await sleep(700);
    const ratios = await ev(`(() => { const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; }; const s = document.getElementById('status'); const bg = getComputedStyle(s).backgroundColor; const out = {}; for (const sel of ['', '.status-ver']) { const fg = getComputedStyle(sel ? s.querySelector(sel) : s).color; const a = lum(fg), b = lum(bg); out[sel || 'text'] = ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)); } return out; })()`);
    check(ratios.text >= 4.5 && ratios['.status-ver'] >= 4.5, `status line text has AA contrast in the ${theme} theme`, JSON.stringify(ratios));
  }
  await viewport(320, 640, true);
  await load('about:blank'); await load(BASE); await bootDone();
  await ev(`document.querySelector('.tab[data-view="term"]')?.click()`);
  await sleep(400);
  const stPhone = await statusInfo();
  check(stPhone.inside && stPhone.doc <= stPhone.vw && stPhone.vh <= stPhone.ih + 1, 'at 320px wide it wraps, stays inside the window and does not scroll the page', JSON.stringify(stPhone));
  await shot('25-status-line-320', 300);
  await viewport(1440, 900);
  await load('about:blank'); await load(BASE); await bootDone();

  console.log('dock navigation (wide screens with a mouse)');
  await viewport(1440, 900);
  await load('about:blank'); await load(BASE); await bootDone();
  const dockInfo = () => ev(`(() => { const d = document.getElementById('dock'); const r = d.getBoundingClientRect(); const w = document.getElementById('window').getBoundingClientRect(); const g = document.getElementById('gui').getBoundingClientRect(); return { shown: getComputedStyle(d).display !== 'none', items: [...d.querySelectorAll('.dock-item')].map((i) => [i.dataset.cmd, i.querySelector('.dock-lbl').textContent, i.getAttribute('aria-current')]), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), winBottom: Math.round(w.bottom), guiBottom: Math.round(g.bottom), chips: getComputedStyle(document.getElementById('chips')).display, doc: document.documentElement.scrollWidth, vw: innerWidth, docH: document.documentElement.scrollHeight, ih: innerHeight, label: d.getAttribute('aria-label') }; })()`);
  const dk = await dockInfo();
  check(dk.shown && dk.items.length === 7 && dk.items.map((i) => i[0]).join() === 'about,projects,works,gallery,skills,contact,help', 'the dock shows seven commands, with their names as labels', JSON.stringify(dk.items));
  check(dk.items.every((i) => i[0] === i[1]) && dk.label === 'Quick commands', 'each visible label is the command it runs');
  check(dk.chips === 'none', 'the plain quick-command buttons are replaced by the dock on wide screens');
  check(Math.abs((dk.left + dk.right) / 2 - 720) <= 1 && dk.bottom <= 900 && dk.bottom >= 880, 'it floats at the bottom centre of the screen', JSON.stringify(dk));
  check(dk.winBottom <= dk.top && dk.guiBottom <= dk.top, 'it does not cover the terminal or the overview', JSON.stringify({ win: dk.winBottom, gui: dk.guiBottom, top: dk.top }));
  check(dk.doc <= dk.vw && dk.docH <= dk.ih + 1, 'it does not make the page scroll');
  const rects = await ev(`[...document.querySelectorAll('.dock-item')].map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; })`);
  check(rects.every((r) => r[2] >= 44 && r[3] >= 44) && rects.every((r, i) => i === 0 || r[0] >= rects[i - 1][1]), 'icons are touch-sized and do not overlap at rest', JSON.stringify(rects));
  // Click: runs the command, marks the section, URL hash follows.
  const dockCentre = (cmd) => ev(`(() => { const r = document.querySelector('.dock-item[data-cmd="${cmd}"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const [cx, cy] = await dockCentre('skills');
  await mouse('mouseMoved', cx, cy);
  await sleep(250);
  const swell = await ev(`[...document.querySelectorAll('.dock-item')].map((i) => Number(i.getBoundingClientRect().height / 56).toFixed(2))`);
  const iSk = 4;
  check(Number(swell[iSk]) >= 1.25 && Number(swell[iSk - 1]) > 1.05 && Number(swell[iSk - 1]) < Number(swell[iSk]) && Number(swell[0]) <= 1.01, 'the icon under the mouse swells and its neighbours follow, far ones stay put', JSON.stringify(swell));
  await shot('26-dock-hover', 100);
  await mouse('mousePressed', cx, cy, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', cx, cy, { button: 'left', buttons: 0, clickCount: 1 });
  await until(async () => (await logText()).includes('What I fix'), 3000, 'skills ran');
  check((await ev(`location.hash`)) === '#skills' && (await dockInfo()).items.filter((i) => i[2] === 'true').map((i) => i[0]).join() === 'skills', 'clicking runs the command, updates the URL and marks the current section');
  await mouse('mouseMoved', 700, 300);
  await sleep(300);
  const rest = await ev(`[...document.querySelectorAll('.dock-item')].map((i) => Number(i.getBoundingClientRect().height / 56).toFixed(2))`);
  check(rest.every((v) => Number(v) <= 1.01), 'when the mouse leaves the dock the icons settle back', JSON.stringify(rest));
  await typeText('work 2'); await enter(); await sleep(300);
  check((await dockInfo()).items.filter((i) => i[2] === 'true').map((i) => i[0]).join() === 'works', 'typing a command updates the dock too (work 2 -> works)');
  await typeText('theme light'); await enter(); await sleep(700);
  check((await dockInfo()).items.filter((i) => i[2] === 'true').map((i) => i[0]).join() === 'works', 'commands that are not sections leave it alone');
  await typeText('theme dark'); await enter(); await sleep(700);
  // Keyboard: reachable with Tab, visible focus, Enter runs it.
  await ev(`document.querySelector('.dock-item[data-cmd="contact"]').focus()`);
  const kf = await ev(`(() => { const i = document.querySelector('.dock-item[data-cmd="contact"]'); const cs = getComputedStyle(i); return { focusVisible: i.matches(':focus-visible'), scale: i.getBoundingClientRect().height / 56, border: cs.borderTopColor }; })()`);
  await sleep(200);
  const kf2 = await ev(`document.querySelector('.dock-item[data-cmd="contact"]').getBoundingClientRect().height / 56`);
  check(kf2 >= 1.15, 'a focused icon is enlarged too, for keyboard users', JSON.stringify({ kf, kf2 }));
  await key('Enter', 'Enter', 13, '\r');
  await until(async () => (await logText()).includes('github.com/qwertyboy0325'), 3000, 'contact via keyboard');
  check(true, 'Enter on a focused dock icon runs the command');
  // Contrast of the label and the icon on the dock background, in every theme.
  for (const theme of ['dark', 'light', 'amber', 'matrix']) {
    await typeText(`theme ${theme}`); await enter(); await sleep(700);
    const cr = await ev(`(() => { const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; }; const bar = getComputedStyle(document.querySelector('.bar')).backgroundColor; const ratio = (el) => { const a = lum(getComputedStyle(el).color); const b = lum(bar); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }; return { label: ratio(document.querySelector('.dock-lbl')), icon: ratio(document.querySelector('.dock-ico')) }; })()`);
    check(cr.label >= 4.5 && cr.icon >= 4.5, `dock label and icon have AA contrast in the ${theme} theme`, JSON.stringify(cr));
  }
  await shot('26-dock', 300);
  // Language: labels stay the command names, the group name is translated.
  await typeText('lang zh'); await enter(); await sleep(900);
  const dz = await dockInfo();
  check(dz.label === '快速指令' && dz.items.every((i) => i[0] === i[1]), 'in Chinese the group is named in Chinese and the labels stay the commands');
  await typeText('lang en'); await enter(); await sleep(900);
  // The toast stays clear of the dock.
  await ev(`document.querySelector('.gmail-top')?.click()`);
  await sleep(500);
  const toast = await ev(`(() => { const t = document.getElementById('toast').getBoundingClientRect(); const d = document.getElementById('dock').getBoundingClientRect(); return { toastBottom: Math.round(t.bottom), dockTop: Math.round(d.top) }; })()`);
  check(toast.toastBottom <= toast.dockTop, 'the "copied" message appears above the dock, not on top of it', JSON.stringify(toast));
  // Picture windows stay above the dock.
  check((await ev(`Number(getComputedStyle(document.getElementById('dock')).zIndex) < 30`)), 'the dock sits below the floating picture windows');
  // Narrow window / touch-like: no dock, the plain buttons come back.
  await viewport(820, 1000);
  await load('about:blank'); await load(BASE); await bootDone();
  const nr = await dockInfo();
  check(!nr.shown && nr.chips === 'flex', 'below 1000px the dock is gone and the quick-command buttons are back', JSON.stringify({ shown: nr.shown, chips: nr.chips }));
  await viewport(390, 800, true);
  await ev(`localStorage.clear()`);
  await load('about:blank'); await load(BASE); await bootDone();
  const ph = await dockInfo();
  check(!ph.shown && ph.doc <= ph.vw, 'on a phone there is no dock and nothing scrolls sideways');
  // Reduced motion: no swelling.
  await viewport(1440, 900);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load('about:blank'); await load(BASE); await bootDone();
  const [rx, ry] = await dockCentre('works');
  await mouse('mouseMoved', rx, ry);
  await sleep(300);
  const calm = await ev(`[...document.querySelectorAll('.dock-item')].map((i) => Number(i.getBoundingClientRect().height / 56).toFixed(2))`);
  check(calm.every((v) => Number(v) <= 1.01), 'with reduced motion the dock does not swell', JSON.stringify(calm));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await load('about:blank'); await load(BASE); await bootDone();

  console.log('pictures in the overview');
  await ev(`document.querySelector('#gui .ggallery').scrollIntoView()`);
  await until(() => ev(`[...document.querySelectorAll('#gui .ggallery:not(.gphotos) .gthumb img')].every((i) => i.complete && i.naturalWidth > 0)`), 15000, 'thumbnails loaded');
  const cards = await ev(`(() => [...document.querySelectorAll('#gui .ggallery:not(.gphotos) .gthumb')].map((c) => { const i = c.querySelector('img'); return { loaded: i.complete && i.naturalWidth > 0, alt: i.alt, w: i.getAttribute('width'), h: i.getAttribute('height'), play: !!c.querySelector('.shot-play'), title: c.querySelector('.gtitle').textContent.length }; }))()`);
  check(cards.length === 4 && cards.every((c) => c.loaded && c.w === '480' && c.h === '480' && c.title > 5), 'four thumbnail cards, loaded, with reserved dimensions', JSON.stringify(cards));
  check(cards.filter((c) => c.play).length === 1, 'only the video card has a play badge');
  await ev(`document.querySelector('#gui [data-cmd="view 2"]').click()`);
  await until(async () => (await ev(`document.querySelectorAll('#log figure.shot').length`)) >= 1, 3000, 'card runs view 2');
  check((await ev(`document.querySelector('#gui [data-key="view 2"]').getAttribute('aria-current')`)) === 'true', 'clicking a thumbnail card shows the picture in the terminal and marks the card');

  console.log('pictures: language, reduced motion, phone');
  await typeText('lang zh'); await enter();
  await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 3000, 'zh');
  await sleep(900);
  await typeText('view 1'); await enter();
  await until(async () => (await ev(`[...document.querySelectorAll('#log figure.shot figcaption strong')].some((s) => s.textContent.includes('黑洞'))`)), 3000, 'zh figure');
  await ev(`[...document.querySelectorAll('#log .shot-open')].at(-1).click()`);
  await until(async () => (await ev(`document.querySelectorAll('#windows .win').length`)) >= 1, 3000, 'zh window');
  check((await ev(`document.querySelector('#windows .win .wclose').getAttribute('aria-label')`)).startsWith('關閉') && (await ev(`document.querySelector('#windows .win .wcap').textContent`)).includes('黑洞'), 'the picture window follows the language');
  await ev(`document.querySelector('#windows .win').focus()`);
  await key('Escape', 'Escape', 27);
  await typeText('lang en'); await enter();
  await sleep(900);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await typeText('view 2'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot')`), 3000, 'figure (reduced motion)');
  await sleep(250);
  const still = await ev(`(() => { const p = document.querySelector('#log .shot-ascii'); const i = document.querySelector('#log .shot-img'); return { asciiHidden: p.hidden, visible: getComputedStyle(i).visibility === 'visible' }; })()`);
  check(still.asciiHidden && still.visible, 'prefers-reduced-motion: the real image shows at once, with no ASCII animation', JSON.stringify(still));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await viewport(390, 844, true);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await typeText('view 3'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot')`), 3000, 'figure (phone)');
  await sleep(1800);
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'phone: the picture does not cause sideways scrolling');
  await ev(`document.querySelector('#log .shot-open').click()`);
  await until(() => ev(`!!document.querySelector('dialog.viewer[open]')`), 3000, 'phone viewer');
  const phone = await ev(`(() => { const d = document.querySelector('dialog.viewer').getBoundingClientRect(); const b = ['.vclose', '.vprev', '.vnext'].map((s) => document.querySelector('dialog.viewer ' + s).getBoundingClientRect()); return { inside: d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight, tap: b.every((r) => r.width >= 44 && r.height >= 44) }; })()`);
  check(phone.inside, 'phone: the viewer fits inside the screen');
  check(phone.tap, 'phone: close / previous / next are at least 44px');
  await shot('24-viewer-phone', 600);
  await key('Escape', 'Escape', 27);
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);

  console.log('works');
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await ev(`document.querySelector('.dock-item[data-cmd="works"]').click()`);
  await until(async () => (await logText()).includes('Black hole renderer'), 3000, 'works list');
  check((await ev(`location.hash`)) === '#works', 'the works dock item lists the works and updates the URL hash');
  const listText = await logText();
  check(listText.includes('Visual and 3D') && listText.includes('Research and thinking') && listText.includes('Design'), 'works are grouped by kind');
  await ev(`document.querySelector('#log button[data-cmd="work 1"]').click()`);
  await until(async () => (await logText()).includes('physics equations'), 3000, 'work 1 detail');
  const detail = await logText();
  check(detail.includes('for engineers:') && detail.includes('not claimed:'), 'a work shows a plain summary, what is not claimed, and a separate "for engineers" line');
  check((await ev(`document.querySelector('#log a.lnk[href="https://github.com/qwertyboy0325/blackhole-rust"]')?.rel`)) === 'noopener noreferrer', 'the public repo link is safe (noopener noreferrer)');
  await ev(`document.querySelector('#log button[data-cmd="work 3"]')?.click()`).catch(() => {});
  await typeText('work 3'); await enter();
  await until(async () => (await logText()).includes('ask permission') || (await logText()).includes('permission'), 3000, 'work 3');
  check(!(await logText()).includes('127.0.0.1'), 'no local addresses or private details leak into the page');
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'no horizontal overflow');
  await typeText('lang zh'); await enter();
  await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 3000, 'zh');
  await typeText('works'); await enter();
  await until(async () => (await logText()).includes('黑洞光線渲染器'), 3000, 'zh works');
  check((await logText()).includes('視覺與 3D'), 'works are available in Traditional Chinese');
  await ev(`localStorage.clear()`);
  await load(`${BASE}#works`);
  await bootDone();
  check((await logText()).includes('Black hole renderer'), 'the #works deep link opens the list');
  await viewport(390, 844, true);
  await load('about:blank');
  await load(`${BASE}#works`);
  await bootDone();
  check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'works fit a phone screen without sideways scrolling');
  await shot('18-works-mobile', 1400);
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);

  console.log('start-up watchdog (src/guard.js)');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await sleep(3600); // longer than the watchdog's wait
  check((await ev(`window.__siteReady === true`)) && !(await ev(`!!document.querySelector('.boot-fail')`)), 'a healthy page sets the ready flag and never shows the start-up notice');
  const brokenSite = async (label, mutate, expected) => {
    const dir = await mkdtemp(join(tmpdir(), 'site-broken-'));
    const errorsBefore = consoleErrors.length; // this scenario fails on purpose; its errors are not test failures
    let server;
    try {
      await cp(ROOT, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.shots)([\\/]|$)/.test(src) });
      await mutate(dir);
      server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '5197'], { stdio: 'ignore', env: { ...process.env, SITE_ROOT: dir, LIVERELOAD: '0' } });
      await until(() => fetch('http://127.0.0.1:5197/').then((r) => r.ok), 8000, 'broken-site server');
      await load('about:blank');
      await load('http://127.0.0.1:5197/');
      await until(() => ev(`!!document.querySelector('.boot-fail')`), 8000, `${label}: notice appears`);
      const info = await ev(`({ text: document.querySelector('.boot-fail').innerText, role: document.querySelector('.boot-fail').getAttribute('role'), promptHidden: document.getElementById('prompt').hidden, content: document.getElementById('log').innerText })`);
      check(expected.test(info.text), `${label}: the notice names the real cause`, info.text.replace(/\s+/g, ' ').slice(0, 260));
      check(info.role === 'alert' && info.text.includes('互動式終端機沒有'), `${label}: the notice is an accessible alert and bilingual`);
      check(info.content.includes('handoff-semantics') && info.content.includes('Black hole renderer'), `${label}: the pre-rendered content is still readable`);
      check(info.promptHidden, `${label}: no broken prompt is shown`);
      if (label.startsWith('main.js throws')) await shot('19-startup-notice', 200);
    } finally {
      await load('about:blank').catch(() => {});
      server?.kill();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      consoleErrors.splice(errorsBefore);
    }
  };
  await brokenSite('main.js throws', async (dir) => { const f = join(dir, 'src/main.js'); await writeFile(f, `throw new Error('simulated start-up failure');\n${await readFile(f, 'utf8')}`); }, /simulated start-up failure/);
  await brokenSite('a module file is missing', async (dir) => { await rm(join(dir, 'src/engine.js')); }, /failed to load|engine\.js|main\.js/);
  await brokenSite('main.js is blocked by CSP rules', async (dir) => { const f = join(dir, 'src/main.js'); await writeFile(f, `eval('1');\n${await readFile(f, 'utf8')}`); }, /Content-Security-Policy|unsafe-eval|EvalError|eval/i);

  console.log('contact: the real site shows the published address');
  const realEmail = (await readFile(join(ROOT, 'src/content.js'), 'utf8')).match(/email: '([^']+)'/)?.[1];
  check(!!realEmail, 'src/content.js publishes an email address', String(realEmail));
  await viewport(1440, 900);
  await load(BASE);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  check((await ev(`!document.getElementById('btn-mail').hidden && document.getElementById('btn-mail').dataset.copy`)) === realEmail, 'the title-bar ✉ button carries the published address');
  check((await ev(`document.querySelectorAll('#gui .gmail[data-copy]').length`)) === 2 && (await ev(`document.querySelector('#gui .gmail').dataset.copy`)) === realEmail, 'the overview offers it twice (profile card and contact section)');
  await typeText('contact'); await enter();
  await until(async () => (await ev(`!!document.querySelector('#log a[href^="mailto:"]')`)), 3000, 'mailto link');
  check((await ev(`document.querySelector('#log a[href^="mailto:"]').getAttribute('href')`)) === `mailto:${realEmail}`, 'the contact command links to the published address');
  check((await ev(`document.documentElement.outerHTML.includes('${realEmail}')`)), 'the address is in the page');

  console.log('contact: with an email set (a temp copy using the fake address hello@example.com)');
  {
    const dir = await mkdtemp(join(tmpdir(), 'site-mail-'));
    let server;
    try {
      await cp(ROOT, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.shots)([\\/]|$)/.test(src) });
      const f = join(dir, 'src/content.js');
      const content = await readFile(f, 'utf8');
      if (!/email: '[^']+',/.test(content)) throw new Error('profile.email line not found');
      await writeFile(f, content.replace(/email: '[^']+',/, "email: 'hello@example.com',"));
      server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '5194'], { stdio: 'ignore', env: { ...process.env, SITE_ROOT: dir, LIVERELOAD: '0' } });
      await until(() => fetch('http://127.0.0.1:5194/').then((r) => r.ok), 8000, 'mail-site server');
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await viewport(1440, 900);
      await load('about:blank');
      await load('http://127.0.0.1:5194/');
      await bootDone();
      const vis = await ev(`(() => { const b = document.getElementById('btn-mail'); const r = b.getBoundingClientRect(); return { shown: !b.hidden && r.width > 0, data: b.dataset.copy, label: b.getAttribute('aria-label'), top: !!document.querySelector('#gui .gmail-top'), section: !!document.querySelector('#gui .gcontact .gmail'), tabHidden: getComputedStyle(document.getElementById('tabs')).display === 'none' }; })()`);
      check(vis.shown && vis.data === 'hello@example.com' && vis.label.length > 5, 'the title bar has a labelled contact button', JSON.stringify(vis));
      check(vis.top && vis.section, 'the overview has a copy button in the profile card and in the contact section');
      // Record what the page tries to copy (a real click gives it the user activation the Clipboard API needs).
      await ev(`window.__copied = []; navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };`);
      const centre = async (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
      const click = async (sel) => { const [x, y] = await centre(sel); await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 }); };
      await click('#btn-mail');
      await until(() => ev(`window.__copied.length === 1`), 2000, 'copied');
      check((await ev(`window.__copied[0]`)) === 'hello@example.com', 'clicking the ✉ button copies the address');
      const toastState = await ev(`(() => { const t = document.getElementById('toast'); return { text: t.textContent, shown: t.classList.contains('show'), role: t.getAttribute('role'), opacity: getComputedStyle(t).opacity }; })()`);
      check(toastState.text === 'Email address copied' && toastState.shown && toastState.role === 'status', 'a visible, announced "copied" message appears', JSON.stringify(toastState));
      const shownAt = Date.now();
      await until(() => ev(`!document.getElementById('toast').classList.contains('show')`), 6000, 'toast hides');
      const visibleFor = Date.now() - shownAt;
      check(visibleFor >= 1500, 'the message goes away by itself, after being readable for a couple of seconds', `${visibleFor}ms`);
      await shot('25-contact-overview', 100);
      // contact command + overview buttons
      await typeText('contact'); await enter();
      await until(async () => (await ev(`!!document.querySelector('#log a[href="mailto:hello@example.com"]')`)), 3000, 'mailto link');
      check(true, 'the contact command shows a mailto link');
      await click('#log button[data-copy]');
      await until(() => ev(`window.__copied.length === 2`), 2000, 'copied from the log');
      await ev(`document.querySelector('#gui .gmail-top').scrollIntoView()`);
      await sleep(200);
      await click('#gui .gmail-top');
      await until(() => ev(`window.__copied.length === 3`), 2000, 'copied from the overview');
      check((await ev(`window.__copied.every((x) => x === 'hello@example.com')`)), 'every copy button copies the same address');
      // If copying is impossible the address is shown instead.
      await ev(`navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => false;`);
      await click('#btn-mail');
      await until(async () => (await ev(`document.getElementById('toast').textContent`)).includes('hello@example.com'), 2000, 'failure toast');
      check((await ev(`document.getElementById('toast').textContent`)).startsWith('Could not copy'), 'when copying fails the message shows the address so it can be copied by hand');
      // Fallback path (no Clipboard API at all)
      await ev(`navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); window.__exec = []; document.execCommand = (c) => { window.__exec.push([c, document.activeElement?.value]); return true; };`);
      await click('#btn-mail');
      await until(() => ev(`window.__exec.length === 1`), 2000, 'execCommand fallback');
      check((await ev(`window.__exec[0][0] === 'copy' && window.__exec[0][1] === 'hello@example.com'`)) && !(await ev(`!!document.querySelector('textarea.sr')`)), 'the fallback copies through a temporary field and removes it');
      // language
      await ev(`navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };`);
      await typeText('lang zh'); await enter();
      await until(() => ev(`document.documentElement.lang === 'zh-Hant'`), 3000, 'zh');
      await sleep(900);
      await click('#btn-mail');
      await until(async () => (await ev(`document.getElementById('toast').textContent`)) === '已複製 email 位址', 2000, 'zh toast');
      check(true, 'the message follows the language');
      await typeText('lang en'); await enter();
      await sleep(900);
      // narrow screens: the tab bar carries the button too
      await viewport(820, 1000);
      await sleep(300);
      const tabMail = await ev(`(() => { const b = document.getElementById('tab-mail'); const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, shown: !b.hidden && getComputedStyle(document.getElementById('tabs')).display === 'flex' }; })()`);
      check(tabMail.shown && tabMail.w >= 44 && tabMail.h >= 44, 'on narrow screens the tab bar has a touch-sized ✉ button', JSON.stringify(tabMail));
      await ev(`document.querySelector('#tabs [data-view="gui"]').click()`);
      await sleep(300);
      const before = await ev(`window.__copied.length`);
      await click('#tab-mail');
      await until(async () => (await ev(`window.__copied.length`)) === before + 1, 2000, 'copied from the tab bar');
      check(true, 'the tab-bar button works even while the terminal is hidden');
    } finally {
      await load('about:blank').catch(() => {});
      server?.kill();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      await viewport(1280, 800);
      await ev(`localStorage.clear()`).catch(() => {});
    }
  }

  console.log('contact: email switched off (a temp copy with profile.email = null)');
  {
    const dir = await mkdtemp(join(tmpdir(), 'site-nomail-'));
    let server;
    try {
      await cp(ROOT, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.shots)([\\/]|$)/.test(src) });
      const f = join(dir, 'src/content.js');
      await writeFile(f, (await readFile(f, 'utf8')).replace(/email: '[^']+',/, 'email: null,'));
      server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '5193'], { stdio: 'ignore', env: { ...process.env, SITE_ROOT: dir, LIVERELOAD: '0' } });
      await until(() => fetch('http://127.0.0.1:5193/').then((r) => r.ok), 8000, 'no-mail server');
      await viewport(1440, 900);
      await load('about:blank');
      await load('http://127.0.0.1:5193/');
      await bootDone();
      check((await ev(`document.getElementById('btn-mail').hidden && document.getElementById('tab-mail').hidden`)) && !(await ev(`!!document.querySelector('[data-copy], #gui .gmail')`)), 'with the address set to null no contact buttons exist anywhere');
      await typeText('contact'); await enter();
      await until(async () => (await logText()).includes('github'), 3000, 'contact output');
      check(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(await logText()) && !(await ev(`!!document.querySelector('#log a[href^="mailto:"]')`)), 'and the contact command shows no address (the "ezra@site" prompt is not one)');
    } finally {
      await load('about:blank').catch(() => {});
      server?.kill();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log('live reload (dev server, on a temp copy of the site)');
  const lrDir = await mkdtemp(join(tmpdir(), 'site-lr-'));
  const lrPort = 5198;
  let lrServer;
  try {
    await cp(ROOT, lrDir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.shots)([\\/]|$)/.test(src) });
    lrServer = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), String(lrPort)], { stdio: 'ignore', env: { ...process.env, SITE_ROOT: lrDir } });
    await until(() => fetch(`http://127.0.0.1:${lrPort}/`).then((r) => r.ok), 8000, 'dev server');
    await sleep(600); // macOS replays the copy's file events right after the watcher starts
    const plain = await (await fetch(BASE)).text();
    check(!plain.includes('__livereload') && !plain.includes('connect-src'), 'the deployed page (live reload off) has no reload client and keeps the strict CSP');
    await load('about:blank');
    await load(`http://127.0.0.1:${lrPort}/`);
    await bootDone();
    await until(() => ev(`window.__livereload === 'connected'`), 5000, 'reload client connected');
    check(true, 'the reload client connects (relaxed CSP allows only its own event stream)');
    await ev(`window.__marker = 42`);
    // CSS edit: styles swap in place and the page keeps its state.
    const cssFile = join(lrDir, 'src/styles.css');
    await writeFile(cssFile, (await readFile(cssFile, 'utf8')).replace('--accent: #5eead4;', '--accent: #ff00aa;'));
    await until(() => ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#ff00aa'`), 5000, 'css hot swap');
    check((await ev(`window.__marker`)) === 42, 'a CSS edit updates the page without reloading it (state kept)');
    await shot('14-live-css-edit', 300);
    // JS edit: full reload.
    const jsFile = join(lrDir, 'src/engine.js');
    await writeFile(jsFile, `${await readFile(jsFile, 'utf8')}\n// touched by e2e\n`);
    await until(() => ev(`window.__marker === undefined && document.readyState === 'complete'`), 6000, 'js reload');
    await bootDone();
    check(true, 'a JS edit reloads the page');
    check((await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) === '#ff00aa', 'the reloaded page serves the edited stylesheet');
    // HTML edit: full reload.
    await ev(`window.__marker = 7`);
    const htmlFile = join(lrDir, 'index.html');
    await writeFile(htmlFile, (await readFile(htmlFile, 'utf8')).replace('<meta name="author" content="Ezra Wu">', '<meta name="author" content="Live Reload Test">'));
    await until(() => ev(`document.querySelector('meta[name="author"]')?.content === 'Live Reload Test'`), 6000, 'html reload');
    check((await ev(`window.__marker`)) === undefined, 'an HTML edit reloads the page');
  } finally {
    await load('about:blank').catch(() => {}); // leave first: killing a server under an open event stream logs a (harmless) network error
    lrServer?.kill();
    await rm(lrDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log('photography (the real photographs)');
  await viewport(1440, 900);
  await load('about:blank'); await load(BASE); await bootDone();
  await typeText('photos'); await enter();
  await until(async () => (await logText()).includes('16. '), 3000, 'photos list');
  const plist = await logText();
  check(plist.includes('5. A backpack resting on the grass') && plist.includes('16. A figure on the lawn') && !plist.includes('1. A black hole'), 'photos lists the twelve photographs, numbered 5 to 16');
  await ev(`document.querySelector('#g-photos').scrollIntoView()`);
  await until(() => ev(`[...document.querySelectorAll('#gui .gphotos img')].every((i) => i.complete && i.naturalWidth > 0)`), 20000, 'real thumbnails');
  const rp = await ev(`(() => ({ cards: document.querySelectorAll('#gui .gphotos [data-cmd]').length, bad: [...document.querySelectorAll('#gui .gphotos img')].filter((i) => i.getAttribute('width') !== String(i.naturalWidth) || i.getAttribute('height') !== String(i.naturalHeight)).length, doc: document.documentElement.scrollWidth, vw: innerWidth }))()`);
  check(rp.cards === 12 && rp.bad === 0 && rp.doc <= rp.vw, 'the overview shows twelve photo cards with exact declared sizes', JSON.stringify(rp));
  await shot('28-photos-overview', 300);
  await typeText('view 6'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot .exif')`), 3000, 'real photo figure');
  check((await ev(`document.querySelector('#log figure.shot .exif').textContent`)) === 'NIKON Z 6 · NIKKOR Z 35mm f/1.8 S · 35 mm · f/1.8 · 1/3200 s · ISO 100', 'a real photo shows its camera, lens and settings');
  await sleep(1600);
  await ev(`document.querySelector('#log figure.shot .shot-open').click()`);
  await until(() => ev(`!!document.querySelector('#windows .win .exif')`), 3000, 'real photo window');
  await until(() => ev(`(() => { const i = document.querySelector('#windows .wstage img'); return i.complete && i.naturalWidth > 0; })()`), 10000, 'real photo loaded');
  await shot('28-photo-real-window', 500);
  await ev(`document.querySelector('#windows .win').focus()`);
  await key('Escape', 'Escape', 27);
  // The portrait photos
  await typeText('view 12'); await enter();
  await until(() => ev(`[...document.querySelectorAll('#log figure.shot')].length >= 2`), 3000, 'portrait figure');
  await sleep(1600);
  await ev(`[...document.querySelectorAll('#log .shot-open')].at(-1).click()`);
  await until(() => ev(`!!document.querySelector('#windows .win .exif')`), 3000, 'portrait window');
  await until(() => ev(`(() => { const i = document.querySelector('#windows .wstage img'); return i.complete && i.naturalWidth > 0; })()`), 10000, 'portrait loaded');
  const portrait = await ev(`(() => { const w = document.querySelector('#windows .win'); const r = w.getBoundingClientRect(); return { meta: w.querySelector('.wmeta').textContent, inside: r.top >= 0 && r.bottom <= innerHeight, } })()`);
  check(portrait.meta === '1065×1600 · JPG' && portrait.inside, 'a portrait photo opens upright and fits the window', JSON.stringify(portrait));
  await ev(`document.querySelector('#windows .win').focus()`);
  await key('Escape', 'Escape', 27);
  await typeText('clear'); await enter();

  console.log('photography (a copy of the site with two photographs)');
  const haveImageTools = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); execFileSync('sips', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (!haveImageTools) {
    console.log('  skipped: needs ImageMagick and macOS sips');
  } else {
    const { makeFakePhoto } = await import('./fake-photo.mjs');
    const { processPhoto } = await import('./add-photo.mjs');
    const photoDir = await mkdtemp(join(tmpdir(), 'site-photos-'));
    let photoServer;
    try {
      await cp(ROOT, photoDir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.shots)([\\/]|$)/.test(src) });
      const inDir = join(photoDir, '_in');
      await mkdir(inDir, { recursive: true });
      const expected = makeFakePhoto(join(inDir, 'IMG_1001.jpg'), { width: 2400, height: 1600 });
      makeFakePhoto(join(inDir, 'IMG_1002.jpg'), { width: 2400, height: 1600, orientation: 6 });
      const made = ['IMG_1001', 'IMG_1002'].map((n, i) => processPhoto(join(inDir, `${n}.jpg`), { outDir: join(photoDir, 'assets/gallery'), slug: `test-${i + 1}` }));
      const entry = (r, i) => `  {
    slug: '${r.slug}', kind: 'image', set: 'photo',
    src: 'assets/gallery/${r.slug}.jpg', width: ${r.width}, height: ${r.height},
    thumb: 'assets/gallery/${r.slug}-thumb.jpg', thumbWidth: ${r.thumbWidth}, thumbHeight: ${r.thumbHeight},
    shot: ${JSON.stringify(r.shot).replace(/"([a-z]+)":/g, '$1: ').replace(/"/g, "'")},
    en: { title: 'Test photo ${i + 1}', caption: 'A picture made only for the tests, number ${i + 1}. It shows a soft gradient.', alt: 'A smooth gradient from warm sand at the centre to deep blue at the edges, photo ${i + 1}.' },
    zh: { title: '測試照片 ${i + 1}', caption: '只為測試製作的圖片，編號 ${i + 1}。畫面是柔和的漸層。', alt: '從中央的暖沙色漸層到邊緣的深藍色，照片 ${i + 1}。' },
  },
`;
      const cfile = join(photoDir, 'src/content.js');
      // The copy holds only the two test photos, not the real ones (so the numbers below are predictable).
      const ctext = (await readFile(cfile, 'utf8')).replace(/\n  \{\n    slug: '[^']+',\n    kind: 'image',\n    set: 'photo',[\s\S]*?\n  \},/g, '');
      const close = ctext.lastIndexOf('];', ctext.indexOf('export const skillGroups'));
      await writeFile(cfile, ctext.slice(0, close) + made.map(entry).join('') + ctext.slice(close));
      photoServer = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '5192'], { stdio: 'ignore', env: { ...process.env, SITE_ROOT: photoDir, LIVERELOAD: '0' } });
      await until(() => fetch('http://127.0.0.1:5192/').then((r) => r.ok), 8000, 'photo-site server');
      const errorsBefore = consoleErrors.length;
      await viewport(1440, 900);
      await load('about:blank'); await load('http://127.0.0.1:5192/'); await bootDone();
      await ev(`localStorage.clear()`);

      // What the visitor downloads contains no private data.
      const { privateSegments } = await import('./jpeg-meta.mjs');
      for (const r of made) {
        for (const f of [r.full, r.thumb]) {
          const served = Buffer.from(await (await fetch(`http://127.0.0.1:5192/assets/gallery/${f.split('/').at(-1)}`)).arrayBuffer());
          check(privateSegments(served).length === 0 && !['Jane Q. Owner', 'SN-123456', 'GPS', 'TESTCO'].some((x) => served.includes(x)), `${f.split('/').at(-1)} as served has no Exif, GPS, serial number or owner name`);
        }
      }
      check(made[0].width === 1600 && made[0].height === 1067 && made[1].width === 1067 && made[1].height === 1600, 'the 2400x1600 photos became 1600 px, and the rotated one is upright');

      // Commands
      await typeText('help'); await enter();
      await until(async () => (await logText()).includes('my photographs'), 3000, 'help lists photos');
      check(true, 'help lists the photos command once there are photos');
      await typeText('photos'); await enter();
      await until(async () => (await logText()).includes('6. Test photo 2'), 3000, 'photos list');
      const list = await logText();
      check(list.includes('5. Test photo 1') && !list.includes('5. A black hole') && list.includes('view 5'), 'photos lists only the photos, numbered after the four project pictures');
      await typeText('gallery'); await enter();
      await until(async () => (await logText()).includes('from my projects'), 3000, 'gallery groups');
      check((await logText()).includes('photographs'), 'gallery now has two labelled groups');

      // Overview section
      await ev(`document.querySelector('#g-photos').scrollIntoView()`);
      await until(() => ev(`[...document.querySelectorAll('#gui .gphotos img')].every((i) => i.complete && i.naturalWidth > 0)`), 15000, 'photo thumbnails');
      const ov = await ev(`(() => ({ heading: document.querySelector('#g-photos').textContent, cards: [...document.querySelectorAll('#gui .gphotos [data-cmd]')].map((c) => c.dataset.cmd), dims: [...document.querySelectorAll('#gui .gphotos img')].map((i) => [i.getAttribute('width'), i.getAttribute('height'), i.naturalWidth, i.naturalHeight]), gallery: document.querySelectorAll('#gui .ggallery:not(.gphotos) [data-cmd]').length }))()`);
      check(ov.heading === '// PHOTOS' && ov.cards.join() === 'view 5,view 6' && ov.gallery === 4, 'the overview has a PHOTOS section and the four renders stay under GALLERY', JSON.stringify(ov));
      check(ov.dims[0][0] === String(ov.dims[0][2]) && ov.dims[0][1] === String(ov.dims[0][3]) && ov.dims[1][0] === String(ov.dims[1][2]), 'thumbnail sizes are declared exactly (no jumping)', JSON.stringify(ov.dims));

      // A photo in the terminal: ASCII first, then the real image, with the shooting details
      await ev(`document.querySelector('#gui [data-cmd="view 5"]').click()`);
      await until(() => ev(`!!document.querySelector('#log figure.shot .exif')`), 3000, 'figure with details');
      const expectedLine = `${expected.camera} · ${expected.lens} · ${expected.focal} mm · f/${expected.aperture} · ${expected.shutter} s · ISO ${expected.iso}`;
      check((await ev(`document.querySelector('#log figure.shot .exif').textContent`)) === expectedLine, 'the shooting details are shown under the picture', expectedLine);
      await until(() => ev(`(() => { const p = document.querySelector('#log figure.shot .shot-ascii'); return !!p && !p.hidden && p.textContent.length > 200; })()`), 4000, 'ascii phase');
      check(true, 'a photo is drawn in characters first, like the other pictures');
      await until(() => ev(`document.querySelector('#log figure.shot .shot-ascii').hidden`), 6000, 'ascii phase ends');
      check(await ev(`(() => { const i = document.querySelector('#log figure.shot .shot-img'); return i.complete && i.naturalWidth === 1600; })()`), 'then the full photo');
      await shot('27-photo-terminal', 1300);

      // In a floating window
      await ev(`document.querySelector('#log figure.shot .shot-open').click()`);
      await until(() => ev(`!!document.querySelector('#windows .win .exif')`), 3000, 'photo window');
      const pw = await ev(`(() => { const w = document.querySelector('#windows .win'); const r = w.getBoundingClientRect(); return { title: w.querySelector('.wtitle').textContent, meta: w.querySelector('.wmeta').textContent, exif: w.querySelector('.exif').textContent, inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, tag: w.querySelector('.exif').tagName }; })()`);
      check(pw.title === 'test-1-fix' || pw.title === `${made[0].slug}.jpg`, 'the window is titled with the file name', JSON.stringify(pw));
      check(pw.meta === '1600×1067 · JPG' && pw.exif === expectedLine && pw.tag === 'SMALL', 'the window shows size and the shooting details (as text)', JSON.stringify(pw));
      check(pw.inside, 'the photo window fits on the screen');
      await shot('27-photo-window', 400);
      await ev(`document.querySelector('#windows .wnext').click()`);
      await until(() => ev(`document.querySelector('#windows .win .wmeta').textContent.startsWith('1067×1600')`), 3000, 'next photo (portrait)');
      await until(() => ev(`(() => { const i = document.querySelector('#windows .wstage img'); return i.complete && i.naturalWidth > 0; })()`), 5000, 'portrait photo loaded');
      const tall = await ev(`(() => { const w = document.querySelector('#windows .win'); const r = w.getBoundingClientRect(); const i = w.querySelector('.wstage img').getBoundingClientRect(); return { inside: r.bottom <= innerHeight + 1 && r.top >= 0, imgH: Math.round(i.height), imgW: Math.round(i.width) }; })()`);
      check(tall.inside && tall.imgH > tall.imgW, 'a portrait photo also fits in the window (letterboxed, not cropped)', JSON.stringify(tall));
      await ev(`document.querySelector('#windows .win').focus()`);
      await key('Escape', 'Escape', 27);

      // Dock and language
      await typeText('photos'); await enter(); await sleep(300);
      check((await ev(`document.querySelector('.dock-item[aria-current="true"]')?.dataset.cmd`)) === 'gallery', 'photos highlights the gallery item in the dock');
      await typeText('lang zh'); await enter(); await sleep(900);
      await typeText('photos'); await enter();
      await until(async () => (await logText()).includes('測試照片 2'), 3000, 'zh photos');
      check((await logText()).includes('每張照片下方有拍攝資訊') && (await ev(`document.querySelector('#g-photos').textContent`)) === '// 攝影', 'photography is available in Traditional Chinese');
      await typeText('lang en'); await enter(); await sleep(700);
      // Contrast of the details line in every theme
      for (const theme of ['dark', 'light', 'amber', 'matrix']) {
        await typeText(`theme ${theme}`); await enter(); await sleep(700);
        // The details line is drawn in --accent on the panel colour: resolve both through probe elements (computed values come back as rgb()).
        const cr = await ev(`(() => { const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; }; const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; probe.style.backgroundColor = 'var(--panel)'; document.body.append(probe); const cs = getComputedStyle(probe); const used = getComputedStyle(document.querySelector('#log .exif')).color; const fg = cs.color; const bgc = cs.backgroundColor; probe.remove(); const a = lum(fg); const b = lum(bgc); return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), usesAccent: used === fg, used, accent: fg }; })()`);
        check(cr.usesAccent && cr.ratio >= 4.5, `the shooting details have AA contrast in the ${theme} theme`, JSON.stringify(cr));
      }
      // Phone
      await viewport(390, 844, true);
      await load('about:blank'); await load('http://127.0.0.1:5192/'); await bootDone();
      await typeText('view 6'); await enter();
      await until(() => ev(`!!document.querySelector('#log figure.shot .exif')`), 3000, 'phone figure');
      await sleep(1500);
      check((await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0, 'a photo with its details fits a phone screen without sideways scrolling');
      await ev(`document.querySelector('#log figure.shot .shot-open').click()`);
      await until(() => ev(`!!document.querySelector('dialog.viewer[open] .exif')`), 3000, 'phone dialog');
      check((await ev(`document.querySelector('dialog.viewer .exif').textContent`)).includes('f/1.8'), 'on a phone the modal viewer also shows the details');
      await shot('27-photo-phone', 300);
      await key('Escape', 'Escape', 27);
      await viewport(1440, 900);
      consoleErrors.length = errorsBefore;
    } finally {
      await load('about:blank').catch(() => {});
      photoServer?.kill();
      await rm(photoDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  check(consoleErrors.length === 0, 'no console errors / CSP violations', consoleErrors.join(' | '));
} catch (e) {
  failures++;
  console.error(`\nFATAL: ${e.stack ?? e}`);
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
