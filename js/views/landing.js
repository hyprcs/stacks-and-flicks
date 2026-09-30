/* Import screen: drop an export (or use the one sitting next to index.html). The active domain
   supplies the copy and the parser: a Goodreads CSV for books, a Letterboxd ZIP for films. Films
   also need a TMDB key, asked for first. */
(function () {
  const { html, icon, mount, $ } = DQ.util;
  const state = DQ.state;
  const D = DQ.D;
  const L = D.landing;
  DQ.views = DQ.views || {};

  const needsKey = () => D.source.needsKey && !state.tmdb?.key;

  function importRecords(records) {
    // Library-derived data is rebuilt; feedback you've given (wishlist, passes, tag prefs) is kept.
    DQ.store.reset(['queue']);
    const keep = new Set(records.map((b) => b.gid));
    state.enrich = Object.fromEntries(Object.entries(state.enrich).filter(([gid]) => keep.has(gid)));
    state.library = records;
    DQ.store.save('library', 'enrich');
    DQ.store.flush();
    DQ.app.invalidate();
    DQ.app.go('analyze');
  }

  async function importFiles(files, root) {
    const err = $('.drop-error', root);
    err.textContent = '';
    if (!files?.length) return;
    if (needsKey()) {
      err.textContent = 'Add your TMDB key above first: it is needed to look up your films.';
      $('#key-input', root)?.focus();
      return;
    }
    try {
      importRecords(await D.parseFiles([...files]));
    } catch (e) {
      err.textContent = e.message;
    }
  }

  function keyBlock() {
    if (!D.source.needsKey) return '';
    const saved = !!state.tmdb?.key;
    return html`<div class="key-step ${saved ? 'saved' : ''}" id="key-step">
      <div class="key-head">
        <span class="step-num">1</span>
        <div><b>Your TMDB API key</b><span class="muted"> · free, used to look up your films</span></div>
      </div>
      ${saved
        ? html`<p class="key-ok">${icon('check')} Key saved on this device. <button class="btn btn-sm btn-ghost" id="key-change" type="button">Change</button></p>`
        : html`<form class="key-form" id="key-form" autocomplete="off">
            <input id="key-input" name="key" type="password" spellcheck="false" placeholder="API key (or API read access token)" aria-label="TMDB API key">
            <button class="btn btn-primary" type="submit">Save key</button>
            <a class="btn btn-ghost" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">${icon('external')} Get a free key</a>
          </form>
          <p class="key-help faint">Sign up at themoviedb.org, then <b>Settings → API</b> and request a Developer key.
            Paste the <b>API Key</b> (the short one). It's kept in this browser and sent only to TMDB.</p>
          <p class="key-error" role="alert"></p>`}
    </div>`;
  }

  function bindKey(root) {
    $('#key-change', root)?.addEventListener('click', () => {
      state.tmdb = { key: '' };
      DQ.store.save('tmdb');
      DQ.views.landing.render(root);
      $('#key-input', root)?.focus();
    });
    const form = $('#key-form', root);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = form.key.value.trim();
      const err = $('.key-error', root);
      const btn = $('button[type="submit"]', form);
      if (!key) return (err.textContent = 'Paste your TMDB API key first.');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      err.textContent = '';
      try {
        await D.source.testKey(key);
        state.tmdb = { key };
        DQ.store.save('tmdb');
        DQ.store.flush();
        DQ.views.landing.render(root);
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Save key';
      }
    });
  }

  DQ.views.landing = DQ.views.import = {
    render(root) {
      mount(
        root,
        html`<section class="landing">
          ${DQ.modeSwitch('landing-switch')}
          <div class="landing-hero">
            ${DQ.brandMark('landing-mark')}
            <div class="eyebrow">${D.brand.name} · Discovery Queue</div>
            <h1>${L.title}</h1>
            <p>${L.intro}</p>
          </div>

          ${keyBlock()}
          ${D.source.needsKey ? html`<div class="key-head drop-head"><span class="step-num">2</span><div><b>Your ${D.w.service} export</b></div></div>` : ''}
          <label class="drop ${needsKey() ? 'waiting' : ''}" id="drop">
            ${icon('upload')}
            <strong>${L.dropTitle}</strong>
            <span class="muted">${L.dropHint}</span>
            <input type="file" accept="${L.accept}" ${L.multiple ? 'multiple' : ''} aria-label="Choose your ${D.w.service} export">
          </label>
          <div class="drop-error" role="alert"></div>
          <div class="local-file" id="local" hidden>
            <span class="muted">Found <b>${L.localFile}</b> next to this page.</span>
            <button class="btn btn-primary" id="use-local">Use it</button>
          </div>

          <ol class="howto">${L.howto.map((step) => html`<li>${step}</li>`)}</ol>
          <p class="privacy">${icon(D.icon)}<span>${L.privacy}</span></p>
        </section>`
      );

      bindKey(root);
      const drop = $('#drop', root);
      const input = $('input', drop);
      input.addEventListener('change', () => importFiles(input.files, root));
      ['dragenter', 'dragover'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('over');
        })
      );
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        importFiles(e.dataTransfer.files, root);
      });

      // Served over http(s)? Offer the export that's sitting in the project folder, if it parses.
      if (location.protocol.startsWith('http')) {
        fetch(L.localFile, { cache: 'no-store' })
          .then((r) => (r.ok ? r.blob() : null))
          .then(async (blob) => {
            if (!blob || !root.isConnected) return;
            const file = new File([blob], L.localFile, { type: blob.type });
            await D.parseFiles([file]); // throws if it isn't a real export
            $('#local', root).hidden = false;
            $('#use-local', root).onclick = () => importFiles([file], root);
          })
          .catch(() => {});
      }
    },
  };
})();
