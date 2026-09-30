/* Films: a Letterboxd export matched on TMDB. See domains/books.js for what a domain supplies. */
(function () {
  const { html, clamp, plural, stripDiacritics } = DQ.util;

  // A film takes two hours, not ten, so watching one is a weaker vote than finishing a book:
  // an unrated watch is a mild yes. Letterboxd users rate a lot, and in half stars, so a rating is
  // read against the viewer's own average in both directions: well below it counts against.
  // Hearts, profile favourites and rewatches lift a film.
  const WATCHED = 0.35;
  const WATCHLIST = 0.15; // intent, and watchlists run long
  const CALIB_W = { loved: 1.0, liked: 0.6, ok: 0.15, disliked: -0.6 };
  const EVENT_W = { want: 0.6, pass: -0.45, skip: -0.03, ...CALIB_W };

  // Purely relative: from a harsh rater (averaging 3★) a 2★ is a shrug, from a generous one a pan.
  function ratedWeight(rating, mean) {
    const w = clamp(WATCHED + 0.55 * (rating - mean), -0.9, 1.0);
    return rating <= 1 ? Math.min(w, -0.7) : w; // one star or less is a dislike whatever your average
  }

  function libraryWeight(b, calib, scale) {
    const c = calib[b.gid];
    if (c && CALIB_W[c] != null) return { w: CALIB_W[c], basis: c };
    if (b.favorite) return { w: 1.0, basis: 'favourite' };
    if (b.exclusive !== 'read') return { w: WATCHLIST, basis: 'watchlist' };
    if (/\b(walked out|walkout|dnf|didn'?t finish|gave up)\b/.test(b.shelves.join(' '))) return { w: -0.6, basis: 'walked out' };
    let w = b.rating ? ratedWeight(b.rating, scale.mean) : WATCHED;
    let basis = b.rating ? `${b.rating}★` : 'watched';
    if (b.liked) {
      w = Math.max(w + 0.4, 0.75);
      basis += ' ♥';
    }
    if (b.readCount > 1 && w >= 0) {
      w = Math.max(w, 0.7);
      basis += ', rewatched';
    }
    return { w: Math.min(1, w), basis };
  }

  const normFilm = (t) => stripDiacritics(t).toLowerCase().replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const runtime = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
  const tmdbId = (key) => String(key).replace(/^m/, '');

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const CAL = { loved: 'loved it', liked: 'liked it', ok: 'it was OK', disliked: "didn't like it" };

  DQ.domains = DQ.domains || {};
  DQ.domains.films = {
    id: 'films',
    label: 'Films',
    icon: 'film',
    source: DQ.tmdb,
    vocab: DQ.filmTags,
    umbrellaTag: 'world cinema',
    creatorFromSource: true, // Letterboxd rows have no director: it always comes from the TMDB match
    twins: true, // taste twins: follow people who share your favourites (js/twins.js)

    // ---------- words ----------
    w: {
      item: 'film', items: 'films', Items: 'Films',
      creator: 'director', creators: 'directors', Creators: 'Directors',
      by: 'directed by',
      done: 'seen',
      did: 'watched',
      does: 'watch',
      Did: 'Watched',
      logged: 'Logged',
      seenIt: 'Seen it', seen: 'Seen', seenHint: 'seen it',
      wishlist: 'Watchlist', wishlistRef: 'your Watchlist', onWishlist: 'On your watchlist', wishShort: 'watchlist', wishHint: 'watchlist',
      wishTab: 'Watchlist',
      activity: 'viewing', Activity: 'Viewing',
      audience: 'viewer', binger: 'watcher',
      library: 'diary', inLibrary: 'in your diary', onLibrary: 'in your diary',
      reads: 'films',
      pickUp: 'watch',
      source: 'TMDB', service: 'Letterboxd',
      ratings: 'TMDB votes', wtr: null,
    },
    t: {
      profileTitle: 'What your diary says about you',
      rareHead: 'Rarely in your diary',
      analyzeTitle: 'Reading your diary…',
      matchDetail: 'Genres, keywords, directors and posters',
      matchFallback: 'rating and date',
      baselineStep: 'Learn what a typical viewer watches',
      baselineDetail: 'Sampling the 300 most-watched films',
      noDesc: 'No synopsis on TMDB yet. The themes below are what it\'s tagged with.',
      foreign: 'not in English',
      dateBasis: 'release year',
      dates: 'release dates',
      lengthNoun: 'Runtimes',
      themeExample: 'e.g. heist, neo-noir, Korean cinema',
      calibSkip: 'Skip (counts as a mild yes)',
      calibIntro: html`These are films you watched but never rated. Watching one already counts as a mild yes,
        so there's no need to rate them all. Tap <b>Loved it</b> for the ones that really stuck and
        <b>Didn't like it</b> for the ones you sat through; skip the rest. Stop whenever you like.`,
      aiPitch: `Have a language model read your whole diary and suggest films the tags can't find:
        it picks up tone, style and why you liked something.`,
      eraseConfirm: 'Erase all your film data on this device, including your imported diary and Watchlist? Your book data and TMDB key are kept.',
      summaryLine(lib) {
        const s = DQ.letterboxd.librarySummary(lib);
        return [
          plural(s.total, 'film'), `${s.watched} watched`, `${s.watchlist} on your watchlist`, `${s.rated} rated`,
          s.liked ? `${s.liked} hearted` : '', s.favorites ? `${s.favorites} favourites` : '',
        ].filter(Boolean).join(' · ');
      },
      ratingPattern(model, { rated, calibrated, unrated }) {
        const liked = DQ.state.library.filter((b) => b.liked).length;
        return html`${
          rated
            ? html`Your ratings are read against your own average of <b>${model.scale.mean.toFixed(1)}★</b>: above it counts for a film, well below it counts against`
            : "You don't rate films, so every film you watched counts as a mild yes"
        }${liked ? html`; your <b>${liked}</b> hearts count extra` : ''}${rated && unrated ? '. Unrated films count as a mild yes' : ''}${
          calibrated ? html`, plus <b>${calibrated}</b> marked here` : ''
        }. ${calibrated < 3 && unrated > 5 ? html`<a href="#/calibrate">Mark your standouts and duds</a> to sharpen things.` : ''}`;
      },
    },

    // ---------- evidence ----------
    libraryWeight,
    CALIB_W,
    EVENT_W,
    ratingPrior: 3.4, // a typical Letterboxd average
    // Only diary dates are real watch dates; bulk-logged history would look like one giant binge.
    binge: { min: 3, days: 90, date: (b) => b.dateRead },

    // ---------- scoring ----------
    quality: { prior: 3.3, spread: 0.35, m: 100 }, // TMDB averages run lower than Goodreads'
    popCenter: 3.0, // log10 of a middling TMDB vote count
    minPop: 60, // votes + ratings: ~30 TMDB votes
    explorePop: 300,
    hugePop: 15000,
    isGem: (doc, bayes) => doc.wtr < 1500 && bayes >= 3.6 && doc.ratingCount >= 50,
    classicYear: 1970,
    length: {
      edges: [0, 90, 110, 130, 160],
      labels: ['Under 90 min', '90–110 min', '110–130 min', '130–160 min', '160+ min'],
      axis: ['<90', '90–110', '110–130', '130–160', '160+'],
      long: 140,
      short: 95,
      label: runtime,
    },
    sequelRe: null, // the TMDB client sets seriesNum from titles, and collections give the series
    junk: (doc) => (doc.pages > 0 && doc.pages < 45) || /\b(making of|behind the scenes|featurette|deleted scenes)\b/i.test(doc.title),
    titleKey: (title, author, year) => normFilm(title) + '|' + (year || ''),
    poolMax: 1200,

    // ---------- candidate queries (the TMDB client's mini-language) ----------
    q: {
      subject: (form) => form,
      author: (key) => `person:${key}`,
      similar: (key) => `similar:${tmdbId(key)}`,
    },
    pageSize: () => 20,

    // ---------- presentation ----------
    coverUrl: (path, size) => DQ.tmdb.coverUrl(path, size),
    links: (doc) => [
      { label: 'Letterboxd', url: `https://letterboxd.com/tmdb/${tmdbId(doc.key)}/` },
      { label: 'TMDB', url: `https://www.themoviedb.org/movie/${tmdbId(doc.key)}` },
    ],

    // ---------- How it works ----------
    how: {
      title: 'How Flicks picks your next film',
      intro: `Flicks reads your Letterboxd export, works out what you respond to compared with a typical viewer, and
        searches TMDB around every side of your taste, plus the films people with your taste loved. Each queue
        mixes strong matches with a few exploration picks, and every choice you make retunes what comes next.`,
      steps: [
        { icon: 'film', title: 'Matching', text: 'Every diary entry is matched on TMDB by exact title and year, looking a year either side because festival and release years differ. Watched films bring genres, keywords, director, runtime and collection; the series Letterboxd lists match as TV. A film’s original language becomes a tradition tag such as Korean Cinema.' },
        { icon: 'star', title: 'Signals', text: 'Watching a film is a smaller commitment than finishing a book, so an unrated watch is a mild yes. Ratings are read against your own average in both directions: from someone who averages 3★, a 2★ is a shrug. Hearts, your four profile favourites and rewatches lift a film; recency and director binges count too.' },
        { icon: 'compass', title: 'Compared with a typical viewer', text: 'Your tags are measured against the 300 most-voted films on TMDB, so you’re matched on what you watch more than most people do, not on what happens to be popular.' },
        { icon: 'layers', title: 'The sides of your taste', text: 'Films you like are clustered into facets, such as screwball comedies, Italian horror or war films. Searches cover every facet and each queue saves room for each one.' },
        { icon: 'spark', title: 'Finding candidates', text: 'TMDB searches run on your strongest themes, pairs of themes, facets and favourite directors, plus TMDB’s “people who liked this also liked” lists for your favourite films and the recent favourites of your taste twins.' },
        { icon: 'check', title: 'Picking a queue', text: 'Candidates are scored, then chosen for variety: one film per director, only the first film of a series you haven’t started, a quality floor, and a few exploration picks where the model knows little.' },
        { icon: 'refresh', title: 'Learning', text: 'Watchlist, pass, seen and skip update the model at once and re-pick the rest of the queue. Your Taste shows what it believes and lets you correct it.' },
      ],
      privacy: [
        'Your diary, queue and learning are stored only in this browser.',
        'Film titles and years go to TMDB with your API key.',
        'Taste twins: a small helper on your own computer fetches each twin’s public Letterboxd RSS feed, at most every few hours.',
        'With AI assist on, your film list, ratings and reactions go to the provider you choose, only when a run happens.',
        'From a Letterboxd export only the film files are read; of profile.csv, only your four favourites.',
      ],
    },

    // ---------- import / export ----------
    landing: {
      title: html`Your Letterboxd diary, turned into a <em>discovery queue</em>.`,
      intro: `Drop in your Letterboxd export and step through films picked for you, one at a time, like Steam's
        discovery queue. It maps the different sides of your taste, explains every pick, and gets sharper
        with each film you add to your watchlist or pass on.`,
      dropTitle: 'Drop your Letterboxd export here',
      dropHint: html`or click to choose the <code>.zip</code> (or the CSV files inside it)`,
      accept: '.zip,.csv,application/zip,text/csv',
      multiple: true,
      localFile: 'letterboxd_export.zip',
      howto: [
        html`On Letterboxd, open <b>Settings</b> and go to the <b>Data</b> tab.`,
        html`Choose <b>Export your data</b> and download the ZIP.`,
        html`Drop it above. Ratings, hearts, rewatches, diary dates and your watchlist all feed your taste profile.`,
      ],
      privacy: `Everything runs in your browser and is saved only on this device. Film titles and years are sent to
        TMDB, with your API key, to look up genres, keywords, directors and posters. Nothing else leaves your computer.`,
    },
    async parseFiles(files) {
      return DQ.letterboxd.parseLetterboxd(await DQ.letterboxd.readFiles(files));
    },
    // Letterboxd's importer matches on tmdbID first, so every pick lands on the right film.
    exportWishlist(list) {
      const rows = [['tmdbID', 'Title', 'Year', 'Directors']];
      for (const w of list) rows.push([tmdbId(w.key), w.doc.title, w.doc.year || '', (w.doc.authors || []).join(', ')]);
      return {
        csv: rows.map((r) => r.map(csvCell).join(',')).join('\r\n'),
        filename: 'stacks_watchlist.csv',
        note: html`Saved <b>stacks_watchlist.csv</b>. On Letterboxd, open your <b>Watchlist</b> and use its import option to add them.`,
      };
    },

    // ---------- AI assist ----------
    ai: {
      creatorField: 'director',
      preferModelNames: false, // TMDB's credits are already the canonical names
      system: `You help a film lover find what to watch next. You'll get their Letterboxd history (ratings out of 5 in half stars, hearts, rewatches, watchlist), any quick ratings they gave, and how they reacted to recent recommendations. Work out what they actually respond to - themes, tone, style, directors, era, national cinema - beyond surface genre, then recommend real, released feature films they haven't seen or put on their watchlist.

Guidelines:
- Recommend only films you are confident exist. Use the usual English-language title, the release year and the director's name.
- Skip anything in their history, on their watchlist or on the already-suggested list. For a series they haven't started, suggest the first film.
- Spread the picks across the different sides of their taste. Make about one in five a deliberate stretch into adjacent territory and mark it with "stretch": true.
- "why" is one or two sentences addressed to the viewer ("you") that ties the film to specific films or reactions of theirs.
- "facet" names which side of their taste the pick serves, using the names you give in "facets".
- "taste_summary" is three to five specific sentences addressed to the viewer.

Reply with a single JSON object and nothing else, shaped like:
{"taste_summary": "...", "facets": [{"name": "...", "description": "..."}], "recommendations": [{"title": "...", "director": "...", "year": 1965, "why": "...", "facet": "...", "stretch": false}]}`,
      // Hearts, favourites and ratings far from the middle say the most.
      score: (b, calib) =>
        (b.favorite ? 5 : 0) + (b.liked ? 3 : 0) + (b.rating ? 2 + Math.abs(b.rating - 3.25) : 0) +
        (calib && calib !== 'skip' ? 3 : 0) + (b.readCount > 1 ? 2 : 0) + (b.exclusive === 'to-read' ? 0 : 1) +
        ((b.dateRead || b.dateAdded || 0) / 1e13),
      line(b, cal) {
        const parts = [];
        if (b.rating) parts.push(`${b.rating}/5`);
        else if (cal && CAL[cal]) parts.push(CAL[cal]);
        if (b.favorite) parts.push('one of their four profile favourites');
        if (b.liked) parts.push('hearted');
        if (b.exclusive === 'to-read') parts.push('on their watchlist');
        else if (!b.rating && !(cal && CAL[cal])) parts.push('watched, unrated');
        if (b.readCount > 1) parts.push(`watched ${b.readCount} times`);
        if (b.shelves.length) parts.push(`tags: ${b.shelves.slice(0, 4).join(', ')}`);
        return `- ${b.title}${b.year ? ` (${b.year})` : ''}${b.author ? ` - dir. ${b.author}` : ''}: ${parts.join(', ')}`;
      },
      howToRead: (scale) =>
        `How to read their history: ratings are out of 5 in half stars.${
          scale.n ? ` Their own average is ${scale.mean.toFixed(1)}, so judge each rating against it: well above marks a standout, well below a dislike.` : ''
        } A heart or a profile favourite is a strong positive. A film watched without a rating is a mild positive.`,
      libraryHeader: (shown, total) => `Their Letterboxd films (${shown === total ? `${total} films` : `the ${shown} most telling of ${total} films`}):`,
      wanted: 'added it to their watchlist',
      already: 'had already seen it',
      bingeHeader: 'Viewing binges (several films by one director in a short stretch)',
    },
  };
})();
