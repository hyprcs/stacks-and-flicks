/* Optional AI assist, bring your own key.

   A language model reads the whole library (ratings, shelves or diary, quick-rates, queue reactions)
   and suggests books or films; each suggestion is looked up on the active source (Open Library or
   TMDB) and joins the candidate pool, where the normal taste model, diversity rules and feedback
   loop still apply. The domain supplies the prompt wording.

   Two wire formats cover almost every provider:
     - Anthropic Messages API (Claude), called natively;
     - OpenAI-compatible Chat Completions (OpenAI, Gemini, OpenRouter, Hugging Face, local Ollama/LM Studio, …).
   All calls go straight from this page to the provider; the key never goes anywhere else.

   OpenRouter can be connected in one click (OAuth PKCE: the user approves on openrouter.ai and the
   page receives a key of their own). Reasoning is kept low: it's billed as output and a
   recommendation list doesn't need it. A bake-off runs the same request on several models with the
   user's own watchlist hidden, so they can see which one reads their taste best for the money. */
(function () {
  const { sleep } = DQ.util;
  const state = DQ.state;
  const S = DQ.subjects;
  const D = DQ.D;
  const A = D.ai;

  // Curated OpenRouter picks. Prices are $ per million tokens, captured 2026-09-30; the How it works
  // tab shows live ones. Knowledge of obscure titles grows with model size: the source lookup drops
  // invented titles, but a weak model wastes slots.
  const RECOMMENDED = [
    { id: 'google/gemini-3.8-flash', tier: 'Best value', price: { in: 0.75, out: 3.75 },
      why: 'Broad knowledge of obscure, international and recent titles, and reliable JSON. The default.' },
    { id: 'openai/gpt-6-luna', tier: 'Budget', price: { in: 0.1, out: 0.5 },
      why: 'A fraction of a cent a run. Worth it if the bake-off shows it keeps up.' },
    { id: 'deepseek/deepseek-v4.1-flash', tier: 'Budget, open', price: { in: 0.3, out: 1.2 },
      why: 'A large open model with deep knowledge for the price (cheaper still through Hugging Face).' },
    { id: 'anthropic/claude-sonnet-5.5', tier: 'Premium', price: { in: 2, out: 10 },
      why: 'Best at reading why you like things and explaining its picks. For an occasional deep run.' },
    { id: 'nvidia/nemotron-3.5-lightning:free', tier: 'Free', price: { in: 0, out: 0 },
      why: 'Costs nothing but is rate-limited and small: expect more misses on obscure titles.' },
  ];
  const DEFAULT_MODEL = RECOMMENDED[0].id;
  // The bake-off's default line-up: the value pick against the two budget picks.
  const BAKEOFF = { openrouter: RECOMMENDED.slice(0, 3).map((m) => m.id) };

  const PROVIDERS = {
    anthropic: {
      label: 'Anthropic (Claude)', protocol: 'anthropic', base: 'https://api.anthropic.com/v1',
      model: 'claude-opus-5-5', suggest: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
      keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…',
    },
    openai: {
      label: 'OpenAI', protocol: 'openai', base: 'https://api.openai.com/v1',
      model: 'gpt-6-luna', suggest: ['gpt-6-luna', 'gpt-6-sol'], jsonMode: true, maxTokensParam: 'max_completion_tokens', reasoning: 'effort',
      keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…',
    },
    gemini: {
      label: 'Google Gemini', protocol: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.8-flash', suggest: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'], jsonMode: true, reasoning: 'effort',
      keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
    },
    openrouter: {
      label: 'OpenRouter (hundreds of models)', protocol: 'openai', base: 'https://openrouter.ai/api/v1',
      model: DEFAULT_MODEL, suggest: [...RECOMMENDED.map((m) => m.id), 'qwen/qwen3.8-flash', 'xiaomi/mimo-v2.6-flash', 'z-ai/glm-5.3-flash'],
      reasoning: 'openrouter', jsonMode: true, multiModel: true,
      keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', headers: { 'X-Title': DQ.D.brand.name },
    },
    huggingface: {
      label: 'Hugging Face (open models)', protocol: 'openai', base: 'https://router.huggingface.co/v1',
      model: 'deepseek-ai/DeepSeek-V4.1-Flash:cheapest', multiModel: true,
      suggest: ['deepseek-ai/DeepSeek-V4.1-Flash:cheapest', 'Qwen/Qwen3-235B-A22B-Instruct-2507:cheapest', 'zai-org/GLM-5.3-Flash:cheapest', 'openai/gpt-oss-120b:cheapest'],
      keyUrl: 'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained', keyHint: 'hf_…',
    },
    local: {
      label: 'Local model (Ollama, LM Studio)', protocol: 'openai', base: 'http://localhost:11434/v1',
      model: '', suggest: [], keyOptional: true, keyUrl: 'https://ollama.com/download', local: true,
    },
    custom: {
      label: 'Other OpenAI-compatible API', protocol: 'openai', base: '', model: '', suggest: [], keyOptional: true,
    },
  };

  // ---------- settings & key ----------
  // The key lives in localStorage only when "remember" is on; otherwise in this tab's sessionStorage.
  const SESSION_KEY = 'dq1:aikey';
  function cfg() {
    state.ai = state.ai || {};
    return state.ai;
  }
  function getKey() {
    const c = cfg();
    if (c.key) return c.key;
    try {
      return sessionStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  }
  function saveSettings({ provider, model, base, key, remember, auto }) {
    const c = cfg();
    Object.assign(c, { provider, model: model.trim(), base: base.trim().replace(/\/+$/, ''), remember, auto });
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    if (remember) c.key = key.trim();
    else {
      c.key = '';
      try {
        sessionStorage.setItem(SESSION_KEY, key.trim());
      } catch {}
    }
    c.enabled = true;
    c.lastError = null;
    DQ.store.save('ai');
  }
  function forget() {
    const keep = { recs: cfg().recs || {} };
    state.ai = { ...keep, enabled: false };
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    DQ.store.save('ai');
  }
  const provider = () => PROVIDERS[cfg().provider] || PROVIDERS.openrouter;
  const enabled = () => {
    const c = cfg();
    return !!(c.enabled && c.model && (c.base || provider().base) && (getKey() || provider().keyOptional));
  };
  const modelLabel = () => cfg().model || '';

  // ---------- transport ----------
  class AIError extends Error {
    constructor(msg, kind) {
      super(msg);
      this.kind = kind;
    }
  }

  async function http(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new AIError('The model took too long to answer. Try again, or pick a faster model.', 'timeout');
      const p = provider();
      throw new AIError(
        p.local
          ? "Couldn't reach the local model server. Is it running? Ollama needs OLLAMA_ORIGINS to include this page's address."
          : `Couldn't reach ${p.label}. Check your connection and the base URL.`,
        'network'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function failFrom(res) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error?.message || j.error?.type || j.message || JSON.stringify(j).slice(0, 200);
    } catch {}
    const s = res.status;
    const msg =
      s === 401 || s === 403 ? 'The API key was rejected.'
      : s === 404 ? `Model or endpoint not found. Use "Load models" to pick one your key can use.`
      : s === 429 ? 'Rate limited or out of credit with this provider.'
      : s === 402 ? 'This provider needs credit on the account.'
      : `The provider returned an error (${s}).`;
    return new AIError(detail ? `${msg} ${String(detail).slice(0, 220)}` : msg, `http${s}`);
  }

  // Claude capabilities by model family (the user can type any model id).
  const CLAUDE = {
    effort: /^claude-(fable|mythos|opus-5|opus-4-[5-8]|sonnet-5|sonnet-4-6)/,
    structured: /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-5|opus-4-1|sonnet-5|haiku-4-5)/,
    fallbackDefault: /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/,
  };

  async function callAnthropic({ system, user, schema, model: override }) {
    const c = cfg();
    const model = override || c.model;
    const body = { model, max_tokens: 16000, system, messages: [{ role: 'user', content: user }] };
    const output = {};
    if (CLAUDE.effort.test(model)) output.effort = 'medium';
    if (schema && CLAUDE.structured.test(model)) output.format = { type: 'json_schema', schema };
    if (Object.keys(output).length) body.output_config = output;
    const headers = {
      'content-type': 'application/json',
      'x-api-key': getKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    // If a safety classifier declines, let the API retry on Anthropic's recommended fallback model.
    if (CLAUDE.fallbackDefault.test(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    const res = await http(`${c.base || provider().base}/messages`, { method: 'POST', headers, body: JSON.stringify(body) }, 240000);
    if (!res.ok) throw await failFrom(res);
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new AIError('The model declined this request.', 'refusal');
    return {
      text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
      truncated: data.stop_reason === 'max_tokens',
      usage: { in: data.usage?.input_tokens, out: data.usage?.output_tokens },
      servedBy: data.model,
    };
  }

  /** Request body tweaks that keep reasoning (billed as output) low, per provider dialect. */
  function reasoningParams(p) {
    if (p.reasoning === 'openrouter') return { reasoning: { effort: 'low' }, usage: { include: true } };
    if (p.reasoning === 'effort') return { reasoning_effort: 'low' };
    return {};
  }

  async function callOpenAI(req, { jsonMode = provider().jsonMode, lowReasoning = true } = {}) {
    const { system, user, model: override } = req;
    const c = cfg();
    const p = provider();
    const model = override || c.model;
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    body[p.maxTokensParam || 'max_tokens'] = 12000;
    if (jsonMode) body.response_format = { type: 'json_object' };
    if (lowReasoning) Object.assign(body, reasoningParams(p));
    const headers = { 'content-type': 'application/json', ...(p.headers || {}) };
    const key = getKey();
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await http(`${c.base || p.base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, 240000);
    if (!res.ok) {
      const err = await failFrom(res);
      // Not every model takes JSON mode or a reasoning setting; retry once without the one it rejected.
      if (res.status === 400 && lowReasoning && /reasoning/i.test(err.message)) return callOpenAI(req, { jsonMode, lowReasoning: false });
      if (res.status === 400 && jsonMode && /response_format|json/i.test(err.message)) return callOpenAI(req, { jsonMode: false, lowReasoning });
      throw err;
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content || '',
      truncated: choice?.finish_reason === 'length',
      usage: { in: data.usage?.prompt_tokens, out: data.usage?.completion_tokens },
      cost: typeof data.usage?.cost === 'number' ? data.usage.cost : null, // OpenRouter reports the real charge
      servedBy: data.model || model,
    };
  }

  const complete = (req) => (provider().protocol === 'anthropic' ? callAnthropic(req) : callOpenAI(req));

  /** Model ids the key can use (also a cheap way to check the key). */
  async function listModels({ provider: pid, base, key }) {
    const p = PROVIDERS[pid];
    const root = (base || p.base).replace(/\/+$/, '');
    const headers =
      p.protocol === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
        : key ? { authorization: `Bearer ${key}` } : {};
    const res = await http(`${root}/models${p.protocol === 'anthropic' ? '?limit=100' : ''}`, { headers }, 30000);
    if (!res.ok) throw await failFrom(res);
    const data = await res.json();
    return (data.data || data.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
  }

  // ---------- prompt ----------
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['taste_summary', 'facets', 'recommendations'],
    properties: {
      taste_summary: { type: 'string' },
      facets: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string' } } },
      },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', A.creatorField, 'year', 'why', 'facet', 'stretch'],
          properties: {
            title: { type: 'string' }, [A.creatorField]: { type: 'string' }, year: { type: 'integer' },
            why: { type: 'string' }, facet: { type: 'string' }, stretch: { type: 'boolean' },
          },
        },
      },
    },
  };

  const SYSTEM = A.system;

  const CAL = { loved: 'loved it', liked: 'liked it', ok: 'it was OK', disliked: "didn't like it" };
  const REASON = { genre: 'not their kind of story', author: 'not into the author', length: 'too long', era: 'wrong era', notnow: 'not right now' };

  function libraryLines({ holdOut = false } = {}) {
    // The bake-off hides the to-read list / watchlist, then counts how many picks land on it.
    const lib = holdOut ? state.library.filter((b) => b.exclusive !== 'to-read') : state.library;
    // Big libraries: keep the most telling rows (rated, quick-rated, re-read or rewatched, recent…).
    const rows = lib
      .map((b) => ({ b, s: A.score(b, state.calib[b.gid]) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 350)
      .map((x) => x.b);
    const lines = rows.map((b) => A.line(b, state.calib[b.gid]));
    return { lines, shown: rows.length, total: lib.length };
  }

  function buildPrompt(count, { holdOut = false } = {}) {
    const model = DQ.app.model();
    const { lines, shown, total } = libraryLines({ holdOut });
    const events = Object.values(state.events)
      .filter((e) => e.action !== 'skip' && e.doc)
      .sort((a, b) => b.t - a.t)
      .slice(0, 80)
      .map((e) => {
        const what = e.action === 'want' ? A.wanted : e.action === 'read' ? `${A.already} (${CAL[e.rating] || e.rating})` : `passed${e.reason ? ` (${REASON[e.reason] || e.reason})` : ''}`;
        return `- ${e.doc.title} - ${e.doc.authors?.[0] || ''}: ${what}`;
      });
    const prefs = Object.entries(state.tags);
    const more = prefs.filter(([, p]) => p === 'more').map(([t]) => S.display(t));
    const less = prefs.filter(([, p]) => p !== 'more').map(([t]) => S.display(t));
    const facets = model.facets.map((f) => `- ${f.tags.slice(0, 3).map(S.display).join(', ') || 'mixed'} (${f.authors.slice(0, 3).join(', ')})`);
    const suggested = new Set();
    Object.values(state.ai?.recs || {}).forEach((r) => r.title && suggested.add(`${r.title} - ${r.author}`));
    Object.keys(state.seen).slice(-150).forEach((k) => {
      const d = state.pool[k] || state.events[k]?.doc;
      if (d) suggested.add(`${d.title} - ${d.authors?.[0] || ''}`);
    });

    const scale = model.scale;
    const parts = [A.howToRead(scale), A.libraryHeader(shown, total), lines.join('\n')];
    if (events.length) parts.push(`How they reacted to recent recommendations:\n${events.join('\n')}`);
    if (more.length) parts.push(`They asked for more: ${more.join(', ')}`);
    if (less.length) parts.push(`They asked for less or none: ${less.join(', ')}`);
    if (model.binges.length) {
      parts.push(`${A.bingeHeader}:\n${model.binges.map((b) => `- ${b.count} ${D.w.items} by ${b.author} within ${b.days} days`).join('\n')}`);
    }
    if (facets.length) parts.push(`For reference, a statistical clustering of their shelf found these sides:\n${facets.join('\n')}`);
    if (suggested.size) parts.push(`Already suggested to them (don't repeat):\n${[...suggested].slice(-250).map((s) => `- ${s}`).join('\n')}`);
    parts.push(`Recommend ${count} ${D.w.items}.`);
    return parts.join('\n\n');
  }

  function parseReply(text) {
    let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new AIError("The model's reply wasn't in the expected format. Try again or pick another model.", 'parse');
    let data;
    try {
      data = JSON.parse(t.slice(a, b + 1));
    } catch {
      throw new AIError("The model's reply wasn't valid JSON. Try again or pick another model.", 'parse');
    }
    // Books name an "author", films a "director"; either way it's the creator we look up by.
    const creator = (r) => r[A.creatorField] ?? r.author ?? r.director;
    const recs = (Array.isArray(data.recommendations) ? data.recommendations : [])
      .filter((r) => r && typeof r.title === 'string' && typeof creator(r) === 'string' && r.title.trim() && creator(r).trim())
      .slice(0, 40)
      .map((r) => ({
        title: r.title.trim(), author: creator(r).trim(), year: Number(r.year) || null,
        why: String(r.why || '').trim().slice(0, 400), facet: String(r.facet || '').trim().slice(0, 60), stretch: !!r.stretch,
      }));
    if (!recs.length) throw new AIError('The model returned no recommendations.', 'parse');
    return {
      summary: String(data.taste_summary || '').trim().slice(0, 1500),
      facets: (Array.isArray(data.facets) ? data.facets : []).filter((f) => f?.name).slice(0, 8)
        .map((f) => ({ name: String(f.name).slice(0, 60), description: String(f.description || '').slice(0, 300) })),
      recs,
    };
  }

  // ---------- run ----------
  let running = null;
  const emit = (detail) => document.dispatchEvent(new CustomEvent('dq:ai', { detail }));

  /** Ask the model for picks, look each up on the source, add the found ones to the pool. */
  function run({ count = 30 } = {}) {
    if (running) return running;
    if (!enabled()) return Promise.reject(new AIError('AI assist is not set up.', 'config'));
    const c = cfg();
    emit({ state: 'running', model: c.model });
    running = (async () => {
      try {
        const reply = await complete({ system: SYSTEM, user: buildPrompt(count), schema: SCHEMA });
        const parsed = parseReply(reply.text);
        const idx = DQ.rec.libraryIndex();
        let found = 0, added = 0;
        const recs = cfg().recs || (cfg().recs = {});
        await Promise.all(
          parsed.recs.map(async (r, i) => {
            await sleep(i * 40); // be gentle with the source
            let doc = null;
            try {
              doc = await DQ.source.findWork(r.title, r.author, r.year);
            } catch {}
            if (!doc) return;
            found++;
            const key = DQ.rec.adopt(doc, { type: 'ai' });
            if (!key || recs[key] || !DQ.rec.eligible(state.pool[key], idx, true)) return;
            // The lookup already matched on surname; the model's spelling reads better than
            // catalogue transliteration ("Arkady Strugatsky", not "Arkadiĭ Strugat︠s︡kiĭ").
            if (A.preferModelNames) state.pool[key].authors = [r.author, ...(state.pool[key].authors || []).slice(1)];
            recs[key] = { why: r.why, facet: r.facet, stretch: r.stretch, title: r.title, author: r.author, model: c.model, servedBy: reply.servedBy, t: Date.now() };
            added++;
          })
        );
        Object.assign(cfg(), {
          profile: { summary: parsed.summary, facets: parsed.facets, model: reply.servedBy || c.model, t: Date.now() },
          lastRun: Date.now(),
          lastStats: { suggested: parsed.recs.length, found, added, tokensIn: reply.usage.in, tokensOut: reply.usage.out, cost: reply.cost ?? estimateCost(c.model, reply.usage) },
          lastError: null,
        });
        DQ.store.save('ai', 'pool');
        DQ.app.invalidate();
        if (state.queue && !state.queue.done) DQ.rec.refreshUpcoming(DQ.app.model());
        running = null; // listeners re-render on this event and should see the run as finished
        emit({ state: 'done', added, found, suggested: parsed.recs.length });
        return { added, found, suggested: parsed.recs.length };
      } catch (e) {
        cfg().lastError = { message: e.message, t: Date.now() };
        DQ.store.save('ai');
        running = null;
        emit({ state: 'error', message: e.message });
        throw e;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** After a queue: top up AI picks when few unseen ones remain. */
  function maybeRefresh() {
    const c = cfg();
    if (!enabled() || !c.auto || running) return;
    if (Date.now() - (c.lastRun || 0) < 60000) return;
    const eligible = new Set(DQ.rec.eligibleDocs().map((d) => d.key));
    const fresh = Object.keys(c.recs || {}).filter((k) => eligible.has(k)).length;
    if (fresh < 6) run().catch(() => {});
  }

  /** Rough request size, so cost-conscious users know what a run involves. */
  function estimateTokens() {
    const chars = SYSTEM.length + buildPrompt(30).length;
    return { in: Math.round(chars / 3.6), out: 3500 };
  }

  const recFor = (key) => state.ai?.recs?.[key] || null;

  // ---------- prices & costs ----------
  const livePrice = new Map(); // model id -> { in, out } in $ per million tokens
  let pricesLoaded = null;
  /** OpenRouter's public price list (no key needed), fetched once per session. Resolves true if live. */
  function loadPrices() {
    pricesLoaded ||= fetch('https://openrouter.ai/api/v1/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        for (const m of d?.data || []) {
          const pin = parseFloat(m.pricing?.prompt), pout = parseFloat(m.pricing?.completion);
          if (Number.isFinite(pin) && Number.isFinite(pout)) livePrice.set(m.id, { in: pin * 1e6, out: pout * 1e6 });
        }
        return livePrice.size > 0;
      })
      .catch(() => false);
    return pricesLoaded;
  }
  const priceFor = (id) => livePrice.get(id) || RECOMMENDED.find((m) => m.id === id)?.price || null;
  /** $ for a request of this size on this model, or null when its price isn't known. */
  function estimateCost(model, usage) {
    const p = priceFor(model);
    if (!p || !usage?.in) return null;
    return (usage.in * p.in + (usage.out || 0) * p.out) / 1e6;
  }
  let tokenEstimate = null;
  /** What one run costs on a model, for the current library size. */
  function runCost(model) {
    tokenEstimate ||= estimateTokens();
    return estimateCost(model, tokenEstimate);
  }

  /** Switch model on the connected provider (keeps the key). */
  function setModel(model) {
    cfg().model = model;
    DQ.store.save('ai');
  }

  /** How each model's picks fared in your queues: shown, kept (wanted), passed, already seen. */
  function modelStats() {
    const by = new Map();
    for (const [key, r] of Object.entries(cfg().recs || {})) {
      const m = r.model || r.servedBy || 'unknown';
      const s = by.get(m) || { model: m, picks: 0, shown: 0, kept: 0, passed: 0, seenBefore: 0 };
      s.picks++;
      if (state.seen[key]) s.shown++;
      const action = state.events[key]?.action;
      if (action === 'want') s.kept++;
      else if (action === 'pass') s.passed++;
      else if (action === 'read') s.seenBefore++;
      by.set(m, s);
    }
    return [...by.values()].sort((a, b) => b.shown - a.shown || b.picks - a.picks);
  }

  // ---------- bake-off ----------
  const bakeoffModels = () => BAKEOFF[cfg().provider] || (provider().multiModel ? provider().suggest.slice(0, 3) : [cfg().model]);

  /**
   * The same request on several models, with the to-read list / watchlist hidden from the prompt.
   * Each is scored on suggestions that exist, ones you've already seen (instructions ignored) and
   * ones that land on the hidden list: a model that finds what you already wanted reads your taste.
   * Nothing is added to the queue. onProgress(rows) fires as results come in.
   */
  async function bakeoff(models = bakeoffModels(), onProgress) {
    if (!enabled()) throw new AIError('Connect a provider first.', 'config');
    const user = buildPrompt(30, { holdOut: true });
    const hidden = new Set(), hiddenTitles = new Set(), seen = new Set(), seenTitles = new Set();
    for (const b of state.library) {
      const e = state.enrich[b.gid];
      const keys = e && !e.miss ? e.keys || [e.key] : [];
      const title = D.titleKey(b.title, b.author, b.year);
      if (b.exclusive === 'to-read') {
        keys.forEach((k) => hidden.add(k));
        hiddenTitles.add(title);
      } else {
        keys.forEach((k) => seen.add(k));
        seenTitles.add(title);
      }
    }
    const rows = models.map((model) => ({ model, state: 'waiting', hitTitles: [] }));
    const update = () => onProgress?.(rows.map((r) => ({ ...r })));
    update();
    await Promise.all(
      models.map(async (model, i) => {
        const row = rows[i];
        row.state = 'running';
        update();
        const t0 = performance.now();
        try {
          const reply = await complete({ system: SYSTEM, user, schema: SCHEMA, model });
          const parsed = parseReply(reply.text);
          Object.assign(row, { suggested: parsed.recs.length, found: 0, seen: 0, hits: 0, fresh: 0 });
          update();
          await Promise.all(
            parsed.recs.map(async (r, j) => {
              await sleep(j * 50); // be gentle with the source
              let doc = null;
              try {
                doc = await DQ.source.findWork(r.title, r.author, r.year);
              } catch {}
              if (!doc) return;
              row.found++;
              const title = D.titleKey(doc.title, doc.authors?.[0], doc.year);
              if (hidden.has(doc.key) || hiddenTitles.has(title)) {
                row.hits++;
                row.hitTitles.push(doc.title);
              } else if (seen.has(doc.key) || seenTitles.has(title)) row.seen++;
              else row.fresh++;
              update();
            })
          );
          Object.assign(row, {
            state: 'done',
            cost: reply.cost ?? estimateCost(model, reply.usage),
            seconds: Math.round((performance.now() - t0) / 100) / 10,
          });
        } catch (e) {
          Object.assign(row, { state: 'error', error: e.message });
        }
        update();
      })
    );
    cfg().bakeoff = { t: Date.now(), hidden: hiddenTitles.size, rows: rows.map((r) => ({ ...r, hitTitles: r.hitTitles.slice(0, 8) })) };
    DQ.store.save('ai');
    return cfg().bakeoff;
  }

  // ---------- one-click OpenRouter (OAuth PKCE) ----------
  // The user approves on openrouter.ai and comes back here with a one-time code, which this page
  // swaps for a key of their own. No server involved; the key never leaves the browser and OpenRouter.
  const PKCE_KEY = 'dqg:or-pkce';
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const canConnect = () => location.protocol.startsWith('http') && !!window.crypto?.subtle;

  async function connectOpenRouter({ model = DEFAULT_MODEL } = {}) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, model, t: Date.now() }));
    const qs = new URLSearchParams({ callback_url: location.origin + location.pathname, code_challenge: challenge, code_challenge_method: 'S256' });
    location.href = `https://openrouter.ai/auth?${qs}`;
  }

  /** Back from OpenRouter with ?code=…: exchange it for the key and switch AI assist on. */
  async function completeOpenRouterAuth() {
    const code = new URLSearchParams(location.search).get('code');
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    } catch {}
    if (!code || !pending?.verifier) return null;
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', `${location.pathname}${location.hash || '#/how'}`);
    try {
      const res = await http(
        'https://openrouter.ai/api/v1/auth/keys',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: 'S256' }) },
        30000
      );
      if (!res.ok) throw await failFrom(res);
      const { key } = await res.json();
      if (!key) throw new AIError('OpenRouter did not return a key.', 'auth');
      const model = pending.model || DEFAULT_MODEL;
      saveSettings({ provider: 'openrouter', model, base: '', key, remember: true, auto: true });
      return { ok: true, model };
    } catch (e) {
      cfg().lastError = { message: `Connecting OpenRouter failed: ${e.message}`, t: Date.now() };
      DQ.store.save('ai');
      return { ok: false, message: e.message };
    }
  }

  DQ.ai = {
    PROVIDERS, RECOMMENDED, DEFAULT_MODEL, enabled, provider, modelLabel, getKey, saveSettings, forget, setModel,
    listModels, run, maybeRefresh, estimateTokens, recFor, isRunning: () => !!running,
    loadPrices, priceFor, runCost, estimateCost, modelStats, bakeoff, bakeoffModels,
    canConnect, connectOpenRouter, completeOpenRouterAuth,
  };
})();
