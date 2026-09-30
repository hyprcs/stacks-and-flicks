/* Taste twins (Flicks): people who share your favourite films, whose diaries become a source of picks.

   Finding them borrows the trick from hyprcs/letterboxd-doppelganger-finder: Letterboxd's member
   search accepts "fan:<film-slug>" filters, so a search for your favourites lists members who share
   them. Letterboxd only shows those results to people (a bot check blocks scripts), so you open the
   searches and paste in the members you like. Flicks then follows their public RSS diaries through
   the local helper (server.py), which is the one Letterboxd feed meant for machines.

   Keeping it from getting noisy:
   - a twin's weight starts from the favourites you share: obscure ones count far more than
     blockbusters everyone loves;
   - it then moves with how closely their ratings agree with yours on films you've both rated,
     shrunk toward zero while the overlap is small;
   - their ratings are read against their own average, so a generous rater doesn't flood you;
   - one twin's pick gets a smaller boost than a film several twins loved;
   - and the queue caps twin picks, like AI picks. */
(function () {
  const state = DQ.state;
  const D = DQ.D;
  if (!D.twins) return; // films only

  const FEED_TTL = 6 * 3600 * 1000; // matches the helper's cache
  const AUTO_SYNC = 12 * 3600 * 1000;
  const MAX_ENTRIES = 400;
  const NS = { letterboxd: 'https://letterboxd.com', tmdb: 'https://themoviedb.org' };
  const clamp = DQ.util.clamp;

  const T = () => (state.twins ||= { users: {}, recs: {}, lastSync: 0 });
  const emit = (detail) => document.dispatchEvent(new CustomEvent('dq:twins', { detail }));

  // ---------- finding twins ----------

  // From hyprcs/letterboxd-doppelganger-finder: film title -> Letterboxd slug ("Casablanca" -> "casablanca").
  function toSlug(title, year) {
    const slug = String(title)
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    return year ? `${slug}-${year}` : slug;
  }

  // How much sharing this favourite says: 1 for obscure films, down to 0.3 for ones everyone loves.
  const rarity = (votes) => clamp((5 - Math.log10(1 + (votes || 0))) / 2, 0.3, 1);

  /** Your four profile favourites (or, without them, your top-rated films), with TMDB data. */
  function favourites() {
    // Films and the miniseries Letterboxd lists both have a slug to search on.
    const docOf = (b) => {
      const e = state.enrich[b.gid];
      return e && !e.miss ? e : null;
    };
    const watched = state.library.filter((b) => b.exclusive === 'read' && docOf(b));
    let favs = watched.filter((b) => b.favorite);
    if (favs.length < 2) {
      favs = watched
        .filter((b) => b.rating >= 4.5 || b.liked)
        .sort((a, b) => b.rating - a.rating || rarity(docOf(b).ratingCount) - rarity(docOf(a).ratingCount));
    }
    return favs.slice(0, 4).map((b) => {
      const doc = docOf(b);
      return { key: doc.key, title: b.title, year: b.year, votes: doc.ratingCount, cover: doc.cover, rarity: rarity(doc.ratingCount), slug: toSlug(b.title) };
    });
  }

  const searchUrl = (films, withYears) =>
    `https://letterboxd.com/search/${encodeURIComponent(films.map((f) => `fan:${withYears ? toSlug(f.title, f.year) : f.slug}`).join(' '))}/`;

  function combos(list, k) {
    if (k === 0) return [[]];
    if (list.length < k) return [];
    const [head, ...rest] = list;
    return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)];
  }

  /** Letterboxd searches for members who share your favourites: all of them, then trios, then pairs, rarest first. */
  function searches() {
    const favs = favourites();
    const out = [];
    for (let k = Math.min(4, favs.length); k >= 2; k--) {
      for (const films of combos(favs, k)) {
        out.push({ films, keys: films.map((f) => f.key), size: k, rarity: films.reduce((a, f) => a + f.rarity, 0), url: searchUrl(films), urlYears: searchUrl(films, true) });
      }
    }
    return out.sort((a, b) => b.size - a.size || b.rarity - a.rarity);
  }

  const RESERVED = new Set([
    'film', 'films', 'list', 'lists', 'search', 'members', 'activity', 'settings', 'journal', 'showdown', 'about', 'pro', 'tmdb',
    'imdb', 'actor', 'director', 'crew', 'studio', 'tag', 'tags', 'genre', 'diary', 'reviews', 'watchlist', 'likes', 'network',
    'following', 'followers', 'stats', 'people', 'sign-in', 'welcome', 'apps', 'contact', 'legal', 'year-in-review',
  ]);

  /** Usernames from pasted text: profile links ("letterboxd.com/name/…") or bare names. */
  function parseUsernames(text) {
    const out = [];
    for (const token of String(text || '').split(/[\s,;]+/)) {
      const m = token.match(/letterboxd\.com\/([A-Za-z0-9_]+)/i) || token.match(/^@?([A-Za-z0-9_]{2,30})$/);
      const name = m?.[1]?.toLowerCase();
      if (name && !RESERVED.has(name) && !out.includes(name)) out.push(name);
    }
    return out;
  }

  /** Add members as twins; via = keys of the favourites they share (from the search they came from). */
  function addTwins(text, via = []) {
    const names = parseUsernames(text);
    const users = T().users;
    for (const name of names) {
      const u = (users[name] ||= { name, addedAt: Date.now(), via: [], entries: {}, fetchedAt: 0 });
      u.via = [...new Set([...u.via, ...via])];
    }
    DQ.store.save('twins');
    if (names.length) sync(names, { force: true });
    return names;
  }

  function removeTwin(name) {
    delete T().users[name];
    recompute();
    DQ.store.save('twins');
    DQ.app.invalidate();
    if (state.queue && !state.queue.done) DQ.rec.refreshUpcoming(DQ.app.model());
    emit({ state: 'done' });
  }

  // ---------- following their diaries ----------

  let helperCheck = null;
  /** Is the local helper (server.py) running? Plain `python -m http.server` can't relay feeds. */
  function helper() {
    helperCheck ||= location.protocol.startsWith('http')
      ? fetch('api/health', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => !!j?.letterboxdRss)
          .catch(() => false)
      : Promise.resolve(false);
    return helperCheck;
  }

  // A field of an RSS item: text(item, 'letterboxd', 'memberRating'), or text(item, '', 'pubDate').
  function text(item, prefix, name) {
    const el = (prefix && item.getElementsByTagNameNS(NS[prefix], name)[0]) || item.getElementsByTagName(prefix ? `${prefix}:${name}` : name)[0];
    return el?.textContent?.trim() || '';
  }

  async function fetchFeed(name) {
    const res = await fetch(`api/letterboxd/rss/${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!res.ok) {
      let msg = `The helper answered ${res.status}.`;
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      throw new Error(msg);
    }
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error("That feed couldn't be read.");
    const entries = {};
    for (const item of xml.querySelectorAll('item')) {
      const id = text(item, 'tmdb', 'movieId');
      if (!id) continue; // lists and other non-film items
      const key = 'm' + id;
      const d = text(item, 'letterboxd', 'watchedDate') || new Date(text(item, '', 'pubDate') || Date.now()).toISOString().slice(0, 10);
      const e = {
        r: parseFloat(text(item, 'letterboxd', 'memberRating')) || 0,
        l: text(item, 'letterboxd', 'memberLike') === 'Yes' ? 1 : 0,
        d,
        t: text(item, 'letterboxd', 'filmTitle'),
        y: parseInt(text(item, 'letterboxd', 'filmYear'), 10) || null,
      };
      if (!entries[key] || entries[key].d <= d) entries[key] = e;
    }
    return entries;
  }

  let syncing = null;
  /** Refresh twins' feeds (sequentially; the helper paces Letterboxd), then rescore and adopt picks. */
  function sync(names = Object.keys(T().users), { force = false } = {}) {
    if (syncing) return syncing.then(() => sync(names, { force }));
    syncing = (async () => {
      if (!(await helper())) {
        emit({ state: 'nohelper' });
        return { ok: false, reason: 'nohelper' };
      }
      emit({ state: 'syncing', names });
      const users = T().users;
      for (const name of names) {
        const u = users[name];
        if (!u || (!force && Date.now() - (u.fetchedAt || 0) < FEED_TTL)) continue;
        try {
          const fresh = await fetchFeed(name);
          const merged = { ...u.entries, ...fresh };
          u.entries = Object.fromEntries(Object.entries(merged).sort((a, b) => (b[1].d > a[1].d ? 1 : -1)).slice(0, MAX_ENTRIES));
          u.fetchedAt = Date.now();
          u.error = null;
        } catch (e) {
          u.error = e.message;
        }
        emit({ state: 'syncing', names, done: name });
      }
      T().lastSync = Date.now();
      recompute();
      DQ.store.save('twins');
      const adopted = await adopt();
      DQ.app.invalidate();
      if (state.queue && !state.queue.done) DQ.rec.refreshUpcoming(DQ.app.model());
      DQ.store.save('twins', 'pool');
      emit({ state: 'done', adopted });
      return { ok: true, adopted };
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  /** Quiet refresh on start-up when the last one is old. */
  function autoSync() {
    if (!Object.keys(T().users).length || Date.now() - (T().lastSync || 0) < AUTO_SYNC) return;
    sync().catch(() => {});
  }

  // ---------- weighting and scoring ----------

  function recompute() {
    const users = Object.values(T().users);
    const libKeys = new Set();
    const mine = new Map(); // TMDB key -> your rating
    for (const b of state.library) {
      const e = state.enrich[b.gid];
      if (!e || e.miss) continue;
      (e.keys || [e.key]).forEach((k) => libKeys.add(k));
      if (b.exclusive === 'read' && b.rating > 0) mine.set(e.key, b.rating);
    }
    const myMean = mine.size ? [...mine.values()].reduce((a, r) => a + r, 0) / mine.size : 3.4;
    const votesOf = new Map(Object.values(state.enrich).filter((e) => e && !e.miss).map((e) => [e.key, e.ratingCount]));

    const scores = new Map(); // key -> { s, by: [] }
    for (const u of users) {
      const rated = Object.values(u.entries).filter((e) => e.r > 0);
      // Their average, shrunk toward a typical 3.4 while they've rated little.
      u.mean = (rated.reduce((a, e) => a + e.r, 0) + 3.4 * 5) / (rated.length + 5);
      // Agreement on films you've both rated: Pearson on centred ratings, shrunk by n/(n+6).
      let sxy = 0, sxx = 0, syy = 0, n = 0;
      for (const [key, e] of Object.entries(u.entries)) {
        if (!e.r || !mine.has(key)) continue;
        const x = mine.get(key) - myMean, y = e.r - u.mean;
        sxy += x * y;
        sxx += x * x;
        syy += y * y;
        n++;
      }
      const r = n >= 3 && sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
      u.overlap = n;
      u.agreement = r * (n / (n + 6));
      // Shared favourites: rarer ones say more. Someone added without a search starts neutral.
      u.prior = u.via?.length ? Math.min(1, u.via.reduce((a, k) => a + rarity(votesOf.get(k)), 0) / 3) : 0.25;
      u.weight = clamp((0.4 + 0.6 * u.prior) * (1 + 0.8 * u.agreement), 0.1, 1.6);

      for (const [key, e] of Object.entries(u.entries)) {
        if (libKeys.has(key)) continue;
        const loved = e.r ? e.r >= u.mean + 0.25 : e.l;
        if (!loved) continue;
        const lift = (e.r ? e.r - u.mean : 0.5) + 0.5 * e.l + (e.r >= 4.5 ? 0.3 : 0);
        const cur = scores.get(key) || { s: 0, support: 0, by: [] };
        cur.s += u.weight * lift;
        // Support counts twins by their weight, so a barely-trusted one can't vouch like a real twin.
        cur.support += Math.min(1, u.weight);
        cur.by.push({ name: u.name, r: e.r, l: e.l });
        scores.set(key, cur);
      }
    }
    const recs = {};
    [...scores.entries()]
      .map(([key, { s, support, by }]) => [key, { boost: 1.3 * Math.tanh(s) * (0.75 + 0.25 * clamp(support - 1, 0, 1)), by: by.sort((a, b) => b.r - a.r) }])
      .filter(([, v]) => v.boost >= 0.15)
      .sort((a, b) => b[1].boost - a[1].boost)
      .slice(0, 150)
      .forEach(([key, v]) => (recs[key] = v));
    T().recs = recs;
  }

  /** Bring the strongest twin picks into the candidate pool (TMDB details for ones we don't have). */
  async function adopt(limit = 60) {
    const keys = Object.keys(T().recs).filter((k) => !state.pool[k] && !state.events[k] && !state.seen[k]).slice(0, limit);
    let added = 0;
    await Promise.all(
      keys.map(async (key) => {
        try {
          const doc = await DQ.tmdb.byId(key.slice(1));
          if (!doc) return;
          const by = T().recs[key]?.by?.[0]?.name || null;
          if (DQ.rec.adopt(doc, { type: 'twin', tag: by, ref: by })) added++;
        } catch {}
      })
    );
    return added;
  }

  /** Twins with their stats, strongest first (for Your Taste). */
  const list = () => Object.values(T().users).sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const picksInPool = () => Object.keys(T().recs).filter((k) => state.pool[k]).length;

  DQ.twins = { favourites, searches, parseUsernames, addTwins, removeTwin, sync, autoSync, helper, recompute, list, picksInPool, toSlug };
})();
