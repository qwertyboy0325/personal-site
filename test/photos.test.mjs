import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatShot, shotProblems, isPhoto, SHOT_FIELDS } from '../src/photos.js';
import { jpegSegments, privateSegments, stripPrivate } from '../scripts/jpeg-meta.mjs';
import { rational, shutterText, slugFor, processPhoto, readShot, snippet } from '../scripts/add-photo.mjs';
import { makeFakePhoto } from '../scripts/fake-photo.mjs';
import { gallery } from '../src/content.js';

const haveTools = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); execFileSync('sips', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const tools = { skip: haveTools ? false : 'needs ImageMagick (magick) and macOS sips' };

test('formatShot: shows only what exists, in a fixed order, with units', () => {
  assert.equal(formatShot({ camera: 'Sony A7 IV', lens: 'FE 50mm F1.8', focal: 50, aperture: 1.8, shutter: '1/250', iso: 100 }), 'Sony A7 IV · FE 50mm F1.8 · 50 mm · f/1.8 · 1/250 s · ISO 100');
  assert.equal(formatShot({ iso: 400, aperture: 2 }), 'f/2 · ISO 400');
  assert.equal(formatShot({ shutter: '2 s' }), '2 s');
  assert.equal(formatShot({ shutter: '0.5' }), '0.5 s');
  for (const empty of [undefined, null, {}, 'x', 5, [], { focal: 0 }, { aperture: NaN }, { camera: '   ' }]) assert.equal(formatShot(empty), '', String(JSON.stringify(empty)));
});

test('formatShot: unknown fields are never printed (location cannot leak through the page)', () => {
  const out = formatShot({ camera: 'X', gps: '25.1,121.5', location: 'Taipei', serial: 'SN123', owner: 'Jane' });
  assert.equal(out, 'X');
});

test('shotProblems: accepts good data, names every problem in bad data', () => {
  assert.deepEqual(shotProblems(undefined), []);
  assert.deepEqual(shotProblems({ camera: 'A', lens: 'B', focal: 35, aperture: 2.8, shutter: '1/125', iso: 200 }), []);
  assert.deepEqual(shotProblems({ shutter: '2' }), []);
  const bad = shotProblems({ gps: '1,2', camera: '', focal: -1, aperture: 'f/2', shutter: '1/0x', iso: 12.5 });
  assert.equal(bad.length, 6, bad.join(' | '));
  assert.ok(bad.some((m) => /unknown field "gps"/.test(m)));
  assert.ok(shotProblems(null).length && shotProblems([]).length && shotProblems('x').length);
  assert.deepEqual(SHOT_FIELDS, ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso']);
});

test('isPhoto: only entries marked as photos', () => {
  assert.ok(isPhoto({ set: 'photo' }));
  for (const x of [{}, { set: 'render' }, null, undefined]) assert.ok(!isPhoto(x));
});

test('add-photo helpers: rationals, shutter text, slugs', () => {
  assert.equal(rational('18/10'), 1.8);
  assert.equal(rational('50'), 50);
  assert.equal(rational('0/1'), null);
  assert.equal(rational('abc'), null);
  assert.equal(shutterText('1/250'), '1/250');
  assert.equal(shutterText('10/2500'), '1/250');
  assert.equal(shutterText('2/1'), '2');
  assert.equal(shutterText('5/10'), '1/2');
  assert.equal(shutterText('0.5'), '0.5');
  assert.equal(shutterText('zzz'), null);
  assert.equal(slugFor('/a/b/IMG_0042 (final).HEIC'), 'img-0042-final');
  assert.equal(slugFor('???.jpg'), 'photo');
});

test('jpeg-meta: finds Exif, XMP, IPTC, comments and unknown application data; allows JFIF, ICC and Adobe', () => {
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), Buffer.from(body, 'latin1')]);
  const jpeg = (...segs) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segs, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
  const clean = jpeg(seg(0xe0, 'JFIF\0xx'), seg(0xe2, 'ICC_PROFILE\0xx'), seg(0xee, 'Adobe\0xx'));
  assert.deepEqual(privateSegments(clean), []);
  assert.equal(jpegSegments(clean).length, 3);
  assert.deepEqual(privateSegments(jpeg(seg(0xe1, 'Exif\0\0data'))).map((s) => s.id), ['Exif']);
  assert.deepEqual(privateSegments(jpeg(seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x/>'))).map((s) => s.name), ['APP1']);
  assert.deepEqual(privateSegments(jpeg(seg(0xed, 'Photoshop 3.0\0x'))).map((s) => s.name), ['APP13']);
  assert.deepEqual(privateSegments(jpeg(seg(0xfe, 'a comment'))).map((s) => s.name), ['COM']);
  assert.deepEqual(privateSegments(jpeg(seg(0xe2, 'MPF\0data'))).map((s) => s.id), ['MPF']);
  assert.deepEqual(privateSegments(jpeg(seg(0xe5, 'whatever\0'))).map((s) => s.name), ['0xe5']);
  assert.throws(() => jpegSegments(Buffer.from('not a jpeg')), /not a JPEG/);
});

test('stripPrivate: removes the private segments and leaves the picture data byte for byte', () => {
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), Buffer.from(body, 'latin1')]);
  const data = Buffer.from([0xff, 0xda, 0, 4, 1, 2, 0xde, 0xad, 0xbe, 0xef, 0xff, 0xd9]);
  const dirty = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, 'JFIF\0ab'), seg(0xe1, 'Exif\0\0GPSsecret'), seg(0xe2, 'ICC_PROFILE\0cc'), seg(0xed, 'Photoshop 3.0\0x'), seg(0xfe, 'comment'), data]);
  const out = stripPrivate(dirty);
  assert.deepEqual(jpegSegments(out).map((s) => s.name), ['APP0', 'APP2']);
  assert.deepEqual(privateSegments(out), []);
  assert.ok(out.subarray(out.length - data.length).equals(data), 'compressed data untouched');
  assert.ok(!out.includes('GPSsecret'));
  assert.ok(stripPrivate(out).equals(out), 'idempotent');
});

test('every JPEG that ships under assets/ carries no Exif, GPS, XMP, IPTC or comments', () => {
  const walk = (dir) => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const jpegs = walk('assets').filter((f) => /\.jpe?g$/i.test(f));
  assert.ok(jpegs.length >= 8, `found ${jpegs.length} JPEGs`);
  for (const f of jpegs) {
    const found = privateSegments(readFileSync(new URL(`../${f}`, import.meta.url)));
    assert.deepEqual(found.map((s) => `${s.name}:${s.id}`), [], `${f} carries metadata`);
  }
});

test('add-photo: a camera photo comes out small, upright, colour-safe and with every private detail removed', tools, () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-test-'));
  try {
    const src = join(dir, 'IMG_0001 Test.jpg');
    const expected = makeFakePhoto(src, { width: 2400, height: 1600, orientation: 6 });
    // The input really contains the private data (so the test proves the tool removes it).
    const input = readFileSync(src);
    assert.ok(privateSegments(input).some((s) => s.id === 'Exif'));
    for (const secret of ['Jane Q. Owner', 'SN-123456-SECRET']) assert.ok(input.includes(secret), `fixture should contain ${secret}`);
    assert.ok(readShot(src).camera.includes('TESTCO'));

    const out = join(dir, 'out');
    const r = processPhoto(src, { outDir: out });
    assert.equal(r.slug, 'photo-img-0001-test');
    assert.deepEqual(r.shot, expected, 'camera and exposure details are read from the original');
    // Orientation 6: stored landscape, shown portrait. The output is the upright 2:3 picture, longest edge 1600.
    assert.deepEqual([r.width, r.height], [1067, 1600]);
    assert.equal(Math.max(r.thumbWidth, r.thumbHeight), 480);
    assert.ok(r.kb < 450 && r.thumbKb < 40, `${r.kb} KB / ${r.thumbKb} KB`);
    for (const f of [r.full, r.thumb]) {
      assert.ok(existsSync(f));
      const bytes = readFileSync(f);
      assert.deepEqual(privateSegments(bytes), [], `${f} has no private segments`);
      for (const secret of ['Jane Q. Owner', 'SN-123456-SECRET', 'TESTCO', 'TEST 50mm', 'GPS', 'Exif']) assert.ok(!bytes.includes(secret), `${f} still contains "${secret}"`);
    }
    // The pasted entry is valid and says nothing about the place.
    const text = snippet(r);
    assert.match(text, /set: 'photo'/);
    assert.match(text, /shot: \{ camera: 'TESTCO Model One', lens: 'TEST 50mm F1\.8', focal: 50, aperture: 1\.8, shutter: '1\/250', iso: 100 \}/);
    assert.ok(!/121|25\.|GPS|Jane|SN-/.test(text));
    assert.deepEqual(shotProblems(r.shot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-photo: a photo with no Exif at all still works, with an empty shot', tools, () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-test-'));
  try {
    const src = join(dir, 'plain.jpg');
    execFileSync('magick', ['-size', '800x600', 'gradient:#123-#fa0', src]);
    const r = processPhoto(src, { outDir: join(dir, 'out'), slug: 'plain-one' });
    assert.deepEqual(r.shot, {});
    assert.deepEqual([r.width, r.height], [800, 600], 'small photos are not enlarged');
    assert.match(snippet(r), /shot: \{  \}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real gallery: photo entries (if any) are well formed', () => {
  for (const g of gallery.filter(isPhoto)) {
    assert.equal(g.kind, 'image', `${g.slug}: a photo is an image`);
    assert.deepEqual(shotProblems(g.shot), [], g.slug);
  }
  for (const g of gallery.filter((x) => !isPhoto(x))) assert.ok(!('shot' in g), `${g.slug}: only photos carry shooting details`);
});
