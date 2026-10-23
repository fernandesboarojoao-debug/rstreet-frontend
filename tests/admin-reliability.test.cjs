const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test('admin distinguishes free delivery, pickup, paid shipping and missing freight', () => {
  const scope = vm.createContext({});
  vm.runInContext(extract('function formatAdminFrete(', 'function renderPedidosTable()'), scope);
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'Retirada na loja', frete_valor: 0 }), 'Retirada');
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'Entrega local', frete_valor: 0 }), 'Grátis');
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'PAC', frete_valor: '19.9' }), 'R$ 19,90');
  for (const value of [undefined, null, '', -1, 'invalid']) {
    assert.equal(scope.formatAdminFrete({ frete_valor: value }), '—');
  }
});
function loginScope(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'loginInput' ? 'local-fixture-password' : '',
      disabled: false, textContent: '', classList: { add() {}, remove() {} }, focus() {} });
    return elements.get(id);
  };
  let unlocked = 0;
  const scope = vm.createContext({ AbortSignal, setTimeout: () => 1, Date, BACKEND_URL_AUTH: 'https://fixture.invalid', fetch,
    document: { getElementById: element }, sessionStorage: { setItem() {} },
    unlockAdminInterface: () => { unlocked++; }, loadProducts() {} });
  vm.runInContext(extract('async function fazerLogin()', 'function verificarLogin()'), scope);
  return { scope, element, unlocked: () => unlocked };
}

test('repeated admin login activation sends only one authentication request', async () => {
  let calls = 0, finish;
  const fixture = loginScope(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = fixture.scope.fazerLogin();
  await fixture.scope.fazerLogin();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ token: 'local-fixture' }) });
  await first;
  assert.equal(fixture.unlocked(), 1);
  assert.equal(fixture.element('loginBtn').disabled, false);
});

test('admin temporary errors retain the password while a wrong password is cleared explicitly', async () => {
  for (const status of [401, 429, 503]) {
    const fixture = loginScope(async () => ({ ok: false, status }));
    await fixture.scope.fazerLogin();
    assert.equal(fixture.element('loginBtn').disabled, false);
    if (status === 401) {
      assert.equal(fixture.element('loginInput').value, '');
      assert.match(fixture.element('loginError').textContent, /Senha incorreta/);
    } else {
      assert.equal(fixture.element('loginInput').value, 'local-fixture-password');
      assert.doesNotMatch(fixture.element('loginError').textContent, /Senha incorreta/);
    }
    assert.equal(fixture.unlocked(), 0);
  }
});

test('admin server preparation failure never sends the password', async () => {
  const fixture = loginScope(() => { throw Error('must not transmit credentials'); });
  fixture.scope.RStreetBackendConnection = { ready: async () => { throw Object.assign(Error('offline'), { code: 'BACKEND_UNAVAILABLE' }); } };
  await fixture.scope.fazerLogin();
  assert.equal(fixture.element('loginInput').value, 'local-fixture-password');
  assert.equal(fixture.element('loginBtn').disabled, false);
  assert.match(fixture.element('loginError').textContent, /conexão/);
});

test('order refresh preserves previous orders on failure and ignores older responses', async () => {
  const pending = [];
  let renders = 0;
  const scope = vm.createContext({ allPedidos: [{ id: 1 }], document: { getElementById: () => ({ innerHTML: '' }) },
    toast() {}, updatePedidosStats() {}, renderPedidosTable: () => { renders++; },
    sbFetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  vm.runInContext(extract('let pedidosRequest = 0;', 'function csvCell('), scope);
  const old = scope.loadPedidos(), fresh = scope.loadPedidos();
  pending[1].resolve([{ id: 2 }]); await fresh;
  pending[0].resolve([{ id: 1 }]); await old;
  assert.equal(scope.allPedidos[0].id, 2);
  assert.equal(renders, 1);
  const failed = scope.loadPedidos(); pending[2].reject(Error('offline')); await failed;
  assert.equal(scope.allPedidos[0].id, 2);
  assert.equal(renders, 1);
});

test('corrupt or blocked seen-order storage never prevents opening an order', () => {
  let raw = '[]', blocked = false;
  const scope = vm.createContext({ localStorage: {
    getItem() { if (blocked) throw Error('blocked'); return raw; },
    setItem(_key, value) { if (blocked) throw Error('blocked'); raw = value; },
  } });
  vm.runInContext(extract('const PEDIDOS_VISTOS_KEY', 'function isPedidoPago('), scope);
  for (const value of ['{bad', 'null', '{}', '[null,false,{},-1,"invalid"]']) {
    raw = value;
    assert.equal(scope.getPedidosVistos().length, 0);
  }
  raw = '[1,"2","02"]';
  assert.equal(scope.getPedidosVistos().length, 2);
  blocked = true;
  scope.setPedidoVisto(42);
  assert.equal(scope.isPedidoVisto({ id: 42 }), true);
  scope.setPedidoVisto('invalid');
  assert.equal(scope.getPedidosVistos().length, 1);
});

test('catalog refresh notification tolerates restricted storage and closes every channel', () => {
  let posts = 0, closes = 0;
  const timers = [];
  const scope = vm.createContext({ Date, localStorage: { setItem() { throw Error('blocked'); } },
    setTimeout: callback => timers.push(callback),
    BroadcastChannel: class { postMessage() { posts++; } close() { closes++; } },
  });
  vm.runInContext(extract('function notifyCatalogChanged()', 'const PEDIDOS_VISTOS_KEY'), scope);
  scope.notifyCatalogChanged(); timers.forEach(callback => callback());
  assert.equal(posts, 3); assert.equal(closes, 3);
  scope.BroadcastChannel = undefined;
  assert.doesNotThrow(() => scope.notifyCatalogChanged());
});

function productSaveScope() {
  const fields = new Map(), calls = [], notices = [];
  const field = id => {
    if (!fields.has(id)) fields.set(id, { value: '', disabled: false, inert: false, textContent: '',
      classList: { contains: () => true }, setAttribute() {}, removeAttribute() {},
      querySelector: () => field('editor') });
    return fields.get(id);
  };
  field('f-nome').value = 'Produto de teste local';
  field('f-marca').value = 'Ogochi';
  field('f-preco').value = '159.90';
  const scope = vm.createContext({ productSaveInProgress: false, adminMediaUploading: false, variantsLoaded: true, editingId: null,
    currentSizes: ['M'], allProducts: [], document: { getElementById: field },
    console: { error() {} }, toast: message => notices.push(message),
    syncActiveVariantEditorToState() {}, uploadProductPhotos: async () => ['fixture.jpg'],
    uploadPendingVariantMedia: async () => {}, getPreparedVariants: () => [],
    applyVariantsToProductPayload() {}, getProductImagesFromVariants: () => [],
    saveProductRemote: async (_payload, id) => { calls.push(id || 'create'); return { id: 101 }; },
    saveProductVariants: async () => {}, notifyCatalogChanged() {}, getFriendlySaveError: error => error.message,
    closeProductModal() {}, updateStats() {}, renderRecentTable() {}, renderAdminTable() {},
  });
  vm.runInContext(extract('async function saveProduct()', 'function editProduct('), scope);
  return { scope, field, calls, notices };
}

test('product save blocks duplicate activation and modal switches while media is pending', async () => {
  const fixture = productSaveScope();
  let finish;
  fixture.scope.uploadProductPhotos = () => new Promise(resolve => { finish = resolve; });
  vm.runInContext(extract('function openProductModal(', 'function toggleStatus('), fixture.scope);
  const request = fixture.scope.saveProduct();
  assert.equal(fixture.scope.productSaveInProgress, true);
  assert.equal(fixture.field('editor').inert, true);
  fixture.scope.openProductModal(999); fixture.scope.closeProductModal();
  assert.equal(fixture.scope.editingId, null);
  await fixture.scope.saveProduct();
  fixture.scope.closeProductModal = () => {};
  finish(['fixture.jpg']); await request;
  assert.deepEqual(fixture.calls, ['create']);
  assert.equal(fixture.scope.productSaveInProgress, false);
  assert.equal(fixture.field('editor').inert, false);
  assert.equal(fixture.field('saveBtn').disabled, false);
});

test('retry after confirmed product creation and failed variants updates the same product', async () => {
  const fixture = productSaveScope();
  let attempts = 0;
  fixture.scope.saveProductVariants = async () => { if (++attempts === 1) throw Error('temporary variant failure'); };
  await fixture.scope.saveProduct();
  assert.equal(fixture.scope.editingId, 101);
  assert.equal(fixture.scope.allProducts.length, 1);
  assert.equal(fixture.field('saveBtn').disabled, false);
  await fixture.scope.saveProduct();
  assert.deepEqual(fixture.calls, ['create', 101]);
  assert.equal(fixture.scope.allProducts.length, 1);
});

test('unconfirmed creation never fabricates a local product or announces success', async () => {
  const fixture = productSaveScope();
  fixture.scope.saveProductRemote = async () => ({});
  await fixture.scope.saveProduct();
  assert.equal(fixture.scope.allProducts.length, 0);
  assert.match(fixture.notices[0], /confirmar o cadastro/);
  assert.equal(fixture.scope.productSaveInProgress, false);
});

test('product price must be finite and positive before any save is started', async () => {
  for (const price of ['0', '-5', 'Infinity', '']) {
    const fixture = productSaveScope(); fixture.field('f-preco').value = price;
    await fixture.scope.saveProduct();
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.scope.productSaveInProgress, false);
    assert.match(fixture.notices[0], /preço maior que zero/);
  }
});

test('admin restores only an unexpired existing session and calls restoration on startup', () => {
  let unlocked = 0, loaded = 0, removed = 0;
  const scope = vm.createContext({ Date,
    sessionStorage: { getItem: () => String(Date.now() + 60000), removeItem: () => { removed++; } },
    getAdminToken: () => 'local-fixture', unlockAdminInterface: () => { unlocked++; }, loadProducts: () => { loaded++; },
  });
  vm.runInContext(extract('function verificarLogin()', 'let allProducts ='), scope);
  scope.verificarLogin();
  assert.equal(unlocked, 1); assert.equal(loaded, 1);
  scope.sessionStorage.getItem = () => '1'; scope.verificarLogin();
  assert.equal(unlocked, 1); assert.equal(removed, 2);
  scope.sessionStorage.getItem = () => { throw Error('blocked'); };
  assert.doesNotThrow(() => scope.verificarLogin());
  assert.match(source, /try \{ localStorage\.removeItem\('rstreet_cfg'\); \} catch \{\}\s+verificarLogin\(\);/);
});

test('admin read and write requests have bounded timeouts without automatic retries', async () => {
  const durations = [], calls = [];
  const scope = vm.createContext({ BACKEND_BASE: 'https://fixture.invalid/api', authHeaders: value => value,
    AbortSignal: { timeout: milliseconds => { durations.push(milliseconds); return new AbortController().signal; } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => '[]' }; },
  });
  vm.runInContext(extract('async function sbFetch(', 'function notifyCatalogChanged()'), scope);
  vm.runInContext(extract('async function productVariantsRequest(', 'function escapeHtml('), scope);
  await scope.sbFetch('/produtos');
  await scope.sbFetch('/produtos', { method: 'POST', body: '{}' });
  await scope.productVariantsRequest(1);
  await scope.productVariantsRequest(1, { method: 'PUT', body: '{}' });
  assert.deepEqual(durations, [20000, 60000, 20000, 60000]);
  assert.equal(calls.length, 4);
  vm.runInContext(extract('function getFriendlySaveError(', 'async function productVariantsRequest('), scope);
  assert.match(scope.getFriendlySaveError({ name: 'TimeoutError' }), /pode ter sido recebido/);
});

test('admin product labels point to their inputs', () => {
  for (const id of ['f-nome','f-marca','f-categoria','f-preco','f-preco-antigo','f-estoque','f-ref','f-imagem','f-desc','f-specs','f-care']) {
    assert.ok(source.includes(`for="${id}"`), id);
  }
});
