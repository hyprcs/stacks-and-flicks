/* Open Library client: search, library matching, candidate queries, descriptions.
   Open Library is free, keyless and CORS-enabled, so everything runs in the browser. */
(function () {
  const { pLimit, sleep, isLatin, normTitle, normAuthor, stripDiacritics, titleCase } = DQ.util;
  const S = DQ.bookSubjects;

  const BASE = 'https://openlibrary.org';
  const limit = pLimit(4);

  const FIELDS = [
    'key', 'title', 'author_name', 'author_key', 'author_alternative_name', 'first_publish_year', 'subject',
    'cover_i', 'ratings_average', 'ratings_count', 'want_to_read_count', 'already_read_count',
    'number_of_pages_median', 'edition_count', 'id_goodreads', 'editions', 'editions.title',
    'editions.cover_i', 'editions.isbn',
  ].join(',');

  class HttpError extends Error {}

  async function getJSON(url, { timeout = 20000, retries = 2 } = {}) {
    return limit(async () => {
      for (let attempt = 0; ; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        let retryable = true;
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (res.ok) return await res.json();
          if (res.status === 404) return null;
          retryable = res.status === 429 || res.status >= 500;
          throw new HttpError(`Open Library returned ${res.status}`);
        } catch (e) {
          if (!retryable || attempt >= retries) throw e;
        } finally {
          clearTimeout(timer);
        }
        await sleep(800 * 2 ** attempt + Math.random() * 500);
      }
    });
  }

  async function search(params) {
    const qs = new URLSearchParams({ fields: FIELDS, ...params });
    const data = await getJSON(`${BASE}/search.json?${qs}`);
    return { docs: data?.docs || [], numFound: data?.numFound || 0 };
  }

  // Non-Latin primary names (e.g. 村上春樹) get the most common Latin spelling from the alternates.
  function authorNames(d) {
    const names = d.author_name || [];
    let latinAlt;
    const pickAlt = () => {
      if (latinAlt !== undefined) return latinAlt;
      const counts = new Map();
      for (const a of d.author_alternative_name || []) {
        if (!isLatin(a) || !/[a-z]/.test(a) || !/\S\s+\S/.test(a.trim())) continue;
        const k = normAuthor(a);
        const e = counts.get(k) || { name: a.trim(), c: 0 };
        e.c++;
        counts.set(k, e);
      }
      latinAlt = [...counts.values()].sort((a, b) => b.c - a.c)[0]?.name || null;
      return latinAlt;
    };
    return names.map((n) => (isLatin(n) ? n : pickAlt() || n).split(';')[0].trim());
  }

  // Series name/number from titles like "Catching Fire (The Hunger Games, #2)",
  // "Catching Fire (The Hunger Games Series Book 2)" or "Mockingjay Bk. 3".
  function seriesFromTitle(t) {
    const paren = String(t).match(/[([]([^()[\]]*?)[,:]?\s*(?:#|book|bk\.?|vol\.?|volume|part)\s*(\d+(?:\.\d+)?)\s*[)\]]\s*$/i);
    if (paren) {
      const name = paren[1].replace(/^the\s+/i, '').replace(/\s+(series|trilogy|saga|cycle|sequence)$/i, '').trim().toLowerCase();
      return { name: name || null, num: parseFloat(paren[2]) };
    }
    const bare = String(t).match(/\b(?:book|bk\.?|vol\.?|volume)\s*(\d+)\s*$/i);
    return bare ? { name: null, num: parseFloat(bare[1]) } : { name: null, num: null };
  }

  // "Catching Fire (The Hunger Games Series Book 2)" -> "Catching Fire"
  const cleanTitle = (t) =>
    String(t || '')
      .replace(/\s*[([][^()[\]]*\b(book|bk\.?|vol\.?|volume|series|trilogy|saga|cycle|chronicles?|#)\s*[\d.]*[^()[\]]*[)\]]\s*$/i, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .trim();

  function pickIsbn(list) {
    if (!list?.length) return null;
    return list.find((i) => /^97[89]\d{10}$/.test(i)) || list[0];
  }

  // Search doc -> the compact shape the rest of the app uses.
  function compact(d, { keepRaw = false } = {}) {
    const ed = d.editions?.docs?.[0] || {};
    let title = d.title || ed.title || '';
    // With lang=en the edition is the English one: use its title when it's a translation
    // ("Wieża jaskółki" -> "The Tower of Swallows"), but keep the work's nicer casing otherwise.
    if (ed.title && isLatin(ed.title) && (!isLatin(title) || normTitle(ed.title) !== normTitle(title))) title = ed.title;
    // Catalogue-style sentence case ("The moon is a harsh mistress") -> title case.
    if (isLatin(title) && /^[A-Z0-9][^A-Z]*$/.test(title) && title.split(/s+/).length >= 3) title = titleCase(title.toLowerCase());
    const norm = S.normalize(d.subject);
    // Books about their own author ("Virginia Woolf") aren't a theme.
    const authorNorms = (d.author_name || []).map(normAuthor).filter((a) => a.length > 4);
    norm.tags = norm.tags.filter((t) => !authorNorms.some((a) => normAuthor(t).includes(a)));
    const fromTitle = [d.title, ed.title].map(seriesFromTitle).find((x) => x.num != null) || { name: null, num: null };
    const doc = {
      key: d.key,
      title: cleanTitle(title) || title,
      series: norm.series || fromTitle.name,
      seriesNum: fromTitle.num,
      authors: authorNames(d).slice(0, 2),
      authorKeys: (d.author_key || []).slice(0, 2),
      year: d.first_publish_year || null,
      tags: norm.tags,
      nonbook: norm.nonbook,
      cover: d.cover_i || ed.cover_i || null,
      rating: d.ratings_average ? Math.round(d.ratings_average * 100) / 100 : 0,
      ratingCount: d.ratings_count || 0,
      wtr: d.want_to_read_count || 0,
      readers: d.already_read_count || 0,
      pages: d.number_of_pages_median || 0,
      editions: d.edition_count || 0,
      grId: (d.id_goodreads || [])[0] || null,
      grIds: (d.id_goodreads || []).slice(0, 20),
      isbn: pickIsbn(ed.isbn),
    };
    if (keepRaw) doc.raw = norm.raw;
    return doc;
  }

  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const lastName = (a) => normAuthor(a).split(' ').pop();

  function authorMatches(book, d) {
    const ln = lastName(book.author);
    if (!ln) return true;
    const pool = [...(d.author_name || []), ...(d.author_alternative_name || [])].map(normAuthor).join(' | ');
    return pool.includes(ln);
  }

  // All Open Library works that are this book (it often has several duplicate work records).
  async function sameWorks(book) {
    const t = normTitle(book.title);
    const matches = (docs) => docs.filter((d) => authorMatches(book, d) && normTitle(d.title) === t);
    let res = await search({ title: book.title.split(':')[0], author: book.author, limit: 8 });
    let found = matches(res.docs);
    if (!found.length) {
      res = await search({ q: `${stripDiacritics(t)} ${lastName(book.author)}`, limit: 8 });
      found = matches(res.docs);
      if (!found.length) {
        const loose = res.docs.find((d) => authorMatches(book, d) && (normTitle(d.title).includes(t) || t.includes(normTitle(d.title))));
        if (loose) found = [loose];
      }
    }
    return found.sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0));
  }

  // Fold duplicate works into one record: union of tags, all keys (for exclusion), best cover.
  function mergeWorks(primary, others) {
    const base = primary || compact(others[0], { keepRaw: true });
    const rest = (primary ? others : others.slice(1)).filter((d) => d.key !== base.key).map((d) => compact(d, { keepRaw: true }));
    const tags = new Set(base.tags);
    const out = { ...base, keys: [base.key], raw: { ...base.raw } };
    for (const c of rest) {
      c.tags.forEach((t) => tags.add(t));
      out.raw = { ...c.raw, ...out.raw };
      out.keys.push(c.key);
      out.cover ||= c.cover;
      out.series ||= c.series;
      out.wtr = Math.max(out.wtr, c.wtr);
      out.grIds = [...new Set([...out.grIds, ...c.grIds])].slice(0, 30);
    }
    out.tags = [...tags].slice(0, 45);
    return out;
  }

  /** Find the Open Library work for a title + author (English edition preferred), or null. */
  async function findWork(title, author) {
    const book = { title, author };
    const t = normTitle(title);
    // Translated books are often filed under the original title ("L'Étranger"): check the English edition's title too.
    const titles = (d) => [d.title, d.editions?.docs?.[0]?.title].filter(Boolean).map(normTitle);
    const ok = (d) => authorMatches(book, d) && !/(notes|study guide|summary|companion|analysis|criticism)/i.test(d.title);
    const pick = (docs) =>
      docs.find((d) => ok(d) && titles(d).includes(t)) ||
      docs.find((d) => ok(d) && titles(d).some((x) => x.includes(t) || t.includes(x)));
    let res = await search({ title: title.split(':')[0], author, lang: 'en', limit: 5 });
    let d = pick(res.docs);
    if (!d) {
      res = await search({ q: `${stripDiacritics(t)} ${lastName(author)}`, lang: 'en', limit: 8 });
      d = pick(res.docs);
    }
    return d ? compact(d) : null;
  }

  /** Match every library book to an Open Library work. onProgress(done, total, gid, doc). */
  async function lookupLibrary(books, onProgress) {
    const results = {};
    let done = 0;
    const settle = (b, doc) => {
      results[b.gid] = doc || { miss: true };
      done++;
      onProgress?.(done, books.length, b.gid, doc);
    };

    const byGid = {};
    const withIsbn = books.filter((b) => b.isbn13 || b.isbn);

    // ~20 ISBNs per request keeps a 60-book shelf to three calls.
    await Promise.all(
      chunk(withIsbn, 20).map(async (batch) => {
        const isbns = batch.flatMap((b) => [b.isbn13, b.isbn].filter(Boolean));
        let docs = [];
        try {
          docs = (await search({ q: `isbn:(${isbns.join(' OR ')})`, limit: 60 })).docs;
        } catch (e) {
          console.warn('ISBN batch failed', e);
        }
        const byIsbn = new Map();
        for (const d of docs) for (const e of d.editions?.docs || []) for (const i of e.isbn || []) byIsbn.set(i.toUpperCase(), d);
        for (const b of batch) {
          const d = byIsbn.get(b.isbn13) || byIsbn.get(b.isbn);
          if (d) byGid[b.gid] = compact(d, { keepRaw: true });
        }
      })
    );

    // Well-described ISBN matches are done; everything else gets a title/author search whose
    // duplicate works are merged in (thin records are common for translated fiction).
    const needSearch = [];
    for (const b of books) {
      const doc = byGid[b.gid];
      if (doc && doc.tags.length >= 5) settle(b, { ...doc, keys: [doc.key] });
      else needSearch.push(b);
    }
    await Promise.all(
      needSearch.map(async (b) => {
        let doc = byGid[b.gid] || null;
        try {
          const works = await sameWorks(b);
          if (works.length) doc = mergeWorks(doc, works);
        } catch (e) {
          console.warn('Lookup failed for', b.title, e);
        }
        settle(b, doc && (doc.keys ? doc : { ...doc, keys: [doc.key] }));
      })
    );

    // Still-thin records (common for translated classics) borrow their author's top subjects,
    // e.g. a Japanese novelist -> Japanese fiction, Japan, translations.
    const thin = books.filter((b) => !results[b.gid].miss && results[b.gid].tags.length < 3);
    const byAuthor = new Map();
    thin.forEach((b) => byAuthor.set(normAuthor(b.author), b));
    await Promise.all(
      [...byAuthor.values()].map(async (b) => {
        try {
          const tags = await authorSubjects(b.author, results[b.gid].authorKeys?.[0]);
          if (!tags.length) return;
          for (const t of thin) {
            if (normAuthor(t.author) !== normAuthor(b.author)) continue;
            const doc = results[t.gid];
            doc.tags = [...new Set([...doc.tags, ...tags])].slice(0, 45);
            doc.authorTagged = true;
          }
        } catch (e) {
          console.warn('Author subjects failed for', b.author, e);
        }
      })
    );
    return results;
  }

  // Forms and broad buckets are per-book, not per-author.
  const AUTHOR_TAG_SKIP = new Set(['history', 'biography', 'nonfiction', 'juvenile', 'short stories', 'poetry', 'essays', 'drama', 'young adult']);

  async function authorSubjects(name, key) {
    const qs = new URLSearchParams({ q: name, fields: 'key,name,top_subjects,work_count', limit: '5' });
    const data = await getJSON(`${BASE}/search/authors.json?${qs}`);
    const docs = data?.docs || [];
    const withSubjects = docs.filter((d) => d.top_subjects?.length);
    const pick =
      (key && withSubjects.find((d) => d.key === key || `/authors/${d.key}` === key)) ||
      withSubjects.sort((a, b) => (b.work_count || 0) - (a.work_count || 0))[0];
    if (!pick) return [];
    // Author-level subjects are broad; keep only the ones that say something about the writing
    // (tradition, genre, country) rather than e.g. "History".
    return S.normalize(pick.top_subjects)
      .tags.filter((t) => S.kind(t) !== 'theme' ? !AUTHOR_TAG_SKIP.has(t) : S.isPlace(t))
      .slice(0, 8);
  }

  /** Tag frequencies across the ~300 most-shelved English books: the "typical reader" baseline. */
  async function background() {
    const pages = await Promise.all(
      [0, 100, 200].map((offset) =>
        search({ q: 'language:eng', sort: 'readinglog', limit: 100, offset, fields: 'key,subject' })
          .then((r) => r.docs)
          .catch(() => [])
      )
    );
    const docs = pages.flat();
    const df = {};
    for (const d of docs) for (const t of S.normalize(d.subject, 80).tags) df[t] = (df[t] || 0) + 1;
    for (const t of Object.keys(df)) if (df[t] < 2) delete df[t];
    return docs.length >= 100 ? { n: docs.length, df, t: Date.now() } : null;
  }

  /** Candidate search, English editions. sort: 'popular' (most shelved) or 'rated' (best rated). */
  async function searchCandidates(q, { offset = 0, limit: n = 40, sort = 'popular' } = {}) {
    const res = await search({ q: `(${q}) AND language:eng`, sort: sort === 'rated' ? 'rating' : 'readinglog', lang: 'en', limit: n, offset });
    return {
      docs: res.docs.map((d) => compact(d)).filter((d) => d.key && d.title && d.authors.length),
      numFound: res.numFound,
    };
  }

  function cleanDescription(desc) {
    let s = typeof desc === 'string' ? desc : desc?.value || '';
    s = s.replace(/\r/g, '');
    s = s.split(/\n\s*-{3,}|\n\s*\*{3,}|\n\s*_{3,}/)[0];
    s = s.replace(/\(\s*\[source\]\[\d+\]\s*\)/gi, '');
    s = s.replace(/\[([^\]]+)\]\((?:https?:)?[^)]+\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\[\d+\]/g, '$1');
    s = s.replace(/^\s*\[\d+\]:.*$/gm, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '');
    s = s.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2');
    s = s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }

  // Google Books as a fallback blurb source (keyless, low volume: only for the card on screen).
  // Its anonymous quota is small, so one rate-limit switches it off for the session.
  let googleOff = false;
  async function googleDescription(isbn) {
    if (!isbn || googleOff) return '';
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&fields=items(volumeInfo(description))`;
      const res = await fetch(url);
      if (res.status === 429 || res.status === 403) googleOff = true;
      if (!res.ok) return '';
      const data = await res.json();
      return cleanDescription(data.items?.[0]?.volumeInfo?.description || '');
    } catch {
      return '';
    }
  }

  const EN = /(the|and|of|to|is|in|with|his|her|that|was)/gi;
  const FOREIGN = /(le|la|les|des|et|une|est|dans|der|die|das|und|ist|ein|eine|el|los|las|del|y|una|che|il|della|di)/gi;
  const looksEnglish = (s) => (s.match(EN) || []).length >= (s.match(FOREIGN) || []).length;

  const inflight = new Map();
  /** Description for a work, cached in state.works. */
  function description(doc) {
    const cached = DQ.state.works[doc.key];
    if (cached) return Promise.resolve(cached.desc);
    if (inflight.has(doc.key)) return inflight.get(doc.key);
    const p = (async () => {
      let desc = '';
      try {
        const w = await getJSON(`${BASE}${doc.key}.json`, { retries: 1 });
        desc = cleanDescription(w?.description);
      } catch {}
      // Missing, stubby or not in English (Open Library often has the original-language blurb): try Google Books.
      if (desc.length < 40 || !looksEnglish(desc)) {
        const g = await googleDescription(doc.isbn);
        if (g && (looksEnglish(g) || desc.length < 40)) desc = g;
      }
      DQ.state.works[doc.key] = { desc, t: Date.now() };
      DQ.store.save('works');
      DQ.store.pruneWorks();
      return desc;
    })().finally(() => inflight.delete(doc.key));
    inflight.set(doc.key, p);
    return p;
  }

  DQ.ol = { search, lookupLibrary, searchCandidates, description, compact, background, findWork };
})();
