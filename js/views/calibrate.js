/* Optional quick-rate pass over read-but-unrated books (or watched-but-unrated films). Goodreads
   exports are mostly 0-star "read" rows; a single tap each separates the ones that landed from the
   ones you just finished. */
(function () {
  const { html, icon, mount, $, coverImg, plural } = DQ.util;
  const S = DQ.subjects;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  DQ.views = DQ.views || {};

  const RATINGS = [
    ['loved', 'Loved it', '1'],
    ['liked', 'Liked it', '2'],
    ['ok', 'It was OK', '3'],
    ['disliked', "Didn't like it", '4'],
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let list = [];
  let idx = 0;
  let root = null;
  let busy = false;

  function candidates() {
    return state.library
      .filter((b) => b.exclusive === 'read' && !b.rating)
      .sort((a, b) => (b.dateRead || b.dateAdded || 0) - (a.dateRead || a.dateAdded || 0));
  }

  function when(b) {
    if (b.dateRead) {
      const d = new Date(b.dateRead);
      return `${W.Did} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
    return b.dateAdded ? `${W.logged} ${new Date(b.dateAdded).getFullYear()}` : '';
  }

  function cardHtml(b) {
    const e = state.enrich[b.gid];
    const cur = state.calib[b.gid];
    return html`<article class="calib-card panel">
      <div class="calib-cover">${coverImg({ title: b.title, author: b.author, cover: e && !e.miss ? e.cover : null }, 'L')}</div>
      <div class="calib-info">
        <div class="eyebrow">${b.series ? `${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''}` : when(b)}</div>
        <h2>${b.title}</h2>
        <div class="by">${b.author ? `${W.by} ${b.author}` : b.year || ''}${b.series ? ' · ' + when(b) : ''}${b.readCount > 1 ? ` · ${W.did} ${b.readCount}×` : ''}</div>
        <div class="rate-row">
          ${RATINGS.map(
            ([k, label, key]) => html`<button class="rate-btn ${k} ${cur === k ? 'sel' : ''}" data-rate="${k}" ${cur === k ? html`aria-pressed="true"` : ''}>
              <span>${label}</span><kbd>${key}</kbd></button>`
          )}
        </div>
        <button class="btn btn-ghost btn-sm rate-skip" data-rate="skip">${D.t.calibSkip} <kbd>S</kbd></button>
      </div>
    </article>`;
  }

  function updateLearning() {
    const model = DQ.app.model();
    const tags = model.topTags(10);
    $('#learn', root).innerHTML = String(html`${tags.map((t) => html`<span class="tag static">${S.display(t.tag)}</span>`)}`);
    const authors = model.topAuthors(3).map((a) => a.name);
    $('#learn-note', root).textContent =
      `${plural(model.facets.length, 'distinct side')} to your ${W.activity} so far.` + (authors.length ? ` Strongest pull: ${authors.join(', ')}.` : '');
  }

  function show(i, dir = 1) {
    idx = i;
    const stage = $('.calib-stage', root);
    $('.progress > i', root).style.width = `${(i / list.length) * 100}%`;
    $('#calib-count', root).textContent = `${Math.min(i + 1, list.length)} of ${list.length}`;
    if (i >= list.length) return finish();
    const old = stage.firstElementChild;
    const tmp = document.createElement('div');
    tmp.innerHTML = String(cardHtml(list[i]));
    const card = tmp.firstElementChild;
    if (old) {
      card.classList.add('entering');
      old.classList.add('leaving');
      stage.appendChild(card);
      void card.offsetWidth;
      card.classList.remove('entering');
      setTimeout(() => old.remove(), 260);
    } else stage.appendChild(card);
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rate]');
      if (btn) rate(btn.dataset.rate);
    });
  }

  function rate(k) {
    if (busy || idx >= list.length) return;
    const b = list[idx];
    if (k === 'skip') state.calib[b.gid] = 'skip';
    else state.calib[b.gid] = k;
    DQ.store.save('calib');
    DQ.app.invalidate();
    const btn = $(`.calib-card:last-child [data-rate="${k}"]`, root);
    btn?.classList.add('sel');
    busy = true;
    setTimeout(() => {
      busy = false;
      if (k !== 'skip') updateLearning();
      show(idx + 1);
    }, 140);
  }

  function finish() {
    state.calibDone = true;
    DQ.store.save('calibDone');
    DQ.app.invalidate();
    // New ratings can shift the whole profile: rebuild the current queue from scratch.
    if (state.queue && state.queue.idx === 0) DQ.store.reset(['queue']);
    DQ.app.go('queue');
  }

  DQ.views.calibrate = {
    render(r) {
      root = r;
      list = candidates();
      if (!list.length) return finish();
      mount(
        root,
        html`<section class="calib">
          <div class="calib-head">
            <div>
              <div class="eyebrow">Optional · about a minute</div>
              <h1>Mark your standouts and duds</h1>
              <p>${D.t.calibIntro}</p>
            </div>
            <button class="btn btn-primary" id="calib-done">Done, show my queue ${icon('next')}</button>
          </div>
          <div class="q-progress" style="margin-bottom:10px"><span class="q-count" id="calib-count"></span></div>
          <div class="progress" style="margin-bottom:18px"><i style="width:0%"></i></div>
          <div class="calib-grid">
            <div class="calib-stage"></div>
            <aside class="panel learning" aria-live="polite">
              <h3>What I'm picking up</h3>
              <div class="tags" id="learn"></div>
              <p class="faint" id="learn-note" style="margin:12px 0 0;font-size:13px"></p>
            </aside>
          </div>
        </section>`
      );
      $('#calib-done', root).onclick = finish;
      const first = list.findIndex((b) => !state.calib[b.gid]);
      show(first < 0 ? 0 : first);
      updateLearning();
    },
    onKey(e) {
      const map = { 1: 'loved', 2: 'liked', 3: 'ok', 4: 'disliked', s: 'skip', S: 'skip', ArrowRight: 'skip', 5: 'skip' };
      if (map[e.key]) {
        e.preventDefault();
        rate(map[e.key]);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        show(idx - 1, -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish();
      }
    },
    destroy() {
      root = null;
    },
  };
})();
