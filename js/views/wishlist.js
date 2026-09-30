/* Want to Read / Watchlist: everything you hearted in a queue, exportable back into Goodreads or
   Letterboxd (the domain builds the CSV its importer understands). */
(function () {
  const { html, icon, mount, $, coverImg, toast, plural } = DQ.util;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  function exportCsv() {
    const { csv, filename, note } = D.exportWishlist(state.wishlist);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(note, { timeout: 7000 });
  }

  async function copyList() {
    const text = state.wishlist.map((w) => `${w.doc.title} — ${w.doc.authors?.[0] || ''}${w.doc.year ? ` (${w.doc.year})` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied your list to the clipboard.');
    } catch {
      toast("Couldn't reach the clipboard from this page.");
    }
  }

  function remove(key, root) {
    state.wishlist = state.wishlist.filter((w) => w.key !== key);
    if (state.events[key]?.action === 'want') delete state.events[key];
    if (state.queue?.decisions?.[key] === 'want') delete state.queue.decisions[key];
    DQ.store.save('wishlist', 'events', 'queue');
    DQ.app.invalidate();
    DQ.app.refreshChrome();
    render(root);
  }

  function render(root) {
    const list = state.wishlist;
    mount(
      root,
      html`<section class="page">
        <div class="list-head">
          <div>
            <div class="eyebrow">From your queues</div>
            <h1>${W.wishlist}</h1>
            <p class="muted" style="margin:6px 0 0">${list.length ? `${plural(list.length, W.item)} you said yes to, newest first.` : ''}</p>
          </div>
          ${list.length
            ? html`<div class="btns">
                <button class="btn btn-primary" id="export">${icon('download')} Export for ${W.service}</button>
                <button class="btn" id="copy">${icon('copy')} Copy list</button>
              </div>`
            : ''}
        </div>
        ${list.length
          ? html`<div class="wish-grid">${list.map(
              (w) => html`<article class="wish">
                <div class="cv">${coverImg(w.doc, 'M')}</div>
                <div style="min-width:0">
                  <h3>${w.doc.title}</h3>
                  <div class="by">${w.doc.authors?.[0] || ''}${w.doc.year ? ` · ${w.doc.year}` : ''}${w.doc.pages ? ` · ${D.length.label(w.doc.pages)}` : ''}</div>
                  ${w.why ? html`<div class="why-line">${w.why}</div>` : ''}
                  <div class="row">${D.links(w.doc).map(
                    (l, i) => html`<a class="btn btn-sm ${i ? 'btn-ghost' : ''}" href="${l.url}" target="_blank" rel="noopener">${i ? '' : icon('external')} ${l.label}</a>`
                  )}</div>
                  <button class="btn btn-sm btn-ghost btn-danger wish-remove" data-remove="${w.key}" title="Remove" aria-label="Remove ${w.doc.title}">${icon('trash')}</button>
                </div>
              </article>`
            )}</div>`
          : html`<div class="empty">
              ${icon('heart')}
              <p>Nothing here yet. Press <kbd>W</kbd> or <b>${W.wishlist}</b> on a ${W.item} in your queue and it lands here.</p>
              <a class="btn btn-primary" href="#/queue">Go to your queue ${icon('next')}</a>
            </div>`}
      </section>`
    );
    $('#export', root)?.addEventListener('click', exportCsv);
    $('#copy', root)?.addEventListener('click', copyList);
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.remove, root)));
  }

  DQ.views.wishlist = { render };
})();
