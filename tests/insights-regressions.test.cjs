const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, from, to, scope) {
  const source = read(file), start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), scope);
}

test('tracking survives blocked storage and never forwards order tokens in GA page URLs', async () => {
  const posts = [], scripts = [];
  const scope = vm.createContext({ URL, AbortSignal, Date, Math,
    localStorage: { getItem: () => JSON.stringify({ analytics: true, marketing: false, signature: 'G-FIXTURE123|', updatedAt: Date.now() }) },
    sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    location: { href: 'https://www.rstreet.com.br/confirmacao.html?pedido=1&token=private#secret', pathname: '/confirmacao.html' },
    document: { title: 'Confirmação', referrer: 'https://example.test/path?email=secret', addEventListener() {},
      querySelector: () => ({ appendChild() {} }),
      createElement: () => ({ addEventListener() {} }), head: { appendChild: script => scripts.push(script) } },
    fetch: async (url, options) => {
      if (url === '/api/public-config') return { ok: true, json: async () => ({ gaMeasurementId: 'G-FIXTURE123', metaPixelId: '', engagementApi: 'https://evil.invalid' }) };
      posts.push({ url, data: JSON.parse(options.body) }); return {};
    }, window: {},
  });
  scope.window.location = scope.location;
  vm.runInContext(read('rstreet-tracking.js'), scope);
  await new Promise(resolve => setImmediate(resolve));
  scope.window.RStreetTrack.pageView();
  scope.window.RStreetTrack.addToCart({ id: 1, preco: 99, qty: 2 });
  const calls = scope.window.dataLayer.map(args => Array.from(args));
  const page = calls.find(args => args[0] === 'event' && args[1] === 'page_view')[2];
  assert.equal(page.page_location, 'https://www.rstreet.com.br/confirmacao.html');
  assert.equal(page.page_referrer, 'https://example.test/path');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].data.sessao_id, posts[1].data.sessao_id);
  assert.ok(posts.every(post => post.url === 'https://rstreet-backend.onrender.com/api/engajamento/metricas'));
  assert.equal(scripts.filter(script => script.src).length, 1);
  assert.equal(calls.find(args => args[1] === 'add_to_cart')[2].value, 198);
});

test('optional trackers stay unloaded until permission and stop after revocation', async () => {
  const nodes = [], head = [], footer = [];
  const node = tag => ({ tag, handlers: {}, dataset: {}, setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; },
    remove() { this.removed = true; },
    querySelectorAll() {
      this.choices = ['analytics', 'none'].map(choice => ({ ...node('button'), dataset: { choice } }));
      return this.choices;
    }
  });
  const scope = vm.createContext({ URL, AbortSignal, Date, Math,
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    location: { href: 'https://www.rstreet.com.br/catalogo.html', pathname: '/catalogo.html' },
    document: { referrer: '', title: 'Catálogo', readyState: 'complete', addEventListener() {}, createElement: node,
      head: { appendChild: value => head.push(value) }, querySelector: () => ({ appendChild: value => footer.push(value) }),
      body: { classList: { add() {}, remove() {} }, appendChild: value => nodes.push(value) } },
    fetch: async url => url === '/api/public-config' ? { ok: true, json: async () => ({ gaMeasurementId: 'G-FIXTURE123' }) } : {}, window: {}
  });
  scope.window.location = scope.location;
  vm.runInContext(read('rstreet-tracking.js'), scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(head.filter(n => n.src).length, 0);
  nodes.at(-1).choices.find(b => b.dataset.choice === 'none').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  scope.window.RStreetTrack.pageView();
  assert.equal(head.filter(n => n.src).length, 0);
  const grant = footer[0].handlers.click();
  nodes.at(-1).choices.find(b => b.dataset.choice === 'analytics').handlers.click();
  await grant;
  assert.equal(head.filter(n => n.src).length, 1);
  assert.equal(scope.window['ga-disable-G-FIXTURE123'], false);
  const revoke = footer[0].handlers.click();
  nodes.at(-1).choices.find(b => b.dataset.choice === 'none').handlers.click();
  await revoke;
  const before = scope.window.dataLayer.length;
  scope.window.RStreetTrack.addToCart({ id: 1, preco: 99 });
  assert.equal(scope.window['ga-disable-G-FIXTURE123'], true);
  assert.equal(scope.window.dataLayer.length, before);
});

test('privacy revocation reaches other tabs without granting new background permissions', () => {
  const scope = vm.createContext({ consent: { analytics: true, marketing: true }, consentSignature: () => 'G-TEST|12345',
    applyAnalyticsConsent: value => { scope.consent = value; } });
  load('rstreet-tracking.js', '  function parseConsent(', '  function storedConsent(', scope);
  load('rstreet-tracking.js', '  function handlePrivacyStorage(', "  if (typeof window.addEventListener", scope);
  const raw = choice => JSON.stringify({ ...choice, signature: 'G-TEST|12345', updatedAt: Date.now() });
  scope.handlePrivacyStorage({ key: 'rstreet_cart', newValue: null });
  assert.equal(scope.consent.analytics, true);
  scope.handlePrivacyStorage({ key: 'rstreet_privacy_v1', newValue: raw({ analytics: true, marketing: false }) });
  assert.equal(scope.consent.analytics, true);
  assert.equal(scope.consent.marketing, false);
  scope.handlePrivacyStorage({ key: 'rstreet_privacy_v1', newValue: raw({ analytics: true, marketing: true }) });
  assert.equal(scope.consent.marketing, false);
  scope.handlePrivacyStorage({ key: null, newValue: null });
  assert.equal(scope.consent.analytics, false);
  assert.equal(scope.consent.marketing, false);
  assert.equal(scope.parseConsent(JSON.stringify({ analytics: true, marketing: true, signature: 'G-TEST|12345', updatedAt: Date.now() + 86400000 })), null);
});

test('revocation deletes only optional analytics cookies, not the cart or session', () => {
  const writes = [];
  const document = {};
  Object.defineProperty(document, 'cookie', { get: () => '_ga=one; _ga_TEST=two; _fbp=three; session=private; rstreet_cart=keep', set: value => writes.push(value) });
  const scope = vm.createContext({ document, location: { hostname: 'www.rstreet.com.br' } });
  load('rstreet-tracking.js', '  function clearOptionalCookies(', '  function chooseConsent(', scope);
  scope.clearOptionalCookies({ analytics: false, marketing: true });
  assert.equal(writes.length, 6);
  assert.ok(writes.every(value => /^_ga(?:_TEST)?=; Max-Age=0; Path=\//.test(value)));
  assert.ok(writes.some(value => value.includes('Domain=rstreet.com.br')));
  assert.ok(writes.every(value => !/session=|rstreet_cart=|_fbp=/.test(value)));
});

test('metrics period switches cannot show a late result from the previous period', async () => {
  const elements = new Map(), pending = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', disabled: false, value: id === 'metricsPeriod' ? '30' : '' });
    return elements.get(id);
  }
  const scope = vm.createContext({ AbortSignal, API: '/fixture', authHeaders: () => ({}), escapeAdminHtml: String,
    document: { getElementById: element, querySelectorAll: () => [] },
    fetch: url => new Promise(resolve => pending.push({ url, resolve: data => resolve({ ok: true, json: async () => data }) })),
  });
  load('admin.html', 'let metricsRequest = 0;', 'let operationRequest = 0;', scope);
  const old = scope.loadMetricas(); element('metricsPeriod').value = '7'; const fresh = scope.loadMetricas();
  pending[1].resolve({ totais: { page_view: 7 }, sessoes: {}, produtos: [] }); await fresh;
  pending[0].resolve({ totais: { page_view: 30 }, sessoes: {}, produtos: [] }); await old;
  assert.equal(element('metric-pages').textContent, 7);
  assert.match(pending[1].url, /dias=7/);
  assert.equal(element('metricsRefresh').disabled, false);
});

test('review rating is keyboard-accessible and switching stars keeps one tab stop', () => {
  const buttons = Array.from({ length: 5 }, () => ({ classList: { toggle() {} }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; } }));
  const scope = vm.createContext({ selectedReviewRating: 0, document: { querySelectorAll: () => buttons } });
  load('produto.html', 'function setReviewRating(value)', 'async function submitProductReview(', scope);
  let prevented = false;
  scope.reviewRatingKey({ key: 'End', preventDefault() { prevented = true; } });
  assert.equal(scope.selectedReviewRating, 5);
  assert.ok(prevented && buttons[4].focused);
  assert.deepEqual(buttons.map(b => b.tabIndex), [-1, -1, -1, -1, 0]);
  scope.reviewRatingKey({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(scope.selectedReviewRating, 1);
  assert.equal(buttons[0].attributes['aria-checked'], 'true');
});

test('review summary uses only real totals and CSV exports neutralize formulas', () => {
  const scope = vm.createContext({ reviewsTotal: 0, reviewsAverage: 0 });
  load('produto.html', 'function renderReviewSummary()', 'function reviewDate(', scope);
  assert.equal(scope.renderReviewSummary(), '');
  scope.reviewsTotal = 2; scope.reviewsAverage = 4.5;
  assert.match(scope.renderReviewSummary(), /4,5 · 2 avaliações/);
  load('admin.html', 'function csvCell(value)', 'async function exportPedidosCSV()', scope);
  assert.equal(scope.csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(scope.csvCell('R Street'), '"R Street"');
});
