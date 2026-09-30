/* Goodreads "Export Library" CSV -> normalised library records. */
(function () {
  const { splitSeries } = DQ.util;

  // RFC 4180 parser: quoted fields, escaped quotes, embedded newlines, CRLF.
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
  }

  const cleanIsbn = (s) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const int = (s) => {
    const n = parseInt(String(s || '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };
  function date(s) {
    const m = String(s || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const REQUIRED = ['Title', 'Author', 'Exclusive Shelf'];

  function parseGoodreads(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('That file looks empty.');
    const header = rows[0].map((h) => h.trim());
    const missing = REQUIRED.filter((h) => !header.includes(h));
    if (missing.length) {
      throw new Error(
        `This doesn't look like a Goodreads library export (missing ${missing.join(', ')}). ` +
          'On Goodreads go to My Books → Import and export → Export Library.'
      );
    }
    const col = Object.fromEntries(header.map((h, i) => [h, i]));
    const get = (r, name) => (col[name] == null ? '' : r[col[name]] ?? '');

    const seen = new Set();
    const books = [];
    for (const r of rows.slice(1)) {
      const rawTitle = collapse(get(r, 'Title'));
      const author = collapse(get(r, 'Author'));
      if (!rawTitle) continue;
      const gid = String(get(r, 'Book Id') || rawTitle + '|' + author).trim();
      if (seen.has(gid)) continue;
      seen.add(gid);

      const { title, series, seriesNum } = splitSeries(rawTitle);
      const shelves = String(get(r, 'Bookshelves'))
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const exclusive = collapse(get(r, 'Exclusive Shelf')).toLowerCase() || 'read';
      const year = int(get(r, 'Year Published'));

      books.push({
        gid,
        title,
        fullTitle: rawTitle,
        series,
        seriesNum,
        author,
        additionalAuthors: collapse(get(r, 'Additional Authors')),
        isbn: cleanIsbn(get(r, 'ISBN')),
        isbn13: cleanIsbn(get(r, 'ISBN13')),
        rating: Math.max(0, Math.min(5, Math.round(parseFloat(get(r, 'My Rating')) || 0))),
        pages: int(get(r, 'Number of Pages')),
        year: int(get(r, 'Original Publication Year')) || year,
        dateRead: date(get(r, 'Date Read')),
        dateAdded: date(get(r, 'Date Added')),
        shelves,
        exclusive,
        readCount: int(get(r, 'Read Count')),
        hasReview: !!collapse(get(r, 'My Review')),
      });
    }
    if (!books.length) throw new Error('No books found in that export.');
    return books;
  }

  function librarySummary(books) {
    const by = (s) => books.filter((b) => b.exclusive === s).length;
    return {
      total: books.length,
      read: by('read'),
      toRead: by('to-read'),
      reading: by('currently-reading'),
      rated: books.filter((b) => b.rating > 0).length,
    };
  }

  DQ.csv = { parseCSV, parseGoodreads, librarySummary };
})();
