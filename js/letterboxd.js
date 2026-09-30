/* Letterboxd export (the ZIP from Settings → Data → Export your data, or the CSVs inside it)
   -> library records shaped like the Goodreads ones, so the shared taste model reads both.

   Films are joined on name + year: diary and review rows link to the diary entry rather than the
   film, so their Letterboxd URIs don't match the ones in watched.csv. Only the Favorite Films column
   is read from profile.csv; the rest of it (email, name, bio) is ignored. */
(function () {
  const { parseCSV } = DQ.csv;
  const { stripDiacritics } = DQ.util;

  const FILES = {
    watched: /(^|\/)watched\.csv$/,
    ratings: /(^|\/)ratings\.csv$/,
    diary: /(^|\/)diary\.csv$/,
    reviews: /(^|\/)reviews\.csv$/,
    watchlist: /(^|\/)watchlist\.csv$/,
    likes: /(^|\/)(likes\/)?films\.csv$/,
    profile: /(^|\/)profile\.csv$/,
  };
  // likes/ also holds liked reviews and lists; only likes/films.csv is about films.
  const SKIP_DIR = /(^|\/)((deleted|orphaned|lists)\/|likes\/(?!films\.csv$))/;
  const wanted = (name) => {
    const n = name.replace(/\\/g, '/').toLowerCase();
    return !SKIP_DIR.test(n) && Object.values(FILES).some((re) => re.test(n));
  };

  function table(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  const int = (s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };
  function date(s) {
    const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }
  const max = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
  const min = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
  const filmKey = (r) => stripDiacritics(r.Name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + int(r.Year);
  const cleanUri = (u) => (/boxd\.it\//.test(u || '') ? u.replace(/^https?:\/\//, '') : null);

  /** [{ name, text }] -> library records. Throws with a helpful message on the wrong kind of file. */
  function parseLetterboxd(files) {
    const t = {};
    for (const f of files) {
      const n = f.name.replace(/\\/g, '/').toLowerCase();
      if (SKIP_DIR.test(n)) continue;
      for (const [k, re] of Object.entries(FILES)) if (!t[k] && re.test(n)) t[k] = table(f.text);
    }
    if (!t.watched && !t.ratings && !t.diary && !t.watchlist) {
      throw new Error(
        "This doesn't look like a Letterboxd export (no watched.csv, ratings.csv, diary.csv or watchlist.csv). " +
          'On Letterboxd go to Settings → Data → Export your data, then drop the ZIP here.'
      );
    }

    const films = new Map();
    const film = (r) => {
      if (!r.Name) return null;
      const k = filmKey(r);
      let f = films.get(k);
      if (!f) {
        f = { key: k, title: r.Name, year: int(r.Year), uri: null, watched: false, listed: false, rating: 0, diaryRating: 0,
          entries: 0, rewatch: false, watchedAt: null, loggedAt: null, listedAt: null, tags: new Set(), liked: false };
        films.set(k, f);
      }
      return f;
    };
    // Film URIs come from the film-level files; diary/review URIs point at entries.
    const filmUri = (f, r) => (f.uri ||= cleanUri(r['Letterboxd URI']));

    for (const r of t.watched || []) {
      const f = film(r);
      if (!f) continue;
      f.watched = true;
      filmUri(f, r);
      f.loggedAt = min(f.loggedAt, date(r.Date));
    }
    for (const r of t.ratings || []) {
      const f = film(r);
      if (!f) continue;
      f.watched = true;
      filmUri(f, r);
      f.rating = parseFloat(r.Rating) || 0;
      f.loggedAt = min(f.loggedAt, date(r.Date));
    }
    for (const r of t.diary || []) {
      const f = film(r);
      if (!f) continue;
      f.watched = true;
      f.entries++;
      if (/^y/i.test(r.Rewatch)) f.rewatch = true;
      f.watchedAt = max(f.watchedAt, date(r['Watched Date']) || date(r.Date));
      if (!f.diaryRating && r.Rating) f.diaryRating = parseFloat(r.Rating) || 0;
      String(r.Tags || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((tag) => f.tags.add(tag));
    }
    for (const r of t.reviews || []) {
      const f = film(r);
      if (!f) continue;
      f.watched = true;
    }
    // Hearting a film on Letterboxd also marks it watched.
    for (const r of t.likes || []) {
      const f = film(r);
      if (!f) continue;
      f.watched = f.liked = true;
      filmUri(f, r);
    }
    for (const r of t.watchlist || []) {
      const f = film(r);
      if (!f) continue;
      f.listed = true;
      filmUri(f, r);
      f.listedAt = min(f.listedAt, date(r.Date));
    }

    const favourites = new Set(
      String(t.profile?.[0]?.['Favorite Films'] || '').split(/[\s,]+/).map(cleanUri).filter(Boolean)
    );

    // Same field names as Goodreads rows (the shared model reads both), kept lean: a big diary is
    // thousands of rows in localStorage.
    const out = [];
    for (const f of films.values()) {
      const row = {
        gid: f.uri ? f.uri.replace('boxd.it/', 'lb:') : `lb:${f.key}`,
        title: f.title,
        author: '', // the director, filled in from TMDB after matching
        rating: f.rating || f.diaryRating || 0, // 0.5–5 in half stars
        pages: 0, // runtime in minutes, filled in from TMDB
        year: f.year,
        // Only diary dates say when a film was actually watched; bulk-logged history shares one date.
        dateRead: f.watchedAt,
        dateAdded: f.watched ? f.loggedAt || f.watchedAt : f.listedAt,
        shelves: [...f.tags],
        exclusive: f.watched ? 'read' : 'to-read',
        readCount: f.watched ? Math.max(1, f.entries, f.rewatch ? 2 : 1) : 0,
      };
      if (f.liked) row.liked = true;
      if (f.uri && favourites.has(f.uri)) row.favorite = true;
      out.push(row);
    }
    if (!out.length) throw new Error('No films found in that export.');
    return out;
  }

  function librarySummary(films) {
    const watched = films.filter((b) => b.exclusive === 'read');
    return {
      total: films.length,
      watched: watched.length,
      watchlist: films.length - watched.length,
      rated: watched.filter((b) => b.rating > 0).length,
      liked: watched.filter((b) => b.liked).length,
      favorites: films.filter((b) => b.favorite).length,
    };
  }

  /** Files the user dropped (a ZIP, or loose CSVs) -> [{ name, text }] worth parsing. */
  async function readFiles(fileList) {
    const out = [];
    for (const file of fileList) {
      if (/\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
        out.push(...(await DQ.zip.readText(await file.arrayBuffer(), wanted)));
      } else if (/\.csv$/i.test(file.name)) {
        out.push({ name: file.webkitRelativePath || file.name, text: await file.text() });
      }
    }
    return out;
  }

  DQ.letterboxd = { parseLetterboxd, librarySummary, readFiles, wanted };
})();
