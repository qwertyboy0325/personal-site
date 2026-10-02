// Turn an image into characters. `imageToAscii` is pure: it takes raw RGBA pixels
// (what canvas.getImageData returns) and gives back a string, so it can be tested
// under Node. `asciiFromImage` is the thin browser wrapper that reads the pixels.

export const IMG_RAMP = ' .:-=+*#%@';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {{ data: ArrayLike<number>, width: number, height: number }} px  RGBA pixels
 * @param {object} [o]
 * @param {number} [o.cols=64]        characters per row
 * @param {string} [o.ramp]           dark -> bright characters
 * @param {boolean} [o.invert=false]  bright pixels use the sparse end (dark text on a light page)
 * @param {number} [o.cellAspect=0.5] width / height of one character cell
 * @param {boolean} [o.stretch=true]  stretch the contrast so flat images still show detail
 */
export function imageToAscii(px, { cols = 64, ramp = IMG_RAMP, invert = false, cellAspect = 0.5, stretch = true } = {}) {
  const { data, width, height } = px ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError('image needs a positive integer width and height');
  if (!data || data.length < width * height * 4) throw new RangeError('pixel data is shorter than width x height x 4');
  const c = Math.max(1, Math.floor(Number.isFinite(cols) ? cols : 64));
  const r = Math.max(1, Math.round(c * (height / width) * (Number.isFinite(cellAspect) && cellAspect > 0 ? cellAspect : 0.5)));
  const n = ramp.length;

  // Average the luminance of every pixel that falls inside each character cell.
  const lum = new Float64Array(c * r);
  for (let cy = 0; cy < r; cy++) {
    const y0 = Math.floor((cy * height) / r);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / r));
    for (let cx = 0; cx < c; cx++) {
      const x0 = Math.floor((cx * width) / c);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / c));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          const a = data[i + 3] / 255; // transparent pixels count as black
          sum += ((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) * a;
          count++;
        }
      }
      lum[cy * c + cx] = count ? sum / count : 0;
    }
  }

  let lo = 0;
  let hi = 1;
  if (stretch) {
    lo = Infinity;
    hi = -Infinity;
    for (const v of lum) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const span = hi - lo;
  const flat = stretch && span < 1e-9; // one solid colour: there is nothing to stretch, so use its real brightness

  const lines = [];
  for (let cy = 0; cy < r; cy++) {
    let line = '';
    for (let cx = 0; cx < c; cx++) {
      const v = flat ? lum[cy * c + cx] : (lum[cy * c + cx] - lo) / (span || 1);
      const level = clamp(Math.round((Number.isFinite(v) ? v : 0) * (n - 1)), 0, n - 1);
      line += ramp[invert ? n - 1 - level : level];
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
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
  return imageToAscii({ data, width: w, height: h }, o);
}
