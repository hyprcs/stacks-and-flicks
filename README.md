# Stacks & Flicks: discovery queues for your Goodreads shelf and Letterboxd diary

**Stacks** turns a Goodreads library export into a queue of book recommendations like Steam's discovery queue. **Flicks** does the same for films from a Letterboxd export. You see one pick at a time, each with the reason it was chosen, and every choice you make tunes the picks that follow.

They're two modes of one app. Flick between them with **Stacks | Flicks** in the top bar (or on the start page). Each keeps its own library, queue, Want to Read / Watchlist and learning, and its own look: Stacks is a reading room, Flicks a screening room.

## Run it

From this folder:

```
python server.py
```

Then open <http://localhost:5178>. If `goodreads_library_export.csv` (books) or `letterboxd_export.zip` (films) is in the folder, the start page offers to use it straight away.

`server.py` is a small standard-library server. It serves the app, stops the browser from holding on to stale copies of files you've edited, and relays public Letterboxd RSS feeds for taste twins (below). `python -m http.server 5178` still works, just without taste twins. Opening `index.html` directly (double-click) runs the same code; drop the export onto the page instead.

To get a fresh export:

- **Goodreads:** open **My Books**, choose **Import and export**, then **Export Library**.
- **Letterboxd:** open **Settings**, go to the **Data** tab, then **Export your data**. Drop the ZIP as it is, or the CSV files inside it.

### Flicks needs a TMDB key

Films are looked up on [TMDB](https://www.themoviedb.org), which needs a free API key. Sign up, then go to **Settings → API**, request a Developer key, and paste the **API Key** into the start page. It's checked once, kept in this browser, and sent only to TMDB. You can remove it later from **Your Taste → Forget TMDB key**.

## Using the queue

| Key | Action |
| --- | --- |
| `W` | Want to Read / Watchlist (saves it and moves on) |
| `R`, then `1`–`4` | Already read or seen it: loved / liked / OK / didn't like |
| `X` | Not for me (you can then say why: story, author or director, length, era) |
| `→` / `Space` | Next |
| `←` | Back (you can change a decision) |
| `D` | Expand the description |

On a phone, swipe left for next and right for back. Tap any theme tag to ask for more of it, less of it, or none at all.

**Customize** sets how adventurous the queue is, how popular the picks should be (well-known vs hidden gems), the queue length, and how many AI and taste-twin picks each queue can hold.

**Want to Read** exports as a CSV that Goodreads' importer puts on your to-read shelf. **Watchlist** exports as a CSV with TMDB IDs, which Letterboxd's importer matches exactly: open your watchlist on Letterboxd and use its import option.

## How it works

The **How it works** tab explains the whole pipeline in plain words for the mode you're in, with your own numbers. In short:

1. **Matching.** Books are matched on [Open Library](https://openlibrary.org); films on TMDB by exact title and year (a year either side, because festival and release years differ), including the TV series Letterboxd lists.
2. **Signals.** Finishing a book is itself a vote; watching a film is a smaller one, and film ratings are read against your own average in both directions. Hearts, favourites, rewatches, re-reads, recency and binges all count.
3. **Compared with a typical reader or viewer**, so you're matched on what you consume more than most people, not on what's popular.
4. **Sides of your taste** are found by clustering, and every queue saves room for each.
5. **Candidates** come from searches around your themes, facets and favourite creators; for films also TMDB's "people who liked this also liked" and your taste twins.
6. **Picking** balances strong matches, variety (one per creator, first in a series) and a few exploration picks.
7. **Learning** from every action re-picks the rest of the queue.

## Taste twins (Flicks)

People who share your favourite films are the best source of your next one. Flicks borrows the trick from [letterboxd-doppelganger-finder](https://github.com/hyprcs/letterboxd-doppelganger-finder): Letterboxd's member search accepts `fan:<film>` filters, so it can list members whose favourites include yours.

1. On **Your Taste → Taste twins**, Flicks builds those searches from your four profile favourites: all four, then each trio and pair, rarest first. Open one and it shows the matching members on Letterboxd.
2. Paste the members whose taste looks right (usernames or profile links) into the box beside that search.
3. Flicks follows their public diaries (Letterboxd RSS, through `server.py`) and refreshes them every 12 hours or so, or on **Refresh twins**.

Why it isn't noisy:

- **Rare favourites count most.** A twin's weight starts from the favourites you share, and an obscure one counts far more than a blockbuster.
- **Agreement counts.** The weight then moves with how closely their ratings agree with yours, shrunk while the overlap is small.
- **Ratings are read against their own average**, so a generous rater doesn't flood you.
- **Agreement between twins counts.** A film several trusted twins loved gets a bigger boost than one twin's pick.
- **Twins are capped per queue** (**Customize → Taste-twin picks per queue**).

Letterboxd only shows member search results to people (a bot check blocks scripts), which is why you do the searching and Flicks only reads the public RSS feeds.

## Optional: AI picks (bring your own key)

A language model reads your whole shelf or diary and suggests titles the tags can't find: it picks up tone, style and why you liked something. Every suggestion is looked up on Open Library or TMDB, invented titles are dropped, and the rest join the normal pool under the usual rules.

- **One click:** **Connect OpenRouter** (on How it works, Your Taste, or the first queue's summary) sends you to openrouter.ai to sign in and approve, and brings you back with a key of your own. No copying keys around.
- **Other providers:** Anthropic (Claude), OpenAI, Google Gemini, Hugging Face (open models), a local model through Ollama or LM Studio, or any OpenAI-compatible endpoint, set up by hand on **Your Taste**.
- **Cheap by design:** reasoning is kept low (it's billed as output and a list of picks doesn't need it), and OpenRouter reports the real cost of each run.

Recommended models (OpenRouter, per run of about 7k tokens in and 4k out; prices as of 30 Sep 2026, the How it works tab shows live ones):

| Tier | Model | Per run |
| --- | --- | --- |
| Best value (default) | `google/gemini-3.8-flash` | ~2¢ |
| Budget | `openai/gpt-6-luna` | ~0.3¢ |
| Budget, open | `deepseek/deepseek-v4.1-flash` (cheaper still via Hugging Face) | ~0.7¢ |
| Premium | `anthropic/claude-sonnet-5.5` | ~5¢ |
| Free | `nvidia/nemotron-3.5-lightning:free` (rate-limited, weaker on obscure titles) | free |

**Test models on your taste** (How it works) runs the same request on three models with your to-read list or watchlist hidden, then counts how many suggestions exist, how many you've already seen, and how many land on the hidden list: the model that finds what you already wanted reads your taste best. It costs a few cents and adds nothing to your queue. **Your results by model** then tracks how often you keep each model's picks.

**Privacy:** requests go straight from the page to the provider you pick. Your book or film list, ratings and queue reactions are sent to it when a run happens. The key is kept in this browser (or only for the current tab if you untick "Remember"); **Turn off and forget key** removes it. The provider settings are shared by Stacks and Flicks.

## On your phone

Stacks and Flicks install as home-screen apps (a PWA: manifest, icons and an offline shell).

1. Host the folder over HTTPS, for example with GitHub Pages or Netlify (both free).
2. Open it on the phone, switch to the one you want, then use **Share → Add to Home Screen** (iPhone) or **Install app** (Android). Add both and you get two icons, each opening its own mode.
3. Import your export on the phone itself (the Letterboxd ZIP works from the Files app). Your data stays on each device.

Taste twins need `server.py`, so they work on your computer, not on a hosted phone install.

## Privacy

Everything is stored in your browser's local storage. The only outside requests are:

- **Books:** Open Library (titles, ISBNs and subject searches), plus Google Books for the occasional missing description.
- **Films:** TMDB (titles and years, candidate searches, posters), with your API key.
- **Taste twins:** your own `server.py` fetches each twin's public Letterboxd RSS feed, at most once every 6 hours per twin.
- **AI picks (if you turn them on):** the provider you choose.

From a Letterboxd export only the film files are read. Of `profile.csv`, only your four favourite films are used; your name, email and bio are ignored.

## Files

- `index.html`, `css/app.css`: the page shell and styling (shared tokens; Flicks redefines them in its own block)
- `server.py`: local server (static files without caching, plus the Letterboxd RSS relay for taste twins)
- `js/brand.js`: the two identities (name, marks, fonts, icons), applied before first paint
- `js/store.js`: saved state; each mode has its own slice of local storage, and a few settings are shared
- `js/domain.js`: picks the active mode and hands its pieces to the shared engine
- `js/domains/books.js`, `js/domains/films.js`: everything that differs between books and films: evidence weights, scoring constants, search syntax, exports, How it works copy, AI prompt and on-screen wording
- `js/taste.js`: the shared taste model (signals, baseline comparison, facets, explanations)
- `js/recommender.js`: shared candidate searches and queue assembly
- `js/twins.js`: taste twins (searches, following diaries, weighting)
- `js/ai.js`: AI picks (providers, one-click OpenRouter, prompt, live prices, bake-off)
- Books: `js/csv.js` (Goodreads CSV parsing), `js/openlibrary.js` (Open Library client), `js/subjects.js` (subject clean-up and tag vocabulary)
- Films: `js/zip.js` (reads the export ZIP in the browser), `js/letterboxd.js` (Letterboxd export parsing), `js/tmdb.js` (TMDB client), `js/filmtags.js` (genre and keyword vocabulary)
- `js/views/*.js`: the screens (import, set-up, quick-rate, queue, Want to Read / Watchlist, taste profile, How it works)
- `sw.js`, `manifest-*.webmanifest`, `icons/`: the installable app; `tools/make_icons.py` redraws the icons

Film data and posters come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
