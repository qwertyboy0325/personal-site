// Photography: what a photo entry may carry and how its shooting details are shown.
//
// Photos are ordinary gallery entries (src/content.js `gallery`) with `set: 'photo'`
// and an optional `shot` object. The shooting details are an allow-list on purpose:
// only the lines below are ever shown, so a location, a serial number or an owner
// name cannot slip in by accident (scripts/add-photo.mjs strips them from the file
// itself, and the tests check both).

export const SHOT_FIELDS = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso'];

export const isPhoto = (g) => g?.set === 'photo';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "Sony A7 IV · FE 50mm F1.8 · 50 mm · f/1.8 · 1/250 s · ISO 100" from whichever fields exist; '' when none. */
export function formatShot(shot) {
  if (!shot || typeof shot !== 'object') return '';
  const parts = [];
  if (clean(shot.camera)) parts.push(clean(shot.camera));
  if (clean(shot.lens)) parts.push(clean(shot.lens));
  if (Number.isFinite(Number(shot.focal)) && Number(shot.focal) > 0) parts.push(`${Number(shot.focal)} mm`);
  if (Number.isFinite(Number(shot.aperture)) && Number(shot.aperture) > 0) parts.push(`f/${Number(shot.aperture)}`);
  if (clean(shot.shutter)) parts.push(`${clean(shot.shutter).replace(/\s*s$/i, '')} s`);
  if (Number.isFinite(Number(shot.iso)) && Number(shot.iso) > 0) parts.push(`ISO ${Number(shot.iso)}`);
  return parts.join(' · ');
}

/** Problems with a `shot` object (empty list = fine): unknown keys, wrong types, absurd values. */
export function shotProblems(shot) {
  if (shot === undefined) return [];
  if (!shot || typeof shot !== 'object' || Array.isArray(shot)) return ['shot must be an object'];
  const out = [];
  for (const k of Object.keys(shot)) if (!SHOT_FIELDS.includes(k)) out.push(`unknown field "${k}" (allowed: ${SHOT_FIELDS.join(', ')})`);
  for (const k of ['camera', 'lens']) if (k in shot && (typeof shot[k] !== 'string' || !clean(shot[k]) || shot[k].length > 60)) out.push(`${k} must be a short non-empty string`);
  if ('focal' in shot && !(typeof shot.focal === 'number' && shot.focal > 0 && shot.focal <= 2000)) out.push('focal must be a number of mm (0-2000)');
  if ('aperture' in shot && !(typeof shot.aperture === 'number' && shot.aperture >= 0.7 && shot.aperture <= 64)) out.push('aperture must be an f-number (0.7-64)');
  if ('shutter' in shot && !(typeof shot.shutter === 'string' && /^(?:1\/\d{1,5}|\d{1,3}(?:\.\d{1,2})?)$/.test(shot.shutter))) out.push('shutter must look like "1/250" or "2" or "0.5" (seconds)');
  if ('iso' in shot && !(Number.isInteger(shot.iso) && shot.iso >= 25 && shot.iso <= 6400000)) out.push('iso must be a whole number');
  return out;
}
