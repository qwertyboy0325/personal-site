// End-to-end check in real headless Chrome via the DevTools Protocol.
// Zero dependencies. Needs Chrome/Chromium: set CHROME=/path/to/chrome if it
// is not at the macOS default. Screenshots land in .shots/ (gitignored).
//
//   npm run e2e

import { spawn } from 'node:child_process';
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
  await send('Page.navigate', { url });
  await until(() => ev(`document.readyState === 'complete'`), 10000, 'load');
};
const bootDone = () => until(() => ev(`document.getElementById('log').getAttribute('aria-live') === 'polite'`), 8000, 'boot');

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
  // Lock on to a quick-command chip.
  const chip = await ev(`(() => { const r = document.querySelector('.chip[data-cmd="projects"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await mouse('mouseMoved', chip[0], chip[1]);
  await until(() => ev(`document.getElementById('reticle').classList.contains('rt-lock')`), 2000, 'lock on chip');
  check((await ev(`document.querySelector('#reticle .rt-tgt').textContent`)) === 'LOCK ▸ projects', 'locks on and names the target');
  check((await ev(`getComputedStyle(document.querySelector('.chip')).cursor`)).includes('cursor-hot.svg'), 'hot cursor over clickable things');
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

  console.log('HUD panels');
  await viewport(1440, 900);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  const disp = (sel) => ev(`getComputedStyle(document.querySelector('${sel}')).display`);
  check((await disp('#hud-left')) === 'flex' && (await disp('#hud-right')) === 'flex', 'both HUD columns are shown at 1440px');
  check((await ev(`document.getElementById('hud-left').getAttribute('aria-hidden')`)) === 'true', 'decorative telemetry is hidden from screen readers');
  check((await ev(`document.getElementById('hud-right').getAttribute('aria-label')`)).length > 3, 'project map region is labelled');
  const geometry = await ev(`(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const w = document.getElementById('window').getBoundingClientRect(); return { left: r('hud-left').right, right: r('hud-right').left, wl: w.left, wr: w.right, ww: w.width, scroll: document.documentElement.scrollWidth - innerWidth, panelH: Math.max(r('hud-left').height, r('hud-right').height), winH: w.height }; })()`);
  check(geometry.left <= geometry.wl && geometry.right >= geometry.wr, 'panels sit beside the terminal without overlapping it', JSON.stringify(geometry));
  check(geometry.scroll <= 0, 'no horizontal overflow with the HUD', String(geometry.scroll));
  check(geometry.panelH <= geometry.winH + 1, 'columns are no taller than the terminal window');
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
  const fpsNow = await ev(`document.querySelector('[data-h="fps"]').textContent`);
  check(Number(fpsNow) > 0, 'frame rate is measured and shown', fpsNow);
  check((await ev(`document.querySelector('[data-h="spark"]').getAttribute('points')`)).length > 0, 'frame-rate sparkline is drawn');
  await mouse('mouseMoved', 700, 400);
  await until(() => ev(`document.querySelector('[data-h="px"]').textContent === '0700'`), 2000, 'pointer x');
  check((await ev(`document.querySelector('[data-h="py"]').textContent`)) === '0400', 'pointer panel shows the live position');
  check((await ev(`document.querySelectorAll('#hud-right .node').length`)) === 5, 'project map has the core plus four project nodes');
  await ev(`document.querySelector('#hud-right .node[data-cmd="project 2"]').click()`);
  await until(async () => (await logText()).includes('vox-proof'), 3000, 'map node runs project 2');
  check(true, 'clicking a map node runs its command');
  const mapBox = await ev(`(() => { const m = document.querySelector('#hud-right .map').getBoundingClientRect(); const nodes = [...document.querySelectorAll('#hud-right .node')].map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, clipped: n.scrollWidth > n.clientWidth, label: n.textContent }; }); return { w: m.width, h: m.height, nodes }; })()`);
  check(Math.abs(mapBox.w - mapBox.h) <= 2 && mapBox.w > 150, 'project map is a square, not squashed', JSON.stringify({ w: mapBox.w, h: mapBox.h }));
  const overlaps = mapBox.nodes.filter((a, i) => mapBox.nodes.some((b, j) => j > i && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
  check(overlaps.length === 0, 'map nodes do not overlap each other', JSON.stringify(overlaps.map((n) => n.label)));
  const clipped = mapBox.nodes.filter((n) => n.clipped).map((n) => n.label);
  check(clipped.length === 0, 'map labels are not truncated', JSON.stringify(clipped));
  check((await ev(`document.querySelector('#hud-right .recent-btn')?.dataset.cmd`)) === 'project 2', 'recent list shows the newest command first');
  await typeText('skills'); await enter();
  await sleep(120);
  await ev(`[...document.querySelectorAll('#hud-right .recent-btn')].find(b => b.dataset.cmd === 'project 2').click()`);
  await sleep(150);
  check((await ev(`[...document.querySelectorAll('#log .typed')].filter(e => e.textContent === 'project 2').length`)) === 2, 'recent commands can be re-run with one click');
  check(await ev(`(() => { const n = document.querySelector('#hud-right .node'); n.focus(); return document.activeElement === n; })()`), 'map nodes are keyboard focusable');
  await shot('12-hud-dark', 400);
  await typeText('theme matrix'); await enter();
  await until(() => ev(`document.documentElement.dataset.theme === 'matrix'`), 3000, 'matrix');
  await sleep(900);
  check((await ev(`getComputedStyle(document.getElementById('window'), '::after').content`)) !== 'none', 'matrix theme draws CRT scanlines');
  await mouse('mouseMoved', 760, 520);
  await shot('13-hud-matrix', 250);
  await typeText('hud off'); await enter();
  await until(async () => (await disp('#hud-left')) === 'none', 3000, 'hud off');
  check((await disp('#hud-right')) === 'none', 'hud off hides both columns');
  check((await ev(`Math.round(document.getElementById('window').getBoundingClientRect().width)`)) === 980, 'terminal returns to its normal width');
  check((await ev(`localStorage.getItem('hud')`)) === 'off', 'hud choice is persisted');
  await typeText('hud on'); await enter();
  await until(async () => (await disp('#hud-left')) === 'flex', 3000, 'hud on');
  check(true, 'hud on brings the panels back');
  await viewport(1280, 800);
  await sleep(200);
  check((await disp('#hud-left')) === 'none' && (await disp('#hud-right')) === 'none', 'panels are hidden below 1320px even when enabled');
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
  const smallTargets = await ev(`[...document.querySelectorAll('.chip,.tool')].filter(e => e.getBoundingClientRect().height < 36).length`);
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

  console.log('works');
  await viewport(1280, 800);
  await ev(`localStorage.clear()`);
  await load('about:blank');
  await load(BASE);
  await bootDone();
  await ev(`document.querySelector('.chip[data-cmd="works"]').click()`);
  await until(async () => (await logText()).includes('Black hole renderer'), 3000, 'works list');
  check((await ev(`location.hash`)) === '#works', 'the works chip lists the works and updates the URL hash');
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

  check(consoleErrors.length === 0, 'no console errors / CSP violations', consoleErrors.join(' | '));
} catch (e) {
  failures++;
  console.error(`\nFATAL: ${e.stack ?? e}`);
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
