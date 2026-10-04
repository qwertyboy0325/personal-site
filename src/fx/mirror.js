// A live mirror made of letters: the visitor's own camera, drawn as ASCII, entirely on their device.
//
// Nothing is recorded, saved or sent anywhere: frames are read from the camera, turned into text
// and thrown away. The camera is only requested when the visitor presses "turn on camera", and it is
// released (the browser's camera light goes out) as soon as they stop, leave the page or hide the tab.
//
// The pure parts (size, text of a frame, error wording) are tested under Node; createMirror is the
// browser side.

import { imageToAscii } from './imgascii.js';

/** Characters per row for a mirror `widthPx` wide: about one per 7 px, 36 to 100 (more room in the big view). */
export function mirrorColumns(widthPx, { cell = 7, min = 36, max = 100 } = {}) {
  const w = Number(widthPx);
  if (!Number.isFinite(w) || w <= 0) return min;
  return Math.min(max, Math.max(min, Math.round(w / cell)));
}

/**
 * How dense the letters are: pixels per character and the most characters per row. Real full screen has the room for more,
 * but never below 6 px a character: finer than that the letters stop reading as letters and the mirror becomes a halftone photo.
 */
export const DENSITY = {
  inline: { cell: 7, max: 100 },
  stage: { cell: 7, max: 160 },
  full: { cell: 6, max: 240 },
};

/**
 * The widths the mirror may use, in steps: the letters change size rarely and on purpose instead of breathing with every
 * measurement. A step down is a quarter to a third fewer characters, so about half the work per frame.
 */
export const COLUMN_STEPS = [36, 48, 64, 80, 100, 128, 160, 200, 240];

/** The largest step that is not wider than `cols` (the first step at least). */
export function snapColumns(cols) {
  let out = COLUMN_STEPS[0];
  for (const s of COLUMN_STEPS) if (s <= cols) out = s;
  return out;
}

/**
 * Resolution gives way before the frame rate does: a mirror that lags behind your movements feels broken long before one
 * with coarser letters does. `state` = { idx, over, under }: idx is the highest step allowed (an index into COLUMN_STEPS),
 * over / under count checks in a row that were too costly / had room to spare.
 * - Down one step after `patience` costly checks: a frame taking more than `drop` of its budget (well before the frame rate
 *   would have to slow, see frameInterval) or frames arriving late.
 * - Up one step only after `calm` checks in a row where the next step, which costs about (next / current)^2 as much, would
 *   still fit within `rise` of the budget.
 * avgCost = time spent on a frame, avgGap = time between frames, targetMs = the frame budget, all in ms.
 */
export function adaptStep(state, avgCost, avgGap, targetMs, { drop = 0.2, rise = 0.12, patience = 2, calm = 5 } = {}) {
  const last = COLUMN_STEPS.length - 1;
  const idx = Number.isInteger(state?.idx) ? Math.min(last, Math.max(0, state.idx)) : last;
  const cur = { idx, over: state?.over | 0, under: state?.under | 0 };
  if (!(avgCost > 0) || !(targetMs > 0)) return cur;
  const late = Number.isFinite(avgGap) && avgGap > targetMs * 1.5;
  if (avgCost > targetMs * drop || late) {
    const over = cur.over + 1;
    return over >= patience && idx > 0 ? { idx: idx - 1, over: 0, under: 0 } : { idx, over, under: 0 };
  }
  if (idx === last) return { idx, over: 0, under: 0 };
  const grow = (COLUMN_STEPS[idx + 1] / COLUMN_STEPS[idx]) ** 2;
  if (avgCost * grow < targetMs * rise && !(avgGap > targetMs * 1.2)) {
    const under = cur.under + 1;
    return under >= calm ? { idx: idx + 1, over: 0, under: 0 } : { idx, over: 0, under };
  }
  return { idx, over: 0, under: 0 };
}

/** Lenses: a longer one crops the middle of the camera's picture, so a face gets more of the letters at the same cost. */
export const FOCALS = [{ mm: 28, zoom: 1 }, { mm: 50, zoom: 1.5 }, { mm: 85, zoom: 2.2 }];

/** The default lens: a laptop or desk camera sees a lot of room, so 50mm; a phone's front camera is already close, so 28mm. */
export const defaultFocal = (finePointer) => (finePointer ? 50 : 28);

/**
 * The part of a `videoW` x `videoH` picture a lens of `zoom` sees: the same shape, `zoom` times smaller, centred left to right
 * and lifted a little (`lift` 0.5 is the middle), because faces sit above the middle of a webcam picture.
 */
export function cropFor(videoW, videoH, zoom, { lift = 0.42 } = {}) {
  const w = Number(videoW) > 0 ? Number(videoW) : 0;
  const h = Number(videoH) > 0 ? Number(videoH) : 0;
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const sw = w / z;
  const sh = h / z;
  return { sx: (w - sw) / 2, sy: (h - sh) * Math.min(1, Math.max(0, lift)), sw, sh };
}

/**
 * The biggest picture of shape `ratio` (height / width) that fits a view `viewW` x `viewH`: nothing is stretched or cropped.
 * Pass viewH = Infinity (or 0) when only the width is limited.
 */
export function fitBox(viewW, viewH, ratio) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
  let w = Math.max(1, Number(viewW) || 1);
  if (Number.isFinite(viewH) && viewH > 0) w = Math.min(w, viewH / r);
  w = Math.max(1, Math.floor(w));
  return { w, h: Math.max(1, Math.round(w * r)) };
}

/** Rows for `cols` characters over a video of `videoW` x `videoH` (characters are about twice as tall as wide). */
export function mirrorRows(cols, videoW, videoH) {
  if (!(videoW > 0) || !(videoH > 0)) return Math.max(1, Math.round(cols * 0.375));
  return Math.max(1, Math.round(cols * (videoH / videoW) * 0.5));
}

/**
 * One frame (RGBA pixels, already flipped like a mirror) as text. The frame is drawn on a grid with `cols` columns and
 * `mirrorRows(...)` rows of the same number of pixels each (so already squeezed to the shape of the characters): one
 * row of pixels cells per line of text, hence cellAspect 1. (With the default 0.5 the picture would come out half as tall.)
 */
export function frameLetters(px, { cols, invert = false } = {}) {
  return imageToAscii(px, { cols, invert, detail: 1, clip: 0.02, cellAspect: 1 });
}

/** Which message to show for a camera error: 'denied' | 'none' | 'busy' | 'insecure' | 'unsupported' | 'other'. */
export function errorKey(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'InsecureContext') return 'insecure';
  if (name === 'Unsupported') return 'unsupported';
  return 'other';
}

/** Frames per second: gentler for people who asked for reduced motion. */
export const mirrorFps = (reduceMotion) => (reduceMotion ? 6 : 15);

/** Pixels read from the camera per character, each way. A few per character, so a character is an average, not one sample. */
export const SAMPLES_PER_CHAR = 3;

/**
 * How long to wait before the next frame, given how long the last ones took (a smoothed average, in ms).
 * Normally the target frame rate; when a frame is expensive (a slow phone), the waiting grows so the page
 * stays responsive, down to 4 frames per second at the very least.
 */
export function frameInterval(avgCostMs, fps) {
  const target = 1000 / fps;
  if (!Number.isFinite(avgCostMs) || avgCostMs <= 0) return target;
  return Math.min(250, Math.max(target, avgCostMs * 4)); // spend at most about a quarter of the time on the mirror
}

/** Smooth a new measurement into the running average. */
export const smooth = (avg, sample, weight = 0.15) => (Number.isFinite(avg) && avg > 0 ? avg + (sample - avg) * weight : sample);

let active = null; // only one mirror at a time
let releasedAt = 0; // when a camera was last switched off (see COOLDOWN_MS)

/** Asking for the camera again within a moment of switching it off can hang or fail on some devices, so a new start waits this long. */
export const COOLDOWN_MS = 700;

/** After this long still "waiting for the camera" the page says what to check (a permission prompt may be open). */
export const SLOW_START_MS = 8000;

/**
 * Ask for the camera. Right after the camera was switched off, some devices still report "in use" for a moment, so a
 * busy camera is tried again a couple of times (a person who really has another app using it gets the message after ~1 second).
 */
async function openCamera(retries = 2, delayMs = 350) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      if (attempt >= retries || errorKey(e) !== 'busy') throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function stopMirror() {
  active?.stop();
}

/**
 * Wire up a mirror figure (see renderMirror in render.js). `getInvert()` says whether the light theme is on;
 * `t` holds the wording (status, errors, toast text); `onCopied(ok)` is told how copying went.
 * `stage: false` keeps the picture in the page's own box (the home page's light-box) instead of the big view.
 * `focal` (mm, one of FOCALS) is the lens it starts with; buttons with data-focal inside `fig` switch it.
 * Returns { stop, live, focal, cols, capture(cols) }: capture() turns the current camera frame into text at any width (the
 * shutter uses it to print a frame finer than the live view can afford), or returns null while the camera is off.
 */
export function createMirror(fig, { t, getInvert = () => false, reduceMotion = false, onCopied = () => {}, stage: useStage = true, focal: startFocal = 50 }) {
  const inlinePre = fig.querySelector('.mirror-ascii');
  const start = fig.querySelector('[data-mirror-start]');
  const stopBtn = fig.querySelector('[data-mirror-stop]');
  const copyBtn = fig.querySelector('[data-mirror-copy]');
  const status = fig.querySelector('.mirror-status');
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.className = 'mirror-video';
  video.setAttribute('aria-hidden', 'true');
  fig.append(video); // attached (but invisible): some browsers will not play a detached video
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let raf = 0;
  let last = 0;
  let live = false;
  const perf = { read: 0, text: 0, dom: 0, n: 0 };
  let avgCost = 0;       // smoothed time one frame takes (ms)
  let viewW = 0;         // size of the space the picture may use, kept up to date by the observer (no layout reads per frame)
  let viewH = Infinity;
  let shown = '';        // the text on screen: an unchanged frame is not written again
  let metrics = '';      // the cols/rows/size the font was last set for
  let observer = null;
  let step = { idx: COLUMN_STEPS.length - 1, over: 0, under: 0 }; // the widest the letters may be right now (see adaptStep)
  let shownCols = 0;     // the width of the frame on screen
  let zoom = (FOCALS.find((f) => f.mm === startFocal) ?? FOCALS[1]).zoom;
  const lensOf = (z) => FOCALS.find((f) => f.zoom === z)?.mm ?? 28;
  const focalButtons = () => [...fig.querySelectorAll('[data-focal]'), ...(stage ? stage.dlg.querySelectorAll('[data-focal]') : [])];
  function setFocal(mm) {
    const lens = FOCALS.find((f) => f.mm === Number(mm));
    if (!lens) return;
    zoom = lens.zoom;
    for (const b of focalButtons()) b.setAttribute('aria-pressed', String(Number(b.dataset.focal) === lens.mm));
    fig.dataset.focal = String(lens.mm);
  }
  let lastProcessed = 0;
  let avgGap = 0;
  let sinceAdapt = 0;
  let full = false;      // browser full screen
  let startToken = null; // identifies the start in progress, so a camera that arrives after Stop or a page change is switched straight off
  let slowTimer = 0;
  let stage = null;      // the big view (a <dialog>) while the camera is on
  let out = inlinePre;   // where the letters are drawn: the big view, or the page's own box if the browser has no <dialog>
  for (const btn of fig.querySelectorAll('[data-focal]')) { btn.hidden = false; btn.addEventListener('click', () => setFocal(btn.dataset.focal)); }
  setFocal(lensOf(zoom));

  const setState = (state, message) => {
    fig.dataset.state = state;
    status.textContent = message ?? '';
    start.hidden = state === 'live' || state === 'starting';
    stopBtn.hidden = state !== 'live' && state !== 'starting';
    copyBtn.hidden = state !== 'live';
    inlinePre.hidden = !(state === 'live' && out === inlinePre);
    if (stage) stage.status.textContent = state === 'live' ? message ?? '' : '';
  };

  /** The big view: nearly the whole window, with the picture as large as fits and in its true shape. */
  function openStage() {
    const dlg = document.createElement('dialog');
    dlg.className = 'mirror-stage';
    dlg.setAttribute('aria-labelledby', 'mirror-stage-title');
    dlg.innerHTML = `
      <div class="ms-bar">
        <span class="ms-title" id="mirror-stage-title"></span>
        <span class="ms-status" role="status" aria-live="polite"></span>
        <span class="ms-focal" role="group">${FOCALS.map((f) => `<button type="button" class="ms-btn" data-focal="${f.mm}" aria-pressed="false">${f.mm}mm</button>`).join('')}</span>
        <button type="button" class="ms-btn ms-copy"></button>
        <button type="button" class="ms-btn ms-full" hidden></button>
        <button type="button" class="ms-btn ms-close">✕</button>
      </div>
      <div class="ms-view"><pre class="mirror-ascii ms-ascii" aria-hidden="true"></pre></div>`;
    document.body.append(dlg);
    const q = (sel) => dlg.querySelector(sel);
    stage = { dlg, view: q('.ms-view'), pre: q('.ms-ascii'), status: q('.ms-status'), full: q('.ms-full') };
    q('.ms-title').textContent = t.label;
    if (t.focal) q('.ms-focal').setAttribute('aria-label', t.focal);
    for (const b of dlg.querySelectorAll('[data-focal]')) b.addEventListener('click', () => setFocal(b.dataset.focal));
    setFocal(lensOf(zoom));
    q('.ms-copy').textContent = t.copyShort;
    q('.ms-copy').addEventListener('click', copy);
    q('.ms-close').setAttribute('aria-label', t.closeStage);
    q('.ms-close').title = t.closeStage;
    q('.ms-close').addEventListener('click', () => stop());
    const canFull = typeof dlg.requestFullscreen === 'function' || typeof dlg.webkitRequestFullscreen === 'function';
    if (canFull) {
      stage.full.hidden = false;
      stage.full.textContent = '⛶';
      stage.full.setAttribute('aria-label', t.fullscreen);
      stage.full.title = t.fullscreen;
      stage.full.addEventListener('click', () => {
        const el = document.fullscreenElement ?? document.webkitFullscreenElement;
        if (el) (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
        else (dlg.requestFullscreen ?? dlg.webkitRequestFullscreen).call(dlg);
      });
    }
    dlg.addEventListener('close', () => { if (live) stop(); }); // Esc or the close button: leaving the big view turns the camera off
    dlg.addEventListener('cancel', () => { /* Esc: the close event follows */ });
    try {
      dlg.showModal();
    } catch {
      dlg.remove();
      stage = null;
      return false;
    }
    out = stage.pre;
    return true;
  }

  function onFullscreenChange() {
    const el = document.fullscreenElement ?? document.webkitFullscreenElement;
    full = Boolean(stage && el === stage.dlg);
    metrics = ''; // the density changes, so the font is worked out again
    measure();
  }

  function closeStage() {
    if (!stage) return;
    const { dlg } = stage;
    stage = null;
    out = inlinePre;
    if ((document.fullscreenElement ?? document.webkitFullscreenElement) === dlg) (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
    if (dlg.open) dlg.close();
    dlg.remove();
  }

  function measure() {
    if (stage) { viewW = Math.max(1, stage.view.clientWidth - 16); viewH = Math.max(1, stage.view.clientHeight - 16); }
    else { viewW = out.parentElement?.clientWidth || fig.clientWidth || 320; viewH = Math.round(innerHeight * 0.6); }
  }

  function release() {
    startToken = null;
    clearTimeout(slowTimer);
    if (stream || live) releasedAt = Date.now();
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    live = false;
    observer?.disconnect();
    observer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    removeEventListener('pagehide', onPageHide);
    removeEventListener('resize', measure);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    closeStage();
    if (active === api) active = null;
  }

  function stop(message = t.off) {
    release();
    setState('off', message);
  }

  function onPageHide() { stop(); }

  function onVisibility() {
    if (document.hidden && live) stop(t.pausedHidden); // never keep the camera on in a hidden tab
  }

  /** Draw what the lens sees, flipped like a mirror (your left is on the left), into a w x h canvas. */
  function drawLens(ctx, w, h) {
    const c = cropFor(video.videoWidth, video.videoHeight, zoom);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, -w, 0, w, h);
    ctx.restore();
  }

  /** The current frame as text `cols` wide, worked out once (the shutter can afford more detail than the live view). */
  function capture(cols) {
    if (!live || !video.videoWidth) return null;
    const c = Math.max(COLUMN_STEPS[0], Math.round(Number(cols) || 0));
    const rows = mirrorRows(c, video.videoWidth, video.videoHeight);
    const w = c * SAMPLES_PER_CHAR;
    const h = rows * SAMPLES_PER_CHAR;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    drawLens(cx, w, h);
    return frameLetters({ data: cx.getImageData(0, 0, w, h).data, width: w, height: h }, { cols: c, invert: getInvert() });
  }

  function frame(now) {
    if (!live) return;
    if (!fig.isConnected) { release(); return; } // the page moved on: let go of the camera
    raf = requestAnimationFrame(frame);
    const budget = 1000 / mirrorFps(reduceMotion);
    // The frame rate only slows once the letters cannot get any coarser (or a frame is very expensive): see adaptStep.
    const wait = step.idx > 0 && avgCost < budget * 0.6 ? budget : frameInterval(avgCost, mirrorFps(reduceMotion));
    if (now - last < wait) return;
    last = now;
    if (!video.videoWidth) return;
    const t0 = performance.now();
    const ratio = video.videoHeight / video.videoWidth;
    const box = fitBox(viewW, viewH, ratio); // as large as the view allows, in the camera's own shape
    const tier = stage ? (full ? DENSITY.full : DENSITY.stage) : DENSITY.inline;
    const roomIdx = COLUMN_STEPS.indexOf(snapColumns(mirrorColumns(box.w, tier)));
    const eff = Math.min(step.idx, roomIdx); // what the space allows, capped by what the device can afford
    const cols = COLUMN_STEPS[eff];
    const rows = mirrorRows(cols, video.videoWidth, video.videoHeight);
    const w = cols * SAMPLES_PER_CHAR;
    const h = rows * SAMPLES_PER_CHAR;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    drawLens(g, w, h);
    const { data } = g.getImageData(0, 0, w, h);
    const t1 = performance.now();
    const text = frameLetters({ data, width: w, height: h }, { cols, invert: getInvert() });
    const t2 = performance.now();
    if (text !== shown) { out.textContent = text; shown = text; shownCols = cols; }
    // The same sizing rule as the pictures: `cols` characters span the box exactly, so the letters cover the picture and nothing more.
    // Only worked out again when something changed.
    const key = `${cols}x${rows}@${box.w}x${box.h}`;
    if (key !== metrics) {
      metrics = key;
      if (!out.dataset.cw) {
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = `100px ${getComputedStyle(out).fontFamily}`;
        out.dataset.cw = String((probe.measureText('M').width || 60) / 100);
      }
      out.style.width = `${box.w}px`;
      out.style.height = `${box.h}px`;
      out.style.fontSize = `${box.w / (cols * Number(out.dataset.cw))}px`;
      out.style.lineHeight = `${box.h / rows}px`;
    }
    const t3 = performance.now();
    avgCost = smooth(avgCost, t3 - t0);
    if (lastProcessed) avgGap = smooth(avgGap, now - lastProcessed);
    lastProcessed = now;
    if (++sinceAdapt >= 10) { // every so often: is the picture too detailed for this device, or could it be finer?
      sinceAdapt = 0;
      const next = adaptStep({ ...step, idx: eff }, avgCost, avgGap, budget);
      // A drop always counts; a climb only matters when the device, not the space, was the limit.
      step = { ...next, idx: next.idx < eff || eff === step.idx ? next.idx : step.idx };
    }
    perf.read += t1 - t0; perf.text += t2 - t1; perf.dom += t3 - t2; perf.n++;
    if (perf.n === 30) { fig.dataset.perf = JSON.stringify({ read: +(perf.read / 30).toFixed(2), text: +(perf.text / 30).toFixed(2), dom: +(perf.dom / 30).toFixed(2), interval: Math.round(frameInterval(avgCost, mirrorFps(reduceMotion))), cols, rows, step: step.idx, focal: lensOf(zoom), gap: Math.round(avgGap), full }); perf.read = perf.text = perf.dom = perf.n = 0; }
  }

  async function begin() {
    if (active && active !== api) active.stop();
    if (!window.isSecureContext) { setState('error', t.errors.insecure); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState('error', t.errors.unsupported); return; }
    const token = {};
    startToken = token;
    setState('starting', t.starting);
    slowTimer = setTimeout(() => { if (startToken === token) status.textContent = t.slowStart; }, SLOW_START_MS);
    try {
      const wait = releasedAt + COOLDOWN_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait)); // let the camera finish switching off
      if (startToken !== token) return; // stopped while waiting
      fig.dataset.phase = 'asking';
      const got = await openCamera();
      fig.dataset.phase = 'opened';
      if (startToken !== token || !fig.isConnected) { got.getTracks().forEach((track) => track.stop()); return; } // stopped, or the page moved on, while the browser was asking
      clearTimeout(slowTimer);
      stream = got;
      video.srcObject = stream;
      // Not awaited: a video that is slow to start must not leave the page "waiting for the camera" for ever. The frame loop
      // simply waits until the first picture has arrived.
      video.play()?.catch(() => { /* autoplay is on as well; the loop starts when a picture is there */ });
      live = true;
      active = api;
      for (const el of [inlinePre]) { el.dataset.cw = ''; el.removeAttribute('style'); }
      shown = '';
      metrics = '';
      avgCost = 0;
      avgGap = 0;
      lastProcessed = 0;
      sinceAdapt = 0;
      step = { idx: COLUMN_STEPS.length - 1, over: 0, under: 0 };
      full = false;
      if (useStage) openStage(); // the big view (falls back to the page's own box if the browser cannot show a <dialog>)
      out.dataset.cw = '';
      setState('live', t.live);
      measure();
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      observer?.observe(stage ? stage.view : out.parentElement ?? fig);
      addEventListener('resize', measure);
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      document.addEventListener('visibilitychange', onVisibility);
      addEventListener('pagehide', onPageHide);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (live) stop(t.lost); });
      last = 0;
      raf = requestAnimationFrame(frame);
    } catch (e) {
      if (startToken !== token) return; // already stopped: nothing to report
      release();
      setState('error', t.errors[errorKey(e)] ?? t.errors.other);
    }
  }

  async function copy() {
    const text = out.textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    onCopied(ok);
  }

  start.addEventListener('click', begin);
  stopBtn.addEventListener('click', () => stop());
  copyBtn.addEventListener('click', copy);
  fig.addEventListener('keydown', (e) => { if (e.key === 'Escape' && live) { e.stopPropagation(); stop(); start.focus({ preventScroll: true }); } });
  setState('ready', '');

  const api = { stop, capture, get live() { return live; }, get focal() { return lensOf(zoom); }, get cols() { return shownCols; } };
  return api;
}
