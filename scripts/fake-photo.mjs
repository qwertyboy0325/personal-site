// Make a synthetic "camera photo" for tests: a smooth picture with a realistic
// Exif block, including things that must never be published (GPS position, a body
// serial number, the owner's name). Needs ImageMagick (`magick`).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const T = { ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };
const SIZE = { [T.ASCII]: 1, [T.SHORT]: 2, [T.LONG]: 4, [T.RATIONAL]: 8 };

const ascii = (s) => ({ type: T.ASCII, bytes: Buffer.from(`${s}\0`, 'latin1') });
const short = (v) => ({ type: T.SHORT, bytes: Buffer.from([v >> 8, v & 255]) });
const long = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return { type: T.LONG, bytes: b }; };
const rationals = (...pairs) => { const b = Buffer.alloc(pairs.length * 8); pairs.forEach(([n, d], i) => { b.writeUInt32BE(n, i * 8); b.writeUInt32BE(d, i * 8 + 4); }); return { type: T.RATIONAL, bytes: b }; };

/** A big-endian TIFF block with IFD0, an Exif IFD and a GPS IFD. Each IFD is { tag: value } (see helpers above). */
function tiff({ ifd0, exif, gps }) {
  const layout = (entries) => {
    const sorted = Object.entries(entries).sort((a, b) => Number(a[0]) - Number(b[0]));
    const dataSize = sorted.reduce((n, [, v]) => n + (v.bytes.length > 4 ? v.bytes.length + (v.bytes.length % 2) : 0), 0);
    return { sorted, size: 2 + sorted.length * 12 + 4 + dataSize };
  };
  ifd0[0x8769] = long(0); // pointers to the other two IFDs: their size is known now, their value once the offsets are
  ifd0[0x8825] = long(0);
  const all = { ifd0, exif, gps };
  const sizes = Object.fromEntries(Object.entries(all).map(([k, e]) => [k, layout(e).size]));
  const offsets = { ifd0: 8 };
  offsets.exif = offsets.ifd0 + sizes.ifd0;
  offsets.gps = offsets.exif + sizes.exif;
  ifd0[0x8769] = long(offsets.exif);
  ifd0[0x8825] = long(offsets.gps);
  const out = [Buffer.from('MM\0*\0\0\0\b', 'latin1')];
  for (const k of ['ifd0', 'exif', 'gps']) {
    const { sorted, size } = layout(all[k]);
    const head = Buffer.alloc(2 + sorted.length * 12 + 4);
    head.writeUInt16BE(sorted.length, 0);
    const data = [];
    let dataAt = offsets[k] + head.length;
    sorted.forEach(([tag, v], i) => {
      const o = 2 + i * 12;
      head.writeUInt16BE(Number(tag), o);
      head.writeUInt16BE(v.type, o + 2);
      head.writeUInt32BE(v.bytes.length / SIZE[v.type], o + 4);
      if (v.bytes.length <= 4) v.bytes.copy(head, o + 8);
      else { head.writeUInt32BE(dataAt, o + 8); data.push(v.bytes, Buffer.alloc(v.bytes.length % 2)); dataAt += v.bytes.length + (v.bytes.length % 2); }
    });
    out.push(head, ...data);
    if (Buffer.concat([head, ...data]).length !== size) throw new Error('layout mismatch');
  }
  return Buffer.concat(out);
}

/** Write a JPEG at `file`: `width` x `height` pixels as stored, with the Exif below (orientation 6 = "rotate 90 degrees to view"). */
export function makeFakePhoto(file, { width = 2400, height = 1600, orientation = 1, noGps = false } = {}) {
  execFileSync('magick', ['-size', `${width}x${height}`, 'radial-gradient:#f2d9a0-#142b4a', '-quality', '90', file]);
  const ifd0 = { 0x010f: ascii('TESTCO'), 0x0110: ascii('TESTCO Model One'), 0x0112: short(orientation), 0x013b: ascii('Jane Q. Owner'), 0xa431: ascii('SN-123456-SECRET') };
  const exif = { 0x829a: rationals([1, 250]), 0x829d: rationals([18, 10]), 0x8827: short(100), 0x920a: rationals([50, 1]), 0xa434: ascii('TEST 50mm F1.8') };
  const gps = noGps ? { 0x0001: ascii('N') } : { 0x0001: ascii('N'), 0x0002: rationals([25, 1], [2, 1], [3079, 100]), 0x0003: ascii('E'), 0x0004: rationals([121, 1], [30, 1], [1234, 100]) };
  const block = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff({ ifd0, exif, gps })]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (block.length + 2) >> 8, (block.length + 2) & 255]), block]);
  const original = readFileSync(file);
  writeFileSync(file, Buffer.concat([original.subarray(0, 2), app1, original.subarray(2)]));
  return { camera: 'TESTCO Model One', lens: 'TEST 50mm F1.8', focal: 50, aperture: 1.8, shutter: '1/250', iso: 100 };
}
