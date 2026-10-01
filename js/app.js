/* Router, shared model cache, global keyboard + status, the Books | Films switch. */
(function () {
  const { $, $$, mount } = DQ.util;
  const state = DQ.state;
  const W = DQ.D.w;
  let model = null;
  let current = null;

  const app = {
    /** The taste model, rebuilt lazily after anything changes. */
    model() {
      if (!model) model = DQ.taste.buildModel(state);
      return model;
    },
    invalidate() {
      model = null;
    },
    go(route) {
      const target = '#/' + route;
      if (location.hash !== target) location.hash = target;
      else render();
    },
    // Ready once every row has been matched (or found missing): an import left half-way resumes in analyze.
    ready: () => state.library.length > 0 && state.library.every((b) => state.enrich[b.gid]),
    refreshChrome,
  };

  const routeName = () => location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];

  function render() {
    let name = routeName();
    const ready = app.ready();
    // Not ready: resume an import that was left half-way; otherwise the start page. #/import stays
    // reachable either way (to change the TMDB key or drop a newer export), and so are the two
    // explainer pages: How it works and the AI set-up guide.
    if (!ready && !['analyze', 'how', 'connect', 'import'].includes(name)) name = state.library.length ? 'analyze' : 'landing';
    else if (ready && (!name || name === 'landing')) name = 'queue';
    if (!DQ.views[name]) name = ready ? 'queue' : 'landing';

    current?.view.destroy?.();
    const host = $('#view');
    host.innerHTML = '';
    const root = document.createElement('div');
    host.appendChild(root);
    current = { name, view: DQ.views[name] };
    $('#topbar').hidden = name === 'landing' || name === 'import' || name === 'analyze';
    refreshChrome();
    current.view.render(root);
    window.scrollTo(0, 0);
  }

  function refreshChrome() {
    $$('.tabs a').forEach((a) => {
      const on = a.dataset.route === current?.name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#wish-count').textContent = state.wishlist.length || '';
  }

  // Status line: background work the reader should know about.
  const status = { busy: false, ai: null, twins: false };
  function paintStatus() {
    const text = status.ai ? `Asking ${status.ai} for picks…` : status.twins ? 'Reading your taste twins’ diaries…' : status.busy ? `Scouting more ${W.items}…` : '';
    const el = $('#status');
    el.replaceChildren();
    if (!text) return;
    const sp = document.createElement('div');
    sp.className = 'spinner';
    sp.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = text;
    el.append(sp, label);
  }
  document.addEventListener('dq:busy', (e) => {
    status.busy = !!e.detail;
    paintStatus();
  });
  document.addEventListener('dq:twins', (e) => {
    status.twins = e.detail?.state === 'syncing';
    paintStatus();
  });
  document.addEventListener('dq:ai', (e) => {
    const d = e.detail;
    status.ai = d.state === 'running' ? d.model : null;
    paintStatus();
    if (d.state === 'done') {
      DQ.util.toast(d.added ? DQ.util.html`<b>${d.added} new AI picks</b> are joining your queue (${d.found} of ${d.suggested} suggestions found on ${W.source}).` : `The AI suggestions were all ${W.items} you have or have already seen.`);
    } else if (d.state === 'error') {
      DQ.util.toast(DQ.util.html`<b>AI picks failed.</b> ${d.message}`, { timeout: 8000 });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    current?.view.onKey?.(e);
  });

  // Books | Films: each mode has its own library and learning, so switching reloads into the other one.
  mount($('#mode-host'), DQ.modeSwitch());
  $('#wish-label').innerHTML = W.wishTab;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.mode-switch [data-mode]');
    if (b && b.dataset.mode !== DQ.mode) DQ.store.setMode(b.dataset.mode);
  });

  window.addEventListener('hashchange', render);
  DQ.app = app;

  // Back from OpenRouter's one-click connect (?code=…): finish it, then show the set-up page,
  // which now says what was connected and what happens next.
  DQ.ai.completeOpenRouterAuth().then((r) => {
    if (!r) return;
    const { toast, html } = DQ.util;
    if (!r.ok) {
      toast(html`<b>Couldn't connect OpenRouter.</b> ${r.message}`, { timeout: 9000 });
      return app.go('connect');
    }
    toast(
      html`<b>OpenRouter connected.</b> ${r.freeTier ? 'You’re starting on the free model.' : `Using ${DQ.ai.modelName(r.model)}.`}${app.ready() ? ' Your first AI picks are on the way.' : ''}`,
      { timeout: 7000 }
    );
    app.go('connect');
    if (app.ready()) DQ.ai.run().catch(() => {});
  });
  render();
  // Taste twins (Flicks): a quiet refresh when the last one is old.
  if (app.ready()) DQ.twins?.autoSync();
  // Left set-up before the "typical reader/viewer" baseline was sampled? Fetch it now, quietly.
  if (app.ready() && !state.background) {
    DQ.source.background().then((bg) => {
      if (!bg) return;
      state.background = bg;
      DQ.store.save('background');
      app.invalidate();
    }).catch(() => {});
  }

  // Offline shell, so Stacks and Flicks can live on a phone's home screen (sw.js). Needs http(s).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support unavailable:', e));
  }
})();
