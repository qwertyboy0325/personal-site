// A picture viewer window built on the native <dialog> element, which gives us a
// focus trap, Esc-to-close and a backdrop for free. Everything is inserted as
// text or via properties (never innerHTML with content), arrows switch pictures,
// video stops when it is closed or replaced, and focus returns to what opened it.

import { gallery, ui } from './content.js';
import { buildMedia, stopMedia, sourceLink, shotLine, wrapIndex } from './viewer-content.js';

export function createLightbox({ getLang, reduceMotion = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'viewer';
  dlg.setAttribute('aria-labelledby', 'viewer-title');
  dlg.innerHTML = `
    <div class="vbar">
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="vtitle" id="viewer-title"></span>
      <span class="vcount"></span>
      <button type="button" class="vclose"></button>
    </div>
    <div class="vstage"></div>
    <p class="vcap"></p>
    <div class="vnav"><button type="button" class="vprev"></button><span class="vlinks"></span><button type="button" class="vnext"></button></div>`;
  document.body.append(dlg);

  const q = (sel) => dlg.querySelector(sel);
  const el = { title: q('.vtitle'), count: q('.vcount'), close: q('.vclose'), stage: q('.vstage'), cap: q('.vcap'), prev: q('.vprev'), next: q('.vnext'), links: q('.vlinks') };
  let index = 0;
  let opener = null;

  function render() {
    const lang = getLang();
    const t = ui[lang].viewer;
    const g = gallery[index];
    const c = g[lang];
    el.title.textContent = c.title;
    el.count.textContent = t.counter(index + 1, gallery.length);
    el.cap.replaceChildren(c.caption);
    const shot = shotLine(g);
    if (shot) {
      const exif = document.createElement('small');
      exif.className = 'exif';
      exif.textContent = shot;
      el.cap.append(exif);
    }
    el.close.textContent = '✕';
    el.close.setAttribute('aria-label', t.close);
    el.prev.textContent = '←';
    el.prev.setAttribute('aria-label', t.prev);
    el.next.textContent = '→';
    el.next.setAttribute('aria-label', t.next);

    el.stage.replaceChildren(buildMedia(g, lang, { reduceMotion }));

    el.links.replaceChildren();
    const link = sourceLink(g, lang);
    if (link) el.links.append(link);
  }

  function go(delta) {
    stopMedia(el.stage);
    index = wrapIndex(index + delta, gallery.length);
    render();
  }

  el.close.addEventListener('click', () => dlg.close());
  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the dimmed area outside the window
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  dlg.addEventListener('close', () => {
    stopMedia(el.stage);
    el.stage.replaceChildren();
    opener?.focus?.({ preventScroll: true });
    opener = null;
  });

  return {
    /** Open picture `i` (0-based). `from` is the element to give focus back to. */
    open(i, from) {
      opener = from ?? document.activeElement;
      index = wrapIndex(Number.isInteger(i) ? i : 0, gallery.length);
      render();
      if (!dlg.open) dlg.showModal();
    },
    close() { if (dlg.open) dlg.close(); },
    refresh() { if (dlg.open) render(); }, // e.g. the language changed
    get isOpen() { return dlg.open; },
    get index() { return index; },
  };
}
