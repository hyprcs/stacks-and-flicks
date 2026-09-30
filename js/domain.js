/* Picks the active domain (books or films, from the saved mode) and exposes it to the shared engine:
   DQ.D is the domain, DQ.subjects its tag vocabulary, DQ.source its metadata client. Each domain
   wears its own brand (brand.js): Stacks for books, Flicks for films. */
(function () {
  const { html, raw, icon, $ } = DQ.util;
  const D = DQ.domains[DQ.mode] || DQ.domains.books;

  DQ.D = D;
  DQ.subjects = D.vocab;
  DQ.source = D.source;
  D.brand = DQ.brands[D.id];
  document.documentElement.dataset.mode = D.id;

  const brandLink = $('.topbar .brand');
  if (brandLink) {
    $('.brand-mark', brandLink).innerHTML = D.brand.mark;
    $('.brand-name', brandLink).textContent = D.brand.name;
    brandLink.setAttribute('aria-label', `${D.brand.name} home`);
  }
  /** The brand mark as inline SVG markup (landing page, How it works). */
  DQ.brandMark = (cls = '') => html`<span class="${cls}" aria-hidden="true">${raw(D.brand.mark)}</span>`;

  /** The Books | Films switch (topbar and landing page); app.js handles the clicks. */
  DQ.modeSwitch = (cls = '') =>
    html`<div class="mode-switch ${cls}" role="group" aria-label="What to discover">${DQ.store.MODES.map((m) => {
      const d = DQ.domains[m];
      const name = DQ.brands[m].name;
      const on = m === D.id;
      return html`<button type="button" data-mode="${m}" aria-pressed="${on}" class="${on ? 'on' : ''}" title="${on ? `${name}: ${d.label.toLowerCase()}` : `Switch to ${name} (${d.label.toLowerCase()})`}">
        ${icon(d.icon)}<span>${name}</span></button>`;
    })}</div>`;
})();
