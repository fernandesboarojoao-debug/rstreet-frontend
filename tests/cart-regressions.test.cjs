const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, start, end, context = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
  const scope = vm.createContext(context);
  vm.runInContext(code, scope);
  return scope;
}
const clone = value => JSON.parse(JSON.stringify(value));
const item = { id: 1, produto_variante_id: 9, qty: 1, estoque: 3, preco: 100, nome: 'Teste' };
const products = [{ id: 1, ativo: true, estoque: 3, preco: 140 }];
const variants = [{ id: 9, produto_id: 1, estoque: 3, ativo: true, preco: 150, imagens: ['new.jpg'] }];

test('product page preserves cart items outside its related-products window', () => {
  let stored = JSON.stringify([{ id: 1, qty: 1, estoque: 3 }]);
  const scope = load('produto.html', 'function syncCartWithStock()', '\nfunction fmt(', {
    product: { id: 21, ativo: true, estoque: 1 }, allProducts: [{ id: 21 }], productVariants: [],
    localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } },
  });
  scope.syncCartWithStock();
  assert.equal(JSON.parse(stored).length, 1);
});

test('checkout saves a price-only change and requires customer review', async () => {
  for (const variantPrice of [150, null]) {
    let cart = [clone(item)];
    const scope = load('checkout.html', 'async function validarCarrinhoAtual()', '\nfunction renderSummary()', {
      SUPABASE_URL: '', SUPABASE_KEY: '', getCart: () => clone(cart), saveCart: next => { cart = clone(next); }, renderSummary() {},
      fetch: async url => ({ ok: true, json: async () => url.includes('produto_variantes') ? [{ ...variants[0], preco: variantPrice }] : products }),
    });
    assert.equal((await scope.validarCarrinhoAtual()).ok, false);
    assert.equal(cart[0].preco, variantPrice ?? 140);
    assert.equal(cart[0].imagem, 'new.jpg');
    assert.equal((await scope.validarCarrinhoAtual()).ok, true);
  }
});

test('checkout does not overwrite a cart changed during its request', async () => {
  let cart = [clone(item)];
  const scope = load('checkout.html', 'async function validarCarrinhoAtual()', '\nfunction renderSummary()', {
    SUPABASE_URL: '', SUPABASE_KEY: '', getCart: () => clone(cart), saveCart() { throw new Error('must not save'); }, renderSummary() {},
    fetch: async url => { cart[0].qty = 2; return { ok: true, json: async () => url.includes('produto_variantes') ? variants : products }; },
  });
  assert.equal((await scope.validarCarrinhoAtual()).ok, false);
  assert.equal(cart[0].qty, 2);
});

test('cart saves price-only changes and validates variant ownership', () => {
  let cart = [clone(item)];
  const scope = load('carrinho.html', 'function syncCartWithStock()', '\n// ─── RENDER', {
    latestProducts: products, latestVariants: clone(variants), stockValidationOk: true,
    getCart: () => clone(cart), saveCart: next => { cart = clone(next); }, toast() {}, render() {},
  });
  scope.syncCartWithStock();
  assert.equal(cart[0].preco, 150);
  scope.latestVariants[0].produto_id = 2;
  scope.syncCartWithStock();
  assert.equal(cart.length, 0);
});

test('drawer refresh retries newer cart instead of erasing another tab item', async () => {
  let cart = [clone(item)];
  let calls = 0;
  const scope = load('rstreet-cart-drawer.js', '  async function refreshCartStock(', '\n  function openDrawer(', {
    stockRefreshPromise: null, stockReady: false, SUPABASE_URL: '', SUPABASE_KEY: '',
    getCart: () => clone(cart), saveCart: next => { cart = clone(next); }, renderDrawer() {}, showDrawerNotice() {},
    fetch: async url => {
      if (++calls === 1) cart.push({ id: 2, qty: 1, estoque: 5, preco: 30 });
      return { ok: true, json: async () => url.includes('produto_variantes') ? variants : [...products, { id: 2, estoque: 5, ativo: true, preco: 30 }] };
    },
  });
  await scope.refreshCartStock();
  assert.equal(cart.length, 2);
  assert.equal(cart[0].preco, 150);
  assert.equal(scope.stockReady, true);
});

test('Merchant categories normalize accents', () => {
  const { createFeedXml } = require('../api/merchant-feed.js');
  for (const [categoria, expected] of [['Tênis', 'Shoes'], ['Calça', 'Pants']]) {
    assert.match(createFeedXml([{ id: 1, categoria, nome: 'Teste', preco: 10 }], []), new RegExp(expected));
  }
});

test('admin ignores late variant responses after switching or closing a product', async () => {
  const pending = new Map();
  let renders = 0;
  const scope = load('admin.html', 'async function loadProductVariantsIntoModal(', '\nfunction renderVariantGrid()', {
    variantLoadVersion: 0, variantsLoaded: true, editingId: 1, currentVariants: [],
    document: { getElementById: () => ({ innerHTML: '' }) },
    productVariantsRequest: id => new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
    normalizeVariant: value => value, renderVariantGrid: () => { renders++; },
    toast() { throw new Error('stale failures must not show a toast'); },
  });
  const first = scope.loadProductVariantsIntoModal(1);
  scope.editingId = 2;
  const second = scope.loadProductVariantsIntoModal(2);
  pending.get(2).resolve([{ id: 20 }]);
  await second;
  pending.get(1).resolve([{ id: 10 }]);
  await first;
  assert.equal(scope.currentVariants[0].id, 20);
  assert.equal(scope.variantsLoaded, true);
  assert.equal(renders, 1);

  const closed = scope.loadProductVariantsIntoModal(2);
  scope.variantLoadVersion++;
  scope.editingId = null;
  pending.get(2).reject(new Error('late error'));
  await closed;
  assert.equal(renders, 1);
});
