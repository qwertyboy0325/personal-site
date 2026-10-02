// A live mirror made of letters: the visitor's own camera, drawn as ASCII, entirely on their device.
//
// Nothing is recorded, saved or sent anywhere: frames are read from the camera, turned into text
// and thrown away. The camera is only requested when the visitor presses "turn on camera", and it is
// released (the browser's camera light goes out) as soon as they stop, leave the page or hide the tab.
//
// The pure parts (size, text of a frame, error wording) are tested under Node; createMirror is the
// browser side.

import { imageToAscii } from './imgascii.js';

/** Characters per row for a mirror `widthPx` wide: about one per 7 px, 36 to 100. */
export function mirrorColumns(widthPx) {
  const w = Number(widthPx);
  if (!Number.isFinite(w) || w <= 0) return 36;
  return Math.min(100, Math.max(36, Math.round(w / 7)));
}

/** Rows for `cols` characters over a video of `videoW` x `videoH` (characters are about twice as tall as wide). */
export function mirrorRows(cols, videoW, videoH) {
  if (!(videoW > 0) || !(videoH > 0)) return Math.max(1, Math.round(cols * 0.375));
  return Math.max(1, Math.round(cols * (videoH / videoW) * 0.5));
}

/** One frame (RGBA pixels, already flipped like a mirror) as text. */
export function frameLetters(px, { cols, invert = false } = {}) {
  return imageToAscii(px, { cols, invert, detail: 1, clip: 0.02 });
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

export function stopMirror() {
  active?.stop();
}

/**
 * Wire up a mirror figure (see renderMirror in render.js). `getInvert()` says whether the light theme is on;
 * `t` holds the wording (status, errors, toast text); `onCopied(ok)` is told how copying went.
 */
export function createMirror(fig, { t, getInvert = () => false, reduceMotion = false, onCopied = () => {} }) {
  const pre = fig.querySelector('.mirror-ascii');
  const start = fig.querySelector('[data-mirror-start]');
  const stopBtn = fig.querySelector('[data-mirror-stop]');
  const copyBtn = fig.querySelector('[data-mirror-copy]');
  const status = fig.querySelector('.mirror-status');
  const video = document.createElement('video');
  video.muted = true;
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
  let boxW = 0;          // width of the letters' box, kept up to date by the observer (no layout read per frame)
  let shown = '';        // the text on screen: an unchanged frame is not written again
  let metrics = '';      // the cols/rows/width the font size was last set for
  let observer = null;

  const setState = (state, message) => {
    fig.dataset.state = state;
    status.textContent = message ?? '';
    start.hidden = state === 'live' || state === 'starting';
    stopBtn.hidden = state !== 'live';
    copyBtn.hidden = state !== 'live';
    pre.hidden = state !== 'live';
  };

  function release() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    live = false;
    observer?.disconnect();
    observer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    removeEventListener('pagehide', onPageHide);
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
    const cols = mirrorColumns(boxW);
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
    if (text !== shown) { pre.textContent = text; shown = text; }
    // The same sizing rule as the pictures: `cols` characters span the box exactly. Only worked out again when something changed.
    const key = `${cols}x${rows}@${boxW}`;
    if (key !== metrics) {
      metrics = key;
      if (!pre.dataset.cw) {
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = `100px ${getComputedStyle(pre).fontFamily}`;
        pre.dataset.cw = String((probe.measureText('M').width || 60) / 100);
      }
      pre.style.fontSize = `${boxW / (cols * Number(pre.dataset.cw))}px`;
      pre.style.lineHeight = `${(boxW * (video.videoHeight / video.videoWidth)) / rows}px`;
    }
    const t3 = performance.now();
    avgCost = smooth(avgCost, t3 - t0);
    perf.read += t1 - t0; perf.text += t2 - t1; perf.dom += t3 - t2; perf.n++;
    if (perf.n === 30) { fig.dataset.perf = JSON.stringify({ read: +(perf.read / 30).toFixed(2), text: +(perf.text / 30).toFixed(2), dom: +(perf.dom / 30).toFixed(2), interval: Math.round(frameInterval(avgCost, mirrorFps(reduceMotion))) }); perf.read = perf.text = perf.dom = perf.n = 0; }
  }

  async function begin() {
    if (active && active !== api) active.stop();
    if (!window.isSecureContext) { setState('error', t.errors.insecure); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState('error', t.errors.unsupported); return; }
    setState('starting', t.starting);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!fig.isConnected) { release(); return; } // closed while the browser was asking
      video.srcObject = stream;
      await video.play();
      live = true;
      active = api;
      pre.dataset.cw = '';
      shown = '';
      metrics = '';
      avgCost = 0;
      setState('live', t.live); // shows the box, so its width can be read
      boxW = pre.clientWidth || fig.clientWidth;
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { boxW = pre.clientWidth || boxW; }) : null;
      observer?.observe(pre);
      document.addEventListener('visibilitychange', onVisibility);
      addEventListener('pagehide', onPageHide);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (live) stop(t.lost); });
      last = 0;
      raf = requestAnimationFrame(frame);
    } catch (e) {
      release();
      setState('error', t.errors[errorKey(e)] ?? t.errors.other);
    }
  }

  async function copy() {
    const text = pre.textContent;
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
