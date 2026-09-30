/* First-run pipeline with visible progress: match library -> baseline -> taste -> candidates. */
(function () {
  const { html, icon, mount, $, coverImg, sleep, plural } = DQ.util;
  const S = DQ.subjects;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  let runId = 0;
  const MOSAIC_MAX = 240; // a 2,000-film diary doesn't need 2,000 posters on the loading screen

  const STEPS = [
    ['parse', 'Read your export'],
    ['match', `Match your ${W.items} on ${W.source}`],
    ['baseline', D.t.baselineStep],
    ['taste', 'Map your taste'],
    ['scout', 'Scout candidates'],
  ];

  // Most recent first, so the mosaic shows what you've been into lately.
  const mosaicRows = () =>
    state.library
      .slice()
      .sort((a, b) => (b.exclusive === 'read') - (a.exclusive === 'read') || (b.dateRead || b.dateAdded || 0) - (a.dateRead || a.dateAdded || 0))
      .slice(0, MOSAIC_MAX);

  function needsCalibration() {
    if (state.calibDone) return false;
    return state.library.filter((b) => b.exclusive === 'read' && !b.rating && !state.calib[b.gid]).length >= 4;
  }

  function setStep(root, id, status, detail, count = '') {
    const el = $(`[data-step="${id}"]`, root);
    if (!el) return;
    el.className = `step ${status}`;
    $('.dot', el).innerHTML = status === 'done' ? String(icon('check')) : '';
    if (detail != null) $('.step-detail', el).textContent = detail;
    $('.step-count', el).textContent = count;
  }

  function paint(root, b) {
    const e = state.enrich[b.gid];
    const cell = $(`.m[data-gid="${CSS.escape(b.gid)}"]`, root);
    if (!cell || cell.childElementCount) return;
    cell.innerHTML = String(coverImg({ title: b.title, author: b.author, cover: e && !e.miss ? e.cover : null }, 'M'));
  }

  async function run(root) {
    const id = ++runId;
    const alive = () => id === runId;
    const lib = state.library;
    setStep(root, 'parse', 'done', D.t.summaryLine(lib));

    // 1. Match (only items we haven't matched before, plus watchlist films that have since been watched).
    setStep(root, 'match', 'active', D.t.matchDetail);
    lib.forEach((b) => state.enrich[b.gid] && paint(root, b));
    const todo = lib.filter((b) => !state.enrich[b.gid] || (state.enrich[b.gid].lite && b.exclusive === 'read'));
    const already = lib.length - todo.length;
    if (todo.length) {
      const results = await DQ.source.lookupLibrary(todo, (done, total, gid, doc) => {
        if (!alive()) return;
        state.enrich[gid] = doc || { miss: true };
        DQ.store.save('enrich'); // keep progress, so leaving mid-import (e.g. to the other mode) resumes here
        setStep(root, 'match', 'active', null, `${already + done} / ${lib.length}`);
        const b = lib.find((x) => x.gid === gid);
        if (b) paint(root, b);
      });
      if (!alive()) return;
      Object.assign(state.enrich, results);
      DQ.store.save('enrich');
    }
    const matched = lib.filter((b) => state.enrich[b.gid] && !state.enrich[b.gid].miss).length;
    if (!matched) return fail(root, `Couldn't reach ${W.source}. Check your connection and try again.`);
    setStep(root, 'match', 'done', `${matched} of ${lib.length} found${matched < lib.length ? ` (the rest still count by ${D.t.matchFallback})` : ''}`);

    // Letterboxd rows carry no director or runtime: they always follow the match (which can change
    // on a re-import). Goodreads rows keep their own and only fill gaps.
    let filled = false;
    for (const b of lib) {
      const e = state.enrich[b.gid];
      const hit = e && !e.miss ? e : null;
      const author = D.creatorFromSource ? hit?.authors?.[0] || '' : b.author || hit?.authors?.[0] || '';
      const pages = D.creatorFromSource ? hit?.pages || 0 : b.pages || hit?.pages || 0;
      if (author !== b.author || pages !== b.pages) {
        b.author = author;
        b.pages = pages;
        filled = true;
      }
    }
    if (filled) DQ.store.save('library');

    // 2. Background sample of popular titles.
    if (!state.background) {
      setStep(root, 'baseline', 'active', D.t.baselineDetail);
      state.background = await DQ.source.background();
      if (!alive()) return;
      DQ.store.save('background');
    }
    setStep(root, 'baseline', 'done', state.background ? 'So "you like sci-fi" means more than "sci-fi is popular"' : 'Skipped (offline); using your own library as the baseline');

    // 3. Taste.
    DQ.app.invalidate();
    let model = DQ.app.model();
    const top = model.topTags(4).map((t) => S.display(t.tag));
    setStep(root, 'taste', 'done', `${plural(model.facets.length, 'distinct side')} to your ${W.activity}${top.length ? ' · ' + top.join(', ') : ''}`);

    // 4. Candidates.
    setStep(root, 'scout', 'active', 'Searching around each side of your taste');
    await DQ.rec.ensurePool(model, {
      min: 80,
      onProgress: (d, t) => alive() && setStep(root, 'scout', 'active', null, `${d} / ${t} searches`),
    });
    if (!alive()) return;
    let eligible = DQ.rec.eligibleDocs().length;
    if (eligible < 30) {
      DQ.app.invalidate();
      model = DQ.app.model();
      await DQ.rec.ensurePool(model, { min: 80 });
      eligible = DQ.rec.eligibleDocs().length;
    }
    if (!alive()) return;
    if (!eligible) return fail(root, `${W.source} didn't return any candidates. Try again in a moment.`);
    setStep(root, 'scout', 'done', `${eligible} candidates lined up`);

    DQ.app.invalidate();
    DQ.store.flush();
    await sleep(600);
    if (alive()) DQ.app.go(needsCalibration() ? 'calibrate' : 'queue');
  }

  function fail(root, msg, { key = false } = {}) {
    const box = $('.analyze-error', root);
    box.hidden = false;
    box.innerHTML = String(html`<b>${msg}</b> <button class="btn btn-sm" id="retry">${icon('refresh')} Retry</button>
      ${key ? html`<a class="btn btn-sm btn-primary" href="#/import">Update your TMDB key</a>` : ''}`);
    $('#retry', box).onclick = () => {
      for (const [gid, e] of Object.entries(state.enrich)) if (e.miss) delete state.enrich[gid];
      DQ.views.analyze.render(root);
    };
  }

  DQ.views.analyze = {
    render(root) {
      if (!state.library.length) return DQ.app.go('landing');
      mount(
        root,
        html`<section class="analyze">
          ${DQ.modeSwitch('landing-switch')}
          <div class="eyebrow">Setting up your queue</div>
          <h1>${D.t.analyzeTitle}</h1>
          <ol class="steps">
            ${STEPS.map(
              ([id, label]) => html`<li class="step todo" data-step="${id}">
                <span class="dot"></span>
                <span><div class="step-label">${label}</div><div class="step-detail"></div></span>
                <span class="step-count"></span>
              </li>`
            )}
          </ol>
          <div class="mosaic" aria-hidden="true">${mosaicRows().map((b) => html`<div class="m" data-gid="${b.gid}"></div>`)}</div>
          <div class="analyze-error" role="alert" hidden></div>
        </section>`
      );
      run(root).catch((e) => {
        console.error(e);
        if (e.kind === 'auth' || e.kind === 'nokey') return fail(root, e.message, { key: true });
        fail(root, `Something went wrong while talking to ${W.source}.`);
      });
    },
    destroy() {
      runId++;
    },
  };

  DQ.needsCalibration = needsCalibration;
})();
