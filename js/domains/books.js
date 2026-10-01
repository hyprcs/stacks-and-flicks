/* Books: a Goodreads export matched on Open Library.

   A domain supplies everything the shared engine can't know: the import, the metadata source,
   the tag vocabulary, how much each kind of evidence counts, scoring constants, and the words on
   screen. See domains/films.js for the other one and domain.js for how the active one is chosen. */
(function () {
  const { html, clamp, normTitle, normAuthor, plural } = DQ.util;

  // Finishing a book is itself the vote: books take hours, so a finished one is a book you liked.
  // A rating never drops a finished book below that; ratings above your own average lift the
  // standouts (5★ from someone who averages 4.3★ is a smaller step up than from a 3.5★ rater).
  // Only 1-2★ (an explicit thumbs-down) count against a book.
  const FINISHED = 0.7;
  const TO_READ = 0.25;
  const CALIB_W = { loved: 1.0, liked: FINISHED, ok: FINISHED, disliked: -0.6 };
  const EVENT_W = { want: 0.6, pass: -0.45, skip: -0.03, loved: 1.0, liked: FINISHED, ok: FINISHED, disliked: -0.6 };

  function ratedWeight(rating, mean) {
    if (rating <= 1) return -0.9;
    if (rating === 2) return -0.5;
    return clamp(FINISHED + 0.35 * (rating - mean), FINISHED, 1.0);
  }

  function libraryWeight(b, calib, scale) {
    const c = calib[b.gid];
    if (c && CALIB_W[c] != null) return { w: CALIB_W[c], basis: c };
    if (b.rating) return { w: ratedWeight(b.rating, scale.mean), basis: `${b.rating}★` };
    const shelves = b.shelves.join(' ');
    if (/\b(dnf|did-not-finish|abandon|gave-up|unfinished|couldnt-finish)/.test(shelves)) return { w: -0.6, basis: 'dnf' };
    if (/favou?rite|all-time|best-of|loved/.test(shelves)) return { w: 1.0, basis: 'favourite' };
    if (b.exclusive === 'read') return b.readCount > 1 ? { w: 0.95, basis: 're-read' } : { w: FINISHED, basis: 'finished' };
    if (b.exclusive === 'currently-reading') return { w: 0.45, basis: 'reading' };
    if (b.exclusive === 'to-read') return { w: TO_READ, basis: 'to-read' };
    return { w: 0.25, basis: b.exclusive };
  }

  const JUNK_TITLE = /\b(summary|study guide|sparknotes|cliffs ?notes|monarch notes|book notes|critical commentary|analysis of|companion to|reader'?s guide|teacher'?s guide|boxed set|box set|collection set|books? \d+\s*[-–]\s*\d+|\d+ books? in one|coloring book|calendar|quiz book|workbook)\b/i;

  const lastName = (a) => normAuthor(a || '').split(' ').pop();

  function goodreadsUrl(book) {
    if (book.grId) return `https://www.goodreads.com/book/show/${book.grId}`;
    const q = [book.title, (book.authors || [book.author])[0]].filter(Boolean).join(' ');
    return `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
  }

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const CAL = { loved: 'loved it', liked: 'liked it', ok: 'it was OK', disliked: "didn't like it" };

  DQ.domains = DQ.domains || {};
  DQ.domains.books = {
    id: 'books',
    label: 'Books',
    icon: 'book',
    source: DQ.ol,
    vocab: DQ.bookSubjects,
    umbrellaTag: 'in translation', // origin tag that covers all the more specific traditions

    // ---------- words ----------
    w: {
      item: 'book', items: 'books', Items: 'Books',
      creator: 'author', creators: 'authors', Creators: 'Authors',
      by: 'by',
      done: 'read', // participle: "books you've read", "already read"
      did: 'read', // past: "Because you read X"
      does: 'read', // present: "You read in binges"
      Did: 'Read', // "Read Mar 2024"
      logged: 'Shelved',
      seenIt: 'Read it', seen: 'Read', seenHint: 'read it',
      wishlist: 'Want to Read', wishlistRef: 'Want to Read', onWishlist: 'On your list', wishShort: 'to-read', wishHint: 'want to read',
      wishTab: 'Want<span class="long">&nbsp;to Read</span>',
      activity: 'reading', Activity: 'Reading',
      audience: 'reader', binger: 'reader',
      library: 'shelves', inLibrary: 'on your shelf', onLibrary: 'on your shelves',
      reads: 'reads',
      pickUp: 'pick up',
      source: 'Open Library', service: 'Goodreads',
      ratings: 'ratings', wtr: 'want to read',
    },
    t: {
      profileTitle: 'What your shelves say about you',
      rareHead: 'Rarely on your shelves',
      analyzeTitle: 'Reading your shelves…',
      matchDetail: 'Subjects, covers and duplicate editions',
      matchFallback: 'author and date',
      baselineStep: 'Learn what a typical reader reads',
      baselineDetail: 'Sampling the 300 most-shelved books',
      noDesc: "No description on Open Library yet. The themes below are what it's catalogued under.",
      foreign: 'fiction in translation or from outside the English-speaking world',
      dateBasis: 'original publication date',
      dates: 'publication dates',
      lengthNoun: 'Page counts',
      themeExample: 'e.g. cosmic horror, Russian literature',
      calibSkip: 'Skip (counts as liked)',
      calibIntro: html`Every book you finished already counts as one you liked, so there's no need to rate them all.
        Tap <b>Loved it</b> for the ones that really stuck and <b>Didn't like it</b> for the ones you pushed through;
        skip the rest. Stop whenever you like.`,
      aiPitch: `Have an AI model read your whole shelf and suggest books the subject tags can't find:
        it picks up tone, style and why you liked something.`,
      eraseConfirm: 'Erase all your book data on this device, including your imported library and Want to Read list? Your film data is kept.',
      summaryLine(lib) {
        const s = DQ.csv.librarySummary(lib);
        return `${plural(s.total, 'book')} · ${s.read} read · ${s.toRead} want-to-read · ${s.rated} rated`;
      },
      ratingPattern(model, { rated, calibrated, unrated }) {
        return html`Every book you finished counts as one you liked${
          rated ? html`; ratings above your own average of <b>${model.scale.mean.toFixed(1)}★</b> mark the standouts, and only 1–2★ count against a book` : ''
        }${calibrated ? html`, plus <b>${calibrated}</b> marked here` : ''}. ${
          calibrated < 3 && unrated > 5 ? html`<a href="#/calibrate">Mark your standouts and duds</a> to sharpen things.` : ''
        }`;
      },
    },

    // ---------- evidence ----------
    libraryWeight,
    CALIB_W,
    EVENT_W,
    ratingPrior: 3.9, // a typical Goodreads average, for shrinking a light rater's mean
    binge: { min: 3, days: 125, date: (b) => b.dateRead || b.dateAdded },

    // ---------- scoring ----------
    quality: { prior: 3.9, spread: 0.3, m: 8 }, // Bayesian rating: prior mean, spread per point, prior weight
    popCenter: 1.8, // log10 of a middling want-to-read count
    minPop: 3, // shelvings below which a record is a phantom duplicate
    explorePop: 15,
    hugePop: 1500,
    isGem: (doc, bayes) => doc.wtr < 80 && bayes >= 4.0 && doc.ratingCount >= 3,
    classicYear: 1950,
    length: {
      edges: [0, 200, 350, 500, 700],
      labels: ['Under 200 pages', '200–350', '350–500', '500–700', '700+'],
      axis: ['<200', '200–350', '350–500', '500–700', '700+'],
      long: 420,
      short: 230,
      label: (p) => `${p} pages`,
    },
    sequelRe: /\b(book|bk\.?|vol\.?|volume|part|#)\s*([2-9]|1\d)\b/i,
    junk: (doc) => JUNK_TITLE.test(doc.title),
    titleKey: (title, author) => normTitle(title) + '|' + lastName(author),
    poolMax: 1600,

    // ---------- candidate queries (Open Library search syntax) ----------
    q: {
      subject: (form) => `subject:"${form.replace(/"/g, '')}"`,
      author: (key) => `author_key:${key}`,
      similar: null,
    },
    pageSize: (type) => (type === 'author' ? 30 : 40),

    // ---------- presentation ----------
    coverUrl: (id, size = 'L') => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null),
    links: (doc) => [
      { label: 'Goodreads', url: goodreadsUrl(doc) },
      { label: 'Open Library', url: `https://openlibrary.org${doc.key}` },
    ],

    // ---------- How it works ----------
    how: {
      title: 'How Stacks picks your next book',
      intro: `Stacks reads your Goodreads export, works out what you respond to compared with a typical reader, and
        searches Open Library around every side of your taste. Each queue mixes strong matches with a few
        exploration picks, and every choice you make retunes what comes next.`,
      steps: [
        { icon: 'book', title: 'Matching', text: 'Every book is matched on Open Library by ISBN, then by title and author. Duplicate records are merged, thin records borrow subjects from their author, and messy subject headings are cleaned into one tag vocabulary.' },
        { icon: 'star', title: 'Signals', text: 'Finishing a book is itself the vote, because books take hours: every finished book counts as one you liked. Ratings above your own average lift the standouts, and only 1–2★ count against a book. Re-reads, favourites and DNF shelves, recency and reading binges add or subtract.' },
        { icon: 'compass', title: 'Compared with a typical reader', text: 'Your tags are measured against the 300 most-shelved books, so "science fiction" only counts for as much as you read more of it than most people do, and themes you never touch are gently avoided.' },
        { icon: 'layers', title: 'The sides of your taste', text: 'Books you like are clustered into facets, such as cosy mysteries or Russian classics. Searches cover every facet and each queue saves room for each one, so one binge can’t take over.' },
        { icon: 'spark', title: 'Finding candidates', text: 'Open Library searches run on your strongest themes, pairs of themes you love together, each facet and your favourite authors, plus a few exploratory searches near your taste.' },
        { icon: 'check', title: 'Picking a queue', text: 'Candidates are scored, then chosen for variety: one book per author, only the first book of a series you haven’t started, a quality floor, and a few exploration picks where the model knows little.' },
        { icon: 'refresh', title: 'Learning', text: 'Want to Read, pass, read and skip update the model at once and re-pick the rest of the queue. Your Taste shows what it believes and lets you correct it.' },
      ],
      privacy: [
        'Your library, queue and learning are stored only in this browser.',
        'Book titles and ISBNs go to Open Library; Google Books is asked for the occasional missing description.',
        'With AI picks on, your book list, ratings and reactions go to the AI service you choose, only when a batch is requested.',
      ],
    },

    // ---------- AI picks, explained for someone new to all this (views/connect.js) ----------
    guide: {
      title: 'Add a well-read friend to your queue',
      intro: `Stacks finds books by matching catalogue tags. Connect an AI model and it also gets a second opinion from
        something that has read about nearly every book there is, and can tell why you liked the ones you did.`,
      benefits: [
        { icon: 'heart', title: 'It gets why you liked something', text: 'A tag can say a book is “science fiction”. An AI model can tell that what you loved was the dry humour, the slow-burn dread or the narrator you couldn’t trust, and go looking for that.' },
        { icon: 'compass', title: 'It finds what tags can’t', text: 'Books from another genre, another country or another century that feel like your favourites, even though no catalogue files them together.' },
        { icon: 'book', title: 'Every pick comes with a reason', text: 'Each suggestion says, in a sentence or two, which of your own books it follows from, so you can judge it before you read a page.' },
        { icon: 'user', title: 'It describes your taste back to you', text: 'You also get a short portrait of yourself as a reader, in plain words, on Your Taste.' },
      ],
      sends: 'your book titles and authors, your ratings and shelves, and how you reacted to earlier picks',
      notSent: 'Your name, email and anything else on your Goodreads account are never part of it.',
      metaphor: {
        lead: 'Think of AI models as booksellers.',
        text: `They all want to help, but they haven’t all read the same amount. A bigger model has “read” more and
          notices more, and it costs more each time you ask.`,
        levels: {
          light: { name: 'The weekend temp', text: 'Friendly, fast and nearly free. Knows the bestseller table and the books everyone read at school. Ask for something like your favourite obscure novel and you’ll get the famous book next to it, and now and then a title that sounds right but doesn’t exist.' },
          solid: { name: 'The career bookseller', text: 'Has read widely: translated fiction, small presses, the backlist. Usually sees what you’re after and hands you things you hadn’t heard of. The sweet spot for most people.' },
          deep: { name: 'The owner who has read everything', text: 'Remembers what you bought three years ago and why you loved it. Spots the thread running through your shelves (unreliable narrators, say, rather than just “mysteries”), reaches for the deep cuts, and tells you exactly why each one is for you.' },
        },
        rows: [
          ['How far off the beaten path', 'Mostly well-known books', 'Well-known books and hidden gems', 'Deep cuts: older, translated, half-forgotten'],
          ['Made-up titles', 'Now and then', 'Rare', 'Very rare'],
          ['The reasons it gives', 'General: “you like fantasy”', 'Tied to books you rated highly', 'Tied to why you liked them'],
        ],
      },
    },

    // ---------- import / export ----------
    landing: {
      title: html`Your Goodreads shelf, turned into a <em>discovery queue</em>.`,
      intro: `Drop in your library export and step through books picked for you, one at a time, like Steam's
        discovery queue. It maps the different sides of your taste, explains every pick, and gets sharper
        with each book you keep or pass on.`,
      dropTitle: 'Drop your Goodreads export here',
      dropHint: html`or click to choose <code>goodreads_library_export.csv</code>`,
      accept: '.csv,text/csv',
      multiple: false,
      localFile: 'goodreads_library_export.csv',
      howto: [
        html`On Goodreads, open <b>My Books</b> and choose <b>Import and export</b> in the left sidebar.`,
        html`Click <b>Export Library</b>, wait for the link, and download the CSV.`,
        html`Drop it above. Ratings, shelves, re-reads and dates all feed your taste profile.`,
      ],
      privacy: `Everything runs in your browser and is saved only on this device.
        Book titles and ISBNs are sent to Open Library to look up subjects and covers. Nothing else leaves your computer.`,
    },
    async parseFiles(files) {
      return DQ.csv.parseGoodreads(await files[0].text());
    },
    // Columns Goodreads' importer (My Books → Import and export) understands; everything lands on to-read.
    exportWishlist(list) {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
      const rows = [['Title', 'Author', 'ISBN', 'ISBN13', 'My Rating', 'Original Publication Year', 'Date Added', 'Bookshelves', 'Exclusive Shelf']];
      for (const w of list) {
        const d = w.doc;
        const isbn13 = d.isbn && d.isbn.length === 13 ? d.isbn : '';
        const isbn10 = d.isbn && d.isbn.length === 10 ? d.isbn : '';
        rows.push([d.title, d.authors?.[0] || '', isbn10, isbn13, 0, d.year || '', today, 'to-read', 'to-read']);
      }
      return {
        csv: rows.map((r) => r.map(csvCell).join(',')).join('\r\n'),
        filename: 'stacks_want_to_read.csv',
        note: html`Saved <b>stacks_want_to_read.csv</b>. On Goodreads use <b>My Books → Import and export</b> to add them to your to-read shelf.`,
      };
    },

    // ---------- AI assist ----------
    ai: {
      creatorField: 'author',
      preferModelNames: true, // "Arkady Strugatsky" reads better than catalogue transliteration
      system: `You help a reader find their next books. You'll get their Goodreads library (ratings, shelves, re-reads), any quick ratings they gave, and how they reacted to recent recommendations. Work out what they actually respond to - themes, tone, style, ideas, era, literary tradition - beyond surface genre, then recommend real published books they haven't read or shelved.

Guidelines:
- Recommend only books you are confident exist. Use the author's usual name in English and the English title for translated books.
- Skip anything in their library or on the already-suggested list. For a series they haven't started, suggest the first volume.
- Spread the picks across the different sides of their taste. Make about one in five a deliberate stretch into adjacent territory and mark it with "stretch": true.
- "why" is one or two sentences addressed to the reader ("you") that ties the book to specific books or reactions of theirs.
- "facet" names which side of their taste the pick serves, using the names you give in "facets".
- "taste_summary" is three to five specific sentences addressed to the reader.

Reply with a single JSON object and nothing else, shaped like:
{"taste_summary": "...", "facets": [{"name": "...", "description": "..."}], "recommendations": [{"title": "...", "author": "...", "year": 1965, "why": "...", "facet": "...", "stretch": false}]}`,
      score: (b, calib) =>
        (b.rating ? 3 : 0) + (calib && calib !== 'skip' ? 3 : 0) + (b.readCount > 1 ? 2 : 0) +
        (b.exclusive === 'to-read' ? 0 : 1) + ((b.dateRead || b.dateAdded || 0) / 1e13),
      line(b, cal) {
        const parts = [];
        if (b.rating) parts.push(`${b.rating}/5`);
        else if (cal && CAL[cal]) parts.push(CAL[cal]);
        if (/\b(dnf|did-not-finish|abandon)/.test(b.shelves.join(' '))) parts.push('did not finish');
        if (b.exclusive === 'to-read') parts.push('want to read');
        else if (b.exclusive === 'currently-reading') parts.push('reading now');
        else if (!b.rating && !(cal && CAL[cal])) parts.push('finished');
        if (b.readCount > 1) parts.push(`read ${b.readCount} times`);
        const custom = b.shelves.filter((s) => !/^(to-read|read|currently-reading)$/.test(s));
        if (custom.length) parts.push(`shelves: ${custom.slice(0, 4).join(', ')}`);
        return `- ${b.title}${b.series ? ` (${b.series}${b.seriesNum ? ' #' + b.seriesNum : ''})` : ''} - ${b.author}${b.year ? ` (${b.year})` : ''}: ${parts.join(', ')}`;
      },
      howToRead: (scale) =>
        `How to read their shelf: finishing a book is itself a strong positive signal (books take hours), so treat "finished" as "liked".${
          scale.n ? ` A rating never makes a finished book count less; ratings above their own average of ${scale.mean.toFixed(1)} out of 5 mark real standouts, and only 1-2 stars mean they disliked it.` : " They don't rate books."
        }`,
      libraryHeader: (shown, total) => `Their library (${shown === total ? `${total} books` : `the ${shown} most telling of ${total} books`}):`,
      wanted: 'wanted it',
      already: 'had already read it',
      bingeHeader: 'Reading binges (a strong sign of love, even when unrated)',
    },
  };
})();
