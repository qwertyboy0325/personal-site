// Pure helpers for the page's light and motion: colour temperature, exposure readouts that tick to the real values,
// headings that decode out of the character ramp, and pictures that develop in resolution steps. No DOM, so it runs
// (and is tested) under Node; src/site.js draws with it.

/** Darkest to brightest. The same ramp the terminal pictures use (src/fx/imgascii.js). */
export const RAMP = ' .:-=+*#%@';
/** The same ramp in full-width characters, so a decoding CJK heading keeps its width. */
export const RAMP_WIDE = '　．：－＝＋＊＃％＠';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** `theme` values that name a temperature ('2700k' -> 2700), or null. */
export const kelvinOf = (theme) => (/^\d{4}k$/.test(String(theme)) ? Number(String(theme).slice(0, 4)) : null);

/** The page's light by the visitor's local hour: cool white by day, warmer through the evening, deep orange at night. */
export function kelvinForHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h >= 7 && h < 16) return 5200;
  if (h >= 16 && h < 20) return 3400;
  if (h >= 20 || h < 1) return 2700;
  return 2200;
}

/** The warm accent for a temperature: four tones chosen to sit on the dark page, nearest one wins. */
const SUN = [[5200, '#ffe0b8'], [3400, '#ffc27a'], [2700, '#ffb468'], [2200, '#ffa556']];
export function sunColor(kelvin) {
  const k = Number(kelvin) || 3400;
  return SUN.reduce((best, cur) => (Math.abs(cur[0] - k) < Math.abs(best[0] - k) ? cur : best))[1];
}

/** "21:05" from a Date. */
export const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * An exposure readout part way to its real value, as if the camera were still metering. `t` goes 0 -> 1.
 * Aperture closes in from f/22, shutter speeds up from one second; both land exactly on the real values.
 */
export function tickExposure({ focal = '', aperture = '', shutter = '' }, t) {
  const k = clamp(t, 0, 1);
  const parts = [];
  if (focal !== '') parts.push(`${focal}mm`);
  const a = Number(aperture);
  if (aperture !== '' && Number.isFinite(a) && a > 0) {
    const v = k >= 1 ? a : 22 * Math.pow(a / 22, k); // even steps in stops, not in numbers
    parts.push(`f/${k >= 1 ? aperture : (Math.round(v * 10) / 10).toString()}`);
  }
  if (shutter !== '') {
    const m = /^1\/(\d+)$/.exec(String(shutter));
    if (m && k < 1) {
      const d = Math.pow(Number(m[1]), k);
      parts.push(d < 1.5 ? '1"' : `1/${Math.round(d)}`);
    } else parts.push(String(shutter));
  }
  return parts.join(' · ');
}

/** Parse `data-exif="35|1.8|1/3200"`. */
export function parseExif(text) {
  const [focal = '', aperture = '', shutter = ''] = String(text ?? '').split('|');
  return { focal, aperture, shutter };
}

const isWide = (c) => c.charCodeAt(0) > 0x2e7f;

/**
 * One frame of a heading decoding out of the ramp: each character starts dark, brightens, and lands on itself,
 * left to right. `rand()` in [0, 1) adds flicker; pass a fixed function for a repeatable frame.
 */
export function decodeFrame(text, t, rand = Math.random) {
  const chars = [...String(text)];
  const n = chars.length || 1;
  return chars.map((c, i) => {
    const k = clamp((t - (i / n) * 0.6) / 0.4, 0, 1);
    if (c === ' ' || c === '\n' || k >= 1) return c;
    const ramp = isWide(c) ? RAMP_WIDE : RAMP;
    return ramp[1 + Math.min(8, Math.floor(k * 9 + rand() * 1.5))];
  }).join('');
}

/** The resolution (characters per row) a developing picture shows at `t`, climbing through `steps`. */
export function developStep(steps, t) {
  const k = clamp(t, 0, 1);
  return steps[Math.min(steps.length - 1, Math.floor(k * steps.length))];
}

/** Ramp index for a brightness in [0, 1]. */
export const rampIndex = (lum) => Math.min(RAMP.length - 1, Math.max(0, Math.floor(Math.pow(clamp(lum, 0, 1), 0.9) * RAMP.length)));
