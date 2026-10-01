/* Your Taste: what the model believes, in plain language, with direct controls to correct it. */
(function () {
  const { html, raw, esc, icon, mount, $, coverImg, plural, toast } = DQ.util;
  const S = DQ.subjects;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  let root = null;
  let tip = null;

  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  // Two themes when the facet has them; otherwise theme + lead author ("Science Fiction · Ursula K. Le Guin").
  const facetName = (f) => {
    const t = f.tags.slice(0, 2).map(S.display);
    if (t.length >= 2) return t.join(' · ');
    return t.length ? `${t[0]} · ${f.authors[0]}` : f.authors.slice(0, 2).join(' & ');
  };

  // ---------- the written summary ----------
  function summary(model) {
    const out = [];
    const facets = model.facets;
    if (facets.length >= 2) {
      out.push(html`Your ${W.activity} has <b>${facets.length} distinct sides</b>: ${raw(list(facets.slice(0, 4).map((f) => {
        const name = facetName(f);
        const who = f.authors.slice(0, 2).filter((x) => !name.includes(x));
        return `<b>${esc(name)}</b>${who.length ? ` (${esc(who.join(', '))})` : ''}`;
      })))}.`);
    }
    const tags = model.topTags(16);
    const trad = tags.filter((t) => t.kind === 'tradition' && t.tag !== D.umbrellaTag).slice(0, 3).map((t) => S.display(t.tag));
    const themes = tags.filter((t) => t.kind === 'theme' && !S.isPlace(t.tag)).slice(0, 4).map((t) => S.display(t.tag));
    const genres = tags.filter((t) => t.kind === 'genre').slice(0, 3).map((t) => S.display(t.tag));
    if (genres.length) out.push(html`Compared with a typical ${W.audience} you lean hardest into <b>${list(genres)}</b>${trad.length ? html`, with a real pull toward <b>${list(trad)}</b>` : ''}.`);
    if (themes.length) out.push(html`Themes that keep coming back: ${list(themes)}.`);
    const binge = model.binges[0];
    if (binge) out.push(html`You ${W.does} in binges, most recently <b>${binge.count} ${binge.author} ${W.items} in ${binge.days} days</b>.`);
    const rare = model.rareTags(3).map((t) => S.display(t.tag));
    if (rare.length) out.push(html`You rarely ${W.pickUp} ${list(rare)}, so the queue keeps those to a minimum.`);
    return out;
  }

  function patterns(model) {
    const lib = state.library;
    const read = lib.filter((b) => b.exclusive === 'read');
    const items = [];
    for (const b of model.binges.slice(0, 2)) {
      items.push(html`<li>${icon('layers')}<span>Binge ${W.binger}: <b>${b.count} ${W.items} by ${b.author}</b> inside ${b.days} days${b.series.length ? ` (${b.series.join(', ')})` : ''}. ${W.Creators} you binge get extra weight.</span></li>`);
    }
    const years = read.map((b) => b.year).filter(Boolean).sort((a, b) => a - b);
    if (years.length >= 5) {
      const med = years[Math.floor(years.length / 2)];
      items.push(html`<li>${icon(D.icon)}<span>Your ${W.reads} span <b>${years[0]}–${years[years.length - 1]}</b>; the median ${W.item} you've ${W.done} came out in <b>${med}</b>.</span></li>`);
    }
    const translated = read.filter((b) => {
      const e = state.enrich[b.gid];
      return e && !e.miss && e.tags.some((t) => t === D.umbrellaTag || S.kind(t) === 'tradition');
    }).length;
    if (read.length && translated / read.length >= 0.15) {
      items.push(html`<li>${icon('compass')}<span>About <b>${Math.round((translated / read.length) * 100)}%</b> of what you've ${W.done} is ${D.t.foreign}.</span></li>`);
    }
    const pages = read.map((b) => b.pages).filter((p) => p > 0).sort((a, b) => a - b);
    if (pages.length >= 5) {
      const med = pages[Math.floor(pages.length / 2)];
      items.push(html`<li>${icon(D.icon)}<span>Typical length: <b>${D.length.label(med)}</b>${med > D.length.long ? `, so long ${W.items} don't put you off` : med < D.length.short ? '. You like them lean' : ''}.</span></li>`);
    }
    const rated = read.filter((b) => b.rating).length;
    const calibrated = Object.values(state.calib).filter((v) => v !== 'skip').length;
    items.push(html`<li>${icon('star')}<span>${D.t.ratingPattern(model, { rated, calibrated, unrated: read.length - rated })}</span></li>`);
    const hist = state.history;
    if (hist.length) {
      const shown = hist.reduce((a, h) => a + h.size, 0);
      const wants = hist.reduce((a, h) => a + h.want, 0);
      items.push(html`<li>${icon('heart')}<span>${plural(hist.length, 'queue')} finished: you kept <b>${wants} of ${shown}</b> picks (${Math.round((wants / Math.max(1, shown)) * 100)}%).</span></li>`);
    }
    return items;
  }

  // ---------- charts ----------
  function tagRows(rows, { neg = false, value }) {
    const max = Math.max(...rows.map((r) => Math.abs(r.a)), 0.01);
    return html`<div class="bars">${rows.map((r) => {
      const pref = state.tags[r.tag];
      const btn = (p, ic, label) =>
        html`<button class="${pref === p ? 'sel' : ''} ${p !== 'more' ? 'neg' : ''}" data-tag="${r.tag}" data-pref="${p}" title="${label}" aria-label="${label}: ${S.display(r.tag)}" aria-pressed="${pref === p}">${icon(ic)}</button>`;
      return html`<div class="bar-row ${pref ? 'pref-' + pref : ''}">
        <span class="lbl" title="${S.display(r.tag)}">${S.display(r.tag)}</span>
        <span class="track" tabindex="0" data-tip="${S.display(r.tag)}|${value(r)}"><i class="${neg ? 'neg' : ''}" style="width:${Math.max(4, (Math.abs(r.a) / max) * 100)}%"></i></span>
        <span class="ctl">${btn('more', 'plus', 'More like this')}${btn('less', 'minus', 'Less of this')}${btn('ban', 'ban', 'Never show')}</span>
      </div>`;
    })}</div>`;
  }

  function columns(data, labelEvery, unit) {
    const max = Math.max(...data.map((d) => d.v), 1);
    const n = data.length;
    const ticks = n <= 6 ? data.map((d) => d.label) : [data[0].label, data[Math.floor(n / 2)].label, data[n - 1].label];
    return html`<div class="hist" role="list">${data.map(
      (d) => html`<div class="col" role="listitem" tabindex="0" data-tip="${d.label}|${plural(d.v, unit)}" aria-label="${d.label}: ${plural(d.v, unit)}">
        <i style="height:${d.v ? Math.max(3, (d.v / max) * 100) : 0}%"></i></div>`
    )}</div>
    <div class="hist-axis" style="${n <= 6 ? 'justify-content:space-around' : ''}">${ticks.map((t) => html`<span>${t}</span>`)}</div>`;
  }

  // Shared hover/focus tooltip: value leads, label follows.
  function bindTips() {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    const show = (el) => {
      const [label, value] = el.dataset.tip.split('|');
      tip.replaceChildren();
      const b = document.createElement('b');
      b.textContent = value;
      const s = document.createElement('span');
      s.textContent = label;
      tip.append(b, s);
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
      tip.style.top = `${r.top - tip.offsetHeight - 8}px`;
    };
    const hide = () => (tip.hidden = true);
    root.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    root.addEventListener('pointerout', (e) => e.target.closest('[data-tip]') && hide());
    root.addEventListener('focusin', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    root.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  // ---------- actions ----------
  function setPref(tag, pref) {
    if (state.tags[tag] === pref || !pref) delete state.tags[tag];
    else state.tags[tag] = pref;
    DQ.store.save('tags');
    DQ.app.invalidate();
    if (state.queue && !state.queue.done) DQ.rec.refreshUpcoming(DQ.app.model());
    render(root);
  }

  function addTheme(text) {
    const input = text.trim();
    if (!input) return;
    const tag = S.normalize([input]).tags[0] || input.toLowerCase();
    state.tags[tag] = 'more';
    DQ.store.save('tags');
    DQ.app.invalidate();
    toast(html`Looking for more <b>${S.display(tag)}</b>. It'll show up in your queue shortly.`);
    DQ.rec.ensurePool(DQ.app.model(), { min: 999 }).then(() => {
      DQ.app.invalidate();
      if (state.queue && !state.queue.done) DQ.rec.refreshUpcoming(DQ.app.model());
    });
    render(root);
  }

  function resetLearning() {
    if (!confirm(`Forget everything learned from your queues (passes, skips, theme settings)? Your library, quick-ratings and ${W.wishlist} list stay.`)) return;
    DQ.store.reset(['events', 'tags', 'seen', 'queue', 'history']);
    state.wishlist.forEach((w) => (state.events[w.key] = { action: 'want', t: w.t, doc: w.doc }));
    DQ.store.save('events');
    DQ.app.invalidate();
    toast('Queue learning reset.');
    render(root);
  }

  function eraseAll() {
    if (!confirm(D.t.eraseConfirm)) return;
    DQ.store.reset();
    DQ.store.flush();
    DQ.app.invalidate();
    DQ.app.go('landing');
  }

  // ---------- AI assist ----------
  let aiEditing = false;

  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  }

  function aiCardHtml() {
    const c = state.ai || {};
    const P = DQ.ai.PROVIDERS;
    if (DQ.ai.enabled() && !aiEditing) {
      const p = DQ.ai.provider();
      const st = c.lastStats;
      const running = DQ.ai.isRunning();
      return html`<div class="pcard span-12 ai-card" id="ai">
        <h2>${icon('spark')} AI picks · ${p.name} · <span title="${c.model}">${DQ.ai.modelName(c.model)}</span></h2>
        <p class="sub">${
          running ? 'Asking for picks now…'
          : c.lastRun ? `Last batch ${ago(c.lastRun)}: ${st.suggested} suggested, ${st.found} found on ${W.source}, ${st.added} new in your queue${st.cost != null ? ` (${DQ.ai.fmtCost(st.cost)})` : ''}.`
          : 'Set up. Get your first AI picks below.'
        }${c.auto ? ' A new batch is fetched after a queue when picks run low.' : ''}</p>
        ${c.lastError ? html`<p class="ai-error">${icon('warn')} <span>${c.lastError.message} <a href="#/connect">See how to fix it</a></span></p>` : ''}
        ${c.profile?.summary
          ? html`<div class="ai-profile">
              <h3>What ${c.profile.model} sees in your ${W.library}</h3>
              <p class="summary-text">${c.profile.summary}</p>
              ${c.profile.facets?.length ? html`<div class="tags">${c.profile.facets.map((f) => html`<span class="tag static" title="${f.description}">${f.name}</span>`)}</div>` : ''}
            </div>`
          : ''}
        <div class="ai-actions">
          <button class="btn btn-primary" id="ai-run" ${running ? 'disabled' : ''}>${icon('spark')} ${running ? 'Working…' : 'Get new AI picks'}</button>
          <a class="btn" href="#/connect">${icon('layers')} Change model</a>
          <a class="btn btn-ghost" href="#/how">Compare models ${icon('next')}</a>
          <button class="btn btn-ghost" id="ai-edit">${icon('sliders')} Advanced</button>
          <button class="btn btn-ghost btn-danger" id="ai-off">Turn off and forget key</button>
        </div>
      </div>`;
    }
    if (!aiEditing) {
      return html`<div class="pcard span-12 ai-card ai-pitch" id="ai">
        <div>
          <h2>${icon('spark')} AI picks <span class="pill">optional</span></h2>
          <p class="sub" style="margin:0">${D.t.aiPitch} Free to start, and the guide takes about two minutes.</p>
        </div>
        <div class="ai-actions">
          <a class="btn btn-primary" href="#/connect">${icon('spark')} Set up AI picks</a>
          <button class="btn btn-ghost" id="ai-setup">${icon('sliders')} Advanced</button>
        </div>
      </div>`;
    }
    const pid = c.provider && P[c.provider] ? c.provider : 'openrouter';
    const p = P[pid];
    const est = DQ.ai.estimateTokens();
    return html`<div class="pcard span-12 ai-card" id="ai">
      <h2>${icon('spark')} AI picks · advanced settings</h2>
      <p class="sub">Every setting by hand, for any service. New to this? <a href="#/connect">The step-by-step guide</a> is easier.</p>
      <form class="ai-form" id="ai-form" autocomplete="off">
        <label><span>Provider</span>
          <select name="provider">${Object.entries(P).map(([id, x]) => html`<option value="${id}" ${id === pid ? 'selected' : ''}>${x.label}</option>`)}</select>
        </label>
        <label><span>Model</span>
          <span class="row">
            <input name="model" list="ai-models" value="${c.provider === pid && c.model ? c.model : p.model}" placeholder="${p.local ? 'e.g. llama3.1 (use Load models)' : 'model id'}" required>
            <button type="button" class="btn btn-sm" id="ai-load">Load models</button>
          </span>
          <datalist id="ai-models">${p.suggest.map((m) => html`<option value="${m}">`)}</datalist>
        </label>
        <label><span>API key${p.keyOptional ? ' (if needed)' : ''}</span>
          <span class="row">
            <input name="key" type="password" value="${c.provider === pid ? DQ.ai.getKey() : ''}" placeholder="${p.keyHint || ''}" spellcheck="false">
            ${p.keyUrl ? html`<a class="btn btn-sm btn-ghost" id="ai-keylink" href="${p.keyUrl}" target="_blank" rel="noopener">${icon('external')} ${p.local ? 'Get Ollama' : 'Get a key'}</a>` : ''}
          </span>
        </label>
        <label class="ai-base" ${p.local || pid === 'custom' ? '' : 'hidden'}><span>Base URL</span>
          <input name="base" value="${c.base || p.base}" placeholder="https://…/v1">
        </label>
        <label class="check"><input type="checkbox" name="remember" ${c.remember !== false ? 'checked' : ''}> Remember the key on this device (untick on a shared computer)</label>
        <label class="check"><input type="checkbox" name="auto" ${c.auto !== false ? 'checked' : ''}> Refresh AI picks automatically after a queue when they run low</label>
        <p class="ai-privacy">${icon('warn')} When it runs, your ${W.item} list, ratings and queue reactions are sent to the provider you choose, and your key is sent only to that provider.
          Each run is roughly ${Math.max(1, Math.round(est.in / 1000))}k tokens in and ${Math.round(est.out / 1000)}k out, usually well under a cent on the cheaper models.</p>
        <p class="ai-error" role="alert" hidden></p>
        <div class="ai-actions">
          <button type="submit" class="btn btn-primary">${icon('spark')} Save and get AI picks</button>
          <button type="button" class="btn btn-ghost" id="ai-cancel">Cancel</button>
        </div>
      </form>
    </div>`;
  }

  function bindAi() {
    const card = $('#ai', root);
    if (!card) return;
    const rerender = () => {
      const y = window.scrollY;
      render(root);
      window.scrollTo(0, y);
    };
    $('#ai-setup', card)?.addEventListener('click', () => {
      aiEditing = true;
      rerender();
      $('#ai [name="key"]', root)?.focus();
    });
    $('#ai-edit', card)?.addEventListener('click', () => {
      aiEditing = true;
      rerender();
    });
    $('#ai-cancel', card)?.addEventListener('click', () => {
      aiEditing = false;
      rerender();
    });
    $('#ai-off', card)?.addEventListener('click', () => {
      DQ.ai.forget();
      DQ.app.invalidate();
      toast('AI picks are off and the key is forgotten. Picks already in your queue stay.');
      rerender();
    });
    $('#ai-run', card)?.addEventListener('click', () => DQ.ai.run().catch(() => {}));

    const form = $('#ai-form', card);
    if (!form) return;
    const err = $('.ai-error', form);
    const showErr = (m) => {
      err.hidden = !m;
      err.textContent = m || '';
    };
    const P = DQ.ai.PROVIDERS;
    form.provider.addEventListener('change', () => {
      const p = P[form.provider.value];
      form.model.value = p.model;
      form.model.placeholder = p.local ? 'e.g. llama3.1 (use Load models)' : 'model id';
      form.key.placeholder = p.keyHint || '';
      form.base.value = p.base;
      $('.ai-base', form).hidden = !(p.local || form.provider.value === 'custom');
      $('#ai-models', form).replaceChildren(...p.suggest.map((m) => Object.assign(document.createElement('option'), { value: m })));
      const link = $('#ai-keylink', form);
      if (link) {
        link.hidden = !p.keyUrl;
        if (p.keyUrl) link.href = p.keyUrl;
      }
      showErr('');
    });
    $('#ai-load', form).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Loading…';
      showErr('');
      try {
        const ids = await DQ.ai.listModels({ provider: form.provider.value, base: form.base.value, key: form.key.value.trim() });
        $('#ai-models', form).replaceChildren(...ids.map((m) => Object.assign(document.createElement('option'), { value: m })));
        btn.textContent = `${ids.length} models`;
        form.model.focus();
      } catch (ex) {
        btn.textContent = 'Load models';
        showErr(ex.message);
      } finally {
        btn.disabled = false;
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pid = form.provider.value;
      const p = P[pid];
      const model = form.model.value.trim();
      const key = form.key.value.trim();
      const base = (form.base.value || p.base).trim();
      if (!model) return showErr('Choose a model (Load models lists the ones your key can use).');
      if (!key && !p.keyOptional) return showErr(`${p.label} needs an API key.`);
      if (!/^https?:\/\//.test(base)) return showErr('The base URL should start with https:// (or http:// for a local server).');
      DQ.ai.saveSettings({ provider: pid, model, base: p.local || pid === 'custom' ? base : '', key, remember: form.remember.checked, auto: form.auto.checked });
      aiEditing = false;
      rerender();
      DQ.ai.run().catch(() => {});
    });
  }

  // ---------- taste twins (Flicks) ----------
  let twinsHelper = null; // unknown until checked: is server.py running?
  let twinsSyncing = false;
  let showPairs = false;

  function rerenderKeepScroll() {
    if (!root?.isConnected) return;
    const y = window.scrollY;
    render(root);
    window.scrollTo(0, y);
  }

  function twinsCardHtml() {
    if (!DQ.twins) return '';
    const favs = DQ.twins.favourites();
    const all = DQ.twins.searches();
    const shown = all.filter((x) => x.size >= 3 || showPairs || all.length <= 4);
    const twins = DQ.twins.list();
    const inPool = DQ.twins.picksInPool();
    return html`<div class="pcard span-12" id="twins">
      <h2>${icon('user')} Taste twins</h2>
      <p class="sub">People who share your favourite films. What they love becomes a strong pick in your queue.</p>
      ${twinsHelper === false
        ? html`<p class="twins-helper">${icon('warn')}<span>To follow twins, start Flicks with <code>python server.py</code> rather than
            <code>python -m http.server</code>. It relays their public Letterboxd diaries, which a browser can't fetch directly.</span></p>`
        : ''}
      <div class="twins-grid">
        <div>
          <h3 class="how-h3">1 · Find people who share your favourites</h3>
          ${favs.length
            ? html`<div class="twin-favs">${favs.map((f) => html`<span class="twin-fav">${coverImg({ title: f.title, cover: f.cover }, 'S')}<span>${f.title}</span></span>`)}</div>`
            : html`<p class="muted">Pick four favourites on your Letterboxd profile (or rate a few films 5★) and re-import to get searches.</p>`}
          <p class="muted">Each search opens Letterboxd's member search for people with those favourites. Paste the members whose taste looks
            right (usernames or profile links) into the box beside it: rarer shared favourites make a closer twin.</p>
          <ul class="twin-searches">${shown.map(
            (x) => html`<li>
              <div class="ts-head"><span class="ts-films">${x.films.map((f) => f.title).join(' + ')}</span>
                <a class="btn btn-sm" href="${x.url}" target="_blank" rel="noopener">${icon('external')} Search</a>
                <a class="faint ts-alt" href="${x.urlYears}" target="_blank" rel="noopener" title="If a search finds nobody: some films are filed with their year">with years</a></div>
              <form class="ts-add" data-via="${x.keys.join(',')}"><input name="names" placeholder="Paste members from this search" aria-label="Members from this search" autocomplete="off">
                <button class="btn btn-sm" type="submit">Add</button></form>
            </li>`
          )}</ul>
          ${all.some((x) => x.size === 2) && all.length > 4
            ? html`<button class="btn btn-ghost btn-sm" id="ts-pairs">${showPairs ? 'Fewer searches' : 'More searches (pairs)'}</button>`
            : ''}
        </div>
        <div>
          <h3 class="how-h3">2 · Your twins</h3>
          ${twins.length
            ? html`<div class="table-wrap"><table class="model-table twin-table"><thead><tr><th>Member</th><th class="num">In feed</th>
                <th class="num" title="Films you've both rated">Both rated</th><th class="num" title="How closely their ratings follow yours">Agreement</th><th>Weight</th><th></th></tr></thead>
                <tbody>${twins.map(
                  (u) => html`<tr>
                    <td><a href="https://letterboxd.com/${u.name}/" target="_blank" rel="noopener">${u.name}</a>
                      ${u.error
                        ? html`<div class="why-cell ai-error">${u.error}</div>`
                        : html`<div class="why-cell">${u.fetchedAt ? `synced ${ago(u.fetchedAt)}` : 'not synced yet'}${u.via?.length ? ` · shares ${plural(u.via.length, 'favourite')}` : ''}</div>`}</td>
                    <td class="num">${Object.keys(u.entries || {}).length}</td>
                    <td class="num">${u.overlap ?? 0}</td>
                    <td class="num">${u.overlap >= 3 ? `${Math.round((u.agreement || 0) * 100)}%` : '—'}</td>
                    <td><span class="twin-weight" title="${(u.weight || 0).toFixed(2)}"><i style="width:${Math.round(((u.weight || 0) / 1.6) * 100)}%"></i></span></td>
                    <td class="num"><button class="btn btn-ghost btn-sm btn-danger" data-untwin="${u.name}" aria-label="Stop following ${u.name}">${icon('close')}</button></td>
                  </tr>`
                )}</tbody></table></div>`
            : html`<p class="muted">No twins yet. Open a search, then paste in members you like.</p>`}
          <form class="ts-add" id="twin-add-any"><input name="names" placeholder="Or add someone you know (username)" aria-label="Add a Letterboxd member" autocomplete="off">
            <button class="btn btn-sm" type="submit">Add</button></form>
          <div class="ai-actions" style="margin-top:10px;align-items:center">
            ${twins.length ? html`<button class="btn btn-sm" id="twins-sync" ${twinsSyncing ? 'disabled' : ''}>${icon('refresh')} ${twinsSyncing ? 'Syncing…' : 'Refresh twins'}</button>` : ''}
            <span class="faint" style="font-size:12.5px">${inPool ? `${plural(inPool, 'twin pick')} among your candidates.` : ''}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function bindTwins() {
    const card = $('#twins', root);
    if (!card) return;
    card.addEventListener('submit', (e) => {
      const form = e.target.closest('form.ts-add');
      if (!form) return;
      e.preventDefault();
      const via = form.dataset.via ? form.dataset.via.split(',') : [];
      const names = DQ.twins.addTwins(form.names.value, via);
      if (!names.length) return toast("Couldn't find a Letterboxd username in that. Paste names or profile links.");
      toast(html`Following <b>${names.join(', ')}</b>. Reading their diaries…`);
      form.names.value = '';
    });
    $('#ts-pairs', card)?.addEventListener('click', () => {
      showPairs = !showPairs;
      rerenderKeepScroll();
    });
    $('#twins-sync', card)?.addEventListener('click', () => DQ.twins.sync(undefined, { force: true }));
    card.querySelectorAll('[data-untwin]').forEach((b) =>
      b.addEventListener('click', () => {
        DQ.twins.removeTwin(b.dataset.untwin);
        toast(html`Stopped following <b>${b.dataset.untwin}</b>.`);
      })
    );
    if (twinsHelper == null) {
      DQ.twins.helper().then((ok) => {
        twinsHelper = ok;
        if (!ok) rerenderKeepScroll();
      });
    }
  }

  document.addEventListener('dq:twins', (e) => {
    const st = e.detail?.state;
    twinsSyncing = st === 'syncing';
    if (st === 'nohelper') twinsHelper = false;
    if (st === 'done' && e.detail.adopted) toast(html`Your taste twins added <b>${plural(e.detail.adopted, 'pick')}</b> to your candidates.`);
    if (root?.isConnected && !aiEditing) rerenderKeepScroll();
  });

  // Keep the card current while a run is in flight.
  document.addEventListener('dq:ai', () => {
    if (root?.isConnected && !aiEditing) {
      const y = window.scrollY;
      render(root);
      window.scrollTo(0, y);
    }
  });

  // ---------- render ----------
  function render(r) {
    root = r;
    const model = DQ.app.model();
    const top = model.topTags(14);
    const avoid = model.avoidTags(8);
    const rare = model.rareTags(6);
    const authors = model.topAuthors(8);
    const era = model.eraDist();
    const len = model.lenDist();
    const totalW = model.facets.reduce((a, f) => a + f.weight, 0) || 1;
    const explicit = Object.entries(state.tags);
    const events = Object.values(state.events).filter((e) => e.action !== 'skip').length;

    mount(
      root,
      html`<section class="page">
        <div class="profile-head">
          <div class="eyebrow">Your taste profile</div>
          <h1>${D.t.profileTitle}</h1>
          ${summary(model).length ? html`<p class="summary-text">${summary(model).map((s) => html`${s} `)}</p>` : ''}
        </div>

        <div class="kpis">
          <div class="kpi"><b>${state.library.length}</b><span>${W.items} in your export</span></div>
          <div class="kpi"><b>${events}</b><span>queue decisions learned from</span></div>
          <div class="kpi"><b>${state.wishlist.length}</b><span>on your ${W.wishlist}</span></div>
          <div class="kpi"><b>${model.confidence}</b><span>confidence in this profile</span></div>
        </div>

        <div class="pgrid">
          ${aiCardHtml()}
          ${twinsCardHtml()}
          ${model.facets.length
            ? html`<div class="pcard span-12">
                <h2>The sides of your taste</h2>
                <p class="sub">Clusters of ${W.items} you like that hang together. Your queue saves room for each one.</p>
                <div class="facets">${model.facets.map(
                  (f) => html`<div class="facet">
                    <div class="facet-covers">${f.books.slice(0, 7).map((b) => coverImg({ title: b.title, author: b.author, cover: b.cover }, 'M'))}</div>
                    <div>
                      <div class="facet-name">${facetName(f)}</div>
                      <div class="facet-meta">${f.authors.slice(0, 3).join(', ')} · ${plural(f.books.length, W.item)}</div>
                    </div>
                    <div class="share" title="${Math.round((f.weight / totalW) * 100)}% of your taste signal"><i style="width:${(f.weight / totalW) * 100}%"></i></div>
                    ${f.tags.length > 2 ? html`<div class="tags">${f.tags.slice(2, 5).map((t) => html`<span class="tag static">${S.display(t)}</span>`)}</div>` : ''}
                  </div>`
                )}</div>
              </div>`
            : ''}

          <div class="pcard span-7">
            <h2>Themes that draw you in</h2>
            <p class="sub">Measured against what popular ${W.items} usually cover. Use + / − / ⊘ to correct me.</p>
            ${top.length ? tagRows(top, { value: (t) => `in ${t.books} of your ${W.items}` }) : html`<p class="muted">Not enough to go on yet.</p>`}
            <form class="add-theme" id="add-theme">
              <input type="text" id="theme-input" placeholder="Want more of something? ${D.t.themeExample}" aria-label="Add a theme you want more of">
              <button class="btn" type="submit">${icon('plus')} Add</button>
            </form>
          </div>

          <div class="pcard span-5">
            <h2>${W.Creators} you keep coming back to</h2>
            <p class="sub">Their other ${W.items} get a boost, a couple per queue at most.</p>
            ${authors.length
              ? html`<div class="bars">${authors.map((a) => {
                  const max = authors[0].a;
                  return html`<div class="bar-row" style="grid-template-columns:minmax(90px,44%) minmax(0,1fr) auto">
                    <span class="lbl">${a.name}</span>
                    <span class="track" tabindex="0" data-tip="${a.name}|${a.count ? plural(a.count, W.item) + ' ' + W.done : 'on your ' + W.wishShort}"><i style="width:${Math.max(4, (a.a / max) * 100)}%"></i></span>
                    <span class="faint" style="font-size:12px;min-width:44px;text-align:right">${a.count ? plural(a.count, W.item) : W.wishShort}</span>
                  </div>`;
                })}</div>`
              : html`<p class="muted">No strong ${W.creator} pull yet.</p>`}
          </div>

          <div class="pcard span-7">
            <h2>When your ${W.items} are from</h2>
            <p class="sub">${W.Items} you've ${W.done} or want, by ${D.t.dateBasis}.</p>
            ${era.length ? columns(era, 3, W.item) : html`<p class="muted">No ${D.t.dates} to go on.</p>`}
          </div>

          <div class="pcard span-5">
            <h2>How long you like them</h2>
            <p class="sub">${D.t.lengthNoun} of ${W.items} you've ${W.done} or want.</p>
            ${columns(len.map((l, i) => ({ ...l, label: D.length.axis[i] })), 1, W.item)}
          </div>

          <div class="pcard span-7">
            <h2>${W.Activity} patterns</h2>
            <p class="sub">Things the model noticed in your export.</p>
            <ul class="patterns">${patterns(model)}</ul>
          </div>

          <div class="pcard span-5">
            <h2>What you steer clear of</h2>
            <p class="sub">${avoid.length ? `From ${W.items} you passed on or rated low.` : `Pass on a few ${W.items} in the queue and this fills in.`}</p>
            ${avoid.length ? tagRows(avoid, { neg: true, value: (t) => `in ${plural(t.passed, W.item)} you turned down` }) : ''}
            ${rare.length
              ? html`<h2 style="margin-top:18px">${D.t.rareHead}</h2>
                <p class="sub">Common in popular ${W.items}, rare in yours.</p>
                ${tagRows(rare, { neg: true, value: () => 'common elsewhere, rare for you' })}`
              : ''}
          </div>

          ${explicit.length
            ? html`<div class="pcard span-12">
                <h2>Your manual settings</h2>
                <p class="sub">These override what the model infers. Click one to clear it.</p>
                <div class="tags">${explicit.map(
                  ([t, p]) => html`<button class="tag ${p === 'more' ? 'match more' : 'warn less'}" data-clear="${t}" title="Clear">${p === 'ban' ? '⊘ ' : ''}${S.display(t)}</button>`
                )}</div>
              </div>`
            : ''}

          <div class="pcard span-12">
            <h2>Your data</h2>
            <p class="sub">Stored only in this browser. Re-importing keeps what the queue has learned.</p>
            <div class="danger-zone">
              <a class="btn" href="#/calibrate" id="recal">${icon('star')} Quick-rate your ${W.reads}</a>
              <a class="btn" href="#/import">${icon('upload')} Import a newer export</a>
              ${D.source.needsKey ? html`<button class="btn btn-ghost" id="forget-tmdb">${icon('close')} Forget TMDB key</button>` : ''}
              <button class="btn btn-ghost btn-danger" id="reset-learning">${icon('refresh')} Reset queue learning</button>
              <button class="btn btn-ghost btn-danger" id="erase">${icon('trash')} Erase ${W.item} data</button>
            </div>
            ${D.id === 'films' ? html`<p class="attribution faint">Film data and posters from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>` : ''}
          </div>
        </div>
      </section>`
    );

    root.onclick = (e) => {
      const b = e.target.closest('[data-pref]');
      if (b) return setPref(b.dataset.tag, b.dataset.pref);
      const c = e.target.closest('[data-clear]');
      if (c) return setPref(c.dataset.clear, null);
    };
    $('#add-theme', root).onsubmit = (e) => {
      e.preventDefault();
      addTheme($('#theme-input', root).value);
    };
    $('#recal', root).onclick = () => {
      state.calibDone = false;
      DQ.store.save('calibDone');
    };
    $('#reset-learning', root).onclick = resetLearning;
    $('#forget-tmdb', root)?.addEventListener('click', () => {
      if (!confirm('Forget your TMDB key on this device? Your films stay, but importing or finding new candidates will need the key again.')) return;
      state.tmdb = { key: '' };
      DQ.store.save('tmdb');
      toast('TMDB key forgotten.');
    });
    $('#erase', root).onclick = eraseAll;
    if (!tip) bindTips();
    bindAi();
    bindTwins();
  }

  DQ.views.profile = {
    render(r) {
      tip = null;
      render(r);
      // Arriving from the set-up guide with the form open: bring it into view once the router has settled.
      if (aiEditing) requestAnimationFrame(() => $('#ai', r)?.scrollIntoView({ block: 'center' }));
    },
    /** Open the by-hand AI settings form (the set-up guide links here for unusual services). */
    editAi() {
      if (!DQ.app.ready()) return toast(`Advanced settings live on Your Taste, which opens once you've imported your ${W.service} export.`, { timeout: 6000 });
      aiEditing = true;
      DQ.app.go('profile');
    },
    destroy() {
      tip?.remove();
      tip = null;
      root = null;
    },
  };
})();
