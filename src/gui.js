// The graphical half of the split screen: cards for projects, works, skills and
// contact, built from content.js (so they are bilingual and always match the
// terminal). Clicking a card runs the same command in the terminal; commands
// typed in the terminal light up the matching card.
//
// guiHtml / activeKey are pure (testable under Node); createGui is the DOM part.
// Everything dynamic goes through esc(); cards are real <button>s so they are
// keyboard reachable.

import { esc, isEmail } from './render.js';
import { profile, projects, works, gallery, skillGroups, banner, ui } from './content.js';
import { isPhoto } from './photos.js';

const KIND_CLASS = { visual: 'k-visual', thinking: 'k-think', design: 'k-design' };

const card = (cmd, inner, extra = '') =>
  `<button type="button" class="gcard gbtn${extra}" data-cmd="${esc(cmd)}" data-key="${esc(cmd)}">${inner}</button>`;

/** Cards for one language, as an HTML string. */
export function guiHtml(lang) {
  const t = ui[lang] ?? ui.en;
  const g = t.gui;

  const projectCards = projects
    .map((p, i) => {
      const chips = p.stack.split(' · ').map((s) => `<i>${esc(s)}</i>`).join('');
      return card(`project ${i + 1}`, `<span class="gtitle">${esc(p.slug)}</span><span class="gtag">${esc(p[lang].tag)}</span><span class="gchips">${chips}</span>`);
    })
    .join('');

  const workCards = works
    .map((w, i) =>
      card(`work ${i + 1}`, `<span class="gkind ${KIND_CLASS[w.kind] ?? ''}">${esc(t.workKinds[w.kind] ?? w.kind)}</span><span class="gtitle">${esc(w[lang].title)}</span><span class="gtag">${esc(w[lang].tag)}</span>`),
    )
    .join('');

  const thumbCards = (isMine) => gallery
    .map((it, i) => [it, i])
    .filter(([it]) => isPhoto(it) === isMine)
    .map(([it, i]) =>
      card(
        `view ${i + 1}`,
        `<span class="gthumb-wrap"><img src="${esc(it.thumb)}" width="${esc(it.thumbWidth)}" height="${esc(it.thumbHeight)}" alt="" loading="lazy" decoding="async">${it.kind === 'video' ? '<span class="shot-play" aria-hidden="true">▶</span>' : ''}</span><span class="gtitle">${esc(it[lang].title)}</span>`,
        ' gthumb',
      ),
    )
    .join('');
  const galleryCards = thumbCards(false);
  const photoCards = thumbCards(true);

  const skills = skillGroups
    .map((group) => {
      const [name, items] = group[lang];
      const list = group.key === 'tools'
        ? `<div class="gchips gtools">${items.map((x) => `<i>${esc(x)}</i>`).join('')}</div>`
        : `<ul class="glist">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      return `<div class="gskill"><h4>${esc(name)}</h4>${list}</div>`;
    })
    .join('');

  const contact = [`<a class="gbtn glink" href="${esc(profile.github)}" target="_blank" rel="noopener noreferrer">${esc(g.github)} ↗</a>`];
  if (profile.email && isEmail(profile.email)) contact.push(`<button type="button" class="gbtn gmail" data-copy="${esc(profile.email)}">✉ ${esc(t.contactButton)}</button>`);

  return `
    <header class="gcard gprofile">
      <pre class="gbanner" aria-hidden="true">${esc(banner)}</pre>
      <h2 class="gname">${esc(profile.name)}</h2>
      <p class="grole">${esc(t.role)}</p>
      <p>${esc(t.welcome)}</p>
      <div class="gactions">${card('about', `<span class="gtitle">${esc(g.aboutButton)} →</span>`, ' gabout')}${profile.email && isEmail(profile.email) ? `<button type="button" class="gbtn gmail gmail-top" data-copy="${esc(profile.email)}">✉ ${esc(t.contactButton)}</button>` : ''}</div>
      <p class="ghint"><span class="led" aria-hidden="true"></span>${esc(g.hint)}</p>
    </header>
    <section class="gsec" aria-labelledby="g-projects"><h3 id="g-projects">// ${esc(g.sections.projects)}</h3><div class="ggrid">${projectCards}</div></section>
    <section class="gsec" aria-labelledby="g-works"><h3 id="g-works">// ${esc(g.sections.works)}</h3><div class="ggrid">${workCards}</div></section>
    <section class="gsec" aria-labelledby="g-gallery"><h3 id="g-gallery">// ${esc(g.sections.gallery)}</h3><div class="ggrid ggallery">${galleryCards}</div></section>
    ${photoCards ? `<section class="gsec" aria-labelledby="g-photos"><h3 id="g-photos">// ${esc(g.sections.photos)}</h3><div class="ggrid ggallery gphotos">${photoCards}</div></section>` : ''}
    <section class="gsec" aria-labelledby="g-skills"><h3 id="g-skills">// ${esc(g.sections.skills)}</h3><div class="gskills">${skills}</div></section>
    <section class="gsec" aria-labelledby="g-contact"><h3 id="g-contact">// ${esc(g.sections.contact)}</h3><div class="gcontact">${contact.join('')}</div></section>`;
}

/**
 * Which card does a typed command correspond to? `project 2`, `project vox-proof`
 * and `work black-hole` all resolve; anything else returns null.
 */
export function activeKey(line) {
  const m = String(line ?? '').trim().toLowerCase().match(/^(project|work|view)\s+(.+)$/);
  if (!m) return String(line ?? '').trim().toLowerCase() === 'about' ? 'about' : null;
  const [, kind, arg] = m;
  const list = kind === 'project' ? projects : kind === 'work' ? works : gallery;
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return `${kind} ${n}`;
  const i = list.findIndex((x) => x.slug === arg.trim());
  return i >= 0 ? `${kind} ${i + 1}` : null;
}

export function createGui({ root }) {
  root.innerHTML = '<div id="gui-cards"></div><div class="gtelemetry"><div id="hud-left" aria-hidden="true"></div><div id="hud-right"></div></div>';
  const cards = root.querySelector('#gui-cards');
  let activeNow = null;

  const paint = () => {
    for (const el of cards.querySelectorAll('[data-key]')) {
      const on = el.dataset.key === activeNow;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }
  };

  return {
    render(lang) {
      cards.innerHTML = guiHtml(lang);
      root.setAttribute('aria-label', (ui[lang] ?? ui.en).gui.label);
      paint();
    },
    setActive(line) {
      activeNow = activeKey(line);
      paint();
    },
    get active() { return activeNow; },
  };
}
