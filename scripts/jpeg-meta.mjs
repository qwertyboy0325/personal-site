// Look inside a JPEG for segments that can carry personal data (no dependencies).
//
// A phone or camera photo can contain the exact GPS position, the camera's serial
// number, the owner's name and a thumbnail of the uncropped picture. Nothing like
// that may ship, so scripts/add-photo.mjs strips it and the tests check every JPEG
// under assets/ with this module.

const NAMES = { 0xe0: 'APP0', 0xe1: 'APP1', 0xe2: 'APP2', 0xed: 'APP13', 0xee: 'APP14', 0xfe: 'COM' };

/** Every marker segment before the image data starts: [{ marker, name, id, length }]. */
export function jpegSegments(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  const out = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of the compressed data
    const length = buf.readUInt16BE(i + 2);
    const body = buf.subarray(i + 4, i + 2 + length);
    const nul = body.indexOf(0);
    const id = body.toString('latin1', 0, nul === -1 ? Math.min(body.length, 16) : Math.min(nul, 24));
    out.push({ marker, name: NAMES[marker] ?? `0x${marker.toString(16)}`, id, length });
    i += 2 + length;
  }
  return out;
}

/** The segments that may carry personal data: Exif, XMP, IPTC / Photoshop, comments, and unknown application data. */
export function privateSegments(buf) {
  return jpegSegments(buf).filter((s) => {
    if (s.marker === 0xe0) return false;                          // JFIF header
    if (s.marker === 0xe2) return s.id !== 'ICC_PROFILE';         // colour profile is fine, anything else (e.g. MPF) is not
    if (s.marker === 0xee) return false;                          // Adobe colour flag
    return s.marker === 0xe1 || s.marker === 0xed || s.marker === 0xfe || (s.marker >= 0xe3 && s.marker <= 0xef);
  });
}

/** The same JPEG without those segments. Lossless: the picture data is not touched. */
export function stripPrivate(buf) {
  const drop = new Set(privateSegments(buf).map((s) => `${s.marker}:${s.length}`));
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { parts.push(buf.subarray(i)); return Buffer.concat(parts); }
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = buf.readUInt16BE(i + 2);
    if (!drop.has(`${marker}:${length}`)) parts.push(buf.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  parts.push(buf.subarray(i));
  return Buffer.concat(parts);
}
