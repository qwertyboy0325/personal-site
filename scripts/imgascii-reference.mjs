// The straightforward (slow, obviously correct) version of imageToAscii in src/fx/imgascii.js.
// It exists only as an oracle for the tests: the fast version must give exactly the same text.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const IMG_RAMP = ' .:-=+*#%@';

export function referenceImageToAscii(px, { cols = 64, ramp = IMG_RAMP, invert = false, cellAspect = 0.5, stretch = true, detail = 0, clip = 0, gamma = 1 } = {}) {
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

  // Unsharp mask: push every cell away from the average of its neighbours, so edges and shapes survive the coarse grid.
  const amount = Number.isFinite(detail) ? clamp(detail, 0, 2) : 0;
  if (amount > 0) {
    const radius = 3;
    const blur = (src, w, h, horizontal) => {
      const out = new Float64Array(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let n = 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? x + d : x;
            const yy = horizontal ? y : y + d;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += src[yy * w + xx];
            n++;
          }
          out[y * w + x] = sum / n;
        }
      }
      return out;
    };
    const mean = blur(blur(lum, c, r, true), c, r, false);
    for (let i = 0; i < lum.length; i++) lum[i] = lum[i] + amount * (lum[i] - mean[i]);
  }

  let lo = 0;
  let hi = 1;
  if (stretch) {
    const trim = Number.isFinite(clip) ? clamp(clip, 0, 0.2) : 0;
    if (trim > 0) {
      const sorted = Float64Array.from(lum).sort();
      lo = sorted[Math.floor(trim * (sorted.length - 1))];
      hi = sorted[Math.ceil((1 - trim) * (sorted.length - 1))];
    } else {
      lo = Infinity;
      hi = -Infinity;
      for (const v of lum) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const span = hi - lo;
  const flat = stretch && span < 1e-9; // one solid colour: there is nothing to stretch, so use its real brightness

  const g = Number.isFinite(gamma) && gamma > 0 ? clamp(gamma, 0.3, 3) : 1;
  const lines = [];
  for (let cy = 0; cy < r; cy++) {
    let line = '';
    for (let cx = 0; cx < c; cx++) {
      let v = flat ? lum[cy * c + cx] : (lum[cy * c + cx] - lo) / (span || 1);
      if (g !== 1 && v > 0) v = clamp(v, 0, 1) ** g;
      const level = clamp(Math.round((Number.isFinite(v) ? v : 0) * (n - 1)), 0, n - 1);
      line += ramp[invert ? n - 1 - level : level];
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

