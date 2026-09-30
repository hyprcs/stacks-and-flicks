/* Film tag vocabulary. TMDB's genres and keywords are far tidier than library subject headings,
   so this mostly drops production trivia ("duringcreditsstinger"), merges synonyms, and adds a
   "<language> cinema" tag from the original language: the film counterpart of a literary tradition.

   Same interface as the book vocabulary (normalize, kind, display, queryForm, shelfTags, isPlace,
   isSensitive), so the shared taste model and views don't care which one is active. */
(function () {
  const { titleCase } = DQ.util;

  const GENRES = {
    28: 'action', 12: 'adventure', 16: 'animation', 35: 'comedy', 80: 'crime', 99: 'documentary', 18: 'drama',
    10751: 'family', 14: 'fantasy', 36: 'history', 27: 'horror', 10402: 'music', 9648: 'mystery', 10749: 'romance',
    878: 'science fiction', 10770: 'tv movie', 53: 'thriller', 10752: 'war', 37: 'western',
  };
  const GENRE_ID = Object.fromEntries(Object.entries(GENRES).map(([id, name]) => [name, +id]));
  // TV genres (for miniseries in a Letterboxd diary), folded into the film ones where they overlap.
  const TV_GENRES = { 10759: 'action', 10765: 'science fiction', 10768: 'war', 10762: 'family', 10764: 'reality tv', 10766: 'soap opera', 10767: 'talk show', 10763: 'news' };

  // Original language -> the film tradition it usually signals. English gets no tag (it's the default).
  const LANG = {
    ja: 'japanese', ko: 'korean', fr: 'french', it: 'italian', de: 'german', es: 'spanish-language', zh: 'chinese',
    cn: 'hong kong', hi: 'hindi', ru: 'russian', sv: 'swedish', da: 'danish', no: 'norwegian', nb: 'norwegian',
    fi: 'finnish', pl: 'polish', pt: 'portuguese-language', fa: 'iranian', tr: 'turkish', ar: 'arabic', th: 'thai',
    he: 'israeli', nl: 'dutch', el: 'greek', hu: 'hungarian', cs: 'czech', ro: 'romanian', ta: 'tamil', te: 'telugu',
    ml: 'malayalam', bn: 'bengali', id: 'indonesian', tl: 'filipino', uk: 'ukrainian', sr: 'serbian', is: 'icelandic',
    ka: 'georgian', vi: 'vietnamese', et: 'estonian', lt: 'lithuanian', bs: 'bosnian', hr: 'croatian', sk: 'slovak',
  };
  const LANG_TAG = Object.fromEntries(Object.entries(LANG).map(([code, name]) => [`${name} cinema`, code]));
  const UMBRELLA = 'world cinema'; // any non-English original language

  // Production trivia and bookkeeping, not taste.
  const DROP = new Set([
    'duringcreditsstinger', 'aftercreditsstinger', 'post-credits scene', 'mid-credits scene', 'end credits scene',
    'woman director', 'female director', 'sequel', 'prequel', 'remake', 'reboot', 'spin off', '3d', 'imax',
    'live action remake', 'short film', 'anthology', 'franchise', 'shared universe', 'soft reboot', 'legacy sequel',
    'duringcreditsstinger scene', 'no opening credits', 'loosely based on', 'aftercredits stinger',
  ]);
  const DROP_RE = [/^\d{4}$/, /\bcredits?\b.*\bstinger\b/, /^(filmed|shot) (in|on) /, /\bbox office\b/];

  const SYNONYMS = {
    'artificial intelligence (a.i.)': 'artificial intelligence', 'a.i.': 'artificial intelligence', ai: 'artificial intelligence',
    'sci-fi': 'science fiction', 'scifi': 'science fiction', 'sf': 'science fiction',
    'based on novel or book': 'based on novel', 'based on novel': 'based on novel', 'based on book': 'based on novel',
    'based on true story': 'based on a true story', 'based on a true story': 'based on a true story', 'true story': 'based on a true story',
    'biography': 'biopic', 'biographical': 'biopic', 'biopic': 'biopic',
    'black comedy': 'dark comedy', 'dark comedy': 'dark comedy', 'black humor': 'dark comedy',
    'noir': 'film noir', 'film noir': 'film noir', 'neo-noir': 'neo-noir', 'neo noir': 'neo-noir',
    'lgbt': 'lgbtq', 'lgbt interest': 'lgbtq', 'gay theme': 'lgbtq', 'lgbtq+': 'lgbtq', 'queer': 'lgbtq', 'queer cinema': 'lgbtq',
    'dystopian': 'dystopia', 'dystopia': 'dystopia', 'post-apocalyptic future': 'post-apocalyptic', 'post apocalyptic': 'post-apocalyptic',
    'zombies': 'zombie', 'vampires': 'vampire', 'aliens': 'alien', 'alien life-form': 'alien', 'extraterrestrial': 'alien',
    'spoof': 'parody', 'parody': 'parody', 'mockumentary': 'mockumentary',
    'coming-of-age': 'coming of age', 'coming of age': 'coming of age',
    'rom-com': 'romantic comedy', 'romcom': 'romantic comedy', 'romantic comedy': 'romantic comedy',
    'sci-fi horror': 'science fiction horror', 'kung fu': 'martial arts', 'martial arts': 'martial arts',
    'superhero': 'superhero', 'super power': 'superpowers', 'superpower': 'superpowers',
    'world war ii': 'world war ii', 'world war 2': 'world war ii', 'ww2': 'world war ii', 'second world war': 'world war ii',
    'world war i': 'world war i', 'ww1': 'world war i', 'first world war': 'world war i',
    'black and white': 'black and white', 'b&w': 'black and white', 'silent film': 'silent film',
    'independent film': 'independent film', 'indie': 'independent film', 'arthouse': 'arthouse', 'art house': 'arthouse',
    'thriller': 'thriller', 'thrillers': 'thriller', 'horror film': 'horror', 'slasher': 'slasher', 'giallo': 'giallo',
    'animated': 'animation', 'anime': 'anime', 'documentaries': 'documentary', 'musicals': 'musical', 'westerns': 'western',
    'foreign': UMBRELLA, 'foreign film': UMBRELLA, 'foreign language': UMBRELLA, 'international': UMBRELLA,
    'bollywood': 'hindi cinema', 'j-horror': 'japanese horror', 'k-drama': 'korean cinema',
  };

  // Genre-like keywords: they drive the "you lean into…" summary alongside TMDB's own genres.
  const GENRE_LIKE = new Set([
    ...Object.values(GENRES), 'film noir', 'neo-noir', 'anime', 'slasher', 'giallo', 'body horror', 'folk horror',
    'found footage', 'mockumentary', 'psychological thriller', 'erotic thriller', 'heist', 'road movie', 'coming of age',
    'period drama', 'costume drama', 'spaghetti western', 'martial arts', 'wuxia', 'samurai', 'superhero', 'space opera',
    'cyberpunk', 'dystopia', 'post-apocalyptic', 'musical', 'dark comedy', 'romantic comedy', 'satire', 'parody',
    'biopic', 'disaster', 'kaiju', 'arthouse', 'independent film', 'silent film', 'science fiction horror', 'sword and sorcery',
    'melodrama', 'screwball comedy', 'political thriller', 'legal drama', 'courtroom drama', 'sports', 'war', 'epic',
    'surrealism', 'experimental', 'slice of life', 'teen movie', 'buddy comedy', 'cult film', 'japanese horror',
  ]);

  // TMDB files settings as keywords: "paris, france", "los angeles, california", "florida", "japan".
  const PLACES = new Set([
    'new york city', 'los angeles', 'london', 'paris', 'tokyo', 'rome', 'berlin', 'hong kong', 'seoul', 'moscow', 'mumbai',
    'chicago', 'san francisco', 'las vegas', 'new orleans', 'boston', 'miami', 'detroit', 'philadelphia', 'washington dc',
    'brooklyn', 'manhattan', 'hollywood', 'venice', 'naples', 'sicily', 'osaka', 'kyoto', 'shanghai', 'beijing', 'istanbul',
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
    'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
    'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
    'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island',
    'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
    'wisconsin', 'wyoming', 'usa', 'united states', 'england', 'scotland', 'wales', 'ireland', 'northern ireland', 'france',
    'italy', 'germany', 'spain', 'portugal', 'mexico', 'canada', 'australia', 'new zealand', 'japan', 'china', 'korea',
    'south korea', 'north korea', 'india', 'russia', 'soviet union', 'vietnam', 'thailand', 'iran', 'iraq', 'afghanistan',
    'israel', 'egypt', 'morocco', 'brazil', 'argentina', 'colombia', 'cuba', 'africa', 'poland', 'sweden', 'norway', 'denmark',
    'finland', 'iceland', 'greece', 'turkey', 'austria', 'switzerland', 'netherlands', 'belgium', 'hungary', 'czech republic',
  ]);
  const isPlace = (tag) => PLACES.has(tag) || /^[a-z .'’-]+, [a-z .'’-]+$/.test(tag) || /\b(city|county|island|desert)$/.test(tag);

  const SENSITIVE_RE =
    /pedophil|paedophil|child abuse|child molest|sexual abuse|sexual assault|rape|incest|suicide|self-harm|self harm|genocide|sex crime|domestic abuse|domestic violence|molestation|torture porn|snuff/;

  function clean(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[“”"]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.;:]+$/, '')
      .trim();
  }

  /** One raw keyword / typed phrase -> canonical tag, or null for noise. */
  function canonical(raw) {
    const p = clean(raw);
    if (!p) return null;
    if (SYNONYMS[p]) return SYNONYMS[p];
    if (DROP.has(p) || DROP_RE.some((re) => re.test(p))) return null;
    if (p.length < 3 || p.length > 42) return null;
    return p;
  }

  /** TMDB movie parts -> tags (genres first, then keywords, then the language tradition). */
  function fromTmdb({ genres = [], keywords = [], lang = null }, limit = 32) {
    const tags = [];
    const seen = new Set();
    const push = (t) => {
      if (!t || seen.has(t)) return;
      seen.add(t);
      tags.push(t);
    };
    for (const g of genres) push(GENRES[g.id] || TV_GENRES[g.id] || canonical(g.name));
    for (const k of keywords) if (tags.length < limit) push(canonical(k.name));
    if (lang && lang !== 'en') {
      push(LANG[lang] ? `${LANG[lang]} cinema` : null);
      push(UMBRELLA);
    }
    return tags;
  }

  /** Free text (e.g. "Want more of…" on the taste page) -> tags. */
  function normalize(strings) {
    const tags = [];
    for (const s of strings || []) {
      const t = canonical(s);
      if (t && !tags.includes(t)) tags.push(t);
    }
    return { tags, raw: {} };
  }

  const kind = (tag) => (GENRE_LIKE.has(tag) ? 'genre' : LANG_TAG[tag] || tag === UMBRELLA ? 'tradition' : 'theme');
  const isSensitive = (tag) => SENSITIVE_RE.test(tag);
  // Settings are trivia rather than taste in a film ("Florida", "San Fernando Valley"): they still count
  // when scoring a film, but don't name facets, top the theme list or drive searches.
  const isTrivia = (tag) => isPlace(tag) && !LANG_TAG[tag];
  // For labels like "Exploring …": broad, recognisable tags first.
  const labelRank = (tag) => (kind(tag) === 'theme' ? (isPlace(tag) ? 0 : 1) : 2);

  const DISPLAY = {
    'tv movie': 'TV Movie', lgbtq: 'LGBTQ', 'world war ii': 'World War II', 'world war i': 'World War I',
    'based on novel': 'Based on a Novel', 'neo-noir': 'Neo-Noir', 'film noir': 'Film Noir', 'new york city': 'New York City',
    'spanish-language cinema': 'Spanish-Language Cinema', 'portuguese-language cinema': 'Portuguese-Language Cinema',
    'cia': 'CIA', 'fbi': 'FBI', 'nasa': 'NASA', 'usa': 'USA', 'dc comics': 'DC Comics', 'mi6': 'MI6', 'kgb': 'KGB',
  };
  const display = (tag) => DISPLAY[tag] || titleCase(tag).replace(/\b(Usa|Uk|Nyc|Lapd|Nypd|Ufo|Ai|3d|2d)\b/g, (m) => m.toUpperCase());

  /**
   * Query clause for a tag, in the TMDB client's mini-language: g:<genre id>, l:<language code>,
   * or k:<keyword name> (the client resolves keyword names to ids). null = can't be searched.
   */
  function queryForm(tag) {
    if (tag === UMBRELLA || isTrivia(tag)) return null;
    if (GENRE_ID[tag]) return `g:${GENRE_ID[tag]}`;
    if (LANG_TAG[tag]) return `l:${LANG_TAG[tag]}`;
    return `k:${tag}`;
  }

  // Letterboxd diary tags double as tags, minus the bookkeeping ones people use.
  const SHELF_IGNORE =
    /^(\d{4}|\d{4}s?.*|rewatch(ed)?|first (watch|time)|theat(er|re)s?|cinema|in cinemas?|at home|netflix|hbo|max|mubi|prime( video)?|amazon|hulu|disney\+?|apple tv\+?|criterion( channel)?|kanopy|plex|tubi|youtube|dvd|blu-?ray|vhs|4k|letterboxd.*|watched with .*|with .*|date night|challenge.*|.*challenge|list.*|watchlist|favou?rites?|liked?|dnf|walked out)$/;
  function shelfTags(tags) {
    const out = [];
    for (const t of tags || []) {
      const c = clean(String(t).replace(/[-_]+/g, ' '));
      if (!c || SHELF_IGNORE.test(c)) continue;
      const tag = canonical(c);
      if (tag && !out.includes(tag)) out.push(tag);
    }
    return out;
  }

  DQ.filmTags = { fromTmdb, canonical, normalize, kind, display, queryForm, shelfTags, isPlace, isSensitive, isTrivia, labelRank, GENRES, UMBRELLA };
})();
