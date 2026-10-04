// The home page as an HTML string: navigation, hero, photos, lab, work, about, mirror, contact and footer.
// Pure (no DOM), so scripts/prerender.mjs writes it into index.html, the page is complete without JavaScript,
// and switching language renders the same markup again. src/site.js then brings it to life: pictures develop
// out of letters, headings decode, the mirror turns on.
//
// Every piece of text is escaped. Markup carries data-* hooks for site.js and never an inline style or handler
// (the Content-Security-Policy forbids both).

import { esc, isEmail } from './render.js';
import { profile, projects, works, gallery, home, banner, ui, VERSION } from './content.js';
import { renderFace } from './fx/face.js';

const T = (lang) => ui[lang] ?? ui.en;
const bySlug = (slug) => gallery.find((g) => g.slug === slug);
const indexOf = (slug) => gallery.findIndex((g) => g.slug === slug) + 1; // 1-based, like `view <n>`
const workBySlug = (slug) => works.find((w) => w.slug === slug);
const firstImage = () => gallery.find((g) => g.kind === 'image');
const photoList = () => gallery.filter((g) => g.set === 'photo');
/** The photos for the page: the chosen ones that exist, or (if none of them do) the first six there are. */
function pagePhotos() {
  const chosen = home.photos.map(bySlug).filter((g) => g?.set === 'photo');
  return chosen.length ? chosen : photoList().slice(0, 6);
}

/** A row of characters from dark to bright and back, used between sections. */
export const ruleText = (repeat = 18) => ' .:-=+*#%@%#*+=-:. '.repeat(repeat);

/** Short exposure line for a photo ("35mm · f/1.8 · 1/3200") and the raw values site.js ticks through. */
export function exposure(shot) {
  if (!shot) return { text: '', data: '' };
  const parts = [];
  if (shot.focal) parts.push(`${shot.focal}mm`);
  if (shot.aperture) parts.push(`f/${shot.aperture}`);
  if (shot.shutter) parts.push(shot.shutter);
  return { text: parts.join(' · '), data: [shot.focal ?? '', shot.aperture ?? '', shot.shutter ?? ''].join('|') };
}

const exif = (g) => {
  const e = exposure(g.shot);
  return e.text ? `<span class="exif" data-exif="${esc(e.data)}">${esc(e.text)}</span>` : '';
};

/** A picture that opens the viewer: a real link to the file, so it still works without JavaScript. */
function picture(g, lang, { cls = '', develop = 'dissolve', eager = false } = {}) {
  const c = g[lang];
  return `<a class="pic${cls ? ` ${cls}` : ''}" href="${esc(g.src)}" data-open="${indexOf(g.slug)}" aria-label="${esc(T(lang).page.photos.open)}: ${esc(c.title)}">`
    + `<img src="${esc(g.src)}" width="${esc(g.width)}" height="${esc(g.height)}" alt="${esc(c.alt)}" decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} data-develop="${esc(develop)}">`
    + '</a>';
}

const sectionHead = (id, path, title, intro) => `<div class="sec-head"><div><span class="path">${esc(path)}</span><h2 data-decode>${esc(title)}</h2></div>${intro ? `<p>${esc(intro)}</p>` : ''}</div>`;

const rule = () => `<div class="rule" aria-hidden="true" data-rule>${esc(ruleText())}</div>`;

function nav(lang) {
  const t = T(lang).page;
  const mark = banner.split('\n').map((row) => row.replace(/ +$/, '')).join('\n');
  const links = [...(pagePhotos().length ? ['photos'] : []), 'lab', 'work', 'about'].map((id) => `<a href="#${id}" data-sec="${id}">${esc(t.nav[id])}</a>`).join('');
  return `<header class="nav" id="nav"><div class="wrap nav-row">`
    + `<a class="brand" href="#top" aria-label="${esc(profile.name)}: ${esc(t.nav.top)}"><pre class="mark" aria-hidden="true" data-mark>${esc(mark)}</pre><span>${esc(profile.name)}</span></a>`
    + `<nav class="links" aria-label="${esc(t.nav.label)}">${links}</nav>`
    + `<div class="nav-tools"><button type="button" class="tool" id="btn-theme" aria-label="${esc(T(lang).themeButton)}" title="${esc(T(lang).themeButton)}" hidden>K</button>`
    + `<button type="button" class="tool" id="btn-lang" lang="${lang === 'zh' ? 'en' : 'zh-Hant'}" hidden>${esc(t.lang)}</button>`
    + `<a class="pill" href="#contact">${esc(t.nav.contact)}</a></div>`
    + '</div></header>';
}

function hero(lang) {
  const t = T(lang);
  const g = bySlug(home.hero) ?? firstImage();
  return '<section class="hero" aria-labelledby="hero-name">'
    + `<div class="hero-stage" data-hero>${picture(g, lang, { cls: 'pic-hero', develop: 'hero', eager: true })}</div>`
    + '<div class="hero-text"><div class="wrap hero-row">'
    + `<div><h1 id="hero-name" data-decode>${esc(profile.name)}</h1><p class="line">${esc(t.page.line)}</p><p class="role">${esc(t.role)}</p></div>`
    + `<p class="hero-exif"><span>${esc(g[lang].title)}</span>${exif(g)}<span class="hint" data-hint hidden>● ${esc(t.page.lookHint)}</span></p>`
    + '</div></div></section>';
}

function now(lang) {
  const t = T(lang).page.now;
  return `<div class="now" aria-label="${esc(t.label)}">${t.items.map(([k, v]) => `<div><span class="label">${esc(k)}</span><p>${esc(v)}</p></div>`).join('')}</div>`;
}

function photos(lang) {
  const t = T(lang).page.photos;
  const all = photoList();
  const chosen = pagePhotos();
  if (!chosen.length) return '';
  const shapes = ['a', 'b', 'c', 'd', 'e', 'f'];
  const figs = chosen.map((g, i) => `<figure class="ph ph-${shapes[i % shapes.length]}">${picture(g, lang)}<figcaption><span>${esc(g[lang].title)}</span>${exif(g)}</figcaption></figure>`).join('');
  return `<section class="sec" id="photos" data-cmd-hint="photos">${sectionHead('photos', '~/photos', t.title, t.intro)}`
    + `<div class="ph-grid">${figs}</div>`
    + `<div class="more"><span class="label">${esc(t.gear)}</span><button type="button" class="pill" data-term="photos" hidden>${esc(t.all(all.length))} →</button></div>`
    + '</section>';
}

function lab(lang) {
  const t = T(lang).page.lab;
  const render = bySlug(home.lab.render);
  const renderWork = workBySlug(home.lab.renderWork);
  const letters = bySlug(home.lab.letters) ?? render;
  const card = (media, q, title, body, meta) => `<article class="card"><div class="card-media">${media}</div><p class="q">${esc(q)}</p><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="meta">${meta}</div></article>`;
  const renderCard = card(
    picture(render, lang, { develop: 'scan' }),
    t.renderQ, renderWork[lang].title, renderWork[lang].summary,
    `<span>${esc(t.renderMeta)}</span>${renderWork.url ? `<a href="${esc(renderWork.url)}" target="_blank" rel="noopener noreferrer">${esc(t.source)} ↗</a>` : ''}`,
  );
  const lettersCard = card(
    `<a class="pic pic-letters" href="#mirror"><img src="${esc(letters.thumb ?? letters.src)}" width="${esc(letters.thumbWidth ?? letters.width)}" height="${esc(letters.thumbHeight ?? letters.height)}" alt="${esc(letters[lang].alt)}" loading="lazy" decoding="async" data-develop="letters"></a>`,
    t.lettersQ, 'mirror', t.lettersBody,
    `<span>${esc(t.lettersMeta)}</span><a href="#mirror">${esc(t.lettersGo)} ↓</a>`,
  );
  const small = [
    ...home.lab.more.map(workBySlug).filter(Boolean).map((w) => `<div><span class="label">${esc(t.computed)}</span><h3>${esc(w[lang].title)}</h3><p>${esc(w[lang].tag)}</p><a class="term-link" href="#works/${esc(w.slug)}" data-term="work ${esc(w.slug)}">${esc(t.inTerminal)} →</a></div>`),
    `<div><span class="label">${esc(t.written)}</span><h3>${esc(t.model)}</h3><p>${esc(t.modelBody)}</p><a class="term-link" href="#help" data-term="3d donut">${esc(t.inTerminal)} →</a></div>`,
  ].join('');
  return `<section class="sec" id="lab">${sectionHead('lab', '~/lab', t.title, t.intro)}<div class="ex">${renderCard}${lettersCard}<div class="ex-small">${small}</div></div></section>`;
}

function work(lang) {
  const t = T(lang).page.work;
  const row = (href, name, desc, kind, ext, term) => `<li><a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}${term ? ` data-term="${esc(term)}"` : ''}><span class="n" data-decode-hover>${esc(name)}</span><span class="d">${esc(desc)}</span><span class="k">${esc(kind)}</span><span class="arr" aria-hidden="true">${ext ? '↗' : '→'}</span></a></li>`;
  const code = projects.map((p) => row(p.url, p.slug, p[lang].tag, p.stack, true)).join('');
  const docs = home.workDocs.map(workBySlug).filter(Boolean).map((w) => row(`#works/${w.slug}`, w[lang].title, w[lang].tag, t.kinds[w.kind] ?? w.kind, false, `work ${w.slug}`)).join('');
  return `<section class="sec" id="work">${sectionHead('work', '~/work', t.title, t.intro)}`
    + `<div class="group"><span class="label">${esc(t.code)}</span><ul class="idx">${code}</ul></div>`
    + `<div class="group"><span class="label">${esc(t.docs)}</span><ul class="idx">${docs}</ul></div>`
    + '</section>';
}

function about(lang) {
  const t = T(lang).page.about;
  return `<section class="sec" id="about"><div class="about">`
    + `<div class="about-side"><span class="path">~/about</span><h2 data-decode>${esc(t.title)}</h2>`
    + `<figure class="portrait"><pre class="face" role="img" aria-label="${esc(t.faceLabel)}" data-face>${esc(renderFace())}</pre><figcaption>${esc(t.faceHint)}</figcaption></figure></div>`
    + `<div class="about-body"><div><p class="lead">${esc(t.lead)}</p>${t.body.map((x) => `<p>${esc(x)}</p>`).join('')}</div>`
    + `<dl class="facts">${t.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`
    + '</div></section>';
}

function mirror(lang) {
  const t = T(lang);
  const m = t.mirror;
  const pm = t.page.mirror;
  // The same parts src/fx/mirror.js expects (start / stop / copy, the letters, the status line), plus a shutter and the prints.
  // Buttons start hidden: without JavaScript there is no camera to turn on, and the intro says what this is.
  return `<section class="sec mirror-sec" id="mirror">${sectionHead('mirror', '~/mirror', pm.title, pm.intro)}`
    + '<div class="mirror-grid">'
    + `<div class="mirror-main"><figure class="mirror lightbox-stage" data-mirror data-state="ready" aria-label="${esc(m.label)}">`
    + `<div class="mstage"><pre class="mirror-placeholder" aria-hidden="true" data-placeholder>${esc(renderFace({ invert: true }))}</pre><pre class="mirror-ascii" aria-hidden="true" hidden></pre>`
    + '<div class="br" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="flash" aria-hidden="true"></div>'
    + `<div class="mread"><span><span class="rec" aria-hidden="true">●</span> <span data-cols></span></span><span>${esc(pm.privacy)}</span></div></div>`
    + `<div class="mctl"><button type="button" class="shutter" data-shutter aria-label="${esc(pm.shutter)}" title="${esc(pm.shutter)}" hidden><span></span></button>`
    + `<div class="mirror-actions"><button type="button" class="pill" data-mirror-start hidden>${esc(m.start)}</button><button type="button" class="pill" data-mirror-stop hidden>${esc(m.stop)}</button><button type="button" class="pill" data-mirror-copy hidden>${esc(m.copyShort)}</button></div></div>`
    + `<p class="mirror-intro">${esc(m.intro)}</p><p class="mirror-status" role="status" aria-live="polite"></p>`
    + '</figure></div>'
    + `<div class="prints"><span class="label">${esc(pm.prints)}</span><div class="print-list" data-prints><p class="empty">${esc(pm.printsEmpty)}</p></div></div>`
    + '</div></section>';
}

function contact(lang) {
  const t = T(lang);
  const email = isEmail(profile.email) ? profile.email : null;
  return '<section class="contact" id="contact"><div class="wrap">'
    + `<span class="path">~/contact</span><p class="big">${esc(t.page.contact.title)}</p>`
    + '<div class="mail">'
    + (email ? `<a class="addr" href="mailto:${esc(email)}">${esc(email)}</a><button type="button" class="pill" data-copy="${esc(email)}" aria-label="${esc(t.contactButton)}" hidden>${esc(t.page.contact.copy)}</button>` : '')
    + `<a class="pill" href="${esc(profile.github)}" target="_blank" rel="noopener noreferrer">${esc(t.page.contact.github)} ↗</a>`
    + '</div>'
    + `<footer class="status" id="status" aria-label="${esc(t.status.label)}"><span class="status-claims">${esc(t.status.claims)}</span><span class="status-light" data-kelvin></span><span class="status-ver">v${esc(VERSION)}</span></footer>`
    + `<p class="colophon">${esc(t.page.colophon)}</p>`
    + '</div></section>';
}

/** The whole page for one language. */
export function renderPage(lang = 'en') {
  return [
    nav(lang),
    '<main id="main">',
    hero(lang),
    `<div class="wrap">${now(lang)}${[photos(lang), lab(lang), work(lang), about(lang), mirror(lang)].filter(Boolean).map((sec) => rule() + sec).join('')}</div>`,
    contact(lang),
    '</main>',
  ].join('\n');
}
