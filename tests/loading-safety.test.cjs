const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, start, end, scope) {
  const source = read(file), from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, file);
  vm.runInContext(source.slice(from, to), scope);
}
const clone = value => JSON.parse(JSON.stringify(value));
const response = data => ({ ok: true, json: async () => data });

test('every cart reader tolerates invalid storage and preserves valid line identity and quantities', () => {
  for (const file of ['catalogo.html', 'produto.html', 'carrinho.html', 'checkout.html', 'rstreet-cart-drawer.js']) {
    let raw = '', blocked = false;
    const scope = vm.createContext({ CART_KEY: 'rstreet_cart', localStorage: { getItem() { if (blocked) throw Error('blocked'); return raw; } } });
    load(file, 'function getCart()', file === 'produto.html' || file === 'catalogo.html' ? 'function syncCartWithStock()' : 'function saveCart(', scope);
    for (const value of ['{bad', 'null', '{}', '[null,false,"bad"]']) {
      raw = value;
      assert.equal(scope.getCart().length, 0, file);
    }
    raw = JSON.stringify([{ id: '1', qty: '2', checkoutLineId: 'keep' }, null, { id: -1, qty: 1 }, { id: 3, qty: -2 }]);
    assert.deepEqual(clone(scope.getCart()), [{ id: 1, qty: 2, checkoutLineId: 'keep' }], file);
    blocked = true;
    assert.equal(scope.getCart().length, 0, file);
  }
});

test('drawer timeout keeps cart intact, releases the request and permits a later retry', async () => {
  const controllers = [], notices = [];
  let cart = [{ id: 1, qty: 1, preco: 10 }];
  const scope = vm.createContext({ stockRefreshPromise: null, stockReady: false, SUPABASE_URL: '', SUPABASE_KEY: '', window: {},
    AbortSignal: { timeout(ms) { assert.equal(ms, 12000); const controller = new AbortController(); controllers.push(controller); return controller.signal; } },
    getCart: () => clone(cart), saveCart: value => { cart = clone(value); }, renderDrawer() {}, showDrawerNotice: message => notices.push(message),
    fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout')))),
  });
  load('rstreet-cart-drawer.js', '  async function refreshCartStock(', '  function openDrawer(', scope);
  const request = scope.refreshCartStock(); controllers[0].abort(); await request;
  assert.equal(scope.stockReady, false);
  assert.equal(scope.stockRefreshPromise, null);
  assert.equal(cart.length, 1);
  assert.match(notices[0], /confirmar o estoque/);
  scope.fetch = async url => response(url.includes('produto_variantes') ? [] : [{ id: 1, ativo: true, estoque: 3, preco: 10 }]);
  await scope.refreshCartStock();
  assert.equal(scope.stockReady, true);
});

test('a blocked cart write is reported instead of showing a successful save', () => {
  let notice = '';
  const scope = vm.createContext({ CART_KEY: 'rstreet_cart', localStorage: { setItem() { throw Error('blocked'); } },
    showDrawerNotice: value => { notice = value; }, updateBadges() { throw Error('must not claim success'); }, renderDrawer() {} });
  load('rstreet-cart-drawer.js', '  function saveCart(', '  function getCartCount(', scope);
  assert.equal(scope.saveCart([{ id: 1, qty: 1 }]), false);
  assert.match(notice, /salvar/);
});

test('late stock responses cannot overwrite a newer cart refresh', async () => {
  const pending = [];
  const scope = vm.createContext({ AbortSignal, stockRequestVersion: 0, SUPABASE_URL: '', SUPABASE_KEY: '',
    document: { activeElement: null },
    latestProducts: [], latestVariants: [], stockValidationOk: false, stockErrorShown: false,
    fetch: () => new Promise(resolve => pending.push(resolve)), syncCartWithStock() {}, render() {}, toast() {} });
  load('carrinho.html', 'async function loadLatestProducts()', 'function syncCartWithStock()', scope);
  const first = scope.loadLatestProducts(), second = scope.loadLatestProducts();
  pending[2](response([{ id: 1, estoque: 2 }])); pending[3](response([])); await second;
  pending[0](response([{ id: 1, estoque: 1 }])); pending[1](response([])); await first;
  assert.equal(scope.latestProducts[0].estoque, 2);
  assert.equal(scope.stockValidationOk, true);
});

test('unchanged cart polling does not redraw controls and an active quantity field is preserved', async () => {
  let renders = 0, requests = 0;
  const scope = vm.createContext({ AbortSignal, stockRequestVersion: 0, SUPABASE_URL: '', SUPABASE_KEY: '',
    document: { activeElement: null }, latestProducts: [{ id: 1 }], latestVariants: [], stockValidationOk: true, stockErrorShown: false,
    fetch: async url => { requests++; return response(url.includes('produto_variantes') ? [] : [{ id: 1 }]); },
    syncCartWithStock() {}, render: () => { renders++; }, toast() {} });
  load('carrinho.html', 'async function loadLatestProducts()', 'function syncCartWithStock()', scope);
  await scope.loadLatestProducts();
  assert.equal(renders, 0);
  assert.equal(requests, 2);
  scope.document.activeElement = { matches: () => true };
  await scope.loadLatestProducts();
  assert.equal(requests, 2);
  assert.equal(renders, 0);
});

test('checkout rejects malformed stock responses without changing the cart', async () => {
  for (const invalid of [null, {}, 'unavailable']) {
    const cart = [{ id: 1, qty: 1, preco: 10 }];
    const scope = vm.createContext({ AbortSignal, SUPABASE_URL: '', SUPABASE_KEY: '', getCart: () => clone(cart),
      saveCart() { throw Error('must not overwrite the cart'); }, renderSummary() {},
      fetch: async () => response(invalid) });
    load('checkout.html', 'async function validarCarrinhoAtual()', 'function renderSummary()', scope);
    const result = await scope.validarCarrinhoAtual();
    assert.equal(result.ok, false);
    assert.match(result.message, /confirmar o estoque/);
  }
});

test('checkout stock timeout releases validation and leaves the current cart intact', async () => {
  const controllers = [];
  const cart = [{ id: 1, qty: 1, preco: 10 }];
  const scope = vm.createContext({ SUPABASE_URL: '', SUPABASE_KEY: '', getCart: () => clone(cart),
    AbortSignal: { timeout(ms) { assert.equal(ms, 12000); const c = new AbortController(); controllers.push(c); return c.signal; } },
    saveCart() { throw Error('must not overwrite the cart'); }, renderSummary() {},
    fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout')))) });
  load('checkout.html', 'async function validarCarrinhoAtual()', 'function renderSummary()', scope);
  const request = scope.validarCarrinhoAtual();
  controllers[0].abort();
  assert.equal((await request).ok, false);
  assert.equal(cart[0].qty, 1);
});

test('cart checkout activation is blocked until stock is confirmed, including keyboard activation', () => {
  let handler, notices = 0, prevented = 0;
  const scope = vm.createContext({ stockValidationOk: false, getCart: () => [{ id: 1, qty: 1 }],
    toast: () => { notices++; }, document: { getElementById: () => ({ addEventListener: (_event, callback) => { handler = callback; } }) } });
  load('carrinho.html', "document.getElementById('checkoutBtn').addEventListener('click'", '\nrender();', scope);
  handler({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  scope.stockValidationOk = true;
  handler({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  scope.getCart = () => [];
  handler({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(notices, 2);
});

test('quantity controls tolerate an item removed in another tab before the action runs', () => {
  const scope = vm.createContext({ getCart: () => [], saveCart() { throw Error('must not write a missing item'); } });
  load('carrinho.html', 'function changeQty(', 'function removeItem(', scope);
  scope.changeQty(0, 1);
  scope.setQty(0, '2');
});

test('both cart layouts identify quantity controls by product and escape names in accessible labels', () => {
  for (const file of ['carrinho.html', 'rstreet-cart-drawer.js']) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} });
      return elements.get(id);
    };
    const scope = vm.createContext({ stockValidationOk: true, stockReady: true,
      document: { getElementById: element, querySelector: () => element('checkout') },
      getCart: () => [{ id: 1, qty: 1, preco: 10, estoque: 2, nome: 'Produto "Teste"' }],
      updateTotals() {}, updateBadges() {}, getCartCount: () => 1, itemMax: () => 2, fmt: String, money: String });
    if (file === 'carrinho.html') {
      load(file, 'function escapeHtml(', 'async function loadLatestProducts()', scope);
      load(file, 'function render() {', 'function updateTotals(', scope);
      scope.render();
    } else {
      load(file, '  function escapeHtml(', '  function showDrawerNotice(', scope);
      load(file, '  function renderDrawer()', '  function escapeHtml(', scope);
      scope.renderDrawer();
    }
    const html = element(file === 'carrinho.html' ? 'cartItemsList' : 'rstreetCartDrawerBody').innerHTML;
    assert.ok(html.includes('aria-label="Aumentar quantidade de Produto &quot;Teste&quot;"'), file);
    assert.ok(html.includes('aria-label="Diminuir quantidade de Produto &quot;Teste&quot;"'), file);
    assert.ok(html.includes('aria-label="Remover Produto &quot;Teste&quot; do carrinho"'), file);
  }
});

test('catalog data changes only when products and variants both load successfully', async () => {
  const old = [{ id: 1, nome: 'Anterior' }], variants = [{ id: 10, produto_id: 1 }];
  const scope = vm.createContext({ AbortSignal, console: { warn() {} }, SUPABASE_URL: '', SUPABASE_ANON_KEY: 'fixture',
    isRefreshingProducts: false, pendingProductsRefresh: false, allProducts: clone(old), allProductVariants: clone(variants),
    catalogLoadError: false, catalogRetryTimer: 0, catalogDataSignature: '', lastProductsRefreshAt: 0,
    clearTimeout() {}, setTimeout: () => 1, updateMaxPrice() {}, updateCategoryCounts() {}, applyFilters() {},
    checkCatalogUrlParams: () => false, syncCartWithStock() {}, getCatalogDataSignature: () => '', scheduleProductsRefresh() {},
    fetch: async url => url.includes('produto_variantes') ? { ok: false, status: 503 } : response([{ id: 2 }]),
  });
  // Enable the real-load branch without contacting any external service.
  scope.SUPABASE_URL = 'https://fixture.invalid';
  load('catalogo.html', 'async function loadProductVariants()', 'function safeCatalogThemeLink(', scope);
  load('catalogo.html', 'async function loadProducts(', 'async function refreshProducts()', scope);
  await scope.loadProducts();
  assert.deepEqual(clone(scope.allProducts), old);
  assert.deepEqual(clone(scope.allProductVariants), variants);
  assert.equal(scope.isRefreshingProducts, false);
  scope.fetch = async url => response(url.includes('produto_variantes') ? [{ id: 20, produto_id: 2 }] : [{ id: 2 }]);
  await scope.loadProducts();
  assert.equal(scope.allProducts[0].id, 2);
  assert.equal(scope.allProductVariants[0].produto_id, 2);
});

function productScope(fetch) {
  return vm.createContext({ AbortSignal, console: { warn() {} }, productId: 1, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_KEY: 'fixture',
    productRequestVersion: 0, product: null, allProducts: [], productVariants: [], productDataSignature: '', lastProductRefreshAt: 0,
    productLoadError: false, productRetryTimer: null, reviewFormOpen: false, document: { activeElement: null },
    fetch, setTimeout: () => 1, clearTimeout() {}, finish() {}, syncCartWithStock() {}, getProductDataSignature: () => 'new',
  });
}

test('product initial load fails safely when color data is unavailable, but related products are optional', async () => {
  const scope = productScope(async url => url.includes('produto_variantes') ? { ok: false } : response([{ id: 1 }]));
  load('produto.html', 'async function init(', 'function retryProductLoad()', scope);
  await scope.init();
  assert.equal(scope.product, null);
  assert.equal(scope.productLoadError, true);
  scope.fetch = async url => {
    if (url.includes('limit=20')) throw Error('related unavailable');
    return response(url.includes('produto_variantes') ? [{ id: 10 }] : [{ id: 1 }]);
  };
  await scope.init();
  assert.equal(scope.product.id, 1);
  assert.equal(scope.productVariants[0].id, 10);
});

test('background refresh cannot race the initial product load and skip review initialization', async () => {
  const scope = productScope(() => { throw Error('initial product load must finish first'); });
  load('produto.html', 'async function refreshProduct()', 'function getProductDataSignature()', scope);
  await scope.refreshProduct();
  assert.equal(scope.productRequestVersion, 0);
});

test('a refresh finishing after a review form opens cannot erase the form or replace product state', async () => {
  const pending = [];
  const scope = productScope(() => new Promise(resolve => pending.push(resolve)));
  scope.product = { id: 1, nome: 'Original' };
  scope.finish = () => { throw Error('must not redraw the open review form'); };
  load('produto.html', 'async function refreshProduct()', 'function getProductDataSignature()', scope);
  const request = scope.refreshProduct();
  scope.reviewFormOpen = true;
  pending.forEach(resolve => resolve(response([{ id: 1, nome: 'Atualizado' }])));
  await request;
  assert.equal(scope.product.nome, 'Original');
});
