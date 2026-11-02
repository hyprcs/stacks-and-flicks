/* Set up AI picks: the guided page (#/connect).

   Written for someone who has never seen an API key. Top to bottom: what you get, what actually
   happens, the few words worth knowing, a step-by-step guide for every service (each ending in a
   box that checks the key the moment it's pasted), and what "a bigger model" means for the picks,
   told through the domain's metaphor (booksellers for Stacks, video-shop clerks for Flicks).
   Once connected, the same page is where you change model or fix a problem. */
(function () {
  const { html, icon, mount, $, $$, plural, toast } = DQ.util;
  const state = DQ.state;
  const D = DQ.D;
  const W = D.w;
  const G = D.guide;
  const App = D.brand.name;
  const P = DQ.ai.PROVIDERS;
  const cost = DQ.ai.fmtCost;
  DQ.views = DQ.views || {};

  let root = null;
  let openGuide = null; // which service's guide is unfolded
  let localModels = null; // models found on this computer, once looked for
  let livePrices = false;

  const onThisComputer = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  const persona = (level) => G.metaphor.levels[level]?.name || '';
  const link = (url, label) => html`<a href="${url}" target="_blank" rel="noopener">${label}&nbsp;${icon('external')}</a>`;

  function perBatch(id) {
    const c = DQ.ai.runCost(id);
    return c == null ? '' : c === 0 ? 'Free' : `About ${cost(c)} a batch`;
  }
  // What a model costs with this service: a free allowance comes before any price.
  const costWith = (p, id) => (p.freeTier ? 'Free within the daily allowance' : perBatch(id));
  // Smallest first, so models read in the same order as the rule of thumb.
  const LEVELS = ['light', 'solid', 'deep'];
  const bySize = (tiers) => {
    const rank = (t) => LEVELS.indexOf(t.level) * 1000 + (DQ.ai.runCost(t.id) || 0);
    return [...tiers].sort((a, b) => rank(a) - rank(b));
  };

  // "$5 covers about 250 batches": rounded down, so it under-promises.
  function batchesFor(dollars, id = DQ.ai.DEFAULT_MODEL) {
    const c = DQ.ai.runCost(id);
    if (!c) return 'a couple of hundred';
    const n = dollars / c;
    return `about ${n >= 100 ? Math.floor(n / 50) * 50 : Math.max(10, Math.floor(n / 10) * 10)}`;
  }

  // ---------- the guides ----------
  function keyForm(pid, { label = 'Paste your key here', placeholder = P[pid]?.keyHint || '' } = {}) {
    return html`<form class="cx-key" data-provider="${pid}" autocomplete="off">
      <label for="key-${pid || 'any'}">${label}</label>
      <div class="cx-key-row">
        <input id="key-${pid || 'any'}" name="key" type="password" spellcheck="false" placeholder="${placeholder}">
        <button class="btn btn-primary" type="submit">${icon('key')} Check and connect</button>
      </div>
      <p class="cx-msg" role="status"></p>
    </form>`;
  }

  function localForm() {
    return html`<form class="cx-key" data-provider="local" autocomplete="off">
      <input type="hidden" name="base" value="${P.local.base}">
      ${localModels?.length
        ? html`<label for="local-model">Found ${plural(localModels.length, 'model')} on this computer. Which one should ${App} use?</label>
            <div class="cx-key-row">
              <select id="local-model" name="model">${localModels.map((m) => html`<option>${m}</option>`)}</select>
              <button class="btn btn-primary" type="submit">${icon('check')} Use this model</button>
            </div>`
        : html`<div class="cx-key-row"><button class="btn btn-primary" type="submit">${icon('compass')} Find my models</button></div>`}
      <p class="cx-msg" role="status"></p>
    </form>`;
  }

  const SERVICES = [
    {
      id: 'openrouter',
      title: 'OpenRouter',
      badge: 'Easiest',
      pitch: 'One account that reaches the models of every AI company, free ones included. Connects in one click, with no key to copy.',
      money: 'Free to start',
      steps: () =>
        DQ.ai.canConnect()
          ? [
              html`Press <b>Connect OpenRouter</b> below. It takes you to openrouter.ai.`,
              html`Sign in there, or create a free account. A Google account or an email address is all it needs.`,
              html`OpenRouter asks whether ${App} may use your account. Approve it and you land back here, connected.`,
            ]
          : [
              html`Open ${link('https://openrouter.ai/keys', 'OpenRouter’s keys page')} and sign in, or create a free account. A Google account or an email address is all it needs.`,
              html`Press <b>Create API Key</b>, give it a name such as “${App}”, and create it.`,
              html`Copy the key it shows you (it starts with <code>sk-or-</code>). It is shown only once.`,
              html`Paste it below.`,
            ],
      form: () =>
        DQ.ai.canConnect()
          ? html`<div class="cx-key">
              <div class="cx-key-row"><button class="btn btn-primary btn-lg" type="button" data-connect>${icon('spark')} Connect OpenRouter</button></div>
              <p class="cx-msg faint">Already made a key on OpenRouter yourself? Paste it into “Already have a key?” above.</p>
            </div>`
          : keyForm('openrouter'),
      notes: () => [
        html`<b>What it costs.</b> A new account starts on a free model: up to 50 requests a day, and a batch of picks is one request.
          To unlock the stronger models, ${link(P.openrouter.creditUrl, 'add credit on OpenRouter')}: $5 covers ${batchesFor(5)} batches on the recommended model.`,
        html`<b>Why start here.</b> You can switch between models from Google, OpenAI, Anthropic and others without opening another account, and it reports the real cost of every batch.`,
      ],
    },
    {
      id: 'gemini',
      title: 'Google Gemini',
      badge: 'Free, no card',
      pitch: 'All you need is a Google account. Google’s free allowance covers a good model with no payment details.',
      money: 'Free within a daily allowance',
      steps: () => [
        html`Open ${link(P.gemini.keyUrl, 'Google AI Studio’s key page')} and sign in with your Google account. The first time, it asks you to accept its terms.`,
        html`Press <b>Create API key</b>. (For a first-time visitor Google often makes one automatically, and it is already in the list.)`,
        html`Press the copy button beside the key.`,
        html`Paste it below.`,
      ],
      form: () => keyForm('gemini', { placeholder: 'Your Gemini key' }),
      notes: () => [
        html`<b>What it costs.</b> Nothing, within Google’s daily free allowance, which is plenty for this. If you later switch on billing in AI Studio, a batch costs ${cost(DQ.ai.runCost('gemini-3.8-flash'))} or so.`,
        html`<b>Worth knowing.</b> On the free allowance Google may use what you send to improve its products. If you would rather it didn’t, switch on billing there or pick another service.`,
      ],
    },
    {
      id: 'anthropic',
      title: 'Anthropic',
      badge: 'Makers of Claude',
      pitch: 'Claude models are especially good at reading why you like things and explaining each pick.',
      money: () => `About ${cost(DQ.ai.runCost('claude-sonnet-5-5'))} a batch`,
      steps: () => [
        html`Open the ${link('https://platform.claude.com', 'Claude Console')} and create an account. This is separate from the Claude chat app: a Claude subscription doesn’t carry over.`,
        html`Add credit: open ${link(P.anthropic.creditUrl, 'Billing')} and buy a small amount. The minimum, about $5, goes a long way.`,
        html`Open ${link(P.anthropic.keyUrl, 'API keys')}, press <b>Create Key</b> and name it “${App}”.`,
        html`Copy the key straight away (it starts with <code>sk-ant-</code>). It is shown only once.`,
        html`Paste it below.`,
      ],
      form: () => keyForm('anthropic'),
      notes: () => [
        html`<b>What it costs.</b> ${perBatch('claude-sonnet-5-5')} on Claude Sonnet 5.5, where you start. Claude Opus 5.5 reads your taste more closely for about twice that, and Claude Haiku 5.5 costs about a twentieth.`,
      ],
    },
    {
      id: 'openai',
      title: 'OpenAI',
      badge: 'Makers of ChatGPT',
      pitch: 'The GPT models, straight from the company that makes them.',
      money: () => `From ${cost(DQ.ai.runCost('gpt-6-luna'))} a batch`,
      steps: () => [
        html`Open the ${link('https://platform.openai.com', 'OpenAI Platform')} and sign up or sign in. This is separate from ChatGPT: a ChatGPT Plus subscription doesn’t include it.`,
        html`Add credit: open ${link(P.openai.creditUrl, 'Billing')}, add a payment method and buy a small amount. The minimum, about $5, goes a long way.`,
        html`Open ${link(P.openai.keyUrl, 'API keys')} and press <b>Create new secret key</b>. Name it “${App}”.`,
        html`Copy the key straight away (it starts with <code>sk-</code>). It is shown only once.`,
        html`Paste it below.`,
      ],
      form: () => keyForm('openai'),
      notes: () => [
        html`<b>What it costs.</b> ${perBatch('gpt-6-luna')} on GPT-6 Luna (what you start on), or ${cost(DQ.ai.runCost('gpt-6-sol'))} on the larger GPT-6 Sol.`,
      ],
    },
    {
      id: 'huggingface',
      title: 'Hugging Face',
      badge: 'Open models',
      pitch: 'The home of open models that anyone can inspect and run. Good value if you like the idea of open technology.',
      money: 'Small free allowance, then pennies',
      steps: () => [
        html`Create a free account at ${link('https://huggingface.co/join', 'huggingface.co')}, or sign in.`,
        html`Open ${link(P.huggingface.keyUrl, 'this new-token page')}. The one permission it needs, <b>Make calls to Inference Providers</b>, is already ticked.`,
        html`Give the token a name such as “${App}” and press <b>Create token</b>.`,
        html`Copy the token (it starts with <code>hf_</code>). It is shown only once.`,
        html`Paste it below.`,
      ],
      form: () => keyForm('huggingface', { label: 'Paste your token here' }),
      notes: () => [
        html`<b>What it costs.</b> A free account includes a small monthly allowance (about 10¢, enough for a handful of batches). After that, ${link(P.huggingface.creditUrl, 'add credit')}: a batch is a fraction of a cent on the model you start on.`,
      ],
    },
    {
      id: 'local',
      title: 'On your own computer',
      badge: 'Private',
      pitch: 'Run a model on this machine with Ollama. Nothing leaves your computer and nothing is charged, but it needs a fairly recent computer and the picks are weaker.',
      money: 'Free',
      steps: () => [
        html`Download and install ${link(P.local.keyUrl, 'Ollama')}, a free app that runs AI models on your own computer. Open it once it’s installed.`,
        html`Get a model. Open a terminal (on Windows: Start menu, type <b>cmd</b>, Enter), type <code>ollama pull gemma3</code> and press Enter. It’s a download of a few gigabytes.`,
        ...(onThisComputer
          ? []
          : [html`Because this page lives on the web rather than on your computer, Ollama has to be told to trust it: set <code>OLLAMA_ORIGINS</code> to <code>${location.origin}</code> and restart Ollama (${link('https://docs.ollama.com/faq', 'how to')}).`]),
        html`Press <b>Find my models</b> below.`,
      ],
      form: localForm,
      notes: () => [
        html`<b>Worth knowing.</b> A model small enough for a home computer is ${persona('light').toLowerCase()} at best: expect more well-known picks and more made-up titles (which ${App} throws away).
          With 16 GB of memory or more, <code>ollama pull gemma3:12b</code> knows noticeably more.`,
        html`<b>LM Studio</b> works too: start its local server, then use <button class="linkish" type="button" data-advanced>advanced settings</button> with the address <code>http://localhost:1234/v1</code>.`,
      ],
    },
  ];

  // The models a service offers, shown in its guide so the choice is known before connecting.
  function options(pid) {
    const p = P[pid];
    if (p.tiers.length < 2) return '';
    const start = DQ.ai.usualStart(pid);
    return html`<div class="guide-options">
      <h4>The models you can choose from</h4>
      <ul>${bySize(p.tiers).map((t) => html`<li class="${t.id === start ? 'start' : ''}">
        <span><b>${t.name}</b> <span class="cx-chip lv-${t.level}">${persona(t.level)}</span></span>
        <span class="guide-option-why">${t.why}</span>
        <span class="guide-option-cost">${costWith(p, t.id)}${t.id === start ? html` <span class="pill">${pid === 'openrouter' ? 'New accounts start here' : 'You start here'}</span>` : ''}</span>
      </li>`)}</ul>
      <p class="cx-fine">You aren’t locked in: once connected, switching between these is one click on this page.</p>
    </div>`;
  }

  function guide(s) {
    return html`<details class="guide" name="cx-guide" data-guide="${s.id}" ${openGuide === s.id ? 'open' : ''}>
      <summary>
        <span class="guide-name">${s.title} ${s.badge ? html`<span class="pill">${s.badge}</span>` : ''}</span>
        <span class="guide-pitch">${s.pitch}</span>
        <span class="guide-money">${typeof s.money === 'function' ? s.money() : s.money}</span>
      </summary>
      <div class="guide-body">
        <ol class="guide-steps">${s.steps().map((t, i) => html`<li><span class="how-num">${i + 1}</span><div>${t}</div></li>`)}</ol>
        ${s.form()}
        ${options(s.id)}
        <ul class="guide-notes">${s.notes().map((n) => html`<li>${n}</li>`)}</ul>
      </div>
    </details>`;
  }

  function servicesCard(connected) {
    return html`<div class="pcard span-12" id="cx-services">
      <h2>${icon('key')} ${connected ? 'Use a different service' : 'Choose how to connect'}</h2>
      <p class="sub">${connected ? 'Connecting another service replaces the current one.' : 'Pick one. Each guide takes a couple of minutes and ends with your first picks.'}</p>
      ${keyForm('', { label: 'Already have a key from one of these? Paste it here and it sorts out the rest.', placeholder: 'sk-…   AIza…   hf_…' })}
      <div class="guides">${SERVICES.map(guide)}</div>
      <p class="cx-fine">Using something else, such as another OpenAI-compatible service?
        <button class="linkish" type="button" data-advanced>Advanced settings</button> lets you enter an address, a key and a model by hand.</p>
    </div>`;
  }

  // ---------- why, and what happens ----------
  function benefitsCard() {
    return html`<div class="pcard span-12">
      <h2>${icon('spark')} What you get</h2>
      <p class="sub">Your queue works without it. This is what it adds.</p>
      <ul class="cx-cards">${G.benefits.map((b) => html`<li>${icon(b.icon)}<div><h3>${b.title}</h3><p>${b.text}</p></div></li>`)}</ul>
    </div>`;
  }

  function flowCard() {
    const steps = [
      html`${App} sends the AI model ${G.sends}. ${G.notSent}`,
      html`The model replies with about 30 suggestions, each with a sentence on why it’s for you. That is one <b>batch</b>.`,
      html`Every suggestion is looked up on ${W.source}. Anything that doesn’t exist is thrown away; the rest join your queue a few at a time, marked as AI picks.`,
    ];
    const words = [
      ['AI model', `The “reader” that makes the suggestions: the same kind of thing as ChatGPT, Claude or Gemini.`],
      ['Service', `The company that runs the model. Your account is with them, not with ${App}.`],
      ['API key', `A long, password-like code from that service which lets ${App} ask the model questions on your account. Think of a library card number: whoever holds it can borrow in your name, so don’t share it. ${App} keeps it in this browser and sends it only to that service.`],
      ['Credit', `Money you put on your account with the service in advance, like topping up a travel card. Each batch uses a little. When it runs out the picks simply stop: nothing more is charged unless you switch on automatic top-ups there.`],
    ];
    return html`<div class="pcard span-7">
        <h2>${icon('refresh')} What actually happens</h2>
        <p class="sub">Three steps, each time you ask for picks.</p>
        <ol class="guide-steps">${steps.map((t, i) => html`<li><span class="how-num">${i + 1}</span><div>${t}</div></li>`)}</ol>
      </div>
      <div class="pcard span-5">
        <h2>${icon('book')} Four words worth knowing</h2>
        <p class="sub">The guides below use them.</p>
        <dl class="cx-words">${words.map(([w, d]) => html`<div><dt>${w}</dt><dd>${d}</dd></div>`)}</dl>
      </div>`;
  }

  // ---------- the model metaphor ----------
  const LEVEL_LABEL = { light: 'Small models', solid: 'Mid-size models', deep: 'Large models' };

  function examples(level) {
    const names = [];
    for (const p of Object.values(P)) for (const t of p.tiers) if (t.level === level && !names.includes(t.name)) names.push(t.name);
    if (level === 'light') names.splice(2, 0, 'the free models, and anything that runs on a home computer');
    return names.slice(0, 3);
  }

  function levelCost(level) {
    const c = (id) => cost(DQ.ai.runCost(id));
    if (level === 'light') return 'Free, or a fraction of a cent';
    if (level === 'solid') return `About ${c(DQ.ai.DEFAULT_MODEL)}`;
    return `About ${c('claude-sonnet-5-5')} to ${c('claude-opus-5-5')}`;
  }

  function metaphorCard() {
    const M = G.metaphor;
    const current = DQ.ai.enabled() ? DQ.ai.modelInfo(state.ai.model)?.level : null;
    return html`<div class="pcard span-12" id="cx-models">
      <h2>${icon('layers')} Which model? A rule of thumb</h2>
      <p class="sub">The model you choose changes the quality of your picks more than anything else here.</p>
      <p class="cx-lead"><b>${M.lead}</b> ${M.text}</p>
      <div class="cx-levels">${LEVELS.map((lv, i) => {
        const L = M.levels[lv];
        return html`<div class="cx-level lv-${lv} ${current === lv ? 'current' : ''}">
          <div class="cx-level-kind">${LEVEL_LABEL[lv]}${current === lv ? html` <span class="pill">Yours</span>` : ''}</div>
          <h3>${L.name}</h3>
          <p>${L.text}</p>
          <dl>
            ${M.rows.map((r) => html`<div><dt>${r[0]}</dt><dd>${r[i + 1]}</dd></div>`)}
            <div><dt>Cost of a batch</dt><dd>${levelCost(lv)}</dd></div>
            <div><dt>Such as</dt><dd>${examples(lv).join(', ')}</dd></div>
          </dl>
        </div>`;
      })}</div>
      <p class="cx-fine">These are tendencies, not promises: a newer small model can beat an older large one. Once you’re connected through OpenRouter or Hugging Face,
        <a href="#/how">Test models on your taste</a> runs a blind test with your ${W.wishlistRef.replace(/^your /i, '')} list hidden and shows which model reads you best for the money.</p>
    </div>`;
  }

  // ---------- connected: status, problems, changing model ----------
  function problem() {
    const e = state.ai.lastError;
    if (!e) return '';
    const p = DQ.ai.provider();
    const fixes = [];
    // Running out of a free allowance is fixed the same way as running out of credit.
    const onFree = p.freeTier || /:free$/.test(state.ai.model || '');
    if (p.creditUrl && (e.kind === 'credit' || (e.kind === 'rate' && onFree))) {
      fixes.push(html`<a class="btn btn-sm" href="${p.creditUrl}" target="_blank" rel="noopener">${icon('external')} ${p.freeTier ? 'Switch on billing' : 'Add credit'} on ${p.name}</a>`);
    }
    if (e.kind === 'credit' && state.ai.provider === 'openrouter' && state.ai.model !== DQ.ai.FREE_MODEL) {
      fixes.push(html`<button class="btn btn-sm" type="button" data-use="${DQ.ai.FREE_MODEL}">Use the free model for now</button>`);
    }
    if (e.kind === 'auth') fixes.push(html`<button class="btn btn-sm" type="button" data-reconnect>${icon('key')} Connect again</button>`);
    else if (e.kind !== 'credit') fixes.push(html`<button class="btn btn-sm" type="button" data-run>${icon('refresh')} Try again</button>`);
    return html`<div class="cx-problem" role="alert">${icon('warn')}
      <div>
        <p><b>The last request didn’t work.</b> ${e.message}</p>
        ${e.detail ? html`<p class="cx-detail">What ${p.name} said: “${e.detail}”</p>` : ''}
        <div class="ai-actions">${fixes}</div>
      </div>
    </div>`;
  }

  function chooser() {
    const c = state.ai;
    const p = DQ.ai.provider();
    if (!p.tiers.length) {
      return html`<p class="muted">You’re using <code>${c.model}</code>. To use a different one, open
        <button class="linkish" type="button" data-advanced>advanced settings</button>.</p>`;
    }
    const others = p.tiers.filter((t) => t.id !== c.model).length;
    return html`<p class="cx-fine cx-others">There ${others === 1 ? 'is one other model' : `are ${others} other models`} to choose from with ${p.name}.
        Switching costs nothing and takes effect from your next batch.</p>
      <div class="cx-models">${bySize(p.tiers).map((t) => {
        const on = c.model === t.id;
        return html`<div class="cx-model ${on ? 'current' : ''}">
          <div class="cx-model-head"><b>${t.name}</b><span class="cx-chip lv-${t.level}">${persona(t.level)}</span></div>
          <p>${t.why}</p>
          <div class="cx-model-foot"><span>${costWith(p, t.id)}</span>
            ${on ? html`<span class="pill">In use</span>` : html`<button class="btn btn-sm" type="button" data-use="${t.id}">Use this one</button>`}</div>
        </div>`;
      })}</div>
      ${p.tiers.some((t) => t.id === c.model) ? '' : html`<p class="muted">You’re using <code>${c.model}</code>, chosen in advanced settings.</p>`}
      ${c.provider === 'openrouter'
        ? html`<p class="cx-fine">The free model needs no credit. The others draw on your OpenRouter balance: ${link(p.creditUrl, 'add credit')} ($5 covers ${batchesFor(5)} batches on ${DQ.ai.modelName(DQ.ai.DEFAULT_MODEL)}).</p>`
        : c.provider === 'gemini'
          ? html`<p class="cx-fine">If you switch on billing with Google, a batch costs about ${cost(DQ.ai.runCost('gemini-3.8-flash'))} on Gemini 3.8 Flash.</p>`
          : ''}`;
  }

  function statusCard() {
    const c = state.ai;
    const p = DQ.ai.provider();
    const info = DQ.ai.modelInfo(c.model);
    const running = DQ.ai.isRunning();
    const ready = DQ.app.ready();
    const st = c.lastStats;
    return html`<div class="pcard span-12 cx-status" id="cx-status">
      <h2>${icon('check')} AI picks are on</h2>
      <p class="cx-now">Connected to <b>${p.name}</b>, using <b>${DQ.ai.modelName(c.model)}</b>${info ? html` (${persona(info.level).toLowerCase()})` : ''}${
        perBatch(c.model) ? html` · ${perBatch(c.model).toLowerCase()}` : ''}.</p>
      <p class="sub">${
        running ? `Asking for ${W.items} now. This takes up to a minute.`
        : !ready ? `Your first picks will arrive once you have imported your ${W.service} export.`
        : c.lastRun && st ? `Last batch: ${st.suggested} suggested, ${st.found} found on ${W.source}, ${st.added} new in your queue${st.cost != null ? ` (${cost(st.cost)})` : ''}.`
        : 'No picks yet. Ask for your first batch below.'
      }${c.auto && ready ? ' A new batch is fetched after a queue when the last one is nearly used up.' : ''}</p>
      ${problem()}
      <div class="ai-actions">
        ${ready
          ? html`<button class="btn btn-primary" type="button" data-run ${running ? 'disabled' : ''}>${icon('spark')} ${running ? 'Working…' : 'Get new AI picks'}</button>
              <a class="btn" href="#/queue">${icon('next')} Go to your queue</a>`
          : html`<a class="btn btn-primary" href="#/import">${icon('upload')} Import your ${W.service} export</a>`}
        <button class="btn btn-ghost btn-danger" type="button" data-off>Turn off and forget key</button>
      </div>
      <h3 class="how-h3">Change model</h3>
      ${chooser()}
    </div>`;
  }

  // ---------- questions ----------
  function faqCard() {
    const qa = [
      ['I already pay for ChatGPT Plus or Claude Pro. Can I use that?',
        html`Not directly. Those subscriptions cover the chat apps only. Connecting another app, like this one, uses the company’s pay-as-you-go side, which has its own small balance.
          If you would rather pay nothing, OpenRouter’s free model and Google’s free allowance both work.`],
      ['Could it run up a bill?',
        html`A batch is a single request, and its cost is shown beside each model. ${App} asks for one when you press <b>Get new AI picks</b> and, at most, once after you finish a queue when the last batch is nearly used up.
          With credit bought in advance, the most you can ever spend is what you put in.`],
      ['What does the AI company see?',
        html`${G.sends.charAt(0).toUpperCase() + G.sends.slice(1)}. ${G.notSent} It goes straight from this page to the company you chose; ${App} has no server in between.
          Each company has its own rules about how long it keeps requests.`],
      ['What if it recommends something that doesn’t exist?',
        html`It happens, more with small models. Every suggestion is checked against ${W.source} first, and anything that isn’t there never reaches your queue. You just get fewer picks from that batch.`],
      ['How do I stop?',
        html`Press <b>Turn off and forget key</b> here or on Your Taste. The key is erased from this browser; picks already in your queue stay. For good measure you can also delete the key on the service’s own site.
          On a shared computer, do this when you’re finished.`],
    ];
    return html`<div class="pcard span-12">
      <h2>Good questions</h2>
      <p class="sub">The things people usually ask before connecting.</p>
      <div class="cx-faq">${qa.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div>
    </div>`;
  }

  // ---------- render ----------
  function render(r) {
    root = r;
    const on = DQ.ai.enabled();
    mount(
      root,
      html`<section class="page connect">
        <div class="how-head">
          ${DQ.brandMark('how-mark')}
          <div>
            <div class="eyebrow">AI picks · optional</div>
            <h1>${G.title}</h1>
          </div>
        </div>
        <p class="summary-text how-intro">${G.intro}</p>
        ${on
          ? ''
          : html`<div class="cx-cta">
              ${DQ.ai.canConnect() ? html`<button class="btn btn-primary btn-lg" type="button" data-connect>${icon('spark')} Connect OpenRouter</button>` : ''}
              <button class="btn ${DQ.ai.canConnect() ? '' : 'btn-primary btn-lg'}" type="button" data-jump="cx-services">See every way to connect</button>
              <span class="faint">About two minutes. Free to start, and you can switch it off whenever you like.</span>
            </div>`}
        <div class="pgrid">
          ${on ? html`${statusCard()}${metaphorCard()}${servicesCard(true)}${faqCard()}` : html`${benefitsCard()}${flowCard()}${servicesCard(false)}${metaphorCard()}${faqCard()}`}
        </div>
      </section>`
    );
    bind();
    if (!livePrices) {
      DQ.ai.loadPrices().then((live) => {
        if (!live) return;
        livePrices = true;
        rerender();
      });
    }
  }

  // Redraw in place, unless someone is in the middle of pasting a key.
  function rerender() {
    if (!root?.isConnected) return;
    if (root.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    openGuide = $('details.guide[open]', root)?.dataset.guide || null;
    const y = window.scrollY;
    render(root);
    window.scrollTo(0, y);
  }

  function say(form, text, bad = false) {
    const el = $('.cx-msg', form);
    el.textContent = text;
    el.classList.toggle('bad', bad);
  }

  function connected({ provider, model, freeTier }) {
    openGuide = null;
    const ready = DQ.app.ready();
    const choice = P[provider].tiers.length > 1 ? 'The other models are listed under Change model. ' : '';
    toast(
      html`<b>Connected to ${P[provider].name}.</b> ${freeTier ? 'You’re starting on the free model. ' : `You’re starting on ${DQ.ai.modelName(model)}. `}${choice}${ready ? 'Your first AI picks are on the way.' : ''}`,
      { timeout: 9000 }
    );
    render(root);
    window.scrollTo(0, 0);
    if (ready) DQ.ai.run().catch(() => {});
  }

  async function submitKey(form) {
    const pid = form.dataset.provider;
    const btn = $('button[type="submit"]', form);
    const key = form.key?.value.trim() || '';
    if (pid !== 'local' && !key) return say(form, 'Paste your key into the box first.', true);
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    say(form, '');
    try {
      if (pid === 'local' && !localModels?.length) {
        // First press: see what's installed, then offer the choice.
        localModels = (await DQ.ai.checkKey({ provider: 'local', base: form.base.value })).models;
        openGuide = 'local';
        return render(root);
      }
      // A key says where it's from; trust that over the guide it was pasted into.
      const provider = pid === 'local' ? 'local' : DQ.ai.detectProvider(key) || pid || null;
      connected(await DQ.ai.connectWithKey({ key, provider, model: form.model?.value, base: form.base?.value }));
    } catch (e) {
      say(form, e.message, true);
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  function showGuide(id) {
    const el = $(`details.guide[data-guide="${id}"]`, root);
    if (!el) return;
    $$('details.guide', root).forEach((d) => (d.open = d === el));
    if (el.closest('details:not(.guide)')) el.closest('details:not(.guide)').open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bind() {
    root.onsubmit = (e) => {
      const form = e.target.closest('form.cx-key');
      if (!form) return;
      e.preventDefault();
      submitKey(form);
    };
    root.onclick = (e) => {
      const t = (sel) => e.target.closest(sel);
      if (t('[data-connect]')) return DQ.ai.connectOpenRouter();
      if (t('[data-jump]')) return $('#' + t('[data-jump]').dataset.jump, root)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (t('[data-advanced]')) return DQ.views.profile.editAi();
      if (t('[data-reconnect]')) return showGuide(state.ai.provider);
      if (t('[data-run]')) return DQ.ai.run().catch(() => {});
      if (t('[data-use]')) {
        const id = t('[data-use]').dataset.use;
        DQ.ai.setModel(id);
        toast(html`Using <b>${DQ.ai.modelName(id)}</b> from the next batch.`);
        return rerender();
      }
      if (t('[data-off]')) {
        DQ.ai.forget();
        DQ.app.invalidate();
        localModels = null;
        toast('AI picks are off and the key is forgotten. Picks already in your queue stay.');
        render(root);
        window.scrollTo(0, 0);
      }
    };
  }

  // Keep the status current while a batch is in flight.
  document.addEventListener('dq:ai', rerender);

  DQ.views.connect = {
    render,
    destroy() {
      root = null;
    },
  };
})();
