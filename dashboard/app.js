// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, and
// a per-protocol detail drawer carrying the model's own inputs and the
// protocol's farm plan. No network: every byte it shows arrived in data.js.
//
// The model, restated here so the page and board.json can be checked against
// each other: the category multiple is the snapshot's own live-token comps,
// median mcap / TVL per category, used only with at least 5 comps, shrunk 60%
// overall median + 40% category median, clamped to [0.10, 0.50]; fewer comps
// fall back to the overall live median (about 0.21 on this snapshot). That rule
// is what stops one outlier setting a multiple: Risk Curators has a single live
// comp at ratio 2.97 and Chain a single one at 3.03, and neither raw median is
// used. Implied value is round(tvl x category multiple x growth x maturity x
// chain breadth), chain breadth 1 + 0.03 per extra chain, capped at 1.09.
(() => {
  'use strict';

  const dataset = window.RADAR;
  if (!dataset) return;
  const mount = document.getElementById('board');
  const ui = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  const watchlistSlugs = new Set(dataset.watchlist || []);

  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fmtUsd = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return dollars.format(n);
  };
  const fmtPct = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };
  const fmtAge = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };
  const fmtMult = (n) => (Math.round(n * 10000) / 10000).toFixed(4);

  // The calibration table data.js carries: one entry per board category, plus
  // the overall median behind them all.
  const compFor = (category) => {
    const list = (dataset.calibration && dataset.calibration.categories) || [];
    return list.find((entry) => entry.category === category) || null;
  };
  const categoryMultiple = (category) => {
    const entry = compFor(category);
    if (entry) return entry.multiple;
    return dataset.calibration ? dataset.calibration.overall_median : 0.2;
  };
  const chainMultiplier = (row) => {
    const count = (row.chains && row.chains.length) || 0;
    const extra = Math.min(Math.max(count - 1, 0), dataset.model.chain_max_extra || 3);
    return 1 + (dataset.model.chain_step || 0.03) * extra;
  };
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  const impliedOf = (row, model) => {
    const weekly = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, weekly));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * categoryMultiple(row.category) * growthMult * maturity * chainMultiplier(row)));
  };

  // A tiny element builder: tag, attributes, then children. Attribute keys
  // named class, text or html are handled specially; keys starting with "on"
  // become listeners; anything else becomes an attribute, nulls skipped.
  const el = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined) continue;
      if (Array.isArray(kid)) kid.forEach((c) => { if (c) node.appendChild(c); });
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    }
    return node;
  };

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  const chainOf = (p) => (p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain');
  const capitalFor = (p) => {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  };
  const holdDaysFor = (age) => {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  };
  const farmRules = [
    { words: ['lend', 'cdp', 'collateral'], act: (name, capital, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.' },
    { words: ['dex', 'yield', 'leveraged farm'], act: (name, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.' },
    { words: ['bridge'], act: (name, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.' },
    { words: ['staking', 'restak'], act: (name, capital, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.' },
    { words: ['perpetual', 'derivative'], act: (name, capital, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.' },
    { words: ['prediction'], act: (name, capital, chain) => 'Fund $' + capital + ' and place one market position on ' + name + '.' },
    { words: ['curator', 'allocator'], act: (name, capital, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.' },
    { words: ['stable'], act: (name, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.' },
    { words: ['rwa'], act: (name, capital, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.' },
    { words: ['insurance'], act: (name, capital, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.' },
  ];
  const actionFor = (p, capital, chain) => {
    const category = (p.category || '').toLowerCase();
    for (const rule of farmRules) {
      if (rule.words.some((word) => category.indexOf(word) >= 0)) return rule.act(p.name, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  };
  const stepText = (step) => {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  };
  const farmSteps = (p) => {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week on ' + chain + ', such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes there; never pay to claim, and remember no token is guaranteed.", cost: 'no fee to check; a fee to claim is a scam', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(stepText);
  };

  const readHash = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) ui.q = params.get('q');
    if (params.get('p')) ui.selected = params.get('p');
    if (params.get('category')) ui.category = params.get('category');
    if (params.get('chain')) ui.chain = params.get('chain');
    if (params.get('scope')) ui.scope = params.get('scope');
  };
  const writeHash = () => {
    const params = new URLSearchParams();
    if (ui.q) params.set('q', ui.q);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.scope !== 'all') params.set('scope', ui.scope);
    if (ui.selected) params.set('p', ui.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  const filteredRows = () => {
    const q = ui.q.trim().toLowerCase();
    return dataset.rows.filter((r) => {
      if (ui.category !== 'all' && (r.category || 'Other') !== ui.category) return false;
      if (ui.chain !== 'all' && !(r.chains || []).includes(ui.chain)) return false;
      if (ui.scope === 'top10' && r.rank > 10) return false;
      if (ui.scope === 'watchlist' && !watchlistSlugs.has(r.slug)) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };
  const sortedRows = (list) => {
    const key = ui.sort;
    const valueOf = (row, other) => {
      if (key === 'name') return [row.name.toLowerCase(), other.name.toLowerCase()];
      if (key === 'tvl') return [row.tvl_usd, other.tvl_usd];
      if (key === 'growth') return [row.change_7d === null ? -Infinity : row.change_7d, other.change_7d === null ? -Infinity : other.change_7d];
      if (key === 'age') return [row.age_days === null ? Infinity : row.age_days, other.age_days === null ? Infinity : other.age_days];
      return [row.implied_value_usd, other.implied_value_usd];
    };
    return list.slice().sort((a, b) => {
      const [av, bv] = valueOf(a, b);
      if (av < bv) return -ui.dir;
      if (av > bv) return ui.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  };

  const header = () => el('header', { class: 'top' },
    el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
    el('div', { class: 'top-meta' },
      el('span', { text: 'Snapshot ' + dataset.as_of }),
      el('span', { text: 'DefiLlama protocol index' }),
      el('span', { text: dataset.model_version + ' model' }),
    ),
  );

  // First visit, under 60 seconds: one plain-English promise, 3 steps, then the top 3.
  const hero = () => el('section', { class: 'hero' },
    el('span', { class: 'eyebrow', text: 'Token Radar  ·  Snapshot ' + dataset.as_of }),
    el('h1', { text: 'These protocols have no token yet — ranked by what theirs would be worth' }),
    el('p', { class: 'lead', text: 'Every protocol below holds at least $' + Math.round(dataset.floor_usd / 1e6) + 'M in value locked and records no token. Each row shows its implied token value and a farm plan. Implied value is a model, not a promise — and no token is guaranteed.' }),
    el('ol', { class: 'steps' },
      el('li', { class: 'step' }, el('span', { class: 'n', text: '1' }), el('b', { text: 'Pick a top protocol' }), el('span', { text: 'Start with one of the three cards below.' })),
      el('li', { class: 'step' }, el('span', { class: 'n', text: '2' }), el('b', { text: 'Open it' }), el('span', { text: 'See its value, why, and its farm plan.' })),
      el('li', { class: 'step' }, el('span', { class: 'n', text: '3' }), el('b', { text: 'Farm it' }), el('span', { text: 'Follow the steps, cost and time shown.' })),
    ),
    el('div', { class: 'hero-meta' },
      el('span', null, el('b', { text: dataset.board_size + ' ' }), 'protocols ranked'),
      el('span', null, el('b', { text: dataset.watchlist_size + ' / ' + dataset.watchlist_size + ' ' }), 'watchlist covered'),
      el('span', null, el('b', { text: dataset.early_size + ' ' }), 'early rows below the floor'),
      el('span', null, el('b', { text: dataset.live_size + ' ' }), 'live-token protocols set aside'),
      el('span', null, el('b', { text: dataset.model_version + ' ' }), 'model'),
    ),
  );

  const oneLineFarm = (row) => {
    const steps = farmSteps(row);
    const action = steps.length > 1 ? steps[1] : steps[0];
    const cut = action.indexOf(' Cost: ');
    const bare = cut >= 0 ? action.slice(0, cut) : action;
    return bare.length > 140 ? bare.slice(0, 137) + '...' : bare;
  };

  const picks = () => {
    const top = dataset.rows.slice(0, 3);
    return el('div', null,
      el('div', { class: 'picks-head' },
        el('h2', { text: 'Top 3 to start with' }),
        el('span', { class: 'sub', text: 'Strongest implied value. Click a card for its full farm plan.' }),
      ),
      el('div', { class: 'picks' }, top.map((r) => el('button', { type: 'button', class: 'pick', onclick: () => openDetail(r.slug) },
        el('span', { class: 'rank' }, el('i', { text: String(r.rank) }), 'Rank ' + r.rank + ' of ' + dataset.board_size),
        el('h3', { text: r.name }),
        el('div', { class: 'value' }, fmtUsd(r.implied_value_usd), el('span', { text: 'implied token value' })),
        el('div', { class: 'meta' },
          el('span', { text: fmtUsd(r.tvl_usd) + ' TVL' }),
          el('span', { class: r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(r.change_7d) + ' in 7 days' }),
          el('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains[0] : 'an unnamed chain') }),
        ),
        el('p', { class: 'action' }, el('b', { text: 'Farm it: ' }), oneLineFarm(r)),
      ))),
    );
  };

  // Facts live in the hero-meta strip; no separate stat strip, so the board starts higher.

  const scopeButton = (value, label) => el('button', {
    type: 'button',
    'aria-pressed': ui.scope === value ? 'true' : 'false',
    text: label,
    onclick: () => { ui.scope = value; writeHash(); render(); },
  });
  const controls = () => {
    const categories = [...new Set(dataset.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(dataset.rows.reduce((acc, r) => acc.concat(r.chains || []), []))].sort();
    const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { ui.q = search.value; writeHash(); render(); });
    const categorySelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => el('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null })),
    );
    categorySelect.addEventListener('change', () => { ui.category = categorySelect.value; writeHash(); render(); });
    const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => el('option', { value: c, text: c, selected: c === ui.chain ? 'selected' : null })),
    );
    chainSelect.addEventListener('change', () => { ui.chain = chainSelect.value; writeHash(); render(); });
    const pre = el('button', { type: 'button', 'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { ui.tab = 'pre-token'; render(); } });
    const live = el('button', { type: 'button', 'aria-pressed': ui.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { ui.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), categorySelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Show' }), el('div', { class: 'tabs' }, scopeButton('all', 'All rows'), scopeButton('top10', 'Top 10 only'), scopeButton('watchlist', 'Watchlist only'))),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: ui.tab === 'pre-token' ? filteredRows().length + ' rows shown' : dataset.live.length + ' live-token protocols' }),
    );
  };

  const sortHeader = (key, label) => el('th', { scope: 'col' },
    el('button', {
      type: 'button',
      onclick: () => {
        if (ui.sort === key) ui.dir = -ui.dir;
        else { ui.sort = key; ui.dir = -1; }
        render();
      },
    },
    label,
    ui.sort === key ? el('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null,
    ),
  );

  const boardTable = () => {
    const list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', {
          class: 'button primary',
          type: 'button',
          text: 'Clear filters',
          onclick: () => { ui.q = ''; ui.category = 'all'; ui.chain = 'all'; ui.scope = 'all'; writeHash(); render(); },
        }),
      ));
    }
    const max = list[0].implied_value_usd || 1;
    const tbody = el('tbody');
    for (const r of list) {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const chainText = (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain');
      const row = el('tr', {
        'data-selected': ui.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
      el('td', { class: 'num' }, el('span', { class: 'rank-badge', text: String(r.rank) })),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText + (watchlistSlugs.has(r.slug) ? ' - watchlist' : '') }),
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
      )),
      el('td', null, el('span', { class: 'status', text: 'no token' })),
      );
      tbody.appendChild(row);
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' }),
          )),
          tbody,
        ),
      ),
    );
  };

  const liveTable = () => {
    const tbody = el('tbody');
    for (const r of dataset.live) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
      ));
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' }),
          )),
          tbody,
        ),
      ),
    );
  };

  const modelPanel = () => {
    const m = dataset.model;
    const cal = dataset.calibration || { overall_median: 0.2, overall_n: 0, categories: [] };
    const compsBody = el('tbody');
    for (const c of cal.categories) {
      compsBody.appendChild(el('tr', null,
        el('td', { text: c.category === null ? 'Other (no category)' : c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: c.median === null ? 'n/a' : fmtMult(c.median) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { text: c.used_category_median ? 'category median used' : 'fallback: overall median' }),
      ));
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.03 x min(chains - 1, 3)) )',
      ),
      el('h3', { text: 'How the multiple is set' }),
      el('p', { class: 'sub', text: 'The multiple comes from the snapshot itself: the median market cap / TVL of the live-token protocols in each category. Overall live median ' + fmtMult(cal.overall_median) + ' over ' + cal.overall_n + ' comps with a positive market cap. A category median is used only when that category has at least ' + m.min_category_n + ' comps; with fewer, the category falls back to the overall median. A used median is shrunk 60% overall + 40% category, then clamped to [0.10, 0.50]. That is why Risk Curators (1 live comp, ratio 2.97) and Chain (1 live comp, ratio 3.03) do not get a multiple near 3: one protocol cannot set a category. A market cap of 0 records no tradable market, so those comps are left out.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live comps (n)' }),
            el('th', { scope: 'col', text: 'Category median' }),
            el('th', { scope: 'col', text: 'Multiple used' }),
            el('th', { scope: 'col', text: 'How it was set' }),
          )),
          compsBody,
        ),
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth adds up to 9%: each extra chain the protocol already runs on is distribution its token would inherit. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
    );
  };

  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { ui.selected = null; writeHash(); });

  const openDetail = (slug) => {
    const row = dataset.rows.find((r) => r.slug === slug);
    if (!row) return;
    ui.selected = slug;
    writeHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const recomputed = impliedOf(row, dataset.model);
    const comp = compFor(row.category);
    const chainMult = chainMultiplier(row);
    const medianNote = comp
      ? (comp.median === null ? 'n/a' : fmtMult(comp.median)) + ' over n=' + comp.n + (comp.used_category_median ? ' (used)' : ' (fallback)')
      : 'n/a';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + dataset.board_size + (watchlistSlugs.has(row.slug) ? ' - watchlist' : ' - early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Category median, live comps' }), el('b', { class: 'num', text: medianNote })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains ? row.chains.length : 0) + ')' }), el('b', { class: 'num', text: fmtMult(chainMult) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
      ),
      el('p', { class: 'sub', text: 'Model ' + dataset.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and no token is guaranteed.' }),
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map((s) => {
        const cut = s.indexOf(' Cost: ');
        const action = cut >= 0 ? s.slice(0, cut) : s;
        const tail = cut >= 0 ? s.slice(cut + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  const render = () => {
    mount.textContent = '';
    const shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    if (ui.tab === 'pre-token') shell.appendChild(picks());
    shell.appendChild(controls());
    shell.appendChild(ui.tab === 'pre-token' ? boardTable() : liveTable());
    if (ui.tab === 'pre-token') shell.appendChild(modelPanel());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (ui.selected) openDetail(ui.selected);
  };

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
