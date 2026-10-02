// A live mirror made of letters: the visitor's own camera, drawn as ASCII, entirely on their device.
//
// Nothing is recorded, saved or sent anywhere: frames are read from the camera, turned into text
// and thrown away. The camera is only requested when the visitor presses "turn on camera", and it is
// released (the browser's camera light goes out) as soon as they stop, leave the page or hide the tab.
//
// The pure parts (size, text of a frame, error wording) are tested under Node; createMirror is the
// browser side.

import { imageToAscii } from './imgascii.js';

/** Characters per row for a mirror `widthPx` wide: about one per 7 px, 36 to 100 (more room in the big view: up to 140). */
export function mirrorColumns(widthPx, { cell = 7, min = 36, max = 100 } = {}) {
  const w = Number(widthPx);
  if (!Number.isFinite(w) || w <= 0) return min;
  return Math.min(max, Math.max(min, Math.round(w / cell)));
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
 */
export function createMirror(fig, { t, getInvert = () => false, reduceMotion = false, onCopied = () => {} }) {
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
  let startToken = null; // identifies the start in progress, so a camera that arrives after Stop or a page change is switched straight off
  let slowTimer = 0;
  let stage = null;      // the big view (a <dialog>) while the camera is on
  let out = inlinePre;   // where the letters are drawn: the big view, or the page's own box if the browser has no <dialog>

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
        <button type="button" class="ms-btn ms-copy"></button>
        <button type="button" class="ms-btn ms-full" hidden></button>
        <button type="button" class="ms-btn ms-close">✕</button>
      </div>
      <div class="ms-view"><pre class="mirror-ascii ms-ascii" aria-hidden="true"></pre></div>`;
    document.body.append(dlg);
    const q = (sel) => dlg.querySelector(sel);
    stage = { dlg, view: q('.ms-view'), pre: q('.ms-ascii'), status: q('.ms-status'), full: q('.ms-full') };
    q('.ms-title').textContent = t.label;
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

  function frame(now) {
    if (!live) return;
    if (!fig.isConnected) { release(); return; } // the page moved on: let go of the camera
    raf = requestAnimationFrame(frame);
    if (now - last < frameInterval(avgCost, mirrorFps(reduceMotion))) return;
    last = now;
    if (!video.videoWidth) return;
    const t0 = performance.now();
    const ratio = video.videoHeight / video.videoWidth;
    const box = fitBox(viewW, viewH, ratio); // as large as the view allows, in the camera's own shape
    const cols = mirrorColumns(box.w, stage ? { max: 140 } : {});
    const rows = mirrorRows(cols, video.videoWidth, video.videoHeight);
    const w = cols * SAMPLES_PER_CHAR;
    const h = rows * SAMPLES_PER_CHAR;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.save();
    g.scale(-1, 1); // like a mirror: your left is on the left
    g.drawImage(video, -w, 0, w, h);
    g.restore();
    const { data } = g.getImageData(0, 0, w, h);
    const t1 = performance.now();
    const text = frameLetters({ data, width: w, height: h }, { cols, invert: getInvert() });
    const t2 = performance.now();
    if (text !== shown) { out.textContent = text; shown = text; }
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
    perf.read += t1 - t0; perf.text += t2 - t1; perf.dom += t3 - t2; perf.n++;
    if (perf.n === 30) { fig.dataset.perf = JSON.stringify({ read: +(perf.read / 30).toFixed(2), text: +(perf.text / 30).toFixed(2), dom: +(perf.dom / 30).toFixed(2), interval: Math.round(frameInterval(avgCost, mirrorFps(reduceMotion))), cols, rows }); perf.read = perf.text = perf.dom = perf.n = 0; }
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
      openStage(); // the big view (falls back to the page's own box if the browser cannot show a <dialog>)
      out.dataset.cw = '';
      setState('live', t.live);
      measure();
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      observer?.observe(stage ? stage.view : out.parentElement ?? fig);
      addEventListener('resize', measure);
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

  const api = { stop, get live() { return live; } };
  return api;
}
