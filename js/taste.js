/* The taste model.

   Every piece of evidence (a Goodreads row, a quick-rate answer, a queue action) becomes a
   signal with a signed weight. Signals deposit positive/negative "mass" on the tags, authors,
   eras and lengths of the book. Affinity per feature is

       aff = (P - N) / (P + N + K) * ln(1 + P + N)

   i.e. direction scaled by how much evidence we have, so one dismissal of a sci-fi book dents
   "science fiction" without erasing twenty loved ones. Tags are weighted by IDF across the
   library + candidate pool so distinctive themes ("consciousness") matter more than buckets
   ("science fiction").

   The model is shared by books and films: the active domain (DQ.D) says how much each kind of
   evidence counts (a finished book vs. a watched film, a rating, a heart) and supplies the
   scoring constants that differ between Open Library and TMDB. */
(function () {
  const { clamp, normAuthor, sigmoid } = DQ.util;
  const S = DQ.subjects;
  const D = DQ.D;
  const W = D.w;
  const { CALIB_W, EVENT_W } = D;

  /** The average rating, shrunk toward the domain's typical average when only a few are rated. */
  function ratingScale(library) {
    const r = library.map((b) => b.rating).filter(Boolean);
    return { mean: (r.reduce((a, b) => a + b, 0) + D.ratingPrior * 3) / (r.length + 3), n: r.length };
  }

  const K = 0.6;
  const YEAR = 365.25 * 86400000;

  // How a "not for me" is attributed, by the reason the reader gave.
  const PASS_FACTORS = {
    default: { tags: 0.7, author: 0.5, era: 0.3, len: 0.3 },
    genre: { tags: 1.0, author: 0.2, era: 0, len: 0 },
    author: { tags: 0.05, author: 1.0, era: 0, len: 0 },
    length: { tags: 0.1, author: 0, era: 0, len: 1.0 },
    era: { tags: 0.1, author: 0, era: 1.0, len: 0 },
    notnow: { tags: 0.05, author: 0.05, era: 0, len: 0 },
  };
  const FULL = { tags: 1, author: 1, era: 1, len: 1 };

  const uniq = (a) => [...new Set(a)];
  const starText = (r) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');
  const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

  // Recent activity says more about current taste; old evidence fades to ~55%.
  function recency(t, now) {
    if (!t) return 0.7;
    const age = Math.max(0, (now - t) / YEAR);
    return 0.55 + 0.45 * Math.exp(-age / 4);
  }

  /** Authors/directors consumed in bursts (e.g. ≥3 books inside ~4 months) — a strong love signal. */
  function detectBinges(library) {
    const { min, days, date } = D.binge;
    const byAuthor = {};
    for (const b of library) {
      if (b.exclusive !== 'read' || !b.author) continue;
      const t = date(b);
      if (!t) continue;
      (byAuthor[normAuthor(b.author)] ||= []).push({ b, t });
    }
    const out = [];
    for (const list of Object.values(byAuthor)) {
      if (list.length < min) continue;
      list.sort((a, c) => a.t - c.t);
      let best = { n: 0 };
      for (let i = 0; i < list.length; i++) {
        let j = i;
        while (j + 1 < list.length && list[j + 1].t - list[i].t <= days * 86400000) j++;
        if (j - i + 1 > best.n) best = { n: j - i + 1, from: list[i].t, to: list[j].t };
      }
      if (best.n >= min) {
        out.push({
          author: list[0].b.author,
          count: best.n,
          total: list.length,
          days: Math.max(1, Math.round((best.to - best.from) / 86400000)),
          series: uniq(list.map((x) => x.b.series).filter(Boolean)),
        });
      }
    }
    return out.sort((a, b) => b.count - a.count);
  }

  function collectSignals(state) {
    const now = Date.now();
    const signals = [];
    const binges = detectBinges(state.library);
    const bingeAuthors = new Set(binges.map((b) => normAuthor(b.author)));
    const scale = ratingScale(state.library);

    for (const b of state.library) {
      const e = state.enrich[b.gid];
      const doc = e && !e.miss ? e : null;
      let { w, basis } = D.libraryWeight(b, state.calib, scale);
      if (w > 0 && bingeAuthors.has(normAuthor(b.author))) w = Math.min(1, w + 0.2);
      const t = b.exclusive === 'read' ? b.dateRead || b.dateAdded : b.dateAdded;
      signals.push({
        src: 'library', id: b.gid, key: doc?.key || null, title: b.title, cover: doc?.cover || null,
        tags: uniq([...(doc?.tags || []), ...S.shelfTags(b.shelves)]),
        // No creator known (an unmatched film): don't pool its evidence under an empty name.
        authors: b.author ? [normAuthor(b.author)] : [], authorName: b.author,
        year: b.year || doc?.year || null, pages: b.pages || doc?.pages || 0,
        w, m: recency(t, now), basis, shelf: b.exclusive, f: FULL,
      });
    }

    for (const [key, ev] of Object.entries(state.events)) {
      if (!ev.doc) continue;
      const w = ev.action === 'read' ? EVENT_W[ev.rating] : EVENT_W[ev.action];
      if (w == null) continue;
      const f = ev.action === 'pass' ? PASS_FACTORS[ev.reason] || PASS_FACTORS.default : ev.action === 'skip' ? PASS_FACTORS.default : FULL;
      const scale = ev.action === 'pass' && ev.reason === 'notnow' ? 0.1 : 1;
      signals.push({
        src: 'queue', id: key, key, title: ev.doc.title, cover: ev.doc.cover, tags: ev.doc.tags || [],
        authors: (ev.doc.authors || []).slice(0, 1).map(normAuthor), authorName: ev.doc.authors?.[0],
        year: ev.doc.year, pages: ev.doc.pages, w: w * scale, m: 1, basis: ev.action === 'read' ? ev.rating : ev.action,
        shelf: ev.action === 'read' ? 'read' : null, f,
      });
    }
    return { signals, binges, scale };
  }

  // ---- era & length buckets ----
  const eraBucket = (y) => (!y ? null : y < 1800 ? 1700 : y < 1900 ? Math.floor(y / 25) * 25 : Math.floor(y / 10) * 10);
  const eraLabel = (b) => (b === 1700 ? 'Pre-1800' : b < 1900 ? `${b}–${b + 24}` : `${b}s`);
  const LEN_EDGES = D.length.edges; // pages or minutes
  const LEN_LABELS = D.length.labels;
  const lenBucket = (p) => (!p ? null : LEN_EDGES.filter((e) => p >= e).length - 1);

  // Log-ratio of the reader's (smoothed) distribution vs. the candidate pool's base rate.
  function distScorer(userMass, poolCount, ordered) {
    const smooth = new Map();
    ordered.forEach((b, i) => {
      const v = (userMass.get(b) || 0) + 0.4 * ((userMass.get(ordered[i - 1]) || 0) + (userMass.get(ordered[i + 1]) || 0));
      smooth.set(b, Math.max(0, v));
    });
    const uTot = [...smooth.values()].reduce((a, b) => a + b, 0);
    const pTot = [...poolCount.values()].reduce((a, b) => a + b, 0) || 1;
    const n = ordered.length || 1;
    return (b) => {
      if (b == null) return 0;
      const pp = ((poolCount.get(b) || 0) + 1) / (pTot + n);
      const pu = ((smooth.get(b) || 0) + 0.5 * pp) / (uTot + 0.5);
      return clamp(Math.log(pu / pp), -1, 1);
    };
  }

  /** Build the full model from state + candidate pool. Cheap enough to rebuild after every action. */
  function buildModel(state) {
    const pool = state.pool;
    const { signals, binges, scale } = collectSignals(state);

    // Tag document frequency over library + pool (used to decide which tags are real vocabulary).
    const df = new Map();
    let N = 0;
    const addDf = (tags) => {
      if (!tags?.length) return;
      N++;
      for (const t of tags) add(df, t, 1);
    };
    signals.forEach((s) => s.src === 'library' && addDf(s.tags));
    Object.values(pool).forEach((d) => addDf(d.tags));

    // Background rate q(t): how common a tag is among popular books in general. Falls back to the
    // library+pool frequency if the background sample couldn't be fetched.
    const BG = state.background?.n ? state.background : null;
    const q = BG
      ? (t) => ((BG.df[t] || 0) + 0.5) / (BG.n + 1)
      : (t) => ((df.get(t) || 0) + 0.5) / (N + 1);
    const idfCache = new Map();
    const idf = (t) => {
      let v = idfCache.get(t);
      if (v == null) idfCache.set(t, (v = -Math.log(q(t))));
      return v;
    };

    // Seven books from one series carry the same tags: that's one taste, not seven independent votes.
    // Tag evidence per author is damped by 1/sqrt(books); the author channel keeps the full signal.
    const perAuthor = new Map();
    for (const s of signals) if (s.w > 0 && s.authors[0]) add(perAuthor, s.authors[0], 1);

    // Two kinds of tag evidence:
    //  - shelf evidence (library + books marked read from the queue): compared against the background
    //    as a Poisson rate ratio, so "science fiction" only counts for as much as you over-index on it;
    //  - queue feedback (want / pass / skip), which is already on-taste, as a signed evidence score.
    const P = new Map(), NL = new Map(), FP = new Map(), FN = new Map(), AP = new Map(), AN = new Map();
    const eraMass = new Map(), lenMass = new Map();
    let M = 0, Mneg = 0, totalEvidence = 0;
    for (const s of signals) {
      const mass = s.w * s.m;
      if (!mass) continue;
      totalEvidence += Math.abs(mass);
      const pos = mass > 0;
      const shelf = s.src === 'library' || s.shelf === 'read';
      if (shelf) {
        const damp = pos ? 1 / Math.sqrt(perAuthor.get(s.authors[0]) || 1) : 1;
        const m = Math.abs(mass) * damp;
        if (s.tags.length) pos ? (M += m) : (Mneg += m);
        for (const t of s.tags) add(pos ? P : NL, t, m);
      } else {
        for (const t of s.tags) add(pos ? FP : FN, t, Math.abs(mass) * s.f.tags);
      }
      for (const a of s.authors) add(pos ? AP : AN, a, Math.abs(mass) * s.f.author);
      const eb = eraBucket(s.year), lb = lenBucket(s.pages);
      if (eb != null) add(eraMass, eb, mass * (pos ? 1 : s.f.era));
      if (lb != null) add(lenMass, lb, mass * (pos ? 1 : s.f.len));
    }

    const BETA = 1;
    const affOf = (p, n) => ((p - n) / (p + n + K)) * Math.log1p(p + n);
    const shelfW = (t) => {
      const p = P.get(t) || 0;
      // Over-indexing vs. the background, shrunk by a pseudo-count. Never reading a common tag is
      // weaker evidence than reading a rare one, so absence-driven negatives are halved.
      let w = Math.log((p + BETA) / (M * q(t) + BETA));
      if (w < 0) w *= 0.5;
      const n = NL.get(t) || 0;
      if (n) w -= Math.max(0, Math.log((n + BETA) / (Mneg * q(t) + BETA)));
      return w;
    };
    const feedbackW = (t) => 3 * affOf(FP.get(t) || 0, FN.get(t) || 0);

    const tagAff = new Map();
    const affCache = new Map();
    const aff = (t) => {
      let v = affCache.get(t);
      if (v == null) affCache.set(t, (v = shelfW(t) + feedbackW(t)));
      return v;
    };
    for (const t of new Set([...P.keys(), ...NL.keys(), ...FP.keys(), ...FN.keys()])) tagAff.set(t, aff(t));
    const evidence = (t) => (P.get(t) || 0) + (NL.get(t) || 0) + (FP.get(t) || 0) + (FN.get(t) || 0);

    const authorAff = new Map();
    for (const a of new Set([...AP.keys(), ...AN.keys()])) authorAff.set(a, affOf(AP.get(a) || 0, AN.get(a) || 0));

    // Library authors by OL key, so "Лев Толстой" in a candidate still maps to the reader's "Leo Tolstoy".
    const keyToAuthor = new Map();
    const libraryAuthorCount = new Map();
    for (const b of state.library) {
      const e = state.enrich[b.gid];
      const na = normAuthor(b.author);
      if (e && !e.miss && e.authorKeys?.[0]) keyToAuthor.set(e.authorKeys[0], na);
      if (b.exclusive !== 'to-read') add(libraryAuthorCount, na, 1);
    }
    const authorId = (doc) => (doc.authorKeys?.[0] && keyToAuthor.get(doc.authorKeys[0])) || normAuthor(doc.authors?.[0] || '');

    // Series already started: their later entries are fair game.
    const librarySeries = new Set();
    for (const b of state.library) {
      const e = state.enrich[b.gid];
      if (b.exclusive !== 'to-read' && e && !e.miss && e.series) librarySeries.add(e.series);
    }

    // Era / length preference vs. pool base rates.
    const poolEra = new Map(), poolLen = new Map();
    Object.values(pool).forEach((d) => {
      const eb = eraBucket(d.year), lb = lenBucket(d.pages);
      if (eb != null) add(poolEra, eb, 1);
      if (lb != null) add(poolLen, lb, 1);
    });
    const eraOrder = [...new Set([...poolEra.keys(), ...eraMass.keys()])].sort((a, b) => a - b);
    const eraScore = distScorer(eraMass, poolEra, eraOrder);
    const lenScore = distScorer(lenMass, poolLen, [0, 1, 2, 3, 4]);

    const tagPrefs = state.tags;
    const settings = state.settings;
    const popW = [-0.1, 0.12, 0.3][clamp((settings.popularity | 0) + 1, 0, 2)];

    // "Japan", "Japanese fiction", "Asian fiction" and "In translation" all say the same thing; tags
    // about where a book comes from count once (plus a little for the rest).
    const originCache = new Map();
    const isOrigin = (t) => {
      let v = originCache.get(t);
      if (v == null) originCache.set(t, (v = S.kind(t) === 'tradition' || S.isPlace(t)));
      return v;
    };
    const DECAY = [1, 0.75, 0.55, 0.4, 0.3, 0.25];

    // A book is as good as its best few matching themes (with diminishing returns), minus its worst few
    // mismatches. Capping both sides keeps sparse records from looking perfect and 100-subject classics
    // from piling up noise.
    function subjSim(doc) {
      let origin = [];
      const pos = [];
      const neg = [];
      for (const t of doc.tags) {
        const w = aff(t);
        if (w > 0) (isOrigin(t) ? origin : pos).push(w);
        else if (w < 0) neg.push(w);
      }
      if (origin.length) {
        origin.sort((a, b) => b - a);
        pos.push(origin[0] + 0.25 * origin.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, origin.length - 1));
      }
      pos.sort((a, b) => b - a);
      neg.sort((a, b) => a - b);
      let s = 0;
      for (let i = 0; i < Math.min(pos.length, DECAY.length); i++) s += pos[i] * DECAY[i];
      for (let i = 0; i < Math.min(neg.length, 3); i++) s += neg[i];
      return s;
    }

    const Q = D.quality;
    const bayes = (doc) => (doc.rating * doc.ratingCount + Q.prior * Q.m) / (doc.ratingCount + Q.m);

    /** Raw feature terms for a doc (subject similarity is z-scored later, across the eligible set). */
    function terms(doc) {
      const aId = authorId(doc);
      const aAff = authorAff.get(aId) || 0;
      let tagTerm = 0;
      let moreHits = 0;
      for (const t of doc.tags) {
        const p = tagPrefs[t];
        if (p === 'more' && moreHits < 2) {
          tagTerm += 0.8;
          moreHits++;
        } else if (p === 'less') tagTerm -= 1.0;
      }
      if (!BG && doc.tags.includes('juvenile') && aff('juvenile') <= 0.15) tagTerm -= 1.2;
      // Mid-series entry points are poor recommendations unless you already read the author.
      // (A film series you've already started is fine: that's what the collection check is for.)
      if (aAff <= 0.15 && !librarySeries.has(doc.series) && (doc.seriesNum >= 2 || D.sequelRe?.test(doc.title))) tagTerm -= 1.0;
      // A model's pick carries evidence the tags can't (tone, style); stretch picks get less of a push.
      const aiRec = state.ai?.recs?.[doc.key];
      tagTerm += aiRec ? (aiRec.stretch ? 0.6 : 1.0) : 0;
      // Loved by your taste twins (Flicks): up to +1.3, more when several agree (js/twins.js).
      tagTerm += state.twins?.recs?.[doc.key]?.boost || 0;
      return {
        sim: subjSim(doc),
        author: aAff >= 0 ? 1.1 * Math.tanh(aAff) : 1.6 * Math.tanh(aAff),
        era: 0.35 * eraScore(eraBucket(doc.year)),
        len: 0.2 * lenScore(lenBucket(doc.pages)),
        quality: 0.3 * clamp((bayes(doc) - Q.prior) / Q.spread, -1.5, 1.5),
        pop: popW * clamp(Math.log10(1 + doc.wtr) - D.popCenter, -1.5, 2),
        tag: tagTerm,
        authorAff: aAff,
        authorId: aId,
      };
    }

    /** Score a list of docs; returns [{doc, score, z, t}] sorted desc. */
    function scoreAll(docs) {
      const rows = docs.map((doc) => ({ doc, t: terms(doc) }));
      const sims = rows.map((r) => r.t.sim);
      const mean = sims.reduce((a, b) => a + b, 0) / (sims.length || 1);
      const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / (sims.length || 1)) || 1;
      for (const r of rows) {
        r.z = clamp((r.t.sim - mean) / sd, -2.5, 3);
        r.score = r.z + r.t.author + r.t.era + r.t.len + r.t.quality + r.t.pop + r.t.tag;
      }
      return rows.sort((a, b) => b.score - a.score);
    }

    const matchPct = (score) => clamp(Math.round(100 * sigmoid(0.95 * score + 0.2)), 35, 99);

    // Liked books, for "because you read X".
    const liked = signals.filter((s) => s.w >= 0.45 && s.tags.length && (s.src === 'library' ? s.shelf !== 'to-read' : s.shelf === 'read'));
    const likedNorms = liked.map((s) => Math.sqrt(s.tags.reduce((a, t) => a + idf(t) ** 2, 0)));

    function similarTo(doc, n = 2) {
      const docNorm = Math.sqrt(doc.tags.reduce((a, t) => a + idf(t) ** 2, 0)) || 1;
      const docSet = new Set(doc.tags);
      const out = [];
      liked.forEach((s, i) => {
        if (s.key === doc.key) return;
        let dot = 0;
        for (const t of s.tags) if (docSet.has(t)) dot += idf(t) ** 2;
        if (dot) out.push({ s, sim: (dot / (docNorm * likedNorms[i])) * (0.6 + 0.4 * s.w) });
      });
      return out.sort((a, b) => b.sim - a.sim).slice(0, n);
    }

    /** Human-readable reasons for a candidate. */
    function explain(doc, kind = 'match', exploreTag = null) {
      const t = terms(doc);
      const matched = doc.tags
        .map((tag) => ({ tag, c: aff(tag) + (tagPrefs[tag] === 'more' ? 1 : 0) }))
        .filter((x) => x.c > 0.12 && !S.isSensitive(x.tag))
        .sort((a, b) => b.c - a.c)
        .slice(0, 4)
        .map((x) => x.tag);
      const warned = doc.tags
        .map((tag) =>
          tagPrefs[tag] === 'less' ? { tag, why: 'less' }
          : feedbackW(tag) < -0.25 && aff(tag) < 0 ? { tag, why: 'passed' } // passes outweigh what your shelf says
          : aff(tag) < -0.45 ? { tag, why: 'rare' }
          : null
        )
        .filter(Boolean)
        .slice(0, 2);
      const similar = similarTo(doc).filter((x) => x.sim > 0.12);
      const nByAuthor = libraryAuthorCount.get(t.authorId) || 0;
      // Found through the source's "people who liked X also liked" list for one of your favourites.
      const alsoLiked = state.pool[doc.key]?.src?.find((s) => s.type === 'similar')?.ref || null;
      let primary;
      const ai = state.ai?.recs?.[doc.key] || null;
      const twin = state.twins?.recs?.[doc.key] || null;
      if (ai) {
        primary = { icon: 'spark', text: `AI pick${ai.facet ? ' · ' + ai.facet : ''}${ai.stretch ? ' · a stretch' : ''}`, ai: true };
      } else if (twin && kind !== 'explore') {
        const t = twin.by[0];
        primary = {
          icon: 'user',
          twin: true,
          text: twin.by.length > 1 ? `Loved by ${twin.by.length} of your taste twins` : `Your taste twin ${t.name} ${t.r ? `rated this ${starText(t.r)}` : 'hearted this'}`,
        };
      } else if (kind === 'explore') {
        primary = { icon: 'compass', text: `Exploring ${S.display(exploreTag || matched[0] || 'something new')} — a step outside your usual` };
      } else if (nByAuthor > 0 && t.authorAff > 0.15) {
        primary = { icon: 'user', text: `Because you've ${W.done} ${nByAuthor === 1 ? 'a ' + W.item : nByAuthor + ' ' + W.items} by ${doc.authors[0]}` };
      } else if (alsoLiked) {
        primary = { icon: D.icon, text: `People who liked ${alsoLiked} also liked this` };
      } else if (similar[0] && similar[0].sim > 0.2) {
        const two = similar[1] && similar[1].sim > 0.2 ? ` and ${similar[1].s.title}` : '';
        primary = { icon: D.icon, text: `Because you ${W.did} ${similar[0].s.title}${two}` };
      } else if (matched.length) {
        primary = { icon: 'spark', text: `Matches your taste for ${S.display(matched[0])}` };
      } else {
        primary = { icon: 'spark', text: `Well-loved by ${W.audience}s with overlapping taste` };
      }
      const badges = [];
      if (doc.wtr >= D.hugePop) badges.push('Hugely popular');
      else if (D.isGem(doc, bayes(doc))) badges.push('Hidden gem');
      if (doc.year && doc.year < D.classicYear) badges.push('Classic');
      if (doc.year && doc.year >= new Date().getFullYear() - 2) badges.push('New');
      return { primary, matched, warned, similar, badges, authorAff: t.authorAff, ai, twin };
    }

    /** How much feedback on this book would teach us (tags we know little about). */
    function uncertainty(doc) {
      const top = doc.tags.map((t) => ({ t, i: idf(t) })).sort((a, b) => b.i - a.i).slice(0, 6);
      if (!top.length) return { u: 0, tag: null };
      const u = top.reduce((a, x) => a + 1 / (1 + 3 * evidence(x.t)), 0) / top.length;
      const tag = top
        .filter((x) => evidence(x.t) < 0.15 && (df.get(x.t) || 0) >= 2 && S.queryForm(x.t))
        // Label with the most general unknown theme ("Cyberpunk" beats "Information superhighway").
        .sort((a, b) => (S.labelRank?.(b.t) ?? 0) - (S.labelRank?.(a.t) ?? 0) || q(b.t) - q(a.t) || (df.get(b.t) || 0) - (df.get(a.t) || 0))[0]?.t;
      const fallback = doc.tags.slice().sort((a, b) => evidence(a) - evidence(b))[0];
      return { u, tag: tag || fallback };
    }

    // ---- facets: the distinct "reading moods" inside a library ----
    // Average-linkage clustering of liked/wanted books on IDF-weighted tag cosine plus a same-author link.
    const facetVec = (tags) => {
      const v = new Map();
      let nn = 0;
      for (const t of tags) {
        if ((df.get(t) || 0) < 2) continue;
        const w = idf(t);
        v.set(t, w);
        nn += w * w;
      }
      return { v, n: Math.sqrt(nn) };
    };
    const cosine = (a, b) => {
      if (!a.n || !b.n) return 0;
      let dot = 0;
      const [small, big] = a.v.size < b.v.size ? [a, b] : [b, a];
      for (const [t, w] of small.v) {
        const w2 = big.v.get(t);
        if (w2) dot += w * w2;
      }
      return dot / (a.n * b.n);
    };

    function computeFacets() {
      const items = signals.filter((s) => s.w >= 0.3 && (s.src === 'library' || s.w >= 0.5));
      const n = items.length;
      if (n < 3) return [];
      const vecs = items.map((s) => facetVec(s.tags));
      const sim = items.map(() => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const same = items[i].authors[0] && items[i].authors[0] === items[j].authors[0];
          sim[i][j] = sim[j][i] = 0.75 * cosine(vecs[i], vecs[j]) + (same ? 0.5 : 0);
        }
      }
      const alive = new Set(items.map((_, i) => i));
      const members = items.map((_, i) => [i]);
      for (;;) {
        let best = 0.2, bi = -1, bj = -1;
        const ids = [...alive];
        for (let x = 0; x < ids.length; x++) {
          for (let y = x + 1; y < ids.length; y++) {
            if (sim[ids[x]][ids[y]] > best) {
              best = sim[ids[x]][ids[y]];
              bi = ids[x];
              bj = ids[y];
            }
          }
        }
        if (bi < 0) break;
        const si = members[bi].length, sj = members[bj].length;
        for (const k of alive) {
          if (k === bi || k === bj) continue;
          sim[bi][k] = sim[k][bi] = (si * sim[bi][k] + sj * sim[bj][k]) / (si + sj);
        }
        members[bi] = members[bi].concat(members[bj]);
        alive.delete(bj);
      }

      return [...alive]
        .map((id) => members[id].map((i) => items[i]))
        .filter((ss) => ss.length >= 2)
        .map((ss) => {
          const tagMass = new Map(), tagCount = new Map(), authorCount = new Map(), centroid = new Map();
          for (const s of ss) {
            const v = facetVec(s.tags);
            for (const [t, w] of v.v) {
              add(tagMass, t, w * s.w);
              add(tagCount, t, 1);
              if (v.n) add(centroid, t, (w / v.n) * s.w);
            }
            if (s.authorName) add(authorCount, s.authorName, 1);
          }
          const minCount = Math.min(2, ss.length);
          const tags = [...tagMass]
            .filter(([t]) => tagCount.get(t) >= minCount && aff(t) > 0 && !S.isSensitive(t) && !S.isTrivia?.(t))
            .sort((a, b) => b[1] - a[1])
            .map(([t]) => t)
            .slice(0, 5);
          const cn = Math.sqrt([...centroid.values()].reduce((a, w) => a + w * w, 0));
          return {
            books: ss.map((s) => ({ title: s.title, cover: s.cover, author: s.authorName, key: s.key })),
            weight: ss.reduce((a, s) => a + s.w * s.m, 0),
            tags,
            authors: [...authorCount].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 4),
            centroid: { v: centroid, n: cn },
          };
        })
        .filter((f) => f.tags.length || f.authors.length > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 6)
        .map((f, i) => ({ ...f, id: i }));
    }
    const facets = computeFacets();

    /** Which facet a candidate belongs to (or -1). */
    function facetOf(doc) {
      const v = facetVec(doc.tags);
      let best = 0.12, bi = -1;
      facets.forEach((f) => {
        const c = cosine(v, f.centroid);
        if (c > best) {
          best = c;
          bi = f.id;
        }
      });
      return bi;
    }

    // ---- profile views ----
    // How many of the reader's positive books carry a tag (for display).
    const shelfPositive = signals.filter((s) => s.w > 0 && (s.src === 'library' || s.shelf === 'read' || s.basis === 'want'));
    const bookCount = (t) => shelfPositive.filter((s) => s.tags.includes(t)).length;

    // Well-evidenced positive themes first: one to-read book with an obscure tag shouldn't top the list.
    function topTags(n = 20) {
      return [...tagAff]
        .filter(([t, a]) => a > 0.05 && (df.get(t) || 0) >= 2 && !S.isSensitive(t) && !S.isTrivia?.(t))
        .map(([tag, a]) => {
          const ev = evidence(tag);
          return { tag, a, rank: a * (ev / (ev + 0.5)), ev, kind: S.kind(tag), books: bookCount(tag) };
        })
        .sort((x, y) => y.rank - x.rank)
        .slice(0, n);
    }
    // Themes you've actively turned down (passes, low ratings, "less of this").
    function avoidTags(n = 10) {
      return [...tagAff]
        .filter(([t, a]) => a < -0.1 && ((FN.get(t) || 0) > 0 || (NL.get(t) || 0) > 0) && !S.isSensitive(t))
        .map(([tag, a]) => ({ tag, a, ev: evidence(tag), kind: S.kind(tag), passed: signals.filter((s) => s.w < 0 && s.tags.includes(tag)).length }))
        .sort((x, y) => x.a - y.a)
        .slice(0, n);
    }
    // Common elsewhere, rare on your shelves.
    function rareTags(n = 8) {
      if (!BG) return [];
      return Object.keys(BG.df)
        .filter((t) => q(t) >= 0.05 && !(FN.get(t) > 0) && !S.isSensitive(t))
        .map((tag) => ({ tag, a: aff(tag), kind: S.kind(tag) }))
        .filter((x) => x.a < -0.35)
        .sort((x, y) => x.a - y.a)
        .slice(0, n);
    }
    function topAuthors(n = 10) {
      const names = new Map();
      for (const s of signals) if (s.authors[0] && s.authorName) names.set(s.authors[0], s.authorName);
      return [...authorAff]
        .filter(([, a]) => a > 0.05)
        .map(([id, a]) => ({ id, name: names.get(id) || id, a, count: libraryAuthorCount.get(id) || 0 }))
        .sort((x, y) => y.a - x.a)
        .slice(0, n);
    }
    // Book counts per era / length bucket, over books you read or want (not passes).
    function eraDist() {
      const counts = new Map();
      shelfPositive.forEach((s) => {
        const b = eraBucket(s.year);
        if (b != null) add(counts, b, 1);
      });
      if (!counts.size) return [];
      const keys = [...counts.keys()];
      const lo = Math.min(...keys), hi = Math.max(...keys);
      const out = [];
      for (let b = lo; b <= hi; b = b < 1800 ? 1800 : b < 1900 ? b + 25 : b + 10) out.push({ bucket: b, label: eraLabel(b), v: counts.get(b) || 0 });
      return out;
    }
    function lenDist() {
      const counts = new Map();
      shelfPositive.forEach((s) => {
        const b = lenBucket(s.pages);
        if (b != null) add(counts, b, 1);
      });
      return LEN_LABELS.map((label, i) => ({ label, v: counts.get(i) || 0 }));
    }
    // Stored with each queue (film vocabularies run to thousands of tags), so keep the numbers short.
    const snapshot = () => Object.fromEntries([...tagAff].filter(([, a]) => Math.abs(a) > 0.01).map(([t, a]) => [t, Math.round(a * 1000) / 1000]));

    const confidence = totalEvidence < 6 ? 'Low' : totalEvidence < 16 ? 'Medium' : 'High';

    return {
      signals, binges, scale, facets, facetOf, idf, aff, evidence, df, authorAff, authorId,
      terms, scoreAll, matchPct, explain, similarTo, uncertainty,
      topTags, avoidTags, rareTags, topAuthors, eraDist, lenDist, snapshot,
      totalEvidence, confidence, eraBucket, eraLabel,
    };
  }

  DQ.taste = { buildModel, detectBinges };
})();
