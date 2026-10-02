// Prepare a photograph for the site.
//
//   node scripts/add-photo.mjs <photo> [more photos...] [--slug name] [--out dir]
//
// For each photo this
//   1. converts it to sRGB (macOS `sips`) and fixes its rotation,
//   2. makes a 1600 px version and a 480 px thumbnail with ALL metadata removed
//      (GPS position, serial numbers, owner name, embedded thumbnail), using ImageMagick,
//   3. reads the camera and exposure details from the ORIGINAL, and
//   4. prints the entry to paste into `gallery` in src/content.js. You write the
//      titles, captions and alt text yourself; nothing is guessed.
//
// Requires macOS (`sips`) and ImageMagick (`brew install imagemagick`).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateSegments } from './jpeg-meta.mjs';

export const FULL_EDGE = 1600;
export const THUMB_EDGE = 480;
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** "18/10" -> 1.8, "50" -> 50, "(garbage)" -> null */
export function rational(text) {
  const m = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const v = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Shutter time text from "1/250", "2/1" or "0.5": "1/250", "2", "0.5". */
export function shutterText(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const v = Number(m[1]) / Number(m[2]);
    if (!(v > 0)) return null;
    if (v >= 1) return String(Math.round(v * 10) / 10);
    return `1/${Math.round(Number(m[2]) / Number(m[1]))}`;
  }
  return rational(t) === null ? null : String(rational(t));
}

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\0/g, '').trim();

/** The camera/exposure fields of a file (the allow-list in src/photos.js): only what is present and sensible. */
export function readShot(file) {
  const fmt = ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISOSpeedRatings', 'PhotographicSensitivity'].map((k) => `%[EXIF:${k}]`).join('\\n');
  const [make, model, lens, focal, fnum, exposure, iso, iso2] = run('magick', ['identify', '-format', fmt, `${file}[0]`]).split('\n');
  const shot = {};
  const mk = tidy(make);
  const md = tidy(model);
  if (md) shot.camera = mk && !md.toLowerCase().startsWith(mk.toLowerCase().split(' ')[0]) ? `${mk} ${md}` : md;
  if (tidy(lens)) shot.lens = tidy(lens);
  if (rational(focal)) shot.focal = Math.round(rational(focal) * 10) / 10;
  if (rational(fnum)) shot.aperture = Math.round(rational(fnum) * 10) / 10;
  if (shutterText(exposure)) shot.shutter = shutterText(exposure);
  const isoN = Number.parseInt(tidy(iso) || tidy(iso2), 10);
  if (Number.isInteger(isoN) && isoN > 0) shot.iso = isoN;
  return shot;
}

export function slugFor(file) {
  return basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
}

/** Convert one photo. Returns what the content.js entry needs. */
export function processPhoto(input, { outDir, slug = slugFor(input) } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'add-photo-'));
  try {
    const tmp = join(work, 'srgb.jpg');
    run('sips', ['-s', 'format', 'jpeg', '-m', SRGB, input, '--out', tmp]);
    const shot = readShot(tmp);
    mkdirSync(outDir, { recursive: true });
    const full = join(outDir, `photo-${slug}.jpg`);
    const thumb = join(outDir, `photo-${slug}-thumb.jpg`);
    const common = ['-auto-orient', '-strip', '-interlace', 'Plane', '-sampling-factor', '4:2:0'];
    run('magick', [tmp, ...common, '-resize', `${FULL_EDGE}x${FULL_EDGE}>`, '-quality', '82', full]);
    run('magick', [tmp, ...common, '-resize', `${THUMB_EDGE}x${THUMB_EDGE}>`, '-quality', '78', thumb]);
    const dims = (f) => run('magick', ['identify', '-format', '%w %h', f]).trim().split(' ').map(Number);
    const [width, height] = dims(full);
    const [thumbWidth, thumbHeight] = dims(thumb);
    for (const f of [full, thumb]) {
      const leaked = privateSegments(readFileSync(f));
      if (leaked.length) throw new Error(`${f} still contains ${leaked.map((s) => `${s.name}(${s.id})`).join(', ')}`);
    }
    return { slug: `photo-${slug}`, full, thumb, width, height, thumbWidth, thumbHeight, shot, kb: Math.round(statSync(full).size / 1024), thumbKb: Math.round(statSync(thumb).size / 1024) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The text to paste into `gallery`. Titles and captions are left for you to write. */
export function snippet(r, relDir = 'assets/gallery') {
  const shot = Object.entries(r.shot).map(([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v).replace(/^"|"$/g, "'").replace(/"/g, "'")}`).join(', ');
  return `  {
    slug: '${r.slug}',
    kind: 'image',
    set: 'photo',
    src: '${relDir}/${basename(r.full)}',
    width: ${r.width}, height: ${r.height},
    thumb: '${relDir}/${basename(r.thumb)}', thumbWidth: ${r.thumbWidth}, thumbHeight: ${r.thumbHeight},
    shot: { ${shot} },
    en: {
      title: '',   // short, plain: what it is
      caption: '', // one or two sentences; say where/what only if you are happy for it to be public
      alt: '',     // describe the picture for someone who cannot see it
    },
    zh: {
      title: '',
      caption: '',
      alt: '',
    },
  },`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i === -1) return null; const [, v] = args.splice(i, 2); return v ?? null; };
  const slug = take('--slug');
  const out = resolve(ROOT, take('--out') ?? 'assets/gallery');
  if (!args.length || args.some((a) => a.startsWith('--'))) {
    console.error('usage: node scripts/add-photo.mjs <photo> [more...] [--slug name] [--out dir]');
    process.exit(2);
  }
  if (slug && args.length > 1) { console.error('--slug works with a single photo'); process.exit(2); }
  for (const file of args) {
    const r = processPhoto(resolve(file), { outDir: out, ...(slug ? { slug } : {}) });
    console.error(`${basename(file)} -> ${r.width}x${r.height} (${r.kb} KB), thumbnail ${r.thumbWidth}x${r.thumbHeight} (${r.thumbKb} KB), metadata removed`);
    if (r.kb > 450) console.error(`  note: ${r.kb} KB is large; the site test allows up to 450 KB per photo`);
    console.log(snippet(r));
    console.error(`  also list ${basename(r.full)} and ${basename(r.thumb)} in assets/gallery/SOURCES.md`);
  }
}
