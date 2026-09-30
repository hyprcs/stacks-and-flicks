/* Candidate generation (what to ask the metadata source for) and queue assembly
   (which candidates to show, in what order, with how much exploration). */
(function () {
  const { normAuthor, weightedPick } = DQ.util;
  const S = DQ.subjects;
  const D = DQ.D;
  const state = DQ.state;

  const POOL_MAX = D.poolMax;
  const titleKey = (d) => D.titleKey(d.title, d.authors?.[0], d.year);

  // ---------- exclusions ----------
  function libraryIndex() {
    const keys = new Set(), grIds = new Set(), titles = new Set();
    for (const b of state.library) {
      grIds.add(String(b.gid));
      const e = state.enrich[b.gid];
      if (e && !e.miss) (e.keys || [e.key]).forEach((k) => keys.add(k));
      titles.add(D.titleKey(b.title, b.author, b.year));
    }
    return { keys, grIds, titles };
  }

  // trusted: a model's suggestion, so an obscure title with few shelvings/votes is still fine.
  function eligible(doc, idx, trusted = false) {
    if (!doc || doc.nonbook || !doc.title) return false;
    if (idx.keys.has(doc.key) || state.seen[doc.key] || state.events[doc.key]) return false;
    if (doc.grIds?.some((id) => idx.grIds.has(String(id)))) return false;
    if (idx.titles.has(titleKey(doc))) return false;
    if (doc.tags.some((t) => state.tags[t] === 'ban')) return false;
    if (D.junk(doc)) return false;
    // Phantom/duplicate works nobody has shelved (or films almost nobody has rated).
    if (!trusted && !state.ai?.recs?.[doc.key] && !state.twins?.recs?.[doc.key] && (doc.wtr || 0) + (doc.readers || 0) + (doc.ratingCount || 0) < D.minPop) return false;
    return true;
  }

  function eligibleDocs(exclude = new Set()) {
    const idx = libraryIndex();
    const docs = Object.values(state.pool).filter((d) => !exclude.has(d.key) && eligible(d, idx));
    return collapseSeries(docs);
  }

  const jaccard = (a, b) => {
    const sb = new Set(b);
    const inter = a.filter((t) => sb.has(t)).length;
    return inter / (a.length + b.length - inter || 1);
  };
  const earlier = (a, b) => (a.year || 9999) < (b.year || 9999) || ((a.year || 9999) === (b.year || 9999) && a.wtr > b.wtr);

  // Only the entry point of a series is recommendable (Dune Messiah, not Children of Dune; The Blade
  // Itself, not Before They Are Hanged). Series come from subject headings or titles; failing that,
  // same-author books with near-identical tags are treated as one series.
  function collapseSeries(docs) {
    const first = new Map();
    for (const d of docs) {
      if (!d.series) continue;
      const cur = first.get(d.series);
      if (!cur || earlier(d, cur)) first.set(d.series, d);
    }
    let out = docs.filter((d) => !d.series || first.get(d.series) === d);

    const byAuthor = new Map();
    for (const d of out) {
      const a = normAuthor(d.authors?.[0] || '');
      if (!byAuthor.has(a)) byAuthor.set(a, []);
      byAuthor.get(a).push(d);
    }
    const drop = new Set();
    for (const list of byAuthor.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (earlier(a, b) ? -1 : 1));
      for (let i = 0; i < list.length; i++) {
        if (drop.has(list[i].key)) continue;
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.tags.length >= 3 && b.tags.length >= 3 && jaccard(a.tags, b.tags) >= 0.5) drop.add(b.key);
        }
      }
    }
    // Numbered sequels are dropped outright when an earlier book of theirs is in the pool.
    for (const list of byAuthor.values()) {
      if (list.some((d) => !(d.seriesNum >= 2))) list.filter((d) => d.seriesNum >= 2).forEach((d) => drop.add(d.key));
    }
    if (drop.size) out = out.filter((d) => !drop.has(d.key));
    return out;
  }

  // ---------- pool ----------
  let titleIndex = null;
  function mergeDoc(doc, plan) {
    if (!titleIndex) {
      titleIndex = new Map();
      for (const d of Object.values(state.pool)) titleIndex.set(titleKey(d), d.key);
    }
    const src = { type: plan.type, tag: plan.tag || null, ...(plan.type === 'similar' ? { ref: plan.ref } : {}) };
    const existing = state.pool[doc.key];
    if (existing) {
      if (!existing.src.some((s) => s.type === src.type && s.tag === src.tag) && existing.src.length < 4) existing.src.push(src);
      return false;
    }
    // Open Library has duplicate works for the same book; keep the better-known one.
    const tk = titleKey(doc);
    const dupKey = titleIndex.get(tk);
    if (dupKey && state.pool[dupKey]) {
      if ((state.pool[dupKey].wtr || 0) >= (doc.wtr || 0)) return false;
      delete state.pool[dupKey];
    }
    state.pool[doc.key] = { ...doc, src: [src], added: Date.now() };
    titleIndex.set(tk, doc.key);
    return true;
  }

  /** Add a doc from outside the normal searches (AI suggestions); returns the pool key it lives under. */
  function adopt(doc, src) {
    mergeDoc(doc, src);
    if (state.pool[doc.key]) return doc.key;
    return titleIndex?.get(titleKey(doc)) || null;
  }

  function prunePool() {
    const docs = Object.values(state.pool);
    if (docs.length <= POOL_MAX) return;
    const idx = libraryIndex();
    const queued = new Set((state.queue?.items || []).map((i) => i.key));
    const wished = new Set(state.wishlist.map((w) => w.key));
    const removable = docs
      .filter((d) => !queued.has(d.key) && !wished.has(d.key) && !state.events[d.key] && !state.ai?.recs?.[d.key] && !state.twins?.recs?.[d.key])
      .sort((a, b) => Number(eligible(a, idx)) - Number(eligible(b, idx)) || (a.wtr || 0) - (b.wtr || 0));
    for (const d of removable.slice(0, docs.length - POOL_MAX)) delete state.pool[d.key];
    titleIndex = null;
  }

  // ---------- query planning ----------
  function rawForms() {
    const out = {};
    for (const e of Object.values(state.enrich)) if (e?.raw) for (const [t, r] of Object.entries(e.raw)) out[t] ||= r;
    return out;
  }

  function planQueries(model, budget = 10) {
    const forms = rawForms();
    const subjQ = (tag) => {
      const f = S.queryForm(tag, forms[tag]);
      return f ? D.q.subject(f) : null;
    };
    const runs = (q) => state.queries[q]?.runs || 0;
    const options = [];
    const offer = (q, type, base, extra = {}) => {
      if (!q || state.queries[q]?.exhausted) return;
      options.push({ q, type, pr: base / (1 + 0.8 * runs(q)) + Math.random() * 0.15, ...extra });
    };

    // Themes the reader explicitly asked for.
    for (const [tag, p] of Object.entries(state.tags)) if (p === 'more') offer(subjQ(tag), 'tag', 3, { tag });

    // Every facet of the reader's taste gets its own searches, so one binge can't monopolise the pool.
    const totalW = model.facets.reduce((a, f) => a + f.weight, 0) || 1;
    model.facets.forEach((f) => {
      const share = f.weight / totalW;
      const [a, b] = f.tags.filter((t) => S.queryForm(t));
      if (a) offer(subjQ(a), 'facet', 1.0 + share, { tag: a });
      if (a && b) offer(`${subjQ(a)} AND ${subjQ(b)}`, 'facet', 1.25 + share, { tag: a, tag2: b });
    });

    const top = model.topTags(24).filter((x) => S.queryForm(x.tag));
    const topRank = top[0]?.rank || 1;
    top.slice(0, 12).forEach((x) => offer(subjQ(x.tag), 'theme', 1.2 * (x.rank / topRank), { tag: x.tag }));

    // Pairs of themes that co-occur in books the reader liked: more precise than either alone.
    const liked = model.signals.filter((s) => s.w >= 0.45 && s.tags.length);
    const head = top.slice(0, 9);
    for (let i = 0; i < head.length; i++) {
      for (let j = i + 1; j < head.length; j++) {
        const a = head[i].tag, b = head[j].tag;
        const co = liked.filter((s) => s.tags.includes(a) && s.tags.includes(b)).length;
        if (!co) continue;
        const qa = subjQ(a), qb = subjQ(b);
        if (qa && qb) offer(`${qa} AND ${qb}`, 'pair', 1.5 * Math.sqrt(head[i].rank * head[j].rank) / topRank * Math.min(1, co / 2), { tag: a, tag2: b });
      }
    }

    // "Because you read X": X's two most distinctive liked themes together.
    const libLiked = liked.filter((s) => s.src === 'library' || s.shelf === 'read');
    for (let k = 0; k < 3 && libLiked.length; k++) {
      const s = weightedPick(libLiked.map((x) => ({ item: x, w: x.w * x.m })));
      const distinct = s.tags
        .filter((t) => model.aff(t) > 0 && S.queryForm(t))
        .sort((a, b) => model.idf(b) - model.idf(a))
        .filter((t) => (model.df.get(t) || 0) >= 2)
        .slice(0, 2);
      if (distinct.length === 2) offer(`${subjQ(distinct[0])} AND ${subjQ(distinct[1])}`, 'because', 1.3, { tag: distinct[0], ref: s.title });
    }

    // Other books by authors the reader loves.
    const libAuthorKeys = new Map();
    for (const b of state.library) {
      const e = state.enrich[b.gid];
      if (e && !e.miss && e.authorKeys?.[0]) libAuthorKeys.set(normAuthor(b.author), e.authorKeys[0]);
    }
    model.topAuthors(6).forEach((a) => {
      const key = libAuthorKeys.get(a.id);
      const q = key && D.q.author(key);
      if (q && runs(q) === 0) offer(q, 'author', 1.0 * Math.tanh(a.a), { tag: a.name });
    });

    // "People who liked X also liked" lists (sources that have them), seeded from well-loved titles.
    if (D.q.similar) {
      const loved = libLiked.filter((s) => s.key && s.w >= 0.8).map((x) => ({ item: x, w: x.w * x.m }));
      for (let k = 0; k < 4 && loved.length; k++) {
        const s = weightedPick(loved);
        const q = D.q.similar(s.key);
        if (runs(q) === 0) offer(q, 'similar', 1.4, { tag: s.title, ref: s.title });
      }
    }

    // Exploration: themes that keep turning up near the reader's taste but that we know little about.
    const near = [...model.df.entries()]
      .filter(([t, n]) => n >= 4 && model.evidence(t) < 0.15 && S.queryForm(t) && !['juvenile', 'young adult'].includes(t) && state.tags[t] !== 'less')
      .map(([t, n]) => ({ item: t, w: Math.sqrt(n) }));
    for (let k = 0; k < 2 && near.length; k++) {
      const t = weightedPick(near);
      offer(subjQ(t), 'explore', 0.9, { tag: t });
    }

    // Take the best, with a cap per type so one channel can't crowd out the rest.
    const caps = { tag: 6, facet: 6, theme: 4, pair: 3, because: 2, author: 2, explore: 2, similar: 3 };
    const used = {};
    const seenQ = new Set();
    return options
      .sort((a, b) => b.pr - a.pr)
      .filter((o) => {
        if (seenQ.has(o.q) || (used[o.type] || 0) >= caps[o.type]) return false;
        seenQ.add(o.q);
        used[o.type] = (used[o.type] || 0) + 1;
        return true;
      })
      .slice(0, budget);
  }

  async function runQueries(plans, onProgress) {
    let done = 0, added = 0;
    // Let the source skip refetching what we already hold or would never show (TMDB needs a
    // details call per film; Open Library ignores these).
    const idx = libraryIndex();
    const have = (key) => state.pool[key] || null;
    const skip = (key) => idx.keys.has(key) || !!state.seen[key] || !!state.events[key];
    await Promise.all(
      plans.map(async (p) => {
        const log = state.queries[p.q] || { runs: 0, offsets: {}, done: {} };
        const limit = D.pageSize(p.type);
        // Alternate "most popular" and "best rated" pages: the first finds what people actually pick up,
        // the second surfaces acclaimed titles that are less famous.
        const sortDone = log.done || {};
        const parity = (log.runs + (p.type === 'pair' || p.type === 'because' ? 1 : 0)) % 2;
        const sort = !sortDone.popular && (parity === 0 || sortDone.rated) ? 'popular' : 'rated';
        const offset = log.offsets?.[sort] || 0;
        try {
          const { docs, numFound, raw = docs.length } = await DQ.source.searchCandidates(p.q, { offset, limit, sort, have, skip });
          for (const d of docs) if (mergeDoc(d, p)) added++;
          const nextDone = { ...sortDone, [sort]: offset + limit >= numFound || !raw };
          state.queries[p.q] = {
            runs: log.runs + 1,
            t: Date.now(),
            offsets: { ...log.offsets, [sort]: offset + limit },
            done: nextDone,
            exhausted: nextDone.popular && nextDone.rated,
          };
        } catch (e) {
          console.warn('Candidate query failed:', p.q, e);
        }
        onProgress?.(++done, plans.length);
      })
    );
    prunePool();
    DQ.store.save('pool', 'queries');
    return added;
  }

  let topUpRunning = null;
  /** Make sure there are enough unseen candidates; runs in the background once a queue exists. */
  function ensurePool(model, { min = 70, onProgress } = {}) {
    if (topUpRunning) return topUpRunning;
    const have = eligibleDocs().length;
    if (have >= min) return Promise.resolve(0);
    const plans = planQueries(model, have < 25 ? 12 : 7);
    if (!plans.length) return Promise.resolve(0);
    document.dispatchEvent(new CustomEvent('dq:busy', { detail: true }));
    topUpRunning = runQueries(plans, onProgress).finally(() => {
      topUpRunning = null;
      document.dispatchEvent(new CustomEvent('dq:busy', { detail: false }));
    });
    return topUpRunning;
  }

  // ---------- queue assembly ----------
  function tagSim(a, b, model) {
    if (!a.tags.length || !b.tags.length) return 0;
    const setB = new Set(b.tags);
    let inter = 0, uni = 0;
    for (const t of a.tags) {
      const w = model.idf(t);
      uni += w;
      if (setB.has(t)) inter += w;
    }
    for (const t of b.tags) if (!a.tags.includes(t)) uni += model.idf(t);
    return uni ? inter / uni : 0;
  }

  // Queue slots per taste facet: ~75% of the queue is shared out (sqrt-flattened, at least one each
  // for the main facets) so every side of the reader shows up; the rest goes to the best overall.
  function facetTargets(model, n) {
    const fs = model.facets.slice(0, 5);
    if (!fs.length) return new Map();
    const ws = fs.map((f) => Math.sqrt(f.weight));
    const tot = ws.reduce((a, b) => a + b, 0);
    return new Map(fs.map((f, i) => [f.id, Math.max(1, Math.floor((0.75 * n * ws[i]) / tot))]));
  }

  // Maximal marginal relevance with facet quotas: each pick goes to the facet furthest below its
  // quota (best non-redundant candidate within it); once quotas are met, the best overall.
  // One book per author; at most two by authors you already read.
  function selectMMR(rows, n, model, context = []) {
    const picked = [];
    const authors = new Set(context.map((r) => r.t.authorId));
    let knownAuthorSlots = 2 - context.filter((r) => r.t.authorAff > 0.15).length;
    // AI picks are finite and cost money to refresh: spread them across queues.
    const isAi = (r) => !!state.ai?.recs?.[r.doc.key];
    let aiSlots = (state.settings.aiPerQueue ?? 4) - context.filter(isAi).length;
    // Twin picks score high by design; a cap keeps them from filling the queue on their own.
    const isTwin = (r) => !!state.twins?.recs?.[r.doc.key];
    let twinSlots = (state.settings.twinsPerQueue ?? 3) - context.filter(isTwin).length;
    const targets = facetTargets(model, n + context.length);
    const facetOf = (r) => (r.f ??= model.facetOf(r.doc));
    const counts = new Map();
    context.forEach((r) => counts.set(facetOf(r), (counts.get(facetOf(r)) || 0) + 1));
    const pool = rows.slice(0, 260);
    const exhausted = new Set();
    // Quotas never force a weak pick: facet candidates must rank in the overall top 3n.
    const floor = rows[Math.min(rows.length - 1, 3 * n)]?.score ?? -Infinity;

    const bestIn = (facet) => {
      let best = -Infinity, bi = -1;
      for (let i = 0; i < pool.length; i++) {
        const r = pool[i];
        if (facet != null && (facetOf(r) !== facet || r.score < floor)) continue;
        if (authors.has(r.t.authorId)) continue;
        if (r.t.authorAff > 0.15 && knownAuthorSlots <= 0) continue;
        if (aiSlots <= 0 && isAi(r)) continue;
        if (twinSlots <= 0 && isTwin(r) && !isAi(r)) continue;
        let maxSim = 0;
        for (const p of context) maxSim = Math.max(maxSim, tagSim(r.doc, p.doc, model));
        for (const p of picked) maxSim = Math.max(maxSim, tagSim(r.doc, p.doc, model));
        const v = r.score - 1.2 * maxSim;
        if (v > best) {
          best = v;
          bi = i;
        }
      }
      return bi;
    };

    while (picked.length < n && pool.length) {
      // Lead with the single strongest match; then serve facet deficits.
      let facet = null;
      if (picked.length || context.length) {
        let deficit = 0;
        for (const [f, target] of targets) {
          const d = target - (counts.get(f) || 0);
          if (d > deficit && !exhausted.has(f)) {
            deficit = d;
            facet = f;
          }
        }
      }
      let bi = bestIn(facet);
      if (bi < 0 && facet != null) {
        exhausted.add(facet);
        continue;
      }
      if (bi < 0) break;
      const [r] = pool.splice(bi, 1);
      picked.push(r);
      authors.add(r.t.authorId);
      counts.set(facetOf(r), (counts.get(facetOf(r)) || 0) + 1);
      if (r.t.authorAff > 0.15) knownAuthorSlots--;
      if (isAi(r)) aiSlots--;
      else if (isTwin(r)) twinSlots--;
    }
    return picked;
  }

  // Exploration picks: plausible, well-regarded books in territory we know little about.
  function selectExplore(scored, n, model, context = []) {
    if (n <= 0) return [];
    const keys = new Set(context.map((r) => r.doc.key));
    const authors = new Set(context.map((r) => r.t.authorId));
    const opts = [];
    for (const r of scored) {
      if (keys.has(r.doc.key) || authors.has(r.t.authorId)) continue;
      if (r.z < -0.9 || r.z > 1.5 || r.t.tag < 0 || r.t.author < 0 || r.doc.wtr < D.explorePop || !r.doc.cover) continue;
      if (r.t.quality < -0.1) continue;
      const { u, tag } = model.uncertainty(r.doc);
      // Books outside every known facet teach us the most.
      const outside = model.facetOf(r.doc) < 0 ? 0.35 : 0;
      opts.push({ r, tag, v: 1.3 * u + outside + r.t.quality + 0.15 * Math.log10(1 + r.doc.wtr) + 0.25 * r.z + Math.random() * 0.3 });
    }
    opts.sort((a, b) => b.v - a.v);
    const out = [];
    const tagsUsed = new Set();
    for (const o of opts) {
      if (out.length >= n) break;
      if (tagsUsed.has(o.tag) || authors.has(o.r.t.authorId)) continue;
      // Exploration should range widely: skip anything close to what's already in the queue.
      if ([...context, ...out].some((p) => tagSim(o.r.doc, p.doc, model) > 0.3)) continue;
      tagsUsed.add(o.tag);
      authors.add(o.r.t.authorId);
      out.push({ ...o.r, kind: 'explore', exploreTag: o.tag });
    }
    return out;
  }

  // Spread exploration picks through the queue; never lead with one.
  function arrange(matches, explores, length) {
    const out = new Array(length).fill(null);
    explores.forEach((e, i) => {
      let p = Math.max(2, Math.round(((i + 1) * length) / (explores.length + 1)));
      while (p < length && out[p]) p++;
      if (p < length) out[p] = e;
    });
    const m = matches.slice();
    for (let i = 0; i < length; i++) if (!out[i]) out[i] = m.shift() || null;
    return out.filter(Boolean);
  }

  // Too few exploration picks qualified: fill the gap with more matches so the queue keeps its length.
  function backfill(scored, matches, explores, size, model, ctx = []) {
    const missing = size - matches.length - explores.length;
    if (missing <= 0) return matches;
    const used = new Set([...matches, ...explores].map((r) => r.doc.key));
    const rest = scored.filter((r) => !used.has(r.doc.key));
    return matches.concat(selectMMR(rest, missing, model, [...ctx, ...matches, ...explores]));
  }

  const exploreCount = (size) => Math.round([0, 3, 5][state.settings.adventure ?? 1] * (size / 12));

  const toItem = (model) => (r) => ({ key: r.doc.key, kind: r.kind || 'match', exploreTag: r.exploreTag || null, pct: model.matchPct(r.score) });

  function buildQueue(model) {
    const size = state.settings.size || 12;
    const scored = model.scoreAll(eligibleDocs());
    const nExplore = Math.min(exploreCount(size), Math.floor(scored.length / 6));
    let matches = selectMMR(scored, size - nExplore, model);
    const explores = selectExplore(scored, nExplore, model, matches);
    matches = backfill(scored, matches, explores, size, model);
    const items = arrange(matches, explores, size).map(toItem(model));
    state.queue = { id: Date.now(), items, idx: 0, decisions: {}, startedAt: Date.now(), snapshot: model.snapshot(), done: false };
    DQ.store.save('queue');
    return state.queue;
  }

  /** After each action, re-pick the not-yet-seen part of the queue with the updated model. */
  function refreshUpcoming(model) {
    const q = state.queue;
    if (!q) return;
    const cut = q.idx + 1;
    const shown = q.items.slice(0, cut);
    const upcoming = q.items.slice(cut);
    if (!upcoming.length) return;
    const shownKeys = new Set(shown.map((i) => i.key));
    const scored = model.scoreAll(eligibleDocs(shownKeys));
    const ctx = shown.map((i) => state.pool[i.key]).filter(Boolean).map((doc) => ({ doc, t: model.terms(doc) }));
    const nExplore = upcoming.filter((i) => i.kind === 'explore').length;
    const matches = selectMMR(scored, upcoming.length - nExplore, model, ctx);
    const byKey = new Map(scored.map((r) => [r.doc.key, r]));
    let explores = upcoming
      .filter((i) => i.kind === 'explore')
      .map((i) => byKey.get(i.key) && { ...byKey.get(i.key), kind: 'explore', exploreTag: i.exploreTag })
      .filter((r) => r && r.t.tag >= 0 && r.score > -1.5 && !matches.some((m) => m.doc.key === r.doc.key));
    if (explores.length < nExplore) explores = explores.concat(selectExplore(scored, nExplore - explores.length, model, [...ctx, ...matches, ...explores]));
    const next = arrange(backfill(scored, matches, explores, upcoming.length, model, ctx), explores, upcoming.length).map(toItem(model));
    if (next.length) q.items = [...shown, ...next];
    DQ.store.save('queue');
  }

  DQ.rec = { planQueries, runQueries, ensurePool, buildQueue, refreshUpcoming, eligibleDocs, libraryIndex, adopt, eligible };
})();
