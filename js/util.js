/* Shared helpers. Every module hangs off the global DQ namespace so the app
   runs from a plain file:// double-click (no ES modules, no build step). */
(function () {
  const DQ = (window.DQ = window.DQ || {});

  // ---------- HTML templating ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  class Raw {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const raw = (s) => new Raw(String(s));

  function renderVal(v) {
    if (v == null || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(renderVal).join('');
    return esc(v);
  }

  // Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``.
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += renderVal(vals[i]) + strings[i + 1];
    return new Raw(out);
  }

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function mount(el, content) {
    el.innerHTML = String(content);
    return el;
  }

  // ---------- Text normalisation ----------
  const stripDiacritics = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  function normAuthor(name) {
    return stripDiacritics(name)
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .replace(/[^a-z0-9À-￿]+/g, ' ')
      .trim();
  }

  // "Moby-Dick, or, the Whale" / "The Hobbit (Middle-earth, #0)" -> "moby dick" / "hobbit"
  function normTitle(title) {
    let t = stripDiacritics(title).toLowerCase();
    t = t.replace(/\(.*?\)|\[.*?\]/g, ' ');
    t = t.split(/:|\s[-–—]\s|,\s*or,?\s/)[0];
    t = t.replace(/^(the|a|an)\s+/, '');
    return t.replace(/[^a-z0-9À-￿]+/g, ' ').trim();
  }

  // Goodreads titles carry the series in a trailing "(Series, #n)".
  function splitSeries(title) {
    const m = String(title).match(/^(.*?)\s*\(([^()]+?),?\s*#\s*([\d.]+)[^()]*\)\s*$/);
    if (!m) return { title: String(title).trim(), series: null, seriesNum: null };
    return { title: m[1].trim(), series: m[2].trim(), seriesNum: parseFloat(m[3]) };
  }

  const LATIN_RE = /^[\p{Script=Latin}\p{P}\p{N}\p{Zs}\p{M}\p{S}]+$/u;
  const isLatin = (s) => LATIN_RE.test(String(s || ''));

  function titleCase(s) {
    const small = new Set(['a', 'an', 'and', 'of', 'the', 'in', 'on', 'to', 'for', 'or', 'with', 'by', 'at']);
    return String(s)
      .split(' ')
      .map((w, i) => {
        if (i > 0 && small.has(w)) return w;
        if (/^(ii|iii|iv|vi|vii|viii|ix|xx)$/.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ')
      .replace(/\(([a-z])/g, (_, c) => '(' + c.toUpperCase());
  }

  // ---------- Numbers ----------
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  function fmtCount(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Weighted random pick from [{item, w}] with w > 0.
  function weightedPick(entries) {
    const total = entries.reduce((a, e) => a + Math.max(0, e.w), 0);
    if (total <= 0) return entries[0]?.item;
    let r = Math.random() * total;
    for (const e of entries) {
      r -= Math.max(0, e.w);
      if (r <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }

  // ---------- Async ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Concurrency limiter: limit(fn) queues fn until a slot is free.
  function pLimit(max) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= max || !queue.length) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          next();
        });
    };
    return (fn) =>
      new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------- Covers & links ----------
  // The active domain knows where its covers live (Open Library covers, TMDB posters).
  const coverUrl = (id, size = 'L') => DQ.D.coverUrl(id, size);

  // Typographic stand-in when a book or film has no cover.
  function fallbackCover(title, author, cls = '') {
    const h = hashStr(title || '?') % 360;
    return html`<div class="fallback-cover ${cls}" style="--h:${h}">
      <span class="fc-title">${title}</span><span class="fc-author">${author || ''}</span>
    </div>`;
  }

  function coverImg(book, size = 'L', cls = '', eager = false) {
    const url = coverUrl(book.cover, size);
    if (!url) return fallbackCover(book.title, (book.authors || [book.author])[0], cls);
    return html`<img class="${cls}" src="${url}" alt="Cover of ${book.title}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"
      ${eager ? raw('fetchpriority="high"') : ''} data-fallback-title="${book.title}" data-fallback-author="${(book.authors || [book.author])[0] || ''}">`;
  }

  // Swap broken cover images for the typographic stand-in (event delegation, capture phase).
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallbackTitle) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = String(fallbackCover(img.dataset.fallbackTitle, img.dataset.fallbackAuthor, img.className));
      img.replaceWith(tmp.firstElementChild);
    },
    true
  );

  // Open Library serves a 1x1 gif for missing ids; treat tiny images as missing.
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallbackTitle) return;
      if (img.naturalWidth < 5) img.dispatchEvent(new Event('error'));
      else img.classList.add('loaded');
    },
    true
  );

  function preloadImage(url) {
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve(img);
      img.src = url;
    });
  }

  // ---------- Toasts ----------
  function toast(content, { timeout = 4000, actions = [] } = {}) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = String(content);
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'toast-actions';
      actions.forEach((a) => {
        const b = document.createElement('button');
        b.className = 'chip-btn';
        b.textContent = a.label;
        b.onclick = () => {
          a.onClick();
          close();
        };
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    let timer = setTimeout(close, timeout);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => (timer = setTimeout(close, 1500)));
    function close() {
      clearTimeout(timer);
      el.classList.remove('in');
      setTimeout(() => el.remove(), 250);
    }
    return { close };
  }

  // ---------- Icons (inline SVG, stroke = currentColor) ----------
  const ICON_PATHS = {
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    heartFill: '<path fill="currentColor" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    ban: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
    next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    prev: '<path d="M19 12H6M11 6l-6 6 6 6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    film: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
    star: '<path fill="currentColor" stroke="none" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    external: '<path d="M14 5h5v5M19 5l-8 8M17 14v4.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H10"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 15v4h14v-4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>',
    refresh: '<path d="M19 8a7.5 7.5 0 1 0 1 6M19 3.5V8h-4.5"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  };
  const icon = (name, cls = '') =>
    raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`);

  DQ.util = {
    esc, html, raw, $, $$, mount,
    stripDiacritics, normAuthor, normTitle, splitSeries, isLatin, titleCase,
    clamp, sigmoid, fmtCount, plural, hashStr, weightedPick,
    sleep, pLimit, debounce,
    coverUrl, fallbackCover, coverImg, preloadImage,
    toast, icon,
  };
})();
