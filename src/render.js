// Turns structured output blocks into HTML strings. Used by the browser and by
// scripts/prerender.mjs, so there is exactly one renderer. Every piece of text
// is escaped; only https links from content are ever emitted as <a>.
//
// Options: { ps1: 'ezra@site:~$', interactive: true }. With interactive:false
// (the no-JavaScript pre-render) command buttons degrade to plain text.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const isSafeHref = (h) => /^https:\/\/[^\s"'<>]+$/.test(h);
export const isEmail = (s) => /^[^\s@<>"'`\\]+@[^\s@<>"'`\\]+\.[^\s@<>"'`\\]+$/.test(String(s));
const DEFAULTS = { ps1: 'ezra@site:~$', interactive: true };

/** Render one inline segment (string or {link|cmd|dim|em|ok}). */
export function seg(s, o = DEFAULTS) {
  if (typeof s === 'string') return esc(s);
  if (s.link) {
    const text = esc(s.text ?? s.link);
    if (!isSafeHref(s.link)) return text;
    return `<a class="lnk" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }
  if (s.cmd) {
    const text = esc(s.text ?? s.cmd);
    if (o.interactive === false) return `<code class="cmd">${text}</code>`;
    return `<button type="button" class="cmd" data-cmd="${esc(s.cmd)}">${text}</button>`;
  }
  if (s.mail !== undefined) {
    // A mailto: link, only for a well-formed address.
    return isEmail(s.mail) ? `<a class="lnk" href="mailto:${esc(s.mail)}">${esc(s.mail)}</a>` : esc(s.mail);
  }
  if (s.copy !== undefined) {
    const text = esc(s.text ?? 'copy');
    if (o.interactive === false || !isEmail(s.copy)) return `<code class="cmd">${text}</code>`;
    return `<button type="button" class="cmd" data-copy="${esc(s.copy)}">${text}</button>`;
  }
  if (s.dim !== undefined) return `<span class="dim">${esc(s.dim)}</span>`;
  if (s.sub !== undefined) return `<span class="dim sub">${esc(s.sub)}</span>`; // a dim line under the text before it
  if (s.em !== undefined) return `<strong class="em">${esc(s.em)}</strong>`;
  if (s.ok !== undefined) return `<span class="ok">${esc(s.ok)}</span>`;
  return '';
}

export const segs = (v, o = DEFAULTS) => (Array.isArray(v) ? v : [v]).map((s) => seg(s, o)).join('');

/** Render one block. */
export function block(b, o = DEFAULTS) {
  const opts = { ...DEFAULTS, ...o };
  switch (b.t) {
    case 'echo':
      return `<div class="echo"><span class="ps1" aria-hidden="true">${esc(opts.ps1)}</span> <span class="typed">${esc(b.v)}</span></div>`;
    case 'h':
      return `<h2 class="h">${esc(b.v)}</h2>`;
    case 'p':
      return `<p>${segs(b.v, opts)}</p>`;
    case 'err':
      return `<p class="err">${segs(b.v, opts)}</p>`;
    case 'quote':
      return `<blockquote class="quote">${segs(b.v, opts)}</blockquote>`;
    case 'kv':
      return `<dl class="kv">${b.rows.map(([k, v]) => `<dt>${segs(k, opts)}</dt><dd>${segs(v, opts)}</dd>`).join('')}</dl>`;
    case 'ul':
      return `<ul class="list">${b.items.map((i) => `<li>${segs(i, opts)}</li>`).join('')}</ul>`;
    case 'pre':
      return `<pre class="art" aria-hidden="true">${esc(b.v)}</pre>`;
    case 'asciiface':
      return `<pre class="art ascii-face" role="img" aria-label="${esc(b.label ?? 'ASCII face')}" data-ascii-face>${esc(b.v)}</pre>`;
    case 'image': {
      // A picture or video poster. main.js draws it as ASCII first, then dissolves into this image.
      const video = b.kind === 'video';
      return `<figure class="shot" data-image data-kind="${esc(b.kind)}" data-open="${esc(b.index)}">`
        + `<button type="button" class="shot-open" data-open="${esc(b.index)}" aria-label="${esc(b.open ?? 'Open larger')}: ${esc(b.title)}">`
        + '<pre class="shot-ascii" aria-hidden="true" hidden></pre>'
        + `<img class="shot-img" src="${esc(b.poster ?? b.src)}" width="${esc(b.width)}" height="${esc(b.height)}" alt="${esc(b.alt)}" decoding="async">`
        + (video ? '<span class="shot-play" aria-hidden="true">▶</span>' : '')
        + '</button>'
        + `<figcaption><strong>${esc(b.title)}</strong> <span class="dim">${esc(b.caption)}</span>${b.shot ? `<span class="exif">${esc(b.shot)}</span>` : ''}</figcaption></figure>`;
    }
    case 'ascii3d':
      return `<pre class="art ascii3d" role="img" aria-label="${esc(b.label ?? 'ASCII 3D model')}" data-ascii3d data-shape="${esc(b.shape ?? 'donut')}">${esc(b.v)}</pre>`;
    case 'row':
      return `<div class="row">${b.items.map((i) => block(i, opts)).join('')}</div>`;
    default:
      return '';
  }
}

export const renderBlocks = (blocks, o) => blocks.map((b) => block(b, o)).join('');

/** One command's output as a self-contained entry. */
export const renderEntry = (blocks, o) => `<section class="entry">${renderBlocks(blocks, o)}</section>`;
