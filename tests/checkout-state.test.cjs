const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const token = '123e4567-e89b-42d3-a456-426614174000';
const item = { id: 1, produto_variante_id: 9, qty: 1, preco: 100, estoque: 1, checkoutLineId: 'line-one' };
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function storage() {
  const data = {};
  Object.defineProperties(data, {
    getItem: { value: key => data[key] || null },
    setItem: { value: (key, value) => { data[key] = String(value); } },
    removeItem: { value: key => { delete data[key]; } },
  });
  return data;
}
function setup() {
  const window = { localStorage: storage(), navigator: {} };
  vm.runInNewContext(read('rstreet-checkout-state.js'), { window });
  const state = window.RStreetCheckoutState;
  state.remember(token, [item], { pedido_id: 42, reserva_expira_em: new Date(Date.now() + 600000).toISOString() });
  return { window, state, localStorage: window.localStorage };
}
const cart = store => JSON.parse(store.getItem('rstreet_cart'));

test('shared reservation protects only its color and size until the backend closes it', () => {
  const { state } = setup();
  assert.equal(state.available(item, 0), 1);
  assert.equal(state.available({ ...item, produto_variante_id: 10 }, 0), 0);
  assert.equal(state.attemptFor([item]).token, token);
  assert.equal(state.attemptFor([{ ...item, qty: 2 }]), null);
  state.remember(token, [item], { pedido_id: 42, reserva_expira_em: new Date(Date.now() - 360000).toISOString() });
  assert.equal(state.available(item, 0), 1);
  assert.equal(state.attemptFor([item]).token, token);
  state.release(token);
  assert.equal(state.available(item, 0), 0);
});

test('approval removes purchased quantities once and preserves subsequent shopping', async () => {
  const { state, localStorage } = setup();
  localStorage.setItem('rstreet_cart', JSON.stringify([{ ...item, qty: 3 }, { id: 2, qty: 1 }]));
  await state.complete(42);
  assert.deepEqual(cart(localStorage).map(i => i.qty), [2, 1]);
  await state.complete(42);
  assert.deepEqual(cart(localStorage).map(i => i.qty), [2, 1]);
  localStorage.setItem('rstreet_cart', JSON.stringify([item]));
  await state.complete(42);
  assert.equal(cart(localStorage)[0].qty, 1);
});

test('unrelated or old confirmation cannot erase a new cart', async () => {
  const { state, localStorage } = setup();
  localStorage.setItem('rstreet_cart', JSON.stringify([item]));
  await state.complete(100, token);
  assert.equal(cart(localStorage).length, 1);
  state.release(token);
  await state.complete(42);
  assert.equal(cart(localStorage).length, 1);
});

test('removing and re-adding the same SKU before confirmation preserves the new item', async () => {
  const { state, localStorage } = setup();
  const newItem = { ...item };
  delete newItem.checkoutLineId;
  localStorage.setItem('rstreet_cart', JSON.stringify([newItem]));
  await state.complete(42);
  assert.equal(cart(localStorage)[0].qty, 1);
});

test('first submission tags the cart once without overwriting a concurrent change', () => {
  const { state, localStorage } = setup();
  state.release(token);
  const untagged = { ...item };
  delete untagged.checkoutLineId;
  localStorage.setItem('rstreet_cart', JSON.stringify([untagged]));
  state.remember(token, [untagged]);
  assert.ok(cart(localStorage)[0].checkoutLineId);
  state.remember(token, [untagged], { pedido_id: 42 });
  assert.equal(cart(localStorage)[0].checkoutLineId, untagged.checkoutLineId);
});

test('overlapping confirmation tabs serialize cart consumption', async () => {
  const { window, state, localStorage } = setup();
  let queue = Promise.resolve();
  window.navigator.locks = { request: (_, callback) => (queue = queue.then(callback)) };
  localStorage.setItem('rstreet_cart', JSON.stringify([{ ...item, qty: 3 }]));
  await Promise.all([state.complete(42), state.complete(42)]);
  assert.equal(cart(localStorage)[0].qty, 2);
});

test('all stock synchronizers preserve a checkout reservation in another tab', async () => {
  for (const [file, start, end] of [
    ['produto.html', 'function syncCartWithStock()', '\nfunction fmt('],
    ['catalogo.html', 'function syncCartWithStock()', '\n// '],
    ['carrinho.html', 'function syncCartWithStock()', '\n// '],
    ['checkout.html', 'async function validarCarrinhoAtual()', '\n// '],
    ['rstreet-cart-drawer.js', '  async function refreshCartStock(', '\n  function openDrawer('],
  ]) {
    const { window, localStorage } = setup();
    localStorage.setItem('rstreet_cart', JSON.stringify([item]));
    const products = [{ id: 1, estoque: 0, preco: 100, ativo: true }];
    const variants = [{ id: 9, produto_id: 1, estoque: 0, preco: 100, ativo: true }];
    const scope = vm.createContext({ window, localStorage, AbortSignal, product: products[0], productVariants: variants,
      allProducts: products, latestProducts: products, latestVariants: variants, stockValidationOk: true,
      stockRefreshPromise: null, stockReady: false, SUPABASE_URL: '', SUPABASE_KEY: '',
      getCart: () => cart(localStorage), saveCart: value => localStorage.setItem('rstreet_cart', JSON.stringify(value)),
      fetch: async url => ({ ok: true, json: async () => url.includes('produto_variantes') ? variants : products }),
      toast() {}, render() {}, renderSummary() {}, renderDrawer() {}, showDrawerNotice() {}, updateCartNav() {},
    });
    const source = read(file), from = source.indexOf(start);
    assert.ok(from >= 0, file);
    vm.runInContext(source.slice(from, source.indexOf(end, from + start.length)), scope);
    if (scope.syncCartWithStock) scope.syncCartWithStock();
    else if (scope.validarCarrinhoAtual) assert.equal((await scope.validarCarrinhoAtual()).ok, true);
    else await scope.refreshCartStock();
    assert.equal(cart(localStorage)[0]?.qty, 1, file);
  }
});

test('pending backend status overrides a cancelled return URL', () => {
  const source = read('confirmacao.html');
  const scope = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function statusFromPedido'), source.indexOf('function renderStatus')), scope);
  assert.equal(scope.statusFromPedido({ status: 'pendente' }, 'cancelled'), 'pending');
  assert.equal(scope.statusFromPedido({ status: 'recusado' }, 'pending'), 'failure');
});

test('corrupt reservation storage is ignored instead of breaking the cart', () => {
  const { state, localStorage } = setup();
  localStorage.setItem('rstreet_checkout_hold_broken', JSON.stringify({ until: Date.now() + 100000, items: {} }));
  localStorage.setItem('rstreet_checkout_hold_null', 'null');
  localStorage.setItem('rstreet_checkout_hold_invalid', '{');
  assert.equal(state.protectedQuantity(item), 1);
});

test('restricted browser storage does not break order confirmation', async () => {
  const { state, localStorage, window } = setup();
  localStorage.setItem('rstreet_cart', JSON.stringify([item]));
  window.localStorage = { ...localStorage, getItem: key => localStorage.getItem(key),
    setItem() { throw new Error('Storage blocked'); } };
  assert.equal(await state.complete(42), false);
});

test('an approved return URL cannot confirm or track a purchase without backend verification', async () => {
  const source = read('confirmacao.html');
  const rendered = [], tracked = [];
  const scope = vm.createContext({ URLSearchParams, window: { location: { search: '?status=approved&pedido_id=42&payment_id=123' } },
    sessionStorage: {}, updateStoreHoursStep() {}, readStoredJson: () => null,
    statusFromUrl: value => value, renderStatus: status => rendered.push(status),
    loadPedidoFromBackend: async () => null, trackApprovedPurchase: order => tracked.push(order),
    restaurarCarrinhoSePagamentoNaoConcluiu() { throw new Error('Unverified payment must not consume the cart'); },
  });
  const from = source.indexOf('async function init()');
  vm.runInContext(source.slice(from, source.indexOf('\ninit();', from)), scope);
  await scope.init();
  assert.deepEqual(rendered, ['pending']);
  assert.equal(tracked.length, 0);
});
