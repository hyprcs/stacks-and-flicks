/* Open Library subjects are crowd-entered and messy ("Fiction, science fiction,
   general", "Japan -- Social life and customs -- Fiction", "Protected DAISY").
   This turns them into a clean, canonical tag vocabulary. */
(function () {
  const { titleCase } = DQ.util;

  // Pure noise: library/format metadata, generic buckets.
  const DROP = new Set([
    'fiction', 'general', 'novel', 'novels', 'literature', 'fiction in english', 'english language',
    'accessible book', 'protected daisy', 'in library', 'lending library', 'large type books',
    'large print books', 'popular print disabled books', 'internet archive wishlist', 'open library staff picks',
    'readers', 'reading materials', 'textual', 'english', 'american', 'books and reading', 'overdrive',
    'ebook', 'ebooks', 'electronic books', 'audiobook', 'audiobooks', 'fiction, general', 'literary collections',
    'long now manual for civilization', 'new york times reviewed', 'nyt', 'imaginary', 'stories', 'story',
    'modern', 'contemporary', 'adult', 'adults', 'literature and fiction', 'fiction and literature',
    'fiction / general', 'general fiction', 'fiction general', 'translations', 'american literature',
    'english literature', 'american fiction', 'english fiction', 'british fiction', 'series', 'mass market',
    'paperback', 'hardcover', 'kindle', 'book', 'books', 'various', 'other', 'miscellanea', 'etc', 'misc',
    'social life and customs', 'history and criticism', 'sources', 'women', 'men', 'people', 'life',
    'texts', 'criticism', 'an interpretation', 'interpretation', 'social aspects', 'psychological aspects',
    'study and teaching', 'case studies', 'relations', 'political', 'biographical', 'social conditions',
    'officials and employees', 'employees', 'new york times bestseller', 'bestseller', 'bestsellers',
    'motion picture plays', 'film adaptations', 'fiction classics', 'domestic fiction', 'large type',
    // LC's "Romance literature" means French/Spanish/Italian letters, not romance novels — misleading as a tag.
    'romance literature', 'continental european fiction', 'japanese authors', 'authors', 'congresses', 'conferences',
    'addresses, essays, lectures', 'anecdotes', 'miscellanea', 'pictorial works', 'bibliography', 'catalogs', 'exhibitions',
  ]);

  const DROP_RE = [
    /^nyt:/, /^[a-z_]+:\S/, /_/, /reading level/, /accelerated reader/, /lexile/, /^award:.*=\d/, /^collection:/, /=/, /[<>]/,
    /\((fictitious character|imaginary place|imaginary organization|legendary character|mythical animal)\)/,
    /\bstaff picks?\b/, /^\d+$/, /^\d{2,4}s?$/, /^(19|20)\d\d-/, /^\d+\.\d+/, /(^|\s)(ebook|kindle|audible)(\s|$)/,
    /^place:/, /^person:/, /^time:/, /^series:/, /^language:/, /^genre:/, /\bin library\b/,
    /^(nineteenth|twentieth|twenty-first|eighteenth|seventeenth|sixteenth) century$/, /^\d{1,2}(st|nd|rd|th) century$/,
    /^(fiction|literature)\s*[-,/]\s*$/, /^juvenile works$/, /^translations (into|from) /, /language materials$/,
    /language books$/, /foreign language/, /^(english|german|french|spanish) language/,
    // Non-English cataloguing (Open Library mixes in French/German/Spanish/Polish/Dutch/Hungarian headings).
    /[\u00C0-\u024F\u0300-\u036f]/,
    /\(\d{4}-(\d{4})?\)/, // people as subjects: "Jane Austen (1775-1817)"
    /\b(viajes|guerras?|imaginari[ao]s|japanisch|interplanetari\w*|extraterrestres|ciencia|aventuras|misterio|guerra|mundo|amor|muerte|familia|relaciones|cuento|juvenil|infantil|espacial\w*|magia|romanzo|y|de|del|en|con|para|por|sobre)\b/,
    /\b(romans?|romane|nouvelles|novelas?|ficci[oó]n|literatur|literatura|letteratura|narrativa|historia|geschichte|darstellung|belletristi\w*|erz[aä]hlung\w*|traducciones|t[lł]umaczenia|powie[sś][cć]|cuentos|contes|r[eé]cits|vida|famille|jeunesse|kinderbuch|jugendbuch|fantastique|lectures|morceaux|moderniteit|cultuur|massamedia|essais|po[eé]sie|th[eé][aâ]tre|siglo|jahrhundert|si[eè]cle|und|der|die|das|och|avec|dans|sur|et|les|des|du|het|een|dieu|foi|macht|illustraties|francesa|frances|irodalom|ficcion)\b/,
    /\b[a-z]{1,3}\d{2,}/, // call numbers like "bd236 .b3813"
    /^(?!young$)[a-z]+(heit|keit|ung|schaft|bruder|iker|traum|ismus|it[aä]t|teit|erij|philosophie)$/,
  ];

  // Parenthetical qualifiers that add nothing.
  const JUNK_PAREN = /\s*\((fictional works by one author|single author|literary genre|fiction|novel|book)\)\s*/g;

  // Variants -> canonical tag. Keys are already lowercased/trimmed.
  const SYNONYMS = {
    'sci-fi': 'science fiction', 'science-fiction': 'science fiction', 'sf': 'science fiction',
    'science fiction, general': 'science fiction', 'science fiction & fantasy': 'science fiction',
    'science fiction and fantasy': 'science fiction', 'sci fi': 'science fiction',
    'hard science fiction': 'hard science fiction', 'hard sf': 'hard science fiction',
    'fantasy fiction': 'fantasy', 'fantasy literature': 'fantasy', 'fantasy fiction, english': 'fantasy',
    'fantasy fiction, american': 'fantasy', 'fantastic fiction': 'fantasy',
    'epic': 'epic fantasy', 'epic fantasy': 'epic fantasy', 'fantasy, epic': 'epic fantasy', 'high fantasy': 'epic fantasy',
    'dark fantasy': 'dark fantasy', 'grimdark': 'dark fantasy',
    'literary': 'literary fiction', 'literary fiction': 'literary fiction',
    'psychological': 'psychological fiction', 'psychological fiction': 'psychological fiction',
    'historical': 'historical fiction', 'historical fiction': 'historical fiction',
    'dystopian': 'dystopias', 'dystopia': 'dystopias', 'dystopian fiction': 'dystopias', 'dystopias': 'dystopias',
    'dystopian literature': 'dystopias', 'dystopian plays': 'dystopias',
    'utopias': 'utopias', 'utopian fiction': 'utopias',
    'horror fiction': 'horror', 'horror tales': 'horror', 'horror stories': 'horror', 'horror': 'horror',
    'thrillers': 'thriller', 'thrillers (fiction)': 'thriller', 'suspense': 'thriller', 'suspense fiction': 'thriller',
    'thriller': 'thriller', 'suspense & thrillers': 'thriller',
    'mystery fiction': 'mystery', 'detective and mystery stories': 'mystery', 'mystery and detective stories': 'mystery',
    'mystery & detective': 'mystery', 'mystery': 'mystery', 'crime fiction': 'crime', 'crime': 'crime',
    'love stories': 'romance', 'romance fiction': 'romance', 'romance': 'romance', 'romantic suspense fiction': 'romance',
    'short stories': 'short stories', 'short story': 'short stories', 'short stories (single author)': 'short stories',
    'translations into english': 'in translation', 'english translations': 'in translation',
    'war & military': 'war', 'war stories': 'war', 'war fiction': 'war', 'war': 'war',
    'bildungsromans': 'coming of age', 'coming-of-age': 'coming of age', 'coming of age': 'coming of age',
    'coming of age fiction': 'coming of age',
    'classic literature': 'classics', 'classic fiction': 'classics', 'classics': 'classics', 'classical literature': 'classics',
    'cyberpunk fiction': 'cyberpunk', 'cyberpunk': 'cyberpunk',
    'humorous stories': 'humor', 'humorous fiction': 'humor', 'humor': 'humor', 'humour': 'humor', 'comic fiction': 'humor',
    'satire': 'satire', 'satirical literature': 'satire', 'satirical fiction': 'satire', 'political satire': 'satire',
    'action & adventure': 'adventure', 'adventure stories': 'adventure', 'adventure fiction': 'adventure', 'adventure': 'adventure',
    'juvenile fiction': 'juvenile', 'juvenile literature': 'juvenile', 'children\'s stories': 'juvenile',
    'children\'s fiction': 'juvenile', 'children\'s books': 'juvenile', 'fairy tales, juvenile': 'juvenile',
    'near and far eastern fiction': 'asian fiction', 'japan, fiction': 'japan',
    'children\'s literature': 'juvenile', 'picture books': 'juvenile', 'picture books for children': 'juvenile',
    'young adult fiction': 'young adult', 'young adult literature': 'young adult', 'ya': 'young adult',
    'teen fiction': 'young adult',
    'world war, 1939-1945': 'world war ii', 'world war ii': 'world war ii', 'world war 2': 'world war ii',
    'world war, 1914-1918': 'world war i', 'world war i': 'world war i',
    'graphic novels': 'graphic novels', 'comic books, strips, etc': 'graphic novels', 'comics & graphic novels': 'graphic novels',
    'biography': 'biography', 'biography & autobiography': 'biography', 'autobiography': 'memoir', 'memoirs': 'memoir',
    'philosophy': 'philosophy', 'philosophical fiction': 'philosophical fiction', 'philosophical novels': 'philosophical fiction',
    'space opera': 'space opera', 'time travel': 'time travel', 'vampires': 'vampires', 'magic': 'magic',
    'artificial intelligence': 'artificial intelligence', 'robots': 'robots', 'aliens': 'aliens',
    'extraterrestrial beings': 'aliens', 'human-alien encounters': 'first contact', 'first contact': 'first contact',
    'post-apocalyptic fiction': 'post-apocalyptic', 'end of the world': 'post-apocalyptic', 'post-apocalyptic': 'post-apocalyptic',
    'fairy tales': 'fairy tales', 'mythology': 'mythology', 'poetry': 'poetry', 'essays': 'essays',
    'true crime': 'true crime', 'nonfiction': 'nonfiction', 'non-fiction': 'nonfiction',
    'occult fiction': 'occult', 'occultism': 'occult', 'supernatural': 'supernatural',
    'westerns': 'westerns', 'western stories': 'westerns', 'western fiction': 'westerns',
    'erotic stories': 'erotica', 'erotic fiction': 'erotica', 'erotica': 'erotica',
    'gothic fiction': 'gothic', 'gothic fiction (literary genre)': 'gothic', 'gothic': 'gothic',
    'noir fiction': 'noir', 'noir': 'noir', 'magic realism': 'magical realism', 'magical realism': 'magical realism',
    'magic realism (literature)': 'magical realism',
    'existentialism': 'existentialism', 'existentialism in literature': 'existentialism',
    'alienation (social psychology)': 'alienation', 'alienation': 'alienation',
    'military history': 'military history', 'military': 'military',
    'self-help': 'self-help', 'self help': 'self-help',
  };

  // Tags with a "kind" drive the profile summary text.
  const GENRES = new Set([
    'science fiction', 'hard science fiction', 'fantasy', 'epic fantasy', 'dark fantasy', 'literary fiction',
    'psychological fiction', 'historical fiction', 'dystopias', 'horror', 'thriller', 'mystery', 'crime', 'romance',
    'short stories', 'classics', 'cyberpunk', 'humor', 'satire', 'adventure', 'graphic novels', 'biography', 'memoir',
    'philosophy', 'philosophical fiction', 'space opera', 'post-apocalyptic', 'poetry', 'essays', 'true crime',
    'nonfiction', 'gothic', 'noir', 'magical realism', 'westerns', 'history', 'military history', 'politics',
    'political science', 'sociology', 'psychology', 'economics', 'science', 'erotica', 'occult', 'young adult',
    'juvenile', 'war', 'self-help', 'religion', 'mythology', 'fairy tales', 'drama', 'epic poetry',
  ]);

  const NATIONALITY_RE =
    /^(asian|japanese|french|russian|german|italian|spanish|latin american|argentine|mexican|colombian|chilean|brazilian|portuguese|polish|czech|hungarian|norwegian|swedish|danish|finnish|icelandic|dutch|chinese|korean|indian|irish|scottish|welsh|canadian|australian|nigerian|african|arabic|turkish|persian|israeli|hebrew|yiddish|greek|austrian|swiss|romanian|serbian|croatian|ukrainian|scandinavian|belgian|egyptian|south african|vietnamese|filipino|caribbean|cuban|peruvian|catalan) (fiction|literature|novels?)$/;

  // Split one raw subject string into candidate parts.
  function splitParts(s) {
    let parts = s.split(/\s*--\s*|\s*\/\s*|\s+-\s+/);
    const out = [];
    for (let p of parts) {
      p = p.trim();
      // BISAC style: "Fiction, science fiction, general" / "Juvenile fiction, fantasy & magic"
      const m = p.match(/^(juvenile |young adult )?(fiction|nonfiction|literary criticism),\s*(.+)$/i);
      if (m) {
        if (m[1]) out.push(m[1].trim() + ' fiction');
        m[3].split(/,\s*/).forEach((x) => out.push(x));
      } else out.push(p);
    }
    return out;
  }

  function clean(p) {
    return p
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(JUNK_PAREN, ' ')
      .replace(/[“”"]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.;:]+$/, '')
      .replace(/,\s*(\d{3,4}-(\d{3,4})?|\d{4})$/, (m) => (/1939-1945|1914-1918/.test(m) ? m : ''))
      .trim();
  }

  // One cleaned part -> zero or more canonical tags.
  function canonical(p) {
    if (SYNONYMS[p]) return [SYNONYMS[p]];
    const from = p.match(/^translations from ([a-z]+)$/);
    if (from && from[1] !== 'english') return ['in translation', `${from[1]} fiction`];
    const award = p.match(/^award:([a-z_]+)$/);
    if (award) return [award[1].replace(/_/g, ' ')];
    if (DROP.has(p)) return [];
    if (DROP_RE.some((re) => re.test(p))) return [];
    if (p.length < 3 || p.length > 48) return [];
    if (/^(fiction|novels?|stories)$/.test(p)) return [];
    // LCSH style "Friendship, fiction" / "France, juvenile fiction"
    const lc = p.match(/^(.+?),\s*(juvenile )?(fiction|drama|poetry)$/);
    if (lc) return [...canonical(lc[1]), ...(lc[2] ? ['juvenile'] : [])];
    // "Children's stories, English" -> "children's stories"
    const natSuffix = p.match(/^(.+?),\s*(english|american|british|canadian|australian|irish|scottish)$/);
    if (natSuffix) return canonical(natSuffix[1]);
    // "American science fiction" / "English fantasy fiction": the nationality is noise for anglophone books.
    const anglo = p.match(/^(english|american|british|canadian|australian) (?!and )(.+ (fiction|stories|literature))$/);
    if (anglo) return canonical(anglo[2]);
    const noSuffix = p.replace(/\s+(fiction|stories)$/, '');
    if (noSuffix !== p && SYNONYMS[noSuffix]) return [SYNONYMS[noSuffix]];
    return [p];
  }

  const SERIES_RE = /^(.+?)\s*\((imaginary place|fictitious character|imaginary organization)\)/i;

  const NONBOOK_RE = /criticism and interpretation|study guides?|examinations|textbooks|outlines, syllabi|problems, exercises|juvenile works/;

  /**
   * normalize(rawSubjects) -> { tags, raw: {tag: rawForm}, nonbook, series }
   * `raw` keeps an original spelling per tag so we can query Open Library with it;
   * `series` is a fictional place/character heading, used to collapse series.
   */
  function normalize(rawSubjects, limit = 45) {
    const tags = [];
    const rawMap = {};
    const seen = new Set();
    let nonbook = false;
    let series = null;
    for (const s of rawSubjects || []) {
      if (typeof s !== 'string') continue;
      const lower = s.toLowerCase();
      if (NONBOOK_RE.test(lower)) nonbook = true;
      if (!series) {
        const m = s.match(SERIES_RE);
        if (m) series = m[1].trim().toLowerCase();
      }
      if (tags.length >= limit) continue;
      for (const part of splitParts(s)) {
        for (const c of canonical(clean(part))) {
          if (seen.has(c)) continue;
          seen.add(c);
          tags.push(c);
          rawMap[c] = part.trim();
        }
      }
    }
    return { tags: tags.slice(0, limit), raw: rawMap, nonbook, series };
  }

  const kind = (tag) => (GENRES.has(tag) ? 'genre' : NATIONALITY_RE.test(tag) || tag === 'in translation' ? 'tradition' : 'theme');

  const PLACE_RE =
    /^(japan|france|russia|germany|china|korea|india|italy|spain|england|ireland|scotland|wales|mexico|argentina|brazil|chile|colombia|peru|cuba|norway|sweden|denmark|finland|iceland|poland|czech republic|hungary|austria|switzerland|netherlands|belgium|portugal|greece|turkey|iran|israel|egypt|nigeria|south africa|canada|australia|new zealand|united states|soviet union|paris \(france\)|tokyo \(japan\)|london \(england\)|new york \(n\.y\.\))$/;
  const isPlace = (tag) => PLACE_RE.test(tag);

  const DISPLAY = { 'in translation': 'In Translation', 'world war ii': 'World War II', 'world war i': 'World War I' };
  const display = (tag) => DISPLAY[tag] || titleCase(tag);

  // Open Library subject query string for a canonical tag.
  const QUERY_FORM = {
    'in translation': 'translations into english',
    'science fiction': 'science fiction',
    fantasy: 'fantasy fiction',
    'epic fantasy': 'fantasy, epic',
    'literary fiction': 'literary fiction',
    'psychological fiction': 'psychological fiction',
    'historical fiction': 'historical fiction',
    horror: 'horror',
    mystery: 'mystery and detective stories',
    thriller: 'thrillers',
    romance: 'love stories',
    'coming of age': 'bildungsromans',
    'first contact': 'human-alien encounters',
    aliens: 'extraterrestrial beings',
    'world war ii': 'world war, 1939-1945',
    'world war i': 'world war, 1914-1918',
    alienation: 'alienation (social psychology)',
    'asian fiction': 'near and far eastern fiction',
  };
  const UNQUERYABLE = new Set(['juvenile', 'young adult', 'classics', 'nonfiction']);

  function queryForm(tag, rawHint) {
    if (UNQUERYABLE.has(tag)) return null;
    return QUERY_FORM[tag] || rawHint || tag;
  }

  // Custom Goodreads shelves ("philosophy", "sci-fi", "favourites") double as tags.
  const SHELF_IGNORE = /^(to-read|read|currently-reading|owned|own|kindle|ebooks?|audiobooks?|library|borrowed|wishlist|dnf|did-not-finish|abandoned|favou?rites?|all-time-favou?rites?|re-?read|books-i-own|tbr|default|\d{4}.*|.*-\d{4}|reading-challenge.*)$/;
  function shelfTags(shelves) {
    const tags = [];
    for (const sh of shelves || []) {
      if (SHELF_IGNORE.test(sh)) continue;
      tags.push(...canonical(clean(sh.replace(/[-_]+/g, ' '))));
    }
    return tags;
  }

  // Subjects that are fine describing a book but read as accusations when presented as *your* taste.
  const SENSITIVE_RE = /pedophil|paedophil|child abuse|child prostitution|child sexual|sexual abuse|rape|incest|suicide|self-harm|genocide|sex crimes|massacres/;
  const isSensitive = (tag) => SENSITIVE_RE.test(tag);

  DQ.bookSubjects = { normalize, kind, display, queryForm, shelfTags, isPlace, isSensitive, GENRES };
})();
