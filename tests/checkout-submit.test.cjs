const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../checkout.html'), 'utf8');
function extract(start, end) { const i = source.indexOf(start); return source.slice(i, source.indexOf(end, i + start.length)); }
function setup(response, ok = false) {
  const values = { 'f-nome': 'Teste Local', 'f-email': 'teste@example.com', 'f-telefone': '19999999999',
    'f-cep': '13720000', 'f-rua': 'Rua teste', 'f-numero': '1', 'f-bairro': 'Centro', 'f-cidade': 'Sao Jose do Rio Pardo', 'f-estado': 'SP' };
  const elements = new Map();
  const token = '123e4567-e89b-42d3-a456-426614174000';
  const session = new Map();
  const removed = [], alerts = [], requests = [];
  const scope = vm.createContext({
    URL, AbortSignal, setTimeout, clearTimeout, setCheckoutProgress() {}, BACKEND_URL: 'https://test.invalid', paymentMethod: 'pix', freteVal: 0, freteLabel: 'Entrega local', checkoutNeedsCartRefresh: false,
    window: { location: {}, RStreetCheckoutState: { remember() {}, release: token => removed.push(token) } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: values[id] || '', disabled: false, children: [],
          classList: { add() {}, remove() {} }, append(node) { this.children.push(node); } });
        return elements.get(id);
      }, createElement: () => ({ style: {} }),
    },
    sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    getCart: () => [{ id: 1, qty: 1, preco: 100, nome: 'Produto' }], getPixDiscount: () => 5,
    validate: () => true, clearAlert() {}, wasCheckoutAttemptSubmitted: () => true,
    getCheckoutAttemptToken: () => token, markCheckoutAttemptSubmitted() {}, fmt: amount => `R$ ${amount}`,
    showAlert: (...args) => alerts.push(args),
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok, json: async () => response }; },
  });
  session.set('rstreet_checkout_attempt', JSON.stringify({ token }));
  vm.runInContext(extract('function safeMercadoPagoUrl', 'function getPixDiscount')
    + extract('async function finalizarCompra()', '// \u2500\u2500\u2500 ALERT'), scope);
  return { scope, elements, alerts, requests, removed, session };
}

test('changed checkout offers an explicit old-order link without silently redirecting new data', async () => {
  const context = setup({ code: 'CHECKOUT_CHANGED', erro: 'As alteracoes nao foram aplicadas.',
    checkout: { pedido_id: 42, total: 100, init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test' } });
  await context.scope.finalizarCompra();
  assert.equal(context.requests[0].metodo_pagamento, 'pix');
  assert.equal(context.scope.window.location.href, undefined);
  assert.match(context.elements.get('alertArea').children[0].textContent, /anterior #42/);
  assert.equal(context.elements.get('btnFinalizar').disabled, false);
});

test('invalid resume URL is never made clickable', async () => {
  const context = setup({ code: 'CHECKOUT_CHANGED', erro: 'Dados alterados', checkout: { init_point: 'https://evil.example/pay' } });
  await context.scope.finalizarCompra();
  assert.equal(context.elements.get('alertArea')?.children.length || 0, 0);
  assert.equal(context.scope.window.location.href, undefined);
});

test('closed or expired checkout retires its token but never automatically creates another payment', async () => {
  for (const code of ['CHECKOUT_CLOSED', 'CHECKOUT_EXPIRED', 'CHECKOUT_REVALIDATE']) {
    const context = setup({ code, erro: 'Revise seu pedido antes de continuar.' });
    await context.scope.finalizarCompra();
    assert.equal(context.session.has('rstreet_checkout_attempt'), false);
    assert.equal(context.removed.length, 1);
    assert.equal(context.requests.length, 1);
    assert.equal(context.elements.get('btnFinalizar').disabled, false);
  }
});

test('under-review payment keeps its attempt and does not create a competing payment', async () => {
  const context = setup({ code: 'CHECKOUT_PROCESSING', erro: 'Acompanhe seu pedido.' });
  await context.scope.finalizarCompra();
  assert.equal(context.session.has('rstreet_checkout_attempt'), true);
  assert.equal(context.removed.length, 0);
  assert.equal(context.scope.window.location.href, undefined);
});

test('validation or storage errors before sending payment unlock the checkout button', async () => {
  for (const stage of ['validation', 'storage']) {
    const context = setup({});
    if (stage === 'validation') {
      context.scope.wasCheckoutAttemptSubmitted = () => false;
      context.scope.validarCarrinhoAtual = async () => { throw new Error('validation unavailable'); };
    } else context.scope.getCheckoutAttemptToken = () => { throw new Error('storage blocked'); };
    await context.scope.finalizarCompra();
    assert.equal(context.elements.get('btnFinalizar').disabled, false);
    assert.equal(context.requests.length, 0);
    assert.equal(context.alerts.length, 1);
  }
});

test('repeated checkout activation while a request is pending sends only one request', async () => {
  const context = setup({});
  let finish;
  let calls = 0;
  context.scope.fetch = () => {
    calls++;
    return new Promise(resolve => { finish = () => resolve({ ok: false, json: async () => ({ erro: 'Teste' }) }); });
  };
  const pending = context.scope.finalizarCompra();
  await context.scope.finalizarCompra();
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(context.elements.get('btnFinalizar').disabled, false);
});

test('payment timeout unlocks the form but preserves its original checkout attempt for a safe retry', async () => {
  const context = setup({});
  const controller = new AbortController();
  context.scope.AbortSignal = { timeout(ms) { assert.equal(ms, 45000); return controller.signal; } };
  context.scope.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
  });
  const request = context.scope.finalizarCompra();
  controller.abort();
  await request;
  assert.equal(context.elements.get('btnFinalizar').disabled, false);
  assert.equal(context.session.has('rstreet_checkout_attempt'), true);
  assert.equal(context.removed.length, 0);
  assert.equal(context.scope.window.location.href, undefined);
  assert.match(context.alerts[0][0], /mesma tentativa/);
});

test('unavailable backend stops before sending payment and keeps the existing attempt', async () => {
  const context = setup({});
  context.scope.RStreetBackendConnection = { ready: async () => { throw Object.assign(new Error('Conexão indisponível.'), { code: 'BACKEND_UNAVAILABLE' }); } };
  await context.scope.finalizarCompra();
  assert.equal(context.requests.length, 0);
  assert.equal(context.elements.get('btnFinalizar').disabled, false);
  assert.equal(context.session.has('rstreet_checkout_attempt'), true);
  assert.equal(context.alerts[0][0], 'Conexão indisponível.');
});

test('cart changes while the server wakes require review before payment', async () => {
  const context = setup({});
  const cart = [{ id: 1, qty: 1, preco: 100 }];
  context.scope.getCart = () => cart;
  context.scope.renderSummary = () => {};
  context.scope.RStreetBackendConnection = { ready: async () => { cart[0].qty = 2; } };
  await context.scope.finalizarCompra();
  assert.equal(context.requests.length, 0);
  assert.match(context.alerts[0][0], /carrinho mudou/);
});
