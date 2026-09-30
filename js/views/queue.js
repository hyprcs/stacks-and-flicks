/* The discovery queue: one book or film at a time, Steam-style, learning from every action. */
(function () {
  const U = DQ.util;
  const { html, raw, icon, mount, $, $$, coverImg, coverUrl, fmtCount, preloadImage, toast, plural } = U;
  const S = DQ.subjects;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  let root = null;
  let pendingAdvance = null;
  let reasonToast = null;
  let popover = null;
  let bdFlip = 0;

  const q = () => state.queue;
  const curItem = () => q()?.items[q().idx];
  const docOf = (item) => item && (state.pool[item.key] || state.events[item.key]?.doc || state.wishlist.find((w) => w.key === item.key)?.doc);

  // Compact copy stored with events/wishlist so they survive pool pruning.
  const snapshot = (d) => ({
    key: d.key, title: d.title, authors: d.authors, authorKeys: d.authorKeys, tags: d.tags, year: d.year, pages: d.pages,
    cover: d.cover, wtr: d.wtr, rating: d.rating, ratingCount: d.ratingCount, isbn: d.isbn, grId: d.grId, series: d.series,
    seriesNum: d.seriesNum,
  });

  // ---------------------------------------------------------------- rendering

  function shellHtml() {
    return html`<section class="queue">
      <div class="q-head">
        <div class="q-title">
          <h1>Your Discovery Queue</h1>
          <p id="q-sub">Picked from your ${W.library}, one at a time. Every choice tunes the next pick.</p>
        </div>
        <div class="q-progress">
          <div class="q-dots" id="q-dots" aria-hidden="true"></div>
          <span class="q-count" id="q-count"></span>
          <div class="customize">
            <button class="btn btn-ghost btn-sm" id="customize" aria-haspopup="true">${icon('sliders')} Customize</button>
          </div>
        </div>
      </div>
      <div class="stage" id="stage">
        <div class="backdrop"><div class="bd"></div><div class="bd"></div></div>
        <div class="card-host" id="card-host"></div>
      </div>
      <div class="actions" id="actions"></div>
      <div class="hints" id="hints">
        <span><kbd>W</kbd> ${W.wishHint}</span><span><kbd>R</kbd> ${W.seenHint}</span><span><kbd>X</kbd> not for me</span>
        <span><kbd>→</kbd> / <kbd>Space</kbd> next</span><span><kbd>←</kbd> back</span><span><kbd>D</kbd> more description</span>
      </div>
    </section>`;
  }

  function stars(r) {
    const full = Math.round(r * 2) / 2;
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= full ? '★' : i - 0.5 === full ? '⯪' : '☆';
    return s;
  }

  function cardHtml(item, doc, model) {
    const ex = model.explain(doc, item.kind, item.exploreTag);
    const explore = item.kind === 'explore';
    const author = doc.authors?.[0] || `Unknown ${W.creator}`;
    const matched = new Set(ex.matched);
    const warned = new Map(ex.warned.map((w) => [w.tag, w.why]));
    const shown = [
      ...ex.matched,
      ...doc.tags.filter((t) => !matched.has(t) && ((model.df.get(t) || 0) >= 2 || warned.has(t)) && t.length <= 34),
    ].slice(0, 11);
    const nByAuthor = state.library.filter((b) => U.normAuthor(b.author) === model.authorId(doc) && b.exclusive !== 'to-read').length;

    const tagChip = (t) => {
      const pref = state.tags[t];
      const cls = [matched.has(t) ? 'match' : '', warned.has(t) ? 'warn' : '', pref === 'more' ? 'more' : '', pref === 'less' ? 'less' : ''].join(' ');
      return html`<button class="tag ${cls}" data-tag="${t}" title="Tune this theme">${S.display(t)}</button>`;
    };

    const whyItems = [];
    if (ex.ai) {
      whyItems.push(html`<li class="ai-why">${icon('spark')}<span><b>${ex.ai.model}</b> suggested this: “${ex.ai.why}”</span></li>`);
    }
    if (ex.twin) {
      const shown = ex.twin.by.slice(0, 4);
      whyItems.push(html`<li class="twin-why">${icon('user')}<span>${ex.twin.by.length > 1 ? `${ex.twin.by.length} of your taste twins loved it:` : 'Your taste twin loved it:'}
        ${shown.map((b, i) => html`<b>${b.name}</b>${b.r ? html` <span class="twin-stars">${stars(b.r)}</span>` : ''}${b.l ? ' ♥' : ''}${i < shown.length - 1 ? ', ' : ''}`)}</span></li>`);
    }
    if (explore && !ex.ai) {
      whyItems.push(html`<li>${icon('compass')}<span>Picked to learn: you haven't told me much about
        <b>${S.display(item.exploreTag || ex.matched[0] || 'this')}</b> yet. Either answer teaches the queue something.</span></li>`);
    }
    if (ex.matched.length) {
      whyItems.push(html`<li>${icon('spark')}<span>Matches your taste for</span>
        ${ex.matched.slice(0, 3).map((t) => html`<span class="tag match static">${S.display(t)}</span>`)}</li>`);
    }
    if (ex.similar.length) {
      whyItems.push(html`<li>${icon(D.icon)}<span>Shares themes with</span>
        ${ex.similar.map((x, i) => html`<span class="similar">${coverImg({ title: x.s.title, author: x.s.authorName, cover: x.s.cover }, 'S')}
          <span>${x.s.title}</span></span>${i < ex.similar.length - 1 ? ',' : ''}`)}</li>`);
    }
    if (nByAuthor && ex.authorAff > 0.1) {
      whyItems.push(html`<li>${icon('user')}<span>You've ${W.done} ${plural(nByAuthor, W.item)} by <b>${author}</b></span></li>`);
    }
    for (const w of ex.warned) {
      const why = w.why === 'passed' ? "You've been passing on" : w.why === 'less' ? 'You asked for less' : `Not usually ${W.onLibrary}:`;
      whyItems.push(html`<li class="warn">${icon('warn')}<span>${why} <b>${S.display(w.tag)}</b></span></li>`);
    }

    const meta = [];
    if (doc.rating && doc.ratingCount) {
      meta.push(html`<span><span class="stars" aria-hidden="true">${stars(doc.rating)}</span> ${doc.rating.toFixed(1)}
        <span class="faint">(${fmtCount(doc.ratingCount)} ${W.ratings})</span></span>`);
    }
    if (doc.wtr && W.wtr) meta.push(html`<span>${fmtCount(doc.wtr)} ${W.wtr}</span>`);
    ex.badges.forEach((b) => meta.push(html`<span class="badge ${b === 'Hidden gem' ? 'gem' : ''}">${b}</span>`));

    const byline = [doc.year, doc.pages ? D.length.label(doc.pages) : null].filter(Boolean).join(' · ');

    return html`<article class="card" data-key="${item.key}">
      <div class="cover-col">
        <div class="cover-wrap">${doc.cover ? html`${U.fallbackCover(doc.title, author, 'ph')}${coverImg(doc, 'L', 'real', true)}` : coverImg(doc, 'L')}</div>
        <span class="match-badge ${explore ? 'explore' : ''}">${explore ? html`${icon('compass')} <small>Explore</small>` : html`${item.pct || 50}% <small>match</small>`}</span>
        <div class="cover-links">
          ${D.links(doc).map((l) => html`<a href="${l.url}" target="_blank" rel="noopener">${icon('external')} ${l.label}</a>`)}
        </div>
      </div>
      <div class="info">
        <div class="kicker ${ex.ai ? 'ai' : ex.primary.twin ? 'twin' : explore ? 'explore' : ''}">${icon(ex.primary.icon)}<span>${ex.primary.text}</span></div>
        <div>
          <h2 class="book-title">${doc.title}</h2>
          <div class="byline" style="margin-top:8px">${W.by} <b>${author}</b>${byline ? ' · ' + byline : ''}</div>
        </div>
        ${meta.length ? html`<div class="meta">${meta}</div>` : ''}
        <div class="desc clamped loading" id="desc">
          <span class="skeleton" style="width:94%"></span><span class="skeleton" style="width:88%"></span>
          <span class="skeleton" style="width:91%"></span><span class="skeleton" style="width:60%"></span>
        </div>
        <button class="desc-toggle" id="desc-toggle" hidden>Read more</button>
        ${shown.length ? html`<div class="tags" aria-label="Themes">${shown.map(tagChip)}</div>` : ''}
        ${whyItems.length ? html`<div class="why"><h3>Why it's in your queue</h3><ul>${whyItems}</ul></div>` : ''}
      </div>
    </article>`;
  }

  function actionsHtml() {
    const item = curItem();
    const d = q().decisions[item.key] || '';
    const next = q().items[q().idx + 1];
    const nd = next && docOf(next);
    const wanted = d === 'want';
    return html`
      <div class="left">
        <button class="btn btn-green act act-want ${wanted ? 'on' : ''}" data-act="want" aria-pressed="${wanted}">
          ${icon(wanted ? 'heartFill' : 'heart')}<span>${wanted ? W.onWishlist : W.wishlist}</span></button>
        <button class="btn act act-read ${d.startsWith('read') ? 'on' : ''}" data-act="read" aria-haspopup="true">
          ${icon('check')}<span>${d.startsWith('read') ? W.seen : html`${W.seenIt}<span class="lbl-long"> already</span>`}</span></button>
        <button class="btn act act-pass ${d === 'pass' ? 'on' : ''}" data-act="pass" aria-pressed="${d === 'pass'}">
          ${icon('ban')}<span>Not for me</span></button>
      </div>
      <button class="btn btn-ghost back-btn" data-act="back" title="Previous (←)" aria-label="Previous ${W.item}" ${q().idx === 0 ? 'disabled' : ''}>${icon('prev')}</button>
      <button class="next-btn" data-act="next">
        ${nd ? html`<span class="thumb">${coverImg(nd, 'M')}</span>` : ''}
        <span class="lbl"><small>${nd ? 'Next in queue' : 'Last one'}</small><span>${nd ? nd.title : 'Finish this queue'}</span></span>
        ${icon('next')}
      </button>`;
  }

  function renderDots() {
    const Q = q();
    $('#q-dots', root).innerHTML = Q.items
      .map((it, i) => {
        const d = Q.decisions[it.key] || '';
        const cls = i === Q.idx ? 'cur' : d === 'want' ? 'want' : d === 'pass' ? 'pass' : d.startsWith('read') ? 'read' : i < Q.idx ? 'done' : '';
        return `<i class="${cls}"></i>`;
      })
      .join('');
    $('#q-count', root).textContent = `${Math.min(Q.idx + 1, Q.items.length)} of ${Q.items.length}`;
  }

  function renderActions() {
    $('#actions', root).innerHTML = String(actionsHtml());
  }

  function setBackdrop(doc) {
    const layers = $$('.backdrop .bd', root);
    const url = coverUrl(doc?.cover, 'M');
    bdFlip ^= 1;
    const on = layers[bdFlip], off = layers[bdFlip ^ 1];
    on.style.backgroundImage = url ? `url("${url}")` : 'none';
    on.classList.add('on');
    off.classList.remove('on');
  }

  function fillDescription(card, doc) {
    DQ.source.description(doc).then((desc) => {
      if (!root || !card.isConnected) return;
      const el = $('#desc', card);
      const toggle = $('#desc-toggle', card);
      el.classList.remove('loading');
      if (!desc) {
        el.classList.remove('clamped');
        el.innerHTML = String(html`<p class="faint">${D.t.noDesc}</p>`);
        return;
      }
      el.innerHTML = desc
        .split(/\n{2,}/)
        .map((p) => `<p>${U.esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
      const long = desc.length > 520;
      el.classList.toggle('clamped', long);
      toggle.hidden = !long;
      toggle.onclick = () => {
        const open = el.classList.toggle('clamped');
        toggle.textContent = open ? 'Read more' : 'Show less';
      };
    });
  }

  function prefetch() {
    const Q = q();
    for (let i = Q.idx + 1; i <= Q.idx + 2; i++) {
      const d = docOf(Q.items[i]);
      if (!d) continue;
      preloadImage(coverUrl(d.cover, 'L'));
      if (i === Q.idx + 1) setTimeout(() => DQ.source.description(d), 500);
    }
  }

  /** Show q.idx. dir: 1 = forward, -1 = back, 0 = no animation. */
  function showItem(dir = 0) {
    closePopover();
    const Q = q();
    const item = curItem();
    const doc = docOf(item);
    if (!doc) {
      // Candidate vanished (shouldn't happen); drop it and move on.
      Q.items.splice(Q.idx, 1);
      return Q.idx < Q.items.length ? showItem(dir) : finishQueue();
    }
    state.seen[item.key] = state.seen[item.key] || Date.now();
    DQ.store.save('seen', 'queue');

    const model = DQ.app.model();
    const host = $('#card-host', root);
    const tmp = document.createElement('div');
    tmp.innerHTML = String(cardHtml(item, doc, model));
    const card = tmp.firstElementChild;

    const old = host.querySelector('.card:not(.leave-left):not(.leave-right)') || host.querySelector('.summary, .queue-loading');
    if (old && dir && old.classList.contains('card')) {
      old.classList.add(dir > 0 ? 'leave-left' : 'leave-right');
      setTimeout(() => old.remove(), 320);
      card.classList.add(dir > 0 ? 'enter-right' : 'enter-left');
      host.appendChild(card);
      void card.offsetWidth; // commit the start state so the transition runs even if frames are throttled
      card.classList.remove('enter-right', 'enter-left');
    } else {
      host.innerHTML = '';
      host.appendChild(card);
    }
    const img = $('.cover-wrap img.real', card);
    if (img?.complete && img.naturalWidth > 5) img.classList.add('loaded');
    $('#actions', root).hidden = false;
    $('#hints', root).hidden = false;
    setBackdrop(doc);
    renderDots();
    renderActions();
    fillDescription(card, doc);
    attachSwipe(card);
    prefetch();
  }

  function showLoading(msg) {
    const host = $('#card-host', root);
    host.innerHTML = String(html`<div class="queue-loading"><div class="spinner"></div><div>${msg}</div></div>`);
    $('#actions', root).hidden = true;
    $('#hints', root).hidden = true;
    $('#q-dots', root).innerHTML = '';
    $('#q-count', root).textContent = '';
  }

  // ---------------------------------------------------------------- actions

  function record(item, ev) {
    const doc = docOf(item);
    state.events[item.key] = { ...ev, t: Date.now(), doc: snapshot(doc) };
    DQ.store.save('events');
  }

  function removeWish(key) {
    const before = state.wishlist.length;
    state.wishlist = state.wishlist.filter((w) => w.key !== key);
    if (state.wishlist.length !== before) DQ.store.save('wishlist');
  }

  // The model changed: re-pick what's coming, keep the pool topped up in the background.
  function learn() {
    DQ.app.invalidate();
    const model = DQ.app.model();
    DQ.rec.refreshUpcoming(model);
    DQ.store.save('queue');
    DQ.app.refreshChrome();
    renderDots();
    renderActions();
    prefetch();
    DQ.rec.ensurePool(model, { min: 60 }).catch(() => {});
  }

  function cancelPending() {
    if (pendingAdvance) clearTimeout(pendingAdvance);
    pendingAdvance = null;
  }

  function go(i, dir) {
    cancelPending();
    const Q = q();
    Q.idx = Math.max(0, Math.min(i, Q.items.length));
    DQ.store.save('queue');
    if (Q.idx >= Q.items.length) return finishQueue();
    showItem(dir);
  }

  function next() {
    const item = curItem();
    if (!item) return;
    if (!q().decisions[item.key]) {
      record(item, { action: 'skip' });
      q().decisions[item.key] = 'skip';
      learn();
    }
    go(q().idx + 1, 1);
  }

  function back() {
    if (q().idx > 0) go(q().idx - 1, -1);
  }

  function want() {
    const item = curItem();
    const Q = q();
    if (Q.decisions[item.key] === 'want') {
      delete state.events[item.key];
      delete Q.decisions[item.key];
      removeWish(item.key);
      DQ.store.save('events');
      learn();
      toast(`Removed from ${W.wishlistRef}.`);
      return;
    }
    const doc = docOf(item);
    const why = DQ.app.model().explain(doc, item.kind, item.exploreTag).primary.text;
    record(item, { action: 'want' });
    Q.decisions[item.key] = 'want';
    removeWish(item.key);
    state.wishlist.unshift({ key: item.key, t: Date.now(), doc: snapshot(doc), why });
    DQ.store.save('wishlist');
    learn();
    cancelPending();
    const idx = Q.idx;
    pendingAdvance = setTimeout(() => q().idx === idx && go(idx + 1, 1), 420);
  }

  function pass() {
    const item = curItem();
    const Q = q();
    if (Q.decisions[item.key] === 'pass') {
      delete state.events[item.key];
      delete Q.decisions[item.key];
      DQ.store.save('events');
      learn();
      return;
    }
    removeWish(item.key);
    record(item, { action: 'pass' });
    Q.decisions[item.key] = 'pass';
    learn();
    askReason(item);
    go(Q.idx + 1, 1);
  }

  // Why-not follow-up: optional, one tap, sharpens what the pass teaches.
  function askReason(item) {
    reasonToast?.close();
    const doc = docOf(item);
    const set = (reason) => {
      const ev = state.events[item.key];
      if (!ev || ev.action !== 'pass') return;
      ev.reason = reason;
      DQ.store.save('events');
      learn();
    };
    const eraLabel = doc.year && doc.year < 1960 ? 'Too old-fashioned' : doc.year && doc.year > 2010 ? 'Too recent' : 'Wrong era';
    const opts = [
      { label: 'Not my kind of story', onClick: () => set('genre') },
      { label: `Not into ${doc.authors?.[0] || 'the author'}`, onClick: () => set('author') },
    ];
    if (doc.pages > D.length.long) opts.push({ label: 'Too long', onClick: () => set('length') });
    if (doc.year) opts.push({ label: eraLabel, onClick: () => set('era') });
    opts.push({ label: 'Just not right now', onClick: () => set('notnow') });
    reasonToast = toast(html`Passed on <b>${doc.title}</b>. What put you off? <span class="faint">(optional)</span>`, { timeout: 6500, actions: opts });
  }

  const READ_OPTS = [
    ['loved', 'Loved it', '1'],
    ['liked', 'Liked it', '2'],
    ['ok', 'It was OK', '3'],
    ['disliked', "Didn't like it", '4'],
  ];

  function openReadPopover() {
    if (popover?.kind === 'read') return closePopover();
    closePopover();
    const item = curItem();
    const cur = state.events[item.key]?.action === 'read' ? state.events[item.key].rating : null;
    const el = document.createElement('div');
    el.className = 'popover';
    el.setAttribute('role', 'dialog');
    el.innerHTML = String(html`<h4>You've ${W.done} it. How was it?</h4><div class="opts">
      ${READ_OPTS.map(([k, label, key]) => html`<button data-rating="${k}" class="${cur === k ? 'sel' : ''}"><span>${label}</span><kbd>${key}</kbd></button>`)}
      </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rating]');
      if (b) markRead(b.dataset.rating);
    });
    $('#actions .left', root).appendChild(el);
    el.style.left = `${$('#actions .act-read', root).offsetLeft}px`;
    popover = { kind: 'read', el };
    el.querySelector('button')?.focus({ preventScroll: true });
  }

  function markRead(rating) {
    closePopover();
    const item = curItem();
    removeWish(item.key);
    record(item, { action: 'read', rating });
    q().decisions[item.key] = 'read:' + rating;
    learn();
    const said = { loved: 'you loved it', liked: 'you liked it', ok: 'it was OK', disliked: "it wasn't for you" }[rating];
    toast(html`Noted: ${said}. It now counts like a ${W.item} ${W.inLibrary}.`);
    go(q().idx + 1, 1);
  }

  function closePopover() {
    popover?.el.remove();
    popover = null;
  }

  // ---------------------------------------------------------------- tag tuning

  function openTagMenu(chip) {
    closePopover();
    const tag = chip.dataset.tag;
    const cur = state.tags[tag];
    const el = document.createElement('div');
    el.className = 'popover tag-menu';
    el.innerHTML = String(html`<h4>${S.display(tag)}</h4><div class="opts">
      <button data-pref="more" class="${cur === 'more' ? 'sel' : ''}"><span>More like this</span>${icon('plus')}</button>
      <button data-pref="less" class="${cur === 'less' ? 'sel' : ''}"><span>Less of this</span>${icon('minus')}</button>
      <button data-pref="ban" class="${cur === 'ban' ? 'sel' : ''}"><span>Never show me this</span>${icon('ban')}</button>
      ${cur ? html`<button data-pref=""><span>Back to automatic</span>${icon('refresh')}</button>` : ''}
    </div>`);
    document.body.appendChild(el);
    const r = chip.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left))}px`;
    el.style.top = `${r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8}px`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pref]');
      if (!b) return;
      setTagPref(tag, b.dataset.pref);
      closePopover();
    });
    popover = { kind: 'tag', el };
  }

  function setTagPref(tag, pref) {
    if (pref) state.tags[tag] = pref;
    else delete state.tags[tag];
    DQ.store.save('tags');
    learn();
    $$(`.card [data-tag="${CSS.escape(tag)}"]`, root).forEach((c) => {
      c.classList.toggle('more', pref === 'more');
      c.classList.toggle('less', pref === 'less' || pref === 'ban');
    });
    const msg = { more: `More ${S.display(tag)} coming up.`, less: `Less ${S.display(tag)} from now on.`, ban: `${S.display(tag)} is off the table.`, '': `${S.display(tag)} is back to automatic.` }[pref];
    toast(msg);
    if (pref === 'more') DQ.rec.ensurePool(DQ.app.model(), { min: 999 }).then(() => DQ.rec.refreshUpcoming(DQ.app.model()));
  }

  // ---------------------------------------------------------------- customize

  function openCustomize() {
    if (popover?.kind === 'custom') return closePopover();
    closePopover();
    const s = state.settings;
    const seg = (key, opts) =>
      html`<div class="seg" role="radiogroup">${opts.map(
        ([v, label]) => html`<button role="radio" aria-checked="${s[key] === v}" class="${s[key] === v ? 'sel' : ''}" data-key="${key}" data-val="${v}">${label}</button>`
      )}</div>`;
    const el = document.createElement('div');
    el.className = 'popover';
    el.innerHTML = String(html`
      <div class="seg-label">Adventurousness</div>
      ${seg('adventure', [[0, 'Comfort zone'], [1, 'Balanced'], [2, 'Adventurous']])}
      <p class="seg-note">How many picks probe beyond what you already like.</p>
      <div class="seg-label">Popularity</div>
      ${seg('popularity', [[1, 'Well-known'], [0, 'Balanced'], [-1, 'Hidden gems']])}
      <div class="seg-label">Queue length</div>
      ${seg('size', [[8, '8'], [12, '12'], [20, '20']])}
      <p class="seg-note">Length applies to your next queue; the rest applies right away.</p>
      ${DQ.twins && Object.keys(state.twins?.users || {}).length
        ? html`<div class="seg-label">Taste-twin picks per queue</div>${seg('twinsPerQueue', [[0, 'None'], [3, 'Some'], [6, 'Lots']])}`
        : ''}
      ${DQ.ai.enabled()
        ? html`<div class="seg-label">AI picks per queue</div>
            ${seg('aiPerQueue', [[2, 'Few'], [4, 'Some'], [8, 'Lots']])}
            <button class="btn btn-sm" id="ai-now" ${DQ.ai.isRunning() ? 'disabled' : ''}>${icon('spark')} Get new AI picks now</button>`
        : html`<p class="seg-note" style="margin:0">Want picks from a language model too? <a href="#/profile">Set up AI assist</a> (optional, bring your own key).</p>`}`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('#ai-now')) {
        closePopover();
        DQ.ai.run().catch(() => {});
        return;
      }
      const b = e.target.closest('[data-key]');
      if (!b) return;
      state.settings[b.dataset.key] = Number(b.dataset.val);
      DQ.store.save('settings');
      $$(`[data-key="${b.dataset.key}"]`, el).forEach((x) => {
        x.classList.toggle('sel', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
      learn();
    });
    $('.customize', root).appendChild(el);
    popover = { kind: 'custom', el };
  }

  // ---------------------------------------------------------------- end of queue

  function finishQueue() {
    const Q = q();
    closePopover();
    if (!Q.done) {
      Q.done = true;
      const counts = { want: 0, pass: 0, read: 0, skip: 0 };
      Object.values(Q.decisions).forEach((d) => counts[d.split(':')[0]]++);
      state.history.push({ t: Date.now(), size: Q.items.length, ...counts });
      state.history = state.history.slice(-50);
      DQ.store.save('queue', 'history');
    }
    const model = DQ.app.model();
    const counts = { want: [], pass: 0, read: 0, skip: 0 };
    Q.items.forEach((it) => {
      const d = (Q.decisions[it.key] || 'skip').split(':')[0];
      if (d === 'want') counts.want.push(docOf(it));
      else counts[d]++;
    });
    const now = model.snapshot();
    const before = Q.snapshot || {};
    const deltas = Object.keys({ ...now, ...before })
      .map((t) => ({ t, d: (now[t] || 0) - (before[t] || 0) }))
      .filter((x) => Math.abs(x.d) > 0.15 && (model.df.get(x.t) || 0) >= 3 && !S.isSensitive(x.t))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 6);

    // One-time offer of AI picks, when they're off and one-click connect is possible.
    const showNudge = !DQ.ai.enabled() && DQ.ai.canConnect() && !state.ai?.nudged;
    const c = DQ.ai.runCost(DQ.ai.DEFAULT_MODEL);
    const nudgeCost = c == null ? 'a cent or two' : c < 0.1 ? `${(c * 100).toFixed(c < 0.01 ? 2 : 1)}¢` : `$${c.toFixed(2)}`;
    $('#actions', root).hidden = true;
    $('#hints', root).hidden = true;
    renderDots();
    $('#q-count', root).textContent = 'Done';
    setBackdrop(counts.want[0] || null);
    $('#card-host', root).innerHTML = String(html`<div class="summary">
      <div>
        <div class="eyebrow">Queue complete</div>
        <h2 style="margin-top:6px">You've reached the end of your queue</h2>
      </div>
      <div class="summary-stats">
        <div class="stat"><b>${counts.want.length}</b><span>added to ${W.wishlistRef}</span></div>
        <div class="stat"><b>${counts.pass}</b><span>not for you</span></div>
        <div class="stat"><b>${counts.read}</b><span>already ${W.done}</span></div>
        <div class="stat"><b>${counts.skip}</b><span>skipped</span></div>
      </div>
      ${counts.want.length ? html`<div class="summary-covers">${counts.want.filter(Boolean).map((d) => coverImg(d, 'M'))}</div>` : ''}
      <div class="learned">
        <h3>What this queue taught me</h3>
        ${deltas.length
          ? html`<div class="tags">${deltas.map((x) => html`<span class="delta ${x.d > 0 ? 'up' : 'down'}">${x.d > 0 ? '▲' : '▼'} ${S.display(x.t)}</span>`)}</div>`
          : html`<p class="muted" style="margin:0">Nothing decisive yet. Passing on a few or adding a few gives me more to go on.</p>`}
      </div>
      ${showNudge ? html`<div class="ai-nudge" id="ai-nudge">${icon('spark')}
        <div><b>Want AI picks too?</b> A language model can read your ${W.library} and suggest ${W.items} the tags miss.
          Connect OpenRouter in one click; a run costs about ${nudgeCost}.</div>
        <div class="ai-actions"><button class="btn btn-sm btn-primary" id="nudge-connect">Connect OpenRouter</button>
          <button class="btn btn-sm btn-ghost" id="nudge-later">Not now</button></div>
      </div>` : ''}
      <div class="summary-actions">
        <button class="btn btn-primary btn-lg" id="again">Start another queue ${icon('next')}</button>
        <a class="btn" href="#/wishlist">${icon('heart')} ${W.wishlist}</a>
        <a class="btn btn-ghost" href="#/profile">${icon('user')} Your taste profile</a>
      </div>
    </div>`);
    $('#again', root).onclick = newQueue;
    $('#again', root).focus({ preventScroll: true });
    $('#nudge-connect', root)?.addEventListener('click', () => DQ.ai.connectOpenRouter());
    $('#nudge-later', root)?.addEventListener('click', () => {
      state.ai.nudged = true;
      DQ.store.save('ai');
      $('#ai-nudge', root)?.remove();
    });
    // Warm the pool for the next queue while the reader looks at the summary.
    DQ.rec.ensurePool(model, { min: 80 }).catch(() => {});
    DQ.ai.maybeRefresh();
  }

  async function newQueue() {
    showLoading('Lining up your next queue…');
    try {
      const size = state.settings.size || 12;
      if (DQ.rec.eligibleDocs().length < size * 3) await DQ.rec.ensurePool(DQ.app.model(), { min: 80 });
      DQ.app.invalidate();
      DQ.rec.buildQueue(DQ.app.model());
    } catch (e) {
      console.error(e);
    }
    if (!root) return;
    if (!q()?.items.length) {
      $('#card-host', root).innerHTML = String(html`<div class="queue-loading">
        <div>Couldn't find new candidates right now. ${W.source} may be busy.</div>
        <button class="btn btn-primary" id="retry">${icon('refresh')} Try again</button></div>`);
      $('#retry', root).onclick = newQueue;
      return;
    }
    showItem(0);
  }

  // ---------------------------------------------------------------- touch

  function attachSwipe(card) {
    let x0 = null, y0 = 0, dx = 0, id = null, horizontal = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button, a')) return;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = 0;
      id = e.pointerId;
      horizontal = null;
    });
    card.addEventListener('pointermove', (e) => {
      if (x0 == null || e.pointerId !== id) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (horizontal == null && Math.hypot(dx, dy) > 10) horizontal = Math.abs(dx) > Math.abs(dy);
      if (!horizontal) return;
      card.classList.add('dragging');
      card.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
      card.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 500));
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      card.classList.remove('dragging');
      card.style.transform = '';
      card.style.opacity = '';
      if (!horizontal) return;
      if (dx < -80) next();
      else if (dx > 80) back();
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- view

  function onClick(e) {
    if (popover && !e.target.closest('.popover, [data-act="read"], #customize')) closePopover();
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'next') next();
      else if (a === 'back') back();
      else if (a === 'want') want();
      else if (a === 'pass') pass();
      else if (a === 'read') openReadPopover();
      return;
    }
    const chip = e.target.closest('.card .tag[data-tag]');
    if (chip) return openTagMenu(chip);
    if (e.target.closest('#customize')) return openCustomize();
  }

  function onDocClick(e) {
    if (popover?.kind === 'tag' && !e.target.closest('.popover') && !e.target.closest('.tag[data-tag]')) closePopover();
  }

  function onAi(e) {
    if (!root) return;
    if (e.detail.state === 'done' && q() && !q().done && !$('#actions', root).hidden) {
      renderDots();
      renderActions();
      prefetch();
    }
  }
  document.addEventListener('dq:ai', onAi);

  DQ.views.queue = {
    render(r) {
      root = r;
      mount(root, shellHtml());
      root.addEventListener('click', onClick);
      document.addEventListener('click', onDocClick, true);
      const Q = q();
      if (!Q || !Q.items.length) newQueue();
      else if (Q.done || Q.idx >= Q.items.length) finishQueue();
      else showItem(0);
    },
    onKey(e) {
      if (!q() || !root || !$('#actions', root) || $('#actions', root).hidden) {
        if (e.key === 'Enter' && $('#again', root)) {
          e.preventDefault();
          newQueue();
        }
        return;
      }
      if (popover?.kind === 'read' && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        return markRead(READ_OPTS[+e.key - 1][0]);
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const map = {
        ArrowRight: next, ' ': next, Enter: next, j: next,
        ArrowLeft: back, k: back,
        w: want, x: pass, r: openReadPopover,
        d: () => $('#desc-toggle', root)?.click(),
        Escape: closePopover,
      };
      if (map[k]) {
        if (e.key === 'Enter' && e.target.closest?.('button, a')) return;
        e.preventDefault();
        map[k]();
      }
    },
    destroy() {
      cancelPending();
      closePopover();
      reasonToast?.close();
      document.removeEventListener('click', onDocClick, true);
      root = null;
    },
  };
})();
