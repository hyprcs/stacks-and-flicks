/* The two identities: Stacks (books) and Flicks (films). Loaded in <head> before anything renders,
   so the right colours, fonts, icons and title apply on first paint. The mode comes from ?mode=
   (the home-screen icons open with it) or from the last one chosen. */
(function () {
  const DQ = (window.DQ = window.DQ || {});

  const STACKS_MARK =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect x="4" y="6" width="6" height="20" rx="1" fill="#8c3a2e"/>' +
    '<rect x="4" y="9" width="6" height="1.4" fill="#d6b06a"/><rect x="4" y="21.6" width="6" height="1.4" fill="#d6b06a"/>' +
    '<rect x="12" y="4" width="6" height="22" rx="1" fill="#4b6b3f"/>' +
    '<rect x="12" y="7" width="6" height="1.4" fill="#d6b06a"/><rect x="12" y="21.6" width="6" height="1.4" fill="#d6b06a"/>' +
    '<g transform="rotate(-12 23.5 16.5)"><rect x="20.5" y="7" width="6" height="19" rx="1" fill="#b98a3e"/>' +
    '<rect x="20.5" y="10" width="6" height="1.4" fill="#f1e2bf"/><rect x="20.5" y="21.6" width="6" height="1.4" fill="#f1e2bf"/></g>' +
    '</svg>';

  // A frame of film: sprocket holes either side, a play mark on the picture.
  const FLICKS_MARK =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect x="3" y="5" width="26" height="22" rx="2.5" fill="#174f32"/>' +
    '<rect x="9" y="8" width="14" height="16" rx="1.2" fill="#2e9e62"/>' +
    '<g fill="#efe9dc">' +
    '<rect x="4.6" y="7.5" width="2.6" height="2.4" rx=".6"/><rect x="4.6" y="12.5" width="2.6" height="2.4" rx=".6"/>' +
    '<rect x="4.6" y="17.5" width="2.6" height="2.4" rx=".6"/><rect x="4.6" y="22.5" width="2.6" height="2.4" rx=".6"/>' +
    '<rect x="24.8" y="7.5" width="2.6" height="2.4" rx=".6"/><rect x="24.8" y="12.5" width="2.6" height="2.4" rx=".6"/>' +
    '<rect x="24.8" y="17.5" width="2.6" height="2.4" rx=".6"/><rect x="24.8" y="22.5" width="2.6" height="2.4" rx=".6"/>' +
    '<path d="M14 12.2v7.6l6.4-3.8z"/>' +
    '</g></svg>';

  const BRANDS = {
    books: {
      name: 'Stacks',
      title: 'Stacks — Discovery Queue',
      themeColor: '#17110c',
      mark: STACKS_MARK,
      fonts:
        'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap',
      manifest: 'manifest-stacks.webmanifest',
      touchIcon: 'icons/stacks-180.png',
    },
    films: {
      name: 'Flicks',
      title: 'Flicks — Discovery Queue',
      themeColor: '#0b0d0c',
      mark: FLICKS_MARK,
      fonts: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:ital,wght@0,400..700;1,400..700&display=swap',
      manifest: 'manifest-flicks.webmanifest',
      touchIcon: 'icons/flicks-180.png',
    },
  };

  let mode = null;
  try {
    mode = new URLSearchParams(location.search).get('mode');
    if (BRANDS[mode]) localStorage.setItem('dqg:mode', JSON.stringify(mode));
    else mode = JSON.parse(localStorage.getItem('dqg:mode'));
  } catch {}
  if (!BRANDS[mode]) mode = 'books';

  const b = BRANDS[mode];
  document.documentElement.dataset.mode = mode;
  document.title = b.title;
  const add = (tag, props) => document.head.appendChild(Object.assign(document.createElement(tag), props));
  add('link', { rel: 'stylesheet', href: b.fonts });
  add('link', { rel: 'icon', href: 'data:image/svg+xml,' + encodeURIComponent(b.mark) });
  add('link', { rel: 'manifest', href: b.manifest });
  add('link', { rel: 'apple-touch-icon', href: b.touchIcon });
  add('meta', { name: 'apple-mobile-web-app-title', content: b.name });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', b.themeColor);

  DQ.brands = BRANDS;
  DQ.bootMode = mode;
})();
