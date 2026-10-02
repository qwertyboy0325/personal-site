// Turn an image into characters. `imageToAscii` is pure: it takes raw RGBA pixels
// (what canvas.getImageData returns) and gives back a string, so it can be tested
// under Node. `asciiFromImage` is the thin browser wrapper that reads the pixels.

export const IMG_RAMP = ' .:-=+*#%@';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How many characters per row for a picture `widthPx` wide on screen. About one character per 7 px:
 * detailed enough to recognise the picture, still clearly made of letters. Clamped so a tiny
 * picture is not mush and a huge one is not a wall of text.
 */
export function asciiColumns(widthPx, { cell = 7, min = 40, max = 110 } = {}) {
  const w = Number(widthPx);
  if (!Number.isFinite(w) || w <= 0) return min;
  return clamp(Math.round(w / cell), min, max);
}

/**
 * @param {{ data: ArrayLike<number>, width: number, height: number }} px  RGBA pixels
 * @param {object} [o]
 * @param {number} [o.cols=64]        characters per row
 * @param {string} [o.ramp]           dark -> bright characters
 * @param {boolean} [o.invert=false]  bright pixels use the sparse end (dark text on a light page)
 * @param {number} [o.cellAspect=0.5] width / height of one character cell
 * @param {boolean} [o.stretch=true]  stretch the contrast so flat images still show detail
 * @param {number} [o.detail=0]       0..2: sharpen by this much (a character is compared with its neighbours, so outlines and faces stand out)
 * @param {number} [o.gamma=1]        brightness curve after stretching: below 1 lifts the shadows, above 1 deepens them
 * @param {number} [o.clip=0]         0..0.2: ignore this share of the darkest and brightest cells when stretching (one glare spot must not wash out the picture)
 */
export function imageToAscii(px, { cols = 64, ramp = IMG_RAMP, invert = false, cellAspect = 0.5, stretch = true, detail = 0, clip = 0, gamma = 1 } = {}) {
  const { data, width, height } = px ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError('image needs a positive integer width and height');
  if (!data || data.length < width * height * 4) throw new RangeError('pixel data is shorter than width x height x 4');
  const c = Math.max(1, Math.floor(Number.isFinite(cols) ? cols : 64));
  const r = Math.max(1, Math.round(c * (height / width) * (Number.isFinite(cellAspect) && cellAspect > 0 ? cellAspect : 0.5)));
  const n = ramp.length;

  // Average the luminance of every pixel that falls inside each character cell.
  // Fully opaque pixels (nearly all of them) only add up their channels; the weighting is applied once per cell, not once per pixel.
  const x0s = new Int32Array(c);
  const x1s = new Int32Array(c);
  for (let cx = 0; cx < c; cx++) {
    x0s[cx] = Math.floor((cx * width) / c);
    x1s[cx] = Math.min(width, Math.max(x0s[cx] + 1, Math.floor(((cx + 1) * width) / c)));
  }
  const lum = new Float64Array(c * r);
  for (let cy = 0; cy < r; cy++) {
    const y0 = Math.floor((cy * height) / r);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor(((cy + 1) * height) / r)));
    for (let cx = 0; cx < c; cx++) {
      const xa = x0s[cx];
      const xb = x1s[cx];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let other = 0; // translucent pixels, weighted one by one (transparent counts as black)
      for (let y = y0; y < y1; y++) {
        for (let i = (y * width + xa) * 4, end = (y * width + xb) * 4; i < end; i += 4) {
          const a = data[i + 3];
          if (a === 255) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
          else if (a !== 0) other += (((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) * a) / 255;
        }
      }
      const count = (y1 - y0) * (xb - xa);
      lum[cy * c + cx] = count > 0 ? ((0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 255 + other) / count : 0;
    }
  }

  // Unsharp mask: push every cell away from the average of its neighbours, so edges and shapes survive the coarse grid.
  const amount = Number.isFinite(detail) ? clamp(detail, 0, 2) : 0;
  if (amount > 0) {
    const mean = boxBlur(boxBlur(lum, c, r, true), c, r, false);
    for (let i = 0; i < lum.length; i++) lum[i] += amount * (lum[i] - mean[i]);
  }

  let lo = 0;
  let hi = 1;
  if (stretch) {
    const trim = Number.isFinite(clip) ? clamp(clip, 0, 0.2) : 0;
    if (trim > 0) {
      const sorted = lum.slice().sort();
      lo = sorted[Math.floor(trim * (sorted.length - 1))];
      hi = sorted[Math.ceil((1 - trim) * (sorted.length - 1))];
    } else {
      lo = Infinity;
      hi = -Infinity;
      for (let i = 0; i < lum.length; i++) { const v = lum[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const span = hi - lo;
  const flat = stretch && span < 1e-9; // one solid colour: there is nothing to stretch, so use its real brightness

  const g = Number.isFinite(gamma) && gamma > 0 ? clamp(gamma, 0.3, 3) : 1;
  const top = n - 1;
  const scale = span || 1;
  const lines = new Array(r);
  for (let cy = 0; cy < r; cy++) {
    let line = '';
    for (let cx = 0; cx < c; cx++) {
      let v = flat ? lum[cy * c + cx] : (lum[cy * c + cx] - lo) / scale;
      if (g !== 1 && v > 0) v = clamp(v, 0, 1) ** g;
      let level = Math.round((Number.isFinite(v) ? v : 0) * top);
      level = level < 0 ? 0 : level > top ? top : level;
      line += ramp[invert ? top - level : level];
    }
    lines[cy] = line.trimEnd();
  }
  return lines.join('\n');
}

/** Mean of each cell and its neighbours within 3 cells along one direction (shorter at the edges), in one pass using running sums. */
function boxBlur(src, w, h, horizontal, radius = 3) {
  const out = new Float64Array(src.length);
  const len = horizontal ? w : h;
  const prefix = new Float64Array(len + 1);
  const lines = horizontal ? h : w;
  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < len; k++) prefix[k + 1] = prefix[k] + src[horizontal ? line * w + k : k * w + line];
    for (let k = 0; k < len; k++) {
      const lo = k - radius < 0 ? 0 : k - radius;
      const hi = k + radius > len - 1 ? len - 1 : k + radius;
      out[horizontal ? line * w + k : k * w + line] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    }
  }
  return out;
}

/** Browser helper: read an <img> through a small canvas and convert it. */
export function asciiFromImage(img, o = {}) {
  const cols = o.cols ?? 64;
  const w = Math.min(img.naturalWidth || img.width, cols * 8); // plenty of pixels per cell, far fewer than the full image
  const h = Math.max(1, Math.round(w * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width))));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return imageToAscii({ data, width: w, height: h }, { detail: 1.6, clip: 0.03, ...o });
}

/** A small least-recently-used cache for finished pictures-in-letters (key: picture, columns, theme). */
export function createAsciiCache(limit = 48) {
  const map = new Map();
  return {
    key: (slug, cols, invert) => `${slug}|${cols}|${invert ? 1 : 0}`,
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value); // now the most recently used
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    has: (key) => map.has(key),
    get size() { return map.size; },
  };
}
