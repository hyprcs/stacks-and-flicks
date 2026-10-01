/* How it works: the pipeline in plain words, your data at a glance, taste twins (Flicks), and the
   AI side: connecting, recommended models with live prices, how each model's picks have fared, and a
   bake-off that tests models on your own taste. */
(function () {
  const { html, icon, mount, $, plural, toast } = DQ.util;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  let root = null;
  let bakeRows = null; // rows of a bake-off in flight
  let livePrices = false;

  const cost = DQ.ai.fmtCost;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');

  function glance() {
    const model = DQ.app.ready() ? DQ.app.model() : null;
    const lib = state.library;
    const rated = lib.filter((b) => b.rating > 0).length;
    const twins = Object.keys(state.twins?.users || {}).length;
    const cards = [
      [lib.length, `${W.items} in your export`],
      [rated ? `${model ? model.scale.mean.toFixed(1) : '—'}★` : '—', rated ? `your average over ${plural(rated, 'rating')}` : 'no ratings yet'],
      [model ? model.facets.length : '—', 'sides to your taste'],
      [Object.keys(state.pool).length, 'candidates scouted'],
    ];
    if (D.twins) cards.push([twins, twins === 1 ? 'taste twin' : 'taste twins']);
    cards.push([DQ.ai.enabled() ? 'On' : 'Off', 'AI picks']);
    return html`<div class="kpis">${cards.map(([v, l]) => html`<div class="kpi"><b>${v}</b><span>${l}</span></div>`)}</div>`;
  }

  function stepsCard() {
    return html`<div class="pcard span-12">
      <h2>The pipeline</h2>
      <p class="sub">From your export to the next ${W.item} in your queue.</p>
      <ol class="how-steps">${D.how.steps.map(
        (s, i) => html`<li><span class="how-num">${i + 1}</span><div><h3>${icon(s.icon)} ${s.title}</h3><p>${s.text}</p></div></li>`
      )}</ol>
    </div>`;
  }

  function twinsCard() {
    if (!D.twins || !DQ.twins) return '';
    const n = Object.keys(state.twins?.users || {}).length;
    return html`<div class="pcard span-12">
      <h2>Taste twins</h2>
      <p class="sub">People who share your favourite films are the best source of your next one.</p>
      <div class="how-cols">
        <p>Flicks builds Letterboxd searches for members who share your four favourites, the rarest combinations first
          (the trick from <a href="https://github.com/hyprcs/letterboxd-doppelganger-finder" target="_blank" rel="noopener">letterboxd-doppelganger-finder</a>).
          You open them, and paste in the members whose taste looks right.</p>
        <p>From then on it follows their public diaries. Each twin is weighted by the favourites you share (obscure ones count
          more than blockbusters) and by how closely their ratings agree with yours, and films several twins rate highly get a
          strong boost, capped per queue so they don't crowd out the rest.</p>
      </div>
      <p class="how-status">${icon('user')} ${n ? html`You follow <b>${plural(n, 'taste twin')}</b>.` : "You haven't added any taste twins yet."}
        <a href="#/profile">Manage them on Your Taste ${icon('next')}</a></p>
    </div>`;
  }

  function modelRows() {
    const c = state.ai || {};
    const onRouter = DQ.ai.enabled() && c.provider === 'openrouter';
    return DQ.ai.RECOMMENDED.map((m) => {
      const current = onRouter && c.model === m.id;
      return html`<tr class="${current ? 'current' : ''}">
        <td><span class="tier">${m.tier}</span></td>
        <td><code>${m.id}</code><div class="why-cell">${m.why}</div></td>
        <td class="num">${cost(DQ.ai.runCost(m.id))}</td>
        <td class="num">${current ? html`<span class="pill">In use</span>` : html`<button class="btn btn-sm" data-use="${m.id}">Use</button>`}</td>
      </tr>`;
    });
  }

  function statsTable() {
    const rows = DQ.ai.modelStats();
    if (!rows.length) return html`<p class="muted">No AI picks yet. Once some have been through your queues, this shows how each model's picks fared.</p>`;
    return html`<div class="table-wrap"><table class="model-table"><thead><tr><th>Model</th><th class="num">Picks</th><th class="num">Shown</th><th class="num">Kept</th><th class="num">Passed</th><th class="num">Keep rate</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td><code>${r.model}</code></td><td class="num">${r.picks}</td><td class="num">${r.shown}</td>
        <td class="num">${r.kept}</td><td class="num">${r.passed}</td><td class="num"><b>${pct(r.kept, r.kept + r.passed)}</b></td></tr>`)}</tbody></table></div>`;
  }

  function bakeTable(rows, hiddenCount) {
    return html`<div class="table-wrap"><table class="model-table bake"><thead><tr><th>Model</th><th class="num" title="Suggestions that exist on ${W.source}">Real</th>
        <th class="num" title="Suggestions already in your ${W.library}">Already ${W.done}</th><th class="num" title="Suggestions that are on your hidden ${W.wishlistRef}">On your hidden list</th>
        <th class="num">New to you</th><th class="num">Cost</th><th class="num">Time</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td><code>${r.model}</code>${r.state === 'error' ? html`<div class="why-cell ai-error">${r.error}</div>` : ''}
          ${r.hitTitles?.length ? html`<div class="why-cell">Found: ${r.hitTitles.slice(0, 4).join(', ')}${r.hitTitles.length > 4 ? '…' : ''}</div>` : ''}</td>
        ${r.state === 'waiting' || r.state === 'running'
          ? html`<td class="num" colspan="6"><span class="spinner inline"></span> ${r.suggested ? `checking ${r.found} of ${r.suggested}…` : 'asking…'}</td>`
          : r.state === 'error'
            ? html`<td class="num" colspan="6">failed</td>`
            : html`<td class="num">${r.found}/${r.suggested}</td><td class="num">${r.seen}</td><td class="num"><b>${r.hits}</b></td>
                <td class="num">${r.fresh}</td><td class="num">${cost(r.cost)}</td><td class="num">${r.seconds}s</td>`}
        <td class="num">${r.state === 'done' && state.ai?.model !== r.model ? html`<button class="btn btn-sm" data-use="${r.model}">Use</button>` : ''}</td>
      </tr>`)}</tbody></table></div>
      ${hiddenCount != null ? html`<p class="sub" style="margin-top:8px">Your ${W.wishlistRef.replace(/^your /i, '')} (${hiddenCount} ${W.items}) was hidden from the prompt.</p>` : ''}`;
  }

  function aiCard() {
    const c = state.ai || {};
    const on = DQ.ai.enabled();
    const p = DQ.ai.provider();
    const multi = on && p.multiModel;
    const models = DQ.ai.bakeoffModels();
    const bakeCost = models.reduce((a, m) => a + (DQ.ai.runCost(m) || 0), 0);
    const hasList = state.library.some((b) => b.exclusive === 'to-read');
    const last = c.bakeoff;
    return html`<div class="pcard span-12" id="how-ai">
      <h2>${icon('spark')} AI picks</h2>
      <p class="sub">Optional. A language model reads your ${W.library} and suggests ${W.items} the tags can't find.</p>
      <div class="how-connect">
        ${on
          ? html`<p>${icon('check')} AI picks are on: <b>${p.name}</b> · <code>${c.model}</code>${c.lastStats?.cost != null ? html` · last batch ${cost(c.lastStats.cost)}` : ''}</p>
              ${c.lastError ? html`<p class="ai-error">${icon('warn')} <span>${c.lastError.message} <a href="#/connect">See how to fix it</a></span></p>` : ''}
              <div class="ai-actions"><button class="btn btn-primary" id="how-run" ${DQ.ai.isRunning() ? 'disabled' : ''}>${icon('spark')} ${DQ.ai.isRunning() ? 'Working…' : 'Get new AI picks'}</button>
                <a class="btn" href="#/connect">${icon('sliders')} AI set-up</a></div>`
          : html`<p>New to this? The set-up guide explains what you get, what it costs (it can be free) and how to connect, one step at a time.
                It takes about two minutes.</p>
              <div class="ai-actions">
                <a class="btn btn-primary" href="#/connect">${icon('spark')} Set up AI picks</a>
                ${DQ.ai.canConnect() ? html`<button class="btn" id="how-connect">Connect OpenRouter now</button>` : ''}
              </div>`}
      </div>

      <h3 class="how-h3">How it works</h3>
      <ol class="how-mini">
        <li>The model gets your most telling ${W.items} (ratings, ${D.id === 'films' ? 'hearts, rewatches' : 'shelves, re-reads'}), your recent reactions and the sides of your taste.</li>
        <li>It suggests about 30 ${W.items}, each with a reason tied to things you loved.</li>
        <li>Every suggestion is looked up on ${W.source}: invented titles are dropped, and the rest join the normal pool under the usual rules (one per ${W.creator}, your passes and “never” tags, a few per queue).</li>
      </ol>

      <h3 class="how-h3">Recommended models <span class="faint" id="price-note">${livePrices ? '· live prices from OpenRouter' : '· prices as of 30 Sep 2026'}</span></h3>
      <div class="table-wrap"><table class="model-table rec"><thead><tr><th>Tier</th><th>Model</th><th class="num">Per run</th><th></th></tr></thead>
        <tbody id="model-rows">${modelRows()}</tbody></table></div>
      <p class="sub" style="margin-top:8px">Per run ≈ ${Math.round(DQ.ai.estimateTokens().in / 1000)}k tokens in and ~4k out for your library, with reasoning kept low (it’s billed as output).
        Knowledge of obscure titles grows with model size (<a href="#/connect">what that means for your picks</a>); these models are newer than the assistant that set this up, so the bake-off below is the real test.</p>

      <h3 class="how-h3">Your results by model</h3>
      ${statsTable()}

      <h3 class="how-h3">Test models on your taste</h3>
      <p>Runs the same request on ${models.length > 1 ? models.map((m) => m.split('/').pop()).join(', ') : 'several models'} with your
        ${W.wishlistRef.replace(/^your /i, '')} hidden, then checks every suggestion: does it exist, have you already ${W.done} it, and is it one you'd
        already put on your list? The model that finds most of your hidden list reads your taste best. Nothing is added to your queue.</p>
      ${!hasList ? html`<p class="muted">You don't have anything on your ${W.wishlistRef.replace(/^your /i, '')} to hide, so only the other columns will mean much.</p>` : ''}
      <div class="ai-actions">
        ${multi
          ? html`<button class="btn btn-primary" id="how-bake" ${bakeRows ? 'disabled' : ''}>${icon('compass')} ${bakeRows ? 'Testing…' : `Test ${models.length} models (≈ ${cost(bakeCost)})`}</button>`
          : html`<p class="muted" style="margin:0">${on ? 'The bake-off needs OpenRouter or Hugging Face, which can reach several models with one key.' : html`<a href="#/connect">Set up AI picks</a> first.`}</p>`}
      </div>
      <div id="bake-results">${bakeRows ? bakeTable(bakeRows) : last ? html`<p class="sub">Last test ${new Date(last.t).toLocaleString()}:</p>${bakeTable(last.rows, last.hidden)}` : ''}</div>
    </div>`;
  }

  function privacyCard() {
    return html`<div class="pcard span-12"><h2>Privacy</h2><ul class="how-privacy">${D.how.privacy.map((p) => html`<li>${icon('check')}<span>${p}</span></li>`)}</ul></div>`;
  }

  function render(r) {
    root = r;
    mount(
      root,
      html`<section class="page how">
        <div class="how-head">
          ${DQ.brandMark('how-mark')}
          <div>
            <div class="eyebrow">How ${D.brand.name} works</div>
            <h1>${D.how.title}</h1>
          </div>
        </div>
        <p class="summary-text how-intro">${D.how.intro}</p>
        ${glance()}
        <div class="pgrid">
          ${stepsCard()}
          ${twinsCard()}
          ${aiCard()}
          ${privacyCard()}
        </div>
      </section>`
    );
    bind();
    if (!livePrices) {
      DQ.ai.loadPrices().then((live) => {
        if (!live || !root?.isConnected) return;
        livePrices = true;
        $('#model-rows', root).innerHTML = String(html`${modelRows()}`);
        $('#price-note', root).textContent = '· live prices from OpenRouter';
      });
    }
  }

  function rerender() {
    if (!root?.isConnected) return;
    const y = window.scrollY;
    render(root);
    window.scrollTo(0, y);
  }

  // Recommended ids are OpenRouter models; bake-off ids belong to whichever multi-model provider ran it.
  function useModel(id) {
    const c = state.ai || {};
    const openRouterId = DQ.ai.RECOMMENDED.some((m) => m.id === id);
    if (DQ.ai.enabled() && DQ.ai.provider().multiModel && (c.provider === 'openrouter' || !openRouterId)) {
      DQ.ai.setModel(id);
      toast(html`Using <b>${id}</b> for AI picks.`);
      return rerender();
    }
    if (!DQ.ai.enabled() && DQ.ai.canConnect()) return DQ.ai.connectOpenRouter({ model: id });
    toast(html`That model is on OpenRouter. <a href="#/connect">Connect OpenRouter</a> to use it.`, { timeout: 6000 });
  }

  function bind() {
    root.onclick = (e) => {
      const use = e.target.closest('[data-use]');
      if (use) return useModel(use.dataset.use);
      if (e.target.closest('#how-connect')) return DQ.ai.connectOpenRouter();
      if (e.target.closest('#how-run')) return DQ.ai.run().catch(() => {});
      if (e.target.closest('#how-bake')) return startBake();
    };
  }

  async function startBake() {
    if (bakeRows) return;
    const models = DQ.ai.bakeoffModels();
    bakeRows = models.map((model) => ({ model, state: 'waiting' }));
    rerender();
    try {
      await DQ.ai.bakeoff(models, (rows) => {
        bakeRows = rows;
        const box = root?.isConnected && $('#bake-results', root);
        if (box) box.innerHTML = String(bakeTable(rows));
      });
    } catch (e) {
      toast(html`<b>Bake-off failed.</b> ${e.message}`, { timeout: 7000 });
    }
    bakeRows = null;
    rerender();
  }

  // Keep the AI card current while a run is in flight.
  document.addEventListener('dq:ai', () => {
    if (root?.isConnected && !bakeRows) rerender();
  });

  DQ.views.how = {
    render,
    destroy() {
      root = null;
    },
  };
})();
