// A tiny 3D engine that draws in characters: sample points on a surface, rotate
// them, project with perspective, resolve occlusion with a z-buffer, and map
// the Lambert brightness of each surface to a character ramp.
//
// `rasterize` / `renderFrame` are pure (same input, same string), so they are
// easy to test under Node. `startAscii3d` drives them in the browser.

export const SHAPES = ['donut', 'cube', 'sphere'];
export const SIZE = { cols: 56, rows: 26 };
export const RAMP = ' .,-~:;=!*#$@';

// Direction from the surface towards the light: upper left, in front of the model.
const LIGHT = (() => { const v = [-0.4, 0.6, -0.7]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

const cache = new Map();

/** Surface samples for a shape: [{ x, y, z, nx, ny, nz }, ...] (cached; do not mutate). */
export function surfacePoints(shape) {
  if (!SHAPES.includes(shape)) throw new RangeError(`unknown shape: ${shape}`);
  if (cache.has(shape)) return cache.get(shape);
  const pts = [];
  if (shape === 'donut') {
    const R = 1.0;
    const r = 0.42;
    for (let th = 0; th < TAU; th += 0.045) {
      for (let ph = 0; ph < TAU; ph += 0.09) {
        const ct = Math.cos(th);
        const st = Math.sin(th);
        const cp = Math.cos(ph);
        const sp = Math.sin(ph);
        pts.push({ x: (R + r * cp) * ct, y: r * sp, z: (R + r * cp) * st, nx: cp * ct, ny: sp, nz: cp * st });
      }
    }
  } else if (shape === 'cube') {
    const h = 0.85;
    const n = 34;
    for (let a = 0; a <= n; a++) {
      for (let b = 0; b <= n; b++) {
        const u = -h + (2 * h * a) / n;
        const v = -h + (2 * h * b) / n;
        for (const s of [-1, 1]) {
          pts.push({ x: s * h, y: u, z: v, nx: s, ny: 0, nz: 0 });
          pts.push({ x: u, y: s * h, z: v, nx: 0, ny: s, nz: 0 });
          pts.push({ x: u, y: v, z: s * h, nx: 0, ny: 0, nz: s });
        }
      }
    }
  } else {
    const r = 1.2;
    for (let la = 0; la <= Math.PI; la += 0.05) {
      for (let lo = 0; lo < TAU; lo += 0.05) {
        const x = Math.sin(la) * Math.cos(lo);
        const y = Math.cos(la);
        const z = Math.sin(la) * Math.sin(lo);
        pts.push({ x: x * r, y: y * r, z: z * r, nx: x, ny: y, nz: z });
      }
    }
  }
  cache.set(shape, pts);
  return pts;
}

/**
 * Draw `points` to a string of `rows` lines, each at most `cols` characters.
 * Angles are in radians (rotation about X, then Y, then Z). With `invert`,
 * lit surfaces use the sparse characters (for dark text on a light page).
 */
export function rasterize(points, o = {}) {
  const cols = Math.max(1, Math.floor(finite(o.cols, SIZE.cols)));
  const rows = Math.max(1, Math.floor(finite(o.rows, SIZE.rows)));
  const ax = finite(o.ax);
  const ay = finite(o.ay);
  const az = finite(o.az);
  const ramp = o.ramp ?? RAMP;
  const dist = finite(o.dist, 4.2);
  const scale = finite(o.scale, cols * 0.8);
  const n = ramp.length;
  const [cxr, sxr] = [Math.cos(ax), Math.sin(ax)];
  const [cyr, syr] = [Math.cos(ay), Math.sin(ay)];
  const [czr, szr] = [Math.cos(az), Math.sin(az)];

  const depth = new Float32Array(cols * rows).fill(Infinity);
  const light = new Float32Array(cols * rows).fill(-1);

  const rot = (x, y, z) => {
    let y1 = y * cxr - z * sxr;
    let z1 = y * sxr + z * cxr;
    const x2 = x * cyr + z1 * syr;
    z1 = -x * syr + z1 * cyr;
    const x3 = x2 * czr - y1 * szr;
    y1 = x2 * szr + y1 * czr;
    return [x3, y1, z1];
  };

  for (const p of points) {
    const [x, y, z] = rot(p.x, p.y, p.z);
    const d = z + dist; // the camera sits at z = -dist, looking towards +z
    if (d <= 0.1) continue;
    // Cell k covers [k, k+1), so floor() (not round()) keeps the model centred on the grid.
    const sx = Math.floor(cols / 2 + (scale * x) / d);
    const sy = Math.floor(rows / 2 - (scale * 0.5 * y) / d); // character cells are about twice as tall as wide
    if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
    const idx = sy * cols + sx;
    if (d >= depth[idx]) continue; // something nearer is already there
    depth[idx] = d;
    const [nx, ny, nz] = rot(p.nx, p.ny, p.nz);
    light[idx] = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  }

  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const l = light[r * cols + c];
      if (l === -1 && depth[r * cols + c] === Infinity) { line += ' '; continue; }
      const level = 1 + Math.round(clamp(l) * (n - 2)); // every surface shows at least the dimmest mark
      line += ramp[o.invert ? n - level : level];
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** One frame of a named shape. */
export const renderFrame = ({ shape = 'donut', ...o } = {}) => rasterize(surfacePoints(shape), o);

/** A pleasant resting pose for static (no-animation) output. */
export const REST_POSE = { ax: 0.55, ay: 0.7, az: 0.1 };

/**
 * Animate a model into <pre> `el`. The pointer steers the spin; without it the
 * model turns by itself. Returns { stop, setShape }.
 */
export function startAscii3d(el, { shape = 'donut', getPointer = () => null, getTheme = () => 'dark', reduceMotion = false } = {}) {
  let current = SHAPES.includes(shape) ? shape : 'donut';
  const pose = { ...REST_POSE };
  let raf = 0;
  let stopped = false;
  let last = 0;
  let lastDraw = 0;

  const draw = () => {
    el.textContent = renderFrame({ shape: current, ...pose, invert: getTheme() === 'light' });
  };

  if (reduceMotion) {
    draw();
    return { stop() {}, setShape(s) { if (SHAPES.includes(s)) { current = s; draw(); } } };
  }

  const frame = (now) => {
    if (stopped) return;
    if (!el.isConnected) { stop(); return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (now - lastDraw < 33) return; // ~30fps is plenty for ASCII
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return; // off screen: do no work
    lastDraw = now;

    let px = 0;
    let py = 0;
    const p = getPointer();
    if (p) {
      px = clamp((p.x - (rect.left + rect.width / 2)) / (innerWidth / 2), -1, 1);
      py = clamp((p.y - (rect.top + rect.height / 2)) / (innerHeight / 2), -1, 1);
    }
    pose.ay += dt * (0.7 + px * 2.2);
    pose.ax += dt * (0.35 + py * 1.4);
    draw();
  };
  raf = requestAnimationFrame(frame);

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
  }
  return { stop, setShape(s) { if (SHAPES.includes(s)) current = s; } };
}
