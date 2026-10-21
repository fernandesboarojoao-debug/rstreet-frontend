const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, start, end, scope) {
  const source = read(file), from = source.indexOf(start);
  assert.ok(from >= 0);
  vm.runInContext(source.slice(from, source.indexOf(end, from + start.length)), scope);
}
const clone = value => JSON.parse(JSON.stringify(value));

test('product gallery thumbnails use native buttons and keep selected state accessible', () => {
  const html = read('produto.html');
  assert.match(html, /<button type="button" class="thumb /);
  assert.doesNotMatch(html, /<div class="thumb /);
  const attributes = [{}, {}];
  const thumbs = attributes.map(attrs => ({ classList: { remove() {}, add() {} }, setAttribute: (key, value) => { attrs[key] = value; } }));
  const scope = vm.createContext({ selectedMediaUrl: '', selectedMediaType: '', document: { querySelector: () => null, querySelectorAll: () => thumbs } });
  load('produto.html', 'function changeMedia(', 'function getActiveMediaIndex(', scope);
  scope.changeMedia('fixture.jpg', 'image', thumbs[1]);
  assert.equal(attributes[0]['aria-pressed'], 'false');
  assert.equal(attributes[1]['aria-pressed'], 'true');
});

test('product quantity controls have accessible names without changing stock limits', () => {
  const html = read('produto.html');
  assert.match(html, /class="product-qty-num" aria-label="Quantidade do produto"[^>]+max="\$\{qtyMax\}"/);
  assert.match(html, /class="product-qty-btn" aria-label="Diminuir quantidade"/);
  assert.match(html, /class="product-qty-btn" aria-label="Aumentar quantidade"/);
});

test('campaign banner leaves keyboard activation to its native links and buttons', () => {
  const html = read('catalogo.html');
  const banner = html.match(/<div class="catalog-theme-banner"[^>]+>/)[0];
  assert.doesNotMatch(banner, /onkeydown|tabindex/);
  assert.doesNotMatch(html, /banner\.setAttribute\('role', 'link'\)/);
  assert.match(html, /banner\.setAttribute\('role', 'region'\)/);
  assert.match(html, /<a class="catalog-theme-btn"[^>]+href=/);
});

test('rapid removal of two cart items removes the selected products despite shifted indexes', () => {
  let cart = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const timers = [];
  const scope = vm.createContext({ getCart: () => clone(cart), saveCart: value => { cart = clone(value); },
    document: { getElementById: () => ({ classList: { add() {} } }) },
    setTimeout: callback => timers.push(callback), render() {}, toast() {},
  });
  load('carrinho.html', 'function removeItem(idx)', 'function clearCart()', scope);
  scope.removeItem(0);
  scope.removeItem(1);
  timers.forEach(callback => callback());
  assert.deepEqual(cart.map(item => item.id), [3]);
});

test('an open drawer rechecks stock after a cart change in another tab', () => {
  let checks = 0;
  const scope = vm.createContext({ CART_KEY: 'rstreet_cart', stockReady: true,
    updateBadges() {}, renderDrawer() {}, refreshCartStock: () => { checks++; },
    document: { body: { classList: { contains: () => true } } },
  });
  load('rstreet-cart-drawer.js', '  function handleCartStorage(', "  window.addEventListener('storage'", scope);
  scope.handleCartStorage({ key: 'unrelated' });
  assert.equal(checks, 0);
  scope.handleCartStorage({ key: 'rstreet_cart' });
  assert.equal(checks, 1);
  assert.equal(scope.stockReady, false);
});

test('checkout refreshes another tab cart changes but defers them during payment submission', () => {
  let renders = 0, alerts = 0;
  const button = { disabled: false };
  const scope = vm.createContext({ checkoutNeedsCartRefresh: false,
    document: { getElementById: () => button }, renderSummary: () => { renders++; }, showAlert: () => { alerts++; },
  });
  load('checkout.html', 'function handleCheckoutCartStorage(', '// \u2500\u2500\u2500 ALERT', scope);
  scope.handleCheckoutCartStorage({ key: 'rstreet_cart' });
  assert.equal(renders, 1);
  button.disabled = true;
  scope.handleCheckoutCartStorage({ key: 'rstreet_cart' });
  assert.equal(renders, 1);
  assert.equal(scope.checkoutNeedsCartRefresh, true);
  button.disabled = false;
  scope.handleCheckoutCartStorage({ key: 'rstreet_cart' });
  assert.equal(renders, 2);
  assert.equal(alerts, 2);
  assert.equal(scope.checkoutNeedsCartRefresh, false);
});

test('an earlier lookup for the same CEP cannot overwrite the latest address', async () => {
  const pending = [], alerts = [];
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'f-cep' ? '13720-000' : '', innerHTML: '',
      classList: { add() {}, remove() {} }, focus() {} });
    return nodes.get(id);
  };
  const scope = vm.createContext({ AbortController, setTimeout, clearTimeout, cepLookupController: null,
    document: { getElementById: element }, updateTotals() {}, renderFreteOptions() {},
    calcularFretesPorEndereco: () => [], showAlert: message => alerts.push(message), clearAlert() {},
    atualizarFreteManual() { throw new Error('A superseded request must not reset shipping'); },
    fetch: () => new Promise(resolve => pending.push(data => resolve({ ok: true, json: async () => data }))),
  });
  load('checkout.html', 'function resetFrete()', 'function normalizarTexto(', scope);
  load('checkout.html', 'async function buscarCEP()', 'function atualizarFreteManual()', scope);
  const first = scope.buscarCEP(), second = scope.buscarCEP();
  pending[1]({ localidade: 'Cidade atual', uf: 'SP', logradouro: 'Rua atual' });
  await second;
  pending[0]({ localidade: 'Cidade antiga', uf: 'SP', logradouro: 'Rua antiga' });
  await first;
  assert.equal(element('f-rua').value, 'Rua atual');
  assert.equal(element('f-cidade').value, 'Cidade atual');
  assert.equal(alerts.length, 0);
});

function trackingSetup(search = '') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, innerHTML: '', textContent: '', addEventListener() {} });
    return elements.get(id);
  };
  element('pedidoId').value = '42';
  element('pedidoEmail').value = 'teste@example.com';
  const pending = [], timers = [];
  const scope = vm.createContext({ AbortController, URLSearchParams, location: { search }, BACKEND_BASE: 'https://test.invalid',
    document: { getElementById: element }, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      pending.push(data => resolve({ ok: true, json: async () => data }));
    }),
    showError: message => { element('msg').textContent = message; }, safeHttpUrl: () => '',
    escapeHtml: String, fmtMoney: String, renderTimeline: () => '', PAGAMENTO_LABEL: { pago: 'Pago' }, ENVIO_LABEL: {},
  });
  const source = read('acompanhar.html');
  const from = source.indexOf('let trackingController = null;');
  vm.runInContext(source.slice(from, source.indexOf('</script>', from)), scope);
  return { scope, element, pending, timers };
}

test('editing order tracking inputs prevents an earlier response from showing the wrong order', async () => {
  const { scope, element, pending } = trackingSetup();
  const first = scope.consultarPedido();
  element('pedidoId').value = '43';
  scope.resetTrackingResult();
  const second = scope.consultarPedido();
  pending[0]({ pedido: { id: 42, total: 10, status: 'pago' }, itens: [] });
  await first;
  assert.equal(element('resultado').innerHTML, '');
  assert.equal(element('btnConsultar').disabled, true);
  pending[1]({ pedido: { id: 43, total: 20, status: 'pago' }, itens: [] });
  await second;
  assert.match(element('resultado').innerHTML, /#43/);
  assert.doesNotMatch(element('resultado').innerHTML, /#42/);
  assert.equal(element('btnConsultar').disabled, false);
});

test('a slow tracking request times out with a useful message and releases the form', async () => {
  const { scope, element, timers } = trackingSetup();
  const request = scope.consultarPedido();
  timers[0]();
  await request;
  assert.match(element('msg').textContent, /demorou/);
  assert.equal(element('btnConsultar').disabled, false);
});

test('notification order links prefill only valid IDs and never submit customer information', () => {
  assert.equal(trackingSetup('?pedido=91').element('pedidoId').value, '91');
  assert.equal(trackingSetup('?pedido=-1').element('pedidoId').value, '42');
  assert.equal(trackingSetup('?pedido=%3Cscript%3E').element('pedidoId').value, '42');
});
