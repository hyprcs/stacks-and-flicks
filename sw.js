/* Offline shell for Stacks & Flicks, so both work as home-screen apps.

   App files are network-first: online, you always get the latest (edits show up at once); offline,
   the last copy is served. Nothing else is cached here: API calls (the local helper), other sites
   (TMDB, Open Library, AI providers, fonts) and your own exports (.csv, .zip) go straight to the
   network. Bump VERSION when the list of shell files changes. */
const VERSION = 'v2';
const CACHE = `stacks-flicks-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/brand.js', 'js/util.js', 'js/csv.js', 'js/store.js', 'js/subjects.js', 'js/filmtags.js', 'js/openlibrary.js',
  'js/zip.js', 'js/letterboxd.js', 'js/tmdb.js', 'js/domains/books.js', 'js/domains/films.js', 'js/domain.js',
  'js/taste.js', 'js/recommender.js', 'js/twins.js', 'js/ai.js',
  'js/views/landing.js', 'js/views/analyze.js', 'js/views/calibrate.js', 'js/views/queue.js', 'js/views/wishlist.js',
  'js/views/profile.js', 'js/views/how.js', 'js/views/connect.js', 'js/app.js',
  'manifest-stacks.webmanifest', 'manifest-flicks.webmanifest',
  'icons/stacks-180.png', 'icons/stacks-192.png', 'icons/stacks-512.png', 'icons/stacks-maskable-512.png',
  'icons/flicks-180.png', 'icons/flicks-192.png', 'icons/flicks-512.png', 'icons/flicks-maskable-512.png',
];
const SHELL_FILE = /(\/|\.html|\.css|\.js|\.png|\.webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('stacks-flicks-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || !SHELL_FILE.test(url.pathname)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
