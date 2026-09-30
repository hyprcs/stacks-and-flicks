/* TMDB client for films: library matching, candidate searches, "viewers also liked", descriptions.
   Same interface as the Open Library client, so the shared recommender and views can use either.

   TMDB needs a free API key (themoviedb.org → Settings → API). A v3 key travels in the query
   string, which spares a CORS preflight per request; a v4 read access token works too, as a Bearer
   header. Requests are paced under TMDB's ~40/s guidance. */
(function () {
  const { pLimit, sleep, stripDiacritics, normAuthor } = DQ.util;
  const T = DQ.filmTags;

  const BASE = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/';
  const IMG_SIZE = { S: 'w92', M: 'w185', L: 'w500' };
  const PAGE = 20; // TMDB's fixed page size
  const MIN_VOTES = 25; // below this a candidate is too obscure to be worth a details request
  const GAP_MS = 25; // spacing between request starts (~40/s)

  const limit = pLimit(12); // enough in flight to reach the pacing cap despite slow details calls
  let nextSlot = 0;

  class TmdbError extends Error {
    constructor(msg, kind) {
      super(msg);
      this.kind = kind;
    }
  }

  const key = () => DQ.state.tmdb?.key || '';
  const isToken = (k) => /^eyJ/.test(k);

  async function get(path, params = {}, { timeout = 15000, retries = 2, k = key() } = {}) {
    if (!k) throw new TmdbError('Add your TMDB API key first.', 'nokey');
    const qs = new URLSearchParams(params);
    if (!isToken(k)) qs.set('api_key', k);
    const headers = isToken(k) ? { authorization: `Bearer ${k}` } : undefined;
    const url = `${BASE}${path}?${qs}`;
    return limit(async () => {
      for (let attempt = 0; ; attempt++) {
        const now = Date.now();
        const wait = Math.max(0, nextSlot - now);
        nextSlot = Math.max(now, nextSlot) + GAP_MS;
        if (wait) await sleep(wait);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        let retryable = true;
        try {
          const res = await fetch(url, { headers, signal: ctrl.signal });
          if (res.ok) return await res.json();
          if (res.status === 404) return null;
          if (res.status === 401) {
            retryable = false;
            throw new TmdbError('TMDB rejected the API key. Check it on themoviedb.org → Settings → API.', 'auth');
          }
          retryable = res.status === 429 || res.status >= 500;
          if (res.status === 429) nextSlot = Date.now() + 1500; // back everyone off, not just this request
          throw new TmdbError(`TMDB returned ${res.status}`, 'http');
        } catch (e) {
          if (!retryable || attempt >= retries) {
            if (e.name === 'AbortError' || e instanceof TypeError) throw new TmdbError("Couldn't reach TMDB. Check your connection.", 'network');
            throw e;
          }
        } finally {
          clearTimeout(timer);
        }
        await sleep(700 * 2 ** attempt + Math.random() * 400);
      }
    });
  }

  /** Check a key before saving it. Resolves true, or throws a TmdbError with a readable message. */
  async function testKey(k) {
    await get('/configuration', {}, { k: k.trim(), retries: 0 });
    return true;
  }

  // ---------- docs ----------
  const yearOf = (m) => parseInt(String(m.release_date || '').slice(0, 4), 10) || null;
  const genresOf = (m) => m.genres || (m.genre_ids || []).map((id) => ({ id }));
  const kwIds = new Map(); // canonical tag -> TMDB keyword id, learned from every movie we see
  const overviews = new Map(); // key -> overview, so the card on screen doesn't refetch it

  // Sequel numbering: "<title> Part II", "<title>: Vol. 2", "<title>: Chapter 3", "<title> 2", "<title> IV".
  // Not "Episode IV": one famous saga numbers its first film 4.
  const SEQUEL_RE = /\b(?:part|chapter|vol\.?|volume)\s*([2-9]|1\d|ii|iii|iv|vi{0,3}|ix)\b|\s([2-9]|ii|iii|iv)(?=:|$)/i;
  const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  function sequelNum(title) {
    const m = String(title || '').match(SEQUEL_RE);
    if (!m) return null;
    const v = (m[1] || m[2]).toLowerCase();
    return ROMAN[v] || parseInt(v, 10) || null;
  }

  // TV results name things differently; Letterboxd lists some miniseries and specials.
  const asMovie = (m) => ({ ...m, title: m.title ?? m.name, original_title: m.original_title ?? m.original_name, release_date: m.release_date ?? m.first_air_date });

  function base(m, prefix = 'm') {
    const doc = {
      key: prefix + m.id,
      title: m.title || m.original_title || '',
      series: null,
      seriesNum: sequelNum(m.title),
      authors: [],
      authorKeys: [],
      year: yearOf(m),
      tags: [],
      cover: m.poster_path || null,
      rating: m.vote_average ? Math.round(m.vote_average * 50) / 100 : 0, // TMDB's 0–10 on a 5-star scale
      ratingCount: m.vote_count || 0,
      wtr: m.vote_count || 0, // the popularity measure the shared model reads
      pages: 0, // runtime in minutes
    };
    if (m.overview) overviews.set(doc.key, m.overview);
    return doc;
  }

  /** Full details response (with keywords + credits) -> the compact doc the app stores. */
  function compact(m) {
    const doc = base(m);
    const keywords = m.keywords?.keywords || m.keywords?.results || [];
    for (const k of keywords) {
      const t = T.canonical(k.name);
      if (t && !kwIds.has(t)) kwIds.set(t, k.id);
    }
    const directors = (m.credits?.crew || []).filter((c) => c.job === 'Director');
    doc.authors = directors.slice(0, 2).map((d) => d.name);
    doc.authorKeys = directors.slice(0, 2).map((d) => String(d.id));
    doc.tags = T.fromTmdb({ genres: genresOf(m), keywords, lang: m.original_language });
    // A director's own name as a keyword isn't a theme.
    const names = doc.authors.map(normAuthor);
    doc.tags = doc.tags.filter((t) => !names.includes(normAuthor(t)));
    doc.series = m.belongs_to_collection?.name?.toLowerCase().replace(/\s+collection$/, '') || null;
    doc.pages = m.runtime || 0;
    return doc;
  }

  /** A search/list result without a details call: genres, language and poster only. */
  function compactLite(m, prefix = 'm') {
    const doc = base(asMovie(m), prefix);
    doc.tags = T.fromTmdb({ genres: genresOf(m), lang: m.original_language });
    doc.lite = true;
    return doc;
  }

  const detailCache = new Map();
  function details(id) {
    if (!detailCache.has(id)) {
      const p = get(`/movie/${id}`, { append_to_response: 'keywords,credits' }).then((m) => (m ? compact(m) : null));
      p.catch(() => detailCache.delete(id));
      detailCache.set(id, p);
    }
    return detailCache.get(id);
  }

  // Library only: candidates are always films. Creators stand in for the director.
  async function tvDetails(id) {
    const m = await get(`/tv/${id}`, { append_to_response: 'keywords' });
    if (!m) return null;
    const doc = base(asMovie(m), 't');
    const creators = (m.created_by || []).slice(0, 2);
    doc.authors = creators.map((c) => c.name);
    doc.authorKeys = creators.map((c) => String(c.id));
    doc.tags = T.fromTmdb({ genres: genresOf(m), keywords: m.keywords?.results || [], lang: m.original_language });
    doc.pages = m.episode_run_time?.[0] || 0;
    return doc;
  }

  // ---------- matching ----------
  const normFilm = (t) => stripDiacritics(t).toLowerCase().replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * Films whose title matches, best first. Only exact titles (after normalising punctuation and
   * accents) count: TMDB's top hit for a year is often a different film entirely. Festival and
   * release years differ, so the searches widen: primary release year, any release that year,
   * then any year within one.
   */
  async function candidatesFor(title, year) {
    const nt = normFilm(title);
    const names = (r) => [r.title, r.original_title].filter(Boolean).map(normFilm);
    // A first instalment can be filed with a "Part One" suffix the export's title doesn't have.
    const same = (x) => x === nt || x.replace(/ part (one|1|i)$/, '') === nt;
    const near = (r) => !year || Math.abs((yearOf(r) || 0) - year) <= 1;
    // Last resort, for well-known films TMDB lists under a different English title: the year's top hit,
    // if popular and sharing a real word.
    const words = new Set(nt.split(' ').filter((w) => w.length > 3));
    const plausible = (r) => r && (r.vote_count || 0) >= 500 && names(r).some((x) => x.split(' ').some((w) => words.has(w)));
    let loose = null;
    const tries = year ? [{ primary_release_year: year }, { year }, {}] : [{}];
    for (const extra of tries) {
      const res = (await get('/search/movie', { query: title, include_adult: 'false', ...extra }))?.results || [];
      const hits = res.filter((r) => names(r).some(same) && near(r));
      if (hits.length) return { hits, loose: null };
      if (!loose && extra.primary_release_year && plausible(res[0])) loose = res[0];
    }
    return { hits: [], loose };
  }

  async function tvMatch(title, year) {
    const nt = normFilm(title);
    const near = (r) => !year || Math.abs((yearOf(asMovie(r)) || 0) - year) <= 1;
    for (const extra of year ? [{ first_air_date_year: year }, {}] : [{}]) {
      const res = (await get('/search/tv', { query: title, include_adult: 'false', ...extra }))?.results || [];
      const hit = res.find((r) => near(r) && [r.name, r.original_name].some((x) => x && normFilm(x) === nt));
      if (hit) return hit;
    }
    return null;
  }

  /** A diary entry's TMDB record: a film, or a series when that's the better-known match. */
  async function matchEntry(title, year) {
    const { hits: [film], loose } = await candidatesFor(title, year);
    // An obscure film that shares its title with a series is usually the wrong match.
    if (film && (film.vote_count || 0) >= 50) return { film };
    const tv = await tvMatch(title, year);
    if (tv && (!film || (tv.vote_count || 0) > (film.vote_count || 0))) return { tv };
    return film || loose ? { film: film || loose } : {};
  }

  /** Match every library film on TMDB. Watched films get full details; watchlist films a lighter record. */
  async function lookupLibrary(films, onProgress) {
    const results = {};
    const perFilm = pLimit(12);
    let done = 0;
    let fatal = null; // a rejected key fails every request: stop instead of trying the rest
    await Promise.all(
      films.map((b) =>
        perFilm(async () => {
          if (fatal) throw fatal;
          let doc = null;
          try {
            const { film, tv } = await matchEntry(b.title, b.year);
            const full = b.exclusive === 'read';
            if (film) doc = full ? await details(film.id) : compactLite(film);
            else if (tv) doc = full ? await tvDetails(tv.id) : compactLite(tv, 't');
          } catch (e) {
            if (e.kind === 'auth' || e.kind === 'nokey') throw (fatal = e);
            console.warn('TMDB lookup failed for', b.title, e);
          }
          results[b.gid] = doc ? { ...doc, keys: [doc.key] } : { miss: true };
          onProgress?.(++done, films.length, b.gid, doc);
        })
      )
    );
    return results;
  }

  /** Tag frequencies across the ~300 most-voted films: the "typical viewer" baseline. */
  async function background() {
    const pages = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        get('/discover/movie', { sort_by: 'vote_count.desc', include_adult: 'false', page: i + 1 })
          .then((d) => d?.results || [])
          .catch(() => [])
      )
    );
    const movies = pages.flat();
    const df = {};
    await Promise.all(
      movies.map(async (m) => {
        let keywords = [];
        try {
          keywords = (await get(`/movie/${m.id}/keywords`))?.keywords || [];
        } catch {}
        for (const t of T.fromTmdb({ genres: genresOf(m), keywords, lang: m.original_language })) df[t] = (df[t] || 0) + 1;
      })
    );
    for (const t of Object.keys(df)) if (df[t] < 2) delete df[t];
    return movies.length >= 100 ? { n: movies.length, df, t: Date.now() } : null;
  }

  // ---------- candidate searches ----------
  const kwLookups = new Map();
  function keywordId(tag) {
    if (kwIds.has(tag)) return Promise.resolve(kwIds.get(tag));
    if (!kwLookups.has(tag)) {
      kwLookups.set(
        tag,
        get('/search/keyword', { query: tag })
          .then((d) => {
            const res = d?.results || [];
            const hit = res.find((k) => T.canonical(k.name) === tag) || res.find((k) => k.name.toLowerCase() === tag);
            if (hit) kwIds.set(tag, hit.id);
            return hit?.id || null;
          })
          .catch(() => null)
      );
    }
    return kwLookups.get(tag);
  }

  // Query mini-language (built by DQ.filmTags.queryForm and the film domain):
  //   "g:878 AND k:time travel"  -> discover, with_genres / with_keywords / with_original_language
  //   "person:137427"            -> films directed by that person
  //   "similar:603"              -> TMDB's "viewers who liked this also liked"
  async function discoverParams(q) {
    const p = {};
    const kw = [], genres = [];
    for (const clause of q.split(' AND ')) {
      const i = clause.indexOf(':');
      const type = clause.slice(0, i), val = clause.slice(i + 1);
      if (type === 'g') genres.push(val);
      else if (type === 'l') p.with_original_language = val;
      else if (type === 'k') {
        const id = await keywordId(val);
        if (!id) return null;
        kw.push(id);
      } else return null;
    }
    if (kw.length) p.with_keywords = kw.join(',');
    if (genres.length) p.with_genres = genres.join(',');
    return p;
  }

  const byVotes = (a, b) => (b.vote_count || 0) - (a.vote_count || 0);
  const byRating = (a, b) => (b.vote_average || 0) * Math.min(1, (b.vote_count || 0) / 300) - (a.vote_average || 0) * Math.min(1, (a.vote_count || 0) / 300);

  /**
   * One page of candidates. sort: 'popular' (most voted) or 'rated' (best rated with enough votes).
   * have(key) returns an already-known doc (no refetch); skip(key) drops ones we'd never show.
   */
  async function searchCandidates(q, { offset = 0, limit: n = PAGE, sort = 'popular', have, skip } = {}) {
    let results = [];
    let numFound = 0;
    const page = Math.floor(offset / PAGE) + 1;
    if (q.startsWith('person:')) {
      const data = await get(`/person/${q.slice(7)}/movie_credits`);
      const seen = new Set();
      const list = (data?.crew || []).filter((c) => c.job === 'Director' && !seen.has(c.id) && seen.add(c.id));
      list.sort(sort === 'rated' ? byRating : byVotes);
      numFound = list.length;
      results = list.slice(offset, offset + n);
    } else if (q.startsWith('similar:')) {
      const data = await get(`/movie/${q.slice(8)}/recommendations`, { page });
      results = data?.results || [];
      numFound = Math.min(data?.total_results || 0, 3 * PAGE); // past a few pages they drift off-topic
    } else {
      const params = await discoverParams(q);
      if (!params) return { docs: [], numFound: 0 };
      const data = await get('/discover/movie', {
        ...params,
        ...(sort === 'rated' ? { sort_by: 'vote_average.desc', 'vote_count.gte': 250 } : { sort_by: 'vote_count.desc', 'vote_count.gte': 40 }),
        include_adult: 'false',
        include_video: 'false',
        page,
      });
      results = data?.results || [];
      numFound = Math.min(data?.total_results || 0, 500 * PAGE);
    }
    const docs = await Promise.all(
      results
        .filter((r) => r.id && !r.adult && (r.vote_count || 0) >= MIN_VOTES)
        .map(async (r) => {
          const k = 'm' + r.id;
          if (skip?.(k)) return null;
          const known = have?.(k);
          if (known) return known;
          try {
            return await details(r.id);
          } catch {
            return null;
          }
        })
    );
    return { docs: docs.filter((d) => d && d.title), numFound, raw: results.length };
  }

  /** Find a film by title (+ year, + director) for an AI suggestion, or null if it doesn't exist. */
  async function findWork(title, director, year) {
    const { hits, loose } = await candidatesFor(title, year);
    const byDirector = (doc) => !director || doc.authors.some((a) => normAuthor(a).split(' ').pop() === normAuthor(director).split(' ').pop());
    let first = null;
    for (const h of hits.slice(0, 3)) {
      const doc = await details(h.id);
      if (!doc) continue;
      first ||= doc;
      if (byDirector(doc)) return doc;
    }
    if (first) return first;
    // A differently titled film is only trusted when the director confirms it.
    if (loose && director) {
      const doc = await details(loose.id);
      if (doc && byDirector(doc)) return doc;
    }
    return null;
  }

  // ---------- descriptions & presentation ----------
  const inflight = new Map();
  function description(doc) {
    if (overviews.has(doc.key)) return Promise.resolve(overviews.get(doc.key));
    const cached = DQ.state.works[doc.key];
    if (cached) return Promise.resolve(cached.desc);
    if (inflight.has(doc.key)) return inflight.get(doc.key);
    const p = (async () => {
      let desc = '';
      try {
        desc = (await get(`/movie/${doc.key.slice(1)}`, {}, { retries: 1 }))?.overview || '';
      } catch {}
      DQ.state.works[doc.key] = { desc, t: Date.now() };
      DQ.store.save('works');
      DQ.store.pruneWorks();
      return desc;
    })().finally(() => inflight.delete(doc.key));
    inflight.set(doc.key, p);
    return p;
  }

  const coverUrl = (path, size = 'L') => (path ? `${IMG}${IMG_SIZE[size] || IMG_SIZE.L}${path}` : null);

  DQ.tmdb = { testKey, lookupLibrary, background, searchCandidates, findWork, description, coverUrl, sequelNum, TmdbError, needsKey: true, byId: details };
})();
