/* Persistent app state in localStorage. Each top-level slice is its own key so
   small, frequent writes (queue position, feedback) don't reserialise the pool.

   Books and films are separate modes with separate data: books keep the original "dq1:" prefix
   (so existing libraries carry over), films use "dq1f:". A few settings are shared by both modes
   under "dqg:": which mode is active, the TMDB key, and the AI provider connection. */
(function () {
  const MODES = ['books', 'films'];
  const GLOBAL = 'dqg:';

  function readRaw(k) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? undefined : JSON.parse(v);
    } catch {
      return undefined;
    }
  }

  // brand.js (in <head>) has already resolved the mode, honouring ?mode= from home-screen icons.
  let mode = DQ.bootMode || readRaw(GLOBAL + 'mode');
  if (!MODES.includes(mode)) mode = 'books';
  const PREFIX = mode === 'books' ? 'dq1:' : 'dq1f:';

  const DEFAULTS = () => ({
    library: [], // parsed export rows (Goodreads books or Letterboxd films)
    enrich: {}, // gid -> metadata doc (Open Library / TMDB), or { miss: true }
    background: null, // { n, df } tag frequencies of popular titles (the baseline taste is measured against)
    calib: {}, // gid -> 'loved' | 'liked' | 'ok' | 'disliked' | 'skip' (quick-rate answers)
    calibDone: false,
    events: {}, // workKey -> { action, reason, t, doc } (queue feedback, latest wins)
    tags: {}, // tag -> 'more' | 'less' | 'ban' (explicit taste controls)
    wishlist: [], // [{ key, t, doc, why }]
    seen: {}, // workKey -> timestamp shown in a queue
    pool: {}, // workKey -> candidate doc
    queries: {}, // query string -> { offset, total, t }
    queue: null, // current discovery queue
    history: [], // finished queue summaries
    settings: { adventure: 1, popularity: 0, size: 12, aiPerQueue: 4, twinsPerQueue: 3 },
    ai: { enabled: false, provider: 'openrouter', model: '', base: '', key: '', remember: true, auto: true, recs: {} },
    works: {}, // workKey -> { desc, t } description cache
    twins: { users: {}, recs: {}, lastSync: 0 }, // Flicks taste twins: followed members and the picks they suggest
    tmdb: { key: '' }, // shared: TMDB API key (films)
  });

  const SLICES = Object.keys(DEFAULTS());
  const SHARED = new Set(['tmdb']);
  const MODE_SLICES = SLICES.filter((k) => !SHARED.has(k));
  const storageKey = (k) => (SHARED.has(k) ? GLOBAL : PREFIX) + k;

  // The AI connection (provider, model, key…) is shared; picks and the AI's profile stay per mode.
  const AI_CONN = ['enabled', 'provider', 'model', 'base', 'key', 'remember', 'auto'];
  const pickConn = (ai) => Object.fromEntries(AI_CONN.filter((k) => ai && k in ai).map((k) => [k, ai[k]]));
  const omitConn = (ai) => Object.fromEntries(Object.entries(ai || {}).filter(([k]) => !AI_CONN.includes(k)));

  function read(key, fallback) {
    const v = readRaw(storageKey(key));
    return v === undefined ? fallback : v;
  }

  function put(k, value) {
    localStorage.setItem(k, JSON.stringify(value));
  }

  function persist(key, value) {
    if (key !== 'ai') return put(storageKey(key), value);
    put(GLOBAL + 'aiconn', pickConn(value));
    put(storageKey(key), omitConn(value));
  }

  function write(key, value) {
    try {
      persist(key, value);
      return true;
    } catch (e) {
      // Out of space: drop the rebuildable caches and try once more.
      if (key !== 'works' && key !== 'queries') {
        try {
          state.works = {};
          state.queries = {};
          localStorage.removeItem(PREFIX + 'works');
          localStorage.removeItem(PREFIX + 'queries');
          persist(key, value);
          return true;
        } catch {}
      }
      console.warn('Could not persist', key, e);
      return false;
    }
  }

  // Before modes existed the AI connection (key included) lived in the books slice: move it out once.
  const legacyAi = readRaw('dq1:ai');
  if (legacyAi && AI_CONN.some((k) => k in legacyAi)) {
    try {
      if (readRaw(GLOBAL + 'aiconn') === undefined && legacyAi.provider) put(GLOBAL + 'aiconn', pickConn(legacyAi));
      put('dq1:ai', omitConn(legacyAi));
    } catch {}
  }

  const defaults = DEFAULTS();
  const state = {};
  for (const k of SLICES) state[k] = read(k, defaults[k]);
  state.settings = { ...defaults.settings, ...state.settings };
  state.ai = { ...omitConn(defaults.ai), ...omitConn(state.ai), ...(readRaw(GLOBAL + 'aiconn') || pickConn(defaults.ai)) };

  const dirty = new Set();
  let timer = null;
  function flush() {
    timer = null;
    for (const k of dirty) write(k, state[k]);
    dirty.clear();
  }

  // Mark slices dirty; they're written together on the next tick (or immediately with now=true).
  function save(...keys) {
    keys.forEach((k) => dirty.add(k));
    if (!timer) timer = setTimeout(flush, 250);
  }
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

  // Resets this mode's data; the shared settings stay unless named.
  function reset(keys = MODE_SLICES) {
    const fresh = DEFAULTS();
    for (const k of keys) {
      dirty.delete(k);
      state[k] = k === 'ai' ? { ...omitConn(fresh.ai), ...pickConn(state.ai) } : fresh[k];
      try {
        localStorage.removeItem(storageKey(k));
      } catch {}
    }
  }

  // Keep the description cache bounded.
  function pruneWorks(max = 250) {
    const entries = Object.entries(state.works);
    if (entries.length <= max) return;
    entries.sort((a, b) => b[1].t - a[1].t);
    state.works = Object.fromEntries(entries.slice(0, max));
    save('works');
  }

  /** Switch between books and films: each mode's state is loaded at startup, so this reloads. */
  function setMode(next, route = 'queue') {
    if (!MODES.includes(next)) return;
    flush();
    try {
      put(GLOBAL + 'mode', next);
    } catch {}
    // Drop any ?mode= so the reload picks up the saved choice rather than the old URL's.
    history.replaceState(null, '', `${location.pathname}#/${route}`);
    location.reload();
  }

  /** Whether the other mode already has an imported library (for the switch's hint). */
  const hasLibrary = (m) => {
    const lib = readRaw((m === 'books' ? 'dq1:' : 'dq1f:') + 'library');
    return Array.isArray(lib) && lib.length > 0;
  };

  DQ.mode = mode;
  DQ.state = state;
  DQ.store = { save, flush, reset, pruneWorks, setMode, hasLibrary, MODES };
})();
