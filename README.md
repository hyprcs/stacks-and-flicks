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

## Optional: AI picks

The queue works without this. Switch it on and an AI model (the same kind of thing as ChatGPT, Claude or Gemini) reads your whole shelf or diary and adds a second opinion.

**What you get**

- **It gets why you liked something.** A tag can say a book is "science fiction". A model can tell that what you loved was the dry humour or the narrator you couldn't trust, and go looking for that.
- **It finds what tags can't:** titles from another genre, country or century that feel like your favourites.
- **Every pick comes with a reason** tied to things you rated, and you get a short written portrait of your taste.
- **Nothing made up reaches your queue.** Every suggestion is looked up on Open Library or TMDB first; anything that doesn't exist is thrown away.

**The easy way in:** open **How it works** or **Your Taste** and press **Set up AI picks**. The guide in the app explains everything below one step at a time, checks your key the moment you paste it, and picks a sensible model for you. It takes about two minutes and can cost nothing.

### Four words worth knowing

| Word | What it means |
| --- | --- |
| **AI model** | The "reader" that makes the suggestions. |
| **Service** | The company that runs the model. Your account is with them, not with this app. |
| **API key** | A long, password-like code from that service that lets the app ask the model questions on your account. Like a library card number: whoever holds it can borrow in your name, so don't share it. It's kept in your browser and sent only to that service. |
| **Credit** | Money you put on your account in advance, like topping up a travel card. Each batch of about 30 suggestions uses a little. When it runs out the picks stop; nothing more is charged unless you switch on automatic top-ups there. |

A ChatGPT Plus or Claude subscription does not count as credit: those cover the chat apps only.

### Which service?

| Service | Good for | Cost |
| --- | --- | --- |
| **OpenRouter** (recommended) | One account for the models of every AI company. Connects in one click, no key to copy. | Free model to start; $5 of credit covers a couple of hundred batches on the recommended model |
| **Google Gemini** | Anyone with a Google account who wants to pay nothing. | Free within a daily allowance (on that allowance Google may use what you send to improve its products) |
| **Anthropic** | Claude models: the most perceptive reading of your taste. | About 5¢ a batch on Claude Sonnet 5.5, where you start |
| **OpenAI** | GPT models from the company that makes them. | From a fraction of a cent a batch |
| **Hugging Face** | Open models. | Small free monthly allowance, then a fraction of a cent a batch |
| **Your own computer** (Ollama, LM Studio) | Privacy: nothing leaves your machine. | Free, but weaker picks |

### Step by step

**OpenRouter (one click).** Press **Connect OpenRouter**. Sign in on openrouter.ai, or create a free account with a Google account or an email address. Approve the request and you land back in the app, connected. A new account starts on a free model (up to 50 requests a day; a batch is one request). To unlock the stronger models, add credit at <https://openrouter.ai/settings/credits>.

**Google Gemini.** Open <https://aistudio.google.com/apikey>, sign in with your Google account and accept the terms. Press **Create API key** (first-time visitors often get one made automatically), press the copy button beside it, and paste it into the app.

**Anthropic.** Create an account at <https://platform.claude.com> (separate from the Claude chat app). Buy a small amount of credit under **Billing**. Under **API keys** press **Create Key**, copy it straight away (it starts with `sk-ant-` and is shown only once), and paste it into the app. You start on Claude Sonnet 5.5; Claude Opus 5.5 (closer reading, about twice the price) and Claude Haiku 4.5 (about half the price) are one click away.

**OpenAI.** Sign up at <https://platform.openai.com> (separate from ChatGPT). Add a payment method and a small amount of credit under **Billing**. On the **API keys** page press **Create new secret key**, copy it straight away (it starts with `sk-`), and paste it into the app.

**Hugging Face.** Create a free account at <https://huggingface.co/join>. Create a token with the **Make calls to Inference Providers** permission (the app's link opens the form with it already ticked), copy it (it starts with `hf_`), and paste it into the app.

**Your own computer.** Install [Ollama](https://ollama.com/download) and open it. In a terminal run `ollama pull gemma3` (a download of a few gigabytes), then press **Find my models** in the app. If you use a hosted copy of the app rather than `python server.py`, Ollama also needs `OLLAMA_ORIGINS` set to that site's address. LM Studio works through **Advanced settings** with the address `http://localhost:1234/v1`.

Whichever you choose, you only ever paste one thing. The app recognises the service from the key, checks it, and tells you in plain words if something is wrong (a clipped key, no credit, a busy free model) and how to fix it.

You aren't locked into the model you start on. Every guide lists the models that service offers, with what each costs, and once you're connected the set-up page lets you switch between them in one click.

### Which model? Think of booksellers

Models differ in how much they have "read". Bigger ones notice more and cost more per batch.

| | The weekend temp (small models) | The career bookseller (mid-size) | The owner who has read everything (large) |
| --- | --- | --- | --- |
| **What they're like** | Friendly, fast, nearly free. Knows the bestseller table. | Has read widely: translated fiction, small presses, the backlist. | Remembers what you bought three years ago and why you loved it. |
| **How far off the beaten path** | Mostly well-known titles | Well-known titles and hidden gems | Deep cuts: older, translated, half-forgotten |
| **Made-up titles** (always thrown away) | Now and then | Rare | Very rare |
| **The reasons it gives** | General: "you like fantasy" | Tied to things you rated highly | Tied to why you liked them |
| **A batch costs** | Free, or a fraction of a cent | About 2¢ | About 5¢ to 10¢ |
| **Such as** | GPT-6 Luna, Claude Haiku 4.5, the free models, anything that runs on a home computer | Gemini 3.8 Flash, DeepSeek V4.1 Flash | Claude Opus 5.5, Claude Sonnet 5.5, GPT-6 Sol |

(In Flicks the same three are the new hire at the video shop, the clerk who's been there for years, and the owner who has seen everything.) These are tendencies, not promises: a newer small model can beat an older large one, which is what the blind test below is for.

### For the curious

- **Cheap by design:** reasoning is kept low (it's billed as output and a list of picks doesn't need it), and OpenRouter reports the real cost of each batch. Prices in the app are live from OpenRouter's public list; the figures above were captured on 1 Oct 2026 for a library of a few hundred titles.
- **Test models on your taste** (How it works) runs the same request on three models with your to-read list or watchlist hidden, then counts how many suggestions exist, how many you've already seen, and how many land on the hidden list: the model that finds what you already wanted reads your taste best. It costs a few cents and adds nothing to your queue. **Your results by model** then tracks how often you keep each model's picks.
- **Advanced settings** (Your Taste) let you enter any OpenAI-compatible address, key and model id by hand.

**Privacy:** requests go straight from the page to the service you pick; there is no server in between. Your book or film titles, ratings and queue reactions are sent when a batch is requested; your name, email and account details never are. The key is kept in this browser; **Turn off and forget key** removes it. The connection is shared by Stacks and Flicks.

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
- `js/ai.js`: AI picks (providers, one-click OpenRouter, key checking, prompt, live prices, bake-off)
- Books: `js/csv.js` (Goodreads CSV parsing), `js/openlibrary.js` (Open Library client), `js/subjects.js` (subject clean-up and tag vocabulary)
- Films: `js/zip.js` (reads the export ZIP in the browser), `js/letterboxd.js` (Letterboxd export parsing), `js/tmdb.js` (TMDB client), `js/filmtags.js` (genre and keyword vocabulary)
- `js/views/*.js`: the screens (import, set-up, quick-rate, queue, Want to Read / Watchlist, taste profile, How it works, the AI set-up guide)
- `sw.js`, `manifest-*.webmanifest`, `icons/`: the installable app; `tools/make_icons.py` redraws the icons

Film data and posters come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
